// lib/scene3d/mesh.js — the .bin mesh format of `body` and `part` assets.
// Little-endian: "XMSH" (4 bytes), version u32 (1), flags u32 (bit 0:
// normals present, bit 1: indices present), vertexCount u32, indexCount u32,
// then Float32 positions (3 per vertex), Float32 normals (3 per vertex, if
// flagged), Uint32 indices (if flagged). Nothing else: no materials, no
// UVs, no hierarchy; the spec supplies color and material. encodeMesh()
// writes it (tests and asset tooling), parseMesh() reads it (the chunk).

export const MESH_MAGIC = 'XMSH';
export const MESH_VERSION = 1;
const HEADER = 20;

export function encodeMesh({ positions, normals = null, indices = null }) {
  const vc = positions.length / 3, ic = indices ? indices.length : 0;
  const flags = (normals ? 1 : 0) | (indices ? 2 : 0);
  const bytes = HEADER + vc * 12 + (normals ? vc * 12 : 0) + ic * 4;
  const buf = new ArrayBuffer(bytes);
  const dv = new DataView(buf);
  for (let i = 0; i < 4; i++) dv.setUint8(i, MESH_MAGIC.charCodeAt(i));
  dv.setUint32(4, MESH_VERSION, true);
  dv.setUint32(8, flags, true);
  dv.setUint32(12, vc, true);
  dv.setUint32(16, ic, true);
  let at = HEADER;
  new Float32Array(buf, at, vc * 3).set(positions); at += vc * 12;
  if (normals) { new Float32Array(buf, at, vc * 3).set(normals); at += vc * 12; }
  if (indices) new Uint32Array(buf, at, ic).set(indices);
  return buf;
}

export function parseMesh(buffer) {
  const dv = new DataView(buffer);
  if (buffer.byteLength < HEADER) throw new Error('mesh: truncated header');
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== MESH_MAGIC) throw new Error(`mesh: bad magic "${magic}"`);
  const version = dv.getUint32(4, true);
  if (version !== MESH_VERSION) throw new Error(`mesh: version ${version}, expected ${MESH_VERSION}`);
  const flags = dv.getUint32(8, true), vc = dv.getUint32(12, true), ic = dv.getUint32(16, true);
  const expected = HEADER + vc * 12 + (flags & 1 ? vc * 12 : 0) + (flags & 2 ? ic * 4 : 0);
  if (buffer.byteLength < expected) throw new Error(`mesh: ${buffer.byteLength} bytes, expected ${expected}`);
  let at = HEADER;
  const positions = new Float32Array(buffer.slice(at, at + vc * 12)); at += vc * 12;
  let normals = null, indices = null;
  if (flags & 1) { normals = new Float32Array(buffer.slice(at, at + vc * 12)); at += vc * 12; }
  if (flags & 2) indices = new Uint32Array(buffer.slice(at, at + ic * 4));
  return { positions, normals, indices, vertexCount: vc };
}

// Texture assets come as @1x / @2x files next to the path the spec names:
// assets/earth.png -> assets/earth@2x.png on a DPR-2 canvas. The bare path is
// the fallback when the density file is missing.
export function densityUrl(path, dpr) {
  return path.replace(/(\.[A-Za-z0-9]+)(?=$|[?#])/, `@${dpr}x$1`);
}
