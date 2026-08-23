// ROZFOOD Engineering Studio v14.0.1 — Section Context Core
// Builds the visible geometry immediately behind a cutting plane. This gives production sections
// the required contextual edges without dumping the whole assembly wireframe into the section.

const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const norm=a=>{const l=Math.hypot(...a)||1;return a.map(v=>v/l)};

export function sectionContextRecord(rec,planePoint,planeNormal,{depth=70,frontTol=1.5,includeComponents=null}={}){
  const n=norm(planeNormal),faces=[];let considered=0,kept=0;
  for(const f of rec?.faces||[]){
    const cid=f.componentId||'RAW';if(includeComponents&&!includeComponents.has(cid))continue;
    const pts=f.loops?.[0]||[];if(!pts.length)continue;considered++;
    let min=Infinity,max=-Infinity;for(const p of pts){const d=dot(sub(p,planePoint),n);if(d<min)min=d;if(d>max)max=d}
    // Geometry at/behind the cut plane only; omit far-away geometry and anything in front of cut.
    if(min>frontTol||max<-depth)continue;
    faces.push(f);kept++;
  }
  const out={...rec,faces};
  out.sectionContext={version:'14.0.1',kernel:'ROZFOOD Section Context Core',considered,kept,depth};
  return out;
}
