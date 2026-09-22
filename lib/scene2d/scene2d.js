// lib/scene2d/scene2d.js — one canvas, one main panel plus split panels,
// all drawn from the same scope. Owns the layer/readout registries the
// Figure uses for highlights and fades.
import { worldToPx, splitBoxes } from '../core/layout.js';
import { withAlpha } from '../core/tokens.js';
import { compileLayer, drawLayer, geometryOf, isShown } from './layers.js';
import { compileReadout, drawReadout } from './label.js';
import { compilePlot, drawPlot, compileTimeline, drawTimeline } from './plot.js';
import { getter } from './getters.js';
import { applyModel } from './models/index.js';

function compilePanel(shows) {
  const readouts = (shows.readouts || []).map(compileReadout);
  if (shows.type === 'plot') return { kind: 'plot', P: compilePlot(shows), readouts, layers: [] };
  if (shows.type === 'timeline') return { kind: 'timeline', T: compileTimeline(shows), readouts, layers: [] };
  const layers = shows.layers.map(compileLayer);
  return { kind: 'scene2d', view: shows.view, layers, byId: new Map(layers.map((L) => [L.id, L])), readouts };
}

// env: { tokens: Map, dpr, font, fmt, drags: [{ name, control }], baseUrl, requestDraw }
export function createScene2d(canvas, shows, env) {
  const main = compilePanel(shows);
  const splits = (shows.split || []).map((p) => ({ at: p.at, panel: compilePanel(p.shows) }));
  const layers = new Map(), readouts = [];
  for (const p of [main, ...splits.map((s) => s.panel)]) {
    for (const L of p.layers) layers.set(L.id, L);
    readouts.push(...p.readouts);
  }
  const model = shows.model ? { spec: shows.model, params: mapValues(shows.model.params, getter) } : null;
  loadImages(layers, env);

  let box = { x: 0, y: 0, width: canvas.clientWidth || 300, height: canvas.clientHeight || 200 };
  let obstacles = []; // the corner-button groups, as padded canvas-px boxes
  let boxes = splitBoxes(box, splits);
  // the drawing keeps clear of the bottom strip the corner buttons occupy
  const drawBox = (b) => {
    const strip = Math.max(0, ...obstacles.map((o) => b.y + b.height - o.y));
    return strip ? { ...b, height: Math.max(b.height - strip, b.height * 0.6) } : b;
  };
  let mainMap = null, lastScope = null;

  function colors() {
    const bg = env.tokens.get('--bg'), fg = env.tokens.get('--fg');
    return { bg, fg, grid: withAlpha(fg, 0.1), axis: withAlpha(fg, 0.45), muted: withAlpha(fg, 0.65) };
  }

  function paintScene(ctx, panel, pbox, scope, penv) {
    const m = worldToPx(panel.view, pbox);
    Object.assign(penv, { m, view: panel.view, placed: [] });
    const anchors = new Map();
    const pathOf = (id) => geometryOf(panel.byId.get(id), scope, m).path;
    for (const L of panel.layers) {
      if (isShown(L, scope)) anchors.set(L.id, drawLayer(ctx, L, scope, penv, pathOf).anchor);
      else if (L.kind !== 'region') anchors.set(L.id, geometryOf(L, scope, m).anchor);
    }
    for (const R of panel.readouts) drawReadout(ctx, R, scope, penv, anchors);
    return m;
  }

  function paintPanel(ctx, panel, pbox, scope, inset) {
    const penv = { ...env, ...colors(), box: pbox, obstacles };
    ctx.save();
    ctx.beginPath();
    ctx.rect(pbox.x, pbox.y, pbox.width, pbox.height);
    ctx.clip();
    if (inset) {
      ctx.fillStyle = penv.bg;
      ctx.fillRect(pbox.x, pbox.y, pbox.width, pbox.height);
      ctx.strokeStyle = penv.grid;
      ctx.lineWidth = 1;
      ctx.strokeRect(pbox.x + 0.5, pbox.y + 0.5, pbox.width - 1, pbox.height - 1);
    }
    let m = null;
    if (panel.kind === 'scene2d') m = paintScene(ctx, panel, pbox, scope, penv);
    else if (panel.kind === 'plot') drawPlot(ctx, pbox, panel.P, scope, penv);
    else drawTimeline(ctx, pbox, panel.T, scope, penv);
    ctx.restore();
    return m;
  }

  function drawDrags(ctx, m, scope) {
    for (const d of env.drags) {
      const x = m.x(scope.get(`${d.name}.x`)), y = m.y(scope.get(`${d.name}.y`));
      const dragging = scope.get(`${d.name}.dragging`) === 1;
      const color = env.tokens.get(d.control.token);
      ctx.save();
      if (dragging) { ctx.globalAlpha = 0.25; ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, 18, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; }
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(x, y, dragging ? 9 : 7, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = env.tokens.get('--bg'); ctx.stroke();
      ctx.restore();
    }
  }

  return {
    layers, readouts,
    get view() { return main.view || null; },
    layout(newBox, corners = []) { box = newBox; obstacles = corners; boxes = splitBoxes(drawBox(box), splits); },
    draw(scope) {
      lastScope = scope;
      if (model) applyModel(model.spec, model.params, scope);
      const ctx = canvas.getContext('2d');
      ctx.setTransform(env.dpr, 0, 0, env.dpr, 0, 0);
      ctx.clearRect(0, 0, box.width, box.height);
      mainMap = paintPanel(ctx, main, boxes.main, scope, false);
      splits.forEach((s, i) => paintPanel(ctx, s.panel, boxes.panels[i], scope, boxes.panels[i].inset));
      if (mainMap && env.drags.length) drawDrags(ctx, mainMap, scope);
    },
    hitDrag(p, coarse) {
      if (!mainMap || !lastScope) return null;
      for (const d of env.drags) {
        const x = mainMap.x(lastScope.get(`${d.name}.x`)), y = mainMap.y(lastScope.get(`${d.name}.y`));
        if (Math.hypot(p.x - x, p.y - y) <= (d.control.hit ?? (coarse ? 30 : 22))) return d.name;
      }
      return null;
    },
    toWorld(p) { return mainMap ? [mainMap.wx(p.x), mainMap.wy(p.y)] : [0, 0]; },
    readoutText() { return readouts.map((R) => R.last).filter(Boolean).join(' · '); },
  };
}

function mapValues(obj, fn) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = fn(v);
  return out;
}

// image layers: the @2x variant on DPR 2, falling back to the 1x file.
function loadImages(layers, env) {
  if (typeof Image === 'undefined') return;
  for (const L of layers.values()) {
    if (L.kind !== 'image') continue;
    const src = L.spec.src;
    const at2x = env.dpr === 2 ? src.replace(/(\.[a-z0-9]+)$/i, '@2x$1') : src;
    const img = new Image();
    img.onload = () => env.requestDraw();
    img.onerror = () => { if (img.src.endsWith(at2x) && at2x !== src) img.src = new URL(src, env.baseUrl).href; };
    img.src = new URL(at2x, env.baseUrl).href;
    L.image = img;
  }
}
