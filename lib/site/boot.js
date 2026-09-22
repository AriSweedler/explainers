// lib/site/boot.js — entry. Finds every figure, validates its spec with the
// same validateSpec the CLI runs, scaffolds it (so the page never shifts),
// mounts it on approach, and wires the page-level hooks.
import { validateSpec, FigSpecError } from '../spec.js';
import { createClock } from '../core/clock.js';
import { resolveTokens, onSchemeChange, prefersReducedMotion, hoverCapable, coarsePointer } from '../core/tokens.js';
import { observe } from '../core/visibility.js';
import { dprFor } from '../core/layout.js';
import { parseHash } from '../core/deeplink.js';
import { createFigure } from './figure.js';
import { mountTerms } from './term.js';
import { mountGlossary } from './glossary.js';
import { mountProseHooks, colorTex } from './hooks.js';
import { h } from './dom.js';

export const VERSION = '1.0.0';
const UI_FONT = '"Source Sans 3", system-ui, -apple-system, "Segoe UI", sans-serif';
const TOKEN_RE = /--c-([a-zA-Z][\w-]*)\s*:/g;

export function paletteNames(doc) {
  const names = new Set();
  for (const style of doc.querySelectorAll('style')) for (const m of style.textContent.matchAll(TOKEN_RE)) names.add(m[1]);
  return [...names];
}

function compileFigure(el, names) {
  const script = el.querySelector(':scope > script[type="application/json"]');
  if (!script) return null;
  try {
    return validateSpec(JSON.parse(script.textContent), { figureId: el.id, palette: names });
  } catch (e) {
    const code = e instanceof FigSpecError ? e.code : 'SPEC_JSON';
    const detail = e instanceof FigSpecError ? `${e.path}: ${e.detail}` : e.message;
    script.after(h('p', { class: 'x-fig-error' }, `${code} ${detail}`));
    return null;
  }
}

export function boot(win = window) {
  const doc = win.document;
  const names = paletteNames(doc);
  const tokens = resolveTokens(names, doc);
  const clock = createClock();
  clock.start();
  const env = {
    tokens, clock, dpr: dprFor(win), font: UI_FONT,
    reduced: prefersReducedMotion(win), coarse: coarsePointer(win),
    fmt: { imperial: doc.body.classList.contains('x-imperial') },
    pausedAll: () => doc.documentElement.classList.contains('x-paused'),
  };

  const figures = new Map();
  for (const el of doc.querySelectorAll('figure.x-fig')) {
    if (!el.id || el.hasAttribute('data-static') || el.hasAttribute('data-booted')) continue;
    const compiled = compileFigure(el, names);
    if (!compiled) continue;
    const fig = createFigure(el, compiled, env);
    figures.set(el.id, fig);
    observe(el, { rootMargin: compiled.type === 'scene3d' ? '400px' : '100px', onEnter: () => fig.setVisible(true), onLeave: () => fig.setVisible(false) });
  }

  mountProseHooks(doc, figures, { clock });
  mountTerms(doc, { hover: hoverCapable(win) });
  mountGlossary(doc, win);
  colorTex(doc, names);

  // #fig-x=state: boot that figure eagerly, land on the state without easing
  const route = () => {
    const link = parseHash(win.location.hash);
    const fig = link && figures.get(link.figId);
    if (!fig) return;
    fig.setVisible(true);
    if (link.state && fig.compiled.states.includes(link.state)) fig.goto(link.state, { ease: false });
    fig.el.scrollIntoView({ block: 'start' });
  };
  route();
  win.addEventListener('hashchange', route);

  onSchemeChange(() => {
    const fresh = resolveTokens(names, doc);
    tokens.clear();
    for (const [k, v] of fresh) tokens.set(k, v);
    for (const fig of figures.values()) fig.retheme();
  }, win);
  if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(() => { for (const fig of figures.values()) fig.draw(); });

  win.explainers = {
    version: VERSION, figures,
    goto(figId, state) { const fig = figures.get(figId); if (fig) fig.goto(state); },
    pauseAll(flag) { doc.documentElement.classList.toggle('x-paused', !!flag); clock.pause(!!flag); },
  };
  return win.explainers;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => boot());
  else boot();
}
