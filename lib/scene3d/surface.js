// lib/scene3d/surface.js — a drag handle on a sphere's surface. The value a
// `surface:<objectId>` drag exposes is [lat, lon] in DEGREES (the one place
// the vocabulary is not radians: the design's own example is [37.7, -122.4]
// and navigator.geolocation answers in degrees; expressions convert with
// rad()). lon 0 is the +x axis and lon 90 (east) the -z axis in the object's
// local frame, which is where three's SphereGeometry puts the center and the
// right-hand side of an equirectangular texture, so a globe's meridians and
// its texture agree. Shared by the runtime (figure.set clamps through it),
// the lazy chunk and lib/poster-svg.js.

const D2R = Math.PI / 180, R2D = 180 / Math.PI;

export function clampLatLon([lat, lon]) {
  const la = Math.min(Math.max(Number(lat) || 0, -90), 90);
  let lo = Number(lon) || 0;
  lo = ((((lo + 180) % 360) + 360) % 360) - 180; // (-180, 180]
  if (lo === -180) lo = 180;
  return [la, lo];
}

// Local point on a sphere of radius r.
export function latLonToPoint(lat, lon, r = 1) {
  const la = lat * D2R, lo = lon * D2R, c = Math.cos(la);
  return [r * c * Math.cos(lo), r * Math.sin(la), -r * c * Math.sin(lo)];
}

// Inverse: any local point (not necessarily on the surface) -> [lat, lon].
export function pointToLatLon([x, y, z]) {
  const r = Math.hypot(x, y, z) || 1;
  return clampLatLon([Math.asin(Math.min(Math.max(y / r, -1), 1)) * R2D, Math.atan2(-z, x) * R2D]);
}

// Where a ray (origin, unit dir) meets a sphere; when it misses, the point
// on the sphere nearest to the ray (the silhouette a pointer slid off).
export function rayToSphere(origin, dir, center, r) {
  const oc = [origin[0] - center[0], origin[1] - center[1], origin[2] - center[2]];
  const b = oc[0] * dir[0] + oc[1] * dir[1] + oc[2] * dir[2];
  const c = oc[0] * oc[0] + oc[1] * oc[1] + oc[2] * oc[2] - r * r;
  const disc = b * b - c;
  if (disc >= 0) {
    const s = Math.sqrt(disc);
    const t = -b - s >= 0 ? -b - s : -b + s; // the near face, or the far one from inside
    if (t >= 0) return { hit: true, point: [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t] };
  }
  const t = Math.max(-b, 0); // closest approach
  const q = [oc[0] + dir[0] * t, oc[1] + dir[1] * t, oc[2] + dir[2] * t];
  const l = Math.hypot(q[0], q[1], q[2]) || 1;
  return { hit: false, point: [center[0] + (q[0] / l) * r, center[1] + (q[1] / l) * r, center[2] + (q[2] / l) * r] };
}
