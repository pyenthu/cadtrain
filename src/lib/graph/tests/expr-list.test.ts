/**
 * expr-list.test.ts — #11 expression-as-builder, FIRST STEP.
 *
 * A `shape:'list', elem:'point'` expression OUTPUT carries a flat array of
 * `[r,z]` points produced by a `map(range(N), f(i)=…)` formula, wired into a
 * polygon's points (the `expr-list-ref` entry) → r_weld_extrude. Covers:
 *   • compileListFormula lowers the mathjs list grammar to runnable JS
 *   • validation accepts a list formula, still rejects it as a scalar
 *   • a scalar output stays BYTE-IDENTICAL (the back-compat guarantee)
 *   • the spiral-as-ONE-expression graph emits a wired, evaluable body
 */
import { describe, it, expect } from 'vitest';
import {
  newGraph, addParam, hydrateGraph,
  addExprDef, addExprInstance, addExprDefParam, setExprDefParamName,
  addExprDefConst, setExprDefConstName, setExprDefConstValue,
  addExprDefVar, setExprDefVarName, setExprDefVarFormula,
  addExprDefOutput, setExprDefOutputName, setExprDefOutputFormula, setExprDefOutputShape,
  setExprInputBinding, addPolygon, addPolygonExprListRef, addPolygonExprList, addCall, setCallArg,
  asParam, asLiteral,
} from '$lib/graph/composition/composition-graph';
import { emitGraph } from '$lib/graph/composition/composition-emit';
import { compileListFormula, parseAndValidateBare, exprBlockVar } from '$lib/graph/expr/graph-exprs';
import { buildAllowedInputs } from '$lib/graph/expr/expr-schema';

// The canonical Case-1 spiral profile as ONE list<point> output formula:
// two index-maps (outer edge forward, inner edge reversed) joined with concat.
const SPIRAL_FORMULA =
  'concat(' +
  'map(range(0, NPts), f(i) = [ (r0 + growth*i/NPts)*cos(i*turns*tau/NPts), (r0 + growth*i/NPts)*sin(i*turns*tau/NPts) ]), ' +
  'map(range(0, NPts), f(j) = [ (r0 + growth*(NPts-1-j)/NPts - width)*cos((NPts-1-j)*turns*tau/NPts), (r0 + growth*(NPts-1-j)/NPts - width)*sin((NPts-1-j)*turns*tau/NPts) ])' +
  ')';

const tau = 2 * Math.PI;
/** Eval a compiled list-formula JS string with the math globals + def params
 *  bound (compileListFormula preserves bare names; emit rewrites them later). */
function evalList(js: string, vars: Record<string, number>): [number, number][] {
  const names = ['cos', 'sin', 'tau', ...Object.keys(vars)];
  const vals = [Math.cos, Math.sin, tau, ...Object.values(vars)];
  // eslint-disable-next-line no-new-func
  return new Function(...names, `return ${js};`)(...vals);
}

describe('compileListFormula — mathjs list grammar → JS array', () => {
  it('lowers map(range(N), f(i)=[…]) to an evaluable array', () => {
    const res = compileListFormula('map(range(0, 3), f(i) = [i, i*2])');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const pts = evalList(res.js, {});
    expect(pts).toEqual([[0, 0], [1, 2], [2, 4]]);
  });

  it('concat joins two maps; range(stop) is half-open', () => {
    const res = compileListFormula('concat(map(range(2), f(i)=[i]), map(range(2), f(j)=[j+10]))');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(evalList(res.js, {})).toEqual([[0], [1], [10], [11]]);
  });

  it('compiles the full spiral profile to the expected point count + extents', () => {
    const res = compileListFormula(SPIRAL_FORMULA);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const NPts = 360;
    const pts = evalList(res.js, { NPts, r0: 0.4, growth: 1, turns: 2, width: 0.2 });
    expect(pts.length).toBe(2 * NPts);              // outer + inner edge
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const maxR = Math.max(...xs.map(Math.abs), ...ys.map(Math.abs));
    // g_spiral default extents are ~±1.4 in r (r0 + growth ≈ 1.4).
    expect(maxR).toBeGreaterThan(1.3);
    expect(maxR).toBeLessThan(1.5);
  });

  it('an empty formula compiles to []', () => {
    const res = compileListFormula('   ');
    expect(res).toEqual({ ok: true, js: '[]' });
  });
});

describe('validation — list grammar gated by shape', () => {
  const allowed = buildAllowedInputs(['NPts', 'r0', 'growth', 'turns', 'width'], []).dotted;
  // Bare-name allowed set (def locals are bare, not p.*/e.*).
  const names = new Set(['NPts', 'r0', 'growth', 'turns', 'width']);

  it('accepts a map() list formula under shape:list', () => {
    const { errors } = parseAndValidateBare(SPIRAL_FORMULA, names, 'list');
    expect(errors).toEqual([]);
  });

  it('REJECTS the same formula under scalar shape (array/lambda/map banned)', () => {
    const { errors } = parseAndValidateBare(SPIRAL_FORMULA, names, 'scalar');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('still rejects an unknown name inside a list formula', () => {
    const { errors } = parseAndValidateBare('map(range(0, NPts), f(i)=[bogus, i])', names, 'list');
    expect(errors.some((e) => /bogus/.test(e.msg))).toBe(true);
  });

  it('a scalar formula validates unchanged (default shape)', () => {
    expect(parseAndValidateBare('(r0 + width) / 2', names).errors).toEqual([]);
    void allowed;
  });
});

/** Build a scalar four-section def `wall(od,id)→wall` (mirrors expr-emit.test). */
function scalarWallDef(g0 = newGraph()) {
  let { graph, id: defId } = addExprDef(g0);
  graph = addExprDefParam(graph, defId); graph = setExprDefParamName(graph, defId, 0, 'od');
  graph = addExprDefParam(graph, defId); graph = setExprDefParamName(graph, defId, 1, 'id');
  graph = addExprDefConst(graph, defId); graph = setExprDefConstName(graph, defId, 0, 'two'); graph = setExprDefConstValue(graph, defId, 0, 2);
  graph = addExprDefVar(graph, defId); graph = setExprDefVarName(graph, defId, 0, 'diff'); graph = setExprDefVarFormula(graph, defId, 0, 'od - id');
  graph = addExprDefOutput(graph, defId); graph = setExprDefOutputName(graph, defId, 0, 'wall'); graph = setExprDefOutputFormula(graph, defId, 0, 'diff / two');
  return { graph, defId };
}

describe('scalar outputs stay byte-identical (back-compat guarantee)', () => {
  it('a scalar output emits the same const it always did', () => {
    let { graph, defId } = scalarWallDef();
    const inst = addExprInstance(graph, defId); graph = inst.graph;
    const { body } = emitGraph(graph, { id: 'sc' });
    const V = exprBlockVar(inst.id);
    expect(body).toContain(`const ${V}_wall = ${V}_diff / ${V}_two;`);
    expect(body).not.toContain('.concat');
    expect(body).not.toContain('Array.from');
  });
});

/** Build the full spiral-as-one-expression graph. Returns { graph, polyId,
 *  exprId, callId }. */
function spiralGraph() {
  let graph = newGraph();
  for (const [n, def] of [['NPts', 360], ['r0', 0.4], ['growth', 1], ['turns', 2], ['width', 0.2], ['length', 2]] as const) {
    graph = addParam(graph, n, { default: def });
  }
  const made = addExprDef(graph); graph = made.graph; const defId = made.id;
  const params = ['NPts', 'r0', 'growth', 'turns', 'width'];
  params.forEach((nm, i) => { graph = addExprDefParam(graph, defId); graph = setExprDefParamName(graph, defId, i, nm); });
  graph = addExprDefOutput(graph, defId);
  graph = setExprDefOutputName(graph, defId, 0, 'profile_pts');
  graph = setExprDefOutputFormula(graph, defId, 0, SPIRAL_FORMULA);
  graph = setExprDefOutputShape(graph, defId, 0, 'list', 'point');

  const inst = addExprInstance(graph, defId); graph = inst.graph;
  for (const nm of params) graph = setExprInputBinding(graph, inst.id, nm, asParam(nm));

  const poly = addPolygon(graph, []); graph = poly.graph;
  graph = addPolygonExprListRef(graph, poly.id, inst.id, 'profile_pts');

  const call = addCall(graph, 'r_weld_extrude'); graph = call.graph;
  graph = setCallArg(graph, call.id, 'profile', { kind: 'expr', expr: `__POLY__${poly.id}` });
  graph = setCallArg(graph, call.id, 'length', asParam('length'));
  graph = setCallArg(graph, call.id, 'divs', asLiteral(12));
  graph = setCallArg(graph, call.id, 'twist', asLiteral(0));
  graph = setCallArg(graph, call.id, 'taper', asLiteral(0));
  graph = setCallArg(graph, call.id, 'segments', asLiteral(32));
  return { graph, polyId: poly.id, exprId: inst.id, callId: call.id };
}

describe('spiral as ONE expression → polygon → r_weld_extrude', () => {
  it('emits a wired body: list-output const, polygon splice, extrude call', () => {
    const { graph, polyId, exprId } = spiralGraph();
    const { body, validationErrors } = emitGraph(graph, { id: 'g_spiral_expr' });
    expect(validationErrors).toEqual([]);
    const V = exprBlockVar(exprId);

    // The list output const is the compiled JS array, with def params → V_*.
    expect(body).toContain(`const ${V}_profile_pts = [].concat(`);
    expect(body).toContain(`${V}_NPts`);              // a param got namespaced
    expect(body).toContain('Array.from');             // range(...) lowering
    // The polygon splices the output array; the extrude consumes the polygon.
    expect(body).toContain(`[...${V}_profile_pts]`);
    expect(body).toContain('r_weld_extrude({ profile: _poly_1');
    void polyId;
  });

  it('round-trips the typed output + expr-list-ref through serialise → hydrate', () => {
    const { graph } = spiralGraph();
    const { meta } = emitGraph(graph, { id: 'rt' });
    const g2 = hydrateGraph((meta as any).graph);
    const def = (g2.exprDefs ?? [])[0]!;
    expect(def.outputs[0]).toMatchObject({ name: 'profile_pts', shape: 'list', elem: 'point' });
    const poly = Object.values(g2.nodes).find((n: any) => n.type === 'polygon') as any;
    expect(poly.points[0]).toMatchObject({ kind: 'expr-list-ref', output: 'profile_pts' });
  });

  it('the emitted profile array evaluates to 2*NPts points (the bake input)', () => {
    const { graph, exprId } = spiralGraph();
    const { body } = emitGraph(graph, { id: 'g_spiral_expr' });
    const V = exprBlockVar(exprId);
    // Pull the list-output const RHS out of the body + eval it with p bound.
    const m = body.match(new RegExp(`const ${V}_profile_pts = ([\\s\\S]*?);\\n`));
    expect(m).toBeTruthy();
    const rhs = m![1]!.replace(new RegExp(`${V}_`, 'g'), 'p_');  // V_NPts → p_NPts
    const NPts = 360;
    const pts = evalList(rhs, { p_NPts: NPts, p_r0: 0.4, p_growth: 1, p_turns: 2, p_width: 0.2 });
    expect(pts.length).toBe(2 * NPts);
  });
});

describe('addPolygonExprList — the "+ expr" create-affordance (PR3)', () => {
  it('creates a list<point> def + instance + ref on the polygon in one action', () => {
    let graph = newGraph();
    const poly = addPolygon(graph, []); graph = poly.graph;
    const before = (graph.exprDefs ?? []).length;

    const res = addPolygonExprList(graph, poly.id);
    graph = res.graph;

    // a fresh def with exactly one list<point> output named 'pts', seeded with a map
    expect((graph.exprDefs ?? []).length).toBe(before + 1);
    const def = (graph.exprDefs ?? []).find((d) => d.id === res.defId)!;
    expect(def.outputs).toHaveLength(1);
    expect(def.outputs[0]).toMatchObject({ name: 'pts', shape: 'list', elem: 'point' });
    expect(def.outputs[0]!.formula).toContain('map(');

    // a dropped instance of that def
    expect(graph.nodes[res.instanceId!]?.type).toBe('expr');

    // the polygon now references the instance output via an expr-list-ref
    const p = graph.nodes[poly.id] as any;
    expect(p.points.some((e: any) =>
      e?.kind === 'expr-list-ref' && e.sourceId === res.instanceId && e.output === 'pts')).toBe(true);

    // the seeded formula validates as a list (would be rejected as a scalar)
    const allowed = new Set<string>();
    expect(parseAndValidateBare(def.outputs[0]!.formula, allowed, 'list').errors).toHaveLength(0);
    expect(parseAndValidateBare(def.outputs[0]!.formula, allowed, 'scalar').errors.length).toBeGreaterThan(0);
  });

  it('is a no-op on a non-polygon id', () => {
    const graph = newGraph();
    const res = addPolygonExprList(graph, 'nope');
    expect(res.graph).toBe(graph);
    expect(res.defId).toBeUndefined();
  });
});
