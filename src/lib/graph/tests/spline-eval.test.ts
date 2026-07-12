import { describe, it, expect } from 'vitest';
import { resolveWiredSplinePoints } from '../spline-eval';
import type { Graph, ExprDef } from '../composition-graph-types';
import { asLiteral, asExpr, asParam } from '../composition-graph-types';
import { exprBlockMember } from '../graph-exprs';

/** A graph with one expr def (a list<point3> output) + an instance + a spline.
 *  Mirrors __spline_pointsexpr_verify.test.ts. `defParams` become the def's
 *  input sockets; `instBindings` wires them (def-param-name → ArgValue). */
function baseGraph(
  formula: string,
  opts: { defParams?: ExprDef['params']; instBindings?: Record<string, any>; params?: Graph['params'] } = {},
): Graph {
  const exprDef: ExprDef = {
    id: 'n_def001', name: 'gen',
    params: opts.defParams ?? [], consts: [], vars: [],
    outputs: [{ name: 'pts', formula, shape: 'list', elem: 'point' }],
  };
  return {
    nodes: {
      n_expr01: { id: 'n_expr01', type: 'expr', defId: 'n_def001', bindings: opts.instBindings ?? {} },
      n_spl001: { id: 'n_spl001', type: 'spline', points: [[0, 0, 0], [3, 1.5, 0]], samples: asLiteral(32) },
      n_root: { id: 'n_root', type: 'list', children: [] },
    },
    root: 'n_root',
    params: opts.params ?? {}, edges: [], imports: [], layout: {},
    exprDefs: [exprDef],
  } as unknown as Graph;
}

describe('resolveWiredSplinePoints (#26 display)', () => {
  it('evaluates a functional map(range(), f(i)=…) point list to concrete points', () => {
    const g = baseGraph('map(range(0, 8), f(i) = [cos(i) * 5, sin(i) * 5, i])');
    const pts = resolveWiredSplinePoints(g, asExpr(exprBlockMember('n_expr01', 'pts')));
    expect(pts.length).toBe(8);
    expect(pts[0][0]).toBeCloseTo(5);  // cos(0)*5
    expect(pts[0][1]).toBeCloseTo(0);  // sin(0)*5
    expect(pts[0][2]).toBeCloseTo(0);
    expect(pts[3][2]).toBeCloseTo(3);  // z = i
  });

  it('pads 2D points to z=0', () => {
    const g = baseGraph('map(range(0, 3), f(i) = [i, i * 2])');
    const pts = resolveWiredSplinePoints(g, asExpr(exprBlockMember('n_expr01', 'pts')));
    expect(pts).toEqual([[0, 0, 0], [1, 2, 0], [2, 4, 0]]);
  });

  it('threads a part param through an instance binding (def param R ← p.R)', () => {
    const g = baseGraph('map(range(0, 2), f(i) = [i * R, 0, 0])', {
      defParams: [{ name: 'R', default: 1 }],
      instBindings: { R: asParam('R') },
      params: { R: { default: 4 } as any },
    });
    const pts = resolveWiredSplinePoints(g, asExpr(exprBlockMember('n_expr01', 'pts')));
    expect(pts).toEqual([[0, 0, 0], [4, 0, 0]]);
  });

  it("falls back to the def param's default when unbound", () => {
    const g = baseGraph('map(range(0, 2), f(i) = [i * R, 0, 0])', {
      defParams: [{ name: 'R', default: 3 }],
    });
    const pts = resolveWiredSplinePoints(g, asExpr(exprBlockMember('n_expr01', 'pts')));
    expect(pts).toEqual([[0, 0, 0], [3, 0, 0]]);
  });

  it('returns [] for a non-expr / param source', () => {
    const g = baseGraph('map(range(0, 2), f(i) = [i, 0, 0])');
    expect(resolveWiredSplinePoints(g, undefined)).toEqual([]);
    expect(resolveWiredSplinePoints(g, asLiteral(3))).toEqual([]);
  });

  it('returns [] for an unknown var (no crash)', () => {
    const g = baseGraph('map(range(0, 2), f(i) = [i, 0, 0])');
    expect(resolveWiredSplinePoints(g, asExpr('_x_nope_missing'))).toEqual([]);
  });

  it('returns [] for an invalid formula (no throw)', () => {
    const g = baseGraph('this is (((not valid');
    expect(resolveWiredSplinePoints(g, asExpr(exprBlockMember('n_expr01', 'pts')))).toEqual([]);
  });

  it('rejects an unsafe target-var identifier', () => {
    const g = baseGraph('map(range(0, 2), f(i) = [i, 0, 0])');
    expect(resolveWiredSplinePoints(g, asExpr('_x_a; throw 1'))).toEqual([]);
  });
});
