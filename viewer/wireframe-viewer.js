import {add,mul,basis,sub,rotatePoint} from '../core/math3d.js';

export class WireframeViewer{
  constructor(canvas){
    this.canvas=canvas; this.ctx=canvas.getContext('2d'); this.rec=null; this.rx=-0.5; this.ry=0.65; this.zoom=1; this.pan=[0,0]; this.drag=null; this.showSurfaces=true; this.resizeObs=new ResizeObserver(()=>this.resize()); this.resizeObs.observe(canvas.parentElement); this.bind(); this.resize();
  }
  setModel(rec){this.rec=rec;this.fit();this.draw()}
  clear(){this.rec=null;this.draw()}
  fit(){this.zoom=1;this.pan=[0,0];this.draw()}
  bind(){
    this.canvas.addEventListener('pointerdown',e=>{this.drag=[e.clientX,e.clientY];this.canvas.setPointerCapture(e.pointerId)});
    this.canvas.addEventListener('pointermove',e=>{if(!this.drag)return;const dx=e.clientX-this.drag[0],dy=e.clientY-this.drag[1];this.ry+=dx*0.008;this.rx+=dy*0.008;this.drag=[e.clientX,e.clientY];this.draw()});
    this.canvas.addEventListener('pointerup',()=>this.drag=null);
    this.canvas.addEventListener('wheel',e=>{e.preventDefault();this.zoom*=Math.exp(-e.deltaY*0.001);this.zoom=Math.max(.15,Math.min(8,this.zoom));this.draw()},{passive:false});
  }
  resize(){const r=this.canvas.parentElement.getBoundingClientRect(),d=devicePixelRatio||1;this.canvas.width=Math.max(1,Math.round(r.width*d));this.canvas.height=Math.max(1,Math.round(r.height*d));this.canvas.style.width=r.width+'px';this.canvas.style.height=r.height+'px';this.ctx.setTransform(d,0,0,d,0,0);this.draw()}
  project(p,scale,cx,cy,center){const q=rotatePoint(sub(p,center),this.rx,this.ry);return [cx+q[0]*scale*this.zoom,cy-q[1]*scale*this.zoom,q[2]]}
  sampleCircle(e,n=72){const {x,y}=basis(e.placement.axis,e.placement.refdir),o=e.placement.origin;const pts=[];for(let i=0;i<=n;i++){const a=i/n*Math.PI*2;pts.push(add(o,add(mul(x,Math.cos(a)*e.radius),mul(y,Math.sin(a)*e.radius))))}return pts}
  sampleEllipse(e,n=72){const {x,y}=basis(e.placement.axis,e.placement.refdir),o=e.placement.origin;const pts=[];for(let i=0;i<=n;i++){const a=i/n*Math.PI*2;pts.push(add(o,add(mul(x,Math.cos(a)*e.r1),mul(y,Math.sin(a)*e.r2))))}return pts}
  draw(){
    const c=this.ctx,w=this.canvas.clientWidth||1,h=this.canvas.clientHeight||1;c.clearRect(0,0,w,h);c.fillStyle='#080d15';c.fillRect(0,0,w,h);
    c.strokeStyle='#17263a';c.lineWidth=1;for(let x=0;x<w;x+=40){c.beginPath();c.moveTo(x,0);c.lineTo(x,h);c.stroke()}for(let y=0;y<h;y+=40){c.beginPath();c.moveTo(0,y);c.lineTo(w,y);c.stroke()}
    if(!this.rec){c.fillStyle='#8093aa';c.font='14px system-ui';c.fillText('Загрузите STEP/STP',24,36);return}
    const b=this.rec.bounds, max=Math.max(...b.size,1), scale=Math.min(w,h)*0.58/max, cx=w/2+this.pan[0],cy=h/2+this.pan[1],center=b.center;
    const segs=[];
    for(const e of this.rec.edges){let pts;if(e.kind==='circle')pts=this.sampleCircle(e);else if(e.kind==='ellipse')pts=this.sampleEllipse(e);else pts=[e.p1,e.p2];for(let i=0;i<pts.length-1;i++){const a=this.project(pts[i],scale,cx,cy,center),bb=this.project(pts[i+1],scale,cx,cy,center);segs.push([a,bb,(a[2]+bb[2])/2,e.kind])}}
    segs.sort((a,b)=>a[2]-b[2]);
    for(const [a,bb,,kind] of segs){c.strokeStyle=kind==='circle'?'#73dbff':'#a8c7df';c.globalAlpha=kind==='circle'?0.92:0.72;c.lineWidth=kind==='circle'?1.4:1;c.beginPath();c.moveTo(a[0],a[1]);c.lineTo(bb[0],bb[1]);c.stroke()}
    c.globalAlpha=1;
    c.fillStyle='#7c8ca1';c.font='12px ui-monospace,monospace';c.fillText(`${this.rec.counts.solids} body · ${this.rec.counts.faces} faces · ${this.rec.counts.edges} edges`,14,h-16);
  }
}
