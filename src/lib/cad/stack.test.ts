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
import { hydrateGraph, addStackRef, removeParam, hasStackRef, STACK_REF_PARAM, newGraph, setStackChildRef, setStackChildCount, addCall, asLiteral, asParam } from './composition-graph';
import { withStackRef } from './manifold-helpers';

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

describe('withStackRef — per-child override helper', () => {
  it('re-stamps _stackRef, overriding the part-level value', () => {
    const a = box(2); a._stackRef = 0; // part says end-to-end…
    withStackRef(a, -1);               // …stack overrides to overlap
    const result = stack([a, box(2)]);
    // -1 wins → no advance → B coincides with A. Total 0..2.
    expect(zMax(result)).toBeCloseTo(2, 5);
  });

  it('is a no-op on non-objects and returns its arg', () => {
    expect(withStackRef(null, 3)).toBe(null);
    expect(withStackRef(undefined as any, 3)).toBe(undefined);
  });
});

describe('Stack node — per-child stack-ref OVERRIDE (model + emit)', () => {
  /** A graph whose ROOT is a stack node holding two Calls A and B. */
  function graphWithStack() {
    let g = newGraph();
    // Make the root list a stack so children mate via stack().
    const root = g.nodes[g.root] as any;
    g = { ...g, nodes: { ...g.nodes, [g.root]: { ...root, type: 'stack' } } };
    const ra = addCall(g, 'r_cuboid', {}, g.root); g = ra.graph;
    const rb = addCall(g, 'r_cuboid', {}, g.root); g = rb.graph;
    return { g, stackId: g.root, a: ra.id, b: rb.id };
  }

  it('setStackChildRef stores the override keyed by child id', () => {
    const { g, stackId, a } = graphWithStack();
    const g2 = setStackChildRef(g, stackId, a, -1);
    expect((g2.nodes[stackId] as any).childRefs[a]).toBe(-1);
  });

  it('null override clears → inherit (childRefs drops the key / map)', () => {
    const { g, stackId, a, b } = graphWithStack();
    let g2 = setStackChildRef(g, stackId, a, -1);
    g2 = setStackChildRef(g2, stackId, b, 4);
    g2 = setStackChildRef(g2, stackId, a, null); // clear A
    const refs = (g2.nodes[stackId] as any).childRefs;
    expect(a in refs).toBe(false);
    expect(refs[b]).toBe(4);
    // Clearing the last override removes the whole map.
    const g3 = setStackChildRef(g2, stackId, b, null);
    expect((g3.nodes[stackId] as any).childRefs).toBeUndefined();
  });

  it('emit wraps ONLY overridden children in withStackRef()', () => {
    const { g, stackId, a } = graphWithStack();
    const g2 = setStackChildRef(g, stackId, a, -1);
    const { source } = emitGraph(g2, { id: 'p_asm' });
    // The stack() call wraps A's expression but leaves B bare.
    expect(source).toContain('withStackRef(');
    expect(source).toContain(', -1)');
    // Exactly one wrap (B is not overridden).
    expect(source.match(/withStackRef\(/g)?.length).toBe(1);
  });

  it('no override → emit contains no withStackRef wrap', () => {
    const { g } = graphWithStack();
    const { source } = emitGraph(g, { id: 'p_asm' });
    expect(source).not.toContain('withStackRef');
  });

  it('round-trips childRefs through emit → hydrate', () => {
    const { g, stackId, a } = graphWithStack();
    const g2 = setStackChildRef(g, stackId, a, 2.5);
    const { meta } = emitGraph(g2, { id: 'p_asm' });
    const rehydrated = hydrateGraph((meta as any).graph);
    expect((rehydrated.nodes[stackId] as any).childRefs[a]).toBe(2.5);
  });
});

describe('Stack node — per-child COUNT (×N) (model + emit)', () => {
  /** A graph whose ROOT is a stack node holding two Calls A and B. */
  function graphWithStack() {
    let g = newGraph();
    const root = g.nodes[g.root] as any;
    g = { ...g, nodes: { ...g.nodes, [g.root]: { ...root, type: 'stack' } } };
    const ra = addCall(g, 'r_cuboid', {}, g.root); g = ra.graph;
    const rb = addCall(g, 'r_cuboid', {}, g.root); g = rb.graph;
    return { g, stackId: g.root, a: ra.id, b: rb.id };
  }

  it('setStackChildCount stores a literal count keyed by child id', () => {
    const { g, stackId, a } = graphWithStack();
    const g2 = setStackChildCount(g, stackId, a, asLiteral(3));
    expect((g2.nodes[stackId] as any).childCounts[a]).toEqual({ kind: 'literal', value: 3 });
  });

  it('a literal 1 clears (single copy = the default)', () => {
    const { g, stackId, a } = graphWithStack();
    let g2 = setStackChildCount(g, stackId, a, asLiteral(3));
    g2 = setStackChildCount(g2, stackId, a, asLiteral(1));
    expect((g2.nodes[stackId] as any).childCounts).toBeUndefined();
  });

  it('null clears → child reverts to a single copy; last clear drops the map', () => {
    const { g, stackId, a, b } = graphWithStack();
    let g2 = setStackChildCount(g, stackId, a, asLiteral(3));
    g2 = setStackChildCount(g2, stackId, b, asLiteral(2));
    g2 = setStackChildCount(g2, stackId, a, null); // clear A
    const counts = (g2.nodes[stackId] as any).childCounts;
    expect(a in counts).toBe(false);
    expect(counts[b]).toEqual({ kind: 'literal', value: 2 });
    const g3 = setStackChildCount(g2, stackId, b, null);
    expect((g3.nodes[stackId] as any).childCounts).toBeUndefined();
  });

  it('emit places N copies of a counted child (literal)', () => {
    const { g, stackId, a } = graphWithStack();
    const g2 = setStackChildCount(g, stackId, a, asLiteral(3));
    const { source } = emitGraph(g2, { id: 'p_asm' });
    // A spreads N copies of its build-once var; B stays bare.
    expect(source).toContain('...Array(Math.max(1, Math.floor(3) | 0)).fill(');
    expect(source).not.toContain('withStackRef'); // no ref override here
  });

  it('emit drives the count off a param (p.n)', () => {
    const { g, stackId, a } = graphWithStack();
    const g2 = setStackChildCount(g, stackId, a, asParam('n'));
    const { source } = emitGraph(g2, { id: 'p_asm' });
    expect(source).toContain('...Array(Math.max(1, Math.floor(p.n) | 0)).fill(');
  });

  it('count + stack-ref override composes withStackRef over each copy', () => {
    const { g, stackId, a } = graphWithStack();
    let g2 = setStackChildCount(g, stackId, a, asLiteral(3));
    g2 = setStackChildRef(g2, stackId, a, -1);
    const { source } = emitGraph(g2, { id: 'p_asm' });
    expect(source).toContain('.fill(0).map(() => withStackRef(');
    expect(source).toContain(', -1))');
  });

  it('absent count → emit unchanged (bare children, no Array spread)', () => {
    const { g } = graphWithStack();
    const { source } = emitGraph(g, { id: 'p_asm' });
    expect(source).not.toContain('...Array(');
  });

  it('round-trips childCounts through emit → hydrate', () => {
    const { g, stackId, a } = graphWithStack();
    const g2 = setStackChildCount(g, stackId, a, asLiteral(4));
    const { meta } = emitGraph(g2, { id: 'p_asm' });
    const rehydrated = hydrateGraph((meta as any).graph);
    expect((rehydrated.nodes[stackId] as any).childCounts[a]).toEqual({ kind: 'literal', value: 4 });
  });

  it('runtime: a counted child places N boxes mated end-to-end', () => {
    // Drive the emitted pattern directly to confirm N placements stack.
    const a = box(2);
    // mimic emit: build once, spread N copies, stack mates them end-to-end.
    const result = stack([...Array(Math.max(1, Math.floor(3) | 0)).fill(a)]);
    // 3 boxes of length 2 → 0..6.
    expect(zMin(result)).toBeCloseTo(0, 5);
    expect(zMax(result)).toBeCloseTo(6, 5);
  });

  it('runtime: count + negative stack-ref → copies overlap at the same datum', () => {
    const a = box(2);
    const result = stack([...Array(3).fill(0).map(() => withStackRef(a, -1))]);
    // negative ref = no advance → all 3 coincide at 0..2.
    expect(zMin(result)).toBeCloseTo(0, 5);
    expect(zMax(result)).toBeCloseTo(2, 5);
  });
});
