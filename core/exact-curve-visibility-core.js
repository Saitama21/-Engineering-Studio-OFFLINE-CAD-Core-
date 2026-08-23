// ROZFOOD Engineering Studio v6.0.0 — Exact Curve Visibility Core
// Orthographic hidden-line solver for reconstructed CAD curves.
// Uses a BVH over source face triangles as geometric occlusion evidence instead of a raster z-buffer.
// The drawing curves themselves remain B-Rep / analytic entities; tessellation is used only for ray-hit evidence.

const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const mul=(a,s)=>[a[0]*s,a[1]*s,a[2]*s];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const len=a=>Math.hypot(a[0],a[1],a[2]);
const norm=a=>{const L=len(a)||1;return[a[0]/L,a[1]/L,a[2]/L]};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const cache=new WeakMap();

function bboxOfTri(a,b,c){return{min:[Math.min(a[0],b[0],c[0]),Math.min(a[1],b[1],c[1]),Math.min(a[2],b[2],c[2])],max:[Math.max(a[0],b[0],c[0]),Math.max(a[1],b[1],c[1]),Math.max(a[2],b[2],c[2])]}}
function unionBox(a,b){return{min:[Math.min(a.min[0],b.min[0]),Math.min(a.min[1],b.min[1]),Math.min(a.min[2],b.min[2])],max:[Math.max(a.max[0],b.max[0]),Math.max(a.max[1],b.max[1]),Math.max(a.max[2],b.max[2])]}}
function centroid(t){return[(t.box.min[0]+t.box.max[0])/2,(t.box.min[1]+t.box.max[1])/2,(t.box.min[2]+t.box.max[2])/2]}
function extent(b){return[b.max[0]-b.min[0],b.max[1]-b.min[1],b.max[2]-b.min[2]]}

function triangles(rec){
  const out=[];
  for(let fi=0;fi<(rec?.faces||[]).length;fi++){
    const f=rec.faces[fi],loop=f?.loops?.[0]||[];if(loop.length<3)continue;
    for(let i=1;i+1<loop.length;i++){
      const a=loop[0],b=loop[i],c=loop[i+1],n=cross(sub(b,a),sub(c,a));
      if(len(n)<1e-10)continue;
      out.push({a,b,c,n:norm(n),box:bboxOfTri(a,b,c),componentId:String(f.componentId||'RAW'),faceIndex:fi,faceKey:f.faceKey||f.id||fi});
    }
  }
  return out;
}
function buildNode(items,depth=0){
  let box=items[0].box;for(let i=1;i<items.length;i++)box=unionBox(box,items[i].box);
  if(items.length<=18||depth>28)return{box,items,left:null,right:null};
  const e=extent(box),axis=e.indexOf(Math.max(...e));items.sort((x,y)=>centroid(x)[axis]-centroid(y)[axis]);
  const mid=items.length>>1,left=buildNode(items.slice(0,mid),depth+1),right=buildNode(items.slice(mid),depth+1);
  return{box,items:null,left,right};
}
export function buildExactVisibilityBVH(rec){
  if(cache.has(rec))return cache.get(rec);const tris=triangles(rec),root=tris.length?buildNode(tris.slice()):null;
  const D=Math.hypot(...(rec?.bounds?.size||[1,1,1]))||1;
  const bvh={version:'6.0.0',kernel:'ROZFOOD Exact Curve Visibility Core',root,triangles:tris.length,diag:D,surfaceTol:Math.max(.002,D*1.8e-5),contactTol:Math.max(.006,D*5e-5),stats:{triangles:tris.length,nodes:0,leaves:0,maxLeaf:0,rays:0,boxTests:0,triangleTests:0,hits:0,selfHits:0,foreignHits:0}};
  (function walk(n){if(!n)return;bvh.stats.nodes++;if(n.items){bvh.stats.leaves++;bvh.stats.maxLeaf=Math.max(bvh.stats.maxLeaf,n.items.length)}else{walk(n.left);walk(n.right)}})(root);
  cache.set(rec,bvh);return bvh;
}
function rayBox(o,d,b,tMax=Infinity){
  let lo=0,hi=tMax;
  for(let k=0;k<3;k++){
    if(Math.abs(d[k])<1e-12){if(o[k]<b.min[k]-1e-9||o[k]>b.max[k]+1e-9)return false;continue}
    let a=(b.min[k]-o[k])/d[k],c=(b.max[k]-o[k])/d[k];if(a>c)[a,c]=[c,a];lo=Math.max(lo,a);hi=Math.min(hi,c);if(hi<lo)return false;
  }
  return hi>=0;
}
function rayTri(o,d,t,eps=1e-10){
  const e1=sub(t.b,t.a),e2=sub(t.c,t.a),p=cross(d,e2),det=dot(e1,p);if(Math.abs(det)<eps)return null;
  const inv=1/det,s=sub(o,t.a),u=dot(s,p)*inv;if(u<-1e-7||u>1+1e-7)return null;
  const q=cross(s,e1),v=dot(d,q)*inv;if(v<-1e-7||u+v>1+1e-7)return null;
  const dist=dot(e2,q)*inv;return dist>=-1e-9?dist:null;
}
function edgeIds(edge){const ids=new Set();if(edge?.componentId&&edge.componentId!=='MULTI'&&edge.componentId!=='RAW')ids.add(String(edge.componentId));for(const x of edge?.componentIds||[])if(x)ids.add(String(x));for(const c of edge?.contributors||[])if(c?.componentId)ids.add(String(c.componentId));return ids}
function nearestHit(bvh,o,d,ids,tMax=Infinity){
  bvh.stats.rays++;let best=null,bestT=tMax;const stack=bvh.root?[bvh.root]:[];
  while(stack.length){const n=stack.pop();bvh.stats.boxTests++;if(!rayBox(o,d,n.box,bestT))continue;
    if(n.items){for(const tr of n.items){bvh.stats.triangleTests++;const t=rayTri(o,d,tr);if(t===null||t<=bvh.surfaceTol*.35||t>=bestT)continue;bestT=t;best={t,triangle:tr,same:ids.has(tr.componentId)}}}
    else{if(n.left)stack.push(n.left);if(n.right)stack.push(n.right)}
  }
  if(best){bvh.stats.hits++;if(best.same)bvh.stats.selfHits++;else bvh.stats.foreignHits++}return best;
}
export function exactPointVisibility(p,viewDir,bvh,edge=null){
  if(!bvh?.root)return{visible:true,reason:'no-bvh'};const d=norm(viewDir),ids=edgeIds(edge),o=add(p,mul(d,bvh.surfaceTol*1.5)),hit=nearestHit(bvh,o,d,ids);
  if(!hit)return{visible:true,reason:'clear'};
  // A second body touching the point is not an occluder; farther geometry is.
  if(!hit.same&&hit.t<=bvh.contactTol)return{visible:true,reason:'contact',owner:hit.triangle.componentId,gap:hit.t};
  return{visible:false,reason:hit.same?'self':'foreign',owner:hit.triangle.componentId,gap:hit.t,faceIndex:hit.triangle.faceIndex};
}
function pointAt(edge,t){return add(mul(edge.a,1-t),mul(edge.b,t))}
function visibilityState(edge,d,bvh,t){const p=pointAt(edge,t),r=exactPointVisibility(p,d,bvh,edge);return{t,p,...r}}
export function visibleExactEdgeSegments(edge,viewDir,bvh,{samples=19,refine=9}={}){
  if(!bvh?.root)return{segments:[[edge.a,edge.b]],stats:{visible:1,hidden:0,selfOccluded:0,foreignOccluded:0,transitions:0}};
  const d=norm(viewDir),n=clamp(samples,9,65)|0,states=[];let selfOccluded=0,foreignOccluded=0;
  for(let i=0;i<n;i++){const s=visibilityState(edge,d,bvh,i/(n-1));states.push(s);if(!s.visible){if(s.reason==='foreign')foreignOccluded++;else selfOccluded++}}
  const refineBoundary=(ta,tb,va)=>{let a=ta,b=tb;for(let i=0;i<refine;i++){const m=(a+b)/2,v=visibilityState(edge,d,bvh,m).visible;if(v===va)a=m;else b=m}return(a+b)/2};
  const intervals=[];let open=states[0].visible?0:null,transitions=0;
  for(let i=0;i<n-1;i++){
    const A=states[i],B=states[i+1];if(A.visible!==B.visible){transitions++;const t=refineBoundary(A.t,B.t,A.visible);if(A.visible&&open!==null){intervals.push([open,t]);open=null}else if(B.visible)open=t}
  }
  if(states.at(-1).visible&&open!==null)intervals.push([open,1]);
  const segments=intervals.filter(([a,b])=>b-a>1e-6).map(([a,b])=>[pointAt(edge,a),pointAt(edge,b)]);
  return{segments,stats:{visible:states.filter(s=>s.visible).length,hidden:states.filter(s=>!s.visible).length,selfOccluded,foreignOccluded,transitions}};
}
export function exactCurveVisibilityStats(bvh){return bvh?{...bvh.stats,triangles:bvh.triangles,surfaceTol:bvh.surfaceTol,contactTol:bvh.contactTol}:null}
