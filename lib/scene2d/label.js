// lib/scene2d/label.js — canvas text with a background halo, readouts, and
// the placement rule labels and readouts share: inside the panel, clear of
// the corner buttons, stacked when two land on the same spot.
import { compileTemplate, renderTemplate } from '../core/format.js';
import { pointGetter, getter } from './getters.js';

export const fontOf = (size, font, { bold = false, italic = false } = {}) => `${italic ? 'italic ' : ''}${bold ? '600 ' : ''}${size}px ${font}`;

export function drawText(ctx, text, x, y, { size = 13, align = 'left', color, halo, font, bold = false, italic = false, baseline = 'alphabetic' }) {
  ctx.save();
  ctx.font = fontOf(size, font, { bold, italic });
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.setLineDash([]);
  if (halo) {
    ctx.lineWidth = Math.max(3, size * 0.25);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = halo;
    ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

export const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// Moves a text box ({ x, y, w, h } in canvas px) inside `bounds`, `pad` from
// each edge: a box that crosses the right edge ends right-aligned at the edge,
// one that crosses the left edge left-aligned there, and the left edge wins
// when the text is wider than the panel. The box then rises above any
// `obstacles` box it meets (the corner buttons, already padded), and steps
// clear of the `avoid` boxes placed earlier this frame by its own height,
// downward when there is room, else upward.
export function fitBox(rect, bounds, { pad = 4, obstacles = [], avoid = [] } = {}) {
  const lo = { x: bounds.x + pad, y: bounds.y + pad };
  const hi = { x: bounds.x + bounds.width - pad - rect.w, y: bounds.y + bounds.height - pad - rect.h };
  const r = { x: Math.max(Math.min(rect.x, hi.x), lo.x), y: Math.max(Math.min(rect.y, hi.y), lo.y), w: rect.w, h: rect.h };
  for (const o of obstacles) if (overlaps(o, r)) r.y = Math.max(o.y - r.h, lo.y);
  const step = r.y + r.h + 2 <= hi.y ? r.h + 2 : -(r.h + 2);
  for (let i = 0; i < 3 && avoid.some((a) => overlaps(a, r)); i++) r.y += step;
  return r;
}

export function compileReadout(spec) {
  return {
    id: spec.id || null, spec,
    parts: compileTemplate(spec.text),
    at: spec.at ? pointGetter(spec.at) : null,
    visible: 'visible' in spec ? getter(spec.visible) : null,
    highlight: false,
    last: '',
  };
}

// anchors: Map layerId -> [px, py] from this frame's draw.
export function drawReadout(ctx, R, scope, env, anchors) {
  if (R.visible && R.visible(scope) === 0) { R.last = ''; return; }
  const [dx, dy] = R.spec.offset || [0, 0];
  let p;
  if (R.at) p = [env.m.x(R.at(scope)[0]), env.m.y(R.at(scope)[1])];
  else p = anchors.get(R.spec.anchor);
  if (!p) { R.last = ''; return; }
  const text = renderTemplate(R.parts, scope, env.fmt);
  R.last = text;
  const size = 13, x = p[0] + dx, y = p[1] + dy;
  const align = R.at ? (R.at(scope)[0] < (env.view.x[0] + env.view.x[1]) / 2 ? 'left' : 'right') : dx < 0 ? 'right' : 'left';
  ctx.font = fontOf(size, env.font, { bold: R.highlight });
  const w = ctx.measureText(text).width;
  const r = fitBox({ x: align === 'left' ? x : x - w, y: y - size / 2 - 1, w, h: size + 2 }, env.box, { obstacles: env.obstacles });
  drawText(ctx, text, r.x, r.y + r.h / 2, { size, align: 'left', color: env.tokens.get(R.spec.token), halo: env.bg, font: env.font, bold: R.highlight, baseline: 'middle' });
}
