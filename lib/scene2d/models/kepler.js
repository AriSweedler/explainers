// lib/scene2d/models/kepler.js — position on a Kepler ellipse.
// Focus at the origin, periapsis on +x. Outputs match MODELS.kepler.outputs.

export function solveKepler(M, e) {
  let E = e < 0.8 ? M : Math.PI;
  for (let i = 0; i < 30; i++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-12) break;
  }
  return E;
}

export function kepler({ a, e, M }) {
  const ecc = Math.min(Math.max(e, 0), 0.999999);
  const E = solveKepler(M, ecc);
  const nu = 2 * Math.atan2(Math.sqrt(1 + ecc) * Math.sin(E / 2), Math.sqrt(1 - ecc) * Math.cos(E / 2));
  const r = a * (1 - ecc * Math.cos(E));
  return { x: r * Math.cos(nu), y: r * Math.sin(nu), r, nu, E };
}
