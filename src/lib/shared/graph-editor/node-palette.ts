/**
 * node-palette.ts — PURE graph-building factories for the GraphEditorPane
 * "drop a node" palette. Each `buildXDrop(graph, …)` takes the current graph and
 * returns a NEW graph (plus flags the shell needs), with ZERO reactive/DOM
 * coupling — the GEP shell keeps the thin handler that closes the picker,
 * reassigns `graph`, and bumps the bake nonce. Extracted from GraphEditorPane
 * (modularize: the node-palette cut) so the graph-construction logic is unit-
 * testable in isolation and the shell shrinks toward orchestration-only.
 */
import type { Graph, ArgValue } from '$lib/cad/composition-graph-types';
import { asLiteral, asExpr } from '$lib/cad/composition-graph-types';
import { addCall, addPolygon, addSketch } from '$lib/cad/composition-graph-mutate';

export type SolidOp = 'revolve' | 'extrude' | 'loft' | 'sweep';

/**
 * Build a Call node's args from a fetched primitive's `meta.params`. A
 * profile-typed param (r_revolve / r_extrude) carries a `{kind, params}`
 * DESCRIPTOR as its default (not a number) → encode as an `expr` ArgValue so
 * emit injects the literal object syntax + the primitive's resolveProfile
 * collapses it to points; everything else → a literal from its default (0).
 * Pure — the fetch + drift-cache ingest stay in the GEP handler.
 */
export function buildCallArgs(params: Record<string, any>): Record<string, ArgValue> {
  const args: Record<string, ArgValue> = {};
  for (const [k, p] of Object.entries(params ?? {})) {
    if (p && typeof p === 'object' && p.type === 'profile' && p.default && typeof p.default === 'object') {
      args[k] = asExpr(JSON.stringify(p.default));
    } else {
      args[k] = asLiteral(p?.default ?? 0);
    }
  }
  return args;
}

/** Default cartesian (x,y) cross-section for a fresh extrude/loft polygon:
 *  a unit square centred on the origin. */
export const POLY_EXTRUDE_DEFAULT = [
  { r: asLiteral(-1), z: asLiteral(-1) },
  { r: asLiteral( 1), z: asLiteral(-1) },
  { r: asLiteral( 1), z: asLiteral( 1) },
  { r: asLiteral(-1), z: asLiteral( 1) },
];

/**
 * Drop a solid producer (revolve / extrude / loft / sweep) into the graph.
 *
 * - **sweep** seeds BOTH data inputs (a 3D L-bend `path` + a round 24-gon
 *   `section`) as inline expr args so the default tube is round; returns
 *   `bakeBump:true` (it has no profile producer to trigger a re-bake otherwise).
 * - **revolve** finds/creates a SKETCH producer (line/spline/fillet (r,z) — the
 *   smoother CAD half-section) and wires it via `__POLY__<id>`.
 * - **extrude / loft** find/create a cartesian POLYGON producer instead.
 *
 * Pure: returns the new graph; the caller reassigns state + closes the picker.
 */
export function buildSolidDrop(graph: Graph, op: SolidOp): { graph: Graph; bakeBump: boolean } {
  // SWEEP is the odd one out: r_sweep takes TWO data inputs — a 3D `path` and a
  // 2D `section` — not a single profile producer. Seed both as inline expr args
  // (a round 24-gon section + an L-bend path) so the default tube is ROUND; the
  // user edits them in the ƒ popover or rewires a polygon/expr into either socket.
  if (op === 'sweep') {
    const g = addCall(graph, 'r_sweep', {
      path: { kind: 'expr', expr: '[[0, 0, 0], [3, 0, 0], [3, 3, 0]]' } as any,
      section: {
        kind: 'expr',
        expr: '(() => { const n = 24, r = 0.5; return Array.from({ length: n }, (_, i) => { const a = 2 * Math.PI * i / n; return [r * Math.cos(a), r * Math.sin(a)]; }); })()',
      } as any,
      closedPath: { kind: 'literal', value: false } as any,
      caps: { kind: 'literal', value: true } as any,
    }).graph;
    return { graph: g, bakeBump: true };
  }

  // Find an existing PROFILE PRODUCER to feed the solid, or create one.
  // REVOLVE defaults to the SKETCH engine (line/spline/fillet (r,z) ops) —
  // smoother, CAD-style half-sections beat a raw polygon, and the sketch
  // wires into the profile arg the same `__POLY__<id>` way (per dropSketch).
  // EXTRUDE / LOFT keep the cartesian (x,y) polygon. The producer becomes
  // non-deletable while the solid consumes it (× greys out + 🔒 on the card);
  // delete the solid first to unlock it.
  let g = graph;
  let profileId: string | undefined;
  if (op === 'revolve') {
    profileId = (Object.values(g.nodes).find((n) => (n as any).type === 'sketch') as any)?.id;
    if (!profileId) {
      const r = addSketch(g);
      g = r.graph;
      profileId = r.id;
    }
  } else {
    // loft + extrude both take a cartesian (x,y) cross-section.
    profileId = (Object.values(g.nodes).find((n) => (n as any).type === 'polygon') as any)?.id;
    if (!profileId) {
      const r = addPolygon(g, POLY_EXTRUDE_DEFAULT);
      g = r.graph;
      profileId = r.id;
    }
  }
  const profileArg = { kind: 'expr' as const, expr: '__POLY__' + profileId };
  if (op === 'revolve') {
    g = addCall(g, 'r_revolve', {
      profile: profileArg as any,
      segments: { kind: 'literal', value: 96 } as any,
    }).graph;
  } else if (op === 'loft') {
    // r_loft (stdlib) sig: profile · length · divs · twist · bulge · shape ·
    // segments. Defaults to a barrel bulge so the new node visibly differs
    // from a plain extrude. shape stays the engine default ('barrel') even if
    // the enum field reads blank in the card — it bakes via the default.
    g = addCall(g, 'r_loft', {
      profile:  profileArg as any,
      length:   { kind: 'literal', value: 6 } as any,
      divs:     { kind: 'literal', value: 48 } as any,
      twist:    { kind: 'literal', value: 0 } as any,
      bulge:    { kind: 'literal', value: 0.4 } as any,
      shape:    { kind: 'literal', value: 'barrel' } as any,
      segments: { kind: 'literal', value: 48 } as any,
    }).graph;
  } else {
    // r_weld_extrude actual sig (stdlib/r_weld_extrude.ts meta.params):
    //   profile · length · divs · twist · taper · segments
    // Earlier draft used `height` (CrossSection.extrude arg name) which
    // didn't match meta.params → drift warning + bake skipped.
    g = addCall(g, 'r_weld_extrude', {
      profile: profileArg as any,
      length:   { kind: 'literal', value: 2 } as any,
      divs:     { kind: 'literal', value: 12 } as any,
      twist:    { kind: 'literal', value: 0 } as any,
      taper:    { kind: 'literal', value: 0 } as any,
      segments: { kind: 'literal', value: 32 } as any,
    }).graph;
  }
  return { graph: g, bakeBump: false };
}
