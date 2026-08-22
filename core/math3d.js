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
