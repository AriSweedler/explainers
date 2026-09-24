// lib/spec.js — the closed figure-spec vocabulary and its validator.
// Shared by the browser runtime (phase 2) and tools/explainers.cjs, so the
// browser and CI cannot disagree. Plain ES2020, no dependencies.
//
// The vocabulary is DATA (the tables below). validateSpec() walks the same
// tables that describeVocabulary() renders, so DESIGN.md cannot drift from
// what the validator accepts. Every object has additionalProperties:false
// semantics: an unknown key is an error, a missing required key is an error,
// and required keys have no silent defaults.

import { compile, evaluate, identifiers, ExprError, FUNCTIONS, CONSTANTS } from './expr.js';

// ------------------------------------------------------------------ errors

export class FigSpecError extends Error {
  constructor(code, figureId, path, detail) {
    super(`${path || '(spec)'}: ${detail}`);
    this.name = 'FigSpecError';
    this.code = code;
    this.figureId = figureId;
    this.path = path || '(spec)';
    this.detail = detail;
  }
}

// code -> one-line description. Spec codes come from validateSpec(); the
// HTML-, glossary-, math- and budget-level codes are raised by the CLI, which
// imports this table so the catalogue has one home.
export const ERROR_CATALOGUE = Object.freeze({
  // lib/spec.js
  SPEC_JSON: 'the <script type="application/json"> block is not valid JSON',
  SPEC_UNKNOWN_KEY: 'a key that is not in the vocabulary for this object (additionalProperties:false)',
  SPEC_MISSING_KEY: 'a required key is absent; required keys have no defaults',
  SPEC_BAD_TYPE: 'a value has the wrong type or is outside a closed set of values',
  SPEC_UNKNOWN_KIND: 'a figure type, layer/object kind, control kind or model name outside the closed vocabulary',
  SPEC_DUP_ID: 'a layer id, control name, state name or constant name is declared twice (or shadows a built-in function)',
  SPEC_BAD_TOKEN: 'a color token that is not one of the article palette --c-<name> tokens',
  SPEC_BAD_EXPR: 'an expression string does not parse (syntax, unknown function or wrong arity)',
  SPEC_UNKNOWN_IDENT: 'an expression references a name that no control, constant or model output declares',
  SPEC_BAD_FORMAT: 'a text template placeholder is not {expr:fmt} with fmt from the format list',
  SPEC_RANGE: 'a default is outside min/max, a range is inverted, a step/rate is not positive, or a list is empty',
  SPEC_CONFLICT: 'two keys that cannot be combined were both given, or exactly one of two keys is needed',
  SPEC_UNKNOWN_REF: 'a reference to a layer/control/asset id that does not exist in this figure',
  SPEC_EXPECT_MISMATCH: 'a constant with {value, expect, tol} disagrees with its expect expression beyond tol',
  SPEC_STATE_UNKNOWN_CONTROL: 'a state key that is not a declared control (or camera/drag/visible)',
  SPEC_STATE_OUT_OF_RANGE: 'a state value outside the control range, options or window',
  SPEC_POINT_AT_MISSING: 'notice.point_at names a layer or object id the figure does not have',
  SPEC_NOT_FINITE: 'an expression evaluated to NaN or +/-Infinity at some state (states command)',
  // tools/explainers.cjs: figures and page structure
  FIG_ID_MISSING: '<figure class="x-fig"> has no id="fig-<slug>"',
  FIG_ASPECT_BAD: 'data-aspect is missing or not W:H with positive integers',
  FIG_SCRIPT_COUNT: 'an interactive figure needs exactly one <script type="application/json"> child',
  HTML_DUP_ID: 'the same id attribute appears twice in the document',
  HTML_SCRIPT_FORBIDDEN: 'a <script> that is neither the runtime include nor a figure JSON block',
  HTML_INCLUDE_MISSING: 'the runtime <script defer src=...explainers-runtime.v1.js> or the stylesheet <link> is absent',
  HTML_MAIN_MISSING: 'the document has no <main>',
  PALETTE_MISSING: 'no --c-<name> tokens found in a :root rule of an inline <style>',
  PALETTE_TOO_MANY: 'more than 6 --c-<name> tokens declared',
  PALETTE_CONTRAST: 'a token has less than 3:1 contrast against --bg in light or dark scheme',
  // prose references
  REF_FIG_UNKNOWN: '<span data-fig> or <a data-state href> names a figure id that is not on the page',
  REF_ID_UNKNOWN: '<span data-ref> names an id that is not a layer, object, control or readout of that figure',
  REF_STATE_UNKNOWN: '<a data-state> names a state that figure does not declare',
  REF_STATE_HREF: '<a data-state> href is not #<figure-id>',
  URL_ABSOLUTE: 'a src/href is absolute (not relative or a fragment) and not an allowed origin or rel="external"',
  // glossary contract
  GLOSSARY_DFN_NO_LINK: '<dfn id="t-*"> does not wrap exactly one <a href="#g-*">',
  GLOSSARY_SLUG_MISMATCH: '<dfn id="t-X"> wraps a link to #g-Y with X != Y',
  GLOSSARY_ROW_MISSING: 'a first use or term link points at a #g-<slug> row that does not exist',
  GLOSSARY_BACK_MISSING: 'a #g-<slug> row has no <a class="x-back" href="#t-<slug>">, or it points elsewhere',
  GLOSSARY_ORPHAN_ROW: 'a #g-<slug> row has no <dfn id="t-<slug>"> first use in the prose',
  GLOSSARY_DUP_FIRST_USE: 'more than one <dfn id="t-<slug>"> for the same slug',
  GLOSSARY_ORDER: 'a later use <a class="term"> or the glossary precedes the first use of that slug',
  GLOSSARY_EMPTY_DD: 'a glossary row has an empty <dd>',
  GLOSSARY_NOT_LAST: 'the glossary is not one <details id="glossary"> as the last element of <main>',
  // math
  TEX_PARSE: 'KaTeX could not parse an .x-tex formula (throwOnError)',
  TEX_CLASS_UNKNOWN: '\\tok{name} or \\htmlClass{name} uses a name outside the palette',
  TEX_BANNED: '\\color or \\textcolor used; only \\tok{token}{...} colors symbols',
  TEX_RENDER_ERROR: 'KaTeX output contains its error color (#cc0000): an untrusted or rejected command',
  TEX_STALE: 'an .x-tex element has data-tex but its rendered content does not match a fresh render',
  // subresource integrity
  INTEGRITY_MISSING: 'the runtime <script> or the stylesheet <link> has no integrity attribute (run: explainers build)',
  INTEGRITY_STALE: 'an integrity attribute does not match dist/integrity.json (run: explainers build)',
  // budget
  BUDGET_OVER: 'gzip bytes of HTML + runtime + CSS + KaTeX CSS exceed --budget',
});

// ---------------------------------------------------------------- vocabulary

export const FIGURE_TYPES = Object.freeze(['scene2d', 'scene3d', 'plot', 'timeline']);
export const CONTROL_KINDS = Object.freeze(['slider', 'time', 'drag', 'toggle', 'segmented', 'play']);
export const LAYER_KINDS = Object.freeze(['circle', 'ellipse', 'line', 'ray', 'segment', 'arc', 'polygon', 'path', 'arrow', 'region', 'text', 'bars', 'image']);
export const OBJECT_KINDS = Object.freeze(['globe', 'sphere', 'ring', 'disc', 'body', 'arrow', 'part', 'label']);
export const FORMATS = Object.freeze({
  '.Nf': 'fixed N decimals (N a single digit), e.g. .2f',
  ',d': 'integer with thousands separators',
  deg: 'degrees with the ° sign, one decimal',
  dhm: 'days, hours, minutes (input in days)',
  hms: 'hours, minutes, seconds (input in hours)',
  date: 'calendar date (input ms since epoch)',
  time: 'clock time (input ms since epoch)',
  datetime: 'date and time (input ms since epoch)',
  sci: 'scientific notation, 3 significant digits',
  'unit:km': 'length in km, shown in mi under body.x-imperial',
  'unit:mi': 'length in mi, shown in km under body.x-imperial',
});
export const FORMAT_RE = /^(\.\df|,d|deg|dhm|hms|date|time|datetime|sci|unit:(km|mi))$/;
export const MAX_TOKENS = 6;

// Library models: numerics live in the runtime (phase 2). The validator needs
// only their input names (fed by expressions) and output names with a finite
// sample value for headless evaluation. Outputs are exposed as <model>.<output>.
export const MODELS = Object.freeze({
  kepler: {
    doc: 'position on a Kepler ellipse for a mean anomaly',
    params: { a: 'semi-major axis (view units)', e: 'eccentricity 0 <= e < 1', M: 'mean anomaly (radians)' },
    outputs: { x: 0.9, y: 0.4, r: 1, nu: 0.4, E: 0.4 },
  },
  twobody: {
    doc: 'two bodies under mutual gravity from a symmetric start',
    params: { m1: 'mass 1', m2: 'mass 2', r0: 'initial separation', v0: 'initial relative speed', t: 'time' },
    outputs: { x1: -0.5, y1: 0, x2: 0.5, y2: 0, vx1: 0, vy1: 0.5, vx2: 0, vy2: -0.5 },
  },
  cam: {
    doc: 'valve lift and velocity for a cam lobe',
    params: { theta: 'cam angle (radians)', lift: 'maximum lift', span: 'angular span of the lobe (radians)' },
    outputs: { lift: 0.5, velocity: 0.1 },
  },
  lunar: {
    doc: 'Moon and Sun positions from a precomputed ephemeris',
    params: { t: 'days since J2000.0' },
    outputs: { lon: 1, lat: 0.05, dist: 384400, phase: 0.5, sun_lon: 2 },
  },
});

// ---- schema helpers. A field is { type, req, doc }. A type is a string
// (see checkType) or one of { enum }, { array, min }, { object }, { map }.
const f = (type, doc, req = false) => ({ type, doc, req });
const REQ = true;
const en = (...values) => ({ enum: values });
const arr = (type, min = 0) => ({ array: type, min });
const obj = (fields) => ({ object: fields });
const map = (type) => ({ map: type });

const TOKEN_DOC = 'palette token name (--c-<name>)';

export const SCHEMA = {};

SCHEMA.view = {
  x: f('range', '[min, max] horizontal extent in world units', REQ),
  y: f('range', '[min, max] vertical extent in world units', REQ),
};

SCHEMA.caveats = {
  not_to_scale: f('boolean', 'sizes or distances are not to scale'),
  simplified: f('boolean', 'a simplified visualization; the ignored complication returns later'),
  exaggeration: f('number', 'exaggeration factor applied by the renderer (> 1)'),
};

SCHEMA.constant = {
  value: f('number', 'the constant', REQ),
  expect: f('expr', 'expression over other constants that must agree with value', REQ),
  tol: f('number', 'absolute tolerance for the agreement', REQ),
};

SCHEMA.model = {
  name: f(en(...Object.keys(MODELS)), 'library model name', REQ),
  params: f(map('expr'), 'one entry per model parameter (see Models)', REQ),
};

SCHEMA.layerCommon = {
  id: f('id', 'unique across layers, controls and readouts; used by data-ref, anchor, region.of, point_at', REQ),
  kind: f(en(...LAYER_KINDS), 'layer kind', REQ),
  stroke: f('token', `${TOKEN_DOC} for the outline`),
  fill: f('token', `${TOKEN_DOC} for the interior`),
  width: f('number', 'stroke width in CSS px (default 1.5)'),
  dash: f('pair', '[on, off] dash lengths in CSS px'),
  arrow: f(en('start', 'end', 'both'), 'arrowhead placement on line-like layers'),
  visible: f('flag', 'boolean or expression; nonzero draws the layer (default true)'),
  highlight: f('boolean', 'draw thicker with a halo (default false)'),
  label: f('string', 'short in-canvas label drawn beside the shape'),
};

SCHEMA.layers = {
  circle: { cx: f('expr', 'center x', REQ), cy: f('expr', 'center y', REQ), r: f('expr', 'radius', REQ) },
  ellipse: {
    cx: f('expr', 'center x', REQ), cy: f('expr', 'center y', REQ),
    rx: f('expr', 'semi-axis along x', REQ), ry: f('expr', 'semi-axis along y', REQ),
    rotation: f('expr', 'rotation (radians)'),
  },
  line: { from: f('point', 'a point on the line', REQ), to: f('point', 'another point; the line extends past both', REQ) },
  segment: { from: f('point', 'start', REQ), to: f('point', 'end', REQ) },
  ray: { from: f('point', 'origin', REQ), angle: f('expr', 'direction (radians)', REQ), length: f('expr', 'drawn length', REQ) },
  arc: {
    cx: f('expr', 'center x', REQ), cy: f('expr', 'center y', REQ), r: f('expr', 'radius', REQ),
    from: f('expr', 'start angle (radians)', REQ), to: f('expr', 'end angle (radians), counter-clockwise from start', REQ),
  },
  polygon: { points: f(arr('point', 3), 'closed vertex list', REQ) },
  path: { points: f(arr('point', 2), 'open polyline vertex list', REQ) },
  arrow: { from: f('point', 'tail', REQ), to: f('point', 'tip (head drawn here)', REQ), head: f('number', 'head length in CSS px') },
  region: {
    of: f(arr('ref:shape', 1), 'ids of circle/ellipse/polygon layers to combine', REQ),
    op: f(en('intersect', 'union', 'subtract'), 'boolean operation; subtract removes the rest from the first', REQ),
  },
  text: {
    at: f('point', 'anchor position', REQ),
    text: f('template', 'text with {expr:fmt} placeholders', REQ),
    size: f('number', 'font size in CSS px (default 14)'),
    align: f(en('left', 'center', 'right'), 'horizontal alignment (default center)'),
  },
  bars: {
    y: f('expr', 'baseline y of the first bar', REQ),
    height: f('number', 'bar height in world units', REQ),
    rows: f(arr(obj({
      label: f('string', 'row label', REQ),
      from: f('expr', 'bar start x', REQ),
      to: f('expr', 'bar end x', REQ),
      token: f('token', TOKEN_DOC, REQ),
    }), 1), 'one horizontal bar per row, stacked downward', REQ),
  },
  image: { src: f('relpath', 'relative image path (@2x variant picked by the runtime if present)', REQ), rect: f('rect', '[x, y, w, h] in world units', REQ) },
};

SCHEMA.readout = {
  id: f('id', 'optional id so prose can data-ref the readout'),
  anchor: f('ref:layer', 'follow this layer (exactly one of anchor / at)'),
  at: f('point', 'fixed position (exactly one of anchor / at)'),
  offset: f('pair', '[dx, dy] in CSS px from the anchor'),
  text: f('template', 'text with {expr:fmt} placeholders', REQ),
  token: f('token', TOKEN_DOC, REQ),
  visible: f('flag', 'boolean or expression (default true)'),
};

SCHEMA.plotAxisX = {
  var: f('name', 'name of the free variable the series expressions use', REQ),
  min: f('number', 'axis minimum', REQ),
  max: f('number', 'axis maximum', REQ),
  label: f('string', 'axis label', REQ),
  unit: f('string', 'unit suffix'),
};
SCHEMA.plotAxisY = {
  min: f('number', 'axis minimum', REQ),
  max: f('number', 'axis maximum', REQ),
  label: f('string', 'axis label', REQ),
  unit: f('string', 'unit suffix'),
  log: f('boolean', 'logarithmic axis'),
};
SCHEMA.series = {
  id: f('id', 'unique id', REQ),
  y: f('expr', 'y as an expression of the x variable and the figure scope', REQ),
  samples: f('number', 'sample count across the axis (default 200)'),
  token: f('token', TOKEN_DOC, REQ),
  dash: f('pair', '[on, off] dash lengths'),
};
SCHEMA.marker = { x: f('expr', 'current x position', REQ), token: f('token', TOKEN_DOC, REQ) };
SCHEMA.guide = {
  id: f('id', 'unique id', REQ),
  x: f('expr', 'vertical guide at x (exactly one of x / y)'),
  y: f('expr', 'horizontal guide at y (exactly one of x / y)'),
  token: f('token', TOKEN_DOC, REQ),
  dash: f('pair', '[on, off] dash lengths'),
  label: f('string', 'label'),
};
SCHEMA.timelineAxis = {
  min: f('number', 'axis minimum', REQ),
  max: f('number', 'axis maximum', REQ),
  label: f('string', 'axis label', REQ),
  unit: f('string', 'unit suffix'),
};
SCHEMA.bar = {
  id: f('id', 'unique id', REQ),
  from: f('expr', 'bar start', REQ),
  to: f('expr', 'bar end', REQ),
  label: f('string', 'row label', REQ),
  token: f('token', TOKEN_DOC, REQ),
};

SCHEMA.camera = {
  mode: f(en('arcball', 'orbit', 'fixed', 'panorama'), 'interaction mode', REQ),
  distance: f('number', 'camera distance', REQ),
  azimuth: f('number', 'initial azimuth (radians)', REQ),
  polar: f('number', 'initial polar angle (radians)', REQ),
  minPolar: f('number', 'orbit limit'), maxPolar: f('number', 'orbit limit'),
  minAzimuth: f('number', 'orbit limit'), maxAzimuth: f('number', 'orbit limit'),
  momentum: f('boolean', 'decaying spin after release (default true)'),
  friction: f('number', 'momentum decay per frame (default 0.92)'),
  lock: f('ref:object', 'panorama: object to track'),
  edgeArrows: f('boolean', 'panorama: arrows toward off-screen objects'),
};
SCHEMA.light = { direction: f('point3', 'light direction vector', REQ), ambient: f('number', 'ambient intensity 0..1', REQ) };
SCHEMA.fallback = { poster: f('relpath', 'static image shown without WebGL2', REQ), notice: f('string', 'one-line notice shown with the poster', REQ) };
SCHEMA.cut = { plane: f('plane', "'x' | 'y' | 'z' or [nx, ny, nz]", REQ), offset: f('expr', 'plane offset along its normal', REQ) };
SCHEMA.explode = { axis: f('plane', "'x' | 'y' | 'z' or [nx, ny, nz]", REQ), offset: f('expr', 'displacement along the axis', REQ) };

const MATERIALS = en('lambert', 'phong', 'standard', 'unlit', 'lut');
SCHEMA.objectCommon = {
  id: f('id', 'unique across objects, controls and labels', REQ),
  kind: f(en(...OBJECT_KINDS), 'object kind', REQ),
  position: f('point3', '[x, y, z]'),
  rotation: f('point3', 'Euler angles (radians)'),
  scale: f('expr', 'uniform scale'),
  color: f('token', TOKEN_DOC),
  opacity: f('expr', '0..1'),
  visible: f('flag', 'boolean or expression (default true)'),
  label: f('string', 'DOM label projected next to the object'),
};
SCHEMA.objects = {
  globe: {
    radius: f('expr', 'radius', REQ),
    material: f(MATERIALS, 'shading model', REQ),
    textures: f(obj({ land: f('asset', 'land texture asset', REQ), clouds: f('asset', 'cloud texture asset'), outline: f('asset', 'outline texture asset') }), 'texture set', REQ),
    lut: f('asset', 'color LUT for material lut'),
    exaggeration: f('expr', 'relief exaggeration'),
  },
  sphere: { radius: f('expr', 'radius', REQ), material: f(MATERIALS, 'shading model', REQ), texture: f('asset', 'texture asset') },
  ring: { radius: f('expr', 'radius', REQ), width: f('number', 'line width in CSS px') },
  disc: { radius: f('expr', 'radius', REQ) },
  body: { mesh: f('asset', 'mesh asset (.bin)', REQ), material: f(MATERIALS, 'shading model', REQ) },
  arrow: { from: f('point3', 'tail', REQ), to: f('point3', 'tip', REQ), head: f('number', 'head length') },
  part: {
    mesh: f('asset', 'mesh asset (.bin)', REQ),
    material: f(MATERIALS, 'shading model', REQ),
    cut: f(obj(SCHEMA.cut), 'planar cut with stencil cap'),
    explode: f(obj(SCHEMA.explode), 'exploded-view offset'),
  },
  label: {
    text: f('template', 'text with {expr:fmt} placeholders', REQ),
    anchor: f('ref:object', 'object to follow (exactly one of anchor / position)'),
    offset: f('pair', '[dx, dy] CSS px'),
  },
};

SCHEMA.panel = {
  at: f(en('right', 'below', 'inset:top-left', 'inset:top-right', 'inset:bottom-left', 'inset:bottom-right'), 'placement relative to the main scene', REQ),
  shows: f('panelShows', 'a scene2d or plot shows object without constants/model/caveats/split', REQ),
};

const SHOWS_SHARED = {
  constants: f(map('constant'), 'name -> number, or {value, expect, tol} for a derived number'),
  model: f(obj(SCHEMA.model), 'library model whose outputs join the scope as <name>.<output>'),
  readouts: f(arr(obj(SCHEMA.readout)), 'text readouts drawn over the figure'),
  caveats: f(obj(SCHEMA.caveats), 'honesty flags the build echoes in the caption'),
};

SCHEMA.shows = {
  scene2d: {
    type: f(en('scene2d'), 'figure type', REQ),
    view: f(obj(SCHEMA.view), 'world-unit viewport', REQ),
    layers: f(arr('layer', 1), 'drawn bottom to top', REQ),
    split: f(arr(obj(SCHEMA.panel)), 'companion panels sharing this figure state'),
    ...SHOWS_SHARED,
  },
  plot: {
    type: f(en('plot'), 'figure type', REQ),
    x: f(obj(SCHEMA.plotAxisX), 'independent axis', REQ),
    y: f(obj(SCHEMA.plotAxisY), 'dependent axis', REQ),
    series: f(arr(obj(SCHEMA.series), 1), 'curves', REQ),
    marker: f(obj(SCHEMA.marker), 'current-value marker'),
    guides: f(arr(obj(SCHEMA.guide)), 'reference lines'),
    ...SHOWS_SHARED,
  },
  timeline: {
    type: f(en('timeline'), 'figure type', REQ),
    x: f(obj(SCHEMA.timelineAxis), 'time axis', REQ),
    bars: f(arr(obj(SCHEMA.bar), 1), 'one horizontal bar per clock', REQ),
    marker: f(obj(SCHEMA.marker), 'current-time marker'),
    ...SHOWS_SHARED,
  },
  scene3d: {
    type: f(en('scene3d'), 'figure type', REQ),
    camera: f(obj(SCHEMA.camera), 'camera and interaction', REQ),
    light: f(obj(SCHEMA.light), 'directional + ambient light', REQ),
    shadows: f('boolean', 'cast shadows (default false)'),
    objects: f(arr('object', 1), 'scene objects', REQ),
    assets: f(map('relpath'), 'asset name -> relative path (textures get @1x/@2x suffixes)'),
    fallback: f(obj(SCHEMA.fallback), 'what to show without WebGL2', REQ),
    split: f(arr(obj(SCHEMA.panel)), '2D companion panels sharing this figure state'),
    ...SHOWS_SHARED,
  },
};

SCHEMA.controlCommon = {
  kind: f(en(...CONTROL_KINDS), 'control kind', REQ),
};
SCHEMA.controls = {
  slider: {
    name: f('name', 'identifier exposed to expressions', REQ),
    label: f('string', 'label under the slider', REQ),
    min: f('number', 'minimum (with max; omit when values is given)'),
    max: f('number', 'maximum'),
    step: f('number', 'increment (> 0); continuous when omitted'),
    values: f(arr('number', 1), 'discrete values instead of min/max/step'),
    default: f('number', 'initial value', REQ),
    width: f(en('standard', 'long'), '380px or 600px track (default standard)'),
    token: f('token', TOKEN_DOC, REQ),
    format: f('template', 'live <output> text, e.g. "{t:.2f} days"'),
    unit: f('string', 'unit suffix for aria-valuetext'),
  },
  time: {
    name: f('name', 'identifier exposed as ms since epoch; <name>.rate in speed mode', REQ),
    mode: f(en('scrub', 'speed'), 'the slider is the clock (scrub) or sets its rate (speed)', REQ),
    window: f('window', "scrub: '24h' | '30d' | '18.61y' or a number of days"),
    rates: f(arr('number', 1), 'speed: selectable multiples of real time'),
    default: f('number', 'scrub: initial ms offset within the window; speed: initial rate', REQ),
    epoch: f('epoch', "'now' or an ISO 8601 instant", REQ),
    format: f(en('datetime', 'date', 'time', 'dhm'), 'label format', REQ),
    token: f('token', TOKEN_DOC, REQ),
  },
  drag: {
    name: f('name', 'exposes <name>.x, <name>.y, <name>.dragging (or .lat/.lon on a surface)', REQ),
    default: f('pair', 'initial [x, y] (or [lat, lon])', REQ),
    constrain: f('constrain', "'free' | 'x' | 'y' | 'view' | 'circle:R' | 'segment:[[x,y],[x,y]]' | 'surface:<objectId>'", REQ),
    token: f('token', TOKEN_DOC, REQ),
    hit: f('number', 'hit radius in CSS px (default 22; 30 on coarse pointers)'),
    preview: f(arr('ref:layer'), 'layers shown only while dragging'),
    geolocate: f('boolean', "surface only: 'jump to my location' button"),
  },
  toggle: {
    name: f('name', 'exposes 0 or 1', REQ),
    label: f('labels', '[off label, on label]', REQ),
    default: f('boolean', 'initial state', REQ),
    token: f('token', TOKEN_DOC, REQ),
    position: f(en('corner', 'below'), 'bottom-right corner button or under the canvas (default corner)'),
  },
  segmented: {
    name: f('name', 'exposes the selected value', REQ),
    options: f(arr(obj({ value: f('number', 'value exposed to expressions', REQ), label: f('string', 'button label', REQ) }), 2), 'choices', REQ),
    default: f('number', 'initial value; one of the options', REQ),
    token: f('token', TOKEN_DOC, REQ),
  },
  play: {
    target: f('ref:control', 'slider or time control to advance', REQ),
    rate: f('number', 'target units per second (> 0)', REQ),
    loop: f('boolean', 'wrap at max (default false)'),
    autoplay: f('boolean', 'start playing on approach; never under prefers-reduced-motion (default false)'),
  },
};

SCHEMA.manipulates = {
  controls: f(arr('control'), 'controls mounted under the canvas in this order', REQ),
};

SCHEMA.stateFixed = {
  name: f('id', 'unique state slug; the deep link is #<figure-id>=<name>', REQ),
  caption: f('string', 'sentence shown by the stepper', REQ),
  label: f('string', 'what the stepper prints for the step; defaults to the name with hyphens as spaces'),
  camera: f(obj({ azimuth: f('number', 'radians'), polar: f('number', 'radians'), distance: f('number', 'distance') }), 'scene3d camera pose'),
  drag: f(map('pair'), 'drag control name -> [x, y]'),
  visible: f(obj({ show: f(arr('ref:layer'), 'layer ids to show'), hide: f(arr('ref:layer'), 'layer ids to hide') }), 'visibility overrides'),
};

SCHEMA.notice = {
  steps: f(en('buttons', 'segmented', 'none'), 'show the stepper (a pill of step buttons up to five states, a paddle row above five; both values mean show) or nothing (states stay addressable)', REQ),
  point_at: f(arr('id'), 'layer or 3D object ids the surrounding prose references with data-ref (checked: SPEC_POINT_AT_MISSING)'),
  states: f(arr('state'), 'ordered named states; other keys are <control name>: value', REQ),
};

SCHEMA.figure = {
  shows: f('shows', 'what the figure draws: type, view, constants, layers, readouts', REQ),
  manipulates: f(obj(SCHEMA.manipulates), 'what the reader changes: controls', REQ),
  notice: f(obj(SCHEMA.notice), 'what to notice: states, stepper, point_at', REQ),
};

// ----------------------------------------------------------- basic checks

const ID_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RELPATH_RE = /^(?![a-zA-Z][a-zA-Z0-9+.-]*:)(?!\/)(?!#).+/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;
const WINDOW_RE = /^(\d+(\.\d+)?)([hdy])$/;
const CONSTRAIN_RE = /^(free|x|y|view|circle:(\d+(\.\d+)?)|segment:\[\[-?\d+(\.\d+)?,-?\d+(\.\d+)?\],\[-?\d+(\.\d+)?,-?\d+(\.\d+)?\]\]|surface:[A-Za-z_][A-Za-z0-9_-]*)$/;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const join = (path, key) => (typeof key === 'number' ? `${path}[${key}]` : path ? `${path}.${key}` : key);

export function windowToMs(w) {
  if (isNumber(w)) return w * 86400e3;
  const m = WINDOW_RE.exec(w);
  if (!m) return NaN;
  const n = Number(m[1]);
  return n * { h: 3600e3, d: 86400e3, y: 365.25 * 86400e3 }[m[3]];
}

// Template text: literal text with {expr:fmt} placeholders. Returns the parts.
export function parseTemplate(text) {
  const parts = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open < 0) { parts.push({ text: text.slice(i) }); break; }
    if (open > i) parts.push({ text: text.slice(i, open) });
    const close = text.indexOf('}', open);
    if (close < 0) throw new Error(`unclosed "{" at ${open}`);
    const body = text.slice(open + 1, close);
    // expressions never contain ':', so the first colon separates expr from fmt
    const colon = body.indexOf(':');
    if (colon < 0) throw new Error(`placeholder "{${body}}" needs a format: {expr:fmt}`);
    const src = body.slice(0, colon).trim();
    const fmt = body.slice(colon + 1).trim();
    if (!FORMAT_RE.test(fmt)) throw new Error(`unknown format "${fmt}" in "{${body}}"; one of ${Object.keys(FORMATS).join(' ')}`);
    if (!src) throw new Error(`empty expression in "{${body}}"`);
    parts.push({ src, fmt });
    i = close + 1;
  }
  return parts;
}

// ------------------------------------------------------------- the walker

class Ctx {
  constructor(figureId, palette) {
    this.figureId = figureId;
    this.palette = palette ? new Set(palette) : null;
    this.exprs = [];      // { path, src, ast, scope: 'figure' | 'constants' | 'plot' }
    this.tokens = [];     // { path, token }
    this.refs = [];       // { path, kind, id }
    this.ids = new Map(); // ref namespace: id -> { path, what }
    this.exprScope = 'figure';
    this.plotVar = null;
  }
  fail(code, path, detail) { throw new FigSpecError(code, this.figureId, path, detail); }
}

function checkType(value, type, path, ctx) {
  if (typeof type === 'string') return checkScalar(value, type, path, ctx);
  if (type.enum) {
    if (!type.enum.includes(value)) {
      const code = /(\.kind|\.type|model\.name)$/.test(path) ? 'SPEC_UNKNOWN_KIND' : 'SPEC_BAD_TYPE';
      ctx.fail(code, path, `expected one of ${type.enum.map((v) => JSON.stringify(v)).join(' | ')}, got ${JSON.stringify(value)}`);
    }
    return;
  }
  if (type.array) {
    if (!Array.isArray(value)) ctx.fail('SPEC_BAD_TYPE', path, 'expected an array');
    if (value.length < type.min) ctx.fail('SPEC_RANGE', path, `needs at least ${type.min} element(s)`);
    value.forEach((v, i) => checkType(v, type.array, join(path, i), ctx));
    return;
  }
  if (type.object) return checkObject(value, type.object, path, ctx);
  if (type.map) {
    if (!isPlainObject(value)) ctx.fail('SPEC_BAD_TYPE', path, 'expected an object');
    for (const [k, v] of Object.entries(value)) {
      if (!NAME_RE.test(k)) ctx.fail('SPEC_BAD_TYPE', join(path, k), `key "${k}" is not an identifier`);
      checkType(v, type.map, join(path, k), ctx);
    }
    return;
  }
  ctx.fail('SPEC_BAD_TYPE', path, 'internal: unknown schema type');
}

function checkObject(value, fields, path, ctx) {
  if (!isPlainObject(value)) ctx.fail('SPEC_BAD_TYPE', path, 'expected an object');
  for (const key of Object.keys(value)) {
    if (!Object.prototype.hasOwnProperty.call(fields, key)) {
      ctx.fail('SPEC_UNKNOWN_KEY', join(path, key), `unknown key "${key}"; allowed: ${Object.keys(fields).join(', ')}`);
    }
  }
  for (const [key, field] of Object.entries(fields)) {
    if (!(key in value)) {
      if (field.req) ctx.fail('SPEC_MISSING_KEY', join(path, key), `missing required key "${key}"`);
      continue;
    }
    checkType(value[key], field.type, join(path, key), ctx);
  }
}

function addExpr(value, path, ctx) {
  if (isNumber(value)) return;
  if (typeof value !== 'string') ctx.fail('SPEC_BAD_TYPE', path, 'expected a number or an expression string');
  try {
    const { ast } = compile(value);
    ctx.exprs.push({ path, src: value, ast, scope: ctx.exprScope });
  } catch (e) {
    if (e instanceof ExprError) ctx.fail('SPEC_BAD_EXPR', path, e.message);
    throw e;
  }
}

function checkPoint(value, n, path, ctx) {
  if (!Array.isArray(value) || value.length !== n) ctx.fail('SPEC_BAD_TYPE', path, `expected [${Array(n).fill('expr').join(', ')}]`);
  value.forEach((v, i) => addExpr(v, join(path, i), ctx));
}

function checkNumberTuple(value, n, path, ctx) {
  if (!Array.isArray(value) || value.length !== n || !value.every(isNumber)) {
    ctx.fail('SPEC_BAD_TYPE', path, `expected [${Array(n).fill('number').join(', ')}]`);
  }
}

function checkScalar(value, type, path, ctx) {
  switch (type) {
    case 'number': if (!isNumber(value)) ctx.fail('SPEC_BAD_TYPE', path, 'expected a finite number'); return;
    case 'boolean': if (typeof value !== 'boolean') ctx.fail('SPEC_BAD_TYPE', path, 'expected true or false'); return;
    case 'string': if (typeof value !== 'string') ctx.fail('SPEC_BAD_TYPE', path, 'expected a string'); return;
    case 'expr': return addExpr(value, path, ctx);
    case 'flag': if (typeof value === 'boolean') return; return addExpr(value, path, ctx);
    case 'token':
      if (typeof value !== 'string') ctx.fail('SPEC_BAD_TYPE', path, 'expected a token name');
      ctx.tokens.push({ path, token: value });
      return;
    case 'id':
      if (typeof value !== 'string' || !ID_RE.test(value)) ctx.fail('SPEC_BAD_TYPE', path, `expected an id matching ${ID_RE}`);
      return;
    case 'name':
      if (typeof value !== 'string' || !NAME_RE.test(value)) ctx.fail('SPEC_BAD_TYPE', path, `expected an identifier matching ${NAME_RE}`);
      if (value in FUNCTIONS) ctx.fail('SPEC_DUP_ID', path, `"${value}" is a built-in function name`);
      return;
    case 'point': return checkPoint(value, 2, path, ctx);
    case 'point3': return checkPoint(value, 3, path, ctx);
    case 'rect': return checkPoint(value, 4, path, ctx);
    case 'pair': return checkNumberTuple(value, 2, path, ctx);
    case 'range':
      checkNumberTuple(value, 2, path, ctx);
      if (value[0] >= value[1]) ctx.fail('SPEC_RANGE', path, 'min must be less than max');
      return;
    case 'labels':
      if (!Array.isArray(value) || value.length !== 2 || !value.every((s) => typeof s === 'string')) ctx.fail('SPEC_BAD_TYPE', path, 'expected [off label, on label]');
      return;
    case 'template':
      if (typeof value !== 'string') ctx.fail('SPEC_BAD_TYPE', path, 'expected a template string');
      try {
        for (const part of parseTemplate(value)) if (part.src) addExpr(part.src, path, ctx);
      } catch (e) {
        if (e instanceof FigSpecError) throw e;
        ctx.fail('SPEC_BAD_FORMAT', path, e.message);
      }
      return;
    case 'relpath':
      if (typeof value !== 'string' || !RELPATH_RE.test(value)) ctx.fail('SPEC_BAD_TYPE', path, 'expected a relative path');
      return;
    case 'epoch':
      if (value !== 'now' && !(typeof value === 'string' && ISO_RE.test(value))) ctx.fail('SPEC_BAD_TYPE', path, "expected 'now' or an ISO 8601 instant");
      return;
    case 'window':
      if (!Number.isFinite(windowToMs(value)) || windowToMs(value) <= 0) ctx.fail('SPEC_BAD_TYPE', path, "expected '24h' | '30d' | '18.61y' or a positive number of days");
      return;
    case 'constrain':
      if (typeof value !== 'string' || !CONSTRAIN_RE.test(value)) ctx.fail('SPEC_BAD_TYPE', path, `expected a constraint matching ${CONSTRAIN_RE}`);
      if (value.startsWith('surface:')) ctx.refs.push({ path, kind: 'object', id: value.slice(8) });
      return;
    case 'plane':
      if (value === 'x' || value === 'y' || value === 'z') return;
      return checkNumberTuple(value, 3, path, ctx);
    case 'asset':
      if (typeof value !== 'string') ctx.fail('SPEC_BAD_TYPE', path, 'expected an asset name');
      ctx.refs.push({ path, kind: 'asset', id: value });
      return;
    case 'ref:layer': case 'ref:shape': case 'ref:object': case 'ref:control':
      if (typeof value !== 'string') ctx.fail('SPEC_BAD_TYPE', path, 'expected an id string');
      ctx.refs.push({ path, kind: type.slice(4), id: value });
      return;
    case 'constant':
      if (isNumber(value)) return;
      if (!isPlainObject(value)) ctx.fail('SPEC_BAD_TYPE', path, 'expected a number or {value, expect, tol}');
      return checkObject(value, SCHEMA.constant, path, ctx);
    case 'layer': return checkLayer(value, path, ctx);
    case 'object': return checkObject3d(value, path, ctx);
    case 'control': return checkControl(value, path, ctx);
    case 'state': return checkStateShape(value, path, ctx);
    case 'shows': return checkShows(value, path, ctx, false);
    case 'panelShows': return checkShows(value, path, ctx, true);
    default: ctx.fail('SPEC_BAD_TYPE', path, `internal: unknown scalar type ${type}`);
  }
}

function declareId(ctx, id, path, what) {
  if (ctx.ids.has(id)) ctx.fail('SPEC_DUP_ID', path, `"${id}" already declared as a ${ctx.ids.get(id).what} at ${ctx.ids.get(id).path}`);
  ctx.ids.set(id, { path, what });
}

function discriminated(value, key, table, common, path, ctx, noun) {
  if (!isPlainObject(value)) ctx.fail('SPEC_BAD_TYPE', path, 'expected an object');
  if (!(key in value)) ctx.fail('SPEC_MISSING_KEY', join(path, key), `missing required key "${key}"`);
  const kind = value[key];
  if (!Object.prototype.hasOwnProperty.call(table, kind)) {
    ctx.fail('SPEC_UNKNOWN_KIND', join(path, key), `unknown ${noun} ${JSON.stringify(kind)}; one of ${Object.keys(table).join(' | ')}`);
  }
  checkObject(value, { ...common, ...table[kind] }, path, ctx);
  return kind;
}

function checkLayer(value, path, ctx) {
  const kind = discriminated(value, 'kind', SCHEMA.layers, SCHEMA.layerCommon, path, ctx, 'layer kind');
  declareId(ctx, value.id, join(path, 'id'), `${kind} layer`);
  if (kind === 'region' && !('fill' in value)) ctx.fail('SPEC_MISSING_KEY', join(path, 'fill'), 'a region needs a fill token');
}

function checkObject3d(value, path, ctx) {
  const kind = discriminated(value, 'kind', SCHEMA.objects, SCHEMA.objectCommon, path, ctx, 'object kind');
  declareId(ctx, value.id, join(path, 'id'), `${kind} object`);
  if (kind === 'label') exactlyOne(value, 'anchor', 'position', path, ctx);
}

function exactlyOne(value, a, b, path, ctx) {
  const hasA = a in value, hasB = b in value;
  if (hasA && hasB) ctx.fail('SPEC_CONFLICT', path, `give exactly one of "${a}" / "${b}", not both`);
  if (!hasA && !hasB) ctx.fail('SPEC_MISSING_KEY', path, `give exactly one of "${a}" / "${b}"`);
}

function checkControl(value, path, ctx) {
  const kind = discriminated(value, 'kind', SCHEMA.controls, SCHEMA.controlCommon, path, ctx, 'control kind');
  if (kind !== 'play') declareId(ctx, value.name, join(path, 'name'), `${kind} control`);
  const p = (k) => join(path, k);
  switch (kind) {
    case 'slider':
      if ('values' in value) {
        for (const k of ['min', 'max', 'step']) if (k in value) ctx.fail('SPEC_CONFLICT', p(k), `"${k}" cannot be combined with "values"`);
        if (!value.values.includes(value.default)) ctx.fail('SPEC_RANGE', p('default'), `default ${value.default} is not one of values`);
      } else {
        for (const k of ['min', 'max']) if (!(k in value)) ctx.fail('SPEC_MISSING_KEY', p(k), `missing required key "${k}" (or give values)`);
        if (value.min >= value.max) ctx.fail('SPEC_RANGE', p('min'), 'min must be less than max');
        if (value.default < value.min || value.default > value.max) ctx.fail('SPEC_RANGE', p('default'), `default ${value.default} is outside [${value.min}, ${value.max}]`);
        if ('step' in value && value.step <= 0) ctx.fail('SPEC_RANGE', p('step'), 'step must be > 0');
      }
      break;
    case 'time':
      if (value.mode === 'scrub') {
        if (!('window' in value)) ctx.fail('SPEC_MISSING_KEY', p('window'), 'scrub mode needs "window"');
        if ('rates' in value) ctx.fail('SPEC_CONFLICT', p('rates'), '"rates" belongs to speed mode');
        const ms = windowToMs(value.window);
        if (value.default < 0 || value.default > ms) ctx.fail('SPEC_RANGE', p('default'), `default must be within [0, ${ms}] ms`);
      } else {
        if (!('rates' in value)) ctx.fail('SPEC_MISSING_KEY', p('rates'), 'speed mode needs "rates"');
        if ('window' in value) ctx.fail('SPEC_CONFLICT', p('window'), '"window" belongs to scrub mode');
        if (value.rates.some((r) => r <= 0)) ctx.fail('SPEC_RANGE', p('rates'), 'rates must be > 0');
        if (!value.rates.includes(value.default)) ctx.fail('SPEC_RANGE', p('default'), 'default must be one of rates');
      }
      break;
    case 'segmented': {
      const vals = value.options.map((o) => o.value);
      if (new Set(vals).size !== vals.length) ctx.fail('SPEC_DUP_ID', p('options'), 'option values must be unique');
      if (!vals.includes(value.default)) ctx.fail('SPEC_RANGE', p('default'), 'default must be one of the option values');
      break;
    }
    case 'play':
      if (value.rate <= 0) ctx.fail('SPEC_RANGE', p('rate'), 'rate must be > 0');
      break;
    default: break;
  }
}

// States are checked structurally here (fixed keys) and semantically later,
// once every control is known.
function checkStateShape(value, path, ctx) {
  if (!isPlainObject(value)) ctx.fail('SPEC_BAD_TYPE', path, 'expected an object');
  for (const key of ['name', 'caption']) if (!(key in value)) ctx.fail('SPEC_MISSING_KEY', join(path, key), `missing required key "${key}"`);
  for (const [key, field] of Object.entries(SCHEMA.stateFixed)) if (key in value) checkType(value[key], field.type, join(path, key), ctx);
}

function checkShows(value, path, ctx, isPanel) {
  if (!isPlainObject(value)) ctx.fail('SPEC_BAD_TYPE', path, 'expected an object');
  if (!('type' in value)) ctx.fail('SPEC_MISSING_KEY', join(path, 'type'), 'missing required key "type"');
  const allowed = isPanel ? ['scene2d', 'plot'] : FIGURE_TYPES;
  if (!allowed.includes(value.type)) ctx.fail('SPEC_UNKNOWN_KIND', join(path, 'type'), `unknown figure type ${JSON.stringify(value.type)}; one of ${allowed.join(' | ')}`);
  let fields = SCHEMA.shows[value.type];
  if (isPanel) {
    fields = { ...fields };
    for (const k of ['constants', 'model', 'caveats', 'split']) delete fields[k];
  }
  checkObject(value, fields, path, ctx);
}

// ----------------------------------------------------------- semantic pass

function controlNames(control) {
  switch (control.kind) {
    case 'drag':
      return control.constrain.startsWith('surface:')
        ? [`${control.name}.lat`, `${control.name}.lon`, `${control.name}.dragging`]
        : [`${control.name}.x`, `${control.name}.y`, `${control.name}.dragging`];
    case 'time': return control.mode === 'speed' ? [control.name, `${control.name}.rate`] : [control.name];
    case 'play': return [];
    default: return [control.name];
  }
}

function controlDefaults(control) {
  const d = {};
  switch (control.kind) {
    case 'slider': case 'segmented': d[control.name] = control.default; break;
    case 'toggle': d[control.name] = control.default ? 1 : 0; break;
    case 'time':
      d[control.name] = control.mode === 'scrub' ? control.default : 0;
      if (control.mode === 'speed') d[`${control.name}.rate`] = control.default;
      break;
    case 'drag': {
      const [a, b] = control.default;
      if (control.constrain.startsWith('surface:')) { d[`${control.name}.lat`] = a; d[`${control.name}.lon`] = b; }
      else { d[`${control.name}.x`] = a; d[`${control.name}.y`] = b; }
      d[`${control.name}.dragging`] = 0;
      break;
    }
    default: break;
  }
  return d;
}

function constantValue(c) { return isNumber(c) ? c : c.value; }

function collectShows(shows, out, path = 'shows') {
  // ids of everything in a shows object (including panels) by category
  for (const l of shows.layers || []) out.layers.set(l.id, l);
  for (const o of shows.objects || []) out.objects.set(o.id, o);
  const push = (list, key) => (shows[list] || []).forEach((item, i) => { if (item[key]) out.other.push({ id: item[key], path: `${path}.${list}[${i}].${key}` }); });
  push('series', 'id');
  push('guides', 'id');
  push('bars', 'id');
  push('readouts', 'id');
  (shows.split || []).forEach((p, i) => collectShows(p.shows, out, `${path}.split[${i}].shows`));
}

function plotVars(shows, out = []) {
  if (shows.type === 'plot') out.push(shows.x.var);
  for (const p of shows.split || []) plotVars(p.shows, out);
  return out;
}

function checkSemantics(spec, ctx) {
  const shows = spec.shows;
  const controls = spec.manipulates.controls;
  const constants = shows.constants || {};

  // ref namespace: series/guides/bars/readout ids
  const cat = { layers: new Map(), objects: new Map(), other: [] };
  collectShows(shows, cat);
  for (const { id, path } of cat.other) declareId(ctx, id, path, 'series/guide/bar/readout');
  for (const name of Object.keys(constants)) declareId(ctx, name, `shows.constants.${name}`, 'constant');

  // scope: constants, control names, model outputs, plot variables
  const scope = new Map();
  for (const [name, c] of Object.entries(constants)) scope.set(name, constantValue(c));
  for (const c of controls) for (const [k, v] of Object.entries(controlDefaults(c))) scope.set(k, v);
  if (shows.model) {
    const m = MODELS[shows.model.name];
    const given = Object.keys(shows.model.params);
    for (const p of Object.keys(m.params)) if (!given.includes(p)) ctx.fail('SPEC_MISSING_KEY', `shows.model.params.${p}`, `model ${shows.model.name} needs parameter "${p}"`);
    for (const p of given) if (!(p in m.params)) ctx.fail('SPEC_UNKNOWN_KEY', `shows.model.params.${p}`, `model ${shows.model.name} has no parameter "${p}"; allowed: ${Object.keys(m.params).join(', ')}`);
    for (const [o, sample] of Object.entries(m.outputs)) scope.set(`${shows.model.name}.${o}`, sample);
  }
  const plotScope = new Set(plotVars(shows));

  // exactly-one checks that need the whole object
  for (const [i, r] of (shows.readouts || []).entries()) exactlyOne(r, 'anchor', 'at', `shows.readouts[${i}]`, ctx);
  for (const [i, g] of (shows.guides || []).entries()) exactlyOne(g, 'x', 'y', `shows.guides[${i}]`, ctx);

  // tokens
  if (ctx.palette) {
    for (const { path, token } of ctx.tokens) {
      if (!ctx.palette.has(token)) ctx.fail('SPEC_BAD_TOKEN', path, `token "${token}" is not in the palette (${[...ctx.palette].join(', ') || 'empty'})`);
    }
  }

  // references
  const controlByName = new Map(controls.filter((c) => c.kind !== 'play').map((c) => [c.name, c]));
  const assets = shows.assets || {};
  for (const { path, kind, id } of ctx.refs) {
    let ok;
    switch (kind) {
      case 'layer': ok = cat.layers.has(id); break;
      case 'shape': ok = cat.layers.has(id) && ['circle', 'ellipse', 'polygon'].includes(cat.layers.get(id).kind); break;
      case 'object': ok = cat.objects.has(id); break;
      case 'control': ok = controlByName.has(id) && ['slider', 'time'].includes(controlByName.get(id).kind); break;
      case 'asset': ok = Object.prototype.hasOwnProperty.call(assets, id); break;
      default: ok = false;
    }
    if (!ok) ctx.fail('SPEC_UNKNOWN_REF', path, `no ${kind === 'shape' ? 'circle/ellipse/polygon layer' : kind === 'control' ? 'slider/time control' : kind} with id "${id}"`);
  }

  // expressions: constants' expect see only constants; series y also see the plot variable
  const constScope = new Map(Object.entries(constants).map(([k, c]) => [k, constantValue(c)]));
  for (const ex of ctx.exprs) {
    const inConstants = ex.path.startsWith('shows.constants.');
    const inSeries = /\.series\[\d+\]\.y$/.test(ex.path);
    for (const n of identifiers(ex.ast)) {
      const known = inConstants ? constScope.has(n) : scope.has(n) || (n in CONSTANTS) || (inSeries && plotScope.has(n));
      if (!known) {
        const hint = inConstants ? ' (expect expressions may only use constants)' : plotScope.has(n) ? ' (plot variables are visible only to series.y)' : '';
        ctx.fail('SPEC_UNKNOWN_IDENT', ex.path, `unknown identifier "${n}"${hint}`);
      }
    }
  }
  for (const [name, c] of Object.entries(constants)) {
    if (isNumber(c)) continue;
    const path = `shows.constants.${name}.expect`;
    let got;
    try { got = evaluate(compile(c.expect).ast, constScope, c.expect); } catch (e) { ctx.fail('SPEC_BAD_EXPR', path, e.message); }
    if (Math.abs(got - c.value) > c.tol) ctx.fail('SPEC_EXPECT_MISMATCH', path, `value ${c.value} differs from expect = ${got} by more than tol ${c.tol}`);
  }

  // notice
  const notice = spec.notice;
  if (notice.steps !== 'none' && notice.states.length === 0) ctx.fail('SPEC_RANGE', 'notice.states', `steps "${notice.steps}" needs at least one state`);
  for (const id of notice.point_at || []) if (!cat.layers.has(id) && !cat.objects.has(id)) ctx.fail('SPEC_POINT_AT_MISSING', 'notice.point_at', `no layer or object with id "${id}"`);
  const seen = new Set();
  notice.states.forEach((st, i) => {
    const path = `notice.states[${i}]`;
    if (seen.has(st.name)) ctx.fail('SPEC_DUP_ID', `${path}.name`, `state "${st.name}" declared twice`);
    seen.add(st.name);
    if (st.camera && shows.type !== 'scene3d') ctx.fail('SPEC_CONFLICT', `${path}.camera`, 'camera applies to scene3d figures only');
    for (const [k, v] of Object.entries(st)) {
      if (k in SCHEMA.stateFixed) continue;
      const c = controlByName.get(k);
      if (!c) ctx.fail('SPEC_STATE_UNKNOWN_CONTROL', `${path}.${k}`, `"${k}" is not a control of this figure (drag positions go under "drag")`);
      checkStateValue(c, v, `${path}.${k}`, ctx);
    }
    for (const k of Object.keys(st.drag || {})) {
      const c = controlByName.get(k);
      if (!c || c.kind !== 'drag') ctx.fail('SPEC_STATE_UNKNOWN_CONTROL', `${path}.drag.${k}`, `"${k}" is not a drag control of this figure`);
    }
  });

  return { scope, cat, controlByName };
}

function checkStateValue(c, v, path, ctx) {
  switch (c.kind) {
    case 'slider':
      if (!isNumber(v)) ctx.fail('SPEC_BAD_TYPE', path, 'expected a number');
      if ('values' in c ? !c.values.includes(v) : v < c.min || v > c.max) ctx.fail('SPEC_STATE_OUT_OF_RANGE', path, `${v} is outside the range of slider "${c.name}"`);
      return;
    case 'time':
      if (!isNumber(v)) ctx.fail('SPEC_BAD_TYPE', path, 'expected a number');
      if (c.mode === 'scrub' ? v < 0 || v > windowToMs(c.window) : !c.rates.includes(v)) ctx.fail('SPEC_STATE_OUT_OF_RANGE', path, `${v} is outside the window/rates of time control "${c.name}"`);
      return;
    case 'toggle':
      if (typeof v !== 'boolean') ctx.fail('SPEC_BAD_TYPE', path, 'expected true or false');
      return;
    case 'segmented':
      if (!c.options.some((o) => o.value === v)) ctx.fail('SPEC_STATE_OUT_OF_RANGE', path, `${JSON.stringify(v)} is not an option of "${c.name}"`);
      return;
    case 'drag':
      ctx.fail('SPEC_STATE_UNKNOWN_CONTROL', path, `drag positions go under "drag": {"${c.name}": [x, y]}`);
      return;
    default: return;
  }
}

// ------------------------------------------------------------- public API

/**
 * validateSpec(spec, { figureId, palette }) -> compiled figure.
 * Throws FigSpecError { code, figureId, path, message } on the first violation.
 * palette: iterable of token names; when omitted, tokens are not checked.
 */
export function validateSpec(spec, { figureId = '(figure)', palette } = {}) {
  const ctx = new Ctx(figureId, palette);
  checkObject(spec, SCHEMA.figure, '', ctx);
  const { scope, cat, controlByName } = checkSemantics(spec, ctx);
  return {
    figureId,
    type: spec.shows.type,
    spec,
    defaults: scope,
    expressions: ctx.exprs,
    layerIds: [...cat.layers.keys()],
    objectIds: [...cat.objects.keys()],
    refIds: [...ctx.ids.keys()],
    controls: [...controlByName.values()],
    exposedNames: spec.manipulates.controls.flatMap(controlNames),
    states: spec.notice.states.map((s) => s.name),
    plotVars: plotVars(spec.shows),
  };
}

// Scope for a named state (or the defaults when state is null), plus overrides.
export function scopeForState(compiled, stateName = null, overrides = {}) {
  const scope = new Map(compiled.defaults);
  if (stateName !== null) {
    const st = compiled.spec.notice.states.find((s) => s.name === stateName);
    if (!st) throw new FigSpecError('SPEC_UNKNOWN_REF', compiled.figureId, 'notice.states', `no state "${stateName}"`);
    for (const [k, v] of Object.entries(st)) {
      if (k in SCHEMA.stateFixed) continue;
      scope.set(k, typeof v === 'boolean' ? (v ? 1 : 0) : v);
    }
    for (const [k, [a, b]] of Object.entries(st.drag || {})) {
      const c = compiled.controls.find((x) => x.name === k);
      const surface = c && c.constrain.startsWith('surface:');
      scope.set(`${k}.${surface ? 'lat' : 'x'}`, a);
      scope.set(`${k}.${surface ? 'lon' : 'y'}`, b);
    }
  }
  for (const [k, v] of Object.entries(overrides)) scope.set(k, v);
  return scope;
}

// Evaluate every expression of a compiled figure in the given scope. Plot
// series expressions are sampled at the axis ends and midpoint. Throws
// FigSpecError SPEC_NOT_FINITE naming the expression path.
export function evaluateAll(compiled, scope) {
  const results = new Map();
  for (const ex of compiled.expressions) {
    if (ex.path.startsWith('shows.constants.')) continue;
    const free = identifiers(ex.ast).filter((n) => compiled.plotVars.includes(n) && !scope.has(n));
    const samples = free.length ? plotSamples(compiled, free[0]) : [null];
    for (const sample of samples) {
      const s = sample === null ? scope : new Map([...scope, [free[0], sample]]);
      try {
        results.set(ex.path, evaluate(ex.ast, s, ex.src));
      } catch (e) {
        if (e instanceof ExprError) throw new FigSpecError('SPEC_NOT_FINITE', compiled.figureId, ex.path, e.message);
        throw e;
      }
    }
  }
  return results;
}

function plotSamples(compiled, varName) {
  const find = (shows) => {
    if (shows.type === 'plot' && shows.x.var === varName) return shows.x;
    for (const p of shows.split || []) { const r = find(p.shows); if (r) return r; }
    return null;
  };
  const axis = find(compiled.spec.shows);
  return [axis.min, (axis.min + axis.max) / 2, axis.max];
}

// ------------------------------------------------------------------ docs

function typeText(type) {
  if (typeof type === 'string') {
    return {
      number: 'number', boolean: 'boolean', string: 'string',
      expr: 'number or expression', flag: 'boolean or expression',
      token: 'token', id: 'id', name: 'identifier',
      point: '[expr, expr]', point3: '[expr, expr, expr]', rect: '[expr, expr, expr, expr]',
      pair: '[number, number]', range: '[number, number]', labels: '[string, string]',
      template: 'template', relpath: 'relative path', epoch: "'now' or ISO 8601", window: 'window', constrain: 'constraint',
      plane: "'x' | 'y' | 'z' or [n, n, n]", asset: 'asset name',
      'ref:layer': 'layer id', 'ref:shape': 'circle/ellipse/polygon id', 'ref:object': 'object id', 'ref:control': 'slider/time name',
      layer: 'layer (see Layers)', object: 'object (see 3D objects)', control: 'control (see Controls)',
      state: 'state (see States)', shows: 'shows (see Figure types)', panelShows: 'scene2d or plot shows',
    }[type] || type;
  }
  if (type.enum) return type.enum.map((v) => `\`${v}\``).join(' \\| ');
  if (type.array) return `array of ${typeText(type.array)}${type.min ? ` (min ${type.min})` : ''}`;
  if (type.object) return 'object (below)';
  if (type.map) return `map of identifier -> ${typeText(type.map)}`;
  return '?';
}

function table(fields) {
  const rows = ['| key | type | required | meaning |', '|---|---|---|---|'];
  for (const [k, fld] of Object.entries(fields)) rows.push(`| \`${k}\` | ${typeText(fld.type)} | ${fld.req ? 'yes' : ''} | ${fld.doc} |`);
  return rows.join('\n');
}

function section(depth, title, body) { return `${'#'.repeat(depth)} ${title}\n\n${body}\n`; }

// Markdown for every key and kind, generated from the same tables the
// validator walks. DESIGN.md embeds this verbatim (see tools/gen-docs.mjs).
export function describeVocabulary() {
  const out = [];
  out.push(section(3, 'Figure (top level)', table(SCHEMA.figure)));
  out.push(section(3, 'Figure types (`shows`)', `Figure types: ${FIGURE_TYPES.map((t) => `\`${t}\``).join(', ')}. Every \`shows\` object has \`type\`.`));
  for (const t of FIGURE_TYPES) out.push(section(4, `shows: ${t}`, table(SCHEMA.shows[t])));
  out.push(section(4, 'view', table(SCHEMA.view)));
  out.push(section(4, 'constants', `A constant is a number, or an object for a derived number:\n\n${table(SCHEMA.constant)}`));
  out.push(section(4, 'model', `${table(SCHEMA.model)}\n\n${modelsTable()}`));
  out.push(section(4, 'caveats', table(SCHEMA.caveats)));
  out.push(section(4, 'readouts[]', table(SCHEMA.readout)));
  out.push(section(4, 'split[] panels', table(SCHEMA.panel)));
  out.push(section(4, 'plot: x, y, series[], marker, guides[]', [table(SCHEMA.plotAxisX), table(SCHEMA.plotAxisY), table(SCHEMA.series), table(SCHEMA.marker), table(SCHEMA.guide)].join('\n\n')));
  out.push(section(4, 'timeline: x, bars[]', [table(SCHEMA.timelineAxis), table(SCHEMA.bar)].join('\n\n')));
  out.push(section(4, 'scene3d: camera, light, fallback', [table(SCHEMA.camera), table(SCHEMA.light), table(SCHEMA.fallback)].join('\n\n')));
  out.push(section(3, 'Layers (scene2d `layers[]`)', `Layer kinds: ${LAYER_KINDS.map((k) => `\`${k}\``).join(', ')}.\n\nKeys common to every layer:\n\n${table(SCHEMA.layerCommon)}`));
  for (const k of LAYER_KINDS) out.push(section(4, `layer: ${k}`, table(SCHEMA.layers[k])));
  out.push(section(3, '3D objects (scene3d `objects[]`)', `Object kinds: ${OBJECT_KINDS.map((k) => `\`${k}\``).join(', ')}.\n\nKeys common to every object:\n\n${table(SCHEMA.objectCommon)}`));
  for (const k of OBJECT_KINDS) out.push(section(4, `object: ${k}`, table(SCHEMA.objects[k])));
  out.push(section(4, 'cut / explode', [table(SCHEMA.cut), table(SCHEMA.explode)].join('\n\n')));
  out.push(section(3, 'Controls (`manipulates.controls[]`)', `Control kinds: ${CONTROL_KINDS.map((k) => `\`${k}\``).join(', ')}. Every control has \`kind\`. Names join the expression scope as listed.`));
  for (const k of CONTROL_KINDS) out.push(section(4, `control: ${k}`, table(SCHEMA.controls[k])));
  out.push(section(3, 'Notice (`notice`)', table(SCHEMA.notice)));
  out.push(section(4, 'States (`notice.states[]`)', `Fixed keys:\n\n${table(SCHEMA.stateFixed)}\n\nEvery other key is a control name with a value in that control's range (slider/time: number; toggle: boolean; segmented: an option value). Drag positions go under \`drag\`.`));
  out.push(section(3, 'Formats (in `{expr:fmt}` placeholders)', ['| format | meaning |', '|---|---|', ...Object.entries(FORMATS).map(([k, v]) => `| \`${k}\` | ${v} |`)].join('\n')));
  return out.join('\n');
}

function modelsTable() {
  const rows = ['| model | parameters (expressions) | outputs (`<model>.<name>`) | meaning |', '|---|---|---|---|'];
  for (const [name, m] of Object.entries(MODELS)) {
    rows.push(`| \`${name}\` | ${Object.entries(m.params).map(([k, d]) => `\`${k}\` ${d}`).join('; ')} | ${Object.keys(m.outputs).map((o) => `\`${o}\``).join(', ')} | ${m.doc} |`);
  }
  return rows.join('\n');
}
