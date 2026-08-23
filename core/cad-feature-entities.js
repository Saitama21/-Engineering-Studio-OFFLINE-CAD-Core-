// ROZFOOD Engineering Studio v5.0.0 — CAD Feature Entity Core (continuity-aware)
// Promotes conservatively recognized manufacturing features into geometric entities.
// Source remains SolidWorks FaceTessellations + analytic fits; this is not native Parasolid feature history.
import {buildFeatureGraph} from './feature-graph.js';

const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const mul=(a,s)=>[a[0]*s,a[1]*s,a[2]*s];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const len=a=>Math.hypot(a[0],a[1],a[2]);
const norm=a=>{const L=len(a)||1;return[a[0]/L,a[1]/L,a[2]/L]};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const cache=new WeakMap();

function basis(axis){
  const a=norm(axis),seed=Math.abs(a[2])<.82?[0,0,1]:[1,0,0],u=norm(cross(a,seed)),v=norm(cross(a,u));
  return{a,u,v};
}
function faceKeyOf(f){return[f.componentId||'RAW',f.modelId||'',f.sourceStream||'',f.tessFaceId??''].join('|')}
function facePoints(rec,faceKey){
  const out=[];for(const f of rec?.faces||[]){if(faceKeyOf(f)!==faceKey)continue;for(const loop of f.loops||[])for(const p of loop||[])out.push(p)}return out;
}
function angularInterval(values){
  if(values.length<3)return null;const a=values.map(x=>{let q=x%(Math.PI*2);if(q<0)q+=Math.PI*2;return q}).sort((x,y)=>x-y);
  let gap=-1,gi=0;for(let i=0;i<a.length;i++){const next=i+1<a.length?a[i+1]:a[0]+Math.PI*2,d=next-a[i];if(d>gap){gap=d;gi=i}}
  const start=a[(gi+1)%a.length],sweep=Math.PI*2-gap;return{start,sweep};
}
function sampleArc(center,u,v,r,start,sweep,count){
  const n=Math.max(8,count),out=[];for(let i=0;i<=n;i++){const q=start+sweep*i/n;out.push(add(center,add(mul(u,Math.cos(q)*r),mul(v,Math.sin(q)*r))))}return out;
}
function buildFilletEntity(rec,f,index){
  const axis=norm(f.axis||[1,0,0]),B=basis(axis),pts=f.faceKey?facePoints(rec,f.faceKey):[];
  let tmin=-Number(f.length||0)/2,tmax=Number(f.length||0)/2,start=0,sweep=(Number(f.sweepDeg)||90)*Math.PI/180,fitRms=null;
  if(pts.length>=6){
    const ts=[],angles=[],radialErrors=[];for(const p of pts){const d=sub(p,f.axisPoint),t=dot(d,axis),rvec=sub(d,mul(axis,t)),x=dot(rvec,B.u),y=dot(rvec,B.v),r=Math.hypot(x,y);ts.push(t);if(r>.05)angles.push(Math.atan2(y,x));radialErrors.push(r-(f.radius||r))}
    tmin=Math.min(...ts);tmax=Math.max(...ts);const iv=angularInterval(angles);if(iv){start=iv.start;sweep=iv.sweep}
    fitRms=Math.sqrt(radialErrors.reduce((s,x)=>s+x*x,0)/Math.max(1,radialErrors.length));
  }
  const conf=clamp(Number(f.confidence||0),0,1),verified=conf>=.72&&sweep>=.22&&sweep<=Math.PI*1.08&&Math.abs(tmax-tmin)>.15;
  return{id:`FILLET-${index+1}`,kind:'fillet',componentId:f.componentId||null,faceKey:f.faceKey||null,radius:f.radius,axis,axisPoint:f.axisPoint?.slice?.()||[0,0,0],basisU:B.u,basisV:B.v,tmin,tmax,length:Math.abs(tmax-tmin),angleStart:start,sweepRad:sweep,sweepDeg:sweep*180/Math.PI,confidence:conf,fitRms,verified,source:f.source||'partial-cylinder-fit'};
}
function buildChamferEntity(rec,c,index,planeMap){
  const plane=planeMap.get(c.faceKey)||null,pts=c.faceKey?facePoints(rec,c.faceKey):[];
  const conf=clamp(Number(c.confidence||0),0,1),verified=!!plane&&conf>=.66&&Number(c.size)>.03&&pts.length>=3;
  return{id:`CHAMFER-${index+1}`,kind:'chamfer',componentId:c.componentId||null,faceKey:c.faceKey||null,size:c.size,angleDeg:c.angleDeg||45,normal:plane?.normal?.slice?.()||null,origin:plane?.origin?.slice?.()||null,area:plane?.area||null,confidence:conf,verified,source:c.source||'small-oblique-plane'};
}


function faceKeyFromTessId(rec,componentId,faceId){
  const f=(rec?.faces||[]).find(x=>(x.componentId||'RAW')===(componentId||'RAW')&&(x.tessFaceId??null)===(faceId??null));return f?faceKeyOf(f):null;
}
function graphChamferEntities(rec,startIndex=0){
  let graph=null;try{graph=rec?.featureGraph||buildFeatureGraph(rec)}catch{return[]}
  if(!graph?.chamfers?.length||!graph.axis||!graph.axisPoint)return[];
  const axis=norm(graph.axis),ap=graph.axisPoint.slice(),apT=dot(ap,axis),out=[];
  for(const [i,c] of graph.chamfers.entries()){
    const r0=Math.abs(c.fromDiameter||0)/2,r1=Math.abs(c.toDiameter||0)/2;if(!(r0>.02&&r1>.02))continue;
    const center0=add(ap,mul(axis,c.start-apT)),center1=add(ap,mul(axis,c.end-apT));
    out.push({id:`CHAMFER-${startIndex+i+1}`,kind:'chamfer',subtype:'axial-conical',componentId:c.componentId||null,faceKey:faceKeyFromTessId(rec,c.componentId,c.faceId),size:c.size,angleDeg:c.angle||45,axis,axisPoint:ap,center0,center1,radius0:r0,radius1:r1,start:c.start,end:c.end,length:Math.abs(c.end-c.start),confidence:.985,verified:true,source:'axial-ring-transition-fit'});
  }
  return out;
}
export function reconstructCadFeatureEntities(rec){
  if(cache.has(rec))return cache.get(rec);
  const mfg=rec?.manufacturing||{},planes=new Map((rec?.recognition?.planes||[]).filter(p=>p.faceKey).map(p=>[p.faceKey,p]));
  const fillets=(mfg.fillets||[]).map((f,i)=>buildFilletEntity(rec,f,i)).filter(f=>f.verified);
  const tessChamfers=(mfg.chamfers||[]).map((c,i)=>buildChamferEntity(rec,c,i,planes)).filter(c=>c.verified),graphChamfers=graphChamferEntities(rec,tessChamfers.length);
  const chamfers=[];for(const c of [...graphChamfers,...tessChamfers].sort((a,b)=>b.confidence-a.confidence)){const dup=chamfers.find(x=>x.componentId===c.componentId&&Math.abs((x.size||0)-(c.size||0))<.08&&((x.faceKey&&c.faceKey&&x.faceKey===c.faceKey)||(x.start!=null&&c.start!=null&&Math.abs(x.start-c.start)<.15)));if(!dup)chamfers.push(c)}
  const featureFaceKeys=new Set([...fillets,...chamfers].map(x=>x.faceKey).filter(Boolean));
  const filletFaceKeys=new Set(fillets.map(x=>x.faceKey).filter(Boolean));
  const chamferFaceKeys=new Set(chamfers.map(x=>x.faceKey).filter(Boolean));
  const result={version:'4.0.0',kernel:'ROZFOOD CAD Feature Entity Core',exactParasolid:false,source:'FaceTessellations + analytic feature fits',fillets,chamfers,featureFaceKeys,filletFaceKeys,chamferFaceKeys,counts:{fillets:fillets.length,chamfers:chamfers.length,total:fillets.length+chamfers.length}};
  cache.set(rec,result);return result;
}

export function featureViewCurves(rec,{arcSegments=72,viewDir=[0,0,1]}={}){
  const F=reconstructCadFeatureEntities(rec),curves=[];
  for(const f of F.fillets){
    const h=f.length/2,mid=f.axisPoint,center0=add(mid,mul(f.axis,f.tmin)),center1=add(mid,mul(f.axis,f.tmax));
    const n=Math.max(12,Math.ceil(Math.abs(f.sweepRad)/(Math.PI*2)*arcSegments));
    const arc0=sampleArc(center0,f.basisU,f.basisV,f.radius,f.angleStart,f.sweepRad,n),arc1=sampleArc(center1,f.basisU,f.basisV,f.radius,f.angleStart,f.sweepRad,n);
    const p00=arc0[0],p01=arc0.at(-1),p10=arc1[0],p11=arc1.at(-1);
    curves.push({kind:'arc',role:'fillet-boundary',featureKind:'fillet',featureId:f.id,points:arc0,componentId:f.componentId,faceKey:f.faceKey,source:f,radius:f.radius});
    curves.push({kind:'arc',role:'fillet-boundary',featureKind:'fillet',featureId:f.id,points:arc1,componentId:f.componentId,faceKey:f.faceKey,source:f,radius:f.radius});
    curves.push({kind:'line',role:'fillet-tangent-edge',featureKind:'fillet',featureId:f.id,points:[p00,p10],componentId:f.componentId,faceKey:f.faceKey,source:f});
    curves.push({kind:'line',role:'fillet-tangent-edge',featureKind:'fillet',featureId:f.id,points:[p01,p11],componentId:f.componentId,faceKey:f.faceKey,source:f});
  }
  for(const c of F.chamfers){
    if(c.subtype!=='axial-conical')continue;
    const B=basis(c.axis),circleN=Math.max(32,arcSegments),a0=sampleArc(c.center0,B.u,B.v,c.radius0,0,Math.PI*2,circleN),a1=sampleArc(c.center1,B.u,B.v,c.radius1,0,Math.PI*2,circleN);
    curves.push({kind:'circle',role:'chamfer-boundary',featureKind:'chamfer',featureId:c.id,points:a0,componentId:c.componentId,faceKey:c.faceKey,source:c,radius:c.radius0});
    curves.push({kind:'circle',role:'chamfer-boundary',featureKind:'chamfer',featureId:c.id,points:a1,componentId:c.componentId,faceKey:c.faceKey,source:c,radius:c.radius1});
    let radial=cross(c.axis,norm(viewDir));if(len(radial)<1e-7)radial=B.u;else radial=norm(radial);
    for(const sg of [1,-1])curves.push({kind:'line',role:'chamfer-silhouette',featureKind:'chamfer',featureId:c.id,points:[add(c.center0,mul(radial,c.radius0*sg)),add(c.center1,mul(radial,c.radius1*sg))],componentId:c.componentId,faceKey:c.faceKey,source:c});
  }
  return{features:F,curves};
}

export function tagChamferBoundaryCurves(curves,rec){
  const F=reconstructCadFeatureEntities(rec);if(!F.chamferFaceKeys.size)return curves||[];
  return(curves||[]).map(c=>F.chamferFaceKeys.has(c.faceKey)?{...c,role:'chamfer-boundary',featureKind:'chamfer',featureId:F.chamfers.find(x=>x.faceKey===c.faceKey)?.id||null}:c);
}

export function featureDrawingNotes(rec,{limit=6}={}){
  const F=reconstructCadFeatureEntities(rec),out=[];
  const grouped=(items,keyFn)=>{const m=new Map();for(const x of items){const k=keyFn(x),g=m.get(k)||{item:x,count:0};g.count++;m.set(k,g)}return[...m.values()]};
  for(const g of grouped(F.chamfers,c=>`${Math.round(c.size*100)}|${Math.round(c.angleDeg)}`)){
    const c=g.item;out.push(`${g.count>1?`${g.count}× `:''}фаска ${Number(c.size).toFixed(2).replace(/0+$/,'').replace(/\.$/,'')}×${Math.round(c.angleDeg)}°`);if(out.length>=limit)return out;
  }
  for(const g of grouped(F.fillets,f=>`${Math.round(f.radius*100)}`)){
    const f=g.item;out.push(`${g.count>1?`${g.count}× `:''}скругление R${Number(f.radius).toFixed(2).replace(/0+$/,'').replace(/\.$/,'')}`);if(out.length>=limit)return out;
  }
  return out;
}
