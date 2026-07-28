import { describe, it, expect } from 'vitest';
import { unwireGraph, describeWireRef, containerChildRef, type WireRef } from '../wire-delete';
import type { Graph } from '$lib/graph/composition/composition-graph';

/** Minimal graph builder — enough for the unwire mutators (which read/spread the
 *  named node + finalize). root is a list container. */
const g = (nodes: Record<string, any>, params: Record<string, any> = {}): Graph =>
  ({ nodes: { r: { id: 'r', type: 'list', children: [] }, ...nodes }, root: 'r', params, edges: [], imports: [], layout: {} } as any);

describe('unwireGraph', () => {
  it('child: clears a mv/cutaway/warp single child', () => {
    const graph = g({ m: { id: 'm', type: 'mv', child: 'c', offset: [] }, c: { id: 'c', type: 'call', src: 'x', args: {} } });
    const out = unwireGraph(graph, { kind: 'child', nodeId: 'm' });
    expect((out.nodes.m as any).child).toBeFalsy();
    expect(out.nodes.c).toBeTruthy(); // source node preserved (unreferenced)
  });

  it('method: clears obj / arg input', () => {
    const graph = g({ mth: { id: 'mth', type: 'method', method: 'add', obj: 'a', arg: 'b' }, a: { id: 'a', type: 'call', src: 'x', args: {} }, b: { id: 'b', type: 'call', src: 'y', args: {} } });
    expect((unwireGraph(graph, { kind: 'method', nodeId: 'mth', slot: 'obj' }).nodes.mth as any).obj).toBeFalsy();
    expect((unwireGraph(graph, { kind: 'method', nodeId: 'mth', slot: 'arg' }).nodes.mth as any).arg).toBeFalsy();
  });

  it('warp-child: removes the i-th solid, collapses to single child at ≤1', () => {
    const graph = g({ w: { id: 'w', type: 'warp', child: 'a', children: ['a', 'b'], path: { kind: 'expr', expr: 'p' } }, a: { id: 'a', type: 'call', src: 'x', args: {} }, b: { id: 'b', type: 'call', src: 'y', args: {} } });
    const out = unwireGraph(graph, { kind: 'warp-child', nodeId: 'w', index: 0 });
    const w = out.nodes.w as any;
    expect(w.children).toBeUndefined();      // collapsed
    expect(w.child).toBe('b');               // survivor
  });

  it('warp-path: clears the spline path', () => {
    const graph = g({ w: { id: 'w', type: 'warp', child: 'a', path: { kind: 'expr', expr: '_x_s_path' } }, a: { id: 'a', type: 'call', src: 'x', args: {} } });
    expect((unwireGraph(graph, { kind: 'warp-path', nodeId: 'w' }).nodes.w as any).path).toBeFalsy();
  });

  it('call-arg: a param wire resets to the param default; expr/node-ref → 0', () => {
    const graph = g(
      { c: { id: 'c', type: 'call', src: 'x', args: { od: { kind: 'param', param: 'p_od' }, len: { kind: 'expr', expr: '__POLY__n_z' } } } },
      { p_od: { default: 7 } },
    );
    const a = unwireGraph(graph, { kind: 'call-arg', nodeId: 'c', key: 'od' });
    expect((a.nodes.c as any).args.od).toEqual({ kind: 'literal', value: 7 });
    const b = unwireGraph(graph, { kind: 'call-arg', nodeId: 'c', key: 'len' });
    expect((b.nodes.c as any).args.len).toEqual({ kind: 'literal', value: 0 });
  });

  it('material: unbinds the part→material binding', () => {
    const graph = { ...g({ c: { id: 'c', type: 'call', src: 'x', args: {} }, mat: { id: 'mat', type: 'material' } }), materialBindings: { c: 'mat' } } as any;
    const out = unwireGraph(graph, { kind: 'material', partId: 'c' }) as any;
    expect(out.materialBindings?.c).toBeUndefined();
  });

  it('container-child: deletes the CLICKED output wire, not a sibling shifted by a consumed child', () => {
    // Root Output collects [A, B, C]. B is consumed (wired into a method), so
    // the root card FILTERS it out of its visible slots → visible = [A, C].
    // C therefore renders at visible index 1 but is children[2]. Clicking C's
    // wire must delete C, not children[1] (=B) — the reported "multi-part card"
    // bug where deleting one connector removed a different one.
    const graph = g({
      A: { id: 'A', type: 'call', src: 'x', args: {} },
      B: { id: 'B', type: 'call', src: 'y', args: {} },
      C: { id: 'C', type: 'call', src: 'z', args: {} },
      m: { id: 'm', type: 'method', op: 'add', obj: 'B', arg: 'B' },
      r: { id: 'r', type: 'list', children: ['A', 'B', 'C'] },
    });

    // The UI builds the ref from the CHILD, so it resolves C's TRUE index (2).
    const ref = containerChildRef(graph, 'r', 'C');
    expect(ref).toEqual({ kind: 'container-child', nodeId: 'r', index: 2 });

    const out = unwireGraph(graph, ref);
    expect((out.nodes.r as any).children).toEqual(['A', 'B']); // exactly C removed

    // Regression pin: the OLD ref used the VISIBLE loop index (1 for C), which
    // removes children[1] (=B) — the wrong wire. Keep this asserting the bug so
    // any revert to a visible-index ref fails loudly.
    const buggy = unwireGraph(graph, { kind: 'container-child', nodeId: 'r', index: 1 });
    expect((buggy.nodes.r as any).children).toEqual(['A', 'C']); // WRONG child gone
  });

  it('containerChildRef: -1 for an absent child / missing container', () => {
    const graph = g({ r: { id: 'r', type: 'list', children: ['A'] }, A: { id: 'A', type: 'call', src: 'x', args: {} } });
    expect(containerChildRef(graph, 'r', 'A').kind === 'container-child' && (containerChildRef(graph, 'r', 'A') as any).index).toBe(0);
    expect((containerChildRef(graph, 'r', 'Z') as any).index).toBe(-1);
    expect((containerChildRef(graph, 'nope', 'A') as any).index).toBe(-1);
  });

  it('describeWireRef: readable labels', () => {
    const graph = g({ w: { id: 'w', type: 'warp' }, c: { id: 'c', type: 'call', src: 'x', alias: 'C', args: {} } });
    expect(describeWireRef(graph, { kind: 'warp-path', nodeId: 'w' })).toBe('path → warp');
    expect(describeWireRef(graph, { kind: 'call-arg', nodeId: 'c', key: 'od' })).toBe('od → C');
  });
});
