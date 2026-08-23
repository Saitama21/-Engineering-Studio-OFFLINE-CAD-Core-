const EPS = 1e-12;
const componentCache = new WeakMap();

function subtract(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function normalize(v) {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

function inverseLinearFromTransform(transform) {
  if (!Array.isArray(transform) || transform.length !== 16) return null;

  // sldasm-adapter maps a local point to assembly space as:
  // world = A * local + translation.
  const a = transform[0], b = transform[4], c = transform[8];
  const d = transform[1], e = transform[5], f = transform[9];
  const g = transform[2], h = transform[6], i = transform[10];
  const determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (!Number.isFinite(determinant) || Math.abs(determinant) < EPS) return null;
  const scale = 1 / determinant;
  return [
    (e * i - f * h) * scale,
    (c * h - b * i) * scale,
    (b * f - c * e) * scale,
    (f * g - d * i) * scale,
    (a * i - c * g) * scale,
    (c * d - a * f) * scale,
    (d * h - e * g) * scale,
    (b * g - a * h) * scale,
    (a * e - b * d) * scale,
  ];
}

function multiply3(matrix, vector) {
  return [
    matrix[0] * vector[0] + matrix[1] * vector[1] + matrix[2] * vector[2],
    matrix[3] * vector[0] + matrix[4] * vector[1] + matrix[5] * vector[2],
    matrix[6] * vector[0] + matrix[7] * vector[1] + matrix[8] * vector[2],
  ];
}

function boundsOfFaces(faces) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let pointCount = 0;
  for (const face of faces || []) {
    for (const loop of face.loops || []) {
      for (const point of loop || []) {
        for (let axis = 0; axis < 3; axis += 1) {
          min[axis] = Math.min(min[axis], point[axis]);
          max[axis] = Math.max(max[axis], point[axis]);
        }
        pointCount += 1;
      }
    }
  }
  if (!pointCount) return {min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0], center: [0, 0, 0]};
  return {
    min,
    max,
    size: max.map((value, axis) => value - min[axis]),
    center: max.map((value, axis) => (value + min[axis]) / 2),
  };
}

function sourceBoundsFromOccurrence(occurrence, tessellationBounds) {
  const values = occurrence?.sourceBoundsMm;
  if (!Array.isArray(values) || values.length !== 6 || !values.every(Number.isFinite)) return null;
  const source = {
    min: values.slice(0, 3),
    max: values.slice(3, 6),
  };
  source.size = source.max.map((value, axis) => value - source.min[axis]);
  source.center = source.max.map((value, axis) => (value + source.min[axis]) / 2);
  const close = source.size.every((value, axis) => {
    const tolerance = Math.max(0.35, Math.abs(value) * 0.001);
    return Math.abs(value - tessellationBounds.size[axis]) <= tolerance;
  });
  // SolidWorks' source bbox removes small chord/tessellation errors on round
  // parts. Large disagreement means the bbox is conservative, so retain the
  // actual localized mesh instead of inventing geometry.
  return close ? source : null;
}

function assemblyToLocalPoint(point, inverseLinear, translation) {
  return multiply3(inverseLinear, subtract(point, translation));
}

function assemblyToLocalNormal(normal, inverseLinear) {
  return normalize(multiply3(inverseLinear, normal));
}

function localizeFace(face, inverseLinear, translation) {
  return {
    ...face,
    loops: (face.loops || []).map(loop => (loop || []).map(point => assemblyToLocalPoint(point, inverseLinear, translation))),
    normals: (face.normals || []).map(normal => assemblyToLocalNormal(normal, inverseLinear)),
  };
}

/**
 * Returns one component occurrence in the coordinate system of its source
 * SLDPRT. The assembly mesh stays untouched; only detail/dimension consumers
 * receive the inverse occurrence transform.
 */
export function componentLocalRecord(record, componentId) {
  if (!record || !componentId) return null;
  let byComponent = componentCache.get(record);
  if (!byComponent) {
    byComponent = new Map();
    componentCache.set(record, byComponent);
  }
  if (byComponent.has(componentId)) return byComponent.get(componentId);

  const sourceFaces = (record.faces || []).filter(face => face.componentId === componentId);
  if (!sourceFaces.length) {
    byComponent.set(componentId, null);
    return null;
  }

  const occurrence = (record.occurrences || record.instances || []).find(item => item.id === componentId);
  const inverseLinear = inverseLinearFromTransform(occurrence?.transform);
  const translation = occurrence?.transform
    ? [occurrence.transform[12] * 1000, occurrence.transform[13] * 1000, occurrence.transform[14] * 1000]
    : [0, 0, 0];
  const faces = inverseLinear
    ? sourceFaces.map(face => localizeFace(face, inverseLinear, translation))
    : sourceFaces.map(face => ({...face, loops: (face.loops || []).map(loop => (loop || []).map(point => [...point]))}));
  const tessellationBounds = boundsOfFaces(faces);
  const sourceBounds = sourceBoundsFromOccurrence(occurrence, tessellationBounds);
  const local = {
    ...record,
    faces,
    bounds: sourceBounds || tessellationBounds,
    tessellationBounds,
    boundsSource: sourceBounds ? 'sldasm-source-bounds' : 'localized-tessellation',
    recognition: null,
    componentId,
    componentOccurrence: occurrence || null,
    coordinateFrame: inverseLinear ? 'component-local' : 'assembly-fallback',
    assemblyTransformRemoved: Boolean(inverseLinear),
  };
  byComponent.set(componentId, local);
  return local;
}

export function clearComponentLocalCache(record) {
  if (record) componentCache.delete(record);
}
