const NS='http://www.w3.org/2000/svg';
const deepClone=o=>JSON.parse(JSON.stringify(o));
const safeNum=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;

function svgPoint(svg,ev){
  const p=svg.createSVGPoint();p.x=ev.clientX;p.y=ev.clientY;
  const ctm=svg.getScreenCTM();return ctm? p.matrixTransform(ctm.inverse()):{x:ev.clientX,y:ev.clientY};
}
function firstEditableText(target){return target.matches?.('text')?target:target.querySelector?.('text:not([data-editor-generated])')||null}
function targetText(target){return firstEditableText(target)?.textContent?.trim()||''}
function candidateTarget(text,svg){
  let best=text,g=text.parentElement;
  while(g&&g!==svg&&g.tagName?.toLowerCase()==='g'){
    const count=g.querySelectorAll('*').length;
    if(count<=14)best=g;else break;
    g=g.parentElement;
  }
  return best;
}
function keyText(target){return targetText(target).replace(/\s+/g,' ').slice(0,24).replace(/[^\p{L}\p{N}_.Ø×+-]/gu,'_')||target.tagName.toLowerCase()}
function readXY(text){
  let x=safeNum(text.getAttribute('x'),NaN),y=safeNum(text.getAttribute('y'),NaN);
  if(!Number.isFinite(x)||!Number.isFinite(y)){try{const b=text.getBBox();x=b.x+b.width/2;y=b.y+b.height/2}catch{x=60;y=60}}
  return{x,y};
}

export class DrawingEditor{
  constructor(svg,{onSelectionChange=()=>{},onStateChange=()=>{}}={}){
    this.svg=svg;this.onSelectionChange=onSelectionChange;this.onStateChange=onStateChange;
    this.enabled=false;this.key='';this.data={items:{},custom:[]};this.undoStack=[];this.redoStack=[];this.selectedId=null;this.drag=null;
    this._bind();
  }
  storageKey(){return `rozfood-drawing-edits-v1:${this.key}`}
  setKey(key){
    const next=String(key||'untitled');if(next===this.key)return;
    this.key=next;this.selectedId=null;this.undoStack=[];this.redoStack=[];this.load();
  }
  load(){try{const raw=localStorage.getItem(this.storageKey());this.data=raw?JSON.parse(raw):{items:{},custom:[]}}catch{this.data={items:{},custom:[]}};this._normalize()}
  save(){this._normalize();try{localStorage.setItem(this.storageKey(),JSON.stringify(this.data))}catch{};this.onStateChange(this.status())}
  _normalize(){if(!this.data||typeof this.data!=='object')this.data={items:{},custom:[]};if(!this.data.items)this.data.items={};if(!Array.isArray(this.data.custom))this.data.custom=[]}
  status(){return{enabled:this.enabled,selected:this.selectionInfo(),canUndo:this.undoStack.length>0,canRedo:this.redoStack.length>0,editCount:Object.keys(this.data.items).length+this.data.custom.length}}
  setEnabled(on){this.enabled=!!on;this.svg.classList.toggle('drawing-editor-enabled',this.enabled);if(!this.enabled)this.deselect();this.onStateChange(this.status())}
  refresh(){
    this._normalize();this.svg.classList.toggle('drawing-editor-enabled',this.enabled);
    this._decorateBase();this._renderCustom();this._applyAll();
    if(this.selectedId){const el=this._find(this.selectedId);if(el)this._markSelected(el);else this.selectedId=null}
    this.onSelectionChange(this.selectionInfo());this.onStateChange(this.status());
  }
  _decorateBase(){
    this.svg.querySelectorAll('[data-editor-id]').forEach(el=>{if(el.dataset.editorCustom!=='1'){el.removeAttribute('data-editor-id');el.classList.remove('editor-selected');}});
    const seen=new Set();let idx=0;
    for(const text of this.svg.querySelectorAll('text')){
      if(text.closest('[data-editor-custom="1"]')||text.hasAttribute('data-editor-generated'))continue;
      const target=candidateTarget(text,this.svg);if(seen.has(target))continue;seen.add(target);
      const id=`a${String(idx++).padStart(4,'0')}-${keyText(target)}`;target.dataset.editorId=id;
      if(!target.dataset.editorBaseTransform)target.dataset.editorBaseTransform=target.getAttribute('transform')||'';
    }
  }
  _renderCustom(){
    this.svg.querySelectorAll('[data-editor-custom="1"]').forEach(n=>n.remove());
    for(const c of this.data.custom){
      const g=document.createElementNS(NS,'g');g.dataset.editorCustom='1';g.dataset.editorId=c.id;g.dataset.editorBaseTransform='';g.classList.add('editor-custom');
      const x=safeNum(c.x,100),y=safeNum(c.y,100),ink=c.ink||'#0a67ff';
      if(c.kind==='roughness'){
        const p=document.createElementNS(NS,'path');p.setAttribute('d',`M${x} ${y} l8 12 l11 -25`);p.setAttribute('fill','none');p.setAttribute('stroke',ink);p.setAttribute('stroke-width','1.4');g.appendChild(p);
        const t=document.createElementNS(NS,'text');t.setAttribute('x',x+24);t.setAttribute('y',y-4);t.setAttribute('fill',ink);t.setAttribute('font-size','11');t.setAttribute('font-family','Arial,sans-serif');t.textContent=c.text||'Ra 3.2';g.appendChild(t);
      }else if(c.kind==='weld'){
        const l=document.createElementNS(NS,'line');l.setAttribute('x1',x);l.setAttribute('y1',y);l.setAttribute('x2',x+58);l.setAttribute('y2',y);l.setAttribute('stroke',ink);l.setAttribute('stroke-width','1.2');g.appendChild(l);
        const tri=document.createElementNS(NS,'path');tri.setAttribute('d',`M${x+22} ${y} l8 -8 l8 8 z`);tri.setAttribute('fill','none');tri.setAttribute('stroke',ink);tri.setAttribute('stroke-width','1.2');g.appendChild(tri);
        const t=document.createElementNS(NS,'text');t.setAttribute('x',x+64);t.setAttribute('y',y+4);t.setAttribute('fill',ink);t.setAttribute('font-size','10');t.setAttribute('font-family','Arial,sans-serif');t.textContent=c.text||'Сварной шов';g.appendChild(t);
      }else{
        const t=document.createElementNS(NS,'text');t.setAttribute('x',x);t.setAttribute('y',y);t.setAttribute('fill',ink);t.setAttribute('font-size','11');t.setAttribute('font-family','Arial,sans-serif');t.textContent=c.text||'Примечание';g.appendChild(t);
      }
      this.svg.appendChild(g);
    }
  }
  _applyAll(){
    this.svg.querySelectorAll('[data-editor-generated]').forEach(n=>n.remove());
    for(const el of this.svg.querySelectorAll('[data-editor-id]')){
      const id=el.dataset.editorId,edit=this.data.items[id]||this.data.custom.find(x=>x.id===id)||{};
      const base=el.dataset.editorBaseTransform||'';const dx=safeNum(edit.dx),dy=safeNum(edit.dy);
      el.setAttribute('transform',`${base}${base?' ':''}translate(${dx} ${dy})`.trim());
      el.style.display=edit.hidden?'none':'';
      const text=firstEditableText(el);if(text&&edit.text!=null)text.textContent=edit.text;
      if(text&&(edit.tolPlus||edit.tolMinus))this._addTolerance(el,text,edit);
    }
  }
  _addTolerance(target,text,edit){
    const {x,y}=readXY(text),parent=target.matches('text')?target.parentNode:target;
    const t=document.createElementNS(NS,'text');t.dataset.editorGenerated='tolerance';t.setAttribute('x',x+10);t.setAttribute('y',y-8);t.setAttribute('font-size','7.5');t.setAttribute('font-family','Arial,sans-serif');t.setAttribute('fill',text.getAttribute('fill')||'#111');t.textContent=`${edit.tolPlus?`+${edit.tolPlus}`:''}${edit.tolPlus&&edit.tolMinus?' / ':''}${edit.tolMinus?`−${edit.tolMinus}`:''}`;parent.appendChild(t);
  }
  _bind(){
    this.svg.addEventListener('pointerdown',ev=>{
      if(!this.enabled||ev.button!==0)return;const target=ev.target.closest?.('[data-editor-id]');
      if(!target){this.deselect();return}ev.preventDefault();ev.stopPropagation();this.select(target.dataset.editorId);
      const p=svgPoint(this.svg,ev),id=target.dataset.editorId,edit=this._peekFor(id),before=deepClone(this.data);
      this.drag={id,target,start:p,dx:safeNum(edit.dx),dy:safeNum(edit.dy),before,moved:false};target.setPointerCapture?.(ev.pointerId);
    });
    this.svg.addEventListener('pointermove',ev=>{
      if(!this.enabled||!this.drag)return;const p=svgPoint(this.svg,ev),d=this.drag,dx=d.dx+p.x-d.start.x,dy=d.dy+p.y-d.start.y;
      if(Math.abs(dx-d.dx)+Math.abs(dy-d.dy)>.2)d.moved=true;const edit=this._editFor(d.id);edit.dx=dx;edit.dy=dy;const base=d.target.dataset.editorBaseTransform||'';d.target.setAttribute('transform',`${base}${base?' ':''}translate(${dx} ${dy})`.trim());
    });
    const end=()=>{if(!this.drag)return;const d=this.drag;this.drag=null;if(d.moved){this.undoStack.push(d.before);this.redoStack=[];this.save()}this.onSelectionChange(this.selectionInfo())};
    this.svg.addEventListener('pointerup',end);this.svg.addEventListener('pointercancel',end);
  }
  _peekFor(id){return this.data.custom.find(x=>x.id===id)||this.data.items[id]||{}}
  _editFor(id){
    const custom=this.data.custom.find(x=>x.id===id);if(custom)return custom;
    if(!this.data.items[id])this.data.items[id]={};return this.data.items[id];
  }
  _snapshot(){this.undoStack.push(deepClone(this.data));if(this.undoStack.length>60)this.undoStack.shift();this.redoStack=[]}
  _commit(fn){this._snapshot();fn();this.save();this.refresh()}
  _find(id){for(const el of this.svg.querySelectorAll('[data-editor-id]'))if(el.dataset.editorId===id)return el;return null}
  select(id){this.selectedId=id;this.svg.querySelectorAll('.editor-selected').forEach(n=>n.classList.remove('editor-selected'));const el=this._find(id);if(el)this._markSelected(el);this.onSelectionChange(this.selectionInfo());this.onStateChange(this.status())}
  _markSelected(el){el.classList.add('editor-selected')}
  deselect(){this.selectedId=null;this.svg.querySelectorAll('.editor-selected').forEach(n=>n.classList.remove('editor-selected'));this.onSelectionChange(null);this.onStateChange(this.status())}
  selectionInfo(){
    if(!this.selectedId)return null;const el=this._find(this.selectedId);const edit=this._peekFor(this.selectedId);const custom=this.data.custom.find(x=>x.id===this.selectedId);return{id:this.selectedId,text:edit.text??(el?targetText(el):custom?.text||''),hidden:!!edit.hidden,tolPlus:edit.tolPlus||'',tolMinus:edit.tolMinus||'',custom:!!custom,kind:custom?.kind||'element'}
  }
  setSelectedText(text){if(!this.selectedId)return;this._commit(()=>{this._editFor(this.selectedId).text=String(text??'')})}
  setTolerance(plus,minus){if(!this.selectedId)return;this._commit(()=>{const e=this._editFor(this.selectedId);e.tolPlus=String(plus||'').trim();e.tolMinus=String(minus||'').trim()})}
  toggleVisibility(){if(!this.selectedId)return;this._commit(()=>{const e=this._editFor(this.selectedId);e.hidden=!e.hidden})}
  resetSelected(){if(!this.selectedId)return;const id=this.selectedId;this._commit(()=>{const customIndex=this.data.custom.findIndex(x=>x.id===id);if(customIndex>=0)this.data.custom.splice(customIndex,1);else delete this.data.items[id]});this.selectedId=null}
  addCustom(kind,text){
    const vb=this.svg.viewBox?.baseVal;let x=vb?.width? vb.x+vb.width*.52:600,y=vb?.height?vb.y+vb.height*.22:150;
    const selected=this.selectedId&&this._find(this.selectedId);if(selected){try{const b=selected.getBBox();x=b.x+b.width+16;y=b.y+b.height/2}catch{}}
    const id=`c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`;this._commit(()=>this.data.custom.push({id,kind,text:String(text||''),x,y,dx:0,dy:0,hidden:false}));this.select(id);return id;
  }
  addNote(text='Примечание'){return this.addCustom('note',text)}
  addRoughness(text='Ra 3.2'){return this.addCustom('roughness',text)}
  addWeld(text='Сварной шов'){return this.addCustom('weld',text)}
  undo(){if(!this.undoStack.length)return;this.redoStack.push(deepClone(this.data));this.data=this.undoStack.pop();this.save();this.refresh()}
  redo(){if(!this.redoStack.length)return;this.undoStack.push(deepClone(this.data));this.data=this.redoStack.pop();this.save();this.refresh()}
  resetAll(){if(!Object.keys(this.data.items).length&&!this.data.custom.length)return;this._snapshot();this.data={items:{},custom:[]};this.selectedId=null;this.save();this.refresh()}
}
