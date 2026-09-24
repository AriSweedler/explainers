// lib/controls/time.js — scrub mode: the slider is the clock over a window;
// speed mode: the slider picks the rate of a running clock (Play advances it).
// The exposed number follows lib/spec.js: the ms offset from the epoch
// (scrub) or the elapsed ms (speed); <name>.rate in speed mode.
import { h } from '../site/dom.js';
import { format } from '../core/format.js';
import { hasStops } from '../core/state.js';
import { windowToMs } from '../spec.js';
import { sliderTrack, evenFractions } from './slider.js';

export function mountTime(fig, control, i) {
  const scrub = control.mode === 'scrub';
  const epochMs = control.epoch === 'now' ? Date.now() : Date.parse(control.epoch);
  const wrap = h('div', { class: `x-ctl x-ctl-slider x-ctl-time x-long`, id: `${fig.id}_sl${i}` });
  wrap.style.setProperty('--token', `var(--c-${control.token})`);
  const input = h('input', { type: 'range', 'aria-label': scrub ? 'time' : 'speed' });
  if (scrub) { input.min = 0; input.max = windowToMs(control.window); input.step = 'any'; }
  else { input.min = 0; input.max = control.rates.length - 1; input.step = 1; }
  const out = h('output');
  const labelText = scrub ? 'time' : 'speed of time';

  input.addEventListener('input', () => {
    if (scrub) fig.set(control.name, Number(input.value), 'user');
    else fig.set(`${control.name}.rate`, control.rates[Number(input.value)], 'user');
  });
  // scrub is continuous (no ticks); speed has one stop per rate
  if (hasStops(control)) wrap.classList.add('x-discrete');
  wrap.append(h('label', {}, h('span', { class: 'x-ctl-label' }, labelText), sliderTrack(scrub ? [] : evenFractions(control.rates.length)), input, out));

  const clockText = (ms) => (control.format === 'dhm' ? format(ms / 86400e3, 'dhm') : format(epochMs + ms, control.format, fig.fmt));

  return {
    el: wrap, name: control.name, epochMs,
    sync(scope) {
      const v = scope.get(control.name);
      if (scrub) {
        if (Number(input.value) !== v) input.value = v;
        wrap.style.setProperty('--x-pct', `${(v / Number(input.max)) * 100}%`);
        out.textContent = clockText(v);
      } else {
        const rate = scope.get(`${control.name}.rate`);
        const idx = control.rates.indexOf(rate);
        if (Number(input.value) !== idx) input.value = idx;
        wrap.style.setProperty('--x-pct', `${(idx / Math.max(1, control.rates.length - 1)) * 100}%`);
        out.textContent = `${rate.toLocaleString('en-US')}× · ${clockText(v)}`;
      }
      input.setAttribute('aria-valuetext', out.textContent);
    },
  };
}
