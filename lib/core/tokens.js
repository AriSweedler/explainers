// lib/core/tokens.js — palette tokens as canvas colors.
// getComputedStyle(root).getPropertyValue('--c-x') returns the literal
// "light-dark(#a, #b)" (custom properties are not resolved), which Canvas 2D
// cannot parse; a probe element's computed `color` gives the resolved rgb().

export function resolveTokens(names, doc = document) {
  const out = new Map();
  const probe = doc.createElement('span');
  probe.style.cssText = 'position:absolute;left:-9999px;visibility:hidden;pointer-events:none';
  (doc.body || doc.documentElement).appendChild(probe);
  const read = (prop) => {
    probe.style.color = `var(${prop})`;
    return doc.defaultView.getComputedStyle(probe).color || 'currentColor';
  };
  for (const n of names) out.set(n, read(`--c-${n}`));
  out.set('--bg', read('--bg'));
  out.set('--fg', read('--fg'));
  probe.remove();
  return out;
}

export function onSchemeChange(fn, win = window) {
  if (!win.matchMedia) return () => {};
  const mq = win.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', fn);
  return () => mq.removeEventListener('change', fn);
}

export function prefersReducedMotion(win = window) {
  return !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

export function hoverCapable(win = window) {
  return !!(win.matchMedia && win.matchMedia('(hover: hover)').matches);
}

export function coarsePointer(win = window) {
  return !!(win.matchMedia && win.matchMedia('(pointer: coarse)').matches);
}

// "rgb(r, g, b)" -> "rgba(r, g, b, a)" for grid lines and halos. Anything else
// is returned unchanged (the caller can fall back to globalAlpha).
export function withAlpha(color, alpha) {
  const m = /^rgba?\(([^)]+)\)$/.exec(color || '');
  if (!m) return color;
  const parts = m[1].split(/[\s,\/]+/).filter(Boolean).slice(0, 3);
  return `rgba(${parts.join(', ')}, ${alpha})`;
}
