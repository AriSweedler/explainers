// lib/core/state.js — the pure half of the Figure object: what a control
// accepts, what a named state asks for, which state the scope is in.
import { windowToMs } from '../spec.js';
import { getter } from '../scene2d/getters.js';

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const nearest = (values, v) => values.reduce((best, x) => (Math.abs(x - v) < Math.abs(best - v) ? x : best), values[0]);

export function controlOf(compiled, name) {
  return compiled.controls.find((c) => c.name === name) || null;
}

// Controls whose values cannot be interpolated snap at the midpoint of a goto.
export function snaps(control) {
  switch (control.kind) {
    case 'slider': return 'values' in control;
    case 'toggle': case 'segmented': return true;
    case 'time': return control.mode === 'speed';
    default: return false;
  }
}

// A control with STOPS (DESIGN.md "Slider anatomy"): a values list, a step that
// divides the range into at most 40, or a speed-mode time control's rates. Its
// arrows walk the stops, so the stepper leaves them to it.
export function hasStops(c) {
  return 'values' in c || (c.kind === 'time' ? c.mode === 'speed' : c.kind === 'slider' && (c.max - c.min) / c.step <= 40);
}

// figure.set validation: coerce a requested value into the control's range.
export function coerce(control, value) {
  switch (control.kind) {
    case 'slider':
      if ('values' in control) return nearest(control.values, Number(value));
      return clamp(Number(value), control.min, control.max);
    case 'toggle': return value ? 1 : 0;
    case 'segmented': return control.options.some((o) => o.value === value) ? value : nearest(control.options.map((o) => o.value), Number(value));
    case 'time':
      if (control.mode === 'scrub') return clamp(Number(value), 0, windowToMs(control.window));
      return Number(value);
    default: return value;
  }
}

// What a named state sets: control targets, drag targets and visibility.
export function stateTargets(compiled, stateName) {
  const st = compiled.spec.notice.states.find((s) => s.name === stateName);
  if (!st) throw new Error(`no state "${stateName}" in ${compiled.figureId}`);
  const targets = {};
  for (const [k, v] of Object.entries(st)) {
    if (['name', 'caption', 'label', 'camera', 'drag', 'visible'].includes(k)) continue;
    targets[k] = typeof v === 'boolean' ? (v ? 1 : 0) : v;
  }
  for (const [k, [a, b]] of Object.entries(st.drag || {})) {
    const c = compiled.controls ? compiled.controls.find((x) => x.name === k) : null;
    const surface = !!(c && c.constrain && c.constrain.startsWith('surface:')); // a surface drag is [lat, lon]
    targets[`${k}.${surface ? 'lat' : 'x'}`] = a;
    targets[`${k}.${surface ? 'lon' : 'y'}`] = b;
  }
  return { targets, visible: st.visible || null, camera: st.camera || null, caption: st.caption };
}

// The step nearest the scope. THE NEARNESS RULE: for every target a step
// names, a numeric control (slider, time, drag component) adds |Δ|/range to
// the distance and Δ/range to the direction; a toggle or segmented control
// adds one unit of distance when it differs and nothing to the direction; the
// camera is ignored; exact = every Δ within eps and at least one target; ties
// go to the earlier step. With dir = +1 (-1) only the steps ahead of (behind)
// the controls count, and when none is left the result is that end.
const targetsOf = new WeakMap(); // compiled -> per step, its targets with the control's kind and range resolved: it runs per frame

export function nearestState(compiled, scope, eps = 1e-6, dir = 0) {
  let steps = targetsOf.get(compiled);
  if (!steps) targetsOf.set(compiled, steps = compiled.spec.notice.states.map((st) => ({ name: st.name, entries: Object.entries(stateTargets(compiled, st.name).targets).map(([k, v]) => {
    const c = controlOf(compiled, k.split('.')[0]);
    return { k, v, unit: !!c && (c.kind === 'toggle' || c.kind === 'segmented'), span: c && 'values' in c ? Math.abs(c.values.at(-1) - c.values[0]) || 1 : (c && c.max - c.min) || 1 };
  }) })));
  let best = null, bestD = 0, end = null;
  steps.forEach(({ name, entries }, i) => {
    let d = 0, sd = 0, exact = entries.length > 0;
    for (const { k, v, unit, span } of entries) {
      const have = scope.get(k);
      if (unit) { if (String(v) !== String(have)) { d += 1; exact = false; } continue; }
      const raw = Number(v) - Number(have);
      if (Math.abs(raw) > eps) exact = false;
      d += Math.abs(raw) / span; sd += raw / span;
    }
    const r = { i, name, exact };
    if (i === (dir > 0 ? steps.length - 1 : 0)) end = r;
    if ((dir > 0 ? sd > eps : dir < 0 ? sd < -eps : true) && (!best || d < bestD)) { best = r; bestD = d; }
  });
  return best || end;
}

// The ids a prose ref may point at right now: every declared id except the
// layers and readouts the figure is not drawing, decided the way isShown()
// decides it: a drag preview whose handle is not held, then the applied
// state's visible.hide / visible.show, then the `visible` expression. Pure,
// so the same rule runs under Node and in the Figure.
const visibilityRules = new WeakMap(); // compiled -> [{ id, owner, visible }]

function rulesFor(compiled) {
  let rules = visibilityRules.get(compiled);
  if (rules) return rules;
  rules = [];
  const previews = new Map();
  for (const c of compiled.controls) for (const id of c.preview || []) previews.set(id, c.name);
  const walk = (shows) => {
    for (const L of shows.layers || []) rules.push({ id: L.id, owner: previews.get(L.id) || null, visible: 'visible' in L ? getter(L.visible) : null });
    for (const R of shows.readouts || []) if (R.id && 'visible' in R) rules.push({ id: R.id, owner: null, visible: getter(R.visible) });
    for (const p of shows.split || []) walk(p.shows);
  };
  walk(compiled.spec.shows);
  visibilityRules.set(compiled, rules);
  return rules;
}

export function visibleIds(compiled, scope, stateVisible = null) {
  const hide = new Set((stateVisible && stateVisible.hide) || []), show = new Set((stateVisible && stateVisible.show) || []);
  const out = new Set(compiled.refIds);
  for (const r of rulesFor(compiled)) {
    let drawn;
    if (r.owner && scope.get(`${r.owner}.dragging`) !== 1) drawn = false;
    else if (hide.has(r.id)) drawn = false;
    else if (show.has(r.id)) drawn = true;
    else drawn = !r.visible || r.visible(scope) !== 0;
    if (!drawn) out.delete(r.id);
  }
  return out;
}
