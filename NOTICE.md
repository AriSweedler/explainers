# Third-party notices

Nothing third-party reaches the reader's browser from a CDN except Google Fonts.
Everything below is vendored or used at build time only.

| component | version | license | where |
|---|---|---|---|
| KaTeX | 0.18.7 (pinned in tools/package.json) | MIT | `assets/katex/` (CSS + woff2 fonts, vendored by `tools/build-cli.mjs`); bundled into `tools/explainers.cjs` for build-time rendering |
| parse5 | 8.0.1 | MIT | bundled into `tools/explainers.cjs` |
| esbuild | 0.28.2 | MIT | dev only, produces `tools/explainers.cjs` and (phase 2) `dist/*.v1.js` |
| three.js | 0.185.0 (phase 2) | MIT | will be tree-shaken into `dist/explainers-3d.v1.js` |
| Red Blob Games drag recipe | (phase 2) | Apache-2.0 by header; rewritten, not vendored | `lib/core/drag.js` |

`node tools/explainers.cjs --version` prints the versions actually embedded in the committed bundle.
