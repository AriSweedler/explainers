// lib/core/deeplink.js — the URL fragment forms the runtime understands.
//   #fig-<slug>=<state>   a figure in a named state
//   #g-<slug>             a glossary row      #t-<slug>  a term's first use
//   #fig-<slug>           just the figure (plain fragment navigation)

const FIG_RE = /^#(fig-[a-z0-9][a-z0-9-]*)(?:=([A-Za-z_][A-Za-z0-9_-]*))?$/;

export function parseHash(hash) {
  const m = FIG_RE.exec(hash || '');
  if (!m) return null;
  return { figId: m[1], state: m[2] || null };
}

export const formatHash = (figId, state) => `#${figId}=${state}`;

export function glossaryTarget(hash) {
  if (!hash) return null;
  if (hash.startsWith('#g-') && hash.length > 3) return { kind: 'row', slug: hash.slice(3), id: hash.slice(1) };
  if (hash.startsWith('#t-') && hash.length > 3) return { kind: 'first', slug: hash.slice(3), id: hash.slice(1) };
  return null;
}
