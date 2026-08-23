import {reconstructParametricHelicoids} from '../core/parametric-helical-surface-core.js';
// ROZFOOD Engineering Studio v14.0.0 — Functional Dimension Core
// Deterministic production dimension selection. Dimensions are selected by assembly function,
// not only by geometric size, so mating, mounting, envelope and manufacturing dimensions survive
// while low-value duplicate dimensions are suppressed.

const finite=x=>Number.isFinite(x);
const abs=Math.abs;
const near=(a,b,t=.8)=>finite(a)&&finite(b)&&abs(a-b)<=t;
const uniqBy=(items,keyFn)=>{const seen=new Set(),out=[];for(const x of items){const k=keyFn(x);if(seen.has(k))continue;seen.add(k);out.push(x)}return out};

function cylinderRole(c,drum){
  const d=c?.diameter??(finite(c?.radius)?c.radius*2:NaN), L=c?.length||0;
  if(!finite(d))return 'unknown';
  if(d>drum.D*.90&&L>drum.L*.35)return 'shell';
  if(d<drum.D*.18&&L>drum.L*.45)return 'shaft';
  if(c.role==='hole')return 'bore';
  if(d>drum.D*.55&&d<drum.D*.88)return 'hub-or-bore';
  return 'feature';
}

function matingDiameters(rec,drum){
  const all=(rec?.analyticGeometry?.cylinders||rec?.recognition?.cylinders||rec?.recognition?.outerCylinders||[])
    .map(c=>({...c,diameter:c.diameter??(finite(c.radius)?c.radius*2:NaN)})).filter(c=>finite(c.diameter));
  const candidates=[];
  for(const c of all){
    const role=cylinderRole(c,drum);
    let priority=20;
    if(role==='shaft')priority=96;
    else if(role==='bore')priority=92;
    else if(role==='hub-or-bore')priority=88;
    else if(role==='shell')priority=82;
    if(c.confidence>0.9)priority+=2;
    candidates.push({kind:'diameter',value:c.diameter,role,priority,componentId:c.componentId||null,source:'analytic-cylinder'});
  }
  candidates.sort((a,b)=>b.priority-a.priority||a.value-b.value);
  return uniqBy(candidates,x=>`${x.role}:${Math.round(x.value*2)}`).slice(0,10);
}

function mountingPatterns(rec){
  const out=[];
  for(const p of rec?.recognition?.holePatterns||[]){
    if(!(p.count>=2&&finite(p.diameter)))continue;
    out.push({kind:'hole-pattern',count:p.count,diameter:p.diameter,pcd:p.pcd||null,priority:p.pcd?100:90,role:'mounting-pattern',componentId:p.componentId||null,source:'hole-pattern'});
  }
  return out.sort((a,b)=>b.priority-a.priority||b.count-a.count).slice(0,6);
}

function axialInterfaces(drum){
  const out=[];
  if(drum.body){
    out.push({kind:'length',value:drum.body.length,priority:98,role:'working-envelope',a:drum.body.min,b:drum.body.max});
    if(drum.body.left>2)out.push({kind:'length',value:drum.body.left,priority:76,role:'left-interface',a:drum.min,b:drum.body.min});
    if(drum.body.right>2)out.push({kind:'length',value:drum.body.right,priority:76,role:'right-interface',a:drum.body.max,b:drum.max});
  }
  for(let i=0;i<(drum.chain?.segments||[]).length;i++){
    const value=drum.chain.segments[i];
    if(value<8)continue;
    out.push({kind:'length',value,priority:value>150?62:54,role:'axial-station',index:i});
  }
  return out;
}

export function buildFunctionalDimensionPlan(rec,drum,composition,semanticPlan,{crossGraph=null}={}){
  const envelope=[{kind:'length',value:drum.L,priority:110,role:'overall-envelope',id:'overall-length'}];
  const interfaces=axialInterfaces(drum);
  const diameters=matingDiameters(rec,drum);
  const patterns=mountingPatterns(rec);
  const manufacturing=[];
  const helicoids=reconstructParametricHelicoids(rec);const pitches=[...(helicoids?.surfaces?.values?.()||[])].map(h=>h.pitch).filter(x=>finite(x)&&x>0).sort((a,b)=>a-b);const exactPitch=pitches.length?pitches[Math.floor(pitches.length/2)]:drum.spiralPitch;
  if(finite(exactPitch)&&exactPitch>0)manufacturing.push({kind:'pitch',value:exactPitch,priority:99,role:'helical-pitch',source:pitches.length?'parametric-helicoid':'drum-plan'});
  if(finite(drum.featureThickness)&&drum.featureThickness>0)manufacturing.push({kind:'thickness',value:drum.featureThickness,priority:86,role:'plate-thickness'});
  if(finite(drum.weldSize)&&drum.weldSize>0)manufacturing.push({kind:'weld-size',value:drum.weldSize,priority:82,role:'weld-size'});
  if(finite(drum.radialWebHeight)&&drum.radialWebHeight>0)manufacturing.push({kind:'length',value:drum.radialWebHeight,priority:78,role:'web-height'});
  if(crossGraph?.hubDiameter)diameters.unshift({kind:'diameter',value:crossGraph.hubDiameter,priority:101,role:'hub-od',source:'cross-feature'});
  if(crossGraph?.holeDiameter)patterns.unshift({kind:'hole-pattern',count:crossGraph.holeCount||4,diameter:crossGraph.holeDiameter,pcd:crossGraph.holePcd||null,priority:110,role:'mounting-pattern',source:'cross-feature'});

  let all=[...envelope,...interfaces,...diameters,...patterns,...manufacturing];
  // Keep semantically distinct equal values, but suppress same-role duplicates.
  all=uniqBy(all,x=>`${x.kind}:${x.role}:${finite(x.value)?Math.round(x.value*10):''}:${x.count||''}:${finite(x.pcd)?Math.round(x.pcd*10):''}`)
    .sort((a,b)=>b.priority-a.priority);
  const critical=all.filter(x=>x.priority>=90);
  const production=all.filter(x=>x.priority>=72);
  return {
    version:'14.0.0',kernel:'ROZFOOD Functional Dimension Core',
    envelope,interfaces,diameters,patterns,manufacturing,critical,production,all,
    counts:{all:all.length,critical:critical.length,production:production.length,patterns:patterns.length,matingDiameters:diameters.length},
    note:'Dimensions are selected by assembly function: envelope, mating/interface, mounting pattern and manufacturing semantics. No ML/AI.'
  };
}
