import {WireframeViewer} from './viewer/wireframe-viewer.js';
import {drawingFromRecognition,renderDrawing,serializeDrawing,renderNativeAssemblyDrawing} from './drawing/drawing-engine.js';

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const viewer=new WireframeViewer($('#viewerCanvas'));
viewer.onSelect=(id,name)=>{const el=$('#selectionInfo');if(el)el.textContent=id?`выбрано: ${name||'компонент'}`:'клик по детали — выбрать';};
const worker=new Worker('./import-worker.js',{type:'module'});
let state={fileName:null,fileSize:0,rec:null,dimensions:[],types:[],parseMs:0,drawingMode:'production'};

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
  log(`Импорт ${fileName}: нативный SLDASM reference scan · ${(fileSize/1024).toFixed(1)} KB.`);
  worker.postMessage({kind:'sldasm',buffer,fileName},[buffer]);
}


worker.onmessage=e=>{
  setBusy(false);if(!e.data.ok){log('Ошибка: '+e.data.error);alert(e.data.error);return}
  Object.assign(state,e.data);renderAll();
  const n=state.rec.nativeAssembly;
  log(`SLDASM готов: ${n.componentCount} позиций · ${n.occurrenceCount} вхождений · ${n.container}. Интернет не использовался.`);
  switchTab('assembly');
};

function setEmptyView(title,text){const root=$('#emptyView');root.querySelector('b').textContent=title;root.querySelector('span').textContent=text;root.style.display='grid'}
function renderAll(){
  const r=state.rec,d=state.dimensions||[],geo=r.geometryAvailable!==false;
  if(geo){viewer.setModel(r);$('#emptyView').style.display='none'}else{viewer.clear();setEmptyView('SLDASM сборка прочитана',`${r.nativeAssembly?.componentCount||0} позиций · BOM доступен во вкладке «Сборка». Нативная 3D-геометрия SLDASM пока не декодируется.`)}
  $('#exportBtn').disabled=false;
  $('#entityCount').textContent=geo?`${r.counts.entities} entities`:`${r.nativeAssembly?.componentCount||0} компонентов`;
  $('#sx').textContent=geo?fmt(r.bounds.size[0])+' mm':'—';$('#sy').textContent=geo?fmt(r.bounds.size[1])+' mm':'—';$('#sz').textContent=geo?fmt(r.bounds.size[2])+' mm':'—';
  $('#solidCount').textContent=geo?r.counts.solids:'—';$('#faceCount').textContent=geo?(r.counts.sceneFaces??r.counts.faces):'—';$('#edgeCount').textContent=geo?(r.counts.sceneEdges??r.counts.edges):'—';
  $('#unitLabel').textContent=geo?r.unit:'—';$('#unitFactor').textContent=geo?fmt(r.factor):'—';$('#cylinderCount').textContent=geo?r.counts.cylinders:'—';$('#bsplineCount').textContent=geo?r.counts.bsplines:'—';
  const conf=d.length?Math.round(d.reduce((s,x)=>s+x.confidence,0)/d.length*100):0;$('#confidence').textContent=geo?(conf+'%'):'META';
  renderTree();renderFeatures();renderDimensions();renderAssembly();updateDrawingModeAvailability();renderCurrentDrawing();$('#exportDrawingBtn').disabled=!r;
}

function renderCurrentDrawing(){
  if(!state.rec)return;
  if(state.rec.geometryAvailable===false){
    const n=state.rec.nativeAssembly;
    if(state.drawingMode==='assemblyDetailed'){
      const projectName=$('#projectName')?.textContent||state.fileName?.replace(/\.[^.]+$/,'')||n?.root||'SLDASM';
      renderNativeAssemblyDrawing($('#drawingSvg'),n,{projectName,fileName:state.fileName,theme:document.documentElement.dataset.theme});
      return;
    }
    $('#drawingSvg').setAttribute('viewBox','0 0 1200 760');$('#drawingSvg').innerHTML=`<rect width="1200" height="760" fill="${document.documentElement.dataset.theme==='dark'?'#0d1522':'#fff'}"/><g font-family="-apple-system,BlinkMacSystemFont,system-ui" text-anchor="middle"><text x="600" y="285" font-size="36" font-weight="700" fill="${document.documentElement.dataset.theme==='dark'?'#f4f7fb':'#17202b'}">SLDASM: структура сборки импортирована</text><text x="600" y="340" font-size="22" fill="#6e7781">${esc(n?.componentCount||0)} позиций · ${esc(n?.occurrenceCount||0)} вхождений</text><text x="600" y="390" font-size="18" fill="#6e7781">Для BOM-листа выберите режим «Сборочный детализированный».</text><text x="600" y="430" font-size="18" fill="#6e7781">Геометрические проекции появятся после подключения нативного SLDASM geometry decoder.</text></g>`;return;
  }
  const projectName=$('#projectName')?.textContent||state.fileName?.replace(/\.[^.]+$/,'')||'Новая модель';
  const drawing=drawingFromRecognition(state.rec,state.dimensions,{projectName,fileName:state.fileName,mode:state.drawingMode});
  renderDrawing($('#drawingSvg'),drawing,{mode:state.drawingMode,projectName,fileName:state.fileName,theme:document.documentElement.dataset.theme});
}

function updateDrawingModeAvailability(){
  const btn=document.querySelector('[data-drawing-mode="assemblyDetailed"]');if(!btn||!state.rec)return;
  const available=!!state.rec.isAssembly;btn.disabled=!available;btn.title=available?'Детализированный сборочный чертёж + BOM':'Доступно после загрузки SLDASM сборки';
  if(!available&&state.drawingMode==='assemblyDetailed'){
    state.drawingMode='production';$$('[data-drawing-mode]').forEach(x=>x.classList.toggle('active',x.dataset.drawingMode==='production'));
  }
}

function renderTree(){
  const r=state.rec,n=r.nativeAssembly;
  const rows=[['Файл',state.fileName],['Формат','SLDASM'],['Адаптер','Native Reference v0.2'],['Контейнер',n.container],['Позиций',n.componentCount],['Вхождений',n.occurrenceCount],['CFB streams',n.directoryNames?.length||0]];
  $('#treeBody').classList.remove('empty');
  $('#treeBody').innerHTML=rows.map(([a,b])=>`<div class="tree-row"><b>${esc(a)}</b><span>${esc(b)}</span></div>`).join('');
}

function renderFeatures(){
  const n=state.rec.nativeAssembly;
  $('#featureList').classList.remove('empty');
  $('#featureList').innerHTML=`<div class="feature"><i>☷</i><div>SLDASM reference map<small>${esc(n?.componentCount||0)} компонентов · офлайн</small></div><strong>OK</strong></div><div class="feature"><i>⌁</i><div>3D геометрия<small>native geometry decoder ещё не подключён</small></div><strong>—</strong></div>`;
}

function renderDimensions(){
  $('#dimensionCards').classList.add('empty');
  $('#dimensionCards').textContent='Размеры появятся после подключения нативного декодера геометрии SLDASM.';
  $('#dimensionsTable').innerHTML='<tr><td colspan="4">Структура SLDASM импортирована. Геометрические размеры пока недоступны без native geometry decoder.</td></tr>';
}

function renderAssembly(){
  const r=state.rec,root=$('#assemblyBody'),n=r.nativeAssembly,components=n.components||[];
  root.innerHTML=`<div class="assembly-head"><div><h3>${esc(n.root)} · SLDASM</h3><p class="hint">Native Reference Adapter v0.2 · ${esc(n.container)} · полностью локально</p></div><span class="adapter-badge">SLDASM</span></div><div class="assembly-grid"><section><h4>Дерево компонентов</h4><ul class="component-tree"><li><b>▾ ${esc(n.root)}</b><ul>${components.map(c=>`<li><span>${c.type==='assembly'?'▣':'◫'} ${esc(c.name)}</span><em>×${c.count}</em><small>${esc(c.file)}</small></li>`).join('')||'<li class="muted">Ссылки компонентов не извлечены из этого контейнера</li>'}</ul></li></ul></section><section><h4>BOM · ${components.length} позиций</h4><div class="bom bom-wide"><div class="head">№</div><div class="head">Компонент</div><div class="head">Кол-во</div>${components.map((c,i)=>`<div>${i+1}</div><div><b>${esc(c.name)}</b><small>${esc(c.file)} · ${c.type==='assembly'?'подсборка':'деталь'}</small></div><div>${c.count}</div>`).join('')}</div></section></div><div class="assembly-actions"><button data-open-assembly-drawing>Открыть сборочный чертёж</button></div><div class="native-note"><b>Текущий уровень:</b> SLDASM распознаётся локально, строится reference map и BOM, когда ссылки доступны в контейнере. <b>3D:</b> нативная геометрия SolidWorks пока не декодируется; для неё будет отдельный SLDASM geometry decoder.</div>`;
}


$('#assemblyBody').addEventListener('click',e=>{const comp=e.target.closest('[data-component-id]');if(comp){viewer.setSelectedComponent(comp.dataset.componentId);switchTab('model');$('#selectionInfo').textContent=`выбрано: ${comp.querySelector('span')?.textContent?.replace(/^◫\s*/,'')||'компонент'}`;log('Выбран компонент 3D: '+($('#selectionInfo').textContent.replace('выбрано: ',''))+'.');return;}const btn=e.target.closest('[data-open-assembly-drawing]');if(!btn)return;state.drawingMode='assemblyDetailed';$$('[data-drawing-mode]').forEach(x=>x.classList.toggle('active',x.dataset.drawingMode==='assemblyDetailed'));switchTab('drawing');renderCurrentDrawing();log('Открыт режим: Сборочный детализированный.');});

function switchTab(name){$$('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));$$('.view').forEach(v=>v.classList.remove('active-view'));$(`#${name}View`).classList.add('active-view');$('#viewTitle').textContent={model:'3D модель',drawing:'Инженерный авточертёж',dimensions:'Распознанные размеры',assembly:'Состав сборки'}[name];$('#modelActions').classList.toggle('hidden',name!=='model');$('#drawingActions').classList.toggle('hidden',name!=='drawing');if(name==='model')viewer.draw();if(name==='drawing'&&state.rec)renderCurrentDrawing()}
$$('.tab').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));
$$('[data-drawing-mode]').forEach(b=>b.addEventListener('click',()=>{state.drawingMode=b.dataset.drawingMode;$$('[data-drawing-mode]').forEach(x=>x.classList.toggle('active',x===b));if(state.rec)renderCurrentDrawing();log(`Режим чертежа: ${b.textContent}.`)}));
$('#themeToggle').addEventListener('click',()=>applyTheme(document.documentElement.dataset.theme==='dark'?'light':'dark'));
$('#fitBtn').addEventListener('click',()=>viewer.fit());$('#solidBtn').addEventListener('click',()=>{viewer.setMode('solid');$('#solidBtn').classList.add('active');$('#wireBtn').classList.remove('active');});$('#wireBtn').addEventListener('click',()=>{viewer.setMode('wire');$('#wireBtn').classList.add('active');$('#solidBtn').classList.remove('active');});$('#clearLog').addEventListener('click',()=>$('#logBody').innerHTML='');
$('#fileInput').addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;await importFile(f);e.target.value=''})
const drop=$('#dropZone');['dragenter','dragover'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('drag')}));['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove('drag')}));drop.addEventListener('drop',async e=>{const f=e.dataTransfer.files[0];if(f)await importFile(f)});
$('#exportBtn').addEventListener('click',()=>{if(!state.rec)return;const report={version:'0.6.2',generated:new Date().toISOString(),file:state.fileName,drawingMode:state.drawingMode,counts:state.rec.counts,bounds:state.rec.bounds,dimensions:state.dimensions,boltPatterns:state.rec.boltPatterns,products:state.rec.products,occurrences:state.rec.occurrences,nativeAssembly:state.rec.nativeAssembly||null};const blob=new Blob([JSON.stringify(report,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=(state.fileName||'model').replace(/\.[^.]+$/,'')+'-engineering-report.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)});
$('#exportDrawingBtn').addEventListener('click',()=>{if(!state.rec)return;renderCurrentDrawing();const svg=serializeDrawing($('#drawingSvg'));const blob=new Blob([svg],{type:'image/svg+xml;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=(state.fileName||'model').replace(/\.[^.]+$/,'')+'-drawing-'+state.drawingMode+'.svg';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);log('Чертёж экспортирован в SVG локально.');});
function esc(x){return String(x??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
initTheme();
if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').then(()=>log('Service Worker активен: приложение готово к офлайн-кэшу.')).catch(e=>log('Service Worker: '+e.message));
window.addEventListener('online',()=>$('#offlineStatus').textContent='Онлайн (ядро всё равно локальное)');window.addEventListener('offline',()=>$('#offlineStatus').textContent='Оффлайн ядро');
