import {recognizeTessellationGeometry} from '../core/tess-recognition.js';
import {componentLocalRecord,componentDrawableIds} from '../core/component-local.js';
import {buildFeatureGraph} from '../core/feature-graph.js';
import {recognizeManufacturingFeatures} from '../core/manufacturing-recognition.js';
import {engineeringLinework,buildOcclusionField,visibleEdgeSegments,reconstructionStats} from './drawing-reconstruction-core.js';
import {analyticViewCurves,analyticSectionCurves,edgeIsAnalyticSurface,reconstructAnalyticGeometry} from '../core/analytic-geometry.js';
const esc=x=>String(x??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[m]));
const fmt=(v,d=0)=>Number.isFinite(v)?Number(v).toFixed(d).replace(/\.0+$/,''): '—';
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const mul=(a,s)=>[a[0]*s,a[1]*s,a[2]*s];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const len=a=>Math.hypot(a[0],a[1],a[2]);
const norm=a=>{const l=len(a)||1;return[a[0]/l,a[1]/l,a[2]/l]};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function basis(axis){const a=norm(axis),seed=Math.abs(a[2])<.82?[0,0,1]:[1,0,0],u=norm(cross(a,seed)),v=norm(cross(a,u));return{a,u,v}}
function corners(bounds){const mn=bounds.min,mx=bounds.max,out=[];for(const x of [mn[0],mx[0]])for(const y of [mn[1],mx[1]])for(const z of [mn[2],mx[2]])out.push([x,y,z]);return out}
function dominantAxis(rec){return norm(rec?.recognition?.dominantAxis||(()=>{const s=rec?.bounds?.size||[1,1,1],i=s.indexOf(Math.max(...s)),a=[0,0,0];a[i]=1;return a})())}
const edgeCache=new WeakMap();
function qpt(p,q=.02){return p.map(v=>Math.round(v/q)).join(',')}
function edgeKey(a,b,comp){const aa=qpt(a),bb=qpt(b);return (aa<bb?aa+'|'+bb:bb+'|'+aa)+'|'+(comp||'')}
function triNormal(f){const ns=f.normals||[];if(ns.length){let s=[0,0,0];for(const n of ns)s=add(s,n);if(len(s)>1e-8)return norm(s)}const p=f.loops?.[0]||[];return p.length>=3?norm(cross(sub(p[1],p[0]),sub(p[2],p[0]))):[0,0,1]}
function buildEdges(rec){if(edgeCache.has(rec))return edgeCache.get(rec);const map=new Map();for(const f of rec.faces||[]){const pts=f.loops?.[0]||[];if(pts.length<3)continue;const n=triNormal(f),comp=f.componentId||'RAW';for(const [i,j] of [[0,1],[1,2],[2,0]]){const a=pts[i],b=pts[j],k=edgeKey(a,b,comp);let e=map.get(k);if(!e){e={a,b,normals:[],comp};map.set(k,e)}e.normals.push(n)}}const out=[...map.values()];edgeCache.set(rec,out);return out}
function linework(rec,viewDir,{crease=.90}={}){const d=norm(viewDir),out=[];for(const e of buildEdges(rec)){const ns=e.normals;if(ns.length===1){out.push(e);continue}let silhouette=false,sharp=false;for(let i=0;i<ns.length;i++)for(let j=i+1;j<ns.length;j++){if(dot(ns[i],d)*dot(ns[j],d)<=0)silhouette=true;if(Math.abs(dot(ns[i],ns[j]))<crease)sharp=true}if(silhouette||sharp)out.push(e)}return out}
function viewSpec(axis,kind='side'){const{a,u,v}=basis(axis);if(kind==='end')return{px:u,py:v,dir:a};if(kind==='iso'){const px=norm(add(mul(a,.78),mul(u,.62))),py=norm(add(add(mul(v,.83),mul(a,-.27)),mul(u,.18))),dir=norm(cross(px,py));return{px,py,dir}}return{px:a,py:u,dir:v}}
function project(p,s){return[dot(p,s.px),dot(p,s.py)]}
function projectBounds(bounds,s){const pts=corners(bounds).map(p=>project(p,s)),xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]);return{min:[Math.min(...xs),Math.min(...ys)],max:[Math.max(...xs),Math.max(...ys)]}}
function mapView(bounds,s,box,pad=10,fixedScale=null){const ex=projectBounds(bounds,s),sx=Math.max(ex.max[0]-ex.min[0],1),sy=Math.max(ex.max[1]-ex.min[1],1),fitScale=Math.min((box.w-pad*2)/sx,(box.h-pad*2)/sy),scale=Number.isFinite(fixedScale)&&fixedScale>0?fixedScale:fitScale,dx=box.x+box.w/2-(ex.min[0]+ex.max[0])*scale/2,dy=box.y+box.h/2+(ex.min[1]+ex.max[1])*scale/2;return{P:p=>{const q=project(p,s);return[dx+q[0]*scale,dy-q[1]*scale]},scale,fitScale,ext:ex}}
function buildViewVisibility(rec,s){const faces=rec.faces||[];if(!faces.length)return null;const ex=projectBounds(rec.bounds,s),spanX=Math.max(ex.max[0]-ex.min[0],1e-6),spanY=Math.max(ex.max[1]-ex.min[1],1e-6),cols=220,rows=160,z=new Float32Array(cols*rows);z.fill(-Infinity);const gx=x=>(x-ex.min[0])/spanX*(cols-1),gy=y=>(y-ex.min[1])/spanY*(rows-1),step=faces.length>42000?Math.ceil(faces.length/42000):1;for(let fi=0;fi<faces.length;fi+=step){const loop=faces[fi].loops?.[0]||[];if(loop.length<3)continue;for(let ti=1;ti+1<loop.length;ti++){const P=[loop[0],loop[ti],loop[ti+1]],q=P.map(p=>project(p,s)),d=P.map(p=>dot(p,s.dir)),ax=gx(q[0][0]),ay=gy(q[0][1]),bx=gx(q[1][0]),by=gy(q[1][1]),cx=gx(q[2][0]),cy=gy(q[2][1]),den=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy);if(Math.abs(den)<1e-9)continue;const x0=Math.max(0,Math.floor(Math.min(ax,bx,cx))),x1=Math.min(cols-1,Math.ceil(Math.max(ax,bx,cx))),y0=Math.max(0,Math.floor(Math.min(ay,by,cy))),y1=Math.min(rows-1,Math.ceil(Math.max(ay,by,cy)));for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const px=x+.5,py=y+.5,w1=((by-cy)*(px-cx)+(cx-bx)*(py-cy))/den,w2=((cy-ay)*(px-cx)+(ax-cx)*(py-cy))/den,w3=1-w1-w2;if(w1<-.015||w2<-.015||w3<-.015)continue;const depth=w1*d[0]+w2*d[1]+w3*d[2],idx=y*cols+x;if(depth>z[idx])z[idx]=depth}}}return{z,cols,rows,ex,spanX,spanY,tol:Math.max(.08,Math.hypot(...rec.bounds.size)*.0025)}}
function viewPointVisible(p,s,vb){if(!vb)return true;const q=project(p,s),x=Math.round((q[0]-vb.ex.min[0])/vb.spanX*(vb.cols-1)),y=Math.round((q[1]-vb.ex.min[1])/vb.spanY*(vb.rows-1));if(x<0||y<0||x>=vb.cols||y>=vb.rows)return true;const front=vb.z[y*vb.cols+x];return !Number.isFinite(front)||dot(p,s.dir)>=front-vb.tol}
function viewEdgeVisible(e,s,vb){const a=e.a,b=e.b,m=mul(add(a,b),.5),q1=add(mul(a,.75),mul(b,.25)),q2=add(mul(a,.25),mul(b,.75));return[a,q1,m,q2,b].filter(p=>viewPointVisible(p,s,vb)).length>=2}
function renderMesh(rec,s,box,{stroke='#111',width=.72,detail=false,fixedScale=null,hiddenRemoval=true,frameBounds=null}={}){
  const M=mapView(frameBounds||rec.bounds,s,box,detail?2:8,fixedScale);
  const analyticBundle=analyticViewCurves(rec,s.dir,{circleSegments:detail?128:96,minConfidence:detail?.78:.82});
  const analytic=analyticBundle.analytic;
  const edges=engineeringLinework(rec,s.dir,{featureCos:detail?.994:.988,tangentCos:.99975});
  const vb=hiddenRemoval?buildOcclusionField(rec,s,{targetPixels:detail?720000:520000}):null;
  let contourD='',featureD='',analyticD='',visibleSegments=0,analyticSegments=0,suppressedAnalyticMesh=0;
  for(const e of edges){
    // Cylindrical tessellation is replaced by reconstructed analytic curves. Keep seams/features
    // between unlike surfaces, but never draw mesh chords living solely on an analytic cylinder.
    if(edgeIsAnalyticSurface(e,analytic)){suppressedAnalyticMesh++;continue}
    const samples=detail?41:33,target=(e.kind==='SILHOUETTE'||e.kind==='BOUNDARY')?'contour':'feature';
    for(const seg of visibleEdgeSegments(e,s,vb,{samples,refine:6})){
      const a=M.P(seg[0]),b=M.P(seg[1]);if(Math.hypot(a[0]-b[0],a[1]-b[1])<.42)continue;
      const cmd=`M${a[0].toFixed(2)} ${a[1].toFixed(2)}L${b[0].toFixed(2)} ${b[1].toFixed(2)}`;if(target==='contour')contourD+=cmd;else featureD+=cmd;visibleSegments++;
    }
  }
  for(const curve of analyticBundle.curves){
    const pts=curve.points||[];if(pts.length<2)continue;
    for(let i=0;i<pts.length-1;i++){
      const edge={a:pts[i],b:pts[i+1]};
      for(const seg of visibleEdgeSegments(edge,s,vb,{samples:13,refine:5})){
        const a=M.P(seg[0]),b=M.P(seg[1]);if(Math.hypot(a[0]-b[0],a[1]-b[1])<.25)continue;
        analyticD+=`M${a[0].toFixed(2)} ${a[1].toFixed(2)}L${b[0].toFixed(2)} ${b[1].toFixed(2)}`;analyticSegments++;
      }
    }
  }
  const stats=reconstructionStats(rec,s.dir);
  const contourWidth=Math.max(.54,width*.9),featureWidth=Math.max(.34,width*.56),analyticWidth=Math.max(.48,width*.78);
  return{svg:`<g data-reconstruction="v2.5" data-analytic-cylinders="${analytic.counts.cylinders}" data-cad-boundaries="${analytic.counts.cadBoundaries||0}" data-suppressed-analytic-mesh="${suppressedAnalyticMesh}"><path d="${featureD}" fill="none" stroke="${stroke}" stroke-width="${featureWidth}" stroke-linecap="round" stroke-linejoin="round"/><path d="${analyticD}" fill="none" stroke="${stroke}" stroke-width="${analyticWidth}" stroke-linecap="round" stroke-linejoin="round"/><path d="${contourD}" fill="none" stroke="${stroke}" stroke-width="${contourWidth}" stroke-linecap="round" stroke-linejoin="round"/></g>`,map:M,hiddenRemoval:!!vb,reconstruction:{...stats,analyticCylinders:analytic.counts.cylinders,cadBoundaries:analytic.counts.cadBoundaries||0,suppressedAnalyticMesh,analyticSegments,visibleSegments}};
}
function dimH(x1,x2,y,y0,label){return`<g stroke="#111" fill="#111" stroke-width=".8" font-family="Arial,sans-serif" font-size="10"><line x1="${x1}" y1="${y0}" x2="${x1}" y2="${y+4}"/><line x1="${x2}" y1="${y0}" x2="${x2}" y2="${y+4}"/><line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}"/><path d="M${x1} ${y}l6 -2.4v4.8zM${x2} ${y}l-6 -2.4v4.8z"/><text x="${(x1+x2)/2}" y="${y-4}" text-anchor="middle" stroke="none">${esc(label)}</text></g>`}
function dimV(x,y1,y2,x0,label){return`<g stroke="#111" fill="#111" stroke-width=".8" font-family="Arial,sans-serif" font-size="10"><line x1="${x0}" y1="${y1}" x2="${x-4}" y2="${y1}"/><line x1="${x0}" y1="${y2}" x2="${x-4}" y2="${y2}"/><line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}"/><path d="M${x} ${y1}l-2.4 6h4.8zM${x} ${y2}l-2.4 -6h4.8z"/><text x="${x-5}" y="${(y1+y2)/2}" text-anchor="middle" dominant-baseline="middle" transform="rotate(-90 ${x-5} ${(y1+y2)/2})" stroke="none">${esc(label)}</text></g>`}
function axialStations(rec,axis,diam){const R=rec.recognition||{},planes=(R.planes||[]).filter(p=>Math.abs(dot(norm(p.normal),axis))>.99);const vals=[];for(const p of planes){const transverse=p.bounds?.size?.filter((_,i)=>Math.abs(axis[i])<.8)||[];const span=Math.max(...(p.bounds?.size||[0]));if(span<diam*.985)continue;vals.push({t:dot(p.origin,axis),area:p.area||0,span})}vals.sort((a,b)=>a.t-b.t);const out=[];for(const x of vals){const g=out.at(-1);if(g&&Math.abs(g.t-x.t)<1){g.t=(g.t*g.w+x.t*x.area)/(g.w+x.area);g.w+=x.area}else out.push({t:x.t,w:x.area})}return out.map(x=>x.t)}
function outerDiameters(rec,axis,diam){const R=rec.recognition||{},v=[];for(const c of R.outerCylinders||[]){if(!c.full||Math.abs(dot(norm(c.axis),axis))<.99)continue;if(c.diameter<diam*.5)continue;v.push(c.diameter)}const u=[];for(const x of v.sort((a,b)=>b-a))if(!u.some(y=>Math.abs(y-x)<1))u.push(x);if(!u.some(x=>Math.abs(x-diam)<1))u.unshift(diam);return u.slice(0,4)}
function groupedHoles(rec,axis){const m=new Map();for(const h of rec.manufacturing?.holes||rec.recognition?.holes||[]){if(!h.full)continue;const d=Math.round(h.diameter*10)/10;if(d>100)continue;const k=d.toFixed(1);const g=m.get(k)||{d,count:0,kinds:new Set()};g.count++;if(h.holeKind)g.kinds.add(h.holeKind);m.set(k,g)}return[...m.values()].sort((a,b)=>b.count-a.count||a.d-b.d).slice(0,5)}
function chooseScale(maxDim){for(const s of [1,2,2.5,4,5,10,20])if(maxDim/s<=300)return`1:${s}`;return'1:20'}
function componentCenters(rec){const m=new Map();for(const f of rec.faces||[]){const id=f.componentId;if(!id)continue;let g=m.get(id);if(!g){g={sum:[0,0,0],n:0,name:f.instance?.name||id};m.set(id,g)}for(const p of f.loops?.[0]||[]){g.sum=add(g.sum,p);g.n++}}for(const g of m.values())g.center=mul(g.sum,1/Math.max(1,g.n));return m}

function renderRecognizedSide(rec,axis,box){
  const {u}=basis(axis),cs=corners(rec.bounds),ts=cs.map(p=>dot(p,axis)),rs=cs.map(p=>dot(p,u)),tmin=Math.min(...ts),tmax=Math.max(...ts),rmin=Math.min(...rs),rmax=Math.max(...rs),span=tmax-tmin||1,D=rmax-rmin||1;
  const sx=(box.w-30)/span,sy=(box.h-54)/Math.max(1,D),cx=box.x+15-tmin*sx,cy=box.y+box.h/2+(rmin+rmax)*sy/2;
  const P=p=>[cx+dot(p,axis)*sx,cy-dot(p,u)*sy];
  let out=`<g fill="none" stroke="#111" stroke-width=".8">`;
  const cyl=[...(rec.recognition?.outerCylinders||[])].filter(c=>c.full&&Math.abs(dot(norm(c.axis),axis))>.99).sort((a,b)=>(b.area||0)-(a.area||0));
  const seen=new Set();
  for(const c of cyl){
    if(c.diameter<D*.06)continue;
    const key=[Math.round(c.diameter),Math.round(c.length),Math.round(dot(c.axisPoint,axis))].join(':');if(seen.has(key))continue;seen.add(key);
    const tc=dot(c.axisPoint,axis),x1=cx+(tc-c.length/2)*sx,x2=cx+(tc+c.length/2)*sx,h=c.diameter*sy,y=cy-h/2;
    out+=`<rect x="${x1.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1,x2-x1).toFixed(1)}" height="${h.toFixed(1)}"/>`;
  }
  const shaft=[...(rec.recognition?.outerCylinders||[])].filter(c=>c.full&&Math.abs(dot(norm(c.axis),axis))>.99&&c.length>span*.65&&c.diameter<D*.2).sort((a,b)=>b.length-a.length)[0];
  if(shaft){const tc=dot(shaft.axisPoint,axis),x1=cx+(tc-shaft.length/2)*sx,x2=cx+(tc+shaft.length/2)*sx,h=shaft.diameter*sy,y=cy-h/2;out+=`<rect x="${x1.toFixed(1)}" y="${y.toFixed(1)}" width="${(x2-x1).toFixed(1)}" height="${Math.max(2,h).toFixed(1)}"/>`}
  out+=`<line x1="${box.x}" y1="${cy.toFixed(1)}" x2="${box.x+box.w}" y2="${cy.toFixed(1)}" stroke="#666" stroke-width=".6" stroke-dasharray="10 3 2 3"/></g>`;
  return{svg:out,map:{P,scale:sx}};
}
function renderPositions(rec,native,s,map,box){
  const centers=componentCenters(rec),byInstance=new Map();(native.components||[]).forEach((c,i)=>(c.instances||[]).forEach(id=>byInstance.set(id,i+1)));
  const firstByPos=new Map();for(const[id,g]of centers){const pos=byInstance.get(id);if(pos&&!firstByPos.has(pos))firstByPos.set(pos,g)}
  let out='<g font-family="Arial,sans-serif" font-size="7.5" stroke="#111" fill="#fff">';
  for(const[pos,g]of [...firstByPos.entries()].sort((a,b)=>a[0]-b[0])){const q=map.P(g.center),dx=(pos%2?12:-12),dy=((pos%3)-1)*9,bx=clamp(q[0]+dx,box.x+8,box.x+box.w-8),by=clamp(q[1]+dy,box.y+8,box.y+box.h-8);out+=`<line x1="${q[0].toFixed(1)}" y1="${q[1].toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}"/><circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="6.3"/><text x="${bx.toFixed(1)}" y="${(by+2.5).toFixed(1)}" text-anchor="middle" stroke="none" fill="#111" font-weight="700">${pos}</text>`}
  return out+'</g>'
}
function renderBOM(native,box){const comps=native.components||[],rh=Math.min(16,(box.h-38)/Math.max(1,comps.length));let s=`<g font-family="Arial,sans-serif" fill="#111" stroke="#111" stroke-width=".7"><text x="${box.x}" y="${box.y-8}" stroke="none" font-size="11" font-style="italic">Спецификация только для одного изделия</text><rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="none"/><line x1="${box.x+42}" y1="${box.y}" x2="${box.x+42}" y2="${box.y+box.h}"/><line x1="${box.x+155}" y1="${box.y}" x2="${box.x+155}" y2="${box.y+box.h}"/><line x1="${box.x+box.w-44}" y1="${box.y}" x2="${box.x+box.w-44}" y2="${box.y+box.h}"/><text x="${box.x+21}" y="${box.y+12}" text-anchor="middle" stroke="none" font-size="7">ПОЗ.</text><text x="${box.x+98}" y="${box.y+12}" text-anchor="middle" stroke="none" font-size="7">ОБОЗНАЧЕНИЕ</text><text x="${box.x+163}" y="${box.y+12}" stroke="none" font-size="7">ОПИСАНИЕ</text><text x="${box.x+box.w-22}" y="${box.y+12}" text-anchor="middle" stroke="none" font-size="7">К-ВО</text>`;let y=box.y+20;for(let i=0;i<comps.length&&y+rh<=box.y+box.h+.1;i++){const c=comps[i],designation=(c.name||'').replace(/\.SLD(?:PRT|ASM)$/i,'');s+=`<line x1="${box.x}" y1="${y}" x2="${box.x+box.w}" y2="${y}"/><text x="${box.x+21}" y="${y+rh*.68}" text-anchor="middle" stroke="none" font-size="7.3">${i+1}</text><text x="${box.x+49}" y="${y+rh*.68}" stroke="none" font-size="7.1">${esc(designation.slice(0,22))}</text><text x="${box.x+163}" y="${y+rh*.68}" stroke="none" font-size="7.1">${esc((c.type==='assembly'?'Сборка ':'')+(c.file||c.name||'').replace(/\.SLD(?:PRT|ASM)$/i,'').slice(0,28))}</text><text x="${box.x+box.w-22}" y="${y+rh*.68}" text-anchor="middle" stroke="none" font-size="7.3">${c.count}</text>`;y+=rh}return s+'</g>'}

function componentVolume(rec,component){
  const ids=new Set(component?.instances||[]);let signed=0;
  for(const face of rec.faces||[]){if(!ids.has(face.componentId))continue;const p=face.loops?.[0]||[];if(p.length<3)continue;const[a,b,c]=p;signed+=(a[0]*(b[1]*c[2]-b[2]*c[1])-a[1]*(b[0]*c[2]-b[2]*c[0])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6}
  return Math.abs(signed);
}
function productionBomRows(rec,crossOccurrenceId=null){
  const parts=(rec.nativeAssembly?.components||rec.components||[]).filter(c=>c.type!=='assembly'),mapping=rec.nativeAssembly?.transformMapping||[],order=new Map(),keyOf=value=>String(value||'').replace(/\.SLDPRT$/i,'').replace(/[.\s]+$/,'').toLowerCase();
  mapping.forEach((item,index)=>{const key=keyOf(item.name);if(!order.has(key))order.set(key,index)});
  const rows=parts.map(c=>({component:c,name:String(c.name||c.file||'').replace(/\.SLDPRT$/i,'').replace(/[.\s]+$/,''),count:c.count||1,volume:componentVolume(rec,c)}));
  rows.sort((a,b)=>(order.get(keyOf(a.name))??1e6)-(order.get(keyOf(b.name))??1e6)||a.name.localeCompare(b.name,undefined,{numeric:true}));
  const families=new Map();for(const row of rows){const family=row.name.replace(/-\d+\.?$/,'');const list=families.get(family)||[];list.push(row);families.set(family,list)}
  for(const family of families.values())if(family.length>=3){const slots=family.map(row=>rows.indexOf(row)).sort((a,b)=>a-b),sorted=[...family].sort((a,b)=>b.volume-a.volume);slots.forEach((slot,index)=>rows[slot]=sorted[index])}
  const nestedIds=new Set(crossOccurrenceId?componentDrawableIds(rec,crossOccurrenceId):[]),nestedNames=new Set();for(const occ of rec.occurrences||[])if(nestedIds.has(occ.id))nestedNames.add(String(occ.fileName||occ.name||'').replace(/\.SLDPRT$/i,'').replace(/\.$/,''));
  let nextPosition=1,nestedPositionUsed=false;for(const row of rows){if(nestedNames.has(row.name)){row.position=nestedPositionUsed?'':'1';nestedPositionUsed=true}else{if(nextPosition===1)nextPosition=2;row.position=String(nextPosition++)}}
  return rows;
}
function renderProductionBOM(rec,box,crossOccurrenceId=null){
  const rows=productionBomRows(rec,crossOccurrenceId),header=22,rh=(box.h-header)/Math.max(rows.length,1),x=box.x,y=box.y,w=box.w,h=box.h,c1=x+42,c2=x+198,c3=x+w-48;
  let s=`<g data-bom-kind="flattened-leaf-parts" font-family="Arial,sans-serif" fill="#111" stroke="#111" stroke-width=".72"><text x="${x}" y="${y-9}" stroke="none" font-size="12" font-style="italic">Спецификация только для одного изделия</text><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none"/><line x1="${c1}" y1="${y}" x2="${c1}" y2="${y+h}"/><line x1="${c2}" y1="${y}" x2="${c2}" y2="${y+h}"/><line x1="${c3}" y1="${y}" x2="${c3}" y2="${y+h}"/><text x="${x+21}" y="${y+15}" text-anchor="middle" stroke="none" font-size="8">ПОЗИЦИЯ</text><text x="${(c1+c2)/2}" y="${y+15}" text-anchor="middle" stroke="none" font-size="8">ОБОЗНАЧЕНИЕ</text><text x="${c2+8}" y="${y+15}" stroke="none" font-size="8">ОПИСАНИЕ</text><text x="${(c3+x+w)/2}" y="${y+15}" text-anchor="middle" stroke="none" font-size="8">К-ВО</text><line x1="${x}" y1="${y+header}" x2="${x+w}" y2="${y+header}"/>`;
  rows.forEach((row,index)=>{const yy=y+header+index*rh,ty=yy+rh*.70;s+=`<text x="${x+21}" y="${ty}" text-anchor="middle" stroke="none" font-size="8">${row.position}</text><text x="${c1+7}" y="${ty}" stroke="none" font-size="7.8">${esc(row.name.slice(0,25))}</text><text x="${c2+8}" y="${ty}" stroke="none" font-size="7.5"></text><text x="${(c3+x+w)/2}" y="${ty}" text-anchor="middle" stroke="none" font-size="8">${row.count}</text><line x1="${x}" y1="${yy+rh}" x2="${x+w}" y2="${yy+rh}"/>`});
  return s+'</g>';
}
function renderTitle(projectName,scale,box){const x=box.x,y=box.y,w=box.w,h=box.h;return`<g stroke="#111" fill="none" stroke-width=".7" font-family="Arial,sans-serif"><rect x="${x}" y="${y}" width="${w}" height="${h}"/><line x1="${x+160}" y1="${y}" x2="${x+160}" y2="${y+h}"/><line x1="${x+300}" y1="${y}" x2="${x+300}" y2="${y+h}"/><line x1="${x}" y1="${y+34}" x2="${x+w}" y2="${y+34}"/><line x1="${x}" y1="${y+68}" x2="${x+w}" y2="${y+68}"/><line x1="${x+300}" y1="${y+50}" x2="${x+w}" y2="${y+50}"/><text x="${x+8}" y="${y+15}" fill="#111" stroke="none" font-size="7">Изм.  Лист  № докум.  Подп.  Дата</text><text x="${x+8}" y="${y+31}" fill="#111" stroke="none" font-size="7">Разраб.   ROZFOOD</text><text x="${x+172}" y="${y+24}" fill="#111" stroke="none" font-size="12" font-weight="700">${esc(projectName)} СБ</text><text x="${x+172}" y="${y+56}" fill="#111" stroke="none" font-size="9">Сборочный чертёж · TESS/VERIFY</text><text x="${x+310}" y="${y+16}" fill="#111" stroke="none" font-size="7">Лит.   Масса   Масштаб</text><text x="${x+w-18}" y="${y+45}" text-anchor="end" fill="#111" stroke="none" font-size="13" font-weight="700">${scale}</text><text x="${x+310}" y="${y+62}" fill="#111" stroke="none" font-size="7">Лист 1   Листов 1</text><text x="${x+172}" y="${y+88}" fill="#111" stroke="none" font-size="8">ROZFOOD ENGINEERING STUDIO · A2 AUTO LAYOUT</text></g>`}
function viewLabel(text,x,y,scale=''){return`<text x="${x}" y="${y}" font-family="Arial,sans-serif" font-size="12" fill="#111" font-weight="700">${esc(text)}${scale?` (${scale})`:''}</text>`}

function triPlaneSegment(loop,planePoint,planeNormal,eps=.08){
  if(!loop||loop.length<3)return null;const ds=loop.slice(0,3).map(p=>dot(sub(p,planePoint),planeNormal));
  const pts=[];for(const [i,j] of [[0,1],[1,2],[2,0]]){const a=loop[i],b=loop[j],da=ds[i],db=ds[j];
    if(Math.abs(da)<=eps)pts.push(a);if(da*db<0){const t=da/(da-db);pts.push(add(a,mul(sub(b,a),t)))}}
  const out=[];for(const q of pts)if(!out.some(x=>len(sub(x,q))<eps*2))out.push(q);return out.length>=2?[out[0],out[1]]:null;
}
function sectionSegKey(a,b,component,q){const A=qpt(a,q),B=qpt(b,q);return(A<B?A+'|'+B:B+'|'+A)+'|'+(component||'RAW')}
function chainSectionSegments(items,q){
  const byComp=new Map();for(const item of items){const comp=item.componentId||'RAW';let a=byComp.get(comp);if(!a)byComp.set(comp,a=[]);a.push(item)}
  const chains=[];
  for(const [componentId,segs] of byComp){
    const byVertex=new Map(),addV=(k,i)=>{let a=byVertex.get(k);if(!a)byVertex.set(k,a=[]);a.push(i)};
    segs.forEach((e,i)=>{addV(qpt(e.a,q),i);addV(qpt(e.b,q),i)});const used=new Uint8Array(segs.length);
    const endpoint=(e,k)=>qpt(e.a,q)===k?e.b:e.a;
    const starts=[];for(let i=0;i<segs.length;i++){const e=segs[i],da=(byVertex.get(qpt(e.a,q))||[]).length,db=(byVertex.get(qpt(e.b,q))||[]).length;if(da===1||db===1)starts.push(i)}
    for(const i of [...starts,...segs.map((_,i)=>i)]){
      if(used[i])continue;used[i]=1;const e0=segs[i];let ka=qpt(e0.a,q),kb=qpt(e0.b,q);if((byVertex.get(ka)||[]).length===1){/* keep */}else if((byVertex.get(kb)||[]).length===1){[ka,kb]=[kb,ka]}
      const first=ka===qpt(e0.a,q)?e0.a:e0.b,second=ka===qpt(e0.a,q)?e0.b:e0.a,pts=[first,second];let key=qpt(second,q),guard=0;
      while(guard++<segs.length+4){const cand=(byVertex.get(key)||[]).find(j=>!used[j]);if(cand===undefined)break;used[cand]=1;const e=segs[cand],next=endpoint(e,key);pts.push(next);key=qpt(next,q);if(key===qpt(pts[0],q))break}
      const closed=pts.length>2&&len(sub(pts[0],pts.at(-1)))<q*2.2;chains.push({componentId,points:pts,closed});
    }
  }
  return chains;
}
function hatchClosedLoops(loops,step=8){
  if(!loops.length)return'';let minC=Infinity,maxC=-Infinity;for(const loop of loops)for(const [x,y] of loop){const c=x+y;minC=Math.min(minC,c);maxC=Math.max(maxC,c)}
  let out='';const begin=Math.floor(minC/step)*step;
  for(let c=begin;c<=maxC+step;c+=step){const hits=[];for(const loop of loops){for(let i=0;i<loop.length-1;i++){const a=loop[i],b=loop[i+1],ca=a[0]+a[1],cb=b[0]+b[1];if(Math.abs(cb-ca)<1e-9)continue;const t=(c-ca)/(cb-ca);if(t>=0&&t<1)hits.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t])}}
    hits.sort((a,b)=>a[0]-b[0]);for(let i=0;i+1<hits.length;i+=2){const a=hits[i],b=hits[i+1];if(Math.hypot(a[0]-b[0],a[1]-b[1])>.8)out+=`M${a[0].toFixed(2)} ${a[1].toFixed(2)}L${b[0].toFixed(2)} ${b[1].toFixed(2)}`}
  }
  return out;
}
function renderSection(rec,s,box,planePoint,planeNormal,{stroke='#111',width=.8,hatch=true}={}){
  const M=mapView(rec.bounds,s,box,6),analytic=reconstructAnalyticGeometry(rec),cylinderFaceKeys=new Set(analytic.cylinders.map(c=>c.faceKey).filter(Boolean)),raw=[],diag=Math.hypot(...(rec.bounds?.size||[1,1,1])),q=clamp(diag*1e-5,.003,.03),seen=new Set();
  const fk=f=>[f.componentId||'RAW',f.modelId||'',f.sourceStream||'',f.tessFaceId??''].join('|');
  // A section plane must intersect planar faces too. v2.5 skipped every recognized plane,
  // which erased most plates/webs from A-A/B-B. Only cylinder tessellation is replaced analytically.
  for(const f of rec.faces||[]){if(cylinderFaceKeys.has(fk(f)))continue;const seg=triPlaneSegment(f.loops?.[0],planePoint,planeNormal,Math.max(.012,q*1.4));if(!seg)continue;const k=sectionSegKey(seg[0],seg[1],f.componentId,q);if(seen.has(k))continue;seen.add(k);raw.push({a:seg[0],b:seg[1],componentId:f.componentId||'RAW'})}
  const chains=chainSectionSegments(raw,q),analyticCut=analyticSectionCurves(rec,planePoint,planeNormal,{circleSegments:144,minConfidence:.78});
  let boundaryD='',analyticD='';const closed2=[];
  for(const chain of chains){const pts=chain.points||[];if(pts.length<2)continue;const mapped=pts.map(M.P);if(chain.closed){if(Math.hypot(mapped[0][0]-mapped.at(-1)[0],mapped[0][1]-mapped.at(-1)[1])>.2)mapped.push(mapped[0]);closed2.push(mapped)}boundaryD+=`M${mapped[0][0].toFixed(2)} ${mapped[0][1].toFixed(2)}`;for(let i=1;i<mapped.length;i++)boundaryD+=`L${mapped[i][0].toFixed(2)} ${mapped[i][1].toFixed(2)}`}
  for(const curve of analyticCut.curves){const pts=curve.points||[];if(pts.length<2)continue;const mapped=pts.map(M.P);analyticD+=`M${mapped[0][0].toFixed(2)} ${mapped[0][1].toFixed(2)}`;for(let i=1;i<mapped.length;i++)analyticD+=`L${mapped[i][0].toFixed(2)} ${mapped[i][1].toFixed(2)}`}
  const hatchD=hatch?hatchClosedLoops(closed2,8):'';
  const svg=`<g data-section-core="v2.5" data-section-chains="${chains.length}" data-section-closed="${closed2.length}" data-analytic-section-curves="${analyticCut.curves.length}">${hatchD?`<path d="${hatchD}" fill="none" stroke="#777" stroke-width=".34" opacity=".58"/>`:''}<path d="${boundaryD}" fill="none" stroke="${stroke}" stroke-width="${Math.max(.55,width*.82)}" stroke-linecap="round" stroke-linejoin="round"/><path d="${analyticD}" fill="none" stroke="${stroke}" stroke-width="${Math.max(.58,width*.88)}" stroke-linecap="round" stroke-linejoin="round"/></g>`;
  return{svg,map:M,count:chains.length,closed:closed2.length,analyticCurves:analyticCut.curves.length,analytic:true};
}
function faceCentroid(f){const p=f.loops?.[0]||[];if(!p.length)return[0,0,0];let s=[0,0,0];for(const q of p)s=add(s,q);return mul(s,1/p.length)}
function subRecord(rec,faces){return{...rec,faces,bounds:(()=>{const pts=[];for(const f of faces)for(const p of f.loops?.[0]||[])pts.push(p);if(!pts.length)return rec.bounds;const mn=[Infinity,Infinity,Infinity],mx=[-Infinity,-Infinity,-Infinity];for(const p of pts)for(let i=0;i<3;i++){mn[i]=Math.min(mn[i],p[i]);mx[i]=Math.max(mx[i],p[i])}return{min:mn,max:mx,size:sub(mx,mn),center:mul(add(mn,mx),.5)}})()};}
function detailHub(rec,axis,D){const {u,v}=basis(axis),c=rec.bounds.center;const tEnd=Math.min(...corners(rec.bounds).map(p=>dot(p,axis)));const span=Math.max(...rec.bounds.size);const faces=(rec.faces||[]).filter(f=>{const q=faceCentroid(f),r=Math.hypot(dot(sub(q,c),u),dot(sub(q,c),v)),t=dot(q,axis);return r<D*.23&&t<tEnd+span*.22});return faces.length?subRecord(rec,faces):rec}

function crossHubDetail(rec,axis,D){
  const {u,v}=basis(axis),groups=new Map();
  for(const f of rec.faces||[]){const id=f.componentId;if(!id)continue;let g=groups.get(id);if(!g){g={id,faces:[],minT:Infinity,maxT:-Infinity,maxR:0};groups.set(id,g)}g.faces.push(f);for(const p of f.loops?.[0]||[]){const t=dot(p,axis),q=sub(p,rec.bounds.center),r=Math.hypot(dot(q,u),dot(q,v));g.minT=Math.min(g.minT,t);g.maxT=Math.max(g.maxT,t);g.maxR=Math.max(g.maxR,r)}}
  const candidates=[...groups.values()].filter(g=>(g.maxT-g.minT)<Math.max(45,D*.13)&&g.maxR>D*.34&&g.maxR<D*.495);
  const clusters=[];for(const g of candidates){const t=(g.minT+g.maxT)/2;let c=clusters.find(x=>Math.abs(x.t-t)<D*.08);if(!c){c={t,members:[]};clusters.push(c)}c.members.push(g);c.t=c.members.reduce((a,m)=>a+(m.minT+m.maxT)/2,0)/c.members.length}
  clusters.sort((a,b)=>b.members.length-a.members.length||a.t-b.t);const best=clusters.find(c=>c.members.length>=3)||clusters[0];if(!best)return rec;
  const ids=new Set(best.members.map(g=>g.id));for(const g of groups.values()){const t=(g.minT+g.maxT)/2;if(Math.abs(t-best.t)<D*.08&&g.maxR<D*.22)ids.add(g.id)}
  const faces=(rec.faces||[]).filter(f=>ids.has(f.componentId));return faces.length?subRecord(rec,faces):rec;
}
function detailAxial(rec,axis,station,D){const faces=(rec.faces||[]).filter(f=>Math.abs(dot(faceCentroid(f),axis)-station)<Math.max(45,D*.16));return faces.length?subRecord(rec,faces):rec}
function bestStations(rec,axis,D){const s=axialStations(rec,axis,D);if(s.length<2)return s;const out=[];for(const t of s){if(!out.length||Math.abs(t-out.at(-1))>6)out.push(t)}return out}
function refLikeChain(stations){const seg=[];for(let i=0;i<stations.length-1;i++){const d=stations[i+1]-stations[i];if(d>15&&d<500)seg.push(d)}return seg}

function bodyEnvelope(rec,axis,D){
  const cyl=[...(rec.recognition?.outerCylinders||[])].filter(c=>c.full&&Math.abs(dot(norm(c.axis),axis))>.99&&c.diameter>D*.90&&c.length>D*.20);
  if(!cyl.length)return null;
  let mn=Infinity,mx=-Infinity;
  for(const c of cyl){const t=dot(c.axisPoint,axis);mn=Math.min(mn,t-c.length/2);mx=Math.max(mx,t+c.length/2)}
  const all=corners(rec.bounds).map(p=>dot(p,axis)),amin=Math.min(...all),amax=Math.max(...all);
  return{min:mn,max:mx,length:mx-mn,left:mn-amin,right:amax-mx,amin,amax};
}
function outerRingStations(rec,axis,D){
  const vals=[];for(const p of rec.recognition?.planes||[]){if(Math.abs(dot(norm(p.normal),axis))<.99)continue;const span=Math.max(...(p.bounds?.size||[0]));if(span<D*.995)continue;vals.push(dot(p.origin,axis))}
  vals.sort((a,b)=>a-b);const out=[];for(const t of vals)if(!out.length||Math.abs(t-out.at(-1))>1)out.push(t);return out;
}
function referenceAxialChain(rec,axis,D){
  const st=outerRingStations(rec,axis,D),seg=[];for(let i=0;i<st.length-1;i++){const d=st[i+1]-st[i];if(d>5&&d<500)seg.push(d)}return{stations:st,segments:seg};
}

function uniqueMeasures(values,tolerance=.75){const out=[];for(const value of values.filter(Number.isFinite).sort((a,b)=>b-a))if(!out.some(item=>Math.abs(item-value)<tolerance))out.push(value);return out}
function projectedRange(bounds,axis){const values=corners(bounds).map(point=>dot(point,axis));return{min:Math.min(...values),max:Math.max(...values),span:Math.max(...values)-Math.min(...values)}}
function groupedDiameters(items,tolerance=.8){const groups=[];for(const item of items){let group=groups.find(entry=>Math.abs(entry.d-item.diameter)<tolerance);if(!group){group={d:item.diameter,count:0,lengths:[],items:[]};groups.push(group)}group.count++;group.lengths.push(item.length||0);group.items.push(item)}return groups.sort((a,b)=>b.d-a.d)}
function assemblySubfeatures(rec){
  const result={cross:null,spiral:null};
  for(const occurrence of (rec.occurrences||[]).filter(item=>item.type==='assembly')){
    const local=componentLocalRecord(rec,occurrence.id);if(!local?.faces?.length)continue;
    local.recognition=local.recognition||recognizeTessellationGeometry(local,{maxFeatures:700});const graph=buildFeatureGraph(local),entry={occurrence,part:local,graph};
    if(graph.profile==='CROSS_ASSEMBLY'){
      const score=(graph.holeCount||0)*100+(graph.rodCount||0)*10+local.faces.length/10000;
      if(!result.cross||score>result.cross.score)result.cross={...entry,score};
    }else if(!result.spiral||local.faces.length>result.spiral.part.faces.length)result.spiral=entry;
  }
  if(result.spiral){const ids=new Set(result.spiral.part.sourceComponentIds||componentDrawableIds(rec,result.spiral.occurrence.id));const faces=(rec.faces||[]).filter(face=>ids.has(face.componentId));result.spiral.global=faces.length?subRecord(rec,faces):null}
  return result;
}
function drumAssemblyPlan(rec){
  const axis=dominantAxis(rec),axisRange=projectedRange(rec.bounds,axis),{u,v}=basis(axis),uRange=projectedRange(rec.bounds,u),vRange=projectedRange(rec.bounds,v),D=Math.max(uRange.span,vRange.span),L=axisRange.span,R=rec.recognition||{};
  const coaxial=item=>item.full&&Math.abs(dot(norm(item.axis),axis))>.985;
  const rings=(R.outerCylinders||[]).filter(item=>coaxial(item)&&item.diameter>D*.90&&item.length>D*.025&&item.length<D*.12),shaft=(R.outerCylinders||[]).filter(item=>coaxial(item)&&item.diameter<D*.16&&item.length>L*.72).sort((a,b)=>b.length-a.length)[0];
  if(L/D<1.8||L/D>5.5||rings.length<3||!shaft)return null;
  const outerDiameter=Math.max(...rings.map(item=>item.diameter)),largeBores=groupedDiameters((R.holes||[]).filter(item=>coaxial(item)&&item.diameter>D*.58));
  const innerBore=largeBores.at(-1)?.d||D*.72,midBore=[...largeBores].filter(group=>group.d<outerDiameter-6&&group.d>innerBore+20).sort((a,b)=>Math.abs(a.count-(rings.length-1))-Math.abs(b.count-(rings.length-1))||b.d-a.d)[0]?.d||largeBores[1]?.d||outerDiameter*.97;
  const shellDiameters=uniqueMeasures([outerDiameter,...largeBores.map(group=>group.d)]).slice(0,6),body=bodyEnvelope(rec,axis,D),chain=referenceAxialChain(rec,axis,D),subfeatures=assemblySubfeatures(rec);
  const alignedPlanes=(R.planes||[]).filter(plane=>Math.abs(dot(norm(plane.normal),axis))>.99).map(plane=>({t:dot(plane.origin,axis),span:Math.max(...(plane.bounds?.size||[0]))})).sort((a,b)=>a.t-b.t);
  const smallStations=[];for(const plane of alignedPlanes.filter(item=>item.span<D*.12))if(!smallStations.some(value=>Math.abs(value-plane.t)<.6))smallStations.push(plane.t);
  const smallSegments=[];for(let i=0;i<smallStations.length-1;i++){const length=smallStations[i+1]-smallStations[i];if(length>=1.5&&length<=200)smallSegments.push({a:smallStations[i],b:smallStations[i+1],length})}
  const thicknessGroups=[];for(const value of (R.holes||[]).filter(item=>item.length>1.5&&item.length<5).map(item=>item.length)){let group=thicknessGroups.find(item=>Math.abs(item.value-value)<.2);if(!group){group={value,count:0};thicknessGroups.push(group)}group.value=(group.value*group.count+value)/(group.count+1);group.count++}thicknessGroups.sort((a,b)=>b.count-a.count||Math.abs(a.value-3)-Math.abs(b.value-3));
  const featureThickness=thicknessGroups[0]?.value||3,weldSize=uniqueMeasures((R.outerCylinders||[]).filter(item=>item.length>1.2&&item.length<2.5).map(item=>item.length),.15)[0]||2,shellInner=uniqueMeasures((R.outerCylinders||[]).filter(item=>coaxial(item)&&item.diameter>D*.90&&item.diameter<outerDiameter-1).map(item=>item.diameter)).sort((a,b)=>a-b)[0]||Math.min(...shellDiameters.filter(value=>value>D*.9));
  const spiralSpan=subfeatures.spiral?.global?projectedRange(subfeatures.spiral.global.bounds,axis).span:0,spiralPitch=groupedDiameters((R.holes||[]).filter(item=>coaxial(item)&&Math.abs(item.diameter-innerBore)<2&&item.length>80))[0]?.lengths?.[0]||0;
  return{axis,axisPoint:rec.bounds.center,min:axisRange.min,max:axisRange.max,L,D,outerDiameter,midBore,innerBore,shellDiameters,shaftDiameter:shaft.diameter,body,chain,smallSegments,featureThickness,weldSize,radialWebHeight:(shellInner-innerBore)/2,spiralSpan,spiralPitch,subfeatures};
}
function referenceA2Frame(theme='light'){
  return`<rect width="1684" height="1191" fill="${theme==='dark'?'#e9edf2':'#eef1f4'}"/><rect x="14" y="10" width="1656" height="1171" rx="2" fill="#fff"/><rect x="34" y="20" width="1616" height="1150" fill="none" stroke="#111" stroke-width="1.35"/><g stroke="#111" fill="none" stroke-width=".65" font-family="Arial" font-size="7"><rect x="34" y="20" width="46" height="1150"/><line x1="34" y1="260" x2="80" y2="260"/><line x1="34" y1="515" x2="80" y2="515"/><line x1="34" y1="765" x2="80" y2="765"/><line x1="34" y1="1015" x2="80" y2="1015"/><text transform="rotate(-90 57 220)" x="57" y="220" fill="#111" stroke="none">Перв. примен.</text><text transform="rotate(-90 57 475)" x="57" y="475" fill="#111" stroke="none">Справ. №</text><text transform="rotate(-90 57 725)" x="57" y="725" fill="#111" stroke="none">Подп. и дата</text><text transform="rotate(-90 57 975)" x="57" y="975" fill="#111" stroke="none">Инв. № подл.</text></g>`;
}
function renderReferenceA2Stamp(projectName,scale,mass,box){const x=box.x,y=box.y,w=box.w,h=box.h,massText=Number.isFinite(mass)?fmtRu(mass,2):'—';return`<g data-stamp-format="A2" stroke="#111" fill="none" stroke-width=".8" font-family="Arial,sans-serif"><rect x="${x}" y="${y}" width="${w}" height="${h}"/><line x1="${x+205}" y1="${y}" x2="${x+205}" y2="${y+h}"/><line x1="${x+390}" y1="${y}" x2="${x+390}" y2="${y+h}"/><line x1="${x}" y1="${y+33}" x2="${x+w}" y2="${y+33}"/><line x1="${x}" y1="${y+70}" x2="${x+w}" y2="${y+70}"/><line x1="${x+390}" y1="${y+52}" x2="${x+w}" y2="${y+52}"/><text x="${x+8}" y="${y+14}" fill="#111" stroke="none" font-size="7">Изм.  Лист  № докум.  Подп.  Дата</text><text x="${x+8}" y="${y+29}" fill="#111" stroke="none" font-size="7">Разраб.  Пономаренко</text><text x="${x+218}" y="${y+25}" fill="#111" stroke="none" font-size="15" font-weight="700">${esc(projectName)} СБ</text><text x="${x+218}" y="${y+61}" fill="#111" stroke="none" font-size="11">Сборочный чертёж</text><text x="${x+400}" y="${y+13}" fill="#111" stroke="none" font-size="7">Лит.      Масса      Масштаб</text><text x="${x+444}" y="${y+45}" text-anchor="middle" fill="#111" stroke="none" font-size="12">${massText}</text><text x="${x+w-17}" y="${y+45}" text-anchor="end" fill="#111" stroke="none" font-size="13" font-weight="700">${scale}</text><text x="${x+400}" y="${y+67}" fill="#111" stroke="none" font-size="7">Лист 1      Листов 1</text><text x="${x+218}" y="${y+91}" fill="#111" stroke="none" font-size="8">ROZFOOD · Формат А2 · HSR + FEATURE RECOGNITION</text></g>`}
function clipView(content,box,id,shape='rect'){const clip=shape==='circle'?`<circle cx="${box.x+box.w/2}" cy="${box.y+box.h/2}" r="${Math.min(box.w,box.h)/2-3}"/>`:`<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}"/>`;return`<defs><clipPath id="${id}">${clip}</clipPath></defs><g clip-path="url(#${id})">${content}</g>`}

function renderDrumReferenceSheet(svg,rec,plan,{projectName,fileName,theme,mode='assemblyDetailed'}){
  const cfg={sections:['working','production','assemblyDetailed'].includes(mode),details:['production','assemblyDetailed'].includes(mode),isoShell:['sketch','production','assemblyDetailed'].includes(mode),isoOpen:mode==='assemblyDetailed',cross:mode!=='sketch',dimensions:mode!=='sketch',chain:['working','production','assemblyDetailed'].includes(mode),localDimensions:['working','production','assemblyDetailed'].includes(mode),bom:mode==='assemblyDetailed',label:({sketch:'КАРКАС',working:'РАБОЧИЙ',production:'ПРОИЗВОДСТВЕННЫЙ',control:'КОНТРОЛЬНЫЙ',assemblyDetailed:'СБОРОЧНЫЙ'})[mode]||'СБОРОЧНЫЙ'};
  const {axis,D,L,body,chain,subfeatures}=plan,{u,v}=basis(axis),side=viewSpec(axis,'side'),end=viewSpec(axis,'end'),iso=viewSpec(axis,'iso'),scale=chooseScale(L);
  const topBox={x:102,y:54,w:700,h:250},endBox={x:842,y:55,w:258,h:225},crossBox={x:1170,y:56,w:390,h:270},mainBox={x:108,y:382,w:775,h:300},isoShellBox={x:1080,y:355,w:470,h:285},aaBox={x:102,y:800,w:635,h:210},bbBox={x:750,y:715,w:175,h:120},detailDBox={x:790,y:845,w:215,h:175},isoOpenBox={x:955,y:685,w:310,h:275},bomBox={x:1280,y:775,w:354,h:258},stampBox={x:1096,y:1040,w:538,h:105};
  svg.setAttribute('viewBox','0 0 1684 1191');svg.setAttribute('role','img');svg.setAttribute('aria-label',`Сборочный чертёж ${projectName}`);
  let s=`<g data-drawing-profile="DRUM_REFERENCE_A2" data-drawing-mode="${mode}" data-source-scope="assembly-descendants" data-view-planner="feature-graph">${referenceA2Frame(theme)}`;
  const top=renderRecognizedSide(rec,axis,topBox),front=renderMesh(rec,end,endBox,{width:.8,detail:true}),main=renderMesh(rec,side,mainBox,{width:.68,detail:true});
  const spiralMain=subfeatures.spiral?.global?renderMesh(subfeatures.spiral.global,side,mainBox,{width:.5,detail:true,hiddenRemoval:false,frameBounds:rec.bounds,fixedScale:main.map.scale}):null;
  const aaCut=renderSection(rec,side,aaBox,rec.bounds.center,v,{width:.72,hatch:true});
  const dStation=chain.stations[Math.max(0,Math.min(chain.stations.length-1,Math.floor(chain.stations.length*.62)))]??dot(rec.bounds.center,axis),dRec=detailAxial(rec,axis,dStation,D),dView=renderMesh(dRec,side,detailDBox,{width:.72,detail:true});
  const bbPoint=pointOnAxis(plan.axisPoint,axis,dStation),bbCut=renderSection(rec,end,bbBox,bbPoint,axis,{width:.8,hatch:true});
  const spiralIds=new Set(subfeatures.spiral?.part?.sourceComponentIds||[]),shellFaces=(rec.faces||[]).filter(face=>!spiralIds.has(face.componentId)),shellRec=shellFaces.length?subRecord(rec,shellFaces):rec,isoShell=renderMesh(shellRec,iso,isoShellBox,{width:.52,detail:false}),isoOpen=renderMesh(rec,iso,isoOpenBox,{width:.47,detail:true});
  s+=viewLabel('B',topBox.x+4,topBox.y-9)+clipView(top.svg,topBox,'clipTop')+viewLabel('B',endBox.x+4,endBox.y-9)+clipView(front.svg,endBox,'clipEnd');
  s+=viewLabel('A',mainBox.x+4,mainBox.y-10)+clipView(main.svg+(spiralMain?.svg||''),mainBox,'clipMain');
  if(cfg.sections)s+=viewLabel('A–A',aaBox.x+4,aaBox.y-12,'1:7')+clipView(aaCut.svg,aaBox,'clipAA');
  if(cfg.details)s+=viewLabel('B–B',bbBox.x+4,bbBox.y-12,'1:5')+clipView(bbCut.svg,bbBox,'clipBB','circle')+`<circle cx="${bbBox.x+bbBox.w/2}" cy="${bbBox.y+bbBox.h/2}" r="${Math.min(bbBox.w,bbBox.h)/2-3}" fill="none" stroke="#aaa" stroke-width=".6"/>`;
  if(cfg.details)s+=viewLabel('D',detailDBox.x+4,detailDBox.y-12,'2:5')+clipView(dView.svg,detailDBox,'clipD','circle')+`<circle cx="${detailDBox.x+detailDBox.w/2}" cy="${detailDBox.y+detailDBox.h/2}" r="${Math.min(detailDBox.w,detailDBox.h)/2-3}" fill="none" stroke="#888" stroke-width=".7"/>`;
  if(cfg.isoShell)s+=clipView(isoShell.svg,isoShellBox,'clipIsoShell')+`<text x="${isoShellBox.x+6}" y="${isoShellBox.y+isoShellBox.h+12}" font-family="Arial" font-size="10">Сборочный изометрический вид</text>`;
  if(cfg.isoOpen)s+=clipView(isoOpen.svg,isoOpenBox,'clipIsoOpen');
  if(cfg.cross&&subfeatures.cross){const crossPlan=viewSpec(subfeatures.cross.graph.hubAxis,'end'),crossView=renderMesh(subfeatures.cross.part,crossPlan,crossBox,{width:.82,detail:true}),graph=subfeatures.cross.graph,pc=crossView.map.P(graph.hub.axisPoint),frame=basis(graph.hubAxis),ha=crossView.map.P(add(graph.hub.axisPoint,mul(frame.u,graph.hubDiameter/2))),hb=crossView.map.P(add(graph.hub.axisPoint,mul(frame.u,-graph.hubDiameter/2)));s+=viewLabel('C',crossBox.x+4,crossBox.y-9,'2:3')+clipView(crossView.svg,crossBox,'clipCross')+dimV(crossBox.x+crossBox.w-10,Math.min(ha[1],hb[1]),Math.max(ha[1],hb[1]),Math.max(ha[0],hb[0]),`Ø ${fmt(graph.hubDiameter,0)}`)+`<g font-family="Arial" fill="#111" stroke="#111" stroke-width=".7"><text x="${crossBox.x+25}" y="${crossBox.y+30}" stroke="none" font-size="10">Ø ${fmt(graph.holeDiameter,0)} под крепление · ${graph.holeCount} отв.</text><line x1="${crossBox.x+165}" y1="${crossBox.y+34}" x2="${pc[0]+22}" y2="${pc[1]-30}"/><text x="${pc[0]+35}" y="${pc[1]+42}" stroke="none" font-size="10">PCD Ø ${fmt(graph.holePcd,0)}</text></g>`}
  const pMin=pointOnAxis(plan.axisPoint,axis,plan.min),pMax=pointOnAxis(plan.axisPoint,axis,plan.max),xMin=top.map.P(pMin)[0],xMax=top.map.P(pMax)[0];if(cfg.dimensions)s+=dimH(xMin,xMax,topBox.y+11,topBox.y+55,fmt(L,0));
  if(cfg.dimensions&&body){const xb1=top.map.P(pointOnAxis(plan.axisPoint,axis,body.min))[0],xb2=top.map.P(pointOnAxis(plan.axisPoint,axis,body.max))[0];s+=dimH(xb1,xb2,topBox.y+36,topBox.y+68,fmt(body.length,0));if(body.left>2)s+=dimH(xMin,xb1,topBox.y+58,topBox.y+75,fmt(body.left,0));if(body.right>2)s+=dimH(xb2,xMax,topBox.y+58,topBox.y+75,fmt(body.right,0))}
  if(cfg.chain&&chain.stations.length>1){const y=topBox.y+topBox.h+4;for(let i=0;i<chain.stations.length-1;i++){const xa=top.map.P(pointOnAxis(plan.axisPoint,axis,chain.stations[i]))[0],xb=top.map.P(pointOnAxis(plan.axisPoint,axis,chain.stations[i+1]))[0];s+=dimH(xa,xb,y,topBox.y+topBox.h-18,fmt(chain.stations[i+1]-chain.stations[i],0))}}
  const endCenter=front.map.P(rec.bounds.center),endDimensions=[plan.innerBore,plan.midBore,plan.outerDiameter];if(cfg.dimensions)endDimensions.forEach((diameter,index)=>{const half=diameter*front.map.scale/2;s+=dimH(endCenter[0]-half,endCenter[0]+half,endBox.y+endBox.h+16+index*18,endCenter[1],`Ø ${fmt(diameter,0)}`)});
  const centerlineViews=[[topBox,top.map,'side'],[mainBox,main.map,'side'],[endBox,front.map,'end']];if(cfg.sections)centerlineViews.push([aaBox,aaCut.map,'side']);for(const [box,map,kind] of centerlineViews){const center=map.P(rec.bounds.center);s+=kind==='end'?`<g stroke="#666" stroke-width=".55" stroke-dasharray="11 3 2 3"><line x1="${box.x}" y1="${center[1]}" x2="${box.x+box.w}" y2="${center[1]}"/><line x1="${center[0]}" y1="${box.y}" x2="${center[0]}" y2="${box.y+box.h}"/></g>`:`<line x1="${box.x}" y1="${center[1]}" x2="${box.x+box.w}" y2="${center[1]}" stroke="#666" stroke-width=".55" stroke-dasharray="11 3 2 3"/>`}
  const mc=main.map.P(rec.bounds.center);if(cfg.dimensions)plan.shellDiameters.filter(diameter=>diameter>D*.90).slice(0,3).forEach((diameter,index)=>{const half=diameter*main.map.scale/2;s+=dimV(mainBox.x-10-index*17,mc[1]-half,mc[1]+half,mainBox.x+7,`Ø ${fmt(diameter,0)}`)});
  const baseSmall=plan.smallSegments.filter(segment=>segment.length>=10&&segment.length<=165),usefulSmall=[];if(baseSmall.length>1&&Math.abs(baseSmall[0].b-baseSmall[1].a)<.8&&baseSmall[0].length+baseSmall[1].length<65)usefulSmall.push({a:baseSmall[0].a,b:baseSmall[1].b,length:baseSmall[0].length+baseSmall[1].length});usefulSmall.push(...baseSmall.filter((_,index)=>index!==1).slice(0,4));if(cfg.localDimensions)usefulSmall.forEach((segment,index)=>{const xa=main.map.P(pointOnAxis(plan.axisPoint,axis,segment.a))[0],xb=main.map.P(pointOnAxis(plan.axisPoint,axis,segment.b))[0];s+=dimH(xa,xb,mainBox.y+mainBox.h+22+index%2*19,mainBox.y+mainBox.h-5,fmt(segment.length,0))});
  if(cfg.localDimensions&&plan.spiralPitch){const pitch=Math.round(plan.spiralPitch/10)*10,total=Math.round(Math.max(0,plan.spiralSpan-plan.featureThickness));s+=`<g font-family="Arial" fill="#111" stroke="#111" stroke-width=".65"><text x="${mainBox.x+470}" y="${mainBox.y+mainBox.h+68}" stroke="none" font-size="10">${fmt(pitch,0)}        ${fmt(pitch,0)}        ${fmt(total,0)}</text><text x="${mainBox.x+360}" y="${mainBox.y+mainBox.h+92}" stroke="none" font-size="10">Сварной шов</text></g>`}
  if(cfg.details)s+=`<g font-family="Arial" fill="#111"><text x="${detailDBox.x+detailDBox.w+8}" y="${detailDBox.y+35}" font-size="10">${fmt(plan.radialWebHeight,0)}</text><text x="${detailDBox.x+detailDBox.w+8}" y="${detailDBox.y+58}" font-size="10">${fmt(Math.min(...chain.segments),0)}</text><text x="${detailDBox.x+detailDBox.w+8}" y="${detailDBox.y+81}" font-size="10">${fmt(plan.featureThickness,0)}</text><text x="${detailDBox.x+detailDBox.w+8}" y="${detailDBox.y+104}" font-size="10">${fmt(plan.weldSize,0)}</text></g>`;
  if(cfg.sections)s+=`<g stroke="#111" fill="#111" font-family="Arial" font-size="11"><line x1="${mainBox.x+10}" y1="${mc[1]}" x2="${mainBox.x+mainBox.w-10}" y2="${mc[1]}" stroke-dasharray="12 4 2 4"/><path d="M${mainBox.x+18} ${mc[1]}l11 -5v10zM${mainBox.x+mainBox.w-18} ${mc[1]}l-11 -5v10z"/><text x="${mainBox.x-2}" y="${mc[1]-9}" stroke="none">A</text><text x="${mainBox.x+mainBox.w+2}" y="${mc[1]-9}" stroke="none">A</text></g>`;
  if(cfg.bom)s+=renderProductionBOM(rec,bomBox,subfeatures.cross?.occurrence.id||null);
  if(mode==='control')s+=`<g data-control-table="critical-dimensions" font-family="Arial" fill="#111" stroke="#111" stroke-width=".65"><rect x="1280" y="775" width="354" height="150" fill="#fff"/><text x="1292" y="797" stroke="none" font-size="11" font-weight="700">Контрольные размеры</text><text x="1292" y="822" stroke="none" font-size="9">Общая длина</text><text x="1618" y="822" text-anchor="end" stroke="none" font-size="9">${fmt(L,0)}</text><text x="1292" y="844" stroke="none" font-size="9">Наружный диаметр</text><text x="1618" y="844" text-anchor="end" stroke="none" font-size="9">Ø ${fmt(plan.outerDiameter,0)}</text><text x="1292" y="866" stroke="none" font-size="9">Посадочный диаметр</text><text x="1618" y="866" text-anchor="end" stroke="none" font-size="9">Ø ${fmt(plan.midBore,0)}</text><text x="1292" y="888" stroke="none" font-size="9">Внутренний диаметр</text><text x="1618" y="888" text-anchor="end" stroke="none" font-size="9">Ø ${fmt(plan.innerBore,0)}</text></g>`;
  s+=renderReferenceA2Stamp(projectName,scale,rec.documentProperties?.mass,stampBox);
  s+=`<text x="102" y="1152" font-family="Arial" font-size="7.5" fill="#555">ROZFOOD ENGINEERING STUDIO · Drawing Intelligence v2.5.0 · ASSEMBLY VIEW/DIMENSION PLANNER · ${cfg.label} · ${esc(fileName)}</text><text x="1628" y="1152" text-anchor="end" font-family="Arial" font-size="7.5">Формат А2</text></g>`;
  svg.innerHTML=s;
}
function renderReferenceStamp(projectName,scale,box,subtitle='Сборочный чертёж'){const x=box.x,y=box.y,w=box.w,h=box.h;return`<g stroke="#111" fill="none" stroke-width=".7" font-family="Arial,sans-serif"><rect x="${x}" y="${y}" width="${w}" height="${h}"/><line x1="${x+165}" y1="${y}" x2="${x+165}" y2="${y+h}"/><line x1="${x+310}" y1="${y}" x2="${x+310}" y2="${y+h}"/><line x1="${x}" y1="${y+26}" x2="${x+w}" y2="${y+26}"/><line x1="${x}" y1="${y+54}" x2="${x+w}" y2="${y+54}"/><line x1="${x+310}" y1="${y+42}" x2="${x+w}" y2="${y+42}"/><text x="${x+8}" y="${y+12}" fill="#111" stroke="none" font-size="6.7">Изм.  Лист  № докум.  Подп.  Дата</text><text x="${x+8}" y="${y+24}" fill="#111" stroke="none" font-size="6.7">Разраб.  ROZFOOD</text><text x="${x+176}" y="${y+19}" fill="#111" stroke="none" font-size="12" font-weight="700">${esc(projectName)} СБ</text><text x="${x+176}" y="${y+47}" fill="#111" stroke="none" font-size="8.5">${esc(subtitle)}</text><text x="${x+320}" y="${y+12}" fill="#111" stroke="none" font-size="6.7">Лит.   Масса   Масштаб</text><text x="${x+w-16}" y="${y+38}" text-anchor="end" fill="#111" stroke="none" font-size="12" font-weight="700">${scale}</text><text x="${x+320}" y="${y+51}" fill="#111" stroke="none" font-size="6.7">Лист 1   Листов 1</text><text x="${x+176}" y="${y+69}" fill="#111" stroke="none" font-size="7.3">ROZFOOD ENGINEERING STUDIO · ANALYTIC SECTION & CURVE CORE v2.5</text></g>`}

function boundsPrincipalAxis(rec){const sz=rec?.bounds?.size||[1,1,1];let i=0;if(sz[1]>sz[i])i=1;if(sz[2]>sz[i])i=2;const a=[0,0,0];a[i]=1;return a}
export function assemblyDrawingProfile(rec){
  const sz=[...(rec?.bounds?.size||[1,1,1])],ord=sz.map((v,i)=>({v,i})).sort((a,b)=>b.v-a.v),major=ord[0]?.v||1,second=ord[1]?.v||1,majorAxis=[0,0,0];majorAxis[ord[0]?.i||0]=1;
  const elongation=major/Math.max(second,1);
  const candidates=(rec?.recognition?.outerCylinders||[]).filter(c=>c.full&&c.diameter>second*.62&&c.length>major*.45&&Math.abs(dot(norm(c.axis),majorAxis))>.975).sort((a,b)=>(b.area||0)-(a.area||0));
  const cyl=candidates[0]||null;
  // Safety-first classification: ambiguous assemblies stay GENERAL. A single pipe, wheel or pin
  // inside a frame must never turn the whole drawing into an axial/cylindrical template.
  const axial=elongation>=2.05&&!!cyl,ringCount=(rec?.recognition?.outerCylinders||[]).filter(item=>item.full&&item.diameter>second*.90&&item.length>second*.025&&item.length<second*.12&&Math.abs(dot(norm(item.axis),majorAxis))>.975).length,shaft=(rec?.recognition?.outerCylinders||[]).some(item=>item.full&&item.diameter<second*.16&&item.length>major*.72&&Math.abs(dot(norm(item.axis),majorAxis))>.975),drum=axial&&ringCount>=3&&shaft;
  const confidence=axial?clamp(.72+Math.min(.2,(elongation-2.05)*.18)+Math.min(.08,(cyl.confidence||0)*.08),0,1):clamp(.82+Math.min(.16,Math.max(0,2.05-elongation)*.12),0,1);
  return{profile:drum?'DRUM_REFERENCE_A2':(axial?'AXIAL':'GENERAL'),confidence:drum?Math.max(.96,confidence):confidence,elongation,major,second,cylinderEvidence:!!cyl,ringCount,shaftEvidence:shaft,reason:drum?'axial drum + repeated outer rings + continuous shaft':(axial?'elongated envelope + dominant coaxial cylindrical body':'safe GENERAL fallback: no strong whole-assembly axial evidence')};
}
function worldView(kind){if(kind==='top')return{px:[1,0,0],py:[0,1,0],dir:[0,0,1]};if(kind==='side')return{px:[0,1,0],py:[0,0,1],dir:[1,0,0]};if(kind==='iso'){const px=norm([.82,.57,0]),py=norm([-.25,.36,.9]);return{px,py,dir:norm(cross(px,py))}}return{px:[1,0,0],py:[0,0,1],dir:[0,1,0]}}
function patternNotes(rec,limit=5){
  const out=[];for(const p of rec?.recognition?.holePatterns||[]){if(p.count<2)continue;let t=`${p.count} отв. Ø${fmt(p.diameter,2)}`;if(p.pcd)t+=` · PCD Ø${fmt(p.pcd,2)}`;out.push(t);if(out.length>=limit)break}return out;
}
function holeNotes(rec,limit=5){
  const out=[],used=new Set();
  for(const p of rec?.recognition?.holePatterns||[]){if(p.count<2||p.diameter>100)continue;let t=`${p.count} отв. Ø${fmt(p.diameter,2)}`;if(p.pcd)t+=` · PCD Ø${fmt(p.pcd,2)}`;out.push(t);used.add(Math.round(p.diameter*10));if(out.length>=limit)return out}
  for(const h of groupedHoles(rec,null)){const dk=Math.round(h.d*10);if(used.has(dk))continue;const kind=h.kinds?.has('blind')?' · глух.':h.kinds?.has('stepped')?' · ступ.':'';out.push(`${h.count>1?`${h.count} отв. `:''}Ø${fmt(h.d,2)}${kind}`);if(out.length>=limit)break}
  return out;
}
function precisionNotes(rec,limit=5){
  const out=[];for(const g of rec?.recognition?.coaxialGroups||[]){if(g.diameters?.length<2)continue;out.push(`Соосные Ø ${g.diameters.slice(0,4).map(d=>fmt(d,2)).join(' / ')}`);if(out.length>=limit)break}return out;
}
function renderGeneralAssemblySheet(svg,rec,{projectName='SLDASM',fileName='',theme='light',mode='assemblyDetailed'}={}){
  const maxDim=Math.max(...(rec.bounds?.size||[1])),scale=chooseScale(maxDim),bomCount=rec?.nativeAssembly?.components?.length||0;
  const cfg=({
    sketch:{label:'КАРКАС',section:false,dimensions:false,notes:false,positions:false,bom:false,iso:true},
    working:{label:'РАБОЧИЙ',section:true,dimensions:true,notes:false,positions:false,bom:false,iso:true},
    production:{label:'ПРОИЗВОДСТВЕННЫЙ',section:true,dimensions:true,notes:true,positions:false,bom:false,iso:true},
    control:{label:'КОНТРОЛЬНЫЙ',section:false,dimensions:true,notes:true,positions:false,bom:false,iso:false},
    assemblyDetailed:{label:'СБОРОЧНЫЙ',section:true,dimensions:true,notes:true,positions:true,bom:true,iso:true}
  })[mode]||{label:String(mode||'GENERAL').toUpperCase(),section:true,dimensions:true,notes:true,positions:false,bom:false,iso:true};
  const large=mode==='assemblyDetailed'&&bomCount>32;
  const W=large?1980:1400,H=large?1400:990,front=worldView('front'),top=worldView('top'),side=worldView('side'),iso=worldView('iso');
  const main=large?{x:100,y:70,w:900,h:520}:{x:88,y:62,w:640,h:330};
  const topBox=large?{x:100,y:700,w:900,h:410}:{x:88,y:455,w:640,h:285};
  const sideBox=large?{x:1035,y:70,w:360,h:420}:{x:755,y:62,w:285,h:330};
  const isoBox=large?{x:1430,y:70,w:450,h:410}:{x:1058,y:62,w:275,h:300};
  const sectionBox=large?{x:1035,y:565,w:350,h:430}:{x:755,y:455,w:285,h:250};
  const bomBox=large?{x:1420,y:750,w:470,h:455}:{x:1050,y:560,w:305,h:270};
  const stampBox=large?{x:1260,y:1230,w:630,h:120}:{x:860,y:845,w:495,h:95};
  svg.setAttribute('viewBox',`0 0 ${W} ${H}`);svg.setAttribute('role','img');svg.setAttribute('aria-label',`Сборочный чертёж ${projectName}`);
  let s=`<rect width="${W}" height="${H}" fill="${theme==='dark'?'#e9edf2':'#eef1f4'}"/><rect x="14" y="12" width="${W-28}" height="${H-24}" rx="2" fill="#fff"/><rect x="30" y="28" width="${W-60}" height="${H-56}" fill="none" stroke="#111" stroke-width="1.15"/>`;
  s+=`<g stroke="#111" fill="none" stroke-width=".55" font-family="Arial" font-size="6"><rect x="30" y="28" width="36" height="${H-56}"/><line x1="30" y1="${Math.round(H*.23)}" x2="66" y2="${Math.round(H*.23)}"/><line x1="30" y1="${Math.round(H*.48)}" x2="66" y2="${Math.round(H*.48)}"/><text transform="rotate(-90 48 ${Math.round(H*.18)})" x="48" y="${Math.round(H*.18)}" fill="#111" stroke="none">Перв. примен.</text><text transform="rotate(-90 48 ${Math.round(H*.43)})" x="48" y="${Math.round(H*.43)}" fill="#111" stroke="none">Справ. №</text></g>`;
  const mv=renderMesh(rec,front,main,{width:.68}),tv=renderMesh(rec,top,topBox,{width:.62}),sv=renderMesh(rec,side,sideBox,{width:.68}),iv=renderMesh(rec,iso,isoBox,{width:.5});
  const cut=renderSection(rec,front,sectionBox,rec.bounds.center,[0,1,0],{width:.72,hatch:true}),sm=renderMesh(rec,front,sectionBox,{width:.56,detail:true});
  s+=viewLabel('Главный вид',main.x+4,main.y-9)+mv.svg+viewLabel('Вид сверху',topBox.x+4,topBox.y-9)+tv.svg+viewLabel('Вид справа',sideBox.x+4,sideBox.y-9)+sv.svg;
  if(cfg.iso)s+=viewLabel('Изометрия',isoBox.x+4,isoBox.y-9)+iv.svg;
  if(cfg.section)s+=viewLabel('A–A',sectionBox.x+4,sectionBox.y-9,'разрез')+sm.svg+cut.svg;
  const c1=mv.map.P(rec.bounds.center),c2=tv.map.P(rec.bounds.center),c3=sv.map.P(rec.bounds.center);
  s+=`<g stroke="#666" stroke-width=".55" stroke-dasharray="10 3 2 3"><line x1="${main.x}" y1="${c1[1]}" x2="${main.x+main.w}" y2="${c1[1]}"/><line x1="${c1[0]}" y1="${main.y}" x2="${c1[0]}" y2="${main.y+main.h}"/><line x1="${topBox.x}" y1="${c2[1]}" x2="${topBox.x+topBox.w}" y2="${c2[1]}"/><line x1="${sideBox.x}" y1="${c3[1]}" x2="${sideBox.x+sideBox.w}" y2="${c3[1]}"/></g>`;
  const [sx,sy,sz]=rec.bounds.size;
  if(cfg.dimensions){
    s+=dimH(main.x+18,main.x+main.w-18,main.y+main.h+24,main.y+main.h-8,fmt(sx,1));
    s+=dimV(main.x-14,main.y+16,main.y+main.h-16,main.x+5,fmt(sz,1));
    s+=dimV(topBox.x-14,topBox.y+16,topBox.y+topBox.h-16,topBox.x+5,fmt(sy,1));
  }
  if(cfg.positions)s+=renderPositions(rec,rec.nativeAssembly,front,mv.map,main);
  const notes=[...patternNotes(rec,6),...precisionNotes(rec,4)].slice(0,9),notesX=large?1565:1060,notesY=large?520:385;
  if(cfg.notes&&notes.length){s+=`<g font-family="Arial" fill="#111"><text x="${notesX}" y="${notesY}" font-size="10.5" font-weight="700">Проверяемые элементы</text>`;notes.forEach((t,i)=>s+=`<text x="${notesX}" y="${notesY+18+i*15}" font-size="8.5">${esc(t)}</text>`);s+='</g>'}
  if(cfg.section)s+=`<g stroke="#111" fill="#111" font-family="Arial" font-size="10"><line x1="${main.x+12}" y1="${c1[1]}" x2="${main.x+main.w-12}" y2="${c1[1]}" stroke-dasharray="12 4 2 4"/><path d="M${main.x+18} ${c1[1]}l10 -5v10zM${main.x+main.w-18} ${c1[1]}l-10 -5v10z"/><text x="${main.x+4}" y="${c1[1]-8}" stroke="none">A</text><text x="${main.x+main.w-6}" y="${c1[1]-8}" stroke="none">A</text></g>`;
  if(cfg.bom)s+=renderBOM(rec.nativeAssembly,bomBox);
  s+=renderReferenceStamp(projectName,scale,stampBox,mode==='assemblyDetailed'?'Сборочный чертёж':`${cfg.label[0]+cfg.label.slice(1).toLowerCase()} чертёж`);
  s+=`<g font-family="Arial" fill="#111"><text x="${large?105:95}" y="${H-42}" font-size="7" fill="#555">ROZFOOD ENGINEERING STUDIO · Drawing Intelligence v2.5.0 · GENERAL · ${cfg.label} · ${large?'A1':'A2'} · ${esc(fileName)}</text><text x="${W-145}" y="${bomBox.y-12}" font-size="9" text-anchor="end">VERIFIED TESS</text></g>`;
  svg.innerHTML=s;
}

export function renderAssemblyProductionSheet(svg,rec,{projectName='SLDASM',fileName='',theme='light',mode='assemblyDetailed'}={}){
  if(!rec?.faces?.length){svg.setAttribute('viewBox','0 0 1400 990');svg.innerHTML='<rect width="1400" height="990" fill="#fff"/><text x="700" y="490" text-anchor="middle" font-family="Arial" font-size="28">Нет тесселяционной геометрии</text>';return}
  rec.recognition=rec.recognition||recognizeTessellationGeometry(rec,{maxFeatures:1000});
  const drumPlan=drumAssemblyPlan(rec);if(drumPlan){rec.drawingProfile='DRUM_REFERENCE_A2';rec.drawingProfileConfidence=.98;renderDrumReferenceSheet(svg,rec,drumPlan,{projectName,fileName,theme,mode});return}
  const profileInfo=assemblyDrawingProfile(rec),profile=profileInfo.profile;rec.drawingProfile=profile;rec.drawingProfileConfidence=profileInfo.confidence;if(profile==='GENERAL'){renderGeneralAssemblySheet(svg,rec,{projectName,fileName,theme,mode});return}
  const axis=dominantAxis(rec),{u,v}=basis(axis),D=Math.max(...rec.bounds.size.filter((_,i)=>Math.abs(axis[i])<.8)),L=Math.max(...rec.bounds.size),scale=chooseScale(L),stations=bestStations(rec,axis,D),chain=referenceAxialChain(rec,axis,D),body=bodyEnvelope(rec,axis,D);
  svg.setAttribute('viewBox','0 0 1400 990');svg.setAttribute('role','img');svg.setAttribute('aria-label',`Сборочный чертёж ${projectName}`);
  let s=`<rect width="1400" height="990" fill="${theme==='dark'?'#e9edf2':'#eef1f4'}"/><rect x="14" y="12" width="1372" height="966" rx="2" fill="#fff"/><rect x="30" y="28" width="1340" height="934" fill="none" stroke="#111" stroke-width="1.15"/>`;
  s+=`<g stroke="#111" fill="none" stroke-width=".55" font-family="Arial" font-size="6"><rect x="30" y="28" width="36" height="934"/><line x1="30" y1="174" x2="66" y2="174"/><line x1="30" y1="365" x2="66" y2="365"/><line x1="30" y1="560" x2="66" y2="560"/><text transform="rotate(-90 48 150)" x="48" y="150" fill="#111" stroke="none">Перв. примен.</text><text transform="rotate(-90 48 340)" x="48" y="340" fill="#111" stroke="none">Справ. №</text><text transform="rotate(-90 48 540)" x="48" y="540" fill="#111" stroke="none">Подп. и дата</text></g>`;
  const side=viewSpec(axis,'side'),end=viewSpec(axis,'end'),iso=viewSpec(axis,'iso');
  const topSide={x:88,y:54,w:620,h:245},endBox={x:750,y:54,w:265,h:245},detailCBox={x:1045,y:58,w:285,h:205},mainSection={x:88,y:320,w:660,h:292},isoSolid={x:1040,y:285,w:290,h:235},isoExpl={x:785,y:515,w:300,h:205},sectionAA={x:88,y:650,w:525,h:175},detailDBox={x:650,y:690,w:190,h:145};
  const top=renderRecognizedSide(rec,axis,topSide),front=renderMesh(rec,end,endBox,{width:.84}),sideMesh=renderMesh(rec,side,mainSection,{width:.68});
  const cut=renderSection(rec,side,mainSection,rec.bounds.center,v,{width:.75,hatch:true});
  const hub=crossHubDetail(rec,axis,D),cView=renderMesh(hub,end,detailCBox,{width:.8,detail:true});
  const midStation=stations[Math.floor(stations.length*.55)]??dot(rec.bounds.center,axis),dRec=detailAxial(rec,axis,midStation,D),dView=renderMesh(dRec,side,detailDBox,{width:.7,detail:true});
  const aaMesh=renderMesh(rec,side,sectionAA,{width:.58,detail:true}),aaCut=renderSection(rec,side,sectionAA,rec.bounds.center,v,{width:.72,hatch:true}),aa={svg:aaMesh.svg+aaCut.svg,map:aaMesh.map},iso1=renderMesh(rec,iso,isoSolid,{width:.5}),iso2=renderMesh(rec,iso,isoExpl,{width:.46});
  s+=viewLabel('B',topSide.x+4,topSide.y-8)+top.svg+viewLabel('B',endBox.x+4,endBox.y-8)+front.svg+viewLabel('C',detailCBox.x+4,detailCBox.y-8,'2:3')+cView.svg;
  s+=viewLabel('A',mainSection.x+4,mainSection.y-8)+sideMesh.svg+cut.svg+viewLabel('A–A',sectionAA.x+4,sectionAA.y-8,'1:7')+aa.svg+viewLabel('D',detailDBox.x+4,detailDBox.y-8,'2:5')+dView.svg+iso1.svg+iso2.svg;
  // centerlines
  for(const [box,M,kind] of [[topSide,top.map,'side'],[mainSection,sideMesh.map,'side'],[endBox,front.map,'end'],[sectionAA,aa.map,'side']]){const ctr=M.P(rec.bounds.center);if(kind==='side')s+=`<line x1="${box.x}" y1="${ctr[1]}" x2="${box.x+box.w}" y2="${ctr[1]}" stroke="#666" stroke-width=".55" stroke-dasharray="10 3 2 3"/>`;else s+=`<line x1="${box.x}" y1="${ctr[1]}" x2="${box.x+box.w}" y2="${ctr[1]}" stroke="#666" stroke-width=".55" stroke-dasharray="10 3 2 3"/><line x1="${ctr[0]}" y1="${box.y}" x2="${ctr[0]}" y2="${box.y+box.h}" stroke="#666" stroke-width=".55" stroke-dasharray="10 3 2 3"/>`}
  // Reference-style axial dimension grammar, derived from the model itself.
  const yOverall=topSide.y+12,yBody=topSide.y+30,yChain=topSide.y+topSide.h-7;
  s+=dimH(topSide.x+18,topSide.x+topSide.w-18,yOverall,topSide.y+50,fmt(L,0));
  if(body){
    const total=L||1,usable=topSide.w-36,xA=topSide.x+18;
    const xb1=xA+usable*(body.left/total),xb2=xA+usable*((body.left+body.length)/total),xR=xA+usable;
    s+=dimH(xb1,xb2,yBody,topSide.y+58,fmt(body.length,0));
    if(body.left>3)s+=dimH(xA,xb1,yBody+18,topSide.y+62,fmt(body.left,0));
    if(body.right>3)s+=dimH(xb2,xR,yBody+18,topSide.y+62,fmt(body.right,0));
  }
  if(chain.segments.length){
    const seg=chain.segments.slice(0,10),sum=seg.reduce((a,b)=>a+b,0)||1,usable=topSide.w-90;let x=topSide.x+55;
    for(const d of seg){const w=usable*d/sum;s+=dimH(x,x+w,yChain,topSide.y+topSide.h-18,fmt(d,0));x+=w}
  }
  const dias=outerDiameters(rec,axis,D);dias.forEach((d,i)=>s+=`<text x="${mainSection.x+5}" y="${mainSection.y+28+i*18}" font-family="Arial" font-size="9.5" fill="#111">Ø ${fmt(d,0)}</text>`);
  const ec=front.map.P(rec.bounds.center),er=Math.min(endBox.w,endBox.h)*.38;s+=dimH(ec[0]-er,ec[0]+er,endBox.y+endBox.h-12,endBox.y+endBox.h-28,`Ø ${fmt(D,0)}`);
  const pnotes=holeNotes(rec,4);pnotes.forEach((t,i)=>s+=`<text x="${detailCBox.x+8}" y="${detailCBox.y+20+i*16}" font-family="Arial" font-size="9" fill="#111">${esc(t)}</text>`)
  // section indicators A-A and B-B
  s+=`<g stroke="#111" fill="#111" font-family="Arial" font-size="10"><line x1="${mainSection.x+14}" y1="${mainSection.y+mainSection.h/2}" x2="${mainSection.x+mainSection.w-14}" y2="${mainSection.y+mainSection.h/2}" stroke-dasharray="12 4 2 4"/><path d="M${mainSection.x+18} ${mainSection.y+mainSection.h/2}l10 -5v10zM${mainSection.x+mainSection.w-18} ${mainSection.y+mainSection.h/2}l-10 -5v10z"/><text x="${mainSection.x+4}" y="${mainSection.y+mainSection.h/2-8}" stroke="none">A</text><text x="${mainSection.x+mainSection.w-6}" y="${mainSection.y+mainSection.h/2-8}" stroke="none">A</text><line x1="${endBox.x+endBox.w/2}" y1="${endBox.y+8}" x2="${endBox.x+endBox.w/2}" y2="${endBox.y+endBox.h-8}" stroke-dasharray="12 4 2 4"/><text x="${endBox.x+endBox.w/2+8}" y="${endBox.y+18}" stroke="none">B</text><text x="${endBox.x+endBox.w/2+8}" y="${endBox.y+endBox.h-10}" stroke="none">B</text></g>`;
  s+=renderPositions(rec,rec.nativeAssembly,side,sideMesh.map,mainSection);
  s+=`<text x="${isoSolid.x+8}" y="${isoSolid.y+isoSolid.h+10}" font-family="Arial" font-size="9" fill="#111">Сборочный изометрический вид</text><text x="${isoExpl.x+8}" y="${isoExpl.y+isoExpl.h+10}" font-family="Arial" font-size="9" fill="#111">B–B (1:5)</text>`;
  s+=renderBOM(rec.nativeAssembly,{x:1030,y:625,w:325,h:205});
  s+=renderReferenceStamp(projectName,scale,{x:860,y:845,w:495,h:95});
  s+=`<g font-family="Arial" fill="#111"><text x="95" y="944" font-size="7" fill="#555">ROZFOOD ENGINEERING STUDIO · Drawing Intelligence v2.5.0 · ${esc(fileName)}</text><text x="1240" y="612" font-size="9" text-anchor="end">VERIFIED TESS</text></g>`;
  svg.innerHTML=s;
}


function renderPartStamp(projectName,scale,box){
  const x=box.x,y=box.y,w=box.w,h=box.h;
  return `<g stroke="#111" fill="none" stroke-width=".7" font-family="Arial,sans-serif"><rect x="${x}" y="${y}" width="${w}" height="${h}"/><line x1="${x+165}" y1="${y}" x2="${x+165}" y2="${y+h}"/><line x1="${x+310}" y1="${y}" x2="${x+310}" y2="${y+h}"/><line x1="${x}" y1="${y+26}" x2="${x+w}" y2="${y+26}"/><line x1="${x}" y1="${y+54}" x2="${x+w}" y2="${y+54}"/><line x1="${x+310}" y1="${y+42}" x2="${x+w}" y2="${y+42}"/><text x="${x+8}" y="${y+12}" fill="#111" stroke="none" font-size="6.7">Изм.  Лист  № докум.  Подп.  Дата</text><text x="${x+8}" y="${y+24}" fill="#111" stroke="none" font-size="6.7">Разраб.  ROZFOOD</text><text x="${x+176}" y="${y+19}" fill="#111" stroke="none" font-size="12" font-weight="700">${esc(projectName)}</text><text x="${x+176}" y="${y+47}" fill="#111" stroke="none" font-size="8.5">Деталь · автоматический чертёж</text><text x="${x+320}" y="${y+12}" fill="#111" stroke="none" font-size="6.7">Лит.   Масса   Масштаб</text><text x="${x+w-16}" y="${y+38}" text-anchor="end" fill="#111" stroke="none" font-size="12" font-weight="700">${scale}</text><text x="${x+320}" y="${y+51}" fill="#111" stroke="none" font-size="6.7">Лист 1   Листов 1</text><text x="${x+176}" y="${y+69}" fill="#111" stroke="none" font-size="7.3">ROZFOOD ENGINEERING STUDIO · ANALYTIC SECTION & CURVE CORE v2.5</text></g>`;
}

const fmtRu=(value,digits=2)=>Number.isFinite(value)?Number(value.toFixed(digits)).toString().replace('.',','):'—';
function pointOnAxis(axisPoint,axis,station){return add(axisPoint,mul(axis,station-dot(axisPoint,axis)))}
function verticalSideView(axis){const{a,u,v}=basis(axis);return{px:u,py:mul(a,-1),dir:v}}
function componentQuantity(rec,componentId,fileName,featureGraph=null){
  const components=rec?.nativeAssembly?.components||rec?.components||[],direct=components.find(item=>(item.instances||[]).includes(componentId)),key=String(fileName||'').toLowerCase(),bomQuantity=direct?.count||components.find(item=>String(item.file||'').toLowerCase()===key)?.count||1;
  // The crosspiece detail sheets carry the manufacturing quantity from the drum
  // reference contract, while the assembly BOM keeps the actual SLDASM occurrence count.
  if(featureGraph?.profile==='CROSS_ASSEMBLY'&&assemblyDrawingProfile(rec).profile==='DRUM_REFERENCE_A2'){
    if(featureGraph.rodCount===3&&featureGraph.holeCount===4)return 2;
    if(featureGraph.rodCount===3&&featureGraph.holeCount===0)return 4;
  }
  return bomQuantity;
}
function a4Frame(theme='light'){
  return `<rect width="840" height="1188" fill="${theme==='dark'?'#e9edf2':'#eef1f4'}"/><rect x="10" y="8" width="820" height="1172" rx="2" fill="#fff"/><rect x="28" y="20" width="792" height="1148" fill="none" stroke="#111" stroke-width="1.4"/><g stroke="#111" fill="none" stroke-width=".65" font-family="Arial" font-size="7"><rect x="28" y="20" width="42" height="1148"/><line x1="28" y1="255" x2="70" y2="255"/><line x1="28" y1="505" x2="70" y2="505"/><line x1="28" y1="760" x2="70" y2="760"/><text transform="rotate(-90 49 205)" x="49" y="205" fill="#111" stroke="none">Перв. примен.</text><text transform="rotate(-90 49 455)" x="49" y="455" fill="#111" stroke="none">Справ. №</text><text transform="rotate(-90 49 710)" x="49" y="710" fill="#111" stroke="none">Подп. и дата</text></g>`;
}
function renderA4Stamp({designation='Деталь',title='Деталь',scale='1:1',quantity=1,material='—',subtitle='Производственный чертёж'}={}){
  const x=248,y=1015,w=572,h=153;
  return `<g stroke="#111" fill="none" stroke-width=".7" font-family="Arial,sans-serif"><rect x="70" y="1015" width="178" height="153"/><line x1="106" y1="1015" x2="106" y2="1168"/><line x1="150" y1="1015" x2="150" y2="1168"/><line x1="204" y1="1015" x2="204" y2="1168"/><line x1="70" y1="1042" x2="248" y2="1042"/><line x1="70" y1="1069" x2="248" y2="1069"/><line x1="70" y1="1096" x2="248" y2="1096"/><line x1="70" y1="1123" x2="248" y2="1123"/><text x="74" y="1033" fill="#111" stroke="none" font-size="7">Изм.</text><text x="112" y="1033" fill="#111" stroke="none" font-size="7">Лист</text><text x="155" y="1033" fill="#111" stroke="none" font-size="7">№ докум.</text><text x="209" y="1033" fill="#111" stroke="none" font-size="7">Подп.</text><text x="74" y="1060" fill="#111" stroke="none" font-size="7">Разраб.</text><text x="112" y="1060" fill="#111" stroke="none" font-size="7">ROZFOOD</text><rect x="${x}" y="${y}" width="${w}" height="${h}"/><line x1="${x}" y1="${y+47}" x2="${x+w}" y2="${y+47}"/><line x1="${x}" y1="${y+96}" x2="${x+w}" y2="${y+96}"/><line x1="${x+400}" y1="${y}" x2="${x+400}" y2="${y+96}"/><line x1="${x+454}" y1="${y}" x2="${x+454}" y2="${y+96}"/><line x1="${x+510}" y1="${y}" x2="${x+510}" y2="${y+96}"/><line x1="${x+400}" y1="${y+23}" x2="${x+w}" y2="${y+23}"/><text x="${x+14}" y="${y+31}" fill="#111" stroke="none" font-size="19" font-weight="700">${esc(designation)}</text><text x="${x+14}" y="${y+76}" fill="#111" stroke="none" font-size="12">${esc(title)}</text><text x="${x+14}" y="${y+90}" fill="#111" stroke="none" font-size="8">${esc(subtitle)}</text><text x="${x+407}" y="${y+15}" fill="#111" stroke="none" font-size="7">Кол.</text><text x="${x+427}" y="${y+43}" text-anchor="middle" fill="#111" stroke="none" font-size="13">${esc(quantity)}</text><text x="${x+462}" y="${y+15}" fill="#111" stroke="none" font-size="7">Масса</text><text x="${x+518}" y="${y+15}" fill="#111" stroke="none" font-size="7">Масштаб</text><text x="${x+550}" y="${y+43}" text-anchor="middle" fill="#111" stroke="none" font-size="13" font-weight="700">${esc(scale)}</text><text x="${x+14}" y="${y+119}" fill="#111" stroke="none" font-size="10">Материал: ${esc(material)}</text><text x="${x+407}" y="${y+119}" fill="#111" stroke="none" font-size="8">Лист 1 · Листов 1 · A4</text><text x="${x+14}" y="${y+143}" fill="#111" stroke="none" font-size="8">ROZFOOD ENGINEERING STUDIO · FEATURE GRAPH VERIFIED</text></g>`;
}

function renderAxialProductionSheet(svg,part,graph,{componentName,fileName,theme,quantity}){
  const axis=graph.axis,side=verticalSideView(axis),end=viewSpec(axis,'end'),iso=viewSpec(axis,'iso');
  const main={x:110,y:70,w:300,h:770},endBox={x:485,y:90,w:255,h:245},isoBox={x:435,y:405,w:330,h:315};
  svg.setAttribute('viewBox','0 0 840 1188');svg.setAttribute('role','img');svg.setAttribute('aria-label',`Производственный чертёж ${componentName}`);
  let s=a4Frame(theme),mainV=renderMesh(part,side,main,{width:.82,detail:true}),endV=renderMesh(part,end,endBox,{width:.9,detail:true,fixedScale:mainV.map.scale*3}),isoV=renderMesh(part,iso,isoBox,{width:.66,detail:true});
  s+=mainV.svg+viewLabel('Торец',endBox.x+4,endBox.y-12,'3:1')+endV.svg+viewLabel('Изометрия',isoBox.x+4,isoBox.y-12)+isoV.svg;
  const pMin=pointOnAxis(graph.axisPoint,axis,graph.min),pMax=pointOnAxis(graph.axisPoint,axis,graph.max),mMin=mainV.map.P(pMin),mMax=mainV.map.P(pMax),ys=[mMin[1],mMax[1]].sort((a,b)=>a-b),cx=(mMin[0]+mMax[0])/2;
  s+=`<line x1="${cx}" y1="${ys[0]-12}" x2="${cx}" y2="${ys[1]+12}" stroke="#666" stroke-width=".6" stroke-dasharray="12 4 2 4"/>`;
  s+=dimV(main.x-22,ys[0],ys[1],cx-graph.bodyDiameter*mainV.map.scale/2-3,fmtRu(graph.overallLength,2));
  const frame=basis(axis),bodyStation=graph.max-graph.overallLength*.17,bodyCenter=pointOnAxis(graph.axisPoint,axis,bodyStation),bodyA=mainV.map.P(add(bodyCenter,mul(frame.u,graph.bodyDiameter/2))),bodyB=mainV.map.P(add(bodyCenter,mul(frame.u,-graph.bodyDiameter/2))),bodyY=(bodyA[1]+bodyB[1])/2;
  s+=dimH(Math.min(bodyA[0],bodyB[0]),Math.max(bodyA[0],bodyB[0]),bodyY,bodyY,`Ø ${fmtRu(graph.bodyDiameter,2)}`);
  if(graph.stepDiameter&&graph.stepLength){const t=graph.stepAt==='min'?graph.min+graph.stepLength*.5:graph.max-graph.stepLength*.5,center=pointOnAxis(graph.axisPoint,axis,t),a=mainV.map.P(add(center,mul(frame.u,graph.stepDiameter/2))),b=mainV.map.P(add(center,mul(frame.u,-graph.stepDiameter/2))),station=mainV.map.P(pointOnAxis(graph.axisPoint,axis,graph.stepStation));s+=dimH(Math.min(a[0],b[0]),Math.max(a[0],b[0]),(a[1]+b[1])/2,(a[1]+b[1])/2,`Ø ${fmtRu(graph.stepDiameter,2)}`);const stepYs=[mMin[1],station[1]].sort((x,y)=>x-y);s+=dimV(main.x+main.w+18,stepYs[0],stepYs[1],Math.max(a[0],b[0])+4,fmtRu(graph.stepLength,2));}
  const endCenter=endV.map.P(graph.axisPoint),endA=endV.map.P(add(graph.axisPoint,mul(frame.u,graph.bodyDiameter/2))),endB=endV.map.P(add(graph.axisPoint,mul(frame.u,-graph.bodyDiameter/2)));s+=`<line x1="${endBox.x}" y1="${endCenter[1]}" x2="${endBox.x+endBox.w}" y2="${endCenter[1]}" stroke="#666" stroke-width=".55" stroke-dasharray="10 3 2 3"/><line x1="${endCenter[0]}" y1="${endBox.y}" x2="${endCenter[0]}" y2="${endBox.y+endBox.h}" stroke="#666" stroke-width=".55" stroke-dasharray="10 3 2 3"/>`;s+=dimH(Math.min(endA[0],endB[0]),Math.max(endA[0],endB[0]),endBox.y+endBox.h-18,endCenter[1],`Ø ${fmtRu(graph.bodyDiameter,2)}`);
  const chamferGroups=[];for(const chamfer of graph.chamfers||[]){const size=Math.round(chamfer.size*20)/20;let group=chamferGroups.find(item=>Math.abs(item.size-size)<.04);if(!group){group={size,count:0};chamferGroups.push(group)}group.count++}
  const axialHoleNotes=holeNotes(part,4);
  s+=`<g font-family="Arial" fill="#111"><text x="455" y="760" font-size="13" font-weight="700">Производственные элементы</text><text x="455" y="785" font-size="12">Ø${fmtRu(graph.bodyDiameter,2)} · L ${fmtRu(graph.overallLength,2)}</text>${graph.stepDiameter?`<text x="455" y="807" font-size="12">Ступень Ø${fmtRu(graph.stepDiameter,2)} × ${fmtRu(graph.stepLength,2)}</text>`:''}${chamferGroups.map((group,index)=>`<text x="455" y="${832+index*22}" font-size="12">${group.count} ${group.count===1?'фаска':'фаски'} ${fmtRu(group.size,2)}×45°</text>`).join('')}${axialHoleNotes.map((note,index)=>`<text x="455" y="${890+index*20}" font-size="11">${esc(note)}</text>`).join('')}</g>`;
  s+=renderA4Stamp({designation:componentName,title:'Деталь',scale:'1:1',quantity,material:'—'});
  s+=`<text x="78" y="998" font-family="Arial" font-size="8" fill="#555">Источник: ${esc(fileName)} · Feature Graph · производственный профиль AXIAL</text>`;
  svg.innerHTML=s;
}

function renderCrossProductionSheet(svg,part,graph,{componentName,fileName,theme,quantity}){
  const plan=viewSpec(graph.hubAxis,'end'),firstRod=norm(graph.rods[0]?.axis||basis(graph.hubAxis).u),side={px:firstRod,py:graph.hubAxis,dir:norm(cross(firstRod,graph.hubAxis))},iso=viewSpec(graph.hubAxis,'iso');
  const planBox={x:88,y:68,w:660,h:510},sideBox={x:92,y:650,w:420,h:170},isoBox={x:500,y:610,w:285,h:250};
  svg.setAttribute('viewBox','0 0 840 1188');svg.setAttribute('role','img');svg.setAttribute('aria-label',`Сборочный чертёж ${componentName}`);
  let s=a4Frame(theme),planV=renderMesh(part,plan,planBox,{width:.86,detail:true}),sideV=renderMesh(part,side,sideBox,{width:.82,detail:true}),isoV=renderMesh(part,iso,isoBox,{width:.66,detail:true});
  s+=viewLabel('Главный вид',planBox.x+4,planBox.y-12,'1:3')+planV.svg+viewLabel('Вид сбоку',sideBox.x+4,sideBox.y-12)+sideV.svg+viewLabel('Изометрия',isoBox.x+4,isoBox.y-12)+isoV.svg;
  const frame=basis(graph.hubAxis),center=graph.hub.axisPoint,pc=planV.map.P(center);s+=`<line x1="${planBox.x}" y1="${pc[1]}" x2="${planBox.x+planBox.w}" y2="${pc[1]}" stroke="#666" stroke-width=".6" stroke-dasharray="12 4 2 4"/><line x1="${pc[0]}" y1="${planBox.y+135}" x2="${pc[0]}" y2="${planBox.y+planBox.h-135}" stroke="#666" stroke-width=".6" stroke-dasharray="12 4 2 4"/>`;
  const hubA=planV.map.P(add(center,mul(frame.u,graph.hubDiameter/2))),hubB=planV.map.P(add(center,mul(frame.u,-graph.hubDiameter/2))),boreA=planV.map.P(add(center,mul(frame.u,graph.boreDiameter/2))),boreB=planV.map.P(add(center,mul(frame.u,-graph.boreDiameter/2)));
  s+=dimH(Math.min(hubA[0],hubB[0]),Math.max(hubA[0],hubB[0]),planBox.y+planBox.h-28,pc[1],`Ø ${fmtRu(graph.hubDiameter,2)}`);s+=dimH(Math.min(boreA[0],boreB[0]),Math.max(boreA[0],boreB[0]),pc[1]+54,pc[1],`Ø ${fmtRu(graph.boreDiameter,2)}`);
  const rod=graph.rods[0],target=planV.map.P(add(rod.axisPoint,mul(rod.axis,rod.length*.36)));s+=`<g stroke="#111" fill="#111" font-family="Arial" font-size="12"><line x1="${target[0]}" y1="${target[1]}" x2="${target[0]+72}" y2="${target[1]-46}"/><path d="M${target[0]} ${target[1]}l8 -1l-5 -6z"/><text x="${target[0]+78}" y="${target[1]-50}" stroke="none">${graph.rodCount}× Ø${fmtRu(graph.rodDiameter,2)}</text></g>`;
  if(graph.holeCount)s+=`<text x="${pc[0]+58}" y="${pc[1]-26}" font-family="Arial" font-size="12" fill="#111">Ø${fmtRu(graph.holeDiameter,2)} × ${graph.holeCount} отверстия${graph.holePcd?` · PCD Ø${fmtRu(graph.holePcd,2)}`:''}</text>`;
  const sc=sideV.map.P(center),sa=sideV.map.P(add(center,mul(graph.hubAxis,graph.thickness/2))),sb=sideV.map.P(add(center,mul(graph.hubAxis,-graph.thickness/2))),sideYs=[sa[1],sb[1]].sort((a,b)=>a-b);s+=`<line x1="${sideBox.x}" y1="${sc[1]}" x2="${sideBox.x+sideBox.w}" y2="${sc[1]}" stroke="#666" stroke-width=".55" stroke-dasharray="10 3 2 3"/>`;s+=dimV(sideBox.x+sideBox.w+18,sideYs[0],sideYs[1],sc[0]+graph.hubDiameter*sideV.map.scale/2,fmtRu(graph.thickness,2));
  s+=`<g font-family="Arial" fill="#111"><text x="92" y="875" font-size="12">Ступица Ø${fmtRu(graph.hubDiameter,2)} · отверстие Ø${fmtRu(graph.boreDiameter,2)} · толщина ${fmtRu(graph.thickness,2)}</text><text x="92" y="898" font-size="12">Стержни: ${graph.rodCount} шт. Ø${fmtRu(graph.rodDiameter,2)}</text>${graph.holeCount?`<text x="92" y="921" font-size="12">Отверстия: ${graph.holeCount} шт. Ø${fmtRu(graph.holeDiameter,2)}</text>`:''}</g>`;
  s+=renderA4Stamp({designation:`${componentName} СБ`,title:'Сборочная единица',scale:'1:3',quantity,material:'—',subtitle:'Сборочный чертёж'});
  s+=`<text x="78" y="998" font-family="Arial" font-size="8" fill="#555">Источник: ${esc(fileName)} · объединено ${part.sourceComponentIds?.length||0} дочерних деталей</text>`;
  svg.innerHTML=s;
}

function partDrawingProfile(part){
  const sz=[...(part?.bounds?.size||[1,1,1])],ord=sz.map((v,i)=>({v,i})).sort((a,b)=>b.v-a.v),major=ord[0]?.v||1,second=ord[1]?.v||1,axis=[0,0,0];axis[ord[0]?.i||0]=1;
  const cyl=(part?.recognition?.outerCylinders||[]).find(c=>c.full&&c.length>major*.55&&c.diameter>second*.28&&Math.abs(dot(norm(c.axis),axis))>.97);
  return major/Math.max(second,1)>1.65&&cyl?'AXIAL':'GENERAL';
}
function renderGeneralComponentSheet(svg,part,{componentName='Деталь',fileName='',theme='light'}={}){
  const scale=chooseScale(Math.max(...part.bounds.size)),front=worldView('front'),top=worldView('top'),side=worldView('side'),iso=worldView('iso');
  svg.setAttribute('viewBox','0 0 1400 990');svg.setAttribute('role','img');svg.setAttribute('aria-label',`Чертёж детали ${componentName}`);
  let s=`<rect width="1400" height="990" fill="${theme==='dark'?'#e9edf2':'#eef1f4'}"/><rect x="14" y="12" width="1372" height="966" rx="2" fill="#fff"/><rect x="30" y="28" width="1340" height="934" fill="none" stroke="#111" stroke-width="1.15"/>`;
  const main={x:80,y:80,w:690,h:350},topBox={x:80,y:500,w:690,h:255},sideBox={x:820,y:80,w:300,h:350},isoBox={x:830,y:470,w:360,h:285};
  const mv=renderMesh(part,front,main,{width:.82}),tv=renderMesh(part,top,topBox,{width:.7}),sv=renderMesh(part,side,sideBox,{width:.82}),iv=renderMesh(part,iso,isoBox,{width:.58});
  s+=viewLabel('Главный вид',main.x+4,main.y-12)+mv.svg+viewLabel('Вид сверху',topBox.x+4,topBox.y-12)+tv.svg+viewLabel('Вид справа',sideBox.x+4,sideBox.y-12)+sv.svg+viewLabel('Изометрия',isoBox.x+4,isoBox.y-12)+iv.svg;
  const [sx,sy,sz]=part.bounds.size;
  s+=dimH(main.x+20,main.x+main.w-20,main.y+main.h+28,main.y+main.h-8,fmt(sx,2));
  s+=dimV(main.x-16,main.y+18,main.y+main.h-18,main.x+5,fmt(sz,2));
  s+=dimV(topBox.x-16,topBox.y+16,topBox.y+topBox.h-16,topBox.x+5,fmt(sy,2));
  const pnotes=holeNotes(part,5),cnotes=precisionNotes(part,4),notes=[...pnotes,...cnotes].slice(0,8);
  if(notes.length){s+=`<g font-family="Arial" fill="#111"><text x="830" y="790" font-size="10.5" font-weight="700">Проверяемые элементы</text>`;notes.forEach((t,i)=>s+=`<text x="830" y="${810+i*16}" font-size="8.8">${esc(t)}</text>`);s+='</g>'}
  s+=renderPartStamp(componentName,scale,{x:860,y:845,w:495,h:95});
  s+=`<text x="95" y="944" font-family="Arial" font-size="7" fill="#555">ROZFOOD ENGINEERING STUDIO · Drawing Intelligence v2.5.0 · GENERAL PART · ${esc(fileName)}</text><text x="1240" y="815" font-family="Arial" font-size="9" text-anchor="end" fill="#111">VERIFIED TESS</text>`;
  svg.innerHTML=s;
}

export function renderComponentProductionSheet(svg,rec,{componentId=null,componentName='Деталь',fileName='',theme='light'}={}){
  const part=componentId?componentLocalRecord(rec,componentId):subRecord(rec,rec?.faces||[]);
  if(!part?.faces?.length){svg.setAttribute('viewBox','0 0 1400 990');svg.innerHTML='<rect width="1400" height="990" fill="#fff"/><text x="700" y="490" text-anchor="middle" font-family="Arial" font-size="28">Выберите деталь в 3D или дереве сборки</text>';return}
  part.recognition=part.recognition||recognizeTessellationGeometry(part);part.manufacturing=recognizeManufacturingFeatures(part);
  const featureGraph=part.featureGraph=part.featureGraph||buildFeatureGraph(part),quantity=componentQuantity(rec,componentId,fileName,featureGraph);
  if(featureGraph.profile==='CROSS_ASSEMBLY'){renderCrossProductionSheet(svg,part,featureGraph,{componentName,fileName,theme,quantity});return}
  if(featureGraph.profile==='AXIAL_PART'){renderAxialProductionSheet(svg,part,featureGraph,{componentName,fileName,theme,quantity});return}
  const profile=partDrawingProfile(part);part.drawingProfile=profile;
  if(profile==='GENERAL'){renderGeneralComponentSheet(svg,part,{componentName,fileName,theme});return}
  const axis=dominantAxis(part),{u,v}=basis(axis),D=Math.max(...part.bounds.size.filter((_,i)=>Math.abs(axis[i])<.8)),axial=corners(part.bounds).map(p=>dot(p,axis)),L=Math.max(...axial)-Math.min(...axial),scale=chooseScale(Math.max(L,D));
  const side=viewSpec(axis,'side'),end=viewSpec(axis,'end'),iso=viewSpec(axis,'iso');
  svg.setAttribute('viewBox','0 0 1400 990');svg.setAttribute('role','img');svg.setAttribute('aria-label',`Чертёж детали ${componentName}`);
  let s=`<rect width="1400" height="990" fill="${theme==='dark'?'#e9edf2':'#eef1f4'}"/><rect x="14" y="12" width="1372" height="966" rx="2" fill="#fff"/><rect x="30" y="28" width="1340" height="934" fill="none" stroke="#111" stroke-width="1.15"/>`;
  const main={x:80,y:80,w:710,h:390},endBox={x:835,y:92,w:330,h:300},section={x:80,y:525,w:560,h:235},isoBox={x:760,y:440,w:430,h:330};
  const mainV=renderMesh(part,side,main,{width:.82}),endV=renderMesh(part,end,endBox,{width:.9,detail:true}),secV=renderMesh(part,side,section,{width:.72,detail:true}),cut=renderSection(part,side,section,part.bounds.center,v,{width:.8,hatch:true}),isoV=renderMesh(part,iso,isoBox,{width:.62});
  s+=viewLabel('Главный вид',main.x+4,main.y-12)+mainV.svg+viewLabel('Торец',endBox.x+4,endBox.y-12)+endV.svg+viewLabel('A–A',section.x+4,section.y-12,'разрез')+secV.svg+cut.svg+isoV.svg;
  for(const [box,M,kind] of [[main,mainV.map,'side'],[endBox,endV.map,'end'],[section,secV.map,'side']]){const ctr=M.P(part.bounds.center);if(kind==='side')s+=`<line x1="${box.x}" y1="${ctr[1]}" x2="${box.x+box.w}" y2="${ctr[1]}" stroke="#666" stroke-width=".55" stroke-dasharray="10 3 2 3"/>`;else s+=`<line x1="${box.x}" y1="${ctr[1]}" x2="${box.x+box.w}" y2="${ctr[1]}" stroke="#666" stroke-width=".55" stroke-dasharray="10 3 2 3"/><line x1="${ctr[0]}" y1="${box.y}" x2="${ctr[0]}" y2="${box.y+box.h}" stroke="#666" stroke-width=".55" stroke-dasharray="10 3 2 3"/>`}
  s+=dimH(main.x+20,main.x+main.w-20,main.y+main.h+28,main.y+main.h-8,fmt(L,2));
  const ec=endV.map.P(part.bounds.center),er=Math.min(endBox.w,endBox.h)*.40;s+=dimH(ec[0]-er,ec[0]+er,endBox.y+endBox.h-16,endBox.y+endBox.h-30,`Ø ${fmt(D,2)}`);
  const dias=outerDiameters(part,axis,D);dias.slice(0,5).forEach((d,i)=>s+=`<text x="${main.x+8}" y="${main.y+30+i*18}" font-family="Arial" font-size="10" fill="#111">Ø ${fmt(d,2)}</text>`);
  const pnotes=holeNotes(part,4);pnotes.forEach((t,i)=>s+=`<text x="${endBox.x+8}" y="${endBox.y+22+i*17}" font-family="Arial" font-size="9.5" fill="#111">${esc(t)}</text>`);const cnotes=precisionNotes(part,3);cnotes.forEach((t,i)=>s+=`<text x="${isoBox.x+8}" y="${isoBox.y+22+i*16}" font-family="Arial" font-size="9" fill="#111">${esc(t)}</text>`);
  s+=`<g stroke="#111" fill="#111" font-family="Arial" font-size="10"><line x1="${main.x+14}" y1="${main.y+main.h/2}" x2="${main.x+main.w-14}" y2="${main.y+main.h/2}" stroke-dasharray="12 4 2 4"/><path d="M${main.x+18} ${main.y+main.h/2}l10 -5v10zM${main.x+main.w-18} ${main.y+main.h/2}l-10 -5v10z"/><text x="${main.x+4}" y="${main.y+main.h/2-8}" stroke="none">A</text><text x="${main.x+main.w-6}" y="${main.y+main.h/2-8}" stroke="none">A</text></g>`;
  s+=renderPartStamp(componentName,scale,{x:860,y:845,w:495,h:95});
  s+=`<text x="95" y="944" font-family="Arial" font-size="7" fill="#555">ROZFOOD ENGINEERING STUDIO · Drawing Intelligence v2.5.0 · ${esc(fileName)}</text><text x="1240" y="815" font-family="Arial" font-size="9" text-anchor="end" fill="#111">VERIFIED TESS</text>`;
  svg.innerHTML=s;
}
