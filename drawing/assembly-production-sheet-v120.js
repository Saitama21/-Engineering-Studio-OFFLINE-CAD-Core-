import {recognizeTessellationGeometry} from '../core/tess-recognition.js';
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
function mapView(bounds,s,box,pad=10){const ex=projectBounds(bounds,s),sx=Math.max(ex.max[0]-ex.min[0],1),sy=Math.max(ex.max[1]-ex.min[1],1),scale=Math.min((box.w-pad*2)/sx,(box.h-pad*2)/sy),dx=box.x+(box.w-sx*scale)/2-ex.min[0]*scale,dy=box.y+(box.h+sy*scale)/2+ex.min[1]*scale;return{P:p=>{const q=project(p,s);return[dx+q[0]*scale,dy-q[1]*scale]},scale,ext:ex}}
function renderMesh(rec,s,box,{stroke='#111',width=.72,detail=false}={}){const M=mapView(rec.bounds,s,box,detail?2:8),edges=linework(rec,s.dir,{crease:detail ? .94 : .90});let d='';for(const e of edges){const a=M.P(e.a),b=M.P(e.b);if(Math.hypot(a[0]-b[0],a[1]-b[1])<.32)continue;d+=`M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}`;}return{svg:`<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`,map:M}}
function dimH(x1,x2,y,y0,label){return`<g stroke="#111" fill="#111" stroke-width=".8" font-family="Arial,sans-serif" font-size="10"><line x1="${x1}" y1="${y0}" x2="${x1}" y2="${y+4}"/><line x1="${x2}" y1="${y0}" x2="${x2}" y2="${y+4}"/><line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}"/><path d="M${x1} ${y}l6 -2.4v4.8zM${x2} ${y}l-6 -2.4v4.8z"/><text x="${(x1+x2)/2}" y="${y-4}" text-anchor="middle" stroke="none">${esc(label)}</text></g>`}
function dimV(x,y1,y2,x0,label){return`<g stroke="#111" fill="#111" stroke-width=".8" font-family="Arial,sans-serif" font-size="10"><line x1="${x0}" y1="${y1}" x2="${x-4}" y2="${y1}"/><line x1="${x0}" y1="${y2}" x2="${x-4}" y2="${y2}"/><line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}"/><path d="M${x} ${y1}l-2.4 6h4.8zM${x} ${y2}l-2.4 -6h4.8z"/><text x="${x-5}" y="${(y1+y2)/2}" text-anchor="middle" dominant-baseline="middle" transform="rotate(-90 ${x-5} ${(y1+y2)/2})" stroke="none">${esc(label)}</text></g>`}
function axialStations(rec,axis,diam){const R=rec.recognition||{},planes=(R.planes||[]).filter(p=>Math.abs(dot(norm(p.normal),axis))>.99);const vals=[];for(const p of planes){const transverse=p.bounds?.size?.filter((_,i)=>Math.abs(axis[i])<.8)||[];const span=Math.max(...(p.bounds?.size||[0]));if(span<diam*.985)continue;vals.push({t:dot(p.origin,axis),area:p.area||0,span})}vals.sort((a,b)=>a.t-b.t);const out=[];for(const x of vals){const g=out.at(-1);if(g&&Math.abs(g.t-x.t)<1){g.t=(g.t*g.w+x.t*x.area)/(g.w+x.area);g.w+=x.area}else out.push({t:x.t,w:x.area})}return out.map(x=>x.t)}
function outerDiameters(rec,axis,diam){const R=rec.recognition||{},v=[];for(const c of R.outerCylinders||[]){if(!c.full||Math.abs(dot(norm(c.axis),axis))<.99)continue;if(c.diameter<diam*.5)continue;v.push(c.diameter)}const u=[];for(const x of v.sort((a,b)=>b-a))if(!u.some(y=>Math.abs(y-x)<1))u.push(x);if(!u.some(x=>Math.abs(x-diam)<1))u.unshift(diam);return u.slice(0,4)}
function groupedHoles(rec,axis){const m=new Map();for(const h of rec.recognition?.holes||[]){if(!h.full)continue;const d=Math.round(h.diameter*10)/10;if(d>100)continue;const k=d.toFixed(1);m.set(k,(m.get(k)||0)+1)}return[...m.entries()].map(([d,count])=>({d:+d,count})).filter(x=>x.count>=2).sort((a,b)=>b.count-a.count||a.d-b.d).slice(0,3)}
function chooseScale(maxDim){for(const s of [1,2,2.5,4,5,10,20])if(maxDim/s<=300)return`1:${s}`;return'1:20'}
function componentCenters(rec){const m=new Map();for(const f of rec.faces||[]){const id=f.componentId;if(!id)continue;let g=m.get(id);if(!g){g={sum:[0,0,0],n:0,name:f.instance?.name||id};m.set(id,g)}for(const p of f.loops?.[0]||[]){g.sum=add(g.sum,p);g.n++}}for(const g of m.values())g.center=mul(g.sum,1/Math.max(1,g.n));return m}

function renderRecognizedSide(rec,axis,box){
  const {u}=basis(axis),cs=corners(rec.bounds),ts=cs.map(p=>dot(p,axis)),rs=cs.map(p=>dot(p,u)),tmin=Math.min(...ts),tmax=Math.max(...ts),span=tmax-tmin||1;
  const D=Math.max(...(rec.bounds?.size||[1])),sx=(box.w-30)/span,sy=(box.h-34)/Math.max(1,D),cx=box.x+15-tmin*sx,cy=box.y+box.h/2+dot(rec.bounds.center,u)*sy;
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
function renderTitle(projectName,scale,box){const x=box.x,y=box.y,w=box.w,h=box.h;return`<g stroke="#111" fill="none" stroke-width=".7" font-family="Arial,sans-serif"><rect x="${x}" y="${y}" width="${w}" height="${h}"/><line x1="${x+160}" y1="${y}" x2="${x+160}" y2="${y+h}"/><line x1="${x+300}" y1="${y}" x2="${x+300}" y2="${y+h}"/><line x1="${x}" y1="${y+34}" x2="${x+w}" y2="${y+34}"/><line x1="${x}" y1="${y+68}" x2="${x+w}" y2="${y+68}"/><line x1="${x+300}" y1="${y+50}" x2="${x+w}" y2="${y+50}"/><text x="${x+8}" y="${y+15}" fill="#111" stroke="none" font-size="7">Изм.  Лист  № докум.  Подп.  Дата</text><text x="${x+8}" y="${y+31}" fill="#111" stroke="none" font-size="7">Разраб.   ROZFOOD</text><text x="${x+172}" y="${y+24}" fill="#111" stroke="none" font-size="12" font-weight="700">${esc(projectName)} СБ</text><text x="${x+172}" y="${y+56}" fill="#111" stroke="none" font-size="9">Сборочный чертёж · TESS/VERIFY</text><text x="${x+310}" y="${y+16}" fill="#111" stroke="none" font-size="7">Лит.   Масса   Масштаб</text><text x="${x+w-18}" y="${y+45}" text-anchor="end" fill="#111" stroke="none" font-size="13" font-weight="700">${scale}</text><text x="${x+310}" y="${y+62}" fill="#111" stroke="none" font-size="7">Лист 1   Листов 1</text><text x="${x+172}" y="${y+88}" fill="#111" stroke="none" font-size="8">ROZFOOD ENGINEERING STUDIO · A2 AUTO LAYOUT</text></g>`}
function viewLabel(text,x,y,scale=''){return`<text x="${x}" y="${y}" font-family="Arial,sans-serif" font-size="12" fill="#111" font-weight="700">${esc(text)}${scale?` (${scale})`:''}</text>`}

function triPlaneSegment(loop,planePoint,planeNormal,eps=.08){
  if(!loop||loop.length<3)return null;const ds=loop.slice(0,3).map(p=>dot(sub(p,planePoint),planeNormal));
  const pts=[];for(const [i,j] of [[0,1],[1,2],[2,0]]){const a=loop[i],b=loop[j],da=ds[i],db=ds[j];
    if(Math.abs(da)<=eps)pts.push(a);if(da*db<0){const t=da/(da-db);pts.push(add(a,mul(sub(b,a),t)))}}
  const out=[];for(const q of pts)if(!out.some(x=>len(sub(x,q))<eps*2))out.push(q);return out.length>=2?[out[0],out[1]]:null;
}
function renderSection(rec,s,box,planePoint,planeNormal,{stroke='#111',width=.8,hatch=true}={}){
  const M=mapView(rec.bounds,s,box,6),segments=[];for(const f of rec.faces||[]){const seg=triPlaneSegment(f.loops?.[0],planePoint,planeNormal);if(seg)segments.push(seg)}
  let d='';for(const seg of segments){const a=M.P(seg[0]),b=M.P(seg[1]);if(Math.hypot(a[0]-b[0],a[1]-b[1])>.3)d+=`M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}`}
  let svg=`<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${width}"/>`;
  if(hatch){const id='h'+Math.random().toString(36).slice(2,8);svg+=`<defs><pattern id="${id}" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="9" stroke="#888" stroke-width=".45"/></pattern></defs><rect x="${box.x+5}" y="${box.y+5}" width="${box.w-10}" height="${box.h-10}" fill="url(#${id})" opacity=".06"/>`}
  return{svg,map:M,count:segments.length};
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
function renderReferenceStamp(projectName,scale,box){const x=box.x,y=box.y,w=box.w,h=box.h;return`<g stroke="#111" fill="none" stroke-width=".7" font-family="Arial,sans-serif"><rect x="${x}" y="${y}" width="${w}" height="${h}"/><line x1="${x+165}" y1="${y}" x2="${x+165}" y2="${y+h}"/><line x1="${x+310}" y1="${y}" x2="${x+310}" y2="${y+h}"/><line x1="${x}" y1="${y+26}" x2="${x+w}" y2="${y+26}"/><line x1="${x}" y1="${y+54}" x2="${x+w}" y2="${y+54}"/><line x1="${x+310}" y1="${y+42}" x2="${x+w}" y2="${y+42}"/><text x="${x+8}" y="${y+12}" fill="#111" stroke="none" font-size="6.7">Изм.  Лист  № докум.  Подп.  Дата</text><text x="${x+8}" y="${y+24}" fill="#111" stroke="none" font-size="6.7">Разраб.  ROZFOOD</text><text x="${x+176}" y="${y+19}" fill="#111" stroke="none" font-size="12" font-weight="700">${esc(projectName)} СБ</text><text x="${x+176}" y="${y+47}" fill="#111" stroke="none" font-size="8.5">Сборочный чертёж</text><text x="${x+320}" y="${y+12}" fill="#111" stroke="none" font-size="6.7">Лит.   Масса   Масштаб</text><text x="${x+w-16}" y="${y+38}" text-anchor="end" fill="#111" stroke="none" font-size="12" font-weight="700">${scale}</text><text x="${x+320}" y="${y+51}" fill="#111" stroke="none" font-size="6.7">Лист 1   Листов 1</text><text x="${x+176}" y="${y+69}" fill="#111" stroke="none" font-size="7.3">ROZFOOD ENGINEERING STUDIO · VERIFIED GEOMETRY CORE</text></g>`}

function boundsPrincipalAxis(rec){const sz=rec?.bounds?.size||[1,1,1];let i=0;if(sz[1]>sz[i])i=1;if(sz[2]>sz[i])i=2;const a=[0,0,0];a[i]=1;return a}
function assemblyProfile(rec){
  const sz=[...(rec?.bounds?.size||[1,1,1])],ord=sz.map((v,i)=>({v,i})).sort((a,b)=>b.v-a.v),major=ord[0]?.v||1,second=ord[1]?.v||1,majorAxis=[0,0,0];majorAxis[ord[0]?.i||0]=1;
  const cyl=(rec?.recognition?.outerCylinders||[]).find(c=>c.full&&c.diameter>second*.55&&c.length>major*.38&&Math.abs(dot(norm(c.axis),majorAxis))>.96);
  return major/Math.max(second,1)>1.72&&cyl?'AXIAL':'GENERAL';
}
function worldView(kind){if(kind==='top')return{px:[1,0,0],py:[0,1,0],dir:[0,0,1]};if(kind==='side')return{px:[0,1,0],py:[0,0,1],dir:[1,0,0]};if(kind==='iso'){const px=norm([.82,.57,0]),py=norm([-.25,.36,.9]);return{px,py,dir:norm(cross(px,py))}}return{px:[1,0,0],py:[0,0,1],dir:[0,1,0]}}
function patternNotes(rec,limit=5){
  const out=[];for(const p of rec?.recognition?.holePatterns||[]){if(p.count<2)continue;let t=`${p.count} отв. Ø${fmt(p.diameter,2)}`;if(p.pcd)t+=` · PCD Ø${fmt(p.pcd,2)}`;out.push(t);if(out.length>=limit)break}return out;
}
function precisionNotes(rec,limit=5){
  const out=[];for(const g of rec?.recognition?.coaxialGroups||[]){if(g.diameters?.length<2)continue;out.push(`Соосные Ø ${g.diameters.slice(0,4).map(d=>fmt(d,2)).join(' / ')}`);if(out.length>=limit)break}return out;
}
function renderGeneralAssemblySheet(svg,rec,{projectName='SLDASM',fileName='',theme='light'}={}){
  const maxDim=Math.max(...(rec.bounds?.size||[1])),scale=chooseScale(maxDim),bomCount=rec?.nativeAssembly?.components?.length||0,large=bomCount>32;
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
  s+=viewLabel('Главный вид',main.x+4,main.y-9)+mv.svg+viewLabel('Вид сверху',topBox.x+4,topBox.y-9)+tv.svg+viewLabel('Вид справа',sideBox.x+4,sideBox.y-9)+sv.svg+viewLabel('Изометрия',isoBox.x+4,isoBox.y-9)+iv.svg+viewLabel('A–A',sectionBox.x+4,sectionBox.y-9,'разрез')+sm.svg+cut.svg;
  const c1=mv.map.P(rec.bounds.center),c2=tv.map.P(rec.bounds.center),c3=sv.map.P(rec.bounds.center);
  s+=`<g stroke="#666" stroke-width=".55" stroke-dasharray="10 3 2 3"><line x1="${main.x}" y1="${c1[1]}" x2="${main.x+main.w}" y2="${c1[1]}"/><line x1="${c1[0]}" y1="${main.y}" x2="${c1[0]}" y2="${main.y+main.h}"/><line x1="${topBox.x}" y1="${c2[1]}" x2="${topBox.x+topBox.w}" y2="${c2[1]}"/><line x1="${sideBox.x}" y1="${c3[1]}" x2="${sideBox.x+sideBox.w}" y2="${c3[1]}"/></g>`;
  const [sx,sy,sz]=rec.bounds.size;
  s+=dimH(main.x+18,main.x+main.w-18,main.y+main.h+24,main.y+main.h-8,fmt(sx,1));
  s+=dimV(main.x-14,main.y+16,main.y+main.h-16,main.x+5,fmt(sz,1));
  s+=dimV(topBox.x-14,topBox.y+16,topBox.y+topBox.h-16,topBox.x+5,fmt(sy,1));
  s+=renderPositions(rec,rec.nativeAssembly,front,mv.map,main);
  const notes=[...patternNotes(rec,6),...precisionNotes(rec,4)].slice(0,9),notesX=large?1565:1060,notesY=large?520:385;
  if(notes.length){s+=`<g font-family="Arial" fill="#111"><text x="${notesX}" y="${notesY}" font-size="10.5" font-weight="700">Распознанные элементы</text>`;notes.forEach((t,i)=>s+=`<text x="${notesX}" y="${notesY+18+i*15}" font-size="8.5">${esc(t)}</text>`);s+='</g>'}
  s+=`<g stroke="#111" fill="#111" font-family="Arial" font-size="10"><line x1="${main.x+12}" y1="${c1[1]}" x2="${main.x+main.w-12}" y2="${c1[1]}" stroke-dasharray="12 4 2 4"/><path d="M${main.x+18} ${c1[1]}l10 -5v10zM${main.x+main.w-18} ${c1[1]}l-10 -5v10z"/><text x="${main.x+4}" y="${c1[1]-8}" stroke="none">A</text><text x="${main.x+main.w-6}" y="${c1[1]-8}" stroke="none">A</text></g>`;
  s+=renderBOM(rec.nativeAssembly,bomBox);
  s+=renderReferenceStamp(projectName,scale,stampBox);
  s+=`<g font-family="Arial" fill="#111"><text x="${large?105:95}" y="${H-42}" font-size="7" fill="#555">ROZFOOD ENGINEERING STUDIO · Verified Geometry Core v1.2.0 · GENERAL · ${large?'A1':'A2'} · ${esc(fileName)}</text><text x="${W-145}" y="${bomBox.y-12}" font-size="9" text-anchor="end">VERIFIED TESS</text></g>`;
  svg.innerHTML=s;
}

export function renderAssemblyProductionSheet(svg,rec,{projectName='SLDASM',fileName='',theme='light'}={}){
  if(!rec?.faces?.length){svg.setAttribute('viewBox','0 0 1400 990');svg.innerHTML='<rect width="1400" height="990" fill="#fff"/><text x="700" y="490" text-anchor="middle" font-family="Arial" font-size="28">Нет тесселяционной геометрии</text>';return}
  const profile=assemblyProfile(rec);rec.drawingProfile=profile;if(profile==='GENERAL'){renderGeneralAssemblySheet(svg,rec,{projectName,fileName,theme});return}
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
  const pnotes=patternNotes(rec,4);if(pnotes.length)pnotes.forEach((t,i)=>s+=`<text x="${detailCBox.x+8}" y="${detailCBox.y+20+i*16}" font-family="Arial" font-size="9" fill="#111">${esc(t)}</text>`);else{const holes=groupedHoles(rec,axis);holes.forEach((h,i)=>s+=`<text x="${detailCBox.x+8}" y="${detailCBox.y+20+i*16}" font-family="Arial" font-size="9" fill="#111">${h.count} отв. Ø${fmt(h.d,1)}</text>`)}
  // section indicators A-A and B-B
  s+=`<g stroke="#111" fill="#111" font-family="Arial" font-size="10"><line x1="${mainSection.x+14}" y1="${mainSection.y+mainSection.h/2}" x2="${mainSection.x+mainSection.w-14}" y2="${mainSection.y+mainSection.h/2}" stroke-dasharray="12 4 2 4"/><path d="M${mainSection.x+18} ${mainSection.y+mainSection.h/2}l10 -5v10zM${mainSection.x+mainSection.w-18} ${mainSection.y+mainSection.h/2}l-10 -5v10z"/><text x="${mainSection.x+4}" y="${mainSection.y+mainSection.h/2-8}" stroke="none">A</text><text x="${mainSection.x+mainSection.w-6}" y="${mainSection.y+mainSection.h/2-8}" stroke="none">A</text><line x1="${endBox.x+endBox.w/2}" y1="${endBox.y+8}" x2="${endBox.x+endBox.w/2}" y2="${endBox.y+endBox.h-8}" stroke-dasharray="12 4 2 4"/><text x="${endBox.x+endBox.w/2+8}" y="${endBox.y+18}" stroke="none">B</text><text x="${endBox.x+endBox.w/2+8}" y="${endBox.y+endBox.h-10}" stroke="none">B</text></g>`;
  s+=renderPositions(rec,rec.nativeAssembly,side,sideMesh.map,mainSection);
  s+=`<text x="${isoSolid.x+8}" y="${isoSolid.y+isoSolid.h+10}" font-family="Arial" font-size="9" fill="#111">Сборочный изометрический вид</text><text x="${isoExpl.x+8}" y="${isoExpl.y+isoExpl.h+10}" font-family="Arial" font-size="9" fill="#111">B–B (1:5)</text>`;
  s+=renderBOM(rec.nativeAssembly,{x:1030,y:625,w:325,h:205});
  s+=renderReferenceStamp(projectName,scale,{x:860,y:845,w:495,h:95});
  s+=`<g font-family="Arial" fill="#111"><text x="95" y="944" font-size="7" fill="#555">ROZFOOD ENGINEERING STUDIO · Verified Geometry Core v1.2.0 · ${esc(fileName)}</text><text x="1240" y="612" font-size="9" text-anchor="end">VERIFIED TESS</text></g>`;
  svg.innerHTML=s;
}


function renderPartStamp(projectName,scale,box){
  const x=box.x,y=box.y,w=box.w,h=box.h;
  return `<g stroke="#111" fill="none" stroke-width=".7" font-family="Arial,sans-serif"><rect x="${x}" y="${y}" width="${w}" height="${h}"/><line x1="${x+165}" y1="${y}" x2="${x+165}" y2="${y+h}"/><line x1="${x+310}" y1="${y}" x2="${x+310}" y2="${y+h}"/><line x1="${x}" y1="${y+26}" x2="${x+w}" y2="${y+26}"/><line x1="${x}" y1="${y+54}" x2="${x+w}" y2="${y+54}"/><line x1="${x+310}" y1="${y+42}" x2="${x+w}" y2="${y+42}"/><text x="${x+8}" y="${y+12}" fill="#111" stroke="none" font-size="6.7">Изм.  Лист  № докум.  Подп.  Дата</text><text x="${x+8}" y="${y+24}" fill="#111" stroke="none" font-size="6.7">Разраб.  ROZFOOD</text><text x="${x+176}" y="${y+19}" fill="#111" stroke="none" font-size="12" font-weight="700">${esc(projectName)}</text><text x="${x+176}" y="${y+47}" fill="#111" stroke="none" font-size="8.5">Деталь · автоматический чертёж</text><text x="${x+320}" y="${y+12}" fill="#111" stroke="none" font-size="6.7">Лит.   Масса   Масштаб</text><text x="${x+w-16}" y="${y+38}" text-anchor="end" fill="#111" stroke="none" font-size="12" font-weight="700">${scale}</text><text x="${x+320}" y="${y+51}" fill="#111" stroke="none" font-size="6.7">Лист 1   Листов 1</text><text x="${x+176}" y="${y+69}" fill="#111" stroke="none" font-size="7.3">ROZFOOD ENGINEERING STUDIO · VERIFIED GEOMETRY CORE</text></g>`;
}

export function renderComponentProductionSheet(svg,rec,{componentId=null,componentName='Деталь',fileName='',theme='light'}={}){
  const faces=(rec?.faces||[]).filter(f=>!componentId||f.componentId===componentId);
  if(!faces.length){svg.setAttribute('viewBox','0 0 1400 990');svg.innerHTML='<rect width="1400" height="990" fill="#fff"/><text x="700" y="490" text-anchor="middle" font-family="Arial" font-size="28">Выберите деталь в 3D или дереве сборки</text>';return}
  const part=subRecord(rec,faces);part.recognition=recognizeTessellationGeometry(part);
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
  const pnotes=patternNotes(part,4);if(pnotes.length)pnotes.forEach((t,i)=>s+=`<text x="${endBox.x+8}" y="${endBox.y+22+i*17}" font-family="Arial" font-size="9.5" fill="#111">${esc(t)}</text>`);else{const holes=groupedHoles(part,axis);holes.forEach((h,i)=>s+=`<text x="${endBox.x+8}" y="${endBox.y+22+i*17}" font-family="Arial" font-size="9.5" fill="#111">${h.count} отв. Ø${fmt(h.d,2)}</text>`)}const cnotes=precisionNotes(part,3);cnotes.forEach((t,i)=>s+=`<text x="${isoBox.x+8}" y="${isoBox.y+22+i*16}" font-family="Arial" font-size="9" fill="#111">${esc(t)}</text>`);
  s+=`<g stroke="#111" fill="#111" font-family="Arial" font-size="10"><line x1="${main.x+14}" y1="${main.y+main.h/2}" x2="${main.x+main.w-14}" y2="${main.y+main.h/2}" stroke-dasharray="12 4 2 4"/><path d="M${main.x+18} ${main.y+main.h/2}l10 -5v10zM${main.x+main.w-18} ${main.y+main.h/2}l-10 -5v10z"/><text x="${main.x+4}" y="${main.y+main.h/2-8}" stroke="none">A</text><text x="${main.x+main.w-6}" y="${main.y+main.h/2-8}" stroke="none">A</text></g>`;
  s+=renderPartStamp(componentName,scale,{x:860,y:845,w:495,h:95});
  s+=`<text x="95" y="944" font-family="Arial" font-size="7" fill="#555">ROZFOOD ENGINEERING STUDIO · Verified Geometry Core v1.2.0 · ${esc(fileName)}</text><text x="1240" y="815" font-family="Arial" font-size="9" text-anchor="end" fill="#111">VERIFIED TESS</text>`;
  svg.innerHTML=s;
}
