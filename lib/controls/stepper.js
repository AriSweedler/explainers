// lib/controls/stepper.js — the STEPPER under a figure's controls.
// Stepper anatomy (DESIGN.md "Stepper anatomy"; use these words everywhere):
//   step       one of the N named states as the reader meets it ("2 of 3")
//   row        the one-line strip; carries the FACE (data-face = free | stepped)
//   paddle     the ‹ › buttons that move one step (never "arrow")
//   latch      the center button: free face = hollow PIP + INVITATION
//              ("Step through 3 steps"); stepped face = filled pip + COUNTER
//              ("2 of 3 · quarter"); press = step in / step off
//   pill       the radio-row form used for five steps or fewer; the same pip,
//              caption and announcer; a radio is a step
//   panel      the region under the canvas (controls, stepper, captions); it
//              tints on hover and a click on its background or a caption steps in
//   glow       the ARMED indicator and the only one: a breathing accent border
//              around the whole row; a shadow, so the footprint never changes
//   key hints  the ← → <kbd> at the panel's far edges while the row is ARMED
//   caption    the step's sentence under the row; its slot keeps one line
//   announcer  hidden live text that speaks a step change
// Modes: FREE (system-controlled: the figure follows its controls, Play or its
// defaults; the figure always boots free) and STEPPED (human-controlled: held
// at a step). STEP IN = free → stepped (a click anywhere on the free row, a
// paddle (the nearest step in its direction), the latch or the panel (the
// nearest step), ← → while armed, a radio, a prose link, a deep link);
// STEP OFF = stepped → free (a governed control moved, Play, Restart, the
// latch pressed again).
import { h } from '../site/dom.js';
import { nearestState } from '../core/state.js';

export const PILL_MAX = 5;

export function mountStepper(fig, notice) {
  const states = notice.states, n = states.length;
  const wrap = h('div', { class: 'x-stepper', id: `${fig.id}_steps` });
  const caption = h('p', { class: 'x-caption', id: `${fig.id}_steps_cap` });
  const sr = h('span', { class: 'x-sr', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const indexOf = (name) => states.findIndex((s) => s.name === name);
  const armedKeys = { ArrowLeft: -1, ArrowRight: 1, Home: -Infinity, End: Infinity };
  let last = '';
  const announce = (msg) => { if (msg !== last) { sr.textContent = msg; last = msg; } };
  const stepIn = (dir = 0) => { const near = nearestState(fig.compiled, fig.scope, 1e-6, dir); if (near) fig.goto(near.name, { ease: !near.exact }); };
  const move = (delta) => {
    const i = indexOf(fig.activeState);
    // free: the nearest step in that direction
    if (i < 0) return stepIn(Math.sign(delta));
    const j = Math.max(0, Math.min(n - 1, delta === -Infinity ? 0 : delta === Infinity ? n - 1 : i + delta));
    if (j !== i) fig.goto(states[j].name);
  };
  let focusIn = () => {};
  const enter = () => { if (fig.activeState === null) { stepIn(); focusIn(); } };
  const onKey = (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || !(e.key in armedKeys)) return;
    e.preventDefault();
    move(armedKeys[e.key]);
  };
  let sync;

  if (n <= PILL_MAX) {
    // the pill: one radio per step, no radio checked while free
    const row = h('fieldset', { role: 'radiogroup', class: 'x-stepper-row x-steps-seg', 'data-face': 'free' }, h('legend', {}, 'Steps'));
    const inputs = states.map((s) => {
      const input = h('input', { type: 'radio', name: `${fig.id}_steps`, value: s.name });
      input.addEventListener('change', () => { if (input.checked) fig.goto(s.name); });
      row.append(h('label', {}, input, h('span', {}, s.name)));
      return input;
    });
    focusIn = () => (inputs.find((i) => i.checked) || inputs[0]).focus({ preventScroll: true });
    wrap.append(h('kbd', { class: 'x-key', 'aria-hidden': 'true' }, '←'), row, h('kbd', { class: 'x-key', 'aria-hidden': 'true' }, '→'), caption, sr);
    sync = (active) => {
      const i = indexOf(active), stepped = i >= 0;
      row.dataset.face = stepped ? 'stepped' : 'free';
      inputs.forEach((input, k) => { input.checked = k === i; });
      caption.textContent = stepped ? states[i].caption : '';
      announce(stepped ? states[i].caption : '');
    };
  } else {
    const prev = h('button', { class: 'x-prev', type: 'button', 'aria-label': 'previous step', 'aria-describedby': caption.id }, '‹');
    const next = h('button', { class: 'x-next', type: 'button', 'aria-label': 'next step', 'aria-describedby': caption.id }, '›');
    const invite = h('span', { class: 'x-invite' }, `Step through ${n} step${n === 1 ? '' : 's'}`);
    const counter = h('span', { class: 'x-counter' });
    const latch = h('button', { class: 'x-latch', type: 'button', 'aria-pressed': 'false' }, invite, counter);
    const row = h('div', { class: 'x-stepper-row', role: 'group', 'aria-label': 'Steps', 'data-face': 'free' }, prev, latch, next);
    // one click handler: the whole free row is a door in; the stepped row's buttons act alone
    focusIn = () => latch.focus({ preventScroll: true });
    row.addEventListener('click', (e) => {
      const t = e.target.closest('button');
      if (fig.activeState === null) { if (t === prev) move(-1); else if (t === next) move(1); else stepIn(); focusIn(); return; }
      if (t === prev) move(-1); else if (t === next) move(1); else if (t === latch) fig.stepOff();
    });
    row.addEventListener('keydown', onKey);
    wrap.append(h('kbd', { class: 'x-key', 'aria-hidden': 'true' }, '←'), row, h('kbd', { class: 'x-key', 'aria-hidden': 'true' }, '→'), caption, sr);
    sync = (active) => {
      const i = indexOf(active), stepped = i >= 0;
      row.dataset.face = stepped ? 'stepped' : 'free';
      latch.setAttribute('aria-pressed', String(stepped));
      counter.textContent = stepped ? `${i + 1} of ${n} · ${active}` : '';
      prev.setAttribute('aria-disabled', String(!stepped || i <= 0));
      next.setAttribute('aria-disabled', String(!stepped || i >= n - 1));
      caption.textContent = stepped ? states[i].caption : '';
      announce(stepped ? `Step ${i + 1} of ${n}, ${active}. ${states[i].caption}` : '');
    };
  }
  return { el: wrap, sync, enter };
}
