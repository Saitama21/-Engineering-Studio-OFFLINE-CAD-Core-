import {deflateRawSync} from 'node:zlib';
import {parseSLDASM} from './import/sldasm-adapter.js';
import {renderNativeAssemblyDrawing} from './drawing/drawing-engine.js';
import {recognizeTessellationGeometry,recognitionDimensions} from './core/tess-recognition.js';
import {renderTessRecognitionDrawing} from './drawing/tess-recognition-drawing.js';
import {renderAssemblyProductionSheet} from './drawing/assembly-production-sheet-v081.js';

function u32(n){const b=Buffer.alloc(4);b.writeUInt32LE(n>>>0);return b}
function f32(n){const b=Buffer.alloc(4);b.writeFloatLE(n);return b}
function rolByte(b,shift){shift&=7;if(!shift)return b;return((b<<shift)|(b>>(8-shift)))&255}
function encodeRol(name,key){const inv=(8-(key&7))&7;return Buffer.from([...Buffer.from(name,'ascii')].map(b=>rolByte(b,inv)))}
function chunk(name,payload,key=3){
  const raw=Buffer.from(payload),zip=deflateRawSync(raw),enc=encodeRol(name,key);
  return Buffer.concat([Buffer.alloc(4),Buffer.from([0x14,0,0x06,0,0x08,0,0xfd,0,0,0]),u32(65536),u32(zip.length),u32(raw.length),u32(enc.length),enc,zip]);
}
function tessFace(){
  const pts=[[0,0,0],[.1,0,0],[0,.1,0],[.1,.1,0]],norms=pts.map(()=>[0,0,1]);
  const parts=[u32(4),u32(100),u32(2),u32(4)];
  for(const p of pts)for(const v of p)parts.push(f32(v));
  parts.push(u32(12),u32(100),u32(2),u32(4));
  for(const n of norms)for(const v of n)parts.push(f32(v));
  parts.push(u32(4),u32(8),u32(2),u32(0));
  parts.push(u32(4),u32(8),u32(2),u32(1),u32(6));
  return Buffer.concat(parts);
}
const xml=`<?xml version="1.0"?><swSolidWorks swVersion="17000"><swHeader>
<swFile id="F0" swPath="C:\\Models\\Machine.SLDASM" swDocType="assembly"/>
<swFile id="F1" swPath="C:\\Models\\Bracket.SLDPRT" swDocType="part"/>
</swHeader><swModelList>
<swModel id="M0" swFileRef="F0" swConfigurationId="0" swConfigurationName="Default"><swReference swName="Bracket-1" swModelRef="M1" swSuppressed="NO" swHidden="NO" swExcludeFromBOM="NO" swTransform="1 0 0 0 0 1 0 0 0 0 1 0 .2 .3 .4 1"/></swModel>
<swModel id="M1" swName="Bracket" swFileRef="F1" swConfigurationId="0" swConfigurationName="Default" swBoundingBox="0 0 0 .1 .1 0"/>
</swModelList></swSolidWorks>`;
const header=Buffer.alloc(16);header[0]=0x53;header[1]=0x57;header[7]=3;
const file=Buffer.concat([header,chunk('swXmlContents/COMPINSTANCETREE',Buffer.from(xml),3),chunk('FaceTessellations/000-000-001',tessFace(),3)]);
const sw=await parseSLDASM(file,'Machine.SLDASM');
if(!sw.isAssembly||!sw.geometryAvailable)throw new Error('SLDASM transformed tessellation mode missing');
if(sw.nativeAssembly.componentCount!==1||sw.nativeAssembly.occurrenceCount!==1)throw new Error('bad component tree '+JSON.stringify(sw.nativeAssembly));
if(sw.nativeAssembly.components[0].name!=='Bracket')throw new Error('bad BOM name '+sw.nativeAssembly.components[0].name);
if(sw.counts.tessFaceBlocks!==1||sw.counts.sourceTriangles!==2||sw.counts.triangles!==2)throw new Error('bad tessellation counts '+JSON.stringify(sw.counts));
if(sw.nativeAssembly.mappedOccurrences!==1)throw new Error('component transform was not applied');
if(Math.abs(sw.bounds.min[0]-200)>1e-3||Math.abs(sw.bounds.min[1]-300)>1e-3||Math.abs(sw.bounds.min[2]-400)>1e-3)throw new Error('translation not applied '+JSON.stringify(sw.bounds));
if(Math.abs(sw.bounds.size[0]-100)>1e-3||Math.abs(sw.bounds.size[1]-100)>1e-3)throw new Error('bad transformed bounds '+JSON.stringify(sw.bounds));
if(sw.faces.some(f=>!f.componentId))throw new Error('placed faces must carry componentId');
const svg={attrs:{},innerHTML:'',setAttribute(k,v){this.attrs[k]=v}};
renderNativeAssemblyDrawing(svg,sw.nativeAssembly,{projectName:'Machine',fileName:'Machine.SLDASM',theme:'light'});
if(!svg.innerHTML.includes('SLDASM BOM')||!svg.innerHTML.includes('v0.8.1'))throw new Error('SLDASM drawing/version missing');
let rejected=false;try{await parseSLDASM(Buffer.alloc(8),'Part.SLDPRT')}catch{rejected=true}if(!rejected)throw new Error('SLDPRT must be rejected');
// Synthetic cylindrical tessellation: one full outer cylinder.
const cylFaces=[];
const N=32,R=20,L=100;
for(let i=0;i<N;i++){const a=i*2*Math.PI/N,b=(i+1)*2*Math.PI/N;const p0=[R*Math.cos(a),0,R*Math.sin(a)],p1=[R*Math.cos(b),0,R*Math.sin(b)],p2=[R*Math.cos(b),L,R*Math.sin(b)],p3=[R*Math.cos(a),L,R*Math.sin(a)];const n0=[Math.cos(a),0,Math.sin(a)],n1=[Math.cos(b),0,Math.sin(b)];cylFaces.push({loops:[[p0,p1,p2]],normals:[n0,n1,n1],componentId:'C1',modelId:'M1',tessFaceId:1,sourceStream:'FaceTessellations/T'});cylFaces.push({loops:[[p0,p2,p3]],normals:[n0,n1,n0],componentId:'C1',modelId:'M1',tessFaceId:1,sourceStream:'FaceTessellations/T'});}
const cylRec={faces:cylFaces,bounds:{size:[40,100,40]}};
const recognition=recognizeTessellationGeometry(cylRec);
if(recognition.counts.cylinders<1)throw new Error('cylinder recognition missing '+JSON.stringify(recognition.counts));
const rc=recognition.cylinders.find(x=>Math.abs(x.diameter-40)<.2&&Math.abs(x.length-100)<.2);if(!rc)throw new Error('cylinder dimensions wrong '+JSON.stringify(recognition.cylinders.slice(0,3)));
const dims=recognitionDimensions({bounds:{size:[40,100,40]}},recognition);if(!dims.some(x=>x.source==='TESS_CYLINDER'))throw new Error('recognized cylinder dimension missing');
const svg2={attrs:{},innerHTML:'',setAttribute(k,v){this.attrs[k]=v}};renderTessRecognitionDrawing(svg2,{bounds:{min:[-20,0,-20],max:[20,100,20],size:[40,100,40]},recognition},{projectName:'Cylinder',fileName:'Cylinder.SLDASM',theme:'light'});if(!svg2.innerHTML.includes('TESS GEOMETRY RECOGNITION')||!svg2.innerHTML.includes('Ø40.000'))throw new Error('recognition drawing missing');
const sheet={attrs:{},innerHTML:'',setAttribute(k,v){this.attrs[k]=v}};
sw.recognition=recognizeTessellationGeometry(sw);
renderAssemblyProductionSheet(sheet,sw,{projectName:'Machine',fileName:'Machine.SLDASM',theme:'light'});
if(!sheet.innerHTML.includes('Спецификация')||!sheet.innerHTML.includes('A–A')||sheet.attrs.viewBox!=='0 0 1400 990')throw new Error('v0.8.1 production sheet missing');
console.log('All v0.8.1 Drawing Layout tests passed.',{components:sw.nativeAssembly.componentCount,occurrences:sw.nativeAssembly.occurrenceCount,mapped:sw.nativeAssembly.mappedOccurrences,sourceTriangles:sw.counts.sourceTriangles,sceneTriangles:sw.counts.triangles,bounds:sw.bounds});
