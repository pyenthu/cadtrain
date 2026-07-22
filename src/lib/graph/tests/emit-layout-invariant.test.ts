/**
 * emit-layout-invariant.test.ts (#994) — moving/resizing a node card is PURE VISUAL
 * layout and must NOT change the baked geometry, so the graph editor keys its
 * auto-bake on emitGraph's `body` (+ appearance meta), NOT the full `source`.
 *
 * This guards the load-bearing fact behind that fix: emitGraph's `body` (the geometry
 * function) is INVARIANT under a layout-only change, even though the `source` (which
 * embeds meta.graph.layout) differs. A real edit (an arg) DOES change the body.
 */
import { describe, it, expect } from 'vitest';
import { emitGraph } from '../composition-emit';
import type { Graph } from '../composition-graph-types';

const callGraph = (size: number, layout: Record<string, { x: number; y: number }>): Graph =>
  ({
    nodes: {
      r: { id: 'r', type: 'list', children: ['c'] },
      c: { id: 'c', type: 'call', src: 'g_block', alias: 'A', args: { size: { kind: 'literal', value: size } } },
    },
    root: 'r', params: {}, imports: [], edges: [], layout,
  } as any);

describe('#994 emit is layout-invariant in the BODY (not the source)', () => {
  const base = emitGraph(callGraph(5, { c: { x: 0, y: 0 } }), { id: 't' });
  const moved = emitGraph(callGraph(5, { c: { x: 500, y: 320 } }), { id: 't' });   // same graph, card dragged
  const edited = emitGraph(callGraph(9, { c: { x: 0, y: 0 } }), { id: 't' });       // an actual arg change

  it('a layout-only move leaves the geometry BODY byte-identical', () => {
    expect(moved.body).toBe(base.body);
  });

  it('but the SOURCE differs (it embeds meta.graph.layout) — which is why keying on source rebaked', () => {
    expect(moved.source).not.toBe(base.source);
    expect(moved.source).toContain('500');   // the moved x lands in the serialised layout
  });

  it('a real edit (an arg) DOES change the body — so genuine changes still re-bake', () => {
    expect(edited.body).not.toBe(base.body);
  });
});
