// lib/core/layout.js — canvas backing store and world <-> CSS px mapping.

export const dprFor = (win) => (win.devicePixelRatio > 1.75 ? 2 : 1);

// Backing store at dpr, explicit CSS size so the canvas never doubles.
export function fitCanvas(canvas, box, dpr) {
  const r = box.getBoundingClientRect();
  const width = Math.max(1, Math.round(r.width)), height = Math.max(1, Math.round(r.height));
  if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
    canvas.width = width * dpr;
    canvas.height = height * dpr;
  }
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  return { x: 0, y: 0, width, height };
}

// Uniform scale (circles stay round), centered in the box, y up.
export function worldToPx(view, box) {
  const vw = view.x[1] - view.x[0], vh = view.y[1] - view.y[0];
  const s = Math.min(box.width / vw, box.height / vh);
  const ox = (box.x || 0) + (box.width - vw * s) / 2;
  const oy = (box.y || 0) + (box.height - vh * s) / 2;
  return {
    s,
    x: (wx) => ox + (wx - view.x[0]) * s,
    y: (wy) => oy + (view.y[1] - wy) * s,
    len: (l) => l * s,
    wx: (px) => view.x[0] + (px - ox) / s,
    wy: (py) => view.y[1] - (py - oy) / s,
    rect: { x: ox, y: oy, width: vw * s, height: vh * s },
  };
}

// Sub-boxes for split panels. Returns { main, panels: [box...] } in CSS px.
export function splitBoxes(box, panels) {
  let main = { ...box };
  const out = [];
  for (const p of panels) {
    const at = p.at;
    if (at === 'right') {
      const w = Math.round(main.width * 0.4);
      out.push({ x: main.x + main.width - w, y: main.y, width: w, height: main.height, inset: false });
      main = { ...main, width: main.width - w };
    } else if (at === 'below') {
      const h = Math.round(main.height * 0.38);
      out.push({ x: main.x, y: main.y + main.height - h, width: main.width, height: h, inset: false });
      main = { ...main, height: main.height - h };
    } else {
      const w = Math.round(box.width * 0.36), h = Math.round(box.height * 0.36), pad = 10;
      const right = at.endsWith('right'), bottom = at.startsWith('inset:bottom');
      out.push({ x: right ? box.x + box.width - w - pad : box.x + pad, y: bottom ? box.y + box.height - h - pad : box.y + pad, width: w, height: h, inset: true });
    }
  }
  return { main, panels: out };
}
