#!/usr/bin/env node
// Generates test/fixtures/fail/<CODE>[.variant].html: one deliberately broken
// article per error code, derived from pass/minimal.html by a small textual
// mutation. Each file starts with a self-describing header:
//   <!-- explainers-test: code=CODE command=validate args=... -->
// test/cli.test.mjs runs the CLI on every file and asserts the code appears.
// Run: node test/fixtures/make-fail.mjs   (outputs are committed)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const base = fs.readFileSync(path.join(here, 'pass/minimal.html'), 'utf8');
const outDir = path.join(here, 'fail');

function replaceOnce(html, from, to) {
  if (!html.includes(from)) throw new Error(`base fixture no longer contains: ${from}`);
  return html.replace(from, to);
}
const r = (from, to) => (html) => replaceOnce(html, from, to);
const before = (anchor, text) => (html) => replaceOnce(html, anchor, text + anchor);
const after = (anchor, text) => (html) => replaceOnce(html, anchor, anchor + text);

// [code, why, mutate, { variant, command, args }]
const FIXTURES = [
  ['SPEC_JSON', 'trailing comma in the figure JSON', r('"steps": "buttons",', '"steps": "buttons",,')],
  ['SPEC_UNKNOWN_KEY', '"colour" is not a layer key', r('"stroke": "mark"', '"colour": "mark"')],
  ['SPEC_MISSING_KEY', 'circle without r', r('"cy": 0, "r": 1, "stroke"', '"cy": 0, "stroke"')],
  ['SPEC_BAD_TYPE', 'r must be a number or expression', r('"r": 1, "stroke"', '"r": true, "stroke"')],
  ['SPEC_UNKNOWN_KIND', 'layer kind blob', r('"id": "rim", "kind": "circle"', '"id": "rim", "kind": "blob"')],
  ['SPEC_DUP_ID', 'two layers named rim', r('"id": "dot"', '"id": "rim"')],
  ['SPEC_BAD_TOKEN', '"red" is not a palette token', r('"fill": "ink"', '"fill": "red"')],
  ['SPEC_BAD_EXPR', 'unbalanced parenthesis', r('"cx": "cos(a)"', '"cx": "cos(a"')],
  ['SPEC_UNKNOWN_IDENT', 'b is not a control or constant', r('"cx": "cos(a)"', '"cx": "cos(b)"')],
  ['SPEC_BAD_FORMAT', 'placeholder without a format', r('"format": "{deg(a):deg}"', '"format": "{deg(a)}"')],
  ['SPEC_RANGE', 'default outside [min, max]', r('"default": 0, "token": "ink"', '"default": 9, "token": "ink"')],
  ['SPEC_CONFLICT', 'values together with min/max', r('"min": 0, "max": 6.283,', '"min": 0, "max": 6.283, "values": [0, 1],')],
  ['SPEC_UNKNOWN_REF', 'play targets a control that does not exist', before('{ "kind": "slider"', '{ "kind": "play", "target": "nope", "rate": 1 },\n      ')],
  ['SPEC_EXPECT_MISMATCH', 'derived constant disagrees with its expect', r('"view": { "x": [-2, 2], "y": [-2, 2] },', '"view": { "x": [-2, 2], "y": [-2, 2] },\n    "constants": { "two": { "value": 3, "expect": "1+1", "tol": 0.1 } },')],
  ['SPEC_STATE_UNKNOWN_CONTROL', 'state sets b, which is not a control', r('"name": "quarter", "a": 1.5708', '"name": "quarter", "b": 1.5708')],
  ['SPEC_STATE_OUT_OF_RANGE', 'state value outside the slider range', r('"a": 1.5708', '"a": 99')],
  ['SPEC_POINT_AT_MISSING', 'point_at names a missing layer', r('"point_at": ["dot"]', '"point_at": ["dot", "nope"]')],
  ['SPEC_NOT_FINITE', '1/a is infinite at the default a=0 (caught by validate)', r('"cy": "sin(a)"', '"cy": "1/a"')],
  ['SPEC_NOT_FINITE', 'same, via the states command', r('"cy": "sin(a)"', '"cy": "1/a"'), { variant: 'states', command: 'states' }],
  ['FIG_ID_MISSING', 'figure id does not start with fig-', r('id="fig-dot" data-aspect', 'id="dot-figure" data-aspect')],
  ['FIG_ASPECT_BAD', 'data-aspect is not W:H', r('data-aspect="1:1"', 'data-aspect="square"')],
  ['FIG_SCRIPT_COUNT', 'two JSON blocks in one figure', before('<figcaption>', '<script type="application/json">{}</script>\n')],
  ['HTML_DUP_ID', 'section id reused', r('<p>At <a href', '<p id="one">At <a href')],
  ['HTML_SCRIPT_FORBIDDEN', 'inline script in the body', before('<details id="glossary"', '<script>alert(1)</script>\n')],
  ['HTML_INCLUDE_MISSING', 'runtime include removed', r('<script defer src="../../dist/explainers-runtime.v1.js"></script>\n', '')],
  ['HTML_MAIN_MISSING', 'no <main>', (h) => replaceOnce(replaceOnce(h, '<main>', '<div>'), '</main>', '</div>')],
  ['PALETTE_MISSING', 'no --c- tokens', (h) => replaceOnce(replaceOnce(h, '    --c-ink: light-dark(#1f4e9c, #8ab4f8);\n', ''), '    --c-mark: light-dark(#b3324a, #ee6c86);\n', '')],
  ['PALETTE_TOO_MANY', 'seven tokens', after('--c-mark: light-dark(#b3324a, #ee6c86);', '\n    --c-a: light-dark(#111, #eee); --c-b: light-dark(#111, #eee); --c-c: light-dark(#111, #eee); --c-d: light-dark(#111, #eee); --c-e: light-dark(#111, #eee);')],
  ['PALETTE_CONTRAST', 'near-white token on a white background', r('--c-ink: light-dark(#1f4e9c, #8ab4f8)', '--c-ink: light-dark(#eeeeee, #8ab4f8)')],
  ['REF_FIG_UNKNOWN', 'data-fig names a figure that is not on the page', r('data-fig="fig-dot" data-ref="dot"', 'data-fig="fig-nope" data-ref="dot"')],
  ['REF_ID_UNKNOWN', 'data-ref names nothing in the figure', r('data-ref="dot"', 'data-ref="nope"')],
  ['REF_STATE_UNKNOWN', 'data-state names an undeclared state', r('data-state="quarter"', 'data-state="half"')],
  ['REF_STATE_HREF', 'data-state link does not point at the figure', r('href="#fig-dot" data-state', 'href="#one" data-state')],
  ['URL_ABSOLUTE', 'absolute image URL', before('<details id="glossary"', '<img src="https://example.com/x.png" alt="">\n')],
  ['GLOSSARY_DFN_NO_LINK', 'first use without the glossary link', r('<dfn id="t-radius"><a href="#g-radius">radius</a></dfn>', '<dfn id="t-radius">radius</dfn>')],
  ['GLOSSARY_SLUG_MISMATCH', 'first use links to another slug', r('<dfn id="t-radius"><a href="#g-radius">', '<dfn id="t-radius"><a href="#g-radii">')],
  ['GLOSSARY_ROW_MISSING', 'term link to a row that does not exist', r('<a class="term" href="#g-radius">', '<a class="term" href="#g-radii">')],
  ['GLOSSARY_BACK_MISSING', 'row without its back-link', r(' <a class="x-back" href="#t-radius" aria-label="back to first use">↩</a>', '')],
  ['GLOSSARY_ORPHAN_ROW', 'row with no first use in the prose', before('  </dl>', '    <div class="row" id="g-extra"><dt>extra <a class="x-back" href="#t-extra">↩</a></dt><dd>Never introduced.</dd></div>\n')],
  ['GLOSSARY_DUP_FIRST_USE', 'the same term marked as first use twice', before('<p>At <a href', '<p>Again the <dfn id="t-radius"><a href="#g-radius">radius</a></dfn>.</p>\n')],
  ['GLOSSARY_ORDER', 'a later use before the first use', before('<p>The <span data-fig', '<p>Early <a class="term" href="#g-radius">radius</a>.</p>\n')],
  ['GLOSSARY_EMPTY_DD', 'empty definition', r('<dd>The distance from the center of a circle to its rim.</dd>', '<dd></dd>')],
  ['GLOSSARY_NOT_LAST', 'content after the glossary inside main', after('</details>\n', '<p>trailing</p>\n')],
  ['TEX_PARSE', 'malformed LaTeX (validate parses every formula)', before('<details id="glossary"', '<span class="x-tex">\\frac{1}</span>\n')],
  ['TEX_PARSE', 'same, via the build command', before('<details id="glossary"', '<span class="x-tex">\\frac{1}</span>\n'), { variant: 'build', command: 'build' }],
  ['TEX_CLASS_UNKNOWN', '\\tok with a name outside the palette', before('<details id="glossary"', '<span class="x-tex">\\tok{red}{x}</span>\n')],
  ['TEX_BANNED', '\\textcolor is banned', before('<details id="glossary"', '<span class="x-tex">\\textcolor{red}{x}</span>\n')],
  ['TEX_RENDER_ERROR', 'an untrusted command renders red instead of throwing', before('<details id="glossary"', '<span class="x-tex">\\htmlId{q}{x}</span>\n')],
  ['TEX_STALE', 'built formula whose content no longer matches data-tex', before('<details id="glossary"', '<span class="x-tex" data-tex="x^2">stale</span>\n')],
  ['BUDGET_OVER', 'a 1 kB budget', (h) => h, { variant: 'budget', command: 'budget', args: '--budget 1k' }],
  ['BUDGET_OVER', 'validate with --budget', (h) => h, { variant: 'validate', command: 'validate', args: '--budget 1k' }],
];

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
for (const [code, why, mutate, opts = {}] of FIXTURES) {
  const name = opts.variant ? `${code}.${opts.variant}.html` : `${code}.html`;
  const header = `<!-- explainers-test: code=${code} command=${opts.command || 'validate'}${opts.args ? ` args="${opts.args}"` : ''} -->\n<!-- broken on purpose: ${why} -->\n`;
  fs.writeFileSync(path.join(outDir, name), header + mutate(base));
}
console.log(`wrote ${FIXTURES.length} fixtures to ${path.relative(process.cwd(), outDir)}`);
