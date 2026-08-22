import {deflateRawSync} from 'node:zlib';
import {parseSLDASM} from './import/sldasm-adapter.js';
import {renderNativeAssemblyDrawing} from './drawing/drawing-engine.js';

function u32(n){const b=Buffer.alloc(4);b.writeUInt32LE(n>>>0);return b}
function f32(n){const b=Buffer.alloc(4);b.writeFloatLE(n);return b}
function rolByte(b,shift){shift&=7;if(!shift)return b;return((b<<shift)|(b>>(8-shift)))&255}
function encodeRol(name,key){const inv=(8-(key&7))&7;return Buffer.from([...Buffer.from(name,'ascii')].map(b=>rolByte(b,inv)))}
function chunk(name,payload,key=3){
  const raw=Buffer.from(payload),zip=deflateRawSync(raw),enc=encodeRol(name,key);
  return Buffer.concat([
    Buffer.alloc(4),Buffer.from([0x14,0,0x06,0,0x08,0,0xfd,0,0,0]),
    u32(65536),u32(zip.length),u32(raw.length),u32(enc.length),enc,zip
  ]);
}
function tessFace(){
  const pts=[[0,0,0],[.1,0,0],[0,.1,0],[.1,.1,0]],norms=pts.map(()=>[0,0,1]);
  const parts=[u32(4),u32(100),u32(2),u32(4)];
  for(const p of pts)for(const v of p)parts.push(f32(v));
  parts.push(u32(12),u32(100),u32(2),u32(4));
  for(const n of norms)for(const v of n)parts.push(f32(v));
  parts.push(u32(4),u32(8),u32(2),u32(0));
  parts.push(u32(4),u32(8),u32(2),u32(1),u32(6)); // (6 + 2) / 2 = 4 vertices in strip
  return Buffer.concat(parts);
}
const xml=`<?xml version="1.0"?><swSolidWorks swVersion="17000"><swHeader>
<swFile id="F0" swPath="C:\\Models\\Machine.SLDASM" swDocType="assembly"/>
<swFile id="F1" swPath="C:\\Models\\Bracket.SLDPRT" swDocType="part"/>
</swHeader><swModelList>
<swModel id="M0" swFileRef="F0" swConfigurationId="0" swConfigurationName="Default"><swReference swName="Bracket-1" swModelRef="M1" swSuppressed="NO" swHidden="NO" swExcludeFromBOM="NO" swTransform="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/></swModel>
<swModel id="M1" swFileRef="F1" swConfigurationId="0" swConfigurationName="Default"/>
</swModelList></swSolidWorks>`;
const header=Buffer.alloc(16);header[0]=0x53;header[1]=0x57;header[7]=3;
const file=Buffer.concat([header,chunk('swXmlContents/COMPINSTANCETREE',Buffer.from(xml),3),chunk('FaceTessellations/000-000-001',tessFace(),3)]);
const sw=await parseSLDASM(file,'Machine.SLDASM');
if(!sw.isAssembly||!sw.geometryAvailable)throw new Error('SLDASM native tessellation mode missing');
if(sw.nativeAssembly.componentCount!==1||sw.nativeAssembly.occurrenceCount!==1)throw new Error('bad component tree '+JSON.stringify(sw.nativeAssembly));
if(sw.nativeAssembly.components[0].name!=='Bracket')throw new Error('bad BOM name '+sw.nativeAssembly.components[0].name);
if(sw.counts.tessFaceBlocks!==1||sw.counts.triangles!==2)throw new Error('bad tessellation counts '+JSON.stringify(sw.counts));
if(Math.abs(sw.bounds.size[0]-100)>1e-3||Math.abs(sw.bounds.size[1]-100)>1e-3)throw new Error('bad tessellation bounds '+JSON.stringify(sw.bounds));
const svg={attrs:{},innerHTML:'',setAttribute(k,v){this.attrs[k]=v}};
renderNativeAssemblyDrawing(svg,sw.nativeAssembly,{projectName:'Machine',fileName:'Machine.SLDASM',theme:'light'});
if(!svg.innerHTML.includes('SLDASM BOM')||!svg.innerHTML.includes('v0.7.0'))throw new Error('SLDASM drawing/version missing');
let rejected=false;try{await parseSLDASM(Buffer.alloc(8),'Part.SLDPRT')}catch{rejected=true}if(!rejected)throw new Error('SLDPRT must be rejected');
console.log('All v0.7.0 SLDASM Native Tessellation tests passed.',{components:sw.nativeAssembly.componentCount,occurrences:sw.nativeAssembly.occurrenceCount,faceBlocks:sw.counts.tessFaceBlocks,triangles:sw.counts.triangles,bounds:sw.bounds.size});
