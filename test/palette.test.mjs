// The palette cap and the contrast check in tools/src/palette.mjs: 12 tokens
// pass, 13 fail (PALETTE_TOO_MANY), and every token is still contrast-checked
// in both schemes whatever the count.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_TOKENS, ERROR_CATALOGUE } from '../lib/spec.js';
// tools/src needs tools/node_modules (parse5, a maintainer install that CI does not have):
// load it dynamically and skip the checks that need it when it is absent.
let checkPalette, contrastRatio, parseLightDark, Problems;
try {
  ({ checkPalette, contrastRatio, parseLightDark } = await import('../tools/src/palette.mjs'));
  ({ Problems } = await import('../tools/src/report.mjs'));
} catch { /* fall through: skip below */ }
const skip = checkPalette ? false : 'tools/src needs tools/node_modules (cd tools && npm install)';

const BG = { value: 'light-dark(#faf8f5, #151412)', line: 7 };
// a dozen distinct hues, each >= 3:1 against both backgrounds
const HUES = ['#1f4e9c', '#b3324a', '#2e7d32', '#8e4b00', '#6a1b9a', '#00695c', '#ad1457', '#4e342e', '#283593', '#827717', '#c62828', '#37474f'];
const DARK = ['#8ab4f8', '#ee6c86', '#81c784', '#ffb74d', '#ce93d8', '#80cbc4', '#f48fb1', '#bcaaa4', '#9fa8da', '#dce775', '#ef9a9a', '#b0bec5'];

function palette(n, { lowContrastAt = -1 } = {}) {
  const tokens = new Map();
  for (let i = 0; i < n; i++) {
    const [l, d] = i === lowContrastAt ? ['#eeeeee', DARK[i % DARK.length]] : [HUES[i % HUES.length], DARK[i % DARK.length]];
    tokens.set(`tok${i}`, { value: `light-dark(${l}, ${d})`, line: 10 + i });
  }
  return { tokens, bg: BG, fg: null, names: [...tokens.keys()] };
}

function run(p) {
  const problems = new Problems();
  checkPalette(p, 'a.html', problems);
  return problems;
}

test('the cap is 12 tokens, and the catalogue text says so', { skip }, () => {
  assert.equal(MAX_TOKENS, 12);
  assert.match(ERROR_CATALOGUE.PALETTE_TOO_MANY, /more than 12/);
  for (const [i, hex] of HUES.entries()) {
    assert.ok(contrastRatio(hex, parseLightDark(BG.value)[0]) >= 3, `${hex} on light`);
    assert.ok(contrastRatio(DARK[i], parseLightDark(BG.value)[1]) >= 3, `${DARK[i]} on dark`);
  }});

test('12 tokens pass; 13 fail with PALETTE_TOO_MANY naming the cap and every token', { skip }, () => {
  const twelve = run(palette(12));
  assert.ok(twelve.ok, twelve.errors.map((e) => e.message).join('; '));
  assert.equal(twelve.warnings.length, 0);
  const thirteen = run(palette(13));
  assert.equal(thirteen.errors.length, 1);
  assert.equal(thirteen.errors[0].code, 'PALETTE_TOO_MANY');
  assert.match(thirteen.errors[0].message, /13 tokens declared; at most 12 \(tok0, .*tok12\)/);
  assert.ok(run(palette(6)).ok, 'the old cap still passes');
  assert.ok(run(palette(7)).ok, 'seven tokens, once refused, now pass');});

test('contrast is checked for every token in both schemes, at 12 and above 12', { skip }, () => {
  const weakLast = run(palette(12, { lowContrastAt: 11 }));
  assert.deepEqual(weakLast.errors.map((e) => e.code), ['PALETTE_CONTRAST']);
  assert.match(weakLast.errors[0].message, /--c-tok11 #eeeeee on light --bg #faf8f5 is \d\.\d\d:1; needs 3:1/);
  assert.equal(weakLast.errors[0].line, 21, 'the error points at the token line');
  const both = run(palette(13, { lowContrastAt: 3 }));
  assert.deepEqual(both.errors.map((e) => e.code), ['PALETTE_TOO_MANY', 'PALETTE_CONTRAST'], 'too many and low contrast are both reported');
  // a dark-scheme failure is caught too
  const p = palette(12);
  p.tokens.set('tok5', { value: 'light-dark(#1f4e9c, #222222)', line: 15 });
  const dark = run(p);
  assert.deepEqual(dark.errors.map((e) => e.code), ['PALETTE_CONTRAST']);
  assert.match(dark.errors[0].message, /on dark --bg #151412/);});
