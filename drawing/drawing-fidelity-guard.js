// ROZFOOD Engineering Studio v14.0.1 — Drawing Fidelity & Regression Guard Core
// Deterministic guardrail layer. It never invents geometry: it validates the already reconstructed
// CAD/B-Rep result, freezes important drawing invariants and exposes a measurable fidelity score.

const finite=Number.isFinite;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const overlap=(a,b,p=0)=>!(a.x+a.w+p<=b.x||b.x+b.w+p<=a.x||a.y+a.h+p<=b.y||b.y+b.h+p<=a.y);
const rel=(a,b)=>Math.abs(a-b)/Math.max(1,Math.abs(b));
const round=(x,n=3)=>finite(x)?Number(x.toFixed(n)):null;

function geometrySignature(rec){
  const b=rec?.bounds||{}, size=b.size||[0,0,0];
  const topo=rec?.topologicalBrep||rec?.brepTopology||rec?.topology||{};
  const surface=rec?.surfaceModel||rec?.surfaceReconstruction||{};
  const recg=rec?.recognition||{};
  return {
    bounds:size.map(v=>round(v,3)),
    faces:(rec?.faces||[]).length,
    components:new Set((rec?.faces||[]).map(f=>f.componentId||'RAW')).size,
    cylinders:(recg.outerCylinders||recg.cylinders||[]).length,
    holes:(recg.holes||[]).length,
    topoV:topo.vertices?.length??topo.stats?.vertices??null,
    topoE:topo.edges?.length??topo.stats?.edges??null,
    topoF:topo.faces?.length??topo.stats?.faces??null,
    shells:topo.shells?.length??topo.stats?.shells??null,
    surfaces:surface.faces?.size??surface.surfaces?.size??surface.stats?.surfaces??null
  };
}

function layoutDiagnostics(composition){
  const boxes=composition?.boxes||{}, entries=Object.entries(boxes), frame=composition?.sheet?.frame||{x:0,y:0,w:Infinity,h:Infinity};
  const sheet=composition?.sheet||{W:Infinity,H:Infinity};
  let collisions=0,outside=0;
  const pairs=[],outsideIds=[];
  for(let i=0;i<entries.length;i++){
    const [id,a]=entries[i];
    const limit=(id==='stamp'||id==='bom')?{x:30,y:28,w:sheet.W-60,h:sheet.H-56}:frame;
    if(a.x<limit.x-1||a.y<limit.y-1||a.x+a.w>limit.x+limit.w+1||a.y+a.h>limit.y+limit.h+1){outside++;outsideIds.push(id);}
    for(let j=i+1;j<entries.length;j++){
      const [jd,b]=entries[j];
      // BOM/stamp can touch their protected band, but actual overlap is still forbidden.
      if(overlap(a,b,1)){collisions++;pairs.push(`${id}:${jd}`)}
    }
  }
  return {boxes:entries.length,collisions,outside,pairs,outsideIds};
}

function annotationDiagnostics(layout){
  const occ=layout?.occupied||[];let collisions=0;
  for(let i=0;i<occ.length;i++)for(let j=i+1;j<occ.length;j++){
    // Seed view boxes are allowed to geometrically overlap only if they are the exact same reservation.
    if(overlap(occ[i],occ[j],1) && occ[i].id!==occ[j].id)collisions++;
  }
  return {occupied:occ.length,collisions};
}

function requiredSemanticCoverage(functionalPlan){
  const all=functionalPlan?.all||[];
  const has=role=>all.some(x=>x.role===role);
  const checks={
    overall:has('overall-envelope'),
    working:has('working-envelope'),
    mounting:all.some(x=>x.kind==='hole-pattern'&&x.pcd),
    pitch:has('helical-pitch'),
    thickness:has('plate-thickness'),
    mating:all.some(x=>x.kind==='diameter'&&['shaft','bore','hub-or-bore','hub-od'].includes(x.role))
  };
  const passed=Object.values(checks).filter(Boolean).length;
  return {checks,passed,total:Object.keys(checks).length,ratio:passed/Object.keys(checks).length};
}

export function createDrawingFidelityGuard(rec,{composition=null,functionalPlan=null,annotationLayout=null,sectionContext=null,profile='GENERAL'}={}){
  const geometry=geometrySignature(rec), layout=layoutDiagnostics(composition), annotations=annotationDiagnostics(annotationLayout), semantics=requiredSemanticCoverage(functionalPlan);
  const sectionRatio=sectionContext?.considered?sectionContext.kept/sectionContext.considered:0;
  const sectionHealthy=!sectionContext?.considered || (sectionRatio>=.12&&sectionRatio<=.62);
  // Score is intentionally conservative: topology/geometry is not rewarded merely for existing;
  // the score measures production-sheet integrity and semantic coverage.
  let score=100;
  score-=layout.collisions*8+layout.outside*12;
  score-=Math.min(25,annotations.collisions*3);
  score-=(1-semantics.ratio)*24;
  if(!sectionHealthy)score-=10;
  score=clamp(score,0,100);
  const hardPass=layout.collisions===0&&layout.outside===0&&semantics.ratio>=.66&&sectionHealthy;
  return {
    version:'14.0.1',kernel:'ROZFOOD Drawing Fidelity & Regression Guard Core',profile,
    geometry,layout,annotations,semantics,section:{ratio:round(sectionRatio,4),healthy:sectionHealthy,considered:sectionContext?.considered||0,kept:sectionContext?.kept||0},
    score:round(score,1),hardPass,
    note:'Regression guard validates geometry signature, protected layout, annotation collisions, functional dimension coverage and section-context density. It does not modify source CAD geometry.'
  };
}

export function compareGeometrySignatures(a,b,{boundsTolerance=.002,countTolerance=0}={}){
  if(!a||!b)return {pass:false,reasons:['missing-signature']};
  const reasons=[];
  for(let i=0;i<3;i++)if(rel(a.bounds?.[i]||0,b.bounds?.[i]||0)>boundsTolerance)reasons.push(`bounds-${i}`);
  for(const k of ['faces','components','cylinders','holes'])if(finite(a[k])&&finite(b[k])&&Math.abs(a[k]-b[k])>countTolerance)reasons.push(k);
  return {pass:reasons.length===0,reasons};
}
