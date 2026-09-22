// lib/controls/drag.js — the keyboard side of a drag handle. The pointer side
// lives on the canvas (see lib/site/figure.js); this proxy button nudges the
// point with the arrow keys so the control is reachable without a pointer.
import { h } from '../site/dom.js';

export function mountDragPoint(fig, control) {
  const btn = h('button', { class: 'x-drag-proxy', id: `${fig.id}_drag_${control.name}`, type: 'button', role: 'slider', 'aria-label': `${control.name} (arrow keys move it)` }, control.name);
  btn.addEventListener('keydown', (e) => {
    const view = fig.view;
    if (!view) return;
    const step = (e.shiftKey ? 0.1 : 0.02) * Math.max(view.x[1] - view.x[0], view.y[1] - view.y[0]);
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
    if (!d) return;
    e.preventDefault();
    fig.set(control.name, [fig.get(`${control.name}.x`) + d[0], fig.get(`${control.name}.y`) + d[1]], 'user');
  });
  return {
    el: btn, name: control.name,
    sync(scope) {
      const x = scope.get(`${control.name}.x`), y = scope.get(`${control.name}.y`);
      btn.setAttribute('aria-valuetext', `${x.toFixed(2)}, ${y.toFixed(2)}`);
    },
  };
}
