// lib/gpu/xspl.js — the .bin format of a Gaussian set ("XSPL"): little-endian
// "XSPL" (4 bytes), version u32 (1), count u32, then 11 Float32 per splat:
// position x y z, covariance xx xy xz yy yz zz (the full symmetric 3x3 in
// world units), shade (0..1, the Lambert factor baked at fit time) and
// opacity (0..1). encodeSplats() writes it (the asset pipeline and the tests),
// parseSplats() reads it (the chunk) and lays the data out for the GPU: three
// vec4 per splat, (x, y, z, shade), (xx, xy, xz, opacity), (yy, yz, zz, 0).
export const XSPL_MAGIC = 'XSPL';
export const XSPL_VERSION = 1;
export const XSPL_FLOATS = 11;
export const GPU_FLOATS = 12;
const HEADER = 12;

export function encodeSplats(rows) {
  const n = rows.length / XSPL_FLOATS;
  if (!Number.isInteger(n)) throw new Error(`xspl: ${rows.length} floats is not a multiple of ${XSPL_FLOATS}`);
  const buf = new ArrayBuffer(HEADER + n * XSPL_FLOATS * 4);
  const dv = new DataView(buf);
  for (let i = 0; i < 4; i++) dv.setUint8(i, XSPL_MAGIC.charCodeAt(i));
  dv.setUint32(4, XSPL_VERSION, true);
  dv.setUint32(8, n, true);
  new Float32Array(buf, HEADER, n * XSPL_FLOATS).set(rows);
  return buf;
}

export function parseSplats(buffer) {
  const dv = new DataView(buffer);
  if (buffer.byteLength < HEADER) throw new Error('xspl: truncated header');
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== XSPL_MAGIC) throw new Error(`xspl: bad magic "${magic}"`);
  const version = dv.getUint32(4, true);
  if (version !== XSPL_VERSION) throw new Error(`xspl: version ${version}, expected ${XSPL_VERSION}`);
  const count = dv.getUint32(8, true);
  const expected = HEADER + count * XSPL_FLOATS * 4;
  if (buffer.byteLength < expected) throw new Error(`xspl: ${buffer.byteLength} bytes, expected ${expected}`);
  const src = new Float32Array(buffer.slice(HEADER, expected));
  const gpu = new Float32Array(count * GPU_FLOATS);
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const s = i * XSPL_FLOATS, g = i * GPU_FLOATS;
    positions[i * 3] = src[s]; positions[i * 3 + 1] = src[s + 1]; positions[i * 3 + 2] = src[s + 2];
    gpu[g] = src[s]; gpu[g + 1] = src[s + 1]; gpu[g + 2] = src[s + 2]; gpu[g + 3] = src[s + 9];      // xyz, shade
    gpu[g + 4] = src[s + 3]; gpu[g + 5] = src[s + 4]; gpu[g + 6] = src[s + 5]; gpu[g + 7] = src[s + 10]; // xx xy xz, opacity
    gpu[g + 8] = src[s + 6]; gpu[g + 9] = src[s + 7]; gpu[g + 10] = src[s + 8]; gpu[g + 11] = 0;        // yy yz zz
  }
  return { count, gpu, positions };
}
