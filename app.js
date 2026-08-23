import {WireframeViewer} from './viewer/wireframe-viewer.js';
import {drawingFromRecognition,renderDrawing,serializeDrawing,renderNativeAssemblyDrawing} from './drawing/drawing-engine.js';
import {renderTessRecognitionDrawing} from './drawing/tess-recognition-drawing.js';
import {renderAssemblyProductionSheet,renderComponentProductionSheet,assemblyDrawingProfile} from './drawing/assembly-production-sheet-v130.js';
import {DrawingEditor} from './drawing/drawing-editor.js';
import {DrawingNavigator} from './drawing/drawing-navigator.js';
import {recognizeTessellationGeometry} from './core/tess-recognition.js';
import {componentLocalRecord,componentDrawableIds} from './core/component-local.js';
import {buildFeatureGraph} from './core/feature-graph.js';
import {parseSLDDRW} from './import/slddrw-adapter.js';
import {renderFlatPattern} from './drawing/flat-pattern.js';

const APP_VERSION='2.4.0';
const BUILD_LABEL='CAD EDGE GRAPH RECONSTRUCTION';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const viewer=new WireframeViewer($('#viewerCanvas'));
viewer.onSelect=(id,instance)=>{
  state.selectedComponentId=id||null;
  state.selectedComponentName=instance?.name||'';
  const el=$('#selectionInfo');
  if(el){const stats=id?selectionTopology(id):null;el.textContent=id?`${instance?.name||'компонент'}${stats?` · ${stats.faces}F · ${stats.shells} shell · ${stats.parts} дет.`:''}`:'клик по детали — выбрать';}
  updateDrawingModeAvailability();
  if(state.rec){
    renderDimensions();
    if(state.drawingMode==='partDetail'){renderCurrentDrawing();scheduleDrawingFit();}
  }
};
const worker=new Worker('./import-worker.js',{type:'module'});
let state={fileName:null,fileSize:0,rec:null,dimensions:[],types:[],parseMs:0,drawingMode:'production',selectedComponentId:null,selectedComponentName:'',importKind:null,slddrwSheetIndex:0};
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
function selectedSourceFile(componentId=state.selectedComponentId){const occurrence=(state.rec?.occurrences||[]).find(item=>item.id===componentId);return occurrence?.fileName||occurrence?.file||state.fileName}
function selectionTopology(componentId){if(!state.rec||!componentId)return null;const ids=new Set(componentDrawableIds(state.rec,componentId)),items=(state.rec.brep?.components||[]).filter(item=>ids.has(item.componentId));return{parts:ids.size,faces:items.reduce((sum,item)=>sum+(item.faces||0),0),shells:items.reduce((sum,item)=>sum+(item.shells||0),0)}}
function setBusy(on){$('#fileInput').disabled=on;$('#offlineStatus').textContent=on?'Разбираю файл…':'Оффлайн ядро';document.body.classList.toggle('busy',on)}

async function importFile(file){
  const fileName=file.name,fileSize=file.size,ext=(fileName.split('.').pop()||'').toLowerCase();
  if(!['sldasm','slddrw'].includes(ext)){alert('ROZFOOD ENGINEERING STUDIO принимает .SLDASM и .SLDDRW.');return}
  setBusy(true);state.fileName=fileName;state.fileSize=fileSize;state.importKind=ext;state.selectedComponentId=null;state.selectedComponentName='';state.slddrwSheetIndex=0;
  $('#projectName').textContent=fileName.replace(/\.[^.]+$/,'');
  $('#fileMeta').textContent=`${fileName} · ${(fileSize/1024).toFixed(1)} KB · локально`;
  const buffer=await file.arrayBuffer();
  if(ext==='sldasm'){
    log(`Импорт ${fileName}: SLDASM Drawing Intelligence decoder · ${(fileSize/1024).toFixed(1)} KB.`);
    worker.postMessage({kind:'sldasm',buffer,fileName},[buffer]);
    return;
  }
  log(`Импорт ${fileName}: SLDDRW Reference Reader · ${(fileSize/1024).toFixed(1)} KB.`);
  try{
    const ref=await parseSLDDRW(buffer,{fileName});
    state.rec={kind:'slddrw',drawingRef:ref,geometryAvailable:false,counts:{},nativeAssembly:null};
    state.dimensions=ref.dimensions||[];drawingRenderCache.clear();
    $('#projectName').textContent=ref.projectName||fileName.replace(/\.[^.]+$/,'');
    renderAll();setBusy(false);switchTab('drawing');scheduleDrawingFit();
    log(`SLDDRW готов: ${ref.streamCount} потоков · ${ref.sheetNames.length||ref.previewCount} лист · ${ref.views.length} видов · ${ref.dimensions.length} индексированных размеров · ${ref.notes.length} примечаний. Интернет не использовался.`);
    if(ref.warnings?.length)log('SLDDRW: '+ref.warnings[0]);
  }catch(err){
    setBusy(false);console.error('SLDDRW import error',err);log('Ошибка SLDDRW: '+(err?.message||err));alert(`Ошибка импорта SLDDRW: ${err?.message||err}`);
  }
}


worker.onmessage=e=>{
  state.importKind='sldasm';setBusy(false);if(!e.data.ok){const where=e.data.stage?` [${e.data.stage}]`:'';log('Ошибка'+where+': '+e.data.error);console.error('SLDASM worker error',e.data);alert(`Ошибка импорта${where}: ${e.data.error}`);return}
  Object.assign(state,e.data);drawingRenderCache.clear();renderAll();
  const n=state.rec.nativeAssembly;
  if(n?.root)$('#projectName').textContent=n.root;
  const geo=state.rec.geometryAvailable!==false;
  const bc=state.rec.brep?.counts||{};log(`SLDASM готов: ${n.componentCount} позиций · ${n.occurrenceCount} вхождений · ${n.faceBlocks||0} tess-блоков · ${n.triangles||0} треугольников. B-Rep Core: ${bc.vertices||0} V · ${bc.edges||0} E · ${bc.faces||0} F · ${bc.shells||0} shell. Распознано: ${state.rec.recognition?.counts?.planes||0} плоскостей · ${state.rec.recognition?.counts?.cylinders||0} цилиндров · ${state.rec.recognition?.counts?.holes||0} отверстий. Интернет не использовался.`);
  switchTab(geo?'model':'assembly');
};

function setEmptyView(title,text){const root=$('#emptyView');root.querySelector('b').textContent=title;root.querySelector('span').textContent=text;root.style.display='grid'}
function isSlddrw(){return state.importKind==='slddrw'||state.rec?.kind==='slddrw'}
function slddrwRef(){return state.rec?.drawingRef||null}
function currentSlddrwPreview(){const ref=slddrwRef();if(!ref)return null;const idx=Math.max(0,Math.min(state.slddrwSheetIndex||0,Math.max(0,(ref.previews?.length||1)-1)));return (ref.previews||[]).find(p=>p.index===idx)||ref.previews?.[idx]||null}
function renderSlddrwDrawing(){
  const ref=slddrwRef(),svg=$('#drawingSvg');if(!ref||!svg)return;
  const p=currentSlddrwPreview();
  if(p?.dataUrl){svg.setAttribute('viewBox',`0 0 ${p.width} ${p.height}`);svg.innerHTML=`<rect class="slddrw-reference-bg" width="${p.width}" height="${p.height}"/><image class="slddrw-reference-sheet" href="${p.dataUrl}" x="0" y="0" width="${p.width}" height="${p.height}" preserveAspectRatio="xMidYMid meet"/>`;}
  else{svg.setAttribute('viewBox','0 0 1200 760');svg.innerHTML=`<rect width="1200" height="760" fill="${document.documentElement.dataset.theme==='dark'?'#0d1522':'#fff'}"/><g font-family="system-ui" text-anchor="middle"><text x="600" y="330" font-size="30" font-weight="700" fill="${document.documentElement.dataset.theme==='dark'?'#f4f7fb':'#17202b'}">SLDDRW прочитан</text><text x="600" y="380" font-size="18" fill="#6e7781">Встроенное превью листа отсутствует.</text></g>`;}
  finalizeDrawingRender();
}
function renderSlddrwAll(){
  const ref=slddrwRef();if(!ref)return;
  viewer.clear();setEmptyView('SLDDRW — 2D-чертёж',`${ref.sheetNames.length||ref.previewCount||0} лист · ${ref.views.length||0} видов · 3D-модель из SLDDRW в этой сборке не реконструируется.`);
  $('#exportBtn').disabled=false;$('#entityCount').textContent=`${ref.streamCount} streams`;
  ['sx','sy','sz','faceCount','edgeCount','cylinderCount','bsplineCount','patternCount','coaxialCount','brepVertexCount','brepEdgeCount','brepFaceCount','brepShellCount','brepClosedCount'].forEach(id=>{const el=$('#'+id);if(el)el.textContent='—'});
  $('#solidCount').textContent='SLDDRW';$('#unitLabel').textContent='DRAWING';$('#unitFactor').textContent='—';const bq=$('#brepCoverage');if(bq)bq.textContent='—';$('#confidence').textContent='REF';$('#selectionInfo').textContent=`SLDDRW · ${ref.previewCount} preview`;
  renderTree();renderFeatures();renderDimensions();renderAssembly();updateDrawingModeAvailability();renderCurrentDrawing();$('#exportDrawingBtn').disabled=!ref.previewCount;
}
function renderAll(){
  if(isSlddrw()){renderSlddrwAll();return}
  const r=state.rec,d=state.dimensions||[],geo=r.geometryAvailable!==false;
  if(geo){viewer.setModel(r);$('#emptyView').style.display='none'}else{viewer.clear();setEmptyView('SLDASM сборка прочитана',`${r.nativeAssembly?.componentCount||0} позиций · BOM доступен во вкладке «Сборка». В этом файле не найдена декодируемая встроенная FaceTessellations-геометрия.`)}
  $('#exportBtn').disabled=false;
  $('#entityCount').textContent=geo?`${r.counts.tessFaceBlocks||0} tess faces`:`${r.nativeAssembly?.componentCount||0} компонентов`;
  $('#sx').textContent=geo?fmt(r.bounds.size[0])+' mm':'—';$('#sy').textContent=geo?fmt(r.bounds.size[1])+' mm':'—';$('#sz').textContent=geo?fmt(r.bounds.size[2])+' mm':'—';
  $('#solidCount').textContent=geo?(r.brep?'B-REP α':'TESS'):'—';$('#faceCount').textContent=geo?(r.counts.triangles??r.counts.sceneFaces??r.counts.faces):'—';$('#edgeCount').textContent=geo?(r.brep?.counts?.edges??r.counts.edges??r.counts.sceneEdges):'—';
  $('#unitLabel').textContent=geo?r.unit:'—';$('#unitFactor').textContent=geo?fmt(r.factor):'—';$('#cylinderCount').textContent=geo?(r.recognition?.counts?.cylinders??0):'—';$('#bsplineCount').textContent=geo?(r.recognition?.counts?.holes??0):'—';const pc=$('#patternCount'),cc=$('#coaxialCount');if(pc)pc.textContent=geo?(r.recognition?.counts?.holePatterns??0):'—';if(cc)cc.textContent=geo?(r.recognition?.counts?.coaxialGroups??0):'—';
  const mc=r.manufacturing?.counts||{};[['chamferCount',mc.chamfers],['filletCount',mc.fillets],['threadCount',mc.threads],['sheetMetalCount',mc.sheetMetal],['bendCount',mc.bends]].forEach(([id,v])=>{const el=$('#'+id);if(el)el.textContent=geo?(v??0):'—'});
  const materialEl=$('#materialStatus');if(materialEl)materialEl.textContent=r.manufacturing?.materials?.documentMaterial||'—';
  const bc=r.brep?.counts||{};const bv=$('#brepVertexCount'),be=$('#brepEdgeCount'),bf=$('#brepFaceCount'),bs=$('#brepShellCount'),bclosed=$('#brepClosedCount'),bq=$('#brepCoverage');if(bv)bv.textContent=geo?(bc.vertices??0):'—';if(be)be.textContent=geo?(bc.edges??0):'—';if(bf)bf.textContent=geo?(bc.faces??0):'—';if(bs)bs.textContent=geo?(bc.shells??0):'—';if(bclosed)bclosed.textContent=geo&&r.brep?(Number.isFinite(bc.closedShells)?bc.closedShells:'LOD'):'—';if(bq)bq.textContent=geo&&r.brep?`${Math.round((r.brep.coverage||0)*100)}%${r.brep.topologyComplete?' FULL':' LOD'}`:'—';
  const conf=r.recognition?Math.round((r.recognition.confidence||0)*100):(d.length?Math.round(d.reduce((s,x)=>s+x.confidence,0)/d.length*100):0);const vr=r.recognition?.verification?.ratio;$('#confidence').textContent=geo?(Number.isFinite(vr)?`${Math.round(vr*100)}% VERIFIED`:(conf+'% TESS')):'META';
  if(geo)$('#selectionInfo').textContent=r.brep?`B-Rep ${r.brep.counts?.edges||0}E · ${r.brep.counts?.shells||0} shell`:`Verified geometry · ${r.recognition?.counts?.verifiedCylinders||0} цилиндр. · ${r.recognition?.counts?.verifiedPlanes||0} плоск.`;renderTree();renderFeatures();renderDimensions();renderAssembly();updateDrawingModeAvailability();renderCurrentDrawing();$('#exportDrawingBtn').disabled=!r;
}

function drawingCacheKey(){
  return [APP_VERSION,state.fileName||'untitled',state.fileSize||0,isSlddrw()?`slddrw:${state.slddrwSheetIndex||0}`:state.drawingMode,['partDetail','flatPattern'].includes(state.drawingMode)?(state.selectedComponentId||'part'):'sheet',document.documentElement.dataset.theme||'light'].join('|');
}
function finalizeCachedDrawing(cacheKey){
  const svg=$('#drawingSvg');
  drawingRenderCache.set(cacheKey,{viewBox:svg.getAttribute('viewBox')||'0 0 1200 760',html:svg.innerHTML});
  finalizeDrawingRender();
}
function renderCurrentDrawing(){
  if(!state.rec)return;
  if(isSlddrw()){renderSlddrwDrawing();return}
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
  if(state.drawingMode==='flatPattern'){
    renderFlatPattern(svg,r,{componentId:state.selectedComponentId,componentName:state.selectedComponentName||'Выбранная деталь',fileName:selectedSourceFile(),theme:document.documentElement.dataset.theme});
    finalizeCachedDrawing(cacheKey);return;
  }
  if(state.drawingMode==='partDetail'){
    renderComponentProductionSheet(svg,r,{componentId:state.selectedComponentId,componentName:state.selectedComponentName||'Выбранная деталь',fileName:selectedSourceFile(),theme:document.documentElement.dataset.theme});
    finalizeCachedDrawing(cacheKey);return;
  }
  if(r.tessellation?.mode==='triangle-strips'&&r.recognition){
    const projectName=$('#projectName')?.textContent||state.fileName?.replace(/\.[^.]+$/,'')||n?.root||'SLDASM';
    const profile=assemblyDrawingProfile(r);
    r.drawingProfile=profile.profile;
    r.drawingProfileConfidence=profile.confidence;
    // SLDASM drawing modes stay assembly-wide; only a non-assembly record may use the part sheet.
    if(r.isAssembly||n)renderAssemblyProductionSheet(svg,r,{projectName,fileName:state.fileName,theme:document.documentElement.dataset.theme,mode:state.drawingMode});
    else renderTessRecognitionDrawing(svg,r,{projectName,fileName:state.fileName,theme:document.documentElement.dataset.theme,mode:state.drawingMode});
    finalizeCachedDrawing(cacheKey);return;
  }
  svg.setAttribute('viewBox','0 0 1200 760');svg.innerHTML=`<rect width="1200" height="760" fill="${document.documentElement.dataset.theme==='dark'?'#0d1522':'#fff'}"/><g font-family="-apple-system,BlinkMacSystemFont,system-ui" text-anchor="middle"><text x="600" y="285" font-size="36" font-weight="700" fill="${document.documentElement.dataset.theme==='dark'?'#f4f7fb':'#17202b'}">SLDASM: структура сборки импортирована</text><text x="600" y="340" font-size="22" fill="#6e7781">${esc(n?.componentCount||0)} позиций · ${esc(n?.occurrenceCount||0)} вхождений</text><text x="600" y="400" font-size="18" fill="#6e7781">Встроенная FaceTessellations-геометрия в этом файле не найдена.</text></g>`;
  finalizeCachedDrawing(cacheKey);
}

function drawingEditorKey(){return [state.fileName||'untitled',state.fileSize||0,state.drawingMode,['partDetail','flatPattern'].includes(state.drawingMode)?(state.selectedComponentId||'part'):'sheet'].join('|')}
function finalizeDrawingRender(){drawingNavigator.captureBase({reset:true});drawingEditor.setKey(drawingEditorKey());drawingEditor.refresh();const applied=drawingEditor.applyReferences();if(applied)log(`Эталонные инженерные правила применены: ${applied}.`)}
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
  if(isSlddrw()&&on){drawingEditMode=true;drawingNavigator.setEnabled(true);drawingNavigator.setTool('pan');syncDrawingEditUI();log('SLDDRW — эталон read-only: включена навигация (колесо зум к курсору, перетаскивание — панорама).');return}
  drawingEditMode=!!on;drawingNavigator.setEnabled(drawingEditMode);
  if(drawingEditMode)setDrawingTool(drawingTool||'edit',{silent:true});
  else{drawingEditor.setEnabled(false);syncDrawingEditUI();updateEditorSelection(null)}
  log(drawingEditMode?'Панель правки включена: отдельно доступны «Редактировать», «Зум» и «Панорама». Колесо — зум к курсору.':'Режим ручной правки чертежа выключен.');
}

function selectedSheetMetalFeature(){return (state.rec?.manufacturing?.sheetMetal?.components||[]).find(x=>x.componentId===state.selectedComponentId)||null}
function componentManufacturing(componentId){const m=state.rec?.manufacturing||{};return{classInfo:(m.classes||[]).find(x=>x.componentId===componentId)||null,sheet:(m.sheetMetal?.components||[]).find(x=>x.componentId===componentId)||null}}
function updateDrawingModeAvailability(){
  if(!state.rec)return;
  const modeSwitch=document.querySelector('#drawingActions .mode-switch'),sheetSelect=$('#slddrwSheetSelect'),editBtn=$('#editDrawingBtn'),undo=$('#undoDrawingBtn'),redo=$('#redoDrawingBtn');
  if(isSlddrw()){
    modeSwitch?.classList.add('hidden');sheetSelect?.classList.remove('hidden');editBtn?.classList.add('hidden');undo?.classList.add('hidden');redo?.classList.add('hidden');$('#drawingToolPalette')?.classList.add('hidden');
    const ref=slddrwRef();if(sheetSelect&&ref){sheetSelect.innerHTML=(ref.previews||ref.sheetNames||[]).map((x,i)=>{const name=typeof x==='string'?x:(x.name||`Лист ${i+1}`);return `<option value="${i}" ${i===(state.slddrwSheetIndex||0)?'selected':''}>${esc(name)}</option>`}).join('')||'<option value="0">Лист 1</option>';}
    drawingNavigator.setEnabled(true);drawingNavigator.setTool('pan');return;
  }
  modeSwitch?.classList.remove('hidden');sheetSelect?.classList.add('hidden');editBtn?.classList.remove('hidden');undo?.classList.remove('hidden');redo?.classList.remove('hidden');
  const assemblyBtn=document.querySelector('[data-drawing-mode="assemblyDetailed"]');
  if(assemblyBtn){const available=!!state.rec.isAssembly;assemblyBtn.disabled=!available;assemblyBtn.title=available?'Сборочный производственный лист: виды, A–A/B–B, C/D, позиции, BOM и штамп':'Доступно после загрузки SLDASM сборки';if(!available&&state.drawingMode==='assemblyDetailed'){state.drawingMode='production';}}
  const partBtn=document.querySelector('[data-drawing-mode="partDetail"]');
  if(partBtn){const available=!!state.selectedComponentId;partBtn.disabled=!available;partBtn.title=available?`Чертёж выбранного компонента: ${state.selectedComponentName||state.selectedComponentId}`:'Сначала выберите деталь или подсборку в 3D/BOM';if(!available&&state.drawingMode==='partDetail'){state.drawingMode='production';}}
  const flatBtn=document.querySelector('[data-drawing-mode="flatPattern"]'),sheet=selectedSheetMetalFeature();
  if(flatBtn){const available=!!(state.selectedComponentId&&sheet);flatBtn.disabled=!available;flatBtn.title=available?`Развёртка ${state.selectedComponentName||state.selectedComponentId} · S=${fmt(sheet.thickness,2)} · ${sheet.bendCount||0} гиб.`:'Выберите деталь, которую Feature Recognition Core подтвердил как листовой металл';if(!available&&state.drawingMode==='flatPattern'){state.drawingMode='production';}}
  $$('[data-drawing-mode]').forEach(x=>x.classList.toggle('active',x.dataset.drawingMode===state.drawingMode));
}

function renderTree(){
  if(isSlddrw()){
    const ref=slddrwRef(),p=ref?.properties||{};const rows=[['Файл',state.fileName],['Формат','SLDDRW'],['Адаптер','Reference Reader v2.1.0'],['Контейнер',ref?.container||'—'],['SW format',ref?.version||'—'],['Streams',ref?.streamCount||0],['Листов',ref?.sheetNames?.length||ref?.previewCount||0],['Видов',ref?.views?.length||0],['Размеров в KeyWords',ref?.dimensions?.length||0],['Примечаний',ref?.notes?.length||0],['Формат листа',p['SW-Template Size']||'—'],['Масштаб листа',p['SW- Масштаб листа']||'—'],['Последнее сохранение',p['SW-Last Saved Date']||'—']];$('#treeBody').classList.remove('empty');$('#treeBody').innerHTML=rows.map(([a,b])=>`<div class="tree-row"><b>${esc(a)}</b><span>${esc(b)}</span></div>`).join('');return;
  }
  const r=state.rec,n=r.nativeAssembly;
  const rows=[['Файл',state.fileName],['Формат','SLDASM'],['Адаптер','Feature Recognition Core v2.4 + CAD Edge Graph'],['Контейнер',n.container],['Streams',n.streamCount||0],...(Number.isFinite(n.documentProperties?.mass)?[['Масса',`${n.documentProperties.mass.toFixed(2).replace('.',',')} кг`]]:[]),['Позиций',n.componentCount],['Вхождений',n.occurrenceCount],['Tess-блоков',n.faceBlocks||0],['Исходных треуг.',n.sourceTriangles||0],['Сценовых треуг.',n.triangles||0],...(r.counts.displayTriangles&&r.counts.displayTriangles!==r.counts.triangles?[['3D LOD',r.counts.displayTriangles],['Передача','Stack-safe']]:[]),...(r.brep?[['B-Rep V',r.brep.counts?.vertices||0],['B-Rep E',r.brep.counts?.edges||0],['B-Rep F',r.brep.counts?.faces||0],['B-Rep Shell',r.brep.counts?.shells||0],['Topology',`${Math.round((r.brep.coverage||0)*100)}% ${r.brep.topologyComplete?'FULL':'LOD'}`]]:[]),...(r.manufacturing?[['Feature holes',r.manufacturing.counts?.holes||0],['Фаски · кандидаты',r.manufacturing.counts?.chamfers||0],['Скругления · кандидаты',r.manufacturing.counts?.fillets||0],['Sheet Metal',r.manufacturing.counts?.sheetMetal||0],['Материал',r.manufacturing.materials?.documentMaterial||'не найден в SLDASM']]:[]),['Размещено',n.mappedOccurrences||0]];
  $('#treeBody').classList.remove('empty');
  $('#treeBody').innerHTML=rows.map(([a,b])=>`<div class="tree-row"><b>${esc(a)}</b><span>${esc(b)}</span></div>`).join('');
}


function renderFeatures(){
  if(isSlddrw()){
    const ref=slddrwRef();$('#featureList').classList.remove('empty');$('#featureList').innerHTML=`<div class="feature"><i>▤</i><div>Modern SLDDRW chunk reader<small>${esc(ref.streamCount)} потоков · raw DEFLATE · полностью локально</small></div><strong>OK</strong></div><div class="feature"><i>▱</i><div>Листы и preview<small>${esc(ref.sheetNames.length)} имён · ${esc(ref.previewCount)} PNG-превью</small></div><strong>${ref.previewCount?'OK':'—'}</strong></div><div class="feature"><i>↔</i><div>Displayed dimensions index<small>${ref.dimensions.length?`${esc(ref.dimensions.length)} значений из swXmlContents/KeyWords`:'в этом файле Dimension values в KeyWords отсутствуют'}</small></div><strong>${ref.dimensions.length?'OK':'α'}</strong></div><div class="feature"><i>¶</i><div>Примечания / штамп<small>${esc(ref.notes.length)} текстовых элементов · ${esc(ref.properties?.['SW-File Title']||ref.projectName||'')}</small></div><strong>OK</strong></div><div class="feature"><i>◫</i><div>Виды / ссылки модели<small>${esc(ref.views.length)} видов · ${esc(ref.references.length)} ссылок</small></div><strong>OK</strong></div><div class="feature"><i>◎</i><div>Contents/Definition dimensions<small>следующий этап: бинарная CArchive-размерка для старых/detached файлов без Dimension index</small></div><strong>α</strong></div>`;return;
  }
  const r=state.rec,n=r.nativeAssembly,geo=r.geometryAvailable!==false;
  $('#featureList').classList.remove('empty');
  const G=r.recognition;
  const V=G?.verification;
  $('#featureList').innerHTML=`<div class="feature"><i>☷</i><div>SLDASM component tree<small>${esc(n?.componentCount||0)} позиций · ${esc(n?.occurrenceCount||0)} вхождений</small></div><strong>OK</strong></div><div class="feature"><i>△</i><div>3D FaceTessellations + transforms<small>${geo?`${esc(n?.mappedOccurrences||0)} вхождений · ${esc(n?.triangles||0)} треугольников`:'встроенная тесселяция не найдена'}</small></div><strong>${geo?'OK':'—'}</strong></div><div class="feature"><i>◉</i><div>Precision TESS Recognition<small>${G?`${esc(G.counts.planes)} плоск. · ${esc(G.counts.cylinders)} цилиндр. · ${esc(G.counts.holes)} отверст.`:'ожидает 3D mesh'}</small></div><strong>${G?'OK':'—'}</strong></div><div class="feature verified-feature"><i>✓</i><div>Verified analytical geometry<small>${V?`${esc(V.counts.planes)} плоск. · ${esc(V.counts.cylinders)} цилиндр. · ${esc(V.counts.holes)} отверст. подтверждены fit-критериями`:'ожидает распознавание'}</small></div><strong>${V?'OK':'—'}</strong></div><div class="feature"><i>⌾</i><div>Patterns / PCD / coaxial<small>${G?`${esc(G.counts.holePatterns||0)} групп отверстий · ${esc(G.counts.coaxialGroups||0)} соосных ступеней`:'ожидает распознавание'}</small></div><strong>${G?'OK':'—'}</strong></div><div class="feature"><i>▱</i><div>Drawing Intelligence<small>${G?`${assemblyDrawingProfile(r).profile} · безопасный выбор главного вида · контекст детали/сборки`:'ожидает распознавание геометрии'}</small></div><strong>${G?'OK':'—'}</strong></div><div class="feature editor-feature"><i>✎</i><div>Drawing Editor<small>${G?'перемещение · скрытие · текст · допуски · Ra · сварные обозначения · undo/redo':'ожидает чертёж'}</small></div><strong>${G?'OK':'—'}</strong></div><div class="feature brep-feature"><i>⬡</i><div>ROZFOOD B-Rep Core<small>${r.brep?`${esc(r.brep.counts?.vertices||0)} V · ${esc(r.brep.counts?.edges||0)} E · ${esc(r.brep.counts?.faces||0)} F · ${esc(r.brep.counts?.shells||0)} shell · ${r.brep.faceIdentity==='source-face-blocks'?'FACE-BLOCK':'INFERRED'} · ${r.brep.topologyComplete?'FULL':'LOD'}`:'ожидает 3D mesh'}</small></div><strong>${r.brep?'OK':'—'}</strong></div><div class="feature"><i>⌾</i><div>Hole Recognition Engine<small>${r.manufacturing?`${esc(r.manufacturing.counts?.holes||0)} отверстий · сквозные / глухие / ступенчатые · Ø на чертеже`:'ожидает геометрию'}</small></div><strong>${r.manufacturing?'OK':'—'}</strong></div><div class="feature"><i>◒</i><div>Chamfer / Fillet Recognition<small>${r.manufacturing?`${esc(r.manufacturing.counts?.chamfers||0)} фасок · ${esc(r.manufacturing.counts?.fillets||0)} скруглений · ${esc(r.manufacturing.counts?.threads||0)} кандид. резьбы`:'ожидает геометрию'}</small></div><strong>${r.manufacturing?'α':'—'}</strong></div><div class="feature"><i>▰</i><div>Sheet Metal Recognition<small>${r.manufacturing?`${esc(r.manufacturing.counts?.sheetMetal||0)} листовых деталей · ${esc(r.manufacturing.counts?.bends||0)} гибов · развёртка ALPHA`:'ожидает геометрию'}</small></div><strong>${r.manufacturing?.counts?.sheetMetal?'α':'—'}</strong></div><div class="feature"><i>◐</i><div>Visibility / Section Core<small>главный вид с HSR · внутренности скрыты до разреза · 3D half-section X/Y/Z</small></div><strong>OK</strong></div><div class="feature"><i>▦</i><div>Material Recognition<small>${esc(r.manufacturing?.materials?.documentMaterial||'материал не сохранён в доступных свойствах SLDASM')}</small></div><strong>${r.manufacturing?.materials?.documentMaterial?'OK':'α'}</strong></div><div class="feature"><i>◎</i><div>Analytic Reconstruction Core<small>Цилиндры/отверстия/PCD восстанавливаются как аналитические примитивы и заменяют рёбра треугольной сетки на чертеже. Exact Parasolid feature-history всё ещё недоступен.</small></div><strong>OK</strong></div>`;}


function componentBounds(componentId){
  return componentLocalRecord(state.rec,componentId)?.bounds||null;
}
function componentDimensions(componentId){
  const r=state.rec,part=componentLocalRecord(r,componentId);if(!r||!part||!componentId)return[];
  const R=part.recognition=part.recognition||recognizeTessellationGeometry(part,{maxFeatures:320});
  const graph=part.featureGraph=part.featureGraph||buildFeatureGraph(part);
  const out=[],seen=new Set(),push=(x,key)=>{if(seen.has(key))return;seen.add(key);out.push(x)};
  const b=componentBounds(componentId);
  if(b){['X','Y','Z'].forEach((a,i)=>push({type:`Габарит ${a}`,label:a,value:b.size[i],unit:'mm',confidence:1,source:'COMPONENT_BOUNDS',componentId},`B:${a}`));}
  if(graph.profile==='AXIAL_PART'){
    push({type:'Общая длина',label:'L',value:graph.overallLength,unit:'mm',confidence:graph.confidence,source:'VERIFIED_FEATURE_OVERALL',componentId},'FG:L');
    push({type:'Наружный диаметр',label:'Ø',value:graph.bodyDiameter,unit:'mm',confidence:graph.confidence,source:'VERIFIED_FEATURE_DIAMETER',componentId},'FG:BODY');
    if(graph.stepDiameter)push({type:'Диаметр ступени',label:'Ø',value:graph.stepDiameter,unit:'mm',confidence:.96,source:'VERIFIED_FEATURE_STEP',componentId},'FG:STEPD');
    if(graph.stepLength)push({type:'Длина ступени',label:'L',value:graph.stepLength,unit:'mm',confidence:.96,source:'VERIFIED_FEATURE_STEP',componentId},'FG:STEPL');
    for(const group of [...new Map((graph.chamfers||[]).map(chamfer=>[(Math.round(chamfer.size*20)/20).toFixed(2),[]])).keys()]){const size=Number(group),count=(graph.chamfers||[]).filter(chamfer=>Math.abs(chamfer.size-size)<.08).length;push({type:'Фаска',label:`${count}×45°`,value:size,unit:'mm',confidence:.96,source:'VERIFIED_FEATURE_CHAMFER',componentId,count},`FG:CH:${group}`)}
  }else if(graph.profile==='CROSS_ASSEMBLY'){
    for(const [type,value,key] of [['Диаметр ступицы',graph.hubDiameter,'HUB'],['Центральное отверстие',graph.boreDiameter,'BORE'],['Толщина ступицы',graph.thickness,'THICK'],['Диаметр стержней',graph.rodDiameter,'ROD']])if(value)push({type,label:type.includes('Толщина')?'L':'Ø',value,unit:'mm',confidence:graph.confidence,source:'VERIFIED_SUBASSEMBLY_FEATURE',componentId},`FG:${key}`);
    if(graph.holeCount)push({type:'Группа отверстий',label:`${graph.holeCount}×Ø`,value:graph.holeDiameter,unit:'mm',confidence:.97,source:'VERIFIED_SUBASSEMBLY_PATTERN',count:graph.holeCount,pcd:graph.holePcd,componentId},'FG:HOLES');
  }
  for(const p of R.holePatterns||[]){push({type:p.pcd?'Группа отверстий · PCD':'Группа отверстий',label:`${p.count}×Ø`,value:p.diameter,unit:'mm',confidence:p.confidence,source:p.verified?'VERIFIED_HOLE_PATTERN':'TESS_HOLE_PATTERN',count:p.count,pcd:p.pcd,componentId},`HP:${p.count}:${p.diameter.toFixed(2)}:${p.pcd?Math.round(p.pcd*10):0}`);if(p.pcd)push({type:'Делительная окружность',label:'PCD Ø',value:p.pcd,unit:'mm',confidence:p.confidence,source:p.verified?'VERIFIED_PCD':'TESS_PCD',count:p.count,componentId},`PCD:${Math.round(p.pcd*10)}`)}
  for(const c of R.cylinders||[]){const dk=Math.round(c.diameter*100)/100,lk=Math.round(c.length*100)/100;push({type:c.type==='hole'?'Отверстие':'Цилиндр',label:'Ø',value:c.diameter,unit:'mm',confidence:c.confidence,source:c.verified?'VERIFIED_CYLINDER':'TESS_CYLINDER',componentId},`D:${c.type}:${dk}`);if(c.length>1)push({type:'Длина цилиндра',label:'L',value:c.length,unit:'mm',confidence:Math.max(.65,c.confidence-.05),source:c.verified?'VERIFIED_CYLINDER_LENGTH':'TESS_CYLINDER_LENGTH',componentId},`L:${lk}`);if(out.length>30)break}
  for(const p of R.planeSpacings||[]){push({type:'Расстояние плоскостей',label:'L',value:p.spacing,unit:'mm',confidence:p.confidence,source:p.verified?'VERIFIED_PLANE_SPACING':'TESS_PLANE_SPACING',componentId},`PS:${Math.round(p.spacing*10)}`);if(out.length>34)break}
  for(const d of (state.dimensions||[]).filter(x=>x.componentId===componentId&&['FEATURE_HOLE','FEATURE_CHAMFER','FEATURE_FILLET','SHEET_METAL_THICKNESS'].includes(x.source)))push(d,`MFG:${d.source}:${d.label}:${Math.round((d.value||0)*100)}`);
  return out.slice(0,48);
}
function contextualDimensions(){
  if(['partDetail','flatPattern'].includes(state.drawingMode)&&state.selectedComponentId)return componentDimensions(state.selectedComponentId);
  return state.dimensions||[];
}
function dimensionSymbol(x){
  const label=String(x?.label||'');
  if(x?.source==='FEATURE_HOLE')return 'Ø';
  if(x?.source==='FEATURE_FILLET')return 'R';
  if(x?.source==='FEATURE_CHAMFER')return label||'C';
  if(x?.source==='SHEET_METAL_THICKNESS')return 'S';
  if(label.startsWith('Ø')||['TESS_CYLINDER','VERIFIED_CYLINDER','TESS_PCD','VERIFIED_PCD','VERIFIED_FEATURE_DIAMETER','VERIFIED_SUBASSEMBLY_FEATURE'].includes(x?.source)&&!String(x?.type||'').includes('Толщина'))return ['TESS_PCD','VERIFIED_PCD'].includes(x?.source)?'PCD Ø':'Ø';
  if(['TESS_HOLE_PATTERN','VERIFIED_HOLE_PATTERN','VERIFIED_SUBASSEMBLY_PATTERN'].includes(x?.source))return `${x.count||''}×Ø`;
  if(label.startsWith('L')||['TESS_CYLINDER_LENGTH','VERIFIED_CYLINDER_LENGTH','TESS_PLANE_SPACING','VERIFIED_PLANE_SPACING'].includes(x?.source))return 'L';
  return ['X','Y','Z'].includes(label)?label:'';
}
function dimensionSourceLabel(x){if(x.source==='FEATURE_HOLE')return 'Feature Recognition · тип отверстия + аналитический Ø';if(x.source==='FEATURE_CHAMFER')return 'Feature Recognition · фаска-кандидат · TESS';if(x.source==='FEATURE_FILLET')return 'Feature Recognition · скругление-кандидат · TESS';if(x.source==='SHEET_METAL_THICKNESS')return 'Sheet Metal Recognition · постоянная толщина';const verified=String(x?.source||'').startsWith('VERIFIED_');const prefix=verified?'проверено':'распознано';if(String(x?.source||'').startsWith('VERIFIED_FEATURE_'))return'Feature Graph · производственный элемент';if(String(x?.source||'').startsWith('VERIFIED_SUBASSEMBLY_'))return'подсборка · объединённая геометрия';return ['TESS_CYLINDER','VERIFIED_CYLINDER'].includes(x.source)?`${prefix}: цилиндр`:['TESS_CYLINDER_LENGTH','VERIFIED_CYLINDER_LENGTH'].includes(x.source)?`${prefix}: длина`:['TESS_HOLE_PATTERN','VERIFIED_HOLE_PATTERN'].includes(x.source)?(x.pcd?`${prefix}: группа отверстий · PCD Ø${fmt(x.pcd,2)}`:`${prefix}: повторяющиеся отверстия`):['TESS_PCD','VERIFIED_PCD'].includes(x.source)?`${prefix}: делительная окружность`:['TESS_PLANE_SPACING','VERIFIED_PLANE_SPACING'].includes(x.source)?`${prefix}: параллельные плоскости`:x.source==='COMPONENT_BOUNDS'?'локальный габарит выбранного компонента':'габарит TESS'}
function renderDimensions(){
  if(isSlddrw()){
    const ref=slddrwRef(),d=ref?.dimensions||[];
    if(d.length){$('#dimensionCards').classList.remove('empty');$('#dimensionCards').innerHTML=d.slice(0,18).map(x=>`<div class="dim-card"><span>${esc(x.name||'Размер')}</span><b>${esc(x.value)}</b><small>SLDDRW · отображаемое значение · 100%</small></div>`).join('');$('#dimensionsTable').innerHTML=d.map(x=>`<tr><td>SLDDRW</td><td>${esc(x.name||'Dimension')}</td><td>${esc(x.value)}</td><td>100% · KeyWords</td></tr>`).join('');}
    else{$('#dimensionCards').classList.add('empty');$('#dimensionCards').textContent='Лист SLDDRW читается и показывается точно по встроенному preview. В этом конкретном detached-файле KeyWords не содержит структурированных значений <Dimension>; декодирование размерки из Contents/Definition — следующий этап.';$('#dimensionsTable').innerHTML='<tr><td colspan="4">SLDDRW прочитан. Структурированных Dimension values в KeyWords нет; программа ничего не выдумывает. Эталонная размерка видна на встроенном листе, бинарный CArchive decoder будет добавлен следующим шагом.</td></tr>';}
    return;
  }
  const r=state.rec,d=contextualDimensions();
  if(r.geometryAvailable!==false&&d.length){
    $('#dimensionCards').classList.remove('empty');
    $('#dimensionCards').innerHTML=d.map(x=>{const sym=dimensionSymbol(x),value=`${sym?`${sym} `:''}${fmt(x.value)} ${esc(x.unit||'mm')}`;return `<div class="dim-card"><span>${esc(x.type||x.label)}</span><b>${value}</b><small>${esc(dimensionSourceLabel(x))}</small></div>`}).join('');
    $('#dimensionsTable').innerHTML=d.map(x=>{const sym=dimensionSymbol(x);return `<tr><td>${esc(x.type)}</td><td>${esc(sym||x.label)}</td><td>${fmt(x.value)} ${esc(x.unit||'mm')}</td><td>${Math.round((x.confidence||0)*100)}% · ${esc(x.source||'TESS')}</td></tr>`}).join('');
  }else{
    $('#dimensionCards').classList.add('empty');$('#dimensionCards').textContent='Встроенная геометрия не найдена — габариты недоступны.';
    $('#dimensionsTable').innerHTML='<tr><td colspan="4">v2.4.0 сохраняет VERIFIED-геометрию, строит V/E/F/Shell B-Rep topology и сохраняет ручную доводку листа. Exact Parasolid surface/curve data пока не декодируется.</td></tr>';
  }
}


function renderAssembly(){
  if(isSlddrw()){
    const ref=slddrwRef(),root=$('#assemblyBody'),sheets=ref.sheetNames||[],notes=ref.notes||[],views=ref.views||[],refs=ref.references||[];
    const sheetRows=(ref.previews||[]).map((p,i)=>`<div><button data-slddrw-sheet="${i}" ${i===(state.slddrwSheetIndex||0)?'disabled':''}>▱ ${esc(p.name||sheets[i]||`Лист ${i+1}`)}</button><small>${esc(p.width)}×${esc(p.height)} px · exact embedded preview</small></div>`).join('')||'<div>Preview отсутствует</div>';
    const noteRows=notes.slice(0,40).map(n=>`<div>${esc(n)}</div>`).join('')||'<div>Примечания не найдены</div>';
    const viewRows=views.slice(0,40).map(v=>`<div><b>${esc(v.name||'View')}</b><small>${esc(v.description||'')}</small></div>`).join('')||'<div>Виды не найдены</div>';
    const refRows=refs.slice(0,30).map(v=>`<div><b>${esc(v.description||v.name||'Reference')}</b><small>${esc(v.name||v.type||'')}</small></div>`).join('')||'<div>Ссылки не найдены</div>';
    root.innerHTML=`<div class="assembly-head"><div><h3>${esc(ref.projectName||state.fileName)} · SLDDRW</h3><p class="hint">Reference Reader v2.1.0 · modern chunk container · полностью локально</p></div><span class="adapter-badge">SLDDRW</span></div><div class="reference-grid"><section><h4>Листы</h4><div class="reference-list">${sheetRows}</div><h4 style="margin-top:12px">Виды · ${views.length}</h4><div class="reference-list">${viewRows}</div></section><section><h4>Примечания / штамп · ${notes.length}</h4><div class="reference-list">${noteRows}</div><h4 style="margin-top:12px">Ссылки · ${refs.length}</h4><div class="reference-list">${refRows}</div></section></div>${ref.warnings?.length?`<div class="reference-warning"><b>Честное ограничение v2.1.0:</b> ${esc(ref.warnings[0])}</div>`:''}<div class="native-note"><b>Зачем это нужно:</b> SLDDRW теперь можно использовать как эталон Drawing Intelligence. Мы читаем настоящий сохранённый лист и метаданные SolidWorks, а не сравниваем только с PDF-картинкой.</div>`;return;
  }
  const r=state.rec,root=$('#assemblyBody'),n=r.nativeAssembly,components=n.components||[],geo=r.geometryAvailable!==false;
  const treeRows=components.map(c=>{
    const id=c.instances?.[0]||'',bt=id?selectionTopology(id):null;
    const mf=id?componentManufacturing(id):{},mfg=mf.sheet?` · SHEET S=${fmt(mf.sheet.thickness,2)} · ${mf.sheet.bendCount||0} гиб.`:mf.classInfo?` · ${mf.classInfo.class}`:'';return `<li ${id?`data-component-id="${esc(id)}" data-component-name="${esc(c.name)}" class="selectable-component"`:''}><span>${c.type==='assembly'?'▣':'◫'} ${esc(c.name)}</span><em>×${c.count}</em><small>${esc(c.file)}${bt?` · B-Rep ${esc(bt.faces)}F / ${esc(bt.shells)} shell${c.type==='assembly'?` · ${esc(bt.parts)} дочерн. дет.`:''}`:''}${esc(mfg)}</small></li>`;
  }).join('')||'<li class="muted">Компоненты не извлечены из этого контейнера</li>';
  const bomRows=components.map((c,i)=>{
    const id=c.instances?.[0]||'',bt=id?selectionTopology(id):null,attrs=id?`data-component-id="${esc(id)}" data-component-name="${esc(c.name)}" class="bom-component selectable-component" title="Выбрать компонент в 3D"`:'';
    const mf=id?componentManufacturing(id):{},mfg=mf.sheet?` · лист S=${fmt(mf.sheet.thickness,2)} · ${mf.sheet.bendCount||0} гиб.`:mf.classInfo?` · ${mf.classInfo.class}`:'';return `<div>${i+1}</div><div ${attrs}><b>${esc(c.name)}</b><small>${esc(c.file)} · ${c.type==='assembly'?'подсборка':'деталь'}${bt?` · B-Rep ${esc(bt.faces)}F / ${esc(bt.shells)} shell${c.type==='assembly'?` · ${esc(bt.parts)} дочерн. дет.`:''}`:''}${esc(mfg)}</small></div><div>${c.count}</div>`;
  }).join('');
  root.innerHTML=`<div class="assembly-head"><div><h3>${esc(n.root)} · SLDASM</h3><p class="hint">Feature Recognition Core v2.4 · ${esc(n.container)} · полностью локально</p></div><span class="adapter-badge">SLDASM</span></div><div class="assembly-grid"><section><h4>Дерево компонентов</h4><ul class="component-tree"><li><b>▾ ${esc(n.root)}</b><ul>${treeRows}</ul></li></ul></section><section><h4>BOM · ${components.length} позиций</h4><div class="bom bom-wide"><div class="head">№</div><div class="head">Компонент</div><div class="head">Кол-во</div>${bomRows}</div><p class="hint bom-hint">Нажмите на позицию BOM — деталь или вся подсборка выделится и впишется в 3D.</p></section></div><div class="assembly-actions"><button data-open-assembly-drawing>Открыть производственный сборочный чертёж</button><button data-open-part-drawing ${state.selectedComponentId?'':'disabled'}>Чертёж выбранного компонента</button><button data-open-flat-pattern ${selectedSheetMetalFeature()?'':'disabled'}>Развёртка листовой детали</button></div><div class="native-note"><b>v2.4.0:</b> выбранная SLDASM-подсборка рекурсивно собирается из дочерних SLDPRT и возвращается в собственную систему координат. <b>3D:</b> ${geo?`собрано из FaceTessellations с матрицами вхождений (${esc(n.mappedOccurrences||0)} размещено / ${esc(n.triangles||0)} треугольников сцены).`:'встроенная тесселяция в файле не найдена.'} Feature Recognition Core распознаёт отверстия, фаски/скругления-кандидаты и листовой металл; HSR убирает внутренние детали с главного вида; Feature Graph распознаёт осевые детали и крестовины; профиль DRUM_REFERENCE_A2 строит модельные виды B/A/C, A–A/B–B/D, размерные цепи, развёрнутую спецификацию и штамп с массой. Exact Parasolid B-Rep пока не декодируется; ядро остаётся честной faceted topology.</div>`;
}


$('#assemblyBody').addEventListener('click',e=>{const refSheet=e.target.closest('[data-slddrw-sheet]');if(refSheet){state.slddrwSheetIndex=Number(refSheet.dataset.slddrwSheet)||0;const sel=$('#slddrwSheetSelect');if(sel)sel.value=String(state.slddrwSheetIndex);drawingRenderCache.clear();renderAssembly();switchTab('drawing');renderCurrentDrawing();scheduleDrawingFit();log(`SLDDRW: открыт лист ${state.slddrwSheetIndex+1}.`);return;}const comp=e.target.closest('[data-component-id]');if(comp){viewer.setSelectedComponent(comp.dataset.componentId);state.selectedComponentId=comp.dataset.componentId;state.selectedComponentName=comp.dataset.componentName||comp.querySelector('span')?.textContent?.replace(/^[◫▣]\s*/,'')||'компонент';updateDrawingModeAvailability();renderDimensions();switchTab('model');{const stats=selectionTopology(state.selectedComponentId);$('#selectionInfo').textContent=`${state.selectedComponentName}${stats?` · ${stats.faces}F · ${stats.shells} shell · ${stats.parts} дет.`:''}`;}log('Выбран компонент 3D: '+state.selectedComponentName+'.');return;}const part=e.target.closest('[data-open-part-drawing]');if(part){if(!state.selectedComponentId)return;state.drawingMode='partDetail';updateDrawingModeAvailability();switchTab('drawing');renderCurrentDrawing();log('Открыт чертёж выбранного компонента.');return;}const flat=e.target.closest('[data-open-flat-pattern]');if(flat){if(!selectedSheetMetalFeature())return;state.drawingMode='flatPattern';updateDrawingModeAvailability();switchTab('drawing');renderCurrentDrawing();scheduleDrawingFit();log('Открыта развёртка листовой детали · ALPHA.');return;}const btn=e.target.closest('[data-open-assembly-drawing]');if(!btn)return;state.drawingMode='assemblyDetailed';updateDrawingModeAvailability();switchTab('drawing');renderCurrentDrawing();log('Открыт производственный сборочный чертёж.');});

function fitDrawingSheet(){const ws=$('#drawingView'),svg=$('#drawingSvg');if(!ws||!svg)return;svg.classList.add('fit-sheet');drawingNavigator.fit();requestAnimationFrame(()=>{ws.scrollTop=0;ws.scrollLeft=Math.max(0,(ws.scrollWidth-ws.clientWidth)/2);});}
function scheduleDrawingFit(){requestAnimationFrame(()=>fitDrawingSheet());}
function switchTab(name){$$('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));$$('.view').forEach(v=>v.classList.remove('active-view'));$(`#${name}View`).classList.add('active-view');const titles=isSlddrw()?{model:'SLDDRW · 2D документ',drawing:'Эталонный лист SLDDRW',dimensions:'Размеры SLDDRW',assembly:'Данные SLDDRW'}:{model:'3D модель',drawing:'Инженерный авточертёж',dimensions:'Распознанные размеры',assembly:'Состав сборки'};$('#viewTitle').textContent=titles[name];$('#modelActions').classList.toggle('hidden',name!=='model'||isSlddrw());$('#drawingActions').classList.toggle('hidden',name!=='drawing');if(name!=='drawing'&&drawingEditMode&&!isSlddrw())setDrawingEditorEnabled(false);syncDrawingEditUI();if(name==='model')viewer.draw();if(name==='drawing'&&state.rec){renderCurrentDrawing();scheduleDrawingFit();syncDrawingEditUI()}}
$$('.tab').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));
$$('[data-drawing-mode]').forEach(b=>b.addEventListener('click',()=>{state.drawingMode=b.dataset.drawingMode;$$('[data-drawing-mode]').forEach(x=>x.classList.toggle('active',x===b));if(state.rec){renderDimensions();renderCurrentDrawing();scheduleDrawingFit()}log(`Режим чертежа: ${b.textContent}.`)}));
$('#themeToggle').addEventListener('click',()=>applyTheme(document.documentElement.dataset.theme==='dark'?'light':'dark'));
function setViewerMode(mode){viewer.setMode(mode);[['solidBtn','solid'],['brepBtn','brep'],['wireBtn','wire']].forEach(([id,m])=>$('#'+id)?.classList.toggle('active',m===mode));if(mode==='brep'&&state.rec?.brep)log(`B-Rep view: ${state.rec.brep.counts?.vertices||0} V · ${state.rec.brep.counts?.edges||0} E · ${state.rec.brep.counts?.faces||0} F · ${state.rec.brep.counts?.shells||0} shell.`)}
let sectionCycle=-1;
$('#sectionBtn')?.addEventListener('click',()=>{sectionCycle=(sectionCycle+1)%4;const axis=sectionCycle<3?sectionCycle:null;viewer.setSectionAxis(axis,.5);const btn=$('#sectionBtn');if(btn){btn.classList.toggle('active',axis!=null);btn.textContent=axis==null?'◐ Разрез':`◐ Разрез ${['X','Y','Z'][axis]}`;}log(axis==null?'3D разрез выключен.':`3D half-section по ${['X','Y','Z'][axis]} · 50%.`);});
$('#fitBtn').addEventListener('click',()=>viewer.fit());$('#solidBtn').addEventListener('click',()=>setViewerMode('solid'));$('#brepBtn')?.addEventListener('click',()=>setViewerMode('brep'));$('#wireBtn').addEventListener('click',()=>setViewerMode('wire'));$('#clearLog').addEventListener('click',()=>$('#logBody').innerHTML='');const fitDrawingBtn=$('#fitDrawingBtn');if(fitDrawingBtn)fitDrawingBtn.addEventListener('click',fitDrawingSheet);
$('#fileInput').addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;await importFile(f);e.target.value=''})
$('#slddrwSheetSelect')?.addEventListener('change',e=>{state.slddrwSheetIndex=Number(e.target.value)||0;drawingRenderCache.clear();renderCurrentDrawing();renderAssembly();scheduleDrawingFit();log(`SLDDRW: открыт лист ${state.slddrwSheetIndex+1}.`);});
const drop=$('#dropZone');['dragenter','dragover'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('drag')}));['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove('drag')}));drop.addEventListener('drop',async e=>{const f=e.dataTransfer.files[0];if(f)await importFile(f)});

const editDrawingBtn=$('#editDrawingBtn');if(editDrawingBtn)editDrawingBtn.addEventListener('click',()=>setDrawingEditorEnabled(!drawingEditMode));
$$('[data-drawing-tool]').forEach(b=>b.addEventListener('click',()=>setDrawingTool(b.dataset.drawingTool)));
$('#undoDrawingBtn')?.addEventListener('click',()=>drawingEditor.undo());$('#redoDrawingBtn')?.addEventListener('click',()=>drawingEditor.redo());
$('#applyEditorText')?.addEventListener('click',()=>drawingEditor.setSelectedText($('#editorText')?.value||''));
$('#applyEditorTolerance')?.addEventListener('click',()=>drawingEditor.setTolerance($('#editorTolPlus')?.value||'',$('#editorTolMinus')?.value||''));
$('#toggleEditorVisibility')?.addEventListener('click',()=>drawingEditor.toggleVisibility());
$('#resetEditorSelected')?.addEventListener('click',()=>drawingEditor.resetSelected());
$('#makeEditorReference')?.addEventListener('click',()=>{const info=drawingEditor.selectionInfo();if(!info){log('Эталон: сначала выберите объект в режиме Правка.');return;}const ref=drawingEditor.makeSelectedReference();if(ref)log(`Эталон сохранён: ${ref.label} · ${ref.signature.role}. Правила будут использоваться для совместимых объектов.`);});
$('#addEditorNote')?.addEventListener('click',()=>drawingEditor.addNote('Примечание'));
$('#addEditorRoughness')?.addEventListener('click',()=>drawingEditor.addRoughness('Ra 3.2'));
$('#addEditorWeld')?.addEventListener('click',()=>drawingEditor.addWeld('Сварной шов'));
$('#resetDrawingEdits')?.addEventListener('click',()=>{if(confirm('Сбросить все ручные правки текущего чертежа?'))drawingEditor.resetAll()});

$('#exportBtn').addEventListener('click',()=>{if(!state.rec)return;const ref=isSlddrw()?slddrwRef():null;const report=ref?{version:APP_VERSION,generated:new Date().toISOString(),file:state.fileName,format:'SLDDRW',projectName:ref.projectName,container:ref.container,solidworksFormat:ref.version,streamCount:ref.streamCount,sheetNames:ref.sheetNames,sheets:ref.sheets,dimensions:ref.dimensions,notes:ref.notes,views:ref.views,references:ref.references,properties:ref.properties,warnings:ref.warnings}:{version:APP_VERSION,generated:new Date().toISOString(),file:state.fileName,drawingMode:state.drawingMode,counts:state.rec.counts,bounds:state.rec.bounds,dimensions:state.dimensions,boltPatterns:state.rec.boltPatterns,products:state.rec.products,occurrences:state.rec.occurrences,nativeAssembly:state.rec.nativeAssembly||null,brep:state.rec.brep||null,recognition:state.rec.recognition||null,manufacturing:state.rec.manufacturing||null};const blob=new Blob([JSON.stringify(report,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=(state.fileName||'model').replace(/\.[^.]+$/,'')+'-engineering-report.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)});
$('#exportDrawingBtn').addEventListener('click',()=>{if(!state.rec)return;renderCurrentDrawing();const svg=serializeDrawing($('#drawingSvg'));const blob=new Blob([svg],{type:'image/svg+xml;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=(state.fileName||'model').replace(/\.[^.]+$/,'')+'-drawing-'+state.drawingMode+'.svg';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);log('Чертёж экспортирован в SVG локально.');});
function esc(x){return String(x??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
initTheme();
if('serviceWorker'in navigator)navigator.serviceWorker.register(`./sw.js?v=${APP_VERSION}`,{updateViaCache:'none'}).then(reg=>{reg.update().catch(()=>{});log(`Service Worker v${APP_VERSION} активен: приложение готово к офлайн-кэшу.`)}).catch(e=>log('Service Worker: '+e.message));
log(`Build ${APP_VERSION} · ${BUILD_LABEL} готов.`);
window.addEventListener('online',()=>$('#offlineStatus').textContent='Онлайн (ядро всё равно локальное)');window.addEventListener('offline',()=>$('#offlineStatus').textContent='Оффлайн ядро');
