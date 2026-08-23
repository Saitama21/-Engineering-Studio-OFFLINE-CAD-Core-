const EPS=1e-9;
const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const mul=(a,s)=>[a[0]*s,a[1]*s,a[2]*s];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const len=a=>Math.hypot(a[0],a[1],a[2]);
const norm=a=>{const l=len(a)||1;return[a[0]/l,a[1]/l,a[2]/l]};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function triArea(a,b,c){return .5*len(cross(sub(b,a),sub(c,a)))}
function angleDeg(a,b){return Math.acos(clamp(Math.abs(dot(norm(a),norm(b))),-1,1))*180/Math.PI}
function corners(b){const out=[];for(const x of [b.min[0],b.max[0]])for(const y of [b.min[1],b.max[1]])for(const z of [b.min[2],b.max[2]])out.push([x,y,z]);return out}
function axisInterval(bounds,axis){const t=corners(bounds).map(p=>dot(p,axis));return{min:Math.min(...t),max:Math.max(...t),span:Math.max(...t)-Math.min(...t)}}
function componentBounds(rec){const map=new Map();for(const f of rec?.faces||[]){const id=f.componentId||'RAW';let b=map.get(id);if(!b){b={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity],points:0};map.set(id,b)}for(const loop of f.loops||[])for(const p of loop||[]){for(let i=0;i<3;i++){b.min[i]=Math.min(b.min[i],p[i]);b.max[i]=Math.max(b.max[i],p[i])}b.points++}}for(const b of map.values()){b.size=b.max.map((v,i)=>v-b.min[i]);b.center=b.max.map((v,i)=>(v+b.min[i])/2)}return map}
function componentAreas(rec){const map=new Map();for(const f of rec?.faces||[]){const id=f.componentId||'RAW';let a=map.get(id)||0;for(const loop of f.loops||[]){if(loop.length<3)continue;for(let i=1;i+1<loop.length;i++)a+=triArea(loop[0],loop[i],loop[i+1])}map.set(id,a)}return map}
function faceGroupAreas(rec){const map=new Map();for(const f of rec?.faces||[]){const key=[f.componentId||'RAW',f.sourceStream||'',f.tessFaceId??''].join('|');let g=map.get(key);if(!g){g={key,componentId:f.componentId||'RAW',area:0,bounds:{min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]},triangles:0};map.set(key,g)}for(const loop of f.loops||[]){if(loop.length<3)continue;for(let i=1;i+1<loop.length;i++){g.area+=triArea(loop[0],loop[i],loop[i+1]);g.triangles++}for(const p of loop)for(let j=0;j<3;j++){g.bounds.min[j]=Math.min(g.bounds.min[j],p[j]);g.bounds.max[j]=Math.max(g.bounds.max[j],p[j])}}}for(const g of map.values())g.bounds.size=g.bounds.max.map((v,i)=>v-g.bounds.min[i]);return map}
function uniqueBy(list,keyFn){const out=[],seen=new Set();for(const item of list){const k=keyFn(item);if(seen.has(k))continue;seen.add(k);out.push(item)}return out}
function median(values){const a=values.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2}
function clusterNumbers(values,tolRel=.035,tolAbs=.08){const groups=[];for(const value of values.filter(Number.isFinite).sort((a,b)=>a-b)){let g=groups.find(x=>Math.abs(value-x.value)<=Math.max(tolAbs,Math.abs(x.value)*tolRel));if(!g){g={value,values:[]};groups.push(g)}g.values.push(value);g.value=g.values.reduce((s,x)=>s+x,0)/g.values.length}return groups.sort((a,b)=>b.values.length-a.values.length||a.value-b.value)}
function componentNameMap(rec){const map=new Map();for(const o of rec?.occurrences||[])map.set(o.id,o.name||o.fileName||o.id);return map}

function resolveMaterials(rec){
  const values=rec?.documentProperties?.values||{};
  const candidates=[];
  for(const [key,value0] of Object.entries(values)){
    const value=String(value0||'').trim();if(!value)continue;
    if(/material|материал|матеріал|steel|сталь|нерж|aisi|inox|aluminium|aluminum/i.test(key+' '+value))candidates.push({key,value});
  }
  const first=candidates[0]||null;
  return{documentMaterial:first?.value||null,source:first?`docProps:${first.key}`:'not-present-in-assembly',candidates,perComponentAvailable:false,note:first?'Материал найден в свойствах документа SLDASM.':'В этом SLDASM материал деталей не сохранён как доступное свойство. Для точного материала каждой позиции нужен SLDPRT/SLDDRW property stream или явная спецификация.'};
}

function classifyHoles(rec,boundsMap){
  const R=rec?.recognition||{},groups=R.coaxialGroups||[],out=[];
  for(const h of R.holes||[]){
    if(!h.full||h.confidence<.68)continue;
    const bounds=boundsMap.get(h.componentId||'RAW')||rec.bounds,axis=norm(h.axis),iv=axisInterval(bounds,axis),center=dot(h.axisPoint,axis),a=center-h.length/2,b=center+h.length/2,tol=Math.max(.12,h.diameter*.025,iv.span*.006);
    const touchesMin=Math.abs(a-iv.min)<=tol||Math.abs(b-iv.min)<=tol,touchesMax=Math.abs(a-iv.max)<=tol||Math.abs(b-iv.max)<=tol;
    const coax=groups.find(g=>g.componentId===h.componentId&&angleDeg(g.axis,h.axis)<1.5&&len(sub(g.axisPoint,h.axisPoint))<Math.max(2,h.diameter*.25));
    const holeMembers=(coax?.members||[]).filter(x=>x.type==='hole');
    const diameters=[...new Set(holeMembers.map(x=>Math.round(x.diameter*100)/100))].sort((x,y)=>y-x);
    const kind=touchesMin&&touchesMax?'through':diameters.length>1?'stepped':'blind';
    out.push({...h,holeKind:kind,diameters,opensMin:touchesMin,opensMax:touchesMax,callout:`${kind==='through'?'СКВОЗН. ':kind==='blind'?'ГЛУХ. ':kind==='stepped'?'СТУПЕНЧ. ':''}Ø${fmt(h.diameter)}`,depth:kind==='blind'?h.length:null,confidence:Math.min(1,h.confidence+(touchesMin&&touchesMax ? .02 : 0))});
  }
  return uniqueBy(out,h=>`${h.componentId}|${Math.round(h.diameter*100)}|${Math.round(dot(h.axisPoint,h.axis)*10)}|${h.holeKind}`);
}

function detectFillets(rec){
  const result=[],diag=Math.hypot(...(rec?.bounds?.size||[1,1,1]))||1;
  for(const c of rec?.recognition?.cylinders||[]){
    if(c.full||c.confidence<.72)continue;
    const sweep=(c.coverageRad||0)*180/Math.PI;
    if(sweep<18||sweep>175)continue;
    if(c.radius>diag*.12||c.length<Math.max(.4,c.radius*.8))continue;
    result.push({componentId:c.componentId,kind:'fillet',radius:c.radius,axis:c.axis,axisPoint:c.axisPoint,length:c.length,sweepDeg:sweep,coverageRad:c.coverageRad||0,faceKey:c.faceKey||null,modelId:c.modelId||null,confidence:clamp(c.confidence*.91,0,1),source:'partial-cylinder-fit'});
  }
  return uniqueBy(result,x=>`${x.componentId}|${Math.round(x.radius*100)}|${Math.round(x.length*10)}`);
}

function detectChamfers(rec,groupAreas){
  const planes=rec?.recognition?.planes||[],byComp=new Map();for(const p of planes){const id=p.componentId||'RAW',a=byComp.get(id)||[];a.push(p);byComp.set(id,a)}
  const out=[];
  for(const [id,list] of byComp){
    const maxArea=Math.max(1,...list.map(x=>x.area||0));
    for(const p of list){
      if((p.area||0)>maxArea*.35)continue;
      const neighbors=list.filter(q=>q!==p&&(q.area||0)>(p.area||0)*1.5&&angleDeg(p.normal,q.normal)>20&&angleDeg(p.normal,q.normal)<72).sort((a,b)=>(b.area||0)-(a.area||0));
      if(neighbors.length<2||angleDeg(neighbors[0].normal,neighbors[1].normal)<40)continue;
      const ga=groupAreas.get(p.faceKey),sizes=(ga?.bounds?.size||[]).filter(v=>v>.03).sort((a,b)=>b-a);if(sizes.length<2)continue;
      const edgeLength=sizes[0],slantWidth=(p.area||0)/Math.max(edgeLength,EPS),leg=slantWidth/Math.SQRT2;
      if(!(leg>.05&&leg<Math.max(30,edgeLength*.3)))continue;
      out.push({componentId:id,kind:'chamfer',size:leg,angleDeg:45,faceKey:p.faceKey,confidence:clamp(.64+.18*Math.min(1,(neighbors[0].area||0)/Math.max(p.area,EPS)),0,1),source:'small-oblique-plane'});
    }
  }
  return uniqueBy(out,x=>`${x.componentId}|${Math.round(x.size*20)}|${x.faceKey}`);
}

function detectThreadCandidates(rec){
  const out=[];
  for(const g of rec?.recognition?.coaxialGroups||[]){
    const members=(g.members||[]).filter(x=>x.full&&x.length>0.2).sort((a,b)=>dot(a.axisPoint,g.axis)-dot(b.axisPoint,g.axis));
    if(members.length<4)continue;
    const ds=members.map(x=>x.diameter),spread=Math.max(...ds)-Math.min(...ds),avg=ds.reduce((s,x)=>s+x,0)/ds.length;if(spread>Math.max(.35,avg*.04))continue;
    const stations=members.map(x=>dot(x.axisPoint,g.axis)),diffs=[];for(let i=1;i<stations.length;i++){const d=stations[i]-stations[i-1];if(d>.05)diffs.push(d)}if(diffs.length<3)continue;
    const pitch=median(diffs),dev=Math.sqrt(diffs.reduce((s,x)=>s+(x-pitch)**2,0)/diffs.length);if(!(pitch>.1&&dev<Math.max(.08,pitch*.12)))continue;
    out.push({componentId:g.componentId,kind:'thread-candidate',diameter:avg,pitch,axis:g.axis,confidence:.58,source:'repeated-coaxial-rings',note:'Кандидат на моделированную резьбу; требует подтверждения точным B-Rep/feature history.'});
  }
  return out;
}

function detectRolledSheetCandidate(rec,id,bounds){
  const cyl=(rec?.recognition?.cylinders||[]).filter(x=>x.componentId===id&&x.full&&x.confidence>=.85);
  const outers=cyl.filter(x=>x.type==='outer'),inners=cyl.filter(x=>x.type==='hole');
  let best=null;
  for(const outer of outers)for(const inner of inners){
    const aa=Math.abs(dot(norm(outer.axis),norm(inner.axis)));if(aa<.998)continue;
    const radial=Math.abs((outer.radius||0)-(inner.radius||0));if(!(radial>.15&&radial<Math.max(25,(outer.radius||0)*.12)))continue;
    const axis=norm(outer.axis),delta=sub(outer.axisPoint,inner.axisPoint),off=len(sub(delta,mul(axis,dot(delta,axis))));if(off>Math.max(.25,radial*.25))continue;
    const width=Math.min(outer.length||0,inner.length||0);if(!(width>radial*1.5))continue;
    const ratio=Math.abs((outer.length||0)-(inner.length||0))/Math.max(width,EPS);if(ratio>.04)continue;
    const meanR=((outer.radius||0)+(inner.radius||0))/2,sweep=(outer.full&&inner.full)?Math.PI*2:Math.min(outer.coverageRad||0,inner.coverageRad||0);
    if(!(sweep>Math.PI*.35))continue;
    const flatLength=meanR*sweep,flatArea=flatLength*width,score=clamp(.91+.04*Math.min(1,sweep/(Math.PI*2))+.03*Math.min(1,(outer.confidence+inner.confidence)/2),0,1);
    const candidate={componentId:id,isSheetMetal:true,formType:'rolled',confidence:score,thickness:radial,bends:[{id:'R1',type:'roll',surfaceRadius:meanR,innerRadius:Math.min(outer.radius,inner.radius),outerRadius:Math.max(outer.radius,inner.radius),angleDeg:sweep*180/Math.PI,length:width,axis,axisPoint:outer.axisPoint,confidence:Math.min(outer.confidence,inner.confidence)}],bendCount:1,blank:{width,length:flatLength,area:flatArea,bendLines:[],method:'neutral-radius-cylinder-development',neutralRadius:meanR,sweepDeg:sweep*180/Math.PI},source:'coaxial outer/inner cylindrical shell',note:`Развёртка по нейтральному радиусу цилиндрической оболочки: S=${fmt(radial)} mm, Rср=${fmt(meanR)} mm, угол ${fmt(sweep*180/Math.PI)}°. Для полного кольца длина = 2πRср. Геометрия получена из FaceTessellations; перед производством проверьте припуск/стык и технологию гибки.`};
    if(!best||candidate.confidence>best.confidence)best=candidate;
  }
  return best;
}

function detectSheetMetal(rec,boundsMap,areaMap,fillets){
  const spacings=rec?.recognition?.planeSpacings||[],planes=rec?.recognition?.planes||[],components=new Map(),names=componentNameMap(rec);
  for(const [id,bounds] of boundsMap){
    const rolled=detectRolledSheetCandidate(rec,id,bounds);
    if(rolled){rolled.name=names.get(id)||id;components.set(id,rolled);continue}
    const maxDim=Math.max(...bounds.size,1),sorted=[...bounds.size].sort((a,b)=>a-b),localSp=spacings.filter(x=>x.componentId===id&&x.spacing>.15&&x.spacing<maxDim*.12),clusters=clusterNumbers(localSp.map(x=>x.spacing),.03,.08),best=clusters[0]||null;
    const flatThickness=sorted[0]<sorted[1]*.12?sorted[0]:null,thickness=best?.value||flatThickness;
    if(!(thickness>.15&&thickness<maxDim*.12))continue;
    const partialCyl=fillets.filter(x=>x.componentId===id&&x.radius>=thickness*.35&&x.radius<Math.max(80,maxDim*.2));
    const planeCount=planes.filter(x=>x.componentId===id&&x.area>thickness*thickness*6).length;
    const repeats=best?.values?.length||0;
    const flatness=flatThickness?1:0,score=clamp(.42+.13*Math.min(3,repeats)+.08*Math.min(4,partialCyl.length)+.05*Math.min(5,planeCount)+.12*flatness,0,1);
    if(score<.66)continue;
    const surfaceArea=areaMap.get(id)||0,blankArea=Math.max(0,surfaceArea/2),bendAxisLengths=partialCyl.map(x=>x.length).filter(x=>x>thickness*2),blankWidth=Math.max(thickness,median(bendAxisLengths)||sorted[1]||sorted[2]||1),blankLength=blankArea>0?blankArea/Math.max(blankWidth,EPS):Math.max(...bounds.size);
    const bends=partialCyl.map((x,i)=>({id:`B${i+1}`,type:'bend',surfaceRadius:x.radius,angleDeg:Math.min(180,Math.max(1,x.sweepDeg)),length:x.length,axis:x.axis,axisPoint:x.axisPoint,bendAllowance:(x.sweepDeg*Math.PI/180)*(Math.max(.01,x.radius-thickness*.5)+.4*thickness),confidence:x.confidence}));
    const bendLines=bends.map((b,i)=>({position:(i+1)/(bends.length+1),angleDeg:b.angleDeg,radius:Math.max(.01,b.surfaceRadius-thickness*.5)}));
    components.set(id,{componentId:id,name:names.get(id)||id,isSheetMetal:true,formType:bends.length?'folded':'flat',confidence:score,thickness,bends,bendCount:bends.length,blank:{width:blankWidth,length:blankLength,area:blankArea,bendLines,method:'mid-surface-area-alpha'},source:best?'repeated-parallel-plane-spacing + bend cylinders':'thin-envelope + bend cylinders',note:'Развёртка ALPHA: толщина и гибы распознаны по FaceTessellations. Для дискретных гибов габарит заготовки оценён по площади срединной поверхности; K-factor=0.4. Перед производством требуется проверка.'});
  }
  return components;
}

function inferManufacturingClass(rec,sheetMetalMap){
  const names=componentNameMap(rec),out=[];
  const ids=new Set([...(rec?.occurrences||[]).map(x=>x.id),...(rec?.recognition?.components||[]).map(x=>x.componentId)]);
  for(const id of ids){
    const sm=sheetMetalMap.get(id);if(sm){out.push({componentId:id,name:names.get(id)||id,class:'sheet-metal',confidence:sm.confidence});continue}
    const cyl=(rec?.recognition?.cylinders||[]).filter(x=>x.componentId===id),outer=cyl.filter(x=>x.type==='outer'&&x.full),holes=cyl.filter(x=>x.type==='hole');
    const elongated=outer.some(x=>x.length>x.diameter*2.5);
    out.push({componentId:id,name:names.get(id)||id,class:elongated?'turned/axial':holes.length>=3?'machined':'general',confidence:elongated ? .84 : holes.length>=3 ? .72 : .55});
  }
  return out;
}

export function recognizeManufacturingFeatures(rec){
  if(!rec?.geometryAvailable||!rec?.recognition)return{version:'2.0.0-alpha',holes:[],chamfers:[],fillets:[],threads:[],sheetMetal:{components:[],count:0},materials:resolveMaterials(rec),classes:[],counts:{holes:0,chamfers:0,fillets:0,threads:0,sheetMetal:0,bends:0}};
  const boundsMap=componentBounds(rec),areaMap=componentAreas(rec),groupAreas=faceGroupAreas(rec);
  const holes=classifyHoles(rec,boundsMap),fillets=detectFillets(rec),chamfers=detectChamfers(rec,groupAreas),threads=detectThreadCandidates(rec),sheetMetalMap=detectSheetMetal(rec,boundsMap,areaMap,fillets),classes=inferManufacturingClass(rec,sheetMetalMap),materials=resolveMaterials(rec);
  const sheetComponents=[...sheetMetalMap.values()],bends=sheetComponents.reduce((s,x)=>s+(x.bendCount||0),0);
  return{version:'2.0.0-alpha',kernel:'ROZFOOD Feature Recognition Core',source:'FaceTessellations + analytical fits',exactParasolid:false,holes,chamfers,fillets,threads,sheetMetal:{components:sheetComponents,count:sheetComponents.length},materials,classes,counts:{holes:holes.length,chamfers:chamfers.length,fillets:fillets.length,threads:threads.length,sheetMetal:sheetComponents.length,bends},note:'Feature Recognition Core v2.0 Alpha распознаёт производственные признаки консервативно. Отверстия/цилиндры основаны на аналитическом fit; фаски, скругления, резьба и развёртка пока являются TESS-кандидатами и требуют инженерной проверки до производства.'};
}

export function manufacturingDimensions(mfg,{limit=48}={}){
  const out=[],seen=new Set(),push=(d,k)=>{if(seen.has(k))return;seen.add(k);out.push(d)};
  for(const h of mfg?.holes||[]){push({type:h.holeKind==='through'?'Сквозное отверстие':h.holeKind==='blind'?'Глухое отверстие':'Ступенчатое отверстие',label:'Ø',value:h.diameter,unit:'mm',confidence:h.confidence,source:'FEATURE_HOLE',componentId:h.componentId,depth:h.depth,callout:h.callout},`H|${h.componentId}|${Math.round(h.diameter*100)}|${h.holeKind}`);if(out.length>=limit)return out}
  for(const c of mfg?.chamfers||[]){push({type:'Фаска · кандидат',label:`C${fmt(c.size)}×${Math.round(c.angleDeg)}°`,value:c.size,unit:'mm',confidence:c.confidence,source:'FEATURE_CHAMFER',componentId:c.componentId},`C|${c.componentId}|${Math.round(c.size*20)}`);if(out.length>=limit)return out}
  for(const f of mfg?.fillets||[]){push({type:'Скругление · кандидат',label:'R',value:f.radius,unit:'mm',confidence:f.confidence,source:'FEATURE_FILLET',componentId:f.componentId},`R|${f.componentId}|${Math.round(f.radius*100)}`);if(out.length>=limit)return out}
  for(const sm of mfg?.sheetMetal?.components||[]){push({type:'Листовой металл · толщина',label:'S',value:sm.thickness,unit:'mm',confidence:sm.confidence,source:'SHEET_METAL_THICKNESS',componentId:sm.componentId},`SM|${sm.componentId}|${Math.round(sm.thickness*100)}`);if(out.length>=limit)return out}
  return out;
}

function fmt(v){if(!Number.isFinite(v))return '—';return Number(v).toFixed(v>=10?2:3).replace(/0+$/,'').replace(/\.$/,'')}
