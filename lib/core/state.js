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
export function isDiscrete(control) {
  switch (control.kind) {
    case 'slider': return 'values' in control;
    case 'toggle': case 'segmented': return true;
    case 'time': return control.mode === 'speed';
    default: return false;
  }
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
    if (['name', 'caption', 'camera', 'drag', 'visible'].includes(k)) continue;
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

// The state whose targets all match the scope (within eps), or null.
export function activeState(compiled, scope, eps = 1e-6) {
  for (const st of compiled.spec.notice.states) {
    const { targets } = stateTargets(compiled, st.name);
    const keys = Object.keys(targets);
    if (keys.length && keys.every((k) => Math.abs(Number(scope.get(k)) - Number(targets[k])) <= eps)) return st.name;
  }
  return null;
}

export function stateIndex(compiled, name) {
  return compiled.states.indexOf(name);
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
