// lib/site/tabs.js — <div class="x-tabs" id="<slug>"> holding <section
// data-tab="Label" id="<slug>-<n>"> panels. Without the runtime the sections
// stack and the stylesheet prints each label from data-tab as a heading. The
// runtime adds a tablist (WAI-ARIA tabs: automatic activation, ← → Home End),
// shows one panel at a time with the `hidden` attribute, remembers a reader's
// choice in the hash as <slug>=<n> beside any figure pair, and switches to the
// panel that holds an in-page target before the page scrolls to it
// (revealPanel, called by reveal.js). A hidden panel has no layout, so its
// figures' IntersectionObserver never fires until the panel shows.
import { h } from './dom.js';
import { pairOf, withPair } from '../core/deeplink.js';

const panelGroup = new WeakMap(); // section -> group

// The tab index an arrow/Home/End key moves to; -1 for any other key.
export function tabKeyIndex(key, current, count) {
  switch (key) {
    case 'ArrowRight': case 'ArrowDown': return (current + 1) % count;
    case 'ArrowLeft': case 'ArrowUp': return (current - 1 + count) % count;
    case 'Home': return 0;
    case 'End': return count - 1;
    default: return -1;
  }
}

// The 0-based tab a hash asks for (<slug>=<n>, 1-based, in range), else the first.
export function tabFromHash(hash, id, count) {
  const v = pairOf(hash, id);
  const n = v && /^\d+$/.test(v) ? Number(v) : 0;
  return n >= 1 && n <= count ? n - 1 : 0;
}

export function mountTabs(doc, win) {
  const groups = new Map();
  for (const root of doc.querySelectorAll('.x-tabs')) {
    const panels = [...root.children].filter((c) => c.tagName === 'SECTION' && c.hasAttribute('data-tab'));
    if (!root.id || !panels.length || root.hasAttribute('data-booted')) continue;
    const group = { id: root.id, root, panels, tabs: [], current: -1 };
    const list = h('div', { class: 'x-tablist', role: 'tablist', 'aria-label': root.getAttribute('aria-label') });
    panels.forEach((p, i) => {
      if (!p.id) p.id = `${root.id}-${i + 1}`;
      const tab = h('button', { type: 'button', class: 'x-tab', role: 'tab', id: `${p.id}-tab`, 'aria-controls': p.id, 'aria-selected': 'false', tabindex: '-1' }, p.dataset.tab);
      p.setAttribute('role', 'tabpanel');
      p.setAttribute('aria-labelledby', tab.id);
      p.tabIndex = 0;
      list.append(tab);
      group.tabs.push(tab);
      panelGroup.set(p, group);
    });
    group.select = (i, { write = false, focus = false } = {}) => {
      if (i < 0 || i >= panels.length) return false;
      const changed = i !== group.current;
      group.current = i;
      panels.forEach((p, k) => { p.hidden = k !== i; });
      group.tabs.forEach((t, k) => { t.setAttribute('aria-selected', String(k === i)); t.tabIndex = k === i ? 0 : -1; });
      if (focus) group.tabs[i].focus();
      if (write && win.history && win.history.replaceState) win.history.replaceState(null, '', withPair(win.location.hash, root.id, String(i + 1)));
      return changed;
    };
    list.addEventListener('click', (e) => {
      const tab = e.target.closest && e.target.closest('[role="tab"]');
      if (tab) group.select(group.tabs.indexOf(tab), { write: true });
    });
    list.addEventListener('keydown', (e) => {
      const next = tabKeyIndex(e.key, group.current, panels.length);
      if (next < 0) return;
      e.preventDefault();
      group.select(next, { write: true, focus: true });
    });
    root.prepend(list);
    root.dataset.booted = '';
    group.select(tabFromHash(win.location.hash, root.id, panels.length));
    groups.set(root.id, group);
  }
  return {
    groups,
    // a <slug>=<n> pair from a hash or a link: true when it names a group
    fromHash(key, value) {
      const g = groups.get(key);
      if (!g) return false;
      g.select(tabFromHash(`#${key}=${value}`, key, g.panels.length));
      return true;
    },
  };
}

// Show the panel holding `section` (a tab panel); true when the group switched.
export function revealPanel(section) {
  const g = panelGroup.get(section);
  if (!g) return false;
  return g.select(g.panels.indexOf(section));
}
