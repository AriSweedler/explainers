// lib/controls/segmented.js — a radio row; the checked option's value is the
// control's value.
import { h } from '../site/dom.js';

export function mountSegmented(fig, control, i) {
  const group = `${fig.id}_${control.name}`;
  const fieldset = h('fieldset', { role: 'radiogroup' }, h('legend', {}, control.name));
  const inputs = control.options.map((o) => {
    const input = h('input', { type: 'radio', name: group, value: o.value });
    input.addEventListener('change', () => { if (input.checked) fig.set(control.name, o.value, 'user'); });
    fieldset.append(h('label', {}, input, h('span', {}, o.label)));
    return input;
  });
  const wrap = h('div', { class: 'x-ctl x-ctl-segmented', id: `${fig.id}_seg${i}` }, fieldset);
  wrap.style.setProperty('--token', `var(--c-${control.token})`);
  return {
    el: wrap, name: control.name,
    sync(scope) {
      const v = scope.get(control.name);
      inputs.forEach((input, k) => { input.checked = control.options[k].value === v; });
    },
  };
}
