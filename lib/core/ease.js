// lib/core/ease.js — the one easing the runtime uses (goto, fades).
// Durations are seconds; a transition is stepped by the figure's tick so a
// fake clock drives it deterministically in tests.

export function smoothstep(t) {
  const k = Math.min(Math.max(t, 0), 1);
  return k * k * (3 - 2 * k);
}

export const EASE_SECONDS = 0.6;

// from/to: plain objects name -> value. Numeric keys ease; keys in `discrete`
// (and non-numeric values) snap at the midpoint. The last step lands exactly
// on `to`. reduced (prefers-reduced-motion) makes the first step finish.
export function transition({ from, to, seconds = EASE_SECONDS, reduced = false, discrete = new Set(), onStep, onDone }) {
  const dur = reduced ? 0 : seconds;
  const keys = Object.keys(to);
  let elapsed = 0, done = false;

  function valueAt(key, k) {
    const a = from[key], b = to[key];
    if (k >= 1) return b;
    if (discrete.has(key) || typeof a !== 'number' || typeof b !== 'number') return k >= 0.5 ? b : a;
    return a + (b - a) * smoothstep(k);
  }

  return {
    step(dt) {
      if (done) return;
      elapsed += dt;
      const k = dur === 0 ? 1 : Math.min(elapsed / dur, 1);
      const out = {};
      for (const key of keys) out[key] = valueAt(key, k);
      onStep(out, k);
      if (k >= 1) { done = true; if (onDone) onDone(); }
    },
    cancel() { done = true; },
    get done() { return done; },
  };
}
