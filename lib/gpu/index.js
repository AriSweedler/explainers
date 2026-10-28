// lib/gpu/index.js — entry of the lazy chunk dist/explainers-gpu.v1.js
// (tools/build-gpu.mjs bundles it; no dependencies). The runtime imports it on
// the first approach of a splat3d figure and calls mountSplat3d.
export { mountSplat3d } from './splat3d.js';
export const GPU_CHUNK_VERSION = '1.0.0';
