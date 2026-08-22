import fs from 'node:fs';
import {parseSTEP} from './import/step-parser.js';
import {recognizeSTEP,makeDimensionSet} from './recognition/feature-recognizer.js';
import {drawingFromRecognition,renderDrawing} from './drawing/drawing-engine.js';

const expected={
  'sample_flange.step':{bounds:[80,80,12],bolt:[6,60,6],main:'XY',section:true},
  'sample_shaft.step':{bounds:[36,36,90],main:'XZ',section:true,lengths:[25,30,35]},
  'sample_assembly.step':{bounds:[80,50,45],instances:5}
};

for(const name of Object.keys(expected)){
  const text=fs.readFileSync(new URL('./samples/'+name,import.meta.url),'utf8');
  const m=parseSTEP(text,name),r=recognizeSTEP(m),d=makeDimensionSet(r);
  const b=r.bounds.size.map(x=>+x.toFixed(3));
  const drawing=drawingFromRecognition(r,d,{projectName:name,fileName:name,mode:'production'});
  console.log(name,JSON.stringify({
    entities:r.counts.entities,solids:r.counts.solids,faces:r.counts.faces,edges:r.counts.edges,bounds:b,
    instances:r.instances.length,occurrences:r.occurrences.length,
    boltPatterns:r.boltPatterns.map(p=>({n:p.count,pcd:+p.pcd.toFixed(3),hole:+p.holeDiameter.toFixed(3)})),
    dims:d.map(x=>x.label),mainView:drawing.views[0]?.id,section:!!drawing.section
  },null,2));

  if(!r.counts.solids||!r.counts.faces||!r.counts.edges)throw new Error(name+': B-Rep counts missing');
  const exp=expected[name].bounds;if(exp.some((x,i)=>Math.abs(x-b[i])>.02))throw new Error(name+': bad bounds '+b+' expected '+exp);
  if(expected[name].instances&&r.instances.length!==expected[name].instances)throw new Error(name+': bad instances '+r.instances.length);
  if(expected[name].bolt){const p=r.boltPatterns.find(x=>x.count===expected[name].bolt[0]&&Math.abs(x.pcd-expected[name].bolt[1])<.05&&Math.abs(x.holeDiameter-expected[name].bolt[2])<.05);if(!p)throw new Error(name+': bolt pattern not recognized')}
  if(expected[name].main&&drawing.views[0]?.id!==expected[name].main)throw new Error(name+': wrong main view '+drawing.views[0]?.id);
  if(expected[name].section&&!drawing.section)throw new Error(name+': axial section not generated');
  if(expected[name].lengths){const lengths=d.filter(x=>x.type==='length').map(x=>+x.value.toFixed(3)).sort((a,b)=>a-b);for(const want of expected[name].lengths)if(!lengths.some(v=>Math.abs(v-want)<.01))throw new Error(name+': missing axial length '+want+' got '+lengths)}

  // Render smoke test without a browser DOM.
  const fakeSvg={attrs:{},innerHTML:'',setAttribute(k,v){this.attrs[k]=v}};
  renderDrawing(fakeSvg,drawing,{mode:'production',projectName:name,fileName:name,theme:'light'});
  if(!fakeSvg.innerHTML.includes('ROZFOOD ENGINEERING STUDIO'))throw new Error(name+': title block missing');
  if(!fakeSvg.innerHTML.includes('Drawing Core v0.4.0'))throw new Error(name+': drawing version missing');
  if(name==='sample_flange.step'&&!fakeSvg.innerHTML.includes('PCD'))throw new Error(name+': PCD annotation missing');
}
console.log('All v0.4.0 Drawing Core tests passed.');
