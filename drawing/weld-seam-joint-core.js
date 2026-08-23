// ROZFOOD Contour Semantics Core v5.0.0
// Deterministic drawing intelligence for verified weld-contact geometry.
// Reconstructs likely blade/shell seam paths from analytic helical boundaries and
// provides conservative weld callouts. It does not certify weld procedure or size.

import {analyticViewCurves} from '../core/analytic-geometry.js';

const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const mul=(a,s)=>[a[0]*s,a[1]*s,a[2]*s];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const len=a=>Math.hypot(a[0],a[1],a[2]);
const norm=a=>{const l=len(a)||1;return[a[0]/l,a[1]/l,a[2]/l]};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const esc=x=>String(x??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[m]));

function dominantAxis(rec){const a=rec?.recognition?.dominantAxis;if(a)return norm(a);const s=rec?.bounds?.size||[1,1,1];let i=0;if(s[1]>s[i])i=1;if(s[2]>s[i])i=2;const out=[0,0,0];out[i]=1;return out}
function basis(axis){const a=norm(axis),seed=Math.abs(a[2])<.82?[0,0,1]:[1,0,0],u=norm(cross(a,seed)),v=norm(cross(a,u));return{a,u,v}}
function memberMap(rec){return new Map((rec?.weldedAssembly?.members||[]).map(x=>[x.componentId,x]))}
function jointMap(rec){const out=new Map();for(const j of rec?.weldedAssembly?.joints||[]){for(const id of [j.a,j.b]){let a=out.get(id);if(!a)out.set(id,a=[]);a.push(j)}}return out}
function minorSpan(rec,axis){const b=basis(axis),pts=[];const mn=rec?.bounds?.min||[0,0,0],mx=rec?.bounds?.max||[1,1,1];for(const x of [mn[0],mx[0]])for(const y of [mn[1],mx[1]])for(const z of [mn[2],mx[2]])pts.push([x,y,z]);let ur=[Infinity,-Infinity],vr=[Infinity,-Infinity];for(const p of pts){const q=sub(p,rec.bounds.center);const u=dot(q,b.u),v=dot(q,b.v);ur=[Math.min(ur[0],u),Math.max(ur[1],u)];vr=[Math.min(vr[0],v),Math.max(vr[1],v)]}return Math.max(ur[1]-ur[0],vr[1]-vr[0])}
function lineLength2(points,map){let d=0;for(let i=1;i<points.length;i++){const a=map.P(points[i-1]),b=map.P(points[i]);d+=Math.hypot(b[0]-a[0],b[1]-a[1])}return d}
function polylinePath(points,map){if(!points?.length)return'';const p0=map.P(points[0]);let d=`M${p0[0].toFixed(2)} ${p0[1].toFixed(2)}`;for(let i=1;i<points.length;i++){const p=map.P(points[i]);d+=`L${p[0].toFixed(2)} ${p[1].toFixed(2)}`}return d}
function near2(a,b,tol){return Math.hypot(a[0]-b[0],a[1]-b[1])<=tol}

function consolidateHelices(helices){
  const by=new Map();for(const h of helices){let a=by.get(h.componentId);if(!a)by.set(h.componentId,a=[]);a.push(h)}
  const out=[];
  for(const [componentId,list] of by){
    const maxR=Math.max(...list.map(h=>h.radius||0)),outer=list.filter(h=>Math.abs((h.radius||0)-maxR)<Math.max(1.5,maxR*.008));
    outer.sort((a,b)=>(b.tmax-b.tmin)-(a.tmax-a.tmin));
    const kept=[];
    for(const h of outer){
      const duplicate=kept.some(k=>Math.abs(k.radius-h.radius)<1.1&&Math.abs(k.pitch-h.pitch)<2.2&&Math.min(k.tmax,h.tmax)-Math.max(k.tmin,h.tmin)>-.8*Math.min(k.tmax-k.tmin,h.tmax-h.tmin));
      if(!duplicate)kept.push(h);
    }
    if(kept.length){kept.sort((a,b)=>(b.tmax-b.tmin)-(a.tmax-a.tmin));out.push({...kept[0],componentId})}
  }
  return out;
}

export function reconstructWeldSeams(rec){
  const axis=dominantAxis(rec),minor=minorSpan(rec,axis),members=memberMap(rec),joints=jointMap(rec);
  const bundle=analyticViewCurves(rec,axis,{detail:true,circleSegments:96});
  const helices=(bundle.curves||[]).filter(c=>c.kind==='helix'&&c.role==='helical-feature-boundary');
  const consolidated=consolidateHelices(helices),seams=[];
  for(const h of consolidated){
    const member=members.get(h.componentId),role=member?.role||'';
    if(!/blade\/rib|plate\/rib/.test(role))continue;
    if((h.radius||0)<minor*.42)continue; // must be close to drum shell, not inner blade edge
    const js=(joints.get(h.componentId)||[]).filter(j=>j.kind==='blade-shell'&&j.confidence>=.78);
    if(!js.length)continue;
    const size=js.map(j=>j.filletSize).filter(Number.isFinite).sort((a,b)=>a-b)[Math.floor(js.length/2)]||member?.thickness||3;
    seams.push({id:`HS-${h.componentId}`,componentId:h.componentId,kind:'helical-fillet',points:h.points,radius:h.radius,pitch:h.pitch,size,sideCount:2,confidence:clamp(.82+.12*Math.min(1,js.length/3)+.06*(h.fitError<.025?1:0),0,1),sourceJoints:js.map(j=>j.id)});
  }
  // Add discrete high-confidence joint locations that are not represented by a helical seam.
  const helicalIds=new Set(seams.map(s=>s.componentId)),points=[];
  for(const j of rec?.weldedAssembly?.joints||[]){if(j.confidence<.9||j.kind!=='blade-shell')continue;const blade=[j.a,j.b].find(id=>/blade\/rib/.test(members.get(id)?.role||''));if(blade&&helicalIds.has(blade))continue;if(points.some(p=>len(sub(p.point,j.center))<Math.max(12,minor*.035)))continue;points.push({id:`JP-${j.id}`,kind:'joint-point',point:j.center,size:j.filletSize||3,confidence:j.confidence,sourceJoints:[j.id]});if(points.length>=8)break}
  return{version:'4.0.0',kernel:'ROZFOOD Contour Semantics Core',axis,seams,jointPoints:points,counts:{helicalSeams:seams.length,jointPoints:points.length,total:seams.length+points.length},note:'Weld seams are geometric drawing inferences from analytic helical boundaries and high-confidence contact joints. They are not fabrication-certified weld instructions.'};
}

function filletSymbol(x,y,size=10,flip=false){const s=size,sg=flip?-1:1;return`<path d="M${x} ${y}l${sg*s} 0l${-sg*s} ${-s*.72}z" fill="none"/>`}

export function renderWeldSeams(rec,map,{box=null,label='Сварной шов',showPaths=true,showCallout=true,maxCallouts=1}={}){
  const W=rec.weldSeams||reconstructWeldSeams(rec);rec.weldSeams=W;
  let seamD='',markers='',callouts='',visible=0;
  const seamCandidates=[];
  for(const seam of W.seams||[]){if(!seam.points?.length)continue;const px=seam.points.map(map.P);if(box&&!px.some(p=>p[0]>=box.x-4&&p[0]<=box.x+box.w+4&&p[1]>=box.y-4&&p[1]<=box.y+box.h+4))continue;const L=lineLength2(seam.points,map);if(L<5)continue;if(showPaths)seamD+=polylinePath(seam.points,map);const mid=px[Math.floor(px.length/2)];seamCandidates.push({seam,mid,L});visible++}
  if(showCallout&&seamCandidates.length){
    seamCandidates.sort((a,b)=>b.L-a.L);for(let i=0;i<Math.min(maxCallouts,seamCandidates.length);i++){
      const {seam,mid}=seamCandidates[i],bx=box?Math.min(box.x+box.w-125,Math.max(box.x+12,mid[0]+55)):mid[0]+55,by=box?Math.min(box.y+box.h-28,Math.max(box.y+22,mid[1]+44)):mid[1]+44;
      const elbow=[bx-20,by-8],symbolX=bx-12,symbolY=by-8,txt=`${label}${seam.sideCount>1?` · ${seam.sideCount} шт.`:''}${Number.isFinite(seam.size)?` · a${Math.round(seam.size*10)/10}`:''}`;
      callouts+=`<g class="weld-callout" stroke="#111" fill="none" stroke-width=".75" font-family="Arial,sans-serif"><line x1="${mid[0].toFixed(2)}" y1="${mid[1].toFixed(2)}" x2="${elbow[0].toFixed(2)}" y2="${elbow[1].toFixed(2)}"/><line x1="${elbow[0].toFixed(2)}" y1="${elbow[1].toFixed(2)}" x2="${(bx+86).toFixed(2)}" y2="${elbow[1].toFixed(2)}"/>${filletSymbol(symbolX,symbolY,8,false)}<text x="${bx.toFixed(2)}" y="${(by+7).toFixed(2)}" fill="#111" stroke="none" font-size="9.5">${esc(txt)}</text></g>`;
    }
  }
  if(box&&W.jointPoints?.length){
    for(const j of W.jointPoints){const p=map.P(j.point);if(p[0]<box.x||p[0]>box.x+box.w||p[1]<box.y||p[1]>box.y+box.h)continue;markers+=`<circle cx="${p[0].toFixed(2)}" cy="${p[1].toFixed(2)}" r="2.1" fill="#fff" stroke="#111" stroke-width=".65" data-weld-joint="${esc(j.id)}"/>`}
  }
  return{svg:`<g data-weld-seam-core="v5.0" data-weld-seams="${W.counts.helicalSeams}" data-visible-weld-seams="${visible}" data-weld-joint-points="${W.counts.jointPoints}"><path d="${seamD}" fill="none" stroke="#111" stroke-width=".72" stroke-linecap="round" stroke-linejoin="round"/>${markers}${callouts}</g>`,stats:{...W.counts,visible}};
}

export function renderLocalWeldDetail(rec,map,box,{label='Сварной шов'}={}){
  const W=rec.weldSeams||reconstructWeldSeams(rec);rec.weldSeams=W;
  const center=[box.x+box.w/2,box.y+box.h/2];
  const candidates=[];
  for(const s of W.seams||[]){for(const p of s.points||[]){const q=map.P(p),d=Math.hypot(q[0]-center[0],q[1]-center[1]);candidates.push({s,p:q,d})}}
  candidates.sort((a,b)=>a.d-b.d);const c=candidates[0];if(!c)return{svg:'',found:false};
  const target=c.p,tx=Math.min(box.x+box.w-92,Math.max(box.x+16,target[0]+42)),ty=Math.min(box.y+box.h-18,Math.max(box.y+20,target[1]-26));
  const svg=`<g data-local-weld-detail="v5.0" stroke="#111" fill="none" stroke-width=".8" font-family="Arial,sans-serif"><circle cx="${target[0].toFixed(2)}" cy="${target[1].toFixed(2)}" r="2.4" fill="#fff"/><line x1="${target[0].toFixed(2)}" y1="${target[1].toFixed(2)}" x2="${(tx-9).toFixed(2)}" y2="${ty.toFixed(2)}"/><line x1="${(tx-9).toFixed(2)}" y1="${ty.toFixed(2)}" x2="${(tx+70).toFixed(2)}" y2="${ty.toFixed(2)}"/>${filletSymbol(tx-7,ty,8,false)}<text x="${tx.toFixed(2)}" y="${(ty+12).toFixed(2)}" fill="#111" stroke="none" font-size="9">${esc(label)} · a${Math.round((c.s.size||3)*10)/10}</text></g>`;
  return{svg,found:true,seam:c.s};
}
