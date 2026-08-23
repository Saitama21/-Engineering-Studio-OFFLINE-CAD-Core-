// ROZFOOD Engineering Studio v5.0.0 — Tangency & Surface Continuity Core
// Detects smooth G1 boundaries from source FaceTessellations and applies a conservative
// drawing policy: smooth fillet tangency boundaries are removed, while the true fillet
// silhouette is reconstructed analytically for the active view.

const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const mul=(a,s)=>[a[0]*s,a[1]*s,a[2]*s];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const len=a=>Math.hypot(a[0],a[1],a[2]);
const norm=a=>{const L=len(a)||1;return[a[0]/L,a[1]/L,a[2]/L]};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const cache=new WeakMap();

function faceKeyOf(f){return[f.componentId||'RAW',f.modelId||'',f.sourceStream||'',f.tessFaceId??''].join('|')}
function faceNormal(f){
  const ns=f?.normals||[];if(ns.length){let s=[0,0,0];for(const n of ns)s=add(s,n);if(len(s)>1e-9)return norm(s)}
  const p=f?.loops?.[0]||[];return p.length>=3?norm(cross(sub(p[1],p[0]),sub(p[2],p[0]))):[0,0,1];
}
function modelDiag(rec){return Math.hypot(...(rec?.bounds?.size||[1,1,1]))||1}
function qpt(p,q){return p.map(v=>Math.round(v/q)).join(',')}
function edgeKey(a,b,q){const aa=qpt(a,q),bb=qpt(b,q);return aa<bb?aa+'|'+bb:bb+'|'+aa}
function pairKey(a,b){return a<b?a+'||'+b:b+'||'+a}
function basis(axis){const a=norm(axis),seed=Math.abs(a[2])<.82?[0,0,1]:[1,0,0],u=norm(cross(a,seed)),v=norm(cross(a,u));return{a,u,v}}
function angleDiff(a,b){let d=(a-b)%(Math.PI*2);if(d>Math.PI)d-=Math.PI*2;if(d<-Math.PI)d+=Math.PI*2;return d}
function angleOnSweep(theta,start,sweep,tol=.025){
  if(sweep>=0){let d=theta-start;while(d<0)d+=Math.PI*2;while(d>=Math.PI*2)d-=Math.PI*2;return d<=sweep+tol}
  let d=start-theta;while(d<0)d+=Math.PI*2;while(d>=Math.PI*2)d-=Math.PI*2;return d<=-sweep+tol;
}

/**
 * Builds source-face adjacency only along true FaceTessellations face boundaries.
 * The result is used as evidence, not as native Parasolid continuity metadata.
 */
export function analyzeSurfaceContinuity(rec,{g1AngleDeg=7,nearAngleDeg=14}={}){
  if(cache.has(rec))return cache.get(rec);
  const q=Math.max(.0015,Math.min(.035,modelDiag(rec)*8e-6)),faceGroups=new Map();
  for(const f of rec?.faces||[]){
    const fk=faceKeyOf(f),componentId=f.componentId||'RAW';let g=faceGroups.get(fk);
    if(!g){g={faceKey:fk,componentId,edges:new Map()};faceGroups.set(fk,g)}
    const loop=f.loops?.[0]||[];if(loop.length<3)continue;const n=faceNormal(f);
    for(let i=0;i<loop.length;i++){
      const a=loop[i],b=loop[(i+1)%loop.length];if(!a||!b||len(sub(a,b))<q*.1)continue;
      const k=edgeKey(a,b,q);let e=g.edges.get(k);if(!e){e={a,b,count:0,normals:[]};g.edges.set(k,e)}e.count++;e.normals.push(n);
    }
  }
  const global=new Map();
  for(const g of faceGroups.values())for(const [k,e] of g.edges){
    if(e.count!==1)continue; // internal triangulation chord of one source face
    let n=[0,0,0];for(const z of e.normals)n=add(n,z);n=norm(n);
    const kk=g.componentId+'|'+k;let a=global.get(kk);if(!a){a=[];global.set(kk,a)}a.push({faceKey:g.faceKey,componentId:g.componentId,normal:n,a:e.a,b:e.b});
  }
  const pairs=new Map(),g1FacePairs=new Set(),nearFacePairs=new Set();let sharedBoundaries=0,g1Boundaries=0,nearBoundaries=0,sharpBoundaries=0;
  for(const entries of global.values()){
    if(entries.length<2)continue;
    for(let i=0;i<entries.length;i++)for(let j=i+1;j<entries.length;j++){
      const A=entries[i],B=entries[j];if(A.faceKey===B.faceKey)continue;sharedBoundaries++;
      const cos=clamp(Math.abs(dot(A.normal,B.normal)),-1,1),angleDeg=Math.acos(cos)*180/Math.PI,pk=pairKey(A.faceKey,B.faceKey);
      const kind=angleDeg<=g1AngleDeg?'G1':angleDeg<=nearAngleDeg?'NEAR_G1':'G0';
      const old=pairs.get(pk);if(!old||angleDeg<old.angleDeg)pairs.set(pk,{faceA:A.faceKey,faceB:B.faceKey,componentId:A.componentId,kind,angleDeg,cos});
      if(kind==='G1'){g1FacePairs.add(pk);g1Boundaries++}else if(kind==='NEAR_G1'){nearFacePairs.add(pk);nearBoundaries++}else sharpBoundaries++;
    }
  }
  const result={version:'4.0.0',kernel:'ROZFOOD Tangency & Surface Continuity Core',exactParasolid:false,source:'FaceTessellations boundary-normal continuity evidence',quantization:q,pairs,g1FacePairs,nearFacePairs,counts:{sourceFaces:faceGroups.size,sharedBoundaries,g1Boundaries,nearBoundaries,sharpBoundaries}};
  cache.set(rec,result);return result;
}

function filletSilhouettes(features,viewDir){
  const d=norm(viewDir),out=[];
  for(const f of features?.fillets||[]){
    if(!f?.verified||!(f.radius>0)||!(f.length>0))continue;
    const B={u:f.basisU,v:f.basisV},du=dot(B.u,d),dv=dot(B.v,d);
    if(Math.hypot(du,dv)<1e-8)continue; // view along fillet axis: end arcs carry the shape
    const base=Math.atan2(-du,dv),candidates=[base,base+Math.PI];
    for(const theta of candidates){
      if(!angleOnSweep(theta,f.angleStart,f.sweepRad,.035))continue;
      const radial=add(mul(B.u,Math.cos(theta)*f.radius),mul(B.v,Math.sin(theta)*f.radius));
      const p0=add(add(f.axisPoint,mul(f.axis,f.tmin)),radial),p1=add(add(f.axisPoint,mul(f.axis,f.tmax)),radial);
      if(len(sub(p1,p0))<.05)continue;
      out.push({kind:'line',role:'fillet-silhouette',continuity:'SILHOUETTE',featureKind:'fillet',featureId:f.id,points:[p0,p1],componentId:f.componentId,faceKey:f.faceKey,source:f});
    }
  }
  return out;
}

/**
 * Default production-drawing policy is "tangent edges removed". We preserve true feature
 * outlines and add the analytical silhouette of the fillet patch so removing tangency lines
 * cannot erase the rounded external form.
 */
export function applySurfaceContinuityPolicy(curves,rec,viewDir,{tangentMode='removed'}={}){
  const continuity=analyzeSurfaceContinuity(rec),features=rec?.cadFeatures||rec?.analyticGeometry?.featureEntities||null;
  const input=curves||[],out=[];let tangentCandidates=0,tangentRemoved=0;
  for(const c of input){
    const tangent=c.role==='fillet-tangent-edge'||c.continuity==='G1';
    if(tangent)tangentCandidates++;
    if(tangent&&tangentMode==='removed'){tangentRemoved++;continue}
    out.push(tangent&&tangentMode==='font'?{...c,role:'tangent-edge-font',continuity:'G1'}:c);
  }
  const silhouettes=filletSilhouettes(features,viewDir);out.push(...silhouettes);
  return{curves:out,continuity,stats:{tangentMode,tangentCandidates,tangentRemoved,filletSilhouettes:silhouettes.length,g1Boundaries:continuity.counts.g1Boundaries,nearBoundaries:continuity.counts.nearBoundaries}};
}

export function surfaceContinuityStats(rec){return analyzeSurfaceContinuity(rec).counts}
