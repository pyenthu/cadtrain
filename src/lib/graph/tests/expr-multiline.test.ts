// Multi-line list-output bodies (#11 readability) — named helper lines +
// a `return`. Verifies the dense spiral one-liner and the broken-down
// multi-line form compile to the SAME points, and that `return`/blocks validate.
import { describe, it, expect } from 'vitest';
import { compileListFormula, parseAndValidateBare } from '$lib/graph/expr/graph-exprs';

const tau = 2 * Math.PI;
function evalList(js: string, vars: Record<string, number>): [number, number][] {
  const names = ['cos', 'sin', 'tau', ...Object.keys(vars)];
  const vals = [Math.cos, Math.sin, tau, ...Object.values(vars)];
  // eslint-disable-next-line no-new-func
  return new Function(...names, `return (${js});`)(...vals);
}

const ONE_LINER =
  'concat(' +
  'map(range(0, NPts), f(i) = [ (r0 + growth*i/NPts)*cos(i*turns*tau/NPts), (r0 + growth*i/NPts)*sin(i*turns*tau/NPts) ]), ' +
  'map(range(0, NPts), f(j) = [ (r0 + growth*(NPts-1-j)/NPts - width)*cos((NPts-1-j)*turns*tau/NPts), (r0 + growth*(NPts-1-j)/NPts - width)*sin((NPts-1-j)*turns*tau/NPts) ])' +
  ')';

const MULTILINE = [
  'outer(i) = [(r0 + growth*i/NPts)*cos(i*turns*tau/NPts), (r0 + growth*i/NPts)*sin(i*turns*tau/NPts)]',
  'inner(j) = [(r0 + growth*(NPts-1-j)/NPts - width)*cos((NPts-1-j)*turns*tau/NPts), (r0 + growth*(NPts-1-j)/NPts - width)*sin((NPts-1-j)*turns*tau/NPts)]',
  'return concat(map(range(0, NPts), outer), map(range(0, NPts), inner))',
].join('\n');

const VARS = { NPts: 36, r0: 0.4, growth: 1, turns: 2, width: 0.2 };

describe('multi-line list expression bodies (named helpers + return)', () => {
  it('compiles the multi-line spiral and evals to the SAME points as the one-liner', () => {
    const a = compileListFormula(ONE_LINER);
    const b = compileListFormula(MULTILINE);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    const pa = evalList(a.js, VARS);
    const pb = evalList(b.js, VARS);
    expect(pb.length).toBe(2 * VARS.NPts);
    expect(pb.length).toBe(pa.length);
    // every point matches (the broken-down form is the same geometry)
    for (let i = 0; i < pa.length; i++) {
      expect(pb[i]![0]).toBeCloseTo(pa[i]![0], 10);
      expect(pb[i]![1]).toBeCloseTo(pa[i]![1], 10);
    }
  });

  it('validates the multi-line body as a list (block + return + helpers all OK)', () => {
    const allowed = new Set(['NPts', 'r0', 'growth', 'turns', 'width']);
    expect(parseAndValidateBare(MULTILINE, allowed, 'list').errors).toEqual([]);
  });

  it('strips a leading `return ` on a single-line body too', () => {
    const r = compileListFormula('return map(range(0, 3), f(i) = [i, 0])');
    expect(r.ok).toBe(true);
    if (r.ok) expect(evalList(r.js, {}).length).toBe(3);
  });

  it('a bare intermediate value line works (name = expr; …; return)', () => {
    const body = ['n = NPts', 'return map(range(0, n), f(i) = [i, 0])'].join('\n');
    const r = compileListFormula(body);
    expect(r.ok).toBe(true);
    if (r.ok) expect(evalList(r.js, { NPts: 5 }).length).toBe(5);
  });
});
