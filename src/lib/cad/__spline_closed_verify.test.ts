/**
 * __spline_closed_verify.test.ts — verify "closed spline → sweep auto-follows".
 *
 * The EMIT assertions run in the normal suite (pure, no server). The BAKE
 * assertions POST to a LIVE dev server and are skipped unless SPLINE_BAKE_URL is
 * set. Run the live half with:
 *   SPLINE_BAKE_URL=http://localhost:3416 bun run vitest run src/lib/cad/__spline_closed_verify.test.ts
 *
 * Builds a spline of 4 control points (a rough square) wired into r_sweep.path
 * with an inline circle section. When the spline is closed:true the emit must
 * AUTO-FOLLOW → `closedPath: true, caps: false` + `resampleSpline([...], N, true)`;
 * closed:false → `closedPath: false, caps: true`. A hand-authored expr-IIFE path
 * is left UNTOUCHED (keeps its own explicit closedPath).
 */
import { describe, it, expect } from 'vitest';
import { newGraph } from './composition-graph-hydrate';
import { addSpline, setSplinePoints, setSplineSamples, setSplineClosed, addCall } from './composition-graph-mutate';
import { asExpr, asLiteral } from './composition-graph-types';
import { exprBlockMember } from './graph-exprs';
import { emitGraph } from './composition-emit';

const BASE = process.env.SPLINE_BAKE_URL;
const CIRCLE = '(() => { const n = 24, r = 0.6; return Array.from({ length: n }, (_, i) => { const a = 2 * Math.PI * i / n; return [r * Math.cos(a), r * Math.sin(a)]; }); })()';
// A rough square loop in the XZ plane (kept planar; r_sweep torsion caveat).
const SQUARE: [number, number, number][] = [[0, 0, 0], [8, 0, 0], [8, 0, 8], [0, 0, 8]];

function buildSplineSweep(closed: boolean, samples = 48) {
  let g = newGraph();
  const sp = addSpline(g); g = sp.graph;
  g = setSplinePoints(g, sp.id, SQUARE);
  g = setSplineSamples(g, sp.id, asLiteral(samples));
  g = setSplineClosed(g, sp.id, closed);
  // Note: we deliberately store closedPath/caps at the "wrong" values to prove
  // the auto-follow OVERRIDES them from the spline's `closed` flag.
  const c = addCall(g, 'r_sweep', {
    path: asExpr(exprBlockMember(sp.id, 'path')),
    section: asExpr(CIRCLE),
    closedPath: asLiteral(!closed),
    caps: asLiteral(closed),
  });
  g = c.graph;
  return { graph: g, splineId: sp.id };
}

/** A HAND-AUTHORED path (expr IIFE) — no spline source → must stay untouched. */
function buildHandPathSweep() {
  let g = newGraph();
  const PATH = '(() => [[0,0,0],[3,0,0],[6,0,2],[9,0,2]])()';
  const c = addCall(g, 'r_sweep', {
    path: asExpr(PATH),
    section: asExpr(CIRCLE),
    closedPath: asLiteral(false),
    caps: asLiteral(true),
  });
  g = c.graph;
  return { graph: g };
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
  const verts = body?.full?.positions?.length ? body.full.positions.length / 3 : 0;
  return { status: resp.status, verts: Math.round(verts), body };
}

describe('closed spline → sweep auto-follows (emit)', () => {
  it('closed:true → closedPath: true, caps: false + resampleSpline(..., true)', () => {
    const { graph, splineId } = buildSplineSweep(true);
    const { source } = emitGraph(graph, { id: 'spline_closed' });
    const member = exprBlockMember(splineId, 'path');
    expect(source).toContain(`const ${member} = resampleSpline(`);
    expect(source).toMatch(new RegExp(`resampleSpline\\(\\[.*\\], \\d+, true\\)`));
    // The r_sweep call auto-followed — overriding the deliberately-wrong stored args.
    expect(source).toContain('closedPath: true');
    expect(source).toContain('caps: false');
    expect(source).not.toContain('closedPath: false');
  });

  it('closed:false → closedPath: false, caps: true + resampleSpline(..., false)', () => {
    const { graph, splineId } = buildSplineSweep(false);
    const { source } = emitGraph(graph, { id: 'spline_open' });
    const member = exprBlockMember(splineId, 'path');
    expect(source).toMatch(new RegExp(`resampleSpline\\(\\[.*\\], \\d+, false\\)`));
    expect(source).toContain('closedPath: false');
    expect(source).toContain('caps: true');
    expect(source).not.toContain('closedPath: true');
    // sanity — the member is wired in
    expect(source).toContain(member);
  });

  it('hand-authored (expr IIFE) path is NOT auto-followed — keeps its own args', () => {
    const { graph } = buildHandPathSweep();
    const { source } = emitGraph(graph, { id: 'hand_path' });
    // No resampleSpline (no spline node); closedPath/caps are the stored values.
    expect(source).not.toContain('resampleSpline(');
    expect(source).toContain('closedPath: false');
    expect(source).toContain('caps: true');
  });
});

describe.skipIf(!BASE)('closed spline → sweep bake (live)', () => {
  it('closed:true bakes a watertight ring (no caps); closed:false bakes a capped tube', async () => {
    const closed = await bake(buildSplineSweep(true).graph, 'spline_closed_bake');
    const open = await bake(buildSplineSweep(false).graph, 'spline_open_bake');
    // eslint-disable-next-line no-console
    console.log(`[closed spline bake] closed status=${closed.status} verts=${closed.verts} · open status=${open.status} verts=${open.verts}`);
    if (closed.status !== 200) console.log('closed error:', JSON.stringify(closed.body).slice(0, 400));
    if (open.status !== 200) console.log('open error:', JSON.stringify(open.body).slice(0, 400));
    expect(closed.status).toBe(200);
    expect(open.status).toBe(200);
    expect(closed.verts).toBeGreaterThan(0);
    expect(open.verts).toBeGreaterThan(0);
  });
});
