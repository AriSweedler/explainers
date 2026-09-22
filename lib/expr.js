// lib/expr.js — the closed expression grammar shared by the browser runtime
// and the Node validator. Plain ES2020, no dependencies.
//
// Grammar (see DESIGN.md "Expression grammar"):
//   expr     := sum
//   sum      := product (('+' | '-') product)*
//   product  := power (('*' | '/' | '%') power)*
//   power    := unary (('^' | '**') power)?          right-associative
//   unary    := '-' unary | primary                  binds tighter than ^
//   primary  := number | ident | ident '(' args ')' | '(' expr ')'
//   ident    := name ('.' name)*                     e.g. p.x, t, T_sid
//
// Radians only. No strings, no comparisons, no conditionals, no assignment.

export class ExprError extends Error {
  constructor(code, message, pos, src) {
    super(`${message} (at ${pos} in "${src}")`);
    this.name = 'ExprError';
    this.code = code;
    this.pos = pos;
    this.src = src;
  }
}

export const CONSTANTS = Object.freeze({
  pi: Math.PI,
  tau: 2 * Math.PI,
  e: Math.E,
});

const TAU = 2 * Math.PI;

function wrapRange(x, lo, hi) {
  const span = hi - lo;
  return x - span * Math.floor((x - lo) / span);
}

// name -> { arity, doc, fn }. arity is a number, [min, max] (max may be
// Infinity), or { oneOf: [n, m] }.
export const FUNCTIONS = Object.freeze({
  sin: { arity: 1, doc: 'sine (radians)', fn: Math.sin },
  cos: { arity: 1, doc: 'cosine (radians)', fn: Math.cos },
  tan: { arity: 1, doc: 'tangent (radians)', fn: Math.tan },
  asin: { arity: 1, doc: 'arcsine; |x| <= 1 or non-finite', fn: Math.asin },
  acos: { arity: 1, doc: 'arccosine; |x| <= 1 or non-finite', fn: Math.acos },
  atan: { arity: 1, doc: 'arctangent', fn: Math.atan },
  atan2: { arity: 2, doc: 'atan2(y, x): angle of (x, y) in (-pi, pi]', fn: Math.atan2 },
  sqrt: { arity: 1, doc: 'square root; x < 0 is non-finite', fn: Math.sqrt },
  abs: { arity: 1, doc: 'absolute value', fn: Math.abs },
  min: { arity: [2, Infinity], doc: 'smallest argument', fn: Math.min },
  max: { arity: [2, Infinity], doc: 'largest argument', fn: Math.max },
  clamp: { arity: 3, doc: 'clamp(x, lo, hi)', fn: (x, lo, hi) => Math.min(Math.max(x, lo), hi) },
  wrap: {
    arity: { oneOf: [1, 3] },
    doc: 'wrap(x) into [0, tau); wrap(x, lo, hi) into [lo, hi)',
    fn: (x, lo, hi) => (lo === undefined ? wrapRange(x, 0, TAU) : wrapRange(x, lo, hi)),
  },
  floor: { arity: 1, doc: 'round down', fn: Math.floor },
  ceil: { arity: 1, doc: 'round up', fn: Math.ceil },
  round: { arity: 1, doc: 'round half up', fn: Math.round },
  pow: { arity: 2, doc: 'pow(a, b) = a ^ b', fn: Math.pow },
  exp: { arity: 1, doc: 'e ^ x', fn: Math.exp },
  log: { arity: 1, doc: 'natural logarithm; x <= 0 is non-finite', fn: Math.log },
  sign: { arity: 1, doc: '-1, 0 or 1', fn: Math.sign },
  lerp: { arity: 3, doc: 'lerp(a, b, t) = a + (b - a) * t', fn: (a, b, t) => a + (b - a) * t },
  smoothstep: {
    arity: 3,
    doc: 'smoothstep(e0, e1, x): 0 below e0, 1 above e1, cubic ease between',
    fn: (e0, e1, x) => {
      const k = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
      return k * k * (3 - 2 * k);
    },
  },
  deg: { arity: 1, doc: 'radians -> degrees', fn: (x) => (x * 180) / Math.PI },
  rad: { arity: 1, doc: 'degrees -> radians', fn: (x) => (x * Math.PI) / 180 },
  hypot: { arity: [2, Infinity], doc: 'sqrt(a^2 + b^2 + ...)', fn: Math.hypot },
});

// ---------------------------------------------------------------- tokenizer

const NUMBER_RE = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/;

export function tokenize(src) {
  if (typeof src !== 'string') throw new ExprError('EXPR_SYNTAX', 'expression must be a string', 0, String(src));
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue; }
    const rest = src.slice(i);
    let m;
    if ((m = NUMBER_RE.exec(rest))) {
      tokens.push({ type: 'num', value: Number(m[0]), pos: i });
      i += m[0].length;
    } else if ((m = IDENT_RE.exec(rest))) {
      tokens.push({ type: 'id', value: m[0], pos: i });
      i += m[0].length;
    } else if (rest.startsWith('**')) {
      tokens.push({ type: 'op', value: '^', pos: i });
      i += 2;
    } else if ('+-*/%^(),'.includes(ch)) {
      tokens.push({ type: 'op', value: ch, pos: i });
      i += 1;
    } else {
      throw new ExprError('EXPR_SYNTAX', `unexpected character "${ch}"`, i, src);
    }
  }
  tokens.push({ type: 'eof', value: '', pos: src.length });
  return tokens;
}

// ------------------------------------------------------------------- parser

function arityOk(arity, n) {
  if (typeof arity === 'number') return n === arity;
  if (arity.oneOf) return arity.oneOf.includes(n);
  return n >= arity[0] && n <= arity[1];
}

function arityText(arity) {
  if (typeof arity === 'number') return String(arity);
  if (arity.oneOf) return arity.oneOf.join(' or ');
  return arity[1] === Infinity ? `${arity[0]} or more` : `${arity[0]} to ${arity[1]}`;
}

export function parse(src) {
  const tokens = tokenize(src);
  let k = 0;
  const peek = () => tokens[k];
  const next = () => tokens[k++];
  const isOp = (v) => peek().type === 'op' && peek().value === v;
  const fail = (msg, pos) => { throw new ExprError('EXPR_SYNTAX', msg, pos ?? peek().pos, src); };

  function parseSum() {
    let left = parseProduct();
    while (isOp('+') || isOp('-')) {
      const op = next();
      left = { type: 'bin', op: op.value, left, right: parseProduct(), pos: op.pos };
    }
    return left;
  }

  function parseProduct() {
    let left = parsePower();
    while (isOp('*') || isOp('/') || isOp('%')) {
      const op = next();
      left = { type: 'bin', op: op.value, left, right: parsePower(), pos: op.pos };
    }
    return left;
  }

  function parsePower() {
    const base = parseUnary();
    if (isOp('^')) {
      const op = next();
      return { type: 'bin', op: '^', left: base, right: parsePower(), pos: op.pos };
    }
    return base;
  }

  function parseUnary() {
    if (isOp('-')) {
      const op = next();
      return { type: 'neg', arg: parseUnary(), pos: op.pos };
    }
    return parsePrimary();
  }

  function parsePrimary() {
    const tok = peek();
    if (tok.type === 'num') { next(); return { type: 'num', value: tok.value, pos: tok.pos }; }
    if (tok.type === 'id') {
      next();
      if (isOp('(')) return parseCall(tok);
      return { type: 'id', name: tok.value, pos: tok.pos };
    }
    if (isOp('(')) {
      next();
      const inner = parseSum();
      if (!isOp(')')) fail('expected ")"');
      next();
      return inner;
    }
    if (tok.type === 'eof') fail('unexpected end of expression');
    return fail(`unexpected "${tok.value}"`);
  }

  function parseCall(nameTok) {
    next(); // '('
    const spec = FUNCTIONS[nameTok.value];
    if (!spec) throw new ExprError('EXPR_UNKNOWN_FUNC', `unknown function "${nameTok.value}"`, nameTok.pos, src);
    const args = [];
    if (!isOp(')')) {
      args.push(parseSum());
      while (isOp(',')) { next(); args.push(parseSum()); }
    }
    if (!isOp(')')) fail('expected ")" or "," in argument list');
    next();
    if (!arityOk(spec.arity, args.length)) {
      throw new ExprError('EXPR_ARITY',
        `${nameTok.value} takes ${arityText(spec.arity)} argument(s), got ${args.length}`, nameTok.pos, src);
    }
    return { type: 'call', name: nameTok.value, args, pos: nameTok.pos };
  }

  const ast = parseSum();
  if (peek().type !== 'eof') fail(`unexpected "${peek().value}"`);
  return ast;
}

// ----------------------------------------------------------- static analysis

// Free identifiers of an AST, sorted and unique. Built-in constants are
// included only if you ask, because a declared control may shadow them
// (an eccentricity slider named "e" is legitimate).
export function identifiers(ast, { includeConstants = false } = {}) {
  const out = new Set();
  (function walk(n) {
    switch (n.type) {
      case 'id': if (includeConstants || !(n.name in CONSTANTS)) out.add(n.name); break;
      case 'neg': walk(n.arg); break;
      case 'bin': walk(n.left); walk(n.right); break;
      case 'call': n.args.forEach(walk); break;
      default: break;
    }
  })(ast);
  return [...out].sort();
}

export function compile(src) {
  const ast = parse(src);
  return { src, ast, identifiers: identifiers(ast) };
}

// ---------------------------------------------------------------- evaluator

function lookup(scope, name) {
  if (scope instanceof Map) return scope.has(name) ? scope.get(name) : undefined;
  if (scope && Object.prototype.hasOwnProperty.call(scope, name)) return scope[name];
  return undefined;
}

// scope: Map or plain object of name -> number (booleans are accepted as 0/1).
// Throws ExprError on an unknown identifier or a non-finite intermediate
// result, with the position of the offending sub-expression.
export function evaluate(ast, scope = {}, src = '') {
  function num(v, node) {
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v !== 'number') {
      throw new ExprError('EXPR_BAD_VALUE', `value for "${node.name}" is not a number`, node.pos, src);
    }
    return v;
  }
  function finite(v, node, what) {
    if (!Number.isFinite(v)) throw new ExprError('EXPR_NOT_FINITE', `${what} is not finite`, node.pos, src);
    return v;
  }
  function ev(n) {
    switch (n.type) {
      case 'num': return n.value;
      case 'id': {
        let v = lookup(scope, n.name);
        if (v === undefined) {
          if (n.name in CONSTANTS) return CONSTANTS[n.name];
          throw new ExprError('EXPR_UNKNOWN_IDENT', `unknown identifier "${n.name}"`, n.pos, src);
        }
        return finite(num(v, n), n, `"${n.name}"`);
      }
      case 'neg': return -ev(n.arg);
      case 'bin': {
        const a = ev(n.left), b = ev(n.right);
        let r;
        switch (n.op) {
          case '+': r = a + b; break;
          case '-': r = a - b; break;
          case '*': r = a * b; break;
          case '/': r = a / b; break;
          case '%': r = a % b; break;
          case '^': r = a ** b; break;
          default: throw new ExprError('EXPR_SYNTAX', `bad operator ${n.op}`, n.pos, src);
        }
        return finite(r, n, `"${n.op}"`);
      }
      case 'call': {
        const args = n.args.map(ev);
        return finite(FUNCTIONS[n.name].fn(...args), n, `${n.name}(...)`);
      }
      default: throw new ExprError('EXPR_SYNTAX', `bad node ${n.type}`, n.pos ?? 0, src);
    }
  }
  return ev(ast);
}

// Convenience: parse + evaluate in one call.
export function evaluateSource(src, scope) {
  return evaluate(parse(src), scope, src);
}

// ---------------------------------------------------------------- docs

export function describeFunctions() {
  const lines = ['| function | arity | meaning |', '|---|---|---|'];
  for (const [name, f] of Object.entries(FUNCTIONS)) lines.push(`| \`${name}\` | ${arityText(f.arity)} | ${f.doc} |`);
  lines.push('', '| constant | value |', '|---|---|');
  for (const [name, v] of Object.entries(CONSTANTS)) lines.push(`| \`${name}\` | ${v} |`);
  return lines.join('\n');
}
