// lib/site/reveal.js — an in-page target may sit inside a closed <details>
// (the glossary, a timeline entry) or inside a tab panel that is not shown.
// revealTarget opens or selects every such ancestor so the target has a
// layout box before anything scrolls to it: on a click on <a href="#…"> the
// browser scrolls after this handler runs (the glossary has always relied on
// that); on load and hashchange boot.js reveals and then scrolls itself,
// since the browser gave up on a target without a box. Figures inside follow
// by themselves: once the panel or body is displayed, their
// IntersectionObserver fires and the figure mounts at its real width.
import { revealPanel } from './tabs.js';
import { parsePairs, parseHash, plainTarget } from '../core/deeplink.js';

export function revealTarget(el) {
  let changed = false;
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    if (n.tagName === 'DETAILS' && !n.open) { n.open = true; changed = true; }
    if (n.hasAttribute('data-tab') && revealPanel(n)) changed = true;
  }
  return changed;
}

// The element a hash lands on: its plain id, or the figure of its fig- pair.
export function hashTarget(doc, hash) {
  const id = plainTarget(hash);
  if (id) return doc.getElementById(id);
  const link = parseHash(hash);
  return link ? doc.getElementById(link.figId) : null;
}

export function mountReveal(doc, tabs) {
  doc.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a) return;
    const hash = a.getAttribute('href');
    for (const [k, v] of parsePairs(hash)) tabs.fromHash(k, v); // a link to a tab, or to a figure pose in one
    const el = hashTarget(doc, hash);
    if (el) revealTarget(el);
  });
}
