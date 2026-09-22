// Thin helpers over parse5's default tree adapter, with source positions.
import * as parse5 from 'parse5';

export function parseHtml(text) {
  return parse5.parse(text, { sourceCodeLocationInfo: true });
}

export function* walk(node) {
  yield node;
  for (const c of node.childNodes || []) yield* walk(c);
  if (node.content) yield* walk(node.content); // <template>
}

export const isElement = (n) => typeof n.tagName === 'string';
export const attr = (el, name) => el.attrs?.find((a) => a.name === name)?.value;
export const hasAttr = (el, name) => !!el.attrs?.some((a) => a.name === name);
export const classes = (el) => (attr(el, 'class') || '').split(/\s+/).filter(Boolean);
export const hasClass = (el, cls) => classes(el).includes(cls);
export const line = (node) => node.sourceCodeLocation?.startLine ?? 0;
export const offset = (node) => node.sourceCodeLocation?.startOffset ?? 0;
export const elementChildren = (el) => (el.childNodes || []).filter(isElement);

export function elements(root, pred = () => true) {
  const out = [];
  for (const n of walk(root)) if (isElement(n) && pred(n)) out.push(n);
  return out;
}

export function byTag(root, tag) { return elements(root, (n) => n.tagName === tag); }

export function textOf(node) {
  if (node.nodeName === '#text') return node.value;
  return (node.childNodes || []).map(textOf).join('');
}

export function closest(node, pred) {
  for (let n = node.parentNode; n; n = n.parentNode) if (isElement(n) && pred(n)) return n;
  return null;
}

// Character range of an element's inner HTML in the source text, or null for
// void/unclosed elements.
export function innerRange(el) {
  const loc = el.sourceCodeLocation;
  if (!loc?.startTag || !loc.endTag) return null;
  return { start: loc.startTag.endOffset, end: loc.endTag.startOffset };
}

export function escapeAttr(s) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// Apply non-overlapping { start, end, text } edits to a string.
export function splice(text, edits) {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let out = text;
  for (const e of sorted) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

// Is a URL relative to the document (or a fragment)?
export function isRelativeUrl(url) {
  const u = url.trim();
  if (u === '' || u.startsWith('#')) return true;
  if (u.startsWith('//') || u.startsWith('/')) return false;
  return !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(u);
}

export function hostOf(url) {
  try { return new URL(url).host; } catch { return null; }
}
