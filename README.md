# explainers

Ciechanowski-style interactive explainers ([reference style](https://ciechanow.ski/gps/)) as plain static files:
one HTML file per article, one shared vendored runtime, one stylesheet, zero third-party bytes from any CDN except Google Fonts.

A figure is *data*, never code: a `<figure class="x-fig">` holding one JSON spec with three keys, **shows** (what it draws), **manipulates** (what the reader changes) and **notice** (named states and what the prose points at). The runtime draws it; a Node CLI refuses anything outside the closed vocabulary.

**Status:** phase 1 is the contract and the tooling (`lib/spec.js`, `lib/expr.js`, `tools/explainers.cjs`, the template, `DESIGN.md`). Phase 2 is the browser runtime: `dist/explainers-runtime.v1.js` (one plain-JS file, no dependencies, ~35 KB gzipped), `dist/explainers.v1.css`, and the first article, `articles/moon/` (the sidereal and synodic month). Phase 3A (done) adds SVG posters (the first frame, drawn at build time, shown before the runtime mounts and without JavaScript), `dist/integrity.json` with `integrity=` on the runtime and stylesheet includes, and three validator warnings. Phase 3B (done) adds the WebGL figures: `dist/explainers-3d.v1.js`, a lazy chunk (three.js 0.185.0 + `lib/scene3d/`, ~143 KB gzipped, off the critical path) that the runtime imports on the first approach of a `scene3d` figure, with arcball/orbit/fixed/panorama cameras, every object kind, DOM labels, surface drags with geolocation, projected posters, and the Moon article's second figure, the same orbit in three dimensions. See "Phase 3 status" in `DESIGN.md`.

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
articles/<slug>/index.html           one article = one file (+ articles/<slug>/assets/ for posters, diagrams and og.png, the link-preview card)
template/article.html                the head, palette, reading column and glossary every article starts from
template/og-card.html                the 1200 x 630 link-preview card tools/og-image.mjs renders from an article's head and hero poster
dist/                                explainers-runtime.v1.js, explainers.v1.css, explainers-3d.v1.js, integrity.json (committed build outputs)
lib/core/, lib/scene2d/, lib/controls/, lib/site/   runtime source (ES modules); tools/build-runtime.mjs concatenates them into dist/
lib/scene3d/                         the three.js adapter and its pure math; tools/build-3d.mjs bundles it with three into the lazy chunk
assets/katex/                        vendored KaTeX CSS + woff2 fonts (relative url() in the CSS)
assets/og.png, assets/apple-touch-icon.png   the front page's link-preview card and the PNG icon Messages shows beside a link (node tools/og-image.mjs --site)
lib/spec.js, lib/expr.js             the closed vocabulary and expression grammar, shared by runtime and CLI
tools/explainers.cjs                 single committed Node 22 CLI: validate | states | build | budget
tools/src/, tools/build-cli.mjs      CLI source and its bundler (maintainers only)
tools/og-image.mjs                   renders the link-preview cards with a headless-only Chromium (see "Link previews")
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
npm test                                  # node --test: expr, spec, cli, runtime, poster, scene3d, docs (also checks dist/ is current)
node tools/explainers.cjs --help          # no install needed; single committed file
node tools/explainers.cjs vocab           # the vocabulary as markdown (what DESIGN.md embeds)
```

Maintainers (changing `lib/` or `tools/src/`):

```sh
node tools/build-runtime.mjs                    # lib/ -> dist/explainers-runtime.v1.js + dist/integrity.json (no dependencies; npm test checks both are current)
node tools/build-3d.mjs                         # lib/scene3d/ + three -> dist/explainers-3d.v1.js (esbuild from tools/node_modules; --check like build-runtime; npm test checks it)
node tools/explainers.cjs build articles/*/index.html   # then refresh every article's integrity= attributes (and posters)
cd tools && npm install && node build-cli.mjs   # rebundles tools/explainers.cjs, vendors assets/katex, regenerates DESIGN.md
```

`npm run build-runtime` and `npm run build-3d` are the same two commands. Never hand-edit `tools/explainers.cjs`, `dist/explainers-runtime.v1.js` or `dist/explainers-3d.v1.js`.

## Preview locally

```sh
python3 -m http.server 8765 --bind 127.0.0.1
# open http://127.0.0.1:8765/articles/<slug>/            (relative includes and fragments work)
# open http://127.0.0.1:8765/articles/<slug>/#fig-x=state  to land on a named state
```

Opening `articles/<slug>/index.html` directly from disk also works for fragment links and the runtime include. For a headless screenshot use a headless-only binary such as Playwright's `chrome-headless-shell` (`~/Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-mac-arm64/chrome-headless-shell` on macOS), never the Chrome.app binary: every launch of Chrome.app registers a new app instance and steals keyboard focus. WebGL figures need the SwiftShader flags:

```sh
chrome-headless-shell --headless --no-sandbox --hide-scrollbars \
  --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist \
  --window-size=1200,2400 --virtual-time-budget=6000 \
  --screenshot=preview/poc.png http://127.0.0.1:8765/articles/moon/index.html
```

## Link previews

iMessage, Slack, X and Discord show a card for a pasted link from the `og:*` tags in the head. Every article's `og:image` is its own `assets/og.png`, a 1200 x 630 PNG (the apps do not render SVG), drawn from `template/og-card.html`: the title, the description, the article's palette and its hero poster (the first `.x-poster`) on the site's light background. `build` cannot draw it (the card needs a browser), so re-render it whenever an article's title, description or hero figure changes; `validate` warns while the file is missing, not a PNG or the wrong size:

```sh
node tools/og-image.mjs articles/<slug>/index.html   # -> articles/<slug>/assets/og.png
node tools/og-image.mjs --site                       # -> assets/og.png (front page card) + assets/apple-touch-icon.png (180 x 180, from favicon.svg)
```

The renderer uses Playwright's `chrome-headless-shell` (the newest under `~/Library/Caches/ms-playwright/`, or the binary named by `$EXPLAINERS_HEADLESS_SHELL`) and never Chrome.app (see above). Messages ignores the SVG favicon and shows the PNG `<link rel="apple-touch-icon">` beside the card, which is why every page links `assets/apple-touch-icon.png`; `--site` regenerates it, so run it again only when `favicon.svg` changes. Check a result with `sips -g pixelWidth -g pixelHeight articles/<slug>/assets/og.png`.

## Slider anatomy

Slider, track (fill and rail), knob, halo, stop, tick, socket, value: `DESIGN.md` "Slider anatomy" defines the words and the DOM for every slider part. Code, comments, captions and prose use them; a drag control's on-canvas point is a handle, never a knob.

## How the runtime mounts

`dist/explainers-runtime.v1.js` is loaded once with `<script defer>`. On `DOMContentLoaded` it

1. reads the palette token names from the inline `<style>` and resolves them to real colors (canvas cannot parse `light-dark()`), re-resolving when the color scheme changes;
2. for every `figure.x-fig` with a JSON block, runs the same `validateSpec` the CLI runs (a failure is printed inside the figure as `<p class="x-fig-error">`) and scaffolds the DOM the contract describes: `.x-canvas-box` (aspect from `data-aspect`) with corner Play/Restart and toggle buttons, then the controls in spec order (`<fig>_sl<i>`, `<fig>_tg<i>`, `<fig>_seg<i>`, `<fig>_drag_<name>`), then the stepper (`<fig>_steps`), before the `<figcaption>`;
3. watches each figure with an `IntersectionObserver` (100 px margin; 400 px for `scene3d`); on first approach it sizes the canvas for DPR 1 or 2, draws, sets `data-mounted` and emits `x-fig:mount`; off screen it releases the canvas bitmap and stops ticking. A `scene3d` figure first checks WebGL2 and imports `dist/explainers-3d.v1.js` once per page (resolved beside the runtime's own `src`); the build poster stays until the first WebGL frame, and stays for good with the spec's notice when WebGL2 is missing or the import fails;
4. routes `#fig-x=state` (on load and `hashchange`) to `figure.goto(state, { ease: false })`, intercepts `<a data-state href="#fig-x">` clicks (600 ms smoothstep ease, `history.replaceState`), colors `<span data-fig data-ref>` from the layer's token and highlights the layer on hover, fills one shared `#x-tip` tooltip from the glossary `<dd>` on hover/focus of `a.term`, and opens `<details id="glossary">` before the browser scrolls to a `#g-*` row.

`window.explainers` (`version`, `figures`, `goto(figId, state)`, `pauseAll(bool)`) is a console handle for tests, not an authoring surface. Every value change goes through `figure.set(name, value)`, so the knob, the readouts and the canvas always agree; `x-fig:set`, `x-fig:state` and `x-fig:play` bubble from the figure element.
