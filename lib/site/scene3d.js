// lib/site/scene3d.js — the runtime's side of a scene3d figure: the WebGL2
// check, the one dynamic import() of the lazy chunk (resolved beside the
// runtime's own <script src>, captured at load), and the fallback shown when
// either is missing. The three.js adapter itself lives in lib/scene3d/ and
// only ever arrives through loadScene3d().
import { h } from './dom.js';

export const CHUNK_NAME = 'explainers-3d.v1.js';

// The runtime is a deferred classic script: document.currentScript is it
// while the bundle evaluates, and the chunk sits next to it in dist/.
const RUNTIME_SRC = typeof document !== 'undefined' && document.currentScript && document.currentScript.src ? document.currentScript.src : '';

export function chunkUrl(runtimeSrc = RUNTIME_SRC, base = typeof document !== 'undefined' ? document.baseURI : 'http://localhost/') {
  return new URL(CHUNK_NAME, runtimeSrc || base).href;
}

let chunkPromise = null;
// One import() per page, however many scene3d figures it has.
export function loadScene3d() {
  if (!chunkPromise) chunkPromise = Promise.resolve(chunkUrl()).then((url) => import(/* the lazy 3D chunk, same origin */ url));
  return chunkPromise;
}

export function hasWebGL2(win = window) {
  try {
    if (!win.WebGL2RenderingContext) return false;
    const c = win.document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch { return false; }
}

// Without WebGL2 (or when the chunk fails to load): the build poster stays
// as the first frame and the spec's notice goes over it; a page without a
// build poster shows fallback.poster instead.
export function mountScene3dFallback(box, shows, { hasPoster = false, reason = '' } = {}) {
  const wrap = h('div', { class: 'x-3d-fallback' });
  if (!hasPoster && shows.fallback && shows.fallback.poster) {
    const img = h('img', { class: 'x-3d-poster', src: shows.fallback.poster, alt: '' });
    img.addEventListener('error', () => img.remove());
    wrap.append(img);
  }
  const noGl = !reason || reason === 'no WebGL2';
  const text = noGl ? ((shows.fallback && shows.fallback.notice) || 'This 3D figure needs WebGL2.') : 'This 3D figure could not start; its first frame is shown.';
  wrap.append(h('p', { class: 'x-3d-notice', title: reason || null }, text));
  box.append(wrap);
  return wrap;
}
