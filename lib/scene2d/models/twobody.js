// lib/scene2d/models/twobody.js — two bodies under mutual gravity (G = 1),
// center of mass at the origin. At t = 0 the separation r0 lies along +x and
// the relative velocity v0 along +y, so r0 is an apsis of the relative orbit.
import { solveKepler } from './kepler.js';

export function twobody({ m1, m2, r0, v0, t }) {
  const mu = m1 + m2;
  const energy = (v0 * v0) / 2 - mu / r0;
  const rel = energy < 0 ? boundOrbit(mu, r0, v0, t) : leapfrog(mu, r0, v0, t);
  const f1 = -m2 / mu, f2 = m1 / mu;
  return {
    x1: rel.x * f1, y1: rel.y * f1, x2: rel.x * f2, y2: rel.y * f2,
    vx1: rel.vx * f1, vy1: rel.vy * f1, vx2: rel.vx * f2, vy2: rel.vy * f2,
  };
}

function boundOrbit(mu, r0, v0, t) {
  const h = r0 * v0;
  const a = -mu / (2 * ((v0 * v0) / 2 - mu / r0));
  const e = Math.sqrt(Math.max(0, 1 - (h * h) / (mu * a)));
  const atPeri = Math.abs(r0 - a * (1 - e)) <= Math.abs(r0 - a * (1 + e));
  const n = Math.sqrt(mu / (a * a * a));
  const M = (atPeri ? 0 : Math.PI) + n * t;
  const E = solveKepler(((M % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), e);
  const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
  const r = a * (1 - e * Math.cos(E));
  const p = a * (1 - e * e);
  const vr = Math.sqrt(mu / p) * e * Math.sin(nu), vt = Math.sqrt(mu / p) * (1 + e * Math.cos(nu));
  const rot = atPeri ? 0 : Math.PI; // the start point sits on +x
  const ang = nu - rot;
  const c = Math.cos(ang), s = Math.sin(ang);
  return { x: r * c, y: r * s, vx: vr * c - vt * s, vy: vr * s + vt * c };
}

// Unbound (parabolic/hyperbolic) starts: integrate. Steps are bounded so a
// far-future t costs a fixed amount.
function leapfrog(mu, r0, v0, t) {
  const steps = Math.min(4000, Math.max(1, Math.ceil(Math.abs(t) * 200)));
  const dt = t / steps;
  let x = r0, y = 0, vx = 0, vy = v0;
  const acc = (px, py) => { const d = Math.hypot(px, py) || 1e-9; const k = -mu / (d * d * d); return [k * px, k * py]; };
  let [ax, ay] = acc(x, y);
  for (let i = 0; i < steps; i++) {
    vx += ax * dt / 2; vy += ay * dt / 2;
    x += vx * dt; y += vy * dt;
    [ax, ay] = acc(x, y);
    vx += ax * dt / 2; vy += ay * dt / 2;
  }
  return { x, y, vx, vy };
}
