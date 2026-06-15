/**
 * Sketch card column layout — the SINGLE source of truth for the sketch op-row
 * geometry, shared by GraphEditorPane's socket math, `nodeSize`, and
 * `miniLayout`. Kept pure + framework-free so it is unit-testable
 * (`sketch-collayout.test.ts`) and importable by the Svelte component.
 *
 * ── THE PIXEL CONTRACT (mirrors the warning at GraphEditorPane CSS L8586-8589) ──
 * `SKETCH_COL_W` MUST equal the future `.ge-sketch-col` width and
 * `SKETCH_COL_GAP` MUST equal that flex row's `gap`, or the SVG wire sockets
 * (positioned from `sketchColLayout`) will drift off the HTML op rows. The other
 * half of the contract is `sketchEntryH` vs the `.ge-sketch-vtx` row height.
 *
 * Distribution: sequential (column-major) fill balanced by HEIGHT, never
 * round-robin by count — each column holds a CONTIGUOUS range of ops (col 0 =
 * ops 0..k, col 1 = ops k+1..m, …) so a future read-sequence arrow stays
 * legible, and ops are heterogeneous (fillet=24 vs line=45) so equal-count
 * splits leave uneven heights. An op is never split across columns.
 */

/** Inner content width per column (≈ MINI_SCW − 12 = 152 − 12). */
export const SKETCH_COL_W = 140;
/** Inter-column gutter; wide enough to host an interior wire socket. */
export const SKETCH_COL_GAP = 16;

export type SketchCell = { op: any; idx: number; col: number; x: number; yTop: number };
export type SketchColLayout = {
  /** Partition for the `#each` render — op order preserved within each column. */
  columns: SketchCell[][];
  /** Same cells indexed by ORIGINAL op idx — socket/row lookup. */
  byIdx: SketchCell[];
  colWidth: number;
  gap: number;
  /** Max column pixel height (drives card height). */
  tallestH: number;
  /** Total content width: cols*colWidth + (cols-1)*gap. */
  innerW: number;
};

/** Per-op row height: corner ops (fillet/chamfer) are one short row (24); a
 *  line/spline renders a stacked r/z pair (45 = POLY_VTX_PITCH; socket math
 *  adds +12/+31). */
export function sketchEntryH(op: any): number {
  return op?.op === 'fillet' || op?.op === 'chamfer' ? 24 : 45;
}

export function sketchColLayout(ops: any[], cols: 1 | 2 | 3): SketchColLayout {
  const list = ops ?? [];
  const n = list.length;
  const k = cols === 2 || cols === 3 ? cols : 1;
  const colWidth = SKETCH_COL_W;
  const gap = SKETCH_COL_GAP;
  const innerW = k * colWidth + (k - 1) * gap;

  const columns: SketchCell[][] = [];
  const byIdx: SketchCell[] = new Array(n);

  if (k === 1) {
    // Byte-identical to the legacy single-column walk: every cell x=0,
    // yTop = 36 + Σ sketchEntryH(prior ops). 36 = header + divider.
    const col0: SketchCell[] = [];
    let y = 36;
    for (let i = 0; i < n; i++) {
      const cell: SketchCell = { op: list[i], idx: i, col: 0, x: 0, yTop: y };
      col0.push(cell);
      byIdx[i] = cell;
      y += sketchEntryH(list[i]);
    }
    columns.push(col0);
    return { columns, byIdx, colWidth, gap, tallestH: y - 36, innerW };
  }

  // Column-major fill balanced by HEIGHT. target = total/cols; advance to the
  // next column when adding the next op would exceed `target` AND columns
  // remain (and the current column is non-empty, so we never split an op nor
  // leave an interior column empty by over-eager wrapping).
  const total = list.reduce((a, o) => a + sketchEntryH(o), 0);
  const target = total / k;
  for (let c = 0; c < k; c++) columns.push([]);
  let col = 0;
  let colH = 0;
  for (let i = 0; i < n; i++) {
    const h = sketchEntryH(list[i]);
    if (col < k - 1 && columns[col].length > 0 && colH + h > target) {
      col++;
      colH = 0;
    }
    const cell: SketchCell = {
      op: list[i],
      idx: i,
      col,
      x: col * (colWidth + gap),
      yTop: 36 + colH,
    };
    columns[col].push(cell);
    byIdx[i] = cell;
    colH += h;
  }

  let tallestH = 0;
  for (const cc of columns) {
    const hh = cc.reduce((a, cell) => a + sketchEntryH(cell.op), 0);
    if (hh > tallestH) tallestH = hh;
  }
  return { columns, byIdx, colWidth, gap, tallestH, innerW };
}
