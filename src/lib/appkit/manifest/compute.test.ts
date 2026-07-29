import { describe, it, expect } from 'vitest';
import { evalExpr, evalComputed } from './compute';

describe('evalExpr', () => {
  it('arithmetic + precedence', () => {
    expect(evalExpr('1 + 2 * 3')).toBe(7);
    expect(evalExpr('(1 + 2) * 3')).toBe(9);
    expect(evalExpr('2 ** 3 ** 2')).toBe(512); // right-assoc
    expect(evalExpr('-5 + 3')).toBe(-2);
    expect(evalExpr('7 % 3')).toBe(1);
  });

  it('scope lookup incl. dotted + .length', () => {
    expect(evalExpr('a + b', { a: 10, b: 5 })).toBe(15);
    expect(evalExpr('well.depth * 2', { well: { depth: 100 } })).toBe(200);
    expect(evalExpr('rows.length', { rows: [1, 2, 3] })).toBe(3);
    expect(evalExpr('missing', {})).toBeUndefined();
  });

  it('comparisons, logic, ternary', () => {
    expect(evalExpr('3 > 2')).toBe(true);
    expect(evalExpr('a == b', { a: 1, b: 1 })).toBe(true);
    expect(evalExpr('a > 0 && b > 0', { a: 1, b: 2 })).toBe(true);
    expect(evalExpr('n > 0 ? "pos" : "neg"', { n: -1 })).toBe('neg');
  });

  it('functions incl. array/variadic', () => {
    expect(evalExpr('max(3, 7, 2)')).toBe(7);
    expect(evalExpr('sum(rows)', { rows: [1, 2, 3, 4] })).toBe(10);
    expect(evalExpr('round(3.14159, 2)')).toBe(3.14);
    expect(evalExpr('avg(xs)', { xs: [2, 4] })).toBe(3);
  });

  it('string concat', () => {
    expect(evalExpr('"n=" + n', { n: 5 })).toBe('n=5');
  });

  it('returns undefined on garbage (never throws)', () => {
    expect(evalExpr('1 +')).toBeUndefined();
    expect(evalExpr('foo(')).toBeUndefined();
    expect(evalExpr(')(')).toBeUndefined();
  });
});

describe('evalComputed', () => {
  it('declaration order — later vars see earlier ones', () => {
    const vars = evalComputed(
      { area: '= w * h', label: '= "area=" + area' },
      { w: 4, h: 5 },
    );
    expect(vars.area).toBe(20);
    expect(vars.label).toBe('area=20');
  });

  it('strips the leading = and tolerates empties', () => {
    expect(evalComputed({ x: '=2+2' }).x).toBe(4);
    expect(evalComputed({ x: '' }).x).toBeUndefined();
    expect(evalComputed(undefined)).toEqual({});
  });
});
