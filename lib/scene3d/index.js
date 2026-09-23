// lib/scene3d/index.js — entry of the lazy chunk dist/explainers-3d.v1.js
// (tools/build-3d.mjs bundles it with three.js). The runtime imports it on
// the first approach of a scene3d figure and calls mountScene3d.
export { mountScene3d } from './scene3d.js';
export const CHUNK_VERSION = '1.0.0';
