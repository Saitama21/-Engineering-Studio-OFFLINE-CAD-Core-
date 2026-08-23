// ROZFOOD Engineering Studio v5.0.0 — Surface Trimming & Exact Boundary Core
// Reconstructs trimmed parameter domains of analytic surfaces from the original
// FaceTessellations triangles.  It does not claim native Parasolid B-Rep; the
// tessellation is used only as trim-domain evidence while geometry stays analytic.

import {reconstructSurfaceModel} from './surface-type-reconstruction.js';

const TAU=Math.PI*2;
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
function diag(rec){return Math.hypot(...(rec?.bounds?.size||[1,1,1]))||1}
function basis(axis){const a=norm(axis),seed=Math.abs(a[2])<.82?[0,0,1]:[1,0,0],u=norm(cross(a,seed)),v=norm(cross(a,u));return{a,u,v}}
function typeOf(s){return s?.type==='plane-inferred'?'plane':s?.type}
function groupFaces(rec){const m=new Map();for(const f of rec?.faces||[]){const k=faceKeyOf(f);let a=m.get(k);if(!a)m.set(k,a=[]);a.push(f)}return m}
function groupPoints(faces){const out=[];for(const f of faces||[])for(const loop of f.loops||[])for(const p of loop||[])out.push(p);return out}

function pointInTri2(p,a,b,c,eps=1e-9){
  const v0=[c[0]-a[0],c[1]-a[1]],v1=[b[0]-a[0],b[1]-a[1]],v2=[p[0]-a[0],p[1]-a[1]];
  const d00=v0[0]*v0[0]+v0[1]*v0[1],d01=v0[0]*v1[0]+v0[1]*v1[1],d02=v0[0]*v2[0]+v0[1]*v2[1],d11=v1[0]*v1[0]+v1[1]*v1[1],d12=v1[0]*v2[0]+v1[1]*v2[1];
  const den=d00*d11-d01*d01;if(Math.abs(den)<1e-18)return false;const inv=1/den,u=(d11*d02-d01*d12)*inv,v=(d00*d12-d01*d02)*inv;
  return u>=-eps&&v>=-eps&&u+v<=1+eps;
}
function unwrapTriTheta(uv){
  const out=uv.map(x=>x.slice());
  for(let i=1;i<out.length;i++){while(out[i][0]-out[0][0]>Math.PI)out[i][0]-=TAU;while(out[i][0]-out[0][0]<-Math.PI)out[i][0]+=TAU}
  return out;
}
function uvBounds(tris){let u0=Infinity,u1=-Infinity,v0=Infinity,v1=-Infinity;for(const t of tris)for(const p of t.uv){u0=Math.min(u0,p[0]);u1=Math.max(u1,p[0]);v0=Math.min(v0,p[1]);v1=Math.max(v1,p[1])}return{u0,u1,v0,v1}}

function mapperFor(surface,faces){
  const t=typeOf(surface),pts=groupPoints(faces);if(!pts.length)return null;
  if(t==='plane'){
    const n=norm(surface.params?.normal||surface.normal||[0,0,1]),o=surface.params?.origin||pts[0],{u,v}=basis(n);
    return{periodicU:false,map:p=>{const d=sub(p,o);return[dot(d,u),dot(d,v)]},basis:{o,u,v,n}};
  }
  if(t==='cylinder'||t==='cone-inferred'||t==='torus-inferred'||t==='sphere-inferred'){
    const a=norm(surface.params?.axis||surface.normal||[1,0,0]),o=surface.params?.axisPoint||pts[0],B=basis(a);
    if(t==='torus-inferred'){
      const tc=surface.params?.centerT||0,R=surface.params?.majorRadius||0;return{periodicU:true,map:p=>{const d=sub(p,o),ax=dot(d,B.a),rv=sub(d,mul(B.a,ax)),theta=Math.atan2(dot(rv,B.v),dot(rv,B.u)),rho=len(rv),phi=Math.atan2(ax-tc,rho-R);return[theta,phi]},basis:{...B,o}};
    }
    if(t==='sphere-inferred'){
      const c=surface.params?.center||o,r=surface.params?.radius||1,S=basis([0,0,1]);return{periodicU:true,map:p=>{const d=sub(p,c),rr=len(d)||r,theta=Math.atan2(dot(d,S.v),dot(d,S.u)),phi=Math.asin(clamp(dot(d,S.a)/rr,-1,1));return[theta,phi]},basis:{...S,o:c}};
    }
    return{periodicU:true,map:p=>{const d=sub(p,o),ax=dot(d,B.a),rv=sub(d,mul(B.a,ax));return[Math.atan2(dot(rv,B.v),dot(rv,B.u)),ax]},basis:{...B,o}};
  }
  return null;
}

function buildDomain(surface,faces,D){
  const mapper=mapperFor(surface,faces);if(!mapper)return null;const tris=[];
  for(const f of faces||[])for(const loop of f.loops||[]){if(loop.length<3)continue;const anchor=loop[0];for(let i=1;i<loop.length-1;i++){
    let uv=[mapper.map(anchor),mapper.map(loop[i]),mapper.map(loop[i+1])];if(mapper.periodicU)uv=unwrapTriTheta(uv);const area=Math.abs((uv[1][0]-uv[0][0])*(uv[2][1]-uv[0][1])-(uv[1][1]-uv[0][1])*(uv[2][0]-uv[0][0]))*.5;if(area<1e-14)continue;tris.push({uv,points:[anchor,loop[i],loop[i+1]]});
  }}
  if(!tris.length)return null;const bounds=uvBounds(tris),epsUV=Math.max(1e-8,(bounds.u1-bounds.u0+bounds.v1-bounds.v0)*2e-6);
  return{faceKey:surface.faceKey,componentId:surface.componentId,surfaceType:typeOf(surface),mapper,tris,bounds,periodicU:mapper.periodicU,epsUV,source:'FaceTessellations trim-domain evidence'};
}

export function reconstructSurfaceTrims(rec){
  const M=reconstructSurfaceModel(rec),sig=[rec?.faces?.length||0,M.counts?.surfaces||0,M.counts?.cones||0,M.counts?.tori||0].join('|');const hit=cache.get(rec);if(hit?.sig===sig)return hit.result;
  const groups=groupFaces(rec),D=diag(rec),domains=new Map();let triangles=0,analyticDomains=0,periodicDomains=0;
  for(const [fk,s] of M.surfaces){const d=buildDomain(s,groups.get(fk)||[],D);if(!d)continue;domains.set(fk,d);triangles+=d.tris.length;analyticDomains++;if(d.periodicU)periodicDomains++}
  const result={version:'9.0.0',kernel:'ROZFOOD Surface Trimming & Exact Boundary Core',domains,counts:{domains:domains.size,analyticDomains,periodicDomains,trimTriangles:triangles},exactParasolid:false,source:'analytic surfaces + tessellation trim evidence'};
  cache.set(rec,{sig,result});rec.surfaceTrims=result;return result;
}

export function pointInsideSurfaceTrim(rec,surfaceOrKey,p,{epsilonScale=1}={}){
  const T=reconstructSurfaceTrims(rec),key=typeof surfaceOrKey==='string'?surfaceOrKey:surfaceOrKey?.faceKey,d=T.domains.get(key);if(!d)return true;const uv=d.mapper.map(p),eps=d.epsUV*epsilonScale;
  const candidates=d.periodicU?[uv,[uv[0]+TAU,uv[1]],[uv[0]-TAU,uv[1]]]:[uv];
  for(const q of candidates){if(q[0]<d.bounds.u0-eps||q[0]>d.bounds.u1+eps||q[1]<d.bounds.v0-eps||q[1]>d.bounds.v1+eps)continue;for(const tri of d.tris)if(pointInTri2(q,tri.uv[0],tri.uv[1],tri.uv[2],eps))return true}
  return false;
}

function nearestSourceDistance(p,src){let best=Infinity;for(const q of src||[])best=Math.min(best,len(sub(p,q)));return best}
function splitRuns(points,keep,minRun=2){const runs=[];let r=[];for(let i=0;i<points.length;i++){if(keep[i])r.push(points[i]);else if(r.length){if(r.length>=minRun)runs.push(r);r=[]}}if(r.length>=minRun)runs.push(r);return runs}
function classifyKind(base,pts){if(base==='circle')return 'arc';if(base==='line'&&pts.length>=2)return 'line';return base==='ellipse-arc'?'ellipse-arc':base==='conic-intersection'?'conic-intersection':base==='intersection-curve'?'intersection-curve':'polyline'}

/**
 * Clips an analytically reconstructed intersection to the true trimmed domains of
 * both source surfaces.  Multiple disjoint pieces are returned when holes/partial
 * faces split one mathematical intersection.
 */
export function trimSurfaceIntersectionPrimitive(rec,primitive,A,B,{sourcePoints=[],sourceTolerance=null}={}){
  if(!primitive?.points?.length)return[];const D=diag(rec),tol=sourceTolerance??Math.max(.35,D*9e-4),pts=primitive.points,keep=[];
  for(const p of pts){let ok=pointInsideSurfaceTrim(rec,A,p,{epsilonScale:8})&&pointInsideSurfaceTrim(rec,B,p,{epsilonScale:8});
    // Source boundary evidence selects the correct branch when a mathematical pair
    // has multiple possible intersections (e.g. two cylinder/cone branches).
    if(ok&&sourcePoints.length>=2)ok=nearestSourceDistance(p,sourcePoints)<=tol*3.5;
    keep.push(ok);
  }
  let runs=splitRuns(pts,keep,2);
  // A closed periodic curve may cross the array seam; join the first/last kept runs.
  if(runs.length>1&&keep[0]&&keep.at(-1)){const merged=runs.at(-1).concat(runs[0].slice(1));runs=[merged,...runs.slice(1,-1)]}
  // Conservative fallback: trimming should never erase a source-supported curve entirely.
  if(!runs.length&&sourcePoints.length>=2)return[{...primitive,trimmed:false,trimFallback:true}];
  return runs.map((r,i)=>({...primitive,kind:runs.length===1&&r.length===pts.length?primitive.kind:classifyKind(primitive.kind,r),points:r,full:false,trimmed:true,trimPiece:i,trimPieceCount:runs.length}));
}

export function surfaceTrimStats(rec){const T=reconstructSurfaceTrims(rec);return{version:T.version,kernel:T.kernel,...T.counts,exactParasolid:false}}
