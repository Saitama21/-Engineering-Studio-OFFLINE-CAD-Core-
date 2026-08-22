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
function setBusy(on){$('#fileInput').disabled=on;$('#offlineStatus').textContent=on?'Разбираю B-Rep…':'Оффлайн ядро';document.body.classList.toggle('busy',on)}

async function importText(text,fileName,fileSize=0){
  const ext=(fileName.split('.').pop()||'').toLowerCase();
  if(ext==='sldprt'||ext==='sldasm'){
    log(`${fileName}: обнаружен родной SolidWorks. Нативное декодирование ещё не включено.`);
    alert('Родной SLDPRT/SLDASM пока не декодируется офлайн. Экспортируйте модель/сборку из SolidWorks в STEP (.step/.stp) — это ядро уже читает STEP локально.');
    return;
  }
  if(!['step','stp'].includes(ext)){alert('Сейчас Import Core принимает STEP/STP.');return}
  setBusy(true); state.fileName=fileName;state.fileSize=fileSize;$('#projectName').textContent=fileName.replace(/\.[^.]+$/,'');$('#fileMeta').textContent=`${fileName} · ${(fileSize/1024).toFixed(1)} KB · локально`;
  log(`Импорт ${fileName}: ${text.length.toLocaleString('ru-RU')} символов STEP.`); worker.postMessage({text,fileName});
}

worker.onmessage=e=>{setBusy(false);if(!e.data.ok){log('Ошибка: '+e.data.error);alert(e.data.error);return}Object.assign(state,e.data);renderAll();log(`Готово: ${state.rec.counts.entities} entities за ${state.parseMs.toFixed(0)} мс. Интернет не использовался.`)};

function renderAll(){
  const r=state.rec,d=state.dimensions;viewer.setModel(r);$('#emptyView').style.display='none';$('#exportBtn').disabled=false;
  $('#entityCount').textContent=`${r.counts.entities} entities`;$('#sx').textContent=fmt(r.bounds.size[0])+' mm';$('#sy').textContent=fmt(r.bounds.size[1])+' mm';$('#sz').textContent=fmt(r.bounds.size[2])+' mm';$('#solidCount').textContent=r.counts.solids;$('#faceCount').textContent=r.counts.faces;$('#edgeCount').textContent=r.counts.edges;$('#unitLabel').textContent=r.unit;$('#unitFactor').textContent=fmt(r.factor);$('#cylinderCount').textContent=r.counts.cylinders;$('#bsplineCount').textContent=r.counts.bsplines;
  const conf=d.length?Math.round(d.reduce((s,x)=>s+x.confidence,0)/d.length*100):0;$('#confidence').textContent=conf+'%';
  renderTree();renderFeatures();renderDimensions();renderAssembly();renderCurrentDrawing();$('#exportDrawingBtn').disabled=false;
}

function renderCurrentDrawing(){
  if(!state.rec)return;
  const projectName=$('#projectName')?.textContent||state.fileName?.replace(/\.[^.]+$/,'')||'Новая модель';
  const drawing=drawingFromRecognition(state.rec,state.dimensions,{projectName,fileName:state.fileName,mode:state.drawingMode});
  renderDrawing($('#drawingSvg'),drawing,{mode:state.drawingMode,projectName,fileName:state.fileName,theme:document.documentElement.dataset.theme});
}

function renderTree(){const r=state.rec;const rows=[['Файл',state.fileName],['PRODUCT',r.products.length],['Тела',r.counts.solids],['Оболочки',r.counts.shells],['Грани',r.counts.faces],['Рёбра',r.counts.edges],['Вершины',r.counts.vertices],['Плоскости',r.counts.planes],['Цилиндры',r.counts.cylinders],['Конусы',r.counts.cones],['Торы',r.counts.tori],['B-Spline',r.counts.bsplines]];$('#treeBody').classList.remove('empty');$('#treeBody').innerHTML=rows.map(([a,b])=>`<div class="tree-row"><b>${esc(a)}</b><span>${esc(b)}</span></div>`).join('')}
function renderFeatures(){const r=state.rec;const f=[];for(const dia of r.radii.slice().sort((a,b)=>b-a))f.push(['◎',`Цилиндр Ø${fmt(dia*2)}`,'точная поверхность']);for(const p of r.boltPatterns)f.push(['✣',`${p.count}×Ø${fmt(p.holeDiameter)} · PCD Ø${fmt(p.pcd)}`,'распознано']);if(r.counts.cones)f.push(['△',`${r.counts.cones} конич. поверхн.`,'STEP surface']);if(r.counts.planes)f.push(['▱',`${r.counts.planes} плоскостей`,'STEP surface']);$('#featureList').classList.toggle('empty',!f.length);$('#featureList').innerHTML=f.length?f.slice(0,18).map(x=>`<div class="feature"><i>${x[0]}</i><div>${esc(x[1])}<small>${esc(x[2])}</small></div><strong>OK</strong></div>`).join(''):'Геометрические признаки не найдены.'}
function renderDimensions(){const d=state.dimensions;$('#dimensionCards').classList.toggle('empty',!d.length);$('#dimensionCards').innerHTML=d.length?d.slice(0,12).map(x=>`<div class="dim-card"><strong>${esc(x.label)}</strong><small>${x.type} · ${Math.round(x.confidence*100)}%</small></div>`).join(''):'Размеры не распознаны.';$('#dimensionsTable').innerHTML=d.map(x=>`<tr><td>${esc(x.type)}</td><td><b>${esc(x.label)}</b></td><td>${fmt(x.value)} ${esc(x.unit)}</td><td>${Math.round(x.confidence*100)}%</td></tr>`).join('')}
function renderAssembly(){const r=state.rec,root=$('#assemblyBody');if(r.isAssembly){const occ=r.occurrences;const groups=[...occ.reduce((m,o)=>{const k=o.child||o.name||o.id;const g=m.get(k)||{name:o.name||('Component '+o.id),count:0};g.count++;m.set(k,g);return m},new Map()).values()];root.innerHTML=`<h3>Сборка · ${occ.length} вхождений · ${groups.length} позиций</h3><p class="hint">Количество извлечено из PRODUCT / NEXT_ASSEMBLY_USAGE_OCCURRENCE.</p><div class="bom"><div class="head">№</div><div class="head">Компонент</div><div class="head">Кол-во</div>${groups.map((o,i)=>`<div>${i+1}</div><div>${esc(o.name)}</div><div>${o.count}</div>`).join('')}</div>`}else{root.innerHTML=`<h3>Одиночная деталь</h3><p>PRODUCT: <b>${esc(r.products[0]?.name||state.fileName||'—')}</b></p><p class="hint">Для STEP-сборки здесь появится дерево компонентов и BOM. Нативный SLDASM-адаптер — следующий импортный модуль.</p>`}}

function switchTab(name){$$('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));$$('.view').forEach(v=>v.classList.remove('active-view'));$(`#${name}View`).classList.add('active-view');$('#viewTitle').textContent={model:'3D модель',drawing:'Инженерный авточертёж',dimensions:'Распознанные размеры',assembly:'Состав сборки'}[name];$('#modelActions').classList.toggle('hidden',name!=='model');$('#drawingActions').classList.toggle('hidden',name!=='drawing');if(name==='model')viewer.draw();if(name==='drawing'&&state.rec)renderCurrentDrawing()}
$$('.tab').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));
$$('[data-drawing-mode]').forEach(b=>b.addEventListener('click',()=>{state.drawingMode=b.dataset.drawingMode;$$('[data-drawing-mode]').forEach(x=>x.classList.toggle('active',x===b));if(state.rec)renderCurrentDrawing();log(`Режим чертежа: ${b.textContent}.`)}));
$('#themeToggle').addEventListener('click',()=>applyTheme(document.documentElement.dataset.theme==='dark'?'light':'dark'));
$('#fitBtn').addEventListener('click',()=>viewer.fit());$('#wireBtn').addEventListener('click',()=>viewer.draw());$('#clearLog').addEventListener('click',()=>$('#logBody').innerHTML='');
$('#fileInput').addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;await importText(await f.text(),f.name,f.size);e.target.value=''})
const drop=$('#dropZone');['dragenter','dragover'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('drag')}));['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove('drag')}));drop.addEventListener('drop',async e=>{const f=e.dataTransfer.files[0];if(f)await importText(await f.text(),f.name,f.size)});
$$('[data-sample]').forEach(b=>b.addEventListener('click',async()=>{const url=b.dataset.sample;const res=await fetch(url);const text=await res.text();importText(text,url.split('/').pop(),text.length)}));
$('#exportBtn').addEventListener('click',()=>{if(!state.rec)return;const report={version:'0.4.0',generated:new Date().toISOString(),file:state.fileName,drawingMode:state.drawingMode,counts:state.rec.counts,bounds:state.rec.bounds,dimensions:state.dimensions,boltPatterns:state.rec.boltPatterns,products:state.rec.products,occurrences:state.rec.occurrences};const blob=new Blob([JSON.stringify(report,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=(state.fileName||'model').replace(/\.[^.]+$/,'')+'-engineering-report.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)});
$('#exportDrawingBtn').addEventListener('click',()=>{if(!state.rec)return;renderCurrentDrawing();const svg=serializeDrawing($('#drawingSvg'));const blob=new Blob([svg],{type:'image/svg+xml;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=(state.fileName||'model').replace(/\.[^.]+$/,'')+'-drawing-'+state.drawingMode+'.svg';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);log('Чертёж экспортирован в SVG локально.');});
function esc(x){return String(x??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
initTheme();
if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').then(()=>log('Service Worker активен: приложение готово к офлайн-кэшу.')).catch(e=>log('Service Worker: '+e.message));
window.addEventListener('online',()=>$('#offlineStatus').textContent='Онлайн (ядро всё равно локальное)');window.addEventListener('offline',()=>$('#offlineStatus').textContent='Оффлайн ядро');
