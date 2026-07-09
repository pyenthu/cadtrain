import { describe, it, expect } from 'vitest';
import { spliceNodeIntoWire, canSplice, canSpliceInto, inputSlotOf, spliceWireKey, type SpliceWire } from './wire-splice';
import type { Graph } from '$lib/cad/composition-graph';

/** Minimal graph builder — root is a list container `r`. Mirrors
 *  wire-delete.test.ts; nodes carry just enough for the splice mutators +
 *  finalize (mv/rot need offset/rot arrays; call needs src/args; repeat a
 *  count). */
const g = (nodes: Record<string, any>, rootChildren: string[] = []): Graph =>
  ({ nodes: { r: { id: 'r', type: 'list', children: rootChildren }, ...nodes }, root: 'r', params: {}, edges: [], imports: [], layout: {} } as any);

const call = (id: string) => ({ id, type: 'call', src: 'x', alias: id.toUpperCase(), args: {} });
const mv = (id: string, child = '') => ({ id, type: 'mv', child, offset: [] });
const method = (id: string, obj = '', arg = '') => ({ id, type: 'method', op: 'add', obj, arg });

describe('spliceNodeIntoWire', () => {
  it('child: inserts D between S and a mv target (S→D, D→T)', () => {
    const graph = g({ m: mv('m', 's'), s: call('s'), d: mv('d') }, ['m', 'd']);
    const out = spliceNodeIntoWire(graph, 'd', { ref: { kind: 'child', nodeId: 'm' }, sourceId: 's' });
    expect((out.nodes.d as any).child).toBe('s'); // S feeds D
    expect((out.nodes.m as any).child).toBe('d'); // T now consumes D
    expect(out.nodes.s).toBeTruthy();             // source preserved
  });

  it('method: inserts D into the obj wire of a method target', () => {
    const graph = g({ mth: method('mth', 's', 'q'), s: call('s'), q: call('q'), d: method('d') }, ['mth', 'd']);
    const out = spliceNodeIntoWire(graph, 'd', { ref: { kind: 'method', nodeId: 'mth', slot: 'obj' }, sourceId: 's' });
    expect((out.nodes.d as any).obj).toBe('s');   // S feeds D's obj slot
    expect((out.nodes.mth as any).obj).toBe('d'); // T.obj now consumes D
    expect((out.nodes.mth as any).arg).toBe('q'); // other slot untouched
  });

  it('warp-child: inserts D into the i-th warp solid', () => {
    const graph = g({ w: { id: 'w', type: 'warp', child: 'a', children: ['a', 'b'], path: { kind: 'expr', expr: '_x_s_path' } }, a: call('a'), b: call('b'), d: mv('d') }, ['w', 'd']);
    const out = spliceNodeIntoWire(graph, 'd', { ref: { kind: 'warp-child', nodeId: 'w', index: 0 }, sourceId: 'a' });
    expect((out.nodes.d as any).child).toBe('a');           // S feeds D
    expect((out.nodes.w as any).children[0]).toBe('d');     // slot 0 → D
    expect((out.nodes.w as any).children[1]).toBe('b');     // sibling untouched
  });

  it('repeat-child: inserts D into the i-th repeat part', () => {
    const graph = g({ rp: { id: 'rp', type: 'repeat', children: ['a', 'b'], count: { kind: 'literal', value: 3 } }, a: call('a'), b: call('b'), d: mv('d') }, ['rp', 'd']);
    const out = spliceNodeIntoWire(graph, 'd', { ref: { kind: 'repeat-child', nodeId: 'rp', index: 1 }, sourceId: 'b' });
    expect((out.nodes.d as any).child).toBe('b');           // S feeds D
    expect((out.nodes.rp as any).children).toEqual(['a', 'd']); // slot 1 → D
  });

  it('container-child: inserts D into a stack slot + detaches D from root', () => {
    const graph = g({ st: { id: 'st', type: 'stack', children: ['s', 'x'] }, s: call('s'), x: call('x'), d: mv('d') }, ['st', 'd']);
    const out = spliceNodeIntoWire(graph, 'd', { ref: { kind: 'container-child', nodeId: 'st', index: 0 }, sourceId: 's' });
    expect((out.nodes.d as any).child).toBe('s');            // S feeds D
    expect((out.nodes.st as any).children).toEqual(['d', 'x']); // slot 0 → D
    expect((out.nodes.r as any).children).toEqual(['st']);   // D detached from root (no double-parent)
  });

  it('container-child: splicing into the ROOT output slot dedupes D', () => {
    // D ('d') is already a root child at index 1; target is root slot 0 (holds S).
    const graph = g({ s: call('s'), d: mv('d') }, ['s', 'd']);
    const out = spliceNodeIntoWire(graph, 'd', { ref: { kind: 'container-child', nodeId: 'r', index: 0 }, sourceId: 's' });
    expect((out.nodes.d as any).child).toBe('s');           // S feeds D
    expect((out.nodes.r as any).children).toEqual(['d']);   // D once only — old slot deduped
  });

  it('aborts (no-op) when the dragged node is a pure producer (no input slot)', () => {
    const graph = g({ m: mv('m', 's'), s: call('s'), d: call('d') }, ['m', 'd']);
    const out = spliceNodeIntoWire(graph, 'd', { ref: { kind: 'child', nodeId: 'm' }, sourceId: 's' });
    expect(out).toBe(graph);                       // unchanged reference
    expect((out.nodes.m as any).child).toBe('s');  // wire intact
  });

  it('no-op when D is already an endpoint of the wire', () => {
    const graph = g({ m: mv('m', 'd'), d: mv('d') }, ['m']);
    // dragged === source
    expect(spliceNodeIntoWire(graph, 'd', { ref: { kind: 'child', nodeId: 'm' }, sourceId: 'd' })).toBe(graph);
    // dragged === target
    expect(spliceNodeIntoWire(graph, 'm', { ref: { kind: 'child', nodeId: 'm' }, sourceId: 'd' })).toBe(graph);
  });

  it('rejects non-splice wire kinds (warp-path / material / call-arg)', () => {
    expect(canSpliceInto({ kind: 'warp-path', nodeId: 'w' })).toBe(false);
    expect(canSpliceInto({ kind: 'material', partId: 'c' })).toBe(false);
    expect(canSpliceInto({ kind: 'call-arg', nodeId: 'c', key: 'od' })).toBe(false);
    expect(canSpliceInto({ kind: 'child', nodeId: 'm' })).toBe(true);
    const graph = g({ w: { id: 'w', type: 'warp', child: 'a', path: { kind: 'expr', expr: 'p' } }, a: call('a'), d: mv('d') }, ['w', 'd']);
    expect(spliceNodeIntoWire(graph, 'd', { ref: { kind: 'warp-path', nodeId: 'w' }, sourceId: 'a' } as unknown as SpliceWire)).toBe(graph);
  });
});

describe('inputSlotOf / canSplice / spliceWireKey', () => {
  it('inputSlotOf: child for transforms/modifiers, obj for method, null for producers', () => {
    expect(inputSlotOf({ type: 'mv' } as any)).toBe('child');
    expect(inputSlotOf({ type: 'rot' } as any)).toBe('child');
    expect(inputSlotOf({ type: 'txfmn' } as any)).toBe('child');
    expect(inputSlotOf({ type: 'cutaway' } as any)).toBe('child');
    expect(inputSlotOf({ type: 'warp' } as any)).toBe('child');
    expect(inputSlotOf({ type: 'method' } as any)).toBe('obj');
    expect(inputSlotOf({ type: 'call' } as any)).toBeNull();
    expect(inputSlotOf({ type: 'polygon' } as any)).toBeNull();
    expect(inputSlotOf(undefined)).toBeNull();
  });

  it('canSplice: false for missing source / producer / self-endpoint', () => {
    const graph = g({ m: mv('m', 's'), s: call('s'), d: mv('d'), p: call('p') }, ['m', 'd']);
    expect(canSplice(graph, 'd', { ref: { kind: 'child', nodeId: 'm' }, sourceId: 's' })).toBe(true);
    expect(canSplice(graph, 'p', { ref: { kind: 'child', nodeId: 'm' }, sourceId: 's' })).toBe(false); // p is a producer
    expect(canSplice(graph, 'd', { ref: { kind: 'child', nodeId: 'm' }, sourceId: 'nope' })).toBe(false); // no such source
    expect(canSplice(graph, 'd', { ref: { kind: 'child', nodeId: 'm' }, sourceId: 'd' })).toBe(false); // self
  });

  it('spliceWireKey: stable, distinguishes slot + source', () => {
    expect(spliceWireKey({ ref: { kind: 'child', nodeId: 'm' }, sourceId: 's' })).toBe('child:m::s');
    expect(spliceWireKey({ ref: { kind: 'method', nodeId: 'x', slot: 'arg' }, sourceId: 'y' })).toBe('method:x:arg:y');
    expect(spliceWireKey({ ref: { kind: 'warp-child', nodeId: 'w', index: 2 }, sourceId: 'a' })).toBe('warp-child:w:2:a');
  });
});
