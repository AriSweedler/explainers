// lib/gpu/math.js — the small column-major 4x4 math the WebGPU renderer needs
// (WGSL and WebGPU take column-major matrices; clip z runs 0..1). Pure, tested.
export function eyeFor({ azimuth, polar, distance }, target = [0, 0, 0]) {
  const s = Math.sin(polar);
  return [target[0] + distance * s * Math.sin(azimuth), target[1] + distance * Math.cos(polar), target[2] + distance * s * Math.cos(azimuth)];
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// View matrix (world -> camera, camera looks down -z), column-major Float32Array(16).
export function viewMatrix(eye, target = [0, 0, 0], up = [0, 1, 0]) {
  const back = norm(sub(eye, target));
  let right = cross(up, back);
  if (Math.hypot(...right) < 1e-6) right = cross([0, 0, 1], back);
  right = norm(right);
  const u = cross(back, right);
  return new Float32Array([
    right[0], u[0], back[0], 0,
    right[1], u[1], back[1], 0,
    right[2], u[2], back[2], 0,
    -dot(right, eye), -dot(u, eye), -dot(back, eye), 1,
  ]);
}

// Perspective with WebGPU's 0..1 clip depth, column-major.
export function perspective(fovDeg, aspect, near, far) {
  const f = 1 / Math.tan((fovDeg * Math.PI) / 360);
  const m = new Float32Array(16);
  m[0] = f / aspect; m[5] = f; m[10] = far / (near - far); m[11] = -1; m[14] = (near * far) / (near - far);
  return m;
}

export function multiply(a, b) { // a * b, column-major
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}

// View-space depth of a point (negative in front of the camera).
export function viewDepth(view, x, y, z) {
  return view[2] * x + view[6] * y + view[10] * z + view[14];
}

// Back-to-front order of the splats for the "over" rule: ascending view depth
// (the farthest, most negative, first). A counting sort on a quantized key:
// O(n) per frame, stable, no allocation after the first call.
export function sortBackToFront(positions, view, out, scratch) {
  const n = positions.length / 3;
  const keys = scratch.keys || (scratch.keys = new Uint32Array(n));
  const counts = scratch.counts || (scratch.counts = new Uint32Array(65536));
  let lo = Infinity, hi = -Infinity;
  const depths = scratch.depths || (scratch.depths = new Float32Array(n));
  for (let i = 0; i < n; i++) {
    const d = viewDepth(view, positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    depths[i] = d; if (d < lo) lo = d; if (d > hi) hi = d;
  }
  const span = hi - lo || 1;
  counts.fill(0);
  for (let i = 0; i < n; i++) { const k = Math.min(65535, Math.max(0, ((depths[i] - lo) / span) * 65535) | 0); keys[i] = k; counts[k]++; }
  let acc = 0;
  for (let k = 0; k < 65536; k++) { const c = counts[k]; counts[k] = acc; acc += c; }
  for (let i = 0; i < n; i++) out[counts[keys[i]]++] = i;
  return out;
}

// Unique undirected edges of an indexed triangle list, as a Uint32Array of pairs.
export function wireEdges(indices) {
  const seen = new Set(), out = [];
  for (let t = 0; t < indices.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = indices[t + e], b = indices[t + ((e + 1) % 3)];
      const lo = Math.min(a, b), hi = Math.max(a, b), key = lo * 4294967296 + hi;
      if (seen.has(key)) continue;
      seen.add(key); out.push(lo, hi);
    }
  }
  return Uint32Array.from(out);
}
