// Cloudflare Worker serving the GitHub Pages site at https://explainers.sweedler.com.
//   /                 -> arisweedler.github.io/explainers/                 (the index)
//   /XXX              -> .../explainers/articles/XXX                       (short article URLs)
//   /articles/XXX     -> 301 to /XXX                                       (index-card links)
//   /dist/…  /assets/…  /favicon.svg  /404.html  /index.html  /robots.txt
//                     -> .../explainers/<same path>                        (assets the pages load relatively)
//   /explainers/…     passes through unchanged.
// Only slash-terminated prefixes are special: /articles, /dist and /assets without a trailing
// slash fall into the /XXX rule. worker.test.mjs pins every row of this table.
// The upstream origin is env.UPSTREAM (default https://arisweedler.github.io) so the same handler
// can front another origin in tests and in tools/proxy-dev.mjs.
// Deploy with `npx wrangler deploy` from this directory; the custom-domain route in wrangler.toml
// creates the DNS record on the sweedler.com zone.

export const DEFAULT_UPSTREAM = 'https://arisweedler.github.io';

const SITE = '/explainers';

/** Paths served from the site root upstream, not from articles/. Trailing slash = prefix. */
const ROOT_PATHS = ['/dist/', '/assets/', '/favicon.svg', '/404.html', '/index.html', '/robots.txt'];

const isRootPath = (pathname) =>
  ROOT_PATHS.some((p) => (p.endsWith('/') ? pathname.startsWith(p) : pathname === p));

/** Pure mapping from a pathname on this origin to what the Worker does with it. */
export const mapPath = (pathname) => {
  if (pathname === '/' || pathname === '') return { kind: 'fetch', path: `${SITE}/` };
  if (pathname.startsWith(`${SITE}/`)) return { kind: 'fetch', path: pathname };
  if (pathname.startsWith('/articles/')) return { kind: 'redirect', path: pathname.slice('/articles'.length) };
  if (isRootPath(pathname)) return { kind: 'fetch', path: SITE + pathname };
  return { kind: 'fetch', path: `${SITE}/articles${pathname}` };
};

/** Pure inverse for upstream redirects: an upstream pathname becomes the short one here. */
export const unmapPath = (upstreamPathname) => {
  const stripped = upstreamPathname.startsWith(`${SITE}/articles/`)
    ? upstreamPathname.slice(`${SITE}/articles`.length)
    : upstreamPathname.startsWith(`${SITE}/`)
      ? upstreamPathname.slice(SITE.length)
      : upstreamPathname;
  return stripped.startsWith('/') ? stripped : `/${stripped}`;
};

/**
 * Copy the upstream headers, rewriting a Location that points back at the upstream host so the
 * browser stays on this origin (GitHub Pages 301s /x to /x/). Other Locations pass through.
 */
const rewriteLocation = (upstreamHeaders, target, origin) => {
  const headers = new Headers(upstreamHeaders);
  const loc = headers.get('Location');
  if (loc === null || loc === '') return headers;
  try {
    const locUrl = new URL(loc, target);
    if (locUrl.hostname === target.hostname) {
      headers.set('Location', origin + unmapPath(locUrl.pathname) + locUrl.search);
    }
  } catch {
    // unparseable Location: leave it as the upstream sent it
  }
  return headers;
};

const handler = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const upstream = (env && env.UPSTREAM) || DEFAULT_UPSTREAM;
    const mapped = mapPath(url.pathname);
    if (mapped.kind === 'redirect') return Response.redirect(url.origin + mapped.path + url.search, 301);
    const target = new URL(mapped.path + url.search, upstream);
    const body = request.method !== 'GET' && request.method !== 'HEAD' ? { body: request.body } : {};
    const proxyReq = new Request(target, { method: request.method, headers: request.headers, redirect: 'manual', ...body });
    const response = await fetch(proxyReq);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: rewriteLocation(response.headers, target, url.origin),
    });
  },
};

export default handler;
