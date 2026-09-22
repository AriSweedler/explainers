// Whole-article checks: figures and their JSON specs, page structure, prose
// references, URLs, palette, glossary, math and budget.
import fs from 'node:fs';
import { validateSpec, scopeForState, evaluateAll, windowToMs, FigSpecError } from '../../lib/spec.js';
import { parseHtml, elements, byTag, attr, hasAttr, hasClass, line, elementChildren, textOf, isRelativeUrl, hostOf } from './html.mjs';
import { extractPalette, checkPalette } from './palette.mjs';
import { checkGlossary } from './glossary.mjs';
import { checkTex } from './tex.mjs';
import { checkBudget } from './budget.mjs';

const ALLOWED_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);
const FIG_ID_RE = /^fig-[a-z0-9][a-z0-9-]*$/;
const ASPECT_RE = /^[1-9]\d*:[1-9]\d*$/;

export function loadArticle(file) {
  const html = fs.readFileSync(file, 'utf8');
  return { file, html, doc: parseHtml(html) };
}

export const figureElements = (doc) => elements(doc, (n) => n.tagName === 'figure' && hasClass(n, 'x-fig'));
const jsonScripts = (fig) => elementChildren(fig).filter((n) => n.tagName === 'script' && attr(n, 'type') === 'application/json');

// Parse and validate every figure spec. Returns Map(figureId -> compiled);
// figures that exist but failed get `null` so reference checks stay quiet
// about them (the spec error is the root cause).
export function compileFigures({ file, doc }, palette, problems) {
  const figures = new Map();
  for (const fig of figureElements(doc)) {
    const id = attr(fig, 'id');
    if (!id || !FIG_ID_RE.test(id)) { problems.error(file, line(fig), 'FIG_ID_MISSING', id, 'figure needs id="fig-<slug>" (lowercase, digits, hyphens)'); continue; }
    if (hasAttr(fig, 'data-static')) continue; // pre-rendered image in the same wrapper
    figures.set(id, null);
    const aspect = attr(fig, 'data-aspect');
    if (!aspect || !ASPECT_RE.test(aspect)) problems.error(file, line(fig), 'FIG_ASPECT_BAD', id, `data-aspect must be W:H, got ${JSON.stringify(aspect)}`);
    const scripts = jsonScripts(fig);
    if (scripts.length !== 1) { problems.error(file, line(fig), 'FIG_SCRIPT_COUNT', id, `expected exactly one <script type="application/json"> child, found ${scripts.length}`); continue; }
    const script = scripts[0];
    let spec;
    try { spec = JSON.parse(textOf(script)); } catch (e) { problems.error(file, line(script), 'SPEC_JSON', id, e.message); continue; }
    try {
      figures.set(id, validateSpec(spec, { figureId: id, palette }));
    } catch (e) {
      if (!(e instanceof FigSpecError)) throw e;
      problems.error(file, line(script), e.code, id, `${e.path}: ${e.detail}`);
    }
  }
  return figures;
}

const validFigures = (figures) => new Map([...figures].filter(([, c]) => c));

function checkStructure({ file, doc }, problems) {
  if (byTag(doc, 'main').length !== 1) problems.error(file, 0, 'HTML_MAIN_MISSING', null, 'the article needs exactly one <main>');

  const seen = new Map();
  for (const el of elements(doc, (n) => hasAttr(n, 'id'))) {
    const id = attr(el, 'id');
    if (seen.has(id)) problems.error(file, line(el), 'HTML_DUP_ID', null, `id "${id}" already used at line ${seen.get(id)}`);
    else seen.set(id, line(el));
  }

  let runtime = false;
  for (const s of byTag(doc, 'script')) {
    const src = attr(s, 'src');
    if (src && /(^|\/)dist\/explainers-runtime\.v\d+\.js$/.test(src)) { runtime = true; continue; }
    if (attr(s, 'type') === 'application/json' && s.parentNode?.tagName === 'figure' && hasClass(s.parentNode, 'x-fig')) continue;
    problems.error(file, line(s), 'HTML_SCRIPT_FORBIDDEN', null, 'only the runtime include and figure JSON blocks may be <script> elements');
  }
  const css = byTag(doc, 'link').some((l) => attr(l, 'rel') === 'stylesheet' && /(^|\/)dist\/explainers\.v\d+\.css$/.test(attr(l, 'href') || ''));
  if (!runtime) problems.error(file, 0, 'HTML_INCLUDE_MISSING', null, 'missing <script defer src="../../dist/explainers-runtime.v1.js">');
  if (!css) problems.error(file, 0, 'HTML_INCLUDE_MISSING', null, 'missing <link rel="stylesheet" href="../../dist/explainers.v1.css">');
}

function checkUrls({ file, doc }, problems) {
  for (const el of elements(doc, (n) => hasAttr(n, 'src') || hasAttr(n, 'href'))) {
    const url = attr(el, 'src') ?? attr(el, 'href');
    if (isRelativeUrl(url) || url.startsWith('data:')) continue;
    if (el.tagName === 'a' && (attr(el, 'rel') || '').split(/\s+/).includes('external')) continue;
    if (ALLOWED_HOSTS.has(hostOf(url))) continue;
    problems.error(file, line(el), 'URL_ABSOLUTE', null, `<${el.tagName}> ${hasAttr(el, 'src') ? 'src' : 'href'}="${url}" must be relative or a fragment (or <a rel="external">)`);
  }
}

function checkRefs({ file, doc }, figures, problems) {
  for (const el of elements(doc, (n) => hasAttr(n, 'data-fig'))) {
    const figId = attr(el, 'data-fig'), ref = attr(el, 'data-ref');
    const fig = figures.get(figId);
    if (fig === null) continue; // figure exists but its spec failed; already reported
    if (!fig) { problems.error(file, line(el), 'REF_FIG_UNKNOWN', figId, `data-fig="${figId}" is not a figure on this page`); continue; }
    if (!ref || !fig.refIds.includes(ref)) problems.error(file, line(el), 'REF_ID_UNKNOWN', figId, `data-ref="${ref}" is not a layer, object, control or readout of ${figId} (${fig.refIds.join(', ')})`);
  }
  for (const a of elements(doc, (n) => n.tagName === 'a' && hasAttr(n, 'data-state'))) {
    const href = attr(a, 'href') || '', state = attr(a, 'data-state');
    const figId = href.startsWith('#') ? href.slice(1) : null;
    if (!figId || !FIG_ID_RE.test(figId)) { problems.error(file, line(a), 'REF_STATE_HREF', null, `<a data-state="${state}"> needs href="#fig-<slug>", got "${href}"`); continue; }
    const fig = figures.get(figId);
    if (fig === null) continue; // already reported
    if (!fig) { problems.error(file, line(a), 'REF_FIG_UNKNOWN', figId, `href="#${figId}" is not a figure on this page`); continue; }
    if (!fig.states.includes(state)) problems.error(file, line(a), 'REF_STATE_UNKNOWN', figId, `state "${state}" is not declared by ${figId} (${fig.states.join(', ') || 'no states'})`);
  }
}

export function validateArticle(article, { repoRoot, budget, problems }) {
  const palette = extractPalette(article.doc);
  checkPalette(palette, article.file, problems);
  checkStructure(article, problems);
  const figures = compileFigures(article, palette.names, problems);
  checkRefs(article, figures, problems);
  checkUrls(article, problems);
  checkGlossary(article.doc, article.file, problems);
  checkTex(article.doc, article.html, article.file, new Set(palette.names), problems);
  const valid = validFigures(figures);
  for (const fig of valid.values()) checkFigureStates(article.file, fig, problems);
  const report = budget !== undefined ? checkBudget(article.file, article.html, article.doc, repoRoot, budget, problems) : null;
  return { figures: valid, palette, report };
}

// The animated control(s) of a figure: every play target.
function playTargets(fig) {
  return fig.spec.manipulates.controls.filter((c) => c.kind === 'play').map((c) => fig.controls.find((x) => x.name === c.target));
}

function sweepValues(control) {
  let values;
  if (control.kind === 'time') values = control.mode === 'scrub' ? [0, control.default, windowToMs(control.window)] : [0];
  else if ('values' in control) values = [control.values[0], control.default, control.values.at(-1)];
  else values = [control.min, control.default, control.max];
  return [...new Set(values)];
}

// Evaluate every expression at the defaults, at every state, and with each
// played control at its min, default and max. Returns the per-state lines.
export function checkFigureStates(file, fig, problems) {
  const lines = [];
  const scriptLine = 0;
  const run = (label, scope) => {
    try {
      const r = evaluateAll(fig, scope);
      lines.push(`  ${label.padEnd(14)} ${[...scope].filter(([k]) => fig.exposedNames.includes(k)).map(([k, v]) => `${k}=${v}`).join(' ')}  (${r.size} expressions finite)`);
    } catch (e) {
      if (!(e instanceof FigSpecError)) throw e;
      problems.error(file, scriptLine, e.code, fig.figureId, `${e.path} at state ${label}: ${e.detail}`);
    }
  };
  run('default', scopeForState(fig, null));
  for (const name of fig.states) run(name, scopeForState(fig, name));
  for (const target of playTargets(fig)) {
    for (const v of sweepValues(target)) run(`${target.name}=${v}`, scopeForState(fig, null, { [target.name]: v }));
  }
  return lines;
}
