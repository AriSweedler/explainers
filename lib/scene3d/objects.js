// lib/scene3d/objects.js — a scene3d object spec compiled into getters, and
// the per-frame evaluation every renderer shares: the lazy chunk (three.js)
// and lib/poster-svg.js (the first frame under Node) read the same numbers.
// `getter(v)` turns a number or expression string into a function of the
// scope; it is injected so this module has no dependency of its own.

const EXPR_KEYS = ['scale', 'opacity', 'radius', 'exaggeration'];
const POINT_KEYS = ['position', 'rotation', 'from', 'to'];

export const DEFAULT_HEAD = 0.15; // arrow head as a fraction of its length when `head` is omitted
export const RING_WIDTH_PX = 1.5;

export function compileObject(spec, getter) {
  const g = {};
  for (const k of EXPR_KEYS) if (k in spec) g[k] = getter(spec[k]);
  for (const k of POINT_KEYS) if (k in spec) { const gs = spec[k].map(getter); g[k] = (scope) => gs.map((f) => f(scope)); }
  if ('visible' in spec) g.visible = getter(spec.visible);
  if (spec.cut) g.cutOffset = getter(spec.cut.offset);
  if (spec.explode) g.explodeOffset = getter(spec.explode.offset);
  return { id: spec.id, kind: spec.kind, spec, g, highlight: false };
}

// The frame values of one object: transform, look and kind-specific numbers.
export function evalObject(O, scope) {
  const g = O.g, s = O.spec;
  const out = {
    visible: g.visible ? g.visible(scope) !== 0 : true,
    position: g.position ? g.position(scope) : [0, 0, 0],
    rotation: g.rotation ? g.rotation(scope) : [0, 0, 0],
    scale: g.scale ? g.scale(scope) : 1,
    opacity: g.opacity ? Math.min(Math.max(g.opacity(scope), 0), 1) : 1,
  };
  if (g.radius) out.radius = Math.max(g.radius(scope), 0);
  if (g.from) out.from = g.from(scope);
  if (g.to) out.to = g.to(scope);
  if (g.exaggeration) out.exaggeration = g.exaggeration(scope);
  if (g.cutOffset) out.cutOffset = g.cutOffset(scope);
  if (g.explodeOffset) out.explodeOffset = g.explodeOffset(scope);
  if (O.kind === 'arrow') {
    const d = [out.to[0] - out.from[0], out.to[1] - out.from[1], out.to[2] - out.from[2]];
    out.length = Math.hypot(d[0], d[1], d[2]);
    out.head = s.head !== undefined ? s.head : out.length * DEFAULT_HEAD;
  }
  return out;
}

// World position of a free label (a `label` object with `position`), or null
// for an anchored one. Both renderers call this, so the getter shape stays
// in one place.
export function labelPosition(L, scope) {
  return L.position ? L.position.map((g) => g(scope)) : null;
}

// Sample points of a unit circle in the XZ plane (the ring and disc shape
// before the object's rotation), counter-clockwise seen from +y.
export function circlePoints(n) {
  const pts = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; pts.push([Math.cos(a), 0, -Math.sin(a)]); }
  return pts;
}

// The label objects and `label` keys of a scene as one list of
// { id, text (template), anchor (object id) | null, position getter | null, offset, color }.
export function labelSpecs(objects, getter) {
  const out = [];
  for (const o of objects) {
    if (o.kind === 'label') {
      out.push({ id: o.id, text: o.text, anchor: o.anchor || null, position: o.position ? o.position.map(getter) : null, offset: o.offset || null, color: o.color || null, visible: 'visible' in o ? getter(o.visible) : null, own: true });
    } else if (o.label) {
      out.push({ id: `${o.id}:label`, text: o.label, anchor: o.id, position: null, offset: null, color: o.color || null, visible: null, own: false });
    }
  }
  return out;
}
