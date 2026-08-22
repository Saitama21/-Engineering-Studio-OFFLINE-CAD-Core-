import fs from 'node:fs';
import {parseSTEP} from './import/step-parser.js';
import {recognizeSTEP,makeDimensionSet} from './recognition/feature-recognizer.js';
const expected={
  'sample_flange.step':{bounds:[80,80,12],bolt:[6,60,6]},
  'sample_shaft.step':{bounds:[36,36,90]},
  'sample_assembly.step':{bounds:[80,50,45],instances:5}
};
for(const name of Object.keys(expected)){
  const text=fs.readFileSync(new URL('./samples/'+name,import.meta.url),'utf8'); const m=parseSTEP(text,name),r=recognizeSTEP(m),d=makeDimensionSet(r); const b=r.bounds.size.map(x=>+x.toFixed(3));
  console.log(name,JSON.stringify({entities:r.counts.entities,solids:r.counts.solids,faces:r.counts.faces,edges:r.counts.edges,bounds:b,instances:r.instances.length,occurrences:r.occurrences.length,boltPatterns:r.boltPatterns.map(p=>({n:p.count,pcd:+p.pcd.toFixed(3),hole:+p.holeDiameter.toFixed(3)})),dims:d.map(x=>x.label)},null,2));
  if(!r.counts.solids||!r.counts.faces||!r.counts.edges)throw new Error(name+': B-Rep counts missing');
  const exp=expected[name].bounds;if(exp.some((x,i)=>Math.abs(x-b[i])>.02))throw new Error(name+': bad bounds '+b+' expected '+exp);
  if(expected[name].instances&&r.instances.length!==expected[name].instances)throw new Error(name+': bad instances '+r.instances.length);
  if(expected[name].bolt){const p=r.boltPatterns.find(x=>x.count===expected[name].bolt[0]&&Math.abs(x.pcd-expected[name].bolt[1])<.05&&Math.abs(x.holeDiameter-expected[name].bolt[2])<.05);if(!p)throw new Error(name+': bolt pattern not recognized')}
}
