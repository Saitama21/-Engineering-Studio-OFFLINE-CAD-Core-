import {parseSLDASM} from './import/sldasm-adapter.js';
self.onmessage=e=>{
  try{
    const {kind,buffer,fileName}=e.data;
    if(kind!=='sldasm')throw new Error('Этот Import Core принимает только .SLDASM.');
    const t0=performance.now();
    const rec=parseSLDASM(buffer,fileName);
    self.postMessage({ok:true,rec,dimensions:[],types:[],parseMs:performance.now()-t0,importKind:'sldasm'});
  }catch(err){self.postMessage({ok:false,error:String(err?.message||err)});}
};
