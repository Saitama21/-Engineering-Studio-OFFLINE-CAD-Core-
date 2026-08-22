import {parseSLDASM} from './import/sldasm-adapter.js';
import {recognizeTessellationGeometry,recognitionDimensions} from './core/tess-recognition.js';

function slimForTransfer(rec,dimensions){
  // Safari/WebKit can hit its JS/structured-clone stack on very large, deeply repeated
  // CAD object graphs. Keep geometry, but remove repeated nested instance/feature objects.
  for(const f of rec?.faces||[]){
    if(f.instance){f.componentName=f.instance.name||'';delete f.instance;}
  }
  const R=rec?.recognition;
  if(R){
    for(const listName of ['planes','cylinders','holes','outerCylinders']){
      for(const x of R[listName]||[]){if(x.instance){x.componentName=x.instance.name||'';delete x.instance;}}
    }
  }
  return (dimensions||[]).map(d=>{const o={...d};delete o.feature;return o;});
}

self.onmessage=async e=>{
  let stage='start';
  try{
    const {kind,buffer,fileName}=e.data;
    if(kind!=='sldasm')throw new Error('Этот Import Core принимает только .SLDASM.');
    const t0=performance.now();
    stage='parse-sldasm';
    const rec=await parseSLDASM(buffer,fileName);
    stage='tess-recognition';
    if(rec.geometryAvailable){
      rec.recognition=recognizeTessellationGeometry(rec);
      rec.counts.planes=rec.recognition.counts.planes;
      rec.counts.cylinders=rec.recognition.counts.cylinders;
      rec.counts.holes=rec.recognition.counts.holes;
      rec.counts.recognizedAxes=rec.recognition.counts.axes;
    }
    stage='dimensions';
    let dimensions=rec.geometryAvailable?recognitionDimensions(rec,rec.recognition,{limit:24}):[];
    const types=rec.recognition?['plane','cylinder','hole','axis']:[];
    stage='prepare-transfer';
    dimensions=slimForTransfer(rec,dimensions);
    stage='post-message';
    self.postMessage({ok:true,rec,dimensions,types,parseMs:performance.now()-t0,importKind:'sldasm'});
  }catch(err){
    const message=String(err?.message||err);
    try{self.postMessage({ok:false,error:message,stage,stack:String(err?.stack||'').slice(0,3000)});}catch{}
  }
};
