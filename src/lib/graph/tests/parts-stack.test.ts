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
  addPartsStackRow, setPartsStackRowSrc, setPartsStackRowArg, setPartsStackRowMaterial,
  removePartsStackRow, duplicatePartsStackRow, movePartsStackRow, hydrateGraph,
} from '../composition-graph';
import { partsStackRowVar } from '../nodes/kinds/parts-stack';
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
