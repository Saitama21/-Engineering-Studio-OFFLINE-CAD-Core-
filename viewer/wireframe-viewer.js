import {sub,rotatePoint,cross,norm} from '../core/math3d.js';
import {componentDrawableIds} from '../core/component-local.js';

function themeColor(name,fallback){const v=getComputedStyle(document.documentElement).getPropertyValue(name).trim();return v||fallback}
function hashString(s=''){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0}
function pointInPoly(p,poly){let inside=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const xi=poly[i][0],yi=poly[i][1],xj=poly[j][0],yj=poly[j][1];const hit=((yi>p[1])!==(yj>p[1]))&&(p[0]<(xj-xi)*(p[1]-yi)/((yj-yi)||1e-12)+xi);if(hit)inside=!inside}return inside}
function boundsOfFaces(faces){const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];let count=0;for(const face of faces||[])for(const loop of face.loops||[])for(const point of loop||[]){for(let axis=0;axis<3;axis++){min[axis]=Math.min(min[axis],point[axis]);max[axis]=Math.max(max[axis],point[axis])}count++}if(!count)return null;return{min,max,size:max.map((value,axis)=>value-min[axis]),center:max.map((value,axis)=>(value+min[axis])/2)}}

export class WireframeViewer{
  constructor(canvas){
    this.canvas=canvas;this.ctx=canvas.getContext('2d');this.rec=null;this.rx=-.45;this.ry=.7;this.zoom=1;this.pan=[0,0];this.drag=null;this.down=null;this.moved=0;this.mode='solid';this.selectedComponent=null;this.selectedIds=new Set();this.selectedBounds=null;this.hitFaces=[];this.onSelect=null;this.framePending=false;this.interacting=false;this.interactionTimer=null;
    this.resizeObs=new ResizeObserver(()=>this.resize());this.resizeObs.observe(canvas.parentElement);this.bind();this.resize();
  }
  setModel(rec){this.rec=rec;this.selectedComponent=null;this.selectedIds.clear();this.selectedBounds=null;this.fit();this.draw()}
  clear(){this.rec=null;this.selectedComponent=null;this.selectedIds.clear();this.selectedBounds=null;this.draw()}
  fit(){this.zoom=1;this.pan=[0,0];this.draw()}
  setMode(mode){this.mode=['solid','wire','brep'].includes(mode)?mode:'solid';this.draw()}
  setSelectedComponent(id){this.selectedComponent=id||null;this.selectedIds=new Set(id?componentDrawableIds(this.rec,id):[]);this.selectedBounds=id?boundsOfFaces((this.rec?.faces||[]).filter(face=>this.selectedIds.has(face.componentId))):null;this.zoom=1;this.pan=[0,0];this.draw()}
  requestDraw(){if(this.framePending)return;this.framePending=true;requestAnimationFrame(()=>{this.framePending=false;this.draw()})}
  beginInteraction(){this.interacting=true;clearTimeout(this.interactionTimer)}
  endInteractionSoon(delay=70){clearTimeout(this.interactionTimer);this.interactionTimer=setTimeout(()=>{this.interacting=false;this.requestDraw()},delay)}
  bind(){
    this.canvas.addEventListener('pointerdown',e=>{this.beginInteraction();this.drag={x:e.clientX,y:e.clientY,button:e.button,id:e.pointerId};this.down=[e.offsetX,e.offsetY];this.moved=0;this.canvas.setPointerCapture(e.pointerId)});
    this.canvas.addEventListener('pointermove',e=>{if(!this.drag)return;const dx=e.clientX-this.drag.x,dy=e.clientY-this.drag.y;this.moved+=Math.abs(dx)+Math.abs(dy);if(this.drag.button===1){this.pan[0]+=dx;this.pan[1]+=dy}else{this.ry+=dx*.008;this.rx+=dy*.008}this.drag.x=e.clientX;this.drag.y=e.clientY;this.requestDraw()});
    this.canvas.addEventListener('pointerup',e=>{if(this.drag?.button===0&&this.moved<5&&this.down)this.hitTest(this.down[0],this.down[1]);this.drag=null;this.down=null;this.interacting=false;this.requestDraw()});
    this.canvas.addEventListener('pointercancel',()=>{this.drag=null;this.down=null;this.interacting=false;this.requestDraw()});
    this.canvas.addEventListener('wheel',e=>{e.preventDefault();this.beginInteraction();const old=this.zoom,next=Math.max(.12,Math.min(10,old*Math.exp(-e.deltaY*.001)));const ratio=next/old,w=this.canvas.clientWidth||1,h=this.canvas.clientHeight||1,cx=w/2,cy=h/2,px=e.offsetX,py=e.offsetY;this.pan[0]=(px-cx)-ratio*((px-cx)-this.pan[0]);this.pan[1]=(py-cy)-ratio*((py-cy)-this.pan[1]);this.zoom=next;this.requestDraw();this.endInteractionSoon(90)},{passive:false});
  }
  hitTest(x,y){for(let i=this.hitFaces.length-1;i>=0;i--){const h=this.hitFaces[i];if(h.poly?.length>2&&pointInPoly([x,y],h.poly)){const id=this.selectedComponent===h.componentId?null:h.componentId;this.setSelectedComponent(id);const inst=id?(this.rec?.occurrences||[]).find(o=>o.id===id):null;if(this.onSelect)this.onSelect(id,inst||h.instance||null);return}}this.setSelectedComponent(null);if(this.onSelect)this.onSelect(null,null)}
  resize(){const r=this.canvas.parentElement.getBoundingClientRect(),d=devicePixelRatio||1;this.canvas.width=Math.max(1,Math.round(r.width*d));this.canvas.height=Math.max(1,Math.round(r.height*d));this.canvas.style.width=r.width+'px';this.canvas.style.height=r.height+'px';this.ctx.setTransform(d,0,0,d,0,0);this.draw()}
  project(p,scale,cx,cy,center){const q=rotatePoint(sub(p,center),this.rx,this.ry);return[cx+q[0]*scale*this.zoom,cy-q[1]*scale*this.zoom,q[2],q]}
  componentStyle(id,alpha=1){const h=hashString(id||'model')%36;const hue=206+(h-18)*.9;const dark=document.documentElement.dataset.theme==='dark';return`hsla(${hue} ${dark?45:48}% ${dark?42:67}% / ${alpha})`}
  drawFaces(c,scale,cx,cy,center){
    const faces=[];this.hitFaces=[];
    const source=this.rec.faces||[],step=this.interacting&&source.length>24000?Math.ceil(source.length/24000):1;
    for(let fi=0;fi<source.length;fi+=step){const f=source[fi];const loops=(f.loops||[]).map(loop=>loop.map(p=>this.project(p,scale,cx,cy,center))).filter(l=>l.length>2);if(!loops.length)continue;const all=loops.flat(),depth=all.reduce((s,p)=>s+p[2],0)/all.length;faces.push({f,loops,depth})}
    faces.sort((a,b)=>a.depth-b.depth);
    const dark=document.documentElement.dataset.theme==='dark';
    for(const item of faces){const {f,loops}=item,selected=!this.selectedComponent||this.selectedIds.has(f.componentId),alpha=this.selectedComponent?(selected?1:.025):1;c.beginPath();for(const loop of loops){c.moveTo(loop[0][0],loop[0][1]);for(let i=1;i<loop.length;i++)c.lineTo(loop[i][0],loop[i][1]);c.closePath()}
      // Simple CAD-like face shading from the first non-collinear points in view coordinates.
      let shade=1;const q=loops[0].map(p=>p[3]);for(let i=2;i<q.length;i++){const n=norm(cross(sub(q[1],q[0]),sub(q[i],q[0])));if(Math.hypot(...n)>.1){shade=.75+.22*Math.abs(n[2]);break}}
      if(f.componentId)c.fillStyle=this.componentStyle(f.componentId,Math.min(1,alpha*shade));else c.fillStyle=dark?`rgba(70,112,158,${Math.min(1,alpha*.9)})`:`rgba(153,186,219,${alpha})`;try{c.fill('evenodd')}catch{c.fill()}
      if(this.mode!=='brep'){c.strokeStyle=dark?'rgba(155,190,225,.18)':'rgba(43,84,125,.16)';c.lineWidth=.38;c.stroke();}
      if(f.componentId)this.hitFaces.push({componentId:f.componentId,instance:f.instance,poly:loops[0].map(p=>[p[0],p[1]])});
    }
  }

  drawFaceWire(c,scale,cx,cy,center){
    const faces=this.rec.faces||[];if(!faces.length)return;const step=this.interacting&&faces.length>30000?Math.ceil(faces.length/30000):1;
    const dark=document.documentElement.dataset.theme==='dark';
    const strokeGroup=(selected,alpha,color,width)=>{c.save();c.globalAlpha=alpha;c.strokeStyle=color;c.lineWidth=width;c.beginPath();for(let fi=0;fi<faces.length;fi+=step){const f=faces[fi],isSelected=!this.selectedComponent||this.selectedIds.has(f.componentId);if(isSelected!==selected)continue;for(const loop of f.loops||[]){if(loop.length<3)continue;const q=loop.map(p=>this.project(p,scale,cx,cy,center));c.moveTo(q[0][0],q[0][1]);for(let i=1;i<q.length;i++)c.lineTo(q[i][0],q[i][1]);c.closePath()}}c.stroke();c.restore()};
    if(this.selectedComponent)strokeGroup(false,.035,dark?'#8aaed9':'#2a4b6e',.5);
    strokeGroup(true,this.selectedComponent?.95:.64,this.selectedComponent?'#006cff':(dark?'rgba(132,174,218,.72)':'rgba(42,75,110,.62)'),this.selectedComponent?1.05:.62);
  }
  draw(){
    const c=this.ctx,w=this.canvas.clientWidth||1,h=this.canvas.clientHeight||1,bg=themeColor('--canvas-bg','#fff'),grid=themeColor('--canvas-grid','#edf1f5'),wire=themeColor('--wire','#2a3340'),circle=themeColor('--wire-circle','#0a67ff'),muted=themeColor('--muted','#6e7781');
    c.clearRect(0,0,w,h);c.fillStyle=bg;c.fillRect(0,0,w,h);c.strokeStyle=grid;c.lineWidth=1;for(let x=0;x<w;x+=40){c.beginPath();c.moveTo(x,0);c.lineTo(x,h);c.stroke()}for(let y=0;y<h;y+=40){c.beginPath();c.moveTo(0,y);c.lineTo(w,y);c.stroke()}
    if(!this.rec){c.fillStyle=muted;c.font='14px -apple-system,BlinkMacSystemFont,system-ui';c.fillText('Загрузите SLDASM',24,36);return}
    const b=this.selectedBounds||this.rec.bounds,max=Math.max(...b.size,1),scale=Math.min(w,h)*.72/max,cx=w/2+this.pan[0],cy=h/2+this.pan[1],center=b.center;
    if((this.mode==='solid'||this.mode==='brep')&&(this.rec.faces?.length||0))this.drawFaces(c,scale,cx,cy,center);else{this.hitFaces=[];if(this.mode==='wire'&&(this.rec.faces?.length||0))this.drawFaceWire(c,scale,cx,cy,center)}
    const segs=[],edgeSource=this.rec.edges||[],edgeStep=this.interacting&&edgeSource.length>42000?Math.ceil(edgeSource.length/42000):1;for(let ei=0;ei<edgeSource.length;ei+=edgeStep){const e=edgeSource[ei];const pts=e.points?.length?e.points:(e.p1&&e.p2?[e.p1,e.p2]:[]);for(let i=0;i<pts.length-1;i++){const a=this.project(pts[i],scale,cx,cy,center),bb=this.project(pts[i+1],scale,cx,cy,center);segs.push([a,bb,(a[2]+bb[2])/2,e])}}
    segs.sort((a,b)=>a[2]-b[2]);for(const [a,bb,,e] of segs){const selected=!this.selectedComponent||this.selectedIds.has(e.componentId);c.globalAlpha=this.selectedComponent?(selected?1:.025):(this.mode==='solid'?.22:this.mode==='brep'?.92:.88);c.strokeStyle=selected&&this.selectedComponent?'#006cff':(e.kind==='boundary'?'#d97706':e.kind==='nonmanifold'?'#dc2626':e.kind==='circle'?circle:wire);c.lineWidth=selected&&this.selectedComponent?2.2:(this.mode==='solid'?.48:this.mode==='brep'?(e.kind==='boundary'||e.kind==='nonmanifold'?1.55:1.05):(e.kind==='circle'?1.5:1.05));c.beginPath();c.moveTo(a[0],a[1]);c.lineTo(bb[0],bb[1]);c.stroke()}
    c.globalAlpha=1;c.fillStyle=muted;c.font='12px ui-monospace,SFMono-Regular,Menlo,monospace';const sceneEdges=this.rec.edges?.length??this.rec.counts.sceneEdges??0,sceneFaces=this.rec.counts.sceneFaces??this.rec.faces?.length??0,parts=this.rec.counts.sceneComponents??this.rec.components?.length??0;const bc=this.rec.brep?.counts,brepText=this.mode==='brep'&&bc?` · B-Rep ${bc.vertices}V / ${bc.edges}E / ${bc.faces}F / ${bc.shells} shells${this.rec.brep.topologyComplete&&Number.isFinite(bc.closedShells)?` / ${bc.closedShells} closed`:''}`:'';c.fillText(`${parts?parts+' components · ':''}${sceneFaces} triangles · ${sceneEdges} display edges${brepText}`,14,h-16);
    if(this.selectedComponent){const comp=(this.rec.occurrences||[]).find(x=>x.id===this.selectedComponent);if(comp){c.fillStyle=themeColor('--text-strong','#17202b');c.font='600 13px -apple-system,BlinkMacSystemFont,system-ui';c.fillText(`Выбрано: ${comp.name}`,14,24)}}
  }
}
