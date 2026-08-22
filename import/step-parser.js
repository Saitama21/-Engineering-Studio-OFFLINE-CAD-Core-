const RE_ID = /^#(\d+)$/;

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

function splitStatements(text) {
  const out = [];
  let buf = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    buf += c;
    if (c === "'") {
      if (quoted && text[i + 1] === "'") { buf += text[++i]; continue; }
      quoted = !quoted;
    }
    if (c === ';' && !quoted) {
      const s = buf.trim();
      if (s) out.push(s.slice(0, -1).trim());
      buf = '';
    }
  }
  return out;
}

function tokenize(src) {
  const t = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '(' || c === ')' || c === ',') { t.push({k:c,v:c}); i++; continue; }
    if (c === '#') {
      let j = i + 1; while (j < src.length && /\d/.test(src[j])) j++;
      t.push({k:'ref', v:Number(src.slice(i + 1, j))}); i = j; continue;
    }
    if (c === "'") {
      let j = i + 1, s = '';
      while (j < src.length) {
        if (src[j] === "'" && src[j + 1] === "'") { s += "'"; j += 2; continue; }
        if (src[j] === "'") { j++; break; }
        s += src[j++];
      }
      t.push({k:'str', v:s}); i = j; continue;
    }
    if (c === '$' || c === '*') { t.push({k:'null', v:null}); i++; continue; }
    const num = src.slice(i).match(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:E[+-]?\d+)?/i);
    if (num) { t.push({k:'num', v:Number(num[0])}); i += num[0].length; continue; }
    const id = src.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*|^\.[A-Za-z0-9_]+\./);
    if (id) { t.push({k:'id', v:id[0]}); i += id[0].length; continue; }
    i++;
  }
  return t;
}

function parseArgs(src) {
  const toks = tokenize(src); let p = 0;
  function val() {
    const tok = toks[p++];
    if (!tok) return null;
    if (tok.k === '(') {
      const arr = [];
      while (p < toks.length && toks[p].k !== ')') {
        arr.push(val());
        if (toks[p]?.k === ',') p++;
      }
      if (toks[p]?.k === ')') p++;
      return arr;
    }
    if (tok.k === 'ref') return {ref:tok.v};
    if (tok.k === 'id') {
      if (tok.v === '.T.') return true;
      if (tok.v === '.F.') return false;
      if (toks[p]?.k === '(') {
        p++;
        const args = [];
        while (p < toks.length && toks[p].k !== ')') {
          args.push(val()); if (toks[p]?.k === ',') p++;
        }
        if (toks[p]?.k === ')') p++;
        return {typed:tok.v, args};
      }
      return tok.v;
    }
    return tok.v;
  }
  const result = [];
  while (p < toks.length) {
    result.push(val()); if (toks[p]?.k === ',') p++;
  }
  return result;
}

function parseEntityStatement(s) {
  const m = s.match(/^#(\d+)\s*=\s*([A-Z0-9_]+)\s*\(([\s\S]*)\)$/i);
  if (m) return {id:Number(m[1]), type:m[2].toUpperCase(), args:parseArgs(m[3]), raw:s};
  const complex = s.match(/^#(\d+)\s*=\s*\(([\s\S]*)\)$/);
  if (complex) return {id:Number(complex[1]), type:'COMPLEX_ENTITY', args:[], raw:s};
  return null;
}

export function parseSTEP(text, fileName='model.step') {
  if (!/ISO-10303-21/i.test(text)) throw new Error('Файл не похож на STEP / ISO-10303-21.');
  const clean = stripComments(text);
  const statements = splitStatements(clean);
  const entities = new Map();
  const header = [];
  let inData = false;
  for (const s of statements) {
    if (/^DATA$/i.test(s)) { inData = true; continue; }
    if (/^ENDSEC$/i.test(s)) { inData = false; continue; }
    if (!inData) { if (/^(FILE_|ISO-)/i.test(s)) header.push(s); continue; }
    if (!s.startsWith('#')) continue;
    const e = parseEntityStatement(s);
    if (e) entities.set(e.id, e);
  }
  const byType = new Map();
  for (const e of entities.values()) {
    if (!byType.has(e.type)) byType.set(e.type, []);
    byType.get(e.type).push(e);
  }
  return {fileName, entities, byType, header, entityCount:entities.size};
}

export function refId(v) { return v && typeof v === 'object' && Number.isInteger(v.ref) ? v.ref : null; }
export function entity(model, v) { const id = refId(v); return id == null ? null : model.entities.get(id) || null; }
export function refsDeep(v, out=[]) {
  if (Array.isArray(v)) for (const x of v) refsDeep(x,out);
  else if (v && typeof v === 'object') { if (Number.isInteger(v.ref)) out.push(v.ref); if (v.args) refsDeep(v.args,out); }
  return out;
}

export function getPoint(model, ref) {
  let e = typeof ref === 'number' ? model.entities.get(ref) : entity(model, ref);
  if (!e) return null;
  if (e.type === 'VERTEX_POINT') e = entity(model, e.args[1]);
  if (e?.type !== 'CARTESIAN_POINT') return null;
  const coords = e.args[1];
  return Array.isArray(coords) ? coords.map(Number) : null;
}

export function getDirection(model, ref) {
  const e = typeof ref === 'number' ? model.entities.get(ref) : entity(model, ref);
  if (!e || e.type !== 'DIRECTION' || !Array.isArray(e.args[1])) return null;
  return e.args[1].map(Number);
}

export function getPlacement(model, ref) {
  const e = typeof ref === 'number' ? model.entities.get(ref) : entity(model, ref);
  if (!e || !/^AXIS2_PLACEMENT_3D$/.test(e.type)) return null;
  const origin = getPoint(model, e.args[1]) || [0,0,0];
  const axis = getDirection(model, e.args[2]) || [0,0,1];
  const refdir = getDirection(model, e.args[3]) || [1,0,0];
  return {origin, axis, refdir};
}

export function unwrapCurve(model, curveRef, maxDepth=8) {
  let e = typeof curveRef === 'number' ? model.entities.get(curveRef) : entity(model, curveRef);
  for (let i=0; e && i<maxDepth; i++) {
    if (['SURFACE_CURVE','SEAM_CURVE','BOUNDED_CURVE'].includes(e.type)) { e = entity(model, e.args[1]); continue; }
    break;
  }
  return e || null;
}
