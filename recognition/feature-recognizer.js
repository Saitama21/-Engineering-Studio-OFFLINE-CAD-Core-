import {entity,getPoint,getPlacement,unwrapCurve,refId} from '../import/step-parser.js';
import {add,mul,basis,dot,sub,norm,dist,clamp,identityTransform,betweenPlacements,composeTransform,applyTransform,applyVector} from '../core/math3d.js';

const round=(v,n=4)=>Math.round(v*10**n)/10**n;
const keyNum=(v,t=1e-4)=>Math.round(v/t)*t;

function unitFactorToMM(model){
  for(const e of model.entities.values()) if(e.raw?.includes('SI_UNIT(.MILLI.,.METRE.)')) return 1;
  for(const e of model.entities.values()) if(e.raw?.includes('SI_UNIT($,.METRE.)')) return 1000;
  return 1;
}
function scaledPoint(p,f){return p?.map(v=>v*f)||null}
function scaledPlacement(pl,f){return pl?{origin:scaledPoint(pl.origin,f),axis:pl.axis,refdir:pl.refdir}:null}
function cartesian3DPoints(model,factor){const pts=[];for(const e of model.byType.get('CARTESIAN_POINT')||[]){const c=e.args[1];if(Array.isArray(c)&&c.length===3&&c.every(Number.isFinite))pts.push(c.map(v=>v*factor));}return pts}
function bbox(points){if(!points.length)return{min:[0,0,0],max:[0,0,0],size:[0,0,0],center:[0,0,0]};const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(const p of points)for(let i=0;i<3;i++){min[i]=Math.min(min[i],p[i]);max[i]=Math.max(max[i],p[i]);}const size=max.map((v,i)=>v-min[i]),center=max.map((v,i)=>(v+min[i])/2);return{min,max,size,center}}
function deepRefs(v,out=[]){if(Array.isArray(v))for(const x of v)deepRefs(x,out);else if(v&&typeof v==='object'){if(Number.isInteger(v.ref))out.push(v.ref);if(v.args)deepRefs(v.args,out)}return out}
function representationClosure(model,repId){const visited=new Set(),stack=[repId];while(stack.length){const id=stack.pop();if(!id||visited.has(id))continue;visited.add(id);const e=model.entities.get(id);if(!e)continue;for(const r of deepRefs(e.args))if(!visited.has(r))stack.push(r)}return visited}

function geometryCurve(model,edge){if(edge?.type!=='EDGE_CURVE')return null;return unwrapCurve(model,edge.args[3])}
function deBoorPoint(ctrl,degree,knots,u){
  const n=ctrl.length-1,p=degree;if(n<0||p<0)return null;
  const maxK=n;let k=p;if(u>=knots[n+1])k=n;else{for(let i=p;i<=n;i++){if(u>=knots[i]&&u<knots[i+1]){k=i;break}}}
  const d=[];for(let j=0;j<=p;j++)d[j]=[...(ctrl[k-p+j]||ctrl[Math.max(0,Math.min(n,k-p+j))])];
  for(let r=1;r<=p;r++)for(let j=p;j>=r;j--){const i=k-p+j,den=knots[i+p-r+1]-knots[i],alpha=Math.abs(den)<1e-12?0:(u-knots[i])/den;d[j]=d[j-1].map((v,q)=>(1-alpha)*v+alpha*d[j][q]);}
  return d[p];
}
function sampleBSpline(model,curve,factor){
  const degree=Number(curve.args[1]),refs=Array.isArray(curve.args[2])?curve.args[2]:[],ctrl=refs.map(r=>scaledPoint(getPoint(model,r),factor)).filter(Boolean),mult=Array.isArray(curve.args[6])?curve.args[6].map(Number):[],uniq=Array.isArray(curve.args[7])?curve.args[7].map(Number):[];
  if(!Number.isFinite(degree)||ctrl.length<2||mult.length!==uniq.length)return ctrl;
  const U=[];for(let i=0;i<uniq.length;i++)for(let j=0;j<mult[i];j++)U.push(uniq[i]);
  const expected=ctrl.length+degree+1;if(U.length<expected)return ctrl;
  const start=U[degree],end=U[ctrl.length];if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)return ctrl;
  const samples=clamp(Math.ceil(ctrl.length*1.5),12,96),pts=[];for(let i=0;i<=samples;i++){const u=i===samples?end:start+(end-start)*i/samples;const p=deBoorPoint(ctrl,degree,U,u);if(p)pts.push(p)}return pts;
}
function arcPoints(pl,r1,r2,p1,p2,sameSense=true,nBase=64){
  if(!pl||!Number.isFinite(r1)||!Number.isFinite(r2))return p1&&p2?[p1,p2]:[];
  const {x,y}=basis(pl.axis,pl.refdir),o=pl.origin;
  const angle=p=>Math.atan2(dot(sub(p,o),y)/(r2||1),dot(sub(p,o),x)/(r1||1));
  let a1=p1?angle(p1):0,a2=p2?angle(p2):Math.PI*2,sweep;
  if(!p1||!p2||dist(p1,p2)<Math.max(1e-7,Math.min(r1,r2)*1e-7))sweep=sameSense?Math.PI*2:-Math.PI*2;
  else if(sameSense){sweep=(a2-a1+Math.PI*2)%(Math.PI*2);if(sweep<1e-8)sweep=Math.PI*2;}
  else{sweep=-((a1-a2+Math.PI*2)%(Math.PI*2));if(Math.abs(sweep)<1e-8)sweep=-Math.PI*2;}
  const n=clamp(Math.ceil(Math.abs(sweep)/(Math.PI*2)*nBase),8,nBase),pts=[];for(let i=0;i<=n;i++){const a=a1+sweep*i/n;pts.push(add(o,add(mul(x,Math.cos(a)*r1),mul(y,Math.sin(a)*r2))))}return pts;
}
function edgeRecord(model,e,factor){
  const p1=scaledPoint(getPoint(model,e.args[1]),factor),p2=scaledPoint(getPoint(model,e.args[2]),factor),curve=geometryCurve(model,e),sameSense=e.args[4]!==false;
  if(!curve)return p1&&p2?{kind:'line',p1,p2,points:[p1,p2],source:e.id}:null;
  if(curve.type==='CIRCLE'){
    const pl=scaledPlacement(getPlacement(model,curve.args[1]),factor),radius=Number(curve.args[2])*factor,points=arcPoints(pl,radius,radius,p1,p2,sameSense);
    return pl&&Number.isFinite(radius)?{kind:'circle',placement:pl,radius,p1,p2,points,source:e.id,curve:curve.id}:null;
  }
  if(curve.type==='ELLIPSE'){
    const pl=scaledPlacement(getPlacement(model,curve.args[1]),factor),r1=Number(curve.args[2])*factor,r2=Number(curve.args[3])*factor,points=arcPoints(pl,r1,r2,p1,p2,sameSense);
    return pl&&Number.isFinite(r1)&&Number.isFinite(r2)?{kind:'ellipse',placement:pl,r1,r2,p1,p2,points,source:e.id,curve:curve.id}:null;
  }
  if(curve.type==='B_SPLINE_CURVE_WITH_KNOTS'){
    let points=sampleBSpline(model,curve,factor);if(!sameSense)points=[...points].reverse();if(p1&&points.length)points[0]=p1;if(p2&&points.length)points[points.length-1]=p2;
    return points.length>1?{kind:'spline',p1,p2,points,source:e.id,curve:curve.id,type:curve.type}:null;
  }
  return p1&&p2?{kind:'line',p1,p2,points:[p1,p2],source:e.id,curve:curve.id,type:curve.type}:null;
}
function surfaceRecord(model,e,factor){
  const type=e.type;if(type==='PLANE')return{type,id:e.id,placement:scaledPlacement(getPlacement(model,e.args[1]),factor)};
  if(type==='CYLINDRICAL_SURFACE')return{type,id:e.id,placement:scaledPlacement(getPlacement(model,e.args[1]),factor),radius:Number(e.args[2])*factor};
  if(type==='CONICAL_SURFACE')return{type,id:e.id,placement:scaledPlacement(getPlacement(model,e.args[1]),factor),radius:Number(e.args[2])*factor,semiAngle:Number(e.args[3])};
  if(type==='SPHERICAL_SURFACE')return{type,id:e.id,placement:scaledPlacement(getPlacement(model,e.args[1]),factor),radius:Number(e.args[2])*factor};
  if(type==='TOROIDAL_SURFACE')return{type,id:e.id,placement:scaledPlacement(getPlacement(model,e.args[1]),factor),majorRadius:Number(e.args[2])*factor,minorRadius:Number(e.args[3])*factor};return null;
}
function edgePoints(e){return e?.points?.length?e.points:(e?.p1&&e?.p2?[e.p1,e.p2]:[])}
function faceRecord(model,e,edgeById){
  if(e.type!=='ADVANCED_FACE')return null;const loops=[];
  for(const br of (Array.isArray(e.args[1])?e.args[1]:[])){
    const bound=entity(model,br),loop=bound?entity(model,bound.args[1]):null;if(!loop||loop.type!=='EDGE_LOOP')continue;const pts=[];
    for(const oer of (Array.isArray(loop.args[1])?loop.args[1]:[])){
      const oe=entity(model,oer);if(!oe||oe.type!=='ORIENTED_EDGE')continue;const edgeId=refId(oe.args[3]),er=edgeById.get(edgeId);if(!er)continue;let ep=edgePoints(er);if(oe.args[4]===false)ep=[...ep].reverse();if(!ep.length)continue;
      if(pts.length&&dist(pts[pts.length-1],ep[0])<1e-5)pts.push(...ep.slice(1));else pts.push(...ep);
    }
    if(pts.length>=3)loops.push(pts);
  }
  return loops.length?{id:e.id,loops,surface:refId(e.args[2]),sameSense:e.args[3]!==false}:null;
}

function parseComplexRelationship(raw=''){const rr=raw.match(/REPRESENTATION_RELATIONSHIP\s*\(\s*'[^']*'\s*,\s*'[^']*'\s*,\s*#(\d+)\s*,\s*#(\d+)\s*\)/i),tr=raw.match(/REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION\s*\(\s*#(\d+)\s*\)/i);return rr&&tr?{repA:Number(rr[1]),repB:Number(rr[2]),transformId:Number(tr[1])}:null}
function productNameFromDefinition(model,pdRef){const pd=typeof pdRef==='number'?model.entities.get(pdRef):entity(model,pdRef);if(!pd||pd.type!=='PRODUCT_DEFINITION')return'';const formation=entity(model,pd.args[2]),product=formation?entity(model,formation.args[2]):null;return product?.type==='PRODUCT'?String(product.args[0]||product.args[1]||''):''}
function brepLinkMap(model){const out=new Map();for(const r of model.byType.get('SHAPE_REPRESENTATION_RELATIONSHIP')||[]){const a=refId(r.args[2]),b=refId(r.args[3]),ea=model.entities.get(a),eb=model.entities.get(b);if(ea?.type==='ADVANCED_BREP_SHAPE_REPRESENTATION')out.set(b,a);if(eb?.type==='ADVANCED_BREP_SHAPE_REPRESENTATION')out.set(a,b);}return out}
function productDefinitionRepresentationMap(model){
  const out=new Map();for(const sdr of model.byType.get('SHAPE_DEFINITION_REPRESENTATION')||[]){const pds=entity(model,sdr.args[0]),rep=refId(sdr.args[1]);if(pds?.type!=='PRODUCT_DEFINITION_SHAPE'||!rep)continue;const pd=refId(pds.args[2]);if(!pd)continue;if(!out.has(pd))out.set(pd,new Set());out.get(pd).add(rep)}return out;
}
function assemblyRelations(model,factor){
  const out=[],pdReps=productDefinitionRepresentationMap(model),breps=brepLinkMap(model);
  const matches=(set,rep)=>set?.has(rep)||set?.has(breps.get(rep));
  for(const cds of model.byType.get('CONTEXT_DEPENDENT_SHAPE_REPRESENTATION')||[]){
    const rel=entity(model,cds.args[0]),pds=entity(model,cds.args[1]),info=rel?parseComplexRelationship(rel.raw):null;if(!info)continue;const tr=model.entities.get(info.transformId);if(!tr||tr.type!=='ITEM_DEFINED_TRANSFORMATION')continue;
    const frameA=scaledPlacement(getPlacement(model,tr.args[2]),factor),frameB=scaledPlacement(getPlacement(model,tr.args[3]),factor);if(!frameA||!frameB)continue;
    const occurrenceId=refId(pds?.args?.[2]),occ=model.entities.get(occurrenceId),parentDef=occ?.type==='NEXT_ASSEMBLY_USAGE_OCCURRENCE'?refId(occ.args[3]):null,childDef=occ?.type==='NEXT_ASSEMBLY_USAGE_OCCURRENCE'?refId(occ.args[4]):null,parentSet=pdReps.get(parentDef),childSet=pdReps.get(childDef);
    let parentRep,childRep,childFrame,parentFrame;
    if(matches(parentSet,info.repA)&&matches(childSet,info.repB)){parentRep=info.repA;childRep=info.repB;parentFrame=frameA;childFrame=frameB;}
    else if(matches(parentSet,info.repB)&&matches(childSet,info.repA)){parentRep=info.repB;childRep=info.repA;parentFrame=frameB;childFrame=frameA;}
    else{
      const a=model.entities.get(info.repA),b=model.entities.get(info.repB),aGeom=a?.type==='ADVANCED_BREP_SHAPE_REPRESENTATION'||breps.has(info.repA),bGeom=b?.type==='ADVANCED_BREP_SHAPE_REPRESENTATION'||breps.has(info.repB);
      if(aGeom&&!bGeom){parentRep=info.repB;childRep=info.repA;parentFrame=frameB;childFrame=frameA;}else{parentRep=info.repA;childRep=info.repB;parentFrame=frameA;childFrame=frameB;}
    }
    out.push({parentRep,childRep,transformId:info.transformId,occurrenceId,name:productNameFromDefinition(model,childDef)||`Component ${occurrenceId||childRep}`,transform:betweenPlacements(childFrame,parentFrame)});
  }return out;
}
function transformEdge(e,T,meta){const points=edgePoints(e).map(p=>applyTransform(T,p)),base={...e,...meta,points,p1:e.p1?applyTransform(T,e.p1):points[0],p2:e.p2?applyTransform(T,e.p2):points.at(-1)};if(e.placement)base.placement={origin:applyTransform(T,e.placement.origin),axis:applyVector(T,e.placement.axis),refdir:applyVector(T,e.placement.refdir)};return base}
function transformSurface(s,T,meta){return{...s,...meta,placement:s.placement?{origin:applyTransform(T,s.placement.origin),axis:applyVector(T,s.placement.axis),refdir:applyVector(T,s.placement.refdir)}:null}}
function transformFace(f,T,meta){return{...f,...meta,loops:f.loops.map(loop=>loop.map(p=>applyTransform(T,p)))}}
function almostParallel(a,b,tol=1e-4){return Math.abs(Math.abs(dot(norm(a),norm(b)))-1)<tol}
function recognizeBoltPatterns(cylinders){const groups=new Map();for(const c of cylinders){if(!c.placement||!Number.isFinite(c.radius))continue;const ax=norm(c.placement.axis),dominant=ax.map(Math.abs).indexOf(Math.max(...ax.map(Math.abs))),key=`${keyNum(c.radius,1e-3)}|${dominant}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(c)}const patterns=[];for(const list of groups.values()){if(list.length<3)continue;const axis=list[0].placement.axis;if(!list.every(c=>almostParallel(c.placement.axis,axis)))continue;const dominant=norm(axis).map(Math.abs).indexOf(Math.max(...norm(axis).map(Math.abs))),dims=[0,1,2].filter(i=>i!==dominant),centers=list.map(c=>[c.placement.origin[dims[0]],c.placement.origin[dims[1]]]),cx=centers.reduce((s,p)=>s+p[0],0)/centers.length,cy=centers.reduce((s,p)=>s+p[1],0)/centers.length,rs=centers.map(p=>Math.hypot(p[0]-cx,p[1]-cy)),mean=rs.reduce((a,b)=>a+b,0)/rs.length,spread=Math.max(...rs)-Math.min(...rs);if(mean>1e-6&&spread<Math.max(.05,mean*.002))patterns.push({count:list.length,holeDiameter:list[0].radius*2,pcd:mean*2,center:[cx,cy],axis,spread,source:list.map(x=>x.id)})}return patterns.sort((a,b)=>b.count-a.count)}
function productInfo(model){const products=(model.byType.get('PRODUCT')||[]).map(e=>({id:e.id,name:String(e.args[0]??''),description:String(e.args[1]??'')}));const occurrences=(model.byType.get('NEXT_ASSEMBLY_USAGE_OCCURRENCE')||[]).map(e=>({id:e.id,name:String(e.args[1]||'').trim()||productNameFromDefinition(model,refId(e.args[4]))||`Component ${e.id}`,parent:refId(e.args[3]),child:refId(e.args[4]),parentName:productNameFromDefinition(model,refId(e.args[3])),childName:productNameFromDefinition(model,refId(e.args[4]))}));return{products,occurrences,isAssembly:occurrences.length>0||products.length>1}}

export function recognizeSTEP(model){
  const factor=unitFactorToMM(model),rawEdges=(model.byType.get('EDGE_CURVE')||[]).map(e=>[e.id,edgeRecord(model,e,factor)]).filter(x=>x[1]),edgeById=new Map(rawEdges),rawSurfaces=[];
  for(const type of ['PLANE','CYLINDRICAL_SURFACE','CONICAL_SURFACE','SPHERICAL_SURFACE','TOROIDAL_SURFACE'])for(const e of model.byType.get(type)||[]){const sr=surfaceRecord(model,e,factor);if(sr)rawSurfaces.push([e.id,sr])}
  const rawFaces=(model.byType.get('ADVANCED_FACE')||[]).map(e=>[e.id,faceRecord(model,e,edgeById)]).filter(x=>x[1]),relations=assemblyRelations(model,factor),breps=brepLinkMap(model),products=productInfo(model);
  const edges=[],surfaces=[],faces=[],componentMap=new Map();
  function addGeometry(rep,T,meta){const brepId=model.entities.get(rep)?.type==='ADVANCED_BREP_SHAPE_REPRESENTATION'?rep:breps.get(rep);if(!brepId)return 0;const closure=representationClosure(model,brepId);let added=0;for(const [id,e] of rawEdges)if(closure.has(id)){edges.push(transformEdge(e,T,meta));added++}for(const [id,s] of rawSurfaces)if(closure.has(id))surfaces.push(transformSurface(s,T,meta));for(const [id,f] of rawFaces)if(closure.has(id))faces.push(transformFace(f,T,meta));return added}
  if(relations.length){
    const childSet=new Set(relations.map(r=>r.childRep)),parentSet=new Set(relations.map(r=>r.parentRep)),roots=[...parentSet].filter(r=>!childSet.has(r));
    const byParent=new Map();for(const r of relations){if(!byParent.has(r.parentRep))byParent.set(r.parentRep,[]);byParent.get(r.parentRep).push(r)}
    const walk=(rep,T,depth,path)=>{addGeometry(rep,T,{componentId:`rep-${rep}`,instance:model.entities.get(rep)?.args?.[0]||`Rep ${rep}`,depth});for(const rel of byParent.get(rep)||[]){const childT=composeTransform(T,rel.transform),cid=`occ-${rel.occurrenceId||rel.childRep}-${path.length}`;const before=edges.length;addGeometry(rel.childRep,childT,{componentId:cid,occurrenceId:rel.occurrenceId,instance:rel.name,depth:depth+1});const after=edges.length;if(after>before){const pts=[];for(let i=before;i<after;i++)pts.push(...edgePoints(edges[i]));componentMap.set(cid,{id:cid,name:rel.name,occurrenceId:rel.occurrenceId,depth:depth+1,edgeCount:after-before,bounds:bbox(pts)});}if(!path.includes(rel.childRep))walk(rel.childRep,childT,depth+1,[...path,rel.childRep]);}}
    for(const root of roots.length?roots:[relations[0].parentRep])walk(root,identityTransform(),0,[root]);
  }else{
    edges.push(...rawEdges.map(x=>x[1]));surfaces.push(...rawSurfaces.map(x=>x[1]));faces.push(...rawFaces.map(x=>x[1]));
  }
  if(relations.length&&!edges.length){edges.push(...rawEdges.map(x=>x[1]));surfaces.push(...rawSurfaces.map(x=>x[1]));faces.push(...rawFaces.map(x=>x[1]));}
  const points=[];for(const e of edges)points.push(...edgePoints(e));if(!points.length)for(const f of faces)for(const l of f.loops)points.push(...l);if(!points.length)points.push(...cartesian3DPoints(model,factor));const bounds=bbox(points),cylinders=surfaces.filter(s=>s.type==='CYLINDRICAL_SURFACE'),boltPatterns=recognizeBoltPatterns(cylinders),radii=[...new Set(cylinders.map(c=>round(c.radius,4)))].sort((a,b)=>a-b),circleRadii=[...new Set(edges.filter(e=>e.kind==='circle').map(e=>round(e.radius,4)))].sort((a,b)=>a-b);
  const counts={entities:model.entityCount,solids:(model.byType.get('MANIFOLD_SOLID_BREP')||[]).length,shells:(model.byType.get('CLOSED_SHELL')||[]).length,faces:(model.byType.get('ADVANCED_FACE')||[]).length,edges:(model.byType.get('EDGE_CURVE')||[]).length,vertices:(model.byType.get('VERTEX_POINT')||[]).length,planes:surfaces.filter(s=>s.type==='PLANE').length,cylinders:cylinders.length,cones:surfaces.filter(s=>s.type==='CONICAL_SURFACE').length,spheres:surfaces.filter(s=>s.type==='SPHERICAL_SURFACE').length,tori:surfaces.filter(s=>s.type==='TOROIDAL_SURFACE').length,bsplines:(model.byType.get('B_SPLINE_CURVE_WITH_KNOTS')||[]).length+(model.byType.get('B_SPLINE_SURFACE_WITH_KNOTS')||[]).length,sceneEdges:edges.length,sceneFaces:faces.length,sceneComponents:componentMap.size};
  return{factor,unit:'mm',points,bounds,edges,surfaces,faces,cylinders,boltPatterns,radii,circleRadii,products:products.products,occurrences:products.occurrences,isAssembly:products.isAssembly,instances:relations,components:[...componentMap.values()],counts};
}

export function makeDimensionSet(rec){
  const d=[], [sx,sy,sz]=rec.bounds.size;if(sx>1e-8)d.push({type:'overall',label:'Габарит X',value:sx,unit:'mm',confidence:1});if(sy>1e-8)d.push({type:'overall',label:'Габарит Y',value:sy,unit:'mm',confidence:1});if(sz>1e-8)d.push({type:'overall',label:'Габарит Z',value:sz,unit:'mm',confidence:1});
  const cylGroups=new Map();for(const c of rec.cylinders){const k=round(c.radius*2,4);cylGroups.set(k,(cylGroups.get(k)||0)+1)}for(const [diam,count] of [...cylGroups.entries()].sort((a,b)=>b[0]-a[0]))d.push({type:'diameter',label:`Ø${diam.toFixed(3)}${count>1?` × ${count}`:''}`,value:diam,unit:'mm',count,confidence:.95});for(const p of rec.boltPatterns)d.push({type:'pcd',label:`PCD Ø${p.pcd.toFixed(3)} · ${p.count}×Ø${p.holeDiameter.toFixed(3)}`,value:p.pcd,unit:'mm',count:p.count,holeDiameter:p.holeDiameter,confidence:.92});for(const s of rec.surfaces.filter(s=>s.type==='CONICAL_SURFACE'))d.push({type:'angle',label:`Конус ${(s.semiAngle*180/Math.PI*2).toFixed(3)}°`,value:s.semiAngle*180/Math.PI*2,unit:'°',confidence:.9});
  if(rec.cylinders?.length&&rec.edges?.length){const axisVotes=[0,0,0];for(const c of rec.cylinders){const a=(c.placement?.axis||[0,0,1]).map(Math.abs),i=a.indexOf(Math.max(...a));axisVotes[i]++}const axis=axisVotes.indexOf(Math.max(...axisVotes)),other=[0,1,2].filter(i=>i!==axis),center=rec.bounds.center,tol=Math.max(.02,Math.max(...rec.bounds.size)*.004),coords=[...new Set(rec.edges.filter(e=>e.kind==='circle'&&e.placement&&Math.abs(Math.abs(norm(e.placement.axis)[axis])-1)<.015&&Math.hypot(e.placement.origin[other[0]]-center[other[0]],e.placement.origin[other[1]]-center[other[1]])<=tol).map(e=>round(e.placement.origin[axis],4)))].sort((a,b)=>a-b);for(let i=0;i<coords.length-1;i++){const value=coords[i+1]-coords[i];if(value>tol)d.push({type:'length',label:`Участок ${value.toFixed(3)}`,value,unit:'mm',axis:['X','Y','Z'][axis],from:coords[i],to:coords[i+1],confidence:.94})}}
  return d;
}
