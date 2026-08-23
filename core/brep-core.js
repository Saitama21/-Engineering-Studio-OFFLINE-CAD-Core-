const EPS=1e-12;

function sub(a,b){return[a[0]-b[0],a[1]-b[1],a[2]-b[2]]}
function cross(a,b){return[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]}
function dot(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]}
function len(a){return Math.hypot(a[0],a[1],a[2])}
function normalize(a){const l=len(a)||1;return[a[0]/l,a[1]/l,a[2]/l]}
function triangleNormal(a,b,c){return normalize(cross(sub(b,a),sub(c,a)))}
function triangleArea(a,b,c){return .5*len(cross(sub(b,a),sub(c,a)))}
function triangleSignedVolume(a,b,c){return dot(a,cross(b,c))/6}
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function round(v,n=3){const p=10**n;return Math.round(v*p)/p}

function chooseTolerance(rec,requested){
  if(Number.isFinite(requested)&&requested>0)return requested;
  const size=rec?.bounds?.size||[1,1,1],diag=Math.hypot(...size)||1;
  // This only welds numerically identical tessellation points. It is deliberately
  // far tighter than a manufacturing/modeling tolerance.
  return clamp(diag*1e-7,1e-5,2e-3);
}
function vertexKey(p,tol){return`${Math.round(p[0]/tol)},${Math.round(p[1]/tol)},${Math.round(p[2]/tol)}`}
function edgeKey(a,b){return a<b?`${a}:${b}`:`${b}:${a}`}
function faceSourceKey(f,componentId,fallbackId){
  if(Number.isFinite(f?.tessFaceId))return`${componentId}|${f.sourceStream||'stream'}|${f.tessFaceId}`;
  return`${componentId}|fallback|${fallbackId}`;
}

class UnionFind{
  constructor(n){this.p=new Int32Array(n);this.r=new Uint8Array(n);for(let i=0;i<n;i++)this.p[i]=i}
  find(x){let p=this.p[x];while(p!==this.p[p])p=this.p[p];while(x!==p){const n=this.p[x];this.p[x]=p;x=n}return p}
  union(a,b){a=this.find(a);b=this.find(b);if(a===b)return;if(this.r[a]<this.r[b]){const t=a;a=b;b=t}this.p[b]=a;if(this.r[a]===this.r[b])this.r[a]++}
}
function componentNameMap(rec){const m=new Map();for(const o of rec?.occurrences||[])m.set(o.id,o.name||o.fileName||o.id);return m}

/**
 * ROZFOOD B-Rep Core Alpha.
 *
 * SolidWorks FaceTessellations carries a face-block identity (tessFaceId). We
 * preserve that identity through assembly transforms and use it as the source
 * B-Rep-face boundary. This lets us separate internal triangulation edges from
 * edges between source CAD faces. The resulting adjacency is genuinely useful
 * V/E/F/Shell topology, while the underlying surface/curve equations still come
 * from tessellation rather than the hidden exact Parasolid body.
 */
export function buildFacetedBRep(rec,{tolerance,maxDisplayEdges=42000,sharpAngleDeg=28}={}){
  const src=rec?.faces||[],tol=chooseTolerance(rec,tolerance),cosSharp=Math.cos(sharpAngleDeg*Math.PI/180);
  const vertices=[],vmap=new Map(),facets=[],edges=[],emap=new Map();
  let skippedDegenerate=0,metadataFacets=0;
  const getVertex=(p,componentId)=>{
    const key=`${componentId}|${vertexKey(p,tol)}`;let id=vmap.get(key);if(id!==undefined)return id;
    id=vertices.length;vertices.push([Number(p[0])||0,Number(p[1])||0,Number(p[2])||0]);vmap.set(key,id);return id;
  };
  for(let sfIndex=0;sfIndex<src.length;sfIndex++){
    const sourceFace=src[sfIndex],loop=sourceFace?.loops?.[0];if(!loop||loop.length<3)continue;
    const componentId=sourceFace.componentId||'RAW';if(Number.isFinite(sourceFace.tessFaceId))metadataFacets++;
    const sourceKey=faceSourceKey(sourceFace,componentId,sfIndex);
    // FaceTessellations currently yields triangles. Fan triangulation keeps this
    // forward-compatible with polygon loops without changing source-face identity.
    for(let k=1;k<loop.length-1;k++){
      const pts=[loop[0],loop[k],loop[k+1]],vid=pts.map(p=>getVertex(p,componentId)),a=vertices[vid[0]],b=vertices[vid[1]],c=vertices[vid[2]],area=triangleArea(a,b,c);
      if(!(area>EPS)){skippedDegenerate++;continue}
      const fi=facets.length,normal=triangleNormal(a,b,c),edgeIds=[];
      for(let e=0;e<3;e++){
        const v1=vid[e],v2=vid[(e+1)%3],key=`${componentId}|${edgeKey(v1,v2)}`;let ei=emap.get(key);
        if(ei===undefined){ei=edges.length;emap.set(key,ei);edges.push({v1:Math.min(v1,v2),v2:Math.max(v1,v2),faces:[fi],componentId})}else edges[ei].faces.push(fi);
        edgeIds.push(ei);
      }
      facets.push({vertices:vid,edges:edgeIds,normal,area,componentId,componentName:sourceFace.componentName||sourceFace.instance?.name||'',sourceKey,tessFaceId:Number.isFinite(sourceFace.tessFaceId)?sourceFace.tessFaceId:null,sourceStream:sourceFace.sourceStream||'',signedVolume:triangleSignedVolume(a,b,c)});
    }
  }

  // If source face-block identity is absent, infer smooth patches so the topology
  // still has a useful face layer. When metadata exists, it wins over heuristics.
  const sourceIdentityCoverage=src.length?metadataFacets/src.length:0;
  if(sourceIdentityCoverage<.5&&facets.length){
    const patchUf=new UnionFind(facets.length);
    for(const e of edges){if(e.faces.length!==2)continue;const a=facets[e.faces[0]],b=facets[e.faces[1]];if(a.componentId!==b.componentId)continue;if(Math.abs(dot(a.normal,b.normal))>=cosSharp)patchUf.union(e.faces[0],e.faces[1])}
    const patchIds=new Map();for(let fi=0;fi<facets.length;fi++){const root=patchUf.find(fi);let id=patchIds.get(root);if(id===undefined){id=patchIds.size;patchIds.set(root,id)}facets[fi].sourceKey=`${facets[fi].componentId}|inferred|${id}`}
  }

  // Classify mesh edges. Internal edges live inside one source CAD face and are
  // hidden in B-Rep view. Inter-face edges are the actual faceted topology border.
  let boundaryEdges=0,sharpEdges=0,smoothEdges=0,nonManifoldEdges=0,internalEdges=0;
  const topoEdgeIds=[];
  for(let ei=0;ei<edges.length;ei++){
    const e=edges[ei];let kind='internal';
    if(e.faces.length===1){kind='boundary';boundaryEdges++}
    else if(e.faces.length!==2){kind='nonmanifold';nonManifoldEdges++}
    else{
      const a=facets[e.faces[0]],b=facets[e.faces[1]];
      if(a.sourceKey===b.sourceKey){kind='internal';internalEdges++}
      else if(Math.abs(dot(a.normal,b.normal))<cosSharp){kind='sharp';sharpEdges++}
      else{kind='smooth';smoothEdges++}
    }
    e.kind=kind;if(kind!=='internal')topoEdgeIds.push(ei);
  }

  // Source-face groups become the F layer.
  const faceGroups=new Map();
  for(let fi=0;fi<facets.length;fi++){
    const f=facets[fi];let g=faceGroups.get(f.sourceKey);if(!g){g={id:faceGroups.size,key:f.sourceKey,componentId:f.componentId,componentName:f.componentName,tessFaceId:f.tessFaceId,sourceStream:f.sourceStream,facets:0,area:0,edgeSet:new Set(),normal:f.normal};faceGroups.set(f.sourceKey,g)}
    g.facets++;g.area+=f.area;for(const ei of f.edges)if(edges[ei].kind!=='internal')g.edgeSet.add(ei);
  }
  const brepFaces=[...faceGroups.values()].map(g=>({id:g.id,componentId:g.componentId,tessFaceId:g.tessFaceId,sourceStream:g.sourceStream,facets:g.facets,edges:g.edgeSet.size,area:round(g.area,3)}));

  // Shell connectivity uses all manifold shared edges, including triangulation
  // edges. Because vertices/edges are scoped by component occurrence, touching
  // parts in an assembly never accidentally merge into one shell.
  const shellUf=new UnionFind(facets.length);
  for(const e of edges){if(e.faces.length<2)continue;const base=e.faces[0];for(let i=1;i<e.faces.length;i++)shellUf.union(base,e.faces[i])}
  const shellsByRoot=new Map();
  for(let fi=0;fi<facets.length;fi++){
    const root=shellUf.find(fi),f=facets[fi];let s=shellsByRoot.get(root);if(!s){s={id:shellsByRoot.size,componentId:f.componentId,facetIds:[],faceKeys:new Set(),area:0,signedVolume:0,edgeSet:new Set()};shellsByRoot.set(root,s)}
    s.facetIds.push(fi);s.faceKeys.add(f.sourceKey);s.area+=f.area;s.signedVolume+=f.signedVolume;for(const ei of f.edges)s.edgeSet.add(ei);
  }
  const shells=[];
  for(const s of shellsByRoot.values()){
    let boundary=0,nonManifold=0;for(const ei of s.edgeSet){const n=edges[ei].faces.length;if(n===1)boundary++;else if(n!==2)nonManifold++}
    shells.push({id:s.id,componentId:s.componentId,faces:s.faceKeys.size,facets:s.facetIds.length,edges:[...s.edgeSet].filter(ei=>edges[ei].kind!=='internal').length,boundaryEdges:boundary,nonManifoldEdges:nonManifold,closed:boundary===0&&nonManifold===0,area:round(s.area,3),volume:round(Math.abs(s.signedVolume),3)});
  }

  let selected=topoEdgeIds;
  // A single closed/smooth tessellated source face can legitimately have no
  // inter-face edge. Keep a sparse visual guide in that rare case, marked guide.
  if(selected.length===0&&edges.length){
    const have=new Set(selected),need=Math.min(maxDisplayEdges,Math.max(240,Math.floor(edges.length*.018))),step=Math.max(1,Math.floor(edges.length/Math.max(1,need)));
    selected=[...selected];for(let i=0;i<edges.length&&selected.length<need;i+=step)if(!have.has(i)){selected.push(i);have.add(i)}
  }
  if(selected.length>maxDisplayEdges){const out=[],step=selected.length/maxDisplayEdges;for(let i=0;i<maxDisplayEdges;i++)out.push(selected[Math.floor(i*step)]);selected=out}
  const displayEdges=selected.map(ei=>{const e=edges[ei],f=facets[e.faces[0]];return{p1:vertices[e.v1],p2:vertices[e.v2],kind:e.kind==='internal'?'guide':e.kind,componentId:f?.componentId||''}});

  const names=componentNameMap(rec),componentStats=new Map();
  for(const g of faceGroups.values()){
    const id=g.componentId||'RAW';let c=componentStats.get(id);if(!c){c={componentId:id,name:g.componentName||names.get(id)||id||'Geometry',faces:0,facets:0,area:0,shells:0,closedShells:0};componentStats.set(id,c)}c.faces++;c.facets+=g.facets;c.area+=g.area;
  }
  for(const s of shells){const id=s.componentId||'RAW';let c=componentStats.get(id);if(!c){c={componentId:id,name:names.get(id)||id||'Geometry',faces:0,facets:0,area:0,shells:0,closedShells:0};componentStats.set(id,c)}c.shells++;if(s.closed)c.closedShells++}
  const components=[...componentStats.values()].map(c=>({...c,area:round(c.area,3)})).sort((a,b)=>b.facets-a.facets);
  const closedShells=shells.filter(s=>s.closed).length;
  const sourceTriangles=rec?.counts?.fullSceneTriangles||rec?.counts?.sceneFaces||src.length,coverage=sourceTriangles?Math.min(1,src.length/sourceTriangles):1;
  const topologyComplete=coverage>.9995;
  const topologyMode=sourceIdentityCoverage>=.5?'source-face-blocks':'inferred-smooth-patches';
  return{
    version:'1.5.0',kernel:'ROZFOOD B-Rep Core Alpha',source:'SolidWorks FaceTessellations',geometryModel:'vertex-edge-face-shell',faceIdentity:topologyMode,exactParasolid:false,topologyComplete,coverage:round(coverage,4),sourceFaceIdentityCoverage:round(sourceIdentityCoverage,4),toleranceMm:tol,sharpAngleDeg,
    counts:{vertices:vertices.length,edges:topoEdgeIds.length,meshEdges:edges.length,faces:brepFaces.length,facets:facets.length,shells:shells.length,closedShells:topologyComplete?closedShells:null,boundaryEdges,sharpEdges,smoothEdges,nonManifoldEdges,internalTriangulationEdges:internalEdges,degenerateFacets:skippedDegenerate,displayEdges:displayEdges.length},
    components,faces:brepFaces.slice(0,3000),shells:topologyComplete?shells.slice(0,2000):[],displayEdges,
    note:topologyComplete?'V/E/F/Shell adjacency построена по всей доступной FaceTessellations-сцене; F использует исходные FaceTessellations face-block identities, когда они доступны. Exact Parasolid Surface/Curve/NURBS ещё не декодированы.':'На тяжёлой сборке V/E/F topology построена по display-LOD для сохранения плавности; shell closure не считается точной. Exact Parasolid Surface/Curve/NURBS ещё не декодированы.'
  };
}
