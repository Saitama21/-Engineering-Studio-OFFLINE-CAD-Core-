import {sub,rotatePoint,cross,norm} from '../core/math3d.js';

function themeColor(name,fallback){const v=getComputedStyle(document.documentElement).getPropertyValue(name).trim();return v||fallback}
function hashString(s=''){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0}
function pointInPoly(p,poly){let inside=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const xi=poly[i][0],yi=poly[i][1],xj=poly[j][0],yj=poly[j][1];const hit=((yi>p[1])!==(yj>p[1]))&&(p[0]<(xj-xi)*(p[1]-yi)/((yj-yi)||1e-12)+xi);if(hit)inside=!inside}return inside}

export class WireframeViewer{
  constructor(canvas){
    this.canvas=canvas;this.ctx=canvas.getContext('2d');this.rec=null;this.rx=-.45;this.ry=.7;this.zoom=1;this.pan=[0,0];this.drag=null;this.down=null;this.moved=0;this.mode='solid';this.selectedComponent=null;this.hitFaces=[];this.onSelect=null;this.framePending=false;
    this.resizeObs=new ResizeObserver(()=>this.resize());this.resizeObs.observe(canvas.parentElement);this.bind();this.resize();
  }
  setModel(rec){this.rec=rec;this.selectedComponent=null;this.fit();this.draw()}
  clear(){this.rec=null;this.selectedComponent=null;this.draw()}
  fit(){this.zoom=1;this.pan=[0,0];this.draw()}
  setMode(mode){this.mode=mode==='wire'?'wire':'solid';this.draw()}
  setSelectedComponent(id){this.selectedComponent=id||null;this.draw()}
  requestDraw(){if(this.framePending)return;this.framePending=true;requestAnimationFrame(()=>{this.framePending=false;this.draw()})}
  bind(){
    this.canvas.addEventListener('pointerdown',e=>{this.drag=[e.clientX,e.clientY];this.down=[e.offsetX,e.offsetY];this.moved=0;this.canvas.setPointerCapture(e.pointerId)});
    this.canvas.addEventListener('pointermove',e=>{if(!this.drag)return;const dx=e.clientX-this.drag[0],dy=e.clientY-this.drag[1];this.moved+=Math.abs(dx)+Math.abs(dy);this.ry+=dx*.008;this.rx+=dy*.008;this.drag=[e.clientX,e.clientY];this.requestDraw()});
    this.canvas.addEventListener('pointerup',e=>{if(this.moved<5&&this.down)this.hitTest(this.down[0],this.down[1]);this.drag=null;this.down=null});
    this.canvas.addEventListener('wheel',e=>{e.preventDefault();this.zoom*=Math.exp(-e.deltaY*.001);this.zoom=Math.max(.12,Math.min(10,this.zoom));this.requestDraw()},{passive:false});
  }
  hitTest(x,y){for(let i=this.hitFaces.length-1;i>=0;i--){const h=this.hitFaces[i];if(h.poly?.length>2&&pointInPoly([x,y],h.poly)){this.selectedComponent=this.selectedComponent===h.componentId?null:h.componentId;this.draw();const inst=this.selectedComponent?(this.rec?.occurrences||[]).find(o=>o.id===this.selectedComponent):null;if(this.onSelect)this.onSelect(this.selectedComponent,inst||h.instance||null);return}}this.selectedComponent=null;this.draw();if(this.onSelect)this.onSelect(null,null)}
  resize(){const r=this.canvas.parentElement.getBoundingClientRect(),d=devicePixelRatio||1;this.canvas.width=Math.max(1,Math.round(r.width*d));this.canvas.height=Math.max(1,Math.round(r.height*d));this.canvas.style.width=r.width+'px';this.canvas.style.height=r.height+'px';this.ctx.setTransform(d,0,0,d,0,0);this.draw()}
  project(p,scale,cx,cy,center){const q=rotatePoint(sub(p,center),this.rx,this.ry);return[cx+q[0]*scale*this.zoom,cy-q[1]*scale*this.zoom,q[2],q]}
  componentStyle(id,alpha=1){const h=hashString(id||'model')%36;const hue=206+(h-18)*.9;const dark=document.documentElement.dataset.theme==='dark';return`hsla(${hue} ${dark?45:48}% ${dark?42:67}% / ${alpha})`}
  drawFaces(c,scale,cx,cy,center){
    const faces=[];this.hitFaces=[];
    for(const f of this.rec.faces||[]){const loops=(f.loops||[]).map(loop=>loop.map(p=>this.project(p,scale,cx,cy,center))).filter(l=>l.length>2);if(!loops.length)continue;const all=loops.flat(),depth=all.reduce((s,p)=>s+p[2],0)/all.length;faces.push({f,loops,depth})}
    faces.sort((a,b)=>a.depth-b.depth);
    const dark=document.documentElement.dataset.theme==='dark';
    for(const item of faces){const {f,loops}=item,selected=!this.selectedComponent||f.componentId===this.selectedComponent,alpha=this.selectedComponent?(selected?1:.045):1;c.beginPath();for(const loop of loops){c.moveTo(loop[0][0],loop[0][1]);for(let i=1;i<loop.length;i++)c.lineTo(loop[i][0],loop[i][1]);c.closePath()}
      // Simple CAD-like face shading from the first non-collinear points in view coordinates.
      let shade=1;const q=loops[0].map(p=>p[3]);for(let i=2;i<q.length;i++){const n=norm(cross(sub(q[1],q[0]),sub(q[i],q[0])));if(Math.hypot(...n)>.1){shade=.75+.22*Math.abs(n[2]);break}}
      if(f.componentId)c.fillStyle=this.componentStyle(f.componentId,Math.min(1,alpha*shade));else c.fillStyle=dark?`rgba(70,112,158,${Math.min(1,alpha*.9)})`:`rgba(153,186,219,${alpha})`;try{c.fill('evenodd')}catch{c.fill()}
      c.strokeStyle=dark?'rgba(155,190,225,.18)':'rgba(43,84,125,.16)';c.lineWidth=.38;c.stroke();
      if(f.componentId)this.hitFaces.push({componentId:f.componentId,instance:f.instance,poly:loops[0].map(p=>[p[0],p[1]])});
    }
  }

  drawFaceWire(c,scale,cx,cy,center){
    const faces=this.rec.faces||[];if(!faces.length)return;
    const dark=document.documentElement.dataset.theme==='dark';
    c.save();c.globalAlpha=this.selectedComponent?.28:.64;c.strokeStyle=dark?'rgba(132,174,218,.72)':'rgba(42,75,110,.62)';c.lineWidth=.62;c.beginPath();
    for(const f of faces){
      for(const loop of f.loops||[]){if(loop.length<3)continue;const q=loop.map(p=>this.project(p,scale,cx,cy,center));c.moveTo(q[0][0],q[0][1]);for(let i=1;i<q.length;i++)c.lineTo(q[i][0],q[i][1]);c.closePath()}
    }
    c.stroke();c.restore();
  }
  draw(){
    const c=this.ctx,w=this.canvas.clientWidth||1,h=this.canvas.clientHeight||1,bg=themeColor('--canvas-bg','#fff'),grid=themeColor('--canvas-grid','#edf1f5'),wire=themeColor('--wire','#2a3340'),circle=themeColor('--wire-circle','#0a67ff'),muted=themeColor('--muted','#6e7781');
    c.clearRect(0,0,w,h);c.fillStyle=bg;c.fillRect(0,0,w,h);c.strokeStyle=grid;c.lineWidth=1;for(let x=0;x<w;x+=40){c.beginPath();c.moveTo(x,0);c.lineTo(x,h);c.stroke()}for(let y=0;y<h;y+=40){c.beginPath();c.moveTo(0,y);c.lineTo(w,y);c.stroke()}
    if(!this.rec){c.fillStyle=muted;c.font='14px -apple-system,BlinkMacSystemFont,system-ui';c.fillText('Загрузите SLDASM',24,36);return}
    const b=this.rec.bounds,max=Math.max(...b.size,1),scale=Math.min(w,h)*.72/max,cx=w/2+this.pan[0],cy=h/2+this.pan[1],center=b.center;
    if(this.mode==='solid'&&(this.rec.faces?.length||0))this.drawFaces(c,scale,cx,cy,center);else{this.hitFaces=[];if(this.mode==='wire'&&(this.rec.faces?.length||0))this.drawFaceWire(c,scale,cx,cy,center)}
    const segs=[];for(const e of this.rec.edges||[]){const pts=e.points?.length?e.points:(e.p1&&e.p2?[e.p1,e.p2]:[]);for(let i=0;i<pts.length-1;i++){const a=this.project(pts[i],scale,cx,cy,center),bb=this.project(pts[i+1],scale,cx,cy,center);segs.push([a,bb,(a[2]+bb[2])/2,e])}}
    segs.sort((a,b)=>a[2]-b[2]);for(const [a,bb,,e] of segs){const selected=!this.selectedComponent||e.componentId===this.selectedComponent;c.globalAlpha=this.selectedComponent?(selected?1:.06):(this.mode==='solid'?.22:.88);c.strokeStyle=selected&&this.selectedComponent?'#006cff':(e.kind==='circle'?circle:wire);c.lineWidth=selected&&this.selectedComponent?2.2:(this.mode==='solid'?.48:(e.kind==='circle'?1.5:1.05));c.beginPath();c.moveTo(a[0],a[1]);c.lineTo(bb[0],bb[1]);c.stroke()}
    c.globalAlpha=1;c.fillStyle=muted;c.font='12px ui-monospace,SFMono-Regular,Menlo,monospace';const sceneEdges=this.rec.counts.sceneEdges??this.rec.edges?.length??0,sceneFaces=this.rec.counts.sceneFaces??this.rec.faces?.length??0,parts=this.rec.counts.sceneComponents??this.rec.components?.length??0;c.fillText(`${parts?parts+' components · ':''}${sceneFaces} triangles · ${sceneEdges} derived edges`,14,h-16);
    if(this.selectedComponent){const comp=(this.rec.occurrences||[]).find(x=>x.id===this.selectedComponent);if(comp){c.fillStyle=themeColor('--text-strong','#17202b');c.font='600 13px -apple-system,BlinkMacSystemFont,system-ui';c.fillText(`Выбрано: ${comp.name}`,14,24)}}
  }
}
