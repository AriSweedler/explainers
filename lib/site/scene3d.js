// lib/site/scene3d.js — phase 2 placeholder for scene3d figures. Phase 3
// replaces this with the lazy three.js chunk; until then the poster (when
// the author gave one) and a one-line notice fill the reserved box.
import { h } from './dom.js';

export function mountScene3dPlaceholder(box, shows, captionText) {
  const wrap = h('div', { class: 'x-3d-fallback' });
  if (shows.fallback && shows.fallback.poster) wrap.append(h('img', { class: 'x-3d-poster', src: shows.fallback.poster, alt: shows.fallback.notice || '' }));
  if (captionText) wrap.append(h('p', { class: 'x-3d-caption' }, captionText.trim()));
  wrap.append(h('p', { class: 'x-3d-notice' }, '3D figure (WebGL) not yet available in this build.'));
  box.append(wrap);
  return wrap;
}
