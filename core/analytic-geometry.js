// ROZFOOD Engineering Studio v2.7.0 — Helical / Spline Feature Reconstruction Core
// Reconstructs engineering primitives from verified FaceTessellations recognition.
// This is intentionally deterministic/offline and does not claim exact Parasolid decoding.

const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const mul=(a,s)=>[a[0]*s,a[1]*s,a[2]*s];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const len=a=>Math.hypot(a[0],a[1],a[2]);
const norm=a=>{const l=len(a)||1;return[a[0]/l,a[1]/l,a[2]/l]};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const cache=new WeakMap();
const cadBoundaryCache=new WeakMap();

function canonicalAxis(a){a=norm(a);const i=Math.abs(a[0])>.01?0:Math.abs(a[1])>.01?1:2;return a[i]<0?mul(a,-1):a}
function axisDistance(a,b){const ax=norm(a.axis),d=sub(b.axisPoint,a.axisPoint);return len(sub(d,mul(ax,dot(d,ax))))}
function angleCos(a,b){return Math.abs(dot(norm(a),norm(b)))}
function cylinderKey(c){const a=canonicalAxis(c.axis),p=c.axisPoint||[0,0,0];return [c.componentId||'RAW',...a.map(v=>Math.round(v*1000)),...p.map(v=>Math.round(v*20)),Math.round(c.radius*100),Math.round(c.length*20)].join('|')}


function modelDiag(rec){return Math.hypot(...(rec?.bounds?.size||[1,1,1]))||1}
function qkey(p,q){return p.map(v=>Math.round(v/q)).join(',')}
function undirectedKey(a,b,q){const A=qkey(a,q),B=qkey(b,q);return A<B?A+'|'+B:B+'|'+A}
function faceKeyOf(f){return [f.componentId||'RAW',f.modelId||'',f.sourceStream||'',f.tessFaceId??''].join('|')}
function pointLineDistance(p,a,b){const ab=sub(b,a),L=len(ab);if(L<1e-12)return len(sub(p,a));return len(cross(sub(p,a),ab))/L}
function rdp3(points,tol){
  if(points.length<=2)return points.slice();
  let best=-1,idx=-1;for(let i=1;i<points.length-1;i++){const d=pointLineDistance(points[i],points[0],points.at(-1));if(d>best){best=d;idx=i}}
  if(best<=tol)return[points[0],points.at(-1)];
  const a=rdp3(points.slice(0,idx+1),tol),b=rdp3(points.slice(idx),tol);return a.slice(0,-1).concat(b)
}
function simplifyClosed3(points,tol){
  if(points.length<5)return points.concat([points[0]]);
  const p0=points[0];let idx=1,best=-1;for(let i=1;i<points.length;i++){const d=len(sub(points[i],p0));if(d>best){best=d;idx=i}}
  const a=rdp3(points.slice(0,idx+1),tol),b=rdp3(points.slice(idx).concat([points[0]]),tol);const out=a.slice(0,-1).concat(b);
  if(len(sub(out[0],out.at(-1)))>1e-9)out.push(out[0]);return out
}
function planeBasis(n){const a=norm(n),seed=Math.abs(a[2])<.82?[0,0,1]:[1,0,0],u=norm(cross(a,seed)),v=norm(cross(a,u));return{u,v}}
function solve3(A,b){
  const m=A.map((r,i)=>[...r,b[i]]);for(let c=0;c<3;c++){let piv=c;for(let r=c+1;r<3;r++)if(Math.abs(m[r][c])>Math.abs(m[piv][c]))piv=r;if(Math.abs(m[piv][c])<1e-12)return null;[m[c],m[piv]]=[m[piv],m[c]];const d=m[c][c];for(let j=c;j<4;j++)m[c][j]/=d;for(let r=0;r<3;r++)if(r!==c){const f=m[r][c];for(let j=c;j<4;j++)m[r][j]-=f*m[c][j]}}return[m[0][3],m[1][3],m[2][3]]
}
function circleFit2D(points){
  if(points.length<3)return null;let sx=0,sy=0,sxx=0,syy=0,sxy=0,sr=0,sxr=0,syr=0;
  for(const [x,y] of points){const r=x*x+y*y;sx+=x;sy+=y;sxx+=x*x;syy+=y*y;sxy+=x*y;sr+=r;sxr+=x*r;syr+=y*r}
  const n=points.length,sol=solve3([[sxx,sxy,sx],[sxy,syy,sy],[sx,sy,n]],[-sxr,-syr,-sr]);if(!sol)return null;
  const [D,E,F]=sol,cx=-D/2,cy=-E/2,rr=cx*cx+cy*cy-F;if(!(rr>1e-12))return null;const radius=Math.sqrt(rr);let se=0;for(const [x,y] of points){const d=Math.hypot(x-cx,y-cy)-radius;se+=d*d}return{cx,cy,radius,rms:Math.sqrt(se/n)}
}
function angularCoverage2D(points,cx,cy){if(points.length<3)return 0;const a=points.map(([x,y])=>Math.atan2(y-cy,x-cx)).sort((x,y)=>x-y);let gap=0;for(let i=1;i<a.length;i++)gap=Math.max(gap,a[i]-a[i-1]);gap=Math.max(gap,a[0]+Math.PI*2-a.at(-1));return Math.PI*2-gap}

function unwrapAngles(points,cx,cy){
  const out=[];let prev=null,acc=0;
  for(const [x,y] of points){let a=Math.atan2(y-cy,x-cx);if(prev!==null){let d=a-prev;while(d>Math.PI)d-=Math.PI*2;while(d<-Math.PI)d+=Math.PI*2;acc+=d}else acc=a;out.push(acc);prev=a}
  return out;
}
function circularArcFromPlanarChain(points,plane,diag,{circleSegments=120}={}){
  if(!plane||points.length<5)return null;
  const {u,v}=planeBasis(plane.normal),o=plane.origin,p2=points.map(p=>[dot(sub(p,o),u),dot(sub(p,o),v)]),fit=circleFit2D(p2);if(!fit)return null;
  const tol=Math.max(.025,fit.radius*.0018,diag*3e-5);if(fit.radius<tol*3||fit.rms>tol)return null;
  const ang=unwrapAngles(p2,fit.cx,fit.cy),sweep=ang.at(-1)-ang[0];if(Math.abs(sweep)<.12||Math.abs(sweep)>Math.PI*2.02)return null;
  // Reject chains that wander backwards around the fitted circle; those are not one CAD arc.
  let reversals=0;for(let i=2;i<ang.length;i++){const a=ang[i-1]-ang[i-2],b=ang[i]-ang[i-1];if(Math.abs(a)>.01&&Math.abs(b)>.01&&a*b<0)reversals++}if(reversals>1)return null;
  const center=add(o,add(mul(u,fit.cx),mul(v,fit.cy))),count=Math.max(8,Math.ceil(Math.abs(sweep)/(Math.PI*2)*circleSegments)),samples=[];
  for(let i=0;i<=count;i++){const t=ang[0]+sweep*i/count;samples.push(add(center,add(mul(u,Math.cos(t)*fit.radius),mul(v,Math.sin(t)*fit.radius))))}
  return{points:samples,center,radius:fit.radius,sweep,rms:fit.rms};
}
function chainBoundaryEdges(edges,q){
  const byVertex=new Map();const addV=(k,i)=>{let a=byVertex.get(k);if(!a)byVertex.set(k,a=[]);a.push(i)};
  edges.forEach((e,i)=>{addV(qkey(e.a,q),i);addV(qkey(e.b,q),i)});const used=new Uint8Array(edges.length),chains=[];
  const endpoint=(e,k)=>qkey(e.a,q)===k?e.b:e.a;
  for(let start=0;start<edges.length;start++){
    if(used[start])continue;used[start]=1;const e0=edges[start],pts=[e0.a,e0.b];let key=qkey(e0.b,q),guard=0;
    while(guard++<edges.length+4){const cand=(byVertex.get(key)||[]).find(i=>!used[i]);if(cand===undefined)break;used[cand]=1;const e=edges[cand],next=endpoint(e,key);pts.push(next);key=qkey(next,q);if(key===qkey(pts[0],q))break}
    chains.push(pts)
  }
  return chains
}
function cadFaceBoundaries(rec,planes,{circleSegments=120}={}){
  let cached=cadBoundaryCache.get(rec);if(cached)return cached;
  const planeByKey=new Map((planes||[]).filter(p=>p.faceKey).map(p=>[p.faceKey,p])),groups=new Map();
  for(const f of rec?.faces||[]){const fk=faceKeyOf(f);let g=groups.get(fk);if(!g)groups.set(fk,g=[]);g.push(f)}
  const diag=modelDiag(rec),q=Math.max(.0015,Math.min(.03,diag*8e-6)),simplifyTol=Math.max(.018,diag*8e-5),curves=[];
  const cylinderKeys=new Set((rec?.recognition?.cylinders||[]).filter(c=>c.confidence>=.78&&c.faceKey).map(c=>c.faceKey));
  for(const [fk,faces] of groups){
    if(cylinderKeys.has(fk))continue; // exact cylinder curves/silhouettes are rebuilt separately
    const plane=planeByKey.get(fk)||null,emap=new Map();
    for(const f of faces){const loop=f.loops?.[0]||[];if(loop.length<3)continue;for(let i=0;i<loop.length;i++){const a=loop[i],b=loop[(i+1)%loop.length],k=undirectedKey(a,b,q);let x=emap.get(k);if(!x){x={a,b,count:0};emap.set(k,x)}x.count++}}
    const boundary=[...emap.values()].filter(e=>e.count===1);if(!boundary.length)continue;
    for(let pts of chainBoundaryEdges(boundary,q)){
      if(pts.length<2)continue;const closed=len(sub(pts[0],pts.at(-1)))<q*2.5;if(closed&&pts.length>3)pts=pts.slice(0,-1);
      if(plane&&closed&&pts.length>=6){
        const {u,v}=planeBasis(plane.normal),o=plane.origin,p2=pts.map(p=>[dot(sub(p,o),u),dot(sub(p,o),v)]),fit=circleFit2D(p2),coverage=fit?angularCoverage2D(p2,fit.cx,fit.cy):0;
        if(fit&&fit.radius>q*3&&fit.rms<Math.max(.025,fit.radius*.0018,diag*3e-5)&&coverage>Math.PI*1.82){
          const center=add(o,add(mul(u,fit.cx),mul(v,fit.cy))),samples=[];for(let i=0;i<=circleSegments;i++){const t=i/circleSegments*Math.PI*2;samples.push(add(center,add(mul(u,Math.cos(t)*fit.radius),mul(v,Math.sin(t)*fit.radius))))}
          curves.push({kind:'circle',role:'cad-face-boundary',points:samples,componentId:plane.componentId,faceKey:fk,source:plane,radius:fit.radius,center});continue
        }
      }
      if(plane&&!closed&&pts.length>=5){
        const arc=circularArcFromPlanarChain(pts,plane,diag,{circleSegments});
        if(arc){curves.push({kind:'arc',role:'cad-face-boundary',points:arc.points,componentId:plane.componentId,faceKey:fk,source:plane,radius:arc.radius,center:arc.center,sweep:arc.sweep});continue}
      }
      let work=closed?simplifyClosed3(pts,simplifyTol):rdp3(pts,simplifyTol);
      if(work.length>=2)curves.push({kind:closed?'loop':'polyline',role:'cad-face-boundary',points:work,componentId:faces[0]?.componentId||null,faceKey:fk,source:plane});
    }
  }
  cached=curves;cadBoundaryCache.set(rec,cached);return cached
}

/**
 * Produces a compact semantic model of the geometry we can reconstruct reliably
 * from tessellation: planes, cylinders, holes and circular hole patterns.
 */
export function reconstructAnalyticGeometry(rec){
  if(cache.has(rec))return cache.get(rec);
  const R=rec?.recognition||{};
  const cyl=[];const seen=new Set();
  for(const c of R.cylinders||[]){
    if(!c||!Number.isFinite(c.radius)||!Number.isFinite(c.length)||c.confidence<.78)continue;
    const key=cylinderKey(c);if(seen.has(key))continue;seen.add(key);
    cyl.push({
      id:`CYL-${cyl.length+1}`,kind:'cylinder',role:c.type==='hole'?'hole':(c.type==='outer'?'outer':'cylinder'),
      componentId:c.componentId||null,modelId:c.modelId||null,faceKey:c.faceKey||null,
      axis:canonicalAxis(c.axis),axisPoint:c.axisPoint.slice(),radius:c.radius,diameter:c.diameter,
      length:c.length,full:!!c.full,confidence:c.confidence,coverageRad:c.coverageRad||0
    });
  }
  // De-duplicate overlapping recognitions across nearly identical face groups.
  const cylinders=[];
  for(const c of cyl.sort((a,b)=>b.confidence-a.confidence||b.length-a.length)){
    const dup=cylinders.find(x=>x.componentId===c.componentId&&angleCos(x.axis,c.axis)>.9995&&axisDistance(x,c)<Math.max(.08,c.radius*.004)&&Math.abs(x.radius-c.radius)<Math.max(.08,c.radius*.004)&&Math.abs(x.length-c.length)<Math.max(.18,c.length*.015));
    if(!dup)cylinders.push(c);
  }
  const patterns=(R.holePatterns||[]).filter(p=>p.count>=2).map((p,i)=>({
    id:`PAT-${i+1}`,kind:'hole-pattern',componentId:p.componentId||null,axis:canonicalAxis(p.axis),diameter:p.diameter,count:p.count,
    pcd:p.pcd||null,center:p.center||null,confidence:p.confidence||0
  }));
  const planes=(R.planes||[]).filter(p=>p.confidence>=.88).map((p,i)=>({id:`PLN-${i+1}`,kind:'plane',componentId:p.componentId||null,faceKey:p.faceKey||null,normal:norm(p.normal),origin:p.origin.slice(),area:p.area||0,confidence:p.confidence}));
  const faceKeys=new Set([...cylinders.map(c=>c.faceKey),...planes.map(p=>p.faceKey)].filter(Boolean));
  const out={version:'2.7.0',source:'verified-tessellation-analytics',exactParasolid:false,cylinders,planes,patterns,recognizedFaceKeys:faceKeys,counts:{cylinders:cylinders.length,planes:planes.length,patterns:patterns.length,cadBoundaries:0}};
  cache.set(rec,out);return out;
}

export function cylinderEndpoints(c){const a=norm(c.axis),h=c.length/2;return[add(c.axisPoint,mul(a,-h)),add(c.axisPoint,mul(a,h))]}

/** Returns true when this edge belongs entirely to a recognized analytic surface. */
export function edgeIsAnalyticSurface(edge,analytic){
  if(!analytic||!edge)return false;
  const keys=edge.faceKeys||[];return keys.length>0&&keys.every(k=>analytic.recognizedFaceKeys.has(k));
}

function radialSilhouette(axis,viewDir){
  const r=cross(axis,viewDir);return len(r)>1e-8?norm(r):null;
}

/**
 * Build 3D engineering curves for a recognized cylinder in a view.
 * Curves are line/polyline primitives so the drawing renderer can run the same HLR oracle.
 */
export function cylinderViewCurves(c,viewDir,{circleSegments=96}={}){
  const a=norm(c.axis),d=norm(viewDir),ad=Math.abs(dot(a,d)),[p0,p1]=cylinderEndpoints(c),out=[];
  if(ad>.985){
    // End-on: draw the front rim only. It is an exact circle in projection.
    const front=dot(p1,d)>=dot(p0,d)?p1:p0;
    let u=cross(a,Math.abs(a[2])<.8?[0,0,1]:[1,0,0]);u=norm(u);const v=norm(cross(a,u));
    const pts=[];for(let i=0;i<=circleSegments;i++){const t=i/circleSegments*Math.PI*2;pts.push(add(front,add(mul(u,Math.cos(t)*c.radius),mul(v,Math.sin(t)*c.radius))))}
    out.push({kind:'circle',role:c.role,points:pts,componentId:c.componentId,source:c});
    return out;
  }
  if(ad<.12){
    // Side-on: exact cylinder silhouette is two generators. End rims are straight segments.
    const r=radialSilhouette(a,d);if(!r)return out;
    const q0p=add(p0,mul(r,c.radius)),q1p=add(p1,mul(r,c.radius)),q0m=add(p0,mul(r,-c.radius)),q1m=add(p1,mul(r,-c.radius));
    out.push({kind:'line',role:c.role,points:[q0p,q1p],componentId:c.componentId,source:c});
    out.push({kind:'line',role:c.role,points:[q0m,q1m],componentId:c.componentId,source:c});
    out.push({kind:'line',role:'rim',points:[q0p,q0m],componentId:c.componentId,source:c});
    out.push({kind:'line',role:'rim',points:[q1p,q1m],componentId:c.componentId,source:c});
    return out;
  }
  // Oblique: retain a smooth sampled silhouette rather than tessellation chords.
  const r=radialSilhouette(a,d);if(!r)return out;
  out.push({kind:'line',role:c.role,points:[add(p0,mul(r,c.radius)),add(p1,mul(r,c.radius))],componentId:c.componentId,source:c});
  out.push({kind:'line',role:c.role,points:[add(p0,mul(r,-c.radius)),add(p1,mul(r,-c.radius))],componentId:c.componentId,source:c});
  // Elliptic projected rims are represented by actual 3D circles and become ellipses after projection.
  let u=cross(a,Math.abs(a[2])<.8?[0,0,1]:[1,0,0]);u=norm(u);const v=norm(cross(a,u));
  for(const center of [p0,p1]){const pts=[];for(let i=0;i<=circleSegments;i++){const t=i/circleSegments*Math.PI*2;pts.push(add(center,add(mul(u,Math.cos(t)*c.radius),mul(v,Math.sin(t)*c.radius))))}out.push({kind:'circle',role:'rim',points:pts,componentId:c.componentId,source:c})}
  return out;
}


/** Exact section curves for recognized finite cylinders. Supports perpendicular, axial and oblique cuts. */
export function analyticSectionCurves(rec,planePoint,planeNormal,{circleSegments=128,minConfidence=.78}={}){
  const A=reconstructAnalyticGeometry(rec),n=norm(planeNormal),out=[];
  for(const c of A.cylinders){
    if(c.confidence<minConfidence)continue;const a=norm(c.axis),den=dot(a,n),ad=Math.abs(den),h=c.length/2;
    if(ad>.985){
      const t=dot(sub(planePoint,c.axisPoint),n)/den;if(Math.abs(t)>h+.02)continue;const center=add(c.axisPoint,mul(a,t));let u=cross(a,Math.abs(a[2])<.8?[0,0,1]:[1,0,0]);u=norm(u);const v=norm(cross(a,u)),pts=[];
      for(let i=0;i<=circleSegments;i++){const q=i/circleSegments*Math.PI*2;pts.push(add(center,add(mul(u,Math.cos(q)*c.radius),mul(v,Math.sin(q)*c.radius))))}
      out.push({kind:'circle',role:'section-cylinder',points:pts,componentId:c.componentId,faceKey:c.faceKey,source:c});continue;
    }
    if(ad<.12){
      const dist=dot(sub(c.axisPoint,planePoint),n);if(Math.abs(dist)>=c.radius-.001)continue;const m=norm(cross(a,n)),off=Math.sqrt(Math.max(0,c.radius*c.radius-dist*dist)),base=mul(n,-dist),p0=add(c.axisPoint,mul(a,-h)),p1=add(c.axisPoint,mul(a,h));
      for(const sg of [1,-1]){const r=add(base,mul(m,sg*off));out.push({kind:'line',role:'section-cylinder',points:[add(p0,r),add(p1,r)],componentId:c.componentId,faceKey:c.faceKey,source:c})}continue;
    }
    // Oblique plane: parameterize the cylinder and solve the plane equation for axial t.
    let u=cross(a,Math.abs(a[2])<.8?[0,0,1]:[1,0,0]);u=norm(u);const v=norm(cross(a,u)),samples=[],runs=[];
    for(let i=0;i<=circleSegments;i++){
      const q=i/circleSegments*Math.PI*2,rad=add(mul(u,Math.cos(q)*c.radius),mul(v,Math.sin(q)*c.radius)),t=-dot(sub(add(c.axisPoint,rad),planePoint),n)/den;
      const p=Math.abs(t)<=h+.001?add(add(c.axisPoint,rad),mul(a,t)):null;
      if(p)samples.push(p);else if(samples.length){if(samples.length>1)runs.push(samples.splice(0));else samples.length=0}
    }
    if(samples.length>1)runs.push(samples);for(const pts of runs)out.push({kind:'ellipse-arc',role:'section-cylinder',points:pts,componentId:c.componentId,faceKey:c.faceKey,source:c});
  }
  return{analytic:A,curves:out};
}



// --- v2.7.0 Helical / spline feature reconstruction ---------------------------------
// FaceTessellations often preserves the boundary of a swept helical plate very well even
// when it does not expose the original SolidWorks spline/helix entity.  Reconstruct those
// boundaries analytically instead of drawing hundreds of tessellation chords.
function dominantAssemblyAxisFrame(rec){
  const size=rec?.bounds?.size||[1,1,1];let i=0;if(size[1]>size[i])i=1;if(size[2]>size[i])i=2;
  let axis=[0,0,0];axis[i]=1;let axisPoint=rec?.bounds?.center?.slice?.()||[0,0,0];
  const major=size[i]||1,minor=Math.max(...size.filter((_,j)=>j!==i),1);
  const candidates=(rec?.recognition?.outerCylinders||[]).filter(c=>c.full&&c.length>major*.62&&c.diameter<minor*.28&&Math.abs(dot(norm(c.axis),axis))>.985).sort((a,b)=>b.length-a.length||b.confidence-a.confidence);
  if(candidates[0]){axis=canonicalAxis(candidates[0].axis);axisPoint=candidates[0].axisPoint.slice()}
  const {u,v}=planeBasis(axis);return{axis,axisPoint,u,v,major,minor};
}
function unwrapRunAngles(run){
  const out=[];let prev=null,acc=0;
  for(const q of run){let a=q.angle;if(prev!==null){let d=a-prev;while(d>Math.PI)d-=Math.PI*2;while(d<-Math.PI)d+=Math.PI*2;acc+=d}else acc=a;out.push(acc);prev=a}
  return out;
}
function fitHelicalRun(run){
  if(run.length<8)return null;const A=unwrapRunAngles(run),T=run.map(q=>q.t),R=run.map(q=>q.radius),n=run.length;
  const tm=T.reduce((a,b)=>a+b,0)/n,am=A.reduce((a,b)=>a+b,0)/n,rm=R.reduce((a,b)=>a+b,0)/n;
  let stt=0,sta=0;for(let i=0;i<n;i++){const dt=T[i]-tm;stt+=dt*dt;sta+=dt*(A[i]-am)}if(stt<1e-8)return null;
  const k=sta/stt,b=am-k*tm,angleRms=Math.sqrt(A.reduce((s,a,i)=>s+(a-(k*T[i]+b))**2,0)/n),radiusRms=Math.sqrt(R.reduce((s,r)=>s+(r-rm)**2,0)/n),tmin=Math.min(...T),tmax=Math.max(...T),span=tmax-tmin,pitch=Math.PI*2/Math.abs(k||1e-12);
  return{k,b,radius:rm,radiusRms,angleRms,tmin,tmax,span,pitch,sweep:k*span};
}
function splitHelicalRuns(points,frame){
  const raw=points.map(p=>{const d=sub(p,frame.axisPoint),x=dot(d,frame.u),y=dot(d,frame.v);return{p,t:dot(d,frame.axis),radius:Math.hypot(x,y),angle:Math.atan2(y,x)}}),runs=[];
  let start=0;
  for(let i=1;i<=raw.length;i++){
    let split=i===raw.length;
    if(!split){
      const radialJump=Math.abs(raw[i].radius-raw[i-1].radius)>Math.max(3.5,frame.minor*.012);
      const radialDrift=i-start>5&&Math.abs(raw[i].radius-raw[start].radius)>Math.max(3.5,frame.minor*.012);
      const dtPrev=i>=2?raw[i-1].t-raw[i-2].t:0,dtNow=raw[i].t-raw[i-1].t;
      const reverse=i-start>7&&Math.abs(dtPrev)>.35&&Math.abs(dtNow)>.35&&dtPrev*dtNow<0;
      split=radialJump||radialDrift||reverse;
    }
    if(split){if(i-start>=8)runs.push(raw.slice(start,i));start=i}
  }
  return runs;
}
function helicalFeatureCurves(rec,boundaries,{samplesPerTurn=96}={}){
  const frame=dominantAssemblyAxisFrame(rec),accepted=[],suppressedComponents=new Set(),candidateFaceKeys=new Set();
  if(frame.major/frame.minor<1.7)return{curves:[],suppressedComponents,candidateFaceKeys,count:0};
  for(const curve of boundaries){
    const pts=curve.points||[];if(pts.length<20)continue;
    for(const run of splitHelicalRuns(pts,frame)){
      const fit=fitHelicalRun(run);if(!fit)continue;
      const minSpan=Math.max(24,frame.minor*.055),maxRadius=frame.minor*.53,minRadius=frame.minor*.12;
      if(fit.span<minSpan||fit.radius<minRadius||fit.radius>maxRadius)continue;
      if(fit.radiusRms>Math.max(.55,fit.radius*.006)||fit.angleRms>.045)continue;
      if(Math.abs(fit.sweep)<.55||fit.pitch<frame.minor*.18||fit.pitch>frame.major*1.8)continue;
      // Dense smooth reconstruction of the centerline of this CAD helical edge.
      const turns=Math.abs(fit.sweep)/(Math.PI*2),count=Math.max(18,Math.ceil(turns*samplesPerTurn)),points=[];
      for(let i=0;i<=count;i++){
        const t=fit.tmin+(fit.tmax-fit.tmin)*i/count,ang=fit.k*t+fit.b;
        points.push(add(frame.axisPoint,add(mul(frame.axis,t),add(mul(frame.u,Math.cos(ang)*fit.radius),mul(frame.v,Math.sin(ang)*fit.radius)))));
      }
      accepted.push({kind:'helix',role:'helical-feature-boundary',points,componentId:curve.componentId,faceKey:curve.faceKey,source:curve,pitch:fit.pitch,radius:fit.radius,tmin:fit.tmin,tmax:fit.tmax,k:fit.k,b:fit.b,fitError:fit.angleRms});
      if(curve.componentId)suppressedComponents.add(curve.componentId);if(curve.faceKey)candidateFaceKeys.add(curve.faceKey);
    }
  }
  // Merge duplicate runs emitted by opposite tessellated faces of the same sheet-metal edge.
  accepted.sort((a,b)=>Math.abs(b.tmax-b.tmin)-Math.abs(a.tmax-a.tmin));const unique=[];
  for(const h of accepted){
    const dup=unique.find(x=>x.componentId===h.componentId&&Math.abs(x.radius-h.radius)<1.2&&Math.abs(x.pitch-h.pitch)<2.5&&Math.abs(x.tmin-h.tmin)<4&&Math.abs(x.tmax-h.tmax)<4&&Math.sign(x.k)===Math.sign(h.k));
    if(!dup)unique.push(h);
  }
  // Rebuild radial end edges of plate-like helical components from paired inner/outer helices.
  const connectors=[];const byComp=new Map();for(const h of unique){let a=byComp.get(h.componentId);if(!a)byComp.set(h.componentId,a=[]);a.push(h)}
  for(const [componentId,list] of byComp){
    for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++){
      const a=list[i],b=list[j];if(Math.abs(a.radius-b.radius)<Math.max(8,frame.minor*.06))continue;
      if(Math.abs(a.pitch-b.pitch)>3||Math.sign(a.k)!==Math.sign(b.k))continue;
      const lo=Math.max(a.tmin,b.tmin),hi=Math.min(a.tmax,b.tmax);if(hi-lo<Math.max(18,frame.minor*.04))continue;
      for(const t of [lo,hi]){
        const pa=add(frame.axisPoint,add(mul(frame.axis,t),add(mul(frame.u,Math.cos(a.k*t+a.b)*a.radius),mul(frame.v,Math.sin(a.k*t+a.b)*a.radius))));
        const pb=add(frame.axisPoint,add(mul(frame.axis,t),add(mul(frame.u,Math.cos(b.k*t+b.b)*b.radius),mul(frame.v,Math.sin(b.k*t+b.b)*b.radius))));
        if(len(sub(pa,pb))<frame.minor*.42)connectors.push({kind:'line',role:'helical-feature-end',points:[pa,pb],componentId,source:null});
      }
    }
  }
  return{curves:unique.concat(connectors),suppressedComponents,candidateFaceKeys,count:unique.length,connectorCount:connectors.length,frame};
}

export function analyticViewCurves(rec,viewDir,options={}){
  const A=reconstructAnalyticGeometry(rec),out=[];
  for(const c of A.cylinders){
    if(c.confidence<(options.minConfidence??.82))continue;
    if(!c.full&&(c.coverageRad||0)<Math.PI*1.45)continue;
    out.push(...cylinderViewCurves(c,viewDir,options));
  }
  const boundaries=cadFaceBoundaries(rec,A.planes,{circleSegments:options.circleSegments||120});
  const helical=helicalFeatureCurves(rec,boundaries,{samplesPerTurn:options.detail?128:96});
  // For components with a verified helix fit, replace long noisy tessellation boundary loops by
  // the smooth reconstructed feature curves. Keep compact end/planar boundaries as context.
  const filtered=boundaries.filter(c=>{
    if(!helical.suppressedComponents.has(c.componentId))return true;
    const pts=c.points||[];if(pts.length<18)return true;
    let min=Infinity,max=-Infinity;const frame=helical.frame;for(const p of pts){const t=dot(sub(p,frame.axisPoint),frame.axis);min=Math.min(min,t);max=Math.max(max,t)}
    return max-min<Math.max(20,frame.minor*.045);
  });
  out.push(...filtered,...helical.curves);
  for(const c of filtered)if(c.faceKey)A.recognizedFaceKeys.add(c.faceKey);
  for(const c of helical.curves)if(c.faceKey)A.recognizedFaceKeys.add(c.faceKey);
  A.counts.cadBoundaries=filtered.length;A.counts.helicalCurves=helical.count;A.counts.helicalConnectors=helical.connectorCount;
  return{analytic:A,curves:out};
}
