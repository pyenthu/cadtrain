/**
 * parts-table.test.ts — the #38b PARTS-TABLE card descriptor.
 *
 * Locks PartsTableKind: it emits the AGGREGATE `[<rowVar_0>, …, <rowVar_N>]` of
 * per-row output-socket refs (the actual N Call consts come from the
 * emitPartsTableBlocks PRELUDE, exercised by parts-table-emit.test.ts), validates
 * each cell ArgValue, consumes no graph nodes, and grows one card-row per table
 * row. Plus the two PURE helpers the emit + UI share: partsTableRowVar (the
 * stable per-row socket name) + orderedRowKeys (deterministic column order).
 */
import { describe, it, expect } from 'vitest';
import { PartsTableKind, partsTableRowVar, orderedRowKeys } from '../parts-table';
import type { Graph, PartsTableNode, ArgValue } from '$lib/graph/composition/composition-graph-types';

const lit = (v: number | string | boolean): ArgValue => ({ kind: 'literal', value: v });
const par = (p: string): ArgValue => ({ kind: 'param', param: p });
const ex = (e: string): ArgValue => ({ kind: 'expr', expr: e });

const graph = (nodes: Record<string, any>, params: Record<string, any> = {}): Graph =>
  ({ nodes, root: 'r', params, edges: [], imports: [], layout: {} } as any);

const pt = (extra: Partial<PartsTableNode> = {}): PartsTableNode =>
  ({
    id: 'pt',
    type: 'parts_table',
    src: 'g_casing',
    columns: ['od', 'wall', 'length'],
    rows: [
      { od: lit(9.625), wall: lit(0.545), length: lit(4200) },
      { od: lit(7), wall: lit(0.408), length: lit(6100) },
      { od: lit(5.5), wall: lit(0.3), length: lit(8000) },
    ],
    ...extra,
  } as PartsTableNode);

describe('partsTableRowVar — the per-row output-socket name (pure)', () => {
  it('is a stable fn of (id, idx), JS-identifier-safe', () => {
    expect(partsTableRowVar('pt', 0)).toBe('_pt_pt_0');
    expect(partsTableRowVar('n_abc12', 2)).toBe('_pt_n_abc12_2');
    // Non-word chars in an id are sanitised to `_` so the const name stays valid.
    expect(partsTableRowVar('a-b.c', 1)).toBe('_pt_a_b_c_1');
  });
});

describe('orderedRowKeys — deterministic column order (pure)', () => {
  it('follows the node columns order, skipping columns the row does not fill', () => {
    const n = pt({ columns: ['od', 'wall', 'length'] });
    expect(orderedRowKeys(n, { length: lit(1), od: lit(2) })).toEqual(['od', 'length']);
  });
  it('appends any row key not in columns LAST (never silently dropped)', () => {
    const n = pt({ columns: ['od'] });
    expect(orderedRowKeys(n, { grade: lit('L80'), od: lit(9) })).toEqual(['od', 'grade']);
  });
});

describe('PartsTableKind — emit (aggregate of per-row socket refs)', () => {
  it('N rows → the bare array of N row-var refs (a LIST producer)', () => {
    expect(PartsTableKind.emitExpr(pt(), {} as any)).toBe('[_pt_pt_0, _pt_pt_1, _pt_pt_2]');
  });
  it('0 rows → the empty array', () => {
    expect(PartsTableKind.emitExpr(pt({ rows: [] }), {} as any)).toBe('[]');
  });
  it('1 row → a single-ref array (still separate-render, not unwrapped)', () => {
    expect(PartsTableKind.emitExpr(pt({ rows: [{ od: lit(9) }] }), {} as any)).toBe('[_pt_pt_0]');
  });
});

describe('PartsTableKind — validate', () => {
  it('clean when src is set and every cell param exists', () => {
    const n = pt({ rows: [{ od: par('bore') }] });
    expect(PartsTableKind.validate(n, graph({ pt: {} }, { bore: {} }))).toEqual([]);
  });
  it('flags a blank src as a missing-node', () => {
    const errs = PartsTableKind.validate(pt({ src: '', rows: [] }), graph({}, {}));
    expect(errs).toContainEqual({ nodeId: 'pt', slot: 'src', badRef: '', kind: 'missing-node' });
  });
  it('flags a deleted param referenced by a cell, slotted to the exact cell', () => {
    const n = pt({ rows: [{ od: lit(9) }, { od: par('vanished') }] });
    const errs = PartsTableKind.validate(n, graph({ pt: {} }, {}));
    expect(errs).toContainEqual({ nodeId: 'pt', slot: 'rows[1].od', badRef: 'vanished', kind: 'missing-param' });
    // A literal / expr cell never flags.
    expect(errs).toHaveLength(1);
  });
});

describe('PartsTableKind — sockets / size / inputRefs', () => {
  it('inputRefs is empty for an UNWIRED table — inline rows are ArgValues, not graph nodes', () => {
    expect(PartsTableKind.inputRefs(pt())).toEqual([]);
  });
  it('inputRefs consumes the upstream list-producer when the data-input is WIRED (#38c)', () => {
    expect(PartsTableKind.inputRefs(pt({ dataInput: 'src_list' }))).toEqual(['src_list']);
  });
  it('sockets expose the optional `data` list-input; the aggregate is value-producing', () => {
    // ONE list-input slot `data` (#38c, the top-left wire target). The N per-ROW
    // output sockets are drawn by the card itself (SocketSchema can't express N
    // outputs) — the descriptor only marks value-producing.
    expect(PartsTableKind.sockets(pt())).toEqual({ inputs: ['data'], output: true });
  });
  it('size grows 24px per row above the 110 floor', () => {
    // 3 rows → max(110, 64 + 4*24) = 160
    expect(PartsTableKind.size(pt(), { width: 240, root: 'r' } as any)).toEqual({ w: 240, h: 160 });
    // 0 rows → max(110, 64 + 1*24) = 110
    expect(PartsTableKind.size(pt({ rows: [] }), { width: 240, root: 'r' } as any)).toEqual({ w: 240, h: 110 });
  });
});
