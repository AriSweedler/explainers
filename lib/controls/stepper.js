// lib/controls/stepper.js — the STEPPER: a pure readout of the nearest STEP.
// Exactly on a step (clicked, dragged onto it, deep-linked) it shows that
// step's look and caption; between steps it marks the nearest step with an
// asterisk and the footnote. It owns the PANEL's click (ENTER) and keydown
// (← →) listeners. The words (row, paddle, counter, pill, face, near, armed,
// caption slot, footnote, announcer) are defined in DESIGN.md "Stepper anatomy".
import { h } from '../site/dom.js';
import { nearestState } from '../core/state.js';

const PILL_MAX = 5;
const FOOTNOTE = '* between steps: stepping lands here or beyond';

export function mountStepper(fig, notice, panel) {
  const states = notice.states, n = states.length, pill = n <= PILL_MAX, cap = `${fig.id}_steps_cap`;
  const labels = states.map((s) => s.label ?? s.name.replace(/-/g, ' '));
  const prev = h('button', { class: 'x-prev', type: 'button', 'aria-label': 'previous step' }, '‹');
  const next = h('button', { class: 'x-next', type: 'button', 'aria-label': 'next step' }, '›');
  const counter = h('span', { class: 'x-counter' });
  const segs = states.map((s, k) => h('button', { type: 'button', value: s.name }, labels[k]));
  const row = h('div', { class: `x-stepper-row${pill ? ' x-steps-seg' : ''}`, role: 'group', 'aria-label': 'Steps', 'aria-describedby': cap }, ...(pill ? segs : [prev, counter, next]));
  const caption = h('p', { class: 'x-caption', id: cap });
  const sr = h('span', { class: 'x-sr', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const key = (t) => h('kbd', { class: 'x-key', 'aria-hidden': 'true' }, t);
  const wrap = h('div', { class: 'x-stepper', id: `${fig.id}_steps`, tabindex: '-1' }, key('←'), row, key('→'), caption, sr);
  let at = null; // the last reading: { i, name, exact }

  const jump = (name) => { if (!(at.exact && name === at.name)) fig.goto(name, { ease: false }); };
  // on a step, the tour's neighbour; between steps, the nearest step that way by value
  const go = (d) => jump(at.exact ? states[Math.max(0, Math.min(n - 1, at.i + d))].name : nearestState(fig.compiled, fig.scope, 1e-6, d).name);

  // a control's click is its own; the rest of the panel is the stepper's (Safari never focuses a clicked button)
  panel.addEventListener('click', (e) => {
    if (e.target.closest('.x-ctl, .x-drag-proxy, a')) return;
    const b = e.target.closest('button');
    if (!b) jump(at.name); else if (b.value) jump(b.value); else go(b === prev ? -1 : 1);
    (b || wrap).focus({ preventScroll: true });
  });
  // a control whose arrows already walk its stops (.x-discrete, segmented) or nudge a handle (the drag proxy, which has claimed the key by now) keeps them
  panel.addEventListener('keydown', (e) => {
    const d = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    if (!d || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.target.closest('.x-discrete, .x-ctl-segmented')) return;
    e.preventDefault();
    go(d);
  });

  const sync = () => {
    const { i, name, exact } = nearestState(fig.compiled, fig.scope);
    if (at && at.i === i && at.exact === exact) return;
    at = { i, name, exact };
    const pos = `${i + 1} of ${n}`;
    wrap.dataset.face = exact ? 'stepped' : 'near';
    if (pill) segs.forEach((b, k) => (k === i ? b.setAttribute('aria-current', 'step') : b.removeAttribute('aria-current')));
    else {
      counter.textContent = `${pos} · ${labels[i]}${exact ? '' : ' *'}`;
      prev.setAttribute('aria-disabled', String(exact && i === 0));
      next.setAttribute('aria-disabled', String(exact && i === n - 1));
    }
    caption.textContent = exact ? states[i].caption : FOOTNOTE;
    sr.textContent = exact ? `Step ${pos}, ${labels[i]}. ${states[i].caption}` : '';
  };
  return { el: wrap, sync };
}
