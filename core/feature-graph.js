const EPS = 1e-9;
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, scale) => [a[0] * scale, a[1] * scale, a[2] * scale];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = vector => Math.hypot(vector[0], vector[1], vector[2]);
const normalize = vector => {
  const value = length(vector) || 1;
  return vector.map(item => item / value);
};
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const nearly = (a, b, tolerance) => Math.abs(a - b) <= tolerance;

function canonicalAxis(axis) {
  const value = normalize(axis);
  const index = Math.abs(value[0]) > .01 ? 0 : Math.abs(value[1]) > .01 ? 1 : 2;
  return value[index] < 0 ? mul(value, -1) : value;
}

function angleDeg(a, b) {
  return Math.acos(clamp(Math.abs(dot(normalize(a), normalize(b))), -1, 1)) * 180 / Math.PI;
}

function basis(axis) {
  const a = canonicalAxis(axis);
  const seed = Math.abs(a[2]) < .82 ? [0, 0, 1] : [1, 0, 0];
  const u = normalize(cross(a, seed));
  return {a, u, v: normalize(cross(a, u))};
}

function corners(bounds) {
  const result = [];
  for (const x of [bounds.min[0], bounds.max[0]]) {
    for (const y of [bounds.min[1], bounds.max[1]]) {
      for (const z of [bounds.min[2], bounds.max[2]]) result.push([x, y, z]);
    }
  }
  return result;
}

function faceGroups(faces) {
  const groups = new Map();
  for (const face of faces || []) {
    const key = [face.componentId || 'RAW', face.sourceStream || '', face.tessFaceId ?? ''].join('|');
    let group = groups.get(key);
    if (!group) {
      group = {key, componentId: face.componentId || null, tessFaceId: face.tessFaceId ?? null, points: []};
      groups.set(key, group);
    }
    for (const loop of face.loops || []) for (const point of loop || []) group.points.push(point);
  }
  return [...groups.values()];
}

function radialData(point, axis, axisPoint, frame) {
  const axial = dot(point, axis);
  const onAxis = add(axisPoint, mul(axis, axial - dot(axisPoint, axis)));
  const delta = sub(point, onAxis);
  return {axial, radius: length(delta), x: dot(delta, frame.u), y: dot(delta, frame.v)};
}

function clusterValues(values, tolerance = .04) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const clusters = [];
  for (const value of sorted) {
    const group = clusters.at(-1);
    if (group && Math.abs(value - group.value) <= tolerance) {
      group.values.push(value);
      group.value = group.values.reduce((sum, item) => sum + item, 0) / group.values.length;
    } else clusters.push({value, values: [value]});
  }
  return clusters;
}

function angularCoverage(points) {
  if (points.length < 6) return 0;
  const values = points.map(point => Math.atan2(point.y, point.x)).sort((a, b) => a - b);
  let maxGap = 0;
  for (let index = 1; index < values.length; index += 1) maxGap = Math.max(maxGap, values[index] - values[index - 1]);
  maxGap = Math.max(maxGap, values[0] + Math.PI * 2 - values.at(-1));
  return Math.PI * 2 - maxGap;
}

function circularRings(record, axis, axisPoint) {
  const frame = basis(axis);
  const diagonal = Math.hypot(...(record?.bounds?.size || [1, 1, 1])) || 1;
  const axialTolerance = Math.max(.035, diagonal * .00012);
  const radiusTolerance = Math.max(.035, diagonal * .0001);
  const rings = [];
  for (const group of faceGroups(record?.faces || [])) {
    const data = group.points.map(point => radialData(point, axis, axisPoint, frame));
    if (!data.length) continue;
    const minT = Math.min(...data.map(item => item.axial));
    const maxT = Math.max(...data.map(item => item.axial));
    if (maxT - minT > axialTolerance) continue;
    for (const cluster of clusterValues(data.map(item => item.radius), radiusTolerance)) {
      if (cluster.value < .2 || cluster.values.length < 6) continue;
      const matching = data.filter(item => Math.abs(item.radius - cluster.value) <= radiusTolerance * 1.5);
      const coverage = angularCoverage(matching);
      if (coverage < Math.PI * 1.65) continue;
      rings.push({
        componentId: group.componentId,
        faceId: group.tessFaceId,
        station: (minT + maxT) / 2,
        radius: cluster.value,
        diameter: cluster.value * 2,
        coverage,
      });
    }
  }
  const result = [];
  for (const ring of rings.sort((a, b) => a.station - b.station || a.diameter - b.diameter)) {
    if (!result.some(item => nearly(item.station, ring.station, axialTolerance * 2) && nearly(item.diameter, ring.diameter, radiusTolerance * 3))) result.push(ring);
  }
  return result;
}

function chamfers(record, axis, axisPoint) {
  const frame = basis(axis);
  const diagonal = Math.hypot(...(record?.bounds?.size || [1, 1, 1])) || 1;
  const endTolerance = Math.max(.04, diagonal * .00015);
  const result = [];
  for (const group of faceGroups(record?.faces || [])) {
    const data = group.points.map(point => radialData(point, axis, axisPoint, frame));
    if (!data.length) continue;
    const minT = Math.min(...data.map(item => item.axial));
    const maxT = Math.max(...data.map(item => item.axial));
    const axial = maxT - minT;
    if (axial < .15 || axial > Math.max(8, diagonal * .05)) continue;
    const atMin = data.filter(item => item.axial <= minT + endTolerance);
    const atMax = data.filter(item => item.axial >= maxT - endTolerance);
    if (atMin.length < 6 || atMax.length < 6) continue;
    const radiusAt = list => list.reduce((sum, item) => sum + item.radius, 0) / list.length;
    const r1 = radiusAt(atMin), r2 = radiusAt(atMax), radial = Math.abs(r2 - r1);
    if (radial < .15 || Math.abs(radial - axial) > Math.max(.18, Math.max(radial, axial) * .16)) continue;
    const coverage = Math.min(angularCoverage(atMin), angularCoverage(atMax));
    if (coverage < Math.PI * 1.55) continue;
    result.push({
      componentId: group.componentId,
      faceId: group.tessFaceId,
      start: minT,
      end: maxT,
      axial,
      radial,
      size: (axial + radial) / 2,
      angle: Math.atan2(radial, axial) * 180 / Math.PI,
      fromDiameter: r1 * 2,
      toDiameter: r2 * 2,
    });
  }
  return result.sort((a, b) => a.start - b.start);
}

function exactThickness(record, hubAxis, fallback) {
  const values = (record?.recognition?.planeSpacings || [])
    .filter(item => angleDeg(item.normal, hubAxis) < 2)
    .map(item => item.spacing)
    .filter(value => value > fallback * .65 && value < fallback * 1.35)
    .sort((a, b) => Math.abs(a - fallback) - Math.abs(b - fallback));
  return values[0] || fallback;
}

function inferPatternPcd(holes, axis) {
  if (holes.length < 3) return null;
  const frame = basis(axis);
  const points = holes.map(hole => ({x: dot(hole.axisPoint, frame.u), y: dot(hole.axisPoint, frame.v)}));
  const center = {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
  const radii = points.map(point => Math.hypot(point.x - center.x, point.y - center.y));
  const radius = radii.reduce((sum, value) => sum + value, 0) / radii.length;
  const rms = Math.sqrt(radii.reduce((sum, value) => sum + (value - radius) ** 2, 0) / radii.length);
  return radius > .5 && rms <= Math.max(.12, radius * .012) ? {diameter: radius * 2, rms} : null;
}

function crossAssemblyGraph(record) {
  const cylinders = (record?.recognition?.cylinders || []).filter(item => item.full && item.confidence > .72);
  const rods = cylinders.filter(item => item.type === 'outer' && item.length > item.diameter * 5);
  if (rods.length < 3) return null;
  const diameterGroups = new Map();
  for (const rod of rods) {
    const key = (Math.round(rod.diameter * 10) / 10).toFixed(1);
    const list = diameterGroups.get(key) || [];
    list.push(rod);
    diameterGroups.set(key, list);
  }
  const repeatedRods = [...diameterGroups.values()].sort((a, b) => b.length - a.length)[0] || [];
  if (repeatedRods.length < 3) return null;
  const hubCandidates = cylinders
    .filter(item => item.type === 'outer' && item.diameter > repeatedRods[0].diameter * 2 && item.length < item.diameter * .75)
    .sort((a, b) => b.diameter - a.diameter);
  const hub = hubCandidates.find(candidate => repeatedRods.filter(rod => angleDeg(rod.axis, candidate.axis) > 84).length >= 3);
  if (!hub) return null;
  const bore = cylinders
    .filter(item => item.type === 'hole' && angleDeg(item.axis, hub.axis) < 2 && item.diameter < hub.diameter * .8)
    .sort((a, b) => b.diameter - a.diameter)[0] || null;
  const axialHoles = cylinders.filter(item => item.type === 'hole' && angleDeg(item.axis, hub.axis) < 2 && item.diameter < (bore?.diameter || hub.diameter) * .6);
  const byDiameter = new Map();
  for (const hole of axialHoles) {
    const key = (Math.round(hole.diameter * 10) / 10).toFixed(1);
    const list = byDiameter.get(key) || [];
    list.push(hole);
    byDiameter.set(key, list);
  }
  const repeatedHoles = [...byDiameter.values()].filter(list => list.length >= 2).sort((a, b) => b.length - a.length)[0] || [];
  const pcd = inferPatternPcd(repeatedHoles, hub.axis);
  const smallestEnvelope = Math.min(...(record?.bounds?.size || [hub.length]));
  return {
    profile: 'CROSS_ASSEMBLY',
    confidence: .99,
    hub,
    hubAxis: canonicalAxis(hub.axis),
    hubDiameter: hub.diameter,
    boreDiameter: bore?.diameter || null,
    thickness: exactThickness(record, hub.axis, smallestEnvelope),
    rods: repeatedRods.slice(0, 3),
    rodCount: repeatedRods.length,
    rodDiameter: repeatedRods.reduce((sum, rod) => sum + rod.diameter, 0) / repeatedRods.length,
    rodLength: Math.max(...repeatedRods.map(rod => rod.length)),
    holes: repeatedHoles,
    holeCount: repeatedHoles.length,
    holeDiameter: repeatedHoles[0]?.diameter || null,
    holePcd: pcd?.diameter || null,
    source: 'verified cylinders + occurrence hierarchy',
  };
}

function axialPartGraph(record) {
  const size = record?.bounds?.size || [1, 1, 1];
  const longest = Math.max(...size);
  const second = [...size].sort((a, b) => b - a)[1] || 1;
  const candidates = (record?.recognition?.outerCylinders || [])
    .filter(item => item.full && item.length > item.diameter * 2.5)
    .sort((a, b) => b.area - a.area || b.length - a.length);
  const body = candidates[0];
  if (!body || longest / Math.max(second, 1) < 3) return null;
  const axis = canonicalAxis(body.axis);
  const projected = corners(record.bounds).map(point => dot(point, axis));
  const min = Math.min(...projected), max = Math.max(...projected), overallLength = max - min;
  const rings = circularRings(record, axis, body.axisPoint);
  const inferredChamfers = chamfers(record, axis, body.axisPoint);
  const smaller = rings
    .filter(ring => ring.diameter < body.diameter - .25 && ring.diameter > body.diameter * .25)
    .sort((a, b) => a.diameter - b.diameter);
  const stepRing = smaller[0] || null;
  const stepFromMin = stepRing ? stepRing.station - min : null;
  const stepFromMax = stepRing ? max - stepRing.station : null;
  const stepLength = stepRing ? Math.min(stepFromMin, stepFromMax) : null;
  return {
    profile: 'AXIAL_PART',
    confidence: .98,
    axis,
    axisPoint: body.axisPoint,
    min,
    max,
    overallLength,
    bodyDiameter: body.diameter,
    bodyCylinder: body,
    rings,
    stepDiameter: stepRing?.diameter || null,
    stepStation: stepRing?.station || null,
    stepLength: stepLength != null && stepLength <= overallLength * .25 ? stepLength : null,
    stepAt: stepFromMin <= stepFromMax ? 'min' : 'max',
    chamfers: inferredChamfers,
    source: 'cylinders + planar circular rings + conical transitions',
  };
}

export function buildFeatureGraph(record) {
  if (!record?.faces?.length || !record?.recognition) return {profile: 'GENERAL', confidence: 0, source: 'no geometry'};
  const cross = crossAssemblyGraph(record);
  if (cross) return cross;
  const axial = axialPartGraph(record);
  if (axial) return axial;
  return {profile: 'GENERAL', confidence: .75, source: 'safe geometry fallback'};
}

