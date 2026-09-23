// tools/integrity.mjs — dist/integrity.json: one sha384 per committed dist
// file. The runtime and the stylesheet are the two includes template/article.html
// carries with an integrity= attribute (`build` fills them, `validate`
// compares); the lazy 3D chunk is a dynamic import(), which no attribute can
// cover, so its entry serves the deploy check and the tests only. Written by
// tools/build-runtime.mjs and tools/build-3d.mjs after their bundles.
// Same-origin includes need no crossorigin attribute for SRI.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const INTEGRITY_FILE = 'dist/integrity.json';
export const INTEGRITY_INCLUDES = ['dist/explainers-runtime.v1.js', 'dist/explainers.v1.css']; // carry integrity= in the template
export const CHUNK_FILE = 'dist/explainers-3d.v1.js';                                           // dynamic import(): manifest entry only
export const INTEGRITY_FILES = [...INTEGRITY_INCLUDES, CHUNK_FILE];

export const sha384 = (buf) => `sha384-${crypto.createHash('sha384').update(buf).digest('base64')}`;

export function computeIntegrity(root) {
  const out = {};
  for (const rel of INTEGRITY_FILES) out[rel] = sha384(fs.readFileSync(path.join(root, rel)));
  return out;
}

export function integrityJson(root) {
  return `${JSON.stringify(computeIntegrity(root), null, 2)}\n`;
}

// Writes dist/integrity.json unless it is already current; with check, only
// reports. Returns { changed, json }.
export function writeIntegrity(root, { check = false } = {}) {
  const json = integrityJson(root);
  const file = path.join(root, INTEGRITY_FILE);
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (current === json) return { changed: false, json };
  if (!check) fs.writeFileSync(file, json);
  return { changed: true, json };
}
