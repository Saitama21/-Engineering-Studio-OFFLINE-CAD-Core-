// ROZFOOD Engineering Studio v5.0.0 — Exact Section Boolean Core
// Builds an assembly-level planar material arrangement from the canonical section
// regions reconstructed by Exact Section Region Core. The boolean is exact with
// respect to the reconstructed polyline boundaries: source edges are split at real
// segment intersections, then classified by material occupancy on both sides.
// Native Parasolid planar booleans are not claimed.

import {reconstructExactSectionRegions} from './exact-section-region-core.js';

const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const mul=(a,s)=>[a[0]*s,a[1]*s,a[2]*s];
const d2=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const cache=new WeakMap();

function pointInPoly(p,loop){let inside=false;for(let i=0,j=loop.length-2;i<loop.length-1;j=i++){const a=loop[i],b=loop[j],hit=((a[1]>p[1])!==(b[1]>p[1]))&&(p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1]+1e-30)+a[0]);if(hit)inside=!inside}return inside}
function area(loop){let a=0;for(let i=0;i<loop.length-1;i++)a+=loop[i][0]*loop[i+1][1]-loop[i+1][0]*loop[i][1];return a*.5}
function bounds2(loop){let mn=[Infinity,Infinity],mx=[-Infinity,-Infinity];for(const p of loop){mn[0]=Math.min(mn[0],p[0]);mn[1]=Math.min(mn[1],p[1]);mx[0]=Math.max(mx[0],p[0]);mx[1]=Math.max(mx[1],p[1])}return{min:mn,max:mx}}
function key2(p,q){return`${Math.round(p[0]/q)},${Math.round(p[1]/q)}`}
function sig(rec,p,n,inc){return`${rec.faces?.length||0}|${p.map(x=>x.toFixed(4)).join(',')}|${n.map(x=>x.toFixed(5)).join(',')}|${inc?[...inc].sort().join('|'):'*'}`}
function lerp(a,b,t){return[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]}
function cross2(a,b){return a[0]*b[1]-a[1]*b[0]}
function sub2(a,b){return[a[0]-b[0],a[1]-b[1]]}
function segHit(a,b,c,d,eps){
  const r=sub2(b,a),s=sub2(d,c),den=cross2(r,s),ca=sub2(c,a);
  if(Math.abs(den)<=eps)return null;
  const t=cross2(ca,s)/den,u=cross2(ca,r)/den;
  if(t<-eps||t>1+eps||u<-eps||u>1+eps)return null;
  return{t:clamp(t,0,1),u:clamp(u,0,1),p:lerp(a,b,clamp(t,0,1))};
}
function uniqueTs(ts,eps){ts.sort((a,b)=>a-b);const out=[];for(const t of ts)if(!out.length||Math.abs(t-out.at(-1))>eps)out.push(t);return out}
function componentContains(entry,p){let count=0;for(const L of entry.loops||[])if(pointInPoly(p,L.uv))count++;return(count&1)===1}
function occupancy(byComponent,p){const ids=[];for(const [id,e] of byComponent)if(componentContains(e,p))ids.push(id);return ids}
function sameSet(a,b){if(a.length!==b.length)return false;const s=new Set(a);return b.every(x=>s.has(x))}
function p3(q,plane){return add(plane.point,add(mul(plane.u,q[0]),mul(plane.v,q[1])))}

function chainDirected(segments,q){
  const outMap=new Map();for(let i=0;i<segments.length;i++){const k=key2(segments[i].a,q);let a=outMap.get(k);if(!a)outMap.set(k,a=[]);a.push(i)}
  const used=new Uint8Array(segments.length),loops=[],open=[];
  for(let si=0;si<segments.length;si++){
    if(used[si])continue;let cur=si;const pts=[segments[cur].a],src=[];let guard=0;
    while(cur>=0&&!used[cur]&&guard++<segments.length+5){
      const e=segments[cur];used[cur]=1;pts.push(e.b);src.push(e);
      if(d2(pts.at(-1),pts[0])<=q*1.8){pts[pts.length-1]=pts[0];break}
      const cand=(outMap.get(key2(e.b,q))||[]).filter(i=>!used[i]);
      if(!cand.length){cur=-1;break}
      if(cand.length===1){cur=cand[0];continue}
      const prev=sub2(e.b,e.a);let best=-1,bestScore=Infinity;
      for(const ci of cand){const ce=segments[ci],v=sub2(ce.b,ce.a),lp=Math.hypot(...prev)||1,lv=Math.hypot(...v)||1,turn=Math.abs(Math.atan2(cross2(prev,v),prev[0]*v[0]+prev[1]*v[1]));const score=turn+Math.abs(lp-lv)*1e-7;if(score<bestScore){bestScore=score;best=ci}}
      cur=best;
    }
    if(pts.length>=4&&d2(pts[0],pts.at(-1))<=q*1.8&&Math.abs(area(pts))>q*q*3)loops.push({uv:pts,area:area(pts),sources:src});else if(pts.length>=2)open.push({uv:pts,sources:src});
  }
  return{loops,open};
}

export function reconstructExactSectionBoolean(rec,planePoint,planeNormal,{includeComponents=null}={}){
  const base=reconstructExactSectionRegions(rec,planePoint,planeNormal,{includeComponents});let m=cache.get(rec);if(!m)cache.set(rec,m=new Map());const s=sig(rec,planePoint,base.plane.normal,includeComponents);if(m.has(s))return m.get(s);
  const tol=Math.max(.018,base.toleranceMm||.05),segments=[];let sourceSegments=0;
  for(const [componentId,entry] of base.byComponent){for(const L of entry.loops||[]){const p=L.uv||[];for(let i=0;i<p.length-1;i++){if(d2(p[i],p[i+1])<=tol*.2)continue;segments.push({a:p[i],b:p[i+1],componentId,loopRole:L.role,ts:[0,1]});sourceSegments++}}}
  if(!segments.length){const empty={version:'5.0.0',kernel:'ROZFOOD Exact Section Boolean Core',exactParasolid:false,plane:base.plane,toleranceMm:tol,source:base,loops:[],interfaces:[],counts:{components:base.byComponent.size,sourceSegments:0,segmentIntersections:0,splitSegments:0,boundarySegments:0,interfaceSegments:0,booleanLoops:0,holes:0,openChains:0},note:'No closed reconstructed section regions were available for boolean evaluation.'};m.set(s,empty);return empty}

  // Spatial hash to avoid O(n²) segment intersection work on detailed sections.
  let mn=[Infinity,Infinity],mx=[-Infinity,-Infinity];for(const e of segments)for(const p of [e.a,e.b]){mn[0]=Math.min(mn[0],p[0]);mn[1]=Math.min(mn[1],p[1]);mx[0]=Math.max(mx[0],p[0]);mx[1]=Math.max(mx[1],p[1])}
  const diag=Math.hypot(mx[0]-mn[0],mx[1]-mn[1])||1,cell=Math.max(tol*30,diag/Math.max(12,Math.sqrt(segments.length)*.8)),grid=new Map();
  const cellKey=(x,y)=>`${x},${y}`;
  for(let i=0;i<segments.length;i++){const e=segments[i],x0=Math.floor((Math.min(e.a[0],e.b[0])-mn[0])/cell),x1=Math.floor((Math.max(e.a[0],e.b[0])-mn[0])/cell),y0=Math.floor((Math.min(e.a[1],e.b[1])-mn[1])/cell),y1=Math.floor((Math.max(e.a[1],e.b[1])-mn[1])/cell);for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++){const k=cellKey(x,y);let a=grid.get(k);if(!a)grid.set(k,a=[]);a.push(i)}}
  const pairSeen=new Set();let intersections=0;
  for(const ids of grid.values())for(let ai=0;ai<ids.length;ai++)for(let bi=ai+1;bi<ids.length;bi++){let i=ids[ai],j=ids[bi];if(i===j)continue;if(i>j)[i,j]=[j,i];const pk=`${i}:${j}`;if(pairSeen.has(pk))continue;pairSeen.add(pk);const A=segments[i],B=segments[j];if(A.componentId===B.componentId)continue;const h=segHit(A.a,A.b,B.a,B.b,tol*1e-5);if(!h)continue;if(h.t>1e-7&&h.t<1-1e-7)A.ts.push(h.t);if(h.u>1e-7&&h.u<1-1e-7)B.ts.push(h.u);if((h.t>1e-7&&h.t<1-1e-7)||(h.u>1e-7&&h.u<1-1e-7))intersections++}

  const pieces=[];for(const e of segments){const ts=uniqueTs(e.ts,1e-8);for(let i=0;i<ts.length-1;i++){if(ts[i+1]-ts[i]<1e-8)continue;const a=lerp(e.a,e.b,ts[i]),b=lerp(e.a,e.b,ts[i+1]);if(d2(a,b)>tol*.2)pieces.push({a,b,componentId:e.componentId,loopRole:e.loopRole})}}
  const unionBoundary=[],interfaces=[],eps=Math.max(tol*2.5,diag*2e-7);
  for(const e of pieces){const vx=e.b[0]-e.a[0],vy=e.b[1]-e.a[1],L=Math.hypot(vx,vy);if(L<tol*.2)continue;const mid=[(e.a[0]+e.b[0])/2,(e.a[1]+e.b[1])/2],nx=-vy/L,ny=vx/L,left=[mid[0]+nx*eps,mid[1]+ny*eps],right=[mid[0]-nx*eps,mid[1]-ny*eps],ol=occupancy(base.byComponent,left),or=occupancy(base.byComponent,right),il=ol.length>0,ir=or.length>0;
    if(il!==ir){unionBoundary.push(il?{...e,leftOccupancy:ol,rightOccupancy:or}:{...e,a:e.b,b:e.a,leftOccupancy:or,rightOccupancy:ol});continue}
    if(il&&ir&&!sameSet(ol,or)){const ownerChanges=(ol.includes(e.componentId)!==or.includes(e.componentId));if(ownerChanges)interfaces.push({...e,leftOccupancy:ol,rightOccupancy:or})}
  }
  // Remove duplicate directed boundary/interface fragments created by coincident source edges.
  const q=Math.max(tol*1.7,diag*1e-7),dedupe=list=>{const seen=new Set(),out=[];for(const e of list){const ka=key2(e.a,q),kb=key2(e.b,q),k=ka<kb?`${ka}|${kb}`:`${kb}|${ka}`;if(seen.has(k))continue;seen.add(k);out.push(e)}return out};
  const ub=dedupe(unionBoundary),itf=dedupe(interfaces),ch=chainDirected(ub,q);let holes=0;
  // Canonicalize union-loop orientation by nesting parity.
  const loopRecs=ch.loops.map((L,i)=>({...L,i,absArea:Math.abs(L.area),bounds:bounds2(L.uv),centroid:L.uv.slice(0,-1).reduce((s,p)=>[s[0]+p[0]/(L.uv.length-1),s[1]+p[1]/(L.uv.length-1)],[0,0])})).sort((a,b)=>b.absArea-a.absArea);
  for(let i=0;i<loopRecs.length;i++){const L=loopRecs[i];let depth=0;for(let j=0;j<i;j++){const P=loopRecs[j];if(L.centroid[0]<P.bounds.min[0]-q||L.centroid[0]>P.bounds.max[0]+q||L.centroid[1]<P.bounds.min[1]-q||L.centroid[1]>P.bounds.max[1]+q)continue;if(pointInPoly(L.centroid,P.uv))depth++}L.depth=depth;L.role=depth%2?'void-hole':'material-outer';if(L.role==='void-hole')holes++;const wantPos=L.role==='material-outer';if((L.area>0)!==wantPos){const r=L.uv.slice(0,-1).reverse();r.push(r[0]);L.uv=r;L.area=-L.area}L.points3D=L.uv.map(p=>p3(p,base.plane))}
  const result={version:'5.0.0',kernel:'ROZFOOD Exact Section Boolean Core',exactParasolid:false,plane:base.plane,toleranceMm:tol,source:base,loops:loopRecs,interfaces:itf.map(e=>({...e,a3:p3(e.a,base.plane),b3:p3(e.b,base.plane)})),counts:{components:base.byComponent.size,sourceSegments,segmentIntersections:intersections,splitSegments:pieces.length,boundarySegments:ub.length,interfaceSegments:itf.length,booleanLoops:loopRecs.length,holes,openChains:ch.open.length},note:'Assembly material union/subtraction is evaluated from reconstructed section polygons by segment arrangement and side-of-edge occupancy. The result is exact for the reconstructed polyline section boundaries, not native Parasolid planar booleans.'};
  m.set(s,result);return result;
}

export function exactSectionBooleanStats(rec,planePoint,planeNormal,options={}){const r=reconstructExactSectionBoolean(rec,planePoint,planeNormal,options);return{version:r.version,kernel:r.kernel,...r.counts,toleranceMm:r.toleranceMm,exactParasolid:false}}
