// explainers — validate | states | build | budget | vocab
// Bundled by tools/build-cli.mjs into tools/explainers.cjs (single file, no
// npm install to run). Every failure prints `file:line: CODE figure-id: message`
// to stderr and exits 1.
import fs from 'node:fs';
import path from 'node:path';
import { describeVocabulary, ERROR_CATALOGUE } from '../../lib/spec.js';
import { describeFunctions } from '../../lib/expr.js';
import { Problems } from './report.mjs';
import { loadArticle, validateArticle, compileFigures, checkFigureStates } from './article.mjs';
import { parseHtml } from './html.mjs';
import { extractPalette } from './palette.mjs';
import { buildTex } from './tex.mjs';
import { buildPosters, buildCaptions } from './poster.mjs';
import { buildIntegrity } from './integrity.mjs';
import { parseBudget, checkBudget, formatReport, DEFAULT_BUDGET } from './budget.mjs';

// Filled in by esbuild's define when bundled; see tools/build-cli.mjs.
const VERSIONS = typeof __EXPLAINERS_VERSIONS__ !== 'undefined' ? __EXPLAINERS_VERSIONS__ : { cli: 'unbundled' };

const USAGE = `explainers — validator and builder for explainer articles

usage:
  node tools/explainers.cjs validate <html...> [--budget 170k]
  node tools/explainers.cjs states   <html...>
  node tools/explainers.cjs build    <html...>
  node tools/explainers.cjs budget   <html...> [--budget 170k]
  node tools/explainers.cjs vocab                 (print the vocabulary as markdown)
  node tools/explainers.cjs errors                (print the error catalogue)
  node tools/explainers.cjs --version | --help

validate  figure specs (schema, expressions, ranges, states), page structure,
          prose refs (data-fig/data-ref/data-state), relative URLs, palette,
          glossary contract, KaTeX parse and staleness; --budget adds the byte budget.
states    enumerate notice.states per figure and evaluate every expression at
          the defaults, at each state, and with each played control at min/default/max.
build     in place, idempotent: render every .x-tex with KaTeX (htmlAndMathml),
          keeping the source in data-tex; put each figure's first frame in front
          of its JSON block as <svg class="x-poster"> (or assets/poster-<fig>.svg
          above 8 KiB); append the caveat sentence to the figcaption; resolve
          integrity="{{integrity:dist/...}}" from dist/integrity.json.
budget    gzip bytes of HTML + runtime + CSS + KaTeX CSS against --budget (default ${DEFAULT_BUDGET}).

Every failure prints  file:line: CODE figure-id: message  and exits 1.`;

function findRepoRoot(start) {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'lib', 'spec.js')) && fs.existsSync(path.join(dir, 'tools'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

function parseArgs(argv) {
  const args = { command: null, files: [], budget: undefined, help: false, version: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--version' || a === '-v') args.version = true;
    else if (a === '--budget') {
      args.budget = argv[++i];
      if (args.budget === undefined) throw new Error('--budget needs a value, e.g. --budget 170k');
    }
    else if (a.startsWith('--budget=')) args.budget = a.slice(9);
    else if (a.startsWith('-')) throw new Error(`unknown option ${a}`);
    else if (!args.command) args.command = a;
    else args.files.push(a);
  }
  return args;
}

function cmdValidate(files, budget, repoRoot, problems, out) {
  for (const file of files) {
    const article = loadArticle(file);
    const { figures } = validateArticle(article, { repoRoot, budget, problems });
    out.write(`${file}: ${figures.size} figure(s) checked\n`);
  }
}

function cmdStates(files, problems, out) {
  for (const file of files) {
    const article = loadArticle(file);
    const palette = extractPalette(article.doc);
    const figures = compileFigures(article, palette.names, problems);
    for (const fig of figures.values()) {
      if (!fig) continue; // spec failed; already reported
      out.write(`${file} ${fig.figureId} (${fig.type}): ${fig.states.length} state(s)${fig.states.length ? ': ' + fig.states.join(', ') : ''}\n`);
      for (const l of checkFigureStates(file, fig, problems)) out.write(l + '\n');
    }
  }
}

// Four passes, each re-parsing the text the previous one produced so their
// edits never overlap: math, posters, caveat sentences, integrity.
function cmdBuild(files, repoRoot, problems, out) {
  for (const file of files) {
    const article = loadArticle(file);
    const palette = extractPalette(article.doc);
    const before = problems.errors.length;
    const tex = buildTex(article.doc, article.html, file, new Set(palette.names), problems);
    if (problems.errors.length > before) continue;
    let html = tex.html, doc = parseHtml(html);
    const figures = compileFigures({ file, doc }, palette.names, problems);
    if (problems.errors.length > before) continue;
    const valid = new Map([...figures].filter(([, c]) => c));
    const posters = buildPosters(doc, html, file, valid, palette);
    html = posters.html; doc = parseHtml(html);
    const captions = buildCaptions(doc, html, valid);
    html = captions.html; doc = parseHtml(html);
    const integrity = buildIntegrity(doc, html, file, repoRoot, problems);
    html = integrity.html;
    if (problems.errors.length > before) continue;
    if (html !== article.html) fs.writeFileSync(file, html);
    const ext = posters.external.length ? ` (${posters.external.length} external: ${posters.external.join(', ')})` : '';
    out.write(`${file}: ${tex.count} formula(s) rendered, ${posters.count} poster(s) written${ext}, ${captions.count} caption(s) amended, ${integrity.count} integrity attribute(s) set${html === article.html ? ' (unchanged)' : ''}\n`);
  }
}

function cmdBudget(files, budget, repoRoot, problems, out) {
  for (const file of files) {
    const article = loadArticle(file);
    const report = checkBudget(file, article.html, article.doc, repoRoot, budget, problems);
    out.write(`${file}:\n${formatReport(report, budget)}\n`);
  }
}

export function main(argv, { stdout = process.stdout, stderr = process.stderr, here = process.cwd() } = {}) {
  let args;
  try { args = parseArgs(argv); } catch (e) { stderr.write(`${e.message}\n${USAGE}\n`); return 2; }
  if (args.version) { stdout.write(`explainers-cli ${Object.entries(VERSIONS).map(([k, v]) => `${k} ${v}`).join(', ')}\n`); return 0; }
  if (args.help || !args.command) { stdout.write(USAGE + '\n'); return args.help ? 0 : 2; }
  if (args.command === 'vocab') { stdout.write(describeVocabulary() + '\n' + describeFunctions() + '\n'); return 0; }
  if (args.command === 'errors') { for (const [c, d] of Object.entries(ERROR_CATALOGUE)) stdout.write(`${c}: ${d}\n`); return 0; }

  const commands = ['validate', 'states', 'build', 'budget'];
  if (!commands.includes(args.command)) { stderr.write(`unknown command "${args.command}"\n${USAGE}\n`); return 2; }
  if (args.files.length === 0) { stderr.write(`${args.command}: give at least one HTML file\n`); return 2; }
  for (const f of args.files) if (!fs.existsSync(f)) { stderr.write(`${f}: no such file\n`); return 2; }

  const problems = new Problems();
  const repoRoot = findRepoRoot(here);
  try {
    const budget = args.budget !== undefined ? parseBudget(args.budget) : undefined;
    switch (args.command) {
      case 'validate': cmdValidate(args.files, budget, repoRoot, problems, stdout); break;
      case 'states': cmdStates(args.files, problems, stdout); break;
      case 'build': cmdBuild(args.files, repoRoot, problems, stdout); break;
      case 'budget': cmdBudget(args.files, budget ?? parseBudget(DEFAULT_BUDGET), repoRoot, problems, stdout); break;
      default: break;
    }
  } catch (e) {
    stderr.write(`${e.message}\n`);
    return 2;
  }
  problems.print(stderr);
  if (!problems.ok) stderr.write(`${problems.errors.length} error(s)\n`);
  return problems.ok ? 0 : 1;
}

// Run when executed directly (bundle or `node tools/src/cli.mjs`). The repo
// root is found from the script's own location so the CLI works from any cwd.
const invokedDirectly = typeof require !== 'undefined' ? require.main === module : /cli\.mjs$/.test(process.argv[1] || '');
if (invokedDirectly) {
  process.exitCode = main(process.argv.slice(2), { here: path.dirname(path.resolve(process.argv[1])) });
}
