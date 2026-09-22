// Palette extraction from the article's inline <style>, plus the >= 3:1
// contrast check against --bg in both schemes.
import { MAX_TOKENS } from '../../lib/spec.js';
import { byTag, line, textOf } from './html.mjs';

const TOKEN_RE = /--c-([a-zA-Z][\w-]*)\s*:\s*([^;}]+)/g;
const BG_RE = /--bg\s*:\s*([^;}]+)/;
const FG_RE = /--fg\s*:\s*([^;}]+)/;
const LIGHT_DARK_RE = /^light-dark\(\s*(#[0-9a-fA-F]{3,8})\s*,\s*(#[0-9a-fA-F]{3,8})\s*\)$/;

export function extractPalette(doc) {
  const tokens = new Map(); // name -> { value, line }
  let bg = null, fg = null;
  for (const style of byTag(doc, 'style')) {
    const css = textOf(style);
    for (const m of css.matchAll(TOKEN_RE)) tokens.set(m[1], { value: m[2].trim(), line: line(style) });
    const b = BG_RE.exec(css);
    if (b) bg = { value: b[1].trim(), line: line(style) };
    const f = FG_RE.exec(css);
    if (f) fg = { value: f[1].trim(), line: line(style) };
  }
  return { tokens, bg, fg, names: [...tokens.keys()] };
}

export function parseLightDark(value) {
  const m = LIGHT_DARK_RE.exec(value.trim());
  return m ? [m[1], m[2]] : null;
}

function hexToRgb(hex) {
  let h = hex.slice(1);
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

export function checkPalette(palette, file, problems) {
  const { tokens, bg } = palette;
  if (tokens.size === 0) {
    problems.error(file, 0, 'PALETTE_MISSING', null, 'no --c-<name> tokens found in an inline <style> :root rule');
    return;
  }
  if (tokens.size > MAX_TOKENS) {
    problems.error(file, [...tokens.values()][0].line, 'PALETTE_TOO_MANY', null, `${tokens.size} tokens declared; at most ${MAX_TOKENS} (${[...tokens.keys()].join(', ')})`);
  }
  const bgPair = bg && parseLightDark(bg.value);
  if (!bgPair) {
    problems.warn(file, bg?.line || 0, null, 'contrast not checked: --bg is not light-dark(#light, #dark)');
    return;
  }
  for (const [name, t] of tokens) {
    const pair = parseLightDark(t.value);
    if (!pair) { problems.warn(file, t.line, null, `contrast not checked for --c-${name}: value is not light-dark(#light, #dark)`); continue; }
    for (const [i, scheme] of ['light', 'dark'].entries()) {
      const ratio = contrastRatio(pair[i], bgPair[i]);
      if (ratio < 3) problems.error(file, t.line, 'PALETTE_CONTRAST', null, `--c-${name} ${pair[i]} on ${scheme} --bg ${bgPair[i]} is ${ratio.toFixed(2)}:1; needs 3:1`);
    }
  }
}
