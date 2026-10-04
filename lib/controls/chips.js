// lib/controls/chips.js — a multi-select row of CHIPS: one aria-pressed
// button per option in a group that scrolls sideways inside the panel (a
// segmented row with many options would spill past the reading column).
// Pressing a chip toggles it, within the control's min/max (a refusal is a
// brief shake, never a dialog). Keyboard: ← → move focus between chips and
// scroll the focused one into view (wrapping at the ends), Home/End jump,
// Space/Enter toggle (a button's own keys). One chip is tabbable at a time
// (roving tabindex) so Tab passes through the control in one stop. The
// scope holds <name>.<key> = 0|1 and <name>.count; every change goes through
// fig.set(name, [keys]) so readouts, layers and the stepper agree.
import { h } from '../site/dom.js';
import { chipsSelected } from '../core/state.js';

export function mountChips(fig, control, i) {
  const lo = control.min ?? 1, hi = control.max ?? control.options.length;
  const row = h('div', { class: 'x-chips', role: 'group', 'aria-label': control.name });
  const chips = control.options.map((o, k) => h('button', { class: 'x-chip', type: 'button', value: o.key, 'aria-pressed': 'false', tabindex: k ? '-1' : '0' }, o.label));
  row.append(...chips);
  const wrap = h('div', { class: 'x-ctl x-ctl-chips', id: `${fig.id}_ch${i}` }, row);
  wrap.style.setProperty('--token', `var(--c-${control.token})`);

  const rove = (k) => chips.forEach((b, j) => b.setAttribute('tabindex', j === k ? '0' : '-1'));
  row.addEventListener('click', (e) => {
    const b = e.target.closest('.x-chip');
    if (!b) return;
    const cur = chipsSelected(control, fig.scope), on = cur.includes(b.value);
    if (on ? cur.length <= lo : cur.length >= hi) {
      b.classList.remove('x-shake');
      void b.offsetWidth;
      b.classList.add('x-shake');
      return;
    }
    fig.set(control.name, on ? cur.filter((k) => k !== b.value) : [...cur, b.value], 'user');
  });
  row.addEventListener('keydown', (e) => {
    const at = chips.indexOf(e.target), n = chips.length;
    const to = { ArrowRight: at + 1, ArrowLeft: at - 1 + n, Home: 0, End: n - 1 }[e.key];
    if (at < 0 || to === undefined || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault();
    const b = chips[to % n];
    rove(to % n);
    b.focus({ preventScroll: true });
    b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });

  // a fade per edge while more hides behind it
  const edges = () => {
    row.classList.toggle('x-more-left', row.scrollLeft > 1);
    row.classList.toggle('x-more-right', row.scrollLeft < row.scrollWidth - row.clientWidth - 1);
  };
  row.addEventListener('scroll', edges, { passive: true });
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(edges).observe(row);

  return {
    el: wrap, name: control.name,
    sync(scope) {
      control.options.forEach((o, k) => chips[k].setAttribute('aria-pressed', String(scope.get(`${control.name}.${o.key}`) === 1)));
      edges();
    },
  };
}
