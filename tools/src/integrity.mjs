// Subresource integrity for the two includes every article carries: the
// runtime <script> and the stylesheet <link>. template/article.html holds the
// literal placeholders integrity="{{integrity:dist/<file>}}" (an external
// assembler copies the head verbatim); `build` resolves them from
// dist/integrity.json and refreshes attributes that are already resolved;
// `validate` compares. Unbuilt (still the placeholder) is a warning, like a
// formula without data-tex; absent or wrong is an error.
//
// Cache busting rides on the same table: `build` also rewrites each include's
// URL to end in ?v=<version>, a short URL-safe prefix of its hash, so an
// article that carries a new integrity value also names a new URL. Without it
// a CDN or browser that still holds the old asset (Cloudflare caches dist/ for
// four hours; GitHub Pages caches the HTML for ten minutes) pairs the new
// HTML with the old file, SRI blocks the file, and the page renders unstyled
// with no figures. `validate` treats a missing or stale ?v= as INTEGRITY_STALE.
import fs from 'node:fs';
import path from 'node:path';
import { attr, byTag, line, splice } from './html.mjs';

export const INTEGRITY_FILE = 'dist/integrity.json';
const PLACEHOLDER_RE = /^\{\{integrity:[^}]*\}\}$/;
const RUNTIME_RE = /(^|\/)dist\/explainers-runtime\.v\d+\.js(\?[^#]*)?$/;
const CSS_RE = /(^|\/)dist\/explainers\.v\d+\.css(\?[^#]*)?$/;

// The ?v= value an integrity hash implies: its first 10 base64 characters, URL-safe.
export const versionOf = (integrity) => integrity.replace(/^sha\d+-/, '').slice(0, 10).replace(/\+/g, '-').replace(/\//g, '_');
const versionIn = (url) => { const m = /[?&]v=([^&#]*)/.exec(url || ''); return m ? m[1] : null; };
const withVersion = (url, v) => `${url.replace(/[?#].*$/, '')}?v=${v}`;

const distKey = (url) => {
  const m = /(?:^|\/)(dist\/[^/?#]+)(?:[?#].*)?$/.exec(url || '');
  return m ? m[1] : null;
};

// The includes SRI covers, with the dist/integrity.json key each maps to.
export function integrityIncludes(doc) {
  const out = [];
  for (const s of byTag(doc, 'script')) {
    const src = attr(s, 'src');
    if (src && RUNTIME_RE.test(src)) out.push({ el: s, key: distKey(src), what: 'runtime <script>', urlAttr: 'src', url: src });
  }
  for (const l of byTag(doc, 'link')) {
    const href = attr(l, 'href');
    if (attr(l, 'rel') === 'stylesheet' && href && CSS_RE.test(href)) out.push({ el: l, key: distKey(href), what: 'stylesheet <link>', urlAttr: 'href', url: href });
  }
  return out;
}

export function loadIntegrity(repoRoot) {
  const file = path.join(repoRoot, INTEGRITY_FILE);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// validate mode.
export function checkIntegrity(doc, file, repoRoot, problems) {
  const table = loadIntegrity(repoRoot);
  if (!table) { problems.warn(file, 0, null, `integrity not checked: ${INTEGRITY_FILE} not found; run: node tools/build-runtime.mjs`); return; }
  for (const { el, key, what, url } of integrityIncludes(doc)) {
    const expected = table[key];
    if (!expected) { problems.warn(file, line(el), null, `integrity not checked: ${INTEGRITY_FILE} has no entry for ${key}; run: node tools/build-runtime.mjs`); continue; }
    const value = attr(el, 'integrity');
    if (value === undefined) { problems.error(file, line(el), 'INTEGRITY_MISSING', null, `the ${what} has no integrity attribute; run: explainers build`); continue; }
    if (PLACEHOLDER_RE.test(value)) { problems.warn(file, line(el), null, `integrity not resolved yet on the ${what}; run: explainers build`); continue; }
    if (value !== expected) { problems.error(file, line(el), 'INTEGRITY_STALE', null, `the ${what} has integrity="${value}" but ${INTEGRITY_FILE} says ${expected}; run: explainers build`); continue; }
    const v = versionIn(url);
    if (v !== versionOf(expected)) problems.error(file, line(el), 'INTEGRITY_STALE', null, `the ${what} URL ${v === null ? 'has no ?v=' : `has ?v=${v}`} but its integrity implies ?v=${versionOf(expected)}; run: explainers build`);
  }
}

// build mode: set integrity on both includes from dist/integrity.json,
// whether the attribute is the placeholder, stale, or absent, and give the
// include URL the matching ?v=. Returns the rewritten HTML (unchanged when
// every attribute is current).
export function buildIntegrity(doc, html, file, repoRoot, problems) {
  const table = loadIntegrity(repoRoot);
  if (!table) { problems.warn(file, 0, null, `integrity not written: ${INTEGRITY_FILE} not found; run: node tools/build-runtime.mjs`); return { html, count: 0 }; }
  const edits = [];
  let count = 0;
  for (const { el, key, what, urlAttr, url } of integrityIncludes(doc)) {
    const expected = table[key];
    if (!expected) { problems.warn(file, line(el), null, `integrity not written: ${INTEGRITY_FILE} has no entry for ${key} (${what}); run: node tools/build-runtime.mjs`); continue; }
    const loc = el.sourceCodeLocation;
    const tag = loc.startTag || loc;
    const u = loc.attrs && loc.attrs[urlAttr];
    let touched = false;
    if (u && versionIn(url) !== versionOf(expected)) { edits.push({ start: u.startOffset, end: u.endOffset, text: `${urlAttr}="${withVersion(url, versionOf(expected))}"` }); touched = true; }
    if (attr(el, 'integrity') === expected) { if (touched) count++; continue; }
    const a = loc.attrs && loc.attrs.integrity;
    if (a) edits.push({ start: a.startOffset, end: a.endOffset, text: `integrity="${expected}"` });
    else {
      const gt = tag.endOffset - (html.slice(tag.endOffset - 2, tag.endOffset) === '/>' ? 2 : 1);
      edits.push({ start: gt, end: gt, text: ` integrity="${expected}"` });
    }
    count++;
  }
  return { html: splice(html, edits), count };
}
