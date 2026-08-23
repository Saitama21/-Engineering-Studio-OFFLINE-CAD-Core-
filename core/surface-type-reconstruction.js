// ROZFOOD Engineering Studio v5.0.0 — Surface Type Reconstruction Core
// Builds a deterministic surface/topology model from verified FaceTessellations recognition.
// It is NOT native Parasolid: all classifications retain provenance/confidence.

const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const mul=(a,s)=>[a[0]*s,a[1]*s,a[2]*s];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const len=a=>Math.hypot(a[0],a[1],a[2]);
const norm=a=>{const L=len(a)||1;return[a[0]/L,a[1]/L,a[2]/L]};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const cache=new WeakMap();

function faceKeyOf(f){return[f.componentId||'RAW',f.modelId||'',f.sourceStream||'',f.tessFaceId??''].join('|')}
function diag(rec){return Math.hypot(...(rec?.bounds?.size||[1,1,1]))||1}
function qpt(p,q){return p.map(v=>Math.round(v/q)).join(',')}
function edgeKey(a,b,q){const A=qpt(a,q),B=qpt(b,q);return A<B?A+'|'+B:B+'|'+A}
function pairKey(a,b){return a<b?a+'||'+b:b+'||'+a}
function canonicalAxis(a){a=norm(a);const i=Math.abs(a[0])>.01?0:Math.abs(a[1])>.01?1:2;return a[i]<0?mul(a,-1):a}
function angleAbs(a,b){return Math.acos(clamp(Math.abs(dot(norm(a),norm(b))),-1,1))*180/Math.PI}
function faceNormal(f){const ns=f?.normals||[];if(ns.length){let n=[0,0,0];for(const z of ns)n=add(n,z);if(len(n)>1e-8)return norm(n)}const p=f?.loops?.[0]||[];return p.length>=3?norm(cross(sub(p[1],p[0]),sub(p[2],p[0]))):[0,0,1]}
function planeOffset(p){return dot(norm(p.normal),p.origin)}
function axisDistance(a,b){const ax=norm(a.axis),d=sub(b.axisPoint,a.axisPoint);return len(sub(d,mul(ax,dot(d,ax))))}
function samePlane(a,b,tol){return angleAbs(a.normal,b.normal)<.8&&Math.abs(planeOffset(a)-planeOffset(b))<tol}
function sameCylinder(a,b,tol){return angleAbs(a.axis,b.axis)<.8&&axisDistance(a,b)<tol&&Math.abs(a.radius-b.radius)<tol}

function buildFaceGroups(rec){
  const groups=new Map();
  for(const f of rec?.faces||[]){const k=faceKeyOf(f);let g=groups.get(k);if(!g)groups.set(k,g={faceKey:k,componentId:f.componentId||'RAW',modelId:f.modelId||null,sourceStream:f.sourceStream||null,faces:[],area:0,normals:[]});g.faces.push(f);g.area+=f.area||0;g.normals.push(faceNormal(f))}
  return groups;
}

function normalSignature(group){
  const ns=group.normals;if(!ns.length)return{mean:[0,0,1],spreadDeg:180};let m=[0,0,0];for(const n of ns)m=add(m,n);m=norm(m);let max=0,rms=0;for(const n of ns){const a=Math.acos(clamp(Math.abs(dot(m,n)),-1,1))*180/Math.PI;max=Math.max(max,a);rms+=a*a}return{mean:m,spreadDeg:max,rmsDeg:Math.sqrt(rms/ns.length)};
}

function featureMaps(rec){
  const cad=rec?.cadFeatures||rec?.analyticGeometry?.featureEntities||{};
  const fillets=new Map((cad.fillets||[]).filter(x=>x.faceKey).map(x=>[x.faceKey,x]));
  const chamfers=new Map((cad.chamfers||[]).filter(x=>x.faceKey).map(x=>[x.faceKey,x]));
  return{fillets,chamfers};
}


function solve3(A,b){
  const M=A.map((r,i)=>[...r,b[i]]);for(let c=0;c<3;c++){let piv=c;for(let r=c+1;r<3;r++)if(Math.abs(M[r][c])>Math.abs(M[piv][c]))piv=r;if(Math.abs(M[piv][c])<1e-12)return null;[M[c],M[piv]]=[M[piv],M[c]];const d=M[c][c];for(let j=c;j<4;j++)M[c][j]/=d;for(let r=0;r<3;r++)if(r!==c){const f=M[r][c];for(let j=c;j<4;j++)M[r][j]-=f*M[c][j]}}return[M[0][3],M[1][3],M[2][3]];
}
function groupPoints(g){const out=[];for(const f of g.faces||[])for(const loop of f.loops||[])for(const p of loop||[])out.push(p);return out}

function solve4(A,b){
  const M=A.map((r,i)=>[...r,b[i]]);for(let c=0;c<4;c++){let piv=c;for(let r=c+1;r<4;r++)if(Math.abs(M[r][c])>Math.abs(M[piv][c]))piv=r;if(Math.abs(M[piv][c])<1e-12)return null;[M[c],M[piv]]=[M[piv],M[c]];const d=M[c][c];for(let j=c;j<5;j++)M[c][j]/=d;for(let r=0;r<4;r++)if(r!==c){const f=M[r][c];for(let j=c;j<5;j++)M[r][j]-=f*M[c][j]}}return[M[0][4],M[1][4],M[2][4],M[3][4]];
}
function fitSphereSurface(g,D){
  const pts=groupPoints(g);if(pts.length<18)return null;let S=[[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]],b=[0,0,0,0];
  for(const p of pts){const x=p[0],y=p[1],z=p[2],q=-(x*x+y*y+z*z),v=[x,y,z,1];for(let i=0;i<4;i++){b[i]+=v[i]*q;for(let j=0;j<4;j++)S[i][j]+=v[i]*v[j]}}
  const sol=solve4(S,b);if(!sol)return null;const[A,B,C,E]=sol,center=[-A/2,-B/2,-C/2],r2=dot(center,center)-E;if(!(r2>1e-8))return null;const radius=Math.sqrt(r2);let e2=0,min=Infinity,max=-Infinity;for(const p of pts){const rr=len(sub(p,center));e2+=(rr-radius)*(rr-radius);min=Math.min(min,rr);max=Math.max(max,rr)}const rms=Math.sqrt(e2/pts.length),tol=Math.max(.035,D*5e-5,radius*.0035);if(radius>D*.25||rms>tol)return null;return{type:'sphere-inferred',confidence:clamp(1-rms/Math.max(tol,.04),.74,.97),params:{center,radius},fitRms:rms};
}
function candidateAxes(cylinders,componentId){
  const out=[];for(const c of cylinders.values())if((c.componentId||'RAW')===(componentId||'RAW')){const a=canonicalAxis(c.axis),p=c.axisPoint||[0,0,0];if(!out.some(x=>angleAbs(x.axis,a)<.5&&axisDistance({axis:x.axis,axisPoint:x.point},{axis:a,axisPoint:p})<.2))out.push({axis:a,point:p})}return out.slice(0,6)
}
function fitConicSurface(g,cylinders,D){
  const pts=groupPoints(g);if(pts.length<10)return null;let best=null;
  for(const cand of candidateAxes(cylinders,g.componentId)){
    const a=cand.axis,p=cand.point,ts=[],rs=[];for(const q of pts){const d=sub(q,p),t=dot(d,a),rv=sub(d,mul(a,t));ts.push(t);rs.push(len(rv))}
    const tmin=Math.min(...ts),tmax=Math.max(...ts),span=tmax-tmin;if(span<Math.max(.25,D*2e-4))continue;const n=ts.length,mt=ts.reduce((x,y)=>x+y,0)/n,mr=rs.reduce((x,y)=>x+y,0)/n;let sxx=0,sxy=0;for(let i=0;i<n;i++){const dt=ts[i]-mt;sxx+=dt*dt;sxy+=dt*(rs[i]-mr)}if(sxx<1e-10)continue;const k=sxy/sxx,b=mr-k*mt;let e2=0;for(let i=0;i<n;i++){const e=rs[i]-(k*ts[i]+b);e2+=e*e}const rms=Math.sqrt(e2/n),rspan=Math.max(...rs)-Math.min(...rs);
    if(Math.abs(k)>.01&&rspan>Math.max(.08,D*7e-5)&&rms<Math.max(.05,D*7e-5,Math.abs(mr)*.0025)){
      const conf=clamp(1-rms/Math.max(.08,D*2e-4),.72,.96),fit={type:'cone-inferred',confidence:conf,params:{axis:a,axisPoint:p,tmin,tmax,r0:k*tmin+b,r1:k*tmax+b,slope:k,halfAngleDeg:Math.atan(Math.abs(k))*180/Math.PI},fitRms:rms};if(!best||fit.confidence>best.confidence)best=fit;
    }
    // Torus/round fillet fit in meridian (t,rho): (t-tc)^2+(rho-R)^2=rm^2.
    let Sx=0,Sy=0,Sxx=0,Sxy=0,Syy=0,Sz=0,Sxz=0,Syz=0;for(let i=0;i<n;i++){const x=ts[i],y=rs[i],z=-(x*x+y*y);Sx+=x;Sy+=y;Sxx+=x*x;Sxy+=x*y;Syy+=y*y;Sz+=z;Sxz+=x*z;Syz+=y*z}const sol=solve3([[Sxx,Sxy,Sx],[Sxy,Syy,Sy],[Sx,Sy,n]],[Sxz,Syz,Sz]);if(sol){const [A,B,C]=sol,tc=-A/2,R=-B/2,rm2=tc*tc+R*R-C;if(rm2>0){const rm=Math.sqrt(rm2);let er=0,amin=Infinity,amax=-Infinity;for(let i=0;i<n;i++){const rr=Math.hypot(ts[i]-tc,rs[i]-R);er+=(rr-rm)**2;const ang=Math.atan2(rs[i]-R,ts[i]-tc);amin=Math.min(amin,ang);amax=Math.max(amax,ang)}const rmsT=Math.sqrt(er/n),sweep=amax-amin;if(R>rm*.8&&rm>Math.max(.08,D*6e-5)&&rm<D*.08&&sweep>.12&&sweep<Math.PI*1.45&&rmsT<Math.max(.04,D*6e-5,rm*.006)){
        const conf=clamp(1-rmsT/Math.max(.06,D*1.5e-4),.74,.95),fit={type:'torus-inferred',confidence:conf,params:{axis:a,axisPoint:p,majorRadius:R,minorRadius:rm,centerT:tc,angleMin:amin,angleMax:amax,sweepRad:sweep},fitRms:rmsT};if(!best||fit.confidence>best.confidence+.015)best=fit;
      }} }
  }
  return best;
}

function classifySurfaces(rec,groups){
  const R=rec?.recognition||{},planes=new Map(),cylinders=new Map(),{fillets,chamfers}=featureMaps(rec),D=diag(rec);
  for(const p of R.planes||[])if(p.faceKey&&p.confidence>=.82)planes.set(p.faceKey,p);
  for(const c of R.cylinders||[])if(c.faceKey&&c.confidence>=.72)cylinders.set(c.faceKey,c);
  const welded=rec?.weldedAssembly?.byComponent||new Map();
  const out=new Map();
  for(const [faceKey,g] of groups){
    const sig=normalSignature(g),p=planes.get(faceKey),c=cylinders.get(faceKey),fillet=fillets.get(faceKey),chamfer=chamfers.get(faceKey),member=welded?.get?.(g.componentId);
    let type='freeform',confidence=.45,params={};
    if(fillet){type='fillet';confidence=Math.max(.84,fillet.confidence||0);params={radius:fillet.radius,axis:fillet.axis,axisPoint:fillet.axisPoint,sweepRad:fillet.sweepRad}}
    else if(chamfer){type='chamfer';confidence=Math.max(.84,chamfer.confidence||0);params={angleDeg:chamfer.angleDeg,width:chamfer.width,axis:chamfer.axis,axisPoint:chamfer.axisPoint}}
    else if(c){type='cylinder';confidence=c.confidence||.8;params={axis:canonicalAxis(c.axis),axisPoint:c.axisPoint,radius:c.radius,length:c.length,full:!!c.full,role:c.type||'cylinder'}}
    else if(p){type='plane';confidence=p.confidence||.9;params={normal:norm(p.normal),origin:p.origin,area:p.area||g.area}}
    else if(member?.role==='blade/rib'&&sig.spreadDeg>8){type='ruled/helical';confidence=.66;params={memberRole:member.role,thickness:member.thickness||null}}
    else if(sig.spreadDeg<2.2){type='plane-inferred';confidence=.68;params={normal:sig.mean}}
    else {const fit=fitConicSurface(g,cylinders,D)||fitSphereSurface(g,D);if(fit){type=fit.type;confidence=fit.confidence;params=fit.params}else if(sig.spreadDeg<18){type='developable';confidence=.56;params={normalSpreadDeg:sig.spreadDeg}}}
    out.set(faceKey,{id:`SURF-${out.size+1}`,faceKey,componentId:g.componentId,modelId:g.modelId,type,confidence,area:g.area,normal:sig.mean,normalSpreadDeg:sig.spreadDeg,params,source:'FaceTessellations+recognition'});
  }
  return out;
}

function boundaryAdjacency(rec,groups,q){
  const global=new Map();
  for(const g of groups.values()){
    const local=new Map();
    for(const f of g.faces){const loop=f?.loops?.[0]||[];if(loop.length<3)continue;for(let i=0;i<loop.length;i++){const a=loop[i],b=loop[(i+1)%loop.length];if(len(sub(a,b))<q*.1)continue;const k=edgeKey(a,b,q);let e=local.get(k);if(!e)local.set(k,e={a,b,count:0});e.count++}}
    for(const [k,e] of local)if(e.count===1){const kk=g.componentId+'|'+k;let a=global.get(kk);if(!a)global.set(kk,a=[]);a.push({faceKey:g.faceKey,componentId:g.componentId,a:e.a,b:e.b})}
  }
  return global;
}

function relationOf(A,B,edge,tol){
  if(!A||!B)return{kind:'boundary',draw:true,confidence:.5};
  if(A.componentId!==B.componentId)return{kind:'component-interface',draw:true,confidence:.9};
  const a=A.type,b=B.type;
  if((a==='plane'||a==='plane-inferred')&&(b==='plane'||b==='plane-inferred')){
    if(A.params?.origin&&B.params?.origin&&samePlane(A.params,B.params,tol))return{kind:'coplanar-merge',draw:false,confidence:.96};
    if(angleAbs(A.normal,B.normal)<1.2)return{kind:'coplanar-merge',draw:false,confidence:.86};
    return{kind:'sharp',draw:true,confidence:.94};
  }
  if(a==='cylinder'&&b==='cylinder'){
    if(sameCylinder(A.params,B.params,tol))return{kind:'coaxial-cylinder-merge',draw:false,confidence:.95};
    return{kind:'sharp',draw:true,confidence:.9};
  }
  if(a==='fillet'||b==='fillet'||a==='torus-inferred'||b==='torus-inferred')return{kind:'tangent',draw:false,confidence:.92};
  if(a==='chamfer'||b==='chamfer'||a==='cone-inferred'||b==='cone-inferred')return{kind:'sharp-feature',draw:true,confidence:.95};
  const ang=angleAbs(A.normal,B.normal);if(ang<6.5)return{kind:'G1',draw:false,confidence:.78};
  if(ang<12)return{kind:'near-G1',draw:true,soft:true,confidence:.65};
  return{kind:'sharp',draw:true,confidence:.85};
}

export function reconstructSurfaceModel(rec){
  const sig=[rec?.faces?.length||0,rec?.recognition?.planes?.length||0,rec?.recognition?.cylinders?.length||0,rec?.cadFeatures?.counts?.total||0,rec?.weldedAssembly?.counts?.members||0].join('|');
  const hit=cache.get(rec);if(hit?.sig===sig)return hit.result;
  const groups=buildFaceGroups(rec),surfaces=classifySurfaces(rec,groups),q=Math.max(.0015,Math.min(.035,diag(rec)*8e-6)),adj=boundaryAdjacency(rec,groups,q),relations=new Map(),suppressedEdgeKeys=new Set(),softEdgeKeys=new Set();
  const tol=Math.max(.025,diag(rec)*8e-5);let shared=0,suppressed=0,sharp=0,tangent=0,coplanar=0,interfaces=0;
  for(const [ek,entries] of adj){if(entries.length<2)continue;for(let i=0;i<entries.length;i++)for(let j=i+1;j<entries.length;j++){
    const x=entries[i],y=entries[j];if(x.faceKey===y.faceKey)continue;shared++;const A=surfaces.get(x.faceKey),B=surfaces.get(y.faceKey),rel=relationOf(A,B,x,tol),pk=pairKey(x.faceKey,y.faceKey);const old=relations.get(pk);if(!old||rel.confidence>old.confidence)relations.set(pk,{...rel,faceA:x.faceKey,faceB:y.faceKey,componentId:x.componentId});
    if(!rel.draw){suppressedEdgeKeys.add(ek);suppressed++;if(rel.kind==='tangent'||rel.kind==='G1')tangent++;if(rel.kind.includes('merge'))coplanar++}else{sharp++;if(rel.soft)softEdgeKeys.add(ek);if(rel.kind==='component-interface')interfaces++}
  }}
  const counts={surfaces:surfaces.size,planes:0,cylinders:0,cones:0,tori:0,spheres:0,fillets:0,chamfers:0,helical:0,developable:0,freeform:0,sharedBoundaries:shared,suppressedBoundaries:suppressed,sharpBoundaries:sharp,tangentBoundaries:tangent,mergedBoundaries:coplanar,componentInterfaces:interfaces};
  for(const s of surfaces.values()){if(s.type.startsWith('plane'))counts.planes++;else if(s.type==='cylinder')counts.cylinders++;else if(s.type==='cone-inferred')counts.cones++;else if(s.type==='torus-inferred')counts.tori++;else if(s.type==='sphere-inferred')counts.spheres++;else if(s.type==='fillet')counts.fillets++;else if(s.type==='chamfer')counts.chamfers++;else if(s.type==='ruled/helical')counts.helical++;else if(s.type==='developable')counts.developable++;else counts.freeform++}
  const result={version:'9.0.0',kernel:'ROZFOOD Surface Type Reconstruction Core',exactParasolid:false,source:'FaceTessellations + verified analytic recognition + CAD feature entities',quantization:q,surfaces,relations,suppressedEdgeKeys,softEdgeKeys,counts,note:'Surface topology is reconstructed deterministically from tessellation evidence; exact native Parasolid surface definitions are not claimed.'};
  rec.surfaceModel=result;cache.set(rec,{sig,result});return result;
}

export function surfaceBoundaryDecision(rec,faceKeys=[]){
  const M=reconstructSurfaceModel(rec);if(!faceKeys||faceKeys.length<2)return{draw:true,kind:'boundary'};
  let best=null;for(let i=0;i<faceKeys.length;i++)for(let j=i+1;j<faceKeys.length;j++){const r=M.relations.get(pairKey(faceKeys[i],faceKeys[j]));if(r&&(!best||r.confidence>best.confidence))best=r}return best||{draw:true,kind:'boundary',confidence:.5};
}

export function surfaceTypeStats(rec){return reconstructSurfaceModel(rec).counts}
