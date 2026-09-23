#!/usr/bin/env node
// tools/build-runtime.mjs — concatenates the lib/ ES modules into
// dist/explainers-runtime.v1.js: one IIFE, plain ES2020, no dependencies and
// no bundler. Every module is written so that its top-level names are unique
// across the bundle (the build refuses duplicates), imports are dropped and
// `export` keywords stripped. Run: node tools/build-runtime.mjs [--check]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { writeIntegrity, INTEGRITY_FILE } from './integrity.mjs';

export const VERSION = '1.0.0';
export const OUTFILE = 'dist/explainers-runtime.v1.js';

// Dependency order: a module only uses names from modules above it at
// evaluation time (function bodies may reference anything).
export const ORDER = [
  'lib/expr.js',
  'lib/spec.js',
  'lib/core/format.js',
  'lib/core/ease.js',
  'lib/core/clock.js',
  'lib/core/tokens.js',
  'lib/core/visibility.js',
  'lib/core/layout.js',
  'lib/core/drag.js',
  'lib/core/state.js',
  'lib/core/deeplink.js',
  'lib/scene3d/surface.js',
  'lib/scene2d/getters.js',
  'lib/scene2d/models/kepler.js',
  'lib/scene2d/models/twobody.js',
  'lib/scene2d/models/cam.js',
  'lib/scene2d/models/lunar.js',
  'lib/scene2d/models/index.js',
  'lib/scene2d/label.js',
  'lib/scene2d/layers.js',
  'lib/scene2d/plot.js',
  'lib/scene2d/scene2d.js',
  'lib/site/dom.js',
  'lib/controls/slider.js',
  'lib/controls/time.js',
  'lib/controls/drag.js',
  'lib/controls/toggle.js',
  'lib/controls/segmented.js',
  'lib/controls/play.js',
  'lib/controls/stepper.js',
  'lib/site/scene3d.js',
  'lib/site/figure.js',
  'lib/site/term.js',
  'lib/site/glossary.js',
  'lib/site/hooks.js',
  'lib/site/boot.js',
];

export const LAZY_IMPORTER = 'lib/site/scene3d.js';

const IMPORT_RE = /^import\s+(?:[\s\S]*?\s+from\s+)?['"][^'"]+['"];?[ \t]*\r?\n/gm;
const EXPORT_DECL_RE = /^export\s+(?=(?:async\s+)?function\b|class\b|const\b|let\b|var\b)/gm;
const EXPORT_LIST_RE = /^export\s*\{[^}]*\};?[ \t]*\r?\n/gm;
const DECL_RE = /^(?:async\s+)?(?:function\s*\*?\s*|class\s+|const\s+|let\s+|var\s+)([A-Za-z_$][\w$]*)/gm;
const DOCS_MARKER_RE = /^\/\/ -{10,} docs\r?\n/m;

// lib/spec.js and lib/expr.js end with a "docs" section (markdown renderers
// for DESIGN.md) that the browser never calls; it is cut at the marker.
function stripDocs(src, rel) {
  const m = DOCS_MARKER_RE.exec(src);
  if (!m) return src;
  const kept = src.slice(0, m.index), dropped = src.slice(m.index);
  const code = kept.replace(/\/\/.*$/gm, ''); // comments may mention the names
  for (const name of declaredNames(dropped)) {
    if (new RegExp(`\\b${name}\\s*\\(`).test(code)) throw new Error(`${rel}: docs section defines ${name}(), which the runtime part calls`);
  }
  return kept;
}

function declaredNames(src) {
  return [...src.matchAll(DECL_RE)].map((m) => m[1]);
}

// ERROR_CATALOGUE is the CLI's table of one-line descriptions; the runtime
// prints codes it gets from FigSpecError and never reads the table.
const CATALOGUE_RE = /^export const ERROR_CATALOGUE = Object\.freeze\(\{[\s\S]*?^\}\);\n/m;

// Whole-line comments, blank lines and indentation carry no meaning in JS,
// provided no template literal spans lines (checked: an odd number of
// backticks on a line).
function compact(src, rel) {
  const lines = src.split('\n');
  for (const [i, line] of lines.entries()) {
    if ((line.match(/`/g) || []).length % 2) throw new Error(`${rel}:${i + 1}: a template literal spans lines; the bundle would change its indentation`);
  }
  return lines.map((l) => l.trim()).filter((l) => l && !l.startsWith('//')).join('\n');
}

export function transformModule(src, rel) {
  let out = stripDocs(src, rel);
  if (rel === 'lib/spec.js') {
    if (!CATALOGUE_RE.test(out)) throw new Error('lib/spec.js: ERROR_CATALOGUE block not found');
    out = out.replace(CATALOGUE_RE, 'export const ERROR_CATALOGUE = Object.freeze({});\n');
  }
  out = out.replace(IMPORT_RE, '');
  out = out.replace(EXPORT_LIST_RE, '');
  out = out.replace(EXPORT_DECL_RE, '');
  const leftover = /^\s*(import|export)\b/m.exec(out);
  if (leftover) throw new Error(`${rel}: unhandled ${leftover[1]} statement`);
  // The one dynamic import() of the runtime loads the lazy 3D chunk; the
  // bundle stays dependency-free everywhere else.
  if (rel !== LAZY_IMPORTER && /\bimport\s*\(/.test(out)) throw new Error(`${rel}: dynamic import() is not allowed in the runtime bundle (only ${LAZY_IMPORTER} loads the 3D chunk)`);
  return out;
}

export function bundle(root) {
  const owner = new Map();
  const parts = [];
  for (const rel of ORDER) {
    const src = fs.readFileSync(path.join(root, rel), 'utf8');
    const body = transformModule(src, rel);
    for (const name of declaredNames(body)) { // top level = column 0, before compaction
      if (owner.has(name)) throw new Error(`duplicate top-level name "${name}" in ${rel} (also in ${owner.get(name)})`);
      owner.set(name, rel);
    }
    parts.push(`// ---- ${rel}\n${compact(body, rel)}\n`);
  }
  const banner = [
    `// explainers-runtime v${VERSION} — GENERATED by tools/build-runtime.mjs from lib/; do not edit.`,
    '// Plain ES2020, no dependencies. Source and contract: DESIGN.md "Phase 2 contract".',
  ].join('\n');
  return `${banner}\n(() => {\n'use strict';\n${parts.join('\n')}})();\n`;
}

export const gzipSize = (text) => gzipSync(Buffer.from(text), { level: 9 }).length;

const invoked = process.argv[1] && /build-runtime\.mjs$/.test(process.argv[1]);
if (invoked) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const out = bundle(root);
  const file = path.join(root, OUTFILE);
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (current !== out) { console.error(`${OUTFILE} is stale; run: node tools/build-runtime.mjs`); process.exit(1); }
    if (writeIntegrity(root, { check: true }).changed) { console.error(`${INTEGRITY_FILE} is stale; run: node tools/build-runtime.mjs`); process.exit(1); }
    console.log(`${OUTFILE} and ${INTEGRITY_FILE} current`);
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, out);
    console.log(`wrote ${OUTFILE}: ${out.length} bytes, ${gzipSize(out)} gzip`);
    const { changed } = writeIntegrity(root);
    console.log(changed ? `wrote ${INTEGRITY_FILE}; run: node tools/explainers.cjs build articles/*/index.html` : `${INTEGRITY_FILE} current`);
  }
}
