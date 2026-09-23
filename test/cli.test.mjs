// Runs the committed bundle tools/explainers.cjs on every fixture.
// Pass fixtures must exit 0; each fail fixture must exit 1 and print its CODE
// in the file:line: CODE figure-id: message format. Every code in
// ERROR_CATALOGUE must have at least one fail fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ERROR_CATALOGUE } from '../lib/spec.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const CLI = path.join(root, 'tools/explainers.cjs');
const passDir = path.join(here, 'fixtures/pass');
const failDir = path.join(here, 'fixtures/fail');
const warnDir = path.join(here, 'fixtures/warn');

function run(args, cwd = root) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const passFiles = fs.readdirSync(passDir).filter((f) => f.endsWith('.html')).map((f) => path.join('test/fixtures/pass', f));
const failFiles = fs.readdirSync(failDir).filter((f) => f.endsWith('.html')).sort();
const warnFiles = fs.readdirSync(warnDir).filter((f) => f.endsWith('.html')).sort();

function header(file, dir = failDir) {
  const first = fs.readFileSync(path.join(dir, file), 'utf8').split('\n')[0];
  const m = /<!-- explainers-test: (.*) -->/.exec(first);
  assert.ok(m, `${file} must start with an explainers-test header`);
  const opts = {};
  for (const kv of m[1].match(/\w+=(?:"(?:[^"\\]|\\.)*"|\S+)/g) || []) {
    const [k, ...rest] = kv.split('=');
    const v = rest.join('=');
    opts[k] = v.startsWith('"') ? JSON.parse(v) : v; // quoted values are JSON strings (the warning regexes contain quotes)
  }
  return opts;
}

test('the bundle exists and answers --help and --version from a clean shell', () => {
  assert.ok(fs.existsSync(CLI), 'tools/explainers.cjs is missing; run: cd tools && npm install && node build-cli.mjs');
  const help = run(['--help'], os.tmpdir());
  assert.equal(help.code, 0);
  assert.match(help.out, /validate <html\.\.\.>/);
  const version = run(['--version'], os.tmpdir());
  assert.equal(version.code, 0);
  assert.match(version.out, /explainers-cli .*katex \d/);
  assert.equal(run([]).code, 2);
  assert.equal(run(['frobnicate', 'x.html']).code, 2);
  assert.equal(run(['validate']).code, 2, 'validate without files is a usage error');
  assert.equal(run(['validate', 'no-such-file.html']).code, 2);
});

test('pass fixtures validate, enumerate states and fit the budget', () => {
  assert.ok(passFiles.length >= 2);
  const v = run(['validate', ...passFiles, '--budget', '170k']);
  assert.equal(v.code, 0, v.err);
  assert.doesNotMatch(v.err, /: [A-Z]+_[A-Z_]+ /, 'no error codes on stderr');
  for (const f of passFiles) assert.match(v.out, new RegExp(`${f}: \\d+ figure\\(s\\) checked`));
  const s = run(['states', ...passFiles]);
  assert.equal(s.code, 0, s.err);
  assert.match(s.out, /fig-months \(scene2d\): 3 state\(s\): new-moon, sidereal, synodic/);
  assert.match(s.out, /synodic +t=29.530589 showSun=1/);
  const b = run(['budget', ...passFiles]);
  assert.equal(b.code, 0, b.err);
  assert.match(b.out, /total gzip bytes \(budget 170000, ok\)/);
});

test('build renders KaTeX, inserts the poster, resolves integrity, is idempotent, and validates clean afterwards', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'explainers-build-'));
  const file = path.join(tmp, 'fig-months.html');
  fs.copyFileSync(path.join(passDir, 'fig-months.html'), file);
  const first = run(['build', file]);
  assert.equal(first.code, 0, first.err);
  assert.match(first.out, /1 formula\(s\) rendered, 1 poster\(s\) written, 0 caption\(s\) amended, 2 integrity attribute\(s\) set/);
  const built = fs.readFileSync(file, 'utf8');
  assert.match(built, /<div class="x-tex" data-tex="\\frac\{1\}\{\\tok\{sun\}/);
  assert.match(built, /class="katex"/);
  assert.match(built, /<math /, 'htmlAndMathml output');
  assert.match(built, /enclosing sun/, '\\tok{sun} became an \\htmlClass span');
  assert.match(built, /<figure class="x-fig" id="fig-months" data-aspect="3:2">\n<svg class="x-poster" id="fig-months-poster" [^>]*data-poster="[0-9a-f]{40}">[\s\S]*<\/svg>\n<script type="application\/json">/, 'the poster is the first child, before the JSON block');
  assert.equal((built.match(/Not to scale\./g) || []).length, 1, 'the caption already said it; not repeated');
  const integrity = JSON.parse(fs.readFileSync(path.join(root, 'dist/integrity.json'), 'utf8'));
  assert.ok(built.includes(`<link rel="stylesheet" href="../../dist/explainers.v1.css" integrity="${integrity['dist/explainers.v1.css']}">`));
  assert.ok(built.includes(`<script defer src="../../dist/explainers-runtime.v1.js" integrity="${integrity['dist/explainers-runtime.v1.js']}"></script>`));
  assert.doesNotMatch(built, /\{\{integrity:/, 'placeholders resolved');
  const second = run(['build', file]);
  assert.equal(second.code, 0, second.err);
  assert.match(second.out, /0 poster\(s\) written, 0 caption\(s\) amended, 0 integrity attribute\(s\) set \(unchanged\)/);
  assert.equal(fs.readFileSync(file, 'utf8'), built, 'idempotent');
  const v = run(['validate', file]);
  assert.equal(v.code, 0, v.err);
  assert.doesNotMatch(v.err, /formula not built|run: explainers build|warning/, 'a built article validates without warnings');
  // a stale integrity value is refreshed by build and refused by validate
  const stale = built.replace(integrity['dist/explainers.v1.css'], 'sha384-' + 'A'.repeat(64));
  fs.writeFileSync(file, stale);
  const sv = run(['validate', file]);
  assert.equal(sv.code, 1);
  assert.match(sv.err, /INTEGRITY_STALE -: the stylesheet <link> has integrity="sha384-A+" but dist\/integrity\.json says sha384-/);
  assert.equal(run(['build', file]).code, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), built, 'build refreshes a stale attribute');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('build appends the caveat sentence once, and externalizes posters above 8 KiB as <img> + assets/poster-<fig>.svg', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'explainers-build-'));
  const file = path.join(tmp, 'index.html');
  const base = fs.readFileSync(path.join(passDir, 'minimal.html'), 'utf8');
  const withCaveat = base.replace('"view": { "x": [-2, 2], "y": [-2, 2] },', '"view": { "x": [-2, 2], "y": [-2, 2] },\n    "caveats": { "not_to_scale": true },');
  fs.writeFileSync(file, withCaveat);
  const b1 = run(['build', file]);
  assert.equal(b1.code, 0, b1.err);
  assert.match(b1.out, /1 caption\(s\) amended/);
  let built = fs.readFileSync(file, 'utf8');
  assert.match(built, /<figcaption>Drag the slider\. Not to scale\.<\/figcaption>/);
  assert.match(built, /<svg class="x-poster" id="fig-dot-poster"/, 'small poster inline');
  assert.equal(run(['build', file]).code, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), built, 'idempotent: the sentence is not appended twice');
  // 300 text layers push the poster over the inline limit
  const many = Array.from({ length: 300 }, (_, i) => `{ "id": "t${i}", "kind": "text", "at": [${(i % 20) / 5 - 2}, ${Math.floor(i / 20) / 4 - 2}], "text": "label ${i}", "size": 9 }`).join(',\n      ');
  fs.writeFileSync(file, built.replace('{ "id": "dot", "kind": "circle"', `${many},\n      { "id": "dot", "kind": "circle"`));
  const b2 = run(['build', file]);
  assert.equal(b2.code, 0, b2.err);
  assert.match(b2.out, /1 poster\(s\) written \(1 external: fig-dot\)/);
  built = fs.readFileSync(file, 'utf8');
  assert.match(built, /<figure class="x-fig" id="fig-dot" data-aspect="1:1">\n<img class="x-poster" src="assets\/poster-fig-dot.svg" alt="" width="704" height="704" aria-hidden="true" data-poster="[0-9a-f]{40}">\n<script/);
  assert.doesNotMatch(built, /<svg class="x-poster"/);
  const asset = path.join(tmp, 'assets/poster-fig-dot.svg');
  assert.ok(fs.existsSync(asset));
  assert.ok(fs.statSync(asset).size > 8 * 1024);
  assert.match(fs.readFileSync(asset, 'utf8'), /^<svg class="x-poster" id="fig-dot-poster" xmlns="http:\/\/www\.w3\.org\/2000\/svg"[\s\S]*>label 299<[\s\S]*<\/svg>$/);
  const v = run(['validate', file]);
  assert.equal(v.code, 0, v.err);
  assert.doesNotMatch(v.err, /poster/);
  fs.rmSync(asset);
  assert.match(run(['validate', file]).err, /warning fig-dot: poster file assets\/poster-fig-dot.svg not found; run: explainers build/);
  assert.equal(run(['build', file]).code, 0);
  assert.ok(fs.existsSync(asset), 'build restores a missing external poster');
  // shrinking the spec again brings the poster back inline and removes the file
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(`${many},\n      `, ''));
  assert.equal(run(['build', file]).code, 0);
  assert.match(fs.readFileSync(file, 'utf8'), /<svg class="x-poster" id="fig-dot-poster"/);
  assert.ok(!fs.existsSync(asset), 'the orphaned asset is removed');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('scene3d: validate warns about a missing fallback poster file; build writes it as the first frame and validates clean', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'explainers-3d-'));
  const file = path.join(tmp, 'index.html');
  fs.copyFileSync(path.join(passDir, 'scene3d.html'), file);
  const v0 = run(['validate', file]);
  assert.equal(v0.code, 0, v0.err);
  assert.match(v0.err, /warning fig-ball: no poster; run: explainers build/, 'unbuilt: no poster at all yet');
  const b = run(['build', file]);
  assert.equal(b.code, 0, b.err);
  assert.match(b.out, /1 poster\(s\) written/);
  const asset = path.join(tmp, 'assets/poster-fig-ball.svg');
  assert.ok(fs.existsSync(asset), 'the fallback poster file is the build poster');
  const built = fs.readFileSync(file, 'utf8');
  assert.match(built, /<svg class="x-poster" id="fig-ball-poster"/, 'and the inline first frame is still there');
  assert.equal(fs.readFileSync(asset, 'utf8'), /<svg class="x-poster"[\s\S]*?<\/svg>/.exec(built)[0], 'same bytes');
  assert.match(fs.readFileSync(asset, 'utf8'), />ball<\/text>/, 'the projected scene, not a framed caption');
  const v1 = run(['validate', file]);
  assert.equal(v1.code, 0, v1.err);
  assert.doesNotMatch(v1.err, /poster|warning/, 'a built scene3d article validates without warnings');
  fs.rmSync(asset);
  assert.match(run(['validate', file]).err, /warning fig-ball: fallback poster assets\/poster-fig-ball\.svg not found; run: explainers build/);
  assert.equal(run(['build', file]).code, 0);
  assert.ok(fs.existsSync(asset), 'build restores the fallback poster file while the inline poster is current');
  fs.writeFileSync(asset, '<svg/>');
  assert.match(run(['validate', file]).err, /fallback poster assets\/poster-fig-ball\.svg is stale; run: explainers build/);
  assert.equal(run(['build', file]).code, 0);
  assert.doesNotMatch(run(['validate', file]).err, /stale/);
  const s = run(['states', file]);
  assert.match(s.out, /fig-ball \(scene3d\): 2 state\(s\): top, side/);
  assert.match(s.out, /top +spin=0 pin\.lat=90 pin\.lon=0/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('every warning fixture exits 0 and prints its warning in file:line: warning figure-id: message form', () => {
  assert.ok(warnFiles.length >= 6, 'run node test/fixtures/make-fail.mjs');
  for (const f of warnFiles) {
    const opts = header(f, warnDir);
    const rel = path.join('test/fixtures/warn', f);
    const r = run([opts.command || 'validate', rel]);
    assert.equal(r.code, 0, `${f}: expected exit 0\n${r.err}`);
    assert.doesNotMatch(r.err, /: [A-Z]+_[A-Z_]+ /, `${f}: warnings only`);
    const lineRe = new RegExp(`^${rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\d+: warning (fig-[a-z0-9-]+|-): .*${opts.warning.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'm');
    assert.match(r.err, lineRe, `${f}: stderr should contain the warning\n${r.err}`);
  }
});

test('every fail fixture exits 1 and names its code in file:line: CODE figure-id: message form', () => {
  assert.ok(failFiles.length > 0, 'run node test/fixtures/make-fail.mjs');
  for (const f of failFiles) {
    const opts = header(f);
    const rel = path.join('test/fixtures/fail', f);
    const args = [opts.command || 'validate', rel, ...(opts.args ? opts.args.split(' ') : [])];
    const r = run(args);
    assert.equal(r.code, 1, `${f}: expected exit 1, got ${r.code}\n${r.out}\n${r.err}`);
    const lineRe = new RegExp(`^${rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\d+: ${opts.code} (fig-[a-z0-9-]+|-|[a-z0-9-]+): .+`, 'm');
    assert.match(r.err, lineRe, `${f}: stderr should contain the ${opts.code} line\n${r.err}`);
  }
});

test('every error code in the catalogue has at least one fail fixture', () => {
  const covered = new Set(failFiles.map((f) => header(f).code));
  const missing = Object.keys(ERROR_CATALOGUE).filter((c) => !covered.has(c));
  assert.deepEqual(missing, [], `codes without a fixture: ${missing.join(', ')}`);
  for (const c of covered) assert.ok(ERROR_CATALOGUE[c], `${c} is not in ERROR_CATALOGUE`);
});

test('`errors` and `vocab` print the catalogue and the vocabulary', () => {
  const e = run(['errors']);
  assert.equal(e.code, 0);
  for (const c of Object.keys(ERROR_CATALOGUE)) assert.match(e.out, new RegExp(`^${c}: `, 'm'));
  const v = run(['vocab']);
  assert.equal(v.code, 0);
  assert.match(v.out, /### Figure \(top level\)/);
  assert.match(v.out, /\| `smoothstep` \|/);
});
