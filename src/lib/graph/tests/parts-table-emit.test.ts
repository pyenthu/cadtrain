/**
 * parts-table-emit.test.ts — the #38b PARTS-TABLE card, END TO END (headless).
 *
 * The payoff proof: a parts_table with N inline rows of the SAME template part
 * emits N SEPARATE Call instructions — each bound to its OWN stable-named output
 * const (its own output socket) — and the emitted body executes / bakes to N
 * SEPARATE bodies with NO compose / NO fusion. Three layers:
 *
 *   1. EMIT       — emitGraph produces N `const _pt_<id>_i = src({…});` + the
 *                   aggregate + `return`, lists `src` in meta.uses, and stays a
 *                   LIST PRODUCER (spread by a parent Stack).
 *   2. EXECUTE    — the emitted body runs to an array of N instances (stub template,
 *                   no WASM) — proves the map arity + per-row arg binding.
 *   3. REAL BAKE  — with a real Manifold template + through the actual loader
 *                   (buildPrimitiveGeom → autoPlace), N distinct bodies survive as
 *                   `_parts`, distinct volumes/bboxes, nothing composed → NO fusion.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { emitGraph } from '../composition-emit';
import { initManifold, cyl } from '$lib/engines/manifold/manifold-helpers';
import { buildPrimitiveGeom, _resetDepSourceCacheForTest } from '$lib/server/primitive-loader';
import type { Graph, ArgValue } from '../composition-graph-types';

const lit = (v: number | string | boolean): ArgValue => ({ kind: 'literal', value: v });
const par = (p: string): ArgValue => ({ kind: 'param', param: p });

const graph = (nodes: Record<string, any>, params: Record<string, any> = {}): Graph =>
  ({ nodes, root: 'r', params, imports: [], edges: [], layout: {} } as any);

/** A 3-row table over `g_block`, sizes 2/3/4 — the canonical fixture. */
const tableGraph = (rows: Array<Record<string, ArgValue>>, params: Record<string, any> = {}): Graph =>
  graph(
    {
      r: { id: 'r', type: 'list', children: ['tbl'] },
      tbl: { id: 'tbl', type: 'parts_table', src: 'g_block', columns: ['size'], rows },
    },
    params,
  );

const THREE_ROWS = [{ size: lit(2) }, { size: lit(3) }, { size: lit(4) }];

describe('parts_table — EMIT (N separate Call instructions, its own socket each)', () => {
  it('emits one named Call const PER ROW + the aggregate + returns it', () => {
    const body = emitGraph(tableGraph(THREE_ROWS), { id: 'pt_demo' }).body;
    // N Call instructions, each on its OWN stable-named output socket:
    expect(body).toContain('const _pt_tbl_0 = g_block({ size: 2 });');
    expect(body).toContain('const _pt_tbl_1 = g_block({ size: 3 });');
    expect(body).toContain('const _pt_tbl_2 = g_block({ size: 4 });');
    // The aggregate references each row var; the root returns it (autoPlaced apart).
    expect(body).toContain('const _table_1 = [_pt_tbl_0, _pt_tbl_1, _pt_tbl_2];');
    expect(body).toContain('return _table_1;');
    // Crucially: NO stack()/place()/compose wrapper — the rows are NOT fused.
    expect(body).not.toMatch(/stack\(|place\(|compose|\.add\(/);
  });

  it('lists the template `src` in meta.uses (the loader fetches it)', () => {
    expect(emitGraph(tableGraph(THREE_ROWS), { id: 'pt_demo' }).meta.uses).toContain('g_block');
  });

  it('emits cells in the declared COLUMN order, mixing literal + param + expr', () => {
    const g = graph(
      {
        r: { id: 'r', type: 'list', children: ['tbl'] },
        tbl: {
          id: 'tbl', type: 'parts_table', src: 'g_casing',
          columns: ['od', 'wall', 'length'],
          rows: [{ length: par('depth'), od: lit(9.625), wall: { kind: 'expr', expr: 'p.od * 0.5' } }],
        },
      },
      { depth: { default: 4200 } },
    );
    const body = emitGraph(g, { id: 'w_demo' }).body;
    // Column order (od, wall, length) regardless of the row's key insertion order:
    expect(body).toContain('const _pt_tbl_0 = g_casing({ od: 9.625, wall: p.od * 0.5, length: p.depth });');
  });

  it('a row not filling a column OMITS it (template default carries through)', () => {
    const g = tableGraph([{ size: lit(2) }, {}]); // 2nd row is empty
    const body = emitGraph(g, { id: 'pt_demo' }).body;
    expect(body).toContain('const _pt_tbl_0 = g_block({ size: 2 });');
    expect(body).toContain('const _pt_tbl_1 = g_block({});'); // no args → default size
  });

  it('empty table → an empty aggregate, no rows, no throw', () => {
    const body = emitGraph(tableGraph([]), { id: 'pt_demo' }).body;
    expect(body).toContain('const _table_1 = [];');
    expect(body).not.toContain('_pt_tbl_0');
  });
});

describe('parts_table — LIST PRODUCER (a parent Stack `...`-spreads the rows)', () => {
  it('under a Stack, the aggregate is spread so each row stays a SEPARATE body', () => {
    const g = graph({
      r: { id: 'r', type: 'list', children: ['stk'] },
      stk: { id: 'stk', type: 'stack', children: ['tbl'] },
      tbl: { id: 'tbl', type: 'parts_table', src: 'g_block', columns: ['size'], rows: THREE_ROWS },
    });
    const body = emitGraph(g, { id: 'pt_stack' }).body;
    expect(body).toContain('const _table_1 = [_pt_tbl_0, _pt_tbl_1, _pt_tbl_2];');
    // `...`-spread into the stack — same list-producer contract as parts_map / warp.
    expect(body).toContain('stack([..._table_1])');
  });
});

describe('parts_table — EXECUTE the emitted body (stub template, no WASM)', () => {
  it('the body executes to an ARRAY of exactly N instances (never one fused solid)', () => {
    const body = emitGraph(tableGraph(THREE_ROWS), { id: 'pt_demo' }).body;
    // Paramless part (rows are literals) → `function pt_demo() {…}` → body free var g_block.
    const g_block = (a: { size: number }) => ({ solid: true, size: a.size });
    // eslint-disable-next-line no-new-func
    const fn = new Function('g_block', body);
    const result = fn(g_block);
    expect(Array.isArray(result)).toBe(true);         // an ARRAY (separate), not one object
    expect(result).toHaveLength(3);                   // N rows → N instances
    expect(result.map((r: any) => r.size)).toEqual([2, 3, 4]);
    expect(result.every((r: any) => r.solid)).toBe(true);
  });
});

describe('parts_table — REAL Manifold bake: N separate bodies, distinct bbox, NO fusion', () => {
  beforeAll(async () => { await initManifold(); }, 120_000);
  beforeEach(() => { _resetDepSourceCacheForTest(); });

  // Manifold's boundingBox() → { min:[x,y,z], max:[x,y,z] } (arrays, see manifold-helpers).
  const spanX = (m: any) => { const b = m.boundingBox(); return b.max[0] - b.min[0]; };

  it('executed with a real template → 3 distinct Manifolds (distinct volumes/bbox)', () => {
    const body = emitGraph(tableGraph(THREE_ROWS), { id: 'pt_demo' }).body;
    const g_block = (a: { size: number }) => cyl(a.size, a.size); // real Manifold, r=h=size
    // eslint-disable-next-line no-new-func
    const fn = new Function('g_block', body);
    const parts = fn(g_block);
    expect(Array.isArray(parts)).toBe(true);
    expect(parts).toHaveLength(3);
    const vols = parts.map((m: any) => m.volume());
    // Distinct sizes → 3 DISTINCT volumes → the rows were NOT fused into one body.
    expect(new Set(vols.map((v: number) => v.toFixed(4))).size).toBe(3);
    expect(vols[0]).toBeLessThan(vols[1]);
    expect(vols[1]).toBeLessThan(vols[2]);
    // Each body has its own growing bbox — independent geometry, nothing merged.
    const sx = parts.map(spanX);
    expect(sx[2]).toBeGreaterThan(sx[1]);
    expect(sx[1]).toBeGreaterThan(sx[0]);
  });

  it('through the LOADER (buildPrimitiveGeom → autoPlace) → N SEPARATE _parts, never composed', async () => {
    // A shared `scale` param proves param cells bake too: size = scale * {2,3,4}.
    const g = tableGraph(
      [
        { size: { kind: 'expr', expr: 'p.scale * 2' } as ArgValue },
        { size: { kind: 'expr', expr: 'p.scale * 3' } as ArgValue },
        { size: { kind: 'expr', expr: 'p.scale * 4' } as ArgValue },
      ],
      { scale: { default: 1 } },
    );
    const source = emitGraph(g, { id: 'pt_demo' }).source;
    // The template part `g_block` — a leaf that bakes a cylinder from its `size`.
    const template = [
      `export const meta = { id: 'g_block', name: 'g_block', kind: 'asm', uses: [], params: { size: { default: 2 } } };`,
      `export function g_block(p) { return cyl(p.size, p.size); }`,
    ].join('\n');
    const fetchFn = (async (url: string) => {
      if (String(url).includes('g_block')) {
        return { ok: true, status: 200, json: async () => ({ source: template }) } as any;
      }
      throw new Error('unexpected dep fetch: ' + url);
    }) as unknown as typeof fetch;

    const fn = await buildPrimitiveGeom(source, 'pt_demo', fetchFn);
    const out: any = await fn({ scale: 1 });
    // The rows are kept as SEPARATE bodies (lazy-place), never eagerly composed.
    expect(out.__isLazyPlace).toBe(true);
    expect(Array.isArray(out._parts)).toBe(true);
    expect(out._parts).toHaveLength(3);
    // Nothing forced the union — reading _parts must not compose (M.compose fuses).
    expect(out.__composedOrNull).toBeNull();
    // 3 distinct, un-fused volumes.
    const vols = out._parts.map((m: any) => m.volume());
    expect(new Set(vols.map((v: number) => v.toFixed(4))).size).toBe(3);
    expect(vols[0]).toBeLessThan(vols[1]);
    expect(vols[1]).toBeLessThan(vols[2]);
  });
});
