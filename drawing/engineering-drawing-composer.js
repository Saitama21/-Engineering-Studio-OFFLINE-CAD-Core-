// ROZFOOD Engineering Studio v14.0.0 — Engineering Drawing Composer
// Deterministic engineering sheet planner. It allocates views, sections, details,
// dimensions, BOM and stamp as a constrained A2 layout instead of hard-coded pixels.

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const rect=(x,y,w,h)=>({x,y,w,h});
const area=b=>Math.max(0,b.w)*Math.max(0,b.h);
const overlap=(a,b,p=0)=>!(a.x+a.w+p<=b.x||b.x+b.w+p<=a.x||a.y+a.h+p<=b.y||b.y+b.h+p<=a.y);

function complexity(rec,ids=null){
  const faces=(rec?.faces||[]).filter(f=>!ids||ids.has(f.componentId));
  const comps=new Set(faces.map(f=>f.componentId));
  const loops=faces.reduce((s,f)=>s+(f.loops?.length||0),0);
  return {faces:faces.length,components:comps.size,loops,score:Math.log2(2+faces.length)+Math.log2(2+comps.size)*.7};
}

function safeRect(b,p){return rect(b.x+p,b.y+p,Math.max(1,b.w-2*p),Math.max(1,b.h-2*p))}

function makeLanes(box,side,count=3,step=18,gap=7){
  const out=[];
  for(let i=0;i<count;i++){
    if(side==='top')out.push(box.y-gap-i*step);
    else if(side==='bottom')out.push(box.y+box.h+gap+i*step);
    else if(side==='left')out.push(box.x-gap-i*step);
    else out.push(box.x+box.w+gap+i*step);
  }
  return out;
}

export function composeDrumA2(rec,plan,{mode='assemblyDetailed',sectionPlan=null,hasCross=false}={}){
  const W=1684,H=1191,frame={x:80,y:34,w:1554,h:1100};
  const aspect=plan?.L/Math.max(plan?.D||1,1);
  const dense=complexity(rec);
  // Bottom-right is protected for BOM + title block. The rest is allocated in three bands.
  const gap=24;
  const topH=clamp(238+dense.score*1.8,242,270);
  const midH=clamp(292+dense.score*1.9,300,330);
  const lowerY=frame.y+topH+gap+midH+gap;
  const lowerH=Math.max(205,1030-lowerY);

  // Long assemblies deserve more width for longitudinal views; end/detail views share the remainder.
  const longShare=clamp(.43+.025*(aspect-2),.42,.50);
  const topLongW=Math.round(frame.w*longShare);
  const topRemain=frame.w-topLongW-2*gap;
  const endW=Math.round(topRemain*(hasCross?.40:.52));
  const crossW=topRemain-endW;

  const top=rect(frame.x+22,frame.y+10,topLongW,topH-18);
  const end=rect(top.x+top.w+gap,frame.y+11,endW,topH-32);
  const crossX=end.x+end.w+gap;
  const cross=rect(crossX,frame.y+11,Math.max(120,Math.min(crossW,frame.x+frame.w-crossX)),topH-10);

  const mainW=Math.round(frame.w*.50);
  const main=rect(frame.x+28,frame.y+topH+gap,mainW,midH);
  const isoShell=rect(main.x+main.w+gap+120,main.y-15,frame.x+frame.w-(main.x+main.w+gap+120),midH-5);

  // Lower band mirrors classical assembly sheets: longitudinal section left, local sections center,
  // exploded/isometric view and BOM/title block at right.
  const aa=rect(frame.x+22,lowerY+18,Math.round(frame.w*.405),Math.min(220,lowerH-30));
  const bb=rect(aa.x+aa.w+18,lowerY+8,182,132);
  const detailD=rect(bb.x+42,lowerY+150,190,176);
  const isoOpen=rect(detailD.x+detailD.w+10,lowerY-20,Math.max(220,frame.x+frame.w-354-(detailD.x+detailD.w+22)),275);
  const bom=rect(frame.x+frame.w-354,lowerY+8,354,258);
  const stamp=rect(frame.x+frame.w-538,H-151,538,105);

  // Safety pass: keep all high-priority regions clear of stamp and BOM.
  for(const b of [isoOpen,detailD]){
    if(overlap(b,bom,8))b.w=Math.max(120,bom.x-b.x-12);
    if(overlap(b,stamp,8))b.h=Math.max(90,stamp.y-b.y-12);
  }

  const boxes={top,end,cross,main,isoShell,aa,bb,detailD,isoOpen,bom,stamp};
  const lanes={
    topOverall:makeLanes(top,'top',3,18,8),
    topChain:makeLanes(top,'bottom',2,18,4),
    mainBottom:makeLanes(main,'bottom',4,19,20),
    mainLeft:makeLanes(main,'left',4,17,10),
    endBottom:makeLanes(end,'bottom',4,18,14)
  };
  const occupied=[...Object.entries(boxes).map(([id,b])=>({id,...b,priority:['stamp','bom'].includes(id)?10:5}))];
  const score={
    sheetUtilization:occupied.reduce((s,b)=>s+area(b),0)/(W*H),
    modelComplexity:dense.score,
    aspect,
    sections:sectionPlan?3:0,
    collisionPairs:0
  };
  for(let i=0;i<occupied.length;i++)for(let j=i+1;j<occupied.length;j++)if(overlap(occupied[i],occupied[j],2))score.collisionPairs++;
  return {version:'14.0.0',kernel:'ROZFOOD Engineering Drawing Composer',sheet:{format:'A2',W,H,frame},boxes,lanes,occupied,score,note:'Deterministic constrained layout. View slots are driven by model aspect/complexity and protected BOM/title-block regions; no ML/AI is used.'};
}

export function composerDiagnostics(plan){
  return {version:plan?.version||'10.0.0',format:plan?.sheet?.format||'A2',boxes:Object.keys(plan?.boxes||{}).length,collisionPairs:plan?.score?.collisionPairs||0,sheetUtilization:plan?.score?.sheetUtilization||0,modelComplexity:plan?.score?.modelComplexity||0};
}
