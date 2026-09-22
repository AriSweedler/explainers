// lib/core/format.js — the Formats table of lib/spec.js, rendered.
// format(value, fmt, opts) and templates ("day {t:.1f}") for readouts, text
// layers, slider <output>s and 3D labels. Pure: usable from Node tests.
import { compile, evaluate } from '../expr.js';
import { parseTemplate } from '../spec.js';

export const MINUS = '−';
const NBSP = ' ';
const SUPER = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
const KM_PER_MI = 1.609344;

const realMinus = (s) => s.replace(/-/g, MINUS);
const intFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

function dhm(days) {
  const total = Math.round(Math.abs(days) * 1440);
  const d = Math.floor(total / 1440), h = Math.floor((total % 1440) / 60), m = total % 60;
  return `${days < 0 ? MINUS : ''}${d}${NBSP}d ${h}${NBSP}h ${m}${NBSP}m`;
}

function hms(hours) {
  const total = Math.round(Math.abs(hours) * 3600);
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  return `${hours < 0 ? MINUS : ''}${h}${NBSP}h ${m}${NBSP}m ${s}${NBSP}s`;
}

const DATE_OPTS = {
  date: { year: 'numeric', month: 'short', day: 'numeric' },
  time: { hour: '2-digit', minute: '2-digit' },
  datetime: { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' },
};

function dateLike(ms, kind, { locale = 'en-US', timeZone } = {}) {
  return new Intl.DateTimeFormat(locale, { ...DATE_OPTS[kind], timeZone }).format(new Date(ms));
}

function sci(v) {
  if (v === 0) return '0';
  const [mant, exp] = v.toExponential(2).split('e');
  const sup = [...String(Number(exp))].map((c) => SUPER[c]).join('');
  return `${realMinus(mant)}×10${sup}`;
}

// The value carries the unit named by the format; body.x-imperial flips it.
function unitLength(v, unit, imperial) {
  let shown = unit, value = v;
  if (imperial) {
    shown = unit === 'km' ? 'mi' : 'km';
    value = unit === 'km' ? v / KM_PER_MI : v * KM_PER_MI;
  }
  const num = Math.abs(value) >= 100 ? intFmt.format(Math.round(value)) : value.toFixed(1);
  return `${realMinus(num)}${NBSP}${shown}`;
}

export function format(value, fmt, opts = {}) {
  const v = typeof value === 'boolean' ? (value ? 1 : 0) : Number(value);
  if (!Number.isFinite(v)) return '—';
  const fixed = /^\.(\d)f$/.exec(fmt);
  if (fixed) return realMinus(v.toFixed(Number(fixed[1])));
  switch (fmt) {
    case ',d': return realMinus(intFmt.format(Math.round(v)));
    case 'deg': return `${realMinus(v.toFixed(1))}°`;
    case 'dhm': return dhm(v);
    case 'hms': return hms(v);
    case 'date': case 'time': case 'datetime': return dateLike(v, fmt, opts);
    case 'sci': return sci(v);
    case 'unit:km': return unitLength(v, 'km', opts.imperial);
    case 'unit:mi': return unitLength(v, 'mi', opts.imperial);
    default: throw new Error(`unknown format "${fmt}"`);
  }
}

// Template -> parts with compiled expressions: [{ text } | { src, fmt, ast }].
export function compileTemplate(text) {
  return parseTemplate(text).map((p) => (p.src ? { ...p, ast: compile(p.src).ast } : p));
}

export function renderTemplate(parts, scope, opts) {
  let out = '';
  for (const p of parts) out += p.src ? format(evaluate(p.ast, scope, p.src), p.fmt, opts) : p.text;
  return out;
}

// Sorted identifiers a compiled template depends on (for cheap dirty checks).
export function templateIdentifiers(parts) {
  const names = new Set();
  for (const p of parts) if (p.src) for (const n of compile(p.src).identifiers) names.add(n);
  return [...names].sort();
}
