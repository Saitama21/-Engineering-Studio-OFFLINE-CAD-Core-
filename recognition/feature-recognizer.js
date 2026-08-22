import {entity,getPoint,getPlacement,unwrapCurve,refId} from '../import/step-parser.js';
import {add,mul,basis,dist,norm,dot,sub,len,clamp} from '../core/math3d.js';

const round=(v,n=4)=>Math.round(v*10**n)/10**n;
const keyNum=(v,t=1e-4)=>Math.round(v/t)*t;

function unitFactorToMM(model){
  for(const e of model.entities.values()) if(e.raw?.includes('SI_UNIT(.MILLI.,.METRE.)')) return 1;
  for(const e of model.entities.values()) if(e.raw?.includes('SI_UNIT($,.METRE.)')) return 1000;
  return 1;
}

function cartesian3DPoints(model, factor){
  const pts=[];
  for(const e of model.byType.get('CARTESIAN_POINT')||[]){
    const c=e.args[1]; if(Array.isArray(c)&&c.length===3&&c.every(Number.isFinite)) pts.push(c.map(v=>v*factor));
  }
  return pts;
}

function bbox(points){
  if(!points.length) return {min:[0,0,0],max:[0,0,0],size:[0,0,0],center:[0,0,0]};
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const p of points) for(let i=0;i<3;i++){min[i]=Math.min(min[i],p[i]);max[i]=Math.max(max[i],p[i]);}
  const size=max.map((v,i)=>v-min[i]),center=max.map((v,i)=>(v+min[i])/2); return {min,max,size,center};
}

function geometryCurve(model, edge){
  if(edge?.type!=='EDGE_CURVE') return null;
  return unwrapCurve(model, edge.args[3]);
}

function scaledPoint(p,f){return p?.map(v=>v*f)||null}
function scaledPlacement(pl,f){return pl?{origin:scaledPoint(pl.origin,f),axis:pl.axis,refdir:pl.refdir}:null}

function edgeRecord(model, e, factor){
  const p1=scaledPoint(getPoint(model,e.args[1]),factor),p2=scaledPoint(getPoint(model,e.args[2]),factor);
  const curve=geometryCurve(model,e);
  if(!curve) return p1&&p2?{kind:'line',p1,p2,source:e.id}:null;
  if(curve.type==='CIRCLE'){
    const pl=scaledPlacement(getPlacement(model,curve.args[1]),factor); const radius=Number(curve.args[2])*factor;
    return pl&&Number.isFinite(radius)?{kind:'circle',placement:pl,radius,p1,p2,source:e.id,curve:curve.id}:null;
  }
  if(curve.type==='ELLIPSE'){
    const pl=scaledPlacement(getPlacement(model,curve.args[1]),factor); const r1=Number(curve.args[2])*factor,r2=Number(curve.args[3])*factor;
    return pl&&Number.isFinite(r1)&&Number.isFinite(r2)?{kind:'ellipse',placement:pl,r1,r2,p1,p2,source:e.id,curve:curve.id}:null;
  }
  return p1&&p2?{kind:'line',p1,p2,source:e.id,curve:curve.id,type:curve.type}:null;
}

function surfaceRecord(model,e,factor){
  const type=e.type;
  if(type==='PLANE') return {type,id:e.id,placement:scaledPlacement(getPlacement(model,e.args[1]),factor)};
  if(type==='CYLINDRICAL_SURFACE') return {type,id:e.id,placement:scaledPlacement(getPlacement(model,e.args[1]),factor),radius:Number(e.args[2])*factor};
  if(type==='CONICAL_SURFACE') return {type,id:e.id,placement:scaledPlacement(getPlacement(model,e.args[1]),factor),radius:Number(e.args[2])*factor,semiAngle:Number(e.args[3])};
  if(type==='SPHERICAL_SURFACE') return {type,id:e.id,placement:scaledPlacement(getPlacement(model,e.args[1]),factor),radius:Number(e.args[2])*factor};
  if(type==='TOROIDAL_SURFACE') return {type,id:e.id,placement:scaledPlacement(getPlacement(model,e.args[1]),factor),majorRadius:Number(e.args[2])*factor,minorRadius:Number(e.args[3])*factor};
  return null;
}

function almostParallel(a,b,tol=1e-4){return Math.abs(Math.abs(dot(norm(a),norm(b)))-1)<tol}


function representationClosure(model, repId){
  const visited=new Set(), stack=[repId];
  while(stack.length){const id=stack.pop();if(!id||visited.has(id))continue;visited.add(id);const e=model.entities.get(id);if(!e)continue;for(const r of deepRefs(e.args))if(!visited.has(r))stack.push(r)}
  return visited;
}
function deepRefs(v,out=[]){if(Array.isArray(v))for(const x of v)deepRefs(x,out);else if(v&&typeof v==='object'){if(Number.isInteger(v.ref))out.push(v.ref);if(v.args)deepRefs(v.args,out)}return out}
function parseComplexRelationship(raw=''){
  const rr=raw.match(/REPRESENTATION_RELATIONSHIP\s*\(\s*'[^']*'\s*,\s*'[^']*'\s*,\s*#(\d+)\s*,\s*#(\d+)\s*\)/i);
  const tr=raw.match(/REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION\s*\(\s*#(\d+)\s*\)/i);
  return rr&&tr?{sourceRep:Number(rr[1]),targetRep:Number(rr[2]),transformId:Number(tr[1])}:null;
}
function transformPointBetweenPlacements(p,from,to,factor){
  if(!from||!to)return p; const A=basis(from.axis,from.refdir),B=basis(to.axis,to.refdir); const pf=p.map(v=>v/factor); const q=sub(pf,from.origin); const local=[dot(q,A.x),dot(q,A.y),dot(q,A.z)]; const world=add(to.origin,add(mul(B.x,local[0]),add(mul(B.y,local[1]),mul(B.z,local[2])))); return world.map(v=>v*factor);
}
function transformVectorBetweenPlacements(v,from,to){
  if(!from||!to)return v;const A=basis(from.axis,from.refdir),B=basis(to.axis,to.refdir);const local=[dot(v,A.x),dot(v,A.y),dot(v,A.z)];return add(mul(B.x,local[0]),add(mul(B.y,local[1]),mul(B.z,local[2])));
}
function transformEdge(e,from,to,factor){
  if(e.kind==='line')return {...e,p1:transformPointBetweenPlacements(e.p1,from,to,factor),p2:transformPointBetweenPlacements(e.p2,from,to,factor)};
  return {...e,placement:{origin:transformPointBetweenPlacements(e.placement.origin,from,to,factor),axis:transformVectorBetweenPlacements(e.placement.axis,from,to),refdir:transformVectorBetweenPlacements(e.placement.refdir,from,to)},p1:e.p1?transformPointBetweenPlacements(e.p1,from,to,factor):null,p2:e.p2?transformPointBetweenPlacements(e.p2,from,to,factor):null};
}
function transformSurface(s,from,to,factor){return {...s,placement:s.placement?{origin:transformPointBetweenPlacements(s.placement.origin,from,to,factor),axis:transformVectorBetweenPlacements(s.placement.axis,from,to),refdir:transformVectorBetweenPlacements(s.placement.refdir,from,to)}:null}}
function assemblyInstances(model,factor){
  const out=[];
  for(const cds of model.byType.get('CONTEXT_DEPENDENT_SHAPE_REPRESENTATION')||[]){
    const rel=entity(model,cds.args[0]),pds=entity(model,cds.args[1]); if(!rel||!pds)continue; const info=parseComplexRelationship(rel.raw);if(!info)continue;
    const tr=model.entities.get(info.transformId),occ=entity(model,pds.args[2]); if(!tr||tr.type!=='ITEM_DEFINED_TRANSFORMATION'||!occ)continue;
    const from=getPlacement(model,tr.args[2]),to=getPlacement(model,tr.args[3]); out.push({occurrenceId:occ.id,name:String(occ.args[1]||occ.args[0]||`Component ${occ.id}`),sourceRep:info.sourceRep,targetRep:info.targetRep,from,to,closure:representationClosure(model,info.sourceRep)});
  }
  return out;
}

function recognizeBoltPatterns(cylinders){
  const groups=new Map();
  for(const c of cylinders){
    if(!c.placement||!Number.isFinite(c.radius)) continue;
    const ax=norm(c.placement.axis); const dominant=ax.map(Math.abs).indexOf(Math.max(...ax.map(Math.abs)));
    const key=`${keyNum(c.radius,1e-3)}|${dominant}`;
    if(!groups.has(key)) groups.set(key,[]); groups.get(key).push(c);
  }
  const patterns=[];
  for(const list of groups.values()){
    if(list.length<3) continue;
    const axis=list[0].placement.axis; if(!list.every(c=>almostParallel(c.placement.axis,axis))) continue;
    const dominant=norm(axis).map(Math.abs).indexOf(Math.max(...norm(axis).map(Math.abs)));
    const dims=[0,1,2].filter(i=>i!==dominant);
    const centers=list.map(c=>[c.placement.origin[dims[0]],c.placement.origin[dims[1]]]);
    const cx=centers.reduce((s,p)=>s+p[0],0)/centers.length, cy=centers.reduce((s,p)=>s+p[1],0)/centers.length;
    const rs=centers.map(p=>Math.hypot(p[0]-cx,p[1]-cy)); const mean=rs.reduce((a,b)=>a+b,0)/rs.length;
    const spread=Math.max(...rs)-Math.min(...rs);
    if(mean>1e-6 && spread<Math.max(0.05,mean*0.002)) patterns.push({count:list.length,holeDiameter:list[0].radius*2,pcd:mean*2,center:[cx,cy],axis,spread,source:list.map(x=>x.id)});
  }
  return patterns.sort((a,b)=>b.count-a.count);
}

function productInfo(model){
  const products=(model.byType.get('PRODUCT')||[]).map(e=>({id:e.id,name:String(e.args[0]??''),description:String(e.args[1]??'')}));
  const occurrences=(model.byType.get('NEXT_ASSEMBLY_USAGE_OCCURRENCE')||[]).map(e=>({id:e.id,name:String(e.args[1]??e.args[0]??''),parent:refId(e.args[3]),child:refId(e.args[4])}));
  return {products,occurrences,isAssembly:occurrences.length>0 || products.length>1};
}

export function recognizeSTEP(model){
  const factor=unitFactorToMM(model);
  const rawEdges=(model.byType.get('EDGE_CURVE')||[]).map(e=>[e.id,edgeRecord(model,e,factor)]).filter(x=>x[1]);
  const rawSurfaces=[];
  for(const type of ['PLANE','CYLINDRICAL_SURFACE','CONICAL_SURFACE','SPHERICAL_SURFACE','TOROIDAL_SURFACE'])
    for(const e of model.byType.get(type)||[]){const sr=surfaceRecord(model,e,factor); if(sr)rawSurfaces.push([e.id,sr])}
  const instances=assemblyInstances(model,factor);
  let edges,surfaces;
  if(instances.length){
    edges=[];surfaces=[];
    for(const inst of instances){for(const [id,e] of rawEdges)if(inst.closure.has(id))edges.push({...transformEdge(e,inst.from,inst.to,factor),instance:inst.name});for(const [id,sr] of rawSurfaces)if(inst.closure.has(id))surfaces.push({...transformSurface(sr,inst.from,inst.to,factor),instance:inst.name})}
  }else{edges=rawEdges.map(x=>x[1]);surfaces=rawSurfaces.map(x=>x[1])}
  const points=[];
  for(const e of edges){
    if(e.kind==='line'){ if(e.p1)points.push(e.p1); if(e.p2)points.push(e.p2); }
    else if(e.kind==='circle'||e.kind==='ellipse'){
      const {x,y}=basis(e.placement.axis,e.placement.refdir),o=e.placement.origin; const rx=e.kind==='circle'?e.radius:e.r1, ry=e.kind==='circle'?e.radius:e.r2;
      for(let i=0;i<72;i++){const a=i/72*Math.PI*2;points.push(add(o,add(mul(x,Math.cos(a)*rx),mul(y,Math.sin(a)*ry))))}
    }
  }
  if(!points.length)points.push(...cartesian3DPoints(model,factor));
  const bounds=bbox(points);
  const cylinders=surfaces.filter(s=>s.type==='CYLINDRICAL_SURFACE');
  const boltPatterns=recognizeBoltPatterns(cylinders);
  const radii=[...new Set(cylinders.map(c=>round(c.radius,4)))].sort((a,b)=>a-b);
  const circleRadii=[...new Set(edges.filter(e=>e.kind==='circle').map(e=>round(e.radius,4)))].sort((a,b)=>a-b);
  const products=productInfo(model);
  const counts={
    entities:model.entityCount,
    solids:(model.byType.get('MANIFOLD_SOLID_BREP')||[]).length,
    shells:(model.byType.get('CLOSED_SHELL')||[]).length,
    faces:(model.byType.get('ADVANCED_FACE')||[]).length,
    edges:(model.byType.get('EDGE_CURVE')||[]).length,
    vertices:(model.byType.get('VERTEX_POINT')||[]).length,
    planes:surfaces.filter(s=>s.type==='PLANE').length,
    cylinders:cylinders.length,
    cones:surfaces.filter(s=>s.type==='CONICAL_SURFACE').length,
    spheres:surfaces.filter(s=>s.type==='SPHERICAL_SURFACE').length,
    tori:surfaces.filter(s=>s.type==='TOROIDAL_SURFACE').length,
    bsplines:(model.byType.get('B_SPLINE_CURVE_WITH_KNOTS')||[]).length+(model.byType.get('B_SPLINE_SURFACE_WITH_KNOTS')||[]).length,
  };
  return {factor,unit:'mm',points,bounds,edges,surfaces,cylinders,boltPatterns,radii,circleRadii,products,...products,instances,counts};
}

export function makeDimensionSet(rec){
  const d=[]; const [sx,sy,sz]=rec.bounds.size;
  if(sx>1e-8)d.push({type:'overall',label:'Габарит X',value:sx,unit:'mm',confidence:1});
  if(sy>1e-8)d.push({type:'overall',label:'Габарит Y',value:sy,unit:'mm',confidence:1});
  if(sz>1e-8)d.push({type:'overall',label:'Габарит Z',value:sz,unit:'mm',confidence:1});
  const cylGroups=new Map();
  for(const c of rec.cylinders){const k=round(c.radius*2,4);cylGroups.set(k,(cylGroups.get(k)||0)+1)}
  for(const [diam,count] of [...cylGroups.entries()].sort((a,b)=>b[0]-a[0])) d.push({type:'diameter',label:`Ø${diam.toFixed(3)}${count>1?` × ${count}`:''}`,value:diam,unit:'mm',count,confidence:0.95});
  for(const p of rec.boltPatterns) d.push({type:'pcd',label:`PCD Ø${p.pcd.toFixed(3)} · ${p.count}×Ø${p.holeDiameter.toFixed(3)}`,value:p.pcd,unit:'mm',count:p.count,holeDiameter:p.holeDiameter,confidence:0.92});
  for(const s of rec.surfaces.filter(s=>s.type==='CONICAL_SURFACE')) d.push({type:'angle',label:`Конус ${(s.semiAngle*180/Math.PI*2).toFixed(3)}°`,value:s.semiAngle*180/Math.PI*2,unit:'°',confidence:0.9});

  // Axial segment lengths for rotational parts: extracted from concentric circular edges.
  // This is deterministic geometry, not AI inference.
  if(rec.cylinders?.length&&rec.edges?.length){
    const axisVotes=[0,0,0];
    for(const c of rec.cylinders){const a=(c.placement?.axis||[0,0,1]).map(Math.abs),i=a.indexOf(Math.max(...a));axisVotes[i]++}
    const axis=axisVotes.indexOf(Math.max(...axisVotes)),other=[0,1,2].filter(i=>i!==axis),center=rec.bounds.center,tol=Math.max(.02,Math.max(...rec.bounds.size)*.004);
    const coords=[...new Set(rec.edges.filter(e=>e.kind==='circle'&&e.placement&&Math.abs(Math.abs(norm(e.placement.axis)[axis])-1)<.015&&Math.hypot(e.placement.origin[other[0]]-center[other[0]],e.placement.origin[other[1]]-center[other[1]])<=tol).map(e=>round(e.placement.origin[axis],4)))].sort((a,b)=>a-b);
    for(let i=0;i<coords.length-1;i++){const value=coords[i+1]-coords[i];if(value>tol)d.push({type:'length',label:`Участок ${value.toFixed(3)}`,value,unit:'mm',axis:['X','Y','Z'][axis],from:coords[i],to:coords[i+1],confidence:0.94})}
  }
  return d;
}
