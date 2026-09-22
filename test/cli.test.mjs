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

function run(args, cwd = root) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const passFiles = fs.readdirSync(passDir).filter((f) => f.endsWith('.html')).map((f) => path.join('test/fixtures/pass', f));
const failFiles = fs.readdirSync(failDir).filter((f) => f.endsWith('.html')).sort();

function header(file) {
  const first = fs.readFileSync(path.join(failDir, file), 'utf8').split('\n')[0];
  const m = /<!-- explainers-test: (.*) -->/.exec(first);
  assert.ok(m, `${file} must start with an explainers-test header`);
  const opts = {};
  for (const kv of m[1].match(/\w+=(?:"[^"]*"|\S+)/g) || []) {
    const [k, ...rest] = kv.split('=');
    opts[k] = rest.join('=').replace(/^"(.*)"$/, '$1');
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

test('build renders KaTeX in place, is idempotent, and validates clean afterwards', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'explainers-build-'));
  const file = path.join(tmp, 'fig-months.html');
  fs.copyFileSync(path.join(passDir, 'fig-months.html'), file);
  const first = run(['build', file]);
  assert.equal(first.code, 0, first.err);
  assert.match(first.out, /1 formula\(s\) rendered/);
  const built = fs.readFileSync(file, 'utf8');
  assert.match(built, /<div class="x-tex" data-tex="\\frac\{1\}\{\\tok\{sun\}/);
  assert.match(built, /class="katex"/);
  assert.match(built, /<math /, 'htmlAndMathml output');
  assert.match(built, /enclosing sun/, '\\tok{sun} became an \\htmlClass span');
  const second = run(['build', file]);
  assert.equal(second.code, 0, second.err);
  assert.match(second.out, /\(unchanged\)/);
  assert.equal(fs.readFileSync(file, 'utf8'), built, 'idempotent');
  const v = run(['validate', file]);
  assert.equal(v.code, 0, v.err);
  assert.doesNotMatch(v.err, /formula not built/);
  fs.rmSync(tmp, { recursive: true, force: true });
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
