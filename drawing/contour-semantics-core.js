// ROZFOOD Engineering Studio v5.0.0 — Contour Semantics Core
// Classifies shared assembly edges using per-component face semantics instead of
// mixing normals from unrelated bodies. This prevents contact seams from becoming
// false heavy silhouettes while preserving real outer silhouettes and creases.
import {analyzeSurfaceContinuity} from '../core/surface-continuity.js';

const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const norm=a=>{const l=Math.hypot(...a)||1;return[a[0]/l,a[1]/l,a[2]/l]};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

function localClass(normals,viewDir,{featureCos=.985,tangentCos=.9996}={}){
  const ns=normals||[],d=norm(viewDir);
  if(ns.length<=1)return{kind:'BOUNDARY',draw:true};
  let silhouette=false,maxNormalAngle=0;
  for(let i=0;i<ns.length;i++)for(let j=i+1;j<ns.length;j++){
    const nd=clamp(dot(ns[i],ns[j]),-1,1);
    maxNormalAngle=Math.max(maxNormalAngle,Math.acos(nd));
    {const di=dot(ns[i],d),dj=dot(ns[j],d);if(di*dj<-1e-5)silhouette=true;}
  }
  if(silhouette)return{kind:'SILHOUETTE',draw:true};
  const pairCos=Math.cos(maxNormalAngle);
  if(pairCos>=tangentCos)return{kind:'TESSELLATION',draw:false};
  if(pairCos>=featureCos)return{kind:'TANGENT',draw:false};
  return{kind:'FEATURE',draw:true};
}


function facePairKey(a,b){return a<b?a+'||'+b:b+'||'+a}
function contributorHasSmoothBoundary(c,rec){
  const keys=[...new Set(c?.faceKeys||[])].filter(Boolean);if(keys.length<2)return false;
  const C=analyzeSurfaceContinuity(rec);
  for(let i=0;i<keys.length;i++)for(let j=i+1;j<keys.length;j++)if(C.g1FacePairs.has(facePairKey(keys[i],keys[j])))return true;
  return false;
}

function weldPairSet(rec){
  const set=new Set();
  for(const j of rec?.weldedAssembly?.joints||[]){
    if(!j?.a||!j?.b)continue;
    set.add([j.a,j.b].sort().join('|'));
  }
  return set;
}
function isWeldedContributorSet(contributors,rec){
  if((contributors||[]).length<2)return false;
  const set=weldPairSet(rec),ids=[...new Set(contributors.map(c=>c.componentId).filter(Boolean))];
  for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++)if(set.has([ids[i],ids[j]].sort().join('|')))return true;
  return false;
}

/**
 * Edge semantics are determined inside each physical component first. Normals from
 * separate touching parts are never allowed to manufacture a silhouette by themselves.
 *
 * Returned roles:
 *  OUTER_CONTOUR  true silhouette of at least one body
 *  FEATURE_EDGE   real crease/form edge
 *  OPEN_BOUNDARY  free/open CAD boundary
 *  CONTACT_EDGE   coincident assembly interface (suppressed by default)
 */
export function classifyContourEdge(edge,viewDir,rec,options={}){
  const contributors=edge?.contributors?.length?edge.contributors:[{componentId:edge?.componentId,normals:edge?.normals||[],faceKeys:edge?.faceKeys||[]}];
  const local=contributors.map(c=>({...localClass(c.normals,viewDir,options),componentId:c.componentId}));
  const multi=[...new Set(contributors.map(c=>c.componentId).filter(Boolean))].length>1;
  if(!multi){
    // v4.0: a shared source-face boundary with verified near-identical surface normals is
    // a G1 continuity seam, not a manufacturable drawing edge. Suppress it before it can
    // be promoted by tessellation noise into a false feature/silhouette.
    if(contributorHasSmoothBoundary(contributors[0],rec))return{kind:'TANGENT',role:'SMOOTH_TANGENCY',draw:false,local,continuity:'G1'};
    const c=local[0]||localClass(edge?.normals||[],viewDir,options);
    if(c.kind==='SILHOUETTE')return{kind:'SILHOUETTE',role:'OUTER_CONTOUR',draw:true,local};
    if(c.kind==='FEATURE')return{kind:'FEATURE',role:'FEATURE_EDGE',draw:true,local};
    if(c.kind==='BOUNDARY')return{kind:'BOUNDARY',role:'OPEN_BOUNDARY',draw:true,local};
    return{...c,role:c.kind,local};
  }

  // Shared physical boundaries are assembly interfaces first. Even when one body's local
  // topology sees the edge as a silhouette, a coincident edge from another body must not
  // be promoted to a heavy exterior contour. Weld interfaces are drawn by the dedicated
  // weld-seam core; ordinary part interfaces remain visible, but only as thin feature lines.
  const welded=isWeldedContributorSet(contributors,rec);
  if(welded)return{kind:'CONTACT',role:'WELD_CONTACT',draw:false,local,multi:true,welded:true};
  if(local.some(c=>c.draw))return{kind:'FEATURE',role:'ASSEMBLY_INTERFACE',draw:true,local,multi:true,welded:false};
  return{kind:'CONTACT',role:'ASSEMBLY_CONTACT',draw:false,local,multi:true,welded:false};
}

export function contourSemanticStats(edges,viewDir,rec,options={}){
  const counts={input:0,drawn:0,suppressedContacts:0,suppressedTangencies:0,outerContours:0,features:0,openBoundaries:0,assemblyInterfaces:0};
  for(const e of edges||[]){counts.input++;const c=classifyContourEdge(e,viewDir,rec,options);if(c.draw)counts.drawn++;if(c.role==='OUTER_CONTOUR')counts.outerContours++;else if(c.role==='FEATURE_EDGE')counts.features++;else if(c.role==='OPEN_BOUNDARY')counts.openBoundaries++;else if(c.role==='ASSEMBLY_INTERFACE')counts.assemblyInterfaces++;else if(c.role==='ASSEMBLY_CONTACT'||c.role==='WELD_CONTACT')counts.suppressedContacts++;else if(c.role==='SMOOTH_TANGENCY')counts.suppressedTangencies++;}
  return counts;
}
