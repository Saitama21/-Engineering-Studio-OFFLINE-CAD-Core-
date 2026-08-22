const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const mix=(a,b,t)=>a+(b-a)*t;
const intersects=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;

export class DrawingNavigator{
  constructor(workspace,svg){
    this.workspace=workspace;this.svg=svg;this.enabled=false;this.tool='edit';
    this.base=null;this.view=null;this.target=null;this.pan=null;
    this.raf=0;this.lastFrame=0;this.interactionTimer=0;this.elementCount=0;
    this.geometrySegments=0;this.navItems=[];this.heavy=false;this.interacting=false;
    this.lastCullAt=0;this.lastCullKey='';
    this._bind();this.captureBase();
  }
  captureBase({reset=true}={}){
    const raw=(this.svg.getAttribute('viewBox')||'0 0 1200 760').trim().split(/\s+/).map(Number);
    if(raw.length!==4||raw.some(v=>!Number.isFinite(v)))return;
    this.base={x:raw[0],y:raw[1],w:raw[2],h:raw[3]};
    this.elementCount=this.svg.querySelectorAll('*').length;
    this._indexGeometry();
    this.heavy=this.elementCount>1800||this.geometrySegments>2600||this.navItems.length>120;
    this.workspace.classList.toggle('drawing-nav-heavy',this.heavy);
    this.workspace.dataset.drawingNodes=String(this.elementCount);
    this.workspace.dataset.drawingSegments=String(this.geometrySegments);
    this.lastCullKey='';
    if(reset||!this.view)this.fit();else this._updateVisibility(true);
  }
  _indexGeometry(){
    this.navItems=[];this.geometrySegments=0;
    for(const el of this.svg.querySelectorAll('[data-nav-geom][data-nav-bounds]')){
      const b=String(el.dataset.navBounds||'').trim().split(/[ ,]+/).map(Number);
      if(b.length!==4||b.some(v=>!Number.isFinite(v)))continue;
      const item={el,bounds:{x:b[0],y:b[1],w:Math.max(0,b[2]),h:Math.max(0,b[3])},lod:clamp(Number(el.dataset.navLod)||0,0,2),hidden:false};
      this.navItems.push(item);this.geometrySegments+=Math.max(1,Number(el.dataset.navSegments)||1);
    }
  }
  setEnabled(on){
    this.enabled=!!on;
    this.workspace.classList.toggle('advanced-edit-nav',this.enabled);
    if(!this.enabled){this.pan=null;this._endInteraction(true);this._restoreVisibility();}
    else this._updateVisibility(true);
  }
  setTool(tool){
    this.tool=['edit','zoom','pan'].includes(tool)?tool:'edit';
    this.workspace.classList.remove('tool-edit','tool-zoom','tool-pan');
    this.workspace.classList.add(`tool-${this.tool}`);
  }
  fit(){
    if(!this.base)this.captureBase({reset:false});if(!this.base)return;
    this.view={...this.base};this.target={...this.base};
    if(this.raf)cancelAnimationFrame(this.raf);this.raf=0;this.lastCullKey='';this._apply();this._updateVisibility(true);
  }
  _apply(){
    if(!this.view)return;
    const v=this.view;this.svg.setAttribute('viewBox',`${v.x} ${v.y} ${v.w} ${v.h}`);
    if(this.enabled&&this.navItems.length){
      const now=performance.now();
      if(!this.interacting||now-this.lastCullAt>=70){this.lastCullAt=now;this._updateVisibility();}
    }
  }
  _point(clientX,clientY,view=this.target||this.view||this.base){
    const r=this.svg.getBoundingClientRect();
    if(!view||!r.width||!r.height)return null;
    return{x:view.x+(clientX-r.left)/r.width*view.w,y:view.y+(clientY-r.top)/r.height*view.h};
  }
  _beginInteraction(){
    if(!this.interacting){this.interacting=true;this.workspace.classList.add('drawing-nav-interacting');this.lastCullKey='';this._updateVisibility(true);}
    clearTimeout(this.interactionTimer);
    this.interactionTimer=setTimeout(()=>this._endInteraction(),150);
  }
  _endInteraction(force=false){
    clearTimeout(this.interactionTimer);this.interactionTimer=0;
    if(force||!this.pan){
      this.interacting=false;this.workspace.classList.remove('drawing-nav-interacting');
      this.lastCullKey='';
      if(this.enabled)requestAnimationFrame(()=>this._updateVisibility(true));
    }
  }
  _restoreVisibility(){
    for(const item of this.navItems){if(item.hidden){item.el.classList.remove('drawing-nav-culled');item.hidden=false;}}
    this.lastCullKey='';
  }
  _lodMax(view){
    if(!this.interacting||!this.heavy||!this.base)return 2;
    const zoom=this.base.w/Math.max(view.w,1e-6);
    if(zoom<1.45)return 0;   // ~40-50% geometry while moving around the full sheet
    if(zoom<2.8)return 1;    // ~70% at medium zoom
    return 2;                // 100% once the user is close enough to inspect detail
  }
  _updateVisibility(force=false){
    if(!this.enabled||!this.navItems.length||!this.base)return;
    const v=this.view||this.target||this.base,lodMax=this._lodMax(v);
    const pad=(this.interacting?.22:.12)*Math.max(v.w,v.h);
    const visible={x:v.x-pad,y:v.y-pad,w:v.w+pad*2,h:v.h+pad*2};
    const q=Math.max(1,Math.min(this.base.w,this.base.h)/180);
    const key=[Math.round(v.x/q),Math.round(v.y/q),Math.round(v.w/q),Math.round(v.h/q),lodMax,this.interacting?1:0].join(':');
    if(!force&&key===this.lastCullKey)return;this.lastCullKey=key;
    for(const item of this.navItems){
      const show=item.lod<=lodMax&&intersects(item.bounds,visible);
      if(show===!item.hidden)continue;
      item.hidden=!show;item.el.classList.toggle('drawing-nav-culled',!show);
    }
  }
  _queue(){
    if(!this.raf)this.raf=requestAnimationFrame(t=>this._frame(t));
  }
  _frame(ts){
    this.raf=0;
    if(!this.target)return;
    const complexity=Math.max(this.elementCount,this.geometrySegments*.45);
    const fps=complexity>7000?24:complexity>3200?30:60;
    const minDt=1000/fps;
    if(ts-this.lastFrame<minDt){this._queue();return}
    this.lastFrame=ts;
    const cur=this.view||this.target;
    const alpha=complexity>3200?1:.55;
    const next={
      x:mix(cur.x,this.target.x,alpha),y:mix(cur.y,this.target.y,alpha),
      w:mix(cur.w,this.target.w,alpha),h:mix(cur.h,this.target.h,alpha)
    };
    const delta=Math.abs(next.x-this.target.x)+Math.abs(next.y-this.target.y)+Math.abs(next.w-this.target.w)+Math.abs(next.h-this.target.h);
    this.view=delta<1e-4?{...this.target}:next;this._apply();
    if(delta>=1e-4)this._queue();
  }
  _zoomAt(clientX,clientY,factor){
    const v=this.target||this.view||this.base;if(!v||!this.base)return;
    const p=this._point(clientX,clientY,v);if(!p)return;
    const base=this.base,minW=base.w*.025,maxW=base.w*16;
    const nw=clamp(v.w*factor,minW,maxW),nh=nw*(v.h/v.w);
    const rx=(p.x-v.x)/v.w,ry=(p.y-v.y)/v.h;
    this.target={x:p.x-rx*nw,y:p.y-ry*nh,w:nw,h:nh};
    this._beginInteraction();this._queue();
  }
  _bind(){
    this.workspace.addEventListener('wheel',e=>{
      if(!this.enabled||!(this.target||this.view))return;
      e.preventDefault();
      const dy=clamp(e.deltaY,-180,180),factor=Math.exp(dy*.0015);
      this._zoomAt(e.clientX,e.clientY,factor);
    },{passive:false});

    this.workspace.addEventListener('pointerdown',e=>{
      if(!this.enabled)return;
      const middle=e.button===1,leftPan=e.button===0&&this.tool==='pan';
      if(middle||leftPan){
        const start=this.target||this.view;if(!start)return;
        e.preventDefault();e.stopPropagation();
        this.pan={id:e.pointerId,x:e.clientX,y:e.clientY,start:{...start}};
        this.workspace.setPointerCapture?.(e.pointerId);
        this.workspace.classList.add('drawing-panning');this._beginInteraction();return;
      }
      if(e.button===0&&this.tool==='zoom'){
        e.preventDefault();e.stopPropagation();
        this._zoomAt(e.clientX,e.clientY,e.shiftKey||e.altKey?1.28:.78);
      }
    });

    this.workspace.addEventListener('pointermove',e=>{
      if(!this.pan||e.pointerId!==this.pan.id)return;
      const r=this.svg.getBoundingClientRect();if(!r.width||!r.height)return;
      const d=this.pan,dx=(e.clientX-d.x)/r.width*d.start.w,dy=(e.clientY-d.y)/r.height*d.start.h;
      this.target={...d.start,x:d.start.x-dx,y:d.start.y-dy};
      this._beginInteraction();this._queue();
    });

    const end=e=>{
      if(!this.pan||e.pointerId!==this.pan.id)return;
      this.pan=null;this.workspace.classList.remove('drawing-panning');
      this._endInteraction();
    };
    this.workspace.addEventListener('pointerup',end);
    this.workspace.addEventListener('pointercancel',end);
  }
}
