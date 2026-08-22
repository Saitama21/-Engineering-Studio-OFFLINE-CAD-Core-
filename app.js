import {WireframeViewer} from './viewer/wireframe-viewer.js';
import {drawingFromRecognition,renderDrawing,serializeDrawing,renderNativeAssemblyDrawing} from './drawing/drawing-engine.js';
import {renderTessRecognitionDrawing} from './drawing/tess-recognition-drawing.js';
import {renderAssemblyProductionSheet,renderComponentProductionSheet} from './drawing/assembly-production-sheet-v100.js';

const APP_VERSION='1.0.3';
const BUILD_LABEL='PRODUCTION DRAWING CORE';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const viewer=new WireframeViewer($('#viewerCanvas'));
viewer.onSelect=(id,instance)=>{state.selectedComponentId=id||null;state.selectedComponentName=instance?.name||'';const el=$('#selectionInfo');if(el)el.textContent=id?`выбрано: ${instance?.name||'компонент'}`:'клик по детали — выбрать';updateDrawingModeAvailability();};
const worker=new Worker('./import-worker.js',{type:'module'});
let state={fileName:null,fileSize:0,rec:null,dimensions:[],types:[],parseMs:0,drawingMode:'production',selectedComponentId:null,selectedComponentName:''};

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
  log(`Импорт ${fileName}: SLDASM Production Drawing decoder · ${(fileSize/1024).toFixed(1)} KB.`);
  worker.postMessage({kind:'sldasm',buffer,fileName},[buffer]);
}


worker.onmessage=e=>{
  setBusy(false);if(!e.data.ok){const where=e.data.stage?` [${e.data.stage}]`:'';log('Ошибка'+where+': '+e.data.error);console.error('SLDASM worker error',e.data);alert(`Ошибка импорта${where}: ${e.data.error}`);return}
  Object.assign(state,e.data);renderAll();
  const n=state.rec.nativeAssembly;
  if(n?.root)$('#projectName').textContent=n.root;
  const geo=state.rec.geometryAvailable!==false;
  log(`SLDASM готов: ${n.componentCount} позиций · ${n.occurrenceCount} вхождений · ${n.faceBlocks||0} tess-блоков · ${n.triangles||0} треугольников. Распознано: ${state.rec.recognition?.counts?.planes||0} плоскостей · ${state.rec.recognition?.counts?.cylinders||0} цилиндров · ${state.rec.recognition?.counts?.holes||0} отверстий. Интернет не использовался.`);
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
  $('#unitLabel').textContent=geo?r.unit:'—';$('#unitFactor').textContent=geo?fmt(r.factor):'—';$('#cylinderCount').textContent=geo?(r.recognition?.counts?.cylinders??0):'—';$('#bsplineCount').textContent=geo?(r.recognition?.counts?.holes??0):'—';
  const conf=r.recognition?Math.round((r.recognition.confidence||0)*100):(d.length?Math.round(d.reduce((s,x)=>s+x.confidence,0)/d.length*100):0);$('#confidence').textContent=geo?(conf+'% TESS'):'META';
  if(geo)$('#selectionInfo').textContent=`TESS Recognition · ${r.recognition?.counts?.cylinders||0} цилиндров · ${r.recognition?.counts?.holes||0} отверстий`;renderTree();renderFeatures();renderDimensions();renderAssembly();updateDrawingModeAvailability();renderCurrentDrawing();$('#exportDrawingBtn').disabled=!r;
}

function renderCurrentDrawing(){
  if(!state.rec)return;
  const r=state.rec,n=r.nativeAssembly;
  if(state.drawingMode==='assemblyDetailed'){
    const projectName=$('#projectName')?.textContent||state.fileName?.replace(/\.[^.]+$/,'')||n?.root||'SLDASM';
    if(r.tessellation?.mode==='triangle-strips'&&r.recognition) renderAssemblyProductionSheet($('#drawingSvg'),r,{projectName,fileName:state.fileName,theme:document.documentElement.dataset.theme});
    else renderNativeAssemblyDrawing($('#drawingSvg'),n,{projectName,fileName:state.fileName,theme:document.documentElement.dataset.theme});
    return;
  }
  if(state.drawingMode==='partDetail'){
    renderComponentProductionSheet($('#drawingSvg'),r,{componentId:state.selectedComponentId,componentName:state.selectedComponentName||'Выбранная деталь',fileName:state.fileName,theme:document.documentElement.dataset.theme});
    return;
  }
  if(r.tessellation?.mode==='triangle-strips'&&r.recognition){
    const projectName=$('#projectName')?.textContent||state.fileName?.replace(/\.[^.]+$/,'')||n?.root||'SLDASM';
    renderTessRecognitionDrawing($('#drawingSvg'),r,{projectName,fileName:state.fileName,theme:document.documentElement.dataset.theme,mode:state.drawingMode});
    return;
  }
  $('#drawingSvg').setAttribute('viewBox','0 0 1200 760');$('#drawingSvg').innerHTML=`<rect width="1200" height="760" fill="${document.documentElement.dataset.theme==='dark'?'#0d1522':'#fff'}"/><g font-family="-apple-system,BlinkMacSystemFont,system-ui" text-anchor="middle"><text x="600" y="285" font-size="36" font-weight="700" fill="${document.documentElement.dataset.theme==='dark'?'#f4f7fb':'#17202b'}">SLDASM: структура сборки импортирована</text><text x="600" y="340" font-size="22" fill="#6e7781">${esc(n?.componentCount||0)} позиций · ${esc(n?.occurrenceCount||0)} вхождений</text><text x="600" y="400" font-size="18" fill="#6e7781">Встроенная FaceTessellations-геометрия в этом файле не найдена.</text></g>`;
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
  const rows=[['Файл',state.fileName],['Формат','SLDASM'],['Адаптер','Production Drawing v1.0.3'],['Контейнер',n.container],['Streams',n.streamCount||0],['Позиций',n.componentCount],['Вхождений',n.occurrenceCount],['Tess-блоков',n.faceBlocks||0],['Исходных треуг.',n.sourceTriangles||0],['Сценовых треуг.',n.triangles||0],...(r.counts.displayTriangles&&r.counts.displayTriangles!==r.counts.triangles?[['3D LOD',r.counts.displayTriangles],['Передача','Stack-safe']]:[]),['Размещено',n.mappedOccurrences||0]];
  $('#treeBody').classList.remove('empty');
  $('#treeBody').innerHTML=rows.map(([a,b])=>`<div class="tree-row"><b>${esc(a)}</b><span>${esc(b)}</span></div>`).join('');
}


function renderFeatures(){
  const r=state.rec,n=r.nativeAssembly,geo=r.geometryAvailable!==false;
  $('#featureList').classList.remove('empty');
  const G=r.recognition;
  $('#featureList').innerHTML=`<div class="feature"><i>☷</i><div>SLDASM component tree<small>${esc(n?.componentCount||0)} позиций · ${esc(n?.occurrenceCount||0)} вхождений</small></div><strong>OK</strong></div><div class="feature"><i>△</i><div>3D FaceTessellations + transforms<small>${geo?`${esc(n?.mappedOccurrences||0)} вхождений · ${esc(n?.triangles||0)} треугольников`:'встроенная тесселяция не найдена'}</small></div><strong>${geo?'OK':'—'}</strong></div><div class="feature"><i>◉</i><div>Tess Geometry Recognition<small>${G?`${esc(G.counts.planes)} плоск. · ${esc(G.counts.cylinders)} цилиндр. · ${esc(G.counts.holes)} отверст.`:'ожидает 3D mesh'}</small></div><strong>${G?'OK':'—'}</strong></div><div class="feature"><i>▱</i><div>Production Drawing Layout<small>${G?'эталонная компоновка · A–A/B–B · C/D · позиции · BOM':'ожидает распознавание геометрии'}</small></div><strong>${G?'OK':'—'}</strong></div><div class="feature"><i>◎</i><div>Точный B-Rep<small>Parasolid topology ещё не декодируется; TESS-размеры требуют VERIFY</small></div><strong>—</strong></div>`;
}


function dimensionSymbol(x){
  const label=String(x?.label||'');
  if(label.startsWith('Ø')||x?.source==='TESS_CYLINDER')return 'Ø';
  if(label.startsWith('L')||x?.source==='TESS_CYLINDER_LENGTH')return 'L';
  return ['X','Y','Z'].includes(label)?label:'';
}
function dimensionSourceLabel(x){return x.source==='TESS_CYLINDER'?'распознано: цилиндр':x.source==='TESS_CYLINDER_LENGTH'?'распознано: длина':'габарит TESS'}
function renderDimensions(){
  const r=state.rec,d=state.dimensions||[];
  if(r.geometryAvailable!==false&&d.length){
    $('#dimensionCards').classList.remove('empty');
    $('#dimensionCards').innerHTML=d.map(x=>{const sym=dimensionSymbol(x),value=`${sym?`${sym} `:''}${fmt(x.value)} ${esc(x.unit||'mm')}`;return `<div class="dim-card"><span>${esc(x.type||x.label)}</span><b>${value}</b><small>${esc(dimensionSourceLabel(x))}</small></div>`}).join('');
    $('#dimensionsTable').innerHTML=d.map(x=>{const sym=dimensionSymbol(x);return `<tr><td>${esc(x.type)}</td><td>${esc(sym||x.label)}</td><td>${fmt(x.value)} ${esc(x.unit||'mm')}</td><td>${Math.round((x.confidence||0)*100)}% · ${esc(x.source||'TESS')}</td></tr>`}).join('');
  }else{
    $('#dimensionCards').classList.add('empty');$('#dimensionCards').textContent='Встроенная геометрия не найдена — габариты недоступны.';
    $('#dimensionsTable').innerHTML='<tr><td colspan="4">v1.0.3 строит производственный сборочный лист и чертёж выбранной детали из FaceTessellations. TESS-размеры требуют VERIFY.</td></tr>';
  }
}


function renderAssembly(){
  const r=state.rec,root=$('#assemblyBody'),n=r.nativeAssembly,components=n.components||[],geo=r.geometryAvailable!==false;
  root.innerHTML=`<div class="assembly-head"><div><h3>${esc(n.root)} · SLDASM</h3><p class="hint">Production Drawing Core v1.0.3 · ${esc(n.container)} · полностью локально</p></div><span class="adapter-badge">SLDASM</span></div><div class="assembly-grid"><section><h4>Дерево компонентов</h4><ul class="component-tree"><li><b>▾ ${esc(n.root)}</b><ul>${components.map(c=>`<li ${c.instances?.[0]?`data-component-id="${esc(c.instances[0])}" data-component-name="${esc(c.name)}" class="selectable-component"`:''}><span>${c.type==='assembly'?'▣':'◫'} ${esc(c.name)}</span><em>×${c.count}</em><small>${esc(c.file)}</small></li>`).join('')||'<li class="muted">Компоненты не извлечены из этого контейнера</li>'}</ul></li></ul></section><section><h4>BOM · ${components.length} позиций</h4><div class="bom bom-wide"><div class="head">№</div><div class="head">Компонент</div><div class="head">Кол-во</div>${components.map((c,i)=>`<div>${i+1}</div><div><b>${esc(c.name)}</b><small>${esc(c.file)} · ${c.type==='assembly'?'подсборка':'деталь'}</small></div><div>${c.count}</div>`).join('')}</div></section></div><div class="assembly-actions"><button data-open-assembly-drawing>Открыть производственный сборочный чертёж</button><button data-open-part-drawing ${state.selectedComponentId?'':'disabled'}>Чертёж выбранной детали</button></div><div class="native-note"><b>v1.0.3:</b> структура/BOM читаются из нативных потоков SLDASM. <b>3D:</b> ${geo?`собрано из FaceTessellations с матрицами вхождений (${esc(n.mappedOccurrences||0)} размещено / ${esc(n.triangles||0)} треугольников сцены).`:'встроенная тесселяция в файле не найдена.'} Производственный Drawing Core строит чистые проекции, секущие виды, позиции и спецификацию. Точный Parasolid B-Rep пока не декодируется.</div>`;
}



$('#assemblyBody').addEventListener('click',e=>{const comp=e.target.closest('[data-component-id]');if(comp){viewer.setSelectedComponent(comp.dataset.componentId);state.selectedComponentId=comp.dataset.componentId;state.selectedComponentName=comp.dataset.componentName||comp.querySelector('span')?.textContent?.replace(/^[◫▣]\s*/,'')||'компонент';updateDrawingModeAvailability();switchTab('model');$('#selectionInfo').textContent=`выбрано: ${state.selectedComponentName}`;log('Выбран компонент 3D: '+state.selectedComponentName+'.');return;}const part=e.target.closest('[data-open-part-drawing]');if(part){if(!state.selectedComponentId)return;state.drawingMode='partDetail';updateDrawingModeAvailability();switchTab('drawing');renderCurrentDrawing();log('Открыт чертёж выбранной детали.');return;}const btn=e.target.closest('[data-open-assembly-drawing]');if(!btn)return;state.drawingMode='assemblyDetailed';updateDrawingModeAvailability();switchTab('drawing');renderCurrentDrawing();log('Открыт производственный сборочный чертёж.');});

function switchTab(name){$$('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));$$('.view').forEach(v=>v.classList.remove('active-view'));$(`#${name}View`).classList.add('active-view');$('#viewTitle').textContent={model:'3D модель',drawing:'Инженерный авточертёж',dimensions:'Распознанные размеры',assembly:'Состав сборки'}[name];$('#modelActions').classList.toggle('hidden',name!=='model');$('#drawingActions').classList.toggle('hidden',name!=='drawing');if(name==='model')viewer.draw();if(name==='drawing'&&state.rec)renderCurrentDrawing()}
$$('.tab').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));
$$('[data-drawing-mode]').forEach(b=>b.addEventListener('click',()=>{state.drawingMode=b.dataset.drawingMode;$$('[data-drawing-mode]').forEach(x=>x.classList.toggle('active',x===b));if(state.rec)renderCurrentDrawing();log(`Режим чертежа: ${b.textContent}.`)}));
$('#themeToggle').addEventListener('click',()=>applyTheme(document.documentElement.dataset.theme==='dark'?'light':'dark'));
$('#fitBtn').addEventListener('click',()=>viewer.fit());$('#solidBtn').addEventListener('click',()=>{viewer.setMode('solid');$('#solidBtn').classList.add('active');$('#wireBtn').classList.remove('active');});$('#wireBtn').addEventListener('click',()=>{viewer.setMode('wire');$('#wireBtn').classList.add('active');$('#solidBtn').classList.remove('active');});$('#clearLog').addEventListener('click',()=>$('#logBody').innerHTML='');
$('#fileInput').addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;await importFile(f);e.target.value=''})
const drop=$('#dropZone');['dragenter','dragover'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('drag')}));['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove('drag')}));drop.addEventListener('drop',async e=>{const f=e.dataTransfer.files[0];if(f)await importFile(f)});
$('#exportBtn').addEventListener('click',()=>{if(!state.rec)return;const report={version:APP_VERSION,generated:new Date().toISOString(),file:state.fileName,drawingMode:state.drawingMode,counts:state.rec.counts,bounds:state.rec.bounds,dimensions:state.dimensions,boltPatterns:state.rec.boltPatterns,products:state.rec.products,occurrences:state.rec.occurrences,nativeAssembly:state.rec.nativeAssembly||null,recognition:state.rec.recognition||null};const blob=new Blob([JSON.stringify(report,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=(state.fileName||'model').replace(/\.[^.]+$/,'')+'-engineering-report.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)});
$('#exportDrawingBtn').addEventListener('click',()=>{if(!state.rec)return;renderCurrentDrawing();const svg=serializeDrawing($('#drawingSvg'));const blob=new Blob([svg],{type:'image/svg+xml;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=(state.fileName||'model').replace(/\.[^.]+$/,'')+'-drawing-'+state.drawingMode+'.svg';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);log('Чертёж экспортирован в SVG локально.');});
function esc(x){return String(x??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
initTheme();
if('serviceWorker'in navigator)navigator.serviceWorker.register(`./sw.js?v=${APP_VERSION}`,{updateViaCache:'none'}).then(reg=>{reg.update().catch(()=>{});log(`Service Worker v${APP_VERSION} активен: приложение готово к офлайн-кэшу.`)}).catch(e=>log('Service Worker: '+e.message));
log(`Build ${APP_VERSION} · ${BUILD_LABEL} готов.`);
window.addEventListener('online',()=>$('#offlineStatus').textContent='Онлайн (ядро всё равно локальное)');window.addEventListener('offline',()=>$('#offlineStatus').textContent='Оффлайн ядро');
