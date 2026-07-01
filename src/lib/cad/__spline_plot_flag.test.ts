/**
 * __spline_plot_flag.test.ts — the VIEW-ONLY spline PLOT flag (TODO #24).
 *
 * The `plot` flag drives the main-3D-bake diagnostic overlay; it must (a) toggle
 * via setSplinePlot, (b) stay SPARSE (absent when off ⇒ byte-identical emit),
 * (c) survive a hydrate round-trip, and (d) NOT change the emitted body.
 */
import { describe, it, expect } from 'vitest';
import { newGraph, addSpline, setSplinePlot, hydrateGraph } from './composition-graph';
import { emitSplineBlocks } from './composition-emit';

function splineGraph() {
  let g = newGraph();
  const made = addSpline(g);
  return { g: made.graph, id: made.id };
}

describe('spline plot flag (#24)', () => {
  it('setSplinePlot(true) sets plot; false deletes it (sparse)', () => {
    const { g, id } = splineGraph();
    expect((g.nodes[id] as any).plot).toBeUndefined();

    const on = setSplinePlot(g, id, true);
    expect((on.nodes[id] as any).plot).toBe(true);

    const off = setSplinePlot(on, id, false);
    expect('plot' in (off.nodes[id] as any)).toBe(false);
  });

  it('accepts + keeps a valid #rrggbb plotColor, drops junk on hydrate', () => {
    const { g, id } = splineGraph();
    const colored = setSplinePlot(g, id, true, '#ff8800');
    expect((colored.nodes[id] as any).plotColor).toBe('#ff8800');

    // junk plotColor is dropped by hydrate; valid survives
    const junk = { ...colored, nodes: { ...colored.nodes, [id]: { ...(colored.nodes[id] as any), plotColor: 'orange', plot: true } } };
    const h = hydrateGraph(JSON.parse(JSON.stringify(junk)));
    expect((h.nodes[id] as any).plotColor).toBeUndefined();
    expect((h.nodes[id] as any).plot).toBe(true);
  });

  it('hydrate keeps plot:true, drops plot:false / non-true', () => {
    const { g, id } = splineGraph();
    const on = setSplinePlot(g, id, true);
    const h = hydrateGraph(JSON.parse(JSON.stringify(on)));
    expect((h.nodes[id] as any).plot).toBe(true);

    const falsey = { ...g, nodes: { ...g.nodes, [id]: { ...(g.nodes[id] as any), plot: false } } };
    const h2 = hydrateGraph(JSON.parse(JSON.stringify(falsey)));
    expect('plot' in (h2.nodes[id] as any)).toBe(false);
  });

  it('plot flag does NOT change the emitted spline body (view-only)', () => {
    const { g, id } = splineGraph();
    const before = emitSplineBlocks(g).join('\n');
    const on = setSplinePlot(g, id, true, '#123456');
    const after = emitSplineBlocks(on).join('\n');
    expect(after).toBe(before);
  });
});
