// lib/scene2d/models/lunar.js — low-precision Moon and Sun positions
// (Montenbruck & Pfleger style truncated series). Good to about half a degree,
// which is what a figure needs. Angles in radians, distance in km.
const RAD = Math.PI / 180;
const TAU3 = 2 * Math.PI;
const norm = (x) => x - TAU3 * Math.floor(x / TAU3);

export function lunar({ t }) {
  const L0 = (218.316 + 13.176396 * t) * RAD;   // Moon mean longitude
  const l = (134.963 + 13.064993 * t) * RAD;    // Moon mean anomaly
  const F = (93.272 + 13.229350 * t) * RAD;     // argument of latitude
  const g = (357.528 + 0.9856003 * t) * RAD;    // Sun mean anomaly
  const q = (280.460 + 0.9856474 * t) * RAD;    // Sun mean longitude
  const sun_lon = norm(q + (1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD);
  const D = L0 - sun_lon;                        // mean elongation
  const lon = norm(L0 + (6.289 * Math.sin(l) - 1.274 * Math.sin(l - 2 * D) + 0.658 * Math.sin(2 * D) - 0.214 * Math.sin(2 * l)) * RAD);
  const lat = (5.128 * Math.sin(F) + 0.281 * Math.sin(l + F) - 0.278 * Math.sin(l - F)) * RAD;
  const dist = 385001 - 20905 * Math.cos(l) - 3699 * Math.cos(2 * D - l) - 2956 * Math.cos(2 * D);
  const phase = norm(lon - sun_lon) / TAU3;      // 0 new, 0.5 full
  return { lon, lat, dist, phase, sun_lon };
}
