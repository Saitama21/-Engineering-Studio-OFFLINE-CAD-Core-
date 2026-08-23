// ROZFOOD Engineering Studio v10.0.0 — Unified Drawing View Core
// Surface-first projection + face visibility. v10.0 consumes True Surface Projection Core
// so topology edges and analytic curves share one B-Rep/surface ownership model.

import {reconstructViewDependentSurfaceVisibility} from '../core/view-dependent-surface-visibility-core.js';
import {buildTrueSurfaceProjection} from '../core/true-surface-projection-core.js';

const cache=new WeakMap();
const norm=a=>{const L=Math.hypot(...a)||1;return a.map(v=>v/L)};
function dirKey(d){return norm(d).map(x=>x.toFixed(5)).join(',')}
function keysForCurve(c){const s=new Set();if(c?.faceKey)s.add(c.faceKey);if(c?.sourceSurface?.faceKey)s.add(c.sourceSurface.faceKey);for(const k of c?.faceKeys||[])if(k)s.add(k);for(const k of c?.source?.faceKeys||[])if(k)s.add(k);return[...s]}
function statusForFaces(ids,vis){return(ids||[]).map(id=>vis.faces.get(id)).filter(Boolean)}
function allProvablyHidden(list){return list.length>0&&list.every(x=>x.foreignOccludedFraction>=.82&&(x.state==='foreign-occluded'||x.state==='back-foreign-occluded'))}
function anyDrawable(list){return !list.length||list.some(x=>x.drawBoundary||x.drawInterior||x.state==='partial')}

export function buildUnifiedDrawingView(rec,viewDir,{detail=false,minConfidence,creaseDeg,tangentDeg,samplesPerFace}={}){
  const d=norm(viewDir),sig=[rec?.faces?.length||0,dirKey(d),detail?1:0,minConfidence??'',creaseDeg??'',tangentDeg??'',samplesPerFace??''].join('|');let byDir=cache.get(rec);if(!byDir){byDir=new Map();cache.set(rec,byDir)}if(byDir.has(sig))return byDir.get(sig);
  const visibility=reconstructViewDependentSurfaceVisibility(rec,d,{samplesPerFace:samplesPerFace??(detail?9:7)});
  const projection=buildTrueSurfaceProjection(rec,d,{detail,minConfidence:minConfidence??(detail?.78:.82),creaseDeg:creaseDeg??(detail?6:10),tangentDeg:tangentDeg??(detail?.45:.8)});
  const topology=projection.topology,analyticBundle=projection.analytic;
  const topologyEdges=[];let topologySuppressed=0,topologyBackSuppressed=0,silhouetteKept=0;
  for(const e of topology.edges||[]){const fs=statusForFaces(e.faceIds,visibility);if(e.kind==='SILHOUETTE'){
      if(allProvablyHidden(fs)){topologySuppressed++;continue}silhouetteKept++;topologyEdges.push(e);continue;
    }
    if(!anyDrawable(fs)){topologySuppressed++;if(fs.some(x=>x.orientation==='back'))topologyBackSuppressed++;continue}
    if(e.kind==='FEATURE'&&fs.length&&fs.every(x=>!x.drawInterior)){topologySuppressed++;continue}
    topologyEdges.push(e);
  }
  const curves=[];let analyticSuppressed=0,analyticUnowned=0,analyticSilhouettes=0;
  for(const c of analyticBundle.curves||[]){if(c.silhouette||c.role==='surface-silhouette'){analyticSilhouettes++;curves.push(c);continue}
    const keys=keysForCurve(c);if(!keys.length){analyticUnowned++;curves.push(c);continue}
    const fs=keys.map(k=>visibility.byKey.get(k)).filter(Boolean);if(fs.length&&allProvablyHidden(fs)){analyticSuppressed++;continue}if(fs.length&&fs.every(x=>!x.drawBoundary&&!x.drawInterior)){analyticSuppressed++;continue}curves.push(c);
  }
  const result={version:'10.0.0',kernel:'ROZFOOD Unified Drawing View Core',viewDir:d,visibility,trueSurfaceProjection:projection,topology:{...topology,edges:topologyEdges},analyticBundle:{...analyticBundle,curves},stats:{faceVisibility:visibility.stats,trueSurfaceProjection:projection.stats,topologyInput:topology.edges?.length||0,topologyOutput:topologyEdges.length,topologySuppressed,topologyBackSuppressed,silhouetteKept,analyticInput:analyticBundle.curves?.length||0,analyticOutput:curves.length,analyticSuppressed,analyticUnowned,analyticSilhouettes},note:'v10.0 projects from reconstructed surfaces/B-Rep first; Face visibility is a coarse pre-pass and Analytic Face HLR is the final exact surface occlusion solver.'};
  byDir.set(sig,result);rec.unifiedDrawingView=result;return result;
}
export function unifiedDrawingViewStats(rec,viewDir,opts){return buildUnifiedDrawingView(rec,viewDir,opts).stats}
