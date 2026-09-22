// lib/scene2d/models/cam.js — valve lift for a cosine cam lobe centered on
// theta = 0 and spanning `span` radians; velocity is d(lift)/d(theta).
const TAU2 = 2 * Math.PI;

export function cam({ theta, lift, span }) {
  const th = theta - TAU2 * Math.floor((theta + Math.PI) / TAU2); // fold into [-pi, pi)
  const half = span / 2;
  if (Math.abs(th) >= half || span <= 0) return { lift: 0, velocity: 0 };
  const phase = (Math.PI * th) / half;
  return { lift: (lift * (1 + Math.cos(phase))) / 2, velocity: (-lift * Math.PI * Math.sin(phase)) / (2 * half) };
}
