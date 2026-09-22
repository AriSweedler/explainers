// lib/controls/slider.js — <input type=range> under the canvas.
// Native range inputs already jump to the pointer and drag from anywhere on
// the track; the CSS gives the knob its 40 px target. The visible track is a
// sibling .x-track inset by half the knob (see the stylesheet), so the knob
// center, the fill and the ticks all agree.
import { h } from '../site/dom.js';
import { compileTemplate, renderTemplate, format } from '../core/format.js';

// The visible track, with one tick per stop for a discrete control: `fractions`
// are the stops as 0..1 along the track (empty for a continuous control).
export function sliderTrack(fractions) {
  const track = h('div', { class: 'x-track' });
  for (const f of fractions) {
    const tick = h('i', { class: 'x-tick' });
    tick.style.setProperty('--at', `${f * 100}%`);
    track.append(tick);
  }
  return track;
}

// Ticks for min/max/step: every stop when there are 40 or fewer, else none.
export function stepFractions(min, max, step) {
  const span = max - min;
  if (!(step > 0) || !(span > 0) || span / step > 40) return [];
  const out = [];
  for (let k = 0; k * step <= span + 1e-9; k++) out.push(Math.min(1, (k * step) / span));
  return out;
}

// Ticks for a values list (or a rates list): the stops are evenly spaced.
export function evenFractions(n) {
  return n > 1 ? Array.from({ length: n }, (_, k) => k / (n - 1)) : [];
}

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
  const ticks = discrete ? evenFractions(control.values.length) : stepFractions(control.min, control.max, control.step);
  wrap.append(h('label', {}, h('span', { class: 'x-ctl-label' }, control.label), sliderTrack(ticks), input, out));

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
