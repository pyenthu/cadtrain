/**
 * PartsTableKind — the #38b PARTS-TABLE card. ONE node, N ROWS of the SAME
 * template part (`src`); the COLUMNS are that part's params; each ROW is an
 * independent set of per-column ArgValues. It emits N SEPARATE Call instructions,
 * each bound to its OWN stable-named output const, and the rows ALWAYS render
 * SEPARATE (a LIST PRODUCER whose aggregate spreads into the root → each row
 * autoPlaces as its own `_parts` body — NO compose / NO fusion).
 *
 * This is the graph-native sibling of `parts_map` (#38 P3): where a parts_map maps
 * a `list<record>` PARAM through ONE shared arg-map to a single `Array.from(...)`
 * LIST socket, a parts_table authors the rows INLINE on the node and hands each
 * row its OWN output socket. It BUILDS ON the parts_map machinery — the same
 * list-producer spread (computeListProducers) + `src`→meta.uses dependency wiring.
 *
 * SPLIT EMIT (mirrors ExprKind + emitExprBlocks):
 *   • emitPartsTableBlocks (composition-emit.ts, a PRELUDE pass) emits the actual
 *     N Call consts — `const <rowVar_i> = <src>({ …row_i });` — one per row.
 *   • emitExpr (this descriptor, the node-expression pass) emits the AGGREGATE of
 *     row-var refs — `[<rowVar_0>, …, <rowVar_N>]` — a bare JS array marked a LIST
 *     PRODUCER, so the root returns it and the loader separates it into `_parts`.
 * Each row's output socket resolves to `partsTableRowVar(node.id, i)` (a PURE fn of
 * node id + row index, exactly like exprBlockMember), so a downstream wire can
 * target ONE row without depending on emit's var-name assignment.
 */
import type { NodeId, ArgValue } from '$lib/graph/composition/composition-graph-types';
import type { PartsTableNode, RowMaterial } from '$lib/graph/composition/composition-graph-types';
import { type NodeKind, type ValidationError, err, checkArg, has } from '../node-kind';

/** The loop-body arg-map for a WIRED parts_table (#38c): each declared column →
 *  the row object's field of the same name, read off the per-element binding `s`
 *  (`{kind:'expr', expr:'s.<col>'}`) — the SAME `s.<field>` access parts_map uses.
 *  Deterministic (declared `columns` order); an empty column set yields `{}` (the
 *  template's own defaults carry through). Columns are template PARAM names (valid
 *  identifiers), so dot access is safe. */
export function partsTableDataArgMap(node: PartsTableNode): Record<string, ArgValue> {
  const cols = Array.isArray(node.columns) ? node.columns : [];
  const out: Record<string, ArgValue> = {};
  for (const col of cols) out[col] = { kind: 'expr', expr: `s.${col}` };
  return out;
}

/** One row's per-instance appearance-override ENTRY — the `{ outer?, opacity?,
 *  material? }` shape `meta.instanceColors` carries and part-colors.appearanceFrom-
 *  Override reads back. Maps a RowMaterial (`color→outer`, `preset→material`,
 *  `opacity`) to only its SET, well-formed fields; an all-empty / null material
 *  yields null so nothing is stamped (byte-identical). */
export type RowInstanceColor = { outer?: string; opacity?: number; material?: string };
export function rowMaterialEntry(mat: RowMaterial | null | undefined): RowInstanceColor | null {
  if (!mat || typeof mat !== 'object') return null;
  const entry: RowInstanceColor = {};
  if (typeof mat.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(mat.color)) entry.outer = mat.color;
  if (typeof mat.opacity === 'number' && mat.opacity > 0 && mat.opacity < 1) entry.opacity = mat.opacity;
  if (typeof mat.preset === 'string' && mat.preset && mat.preset !== 'none') entry.material = mat.preset;
  return Object.keys(entry).length ? entry : null;
}

/** The `meta.instanceColors` sub-map a parts_table contributes (#38d) — each SET
 *  row material keyed by the row's OWN output var (`partsTableRowVar(id, i)`, ==
 *  the loader's per-row instance name), so the color-by-source LUT paints each row
 *  in its override. EMPTY when no rowMaterials are set → nothing is stamped → the
 *  emit is byte-identical to a table with no overrides. */
export function partsTableInstanceColors(node: PartsTableNode): Record<string, RowInstanceColor> {
  const out: Record<string, RowInstanceColor> = {};
  // A WIRED table (#38c) has no fixed `partsTableRowVar` consts — its rows come from
  // the upstream list at runtime — so per-row material overrides don't apply; stamp
  // nothing (keying by non-existent vars would only add dead entries to meta).
  if (node.dataInput) return out;
  // CARD-LEVEL override (#38d) → a BASE applied to EVERY row; the per-row override
  // (rowMaterials[i]) WINS field-by-field over it. Absent card-level + absent row ⇒
  // an empty merge ⇒ nothing stamped ⇒ byte-identical emit.
  const base = rowMaterialEntry(node.tableMaterial);
  const mats = Array.isArray(node.rowMaterials) ? node.rowMaterials : [];
  const rows = Array.isArray(node.rows) ? node.rows : [];
  for (let i = 0; i < rows.length; i++) {
    const merged = { ...(base ?? {}), ...(rowMaterialEntry(mats[i]) ?? {}) };
    if (Object.keys(merged).length) out[partsTableRowVar(node.id, i)] = merged;
  }
  return out;
}

/** The stable const name row `idx` of a parts_table `id` binds to — its OWN output
 *  socket. PURE fn of (id, idx): `partsTableRowVar('n_abc', 2)` → `_pt_n_abc_2`.
 *  Both the PRELUDE (row-const emit) and any downstream socket wire compute the
 *  SAME name from this, so they can never drift (mirrors exprBlockMember). */
export function partsTableRowVar(id: NodeId, idx: number): string {
  return `_pt_${String(id).replace(/[^A-Za-z0-9_$]/g, '_')}_${idx}`;
}

/** The per-column arg keys of a row, in the node's declared `columns` order
 *  (deterministic emit), skipping columns the row doesn't fill so the template's
 *  own default carries through. A row key not in `columns` is appended last (so a
 *  hand-authored / partial file never silently drops data). */
export function orderedRowKeys(node: PartsTableNode, row: Record<string, unknown>): string[] {
  const cols = Array.isArray(node.columns) ? node.columns : [];
  const inCols = cols.filter((c) => Object.prototype.hasOwnProperty.call(row, c));
  const extra = Object.keys(row).filter((k) => !cols.includes(k));
  return [...inCols, ...extra];
}

export const PartsTableKind: NodeKind<PartsTableNode> = {
  type: 'parts_table',
  // The node-expression pass emits only the AGGREGATE of row-var refs — the row
  // Call consts themselves are emitted by emitPartsTableBlocks (the prelude), so
  // they exist ABOVE this array (JS const TDZ satisfied). Marked a list producer
  // in computeListProducers ⇒ the root returns it bare / a Stack `...`-spreads it,
  // and the loader separates each element into its own `_parts` body (no fusion).
  emitExpr: (node, c) => {
    // WIRED external data-input (#38c): source the rows FROM the upstream list at
    // runtime — the parts_map lowering. Each declared column maps to the element's
    // field of the same name (`s.<col>`), and the whole thing is a bare `Array.from`
    // array (still a LIST PRODUCER, so the root / a parent Stack spreads it). The
    // upstream var comes via ctx.ref (topo-order guarantees it is emitted first).
    if (node.dataInput) {
      const rows = c.ref(node.dataInput, 'dataInput');
      const call = c.emitCall(node.src, partsTableDataArgMap(node));
      return `Array.from(${rows}, (s, i) => ${call})`;
    }
    // UNWIRED (the default): the AGGREGATE of the N inline per-row output-socket refs
    // — the actual row Call consts come from the emitPartsTableBlocks PRELUDE.
    const rows = Array.isArray(node.rows) ? node.rows : [];
    return `[${rows.map((_, i) => partsTableRowVar(node.id, i)).join(', ')}]`;
  },
  validate: (node, g) => {
    const errs: ValidationError[] = [];
    // A blank `src` can't instantiate a part — surface it as a missing-node so the
    // editor greys the card (no template selected yet), exactly like parts_map.
    if (!node.src || typeof node.src !== 'string') {
      errs.push(err(node.id, 'src', String(node.src ?? ''), 'missing-node'));
    }
    // A WIRED data-input (#38c) that points at a deleted node is a broken reference —
    // surface it as a missing-node (slot `dataInput`) so /save + /preview refuse it
    // before the emitted `Array.from(<undefined>, …)` crashes downstream.
    if (node.dataInput && !has(g, node.dataInput)) {
      errs.push(err(node.id, 'dataInput', node.dataInput, 'missing-node'));
    }
    // Every cell ArgValue is missing-param checked (a param whose column/row was
    // deleted surfaces as an orphaned cell), slotted `rows[i].<col>` so the editor
    // can pinpoint the offending cell.
    (Array.isArray(node.rows) ? node.rows : []).forEach((row, i) => {
      for (const [col, v] of Object.entries(row ?? {})) {
        errs.push(...checkArg(node.id, `rows[${i}].${col}`, v, g));
      }
    });
    return errs;
  },
  // Inline rows are ArgValues (not graph-node inputs), so an UNWIRED parts_table
  // consumes no node inputs — its aggregate is a root/stack child (same as parts_map).
  // A WIRED table (#38c) CONSUMES its upstream list-producer (`dataInput`): listing it
  // here marks it consumed (so it is not ALSO a root output) and forces topo-order to
  // emit the upstream var BEFORE this table's `Array.from(<upstreamVar>, …)`.
  inputRefs: (node) => (node.dataInput ? [node.dataInput] : []),
  size: (node, ctx) => {
    // GROW-TO-FIT (user chose "grow-to-fit, H-scroll only" 2026-07-13): the card
    // height always fits EVERY row — no vertical scroll — so each row's right-edge
    // output socket stays visible and wire-aligned (a scrolled-off socket would
    // detach from its wire). Columns scroll HORIZONTALLY instead (`.pt-scroll`).
    // A manual corner-resize (layout.h) acts only as a FLOOR: the card can be
    // dragged TALLER (extra pad) but never shorter than its rows (which would clip
    // a socket). Width comes from ctx.width (nodeSize honors the persisted layout.w).
    const rows = Array.isArray(node.rows) ? node.rows.length : 0;
    const fitH = Math.max(110, 64 + (rows + 1) * 24);
    const savedH = (ctx as any).layout?.h;
    const h = typeof savedH === 'number' && savedH > fitH ? savedH : fitH;
    return { w: ctx.width, h };
  },
  // ONE optional list-input slot `data` (#38c) — the top-left socket a wire targets
  // to source the rows from an upstream list-producer. Always present (it's a drop
  // target whether wired or not). The N per-ROW output sockets are rendered by the
  // card component itself (the generic SocketSchema.output can't express N outputs);
  // `output: true` marks the node as value-producing.
  sockets: () => ({ inputs: ['data'], output: true }),
};
