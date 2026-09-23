// lib/controls/drag.js — the keyboard side of a drag handle. The pointer side
// lives on the canvas (see lib/site/figure.js); this proxy button nudges the
// point with the arrow keys so the control is reachable without a pointer.
// A surface drag (constrain: surface:<object>) holds [lat, lon] in degrees
// and nudges by 2° (10° with Shift); its optional geolocate button jumps to
// the reader's position when the browser offers one.
import { h } from '../site/dom.js';

export function mountDragPoint(fig, control) {
  const surface = control.constrain.startsWith('surface:');
  const btn = h('button', { class: 'x-drag-proxy', id: `${fig.id}_drag_${control.name}`, type: 'button', role: 'slider', 'aria-label': `${control.name} (arrow keys move it)` }, control.name);
  btn.addEventListener('keydown', (e) => {
    let step, d;
    if (surface) {
      step = e.shiftKey ? 10 : 2;
      d = { ArrowLeft: [0, -step], ArrowRight: [0, step], ArrowUp: [step, 0], ArrowDown: [-step, 0] }[e.key];
      if (!d) return;
      e.preventDefault();
      fig.set(control.name, [fig.get(`${control.name}.lat`) + d[0], fig.get(`${control.name}.lon`) + d[1]], 'user');
      return;
    }
    const view = fig.view;
    if (!view) return;
    step = (e.shiftKey ? 0.1 : 0.02) * Math.max(view.x[1] - view.x[0], view.y[1] - view.y[0]);
    d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
    if (!d) return;
    e.preventDefault();
    fig.set(control.name, [fig.get(`${control.name}.x`) + d[0], fig.get(`${control.name}.y`) + d[1]], 'user');
  });
  return {
    el: btn, name: control.name,
    sync(scope) {
      if (surface) {
        const lat = scope.get(`${control.name}.lat`), lon = scope.get(`${control.name}.lon`);
        btn.setAttribute('aria-valuetext', `${Math.abs(lat).toFixed(1)}° ${lat < 0 ? 'S' : 'N'}, ${Math.abs(lon).toFixed(1)}° ${lon < 0 ? 'W' : 'E'}`);
        return;
      }
      const x = scope.get(`${control.name}.x`), y = scope.get(`${control.name}.y`);
      btn.setAttribute('aria-valuetext', `${x.toFixed(2)}, ${y.toFixed(2)}`);
    },
  };
}

// "Use my location": a corner button (surface drags only). Absent when the
// browser has no geolocation; a refusal or an error leaves the handle where
// it was and re-enables the button.
export function mountGeolocate(fig, control, nav = typeof navigator !== 'undefined' ? navigator : null) {
  if (!nav || !nav.geolocation || typeof nav.geolocation.getCurrentPosition !== 'function') return null;
  const btn = h('button', { class: 'x-geolocate', id: `${fig.id}_geo_${control.name}`, type: 'button' }, 'Use my location');
  btn.style.setProperty('--token', `var(--c-${control.token})`);
  btn.addEventListener('click', () => {
    btn.disabled = true;
    const done = () => { btn.disabled = false; };
    nav.geolocation.getCurrentPosition(
      (pos) => { fig.set(control.name, [pos.coords.latitude, pos.coords.longitude], 'user'); done(); },
      done,
      { maximumAge: 600000, timeout: 10000 },
    );
  });
  return { el: btn, name: null, corner: true, sync() {} };
}
