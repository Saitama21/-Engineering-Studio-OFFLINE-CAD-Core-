// ROZFOOD Engineering Studio v5.0.0 — Solid Region / Inside-Outside Core
// Reconstructs solid material regions from the oriented/healed B-Rep and provides
// deterministic inside/outside and section-contour semantics. Native Parasolid region
// topology is not claimed: triangles are used only as geometric evidence inside the
// reconstructed Face→Shell ownership graph.

import {reconstructTopologicalBRep} from './topological-brep-reconstruction.js';
import {healTopologicalBRep} from './topology-healing-core.js';
import {orientTopologicalBRep} from './brep-orientation-core.js';

const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const mul=(a,s)=>[a[0]*s,a[1]*s,a[2]*s];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const len=a=>Math.hypot(a[0],a[1],a[2]);
const norm=a=>{const L=len(a)||1;return[a[0]/L,a[1]/L,a[2]/L]};
const cache=new WeakMap();
const faceKeyOf=f=>[f.componentId||'RAW',f.modelId||'',f.sourceStream||'',f.tessFaceId??''].join('|');
const triCenter=t=>mul(add(add(t[0],t[1]),t[2]),1/3);
const diag=b=>Math.hypot(...(b?.size||[1,1,1]))||1;
function boundsOfTriangles(tris){const mn=[Infinity,Infinity,Infinity],mx=[-Infinity,-Infinity,-Infinity];for(const t of tris)for(const p of t)for(let i=0;i<3;i++){mn[i]=Math.min(mn[i],p[i]);mx[i]=Math.max(mx[i],p[i])}if(!Number.isFinite(mn[0]))return{min:[0,0,0],max:[0,0,0],size:[0,0,0],center:[0,0,0]};return{min:mn,max:mx,size:sub(mx,mn),center:mul(add(mn,mx),.5)}}
function inBounds(p,b,tol=0){return p[0]>=b.min[0]-tol&&p[0]<=b.max[0]+tol&&p[1]>=b.min[1]-tol&&p[1]<=b.max[1]+tol&&p[2]>=b.min[2]-tol&&p[2]<=b.max[2]+tol}
function signedTetra(a,b,c){return dot(a,cross(b,c))/6}
function triangleNormal(t){return norm(cross(sub(t[1],t[0]),sub(t[2],t[0])))}
function rayTri(origin,dir,t,eps){const e1=sub(t[1],t[0]),e2=sub(t[2],t[0]),h=cross(dir,e2),a=dot(e1,h);if(Math.abs(a)<eps)return null;const f=1/a,s=sub(origin,t[0]),u=f*dot(s,h);if(u<-eps||u>1+eps)return null;const q=cross(s,e1),v=f*dot(dir,q);if(v<-eps||u+v>1+eps)return null;const d=f*dot(e2,q);return d>eps?d:null}
function pointTriDistance(p,t){
  // Ericson-style closest point distance, used only to classify near-boundary samples.
  const a=t[0],b=t[1],c=t[2],ab=sub(b,a),ac=sub(c,a),ap=sub(p,a),d1=dot(ab,ap),d2=dot(ac,ap);if(d1<=0&&d2<=0)return len(ap);
  const bp=sub(p,b),d3=dot(ab,bp),d4=dot(ac,bp);if(d3>=0&&d4<=d3)return len(bp);
  const vc=d1*d4-d3*d2;if(vc<=0&&d1>=0&&d3<=0){const v=d1/(d1-d3);return len(sub(p,add(a,mul(ab,v))))}
  const cp=sub(p,c),d5=dot(ab,cp),d6=dot(ac,cp);if(d6>=0&&d5<=d6)return len(cp);
  const vb=d5*d2-d1*d6;if(vb<=0&&d2>=0&&d6<=0){const w=d2/(d2-d6);return len(sub(p,add(a,mul(ac,w))))}
  const va=d3*d6-d5*d4;if(va<=0&&(d4-d3)>=0&&(d5-d6)>=0){const w=(d4-d3)/((d4-d3)+(d5-d6));return len(sub(p,add(b,mul(sub(c,b),w))))}
  const n=norm(cross(ab,ac));return Math.abs(dot(ap,n));
}
const RAYS=[norm([1,.371,.193]),norm([.231,1,.417]),norm([.319,.271,1])];
function insideShellPoint(p,region,{boundaryTol,rayEps}){
  if(!inBounds(p,region.bounds,boundaryTol))return{inside:false,boundary:false,votes:0};
  // Fast boundary check on candidate triangles whose AABB is near the point.
  for(const tri of region.triangles){if(pointTriDistance(p,tri)<=boundaryTol)return{inside:true,boundary:true,votes:3}}
  let insideVotes=0,valid=0;
  for(const dir of RAYS){let hits=[];for(const tri of region.triangles){const d=rayTri(p,dir,tri,rayEps);if(d!=null)hits.push(d)}if(!hits.length){valid++;continue}hits.sort((a,b)=>a-b);let unique=0,last=-Infinity;for(const h of hits){if(h-last>boundaryTol*.7){unique++;last=h}}if(unique%2===1)insideVotes++;valid++}
  return{inside:insideVotes>=Math.ceil(valid/2),boundary:false,votes:insideVotes};
}
function representativePoint(region,tol){for(let i=0;i<Math.min(region.triangles.length,80);i++){const t=region.triangles[i],c=triCenter(t),n=region.triangleNormals?.[i]||triangleNormal(t);for(const sg of [-1,1]){const p=add(c,mul(n,sg*tol*4));const r=insideShellPoint(p,region,{boundaryTol:tol,rayEps:tol*1e-3});if(r.inside&&!r.boundary)return p}}return region.bounds.center}
function triPlaneSegment(t,p0,n,eps){const ds=t.map(p=>dot(sub(p,p0),n)),pts=[];for(let i=0;i<3;i++){const j=(i+1)%3,a=t[i],b=t[j],da=ds[i],db=ds[j];if(Math.abs(da)<=eps)pts.push(a);if((da< -eps&&db>eps)||(da>eps&&db< -eps)){const u=da/(da-db);pts.push(add(a,mul(sub(b,a),u)))}}const out=[];for(const p of pts)if(!out.some(q=>len(sub(p,q))<=eps*2))out.push(p);if(out.length<2)return null;let best=[out[0],out[1]],L=len(sub(best[0],best[1]));for(let i=0;i<out.length;i++)for(let j=i+1;j<out.length;j++){const d=len(sub(out[i],out[j]));if(d>L){L=d;best=[out[i],out[j]]}}return L>eps?best:null}
function qpt(p,q){return p.map(v=>Math.round(v/q)).join(',')}
function chainSegments(segments,q){const by=new Map(),addRef=(k,i)=>{let a=by.get(k);if(!a)by.set(k,a=[]);a.push(i)};segments.forEach((s,i)=>{addRef(qpt(s.a,q),i);addRef(qpt(s.b,q),i)});const used=new Uint8Array(segments.length),chains=[];for(let si=0;si<segments.length;si++){if(used[si])continue;let s=segments[si],start=qpt(s.a,q),key=start,pts=[s.a],guard=0;while(guard++<segments.length+8){const cand=(by.get(key)||[]).filter(i=>!used[i]);if(!cand.length)break;const i=cand[0],e=segments[i];used[i]=1;const ka=qpt(e.a,q),kb=qpt(e.b,q);if(ka===key){pts.push(e.b);key=kb}else{pts.push(e.a);key=ka}if(key===start)break}chains.push({points:pts,closed:key===start&&pts.length>2})}return chains}

function buildRegions(rec){
  const B=reconstructTopologicalBRep(rec),H=healTopologicalBRep(rec),O=orientTopologicalBRep(rec),D=diag(rec.bounds),tol=Math.max(.003,Math.min(.08,D*2e-5));
  const faceById=new Map(B.faces.map(f=>[f.id,f])),orientByKey=new Map(O.faces.map(f=>[f.faceKey,f])),rawByKey=new Map();
  for(const f of rec?.faces||[]){const k=faceKeyOf(f);let a=rawByKey.get(k);if(!a)rawByKey.set(k,a=[]);a.push(f)}
  const regions=[];
  for(const shell of B.shells||[]){if(!shell.closed)continue;const faceKeys=shell.faceIds.map(id=>faceById.get(id)?.faceKey).filter(Boolean),tris=[],normals=[];let signedVolume=0;
    for(const fk of faceKeys){const o=orientByKey.get(fk),target=o?.normal;for(const f of rawByKey.get(fk)||[]){const p=f.loops?.[0]||[];if(p.length<3)continue;for(let i=1;i+1<p.length;i++){let t=[p[0],p[i],p[i+1]],n=triangleNormal(t);if(target&&dot(n,target)<0){t=[p[0],p[i+1],p[i]];n=mul(n,-1)}tris.push(t);normals.push(n);signedVolume+=signedTetra(t[0],t[1],t[2])}}}
    if(!tris.length)continue;const bounds=boundsOfTriangles(tris),region={id:regions.length,shellId:shell.id,componentId:shell.componentId,faceKeys,triangles:tris,triangleNormals:normals,bounds,signedVolume,volume:Math.abs(signedVolume),orientation:signedVolume>=0?'outward-positive':'outward-negative',closed:true,sourceShellClosed:true};regions.push(region)
  }
  // Determine shell nesting per component. Odd nesting depth alternates solid/cavity semantics.
  const byComp=new Map();for(const r of regions){let a=byComp.get(r.componentId);if(!a)byComp.set(r.componentId,a=[]);a.push(r)}
  for(const list of byComp.values())for(const r of list){const probe=representativePoint(r,tol),containers=[];for(const other of list){if(other===r||other.volume<=r.volume*1.000001)continue;if(!inBounds(probe,other.bounds,tol))continue;const inside=insideShellPoint(probe,other,{boundaryTol:tol,rayEps:tol*1e-3});if(inside.inside&&!inside.boundary)containers.push(other.id)}r.probe=probe;r.containers=containers;r.nestingDepth=containers.length;r.regionRole=r.nestingDepth%2===0?'material-boundary':'void-boundary';r.materialSign=r.regionRole==='material-boundary'?1:-1}
  const healedClosed=new Map();for(const s of H.shells||[])if(s.closed)healedClosed.set(s.componentId,(healedClosed.get(s.componentId)||0)+1);
  return{B,H,O,tol,regions,byComp,healedClosed};
}

export function reconstructSolidRegions(rec){
  const B=reconstructTopologicalBRep(rec),H=healTopologicalBRep(rec),O=orientTopologicalBRep(rec),sig=[rec?.faces?.length||0,B.counts?.closedShells||0,H.counts?.healedClosedShells||0,O.counts?.closedOutwardShells||0].join('|');const hit=cache.get(rec);if(hit?.sig===sig)return hit.result;
  const x=buildRegions(rec),regions=x.regions,materialRegions=regions.filter(r=>r.regionRole==='material-boundary'),voidRegions=regions.filter(r=>r.regionRole==='void-boundary'),components=[...x.byComp].map(([componentId,rs])=>({componentId,regions:rs.length,materialRegions:rs.filter(r=>r.regionRole==='material-boundary').length,voidRegions:rs.filter(r=>r.regionRole==='void-boundary').length,volume:rs.reduce((s,r)=>s+r.materialSign*r.volume,0),closed:true}));
  const result={version:'5.0.0',kernel:'ROZFOOD Solid Region / Inside-Outside Core',source:'oriented healed reconstructed B-Rep + FaceTessellations geometric evidence',exactParasolid:false,toleranceMm:x.tol,regions:regions.map(r=>({id:r.id,shellId:r.shellId,componentId:r.componentId,bounds:r.bounds,volume:r.volume,signedVolume:r.signedVolume,nestingDepth:r.nestingDepth,regionRole:r.regionRole,containers:r.containers,triangles:r.triangles.length,closed:true})),components,counts:{regions:regions.length,materialRegions:materialRegions.length,voidRegions:voidRegions.length,components:components.length,closedSourceShells:regions.length,healedClosedShellEstimate:[...x.healedClosed.values()].reduce((a,b)=>a+b,0),orientedClosedShells:O.counts?.closedOutwardShells||0},netVolume:components.reduce((s,c)=>s+c.volume,0),note:'Material occupancy is reconstructed by nested closed-shell parity. Point classification uses robust multi-ray parity over triangles owned by the reconstructed B-Rep; native Parasolid region topology is not claimed.'};
  cache.set(rec,{sig,result,internal:x});rec.solidRegions=result;return result;
}

export function classifyPointInSolid(rec,p,{componentId=null}={}){
  reconstructSolidRegions(rec);const x=cache.get(rec)?.internal;if(!x)return{state:'unknown',inside:false,boundary:false,componentIds:[]};const ids=[];let boundary=false;
  for(const [cid,regions] of x.byComp){if(componentId&&cid!==componentId)continue;let crossings=0,on=false;for(const r of regions){if(!inBounds(p,r.bounds,x.tol))continue;const q=insideShellPoint(p,r,{boundaryTol:x.tol,rayEps:x.tol*1e-3});if(q.boundary){on=true;break}if(q.inside)crossings++}if(on){boundary=true;ids.push(cid)}else if(crossings%2===1)ids.push(cid)}
  return{state:boundary?'boundary':ids.length?'material':'outside',inside:ids.length>0,boundary,componentIds:ids};
}

export function sectionSolidRegionContours(rec,planePoint,planeNormal,{includeComponents=null}={}){
  reconstructSolidRegions(rec);const x=cache.get(rec)?.internal;if(!x)return{byComponent:new Map(),regions:0,closedContours:0,openContours:0};const n=norm(planeNormal),q=Math.max(x.tol*1.8,.008),byComponent=new Map();let usedRegions=0,closedContours=0,openContours=0;
  for(const r of x.regions){if(includeComponents&&!includeComponents.has(r.componentId))continue;const c=r.bounds.center,rad=len(r.bounds.size)*.5;if(Math.abs(dot(sub(c,planePoint),n))>rad+x.tol*3)continue;const segMap=new Map();for(const t of r.triangles){const s=triPlaneSegment(t,planePoint,n,x.tol*.8);if(!s)continue;const A=qpt(s[0],q),B=qpt(s[1],q),k=A<B?A+'|'+B:B+'|'+A;if(!segMap.has(k))segMap.set(k,{a:s[0],b:s[1]})}if(!segMap.size)continue;const chains=chainSegments([...segMap.values()],q);if(!chains.length)continue;usedRegions++;let a=byComponent.get(r.componentId);if(!a)byComponent.set(r.componentId,a=[]);for(const ch of chains){if(ch.closed)closedContours++;else openContours++;a.push({...ch,regionId:r.id,role:r.regionRole,materialSign:r.materialSign})}}
  return{byComponent,regions:usedRegions,closedContours,openContours};
}

export function solidRegionStats(rec){const r=reconstructSolidRegions(rec);return{version:r.version,kernel:r.kernel,...r.counts,netVolume:r.netVolume,toleranceMm:r.toleranceMm,exactParasolid:false}}
