import { nearestState, stateTargets } from '../lib/core/state.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateSpec, scopeForState, evaluateAll, describeVocabulary, parseTemplate, windowToMs,
  FigSpecError, ERROR_CATALOGUE, FIGURE_TYPES, CONTROL_KINDS, LAYER_KINDS, OBJECT_KINDS, FORMATS, MODELS, SCHEMA,
} from '../lib/spec.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PALETTE = ['sun', 'moon', 'earth', 'star', 'muted'];

// The fig-months spec is read from the PoC fixture so there is exactly one copy.
function figMonths() {
  const html = fs.readFileSync(path.join(here, 'fixtures/pass/fig-months.html'), 'utf8');
  const m = /<script type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  return JSON.parse(m[1]);
}

const ok = (spec, opts = {}) => validateSpec(spec, { figureId: 'fig-test', palette: PALETTE, ...opts });
function expectCode(spec, code, pathRe) {
  assert.throws(
    () => ok(spec),
    (e) => {
      assert.ok(e instanceof FigSpecError, `expected FigSpecError, got ${e}`);
      assert.equal(e.code, code, `expected ${code}, got ${e.code}: ${e.message}`);
      assert.equal(e.figureId, 'fig-test');
      if (pathRe) assert.match(e.path, pathRe);
      assert.ok(ERROR_CATALOGUE[e.code], `${e.code} must be in ERROR_CATALOGUE`);
      return true;
    },
  );
}
const mutate = (fn) => { const s = figMonths(); fn(s); return s; };

test('fig-months (the phase-2 PoC spec) validates and compiles', () => {
  const c = ok(figMonths(), { figureId: 'fig-months' });
  assert.equal(c.type, 'scene2d');
  assert.deepEqual(c.layerIds, ['orbit', 'earth', 'star-line', 'sun-line', 'trail', 'elongation', 'moon']);
  assert.deepEqual(c.states, ['new-moon', 'sidereal', 'synodic']);
  assert.deepEqual(c.exposedNames, ['t', 'showSun']);
  assert.deepEqual([...c.defaults.keys()], ['R', 'T_sid', 'Y', 'T_syn', 't', 'showSun']);
  assert.equal(c.expressions.length, 16);
  assert.ok(c.refIds.includes('moon') && c.refIds.includes('t') && c.refIds.includes('R'));
});

test('every state evaluates finite; the synodic state lands the Moon back on the Sun line', () => {
  const c = ok(figMonths());
  for (const name of [null, ...c.states]) {
    const r = evaluateAll(c, scopeForState(c, name));
    for (const v of r.values()) assert.ok(Number.isFinite(v));
  }
  const r = evaluateAll(c, scopeForState(c, 'synodic'));
  const angle = r.get('shows.readouts[2].text');
  assert.ok(Math.abs(angle) < 0.5 || Math.abs(angle - 360) < 0.5, `Moon–Sun angle at synodic month is ~0°, got ${angle}`);
  assert.throws(() => scopeForState(c, 'nope'), (e) => e.code === 'SPEC_UNKNOWN_REF');
});

test('SPEC_UNKNOWN_KEY: additionalProperties:false at every level', () => {
  expectCode(mutate((s) => { s.colour = 1; }), 'SPEC_UNKNOWN_KEY', /^colour$/);
  expectCode(mutate((s) => { s.shows.layers[0].colour = 'red'; }), 'SPEC_UNKNOWN_KEY', /layers\[0\]\.colour/);
  expectCode(mutate((s) => { s.shows.layers[0].rx = 1; }), 'SPEC_UNKNOWN_KEY', /layers\[0\]\.rx/, 'a key from another kind is unknown');
  expectCode(mutate((s) => { s.manipulates.controls[0].minimum = 0; }), 'SPEC_UNKNOWN_KEY');
  expectCode(mutate((s) => { s.notice.extra = 1; }), 'SPEC_UNKNOWN_KEY');
  expectCode(mutate((s) => { s.shows.view.z = [0, 1]; }), 'SPEC_UNKNOWN_KEY');
  expectCode(mutate((s) => { s.shows.constants.T_syn.tolerance = 1; }), 'SPEC_UNKNOWN_KEY');
});

test('SPEC_MISSING_KEY: required keys have no defaults', () => {
  expectCode(mutate((s) => { delete s.notice; }), 'SPEC_MISSING_KEY', /^notice$/);
  expectCode(mutate((s) => { delete s.shows.view; }), 'SPEC_MISSING_KEY', /shows\.view/);
  expectCode(mutate((s) => { delete s.shows.layers[0].r; }), 'SPEC_MISSING_KEY', /layers\[0\]\.r/);
  expectCode(mutate((s) => { delete s.shows.layers[0].kind; }), 'SPEC_MISSING_KEY', /kind/);
  expectCode(mutate((s) => { delete s.manipulates.controls[0].default; }), 'SPEC_MISSING_KEY');
  expectCode(mutate((s) => { delete s.manipulates.controls[0].min; }), 'SPEC_MISSING_KEY', /min/);
  expectCode(mutate((s) => { delete s.notice.states[0].caption; }), 'SPEC_MISSING_KEY', /caption/);
  expectCode(mutate((s) => { delete s.shows.readouts[0].anchor; }), 'SPEC_MISSING_KEY', /readouts\[0\]/);
  expectCode(mutate((s) => { s.shows.layers.push({ id: 'lens', kind: 'region', of: ['orbit'], op: 'union' }); }), 'SPEC_MISSING_KEY', /fill/);
});

test('SPEC_BAD_TYPE: wrong scalar types and closed value sets', () => {
  expectCode(mutate((s) => { s.shows.layers[0].r = true; }), 'SPEC_BAD_TYPE');
  expectCode(mutate((s) => { s.shows.layers[0].dash = [4]; }), 'SPEC_BAD_TYPE');
  expectCode(mutate((s) => { s.shows.layers[0].arrow = 'middle'; }), 'SPEC_BAD_TYPE');
  expectCode(mutate((s) => { s.shows.layers[0].id = '9lives'; }), 'SPEC_BAD_TYPE');
  expectCode(mutate((s) => { s.manipulates.controls[0].width = 'huge'; }), 'SPEC_BAD_TYPE');
  expectCode(mutate((s) => { s.manipulates.controls[0].name = 'my-t'; }), 'SPEC_BAD_TYPE', /name/);
  expectCode(mutate((s) => { s.manipulates.controls[1].default = 1; }), 'SPEC_BAD_TYPE');
  expectCode(mutate((s) => { s.notice.states[0].showSun = 1; }), 'SPEC_BAD_TYPE');
  expectCode(mutate((s) => { s.shows.layers = {}; }), 'SPEC_BAD_TYPE');
  expectCode(mutate((s) => { s.shows.layers[2].from = [0]; }), 'SPEC_BAD_TYPE');
  expectCode(mutate((s) => { s.shows.constants.R = 'three'; }), 'SPEC_BAD_TYPE');
});

test('SPEC_UNKNOWN_KIND: figure type, layer kind, control kind, model name', () => {
  expectCode(mutate((s) => { s.shows.type = 'scene4d'; }), 'SPEC_UNKNOWN_KIND', /shows\.type/);
  expectCode(mutate((s) => { s.shows.layers[0].kind = 'blob'; }), 'SPEC_UNKNOWN_KIND', /kind/);
  expectCode(mutate((s) => { s.manipulates.controls[0].kind = 'knob'; }), 'SPEC_UNKNOWN_KIND');
  expectCode(mutate((s) => { s.shows.model = { name: 'newton', params: {} }; }), 'SPEC_UNKNOWN_KIND', /model\.name/);
});

test('SPEC_DUP_ID: one id namespace for layers, controls, constants, readouts and states', () => {
  expectCode(mutate((s) => { s.shows.layers[1].id = 'orbit'; }), 'SPEC_DUP_ID');
  expectCode(mutate((s) => { s.manipulates.controls[1].name = 't'; }), 'SPEC_DUP_ID');
  expectCode(mutate((s) => { s.manipulates.controls[1].name = 'moon'; }), 'SPEC_DUP_ID', /name/, 'control name vs layer id');
  expectCode(mutate((s) => { s.shows.constants.t = 1; }), 'SPEC_DUP_ID', /constants/);
  expectCode(mutate((s) => { s.shows.readouts[0].id = 'earth'; }), 'SPEC_DUP_ID');
  expectCode(mutate((s) => { s.notice.states[2].name = 'sidereal'; }), 'SPEC_DUP_ID', /states\[2\]\.name/);
  expectCode(mutate((s) => { s.manipulates.controls[0].name = 'sin'; }), 'SPEC_DUP_ID', /name/, 'built-in function names are reserved');
});

test('SPEC_BAD_TOKEN: colors are palette tokens only (skipped when no palette is given)', () => {
  expectCode(mutate((s) => { s.shows.layers[0].stroke = 'red'; }), 'SPEC_BAD_TOKEN', /stroke/);
  expectCode(mutate((s) => { s.manipulates.controls[0].token = '#fff'; }), 'SPEC_BAD_TOKEN');
  expectCode(mutate((s) => { s.shows.readouts[0].token = 'mars'; }), 'SPEC_BAD_TOKEN');
  assert.ok(validateSpec(mutate((s) => { s.shows.layers[0].stroke = 'red'; }), { figureId: 'x' }), 'no palette -> tokens unchecked');
});

test('SPEC_BAD_EXPR: syntax, unknown function, arity, and bad expect', () => {
  expectCode(mutate((s) => { s.shows.layers[6].cx = 'R*cos('; }), 'SPEC_BAD_EXPR', /cx/);
  expectCode(mutate((s) => { s.shows.layers[6].cx = 'R*cosine(t)'; }), 'SPEC_BAD_EXPR');
  expectCode(mutate((s) => { s.shows.layers[6].cx = 'atan2(t)'; }), 'SPEC_BAD_EXPR');
  expectCode(mutate((s) => { s.shows.layers[3].visible = 'showSun ? 1 : 0'; }), 'SPEC_BAD_EXPR');
  expectCode(mutate((s) => { s.shows.constants.T_syn.expect = '1/(1/T_sid - 1/Y'; }), 'SPEC_BAD_EXPR');
  expectCode(mutate((s) => { s.shows.readouts[0].text = 'day {t+:.1f}'; }), 'SPEC_BAD_EXPR', /text/);
});

test('SPEC_UNKNOWN_IDENT: every identifier must be a control, constant, model output or built-in constant', () => {
  expectCode(mutate((s) => { s.shows.layers[6].cx = 'R*cos(tau*t/T_sidd)'; }), 'SPEC_UNKNOWN_IDENT', /layers\[6\]\.cx/);
  expectCode(mutate((s) => { s.shows.readouts[0].text = 'day {tt:.1f}'; }), 'SPEC_UNKNOWN_IDENT');
  expectCode(mutate((s) => { s.manipulates.controls[0].format = '{q:.2f}'; }), 'SPEC_UNKNOWN_IDENT');
  expectCode(mutate((s) => { s.shows.constants.T_syn.expect = '1/(1/T_sid - 1/t)'; }), 'SPEC_UNKNOWN_IDENT', /expect/, 'expect sees constants only');
  expectCode(mutate((s) => { s.shows.layers[6].cx = 'p.x'; }), 'SPEC_UNKNOWN_IDENT');
  // a drag control exposes name.x / name.y / name.dragging
  const withDrag = mutate((s) => {
    s.manipulates.controls.push({ kind: 'drag', name: 'p', default: [1, 1], constrain: 'view', token: 'sun' });
    s.shows.layers[6].cx = 'p.x + p.dragging';
  });
  assert.ok(ok(withDrag));
});

test('SPEC_BAD_FORMAT: template placeholders need {expr:fmt} with a known format', () => {
  expectCode(mutate((s) => { s.shows.readouts[0].text = 'day {t}'; }), 'SPEC_BAD_FORMAT');
  expectCode(mutate((s) => { s.shows.readouts[0].text = 'day {t:.12f}'; }), 'SPEC_BAD_FORMAT');
  expectCode(mutate((s) => { s.shows.readouts[0].text = 'day {t:percent}'; }), 'SPEC_BAD_FORMAT');
  expectCode(mutate((s) => { s.shows.readouts[0].text = 'day {t:.1f'; }), 'SPEC_BAD_FORMAT');
  expectCode(mutate((s) => { s.manipulates.controls[0].format = '{:.1f}'; }), 'SPEC_BAD_FORMAT');
  assert.deepEqual(parseTemplate('a {t:.1f} b {deg(x):deg}'), [{ text: 'a ' }, { src: 't', fmt: '.1f' }, { text: ' b ' }, { src: 'deg(x)', fmt: 'deg' }]);
  for (const fmt of Object.keys(FORMATS)) {
    const concrete = fmt.replace('.Nf', '.2f');
    assert.deepEqual(parseTemplate(`{t:${concrete}}`), [{ src: 't', fmt: concrete }]);
  }
});

test('SPEC_RANGE: defaults inside ranges, positive steps, non-empty lists', () => {
  expectCode(mutate((s) => { s.manipulates.controls[0].default = 99; }), 'SPEC_RANGE', /default/);
  expectCode(mutate((s) => { s.manipulates.controls[0].min = 100; }), 'SPEC_RANGE', /min/);
  expectCode(mutate((s) => { s.manipulates.controls[0].step = 0; }), 'SPEC_RANGE', /step/);
  expectCode(mutate((s) => { s.manipulates.controls[2].rate = -1; }), 'SPEC_RANGE', /rate/);
  expectCode(mutate((s) => { s.shows.view.x = [6, -6]; }), 'SPEC_RANGE', /view\.x/);
  expectCode(mutate((s) => { s.shows.layers = []; }), 'SPEC_RANGE', /layers/);
  expectCode(mutate((s) => { s.notice.states = []; }), 'SPEC_RANGE', /states/, 'steps: buttons needs a state');
  assert.ok(ok(mutate((s) => { s.notice.states = []; s.notice.steps = 'none'; })), 'steps: none allows no states');
  expectCode(mutate((s) => { s.manipulates.controls[0] = { kind: 'slider', name: 't', label: 'x', values: [1, 2, 3], default: 4, token: 'moon' }; }), 'SPEC_RANGE');
});

test('SPEC_CONFLICT: mutually exclusive keys', () => {
  expectCode(mutate((s) => { s.shows.readouts[0].at = [0, 0]; }), 'SPEC_CONFLICT', /readouts\[0\]/);
  expectCode(mutate((s) => { s.manipulates.controls[0].values = [0, 1]; }), 'SPEC_CONFLICT');
  expectCode(mutate((s) => { s.notice.states[0].camera = { azimuth: 0 }; }), 'SPEC_CONFLICT', /camera/, 'camera is scene3d only');
});

test('SPEC_UNKNOWN_REF: anchor, region.of, play.target, drag.preview', () => {
  expectCode(mutate((s) => { s.shows.readouts[0].anchor = 'mars'; }), 'SPEC_UNKNOWN_REF', /anchor/);
  expectCode(mutate((s) => { s.manipulates.controls[2].target = 'showSun'; }), 'SPEC_UNKNOWN_REF', /target/, 'play targets a slider or time control');
  expectCode(mutate((s) => { s.manipulates.controls[2].target = 'nope'; }), 'SPEC_UNKNOWN_REF');
  expectCode(mutate((s) => { s.shows.layers.push({ id: 'lens', kind: 'region', of: ['orbit', 'trail'], op: 'intersect', fill: 'sun' }); }), 'SPEC_UNKNOWN_REF', /of\[1\]/, 'regions combine circle/ellipse/polygon only');
  expectCode(mutate((s) => { s.manipulates.controls.push({ kind: 'drag', name: 'p', default: [0, 0], constrain: 'free', token: 'sun', preview: ['ghost'] }); }), 'SPEC_UNKNOWN_REF', /preview/);
  expectCode(mutate((s) => { s.notice.states[0].visible = { hide: ['nope'] }; }), 'SPEC_UNKNOWN_REF', /visible\.hide/);
  assert.ok(ok(mutate((s) => { s.shows.layers.push({ id: 'lens', kind: 'region', of: ['orbit', 'earth'], op: 'intersect', fill: 'sun' }); })));
});

test('SPEC_EXPECT_MISMATCH: derived constants are cross-checked', () => {
  expectCode(mutate((s) => { s.shows.constants.T_syn.value = 30; }), 'SPEC_EXPECT_MISMATCH', /T_syn\.expect/);
  assert.ok(ok(mutate((s) => { s.shows.constants.T_syn.tol = 1; s.shows.constants.T_syn.value = 30; })));
});

test('SPEC_STATE_UNKNOWN_CONTROL and SPEC_STATE_OUT_OF_RANGE', () => {
  expectCode(mutate((s) => { s.notice.states[0].foo = 1; }), 'SPEC_STATE_UNKNOWN_CONTROL', /states\[0\]\.foo/);
  expectCode(mutate((s) => { s.notice.states[1].t = 999; }), 'SPEC_STATE_OUT_OF_RANGE', /states\[1\]\.t/);
  expectCode(mutate((s) => { s.notice.states[1].t = -1; }), 'SPEC_STATE_OUT_OF_RANGE');
  expectCode(mutate((s) => { s.notice.states[0].drag = { t: [0, 0] }; }), 'SPEC_STATE_UNKNOWN_CONTROL', /drag\.t/);
  const withDrag = mutate((s) => {
    s.manipulates.controls.push({ kind: 'drag', name: 'p', default: [1, 1], constrain: 'view', token: 'sun' });
    s.notice.states[0].p = [0, 0];
  });
  expectCode(withDrag, 'SPEC_STATE_UNKNOWN_CONTROL', /states\[0\]\.p/, 'drag values go under drag');
  const good = mutate((s) => {
    s.manipulates.controls.push({ kind: 'drag', name: 'p', default: [1, 1], constrain: 'view', token: 'sun' });
    s.notice.states[0].drag = { p: [0, 0] };
  });
  const c = ok(good);
  assert.equal(scopeForState(c, 'new-moon').get('p.x'), 0);
});

test('SPEC_POINT_AT_MISSING', () => {
  expectCode(mutate((s) => { s.notice.point_at.push('nope'); }), 'SPEC_POINT_AT_MISSING', /point_at/);
});

test('SPEC_NOT_FINITE: evaluateAll reports the expression path', () => {
  const c = ok(mutate((s) => { s.shows.layers[6].cx = 'R/(t-t)'; }));
  assert.throws(() => evaluateAll(c, scopeForState(c, null)), (e) => e.code === 'SPEC_NOT_FINITE' && e.path === 'shows.layers[6].cx');
  const c2 = ok(mutate((s) => { s.shows.layers[6].cx = 'sqrt(30 - t)'; }));
  evaluateAll(c2, scopeForState(c2, 'sidereal'));
  assert.throws(() => evaluateAll(c2, scopeForState(c2, null, { t: 60 })), (e) => e.code === 'SPEC_NOT_FINITE');
});

test('slider forms: values list, time control windows and rates, segmented, toggle', () => {
  const s = mutate((x) => {
    x.manipulates.controls.push(
      { kind: 'slider', name: 'n', label: 'satellites', values: [1, 2, 4, 8], default: 4, token: 'sun' },
      { kind: 'time', name: 'clock', mode: 'scrub', window: '24h', default: 3600000, epoch: 'now', format: 'time', token: 'moon' },
      { kind: 'time', name: 'fast', mode: 'speed', rates: [1, 60, 3600], default: 60, epoch: '2026-01-01T00:00:00Z', format: 'datetime', token: 'moon' },
      { kind: 'segmented', name: 'which', options: [{ value: 1, label: 'one' }, { value: 2, label: 'two' }], default: 2, token: 'star' },
    );
    x.shows.readouts.push({ at: [0, 0], text: '{clock:datetime} {fast.rate:,d} {n:,d} {which:,d}', token: 'sun' });
    x.notice.states[0].clock = 0;
    x.notice.states[0].fast = 3600;
    x.notice.states[0].which = 1;
    x.notice.states[0].n = 8;
  });
  const c = ok(s);
  assert.equal(c.defaults.get('fast.rate'), 60);
  assert.equal(windowToMs('24h'), 86400e3);
  assert.equal(windowToMs('30d'), 30 * 86400e3);
  assert.equal(windowToMs(2), 2 * 86400e3);
  expectCode(mutate((x) => { x.manipulates.controls.push({ kind: 'time', name: 'c', mode: 'scrub', default: 0, epoch: 'now', format: 'time', token: 'moon' }); }), 'SPEC_MISSING_KEY', /window/);
  expectCode(mutate((x) => { x.manipulates.controls.push({ kind: 'time', name: 'c', mode: 'scrub', window: '24h', rates: [1], default: 0, epoch: 'now', format: 'time', token: 'moon' }); }), 'SPEC_CONFLICT', /rates/);
  expectCode(mutate((x) => { x.manipulates.controls.push({ kind: 'time', name: 'c', mode: 'speed', rates: [1, 60], default: 7, epoch: 'now', format: 'time', token: 'moon' }); }), 'SPEC_RANGE');
  expectCode(mutate((x) => { x.manipulates.controls.push({ kind: 'time', name: 'c', mode: 'scrub', window: '24x', default: 0, epoch: 'now', format: 'time', token: 'moon' }); }), 'SPEC_BAD_TYPE', /window/);
  expectCode(mutate((x) => { x.manipulates.controls.push({ kind: 'time', name: 'c', mode: 'scrub', window: '24h', default: 0, epoch: 'yesterday', format: 'time', token: 'moon' }); }), 'SPEC_BAD_TYPE', /epoch/);
  expectCode(mutate((x) => { x.manipulates.controls.push({ kind: 'segmented', name: 'w', options: [{ value: 1, label: 'a' }, { value: 1, label: 'b' }], default: 1, token: 'sun' }); }), 'SPEC_DUP_ID');
  expectCode(mutate((x) => { x.manipulates.controls.push({ kind: 'drag', name: 'p', default: [0, 0], constrain: 'orbit', token: 'sun' }); }), 'SPEC_BAD_TYPE', /constrain/);
  expectCode(mutate((x) => { x.manipulates.controls.push({ kind: 'drag', name: 'p', default: [0, 0], constrain: 'surface:globe', token: 'sun' }); }), 'SPEC_UNKNOWN_REF', /constrain/);
});

test('model: params must match the model exactly; outputs join the scope as <model>.<output>', () => {
  const good = mutate((s) => {
    s.shows.model = { name: 'kepler', params: { a: 'R', e: 0.0549, M: 'tau*t/T_sid' } };
    s.shows.layers[6].cx = 'kepler.x';
    s.shows.layers[6].cy = 'kepler.y';
  });
  const c = ok(good);
  assert.equal(c.defaults.get('kepler.x'), MODELS.kepler.outputs.x);
  evaluateAll(c, scopeForState(c, 'synodic'));
  expectCode(mutate((s) => { s.shows.model = { name: 'kepler', params: { a: 'R', e: 0.05 } }; }), 'SPEC_MISSING_KEY', /params\.M/);
  expectCode(mutate((s) => { s.shows.model = { name: 'kepler', params: { a: 'R', e: 0.05, M: 0, extra: 1 } }; }), 'SPEC_UNKNOWN_KEY', /params\.extra/);
  expectCode(mutate((s) => { s.shows.model = { name: 'kepler', params: { a: 'R', e: 0.05, M: 'tau*t/T_bogus' } }; }), 'SPEC_UNKNOWN_IDENT');
  expectCode(mutate((s) => { s.shows.layers[6].cx = 'kepler.x'; }), 'SPEC_UNKNOWN_IDENT', /cx/, 'no model declared');
});

const plotSpec = () => ({
  shows: {
    type: 'plot',
    x: { var: 'theta', min: 0, max: 6.283, label: 'cam angle', unit: 'rad' },
    y: { min: 0, max: 1.2, label: 'lift' },
    series: [{ id: 'lift', y: 'h * max(0, cos(theta))', token: 'sun' }],
    marker: { x: 'phi', token: 'moon' },
    guides: [{ id: 'zero', y: 0, token: 'muted', dash: [2, 2] }],
    constants: { h: 1 },
  },
  manipulates: { controls: [{ kind: 'slider', name: 'phi', label: 'angle', min: 0, max: 6.283, default: 0, token: 'moon' }] },
  notice: { steps: 'none', states: [] },
});

test('plot figures: series.y sees the x variable, nothing else does', () => {
  const c = ok(plotSpec());
  assert.deepEqual(c.plotVars, ['theta']);
  evaluateAll(c, scopeForState(c, null));
  const bad = plotSpec(); bad.shows.marker.x = 'theta';
  expectCode(bad, 'SPEC_UNKNOWN_IDENT', /marker\.x/);
  const both = plotSpec(); both.shows.guides[0].x = 1;
  expectCode(both, 'SPEC_CONFLICT', /guides\[0\]/);
  const neither = plotSpec(); delete neither.shows.guides[0].y;
  expectCode(neither, 'SPEC_MISSING_KEY', /guides\[0\]/);
  const dup = plotSpec(); dup.shows.guides[0].id = 'lift';
  expectCode(dup, 'SPEC_DUP_ID');
});

test('timeline figures', () => {
  const s = {
    shows: {
      type: 'timeline',
      x: { min: 0, max: 60, label: 'seconds' },
      bars: [{ id: 'sat', from: 0, to: 't', label: 'satellite clock', token: 'sun' }, { id: 'rx', from: 0, to: 't + bias', label: 'receiver clock', token: 'moon' }],
      marker: { x: 't', token: 'muted' },
    },
    manipulates: { controls: [
      { kind: 'slider', name: 't', label: 'time', min: 0, max: 60, default: 10, token: 'sun' },
      { kind: 'slider', name: 'bias', label: 'clock bias', min: -5, max: 5, default: 1, token: 'moon' },
    ] },
    notice: { steps: 'segmented', states: [{ name: 'late', caption: 'The receiver runs late.', bias: -3 }] },
  };
  const c = ok(s);
  evaluateAll(c, scopeForState(c, 'late'));
  s.shows.bars = [];
  expectCode(s, 'SPEC_RANGE', /bars/);
});

const scene3d = () => ({
  shows: {
    type: 'scene3d',
    camera: { mode: 'arcball', distance: 5, azimuth: 0, polar: 1.2 },
    light: { direction: ['cos(sun)', 0, 'sin(sun)'], ambient: 0.2 },
    shadows: true,
    assets: { land: 'assets/textures/earth-land.png', clouds: 'assets/textures/clouds.png' },
    objects: [
      { id: 'earth', kind: 'globe', radius: 1, material: 'lambert', textures: { land: 'land', clouds: 'clouds' }, rotation: [0, 'spin', 0] },
      { id: 'axis', kind: 'arrow', from: [0, -1.4, 0], to: [0, 1.4, 0], color: 'sun' },
      { id: 'tag', kind: 'label', text: 'tilt {deg(tilt):deg}', anchor: 'earth' },
    ],
    fallback: { poster: 'assets/fig-tilt.png', notice: 'Your browser has no WebGL2; this is a still frame.' },
    split: [{ at: 'inset:bottom-right', shows: { type: 'scene2d', view: { x: [-2, 2], y: [-2, 2] }, layers: [{ id: 'orbit2d', kind: 'circle', cx: 0, cy: 0, r: 1, stroke: 'muted' }] } }],
  },
  manipulates: { controls: [
    { kind: 'slider', name: 'sun', label: 'sun direction', min: 0, max: 6.283, default: 0, token: 'sun' },
    { kind: 'slider', name: 'spin', label: 'rotation', min: 0, max: 6.283, default: 0, token: 'moon' },
    { kind: 'slider', name: 'tilt', label: 'tilt', min: 0, max: 0.5, default: 0.41, token: 'star' },
    { kind: 'drag', name: 'me', default: [37.7, -122.4], constrain: 'surface:earth', token: 'star', geolocate: true },
  ] },
  notice: { steps: 'buttons', states: [{ name: 'solstice', caption: 'June solstice.', sun: 1.57, camera: { azimuth: 0.5, polar: 1, distance: 5 }, drag: { me: [0, 0] } }] },
});

test('scene3d figures: objects, assets, camera, surface drag, 2D inset panel', () => {
  const c = ok(scene3d());
  assert.deepEqual(c.objectIds, ['earth', 'axis', 'tag']);
  assert.ok(c.layerIds.includes('orbit2d'), 'panel layers are in the layer namespace');
  assert.deepEqual(c.exposedNames.slice(-3), ['me.lat', 'me.lon', 'me.dragging']);
  assert.equal(scopeForState(c, 'solstice').get('me.lat'), 0);
  evaluateAll(c, scopeForState(c, 'solstice'));
  const badAsset = scene3d(); badAsset.shows.objects[0].textures.land = 'mars';
  expectCode(badAsset, 'SPEC_UNKNOWN_REF', /textures\.land/);
  const badKind = scene3d(); badKind.shows.objects[0].kind = 'cube';
  expectCode(badKind, 'SPEC_UNKNOWN_KIND', /objects\[0\]\.kind/);
  const badLock = scene3d(); badLock.shows.camera.lock = 'mars';
  expectCode(badLock, 'SPEC_UNKNOWN_REF', /camera\.lock/);
  const bothLabel = scene3d(); bothLabel.shows.objects[2].position = [0, 0, 0];
  expectCode(bothLabel, 'SPEC_CONFLICT', /objects\[2\]/);
  const absPath = scene3d(); absPath.shows.fallback.poster = '/assets/x.png';
  expectCode(absPath, 'SPEC_BAD_TYPE', /poster/);
  const panelConst = scene3d(); panelConst.shows.split[0].shows.constants = { q: 1 };
  expectCode(panelConst, 'SPEC_UNKNOWN_KEY', /split\[0\]\.shows\.constants/);
  const panel3d = scene3d(); panel3d.shows.split[0].shows = scene3d().shows;
  expectCode(panel3d, 'SPEC_UNKNOWN_KIND', /split\[0\]\.shows\.type/);
});

test('every layer kind validates with its required geometry', () => {
  const layers = {
    circle: { cx: 0, cy: 0, r: 1 },
    ellipse: { cx: 0, cy: 0, rx: 2, ry: 1, rotation: 'a' },
    line: { from: [0, 0], to: [1, 1] },
    segment: { from: [0, 0], to: [1, 1] },
    ray: { from: [0, 0], angle: 'a', length: 3 },
    arc: { cx: 0, cy: 0, r: 1, from: 0, to: 'a' },
    polygon: { points: [[0, 0], [1, 0], [0, 1]] },
    path: { points: [[0, 0], ['cos(a)', 'sin(a)']] },
    arrow: { from: [0, 0], to: ['cos(a)', 'sin(a)'], head: 10 },
    text: { at: [0, 0], text: 'a = {a:.2f}', size: 12, align: 'left' },
    bars: { y: 0, height: 0.2, rows: [{ label: 'one', from: 0, to: 'a', token: 'sun' }] },
    image: { src: 'assets/map.png', rect: [-1, -1, 2, 2] },
  };
  assert.deepEqual(Object.keys(layers).concat('region').sort(), [...LAYER_KINDS].sort());
  const s = mutate((x) => {
    x.shows.layers = Object.entries(layers).map(([kind, geo], i) => ({ id: `l${i}`, kind, stroke: 'sun', ...geo }));
    x.shows.layers.push({ id: 'lens', kind: 'region', of: ['l0', 'l1', 'l6'], op: 'subtract', fill: 'moon' });
    x.manipulates.controls[0].name = 'a';
    x.manipulates.controls[0].format = '{a:.1f}';
    x.manipulates.controls[2].target = 'a';
    x.shows.readouts = [];
    x.notice.point_at = [];
    x.notice.states = x.notice.states.map((st) => ({ name: st.name, caption: st.caption, a: st.t, showSun: true }));
  });
  const c = ok(s);
  assert.equal(c.layerIds.length, 13);
  evaluateAll(c, scopeForState(c, 'synodic'));
  expectCode(mutate((x) => { x.shows.layers.push({ id: 'p', kind: 'polygon', points: [[0, 0], [1, 1]] }); }), 'SPEC_RANGE', /points/);
});

test('vocabulary constants match the design', () => {
  assert.deepEqual([...FIGURE_TYPES], ['scene2d', 'scene3d', 'plot', 'timeline']);
  assert.deepEqual([...CONTROL_KINDS], ['slider', 'time', 'drag', 'toggle', 'segmented', 'play']);
  assert.deepEqual([...LAYER_KINDS], ['circle', 'ellipse', 'line', 'ray', 'segment', 'arc', 'polygon', 'path', 'arrow', 'region', 'text', 'bars', 'image']);
  assert.deepEqual([...OBJECT_KINDS], ['globe', 'sphere', 'ring', 'disc', 'body', 'arrow', 'part', 'label']);
  assert.deepEqual(Object.keys(SCHEMA.figure), ['shows', 'manipulates', 'notice']);
});

test('describeVocabulary() documents every kind, key and format', () => {
  const md = describeVocabulary();
  for (const k of [...FIGURE_TYPES, ...CONTROL_KINDS, ...LAYER_KINDS, ...OBJECT_KINDS]) assert.match(md, new RegExp(`\`${k}\``), k);
  for (const k of Object.keys(FORMATS)) assert.ok(md.includes(`\`${k}\``), k);
  for (const k of Object.keys(SCHEMA.layerCommon)) assert.ok(md.includes(`| \`${k}\` |`), k);
  for (const k of Object.keys(SCHEMA.controls.slider)) assert.ok(md.includes(`| \`${k}\` |`), k);
  for (const k of Object.keys(MODELS)) assert.ok(md.includes(`| \`${k}\` |`), k);
});

test('ERROR_CATALOGUE has a one-line description for every code', () => {
  for (const [code, desc] of Object.entries(ERROR_CATALOGUE)) {
    assert.match(code, /^[A-Z]+(_[A-Z]+)+$/);
    assert.ok(desc.length > 10 && !desc.includes('\n'), code);
  }
  assert.equal(Object.keys(ERROR_CATALOGUE).filter((c) => c.startsWith('SPEC_')).length, 18);
});

test('nearestState: shape { i, name, exact }; between steps the closer one wins; a toggle is a unit of distance; directional', () => {
  const compiled = {
    figureId: 'fig-t',
    controls: [{ kind: 'slider', name: 'a', min: 0, max: 360 }, { kind: 'toggle', name: 'rim' }],
    spec: { notice: { states: [{ name: 'start', a: 0 }, { name: 'quarter', a: 90 }, { name: 'half', a: 180, rim: false }] } },
  };
  const scope = (a, rim = 1) => ({ get: (k) => (k === 'a' ? a : rim) });
  assert.deepEqual(nearestState(compiled, scope(0)), { i: 0, name: 'start', exact: true });
  assert.deepEqual(nearestState(compiled, scope(50)), { i: 1, name: 'quarter', exact: false });
  assert.equal(nearestState(compiled, scope(44)).name, 'start', 'ties and near-ties go by normalized distance');
  assert.equal(nearestState(compiled, scope(180, 1)).name, 'quarter', 'a step that sets the toggle the other way is a full unit away');
  assert.deepEqual(nearestState(compiled, scope(180, 0)), { i: 2, name: 'half', exact: true });
  assert.deepEqual(Object.keys(stateTargets(compiled, 'half').targets), ['a', 'rim']);
  // directional: › from 50° lands on quarter (ahead), ‹ from 50° on start (behind); past the last step › lands on the last
  assert.equal(nearestState(compiled, scope(50), 1e-6, 1).name, 'quarter');
  assert.equal(nearestState(compiled, scope(50), 1e-6, -1).name, 'start');
  assert.equal(nearestState(compiled, scope(300, 0), 1e-6, 1).name, 'half', 'nothing ahead: the last step');
  assert.equal(nearestState(compiled, scope(-10), 1e-6, -1).name, 'start', 'nothing behind: the first step');
  assert.equal(nearestState(compiled, scope(0), 1e-6, 1).name, 'quarter', 'exactly on a step, › goes to the next one ahead');
  assert.equal(nearestState(compiled, scope(90), 1e-6, -1).name, 'start', 'exactly on a step, ‹ goes to the one behind');
});

test('nearestState: segmented strings, drag components and camera-only states', () => {
  const seg = { figureId: 'fig-s', controls: [{ kind: 'segmented', name: 'dir', options: [{ value: 'n' }, { value: 'e' }] }], spec: { notice: { states: [{ name: 'north', dir: 'n' }, { name: 'east', dir: 'e' }] } } };
  const segScope = (dir) => ({ get: () => dir });
  assert.deepEqual(nearestState(seg, segScope('e')), { i: 1, name: 'east', exact: true });
  assert.deepEqual(nearestState(seg, segScope('n')), { i: 0, name: 'north', exact: true });
  const drag = { figureId: 'fig-d', controls: [{ kind: 'drag', name: 'M', constrain: 'free' }], spec: { notice: { states: [{ name: 'a', drag: { M: [0, 0] } }, { name: 'b', drag: { M: [1, 0] } }] } } };
  const dragScope = (x, y) => ({ get: (k) => (k === 'M.x' ? x : y) });
  assert.deepEqual(nearestState(drag, dragScope(1, 0)), { i: 1, name: 'b', exact: true });
  assert.deepEqual(nearestState(drag, dragScope(0.7, 0.1)), { i: 1, name: 'b', exact: false });
  assert.deepEqual(nearestState(drag, dragScope(0.2, 0)), { i: 0, name: 'a', exact: false });
  const cam = { figureId: 'fig-c', controls: [], spec: { notice: { states: [{ name: 'front', camera: { azimuth: 0 } }] } } };
  assert.deepEqual(nearestState(cam, { get: () => 0 }), { i: 0, name: 'front', exact: false }, 'a camera-only state is never exact');
});
