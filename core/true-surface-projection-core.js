// ROZFOOD Engineering Studio v9.0.0 — True Surface Projection Core
// Produces view curves only from reconstructed B-Rep/surface semantics and assigns
// exact surface ownership before HLR. Tessellation remains provenance/trim evidence.

import {analyticViewCurves} from './analytic-geometry.js';
import {reconstructSurfaceModel} from './surface-type-reconstruction.js';
import {reconstructSurfaceTrims} from './surface-trimming-core.js';
import {buildDrawingViewTopology} from '../drawing/drawing-view-topology-core.js';

const norm=a=>{const L=Math.hypot(...a)||1;return a.map(x=>x/L)};const cache=new WeakMap();
function key(d){return norm(d).map(x=>x.toFixed(5)).join(',')}
function faceKeys(c){const s=new Set();if(c.faceKey)s.add(c.faceKey);if(c.source?.faceKey)s.add(c.source.faceKey);for(const k of c.faceKeys||[])s.add(k);return[...s]}
export function buildTrueSurfaceProjection(rec,viewDir,{detail=false,minConfidence=.82,creaseDeg=10,tangentDeg=.8}={}){const d=norm(viewDir),sig=[rec?.faces?.length||0,key(d),detail?1:0,minConfidence,creaseDeg,tangentDeg].join('|');let m=cache.get(rec);if(!m){m=new Map();cache.set(rec,m)}if(m.has(sig))return m.get(sig);const surfaces=reconstructSurfaceModel(rec),trims=reconstructSurfaceTrims(rec),topology=buildDrawingViewTopology(rec,d,{creaseDeg,tangentDeg}),bundle=analyticViewCurves(rec,d,{circleSegments:detail?192:144,minConfidence,detail}),curves=[];let exactOwned=0,trimOwned=0,unowned=0;for(const c of bundle.curves||[]){const fks=faceKeys(c),owners=fks.map(k=>surfaces.surfaces.get(k)).filter(Boolean);if(owners.length)exactOwned++;else unowned++;if(fks.some(k=>trims.domains.has(k)))trimOwned++;curves.push({...c,faceKeys:fks,surfaceOwners:owners.map(s=>({faceKey:s.faceKey,surfaceType:s.type,componentId:s.componentId,confidence:s.confidence})),projectionSource:owners.length?'analytic-surface':'semantic-curve'})}const edges=(topology.edges||[]).map(e=>({...e,projectionSource:'topological-brep'}));const result={version:'9.0.0',kernel:'ROZFOOD True Surface Projection Core',viewDir:d,analytic:{...bundle,curves},topology:{...topology,edges},stats:{surfaceCount:surfaces.counts?.surfaces||0,trimDomains:trims.counts?.domains||0,topologyEdges:edges.length,analyticCurves:curves.length,exactOwned,trimOwned,unowned},note:'Drawing primitives are emitted from reconstructed analytic surfaces and B-Rep topology. Tessellation is retained only as trim/provenance evidence and unsupported-surface fallback.'};m.set(sig,result);rec.trueSurfaceProjection=result;return result}
