// lib/controls/slider.js — <input type=range> under the canvas.
// Native range inputs already jump to the pointer and drag from anywhere on
// the track; the CSS gives the knob its 40 px target.
import { h } from '../site/dom.js';
import { compileTemplate, renderTemplate, format } from '../core/format.js';

export function mountSlider(fig, control, i) {
  const discrete = 'values' in control;
  const wrap = h('div', { class: `x-ctl x-ctl-slider${control.width === 'long' ? ' x-long' : ''}`, id: `${fig.id}_sl${i}` });
  wrap.style.setProperty('--token', `var(--c-${control.token})`);
  const input = h('input', { type: 'range', 'aria-label': control.label });
  if (discrete) { input.min = 0; input.max = control.values.length - 1; input.step = 1; }
  else { input.min = control.min; input.max = control.max; input.step = control.step ?? 'any'; }
  const out = h('output');
  const parts = control.format ? compileTemplate(control.format) : null;
  const fallbackFmt = Number.isInteger(control.step) ? ',d' : '.2f';
  const valueOf = () => (discrete ? control.values[Number(input.value)] : Number(input.value));

  input.addEventListener('input', () => fig.set(control.name, valueOf(), 'user'));
  wrap.append(h('label', {}, h('span', { class: 'x-ctl-label' }, control.label), input, out));

  return {
    el: wrap, name: control.name,
    sync(scope) {
      const v = scope.get(control.name);
      const pos = discrete ? control.values.indexOf(v) : v;
      if (Number(input.value) !== pos) input.value = pos;
      const lo = Number(input.min), hi = Number(input.max);
      wrap.style.setProperty('--x-pct', `${((pos - lo) / (hi - lo)) * 100}%`);
      const text = parts ? renderTemplate(parts, scope, fig.fmt) : format(v, fallbackFmt);
      if (out.textContent !== text) out.textContent = text;
      input.setAttribute('aria-valuetext', control.unit && !parts ? `${text} ${control.unit}` : text);
    },
  };
}
