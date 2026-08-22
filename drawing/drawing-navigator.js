const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const mix=(a,b,t)=>a+(b-a)*t;
const num='[-+]?(?:\\d*\\.)?\\d+(?:[eE][-+]?\\d+)?';
const edgeRe=new RegExp(`M\\s*(${num})[ ,]+(${num})\\s*L\\s*(${num})[ ,]+(${num})`,'g');

function intersects(s,b){return s.maxX>=b.x&&s.minX<=b.x+b.w&&s.maxY>=b.y&&s.minY<=b.y+b.h}
function inBox(x,y,b){return x>=b.x&&x<=b.x+b.w&&y>=b.y&&y<=b.y+b.h}
function edgeD(s){return `M${s.x1} ${s.y1}L${s.x2} ${s.y2}`}

export class DrawingNavigator{
  constructor(workspace,svg){
    this.workspace=workspace;this.svg=svg;this.enabled=false;this.tool='edit';
    this.base=null;this.view=null;this.target=null;this.pan=null;
    this.raf=0;this.lastFrame=0;this.interactionTimer=0;this.elementCount=0;
    this.wheelDy=0;this.wheelPoint=null;this.focusPoint=null;this.localPaths=[];
    this.localPrepared=false;this.localPrepHandle=0;this.lastLocalUpdate=0;this.localActive=false;
    this._bind();this.captureBase();
  }
  captureBase({reset=true}={}){
    this._cancelLocalPrep();this._restoreLocalPaths();
    const raw=(this.svg.getAttribute('viewBox')||'0 0 1200 760').trim().split(/\s+/).map(Number);
    if(raw.length!==4||raw.some(v=>!Number.isFinite(v)))return;
    this.base={x:raw[0],y:raw[1],w:raw[2],h:raw[3]};
    this.elementCount=this.svg.querySelectorAll('*').length;
    this.workspace.classList.toggle('drawing-nav-heavy',this.elementCount>1500||this._complexPathChars()>24000);
    this.workspace.dataset.drawingNodes=String(this.elementCount);
    this.localPaths=[];this.localPrepared=false;this.lastLocalUpdate=0;
    this._scheduleLocalPrep();
    if(reset||!this.view)this.fit();
  }
  setEnabled(on){
    this.enabled=!!on;
    this.workspace.classList.toggle('advanced-edit-nav',this.enabled);
    if(!this.enabled){this.pan=null;this.wheelDy=0;this._endInteraction(true)}
  }
  setTool(tool){
    this.tool=['edit','zoom','pan'].includes(tool)?tool:'edit';
    this.workspace.classList.remove('tool-edit','tool-zoom','tool-pan');
    this.workspace.classList.add(`tool-${this.tool}`);
  }
  fit(){
    if(!this.base)this.captureBase({reset:false});if(!this.base)return;
    this.view={...this.base};this.target={...this.base};this.focusPoint=null;this.wheelDy=0;
    if(this.raf)cancelAnimationFrame(this.raf);this.raf=0;this._restoreLocalPaths();this._apply();
  }
  _apply(){
    if(!this.view)return;
    const v=this.view;this.svg.setAttribute('viewBox',`${v.x} ${v.y} ${v.w} ${v.h}`);
  }
  _point(clientX,clientY,view=this.target||this.view||this.base){
    const r=this.svg.getBoundingClientRect();
    if(!view||!r.width||!r.height)return null;
    return{x:view.x+(clientX-r.left)/r.width*view.w,y:view.y+(clientY-r.top)/r.height*view.h};
  }
  _beginInteraction(){
    this.workspace.classList.add('drawing-nav-interacting');
    clearTimeout(this.interactionTimer);this.interactionTimer=0;
    this._ensureLocalPaths();
  }
  _scheduleInteractionEnd(delay=165){
    clearTimeout(this.interactionTimer);
    this.interactionTimer=setTimeout(()=>{
      this.interactionTimer=0;
      if(this.pan||Math.abs(this.wheelDy)>.01||this.raf){this._scheduleInteractionEnd(90);return}
      this._endInteraction();
    },delay);
  }
  _endInteraction(force=false){
    if(force){
      clearTimeout(this.interactionTimer);this.interactionTimer=0;
      if(this.raf)cancelAnimationFrame(this.raf);this.raf=0;
    }
    if(!force&&(this.pan||Math.abs(this.wheelDy)>.01||this.raf)){this._scheduleInteractionEnd(90);return}
    this.workspace.classList.remove('drawing-nav-interacting','drawing-local-render');
    this.localActive=false;this._restoreLocalPaths();
  }
  _queue(){if(!this.raf)this.raf=requestAnimationFrame(t=>this._frame(t))}
  _frame(ts){
    this.raf=0;
    if(!this.target)return;

    if(Math.abs(this.wheelDy)>.01&&this.wheelPoint){
      const dy=clamp(this.wheelDy,-520,520),pt=this.wheelPoint;
      this.wheelDy=0;
      this._zoomAt(pt.x,pt.y,Math.exp(dy*.00128),{queue:false,begin:false});
    }

    const cur=this.view||this.target;
    const dt=this.lastFrame?clamp(ts-this.lastFrame,8,50):16.7;this.lastFrame=ts;
    // Time-based easing keeps zoom fluid and independent of event burst frequency.
    const tau=this.workspace.classList.contains('drawing-nav-heavy')?46:58;
    const alpha=1-Math.exp(-dt/tau);
    const next={x:mix(cur.x,this.target.x,alpha),y:mix(cur.y,this.target.y,alpha),w:mix(cur.w,this.target.w,alpha),h:mix(cur.h,this.target.h,alpha)};
    const delta=Math.abs(next.x-this.target.x)+Math.abs(next.y-this.target.y)+Math.abs(next.w-this.target.w)+Math.abs(next.h-this.target.h);
    this.view=delta<.018?{...this.target}:next;
    this._apply();

    // Heavy linework is rebuilt only a few times per second and only for the visible/focus region.
    if(this.localPaths.length&&ts-this.lastLocalUpdate>72){this.lastLocalUpdate=ts;this._applyLocalPaths(this.view)}

    if(delta>=.018||Math.abs(this.wheelDy)>.01)this._queue();
    else this._scheduleInteractionEnd(145);
  }
  _zoomAt(clientX,clientY,factor,{queue=true,begin=true}={}){
    const v=this.target||this.view||this.base;if(!v||!this.base)return;
    const p=this._point(clientX,clientY,v);if(!p)return;
    this.focusPoint=p;
    const base=this.base,minW=base.w*.018,maxW=base.w*16;
    const nw=clamp(v.w*factor,minW,maxW),nh=nw*(v.h/v.w);
    const rx=(p.x-v.x)/v.w,ry=(p.y-v.y)/v.h;
    this.target={x:p.x-rx*nw,y:p.y-ry*nh,w:nw,h:nh};
    if(begin)this._beginInteraction();if(queue)this._queue();
  }
  _complexPathChars(){let n=0;for(const p of this.svg.querySelectorAll('path[d]'))n+=(p.getAttribute('d')||'').length;return n}
  _cancelLocalPrep(){
    if(!this.localPrepHandle)return;
    if(typeof cancelIdleCallback==='function')cancelIdleCallback(this.localPrepHandle);else clearTimeout(this.localPrepHandle);
    this.localPrepHandle=0;
  }
  _scheduleLocalPrep(){
    const work=()=>{this.localPrepHandle=0;this._prepareLocalPaths()};
    if(typeof requestIdleCallback==='function')this.localPrepHandle=requestIdleCallback(work,{timeout:650});
    else this.localPrepHandle=setTimeout(work,40);
  }
  _ensureLocalPaths(){if(!this.localPrepared)this._prepareLocalPaths()}
  _prepareLocalPaths(){
    if(this.localPrepared)return;this.localPrepared=true;this.localPaths=[];
    const candidates=[...this.svg.querySelectorAll('path[d]')].filter(p=>(p.getAttribute('d')||'').length>9000);
    for(const el of candidates){
      const fullD=el.getAttribute('d')||'';edgeRe.lastIndex=0;const seg=[];let m;
      while((m=edgeRe.exec(fullD))){
        const x1=Number(m[1]),y1=Number(m[2]),x2=Number(m[3]),y2=Number(m[4]);
        if(![x1,y1,x2,y2].every(Number.isFinite))continue;
        seg.push({x1,y1,x2,y2,minX:Math.min(x1,x2),maxX:Math.max(x1,x2),minY:Math.min(y1,y2),maxY:Math.max(y1,y2),mx:(x1+x2)/2,my:(y1+y2)/2});
      }
      if(seg.length<260)continue;
      const maxGlobal=2100,stride=Math.max(1,Math.ceil(seg.length/maxGlobal));let globalFast='';
      for(let i=0;i<seg.length;i+=stride)globalFast+=edgeD(seg[i]);
      this.localPaths.push({el,fullD,seg,globalFast,lastKey:''});
    }
    const total=this.localPaths.reduce((s,p)=>s+p.seg.length,0);
    this.workspace.dataset.localPathSegments=String(total);
    this.workspace.classList.toggle('drawing-local-capable',total>0);
  }
  _applyLocalPaths(view){
    if(!view||!this.base||!this.localPaths.length)return;
    const ratio=view.w/this.base.w;
    const margin=.14;
    const box={x:view.x-view.w*margin,y:view.y-view.h*margin,w:view.w*(1+margin*2),h:view.h*(1+margin*2)};
    const focus=this.focusPoint||{x:view.x+view.w/2,y:view.y+view.h/2};
    const focusBox={x:focus.x-view.w*.23,y:focus.y-view.h*.23,w:view.w*.46,h:view.h*.46};
    const perPath=Math.max(850,Math.floor(3300/Math.max(1,this.localPaths.length)));
    let rendered=0;

    for(const p of this.localPaths){
      if(!p.el?.isConnected)continue;
      // At full-sheet scale use a globally simplified proxy; once zoomed in, use actual local linework.
      if(ratio>.78){
        if(p.lastKey!=='global'){p.el.setAttribute('d',p.globalFast);p.lastKey='global'}
        rendered+=Math.min(p.seg.length,2100);continue;
      }
      const visible=[];for(let i=0;i<p.seg.length;i++)if(intersects(p.seg[i],box))visible.push(p.seg[i]);
      if(!visible.length){if(p.lastKey!=='empty'){p.el.setAttribute('d','');p.lastKey='empty'};continue}
      let chosen=visible;
      if(visible.length>perPath){
        const hot=[],outer=[];
        for(const s of visible)(inBox(s.mx,s.my,focusBox)?hot:outer).push(s);
        const hotCap=Math.floor(perPath*.68),outerCap=perPath-hotCap;
        const hotStride=Math.max(1,Math.ceil(hot.length/Math.max(1,hotCap)));
        const outerStride=Math.max(1,Math.ceil(outer.length/Math.max(1,outerCap)));
        chosen=[];for(let i=0;i<hot.length;i+=hotStride)chosen.push(hot[i]);for(let i=0;i<outer.length;i+=outerStride)chosen.push(outer[i]);
      }
      const key=`${Math.round(view.x/view.w*20)}:${Math.round(view.y/view.h*20)}:${Math.round(ratio*100)}:${chosen.length}`;
      if(key!==p.lastKey){let d='';for(const s of chosen)d+=edgeD(s);p.el.setAttribute('d',d);p.lastKey=key}
      rendered+=chosen.length;
    }
    this.localActive=true;this.workspace.classList.add('drawing-local-render');
    this.workspace.dataset.localRenderedSegments=String(rendered);
  }
  _restoreLocalPaths(){
    if(!this.localPaths?.length)return;
    for(const p of this.localPaths){if(p.el?.isConnected&&p.el.getAttribute('d')!==p.fullD)p.el.setAttribute('d',p.fullD);p.lastKey=''}
    this.workspace.classList.remove('drawing-local-render');this.localActive=false;
    delete this.workspace.dataset.localRenderedSegments;
  }
  _bind(){
    this.workspace.addEventListener('wheel',e=>{
      if(!this.enabled||!(this.target||this.view))return;
      e.preventDefault();
      this.wheelDy+=clamp(e.deltaY,-220,220);this.wheelPoint={x:e.clientX,y:e.clientY};
      const p=this._point(e.clientX,e.clientY,this.target||this.view);if(p)this.focusPoint=p;
      this._beginInteraction();this._queue();
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
      this.focusPoint=this._point(e.clientX,e.clientY,this.target)||this.focusPoint;
      this._beginInteraction();this._queue();
    });

    const end=e=>{
      if(!this.pan||e.pointerId!==this.pan.id)return;
      this.pan=null;this.workspace.classList.remove('drawing-panning');
      this._scheduleInteractionEnd(150);
    };
    this.workspace.addEventListener('pointerup',end);
    this.workspace.addEventListener('pointercancel',end);
  }
}
