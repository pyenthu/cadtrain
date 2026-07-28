/**
 * remove-node-scrub.test.ts — deleting a node must SCRUB every reference to it
 * so no dangling id survives into emit (throws `missingRef` → `client bake
 * failed: … references missing node "n_…"`) or validate (a Save-blocking
 * `missing-node` broken-reference banner + a TrueForm "(missing)" walk).
 *
 * Regression: removeNode filtered container `children[]` but LEFT a deleted id
 * inside a `repeat` / multi-input `warp` children[] (both fell through the old
 * switch's `else` / single-`child` arm), and never cleared a Call's `__POLY__`
 * profile ref. The fix scrubs EVERY ref-bearing field + cascade-removes orphaned
 * wrappers transitively.
 */
import { describe, it, expect } from 'vitest';
import { removeNode } from '$lib/graph/composition/composition-graph';
import { validateGraph, emitGraph } from '$lib/graph/composition/composition-emit';
import type { Graph, GraphNode, NodeId } from '$lib/graph/composition/composition-graph-types';
import { asLiteral, asExpr } from '$lib/graph/composition/composition-graph-types';

/** Every node id `n` references as an INPUT — the independent scanner the
 *  assertions use to prove NO node still points at the deleted id (mirrors the
 *  kinds' inputRefs across children[] · scalar child · method obj/arg · Call
 *  `__POLY__` profile · polygon/sketch repeat-ref sources). */
function refsOf(n: GraphNode): NodeId[] {
  const any = n as any;
  const refs: NodeId[] = [];
  if (Array.isArray(any.children)) refs.push(...any.children);
  if (any.child) refs.push(any.child);
  if (n.type === 'method') refs.push(any.obj, any.arg);
  if (n.type === 'call') {
    for (const v of Object.values(any.args ?? {})) {
      if ((v as any)?.kind === 'expr') {
        for (const m of String((v as any).expr).match(/__POLY__(n_[a-z0-9_]+)/gi) ?? []) {
          refs.push(m.slice('__POLY__'.length));
        }
      }
    }
  }
  for (const list of [any.points, any.ops]) {
    if (!Array.isArray(list)) continue;
    for (const e of list) {
      if (e && (e.kind === 'repeat-ref' || e.kind === 'expr-list-ref' || e.op === 'repeat-ref' || e.op === 'expr-list-ref') && e.sourceId) {
        refs.push(e.sourceId);
      }
    }
  }
  return refs.filter(Boolean);
}

function referencesAnywhere(g: Graph, id: NodeId): boolean {
  return Object.values(g.nodes).some((n) => refsOf(n).includes(id));
}

/** Build a minimal hand-wired graph — precise control over which node refs which. */
function mkGraph(rootId: NodeId, nodes: GraphNode[]): Graph {
  const map: Record<NodeId, GraphNode> = {};
  for (const n of nodes) map[n.id] = n;
  return { nodes: map, root: rootId, params: {}, edges: [], imports: [], layout: {} };
}

const call = (id: string, alias: string): GraphNode =>
  ({ id, type: 'call', src: 'r_cuboid', alias, args: {} });

/** The editor gates Save + the broken-ref banner + the bake on this list being
 *  empty (validateGraph == the same walk). Asserting it's [] post-delete is the
 *  headless proxy for "the banner clears + Save re-enables". */
function expectClean(g: Graph, id: string) {
  expect(referencesAnywhere(g, 'n_del')).toBe(false);        // no dangling ref to the deleted id
  expect(validateGraph(g)).toEqual([]);                       // zero broken references → Save re-enables
  const emitted = emitGraph(g, { id });
  expect(emitted.validationErrors).toEqual([]);
  expect(emitted.body).not.toContain('references missing node'); // no loud missingRef throw baked in
}

describe('removeNode — dangling-reference scrub', () => {
  it('the reported case: a container children[] AND an mv child both point at B → deleting B leaves nothing dangling', () => {
    // root(list) → [container(stack), mv];  container.children = [A, B];  mv.child = B
    const g = mkGraph('n_root', [
      { id: 'n_root', type: 'list', children: ['n_cont', 'n_mv'] },
      { id: 'n_cont', type: 'stack', children: ['n_a', 'n_del'] },
      { id: 'n_mv', type: 'mv', child: 'n_del', offset: [asLiteral(0), asLiteral(0), asLiteral(5)] },
      call('n_a', 'A'),
      call('n_del', 'B'),
    ]);
    // Pre-condition: the bug WOULD fire (both slots reference B).
    expect(validateGraph(g)).toEqual([]);            // wired graph is valid before delete

    const after = removeNode(g, 'n_del');
    expect(after.nodes['n_del']).toBeUndefined();
    expect(after.nodes['n_mv']).toBeUndefined();     // orphaned mv cascade-removed
    expect((after.nodes['n_cont'] as any).children).toEqual(['n_a']); // B filtered out of children[]
    expect((after.nodes['n_root'] as any).children).toEqual(['n_cont']); // removed mv scrubbed from root
    expectClean(after, 'reported_case');
  });

  it('repeat children[] (the actual `children[i]` shape) is filtered on delete', () => {
    // Pre-fix bug: a `repeat` fell through removeNode's `else` arm → its
    // children[] kept the deleted id → validate/emit reported children[i].
    const g = mkGraph('n_root', [
      { id: 'n_root', type: 'list', children: ['n_rep'] },
      { id: 'n_rep', type: 'repeat', children: ['n_a', 'n_del'], count: asLiteral(3) },
      call('n_a', 'A'),
      call('n_del', 'B'),
    ]);
    // Prove the pre-condition: WITHOUT the scrub, B is still referenced.
    expect(refsOf(g.nodes['n_rep'])).toContain('n_del');

    const after = removeNode(g, 'n_del');
    expect(after.nodes['n_del']).toBeUndefined();
    expect((after.nodes['n_rep'] as any).children).toEqual(['n_a']);
    expectClean(after, 'repeat_case');
  });

  it('multi-input warp children[] is filtered (single surviving child kept)', () => {
    const g = mkGraph('n_root', [
      { id: 'n_root', type: 'list', children: ['n_warp'] },
      { id: 'n_warp', type: 'warp', child: null, children: ['n_a', 'n_del'], path: asLiteral(0) },
      call('n_a', 'A'),
      call('n_del', 'B'),
    ]);
    const after = removeNode(g, 'n_del');
    expect(after.nodes['n_warp']).toBeDefined();     // still has a surviving solid → NOT orphaned
    expect((after.nodes['n_warp'] as any).children).toEqual(['n_a']);
    expectClean(after, 'warp_multi_case');
  });

  it('cascade is TRANSITIVE: box → mv → method(obj=mv) all vanish when box is deleted', () => {
    // Old single-pass removeNode would drop the mv but LEAVE the method dangling
    // to the now-removed mv (obj=n_mv). The fixpoint cascade removes both.
    const g = mkGraph('n_root', [
      { id: 'n_root', type: 'list', children: ['n_method', 'n_a'] },
      { id: 'n_method', type: 'method', op: 'subtract', obj: 'n_mv', arg: 'n_a' },
      { id: 'n_mv', type: 'mv', child: 'n_del', offset: [asLiteral(0), asLiteral(0), asLiteral(0)] },
      call('n_a', 'A'),
      call('n_del', 'B'),
    ]);
    const after = removeNode(g, 'n_del');
    expect(after.nodes['n_del']).toBeUndefined();
    expect(after.nodes['n_mv']).toBeUndefined();     // orphaned (child gone)
    expect(after.nodes['n_method']).toBeUndefined(); // TRANSITIVELY orphaned (obj gone)
    expect((after.nodes['n_root'] as any).children).toEqual(['n_a']);
    expectClean(after, 'transitive_case');
  });

  it('a Call `__POLY__` profile ref to a deleted polygon is scrubbed (reverts to default)', () => {
    const g = mkGraph('n_root', [
      { id: 'n_root', type: 'list', children: ['n_rev'] },
      { id: 'n_rev', type: 'call', src: 'r_revolve', alias: 'A',
        args: { profile: asExpr('__POLY__n_del'), segments: asLiteral(96) } },
      { id: 'n_del', type: 'polygon', points: [{ r: asLiteral(1), z: asLiteral(0) } as any] },
    ]);
    expect(refsOf(g.nodes['n_rev'])).toContain('n_del');

    const after = removeNode(g, 'n_del');
    expect(after.nodes['n_del']).toBeUndefined();
    expect((after.nodes['n_rev'] as any).args.profile).toBeUndefined(); // profile arg dropped
    expect((after.nodes['n_rev'] as any).args.segments).toBeDefined();  // unrelated args untouched
    expect(referencesAnywhere(after, 'n_del')).toBe(false);
    expect(validateGraph(after)).toEqual([]);
    expect(emitGraph(after, { id: 'poly_case' }).body).not.toContain('__POLY__'); // no dangling sentinel
  });
});
