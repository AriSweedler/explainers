#!/usr/bin/env node
// Zero-dependency static server for local preview: `npm run serve` then open
// http://127.0.0.1:8765/articles/<slug>/. Serves the repo root with the MIME
// types the runtime needs and no caching, so a rebuilt dist/ shows on reload.
import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve(process.argv[2] || '.');
const port = Number(process.env.PORT || process.argv[3] || 8765);
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain',
  '.md': 'text/markdown', '.pdf': 'application/pdf', '.dat': 'application/octet-stream',
  '.bin': 'application/octet-stream',
};

function send(res, file, status = 200) {
  const size = statSync(file).size;
  res.writeHead(status, { 'content-type': types[extname(file)] || 'application/octet-stream', 'content-length': size, 'cache-control': 'no-store' });
  createReadStream(file).pipe(res);
}

http.createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  let file = normalize(join(root, path));
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  try {
    if (statSync(file).isDirectory()) file = join(file, 'index.html');
    send(res, file);
  } catch {
    const notFound = join(root, '404.html');
    if (existsSync(notFound)) send(res, notFound, 404); else { res.writeHead(404); res.end('not found'); }
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`serving ${root}\n  http://127.0.0.1:${port}/\n  http://127.0.0.1:${port}/articles/hebrew-calendar/`);
});
