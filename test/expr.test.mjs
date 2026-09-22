import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, parse, tokenize, evaluate, evaluateSource, identifiers, describeFunctions, ExprError, FUNCTIONS, CONSTANTS } from '../lib/expr.js';

const ev = (src, scope = {}) => evaluateSource(src, scope);
const fails = (src, code, scope = {}) => {
  assert.throws(() => evaluateSource(src, scope), (e) => e instanceof ExprError && e.code === code && typeof e.pos === 'number', `${src} should fail with ${code}`);
};

test('numbers: integers, decimals, leading dot, exponent', () => {
  assert.equal(ev('42'), 42);
  assert.equal(ev('3.5'), 3.5);
  assert.equal(ev('.5'), 0.5);
  assert.equal(ev('2.'), 2);
  assert.equal(ev('1e3'), 1000);
  assert.equal(ev('2.5E-1'), 0.25);
});

test('binary operators and precedence: ^ over * / % over + -', () => {
  assert.equal(ev('1+2*3'), 7);
  assert.equal(ev('(1+2)*3'), 9);
  assert.equal(ev('2*3^2'), 18);
  assert.equal(ev('10-4-3'), 3, 'subtraction is left-associative');
  assert.equal(ev('24/4/2'), 3, 'division is left-associative');
  assert.equal(ev('7 % 3'), 1);
  assert.equal(ev('-7 % 3'), -1, '% keeps JS remainder semantics; use wrap() for floored modulo');
});

test('^ and ** are the same right-associative operator', () => {
  assert.equal(ev('2^3^2'), 512);
  assert.equal(ev('2**3**2'), 512);
  assert.equal(ev('2^10'), 1024);
  assert.equal(ev('2 ** 0.5'), Math.SQRT2);
});

test('unary minus binds tighter than ^ (Excel convention): -2^2 = 4', () => {
  assert.equal(ev('-2^2'), 4);
  assert.equal(ev('-(2^2)'), -4);
  assert.equal(ev('2^-3'), 0.125);
  assert.equal(ev('--3'), 3);
  assert.equal(ev('-x', { x: 5 }), -5);
  assert.equal(ev('3 - -2'), 5);
});

test('identifiers: names, underscores, digits, dotted names', () => {
  assert.equal(ev('T_sid', { T_sid: 27.3 }), 27.3);
  assert.equal(ev('p.x + p.y', { 'p.x': 1, 'p.y': 2 }), 3);
  assert.equal(ev('kepler.x * 2', { 'kepler.x': 0.5 }), 1);
  assert.equal(ev('_a1', { _a1: 9 }), 9);
  assert.equal(ev('flag', { flag: true }), 1, 'booleans read as 0/1');
  assert.equal(ev('flag', new Map([['flag', false]])), 0, 'Map scopes work');
});

test('constants pi, tau, e, and shadowing by a declared name', () => {
  assert.equal(ev('pi'), Math.PI);
  assert.equal(ev('tau'), 2 * Math.PI);
  assert.equal(ev('e'), Math.E);
  assert.equal(ev('e', { e: 0.0167 }), 0.0167, 'a control named e (eccentricity) wins over Euler');
  assert.deepEqual(Object.keys(CONSTANTS).sort(), ['e', 'pi', 'tau']);
});

test('every function in the closed list is callable with the right arity', () => {
  const expected = ['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'sqrt', 'abs', 'min', 'max', 'clamp', 'wrap', 'floor', 'ceil', 'round', 'pow', 'exp', 'log', 'sign', 'lerp', 'smoothstep', 'deg', 'rad', 'hypot'];
  assert.deepEqual(Object.keys(FUNCTIONS).sort(), expected.sort());
  assert.equal(ev('sin(0)'), 0);
  assert.equal(ev('cos(0)'), 1);
  assert.equal(ev('tan(0)'), 0);
  assert.equal(ev('asin(1)'), Math.PI / 2);
  assert.equal(ev('acos(1)'), 0);
  assert.equal(ev('atan(1)'), Math.PI / 4);
  assert.equal(ev('atan2(1, 1)'), Math.PI / 4);
  assert.equal(ev('sqrt(16)'), 4);
  assert.equal(ev('abs(-3)'), 3);
  assert.equal(ev('min(3, 1, 2)'), 1);
  assert.equal(ev('max(3, 1, 2)'), 3);
  assert.equal(ev('clamp(5, 0, 1)'), 1);
  assert.equal(ev('clamp(-5, 0, 1)'), 0);
  assert.ok(Math.abs(ev('wrap(-1)') - (2 * Math.PI - 1)) < 1e-12, 'wrap(x) into [0, tau)');
  assert.equal(ev('wrap(5, 2, 4)'), 3, 'wrap(x, lo, hi) into [lo, hi)');
  assert.equal(ev('wrap(4, 2, 4)'), 2);
  assert.equal(ev('floor(1.7)'), 1);
  assert.equal(ev('ceil(1.2)'), 2);
  assert.equal(ev('round(2.5)'), 3);
  assert.equal(ev('pow(2, 8)'), 256);
  assert.equal(ev('exp(0)'), 1);
  assert.equal(ev('log(e)'), 1);
  assert.equal(ev('sign(-2)'), -1);
  assert.equal(ev('lerp(0, 10, 0.25)'), 2.5);
  assert.equal(ev('smoothstep(0, 1, 0.5)'), 0.5);
  assert.equal(ev('smoothstep(0, 1, 2)'), 1);
  assert.equal(ev('smoothstep(0, 1, -1)'), 0);
  assert.equal(ev('deg(pi)'), 180);
  assert.equal(ev('rad(180)'), Math.PI);
  assert.equal(ev('hypot(3, 4)'), 5);
});

test('function errors: unknown function, wrong arity', () => {
  fails('foo(1)', 'EXPR_UNKNOWN_FUNC');
  fails('Math.sin(1)', 'EXPR_UNKNOWN_FUNC');
  fails('sin(1, 2)', 'EXPR_ARITY');
  fails('atan2(1)', 'EXPR_ARITY');
  fails('min(1)', 'EXPR_ARITY');
  fails('clamp(1, 2)', 'EXPR_ARITY');
  fails('wrap(1, 2)', 'EXPR_ARITY');
  fails('sin()', 'EXPR_ARITY');
});

test('syntax errors carry a position', () => {
  for (const src of ['1 +', '(1 + 2', '1 + 2)', '1 2', '* 2', 'a ? b : c', '1 < 2', '1 == 1', 'x = 2', '"str"', 'a.', 'a..b', '2 +* 3', 'sin 1', '&']) {
    assert.throws(() => parse(src), (e) => e instanceof ExprError && e.code === 'EXPR_SYNTAX' && Number.isInteger(e.pos), `${src} should be a syntax error`);
  }
  try { parse('1 + $'); } catch (e) { assert.equal(e.pos, 4); }
});

test('evaluation errors: unknown identifier, non-finite, bad value', () => {
  fails('T_sidd', 'EXPR_UNKNOWN_IDENT', { T_sid: 1 });
  fails('1/0', 'EXPR_NOT_FINITE');
  fails('sqrt(-1)', 'EXPR_NOT_FINITE');
  fails('log(0)', 'EXPR_NOT_FINITE');
  fails('asin(2)', 'EXPR_NOT_FINITE');
  fails('0/0', 'EXPR_NOT_FINITE');
  fails('10^400', 'EXPR_NOT_FINITE');
  fails('x', 'EXPR_NOT_FINITE', { x: NaN });
  fails('x', 'EXPR_BAD_VALUE', { x: 'str' });
  try { ev('1 + R/(t-t)', { R: 1, t: 2 }); } catch (e) { assert.equal(e.pos, 5, 'position points at the failing operator'); }
});

test('identifiers(): free names, sorted, constants excluded unless asked', () => {
  const { ast, identifiers: ids } = compile('R*cos(tau*t/T_sid) + p.x - pi');
  assert.deepEqual(ids, ['R', 'T_sid', 'p.x', 't']);
  assert.deepEqual(identifiers(ast, { includeConstants: true }), ['R', 'T_sid', 'p.x', 'pi', 't', 'tau']);
  assert.deepEqual(compile('e').identifiers, [], 'e alone is the constant');
  assert.deepEqual(compile('42').identifiers, []);
});

test('tokenize() produces typed tokens and an eof', () => {
  const toks = tokenize('a.b + 2**x');
  assert.deepEqual(toks.map((t) => t.type), ['id', 'op', 'num', 'op', 'id', 'eof']);
  assert.equal(toks[3].value, '^', '** is normalized to ^');
  assert.throws(() => tokenize(42), ExprError);
});

test('evaluate() reuses a compiled ast', () => {
  const { ast } = compile('R*cos(tau*t/T)');
  assert.equal(evaluate(ast, { R: 3, t: 0, T: 27 }), 3);
  assert.ok(Math.abs(evaluate(ast, { R: 3, t: 13.5, T: 27 }) + 3) < 1e-12);
});

test('describeFunctions() lists every function and constant', () => {
  const md = describeFunctions();
  for (const name of Object.keys(FUNCTIONS)) assert.match(md, new RegExp(`\\| \`${name}\` \\|`));
  for (const name of Object.keys(CONSTANTS)) assert.match(md, new RegExp(`\\| \`${name}\` \\|`));
});
