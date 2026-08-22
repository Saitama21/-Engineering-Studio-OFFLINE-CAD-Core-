import {WireframeViewer} from './viewer/wireframe-viewer.js';
import {drawingFromRecognition,renderDrawing,serializeDrawing,renderNativeAssemblyDrawing} from './drawing/drawing-engine.js';
import {renderTessRecognitionDrawing} from './drawing/tess-recognition-drawing.js';
import {renderAssemblyProductionSheet,renderComponentProductionSheet,assemblyDrawingProfile} from './drawing/assembly-production-sheet-v130.js';
import {DrawingEditor} from './drawing/drawing-editor.js';
import {DrawingNavigator} from './drawing/drawing-navigator.js';

const APP_VERSION='1.4.2';
const BUILD_LABEL='LOCAL DRAWING RENDER + FOCUS ZOOM';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const viewer=new WireframeViewer($('#viewerCanvas'));
viewer.onSelect=(id,instance)=>{
  state.selectedComponentId=id||null;
  state.selectedComponentName=instance?.name||'';
  const el=$('#selectionInfo');
  if(el)el.textContent=id?`выбрано: ${instance?.name||'компонент'}`:'клик по детали — выбрать';
  updateDrawingModeAvailability();
  if(state.rec){
    renderDimensions();
    if(state.drawingMode==='partDetail'){renderCurrentDrawing();scheduleDrawingFit();}
  }
};
const worker=new Worker('./import-worker.js',{type:'module'});
let state={fileName:null,fileSize:0,rec:null,dimensions:[],types:[],parseMs:0,drawingMode:'production',selectedComponentId:null,selectedComponentName:''};
let drawingEditMode=false,drawingTool='edit';
const drawingRenderCache=new Map();
const drawingEditor=new DrawingEditor($('#drawingSvg'),{onSelectionChange:updateEditorSelection,onStateChange:updateEditorState});
const drawingNavigator=new DrawingNavigator($('#drawingView'),$('#drawingSvg'));

const THEME_KEY='engineering-studio-theme';
function applyTheme(theme,{persist=true}={}){
  const next=theme==='dark'?'dark':'light';
  document.documentElement.dataset.theme=next;
  document.documentElement.style.colorScheme=next;
  const meta=document.querySelector('meta[name="theme-color"]');
  if(meta)meta.content=next==='dark'?'#090f19':'#ffffff';
  const btn=$('#themeToggle');
  if(btn){btn.textContent=next==='dark'?'☾':'☀︎';btn.title=`Тема: ${next==='dark'?'тёмная':'светлая'}`;btn.setAttribute('aria-label',next==='dark'?'Включить светлую тему':'Включить тёмную тему');}
  if(persist)try{localStorage.setItem(THEME_KEY,next)}catch{}
  if(typeof viewer!=='undefined')viewer.draw();
  if(state?.rec)renderCurrentDrawing();
}
function initTheme(){let saved='light';try{saved=localStorage.getItem(THEME_KEY)||'light'}catch{}applyTheme(saved,{persist:false})}

function log(msg){const p=document.createElement('p');const t=document.createElement('time');t.textContent=new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit',second:'2-digit'});p.append(t,' '+msg);$('#logBody').prepend(p)}
function fmt(n,d=3){return Number.isFinite(n)?n.toFixed(d):'—'}
function setBusy(on){$('#fileInput').disabled=on;$('#offlineStatus').textContent=on?'Разбираю файл…':'Оффлайн ядро';document.body.classList.toggle('busy',on)}

async function importFile(file){
  const fileName=file.name,fileSize=file.size,ext=(fileName.split('.').pop()||'').toLowerCase();
  if(ext!=='sldasm'){alert('Эта сборка ROZFOOD ENGINEERING STUDIO принимает только файлы .SLDASM.');return}
  setBusy(true);state.fileName=fileName;state.fileSize=fileSize;state.importKind='sldasm';
  $('#projectName').textContent=fileName.replace(/\.[^.]+$/,'');
  $('#fileMeta').textContent=`${fileName} · ${(fileSize/1024).toFixed(1)} KB · локально`;
  const buffer=await file.arrayBuffer();
  log(`Импорт ${fileName}: SLDASM Drawing Intelligence decoder · ${(fileSize/1024).toFixed(1)} KB.`);
  worker.postMessage({kind:'sldasm',buffer,fileName},[buffer]);
}


worker.onmessage=e=>{
  setBusy(false);if(!e.data.ok){const where=e.data.stage?` [${e.data.stage}]`:'';log('Ошибка'+where+': '+e.data.error);console.error('SLDASM worker error',e.data);alert(`Ошибка импорта${where}: ${e.data.error}`);return}
  Object.assign(state,e.data);drawingRenderCache.clear();renderAll();
  const n=state.rec.nativeAssembly;
  if(n?.root)$('#projectName').textContent=n.root;
  const geo=state.rec.geometryAvailable!==false;
  log(`SLDASM готов: ${n.componentCount} позиций · ${n.occurrenceCount} вхождений · ${n.faceBlocks||0} tess-блоков · ${n.triangles||0} треугольников. Распознано: ${state.rec.recognition?.counts?.planes||0} плоскостей · ${state.rec.recognition?.counts?.cylinders||0} цилиндров · ${state.rec.recognition?.counts?.holes||0} отверстий · ${state.rec.recognition?.counts?.holePatterns||0} групп отверстий/PCD. Интернет не использовался.`);
  switchTab(geo?'model':'assembly');
};

function setEmptyView(title,text){const root=$('#emptyView');root.querySelector('b').textContent=title;root.querySelector('span').textContent=text;root.style.display='grid'}
function renderAll(){
  const r=state.rec,d=state.dimensions||[],geo=r.geometryAvailable!==false;
  if(geo){viewer.setModel(r);$('#emptyView').style.display='none'}else{viewer.clear();setEmptyView('SLDASM сборка прочитана',`${r.nativeAssembly?.componentCount||0} позиций · BOM доступен во вкладке «Сборка». В этом файле не найдена декодируемая встроенная FaceTessellations-геометрия.`)}
  $('#exportBtn').disabled=false;
  $('#entityCount').textContent=geo?`${r.counts.tessFaceBlocks||0} tess faces`:`${r.nativeAssembly?.componentCount||0} компонентов`;
  $('#sx').textContent=geo?fmt(r.bounds.size[0])+' mm':'—';$('#sy').textContent=geo?fmt(r.bounds.size[1])+' mm':'—';$('#sz').textContent=geo?fmt(r.bounds.size[2])+' mm':'—';
  $('#solidCount').textContent=geo?'TESS':'—';$('#faceCount').textContent=geo?(r.counts.triangles??r.counts.sceneFaces??r.counts.faces):'—';$('#edgeCount').textContent=geo?(r.counts.sceneEdges??r.counts.edges):'—';
  $('#unitLabel').textContent=geo?r.unit:'—';$('#unitFactor').textContent=geo?fmt(r.factor):'—';$('#cylinderCount').textContent=geo?(r.recognition?.counts?.cylinders??0):'—';$('#bsplineCount').textContent=geo?(r.recognition?.counts?.holes??0):'—';const pc=$('#patternCount'),cc=$('#coaxialCount');if(pc)pc.textContent=geo?(r.recognition?.counts?.holePatterns??0):'—';if(cc)cc.textContent=geo?(r.recognition?.counts?.coaxialGroups??0):'—';
  const conf=r.recognition?Math.round((r.recognition.confidence||0)*100):(d.length?Math.round(d.reduce((s,x)=>s+x.confidence,0)/d.length*100):0);const vr=r.recognition?.verification?.ratio;$('#confidence').textContent=geo?(Number.isFinite(vr)?`${Math.round(vr*100)}% VERIFIED`:(conf+'% TESS')):'META';
  if(geo)$('#selectionInfo').textContent=`Verified geometry · ${r.recognition?.counts?.verifiedCylinders||0} цилиндр. · ${r.recognition?.counts?.verifiedPlanes||0} плоск.`;renderTree();renderFeatures();renderDimensions();renderAssembly();updateDrawingModeAvailability();renderCurrentDrawing();$('#exportDrawingBtn').disabled=!r;
}

function drawingCacheKey(){
  return [APP_VERSION,state.fileName||'untitled',state.fileSize||0,state.drawingMode,state.drawingMode==='partDetail'?(state.selectedComponentId||'part'):'sheet',document.documentElement.dataset.theme||'light'].join('|');
}
function finalizeCachedDrawing(cacheKey){
  const svg=$('#drawingSvg');
  drawingRenderCache.set(cacheKey,{viewBox:svg.getAttribute('viewBox')||'0 0 1200 760',html:svg.innerHTML});
  finalizeDrawingRender();
}
function renderCurrentDrawing(){
  if(!state.rec)return;
  const r=state.rec,n=r.nativeAssembly,svg=$('#drawingSvg'),cacheKey=drawingCacheKey(),cached=drawingRenderCache.get(cacheKey);
  if(cached){
    svg.setAttribute('viewBox',cached.viewBox);svg.innerHTML=cached.html;finalizeDrawingRender();return;
  }
  if(state.drawingMode==='assemblyDetailed'){
    const projectName=$('#projectName')?.textContent||state.fileName?.replace(/\.[^.]+$/,'')||n?.root||'SLDASM';
    if(r.tessellation?.mode==='triangle-strips'&&r.recognition) renderAssemblyProductionSheet(svg,r,{projectName,fileName:state.fileName,theme:document.documentElement.dataset.theme,mode:'assemblyDetailed'});
    else renderNativeAssemblyDrawing(svg,n,{projectName,fileName:state.fileName,theme:document.documentElement.dataset.theme});
    finalizeCachedDrawing(cacheKey);return;
  }
  if(state.drawingMode==='partDetail'){
    renderComponentProductionSheet(svg,r,{componentId:state.selectedComponentId,componentName:state.selectedComponentName||'Выбранная деталь',fileName:state.fileName,theme:document.documentElement.dataset.theme});
    finalizeCachedDrawing(cacheKey);return;
  }
  if(r.tessellation?.mode==='triangle-strips'&&r.recognition){
    const projectName=$('#projectName')?.textContent||state.fileName?.replace(/\.[^.]+$/,'')||n?.root||'SLDASM';
    const profile=assemblyDrawingProfile(r);
    r.drawingProfile=profile.profile;
    r.drawingProfileConfidence=profile.confidence;
    if(profile.profile==='GENERAL'){
      renderAssemblyProductionSheet(svg,r,{projectName,fileName:state.fileName,theme:document.documentElement.dataset.theme,mode:state.drawingMode});
    }else{
      renderTessRecognitionDrawing(svg,r,{projectName,fileName:state.fileName,theme:document.documentElement.dataset.theme,mode:state.drawingMode});
    }
    finalizeCachedDrawing(cacheKey);return;
  }
  svg.setAttribute('viewBox','0 0 1200 760');svg.innerHTML=`<rect width="1200" height="760" fill="${document.documentElement.dataset.theme==='dark'?'#0d1522':'#fff'}"/><g font-family="-apple-system,BlinkMacSystemFont,system-ui" text-anchor="middle"><text x="600" y="285" font-size="36" font-weight="700" fill="${document.documentElement.dataset.theme==='dark'?'#f4f7fb':'#17202b'}">SLDASM: структура сборки импортирована</text><text x="600" y="340" font-size="22" fill="#6e7781">${esc(n?.componentCount||0)} позиций · ${esc(n?.occurrenceCount||0)} вхождений</text><text x="600" y="400" font-size="18" fill="#6e7781">Встроенная FaceTessellations-геометрия в этом файле не найдена.</text></g>`;
  finalizeCachedDrawing(cacheKey);
}

function drawingEditorKey(){return [state.fileName||'untitled',state.fileSize||0,state.drawingMode,state.drawingMode==='partDetail'?(state.selectedComponentId||'part'):'sheet'].join('|')}
function finalizeDrawingRender(){drawingNavigator.captureBase({reset:true});drawingEditor.setKey(drawingEditorKey());drawingEditor.refresh()}
function updateEditorSelection(info){
  const sel=$('#editorSelection'),txt=$('#editorText'),tp=$('#editorTolPlus'),tm=$('#editorTolMinus');
  if(!sel)return;
  if(!info){
    if(!drawingEditMode)sel.textContent='Нажмите «Правка», чтобы открыть инструменты.';
    else if(drawingTool!=='edit')sel.textContent=`Активен инструмент «${drawingTool==='zoom'?'Зум':'Панорама'}». Для изменения элементов выберите «Редактировать».`;
    else sel.textContent='Выберите размер, надпись или обозначение на листе.';
    if(txt)txt.value='';if(tp)tp.value='';if(tm)tm.value='';return;
  }
  sel.textContent=`Выбрано: ${info.kind==='element'?'элемент чертежа':info.kind}${info.hidden?' · скрыт':''}`;
  if(txt)txt.value=info.text||'';if(tp)tp.value=info.tolPlus||'';if(tm)tm.value=info.tolMinus||'';
}
function updateEditorState(st){
  const status=$('#editorStatus'),edit=$('#editDrawingBtn'),undo=$('#undoDrawingBtn'),redo=$('#redoDrawingBtn');
  if(status)status.textContent=drawingEditMode?`${drawingTool==='edit'?'редактирование':drawingTool==='zoom'?'зум':'панорама'} · ${st.editCount}`:'выкл';
  if(edit)edit.classList.toggle('active',drawingEditMode);
  if(undo)undo.disabled=!st.canUndo;if(redo)redo.disabled=!st.canRedo;
}
function syncDrawingEditUI(){
  const palette=$('#drawingToolPalette'),card=$('#drawingEditorCard'),drawingActive=$('#drawingView')?.classList.contains('active-view');
  palette?.classList.toggle('hidden',!drawingEditMode);
  $$('[data-drawing-tool]').forEach(b=>b.classList.toggle('active',b.dataset.drawingTool===drawingTool));
  if(card)card.classList.toggle('hidden',!(drawingActive&&drawingEditMode&&drawingTool==='edit'));
  $('#drawingSvg')?.classList.toggle('drawing-editor-enabled',drawingEditMode&&drawingTool==='edit');
  document.querySelector('.right')?.classList.toggle('editor-active',drawingActive&&drawingEditMode&&drawingTool==='edit');
}
function setDrawingTool(tool,{silent=false}={}){
  if(!['edit','zoom','pan'].includes(tool))tool='edit';
  drawingTool=tool;drawingNavigator.setTool(tool);
  drawingEditor.setEnabled(drawingEditMode&&tool==='edit');
  syncDrawingEditUI();updateEditorSelection(drawingEditor.selectionInfo?.()||null);
  if(!silent&&drawingEditMode)log(`Правка: инструмент «${tool==='edit'?'Редактировать':tool==='zoom'?'Зум':'Панорама'}».`);
}
function setDrawingEditorEnabled(on){
  drawingEditMode=!!on;drawingNavigator.setEnabled(drawingEditMode);
  if(drawingEditMode)setDrawingTool(drawingTool||'edit',{silent:true});
  else{drawingEditor.setEnabled(false);syncDrawingEditUI();updateEditorSelection(null)}
  log(drawingEditMode?'Панель правки включена: отдельно доступны «Редактировать», «Зум» и «Панорама». Колесо — зум к курсору.':'Режим ручной правки чертежа выключен.');
}

function updateDrawingModeAvailability(){
  if(!state.rec)return;
  const assemblyBtn=document.querySelector('[data-drawing-mode="assemblyDetailed"]');
  if(assemblyBtn){const available=!!state.rec.isAssembly;assemblyBtn.disabled=!available;assemblyBtn.title=available?'Сборочный производственный лист: виды, A–A/B–B, C/D, позиции, BOM и штамп':'Доступно после загрузки SLDASM сборки';if(!available&&state.drawingMode==='assemblyDetailed'){state.drawingMode='production';}}
  const partBtn=document.querySelector('[data-drawing-mode="partDetail"]');
  if(partBtn){const available=!!state.selectedComponentId;partBtn.disabled=!available;partBtn.title=available?`Чертёж выбранной детали: ${state.selectedComponentName||state.selectedComponentId}`:'Сначала выберите деталь в 3D или дереве сборки';if(!available&&state.drawingMode==='partDetail'){state.drawingMode='production';}}
  $$('[data-drawing-mode]').forEach(x=>x.classList.toggle('active',x.dataset.drawingMode===state.drawingMode));
}

function renderTree(){
  const r=state.rec,n=r.nativeAssembly;
  const rows=[['Файл',state.fileName],['Формат','SLDASM'],['Адаптер','Drawing Intelligence v1.4.2'],['Контейнер',n.container],['Streams',n.streamCount||0],['Позиций',n.componentCount],['Вхождений',n.occurrenceCount],['Tess-блоков',n.faceBlocks||0],['Исходных треуг.',n.sourceTriangles||0],['Сценовых треуг.',n.triangles||0],...(r.counts.displayTriangles&&r.counts.displayTriangles!==r.counts.triangles?[['3D LOD',r.counts.displayTriangles],['Передача','Stack-safe']]:[]),['Размещено',n.mappedOccurrences||0]];
  $('#treeBody').classList.remove('empty');
  $('#treeBody').innerHTML=rows.map(([a,b])=>`<div class="tree-row"><b>${esc(a)}</b><span>${esc(b)}</span></div>`).join('');
}


function renderFeatures(){
  const r=state.rec,n=r.nativeAssembly,geo=r.geometryAvailable!==false;
  $('#featureList').classList.remove('empty');
  const G=r.recognition;
  const V=G?.verification;
  $('#featureList').innerHTML=`<div class="feature"><i>☷</i><div>SLDASM component tree<small>${esc(n?.componentCount||0)} позиций · ${esc(n?.occurrenceCount||0)} вхождений</small></div><strong>OK</strong></div><div class="feature"><i>△</i><div>3D FaceTessellations + transforms<small>${geo?`${esc(n?.mappedOccurrences||0)} вхождений · ${esc(n?.triangles||0)} треугольников`:'встроенная тесселяция не найдена'}</small></div><strong>${geo?'OK':'—'}</strong></div><div class="feature"><i>◉</i><div>Precision TESS Recognition<small>${G?`${esc(G.counts.planes)} плоск. · ${esc(G.counts.cylinders)} цилиндр. · ${esc(G.counts.holes)} отверст.`:'ожидает 3D mesh'}</small></div><strong>${G?'OK':'—'}</strong></div><div class="feature verified-feature"><i>✓</i><div>Verified analytical geometry<small>${V?`${esc(V.counts.planes)} плоск. · ${esc(V.counts.cylinders)} цилиндр. · ${esc(V.counts.holes)} отверст. подтверждены fit-критериями`:'ожидает распознавание'}</small></div><strong>${V?'OK':'—'}</strong></div><div class="feature"><i>⌾</i><div>Patterns / PCD / coaxial<small>${G?`${esc(G.counts.holePatterns||0)} групп отверстий · ${esc(G.counts.coaxialGroups||0)} соосных ступеней`:'ожидает распознавание'}</small></div><strong>${G?'OK':'—'}</strong></div><div class="feature"><i>▱</i><div>Drawing Intelligence<small>${G?`${assemblyDrawingProfile(r).profile} · безопасный выбор главного вида · контекст детали/сборки`:'ожидает распознавание геометрии'}</small></div><strong>${G?'OK':'—'}</strong></div><div class="feature editor-feature"><i>✎</i><div>Drawing Editor<small>${G?'перемещение · скрытие · текст · допуски · Ra · сварные обозначения · undo/redo':'ожидает чертёж'}</small></div><strong>${G?'OK':'—'}</strong></div><div class="feature"><i>◎</i><div>Native Parasolid B-Rep<small>Нативная Parasolid topology пока не декодируется. VERIFIED означает подтверждённую аналитику по FaceTessellations, а не исходный B-Rep.</small></div><strong>—</strong></div>`;}


function componentBounds(componentId){
  if(!state.rec||!componentId)return null;
  const mn=[Infinity,Infinity,Infinity],mx=[-Infinity,-Infinity,-Infinity];let n=0;
  for(const f of state.rec.faces||[]){
    if(f.componentId!==componentId)continue;
    for(const loop of f.loops||[])for(const p of loop||[]){for(let i=0;i<3;i++){mn[i]=Math.min(mn[i],p[i]);mx[i]=Math.max(mx[i],p[i])}n++;}
  }
  if(!n)return null;
  return{min:mn,max:mx,size:[mx[0]-mn[0],mx[1]-mn[1],mx[2]-mn[2]],center:[(mx[0]+mn[0])/2,(mx[1]+mn[1])/2,(mx[2]+mn[2])/2]};
}
function componentDimensions(componentId){
  const r=state.rec,R=r?.recognition;if(!r||!R||!componentId)return[];
  const out=[],seen=new Set(),push=(x,key)=>{if(seen.has(key))return;seen.add(key);out.push(x)};
  const b=componentBounds(componentId);
  if(b){['X','Y','Z'].forEach((a,i)=>push({type:`Габарит ${a}`,label:a,value:b.size[i],unit:'mm',confidence:1,source:'COMPONENT_BOUNDS',componentId},`B:${a}`));}
  for(const p of R.holePatterns||[]){if(p.componentId!==componentId)continue;push({type:p.pcd?'Группа отверстий · PCD':'Группа отверстий',label:`${p.count}×Ø`,value:p.diameter,unit:'mm',confidence:p.confidence,source:p.verified?'VERIFIED_HOLE_PATTERN':'TESS_HOLE_PATTERN',count:p.count,pcd:p.pcd,componentId},`HP:${p.count}:${p.diameter.toFixed(2)}:${p.pcd?Math.round(p.pcd*10):0}`);if(p.pcd)push({type:'Делительная окружность',label:'PCD Ø',value:p.pcd,unit:'mm',confidence:p.confidence,source:p.verified?'VERIFIED_PCD':'TESS_PCD',count:p.count,componentId},`PCD:${Math.round(p.pcd*10)}`)}
  for(const c of R.cylinders||[]){if(c.componentId!==componentId)continue;const dk=Math.round(c.diameter*100)/100,lk=Math.round(c.length*100)/100;push({type:c.type==='hole'?'Отверстие':'Цилиндр',label:'Ø',value:c.diameter,unit:'mm',confidence:c.confidence,source:c.verified?'VERIFIED_CYLINDER':'TESS_CYLINDER',componentId},`D:${c.type}:${dk}`);if(c.length>1)push({type:'Длина цилиндра',label:'L',value:c.length,unit:'mm',confidence:Math.max(.65,c.confidence-.05),source:c.verified?'VERIFIED_CYLINDER_LENGTH':'TESS_CYLINDER_LENGTH',componentId},`L:${lk}`);if(out.length>30)break}
  for(const p of R.planeSpacings||[]){if(p.componentId!==componentId)continue;push({type:'Расстояние плоскостей',label:'L',value:p.spacing,unit:'mm',confidence:p.confidence,source:p.verified?'VERIFIED_PLANE_SPACING':'TESS_PLANE_SPACING',componentId},`PS:${Math.round(p.spacing*10)}`);if(out.length>34)break}
  return out.slice(0,36);
}
function contextualDimensions(){
  if(state.drawingMode==='partDetail'&&state.selectedComponentId)return componentDimensions(state.selectedComponentId);
  return state.dimensions||[];
}
function dimensionSymbol(x){
  const label=String(x?.label||'');
  if(label.startsWith('Ø')||['TESS_CYLINDER','VERIFIED_CYLINDER','TESS_PCD','VERIFIED_PCD'].includes(x?.source))return ['TESS_PCD','VERIFIED_PCD'].includes(x?.source)?'PCD Ø':'Ø';
  if(['TESS_HOLE_PATTERN','VERIFIED_HOLE_PATTERN'].includes(x?.source))return `${x.count||''}×Ø`;
  if(label.startsWith('L')||['TESS_CYLINDER_LENGTH','VERIFIED_CYLINDER_LENGTH','TESS_PLANE_SPACING','VERIFIED_PLANE_SPACING'].includes(x?.source))return 'L';
  return ['X','Y','Z'].includes(label)?label:'';
}
function dimensionSourceLabel(x){const verified=String(x?.source||'').startsWith('VERIFIED_');const prefix=verified?'проверено':'распознано';return ['TESS_CYLINDER','VERIFIED_CYLINDER'].includes(x.source)?`${prefix}: цилиндр`:['TESS_CYLINDER_LENGTH','VERIFIED_CYLINDER_LENGTH'].includes(x.source)?`${prefix}: длина`:['TESS_HOLE_PATTERN','VERIFIED_HOLE_PATTERN'].includes(x.source)?(x.pcd?`${prefix}: группа отверстий · PCD Ø${fmt(x.pcd,2)}`:`${prefix}: повторяющиеся отверстия`):['TESS_PCD','VERIFIED_PCD'].includes(x.source)?`${prefix}: делительная окружность`:['TESS_PLANE_SPACING','VERIFIED_PLANE_SPACING'].includes(x.source)?`${prefix}: параллельные плоскости`:x.source==='COMPONENT_BOUNDS'?'габарит выбранной детали':'габарит TESS'}
function renderDimensions(){
  const r=state.rec,d=contextualDimensions();
  if(r.geometryAvailable!==false&&d.length){
    $('#dimensionCards').classList.remove('empty');
    $('#dimensionCards').innerHTML=d.map(x=>{const sym=dimensionSymbol(x),value=`${sym?`${sym} `:''}${fmt(x.value)} ${esc(x.unit||'mm')}`;return `<div class="dim-card"><span>${esc(x.type||x.label)}</span><b>${value}</b><small>${esc(dimensionSourceLabel(x))}</small></div>`}).join('');
    $('#dimensionsTable').innerHTML=d.map(x=>{const sym=dimensionSymbol(x);return `<tr><td>${esc(x.type)}</td><td>${esc(sym||x.label)}</td><td>${fmt(x.value)} ${esc(x.unit||'mm')}</td><td>${Math.round((x.confidence||0)*100)}% · ${esc(x.source||'TESS')}</td></tr>`}).join('');
  }else{
    $('#dimensionCards').classList.add('empty');$('#dimensionCards').textContent='Встроенная геометрия не найдена — габариты недоступны.';
    $('#dimensionsTable').innerHTML='<tr><td colspan="4">v1.4.2 сохраняет VERIFIED-геометрию и добавляет ручную доводку листа: перемещение, скрытие, допуски и технические обозначения. Нативный Parasolid B-Rep пока не декодируется.</td></tr>';
  }
}


function renderAssembly(){
  const r=state.rec,root=$('#assemblyBody'),n=r.nativeAssembly,components=n.components||[],geo=r.geometryAvailable!==false;
  root.innerHTML=`<div class="assembly-head"><div><h3>${esc(n.root)} · SLDASM</h3><p class="hint">Drawing Intelligence v1.4.2 · ${esc(n.container)} · полностью локально</p></div><span class="adapter-badge">SLDASM</span></div><div class="assembly-grid"><section><h4>Дерево компонентов</h4><ul class="component-tree"><li><b>▾ ${esc(n.root)}</b><ul>${components.map(c=>`<li ${c.instances?.[0]?`data-component-id="${esc(c.instances[0])}" data-component-name="${esc(c.name)}" class="selectable-component"`:''}><span>${c.type==='assembly'?'▣':'◫'} ${esc(c.name)}</span><em>×${c.count}</em><small>${esc(c.file)}</small></li>`).join('')||'<li class="muted">Компоненты не извлечены из этого контейнера</li>'}</ul></li></ul></section><section><h4>BOM · ${components.length} позиций</h4><div class="bom bom-wide"><div class="head">№</div><div class="head">Компонент</div><div class="head">Кол-во</div>${components.map((c,i)=>`<div>${i+1}</div><div><b>${esc(c.name)}</b><small>${esc(c.file)} · ${c.type==='assembly'?'подсборка':'деталь'}</small></div><div>${c.count}</div>`).join('')}</div></section></div><div class="assembly-actions"><button data-open-assembly-drawing>Открыть производственный сборочный чертёж</button><button data-open-part-drawing ${state.selectedComponentId?'':'disabled'}>Чертёж выбранной детали</button></div><div class="native-note"><b>v1.4.2:</b> структура/BOM читаются из нативных потоков SLDASM. <b>3D:</b> ${geo?`собрано из FaceTessellations с матрицами вхождений (${esc(n.mappedOccurrences||0)} размещено / ${esc(n.triangles||0)} треугольников сцены).`:'встроенная тесселяция в файле не найдена.'} Verified Geometry подтверждает аналитические плоскости/цилиндры по fit-критериям, а Drawing Intelligence безопасно выбирает GENERAL/AXIAL и даёт контекстные размеры выбранной детали; редактор позволяет вручную довести проекции, размеры, позиции, допуски и обозначения. Нативный Parasolid B-Rep пока не декодируется.</div>`;
}



$('#assemblyBody').addEventListener('click',e=>{const comp=e.target.closest('[data-component-id]');if(comp){viewer.setSelectedComponent(comp.dataset.componentId);state.selectedComponentId=comp.dataset.componentId;state.selectedComponentName=comp.dataset.componentName||comp.querySelector('span')?.textContent?.replace(/^[◫▣]\s*/,'')||'компонент';updateDrawingModeAvailability();renderDimensions();switchTab('model');$('#selectionInfo').textContent=`выбрано: ${state.selectedComponentName}`;log('Выбран компонент 3D: '+state.selectedComponentName+'.');return;}const part=e.target.closest('[data-open-part-drawing]');if(part){if(!state.selectedComponentId)return;state.drawingMode='partDetail';updateDrawingModeAvailability();switchTab('drawing');renderCurrentDrawing();log('Открыт чертёж выбранной детали.');return;}const btn=e.target.closest('[data-open-assembly-drawing]');if(!btn)return;state.drawingMode='assemblyDetailed';updateDrawingModeAvailability();switchTab('drawing');renderCurrentDrawing();log('Открыт производственный сборочный чертёж.');});

function fitDrawingSheet(){const ws=$('#drawingView'),svg=$('#drawingSvg');if(!ws||!svg)return;svg.classList.add('fit-sheet');drawingNavigator.fit();requestAnimationFrame(()=>{ws.scrollTop=0;ws.scrollLeft=Math.max(0,(ws.scrollWidth-ws.clientWidth)/2);});}
function scheduleDrawingFit(){requestAnimationFrame(()=>fitDrawingSheet());}
function switchTab(name){$$('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));$$('.view').forEach(v=>v.classList.remove('active-view'));$(`#${name}View`).classList.add('active-view');$('#viewTitle').textContent={model:'3D модель',drawing:'Инженерный авточертёж',dimensions:'Распознанные размеры',assembly:'Состав сборки'}[name];$('#modelActions').classList.toggle('hidden',name!=='model');$('#drawingActions').classList.toggle('hidden',name!=='drawing');if(name!=='drawing'&&drawingEditMode)setDrawingEditorEnabled(false);syncDrawingEditUI();if(name==='model')viewer.draw();if(name==='drawing'&&state.rec){renderCurrentDrawing();scheduleDrawingFit();syncDrawingEditUI()}}
$$('.tab').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));
$$('[data-drawing-mode]').forEach(b=>b.addEventListener('click',()=>{state.drawingMode=b.dataset.drawingMode;$$('[data-drawing-mode]').forEach(x=>x.classList.toggle('active',x===b));if(state.rec){renderDimensions();renderCurrentDrawing();scheduleDrawingFit()}log(`Режим чертежа: ${b.textContent}.`)}));
$('#themeToggle').addEventListener('click',()=>applyTheme(document.documentElement.dataset.theme==='dark'?'light':'dark'));
$('#fitBtn').addEventListener('click',()=>viewer.fit());$('#solidBtn').addEventListener('click',()=>{viewer.setMode('solid');$('#solidBtn').classList.add('active');$('#wireBtn').classList.remove('active');});$('#wireBtn').addEventListener('click',()=>{viewer.setMode('wire');$('#wireBtn').classList.add('active');$('#solidBtn').classList.remove('active');});$('#clearLog').addEventListener('click',()=>$('#logBody').innerHTML='');const fitDrawingBtn=$('#fitDrawingBtn');if(fitDrawingBtn)fitDrawingBtn.addEventListener('click',fitDrawingSheet);
$('#fileInput').addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;await importFile(f);e.target.value=''})
const drop=$('#dropZone');['dragenter','dragover'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('drag')}));['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove('drag')}));drop.addEventListener('drop',async e=>{const f=e.dataTransfer.files[0];if(f)await importFile(f)});

const editDrawingBtn=$('#editDrawingBtn');if(editDrawingBtn)editDrawingBtn.addEventListener('click',()=>setDrawingEditorEnabled(!drawingEditMode));
$$('[data-drawing-tool]').forEach(b=>b.addEventListener('click',()=>setDrawingTool(b.dataset.drawingTool)));
$('#undoDrawingBtn')?.addEventListener('click',()=>drawingEditor.undo());$('#redoDrawingBtn')?.addEventListener('click',()=>drawingEditor.redo());
$('#applyEditorText')?.addEventListener('click',()=>drawingEditor.setSelectedText($('#editorText')?.value||''));
$('#applyEditorTolerance')?.addEventListener('click',()=>drawingEditor.setTolerance($('#editorTolPlus')?.value||'',$('#editorTolMinus')?.value||''));
$('#toggleEditorVisibility')?.addEventListener('click',()=>drawingEditor.toggleVisibility());
$('#resetEditorSelected')?.addEventListener('click',()=>drawingEditor.resetSelected());
$('#addEditorNote')?.addEventListener('click',()=>drawingEditor.addNote('Примечание'));
$('#addEditorRoughness')?.addEventListener('click',()=>drawingEditor.addRoughness('Ra 3.2'));
$('#addEditorWeld')?.addEventListener('click',()=>drawingEditor.addWeld('Сварной шов'));
$('#resetDrawingEdits')?.addEventListener('click',()=>{if(confirm('Сбросить все ручные правки текущего чертежа?'))drawingEditor.resetAll()});

$('#exportBtn').addEventListener('click',()=>{if(!state.rec)return;const report={version:APP_VERSION,generated:new Date().toISOString(),file:state.fileName,drawingMode:state.drawingMode,counts:state.rec.counts,bounds:state.rec.bounds,dimensions:state.dimensions,boltPatterns:state.rec.boltPatterns,products:state.rec.products,occurrences:state.rec.occurrences,nativeAssembly:state.rec.nativeAssembly||null,recognition:state.rec.recognition||null};const blob=new Blob([JSON.stringify(report,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=(state.fileName||'model').replace(/\.[^.]+$/,'')+'-engineering-report.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)});
$('#exportDrawingBtn').addEventListener('click',()=>{if(!state.rec)return;renderCurrentDrawing();const svg=serializeDrawing($('#drawingSvg'));const blob=new Blob([svg],{type:'image/svg+xml;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=(state.fileName||'model').replace(/\.[^.]+$/,'')+'-drawing-'+state.drawingMode+'.svg';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);log('Чертёж экспортирован в SVG локально.');});
function esc(x){return String(x??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
initTheme();
if('serviceWorker'in navigator)navigator.serviceWorker.register(`./sw.js?v=${APP_VERSION}`,{updateViaCache:'none'}).then(reg=>{reg.update().catch(()=>{});log(`Service Worker v${APP_VERSION} активен: приложение готово к офлайн-кэшу.`)}).catch(e=>log('Service Worker: '+e.message));
log(`Build ${APP_VERSION} · ${BUILD_LABEL} готов.`);
window.addEventListener('online',()=>$('#offlineStatus').textContent='Онлайн (ядро всё равно локальное)');window.addEventListener('offline',()=>$('#offlineStatus').textContent='Оффлайн ядро');
