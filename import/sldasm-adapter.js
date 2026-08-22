const EXT_RE=/\.(sldprt|sldasm)$/i;

function asBytes(input){
  if(input instanceof Uint8Array)return input;
  if(input instanceof ArrayBuffer)return new Uint8Array(input);
  if(ArrayBuffer.isView(input))return new Uint8Array(input.buffer,input.byteOffset,input.byteLength);
  throw new Error('SLDASM adapter: expected ArrayBuffer/Uint8Array');
}

function scanAscii(bytes,min=5){
  const out=[];let start=-1;
  const printable=b=>b===9||(b>=32&&b<=126);
  for(let i=0;i<=bytes.length;i++){
    const ok=i<bytes.length&&printable(bytes[i]);
    if(ok&&start<0)start=i;
    if((!ok||i===bytes.length)&&start>=0){
      if(i-start>=min){let s='';for(let j=start;j<i;j++)s+=String.fromCharCode(bytes[j]);out.push(s)}
      start=-1;
    }
  }
  return out;
}

function scanUtf16LE(bytes,min=4){
  const out=[];
  for(let parity=0;parity<2;parity++){
    let chars=[];
    const flush=()=>{if(chars.length>=min)out.push(chars.join(''));chars=[]};
    for(let i=parity;i+1<bytes.length;i+=2){
      const code=bytes[i]|(bytes[i+1]<<8);
      const ok=(code===9)||(code>=32&&code!==0xffff&&!(code>=0xd800&&code<=0xdfff));
      if(ok)chars.push(String.fromCharCode(code));else flush();
      if(chars.length>2048)flush();
    }
    flush();
  }
  return out;
}

function uniqueUsefulStrings(bytes){
  const all=[...scanAscii(bytes),...scanUtf16LE(bytes)];
  const seen=new Set(),out=[];
  for(const raw of all){const s=raw.replace(/[\u0000-\u001f]+/g,' ').trim();if(!s||seen.has(s))continue;seen.add(s);out.push(s)}
  return out;
}

function baseName(path=''){
  return String(path).replace(/\\/g,'/').split('/').pop().trim();
}
function stemName(path=''){
  return baseName(path).replace(/\.(sldprt|sldasm)$/i,'');
}
function cleanReference(raw){
  let s=String(raw||'').trim().replace(/^['"]+|['"]+$/g,'');
  const ext=s.match(/\.(sldprt|sldasm)/i);if(!ext)return null;
  s=s.slice(0,ext.index+ext[0].length);
  // Keep the final path-like segment if the printable run contains metadata before a drive/path.
  const drive=Math.max(s.lastIndexOf(' C:\\'),s.lastIndexOf(' D:\\'),s.lastIndexOf(' E:\\'),s.lastIndexOf(' F:\\'));
  if(drive>=0)s=s.slice(drive+1);
  return s.trim();
}

function collectReferences(strings,selfName){
  const map=new Map();
  for(const s of strings){
    if(!/\.(sldprt|sldasm)/i.test(s))continue;
    // A printable stream may contain several references separated by spaces/control text.
    const matches=s.match(/(?:[A-Za-z]:[\\/][^\r\n<>|"']{1,240}?\.(?:sldprt|sldasm)|[^\r\n<>|"']{1,180}?\.(?:sldprt|sldasm))/ig)||[];
    for(const raw of matches){
      const ref=cleanReference(raw);if(!ref)continue;
      const file=baseName(ref);if(!EXT_RE.test(file))continue;
      if(file.toLowerCase()===baseName(selfName).toLowerCase())continue;
      const key=file.toLowerCase();
      const item=map.get(key)||{file,name:stemName(file),path:ref,type:/\.sldasm$/i.test(file)?'assembly':'part',hits:0};
      item.hits++;if(ref.length>item.path.length)item.path=ref;map.set(key,item);
    }
  }
  return [...map.values()];
}

function inferInstances(ref,strings){
  const stem=ref.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const patterns=[new RegExp(`(?:^|[^\\p{L}\\p{N}_])(${stem}[-_ ]?\\d+)(?:$|[^\\p{L}\\p{N}_])`,'giu')];
  const found=new Set();
  for(const s of strings)for(const re of patterns){re.lastIndex=0;let m;while((m=re.exec(s)))found.add(m[1].toLowerCase())}
  return [...found];
}

function cfbInfo(bytes){
  const sig=[0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1];
  const isCFB=bytes.length>=8&&sig.every((v,i)=>bytes[i]===v);
  if(!isCFB)return {isCFB:false,sectorSize:null,directoryNames:[]};
  const dv=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const sectorShift=bytes.length>=32?dv.getUint16(30,true):9;
  const sectorSize=2**sectorShift;
  const firstDir=bytes.length>=52?dv.getInt32(48,true):-1;
  const directoryNames=[];
  if(firstDir>=0&&sectorSize>=512&&sectorSize<=4096){
    const off=(firstDir+1)*sectorSize;
    if(off+128<=bytes.length){
      for(let p=off;p+128<=Math.min(bytes.length,off+sectorSize);p+=128){
        const nlen=dv.getUint16(p+64,true);if(nlen<2||nlen>64)continue;
        let name='';for(let q=0;q<nlen-2;q+=2){const code=dv.getUint16(p+q,true);if(code)name+=String.fromCharCode(code)}
        if(name)directoryNames.push(name);
      }
    }
  }
  return {isCFB:true,sectorSize,directoryNames:[...new Set(directoryNames)]};
}

function emptyCounts(){return {entities:0,solids:0,shells:0,faces:0,edges:0,vertices:0,planes:0,cylinders:0,cones:0,tori:0,bsplines:0}}

export function parseSLDASM(input,fileName='assembly.sldasm'){
  const bytes=asBytes(input), t0=typeof performance!=='undefined'?performance.now():Date.now();
  const strings=uniqueUsefulStrings(bytes),cfb=cfbInfo(bytes),refs=collectReferences(strings,fileName);
  const components=refs.map((ref,index)=>{
    const instances=inferInstances(ref,strings);
    const count=Math.max(1,instances.length);
    return {...ref,index:index+1,count,instances};
  }).sort((a,b)=>a.type.localeCompare(b.type)||a.name.localeCompare(b.name,undefined,{numeric:true,sensitivity:'base'}));
  const occurrences=[];
  for(const c of components)for(let i=0;i<c.count;i++)occurrences.push({id:`SW-${c.index}-${i+1}`,name:c.name,child:c.file,parent:baseName(fileName),type:c.type,source:'SLDASM_NATIVE',instance:c.instances[i]||`${c.name}-${i+1}`});
  const productName=stemName(fileName)||'SolidWorks Assembly';
  const products=[{id:'SW-ROOT',name:productName,type:'assembly'},...components.map(c=>({id:`SW-P-${c.index}`,name:c.name,file:c.file,type:c.type}))];
  const parseMs=(typeof performance!=='undefined'?performance.now():Date.now())-t0;
  const signatureHex=[...bytes.slice(0,8)].map(b=>b.toString(16).padStart(2,'0')).join(' ');
  const container=cfb.isCFB?'CFB/OLE':'SolidWorks native binary';
  return {
    format:'SLDASM',adapter:'sldasm-native-reference-v0.2',geometryAvailable:false,isAssembly:true,
    unit:'mm',factor:1,bounds:{min:[0,0,0],max:[0,0,0],size:[0,0,0],center:[0,0,0]},
    counts:emptyCounts(),edges:[],surfaces:[],radii:[],boltPatterns:[],instances:occurrences,occurrences,products,
    nativeAssembly:{root:productName,file:baseName(fileName),componentCount:components.length,occurrenceCount:occurrences.length,components,container,signatureHex,sectorSize:cfb.sectorSize,directoryNames:cfb.directoryNames,scanStrings:strings.length,confidence:components.length?'preliminary':(cfb.isCFB?'low':'format-recognized'),note:components.length?'Компоненты и BOM извлечены локальным эвристическим анализом ссылок SLDASM.':'SLDASM распознан, но этот контейнер не отдаёт ссылки обычным string-scan. Точная B-Rep геометрия требует отдельного SolidWorks-совместимого декодера.'},
    parseMs
  };
}
