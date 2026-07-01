import { describe, it, expect } from 'vitest';
import { emitSplineBlocks, emitGraph } from './composition-emit';
import type { Graph, ExprDef } from './composition-graph-types';
import { asLiteral, asExpr } from './composition-graph-types';
import { exprBlockMember } from './graph-exprs';

function baseGraph(): Graph {
  const exprDef: ExprDef = {
    id: 'n_def001', name: 'helix',
    params: [{ name: 'N', default: 24 }],
    consts: [], vars: [],
    outputs: [{ name: 'pts', formula: 'map(range(0, 24), i => [cos(i), sin(i), i * 0.5])', shape: 'list', elem: 'point' }],
  };
  return {
    nodes: {
      n_expr01: { id: 'n_expr01', type: 'expr', defId: 'n_def001', bindings: {} },
      n_spl001: { id: 'n_spl001', type: 'spline', points: [[0,0,0],[3,1.5,0],[6,0,0]], samples: asLiteral(32) },
      n_call01: { id: 'n_call01', type: 'call', src: 'r_sweep', alias: 'body',
        args: { path: asExpr(exprBlockMember('n_spl001', 'path')), section: asExpr('__POLY__n_poly1') } },
      n_poly1: { id: 'n_poly1', type: 'polygon', points: [
        { kind: 'point', r: asLiteral(1), z: asLiteral(0) },
        { kind: 'point', r: asLiteral(1), z: asLiteral(1) },
        { kind: 'point', r: asLiteral(0), z: asLiteral(1) },
      ] },
      n_root: { id: 'n_root', type: 'list', children: ['n_call01'] },
    },
    root: 'n_root',
    params: {}, edges: [], imports: ['r_sweep'], layout: {},
    exprDefs: [exprDef],
  } as unknown as Graph;
}

describe('spline pointsExpr (#26)', () => {
  it('unwired spline emits the manual literal array (byte-identical)', () => {
    const g = baseGraph();
    const lines = emitSplineBlocks(g);
    expect(lines).toEqual([
      `const ${exprBlockMember('n_spl001','path')} = resampleSpline([[0, 0, 0], [3, 1.5, 0], [6, 0, 0]], 32, false);`,
    ]);
  });

  it('wired spline emits resampleSpline over the expr output var', () => {
    const g = baseGraph();
    const spl = g.nodes['n_spl001'] as any;
    spl.pointsExpr = asExpr(exprBlockMember('n_expr01', 'pts'));
    const lines = emitSplineBlocks(g);
    expect(lines[0]).toContain(`resampleSpline(${exprBlockMember('n_expr01','pts')}, 32, false)`);
    expect(lines[0]).not.toContain('[[0, 0, 0]');
  });

  it('full emit declares the expr-output const ABOVE the spline block (no TDZ)', () => {
    const g = baseGraph();
    const spl = g.nodes['n_spl001'] as any;
    spl.pointsExpr = asExpr(exprBlockMember('n_expr01', 'pts'));
    const { source } = emitGraph(g, { id: 'demo' });
    const exprConstDecl = `const ${exprBlockMember('n_expr01','pts')} =`;
    const splineDecl = `const ${exprBlockMember('n_spl001','path')} = resampleSpline(${exprBlockMember('n_expr01','pts')}`;
    const iExpr = source.indexOf(exprConstDecl);
    const iSpline = source.indexOf(splineDecl);
    expect(iExpr).toBeGreaterThan(-1);
    expect(iSpline).toBeGreaterThan(-1);
    expect(iExpr).toBeLessThan(iSpline); // expr const declared first
  });
});
