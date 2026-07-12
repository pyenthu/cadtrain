/**
 * cutaway-node.test.ts — the CUTAWAY / cross-section MODIFIER node at the GRAPH
 * level.
 *
 * The geometry core (`sectionCut` in manifold-helpers.ts) subtracts an angular
 * wedge; this proves the node MODEL → EMIT → hydrate wiring: a graph with a
 * `cutaway` node wrapping a built solid emits `sectionCut(<child>, { az, offset })`
 * and survives a serialise → hydrate round-trip. Headless (no WASM).
 */
import { describe, it, expect } from 'vitest';
import { newGraph, hydrateGraph } from './composition-graph-hydrate';
import {
  addCall, addCutaway, addCutawayPlaceholder,
  setCutawayChild, setCutawayAz, setCutawayOffset, removeNode,
} from './composition-graph-mutate';
import { asLiteral, asParam } from './composition-graph-types';
import { emitGraph, validateGraph } from './composition-emit';

/** A shaft → cutaway(shaft) graph. Returns the ids we assert on. */
function buildCutawayGraph(opts: { az?: number; offset?: number } = {}) {
  let g = newGraph();
  // The solid to section — a g_shaft call (any built solid works).
  const shaft = addCall(g, 'g_shaft', {});
  g = shaft.graph;
  const c = addCutaway(g, shaft.id, asLiteral(opts.az ?? 180), asLiteral(opts.offset ?? 0));
  g = c.graph;
  return { graph: g, shaftId: shaft.id, cutId: c.id };
}

describe('cutaway node — model + emit', () => {
  it('emits sectionCut(child, { az, offset }) referencing the built solid', () => {
    const { graph, shaftId, cutId } = buildCutawayGraph({ az: 90, offset: 12 });
    const { body, validationErrors } = emitGraph(graph, { id: 'cutaway_demo' });
    expect(validationErrors).toEqual([]);
    const shaftAlias = (graph.nodes[shaftId] as any).alias;
    expect(body).toContain(`sectionCut(${shaftAlias}, { az: 90, offset: 12 })`);
    // The cutaway is the OUTPUT — bound to a `_cut_obj_*` const then returned
    // (the shaft child is consumed by it, so the shaft doesn't double-return).
    expect(body).toMatch(/const (_cut_obj_\d+) = sectionCut\(/);
    expect(body).toMatch(/return _cut_obj_\d+;/);
    expect(cutId).toBeTruthy();
  });

  it('defaults to a 180° half-section at offset 0', () => {
    expect(emitGraph(buildCutawayGraph().graph, { id: 'c' }).body)
      .toContain('sectionCut(');
    expect(emitGraph(buildCutawayGraph().graph, { id: 'c' }).body)
      .toContain('{ az: 180, offset: 0 }');
  });

  it('flags a missing sectioned child as a validation error', () => {
    const { graph, id } = addCutawayPlaceholder(newGraph());
    const errs = validateGraph(graph);
    expect(errs.some((e) => e.nodeId === id && e.slot === 'child')).toBe(true);
  });

  it('round-trips through serialise → hydrate (child, az, offset preserved)', () => {
    const { graph, cutId } = buildCutawayGraph({ az: 270, offset: 5 });
    const { meta } = emitGraph(graph, { id: 'cutaway_rt' });
    const hydrated = hydrateGraph((meta as any).graph);
    const c = hydrated.nodes[cutId] as any;
    expect(c?.type).toBe('cutaway');
    expect(c.az).toEqual(asLiteral(270));
    expect(c.offset).toEqual(asLiteral(5));
    expect(emitGraph(hydrated, { id: 'cutaway_rt' }).body).toContain('sectionCut(');
  });

  it('setCutaway* mutators + wire-child rebinding', () => {
    let g = newGraph();
    const box = addCall(g, 'r_cuboid', {}); g = box.graph;
    const { graph: g2, id: cutId } = addCutawayPlaceholder(g); g = g2;
    g = setCutawayChild(g, cutId, box.id);
    g = setCutawayAz(g, cutId, asParam('sweep'));
    g = setCutawayOffset(g, cutId, asLiteral(8));
    const c = g.nodes[cutId] as any;
    expect(c.child).toBe(box.id);
    expect(c.az).toEqual(asParam('sweep'));
    expect(c.offset).toEqual(asLiteral(8));
  });

  it('removing the sectioned solid cascade-removes the orphaned cutaway', () => {
    const { graph, shaftId, cutId } = buildCutawayGraph();
    const g = removeNode(graph, shaftId);
    expect(g.nodes[shaftId]).toBeUndefined();
    expect(g.nodes[cutId]).toBeUndefined(); // cascaded (mirrors mv/rot/warp)
  });
});
