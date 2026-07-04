/**
 * label-layout.ts — pure 1-D force de-overlap for depth-axis labels.
 *
 * A dependency-free re-implementation of the label-spreading pass SVTC drives
 * with `labella` (`labella.Force({ algorithm: 'simple' })`, see
 * `~/code/SVTC/src/lib/apps/wson/wsonRender.js`). Given each label's IDEAL
 * position along one axis (here the depth/Y pixel of its anchor) it nudges the
 * labels apart so none overlap while every label stays as close to its ideal as
 * possible AND the original depth ORDER is preserved.
 *
 * Algorithm — the classic order-preserving cluster merge (equivalent to
 * labella's "simple" force): sort by ideal, then greedily grow clusters. Two
 * adjacent clusters that would overlap (centre-to-centre gap < `gap`) merge into
 * one whose members are laid out consecutively `gap` apart, CENTRED on the
 * weighted mean of the members' ideals. Merging can cascade, so we re-check the
 * tail after every push. The result is provably monotonic (labels never swap
 * order) and non-overlapping (adjacent spacing ≥ `gap`), then clamped into
 * `[min, max]` — shifting when it fits, compressing evenly when it does not.
 *
 * Pure + framework-free so it unit-tests headless (`label-layout.test.ts`) and
 * is reused by `WellDepthRuler.svelte`.
 */

export interface SpreadOpts {
  /** Minimum centre-to-centre spacing between adjacent labels (px). */
  gap: number;
  /** Lower clamp for the returned positions (px). Default -Infinity. */
  min?: number;
  /** Upper clamp for the returned positions (px). Default +Infinity. */
  max?: number;
}

interface Cluster {
  /** Index (into the ideal-sorted order) of this cluster's first member. */
  start: number;
  /** Number of contiguous members. */
  count: number;
  /** Sum of member ideal positions (→ mean = sum / count). */
  sum: number;
}

/**
 * Spread `ideals` so adjacent values are ≥ `gap` apart, kept in ascending
 * order, each as close to its ideal as possible, clamped to `[min, max]`.
 * Returns positions in the SAME index order as the input.
 */
export function spreadLabels(ideals: number[], opts: SpreadOpts): number[] {
  const n = ideals.length;
  if (n === 0) return [];
  const gap = Math.max(0, opts.gap);
  const min = opts.min ?? -Infinity;
  const max = opts.max ?? Infinity;

  if (n === 1) {
    let y = ideals[0]!;
    if (y < min) y = min;
    if (y > max) y = max;
    return [y];
  }

  // Sort by ideal, remembering the original index so we can un-sort at the end.
  const order = ideals
    .map((v, i) => ({ v, i }))
    .sort((a, b) => a.v - b.v);

  const firstPos = (c: Cluster) => c.sum / c.count - ((c.count - 1) * gap) / 2;
  const lastPos = (c: Cluster) => firstPos(c) + (c.count - 1) * gap;

  const clusters: Cluster[] = [];
  for (let k = 0; k < n; k++) {
    clusters.push({ start: k, count: 1, sum: order[k]!.v });
    // Cascade-merge with the previous cluster while they would overlap.
    while (clusters.length >= 2) {
      const b = clusters[clusters.length - 1]!;
      const a = clusters[clusters.length - 2]!;
      if (firstPos(b) < lastPos(a) + gap - 1e-9) {
        a.count += b.count;
        a.sum += b.sum;
        clusters.pop();
      } else break;
    }
  }

  // Lay members out consecutively within each cluster.
  const out = new Array<number>(n);
  for (const c of clusters) {
    let p = firstPos(c);
    for (let m = 0; m < c.count; m++) {
      out[order[c.start + m]!.i] = p;
      p += gap;
    }
  }

  // ── Clamp into [min, max] ──────────────────────────────────────────────────
  // Positions are ascending in sorted order; find the sorted-space extremes.
  const firstIdx = order[0]!.i;
  const lastIdx = order[n - 1]!.i;
  const lo = out[firstIdx]!;
  const hi = out[lastIdx]!;
  const span = hi - lo;
  const avail = max - min;

  if (Number.isFinite(avail) && span > avail) {
    // Cannot fit even at `gap` spacing → distribute evenly across [min, max].
    for (let k = 0; k < n; k++) {
      out[order[k]!.i] = min + (avail * k) / (n - 1);
    }
    return out;
  }

  let shift = 0;
  if (lo < min) shift = min - lo;
  else if (hi > max) shift = max - hi;
  if (shift !== 0) for (let i = 0; i < n; i++) out[i] = out[i]! + shift;

  return out;
}
