# explainers

Ciechanowski-style interactive explainers ([reference style](https://ciechanow.ski/gps/)) as plain static files:
one HTML file per article, one shared vendored runtime, one stylesheet, zero third-party bytes from any CDN except Google Fonts.

A figure is *data*, never code: a `<figure class="x-fig">` holding one JSON spec with three keys, **shows** (what it draws), **manipulates** (what the reader changes) and **notice** (named states and what the prose points at). The runtime draws it; a Node CLI refuses anything outside the closed vocabulary.

**Status:** phase 1 is the contract and the tooling (`lib/spec.js`, `lib/expr.js`, `tools/explainers.cjs`, the template, `DESIGN.md`). Phase 2 is the browser runtime: `dist/explainers-runtime.v1.js` (one plain-JS file, no dependencies, ~35 KB gzipped), `dist/explainers.v1.css`, and the first article, `articles/moon/` (the sidereal and synodic month). Phase 3A (done) adds SVG posters (the first frame, drawn at build time, shown before the runtime mounts and without JavaScript), `dist/integrity.json` with `integrity=` on the runtime and stylesheet includes, and three validator warnings; phase 3B adds WebGL figures (three.js). See "Phase 3 status" in `DESIGN.md`.

## explainers.sweedler.com

`infra/explainers-proxy/worker.js` is a Cloudflare Worker that fronts the GitHub Pages site so
articles get short URLs: `https://explainers.sweedler.com/hebrew-calendar/` serves
`https://arisweedler.github.io/explainers/articles/hebrew-calendar/`. The path table is at the top
of `worker.js`; `worker.test.mjs` pins every row (`npm test` runs it); `npm run proxy` runs the same
handler locally on port 8787 against the live upstream.

Deploy by hand; wrangler is not a dependency of this repo:

```
cd infra/explainers-proxy
npx wrangler login      # once per machine, opens the browser
npx wrangler deploy     # the custom-domain route creates the DNS record on sweedler.com
```

GitHub Pages keeps serving the `github.io` URL; the Worker is a second origin over the same files.
Do not set a custom domain on the Pages side: it would redirect the `github.io` URL to the Worker's
host and the Worker fetches from `github.io`.

## Preview locally

```
npm run serve
```

then open http://127.0.0.1:8765/articles/hebrew-calendar/ (or `PORT=9000 npm run serve`). The server is `tools/serve.mjs`, zero dependencies, no caching.

## Layout

```
index.html, 404.html, .nojekyll      site root (GitHub Pages via Actions; see .github/workflows/pages.yml)
articles/<slug>/index.html           one article = one file (+ articles/<slug>/assets/ for posters and diagrams)
template/article.html                the head, palette, reading column and glossary every article starts from
dist/                                explainers-runtime.v1.js, explainers.v1.css (committed build outputs)
lib/core/, lib/scene2d/, lib/controls/, lib/site/   runtime source (ES modules); tools/build-runtime.mjs concatenates them into dist/
assets/katex/                        vendored KaTeX CSS + woff2 fonts (relative url() in the CSS)
lib/spec.js, lib/expr.js             the closed vocabulary and expression grammar, shared by runtime and CLI
tools/explainers.cjs                 single committed Node 22 CLI: validate | states | build | budget
tools/src/, tools/build-cli.mjs      CLI source and its bundler (maintainers only)
test/                                node --test suites and pass/fail fixtures
DESIGN.md                            the contract: vocabulary (generated), grammar, error catalogue, phase-2 contract
```

## Author an article

1. Copy `template/article.html` to `articles/<slug>/index.html` and fill the `{{...}}` placeholders. Declare at most 6 palette tokens as `--c-<name>: light-dark(#light, #dark)` in the `:root` rule.
2. Write sections. Each interactive figure is

   ```html
   <figure class="x-fig" id="fig-<slug>" data-aspect="3:2">
   <script type="application/json">{ "shows": {...}, "manipulates": {...}, "notice": {...} }</script>
   <figcaption>...</figcaption>
   </figure>
   ```

   Numeric properties are numbers or expression strings (`"R*cos(tau*t/T_sid)"`); colors are palette token names.
3. Point prose at the figure: `<span data-fig="fig-x" data-ref="layer-id">the red line</span>`; jump to a state: `<a href="#fig-x" data-state="name">27.32 days</a>`.
4. Mark a term's first use `<dfn id="t-slug"><a href="#g-slug">term</a></dfn>`, later uses `<a class="term" href="#g-slug">term</a>`, and add its row to the glossary `<details>` at the end of `<main>`.
5. Write math as LaTeX in `<span class="x-tex">` / `<div class="x-tex">`, coloring symbols with `\tok{token}{...}`.
6. Build and validate until exit 0:

   ```sh
   node tools/explainers.cjs build    articles/<slug>/index.html   # in place, idempotent: KaTeX -> HTML+MathML; SVG poster per figure; caveat sentence; integrity= attributes
   node tools/explainers.cjs validate articles/<slug>/index.html --budget 170k
   node tools/explainers.cjs states   articles/<slug>/index.html   # list states; every expression finite at each
   ```

   Every failure is one line, `file:line: CODE figure-id: message`; the codes are listed in `DESIGN.md` and by `node tools/explainers.cjs errors`. Warnings (`file:line: warning figure-id: message`) do not fail: a `point_at` id no prose points at, a `data-ref` to something hidden in every state, a first-use `<dfn>` in a section with no figure, an unbuilt formula / poster / integrity attribute.

   `build` puts each figure's first frame in front of its JSON block as `<svg class="x-poster">` (or, above 8 KiB, as `articles/<slug>/assets/poster-<fig>.svg` behind an `<img>`; commit those files too). Readers without JavaScript, and the first paint before the canvas mounts, see that frame. It also fills `integrity="sha384-..."` on the two includes from `dist/integrity.json`; whenever `dist/` changes, run `node tools/build-runtime.mjs` and then `build` on every article, or `validate` fails with `INTEGRITY_STALE`.
7. Add a line to `index.html` and push. The Pages workflow re-validates and deploys.

## Run the tools

```sh
npm test                                  # node --test: expr, spec, cli, runtime, poster, docs
node tools/explainers.cjs --help          # no install needed; single committed file
node tools/explainers.cjs vocab           # the vocabulary as markdown (what DESIGN.md embeds)
```

Maintainers (changing `lib/` or `tools/src/`):

```sh
node tools/build-runtime.mjs                    # lib/ -> dist/explainers-runtime.v1.js + dist/integrity.json (no dependencies; npm test checks both are current)
node tools/explainers.cjs build articles/*/index.html   # then refresh every article's integrity= attributes (and posters)
cd tools && npm install && node build-cli.mjs   # rebundles tools/explainers.cjs, vendors assets/katex, regenerates DESIGN.md
```

Never hand-edit `tools/explainers.cjs` or `dist/explainers-runtime.v1.js`.

## Preview locally

```sh
python3 -m http.server 8765 --bind 127.0.0.1
# open http://127.0.0.1:8765/articles/<slug>/            (relative includes and fragments work)
# open http://127.0.0.1:8765/articles/<slug>/#fig-x=state  to land on a named state
```

Opening `articles/<slug>/index.html` directly from disk also works for fragment links and the runtime include. A headless screenshot without any install:

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars \
  --window-size=1200,2400 --screenshot=preview/poc.png http://127.0.0.1:8765/articles/moon/index.html
```

## How the runtime mounts

`dist/explainers-runtime.v1.js` is loaded once with `<script defer>`. On `DOMContentLoaded` it

1. reads the palette token names from the inline `<style>` and resolves them to real colors (canvas cannot parse `light-dark()`), re-resolving when the color scheme changes;
2. for every `figure.x-fig` with a JSON block, runs the same `validateSpec` the CLI runs (a failure is printed inside the figure as `<p class="x-fig-error">`) and scaffolds the DOM the contract describes: `.x-canvas-box` (aspect from `data-aspect`) with corner Play/Restart and toggle buttons, then the controls in spec order (`<fig>_sl<i>`, `<fig>_tg<i>`, `<fig>_seg<i>`, `<fig>_drag_<name>`), then the stepper (`<fig>_steps`), before the `<figcaption>`;
3. watches each figure with an `IntersectionObserver` (100 px margin); on first approach it sizes the canvas for DPR 1 or 2, draws, sets `data-mounted` and emits `x-fig:mount`; off screen it releases the canvas bitmap and stops ticking;
4. routes `#fig-x=state` (on load and `hashchange`) to `figure.goto(state, { ease: false })`, intercepts `<a data-state href="#fig-x">` clicks (600 ms smoothstep ease, `history.replaceState`), colors `<span data-fig data-ref>` from the layer's token and highlights the layer on hover, fills one shared `#x-tip` tooltip from the glossary `<dd>` on hover/focus of `a.term`, and opens `<details id="glossary">` before the browser scrolls to a `#g-*` row.

`window.explainers` (`version`, `figures`, `goto(figId, state)`, `pauseAll(bool)`) is a console handle for tests, not an authoring surface. Every value change goes through `figure.set(name, value)`, so the knob, the readouts and the canvas always agree; `x-fig:set`, `x-fig:state` and `x-fig:play` bubble from the figure element.
