// ROZFOOD Engineering Studio v6.0.0 — Body-Aware Hidden Line Core
// Deterministic local hidden-line oracle that keeps the identity of the front-most body.
// It prevents one component from spuriously leaking through another and separates
// self-occlusion from cross-body occlusion before SVG generation.

const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const mul=(a,s)=>[a[0]*s,a[1]*s,a[2]*s];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const corners=b=>{const out=[];for(const x of [b.min[0],b.max[0]])for(const y of [b.min[1],b.max[1]])for(const z of [b.min[2],b.max[2]])out.push([x,y,z]);return out};
const project=(p,s)=>[dot(p,s.px),dot(p,s.py)];

function projectedBounds(bounds,s){
  const pts=corners(bounds).map(p=>project(p,s)),xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]);
  return{min:[Math.min(...xs),Math.min(...ys)],max:[Math.max(...xs),Math.max(...ys)]};
}
function componentIdsForEdge(edge){
  const ids=new Set();
  for(const id of edge?.componentIds||[])if(id)ids.add(id);
  for(const c of edge?.contributors||[])if(c?.componentId)ids.add(c.componentId);
  if(edge?.componentId&&edge.componentId!=='MULTI'&&edge.componentId!=='RAW')ids.add(edge.componentId);
  return ids;
}

/**
 * Rasterizes the front two body layers. Keeping a second owner/depth is important at
 * coincident assembly contacts: the solver can distinguish a true occluding body from
 * the same body's surface without flattening all touching components into one z-buffer.
 */
export function buildBodyVisibilityField(rec,s,{targetPixels=900000,maxFaces=150000}={}){
  const faces=rec?.faces||[];if(!faces.length)return null;
  const ex=projectedBounds(rec.bounds,s),spanX=Math.max(ex.max[0]-ex.min[0],1e-9),spanY=Math.max(ex.max[1]-ex.min[1],1e-9),aspect=spanX/spanY;
  let cols=Math.round(Math.sqrt(targetPixels*Math.max(.25,aspect))),rows=Math.round(cols/Math.max(.25,aspect));
  cols=clamp(cols,520,1400)|0;rows=clamp(rows,380,1050)|0;
  const N=cols*rows,z1=new Float32Array(N),z2=new Float32Array(N),owner1=new Int32Array(N),owner2=new Int32Array(N);
  z1.fill(-Infinity);z2.fill(-Infinity);owner1.fill(-1);owner2.fill(-1);
  const ownerMap=new Map(),ownerNames=[];
  const ownerIndex=id=>{id=String(id||'RAW');if(ownerMap.has(id))return ownerMap.get(id);const n=ownerNames.length;ownerMap.set(id,n);ownerNames.push(id);return n};
  const gx=x=>(x-ex.min[0])/spanX*(cols-1),gy=y=>(y-ex.min[1])/spanY*(rows-1);
  const step=faces.length>maxFaces?Math.ceil(faces.length/maxFaces):1;
  let rasterFaces=0,rasterSamples=0;
  for(let fi=0;fi<faces.length;fi+=step){
    const face=faces[fi],loop=face?.loops?.[0]||[];if(loop.length<3)continue;const own=ownerIndex(face.componentId||'RAW');rasterFaces++;
    for(let ti=1;ti+1<loop.length;ti++){
      const P=[loop[0],loop[ti],loop[ti+1]],q=P.map(p=>project(p,s)),dep=P.map(p=>dot(p,s.dir));
      const ax=gx(q[0][0]),ay=gy(q[0][1]),bx=gx(q[1][0]),by=gy(q[1][1]),cx=gx(q[2][0]),cy=gy(q[2][1]);
      const den=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy);if(Math.abs(den)<1e-10)continue;
      const x0=Math.max(0,Math.floor(Math.min(ax,bx,cx))),x1=Math.min(cols-1,Math.ceil(Math.max(ax,bx,cx))),y0=Math.max(0,Math.floor(Math.min(ay,by,cy))),y1=Math.min(rows-1,Math.ceil(Math.max(ay,by,cy)));
      for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
        const px=x+.5,py=y+.5,w1=((by-cy)*(px-cx)+(cx-bx)*(py-cy))/den,w2=((cy-ay)*(px-cx)+(ax-cx)*(py-cy))/den,w3=1-w1-w2;
        if(w1<-.008||w2<-.008||w3<-.008)continue;
        const depth=w1*dep[0]+w2*dep[1]+w3*dep[2],idx=y*cols+x;rasterSamples++;
        if(owner1[idx]===own){if(depth>z1[idx])z1[idx]=depth;continue}
        if(depth>z1[idx]){z2[idx]=z1[idx];owner2[idx]=owner1[idx];z1[idx]=depth;owner1[idx]=own;continue}
        if(owner2[idx]===own){if(depth>z2[idx])z2[idx]=depth;continue}
        if(depth>z2[idx]){z2[idx]=depth;owner2[idx]=own}
      }
    }
  }
  const diag=Math.hypot(...(rec.bounds?.size||[1,1,1]));
  return{z1,z2,owner1,owner2,ownerNames,ownerMap,cols,rows,ex,spanX,spanY,
    selfTol:Math.max(.008,diag*.00018),foreignTol:Math.max(.006,diag*.00012),contactTol:Math.max(.012,diag*.00025),
    stats:{cols,rows,rasterFaces,rasterSamples,components:ownerNames.length,faceStep:step}};
}

function classifySample(p,s,field,edgeIds,dx=0,dy=0){
  const q=project(p,s),fx=(q[0]-field.ex.min[0])/field.spanX*(field.cols-1),fy=(q[1]-field.ex.min[1])/field.spanY*(field.rows-1);
  const x=Math.round(fx)+dx,y=Math.round(fy)+dy;if(x<0||y<0||x>=field.cols||y>=field.rows)return{visible:true,reason:'outside'};
  const idx=y*field.cols+x,front=field.z1[idx];if(!Number.isFinite(front))return{visible:true,reason:'empty'};
  const pd=dot(p,s.dir),own=field.owner1[idx],ownerName=own>=0?field.ownerNames[own]:'RAW',same=edgeIds.has(ownerName),gap=front-pd;
  if(gap<= (same?field.selfTol:field.foreignTol))return{visible:true,reason:same?'surface':'contact',owner:ownerName,gap};
  return{visible:false,reason:same?'self':'foreign',owner:ownerName,gap};
}

/** Returns visibility plus the body responsible for occlusion. */
export function bodyPointVisibility(p,s,field,edge=null){
  if(!field)return{visible:true,reason:'no-field'};
  const ids=componentIdsForEdge(edge),votes=[];
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)votes.push(classifySample(p,s,field,ids,dx,dy));
  const visible=votes.filter(v=>v.visible).length,hidden=votes.length-visible;
  if(visible>=4)return{visible:true,reason:'neighborhood',votes};
  const foreign=votes.filter(v=>!v.visible&&v.reason==='foreign'),self=votes.filter(v=>!v.visible&&v.reason==='self');
  const best=(foreign.length?foreign:self).sort((a,b)=>(b.gap||0)-(a.gap||0))[0];
  return{visible:false,reason:foreign.length>=self.length?'foreign':'self',occluder:best?.owner||null,gap:best?.gap||0,votes};
}

/** Splits one CAD edge into body-aware visible intervals and returns occlusion statistics. */
export function visibleBodyAwareEdgeSegments(edge,s,field,{samples=41,refine=7}={}){
  if(!field)return{segments:[[edge.a,edge.b]],stats:{visible:1,hidden:0,selfOccluded:0,foreignOccluded:0}};
  const n=clamp(samples,17,81)|0,at=t=>add(mul(edge.a,1-t),mul(edge.b,t));
  const sample=t=>{const p=at(t),r=bodyPointVisibility(p,s,field,edge);return{t,p,...r}};
  const states=[];let selfOccluded=0,foreignOccluded=0;
  for(let i=0;i<n;i++){const st=sample(i/(n-1));states.push(st);if(!st.visible){if(st.reason==='foreign')foreignOccluded++;else selfOccluded++}}
  const boundary=(lo,hi,wantVisible)=>{let a=lo,b=hi;for(let k=0;k<refine;k++){const m=(a+b)/2,v=sample(m).visible;if(v===wantVisible)b=m;else a=m}return(a+b)/2};
  const intervals=[];let open=null;
  for(let i=0;i<n-1;i++){
    const A=states[i],B=states[i+1];if(A.visible&&open===null)open=A.t;
    if(A.visible!==B.visible){const t=boundary(A.t,B.t,B.visible);if(A.visible&&open!==null){intervals.push([open,t]);open=null}else if(B.visible)open=t}
    if(i===n-2&&B.visible){if(open===null)open=B.t;intervals.push([open,1]);open=null}
  }
  const segments=intervals.filter(([a,b])=>b-a>1e-5).map(([a,b])=>[at(a),at(b)]);
  return{segments,stats:{visible:states.filter(x=>x.visible).length,hidden:states.filter(x=>!x.visible).length,selfOccluded,foreignOccluded}};
}

export function bodyVisibilityStats(field){return field?.stats||null}
