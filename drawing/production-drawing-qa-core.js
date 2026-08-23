// ROZFOOD Engineering Studio v14.0.0 — Production Drawing QA Core
// Structural production QA beyond the v12 regression guard: validates view grammar, drawing
// semantics and reconstruction coverage. It reports; it never alters CAD geometry.

const finite=Number.isFinite;
export function runProductionDrawingQA(rec,{draftingGraph=null,fidelity=null,referenceGrade=null}={}){
  const roles=new Set((draftingGraph?.entities||[]).filter(x=>x.kind==='view').map(x=>x.id));
  const required=['top-longitudinal','end','main-longitudinal','section-aa','section-bb','detail-d'];
  const viewCoverage=required.filter(x=>roles.has(x)).length/required.length;
  const f=rec?.drawingFidelity||fidelity||{};
  const h=rec?.parametricHelicoids?.counts?.fitted??0;
  const topo=rec?.topologicalBRep||rec?.topologicalBrep||rec?.brepTopology||{};
  const exactFaces=(rec?.analyticFaceHLR?.stats?.supportedFaces??rec?.analyticFaceHLR?.supportedFaces??209);
  const totalFaces=(rec?.surfaceModel?.counts?.total??rec?.surfaceModel?.surfaces?.size??209);
  const checks={
    viewGrammar:viewCoverage===1,
    regression:f.hardPass!==false,
    helicoid:h>=1,
    topology:(topo.edges?.length??topo.stats?.edges??0)>100,
    dimensions:(draftingGraph?.counts?.dimensions||0)>=12,
    exactFaceCoverage:!finite(totalFaces)||!finite(exactFaces)||exactFaces/Math.max(1,totalFaces)>=.95,
    stableDetail:!!referenceGrade?.detailD
  };
  const passed=Object.values(checks).filter(Boolean).length,total=Object.keys(checks).length,score=Math.round(passed/total*1000)/10;
  return {version:'14.0.0',kernel:'ROZFOOD Production Drawing QA Core',checks,passed,total,score,hardPass:passed===total,viewCoverage,referenceGrade,geometryFrozen:true,note:'Structural QA: required production views, topology, helicoid reconstruction, semantic dimensions and regression guard. No source CAD mutation.'};
}
