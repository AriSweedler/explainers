# Explainers runtime v1 — the contract

This document is the single source for everything phase 2 (the browser runtime) and the authoring skill need. Three sections are **generated** from `lib/spec.js` and `lib/expr.js` by `node tools/gen-docs.mjs` (also run by `tools/build-cli.mjs`); `test/docs.test.mjs` fails when they are stale. Everything else is written by hand.

Contents: [Overview](#overview) · [Vocabulary](#vocabulary-generated) · [Expression grammar](#expression-grammar) · [Error catalogue](#error-catalogue) · [Glossary contract](#glossary-contract) · [Page contract](#page-contract) · [Authoring example](#authoring-example) · [CLI](#cli) · [Phase 2 contract](#phase-2-contract) · [Decisions where the design was silent](#decisions-where-the-design-was-silent)

## Overview

- An article is one HTML file copied from `template/article.html`. Everything outside the prose (head, fonts, palette, runtime include, glossary shell) comes from the template.
- A figure is `<figure class="x-fig" id="fig-<slug>" data-aspect="W:H">` with exactly one `<script type="application/json">` child holding a spec with three keys: `shows`, `manipulates`, `notice`. The author never writes JavaScript.
- Every numeric property is a number or an expression string in the closed grammar below. Every color is a palette token name. Anything the grammar cannot express is a named library model.
- `lib/spec.js` (vocabulary + `validateSpec`) and `lib/expr.js` (grammar) are plain ES2020 modules with no dependencies. The browser runtime imports them; `tools/explainers.cjs` bundles them. Browser and CI therefore cannot disagree.
- Validation is `additionalProperties:false` everywhere: unknown key, missing required key, unknown kind, undeclared identifier, token outside the palette, value outside its range: each is an error naming the figure id and the JSON path. Required keys have no defaults. Optional keys may have documented defaults.
- The CLI prints every failure as `file:line: CODE figure-id: message` and exits 1, so an LLM skill can iterate mechanically.

## Vocabulary (generated)

Tokens are the `--c-<name>` custom properties declared once in the article's `:root`, at most 6, each `light-dark(#light, #dark)` with >= 3:1 contrast against `--bg` in both schemes.

Ids (`id`) match `[A-Za-z_][A-Za-z0-9_-]*`. Identifiers (`name`, constants, model params) match `[A-Za-z_][A-Za-z0-9_]*` and may not be a built-in function name. Layers, 3D objects, series, guides, bars, readout ids, control names and constant names share one namespace per figure (so `data-ref` is unambiguous).

<!-- generated:vocabulary -->
### Figure (top level)

| key | type | required | meaning |
|---|---|---|---|
| `shows` | shows (see Figure types) | yes | what the figure draws: type, view, constants, layers, readouts |
| `manipulates` | object (below) | yes | what the reader changes: controls |
| `notice` | object (below) | yes | what to notice: states, stepper, point_at |

### Figure types (`shows`)

Figure types: `scene2d`, `scene3d`, `plot`, `timeline`. Every `shows` object has `type`.

#### shows: scene2d

| key | type | required | meaning |
|---|---|---|---|
| `type` | `scene2d` | yes | figure type |
| `view` | object (below) | yes | world-unit viewport |
| `layers` | array of layer (see Layers) (min 1) | yes | drawn bottom to top |
| `split` | array of object (below) |  | companion panels sharing this figure state |
| `constants` | map of identifier -> constant |  | name -> number, or {value, expect, tol} for a derived number |
| `model` | object (below) |  | library model whose outputs join the scope as <name>.<output> |
| `readouts` | array of object (below) |  | text readouts drawn over the figure |
| `caveats` | object (below) |  | honesty flags the build echoes in the caption |

#### shows: scene3d

| key | type | required | meaning |
|---|---|---|---|
| `type` | `scene3d` | yes | figure type |
| `camera` | object (below) | yes | camera and interaction |
| `light` | object (below) | yes | directional + ambient light |
| `shadows` | boolean |  | cast shadows (default false) |
| `objects` | array of object (see 3D objects) (min 1) | yes | scene objects |
| `assets` | map of identifier -> relative path |  | asset name -> relative path (textures get @1x/@2x suffixes) |
| `fallback` | object (below) | yes | what to show without WebGL2 |
| `split` | array of object (below) |  | 2D companion panels sharing this figure state |
| `constants` | map of identifier -> constant |  | name -> number, or {value, expect, tol} for a derived number |
| `model` | object (below) |  | library model whose outputs join the scope as <name>.<output> |
| `readouts` | array of object (below) |  | text readouts drawn over the figure |
| `caveats` | object (below) |  | honesty flags the build echoes in the caption |

#### shows: plot

| key | type | required | meaning |
|---|---|---|---|
| `type` | `plot` | yes | figure type |
| `x` | object (below) | yes | independent axis |
| `y` | object (below) | yes | dependent axis |
| `series` | array of object (below) (min 1) | yes | curves |
| `marker` | object (below) |  | current-value marker |
| `guides` | array of object (below) |  | reference lines |
| `constants` | map of identifier -> constant |  | name -> number, or {value, expect, tol} for a derived number |
| `model` | object (below) |  | library model whose outputs join the scope as <name>.<output> |
| `readouts` | array of object (below) |  | text readouts drawn over the figure |
| `caveats` | object (below) |  | honesty flags the build echoes in the caption |

#### shows: timeline

| key | type | required | meaning |
|---|---|---|---|
| `type` | `timeline` | yes | figure type |
| `x` | object (below) | yes | time axis |
| `bars` | array of object (below) (min 1) | yes | one horizontal bar per clock |
| `marker` | object (below) |  | current-time marker |
| `constants` | map of identifier -> constant |  | name -> number, or {value, expect, tol} for a derived number |
| `model` | object (below) |  | library model whose outputs join the scope as <name>.<output> |
| `readouts` | array of object (below) |  | text readouts drawn over the figure |
| `caveats` | object (below) |  | honesty flags the build echoes in the caption |

#### view

| key | type | required | meaning |
|---|---|---|---|
| `x` | [number, number] | yes | [min, max] horizontal extent in world units |
| `y` | [number, number] | yes | [min, max] vertical extent in world units |

#### constants

A constant is a number, or an object for a derived number:

| key | type | required | meaning |
|---|---|---|---|
| `value` | number | yes | the constant |
| `expect` | number or expression | yes | expression over other constants that must agree with value |
| `tol` | number | yes | absolute tolerance for the agreement |

#### model

| key | type | required | meaning |
|---|---|---|---|
| `name` | `kepler` \| `twobody` \| `cam` \| `lunar` | yes | library model name |
| `params` | map of identifier -> number or expression | yes | one entry per model parameter (see Models) |

| model | parameters (expressions) | outputs (`<model>.<name>`) | meaning |
|---|---|---|---|
| `kepler` | `a` semi-major axis (view units); `e` eccentricity 0 <= e < 1; `M` mean anomaly (radians) | `x`, `y`, `r`, `nu`, `E` | position on a Kepler ellipse for a mean anomaly |
| `twobody` | `m1` mass 1; `m2` mass 2; `r0` initial separation; `v0` initial relative speed; `t` time | `x1`, `y1`, `x2`, `y2`, `vx1`, `vy1`, `vx2`, `vy2` | two bodies under mutual gravity from a symmetric start |
| `cam` | `theta` cam angle (radians); `lift` maximum lift; `span` angular span of the lobe (radians) | `lift`, `velocity` | valve lift and velocity for a cam lobe |
| `lunar` | `t` days since J2000.0 | `lon`, `lat`, `dist`, `phase`, `sun_lon` | Moon and Sun positions from a precomputed ephemeris |

#### caveats

| key | type | required | meaning |
|---|---|---|---|
| `not_to_scale` | boolean |  | sizes or distances are not to scale |
| `simplified` | boolean |  | a simplified visualization; the ignored complication returns later |
| `exaggeration` | number |  | exaggeration factor applied by the renderer (> 1) |

#### readouts[]

| key | type | required | meaning |
|---|---|---|---|
| `id` | id |  | optional id so prose can data-ref the readout |
| `anchor` | layer id |  | follow this layer (exactly one of anchor / at) |
| `at` | [expr, expr] |  | fixed position (exactly one of anchor / at) |
| `offset` | [number, number] |  | [dx, dy] in CSS px from the anchor |
| `text` | template | yes | text with {expr:fmt} placeholders |
| `token` | token | yes | palette token name (--c-<name>) |
| `visible` | boolean or expression |  | boolean or expression (default true) |

#### split[] panels

| key | type | required | meaning |
|---|---|---|---|
| `at` | `right` \| `below` \| `inset:top-left` \| `inset:top-right` \| `inset:bottom-left` \| `inset:bottom-right` | yes | placement relative to the main scene |
| `shows` | scene2d or plot shows | yes | a scene2d or plot shows object without constants/model/caveats/split |

#### plot: x, y, series[], marker, guides[]

| key | type | required | meaning |
|---|---|---|---|
| `var` | identifier | yes | name of the free variable the series expressions use |
| `min` | number | yes | axis minimum |
| `max` | number | yes | axis maximum |
| `label` | string | yes | axis label |
| `unit` | string |  | unit suffix |

| key | type | required | meaning |
|---|---|---|---|
| `min` | number | yes | axis minimum |
| `max` | number | yes | axis maximum |
| `label` | string | yes | axis label |
| `unit` | string |  | unit suffix |
| `log` | boolean |  | logarithmic axis |

| key | type | required | meaning |
|---|---|---|---|
| `id` | id | yes | unique id |
| `y` | number or expression | yes | y as an expression of the x variable and the figure scope |
| `samples` | number |  | sample count across the axis (default 200) |
| `token` | token | yes | palette token name (--c-<name>) |
| `dash` | [number, number] |  | [on, off] dash lengths |

| key | type | required | meaning |
|---|---|---|---|
| `x` | number or expression | yes | current x position |
| `token` | token | yes | palette token name (--c-<name>) |

| key | type | required | meaning |
|---|---|---|---|
| `id` | id | yes | unique id |
| `x` | number or expression |  | vertical guide at x (exactly one of x / y) |
| `y` | number or expression |  | horizontal guide at y (exactly one of x / y) |
| `token` | token | yes | palette token name (--c-<name>) |
| `dash` | [number, number] |  | [on, off] dash lengths |
| `label` | string |  | label |

#### timeline: x, bars[]

| key | type | required | meaning |
|---|---|---|---|
| `min` | number | yes | axis minimum |
| `max` | number | yes | axis maximum |
| `label` | string | yes | axis label |
| `unit` | string |  | unit suffix |

| key | type | required | meaning |
|---|---|---|---|
| `id` | id | yes | unique id |
| `from` | number or expression | yes | bar start |
| `to` | number or expression | yes | bar end |
| `label` | string | yes | row label |
| `token` | token | yes | palette token name (--c-<name>) |

#### scene3d: camera, light, fallback

| key | type | required | meaning |
|---|---|---|---|
| `mode` | `arcball` \| `orbit` \| `fixed` \| `panorama` | yes | interaction mode |
| `distance` | number | yes | camera distance |
| `azimuth` | number | yes | initial azimuth (radians) |
| `polar` | number | yes | initial polar angle (radians) |
| `minPolar` | number |  | orbit limit |
| `maxPolar` | number |  | orbit limit |
| `minAzimuth` | number |  | orbit limit |
| `maxAzimuth` | number |  | orbit limit |
| `momentum` | boolean |  | decaying spin after release (default true) |
| `friction` | number |  | momentum decay per frame (default 0.92) |
| `lock` | object id |  | panorama: object to track |
| `edgeArrows` | boolean |  | panorama: arrows toward off-screen objects |

| key | type | required | meaning |
|---|---|---|---|
| `direction` | [expr, expr, expr] | yes | light direction vector |
| `ambient` | number | yes | ambient intensity 0..1 |

| key | type | required | meaning |
|---|---|---|---|
| `poster` | relative path | yes | static image shown without WebGL2 |
| `notice` | string | yes | one-line notice shown with the poster |

### Layers (scene2d `layers[]`)

Layer kinds: `circle`, `ellipse`, `line`, `ray`, `segment`, `arc`, `polygon`, `path`, `arrow`, `region`, `text`, `bars`, `image`.

Keys common to every layer:

| key | type | required | meaning |
|---|---|---|---|
| `id` | id | yes | unique across layers, controls and readouts; used by data-ref, anchor, region.of, point_at |
| `kind` | `circle` \| `ellipse` \| `line` \| `ray` \| `segment` \| `arc` \| `polygon` \| `path` \| `arrow` \| `region` \| `text` \| `bars` \| `image` | yes | layer kind |
| `stroke` | token |  | palette token name (--c-<name>) for the outline |
| `fill` | token |  | palette token name (--c-<name>) for the interior |
| `width` | number |  | stroke width in CSS px (default 1.5) |
| `dash` | [number, number] |  | [on, off] dash lengths in CSS px |
| `arrow` | `start` \| `end` \| `both` |  | arrowhead placement on line-like layers |
| `visible` | boolean or expression |  | boolean or expression; nonzero draws the layer (default true) |
| `highlight` | boolean |  | draw thicker with a halo (default false) |
| `label` | string |  | short in-canvas label drawn beside the shape |

#### layer: circle

| key | type | required | meaning |
|---|---|---|---|
| `cx` | number or expression | yes | center x |
| `cy` | number or expression | yes | center y |
| `r` | number or expression | yes | radius |

#### layer: ellipse

| key | type | required | meaning |
|---|---|---|---|
| `cx` | number or expression | yes | center x |
| `cy` | number or expression | yes | center y |
| `rx` | number or expression | yes | semi-axis along x |
| `ry` | number or expression | yes | semi-axis along y |
| `rotation` | number or expression |  | rotation (radians) |

#### layer: line

| key | type | required | meaning |
|---|---|---|---|
| `from` | [expr, expr] | yes | a point on the line |
| `to` | [expr, expr] | yes | another point; the line extends past both |

#### layer: ray

| key | type | required | meaning |
|---|---|---|---|
| `from` | [expr, expr] | yes | origin |
| `angle` | number or expression | yes | direction (radians) |
| `length` | number or expression | yes | drawn length |

#### layer: segment

| key | type | required | meaning |
|---|---|---|---|
| `from` | [expr, expr] | yes | start |
| `to` | [expr, expr] | yes | end |

#### layer: arc

| key | type | required | meaning |
|---|---|---|---|
| `cx` | number or expression | yes | center x |
| `cy` | number or expression | yes | center y |
| `r` | number or expression | yes | radius |
| `from` | number or expression | yes | start angle (radians) |
| `to` | number or expression | yes | end angle (radians), counter-clockwise from start |

#### layer: polygon

| key | type | required | meaning |
|---|---|---|---|
| `points` | array of [expr, expr] (min 3) | yes | closed vertex list |

#### layer: path

| key | type | required | meaning |
|---|---|---|---|
| `points` | array of [expr, expr] (min 2) | yes | open polyline vertex list |

#### layer: arrow

| key | type | required | meaning |
|---|---|---|---|
| `from` | [expr, expr] | yes | tail |
| `to` | [expr, expr] | yes | tip (head drawn here) |
| `head` | number |  | head length in CSS px |

#### layer: region

| key | type | required | meaning |
|---|---|---|---|
| `of` | array of circle/ellipse/polygon id (min 1) | yes | ids of circle/ellipse/polygon layers to combine |
| `op` | `intersect` \| `union` \| `subtract` | yes | boolean operation; subtract removes the rest from the first |

#### layer: text

| key | type | required | meaning |
|---|---|---|---|
| `at` | [expr, expr] | yes | anchor position |
| `text` | template | yes | text with {expr:fmt} placeholders |
| `size` | number |  | font size in CSS px (default 14) |
| `align` | `left` \| `center` \| `right` |  | horizontal alignment (default center) |

#### layer: bars

| key | type | required | meaning |
|---|---|---|---|
| `y` | number or expression | yes | baseline y of the first bar |
| `height` | number | yes | bar height in world units |
| `rows` | array of object (below) (min 1) | yes | one horizontal bar per row, stacked downward |

#### layer: image

| key | type | required | meaning |
|---|---|---|---|
| `src` | relative path | yes | relative image path (@2x variant picked by the runtime if present) |
| `rect` | [expr, expr, expr, expr] | yes | [x, y, w, h] in world units |

### 3D objects (scene3d `objects[]`)

Object kinds: `globe`, `sphere`, `ring`, `disc`, `body`, `arrow`, `part`, `label`.

Keys common to every object:

| key | type | required | meaning |
|---|---|---|---|
| `id` | id | yes | unique across objects, controls and labels |
| `kind` | `globe` \| `sphere` \| `ring` \| `disc` \| `body` \| `arrow` \| `part` \| `label` | yes | object kind |
| `position` | [expr, expr, expr] |  | [x, y, z] |
| `rotation` | [expr, expr, expr] |  | Euler angles (radians) |
| `scale` | number or expression |  | uniform scale |
| `color` | token |  | palette token name (--c-<name>) |
| `opacity` | number or expression |  | 0..1 |
| `visible` | boolean or expression |  | boolean or expression (default true) |
| `label` | string |  | DOM label projected next to the object |

#### object: globe

| key | type | required | meaning |
|---|---|---|---|
| `radius` | number or expression | yes | radius |
| `material` | `lambert` \| `phong` \| `standard` \| `unlit` \| `lut` | yes | shading model |
| `textures` | object (below) | yes | texture set |
| `lut` | asset name |  | color LUT for material lut |
| `exaggeration` | number or expression |  | relief exaggeration |

#### object: sphere

| key | type | required | meaning |
|---|---|---|---|
| `radius` | number or expression | yes | radius |
| `material` | `lambert` \| `phong` \| `standard` \| `unlit` \| `lut` | yes | shading model |
| `texture` | asset name |  | texture asset |

#### object: ring

| key | type | required | meaning |
|---|---|---|---|
| `radius` | number or expression | yes | radius |
| `width` | number |  | line width in CSS px |

#### object: disc

| key | type | required | meaning |
|---|---|---|---|
| `radius` | number or expression | yes | radius |

#### object: body

| key | type | required | meaning |
|---|---|---|---|
| `mesh` | asset name | yes | mesh asset (.bin) |
| `material` | `lambert` \| `phong` \| `standard` \| `unlit` \| `lut` | yes | shading model |

#### object: arrow

| key | type | required | meaning |
|---|---|---|---|
| `from` | [expr, expr, expr] | yes | tail |
| `to` | [expr, expr, expr] | yes | tip |
| `head` | number |  | head length |

#### object: part

| key | type | required | meaning |
|---|---|---|---|
| `mesh` | asset name | yes | mesh asset (.bin) |
| `material` | `lambert` \| `phong` \| `standard` \| `unlit` \| `lut` | yes | shading model |
| `cut` | object (below) |  | planar cut with stencil cap |
| `explode` | object (below) |  | exploded-view offset |

#### object: label

| key | type | required | meaning |
|---|---|---|---|
| `text` | template | yes | text with {expr:fmt} placeholders |
| `anchor` | object id |  | object to follow (exactly one of anchor / position) |
| `offset` | [number, number] |  | [dx, dy] CSS px |

#### cut / explode

| key | type | required | meaning |
|---|---|---|---|
| `plane` | 'x' | 'y' | 'z' or [n, n, n] | yes | 'x' | 'y' | 'z' or [nx, ny, nz] |
| `offset` | number or expression | yes | plane offset along its normal |

| key | type | required | meaning |
|---|---|---|---|
| `axis` | 'x' | 'y' | 'z' or [n, n, n] | yes | 'x' | 'y' | 'z' or [nx, ny, nz] |
| `offset` | number or expression | yes | displacement along the axis |

### Controls (`manipulates.controls[]`)

Control kinds: `slider`, `time`, `drag`, `toggle`, `segmented`, `play`. Every control has `kind`. Names join the expression scope as listed.

#### control: slider

| key | type | required | meaning |
|---|---|---|---|
| `name` | identifier | yes | identifier exposed to expressions |
| `label` | string | yes | label under the slider |
| `min` | number |  | minimum (with max; omit when values is given) |
| `max` | number |  | maximum |
| `step` | number |  | increment (> 0); continuous when omitted |
| `values` | array of number (min 1) |  | discrete values instead of min/max/step |
| `default` | number | yes | initial value |
| `width` | `standard` \| `long` |  | 380px or 600px track (default standard) |
| `token` | token | yes | palette token name (--c-<name>) |
| `format` | template |  | live <output> text, e.g. "{t:.2f} days" |
| `unit` | string |  | unit suffix for aria-valuetext |

#### control: time

| key | type | required | meaning |
|---|---|---|---|
| `name` | identifier | yes | identifier exposed as ms since epoch; <name>.rate in speed mode |
| `mode` | `scrub` \| `speed` | yes | the slider is the clock (scrub) or sets its rate (speed) |
| `window` | window |  | scrub: '24h' | '30d' | '18.61y' or a number of days |
| `rates` | array of number (min 1) |  | speed: selectable multiples of real time |
| `default` | number | yes | scrub: initial ms offset within the window; speed: initial rate |
| `epoch` | 'now' or ISO 8601 | yes | 'now' or an ISO 8601 instant |
| `format` | `datetime` \| `date` \| `time` \| `dhm` | yes | label format |
| `token` | token | yes | palette token name (--c-<name>) |

#### control: drag

| key | type | required | meaning |
|---|---|---|---|
| `name` | identifier | yes | exposes <name>.x, <name>.y, <name>.dragging (or .lat/.lon on a surface) |
| `default` | [number, number] | yes | initial [x, y] (or [lat, lon]) |
| `constrain` | constraint | yes | 'free' | 'x' | 'y' | 'view' | 'circle:R' | 'segment:[[x,y],[x,y]]' | 'surface:<objectId>' |
| `token` | token | yes | palette token name (--c-<name>) |
| `hit` | number |  | hit radius in CSS px (default 22; 30 on coarse pointers) |
| `preview` | array of layer id |  | layers shown only while dragging |
| `geolocate` | boolean |  | surface only: 'jump to my location' button |

#### control: toggle

| key | type | required | meaning |
|---|---|---|---|
| `name` | identifier | yes | exposes 0 or 1 |
| `label` | [string, string] | yes | [off label, on label] |
| `default` | boolean | yes | initial state |
| `token` | token | yes | palette token name (--c-<name>) |
| `position` | `corner` \| `below` |  | bottom-right corner button or under the canvas (default corner) |

#### control: segmented

| key | type | required | meaning |
|---|---|---|---|
| `name` | identifier | yes | exposes the selected value |
| `options` | array of object (below) (min 2) | yes | choices |
| `default` | number | yes | initial value; one of the options |
| `token` | token | yes | palette token name (--c-<name>) |

#### control: play

| key | type | required | meaning |
|---|---|---|---|
| `target` | slider/time name | yes | slider or time control to advance |
| `rate` | number | yes | target units per second (> 0) |
| `loop` | boolean |  | wrap at max (default false) |
| `autoplay` | boolean |  | start playing on approach; never under prefers-reduced-motion (default false) |

### Notice (`notice`)

| key | type | required | meaning |
|---|---|---|---|
| `steps` | `buttons` \| `segmented` \| `none` | yes | prev/next stepper, radio row, or nothing (states stay addressable) |
| `point_at` | array of id |  | layer ids the surrounding prose references with data-ref (checked: SPEC_POINT_AT_MISSING) |
| `states` | array of state (see States) | yes | ordered named states; other keys are <control name>: value |

#### States (`notice.states[]`)

Fixed keys:

| key | type | required | meaning |
|---|---|---|---|
| `name` | id | yes | unique state slug; the deep link is #<figure-id>=<name> |
| `caption` | string | yes | sentence shown by the stepper |
| `camera` | object (below) |  | scene3d camera pose |
| `drag` | map of identifier -> [number, number] |  | drag control name -> [x, y] |
| `visible` | object (below) |  | visibility overrides |

Every other key is a control name with a value in that control's range (slider/time: number; toggle: boolean; segmented: an option value). Drag positions go under `drag`.

### Formats (in `{expr:fmt}` placeholders)

| format | meaning |
|---|---|
| `.Nf` | fixed N decimals (N a single digit), e.g. .2f |
| `,d` | integer with thousands separators |
| `deg` | degrees with the ° sign, one decimal |
| `dhm` | days, hours, minutes (input in days) |
| `hms` | hours, minutes, seconds (input in hours) |
| `date` | calendar date (input ms since epoch) |
| `time` | clock time (input ms since epoch) |
| `datetime` | date and time (input ms since epoch) |
| `sci` | scientific notation, 3 significant digits |
| `unit:km` | length in km, shown in mi under body.x-imperial |
| `unit:mi` | length in mi, shown in km under body.x-imperial |

<!-- /generated:vocabulary -->

## Expression grammar

Implemented in `lib/expr.js`: `tokenize`, `parse`, `compile(src) -> { src, ast, identifiers }`, `evaluate(ast, scope, src)`, `identifiers(ast)`, `evaluateSource(src, scope)`. Errors are `ExprError { code, message, pos, src }` with codes `EXPR_SYNTAX`, `EXPR_UNKNOWN_FUNC`, `EXPR_ARITY`, `EXPR_UNKNOWN_IDENT`, `EXPR_NOT_FINITE`, `EXPR_BAD_VALUE`. Inside a spec these surface as `SPEC_BAD_EXPR`, `SPEC_UNKNOWN_IDENT` and `SPEC_NOT_FINITE`.

```
expr     := sum
sum      := product (('+' | '-') product)*
product  := power (('*' | '/' | '%') power)*
power    := unary (('^' | '**') power)?          right-associative
unary    := '-' unary | primary                  binds tighter than ^
primary  := number | ident | ident '(' args ')' | '(' expr ')'
args     := expr (',' expr)*
ident    := name ('.' name)*                     name := [A-Za-z_][A-Za-z0-9_]*
number   := digits ['.' digits] [e [+-] digits] | '.' digits [e [+-] digits]
```

Rules and examples:

| expression | value | note |
|---|---|---|
| `1 + 2 * 3` | 7 | usual precedence |
| `2 ^ 3 ^ 2` | 512 | `^` is right-associative; `**` is the same operator |
| `-2 ^ 2` | 4 | unary minus binds tighter than `^` (Excel convention); write `-(2^2)` for -4 |
| `2 ^ -3` | 0.125 | a unary minus may follow `^` |
| `-7 % 3` | -1 | `%` is the JavaScript remainder (sign of the dividend); use `wrap(x, lo, hi)` for a floored modulo |
| `R * cos(tau * t / T_sid)` | | identifiers are controls, constants, model outputs |
| `p.x + p.dragging` | | dotted names are ordinary identifiers; the scope is flat (`"p.x"`) |
| `e` | 2.718… | unless a control or constant named `e` is declared, which then wins (eccentricity is a legitimate name) |
| `deg(wrap(a - b))` | | angle difference folded into [0, 360) |
| `1 / (t - t)` | error | any non-finite intermediate result throws `EXPR_NOT_FINITE` with the operator position |
| `a ? b : c`, `a < b`, `x = 1`, `"s"`, `Math.sin(x)` | error | no conditionals, comparisons, assignment, strings or namespaces; `clamp`, `wrap`, `min`, `max`, `smoothstep` cover the piecewise needs |

Radians everywhere. Booleans in the scope read as 0/1 (toggles). Every function is total on finite inputs except where the table says non-finite.

<!-- generated:functions -->
| function | arity | meaning |
|---|---|---|
| `sin` | 1 | sine (radians) |
| `cos` | 1 | cosine (radians) |
| `tan` | 1 | tangent (radians) |
| `asin` | 1 | arcsine; |x| <= 1 or non-finite |
| `acos` | 1 | arccosine; |x| <= 1 or non-finite |
| `atan` | 1 | arctangent |
| `atan2` | 2 | atan2(y, x): angle of (x, y) in (-pi, pi] |
| `sqrt` | 1 | square root; x < 0 is non-finite |
| `abs` | 1 | absolute value |
| `min` | 2 or more | smallest argument |
| `max` | 2 or more | largest argument |
| `clamp` | 3 | clamp(x, lo, hi) |
| `wrap` | 1 or 3 | wrap(x) into [0, tau); wrap(x, lo, hi) into [lo, hi) |
| `floor` | 1 | round down |
| `ceil` | 1 | round up |
| `round` | 1 | round half up |
| `pow` | 2 | pow(a, b) = a ^ b |
| `exp` | 1 | e ^ x |
| `log` | 1 | natural logarithm; x <= 0 is non-finite |
| `sign` | 1 | -1, 0 or 1 |
| `lerp` | 3 | lerp(a, b, t) = a + (b - a) * t |
| `smoothstep` | 3 | smoothstep(e0, e1, x): 0 below e0, 1 above e1, cubic ease between |
| `deg` | 1 | radians -> degrees |
| `rad` | 1 | degrees -> radians |
| `hypot` | 2 or more | sqrt(a^2 + b^2 + ...) |

| constant | value |
|---|---|
| `pi` | 3.141592653589793 |
| `tau` | 6.283185307179586 |
| `e` | 2.718281828459045 |
<!-- /generated:functions -->

### Text templates

Readouts, `text` layers, slider `format` and 3D labels take a template: literal text with `{expr:fmt}` placeholders. The format is mandatory (there is no default), the first `:` separates expression from format (expressions never contain `:`), and `fmt` is one of the Formats table above. Example: `"Moon–Sun angle: {deg(wrap(tau*t/T_sid - tau*t/Y)):.0f}°"`.

## Error catalogue

`SPEC_*` codes come from `validateSpec()` (`FigSpecError { code, figureId, path, detail }`); the others from `tools/explainers.cjs`. Printed as `file:line: CODE figure-id: message`, e.g.

```
articles/moon/index.html:212: SPEC_UNKNOWN_IDENT fig-months: shows.layers[6].cx: unknown identifier "T_sidd"
```

<!-- generated:errors -->
| code | meaning |
|---|---|
| `SPEC_JSON` | the <script type="application/json"> block is not valid JSON |
| `SPEC_UNKNOWN_KEY` | a key that is not in the vocabulary for this object (additionalProperties:false) |
| `SPEC_MISSING_KEY` | a required key is absent; required keys have no defaults |
| `SPEC_BAD_TYPE` | a value has the wrong type or is outside a closed set of values |
| `SPEC_UNKNOWN_KIND` | a figure type, layer/object kind, control kind or model name outside the closed vocabulary |
| `SPEC_DUP_ID` | a layer id, control name, state name or constant name is declared twice (or shadows a built-in function) |
| `SPEC_BAD_TOKEN` | a color token that is not one of the article palette --c-<name> tokens |
| `SPEC_BAD_EXPR` | an expression string does not parse (syntax, unknown function or wrong arity) |
| `SPEC_UNKNOWN_IDENT` | an expression references a name that no control, constant or model output declares |
| `SPEC_BAD_FORMAT` | a text template placeholder is not {expr:fmt} with fmt from the format list |
| `SPEC_RANGE` | a default is outside min/max, a range is inverted, a step/rate is not positive, or a list is empty |
| `SPEC_CONFLICT` | two keys that cannot be combined were both given, or exactly one of two keys is needed |
| `SPEC_UNKNOWN_REF` | a reference to a layer/control/asset id that does not exist in this figure |
| `SPEC_EXPECT_MISMATCH` | a constant with {value, expect, tol} disagrees with its expect expression beyond tol |
| `SPEC_STATE_UNKNOWN_CONTROL` | a state key that is not a declared control (or camera/drag/visible) |
| `SPEC_STATE_OUT_OF_RANGE` | a state value outside the control range, options or window |
| `SPEC_POINT_AT_MISSING` | notice.point_at names a layer id the figure does not have |
| `SPEC_NOT_FINITE` | an expression evaluated to NaN or +/-Infinity at some state (states command) |
| `FIG_ID_MISSING` | <figure class="x-fig"> has no id="fig-<slug>" |
| `FIG_ASPECT_BAD` | data-aspect is missing or not W:H with positive integers |
| `FIG_SCRIPT_COUNT` | an interactive figure needs exactly one <script type="application/json"> child |
| `HTML_DUP_ID` | the same id attribute appears twice in the document |
| `HTML_SCRIPT_FORBIDDEN` | a <script> that is neither the runtime include nor a figure JSON block |
| `HTML_INCLUDE_MISSING` | the runtime <script defer src=...explainers-runtime.v1.js> or the stylesheet <link> is absent |
| `HTML_MAIN_MISSING` | the document has no <main> |
| `PALETTE_MISSING` | no --c-<name> tokens found in a :root rule of an inline <style> |
| `PALETTE_TOO_MANY` | more than 6 --c-<name> tokens declared |
| `PALETTE_CONTRAST` | a token has less than 3:1 contrast against --bg in light or dark scheme |
| `REF_FIG_UNKNOWN` | <span data-fig> or <a data-state href> names a figure id that is not on the page |
| `REF_ID_UNKNOWN` | <span data-ref> names an id that is not a layer, object, control or readout of that figure |
| `REF_STATE_UNKNOWN` | <a data-state> names a state that figure does not declare |
| `REF_STATE_HREF` | <a data-state> href is not #<figure-id> |
| `URL_ABSOLUTE` | a src/href is absolute (not relative or a fragment) and not an allowed origin or rel="external" |
| `GLOSSARY_DFN_NO_LINK` | <dfn id="t-*"> does not wrap exactly one <a href="#g-*"> |
| `GLOSSARY_SLUG_MISMATCH` | <dfn id="t-X"> wraps a link to #g-Y with X != Y |
| `GLOSSARY_ROW_MISSING` | a first use or term link points at a #g-<slug> row that does not exist |
| `GLOSSARY_BACK_MISSING` | a #g-<slug> row has no <a class="x-back" href="#t-<slug>">, or it points elsewhere |
| `GLOSSARY_ORPHAN_ROW` | a #g-<slug> row has no <dfn id="t-<slug>"> first use in the prose |
| `GLOSSARY_DUP_FIRST_USE` | more than one <dfn id="t-<slug>"> for the same slug |
| `GLOSSARY_ORDER` | a later use <a class="term"> or the glossary precedes the first use of that slug |
| `GLOSSARY_EMPTY_DD` | a glossary row has an empty <dd> |
| `GLOSSARY_NOT_LAST` | the glossary is not one <details id="glossary"> as the last element of <main> |
| `TEX_PARSE` | KaTeX could not parse an .x-tex formula (throwOnError) |
| `TEX_CLASS_UNKNOWN` | \tok{name} or \htmlClass{name} uses a name outside the palette |
| `TEX_BANNED` | \color or \textcolor used; only \tok{token}{...} colors symbols |
| `TEX_RENDER_ERROR` | KaTeX output contains its error color (#cc0000): an untrusted or rejected command |
| `TEX_STALE` | an .x-tex element has data-tex but its rendered content does not match a fresh render |
| `INTEGRITY_MISSING` | the runtime <script> or the stylesheet <link> has no integrity attribute (run: explainers build) |
| `INTEGRITY_STALE` | an integrity attribute does not match dist/integrity.json (run: explainers build) |
| `BUDGET_OVER` | gzip bytes of HTML + runtime + CSS + KaTeX CSS exceed --budget |
<!-- /generated:errors -->

## Glossary contract

Three places, one definition, shared slug:

```html
<!-- first use, exactly once per term, defined by apposition in the same sentence -->
<dfn id="t-synodic-month"><a href="#g-synodic-month">synodic month</a></dfn>, the time between two new Moons, ...

<!-- later uses -->
<a class="term" href="#g-synodic-month">synodic month</a>

<!-- last element inside <main>, from the template -->
<details id="glossary" class="x-glossary">
  <summary>Glossary</summary>
  <dl>
    <div class="row" id="g-synodic-month">
      <dt>synodic month <a class="x-back" href="#t-synodic-month" aria-label="back to first use">↩</a></dt>
      <dd>The time between two successive new Moons: 29.530 days (29 d 12 h 44 m). ...</dd>
    </div>
  </dl>
</details>
```

Validator invariants (all fail the build): every `<dfn>` has `id="t-<slug>"` and wraps exactly one `<a href="#g-<slug>">` with the same slug (`GLOSSARY_DFN_NO_LINK`, `GLOSSARY_SLUG_MISMATCH`); exactly one first use per slug (`GLOSSARY_DUP_FIRST_USE`); every first use and every `a.term` resolves to a row (`GLOSSARY_ROW_MISSING`); every row has a first use (`GLOSSARY_ORPHAN_ROW`), exactly one `.x-back` to `#t-<slug>` (`GLOSSARY_BACK_MISSING`) and a non-empty `<dd>` (`GLOSSARY_EMPTY_DD`); first use precedes every later use and the glossary (`GLOSSARY_ORDER`); the glossary is one `<details id="glossary" class="x-glossary">`, the last element of `<main>`, and all `#g-*` rows live inside it (`GLOSSARY_NOT_LAST`); no duplicate ids anywhere (`HTML_DUP_ID`).

Runtime behavior (phase 2): the `<dd>` text is the only source; one shared `<div id="x-tip" popover="hint" role="tooltip">` shows it on hover/focus of `a.term` on `(hover:hover)` devices; click and tap always navigate; on navigation to `#g-*`/`#t-*` the runtime sets `details#glossary.open = true` **before** scrolling (auto-open on fragment navigation is Chromium-only), then flashes the row.

## Page contract

What `validate` checks outside the specs:

- exactly one `<main>` (`HTML_MAIN_MISSING`); the runtime `<script defer src=".../dist/explainers-runtime.v1.js">` and `<link rel="stylesheet" href=".../dist/explainers.v1.css">` are present (`HTML_INCLUDE_MISSING`); no other `<script>` than those and the figure JSON blocks (`HTML_SCRIPT_FORBIDDEN`).
- integrity: both includes carry `integrity="sha384-..."` equal to their entry in `dist/integrity.json` (`INTEGRITY_MISSING` when the attribute is absent, `INTEGRITY_STALE` when it differs). The template ships the literal placeholders `integrity="{{integrity:dist/explainers-runtime.v1.js}}"` and `integrity="{{integrity:dist/explainers.v1.css}}"`; an article that still carries them is unbuilt and gets a warning ("run: explainers build"), like a formula without `data-tex`. Same-origin SRI needs no `crossorigin` attribute. `node tools/build-runtime.mjs` rewrites `dist/integrity.json` whenever the runtime or the stylesheet changes, and every article then needs `build` again.
- posters: every interactive figure has a current first frame as its first child, `<svg class="x-poster" id="<fig>-poster" data-poster="<sha1>">` inline or `<img class="x-poster" src="assets/poster-<fig>.svg" width height data-poster>` when the SVG exceeds 8 KiB (warnings: "no poster", "poster is stale", "poster file ... not found"; `build` fixes all three). The hash covers the emitter version and width, the spec, `data-aspect`, the palette values and, for scene3d, the caption text.
- every `src`/`href` is relative or a fragment (`URL_ABSOLUTE`), except `fonts.googleapis.com`, `fonts.gstatic.com`, `data:` URIs and `<a rel="external">`. Articles live at `articles/<slug>/index.html` and reach the runtime with `../../dist/...`, so the same file works at `<user>.github.io/explainers/`, behind the `explainers.sweedler.com` redirect, and from disk. (`404.html` is the one exception: GitHub Pages serves it at any depth.)
- palette: 1..6 `--c-<name>` tokens in an inline `<style>` (`PALETTE_MISSING`, `PALETTE_TOO_MANY`), each `light-dark(#l, #d)` with >= 3:1 contrast against `--bg` (`PALETTE_CONTRAST`; skipped with a warning when values are not hex `light-dark()`).
- figures: `id="fig-<slug>"` (`FIG_ID_MISSING`), `data-aspect="W:H"` (`FIG_ASPECT_BAD`), one JSON block (`FIG_SCRIPT_COUNT`, `SPEC_JSON`); `data-static` figures (pre-rendered images in the same wrapper) need only the id.
- prose refs: `<span data-fig data-ref>` names a figure on the page and one of its layer/object/control/readout ids (`REF_FIG_UNKNOWN`, `REF_ID_UNKNOWN`); `<a data-state href="#fig-x">` names a declared state (`REF_STATE_HREF`, `REF_STATE_UNKNOWN`).
- math: every `.x-tex` parses under `throwOnError` (`TEX_PARSE`), uses only palette names in `\tok{}`/`\htmlClass{}` (`TEX_CLASS_UNKNOWN`), never `\color`/`\textcolor` (`TEX_BANNED`), never renders KaTeX's red error text (`TEX_RENDER_ERROR`), and built output matches `data-tex` (`TEX_STALE`). Unbuilt formulas are a warning.
- states: every expression is finite at the defaults, at every state, and with each played control at min/default/max (`SPEC_NOT_FINITE`).
- `--budget`: gzip of HTML + runtime + CSS + KaTeX CSS (`BUDGET_OVER`).
- warnings (exit 0, `file:line: warning figure-id: message`): a `notice.point_at` id that no `<span data-fig data-ref>` on the page references; a `<span data-ref>` whose layer or readout is drawn neither at the defaults nor in any declared state (`visibleIds` from `lib/core/state.js`, the runtime's own rule; it would never highlight); a `<dfn>` first use inside a `<section>` that contains no `<figure class="x-fig">`; contrast not checkable; a formula not built; an unresolved integrity placeholder; a missing or stale poster.

## Authoring example

The phase-2 PoC 1 figure from the design, complete in `test/fixtures/pass/fig-months.html` (it passes `validate`, `states`, `build` and `budget`). Prose sets up the figure, the figure follows, then prose points at layers and states:

```html
<p>Let's start a clock at new Moon. The <span data-fig="fig-months" data-ref="star-line">dotted grey line</span> points at a distant star that never moves; the <span data-fig="fig-months" data-ref="sun-line">orange arrow</span> points at the Sun and creeps along as Earth travels its own orbit.</p>

<figure class="x-fig" id="fig-months" data-aspect="3:2">
<script type="application/json">
{
  "shows": {
    "type": "scene2d",
    "view": { "x": [-6, 6], "y": [-4, 4] },
    "constants": { "R": 3, "T_sid": 27.321661, "Y": 365.256363,
                   "T_syn": { "value": 29.530589, "expect": "1/(1/T_sid - 1/Y)", "tol": 0.001 } },
    "caveats": { "not_to_scale": true },
    "layers": [
      { "id": "orbit",      "kind": "circle", "cx": 0, "cy": 0, "r": "R", "stroke": "muted", "dash": [4, 4] },
      { "id": "earth",      "kind": "circle", "cx": 0, "cy": 0, "r": 0.6, "fill": "earth", "label": "Earth" },
      { "id": "star-line",  "kind": "ray", "from": [0, 0], "angle": 0, "length": 5.6, "stroke": "star", "dash": [2, 6], "label": "to a distant star" },
      { "id": "sun-line",   "kind": "ray", "from": [0, 0], "angle": "tau*t/Y", "length": 5.6, "stroke": "sun", "arrow": "end", "label": "to the Sun", "visible": "showSun" },
      { "id": "trail",      "kind": "arc", "cx": 0, "cy": 0, "r": "R", "from": 0, "to": "tau*t/T_sid", "stroke": "moon", "width": 3 },
      { "id": "elongation", "kind": "arc", "cx": 0, "cy": 0, "r": 1.2, "from": "tau*t/Y", "to": "tau*t/T_sid", "stroke": "sun", "width": 2, "visible": "showSun" },
      { "id": "moon",       "kind": "circle", "cx": "R*cos(tau*t/T_sid)", "cy": "R*sin(tau*t/T_sid)", "r": 0.18, "fill": "moon" }
    ],
    "readouts": [
      { "anchor": "moon", "offset": [14, -14], "text": "day {t:.1f}", "token": "moon" },
      { "at": [-5.7, 3.5], "text": "{t:dhm}", "token": "moon" },
      { "at": [-5.7, -3.5], "text": "Moon–Sun angle: {deg(wrap(tau*t/T_sid - tau*t/Y)):.0f}°", "token": "sun", "visible": "showSun" }
    ]
  },
  "manipulates": {
    "controls": [
      { "kind": "slider", "name": "t", "label": "days since new Moon", "min": 0, "max": 60, "step": 0.01, "default": 0, "width": "long", "token": "moon", "format": "{t:.2f} days" },
      { "kind": "toggle", "name": "showSun", "label": ["hide Sun direction", "show Sun direction"], "default": true, "token": "sun", "position": "corner" },
      { "kind": "play", "target": "t", "rate": 4, "loop": false, "autoplay": false }
    ]
  },
  "notice": {
    "steps": "buttons",
    "point_at": ["star-line", "sun-line", "moon"],
    "states": [
      { "name": "new-moon", "t": 0, "showSun": true, "caption": "New Moon: the Moon sits on both the star line and the Sun line." },
      { "name": "sidereal", "t": 27.321661, "showSun": true, "caption": "One sidereal month: back on the star line, but the Sun line has moved on." },
      { "name": "synodic",  "t": 29.530589, "showSun": true, "caption": "One synodic month: back on the Sun line. New Moon again." }
    ]
  }
}
</script>
<figcaption>Drag the slider or press play. Not to scale.</figcaption>
</figure>

<p>Move the slider until the <span data-fig="fig-months" data-ref="moon">grey Moon</span> returns to the <span data-fig="fig-months" data-ref="star-line">dotted star line</span>. That takes <a href="#fig-months" data-state="sidereal">27.32 days</a>, one <dfn id="t-sidereal-month"><a href="#g-sidereal-month">sidereal month</a></dfn>, ... The two rates subtract:</p>
<div class="x-tex">\frac{1}{\tok{sun}{T_{\mathrm{syn}}}} = \frac{1}{\tok{moon}{T_{\mathrm{sid}}}} - \frac{1}{\tok{star}{Y}}</div>
```

What the validator rejects here: an unknown key (`colour`), an unknown identifier (`T_sidd`), a state with `t` outside [0, 60], a `data-ref`/`data-state` that does not exist in `fig-months`, a token outside the palette, `T_syn` disagreeing with its `expect`, a `dfn` without a row, a bad formula, or any `<script>` that is not the JSON block. `test/fixtures/fail/` holds one broken article per code.

## CLI

`tools/explainers.cjs` is a single committed file (Node 22, bundled by `tools/build-cli.mjs` from `tools/src/` + `lib/` + parse5 + KaTeX). Running it needs no `npm install`.

```
node tools/explainers.cjs validate <html...> [--budget 170k]
node tools/explainers.cjs states   <html...>
node tools/explainers.cjs build    <html...>
node tools/explainers.cjs budget   <html...> [--budget 170k]
node tools/explainers.cjs vocab | errors | --version | --help
```

Exit codes: 0 clean, 1 at least one error (all errors are printed, not just the first), 2 usage. Warnings print in the same shape with `warning` in place of the code and do not fail. `build` rewrites in place and is idempotent (a second run produces identical bytes), in four passes that each re-parse the previous pass's output: (1) math, keeping the LaTeX source in `data-tex`; (2) posters: `lib/poster-svg.js` draws each figure's default state at 704 px wide (the 44rem reading column, the canvas width at desktop) and the result goes in front of the JSON block as `<svg class="x-poster" id="<fig>-poster" aria-hidden="true" data-poster="<sha1>">`, or, above 8 KiB of markup, to `articles/<slug>/assets/poster-<fig>.svg` referenced as `<img class="x-poster" src="assets/poster-<fig>.svg" alt="" width height aria-hidden="true" data-poster>` (a poster that shrinks back below the limit is inlined again and the file removed); an existing poster is kept when its hash matches and replaced when it does not; (3) the caveat sentence: `shows.caveats.not_to_scale` appends "Not to scale." to the `<figcaption>` (after a period if the caption lacks one; a figure without a figcaption gets one) unless the caption already says it; `simplified` and `exaggeration` are the author's to word; (4) `integrity=` on the runtime `<script>` and the stylesheet `<link>` from `dist/integrity.json`, whether the attribute is the template placeholder, stale or absent. KaTeX configuration: `output: 'htmlAndMathml'`, `throwOnError: true`, `strict: code => code === 'htmlExtension' ? 'ignore' : 'error'`, `trust: ctx => ctx.command === '\\htmlClass' && palette.has(ctx.class)`, `macros: { '\\tok': '\\htmlClass{#1}{#2}' }`; `\tok{token}{x}` renders as `<span class="enclosing token">`, which `dist/explainers.v1.css` colors with `var(--c-token)`.

Budget units: `170k` = 170 000 bytes (k/kb = 1000, kib = 1024, m = 10^6). Counted: article HTML (inline posters included), `explainers-runtime.v1.js`, `explainers.v1.css`, `katex.min.css`. Not counted: fonts, the lazy 3D chunk, external images (external posters included).

Poster SVG: `<style>` scoped by the SVG's own id; classes `s-<token>` / `f-<token>` are `stroke` / `fill: var(--c-<token>, <palette value>)`, `s-fg`/`f-fg`/`f-bg`/`f-panel` likewise over `--fg`/`--bg`/`--x-panel`, `.h` is the text halo (`paint-order: stroke` in `--bg`); no `currentColor`, no literal colors outside the `var()` fallbacks, so an inline poster follows the page's scheme and an external one falls back to the article palette. `#<fig>-poster:root { color-scheme: light dark }` applies only when the SVG is its own document. Geometry is the runtime's: `compileLayer` + `geometryOf` (recorded through a `Path2D`-shaped writer, `SvgPath`), `worldToPx`, `splitBoxes`, `fitBox`, `niceTicks`; text widths are estimated (0.5 em per glyph) since Node has no `measureText`; the corner-button strip (60 px) is reserved when the figure has Play or a corner toggle, as the runtime does after measuring. Drawn: every layer kind (`image` as a dashed placeholder rectangle), labels, readouts, drag handles, split panels (insets framed), plot axes / gridlines / ticks / guides / series / marker, timeline bars; a scene3d poster is the framed box with the figcaption text.

## Phase 2 contract

Phase 2 writes the browser runtime against this document alone. It must produce `dist/explainers-runtime.v1.js` (<= 40 KB gz, IIFE, loaded with one `<script defer>`), `dist/explainers.v1.css` (~5 KB gz), the lazy `dist/explainers-3d.v1.js`, `lib/poster-svg.js`, and `dist/integrity.json`, replacing the phase-1 stubs. Nothing in phase 1 changes except where this section says "phase 2 adds".

### Phase 2 status

Phase 2 shipped the 2D runtime, the stylesheet, and PoC 1. The rest of this section is the contract as written before phase 2; where the implementation deviates, the list below wins.

**Delivered** (2026-09-22): `dist/explainers-runtime.v1.js` (plain ES2020 IIFE, about 35 KB gzipped, no dependencies, concatenated from `lib/` by `tools/build-runtime.mjs`; `npm test` fails when it is stale), `dist/explainers.v1.css` (about 3.6 KB gzipped), `articles/moon/index.html` (passes `validate`, `states`, `build` idempotently and `budget --budget 170k`; 46.5 KB gzipped critical path), `test/runtime.test.mjs` (the pure parts under Node: formats, easing, clock, state application, deep links, layout, drag constraints, ticks, models, the build). Phase-1 files are unchanged.

**Implemented**: boot (palette from the inline `<style>`, `validateSpec` per figure with the `x-fig-error` fallback, scaffold at boot, mount on approach with `IntersectionObserver` at 100 px / 400 px for scene3d, `#fig-x=state` routing on load and `hashchange`, token re-resolution on scheme change, `document.fonts.ready` redraw); the Figure object (`set/get/goto/play/pause/restart/setVisible/tick/draw/dispose`, plus `refInfo`/`highlight` for prose refs and `window.explainers`); one shared rAF clock (`dt` in seconds clamped to 100 ms, injectable `now`/`schedule`, idle when nothing moves); `goto` as a 600 ms smoothstep over every numeric target, discrete values snapping at the midpoint, `visible.show/hide` fades, play paused, running transition interrupted, `history.replaceState`, `x-fig:state` on completion; all six control kinds with the contract's ids and DOM (slider on `<input type=range>` with a 40 px thumb, time scrub/speed, drag via Pointer Events + `setPointerCapture` + a `role=slider` keyboard proxy, toggle corner/below, segmented radio row, Play/Restart corner buttons, stepper buttons or radio row with `aria-live` output and captions); Scene2D on Canvas 2D at DPR 1|2 with all thirteen layer kinds, `arrow` heads, `highlight` halos, in-canvas labels, readouts with halo and an `aria-live` text mirror, `split` panels (right / below / insets), plot panels (nice 1-2-5 ticks, gridlines, series with the x variable bound, marker, guides, log y) and timeline bars; the four models (`kepler`, `twobody`, `cam`, `lunar`) with the outputs `lib/spec.js` declares; terms (`#x-tip` `popover=hint` filled from the `<dd>`, hover/focus on `(hover: hover)` devices, Escape and scroll hide it), glossary (`details#glossary.open = true` in the click handler before the browser scrolls, also on `hashchange`, then a flash of the row or the first use), presets and deep links, prose refs (`x-ref`, `data-token`, `data-dashed`, hover highlight), `a.x-pause-all` toggling `html.x-paused`, the four CustomEvents, `prefers-reduced-motion` (0 ms eases, no autoplay), `\tok{}` colors in built equations; a Scene3D placeholder (fallback poster when given, the figcaption text, and "3D figure (WebGL) not yet available in this build.").

**Added after delivery** (2026-09-22): prose refs inherit the visibility of what they point at. `figure.visibleIds` is recomputed after every scope change and state (`lib/core/state.js` `visibleIds`, the pure rule `isShown` follows), `x-fig:visibility` fires when the set changes, and `lib/site/hooks.js` toggles `x-ref-hidden` on the spans, which the stylesheet renders as plain prose with no hover highlight. Tested in `test/runtime.test.mjs` against fig-months.

**Added after delivery** (2026-09-22): slider geometry and ticks. A native range moves the knob so its edge touches the input's ends, so the knob center stops half a knob (20 px) short; the runtime now draws the visible track itself (`div.x-track`, a sibling of the input inset by half the knob on both sides, `--x-pct` measured along it), so the knob center lands exactly on the track ends and the fill is flush with the knob center; the wrapper is one knob wider than the 380/600 px track. A discrete control (a `values` list, or `(max - min) / step <= 40`; a speed-mode time control's `rates`) gets one `i.x-tick` per stop (2 x 8 px, `--c-muted`, behind the track) where the knob center lands; a continuous control gets none (`lib/controls/slider.js` `stepFractions` / `evenFractions`).

**Deferred to phase 3**: `dist/explainers-3d.v1.js` and `lib/scene3d/*` (three.js; the placeholder above stands in), the drag `surface:<id>` constraint and `geolocate`; the test files this section names (`states`, `glossary`, `budget`, Playwright): `test/runtime.test.mjs` covers the goto transition under a fake clock, deep links and the runtime/CSS budgets in Node, and the DOM behavior was verified by headless Chrome screenshots (`preview/`, not committed). Posters, the caveat sentence, integrity and the three validator warnings landed in phase 3A (below).

### Phase 3 status

**Phase 3A delivered** (2026-09-22): SVG posters, subresource integrity and the three validator warnings; the contract for each is in "Page contract" and "CLI" above.

1. **Posters.** `lib/poster-svg.js` exports `posterSvg(spec | compiled, scopeOrState, { aspect, tokens, id, caption, hash })`, `posterSize(aspect)`, `SvgPath`, `POSTER_WIDTH` (704) and `POSTER_VERSION` (bump it to re-emit every poster). `build` inserts the poster as the figure's first child, before the JSON block (the phase-2 sketch had it after). The runtime (`lib/site/figure.js`) moves `:scope > .x-poster` into `.x-canvas-box` right after the canvas at boot, so the poster is the reserved box before boot (`.x-fig:has(> .x-poster):not([data-booted])::before` is suppressed), overlays the canvas until the first draw, and `.x-fig[data-mounted] .x-poster { display: none }` hides it; `dispose()` puts it back. Same aspect at every step, so the layout never shifts. Measured on the two articles: moon 1 poster (2.4 KB, inline); hebrew-calendar 14 posters, 4 external (`fig-julian-calendar` 8.9 KB, `fig-gregorian-calendar` 13.1 KB, `fig-leap-month` 9.1 KB, `fig-hebrew-calendar` 12.8 KB), the rest 3.0 to 7.5 KB inline; critical path 48.7 -> 49.8 KB (moon) and 77.4 -> 87.9 KB (hebrew-calendar) gzipped.
2. **Integrity.** `tools/integrity.mjs` (`computeIntegrity`, `writeIntegrity`) writes `dist/integrity.json` = `{ "dist/explainers-runtime.v1.js": "sha384-...", "dist/explainers.v1.css": "sha384-..." }` from `tools/build-runtime.mjs` (and `--check` refuses a stale one); `test/runtime.test.mjs` fails when it is stale. `tools/src/integrity.mjs` fills (`build`) and compares (`validate`). Only these two files are listed: the lazy 3D chunk is a dynamic `import()`, which SRI attributes cannot cover.
3. **Warnings.** `tools/src/article.mjs` `checkRefWarnings` and `checkDfnSections`; `tools/src/poster.mjs` `checkPosters`; fixtures in `test/fixtures/warn/` (generated by `test/fixtures/make-fail.mjs`, header `<!-- explainers-test: warning="..." command=validate -->`), which `test/cli.test.mjs` runs expecting exit 0 and the warning line.
4. **Tests added**: `test/poster.test.mjs` (fig-months at the defaults: well-formed, 20 elements, six texts, token `var()` rules with fallbacks; at a state and with the toggle off; `SvgPath` arc semantics; plot, timeline, scene3d and region posters; `posterSize`), the build test (poster placement, hash, caption not repeated, integrity resolved and refreshed, idempotence, clean validate), a caveat / externalization test (append once; `<img>` + `assets/poster-<fig>.svg` above 8 KiB; restore a missing file; inline again and remove the file when the spec shrinks), the warning-fixture loop, and the `dist/integrity.json` currency test.
5. **Deviations from the phase-2 sketch**: the poster hash covers more than "spec + aspect" (emitter version and width, palette values, scene3d caption) because each of those changes the bytes; the `<img>` variant carries `width`/`height`/`aria-hidden`/`data-poster` too, so it reserves its box and is checked like the inline one; an unresolved integrity placeholder is a warning rather than `INTEGRITY_MISSING` so unbuilt fixtures and freshly assembled articles validate (the codes fire for absent and wrong attributes); `simplified` and `exaggeration` do not append a sentence.

**Still deferred**: `dist/explainers-3d.v1.js` and `lib/scene3d/*` (a sibling task), `surface:<id>` drags and `geolocate`, the Playwright suite.

**Deviations from the contract, and why**:

1. **Concatenation, not esbuild.** `tools/build-runtime.mjs` drops `import` lines, strips `export`, and joins the modules in dependency order inside one IIFE; every module keeps unique top-level names (the build refuses duplicates), whole-line comments and indentation are dropped, and the browser-unused parts of `lib/spec.js`/`lib/expr.js` (the markdown renderers after the `docs` marker and the `ERROR_CATALOGUE` text) are cut. No dependency, no install, and browser and CLI still share the same `validateSpec`.
2. **Time control values follow `lib/spec.js`, not the prose above.** `controlDefaults` and `checkStateValue` treat a scrub value as the ms offset within the window (0..window) and a speed value as elapsed ms plus `<name>.rate`; the runtime exposes exactly that. `epoch` only formats the control's own label (`format: datetime | date | time | dhm`). `{name:date}` on a scrub control therefore needs `epoch` added by the author; phase 3 may add `<name>.epoch` to the scope with a vocabulary bump.
3. **Scaffold at boot, draw on approach.** The canvas box (with `aspect-ratio` from `data-aspect`), the controls and the stepper are created at boot so nothing shifts when a figure comes into view; `data-mounted` and `x-fig:mount` mark the first draw on approach. Off screen the canvas bitmap is released (`width = height = 0`) and ticking stops; the DOM is not removed, because unmounting controls would shift the page. `dispose()` still tears everything down.
4. **`touch-action: none` only with drag controls.** A canvas with nothing to drag lets a touch scroll the page.
5. **The drawing keeps clear of the corner strip.** When a figure has Play/Restart or a corner toggle, the world view is fitted into the box minus the measured bottom strip the button groups occupy (their height plus 8 px, re-measured on resize and when Play becomes Pause), so "nothing overlaps the drawing" holds wherever an author places readouts (PoC 1 puts one at the bottom-left corner of the view). Readouts are also kept inside their panel and, when an `offset` or anchor lands one over a button group, moved up above it.
6. **`\tok{}` colors are set by the runtime**, not the stylesheet: token names are per article, and the template CSP forbids injected stylesheets, so `style.color = var(--c-<token>)` is set on each `.x-tex .enclosing.<token>`. Without JavaScript the equation is uncolored.
7. **Slider and time controls share the `_sl<i>` counter**, so a page with both never repeats an id.
8. **Play/Restart details**: Play at the end of a non-looping range restarts from the minimum; Restart sets the target to its minimum and plays; manual input on the play target pauses; play and manual input clear the active state, and the stepper then shows "N states" with no caption. The `aria-live` readout mirror updates 300 ms after the last change so screen readers are not flooded during a drag.
9. **In-canvas `label`s** sit under circles/ellipses and past the tip of line-like layers; a tip label that would leave the panel folds back along the line (below a near-horizontal line, above a sloped one). Every label is then measured and kept inside the panel (one crossing the right edge is right-aligned 4 px inside it), off the corner buttons, and clear of labels placed earlier in the frame, stacking by its own height (coincident rays).
10. **Prose refs are hover-only** unless the span is focusable; `tabindex` is not added to non-interactive spans.
11. **The world view is letterboxed** (uniform scale, centered) when the box aspect differs from the view aspect, so circles stay round.


### Modules (lib/)

| module | exports | responsibility |
|---|---|---|
| `lib/spec.js`, `lib/expr.js` | as today | imported unchanged; the runtime calls `validateSpec(spec, { figureId, palette })`, `scopeForState`, `evaluate` |
| `lib/site/boot.js` | entry; sets `window.explainers = { version, figures: Map<id, Figure>, goto(figId, state), pauseAll(bool) }` (a test/console handle, not an authoring surface) | finds figures, validates, observes, owns the rAF loop, hashchange routing, theme re-resolution |
| `lib/core/clock.js` | `createClock({ now = performance.now }) -> { start, stop, onTick(fn), pause(bool) }` | one rAF loop, `dt` clamped to 100 ms, injectable clock for tests |
| `lib/core/ease.js` | `smoothstep(t)`, `transition({ from, to, ms, onStep, onDone, reduced })` | 600 ms eases, 0 ms under `prefers-reduced-motion` |
| `lib/core/tokens.js` | `resolveTokens(names) -> Map<name, cssColor>`, `onSchemeChange(fn)` | `getComputedStyle(document.documentElement).getPropertyValue('--c-<name>')`, re-read on `matchMedia('(prefers-color-scheme: dark)')` change |
| `lib/core/format.js` | `format(value, fmt, { imperial })`, `renderTemplate(parts, scope)` | exactly the Formats table: `.Nf`; `,d` via `Intl.NumberFormat`; `deg` -> `123.4°`; `dhm` from days -> `27 d 7 h 43 m`; `hms` from hours -> `23 h 56 m 4 s`; `date`/`time`/`datetime` from ms via `Intl.DateTimeFormat`; `sci` 3 significant digits; `unit:km|mi` flips with `document.body.classList.contains('x-imperial')`; real minus sign U+2212 |
| `lib/core/visibility.js` | `observe(el, { rootMargin, onEnter, onLeave })` | `IntersectionObserver` with rootMargin 100px (400px for scene3d); marks everything visible when the API is missing |
| `lib/core/layout.js` | `dprFor(window) = devicePixelRatio > 1.75 ? 2 : 1`, `fitCanvas(canvas, box, dpr)`, `worldToPx(view, box)` | canvas backing store, explicit CSS size, `ResizeObserver` relayout |
| `lib/core/drag.js` | `attachDrag(el, { onStart, onMove, onEnd, hit })` | Pointer Events + `setPointerCapture`, `touch-action:none` on the element only, coarse-pointer hit enlargement, focusable proxy with arrow keys |
| `lib/controls/*.js` | `mountSlider(fig, control, i)`, `mountTime`, `mountDragPoint`, `mountToggle`, `mountSegmented`, `mountPlay`, `mountStepper` | one file per control kind; every change goes through `figure.set(name, value)` |
| `lib/scene2d/scene2d.js`, `layers.js`, `plot.js`, `label.js` | `createScene2d(fig, canvas)` with `draw(scope)` | Canvas 2D drawing of every layer kind, plot panels, timeline bars, readouts with halo; `split` panels |
| `lib/scene2d/models/{kepler,twobody,cam,lunar}.js` | `compute(params) -> outputs` | numerics for `MODELS`; output names exactly as declared in `lib/spec.js` |
| `lib/scene3d/*.js` (lazy chunk) | `mountScene3d(fig, compiled, THREE)` | tree-shaken three.js 0.185.0 adapter: globe, materials, arcball with momentum, cut planes with stencil caps, DOM labels, dispose, WebGL2 check -> poster + notice |
| `lib/site/term.js`, `glossary.js`, `presets.js`, `deeplink.js` | | tooltip popover, details-open-before-scroll, `data-state` links, `#fig-x=state` |
| `lib/poster-svg.js` | `posterSvg(spec \| compiled, scopeOrState, { aspect, tokens, id, caption, hash }) -> string`, `posterSize(aspect)`, `SvgPath` | first frame as SVG for `build` (Node); same geometry code as the canvas, colors as `var(--c-<token>, fallback)` in a scoped `<style>` |

### Boot sequence

1. On `DOMContentLoaded`: read the palette names from the spec tokens, resolve them with `tokens.js`.
2. For each `figure.x-fig` without `data-static`: parse the JSON block; `validateSpec(spec, { figureId: figure.id, palette })`. On `FigSpecError` insert `<p class="x-fig-error">CODE path: detail</p>` inside the figure and skip it (the CLI already refused it; this is defense).
3. Reserve the box: `.x-fig` gets `style.aspectRatio = W / H` from `data-aspect` (CSS provides the fallback).
4. Observe with rootMargin 100px; on first enter, mount. scene3d figures observe at 400px and `import('./explainers-3d.v1.js')` once; they show the poster until textures arrive.
5. Handle `location.hash` (`#fig-x=state` boots that figure eagerly, applies the state without easing, scrolls to it; `#g-*`/`#t-*` opens the glossary before scrolling).

### Figure object

```
figure.id                       'fig-months'
figure.compiled                 result of validateSpec
figure.scope                    Map name -> number (constants, controls, model outputs); starts as compiled.defaults
figure.set(name, value)         validates against the control, updates scope, knob, readouts, redraws; emits 'x-fig:set'
figure.visibleIds               Set of the ids a prose ref may point at right now (every declared id minus the layers and
                                readouts not drawn); recomputed after every change, 'x-fig:visibility' when it differs
figure.get(name)
figure.goto(stateName, { ease = true })   eases every numeric control/drag/camera over 600 ms (smoothstep), snaps booleans and
                                segmented values at the midpoint, fades show/hide layers, pauses play, interrupts a running
                                transition, writes history.replaceState(null, '', '#' + id + '=' + stateName); emits 'x-fig:state'
figure.play() / pause() / restart()      play advances the target control by rate units per second (loop wraps, else stops at max)
figure.setVisible(bool)         only visible, unpaused, animated figures tick
figure.tick(dt) / figure.draw()
figure.dispose()
```

Animation: there is no implicit clock variable. The only animated quantities are play targets and speed-mode time controls; a `play` control advances `target` by `rate` per real second. `autoplay: true` is ignored under `prefers-reduced-motion`. `document.documentElement.classList.contains('x-paused')` (toggled by `a.x-pause-all`) pauses every figure.

### DOM produced by mount

```html
<figure class="x-fig" id="fig-x" data-aspect="3:2" data-mounted>
  <!-- <svg class="x-poster" id="fig-x-poster" data-poster="…"> is the first child as built (or <img class="x-poster" src="assets/poster-fig-x.svg">); boot moves it into the canvas box -->
  <script type="application/json">…</script>                 <!-- untouched -->
  <div class="x-canvas-box">
    <canvas></canvas>                                         <!-- touch-action:none; DPR 1|2 -->
    <svg class="x-poster" …>…</svg>                           <!-- over the canvas until the first draw; display:none at data-mounted -->
    <button class="x-play" aria-pressed="false">Play</button> <button class="x-restart">Restart</button>   <!-- bottom-left -->
    <button class="x-toggle" id="fig-x_tg0" aria-pressed="true">show Sun direction</button>                <!-- bottom-right -->
    <div class="x-readouts" aria-live="polite">…</div>        <!-- text mirror of canvas readouts -->
  </div>
  <div class="x-ctl x-ctl-slider x-long" id="fig-x_sl0" style="--token: var(--c-moon)">
    <label>days since new Moon <div class="x-track"><i class="x-tick" style="--at: 0%"></i>…</div> <input type="range" min max step value aria-valuetext> <output>0.00 days</output></label>   <!-- ticks only on discrete controls -->
  </div>
  <div class="x-ctl x-ctl-segmented" id="fig-x_seg0"><fieldset role="radiogroup">…</fieldset></div>
  <button class="x-drag-proxy" id="fig-x_drag_p" role="slider" aria-label="p">…</button>   <!-- keyboard nudging -->
  <div class="x-stepper" id="fig-x_steps">
    <button class="x-prev">‹</button> <output aria-live="polite">2 of 3 · sidereal</output> <button class="x-next">›</button>
    <p class="x-caption">One sidereal month: …</p>
  </div>
  <figcaption>…</figcaption>
</figure>
```

Ids: `<fig>_sl<i>` for slider and time controls, `<fig>_seg<i>`, `<fig>_tg<i>`, `<fig>_drag_<name>`, `<fig>_steps`, `i` counting within the kind in spec order. Controls mount under the canvas in spec order, then the stepper. Play and toggle (`position: corner`) are absolutely positioned over the canvas box; nothing overlaps the drawing.

### Events (CustomEvent on the figure element, bubbles)

| event | detail |
|---|---|
| `x-fig:mount` | `{ id }` |
| `x-fig:set` | `{ id, name, value, source: 'user' \| 'state' \| 'play' }` |
| `x-fig:state` | `{ id, state }` after a goto completes |
| `x-fig:play` | `{ id, playing }` |
| `x-fig:visibility` | `{ id, visible: Set<id> }` when the set of drawn ids changes (a toggle, a `visible` expression crossing zero, a state's `visible.hide`/`show`, a drag preview); also after `set`, `goto`, `restart` and play ticks that change it |

### Prose hooks

- `span[data-fig][data-ref]`: at boot the runtime sets `class="x-ref"`, `data-token="<token>"` (layer: `stroke ?? fill`; control/readout: `token`) and `data-dashed` when the layer has `dash`; CSS colors it with `var(--c-<token>)` and a dashed underline. Hover/focus sets `layer.highlight = true` while the figure is on screen.
- **A ref inherits the visibility of what it points at.** Hiding information in a figure hides it in the linked text: when the layer or readout a span names is not drawn in the figure's current state (its `visible` expression evaluates to zero, e.g. `showSun` toggled off; the applied state's `visible.hide`; a drag `preview` layer while its handle is not held), the span carries `class="x-ref x-ref-hidden"` and renders as plain prose: inherited color, no underline, default cursor, and hovering it highlights nothing. When the figure draws it again the class goes and the styling and hover return. Refs to controls, constants, series, guides and objects are always visible; `<a data-state>` links are unaffected. Mechanism: `figure.visibleIds` (`visibleIds(compiled, scope, stateVisible)` in `lib/core/state.js`) is recomputed after every scope change, the figure dispatches `x-fig:visibility` with `{ id, visible: Set<id> }` when it changes, and `lib/site/hooks.js` applies the class on mount and on each event. Phase 3 owes the `validate` warning for a ref whose layer is hidden in every state.
- `a[data-state][href="#fig-x"]`: click is intercepted; the figure is scrolled into view only if off-screen (`block: 'nearest'`); then `figure.goto(state, { ease: true })`. Without JS the fragment link still scrolls to the figure.
- `a.term[href="#g-*"]`, `dfn a[href="#g-*"]`, `a.x-back[href="#t-*"]`: as in the Glossary contract.
- `a.x-pause-all`: toggles `html.x-paused` and its own text.

### Rendering rules (scene2d)

World units from `view`; y up. `stroke`/`fill` tokens resolve to CSS colors; `width` in CSS px (default 1.5); `dash` in CSS px; `arrow` heads 10 px; `visible` nonzero draws; `highlight` doubles width and adds a halo. `circle`, `ellipse` (`ctx.ellipse`), `line` (clipped to the view), `segment`, `ray` (from `from` at `angle` for `length`), `arc` (counter-clockwise from `from` to `to`), `polygon` (closed), `path` (open), `arrow`, `region` (clip-path intersection/union/subtraction of circle/ellipse/polygon layers, fill only), `text` (template, halo), `bars` (rows stacked downward from `y`, `height` each), `image` (`src` with `@2x` if DPR 2, drawn into `rect`). Readouts follow `anchor` layers (their center for circles/ellipses, `to` for segments/rays/arrows, first point otherwise) plus `offset` px, or sit at `at`. Plot panels: nice ticks, gridlines, series sampled `samples` times (default 200) with the x variable bound, marker at `marker.x`, guides. Timeline: one bar per `bars[]` row with its label, marker line at `marker.x`.

### CLI additions in phase 2

`build` also inserts `<svg class="x-poster">` from `lib/poster-svg.js` (inline up to 8 KiB, else `<img src="assets/poster-<fig>.svg">`) and appends the caveat sentence to `<figcaption>` when `shows.caveats.not_to_scale` is set and the caption lacks it. `validate` also checks `integrity=` attributes against `dist/integrity.json`, warns when a `point_at` layer is never referenced by `data-ref`, when a referenced layer is hidden in every state, and when a `dfn` sits in a section without a figure. Delivered in phase 3A; see "Phase 3 status". No vocabulary changes without a version bump.

### Tests phase 2 must add

`test/states.test.mjs` (goto under a fake clock reaches each state exactly), `test/glossary.test.mjs` (details opens before scroll), `test/poster.test.mjs` (poster SVG for fig-months at t=0 parses and draws every visible layer; delivered in phase 3A), `test/budget.test.mjs` (runtime <= 40 KB gz; fig-months page <= 60 KB gz critical path), `test/browser/poc-1.spec.mjs` (Playwright: touch drag does not scroll, CLS 0, no 3D fetch before first paint).

## Decisions where the design was silent

1. **Unary minus binds tighter than `^`** (`-2^2 = 4`), as specified for phase 1; `-(x^2)` is the other reading. `**` is accepted as an alias of `^` even though the design listed "no `**`", because the phase-1 brief asked for it.
2. **Function list** = the phase-1 list plus `smoothstep` from the design (the runtime needs it for eases and it is the only non-linear interpolation an author may want). `%` keeps JavaScript remainder semantics; `wrap` is the floored modulo.
3. **No implicit `t`.** The design lists "t" among identifiers, but in its own example `t` is a slider. Making it implicit would collide. Animation is only `play.target` and speed-mode `time`; the `states` command sweeps every play target at min/default/max instead of the brief's "t=0 and t=default".
4. **Shadowing `pi`/`tau`/`e`** by a declared name is allowed and wins (eccentricity `e`).
5. **`model` is `{ name, params }`**, not the bare string the design sketched, so parameters can be expressions of controls (`"M": "tau*t/T_sid"`). Outputs are namespaced `<model>.<output>`; model names are identifier-safe (`twobody`, `lunar`). The four models and their outputs are provisional until PoC 3; numerics are phase 2.
6. **Layer kinds** are exactly the design's components list (`segment`, `path`, `bars`, `image`, …), not the brief's paraphrase (`polyline`, `plotSeries`). The `arrow` layer and the `arrow` property on line-like layers both exist because the design lists both.
7. **Aspect ratio lives only in `data-aspect`** (CSS needs it before JS); the spec has no `aspect` key.
8. **Templates require an explicit format** and split at the first colon. Readouts may carry an `id` so prose can `data-ref` them (the brief mentions readout refs).
9. **One id namespace** per figure across layers, objects, series, guides, bars, readouts, control names and constants; built-in function names are reserved.
10. **Optional keys may have defaults** (`width: standard`, `loop`/`autoplay: false`, `visible: true`); required keys never do.
11. **Time control:** scrub `default` is the ms offset within `window`; speed `default` is the initial rate; expressions see `<name>` (ms since epoch) and `<name>.rate`. The design's `name_date` is dropped: `{name:date}` formats the same number.
12. **States:** drag positions go under `drag`; `camera` is scene3d-only; `steps` other than `none` needs at least one state.
13. **`validate` runs the states check too**; `states` is the verbose listing.
14. **Budget** `k` = 1000; KaTeX CSS counted; when an include is not found next to the article, the repo's `dist/`/`assets/` copy is measured (so fixtures measure the real files).
15. **`validateSpec` without `palette`** skips token checks (unit tests of shape); the CLI always passes the article palette.
16. **`ERROR_CATALOGUE`** in `lib/spec.js` lists the CLI's HTML/glossary/math/budget codes too, so the codes the skill must understand have one home; `Problems.error` refuses unknown codes.
17. **Contrast** (>= 3:1 both schemes) is checked when tokens and `--bg` are `light-dark(#hex, #hex)`; otherwise a warning.
18. **Tooling dependencies** live in `tools/package.json`; the root `package.json` only runs `node --test`. `tools/explainers.cjs --version` prints the versions actually bundled; `build-cli.mjs` warns when they differ from the pins.
19. **Pass fixtures stay unbuilt** (no `data-tex`), so they do not pin one KaTeX version's HTML; the CLI test builds a temp copy and checks idempotence.
20. **`integrity=` and `dist/integrity.json`** landed in phase 3A: the template carries literal `{{integrity:dist/<file>}}` placeholders (an external assembler copies the head with a plain string replace and never learns the hashes), `build` resolves and refreshes them, `validate` compares. An unresolved placeholder is a warning (unbuilt), an absent attribute `INTEGRITY_MISSING`, a wrong one `INTEGRITY_STALE`; pass fixtures stay unbuilt and therefore warn, like their formulas.
21. **`404.html`** uses the Pages project path (`/explainers/`), the one page that cannot be relative.
22. **Fail fixtures are generated** (`test/fixtures/make-fail.mjs`) from `minimal.html` and committed with a self-describing header; the CLI test asserts every catalogue code has one.
