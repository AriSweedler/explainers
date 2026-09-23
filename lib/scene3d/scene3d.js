// lib/scene3d/scene3d.js — the three.js adapter behind a scene3d figure.
// Bundled with three into dist/explainers-3d.v1.js by tools/build-3d.mjs and
// imported lazily by lib/site/scene3d.js; never part of the runtime bundle.
// mountScene3d(canvas, compiled, env) returns the same shape lib/scene2d
// returns (layout / draw / hitDrag / dragValue / readoutText / layers /
// readouts / dispose) plus the camera pose API the Figure eases between
// states. Everything shared with the runtime (expression getters, Scene2D
// for split panels, readouts, layout helpers) arrives through env.lib so the
// chunk holds no second copy of runtime code.
import {
  WebGLRenderer, Scene, PerspectiveCamera, DirectionalLight, AmbientLight, Group, Mesh, Object3D,
  SphereGeometry, TorusGeometry, CircleGeometry, CylinderGeometry, ConeGeometry, PlaneGeometry, BufferGeometry, BufferAttribute,
  MeshLambertMaterial, MeshPhongMaterial, MeshStandardMaterial, MeshBasicMaterial, ShaderMaterial,
  Color, Vector2, Vector3, Quaternion, Raycaster, Plane, TextureLoader,
  DoubleSide, FrontSide, BackSide, SRGBColorSpace, NoColorSpace, PCFSoftShadowMap,
  AlwaysStencilFunc, NotEqualStencilFunc, IncrementWrapStencilOp, DecrementWrapStencilOp, ReplaceStencilOp,
} from 'three';
import { FOV_DEG, NEAR, initialPose, clampPose, eyeFor, lookAt, project, pxPerWorld, radPerPx, nearestAzimuth, momentumStep, axisVector, norm, DEFAULT_FRICTION } from './camera.js';
import { clampLatLon, latLonToPoint, pointToLatLon, rayToSphere } from './surface.js';
import { parseMesh, densityUrl } from './mesh.js';
import { compileObject, evalObject, labelSpecs, RING_WIDTH_PX, labelPosition } from './objects.js';

const UNIT = { x: 0, y: 0, width: 1, height: 1 };
const FRAC_VIEW = { x: [0, 1], y: [0, 1] }; // readouts `at` in a scene3d: fractions of the box, y up
const Y_AXIS = new Vector3(0, 1, 0);
const HANDLE_PX = 6;
const MOMENTUM_WINDOW_MS = 100; // the release velocity is measured over the last stretch of the drag
const MOMENTUM_CAP = 0.2;       // rad per frame (12 rad/s): a flick spins, never blurs
const LIGHT_SCALE = Math.PI; // three >= r155 lights are physical; pi restores "intensity 1 = fully lit"

const LUT_VERT = `
uniform sampler2D uHeight; uniform float uExag;
varying vec2 vUv; varying vec3 vN;
void main() {
  vUv = uv;
  float h = texture2D(uHeight, uv).r;
  vec3 p = position + normal * h * uExag * 0.01;
  vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const LUT_FRAG = `
uniform sampler2D uHeight; uniform sampler2D uLut; uniform vec3 uLight; uniform float uAmbient; uniform float uOpacity; uniform float uHasLut;
varying vec2 vUv; varying vec3 vN;
void main() {
  float h = texture2D(uHeight, vUv).r;
  vec3 c = uHasLut > 0.5 ? texture2D(uLut, vec2(h, 0.5)).rgb : vec3(h);
  float d = max(dot(normalize(vN), normalize(uLight)), 0.0);
  gl_FragColor = vec4(c * (uAmbient + (1.0 - uAmbient) * d), uOpacity);
  #include <colorspace_fragment>
}`;

export function mountScene3d(canvas, compiled, env) {
  const shows = compiled.spec.shows, lib = env.lib, camSpec = shows.camera;
  const tokens = env.tokens;
  const splits = shows.split || [];
  const hasCut = shows.objects.some((o) => o.cut);

  // ---- renderer, scene, camera, lights
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, stencil: hasCut, powerPreference: 'low-power' });
  renderer.setPixelRatio(env.dpr);
  renderer.setClearColor(0x000000, 0);
  renderer.localClippingEnabled = hasCut;
  if (shows.shadows) { renderer.shadowMap.enabled = true; renderer.shadowMap.type = PCFSoftShadowMap; }
  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV_DEG, 1, NEAR, camSpec.distance * 40 + 100);
  const light = new DirectionalLight(0xffffff, LIGHT_SCALE);
  const lightDist = camSpec.distance * 2;
  light.target = new Object3D();
  scene.add(light, light.target);
  if (shows.shadows) {
    light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024);
    const E = camSpec.distance * 0.6;
    Object.assign(light.shadow.camera, { left: -E, right: E, top: E, bottom: -E, near: 0.1, far: lightDist * 2 });
    light.shadow.bias = -0.0005;
  }
  const ambient = new AmbientLight(0xffffff, shows.light.ambient * LIGHT_SCALE);
  scene.add(ambient);
  const lightDirG = shows.light.direction.map(lib.getter);
  const lightDir = (scope) => lightDirG.map((g) => g(scope));
  const model = shows.model ? { spec: shows.model, params: mapValues(shows.model.params, lib.getter) } : null;

  // ---- colors
  const css = (tok) => tokens.get(tok) || tokens.get('--fg') || '#888';
  const colorOf = (tok) => new Color().setStyle(css(tok || '--fg'));
  const baseUrl = env.baseUrl;
  const assets = shows.assets || {};
  const loader = new TextureLoader();
  const maxAniso = renderer.capabilities.getMaxAnisotropy ? Math.min(4, renderer.capabilities.getMaxAnisotropy()) : 1;
  let disposed = false;

  // Textures come as @1x/@2x files beside the spec path; the bare path is the fallback.
  function loadTexture(assetName, { color = true } = {}, onLoad) {
    const path = assets[assetName];
    if (!path) return null;
    const apply = (tex) => {
      if (disposed) { tex.dispose(); return; }
      tex.colorSpace = color ? SRGBColorSpace : NoColorSpace;
      tex.anisotropy = maxAniso;
      onLoad(tex);
      env.requestDraw();
    };
    const bare = new URL(path, baseUrl).href;
    loader.load(new URL(densityUrl(path, env.dpr), baseUrl).href, apply, undefined, () => loader.load(bare, apply, undefined, () => {}));
    return true;
  }

  // ---- geometry shared by every sphere-like object
  const unitSphere = new SphereGeometry(1, 48, 32);
  const unitSphereLow = new SphereGeometry(1, 16, 12);
  const unitDisc = new CircleGeometry(1, 96).rotateX(-Math.PI / 2);
  const disposables = [unitSphere, unitSphereLow, unitDisc];

  function makeMaterial(kind, color, extra = {}) {
    switch (kind) {
      case 'phong': return new MeshPhongMaterial({ color, shininess: 24, ...extra });
      case 'standard': return new MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...extra });
      case 'unlit': return new MeshBasicMaterial({ color, ...extra });
      default: return new MeshLambertMaterial({ color, ...extra }); // lambert, and lut on anything but a globe
    }
  }
  function setOpacity(mat, opacity) {
    const t = opacity < 1;
    if (mat.transparent !== t) { mat.transparent = t; mat.needsUpdate = true; }
    mat.opacity = opacity;
    mat.depthWrite = !t || mat.userData.keepDepth === true;
  }

  // ---- objects
  const byId = new Map();
  const objects = shows.objects.filter((o) => o.kind !== 'label').map((spec) => buildObject(spec));
  for (const ob of objects) { scene.add(ob.node); byId.set(ob.O.id, ob); }

  function buildObject(spec) {
    const O = compileObject(spec, lib.getter);
    const node = new Group();
    const ob = { O, node, mesh: null, mats: [], color: spec.color || null, radiusWorld: 0, tip: null, update: null, afterCamera: null, retheme: null, dispose: null };
    const baseColor = () => colorOf(ob.color);
    const shadow = (m) => { if (shows.shadows) { m.castShadow = true; m.receiveShadow = true; } };
    switch (spec.kind) {
      case 'globe': case 'sphere': {
        const textured = spec.kind === 'globe' ? true : !!spec.texture;
        let mat;
        if (spec.kind === 'globe' && spec.material === 'lut') {
          mat = new ShaderMaterial({ vertexShader: LUT_VERT, fragmentShader: LUT_FRAG, uniforms: { uHeight: { value: null }, uLut: { value: null }, uLight: { value: new Vector3(0, 0, 1) }, uAmbient: { value: shows.light.ambient }, uOpacity: { value: 1 }, uExag: { value: 0 }, uHasLut: { value: 0 } } });
          mat.userData.lut = true;
          loadTexture(spec.textures.land, { color: false }, (t) => { mat.uniforms.uHeight.value = t; });
          if (spec.lut) loadTexture(spec.lut, { color: true }, (t) => { mat.uniforms.uLut.value = t; mat.uniforms.uHasLut.value = 1; });
        } else {
          mat = makeMaterial(spec.material, textured && !spec.color ? new Color(0xffffff) : baseColor());
          const mapName = spec.kind === 'globe' ? spec.textures.land : spec.texture;
          if (mapName) loadTexture(mapName, { color: true }, (t) => { mat.map = t; mat.needsUpdate = true; });
        }
        const mesh = new Mesh(unitSphere, mat);
        shadow(mesh);
        node.add(mesh);
        ob.mesh = mesh; ob.mats.push(mat);
        if (spec.kind === 'globe' && spec.textures.clouds) {
          const cm = new MeshLambertMaterial({ color: 0xffffff, transparent: true, depthWrite: false, opacity: 1 });
          cm.userData.keepDepth = false;
          const clouds = new Mesh(unitSphere, cm);
          clouds.scale.setScalar(1.012);
          clouds.visible = false;
          loadTexture(spec.textures.clouds, { color: true }, (t) => { cm.map = t; cm.needsUpdate = true; clouds.visible = true; });
          mesh.add(clouds); ob.mats.push(cm);
        }
        if (spec.kind === 'globe' && spec.textures.outline) {
          const om = new MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false });
          const outline = new Mesh(unitSphere, om);
          outline.scale.setScalar(1.003);
          outline.visible = false;
          loadTexture(spec.textures.outline, { color: true }, (t) => { om.map = t; om.needsUpdate = true; outline.visible = true; });
          mesh.add(outline); ob.mats.push(om);
        }
        ob.update = (f) => {
          ob.radiusWorld = f.radius * f.scale;
          mesh.scale.setScalar(ob.radiusWorld);
          if (mat.userData.lut) { mat.uniforms.uOpacity.value = f.opacity; mat.uniforms.uExag.value = f.exaggeration || 0; mat.transparent = f.opacity < 1; }
          else setOpacity(mat, f.opacity);
        };
        ob.afterCamera = () => {
          if (!mat.userData.lut) return;
          const d = new Vector3().copy(light.position).normalize().transformDirection(camera.matrixWorldInverse);
          mat.uniforms.uLight.value.copy(d);
        };
        ob.retheme = () => { if (!mat.userData.lut && (!textured || spec.color)) mat.color.copy(baseColor()); };
        break;
      }
      case 'ring': {
        const mat = new MeshBasicMaterial({ color: baseColor() });
        const mesh = new Mesh(new TorusGeometry(1, 0.01, 8, 128).rotateX(Math.PI / 2), mat);
        node.add(mesh);
        ob.mesh = mesh; ob.mats.push(mat);
        let last = { r: -1, tube: -1 };
        ob.update = (f) => { ob.radiusWorld = f.radius * f.scale; setOpacity(mat, f.opacity); ob.pending = f; };
        ob.afterCamera = (view, viewBox) => {
          const r = ob.radiusWorld;
          const depth = depthOf(node, view);
          const tube = Math.max(0.5 * (spec.width || RING_WIDTH_PX) / pxPerWorld(depth, viewBox.height), 1e-4);
          if (Math.abs(r - last.r) > 1e-6 || Math.abs(tube - last.tube) / tube > 0.15) {
            mesh.geometry.dispose();
            mesh.geometry = new TorusGeometry(r, tube, 8, 128).rotateX(Math.PI / 2);
            last = { r, tube };
          }
        };
        ob.retheme = () => mat.color.copy(baseColor());
        break;
      }
      case 'disc': {
        const mat = new MeshBasicMaterial({ color: baseColor(), side: DoubleSide });
        const mesh = new Mesh(unitDisc, mat);
        if (shows.shadows) mesh.receiveShadow = true;
        node.add(mesh);
        ob.mesh = mesh; ob.mats.push(mat);
        ob.update = (f) => { ob.radiusWorld = f.radius * f.scale; mesh.scale.setScalar(ob.radiusWorld); setOpacity(mat, f.opacity); };
        ob.retheme = () => mat.color.copy(baseColor());
        break;
      }
      case 'arrow': {
        const mat = new MeshLambertMaterial({ color: baseColor() });
        const shaft = new Mesh(new CylinderGeometry(1, 1, 1, 12), mat);
        const head = new Mesh(new ConeGeometry(1, 1, 16), mat);
        shadow(shaft); shadow(head);
        node.add(shaft, head);
        ob.mats.push(mat);
        disposables.push(shaft.geometry, head.geometry);
        ob.update = (f) => {
          const len = f.length, hd = Math.min(f.head, len);
          const dir = len > 0 ? [(f.to[0] - f.from[0]) / len, (f.to[1] - f.from[1]) / len, (f.to[2] - f.from[2]) / len] : [0, 1, 0];
          node.position.set(f.from[0], f.from[1], f.from[2]);
          node.quaternion.setFromUnitVectors(Y_AXIS, new Vector3(dir[0], dir[1], dir[2]));
          const shaftR = Math.max(hd * 0.12, 1e-4), shaftLen = Math.max(len - hd, 0);
          shaft.scale.set(shaftR, Math.max(shaftLen, 1e-4), shaftR);
          shaft.position.y = shaftLen / 2;
          head.scale.set(Math.max(hd * 0.32, 1e-4), Math.max(hd, 1e-4), Math.max(hd * 0.32, 1e-4));
          head.position.y = len - hd / 2;
          ob.tip = f.to;
          setOpacity(mat, f.opacity);
        };
        ob.retheme = () => mat.color.copy(baseColor());
        break;
      }
      case 'body': case 'part': {
        const mat = makeMaterial(spec.material, baseColor());
        const mesh = new Mesh(new BufferGeometry(), mat);
        shadow(mesh);
        node.add(mesh);
        ob.mesh = mesh; ob.mats.push(mat);
        const path = assets[spec.mesh];
        if (path) {
          fetch(new URL(path, baseUrl).href).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status)))).then((buf) => {
            if (disposed) return;
            const m = parseMesh(buf);
            const geo = new BufferGeometry();
            geo.setAttribute('position', new BufferAttribute(m.positions, 3));
            if (m.normals) geo.setAttribute('normal', new BufferAttribute(m.normals, 3));
            if (m.indices) geo.setIndex(new BufferAttribute(m.indices, 1));
            if (!m.normals) geo.computeVertexNormals();
            geo.computeBoundingSphere();
            mesh.geometry.dispose();
            mesh.geometry = geo;
            if (cut) { for (const s of cut.stencil) s.geometry = geo; cut.size = geo.boundingSphere.radius * 2.5; }
            ob.radiusWorld = geo.boundingSphere.radius;
            env.requestDraw();
          }).catch(() => {});
        }
        // Planar cut with a stencil cap (three's clipping_stencil recipe): the
        // clipped mesh, back faces incrementing and front faces decrementing
        // the stencil, then a plane drawn only where the stencil is non-zero.
        let cut = null;
        if (spec.cut) {
          const plane = new Plane(new Vector3(...axisVector(spec.cut.plane)), 0);
          mat.clippingPlanes = [plane];
          mat.side = DoubleSide;
          const stencilMat = (side, op) => new MeshBasicMaterial({ side, clippingPlanes: [plane], depthWrite: false, depthTest: false, colorWrite: false, stencilWrite: true, stencilFunc: AlwaysStencilFunc, stencilFail: op, stencilZFail: op, stencilZPass: op });
          const back = new Mesh(mesh.geometry, stencilMat(BackSide, IncrementWrapStencilOp));
          const front = new Mesh(mesh.geometry, stencilMat(FrontSide, DecrementWrapStencilOp));
          back.renderOrder = 1; front.renderOrder = 1;
          node.add(back, front);
          const capMat = makeMaterial(spec.material === 'unlit' ? 'unlit' : 'lambert', baseColor(), { side: DoubleSide, stencilWrite: true, stencilRef: 0, stencilFunc: NotEqualStencilFunc, stencilFail: ReplaceStencilOp, stencilZFail: ReplaceStencilOp, stencilZPass: ReplaceStencilOp });
          const cap = new Mesh(new PlaneGeometry(1, 1), capMat);
          cap.renderOrder = 2;
          scene.add(cap); // world space: the plane is in the object's frame, applied below
          disposables.push(cap.geometry);
          ob.mats.push(back.material, front.material, capMat);
          cut = { plane, normal: axisVector(spec.cut.plane), stencil: [back, front], cap, size: 2 };
        }
        const explodeAxis = spec.explode ? axisVector(spec.explode.axis) : null;
        ob.update = (f) => {
          if (explodeAxis) { const k = f.explodeOffset || 0; node.position.set(f.position[0] + explodeAxis[0] * k, f.position[1] + explodeAxis[1] * k, f.position[2] + explodeAxis[2] * k); }
          setOpacity(mat, f.opacity);
          if (cut) {
            node.updateMatrixWorld(true);
            // the plane lives in the object's frame: normal rotated, offset along it from the object's origin
            const n = new Vector3(...cut.normal).transformDirection(node.matrixWorld).normalize();
            const origin = new Vector3().setFromMatrixPosition(node.matrixWorld);
            const p0 = origin.clone().addScaledVector(n, (f.cutOffset || 0) * f.scale);
            cut.plane.setFromNormalAndCoplanarPoint(n.clone().negate(), p0); // keep the half-space behind the plane
            cut.cap.position.copy(p0);
            cut.cap.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), n);
            cut.cap.scale.setScalar(cut.size * f.scale);
            cut.cap.visible = f.visible;
          }
        };
        ob.retheme = () => { mat.color.copy(baseColor()); if (cut) cut.cap.material.color.copy(baseColor()); };
        ob.dispose = () => { if (cut) scene.remove(cut.cap); };
        break;
      }
      default: break;
    }
    return ob;
  }

  function depthOf(node, view) {
    const p = new Vector3().setFromMatrixPosition(node.matrixWorld);
    return Math.max(-((p.x - view.eye[0]) * view.back[0] + (p.y - view.eye[1]) * view.back[1] + (p.z - view.eye[2]) * view.back[2]), NEAR);
  }

  // ---- DOM: the overlay canvas (split panels, readouts, edge arrows) and the labels
  const overlay = document.createElement('canvas');
  overlay.className = 'x-3d-overlay';
  canvas.after(overlay);
  const labelBox = document.createElement('div');
  labelBox.className = 'x-3d-labels';
  overlay.after(labelBox);
  const labels = labelSpecs(shows.objects, lib.getter).map((L) => {
    const el = document.createElement('div');
    el.className = 'x-3d-label';
    const tok = L.color || (L.anchor && byId.get(L.anchor) ? byId.get(L.anchor).color : null);
    if (tok) el.style.color = `var(--c-${tok})`;
    labelBox.append(el);
    return { ...L, el, parts: lib.compileTemplate(L.text), last: '' };
  });
  const scene2d = lib.createScene2d(overlay, { type: 'scene2d', view: FRAC_VIEW, layers: [], split: splits }, { tokens, dpr: env.dpr, font: env.font, fmt: env.fmt, drags: [], baseUrl, requestDraw: env.requestDraw });
  const readouts = (shows.readouts || []).map(lib.compileReadout);

  // ---- surface drag handles
  const handles = env.drags.filter((d) => d.control.constrain.startsWith('surface:')).map((d) => {
    const mat = new MeshBasicMaterial({ color: colorOf(d.control.token) });
    const mesh = new Mesh(unitSphereLow, mat);
    mesh.renderOrder = 3;
    scene.add(mesh);
    return { name: d.name, control: d.control, targetId: d.control.constrain.slice(8), mesh, mat, world: null, behind: false };
  });

  // ---- camera pose and interaction
  let pose = initialPose(camSpec);
  const momentumOn = camSpec.momentum !== false && !env.reduced && camSpec.mode !== 'fixed';
  const friction = camSpec.friction ?? DEFAULT_FRICTION;
  let view = null, viewBox = { x: 0, y: 0, width: 1, height: 1 }, box = { x: 0, y: 0, width: 1, height: 1 }, corners = [], lastScope = null;
  let mom = null;
  const stopMomentum = () => { if (mom) { cancelAnimationFrame(mom.raf); mom = null; } };
  function startMomentum(vx, vy) {
    if (!momentumOn || (Math.abs(vx) < 1e-4 && Math.abs(vy) < 1e-4)) return;
    mom = { vx, vy, last: performance.now(), raf: 0 };
    mom.raf = requestAnimationFrame(tickMomentum);
  }
  function tickMomentum(now) {
    if (!mom) return;
    const dt = Math.min(Math.max(now - mom.last, 0) / 1000, 0.1);
    mom.last = now;
    const a = momentumStep(mom.vx, dt, friction), b = momentumStep(mom.vy, dt, friction);
    pose = clampPose({ azimuth: pose.azimuth + a.move, polar: pose.polar + b.move, distance: pose.distance }, camSpec);
    mom.vx = a.vel; mom.vy = b.vel;
    env.requestDraw();
    if (mom.vx || mom.vy) mom.raf = requestAnimationFrame(tickMomentum); else mom = null;
  }
  let detachPointer = () => {};
  if (camSpec.mode !== 'fixed') {
    let active = null;
    const local = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const down = (e) => {
      if (e.button !== 0 && e.pointerType !== 'touch') return;
      const p = local(e);
      if (hitDrag(p, e.pointerType === 'touch') != null) return; // a surface handle: lib/core/drag.js owns it
      stopMomentum();
      active = { id: e.pointerId, x: p.x, y: p.y, samples: [{ t: performance.now(), az: pose.azimuth, po: pose.polar }] };
      if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
      canvas.classList.add('x-dragging');
    };
    const move = (e) => {
      if (!active || e.pointerId !== active.id) return;
      const p = local(e), k = radPerPx(viewBox.width);
      const dAz = -(p.x - active.x) * k, dPo = -(p.y - active.y) * k;
      pose = clampPose({ azimuth: pose.azimuth + dAz, polar: pose.polar + dPo, distance: pose.distance }, camSpec);
      const now = performance.now();
      active.samples.push({ t: now, az: pose.azimuth, po: pose.polar });
      while (active.samples.length > 2 && now - active.samples[0].t > MOMENTUM_WINDOW_MS) active.samples.shift();
      active.x = p.x; active.y = p.y;
      env.requestDraw();
    };
    const up = (e) => {
      if (!active || e.pointerId !== active.id) return;
      const a = active;
      active = null;
      canvas.classList.remove('x-dragging');
      // release velocity over the last MOMENTUM_WINDOW_MS of the drag, in rad per 60 Hz frame, capped
      const s0 = a.samples[0], s1 = a.samples[a.samples.length - 1], ms = s1.t - s0.t;
      if (ms >= 8 && performance.now() - s1.t < 100) {
        const frames = ms / (1000 / 60), cap = (v) => Math.max(-MOMENTUM_CAP, Math.min(MOMENTUM_CAP, v));
        startMomentum(cap((s1.az - s0.az) / frames), cap((s1.po - s0.po) / frames));
      }
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    // a horizontal finger drag turns the scene; a vertical one still scrolls the page
    if (!canvas.style.touchAction) canvas.style.touchAction = 'pan-y';
    canvas.classList.add('x-can-turn');
    detachPointer = () => { for (const [t, f] of [['pointerdown', down], ['pointermove', move], ['pointerup', up], ['pointercancel', up]]) canvas.removeEventListener(t, f); };
  }

  const lockOb = camSpec.lock ? byId.get(camSpec.lock) : null;
  const worldPos = (node) => { const v = new Vector3().setFromMatrixPosition(node.matrixWorld); return [v.x, v.y, v.z]; };

  // ---- layout and drawing
  function layout(newBox, newCorners = []) {
    box = newBox; corners = newCorners;
    renderer.setSize(box.width, box.height, false);
    lib.fitCanvas(overlay, env.box, env.dpr);
    scene2d.layout(box, corners);
    const strip = Math.max(0, ...corners.map((o) => box.y + box.height - o.y));
    const drawBox = strip ? { ...box, height: Math.max(box.height - strip, box.height * 0.6) } : box;
    viewBox = lib.splitBoxes(drawBox, splits).main;
    camera.aspect = viewBox.width / viewBox.height;
    camera.updateProjectionMatrix();
  }

  function draw(scope) {
    lastScope = scope;
    if (model) lib.applyModel(model.spec, model.params, scope);
    const frames = new Map();
    for (const ob of objects) {
      const f = evalObject(ob.O, scope);
      frames.set(ob.O.id, f);
      ob.node.visible = f.visible;
      if (ob.O.kind !== 'arrow') { ob.node.position.set(f.position[0], f.position[1], f.position[2]); ob.node.rotation.set(f.rotation[0], f.rotation[1], f.rotation[2]); }
      if (ob.O.kind !== 'globe' && ob.O.kind !== 'sphere' && ob.O.kind !== 'ring' && ob.O.kind !== 'disc') ob.node.scale.setScalar(f.scale);
      ob.update(f);
    }
    scene.updateMatrixWorld(true);
    const target = lockOb ? worldPos(lockOb.node) : [0, 0, 0];
    const eye = eyeFor(pose, target);
    camera.position.set(eye[0], eye[1], eye[2]);
    camera.lookAt(target[0], target[1], target[2]);
    camera.updateMatrixWorld(true);
    view = lookAt(eye, target);
    const ld = norm(lightDir(scope));
    light.position.set(ld[0] * lightDist, ld[1] * lightDist, ld[2] * lightDist);
    light.target.position.set(0, 0, 0);
    for (const ob of objects) if (ob.afterCamera) ob.afterCamera(view, viewBox);
    updateHandles(scope);
    // the WebGL frame, into the main box (split panels take the rest)
    renderer.setScissorTest(false);
    renderer.clear();
    renderer.setViewport(viewBox.x, box.height - (viewBox.y + viewBox.height), viewBox.width, viewBox.height);
    renderer.setScissor(viewBox.x, box.height - (viewBox.y + viewBox.height), viewBox.width, viewBox.height);
    renderer.setScissorTest(true);
    renderer.render(scene, camera);
    // the overlay: panels, readouts, edge arrows
    scene2d.draw(scope);
    const ctx = overlay.getContext('2d');
    const bg = tokens.get('--bg'), fg = tokens.get('--fg');
    const penv = { tokens, font: env.font, fmt: env.fmt, bg, fg, box: viewBox, obstacles: corners, m: lib.worldToPx(FRAC_VIEW, viewBox), view: FRAC_VIEW };
    for (const R of readouts) lib.drawReadout(ctx, R, scope, penv, new Map());
    if (camSpec.mode === 'panorama' && camSpec.edgeArrows) drawEdgeArrows(ctx, frames);
    updateLabels(scope, frames);
  }

  function anchorPx(ob, f) {
    // the label anchor: under a sphere, at an arrow's tip, at the object's position otherwise
    if (ob.O.kind === 'arrow') { const p = project(ob.tip || f.to, view, viewBox); return p ? { x: p.x, y: p.y, depth: p.depth, dy: 0 } : null; }
    const c = worldPos(ob.node);
    const p = project(c, view, viewBox);
    if (!p) return null;
    const r = ob.radiusWorld ? ob.radiusWorld * pxPerWorld(p.depth, viewBox.height) : 0;
    return { x: p.x, y: p.y, depth: p.depth, dy: r };
  }

  function updateLabels(scope, frames) {
    for (const L of labels) {
      let show = L.visible ? L.visible(scope) !== 0 : true;
      let at = null, dflt = [0, 14];
      if (L.anchor) {
        const ob = byId.get(L.anchor), f = frames.get(L.anchor);
        if (!ob || !f || !f.visible) show = false;
        else { const a = anchorPx(ob, f); if (a) { at = a; dflt = [0, a.dy + 14]; } else show = false; }
      } else if (L.position) {
        const p = project(labelPosition(L, scope), view, viewBox);
        if (p) at = p; else show = false;
      }
      if (!show || !at) { if (L.el.style.display !== 'none') L.el.style.display = 'none'; continue; }
      const [dx, dy] = L.offset || dflt;
      const text = lib.renderTemplate(L.parts, scope, env.fmt);
      if (text !== L.last) { L.el.textContent = text; L.last = text; }
      L.el.style.display = '';
      L.el.style.transform = `translate(${Math.round(at.x + dx)}px, ${Math.round(at.y + dy)}px) translate(-50%, -50%)`;
      L.el.classList.toggle('x-hl', !!(L.anchor && byId.get(L.anchor) && byId.get(L.anchor).O.highlight));
    }
  }

  // Panorama: a small arrow at the edge of the view toward every visible
  // object that is off screen, in the object's color.
  function drawEdgeArrows(ctx, frames) {
    const cx = viewBox.x + viewBox.width / 2, cy = viewBox.y + viewBox.height / 2;
    for (const ob of objects) {
      if (ob === lockOb || !frames.get(ob.O.id).visible) continue;
      const w = worldPos(ob.node);
      let dir;
      const p = project(w, view, viewBox);
      if (p) {
        if (p.x >= viewBox.x && p.x <= viewBox.x + viewBox.width && p.y >= viewBox.y && p.y <= viewBox.y + viewBox.height) continue;
        dir = Math.atan2(p.y - cy, p.x - cx);
      } else {
        const d = [w[0] - view.eye[0], w[1] - view.eye[1], w[2] - view.eye[2]];
        const rx = d[0] * view.right[0] + d[1] * view.right[1] + d[2] * view.right[2];
        const uy = d[0] * view.up[0] + d[1] * view.up[1] + d[2] * view.up[2];
        dir = Math.atan2(-uy, rx);
      }
      const pad = 18, hw = viewBox.width / 2 - pad, hh = viewBox.height / 2 - pad;
      const k = Math.min(hw / Math.abs(Math.cos(dir) || 1e-9), hh / Math.abs(Math.sin(dir) || 1e-9));
      const ax = cx + Math.cos(dir) * k, ay = cy + Math.sin(dir) * k;
      ctx.save();
      ctx.translate(ax, ay);
      ctx.rotate(dir);
      ctx.fillStyle = css(ob.color);
      ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(-6, -6); ctx.lineTo(-3, 0); ctx.lineTo(-6, 6); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }

  function updateHandles(scope) {
    for (const hnd of handles) {
      const target = byId.get(hnd.targetId);
      const mesh = target && target.mesh;
      if (!mesh || !target.node.visible) { hnd.mesh.visible = false; hnd.world = null; continue; }
      const lat = scope.get(`${hnd.name}.lat`), lon = scope.get(`${hnd.name}.lon`);
      const local = latLonToPoint(lat, lon, 1);
      const w = mesh.localToWorld(new Vector3(local[0], local[1], local[2]));
      const c = new Vector3().setFromMatrixPosition(mesh.matrixWorld);
      const n = w.clone().sub(c).normalize();
      const p = project([w.x, w.y, w.z], view, viewBox);
      const size = p ? HANDLE_PX / pxPerWorld(p.depth, viewBox.height) : 0.01;
      const dragging = scope.get(`${hnd.name}.dragging`) === 1;
      hnd.mesh.scale.setScalar(size * (dragging ? 1.4 : 1));
      hnd.mesh.position.copy(w).addScaledVector(n, size * 0.6);
      const cp = project([c.x, c.y, c.z], view, viewBox);
      hnd.behind = !!(p && cp && p.depth > cp.depth + size); // on the far side: the sphere hides it
      hnd.mesh.visible = !hnd.behind;
      hnd.world = p;
    }
  }

  function hitDrag(p, coarse) {
    for (const hnd of handles) {
      if (!hnd.world || hnd.behind) continue;
      if (Math.hypot(p.x - hnd.world.x, p.y - hnd.world.y) <= (hnd.control.hit ?? (coarse ? 30 : 22))) return hnd.name;
    }
    return null;
  }

  // A pointer position -> [lat, lon] on the handle's target: the ray's hit
  // on the sphere, or the silhouette point nearest the ray once it slides off.
  const raycaster = new Raycaster();
  function dragValue(name, p) {
    const hnd = handles.find((x) => x.name === name);
    const target = hnd && byId.get(hnd.targetId);
    if (!target || !target.mesh) return null;
    const ndc = new Vector2(((p.x - viewBox.x) / viewBox.width) * 2 - 1, -(((p.y - viewBox.y) / viewBox.height) * 2 - 1));
    raycaster.setFromCamera(ndc, camera);
    const mesh = target.mesh;
    let point;
    if (target.O.kind === 'globe' || target.O.kind === 'sphere') {
      const c = new Vector3().setFromMatrixPosition(mesh.matrixWorld);
      const r = new Vector3().setFromMatrixScale(mesh.matrixWorld).x;
      const o = raycaster.ray.origin, d = raycaster.ray.direction;
      point = rayToSphere([o.x, o.y, o.z], [d.x, d.y, d.z], [c.x, c.y, c.z], r).point;
    } else {
      const hit = raycaster.intersectObject(mesh, false)[0];
      if (!hit) return null;
      point = [hit.point.x, hit.point.y, hit.point.z];
    }
    const local = mesh.worldToLocal(new Vector3(point[0], point[1], point[2]));
    return clampLatLon(pointToLatLon([local.x, local.y, local.z]));
  }

  function highlightObject(id, on) {
    const ob = byId.get(id);
    if (!ob) return false;
    ob.O.highlight = on;
    for (const m of ob.mats) {
      if (m.userData.lut || m.colorWrite === false) continue;
      if (!m.userData.base) m.userData.base = m.color.clone();
      if (on) { m.color.copy(m.userData.base).lerp(new Color(0xffffff), 0.35); if (m.emissive) m.emissive.copy(m.userData.base).multiplyScalar(0.3); }
      else { m.color.copy(m.userData.base); if (m.emissive) m.emissive.setRGB(0, 0, 0); }
    }
    return true;
  }

  function retheme() {
    for (const ob of objects) { if (ob.retheme) ob.retheme(); for (const m of ob.mats) delete m.userData.base; }
    for (const hnd of handles) hnd.mat.color.copy(colorOf(hnd.control.token));
  }

  function dispose() {
    disposed = true;
    stopMomentum();
    detachPointer();
    for (const ob of objects) {
      if (ob.dispose) ob.dispose();
      ob.node.traverse((n) => { if (n.geometry && !disposables.includes(n.geometry)) n.geometry.dispose(); });
      for (const m of ob.mats) { for (const k of ['map']) if (m[k]) m[k].dispose(); if (m.uniforms) for (const u of Object.values(m.uniforms)) if (u.value && u.value.dispose) u.value.dispose(); m.dispose(); }
    }
    for (const hnd of handles) hnd.mat.dispose();
    for (const g of disposables) g.dispose();
    renderer.dispose();
    if (renderer.forceContextLoss) renderer.forceContextLoss();
    overlay.remove();
    labelBox.remove();
    canvas.classList.remove('x-can-turn');
  }

  return {
    kind: 'scene3d',
    layers: scene2d.layers, readouts, objects: byId,
    get view() { return null; },
    layout, draw, hitDrag, dragValue, highlightObject, retheme, dispose,
    toWorld() { return [0, 0]; },
    readoutText() { return readouts.map((R) => R.last).filter(Boolean).join(' · '); },
    objectToken(id) { const ob = byId.get(id); return ob ? ob.color : null; },
    hasObject(id) { return byId.has(id) || labels.some((L) => L.id === id); },
    getCamera() { return { ...pose }; },
    setCamera(partial) { stopMomentum(); pose = clampPose({ ...pose, ...partial }, camSpec); env.requestDraw(); },
    // from/to pairs for the Figure's eased goto: azimuth takes the short way round
    cameraTargets(cam) {
      const from = {}, to = {};
      for (const k of ['azimuth', 'polar', 'distance']) {
        if (!(k in cam)) continue;
        from[`@camera.${k}`] = pose[k];
        to[`@camera.${k}`] = k === 'azimuth' ? nearestAzimuth(pose.azimuth, cam.azimuth) : cam[k];
      }
      return { from, to };
    },
  };
}

function mapValues(obj, fn) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = fn(v);
  return out;
}
