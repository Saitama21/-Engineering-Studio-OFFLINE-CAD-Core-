import {parseSLDASM} from './import/sldasm-adapter.js';
import {recognizeTessellationGeometry,recognitionDimensions} from './core/tess-recognition.js';

const MAX_TRANSFER_FACES=80000;
const MIN_FACES_PER_COMPONENT=64;

function liteFace(f){
  return{loops:f?.loops||[],componentId:f?.componentId||'',componentName:f?.instance?.name||f?.componentName||''};
}

function compactFacesForTransfer(rec){
  const src=rec?.faces||[];
  const full=src.length;
  if(!full){rec.counts.displayTriangles=0;return;}

  // Even medium assemblies benefit from removing duplicated normals/source metadata
  // before WebKit structured-clone. For large assemblies we additionally keep a
  // deterministic per-component LOD while preserving exact bounds/recognition.
  if(full<=MAX_TRANSFER_FACES){
    rec.faces=src.map(liteFace);
    rec.counts.displayTriangles=rec.faces.length;
    rec.counts.fullSceneTriangles=full;
    rec.transfer={mode:'full-lite',fullTriangles:full,displayTriangles:rec.faces.length};
    return;
  }

  const counts=new Map();
  for(const f of src){const id=f?.componentId||'RAW';counts.set(id,(counts.get(id)||0)+1);}
  const targets=new Map();let baseSum=0,excessTotal=0;
  for(const [id,count] of counts){const base=Math.min(count,MIN_FACES_PER_COMPONENT);targets.set(id,base);baseSum+=base;excessTotal+=Math.max(0,count-base);}
  let remaining=Math.max(0,MAX_TRANSFER_FACES-baseSum);
  if(remaining>0&&excessTotal>0){
    for(const [id,count] of counts){const base=targets.get(id)||0,excess=Math.max(0,count-base);targets.set(id,Math.min(count,base+Math.floor(remaining*excess/excessTotal)));}
  }
  let targetSum=0;for(const v of targets.values())targetSum+=v;
  // Spend rounding remainder on the largest groups without ever exceeding count.
  if(targetSum<MAX_TRANSFER_FACES){
    const order=[...counts.entries()].sort((a,b)=>b[1]-a[1]);let need=MAX_TRANSFER_FACES-targetSum,oi=0;
    while(need>0&&order.length){const [id,count]=order[oi%order.length],t=targets.get(id)||0;if(t<count){targets.set(id,t+1);need--;}oi++;if(oi>order.length*MAX_TRANSFER_FACES)break;}
  }

  const seen=new Map(),emitted=new Map(),out=[];
  for(const f of src){
    const id=f?.componentId||'RAW',count=counts.get(id)||1,target=targets.get(id)||0;
    const n=(seen.get(id)||0)+1;seen.set(id,n);
    const before=Math.floor((n-1)*target/count),after=Math.floor(n*target/count);
    if(after>before){out.push(liteFace(f));emitted.set(id,(emitted.get(id)||0)+1);}
  }
  rec.faces=out;
  rec.counts.fullSceneTriangles=full;
  rec.counts.displayTriangles=out.length;
  rec.transfer={mode:'large-assembly-lod',fullTriangles:full,displayTriangles:out.length,componentCount:counts.size,maxTransferFaces:MAX_TRANSFER_FACES};
  if(rec.nativeAssembly){rec.nativeAssembly.transferMode=rec.transfer.mode;rec.nativeAssembly.displayTriangles=out.length;rec.nativeAssembly.fullSceneTriangles=full;}
}

function slimForTransfer(rec,dimensions){
  const R=rec?.recognition;
  if(R){
    for(const listName of ['planes','cylinders','holes','outerCylinders']){
      for(const x of R[listName]||[]){if(x.instance){x.componentName=x.instance.name||'';delete x.instance;}}
    }
  }
  compactFacesForTransfer(rec);
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
      rec.recognition=recognizeTessellationGeometry(rec,{maxFeatures:1200});
      rec.counts.planes=rec.recognition.counts.planes;
      rec.counts.cylinders=rec.recognition.counts.cylinders;
      rec.counts.holes=rec.recognition.counts.holes;
      rec.counts.recognizedAxes=rec.recognition.counts.axes;
    }
    stage='dimensions';
    let dimensions=rec.geometryAvailable?recognitionDimensions(rec,rec.recognition,{limit:36}):[];
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
