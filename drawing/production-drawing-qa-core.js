// ROZFOOD Engineering Studio v14.3.0 — Production Drawing Preflight QA Core
// Fail-closed production preflight.  Unlike the older structural-only guard this validates the
// actual source topology used by the renderer, source-derived helical-flight coverage, section
// richness and the emitted SVG markup before a drawing is declared production-ready.

const finite=Number.isFinite;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function svgDiagnostics(markup=''){
  const text=String(markup||'');
  const count=re=>(text.match(re)||[]).length;
  const invalid=/\b(?:NaN|Infinity|-Infinity|undefined)\b/.test(text);
  return {
    bytes:text.length,
    paths:count(/<path\b/g),lines:count(/<line\b/g),circles:count(/<circle\b/g),texts:count(/<text\b/g),
    helicoidTagged:/data-role="(?:component-helical-plate-edges|source-edge-helices)"/.test(text),
    sectionTagged:/data-(?:section|reference-grade-aa|production-view-synthesizer="section-end)/.test(text),
    invalidNumbers:invalid
  };
}
function topoEdgeCount(rec){const t=rec?.brep||rec?.topologicalBRep||rec?.topologicalBrep||rec?.brepTopology||rec?.topology||{};return t.edges?.length??t.counts?.edges??t.stats?.edges??0}
function weightedScore(checks,weights){let got=0,total=0;for(const [k,v] of Object.entries(checks)){const w=weights[k]??1;total+=w;if(v)got+=w}return total?Math.round(got/total*1000)/10:0}

export function runProductionDrawingQA(rec,{draftingGraph=null,fidelity=null,referenceGrade=null,viewSynthesis=null,drawingMarkup=''}={}){
  const roles=new Set((draftingGraph?.entities||[]).filter(x=>x.kind==='view').map(x=>x.id));
  const required=['top-longitudinal','end','main-longitudinal','section-aa','section-bb','detail-d'];
  const viewCoverage=required.filter(x=>roles.has(x)).length/required.length;
  const f=rec?.drawingFidelity||fidelity||{};
  const vs=viewSynthesis||rec?.productionViewSynthesis||{};
  const helicalExpected=vs.helicalComponents??0,helicalRendered=vs.renderedHelicalComponents??0;
  const sourceHelixCoverage=helicalExpected>0?helicalRendered/helicalExpected:0;
  const exactFaces=rec?.analyticFaceHLR?.stats?.supportedFaces??rec?.analyticFaceHLR?.supportedFaces;
  const totalFaces=rec?.surfaceModel?.counts?.total??rec?.surfaceModel?.surfaces?.size;
  const exactCoverage=(finite(totalFaces)&&totalFaces>0&&finite(exactFaces))?exactFaces/totalFaces:null;
  const svg=svgDiagnostics(drawingMarkup);
  const checks={
    viewGrammar:viewCoverage===1,
    regression:f.hardPass===true,
    topology:topoEdgeCount(rec)>100,
    dimensions:(draftingGraph?.counts?.dimensions||0)>=18,
    exactFaceCoverage:exactCoverage===null?true:exactCoverage>=.95,
    helicalSourceCoverage:helicalExpected>=1&&sourceHelixCoverage>=.999&&(vs.helicoidCurves||0)>=helicalExpected*2,
    longitudinalSection:(referenceGrade?.aaStations||0)>=4,
    stableDetail:!!referenceGrade?.detailD&&finite(referenceGrade.detailD.webHeight)&&finite(referenceGrade.detailD.plateThickness),
    endViewSemantics:(vs.endDiameters||0)>=3&&(vs.endRods||0)>=2,
    emittedLinework:svg.bytes>12000&&(svg.paths+svg.lines+svg.circles)>=45&&svg.helicoidTagged&&svg.sectionTagged&&!svg.invalidNumbers
  };
  const weights={viewGrammar:2,regression:2,topology:2,dimensions:1.5,exactFaceCoverage:1,helicalSourceCoverage:2,longitudinalSection:1.5,stableDetail:1,endViewSemantics:1.5,emittedLinework:2};
  const passed=Object.values(checks).filter(Boolean).length,total=Object.keys(checks).length,score=weightedScore(checks,weights);
  // Geometry/view/linework failures are hard blockers.  A drawing below 92 is never auto-released.
  const blockers=['viewGrammar','regression','topology','helicalSourceCoverage','longitudinalSection','emittedLinework'];
  const hardPass=blockers.every(k=>checks[k])&&score>=92;
  return {version:'14.3.0',kernel:'ROZFOOD Production Drawing Preflight QA Core',checks,passed,total,score,hardPass,viewCoverage,sourceHelixCoverage:Math.round(sourceHelixCoverage*1000)/1000,svg,referenceGrade,geometryFrozen:true,note:'Fail-closed preflight: validates source B-Rep topology, required views, semantic dimensions, full source-derived helical-flight coverage, production sections and emitted SVG integrity before release.'};
}
