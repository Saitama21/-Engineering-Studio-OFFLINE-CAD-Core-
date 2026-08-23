// ROZFOOD Engineering Studio v9.0.0 — Adaptive Parametric Patch Core
// Converts unresolved developable/freeform FaceTessellations into face-owned C0 parametric patches.
// This is a deterministic geometric fallback above raw triangle HLR: patches preserve Face ownership,
// per-vertex normals, local (u,v) coordinates and adaptive cells for visibility/projection.
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const len=a=>Math.hypot(a[0],a[1],a[2]);
const norm=a=>{const L=len(a)||1;return[a[0]/L,a[1]/L,a[2]/L]};
const cache=new WeakMap();
const faceKeyOf=f=>f?.faceKey||[f?.componentId||'RAW',f?.modelId||'',f?.sourceStream||'',f?.tessFaceId??''].join('|');
function boxOf(a,b,c){return{min:[Math.min(a[0],b[0],c[0]),Math.min(a[1],b[1],c[1]),Math.min(a[2],b[2],c[2])],max:[Math.max(a[0],b[0],c[0]),Math.max(a[1],b[1],c[1]),Math.max(a[2],b[2],c[2])]}}
function basis(points){let o=points[0]||[0,0,0],n=[0,0,0];for(let i=1;i+1<points.length;i++){const z=cross(sub(points[i],o),sub(points[i+1],o));if(len(z)>len(n))n=z}n=norm(n);let u=Math.abs(n[0])<.8?norm(cross(n,[1,0,0])):norm(cross(n,[0,1,0]));let v=norm(cross(n,u));return{o,u,v,n}}
function uv(B,p){const d=sub(p,B.o);return[dot(d,B.u),dot(d,B.v)]}
export function reconstructAdaptiveParametricPatches(rec,surfaceModel){const hit=cache.get(rec);if(hit)return hit;const supported=new Set();for(const s of surfaceModel?.surfaces?.values?.()||[])if(['plane','plane-inferred','cylinder','cone-inferred','sphere-inferred','helicoid','ruled/helical'].includes(s.type))supported.add(s.faceKey);
 const groups=new Map();for(const f of rec?.faces||[]){const fk=faceKeyOf(f);if(supported.has(fk))continue;let g=groups.get(fk);if(!g)groups.set(fk,g={faceKey:fk,componentId:String(f.componentId||'RAW'),modelId:f.modelId||null,faces:[],points:[]});g.faces.push(f);for(const loop of f.loops||[])for(const p of loop||[])g.points.push(p)}
 const patches=new Map();let cells=0;for(const g of groups.values()){if(g.points.length<3)continue;const B=basis(g.points),pcells=[];for(const f of g.faces){const p=f?.loops?.[0]||[];if(p.length<3)continue;for(let i=1;i+1<p.length;i++){const a=p[0],b=p[i],c=p[i+1];if(len(cross(sub(b,a),sub(c,a)))<1e-10)continue;const ua=uv(B,a),ub=uv(B,b),uc=uv(B,c);pcells.push({a,b,c,uv:[ua,ub,uc],normal:norm(cross(sub(b,a),sub(c,a))),box:boxOf(a,b,c)})}}if(!pcells.length)continue;let mn=[Infinity,Infinity,Infinity],mx=[-Infinity,-Infinity,-Infinity];for(const c of pcells)for(let k=0;k<3;k++){mn[k]=Math.min(mn[k],c.box.min[k]);mx[k]=Math.max(mx[k],c.box.max[k])}patches.set(g.faceKey,{type:'adaptive-patch',faceKey:g.faceKey,componentId:g.componentId,modelId:g.modelId,basis:B,cells:pcells,box:{min:mn,max:mx},confidence:.72,source:'FaceTessellations adaptive C0 patch'});cells+=pcells.length}
 const out={version:'9.0.0',kernel:'ROZFOOD Adaptive Parametric Patch Core',patches,counts:{faces:patches.size,cells}};cache.set(rec,out);rec.adaptiveParametricPatches=out;return out}
