// Build-time posters and caveat sentences.
//   - `build` puts the figure's first frame (lib/poster-svg.js) as the first
//     child of every <figure class="x-fig">: inline <svg class="x-poster"> up
//     to INLINE_LIMIT bytes of markup, else written to
//     articles/<slug>/assets/poster-<figid>.svg and referenced as
//     <img class="x-poster">. data-poster carries a sha1 over everything the
//     poster depends on, so a second build keeps a current poster byte for
//     byte and `validate` can tell a stale one.
//   - `build` appends the caveat sentence ("Not to scale.") to the figcaption
//     when shows.caveats.not_to_scale is set and the caption lacks it.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { posterSvg, posterSize, POSTER_VERSION, POSTER_WIDTH } from '../../lib/poster-svg.js';
import { attr, elements, elementChildren, hasClass, innerRange, line, textOf, splice } from './html.mjs';

export const INLINE_LIMIT = 8 * 1024;
const CAVEAT_SENTENCES = { not_to_scale: 'Not to scale.' };

const figureEls = (root) => elements(root, (n) => n.tagName === 'figure' && hasClass(n, 'x-fig'));
const posterChild = (fig) => elementChildren(fig).find((n) => (n.tagName === 'svg' || n.tagName === 'img') && hasClass(n, 'x-poster'));
const captionChild = (fig) => elementChildren(fig).find((n) => n.tagName === 'figcaption');
export const posterPath = (figId) => `assets/poster-${figId}.svg`;

// The palette as the emitter wants it: token name -> CSS value, plus --bg/--fg.
export function posterTokens(palette) {
  const t = new Map();
  for (const [k, v] of palette.tokens) t.set(k, v.value);
  if (palette.bg) t.set('--bg', palette.bg.value);
  if (palette.fg) t.set('--fg', palette.fg.value);
  return t;
}

// Everything the poster is a function of: emitter version and width, spec,
// aspect, palette values (the var() fallbacks) and, for scene3d, the caption.
export function posterHash(spec, aspect, tokens, caption = '') {
  return crypto.createHash('sha1').update(JSON.stringify([POSTER_VERSION, POSTER_WIDTH, spec, aspect, [...tokens], caption])).digest('hex');
}

function plan(fig, compiled, tokens) {
  const id = attr(fig, 'id'), aspect = attr(fig, 'data-aspect') || '3:2';
  const cap = captionChild(fig);
  const caption = compiled.type === 'scene3d' && cap ? textOf(cap).trim() : '';
  return { id, aspect, caption, hash: posterHash(compiled.spec, aspect, tokens, caption), existing: posterChild(fig) };
}

// validate mode: every figure has a current poster (warnings; build fixes them).
export function checkPosters(doc, file, figures, palette, problems) {
  const tokens = posterTokens(palette);
  for (const fig of figureEls(doc)) {
    const id = attr(fig, 'id'), compiled = figures.get(id);
    if (!compiled) continue;
    const p = plan(fig, compiled, tokens);
    if (!p.existing) { problems.warn(file, line(fig), id, 'no poster; run: explainers build'); continue; }
    if (attr(p.existing, 'data-poster') !== p.hash) { problems.warn(file, line(p.existing), id, 'poster is stale; run: explainers build'); continue; }
    if (p.existing.tagName === 'img') {
      const src = attr(p.existing, 'src') || '';
      if (!fs.existsSync(path.resolve(path.dirname(file), src))) problems.warn(file, line(p.existing), id, `poster file ${src} not found; run: explainers build`);
    }
  }
}

// build mode. Returns the rewritten HTML, how many posters were (re)written
// and which figures were externalized.
export function buildPosters(doc, html, file, figures, palette) {
  const tokens = posterTokens(palette);
  const edits = [], external = [];
  let count = 0;
  for (const fig of figureEls(doc)) {
    const id = attr(fig, 'id'), compiled = figures.get(id);
    if (!compiled) continue;
    const p = plan(fig, compiled, tokens);
    const rel = posterPath(id), abs = path.resolve(path.dirname(file), rel);
    const current = p.existing && attr(p.existing, 'data-poster') === p.hash && (p.existing.tagName !== 'img' || fs.existsSync(abs));
    if (current) { if (p.existing.tagName === 'img') external.push(id); continue; }
    const svg = posterSvg(compiled, null, { aspect: p.aspect, tokens, id, caption: p.caption, hash: p.hash });
    let markup;
    if (Buffer.byteLength(svg) > INLINE_LIMIT) {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      if (!fs.existsSync(abs) || fs.readFileSync(abs, 'utf8') !== svg) fs.writeFileSync(abs, svg);
      const { width, height } = posterSize(p.aspect);
      markup = `<img class="x-poster" src="${rel}" alt="" width="${width}" height="${height}" aria-hidden="true" data-poster="${p.hash}">`;
      external.push(id);
    } else {
      markup = svg;
      if (fs.existsSync(abs)) fs.unlinkSync(abs); // an earlier build externalized this figure
    }
    if (p.existing) edits.push({ start: p.existing.sourceCodeLocation.startOffset, end: p.existing.sourceCodeLocation.endOffset, text: markup });
    else { const at = fig.sourceCodeLocation.startTag.endOffset; edits.push({ start: at, end: at, text: `\n${markup}` }); }
    count++;
  }
  return { html: splice(html, edits), count, external };
}

// build mode: the caveat sentence in the caption. A caption that already
// says it (any case, any spacing) is left alone; a figure without a
// figcaption gets one.
export function buildCaptions(doc, html, figures) {
  const edits = [];
  let count = 0;
  for (const fig of figureEls(doc)) {
    const compiled = figures.get(attr(fig, 'id'));
    if (!compiled) continue;
    const caveats = compiled.spec.shows.caveats || {};
    const cap = captionChild(fig);
    const text = cap ? textOf(cap) : '';
    const missing = Object.entries(CAVEAT_SENTENCES).filter(([k, s]) => caveats[k] && !new RegExp(s.replace(/\.$/, '').replace(/\s+/g, '\\s+'), 'i').test(text)).map(([, s]) => s);
    if (!missing.length) continue;
    if (cap && innerRange(cap)) {
      const range = innerRange(cap), inner = html.slice(range.start, range.end);
      const spoken = text.trimEnd();
      const glue = spoken === '' ? '' : /[.!?…]["')\]]?$/.test(spoken) ? ' ' : '. ';
      const at = range.start + inner.trimEnd().length;
      edits.push({ start: at, end: at, text: glue + missing.join(' ') });
    } else if (fig.sourceCodeLocation.endTag) {
      const at = fig.sourceCodeLocation.endTag.startOffset;
      edits.push({ start: at, end: at, text: `<figcaption>${missing.join(' ')}</figcaption>\n` });
    } else continue;
    count++;
  }
  return { html: splice(html, edits), count };
}
