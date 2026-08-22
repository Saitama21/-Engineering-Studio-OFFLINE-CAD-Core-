const EXT_RE=/\.sldasm$/i;
const MODERN_MARKER=new Uint8Array([0x14,0x00,0x06,0x00,0x08,0x00]);
const FACE_PATTERN=new Uint8Array([0x64,0,0,0,0x02,0,0,0]);
const MAX_NAME=512,MAX_COMPRESSED=64*1024*1024;

function appendAll(dst,src){
  if(!src?.length)return dst;
  for(let i=0;i<src.length;i++)dst.push(src[i]);
  return dst;
}

function asBytes(input){
  if(input instanceof Uint8Array)return input;
  if(input instanceof ArrayBuffer)return new Uint8Array(input);
  if(ArrayBuffer.isView(input))return new Uint8Array(input.buffer,input.byteOffset,input.byteLength);
  throw new Error('SLDASM decoder: expected ArrayBuffer/Uint8Array');
}
function u32(bytes,off){if(off<0||off+4>bytes.length)return 0;return(bytes[off]|(bytes[off+1]<<8)|(bytes[off+2]<<16)|(bytes[off+3]<<24))>>>0}
function f32(bytes,off){if(off<0||off+4>bytes.length)return NaN;return new DataView(bytes.buffer,bytes.byteOffset+off,4).getFloat32(0,true)}
function findPattern(bytes,pat,start=0){outer:for(let i=Math.max(0,start);i<=bytes.length-pat.length;i++){for(let j=0;j<pat.length;j++)if(bytes[i+j]!==pat[j])continue outer;return i}return-1}
function rolByte(b,shift){shift&=7;if(!shift)return b;return((b<<shift)|(b>>(8-shift)))&255}
function decodeRol(bytes,key){let s='';for(const b of bytes)s+=String.fromCharCode(rolByte(b,key));return s}
function validStreamName(name){if(!name)return false;for(let i=0;i<name.length;i++){const c=name.charCodeAt(i);if(c<0x20||c>=0x80)return false}return true}
function baseName(path=''){return String(path).replace(/\\/g,'/').split('/').pop().trim()}
function stemName(path=''){return baseName(path).replace(/\.(?:sldasm|sldprt)$/i,'')}
function decodeXmlEntities(s=''){return String(s).replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&')}
function parseAttrs(src=''){const out={};const re=/([\w:.-]+)="([^"]*)"/g;let m;while((m=re.exec(src)))out[m[1]]=decodeXmlEntities(m[2]);return out}
function matrixFromAttr(s=''){const a=String(s).trim().split(/\s+/).map(Number).filter(Number.isFinite);return a.length===16?a:null}
function bboxFromAttrMm(s=''){const a=String(s).trim().split(/\s+/).map(Number).filter(Number.isFinite);return a.length===6?a.map(v=>v*1000):null}
function identity4(){return[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}
function mul4(a,b){const o=new Array(16).fill(0);for(let r=0;r<4;r++)for(let c=0;c<4;c++)for(let k=0;k<4;k++)o[r*4+c]+=a[r*4+k]*b[k*4+c];return o}
function transformPointMm(p,m){const[x,y,z]=p;return[x*m[0]+y*m[4]+z*m[8]+m[12]*1000,x*m[1]+y*m[5]+z*m[9]+m[13]*1000,x*m[2]+y*m[6]+z*m[10]+m[14]*1000]}
function transformNormal(n,m){const[x,y,z]=n;let q=[x*m[0]+y*m[4]+z*m[8],x*m[1]+y*m[5]+z*m[9],x*m[2]+y*m[6]+z*m[10]];const l=Math.hypot(...q)||1;return q.map(v=>v/l)}

async function inflateRaw(data){
  if(typeof DecompressionStream==='undefined')throw new Error('Браузер не поддерживает DecompressionStream; нужен Safari/Chrome/Edge с deflate-raw.');
  const stream=new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
function looksModern(bytes){const lim=Math.min(bytes.length,64);return findPattern(bytes.subarray(0,lim),MODERN_MARKER,0)>=0}

async function parseModernStreams(bytes){
  if(!looksModern(bytes))return null;
  const key=bytes[7]||0,streams=new Map(),streamInfo=[];let pos=0,chunkCount=0,inflateErrors=0;
  while(true){
    const markerPos=findPattern(bytes,MODERN_MARKER,pos);if(markerPos<0)break;
    if(markerPos<4){pos=markerPos+1;continue}
    const si=markerPos-4;if(si+0x1e>bytes.length){pos=markerPos+1;continue}
    const f1=u32(bytes,si+0x0e),csz=u32(bytes,si+0x12),usz=u32(bytes,si+0x16),nsz=u32(bytes,si+0x1a);
    if(nsz>MAX_NAME||csz>MAX_COMPRESSED){pos=markerPos+1;continue}
    const nameStart=si+0x1e,nameEnd=nameStart+nsz;if(nameEnd>bytes.length){pos=markerPos+1;continue}
    const name=decodeRol(bytes.subarray(nameStart,nameEnd),key);if(!validStreamName(name)){pos=markerPos+1;continue}
    const inline=f1>=65536;chunkCount++;streamInfo.push({name,compressedSize:csz,uncompressedSize:usz,inline,offset:si});
    const wanted=name==='swXmlContents/COMPINSTANCETREE'||name==='PreviewPNG'||name==='FaceTessellations/Directory'||name.startsWith('FaceTessellations/')||name==='Contents/DisplayLists'||name.startsWith('docProps/');
    if(inline&&csz>0&&nameEnd+csz<=bytes.length){
      if(wanted&&!streams.has(name)){try{streams.set(name,await inflateRaw(bytes.subarray(nameEnd,nameEnd+csz)))}catch{inflateErrors++}}
      pos=nameEnd+csz;continue;
    }
    if(inline&&csz===0&&wanted&&!streams.has(name))streams.set(name,new Uint8Array());
    pos=markerPos+MODERN_MARKER.length;
  }
  return{key,streams,streamInfo,chunkCount,inflateErrors};
}
function textUtf8(bytes){try{return new TextDecoder('utf-8',{fatal:false}).decode(bytes)}catch{return''}}

function parseComponentTreeXml(xml,fileName){
  if(!xml)return null;
  const files=new Map(),fileOrder=[];
  for(const m of xml.matchAll(/<swFile\b([^>]*)\/>/g)){
    const a=parseAttrs(m[1]);if(!a.id)continue;
    const f={id:a.id,path:a.swPath||'',type:(a.swDocType||'').toLowerCase(),creationTime:a.swCreationTime||''};files.set(a.id,f);fileOrder.push(f);
  }
  const models=new Map(),modelOrder=[];
  const modelRe=/<swModel\b([^>]*?)(?:\/>|>([\s\S]*?)<\/swModel>)/g;let mm;
  while((mm=modelRe.exec(xml))){
    const a=parseAttrs(mm[1]),inner=mm[2]||'',refs=[];
    for(const r of inner.matchAll(/<swReference\b([^>]*)\/>/g)){const ra=parseAttrs(r[1]);refs.push({...ra,transform:matrixFromAttr(ra.swTransform)})}
    if(a.id){const file=files.get(a.swFileRef)||{};const rec={id:a.id,attrs:a,refs,bboxMm:bboxFromAttrMm(a.swBoundingBox),file:file.path||'',fileName:baseName(file.path||''),type:file.type||''};models.set(a.id,rec);modelOrder.push(rec)}
  }
  const rootFile=fileOrder[0]||{id:'',path:fileName,type:'assembly'};
  const rootCandidates=modelOrder.filter(m=>m.attrs.swFileRef===rootFile.id&&m.refs.length);
  const rootModel=rootCandidates.find(m=>String(m.attrs.swConfigurationId)==='0')||rootCandidates[0]||null;
  const occurrences=[];
  // Iterative traversal: avoids browser call-stack limits on deeply/nestingly referenced assemblies.
  // A path-local guard still prevents cycles in malformed/native reference graphs.
  if(rootModel){
    const stack=[{model:rootModel,parentId:'SW-ROOT',parentTransform:identity4(),depth:0,pathGuard:new Set()}];
    while(stack.length){
      const node=stack.pop();
      const model=node.model;if(!model||node.depth>64)continue;
      const guard=new Set(node.pathGuard||[]);if(guard.has(model.id))continue;guard.add(model.id);
      const children=[];
      for(let i=0;i<model.refs.length;i++){
        const ref=model.refs[i];if(String(ref.swSuppressed||'NO').toUpperCase()==='YES')continue;
        const childModel=models.get(ref.swModelRef),file=files.get(childModel?.attrs?.swFileRef)||{};
        const local=ref.transform||identity4();
        // SolidWorks stores these 4×4 transforms for row-vector multiplication.
        // Child local → parent is `local`; parent → world is `parentTransform`.
        const world=mul4(local,node.parentTransform);
        const name=ref.swName||ref.swComponentName||childModel?.attrs?.swName||baseName(file.path)||`Component ${i+1}`;
        const occ={id:`SW-${occurrences.length+1}`,name,parent:node.parentId||'SW-ROOT',modelRef:ref.swModelRef||'',file:file.path||'',fileName:baseName(file.path||''),type:file.type==='assembly'?'assembly':'part',configuration:ref.swConfigurationName||childModel?.attrs?.swConfigurationName||'',referenceNumber:ref.swReferenceNumber||'',hidden:String(ref.swHidden||'NO').toUpperCase()==='YES',excludeFromBOM:String(ref.swExcludeFromBOM||'NO').toUpperCase()==='YES',localTransform:local,transform:world};
        occurrences.push(occ);
        if(childModel?.refs?.length)children.push({model:childModel,parentId:occ.id,parentTransform:world,depth:node.depth+1,pathGuard:guard});
      }
      // Reverse push preserves the same visible traversal order as the old recursive DFS.
      for(let i=children.length-1;i>=0;i--)stack.push(children[i]);
    }
  }
  const grouped=new Map();
  for(const o of occurrences){if(o.excludeFromBOM)continue;const key=(o.fileName||o.name).toLowerCase();const g=grouped.get(key)||{file:o.fileName||baseName(o.file),name:stemName(o.fileName||o.name),path:o.file,type:o.type,count:0,instances:[]};g.count++;g.instances.push(o.id);grouped.set(key,g)}
  const components=[...grouped.values()].sort((a,b)=>a.type.localeCompare(b.type)||a.name.localeCompare(b.name,undefined,{numeric:true,sensitivity:'base'}));
  const productName=stemName(rootFile.path)||stemName(fileName)||'SolidWorks Assembly';
  const products=[{id:'SW-ROOT',name:productName,type:'assembly'},...components.map((c,i)=>({id:`SW-P-${i+1}`,name:c.name,file:c.file,type:c.type}))];
  const modelDefinitions=modelOrder.map(m=>({id:m.id,name:m.attrs.swName||'',fileRef:m.attrs.swFileRef||'',file:m.file,fileName:m.fileName,type:m.type,configuration:m.attrs.swConfigurationName||'',bboxMm:m.bboxMm,references:m.refs.length,lastModifiedStamp:Number(m.attrs.swLastModifiedStamp)||0}));
  return{root:productName,rootPath:rootFile.path,rootModelId:rootModel?.id||'',files:[...files.values()],models:modelDefinitions,modelDefinitions,components,occurrences,products,swVersion:(xml.match(/\bswVersion="([^"]+)"/)||[])[1]||''};
}

function triangleArea2(a,b,c){const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2];const x=uy*vz-uz*vy,y=uz*vx-ux*vz,z=ux*vy-uy*vx;return x*x+y*y+z*z}
function computeBounds(points){if(!points.length)return{min:[0,0,0],max:[0,0,0],size:[0,0,0],center:[0,0,0]};const mn=[Infinity,Infinity,Infinity],mx=[-Infinity,-Infinity,-Infinity];for(const p of points)for(let i=0;i<3;i++){if(p[i]<mn[i])mn[i]=p[i];if(p[i]>mx[i])mx[i]=p[i]};return{min:mn,max:mx,size:mx.map((x,i)=>x-mn[i]),center:mx.map((x,i)=>(x+mn[i])/2)}}
function unionBounds(a,b){if(!a)return{min:[...b.min],max:[...b.max],size:[0,0,0],center:[0,0,0]};const min=a.min.map((v,i)=>Math.min(v,b.min[i])),max=a.max.map((v,i)=>Math.max(v,b.max[i]));return{min,max,size:max.map((v,i)=>v-min[i]),center:max.map((v,i)=>(v+min[i])/2)}}
function bboxObjFromSix(a){return a?{min:a.slice(0,3),max:a.slice(3,6),size:a.slice(3,6).map((v,i)=>v-a[i]),center:a.slice(3,6).map((v,i)=>(v+a[i])/2)}:null}
function bboxContains(outerSix,inner,tol=.75){if(!outerSix)return false;for(let i=0;i<3;i++)if(inner.min[i]<outerSix[i]-tol||inner.max[i]>outerSix[i+3]+tol)return false;return true}
function bboxNormError(a,bSix){if(!a||!bSix)return Infinity;let mx=0;for(let i=0;i<3;i++){const size=Math.max(Math.abs(bSix[i+3]-bSix[i]),1);mx=Math.max(mx,Math.abs(a.min[i]-bSix[i])/size,Math.abs(a.max[i]-bSix[i+3])/size)}return mx}
function bboxSimilar(aSix,bSix){if(!aSix||!bSix)return false;const A=bboxObjFromSix(aSix),B=bboxObjFromSix(bSix);let e=0;for(let i=0;i<3;i++){const den=Math.max(A.size[i],B.size[i],1);e=Math.max(e,Math.abs(A.min[i]-B.min[i])/den,Math.abs(A.max[i]-B.max[i])/den)}return e<.08}
function blockSignature(b){const q=x=>Math.round(x*4)/4;return[...b.bounds.min.map(q),...b.bounds.max.map(q)].join('|')}

function parseFaceTessellationStream(data,streamName,scale=1000){
  const triangles=[],allPoints=[],faceBlocks=[],blocks=[];let search=0,faceIndex=0;
  while(true){
    const p=findPattern(data,FACE_PATTERN,search);if(p<0)break;search=p+1;const off=p-4;if(off<0||off+16>data.length)continue;
    const edgeCount=u32(data,off),magic=u32(data,off+4),two=u32(data,off+8),vc=u32(data,off+12);if(magic!==100||two!==2||vc<3||vc>200000)continue;
    const posOff=off+16,gap=posOff+vc*12;if(gap+16+vc*12+32>data.length)continue;
    if(u32(data,gap)!==12||u32(data,gap+4)!==100||u32(data,gap+8)!==2||u32(data,gap+12)!==vc)continue;
    const normOff=gap+16,b1=normOff+vc*12;if(u32(data,b1)!==4||u32(data,b1+4)!==8||u32(data,b1+8)!==2)continue;
    const n1=u32(data,b1+12),b1End=b1+16+n1*4;if(b1End+16>data.length)continue;
    if(u32(data,b1End)!==4||u32(data,b1End+4)!==8||u32(data,b1End+8)!==2)continue;
    const n2=u32(data,b1End+12),b2Body=b1End+16,b2End=b2Body+n2*4;if(n2<1||n2>100000||b2End>data.length)continue;
    const stripCounts=[];let sum=0,ok=true;for(let i=0;i<n2;i++){const raw=u32(data,b2Body+i*4);if(((raw+2)&1)!==0){ok=false;break}const n=(raw+2)/2;if(n<3||n>vc){ok=false;break}stripCounts.push(n);sum+=n}if(!ok||sum!==vc)continue;
    const pts=new Array(vc);let finite=true;for(let i=0;i<vc;i++){const q=[f32(data,posOff+i*12)*scale,f32(data,posOff+i*12+4)*scale,f32(data,posOff+i*12+8)*scale];if(!q.every(Number.isFinite)){finite=false;break}pts[i]=q}if(!finite)continue;
    const norms=new Array(vc);for(let i=0;i<vc;i++)norms[i]=[f32(data,normOff+i*12),f32(data,normOff+i*12+4),f32(data,normOff+i*12+8)];
    faceIndex++;let cursor=0,triCount=0;const blockTriangles=[];
    for(let s=0;s<stripCounts.length;s++){
      const n=stripCounts[s];
      for(let j=0;j<n-2;j++){
        let ia=cursor+j,ib=cursor+j+1,ic=cursor+j+2;if(j&1){const t=ia;ia=ib;ib=t}
        const a=pts[ia],b=pts[ib],c=pts[ic];if(triangleArea2(a,b,c)<1e-12)continue;
        const tri={loops:[[a,b,c]],normals:[norms[ia],norms[ib],norms[ic]],tessFaceId:faceIndex,stripId:s+1,sourceStream:streamName};triangles.push(tri);blockTriangles.push(tri);triCount++;
      }
      cursor+=n;
    }
    const bounds=computeBounds(pts);appendAll(allPoints,pts);
    const meta={id:faceIndex,offset:off,edgeCount,vertexCount:vc,stripCount:stripCounts.length,triangleCount:triCount,stream:streamName,bounds:{min:bounds.min,max:bounds.max}};
    faceBlocks.push(meta);blocks.push({...meta,bounds,triangles:blockTriangles});search=Math.max(search,b2End);
  }
  return{triangles,points:allPoints,faceBlocks,blocks};
}

function lookaheadModelError(blocks,start,stream,bboxSix,maxBlocks=14){
  let union=null,best=Infinity;
  for(let i=start;i<Math.min(blocks.length,start+maxBlocks);i++){
    const b=blocks[i];if(b.stream!==stream)break;
    union=unionBounds(union,b.bounds);best=Math.min(best,bboxNormError(union,bboxSix));
  }
  return best;
}
function mapTessellationToModels(blocks,modelDefinitions){
  const leaves=(modelDefinitions||[]).filter(m=>m.references===0&&m.type!=='assembly'&&m.bboxMm);
  const templates=new Map(),assignments=[];let bi=0;
  for(let mi=0;mi<leaves.length&&bi<blocks.length;mi++){
    const model=leaves[mi],next=leaves[mi+1];
    const first=blocks[bi];
    if(!bboxContains(model.bboxMm,first.bounds,1.25)){
      // A display state can omit a leaf model. If the current block fits one of
      // the following models materially better, leave this model unmapped.
      let bestLater=Infinity;for(let k=mi+1;k<Math.min(leaves.length,mi+4);k++)bestLater=Math.min(bestLater,bboxNormError(first.bounds,leaves[k].bboxMm));
      if(bestLater+.03<bboxNormError(first.bounds,model.bboxMm))continue;
    }
    const start=bi,stream=first.stream,firstSig=blockSignature(first);let union=null;
    while(bi<blocks.length){
      const block=blocks[bi];if(bi>start&&block.stream!==stream)break;
      const currentFull=union&&bboxNormError(union,model.bboxMm)<.012;
      if(bi>start&&next?.bboxMm){
        const repeated=currentFull&&blockSignature(block)===firstSig&&bboxSimilar(model.bboxMm,next.bboxMm);
        const exactNextAnchor=currentFull&&bboxNormError(block.bounds,next.bboxMm)<.0005;
        // Some consecutive models have a smaller bounding box fully inside the
        // previous one (rings, bushings, fasteners). In that case containment
        // alone cannot reveal the boundary, so inspect a short look-ahead and
        // switch only when it reconstructs the *next* model very accurately.
        const nextInsideCurrent=bboxContains(model.bboxMm,bboxObjFromSix(next.bboxMm),1.25)&&!bboxSimilar(model.bboxMm,next.bboxMm);
        const nestedBoundary=nextInsideCurrent&&lookaheadModelError(blocks,bi,stream,next.bboxMm)<.0015;
        if(repeated||exactNextAnchor||nestedBoundary)break;
      }
      if(!bboxContains(model.bboxMm,block.bounds,1.25)){
        if(bi>start)break;
      }
      union=unionBounds(union,block.bounds);bi++;
    }
    if(bi===start)continue;
    const selected=blocks.slice(start,bi),tris=[];for(const block of selected)appendAll(tris,block.triangles);
    templates.set(model.id,{model,blocks:selected,triangles:tris,bounds:union});
    assignments.push({modelId:model.id,name:model.name,stream,blockStart:start,blockEnd:bi-1,blocks:selected.length,triangles:tris.length,bboxError:bboxNormError(union,model.bboxMm)});
  }
  return{templates,assignments,leafModels:leaves};
}

function placeModelTemplates(mapping,occurrences){
  const faces=[],points=[],placedOccurrences=[];
  for(const occ of occurrences||[]){
    if(occ.type==='assembly'||occ.hidden)continue;
    const tpl=mapping.templates.get(occ.modelRef);if(!tpl)continue;
    placedOccurrences.push(occ.id);
    for(const tri of tpl.triangles){
      const loop=(tri.loops?.[0]||[]).map(p=>transformPointMm(p,occ.transform));if(loop.length<3)continue;
      const normals=(tri.normals||[]).map(n=>transformNormal(n,occ.transform));
      appendAll(points,loop);
      faces.push({...tri,loops:[loop],normals,componentId:occ.id,modelId:occ.modelRef,instance:{id:occ.id,name:occ.name,fileName:occ.fileName,modelRef:occ.modelRef,parent:occ.parent}});
    }
  }
  return{faces,points,placedOccurrences};
}

function scanAscii(bytes,min=5){const out=[];let start=-1;const printable=b=>b===9||(b>=32&&b<=126);for(let i=0;i<=bytes.length;i++){const ok=i<bytes.length&&printable(bytes[i]);if(ok&&start<0)start=i;if((!ok||i===bytes.length)&&start>=0){if(i-start>=min){let s='';for(let j=start;j<i;j++)s+=String.fromCharCode(bytes[j]);out.push(s)}start=-1}}return out}
function scanUtf16LE(bytes,min=4){const out=[];for(let parity=0;parity<2;parity++){let chars=[];const flush=()=>{if(chars.length>=min)out.push(chars.join(''));chars=[]};for(let i=parity;i+1<bytes.length;i+=2){const code=bytes[i]|(bytes[i+1]<<8),ok=code===9||(code>=32&&code!==0xffff&&!(code>=0xd800&&code<=0xdfff));if(ok)chars.push(String.fromCharCode(code));else flush();if(chars.length>2048)flush()}flush()}return out}
function legacyReferences(bytes,fileName){const all=[...scanAscii(bytes),...scanUtf16LE(bytes)],map=new Map();for(const s of all){for(const raw of(s.match(/(?:[A-Za-z]:[\\/][^\r\n<>|"']{1,240}?\.(?:sldprt|sldasm)|[^\r\n<>|"']{1,180}?\.(?:sldprt|sldasm))/ig)||[])){const file=baseName(raw);if(!/\.(sldprt|sldasm)$/i.test(file)||file.toLowerCase()===baseName(fileName).toLowerCase())continue;const key=file.toLowerCase(),g=map.get(key)||{file,name:file.replace(/\.(sldprt|sldasm)$/i,''),path:raw,type:/\.sldasm$/i.test(file)?'assembly':'part',count:0,instances:[]};g.count++;map.set(key,g)}}return[...map.values()]}
function emptyCounts(){return{entities:0,solids:0,shells:0,faces:0,edges:0,vertices:0,planes:0,cylinders:0,cones:0,tori:0,bsplines:0,sceneFaces:0,sceneEdges:0,sceneComponents:0,tessFaceBlocks:0,sourceTriangles:0,triangles:0,mappedModels:0,mappedOccurrences:0}}

export async function parseSLDASM(input,fileName='assembly.SLDASM'){
  if(!EXT_RE.test(fileName))throw new Error('SLDASM decoder accepts only .SLDASM');
  const bytes=asBytes(input),t0=typeof performance!=='undefined'?performance.now():Date.now();
  const modern=await parseModernStreams(bytes);
  let tree=null,rawTriangles=[],rawPoints=[],faceBlocks=[],allBlocks=[],streamNames=[];
  if(modern){
    streamNames=modern.streamInfo.map(x=>x.name);
    const comp=modern.streams.get('swXmlContents/COMPINSTANCETREE');if(comp)tree=parseComponentTreeXml(textUtf8(comp),fileName);
    const tessNames=[...modern.streams.keys()].filter(n=>/^FaceTessellations\/\d+-\d+-\d+$/i.test(n)).sort();
    for(const name of tessNames){const r=parseFaceTessellationStream(modern.streams.get(name),name,1000);appendAll(rawTriangles,r.triangles);appendAll(rawPoints,r.points);appendAll(faceBlocks,r.faceBlocks);appendAll(allBlocks,r.blocks)}
  }
  let components=tree?.components||[],occurrences=tree?.occurrences||[],products=tree?.products||[],root=tree?.root||stemName(fileName);
  if(!components.length){components=legacyReferences(bytes,fileName).map((x,i)=>({...x,index:i+1}));occurrences=[];for(let i=0;i<components.length;i++)for(let j=0;j<components[i].count;j++)occurrences.push({id:`SW-${i+1}-${j+1}`,name:components[i].name,child:components[i].file,parent:'SW-ROOT',type:components[i].type,source:'SLDASM_LEGACY_SCAN'});products=[{id:'SW-ROOT',name:root,type:'assembly'},...components.map((c,i)=>({id:`SW-P-${i+1}`,name:c.name,file:c.file,type:c.type}))]}

  const mapping=tree?mapTessellationToModels(allBlocks,tree.modelDefinitions):{templates:new Map(),assignments:[],leafModels:[]};
  const placed=tree?placeModelTemplates(mapping,occurrences):{faces:[],points:[],placedOccurrences:[]};
  // If a file has tessellation but no usable component tree, keep the raw local
  // geometry as a fallback instead of showing nothing.
  const faces=placed.faces.length?placed.faces:rawTriangles;
  const points=placed.points.length?placed.points:rawPoints;
  const geometryAvailable=faces.length>0,bounds=computeBounds(points),counts=emptyCounts();
  counts.entities=modern?.chunkCount||0;counts.faces=faceBlocks.length;counts.vertices=rawPoints.length;counts.sceneFaces=faces.length;counts.sceneEdges=faces.length*3;counts.tessFaceBlocks=faceBlocks.length;counts.sourceTriangles=rawTriangles.length;counts.triangles=faces.length;counts.mappedModels=mapping.assignments.length;counts.mappedOccurrences=placed.placedOccurrences.length;counts.sceneComponents=placed.placedOccurrences.length||components.length;
  const parseMs=(typeof performance!=='undefined'?performance.now():Date.now())-t0;
  const unmappedModels=(mapping.leafModels||[]).filter(m=>!mapping.templates.has(m.id)).map(m=>({id:m.id,name:m.name,file:m.fileName}));
  return{
    format:'SLDASM',adapter:'sldasm-native-verified-geometry-v1.3.0',geometryAvailable,isAssembly:true,unit:'mm',factor:1,bounds,counts,
    faces,edges:[],surfaces:[],radii:[],boltPatterns:[],instances:occurrences,occurrences,products,components,
    nativeAssembly:{root,file:baseName(fileName),componentCount:components.length,occurrenceCount:occurrences.length,components,container:modern?'SolidWorks 2015+ chunk container':'SolidWorks binary',signatureHex:[...bytes.slice(0,8)].map(b=>b.toString(16).padStart(2,'0')).join(' '),streamCount:streamNames.length,streamNames,swVersion:tree?.swVersion||'',geometryMode:geometryAvailable?(placed.faces.length?'FaceTessellations + assembly transforms':'FaceTessellations local fallback'):'none',tessellationStreams:modern?[...modern.streams.keys()].filter(n=>n.startsWith('FaceTessellations/')):[],faceBlocks:faceBlocks.length,sourceTriangles:rawTriangles.length,triangles:faces.length,nativeScaleToMm:1000,mappedModels:mapping.assignments.length,mappedOccurrences:placed.placedOccurrences.length,totalLeafModels:mapping.leafModels.length,unmappedModels,transformMapping:mapping.assignments,confidence:tree?'decoded-xml+transforms+tess-recognition-ready':(components.length?'legacy-scan':'format-recognized'),note:geometryAvailable?(placed.faces.length?'3D собрано локально из FaceTessellations с применением матриц каждого вхождения SLDASM. Это графическая тесселяция SolidWorks, не точный Parasolid B-Rep.':'3D показано как локальная FaceTessellations-геометрия без картирования вхождений.'):'SLDASM структура прочитана, но в файле не найдено декодируемой встроенной тесселяции.'},
    tessellation:{mode:geometryAvailable?'triangle-strips':'none',faceBlocks,sourceStreams:modern?[...modern.streams.keys()].filter(n=>/^FaceTessellations\/\d+-\d+-\d+$/i.test(n)):[],nativeUnit:'m',scaleToMm:1000,assemblyTransformsApplied:placed.faces.length>0,mappedModels:mapping.assignments.length,mappedOccurrences:placed.placedOccurrences.length},
    parseMs
  };
}
