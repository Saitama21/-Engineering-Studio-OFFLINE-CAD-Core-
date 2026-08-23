// ROZFOOD Engineering Studio v5.0.0 — Surface-Derived Drawing Primitive Core
// Reconstructs sharp CAD boundaries from semantic surface relationships before projection.
// Deterministic/offline. Source geometry remains FaceTessellations + verified recognition.

import {reconstructSurfaceModel,surfaceBoundaryDecision} from './surface-type-reconstruction.js';
import {reconstructSurfaceIntersection} from './surface-intersection-geometry.js';
import {reconstructSurfaceTrims,trimSurfaceIntersectionPrimitive} from './surface-trimming-core.js';
import {reconstructTopologicalBRep} from './topological-brep-reconstruction.js';
import {healTopologicalBRep,healedBoundaryAdjacency} from './topology-healing-core.js';
import {orientTopologicalBRep} from './brep-orientation-core.js';

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
function faceKeyOf(f){return[f.componentId||'RAW',f.modelId||'',f.sourceStream||'',f.tessFaceId??''].join('|')}
function qpt(p,q){return p.map(v=>Math.round(v/q)).join(',')}
function geoEdgeKey(a,b,q){const A=qpt(a,q),B=qpt(b,q);return A<B?A+'|'+B:B+'|'+A}
function localEdgeKey(a,b,component,q){return(component||'RAW')+'|'+geoEdgeKey(a,b,q)}
function pairKey(a,b){return a<b?a+'||'+b:b+'||'+a}
function pointLineDistance(p,a,b){const ab=sub(b,a),L=len(ab);return L<1e-10?len(sub(p,a)):len(cross(sub(p,a),ab))/L}
function rdp(points,tol){if(points.length<=2)return points.slice();let best=-1,idx=-1;for(let i=1;i<points.length-1;i++){const d=pointLineDistance(points[i],points[0],points.at(-1));if(d>best){best=d;idx=i}}if(best<=tol)return[points[0],points.at(-1)];const A=rdp(points.slice(0,idx+1),tol),B=rdp(points.slice(idx),tol);return A.slice(0,-1).concat(B)}
function planeBasis(n){const a=norm(n),seed=Math.abs(a[2])<.82?[0,0,1]:[1,0,0],u=norm(cross(a,seed)),v=norm(cross(a,u));return{u,v}}
function canonicalAxis(a){a=norm(a);const i=Math.abs(a[0])>.01?0:Math.abs(a[1])>.01?1:2;return a[i]<0?mul(a,-1):a}

function faceBoundaryAdjacency(rec,q){
  const groups=new Map();
  for(const f of rec?.faces||[]){const fk=faceKeyOf(f);let g=groups.get(fk);if(!g){g={faceKey:fk,componentId:f.componentId||'RAW',edges:new Map()};groups.set(fk,g)}const loop=f?.loops?.[0]||[];for(let i=0;i<loop.length;i++){const a=loop[i],b=loop[(i+1)%loop.length];if(!a||!b||len(sub(a,b))<q*.1)continue;const k=localEdgeKey(a,b,g.componentId,q);let e=g.edges.get(k);if(!e){e={a,b,count:0};g.edges.set(k,e)}e.count++}}
  const global=new Map();
  for(const g of groups.values())for(const e of g.edges.values())if(e.count===1){const k=localEdgeKey(e.a,e.b,g.componentId,q);let x=global.get(k);if(!x){x={a:e.a,b:e.b,componentId:g.componentId,faceKeys:[]};global.set(k,x)}if(!x.faceKeys.includes(g.faceKey))x.faceKeys.push(g.faceKey)}
  return global;
}

function chainEdges(edges,q){
  const byVertex=new Map(),addV=(k,i)=>{let a=byVertex.get(k);if(!a)byVertex.set(k,a=[]);a.push(i)};
  edges.forEach((e,i)=>{addV(qpt(e.a,q),i);addV(qpt(e.b,q),i)});const used=new Uint8Array(edges.length),chains=[];
  const other=(e,k)=>qpt(e.a,q)===k?e.b:e.a;
  for(let start=0;start<edges.length;start++){
    if(used[start])continue;used[start]=1;const e0=edges[start],pts=[e0.a,e0.b],source=[e0],startKey=qpt(e0.a,q);let key=qpt(e0.b,q),guard=0;
    while(guard++<edges.length+4){const candidates=(byVertex.get(key)||[]).filter(i=>!used[i]);if(!candidates.length)break;let nextIdx=candidates[0];if(candidates.length>1){const prev=sub(pts.at(-1),pts.at(-2));let best=-Infinity;for(const i of candidates){const e=edges[i],p=other(e,key),v=sub(p,pts.at(-1)),score=dot(norm(prev),norm(v));if(score>best){best=score;nextIdx=i}}}used[nextIdx]=1;const e=edges[nextIdx],p=other(e,key);source.push(e);pts.push(p);key=qpt(p,q);if(key===startKey)break}
    chains.push({points:pts,sourceEdges:source});
  }
  return chains;
}

function exactPlaneCylinder(chain,plane,cyl,diagLen){
  if(!plane?.params?.normal||!plane?.params?.origin||!cyl?.params?.axis||!Number.isFinite(cyl?.params?.radius))return null;
  const n=norm(plane.params.normal),a=canonicalAxis(cyl.params.axis),den=dot(n,a);if(Math.abs(den)<.985)return null;
  const ap=cyl.params.axisPoint||[0,0,0],t=dot(n,sub(plane.params.origin,ap))/den,center=add(ap,mul(a,t)),radius=cyl.params.radius;
  const {u,v}=planeBasis(a),angles=[];for(const p of chain.points){const d=sub(p,center);angles.push(Math.atan2(dot(d,v),dot(d,u)))}if(angles.length<2)return null;
  const un=[angles[0]];for(let i=1;i<angles.length;i++){let d=angles[i]-angles[i-1];while(d>Math.PI)d-=Math.PI*2;while(d<-Math.PI)d+=Math.PI*2;un.push(un.at(-1)+d)}
  const sweep=un.at(-1)-un[0],tol=Math.max(.06,diagLen*7e-5);let rms=0;for(const p of chain.points)rms+=(Math.abs(len(sub(p,center))-radius))**2;rms=Math.sqrt(rms/chain.points.length);if(rms>Math.max(tol,radius*.004))return null;
  const full=Math.abs(sweep)>Math.PI*1.78,count=Math.max(16,Math.ceil((full?Math.PI*2:Math.abs(sweep))/(Math.PI*2)*128)),points=[];const start=full?0:un[0],span=full?Math.PI*2:sweep;
  for(let i=0;i<=count;i++){const ang=start+span*i/count;points.push(add(center,add(mul(u,Math.cos(ang)*radius),mul(v,Math.sin(ang)*radius))))}
  return{kind:full?'circle':'arc',points,center,radius,sweep:span,fitError:rms,exactRelation:'plane-cylinder'};
}

function exactPlanePlane(chain,A,B,diagLen){
  const n1=A?.params?.normal||A?.normal,n2=B?.params?.normal||B?.normal;if(!n1||!n2)return null;const dir=cross(n1,n2);if(len(dir)<1e-5)return null;
  const p0=chain.points[0],p1=chain.points.at(-1),tol=Math.max(.03,diagLen*5e-5);let rms=0;for(const p of chain.points)rms+=pointLineDistance(p,p0,p1)**2;rms=Math.sqrt(rms/chain.points.length);if(rms>tol)return null;
  return{kind:'line',points:[p0,p1],fitError:rms,exactRelation:'plane-plane'};
}

function genericPrimitive(chain,diagLen){
  const pts=chain.points;if(pts.length<2)return null;const closed=len(sub(pts[0],pts.at(-1)))<Math.max(.01,diagLen*1e-5),tol=Math.max(.025,diagLen*6e-5);
  if(!closed){let rms=0;for(const p of pts)rms+=pointLineDistance(p,pts[0],pts.at(-1))**2;rms=Math.sqrt(rms/pts.length);if(rms<tol)return{kind:'line',points:[pts[0],pts.at(-1)],fitError:rms,exactRelation:'fitted-line'}}
  const simple=rdp(pts,tol);return{kind:closed?'loop':'polyline',points:simple,fitError:null,exactRelation:'surface-chain'};
}

export function reconstructSurfaceEdgePrimitives(rec,{minConfidence=.68}={}){
  const M=reconstructSurfaceModel(rec),trimModel=reconstructSurfaceTrims(rec),topo=reconstructTopologicalBRep(rec),healing=healTopologicalBRep(rec),orientation=orientTopologicalBRep(rec),sig=[rec?.faces?.length||0,M.counts?.surfaces||0,M.counts?.suppressedBoundaries||0,topo.counts?.edges||0,healing.counts?.healedAdjacencyEdges||0].join('|');const hit=cache.get(rec);if(hit?.sig===sig)return hit.result;
  const D=diag(rec),q=Math.max(.0015,Math.min(.035,D*8e-6)),topoAdj=healedBoundaryAdjacency(rec),adj=topoAdj.length?topoAdj:faceBoundaryAdjacency(rec,q),buckets=new Map(),sourceEdgeKeys=new Set();let suppressed=0,rawDrawn=0,interfaces=0,sharp=0;
  for(const e of (Array.isArray(adj)?adj:adj.values())){
    if(e.faceKeys.length<2)continue; // exterior boundaries remain in the existing exact planar-boundary pipeline
    let decision=surfaceBoundaryDecision(rec,e.faceKeys);
    if(decision.draw===false){suppressed++;continue}if((decision.confidence??1)<minConfidence&&e.faceKeys.length>=2)continue;
    rawDrawn++;if(decision.kind==='component-interface')interfaces++;else sharp++;
    const sigKey=e.faceKeys.length>=2?`PAIR|${pairKey(e.faceKeys[0],e.faceKeys[1])}`:`EXT|${e.faceKeys[0]||''}`;let b=buckets.get(sigKey);if(!b){b={signature:sigKey,componentId:e.componentId,faceKeys:[...e.faceKeys],decision,edges:[]};buckets.set(sigKey,b)}b.edges.push(e);
  }
  const curves=[];let lines=0,circles=0,arcs=0,polylines=0,intersections=0,replacedEdges=0,trimmedCurves=0,trimFallbacks=0;
  for(const b of buckets.values())for(const chain of chainEdges(b.edges,q)){
    if(chain.points.length<2)continue;const A=M.surfaces.get(b.faceKeys[0]),B=M.surfaces.get(b.faceKeys[1]);let primitive=null;
    let coveredByAnalyticCylinder=false;
    if(A&&B){
      const isPlane=x=>x.type==='plane'||x.type==='plane-inferred',isCyl=x=>x.type==='cylinder';
      if(isPlane(A)&&isCyl(B)){
        // Preserve the proven v4.1 rim path first: recognized cylinder rims are emitted by
        // cylinderViewCurves(), so their tessellation boundary should only be suppressed.
        primitive=exactPlaneCylinder(chain,A,B,D);coveredByAnalyticCylinder=!!primitive;
        if(!primitive)primitive=reconstructSurfaceIntersection(chain,A,B,rec,{samples:192});
      }else if(isCyl(A)&&isPlane(B)){
        primitive=exactPlaneCylinder(chain,B,A,D);coveredByAnalyticCylinder=!!primitive;
        if(!primitive)primitive=reconstructSurfaceIntersection(chain,A,B,rec,{samples:192});
      }else primitive=reconstructSurfaceIntersection(chain,A,B,rec,{samples:192});
    }
    // Cylinder rims are already emitted by cylinderViewCurves(). We only use the semantic
    // chain to suppress the faceted source edge; emitting it twice would thicken the drawing.
    const keys=[];for(const se of chain.sourceEdges){const k=geoEdgeKey(se.a,se.b,q);keys.push(k)}
    if(coveredByAnalyticCylinder){for(const k of keys)sourceEdgeKeys.add(k);replacedEdges+=keys.length;continue}
    if(!primitive){
      const g=genericPrimitive(chain,D);
      // Only replace non-analytic surface chains when the result is genuinely simpler than the source.
      if(!g||g.kind==='polyline'&&g.points.length>Math.max(6,chain.points.length*.55))continue;primitive=g;
    }
    let pieces=[primitive];
    if(A&&B&&(primitive.exactRelation?.includes('intersection')||primitive.exactRelation==='plane-cylinder-generator')){
      pieces=trimSurfaceIntersectionPrimitive(rec,primitive,A,B,{sourcePoints:chain.points});
      if(!pieces.length)continue;
    }
    for(const k of keys)sourceEdgeKeys.add(k);replacedEdges+=keys.length;
    for(const piece of pieces){
      const curve={...piece,role:b.decision.kind==='component-interface'?'surface-interface':'surface-edge',componentId:b.componentId,faceKeys:[...b.faceKeys],surfaceTypes:[A?.type||null,B?.type||null].filter(Boolean),relation:b.decision.kind,confidence:b.decision.confidence??.75,sourceEdgeKeys:keys};curves.push(curve);
      if(curve.trimmed)trimmedCurves++;if(curve.trimFallback)trimFallbacks++;
      if(curve.exactRelation?.includes('intersection')||curve.exactRelation==='plane-cylinder-generator')intersections++;if(curve.kind==='line')lines++;else if(curve.kind==='circle')circles++;else if(curve.kind==='arc')arcs++;else polylines++;
    }
  }
  const result={version:'5.0.0',kernel:'ROZFOOD Surface-Derived Drawing Primitive Core + Topological B-Rep + Surface Intersection + Trimming Geometry',curves,sourceEdgeKeys,quantization:q,stats:{surfaceCurves:curves.length,lines,circles,arcs,polylines,intersections,replacedEdges,trimmedCurves,trimFallbacks,trimDomains:trimModel.counts.domains,trimTriangles:trimModel.counts.trimTriangles,rawDrawnEdges:rawDrawn,suppressedSurfaceEdges:suppressed,componentInterfaces:interfaces,sharpSurfaceEdges:sharp,topologicalEdges:topo.counts?.edges||0,topologicalLoops:topo.counts?.loops||0,healedAdjacencyEdges:healing.counts?.healedAdjacencyEdges||0,healedOpenFaceLoops:healing.counts?.openFaceLoopsAfter||0,healedNonManifoldEdges:healing.counts?.nonManifoldEdgesAfter||0,tinyGapBridges:healing.counts?.tinyGapBridges||0,orientedFaces:orientation.counts?.faces||0,loopReversals:orientation.counts?.loopReversals||0,orientationConflicts:orientation.counts?.orientationConflicts||0},source:'healed topological B-Rep + semantic surface graph + FaceTessellations boundary evidence',exactParasolid:false};cache.set(rec,{sig,result});rec.surfaceEdgePrimitives=result;return result;
}

export function surfaceDerivedEdgeKey(edge,bundle){
  if(!edge||!bundle?.sourceEdgeKeys)return false;return bundle.sourceEdgeKeys.has(geoEdgeKey(edge.a,edge.b,bundle.quantization));
}
