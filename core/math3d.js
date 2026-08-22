export const add=(a,b)=>a.map((v,i)=>v+(b[i]||0));
export const sub=(a,b)=>a.map((v,i)=>v-(b[i]||0));
export const mul=(a,s)=>a.map(v=>v*s);
export const dot=(a,b)=>a.reduce((s,v,i)=>s+v*(b[i]||0),0);
export const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const len=a=>Math.hypot(...a);
export const norm=a=>{const l=len(a)||1;return a.map(v=>v/l)};
export const dist=(a,b)=>len(sub(a,b));
export const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export function basis(axis=[0,0,1], ref=[1,0,0]) {
  const z=norm(axis), x0=sub(ref,mul(z,dot(ref,z))), x=norm(len(x0)<1e-9?cross([0,1,0],z):x0), y=norm(cross(z,x));
  return {x,y,z};
}
export function rotatePoint(p, rx, ry) {
  let [x,y,z]=p; const cy=Math.cos(ry), sy=Math.sin(ry), cx=Math.cos(rx), sx=Math.sin(rx);
  [x,z]=[x*cy+z*sy,-x*sy+z*cy]; [y,z]=[y*cx-z*sx,y*sx+z*cx]; return [x,y,z];
}

// Rigid transforms used by the STEP assembly import. A transform maps p -> R*p + t.
export const identityTransform=()=>({R:[[1,0,0],[0,1,0],[0,0,1]],t:[0,0,0]});
export function placementTransform(pl={origin:[0,0,0],axis:[0,0,1],refdir:[1,0,0]}){
  const b=basis(pl.axis,pl.refdir),o=pl.origin||[0,0,0];
  return {R:[[b.x[0],b.y[0],b.z[0]],[b.x[1],b.y[1],b.z[1]],[b.x[2],b.y[2],b.z[2]]],t:[...o]};
}
function matVec(R,p){return [dot(R[0],p),dot(R[1],p),dot(R[2],p)]}
function matMul(A,B){
  const Bt=[[B[0][0],B[1][0],B[2][0]],[B[0][1],B[1][1],B[2][1]],[B[0][2],B[1][2],B[2][2]]];
  return A.map(r=>Bt.map(c=>dot(r,c)));
}
function transpose(R){return [[R[0][0],R[1][0],R[2][0]],[R[0][1],R[1][1],R[2][1]],[R[0][2],R[1][2],R[2][2]]]}
export function invertTransform(T){const Rt=transpose(T.R),ti=mul(matVec(Rt,T.t),-1);return {R:Rt,t:ti}}
export function composeTransform(A,B){return {R:matMul(A.R,B.R),t:add(matVec(A.R,B.t),A.t)}} // A after B
export function applyTransform(T,p){return add(matVec(T.R,p),T.t)}
export function applyVector(T,v){return matVec(T.R,v)}
export function betweenPlacements(from,to){return composeTransform(placementTransform(to),invertTransform(placementTransform(from)))}
