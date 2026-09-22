// lib/controls/stepper.js — prev/next over notice.states with the state's
// caption, or a radio row of state names (steps: 'segmented').
import { h } from '../site/dom.js';

export function mountStepper(fig, notice) {
  const states = notice.states;
  const wrap = h('div', { class: 'x-stepper', id: `${fig.id}_steps` });
  const caption = h('p', { class: 'x-caption' });
  let sync;

  if (notice.steps === 'segmented') {
    const fieldset = h('fieldset', { role: 'radiogroup', class: 'x-steps-seg' }, h('legend', {}, 'States'));
    const inputs = states.map((s) => {
      const input = h('input', { type: 'radio', name: `${fig.id}_steps`, value: s.name });
      input.addEventListener('change', () => { if (input.checked) fig.goto(s.name); });
      fieldset.append(h('label', {}, input, h('span', {}, s.name)));
      return input;
    });
    wrap.append(fieldset, caption);
    sync = (active) => {
      inputs.forEach((input, k) => { input.checked = states[k].name === active; });
      caption.textContent = active ? states.find((s) => s.name === active).caption : '';
    };
  } else {
    const prev = h('button', { class: 'x-prev', type: 'button', 'aria-label': 'previous state' }, '‹');
    const next = h('button', { class: 'x-next', type: 'button', 'aria-label': 'next state' }, '›');
    const out = h('output', { 'aria-live': 'polite' });
    const indexOf = (name) => states.findIndex((s) => s.name === name);
    prev.addEventListener('click', () => { const i = indexOf(fig.activeState); fig.goto(states[i <= 0 ? 0 : i - 1].name); });
    next.addEventListener('click', () => { const i = indexOf(fig.activeState); fig.goto(states[Math.min(states.length - 1, i + 1)].name); });
    wrap.append(h('div', { class: 'x-stepper-row' }, prev, out, next), caption);
    sync = (active) => {
      const i = indexOf(active);
      prev.disabled = i <= 0;
      next.disabled = i >= states.length - 1;
      out.textContent = i < 0 ? `${states.length} states` : `${i + 1} of ${states.length} · ${active}`;
      caption.textContent = i < 0 ? '' : states[i].caption;
    };
  }
  return { el: wrap, sync };
}
