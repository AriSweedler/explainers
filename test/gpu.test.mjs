// The splat3d figure type: the XSPL Gaussian format, the WebGPU-side math
// (same camera convention as lib/scene3d/camera.js, 0..1 clip depth, the
// back-to-front counting sort, unique wire edges), the spec side of the
// fixture (levels, budget slider, toggles, the three virtual objects), the
// lazy GPU chunk (current in dist/, ESM, no dependencies, under budget, in the
// integrity manifest) and the build's poster path (the spec's own PNG as the
// first frame, re-hashed when the image changes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateSpec, scopeForState } from '../lib/spec.js';
import { encodeSplats, parseSplats, XSPL_FLOATS, GPU_FLOATS } from '../lib/gpu/xspl.js';
import { eyeFor, viewMatrix, perspective, multiply, viewDepth, sortBackToFront, wireEdges, norm } from '../lib/gpu/math.js';
import { eyeFor as eyeFor3d } from '../lib/scene3d/camera.js';
import { gpuChunkUrl, GPU_CHUNK_NAME, hasWebGPU } from '../lib/site/gpu.js';
import { buildGpuChunk, GPU_OUTFILE, GPU_GZIP_BUDGET, GPU_ENTRY } from '../tools/build-gpu.mjs';
import { gzipSize } from '../tools/build-3d.mjs';
import { GPU_CHUNK_FILE, INTEGRITY_FILE, computeIntegrity } from '../tools/integrity.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const close = (a, b, eps = 1e-9, msg) => assert.ok(Math.abs(a - b) <= eps, msg || `${a} ~ ${b}`);
const closeVec = (a, b, eps = 1e-9) => a.forEach((v, i) => close(v, b[i], eps, `[${i}] ${v} ~ ${b[i]}`));
const FIXTURE = path.join(here, 'fixtures/pass/splat3d.html');

function fixtureSpec() {
  const html = fs.readFileSync(FIXTURE, 'utf8');
  const m = /<figure class="x-fig" id="(fig-[a-z0-9-]+)"[^>]*>[\s\S]*?<script type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  return JSON.parse(m[2]);
}
const compileFixture = (mutate) => { const s = fixtureSpec(); if (mutate) mutate(s); return validateSpec(s, { figureId: 'fig-pot', palette: ['ink', 'mark'] }); };
const run = (args, cwd = root) => {
  const r = spawnSync(process.execPath, [path.join(root, 'tools/explainers.cjs'), ...args], { cwd, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

// ---------------------------------------------------------------- xspl

test('xspl: encode -> parse round-trips 11 floats per splat into the 3-vec4 GPU layout plus a positions array', () => {
  const rows = Float32Array.from([
    0.5, -1, 2, /*cov*/ 0.04, 0.001, 0, 0.02, 0.002, 0.01, /*shade*/ 0.8, /*opacity*/ 0.9,
    -3, 4, 5, 0.1, 0, 0, 0.1, 0, 0.1, 0.25, 1,
  ]);
  const buf = encodeSplats(rows);
  assert.equal(buf.byteLength, 12 + 2 * XSPL_FLOATS * 4);
  const s = parseSplats(buf);
  assert.equal(s.count, 2);
  assert.equal(s.gpu.length, 2 * GPU_FLOATS);
  closeVec([...s.gpu.subarray(0, 12)], [0.5, -1, 2, 0.8, 0.04, 0.001, 0, 0.9, 0.02, 0.002, 0.01, 0], 1e-6);
  closeVec([...s.positions], [0.5, -1, 2, -3, 4, 5], 1e-6);
  assert.throws(() => encodeSplats(new Float32Array(10)), /multiple of 11/);
  assert.throws(() => parseSplats(new ArrayBuffer(4)), /truncated/);
  const bad = new Uint8Array(buf.slice(0)); bad[0] = 0x58; // 'X' -> still 'X'... flip the second byte instead
  bad[1] = 0x41;
  assert.throws(() => parseSplats(bad.buffer), /bad magic/);
});

test('xspl: the article assets parse: five levels, counts matching the spec, shade in [0.25, 1], positive-definite covariances', () => {
  const dir = path.join(root, 'articles/gaussian-splats-vs-triangles/assets/hero');
  const html = fs.readFileSync(path.join(root, 'articles/gaussian-splats-vs-triangles/index.html'), 'utf8');
  const m = /<figure class="x-fig" id="fig-hero"[^>]*>[\s\S]*?<script type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  const spec = JSON.parse(m[1]);
  for (const L of spec.shows.levels) {
    const bytes = fs.readFileSync(path.join(dir, path.basename(spec.shows.assets[L.splats])));
    const s = parseSplats(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    assert.equal(s.count, L.gaussians, `${L.splats} count`);
    let bad = 0;
    for (let i = 0; i < s.count; i++) {
      const g = i * GPU_FLOATS, shade = s.gpu[g + 3], xx = s.gpu[g + 4], xy = s.gpu[g + 5], xz = s.gpu[g + 6], yy = s.gpu[g + 8], yz = s.gpu[g + 9], zz = s.gpu[g + 10];
      if (shade < 0.25 - 1e-6 || shade > 1 + 1e-6) bad++;
      const d2 = xx * yy - xy * xy, det = xx * (yy * zz - yz * yz) - xy * (xy * zz - yz * xz) + xz * (xy * yz - yy * xz);
      if (!(xx > 0 && d2 > 0 && det > 0)) bad++;
    }
    assert.equal(bad, 0, `${L.splats}: ${bad} bad splats`);
  }
});

// ---------------------------------------------------------------- math

test('math: eyeFor agrees with the scene3d camera convention; the view matrix puts the eye at the origin looking down -z', () => {
  for (const pose of [{ azimuth: 0.6, polar: 1.15, distance: 3.2 }, { azimuth: -2, polar: 0.3, distance: 7 }]) closeVec(eyeFor(pose), eyeFor3d(pose), 1e-12);
  const eye = eyeFor({ azimuth: 0.6, polar: 1.15, distance: 3.2 });
  const V = viewMatrix(eye);
  close(viewDepth(V, ...eye), 0, 1e-5, 'the eye is at depth 0 (Float32 matrix)');
  close(viewDepth(V, 0, 0, 0), -3.2, 1e-5, 'the target sits 3.2 in front of the camera (negative z)');
  const P = perspective(40, 2, 0.05, 100);
  const clip = (p) => { const M = multiply(P, V); const x = p[0], y = p[1], z = p[2]; const w = M[3] * x + M[7] * y + M[11] * z + M[15]; return [(M[0] * x + M[4] * y + M[8] * z + M[12]) / w, (M[1] * x + M[5] * y + M[9] * z + M[13]) / w, (M[2] * x + M[6] * y + M[10] * z + M[14]) / w]; };
  const c = clip([0, 0, 0]);
  close(c[0], 0, 1e-5); close(c[1], 0, 1e-5);
  assert.ok(c[2] > 0 && c[2] < 1, `WebGPU clip depth of the target in (0, 1): ${c[2]}`);
  // near plane -> 0, far plane -> 1 along the view axis
  const toward = norm([-eye[0], -eye[1], -eye[2]]);
  const at = (d) => [eye[0] + toward[0] * d, eye[1] + toward[1] * d, eye[2] + toward[2] * d];
  close(clip(at(0.05))[2], 0, 1e-4); close(clip(at(100))[2], 1, 1e-4);
});

test('math: sortBackToFront yields the farthest splat first and reuses its scratch; wireEdges keeps a shared edge once', () => {
  const V = viewMatrix([0, 0, 10]);
  const pos = Float32Array.from([0, 0, 0, /*near*/ 0, 0, 8, /*far*/ 0, 0, -8, 1, 1, 1]);
  const out = new Uint32Array(4), scratch = {};
  sortBackToFront(pos, V, out, scratch);
  assert.deepEqual([...out], [2, 0, 3, 1]);
  const keys = scratch.keys;
  sortBackToFront(pos, V, out, scratch);
  assert.equal(scratch.keys, keys, 'no reallocation on the second call');
  const edges = wireEdges(Uint32Array.from([0, 1, 2, 2, 1, 3]));
  assert.deepEqual([...edges], [0, 1, 1, 2, 0, 2, 1, 3, 2, 3]);
});

// ---------------------------------------------------------------- spec

test('spec: the splat3d fixture compiles; levels, the budget slider, toggles and the three virtual objects are checked', () => {
  const c = compileFixture();
  assert.equal(c.type, 'splat3d');
  assert.equal(c.spec.shows.levels.length, 2);
  assert.deepEqual(c.spec.notice.states.map((s) => s.name), ['few', 'wired']);
  const wired = scopeForState(c, 'wired');
  assert.equal(wired.get('n'), 240); assert.equal(wired.get('outline'), 1);
  const codeOf = (f) => { try { f(); } catch (e) { return `${e.code} ${e.path} ${e.message}`; } return 'ok'; };
  assert.match(codeOf(() => compileFixture((s) => { s.manipulates.controls[0].values = [56, 300]; })), /SPEC_CONFLICT shows\.budget/);
  assert.match(codeOf(() => compileFixture((s) => { s.shows.levels[1].value = 10; })), /SPEC_RANGE shows\.levels\[1\]\.value/);
  assert.match(codeOf(() => compileFixture((s) => { s.shows.levels[0].mesh = 'nope'; })), /SPEC_MISSING_KEY shows\.levels\[0\]\.mesh/);
  assert.match(codeOf(() => compileFixture((s) => { s.shows.spinControl = 'n'; })), /SPEC_CONFLICT shows\.spinControl/);
  assert.match(codeOf(() => compileFixture((s) => { s.notice.point_at = ['teapot']; })), /SPEC_POINT_AT_MISSING/);
  assert.equal(codeOf(() => compileFixture((s) => { s.notice.states[1].camera = { polar: 0.4 }; })), 'ok', 'states may carry a camera pose');
});

// ---------------------------------------------------------------- loader

test('site: the GPU chunk resolves beside the runtime include; hasWebGPU reads navigator.gpu', () => {
  assert.equal(GPU_CHUNK_NAME, 'explainers-gpu.v1.js');
  assert.equal(gpuChunkUrl('https://x.test/dist/explainers-runtime.v1.js?v=1'), 'https://x.test/dist/explainers-gpu.v1.js');
  assert.equal(gpuChunkUrl('', 'https://x.test/articles/a/'), 'https://x.test/articles/a/explainers-gpu.v1.js');
  assert.equal(hasWebGPU(null), false);
  assert.equal(hasWebGPU({ gpu: {} }), false);
  assert.equal(hasWebGPU({ gpu: { requestAdapter() {} } }), true);
});

// ---------------------------------------------------------------- chunk

async function rebuilt() {
  try { return await buildGpuChunk(); } catch (err) {
    if (err && err.code === 'MODULE_NOT_FOUND' && /esbuild/.test(err.message)) return null;
    throw err;
  }
}

test('the GPU chunk is current in dist/, an ESM module with no dependencies, under 20 KB gzip, listed in dist/integrity.json', async (t) => {
  const code = fs.readFileSync(path.join(root, GPU_OUTFILE), 'utf8');
  const built = await rebuilt();
  if (built) assert.equal(code, built.code, `${GPU_OUTFILE} is stale; run: node tools/build-gpu.mjs`);
  else t.diagnostic('esbuild is not installed under tools/; the committed chunk is checked without a rebuild');
  assert.equal(GPU_OUTFILE, GPU_CHUNK_FILE);
  assert.doesNotMatch(code, /[ \t]+$/m, 'no trailing whitespace');
  assert.match(code, /^\/\/ explainers-gpu v1\.0\.0 — GENERATED by tools\/build-gpu\.mjs/);
  assert.match(code, /export\{[^}]*\bmountSplat3d\b/, 'ESM export of mountSplat3d');
  assert.match(code, /requestAdapter|getPreferredCanvasFormat/, 'WebGPU in there');
  assert.doesNotMatch(code, /https?:\/\/(cdn|unpkg|jsdelivr)/, 'no CDN');
  assert.doesNotMatch(code, /\bimport\s*\(/, 'no nested lazy imports');
  assert.doesNotMatch(code, /WebGLRenderer/, 'three is not bundled into the GPU chunk');
  const gz = gzipSize(code);
  assert.ok(gz <= GPU_GZIP_BUDGET, `chunk is ${gz} bytes gzipped`);
  assert.ok(fs.existsSync(path.join(root, GPU_ENTRY)));
  const table = JSON.parse(fs.readFileSync(path.join(root, INTEGRITY_FILE), 'utf8'));
  assert.ok(table[GPU_CHUNK_FILE], 'the manifest lists the chunk');
  assert.equal(table[GPU_CHUNK_FILE], computeIntegrity(root)[GPU_CHUNK_FILE]);
});

// ---------------------------------------------------------------- poster

test('build: a splat3d poster is the spec\'s own PNG as <img class="x-poster">, hashed with the image; a re-rendered image refreshes it; validate is clean', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'explainers-gpu-'));
  const file = path.join(tmp, 'splat3d.html');
  fs.copyFileSync(FIXTURE, file);
  fs.mkdirSync(path.join(tmp, 'assets'));
  fs.copyFileSync(path.join(here, 'fixtures/pass/assets/splat3d-poster.png'), path.join(tmp, 'assets/splat3d-poster.png'));
  const first = run(['build', file]);
  assert.equal(first.code, 0, first.err);
  assert.match(first.out, /1 poster\(s\) written/);
  const html1 = fs.readFileSync(file, 'utf8');
  const img = /<img class="x-poster" src="assets\/splat3d-poster\.png" alt="" width="704" height="201" aria-hidden="true" data-poster="([0-9a-f]{40})">/.exec(html1);
  assert.ok(img, 'the PNG is the poster');
  assert.ok(!fs.existsSync(path.join(tmp, 'assets/poster-fig-pot.svg')), 'no SVG is drawn for a splat3d figure');
  const again = run(['build', file]);
  assert.match(again.out, /0 poster\(s\) written/, 'idempotent');
  const v = run(['validate', file]);
  assert.equal(v.code, 0, v.err);
  assert.doesNotMatch(v.err, /poster|chunk/, 'validates without poster or chunk warnings');
  // the image changes: the hash follows
  const png = fs.readFileSync(path.join(tmp, 'assets/splat3d-poster.png'));
  png[png.length - 10] ^= 1; // one IDAT byte (the build hashes bytes, it does not decode)
  fs.writeFileSync(path.join(tmp, 'assets/splat3d-poster.png'), png);
  const stale = run(['validate', file]);
  assert.match(stale.err, /poster is stale/);
  const third = run(['build', file]);
  assert.match(third.out, /1 poster\(s\) written/);
  const img2 = /data-poster="([0-9a-f]{40})"/.exec(fs.readFileSync(file, 'utf8'));
  assert.notEqual(img2[1], img[1]);
  // a missing image is reported, not drawn
  fs.unlinkSync(path.join(tmp, 'assets/splat3d-poster.png'));
  const missing = run(['validate', file]);
  assert.match(missing.err, /fallback poster assets\/splat3d-poster\.png not found; render it/);
});
