// lib/scene2d/getters.js — numbers and expression strings become functions
// of the scope, compiled once at mount.
import { compile, evaluate } from '../expr.js';

export function getter(v) {
  if (typeof v === 'number') return () => v;
  if (typeof v === 'boolean') return () => (v ? 1 : 0);
  const { ast } = compile(v);
  return (scope) => evaluate(ast, scope, v);
}

export function pointGetter(p) {
  const gx = getter(p[0]), gy = getter(p[1]);
  return (scope) => [gx(scope), gy(scope)];
}
