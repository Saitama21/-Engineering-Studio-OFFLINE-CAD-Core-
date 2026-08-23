/*
 * ROZFOOD ENGINEERING STUDIO · SLDDRW Reference Reader
 * Modern SOLIDWORKS (2015+) chunk reader implemented for browser/offline use.
 *
 * Interoperability notes:
 * - Modern stream layout follows publicly documented/open-source prior art from
 *   SWFormat (Apache-2.0) and openswx (MIT). This implementation is an independent
 *   JavaScript adaptation focused on read-only drawing-reference extraction.
 * - No decryption, DRM bypass, external API, server CAD or SOLIDWORKS install.
 * - Unsupported containers are reported explicitly rather than guessed.
 */

const MARKER = Uint8Array.from([0x14,0x00,0x06,0x00,0x08,0x00]);
const MAX_NAME = 512;
const MAX_COMPRESSED = 64 * 1024 * 1024;
const INLINE_THRESHOLD = 65536;
const PNG_SIG = [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a];
const decoder = new TextDecoder('utf-8');

function u32(view, off){ return view.getUint32(off, true); }
function rol8(v,k){ k&=7; return k ? (((v<<k)|(v>>(8-k)))&255) : v; }
function eqAt(data, needle, off){
  if(off<0 || off+needle.length>data.length) return false;
  for(let i=0;i<needle.length;i++) if(data[off+i]!==needle[i]) return false;
  return true;
}
function findMarker(data, start){
  outer: for(let i=Math.max(0,start);i<=data.length-MARKER.length;i++){
    for(let j=0;j<MARKER.length;j++) if(data[i+j]!==MARKER[j]) continue outer;
    return i;
  }
  return -1;
}
function asciiName(bytes,key){
  const out=new Uint8Array(bytes.length);
  for(let i=0;i<bytes.length;i++) out[i]=rol8(bytes[i],key);
  const s=decoder.decode(out);
  if(!s || [...s].some(ch=>{const c=ch.charCodeAt(0);return c<0x20||c>0x7e;})) return '';
  return s;
}
async function inflateRaw(bytes){
  if(typeof DecompressionStream!=='function') throw new Error('Браузер не поддерживает DecompressionStream. Нужен современный Chrome/Edge.');
  let ds;
  try{ ds=new DecompressionStream('deflate-raw'); }
  catch{ throw new Error('Браузер не поддерживает raw DEFLATE, необходимый для современного SLDDRW.'); }
  const stream=new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function detectSlddrwContainer(buffer){
  const d=buffer instanceof Uint8Array?buffer:new Uint8Array(buffer);
  if(d.length>=8 && [0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1].every((v,i)=>d[i]===v)) return 'ole2';
  if(d.length>=4 && d[0]===0x50&&d[1]===0x4b&&d[2]===0x03&&d[3]===0x04) return 'opc';
  return findMarker(d,0)>=0 && findMarker(d,0)<64 ? 'modern' : 'unknown';
}

export async function readModernStreams(buffer){
  const data=buffer instanceof Uint8Array?buffer:new Uint8Array(buffer);
  const view=new DataView(data.buffer,data.byteOffset,data.byteLength);
  if(detectSlddrwContainer(data)!=='modern') throw new Error('Поддерживается современный SLDDRW (SOLIDWORKS 2015+ chunk container).');
  const key=data[7]||0;
  const streams=new Map();
  const meta=[];
  let pos=0;
  while(true){
    const m=findMarker(data,pos); if(m<0) break;
    if(m<4){pos=m+1;continue;}
    const si=m-4;
    if(si+0x1e>data.length){pos=m+1;continue;}
    const sectionType=data[si+0x0a];
    const f1=u32(view,si+0x0e), csz=u32(view,si+0x12), usz=u32(view,si+0x16), nsz=u32(view,si+0x1a);
    if(nsz>MAX_NAME || csz>MAX_COMPRESSED){pos=m+1;continue;}
    const ns=si+0x1e, ne=ns+nsz;
    if(ne>data.length){pos=m+1;continue;}
    const name=asciiName(data.subarray(ns,ne),key);
    if(!name){pos=m+1;continue;}
    if(f1<INLINE_THRESHOLD || csz===0){pos=m+MARKER.length;continue;}
    const de=ne+csz;
    if(de>data.length){pos=m+1;continue;}
    try{
      const raw=await inflateRaw(data.subarray(ne,de));
      streams.set(name,raw);
      meta.push({name,offset:si,sectionType,compressed:csz,uncompressed:usz,actual:raw.length});
      pos=de;
    }catch{
      // A valid-looking false positive can still occur in high-entropy payloads.
      pos=m+1;
    }
  }
  if(!streams.size) throw new Error('SLDDRW распознан, но декодируемые потоки не найдены.');
  return {streams,meta};
}

function text(bytes){ return decoder.decode(bytes||new Uint8Array()); }
function decodeXml(s){
  return String(s||'').replace(/&#x([0-9a-f]+);/gi,(_,h)=>String.fromCodePoint(parseInt(h,16)))
    .replace(/&#(\d+);/g,(_,d)=>String.fromCodePoint(parseInt(d,10)))
    .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
}
function attrs(s){
  const out={}; const re=/([:\w.-]+)="([\s\S]*?)"/g; let m;
  while((m=re.exec(s))) out[m[1]]=decodeXml(m[2]);
  return out;
}
function tagText(xml,tag){
  const out=[]; const re=new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`,'gi'); let m;
  while((m=re.exec(xml))){ const v=decodeXml(m[1].replace(/<[^>]+>/g,'')).trim(); if(v) out.push(v); }
  return out;
}
function readCString(data, offset){
  if(offset+4>data.length || data[offset]!==0xff || data[offset+1]!==0xfe || data[offset+2]!==0xff) return null;
  const n=data[offset+3], start=offset+4, end=start+n*2; if(end>data.length) return null;
  try{return {value:new TextDecoder('utf-16le').decode(data.subarray(start,end)),next:end};}catch{return null;}
}
function sheetNames(bytes){
  if(!bytes||bytes.length<2)return[];
  const count=bytes[0]|(bytes[1]<<8),out=[];let o=2;
  for(let i=0;i<count;i++){const cs=readCString(bytes,o);if(!cs)break;out.push(cs.value);o=cs.next;}
  return out;
}
function bytesToDataUrl(bytes,mime='image/png'){
  let bin=''; const step=0x8000;
  for(let i=0;i<bytes.length;i+=step) bin+=String.fromCharCode(...bytes.subarray(i,Math.min(bytes.length,i+step)));
  return `data:${mime};base64,${btoa(bin)}`;
}
function pngInfo(bytes){
  if(!bytes || bytes.length<24 || !PNG_SIG.every((v,i)=>bytes[i]===v)) return null;
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  return {width:v.getUint32(16,false),height:v.getUint32(20,false),dataUrl:bytesToDataUrl(bytes)};
}

function parseDimensions(xml){
  const out=[]; if(!xml)return out;
  const re=/<Dimension\b([^>]*)>([\s\S]*?)<\/Dimension>/gi; let m;
  while((m=re.exec(xml))){const a=attrs(m[1]),value=decodeXml(m[2].replace(/<[^>]+>/g,'')).trim();if(value)out.push({name:a.Name||a.name||'',value,source:'SLDDRW_KEYWORDS',confidence:1});}
  return out;
}
function parseNotes(xml){
  const out=[]; const seen=new Set();
  for(const n of tagText(xml,'Note')){if(n&&!seen.has(n)){seen.add(n);out.push(n);}}
  return out;
}
function parseViews(xml){
  const out=[]; const re=/<View\b([^>]*)>([\s\S]*?)<\/View>/gi; let m;
  while((m=re.exec(xml))){const a=attrs(m[1]);out.push({name:a.Name||'',description:a.Description||decodeXml(m[2].replace(/<[^>]+>/g,'')).trim()||'',id:a.id||''});}
  return out;
}
function parseReferences(xml){
  const out=[],seen=new Set(); const re=/<Reference\b([^>]*)\/?>(?:<\/Reference>)?/gi; let m;
  while((m=re.exec(xml))){const a=attrs(m[1]),key=[a.Name,a.Description,a.Type].join('|');if(!seen.has(key)){seen.add(key);out.push({name:a.Name||'',description:a.Description||'',type:a.Type||''});}}
  return out;
}
function parseKeywordRootName(xml){const m=/<Keywords\b([^>]*)>/i.exec(xml||'');return m?(attrs(m[1]).Name||''):'';}
function parseKeywordSheetMeta(xml){
  const out=[];const re=/<Sheet\b([^>]*)>([\s\S]*?)<\/Sheet>/gi;let m;
  while((m=re.exec(xml||''))){const a=attrs(m[1]),body=m[2];const pick=t=>{const q=new RegExp(`<${t}\\b[^>]*>([\\s\\S]*?)<\\/${t}>`,'i').exec(body);return q?decodeXml(q[1].replace(/<[^>]+>/g,'')).trim():''};out.push({name:a.Name||'',type:a.Type||'',scaleNumerator:Number(pick('ScaleNumerator'))||null,scaleDenominator:Number(pick('ScaleDenominator'))||null,paperSize:pick('PaperSize'),template:pick('TemplateName')});}
  return out;
}
function parseInfoProperties(xml){
  const out={}; if(!xml)return out;
  const re=/<property\b([^>]*)>([\s\S]*?)<\/property>/gi;let m;
  while((m=re.exec(xml))){const a=attrs(m[1]);if(!a.name)continue;const vm=/<vt:[\w]+\b[^>]*>([\s\S]*?)<\/vt:[\w]+>/i.exec(m[2]);if(vm)out[a.name]=decodeXml(vm[1].replace(/<[^>]+>/g,'')).trim();}
  return out;
}
function parseVersion(streamNames){
  let best=null;for(const n of streamNames){const m=/^_MO_VERSION_(\d+)/.exec(n);if(m)best=Math.max(best||0,Number(m[1]));}return best;
}

export async function parseSLDDRW(buffer,{fileName='drawing.slddrw'}={}){
  const container=detectSlddrwContainer(buffer);
  if(container==='ole2') throw new Error('Этот SLDDRW использует старый OLE2-контейнер (до SOLIDWORKS 2015). В v2.8.0 он пока только определяется, но не читается.');
  if(container==='opc') throw new Error('Этот файл использует OPC/ZIP-контейнер. В v2.8.0 поддержан modern SLDDRW.');
  if(container!=='modern') throw new Error('Неизвестный или повреждённый SLDDRW-контейнер.');
  const {streams,meta}=await readModernStreams(buffer);
  const keys=[...streams.keys()];
  const kwBytes=streams.get('swXmlContents/KeyWords');
  const kw=kwBytes?text(kwBytes).slice(Math.max(0,text(kwBytes).indexOf('<?xml'))):'';
  const info=text(streams.get('docProps/ISolidWorksInformation.xml'));
  const names=sheetNames(streams.get('SheetPreviews/SheetNames'));
  const sheetMeta=parseKeywordSheetMeta(kw);
  const previews=[];
  for(const name of keys){const m=/^Images\/Sheet_(\d+)$/.exec(name);if(!m)continue;const p=pngInfo(streams.get(name));if(p)previews.push({index:Number(m[1]),name:names[Number(m[1])]||`Лист ${Number(m[1])+1}`,...p});}
  previews.sort((a,b)=>a.index-b.index);
  const dimensions=parseDimensions(kw);
  const notes=parseNotes(kw);
  const views=parseViews(kw);
  const references=parseReferences(kw);
  const properties=parseInfoProperties(info);
  const projectName=parseKeywordRootName(kw)||properties['SW-File Title']||fileName.replace(/\.[^.]+$/,'');
  return {
    kind:'slddrw',container:'modern',fileName,projectName,streamCount:streams.size,streams:meta,
    version:parseVersion(keys),sheetNames:names,sheets:sheetMeta,previews,dimensions,notes,views,references,properties,
    previewCount:previews.length,
    capabilities:{sheetPreview:previews.length>0,dimensions:dimensions.length>0,notes:notes.length>0,views:views.length>0,references:references.length>0},
    warnings:dimensions.length?[]:['В этом SLDDRW поток KeyWords не содержит <Dimension> со значениями. Лист читается и отображается точно по встроенному PNG-превью, но числовая размерка из бинарного Contents/Definition пока не декодируется.']
  };
}
