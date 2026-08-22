export class DrawingNavigator{
  constructor(workspace,svg){
    this.workspace=workspace;this.svg=svg;this.enabled=false;this.base=null;this.view=null;this.pan=null;
    this._bind();this.captureBase();
  }
  captureBase({reset=true}={}){
    const raw=(this.svg.getAttribute('viewBox')||'0 0 1200 760').trim().split(/\s+/).map(Number);
    if(raw.length!==4||raw.some(v=>!Number.isFinite(v)))return;
    this.base={x:raw[0],y:raw[1],w:raw[2],h:raw[3]};
    if(reset||!this.view)this.fit();
  }
  setEnabled(on){this.enabled=!!on;this.workspace.classList.toggle('advanced-edit-nav',this.enabled);if(!this.enabled)this.pan=null}
  fit(){if(!this.base)this.captureBase({reset:false});if(!this.base)return;this.view={...this.base};this._apply()}
  _apply(){if(!this.view)return;const v=this.view;this.svg.setAttribute('viewBox',`${v.x} ${v.y} ${v.w} ${v.h}`)}
  _point(clientX,clientY){const r=this.svg.getBoundingClientRect(),v=this.view||this.base;if(!v||!r.width||!r.height)return null;return{x:v.x+(clientX-r.left)/r.width*v.w,y:v.y+(clientY-r.top)/r.height*v.h}}
  _bind(){
    this.workspace.addEventListener('wheel',e=>{
      if(!this.enabled||!this.view)return;e.preventDefault();
      const p=this._point(e.clientX,e.clientY);if(!p)return;
      const factor=Math.exp(e.deltaY*.0012),base=this.base||this.view;
      const minW=base.w*.035,maxW=base.w*12;
      const nw=Math.max(minW,Math.min(maxW,this.view.w*factor)),nh=nw*(this.view.h/this.view.w);
      const rx=(p.x-this.view.x)/this.view.w,ry=(p.y-this.view.y)/this.view.h;
      this.view={x:p.x-rx*nw,y:p.y-ry*nh,w:nw,h:nh};this._apply();
    },{passive:false});
    this.workspace.addEventListener('pointerdown',e=>{
      if(!this.enabled||e.button!==1||!this.view)return;e.preventDefault();
      this.pan={id:e.pointerId,x:e.clientX,y:e.clientY,start:{...this.view}};this.workspace.setPointerCapture?.(e.pointerId);this.workspace.classList.add('drawing-panning');
    });
    this.workspace.addEventListener('pointermove',e=>{
      if(!this.pan||e.pointerId!==this.pan.id)return;const r=this.svg.getBoundingClientRect();if(!r.width||!r.height)return;
      const dx=(e.clientX-this.pan.x)/r.width*this.pan.start.w,dy=(e.clientY-this.pan.y)/r.height*this.pan.start.h;
      this.view={...this.pan.start,x:this.pan.start.x-dx,y:this.pan.start.y-dy};this._apply();
    });
    const end=e=>{if(!this.pan||e.pointerId!==this.pan.id)return;this.pan=null;this.workspace.classList.remove('drawing-panning')};
    this.workspace.addEventListener('pointerup',end);this.workspace.addEventListener('pointercancel',end);
  }
}
