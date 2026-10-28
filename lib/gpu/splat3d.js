// lib/gpu/splat3d.js — the WebGPU renderer behind a splat3d figure: one
// object drawn twice from one turntable camera, as a Lambert-shaded triangle
// mesh on the left and as sorted, alpha-composited 3D Gaussians on the right,
// at the budget the figure's slider picks. Bundled into dist/explainers-gpu.v1.js
// by tools/build-gpu.mjs and imported lazily by lib/site/gpu.js; never part of
// the runtime bundle. mountSplat3d(canvas, compiled, env) returns the shape the
// Figure expects from a scene (layout / draw / readoutText / layers / readouts /
// dispose) plus the camera pose API the Figure eases between states.
import { parseMesh } from '../scene3d/mesh.js';
import { parseSplats } from './xspl.js';
import { eyeFor, viewMatrix, perspective, multiply, sortBackToFront, wireEdges, norm } from './math.js';
import { MESH_WGSL, WIRE_WGSL, SPLAT_WGSL } from './shaders.js';

const FOV_DEG = 40;
const NEAR = 0.05;
const DEFAULT_SPIN = 0.4;        // rad/s
const POLAR_EPS = 0.05;
const FRAC_VIEW = { x: [0, 1], y: [0, 1] };
const DIVIDER_DASH = [3, 6];
const UNIFORM_FLOATS = 32;       // mat4 + light + color + params (mesh/wire); the splat uniform is larger
const CAM_FLOATS = 48;           // view + proj + focal + viewport + color + params

function parseColor(css) {
  // the runtime resolves tokens to rgb()/#hex strings; both are handled here
  const m = /rgba?\(([^)]+)\)/.exec(css);
  if (m) { const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number); return [p[0] / 255, p[1] / 255, p[2] / 255]; }
  const h = /^#([0-9a-f]{6})/i.exec(css.trim());
  if (h) { const v = parseInt(h[1], 16); return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]; }
  return [0.5, 0.5, 0.5];
}

export async function mountSplat3d(canvas, compiled, env) {
  const shows = compiled.spec.shows, lib = env.lib, tokens = env.tokens;
  const levels = shows.levels;
  const camSpec = shows.camera;
  const spinRate = camSpec.spin ?? DEFAULT_SPIN;
  const lightDir = norm(shows.light.direction.map(Number));
  const ambient = shows.light.ambient;
  const baseUrl = env.baseUrl;

  // ---- WebGPU
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('no WebGPU adapter');
  const device = await adapter.requestDevice();
  const context = canvas.getContext('webgpu');
  if (!context) throw new Error('no webgpu context');
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'premultiplied' });
  let lost = false;
  device.lost.then(() => { lost = true; });

  // ---- pipelines
  const uniformLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
  const splatLayout = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
    { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
  ] });
  const meshModule = device.createShaderModule({ code: MESH_WGSL });
  const wireModule = device.createShaderModule({ code: WIRE_WGSL });
  const splatModule = device.createShaderModule({ code: SPLAT_WGSL });
  const premul = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } };
  const meshPipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [uniformLayout] }),
    vertex: { module: meshModule, entryPoint: 'vs', buffers: [
      { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
      { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] },
    ] },
    fragment: { module: meshModule, entryPoint: 'fs', targets: [{ format, blend: premul }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
  });
  const wirePipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [uniformLayout] }),
    vertex: { module: wireModule, entryPoint: 'vs', buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }] },
    fragment: { module: wireModule, entryPoint: 'fs', targets: [{ format, blend: premul }] },
    primitive: { topology: 'line-list' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less-equal' }, // no depthBias: WebGPU forbids it on line lists
  });
  const splatPipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [splatLayout] }),
    vertex: { module: splatModule, entryPoint: 'vs' },
    fragment: { module: splatModule, entryPoint: 'fs', targets: [{ format, blend: premul }] },
    primitive: { topology: 'triangle-list' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'always' },
  });

  // ---- uniforms (one buffer per pass so a frame can hold both halves)
  const mkUniform = (floats) => { const b = device.createBuffer({ size: floats * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }); return { buffer: b, data: new Float32Array(floats) }; };
  const uMesh = mkUniform(UNIFORM_FLOATS), uWireL = mkUniform(UNIFORM_FLOATS), uWireR = mkUniform(UNIFORM_FLOATS), uCam = mkUniform(CAM_FLOATS);
  const bgMesh = device.createBindGroup({ layout: uniformLayout, entries: [{ binding: 0, resource: { buffer: uMesh.buffer } }] });
  const bgWireL = device.createBindGroup({ layout: uniformLayout, entries: [{ binding: 0, resource: { buffer: uWireL.buffer } }] });
  const bgWireR = device.createBindGroup({ layout: uniformLayout, entries: [{ binding: 0, resource: { buffer: uWireR.buffer } }] });

  // ---- assets: fetched per level on demand, kept
  const cache = new Map();
  const fetchBin = async (name) => {
    const rel = shows.assets[name];
    const res = await fetch(new URL(rel, baseUrl).href);
    if (!res.ok) throw new Error(`${rel}: ${res.status}`);
    return res.arrayBuffer();
  };
  const mkBuffer = (arr, usage) => {
    const b = device.createBuffer({ size: Math.ceil(arr.byteLength / 4) * 4, usage: usage | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(b, 0, arr.buffer, arr.byteOffset, arr.byteLength);
    return b;
  };
  async function loadMesh(name) {
    const m = parseMesh(await fetchBin(name));
    const normals = m.normals || new Float32Array(m.positions.length);
    const indices = m.indices || Uint32Array.from({ length: m.vertexCount }, (_, i) => i);
    return { kind: 'mesh', count: indices.length, positions: m.positions,
      pos: mkBuffer(m.positions, GPUBufferUsage.VERTEX), nrm: mkBuffer(normals, GPUBufferUsage.VERTEX), idx: mkBuffer(indices, GPUBufferUsage.INDEX), indices };
  }
  async function loadSplats(name) {
    const s = parseSplats(await fetchBin(name));
    const order = new Uint32Array(s.count);
    return { kind: 'splats', count: s.count, positions: s.positions, order, scratch: {},
      data: mkBuffer(s.gpu, GPUBufferUsage.STORAGE), orderBuf: mkBuffer(order, GPUBufferUsage.STORAGE),
      bind: null };
  }
  function asset(name, loader) {
    if (!cache.has(name)) {
      const p = loader(name).then((a) => { cache.set(name, a); env.requestDraw(); return a; }).catch((e) => { loadError = `${shows.assets[name]}: ${e && e.message ? e.message : e}`; env.requestDraw(); return null; });
      cache.set(name, p);
    }
    const v = cache.get(name);
    return v instanceof Promise ? null : v; // null while loading, and after a failed load (loadError says why)
  }
  // the reference wireframe: the finest mesh's unique edges, on both halves
  let wire = null, wireRequested = false;
  function wireAsset() {
    const finest = levels[levels.length - 1];
    const m = asset(finest.mesh, loadMesh);
    if (!m) return null;
    if (!wire && !wireRequested) {
      wireRequested = true;
      const edges = wireEdges(m.indices);
      wire = { count: edges.length, idx: mkBuffer(edges, GPUBufferUsage.INDEX), pos: m.pos };
    }
    return wire;
  }

  // ---- camera: a turntable the reader can also drag
  let pose = { azimuth: camSpec.azimuth, polar: camSpec.polar, distance: camSpec.distance };
  let viewBox = { x: 0, y: 0, width: 1, height: 1 };
  let depthTex = null, depthView = null, depthSize = [0, 0];
  let lastFrame = 0, rafId = 0, spinning = false, disposed = false, dragging = false, lastDrawAt = 0, loadError = '', leadText = '';
  const IDLE_STOP_MS = 400; // no draw() consumed for this long: the figure is off screen, the loop stops (draw() restarts it)
  const clampPose = (p) => ({ ...p, polar: Math.min(Math.PI - POLAR_EPS, Math.max(POLAR_EPS, p.polar)), distance: Math.max(0.5, p.distance) });

  // drag to turn (pointer capture; vertical swipes still scroll on touch)
  canvas.style.touchAction = 'pan-y';
  canvas.classList.add('x-can-turn');
  let last = null;
  const down = (e) => { if (e.button !== undefined && e.button !== 0) return; dragging = true; last = [e.clientX, e.clientY]; canvas.setPointerCapture(e.pointerId); };
  const move = (e) => {
    if (!dragging || !last) return;
    const dx = e.clientX - last[0], dy = e.clientY - last[1]; last = [e.clientX, e.clientY];
    const w = Math.max(viewBox.width / 2, 1), h = Math.max(viewBox.height, 1);
    pose = clampPose({ ...pose, azimuth: pose.azimuth - (dx / w) * Math.PI, polar: pose.polar - (dy / h) * Math.PI });
    env.requestDraw();
  };
  const up = (e) => { dragging = false; last = null; try { canvas.releasePointerCapture(e.pointerId); } catch {} };
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);

  // the turntable: its own frame loop while the spin control is on, which the
  // Figure's draw() consumes through requestDraw
  function tick(t) {
    rafId = 0;
    if (disposed || !spinning) return;
    if (lastDrawAt && performance.now() - lastDrawAt > IDLE_STOP_MS) { spinning = false; return; }
    const dt = lastFrame ? Math.min(0.1, (t - lastFrame) / 1000) : 0;
    lastFrame = t;
    if (!dragging && dt) pose = { ...pose, azimuth: pose.azimuth + spinRate * dt };
    env.requestDraw();
    rafId = requestAnimationFrame(tick);
  }
  function setSpinning(on) {
    if (on === spinning) return;
    spinning = on; lastFrame = 0;
    if (on && !rafId) rafId = requestAnimationFrame(tick);
    if (!on && rafId) { cancelAnimationFrame(rafId); rafId = 0; }
  }

  // ---- overlay: the divider and the readouts (2D canvas over the WebGPU one)
  const overlay = document.createElement('canvas');
  overlay.className = 'x-3d-overlay';
  canvas.after(overlay);
  const readouts = (shows.readouts || []).map(lib.compileReadout);

  function layout(boxPx) {
    viewBox = boxPx;
    lib.fitCanvas(overlay, env.box, env.dpr);
    const w = canvas.width, h = canvas.height;
    if (depthSize[0] !== w || depthSize[1] !== h) {
      if (depthTex) depthTex.destroy();
      depthTex = device.createTexture({ size: [Math.max(1, w), Math.max(1, h)], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT });
      depthView = depthTex.createView();
      depthSize = [w, h];
    }
  }

  function currentLevel(scope) {
    const v = scope.get(shows.budget);
    let best = levels[0];
    for (const L of levels) if (Math.abs(L.value - v) < Math.abs(best.value - v)) best = L;
    return best;
  }
  const colorOf = (token) => parseColor(tokens.get(token));

  function writeUniform(u, mvp, color, alpha) {
    u.data.set(mvp, 0);
    u.data.set([lightDir[0], lightDir[1], lightDir[2], 0], 16);
    u.data.set([color[0], color[1], color[2], 1], 20);
    u.data.set([ambient, alpha, 0, 0], 24);
    device.queue.writeBuffer(u.buffer, 0, u.data.buffer, 0, u.data.byteLength);
  }

  function draw(scope) {
    if (lost || disposed || !depthView) return;
    lastDrawAt = performance.now();
    const L = currentLevel(scope);
    const mesh = asset(L.mesh, loadMesh), splats = asset(L.splats, loadSplats);
    const spinOn = shows.spinControl ? !!scope.get(shows.spinControl) : false;
    const outlineOn = shows.outlineControl ? !!scope.get(shows.outlineControl) : false;
    setSpinning(spinOn && !env.reduced);
    const w = canvas.width, h = canvas.height, half = Math.floor(w / 2);
    const aspect = half / Math.max(1, h);
    const eye = eyeFor(pose);
    const view = viewMatrix(eye);
    const proj = perspective(FOV_DEG, aspect, NEAR, pose.distance * 40 + 10);
    const mvp = multiply(proj, view);
    const meshColor = colorOf(shows.tokens.mesh), splatColor = colorOf(shows.tokens.splats), truthColor = colorOf(shows.tokens.truth);
    const wireA = outlineOn ? wireAsset() : null;

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: context.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }],
      depthStencilAttachment: { view: depthView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
    });
    // left: the mesh (and the outline over it)
    pass.setViewport(0, 0, half, h, 0, 1);
    pass.setScissorRect(0, 0, half, h);
    if (mesh) {
      writeUniform(uMesh, mvp, meshColor, 1);
      pass.setPipeline(meshPipeline);
      pass.setBindGroup(0, bgMesh);
      pass.setVertexBuffer(0, mesh.pos);
      pass.setVertexBuffer(1, mesh.nrm);
      pass.setIndexBuffer(mesh.idx, 'uint32');
      pass.drawIndexed(mesh.count);
    }
    if (wireA) {
      writeUniform(uWireL, mvp, truthColor, 0.55);
      pass.setPipeline(wirePipeline);
      pass.setBindGroup(0, bgWireL);
      pass.setVertexBuffer(0, wireA.pos);
      pass.setIndexBuffer(wireA.idx, 'uint32');
      pass.drawIndexed(wireA.count);
    }
    // right: the outline first (it writes depth), then the splats over it
    pass.setViewport(half, 0, w - half, h, 0, 1);
    pass.setScissorRect(half, 0, w - half, h);
    if (wireA) {
      writeUniform(uWireR, mvp, truthColor, 0.55);
      pass.setPipeline(wirePipeline);
      pass.setBindGroup(0, bgWireR);
      pass.setVertexBuffer(0, wireA.pos);
      pass.setIndexBuffer(wireA.idx, 'uint32');
      pass.drawIndexed(wireA.count);
    }
    if (splats) {
      sortBackToFront(splats.positions, view, splats.order, splats.scratch);
      device.queue.writeBuffer(splats.orderBuf, 0, splats.order.buffer, 0, splats.order.byteLength);
      const f = (h / 2) / Math.tan((FOV_DEG * Math.PI) / 360);
      uCam.data.set(view, 0); uCam.data.set(proj, 16);
      uCam.data.set([f, f, w - half, h], 32);
      uCam.data.set([splatColor[0], splatColor[1], splatColor[2], 1], 36);
      uCam.data.set([1, 0, 0, 0], 40);
      device.queue.writeBuffer(uCam.buffer, 0, uCam.data.buffer, 0, uCam.data.byteLength);
      if (!splats.bind) splats.bind = device.createBindGroup({ layout: splatLayout, entries: [
        { binding: 0, resource: { buffer: uCam.buffer } }, { binding: 1, resource: { buffer: splats.data } }, { binding: 2, resource: { buffer: splats.orderBuf } },
      ] });
      pass.setPipeline(splatPipeline);
      pass.setBindGroup(0, splats.bind);
      pass.draw(6, splats.count);
    }
    pass.end();
    device.queue.submit([encoder.finish()]);

    // the overlay: divider and readouts
    const ctx = overlay.getContext('2d');
    ctx.setTransform(env.dpr, 0, 0, env.dpr, 0, 0);
    ctx.clearRect(0, 0, viewBox.width, viewBox.height);
    ctx.save();
    ctx.strokeStyle = tokens.get(shows.tokens.truth);
    ctx.globalAlpha = 0.6; ctx.lineWidth = 1; ctx.setLineDash(DIVIDER_DASH);
    ctx.beginPath(); ctx.moveTo(viewBox.width / 2 + 0.5, 8); ctx.lineTo(viewBox.width / 2 + 0.5, viewBox.height - 8); ctx.stroke();
    ctx.restore();
    const m = { s: viewBox.height, x: (fx) => fx * viewBox.width, y: (fy) => (1 - fy) * viewBox.height, len: (l) => l * viewBox.height, wx: (px) => px / viewBox.width, wy: (py) => 1 - py / viewBox.height };
    const penv = { m, view: FRAC_VIEW, tokens, fg: tokens.get('--fg') || '#000', bg: tokens.get('--bg') || '#fff', font: env.font, fmt: env.fmt, obstacles: [], placed: [], box: viewBox, dpr: env.dpr };
    for (const R of readouts) lib.drawReadout(ctx, R, scope, penv, new Map());
    // the measured lead, from the level's PSNR pair (the expression grammar has no table lookup)
    if (Number.isFinite(L.psnr_mesh) && Number.isFinite(L.psnr_splats)) {
      const reference = L.psnr_mesh >= 60; // the finest mesh is the reference itself
      const lead = L.psnr_splats - L.psnr_mesh;
      const text = reference ? 'the faces are the reference' : `${lead >= 0 ? 'blobs' : 'faces'} lead by ${Math.abs(lead).toFixed(1)} dB`;
      const token = reference || lead < 0 ? shows.tokens.mesh : shows.tokens.splats;
      ctx.save();
      ctx.font = `600 12px ${env.font || 'sans-serif'}`; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.lineWidth = 3; ctx.strokeStyle = penv.bg; ctx.lineJoin = 'round'; ctx.fillStyle = tokens.get(token);
      ctx.strokeText(text, viewBox.width / 2, viewBox.height - 10); ctx.fillText(text, viewBox.width / 2, viewBox.height - 10);
      ctx.restore();
      leadText = text;
    }
    if (!mesh || !splats) {
      ctx.save(); ctx.globalAlpha = 0.7; ctx.fillStyle = penv.fg; ctx.font = `12px ${env.font || 'sans-serif'}`; ctx.textAlign = 'center';
      ctx.fillText(loadError || 'loading…', viewBox.width / 2, viewBox.height - 14); ctx.restore();
    }
  }

  function dispose() {
    disposed = true;
    setSpinning(false);
    for (const [t, f] of [['pointerdown', down], ['pointermove', move], ['pointerup', up], ['pointercancel', up]]) canvas.removeEventListener(t, f);
    canvas.classList.remove('x-can-turn');
    overlay.remove();
    for (const v of cache.values()) if (!(v instanceof Promise)) for (const k of ['pos', 'nrm', 'idx', 'data', 'orderBuf']) if (v[k]) v[k].destroy();
    if (wire) wire.idx.destroy();
    if (depthTex) depthTex.destroy();
    for (const u of [uMesh, uWireL, uWireR, uCam]) u.buffer.destroy();
    device.destroy();
  }

  const objects = new Map([['mesh', { id: 'mesh' }], ['splats', { id: 'splats' }], ['truth', { id: 'truth' }]]);
  const tokenOf = { mesh: shows.tokens.mesh, splats: shows.tokens.splats, truth: shows.tokens.truth };
  return {
    kind: 'splat3d',
    layers: new Map(), readouts, objects,
    get view() { return null; },
    layout, draw, dispose,
    hitDrag() { return null; },
    dragValue() { return null; },
    highlightObject() { return true; },
    retheme() { env.requestDraw(); },
    toWorld() { return [0, 0]; },
    readoutText() { return [...readouts.map((R) => R.last), leadText].filter(Boolean).join(' · '); },
    objectToken(id) { return tokenOf[id] || null; },
    hasObject(id) { return objects.has(id); },
    getCamera() { return { ...pose }; },
    setCamera(partial) { pose = clampPose({ ...pose, ...partial }); env.requestDraw(); },
    cameraTargets(cam) {
      const from = {}, to = {};
      for (const k of ['azimuth', 'polar', 'distance']) { if (!(k in cam)) continue; from[`@camera.${k}`] = pose[k]; to[`@camera.${k}`] = cam[k]; }
      return { from, to };
    },
  };
}
