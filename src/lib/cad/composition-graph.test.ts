/**
 * composition-graph + composition-emit Phase A smoke test.
 *
 * The mule_shoe case-study contract from docs/plans/composition-architecture.md
 * (12 steps) tested at the data layer. Phase B (bake) + Phase C (editor)
 * extend this — emit-correctness is the foundation.
 */
import { describe, expect, it } from 'vitest';
import {
  newGraph,
  addCall,
  addContainer,
  addParam,
  wireArg,
  unwireArg,
  removeParam,
  setCallArg,
  removeNode,
  collectEdges,
  slotsForParam,
  asLiteral,
  asParam,
  nextAlias,
  takenAliases,
} from './composition-graph';
import { emitGraph } from './composition-emit';

describe('composition-graph — mule_shoe case study (Phase A)', () => {
  it('starts with an empty root list', () => {
    const g = newGraph();
    expect(Object.keys(g.nodes).length).toBe(1);
    expect(g.nodes[g.root]?.type).toBe('list');
    expect(g.params).toEqual({});
    expect(g.edges).toEqual([]);
  });

  it('drops two dt_mule_shoe instances → A and B with literal defaults (Steps 1-4)', () => {
    let g = newGraph();
    const a = addCall(g, 'dt_mule_shoe', {
      pipeOD: asLiteral(3.56), boxOD: asLiteral(4.0), wall: asLiteral(0.28),
      boxLen: asLiteral(3),    bodyLen: asLiteral(6), cutAngle: asLiteral(45),
      segments: asLiteral(96),
    });
    g = a.graph;
    const b = addCall(g, 'dt_mule_shoe', {
      pipeOD: asLiteral(4.5),  boxOD: asLiteral(5.25), wall: asLiteral(0.31),
      boxLen: asLiteral(3),    bodyLen: asLiteral(8),  cutAngle: asLiteral(30),
      segments: asLiteral(96),
    });
    g = b.graph;
    const callA = g.nodes[a.id];
    const callB = g.nodes[b.id];
    expect(callA?.type).toBe('call');
    expect(callB?.type).toBe('call');
    if (callA?.type === 'call' && callB?.type === 'call') {
      expect(callA.alias).toBe('A');
      expect(callB.alias).toBe('B');
      expect(callA.args.pipeOD).toEqual(asLiteral(3.56));
      expect(callB.args.pipeOD).toEqual(asLiteral(4.5));
    }
    expect(g.imports).toEqual(['dt_mule_shoe']);   // imports auto-derived from Call.src
  });

  it('edits to A.pipeOD do not affect B (Step 5)', () => {
    let g = newGraph();
    const a = addCall(g, 'dt_mule_shoe', { pipeOD: asLiteral(3.56) }); g = a.graph;
    const b = addCall(g, 'dt_mule_shoe', { pipeOD: asLiteral(3.56) }); g = b.graph;
    g = setCallArg(g, a.id, 'pipeOD', asLiteral(5.5));
    const A = g.nodes[a.id]; const B = g.nodes[b.id];
    expect(A?.type === 'call' && (A as any).args.pipeOD).toEqual(asLiteral(5.5));
    expect(B?.type === 'call' && (B as any).args.pipeOD).toEqual(asLiteral(3.56));
  });

  it('emits a clean .asm.ts source with the graph as JSON literal (Step 6)', () => {
    let g = newGraph();
    const a = addCall(g, 'dt_mule_shoe', { pipeOD: asLiteral(3.56), boxOD: asLiteral(4.0) }); g = a.graph;
    const b = addCall(g, 'dt_mule_shoe', { pipeOD: asLiteral(4.5),  boxOD: asLiteral(5.25) }); g = b.graph;
    const r = emitGraph(g, { id: 'dt_mule_compose', description: 'mule shoe stack' });
    // Spot checks on the source text — no parsing back required.
    expect(r.source).toContain("id: 'dt_mule_compose'");
    expect(r.source).toContain("kind: 'asm'");
    expect(r.source).toContain('uses: [');
    expect(r.source).toContain("'dt_mule_shoe'");
    expect(r.source).toContain('graph: {');
    expect(r.source).toContain('export function dt_mule_compose()');
    expect(r.source).toContain('const A = dt_mule_shoe({ pipeOD: 3.56, boxOD: 4 })');
    expect(r.source).toContain('const B = dt_mule_shoe({ pipeOD: 4.5, boxOD: 5.25 })');
    expect(r.source).toMatch(/return\s+_list_\d+/);   // root list var
  });

  it('adding meta.params row with no edges is structurally legal but orphan-detectable (Step 8)', () => {
    let g = newGraph();
    const a = addCall(g, 'dt_mule_shoe', { pipeOD: asLiteral(3.56) }); g = a.graph;
    g = addParam(g, 'outerOD', { default: 4, min: 0.5, max: 24, step: 0.05, unit: 'in' });
    expect(g.params.outerOD).toBeDefined();
    // No edges to/from outerOD yet — surface the warning.
    expect(slotsForParam(g, 'outerOD').length).toBe(0);
  });

  it('wires A.pipeOD to outerOD, edges propagate, only A re-bakes (Step 9-10)', () => {
    let g = newGraph();
    const a = addCall(g, 'dt_mule_shoe', { pipeOD: asLiteral(3.56) }); g = a.graph;
    const b = addCall(g, 'dt_mule_shoe', { pipeOD: asLiteral(3.56) }); g = b.graph;
    g = addParam(g, 'outerOD', { default: 4, min: 0.5, max: 24, step: 0.05, unit: 'in' });
    g = wireArg(g, a.id, 'pipeOD', 'outerOD');
    expect(slotsForParam(g, 'outerOD')).toEqual([{ from: 'p.outerOD', to: `${a.id}.args.pipeOD` }]);
    // B still uses its literal — edge count is 1 not 2.
    expect(g.edges.length).toBe(1);
    const callA = g.nodes[a.id]; const callB = g.nodes[b.id];
    expect(callA?.type === 'call' && (callA as any).args.pipeOD).toEqual(asParam('outerOD'));
    expect(callB?.type === 'call' && (callB as any).args.pipeOD).toEqual(asLiteral(3.56));
  });

  it('wire B too → both share the dial (Step 11)', () => {
    let g = newGraph();
    const a = addCall(g, 'dt_mule_shoe', { pipeOD: asLiteral(3.56) }); g = a.graph;
    const b = addCall(g, 'dt_mule_shoe', { pipeOD: asLiteral(3.56) }); g = b.graph;
    g = addParam(g, 'outerOD', { default: 4 });
    g = wireArg(g, a.id, 'pipeOD', 'outerOD');
    g = wireArg(g, b.id, 'pipeOD', 'outerOD');
    expect(g.edges.length).toBe(2);
  });

  it('removing outerOD with 2 wires fails open + surfaces both orphans (Step 12)', () => {
    let g = newGraph();
    const a = addCall(g, 'dt_mule_shoe', { pipeOD: asLiteral(3.56) }); g = a.graph;
    const b = addCall(g, 'dt_mule_shoe', { pipeOD: asLiteral(3.56) }); g = b.graph;
    g = addParam(g, 'outerOD', { default: 4 });
    g = wireArg(g, a.id, 'pipeOD', 'outerOD');
    g = wireArg(g, b.id, 'pipeOD', 'outerOD');
    const result = removeParam(g, 'outerOD');
    // Failed (graph unchanged) — caller must unwire first.
    expect(result.graph.params.outerOD).toBeDefined();
    expect(result.orphans.length).toBe(2);
    // Unwire both, then removeParam succeeds.
    let g2 = unwireArg(result.graph, a.id, 'pipeOD', asLiteral(4));
    g2 = unwireArg(g2, b.id, 'pipeOD', asLiteral(4));
    const result2 = removeParam(g2, 'outerOD');
    expect(result2.orphans.length).toBe(0);
    expect(result2.graph.params.outerOD).toBeUndefined();
    expect(result2.graph.edges.length).toBe(0);
  });

  it('removing a Call cascades — children of method/mv/rot drop too', () => {
    let g = newGraph();
    const a = addCall(g, 'dt_box'); g = a.graph;
    const b = addCall(g, 'dt_pin'); g = b.graph;
    const m = addContainer(g, 'list'); g = m.graph;
    g = removeNode(g, a.id);
    expect(g.nodes[a.id]).toBeUndefined();
    // root still references b + m
    const root = g.nodes[g.root];
    if (root?.type === 'list') {
      expect(root.children).not.toContain(a.id);
      expect(root.children).toContain(b.id);
    }
  });

  it('aliases consume A, B, C from the pool; deleting B then adding gives back B (reuse)', () => {
    let g = newGraph();
    const a = addCall(g, 'dt_box'); g = a.graph;
    const b = addCall(g, 'dt_pin'); g = b.graph;
    const c = addCall(g, 'dt_shaft'); g = c.graph;
    expect((g.nodes[a.id] as any).alias).toBe('A');
    expect((g.nodes[b.id] as any).alias).toBe('B');
    expect((g.nodes[c.id] as any).alias).toBe('C');
    g = removeNode(g, b.id);
    const d = addCall(g, 'dt_box'); g = d.graph;
    expect((g.nodes[d.id] as any).alias).toBe('B');   // alphabet pool reused
  });
});
