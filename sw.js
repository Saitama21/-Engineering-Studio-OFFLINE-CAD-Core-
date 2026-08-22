const CACHE='rozfood-engineering-studio-v1.0.3-large-assembly-transport-safe';
const ASSETS=[
  './','./index.html','./styles.css?v=1.0.3','./app.js?v=1.0.3','./import-worker.js',
  './import/sldasm-adapter.js','./core/tess-recognition.js','./core/math3d.js',
  './drawing/drawing-engine.js','./drawing/tess-recognition-drawing.js','./drawing/assembly-production-sheet-v100.js',
  './viewer/wireframe-viewer.js','./manifest.webmanifest',
  './icons/icon-64.png','./icons/icon-96.png','./icons/icon-180.png','./icons/icon-192.png','./icons/icon-512.png'
];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const req=e.request;
  if(req.mode==='navigate'){
    const url=new URL(req.url);
    if(url.pathname.endsWith('/reset.html')){e.respondWith(fetch(req,{cache:'no-store'}));return;}
    e.respondWith(fetch(req,{cache:'no-store'}).then(resp=>{const copy=resp.clone();caches.open(CACHE).then(c=>c.put('./index.html',copy));return resp}).catch(()=>caches.match('./index.html')));
    return;
  }
  e.respondWith(fetch(req).then(resp=>{if(resp&&resp.ok){const copy=resp.clone();caches.open(CACHE).then(c=>c.put(req,copy));}return resp;}).catch(()=>caches.match(req).then(r=>r||caches.match(req.url.replace(self.location.origin,'')))));
});
