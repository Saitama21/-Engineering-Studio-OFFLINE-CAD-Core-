import {WireframeViewer} from './viewer/wireframe-viewer.js';
import {drawingFromRecognition,renderDrawing,serializeDrawing} from './drawing/drawing-engine.js';

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const viewer=new WireframeViewer($('#viewerCanvas'));
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
  if(!['step','stp','sldasm','sldprt'].includes(ext)){alert('Import Core принимает STEP/STP и SLDASM.');return}
  if(ext==='sldprt'){
    log(`${fileName}: SLDPRT определён. Нативная геометрия детали пока не декодируется.`);
    alert('SLDPRT пока определяется, но геометрия закрытого формата SolidWorks не декодируется. Для 3D/чертежа экспортируйте деталь в STEP.');return;
  }
  setBusy(true);state.fileName=fileName;state.fileSize=fileSize;state.importKind=ext==='sldasm'?'sldasm':'step';
  $('#projectName').textContent=fileName.replace(/\.[^.]+$/,'');
  $('#fileMeta').textContent=`${fileName} · ${(fileSize/1024).toFixed(1)} KB · локально`;
  if(ext==='sldasm'){
    const buffer=await file.arrayBuffer();log(`Импорт ${fileName}: нативный SLDASM reference scan · ${(fileSize/1024).toFixed(1)} KB.`);
    worker.postMessage({kind:'sldasm',buffer,fileName},[buffer]);return;
  }
  const text=await file.text();log(`Импорт ${fileName}: ${text.length.toLocaleString('ru-RU')} символов STEP.`);worker.postMessage({kind:'step',text,fileName});
}

async function importText(text,fileName,fileSize=0){
  setBusy(true);state.fileName=fileName;state.fileSize=fileSize||text.length;state.importKind='step';
  $('#projectName').textContent=fileName.replace(/\.[^.]+$/,'');
  $('#fileMeta').textContent=`${fileName} · ${((fileSize||text.length)/1024).toFixed(1)} KB · локально`;
  log(`Импорт ${fileName}: ${text.length.toLocaleString('ru-RU')} символов STEP.`);
  worker.postMessage({kind:'step',text,fileName});
}

worker.onmessage=e=>{
  setBusy(false);if(!e.data.ok){log('Ошибка: '+e.data.error);alert(e.data.error);return}
  Object.assign(state,e.data);renderAll();
  if(state.importKind==='sldasm'){
    const n=state.rec.nativeAssembly;log(`SLDASM готов: ${n.componentCount} позиций · ${n.occurrenceCount} вхождений · ${n.container}. Интернет не использовался.`);
    switchTab('assembly');
  }else log(`Готово: ${state.rec.counts.entities} entities за ${state.parseMs.toFixed(0)} мс. Интернет не использовался.`);
};

function setEmptyView(title,text){const root=$('#emptyView');root.querySelector('b').textContent=title;root.querySelector('span').textContent=text;root.style.display='grid'}
function renderAll(){
  const r=state.rec,d=state.dimensions||[],geo=r.geometryAvailable!==false;
  if(geo){viewer.setModel(r);$('#emptyView').style.display='none'}else{viewer.clear();setEmptyView('SLDASM сборка прочитана',`${r.nativeAssembly?.componentCount||0} позиций · BOM доступен во вкладке «Сборка». Для 3D/чертежа нужен STEP.`)}
  $('#exportBtn').disabled=false;
  $('#entityCount').textContent=geo?`${r.counts.entities} entities`:`${r.nativeAssembly?.componentCount||0} компонентов`;
  $('#sx').textContent=geo?fmt(r.bounds.size[0])+' mm':'—';$('#sy').textContent=geo?fmt(r.bounds.size[1])+' mm':'—';$('#sz').textContent=geo?fmt(r.bounds.size[2])+' mm':'—';
  $('#solidCount').textContent=geo?r.counts.solids:'—';$('#faceCount').textContent=geo?r.counts.faces:'—';$('#edgeCount').textContent=geo?r.counts.edges:'—';
  $('#unitLabel').textContent=geo?r.unit:'—';$('#unitFactor').textContent=geo?fmt(r.factor):'—';$('#cylinderCount').textContent=geo?r.counts.cylinders:'—';$('#bsplineCount').textContent=geo?r.counts.bsplines:'—';
  const conf=d.length?Math.round(d.reduce((s,x)=>s+x.confidence,0)/d.length*100):0;$('#confidence').textContent=geo?(conf+'%'):'META';
  renderTree();renderFeatures();renderDimensions();renderAssembly();renderCurrentDrawing();$('#exportDrawingBtn').disabled=!geo;
}

function renderCurrentDrawing(){
  if(!state.rec)return;
  if(state.rec.geometryAvailable===false){
    const n=state.rec.nativeAssembly;$('#drawingSvg').setAttribute('viewBox','0 0 1200 760');$('#drawingSvg').innerHTML=`<rect width="1200" height="760" fill="${document.documentElement.dataset.theme==='dark'?'#0d1522':'#fff'}"/><g font-family="-apple-system,BlinkMacSystemFont,system-ui" text-anchor="middle"><text x="600" y="300" font-size="38" font-weight="700" fill="${document.documentElement.dataset.theme==='dark'?'#f4f7fb':'#17202b'}">SLDASM: структура сборки импортирована</text><text x="600" y="355" font-size="22" fill="#6e7781">${esc(n?.componentCount||0)} позиций · ${esc(n?.occurrenceCount||0)} вхождений</text><text x="600" y="405" font-size="19" fill="#6e7781">Нативный адаптер читает ссылки компонентов и BOM полностью офлайн.</text><text x="600" y="445" font-size="19" fill="#6e7781">Для геометрии B-Rep и авточертежа загрузите STEP-экспорт этой сборки.</text></g>`;return;
  }
  const projectName=$('#projectName')?.textContent||state.fileName?.replace(/\.[^.]+$/,'')||'Новая модель';
  const drawing=drawingFromRecognition(state.rec,state.dimensions,{projectName,fileName:state.fileName,mode:state.drawingMode});
  renderDrawing($('#drawingSvg'),drawing,{mode:state.drawingMode,projectName,fileName:state.fileName,theme:document.documentElement.dataset.theme});
}

function renderTree(){
  const r=state.rec;if(r.geometryAvailable===false){const n=r.nativeAssembly;const rows=[['Файл',state.fileName],['Формат','SLDASM'],['Адаптер','Native Reference v0.1'],['Контейнер',n.container],['Позиций',n.componentCount],['Вхождений',n.occurrenceCount],['CFB streams',n.directoryNames?.length||0]];$('#treeBody').classList.remove('empty');$('#treeBody').innerHTML=rows.map(([a,b])=>`<div class="tree-row"><b>${esc(a)}</b><span>${esc(b)}</span></div>`).join('');return}
  const rows=[['Файл',state.fileName],['PRODUCT',r.products.length],['Тела',r.counts.solids],['Оболочки',r.counts.shells],['Грани',r.counts.faces],['Рёбра',r.counts.edges],['Вершины',r.counts.vertices],['Плоскости',r.counts.planes],['Цилиндры',r.counts.cylinders],['Конусы',r.counts.cones],['Торы',r.counts.tori],['B-Spline',r.counts.bsplines]];$('#treeBody').classList.remove('empty');$('#treeBody').innerHTML=rows.map(([a,b])=>`<div class="tree-row"><b>${esc(a)}</b><span>${esc(b)}</span></div>`).join('')
}
function renderFeatures(){const r=state.rec;if(r.geometryAvailable===false){$('#featureList').classList.remove('empty');$('#featureList').innerHTML=`<div class="feature"><i>☷</i><div>SLDASM reference map<small>${esc(r.nativeAssembly?.componentCount||0)} компонентов · офлайн</small></div><strong>OK</strong></div><div class="feature"><i>⌁</i><div>B-Rep геометрия<small>нужен STEP-экспорт</small></div><strong>—</strong></div>`;return}const f=[];for(const dia of r.radii.slice().sort((a,b)=>b-a))f.push(['◎',`Цилиндр Ø${fmt(dia*2)}`,'точная поверхность']);for(const p of r.boltPatterns)f.push(['✣',`${p.count}×Ø${fmt(p.holeDiameter)} · PCD Ø${fmt(p.pcd)}`,'распознано']);if(r.counts.cones)f.push(['△',`${r.counts.cones} конич. поверхн.`,'STEP surface']);if(r.counts.planes)f.push(['▱',`${r.counts.planes} плоскостей`,'STEP surface']);$('#featureList').classList.toggle('empty',!f.length);$('#featureList').innerHTML=f.length?f.slice(0,18).map(x=>`<div class="feature"><i>${x[0]}</i><div>${esc(x[1])}<small>${esc(x[2])}</small></div><strong>OK</strong></div>`).join(''):'Геометрические признаки не найдены.'}
function renderDimensions(){const d=state.dimensions||[];if(state.rec?.geometryAvailable===false){$('#dimensionCards').classList.add('empty');$('#dimensionCards').textContent='SLDASM: размеры появятся после загрузки STEP-геометрии.';$('#dimensionsTable').innerHTML='<tr><td colspan="4">Нативный SLDASM-адаптер импортировал структуру сборки. B-Rep размеры требуют STEP.</td></tr>';return}$('#dimensionCards').classList.toggle('empty',!d.length);$('#dimensionCards').innerHTML=d.length?d.slice(0,12).map(x=>`<div class="dim-card"><strong>${esc(x.label)}</strong><small>${x.type} · ${Math.round(x.confidence*100)}%</small></div>`).join(''):'Размеры не распознаны.';$('#dimensionsTable').innerHTML=d.map(x=>`<tr><td>${esc(x.type)}</td><td><b>${esc(x.label)}</b></td><td>${fmt(x.value)} ${esc(x.unit)}</td><td>${Math.round(x.confidence*100)}%</td></tr>`).join('')}
function renderAssembly(){
  const r=state.rec,root=$('#assemblyBody');if(!r.isAssembly){root.innerHTML=`<h3>Одиночная деталь</h3><p>PRODUCT: <b>${esc(r.products[0]?.name||state.fileName||'—')}</b></p><p class="hint">Загрузите STEP-сборку или SLDASM: здесь будет дерево компонентов и BOM.</p>`;return}
  if(r.geometryAvailable===false){
    const n=r.nativeAssembly,components=n.components||[];
    root.innerHTML=`<div class="assembly-head"><div><h3>${esc(n.root)} · SLDASM</h3><p class="hint">Native Reference Adapter v0.1 · ${esc(n.container)} · полностью локально</p></div><span class="adapter-badge">SLDASM</span></div><div class="assembly-grid"><section><h4>Дерево компонентов</h4><ul class="component-tree"><li><b>▾ ${esc(n.root)}</b><ul>${components.map(c=>`<li><span>${c.type==='assembly'?'▣':'◫'} ${esc(c.name)}</span><em>×${c.count}</em><small>${esc(c.file)}</small></li>`).join('')||'<li class="muted">Ссылки компонентов не найдены</li>'}</ul></li></ul></section><section><h4>BOM · ${components.length} позиций</h4><div class="bom bom-wide"><div class="head">№</div><div class="head">Компонент</div><div class="head">Кол-во</div>${components.map((c,i)=>`<div>${i+1}</div><div><b>${esc(c.name)}</b><small>${esc(c.file)} · ${c.type==='assembly'?'подсборка':'деталь'}</small></div><div>${c.count}</div>`).join('')}</div></section></div><div class="native-note"><b>Что уже работает:</b> чтение SLDASM как OLE/CFB, поиск ссылок SLDPRT/SLDASM, распознавание экземпляров и формирование BOM. <b>Ограничение:</b> это эвристический reference-level импорт; закрытая B-Rep геометрия SolidWorks пока не декодируется. Для 3D и авточертежа используйте STEP.</div>`;return
  }
  const occ=r.occurrences;const groups=[...occ.reduce((m,o)=>{const k=o.child||o.name||o.id;const g=m.get(k)||{name:o.name||('Component '+o.id),count:0};g.count++;m.set(k,g);return m},new Map()).values()];root.innerHTML=`<h3>STEP-сборка · ${occ.length} вхождений · ${groups.length} позиций</h3><p class="hint">Количество извлечено из PRODUCT / NEXT_ASSEMBLY_USAGE_OCCURRENCE.</p><div class="bom"><div class="head">№</div><div class="head">Компонент</div><div class="head">Кол-во</div>${groups.map((o,i)=>`<div>${i+1}</div><div>${esc(o.name)}</div><div>${o.count}</div>`).join('')}</div>`
}

function switchTab(name){$$('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));$$('.view').forEach(v=>v.classList.remove('active-view'));$(`#${name}View`).classList.add('active-view');$('#viewTitle').textContent={model:'3D модель',drawing:'Инженерный авточертёж',dimensions:'Распознанные размеры',assembly:'Состав сборки'}[name];$('#modelActions').classList.toggle('hidden',name!=='model');$('#drawingActions').classList.toggle('hidden',name!=='drawing');if(name==='model')viewer.draw();if(name==='drawing'&&state.rec)renderCurrentDrawing()}
$$('.tab').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));
$$('[data-drawing-mode]').forEach(b=>b.addEventListener('click',()=>{state.drawingMode=b.dataset.drawingMode;$$('[data-drawing-mode]').forEach(x=>x.classList.toggle('active',x===b));if(state.rec)renderCurrentDrawing();log(`Режим чертежа: ${b.textContent}.`)}));
$('#themeToggle').addEventListener('click',()=>applyTheme(document.documentElement.dataset.theme==='dark'?'light':'dark'));
$('#fitBtn').addEventListener('click',()=>viewer.fit());$('#wireBtn').addEventListener('click',()=>viewer.draw());$('#clearLog').addEventListener('click',()=>$('#logBody').innerHTML='');
$('#fileInput').addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;await importFile(f);e.target.value=''})
const drop=$('#dropZone');['dragenter','dragover'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('drag')}));['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove('drag')}));drop.addEventListener('drop',async e=>{const f=e.dataTransfer.files[0];if(f)await importFile(f)});
$$('[data-sample]').forEach(b=>b.addEventListener('click',async()=>{const url=b.dataset.sample;const res=await fetch(url);const text=await res.text();importText(text,url.split('/').pop(),text.length)}));
$('#exportBtn').addEventListener('click',()=>{if(!state.rec)return;const report={version:'0.4.1',generated:new Date().toISOString(),file:state.fileName,drawingMode:state.drawingMode,counts:state.rec.counts,bounds:state.rec.bounds,dimensions:state.dimensions,boltPatterns:state.rec.boltPatterns,products:state.rec.products,occurrences:state.rec.occurrences,nativeAssembly:state.rec.nativeAssembly||null};const blob=new Blob([JSON.stringify(report,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=(state.fileName||'model').replace(/\.[^.]+$/,'')+'-engineering-report.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)});
$('#exportDrawingBtn').addEventListener('click',()=>{if(!state.rec)return;renderCurrentDrawing();const svg=serializeDrawing($('#drawingSvg'));const blob=new Blob([svg],{type:'image/svg+xml;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=(state.fileName||'model').replace(/\.[^.]+$/,'')+'-drawing-'+state.drawingMode+'.svg';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);log('Чертёж экспортирован в SVG локально.');});
function esc(x){return String(x??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
initTheme();
if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').then(()=>log('Service Worker активен: приложение готово к офлайн-кэшу.')).catch(e=>log('Service Worker: '+e.message));
window.addEventListener('online',()=>$('#offlineStatus').textContent='Онлайн (ядро всё равно локальное)');window.addEventListener('offline',()=>$('#offlineStatus').textContent='Оффлайн ядро');
