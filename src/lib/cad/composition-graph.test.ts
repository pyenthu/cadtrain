/**
 * composition-graph + composition-emit Phase A smoke test.
 *
 * The mule_shoe case-study contract from docs/plans/composition-architecture.md
 * (12 steps) tested at the data layer. Phase B (bake) + Phase C (editor)
 * extend this — emit-correctness is the foundation.
 */
import { describe, expect, it, vi } from 'vitest';
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
  addMv,
  addRot,
  addTxfmn,
  setTxfmnAxis,
  setTxfmnChild,
  hydrateGraph,
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
    // Output filter: A + B are both unconsumed (no method/transform wraps
    // them), so the root list inlines into `return [A, B]` directly — no
    // intermediate _list_<n> variable. See computeConsumedSet in
    // composition-emit.ts.
    expect(r.source).toMatch(/return\s+\[A,\s*B\]/);
  });

  it('stack spreads Repeat-with-op-list children (Step 7.6)', async () => {
    const { addCall, addRepeat, setRepeatOp, asLiteral, addContainer, appendContainerChild } = await import('./composition-graph');
    const { emitGraph } = await import('./composition-emit');
    let g = newGraph();
    // dt_box single + Repeat × 3 of dt_joint (as a list) + dt_pin single,
    // all stacked end-to-end. Expected emit: stack([A, ...R, B])
    const a = addCall(g, 'dt_box');       g = a.graph;
    const j = addCall(g, 'dt_joint');     g = j.graph;
    const r = addRepeat(g, j.id, asLiteral(3)); g = r.graph;
    g = setRepeatOp(g, r.id, 'list');
    const b = addCall(g, 'dt_pin');       g = b.graph;
    const s = addContainer(g, 'stack');   g = s.graph;
    g = appendContainerChild(g, s.id, a.id);
    g = appendContainerChild(g, s.id, r.id);
    g = appendContainerChild(g, s.id, b.id);
    const out = emitGraph(g, { id: 'tA' });
    // Mixed single + spread list + single — exactly what the user asked for.
    // Aliases are A=dt_box, B=dt_joint (inside Repeat), C=dt_pin (sequential).
    expect(out.source).toMatch(/stack\(\[A,\s*\.\.\.\w+,\s*C\]\)/);
  });

  it('Repeat node emits switch on op: stack / list / place (Step 7.5)', async () => {
    const { addCall, addRepeat, setRepeatOp, asLiteral } = await import('./composition-graph');
    const { emitGraph } = await import('./composition-emit');
    let g = newGraph();
    const c = addCall(g, 'dt_joint'); g = c.graph;
    // Default op === 'stack' (no op field present)
    const r1 = addRepeat(g, c.id, asLiteral(3));
    const out1 = emitGraph(r1.graph, { id: 'tA' });
    expect(out1.source).toMatch(/stack\(\s*Array\.from\(/);
    // op = list → bare Array.from
    const g2 = setRepeatOp(r1.graph, r1.id, 'list');
    const out2 = emitGraph(g2, { id: 'tB' });
    expect(out2.source).toMatch(/Array\.from\(/);
    expect(out2.source).not.toMatch(/stack\(\s*Array\.from\(/);
    // op = place → place(Array.from(...))
    const g3 = setRepeatOp(r1.graph, r1.id, 'place');
    const out3 = emitGraph(g3, { id: 'tC' });
    expect(out3.source).toMatch(/place\(\s*Array\.from\(/);
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

// ─── TXFMN (unified transform card) — model layer ────────────────────────────
describe('composition-graph — TxfmnNode (transform card)', () => {
  // --- Emit byte-identity vs the legacy mv/rot single nodes ---

  it('pure-mv TXFMN emits the SAME mv(...) expression as a legacy MvNode', () => {
    // legacy mv
    let g1 = newGraph();
    const a1 = addCall(g1, 'dt_box'); g1 = a1.graph;
    g1 = addMv(g1, a1.id, [asLiteral(0), asLiteral(0), asLiteral(5)]).graph;
    const r1 = emitGraph(g1, { id: 't' });
    // txfmn with rot=identity, offset=[0,0,5]
    let g2 = newGraph();
    const a2 = addCall(g2, 'dt_box'); g2 = a2.graph;
    g2 = addTxfmn(g2, a2.id,
      [asLiteral(0), asLiteral(0), asLiteral(0)],
      [asLiteral(0), asLiteral(0), asLiteral(5)]).graph;
    const r2 = emitGraph(g2, { id: 't' });

    expect(r1.body).toContain('mv(A, [0, 0, 5])');
    expect(r2.body).toContain('mv(A, [0, 0, 5])');   // byte-identical expression
    expect(r2.body).not.toContain('rot(');            // identity rot elided
    expect(r2.validationErrors).toEqual([]);
  });

  it('pure-rot TXFMN emits the SAME rot(...) expression as a legacy RotNode', () => {
    let g1 = newGraph();
    const a1 = addCall(g1, 'dt_box'); g1 = a1.graph;
    g1 = addRot(g1, a1.id, [asLiteral(0), asLiteral(0), asLiteral(90)]).graph;
    const r1 = emitGraph(g1, { id: 't' });
    let g2 = newGraph();
    const a2 = addCall(g2, 'dt_box'); g2 = a2.graph;
    g2 = addTxfmn(g2, a2.id,
      [asLiteral(0), asLiteral(0), asLiteral(90)],
      [asLiteral(0), asLiteral(0), asLiteral(0)]).graph;
    const r2 = emitGraph(g2, { id: 't' });

    expect(r1.body).toContain('rot(A, [0, 0, 90])');
    expect(r2.body).toContain('rot(A, [0, 0, 90])');  // byte-identical expression
    expect(r2.body).not.toContain('mv(');             // identity offset elided
  });

  it('rot+offset TXFMN emits nested mv(rot(...)) — rot inner, mv outer', () => {
    let g = newGraph();
    const a = addCall(g, 'dt_box'); g = a.graph;
    g = addTxfmn(g, a.id,
      [asLiteral(0), asLiteral(0), asLiteral(90)],
      [asLiteral(0), asLiteral(0), asLiteral(5)]).graph;
    const r = emitGraph(g, { id: 't' });
    expect(r.body).toContain('mv(rot(A, [0, 0, 90]), [0, 0, 5])');
  });

  it('identity TXFMN (all zero) emits the bare child (passthrough)', () => {
    let g = newGraph();
    const a = addCall(g, 'dt_box'); g = a.graph;
    const t = addTxfmn(g, a.id); g = t.graph;
    const r = emitGraph(g, { id: 't' });
    expect(r.body).not.toContain('mv(');
    expect(r.body).not.toContain('rot(');
    // the txfmn const aliases the child directly: `const _txfmn_obj_1 = A;`
    expect(r.body).toMatch(/=\s*A;/);
  });

  // --- Mutators ---

  it('setTxfmnAxis updates the rot + mv (offset) triples independently', () => {
    let g = newGraph();
    const a = addCall(g, 'dt_box'); g = a.graph;
    const t = addTxfmn(g, a.id); g = t.graph;
    g = setTxfmnAxis(g, t.id, 'rot', 2, asLiteral(45));
    g = setTxfmnAxis(g, t.id, 'mv', 2, asParam('len'));
    const tx = g.nodes[t.id] as any;
    expect(tx.type).toBe('txfmn');
    expect(tx.rot[2]).toEqual(asLiteral(45));
    expect(tx.offset[2]).toEqual(asParam('len'));
    expect(tx.rot[0]).toEqual(asLiteral(0));     // untouched axes preserved
    expect(tx.offset[0]).toEqual(asLiteral(0));
  });

  it('setTxfmnChild rebinds the wrapped shape', () => {
    let g = newGraph();
    const a = addCall(g, 'dt_box'); g = a.graph;
    const b = addCall(g, 'dt_pin'); g = b.graph;
    const t = addTxfmn(g, a.id); g = t.graph;
    g = setTxfmnChild(g, t.id, b.id);
    expect((g.nodes[t.id] as any).child).toBe(b.id);
  });

  it('collectEdges emits rot.<i> + offset.<i> edges for wired txfmn axes', () => {
    let g = newGraph();
    const a = addCall(g, 'dt_box'); g = a.graph;
    const t = addTxfmn(g, a.id); g = t.graph;
    g = addParam(g, 'tilt', { default: 0 });
    g = addParam(g, 'len', { default: 1 });
    g = setTxfmnAxis(g, t.id, 'rot', 0, asParam('tilt'));
    g = setTxfmnAxis(g, t.id, 'mv', 2, asParam('len'));
    expect(g.edges).toContainEqual({ from: 'p.tilt', to: `${t.id}.rot.0` });
    expect(g.edges).toContainEqual({ from: 'p.len', to: `${t.id}.offset.2` });
    // collectEdges (pure) agrees with the finalized index.
    expect(collectEdges(g)).toEqual(g.edges);
  });

  // --- Hydrate migration of legacy mv/rot ---

  const callN = (id: string, alias: string) =>
    ({ id, type: 'call', src: 'dt_box', alias, args: {} });
  const listN = (id: string, children: string[]) =>
    ({ id, type: 'list', children });

  it('migration folds mv(rot(C)) into one txfmn (rot-inner/mv-outer); emit byte-identical', () => {
    const serialised = {
      root: 'n_root00',
      nodes: {
        n_root00: listN('n_root00', ['n_mv0000']),
        n_mv0000: { id: 'n_mv0000', type: 'mv', child: 'n_rot000', offset: [asLiteral(0), asLiteral(0), asLiteral(5)] },
        n_rot000: { id: 'n_rot000', type: 'rot', child: 'n_call00', rot: [asLiteral(0), asLiteral(0), asLiteral(90)] },
        n_call00: callN('n_call00', 'A'),
      },
      params: {}, imports: ['dt_box'], layout: {},
    };
    const g = hydrateGraph(serialised);
    // The inner rot is absorbed; the mv's id now carries a txfmn.
    expect(g.nodes['n_rot000']).toBeUndefined();
    const tx = g.nodes['n_mv0000'] as any;
    expect(tx.type).toBe('txfmn');
    expect(tx.child).toBe('n_call00');
    expect(tx.rot).toEqual([asLiteral(0), asLiteral(0), asLiteral(90)]);
    expect(tx.offset).toEqual([asLiteral(0), asLiteral(0), asLiteral(5)]);
    const r = emitGraph(g, { id: 't' });
    expect(r.body).toContain('mv(rot(A, [0, 0, 90]), [0, 0, 5])');
    expect(r.validationErrors).toEqual([]);
  });

  it('migration lifts a lone mv into a txfmn{rot:0, offset}', () => {
    const serialised = {
      root: 'n_root00',
      nodes: {
        n_root00: listN('n_root00', ['n_mv0000']),
        n_mv0000: { id: 'n_mv0000', type: 'mv', child: 'n_call00', offset: [asLiteral(0), asLiteral(0), asLiteral(5)] },
        n_call00: callN('n_call00', 'A'),
      },
      params: {}, imports: ['dt_box'], layout: {},
    };
    const g = hydrateGraph(serialised);
    const tx = g.nodes['n_mv0000'] as any;
    expect(tx.type).toBe('txfmn');
    expect(tx.rot).toEqual([asLiteral(0), asLiteral(0), asLiteral(0)]);
    expect(tx.offset).toEqual([asLiteral(0), asLiteral(0), asLiteral(5)]);
    const r = emitGraph(g, { id: 't' });
    expect(r.body).toContain('mv(A, [0, 0, 5])');
    expect(r.body).not.toContain('rot(');
  });

  it('migration lifts a lone rot into a txfmn{rot, offset:0}', () => {
    const serialised = {
      root: 'n_root00',
      nodes: {
        n_root00: listN('n_root00', ['n_rot000']),
        n_rot000: { id: 'n_rot000', type: 'rot', child: 'n_call00', rot: [asLiteral(0), asLiteral(0), asLiteral(90)] },
        n_call00: callN('n_call00', 'A'),
      },
      params: {}, imports: ['dt_box'], layout: {},
    };
    const g = hydrateGraph(serialised);
    const tx = g.nodes['n_rot000'] as any;
    expect(tx.type).toBe('txfmn');
    expect(tx.rot).toEqual([asLiteral(0), asLiteral(0), asLiteral(90)]);
    expect(tx.offset).toEqual([asLiteral(0), asLiteral(0), asLiteral(0)]);
    const r = emitGraph(g, { id: 't' });
    expect(r.body).toContain('rot(A, [0, 0, 90])');
    expect(r.body).not.toContain('mv(');
  });

  it('migration WARNS and KEEPS two nodes for rot(mv(C)) (translate-then-rotate)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const serialised = {
      root: 'n_root00',
      nodes: {
        n_root00: listN('n_root00', ['n_rot000']),
        n_rot000: { id: 'n_rot000', type: 'rot', child: 'n_mv0000', rot: [asLiteral(0), asLiteral(0), asLiteral(90)] },
        n_mv0000: { id: 'n_mv0000', type: 'mv', child: 'n_call00', offset: [asLiteral(0), asLiteral(0), asLiteral(5)] },
        n_call00: callN('n_call00', 'A'),
      },
      params: {}, imports: ['dt_box'], layout: {},
    };
    const g = hydrateGraph(serialised);
    // Both legacy nodes are KEPT (not mis-folded into one card).
    expect((g.nodes['n_rot000'] as any).type).toBe('rot');
    expect((g.nodes['n_mv0000'] as any).type).toBe('mv');
    expect(warn).toHaveBeenCalled();
    const r = emitGraph(g, { id: 't' });
    // Geometry preserved: the two legacy nodes emit as two consts exactly as
    // before the migration — translate first (inner mv), then rotate (outer rot).
    expect(r.body).toContain('mv(A, [0, 0, 5])');
    expect(r.body).toMatch(/rot\(_mv_obj_1, \[0, 0, 90\]\)/);
    expect(r.validationErrors).toEqual([]);
    warn.mockRestore();
  });
});
