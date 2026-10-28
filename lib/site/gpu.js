// lib/site/gpu.js — the runtime's side of a splat3d figure: the WebGPU check,
// the one dynamic import() of the lazy GPU chunk (resolved beside the
// runtime's own <script src>, captured at load), and the fallback shown when
// either is missing. The renderer itself lives in lib/gpu/ and only ever
// arrives through loadSplat3d(). Mirrors lib/site/scene3d.js.
import { h } from './dom.js';

export const GPU_CHUNK_NAME = 'explainers-gpu.v1.js';

const RUNTIME_SRC_GPU = typeof document !== 'undefined' && document.currentScript && document.currentScript.src ? document.currentScript.src : '';

export function gpuChunkUrl(runtimeSrc = RUNTIME_SRC_GPU, base = typeof document !== 'undefined' ? document.baseURI : 'http://localhost/') {
  return new URL(GPU_CHUNK_NAME, runtimeSrc || base).href;
}

let gpuChunkPromise = null;
// One import() per page, however many splat3d figures it has.
export function loadSplat3d() {
  if (!gpuChunkPromise) gpuChunkPromise = Promise.resolve(gpuChunkUrl()).then((url) => import(/* the lazy GPU chunk, same origin */ url));
  return gpuChunkPromise;
}

export function hasWebGPU(nav = typeof navigator !== 'undefined' ? navigator : null) {
  return !!(nav && nav.gpu && typeof nav.gpu.requestAdapter === 'function');
}

// Without WebGPU (or when the chunk or the adapter fails): the build poster
// stays as the first frame and the spec's notice goes over it.
export function mountSplat3dFallback(box, shows, { hasPoster = false, reason = '' } = {}) {
  const wrap = h('div', { class: 'x-3d-fallback' });
  if (!hasPoster && shows.fallback && shows.fallback.poster) {
    const img = h('img', { class: 'x-3d-poster', src: shows.fallback.poster, alt: '' });
    img.addEventListener('error', () => img.remove());
    wrap.append(img);
  }
  const noGpu = !reason || reason === 'no WebGPU';
  const text = noGpu ? ((shows.fallback && shows.fallback.notice) || 'This figure needs WebGPU; its first frame is shown.') : 'This figure could not start; its first frame is shown.';
  wrap.append(h('p', { class: 'x-3d-notice', title: reason || null }, text));
  box.append(wrap);
  return wrap;
}
