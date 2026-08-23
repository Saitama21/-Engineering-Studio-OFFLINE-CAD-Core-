// ROZFOOD Engineering Studio v14.0.1 — Production View Synthesizer
// Rebuilds the principal orthographic production views from recognized assembly semantics
// (axis, cylindrical envelopes, stations, cross-feature graph and helicoids) instead of
// re-projecting the full tessellated assembly. Mesh/B-Rep renderers remain fallbacks only.

import {reconstructParametricHelicoids,helicoidPoint} from '../core/parametric-helical-surface-core.js';

const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const mul=(a,s)=>[a[0]*s,a[1]*s,a[2]*s];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const len=a=>Math.hypot(...a);
const norm=a=>{const L=len(a)||1;return a.map(x=>x/L)};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function basis(axis){const a=norm(axis),seed=Math.abs(a[2])<.82?[0,0,1]:[1,0,0],u=norm(cross(a,seed)),v=norm(cross(a,u));return{a,u,v}}
function pointOnAxis(origin,axis,t){const o=dot(origin,axis);return add(origin,mul(axis,t-o))}
function ppath(points){if(!points?.length)return'';return points.map((p,i)=>(i?'L':'M')+p[0].toFixed(2)+' '+p[1].toFixed(2)).join('')}

function axialMap(rec,plan,box,{padX=12,padY=10}={}){
  const axis=norm(plan.axis),{u}=basis(axis),t0=plan.min,t1=plan.max,R=(plan.outerDiameter||plan.D)/2;
  const sx=(box.w-padX*2)/Math.max(1,t1-t0),sy=(box.h-padY*2)/Math.max(1,2*R),scale=Math.min(sx,sy);
  const cx=box.x+box.w/2-((t0+t1)/2)*scale,cy=box.y+box.h/2;
  return{P:p=>[cx+dot(p,axis)*scale,cy-dot(p,u)*scale],scale,axis,u,cy,cx,t0,t1,R};
}
function endMap(rec,plan,box,{pad=10}={}){
  const axis=norm(plan.axis),{u,v}=basis(axis),R=(plan.outerDiameter||plan.D)/2,scale=Math.min((box.w-pad*2)/(2*R),(box.h-pad*2)/(2*R)),cx=box.x+box.w/2,cy=box.y+box.h/2,origin=plan.axisPoint||rec.bounds.center;
  return{P:p=>[cx+dot(p,u)*scale,cy-dot(p,v)*scale],scale,axis,u,v,cx,cy,R,origin};
}
function line(x1,y1,x2,y2,w=.72,extra=''){return`<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke-width="${w}" ${extra}/>`}
function circle(cx,cy,r,w=.72,extra=''){return`<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${Math.max(.25,r).toFixed(2)}" stroke-width="${w}" ${extra}/>`}

export function synthesizeLongitudinalView(rec,plan,box,{includeHelicoids=true,showInternal=true}={}){
  const M=axialMap(rec,plan,box),axis=M.axis,u=M.u,R=M.R,body=plan.body||{min:plan.min,max:plan.max},origin=plan.axisPoint||rec.bounds.center,th=Math.max(.8,plan.featureThickness||3),shaftR=Math.max(.4,(plan.shaftDiameter||0)/2);
  const W=(t,r)=>M.P(add(pointOnAxis(origin,axis,t),mul(u,r)));
  let s=`<g data-production-view-synthesizer="longitudinal-v14" fill="none" stroke="#111" stroke-linecap="round" stroke-linejoin="round">`;
  // primary shell envelope and end faces
  for(const sg of [-1,1]){const a=W(body.min,sg*R),b=W(body.max,sg*R);s+=line(a[0],a[1],b[0],b[1],.92);if(showInternal){const ai=W(body.min,sg*(R-th)),bi=W(body.max,sg*(R-th));s+=line(ai[0],ai[1],bi[0],bi[1],.48)}}
  for(const t of [body.min,body.max]){const a=W(t,-R),b=W(t,R);s+=line(a[0],a[1],b[0],b[1],.82)}
  // axial shaft
  if(shaftR>1){for(const sg of [-1,1]){const a=W(plan.min,sg*shaftR),b=W(plan.max,sg*shaftR);s+=line(a[0],a[1],b[0],b[1],.72)}for(const t of [plan.min,plan.max]){const a=W(t,-shaftR),b=W(t,shaftR);s+=line(a[0],a[1],b[0],b[1],.66)}}
  // true rib/ring stations from semantic chain
  const stations=[...(plan.chain?.stations||[])].filter(t=>t>=body.min-1&&t<=body.max+1);for(const t of stations){const a=W(t,-R),b=W(t,R);s+=line(a[0],a[1],b[0],b[1],.62,'data-role="ring-station"')}
  // shell seam/end minor stations from recognized short axial segments
  for(const seg of (plan.smallSegments||[]).filter(x=>x.length>=8&&x.length<=65).slice(0,8)){for(const t of [seg.a,seg.b]){if(t<body.min-2||t>body.max+2)continue;const a=W(t,-R),b=W(t,R);s+=line(a[0],a[1],b[0],b[1],.42,'data-role="minor-station"')}}
  // centerline
  s+=line(box.x+2,M.cy,box.x+box.w-2,M.cy,.45,'stroke="#666" stroke-dasharray="11 3 2 3"');
  let helicoidCurves=0;
  if(includeHelicoids){const H=reconstructParametricHelicoids(rec),surfaces=[...H.surfaces.values()].filter(h=>h.confidence>=.80);const paths=[];for(const h of surfaces){for(const r of [h.rmin+(h.rmax-h.rmin)*.18,h.rmax-(h.rmax-h.rmin)*.18]){const pts=[],N=clamp(Math.ceil(Math.abs(h.tmax-h.tmin)/Math.max(2,h.pitch/55)),90,260);for(let i=0;i<=N;i++){const t=h.tmin+(h.tmax-h.tmin)*i/N;pts.push(M.P(helicoidPoint(h,t,r)))}paths.push(ppath(pts));helicoidCurves++}}if(paths.length)s+=`<path d="${paths.join('')}" stroke-width=".66"/>`}
  s+='</g>';
  return{svg:s,map:M,stats:{kind:'longitudinal',stations:stations.length,helicoidCurves,meshFallback:false}};
}

export function synthesizeEndView(rec,plan,box,crossGraph=null,{section=false}={}){
  const M=endMap(rec,plan,box),c=[M.cx,M.cy],scale=M.scale,diameters=[];
  for(const d of [plan.outerDiameter,plan.midBore,plan.innerBore,plan.shaftDiameter])if(Number.isFinite(d)&&d>0&&!diameters.some(x=>Math.abs(x-d)<.8))diameters.push(d);
  let s=`<g data-production-view-synthesizer="${section?'section-end':'end'}-v14" fill="none" stroke="#111" stroke-linecap="round" stroke-linejoin="round">`;
  diameters.forEach((d,i)=>{const w=i===0?.95:(i===diameters.length-1?.68:.56);s+=circle(c[0],c[1],d*scale/2,w)});
  let rods=0,holes=0;
  if(crossGraph){for(const rod of crossGraph.rods||[]){const a=norm(rod.axis),half=(rod.length||0)/2,p0=M.P(add(rod.axisPoint,mul(a,-half))),p1=M.P(add(rod.axisPoint,mul(a,half))),dx=p1[0]-p0[0],dy=p1[1]-p0[1],L=Math.hypot(dx,dy)||1,nx=-dy/L,ny=dx/L,w=(rod.diameter||16)*scale/2;s+=line(p0[0]+nx*w,p0[1]+ny*w,p1[0]+nx*w,p1[1]+ny*w,.72)+line(p0[0]-nx*w,p0[1]-ny*w,p1[0]-nx*w,p1[1]-ny*w,.72);rods++}
    for(const h of crossGraph.holes||[]){const q=M.P(h.axisPoint);s+=circle(q[0],q[1],(h.diameter||crossGraph.holeDiameter||0)*scale/2,.62);holes++}
    if(crossGraph.holePcd)s+=circle(c[0],c[1],crossGraph.holePcd*scale/2,.42,'stroke="#777" stroke-dasharray="7 3 1.5 3"');
  }
  s+=line(box.x+6,c[1],box.x+box.w-6,c[1],.42,'stroke="#666" stroke-dasharray="10 3 2 3"')+line(c[0],box.y+6,c[0],box.y+box.h-6,.42,'stroke="#666" stroke-dasharray="10 3 2 3"');
  if(section){ // semantic section hatching on material annuli, conservative and deterministic
    const outer=(plan.outerDiameter||0)*scale/2,inner=(plan.innerBore||0)*scale/2;if(outer>inner+2){const clipId=`pvsh-${Math.round(box.x)}-${Math.round(box.y)}`;s+=`<defs><clipPath id="${clipId}"><path d="M${c[0]-outer} ${c[1]}a${outer} ${outer} 0 1 0 ${2*outer} 0a${outer} ${outer} 0 1 0 ${-2*outer} 0M${c[0]-inner} ${c[1]}a${inner} ${inner} 0 1 1 ${2*inner} 0a${inner} ${inner} 0 1 1 ${-2*inner} 0" fill-rule="evenodd"/></clipPath></defs><g clip-path="url(#${clipId})" stroke="#666" stroke-width=".38">`;for(let x=box.x-box.h;x<box.x+box.w+box.h;x+=9)s+=line(x,box.y+box.h,x+box.h,box.y,.38);s+='</g>'}}
  s+='</g>';
  return{svg:s,map:M,stats:{kind:section?'section-end':'end',diameters:diameters.length,rods,holes,meshFallback:false}};
}

export function buildProductionViewSynthesis(rec,plan,composition,{crossGraph=null}={}){
  const top=synthesizeLongitudinalView(rec,plan,composition.boxes.top,{includeHelicoids:false,showInternal:false});
  const main=synthesizeLongitudinalView(rec,plan,composition.boxes.main,{includeHelicoids:true,showInternal:true});
  const end=synthesizeEndView(rec,plan,composition.boxes.end,crossGraph,{section:false});
  const bb=synthesizeEndView(rec,plan,composition.boxes.bb,crossGraph,{section:true});
  const stats={version:'14.0.1',kernel:'ROZFOOD Production View Synthesizer',views:4,meshFallbacks:0,longitudinalStations:main.stats.stations,helicoidCurves:main.stats.helicoidCurves,endDiameters:end.stats.diameters,endRods:end.stats.rods,endHoles:end.stats.holes};
  return{version:'14.0.1',top,main,end,bb,stats};
}
