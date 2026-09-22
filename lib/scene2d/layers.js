// lib/scene2d/layers.js — compile a spec layer into getters, then draw it.
// World units come from the panel's view (y up); widths, dashes, heads and
// text sizes are CSS px. Every numeric property is a number or an expression.
import { compileTemplate, renderTemplate } from '../core/format.js';
import { getter, pointGetter } from './getters.js';
import { drawText, fitBox, fontOf } from './label.js';

const FULL_TURN = Math.PI * 2;
const HEAD_PX = 10;
const EXPR_KEYS = {
  circle: ['cx', 'cy', 'r'],
  ellipse: ['cx', 'cy', 'rx', 'ry', 'rotation'],
  ray: ['angle', 'length'],
  arc: ['cx', 'cy', 'r', 'from', 'to'],
  bars: ['y'],
};
const POINT_KEYS = { line: ['from', 'to'], segment: ['from', 'to'], arrow: ['from', 'to'], ray: ['from'], text: ['at'] };

export function compileLayer(spec) {
  const g = {};
  for (const k of EXPR_KEYS[spec.kind] || []) if (k in spec) g[k] = getter(spec[k]);
  for (const k of POINT_KEYS[spec.kind] || []) g[k] = pointGetter(spec[k]);
  if (spec.points) g.points = spec.points.map(pointGetter);
  if (spec.rect) g.rect = spec.rect.map(getter);
  if (spec.rows) g.rows = spec.rows.map((r) => ({ from: getter(r.from), to: getter(r.to), token: r.token, label: r.label }));
  if (spec.kind === 'text') g.parts = compileTemplate(spec.text);
  return {
    id: spec.id, kind: spec.kind, spec, g,
    visible: 'visible' in spec ? getter(spec.visible) : null,
    highlight: !!spec.highlight, // prose refs toggle this at runtime
    alpha: 1,                    // state show/hide fades ease this
    override: null,              // state visible.show (1) / visible.hide (0)
    forceHide: false,            // drag preview layers while not dragging
    previewOf: null,
    wasHidden: false,
    image: null,
  };
}

export function isShown(L, scope) {
  if (L.forceHide || L.alpha <= 0 || L.override === 0) return false;
  if (L.override === 1) return true;
  const shown = L.visible ? L.visible(scope) !== 0 : true;
  L.wasHidden = !shown;
  return shown;
}

// ---------------------------------------------------------------- geometry

const px = (m, [wx, wy]) => [m.x(wx), m.y(wy)];
const angleOf = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]);
const shorten = (a, b, d) => { const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [b[0] - ((b[0] - a[0]) / L) * d, b[1] - ((b[1] - a[1]) / L) * d]; };

// Path2D in canvas px plus the readout anchor and arrowhead sites. makePath
// lets lib/poster-svg.js record the same geometry as SVG path data in Node.
export function geometryOf(L, scope, m, makePath = () => new Path2D()) {
  const s = L.spec, g = L.g, path = makePath(), heads = [];
  const head = (s.head || HEAD_PX) * (L.highlight ? 1.3 : 1);
  const wantStart = s.arrow === 'start' || s.arrow === 'both';
  const wantEnd = s.arrow === 'end' || s.arrow === 'both' || s.kind === 'arrow';
  let anchor, dir = null;

  const lineLike = (a0, b0) => {
    let a = a0, b = b0;
    if (wantEnd) { heads.push({ at: b0, angle: angleOf(a0, b0), len: head }); b = shorten(a0, b0, head * 0.85); }
    if (wantStart) { heads.push({ at: a0, angle: angleOf(b0, a0), len: head }); a = shorten(b0, a0, head * 0.85); }
    path.moveTo(a[0], a[1]);
    path.lineTo(b[0], b[1]);
    anchor = b0;
    dir = angleOf(a0, b0);
  };

  switch (L.kind) {
    case 'circle': {
      const c = px(m, [g.cx(scope), g.cy(scope)]), r = m.len(g.r(scope));
      path.arc(c[0], c[1], Math.max(r, 0), 0, FULL_TURN);
      anchor = c; L.lastRadius = r;
      break;
    }
    case 'ellipse': {
      const c = px(m, [g.cx(scope), g.cy(scope)]);
      path.ellipse(c[0], c[1], Math.max(m.len(g.rx(scope)), 0), Math.max(m.len(g.ry(scope)), 0), g.rotation ? -g.rotation(scope) : 0, 0, FULL_TURN);
      anchor = c; L.lastRadius = m.len(g.ry(scope));
      break;
    }
    case 'line': {
      const a = px(m, g.from(scope)), b = px(m, g.to(scope));
      const ang = angleOf(a, b), far = (m.rect.width + m.rect.height) * 2;
      path.moveTo(a[0] - Math.cos(ang) * far, a[1] - Math.sin(ang) * far);
      path.lineTo(b[0] + Math.cos(ang) * far, b[1] + Math.sin(ang) * far);
      anchor = b; dir = ang;
      break;
    }
    case 'segment': case 'arrow': lineLike(px(m, g.from(scope)), px(m, g.to(scope))); break;
    case 'ray': {
      const from = g.from(scope), ang = g.angle(scope), len = g.length(scope);
      lineLike(px(m, from), px(m, [from[0] + Math.cos(ang) * len, from[1] + Math.sin(ang) * len]));
      break;
    }
    case 'arc': {
      const c = px(m, [g.cx(scope), g.cy(scope)]), r = Math.max(m.len(g.r(scope)), 0);
      const from = g.from(scope), to = g.to(scope);
      if (to - from >= FULL_TURN) path.arc(c[0], c[1], r, 0, FULL_TURN);
      else if (to !== from) path.arc(c[0], c[1], r, -from, -to, true);
      const end = [c[0] + r * Math.cos(to), c[1] - r * Math.sin(to)];
      const start = [c[0] + r * Math.cos(from), c[1] - r * Math.sin(from)];
      if (wantEnd) heads.push({ at: end, angle: Math.atan2(-Math.cos(to), -Math.sin(to)), len: head });
      if (wantStart) heads.push({ at: start, angle: Math.atan2(Math.cos(from), Math.sin(from)), len: head });
      anchor = end; dir = to + Math.PI / 2;
      break;
    }
    case 'polygon': case 'path': {
      const pts = g.points.map((p) => px(m, p(scope)));
      pts.forEach((p, i) => (i ? path.lineTo(p[0], p[1]) : path.moveTo(p[0], p[1])));
      if (L.kind === 'polygon') path.closePath();
      else {
        if (wantEnd) heads.push({ at: pts.at(-1), angle: angleOf(pts.at(-2), pts.at(-1)), len: head });
        if (wantStart) heads.push({ at: pts[0], angle: angleOf(pts[1], pts[0]), len: head });
      }
      anchor = pts[0];
      break;
    }
    case 'text': anchor = px(m, g.at(scope)); break;
    case 'bars': {
      const y = g.y(scope), h = s.height;
      g.rows.forEach((row, i) => {
        const a = px(m, [row.from(scope), y - i * h + h]), b = px(m, [row.to(scope), y - i * h]);
        path.rect(Math.min(a[0], b[0]), a[1], Math.abs(b[0] - a[0]), b[1] - a[1]);
      });
      anchor = px(m, [g.rows[0].from(scope), y + h]);
      break;
    }
    case 'image': {
      const [x, y, w, h] = g.rect.map((f) => f(scope));
      const tl = px(m, [x, y + h]);
      path.rect(tl[0], tl[1], m.len(w), m.len(h));
      anchor = tl;
      break;
    }
    default: anchor = [m.rect.x, m.rect.y];
  }
  return { path, anchor, heads, dir };
}

// ------------------------------------------------------------------- drawing

function applyStroke(ctx, L, env, color) {
  ctx.lineWidth = (L.spec.width ?? 1.5) * (L.highlight ? 2 : 1);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash(L.spec.dash || []);
  ctx.strokeStyle = color;
}

function drawHeads(ctx, heads, color) {
  ctx.fillStyle = color;
  ctx.setLineDash([]);
  for (const h of heads) {
    const hw = h.len * 0.42, bx = h.at[0] - Math.cos(h.angle) * h.len, by = h.at[1] - Math.sin(h.angle) * h.len;
    const nx = -Math.sin(h.angle) * hw, ny = Math.cos(h.angle) * hw;
    ctx.beginPath();
    ctx.moveTo(h.at[0], h.at[1]);
    ctx.lineTo(bx + nx, by + ny);
    ctx.lineTo(bx - nx, by - ny);
    ctx.closePath();
    ctx.fill();
  }
}

function drawHalo(ctx, path, L, color, filled) {
  ctx.save();
  ctx.globalAlpha *= 0.28;
  ctx.setLineDash([]);
  ctx.lineWidth = (L.spec.width ?? 1.5) * 2 + 8;
  ctx.strokeStyle = color;
  ctx.stroke(path);
  if (filled) ctx.fill(path);
  ctx.restore();
}

function drawRegion(ctx, L, env, pathOf, color) {
  const [first, ...rest] = L.spec.of;
  const { op } = L.spec;
  const b = env.box;
  ctx.fillStyle = color;
  if (op === 'union') { for (const id of L.spec.of) ctx.fill(pathOf(id)); return; }
  ctx.clip(pathOf(first));
  for (const id of rest) {
    if (op === 'intersect') { ctx.clip(pathOf(id)); continue; }
    const complement = new Path2D();
    complement.rect(b.x - 10, b.y - 10, b.width + 20, b.height + 20);
    complement.addPath(pathOf(id));
    ctx.clip(complement, 'evenodd');
  }
  ctx.fillRect(b.x, b.y, b.width, b.height);
}

// Labels sit beside the shape: under a circle, past the tip of a line-like
// layer. A tip label that would leave the panel folds back along the line
// (below a near-horizontal line, above a sloped one, clear of the shaft).
// fitBox then keeps every label inside the panel, off the corner buttons and
// clear of the labels placed before it this frame (coincident rays stack).
function drawLayerLabel(ctx, L, geo, env, color) {
  const s = L.spec, b = env.box, size = 12;
  ctx.font = fontOf(size, env.font, { italic: true });
  const w = ctx.measureText(s.label).width;
  let [x, y] = geo.anchor, align = 'left';
  if (L.kind === 'circle' || L.kind === 'ellipse') { y += (L.lastRadius || 0) + 13; align = 'center'; }
  else if (geo.dir !== null) {
    const c = Math.cos(geo.dir), sn = Math.sin(geo.dir);
    x += c * 10; y += sn * 10 - 4;
    align = Math.abs(c) < 0.3 ? 'center' : c > 0 ? 'left' : 'right';
    const left = leftOf(x, w, align);
    if (left < b.x + 4 || left + w > b.x + b.width - 4) {
      [x, y] = geo.anchor;
      align = c >= 0 ? 'right' : 'left';
      x += c >= 0 ? -6 : 6;
      y += Math.abs(sn) < 0.3 ? 16 : -8;
    }
  } else { x += 8; y -= 8; }
  const r = fitBox({ x: leftOf(x, w, align), y: y - size, w, h: size + 2 }, b, { obstacles: env.obstacles, avoid: env.placed });
  env.placed.push(r);
  drawText(ctx, s.label, r.x, r.y + size, { size, align: 'left', color, halo: env.bg, font: env.font, italic: true });
}

const leftOf = (x, w, align) => (align === 'left' ? x : align === 'right' ? x - w : x - w / 2);

// Draws one layer. pathOf(id) returns another layer's Path2D (regions).
// Returns the geometry so readouts can follow the anchor.
export function drawLayer(ctx, L, scope, env, pathOf) {
  const m = env.m, s = L.spec;
  const stroke = s.stroke ? env.tokens.get(s.stroke) : null;
  const fill = s.fill ? env.tokens.get(s.fill) : null;
  const color = stroke || fill || env.fg;
  ctx.save();
  ctx.globalAlpha = L.alpha;
  let geo;
  if (L.kind === 'region') {
    geo = { anchor: [m.rect.x, m.rect.y], heads: [], dir: null };
    drawRegion(ctx, L, env, pathOf, fill);
  } else {
    geo = geometryOf(L, scope, m);
    if (L.kind === 'text') {
      const text = renderTemplate(L.g.parts, scope, env.fmt);
      drawText(ctx, text, geo.anchor[0], geo.anchor[1], { size: s.size || 14, align: s.align || 'center', color, halo: env.bg, font: env.font, bold: L.highlight });
    } else if (L.kind === 'image') {
      if (L.image && L.image.complete && L.image.naturalWidth) {
        const [x, y, w, h] = L.g.rect.map((f) => f(scope));
        ctx.drawImage(L.image, m.x(x), m.y(y + h), m.len(w), m.len(h));
      }
      if (stroke) { applyStroke(ctx, L, env, stroke); ctx.stroke(geo.path); }
    } else {
      if (L.highlight) drawHalo(ctx, geo.path, L, color, !!fill && !stroke);
      if (L.kind === 'bars') drawBars(ctx, L, scope, env, geo);
      else {
        if (fill) { ctx.fillStyle = fill; ctx.fill(geo.path); }
        if (stroke) { applyStroke(ctx, L, env, stroke); ctx.stroke(geo.path); }
        if (geo.heads.length) drawHeads(ctx, geo.heads, color);
      }
    }
  }
  if (s.label) drawLayerLabel(ctx, L, geo, env, color);
  ctx.restore();
  return geo;
}

function drawBars(ctx, L, scope, env, geo) {
  const m = env.m, y0 = L.g.y(scope), h = L.spec.height;
  L.g.rows.forEach((row, i) => {
    const a = [m.x(row.from(scope)), m.y(y0 - i * h + h)], b = [m.x(row.to(scope)), m.y(y0 - i * h)];
    ctx.fillStyle = env.tokens.get(row.token);
    ctx.fillRect(Math.min(a[0], b[0]), a[1], Math.abs(b[0] - a[0]), b[1] - a[1]);
    drawText(ctx, row.label, Math.min(a[0], b[0]) - 6, (a[1] + b[1]) / 2 + 4, { size: 12, align: 'right', color: env.fg, halo: env.bg, font: env.font });
  });
  return geo;
}
