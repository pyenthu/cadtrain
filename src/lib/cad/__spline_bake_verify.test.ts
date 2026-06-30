/**
 * __spline_bake_verify.test.ts — END-TO-END bake check for the spline path card.
 * NOT part of the normal suite: it POSTs to a LIVE dev server on :3415, so it is
 * skipped unless SPLINE_BAKE_URL is set. Run with:
 *   SPLINE_BAKE_URL=http://localhost:3415 bun run test -- --run src/lib/cad/__spline_bake_verify.test.ts
 *
 * Builds a graph programmatically (spline → r_sweep.path + inline circle section),
 * emits via emitGraph, POSTs to /api/primitives/preview, asserts a SMOOTH tube
 * bakes and that MORE samples → MORE vertices.
 */
import { describe, it, expect } from 'vitest';
import { newGraph } from './composition-graph-hydrate';
import { addSpline, setSplinePoints, setSplineSamples, addCall } from './composition-graph-mutate';
import { asExpr, asLiteral } from './composition-graph-types';
import { exprBlockMember } from './graph-exprs';
import { emitGraph } from './composition-emit';

const BASE = process.env.SPLINE_BAKE_URL;
const CIRCLE = '(() => { const n = 24, r = 0.5; return Array.from({ length: n }, (_, i) => { const a = 2 * Math.PI * i / n; return [r * Math.cos(a), r * Math.sin(a)]; }); })()';

function buildGraph(samples: number) {
  let g = newGraph();
  const sp = addSpline(g); g = sp.graph;
  // A gentle 5-point 3D S-bend (kept gentle per r_sweep's torsion caveat).
  g = setSplinePoints(g, sp.id, [
    [0, 0, 0], [3, 2, 0], [6, 0, 1], [9, 2, 0], [12, 0, -1],
  ]);
  g = setSplineSamples(g, sp.id, asLiteral(samples));
  const c = addCall(g, 'r_sweep', {
    path: asExpr(exprBlockMember(sp.id, 'path')),
    section: asExpr(CIRCLE),
    closedPath: asLiteral(false),
    caps: asLiteral(true),
  });
  g = c.graph;
  return { graph: g, splineId: sp.id };
}

async function bake(graph: any, name: string): Promise<{ status: number; verts: number; body: any }> {
  const { source } = emitGraph(graph, { id: name });
  const positional = Object.keys(graph.params).map((k: string) => graph.params[k]!.default);
  const resp = await fetch(`${BASE}/api/primitives/preview`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source, name, params: positional }),
  });
  const body = await resp.json().catch(() => ({}));
  // The serialized mesh is { full: { positions, normals, colors }, cutVC: {…} }.
  const verts = body?.full?.positions?.length ? body.full.positions.length / 3 : 0;
  return { status: resp.status, verts: Math.round(verts), body };
}

describe.skipIf(!BASE)('spline → r_sweep bake (live)', () => {
  it('emits a resampleSpline path const wired into r_sweep.path', () => {
    const { graph, splineId } = buildGraph(32);
    const { source } = emitGraph(graph, { id: 'spline_sweep_demo' });
    const member = exprBlockMember(splineId, 'path');
    expect(source).toContain(`const ${member} = resampleSpline(`);
    expect(source).toContain(`r_sweep(`);
    expect(source).toContain(member); // the call references the same const
  });

  it('bakes a smooth tube; more samples → more vertices', async () => {
    const low = await bake(buildGraph(8).graph, 'spline_sweep_lo');
    const high = await bake(buildGraph(64).graph, 'spline_sweep_hi');
    // eslint-disable-next-line no-console
    console.log(`[spline bake] lo(N=8) status=${low.status} verts=${low.verts} · hi(N=64) status=${high.status} verts=${high.verts}`);
    if (low.status !== 200) console.log('lo error:', JSON.stringify(low.body).slice(0, 400));
    if (high.status !== 200) console.log('hi error:', JSON.stringify(high.body).slice(0, 400));
    expect(low.status).toBe(200);
    expect(high.status).toBe(200);
    expect(low.verts).toBeGreaterThan(0);
    expect(high.verts).toBeGreaterThan(low.verts);
  });
});
