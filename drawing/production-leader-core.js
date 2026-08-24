// ROZFOOD Engineering Studio v14.0.2 — Production Leader Core
// Collision-aware leader/callout router for engineering drawings.

const overlap=(a,b,p=0)=>!(a.x+a.w+p<=b.x||b.x+b.w+p<=a.x||a.y+a.h+p<=b.y||b.y+b.h+p<=a.y);
const esc=x=>String(x??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[m]));
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

function textSize(text,fontSize=9){return {w:Math.max(48,Math.min(220,text.length*fontSize*.56+16)),h:fontSize+9}}
function rectFor(x,y,text,fontSize){const s=textSize(text,fontSize);return {x,y,w:s.w,h:s.h}}

export function createProductionLeaderRouter(layout,{sheet={x:80,y:34,w:1554,h:1085},fontSize=9}={}){
  const leaders=[];
  const isFree=b=>!layout.occupied.some(o=>overlap(b,o,5));
  function route(anchor,text,{preferred='right',id='leader',viewBox=null,priority=1}={}){
    const ts=textSize(text,fontSize),gap=18,dirs=preferred==='left'?['left','right','top','bottom']:preferred==='top'?['top','right','left','bottom']:preferred==='bottom'?['bottom','right','left','top']:['right','left','top','bottom'];
    const candidates=[];
    for(const dir of dirs){
      for(let k=0;k<7;k++){
        let x=anchor[0],y=anchor[1];
        const off=gap+k*18;
        if(dir==='right'){x+=off+18;y-=ts.h/2-k%2*10}
        if(dir==='left'){x-=off+18+ts.w;y-=ts.h/2-k%2*10}
        if(dir==='top'){x-=ts.w/2;y-=off+18+ts.h}
        if(dir==='bottom'){x-=ts.w/2;y+=off+18}
        x=clamp(x,sheet.x+3,sheet.x+sheet.w-ts.w-3);y=clamp(y,sheet.y+3,sheet.y+sheet.h-ts.h-3);
        const b={x,y,w:ts.w,h:ts.h};
        if(viewBox&&overlap(b,viewBox,2)&&dir!=='top'&&dir!=='bottom')continue;
        candidates.push({dir,b,score:k+(dir===preferred?0:3)});
      }
    }
    candidates.sort((a,b)=>a.score-b.score);
    let pick=candidates.find(c=>isFree(c.b))||candidates[0];
    if(!pick)return null;
    const b=pick.b;layout.reserve(b,id,priority);
    const tx=b.x+7,ty=b.y+b.h*.68;
    const end=pick.dir==='left'?[b.x+b.w,b.y+b.h/2]:pick.dir==='right'?[b.x,b.y+b.h/2]:pick.dir==='top'?[b.x+b.w/2,b.y+b.h]:[b.x+b.w/2,b.y];
    const elbow=(pick.dir==='left'||pick.dir==='right')?[(anchor[0]+end[0])*.55,anchor[1]]:[anchor[0],(anchor[1]+end[1])*.55];
    const item={id,text,anchor,end,elbow,box:b,dir:pick.dir};leaders.push(item);return item;
  }
  function render(item){if(!item)return'';const {anchor,end,elbow,box,text,id}=item;return `<g data-production-leader="${esc(id)}" font-family="Arial" fill="#111" stroke="#111" stroke-width=".62"><path d="M${anchor[0].toFixed(2)} ${anchor[1].toFixed(2)}L${elbow[0].toFixed(2)} ${elbow[1].toFixed(2)}L${end[0].toFixed(2)} ${end[1].toFixed(2)}" fill="none"/><path d="M${anchor[0].toFixed(2)} ${anchor[1].toFixed(2)}l7 -2.8l-2 7z"/><rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="2" fill="#fff" stroke="none" opacity=".92"/><text x="${box.x+7}" y="${box.y+box.h*.68}" stroke="none" font-size="${fontSize}">${esc(text)}</text></g>`}
  return {version:'14.0.2',kernel:'ROZFOOD Production Leader Core',leaders,route,render,renderAll:()=>leaders.map(render).join('')};
}
