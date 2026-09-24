// lib/site/hooks.js — prose hooks: data-ref spans, data-state links, the
// pause-all link, and \tok{} colors in built equations.

export function mountProseHooks(doc, figures, { clock }) {
  const refsOf = new Map(); // fig -> [{ span, ref }]
  for (const span of doc.querySelectorAll('span[data-fig][data-ref]')) {
    const fig = figures.get(span.dataset.fig);
    if (!fig) continue;
    const ref = span.dataset.ref;
    const info = fig.refInfo(ref);
    span.classList.add('x-ref');
    if (info.token) { span.dataset.token = info.token; span.style.setProperty('--tok', `var(--c-${info.token})`); }
    if (info.dashed) span.dataset.dashed = '';
    const on = () => { if (fig.visible && !span.classList.contains('x-ref-hidden')) fig.highlight(ref, true); };
    const off = () => fig.highlight(ref, false);
    span.addEventListener('pointerenter', on);
    span.addEventListener('pointerleave', off);
    span.addEventListener('focus', on);
    span.addEventListener('blur', off);
    if (!refsOf.has(fig)) refsOf.set(fig, []);
    refsOf.get(fig).push({ span, ref });
  }

  // A ref inherits the visibility of what it points at: hidden in the figure,
  // plain prose on the page, until the figure draws it again.
  const applyVisibility = (fig) => {
    for (const { span, ref } of refsOf.get(fig)) {
      const hidden = !fig.visibleIds.has(ref);
      if (hidden && !span.classList.contains('x-ref-hidden')) fig.highlight(ref, false); // ends a hover in progress
      span.classList.toggle('x-ref-hidden', hidden);
    }
  };
  for (const fig of refsOf.keys()) {
    applyVisibility(fig);
    fig.el.addEventListener('x-fig:visibility', () => applyVisibility(fig));
  }

  doc.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[data-state][href^="#fig-"]');
    if (!a) return;
    const fig = figures.get(a.getAttribute('href').slice(1));
    if (!fig) return;
    e.preventDefault();
    const r = fig.el.getBoundingClientRect();
    if (r.top < 0 || r.bottom > doc.documentElement.clientHeight) fig.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    fig.goto(a.dataset.state, { ease: true });
    const st = fig.el.querySelector('.x-stepper');
    if (st) st.focus({ preventScroll: true }); // the link arms the panel too
  });

  const pauseAll = doc.querySelector('a.x-pause-all');
  if (pauseAll) {
    const resumeText = 'Resume animations', pauseText = pauseAll.textContent;
    pauseAll.addEventListener('click', (e) => {
      e.preventDefault();
      const paused = doc.documentElement.classList.toggle('x-paused');
      pauseAll.textContent = paused ? resumeText : pauseText;
      clock.pause(paused);
    });
  }
}

// KaTeX renders \tok{sun}{x} as <span class="enclosing sun">; the token
// names are per article, so the color is set here rather than in the CSS.
export function colorTex(doc, paletteNames) {
  for (const el of doc.querySelectorAll('.x-tex .enclosing')) {
    for (const name of paletteNames) if (el.classList.contains(name)) el.style.color = `var(--c-${name})`;
  }
}
