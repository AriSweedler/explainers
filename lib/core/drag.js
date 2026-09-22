// lib/core/drag.js — Pointer Events drag on a canvas.
// setPointerCapture keeps the move/up stream even when the pointer leaves the
// canvas; the caller sets touch-action:none on the element so a touch drag
// does not scroll the page.

export function attachDrag(el, { hit, onStart, onMove, onEnd, onHover }) {
  let active = null;
  const local = (e) => {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  function down(e) {
    if (e.button !== 0 && e.pointerType !== 'touch') return;
    const p = local(e);
    const h = hit(p, e.pointerType === 'touch');
    if (h == null) return;
    active = { h, id: e.pointerId };
    if (el.setPointerCapture) el.setPointerCapture(e.pointerId);
    e.preventDefault();
    onStart(h, p);
  }
  function move(e) {
    if (!active) { if (onHover) onHover(hit(local(e), false) != null); return; }
    if (e.pointerId !== active.id) return;
    onMove(active.h, local(e));
  }
  function up(e) {
    if (!active || e.pointerId !== active.id) return;
    const h = active.h;
    active = null;
    onEnd(h);
  }
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  return () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
  };
}

// Constraint strings of the drag control -> a projection in world units.
export function constrainPoint(constrain, [x, y], { view, start }) {
  if (constrain === 'free') return [x, y];
  if (constrain === 'x') return [x, start[1]];
  if (constrain === 'y') return [start[0], y];
  if (constrain === 'view') return [clampTo(x, view.x), clampTo(y, view.y)];
  if (constrain.startsWith('circle:')) {
    const R = Number(constrain.slice(7));
    const d = Math.hypot(x, y) || 1;
    return [(x / d) * R, (y / d) * R];
  }
  if (constrain.startsWith('segment:')) {
    const [[ax, ay], [bx, by]] = JSON.parse(constrain.slice(8));
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
    const k = Math.min(Math.max(((x - ax) * dx + (y - ay) * dy) / L2, 0), 1);
    return [ax + dx * k, ay + dy * k];
  }
  return [x, y]; // surface:<id> is a scene3d concern (phase 3)
}

const clampTo = (v, [lo, hi]) => Math.min(Math.max(v, lo), hi);
