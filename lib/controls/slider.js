// lib/controls/slider.js — <input type=range> under the canvas.
// Design language (DESIGN.md "Slider anatomy"): the SLIDER is the whole
// control; the TRACK is the bar with its FILL and RAIL; the KNOB is the round
// handle the reader drags (never "thumb"); the HALO is its hover/focus/active
// glow; a discrete slider has STOPS, each marked by a TICK and a SOCKET the
// knob seats into; the VALUE is the <output>. The native range input handles
// pointer and keyboard and draws nothing: the runtime draws track, ticks,
// sockets and knob inside .x-track (see the stylesheet), so the knob center,
// the fill and the stops agree and the knob is always in front.
import { h } from '../site/dom.js';
import { compileTemplate, renderTemplate, format } from '../core/format.js';

// The visible track: for a discrete control one socket and one tick per stop
// (`fractions` are the stops as 0..1 along the track; empty for a continuous
// control), then the knob, last so it paints above everything else.
export function sliderTrack(fractions) {
  const track = h('div', { class: 'x-track' });
  for (const f of fractions) {
    const socket = h('i', { class: 'x-socket' });
    socket.style.setProperty('--at', `${f * 100}%`);
    const tick = h('i', { class: 'x-tick' });
    tick.style.setProperty('--at', `${f * 100}%`);
    track.append(socket, tick);
  }
  track.append(h('i', { class: 'x-knob' }));
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
  if (ticks.length) wrap.classList.add('x-discrete');
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
