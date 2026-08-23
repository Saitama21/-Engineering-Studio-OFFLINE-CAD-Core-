const CACHE='rozfood-engineering-studio-v14.0.0-production-view-synthesizer';
const ASSETS=[
  './','./index.html','./styles.css?v=14.0.0','./app.js?v=14.0.0','./import-worker.js',
  './import/sldasm-adapter.js','./import/slddrw-adapter.js','./core/tess-recognition.js','./core/manufacturing-recognition.js','./core/component-local.js','./core/feature-graph.js','./core/brep-core.js','./core/math3d.js','./core/analytic-geometry.js','./core/exact-silhouette-core.js','./core/exact-curve-visibility-core.js','./core/analytic-face-hlr-core.js','./core/adaptive-parametric-patch-core.js','./core/parametric-helical-surface-core.js','./core/true-surface-projection-core.js','./core/view-dependent-surface-visibility-core.js','./core/exact-curve-reconstruction.js','./core/cad-feature-entities.js','./core/surface-continuity.js','./core/surface-type-reconstruction.js','./core/surface-intersection-geometry.js','./core/surface-trimming-core.js','./core/topological-brep-reconstruction.js','./core/topology-healing-core.js','./core/brep-orientation-core.js','./core/solid-region-core.js','./core/exact-section-region-core.js','./core/exact-section-boolean-core.js','./core/surface-edge-primitives.js',
  './drawing/drawing-engine.js','./drawing/engineering-drawing-composer.js','./drawing/annotation-layout-core.js','./drawing/semantic-dimension-planner.js','./drawing/functional-dimension-core.js','./drawing/production-leader-core.js','./drawing/section-context-core.js','./drawing/drawing-fidelity-guard.js','./drawing/unified-drawing-view-core.js','./drawing/drawing-reconstruction-core.js','./drawing/body-visibility-core.js','./drawing/cad-edge-visibility-core.js','./drawing/contour-semantics-core.js','./drawing/linework-cleanup-core.js','./drawing/assembly-section-intelligence.js','./drawing/section-material-core.js','./drawing/weld-seam-joint-core.js','./drawing/flat-pattern.js','./drawing/tess-recognition-drawing.js','./drawing/assembly-production-sheet-v130.js','./drawing/drawing-editor.js','./drawing/drawing-navigator.js',
  './viewer/wireframe-viewer.js','./manifest.webmanifest',
  './icons/icon-64.png','./icons/icon-96.png','./icons/icon-180.png','./icons/icon-192.png','./icons/icon-512.png','./core/welded-assembly-geometry.js',
  './drawing/production-view-synthesizer.js','./drawing/production-drawing-qa-core.js'
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
