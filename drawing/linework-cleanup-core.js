// ROZFOOD Engineering Studio v6.0.0 — Contour Semantics Core
// Screen-space cleanup after HLR: duplicate suppression + safe collinear joining.
const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const q=(v,s)=>Math.round(v/s);
const pkey=(p,s)=>`${q(p[0],s)},${q(p[1],s)}`;
const skey=(a,b,s)=>{const A=pkey(a,s),B=pkey(b,s);return A<B?`${A}|${B}`:`${B}|${A}`};
const unit=(a,b)=>{const dx=b[0]-a[0],dy=b[1]-a[1],l=Math.hypot(dx,dy)||1;return[dx/l,dy/l]};
const parallel=(a,b,c,d,cosTol)=>{const u=unit(a,b),v=unit(c,d);return Math.abs(u[0]*v[0]+u[1]*v[1])>=cosTol};
const lineDistance=(p,a,b)=>{const dx=b[0]-a[0],dy=b[1]-a[1],l=Math.hypot(dx,dy)||1;return Math.abs(dy*p[0]-dx*p[1]+b[0]*a[1]-b[1]*a[0])/l};

export function cleanProjectedSegments(input,{quant=.16,minLength=.30,joinGap=.30,angleDeg=.35,lineTol=.16}={}){
  const unique=[],seen=new Set();let droppedDuplicates=0,droppedShort=0;
  for(const s of input||[]){const a=s.a,b=s.b;if(!a||!b||dist(a,b)<minLength){droppedShort++;continue}const k=skey(a,b,quant);if(seen.has(k)){droppedDuplicates++;continue}seen.add(k);unique.push({a:a.slice(),b:b.slice()})}
  const cosTol=Math.cos(angleDeg*Math.PI/180),used=new Uint8Array(unique.length),out=[];
  // Conservative O(n²) join. Drawing view segment counts are small after CAD/HLR filtering.
  for(let i=0;i<unique.length;i++){
    if(used[i])continue;used[i]=1;let cur={a:unique[i].a,b:unique[i].b},changed=true;
    while(changed){changed=false;
      for(let j=0;j<unique.length;j++){
        if(used[j])continue;const s=unique[j];if(!parallel(cur.a,cur.b,s.a,s.b,cosTol))continue;
        if(Math.max(lineDistance(s.a,cur.a,cur.b),lineDistance(s.b,cur.a,cur.b))>lineTol)continue;
        const pairs=[[cur.a,s.a,0,0],[cur.a,s.b,0,1],[cur.b,s.a,1,0],[cur.b,s.b,1,1]].sort((x,y)=>dist(x[0],x[1])-dist(y[0],y[1]));
        const best=pairs[0];if(dist(best[0],best[1])>joinGap)continue;
        const pts=[cur.a,cur.b,s.a,s.b],u=unit(cur.a,cur.b),origin=cur.a,proj=p=>(p[0]-origin[0])*u[0]+(p[1]-origin[1])*u[1];pts.sort((x,y)=>proj(x)-proj(y));cur={a:pts[0],b:pts[3]};used[j]=1;changed=true;break;
      }
    }
    out.push(cur);
  }
  return{segments:out,stats:{input:(input||[]).length,output:out.length,droppedDuplicates,droppedShort,joined:Math.max(0,unique.length-out.length)}};
}
export function segmentsPath(segments){let d='';for(const s of segments||[])d+=`M${s.a[0].toFixed(2)} ${s.a[1].toFixed(2)}L${s.b[0].toFixed(2)} ${s.b[1].toFixed(2)}`;return d}
