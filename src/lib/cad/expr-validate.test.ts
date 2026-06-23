/**
 * expr-validate.test.ts — PR-2 of the expression builder (B.6 / id 914).
 *
 * The static-validation allowlist walk: unknown input, disallowed function,
 * arity, assignment, and injection attempts are all rejected; legitimate CAD
 * math passes clean.
 */
import { describe, expect, it } from 'vitest';
import { parseExpr, validateExpr, buildExprSchema, parseAndValidate } from './graph-exprs';

const schema = buildExprSchema(['od', 'id', 'len'], ['wall', 'gap']);

/** Helper: validate a source string, return error messages (parse failure
 *  surfaces as a single error). */
function errs(src: string): string[] {
  return parseAndValidate(src, schema).errors.map((e) => e.msg);
}

describe('expr-validate — valid expressions pass clean', () => {
  it.each([
    '(p.od - p.id) / 2',
    'max((p.od - p.id) / 2, 0)',
    'clamp(p.len, 0, 100)',
    'e.wall + e.gap',
    'sqrt(p.od ^ 2 + p.id ^ 2)',
    'hypot(p.od, p.id, p.len)',
    'sin(p.len) * pi',
    'p.od > p.id ? p.od : p.id',
    'log(p.od)',
    'log(p.od, 2)',
  ])('%s ⇒ no errors', (src) => {
    expect(errs(src)).toEqual([]);
  });
});

describe('expr-validate — unknown input rejected', () => {
  it('flags an undeclared param', () => {
    expect(errs('p.bogus + 1').join()).toMatch(/unknown input: p\.bogus/);
  });
  it('flags an undeclared expr', () => {
    expect(errs('e.nope * 2').join()).toMatch(/unknown input: e\.nope/);
  });
  it('flags a bare unknown symbol', () => {
    expect(errs('foo + 1').join()).toMatch(/unknown input: foo/);
  });
  it('flags a bare namespace root used as a value', () => {
    expect(errs('p + 1').join()).toMatch(/unknown input: p/);
  });
});

describe('expr-validate — disallowed function rejected', () => {
  it('flags a function outside the allowlist', () => {
    expect(errs('random(p.od)').join()).toMatch(/disallowed function: random/);
  });
  it('flags a member-call (e.g. host method) as a disallowed call', () => {
    const m = errs('p.od.toString()').join();
    expect(m).toMatch(/disallowed call|unknown input/);
  });
});

describe('expr-validate — arity enforced', () => {
  it('rejects clamp with the wrong number of args', () => {
    expect(errs('clamp(p.od, 0)').join()).toMatch(/clamp expects 3/);
  });
  it('rejects a unary fn given two args', () => {
    expect(errs('sqrt(p.od, p.id)').join()).toMatch(/sqrt expects 1/);
  });
  it('rejects atan2 with one arg', () => {
    expect(errs('atan2(p.od)').join()).toMatch(/atan2 expects 2/);
  });
  it('accepts variadic min/max with 2+ args', () => {
    expect(errs('min(p.od, p.id, p.len)')).toEqual([]);
  });
});

describe('expr-validate — assignment rejected', () => {
  it('rejects an object assignment (=)', () => {
    // mathjs parses `x = 3` as an AssignmentNode; the safe-node gate rejects it.
    const e = errs('x = 3');
    expect(e.length).toBeGreaterThan(0);
    expect(e.join()).toMatch(/unsupported syntax|unknown input/);
  });
  it('rejects a function declaration (f(x) = ...)', () => {
    const e = errs('f(x) = x ^ 2');
    expect(e.length).toBeGreaterThan(0);
  });
});

describe('expr-validate — injection attempts rejected', () => {
  it('rejects host-global member access', () => {
    expect(errs('process.exit(1)').length).toBeGreaterThan(0);
  });
  it('rejects a block / sequence (side effects)', () => {
    // mathjs `a; b` is a BlockNode — not in SAFE_NODE_TYPES.
    const e = errs('1; 2');
    expect(e.length).toBeGreaterThan(0);
  });
  it('rejects constructor / prototype reach', () => {
    expect(errs('p.od.constructor').length).toBeGreaterThan(0);
  });
  it('rejects bracket index access outside the namespaces', () => {
    const e = errs('p["od"]');
    // either flagged as unknown input or unsupported syntax — never clean
    expect(e.length).toBeGreaterThan(0);
  });
});

describe('expr-validate — gate is the empty-list invariant', () => {
  it('a parse failure yields a non-empty error list (never throws)', () => {
    const r = parseExpr('(p.od + ');
    expect(r.ok).toBe(false);
    expect(errs('(p.od + ').length).toBeGreaterThan(0);
  });
});
