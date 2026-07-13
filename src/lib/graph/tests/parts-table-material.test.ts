/**
 * parts-table-material.test.ts — the #38d PER-ROW material / colour override on a
 * parts_table card. All rows share ONE template `src`, so color-by-source paints
 * them identically; a per-row override lets each instance differ. Two layers:
 *
 *   1. MUTATE — setPartsTableRowMaterial sets/reads/clears a row's override in a
 *               `rowMaterials` array kept PARALLEL to `rows` (index-aligned, padded
 *               with nulls, trailing-null-trimmed), normalises junk to null, and is
 *               a no-op on an out-of-range index. Old files without rowMaterials
 *               hydrate with the field absent; a set override round-trips.
 *   2. EMIT   — a SET row material stamps meta.instanceColors keyed by the row's own
 *               output var (partsTableRowVar) with {outer, opacity, material} — the
 *               exact shape part-colors.appearanceFromOverride reads back — so each
 *               row renders in its override via the existing color-by-source LUT.
 *               ABSENT / all-null ⇒ NO instanceColors ⇒ byte-identical emit.
 */
import { describe, it, expect } from 'vitest';
import { emitGraph } from '../composition-emit';
import { setPartsTableRowMaterial, hydrateGraph } from '../composition-graph';
import { partsTableRowVar } from '../nodes/kinds/parts-table';
import type { Graph, ArgValue, RowMaterial } from '../composition-graph-types';

const lit = (v: number | string | boolean): ArgValue => ({ kind: 'literal', value: v });

/** A 3-row table over `g_block` (sizes 2/3/4), optionally seeded with rowMaterials. */
const tableGraph = (
  rows: Array<Record<string, ArgValue>>,
  rowMaterials?: Array<RowMaterial | null>,
): Graph =>
  ({
    nodes: {
      r: { id: 'r', type: 'list', children: ['tbl'] },
      tbl: {
        id: 'tbl', type: 'parts_table', src: 'g_block', columns: ['size'], rows,
        ...(rowMaterials ? { rowMaterials } : {}),
      },
    },
    root: 'r', params: {}, imports: [], edges: [], layout: {},
  } as any);

const THREE = (): Array<Record<string, ArgValue>> => [{ size: lit(2) }, { size: lit(3) }, { size: lit(4) }];
const tbl = (g: Graph) => g.nodes['tbl'] as any;

describe('#38d setPartsTableRowMaterial — set / read on the right row', () => {
  it('sets the override on row idx and index-aligns the array (padding earlier rows null)', () => {
    const g = setPartsTableRowMaterial(tableGraph(THREE()), 'tbl', 1, { color: '#00aaff', preset: 'steel', opacity: 0.3 });
    const n = tbl(g);
    expect(n.rowMaterials[1]).toEqual({ color: '#00aaff', preset: 'steel', opacity: 0.3 });
    expect(n.rowMaterials[0]).toBeNull();      // row 0 padded to null (keeps index ↔ row alignment)
    expect(n.rowMaterials).toHaveLength(2);    // trailing null (row 2) right-trimmed
    expect(n.rows).toHaveLength(3);            // the ROWS themselves are untouched
  });

  it('a second row set keeps the first; a hole between them stays null', () => {
    let g = setPartsTableRowMaterial(tableGraph(THREE()), 'tbl', 0, { color: '#ef4444' });
    g = setPartsTableRowMaterial(g, 'tbl', 2, { color: '#22c55e' });
    const n = tbl(g);
    expect(n.rowMaterials).toHaveLength(3);
    expect(n.rowMaterials[0]).toEqual({ color: '#ef4444' });
    expect(n.rowMaterials[1]).toBeNull();
    expect(n.rowMaterials[2]).toEqual({ color: '#22c55e' });
  });
});

describe('#38d setPartsTableRowMaterial — clear / normalise / bounds', () => {
  it('clearing the only override drops the whole field (byte-identical again)', () => {
    const g = setPartsTableRowMaterial(tableGraph(THREE()), 'tbl', 1, { color: '#00aaff' });
    expect(tbl(g).rowMaterials).toHaveLength(2);
    const g2 = setPartsTableRowMaterial(g, 'tbl', 1, null);
    expect(tbl(g2).rowMaterials).toBeUndefined();
  });

  it('clearing a trailing override right-trims back to the earlier one', () => {
    let g = setPartsTableRowMaterial(tableGraph(THREE()), 'tbl', 0, { color: '#ef4444' });
    g = setPartsTableRowMaterial(g, 'tbl', 2, { color: '#22c55e' });
    g = setPartsTableRowMaterial(g, 'tbl', 2, null);
    const n = tbl(g);
    expect(n.rowMaterials).toHaveLength(1);
    expect(n.rowMaterials[0]).toEqual({ color: '#ef4444' });
  });

  it('an all-junk bundle (bad hex, none preset, opaque) normalises to null → cleared', () => {
    const g = setPartsTableRowMaterial(tableGraph(THREE()), 'tbl', 0, { color: 'not-a-hex', preset: 'none', opacity: 1 });
    expect(tbl(g).rowMaterials).toBeUndefined();
  });

  it('keeps ONLY the well-formed fields of a partly-valid bundle', () => {
    const g = setPartsTableRowMaterial(tableGraph(THREE()), 'tbl', 0, { color: '#abcdef', preset: 'none', opacity: 2 } as any);
    expect(tbl(g).rowMaterials[0]).toEqual({ color: '#abcdef' });   // preset 'none' + opacity 2 dropped
  });

  it('an out-of-range index is a no-op (no rowMaterials created)', () => {
    const g = setPartsTableRowMaterial(tableGraph(THREE()), 'tbl', 9, { color: '#000000' });
    expect(tbl(g).rowMaterials).toBeUndefined();
  });
});

describe('#38d rowMaterials — hydrate / round-trip', () => {
  it('a legacy parts_table (no rowMaterials) hydrates with the field ABSENT', () => {
    const serialised = {
      nodes: {
        r: { id: 'r', type: 'list', children: ['tbl'] },
        tbl: { id: 'tbl', type: 'parts_table', src: 'g_block', columns: ['size'], rows: THREE() },
      },
      root: 'r', params: {}, imports: [], layout: {},
    };
    const g = hydrateGraph(serialised);
    expect(tbl(g).rowMaterials).toBeUndefined();
  });

  it('a set override survives serialise (meta.graph) → hydrate', () => {
    const g = setPartsTableRowMaterial(tableGraph(THREE()), 'tbl', 1, { color: '#00aaff', preset: 'brass' });
    const serialisedGraph = emitGraph(g, { id: 'pt_rt' }).meta.graph as any;
    const back = hydrateGraph(serialisedGraph);
    expect(tbl(back).rowMaterials[1]).toEqual({ color: '#00aaff', preset: 'brass' });
  });
});

describe('#38d EMIT — a row material stamps meta.instanceColors keyed by its output var', () => {
  it('maps color→outer, preset→material, opacity onto the row var entry', () => {
    const g = tableGraph(THREE(), [null, { color: '#00aaff', preset: 'steel', opacity: 0.3 }, null]);
    const res = emitGraph(g, { id: 'pt_mat' });
    const rowVar = partsTableRowVar('tbl', 1);             // '_pt_tbl_1'
    expect((res.meta.instanceColors as any)[rowVar]).toEqual({ outer: '#00aaff', opacity: 0.3, material: 'steel' });
    // it lands in the emitted SOURCE (the LUT reads it back by var name):
    expect(res.source).toContain('instanceColors');
    expect(res.source).toContain(`${rowVar}:`);
    expect(res.source).toContain("outer: '#00aaff'");
  });

  it('a colour-only row stamps ONLY outer', () => {
    const res = emitGraph(tableGraph(THREE(), [{ color: '#ef4444' }]), { id: 'pt_c' });
    expect((res.meta.instanceColors as any)[partsTableRowVar('tbl', 0)]).toEqual({ outer: '#ef4444' });
  });

  it('no rowMaterials ⇒ NO instanceColors stamp; all-null ⇒ same, and the BODY is byte-identical', () => {
    const plain = emitGraph(tableGraph(THREE()), { id: 'pt_plain' });
    expect(plain.source).not.toContain('instanceColors');
    expect((plain.meta as any).instanceColors).toBeUndefined();
    // An all-null rowMaterials array stamps nothing either — no instanceColors …
    const allNull = emitGraph(tableGraph(THREE(), [null, null, null]), { id: 'pt_plain' });
    expect((allNull.meta as any).instanceColors).toBeUndefined();
    // … and rowMaterials NEVER touches the emitted geometry body (the const rows +
    // aggregate + return are byte-identical — the override is render-only metadata).
    expect(allNull.body).toBe(plain.body);
  });
});
