// ROZFOOD Engineering Studio v5.0.0 — Topological B-Rep Reconstruction Core
// Reconstructs an explicit Vertex → Edge → Loop → Face → Shell topology from
// SolidWorks FaceTessellations face-block identity plus analytic surface types.
// This is deterministic/offline and deliberately does NOT claim native Parasolid B-Rep.

import {reconstructSurfaceModel} from './surface-type-reconstruction.js';
import {reconstructSurfaceTrims} from './surface-trimming-core.js';

const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const mul=(a,s)=>[a[0]*s,a[1]*s,a[2]*s];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const len=a=>Math.hypot(a[0],a[1],a[2]);
const norm=a=>{const L=len(a)||1;return[a[0]/L,a[1]/L,a[2]/L]};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const round=(v,n=4)=>{const p=10**n;return Math.round(v*p)/p};
const cache=new WeakMap();

function diag(rec){return Math.hypot(...(rec?.bounds?.size||[1,1,1]))||1}
function faceKeyOf(f){return[f.componentId||'RAW',f.modelId||'',f.sourceStream||'',f.tessFaceId??''].join('|')}
function qpt(p,q){return p.map(v=>Math.round(v/q)).join(',')}
function segKey(a,b,component,q){const A=qpt(a,q),B=qpt(b,q),k=A<B?A+'|'+B:B+'|'+A;return(component||'RAW')+'|'+k}
function pairSig(faceKeys){return [...faceKeys].sort().join('||')}
function polygonArea2(uv){let a=0;for(let i=0;i<uv.length;i++){const p=uv[i],q=uv[(i+1)%uv.length];a+=p[0]*q[1]-q[0]*p[1]}return a*.5}
function edgeLength(points){let L=0;for(let i=1;i<points.length;i++)L+=len(sub(points[i],points[i-1]));return L}

class UnionFind{
  constructor(n){this.p=new Int32Array(n);this.r=new Uint8Array(n);for(let i=0;i<n;i++)this.p[i]=i}
  find(x){let p=this.p[x];while(p!==this.p[p])p=this.p[p];while(x!==p){const n=this.p[x];this.p[x]=p;x=n}return p}
  union(a,b){a=this.find(a);b=this.find(b);if(a===b)return;if(this.r[a]<this.r[b]){const t=a;a=b;b=t}this.p[b]=a;if(this.r[a]===this.r[b])this.r[a]++}
}

function sourceFaceCoverage(rec){
  let withId=0;for(const f of rec?.faces||[])if(Number.isFinite(f?.tessFaceId))withId++;
  return rec?.faces?.length?withId/rec.faces.length:0;
}

function buildBoundaryEvidence(rec,q){
  // FaceTessellations arrives as one triangle per record. For every source CAD face,
  // mesh edges seen twice are internal triangulation; edges seen once form the trim boundary.
  const groups=new Map();
  for(const f of rec?.faces||[]){
    const fk=faceKeyOf(f);let g=groups.get(fk);if(!g)groups.set(fk,g={faceKey:fk,componentId:f.componentId||'RAW',componentName:f.componentName||f.instance?.name||'',sourceStream:f.sourceStream||'',tessFaceId:Number.isFinite(f.tessFaceId)?f.tessFaceId:null,triangles:0,area:0,local:new Map()});
    g.triangles++;g.area+=f.area||0;const loop=f?.loops?.[0]||[];if(loop.length<3)continue;
    for(let i=0;i<loop.length;i++){
      const a=loop[i],b=loop[(i+1)%loop.length];if(!a||!b||len(sub(a,b))<q*.05)continue;
      const k=segKey(a,b,g.componentId,q);let e=g.local.get(k);if(!e)g.local.set(k,e={a,b,count:0});e.count++;
    }
  }
  const physical=new Map();
  for(const g of groups.values())for(const [k,e] of g.local)if(e.count===1){
    let p=physical.get(k);if(!p)physical.set(k,p={key:k,a:e.a,b:e.b,componentId:g.componentId,faceKeys:[],occurrences:[]});
    if(!p.faceKeys.includes(g.faceKey))p.faceKeys.push(g.faceKey);p.occurrences.push({faceKey:g.faceKey,a:e.a,b:e.b});
  }
  return{groups,physical};
}

function chainPhysicalSegments(segments,q){
  // Merge tessellation boundary fragments into maximal topological edges. A chain is
  // allowed to continue only while incident-face signature stays identical.
  const byV=new Map(),vk=p=>qpt(p,q),addV=(k,i)=>{let a=byV.get(k);if(!a)byV.set(k,a=[]);a.push(i)};
  segments.forEach((e,i)=>{addV(vk(e.a),i);addV(vk(e.b),i)});
  const used=new Uint8Array(segments.length),chains=[];
  const other=(e,key)=>vk(e.a)===key?e.b:e.a;
  const degree=(key)=>byV.get(key)?.length||0;
  const walk=(startIdx,startPoint)=>{
    const e0=segments[startIdx],sig=pairSig(e0.faceKeys),points=[startPoint],source=[],faceKeys=[...e0.faceKeys],componentId=e0.componentId;let idx=startIdx,key=vk(startPoint),guard=0;
    while(idx!=null&&guard++<segments.length+4){
      if(used[idx])break;used[idx]=1;const e=segments[idx],p=other(e,key);source.push(e);points.push(p);const nk=vk(p);
      const candidates=(byV.get(nk)||[]).filter(i=>!used[i]&&pairSig(segments[i].faceKeys)===sig);
      if(candidates.length!==1)break;idx=candidates[0];key=nk;
      if(nk===vk(points[0]))break;
    }
    return{points,sourceSegments:source,faceKeys,componentId,closed:vk(points[0])===vk(points.at(-1))};
  };
  // Start at topological junctions/open ends first.
  for(let i=0;i<segments.length;i++)if(!used[i]){const e=segments[i],ka=vk(e.a),kb=vk(e.b);if(degree(ka)!==2||degree(kb)!==2){const start=degree(ka)!==2?e.a:e.b;chains.push(walk(i,start))}}
  // Remaining all-degree-2 components are closed loops.
  for(let i=0;i<segments.length;i++)if(!used[i])chains.push(walk(i,segments[i].a));
  return chains.filter(c=>c.points.length>=2);
}

function curveTypeFor(chain,surfaceModel){
  const ss=chain.faceKeys.map(k=>surfaceModel.surfaces.get(k)?.type).filter(Boolean);
  if(ss.length===2){
    const a=ss[0],b=ss[1],plane=x=>x?.startsWith('plane');
    if(plane(a)&&plane(b))return'line';
    if((plane(a)&&b==='cylinder')||(plane(b)&&a==='cylinder'))return'circle/arc';
    if((plane(a)&&b==='cone-inferred')||(plane(b)&&a==='cone-inferred'))return'conic';
    if(a==='cylinder'&&b==='cylinder')return'intersection-curve';
  }
  if(ss.some(x=>x==='ruled/helical'))return'helical-boundary';
  return'polycurve';
}

function buildFaceLoops(faceGroup,segmentRefs,vertexPoint,q,trimDomain){
  const vk=id=>id,byV=new Map(),add=(v,ri)=>{let a=byV.get(v);if(!a)byV.set(v,a=[]);a.push(ri)};
  segmentRefs.forEach((r,i)=>{add(r.v1,i);add(r.v2,i)});const used=new Uint8Array(segmentRefs.length),loops=[];
  const other=(r,v)=>r.v1===v?r.v2:r.v1;
  for(let s=0;s<segmentRefs.length;s++){
    if(used[s])continue;const r0=segmentRefs[s];let startV=r0.v1,v=startV,idx=s,verts=[v],refs=[],guard=0;
    while(idx!=null&&guard++<segmentRefs.length+8){
      if(used[idx])break;used[idx]=1;const r=segmentRefs[idx],nv=other(r,v);refs.push(r);verts.push(nv);v=nv;if(v===startV)break;
      const candidates=(byV.get(v)||[]).filter(i=>!used[i]);if(!candidates.length)break;
      if(candidates.length===1){idx=candidates[0];continue}
      // At an ambiguous tessellation junction, continue in the smoothest 3D direction.
      const p0=vertexPoint(verts.at(-2)),p1=vertexPoint(v),prev=norm(sub(p1,p0));let best=-Infinity,next=null;
      for(const ci of candidates){const rr=segmentRefs[ci],ov=other(rr,v),dir=norm(sub(vertexPoint(ov),p1)),score=dot(prev,dir);if(score>best){best=score;next=ci}}idx=next;
    }
    const closed=verts.length>2&&verts[0]===verts.at(-1);let signedArea=null;
    if(closed&&trimDomain?.mapper){try{const uv=verts.slice(0,-1).map(id=>trimDomain.mapper.map(vertexPoint(id)));signedArea=polygonArea2(uv)}catch{}}
    loops.push({vertexIds:verts,segmentRefs:refs,closed,signedArea});
  }
  // Largest closed UV loop is outer; remaining closed loops are holes/inner loops.
  const closed=loops.filter(l=>l.closed&&Number.isFinite(l.signedArea)).sort((a,b)=>Math.abs(b.signedArea)-Math.abs(a.signedArea));if(closed[0])closed[0].role='outer';for(let i=1;i<closed.length;i++)closed[i].role='inner';for(const l of loops)if(!l.role)l.role=l.closed?'trim-loop':'open-loop';
  return loops;
}

function componentNames(rec){const m=new Map();for(const o of rec?.occurrences||[])m.set(o.id,o.name||o.fileName||o.id);return m}

export function reconstructTopologicalBRep(rec,{maxDisplayEdges=42000}={}){
  const sm=reconstructSurfaceModel(rec),trims=reconstructSurfaceTrims(rec),D=diag(rec),q=Math.max(.0015,Math.min(.035,D*8e-6));
  const sig=[rec?.faces?.length||0,sm.counts?.surfaces||0,trims.counts?.domains||0].join('|');const hit=cache.get(rec);if(hit?.sig===sig)return hit.result;
  const evidence=buildBoundaryEvidence(rec,q),segments=[...evidence.physical.values()],chains=chainPhysicalSegments(segments,q);

  // Topological vertices are chain endpoints/junctions, not every tessellation sample.
  const vertexMap=new Map(),vertices=[];const getVertex=p=>{const k=qpt(p,q);let id=vertexMap.get(k);if(id!==undefined)return id;id=vertices.length;vertexMap.set(k,id);vertices.push({id,point:p});return id};
  const edges=[],segmentToEdge=new Map();
  for(const c of chains){const v1=getVertex(c.points[0]),v2=getVertex(c.points.at(-1)),id=edges.length,curveType=curveTypeFor(c,sm),length=edgeLength(c.points),faceKeys=[...c.faceKeys];
    const e={id,componentId:c.componentId,v1,v2,closed:c.closed,faceKeys,faceCount:faceKeys.length,curveType,length:round(length,4),samplePoints:c.points.length<=160?c.points:c.points.filter((_,i)=>i===0||i===c.points.length-1||i%Math.ceil(c.points.length/158)===0)};edges.push(e);for(const s of c.sourceSegments)segmentToEdge.set(s.key,id);
  }

  // Face-local raw boundary segments are assembled into loops/half-edges. This is the
  // key v5.0 difference: a Face owns ordered Loops; an Edge is shared by Faces.
  const rawVertexMap=new Map(),rawVertices=[];const getRaw=p=>{const k=qpt(p,q);let id=rawVertexMap.get(k);if(id!==undefined)return id;id=rawVertices.length;rawVertexMap.set(k,id);rawVertices.push(p);return id};
  const faces=[],loops=[],halfEdges=[];const faceIdByKey=new Map();
  for(const [fk,g] of evidence.groups){
    const refs=[];for(const [k,e] of g.local)if(e.count===1){const phys=evidence.physical.get(k);if(!phys)continue;refs.push({key:k,v1:getRaw(e.a),v2:getRaw(e.b),topoEdgeId:segmentToEdge.get(k)??null,a:e.a,b:e.b})}
    const trim=trims.domains.get(fk),built=buildFaceLoops(g,refs,id=>rawVertices[id],q,trim),faceId=faces.length;faceIdByKey.set(fk,faceId);const loopIds=[];
    for(const bl of built){const lid=loops.length,hes=[];let prevEdge=null;for(const sr of bl.segmentRefs){const te=sr.topoEdgeId;if(te==null)continue;if(te===prevEdge)continue;prevEdge=te;const edge=edges[te];const startPoint=rawVertices[sr.v1],startKey=qpt(startPoint,q),forward=qpt(edge.samplePoints[0],q)===startKey;const hid=halfEdges.length;halfEdges.push({id:hid,edgeId:te,faceId,loopId:lid,forward});hes.push(hid)}loops.push({id:lid,faceId,role:bl.role,closed:bl.closed,halfEdges:hes,signedArea:Number.isFinite(bl.signedArea)?round(bl.signedArea,5):null});loopIds.push(lid)}
    const s=sm.surfaces.get(fk);faces.push({id:faceId,faceKey:fk,componentId:g.componentId,componentName:g.componentName,tessFaceId:g.tessFaceId,sourceStream:g.sourceStream,surfaceId:s?.id||null,surfaceType:s?.type||'unknown',surfaceConfidence:s?.confidence??null,area:round(g.area,4),loops:loopIds,loopCount:loopIds.length,triangles:g.triangles});
  }

  // Attach face IDs to topology edges.
  for(const e of edges)e.faces=e.faceKeys.map(k=>faceIdByKey.get(k)).filter(Number.isInteger);

  // Shells are connected face sets per physical component. Shared edges establish adjacency.
  const uf=new UnionFind(faces.length);for(const e of edges)if(e.faces.length>=2){const a=e.faces[0];for(let i=1;i<e.faces.length;i++)if(faces[a]?.componentId===faces[e.faces[i]]?.componentId)uf.union(a,e.faces[i])}
  const shellMap=new Map();for(const f of faces){const r=uf.find(f.id);let s=shellMap.get(r);if(!s)shellMap.set(r,s={id:shellMap.size,componentId:f.componentId,faceIds:[],edgeIds:new Set(),loopIds:new Set(),area:0});s.faceIds.push(f.id);s.area+=f.area;for(const lid of f.loops){s.loopIds.add(lid);for(const hid of loops[lid]?.halfEdges||[]){const ei=halfEdges[hid]?.edgeId;if(Number.isInteger(ei))s.edgeIds.add(ei)}}}
  const shells=[];for(const s of shellMap.values()){let boundary=0,nonManifold=0;for(const ei of s.edgeIds){const n=edges[ei]?.faces?.filter(fi=>s.faceIds.includes(fi)).length||0;if(n===1)boundary++;else if(n>2||n===0)nonManifold++}const closed=boundary===0&&nonManifold===0;const topV=new Set();for(const ei of s.edgeIds){topV.add(edges[ei].v1);topV.add(edges[ei].v2)}const chi=topV.size-s.edgeIds.size+s.faceIds.length;shells.push({id:s.id,componentId:s.componentId,faceIds:[...s.faceIds],faces:s.faceIds.length,edges:s.edgeIds.size,loops:s.loopIds.size,vertices:topV.size,boundaryEdges:boundary,nonManifoldEdges:nonManifold,closed,eulerCharacteristic:chi,area:round(s.area,3)})}

  const names=componentNames(rec),componentMap=new Map();for(const f of faces){let c=componentMap.get(f.componentId);if(!c)componentMap.set(f.componentId,c={componentId:f.componentId,name:f.componentName||names.get(f.componentId)||f.componentId,faces:0,edges:new Set(),loops:0,shells:0,closedShells:0,area:0});c.faces++;c.loops+=f.loopCount;c.area+=f.area;for(const lid of f.loops)for(const hid of loops[lid]?.halfEdges||[]){const ei=halfEdges[hid]?.edgeId;if(Number.isInteger(ei))c.edges.add(ei)}}for(const s of shells){const c=componentMap.get(s.componentId);if(c){c.shells++;if(s.closed)c.closedShells++}}
  const components=[...componentMap.values()].map(c=>({...c,edges:c.edges.size,area:round(c.area,3)})).sort((a,b)=>b.faces-a.faces);

  let display=[];for(const e of edges){const pts=e.samplePoints||[];for(let i=1;i<pts.length;i++)display.push({p1:pts[i-1],p2:pts[i],kind:e.faceCount===1?'boundary':'topology',componentId:e.componentId})}if(display.length>maxDisplayEdges){const out=[],step=display.length/maxDisplayEdges;for(let i=0;i<maxDisplayEdges;i++)out.push(display[Math.floor(i*step)]);display=out}
  const sourceIdentityCoverage=sourceFaceCoverage(rec),sourceTriangles=rec?.counts?.fullSceneTriangles||rec?.counts?.sceneFaces||rec?.faces?.length||0,coverage=sourceTriangles?Math.min(1,(rec?.faces?.length||0)/sourceTriangles):1,closedShells=shells.filter(s=>s.closed).length;
  const openLoops=loops.filter(l=>!l.closed).length,innerLoops=loops.filter(l=>l.role==='inner').length,outerLoops=loops.filter(l=>l.role==='outer').length,nonManifoldEdges=edges.filter(e=>e.faceCount>2).length,boundaryEdges=edges.filter(e=>e.faceCount===1).length;
  const result={version:'5.0.0',kernel:'ROZFOOD Topological B-Rep Reconstruction Core',geometryModel:'vertex-edge-loop-face-shell',source:'SolidWorks FaceTessellations face-block identity + analytic surfaces + trim domains',exactParasolid:false,faceIdentity:sourceIdentityCoverage>=.5?'source-face-blocks':'inferred',topologyComplete:coverage>.9995&&sourceIdentityCoverage>=.5,coverage:round(coverage,4),sourceFaceIdentityCoverage:round(sourceIdentityCoverage,4),toleranceMm:q,counts:{vertices:vertices.length,edges:edges.length,loops:loops.length,halfEdges:halfEdges.length,faces:faces.length,shells:shells.length,closedShells,boundaryEdges,nonManifoldEdges,outerLoops,innerLoops,openLoops,trimDomains:trims.counts?.domains||0},components,faces:faces.slice(0,3000),loops:loops.slice(0,12000),halfEdges:halfEdges.slice(0,30000),edges:edges.slice(0,16000),shells:shells.map(s=>({...s,faceIds:s.faceIds||[]})).slice(0,2000),displayEdges:display,note:'v5.0 reconstructs explicit V→E→Loop→Face→Shell ownership and shared-edge adjacency. Surface equations/trim domains are analytic reconstructions supported by FaceTessellations evidence; native Parasolid topology is not claimed.'};
  cache.set(rec,{sig,result,internal:{segments,physical:evidence.physical}});rec.topologicalBRep=result;return result;
}

export function topologicalBoundaryAdjacency(rec){
  const B=reconstructTopologicalBRep(rec),hit=cache.get(rec),physical=hit?.internal?.physical;if(!physical)return[];
  return[...physical.values()].map(e=>({key:e.key,a:e.a,b:e.b,componentId:e.componentId,faceKeys:[...e.faceKeys]}));
}

export function topologicalBRepStats(rec){const b=reconstructTopologicalBRep(rec);return{version:b.version,kernel:b.kernel,...b.counts,coverage:b.coverage,topologyComplete:b.topologyComplete,exactParasolid:false}}
