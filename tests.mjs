import {parseSLDASM} from './import/sldasm-adapter.js';
import {renderNativeAssemblyDrawing} from './drawing/drawing-engine.js';

const refs=['C:\\Models\\Bracket.SLDPRT','Bracket-1','Bracket-2','C:\\Models\\Bolt.SLDPRT','Bolt-1','Bolt-2','Bolt-3','C:\\Models\\SubFrame.SLDASM','SubFrame-1'];
const head=Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1,...new Array(120).fill(0)]);
const chunks=[head]; for(const x of refs){chunks.push(Buffer.from(x+'\0','ascii')); chunks.push(Buffer.from(x+'\0','utf16le'))}
const sw=parseSLDASM(Buffer.concat(chunks),'Machine.SLDASM');
if(!sw.isAssembly||sw.geometryAvailable!==false)throw new Error('SLDASM metadata mode missing');
const bom=new Map(sw.nativeAssembly.components.map(c=>[c.name,c.count]));
if(bom.get('Bracket')!==2||bom.get('Bolt')!==3||bom.get('SubFrame')!==1)throw new Error('bad BOM '+JSON.stringify([...bom]));
const svg={attrs:{},innerHTML:'',setAttribute(k,v){this.attrs[k]=v}};
renderNativeAssemblyDrawing(svg,sw.nativeAssembly,{projectName:'Machine',fileName:'Machine.SLDASM',theme:'light'});
if(!svg.innerHTML.includes('SLDASM BOM')||!svg.innerHTML.includes('v0.6.2'))throw new Error('SLDASM drawing/version missing');
console.log('All v0.6.2 SLDASM-only tests passed.',{components:sw.nativeAssembly.componentCount,occurrences:sw.nativeAssembly.occurrenceCount});
