const EPS=1e-9;
const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const mul=(a,s)=>[a[0]*s,a[1]*s,a[2]*s];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const len=a=>Math.hypot(a[0],a[1],a[2]);
const norm=a=>{const l=len(a)||1;return[a[0]/l,a[1]/l,a[2]/l]};
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
function centroid(pts){if(!pts.length)return[0,0,0];let s=[0,0,0];for(const p of pts)s=add(s,p);return mul(s,1/pts.length)}
function triArea(a,b,c){return .5*len(cross(sub(b,a),sub(c,a)))}
function boundsOf(pts){const mn=[Infinity,Infinity,Infinity],mx=[-Infinity,-Infinity,-Infinity];for(const p of pts)for(let i=0;i<3;i++){mn[i]=Math.min(mn[i],p[i]);mx[i]=Math.max(mx[i],p[i])}if(!pts.length)return{min:[0,0,0],max:[0,0,0],size:[0,0,0],center:[0,0,0]};return{min:mn,max:mx,size:sub(mx,mn),center:mul(add(mn,mx),.5)}}
function angleDeg(a,b){return Math.acos(clamp(Math.abs(dot(norm(a),norm(b))),-1,1))*180/Math.PI}

function smallestEigenVector(m){
  const a=[m[0].slice(),m[1].slice(),m[2].slice()],v=[[1,0,0],[0,1,0],[0,0,1]];
  for(let iter=0;iter<24;iter++){
    let p=0,q=1,max=Math.abs(a[0][1]);
    for(const [i,j] of [[0,2],[1,2]])if(Math.abs(a[i][j])>max){max=Math.abs(a[i][j]);p=i;q=j}
    if(max<1e-12)break;
    const app=a[p][p],aqq=a[q][q],apq=a[p][q];
    const phi=.5*Math.atan2(2*apq,aqq-app),c=Math.cos(phi),s=Math.sin(phi);
    for(let k=0;k<3;k++){const aik=a[k][p],aiq=a[k][q];a[k][p]=c*aik-s*aiq;a[k][q]=s*aik+c*aiq}
    for(let k=0;k<3;k++){const apk=a[p][k],aqk=a[q][k];a[p][k]=c*apk-s*aqk;a[q][k]=s*apk+c*aqk}
    a[p][q]=a[q][p]=0;
    for(let k=0;k<3;k++){const vip=v[k][p],viq=v[k][q];v[k][p]=c*vip-s*viq;v[k][q]=s*vip+c*viq}
  }
  const eig=[a[0][0],a[1][1],a[2][2]],idx=eig.indexOf(Math.min(...eig));
  return{value:eig[idx],values:eig,vector:norm([v[0][idx],v[1][idx],v[2][idx]])};
}
function solve3(A,b){
  const m=A.map((r,i)=>[...r,b[i]]);
  for(let c=0;c<3;c++){
    let p=c;for(let r=c+1;r<3;r++)if(Math.abs(m[r][c])>Math.abs(m[p][c]))p=r;
    if(Math.abs(m[p][c])<1e-12)return null;[m[c],m[p]]=[m[p],m[c]];
    const d=m[c][c];for(let j=c;j<4;j++)m[c][j]/=d;
    for(let r=0;r<3;r++)if(r!==c){const f=m[r][c];for(let j=c;j<4;j++)m[r][j]-=f*m[c][j]}
  }
  return[m[0][3],m[1][3],m[2][3]];
}
function circleFit2D(points){
  if(points.length<3)return null;
  let sx=0,sy=0,sxx=0,syy=0,sxy=0,sr=0,sxr=0,syr=0;
  for(const [x,y] of points){const r=x*x+y*y;sx+=x;sy+=y;sxx+=x*x;syy+=y*y;sxy+=x*y;sr+=r;sxr+=x*r;syr+=y*r}
  const n=points.length,sol=solve3([[sxx,sxy,sx],[sxy,syy,sy],[sx,sy,n]],[-sxr,-syr,-sr]);
  if(!sol)return null;const [D,E,F]=sol,cx=-D/2,cy=-E/2,rr=cx*cx+cy*cy-F;if(!(rr>EPS))return null;
  const radius=Math.sqrt(rr);let se=0;for(const [x,y] of points){const d=Math.hypot(x-cx,y-cy)-radius;se+=d*d}
  return{cx,cy,radius,rms:Math.sqrt(se/n)};
}
function perpendicularBasis(axis){const a=norm(axis),seed=Math.abs(a[2])<.8?[0,0,1]:[1,0,0],u=norm(cross(a,seed)),v=norm(cross(a,u));return{u,v}}
function angularCoverage(points,cx,cy){if(points.length<3)return 0;const a=points.map(([x,y])=>Math.atan2(y-cy,x-cx)).sort((x,y)=>x-y);let maxGap=0;for(let i=1;i<a.length;i++)maxGap=Math.max(maxGap,a[i]-a[i-1]);maxGap=Math.max(maxGap,a[0]+Math.PI*2-a[a.length-1]);return Math.PI*2-maxGap}
function canonicalAxis(a){a=norm(a);const k=Math.abs(a[0])>.01?0:Math.abs(a[1])>.01?1:2;return a[k]<0?mul(a,-1):a}
function faceGroups(faces){const map=new Map();for(const f of faces||[]){const key=[f.componentId||'RAW',f.modelId||'',f.sourceStream||'',f.tessFaceId??''].join('|');let g=map.get(key);if(!g){g={key,componentId:f.componentId||null,modelId:f.modelId||null,instance:f.instance||null,sourceStream:f.sourceStream||'',tessFaceId:f.tessFaceId??null,triangles:[]};map.set(key,g)}g.triangles.push(f)}return[...map.values()]}
function flattenGroup(g){const points=[],normals=[];let area=0;for(const t of g.triangles){const loop=t.loops?.[0]||[];if(loop.length<3)continue;area+=triArea(loop[0],loop[1],loop[2]);for(let i=0;i<3;i++){points.push(loop[i]);normals.push(norm(t.normals?.[i]||cross(sub(loop[1],loop[0]),sub(loop[2],loop[0]))))}}return{points,normals,area,bounds:boundsOf(points)}}
function detectPlane(g,data,diag){const {points,normals,area,bounds}=data;if(points.length<3)return null;let ref=normals[0]||[0,0,1],sum=[0,0,0];for(let n of normals){if(dot(n,ref)<0)n=mul(n,-1);sum=add(sum,n)}const n=norm(sum),coherence=len(sum)/Math.max(1,normals.length);if(coherence<.992)return null;const c=centroid(points),ds=points.map(p=>dot(sub(p,c),n)),rms=Math.sqrt(ds.reduce((s,x)=>s+x*x,0)/ds.length),tol=Math.max(.015,diag*.00008);if(rms>tol)return null;return{kind:'plane',componentId:g.componentId,modelId:g.modelId,instance:g.instance,faceKey:g.key,normal:n,origin:c,area,bounds,rms,confidence:clamp(.7+.3*coherence-.15*(rms/tol),0,1)}}
function detectCylinder(g,data,diag){
  const {points,normals,area,bounds}=data;if(points.length<18||area<EPS)return null;
  const M=[[0,0,0],[0,0,0],[0,0,0]];for(const n0 of normals){const n=norm(n0);for(let i=0;i<3;i++)for(let j=0;j<3;j++)M[i][j]+=n[i]*n[j]}
  const ev=smallestEigenVector(M),trace=M[0][0]+M[1][1]+M[2][2],ratio=trace>0?Math.max(0,ev.value/trace):1;if(ratio>.025)return null;
  const axis=canonicalAxis(ev.vector),{u,v}=perpendicularBasis(axis),p2=points.map(p=>[dot(p,u),dot(p,v)]),fit=circleFit2D(p2);if(!fit||!Number.isFinite(fit.radius))return null;
  const tol=Math.max(.03,fit.radius*.0025,diag*.00008);if(fit.rms>tol||fit.radius<.1)return null;
  let tmin=Infinity,tmax=-Infinity;for(const p of points){const t=dot(p,axis);if(t<tmin)tmin=t;if(t>tmax)tmax=t}const length=tmax-tmin;if(length<.03)return null;
  const mid=(tmin+tmax)/2,axisPoint=add(add(mul(u,fit.cx),mul(v,fit.cy)),mul(axis,mid));
  let align=0,count=0;for(let i=0;i<points.length;i++){const t=dot(points[i],axis),onAxis=add(axisPoint,mul(axis,t-mid)),rad=norm(sub(points[i],onAxis));if(len(rad)>.5){align+=dot(normals[i],rad);count++}}
  align=count?align/count:0;const coverage=angularCoverage(p2,fit.cx,fit.cy),full=coverage>Math.PI*1.72;
  const type=align<-.35?'hole':align>.35?'outer':'cylinder';const fitScore=1-clamp(fit.rms/(tol||1),0,1),coverageScore=clamp(coverage/(Math.PI*2),0,1),confidence=clamp(.62+.2*(1-ratio/.025)+.12*fitScore+.06*coverageScore,0,1);
  return{kind:'cylinder',type,componentId:g.componentId,modelId:g.modelId,instance:g.instance,faceKey:g.key,axis,axisPoint,radius:fit.radius,diameter:fit.radius*2,length,area,bounds,rms:fit.rms,normalAlignment:align,coverageRad:coverage,full,confidence};
}
function sameAxis(a,b,angleTol=2){return angleDeg(a.axis,b.axis)<=angleTol}
function lineDistance(a,b){const da=sub(b.axisPoint,a.axisPoint),ax=norm(a.axis);return len(sub(da,mul(ax,dot(da,ax))))}
function dedupeCylinders(cyls){const out=[];for(const c of [...cyls].sort((a,b)=>b.confidence-a.confidence||b.area-a.area)){const dup=out.find(x=>x.componentId===c.componentId&&sameAxis(x,c,1.2)&&lineDistance(x,c)<Math.max(.08,c.radius*.004)&&Math.abs(x.radius-c.radius)<Math.max(.08,c.radius*.004)&&Math.abs(x.length-c.length)<Math.max(.2,c.length*.02));if(!dup)out.push(c)}return out}

function axisKey(a){const n=canonicalAxis(a);return n.map(v=>Math.round(v*20)/20).join(',')}
function clusterCoaxialCylinders(cyls){
  const out=[];
  for(const c of cyls){
    let g=out.find(x=>x.componentId===c.componentId&&angleDeg(x.axis,c.axis)<1.5&&lineDistance(x,c)<Math.max(.12,c.radius*.006));
    if(!g){g={componentId:c.componentId||'RAW',componentName:c.instance?.name||'',axis:c.axis,axisPoint:c.axisPoint,members:[]};out.push(g)}
    g.members.push(c);
  }
  return out.map((g,i)=>{
    const ds=[...new Set(g.members.map(c=>Math.round(c.diameter*1000)/1000))].sort((a,b)=>b-a);
    return{id:`CX-${i+1}`,...g,diameters:ds,steps:Math.max(0,ds.length-1),count:g.members.length,confidence:g.members.reduce((s,c)=>s+c.confidence,0)/Math.max(1,g.members.length)};
  }).filter(g=>g.diameters.length>=2).sort((a,b)=>b.count-a.count||b.diameters[0]-a.diameters[0]);
}
function groupHolePatterns(holes){
  const coarse=new Map();
  for(const h of holes){
    if(!h.full||h.confidence<.7)continue;
    const d=Math.round(h.diameter*10)/10,key=[h.componentId||'RAW',d.toFixed(1),axisKey(h.axis)].join('|');
    let g=coarse.get(key);if(!g){g={componentId:h.componentId||'RAW',componentName:h.instance?.name||'',diameter:d,axis:h.axis,members:[]};coarse.set(key,g)}g.members.push(h);
  }
  const patterns=[];let pi=1;
  for(const g of coarse.values()){
    if(g.members.length<2)continue;
    const {u,v}=perpendicularBasis(g.axis),pts=g.members.map(h=>[dot(h.axisPoint,u),dot(h.axisPoint,v)]);
    let pcd=null,center=null,rms=null;
    if(pts.length>=3){
      const fit=circleFit2D(pts);
      if(fit&&fit.radius>.5&&fit.rms<Math.max(.45,fit.radius*.018)){pcd=fit.radius*2;center=add(mul(u,fit.cx),mul(v,fit.cy));rms=fit.rms}
    }
    const lengths=g.members.map(h=>h.length).sort((a,b)=>a-b),avgLength=lengths.reduce((s,x)=>s+x,0)/lengths.length;
    patterns.push({id:`HP-${pi++}`,componentId:g.componentId,componentName:g.componentName,diameter:g.diameter,count:g.members.length,axis:g.axis,pcd,center,rms,avgLength,kind:pcd?'circular':'repeated',members:g.members,confidence:g.members.reduce((s,h)=>s+h.confidence,0)/g.members.length});
  }
  return patterns.sort((a,b)=>(b.pcd?1:0)-(a.pcd?1:0)||b.count-a.count||a.diameter-b.diameter);
}
function parallelPlaneSpacings(planes){
  const out=[];
  const byComp=new Map();for(const p of planes){const k=p.componentId||'RAW';if(!byComp.has(k))byComp.set(k,[]);byComp.get(k).push(p)}
  for(const [componentId,list] of byComp){
    const use=[...list].sort((a,b)=>(b.area||0)-(a.area||0)).slice(0,24);
    for(let i=0;i<use.length;i++)for(let j=i+1;j<use.length;j++){
      const a=use[i],b=use[j];if(angleDeg(a.normal,b.normal)>1.2)continue;
      const d=Math.abs(dot(sub(b.origin,a.origin),norm(a.normal)));if(d<.2)continue;
      const areaRatio=Math.min(a.area,b.area)/Math.max(a.area,b.area);if(areaRatio<.25)continue;
      out.push({componentId,spacing:d,normal:a.normal,areaRatio,confidence:Math.min(a.confidence,b.confidence)*Math.min(1,.7+.3*areaRatio)});
    }
  }
  const ded=[];for(const x of out.sort((a,b)=>b.confidence-a.confidence)){if(!ded.some(y=>y.componentId===x.componentId&&Math.abs(y.spacing-x.spacing)<Math.max(.15,x.spacing*.006)))ded.push(x)}return ded.slice(0,80);
}

function markVerifiedGeometry(rec,planes,cylinders,holePatterns,planeSpacings){
  const diag=Math.hypot(...(rec?.bounds?.size||[1,1,1]))||1;
  const planeTol=Math.max(.010,diag*.000006);
  let vp=0,vc=0,vh=0,vpat=0,vps=0;
  for(const f of planes||[]){
    f.verified=!!(f.confidence>=.965&&Number.isFinite(f.rms)&&f.rms<=planeTol);
    f.verification=f.verified?{method:'analytic-plane-fit',rms:f.rms,tolerance:planeTol}:null;
    if(f.verified)vp++;
  }
  for(const f of cylinders||[]){
    const tol=Math.max(.015,(f.radius||0)*.00045,diag*.000006);
    const alignment=Math.abs(f.normalAlignment||0);
    f.verified=!!(f.full&&f.confidence>=.94&&Number.isFinite(f.rms)&&f.rms<=tol&&(f.coverageRad||0)>=5.35&&alignment>=.72);
    f.verification=f.verified?{method:'analytic-cylinder-fit',rms:f.rms,tolerance:tol,coverageRad:f.coverageRad,normalAlignment:f.normalAlignment}:null;
    if(f.verified){vc++;if(f.type==='hole')vh++;}
  }
  for(const g of holePatterns||[]){
    const members=g.members||[];
    const diameters=members.map(x=>x.diameter).filter(Number.isFinite);
    const spread=diameters.length?Math.max(...diameters)-Math.min(...diameters):Infinity;
    const pcdTol=g.pcd?Math.max(.04,g.pcd*.00045):Infinity;
    g.verified=!!(g.confidence>=.92&&spread<=Math.max(.025,(g.diameter||0)*.0008)&&(!g.pcd||(Number.isFinite(g.rms)&&g.rms<=pcdTol)));
    g.verification=g.verified?{method:g.pcd?'analytic-pattern-pcd-fit':'analytic-repeated-hole-fit',diameterSpread:spread,pcdRms:g.rms,pcdTolerance:g.pcd?pcdTol:null}:null;
    if(g.verified)vpat++;
  }
  for(const x of planeSpacings||[]){
    x.verified=!!(x.confidence>=.945&&x.areaRatio>=.55);
    if(x.verified)vps++;
  }
  const total=Math.max(1,(planes?.length||0)+(cylinders?.length||0));
  const verified=vp+vc;
  return{
    mode:'ANALYTIC_VERIFIED',nativeBRep:false,source:'FaceTessellations analytical fitting',
    counts:{planes:vp,cylinders:vc,holes:vh,holePatterns:vpat,planeSpacings:vps,totalVerified:verified,totalCandidates:total},
    ratio:verified/total,
    note:'VERIFIED означает подтверждённую аналитическую аппроксимацию по FaceTessellations с жёсткими допусками fit/residual. Это не нативный Parasolid B-Rep.'
  };
}

function clusterAxes(cyls){const groups=[];for(const c of cyls){let g=groups.find(x=>angleDeg(x.axis,c.axis)<2.5);if(!g){g={axis:c.axis,members:[],weight:0};groups.push(g)}g.members.push(c);g.weight+=Math.max(1,c.area);let s=[0,0,0];for(const m of g.members){let a=m.axis;if(dot(a,g.axis)<0)a=mul(a,-1);s=add(s,mul(a,Math.max(1,m.area)))}g.axis=canonicalAxis(s)}return groups.sort((a,b)=>b.weight-a.weight).map((g,i)=>({id:`AX-${i+1}`,axis:g.axis,count:g.members.length,weight:g.weight,diameters:[...new Set(g.members.map(x=>Math.round(x.diameter*1000)/1000))].sort((a,b)=>b-a)}))}
export function recognizeTessellationGeometry(rec,{maxFeatures=500}={}){
  const faces=rec?.faces||[],groups=faceGroups(faces),diag=Math.hypot(...(rec?.bounds?.size||[1,1,1]))||1,planes=[],rawCyl=[];
  for(const g of groups){const d=flattenGroup(g);const p=detectPlane(g,d,diag);if(p){planes.push(p);continue}const c=detectCylinder(g,d,diag);if(c)rawCyl.push(c)}
  const cylinders=dedupeCylinders(rawCyl).slice(0,maxFeatures),holes=cylinders.filter(x=>x.type==='hole'),outerCylinders=cylinders.filter(x=>x.type==='outer'),axes=clusterAxes(cylinders),holePatterns=groupHolePatterns(holes),coaxialGroups=clusterCoaxialCylinders(cylinders),planeSpacings=parallelPlaneSpacings(planes),components=new Map();
  for(const p of planes){const id=p.componentId||'RAW',g=components.get(id)||{componentId:id,name:p.instance?.name||id,planes:0,cylinders:0,holes:0,outerCylinders:0};g.planes++;components.set(id,g)}
  for(const c of cylinders){const id=c.componentId||'RAW',g=components.get(id)||{componentId:id,name:c.instance?.name||id,planes:0,cylinders:0,holes:0,outerCylinders:0};g.cylinders++;if(c.type==='hole')g.holes++;if(c.type==='outer')g.outerCylinders++;components.set(id,g)}
  const verification=markVerifiedGeometry(rec,planes,cylinders,holePatterns,planeSpacings);
  const all=[...planes,...cylinders],featureConfidence=all.length?all.reduce((s,x)=>s+x.confidence,0)/all.length:0;
  return{version:'2.4.0',source:'FaceTessellations',heuristic:true,facesAnalyzed:groups.length,trianglesAnalyzed:faces.length,planes,cylinders,holes,outerCylinders,axes,holePatterns,coaxialGroups,planeSpacings,components:[...components.values()],verification,counts:{faceGroups:groups.length,planes:planes.length,cylinders:cylinders.length,holes:holes.length,outerCylinders:outerCylinders.length,axes:axes.length,holePatterns:holePatterns.length,coaxialGroups:coaxialGroups.length,planeSpacings:planeSpacings.length,verifiedPlanes:verification.counts.planes,verifiedCylinders:verification.counts.cylinders,verifiedHoles:verification.counts.holes,verifiedPatterns:verification.counts.holePatterns,verifiedPlaneSpacings:verification.counts.planeSpacings},confidence:featureConfidence,dominantAxis:axes[0]?.axis||null,note:'Drawing Intelligence v2.4.0: аналитические плоскости/цилиндры/отверстия подтверждаются по RMS, покрытию и согласованности нормалей. VERIFIED — аналитика поверх FaceTessellations; B-Rep Core v1.7.0 отдельно строит V/E/F/Shell topology, но exact Parasolid ещё не декодирован.'};
}
export function recognitionDimensions(rec,recognition,{limit=24}={}){
  const out=[],seen=new Set();
  const push=(x,key)=>{if(!Number.isFinite(x?.value))return;if(seen.has(key))return;seen.add(key);out.push(x)};
  const b=rec?.bounds?.size||[];for(let i=0;i<3;i++)if(Number.isFinite(b[i]))push({type:'Габарит',label:['X','Y','Z'][i],value:b[i],unit:'mm',confidence:.96,source:'TESS_BOUNDS'},`B:${i}:${Math.round(b[i]*100)/100}`);
  for(const p of recognition?.holePatterns||[]){
    push({type:p.pcd?'Группа отверстий · PCD':'Группа отверстий',label:`${p.count}×Ø`,value:p.diameter,unit:'mm',confidence:p.confidence,source:p.verified?'VERIFIED_HOLE_PATTERN':'TESS_HOLE_PATTERN',count:p.count,pcd:p.pcd,componentId:p.componentId},`HP:${p.componentId}:${p.count}:${p.diameter.toFixed(2)}:${p.pcd?Math.round(p.pcd*10):0}`);
    if(p.pcd)push({type:'Делительная окружность',label:'PCD Ø',value:p.pcd,unit:'mm',confidence:Math.max(.7,p.confidence-.03),source:p.verified?'VERIFIED_PCD':'TESS_PCD',count:p.count,componentId:p.componentId},`PCD:${p.componentId}:${Math.round(p.pcd*10)}`);
  }
  const cyl=[...(recognition?.cylinders||[])].filter(c=>c.full&&c.confidence>.72).sort((a,b)=>b.area-a.area||b.diameter-a.diameter);
  for(const c of cyl){const dk=Math.round(c.diameter*100)/100,lk=Math.round(c.length*100)/100;push({type:c.type==='hole'?'Отверстие':'Цилиндр',label:'Ø',value:c.diameter,unit:'mm',confidence:c.confidence,source:c.verified?'VERIFIED_CYLINDER':'TESS_CYLINDER',componentId:c.componentId,feature:c},`D:${c.componentId}:${c.type}:${dk}`);if(c.length>1)push({type:'Длина цилиндра',label:'L',value:c.length,unit:'mm',confidence:Math.max(.65,c.confidence-.05),source:c.verified?'VERIFIED_CYLINDER_LENGTH':'TESS_CYLINDER_LENGTH',componentId:c.componentId,feature:c},`L:${c.componentId}:${lk}`);if(out.length>=limit)break}
  if(out.length<limit){for(const s of recognition?.planeSpacings||[]){if(s.spacing<1||s.spacing>5000)continue;push({type:'Расстояние плоскостей',label:'L',value:s.spacing,unit:'mm',confidence:s.confidence,source:s.verified?'VERIFIED_PLANE_SPACING':'TESS_PLANE_SPACING',componentId:s.componentId},`PS:${s.componentId}:${Math.round(s.spacing*10)}`);if(out.length>=limit)break}}
  return out.slice(0,limit);
}
