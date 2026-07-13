/**
 * parts-table-data-input.test.ts — the #38c PARTS-TABLE external DATA-INPUT socket.
 *
 * A parts_table can be WIRED to an upstream LIST-PRODUCER (`node.dataInput`) so its
 * rows are SOURCED FROM that runtime list (each element → one row) instead of the
 * inline rows — the parts_map lowering. This spec locks three things:
 *
 *   (a) UNWIRED  — a table with NO dataInput emits the inline per-row Call consts +
 *                  aggregate EXACTLY as before (the byte-identical invariant); no
 *                  Array.from, no consumed input, socket schema is the lone `data`.
 *   (b) WIRED    — emit lowers to `Array.from(<upstreamVar>, (s, i) => src({ col:
 *                  s.col, … }))`: references the UPSTREAM VAR, one row per element,
 *                  every column mapped to the element's field; the inline `_pt_*`
 *                  prelude is GONE; `src` still lands in meta.uses; still a LIST
 *                  producer (spread by a parent Stack). And the emitted body EXECUTES
 *                  to N instances (nested parts_table fixture — the upstream table's
 *                  rows are the record objects the downstream table maps).
 *   (c) INVENTORY — sockets expose the `data` input; inputRefs consumes the upstream
 *                  only when wired; a dangling dataInput is a validation error;
 *                  dataInput round-trips through hydrate/serialise + clears cleanly.
 */
import { describe, it, expect } from 'vitest';
import { emitGraph } from '../composition-emit';
import { PartsTableKind, partsTableInstanceColors } from '../nodes/kinds/parts-table';
import { hydrateGraph, setPartsTableDataInput } from '../composition-graph';
import type { Graph, ArgValue, PartsTableNode } from '../composition-graph-types';

const lit = (v: number | string | boolean): ArgValue => ({ kind: 'literal', value: v });

const graph = (nodes: Record<string, any>, params: Record<string, any> = {}): Graph =>
  ({ nodes, root: 'r', params, imports: [], edges: [], layout: {} } as any);

const THREE = [{ size: lit(2) }, { size: lit(3) }, { size: lit(4) }];

/** UNWIRED fixture — a plain inline 3-row table over g_block (the #38b contract). */
const inlineGraph = (): Graph =>
  graph({
    r: { id: 'r', type: 'list', children: ['tbl'] },
    tbl: { id: 'tbl', type: 'parts_table', src: 'g_block', columns: ['size'], rows: THREE },
  });

/** WIRED fixture — a downstream table whose rows come from an UPSTREAM parts_table
 *  aggregate. The upstream template `mk_row` returns a RECORD `{ size }`, so the
 *  upstream aggregate is a runtime list of row objects the downstream maps. */
const wiredGraph = (cols: string[] = ['size']): Graph =>
  graph({
    r: { id: 'r', type: 'list', children: ['down'] },
    up: { id: 'up', type: 'parts_table', src: 'mk_row', columns: ['size'], rows: THREE },
    down: { id: 'down', type: 'parts_table', src: 'g_block', columns: cols, rows: [], dataInput: 'up' },
  });

describe('#38c UNWIRED — inline-rows path is byte-identical (the critical invariant)', () => {
  it('emits the inline per-row Call consts + aggregate, NO Array.from', () => {
    const body = emitGraph(inlineGraph(), { id: 'pt_demo' }).body;
    expect(body).toContain('const _pt_tbl_0 = g_block({ size: 2 });');
    expect(body).toContain('const _pt_tbl_1 = g_block({ size: 3 });');
    expect(body).toContain('const _pt_tbl_2 = g_block({ size: 4 });');
    expect(body).toContain('const _table_1 = [_pt_tbl_0, _pt_tbl_1, _pt_tbl_2];');
    expect(body).toContain('return _table_1;');
    expect(body).not.toContain('Array.from');
  });
  it('descriptor emitExpr is unchanged for an unwired node (aggregate of row refs)', () => {
    const n = { id: 'tbl', type: 'parts_table', src: 'g_block', columns: ['size'], rows: THREE } as PartsTableNode;
    expect(PartsTableKind.emitExpr(n, {} as any)).toBe('[_pt_tbl_0, _pt_tbl_1, _pt_tbl_2]');
  });
});

describe('#38c WIRED — rows sourced from the upstream list (parts_map lowering)', () => {
  it('emits Array.from over the UPSTREAM VAR, one lambda, every column mapped to s.<col>', () => {
    const res = emitGraph(wiredGraph(['size']), { id: 'pt_demo' });
    // The upstream inline table keeps its own per-row consts + aggregate var…
    expect(res.body).toContain('const _pt_up_0 = mk_row({ size: 2 });');
    expect(res.body).toMatch(/const (_table_\d+) = \[_pt_up_0, _pt_up_1, _pt_up_2\];/);
    // …and the DOWNSTREAM table maps that var: Array.from(<upstreamVar>, (s, i) => …).
    const upVar = res.body.match(/const (_table_\d+) = \[_pt_up_0/)![1];
    expect(res.body).toContain(`Array.from(${upVar}, (s, i) => g_block({ size: s.size }))`);
    // No inline per-row prelude for the WIRED table (rows come from the wire).
    expect(res.body).not.toContain('_pt_down_0');
  });
  it('maps EVERY declared column to the element field of the same name (order preserved)', () => {
    const body = emitGraph(wiredGraph(['od', 'wall', 'length']), { id: 'pt_demo' }).body;
    expect(body).toContain('(s, i) => g_block({ od: s.od, wall: s.wall, length: s.length })');
  });
  it('keeps the template `src` in meta.uses (the loader still fetches it)', () => {
    expect(emitGraph(wiredGraph(), { id: 'pt_demo' }).meta.uses).toContain('g_block');
  });
  it('stays a LIST PRODUCER — a parent Stack `...`-spreads the mapped rows', () => {
    const g = graph({
      r: { id: 'r', type: 'list', children: ['stk'] },
      stk: { id: 'stk', type: 'stack', children: ['down'] },
      up: { id: 'up', type: 'parts_table', src: 'mk_row', columns: ['size'], rows: THREE },
      down: { id: 'down', type: 'parts_table', src: 'g_block', columns: ['size'], rows: [], dataInput: 'up' },
    });
    const body = emitGraph(g, { id: 'pt_stack' }).body;
    const downVar = body.match(/const (_table_\d+) = Array\.from/)![1];
    expect(body).toContain(`stack([...${downVar}])`);
  });
});

describe('#38c WIRED — EXECUTE the emitted body (nested tables, no WASM)', () => {
  it('the body runs to an ARRAY of exactly N instances, one per upstream element', () => {
    const body = emitGraph(wiredGraph(['size']), { id: 'pt_demo' }).body;
    // mk_row returns the row RECORD; g_block turns a row into an "instance".
    const mk_row = (a: { size: number }) => ({ size: a.size });
    const g_block = (a: { size: number }) => ({ solid: true, size: a.size });
    // eslint-disable-next-line no-new-func
    const fn = new Function('mk_row', 'g_block', body);
    const result = fn(mk_row, g_block);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(3);                          // 3 upstream rows → 3 instances
    expect(result.map((r: any) => r.size)).toEqual([2, 3, 4]);
    expect(result.every((r: any) => r.solid)).toBe(true);
  });
});

describe('#38c INVENTORY — sockets · inputRefs · validate · instanceColors · round-trip', () => {
  const pt = (extra: Partial<PartsTableNode> = {}): PartsTableNode =>
    ({ id: 'down', type: 'parts_table', src: 'g_block', columns: ['size'], rows: [], ...extra } as PartsTableNode);

  it('sockets always expose the `data` list-input', () => {
    expect(PartsTableKind.sockets(pt())).toEqual({ inputs: ['data'], output: true });
    expect(PartsTableKind.sockets(pt({ dataInput: 'up' }))).toEqual({ inputs: ['data'], output: true });
  });
  it('inputRefs consumes the upstream ONLY when wired', () => {
    expect(PartsTableKind.inputRefs(pt())).toEqual([]);
    expect(PartsTableKind.inputRefs(pt({ dataInput: 'up' }))).toEqual(['up']);
  });
  it('a wired table is CONSUMED, so its upstream is not ALSO a root output', () => {
    // The root's sole visible child is the downstream table; the upstream is consumed.
    const body = emitGraph(wiredGraph(), { id: 'pt_demo' }).body;
    const downVar = body.match(/const (_table_\d+) = Array\.from/)![1];
    expect(body).toContain(`return ${downVar};`);
  });
  it('a dataInput pointing at a DELETED node is a missing-node validation error', () => {
    const g = graph({ down: {} }, {});
    const errs = PartsTableKind.validate(pt({ dataInput: 'ghost' }), g);
    expect(errs).toContainEqual({ nodeId: 'down', slot: 'dataInput', badRef: 'ghost', kind: 'missing-node' });
  });
  it('a wired table stamps NO per-row instanceColors (no fixed row vars exist)', () => {
    const n = pt({ dataInput: 'up', rowMaterials: [{ color: '#ff0000' }] });
    expect(partsTableInstanceColors(n)).toEqual({});
  });
  it('dataInput round-trips through serialise → hydrate; the mutate helper sets + clears it', () => {
    const g0 = wiredGraph();
    // meta.graph IS the serialised graph literal a saved .asm.ts carries; hydrate reads it back.
    const round = hydrateGraph(emitGraph(g0, { id: 'pt_demo' }).meta.graph as any);
    expect((round.nodes.down as PartsTableNode).dataInput).toBe('up');
    // Clearing drops the field entirely (byte-identical to a never-wired table).
    const cleared = setPartsTableDataInput(round, 'down', null);
    expect('dataInput' in (cleared.nodes.down as any)).toBe(false);
    // Re-wiring sets it back.
    const rewired = setPartsTableDataInput(cleared, 'down', 'up');
    expect((rewired.nodes.down as PartsTableNode).dataInput).toBe('up');
    // A self-reference is a no-op guard.
    expect(setPartsTableDataInput(rewired, 'down', 'down')).toBe(rewired);
  });
});
