/**
 * parts-stack.test.ts — the heterogeneous "completion string" card (`parts_stack`).
 * Each ROW is a DIFFERENT part (`row.src`) + its `args`; the rows mate END-TO-END via
 * the sandbox `stack([...])` helper (a SINGLE mated value, unlike parts_table's
 * separate-rows list). Covered: emit (per-row src consts + stack wrap + meta.uses +
 * per-row material → instanceColors), the mutate family, and hydrate round-trip.
 */
import { describe, it, expect } from 'vitest';
import { emitGraph } from '../composition-emit';
import {
  addPartsStackRow, insertPartsStackRowAbove, setPartsStackRowSrc, setPartsStackRowArg,
  setPartsStackRowTop, setPartsStackRowMaterial,
  removePartsStackRow, duplicatePartsStackRow, movePartsStackRow, hydrateGraph,
} from '../composition-graph';
import { partsStackRowVar, partsStackWarpNodes } from '../nodes/kinds/parts-stack';
import { autoNodes, lerpDTX } from '$lib/wells/dtx';
import type { Graph, PartsStackRow } from '../composition-graph-types';

const lit = (v: number | string | boolean) => ({ kind: 'literal', value: v } as const);

/** A completion-string graph: a parts_stack `ps` (rows given) under the root list. */
const stackGraph = (rows: PartsStackRow[]): Graph =>
  ({
    nodes: {
      r: { id: 'r', type: 'list', children: ['ps'] },
      ps: { id: 'ps', type: 'parts_stack', rows },
    },
    root: 'r', params: {}, imports: [], edges: [], layout: {},
  } as any);

const ps = (g: Graph) => g.nodes['ps'] as any;
const HANGER = { src: 'bw_hanger', args: { length: lit(5) } };
const PACKER = { src: 'bw_packer', args: { length: lit(3), od: lit(8.6) } };
const TUBING = { src: 'bw_tubing', args: { length: lit(200) } };

describe('parts_stack EMIT — rows mate end-to-end via stack([...])', () => {
  it('wraps the N per-row consts in stack([...]) in row order', () => {
    const res = emitGraph(stackGraph([HANGER, PACKER, TUBING]), { id: 'w_comp' });
    const v = (i: number) => partsStackRowVar('ps', i);           // _ps_ps_0 …
    expect(res.source).toContain(`stack([${v(0)}, ${v(1)}, ${v(2)}])`);
  });

  it('each row emits a prelude const with its OWN src', () => {
    const res = emitGraph(stackGraph([HANGER, PACKER, TUBING]), { id: 'w_comp' });
    expect(res.source).toContain(`const ${partsStackRowVar('ps', 0)} = bw_hanger(`);
    expect(res.source).toContain(`const ${partsStackRowVar('ps', 1)} = bw_packer(`);
    expect(res.source).toContain(`const ${partsStackRowVar('ps', 2)} = bw_tubing(`);
    // and the row's inline arg lands in the call
    expect(res.source).toMatch(/bw_tubing\(\{[^}]*length:\s*200/);
  });

  it('meta.uses collects EVERY distinct row src (not one template)', () => {
    const res = emitGraph(stackGraph([HANGER, PACKER, TUBING]), { id: 'w_comp' });
    for (const s of ['bw_hanger', 'bw_packer', 'bw_tubing']) expect(res.meta.uses as string[]).toContain(s);
  });

  it('a per-row material stamps meta.instanceColors keyed by the row var', () => {
    const rows = [HANGER, { ...PACKER, material: { color: '#8a929c', preset: 'steel' } }];
    const res = emitGraph(stackGraph(rows), { id: 'w_comp_mat' });
    expect((res.meta.instanceColors as any)[partsStackRowVar('ps', 1)]).toEqual({ outer: '#8a929c', material: 'steel' });
  });

  it('no per-row material ⇒ NO instanceColors stamp', () => {
    const res = emitGraph(stackGraph([HANGER, TUBING]), { id: 'w_comp_plain' });
    expect((res.meta as any).instanceColors).toBeUndefined();
  });
});

describe('parts_stack DEPTH — per-row `top` anchors an element (place vs mate)', () => {
  const v = (i: number) => partsStackRowVar('ps', i);

  it('a row WITH top is placed via mv(); unanchored rows still mate — mixed emits a LIST', () => {
    const rows = [HANGER, TUBING, { ...PACKER, top: lit(100) }];
    const res = emitGraph(stackGraph(rows), { id: 'w_comp_depth' });
    // unanchored hanger+tubing mate; packer placed at 100; combined as a bare array.
    expect(res.source).toContain(`[stack([${v(0)}, ${v(1)}]), mv(${v(2)}, [0, 0, 100])]`);
  });

  it('ALL rows anchored ⇒ no stack, just the placed mv list (each at its depth)', () => {
    const rows = [{ ...HANGER, top: lit(0) }, { ...TUBING, top: lit(0) }, { ...PACKER, top: lit(100) }];
    const res = emitGraph(stackGraph(rows), { id: 'w_comp_all' });
    expect(res.source).toContain(`[mv(${v(0)}, [0, 0, 0]), mv(${v(1)}, [0, 0, 0]), mv(${v(2)}, [0, 0, 100])]`);
    expect(res.source).not.toContain('stack([');
  });

  it('NO top on any row ⇒ the single mated stack (byte-identical to before `top`)', () => {
    const res = emitGraph(stackGraph([HANGER, TUBING, PACKER]), { id: 'w_comp_none' });
    expect(res.source).toContain(`stack([${v(0)}, ${v(1)}, ${v(2)}])`);
    expect(res.source).not.toMatch(/\[stack\(/);   // not wrapped in a list
  });

  it('an anchored row makes parts_stack a LIST producer (spread by the root/warp)', () => {
    // A mixed stack feeding the root list should SPREAD (each body separate), which the
    // emit expresses as the bare-array form above. A pure-mate stack stays one value.
    const anchored = emitGraph(stackGraph([HANGER, { ...PACKER, top: lit(50) }]), { id: 'lp' });
    expect(anchored.source).toMatch(/\[stack\(\[.*\]\), mv\(/);
  });
});

describe('parts_stack MUTATE — depth + insert-above', () => {
  it('setPartsStackRowTop sets a literal / expr and clears on null', () => {
    let g = setPartsStackRowTop(stackGraph([PACKER]), 'ps', 0, 100);
    expect((ps(g).rows[0] as any).top).toEqual(lit(100));
    g = setPartsStackRowTop(g, 'ps', 0, { expr: 'p.md' });
    expect((ps(g).rows[0] as any).top).toEqual({ kind: 'expr', expr: 'p.md' });
    g = setPartsStackRowTop(g, 'ps', 0, null);
    expect((ps(g).rows[0] as any).top).toBeUndefined();
  });

  it('insertPartsStackRowAbove inserts a blank row at idx (pushing the rest down)', () => {
    const g = insertPartsStackRowAbove(stackGraph([HANGER, PACKER]), 'ps', 1);
    expect(ps(g).rows.map((r: any) => r.src)).toEqual(['bw_hanger', '', 'bw_packer']);
    expect(ps(g).rows[1]).toEqual({ src: '', args: {} });
    // idx === len appends
    const g2 = insertPartsStackRowAbove(stackGraph([HANGER]), 'ps', 5);
    expect(ps(g2).rows.map((r: any) => r.src)).toEqual(['bw_hanger', '']);
  });
});

describe('parts_stack MUTATE', () => {
  it('addPartsStackRow appends a row (optionally seeded with a src)', () => {
    let g = stackGraph([]);
    g = addPartsStackRow(g, 'ps', 'bw_hanger');
    g = addPartsStackRow(g, 'ps');
    expect(ps(g).rows).toHaveLength(2);
    expect(ps(g).rows[0]).toEqual({ src: 'bw_hanger', args: {} });
    expect(ps(g).rows[1]).toEqual({ src: '', args: {} });
  });

  it('setPartsStackRowSrc changes the part AND clears the now-meaningless args', () => {
    const g = setPartsStackRowSrc(stackGraph([PACKER]), 'ps', 0, 'bw_tubing');
    expect(ps(g).rows[0]).toEqual({ src: 'bw_tubing', args: {} });   // od/length dropped
  });

  it('setPartsStackRowArg sets a literal / expr and clears on null', () => {
    let g = setPartsStackRowArg(stackGraph([{ src: 'bw_tubing', args: {} }]), 'ps', 0, 'length', 200);
    expect(ps(g).rows[0].args.length).toEqual(lit(200));
    g = setPartsStackRowArg(g, 'ps', 0, 'od', { expr: 'p.od' });
    expect(ps(g).rows[0].args.od).toEqual({ kind: 'expr', expr: 'p.od' });
    g = setPartsStackRowArg(g, 'ps', 0, 'length', null);
    expect(ps(g).rows[0].args.length).toBeUndefined();
  });

  it('setPartsStackRowMaterial sets a normalised bundle; clears the field on junk/null', () => {
    let g = setPartsStackRowMaterial(stackGraph([HANGER]), 'ps', 0, { color: '#abcdef', preset: 'none', opacity: 2 } as any);
    expect(ps(g).rows[0].material).toEqual({ color: '#abcdef' });   // preset 'none' + opacity 2 dropped
    g = setPartsStackRowMaterial(g, 'ps', 0, null);
    expect(ps(g).rows[0].material).toBeUndefined();
  });

  it('remove + duplicate row', () => {
    let g = duplicatePartsStackRow(stackGraph([PACKER]), 'ps', 0);
    expect(ps(g).rows).toHaveLength(2);
    expect(ps(g).rows[1].src).toBe('bw_packer');
    g = removePartsStackRow(g, 'ps', 0);
    expect(ps(g).rows).toHaveLength(1);
  });

  it('movePartsStackRow swaps with the neighbour and is a no-op at the ends', () => {
    const g0 = stackGraph([HANGER, PACKER, TUBING]);
    // move row 1 (packer) UP → order hanger/packer/tubing → packer/hanger/tubing
    const up = movePartsStackRow(g0, 'ps', 1, -1);
    expect(ps(up).rows.map((r: any) => r.src)).toEqual(['bw_packer', 'bw_hanger', 'bw_tubing']);
    // move row 1 DOWN → hanger/tubing/packer
    const down = movePartsStackRow(g0, 'ps', 1, 1);
    expect(ps(down).rows.map((r: any) => r.src)).toEqual(['bw_hanger', 'bw_tubing', 'bw_packer']);
    // ends are no-ops: row 0 up, last row down
    expect(ps(movePartsStackRow(g0, 'ps', 0, -1)).rows.map((r: any) => r.src)).toEqual(['bw_hanger', 'bw_packer', 'bw_tubing']);
    expect(ps(movePartsStackRow(g0, 'ps', 2, 1)).rows.map((r: any) => r.src)).toEqual(['bw_hanger', 'bw_packer', 'bw_tubing']);
  });
});

describe('parts_stack GRADED WARP-AUTOSCALE — element spans → DTX magnifies short elements', () => {
  // A completion string: hanger 2, tubing 240, packer 10, mule_shoe 5 — mated end-to-end.
  const COMP = [
    { src: 'bw_hanger', args: { length: lit(2) } },
    { src: 'bw_tubing', args: { length: lit(240) } },
    { src: 'bw_packer', args: { length: lit(10) } },
    { src: 'bw_mule_shoe', args: { length: lit(5) } },
  ];

  it('partsStackWarpNodes returns each element span (mated cumulative) + maxDepth', () => {
    const { nodes, maxDepth } = partsStackWarpNodes(stackGraph(COMP).nodes['ps'] as any);
    expect(nodes).toEqual([[0, 2], [2, 242], [242, 252], [252, 257]]);
    expect(maxDepth).toBe(257);
  });

  it('an ANCHORED row sits at [top, top+len] and does not advance the mate cursor', () => {
    const rows = [
      { src: 'bw_hanger', args: { length: lit(2) } },
      { src: 'bw_packer', args: { length: lit(10) }, top: lit(100) },   // anchored at 100
      { src: 'bw_tubing', args: { length: lit(240) } },
    ];
    const { nodes } = partsStackWarpNodes(stackGraph(rows).nodes['ps'] as any);
    // hanger 0..2 (mate), packer 100..110 (anchored, cursor stays at 2), tubing 2..242 (mate)
    expect(nodes).toEqual([[0, 2], [100, 110], [2, 242]]);
  });

  it('the emit stamps meta.warpNodes (flat) + warpMaxDepth', () => {
    const res = emitGraph(stackGraph(COMP), { id: 'w_comp_auto' });
    expect(res.meta.warpNodes).toEqual([0, 2, 2, 242, 242, 252, 252, 257]);
    expect(res.meta.warpMaxDepth).toBe(257);
  });

  it('warpMaxDepth (TD) is the DEEPEST element across the whole well, not the completion', () => {
    // A well: the completion parts_stack (to 257) + an open-hole parts_table reaching 1070
    // + a singular casing Call reaching 800. TD = 1070; nodes stay = the completion.
    const g: any = {
      nodes: {
        r: { id: 'r', type: 'list', children: ['ps', 'oh', 'csg'] },
        ps: { id: 'ps', type: 'parts_stack', rows: COMP },
        oh: { id: 'oh', type: 'parts_table', src: 'bw_open_hole', columns: ['od', 'length', 'top'],
              rows: [{ od: lit(17.5), length: lit(770), top: lit(300) }] },          // bottom 1070
        csg: { id: 'csg', type: 'call', src: 'bw_casing', alias: 'C',
               args: { od: lit(9.625), length: lit(800), top: lit(0) } },            // bottom 800
      },
      root: 'r', params: {}, imports: [], edges: [], layout: {},
    };
    const res = emitGraph(g, { id: 'w_full' });
    expect(res.meta.warpMaxDepth).toBe(1070);                          // TD = deepest element (open hole)
    expect(res.meta.warpNodes).toEqual([0, 2, 2, 242, 242, 252, 252, 257]); // emphasis = completion only
  });

  it('an expr length is skipped (can\'t precompute at emit); only literal elements grade', () => {
    const withExpr = [{ src: 'bw_tubing', args: { length: { kind: 'expr', expr: 'p.len' } as any } }, { src: 'bw_packer', args: { length: lit(10) } }];
    const { nodes } = partsStackWarpNodes(stackGraph(withExpr).nodes['ps'] as any);
    expect(nodes).toEqual([[0, 10]]);   // expr tubing skipped (cursor stays 0) → literal packer lands at [0,10]
    // a graph with no parts_stack stamps no warpNodes:
    const plain = emitGraph({ nodes: { r: { id: 'r', type: 'list', children: [] } }, root: 'r', params: {}, imports: [], edges: [], layout: {} } as any, { id: 'x' });
    expect((plain.meta as any).warpNodes).toBeUndefined();
  });

  it('the graded DTX magnifies the SHORT elements more than the long tubing', () => {
    const { nodes, maxDepth } = partsStackWarpNodes(stackGraph(COMP).nodes['ps'] as any);
    const dtx = autoNodes(nodes.map(([start, end]) => ({ start, end })), maxDepth);
    // arc-length occupied by each element under the DTX (display Δ per raw Δ):
    const arc = (s: number, e: number) => lerpDTX(dtx, e) - lerpDTX(dtx, s);
    const hanger = arc(0, 2), tubing = arc(2, 242), packer = arc(242, 252), mule = arc(252, 257);
    // the short hanger/packer/mule each get MORE arc per raw unit than the long tubing:
    expect(hanger / 2).toBeGreaterThan(tubing / 240);
    expect(packer / 10).toBeGreaterThan(tubing / 240);
    expect(mule / 5).toBeGreaterThan(tubing / 240);
    // total length is preserved (anchored): full arc == maxDepth
    expect(lerpDTX(dtx, maxDepth)).toBeCloseTo(maxDepth, 3);
  });
});

describe('parts_stack hydrate / round-trip', () => {
  it('survives serialise (meta.graph) → hydrate', () => {
    const rows = [HANGER, { ...PACKER, material: { color: '#8a929c', preset: 'steel' } }];
    const back = hydrateGraph(emitGraph(stackGraph(rows), { id: 'w_rt' }).meta.graph as any);
    expect(ps(back).rows[0]).toEqual({ src: 'bw_hanger', args: { length: lit(5) } });
    expect(ps(back).rows[1].material).toEqual({ color: '#8a929c', preset: 'steel' });
  });

  it('a malformed hand-edited row is repaired (bad src → "", bad cell → literal 0)', () => {
    const serialised = {
      nodes: {
        r: { id: 'r', type: 'list', children: ['ps'] },
        ps: { id: 'ps', type: 'parts_stack', rows: [{ src: 42, args: { length: 'oops' } }] },
      },
      root: 'r', params: {}, imports: [], layout: {},
    };
    const g = hydrateGraph(serialised);
    expect(ps(g).rows[0].src).toBe('');
    expect(ps(g).rows[0].args.length).toEqual({ kind: 'literal', value: 0 });
  });
});
