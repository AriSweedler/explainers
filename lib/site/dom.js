// lib/site/dom.js — a two-line element builder.
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined && v !== false) el.setAttribute(k, v === true ? '' : v);
  el.append(...children.filter((c) => c !== null && c !== undefined));
  return el;
}

export function emit(el, type, detail) {
  el.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));
}
