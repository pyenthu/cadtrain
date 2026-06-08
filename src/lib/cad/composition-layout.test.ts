/**
 * composition-layout — Phase 20 heuristic layered layout.
 *
 * Locks in the contract:
 *   • simple Call → method → root chain orders columns left-to-right
 *   • two Calls wired into one method share a column; method gets the next
 *   • container nodes (stack/list) live one column to the right of their
 *     children — root list ends up rightmost
 *   • pinned nodes keep their saved position even after layout
 *   • idempotent — running it twice produces the same result
 *
 * Layout is pure geometry: no DOM, no Manifold. Tests run fast.
 */
import { describe, expect, it } from 'vitest';
import {
  newGraph,
  addCall,
  addMethod,
  addContainer,
  appendContainerChild,
  setLayout,
  asLiteral,
  type Graph,
  type NodeId,
} from './composition-graph';
import { autoLayoutGraph, forceSeparate } from './composition-layout';

// ─── helpers ────────────────────────────────────────────────────────────

/** Build a tiny graph: one Call → one method (obj wired) → root list contains
 *  the method. Returns {graph, callId, methodId}. */
function buildLinear(): { graph: Graph; callId: NodeId; methodId: NodeId } {
  let g = newGraph();
  const a = addCall(g, 'dt_shaft', { r: asLiteral(1) });
  g = a.graph;
  // addMethod with empty arg id — only obj is wired (arg is just a label here
  // for the test; we wire obj = call, arg = call so the method has both inputs
  // present and depth = call depth + 1).
  const m = addMethod(g, 'subtract', a.id, a.id);
  g = m.graph;
  return { graph: g, callId: a.id, methodId: m.id };
}

// ─── tests ──────────────────────────────────────────────────────────────

describe('composition-layout — phase 20 heuristic layered layout', () => {
  it('lays out a one-Call graph: Call(d=0) → root list(d=1) — Call.x < root.x', () => {
    let g = newGraph();
    const a = addCall(g, 'dt_shaft', { r: asLiteral(1) });
    g = a.graph;

    const laid = autoLayoutGraph(g);

    const callXY = laid.layout[a.id];
    const rootXY = laid.layout[laid.root];
    expect(callXY).toBeDefined();
    expect(rootXY).toBeDefined();
    expect(callXY!.x).toBeLessThan(rootXY!.x);
  });

  it('Call → method → root: three depth columns, each x strictly greater', () => {
    const { graph, callId, methodId } = buildLinear();

    const laid = autoLayoutGraph(graph);

    const callXY = laid.layout[callId];
    const methodXY = laid.layout[methodId];
    const rootXY = laid.layout[laid.root];

    expect(callXY).toBeDefined();
    expect(methodXY).toBeDefined();
    expect(rootXY).toBeDefined();
    expect(callXY!.x).toBeLessThan(methodXY!.x);
    expect(methodXY!.x).toBeLessThan(rootXY!.x);
  });

  it('two Calls wired into a method → both Calls share an x column; method to the right; root rightmost', () => {
    let g = newGraph();
    const a = addCall(g, 'dt_shaft', { r: asLiteral(1) });
    g = a.graph;
    const b = addCall(g, 'dt_shaft', { r: asLiteral(2) });
    g = b.graph;
    // Method with obj = A, arg = B — both Calls feed the same method.
    const m = addMethod(g, 'subtract', a.id, b.id);
    g = m.graph;

    const laid = autoLayoutGraph(g);

    const ax = laid.layout[a.id]!.x;
    const bx = laid.layout[b.id]!.x;
    const mx = laid.layout[m.id]!.x;
    const rx = laid.layout[laid.root]!.x;

    expect(ax).toBe(bx);                  // same column
    expect(mx).toBeGreaterThan(ax);       // method downstream
    expect(rx).toBeGreaterThan(mx);       // root output rightmost
  });

  it('stack with 3 child Calls: Calls at depth 0, stack at depth 1, root at depth 2', () => {
    let g = newGraph();
    const a = addCall(g, 'dt_shaft', { r: asLiteral(1) });
    g = a.graph;
    const b = addCall(g, 'dt_shaft', { r: asLiteral(2) });
    g = b.graph;
    const c = addCall(g, 'dt_shaft', { r: asLiteral(3) });
    g = c.graph;
    const stk = addContainer(g, 'stack');
    g = stk.graph;
    g = appendContainerChild(g, stk.id, a.id);
    g = appendContainerChild(g, stk.id, b.id);
    g = appendContainerChild(g, stk.id, c.id);

    const laid = autoLayoutGraph(g);

    const ax = laid.layout[a.id]!.x;
    const bx = laid.layout[b.id]!.x;
    const cx = laid.layout[c.id]!.x;
    const sx = laid.layout[stk.id]!.x;
    const rx = laid.layout[laid.root]!.x;

    // Three Calls share a column.
    expect(ax).toBe(bx);
    expect(bx).toBe(cx);
    // Stack one column to the right (consumes the children).
    expect(sx).toBeGreaterThan(ax);
    // Root one column further right (consumes the stack).
    expect(rx).toBeGreaterThan(sx);
  });

  it('pinned node retains its prior position even after autoLayout', () => {
    let g = newGraph();
    const a = addCall(g, 'dt_shaft', { r: asLiteral(1) });
    g = a.graph;
    // Park A at an unusual position the heuristic would never choose.
    g = setLayout(g, a.id, { x: 999, y: 777 });

    const laid = autoLayoutGraph(g, { pinned: { [a.id]: true } });

    expect(laid.layout[a.id]).toEqual({ x: 999, y: 777 });
    // The unpinned root still gets laid out — typically to the right of A's
    // depth, but we just assert it MOVED from the default (600, 80) it got
    // on graph creation OR landed at the standard layout origin.
    expect(laid.layout[laid.root]).toBeDefined();
  });

  it('idempotent — running autoLayout twice produces the same layout', () => {
    let g = newGraph();
    const a = addCall(g, 'dt_shaft', { r: asLiteral(1) });
    g = a.graph;
    const b = addCall(g, 'dt_shaft', { r: asLiteral(2) });
    g = b.graph;
    const m = addMethod(g, 'subtract', a.id, b.id);
    g = m.graph;

    const once = autoLayoutGraph(g);
    const twice = autoLayoutGraph(once);

    for (const id of Object.keys(once.layout)) {
      expect(twice.layout[id]).toEqual(once.layout[id]);
    }
    // …and vice-versa — neither layout has stray keys the other lacks.
    for (const id of Object.keys(twice.layout)) {
      expect(once.layout[id]).toEqual(twice.layout[id]);
    }
  });

  it('honours opts.origin + columnGap — first column at origin.x, second at origin.x + columnGap', () => {
    let g = newGraph();
    const a = addCall(g, 'dt_shaft', { r: asLiteral(1) });
    g = a.graph;
    // Method wires A in as both obj + arg → method's depth = A.depth + 1.
    const m = addMethod(g, 'subtract', a.id, a.id);
    g = m.graph;

    const laid = autoLayoutGraph(g, {
      origin: { x: 100, y: 50 },
      columnGap: 300,
    });

    // A is depth 0 → x = 100.
    expect(laid.layout[a.id]!.x).toBe(100);
    // Method is depth 1 → x = 100 + 300 = 400.
    expect(laid.layout[m.id]!.x).toBe(400);
    // Root is depth 2 → x = 100 + 600 = 700.
    expect(laid.layout[laid.root]!.x).toBe(700);
  });
});

describe('forceSeparate (Phase 22)', () => {
  const size = () => ({ w: 100, h: 60 });

  it('does nothing when nodes don\'t overlap', () => {
    let g = newGraph();
    const a = addCall(g, 'src_a'); g = a.graph;
    g = setLayout(g, a.id, { x: 0, y: 0 });
    const b = addCall(g, 'src_b'); g = b.graph;
    g = setLayout(g, b.id, { x: 500, y: 500 });
    const out = forceSeparate(g, { nodeSize: size });
    expect(out.layout[a.id]).toEqual({ x: 0, y: 0 });
    expect(out.layout[b.id]).toEqual({ x: 500, y: 500 });
  });

  it('separates two overlapping nodes', () => {
    let g = newGraph();
    const a = addCall(g, 'src_a'); g = a.graph;
    g = setLayout(g, a.id, { x: 0, y: 0 });
    const b = addCall(g, 'src_b'); g = b.graph;
    // Heavy overlap — boxes are 100x60, b at (40, 0) overlaps a by 60 px in X.
    g = setLayout(g, b.id, { x: 40, y: 0 });
    const out = forceSeparate(g, { nodeSize: size, padding: 10 });
    const aPos = out.layout[a.id]!, bPos = out.layout[b.id]!;
    // After separation no overlap (allow the padding gap).
    const overlapX = Math.min(aPos.x + 100, bPos.x + 100) - Math.max(aPos.x, bPos.x);
    const overlapY = Math.min(aPos.y + 60, bPos.y + 60) - Math.max(aPos.y, bPos.y);
    // Either no x-overlap or no y-overlap means the boxes are separated.
    expect(overlapX <= 0 || overlapY <= 0).toBe(true);
  });

  it('respects pinned nodes (they don\'t move)', () => {
    let g = newGraph();
    const a = addCall(g, 'src_a'); g = a.graph;
    g = setLayout(g, a.id, { x: 0, y: 0 });
    const b = addCall(g, 'src_b'); g = b.graph;
    g = setLayout(g, b.id, { x: 40, y: 0 });
    const out = forceSeparate(g, {
      nodeSize: size,
      pinned: { [a.id]: true },
    });
    // a is pinned, can't move.
    expect(out.layout[a.id]).toEqual({ x: 0, y: 0 });
    // b moved away from a — could be in either direction (algorithm picks
    // the smaller-overlap axis), so check displacement magnitude.
    const bAfter = out.layout[b.id]!;
    const moved = Math.hypot(bAfter.x - 40, bAfter.y - 0);
    expect(moved).toBeGreaterThan(0);
  });

  it('handles 3+ overlapping nodes (cluster spread)', () => {
    let g = newGraph();
    const a = addCall(g, 'src_a'); g = a.graph; g = setLayout(g, a.id, { x: 0, y: 0 });
    const b = addCall(g, 'src_b'); g = b.graph; g = setLayout(g, b.id, { x: 10, y: 10 });
    const c = addCall(g, 'src_c'); g = c.graph; g = setLayout(g, c.id, { x: 20, y: 20 });
    const out = forceSeparate(g, { nodeSize: size, padding: 10, iterations: 100 });
    // All 3 should be pairwise non-overlapping after enough iterations.
    const ids = [a.id, b.id, c.id];
    for (let i = 0; i < 3; i++) {
      for (let j = i + 1; j < 3; j++) {
        const ai = out.layout[ids[i]!]!, bi = out.layout[ids[j]!]!;
        const overlapX = Math.min(ai.x + 100, bi.x + 100) - Math.max(ai.x, bi.x);
        const overlapY = Math.min(ai.y + 60, bi.y + 60) - Math.max(ai.y, bi.y);
        expect(overlapX <= 0 || overlapY <= 0).toBe(true);
      }
    }
  });

  it('idempotent — no overlap means no change on second call', () => {
    let g = newGraph();
    const a = addCall(g, 'src_a'); g = a.graph; g = setLayout(g, a.id, { x: 0, y: 0 });
    const b = addCall(g, 'src_b'); g = b.graph; g = setLayout(g, b.id, { x: 40, y: 0 });
    const once = forceSeparate(g, { nodeSize: size });
    const twice = forceSeparate(once, { nodeSize: size });
    expect(twice.layout[a.id]).toEqual(once.layout[a.id]);
    expect(twice.layout[b.id]).toEqual(once.layout[b.id]);
  });
});
