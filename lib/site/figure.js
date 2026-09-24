// lib/site/figure.js — the Figure object: DOM scaffold, controls, scene,
// the scope every expression reads, transitions between named states, play.
// Every value change goes through set(), so knob, readouts and canvas agree.
import { h, emit } from './dom.js';
import { fitCanvas, splitBoxes, worldToPx } from '../core/layout.js';
import { attachDrag, constrainPoint } from '../core/drag.js';
import { transition } from '../core/ease.js';
import { controlOf, coerce, isDiscrete, stateTargets, activeState, visibleIds } from '../core/state.js';
import { formatHash } from '../core/deeplink.js';
import { compileTemplate, renderTemplate } from '../core/format.js';
import { clampLatLon } from '../scene3d/surface.js';
import { createScene2d } from '../scene2d/scene2d.js';
import { getter } from '../scene2d/getters.js';
import { compileReadout, drawReadout } from '../scene2d/label.js';
import { applyModel } from '../scene2d/models/index.js';
import { mountSlider } from '../controls/slider.js';
import { mountTime } from '../controls/time.js';
import { mountDragPoint, mountGeolocate } from '../controls/drag.js';
import { mountToggle } from '../controls/toggle.js';
import { mountSegmented } from '../controls/segmented.js';
import { mountPlay } from '../controls/play.js';
import { mountStepper } from '../controls/stepper.js';
import { loadScene3d, hasWebGL2, mountScene3dFallback } from './scene3d.js';

const MIRROR_DELAY_MS = 300;
const CORNER_PAD_PX = 8; // gap between the corner buttons and anything drawn
const isSurface = (c) => c.kind === 'drag' && c.constrain.startsWith('surface:');

export function createFigure(el, compiled, env) {
  const spec = compiled.spec;
  const controls = spec.manipulates.controls;
  const scope = new Map(compiled.defaults);
  const fig = { id: el.id, el, compiled, scope, fmt: env.fmt, playing: false, activeState: null, visible: false, mounted: false, visibleIds: new Set() };
  const is3d = compiled.type === 'scene3d';

  // ---- scaffold: reserved box, corners, readout mirror; controls follow
  const figcaption = el.querySelector(':scope > figcaption');
  // The PANEL: everything under the canvas (controls, stepper, captions) is one
  // region that tints on hover; a click on its background or a caption steps in.
  // The figcaption moves into the panel so one element carries the tint and
  // the glow; aria-labelledby keeps it as the figure's name.
  const panel = h('div', { class: 'x-panel' });
  el.append(panel);
  if (figcaption) { figcaption.id ||= `${el.id}_cap`; el.setAttribute('aria-labelledby', figcaption.id); panel.append(figcaption); }
  const insert = (node) => (figcaption ? panel.insertBefore(node, figcaption) : panel.append(node));
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
  el.insertBefore(box, panel);
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
    if (c.kind === 'drag' && c.geolocate && isSurface(c)) {
      const geo = mountGeolocate(fig, c);
      if (geo) { mounted.push(geo); cornerRight.append(geo.el); }
    }
  }
  const playSpec = controls.find((c) => c.kind === 'play') || null;
  const speedTimes = controls.filter((c) => c.kind === 'time' && c.mode === 'speed');
  const playUi = playSpec || speedTimes.length ? mountPlay(fig) : null;
  if (playUi) box.append(playUi.el);
  const stepper = spec.notice.steps !== 'none' && spec.notice.states.length ? mountStepper(fig, spec.notice) : null;
  if (stepper) {
    insert(stepper.el);
    panel.addEventListener('click', (e) => { if (!e.target.closest('button, input, label, a, .x-ctl, .x-stepper-row')) stepper.enter(); });
    panel.addEventListener('keydown', (e) => { if (e.target.closest('.x-ctl-slider:not(.x-discrete)')) stepper.key(e); });
  }

  // ---- scene: 2D at once; 3D when the lazy chunk arrives on first approach
  let scene = null;
  let detachDrag = null;
  let pendingCamera = null;   // a state's camera pose asked for before the chunk was ready
  let sceneRequested = false;
  function attachScene(s) {
    scene = s;
    fig.view = scene.view || null;
    if (drags.length) {
      canvas.style.touchAction = 'none';
      detachDrag = attachDrag(canvas, {
        hit: (p) => scene.hitDrag(p, env.coarse),
        onStart(name) { fig.set(`${name}.dragging`, 1, 'user'); canvas.classList.add('x-dragging'); },
        onMove(name, p) { const v = scene.dragValue ? scene.dragValue(name, p) : scene.toWorld(p); if (v) fig.set(name, v, 'user'); },
        onEnd(name) { fig.set(`${name}.dragging`, 0, 'user'); canvas.classList.remove('x-dragging'); },
        onHover(over) { canvas.classList.toggle('x-can-drag', over); },
      });
      for (const d of drags) for (const id of d.control.preview || []) { const L = scene.layers.get(id); if (L) L.previewOf = d.name; }
    }
    for (const L of scene.layers.values()) if (L.previewOf) L.forceHide = true;
    if (pendingCamera && scene.setCamera) { scene.setCamera(pendingCamera); pendingCamera = null; }
  }
  if (!is3d) {
    attachScene(createScene2d(canvas, spec.shows, { tokens: env.tokens, dpr: env.dpr, font: env.font, fmt: env.fmt, drags, baseUrl: document.baseURI, requestDraw: () => requestDraw() }));
  }
  fig.view = scene ? scene.view : null;

  // The 3D chunk is imported once per page on the first approach of any
  // scene3d figure; without WebGL2 (or when the import fails) the poster
  // stays and the spec's notice joins it.
  function requestScene3d() {
    if (sceneRequested) return;
    sceneRequested = true;
    const fallback = (reason) => { mountScene3dFallback(box, spec.shows, { hasPoster: !!poster, reason }); el.dataset.fallback = ''; };
    if (!hasWebGL2(window)) { fallback('no WebGL2'); return; }
    loadScene3d().then((mod) => {
      if (disposed) return;
      const s = mod.mountScene3d(canvas, compiled, {
        tokens: env.tokens, dpr: env.dpr, font: env.font, fmt: env.fmt, drags, reduced: env.reduced, coarse: env.coarse,
        baseUrl: document.baseURI, box, requestDraw: () => requestDraw(),
        lib: { createScene2d, splitBoxes, worldToPx, fitCanvas, getter, compileTemplate, renderTemplate, compileReadout, drawReadout, applyModel },
      });
      attachScene(s);
      if (fig.visible) { layout(); fig.draw(); markMounted(); }
    }).catch((e) => { if (!disposed) fallback(e && e.message ? e.message : String(e)); });
  }

  // ---- state
  let running = null;       // the active transition
  let unsubscribe = null;   // clock subscription
  let dirty = false, drawQueued = false, mirrorTimer = null, disposed = false;
  const fades = new Map();  // layer id -> { from, to } during a goto
  let stateVisible = null;  // the last goto's visible.show/hide; like the layer overrides, it outlives the state

  function syncControls() {
    for (const m of mounted) m.sync(scope);
    if (playUi) playUi.sync();
    if (stepper) { stepper.sync(fig.activeState); el.dataset.face = fig.activeState === null ? 'free' : 'stepped'; }
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
      if (isSurface(c)) {
        const [lat, lon] = clampLatLon(value);
        scope.set(`${key}.lat`, lat);
        scope.set(`${key}.lon`, lon);
        v = [lat, lon];
      } else {
        const start = [scope.get(`${key}.x`), scope.get(`${key}.y`)];
        const [x, y] = constrainPoint(c.constrain, value, { view: fig.view || { x: [-1, 1], y: [-1, 1] }, start });
        scope.set(`${key}.x`, x);
        scope.set(`${key}.y`, y);
        v = [x, y];
      }
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

  // A reader's change to a GOVERNED control (one the current step sets) steps
  // off; a control the step never names (a toggle) leaves the step in place.
  let governed = null;
  fig.set = (name, value, source = 'user') => {
    if (source === 'user') {
      if (!governed || governed.has(name.split('.')[0])) {
        if (running) { running.cancel(); running = null; }
        fig.activeState = null; governed = null;
      }
      if (fig.playing && playSpec && name === playSpec.target) fig.pause();
    }
    const v = assign(name, value, source);
    // a discrete slider (a values list, or 40 or fewer steps) that lands exactly on a step steps in: its stops are steps
    const c = source === 'user' ? controlOf(compiled, name) : null;
    if (c && c.kind === 'slider' && ('values' in c || (c.max - c.min) / c.step <= 40)) {
      const a = activeState(compiled, scope);
      if (a) { fig.activeState = a; governed = new Set(Object.keys(stateTargets(compiled, a).targets).map((k) => k.split('.')[0])); }
    }
    syncControls();
    requestDraw();
    return v;
  };
  fig.get = (name) => scope.get(name);
  // The latch's door out: the figure stays where it is, the stepper shows the free face.
  fig.stepOff = () => { fig.activeState = null; governed = null; syncControls(); };

  // ---- goto: ease numbers, snap discrete values, fade show/hide layers, move the camera
  fig.goto = (stateName, { ease = true } = {}) => {
    const { targets, visible, camera } = stateTargets(compiled, stateName);
    fig.pause();
    if (running) running.cancel();
    const from = {}, discrete = new Set();
    for (const k of Object.keys(targets)) {
      from[k] = scope.get(k);
      const c = controlOf(compiled, k);
      if (c && isDiscrete(c)) discrete.add(k);
    }
    // a scene3d state's camera pose eases like a control; before the chunk is
    // up it is remembered and applied on attach
    if (camera) {
      if (scene && scene.cameraTargets) { const ct = scene.cameraTargets(camera); Object.assign(from, ct.from); Object.assign(targets, ct.to); }
      else pendingCamera = camera;
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
    governed = new Set(Object.keys(targets).map((k) => k.split('.')[0]));
    running = transition({
      from, to: targets, discrete,
      reduced: env.reduced || !ease || env.pausedAll(),
      onStep(out, k) {
        let pose = null;
        for (const [key, v] of Object.entries(out)) {
          if (key.startsWith('@camera.')) { if (!pose) pose = {}; pose[key.slice(8)] = v; continue; }
          assign(key, v, 'state');
        }
        if (pose && scene && scene.setCamera) scene.setCamera(pose);
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
    // Play steps off before the range reset, so no frame shows a step over a moving control
    fig.activeState = null; governed = null;
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
  fig.retheme = () => { if (scene && scene.retheme) scene.retheme(); requestDraw(); };

  // data-mounted marks the first real frame: at once for a 2D scene, when the
  // chunk has drawn for a 3D one (the poster covers the box until then).
  function markMounted() {
    if (fig.mounted) return;
    fig.mounted = true;
    el.dataset.mounted = '';
    emit(el, 'x-fig:mount', { id: fig.id });
    if (playSpec && playSpec.autoplay && !env.reduced && fig.activeState === null) fig.play();
  }

  fig.setVisible = (flag) => {
    if (flag === fig.visible) return;
    fig.visible = flag;
    if (flag) {
      layout();
      if (is3d && !scene) requestScene3d();
      if (scene) { fig.draw(); markMounted(); }
    } else {
      if (!is3d) canvas.width = canvas.height = 0; // release the backing store off screen
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

  // ---- prose hooks
  fig.refInfo = (refId) => {
    const L = scene && scene.layers.get(refId);
    if (L) return { token: L.spec.stroke || L.spec.fill || null, dashed: !!L.spec.dash };
    const c = controlOf(compiled, refId);
    if (c) return { token: c.token || null, dashed: false };
    const R = scene && scene.readouts.find((r) => r.id === refId);
    if (R) return { token: R.spec.token, dashed: false };
    if (is3d) {
      const o = spec.shows.objects.find((x) => x.id === refId);
      if (o) return { token: o.color || null, dashed: false };
    }
    return { token: null, dashed: false };
  };
  fig.highlight = (refId, on) => {
    const L = scene && scene.layers.get(refId);
    if (L) { L.highlight = on; requestDraw(); return; }
    const R = scene && scene.readouts.find((r) => r.id === refId);
    if (R) { R.highlight = on; requestDraw(); return; }
    if (scene && scene.highlightObject && scene.highlightObject(refId, on)) { requestDraw(); return; }
    const m = mounted.find((x) => x.name === refId);
    if (m) m.el.classList.toggle('x-hl', on);
  };

  fig.dispose = () => {
    disposed = true;
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
    if (ro) ro.disconnect();
    if (detachDrag) detachDrag();
    if (scene && scene.dispose) scene.dispose();
    clearTimeout(mirrorTimer);
    if (poster) el.prepend(poster);
    if (figcaption) el.append(figcaption);
    for (const node of el.querySelectorAll(':scope > .x-canvas-box, :scope > .x-panel, :scope > .x-drag-proxy')) node.remove();
    delete el.dataset.face;
    delete el.dataset.mounted;
    delete el.dataset.booted;
    delete el.dataset.fallback;
  };

  // boot is always free: the stepper only offers a way in
  fig.activeState = null;
  syncControls();
  return fig;
}
