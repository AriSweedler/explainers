// lib/poster-svg.js — the first frame of a figure as a static SVG.
// `explainers build` (Node) calls posterSvg() and puts the result in front of
// the figure's JSON block, so a reader without JavaScript, and the first
// paint before the canvas mounts, see the same drawing the runtime draws:
// the geometry comes from the same compiled layers and the same worldToPx,
// geometryOf, fitBox and axis helpers the canvas uses; only the drawing
// surface differs. Colors are palette tokens as var(--c-<name>) inside the
// SVG's own <style>, so an inline poster follows the page's light/dark scheme;
// the palette values travel along as fallbacks for a poster served as an
// external <img>. Plain ES2020, no dependencies, no DOM.
import { validateSpec, scopeForState } from './spec.js';
import { worldToPx, splitBoxes } from './core/layout.js';
import { renderTemplate, compileTemplate } from './core/format.js';
import { evaluate } from './expr.js';
import { getter } from './scene2d/getters.js';
import { compileLayer, geometryOf, isShown } from './scene2d/layers.js';
import { compileReadout, fitBox } from './scene2d/label.js';
import { compilePlot, compileTimeline, axisMap, niceTicks, tickLabel, logTicks, superscript } from './scene2d/plot.js';
import { applyModel } from './scene2d/models/index.js';
import { initialPose, eyeFor, lookAt, project, pxPerWorld, toWorld } from './scene3d/camera.js';
import { latLonToPoint } from './scene3d/surface.js';
import { compileObject, evalObject, circlePoints, labelSpecs, RING_WIDTH_PX, labelPosition } from './scene3d/objects.js';

export const POSTER_VERSION = 2; // 2: scene3d posters are the projected first frame (3B)
export const POSTER_WIDTH = 704;   // the 44rem reading column at 16 px (its 1rem gutters are padding outside the content box), so the canvas at desktop width
const CORNER_STRIP_PX = 60;        // what the runtime measures for the corner buttons: 8 px inset + 44 px button + 8 px pad
const TAU = Math.PI * 2;
const FONT = '"Source Sans 3", system-ui, -apple-system, "Segoe UI", sans-serif';
const FALLBACK = { '--bg': 'light-dark(#faf8f5, #151412)', '--fg': 'light-dark(#1d1c1a, #e8e4dc)', '--x-panel': 'light-dark(#f2f0ed, #1c1b19)' };
const HEAD_PX = 10;

const n = (v) => {
  const r = Math.round(v * 10) / 10;
  return Number.isFinite(r) ? String(r === 0 ? 0 : r) : '0';
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Canvas text is measured; a poster estimates: Source Sans 3 averages about half an em per glyph.
const measure = (text, size) => String(text).length * size * 0.5;
const leftOf = (x, w, align) => (align === 'left' ? x : align === 'right' ? x - w : x - w / 2);

// Records the Path2D calls geometryOf() makes as SVG path data (canvas px,
// y down, the same coordinate system).
export class SvgPath {
  constructor() { this.d = ''; }
  moveTo(x, y) { this.d += `M${n(x)} ${n(y)}`; }
  lineTo(x, y) { this.d += `L${n(x)} ${n(y)}`; }
  closePath() { this.d += 'Z'; }
  rect(x, y, w, h) { this.d += `M${n(x)} ${n(y)}h${n(w)}v${n(h)}h${n(-w)}Z`; }
  addPath(p) { this.d += p.d; }
  arc(cx, cy, r, a0, a1, ccw = false) { this.ellipse(cx, cy, r, r, 0, a0, a1, ccw); }
  // Canvas semantics: a sweep of a full turn or more is the whole ellipse;
  // otherwise the sweep is taken modulo one turn in the requested direction.
  ellipse(cx, cy, rx, ry, rot, a0, a1, ccw = false) {
    const cr = Math.cos(rot), sr = Math.sin(rot);
    const at = (t) => [cx + rx * Math.cos(t) * cr - ry * Math.sin(t) * sr, cy + rx * Math.cos(t) * sr + ry * Math.sin(t) * cr];
    let sweep = ccw ? a0 - a1 : a1 - a0;
    const full = sweep >= TAU - 1e-3;
    if (!full) sweep = ((sweep % TAU) + TAU) % TAU;
    const [sx, sy] = at(a0);
    this.d += `${this.d ? 'L' : 'M'}${n(sx)} ${n(sy)}`;
    const deg = n((rot * 180) / Math.PI), dir = ccw ? 0 : 1;
    if (full) {
      const [mx, my] = at(a0 + (ccw ? -Math.PI : Math.PI));
      this.d += `A${n(rx)} ${n(ry)} ${deg} 1 ${dir} ${n(mx)} ${n(my)}A${n(rx)} ${n(ry)} ${deg} 1 ${dir} ${n(sx)} ${n(sy)}`;
      return;
    }
    if (sweep < 1e-6) return;
    const [ex, ey] = at(ccw ? a0 - sweep : a0 + sweep);
    this.d += `A${n(rx)} ${n(ry)} ${deg} ${sweep > Math.PI ? 1 : 0} ${dir} ${n(ex)} ${n(ey)}`;
  }
}
const mk = () => new SvgPath();

function compilePanel(shows) {
  const readouts = (shows.readouts || []).map(compileReadout);
  if (shows.type === 'plot') return { kind: 'plot', P: compilePlot(shows), readouts, layers: [] };
  if (shows.type === 'timeline') return { kind: 'timeline', T: compileTimeline(shows), readouts, layers: [] };
  const layers = shows.layers.map(compileLayer);
  return { kind: 'scene2d', view: shows.view, layers, byId: new Map(layers.map((L) => [L.id, L])), readouts };
}

class Emitter {
  constructor(id, tokens) {
    this.id = `${id}-poster`;
    this.tokens = tokens instanceof Map ? tokens : new Map(Object.entries(tokens || {}));
    this.parts = [];
    this.defs = [];
    this.used = new Set();
    this.clips = 0;
  }

  // ---- color classes: s-<token> strokes, f-<token> fills; fg/bg/panel likewise
  cls(kind, tok) { const c = kind === 'h' ? 'h' : `${kind}-${tok || 'fg'}`; this.used.add(c); return c; }
  fallback(tok) {
    if (tok === 'fg' || tok === 'bg') return this.tokens.get(`--${tok}`) || FALLBACK[`--${tok}`];
    if (tok === 'panel') return this.tokens.get('--x-panel') || FALLBACK['--x-panel'];
    return this.tokens.get(tok) || null;
  }
  varOf(tok) {
    const prop = tok === 'fg' || tok === 'bg' ? `--${tok}` : tok === 'panel' ? '--x-panel' : `--c-${tok}`;
    const fb = this.fallback(tok);
    return fb ? `var(${prop}, ${fb})` : `var(${prop})`;
  }
  style() {
    const id = `#${this.id}`;
    // :root matches only when the SVG is its own document (an external <img>
    // poster), where light-dark() needs the scheme declared; inline it inherits the page's.
    const rules = [`${id}:root{color-scheme:light dark}`, `${id}{font:13px ${FONT.replace(/"/g, "'")}}`];
    for (const c of [...this.used].sort()) {
      const [kind, ...rest] = c.split('-'), tok = rest.join('-');
      if (c === 'h') rules.push(`${id} .h{paint-order:stroke;stroke:${this.varOf('bg')};stroke-width:3;stroke-linejoin:round}`);
      else rules.push(`${id} .${c}{${kind === 's' ? 'stroke' : 'fill'}:${this.varOf(tok)}}`);
    }
    return `<style>${rules.join('\n')}</style>`;
  }
  clip(d, evenodd = false) {
    const cid = `${this.id}-c${this.clips++}`;
    this.defs.push(`<clipPath id="${cid}"><path d="${d}"${evenodd ? ' clip-rule="evenodd"' : ''}/></clipPath>`);
    return cid;
  }
  rectPath(b) { return `M${n(b.x)} ${n(b.y)}h${n(b.width)}v${n(b.height)}h${n(-b.width)}Z`; }

  // ---- primitives
  path(d, { stroke, fill, width = 1.5, dash, opacity, fillOpacity, strokeOpacity } = {}) {
    if (!d) return;
    const cls = [stroke ? this.cls('s', stroke) : '', fill ? this.cls('f', fill) : ''].filter(Boolean).join(' ');
    let a = cls ? ` class="${cls}"` : '';
    if (stroke) a += ` stroke-width="${n(width)}"`;
    if (dash && dash.length) a += ` stroke-dasharray="${dash.map(n).join(' ')}"`;
    if (opacity !== undefined) a += ` opacity="${n(opacity)}"`;
    if (fillOpacity !== undefined) a += ` fill-opacity="${fillOpacity}"`;
    if (strokeOpacity !== undefined) a += ` stroke-opacity="${strokeOpacity}"`;
    this.parts.push(`<path d="${d}"${a}/>`);
  }
  text(str, x, y, { size = 13, align = 'left', color = 'fg', halo = true, bold = false, italic = false, middle = false, opacity, transform } = {}) {
    const s = String(str);
    if (!s) return;
    const cls = [this.cls('f', color), halo ? this.cls('h') : ''].filter(Boolean).join(' ');
    let a = ` class="${cls}"`;
    if (size !== 13) a += ` font-size="${n(size)}"`;
    if (align !== 'left') a += ` text-anchor="${align === 'center' ? 'middle' : 'end'}"`;
    if (bold) a += ' font-weight="600"';
    if (italic) a += ' font-style="italic"';
    if (middle) a += ' dominant-baseline="central"';
    if (opacity !== undefined) a += ` opacity="${opacity}"`;
    if (transform) a += ` transform="${transform}"`;
    this.parts.push(`<text x="${n(x)}" y="${n(y)}"${a}>${esc(s)}</text>`);
  }
  circle(cx, cy, r, { fill, stroke, width } = {}) {
    const cls = [stroke ? this.cls('s', stroke) : '', fill ? this.cls('f', fill) : ''].filter(Boolean).join(' ');
    this.parts.push(`<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" class="${cls}"${stroke ? ` stroke-width="${n(width || 1.5)}"` : ''}/>`);
  }
  heads(heads, color) {
    for (const h of heads) {
      const hw = h.len * 0.42, bx = h.at[0] - Math.cos(h.angle) * h.len, by = h.at[1] - Math.sin(h.angle) * h.len;
      const nx = -Math.sin(h.angle) * hw, ny = Math.cos(h.angle) * hw;
      this.path(`M${n(h.at[0])} ${n(h.at[1])}L${n(bx + nx)} ${n(by + ny)}L${n(bx - nx)} ${n(by - ny)}Z`, { fill: color });
    }
  }

  // ---- the scene: panels, layers, readouts, drag handles (mirrors lib/scene2d/scene2d.js)
  scene(compiled, scope, W, H) {
    const shows = compiled.spec.shows, controls = compiled.spec.manipulates.controls;
    if (shows.model) {
      const params = {};
      for (const [k, v] of Object.entries(shows.model.params)) params[k] = getter(v);
      applyModel(shows.model, params, scope);
    }
    const main = compilePanel(shows);
    const splits = (shows.split || []).map((p) => ({ at: p.at, panel: compilePanel(p.shows) }));
    const previews = new Set(controls.flatMap((c) => c.preview || []));
    for (const p of [main, ...splits.map((s) => s.panel)]) for (const L of p.layers) if (previews.has(L.id)) L.forceHide = true;
    const hasCorner = controls.some((c) => c.kind === 'play' || (c.kind === 'time' && c.mode === 'speed') || (c.kind === 'toggle' && (c.position || 'corner') === 'corner'));
    const box = { x: 0, y: 0, width: W, height: H };
    const drawBox = hasCorner ? { ...box, height: Math.max(H - CORNER_STRIP_PX, H * 0.6) } : box;
    const boxes = splitBoxes(drawBox, splits);
    this.parts.push(`<rect width="${W}" height="${H}" rx="8" class="${this.cls('f', 'panel')}"/>`);
    const mainMap = this.panel(main, boxes.main, scope, false);
    splits.forEach((s, i) => this.panel(s.panel, boxes.panels[i], scope, boxes.panels[i].inset));
    if (mainMap) {
      for (const c of controls) {
        if (c.kind !== 'drag' || c.constrain.startsWith('surface:')) continue;
        const x = mainMap.x(scope.get(`${c.name}.x`)), y = mainMap.y(scope.get(`${c.name}.y`));
        this.circle(x, y, 7, { fill: c.token, stroke: 'bg', width: 2 });
      }
    }
  }

  panel(panel, pbox, scope, inset) {
    const open = this.parts.length;
    this.parts.push(''); // the clip group opens here once the panel's clip exists
    if (inset) {
      this.parts.push(`<rect x="${n(pbox.x)}" y="${n(pbox.y)}" width="${n(pbox.width)}" height="${n(pbox.height)}" class="${this.cls('f', 'bg')}"/>`);
      this.path(this.rectPath({ x: pbox.x + 0.5, y: pbox.y + 0.5, width: pbox.width - 1, height: pbox.height - 1 }), { stroke: 'fg', width: 1, strokeOpacity: '.1' });
    }
    let m = null;
    if (panel.kind === 'scene2d') m = this.paintScene(panel, pbox, scope);
    else if (panel.kind === 'plot') this.plot(pbox, panel.P, scope);
    else this.timeline(pbox, panel.T, scope);
    this.parts[open] = `<g clip-path="url(#${this.clip(this.rectPath(pbox))})">`;
    this.parts.push('</g>');
    return m;
  }

  paintScene(panel, pbox, scope) {
    const m = worldToPx(panel.view, pbox);
    const env = { m, view: panel.view, box: pbox, placed: [], obstacles: [] };
    const anchors = new Map();
    const pathOf = (id) => geometryOf(panel.byId.get(id), scope, m, mk).path;
    for (const L of panel.layers) {
      if (isShown(L, scope)) anchors.set(L.id, this.layer(L, scope, env, pathOf).anchor);
      else if (L.kind !== 'region') anchors.set(L.id, geometryOf(L, scope, m, mk).anchor);
    }
    for (const R of panel.readouts) this.readout(R, scope, env, anchors);
    return m;
  }

  layer(L, scope, env, pathOf) {
    const s = L.spec, m = env.m;
    const stroke = s.stroke || null, fill = s.fill || null, color = stroke || fill || 'fg';
    let geo;
    if (L.kind === 'region') {
      geo = { anchor: [m.rect.x, m.rect.y], heads: [], dir: null };
      this.region(L, fill, pathOf, env.box);
    } else {
      geo = geometryOf(L, scope, m, mk);
      const width = (s.width ?? 1.5) * (L.highlight ? 2 : 1);
      if (L.kind === 'text') {
        this.text(renderTemplate(L.g.parts, scope, {}), geo.anchor[0], geo.anchor[1], { size: s.size || 14, align: s.align || 'center', color, bold: L.highlight });
      } else if (L.kind === 'image') {
        this.path(geo.path.d, { stroke: stroke || 'fg', width: stroke ? width : 1, dash: stroke ? s.dash : [4, 4], strokeOpacity: stroke ? undefined : '.35' });
      } else if (L.kind === 'bars') {
        this.bars(L, scope, m);
      } else {
        if (L.highlight) this.path(geo.path.d, { stroke: color, fill: fill && !stroke ? fill : undefined, width: (s.width ?? 1.5) * 2 + 8, opacity: 0.28 });
        this.path(geo.path.d, { stroke, fill, width, dash: s.dash });
        if (geo.heads.length) this.heads(geo.heads, color);
      }
    }
    if (s.label) this.layerLabel(L, geo, env, color);
    return geo;
  }

  bars(L, scope, m) {
    const y0 = L.g.y(scope), h = L.spec.height;
    L.g.rows.forEach((row, i) => {
      const a = [m.x(row.from(scope)), m.y(y0 - i * h + h)], b = [m.x(row.to(scope)), m.y(y0 - i * h)];
      this.path(this.rectPath({ x: Math.min(a[0], b[0]), y: a[1], width: Math.abs(b[0] - a[0]), height: b[1] - a[1] }), { fill: row.token });
      this.text(row.label, Math.min(a[0], b[0]) - 6, (a[1] + b[1]) / 2 + 4, { size: 12, align: 'right' });
    });
  }

  // Regions combine other layers' shapes: union fills each; intersect and
  // subtract nest clip paths the way the canvas nests ctx.clip().
  region(L, fill, pathOf, box) {
    const [first, ...rest] = L.spec.of, op = L.spec.op;
    if (op === 'union') { for (const id of L.spec.of) this.path(pathOf(id).d, { fill }); return; }
    const clips = [this.clip(pathOf(first).d)];
    const outer = this.rectPath({ x: box.x - 10, y: box.y - 10, width: box.width + 20, height: box.height + 20 });
    for (const id of rest) clips.push(op === 'intersect' ? this.clip(pathOf(id).d) : this.clip(outer + pathOf(id).d, true));
    for (const c of clips) this.parts.push(`<g clip-path="url(#${c})">`);
    this.path(this.rectPath(box), { fill });
    for (const c of clips) this.parts.push('</g>');
  }

  // lib/scene2d/layers.js drawLayerLabel, with estimated text widths
  layerLabel(L, geo, env, color) {
    const s = L.spec, b = env.box, size = 12, w = measure(s.label, size);
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
    this.text(s.label, r.x, r.y + size, { size, color, italic: true });
  }

  // lib/scene2d/label.js drawReadout
  readout(R, scope, env, anchors) {
    if (R.visible && R.visible(scope) === 0) return;
    const [dx, dy] = R.spec.offset || [0, 0];
    const p = R.at ? [env.m.x(R.at(scope)[0]), env.m.y(R.at(scope)[1])] : anchors.get(R.spec.anchor);
    if (!p) return;
    const text = renderTemplate(R.parts, scope, {});
    const size = 13, x = p[0] + dx, y = p[1] + dy, w = measure(text, size);
    const align = R.at ? (R.at(scope)[0] < (env.view.x[0] + env.view.x[1]) / 2 ? 'left' : 'right') : dx < 0 ? 'right' : 'left';
    const r = fitBox({ x: align === 'left' ? x : x - w, y: y - size / 2 - 1, w, h: size + 2 }, env.box, { obstacles: env.obstacles });
    this.text(text, r.x, r.y + r.h / 2, { size, color: R.spec.token, bold: R.highlight, middle: true });
  }

  // ---- plot panels (lib/scene2d/plot.js drawPlot)
  plot(box, P, scope) {
    const A = axisMap(box, P), inner = A.inner;
    const xt = niceTicks(P.x.min, P.x.max, Math.max(2, Math.round(inner.w / 70)));
    const yt = P.y.log ? logTicks(P.y.min, P.y.max) : niceTicks(P.y.min, P.y.max, Math.max(2, Math.round(inner.h / 40)));
    const grid = xt.ticks.map((v) => `M${n(A.px(v))} ${n(inner.y)}v${n(inner.h)}`).join('') + yt.ticks.map((v) => `M${n(inner.x)} ${n(A.py(v))}h${n(inner.w)}`).join('');
    this.path(grid, { stroke: 'fg', width: 1, strokeOpacity: '.1' });
    this.path(`M${n(inner.x)} ${n(inner.y)}v${n(inner.h)}h${n(inner.w)}`, { stroke: 'fg', width: 1, strokeOpacity: '.45' });
    for (const v of xt.ticks) this.text(tickLabel(v, xt.step), A.px(v), inner.y + inner.h + 14, { size: 11, align: 'center', halo: false, opacity: '.65' });
    for (const v of yt.ticks) this.text(yt.log ? `10${superscript(Math.round(Math.log10(v)))}` : tickLabel(v, yt.step), inner.x - 6, A.py(v) + 4, { size: 11, align: 'right', halo: false, opacity: '.65' });
    const unit = (ax) => (ax.unit ? ` (${ax.unit})` : '');
    this.text(P.x.label + unit(P.x), inner.x + inner.w / 2, box.y + box.height - 6, { size: 12, align: 'center', halo: false });
    this.text(P.y.label + unit(P.y), 0, 0, { size: 12, align: 'center', halo: false, transform: `translate(${n(box.x + 12)} ${n(inner.y + inner.h / 2)}) rotate(-90)` });
    for (const g of P.guides) {
      const v = g.at(scope);
      const d = g.vertical ? `M${n(A.px(v))} ${n(inner.y)}v${n(inner.h)}` : `M${n(inner.x)} ${n(A.py(v))}h${n(inner.w)}`;
      this.path(d, { stroke: g.token, width: 1.25, dash: g.dash || [4, 4] });
      if (g.label) {
        if (g.vertical) this.text(g.label, A.px(v) + 4, inner.y + 12, { size: 11, color: g.token });
        else this.text(g.label, inner.x + inner.w - 4, A.py(v) - 4, { size: 11, align: 'right', color: g.token });
      }
    }
    const clipId = this.clip(this.rectPath({ x: inner.x, y: inner.y - 1, width: inner.w, height: inner.h + 2 }));
    this.parts.push(`<g clip-path="url(#${clipId})">`);
    const derived = new Map(scope);
    for (const s of P.series) {
      const count = s.samples || 200;
      let d = '', pen = false;
      for (let i = 0; i <= count; i++) {
        const x = P.x.min + ((P.x.max - P.x.min) * i) / count;
        derived.set(P.x.var, x);
        let y;
        try { y = evaluate(s.ast, derived, s.y); } catch { pen = false; continue; }
        if (!Number.isFinite(y) || (P.y.log && y <= 0)) { pen = false; continue; }
        d += `${pen ? 'L' : 'M'}${n(A.px(x))} ${n(A.py(y))}`;
        pen = true;
      }
      this.path(d, { stroke: s.token, width: 2, dash: s.dash });
    }
    this.parts.push('</g>');
    if (P.marker) {
      const x = P.marker.x(scope);
      if (x >= P.x.min && x <= P.x.max) {
        const X = A.px(x);
        this.path(`M${n(X)} ${n(inner.y)}v${n(inner.h)}`, { stroke: P.marker.token, width: 1, dash: [3, 3] });
        for (const s of P.series) {
          derived.set(P.x.var, x);
          let y;
          try { y = evaluate(s.ast, derived, s.y); } catch { continue; }
          if (!Number.isFinite(y) || y < P.y.min || y > P.y.max) continue;
          this.circle(X, A.py(y), 4.5, { fill: s.token, stroke: 'bg', width: 1.5 });
        }
      }
    }
  }

  // ---- timeline panels (lib/scene2d/plot.js drawTimeline)
  timeline(box, T, scope) {
    const labelW = Math.max(...T.bars.map((b) => measure(b.label, 12))) + 16;
    const inner = { x: box.x + labelW, y: box.y + 10, w: box.width - labelW - 14, h: box.height - 10 - 32 };
    const px = (v) => inner.x + ((v - T.x.min) / (T.x.max - T.x.min)) * inner.w;
    const rowH = inner.h / T.bars.length;
    const xt = niceTicks(T.x.min, T.x.max, Math.max(2, Math.round(inner.w / 70)));
    this.path(xt.ticks.map((v) => `M${n(px(v))} ${n(inner.y)}v${n(inner.h)}`).join(''), { stroke: 'fg', width: 1, strokeOpacity: '.1' });
    for (const v of xt.ticks) this.text(tickLabel(v, xt.step), px(v), inner.y + inner.h + 14, { size: 11, align: 'center', halo: false, opacity: '.65' });
    this.text(T.x.label + (T.x.unit ? ` (${T.x.unit})` : ''), inner.x + inner.w / 2, box.y + box.height - 6, { size: 12, align: 'center', halo: false });
    T.bars.forEach((b, i) => {
      const y = inner.y + i * rowH + rowH * 0.25, h = rowH * 0.5;
      const from = b.from(scope), to = b.to(scope);
      const a = px(Math.max(T.x.min, Math.min(from, to))), c = px(Math.min(T.x.max, Math.max(from, to)));
      this.path(this.rectPath({ x: a, y, width: Math.max(c - a, 1), height: h }), { fill: b.token });
      this.text(b.label, inner.x - 8, y + h / 2 + 4, { size: 12, align: 'right', halo: false });
    });
    if (T.marker) this.path(`M${n(px(T.marker.x(scope)))} ${n(inner.y)}v${n(inner.h)}`, { stroke: T.marker.token, width: 1.5, dash: [3, 3] });
  }

  // ---- scene3d: the first frame the chunk will draw, projected through the
  // same camera math (lib/scene3d/camera.js): spheres as circles, rings as
  // polylines split behind / in front of the view center, discs as polygons,
  // arrows, labels, surface drag handles; meshes (body, part) are unknown to
  // the poster and drawn as nothing. Painter's order by depth.
  scene3d(compiled, scope, W, H) {
    const shows = compiled.spec.shows, controls = compiled.spec.manipulates.controls;
    if (shows.model) {
      const params = {};
      for (const [k, v] of Object.entries(shows.model.params)) params[k] = getter(v);
      applyModel(shows.model, params, scope);
    }
    const splits = (shows.split || []).map((p) => ({ at: p.at, panel: compilePanel(p.shows) }));
    const hasCorner = controls.some((c) => c.kind === 'play' || (c.kind === 'time' && c.mode === 'speed') || (c.kind === 'toggle' && (c.position || 'corner') === 'corner'));
    const box = { x: 0, y: 0, width: W, height: H };
    const drawBox = hasCorner ? { ...box, height: Math.max(H - CORNER_STRIP_PX, H * 0.6) } : box;
    const boxes = splitBoxes(drawBox, splits), vb = boxes.main;
    this.parts.push(`<rect width="${W}" height="${H}" rx="8" class="${this.cls('f', 'panel')}"/>`);
    const objects = shows.objects.filter((o) => o.kind !== 'label').map((o) => compileObject(o, getter));
    const frames = new Map(objects.map((O) => [O.id, evalObject(O, scope)]));
    const lock = shows.camera.lock ? frames.get(shows.camera.lock) : null;
    const target = lock ? lock.position : [0, 0, 0];
    const view = lookAt(eyeFor(initialPose(shows.camera), target), target);
    const at = (p) => project(p, view, vb);
    const center = at(target), centerDepth = center ? center.depth : Infinity;
    const prims = [];
    const prim = (depth, draw) => prims.push({ depth, draw });
    const colorOf = (O) => O.spec.color || 'fg';
    for (const O of objects) {
      const f = frames.get(O.id);
      if (!f.visible) continue;
      const T = { position: f.position, rotation: f.rotation, scale: f.scale };
      switch (O.kind) {
        case 'globe': case 'sphere': {
          const c = at(f.position);
          if (!c) break;
          const r = f.radius * f.scale * pxPerWorld(c.depth, vb.height);
          const textured = O.kind === 'globe' || O.spec.texture;
          prim(c.depth, () => this.path(this.circlePath(c.x, c.y, r), { fill: colorOf(O), fillOpacity: textured && !O.spec.color ? '.25' : f.opacity < 1 ? String(f.opacity) : undefined }));
          if (textured && !O.spec.color) prim(c.depth, () => this.path(this.circlePath(c.x, c.y, r), { stroke: 'fg', width: 1, strokeOpacity: '.4' }));
          break;
        }
        case 'ring': {
          const pts = circlePoints(96).map((p) => at(toWorld(p, { ...T, scale: f.radius * f.scale }))).filter(Boolean);
          if (pts.length < 2) break;
          // each segment of the closed ring goes to the run of its side (behind or in front of the view
          // center); consecutive segments share their endpoints, so adjacent runs meet without a gap
          const cnt = pts.length, side = (i) => (pts[i].depth + pts[(i + 1) % cnt].depth) / 2 < centerDepth;
          let start = 0;
          for (let i = 0; i < cnt; i++) if (side(i) !== side((i + cnt - 1) % cnt)) { start = i; break; }
          const runs = [];
          for (let k = 0; k < cnt; k++) {
            const i = (start + k) % cnt, front = side(i), last = runs[runs.length - 1];
            if (!last || last.front !== front) runs.push({ front, pts: [pts[i], pts[(i + 1) % cnt]] });
            else last.pts.push(pts[(i + 1) % cnt]);
          }
          for (const run of runs) {
            const depth = run.front ? Math.min(...run.pts.map((p) => p.depth)) : Math.max(...run.pts.map((p) => p.depth));
            const d = run.pts.map((p, i) => `${i ? 'L' : 'M'}${n(p.x)} ${n(p.y)}`).join('');
            prim(depth, () => this.path(d, { stroke: colorOf(O), width: O.spec.width || RING_WIDTH_PX, strokeOpacity: f.opacity < 1 ? String(f.opacity) : undefined }));
          }
          break;
        }
        case 'disc': {
          const pts = circlePoints(96).map((p) => at(toWorld(p, { ...T, scale: f.radius * f.scale }))).filter(Boolean);
          if (pts.length < 3) break;
          const d = pts.map((p, i) => `${i ? 'L' : 'M'}${n(p.x)} ${n(p.y)}`).join('') + 'Z';
          const c = at(f.position);
          prim(f.opacity < 1 ? Infinity : c ? c.depth : Infinity, () => this.path(d, { fill: colorOf(O), fillOpacity: f.opacity < 1 ? String(f.opacity) : undefined }));
          break;
        }
        case 'arrow': {
          const a = at(f.from), b = at(f.to);
          if (!a || !b) break;
          const len = Math.min(Math.max(f.head * pxPerWorld(b.depth, vb.height), 6), 24);
          const ang = Math.atan2(b.y - a.y, b.x - a.x);
          const bx = b.x - Math.cos(ang) * len * 0.85, by = b.y - Math.sin(ang) * len * 0.85;
          prim((a.depth + b.depth) / 2, () => {
            this.path(`M${n(a.x)} ${n(a.y)}L${n(bx)} ${n(by)}`, { stroke: colorOf(O), width: 2 });
            this.heads([{ at: [b.x, b.y], angle: ang, len }], colorOf(O));
          });
          break;
        }
        default: break; // body / part: the mesh is an asset the poster cannot read
      }
    }
    // surface drag handles on their sphere, when on the near side
    for (const c of controls) {
      if (c.kind !== 'drag' || !c.constrain.startsWith('surface:')) continue;
      const O = objects.find((o) => o.id === c.constrain.slice(8)), f = O && frames.get(O.id);
      if (!f || !f.visible || f.radius === undefined) continue;
      const w = toWorld(latLonToPoint(scope.get(`${c.name}.lat`), scope.get(`${c.name}.lon`), 1), { position: f.position, rotation: f.rotation, scale: f.radius * f.scale });
      const p = at(w), cc = at(f.position);
      if (p && cc && p.depth <= cc.depth) prim(p.depth - 1e-6, () => this.circle(p.x, p.y, 7, { fill: c.token, stroke: 'bg', width: 2 }));
    }
    prims.sort((a, b) => b.depth - a.depth);
    const open = this.parts.length;
    this.parts.push('');
    for (const pr of prims) pr.draw();
    // labels: under a sphere, at an arrow's tip, at the object or the given position
    for (const L of labelSpecs(shows.objects, getter)) {
      if (L.visible && L.visible(scope) === 0) continue;
      let p = null, dflt = [0, 14], color = L.color || 'fg';
      if (L.anchor) {
        const O = objects.find((o) => o.id === L.anchor), f = O && frames.get(O.id);
        if (!f || !f.visible) continue;
        color = L.color || colorOf(O);
        if (O.kind === 'arrow') p = at(f.to);
        else { p = at(f.position); if (p && f.radius !== undefined) dflt = [0, f.radius * f.scale * pxPerWorld(p.depth, vb.height) + 14]; }
      } else if (L.position) p = at(labelPosition(L, scope));
      if (!p) continue;
      const [dx, dy] = L.offset || dflt;
      this.text(renderTemplate(compileTemplate(L.text), scope, {}), p.x + dx, p.y + dy, { align: 'center', color, middle: true });
    }
    // readouts: `at` is a fraction of the view box in a scene3d, y up
    const m = worldToPx({ x: [0, 1], y: [0, 1] }, vb);
    const env = { m, view: { x: [0, 1], y: [0, 1] }, box: vb, obstacles: [], placed: [] };
    for (const R of (shows.readouts || []).map(compileReadout)) this.readout(R, scope, env, new Map());
    this.parts[open] = `<g clip-path="url(#${this.clip(this.rectPath(vb))})">`;
    this.parts.push('</g>');
    splits.forEach((s, i) => this.panel(s.panel, boxes.panels[i], scope, boxes.panels[i].inset));
  }

  circlePath(cx, cy, r) { const p = mk(); p.arc(cx, cy, Math.max(r, 0), 0, TAU); return p.d; }

  svg(W, H, hash) {
    const attrs = [`class="x-poster"`, `id="${this.id}"`, 'xmlns="http://www.w3.org/2000/svg"', `viewBox="0 0 ${W} ${H}"`, `width="${W}"`, `height="${H}"`, 'aria-hidden="true"'];
    if (hash) attrs.push(`data-poster="${hash}"`);
    const defs = this.defs.length ? `<defs>${this.defs.join('')}</defs>` : '';
    return `<svg ${attrs.join(' ')}>${this.style()}${defs}<g fill="none" stroke-linecap="round" stroke-linejoin="round">${this.parts.join('')}</g></svg>`;
  }
}

export function posterSize(aspect) {
  const m = /^(\d+):(\d+)$/.exec(aspect || '');
  const [aw, ah] = m ? [Number(m[1]), Number(m[2])] : [3, 2];
  return { width: POSTER_WIDTH, height: Math.round((POSTER_WIDTH * ah) / aw) };
}

/**
 * posterSvg(spec | compiled, scopeOrState, { aspect, tokens, id, caption, hash }) -> SVG markup.
 * scopeOrState: a scope Map, a state name, or null for the defaults.
 * tokens: Map/object of palette token name -> CSS value (the article's
 * light-dark() pairs), plus optional '--bg', '--fg', '--x-panel'; they become
 * the var() fallbacks so an external poster is colored too. id is the figure
 * id (the SVG's own id is <id>-poster, which scopes its <style>); caption is
 * accepted for compatibility and no longer drawn (a scene3d poster is the
 * projected first frame); hash lands in data-poster.
 */
export function posterSvg(specOrCompiled, scopeOrState = null, { aspect = '3:2', tokens = null, id = 'fig', caption = '', hash = '' } = {}) {
  const compiled = specOrCompiled && specOrCompiled.defaults instanceof Map ? specOrCompiled : validateSpec(specOrCompiled, { figureId: id });
  const scope = scopeOrState instanceof Map ? new Map(scopeOrState) : scopeForState(compiled, scopeOrState);
  const { width: W, height: H } = posterSize(aspect);
  const out = new Emitter(id, tokens);
  if (compiled.type === 'scene3d') out.scene3d(compiled, scope, W, H);
  else out.scene(compiled, scope, W, H);
  return out.svg(W, H, hash);
}
