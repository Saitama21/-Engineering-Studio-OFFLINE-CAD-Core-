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
  if(points.length<6)return null;
  let sx=0,sy=0,sxx=0,syy=0,sxy=0,sr=0,sxr=0,syr=0;
  for(const [x,y] of points){const r=x*x+y*y;sx+=x;sy+=y;sxx+=x*x;syy+=y*y;sxy+=x*y;sr+=r;sxr+=x*r;syr+=y*r}
  const n=points.length,sol=solve3([[sxx,sxy,sx],[sxy,syy,sy],[sx,sy,n]],[-sxr,-syr,-sr]);
  if(!sol)return null;const [D,E,F]=sol,cx=-D/2,cy=-E/2,rr=cx*cx+cy*cy-F;if(!(rr>EPS))return null;
  const radius=Math.sqrt(rr);let se=0;for(const [x,y] of points){const d=Math.hypot(x-cx,y-cy)-radius;se+=d*d}
  return{cx,cy,radius,rms:Math.sqrt(se/n)};
}
function perpendicularBasis(axis){const a=norm(axis),seed=Math.abs(a[2])<.8?[0,0,1]:[1,0,0],u=norm(cross(a,seed)),v=norm(cross(a,u));return{u,v}}
function angularCoverage(points,cx,cy){if(points.length<6)return 0;const a=points.map(([x,y])=>Math.atan2(y-cy,x-cx)).sort((x,y)=>x-y);let maxGap=0;for(let i=1;i<a.length;i++)maxGap=Math.max(maxGap,a[i]-a[i-1]);maxGap=Math.max(maxGap,a[0]+Math.PI*2-a[a.length-1]);return Math.PI*2-maxGap}
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
  const ts=points.map(p=>dot(p,axis)),tmin=Math.min(...ts),tmax=Math.max(...ts),length=tmax-tmin;if(length<.03)return null;
  const mid=(tmin+tmax)/2,axisPoint=add(add(mul(u,fit.cx),mul(v,fit.cy)),mul(axis,mid));
  let align=0,count=0;for(let i=0;i<points.length;i++){const t=dot(points[i],axis),onAxis=add(axisPoint,mul(axis,t-mid)),rad=norm(sub(points[i],onAxis));if(len(rad)>.5){align+=dot(normals[i],rad);count++}}
  align=count?align/count:0;const coverage=angularCoverage(p2,fit.cx,fit.cy),full=coverage>Math.PI*1.72;
  const type=align<-.35?'hole':align>.35?'outer':'cylinder';const fitScore=1-clamp(fit.rms/(tol||1),0,1),coverageScore=clamp(coverage/(Math.PI*2),0,1),confidence=clamp(.62+.2*(1-ratio/.025)+.12*fitScore+.06*coverageScore,0,1);
  return{kind:'cylinder',type,componentId:g.componentId,modelId:g.modelId,instance:g.instance,faceKey:g.key,axis,axisPoint,radius:fit.radius,diameter:fit.radius*2,length,area,bounds,rms:fit.rms,normalAlignment:align,coverageRad:coverage,full,confidence};
}
function sameAxis(a,b,angleTol=2){return angleDeg(a.axis,b.axis)<=angleTol}
function lineDistance(a,b){const da=sub(b.axisPoint,a.axisPoint),ax=norm(a.axis);return len(sub(da,mul(ax,dot(da,ax))))}
function dedupeCylinders(cyls){const out=[];for(const c of [...cyls].sort((a,b)=>b.confidence-a.confidence||b.area-a.area)){const dup=out.find(x=>x.componentId===c.componentId&&sameAxis(x,c,1.2)&&lineDistance(x,c)<Math.max(.08,c.radius*.004)&&Math.abs(x.radius-c.radius)<Math.max(.08,c.radius*.004)&&Math.abs(x.length-c.length)<Math.max(.2,c.length*.02));if(!dup)out.push(c)}return out}
function clusterAxes(cyls){const groups=[];for(const c of cyls){let g=groups.find(x=>angleDeg(x.axis,c.axis)<2.5);if(!g){g={axis:c.axis,members:[],weight:0};groups.push(g)}g.members.push(c);g.weight+=Math.max(1,c.area);let s=[0,0,0];for(const m of g.members){let a=m.axis;if(dot(a,g.axis)<0)a=mul(a,-1);s=add(s,mul(a,Math.max(1,m.area)))}g.axis=canonicalAxis(s)}return groups.sort((a,b)=>b.weight-a.weight).map((g,i)=>({id:`AX-${i+1}`,axis:g.axis,count:g.members.length,weight:g.weight,diameters:[...new Set(g.members.map(x=>Math.round(x.diameter*1000)/1000))].sort((a,b)=>b-a)}))}
export function recognizeTessellationGeometry(rec,{maxFeatures=500}={}){
  const faces=rec?.faces||[],groups=faceGroups(faces),diag=Math.hypot(...(rec?.bounds?.size||[1,1,1]))||1,planes=[],rawCyl=[];
  for(const g of groups){const d=flattenGroup(g);const p=detectPlane(g,d,diag);if(p){planes.push(p);continue}const c=detectCylinder(g,d,diag);if(c)rawCyl.push(c)}
  const cylinders=dedupeCylinders(rawCyl).slice(0,maxFeatures),holes=cylinders.filter(x=>x.type==='hole'),outerCylinders=cylinders.filter(x=>x.type==='outer'),axes=clusterAxes(cylinders),components=new Map();
  for(const p of planes){const id=p.componentId||'RAW',g=components.get(id)||{componentId:id,name:p.instance?.name||id,planes:0,cylinders:0,holes:0,outerCylinders:0};g.planes++;components.set(id,g)}
  for(const c of cylinders){const id=c.componentId||'RAW',g=components.get(id)||{componentId:id,name:c.instance?.name||id,planes:0,cylinders:0,holes:0,outerCylinders:0};g.cylinders++;if(c.type==='hole')g.holes++;if(c.type==='outer')g.outerCylinders++;components.set(id,g)}
  const all=[...planes,...cylinders],featureConfidence=all.length?all.reduce((s,x)=>s+x.confidence,0)/all.length:0;
  return{version:'0.8.0',source:'FaceTessellations',heuristic:true,facesAnalyzed:groups.length,trianglesAnalyzed:faces.length,planes,cylinders,holes,outerCylinders,axes,components:[...components.values()],counts:{faceGroups:groups.length,planes:planes.length,cylinders:cylinders.length,holes:holes.length,outerCylinders:outerCylinders.length,axes:axes.length},confidence:featureConfidence,dominantAxis:axes[0]?.axis||null,note:'Геометрия распознана эвристически из тесселяции. Размеры требуют VERIFY до появления точного B-Rep.'};
}
export function recognitionDimensions(rec,recognition,{limit=18}={}){
  const out=[];const b=rec?.bounds?.size||[];for(let i=0;i<3;i++)if(Number.isFinite(b[i]))out.push({type:'Габарит',label:['X','Y','Z'][i],value:b[i],unit:'mm',confidence:.96,source:'TESS_BOUNDS'});
  const cyl=[...(recognition?.cylinders||[])].filter(c=>c.full&&c.confidence>.72).sort((a,b)=>b.area-a.area||b.diameter-a.diameter),seen=new Set();
  for(const c of cyl){const key=`${c.type}:${Math.round(c.diameter*100)/100}:${Math.round(c.length*100)/100}`;if(seen.has(key))continue;seen.add(key);out.push({type:c.type==='hole'?'Отверстие':'Цилиндр',label:`Ø${c.diameter.toFixed(3)}`,value:c.diameter,unit:'mm',confidence:c.confidence,source:'TESS_CYLINDER',componentId:c.componentId,feature:c});if(c.length>1)out.push({type:'Длина цилиндра',label:`L ${c.length.toFixed(3)}`,value:c.length,unit:'mm',confidence:Math.max(.65,c.confidence-.05),source:'TESS_CYLINDER_LENGTH',componentId:c.componentId,feature:c});if(out.length>=limit)break}
  return out.slice(0,limit);
}
