const EXT_RE=/\.sldasm$/i;
const MODERN_MARKER=new Uint8Array([0x14,0x00,0x06,0x00,0x08,0x00]);
const FACE_PATTERN=new Uint8Array([0x64,0,0,0,0x02,0,0,0]);
const MAX_NAME=512,MAX_COMPRESSED=64*1024*1024;

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
function identity4(){return[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}
function mul4(a,b){const o=new Array(16).fill(0);for(let r=0;r<4;r++)for(let c=0;c<4;c++)for(let k=0;k<4;k++)o[r*4+c]+=a[r*4+k]*b[k*4+c];return o}

async function inflateRaw(data){
  if(typeof DecompressionStream==='undefined')throw new Error('Браузер не поддерживает DecompressionStream; нужен Safari/Chrome/Edge с deflate-raw.');
  const stream=new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function looksModern(bytes){
  const lim=Math.min(bytes.length,64);return findPattern(bytes.subarray(0,lim),MODERN_MARKER,0)>=0;
}

async function parseModernStreams(bytes){
  if(!looksModern(bytes))return null;
  const key=bytes[7]||0,streams=new Map(),streamInfo=[];
  let pos=0,chunkCount=0,inflateErrors=0;
  while(true){
    const markerPos=findPattern(bytes,MODERN_MARKER,pos);if(markerPos<0)break;
    if(markerPos<4){pos=markerPos+1;continue}
    const si=markerPos-4;if(si+0x1e>bytes.length){pos=markerPos+1;continue}
    const f1=u32(bytes,si+0x0e),csz=u32(bytes,si+0x12),usz=u32(bytes,si+0x16),nsz=u32(bytes,si+0x1a);
    if(nsz>MAX_NAME||csz>MAX_COMPRESSED){pos=markerPos+1;continue}
    const nameStart=si+0x1e,nameEnd=nameStart+nsz;if(nameEnd>bytes.length){pos=markerPos+1;continue}
    const name=decodeRol(bytes.subarray(nameStart,nameEnd),key);if(!validStreamName(name)){pos=markerPos+1;continue}
    const inline=f1>=65536;chunkCount++;
    streamInfo.push({name,compressedSize:csz,uncompressedSize:usz,inline,offset:si});
    const wanted=name==='swXmlContents/COMPINSTANCETREE'||name==='PreviewPNG'||name==='FaceTessellations/Directory'||name.startsWith('FaceTessellations/')||name==='Contents/DisplayLists'||name.startsWith('docProps/');
    if(inline&&csz>0&&nameEnd+csz<=bytes.length){
      if(wanted&&!streams.has(name)){
        try{streams.set(name,await inflateRaw(bytes.subarray(nameEnd,nameEnd+csz)))}catch{inflateErrors++}
      }
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
    const a=parseAttrs(m[1]);if(!a.id)continue;const f={id:a.id,path:a.swPath||'',type:(a.swDocType||'').toLowerCase(),creationTime:a.swCreationTime||''};files.set(a.id,f);fileOrder.push(f);
  }
  const models=new Map();
  const modelRe=/<swModel\b([^>]*?)(?:\/>|>([\s\S]*?)<\/swModel>)/g;let mm;
  while((mm=modelRe.exec(xml))){
    const a=parseAttrs(mm[1]),inner=mm[2]||'',refs=[];
    for(const r of inner.matchAll(/<swReference\b([^>]*)\/>/g)){const ra=parseAttrs(r[1]);refs.push({...ra,transform:matrixFromAttr(ra.swTransform)})}
    if(a.id)models.set(a.id,{id:a.id,attrs:a,refs});
  }
  const rootFile=fileOrder[0]||{id:'',path:fileName,type:'assembly'};
  const rootCandidates=[...models.values()].filter(m=>m.attrs.swFileRef===rootFile.id&&m.refs.length);
  const rootModel=rootCandidates.find(m=>String(m.attrs.swConfigurationId)==='0')||rootCandidates[0]||null;
  const occurrences=[],stackGuard=new Set();
  function walk(model,parentId,parentTransform,depth){
    if(!model||depth>24)return;
    const guardKey=`${model.id}|${parentId}|${depth}`;if(stackGuard.has(guardKey))return;stackGuard.add(guardKey);
    for(let i=0;i<model.refs.length;i++){
      const ref=model.refs[i];if(String(ref.swSuppressed||'NO').toUpperCase()==='YES')continue;
      const childModel=models.get(ref.swModelRef),fileRef=childModel?.attrs?.swFileRef,file=files.get(fileRef)||{};
      const local=ref.transform||identity4(),world=mul4(parentTransform,local),name=ref.swName||ref.swComponentName||childModel?.attrs?.swName||baseName(file.path)||`Component ${i+1}`;
      const occ={id:`SW-${occurrences.length+1}`,name,parent:parentId||'SW-ROOT',modelRef:ref.swModelRef||'',file:file.path||'',fileName:baseName(file.path||''),type:file.type==='assembly'?'assembly':'part',configuration:ref.swConfigurationName||childModel?.attrs?.swConfigurationName||'',referenceNumber:ref.swReferenceNumber||'',hidden:String(ref.swHidden||'NO').toUpperCase()==='YES',excludeFromBOM:String(ref.swExcludeFromBOM||'NO').toUpperCase()==='YES',transform:world};
      occurrences.push(occ);if(childModel?.refs?.length)walk(childModel,occ.id,world,depth+1);
    }
  }
  if(rootModel)walk(rootModel,'SW-ROOT',identity4(),0);
  const grouped=new Map();
  for(const o of occurrences){if(o.excludeFromBOM)continue;const key=(o.fileName||o.name).toLowerCase();const g=grouped.get(key)||{file:o.fileName||baseName(o.file),name:stemName(o.fileName||o.name),path:o.file,type:o.type,count:0,instances:[]};g.count++;g.instances.push(o.id);grouped.set(key,g)}
  const components=[...grouped.values()].sort((a,b)=>a.type.localeCompare(b.type)||a.name.localeCompare(b.name,undefined,{numeric:true,sensitivity:'base'}));
  const productName=stemName(rootFile.path)||stemName(fileName)||'SolidWorks Assembly';
  const products=[{id:'SW-ROOT',name:productName,type:'assembly'},...components.map((c,i)=>({id:`SW-P-${i+1}`,name:c.name,file:c.file,type:c.type}))];
  return{root:productName,rootPath:rootFile.path,rootModelId:rootModel?.id||'',files:[...files.values()],models:[...models.values()].map(m=>({id:m.id,name:m.attrs.swName||'',fileRef:m.attrs.swFileRef||'',configuration:m.attrs.swConfigurationName||'',bounds:m.attrs.swBoundingBox||'',references:m.refs.length})),components,occurrences,products,swVersion:(xml.match(/\bswVersion="([^"]+)"/)||[])[1]||''};
}

function triangleArea2(a,b,c){const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2];const x=uy*vz-uz*vy,y=uz*vx-ux*vz,z=ux*vy-uy*vx;return x*x+y*y+z*z}
function computeBounds(points){if(!points.length)return{min:[0,0,0],max:[0,0,0],size:[0,0,0],center:[0,0,0]};const mn=[Infinity,Infinity,Infinity],mx=[-Infinity,-Infinity,-Infinity];for(const p of points)for(let i=0;i<3;i++){if(p[i]<mn[i])mn[i]=p[i];if(p[i]>mx[i])mx[i]=p[i]};return{min:mn,max:mx,size:mx.map((x,i)=>x-mn[i]),center:mx.map((x,i)=>(x+mn[i])/2)}}

function parseFaceTessellationStream(data,streamName,scale=1000){
  const triangles=[],allPoints=[],faceBlocks=[];let search=0,faceIndex=0;
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
    faceIndex++;let cursor=0,triCount=0;
    for(let s=0;s<stripCounts.length;s++){
      const n=stripCounts[s];
      for(let j=0;j<n-2;j++){
        let ia=cursor+j,ib=cursor+j+1,ic=cursor+j+2;if(j&1){const t=ia;ia=ib;ib=t}
        const a=pts[ia],b=pts[ib],c=pts[ic];if(triangleArea2(a,b,c)<1e-12)continue;
        triangles.push({loops:[[a,b,c]],normals:[norms[ia],norms[ib],norms[ic]],tessFaceId:faceIndex,stripId:s+1,sourceStream:streamName});triCount++;
      }
      cursor+=n;
    }
    allPoints.push(...pts);faceBlocks.push({id:faceIndex,offset:off,edgeCount,vertexCount:vc,stripCount:stripCounts.length,triangleCount:triCount,stream:streamName});
    search=Math.max(search,b2End);
  }
  return{triangles,points:allPoints,faceBlocks};
}

function scanAscii(bytes,min=5){const out=[];let start=-1;const printable=b=>b===9||(b>=32&&b<=126);for(let i=0;i<=bytes.length;i++){const ok=i<bytes.length&&printable(bytes[i]);if(ok&&start<0)start=i;if((!ok||i===bytes.length)&&start>=0){if(i-start>=min){let s='';for(let j=start;j<i;j++)s+=String.fromCharCode(bytes[j]);out.push(s)}start=-1}}return out}
function scanUtf16LE(bytes,min=4){const out=[];for(let parity=0;parity<2;parity++){let chars=[];const flush=()=>{if(chars.length>=min)out.push(chars.join(''));chars=[]};for(let i=parity;i+1<bytes.length;i+=2){const code=bytes[i]|(bytes[i+1]<<8),ok=code===9||(code>=32&&code!==0xffff&&!(code>=0xd800&&code<=0xdfff));if(ok)chars.push(String.fromCharCode(code));else flush();if(chars.length>2048)flush()}flush()}return out}
function legacyReferences(bytes,fileName){const all=[...scanAscii(bytes),...scanUtf16LE(bytes)],map=new Map();for(const s of all){for(const raw of(s.match(/(?:[A-Za-z]:[\\/][^\r\n<>|"']{1,240}?\.(?:sldprt|sldasm)|[^\r\n<>|"']{1,180}?\.(?:sldprt|sldasm))/ig)||[])){const file=baseName(raw);if(!/\.(sldprt|sldasm)$/i.test(file)||file.toLowerCase()===baseName(fileName).toLowerCase())continue;const key=file.toLowerCase(),g=map.get(key)||{file,name:file.replace(/\.(sldprt|sldasm)$/i,''),path:raw,type:/\.sldasm$/i.test(file)?'assembly':'part',count:0,instances:[]};g.count++;map.set(key,g)}}return[...map.values()]}
function emptyCounts(){return{entities:0,solids:0,shells:0,faces:0,edges:0,vertices:0,planes:0,cylinders:0,cones:0,tori:0,bsplines:0,sceneFaces:0,sceneEdges:0,sceneComponents:0,tessFaceBlocks:0,triangles:0}}

export async function parseSLDASM(input,fileName='assembly.SLDASM'){
  if(!EXT_RE.test(fileName))throw new Error('SLDASM decoder accepts only .SLDASM');
  const bytes=asBytes(input),t0=typeof performance!=='undefined'?performance.now():Date.now();
  const modern=await parseModernStreams(bytes);
  let tree=null,triangles=[],points=[],faceBlocks=[],streamNames=[];
  if(modern){
    streamNames=modern.streamInfo.map(x=>x.name);
    const comp=modern.streams.get('swXmlContents/COMPINSTANCETREE');if(comp)tree=parseComponentTreeXml(textUtf8(comp),fileName);
    for(const [name,data] of modern.streams){if(/^FaceTessellations\/\d+-\d+-\d+$/i.test(name)){const r=parseFaceTessellationStream(data,name,1000);triangles.push(...r.triangles);points.push(...r.points);faceBlocks.push(...r.faceBlocks)}}
  }
  const geometryAvailable=triangles.length>0,bounds=computeBounds(points),counts=emptyCounts();counts.entities=modern?.chunkCount||0;counts.faces=faceBlocks.length;counts.vertices=points.length;counts.sceneFaces=triangles.length;counts.sceneEdges=triangles.length*3;counts.tessFaceBlocks=faceBlocks.length;counts.triangles=triangles.length;
  let components=tree?.components||[],occurrences=tree?.occurrences||[],products=tree?.products||[],root=tree?.root||stemName(fileName);
  if(!components.length){components=legacyReferences(bytes,fileName).map((x,i)=>({...x,index:i+1}));occurrences=[];for(let i=0;i<components.length;i++)for(let j=0;j<components[i].count;j++)occurrences.push({id:`SW-${i+1}-${j+1}`,name:components[i].name,child:components[i].file,parent:'SW-ROOT',type:components[i].type,source:'SLDASM_LEGACY_SCAN'});products=[{id:'SW-ROOT',name:root,type:'assembly'},...components.map((c,i)=>({id:`SW-P-${i+1}`,name:c.name,file:c.file,type:c.type}))]}
  counts.sceneComponents=components.length;
  const parseMs=(typeof performance!=='undefined'?performance.now():Date.now())-t0;
  return{
    format:'SLDASM',adapter:'sldasm-native-tessellation-v0.7',geometryAvailable,isAssembly:true,unit:'mm',factor:1,bounds,counts,
    faces:triangles,edges:[],surfaces:[],radii:[],boltPatterns:[],instances:occurrences,occurrences,products,components,
    nativeAssembly:{root,file:baseName(fileName),componentCount:components.length,occurrenceCount:occurrences.length,components,container:modern?'SolidWorks 2015+ chunk container':'SolidWorks binary',signatureHex:[...bytes.slice(0,8)].map(b=>b.toString(16).padStart(2,'0')).join(' '),streamCount:streamNames.length,streamNames,swVersion:tree?.swVersion||'',geometryMode:geometryAvailable?'FaceTessellations triangle strips':'none',tessellationStreams:modern?[...modern.streams.keys()].filter(n=>n.startsWith('FaceTessellations/')):[],faceBlocks:faceBlocks.length,triangles:triangles.length,nativeScaleToMm:1000,confidence:tree?'decoded-xml':(components.length?'legacy-scan':'format-recognized'),note:geometryAvailable?'3D построено локально из встроенных FaceTessellations. Это графическая тесселяция SolidWorks, не точный Parasolid B-Rep.':'SLDASM структура прочитана, но в файле не найдено декодируемой встроенной тесселяции.'},
    tessellation:{mode:geometryAvailable?'triangle-strips':'none',faceBlocks,sourceStreams:modern?[...modern.streams.keys()].filter(n=>/^FaceTessellations\/\d+-\d+-\d+$/i.test(n)):[],nativeUnit:'m',scaleToMm:1000},
    parseMs
  };
}
