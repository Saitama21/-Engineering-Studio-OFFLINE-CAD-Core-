const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const mul=(a,s)=>[a[0]*s,a[1]*s,a[2]*s];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const len=a=>Math.hypot(a[0],a[1],a[2]);
const norm=a=>{const l=len(a)||1;return[a[0]/l,a[1]/l,a[2]/l]};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function basis(axis){const a=norm(axis),seed=Math.abs(a[2])<.82?[0,0,1]:[1,0,0],u=norm(cross(a,seed)),v=norm(cross(a,u));return{a,u,v}}
function triCentroid(loop){if(!loop?.length)return[0,0,0];let s=[0,0,0];for(const p of loop)s=add(s,p);return mul(s,1/loop.length)}
function planeCrossesTri(loop,p0,n,eps){if(!loop||loop.length<3)return false;let mn=Infinity,mx=-Infinity;for(const p of loop.slice(0,3)){const d=dot(sub(p,p0),n);mn=Math.min(mn,d);mx=Math.max(mx,d)}return mn<=eps&&mx>=-eps}
function componentStats(rec){const m=new Map();for(const f of rec.faces||[]){const id=f.componentId||'RAW';let s=m.get(id);if(!s)m.set(id,s={id,faces:0,pts:0,min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]});s.faces++;for(const p of f.loops?.[0]||[]){s.pts++;for(let i=0;i<3;i++){s.min[i]=Math.min(s.min[i],p[i]);s.max[i]=Math.max(s.max[i],p[i])}}}for(const s of m.values()){s.center=s.min.map((v,i)=>(v+s.max[i])/2);s.size=s.min.map((v,i)=>s.max[i]-v)}return m}
function scorePlane(rec,p0,n,{axis=null,mode='longitudinal'}={}){
  const diag=Math.hypot(...(rec.bounds?.size||[1,1,1])),eps=Math.max(.03,diag*2e-5),components=new Set();let crossings=0,radial=0,centerPenalty=0;
  for(const f of rec.faces||[]){const loop=f.loops?.[0];if(!planeCrossesTri(loop,p0,n,eps))continue;crossings++;components.add(f.componentId||'RAW');const c=triCentroid(loop);if(axis){const d=sub(c,p0),ax=dot(d,axis),r=len(sub(d,mul(axis,ax)));radial=Math.max(radial,r)}}
  const analytic=rec.recognition||{},cyl=(analytic.outerCylinders||[]).filter(c=>Math.abs(dot(sub(c.axisPoint,p0),n))<=c.radius+.5).length,holes=(analytic.holes||[]).filter(h=>Math.abs(dot(sub(h.axisPoint,p0),n))<=h.radius+.8).length;
  const target=mode==='longitudinal'?Math.max(6,Math.min(22,components.size)):Math.max(4,Math.min(18,components.size));
  const clutter=Math.max(0,components.size-target);
  return{score:components.size*18+Math.min(crossings,700)*.055+cyl*2.4+holes*1.2+radial*.01-clutter*3.5-centerPenalty,components,crossings,cylinders:cyl,holes,radial};
}
function componentIdsCrossingPlane(rec,p0,n,tol){const ids=new Set();for(const f of rec.faces||[])if(planeCrossesTri(f.loops?.[0],p0,n,tol))ids.add(f.componentId||'RAW');return ids}
function stationCandidates(rec,axis,plan){const vals=[];const push=v=>{if(Number.isFinite(v)&&!vals.some(x=>Math.abs(x-v)<1.0))vals.push(v)};push(dot(rec.bounds.center,axis));for(const p of rec.recognition?.planes||[])if(Math.abs(dot(norm(p.normal),axis))>.985)push(dot(p.origin,axis));for(const c of rec.recognition?.outerCylinders||[])if(Math.abs(dot(norm(c.axis),axis))>.985){push(dot(c.axisPoint,axis)-c.length/2);push(dot(c.axisPoint,axis));push(dot(c.axisPoint,axis)+c.length/2)}for(const s of plan?.chain?.stations||[])push(s);return vals.sort((a,b)=>a-b)}
function sectionAtStation(rec,axis,station){const center=rec.bounds.center,p0=add(center,mul(axis,station-dot(center,axis)));return scorePlane(rec,p0,axis,{axis,mode:'cross'})}
export function planAssemblySections(rec,drumPlan){
  const axis=norm(drumPlan?.axis||[1,0,0]),frame=basis(axis),center=drumPlan?.axisPoint||rec.bounds.center,diag=Math.hypot(...(rec.bounds?.size||[1,1,1]));
  // Longitudinal A-A: search angular orientations around the drum axis, favouring planes
  // that intersect many meaningful components without exploding into a cluttered section.
  const longitudinal=[];for(let deg=0;deg<180;deg+=15){const a=deg*Math.PI/180,n=norm(add(mul(frame.u,Math.cos(a)),mul(frame.v,Math.sin(a)))),info=scorePlane(rec,center,n,{axis,mode:'longitudinal'});longitudinal.push({deg,n,...info})}
  longitudinal.sort((a,b)=>b.score-a.score);const A=longitudinal[0];
  // B-B: choose an actual cross-section station from model planes/rings, not a hard-coded centre.
  const stations=stationCandidates(rec,axis,drumPlan),body=drumPlan?.body,mid=body?(body.min+body.max)/2:dot(center,axis),cross=stations.map(st=>({station:st,...sectionAtStation(rec,axis,st)})).filter(x=>Math.abs(x.station-mid)<(drumPlan?.L||diag)*.44);
  for(const c of cross){const centerBias=1-Math.min(1,Math.abs(c.station-mid)/Math.max(1,(drumPlan?.L||diag)*.45));c.score+=centerBias*8;if((drumPlan?.chain?.stations||[]).some(x=>Math.abs(x-c.station)<2))c.score+=5}
  cross.sort((a,b)=>b.score-a.score);const B=cross[0]||{station:mid,...sectionAtStation(rec,axis,mid)};B.point=add(center,mul(axis,B.station-dot(center,axis)));B.n=axis;
  // D: local section near the densest neighbouring station, but avoid reusing B-B exactly.
  const local=cross.filter(c=>Math.abs(c.station-B.station)>Math.max(20,(drumPlan?.D||100)*.08)).sort((a,b)=>b.score-a.score);const D=local[0]||B;D.point=add(center,mul(axis,D.station-dot(center,axis)));D.n=axis;
  const tol=Math.max(.05,diag*2e-5);A.point=center;A.includeComponents=componentIdsCrossingPlane(rec,A.point,A.n,tol);B.includeComponents=componentIdsCrossingPlane(rec,B.point,B.n,tol);D.includeComponents=componentIdsCrossingPlane(rec,D.point,D.n,tol);
  return{version:'4.0.0',A,B,D,candidates:{longitudinal:longitudinal.slice(0,4),cross:cross.slice(0,6)},stats:{AComponents:A.includeComponents.size,BComponents:B.includeComponents.size,DComponents:D.includeComponents.size}};
}
