// lib/controls/toggle.js — an aria-pressed button; corner or below the canvas.
import { h } from '../site/dom.js';

export function mountToggle(fig, control, i) {
  const btn = h('button', { class: 'x-toggle', id: `${fig.id}_tg${i}`, type: 'button', 'aria-pressed': 'false' });
  btn.style.setProperty('--token', `var(--c-${control.token})`);
  btn.addEventListener('click', () => fig.set(control.name, fig.get(control.name) ? 0 : 1, 'user'));
  const el = control.position === 'below' ? h('div', { class: 'x-ctl x-ctl-toggle' }, btn) : btn;
  return {
    el, name: control.name, corner: control.position !== 'below',
    sync(scope) {
      const on = scope.get(control.name) === 1;
      btn.setAttribute('aria-pressed', String(on));
      const text = control.label[on ? 1 : 0];
      if (btn.textContent !== text) btn.textContent = text;
    },
  };
}
