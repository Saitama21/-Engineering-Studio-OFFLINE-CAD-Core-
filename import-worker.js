import {parseSLDASM} from './import/sldasm-adapter.js';
self.onmessage=async e=>{
  try{
    const {kind,buffer,fileName}=e.data;
    if(kind!=='sldasm')throw new Error('Этот Import Core принимает только .SLDASM.');
    const t0=performance.now();
    const rec=await parseSLDASM(buffer,fileName);
    const dimensions=rec.geometryAvailable?[
      {type:'Габарит',label:'X',value:rec.bounds.size[0],unit:'mm',confidence:.92},
      {type:'Габарит',label:'Y',value:rec.bounds.size[1],unit:'mm',confidence:.92},
      {type:'Габарит',label:'Z',value:rec.bounds.size[2],unit:'mm',confidence:.92}
    ]:[];
    self.postMessage({ok:true,rec,dimensions,types:[],parseMs:performance.now()-t0,importKind:'sldasm'});
  }catch(err){self.postMessage({ok:false,error:String(err?.message||err)});}
};
