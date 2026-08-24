// ROZFOOD Engineering Studio v14.0.2 — Annotation Layout Core
// Collision-aware deterministic annotation placement for dimensions, leaders and notes.
const overlap=(a,b,p=0)=>!(a.x+a.w+p<=b.x||b.x+b.w+p<=a.x||a.y+a.h+p<=b.y||b.y+b.h+p<=a.y);
export function createAnnotationLayout(seed=[]){
  const occupied=seed.map(x=>({...x}));
  const reserve=(box,id='annotation',priority=1)=>{occupied.push({id,priority,...box});return box};
  const free=box=>!occupied.some(o=>overlap(box,o,4));
  const place=(preferred,{w=120,h=18,dx=18,dy=16,tries=20,id='annotation'}={})=>{
    const candidates=[preferred];
    for(let r=1;r<tries;r++){
      const k=Math.ceil(r/4),q=r%4;
      candidates.push({x:preferred.x+(q===0?k*dx:q===1?-k*dx:0),y:preferred.y+(q===2?k*dy:q===3?-k*dy:0)});
    }
    for(const p of candidates){const b={x:p.x,y:p.y,w,h};if(free(b)){reserve(b,id);return b}}
    const b={x:preferred.x,y:preferred.y,w,h};reserve(b,id);return b;
  };
  return {version:'14.0.2',kernel:'ROZFOOD Annotation Layout Core',occupied,reserve,free,place};
}
