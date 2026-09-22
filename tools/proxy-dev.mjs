#!/usr/bin/env node
// Run the explainers.sweedler.com Worker locally: `npm run proxy` then open
// http://127.0.0.1:8787/hebrew-calendar/. UPSTREAM defaults to the live GitHub Pages site;
// point it at a local `npm run serve` only if that server mounts the repo at /explainers/.
import http from 'node:http';
import handler from '../infra/explainers-proxy/worker.js';

const port = Number(process.env.PORT || process.argv[2] || 8787);
const env = { UPSTREAM: process.env.UPSTREAM || 'https://arisweedler.github.io' };

http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length && req.method !== 'GET' && req.method !== 'HEAD' ? Buffer.concat(chunks) : undefined;
  const request = new Request(`https://explainers.sweedler.com${req.url}`, { method: req.method, headers: req.headers, body });
  const response = await handler.fetch(request, env);
  const headers = Object.fromEntries(response.headers);
  delete headers['content-encoding']; delete headers['content-length'];
  res.writeHead(response.status, headers);
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(port, '127.0.0.1', () => console.log(`proxy-dev on http://127.0.0.1:${port}/  upstream ${env.UPSTREAM}\n  http://127.0.0.1:${port}/hebrew-calendar/`));
