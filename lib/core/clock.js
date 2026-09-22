// lib/core/clock.js — the single rAF loop every figure ticks from.
// dt is seconds, clamped to maxDt so a background tab does not jump a
// simulation forward on return. `now` and `schedule` are injectable so tests
// run the loop by hand.

export function createClock({ now = () => performance.now(), schedule = (fn) => requestAnimationFrame(fn), maxDt = 0.1 } = {}) {
  const subs = new Set();
  let running = false, paused = false, queued = false, last = null;

  function frame() {
    queued = false;
    if (!running || paused || subs.size === 0) { last = null; return; }
    const t = now();
    const dt = last === null ? 0 : Math.min(Math.max(t - last, 0) / 1000, maxDt);
    last = t;
    for (const fn of [...subs]) fn(dt);
    queue();
  }

  function queue() {
    if (queued || !running || paused || subs.size === 0) return;
    queued = true;
    schedule(frame);
  }

  return {
    onTick(fn) { subs.add(fn); queue(); return () => { subs.delete(fn); }; },
    start() { running = true; queue(); },
    stop() { running = false; last = null; },
    pause(flag) { paused = !!flag; if (paused) last = null; else queue(); },
    get active() { return running && !paused && subs.size > 0; },
    get subscribers() { return subs.size; },
  };
}
