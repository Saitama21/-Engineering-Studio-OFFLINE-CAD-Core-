// ROZFOOD Engineering Studio v2.3.0 — Analytic Geometry Reconstruction Core
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

function canonicalAxis(a){a=norm(a);const i=Math.abs(a[0])>.01?0:Math.abs(a[1])>.01?1:2;return a[i]<0?mul(a,-1):a}
function axisDistance(a,b){const ax=norm(a.axis),d=sub(b.axisPoint,a.axisPoint);return len(sub(d,mul(ax,dot(d,ax))))}
function angleCos(a,b){return Math.abs(dot(norm(a),norm(b)))}
function cylinderKey(c){const a=canonicalAxis(c.axis),p=c.axisPoint||[0,0,0];return [c.componentId||'RAW',...a.map(v=>Math.round(v*1000)),...p.map(v=>Math.round(v*20)),Math.round(c.radius*100),Math.round(c.length*20)].join('|')}

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
  const faceKeys=new Set(cylinders.map(c=>c.faceKey).filter(Boolean));
  const patterns=(R.holePatterns||[]).filter(p=>p.count>=2).map((p,i)=>({
    id:`PAT-${i+1}`,kind:'hole-pattern',componentId:p.componentId||null,axis:canonicalAxis(p.axis),diameter:p.diameter,count:p.count,
    pcd:p.pcd||null,center:p.center||null,confidence:p.confidence||0
  }));
  const planes=(R.planes||[]).filter(p=>p.confidence>=.88).map((p,i)=>({id:`PLN-${i+1}`,kind:'plane',componentId:p.componentId||null,faceKey:p.faceKey||null,normal:norm(p.normal),origin:p.origin.slice(),area:p.area||0,confidence:p.confidence}));
  const out={version:'2.3.0',source:'verified-tessellation-analytics',exactParasolid:false,cylinders,planes,patterns,recognizedFaceKeys:faceKeys,counts:{cylinders:cylinders.length,planes:planes.length,patterns:patterns.length}};
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

export function analyticViewCurves(rec,viewDir,options={}){
  const A=reconstructAnalyticGeometry(rec),out=[];
  for(const c of A.cylinders){
    if(c.confidence<(options.minConfidence??.82))continue;
    // Partial cylinders are risky: only replace the tessellation when angular coverage is substantial.
    if(!c.full&&(c.coverageRad||0)<Math.PI*1.45)continue;
    out.push(...cylinderViewCurves(c,viewDir,options));
  }
  return{analytic:A,curves:out};
}
