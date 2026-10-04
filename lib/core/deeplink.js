// lib/core/deeplink.js — the URL fragment forms the runtime understands.
//   #fig-<slug>=<state>              a figure in a named state
//   #<tabs>=<n>                      the n-th tab (1-based) of <div class="x-tabs" id="<tabs>">
//   #<tabs>=<n>&fig-<slug>=<state>   several key=value pairs joined by &, in any order
//   #g-<slug>   #t-<slug>            a glossary row; a term's first use
//   #<id>                            a plain fragment (a figure, a section, anything with an id)
// A hash is either one plain id (no "=") or a list of pairs, never both. A
// pair list holds at most one fig- pair (the figure the link lands on) and one
// pair per tabs group. Pairs the grammar rejects are dropped, so an old
// single-pair hash and a hash with a stray part both still read.

const KEY_RE = /^[A-Za-z_][\w-]*$/;
const VALUE_RE = /^[A-Za-z0-9_][\w-]*$/;
const FIG_KEY_RE = /^fig-[a-z0-9][a-z0-9-]*$/;
const STATE_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;

// [[key, value], ...] in hash order; [] for a plain fragment.
export function parsePairs(hash) {
  const body = (hash || '').replace(/^#/, '');
  if (!body.includes('=')) return [];
  const out = [];
  for (const part of body.split('&')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i), value = part.slice(i + 1);
    if (KEY_RE.test(key) && VALUE_RE.test(value) && !out.some(([k]) => k === key)) out.push([key, value]);
  }
  return out;
}

export function pairOf(hash, key) {
  const p = parsePairs(hash).find(([k]) => k === key);
  return p ? p[1] : null;
}

// The hash with one pair set: replaced in place when the key is present,
// appended otherwise; `drop(key)` names other keys the new pair supersedes.
// A plain fragment (no pairs) is consumed: the reader has landed on it.
export function withPair(hash, key, value, { drop = () => false } = {}) {
  const pairs = parsePairs(hash).filter(([k]) => k === key || !drop(k));
  const at = pairs.findIndex(([k]) => k === key);
  if (at >= 0) pairs[at] = [key, value]; else pairs.push([key, value]);
  return `#${pairs.map(([k, v]) => `${k}=${v}`).join('&')}`;
}

// The one plain id of a fragment without pairs, or null.
export function plainTarget(hash) {
  const body = (hash || '').replace(/^#/, '');
  return body && !body.includes('=') && !body.includes('&') ? body : null;
}

// The figure link in a hash: { figId, state } for #fig-x=state (among any
// other pairs) and { figId, state: null } for a plain #fig-x; null otherwise.
export function parseHash(hash) {
  const pairs = parsePairs(hash);
  if (!pairs.length) {
    const id = plainTarget(hash);
    return id && FIG_KEY_RE.test(id) ? { figId: id, state: null } : null;
  }
  const fig = pairs.find(([k]) => FIG_KEY_RE.test(k));
  return fig && STATE_RE.test(fig[1]) ? { figId: fig[0], state: fig[1] } : null;
}

// #fig-x=state, keeping the tab pairs of `base` and replacing any other
// figure pair: a hash lands on one figure.
export const formatHash = (figId, state, base = '') => withPair(base, figId, state, { drop: (k) => FIG_KEY_RE.test(k) });

export function glossaryTarget(hash) {
  if (!hash) return null;
  if (hash.startsWith('#g-') && hash.length > 3) return { kind: 'row', slug: hash.slice(3), id: hash.slice(1) };
  if (hash.startsWith('#t-') && hash.length > 3) return { kind: 'first', slug: hash.slice(3), id: hash.slice(1) };
  return null;
}
