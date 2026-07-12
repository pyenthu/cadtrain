/**
 * warp-node.test.ts — the WARP / bend MODIFIER node (#36) at the GRAPH level.
 *
 * The geometry core (`warpManifoldAlongSpline`) is covered by warp-spline.test.ts;
 * this proves the node MODEL → EMIT → hydrate wiring: a graph with a `warp` node
 * wrapping a built solid + a wired spline emits `warpSpline(<child>, <path>, opts)`
 * referencing the spline's `resampleSpline` prelude const, and survives a
 * serialise → hydrate round-trip. Headless (no WASM); a LIVE end-to-end bend bake
 * is the SPLINE_BAKE_URL-gated block at the bottom.
 */
import { describe, it, expect } from 'vitest';
import { newGraph, hydrateGraph } from '../composition-graph-hydrate';
import {
  addSpline, setSplinePoints, addCall, addWarp, addWarpPlaceholder,
  setWarpChild, setWarpPath, setWarpRefine, setWarpStretch, setWarpValidate,
  removeNode,
} from '../composition-graph-mutate';
import { asExpr, asLiteral } from '../composition-graph-types';
import { exprBlockMember } from '../graph-exprs';
import { emitGraph, validateGraph } from '../composition-emit';

/** A box → spline → warp(box along spline) graph. Returns the ids we assert on. */
function buildWarpGraph(opts: { refine?: number; stretch?: boolean; validate?: boolean } = {}) {
  let g = newGraph();
  // The solid to bend — a simple cuboid engine call (any built solid works).
  const box = addCall(g, 'r_cuboid', { x: asLiteral(1), y: asLiteral(1), z: asLiteral(6) });
  g = box.graph;
  // The bend path — a 3-point spline.
  const sp = addSpline(g); g = sp.graph;
  g = setSplinePoints(g, sp.id, [[0, 0, 0], [3, 2, 0], [6, 0, 0]]);
  // The warp node: bend the box along the spline's output.
  const w = addWarp(g, box.id, asExpr(exprBlockMember(sp.id, 'path')));
  g = w.graph;
  if (opts.refine != null) g = setWarpRefine(g, w.id, asLiteral(opts.refine));
  if (opts.stretch) g = setWarpStretch(g, w.id, true);
  if (opts.validate) g = setWarpValidate(g, w.id, true);
  return { graph: g, boxId: box.id, splineId: sp.id, warpId: w.id };
}

describe('warp node — model + emit', () => {
  it('emits warpSpline(child, splinePath) referencing the spline prelude const', () => {
    const { graph, boxId, splineId } = buildWarpGraph();
    const { source, body, validationErrors } = emitGraph(graph, { id: 'warp_demo' });
    expect(validationErrors).toEqual([]);
    const member = exprBlockMember(splineId, 'path');
    // The spline still emits its resampleSpline prelude const...
    expect(source).toContain(`const ${member} = resampleSpline(`);
    // ...and the warp call bends the box along it.
    expect(body).toMatch(/warpSpline\([A-Za-z_$][\w$]*, _x_[a-z0-9_]+_path\)/);
    // The child var is the box's alias (a Call var).
    const boxAlias = (graph.nodes[boxId] as any).alias;
    expect(body).toContain(`warpSpline(${boxAlias}, ${member})`);
    // The warp is the OUTPUT — bound to a `_warp_obj_*` const then returned (the
    // box child is consumed by it, so the box doesn't double-return).
    expect(body).toMatch(/const (_warp_obj_\d+) = warpSpline\(/);
    expect(body).toMatch(/return _warp_obj_\d+;/);
  });

  it('emits the opts object only when a non-default lever is set', () => {
    // No opts → terse two-arg form.
    expect(emitGraph(buildWarpGraph().graph, { id: 'w' }).body)
      .toMatch(/warpSpline\([^,]+, [^,)]+\)/);
    // refine + stretch + validate → the opts object.
    const withOpts = emitGraph(buildWarpGraph({ refine: 4, stretch: true, validate: true }).graph, { id: 'w' }).body;
    expect(withOpts).toContain('refine: 4');
    expect(withOpts).toContain('stretch: true');
    expect(withOpts).toContain('validate: true');
  });

  it('emits xDiaScale / yScale build-time exaggeration when set — absent ⇒ byte-identical (N3)', () => {
    const base = buildWarpGraph();
    // Absent → NO scale opts in the emit (the golden gate).
    const noScale = emitGraph(base.graph, { id: 'w' }).body;
    expect(noScale).not.toContain('xDiaScale');
    expect(noScale).not.toContain('yScale');

    // Set both (SVTC display vocabulary: xDiaScale radial, yScale depth) → opts.
    const warp = base.graph.nodes[base.warpId] as any;
    const g2 = { ...base.graph, nodes: { ...base.graph.nodes, [base.warpId]: { ...warp, xDiaScale: asLiteral(6), yScale: asLiteral(0.17) } } };
    const emitted = emitGraph(g2, { id: 'w' });
    expect(emitted.body).toContain('xDiaScale: 6');
    expect(emitted.body).toContain('yScale: 0.17');

    // Round-trips through serialise → hydrate.
    const hydrated = hydrateGraph((emitted.meta as any).graph);
    const w = hydrated.nodes[base.warpId] as any;
    expect(w.xDiaScale).toEqual(asLiteral(6));
    expect(w.yScale).toEqual(asLiteral(0.17));
  });

  it('flags a missing bent-solid child as a validation error', () => {
    const { graph, id } = addWarpPlaceholder(newGraph());
    const errs = validateGraph(graph);
    expect(errs.some((e) => e.nodeId === id && e.slot === 'child')).toBe(true);
  });

  it('round-trips through serialise → hydrate (child, path, opts preserved)', () => {
    const { graph, warpId, splineId } = buildWarpGraph({ refine: 3, stretch: true, validate: true });
    const { meta } = emitGraph(graph, { id: 'warp_rt' });
    const hydrated = hydrateGraph((meta as any).graph);
    const w = hydrated.nodes[warpId] as any;
    expect(w?.type).toBe('warp');
    expect(w.path).toEqual(asExpr(exprBlockMember(splineId, 'path')));
    expect(w.refine).toEqual(asLiteral(3));
    expect(w.stretch).toBe(true);
    expect(w.validate).toBe(true);
    // Re-emit is stable.
    expect(emitGraph(hydrated, { id: 'warp_rt' }).body).toContain('warpSpline(');
  });

  it('setWarp* mutators + wire-child rebinding', () => {
    let g = newGraph();
    const box = addCall(g, 'r_cuboid', {}); g = box.graph;
    const { graph: g2, id: warpId } = addWarpPlaceholder(g); g = g2;
    g = setWarpChild(g, warpId, box.id);
    g = setWarpPath(g, warpId, asExpr('_x_n_test_path'));
    g = setWarpStretch(g, warpId, true);
    g = setWarpStretch(g, warpId, false); // sparse — drops the field
    const w = g.nodes[warpId] as any;
    expect(w.child).toBe(box.id);
    expect(w.path).toEqual(asExpr('_x_n_test_path'));
    expect('stretch' in w).toBe(false);
  });

  it('removing the bent solid cascade-removes the orphaned warp', () => {
    const { graph, boxId, warpId } = buildWarpGraph();
    const g = removeNode(graph, boxId);
    expect(g.nodes[boxId]).toBeUndefined();
    expect(g.nodes[warpId]).toBeUndefined(); // cascaded (mirrors mv/rot)
  });
});
