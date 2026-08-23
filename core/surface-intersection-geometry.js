// ROZFOOD Engineering Studio v5.0.0 — Surface Intersection Geometry Core
// Reconstructs CAD intersection curves from recognized analytic surfaces instead of
// replaying tessellation chords. Deterministic/offline; source remains verified
// FaceTessellations + analytic recognition, not native Parasolid.

import {reconstructSurfaceModel} from './surface-type-reconstruction.js';

const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const mul=(a,s)=>[a[0]*s,a[1]*s,a[2]*s];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const len=a=>Math.hypot(a[0],a[1],a[2]);
const norm=a=>{const L=len(a)||1;return[a[0]/L,a[1]/L,a[2]/L]};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const cache=new WeakMap();

function diag(rec){return Math.hypot(...(rec?.bounds?.size||[1,1,1]))||1}
function basis(axis){const a=norm(axis),seed=Math.abs(a[2])<.82?[0,0,1]:[1,0,0],u=norm(cross(a,seed)),v=norm(cross(a,u));return{a,u,v}}
function pointLineDistance(p,a,d){return len(cross(sub(p,a),d))/Math.max(len(d),1e-12)}
function unwrap(values){if(!values.length)return[];const out=[values[0]];for(let i=1;i<values.length;i++){let x=values[i],prev=out.at(-1);while(x-prev>Math.PI)x-=Math.PI*2;while(x-prev<-Math.PI)x+=Math.PI*2;out.push(x)}return out}
function surfaceType(s){return s?.type==='plane-inferred'?'plane':s?.type}
function planeData(s){if(!s)return null;const n=s.params?.normal||s.normal,o=s.params?.origin;if(!n||!o)return null;return{n:norm(n),o}}
function cylData(s){if(!s||surfaceType(s)!=='cylinder')return null;const a=s.params?.axis,p=s.params?.axisPoint,r=s.params?.radius;if(!a||!p||!Number.isFinite(r))return null;return{a:norm(a),p,r,h:Number.isFinite(s.params?.length)?s.params.length/2:null}}
function coneData(s){if(!s||surfaceType(s)!=='cone-inferred')return null;const a=s.params?.axis,p=s.params?.axisPoint,t0=s.params?.tmin,t1=s.params?.tmax,r0=s.params?.r0,r1=s.params?.r1;if(!a||!p||![t0,t1,r0,r1].every(Number.isFinite))return null;const k=(r1-r0)/Math.max(1e-12,t1-t0);return{a:norm(a),p,t0,t1,r0,r1,k}}
function torusData(s){if(!s||surfaceType(s)!=='torus-inferred')return null;const a=s.params?.axis,p=s.params?.axisPoint,R=s.params?.majorRadius,r=s.params?.minorRadius,tc=s.params?.centerT;if(!a||!p||![R,r,tc].every(Number.isFinite))return null;return{a:norm(a),p,R,r,tc,amin:s.params?.angleMin,amax:s.params?.angleMax}}
function axisCoaxial(A,B,D){return len(cross(A.a,B.a))<1e-4&&pointLineDistance(B.p,A.p,A.a)<Math.max(.05,D*7e-5)}
function nearestPointOnLine(p,o,d){return add(o,mul(d,dot(sub(p,o),d)))}

function exactPlanePlane(chain,A,B,D){
  const pa=planeData(A),pb=planeData(B);if(!pa||!pb)return null;
  const d=cross(pa.n,pb.n),d2=dot(d,d);if(d2<1e-10)return null;
  // Point on intersection of n1·x=c1 and n2·x=c2.
  const c1=dot(pa.n,pa.o),c2=dot(pb.n,pb.o);
  const p=mul(add(mul(cross(pb.n,d),c1),mul(cross(d,pa.n),c2)),1/d2);
  const u=norm(d),src=chain?.points||[];if(src.length<2)return null;
  let t0=Infinity,t1=-Infinity,rms=0;for(const q of src){const t=dot(sub(q,p),u);t0=Math.min(t0,t);t1=Math.max(t1,t);rms+=pointLineDistance(q,p,u)**2}
  rms=Math.sqrt(rms/src.length);if(rms>Math.max(.08,D*1.2e-4))return null;
  return{kind:'line',points:[add(p,mul(u,t0)),add(p,mul(u,t1))],exactRelation:'plane-plane-intersection',fitError:rms,confidence:.99};
}

function exactPlaneCylinder(chain,plane,cyl,D,{samples=160}={}){
  const P=planeData(plane),C=cylData(cyl);if(!P||!C)return null;const {a,p,r,h}=C,{u,v}=basis(a),den=dot(P.n,a),src=chain?.points||[];if(src.length<2)return null;
  const eps=Math.max(.02,D*4e-5);
  if(Math.abs(den)<1e-5){
    // Plane parallel to cylinder axis -> 0/1/2 straight generatrices.
    const radial=sub(p,P.o),dist=dot(radial,P.n);if(Math.abs(dist)>r+eps)return null;
    const off=Math.sqrt(Math.max(0,r*r-dist*dist)),m=norm(cross(a,P.n));
    const candidates=[add(p,add(mul(P.n,-dist),mul(m,off))),add(p,add(mul(P.n,-dist),mul(m,-off)))];
    // Keep the branch represented by this source chain.
    let best=null,bestErr=Infinity;for(const o of candidates){let err=0,t0=Infinity,t1=-Infinity;for(const q of src){err+=pointLineDistance(q,o,a)**2;const t=dot(sub(q,o),a);t0=Math.min(t0,t);t1=Math.max(t1,t)}err=Math.sqrt(err/src.length);if(err<bestErr){bestErr=err;best={o,t0,t1}}}
    if(!best||bestErr>Math.max(.12,D*2e-4))return null;
    return{kind:'line',points:[add(best.o,mul(a,best.t0)),add(best.o,mul(a,best.t1))],exactRelation:'plane-cylinder-generator',fitError:bestErr,confidence:.98};
  }
  // General oblique section. Parameterize cylinder angle and solve plane equation exactly.
  const ang=unwrap(src.map(q=>{const w=sub(q,p);return Math.atan2(dot(w,v),dot(w,u))}));
  let amin=Math.min(...ang),amax=Math.max(...ang);if(amax-amin<.02)return null;
  const full=(amax-amin)>Math.PI*1.82; if(full){amin=0;amax=Math.PI*2}
  const count=Math.max(24,Math.ceil((amax-amin)/(Math.PI*2)*samples)),pts=[];
  for(let i=0;i<=count;i++){
    const th=amin+(amax-amin)*i/count,rad=add(mul(u,Math.cos(th)*r),mul(v,Math.sin(th)*r));
    const t=dot(P.n,sub(P.o,add(p,rad)))/den;if(h!=null&&Math.abs(t)>h+Math.max(.2,D*2e-4))continue;
    pts.push(add(add(p,rad),mul(a,t)));
  }
  if(pts.length<2)return null;
  let rms=0;for(const q of src){let dmin=Infinity;for(let i=0;i<pts.length;i+=Math.max(1,Math.floor(pts.length/32)))dmin=Math.min(dmin,len(sub(q,pts[i])));rms+=dmin*dmin}rms=Math.sqrt(rms/src.length);
  if(rms>Math.max(.35,D*7e-4))return null;
  const perp=Math.abs(den)>.985;
  return{kind:perp&&full?'circle':(perp?'arc':'ellipse-arc'),points:pts,exactRelation:'plane-cylinder-intersection',fitError:rms,confidence:.98,full};
}


function exactPlaneCone(chain,plane,cone,D,{samples=180}={}){
  const P=planeData(plane),C=coneData(cone),src=chain?.points||[];if(!P||!C||src.length<2)return null;const {a,p,t0,t1,r0,k}=C,{u,v}=basis(a),denA=dot(P.n,a),c0=dot(P.n,sub(p,P.o));
  const ang=unwrap(src.map(q=>{const d=sub(q,p),t=dot(d,a),rv=sub(d,mul(a,t));return Math.atan2(dot(rv,v),dot(rv,u))}));let amin=Math.min(...ang),amax=Math.max(...ang);if(amax-amin<.02)return null;
  const count=Math.max(24,Math.ceil((amax-amin)/(Math.PI*2)*samples)),pts=[];
  for(let i=0;i<=count;i++){
    const th=amin+(amax-amin)*i/count,radDir=add(mul(u,Math.cos(th)),mul(v,Math.sin(th))),den=denA+k*dot(P.n,radDir);if(Math.abs(den)<1e-9)continue;
    // radius(t)=r0+k*(t-t0), and plane n·(p+a*t+radDir*radius(t)-o)=0
    const num=-(c0+dot(P.n,radDir)*(r0-k*t0)),t=num/den;if(t<Math.min(t0,t1)-.2||t>Math.max(t0,t1)+.2)continue;const r=r0+k*(t-t0);if(r<0)continue;pts.push(add(add(p,mul(a,t)),mul(radDir,r)));
  }
  if(pts.length<2)return null;let rms=0;for(const q of src){let dm=Infinity;for(let i=0;i<pts.length;i+=Math.max(1,Math.floor(pts.length/36)))dm=Math.min(dm,len(sub(q,pts[i])));rms+=dm*dm}rms=Math.sqrt(rms/src.length);if(rms>Math.max(.35,D*7e-4))return null;
  return{kind:'conic-intersection',points:pts,exactRelation:'plane-cone-intersection',fitError:rms,confidence:.95};
}

function exactPlaneTorus(chain,plane,torus,D,{samples=220}={}){
  const P=planeData(plane),T=torusData(torus),src=chain?.points||[];if(!P||!T||src.length<2)return null;const den=Math.abs(dot(P.n,T.a));if(den<.985)return null; // exact stable branch: plane normal parallel torus axis
  const center=add(T.p,mul(T.a,T.tc)),dt=dot(P.n,sub(center,P.o))/Math.max(1e-12,dot(P.n,T.a)),z=-dt;if(Math.abs(z)>T.r+Math.max(.03,D*5e-5))return null;const dr=Math.sqrt(Math.max(0,T.r*T.r-z*z)),radii=[T.R+dr,Math.abs(T.R-dr)].filter(r=>r>1e-6),{u,v}=basis(T.a);
  let best=null,bestErr=Infinity;for(const rr of radii){let err=0;for(const q of src){const d=sub(q,center),ax=dot(d,T.a),rv=sub(d,mul(T.a,ax));err+=(len(rv)-rr)**2}err=Math.sqrt(err/src.length);if(err<bestErr){bestErr=err;best=rr}}
  if(!best||bestErr>Math.max(.2,D*4e-4))return null;const pts=[];for(let i=0;i<=samples;i++){const th=Math.PI*2*i/samples;pts.push(add(add(center,mul(T.a,z)),add(mul(u,Math.cos(th)*best),mul(v,Math.sin(th)*best))))}
  return{kind:'circle',points:pts,center:add(center,mul(T.a,z)),radius:best,full:true,exactRelation:'plane-torus-intersection',fitError:bestErr,confidence:.94};
}

function coaxialCylinderCone(chain,cyl,cone,D,{samples=160}={}){
  const C=cylData(cyl),K=coneData(cone),src=chain?.points||[];if(!C||!K||src.length<2||!axisCoaxial(C,K,D)||Math.abs(K.k)<1e-10)return null;const t=K.t0+(C.r-K.r0)/K.k;if(t<Math.min(K.t0,K.t1)-.2||t>Math.max(K.t0,K.t1)+.2)return null;const center=add(K.p,mul(K.a,t)),{u,v}=basis(K.a),pts=[];for(let i=0;i<=samples;i++){const th=Math.PI*2*i/samples;pts.push(add(center,add(mul(u,Math.cos(th)*C.r),mul(v,Math.sin(th)*C.r))))}
  let rms=0;for(const q of src){rms+=(Math.abs(len(sub(q,nearestPointOnLine(q,K.p,K.a)))-C.r))**2}rms=Math.sqrt(rms/src.length);if(rms>Math.max(.25,D*5e-4))return null;return{kind:'circle',points:pts,center,radius:C.r,full:true,exactRelation:'coaxial-cylinder-cone-intersection',fitError:rms,confidence:.96};
}

function coaxialCylinderTorus(chain,cyl,torus,D,{samples=160}={}){
  const C=cylData(cyl),T=torusData(torus),src=chain?.points||[];if(!C||!T||src.length<2||!axisCoaxial(C,T,D))return null;const dr=C.r-T.R;if(Math.abs(dr)>T.r+.05)return null;const dz=Math.sqrt(Math.max(0,T.r*T.r-dr*dr)),centers=[T.tc+dz,T.tc-dz].map(t=>add(T.p,mul(T.a,t))),{u,v}=basis(T.a);let best=null,bestErr=Infinity;for(const center of centers){let err=0;for(const q of src)err+=Math.abs(dot(sub(q,center),T.a))**2;err=Math.sqrt(err/src.length);if(err<bestErr){bestErr=err;best=center}}if(!best||bestErr>Math.max(.2,D*4e-4))return null;const pts=[];for(let i=0;i<=samples;i++){const th=Math.PI*2*i/samples;pts.push(add(best,add(mul(u,Math.cos(th)*C.r),mul(v,Math.sin(th)*C.r))))}return{kind:'circle',points:pts,center:best,radius:C.r,full:true,exactRelation:'coaxial-cylinder-torus-intersection',fitError:bestErr,confidence:.94};
}

function cylinderCylinder(chain,A,B,D,{samples=180}={}){
  const C1=cylData(A),C2=cylData(B);if(!C1||!C2)return null;const src=chain?.points||[];if(src.length<4)return null;
  // Nearly coaxial cylinders do not have a finite sharp intersection curve.
  if(len(cross(C1.a,C2.a))<1e-4){const sep=pointLineDistance(C2.p,C1.p,C1.a);if(sep<Math.max(.08,D*1e-4))return null}
  const {u,v}=basis(C1.a),angles=unwrap(src.map(q=>{const w=sub(q,C1.p);return Math.atan2(dot(w,v),dot(w,u))}));let amin=Math.min(...angles),amax=Math.max(...angles);if(amax-amin<.03)return null;
  const count=Math.max(30,Math.ceil((amax-amin)/(Math.PI*2)*samples)),pts=[];let prev=null;
  const a=C1.a,b=C2.a;
  // Solve distance-to-axis2^2 = r2^2 for axial t on cylinder1.
  const projPerp=x=>sub(x,mul(b,dot(x,b)));
  const Acoef=dot(projPerp(a),projPerp(a));if(Acoef<1e-10)return null;
  for(let i=0;i<=count;i++){
    const th=amin+(amax-amin)*i/count,rad=add(mul(u,Math.cos(th)*C1.r),mul(v,Math.sin(th)*C1.r)),base=sub(add(C1.p,rad),C2.p),ap=projPerp(a),bp=projPerp(base);
    const Bcoef=2*dot(ap,bp),Ccoef=dot(bp,bp)-C2.r*C2.r,disc=Bcoef*Bcoef-4*Acoef*Ccoef;if(disc<0)continue;
    const sd=Math.sqrt(Math.max(0,disc)),roots=[(-Bcoef+sd)/(2*Acoef),(-Bcoef-sd)/(2*Acoef)];let candidates=roots.map(t=>add(add(C1.p,rad),mul(a,t))).filter(p=>C1.h==null||Math.abs(dot(sub(p,C1.p),a))<=C1.h+Math.max(.2,D*2e-4)).filter(p=>C2.h==null||Math.abs(dot(sub(p,C2.p),b))<=C2.h+Math.max(.2,D*2e-4));if(!candidates.length)continue;
    const target=src[Math.round(i/count*(src.length-1))];candidates.sort((x,y)=>len(sub(x,prev||target))-len(sub(y,prev||target)));const pick=candidates[0];if(prev&&len(sub(pick,prev))>Math.max(C1.r,C2.r)*.35&&candidates.length>1)continue;pts.push(pick);prev=pick;
  }
  if(pts.length<4)return null;
  let rms=0;for(const q of src){let dmin=Infinity;for(let i=0;i<pts.length;i+=Math.max(1,Math.floor(pts.length/40)))dmin=Math.min(dmin,len(sub(q,pts[i])));rms+=dmin*dmin}rms=Math.sqrt(rms/src.length);if(rms>Math.max(.6,D*.0012))return null;
  return{kind:'intersection-curve',points:pts,exactRelation:'cylinder-cylinder-intersection',fitError:rms,confidence:.93};
}

export function reconstructSurfaceIntersection(chain,A,B,rec,options={}){
  if(!A||!B||!chain?.points?.length)return null;const D=diag(rec),a=surfaceType(A),b=surfaceType(B);
  if(a==='plane'&&b==='plane')return exactPlanePlane(chain,A,B,D);
  if(a==='plane'&&b==='cylinder')return exactPlaneCylinder(chain,A,B,D,options);
  if(a==='cylinder'&&b==='plane')return exactPlaneCylinder(chain,B,A,D,options);
  if(a==='cylinder'&&b==='cylinder')return cylinderCylinder(chain,A,B,D,options);
  if(a==='plane'&&b==='cone-inferred')return exactPlaneCone(chain,A,B,D,options);
  if(a==='cone-inferred'&&b==='plane')return exactPlaneCone(chain,B,A,D,options);
  if(a==='plane'&&b==='torus-inferred')return exactPlaneTorus(chain,A,B,D,options);
  if(a==='torus-inferred'&&b==='plane')return exactPlaneTorus(chain,B,A,D,options);
  if(a==='cylinder'&&b==='cone-inferred')return coaxialCylinderCone(chain,A,B,D,options);
  if(a==='cone-inferred'&&b==='cylinder')return coaxialCylinderCone(chain,B,A,D,options);
  if(a==='cylinder'&&b==='torus-inferred')return coaxialCylinderTorus(chain,A,B,D,options);
  if(a==='torus-inferred'&&b==='cylinder')return coaxialCylinderTorus(chain,B,A,D,options);
  return null;
}

export function surfaceIntersectionStats(rec){
  const M=reconstructSurfaceModel(rec),sig=[M.counts?.surfaces||0,M.counts?.sharedBoundaries||0].join('|');const hit=cache.get(rec);if(hit?.sig===sig)return hit.result;
  let eligible=0;for(const r of M.relations.values()){const A=M.surfaces.get(r.faceA),B=M.surfaces.get(r.faceB),a=surfaceType(A),b=surfaceType(B);if(r.draw!==false&&['plane','cylinder','cone-inferred','torus-inferred'].includes(a)&&['plane','cylinder','cone-inferred','torus-inferred'].includes(b))eligible++}
  const result={version:'5.0.0',kernel:'ROZFOOD Conic / Torus Surface Intersection Geometry Core',eligibleRelations:eligible,exactParasolid:false};cache.set(rec,{sig,result});return result;
}
