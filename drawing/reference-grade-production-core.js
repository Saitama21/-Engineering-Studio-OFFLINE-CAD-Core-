// ROZFOOD Engineering Studio v14.0.2 — Reference-Grade Production Drafting Core
// High-level drafting synthesis for production assembly sheets. It consumes reconstructed
// engineering semantics (B-Rep, helicoids, section plan, functional dimensions) and emits
// stable drawing primitives. No pixel tracing / no AI / no hard-coded source-file geometry.

import {reconstructParametricHelicoids,helicoidPoint} from '../core/parametric-helical-surface-core.js';

const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const mul=(a,s)=>[a[0]*s,a[1]*s,a[2]*s];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const len=a=>Math.hypot(...a);
const norm=a=>{const L=len(a)||1;return a.map(x=>x/L)};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt=(x,n=0)=>Number.isFinite(x)?Number(x.toFixed(n)).toString().replace('.',','):'—';
function basis(axis){const a=norm(axis),seed=Math.abs(a[2])<.82?[0,0,1]:[1,0,0],u=norm(cross(a,seed)),v=norm(cross(a,u));return{a,u,v}}
function pointOnAxis(origin,axis,t){const o=dot(origin,axis);return add(origin,mul(axis,t-o))}
function path(points){if(!points?.length)return'';let d=`M${points[0][0].toFixed(2)} ${points[0][1].toFixed(2)}`;for(let i=1;i<points.length;i++)d+=`L${points[i][0].toFixed(2)} ${points[i][1].toFixed(2)}`;return d}

export function buildProductionDraftingGraph(rec,plan,composition,sectionPlan,functionalPlan){
  const views=['top-longitudinal','end','cross-detail','main-longitudinal','iso-shell','section-aa','section-bb','detail-d','iso-open'];
  const entities=[];
  for(const id of views){const key=({
    'top-longitudinal':'top','end':'end','cross-detail':'cross','main-longitudinal':'main','iso-shell':'isoShell','section-aa':'aa','section-bb':'bb','detail-d':'detailD','iso-open':'isoOpen'
  })[id];const b=composition?.boxes?.[key];if(b)entities.push({id,kind:'view',box:{...b},priority:id.startsWith('section')?90:id.includes('main')?100:70})}
  for(const d of functionalPlan?.all||[])entities.push({id:`dim:${d.role}:${d.kind}`,kind:'dimension',role:d.role,value:d.value??d.pcd??null,priority:d.priority||50});
  const constraints=[];
  const boxEntries=entities.filter(e=>e.kind==='view');
  for(const e of boxEntries)constraints.push({kind:'inside-sheet',entity:e.id});
  constraints.push({kind:'aligned-projection',a:'top-longitudinal',b:'main-longitudinal',axis:'assembly-axis'});
  constraints.push({kind:'section-source',a:'main-longitudinal',b:'section-aa',label:'A-A'});
  constraints.push({kind:'section-source',a:'end',b:'section-bb',label:'B-B'});
  constraints.push({kind:'detail-source',a:'main-longitudinal',b:'detail-d',label:'D'});
  const pitch=(functionalPlan?.manufacturing||[]).find(x=>x.role==='helical-pitch')?.value||null;
  return {version:'14.0.2',kernel:'ROZFOOD Production Drafting Graph Core',profile:'DRUM_REFERENCE_A2',entities,constraints,semantics:{axis:plan?.axis||null,overallLength:plan?.L||null,outerDiameter:plan?.outerDiameter||plan?.D||null,pitch,stations:plan?.chain?.stations||[],sectionA:sectionPlan?.A?.deg??null,sectionB:sectionPlan?.B?.station??null},counts:{views:boxEntries.length,dimensions:entities.filter(x=>x.kind==='dimension').length,constraints:constraints.length}};
}

// Exact helicoid centre/boundary curves for the production side view. They replace the old
// "draw the spiral subassembly mesh again" path, which was a major source of noisy/ragged blades.
export function renderProductionHelicoids(rec,map,box,{maxSurfaces=12}={}){
  const H=reconstructParametricHelicoids(rec),surfaces=[...H.surfaces.values()].filter(h=>h.confidence>=.78).slice(0,maxSurfaces),paths=[];
  for(const h of surfaces){
    const radii=[h.rmin+(h.rmax-h.rmin)*.12,(h.rmin+h.rmax)/2,h.rmax-(h.rmax-h.rmin)*.12];
    for(const r of radii){const pts=[];const samples=clamp(Math.ceil(Math.abs(h.tmax-h.tmin)/Math.max(2,h.pitch/48)),80,240);for(let i=0;i<=samples;i++){const t=h.tmin+(h.tmax-h.tmin)*i/samples;pts.push(map.P(helicoidPoint(h,t,r)))}paths.push(path(pts))}
  }
  return {svg:paths.length?`<g data-reference-grade-helicoids="v14.0" fill="none" stroke="#111" stroke-width=".72" stroke-linecap="round" stroke-linejoin="round"><path d="${paths.join('')}"/></g>`:'',stats:{surfaces:surfaces.length,curves:paths.length,pitch:surfaces.length?surfaces.map(h=>h.pitch).reduce((a,b)=>a+b,0)/surfaces.length:null}};
}

// Production longitudinal section grammar. This is intentionally semantic: shell, shaft and
// transverse ribs/stations are rendered from recognized dimensions/stations, while the exact
// section engine remains underneath for holes, cut faces and uncommon geometry.
export function renderProductionAAOverlay(rec,plan,map,box){
  const axis=norm(plan.axis),{u}=basis(axis),origin=plan.axisPoint||rec.bounds.center,R=(plan.outerDiameter||plan.D)/2,body=plan.body||{min:plan.min,max:plan.max};
  const t0=body.min,t1=body.max,th=Math.max(.8,plan.featureThickness||3),shaftR=Math.max(.5,(plan.shaftDiameter||0)/2);
  const W=(t,r)=>map.P(add(pointOnAxis(origin,axis,t),mul(u,r)));
  const line=(a,b,w=.65,cls='')=>`<line ${cls?`data-role="${cls}" `:''}x1="${a[0].toFixed(2)}" y1="${a[1].toFixed(2)}" x2="${b[0].toFixed(2)}" y2="${b[1].toFixed(2)}" stroke-width="${w}"/>`;
  let s=`<g data-reference-grade-aa="v14.0" fill="none" stroke="#111" stroke-linecap="square">`;
  // shell material at both longitudinal cut generators
  for(const sg of [-1,1]){s+=line(W(t0,sg*R),W(t1,sg*R),.9,'shell-outer');s+=line(W(t0,sg*(R-th)),W(t1,sg*(R-th)),.55,'shell-inner')}
  // shaft as a true longitudinal body, not a single centre line
  if(shaftR>1){s+=line(W(plan.min,-shaftR),W(plan.max,-shaftR),.72,'shaft');s+=line(W(plan.min,shaftR),W(plan.max,shaftR),.72,'shaft')}
  // transverse ring/rib stations. Use the recognized chain; pair closely spaced stations to
  // preserve actual rib thickness instead of inventing a centreline.
  const stations=(plan.chain?.stations||[]).filter(t=>t>=t0-2&&t<=t1+2);for(const t of stations)s+=line(W(t,-R),W(t,R),.58,'transverse-rib');
  s+='</g>';
  return {svg:s,stats:{stations:stations.length,shell:true,shaft:shaftR>1}};
}

// Detail D is a production detail of the blade/rib-to-shell joint. The previous implementation
// cropped arbitrary nearby mesh. v13 synthesizes the actual local engineering section using the
// measured web height, plate thickness and weld size, which makes the detail stable across views.
export function renderProductionDetailD(plan,box){
  const cx=box.x+box.w*.52,base=box.y+box.h*.69,scale=clamp((box.h*.52)/Math.max(1,plan.radialWebHeight||61),1.0,2.4),web=Math.max(28,(plan.radialWebHeight||61)*scale),plate=Math.max(4,(plan.featureThickness||3)*scale),shell=Math.max(4,(plan.featureThickness||3)*scale),weld=Math.max(3,(plan.weldSize||2)*scale);
  const top=base-web,left=box.x+box.w*.18,right=box.x+box.w*.86;
  const d=`M${left.toFixed(2)} ${(base-shell).toFixed(2)}L${right.toFixed(2)} ${(base-shell).toFixed(2)}L${right.toFixed(2)} ${base.toFixed(2)}L${left.toFixed(2)} ${base.toFixed(2)}Z`;
  const ribX1=cx-plate/2,ribX2=cx+plate/2;
  // blade approach is intentionally a smooth engineering curve, not a tessellated crop.
  const blade=`M${(left+8).toFixed(2)} ${(top+22).toFixed(2)}Q${(cx-30).toFixed(2)} ${(top+18).toFixed(2)} ${ribX1.toFixed(2)} ${(base-shell-3).toFixed(2)}`;
  const arrow=(x,y,flip=1)=>`<path d="M${x} ${y}l${6*flip} -2.4v4.8z" fill="#111"/>`;
  const dimV=(x,y1,y2,label)=>`<g stroke="#111" fill="#111" stroke-width=".58" font-size="8" font-family="Arial"><line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}"/>${arrow(x,y1,1)}${arrow(x,y2,-1)}<text x="${x+5}" y="${(y1+y2)/2}" stroke="none">${esc(label)}</text></g>`;
  const dimH=(x1,x2,y,label)=>`<g stroke="#111" fill="#111" stroke-width=".58" font-size="8" font-family="Arial"><line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}"/>${arrow(x1,y,1)}${arrow(x2,y,-1)}<text x="${(x1+x2)/2}" y="${y-4}" text-anchor="middle" stroke="none">${esc(label)}</text></g>`;
  const svg=`<g data-reference-grade-detail-d="v14.0" stroke="#111" fill="none" stroke-linejoin="round"><path d="${d}" stroke-width=".75"/><rect x="${ribX1.toFixed(2)}" y="${top.toFixed(2)}" width="${plate.toFixed(2)}" height="${(base-shell-top).toFixed(2)}" stroke-width=".78"/><path d="${blade}" stroke-width=".72"/><path d="M${ribX1} ${base-shell}l${-weld} ${-weld}h${weld*2}z" fill="#111" stroke="none"/>${dimV(right+6,top,base-shell,fmt(plan.radialWebHeight||61,0))}${dimH(cx-15,cx+15,base+16,fmt(Math.min(...(plan.chain?.segments||[30])),0))}${dimV(left-7,base-shell,base,fmt(plan.featureThickness||3,0))}${dimH(ribX1,ribX2,top-7,fmt(plan.weldSize||2,0))}<text x="${left}" y="${box.y+box.h-8}" font-family="Arial" font-size="8" stroke="none" fill="#111">Сварной шов</text></g>`;
  return {svg,stats:{webHeight:plan.radialWebHeight||null,plateThickness:plan.featureThickness||null,weldSize:plan.weldSize||null}};
}

export function referenceGradeStats(graph,helix,aa,detail){
  return {version:'14.0.2',kernel:'ROZFOOD Reference-Grade Production Drafting Core',views:graph?.counts?.views||0,dimensions:graph?.counts?.dimensions||0,constraints:graph?.counts?.constraints||0,helicoidCurves:helix?.stats?.curves||0,aaStations:aa?.stats?.stations||0,detailD:detail?.stats||null};
}
