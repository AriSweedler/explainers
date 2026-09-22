// lib/core/visibility.js — mount/tick only what is near the viewport.

export function observe(el, { rootMargin = '100px', onEnter, onLeave }) {
  if (typeof IntersectionObserver === 'undefined') { onEnter(); return () => {}; }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) (e.isIntersecting ? onEnter : onLeave)();
  }, { rootMargin });
  io.observe(el);
  return () => io.disconnect();
}
