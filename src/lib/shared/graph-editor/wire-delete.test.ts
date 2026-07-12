import { describe, it, expect } from 'vitest';
import { unwireGraph, describeWireRef, type WireRef } from './wire-delete';
import type { Graph } from '$lib/graph/composition-graph';

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

  it('describeWireRef: readable labels', () => {
    const graph = g({ w: { id: 'w', type: 'warp' }, c: { id: 'c', type: 'call', src: 'x', alias: 'C', args: {} } });
    expect(describeWireRef(graph, { kind: 'warp-path', nodeId: 'w' })).toBe('path → warp');
    expect(describeWireRef(graph, { kind: 'call-arg', nodeId: 'c', key: 'od' })).toBe('od → C');
  });
});
