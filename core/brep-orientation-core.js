// ROZFOOD Engineering Studio v5.0.0 — B-Rep Loop Orientation & Face Normal Core
// Deterministically orients reconstructed Face/Loop/Shell topology using healed adjacency,
// analytic/tessellated face normals and shell/component centroids. This is reconstructed
// topology, not native Parasolid orientation data.

import {reconstructTopologicalBRep} from './topological-brep-reconstruction.js';
import {healTopologicalBRep} from './topology-healing-core.js';
import {reconstructSurfaceModel} from './surface-type-reconstruction.js';

const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const mul=(a,s)=>[a[0]*s,a[1]*s,a[2]*s];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const len=a=>Math.hypot(a[0],a[1],a[2]);
const norm=a=>{const L=len(a)||1;return[a[0]/L,a[1]/L,a[2]/L]};
const cache=new WeakMap();
function faceKeyOf(f){return[f.componentId||'RAW',f.modelId||'',f.sourceStream||'',f.tessFaceId??''].join('|')}
function faceNormal(f){const ns=f?.normals||[];if(ns.length){let n=[0,0,0];for(const z of ns)n=add(n,z);if(len(n)>1e-10)return norm(n)}const p=f?.loops?.[0]||[];return p.length>=3?norm(cross(sub(p[1],p[0]),sub(p[2],p[0]))):[0,0,1]}
function faceCenter(f){const p=f?.loops?.[0]||[];if(!p.length)return[0,0,0];let c=[0,0,0];for(const q of p)c=add(c,q);return mul(c,1/p.length)}
function buildFaceEvidence(rec){const m=new Map();for(const f of rec?.faces||[]){const k=faceKeyOf(f);let g=m.get(k);if(!g)m.set(k,g={componentId:f.componentId||'RAW',sumN:[0,0,0],sumC:[0,0,0],area:0,n:0});const w=Math.max(1e-9,f.area||1);g.sumN=add(g.sumN,mul(faceNormal(f),w));g.sumC=add(g.sumC,mul(faceCenter(f),w));g.area+=w;g.n++}for(const g of m.values()){g.normal=norm(g.sumN);g.center=mul(g.sumC,1/(g.area||1))}return m}
function componentCentroids(rec){const sums=new Map();for(const f of rec?.faces||[]){const id=f.componentId||'RAW',w=Math.max(1e-9,f.area||1),c=faceCenter(f);let g=sums.get(id);if(!g)sums.set(id,g={sum:[0,0,0],w:0});g.sum=add(g.sum,mul(c,w));g.w+=w}const out=new Map();for(const [k,g] of sums)out.set(k,mul(g.sum,1/(g.w||1)));return out}
function shellForFace(B){const m=new Map();for(const s of B.shells||[])for(const id of s.faceIds||[])m.set(id,s);return m}
function edgeDirectionForFace(B,faceId,edgeId){for(const lid of B.faces?.[faceId]?.loops||[]){const loop=B.loops?.[lid];for(const hid of loop?.halfEdges||[]){const h=B.halfEdges?.[hid];if(h?.edgeId===edgeId)return h.forward?1:-1}}return 0}
function analyticNormal(surface,center,fallback){if(!surface)return fallback;const p=surface.params||{};if((surface.type==='plane'||surface.type==='plane-inferred')&&p.normal)return norm(p.normal);if(surface.type==='cylinder'&&p.axis&&p.axisPoint){const a=norm(p.axis),d=sub(center,p.axisPoint),r=sub(d,mul(a,dot(d,a)));if(len(r)>1e-8)return norm(r)}if(surface.type==='cone-inferred'&&p.axis&&p.axisPoint){const a=norm(p.axis),d=sub(center,p.axisPoint),t=dot(d,a),r=sub(d,mul(a,t));if(len(r)>1e-8){const radial=norm(r),slope=Number.isFinite(p.slope)?p.slope:0;return norm(sub(radial,mul(a,slope)))}}return fallback}

export function orientTopologicalBRep(rec){
  const B=reconstructTopologicalBRep(rec),H=healTopologicalBRep(rec),S=reconstructSurfaceModel(rec),sig=[rec?.faces?.length||0,B.counts?.faces||0,H.counts?.healedAdjacencyEdges||0,S.counts?.surfaces||0].join('|');const hit=cache.get(rec);if(hit?.sig===sig)return hit.result;
  const evidence=buildFaceEvidence(rec),compCenters=componentCentroids(rec),shellMap=shellForFace(B),faces=[];let outward=0,inwardFlipped=0,ambiguous=0,analyticNormals=0;
  const byKey=new Map((B.faces||[]).map(f=>[f.faceKey,f]));
  for(const f of B.faces||[]){const ev=evidence.get(f.faceKey),surface=S.surfaces.get(f.faceKey),center=ev?.center||[0,0,0],raw=ev?.normal||surface?.normal||[0,0,1],an=analyticNormal(surface,center,raw);if(surface&&(surface.type==='plane'||surface.type==='plane-inferred'||surface.type==='cylinder'||surface.type==='cone-inferred'))analyticNormals++;const cc=compCenters.get(f.componentId)||[0,0,0],rad=sub(center,cc);let score=dot(an,rad),flip=false,confidence=Math.min(1,Math.abs(score)/(len(rad)+1e-9));if(Math.abs(score)<1e-7){ambiguous++;confidence=.25}else if(score<0){flip=true;inwardFlipped++}else outward++;faces.push({faceId:f.id,faceKey:f.faceKey,componentId:f.componentId,shellId:shellMap.get(f.id)?.id??null,center,rawNormal:raw,normal:flip?mul(an,-1):an,flipped:flip,outwardScore:score,confidence,surfaceType:f.surfaceType})}
  const faceById=new Map(faces.map(f=>[f.faceId,f]));
  // Shared-edge parity propagation: adjacent oriented faces of a manifold shell must traverse
  // their common topological edge in opposite directions. Resolve weak centroid decisions using
  // stronger neighbors while preserving high-confidence absolute orientation.
  let parityFixes=0,conflicts=0;const edges=B.edges||[];for(let pass=0;pass<3;pass++)for(const e of edges){if((e.faces||[]).length!==2)continue;const [aId,bId]=e.faces,A=faceById.get(aId),C=faceById.get(bId);if(!A||!C||A.componentId!==C.componentId)continue;const da=edgeDirectionForFace(B,aId,e.id),db=edgeDirectionForFace(B,bId,e.id);if(!da||!db)continue;const desiredOpposite=da===db;const actualOpposite=A.flipped!==C.flipped;if(desiredOpposite===actualOpposite)continue;const weak=A.confidence<=C.confidence?A:C,strong=weak===A?C:A;if(weak.confidence<.55||strong.confidence-weak.confidence>.18){weak.flipped=!weak.flipped;weak.normal=mul(weak.normal,-1);weak.confidence=Math.min(.9,Math.max(weak.confidence,strong.confidence*.82));parityFixes++}else conflicts++}
  const loops=[];let loopReversals=0,outerLoops=0,innerLoops=0;for(const l of B.loops||[]){const f=faceById.get(l.faceId);let desired=l.role==='inner'?-1:1;if(f?.flipped)desired*=-1;const current=Number.isFinite(l.signedArea)?Math.sign(l.signedArea):0;const reverse=current!==0&&current!==desired;if(reverse)loopReversals++;if(l.role==='outer')outerLoops++;if(l.role==='inner')innerLoops++;loops.push({loopId:l.id,faceId:l.faceId,role:l.role,closed:l.closed,winding:desired>0?'CCW':'CW',reverse,sourceSignedArea:l.signedArea})}
  const shells=[];let closedOutward=0;for(const s of B.shells||[]){const sf=faces.filter(f=>f.shellId===s.id);const avg=sf.length?sf.reduce((x,f)=>x+f.confidence,0)/sf.length:0;const fl=sf.filter(f=>f.flipped).length;const oriented=sf.length>0&&sf.every(f=>Number.isFinite(f.normal?.[0]));if(s.closed&&oriented)closedOutward++;shells.push({...s,oriented,orientationConfidence:avg,flippedFaces:fl})}
  const result={version:'5.0.0',kernel:'ROZFOOD B-Rep Loop Orientation & Face Normal Core',source:'healed reconstructed B-Rep + analytic surface normals + FaceTessellations evidence',exactParasolid:false,faces,loops,shells,counts:{faces:faces.length,analyticNormals,outwardFaces:outward,inwardFacesFlipped:inwardFlipped,ambiguousFaces:ambiguous,adjacencyParityFixes:parityFixes,orientationConflicts:conflicts,loopReversals,outerLoops,innerLoops,orientedShells:shells.filter(s=>s.oriented).length,closedOutwardShells:closedOutward},note:'Face normals are oriented consistently for drawing/section semantics using shell/component geometry and shared-edge parity. Native Parasolid face sense is not claimed.'};
  cache.set(rec,{sig,result});rec.brepOrientation=result;return result;
}
export function brepOrientationStats(rec){const o=orientTopologicalBRep(rec);return{version:o.version,kernel:o.kernel,...o.counts,exactParasolid:false}}
export function orientedFaceNormal(rec,faceKey){const o=orientTopologicalBRep(rec);return o.faces.find(f=>f.faceKey===faceKey)?.normal||null}
