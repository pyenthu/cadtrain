// Imperative loop model (#11 accumulator style) — parse/serialize/compile, and
// proof the imperative spiral evals to the SAME points as the functional map form.
import { describe, it, expect } from 'vitest';
import { parseImperative, serializeImperative, serializeStatements, compileImperative, validateImperative, isImperative, bodyStatements, splitStatements, importLiteralPointList, type ImpIf, type ImperativeProgram } from '../expr-imperative';
import { compileListFormula } from '../graph-exprs';

const tau = 2 * Math.PI;
function evalList(js: string, vars: Record<string, number>): [number, number][] {
  const names = ['cos', 'sin', 'tau', ...Object.keys(vars)];
  const vals = [Math.cos, Math.sin, tau, ...Object.values(vars)];
  // eslint-disable-next-line no-new-func
  return new Function(...names, `return (${js});`)(...vals);
}
// grid bodies emit 3-element points
function evalGrid(js: string, vars: Record<string, number>): number[][] {
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
    const st0 = bodyStatements(p.loops[0]!.body);
    expect(st0[0]).toMatchObject({ kind: 'assign', name: 'point' });
    expect(st0[1]).toMatchObject({ kind: 'append', list: 'poly', expr: 'point' });
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
    expect(bodyStatements(b.loops[0]!.body)).toEqual(bodyStatements(a.loops[0]!.body));
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

  it('splitStatements: newline at depth 0 splits, inside brackets joins, ; separates', () => {
    expect(splitStatements('a = 1\nb = 2')).toEqual(['a = 1', 'b = 2']);
    expect(splitStatements('f([1,\n2,\n3])')).toEqual(['f([1, 2, 3])']);
    expect(splitStatements('a=1; b=2')).toEqual(['a=1', 'b=2']);
  });

  it('parses a WRAPPED multi-line append as ONE statement (the reported bug)', () => {
    const body = 'poly.append([(r0 + growth*i/NPts) * cos(a),\n (r0 + growth*i/NPts) * sin(a)])';
    const st = bodyStatements(body);
    expect(st).toHaveLength(1);
    expect(st[0]).toMatchObject({ kind: 'append', list: 'poly' });
  });

  it('temp-var split body → assigns + an append, and compiles to the right point count', () => {
    const body = 'r = r0 + growth*i/NPts\na = i*turns*tau/NPts\npoly.append([r*cos(a), r*sin(a)])';
    const st = bodyStatements(body);
    expect(st.map((s) => s.kind)).toEqual(['assign', 'assign', 'append']);
    const src = ['poly = []', 'for i = 0 to 8', ...body.split('\n').map((l) => '  ' + l), 'return poly'].join('\n');
    const r = compileImperative(src);
    expect(r.ok).toBe(true);
    if (r.ok) expect(evalList(r.js, { r0: 0.4, growth: 1, turns: 2, NPts: 8 }).length).toBe(8);
  });

  it('returns null for non-imperative input', () => {
    expect(parseImperative('[1,2,3]')).toBeNull();
    expect(parseImperative('poly = []\nreturn poly')).toBeNull(); // no loop, no stmt
    expect(parseImperative('[[-1,0,0],[1,2,4],[4,3,1]]')).toBeNull(); // a bare literal stays functional
  });
});

// The literal-wipe regression fix (#B.7): a LITERAL list<point> output must be
// importable into add-point blocks WITHOUT losing the points, and must survive
// the blocks ↔ text round-trip as an equivalent (same-points) program.
describe('literal point list → top-level add-point blocks (no-wipe import)', () => {
  const LITERAL = '[[-1,0,0],[1,2,4],[4,3,1]]';

  it('importLiteralPointList turns a literal into one append per row', () => {
    const st = importLiteralPointList(LITERAL)!;
    expect(st).not.toBeNull();
    expect(st).toHaveLength(3);
    expect(st.every((s) => s.kind === 'append' && s.list === 'poly')).toBe(true);
    // exact coordinates preserved (the points the wipe used to destroy)
    expect(st.map((s) => s.expr.replace(/\s/g, ''))).toEqual(['[-1,0,0]', '[1,2,4]', '[4,3,1]']);
  });

  it('a bare literal is NOT imperative (emit/inference contract unchanged)', () => {
    expect(isImperative(LITERAL)).toBe(false);
    expect(importLiteralPointList('map(range(0,3), f(i)=[i,0])')).toBeNull(); // not a literal
    expect(importLiteralPointList('[1,2,3]')).toBeNull();                     // flat list, not rows
  });

  it('imported program serializes, re-parses, and compiles to the SAME points', () => {
    const prog: ImperativeProgram = {
      accumulators: ['poly'], vars: [], stmts: importLiteralPointList(LITERAL)!, loops: [], result: 'poly',
    };
    const text = serializeImperative(prog);
    expect(text).toContain('poly.append([-1, 0, 0])');
    // the serialized text is now recognized as an imperative program (top-level stmts)
    expect(isImperative(text)).toBe(true);
    const back = parseImperative(text)!;
    expect(back.stmts).toHaveLength(3);
    expect(back.loops).toHaveLength(0);
    const r = compileImperative(text);
    expect(r.ok).toBe(true);
    if (r.ok) expect(evalGrid(r.js, {})).toEqual([[-1, 0, 0], [1, 2, 4], [4, 3, 1]]);
  });

  it('validates top-level appends and flags a bad one', () => {
    const good = ['poly = []', 'poly.append([0, 0])', 'poly.append([1, 1])', 'return poly'].join('\n');
    expect(validateImperative(good, new Set())).toBeNull();
    const bad = ['poly = []', 'poly.append([bogus, 0])', 'return poly'].join('\n');
    expect(validateImperative(bad, new Set())).toMatch(/bogus/);
  });

  it('top-level statements coexist with a for-loop and keep order', () => {
    const src = [
      'poly = []',
      'poly.append([0, 0, 0])',
      'for i = 0 to 3',
      '  poly.append([i, 1, 0])',
      'return poly',
    ].join('\n');
    const p = parseImperative(src)!;
    expect(p.stmts).toHaveLength(1);
    expect(p.loops).toHaveLength(1);
    expect(serializeImperative(p)).toBe(src);
    const r = compileImperative(src);
    expect(r.ok).toBe(true);
    if (r.ok) expect(evalGrid(r.js, {})).toEqual([[0, 0, 0], [0, 1, 0], [1, 1, 0], [2, 1, 0]]);
  });
});

describe('imperative 2D / GRID loop (parametric surface foundation)', () => {
  const GRID = ['grid = []', 'for u = 0 to 3, v = 0 to 4', '  grid.append([u, v, 0])', 'return grid'].join('\n');

  it('parses the dual-range header into loopVar2/start2/stop2', () => {
    const p = parseImperative(GRID)!;
    expect(p).not.toBeNull();
    expect(p.loops).toHaveLength(1);
    expect(p.loops[0]).toMatchObject({
      loopVar: 'u', start: '0', stop: '3', loopVar2: 'v', start2: '0', stop2: '4',
    });
  });

  it('compiles to NESTED for-loops and evals to 12 points in ROW-MAJOR order', () => {
    const r = compileImperative(GRID);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const pts = evalGrid(r.js, {});
    expect(pts).toHaveLength(12); // Nu(3) × Nv(4)
    // row-major: u OUTER (0,0),(0,1),(0,2),(0,3),(1,0),…,(2,3)
    const expected: number[][] = [];
    for (let u = 0; u < 3; u++) for (let v = 0; v < 4; v++) expected.push([u, v, 0]);
    expect(pts).toEqual(expected);
  });

  it('grid bounds may be variables (Nu × Nv in scope)', () => {
    const src = ['g = []', 'for u = 0 to Nu, v = 0 to Nv', '  g.append([u, v, 0])', 'return g'].join('\n');
    const r = compileImperative(src);
    expect(r.ok).toBe(true);
    if (r.ok) expect(evalGrid(r.js, { Nu: 5, Nv: 2 })).toHaveLength(10);
  });

  it('round-trips: serialize(parse(x)) preserves the dual range', () => {
    const a = parseImperative(GRID)!;
    const s = serializeImperative(a);
    expect(s).toContain('for u = 0 to 3, v = 0 to 4');
    const b = parseImperative(s)!;
    expect(b.loops[0]).toMatchObject({
      loopVar: 'u', start: '0', stop: '3', loopVar2: 'v', start2: '0', stop2: '4',
    });
    expect(serializeImperative(b)).toBe(s);
  });

  it('a 1D loop is unaffected — no loopVar2, byte-identical compile', () => {
    const oneD = ['poly = []', 'for i = 0 to 5', '  poly.append([i, 0])', 'return poly'].join('\n');
    const p = parseImperative(oneD)!;
    expect(p.loops[0]!.loopVar2).toBeUndefined();
    const r = compileImperative(oneD);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.js).not.toContain('for (let v'); // single loop only
      expect(evalList(r.js, {}).length).toBe(5);
    }
  });
});

describe('imperative IF / THEN block (#31)', () => {
  const IF_ONLY = [
    'poly = []',
    'for i = 0 to 6',
    '  if i > 2',
    '    poly.append([i, 0])',
    '  end',
    'return poly',
  ].join('\n');

  const IF_ELSE = [
    'poly = []',
    'for i = 0 to 6',
    '  if i < 3',
    '    poly.append([i, 0])',
    '  else',
    '    poly.append([i, 1])',
    '  end',
    'return poly',
  ].join('\n');

  it('bodyStatements parses a nested if with a then-body (no else)', () => {
    const p = parseImperative(IF_ONLY)!;
    expect(p).not.toBeNull();
    const st = bodyStatements(p.loops[0]!.body);
    expect(st).toHaveLength(1);
    expect(st[0]!.kind).toBe('if');
    const ifs = st[0] as ImpIf;
    expect(ifs.cond).toBe('i > 2');
    expect(ifs.then).toHaveLength(1);
    expect(ifs.then[0]).toMatchObject({ kind: 'append', list: 'poly' });
    expect(ifs.else).toBeUndefined();
  });

  it('bodyStatements parses if/else with both branches', () => {
    const p = parseImperative(IF_ELSE)!;
    const ifs = bodyStatements(p.loops[0]!.body)[0] as ImpIf;
    expect(ifs.cond).toBe('i < 3');
    expect(ifs.then[0]).toMatchObject({ kind: 'append' });
    expect(ifs.else).toHaveLength(1);
    expect(ifs.else![0]).toMatchObject({ kind: 'append' });
  });

  it('compiles the if-only body to a real JS `if` and evals to the filtered count', () => {
    const r = compileImperative(IF_ONLY);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.js).toContain('if ((i > 2))');
    const pts = evalList(r.js, {});
    expect(pts).toHaveLength(3); // i in {3,4,5}
    expect(pts.map((p) => p[0])).toEqual([3, 4, 5]);
  });

  it('compiles if/else to both branches and picks by the condition', () => {
    const r = compileImperative(IF_ELSE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.js).toContain('else {');
    const pts = evalList(r.js, {});
    expect(pts).toHaveLength(6);
    // i<3 → y 0, else y 1
    expect(pts.map((p) => p[1])).toEqual([0, 0, 0, 1, 1, 1]);
  });

  it('serializeStatements ↔ bodyStatements round-trips the if/else tree', () => {
    const tree = bodyStatements(parseImperative(IF_ELSE)!.loops[0]!.body);
    const text = serializeStatements(tree);
    const back = bodyStatements(text);
    expect(back).toEqual(tree);
    expect(text).toContain('if i < 3');
    expect(text).toContain('else');
    expect(text).toContain('end');
  });

  it('full program round-trips: serialize(parse(x)) preserves the if block', () => {
    const a = parseImperative(IF_ELSE)!;
    const s = serializeImperative(a);
    const b = parseImperative(s)!;
    expect(bodyStatements(b.loops[0]!.body)).toEqual(bodyStatements(a.loops[0]!.body));
    expect(isImperative(IF_ELSE)).toBe(true);
  });

  it('validateImperative accepts a well-formed if and rejects an empty then', () => {
    expect(validateImperative(IF_ONLY, new Set())).toBeNull();
    const empty = ['poly = []', 'for i = 0 to 6', '  if i > 2', '  end', 'return poly'].join('\n');
    expect(validateImperative(empty, new Set())).toMatch(/empty/);
  });

  it('validateImperative flags an unknown name inside an if condition', () => {
    const bad = ['poly = []', 'for i = 0 to 6', '  if bogus > 2', '    poly.append([i, 0])', '  end', 'return poly'].join('\n');
    expect(validateImperative(bad, new Set())).toMatch(/bogus/);
  });
});
