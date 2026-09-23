// lib/scene3d/camera.js — the pure camera math of a scene3d figure: the
// spherical pose (azimuth, polar, distance) every mode shares, its limits,
// the eye position, a look-at basis, perspective projection and the
// momentum decay. No three.js here: the lazy chunk, lib/poster-svg.js
// (the first frame, under Node) and the tests all use the same numbers.

export const FOV_DEG = 40;           // vertical field of view
export const NEAR = 0.01;
export const POLAR_EPS = 0.02;       // keep clear of the poles: the up vector would flip
export const DEFAULT_FRICTION = 0.92; // momentum decay per 60 Hz frame
export const TURN = Math.PI * 2;

const clampNum = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

// The initial pose from a shows.camera object.
export function initialPose(cam) {
  return clampPose({ azimuth: cam.azimuth, polar: cam.polar, distance: cam.distance }, cam);
}

// Mode limits: every mode keeps polar off the poles and distance positive;
// orbit also honors min/max polar and azimuth. Azimuth is otherwise free.
export function clampPose(pose, cam) {
  const out = { azimuth: pose.azimuth, polar: clampNum(pose.polar, POLAR_EPS, Math.PI - POLAR_EPS), distance: Math.max(pose.distance, NEAR * 10) };
  if (cam && cam.mode === 'orbit') {
    if (cam.minPolar !== undefined) out.polar = Math.max(out.polar, cam.minPolar);
    if (cam.maxPolar !== undefined) out.polar = Math.min(out.polar, cam.maxPolar);
    if (cam.minAzimuth !== undefined) out.azimuth = Math.max(out.azimuth, cam.minAzimuth);
    if (cam.maxAzimuth !== undefined) out.azimuth = Math.min(out.azimuth, cam.maxAzimuth);
  }
  return out;
}

// Eye position for a pose around a target (y up): polar is measured from +y
// (0 looks straight down the pole), azimuth around y from +z, like three's
// Spherical.
export function eyeFor({ azimuth, polar, distance }, target = [0, 0, 0]) {
  const s = Math.sin(polar);
  return [target[0] + distance * s * Math.sin(azimuth), target[1] + distance * Math.cos(polar), target[2] + distance * s * Math.cos(azimuth)];
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// A right-handed camera basis looking from eye at target: `back` points from
// the target to the eye (the camera looks along -back).
export function lookAt(eye, target, up = [0, 1, 0]) {
  const back = norm(sub(eye, target));
  let right = cross(up, back);
  if (Math.hypot(...right) < 1e-6) right = cross([0, 0, 1], back); // looking straight along up
  right = norm(right);
  return { eye, right, up: cross(back, right), back };
}

// Focal length in px for a viewport height.
export const focalPx = (height, fovDeg = FOV_DEG) => (height / 2) / Math.tan((fovDeg * Math.PI) / 360);

// Perspective projection of a world point into a viewport box {x, y, width,
// height} (CSS px, y down). depth is the distance along the view direction;
// a point at or behind the near plane yields null.
export function project(p, view, box, fovDeg = FOV_DEG) {
  const d = sub(p, view.eye);
  const depth = -dot(d, view.back);
  if (depth <= NEAR) return null;
  const f = focalPx(box.height, fovDeg);
  return { x: box.x + box.width / 2 + (dot(d, view.right) / depth) * f, y: box.y + box.height / 2 - (dot(d, view.up) / depth) * f, depth };
}

// Screen px per world unit at a depth.
export const pxPerWorld = (depth, height, fovDeg = FOV_DEG) => focalPx(height, fovDeg) / depth;

// The pixel a pointer drag moves through as a rotation: half the viewport
// width is half a turn, so a full-width drag spins the scene once around.
export const radPerPx = (width) => Math.PI / Math.max(width / 2, 1);

// Equivalent azimuth nearest to `from`, so an eased goto takes the short way.
export function nearestAzimuth(from, to) {
  let t = to;
  while (t - from > Math.PI) t -= TURN;
  while (t - from < -Math.PI) t += TURN;
  return t;
}

// Momentum after release: velocities (rad per frame) decay by friction per
// 60 Hz frame, so a long frame decays as many short ones would. Returns the
// displacement over dt seconds and the new velocity; below `stop` it is 0.
export function momentumStep(vel, dt, friction = DEFAULT_FRICTION, stop = 1e-4) {
  const frames = dt * 60;
  const k = Math.pow(friction, frames);
  // displacement of a geometric series over `frames` steps
  const move = friction === 1 ? vel * frames : vel * (1 - k) / (1 - friction);
  const next = vel * k;
  return { move, vel: Math.abs(next) < stop ? 0 : next };
}

// Euler XYZ rotation (three's default order): M = Rx * Ry * Rz.
export function rotateEuler(p, [a, b, c]) {
  let [x, y, z] = p;
  // Rz
  let cx = Math.cos(c), sx = Math.sin(c);
  [x, y] = [x * cx - y * sx, x * sx + y * cx];
  // Ry
  cx = Math.cos(b); sx = Math.sin(b);
  [x, z] = [x * cx + z * sx, -x * sx + z * cx];
  // Rx
  cx = Math.cos(a); sx = Math.sin(a);
  [y, z] = [y * cx - z * sx, y * sx + z * cx];
  return [x, y, z];
}

// Local point -> world for an object with position, Euler rotation and a
// uniform scale (the transform every 3D object has).
export function toWorld(p, { position = [0, 0, 0], rotation = [0, 0, 0], scale = 1 }) {
  const r = rotateEuler([p[0] * scale, p[1] * scale, p[2] * scale], rotation);
  return [r[0] + position[0], r[1] + position[1], r[2] + position[2]];
}

// A unit vector from 'x' | 'y' | 'z' or [nx, ny, nz].
export function axisVector(a) {
  if (a === 'x') return [1, 0, 0];
  if (a === 'y') return [0, 1, 0];
  if (a === 'z') return [0, 0, 1];
  return norm(a);
}
