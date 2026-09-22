// The pure parts of the browser runtime, run in Node: the format catalogue,
// easing and transitions, the shared clock under an injected time source,
// state application, deep-link parsing, layout mapping, models, and the
// concatenation build (valid JS, current in dist/, under the size budget).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateSpec, scopeForState } from '../lib/spec.js';
import { format, compileTemplate, renderTemplate } from '../lib/core/format.js';
import { smoothstep, transition } from '../lib/core/ease.js';
import { createClock } from '../lib/core/clock.js';
import { coerce, isDiscrete, stateTargets, activeState, controlOf, visibleIds } from '../lib/core/state.js';
import { parseHash, formatHash, glossaryTarget } from '../lib/core/deeplink.js';
import { worldToPx, splitBoxes, dprFor } from '../lib/core/layout.js';
import { constrainPoint } from '../lib/core/drag.js';
import { niceTicks, tickLabel } from '../lib/scene2d/plot.js';
import { getter } from '../lib/scene2d/getters.js';
import { fitBox } from '../lib/scene2d/label.js';
import { kepler } from '../lib/scene2d/models/kepler.js';
import { twobody } from '../lib/scene2d/models/twobody.js';
import { cam } from '../lib/scene2d/models/cam.js';
import { lunar } from '../lib/scene2d/models/lunar.js';
import { MODEL_FUNCTIONS } from '../lib/scene2d/models/index.js';
import { MODELS } from '../lib/spec.js';
import { bundle, gzipSize, OUTFILE, ORDER } from '../tools/build-runtime.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const MINUS = '−', NBSP = ' ';

function figMonths() {
  const html = fs.readFileSync(path.join(root, 'articles/moon/index.html'), 'utf8');
  const m = /<script type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  return validateSpec(JSON.parse(m[1]), { figureId: 'fig-months', palette: ['sun', 'moon', 'earth', 'star', 'muted'] });
}

// ---------------------------------------------------------------- format

test('format: the whole Formats table', () => {
  assert.equal(format(27.321661, '.2f'), '27.32');
  assert.equal(format(-1.5, '.1f'), `${MINUS}1.5`, 'real minus sign');
  assert.equal(format(384400, ',d'), '384,400');
  assert.equal(format(-1234.6, ',d'), `${MINUS}1,235`);
  assert.equal(format(123.44, 'deg'), '123.4°');
  assert.equal(format(27.321661, 'dhm'), `27${NBSP}d 7${NBSP}h 43${NBSP}m`);
  assert.equal(format(29.530589, 'dhm'), `29${NBSP}d 12${NBSP}h 44${NBSP}m`);
  assert.equal(format(23.934472, 'hms'), `23${NBSP}h 56${NBSP}m 4${NBSP}s`);
  assert.equal(format(123456, 'sci'), '1.23×10⁵');
  assert.equal(format(0.000123, 'sci'), '1.23×10⁻⁴');
  assert.equal(format(0, 'sci'), '0');
  assert.equal(format(384400, 'unit:km'), `384,400${NBSP}km`);
  assert.equal(format(384400, 'unit:km', { imperial: true }), `238,855${NBSP}mi`);
  assert.equal(format(1, 'unit:mi', { imperial: true }), `1.6${NBSP}km`);
  assert.equal(format(Date.UTC(2000, 0, 1, 12, 0), 'date', { timeZone: 'UTC' }), 'Jan 1, 2000');
  assert.match(format(Date.UTC(2000, 0, 1, 12, 0), 'time', { timeZone: 'UTC' }), /12:00/);
  assert.match(format(Date.UTC(2000, 0, 1, 12, 0), 'datetime', { timeZone: 'UTC' }), /Jan 1, 2000.*12:00/);
  assert.equal(format(true, ',d'), '1', 'booleans read as 0/1');
  assert.equal(format(NaN, '.2f'), '—');
  assert.throws(() => format(1, 'bogus'));
});

test('templates render through the runtime evaluator with the figure scope', () => {
  const c = figMonths();
  const parts = compileTemplate('Moon–Sun angle: {deg(wrap(tau*t/T_sid - tau*t/Y)):.0f}° after {t:dhm}');
  assert.equal(renderTemplate(parts, scopeForState(c, 'new-moon')), `Moon–Sun angle: 0° after 0${NBSP}d 0${NBSP}h 0${NBSP}m`);
  const synodic = renderTemplate(parts, scopeForState(c, 'synodic'));
  assert.match(synodic, /^Moon–Sun angle: (0|360)° after 29/);
  assert.equal(getter('R*cos(tau*t/T_sid)')(scopeForState(c, 'sidereal')).toFixed(6), '3.000000');
  assert.equal(getter(2)(), 2);
  assert.equal(getter(true)(), 1);
});

// ------------------------------------------------------------------ ease

test('smoothstep and transitions: ease numbers, snap discrete keys, land exactly', () => {
  assert.equal(smoothstep(0), 0);
  assert.equal(smoothstep(0.5), 0.5);
  assert.equal(smoothstep(1), 1);
  assert.equal(smoothstep(-2), 0);
  assert.equal(smoothstep(0.25), 0.15625);
  const steps = [];
  let finished = false;
  const tr = transition({ from: { t: 0, showSun: 0 }, to: { t: 27.321661, showSun: 1 }, discrete: new Set(['showSun']), onStep: (o, k) => steps.push({ ...o, k }), onDone: () => { finished = true; } });
  for (let i = 0; i < 6; i++) tr.step(0.1);
  assert.ok(finished && tr.done);
  assert.equal(steps.at(-1).t, 27.321661, 'lands exactly on the target');
  assert.equal(steps.at(-1).k, 1);
  assert.equal(steps[0].showSun, 0, 'discrete keys hold before the midpoint');
  assert.equal(steps[2].showSun, 1, 'and snap at the midpoint');
  assert.ok(steps[1].t > 0 && steps[1].t < 27.321661);
  assert.ok(steps[1].t - steps[0].t < steps[2].t - steps[1].t, 'eases in');
  tr.step(1); // after done: no-op
  assert.equal(steps.length, 6);
});

test('transition under prefers-reduced-motion finishes on the first step; cancel stops it', () => {
  const seen = [];
  const tr = transition({ from: { t: 0 }, to: { t: 5 }, reduced: true, onStep: (o) => seen.push(o.t) });
  tr.step(0);
  assert.deepEqual(seen, [5]);
  const tr2 = transition({ from: { t: 0 }, to: { t: 5 }, onStep: (o) => seen.push(o.t) });
  tr2.cancel();
  tr2.step(1);
  assert.equal(seen.length, 1);
});

// ----------------------------------------------------------------- clock

test('clock: injected now/schedule, dt in seconds clamped to 100 ms, stops when idle', () => {
  let t = 1000;
  const queue = [];
  const clock = createClock({ now: () => t, schedule: (fn) => queue.push(fn) });
  const dts = [];
  clock.start();
  assert.equal(queue.length, 0, 'nothing scheduled without subscribers');
  const off = clock.onTick((dt) => dts.push(dt));
  assert.equal(queue.length, 1);
  const run = () => { const fns = queue.splice(0); for (const fn of fns) fn(); };
  run(); // first frame: dt 0
  t += 16; run();
  t += 500; run(); // a long gap is clamped
  assert.deepEqual(dts, [0, 0.016, 0.1]);
  clock.pause(true);
  run();
  assert.equal(queue.length, 0, 'paused: no frame scheduled');
  clock.pause(false);
  assert.equal(queue.length, 1);
  t += 20; run();
  assert.equal(dts.at(-1), 0, 'first frame after a pause has dt 0');
  off();
  run();
  assert.equal(queue.length, 0, 'no subscribers: the loop stops');
  assert.equal(clock.active, false);
});

// ----------------------------------------------------------------- state

test('state: coerce validates against the control; discrete kinds are known', () => {
  const c = figMonths();
  const t = controlOf(c, 't'), showSun = controlOf(c, 'showSun');
  assert.equal(coerce(t, 70), 60);
  assert.equal(coerce(t, -3), 0);
  assert.equal(coerce(t, 12.5), 12.5);
  assert.equal(coerce(showSun, true), 1);
  assert.equal(coerce(showSun, 0), 0);
  assert.equal(isDiscrete(t), false);
  assert.equal(isDiscrete(showSun), true);
  assert.equal(coerce({ kind: 'slider', values: [1, 2, 4] }, 3.2), 4);
  assert.equal(coerce({ kind: 'segmented', options: [{ value: 1 }, { value: 5 }] }, 4), 5);
  assert.equal(coerce({ kind: 'time', mode: 'scrub', window: '24h' }, 1e12), 86400e3);
  assert.equal(controlOf(c, 'nope'), null);
});

test('state: stateTargets and activeState round-trip every named state', () => {
  const c = figMonths();
  const { targets, caption } = stateTargets(c, 'sidereal');
  assert.deepEqual(targets, { t: 27.321661, showSun: 1 });
  assert.match(caption, /sidereal month/);
  for (const name of c.states) assert.equal(activeState(c, scopeForState(c, name)), name);
  assert.equal(activeState(c, scopeForState(c, null)), 'new-moon', 'the defaults are the first state');
  assert.equal(activeState(c, scopeForState(c, null, { t: 5 })), null);
  assert.throws(() => stateTargets(c, 'nope'));
  const withDrag = { spec: { notice: { states: [{ name: 'a', caption: '', drag: { p: [1, 2] } }] } } };
  assert.deepEqual(stateTargets(withDrag, 'a').targets, { 'p.x': 1, 'p.y': 2 });
});

// -------------------------------------------------------------- deep links

test('state: visibleIds hides what the figure hides: visible expressions, state overrides, drag previews', () => {
  const c = figMonths();
  const sunOn = visibleIds(c, scopeForState(c, 'synodic'));
  const sunOff = visibleIds(c, scopeForState(c, null, { showSun: 0 }));
  for (const id of ['sun-line', 'elongation', 'angle']) {
    assert.ok(sunOn.has(id), `${id} is drawn while the toggle is on`);
    assert.ok(!sunOff.has(id), `${id} is hidden while the toggle is off`);
  }
  for (const id of ['orbit', 'earth', 'star-line', 'trail', 'moon', 'elapsed', 't', 'showSun', 'R']) {
    assert.ok(sunOn.has(id) && sunOff.has(id), `${id} has no visible expression, so it is always visible`);
  }
  assert.deepEqual([...sunOn].filter((id) => !sunOff.has(id)).sort(), ['angle', 'elongation', 'sun-line']);
  // a state's visible.hide wins over the expression, and visible.show overrides a false one
  assert.ok(!visibleIds(c, scopeForState(c, 'synodic'), { hide: ['moon'] }).has('moon'));
  assert.ok(visibleIds(c, scopeForState(c, null, { showSun: 0 }), { show: ['sun-line'] }).has('sun-line'));
  assert.ok(!visibleIds(c, scopeForState(c, null, { showSun: 0 }), { show: ['sun-line'] }).has('elongation'));
  // a drag preview layer is drawn only while its handle is held
  const d = validateSpec({
    shows: { type: 'scene2d', view: { x: [-2, 2], y: [-2, 2] }, layers: [
      { id: 'rim', kind: 'circle', cx: 0, cy: 0, r: 1, stroke: 'mark' },
      { id: 'ghost', kind: 'segment', from: [0, 0], to: ['p.x', 'p.y'], stroke: 'mark' },
    ] },
    manipulates: { controls: [{ kind: 'drag', name: 'p', default: [1, 0], constrain: 'free', token: 'mark', preview: ['ghost'] }] },
    notice: { steps: 'none', states: [] },
  }, { figureId: 'fig-drag' });
  assert.ok(!visibleIds(d, scopeForState(d)).has('ghost'));
  assert.ok(visibleIds(d, scopeForState(d, null, { 'p.dragging': 1 })).has('ghost'));
  assert.ok(visibleIds(d, scopeForState(d)).has('rim') && visibleIds(d, scopeForState(d)).has('p'));
});

test('deep links: #fig-x=state, #fig-x, glossary rows and first uses', () => {
  assert.deepEqual(parseHash('#fig-months=sidereal'), { figId: 'fig-months', state: 'sidereal' });
  assert.deepEqual(parseHash('#fig-months'), { figId: 'fig-months', state: null });
  assert.equal(parseHash('#two-months'), null);
  assert.equal(parseHash(''), null);
  assert.equal(parseHash('#fig-months=bad state'), null);
  assert.equal(formatHash('fig-months', 'synodic'), '#fig-months=synodic');
  assert.deepEqual(glossaryTarget('#g-synodic-month'), { kind: 'row', slug: 'synodic-month', id: 'g-synodic-month' });
  assert.deepEqual(glossaryTarget('#t-synodic-month'), { kind: 'first', slug: 'synodic-month', id: 't-synodic-month' });
  assert.equal(glossaryTarget('#fig-months'), null);
});

// ---------------------------------------------------------------- layout

test('layout: uniform world->px mapping with y up, DPR choice, split boxes', () => {
  const m = worldToPx({ x: [-6, 6], y: [-4, 4] }, { x: 0, y: 0, width: 600, height: 400 });
  assert.equal(m.s, 50);
  assert.deepEqual([m.x(0), m.y(0)], [300, 200]);
  assert.deepEqual([m.x(-6), m.y(4)], [0, 0], 'top-left of the view is the top-left pixel');
  assert.deepEqual([m.wx(300), m.wy(200)], [0, 0]);
  const letterboxed = worldToPx({ x: [-1, 1], y: [-1, 1] }, { x: 0, y: 0, width: 300, height: 200 });
  assert.equal(letterboxed.s, 100, 'circles stay round: the smaller scale wins');
  assert.equal(letterboxed.x(-1), 50, 'centered');
  assert.equal(dprFor({ devicePixelRatio: 1 }), 1);
  assert.equal(dprFor({ devicePixelRatio: 2 }), 2);
  assert.equal(dprFor({ devicePixelRatio: 1.5 }), 1);
  const boxes = splitBoxes({ x: 0, y: 0, width: 600, height: 400 }, [{ at: 'right' }, { at: 'inset:bottom-left' }]);
  assert.equal(boxes.main.width + boxes.panels[0].width, 600);
  assert.equal(boxes.panels[1].inset, true);
});

test('labels fold back inside the panel, rise above the corner buttons, and stack when they collide', () => {
  const bounds = { x: 0, y: 0, width: 300, height: 200 };
  const box = (x, y, w = 80, h = 14) => ({ x, y, w, h });
  // a box crossing the right edge is right-aligned at the edge minus the pad; the left edge likewise
  assert.deepEqual(fitBox(box(260, 100), bounds), box(216, 100));
  assert.deepEqual(fitBox(box(-30, 100), bounds), box(4, 100));
  assert.equal(fitBox(box(10, 10, 400), bounds).x, 4, 'wider than the panel: the left edge wins');
  assert.deepEqual(fitBox(box(10, 195), bounds), box(10, 182));
  assert.deepEqual(fitBox(box(10, -5), bounds), box(10, 4));
  assert.deepEqual(fitBox(box(100, 100), bounds), box(100, 100), 'a box that fits is untouched');
  // the corner buttons: a readout over them moves up to sit above the (padded) group, one beside them stays
  const buttons = box(0, 140, 150, 60);
  assert.deepEqual(fitBox(box(10, 150), bounds, { obstacles: [buttons] }), box(10, 126));
  assert.deepEqual(fitBox(box(200, 150), bounds, { obstacles: [buttons] }), box(200, 150));
  // coincident labels stack by their height downward, or upward near the bottom edge
  const first = fitBox(box(100, 50), bounds);
  assert.deepEqual(fitBox(box(100, 50), bounds, { avoid: [first] }), box(100, 66));
  const low = fitBox(box(100, 182), bounds);
  assert.deepEqual(fitBox(box(100, 182), bounds, { avoid: [low] }), box(100, 166));
});

test('drag constraints project points', () => {
  const view = { x: [-2, 2], y: [-1, 1] };
  assert.deepEqual(constrainPoint('free', [3, 3], { view, start: [0, 0] }), [3, 3]);
  assert.deepEqual(constrainPoint('x', [3, 3], { view, start: [0, 0.5] }), [3, 0.5]);
  assert.deepEqual(constrainPoint('view', [3, 3], { view, start: [0, 0] }), [2, 1]);
  const [cx, cy] = constrainPoint('circle:2', [3, 4], { view, start: [0, 0] });
  assert.equal(Math.hypot(cx, cy).toFixed(6), '2.000000');
  assert.deepEqual(constrainPoint('segment:[[0,0],[2,0]]', [1, 5], { view, start: [0, 0] }), [1, 0]);
  assert.deepEqual(constrainPoint('segment:[[0,0],[2,0]]', [9, 5], { view, start: [0, 0] }), [2, 0]);
});

test('plot ticks are nice numbers that cover the axis', () => {
  assert.deepEqual(niceTicks(0, 10, 5).ticks, [0, 2, 4, 6, 8, 10]);
  assert.deepEqual(niceTicks(0, 1, 4).ticks, [0, 0.2, 0.4, 0.6, 0.8, 1]);
  assert.deepEqual(niceTicks(-3, 3, 6).ticks, [-3, -2, -1, 0, 1, 2, 3]);
  assert.equal(tickLabel(0.2, 0.2), '0.2');
  assert.equal(tickLabel(-2, 1), `${MINUS}2`);
});

// ---------------------------------------------------------------- models

test('models compute every output lib/spec.js declares, finite', () => {
  for (const [name, m] of Object.entries(MODELS)) {
    const params = {};
    for (const p of Object.keys(m.params)) params[p] = { a: 1, e: 0.3, M: 1, m1: 1, m2: 1, r0: 1, v0: 1, t: 10, theta: 0.5, lift: 1, span: 2 }[p];
    const out = MODEL_FUNCTIONS[name](params);
    assert.deepEqual(Object.keys(out).sort(), Object.keys(m.outputs).sort(), name);
    for (const v of Object.values(out)) assert.ok(Number.isFinite(v), `${name} output finite`);
  }
  const circ = kepler({ a: 2, e: 0, M: Math.PI / 2 });
  assert.equal(circ.r.toFixed(9), '2.000000000');
  assert.equal(circ.nu.toFixed(9), (Math.PI / 2).toFixed(9));
  const ell = kepler({ a: 1, e: 0.5, M: 0 });
  assert.equal(ell.r.toFixed(9), '0.500000000', 'periapsis at M = 0');
  const tb = twobody({ m1: 1, m2: 1, r0: 1, v0: 1, t: 0 });
  assert.equal((tb.x2 - tb.x1).toFixed(9), '1.000000000');
  assert.equal(tb.x1 + tb.x2, 0, 'center of mass at the origin');
  const later = twobody({ m1: 1, m2: 1, r0: 1, v0: 1, t: 0.3 });
  assert.ok(later.y2 > 0, 'body 2 moves along +y');
  assert.equal(cam({ theta: 0, lift: 2, span: 1 }).lift, 2);
  assert.equal(cam({ theta: 2, lift: 2, span: 1 }).lift, 0);
  const moon = lunar({ t: 0 });
  assert.ok(moon.dist > 356000 && moon.dist < 407000);
  assert.ok(moon.phase >= 0 && moon.phase < 1);
});

// ------------------------------------------------------------------ build

test('the concatenation build is valid JS, current in dist/, and under 40 KB gzip', () => {
  const out = bundle(root);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'explainers-runtime-'));
  const file = path.join(tmp, 'runtime.js');
  fs.writeFileSync(file, out);
  const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr);
  const load = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(file)}); console.log(typeof globalThis.explainers)`], { encoding: 'utf8' });
  assert.equal(load.status, 0, load.stderr);
  assert.equal(load.stdout.trim(), 'undefined', 'without a document the runtime does not boot');
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const needle of ['x-fig:mount', 'x-fig:set', 'x-fig:state', 'x-fig:play', 'validateSpec', '_steps', 'x-tip', 'replaceState']) assert.ok(out.includes(needle), needle);
  assert.doesNotMatch(out, /^\s*(import|export)\b/m);
  assert.equal(fs.readFileSync(path.join(root, OUTFILE), 'utf8'), out, `${OUTFILE} is stale; run: node tools/build-runtime.mjs`);
  assert.ok(gzipSize(out) <= 40 * 1000, `runtime is ${gzipSize(out)} bytes gzipped`);
  for (const rel of ORDER) assert.ok(fs.existsSync(path.join(root, rel)), rel);
});

test('the stylesheet exists, is small, and styles the contract DOM', () => {
  const css = fs.readFileSync(path.join(root, 'dist/explainers.v1.css'), 'utf8');
  assert.ok(gzipSize(css) <= 8 * 1000, `css is ${gzipSize(css)} bytes gzipped`);
  for (const sel of ['.x-canvas-box', '.x-ctl-slider', '.x-toggle', '.x-play', '.x-stepper', '#x-tip', '.x-glossary', '.x-tex', '.x-ref', 'a.term', 'dfn', 'light-dark(', 'prefers-reduced-motion', '::-webkit-slider-thumb']) assert.ok(css.includes(sel), sel);
});
