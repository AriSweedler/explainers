// lib/poster-svg.js under Node: fig-months at the defaults and at a state,
// the Path2D-to-SVG recorder, plot / timeline / scene3d posters, regions,
// and the well-formedness of the markup (balanced tags, quoted attributes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSpec, scopeForState } from '../lib/spec.js';
import { posterSvg, posterSize, SvgPath, POSTER_WIDTH } from '../lib/poster-svg.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NBSP = '\u00a0';
const TOKENS = new Map([
  ['sun', 'light-dark(#b8651a, #f2a144)'], ['moon', 'light-dark(#5d5d63, #b8b8c0)'], ['earth', 'light-dark(#2f6fb0, #6fa8e6)'],
  ['star', 'light-dark(#6f6320, #d8c860)'], ['muted', 'light-dark(#7a756e, #8a857e)'],
  ['--bg', 'light-dark(#faf8f5, #151412)'], ['--fg', 'light-dark(#1d1c1a, #e8e4dc)'],
]);

function figMonths() {
  const html = fs.readFileSync(path.join(root, 'test/fixtures/pass/fig-months.html'), 'utf8');
  const m = /<script type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  return validateSpec(JSON.parse(m[1]), { figureId: 'fig-months', palette: [...TOKENS.keys()].filter((k) => !k.startsWith('--')) });
}

// Balanced, properly nested tags with double-quoted attributes and no stray
// angle brackets in text. Returns the element count.
function wellFormed(svg) {
  const stack = [];
  let count = 0, last = 0;
  const re = /<(\/?)([A-Za-z][\w:-]*)((?:\s+[\w:-]+="[^"<>]*")*)\s*(\/?)>/g;
  for (const m of svg.matchAll(re)) {
    assert.doesNotMatch(svg.slice(last, m.index), /[<>]/, `stray angle bracket before ${m[0].slice(0, 30)}`);
    last = m.index + m[0].length;
    if (m[1]) assert.equal(stack.pop(), m[2], `closing </${m[2]}>`);
    else { count++; if (!m[4]) stack.push(m[2]); }
  }
  assert.equal(last, svg.length, 'the markup ends with the root end tag');
  assert.deepEqual(stack, [], 'every tag is closed');
  return count;
}

const minimal = (shows, controls = [], states = []) => validateSpec({ shows, manipulates: { controls }, notice: { steps: states.length ? 'buttons' : 'none', states } }, { figureId: 'fig-t' });

test('fig-months at the defaults: well-formed SVG with the expected elements, token colors as var() with fallbacks', () => {
  const c = figMonths();
  const svg = posterSvg(c, null, { aspect: '3:2', tokens: TOKENS, id: 'fig-months', hash: 'abc' });
  assert.match(svg, /^<svg class="x-poster" id="fig-months-poster" xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 704 469" width="704" height="469" aria-hidden="true" data-poster="abc">/);
  // svg, style, defs, clipPath, path, g, panel rect, panel g; orbit, earth, earth label, star line, star label,
  // sun line, its head, sun label, moon; three readouts (trail and elongation arcs are empty at t=0)
  assert.equal(wellFormed(svg), 20);
  assert.equal((svg.match(/<text /g) || []).length, 6, 'three labels and three readouts');
  assert.match(svg, /#fig-months-poster:root\{color-scheme:light dark\}/, 'the scheme is declared only for a standalone (external) poster');
  assert.match(svg, /#fig-months-poster \.s-sun\{stroke:var\(--c-sun, light-dark\(#b8651a, #f2a144\)\)\}/);
  assert.match(svg, /#fig-months-poster \.f-panel\{fill:var\(--x-panel, light-dark\(/);
  assert.match(svg, /\.h\{paint-order:stroke;stroke:var\(--bg, light-dark\(#faf8f5, #151412\)\)/, 'text halos use the page background');
  assert.match(svg, /stroke-dasharray="4 4"/, 'the orbit dash');
  assert.match(svg, /stroke-dasharray="2 6"/, 'the star line dash');
  for (const t of ['>Earth<', '>to a distant star<', '>to the Sun<', '>day 0.0<', `>0${NBSP}d 0${NBSP}h 0${NBSP}m<`, '>Moon–Sun angle: 0°<']) assert.ok(svg.includes(t), t);
  assert.match(svg, /Z" class="f-sun"\/>/, 'the arrowhead is a filled triangle in the sun token');
  assert.match(svg, /<g fill="none" stroke-linecap="round" stroke-linejoin="round">/);
  assert.doesNotMatch(svg, /NaN|undefined|currentColor/);
  assert.ok(svg.length < 8 * 1024, `fig-months stays inline (${svg.length} bytes)`);
});

test('fig-months at a state and with a toggle off: the frame follows the scope', () => {
  const c = figMonths();
  const defaults = posterSvg(c, null, { tokens: TOKENS, id: 'fig-months' });
  const sidereal = posterSvg(c, 'sidereal', { tokens: TOKENS, id: 'fig-months' });
  assert.notEqual(sidereal, defaults);
  assert.match(sidereal, />day 27\.3</, 'the readout follows t');
  assert.ok(sidereal.split('<path').length > defaults.split('<path').length, 'the trail arc is drawn once t > 0');
  const sunOff = posterSvg(c, new Map([...scopeForState(c, null), ['showSun', 0]]), { tokens: TOKENS, id: 'fig-months' });
  assert.doesNotMatch(sunOff, /s-sun|>to the Sun<|Moon–Sun angle/, 'hidden layers and readouts leave no trace, not even a color rule');
  assert.ok(wellFormed(sunOff) < wellFormed(defaults));
  assert.equal(posterSvg(c.spec, null, { tokens: TOKENS, id: 'fig-months' }), defaults, 'a raw spec is validated and drawn the same');
});

test('SvgPath records Path2D calls as path data with canvas arc semantics', () => {
  const full = new SvgPath();
  full.arc(10, 10, 5, 0, Math.PI * 2);
  assert.equal(full.d, 'M15 10A5 5 0 1 1 5 10A5 5 0 1 1 15 10', 'a full turn is two half arcs back to the start');
  const quarter = new SvgPath();
  quarter.arc(0, 0, 10, 0, Math.PI / 2);
  assert.equal(quarter.d, 'M10 0A10 10 0 0 1 0 10', 'clockwise (canvas default) sweeps toward +y');
  const ccw = new SvgPath();
  ccw.arc(0, 0, 10, 0, -Math.PI / 2, true);
  assert.equal(ccw.d, 'M10 0A10 10 0 0 0 0 -10');
  const wrapped = new SvgPath();
  wrapped.arc(0, 0, 10, 0, Math.PI * 1.5, true); // ccw from 0 to 270°: a quarter turn the short way
  assert.equal(wrapped.d, 'M10 0A10 10 0 0 0 0 -10');
  const r = new SvgPath();
  r.rect(1, 2, 3, 4);
  r.moveTo(0, 0); r.lineTo(1, 1); r.closePath();
  assert.equal(r.d, 'M1 2h3v4h-3ZM0 0L1 1Z');
  const e = new SvgPath();
  e.ellipse(0, 0, 4, 2, Math.PI / 2, 0, Math.PI * 2);
  assert.match(e.d, /^M0 4A4 2 90 1 1 0 -4A4 2 90 1 1 0 4$/, 'rotation goes to the x-axis-rotation in degrees');
});

test('plot posters draw axes, gridlines, tick labels, guides, the series and the marker', () => {
  const c = minimal(
    { type: 'plot', x: { var: 'x', min: 0, max: 10, label: 'time', unit: 's' }, y: { min: 0, max: 100, label: 'distance', unit: 'm' }, series: [{ id: 'sq', y: 'k*x*x', token: 'ink', samples: 50 }], guides: [{ id: 'half', y: 50, token: 'mark', label: 'halfway' }], marker: { x: 'm', token: 'mark' } },
    [{ kind: 'slider', name: 'k', label: 'k', min: 0, max: 2, default: 1, token: 'ink' }, { kind: 'slider', name: 'm', label: 'm', min: 0, max: 10, default: 5, token: 'mark' }],
  );
  const svg = posterSvg(c, null, { aspect: '2:1', tokens: new Map([['ink', '#00f'], ['mark', '#f00']]), id: 'fig-t' });
  wellFormed(svg);
  assert.match(svg, /viewBox="0 0 704 352"/);
  for (const t of ['>time (s)<', '>distance (m)<', 'rotate(-90)', '>halfway<', '>0<', '>10<', '>100<']) assert.ok(svg.includes(t), t);
  const series = /<path d="(M[^"]+)" class="s-ink" stroke-width="2"\/>/.exec(svg);
  assert.ok(series, 'the series polyline in the series token');
  assert.equal((series[1].match(/L/g) || []).length, 50, 'samples points');
  assert.match(svg, /<circle [^>]*class="s-bg f-ink"/, 'a marker dot on the series at m');
  assert.match(svg, /stroke-dasharray="3 3"/, 'the marker line');
  assert.match(svg, /stroke-opacity="\.1"/, 'gridlines');
});

test('timeline posters draw one bar per row with its label and the marker', () => {
  const c = minimal(
    { type: 'timeline', x: { min: 0, max: 30, label: 'days' }, bars: [{ id: 'a', from: 0, to: 't', label: 'clock A', token: 'ink' }, { id: 'b', from: 5, to: 20, label: 'clock B', token: 'mark' }], marker: { x: 't', token: 'mark' } },
    [{ kind: 'slider', name: 't', label: 't', min: 0, max: 30, default: 12, token: 'ink' }],
  );
  const svg = posterSvg(c, null, { tokens: { ink: '#00f', mark: '#f00' }, id: 'fig-t' });
  wellFormed(svg);
  assert.match(svg, />clock A<[\s\S]*>clock B</);
  assert.match(svg, />days</);
  assert.equal((svg.match(/class="f-ink"|class="f-mark"/g) || []).length, 2, 'two bars');
  assert.match(svg, /stroke-dasharray="3 3"/, 'the marker line');
});

test('scene3d posters are a framed box with the caption; regions nest clip paths', () => {
  const c3 = minimal({
    type: 'scene3d', camera: { mode: 'orbit', distance: 3, azimuth: 0, polar: 1 }, light: { direction: [1, 1, 1], ambient: 0.3 },
    objects: [{ id: 'ball', kind: 'sphere', radius: 1, material: 'lambert' }], fallback: { poster: 'assets/ball.png', notice: 'needs WebGL2' },
  });
  const svg3 = posterSvg(c3, null, { aspect: '16:9', id: 'fig-t', caption: 'A lit sphere you can orbit. Not to scale.' });
  wellFormed(svg3);
  assert.match(svg3, /viewBox="0 0 704 396"/);
  assert.match(svg3, /<text [^>]*text-anchor="middle"[^>]*>A lit sphere you can orbit\. Not to scale\.<\/text>/);
  assert.doesNotMatch(svg3, /clipPath/);
  const c2 = minimal({
    type: 'scene2d', view: { x: [-2, 2], y: [-2, 2] },
    layers: [
      { id: 'a', kind: 'circle', cx: -0.5, cy: 0, r: 1, stroke: 'ink' },
      { id: 'b', kind: 'circle', cx: 0.5, cy: 0, r: 1, stroke: 'ink' },
      { id: 'lens', kind: 'region', of: ['a', 'b'], op: 'intersect', fill: 'mark' },
      { id: 'moon', kind: 'region', of: ['a', 'b'], op: 'subtract', fill: 'ink' },
      { id: 'pic', kind: 'image', src: 'assets/x.png', rect: [1, 1, 0.5, 0.5] },
      { id: 'rows', kind: 'bars', y: -1.5, height: 0.2, rows: [{ label: 'row', from: -1, to: 1, token: 'mark' }] },
    ],
  });
  const svg2 = posterSvg(c2, null, { aspect: '1:1', tokens: { ink: '#00f', mark: '#f00' }, id: 'fig-t' });
  wellFormed(svg2);
  assert.equal((svg2.match(/<clipPath /g) || []).length, 5, 'the panel clip, two for the intersection, two for the subtraction');
  assert.equal((svg2.match(/clip-rule="evenodd"/g) || []).length, 1, 'subtract removes the second shape');
  assert.match(svg2, /stroke-dasharray="4 4" stroke-opacity="\.35"/, 'an image is a dashed placeholder rectangle');
  assert.match(svg2, />row</);
});

test('posterSize follows data-aspect at the column width', () => {
  assert.deepEqual(posterSize('3:2'), { width: POSTER_WIDTH, height: 469 });
  assert.deepEqual(posterSize('16:9'), { width: 704, height: 396 });
  assert.deepEqual(posterSize('1:1'), { width: 704, height: 704 });
  assert.deepEqual(posterSize(undefined), { width: 704, height: 469 });
});
