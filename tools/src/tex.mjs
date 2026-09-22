// Build-time KaTeX: render every <span class="x-tex"> / <div class="x-tex"> to
// htmlAndMathml in place, keeping the LaTeX source in data-tex so the step is
// idempotent and the validator can detect stale output.
//
// Configuration verified in the design research:
//   - strict: only 'htmlExtension' is ignored (strict:'error' alone rejects every \htmlClass)
//   - trust: only \htmlClass with a class in the article palette
//   - \tok{token}{x} is a fixed macro for \htmlClass{token}{x}
//   - an untrusted \htmlClass does NOT throw; it renders red (#cc0000) source
//     text, so the class names are pre-scanned and the output is grepped.
import katex from 'katex';
import { attr, elements, hasClass, innerRange, line, textOf, escapeAttr, splice } from './html.mjs';

const CLASS_RE = /\\(?:htmlClass|tok)\s*\{([^}]*)\}/g;
const BANNED_RE = /\\(textcolor|color)\b/;

export const texElements = (doc) => elements(doc, (n) => (n.tagName === 'span' || n.tagName === 'div') && hasClass(n, 'x-tex'));

export function prescan(src, palette) {
  const banned = BANNED_RE.exec(src);
  if (banned) return { code: 'TEX_BANNED', message: `\\${banned[1]} is not allowed; use \\tok{token}{...}` };
  for (const m of src.matchAll(CLASS_RE)) {
    const name = m[1].trim();
    if (!palette.has(name)) return { code: 'TEX_CLASS_UNKNOWN', message: `\\tok{${name}} is not a palette token (${[...palette].join(', ')})` };
  }
  return null;
}

export function renderTex(src, { display, palette }) {
  const pre = prescan(src, palette);
  if (pre) return { error: pre };
  let html;
  try {
    html = katex.renderToString(src, {
      displayMode: display,
      output: 'htmlAndMathml',
      throwOnError: true,
      strict: (code) => (code === 'htmlExtension' ? 'ignore' : 'error'),
      trust: (ctx) => ctx.command === '\\htmlClass' && palette.has(ctx.class),
      macros: { '\\tok': '\\htmlClass{#1}{#2}' },
    });
  } catch (e) {
    return { error: { code: 'TEX_PARSE', message: e.message.replace(/^KaTeX parse error: /, '') } };
  }
  if (html.includes('#cc0000')) return { error: { code: 'TEX_RENDER_ERROR', message: 'KaTeX rendered an error span (untrusted or rejected command)' } };
  return { html };
}

function sourceOf(el) {
  const data = attr(el, 'data-tex');
  return data !== undefined ? data : textOf(el).trim();
}

// validate mode: every formula parses; built formulas are up to date.
export function checkTex(doc, html, file, palette, problems) {
  for (const el of texElements(doc)) {
    const src = sourceOf(el);
    const r = renderTex(src, { display: el.tagName === 'div', palette });
    if (r.error) { problems.error(file, line(el), r.error.code, null, r.error.message); continue; }
    if (attr(el, 'data-tex') === undefined) { problems.warn(file, line(el), null, 'formula not built yet; run: explainers build'); continue; }
    const range = innerRange(el);
    if (range && html.slice(range.start, range.end) !== r.html) {
      problems.error(file, line(el), 'TEX_STALE', null, 'rendered content does not match data-tex; run: explainers build');
    }
  }
}

// build mode: returns the rewritten HTML text (unchanged when nothing to do).
export function buildTex(doc, html, file, palette, problems) {
  const edits = [];
  let count = 0;
  for (const el of texElements(doc)) {
    const range = innerRange(el);
    if (!range) { problems.error(file, line(el), 'TEX_PARSE', null, '.x-tex element has no end tag'); continue; }
    const src = sourceOf(el);
    const r = renderTex(src, { display: el.tagName === 'div', palette });
    if (r.error) { problems.error(file, line(el), r.error.code, null, r.error.message); continue; }
    if (attr(el, 'data-tex') === undefined) {
      const gt = el.sourceCodeLocation.startTag.endOffset - 1;
      edits.push({ start: gt, end: gt, text: ` data-tex="${escapeAttr(src)}"` });
    }
    edits.push({ start: range.start, end: range.end, text: r.html });
    count++;
  }
  return { html: splice(html, edits), count };
}
