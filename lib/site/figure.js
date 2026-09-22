// lib/site/figure.js — the Figure object: DOM scaffold, controls, scene,
// the scope every expression reads, transitions between named states, play.
// Every value change goes through set(), so knob, readouts and canvas agree.
import { h, emit } from './dom.js';
import { fitCanvas } from '../core/layout.js';
import { attachDrag, constrainPoint } from '../core/drag.js';
import { transition } from '../core/ease.js';
import { controlOf, coerce, isDiscrete, stateTargets, activeState, visibleIds } from '../core/state.js';
import { formatHash } from '../core/deeplink.js';
import { createScene2d } from '../scene2d/scene2d.js';
import { mountSlider } from '../controls/slider.js';
import { mountTime } from '../controls/time.js';
import { mountDragPoint } from '../controls/drag.js';
import { mountToggle } from '../controls/toggle.js';
import { mountSegmented } from '../controls/segmented.js';
import { mountPlay } from '../controls/play.js';
import { mountStepper } from '../controls/stepper.js';
import { mountScene3dPlaceholder } from './scene3d.js';

const MIRROR_DELAY_MS = 300;
const CORNER_PAD_PX = 8; // gap between the corner buttons and anything drawn

export function createFigure(el, compiled, env) {
  const spec = compiled.spec;
  const controls = spec.manipulates.controls;
  const scope = new Map(compiled.defaults);
  const fig = { id: el.id, el, compiled, scope, fmt: env.fmt, playing: false, activeState: null, visible: false, mounted: false, visibleIds: new Set() };

  // ---- scaffold: reserved box, corners, readout mirror; controls follow
  const figcaption = el.querySelector(':scope > figcaption');
  const insert = (node) => (figcaption ? el.insertBefore(node, figcaption) : el.append(node));
  const box = h('div', { class: 'x-canvas-box' });
  const [aw, ah] = (el.dataset.aspect || '3:2').split(':').map(Number);
  box.style.aspectRatio = `${aw} / ${ah}`;
  const canvas = h('canvas');
  const cornerRight = h('div', { class: 'x-corner x-corner-right' });
  const readoutsEl = h('div', { class: 'x-readouts', 'aria-live': 'polite' });
  box.append(canvas, cornerRight, readoutsEl);
  // The build's first frame (<svg|img class="x-poster">) moves over the canvas
  // and stays until the first draw (the stylesheet hides it at data-mounted).
  const poster = el.querySelector(':scope > .x-poster');
  if (poster) canvas.after(poster);
  insert(box);
  el.dataset.booted = '';

  const mounted = [];
  const counts = { sl: 0, tg: 0, seg: 0 }; // slider and time share the _sl<i> ids
  const drags = [];
  for (const c of controls) {
    let m = null;
    switch (c.kind) {
      case 'slider': m = mountSlider(fig, c, counts.sl++); break;
      case 'time': m = mountTime(fig, c, counts.sl++); break;
      case 'drag': m = mountDragPoint(fig, c); drags.push({ name: c.name, control: c }); break;
      case 'toggle': m = mountToggle(fig, c, counts.tg++); break;
      case 'segmented': m = mountSegmented(fig, c, counts.seg++); break;
      default: break;
    }
    if (!m) continue;
    mounted.push(m);
    if (m.corner) cornerRight.append(m.el); else insert(m.el);
  }
  const playSpec = controls.find((c) => c.kind === 'play') || null;
  const speedTimes = controls.filter((c) => c.kind === 'time' && c.mode === 'speed');
  const playUi = playSpec || speedTimes.length ? mountPlay(fig) : null;
  if (playUi) box.append(playUi.el);
  const stepper = spec.notice.steps !== 'none' && spec.notice.states.length ? mountStepper(fig, spec.notice) : null;
  if (stepper) insert(stepper.el);

  // ---- scene
  let scene = null;
  if (compiled.type === 'scene3d') mountScene3dPlaceholder(box, spec.shows, figcaption ? figcaption.textContent : '');
  else {
    scene = createScene2d(canvas, spec.shows, { tokens: env.tokens, dpr: env.dpr, font: env.font, fmt: env.fmt, drags, baseUrl: document.baseURI, requestDraw: () => requestDraw() });
  }
  fig.view = scene ? scene.view : null;

  // ---- state
  let running = null;       // the active transition
  let unsubscribe = null;   // clock subscription
  let dirty = false, drawQueued = false, mirrorTimer = null;
  const fades = new Map();  // layer id -> { from, to } during a goto
  let stateVisible = null;  // the last goto's visible.show/hide; like the layer overrides, it outlives the state

  function syncControls() {
    for (const m of mounted) m.sync(scope);
    if (playUi) playUi.sync();
    if (stepper) stepper.sync(fig.activeState);
    syncVisibleIds();
  }

  // Prose refs inherit the visibility of what they point at, so the page
  // learns which ids are drawn whenever that set changes (not on every tick).
  function syncVisibleIds() {
    const next = visibleIds(compiled, scope, stateVisible);
    const prev = fig.visibleIds;
    if (prev.size === next.size && [...next].every((id) => prev.has(id))) return;
    fig.visibleIds = next;
    emit(el, 'x-fig:visibility', { id: fig.id, visible: next });
  }

  function requestDraw() {
    dirty = true;
    if (unsubscribe || drawQueued || !fig.visible) return;
    drawQueued = true;
    requestAnimationFrame(() => { drawQueued = false; if (dirty) fig.draw(); });
  }

  function assign(key, value, source) {
    const dot = key.indexOf('.');
    const c = controlOf(compiled, dot > 0 ? key.slice(0, dot) : key);
    let v = value;
    if (c && c.kind === 'drag' && dot < 0) {
      const start = [scope.get(`${key}.x`), scope.get(`${key}.y`)];
      const [x, y] = constrainPoint(c.constrain, value, { view: fig.view || { x: [-1, 1], y: [-1, 1] }, start });
      scope.set(`${key}.x`, x);
      scope.set(`${key}.y`, y);
      v = [x, y];
    } else {
      if (c && dot < 0) v = coerce(c, value);
      scope.set(key, v);
    }
    if (scene && key.endsWith('.dragging')) {
      const owner = key.slice(0, -9); // preview layers show only while their handle is dragged
      for (const L of scene.layers.values()) if (L.previewOf === owner) L.forceHide = v !== 1;
    }
    emit(el, 'x-fig:set', { id: fig.id, name: key, value: v, source });
    return v;
  }

  fig.set = (name, value, source = 'user') => {
    if (source === 'user') {
      if (running) { running.cancel(); running = null; }
      fig.activeState = null;
      if (fig.playing && playSpec && name === playSpec.target) fig.pause();
    }
    const v = assign(name, value, source);
    syncControls();
    requestDraw();
    return v;
  };
  fig.get = (name) => scope.get(name);

  // ---- goto: ease numbers, snap discrete values, fade show/hide layers
  fig.goto = (stateName, { ease = true } = {}) => {
    const { targets, visible } = stateTargets(compiled, stateName);
    fig.pause();
    if (running) running.cancel();
    const from = {}, discrete = new Set();
    for (const k of Object.keys(targets)) {
      from[k] = scope.get(k);
      const c = controlOf(compiled, k);
      if (c && isDiscrete(c)) discrete.add(k);
    }
    fades.clear();
    stateVisible = visible;
    const hide = new Set((visible && visible.hide) || []), show = new Set((visible && visible.show) || []);
    if (scene) {
      for (const L of scene.layers.values()) {
        const to = hide.has(L.id) ? 0 : 1;
        if (show.has(L.id)) { L.override = 1; if (L.alpha === 1 && L.wasHidden) L.alpha = 0; }
        if (L.alpha !== to) fades.set(L.id, { from: L.alpha, to });
      }
    }
    fig.activeState = stateName;
    running = transition({
      from, to: targets, discrete,
      reduced: env.reduced || !ease || env.pausedAll(),
      onStep(out, k) {
        for (const [key, v] of Object.entries(out)) assign(key, v, 'state');
        for (const [id, f] of fades) scene.layers.get(id).alpha = f.from + (f.to - f.from) * k;
        syncControls();
        dirty = true;
      },
      onDone() {
        running = null;
        for (const [id, f] of fades) scene.layers.get(id).alpha = f.to;
        if (scene) for (const L of scene.layers.values()) L.override = hide.has(L.id) ? 0 : show.has(L.id) ? 1 : null;
        if (history.replaceState) history.replaceState(null, '', formatHash(fig.id, stateName));
        emit(el, 'x-fig:state', { id: fig.id, state: stateName });
        updateTicking();
      },
    });
    syncControls();
    if (running.done || !ease || env.reduced) running.step(0);
    if (running && !running.done) updateTicking();
    if (!unsubscribe) requestDraw();
  };

  // ---- play
  const target = playSpec ? controlOf(compiled, playSpec.target) : null;
  const targetRange = () => {
    if (!target) return null;
    if (target.kind === 'time') return [0, Number.MAX_SAFE_INTEGER];
    return 'values' in target ? [target.values[0], target.values.at(-1)] : [target.min, target.max];
  };
  fig.play = () => {
    if (!playUi || fig.playing) return;
    const range = targetRange();
    if (range && scope.get(target.name) >= range[1] && !playSpec.loop) assign(target.name, range[0], 'play');
    fig.playing = true;
    emit(el, 'x-fig:play', { id: fig.id, playing: true });
    syncControls();
    updateTicking();
  };
  fig.pause = () => {
    if (!fig.playing) return;
    fig.playing = false;
    emit(el, 'x-fig:play', { id: fig.id, playing: false });
    syncControls();
    updateTicking();
  };
  fig.restart = () => {
    if (!playUi) return;
    if (running) { running.cancel(); running = null; }
    fig.activeState = null;
    if (target) assign(target.name, targetRange()[0], 'play');
    for (const c of speedTimes) assign(c.name, 0, 'play');
    fig.playing = false;
    fig.play();
    requestDraw();
  };

  function advance(dt) {
    if (target) {
      const [lo, hi] = targetRange();
      let v = scope.get(target.name) + playSpec.rate * dt;
      if (v > hi) { if (playSpec.loop) v = lo + ((v - lo) % (hi - lo)); else { v = hi; fig.playing = false; emit(el, 'x-fig:play', { id: fig.id, playing: false }); } }
      assign(target.name, v, 'play');
    }
    for (const c of speedTimes) assign(c.name, scope.get(c.name) + scope.get(`${c.name}.rate`) * dt * 1000, 'play');
    fig.activeState = null;
    syncControls();
    dirty = true;
  }

  fig.tick = (dt) => {
    if (running) running.step(dt);
    if (fig.playing && !env.pausedAll()) advance(dt);
    if (dirty && fig.visible) fig.draw();
    updateTicking();
  };

  // subscribe to the shared clock only while something moves
  function updateTicking() {
    const need = running || (fig.playing && fig.visible);
    if (need && !unsubscribe) unsubscribe = env.clock.onTick(fig.tick);
    else if (!need && unsubscribe) { unsubscribe(); unsubscribe = null; }
  }

  // ---- drawing
  let boxPx = null;
  // The occupied corner-button groups, measured, as canvas-px boxes padded by
  // CORNER_PAD_PX and extended to the bottom edge. The scene fits the drawing
  // above them and steers labels and readouts around them. The groups are
  // observed for resize because Play <-> Pause changes a group's width.
  function cornerRects() {
    const r0 = box.getBoundingClientRect(), out = [];
    for (const g of box.querySelectorAll(':scope > .x-corner')) {
      const r = g.getBoundingClientRect();
      if (!g.childElementCount || !r.height) continue;
      out.push({ x: r.left - r0.left - CORNER_PAD_PX, y: r.top - r0.top - CORNER_PAD_PX, w: r.width + 2 * CORNER_PAD_PX, h: r0.bottom - r.top + CORNER_PAD_PX });
    }
    return out;
  }
  function layout() {
    boxPx = fitCanvas(canvas, box, env.dpr);
    if (scene) scene.layout(boxPx, cornerRects());
  }
  fig.draw = () => {
    dirty = false;
    if (!scene || !fig.visible) return;
    if (!boxPx) layout();
    scene.draw(scope);
    clearTimeout(mirrorTimer);
    mirrorTimer = setTimeout(() => { readoutsEl.textContent = scene.readoutText(); }, MIRROR_DELAY_MS);
  };
  fig.retheme = () => { requestDraw(); };

  fig.setVisible = (flag) => {
    if (flag === fig.visible) return;
    fig.visible = flag;
    if (flag) {
      layout();
      if (!fig.mounted) {
        fig.mounted = true;
        el.dataset.mounted = '';
        emit(el, 'x-fig:mount', { id: fig.id });
        if (playSpec && playSpec.autoplay && !env.reduced) fig.play();
      }
      fig.draw();
    } else {
      canvas.width = canvas.height = 0; // release the backing store off screen
      boxPx = null;
    }
    updateTicking();
  };

  let ro = null;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => { if (fig.visible) { layout(); fig.draw(); } });
    ro.observe(box);
    for (const g of box.querySelectorAll(':scope > .x-corner')) ro.observe(g);
  }

  // ---- pointer drag on the canvas
  let detachDrag = null;
  if (drags.length && scene) {
    canvas.style.touchAction = 'none';
    detachDrag = attachDrag(canvas, {
      hit: (p) => scene.hitDrag(p, env.coarse),
      onStart(name) { fig.set(`${name}.dragging`, 1, 'user'); canvas.classList.add('x-dragging'); },
      onMove(name, p) { fig.set(name, scene.toWorld(p), 'user'); },
      onEnd(name) { fig.set(`${name}.dragging`, 0, 'user'); canvas.classList.remove('x-dragging'); },
      onHover(over) { canvas.classList.toggle('x-can-drag', over); },
    });
    for (const d of drags) for (const id of d.control.preview || []) { const L = scene.layers.get(id); if (L) L.previewOf = d.name; }
  }
  if (scene) for (const L of scene.layers.values()) if (L.previewOf) L.forceHide = true;

  // ---- prose hooks
  fig.refInfo = (refId) => {
    const L = scene && scene.layers.get(refId);
    if (L) return { token: L.spec.stroke || L.spec.fill || null, dashed: !!L.spec.dash };
    const c = controlOf(compiled, refId);
    if (c) return { token: c.token || null, dashed: false };
    const R = scene && scene.readouts.find((r) => r.id === refId);
    if (R) return { token: R.spec.token, dashed: false };
    return { token: null, dashed: false };
  };
  fig.highlight = (refId, on) => {
    const L = scene && scene.layers.get(refId);
    if (L) { L.highlight = on; requestDraw(); return; }
    const R = scene && scene.readouts.find((r) => r.id === refId);
    if (R) { R.highlight = on; requestDraw(); return; }
    const m = mounted.find((x) => x.name === refId);
    if (m) m.el.classList.toggle('x-hl', on);
  };

  fig.dispose = () => {
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
    if (ro) ro.disconnect();
    if (detachDrag) detachDrag();
    clearTimeout(mirrorTimer);
    if (poster) el.prepend(poster);
    for (const node of el.querySelectorAll(':scope > .x-canvas-box, :scope > .x-ctl, :scope > .x-stepper, :scope > .x-drag-proxy')) node.remove();
    delete el.dataset.mounted;
    delete el.dataset.booted;
  };

  fig.activeState = activeState(compiled, scope);
  syncControls();
  return fig;
}
