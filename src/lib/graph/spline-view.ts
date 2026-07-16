/**
 * spline-view.ts — PURE view/geometry helpers for the SplineEditorPopup's 3D
 * scene (Batch-3 overhaul). NO three.js / DOM here so the axis-lock + bbox math
 * is headless-testable; the Threlte scene (SplineScene.svelte) consumes these.
 *
 * VIEW-ONLY: none of this touches the spline DATA model (points stay
 * `[x,y,z][]`) — it only decides how the editor DRAWS + constrains dragging.
 */

import type { Vec3 } from './spline-resample';

/** The four editor views: free 3D orbit + three flat orthographic planes. */
export type SplineView = 'free' | 'xy' | 'yz' | 'xz';

/** Which axis indices a plane view spans (u,v) and which it LOCKS (out-of-plane). */
export interface PlaneAxes {
  /** Horizontal-ish in-plane axis index (0=x,1=y,2=z). */
  uAxis: 0 | 1 | 2;
  /** Vertical-ish in-plane axis index. */
  vAxis: 0 | 1 | 2;
  /** Out-of-plane axis index — LOCKED while dragging in this view. */
  lockAxis: 0 | 1 | 2;
}

/** Axis assignment per plane view. `null` for the free 3D view (no lock). */
export function planeAxes(view: SplineView): PlaneAxes | null {
  switch (view) {
    case 'xy': return { uAxis: 0, vAxis: 1, lockAxis: 2 };
    case 'xz': return { uAxis: 0, vAxis: 2, lockAxis: 1 };
    case 'yz': return { uAxis: 1, vAxis: 2, lockAxis: 0 };
    default: return null; // 'free'
  }
}

/** Preserve the out-of-plane coordinate: take the in-plane axes from `hit`, the
 *  locked axis from `orig`. Rounds to 3 dp to keep stored coords clean (matches
 *  the free-drag path). */
export function applyPlaneLock(orig: Vec3, hit: Vec3, lockAxis: 0 | 1 | 2): Vec3 {
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  const out: Vec3 = [r3(hit[0]), r3(hit[1]), r3(hit[2])];
  out[lockAxis] = orig[lockAxis]; // locked axis unchanged
  return out;
}

export interface Bbox {
  min: Vec3;
  max: Vec3;
  center: Vec3;
  /** Largest single-axis span (0 → a single point / empty). */
  span: number;
}

/** Axis-aligned bounding box of the control points (defaults to a unit box at
 *  the origin when there are none, so the grid never collapses to 0). */
export function pointsBbox(points: Vec3[]): Bbox {
  const pts = points.filter((p) => Array.isArray(p) && p.length >= 3);
  if (pts.length === 0) {
    return { min: [-1, -1, -1], max: [1, 1, 1], center: [0, 0, 0], span: 2 };
  }
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) {
    for (let a = 0; a < 3; a++) {
      const v = Number(p[a]) || 0;
      if (v < min[a]!) min[a] = v;
      if (v > max[a]!) max[a] = v;
    }
  }
  const center: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const span = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], 0);
  return { min, max, center, span };
}

/** Grid size (world units) + division count sized to a point cloud's extent —
 *  padded so points sit inside, never on the edge. Returns an even division
 *  count for a centered cross. */
export function gridFor(maxSpan: number): { size: number; divisions: number } {
  const size = Math.max(6, Math.ceil(maxSpan * 1.5));
  let divisions = Math.round(size);
  divisions = Math.max(4, Math.min(40, divisions));
  if (divisions % 2 === 1) divisions += 1; // even → a line through the centre
  return { size, divisions };
}

// ─── snap-to-grid (editor drag aid) ─────────────────────────────────────────
/** Round `v` to the nearest multiple of `step` (the visible grid cell) — the
 *  snap-to-grid drag aid. A non-positive / non-finite step returns `v` cleaned to
 *  3 dp (no snap); a snapped value is also cleaned to 3 dp so stored coords stay
 *  tidy (matches the free-drag `r3`). PURE — the DATA model is only touched when
 *  the caller writes the snapped point back. */
export function snapCoord(v: number, step: number): number {
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  if (!Number.isFinite(step) || step <= 0) return r3(Number(v) || 0);
  return r3(Math.round((Number(v) || 0) / step) * step);
}

/** Snap every axis of a point to the grid `step`. */
export function snapVec3(p: Vec3, step: number): Vec3 {
  return [snapCoord(p[0], step), snapCoord(p[1], step), snapCoord(p[2], step)];
}

// ─── import / paste points (bulk control-point entry) ───────────────────────
/** Parse pasted / imported control points for the editor's bulk-entry box.
 *  Accepts EITHER a JSON array-of-arrays (`[[x,y,z],[x,y],…]`) or a flat numeric
 *  array (`[x,y,z,x,y,z,…]`, chunked by 3), OR one point per line / row as comma-
 *  or whitespace-separated numbers (`0 0 0` ⏎ `3, 1, 0`). Surrounding brackets /
 *  parens per row are tolerated. 2D `[x,y]` points pad to `z = 0`; short rows and
 *  non-finite values are dropped. Returns the parsed `Vec3[]` — possibly `[]`; the
 *  caller decides whether ≥ 2 points is usable. PURE + never throws. */
export function parsePointsInput(text: string): Vec3[] {
  const raw = String(text ?? '').trim();
  if (!raw) return [];
  const rows: number[][] = [];
  // 1) JSON first — an array of arrays, or a flat array of numbers.
  try {
    const j = JSON.parse(raw);
    if (Array.isArray(j)) {
      if (j.length > 0 && j.every((e) => Array.isArray(e))) {
        for (const e of j) rows.push((e as unknown[]).map((n) => Number(n)));
      } else if (j.length >= 3 && j.every((e) => typeof e === 'number')) {
        for (let i = 0; i + 2 < j.length; i += 3) rows.push([Number(j[i]), Number(j[i + 1]), Number(j[i + 2])]);
      }
    }
  } catch { /* not JSON — fall through to per-line parsing */ }
  // 2) Fallback: one point per line / row (comma- or whitespace-separated).
  if (rows.length === 0) {
    for (const line of raw.split(/[\r\n;]+/)) {
      const nums = line.trim().replace(/[[\]()]/g, '').split(/[\s,]+/).filter(Boolean).map(Number);
      if (nums.length >= 2) rows.push(nums);
    }
  }
  const out: Vec3[] = [];
  for (const r of rows) {
    if (!r || r.length < 2) continue;
    const x = Number(r[0]);
    const y = Number(r[1]);
    const z = r.length >= 3 ? Number(r[2]) : 0;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    out.push([x, y, z]);
  }
  return out;
}
