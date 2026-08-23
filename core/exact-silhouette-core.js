// ROZFOOD Engineering Studio v6.0.0 — Exact Silhouette Core
// Builds view-dependent silhouette curves directly on reconstructed analytic surfaces.
// FaceTessellations are used only as trim-domain evidence; silhouette geometry is analytic.

import {reconstructSurfaceModel} from './surface-type-reconstruction.js';
import {reconstructSurfaceTrims,pointInsideSurfaceTrim} from './surface-trimming-core.js';
import {recognizeTessellationGeometry} from './tess-recognition.js';

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

function basis(axis){const a=norm(axis),seed=Math.abs(a[2])<.82?[0,0,1]:[1,0,0],u=norm(cross(a,seed)),v=norm(cross(a,u));return{a,u,v}}
function typeOf(s){return s?.type==='plane-inferred'?'plane':s?.type}
function dirKey(d){return norm(d).map(v=>v.toFixed(5)).join(',')}
function diag(rec){return Math.hypot(...(rec?.bounds?.size||[1,1,1]))||1}
function splitKeptRuns(points,keep,minRun=2){const runs=[];let r=[];for(let i=0;i<points.length;i++){if(keep[i])r.push(points[i]);else if(r.length){if(r.length>=minRun)runs.push(r);r=[]}}if(r.length>=minRun)runs.push(r);return runs}
function trimRun(rec,s,pts){if(!pts.length)return[];const keep=pts.map(p=>pointInsideSurfaceTrim(rec,s,p,{epsilonScale:10}));return splitKeptRuns(pts,keep,2)}
function radialDir(B,theta){return add(mul(B.u,Math.cos(theta)),mul(B.v,Math.sin(theta)))}
function normalizedTheta(x){x%=TAU;if(x<0)x+=TAU;return x}

function cylinderSilhouettes(rec,s,d,{samples=64}={}){
  const p=s.params||{},a=norm(p.axis||[1,0,0]),o=p.axisPoint||[0,0,0],r=Number(p.radius)||0,L=Number(p.length)||0;
  if(!(r>0&&L>0))return[];const c=cross(a,d),cl=len(c);if(cl<1e-8)return[];const R=norm(c),out=[];
  for(const sign of [1,-1]){const rv=mul(R,r*sign),pts=[];for(let i=0;i<=samples;i++){const t=-L/2+L*i/samples;pts.push(add(add(o,mul(a,t)),rv))}for(const run of trimRun(rec,s,pts))out.push({kind:'line',role:'surface-silhouette',silhouette:true,surfaceType:'cylinder',faceKey:s.faceKey,componentId:s.componentId,points:run,sourceSurface:s})}
  return out;
}

function coneSilhouettes(rec,s,d,{samples=72}={}){
  const p=s.params||{},a=norm(p.axis||[1,0,0]),o=p.axisPoint||[0,0,0],t0=Number(p.tmin),t1=Number(p.tmax),k=Number(p.slope),r0=Number(p.r0);
  if(![t0,t1,k,r0].every(Number.isFinite)||Math.abs(t1-t0)<1e-8)return[];const B=basis(a),du=dot(d,B.u),dv=dot(d,B.v),da=dot(d,a),R=Math.hypot(du,dv);if(R<1e-10)return[];
  // Cone normal is proportional to radial(theta) - slope * axis.
  const q=clamp(k*da/R,-1,1);if(Math.abs(k*da)>R+1e-9)return[];const phi=Math.atan2(dv,du),alpha=Math.acos(q),angles=[phi+alpha,phi-alpha],out=[];
  for(const thetaRaw of angles){const theta=normalizedTheta(thetaRaw),rv=radialDir(B,theta),pts=[];for(let i=0;i<=samples;i++){const t=t0+(t1-t0)*i/samples,r=r0+k*(t-t0);if(r<0)continue;pts.push(add(add(o,mul(a,t)),mul(rv,r)))}for(const run of trimRun(rec,s,pts))out.push({kind:'line',role:'surface-silhouette',silhouette:true,surfaceType:'cone',faceKey:s.faceKey,componentId:s.componentId,points:run,sourceSurface:s})}
  return out;
}

function torusSilhouettes(rec,s,d,{samples=180}={}){
  const p=s.params||{},a=norm(p.axis||[1,0,0]),o=p.axisPoint||[0,0,0],R=Number(p.majorRadius),r=Number(p.minorRadius),tc=Number(p.centerT)||0;
  if(!(R>0&&r>0))return[];const B=basis(a),da=dot(d,a),branches=[[],[]],keeps=[[],[]];
  for(let i=0;i<=samples;i++){
    const th=TAU*i/samples,rv=radialDir(B,th),rd=dot(rv,d),base=Math.atan2(-rd,da);
    for(let b=0;b<2;b++){
      const ph=base+b*Math.PI,rho=R+r*Math.cos(ph),ax=tc+r*Math.sin(ph),pt=add(add(o,mul(a,ax)),mul(rv,rho));branches[b].push(pt);keeps[b].push(pointInsideSurfaceTrim(rec,s,pt,{epsilonScale:12}));
    }
  }
  const out=[];for(let b=0;b<2;b++){let runs=splitKeptRuns(branches[b],keeps[b],3);if(runs.length>1&&keeps[b][0]&&keeps[b].at(-1)){const merged=runs.at(-1).concat(runs[0].slice(1));runs=[merged,...runs.slice(1,-1)]}for(const run of runs)out.push({kind:'spline',role:'surface-silhouette',silhouette:true,surfaceType:'torus',faceKey:s.faceKey,componentId:s.componentId,points:run,sourceSurface:s})}
  return out;
}

function dedupeCurves(curves,D){const q=Math.max(.002,D*2e-6),sig=p=>p.map(v=>Math.round(v/q)).join(','),seen=new Set(),out=[];for(const c of curves){const pts=c.points||[];if(pts.length<2)continue;const A=sig(pts[0]),B=sig(pts.at(-1)),key=[c.componentId||'RAW',c.surfaceType,A<B?A+'|'+B:B+'|'+A].join('|');if(seen.has(key))continue;seen.add(key);out.push(c)}return out}

export function reconstructExactSilhouettes(rec,viewDir,{samples=80,torusSamples=180,minConfidence=.68}={}){
  rec.recognition=rec.recognition||recognizeTessellationGeometry(rec,{maxFeatures:1000});
  const d=norm(viewDir),M=reconstructSurfaceModel(rec),T=reconstructSurfaceTrims(rec),sig=[rec?.faces?.length||0,M.counts?.surfaces||0,T.counts?.domains||0,dirKey(d),samples,torusSamples,minConfidence].join('|');
  let byDir=cache.get(rec);if(!byDir){byDir=new Map();cache.set(rec,byDir)}if(byDir.has(sig))return byDir.get(sig);
  const curves=[];let cylinderSurfaces=0,coneSurfaces=0,torusSurfaces=0,unsupported=0,trimmedRuns=0;
  for(const s of M.surfaces.values()){
    if((s.confidence||0)<minConfidence)continue;const t=typeOf(s);let c=[];
    if(t==='cylinder'){cylinderSurfaces++;c=cylinderSilhouettes(rec,s,d,{samples})}
    else if(t==='cone-inferred'){coneSurfaces++;c=coneSilhouettes(rec,s,d,{samples})}
    else if(t==='torus-inferred'){torusSurfaces++;c=torusSilhouettes(rec,s,d,{samples:torusSamples})}
    else {unsupported++;continue}
    trimmedRuns+=c.length;curves.push(...c);
  }
  const unique=dedupeCurves(curves,diag(rec)),result={version:'6.0.0',kernel:'ROZFOOD Exact Silhouette Core',curves:unique,counts:{curves:unique.length,cylinderSurfaces,coneSurfaces,torusSurfaces,trimmedRuns,unsupportedSurfaces:unsupported,trimDomains:T.counts?.domains||0},exactParasolid:false,source:'analytic surface equations + tessellation trim-domain evidence',note:'Silhouette condition N(p)·viewDir=0 is solved on reconstructed cylinder/cone/torus surfaces, then clipped to each trimmed Face domain.'};
  byDir.set(sig,result);rec.exactSilhouettes=result;return result;
}

export function exactSilhouetteStats(rec,viewDir,opts){return reconstructExactSilhouettes(rec,viewDir,opts).counts}
