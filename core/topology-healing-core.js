// ROZFOOD Engineering Studio v5.0.0 — Topology Healing Core
// Conservative deterministic healing of reconstructed FaceTessellations topology.
// Repairs sub-tolerance endpoint splits, tiny face-loop gaps and ambiguous >2-face
// incidences without claiming native Parasolid topology.

import {reconstructTopologicalBRep} from './topological-brep-reconstruction.js';
import {surfaceBoundaryDecision} from './surface-type-reconstruction.js';

const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const len=a=>Math.hypot(a[0],a[1],a[2]);
const cache=new WeakMap();
function diag(rec){return Math.hypot(...(rec?.bounds?.size||[1,1,1]))||1}
function faceKeyOf(f){return[f.componentId||'RAW',f.modelId||'',f.sourceStream||'',f.tessFaceId??''].join('|')}
function qpt(p,q){return p.map(v=>Math.round(v/q)).join(',')}
function edgeKey(a,b,component,q){const A=qpt(a,q),B=qpt(b,q),k=A<B?A+'|'+B:B+'|'+A;return(component||'RAW')+'|'+k}

function rawFaceBoundaries(rec,q){
  const groups=new Map();
  for(const f of rec?.faces||[]){
    const fk=faceKeyOf(f);let g=groups.get(fk);
    if(!g){g={faceKey:fk,componentId:f.componentId||'RAW',area:0,local:new Map()};groups.set(fk,g)}
    g.area+=f.area||0;const loop=f?.loops?.[0]||[];
    for(let i=0;i<loop.length;i++){
      const a=loop[i],b=loop[(i+1)%loop.length];if(!a||!b||len(sub(a,b))<q*.05)continue;
      const k=edgeKey(a,b,g.componentId,q);let e=g.local.get(k);if(!e)g.local.set(k,e={a,b,count:0});e.count++;
    }
  }
  return groups;
}

function snapPoints(groups,qh){
  const buckets=new Map();
  const add=(component,p)=>{const k=(component||'RAW')+'|'+qpt(p,qh);let b=buckets.get(k);if(!b)buckets.set(k,b={sum:[0,0,0],n:0});b.sum[0]+=p[0];b.sum[1]+=p[1];b.sum[2]+=p[2];b.n++};
  for(const g of groups.values())for(const e of g.local.values())if(e.count===1){add(g.componentId,e.a);add(g.componentId,e.b)}
  const centers=new Map();for(const [k,b] of buckets)centers.set(k,b.sum.map(v=>v/b.n));
  const snap=(component,p)=>centers.get((component||'RAW')+'|'+qpt(p,qh))||p;
  return{centers,snap};
}

function oddEndpoints(faceSegments,qh){
  const deg=new Map(),pts=new Map();
  for(const e of faceSegments){const A=qpt(e.a,qh),B=qpt(e.b,qh);deg.set(A,(deg.get(A)||0)+1);deg.set(B,(deg.get(B)||0)+1);pts.set(A,e.a);pts.set(B,e.b)}
  return[...deg.entries()].filter(([,d])=>d%2===1).map(([k])=>pts.get(k));
}

function chooseManifoldPair(rec,faceKeys,areaByFace){
  if(faceKeys.length<=2)return{faceKeys:[...faceKeys],extras:[]};
  let best=null;
  for(let i=0;i<faceKeys.length;i++)for(let j=i+1;j<faceKeys.length;j++){
    const pair=[faceKeys[i],faceKeys[j]],d=surfaceBoundaryDecision(rec,pair),area=(areaByFace.get(pair[0])||0)+(areaByFace.get(pair[1])||0);
    // Prefer a meaningful visible/sharp relation, then confidence, then supporting face area.
    const score=(d.draw===false?-2:2)+(d.kind==='component-interface'?.2:0)+(d.confidence??.5)*2+Math.log10(1+Math.max(0,area))*.02;
    if(!best||score>best.score)best={score,pair};
  }
  const keep=best?.pair||faceKeys.slice(0,2);return{faceKeys:keep,extras:faceKeys.filter(k=>!keep.includes(k))};
}

class UF{constructor(n){this.p=Array.from({length:n},(_,i)=>i)}find(x){while(this.p[x]!==x){this.p[x]=this.p[this.p[x]];x=this.p[x]}return x}union(a,b){a=this.find(a);b=this.find(b);if(a!==b)this.p[b]=a}}

export function healTopologicalBRep(rec){
  const B=reconstructTopologicalBRep(rec),D=diag(rec),q0=B.toleranceMm||Math.max(.0015,Math.min(.035,D*8e-6)),qh=Math.max(q0*2.25,Math.min(.08,D*2e-5)),bridgeTol=Math.max(qh*4.5,Math.min(.22,D*1.2e-4));
  const sig=[rec?.faces?.length||0,B.counts?.edges||0,B.counts?.openLoops||0,B.counts?.nonManifoldEdges||0,qh.toFixed(5)].join('|');const hit=cache.get(rec);if(hit?.sig===sig)return hit.result;
  const groups=rawFaceBoundaries(rec,q0),{snap}=snapPoints(groups,qh),areaByFace=new Map([...groups].map(([k,g])=>[k,g.area]));
  const faceSegments=new Map();let rawBoundarySegments=0;
  for(const [fk,g] of groups){const arr=[];for(const e of g.local.values())if(e.count===1){rawBoundarySegments++;const a=snap(g.componentId,e.a),b=snap(g.componentId,e.b);if(len(sub(a,b))>qh*.08)arr.push({a,b,componentId:g.componentId,faceKey:fk,synthetic:false})}faceSegments.set(fk,arr)}
  let openFacesBefore=0,openFacesAfter=0,bridges=0;
  for(const [fk,arr] of faceSegments){
    const odd=oddEndpoints(arr,qh);if(odd.length)openFacesBefore++;
    if(odd.length===2&&len(sub(odd[0],odd[1]))<=bridgeTol){const componentId=groups.get(fk)?.componentId||'RAW';arr.push({a:odd[0],b:odd[1],componentId,faceKey:fk,synthetic:true});bridges++}
    if(oddEndpoints(arr,qh).length)openFacesAfter++;
  }
  const aggregate=new Map();
  for(const [fk,arr] of faceSegments)for(const e of arr){const k=edgeKey(e.a,e.b,e.componentId,qh);let x=aggregate.get(k);if(!x)aggregate.set(k,x={key:k,a:e.a,b:e.b,componentId:e.componentId,faceKeys:[],synthetic:false});if(!x.faceKeys.includes(fk))x.faceKeys.push(fk);x.synthetic||=e.synthetic}
  let nonManifoldBefore=0,nonManifoldAfter=0,ambiguousResolved=0;const adjacency=[];
  for(const x of aggregate.values()){
    if(x.faceKeys.length>2){nonManifoldBefore++;const picked=chooseManifoldPair(rec,x.faceKeys,areaByFace);x.originalFaceKeys=[...x.faceKeys];x.faceKeys=picked.faceKeys;x.extraFaceKeys=picked.extras;x.healedNonManifold=true;ambiguousResolved++}
    if(x.faceKeys.length>2)nonManifoldAfter++;adjacency.push(x);
  }
  // Approximate healed shell connectivity from face adjacency, per component.
  const faceList=[...groups.keys()],faceIndex=new Map(faceList.map((k,i)=>[k,i])),uf=new UF(faceList.length);
  for(const e of adjacency)if(e.faceKeys.length===2){const a=faceIndex.get(e.faceKeys[0]),b=faceIndex.get(e.faceKeys[1]);if(Number.isInteger(a)&&Number.isInteger(b))uf.union(a,b)}
  const comps=new Map();for(const [fk,g] of groups){const i=faceIndex.get(fk),r=uf.find(i),key=g.componentId+'|'+r;let c=comps.get(key);if(!c)comps.set(key,c={componentId:g.componentId,faces:new Set(),boundary:0});c.faces.add(fk)}
  for(const e of adjacency)if(e.faceKeys.length===1){const fk=e.faceKeys[0],g=groups.get(fk);if(!g)continue;const key=g.componentId+'|'+uf.find(faceIndex.get(fk));const c=comps.get(key);if(c)c.boundary++}
  const shellEstimate=[...comps.values()].map(c=>({componentId:c.componentId,faces:c.faces.size,boundaryEdges:c.boundary,closed:c.boundary===0}));
  const result={version:'5.0.0',kernel:'ROZFOOD Topology Healing Core',source:'reconstructed topological B-Rep + FaceTessellations boundary evidence',exactParasolid:false,toleranceMm:qh,bridgeToleranceMm:bridgeTol,adjacency,counts:{rawBoundarySegments,healedAdjacencyEdges:adjacency.length,weldedVertexBuckets:new Set(adjacency.flatMap(e=>[e.componentId+'|'+qpt(e.a,qh),e.componentId+'|'+qpt(e.b,qh)])).size,tinyGapBridges:bridges,openFaceLoopsBefore:openFacesBefore,openFaceLoopsAfter:openFacesAfter,nonManifoldEdgesBefore:nonManifoldBefore,nonManifoldEdgesAfter:nonManifoldAfter,ambiguousResolved,healedShells:shellEstimate.length,healedClosedShells:shellEstimate.filter(s=>s.closed).length},shells:shellEstimate,note:'Conservative healing only: near-coincident endpoints are welded, sub-tolerance two-end gaps are bridged, and >2-face edge ambiguity is reduced to the best supported manifold pair. Native Parasolid topology is not claimed.'};
  cache.set(rec,{sig,result});rec.topologyHealing=result;return result;
}

export function healedBoundaryAdjacency(rec){return healTopologicalBRep(rec).adjacency}
export function topologyHealingStats(rec){const h=healTopologicalBRep(rec);return{version:h.version,kernel:h.kernel,...h.counts,toleranceMm:h.toleranceMm,bridgeToleranceMm:h.bridgeToleranceMm,exactParasolid:false}}
