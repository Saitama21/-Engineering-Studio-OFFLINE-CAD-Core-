// ROZFOOD Section Material Core v5.0.0
import {weldedThicknessMap,weldedRoleMap} from '../core/welded-assembly-geometry.js';
// Reconstructs thin plate / sheet material areas from paired open section chains.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const sub2=(a,b)=>[a[0]-b[0],a[1]-b[1]];
const dot2=(a,b)=>a[0]*b[0]+a[1]*b[1];
const len2=a=>Math.hypot(a[0],a[1]);
const norm2=a=>{const l=len2(a)||1;return[a[0]/l,a[1]/l]};
function polyLen(p){let s=0;for(let i=1;i<p.length;i++)s+=dist(p[i-1],p[i]);return s}
function centroid(p){let x=0,y=0;for(const q of p){x+=q[0];y+=q[1]}return[x/Math.max(1,p.length),y/Math.max(1,p.length)]}
function area(poly){let a=0;for(let i=0;i<poly.length-1;i++)a+=poly[i][0]*poly[i+1][1]-poly[i+1][0]*poly[i][1];return a*.5}
function endpointFit(a,b){
  const same=(dist(a[0],b[0])+dist(a.at(-1),b.at(-1)))/2;
  const flip=(dist(a[0],b.at(-1))+dist(a.at(-1),b[0]))/2;
  return flip<same?{d:flip,reverse:true}:{d:same,reverse:false};
}
function sheetThicknessMap(rec){const m=new Map();for(const sm of rec?.manufacturing?.sheetMetal?.components||[])if(Number.isFinite(sm.thickness))m.set(sm.componentId,sm.thickness);return m}
function classMap(rec){return new Map((rec?.manufacturing?.classes||[]).map(x=>[x.componentId,x.class]))}
/** Returns reconstructed closed 2D material loops in drawing coordinates. */
export function reconstructSectionMaterial(rec,chains,map,{includeComponents=null}={}){
  const byComp=new Map();
  for(const ch of chains||[]){const id=ch.componentId||'RAW';if(ch.closed||includeComponents&&!includeComponents.has(id))continue;const pts=(ch.points||[]).map(map.P);if(pts.length<2)continue;const L=polyLen(pts);if(L<3)continue;let a=byComp.get(id);if(!a)byComp.set(id,a=[]);a.push({pts,L,c:centroid(pts)});}
  const thickness=sheetThicknessMap(rec),weldThickness=weldedThicknessMap(rec),weldRoles=weldedRoleMap(rec),classes=classMap(rec),loopsByComponent=new Map();let paired=0,candidates=0;
  for(const [id,items] of byComp){
    if(items.length<2)continue;
    const used=new Set(),out=[];const tmm=thickness.get(id)??weldThickness.get(id),weldRole=weldRoles.get(id),className=classes.get(id),tpx=Number.isFinite(tmm)?tmm*map.scale:null;
    const scores=[];
    for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++){
      const A=items[i],B=items[j],lr=Math.max(A.L,B.L)/Math.max(1e-6,Math.min(A.L,B.L));if(lr>1.55)continue;
      const ta=norm2(sub2(A.pts.at(-1),A.pts[0])),tb=norm2(sub2(B.pts.at(-1),B.pts[0]));const parallel=Math.abs(dot2(ta,tb));if(parallel<.84)continue;
      const fit=endpointFit(A.pts,B.pts),cd=dist(A.c,B.c),expected=tpx||Math.max(1.2,Math.min(A.L,B.L)*.035);
      const maxSep=Math.max(8,expected*5.5),minSep=Math.max(.45,expected*.18);if(fit.d<minSep||fit.d>maxSep||cd>maxSep*1.45)continue;
      // Prefer recognized sheet metal, but also allow strong geometric thin-strip evidence.
      const semantic=className==='sheet-metal'?1:(weldRole==='blade/rib'||weldRole==='plate/rib')?.92:weldRole==='cross-member'?.55:className==='general'?.25:0;
      const thicknessFit=Math.exp(-Math.abs(fit.d-expected)/Math.max(1,expected*1.7));
      const score=parallel*.42+(1/Math.max(1,lr))*.18+thicknessFit*.28+semantic*.12;
      if(score<(weldRole==='blade/rib'||weldRole==='plate/rib'?.61:.67))continue;scores.push({i,j,fit,score});candidates++;
    }
    scores.sort((a,b)=>b.score-a.score);
    for(const s of scores){if(used.has(s.i)||used.has(s.j))continue;const A=items[s.i].pts,B0=items[s.j].pts,B=s.fit.reverse?[...B0].reverse():B0;const poly=[...A,...[...B].reverse()];poly.push(poly[0]);const ar=Math.abs(area(poly));const long=Math.max(items[s.i].L,items[s.j].L),width=ar/Math.max(1,long);if(ar<4||width<.35||width>Math.max(28,(tpx||3)*7))continue;out.push(poly);used.add(s.i);used.add(s.j);paired++;}
    if(out.length)loopsByComponent.set(id,out);
  }
  return{loopsByComponent,paired,candidates,components:loopsByComponent.size};
}
