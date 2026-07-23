/**
 * PartsStackKind — the "completion string" card. ONE node, N ROWS, each a
 * DIFFERENT part type (`row.src`). By default the rows mate END-TO-END in order
 * (Z-down) via the sandbox `stack([...])` helper → ONE mated body (a running string).
 * A row may instead set an absolute placement DEPTH (`row.top`): it is then PLACED at
 * that depth via `mv(elem,[0,0,top])` and pulled OUT of the mating — so ONE card
 * authors both a running string (all unanchored) AND a completion (elements at set
 * MDs). It is the heterogeneous sibling of `parts_table` (homogeneous, one shared
 * `src`, rows render SEPARATE) and the card form of the `stack` container (which mates
 * wired CHILD nodes instead of inline rows). Emits a single mated value when nothing
 * is anchored, else a LIST of separate bodies (see emitExpr + computeListProducers).
 *
 * SPLIT EMIT (mirrors PartsTableKind):
 *   • emitPartsStackBlocks (composition-emit.ts, a PRELUDE pass) emits the N per-row
 *     Call consts — `const _ps_<id>_i = <row.src>({ …args_i });` — each its OWN `src`.
 *   • emitExpr (this descriptor) emits `stack([_ps_<id>_0, …, _ps_<id>_N])` — the
 *     mated string. The consts live ABOVE it (prepended prelude, TDZ satisfied).
 * Each row's per-row material stamps meta.instanceColors keyed by partsStackRowVar
 * (a PURE fn of id + index) so color-by-source paints it, exactly like a parts_table
 * row. Rows are INLINE ArgValues, so the node consumes NO graph-node inputs.
 */
import type { NodeId } from '../../composition-graph-types';
import type { PartsStackNode } from '../../composition-graph-types';
import { type NodeKind, type ValidationError, err, checkArg } from '../node-kind';
import { rowMaterialEntry, type RowInstanceColor } from './parts-table';

/** The stable const name row `idx` of a parts_stack `id` binds to. PURE fn of
 *  (id, idx): `partsStackRowVar('n_abc', 2)` → `_ps_n_abc_2` (mirrors
 *  partsTableRowVar), so the prelude const + any color-by-source key never drift. */
export function partsStackRowVar(id: NodeId, idx: number): string {
  return `_ps_${String(id).replace(/[^A-Za-z0-9_$]/g, '_')}_${idx}`;
}

/** The `meta.instanceColors` sub-map a parts_stack contributes — each SET row
 *  material keyed by that row's own const var (partsStackRowVar). Rows already have
 *  DIFFERENT srcs (so color-by-source differentiates them by default); this override
 *  lets a row re-skin (e.g. a steel packer, a matte cement). Absent ⇒ empty ⇒
 *  byte-identical emit. */
export function partsStackInstanceColors(node: PartsStackNode): Record<string, RowInstanceColor> {
  const out: Record<string, RowInstanceColor> = {};
  const rows = Array.isArray(node.rows) ? node.rows : [];
  for (let i = 0; i < rows.length; i++) {
    const entry = rowMaterialEntry(rows[i]?.material);
    if (entry) out[partsStackRowVar(node.id, i)] = entry;
  }
  return out;
}

export const PartsStackKind: NodeKind<PartsStackNode> = {
  type: 'parts_stack',
  // Two placement modes per row (the per-row `top` field):
  //  • UNANCHORED (no top) → mated END-TO-END via `stack([...])` (a running string).
  //  • ANCHORED (top set)  → PLACED at that absolute depth via `mv(elem,[0,0,top])`,
  //    pulled OUT of the mating (a completion element at a specific MD).
  // Emit shape:
  //  • no anchored rows  → `stack([all])` — ONE mated value (NOT a list producer;
  //    a parent Stack nests it as one child). Backward-identical to before `top`.
  //  • any anchored row  → `[stack([…unanchored]), mv(a0,…), …]` — a LIST of separate
  //    bodies (each renders on its own / warps independently). Marked a list producer
  //    in computeListProducers so the root / a warp SPREADS it. The row consts come
  //    from emitPartsStackBlocks (prelude), so they exist ABOVE this expression.
  emitExpr: (node, c) => {
    const rows = Array.isArray(node.rows) ? node.rows : [];
    const vv = (i: number) => partsStackRowVar(node.id, i);
    const unanchored: number[] = [];
    const placed: string[] = [];
    rows.forEach((row, i) => {
      if (row?.top) placed.push(`mv(${vv(i)}, [0, 0, ${c.emitValue(row.top)}])`);
      else unanchored.push(i);
    });
    const mated = unanchored.length ? `stack([${unanchored.map(vv).join(', ')}])` : null;
    // No anchored rows → the single mated value (or an empty stack for an empty node).
    if (!placed.length) return mated ?? 'stack([])';
    // Any anchored → a bare array of separate bodies (mated group + each placed elem).
    return `[${[...(mated ? [mated] : []), ...placed].join(', ')}]`;
  },
  validate: (node, g) => {
    const errs: ValidationError[] = [];
    const rows = Array.isArray(node.rows) ? node.rows : [];
    rows.forEach((row, i) => {
      // A blank row `src` can't instantiate a part — surface it as a missing-node so
      // the editor greys that row (no element chosen yet), slotted `rows[i].src`.
      if (!row?.src || typeof row.src !== 'string') {
        errs.push(err(node.id, `rows[${i}].src`, String(row?.src ?? ''), 'missing-node'));
      }
      // Every arg ArgValue is missing-param checked, slotted `rows[i].<name>`.
      for (const [name, v] of Object.entries(row?.args ?? {})) {
        errs.push(...checkArg(node.id, `rows[${i}].${name}`, v, g));
      }
    });
    return errs;
  },
  // Rows are INLINE srcs (ArgValues), not wired graph-node inputs, so a parts_stack
  // consumes NO node inputs — its mated output is a root/stack child, like an
  // unwired parts_table.
  inputRefs: () => [],
  size: (node, ctx) => {
    // GROW-TO-FIT (same contract as parts_table): the card height always fits every
    // row so no row scrolls off. A manual corner-resize (layout.h) acts as a FLOOR.
    const rows = Array.isArray(node.rows) ? node.rows.length : 0;
    const fitH = Math.max(110, 64 + (rows + 1) * 24);
    const savedH = (ctx as any).layout?.h;
    const h = typeof savedH === 'number' && savedH > fitH ? savedH : fitH;
    return { w: ctx.width, h };
  },
  // ONE output (the mated string). No inputs (rows are inline); `output: true`
  // marks the node value-producing so the root/stack picks it up.
  sockets: () => ({ inputs: [], output: true }),
};
