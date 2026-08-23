// ROZFOOD Engineering Studio v5.0.0 — Exact Section Region Core
// Builds plane-local section regions from reconstructed closed Solid Regions.
// The core repairs/simplifies closed intersection loops, determines nesting parity
// (outer material / holes / islands), orients loops consistently and exposes a
// deterministic component-local planar region model for hatching and section drawing.
// Native Parasolid planar-region topology is not claimed.

import {sectionSolidRegionContours,reconstructSolidRegions} from './solid-region-core.js';

const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const mul=(a,s)=>[a[0]*s,a[1]*s,a[2]*s];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const len=a=>Math.hypot(a[0],a[1],a[2]);
const norm=a=>{const L=len(a)||1;return[a[0]/L,a[1]/L,a[2]/L]};
const cache=new WeakMap();

function planeBasis(n){
  const N=norm(n),seed=Math.abs(N[2])<.82?[0,0,1]:[1,0,0],u=norm(cross(N,seed)),v=norm(cross(N,u));
  return{n:N,u,v};
}
function uvOf(p,o,b){const d=sub(p,o);return[dot(d,b.u),dot(d,b.v)]}
function p3Of(q,o,b){return add(o,add(mul(b.u,q[0]),mul(b.v,q[1])))}
function d2(a,b){return Math.hypot(a[0]-b[0],a[1]-b[1])}
function area(loop){let a=0;for(let i=0;i<loop.length-1;i++)a+=loop[i][0]*loop[i+1][1]-loop[i+1][0]*loop[i][1];return a*.5}
function centroid(loop){let A=0,cx=0,cy=0;for(let i=0;i<loop.length-1;i++){const p=loop[i],q=loop[i+1],k=p[0]*q[1]-q[0]*p[1];A+=k;cx+=(p[0]+q[0])*k;cy+=(p[1]+q[1])*k}A*=.5;if(Math.abs(A)<1e-12){let x=0,y=0,n=0;for(const p of loop.slice(0,-1)){x+=p[0];y+=p[1];n++}return n?[x/n,y/n]:[0,0]}return[cx/(6*A),cy/(6*A)]}
function pointInPoly(p,loop){let inside=false;for(let i=0,j=loop.length-2;i<loop.length-1;j=i++){const a=loop[i],b=loop[j],hit=((a[1]>p[1])!==(b[1]>p[1]))&&(p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1]+1e-30)+a[0]);if(hit)inside=!inside}return inside}
function pointSegDistance(p,a,b){const ab=[b[0]-a[0],b[1]-a[1]],ap=[p[0]-a[0],p[1]-a[1]],dd=ab[0]*ab[0]+ab[1]*ab[1];if(dd<1e-18)return d2(p,a);const t=Math.max(0,Math.min(1,(ap[0]*ab[0]+ap[1]*ab[1])/dd)),q=[a[0]+ab[0]*t,a[1]+ab[1]*t];return d2(p,q)}
function cleanLoop(points,tol){
  const out=[];for(const p of points){if(!out.length||d2(p,out.at(-1))>tol*.35)out.push(p)}
  if(out.length<3)return null;
  if(d2(out[0],out.at(-1))>tol*2.5){if(d2(out[0],out.at(-1))<=tol*8)out.push(out[0]);else return null}else out[out.length-1]=out[0];
  // Remove near-collinear points while retaining real corners.
  let changed=true,guard=0;while(changed&&guard++<4){changed=false;const src=out.slice(0,-1),dst=[];for(let i=0;i<src.length;i++){const a=src[(i-1+src.length)%src.length],b=src[i],c=src[(i+1)%src.length],ab=[b[0]-a[0],b[1]-a[1]],bc=[c[0]-b[0],c[1]-b[1]],la=Math.hypot(...ab),lb=Math.hypot(...bc);if(la<tol*.35||lb<tol*.35){changed=true;continue}const cr=Math.abs(ab[0]*bc[1]-ab[1]*bc[0])/(la*lb),dist=pointSegDistance(b,a,c);if(cr<0.0025&&dist<tol*.45){changed=true;continue}dst.push(b)}if(dst.length<3)return null;out.length=0;out.push(...dst,dst[0])}
  return out;
}
function loopBounds(loop){let min=[Infinity,Infinity],max=[-Infinity,-Infinity];for(const p of loop){min[0]=Math.min(min[0],p[0]);min[1]=Math.min(min[1],p[1]);max[0]=Math.max(max[0],p[0]);max[1]=Math.max(max[1],p[1])}return{min,max,size:[max[0]-min[0],max[1]-min[1]]}}
function containsBounds(a,b,tol){return b.min[0]>=a.min[0]-tol&&b.max[0]<=a.max[0]+tol&&b.min[1]>=a.min[1]-tol&&b.max[1]<=a.max[1]+tol}
function signature(rec,planePoint,planeNormal,includeComponents){const p=planePoint.map(v=>v.toFixed(4)).join(','),n=norm(planeNormal).map(v=>v.toFixed(5)).join(','),ids=includeComponents?[...includeComponents].sort().join('|'):'*';return`${rec.faces?.length||0}|${p}|${n}|${ids}`}

export function reconstructExactSectionRegions(rec,planePoint,planeNormal,{includeComponents=null}={}){
  reconstructSolidRegions(rec);
  let perRec=cache.get(rec);if(!perRec)cache.set(rec,perRec=new Map());const sig=signature(rec,planePoint,planeNormal,includeComponents);if(perRec.has(sig))return perRec.get(sig);
  const raw=sectionSolidRegionContours(rec,planePoint,planeNormal,{includeComponents}),b=planeBasis(planeNormal),modelTol=Math.max(.008,rec?.solidRegions?.toleranceMm||.03),tol=Math.max(modelTol*2.1,.015);
  const byComponent=new Map();let inputClosed=0,repairedLoops=0,rejectedOpen=0,rejectedTiny=0,holes=0,islands=0,outerLoops=0;
  for(const [componentId,chains] of raw.byComponent){
    const loops=[];
    for(const ch of chains){if(!ch.closed){rejectedOpen++;continue}inputClosed++;const uv=(ch.points||[]).map(p=>uvOf(p,planePoint,b)),clean=cleanLoop(uv,tol);if(!clean){rejectedOpen++;continue}const A=area(clean);if(Math.abs(A)<tol*tol*5){rejectedTiny++;continue}if(clean.length!==uv.length)repairedLoops++;loops.push({uv:clean,area:A,absArea:Math.abs(A),centroid:centroid(clean),bounds:loopBounds(clean),regionId:ch.regionId,sourceRole:ch.role||'material-boundary'})}
    if(!loops.length)continue;
    loops.sort((a,c)=>c.absArea-a.absArea);
    for(let i=0;i<loops.length;i++){
      const L=loops[i];let parent=-1,parentArea=Infinity;
      for(let j=0;j<loops.length;j++){if(i===j)continue;const P=loops[j];if(P.absArea<=L.absArea*(1+1e-9)||P.absArea>=parentArea)continue;if(!containsBounds(P.bounds,L.bounds,tol))continue;if(pointInPoly(L.centroid,P.uv)){parent=j;parentArea=P.absArea}}
      L.parent=parent;let depth=0,p=parent,guard=0;while(p>=0&&guard++<loops.length){depth++;p=loops[p].parent}L.depth=depth;L.role=depth%2===0?'material-outer':'void-hole';if(depth===0)outerLoops++;else if(depth%2===1)holes++;else islands++;
      // Canonical orientation: material outer/islands CCW, holes CW in plane basis.
      const wantPositive=L.role==='material-outer';if((L.area>0)!==wantPositive){const a=L.uv.slice(0,-1).reverse();a.push(a[0]);L.uv=a;L.area=-L.area;L.centroid=centroid(a);L.reversed=true}else L.reversed=false;
      L.points3D=L.uv.map(q=>p3Of(q,planePoint,b));
    }
    const regions=[];for(let i=0;i<loops.length;i++){const L=loops[i];if(L.depth%2!==0)continue;const holeIdx=[];for(let j=0;j<loops.length;j++)if(loops[j].parent===i&&loops[j].depth===L.depth+1)holeIdx.push(j);regions.push({outerIndex:i,holeIndices:holeIdx,depth:L.depth,area:L.absArea-holesArea(loops,holeIdx)})}
    byComponent.set(componentId,{loops,regions});
  }
  const result={version:'5.0.0',kernel:'ROZFOOD Exact Section Region Core',exactParasolid:false,plane:{point:planePoint,normal:b.n,u:b.u,v:b.v},toleranceMm:tol,byComponent,counts:{components:byComponent.size,sourceRegions:raw.regions,inputClosedContours:inputClosed,openContours:raw.openContours,rejectedOpen,rejectedTiny,repairedLoops,outerLoops,holes,islands,planarRegions:[...byComponent.values()].reduce((s,x)=>s+x.regions.length,0)},note:'Section topology is reconstructed as plane-local nested regions from closed Solid Region intersections. Orientation and hole parity are canonicalized; native Parasolid section booleans are not claimed.'};
  perRec.set(sig,result);return result;
}
function holesArea(loops,idx){let s=0;for(const i of idx)s+=loops[i].absArea;return s}

export function exactSectionRegionStats(rec,planePoint,planeNormal,options={}){const r=reconstructExactSectionRegions(rec,planePoint,planeNormal,options);return{version:r.version,kernel:r.kernel,...r.counts,toleranceMm:r.toleranceMm,exactParasolid:false}}
