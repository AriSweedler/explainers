// lib/site/term.js — one shared tooltip for glossary terms, filled from the
// row's <dd>. Hover/focus only on hover-capable devices; click always
// navigates (glossary.js opens the <details> first).
import { h } from './dom.js';

export function mountTerms(doc, { hover }) {
  const tip = h('div', { id: 'x-tip', role: 'tooltip', popover: 'hint' });
  doc.body.append(tip);
  const supportsPopover = 'showPopover' in tip;
  const hide = () => { if (supportsPopover) { try { tip.hidePopover(); } catch {} } else tip.hidden = true; };
  if (!supportsPopover) tip.hidden = true;
  if (!hover) return tip;

  function show(e) {
    const a = e.currentTarget;
    const row = doc.getElementById(a.getAttribute('href').slice(1));
    const dd = row && row.querySelector('dd');
    if (!dd) return;
    tip.textContent = dd.textContent.trim();
    if (supportsPopover) { try { tip.showPopover(); } catch {} } else tip.hidden = false;
    const r = a.getBoundingClientRect(), w = tip.offsetWidth, vw = doc.documentElement.clientWidth;
    const left = Math.max(8, Math.min(r.left, vw - w - 8));
    const below = r.bottom + 8 + tip.offsetHeight < doc.documentElement.clientHeight;
    tip.style.left = `${left}px`;
    tip.style.top = `${below ? r.bottom + 8 : r.top - tip.offsetHeight - 8}px`;
  }
  for (const a of doc.querySelectorAll('a.term[href^="#g-"], dfn > a[href^="#g-"]')) {
    a.addEventListener('pointerenter', show);
    a.addEventListener('pointerleave', hide);
    a.addEventListener('focus', show);
    a.addEventListener('blur', hide);
  }
  doc.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
  doc.addEventListener('scroll', hide, { passive: true });
  return tip;
}
