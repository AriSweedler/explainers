#!/usr/bin/env node
// Renders the link-preview cards (og:image) with a headless-only Chromium.
//   node tools/og-image.mjs articles/<slug>/index.html [...]   -> articles/<slug>/assets/og.png (1200 x 630)
//   node tools/og-image.mjs --site                             -> assets/og.png (the front page card)
//                                                              -> assets/apple-touch-icon.png (180 x 180, from favicon.svg)
// The card is template/og-card.html filled with the article's title, description,
// palette <style> and hero poster (its first .x-poster), served from preview/
// (gitignored, the temp file is removed) by tools/serve.mjs so the site CSS loads.
// Binary: $EXPLAINERS_HEADLESS_SHELL, else Playwright's newest chrome-headless-shell.
// Never Chrome.app: every launch of it steals keyboard focus.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pngSize, OG_IMAGE, OG_WIDTH, OG_HEIGHT } from './src/og.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ICON = 180;
const SHELL_ENV = 'EXPLAINERS_HEADLESS_SHELL';

const fail = (msg) => { console.error(`og-image: ${msg}`); process.exit(1); };
const rel = (p) => path.relative(root, p) || '.';

function findShell() {
  const env = process.env[SHELL_ENV];
  if (env) {
    if (fs.existsSync(env)) return env;
    fail(`${SHELL_ENV}=${env} does not exist`);
  }
  const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright');
  const dirs = fs.existsSync(cache) ? fs.readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell-')) : [];
  dirs.sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const d of dirs) {
    const bin = path.join(cache, d, 'chrome-headless-shell-mac-arm64/chrome-headless-shell');
    if (fs.existsSync(bin)) return bin;
  }
  return fail(`no chrome-headless-shell under ${cache}; set ${SHELL_ENV} to a headless-only Chromium binary`);
}

// ---------------------------------------------------------------- article parts

const first = (re, html) => { const m = re.exec(html); return m ? m[1] : null; };

function palette(html) {
  const styles = html.match(/<style>[\s\S]*?<\/style>/g) || [];
  return styles.find((s) => s.includes('--c-')) || '';
}

// The hero poster: the first inline <svg class="x-poster">...</svg> (nesting
// counted) or the first <img class="x-poster" src="assets/...">, its src made
// relative to the card's directory.
function poster(html, articleDir, cardDir) {
  const svgAt = html.search(/<svg class="x-poster"/);
  const imgAt = html.search(/<img class="x-poster"/);
  if (svgAt >= 0 && (imgAt < 0 || svgAt < imgAt)) {
    let depth = 0;
    const re = /<svg\b|<\/svg>/g;
    re.lastIndex = svgAt;
    for (let m; (m = re.exec(html));) {
      depth += m[0] === '</svg>' ? -1 : 1;
      if (depth === 0) return html.slice(svgAt, m.index + m[0].length);
    }
    fail('unterminated <svg class="x-poster">');
  }
  if (imgAt >= 0) {
    const tag = html.slice(imgAt, html.indexOf('>', imgAt) + 1);
    const src = first(/\ssrc="([^"]+)"/, tag);
    const target = path.posix.relative(cardDir, path.posix.join(articleDir, src));
    return tag.replace(/\ssrc="[^"]+"/, ` src="${target}"`);
  }
  return '';
}

function articleParts(file) {
  const html = fs.readFileSync(file, 'utf8');
  const title = first(/<title>([^<]*)<\/title>/, html);
  if (!title) fail(`${rel(file)}: no <title>`);
  return {
    title,
    description: first(/<meta name="description" content="([^"]*)">/, html) || '',
    palette: palette(html),
    poster: poster(html, path.posix.dirname(rel(file).split(path.sep).join('/')), 'preview'),
  };
}

const titleSize = (title) => (title.length > 28 ? 58 : title.length > 14 ? 72 : 92);

function card(parts) {
  const template = fs.readFileSync(path.join(root, 'template/og-card.html'), 'utf8');
  const fill = { ...parts, css: '../dist/explainers.v1.css', 'title-size': String(titleSize(parts.title)) };
  return template.replace(/\{\{([a-z-]+)\}\}/g, (m, key) => (key in fill ? fill[key] : m));
}

function iconPage() {
  const svg = fs.readFileSync(path.join(root, 'favicon.svg'), 'utf8').trim();
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="color-scheme" content="light"><title>touch icon</title>
<style>html,body{margin:0;width:${ICON}px;height:${ICON}px;overflow:hidden}body{background:#faf8f5;display:grid;place-items:center}svg{width:${ICON * 0.8}px;height:${ICON * 0.8}px;display:block}</style>
</head><body>${svg}</body></html>\n`;
}

// ---------------------------------------------------------------- render

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}

function ready(url, tries = 50) {
  return new Promise((resolve, reject) => {
    const attempt = (left) => http.get(url, (res) => { res.resume(); resolve(); })
      .on('error', () => (left > 0 ? setTimeout(() => attempt(left - 1), 100) : reject(new Error(`server at ${url} did not come up`))));
    attempt(tries);
  });
}

async function withServer(fn) {
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(root, 'tools/serve.mjs'), root, String(port)], { stdio: 'ignore' });
  try {
    await ready(`http://127.0.0.1:${port}/favicon.svg`);
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    child.kill();
  }
}

function screenshot(shell, url, out, width, height) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.rmSync(out, { force: true });
  const r = spawnSync(shell, [
    '--headless', '--no-sandbox', '--hide-scrollbars', '--force-device-scale-factor=1', '--disable-gpu',
    `--window-size=${width},${height}`, '--virtual-time-budget=4000', `--screenshot=${out}`, url,
  ], { encoding: 'utf8', timeout: 60000 });
  if (r.status !== 0 || !fs.existsSync(out)) fail(`headless shell failed for ${url}\n${r.stderr || ''}`);
  const size = pngSize(fs.readFileSync(out));
  if (!size || size.width !== width || size.height !== height) fail(`${rel(out)} is ${size ? `${size.width}x${size.height}` : 'not a PNG'}, expected ${width}x${height}`);
  console.log(`wrote ${rel(out)} (${width}x${height}, ${(fs.statSync(out).size / 1024).toFixed(1)} KB)`);
}

// Writes the temp page under preview/, renders it, removes it.
function renderPage(shell, base, name, html, out, width, height) {
  const previewDir = path.join(root, 'preview');
  fs.mkdirSync(previewDir, { recursive: true });
  const tmp = path.join(previewDir, name);
  fs.writeFileSync(tmp, html);
  try { screenshot(shell, `${base}/preview/${name}`, out, width, height); } finally { fs.rmSync(tmp, { force: true }); }
}

async function main(argv) {
  const site = argv.includes('--site');
  const files = argv.filter((a) => a !== '--site');
  if (!site && files.length === 0) {
    console.error('usage: node tools/og-image.mjs articles/<slug>/index.html [...] | --site');
    process.exit(2);
  }
  for (const f of files) if (!fs.existsSync(f)) fail(`${f} not found`);
  const shell = findShell();
  await withServer(async (base) => {
    for (const f of files) {
      const file = path.resolve(f);
      const parts = articleParts(file);
      const slug = path.basename(path.dirname(file));
      renderPage(shell, base, `og-card-${slug}.html`, card(parts), path.join(path.dirname(file), OG_IMAGE), OG_WIDTH, OG_HEIGHT);
    }
    if (site) {
      const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
      const moon = articleParts(path.join(root, 'articles/moon/index.html'));
      const parts = { title: 'Explainers', description: first(/<meta name="description" content="([^"]*)">/, index) || '', palette: moon.palette, poster: moon.poster };
      renderPage(shell, base, 'og-card-site.html', card(parts), path.join(root, OG_IMAGE), OG_WIDTH, OG_HEIGHT);
      renderPage(shell, base, 'og-touch-icon.html', iconPage(), path.join(root, 'assets/apple-touch-icon.png'), ICON, ICON);
    }
  });
}

main(process.argv.slice(2)).catch((e) => fail(e.message));
