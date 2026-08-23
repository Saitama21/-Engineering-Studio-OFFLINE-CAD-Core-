// ROZFOOD Engineering Studio v6.0.0 — View-Dependent Surface Visibility Core
// Face-first visibility classification for reconstructed B-Rep surfaces.
// Analytic/topological faces decide whether drawing entities should exist before edge HLR.
// FaceTessellations are used only as geometric occlusion evidence through the exact BVH.

import {reconstructTopologicalBRep} from './topological-brep-reconstruction.js';
import {orientTopologicalBRep} from './brep-orientation-core.js';
import {buildExactVisibilityBVH,exactPointVisibility} from './exact-curve-visibility-core.js';

const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const mul=(a,s)=>[a[0]*s,a[1]*s,a[2]*s];
const norm=a=>{const L=Math.hypot(...a)||1;return a.map(v=>v/L)};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const cache=new WeakMap();

function faceKeyOf(f){return f?.faceKey||[f?.componentId||'RAW',f?.modelId||'',f?.sourceStream||'',f?.tessFaceId??''].join('|')}
function centroid3(a,b,c){return[(a[0]+b[0]+c[0])/3,(a[1]+b[1]+c[1])/3,(a[2]+b[2]+c[2])/3]}
function triArea(a,b,c){const ab=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],ac=[c[0]-a[0],c[1]-a[1],c[2]-a[2]],x=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];return Math.hypot(...x)*.5}
function dirKey(d){return norm(d).map(x=>x.toFixed(5)).join(',')}

function sourceGroups(rec){
  const groups=new Map();
  for(const f of rec?.faces||[]){
    const k=faceKeyOf(f);let g=groups.get(k);if(!g)groups.set(k,g={faceKey:k,componentId:String(f.componentId||'RAW'),tris:[],area:0});
    const p=f?.loops?.[0]||[];if(p.length<3)continue;
    for(let i=1;i+1<p.length;i++){const a=p[0],b=p[i],c=p[i+1],area=triArea(a,b,c);if(area<1e-10)continue;g.tris.push({a,b,c,area,centroid:centroid3(a,b,c)});g.area+=area}
  }
  return groups;
}

function chooseSamples(g,maxSamples){
  if(!g?.tris?.length)return[];
  const tris=g.tris.slice().sort((a,b)=>b.area-a.area),out=[];
  // Largest triangles first gives stable broad coverage, then distribute across the tail.
  const first=Math.min(3,tris.length,maxSamples);for(let i=0;i<first;i++)out.push(tris[i].centroid);
  if(out.length<maxSamples&&tris.length>first){const left=maxSamples-out.length,step=(tris.length-first)/left;for(let i=0;i<left;i++){const t=tris[Math.min(tris.length-1,first+Math.floor((i+.5)*step))];if(t)out.push(t.centroid)}}
  return out;
}

export function reconstructViewDependentSurfaceVisibility(rec,viewDir,{samplesPerFace=7,frontEpsilon=1e-5,occludedThreshold=.18}={}){
  const d=norm(viewDir),B=reconstructTopologicalBRep(rec),O=orientTopologicalBRep(rec),bvh=buildExactVisibilityBVH(rec),sig=[rec?.faces?.length||0,B.counts?.faces||0,O.counts?.faces||0,dirKey(d),samplesPerFace].join('|');
  let byDir=cache.get(rec);if(!byDir){byDir=new Map();cache.set(rec,byDir)}if(byDir.has(sig))return byDir.get(sig);
  const groups=sourceGroups(rec),oface=new Map((O.faces||[]).map(f=>[f.faceId,f])),faces=new Map(),byKey=new Map(),occluderPairs=new Map();
  let front=0,back=0,grazing=0,visible=0,occluded=0,partial=0,samples=0,clearSamples=0,selfOccluded=0,foreignOccluded=0,unknown=0;
  for(const f of B.faces||[]){
    const o=oface.get(f.id),n=norm(o?.normal||[0,0,1]),facing=dot(n,d),orientation=facing>frontEpsilon?'front':facing<-frontEpsilon?'back':'grazing';if(orientation==='front')front++;else if(orientation==='back')back++;else grazing++;
    const g=groups.get(f.faceKey),pts=chooseSamples(g,clamp(samplesPerFace,3,15)|0),owners=new Map();let vis=0,hid=0,self=0,foreign=0;
    const edge={componentId:f.componentId,componentIds:[f.componentId],contributors:[{componentId:f.componentId}]};
    for(const p of pts){samples++;const r=exactPointVisibility(p,d,bvh,edge);if(r.visible){vis++;clearSamples++}else{hid++;if(r.reason==='foreign'){foreign++;foreignOccluded++;const owner=String(r.owner||'UNKNOWN');owners.set(owner,(owners.get(owner)||0)+1);const pk=f.componentId+'→'+owner;occluderPairs.set(pk,(occluderPairs.get(pk)||0)+1)}else{self++;selfOccluded++}}}
    const total=Math.max(1,vis+hid),clearFraction=vis/total,foreignFraction=foreign/total,drawableFraction=1-foreignFraction;
    // Important v6.0 rule: self-occlusion is diagnostic, not a pre-generation deletion signal.
    // Open/thin shells and uncertain reconstructed normals can report a same-component hit even when
    // the eventual edge is visible. Only a different body repeatedly in front is strong enough to
    // suppress a Face before HLR. The final exact/raster HLR still resolves self-occlusion precisely.
    let state='visible';
    if(!pts.length){state=orientation==='back'?'back-facing':'unknown';unknown++}
    else if(foreignFraction>=1-occludedThreshold){state=orientation==='back'?'back-foreign-occluded':'foreign-occluded';occluded++}
    else if(foreignFraction<=occludedThreshold){state=orientation==='back'?'back-visible':'visible';visible++}
    else {state='partial';partial++}
    const dominantOccluder=[...owners.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0]||null;
    const info={faceId:f.id,faceKey:f.faceKey,componentId:f.componentId,surfaceType:f.surfaceType,orientation,facing,visibleFraction:drawableFraction,clearFraction,foreignOccludedFraction:foreignFraction,visibleSamples:vis,hiddenSamples:hid,selfOccludedSamples:self,foreignOccludedSamples:foreign,dominantOccluder,state,drawInterior:orientation!=='back'&&foreignFraction<1-occludedThreshold,drawBoundary:foreignFraction<1-occludedThreshold||orientation==='grazing',confidence:pts.length?clamp(.55+.07*pts.length,0,1):.25};
    faces.set(f.id,info);byKey.set(f.faceKey,info);
  }
  const topOccluders=[...occluderPairs.entries()].sort((a,b)=>b[1]-a[1]).slice(0,24).map(([pair,count])=>({pair,count}));
  const result={version:'6.0.0',kernel:'ROZFOOD View-Dependent Surface Visibility Core',viewDir:d,faces,byKey,bvh,stats:{faces:B.counts?.faces||0,front,back,grazing,visible,occluded,partial,unknown,samples,clearSamples,selfOccluded,foreignOccluded,topOccluders},note:'Face visibility is resolved before line generation. Exact BVH ray evidence classifies front/back/grazing B-Rep Faces and cross-component occlusion; edge HLR remains a final precision pass.'};
  byDir.set(sig,result);rec.viewDependentSurfaceVisibility=result;return result;
}

export function faceVisibilityById(rec,viewDir,faceId,opts){return reconstructViewDependentSurfaceVisibility(rec,viewDir,opts).faces.get(faceId)||null}
export function faceVisibilityByKey(rec,viewDir,faceKey,opts){return reconstructViewDependentSurfaceVisibility(rec,viewDir,opts).byKey.get(faceKey)||null}
export function surfaceVisibilityStats(rec,viewDir,opts){return reconstructViewDependentSurfaceVisibility(rec,viewDir,opts).stats}
