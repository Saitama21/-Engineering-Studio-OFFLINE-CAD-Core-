import {parseSLDASM} from './import/sldasm-adapter.js';
import {recognizeTessellationGeometry,recognitionDimensions} from './core/tess-recognition.js';
import {buildFacetedBRep} from './core/brep-core.js';
import {reconstructTopologicalBRep} from './core/topological-brep-reconstruction.js';
import {orientTopologicalBRep} from './core/brep-orientation-core.js';
import {reconstructSolidRegions} from './core/solid-region-core.js';
import {recognizeManufacturingFeatures,manufacturingDimensions} from './core/manufacturing-recognition.js';
import {renderAssemblyProductionSheet} from './drawing/assembly-production-sheet-v130.js';

// v14.1: the worker owns the full-fidelity CAD record for the whole session.
// The UI receives only a display LOD + metadata; production drawings are rendered here.
const MAX_TRANSFER_FACES=5000;
const MIN_FACES_PER_COMPONENT=36;
const MAX_TRANSFER_EDGES=4000;
let sessionRec=null;
let sessionFileName='';

function liteFace(f){
  return{loops:f?.loops||[],componentId:f?.componentId||'',componentName:f?.instance?.name||f?.componentName||'',tessFaceId:Number.isFinite(f?.tessFaceId)?f.tessFaceId:null,sourceStream:f?.sourceStream||''};
}
function sampledByComponent(src,maxTotal,minPerComp,mapper=x=>x){
  if(!Array.isArray(src)||src.length<=maxTotal)return (src||[]).map(mapper);
  const counts=new Map();for(const x of src){const id=x?.componentId||'RAW';counts.set(id,(counts.get(id)||0)+1)}
  const targets=new Map();let base=0,excess=0;
  for(const [id,count] of counts){const b=Math.min(count,minPerComp);targets.set(id,b);base+=b;excess+=Math.max(0,count-b)}
  const remaining=Math.max(0,maxTotal-base);
  if(remaining&&excess)for(const [id,count] of counts){const b=targets.get(id)||0;targets.set(id,Math.min(count,b+Math.floor(remaining*Math.max(0,count-b)/excess)))}
  let used=[...targets.values()].reduce((a,b)=>a+b,0);if(used<maxTotal){for(const [id,count] of [...counts.entries()].sort((a,b)=>b[1]-a[1])){if(used>=maxTotal)break;const t=targets.get(id)||0,add=Math.min(count-t,maxTotal-used);targets.set(id,t+add);used+=add}}
  const seen=new Map(),out=[];for(const x of src){const id=x?.componentId||'RAW',count=counts.get(id)||1,target=targets.get(id)||0,n=(seen.get(id)||0)+1;seen.set(id,n);if(Math.floor(n*target/count)>Math.floor((n-1)*target/count))out.push(mapper(x))}
  return out;
}
function stripInstance(x){if(!x||typeof x!=='object')return x;const o={...x};if(o.instance){o.componentName=o.instance.name||o.componentName||'';delete o.instance}return o}
function transferRecord(rec){
  const recognition=rec.recognition?{...rec.recognition}:null;
  if(recognition)for(const k of ['planes','cylinders','holes','outerCylinders'])recognition[k]=(rec.recognition[k]||[]).map(stripInstance);
  const faces=sampledByComponent(rec.faces||[],MAX_TRANSFER_FACES,MIN_FACES_PER_COMPONENT,liteFace);
  const edges=sampledByComponent(rec.edges||[],MAX_TRANSFER_EDGES,18,e=>({kind:e.kind,points:e.points||[],p1:e.p1,p2:e.p2,componentId:e.componentId||'',faceKeys:e.faceKeys||[]}));
  const brep=rec.brep?{counts:rec.brep.counts,components:rec.brep.components,coverage:rec.brep.coverage,topologyComplete:rec.brep.topologyComplete,diagnostics:rec.brep.diagnostics}:null;
  const out={...rec,faces,edges,recognition,brep,
    brepOrientation:rec.brepOrientation?{counts:rec.brepOrientation.counts}:null,
    solidRegions:rec.solidRegions?{counts:rec.solidRegions.counts}:null,
    surfaceTrims:undefined,analyticGeometry:undefined,surfaceModel:undefined,parametricHelicoids:undefined,
    adaptiveParametricPatches:undefined,analyticFaceHLR:undefined,topologicalBRep:undefined,topologyHealing:undefined,brepHealed:undefined,productionViewSynthesis:undefined,
    productionDraftingGraph:undefined,drawingComposition:undefined,sectionContext:undefined};
  out.counts={...(rec.counts||{}),displayTriangles:faces.length,fullSceneTriangles:rec.faces?.length||0,displayEdges:edges.length};
  out.transfer={mode:'ui-lod-v14.1',fullTriangles:rec.faces?.length||0,displayTriangles:faces.length,fullEdges:rec.edges?.length||0,displayEdges:edges.length};
  if(out.nativeAssembly)out.nativeAssembly={...out.nativeAssembly,transferMode:out.transfer.mode,displayTriangles:faces.length,fullSceneTriangles:rec.faces?.length||0};
  return out;
}
function transportReplacer(key,value){
  if(typeof value==='function'||typeof value==='symbol')return undefined;
  if(typeof value==='bigint')return {$rozType:'BigInt',value:String(value)};
  if(value instanceof Map)return {$rozType:'Map',entries:[...value.entries()]};
  if(value instanceof Set)return {$rozType:'Set',values:[...value.values()]};
  if(value instanceof Error)return {$rozType:'Error',name:value.name,message:value.message,stack:value.stack||''};
  return value;
}
function sendPayload(payload){
  const json=JSON.stringify(payload,transportReplacer);if(!json)throw new Error('Transport serialization produced an empty payload.');
  const bytes=new TextEncoder().encode(json);self.postMessage({ok:true,transport:'json-buffer-v2',payloadBuffer:bytes.buffer,transportBytes:bytes.byteLength},[bytes.buffer]);
}
function svgMock(){const attrs=new Map();return{attrs,setAttribute(k,v){attrs.set(k,String(v))},innerHTML:''}}
function renderWorkerDrawing(req){
  if(!sessionRec)throw new Error('Full CAD session is not ready. Re-import SLDASM.');
  const svg=svgMock(),t0=performance.now();
  renderAssemblyProductionSheet(svg,sessionRec,{projectName:req.projectName||sessionRec.nativeAssembly?.root||'SLDASM',fileName:req.fileName||sessionFileName,theme:req.theme||'light',mode:req.mode||'assemblyDetailed'});
  const renderMs=performance.now()-t0,viewBox=svg.attrs.get('viewBox')||'0 0 1684 1191';
  self.postMessage({ok:true,kind:'drawing-ready',requestId:req.requestId||'',cacheKey:req.cacheKey||'',mode:req.mode||'assemblyDetailed',theme:req.theme||'light',viewBox,html:svg.innerHTML,renderMs,qa:sessionRec.productionDrawingQA||null,fidelity:sessionRec.drawingFidelity||null});
}

self.onmessage=async e=>{
  let stage='start';
  try{
    const data=e.data||{};
    if(data.kind==='render-drawing'){
      stage='worker-drawing-render';renderWorkerDrawing(data);return;
    }
    const {kind,buffer,fileName}=data;
    if(kind!=='sldasm')throw new Error('Этот Import Core принимает только .SLDASM.');
    const t0=performance.now();stage='parse-sldasm';
    const rec=await parseSLDASM(buffer,fileName);
    stage='tess-recognition';
    if(rec.geometryAvailable){
      rec.recognition=recognizeTessellationGeometry(rec,{maxFeatures:1200});
      Object.assign(rec.counts,{planes:rec.recognition.counts.planes,cylinders:rec.recognition.counts.cylinders,holes:rec.recognition.counts.holes,recognizedAxes:rec.recognition.counts.axes,verifiedPlanes:rec.recognition.counts.verifiedPlanes||0,verifiedCylinders:rec.recognition.counts.verifiedCylinders||0,verifiedHoles:rec.recognition.counts.verifiedHoles||0});
    }
    stage='feature-recognition-v2';
    if(rec.geometryAvailable){
      rec.manufacturing=recognizeManufacturingFeatures(rec);const mc=rec.manufacturing.counts||{};
      Object.assign(rec.counts,{featureHoles:mc.holes||0,chamfers:mc.chamfers||0,fillets:mc.fillets||0,threadCandidates:mc.threads||0,sheetMetal:mc.sheetMetal||0,bends:mc.bends||0});
    }
    stage='dimensions';
    let dimensions=rec.geometryAvailable?[...recognitionDimensions(rec,rec.recognition,{limit:36}),...manufacturingDimensions(rec.manufacturing,{limit:36})]:[];
    dimensions=(dimensions||[]).map(d=>{const o={...d};delete o.feature;return o});
    const types=rec.recognition?['plane','cylinder','hole','axis','brep-topology','chamfer','fillet','thread-candidate','sheet-metal','bend']:[];

    // Build exact topology on the full record BEFORE creating the UI LOD.
    stage='topological-brep-core-v14.1';
    if(rec.geometryAvailable){
      const faceted=buildFacetedBRep(rec,{maxDisplayEdges:42000,sharpAngleDeg:28});
      rec.brep=reconstructTopologicalBRep(rec,{maxDisplayEdges:42000});
      rec.brepOrientation=orientTopologicalBRep(rec);rec.solidRegions=reconstructSolidRegions(rec);
      rec.edges=rec.brep.displayEdges?.length?rec.brep.displayEdges:(faceted.displayEdges||[]);
      const bc=rec.brep.counts||{};
      Object.assign(rec.counts,{brepOrientedFaces:rec.brepOrientation?.counts?.faces||0,brepLoopReversals:rec.brepOrientation?.counts?.loopReversals||0,brepOrientationConflicts:rec.brepOrientation?.counts?.orientationConflicts||0,solidRegions:rec.solidRegions?.counts?.regions||0,materialRegions:rec.solidRegions?.counts?.materialRegions||0,voidRegions:rec.solidRegions?.counts?.voidRegions||0,brepVertices:bc.vertices||0,brepEdges:bc.edges||0,brepFaces:bc.faces||0,brepShells:bc.shells||0,brepClosedShells:bc.closedShells,vertices:bc.vertices||rec.counts.vertices,edges:bc.edges||0,shells:bc.shells||0});
      if(Number.isFinite(bc.closedShells))rec.counts.solids=bc.closedShells;
    }
    sessionRec=rec;sessionFileName=fileName||'';

    stage='prepare-ui-lod';const uiRec=transferRecord(rec);
    stage='serialize-transfer';sendPayload({rec:uiRec,dimensions,types,parseMs:performance.now()-t0,importKind:'sldasm'});
  }catch(err){
    const message=String(err?.message||err);try{self.postMessage({ok:false,kind:e.data?.kind==='render-drawing'?'drawing-error':'import-error',requestId:e.data?.requestId||'',cacheKey:e.data?.cacheKey||'',error:message,stage,stack:String(err?.stack||'').slice(0,3000)});}catch{}
  }
};
