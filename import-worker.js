import {parseSTEP} from './import/step-parser.js';
import {parseSLDASM} from './import/sldasm-adapter.js';
import {recognizeSTEP,makeDimensionSet} from './recognition/feature-recognizer.js';
self.onmessage=e=>{
  try{
    const {kind='step',text,buffer,fileName}=e.data; const t0=performance.now();
    if(kind==='sldasm'){
      const rec=parseSLDASM(buffer,fileName);
      self.postMessage({ok:true,rec,dimensions:[],types:[],parseMs:performance.now()-t0,importKind:'sldasm'});return;
    }
    const model=parseSTEP(text,fileName); const rec=recognizeSTEP(model); const dimensions=makeDimensionSet(rec);
    rec.geometryAvailable=true;rec.format='STEP';
    const types=[...model.byType.entries()].map(([type,arr])=>[type,arr.length]).sort((a,b)=>b[1]-a[1]);
    self.postMessage({ok:true,rec,dimensions,types,parseMs:performance.now()-t0,importKind:'step'});
  }catch(err){self.postMessage({ok:false,error:String(err?.message||err)});}
};
