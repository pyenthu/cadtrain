// Imperative loop model (#11 accumulator style) — parse/serialize/compile, and
// proof the imperative spiral evals to the SAME points as the functional map form.
import { describe, it, expect } from 'vitest';
import { parseImperative, serializeImperative, compileImperative, isImperative } from './expr-imperative';
import { compileListFormula } from './graph-exprs';

const tau = 2 * Math.PI;
function evalList(js: string, vars: Record<string, number>): [number, number][] {
  const names = ['cos', 'sin', 'tau', ...Object.keys(vars)];
  const vals = [Math.cos, Math.sin, tau, ...Object.values(vars)];
  // eslint-disable-next-line no-new-func
  return new Function(...names, `return (${js});`)(...vals);
}

const IMP_SPIRAL = [
  'poly = []',
  'for i = 0 to NPts',
  '  point = [(r0 + growth*i/NPts)*cos(i*turns*tau/NPts), (r0 + growth*i/NPts)*sin(i*turns*tau/NPts)]',
  '  poly.append(point)',
  'for j = 0 to NPts',
  '  point = [(r0 + growth*(NPts-1-j)/NPts - width)*cos((NPts-1-j)*turns*tau/NPts), (r0 + growth*(NPts-1-j)/NPts - width)*sin((NPts-1-j)*turns*tau/NPts)]',
  '  poly.append(point)',
  'return poly',
].join('\n');

const FUNC_SPIRAL =
  'concat(' +
  'map(range(0, NPts), f(i) = [(r0 + growth*i/NPts)*cos(i*turns*tau/NPts), (r0 + growth*i/NPts)*sin(i*turns*tau/NPts)]), ' +
  'map(range(0, NPts), f(j) = [(r0 + growth*(NPts-1-j)/NPts - width)*cos((NPts-1-j)*turns*tau/NPts), (r0 + growth*(NPts-1-j)/NPts - width)*sin((NPts-1-j)*turns*tau/NPts)]))';

const VARS = { NPts: 36, r0: 0.4, growth: 1, turns: 2, width: 0.2 };

describe('imperative loop model', () => {
  it('parses the accumulator spiral: 1 list, 2 loops, assign+append statements', () => {
    const p = parseImperative(IMP_SPIRAL)!;
    expect(p).not.toBeNull();
    expect(p.accumulators).toEqual(['poly']);
    expect(p.result).toBe('poly');
    expect(p.loops).toHaveLength(2);
    expect(p.loops[0]).toMatchObject({ loopVar: 'i', start: '0', stop: 'NPts' });
    expect(p.loops[0]!.statements[0]).toMatchObject({ kind: 'assign', name: 'point' });
    expect(p.loops[0]!.statements[1]).toMatchObject({ kind: 'append', list: 'poly', expr: 'point' });
  });

  it('compiles + evals to the SAME points as the functional map form', () => {
    const imp = compileImperative(IMP_SPIRAL);
    const fun = compileListFormula(FUNC_SPIRAL);
    expect(imp.ok).toBe(true);
    expect(fun.ok).toBe(true);
    if (!imp.ok || !fun.ok) return;
    const pi = evalList(imp.js, VARS);
    const pf = evalList(fun.js, VARS);
    expect(pi.length).toBe(2 * VARS.NPts);
    expect(pi.length).toBe(pf.length);
    for (let k = 0; k < pf.length; k++) {
      expect(pi[k]![0]).toBeCloseTo(pf[k]![0], 10);
      expect(pi[k]![1]).toBeCloseTo(pf[k]![1], 10);
    }
  });

  it('round-trips: serialize(parse(x)) parses back to the same structure', () => {
    const a = parseImperative(IMP_SPIRAL)!;
    const b = parseImperative(serializeImperative(a))!;
    expect(b.accumulators).toEqual(a.accumulators);
    expect(b.loops.map((l) => [l.loopVar, l.start, l.stop])).toEqual(a.loops.map((l) => [l.loopVar, l.start, l.stop]));
    expect(b.loops[0]!.statements).toEqual(a.loops[0]!.statements);
  });

  it('isImperative distinguishes the two styles', () => {
    expect(isImperative(IMP_SPIRAL)).toBe(true);
    expect(isImperative(FUNC_SPIRAL)).toBe(false);
    expect(isImperative('map(range(0,8), f(i)=[i,0])')).toBe(false);
  });

  it('a single loop appending a literal works (no intermediate var)', () => {
    const src = ['poly = []', 'for i = 0 to 5', '  poly.append([i, 0])', 'return poly'].join('\n');
    const r = compileImperative(src);
    expect(r.ok).toBe(true);
    if (r.ok) expect(evalList(r.js, {}).length).toBe(5);
  });

  it('returns null for non-imperative input', () => {
    expect(parseImperative('[1,2,3]')).toBeNull();
    expect(parseImperative('poly = []\nreturn poly')).toBeNull(); // no loop
  });
});
