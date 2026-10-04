// lib/site/glossary.js — <details id=glossary> opens BEFORE the browser
// scrolls to a #g-* row (auto-expansion on fragment navigation is
// Chromium-only), then the row flashes. Back-links flash the first use, after
// revealing the tab panel or <details> it sits in (reveal.js).
import { glossaryTarget } from '../core/deeplink.js';
import { revealTarget } from './reveal.js';

const FLASH_MS = 1600;

export function mountGlossary(doc, win) {
  let timer = null;
  function flash(el) {
    el.classList.remove('x-flash');
    void el.offsetWidth; // restart the animation
    el.classList.add('x-flash');
    clearTimeout(timer);
    timer = setTimeout(() => el.classList.remove('x-flash'), FLASH_MS);
  }
  function reveal(target, scroll) {
    const el = doc.getElementById(target.id);
    if (!el) return;
    revealTarget(el); // the glossary <details> for a row; a tab panel or timeline entry for a first use
    if (scroll) el.scrollIntoView({ block: 'center' });
    flash(el);
  }
  doc.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href^="#g-"], a[href^="#t-"]');
    if (!a) return;
    const t = glossaryTarget(a.getAttribute('href'));
    if (t) reveal(t, false); // the browser scrolls after this handler, to an open row
  });
  const onHash = () => { const t = glossaryTarget(win.location.hash); if (t) reveal(t, true); };
  win.addEventListener('hashchange', onHash);
  onHash();
}
