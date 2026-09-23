// Phase 3B: the pure parts of lib/scene3d under Node (camera pose math,
// surface coordinates, the .bin mesh format, object evaluation), the spec
// side of the scene3d fixture (compile, states with camera poses), the lazy
// chunk build (current in dist/, ESM, three bundled, under budget) and the
// integrity manifest entry for it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSpec, scopeForState, evaluateAll } from '../lib/spec.js';
import { stateTargets, visibleIds } from '../lib/core/state.js';
import { getter } from '../lib/scene2d/getters.js';
import {
  FOV_DEG, POLAR_EPS, initialPose, clampPose, eyeFor, lookAt, project, pxPerWorld, focalPx, radPerPx, nearestAzimuth, momentumStep, rotateEuler, toWorld, axisVector,
} from '../lib/scene3d/camera.js';
import { clampLatLon, latLonToPoint, pointToLatLon, rayToSphere } from '../lib/scene3d/surface.js';
import { encodeMesh, parseMesh, densityUrl, MESH_MAGIC } from '../lib/scene3d/mesh.js';
import { compileObject, evalObject, circlePoints, labelSpecs, labelPosition } from '../lib/scene3d/objects.js';
import { chunkUrl, CHUNK_NAME } from '../lib/site/scene3d.js';
import { buildChunk, gzipSize, OUTFILE, GZIP_BUDGET, ENTRY } from '../tools/build-3d.mjs';
import { CHUNK_FILE, INTEGRITY_FILE, computeIntegrity } from '../tools/integrity.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const close = (a, b, eps = 1e-9, msg) => assert.ok(Math.abs(a - b) <= eps, msg || `${a} ~ ${b}`);
const closeVec = (a, b, eps = 1e-9) => a.forEach((v, i) => close(v, b[i], eps, `[${i}] ${v} ~ ${b[i]}`));

function fixture(name) {
  const html = fs.readFileSync(path.join(here, 'fixtures/pass', name), 'utf8');
  const m = /<figure class="x-fig" id="(fig-[a-z0-9-]+)"[^>]*>[\s\S]*?<script type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  return validateSpec(JSON.parse(m[2]), { figureId: m[1], palette: ['ink', 'mark'] });
}
function moon3d() {
  const html = fs.readFileSync(path.join(root, 'articles/moon/index.html'), 'utf8');
  const m = /<figure class="x-fig" id="fig-orbit3d"[^>]*>[\s\S]*?<script type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  return validateSpec(JSON.parse(m[1]), { figureId: 'fig-orbit3d', palette: ['sun', 'moon', 'earth', 'star', 'muted'] });
}

// ---------------------------------------------------------------- camera

test('camera: pose -> eye is spherical around the target, y up, polar from the pole', () => {
  closeVec(eyeFor({ azimuth: 0, polar: Math.PI / 2, distance: 5 }), [0, 0, 5]);
  closeVec(eyeFor({ azimuth: Math.PI / 2, polar: Math.PI / 2, distance: 5 }), [5, 0, 0]);
  closeVec(eyeFor({ azimuth: 0, polar: 0, distance: 5 }), [0, 5, 0], 1e-9);
  closeVec(eyeFor({ azimuth: 0, polar: Math.PI / 2, distance: 2 }, [1, 1, 1]), [1, 1, 3]);
  const v = lookAt([0, 0, 5], [0, 0, 0]);
  closeVec(v.back, [0, 0, 1]); closeVec(v.right, [1, 0, 0]); closeVec(v.up, [0, 1, 0]);
  const down = lookAt([0, 5, 0], [0, 0, 0]);
  assert.ok(Math.hypot(...down.right) > 0.99, 'looking straight down still has a right vector');
});

test('camera: clampPose keeps off the poles, honors orbit limits only in orbit mode', () => {
  const arc = { mode: 'arcball' }, orb = { mode: 'orbit', minPolar: 0.3, maxPolar: 1.5, minAzimuth: -1, maxAzimuth: 1 };
  assert.equal(clampPose({ azimuth: 7, polar: -1, distance: 3 }, arc).polar, POLAR_EPS);
  assert.equal(clampPose({ azimuth: 7, polar: 9, distance: 3 }, arc).polar, Math.PI - POLAR_EPS);
  assert.equal(clampPose({ azimuth: 7, polar: 1, distance: 3 }, arc).azimuth, 7, 'arcball azimuth is free');
  assert.deepEqual(clampPose({ azimuth: 7, polar: 0.1, distance: 3 }, orb), { azimuth: 1, polar: 0.3, distance: 3 });
  assert.deepEqual(clampPose({ azimuth: -7, polar: 2, distance: 3 }, orb), { azimuth: -1, polar: 1.5, distance: 3 });
  assert.ok(clampPose({ azimuth: 0, polar: 1, distance: -1 }, arc).distance > 0);
  assert.deepEqual(initialPose({ mode: 'fixed', azimuth: 0.7, polar: 1.05, distance: 9 }), { azimuth: 0.7, polar: 1.05, distance: 9 });
});

test('camera: perspective projection lands the target at the box center, scales with depth, drops points behind the eye', () => {
  const view = lookAt([0, 0, 10], [0, 0, 0]);
  const box = { x: 100, y: 50, width: 600, height: 400 };
  const c = project([0, 0, 0], view, box);
  closeVec([c.x, c.y, c.depth], [400, 250, 10]);
  const f = focalPx(400, FOV_DEG);
  const r = project([1, 0, 0], view, box);
  close(r.x - c.x, f / 10, 1e-9, 'one world unit at depth 10 is focal/10 px');
  const up = project([0, 1, 0], view, box);
  assert.ok(up.y < c.y, 'y up on screen');
  assert.equal(project([0, 0, 11], view, box), null, 'behind the eye');
  close(pxPerWorld(10, 400), f / 10);
  close(radPerPx(600), Math.PI / 300, 1e-12, 'half the width is half a turn');
});

test('camera: nearestAzimuth takes the short way; momentum decays geometrically and stops', () => {
  close(nearestAzimuth(0.1, 6.2), 6.2 - Math.PI * 2);
  close(nearestAzimuth(6.2, 0.1), 0.1 + Math.PI * 2);
  close(nearestAzimuth(1, 2), 2);
  const one = momentumStep(0.1, 1 / 60, 0.92);
  close(one.move, 0.1, 1e-9, 'one 60 Hz frame moves by the velocity');
  close(one.vel, 0.092);
  const two = momentumStep(0.1, 2 / 60, 0.92);
  close(two.move, 0.1 + 0.092, 1e-9, 'a long frame is the sum of the short ones');
  let v = 0.05, moved = 0, frames = 0;
  while (v) { const s = momentumStep(v, 1 / 60, 0.92); moved += s.move; v = s.vel; frames++; }
  assert.ok(frames > 50 && frames < 120, `stops after ${frames} frames`);
  close(moved, 0.05 / (1 - 0.92), 2e-3, 'total spin is the geometric series');
  assert.equal(momentumStep(0.1, 1 / 60, 1).vel, 0.1, 'friction 1 never decays');
});

test('camera: Euler XYZ rotation, object transform and axis vectors match three.js conventions', () => {
  closeVec(rotateEuler([1, 0, 0], [0, Math.PI / 2, 0]), [0, 0, -1]);
  closeVec(rotateEuler([0, 1, 0], [Math.PI / 2, 0, 0]), [0, 0, 1]);
  closeVec(rotateEuler([1, 0, 0], [0, 0, Math.PI / 2]), [0, 1, 0]);
  // XYZ order: Rz first, then Ry, then Rx
  closeVec(rotateEuler([1, 0, 0], [Math.PI / 2, 0, Math.PI / 2]), [0, 0, 1]);
  closeVec(toWorld([1, 0, 0], { position: [10, 0, 0], rotation: [0, 0, 0], scale: 3 }), [13, 0, 0]);
  closeVec(toWorld([0, 0, 1], { position: [0, 0, 0], rotation: [0.0898, 0, 0], scale: 3 }), [0, -3 * Math.sin(0.0898), 3 * Math.cos(0.0898)]);
  assert.deepEqual(axisVector('x'), [1, 0, 0]);
  closeVec(axisVector([0, 3, 4]), [0, 0.6, 0.8]);
});

// --------------------------------------------------------------- surface

test('surface: lat/lon in degrees round-trip through the sphere; lon 0 is +x, 90E is -z', () => {
  closeVec(latLonToPoint(0, 0, 2), [2, 0, 0]);
  closeVec(latLonToPoint(0, 90, 1), [0, 0, -1]);
  closeVec(latLonToPoint(90, 0, 1), [0, 1, 0]);
  closeVec(latLonToPoint(-90, 45, 1), [0, -1, 0]);
  for (const [lat, lon] of [[37.7, -122.4], [-33.9, 151.2], [0, 180], [51.5, -0.1], [89, 10]]) {
    const [la, lo] = pointToLatLon(latLonToPoint(lat, lon, 3.3));
    close(la, lat, 1e-9); close(lo, lon, 1e-9);
  }
  assert.deepEqual(clampLatLon([100, 190]), [90, -170]);
  assert.deepEqual(clampLatLon([-95, -180]), [-90, 180]);
  assert.deepEqual(clampLatLon([10, 540]), [10, 180]);
  assert.deepEqual(clampLatLon(['x', undefined]), [0, 0]);
  assert.deepEqual(pointToLatLon([0, 0, 0]), [0, 0], 'the center maps somewhere finite');
});

test('surface: a ray hits the sphere or slides to the nearest silhouette point', () => {
  const hit = rayToSphere([0, 0, 10], [0, 0, -1], [0, 0, 0], 1);
  assert.equal(hit.hit, true);
  closeVec(hit.point, [0, 0, 1]);
  const miss = rayToSphere([0, 5, 10], [0, 0, -1], [0, 0, 0], 1);
  assert.equal(miss.hit, false);
  closeVec(miss.point, [0, 1, 0], 1e-9, 'the silhouette point nearest the ray');
  const away = rayToSphere([0, 0, 10], [0, 0, 1], [0, 0, 0], 1);
  assert.equal(away.hit, false);
  closeVec(away.point, [0, 0, 1], 1e-9, 'a ray pointing away still gives a surface point');
  const inside = rayToSphere([0, 0, 0.5], [0, 0, -1], [0, 0, 0], 1);
  assert.ok(Math.hypot(...inside.point) > 0.999, 'from inside, a point on the surface');
});

// ------------------------------------------------------------------ mesh

test('mesh: the .bin format round-trips positions, normals and indices; rejects bad headers', () => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const indices = new Uint32Array([0, 1, 2]);
  const buf = encodeMesh({ positions, normals, indices });
  assert.equal(buf.byteLength, 20 + 36 + 36 + 12);
  assert.equal(String.fromCharCode(...new Uint8Array(buf, 0, 4)), MESH_MAGIC);
  const m = parseMesh(buf);
  assert.deepEqual([...m.positions], [...positions]);
  assert.deepEqual([...m.normals], [...normals]);
  assert.deepEqual([...m.indices], [0, 1, 2]);
  assert.equal(m.vertexCount, 3);
  const bare = parseMesh(encodeMesh({ positions }));
  assert.equal(bare.normals, null);
  assert.equal(bare.indices, null);
  assert.throws(() => parseMesh(new ArrayBuffer(8)), /truncated/);
  const bad = encodeMesh({ positions }); new Uint8Array(bad)[0] = 0x58 + 1;
  assert.throws(() => parseMesh(bad), /bad magic/);
  assert.throws(() => parseMesh(buf.slice(0, buf.byteLength - 4)), /expected/);
  assert.equal(densityUrl('assets/earth.png', 2), 'assets/earth@2x.png');
  assert.equal(densityUrl('assets/tex/land.jpg?v=3', 1), 'assets/tex/land@1x.jpg?v=3');
});

// --------------------------------------------------------------- objects

test('objects: compile and evaluate from the scope; arrows get a default head; labels collect', () => {
  const c = moon3d();
  const scope = scopeForState(c, 'above');
  const moon = compileObject(c.spec.shows.objects.find((o) => o.id === 'moon'), getter);
  const f = evalObject(moon, scope);
  close(Math.hypot(...f.position), 3, 1e-9, 'the Moon rides the R = 3 orbit');
  assert.equal(f.visible, true);
  assert.equal(f.opacity, 1);
  assert.equal(f.radius, 0.18);
  const disc = compileObject(c.spec.shows.objects.find((o) => o.id === 'ecliptic'), getter);
  assert.equal(evalObject(disc, new Map([...scope, ['showEcliptic', 0]])).visible, false);
  assert.equal(evalObject(disc, scope).opacity, 0.12);
  const arrow = compileObject(c.spec.shows.objects.find((o) => o.id === 'sun-line'), getter);
  const a = evalObject(arrow, scope);
  close(a.length, 3.3, 1e-9);
  assert.equal(a.head, 0.35);
  const noHead = evalObject(compileObject({ id: 'x', kind: 'arrow', from: [0, 0, 0], to: [0, 2, 0] }, getter), new Map());
  close(noHead.head, 0.3, 1e-9, '15% of the length');
  const ring = compileObject(c.spec.shows.objects.find((o) => o.id === 'orbit'), getter);
  assert.deepEqual(evalObject(ring, scope).rotation, [0.0898, 0, 0]);
  const pts = circlePoints(4);
  closeVec(pts[1], [0, 0, -1]);
  const labels = labelSpecs(c.spec.shows.objects, getter);
  assert.deepEqual(labels.map((L) => [L.id, L.anchor, L.text]), [['earth:label', 'earth', 'Earth'], ['moon:label', 'moon', 'Moon'], ['sun-line:label', 'sun-line', 'to the Sun'], ['day', 'moon', 'day {t:.1f}']]);
  // the Moon's orbit lies on the inclined ring: a ring point at the Moon's angle coincides with it
  const t = scope.get('t'), th = (2 * Math.PI * t) / 27.321661;
  const onRing = toWorld([Math.cos(th), 0, -Math.sin(th)], { rotation: [0.0898, 0, 0], scale: 3 });
  closeVec(onRing, f.position, 1e-9);
});

// ------------------------------------------------------------------ spec

test('spec: the scene3d fixture compiles: objects, camera states, a surface drag with geolocate, point_at on objects', () => {
  const c = fixture('scene3d.html');
  assert.equal(c.type, 'scene3d');
  assert.deepEqual(c.objectIds, ['ball', 'rim', 'pole', 'tag']);
  assert.deepEqual(c.states, ['top', 'side']);
  assert.deepEqual(c.exposedNames, ['spin', 'pin.lat', 'pin.lon', 'pin.dragging']);
  assert.deepEqual([c.defaults.get('pin.lat'), c.defaults.get('pin.lon')], [37.7, -122.4]);
  for (const name of [null, ...c.states]) for (const v of evaluateAll(c, scopeForState(c, name)).values()) assert.ok(Number.isFinite(v));
  const top = stateTargets(c, 'top');
  assert.deepEqual(top.targets, { spin: 0, 'pin.lat': 90, 'pin.lon': 0 });
  assert.deepEqual(top.camera, { azimuth: 0.5, polar: 0.3, distance: 4 });
  assert.deepEqual(stateTargets(c, 'side').camera, { azimuth: 1.5708, polar: 1.5 }, 'a partial pose keeps the other components');
  assert.ok(visibleIds(c, scopeForState(c)).has('ball') && visibleIds(c, scopeForState(c)).has('pin'), 'objects and controls are always ref-visible');
  assert.throws(() => validateSpec({ ...c.spec, notice: { ...c.spec.notice, point_at: ['nope'] } }, { figureId: 'x' }), (e) => e.code === 'SPEC_POINT_AT_MISSING');
});

test('spec: the Moon article 3D figure: three camera states, the ecliptic toggle, finite everywhere', () => {
  const c = moon3d();
  assert.deepEqual(c.states, ['new-moon', 'above', 'edge']);
  assert.deepEqual(c.objectIds, ['ecliptic', 'earth', 'orbit', 'moon', 'sun-line', 'day']);
  for (const name of c.states) assert.ok(stateTargets(c, name).camera, `${name} has a camera pose`);
  close(stateTargets(c, 'above').camera.polar, 0.05);
  assert.ok(!visibleIds(c, scopeForState(c, null, { showEcliptic: 0 })).has('ecliptic') === false, 'objects stay ref-visible even when hidden (the ref rule covers layers and readouts)');
  for (const name of [null, ...c.states]) for (const v of evaluateAll(c, scopeForState(c, name)).values()) assert.ok(Number.isFinite(v));
  assert.equal(c.spec.shows.fallback.poster, 'assets/poster-fig-orbit3d.svg');
  assert.ok(fs.existsSync(path.join(root, 'articles/moon/assets/poster-fig-orbit3d.svg')), 'build wrote the fallback poster file');
});

// ----------------------------------------------------------------- chunk

test('the lazy chunk URL resolves beside the runtime script', () => {
  assert.equal(chunkUrl('https://x.test/explainers/dist/explainers-runtime.v1.js'), 'https://x.test/explainers/dist/explainers-3d.v1.js');
  assert.equal(chunkUrl('', 'https://x.test/articles/moon/'), `https://x.test/articles/moon/${CHUNK_NAME}`, 'without a captured src the page URL is the base');
  assert.equal(CHUNK_NAME, path.basename(CHUNK_FILE));
});

// The committed chunk is checked on its own so `npm test` passes without
// tools/node_modules (the Pages workflow installs nothing: publishing needs no
// npm). When esbuild is installed the chunk is also rebuilt and compared, which
// is what catches a stale dist/ locally.
async function rebuiltChunk() {
  try {
    return await buildChunk();
  } catch (err) {
    if (err && err.code === 'MODULE_NOT_FOUND' && /esbuild/.test(err.message)) return null;
    throw err;
  }
}

test('the 3D chunk is current in dist/, an ESM module with three bundled, under 200 KB gzip, listed in dist/integrity.json', async (t) => {
  const code = fs.readFileSync(path.join(root, OUTFILE), 'utf8');
  const rebuilt = await rebuiltChunk();
  if (rebuilt) {
    assert.equal(rebuilt.threeVersion, '0.185.0');
    assert.equal(code, rebuilt.code, `${OUTFILE} is stale; run: node tools/build-3d.mjs`);
  } else {
    t.diagnostic('esbuild is not installed under tools/; the committed chunk is checked without a rebuild');
  }
  assert.equal(OUTFILE, CHUNK_FILE);
  assert.doesNotMatch(code, /[ \t]+$/m, 'no trailing whitespace (the pre-commit hook refuses it)');
  assert.match(code, /^\/\/ explainers-3d v1\.0\.0 — GENERATED by tools\/build-3d\.mjs from lib\/scene3d\/ \+ three 0\.185\.0/);
  assert.match(code, /export\{[^}]*\bmountScene3d\b/, 'ESM export of mountScene3d');
  assert.match(code, /WebGLRenderer|WEBGL_lose_context|precision highp float/, 'three is bundled in');
  assert.doesNotMatch(code, /https?:\/\/(cdn|unpkg|jsdelivr)/, 'no CDN');
  assert.doesNotMatch(code, /\bimport\s*\(/, 'no nested lazy imports');
  const gz = gzipSize(code);
  assert.ok(gz <= GZIP_BUDGET, `chunk is ${gz} bytes gzipped`);
  assert.ok(gz > 50 * 1000, 'sanity: three really is in there');
  assert.ok(fs.existsSync(path.join(root, ENTRY)));
  const table = JSON.parse(fs.readFileSync(path.join(root, INTEGRITY_FILE), 'utf8'));
  assert.ok(table[CHUNK_FILE], 'the manifest lists the chunk');
  assert.equal(table[CHUNK_FILE], computeIntegrity(root)[CHUNK_FILE]);
});

test('objects: a free label (position, no anchor) evaluates through labelPosition; an anchored one has none', () => {
  const getter = (v) => (typeof v === 'number' ? () => v : (scope) => Function('scope', `with (scope) { return ${v}; }`)(scope));
  const labels = labelSpecs([
    { id: 'sun', kind: 'label', text: 'sunlight', position: ['2*cos(a)', 0, '-2*sin(a)'] },
    { id: 'ball', kind: 'sphere', radius: 1, label: 'Ball' },
    { id: 'tag', kind: 'label', text: 'tag', anchor: 'ball', offset: [0, 22] },
  ], getter);
  const scope = { a: 0, cos: Math.cos, sin: Math.sin };
  assert.deepEqual(labelPosition(labels[0], scope), [2, 0, -0]);
  assert.equal(labelPosition(labels[1], scope), null, 'object label keys anchor to their object');
  assert.equal(labelPosition(labels[2], scope), null, 'anchored labels have no free position');
  assert.ok(Array.isArray(labels[0].position) && labels[0].position.every((g) => typeof g === 'function'), 'position is an array of getters');
});
