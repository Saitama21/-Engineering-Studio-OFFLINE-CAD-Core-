// ROZFOOD Engineering Studio v9.0.0 — Parametric Helicoid Surface Core
// Reconstructs blade/rib faces as trimmed helicoids from FaceTessellations evidence.
// The fitted surface is analytic/parametric; source tessellation is retained only as fit evidence.

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
function frameFor(rec){const axis=norm(rec?.recognition?.dominantAxis||(()=>{const s=rec?.bounds?.size||[1,1,1],i=s.indexOf(Math.max(...s)),a=[0,0,0];a[i]=1;return a})()),seed=Math.abs(axis[2])<.82?[0,0,1]:[1,0,0],u=norm(cross(axis,seed)),v=norm(cross(axis,u)),center=rec?.bounds?.center||[0,0,0];return{axis,u,v,axisPoint:center}}
function groupPoints(rec,key){const out=[];for(const f of rec?.faces||[])if(faceKeyOf(f)===key)for(const loop of f.loops||[])for(const p of loop||[])out.push(p);return out}
function uniqueSample(points,max=900){const out=[],seen=new Set(),step=Math.max(1,Math.floor(points.length/max));for(let i=0;i<points.length;i+=step){const p=points[i],k=p.map(x=>Math.round(x*50)).join(',');if(seen.has(k))continue;seen.add(k);out.push(p);if(out.length>=max)break}return out}
function circularResidual(a){let s=0;for(const x of a){let q=x;while(q>Math.PI)q-=TAU;while(q<-Math.PI)q+=TAU;s+=q*q}return Math.sqrt(s/Math.max(1,a.length))}
function quantile(a,q){const x=a.slice().sort((m,n)=>m-n),i=clamp(Math.round((x.length-1)*q),0,x.length-1);return x[i]}
function bbox(points){const mn=[Infinity,Infinity,Infinity],mx=[-Infinity,-Infinity,-Infinity];for(const p of points)for(let k=0;k<3;k++){mn[k]=Math.min(mn[k],p[k]);mx[k]=Math.max(mx[k],p[k])}return{min:mn,max:mx}}

function fitOne(rec,surface,frame){
  const raw=groupPoints(rec,surface.faceKey),pts=uniqueSample(raw);if(pts.length<30)return null;
  const samples=pts.map(p=>{const q=sub(p,frame.axisPoint),t=dot(q,frame.axis),x=dot(q,frame.u),y=dot(q,frame.v);return{p,t,r:Math.hypot(x,y),theta:Math.atan2(y,x)}});
  const ts=samples.map(x=>x.t),rs=samples.map(x=>x.r),tmin=Math.min(...ts),tmax=Math.max(...ts),span=tmax-tmin;if(span<2)return null;
  // Search pitch by circular phase coherence. This works on unordered point clouds because
  // a true helicoid satisfies theta - k*t = constant modulo 2π for every radial point.
  const D=Math.hypot(...(rec?.bounds?.size||[1,1,1]))||1,kMin=TAU/Math.max(D*2.5,span*8),kMax=TAU/Math.max(18,Math.min(D*.035,span*.16));
  let best={score:-1,k:0,b:0};const trials=720;
  for(const sign of [-1,1])for(let i=0;i<trials;i++){
    const q=i/(trials-1),k=sign*(kMin+(kMax-kMin)*q);let cs=0,sn=0;
    for(const z of samples){const ph=z.theta-k*z.t;cs+=Math.cos(ph);sn+=Math.sin(ph)}
    const score=Math.hypot(cs,sn)/samples.length;if(score>best.score)best={score,k,b:Math.atan2(sn,cs)};
  }
  if(best.score<.72||Math.abs(best.k)<1e-7)return null;
  const residual=samples.map(z=>z.theta-(best.k*z.t+best.b)),angleRms=circularResidual(residual),rmin=quantile(rs,.015),rmax=quantile(rs,.985),pitch=TAU/Math.abs(best.k);
  if(!(rmax-rmin>1)||angleRms>.16||pitch<20||pitch>D*3)return null;
  return{faceKey:surface.faceKey,componentId:surface.componentId,type:'helicoid',confidence:clamp(.55+best.score*.42-angleRms*.35,.70,.985),axis:frame.axis,axisPoint:frame.axisPoint,u:frame.u,v:frame.v,k:best.k,b:best.b,pitch,tmin,tmax,rmin,rmax,angleRms,phaseCoherence:best.score,box:bbox(raw),sourcePoints:raw.length,source:'FaceTessellations helicoid fit'};
}

export function reconstructParametricHelicoids(rec){const hit=cache.get(rec);if(hit)return hit;const M=reconstructSurfaceModel(rec),frame=frameFor(rec),surfaces=new Map();for(const s of M.surfaces.values())if(s.type==='ruled/helical'){const h=fitOne(rec,s,frame);if(h)surfaces.set(s.faceKey,h)}const result={version:'9.0.0',kernel:'ROZFOOD Parametric Helicoid Surface Core',surfaces,frame,counts:{candidates:[...M.surfaces.values()].filter(s=>s.type==='ruled/helical').length,fitted:surfaces.size},source:'reconstructed parametric helicoids from FaceTessellations evidence',exactParasolid:false};cache.set(rec,result);rec.parametricHelicoids=result;return result}

export function helicoidPoint(h,t,r){const th=h.k*t+h.b,er=add(mul(h.u,Math.cos(th)),mul(h.v,Math.sin(th)));return add(h.axisPoint,add(mul(h.axis,t),mul(er,r)))}
export function helicoidNormal(h,t,r){const th=h.k*t+h.b,et=add(mul(h.u,-Math.sin(th)),mul(h.v,Math.cos(th)));return norm(sub(et,mul(h.axis,r*h.k)))}

function rayBoxRange(o,d,b,tMax=Infinity){let lo=0,hi=tMax;for(let k=0;k<3;k++){if(Math.abs(d[k])<1e-12){if(o[k]<b.min[k]-1e-8||o[k]>b.max[k]+1e-8)return null;continue}let a=(b.min[k]-o[k])/d[k],c=(b.max[k]-o[k])/d[k];if(a>c)[a,c]=[c,a];lo=Math.max(lo,a);hi=Math.min(hi,c);if(hi<lo)return null}return hi>=0?[Math.max(0,lo),hi]:null}
function evalF(h,o,d,l){const q=sub(add(o,mul(d,l)),h.axisPoint),t=dot(q,h.axis),x=dot(q,h.u),y=dot(q,h.v),th=h.k*t+h.b;return{x,y,t,theta:th,f:-Math.sin(th)*x+Math.cos(th)*y,r:Math.cos(th)*x+Math.sin(th)*y}}
function bisect(h,o,d,a,b,fa,fb){let lo=a,hi=b,f0=fa,f1=fb;for(let i=0;i<30;i++){const m=(lo+hi)/2,fm=evalF(h,o,d,m).f;if(Math.abs(fm)<1e-8)return m;if(f0*fm<=0){hi=m;f1=fm}else{lo=m;f0=fm}}return(lo+hi)/2}

export function rayHelicoidRoots(o,d,h,tMax=Infinity){const range=rayBoxRange(o,d,h.box,tMax);if(!range)return[];let[lo,hi]=range;if(!(hi>lo))return[];const sweep=Math.abs(h.k*(h.tmax-h.tmin)),N=clamp(Math.ceil(48+sweep/TAU*48),48,180),roots=[];let A=evalF(h,o,d,lo);for(let i=1;i<=N;i++){const l=lo+(hi-lo)*i/N,B=evalF(h,o,d,l);let root=null;if(Math.abs(A.f)<1e-6)root=lo+(hi-lo)*(i-1)/N;else if(A.f*B.f<0)root=bisect(h,o,d,lo+(hi-lo)*(i-1)/N,l,A.f,B.f);else if(Math.abs(B.f)<1e-6)root=l;if(root!=null){const E=evalF(h,o,d,root),rtol=Math.max(.2,(h.rmax-h.rmin)*.006),ttol=Math.max(.2,(h.tmax-h.tmin)*.003);if(E.t>=h.tmin-ttol&&E.t<=h.tmax+ttol&&E.r>=h.rmin-rtol&&E.r<=h.rmax+rtol&&root>1e-8&&!roots.some(x=>Math.abs(x-root)<1e-5))roots.push(root)}A=B}return roots.sort((a,b)=>a-b)}

function splitRuns(items){const out=[],cur=[];for(const x of items){if(x)cur.push(x);else if(cur.length){out.push(cur.splice(0))}}if(cur.length)out.push(cur);return out}
export function parametricHelicoidSilhouettes(rec,viewDir,{samples=220}={}){const H=reconstructParametricHelicoids(rec),d=norm(viewDir),curves=[];for(const h of H.surfaces.values()){
  const da=dot(h.axis,d);if(Math.abs(da)<1e-5){const du=dot(h.u,d),dv=dot(h.v,d),theta0=Math.atan2(dv,du);for(let n=-8;n<=8;n++){const th=theta0+n*Math.PI,t=(th-h.b)/h.k;if(t<h.tmin||t>h.tmax)continue;curves.push({kind:'line',role:'helicoid-silhouette',silhouette:true,points:[helicoidPoint(h,t,h.rmin),helicoidPoint(h,t,h.rmax)],componentId:h.componentId,faceKey:h.faceKey,sourceSurface:{faceKey:h.faceKey,type:'helicoid'}})}}else{
    const seq=[];for(let i=0;i<=samples;i++){const t=h.tmin+(h.tmax-h.tmin)*i/samples,th=h.k*t+h.b,et=add(mul(h.u,-Math.sin(th)),mul(h.v,Math.cos(th))),r=dot(et,d)/(h.k*da);seq.push(r>=h.rmin&&r<=h.rmax?helicoidPoint(h,t,r):null)}for(const run of splitRuns(seq))if(run.length>=2)curves.push({kind:'polyline',role:'helicoid-silhouette',silhouette:true,points:run,componentId:h.componentId,faceKey:h.faceKey,sourceSurface:{faceKey:h.faceKey,type:'helicoid'}})
  }}return{version:'9.0.0',kernel:'ROZFOOD Parametric Helicoid Surface Core',curves,counts:{surfaces:H.surfaces.size,silhouetteCurves:curves.length}}}
