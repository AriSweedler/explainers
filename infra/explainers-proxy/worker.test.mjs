import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { DEFAULT_UPSTREAM, mapPath, unmapPath } from './worker.js';

const ORIGIN = 'https://explainers.sweedler.com';

const withUpstream = async (handler, fn) => {
  const real = globalThis.fetch;
  globalThis.fetch = (input) => Promise.resolve(handler(input instanceof Request ? input : new Request(input)));
  try { return await fn(); } finally { globalThis.fetch = real; }
};
const echo = (req) => new Response(req.url, { status: 200 });
const get = (path, env) => worker.fetch(new Request(ORIGIN + path), env);

test('mapPath: the table in the file header (fetches)', () => {
  for (const [pathname, upstreamPath] of [
    ['/', '/explainers/'], ['', '/explainers/'],
    ['/hebrew-calendar', '/explainers/articles/hebrew-calendar'],
    ['/hebrew-calendar/', '/explainers/articles/hebrew-calendar/'],
    ['/moon/', '/explainers/articles/moon/'],
    ['/dist/explainers-runtime.v1.js', '/explainers/dist/explainers-runtime.v1.js'],
    ['/assets/katex/katex.min.css', '/explainers/assets/katex/katex.min.css'],
    ['/favicon.svg', '/explainers/favicon.svg'], ['/404.html', '/explainers/404.html'],
    ['/explainers/', '/explainers/'], ['/explainers/articles/hebrew-calendar/', '/explainers/articles/hebrew-calendar/'],
    // only slash-terminated prefixes are special
    ['/articles', '/explainers/articles/articles'], ['/dist', '/explainers/articles/dist'], ['/explainers', '/explainers/articles/explainers'],
  ]) assert.deepEqual(mapPath(pathname), { kind: 'fetch', path: upstreamPath }, pathname);
});

test('mapPath: /articles/… redirects to the short URL', () => {
  for (const [pathname, shortPath] of [
    ['/articles/hebrew-calendar/', '/hebrew-calendar/'], ['/articles/hebrew-calendar', '/hebrew-calendar'],
    ['/articles/moon/assets/x.png', '/moon/assets/x.png'], ['/articles/', '/'],
    ['/poc-months/', '/moon/'], ['/poc-months', '/moon'], ['/poc-months/assets/x.png', '/moon/assets/x.png'],
  ]) assert.deepEqual(mapPath(pathname), { kind: 'redirect', path: shortPath }, pathname);
});

test('unmapPath inverts the upstream layout', () => {
  assert.equal(unmapPath('/explainers/articles/hebrew-calendar/'), '/hebrew-calendar/');
  assert.equal(unmapPath('/explainers/dist/x.js'), '/dist/x.js');
  assert.equal(unmapPath('/explainers/'), '/');
  assert.equal(unmapPath('/elsewhere'), '/elsewhere');
});

test('fetch: proxies to the default upstream and keeps the query', async () => {
  const res = await withUpstream(echo, () => get('/hebrew-calendar/?x=1'));
  assert.equal(await res.text(), `${DEFAULT_UPSTREAM}/explainers/articles/hebrew-calendar/?x=1`);
});

test('fetch: env.UPSTREAM overrides the origin', async () => {
  const res = await withUpstream(echo, () => get('/dist/a.css', { UPSTREAM: 'http://127.0.0.1:8765' }));
  assert.equal(await res.text(), 'http://127.0.0.1:8765/explainers/dist/a.css');
});

test('fetch: /articles/… is a 301 on this origin, no upstream call', async () => {
  const res = await withUpstream(() => { throw new Error('no upstream call expected'); }, () => get('/articles/hebrew-calendar/'));
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('Location'), `${ORIGIN}/hebrew-calendar/`);
});

test('fetch: an upstream Location back to the upstream host is rewritten to this origin', async () => {
  const redirecting = () => new Response(null, { status: 301, headers: { Location: `${DEFAULT_UPSTREAM}/explainers/articles/hebrew-calendar/` } });
  const res = await withUpstream(redirecting, () => get('/hebrew-calendar'));
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('Location'), `${ORIGIN}/hebrew-calendar/`);
});

test('fetch: a Location elsewhere passes through', async () => {
  const elsewhere = () => new Response(null, { status: 302, headers: { Location: 'https://example.org/x' } });
  const res = await withUpstream(elsewhere, () => get('/hebrew-calendar/'));
  assert.equal(res.headers.get('Location'), 'https://example.org/x');
});
