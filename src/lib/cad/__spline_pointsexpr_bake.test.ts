/**
 * __spline_pointsexpr_bake.test.ts — LIVE end-to-end bake for the WIRED spline
 * control-points input (#26). Skipped unless SPLINE_BAKE_URL is set:
 *   SPLINE_BAKE_URL=http://localhost:PORT bunx vitest run src/lib/cad/__spline_pointsexpr_bake.test.ts
 * Builds expr(list<point3>) → spline(pointsExpr) → r_sweep and asserts it bakes.
 */
import { describe, it, expect } from 'vitest';
import { asExpr, asLiteral } from './composition-graph-types';
import type { Graph, ExprDef } from './composition-graph-types';
import { exprBlockMember } from './graph-exprs';
import { emitGraph } from './composition-emit';

const BASE = process.env.SPLINE_BAKE_URL;
const CIRCLE = '(() => { const n = 24, r = 0.5; return Array.from({ length: n }, (_, i) => { const a = 2 * Math.PI * i / n; return [r * Math.cos(a), r * Math.sin(a)]; }); })()';

function wiredGraph(samples: number): Graph {
  const def: ExprDef = {
    id: 'n_def001', name: 'helix',
    params: [], consts: [], vars: [],
    outputs: [{ name: 'pts', formula: 'map(range(0, 40), f(i) = [4 * cos(i * 0.3), 4 * sin(i * 0.3), i * 0.5])', shape: 'list', elem: 'point' }],
  };
  return {
    nodes: {
      n_expr01: { id: 'n_expr01', type: 'expr', defId: 'n_def001', bindings: {} },
      n_spl001: { id: 'n_spl001', type: 'spline',
        points: [[0,0,0],[3,1.5,0],[6,0,0]],
        pointsExpr: asExpr(exprBlockMember('n_expr01', 'pts')),
        samples: asLiteral(samples) },
      n_call01: { id: 'n_call01', type: 'call', src: 'r_sweep', alias: 'body',
        args: { path: asExpr(exprBlockMember('n_spl001', 'path')), section: asExpr(CIRCLE),
          closedPath: asLiteral(false), caps: asLiteral(true) } },
      n_root: { id: 'n_root', type: 'list', children: ['n_call01'] },
    },
    root: 'n_root', params: {}, edges: [], imports: ['r_sweep'], layout: {}, exprDefs: [def],
  } as unknown as Graph;
}

async function bake(graph: Graph, name: string) {
  const { source } = emitGraph(graph, { id: name });
  const resp = await fetch(`${BASE}/api/primitives/preview`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source, name, params: [] }),
  });
  const body = await resp.json().catch(() => ({}));
  const verts = body?.full?.positions?.length ? body.full.positions.length / 3 : 0;
  return { status: resp.status, verts: Math.round(verts), body, source };
}

describe.skipIf(!BASE)('wired spline → r_sweep bake (live, #26)', () => {
  it('emits resampleSpline over the expr output const', () => {
    const { source } = emitGraph(wiredGraph(48), { id: 'wired_spline_demo' });
    expect(source).toContain(`resampleSpline(${exprBlockMember('n_expr01','pts')}, 48, false)`);
    expect(source).toContain(`const ${exprBlockMember('n_expr01','pts')} =`);
  });
  it('bakes geometry from the wired expression points', async () => {
    const r = await bake(wiredGraph(48), 'wired_spline_bake');
    // eslint-disable-next-line no-console
    console.log(`[wired spline bake] status=${r.status} verts=${r.verts}`);
    if (r.status !== 200) console.log('error:', JSON.stringify(r.body).slice(0, 500));
    expect(r.status).toBe(200);
    expect(r.verts).toBeGreaterThan(0);
  });
});
