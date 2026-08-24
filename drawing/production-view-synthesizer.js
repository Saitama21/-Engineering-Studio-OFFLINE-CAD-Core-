// ROZFOOD Engineering Studio v14.3.0 — Production View Synthesizer
// Rebuilds the principal orthographic production views from recognized assembly semantics
// (axis, cylindrical envelopes, stations, cross-feature graph and helicoids) instead of
// re-projecting the full tessellated assembly. Mesh/B-Rep renderers remain fallbacks only.

import {productionHelicalFeatureEdges} from '../core/analytic-geometry.js';
import {buildAnalyticFaceHLR,analyticFacePointVisibility} from '../core/analytic-face-hlr-core.js';

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

// v14.3 — component-level helical plate recovery.
// Some SolidWorks FaceTessellations expose only one long boundary of a swept plate (or split the
// other boundary across many face blocks).  The legacy boundary-chain fitter could therefore miss
// a whole flight even though the component point cloud still contains an excellent cylindrical
// helix signal.  Recover one helix law per plate component from its radial edge bands, then infer
// the paired inner/outer production edges from the same law.  This stays source-derived: t-range,
// radii, phase and pitch all come from the embedded component tessellation.
const helicalPlateCache=new WeakMap();
function qtile(sorted,q){if(!sorted.length)return NaN;const x=(sorted.length-1)*q,i=Math.floor(x),j=Math.min(sorted.length-1,i+1),f=x-i;return sorted[i]*(1-f)+sorted[j]*f}
function circularMean(angles){let sx=0,sy=0;for(const a of angles){sx+=Math.cos(a);sy+=Math.sin(a)}return Math.atan2(sy,sx)}
function fitHelixBand(samples,target,tol){
  const picked=samples.filter(q=>Math.abs(q.r-target)<=tol);if(picked.length<18)return null;
  const bins=new Map();for(const q of picked){const k=Math.round(q.t*2)/2;let a=bins.get(k);if(!a)bins.set(k,a=[]);a.push(q.a)}
  const seq=[...bins.entries()].sort((a,b)=>a[0]-b[0]).map(([t,a])=>({t,a:circularMean(a)}));if(seq.length<10)return null;
  let prev=null,acc=0;for(const q of seq){if(prev===null)acc=q.a;else{let d=q.a-prev;while(d>Math.PI)d-=Math.PI*2;while(d<-Math.PI)d+=Math.PI*2;acc+=d}prev=q.a;q.u=acc}
  const n=seq.length,tm=seq.reduce((s,q)=>s+q.t,0)/n,am=seq.reduce((s,q)=>s+q.u,0)/n;
  let stt=0,sta=0;for(const q of seq){const dt=q.t-tm;stt+=dt*dt;sta+=dt*(q.u-am)}if(stt<1e-6)return null;
  const k=sta/stt,b=am-k*tm,rms=Math.sqrt(seq.reduce((s,q)=>s+(q.u-(k*q.t+b))**2,0)/n),tmin=seq[0].t,tmax=seq.at(-1).t,span=tmax-tmin,pitch=Math.PI*2/Math.abs(k||1e-12),sweep=k*span;
  return{k,b,rms,tmin,tmax,span,pitch,sweep,count:picked.length,bins:n};
}
function phaseAt(f,t){return f.k*t+f.b}
function mergeHelixFits(a,b,t){
  if(!a)return b;if(!b)return a;
  const ka=(a.k+a.k+b.k)/3,kb=(b.k+b.k+a.k)/3,k=(ka+kb)/2;
  let aa=phaseAt(a,t),bb=phaseAt(b,t);while(bb-aa>Math.PI)bb-=Math.PI*2;while(bb-aa<-Math.PI)bb+=Math.PI*2;
  const phase=(aa+bb)/2;return{k,b:phase-k*t,rms:(a.rms+b.rms)/2,tmin:Math.min(a.tmin,b.tmin),tmax:Math.max(a.tmax,b.tmax),span:Math.max(a.tmax,b.tmax)-Math.min(a.tmin,b.tmin),pitch:Math.PI*2/Math.abs(k||1e-12),sweep:k*(Math.max(a.tmax,b.tmax)-Math.min(a.tmin,b.tmin)),count:a.count+b.count,bins:a.bins+b.bins};
}
export function reconstructHelicalPlateComponents(rec,plan){
  const cached=helicalPlateCache.get(rec);if(cached&&cached.planL===plan?.L&&cached.planD===plan?.D)return cached.result;
  const axis=norm(plan?.axis||[0,1,0]),origin=plan?.axisPoint||rec?.bounds?.center||[0,0,0],{u,v}=basis(axis),R=Math.max(1,(plan?.outerDiameter||plan?.D||1)/2),major=Math.max(1,plan?.L||rec?.bounds?.size?.[1]||1),minor=Math.max(1,plan?.D||R*2),byComp=new Map();
  const q=Math.max(.02,minor*4e-5);
  for(const f of rec?.faces||[]){const id=f.componentId||'RAW';let g=byComp.get(id);if(!g){g=new Map();byComp.set(id,g)}for(const loop of f.loops||[])for(const p of loop||[]){const key=p.map(x=>Math.round(x/q)).join(',');if(g.has(key))continue;const d=[p[0]-origin[0],p[1]-origin[1],p[2]-origin[2]],x=dot(d,u),y=dot(d,v);g.set(key,{t:dot(d,axis),r:Math.hypot(x,y),a:Math.atan2(y,x)})}}
  const models=[];
  for(const [componentId,map] of byComp){const samples=[...map.values()];if(samples.length<70)continue;const ts=samples.map(q=>q.t),rs=samples.map(q=>q.r).sort((a,b)=>a-b),tmin=Math.min(...ts),tmax=Math.max(...ts),tspan=tmax-tmin,rlo=qtile(rs,.08),rhi=qtile(rs,.98),radialSpan=rhi-rlo;
    // A helical flight is a short axial component spanning a large radial band near the drum wall.
    // This rejects shafts, rings and the transverse cross assembly without filename-specific rules.
    if(tspan<Math.max(28,minor*.055)||tspan>major*.24||rhi<R*.82||rlo<R*.42||radialSpan<minor*.075)continue;
    const tol=Math.max(1.1,radialSpan*.032),low=fitHelixBand(samples,rlo,tol),high=fitHelixBand(samples,rhi,tol),seed=low||high;if(!seed)continue;
    const mid=(tmin+tmax)/2,fit=mergeHelixFits(low,high,mid),pitch=fit.pitch;
    if(fit.rms>.075||pitch<minor*.18||pitch>major*.72||Math.abs(fit.k*tspan)<.75)continue;
    // Use the full source-component axial extent. Missing edge samples are completed only by the
    // verified companion helix law, not by a global guessed pitch.
    models.push({componentId,tmin,tmax,rmin:rlo,rmax:rhi,k:fit.k,b:fit.b,pitch,fitRms:fit.rms,sourceLow:!!low,sourceHigh:!!high,pointCount:samples.length,confidence:clamp(1-fit.rms/.12+(low&&high?0.08:0),0,1)});
  }
  models.sort((a,b)=>a.tmin-b.tmin);const result={version:'14.3.0',kernel:'ROZFOOD Component Helical Plate Recovery',models,counts:{components:models.length,pairedSourceEdges:models.filter(m=>m.sourceLow&&m.sourceHigh).length,inferredCompanionEdges:models.filter(m=>!(m.sourceLow&&m.sourceHigh)).length}};
  helicalPlateCache.set(rec,{planL:plan?.L,planD:plan?.D,result});return result;
}
function helicalPoint(frame,h,t,r){const a=h.k*t+h.b;return add(frame.origin,add(mul(frame.axis,t),add(mul(frame.u,Math.cos(a)*r),mul(frame.v,Math.sin(a)*r))))}
function renderRecoveredHelicalPlates(rec,plan,M){
  const recovered=reconstructHelicalPlateComponents(rec,plan),frame={origin:plan.axisPoint||rec.bounds.center,axis:M.axis,u:M.u,v:M.v},paths=[];const renderedComponents=new Set();let curveRuns=0;
  for(const h of recovered.models){
    for(const r of [h.rmin,h.rmax]){const samples=clamp(Math.ceil(Math.abs(h.k*(h.tmax-h.tmin))/(Math.PI*2)*144),42,260),runs=[];let run=[];
      for(let i=0;i<=samples;i++){const t=h.tmin+(h.tmax-h.tmin)*i/samples,a=h.k*t+h.b,p=helicalPoint(frame,h,t,r),q=M.P(p);
        // Production orthographic convention: keep the near half of the flight.  This yields the
        // same single descending blade trace as a conventional HLR view and avoids duplicate U/V
        // loops when opposite tessellated faces describe the same sheet edge.
        const visible=Math.sin(a)<=.035;
        if(visible)run.push(q);else if(run.length){if(run.length>=3)runs.push(run);run=[]}
      }
      if(run.length>=3)runs.push(run);
      for(const pts of runs){const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]);if(Math.max(...xs)-Math.min(...xs)<3||Math.max(...ys)-Math.min(...ys)<6)continue;paths.push(ppath(pts));curveRuns++;renderedComponents.add(h.componentId)}
    }
  }
  return{svg:paths.length?`<path d="${paths.join('')}" stroke-width=".66" data-role="component-helical-plate-edges"/>`:'',stats:{helicalComponents:recovered.counts.components,renderedHelicalComponents:renderedComponents.size,helicoidCurves:curveRuns,inferredCompanionEdges:recovered.counts.inferredCompanionEdges,pairedSourceEdges:recovered.counts.pairedSourceEdges}};
}


function axialMap(rec,plan,box,{padX=12,padY=10}={}){
  const axis=norm(plan.axis),{u,v}=basis(axis),t0=plan.min,t1=plan.max,R=(plan.outerDiameter||plan.D)/2;
  const sx=(box.w-padX*2)/Math.max(1,t1-t0),sy=(box.h-padY*2)/Math.max(1,2*R),scale=Math.min(sx,sy);
  const cx=box.x+box.w/2-((t0+t1)/2)*scale,cy=box.y+box.h/2;
  return{P:p=>[cx+dot(p,axis)*scale,cy-dot(p,u)*scale],scale,axis,u,v,viewDir:v,cy,cx,t0,t1,R};
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
  let helicoidCurves=0,helicalComponents=0,renderedHelicalComponents=0,inferredCompanionEdges=0,helicalSource='none';
  if(includeHelicoids){
    // Prefer the component-level recovery: it preserves all three real flight components even when
    // SolidWorks split one of their source boundaries across tessellation blocks.
    const recovered=renderRecoveredHelicalPlates(rec,plan,M);
    if(recovered.stats.helicalComponents>0){
      s+=recovered.svg;helicoidCurves=recovered.stats.helicoidCurves;helicalComponents=recovered.stats.helicalComponents;renderedHelicalComponents=recovered.stats.renderedHelicalComponents;inferredCompanionEdges=recovered.stats.inferredCompanionEdges;helicalSource='component-tessellation';
    }else{
      const H=productionHelicalFeatureEdges(rec,{samplesPerTurn:112}),paths=[];
      // Legacy source-boundary fallback for non-plate helical features.
      const hlr=buildAnalyticFaceHLR(rec),shellTop=M.cy-R*M.scale-2,shellBottom=M.cy+R*M.scale+2;
      for(const h of H.curves||[]){
        if(h.kind!=='helix'||!h.points?.length)continue;
        const runs=[];let run=[];
        for(let i=0;i<h.points.length;i++){
          const p=h.points[i],q=M.P(p),visible=analyticFacePointVisibility(p,M.viewDir,hlr,h).visible;
          if(visible&&q[1]>=shellTop-3&&q[1]<=shellBottom+3)run.push(q);else if(run.length){if(run.length>=2)runs.push(run);run=[]}
        }
        if(run.length>=2)runs.push(run);
        for(const pts of runs){const ys=pts.map(q=>q[1]);if(Math.max(...ys)-Math.min(...ys)>2*R*M.scale*1.02)continue;paths.push(ppath(pts));helicoidCurves++}
      }
      if(paths.length)s+=`<path d="${paths.join('')}" stroke-width=".62" data-role="source-edge-helices"/>`;
      helicalSource='boundary-fallback';
    }
  }
  s+='</g>';
  return{svg:s,map:M,stats:{kind:'longitudinal',stations:stations.length,helicoidCurves,helicalComponents,renderedHelicalComponents,inferredCompanionEdges,helicalSource,meshFallback:false}};
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
  const stats={version:'14.3.0',kernel:'ROZFOOD Production View Synthesizer',views:4,meshFallbacks:0,longitudinalStations:main.stats.stations,helicoidCurves:main.stats.helicoidCurves,helicalComponents:main.stats.helicalComponents||0,renderedHelicalComponents:main.stats.renderedHelicalComponents||0,inferredCompanionEdges:main.stats.inferredCompanionEdges||0,helicalSource:main.stats.helicalSource||'none',endDiameters:end.stats.diameters,endRods:end.stats.rods,endHoles:end.stats.holes};
  return{version:'14.3.0',top,main,end,bb,stats};
}
