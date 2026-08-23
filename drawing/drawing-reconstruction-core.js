import {classifyContourEdge} from './contour-semantics-core.js';
// ROZFOOD Engineering Studio v6.0.0 — Contour Semantics / Drawing Reconstruction Core
// Faceted source in, engineering linework out. No AI / no server dependency.

const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const mul=(a,s)=>[a[0]*s,a[1]*s,a[2]*s];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const len=a=>Math.hypot(a[0],a[1],a[2]);
const norm=a=>{const l=len(a)||1;return[a[0]/l,a[1]/l,a[2]/l]};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

const topologyCache=new WeakMap();
const cadEdgeCache=new WeakMap();

function faceNormal(face){
  const ns=face?.normals||[];
  if(ns.length){
    let s=[0,0,0];
    for(const n of ns)s=add(s,n);
    if(len(s)>1e-10)return norm(s);
  }
  const p=face?.loops?.[0]||[];
  return p.length>=3?norm(cross(sub(p[1],p[0]),sub(p[2],p[0]))):[0,0,1];
}

function quantStep(rec){
  const d=Math.hypot(...(rec?.bounds?.size||[1,1,1]));
  // Small enough to weld coincident tessellation vertices, large enough to absorb parser noise.
  return clamp(d*1e-5,0.002,0.035);
}
function qpt(p,q){return p.map(v=>Math.round(v/q)).join(',')}
function edgeKey(a,b,component,q){const aa=qpt(a,q),bb=qpt(b,q);return(aa<bb?aa+'|'+bb:bb+'|'+aa)+'|'+(component||'RAW')}

/**
 * Builds welded triangle-edge topology. The result preserves adjacent face normals so
 * coplanar tessellation diagonals can be suppressed before they reach SVG.
 */
export function buildDrawingTopology(rec){
  if(topologyCache.has(rec))return topologyCache.get(rec);
  const q=quantStep(rec),map=new Map();
  for(const face of rec?.faces||[]){
    const loop=face?.loops?.[0]||[];
    if(loop.length<3)continue;
    const n=faceNormal(face),componentId=face.componentId||'RAW';
    // Faces are normally triangles, but accept arbitrary polygon loops defensively.
    for(let i=0;i<loop.length;i++){
      const a=loop[i],b=loop[(i+1)%loop.length];
      if(!a||!b||len(sub(a,b))<q*.1)continue;
      const k=edgeKey(a,b,componentId,q);
      let e=map.get(k);
      if(!e){e={a,b,componentId,normals:[],faces:0,faceKeys:[]};map.set(k,e)}
      e.normals.push(n);e.faces++;
      const fk=[face.componentId||'RAW',face.modelId||'',face.sourceStream||'',face.tessFaceId??''].join('|');
      if(!e.faceKeys.includes(fk))e.faceKeys.push(fk);
    }
  }
  const edges=[...map.values()];
  const out={edges,quantization:q};topologyCache.set(rec,out);return out;
}


/**
 * Reconstructs the drawing edge graph at SolidWorks FaceTessellations face boundaries.
 * Triangulation edges inside one original tessellated face are never drawing edges.
 * This is the critical distinction between a CAD drawing and a mesh wireframe.
 */
export function buildCadEdgeGraph(rec){
  if(cadEdgeCache.has(rec))return cadEdgeCache.get(rec);
  const q=quantStep(rec),groups=new Map();
  for(const face of rec?.faces||[]){
    const loop=face?.loops?.[0]||[];if(loop.length<3)continue;
    const fk=[face.componentId||'RAW',face.modelId||'',face.sourceStream||'',face.tessFaceId??''].join('|');
    let g=groups.get(fk);if(!g){g={faceKey:fk,componentId:face.componentId||'RAW',edges:new Map()};groups.set(fk,g)}
    const n=faceNormal(face);
    for(let i=0;i<loop.length;i++){
      const a=loop[i],b=loop[(i+1)%loop.length];if(!a||!b||len(sub(a,b))<q*.1)continue;
      const k=edgeKey(a,b,g.componentId,q);let e=g.edges.get(k);if(!e){e={a,b,count:0,normals:[]};g.edges.set(k,e)}e.count++;e.normals.push(n)
    }
  }
  const global=new Map();
  for(const g of groups.values())for(const e of g.edges.values()){
    if(e.count!==1)continue; // interior tessellation chord inside one original CAD face
    const k=edgeKey(e.a,e.b,g.componentId,q);let x=global.get(k);
    if(!x){x={a:e.a,b:e.b,componentId:g.componentId,normals:[],faces:0,faceKeys:[],contributors:[]};global.set(k,x)}
    let n=[0,0,0];for(const z of e.normals)n=add(n,z);n=norm(n);x.normals.push(n);x.faces++;x.faceKeys.push(g.faceKey);
    let contributor=x.contributors.find(c=>c.componentId===g.componentId);if(!contributor){contributor={componentId:g.componentId,normals:[],faceKeys:[],faces:0};x.contributors.push(contributor)}contributor.normals.push(n);contributor.faceKeys.push(g.faceKey);contributor.faces++;
  }
  // v3.7: collapse physically coincident CAD boundaries across assembly components.
  // The per-component pass above is still required to remove each face's internal tessellation,
  // but identical 3D edges from touching parts must become one drawing edge before projection/HLR.
  const shared=new Map();let sharedCollapsed=0;
  for(const e of global.values()){
    const aa=qpt(e.a,q),bb=qpt(e.b,q),k=aa<bb?aa+'|'+bb:bb+'|'+aa;let x=shared.get(k);
    if(!x){x={...e,componentIds:[e.componentId],contributors:(e.contributors||[]).map(c=>({...c,normals:[...(c.normals||[])],faceKeys:[...(c.faceKeys||[])]}))};shared.set(k,x);continue}
    sharedCollapsed++;for(const n of e.normals||[])x.normals.push(n);for(const fk of e.faceKeys||[])if(!x.faceKeys.includes(fk))x.faceKeys.push(fk);
    for(const c of e.contributors||[]){let dst=x.contributors.find(z=>z.componentId===c.componentId);if(!dst){dst={componentId:c.componentId,normals:[],faceKeys:[],faces:0};x.contributors.push(dst)}for(const n of c.normals||[])dst.normals.push(n);for(const fk of c.faceKeys||[])if(!dst.faceKeys.includes(fk))dst.faceKeys.push(fk);dst.faces+=(c.faces||0)}
    if(!x.componentIds.includes(e.componentId))x.componentIds.push(e.componentId);x.componentId=x.componentIds.length===1?x.componentIds[0]:'MULTI';x.faces+=(e.faces||0);
  }
  const edges=[...shared.values()];
  const out={edges,quantization:q,sourceFaceGroups:groups.size,sharedCollapsed};cadEdgeCache.set(rec,out);return out;
}

function classifyEdge(edge,viewDir,{featureCos=.985,tangentCos=.9996}={}){
  const ns=edge.normals||[],d=norm(viewDir);
  if(ns.length<=1)return{kind:'BOUNDARY',draw:true};
  let silhouette=false,minAbsDot=1,maxNormalAngle=0;
  for(let i=0;i<ns.length;i++){
    minAbsDot=Math.min(minAbsDot,Math.abs(dot(ns[i],d)));
    for(let j=i+1;j<ns.length;j++){
      const nd=clamp(dot(ns[i],ns[j]),-1,1);
      maxNormalAngle=Math.max(maxNormalAngle,Math.acos(nd));
      if(dot(ns[i],d)*dot(ns[j],d)<=0)silhouette=true;
    }
  }
  if(silhouette)return{kind:'SILHOUETTE',draw:true};
  const pairCos=Math.cos(maxNormalAngle);
  // Near-coplanar adjacent triangles are tessellation edges, never engineering edges.
  if(pairCos>=tangentCos)return{kind:'TESSELLATION',draw:false};
  // Gentle tangent transitions (cylinder triangulation) are also suppressed unless they
  // are a silhouette. This is the main anti-ragged filter for curved surfaces.
  if(pairCos>=featureCos)return{kind:'TANGENT',draw:false};
  return{kind:'FEATURE',draw:true};
}

export function engineeringLinework(rec,viewDir,options={}){
  const {edges}=buildCadEdgeGraph(rec),out=[];
  for(const edge of edges){
    const c=classifyContourEdge(edge,viewDir,rec,options);
    if(c.draw)out.push({...edge,kind:c.kind,semanticRole:c.role});
  }
  return out;
}

function corners(bounds){const mn=bounds.min,mx=bounds.max,out=[];for(const x of [mn[0],mx[0]])for(const y of [mn[1],mx[1]])for(const z of [mn[2],mx[2]])out.push([x,y,z]);return out}
function project(p,s){return[dot(p,s.px),dot(p,s.py)]}
function projectBounds(bounds,s){const pts=corners(bounds).map(p=>project(p,s)),xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]);return{min:[Math.min(...xs),Math.min(...ys)],max:[Math.max(...xs),Math.max(...ys)]}}

/** Higher-resolution, adaptive tessellated depth field used only as an occlusion oracle. */
export function buildOcclusionField(rec,s,{targetPixels=520000,maxFaces=120000}={}){
  const faces=rec?.faces||[];if(!faces.length)return null;
  const ex=projectBounds(rec.bounds,s),spanX=Math.max(ex.max[0]-ex.min[0],1e-9),spanY=Math.max(ex.max[1]-ex.min[1],1e-9),aspect=spanX/spanY;
  let cols=Math.round(Math.sqrt(targetPixels*Math.max(.25,aspect))),rows=Math.round(cols/Math.max(.25,aspect));
  cols=clamp(cols,420,1100)|0;rows=clamp(rows,320,900)|0;
  const z=new Float32Array(cols*rows);z.fill(-Infinity);
  const gx=x=>(x-ex.min[0])/spanX*(cols-1),gy=y=>(y-ex.min[1])/spanY*(rows-1);
  const step=faces.length>maxFaces?Math.ceil(faces.length/maxFaces):1;
  for(let fi=0;fi<faces.length;fi+=step){
    const loop=faces[fi]?.loops?.[0]||[];if(loop.length<3)continue;
    for(let ti=1;ti+1<loop.length;ti++){
      const P=[loop[0],loop[ti],loop[ti+1]],q=P.map(p=>project(p,s)),dep=P.map(p=>dot(p,s.dir));
      const ax=gx(q[0][0]),ay=gy(q[0][1]),bx=gx(q[1][0]),by=gy(q[1][1]),cx=gx(q[2][0]),cy=gy(q[2][1]);
      const den=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy);if(Math.abs(den)<1e-10)continue;
      const x0=Math.max(0,Math.floor(Math.min(ax,bx,cx))),x1=Math.min(cols-1,Math.ceil(Math.max(ax,bx,cx))),y0=Math.max(0,Math.floor(Math.min(ay,by,cy))),y1=Math.min(rows-1,Math.ceil(Math.max(ay,by,cy)));
      for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
        const px=x+.5,py=y+.5,w1=((by-cy)*(px-cx)+(cx-bx)*(py-cy))/den,w2=((cy-ay)*(px-cx)+(ax-cx)*(py-cy))/den,w3=1-w1-w2;
        if(w1<-.01||w2<-.01||w3<-.01)continue;
        const depth=w1*dep[0]+w2*dep[1]+w3*dep[2],idx=y*cols+x;if(depth>z[idx])z[idx]=depth;
      }
    }
  }
  const diag=Math.hypot(...(rec.bounds?.size||[1,1,1]));
  return{z,cols,rows,ex,spanX,spanY,tol:Math.max(.012,diag*.00032)};
}

export function pointVisible(p,s,field){
  if(!field)return true;
  const q=project(p,s),fx=(q[0]-field.ex.min[0])/field.spanX*(field.cols-1),fy=(q[1]-field.ex.min[1])/field.spanY*(field.rows-1);
  if(fx<0||fy<0||fx>=field.cols||fy>=field.rows)return true;
  const x=Math.round(fx),y=Math.round(fy),front=field.z[y*field.cols+x];
  return !Number.isFinite(front)||dot(p,s.dir)>=front-field.tol;
}

/**
 * Splits an edge into visible intervals instead of dropping/keeping the whole edge.
 * This removes the characteristic "lines through the shell" and torn half-visible edges.
 */
export function visibleEdgeSegments(edge,s,field,{samples=33,refine=5}={}){
  if(!field)return[[edge.a,edge.b]];
  const n=clamp(samples,13,65)|0;
  const at=t=>add(mul(edge.a,1-t),mul(edge.b,t));
  const states=[];for(let i=0;i<n;i++){const t=i/(n-1);states.push({t,p:at(t),v:pointVisible(at(t),s,field)})}
  const boundary=(lo,hi,wantVisible)=>{let a=lo,b=hi;for(let k=0;k<refine;k++){const m=(a+b)/2,v=pointVisible(at(m),s,field);if(v===wantVisible)b=m;else a=m}return (a+b)/2};
  const intervals=[];let open=null;
  for(let i=0;i<n-1;i++){
    const A=states[i],B=states[i+1];
    if(A.v&&open===null)open=A.t;
    if(A.v!==B.v){const t=boundary(A.t,B.t,B.v);if(A.v&&open!==null){intervals.push([open,t]);open=null}else if(B.v){open=t}}
    if(i===n-2&&B.v){if(open===null)open=B.t;intervals.push([open,1]);open=null}
  }
  return intervals.filter(([a,b])=>b-a>1e-5).map(([a,b])=>[at(a),at(b)]);
}
export function reconstructionStats(rec,viewDir){
  const triangleTopology=buildDrawingTopology(rec),cad=buildCadEdgeGraph(rec),line=engineeringLinework(rec,viewDir);
  return{rawTriangleEdges:triangleTopology.edges.length,cadEdges:cad.edges.length,engineeringEdges:line.length,suppressedTriangulation:Math.max(0,triangleTopology.edges.length-cad.edges.length),suppressedShared3D:cad.sharedCollapsed||0,suppressedByView:Math.max(0,cad.edges.length-line.length),quantization:cad.quantization,sourceFaceGroups:cad.sourceFaceGroups};
}
