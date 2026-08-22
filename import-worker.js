import {parseSLDASM} from './import/sldasm-adapter.js';
import {recognizeTessellationGeometry,recognitionDimensions} from './core/tess-recognition.js';
self.onmessage=async e=>{
  try{
    const {kind,buffer,fileName}=e.data;
    if(kind!=='sldasm')throw new Error('Этот Import Core принимает только .SLDASM.');
    const t0=performance.now();
    const rec=await parseSLDASM(buffer,fileName);
    if(rec.geometryAvailable){
      rec.recognition=recognizeTessellationGeometry(rec);
      rec.counts.planes=rec.recognition.counts.planes;
      rec.counts.cylinders=rec.recognition.counts.cylinders;
      rec.counts.holes=rec.recognition.counts.holes;
      rec.counts.recognizedAxes=rec.recognition.counts.axes;
    }
    const dimensions=rec.geometryAvailable?recognitionDimensions(rec,rec.recognition,{limit:24}):[];
    const types=rec.recognition?['plane','cylinder','hole','axis']:[];
    self.postMessage({ok:true,rec,dimensions,types,parseMs:performance.now()-t0,importKind:'sldasm'});
  }catch(err){self.postMessage({ok:false,error:String(err?.message||err)});}
};
