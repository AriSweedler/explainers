// tools/integrity.mjs — dist/integrity.json: one sha384 per dist file that
// template/article.html includes with an integrity= attribute. Written by
// tools/build-runtime.mjs after the bundle; read by tools/explainers.cjs
// (`build` fills the attributes from it, `validate` compares them to it).
// Same-origin includes need no crossorigin attribute for SRI.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const INTEGRITY_FILE = 'dist/integrity.json';
export const INTEGRITY_FILES = ['dist/explainers-runtime.v1.js', 'dist/explainers.v1.css'];

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
