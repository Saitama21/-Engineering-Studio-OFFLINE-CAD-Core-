import {basis,dot,norm} from '../core/math3d.js';

const AXES=['X','Y','Z'];
const PLANES={
  XY:{id:'XY',drop:2,uv:[0,1],label:'Вид спереди'},
  XZ:{id:'XZ',drop:1,uv:[0,2],label:'Вид сбоку'},
  YZ:{id:'YZ',drop:0,uv:[1,2],label:'Вид слева'},
};
const MODES={
  sketch:{label:'Каркас',views:1,dimensions:'overall',section:false,notes:false},
  working:{label:'Рабочий',views:2,dimensions:'features',section:false,notes:true},
  production:{label:'Производственный',views:2,dimensions:'features',section:true,notes:true},
  control:{label:'Контрольный',views:3,dimensions:'all',section:true,notes:true},
  assemblyDetailed:{label:'Сборочный детализированный',views:2,dimensions:'overall',section:false,notes:true,assembly:true},
};

export function drawingFromRecognition(rec,dims,options={}){
  if(!rec) return null;
  const sizes=rec.bounds.size.map(v=>Math.max(0,Number(v)||0));
  const ranked=Object.values(PLANES).map(p=>{
    // Keep the longest projected direction horizontal when it materially improves readability.
    const uv=sizes[p.uv[1]]>sizes[p.uv[0]]*1.15?[p.uv[1],p.uv[0]]:[...p.uv];
    return {...p,uv,projectedSize:[sizes[uv[0]],sizes[uv[1]]],score:(sizes[uv[0]]||1)*(sizes[uv[1]]||1)};
  }).sort((a,b)=>b.score-a.score || (a.id==='XZ'?-1:b.id==='XZ'?1:0));
  const primaryAxis=dominantCylinderAxis(rec);
  const main=ranked[0];
  // For rotational parts, pair a longitudinal view with an end view instead of showing two near-duplicates.
  const preferredSecond=main.drop!==primaryAxis?ranked.find(p=>p.drop===primaryAxis):ranked.find(p=>p.id!==main.id);
  const planes=[main,preferredSecond,...ranked.filter(p=>p.id!==main.id&&p.id!==preferredSecond?.id)].filter(Boolean);
  const section=buildAxialSection(rec,primaryAxis);
  const featureSummary=buildFeatureSummary(rec,dims);
  return {
    rec,
    bounds:rec.bounds,
    dimensions:dedupeDimensions(dims||[]),
    views:planes,
    primaryAxis,
    section,
    featureSummary,
    assemblyBOM:buildAssemblyBOM(rec),
    projectName:options.projectName||'Новая модель',
    fileName:options.fileName||'',
    mode:options.mode||'production',
    unit:rec.unit||'mm',
  };
}

export function renderDrawing(svg,drawing,options={}){
  if(!drawing){svg.setAttribute('viewBox','0 0 1200 760');svg.innerHTML='<rect width="1200" height="760" fill="#fff"/><text x="60" y="90" fill="#7f93aa" font-family="system-ui" font-size="22">Нет распознанной модели</text>';return}
  const modeKey=options.mode||drawing.mode||'production';
  const mode=MODES[modeKey]||MODES.production;
  const projectName=options.projectName||drawing.projectName||'Новая модель';
  const fileName=options.fileName||drawing.fileName||'';
  const theme=options.theme||((typeof document!=='undefined'&&document.documentElement?.dataset?.theme)||'light');
  svg.setAttribute('viewBox','0 0 1200 760');
  svg.setAttribute('role','img');
  svg.setAttribute('aria-label',`Автоматический инженерный чертёж: ${projectName}`);

  const colors=theme==='dark'?{
    workspace:'#111827',sheet:'#fdfefe',ink:'#101820',muted:'#566474',blue:'#1c71d8',construction:'#7793af',hatch:'#8494a6',pcd:'#527aa6',title:'#0d2438',note:'#43566a'
  }:{workspace:'#eef2f6',sheet:'#ffffff',ink:'#101820',muted:'#5c6773',blue:'#1769c2',construction:'#7d91a8',hatch:'#8fa1b4',pcd:'#4f78a5',title:'#0d2438',note:'#4f5f70'};

  const defs=`<defs>
    <marker id="dimArr" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 z" fill="${colors.blue}"/></marker>
    <marker id="leaderArr" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="${colors.blue}"/></marker>
    <pattern id="hatch45" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="10" stroke="${colors.hatch}" stroke-width="1.2"/></pattern>
    <filter id="sheetShadow" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="8" stdDeviation="10" flood-color="#102030" flood-opacity=".12"/></filter>
  </defs>`;
  let s=`${defs}<rect width="1200" height="760" fill="${colors.workspace}"/><g filter="url(#sheetShadow)"><rect x="10" y="10" width="1180" height="740" rx="2" fill="${colors.sheet}"/></g><rect x="22" y="22" width="1156" height="716" fill="none" stroke="${colors.ink}" stroke-width="1.8"/>`;

  const selected=drawing.views.slice(0,mode.views);
  if(mode.assembly){
    s+=renderAssemblyDetailed(drawing,selected,colors);
  }else if(mode.views===1){
    s+=renderProjectionView(drawing,selected[0],{x:60,y:70,w:1080,h:500},colors,{showFeatures:mode.dimensions!=='overall',showOverall:true,main:true});
  }else{
    s+=renderProjectionView(drawing,selected[0],{x:55,y:65,w:650,h:515},colors,{showFeatures:true,showOverall:true,main:true});
    s+=renderProjectionView(drawing,selected[1],{x:735,y:70,w:400,h:245},colors,{showFeatures:false,showOverall:true,main:false});
    if(mode.section&&drawing.section){
      s+=renderSectionView(drawing.section,{x:735,y:340,w:400,h:250},colors);
    }else if(mode.views>=3&&selected[2]){
      s+=renderProjectionView(drawing,selected[2],{x:735,y:340,w:400,h:250},colors,{showFeatures:false,showOverall:true,main:false});
    }else{
      s+=renderFeaturePanel(drawing,{x:735,y:345,w:400,h:235},colors);
    }
  }

  if(!mode.assembly&&mode.views>=3&&selected[2]&&drawing.section){
    // Control mode: small third orthographic view above title block.
    s+=renderProjectionView(drawing,selected[2],{x:60,y:500,w:260,h:120},colors,{showFeatures:false,showOverall:false,main:false,compact:true});
  }

  if(mode.notes&&!mode.assembly) s+=renderNotes(drawing,{x:55,y:598,w:640,h:50},colors);
  s+=renderTitleBlock({projectName,fileName,unit:drawing.unit,mode:mode.label,rec:drawing.rec},{x:720,y:610,w:440,h:112},colors);
  s+=`<text x="55" y="715" fill="${colors.muted}" font-family="system-ui,-apple-system,sans-serif" font-size="11">ROZFOOD ENGINEERING STUDIO · Drawing Core v0.7.0 · SLDASM FaceTessellations локально</text>`;
  svg.innerHTML=s;
}

export function serializeDrawing(svg){
  const clone=svg.cloneNode(true);
  clone.setAttribute('xmlns','http://www.w3.org/2000/svg');
  return '<?xml version="1.0" encoding="UTF-8"?>\n'+clone.outerHTML;
}

function renderProjectionView(drawing,plane,box,c,opt={}){
  const geom=projectGeometry(drawing.rec,plane);
  const ext=geom.extents;
  const spanX=Math.max(ext.max[0]-ext.min[0],1e-6),spanY=Math.max(ext.max[1]-ext.min[1],1e-6);
  const reserve=opt.showOverall?54:24;
  const scale=Math.min((box.w-44)/spanX,(box.h-reserve-34)/spanY);
  const drawW=spanX*scale,drawH=spanY*scale;
  const ox=box.x+(box.w-drawW)/2-ext.min[0]*scale;
  const oy=box.y+24+(box.h-reserve-34+drawH)/2+ext.min[1]*scale;
  const P=([u,v])=>[ox+u*scale,oy-v*scale];
  let s=`<g class="drawing-view" data-plane="${plane.id}"><text x="${box.x+8}" y="${box.y+16}" fill="${c.title}" font-family="system-ui,-apple-system,sans-serif" font-size="14" font-weight="700">${escapeXml(plane.label)} · ${plane.id}</text>`;
  // geometry: lines first, then curves
  s+=`<g fill="none" stroke="${c.ink}" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">`;
  for(const item of geom.items){
    if(item.kind==='line'){
      const a=P(item.p1),b=P(item.p2);s+=`<line x1="${n(a[0])}" y1="${n(a[1])}" x2="${n(b[0])}" y2="${n(b[1])}"/>`;
    }else if(item.kind==='circle'){
      const q=P(item.center);s+=`<circle cx="${n(q[0])}" cy="${n(q[1])}" r="${n(item.r*scale)}"/>`;
    }else if(item.kind==='polyline'){
      const pts=item.points.map(p=>P(p).map(n).join(',')).join(' ');s+=`<polyline points="${pts}"/>`;
    }
  }
  s+='</g>';
  // center lines on face-on circles
  s+=`<g stroke="${c.construction}" stroke-width="1" stroke-dasharray="10 4 2 4" fill="none">`;
  for(const item of geom.items.filter(x=>x.kind==='circle')){
    const q=P(item.center),rr=item.r*scale,ex=Math.max(8,Math.min(18,rr*.25));
    s+=`<line x1="${n(q[0]-rr-ex)}" y1="${n(q[1])}" x2="${n(q[0]+rr+ex)}" y2="${n(q[1])}"/><line x1="${n(q[0])}" y1="${n(q[1]-rr-ex)}" x2="${n(q[0])}" y2="${n(q[1]+rr+ex)}"/>`;
  }
  s+='</g>';

  if(opt.main) s+=renderPatternInView(drawing,plane,P,scale,box,c);
  if(opt.showOverall) s+=renderOverallDims(ext,P,box,c,plane);
  if(opt.main&&opt.showFeatures) s+=renderFeatureCallouts(drawing,plane,P,scale,box,c);
  s+=`<text x="${box.x+box.w-8}" y="${box.y+box.h-4}" text-anchor="end" fill="${c.muted}" font-family="system-ui" font-size="10">проекция ${AXES[plane.uv[0]]}${AXES[plane.uv[1]]}</text></g>`;
  return s;
}

function renderOverallDims(ext,P,box,c,plane){
  const bl=P([ext.min[0],ext.min[1]]),br=P([ext.max[0],ext.min[1]]),tl=P([ext.min[0],ext.max[1]]);
  const y=Math.min(box.y+box.h-25,Math.max(bl[1],br[1])+28),x=Math.max(box.x+23,Math.min(bl[0],tl[0])-30);
  const w=ext.max[0]-ext.min[0],h=ext.max[1]-ext.min[1];
  let s=`<g stroke="${c.blue}" fill="${c.blue}" stroke-width="1.1" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" font-size="12">`;
  s+=`<line x1="${n(bl[0])}" y1="${n(bl[1])}" x2="${n(bl[0])}" y2="${n(y+7)}"/><line x1="${n(br[0])}" y1="${n(br[1])}" x2="${n(br[0])}" y2="${n(y+7)}"/><line x1="${n(bl[0])}" y1="${n(y)}" x2="${n(br[0])}" y2="${n(y)}" marker-start="url(#dimArr)" marker-end="url(#dimArr)"/><text x="${n((bl[0]+br[0])/2)}" y="${n(y-7)}" text-anchor="middle" stroke="none">${fmtDim(w)}</text>`;
  s+=`<line x1="${n(bl[0])}" y1="${n(bl[1])}" x2="${n(x-6)}" y2="${n(bl[1])}"/><line x1="${n(tl[0])}" y1="${n(tl[1])}" x2="${n(x-6)}" y2="${n(tl[1])}"/><line x1="${n(x)}" y1="${n(bl[1])}" x2="${n(x)}" y2="${n(tl[1])}" marker-start="url(#dimArr)" marker-end="url(#dimArr)"/><text x="${n(x-8)}" y="${n((bl[1]+tl[1])/2)}" text-anchor="middle" dominant-baseline="middle" transform="rotate(-90 ${n(x-8)} ${n((bl[1]+tl[1])/2)})" stroke="none">${fmtDim(h)}</text>`;
  s+=`</g>`;return s;
}

function renderPatternInView(drawing,plane,P,scale,box,c){
  const patterns=(drawing.rec.boltPatterns||[]).filter(p=>axisParallelToDrop(p.axis,plane.drop));
  if(!patterns.length)return '';
  let s='';
  for(const p of patterns.slice(0,2)){
    const center3=boltPatternCenter3D(drawing.rec,p,plane.drop);
    if(!center3)continue;
    const q=P([center3[plane.uv[0]],center3[plane.uv[1]]]);
    s+=`<circle cx="${n(q[0])}" cy="${n(q[1])}" r="${n(p.pcd/2*scale)}" fill="none" stroke="${c.pcd}" stroke-width="1" stroke-dasharray="12 5 2 5"/>`;
  }
  return s;
}

function renderFeatureCallouts(drawing,plane,P,scale,box,c){
  let s=`<g font-family="system-ui,-apple-system,sans-serif" font-size="12" fill="${c.title}" stroke="${c.blue}" stroke-width="1.1">`;
  const pattern=(drawing.rec.boltPatterns||[]).find(p=>axisParallelToDrop(p.axis,plane.drop));
  if(pattern){
    const candidates=projectedFaceOnCircles(drawing.rec,plane).filter(x=>Math.abs(x.r-pattern.holeDiameter/2)<1e-3);
    const target=candidates[0];
    if(target){const q=P(target.center),tx=box.x+box.w-205,ty=box.y+42;s+=`<polyline points="${n(q[0])},${n(q[1])} ${n(tx-12)},${n(ty+4)} ${n(tx)},${n(ty+4)}" fill="none" marker-start="url(#leaderArr)"/><text x="${tx+4}" y="${ty}" stroke="none" font-weight="700">${pattern.count}× ⌀${fmtDim(pattern.holeDiameter)}</text><text x="${tx+4}" y="${ty+17}" stroke="none">равномерно · PCD ⌀${fmtDim(pattern.pcd)}</text>`;}
  }
  // central/major diameters in a face-on view
  const circles=projectedFaceOnCircles(drawing.rec,plane).sort((a,b)=>b.r-a.r);
  const center=projectCenter(drawing.rec.bounds.center,plane);
  const centered=circles.filter(x=>Math.hypot(x.center[0]-center[0],x.center[1]-center[1])<Math.max(.03,Math.max(...drawing.rec.bounds.size)*.003));
  const unique=[];for(const x of centered){if(!unique.some(y=>Math.abs(y.r-x.r)<1e-4))unique.push(x)}
  let offset=0;
  for(const x of unique.slice(0,3)){
    const q=P(x.center),rr=x.r*scale;
    const y=q[1]-offset;
    s+=`<line x1="${n(q[0]-rr)}" y1="${n(y)}" x2="${n(q[0]+rr)}" y2="${n(y)}" marker-start="url(#dimArr)" marker-end="url(#dimArr)"/><text x="${n(q[0])}" y="${n(y-7)}" text-anchor="middle" stroke="none" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" font-weight="700">⌀${fmtDim(x.r*2)}</text>`;
    offset+=20;
  }
  return s+'</g>';
}

function renderSectionView(section,box,c){
  const axialSpan=Math.max(section.max-section.min,1e-6),maxR=Math.max(...section.intervals.map(x=>x.outer),1);
  const scale=Math.min((box.w-70)/axialSpan,(box.h-75)/(maxR*2));
  const ox=box.x+(box.w-axialSpan*scale)/2-section.min*scale,cy=box.y+box.h/2+8;
  const X=v=>ox+v*scale,Y=r=>cy-r*scale;
  let s=`<g><text x="${box.x+8}" y="${box.y+16}" fill="${c.title}" font-family="system-ui" font-size="14" font-weight="700">Разрез A–A · ось ${AXES[section.axis]}</text>`;
  // section material by axial interval
  for(const iv of section.intervals){
    const x1=X(iv.a),x2=X(iv.b),ow=iv.outer*scale,iw=(iv.inner||0)*scale;
    if(iw>0){
      s+=`<path d="M${n(x1)} ${n(cy-ow)}H${n(x2)}V${n(cy-iw)}H${n(x1)}Z M${n(x1)} ${n(cy+iw)}H${n(x2)}V${n(cy+ow)}H${n(x1)}Z" fill="url(#hatch45)" stroke="${c.ink}" stroke-width="1.3"/>`;
    }else{
      s+=`<rect x="${n(x1)}" y="${n(cy-ow)}" width="${n(Math.max(1,x2-x1))}" height="${n(ow*2)}" fill="url(#hatch45)" stroke="${c.ink}" stroke-width="1.3"/>`;
    }
  }
  s+=`<line x1="${n(X(section.min)-16)}" y1="${n(cy)}" x2="${n(X(section.max)+16)}" y2="${n(cy)}" stroke="${c.construction}" stroke-width="1" stroke-dasharray="10 4 2 4"/>`;
  // segment length dimensions
  let level=0;
  for(const iv of section.intervals){
    const y=box.y+box.h-18-level*17,x1=X(iv.a),x2=X(iv.b);s+=`<g stroke="${c.blue}" fill="${c.blue}" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" font-size="10"><line x1="${n(x1)}" y1="${n(y)}" x2="${n(x2)}" y2="${n(y)}" marker-start="url(#dimArr)" marker-end="url(#dimArr)"/><text x="${n((x1+x2)/2)}" y="${n(y-5)}" text-anchor="middle" stroke="none">${fmtDim(iv.b-iv.a)}</text></g>`;level=(level+1)%2;
  }
  // diameter notes
  const diameters=[...new Set(section.intervals.map(iv=>iv.outer*2).concat(section.intervals.filter(iv=>iv.inner>0).map(iv=>iv.inner*2)))].sort((a,b)=>b-a);
  diameters.slice(0,5).forEach((d,i)=>{s+=`<text x="${box.x+box.w-8}" y="${box.y+34+i*15}" text-anchor="end" fill="${c.blue}" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" font-size="11">⌀${fmtDim(d)}</text>`});
  s+='</g>';return s;
}

function renderFeaturePanel(drawing,box,c){
  const rows=drawing.featureSummary.slice(0,8);
  let s=`<g><rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="8" fill="#f8fafc" stroke="#d8e0e8"/><text x="${box.x+15}" y="${box.y+24}" fill="${c.title}" font-family="system-ui" font-size="14" font-weight="700">Распознанные элементы</text>`;
  rows.forEach((r,i)=>{const y=box.y+48+i*22;s+=`<circle cx="${box.x+18}" cy="${y-4}" r="3" fill="${c.blue}"/><text x="${box.x+30}" y="${y}" fill="${c.note}" font-family="system-ui" font-size="11.5">${escapeXml(r)}</text>`});
  return s+'</g>';
}

function renderNotes(drawing,box,c){
  const notes=[];
  if(drawing.rec.boltPatterns?.length) notes.push('Отверстия/PCD извлечены из цилиндрической геометрии STEP.');
  if(drawing.rec.counts?.bsplines) notes.push('B‑Spline присутствует: контур требует визуальной проверки.');
  notes.push('Авторазмеры — геометрические; допуски и шероховатость задаются отдельно.');
  let s=`<g><text x="${box.x}" y="${box.y+14}" fill="${c.title}" font-family="system-ui" font-size="11" font-weight="700">Технические примечания</text>`;
  notes.slice(0,2).forEach((t,i)=>{s+=`<text x="${box.x}" y="${box.y+30+i*15}" fill="${c.note}" font-family="system-ui" font-size="10.5">${i+1}. ${escapeXml(t)}</text>`});
  return s+'</g>';
}

function renderTitleBlock(meta,box,c){
  const r=meta.rec,counts=r.counts||{};
  const x=box.x,y=box.y,w=box.w,h=box.h;
  const split=x+w*.58,leftW=split-x,rightW=x+w-split;
  const brand2='ENGINEERING STUDIO';
  const modeSize=fitFont(meta.mode,rightW-20,10.8,8.2);
  const projectSize=fitFont(meta.projectName,leftW-24,15,10.5);
  let s=`<g stroke="${c.ink}" fill="none" stroke-width="1"><rect x="${x}" y="${y}" width="${w}" height="${h}"/><line x1="${x}" y1="${y+40}" x2="${x+w}" y2="${y+40}"/><line x1="${x}" y1="${y+72}" x2="${x+w}" y2="${y+72}"/><line x1="${split}" y1="${y}" x2="${split}" y2="${y+h}"/><line x1="${split}" y1="${y+22}" x2="${x+w}" y2="${y+22}"/><line x1="${split}" y1="${y+44}" x2="${x+w}" y2="${y+44}"/><line x1="${split}" y1="${y+66}" x2="${x+w}" y2="${y+66}"/><line x1="${split}" y1="${y+88}" x2="${x+w}" y2="${y+88}"/>`;
  // Mobile-safe brand: two lines inside the left cell instead of overflowing into the mode column.
  s+=`<text x="${x+12}" y="${y+14}" fill="${c.blue}" stroke="none" font-family="system-ui" font-size="8.6" font-weight="800" letter-spacing="1.25">ROZFOOD</text>`;
  s+=`<text x="${x+12}" y="${y+31}" fill="${c.title}" stroke="none" font-family="system-ui" font-size="13.2" font-weight="800">${brand2}</text>`;
  s+=`<text x="${x+12}" y="${y+61}" fill="${c.ink}" stroke="none" font-family="system-ui" font-size="${projectSize}" font-weight="700">${escapeXml(meta.projectName)}</text>`;
  s+=`<text x="${x+12}" y="${y+88}" fill="${c.muted}" stroke="none" font-family="system-ui" font-size="9.4">Файл: ${escapeXml(meta.fileName||'—')}</text><text x="${x+12}" y="${y+103}" fill="${c.muted}" stroke="none" font-family="system-ui" font-size="9.4">B‑Rep: ${counts.faces||0} граней · ${counts.edges||0} рёбер</text>`;
  const row=(label,value,yy,{mono=false,blue=false,size=10.2}={})=>`<text x="${split+9}" y="${yy-5}" fill="${c.muted}" stroke="none" font-family="system-ui" font-size="7.8">${label}</text><text x="${x+w-9}" y="${yy+7}" text-anchor="end" fill="${blue?c.blue:c.ink}" stroke="none" font-family="${mono?'ui-monospace,SFMono-Regular,Menlo,monospace':'system-ui'}" font-size="${size}" font-weight="${blue||label==='РЕЖИМ'?'700':'600'}">${escapeXml(value)}</text>`;
  s+=row('РЕЖИМ',meta.mode,y+11,{size:modeSize});
  s+=row('ЕДИНИЦЫ',meta.unit,y+33,{mono:true,size:10});
  s+=row('МАСШТАБ','AUTO',y+55,{mono:true,size:10});
  s+=row('СТАТУС','AUTO / VERIFY',y+77,{blue:true,size:9.3});
  s+=row('ЯДРО','v0.7.0',y+99,{mono:true,size:8.8});
  s+='</g>';
  return s;
}

function projectGeometry(rec,plane){
  const items=[],points=[];
  for(const e of rec.edges||[]){
    if(e.kind==='line'&&e.p1&&e.p2){const p1=projectCenter(e.p1,plane),p2=projectCenter(e.p2,plane);items.push({kind:'line',p1,p2,instance:e.instance||null});points.push(p1,p2);continue}
    if((e.kind==='circle'||e.kind==='ellipse')&&e.placement){
      if(e.kind==='circle'&&axisParallelToDrop(e.placement.axis,plane.drop)){
        const center=projectCenter(e.placement.origin,plane);items.push({kind:'circle',center,r:e.radius,source:e,instance:e.instance||null});points.push([center[0]-e.radius,center[1]-e.radius],[center[0]+e.radius,center[1]+e.radius]);
      }else{
        const pts=sampleCurve3D(e,64).map(p=>projectCenter(p,plane));items.push({kind:'polyline',points:pts,source:e,instance:e.instance||null});points.push(...pts);
      }
    }
  }
  if(!points.length){const b=rec.bounds;points.push([b.min[plane.uv[0]],b.min[plane.uv[1]]],[b.max[plane.uv[0]],b.max[plane.uv[1]]])}
  const min=[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1]))],max=[Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))];
  return {items,extents:{min,max}};
}

function sampleCurve3D(e,count=48){
  const pl=e.placement,{x,y}=basis(pl.axis,pl.refdir),o=pl.origin,rx=e.kind==='ellipse'?e.r1:e.radius,ry=e.kind==='ellipse'?e.r2:e.radius,pts=[];
  for(let i=0;i<=count;i++){const a=i/count*Math.PI*2;pts.push([o[0]+x[0]*Math.cos(a)*rx+y[0]*Math.sin(a)*ry,o[1]+x[1]*Math.cos(a)*rx+y[1]*Math.sin(a)*ry,o[2]+x[2]*Math.cos(a)*rx+y[2]*Math.sin(a)*ry])}
  return pts;
}

function projectedFaceOnCircles(rec,plane){return (rec.edges||[]).filter(e=>e.kind==='circle'&&e.placement&&axisParallelToDrop(e.placement.axis,plane.drop)).map(e=>({center:projectCenter(e.placement.origin,plane),r:e.radius,source:e}))}
function projectCenter(p,plane){return [p[plane.uv[0]],p[plane.uv[1]]]}
function axisParallelToDrop(axis,drop){const a=norm(axis||[0,0,1]);return Math.abs(a[drop])>.985}

function dominantCylinderAxis(rec){
  const score=[0,0,0];for(const c of rec.cylinders||[]){const a=(c.placement?.axis||[0,0,1]).map(Math.abs);const i=a.indexOf(Math.max(...a));score[i]++}return score.indexOf(Math.max(...score));
}

function buildAxialSection(rec,axis){
  const transverse=[0,1,2].filter(i=>i!==axis),center=rec.bounds.center;
  const tol=Math.max(.02,Math.max(...rec.bounds.size)*.004);
  const centeredCircles=(rec.edges||[]).filter(e=>e.kind==='circle'&&e.placement&&axisParallelToDrop(e.placement.axis,axis)&&Math.hypot(e.placement.origin[transverse[0]]-center[transverse[0]],e.placement.origin[transverse[1]]-center[transverse[1]])<=tol);
  if(centeredCircles.length<2)return null;
  const byRadius=new Map();
  for(const e of centeredCircles){const k=Math.round(e.radius*1e4)/1e4;if(!byRadius.has(k))byRadius.set(k,[]);byRadius.get(k).push(e.placement.origin[axis])}
  const segments=[];
  for(const [r,coords0] of byRadius){const coords=[...new Set(coords0.map(v=>Math.round(v*1e4)/1e4))].sort((a,b)=>a-b);if(coords.length<2)continue;for(let i=0;i<coords.length-1;i++){const a=coords[i],b=coords[i+1];if(b-a>tol)segments.push({a,b,r})}}
  if(!segments.length)return null;
  const cuts=[...new Set(segments.flatMap(s=>[s.a,s.b]))].sort((a,b)=>a-b),intervals=[];
  for(let i=0;i<cuts.length-1;i++){const a=cuts[i],b=cuts[i+1],mid=(a+b)/2,active=segments.filter(s=>mid>=s.a-tol&&mid<=s.b+tol);if(!active.length)continue;const radii=active.map(s=>s.r).sort((x,y)=>x-y);intervals.push({a,b,outer:radii[radii.length-1],inner:radii.length>1?radii[0]:0})}
  if(!intervals.length)return null;
  return {axis,min:Math.min(...intervals.map(i=>i.a)),max:Math.max(...intervals.map(i=>i.b)),intervals};
}


function renderAssemblyDetailed(drawing,selected,c){
  const main=selected[0]||drawing.views[0],second=selected[1]||drawing.views[1]||drawing.views[0];
  if(!drawing.rec.isAssembly){
    return `<g font-family="system-ui"><text x="65" y="95" fill="${c.title}" font-size="22" font-weight="800">Сборочный детализированный</text><text x="65" y="130" fill="${c.muted}" font-size="15">Этот режим предназначен для STEP-сборок. Для одиночной детали используйте «Рабочий» или «Производственный».</text></g>`+
      renderProjectionView(drawing,main,{x:55,y:160,w:1080,h:390},c,{showFeatures:false,showOverall:true,main:true});
  }
  let s=`<text x="55" y="52" fill="${c.title}" font-family="system-ui" font-size="17" font-weight="800">Сборочный детализированный · позиции + спецификация</text>`;
  const mainBox={x:55,y:68,w:690,h:485},sideBox={x:780,y:70,w:350,h:205};
  s+=renderProjectionView(drawing,main,mainBox,c,{showFeatures:false,showOverall:true,main:false});
  s+=renderAssemblyPositions(drawing,main,mainBox,c);
  s+=renderProjectionView(drawing,second,sideBox,c,{showFeatures:false,showOverall:true,main:false});
  s+=renderAssemblyBOM(drawing,{x:770,y:300,w:370,h:285},c);
  s+=renderAssemblyNotes(drawing,{x:55,y:575,w:640,h:62},c);
  return s;
}

function renderAssemblyPositions(drawing,plane,box,c){
  const entries=drawing.assemblyBOM||[];if(!entries.length)return '';
  const geom=projectGeometry(drawing.rec,plane),ext=geom.extents;
  const spanX=Math.max(ext.max[0]-ext.min[0],1e-6),spanY=Math.max(ext.max[1]-ext.min[1],1e-6);
  const scale=Math.min((box.w-44)/spanX,(box.h-88)/spanY),drawW=spanX*scale,drawH=spanY*scale;
  const ox=box.x+(box.w-drawW)/2-ext.min[0]*scale,oy=box.y+24+(box.h-88+drawH)/2+ext.min[1]*scale;
  const P=([u,v])=>[ox+u*scale,oy-v*scale];
  const byInstance=new Map();
  for(const e of drawing.rec.edges||[]){if(!e.instance)continue;const arr=byInstance.get(e.instance)||[];if(e.kind==='line'){if(e.p1)arr.push(e.p1);if(e.p2)arr.push(e.p2)}else if(e.placement)arr.push(e.placement.origin);byInstance.set(e.instance,arr)}
  let s=`<g font-family="system-ui" stroke="${c.blue}" fill="none" stroke-width="1.2">`,idx=0;
  for(const item of entries){
    const names=item.occurrenceNames||[];let pts=[];for(const name of names){const a=byInstance.get(name);if(a?.length){pts=a;break}}
    if(!pts.length)continue;
    const center3=[0,0,0];for(const p of pts)for(let k=0;k<3;k++)center3[k]+=p[k]/pts.length;
    const q=P(projectCenter(center3,plane));
    const bx=box.x+box.w-28-(idx%2)*44,by=box.y+48+idx*46;idx++;
    s+=`<polyline points="${n(q[0])},${n(q[1])} ${n(bx-18)},${n(by)} ${n(bx-12)},${n(by)}" marker-start="url(#leaderArr)"/>`;
    s+=`<circle cx="${n(bx)}" cy="${n(by)}" r="13" fill="#fff"/><text x="${n(bx)}" y="${n(by+4)}" text-anchor="middle" fill="${c.blue}" stroke="none" font-size="11" font-weight="800">${item.position}</text>`;
  }
  return s+'</g>';
}

function renderAssemblyBOM(drawing,box,c){
  const rows=(drawing.assemblyBOM||[]).slice(0,9),rh=24,titleH=30,headerH=24;
  let s=`<g font-family="system-ui"><rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="#fff" stroke="${c.ink}" stroke-width="1.1"/><text x="${box.x+12}" y="${box.y+20}" fill="${c.title}" font-size="13" font-weight="800">СПЕЦИФИКАЦИЯ · BOM</text>`;
  const y0=box.y+titleH,headerBottom=y0+headerH,c1=box.x+44,c2=box.x+box.w-62;
  s+=`<line x1="${box.x}" y1="${y0}" x2="${box.x+box.w}" y2="${y0}" stroke="${c.ink}"/><line x1="${box.x}" y1="${headerBottom}" x2="${box.x+box.w}" y2="${headerBottom}" stroke="${c.ink}"/><line x1="${c1}" y1="${y0}" x2="${c1}" y2="${box.y+box.h}" stroke="${c.ink}"/><line x1="${c2}" y1="${y0}" x2="${c2}" y2="${box.y+box.h}" stroke="${c.ink}"/>`;
  s+=`<text x="${box.x+22}" y="${y0+16}" text-anchor="middle" fill="${c.muted}" font-size="9" font-weight="700">ПОЗ.</text><text x="${c1+8}" y="${y0+16}" fill="${c.muted}" font-size="9" font-weight="700">КОМПОНЕНТ</text><text x="${box.x+box.w-31}" y="${y0+16}" text-anchor="middle" fill="${c.muted}" font-size="9" font-weight="700">КОЛ.</text>`;
  let y=headerBottom;
  for(const row of rows){
    const y2=y+rh;
    s+=`<line x1="${box.x}" y1="${y2}" x2="${box.x+box.w}" y2="${y2}" stroke="${c.construction}" stroke-width=".7"/>`;
    s+=`<text x="${box.x+22}" y="${y+16}" text-anchor="middle" fill="${c.ink}" font-size="10" font-weight="700">${row.position}</text><text x="${c1+8}" y="${y+16}" fill="${c.ink}" font-size="10">${escapeXml(row.name)}</text><text x="${box.x+box.w-31}" y="${y+16}" text-anchor="middle" fill="${c.ink}" font-size="10" font-weight="700">${row.count}</text>`;
    y=y2;
  }
  if((drawing.assemblyBOM||[]).length>rows.length)s+=`<text x="${c1+8}" y="${box.y+box.h-9}" fill="${c.muted}" font-size="9">+ ещё ${(drawing.assemblyBOM||[]).length-rows.length} поз.</text>`;
  return s+'</g>';
}

function renderAssemblyNotes(drawing,box,c){
  const count=drawing.rec.occurrences?.length||drawing.rec.instances?.length||0,bom=drawing.assemblyBOM||[];
  return `<g font-family="system-ui"><text x="${box.x}" y="${box.y+14}" fill="${c.title}" font-size="11" font-weight="800">Сборочные данные</text><text x="${box.x}" y="${box.y+31}" fill="${c.note}" font-size="10.5">1. ${bom.length} позиций · ${count} вхождений. Позиции связаны с экземплярами STEP.</text><text x="${box.x}" y="${box.y+47}" fill="${c.note}" font-size="10.5">2. Посадки, крепёжные требования и моменты затяжки требуют конструкторского подтверждения.</text></g>`;
}

function buildAssemblyBOM(rec){
  if(!rec?.isAssembly)return [];
  const occ=rec.occurrences||[];
  const groups=new Map();
  for(const o of occ){
    const key=o.child||o.name||o.id;
    let g=groups.get(key);if(!g){g={name:cleanOccurrenceName(o.name||`Component ${o.id}`),count:0,occurrenceNames:[]};groups.set(key,g)}
    g.count++;g.occurrenceNames.push(o.name||`Component ${o.id}`);
  }
  if(!groups.size&&rec.instances?.length){for(const i of rec.instances){const key=cleanOccurrenceName(i.name);let g=groups.get(key);if(!g){g={name:key,count:0,occurrenceNames:[]};groups.set(key,g)}g.count++;g.occurrenceNames.push(i.name)}}
  return [...groups.values()].map((g,i)=>({...g,position:i+1}));
}
function cleanOccurrenceName(name){return String(name||'').replace(/[-_ ]?\d+$/,'').replace(/[-_]?[A-Z]$/,'')||String(name||'Component')}
function dedupeDimensions(dims){
  const out=[],seen=new Set();
  for(const d of dims){const k=[d.type,Number(d.value).toFixed(4),d.unit,d.count||'',d.holeDiameter?Number(d.holeDiameter).toFixed(4):''].join('|');if(seen.has(k))continue;seen.add(k);out.push(d)}
  return out;
}
function fitFont(text,maxWidth,base=14,min=8){const chars=Math.max(1,String(text||'').length);return Math.max(min,Math.min(base,maxWidth/(chars*.57))).toFixed(2)}

export function renderNativeAssemblyDrawing(svg,nativeAssembly,options={}){
  const n=nativeAssembly||{},theme=options.theme||'light',dark=theme==='dark';
  const c={workspace:dark?'#111827':'#eef2f6',sheet:'#fff',ink:'#101820',muted:'#5c6773',blue:'#1769c2',title:'#0d2438',construction:'#a8b3bf'};
  svg.setAttribute('viewBox','0 0 1200 760');
  const comps=(n.components||[]).slice(0,15),projectName=options.projectName||n.root||'SLDASM';
  let s=`<rect width="1200" height="760" fill="${c.workspace}"/><rect x="10" y="10" width="1180" height="740" fill="${c.sheet}"/><rect x="22" y="22" width="1156" height="716" fill="none" stroke="${c.ink}" stroke-width="1.8"/>`;
  s+=`<text x="55" y="62" fill="${c.title}" font-family="system-ui" font-size="21" font-weight="800">Сборочный детализированный · SLDASM BOM</text><text x="55" y="88" fill="${c.muted}" font-family="system-ui" font-size="12">Reference-level импорт: структура сборки без B-Rep геометрии</text>`;
  const x=55,y=120,w=1085,rh=30,c1=x+60,c2=x+w-90;
  s+=`<g font-family="system-ui"><rect x="${x}" y="${y}" width="${w}" height="${Math.min(520,70+comps.length*rh)}" fill="#fff" stroke="${c.ink}"/><text x="${x+18}" y="${y+27}" fill="${c.title}" font-size="14" font-weight="800">СПЕЦИФИКАЦИЯ · ${escapeXml(n.root||projectName)}</text><line x1="${x}" y1="${y+42}" x2="${x+w}" y2="${y+42}" stroke="${c.ink}"/><line x1="${c1}" y1="${y+42}" x2="${c1}" y2="${y+Math.min(520,70+comps.length*rh)}" stroke="${c.ink}"/><line x1="${c2}" y1="${y+42}" x2="${c2}" y2="${y+Math.min(520,70+comps.length*rh)}" stroke="${c.ink}"/>`;
  s+=`<text x="${x+30}" y="${y+62}" text-anchor="middle" fill="${c.muted}" font-size="9">ПОЗ.</text><text x="${c1+10}" y="${y+62}" fill="${c.muted}" font-size="9">КОМПОНЕНТ / ФАЙЛ</text><text x="${x+w-45}" y="${y+62}" text-anchor="middle" fill="${c.muted}" font-size="9">КОЛ.</text>`;
  let yy=y+72;comps.forEach((q,i)=>{s+=`<line x1="${x}" y1="${yy}" x2="${x+w}" y2="${yy}" stroke="${c.construction}" stroke-width=".7"/><text x="${x+30}" y="${yy+20}" text-anchor="middle" fill="${c.ink}" font-size="10" font-weight="700">${i+1}</text><text x="${c1+10}" y="${yy+14}" fill="${c.ink}" font-size="10.5" font-weight="700">${escapeXml(q.name)}</text><text x="${c1+10}" y="${yy+25}" fill="${c.muted}" font-size="8.5">${escapeXml(q.file||'')}</text><text x="${x+w-45}" y="${yy+20}" text-anchor="middle" fill="${c.ink}" font-size="10.5" font-weight="700">${q.count}</text>`;yy+=rh});s+='</g>';
  s+=`<text x="55" y="665" fill="${c.muted}" font-family="system-ui" font-size="11">ROZFOOD ENGINEERING STUDIO · Drawing Core v0.7.0 · SLDASM Native Tessellation Decoder</text>`;
  s+=renderTitleBlock({projectName,fileName:options.fileName||'',unit:'—',mode:'Сборочный детализированный',rec:{counts:{faces:0,edges:0}}},{x:720,y:610,w:440,h:112},c);
  svg.innerHTML=s;
}

function buildFeatureSummary(rec,dims){
  const rows=[];
  const p=rec.boltPatterns?.[0];if(p)rows.push(`${p.count} отверстий ⌀${fmtDim(p.holeDiameter)} по PCD ⌀${fmtDim(p.pcd)}`);
  const dias=[...new Set((rec.radii||[]).map(r=>r*2))].sort((a,b)=>b-a);dias.slice(0,5).forEach(d=>rows.push(`Цилиндрическая поверхность ⌀${fmtDim(d)}`));
  if(rec.counts?.cones)rows.push(`Конические поверхности: ${rec.counts.cones}`);
  if(rec.counts?.planes)rows.push(`Плоские поверхности: ${rec.counts.planes}`);
  if(rec.isAssembly)rows.push(`Сборка: ${rec.occurrences?.length||0} вхождений`);
  return rows;
}

function boltPatternCenter3D(rec,p,drop){
  const candidates=(rec.cylinders||[]).filter(c=>Math.abs(c.radius*2-p.holeDiameter)<1e-3&&axisParallelToDrop(c.placement?.axis,drop));if(!candidates.length)return null;
  const center=[0,0,0],uv=[0,1,2].filter(i=>i!==drop);center[uv[0]]=candidates.reduce((s,c)=>s+c.placement.origin[uv[0]],0)/candidates.length;center[uv[1]]=candidates.reduce((s,c)=>s+c.placement.origin[uv[1]],0)/candidates.length;center[drop]=rec.bounds.center[drop];return center;
}

function fmtDim(v){if(!Number.isFinite(v))return '—';const a=Math.abs(v);return a>=100?Number(v).toFixed(1).replace(/\.0$/,''):a>=10?Number(v).toFixed(2).replace(/0+$/,'').replace(/\.$/,''):Number(v).toFixed(3).replace(/0+$/,'').replace(/\.$/,'')}
function n(v){return Number(v).toFixed(2)}
function escapeXml(x){return String(x??'').replace(/[<>&"']/g,m=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[m]))}
