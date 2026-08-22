import {parseSTEP} from './import/step-parser.js';
import {recognizeSTEP,makeDimensionSet} from './recognition/feature-recognizer.js';
self.onmessage=e=>{
  try{
    const {text,fileName}=e.data; const t0=performance.now(); const model=parseSTEP(text,fileName); const rec=recognizeSTEP(model); const dimensions=makeDimensionSet(rec);
    const types=[...model.byType.entries()].map(([type,arr])=>[type,arr.length]).sort((a,b)=>b[1]-a[1]);
    self.postMessage({ok:true,rec,dimensions,types,parseMs:performance.now()-t0});
  }catch(err){self.postMessage({ok:false,error:String(err?.message||err)});}
};
