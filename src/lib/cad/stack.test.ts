/**
 * stack.test.ts — stack() per-part STACK REFERENCE behaviour + emit/hydrate
 * round-trip of the reserved `stack_ref` param.
 *
 * Covers:
 *   1. absent _stackRef → end-to-end mating (the historical behaviour).
 *   2. explicit positive _stackRef → advance the cursor by that value.
 *   3. negative _stackRef → no advance; the next part coincides (same datum).
 *   4. the empty-child guard is preserved.
 *   5. emitGraph stamps `_stackRef` only when the graph opts into stack_ref,
 *      and serialiseGraph round-trips the param.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initManifold, stack, zMin, zMax, zLen, M } from './manifold-helpers';
import { emitGraph } from './composition-emit';
import { hydrateGraph, addStackRef, removeParam, hasStackRef, STACK_REF_PARAM, newGraph } from './composition-graph';

beforeAll(async () => {
  await initManifold();
});

/** A unit-footprint box of axial length `len`, sitting at z = 0..len. */
function box(len: number): any {
  return M.cube([1, 1, len]); // not centred → min corner at origin
}

describe('stack() — stack reference (per-part mate control)', () => {
  it('absent _stackRef → end-to-end (current behaviour)', () => {
    const result = stack([box(2), box(3)]);
    // A at 0..2, B mated at A's tail (2) → 2..5. Total 0..5.
    expect(zMin(result)).toBeCloseTo(0, 5);
    expect(zMax(result)).toBeCloseTo(5, 5);
    expect(zLen(result)).toBeCloseTo(5, 5);
  });

  it('explicit positive _stackRef → advance the cursor by that value', () => {
    const a = box(2);
    a._stackRef = 5; // advance 5 from where A was placed, regardless of A's length
    const result = stack([a, box(3)]);
    // A at 0..2, cursor advances by 5 → B at 5..8. Total 0..8.
    expect(zMin(result)).toBeCloseTo(0, 5);
    expect(zMax(result)).toBeCloseTo(8, 5);
  });

  it('negative _stackRef → no advance; next part coincides (same datum)', () => {
    const a = box(2);
    a._stackRef = -1; // keep the same offset — do not advance
    const result = stack([a, box(2)]);
    // A at 0..2, cursor stays at 0 → B placed at 0 too → both occupy 0..2.
    expect(zMin(result)).toBeCloseTo(0, 5);
    expect(zMax(result)).toBeCloseTo(2, 5);
    expect(zLen(result)).toBeCloseTo(2, 5);
  });

  it('_stackRef === 0 behaves identically to absent (end-to-end)', () => {
    const a = box(2); a._stackRef = 0;
    const result = stack([a, box(3)]);
    expect(zMax(result)).toBeCloseTo(5, 5);
  });

  it('chains: negative then default mate from the shared datum', () => {
    const a = box(2);
    const b = box(2); b._stackRef = -1; // B overlaps A, and does not advance
    const c = box(2);
    const result = stack([a, b, c]);
    // A 0..2 (cursor→2). B placed at 2 (2..4) but negative → cursor stays 2.
    // C placed at 2 → 2..4. Total 0..4.
    expect(zMin(result)).toBeCloseTo(0, 5);
    expect(zMax(result)).toBeCloseTo(4, 5);
  });

  it('preserves the empty-child guard', () => {
    // An empty manifold (subtract removing everything) → degenerate bbox.
    const emptyM = box(2).subtract(box(3));
    expect(() => stack([box(2), emptyM])).toThrow(/EMPTY or invalid geometry/);
  });
});

describe('emitGraph — stack_ref stamping + round-trip', () => {
  function graphWithCall() {
    // Minimal graph: one Call whose result is the single root output.
    let g = newGraph();
    const id = 'n_call01';
    g = {
      ...g,
      nodes: {
        ...g.nodes,
        [id]: { id, type: 'call', src: 'r_cuboid', alias: 'A', args: {} },
      },
    };
    // Wire the call as the root list's only child.
    const root = g.nodes[g.root] as any;
    g = { ...g, nodes: { ...g.nodes, [g.root]: { ...root, children: [id] } } };
    return g;
  }

  it('does NOT stamp _stackRef when the part has not opted in', () => {
    const g = graphWithCall();
    const { source } = emitGraph(g, { id: 'p_test' });
    expect(source).not.toContain('_stackRef');
  });

  it('stamps _stackRef (with default fallback) once opted in', () => {
    let g = graphWithCall();
    g = addStackRef(g, -1);
    const { source, meta } = emitGraph(g, { id: 'p_test' });
    // The param is in meta.params.
    expect((meta.params as any)[STACK_REF_PARAM]).toBeTruthy();
    expect((meta.params as any)[STACK_REF_PARAM].default).toBe(-1);
    // The body stamps the resolved value with the part's own default fallback.
    expect(source).toContain('_stackRef = (p.stack_ref ?? -1)');
  });

  it('round-trips the stack_ref param through emit → hydrate', () => {
    let g = graphWithCall();
    g = addStackRef(g, 2.5);
    const { meta } = emitGraph(g, { id: 'p_test' });
    const rehydrated = hydrateGraph((meta as any).graph);
    expect(hasStackRef(rehydrated)).toBe(true);
    expect(rehydrated.params[STACK_REF_PARAM]!.default).toBe(2.5);
  });

  it('removeParam refuses the reserved stack_ref', () => {
    let g = graphWithCall();
    g = addStackRef(g);
    const r = removeParam(g, STACK_REF_PARAM);
    expect(r.orphans.length).toBeGreaterThan(0);
    expect(hasStackRef(r.graph)).toBe(true); // unchanged
  });
});
