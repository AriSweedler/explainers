// lib/scene2d/plot.js — plot panels (axes, nice ticks, series, marker,
// guides) and timeline bars, both on the shared Canvas 2D.
import { compile, evaluate } from '../expr.js';
import { getter } from './getters.js';
import { drawText } from './label.js';
import { MINUS } from '../core/format.js';

const PAD = { left: 48, right: 14, top: 12, bottom: 34 };

// 1-2-5 ticks covering [min, max] with about n intervals.
export function niceTicks(min, max, n = 5) {
  const raw = (max - min) / Math.max(n, 1);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const ticks = [];
  for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + step * 1e-9; v += step) ticks.push(Number(v.toFixed(10)));
  return { step, ticks };
}

export function tickLabel(v, step) {
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  return v.toFixed(decimals).replace('-', MINUS);
}

function logTicks(min, max) {
  const ticks = [];
  for (let e = Math.floor(Math.log10(min)); e <= Math.ceil(Math.log10(max)); e++) {
    const v = 10 ** e;
    if (v >= min && v <= max) ticks.push(v);
  }
  return { step: 1, ticks, log: true };
}

export function compilePlot(shows) {
  return {
    kind: 'plot', x: shows.x, y: shows.y,
    series: shows.series.map((s) => ({ ...s, ast: compile(s.y).ast })),
    marker: shows.marker ? { x: getter(shows.marker.x), token: shows.marker.token } : null,
    guides: (shows.guides || []).map((g) => ({ ...g, at: getter(g.x ?? g.y), vertical: 'x' in g })),
  };
}

function axisMap(box, P) {
  const inner = { x: box.x + PAD.left, y: box.y + PAD.top, w: box.width - PAD.left - PAD.right, h: box.height - PAD.top - PAD.bottom };
  const yl = P.y.log ? Math.log10 : (v) => v;
  const y0 = yl(P.y.min), y1 = yl(P.y.max);
  return {
    inner,
    px: (x) => inner.x + ((x - P.x.min) / (P.x.max - P.x.min)) * inner.w,
    py: (y) => inner.y + inner.h - ((yl(y) - y0) / (y1 - y0)) * inner.h,
  };
}

function drawAxes(ctx, box, P, env, A) {
  const { inner } = A;
  const xt = niceTicks(P.x.min, P.x.max, Math.max(2, Math.round(inner.w / 70)));
  const yt = P.y.log ? logTicks(P.y.min, P.y.max) : niceTicks(P.y.min, P.y.max, Math.max(2, Math.round(inner.h / 40)));
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = env.grid;
  ctx.setLineDash([]);
  for (const v of xt.ticks) { const x = A.px(v); ctx.beginPath(); ctx.moveTo(x, inner.y); ctx.lineTo(x, inner.y + inner.h); ctx.stroke(); }
  for (const v of yt.ticks) { const y = A.py(v); ctx.beginPath(); ctx.moveTo(inner.x, y); ctx.lineTo(inner.x + inner.w, y); ctx.stroke(); }
  ctx.strokeStyle = env.axis;
  ctx.beginPath(); ctx.moveTo(inner.x, inner.y); ctx.lineTo(inner.x, inner.y + inner.h); ctx.lineTo(inner.x + inner.w, inner.y + inner.h); ctx.stroke();
  const opts = { size: 11, color: env.muted, font: env.font };
  for (const v of xt.ticks) drawText(ctx, tickLabel(v, xt.step), A.px(v), inner.y + inner.h + 14, { ...opts, align: 'center' });
  for (const v of yt.ticks) drawText(ctx, yt.log ? `10${superscript(Math.round(Math.log10(v)))}` : tickLabel(v, yt.step), inner.x - 6, A.py(v) + 4, { ...opts, align: 'right' });
  const unit = (ax) => (ax.unit ? ` (${ax.unit})` : '');
  drawText(ctx, P.x.label + unit(P.x), inner.x + inner.w / 2, box.y + box.height - 6, { ...opts, size: 12, align: 'center', color: env.fg });
  ctx.translate(box.x + 12, inner.y + inner.h / 2);
  ctx.rotate(-Math.PI / 2);
  drawText(ctx, P.y.label + unit(P.y), 0, 0, { ...opts, size: 12, align: 'center', color: env.fg });
  ctx.restore();
}

const superscript = (n) => String(n).replace(/-/g, '⁻').replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d]);

function drawSeries(ctx, P, scope, env, A) {
  const derived = new Map(scope);
  for (const s of P.series) {
    const n = s.samples || 200;
    ctx.save();
    ctx.beginPath();
    ctx.rect(A.inner.x, A.inner.y - 1, A.inner.w, A.inner.h + 2);
    ctx.clip();
    ctx.beginPath();
    let pen = false;
    for (let i = 0; i <= n; i++) {
      const x = P.x.min + ((P.x.max - P.x.min) * i) / n;
      derived.set(P.x.var, x);
      let y;
      try { y = evaluate(s.ast, derived, s.y); } catch { pen = false; continue; }
      if (P.y.log && y <= 0) { pen = false; continue; }
      const X = A.px(x), Y = A.py(y);
      if (pen) ctx.lineTo(X, Y); else { ctx.moveTo(X, Y); pen = true; }
    }
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.setLineDash(s.dash || []);
    ctx.strokeStyle = env.tokens.get(s.token);
    ctx.stroke();
    ctx.restore();
  }
}

function seriesValueAt(s, P, scope, x) {
  const derived = new Map(scope);
  derived.set(P.x.var, x);
  try { return evaluate(s.ast, derived, s.y); } catch { return NaN; }
}

function drawMarker(ctx, P, scope, env, A) {
  if (!P.marker) return;
  const x = P.marker.x(scope);
  if (x < P.x.min || x > P.x.max) return;
  const color = env.tokens.get(P.marker.token);
  const X = A.px(x);
  ctx.save();
  ctx.setLineDash([3, 3]);
  ctx.lineWidth = 1;
  ctx.strokeStyle = color;
  ctx.beginPath(); ctx.moveTo(X, A.inner.y); ctx.lineTo(X, A.inner.y + A.inner.h); ctx.stroke();
  ctx.setLineDash([]);
  for (const s of P.series) {
    const y = seriesValueAt(s, P, scope, x);
    if (!Number.isFinite(y) || y < P.y.min || y > P.y.max) continue;
    ctx.fillStyle = env.tokens.get(s.token);
    ctx.beginPath(); ctx.arc(X, A.py(y), 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = env.bg; ctx.lineWidth = 1.5; ctx.stroke();
  }
  ctx.restore();
}

function drawGuides(ctx, P, scope, env, A) {
  for (const g of P.guides) {
    const v = g.at(scope), color = env.tokens.get(g.token);
    ctx.save();
    ctx.setLineDash(g.dash || [4, 4]);
    ctx.lineWidth = 1.25;
    ctx.strokeStyle = color;
    ctx.beginPath();
    if (g.vertical) { const X = A.px(v); ctx.moveTo(X, A.inner.y); ctx.lineTo(X, A.inner.y + A.inner.h); }
    else { const Y = A.py(v); ctx.moveTo(A.inner.x, Y); ctx.lineTo(A.inner.x + A.inner.w, Y); }
    ctx.stroke();
    if (g.label) {
      if (g.vertical) drawText(ctx, g.label, A.px(v) + 4, A.inner.y + 12, { size: 11, color, halo: env.bg, font: env.font });
      else drawText(ctx, g.label, A.inner.x + A.inner.w - 4, A.py(v) - 4, { size: 11, align: 'right', color, halo: env.bg, font: env.font });
    }
    ctx.restore();
  }
}

export function drawPlot(ctx, box, P, scope, env) {
  const A = axisMap(box, P);
  drawAxes(ctx, box, P, env, A);
  drawGuides(ctx, P, scope, env, A);
  drawSeries(ctx, P, scope, env, A);
  drawMarker(ctx, P, scope, env, A);
}

// ----------------------------------------------------------------- timeline

export function compileTimeline(shows) {
  return {
    kind: 'timeline', x: shows.x,
    bars: shows.bars.map((b) => ({ ...b, from: getter(b.from), to: getter(b.to) })),
    marker: shows.marker ? { x: getter(shows.marker.x), token: shows.marker.token } : null,
  };
}

export function drawTimeline(ctx, box, T, scope, env) {
  ctx.save();
  ctx.font = `12px ${env.font}`;
  const labelW = Math.max(...T.bars.map((b) => ctx.measureText(b.label).width)) + 16;
  const inner = { x: box.x + labelW, y: box.y + 10, w: box.width - labelW - 14, h: box.height - 10 - 32 };
  const px = (v) => inner.x + ((v - T.x.min) / (T.x.max - T.x.min)) * inner.w;
  const rowH = inner.h / T.bars.length;
  const xt = niceTicks(T.x.min, T.x.max, Math.max(2, Math.round(inner.w / 70)));
  ctx.strokeStyle = env.grid; ctx.lineWidth = 1; ctx.setLineDash([]);
  for (const v of xt.ticks) { const X = px(v); ctx.beginPath(); ctx.moveTo(X, inner.y); ctx.lineTo(X, inner.y + inner.h); ctx.stroke(); drawText(ctx, tickLabel(v, xt.step), X, inner.y + inner.h + 14, { size: 11, align: 'center', color: env.muted, font: env.font }); }
  drawText(ctx, T.x.label + (T.x.unit ? ` (${T.x.unit})` : ''), inner.x + inner.w / 2, box.y + box.height - 6, { size: 12, align: 'center', color: env.fg, font: env.font });
  T.bars.forEach((b, i) => {
    const y = inner.y + i * rowH + rowH * 0.25, h = rowH * 0.5;
    const a = px(Math.max(T.x.min, Math.min(b.from(scope), b.to(scope)))), c = px(Math.min(T.x.max, Math.max(b.from(scope), b.to(scope))));
    ctx.fillStyle = env.tokens.get(b.token);
    ctx.fillRect(a, y, Math.max(c - a, 1), h);
    drawText(ctx, b.label, inner.x - 8, y + h / 2 + 4, { size: 12, align: 'right', color: env.fg, font: env.font });
  });
  if (T.marker) {
    const X = px(T.marker.x(scope));
    ctx.setLineDash([3, 3]); ctx.strokeStyle = env.tokens.get(T.marker.token); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(X, inner.y); ctx.lineTo(X, inner.y + inner.h); ctx.stroke();
  }
  ctx.restore();
}
