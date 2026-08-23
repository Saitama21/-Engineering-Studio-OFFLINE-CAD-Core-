// ROZFOOD Engineering Studio v6.0.0 — View-Aware CAD Edge Graph Core
// Removes duplicate/overlapping projected CAD edges before HLR. Fully local, deterministic.

const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const mul=(a,s)=>[a[0]*s,a[1]*s,a[2]*s];
const len2=a=>Math.hypot(a[0],a[1]);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>add(mul(a,1-t),mul(b,t));
const kindRank=k=>k==='SILHOUETTE'?4:k==='BOUNDARY'?3:k==='FEATURE'?2:1;

function canonical2D(a,b){
  let dx=b[0]-a[0],dy=b[1]-a[1],l=Math.hypot(dx,dy);
  if(l<1e-10)return null;dx/=l;dy/=l;
  if(dx<0||(Math.abs(dx)<1e-12&&dy<0)){dx=-dx;dy=-dy}
  const nx=-dy,ny=dx,offset=nx*a[0]+ny*a[1];
  return{u:[dx,dy],n:[nx,ny],offset,length:l};
}
function projection(p,s){return[dot(p,s.px),dot(p,s.py)]}
function lineDistance2D(p,L){return Math.abs(L.n[0]*p[0]+L.n[1]*p[1]-L.offset)}
function edgeAtProjectedT(item,t){
  const den=item.t1-item.t0;if(Math.abs(den)<1e-12)return item.edge.a;
  return lerp(item.edge.a,item.edge.b,clamp((t-item.t0)/den,0,1));
}
function mergeMeta(base,other){
  const faceKeys=[...(base.faceKeys||[])];for(const k of other.faceKeys||[])if(!faceKeys.includes(k))faceKeys.push(k);
  const componentIds=[...(base.componentIds||[base.componentId].filter(Boolean))];for(const k of other.componentIds||[other.componentId].filter(Boolean))if(!componentIds.includes(k))componentIds.push(k);
  const normals=[...(base.normals||[])];for(const n of other.normals||[])normals.push(n);
  const contributors=(base.contributors||[]).map(c=>({...c,normals:[...(c.normals||[])],faceKeys:[...(c.faceKeys||[])]}));for(const c of other.contributors||[]){let x=contributors.find(z=>z.componentId===c.componentId);if(!x){x={componentId:c.componentId,normals:[],faceKeys:[],faces:0};contributors.push(x)}for(const n of c.normals||[])x.normals.push(n);for(const fk of c.faceKeys||[])if(!x.faceKeys.includes(fk))x.faceKeys.push(fk);x.faces+=(c.faces||0)}
  return{...base,faceKeys,componentIds,componentId:componentIds.length===1?componentIds[0]:'MULTI',normals,contributors,faces:(base.faces||0)+(other.faces||0)};
}

/**
 * Resolve CAD edges that collapse onto the same 2D line in the current view.
 * Overlap intervals are split at all CAD endpoints; for each interval the front-most
 * physical edge wins. This happens before raster HLR, so duplicate assembly boundaries
 * never enter the hidden-line solver.
 */
export function resolveProjectedCadEdges(edges,s,rec,{angleDeg=.08,lineTol=null,breakTol=null}={}){
  const diag=Math.hypot(...(rec?.bounds?.size||[1,1,1]))||1;
  const angleStep=Math.max(angleDeg*Math.PI/180,1e-5);
  lineTol=lineTol??Math.max(.012,Math.min(.08,diag*4e-5));
  breakTol=breakTol??Math.max(.006,lineTol*.45);
  const buckets=new Map(),passthrough=[];
  for(const edge of edges||[]){
    const a2=projection(edge.a,s),b2=projection(edge.b,s),L=canonical2D(a2,b2);
    if(!L||L.length<breakTol){passthrough.push(edge);continue}
    const angle=Math.atan2(L.u[1],L.u[0]);
    const ak=Math.round(angle/angleStep),ok=Math.round(L.offset/lineTol);
    const key=`${ak}|${ok}`;
    const tA=L.u[0]*a2[0]+L.u[1]*a2[1],tB=L.u[0]*b2[0]+L.u[1]*b2[1];
    const item={edge,a2,b2,L,t0:Math.min(tA,tB),t1:Math.max(tA,tB)};
    let arr=buckets.get(key);if(!arr){arr=[];buckets.set(key,arr)}arr.push(item);
  }
  const out=[...passthrough];let collapsedIntervals=0,overlapGroups=0,inputIntervals=0;
  for(const arr of buckets.values()){
    if(arr.length===1){out.push(arr[0].edge);continue}
    // Guard against quantization-neighbor false matches: partition by actual line distance/angle.
    const clusters=[];
    for(const item of arr){let cluster=null;for(const c of clusters){const du=Math.abs(item.L.u[0]*c.L.u[0]+item.L.u[1]*c.L.u[1]);if(du<Math.cos(angleDeg*Math.PI/180))continue;if(Math.abs(item.L.offset-c.L.offset)>lineTol)continue;cluster=c;break}if(!cluster){cluster={L:item.L,items:[]};clusters.push(cluster)}cluster.items.push(item)}
    for(const cluster of clusters){const items=cluster.items;if(items.length===1){out.push(items[0].edge);continue}overlapGroups++;
      const cuts=[];for(const x of items){cuts.push(x.t0,x.t1)}cuts.sort((a,b)=>a-b);
      const uniq=[];for(const t of cuts)if(!uniq.length||Math.abs(t-uniq.at(-1))>breakTol)uniq.push(t);else uniq[uniq.length-1]=(uniq.at(-1)+t)/2;
      const produced=[];
      for(let i=0;i<uniq.length-1;i++){
        const lo=uniq[i],hi=uniq[i+1];if(hi-lo<breakTol)continue;const mid=(lo+hi)/2;
        const cover=items.filter(x=>mid>=x.t0-breakTol&&mid<=x.t1+breakTol);if(!cover.length)continue;inputIntervals+=cover.length;
        let winner=cover[0],best=-Infinity;
        for(const x of cover){const p=edgeAtProjectedT(x,mid),depth=dot(p,s.dir),score=depth+kindRank(x.edge.kind)*diag*1e-10;if(score>best){best=score;winner=x}}
        const a=edgeAtProjectedT(winner,lo),b=edgeAtProjectedT(winner,hi);let merged={...winner.edge,a,b};
        // Retain semantic provenance from coincident contributors without drawing them twice.
        for(const x of cover)if(x!==winner)merged=mergeMeta(merged,x.edge);
        produced.push(merged);collapsedIntervals+=Math.max(0,cover.length-1);
      }
      // Join adjacent intervals that came from the same winning line class/provenance.
      for(const e of produced){const prev=out.at(-1);if(prev&&prev.kind===e.kind&&prev.componentId===e.componentId){const gap=Math.hypot(prev.b[0]-e.a[0],prev.b[1]-e.a[1],prev.b[2]-e.a[2]);const v1=sub(prev.b,prev.a),v2=sub(e.b,e.a),l1=Math.hypot(...v1),l2=Math.hypot(...v2),co=l1*l2?Math.abs(dot(v1,v2)/(l1*l2)):0;if(gap<lineTol*1.5&&co>.99999){prev.b=e.b;continue}}out.push(e)}
    }
  }
  return{edges:out,stats:{input:(edges||[]).length,output:out.length,overlapGroups,collapsedIntervals,inputIntervals,lineTol,angleDeg}};
}
