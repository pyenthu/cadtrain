/**
 * crease-normals — crease-aware per-corner smooth normals for EXACT-KERNEL
 * meshes (TrueForm + OCCT/BREP).
 *
 * Extracted from `trueform-adapter.ts` (2026-07-12) so the TrueForm AND the BREP
 * render adapters share ONE implementation instead of each carrying a copy. Both
 * consume welded/near-coincident indexed solids from an exact boolean kernel and
 * need the SAME shading pass: smooth across shallow dihedrals (curved walls,
 * revolve rings), hard at real creases (rims, chamfers, box corners).
 *
 * WHY THIS IS SEPARATE FROM `cad/render-helpers.ts:creaseAwareCornerNormals`
 * (the Manifold path's twin): the two differ in their WELD STRATEGY, not just a
 * `weldTol` — this one welds adjacency by a spatial TOLERANCE (union-find over a
 * grid, {@link toleranceWeldMap}) to reconnect an exact kernel's near-coincident
 * seam / T-junction verts, whereas the Manifold twin welds by EXACT 1e-4 position
 * rounding. They are NOT byte-interchangeable (grid-cell rounding vs
 * distance-based union-find group differently on edge cases), and the Manifold
 * path's normals are pinned byte-identical by goldens, so a full 3-way merge is
 * DEFERRED. This module is the 2-way dedup (TF + BREP).
 *
 * Pure math — no THREE / no Manifold — so it is safe to import from the lean,
 * worker-transferable adapters.
 */

/** Default crease angle (deg) — matches the Manifold live-mesh path (60°). */
export const DEFAULT_CREASE_ANGLE = 60;

/**
 * Weld a mesh's vertices for NORMAL ADJACENCY by a spatial TOLERANCE (not exact
 * position). Returns `weldOf[i]` = the representative vertex index of `i`'s weld
 * group. Merges any two verts within `tol` via union-find over a spatial hash
 * (cell = `tol`, 27-neighbour scan) so it is ROBUST to grid-boundary straddling
 * (which plain position-rounding is not).
 *
 * WHY A TOLERANCE, not exact welding: an EXACT-kernel boolean (TrueForm / OCCT)
 * that merges coaxial/coplanar solids leaves the union seam with near-coincident
 * but NOT equal vertices + T-junctions — verts up to a few % of an edge length
 * apart (measured ~0.02 on a demo drill-pipe joint). Exact / 1e-4 welding leaves
 * those unmerged, so adjacent wall facets across the seam share no vertex → each
 * keeps its own facet normal → the composite reads FLAT even though a standalone
 * (un-booleaned) part of the same geometry shades smooth. Welding within a small
 * fraction of the local edge length reconnects them; over-welding is harmless
 * because the caller's crease-angle test still refuses to average across genuine
 * hard edges (a box corner, a pipe rim).
 */
export function toleranceWeldMap(pos: ArrayLike<number>, tri: ArrayLike<number>, tol: number): Int32Array {
  const nv = (pos.length / 3) | 0;
  const parent = new Int32Array(nv);
  for (let i = 0; i < nv; i++) parent[i] = i;
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const uni = (a: number, b: number) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
  const cell = tol > 0 ? tol : 1e-9;
  const grid = new Map<string, number[]>();
  const gk = (x: number, y: number, z: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  for (let i = 0; i < nv; i++) {
    const k = gk(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
  }
  const e2 = tol * tol;
  for (let i = 0; i < nv; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const nb = grid.get(`${Math.floor(x / cell) + dx},${Math.floor(y / cell) + dy},${Math.floor(z / cell) + dz}`);
      if (!nb) continue;
      for (const j of nb) {
        if (j <= i) continue;
        const ddx = pos[j * 3] - x, ddy = pos[j * 3 + 1] - y, ddz = pos[j * 3 + 2] - z;
        if (ddx * ddx + ddy * ddy + ddz * ddz <= e2) uni(i, j);
      }
    }
  }
  const weldOf = new Int32Array(nv);
  for (let i = 0; i < nv; i++) weldOf[i] = find(i);
  return weldOf;
}

/** Sorted, sampled triangle-edge lengths (ascending, non-degenerate only). The
 *  common core behind {@link medianEdgeLength} + {@link edgeLengthPercentile};
 *  sampled (stride) so the sort stays cheap on large meshes. Empty ⇒ []. */
function sampledEdgeLengths(pos: ArrayLike<number>, tri: ArrayLike<number>): number[] {
  const nt = (tri.length / 3) | 0;
  if (nt === 0) return [];
  const stride = Math.max(1, Math.floor(nt / 20000)); // cap the sample at ~60k edges
  const lens: number[] = [];
  for (let t = 0; t < nt; t += stride) {
    const a = tri[t * 3], b = tri[t * 3 + 1], c = tri[t * 3 + 2];
    for (const [x, y] of [[a, b], [b, c], [c, a]] as const) {
      const d = Math.hypot(pos[x * 3] - pos[y * 3], pos[x * 3 + 1] - pos[y * 3 + 1], pos[x * 3 + 2] - pos[y * 3 + 2]);
      if (d > 0) lens.push(d);
    }
  }
  lens.sort((p, q) => p - q);
  return lens;
}

/** MEDIAN triangle edge length — the local feature scale the weld tolerance is
 *  derived from (so the tolerance auto-scales with part size AND mesh resolution;
 *  proven scale-invariant on a ×0.01 shrink). Returns 0 for a mesh with no
 *  non-degenerate edges. */
export function medianEdgeLength(pos: ArrayLike<number>, tri: ArrayLike<number>): number {
  const lens = sampledEdgeLengths(pos, tri);
  return lens.length === 0 ? 0 : lens[lens.length >> 1];
}

/** A LOW percentile (`q` in 0..1) of triangle-edge length — a robust proxy for
 *  the mesh's SHORTEST real edges (the circumferential edges of a fine revolve /
 *  cylinder wall), robust to a stray degenerate sliver a boolean can leave (which
 *  a raw min would latch onto). Returns 0 for a mesh with no non-degenerate edges. */
export function edgeLengthPercentile(pos: ArrayLike<number>, tri: ArrayLike<number>, q: number): number {
  const lens = sampledEdgeLengths(pos, tri);
  if (lens.length === 0) return 0;
  const i = Math.max(0, Math.min(lens.length - 1, Math.floor(q * (lens.length - 1))));
  return lens[i];
}

/** Weld tolerance as a fraction of the median edge — 0.25 recovers a booleaned
 *  composite's smooth walls (58% → 97% of side-wall corners on the demo joint,
 *  1.00 on a ×0.01 shrink) while leaving a clean standalone part at 1.00. */
const WELD_TOL_FRACTION = 0.25;

/** HARD CAP on the weld tolerance as a fraction of the mesh's shortest real edges
 *  ({@link edgeLengthPercentile} at {@link WELD_TOL_MIN_EDGE_Q}). WHY: the median
 *  edge is a BAD scale on a mesh with anisotropic edges — a revolve's caps
 *  contribute long radial/axial edges, so `0.25 × median` can EXCEED the SHORT
 *  circumferential wall edges once the segment count is high enough (g_shaft: at
 *  24 segs circ-edge 0.131 > tol 0.125 → distinct; at 32 segs circ-edge 0.098 <
 *  tol 0.125 → union-find CHAINS the entire ring into ONE weld group → the wall's
 *  per-vertex normals collapse to per-FACET → FLAT shading at HIGHER resolution,
 *  the paradox). The invariant that fixes it: any two verts joined by a real edge
 *  are GENUINELY DISTINCT and must never weld, so tol must stay strictly BELOW the
 *  shortest real edge. Boolean-seam verts (the case the weld exists for) come from
 *  DIFFERENT operands with NO edge between them, so they still merge under this cap.
 *  On an ISOTROPIC composite (median ≈ shortest edge) `0.25 × median` already sits
 *  below this cap, so the composite behaviour is unchanged. */
const WELD_TOL_MAX_EDGE_FRACTION = 0.5;
/** Percentile used for "shortest real edge" — a low percentile (not the raw min)
 *  so a single boolean sliver edge doesn't shrink the tolerance to nothing. */
const WELD_TOL_MIN_EDGE_Q = 0.05;

/**
 * Crease-aware per-corner normals for a welded indexed triangle mesh.
 *
 * `pos` is the welded [V*3] position buffer, `tri` the flat [F*3] index buffer.
 * Returns a NON-INDEXED [F*9] normal buffer (one normal per triangle corner) to
 * pair with a non-indexed position buffer. Adjacency is by TOLERANCE-WELDED
 * POSITION ({@link toleranceWeldMap}, ~0.25× the median edge) so an exact
 * boolean's near-coincident seam / T-junction verts still share a smooth band —
 * fixing the "composite shades FLAT" bug; a corner only averages incident faces
 * within `creaseDeg` of its own face, so sharp edges (pipe rims, box corners)
 * stay hard. Mirrors the canonical `render-helpers.ts:creaseAwareCornerNormals`
 * (pure math, no THREE/Manifold). `weldTol` overrides the auto-derived tolerance.
 */
export function creaseAwareCornerNormals(pos: ArrayLike<number>, tri: ArrayLike<number>, creaseDeg: number, weldTol?: number): Float32Array {
  const nt = (tri.length / 3) | 0;
  const nv = (pos.length / 3) | 0;
  // Per-face area-weighted normal (raw cross, |·| = 2·area) + its unit direction.
  const faceN = new Float32Array(nt * 3);
  const faceU = new Float32Array(nt * 3);
  for (let t = 0; t < nt; t++) {
    const a = tri[t * 3], b = tri[t * 3 + 1], c = tri[t * 3 + 2];
    const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
    const bx = pos[b * 3], by = pos[b * 3 + 1], bz = pos[b * 3 + 2];
    const cx = pos[c * 3], cy = pos[c * 3 + 1], cz = pos[c * 3 + 2];
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    faceN[t * 3] = nx; faceN[t * 3 + 1] = ny; faceN[t * 3 + 2] = nz;
    const l = Math.hypot(nx, ny, nz) || 1;
    faceU[t * 3] = nx / l; faceU[t * 3 + 1] = ny / l; faceU[t * 3 + 2] = nz / l;
  }
  // Weld corners by a spatial TOLERANCE so a smooth band averages across its
  // facets even when an exact boolean left near-coincident (not equal) seam verts
  // — the composite-flat-shading fix (see toleranceWeldMap). The tolerance is
  // 0.25× the MEDIAN edge (part-size + resolution adaptive) but HARD-CAPPED below
  // the mesh's SHORTEST real edges (0.5× a low edge-length percentile) so it can
  // NEVER chain edge-adjacent verts — otherwise a fine revolve's short
  // circumferential edges fall under the median-derived tol and the whole ring
  // collapses to one weld group → FLAT-at-higher-resolution (see the constants).
  // Boolean seams (different operands, no connecting edge) still merge; an
  // isotropic composite (median ≈ shortest edge) keeps the plain 0.25× behaviour.
  const tol = weldTol != null
    ? weldTol
    : Math.min(
        WELD_TOL_FRACTION * medianEdgeLength(pos, tri),
        WELD_TOL_MAX_EDGE_FRACTION * edgeLengthPercentile(pos, tri, WELD_TOL_MIN_EDGE_Q),
      );
  const weldOf = toleranceWeldMap(pos, tri, tol);
  const inc: number[][] = new Array(nv);
  for (let t = 0; t < nt; t++) {
    for (let k = 0; k < 3; k++) {
      const rep = weldOf[tri[t * 3 + k]];
      (inc[rep] ?? (inc[rep] = [])).push(t);
    }
  }
  const cosThresh = Math.cos((creaseDeg * Math.PI) / 180);
  const out = new Float32Array(nt * 9);
  for (let t = 0; t < nt; t++) {
    const ux = faceU[t * 3], uy = faceU[t * 3 + 1], uz = faceU[t * 3 + 2];
    for (let k = 0; k < 3; k++) {
      const v = tri[t * 3 + k];
      let sx = 0, sy = 0, sz = 0;
      const list = inc[weldOf[v]];
      for (let j = 0; j < list.length; j++) {
        const t2 = list[j];
        // Include a neighbour face only when it's within the crease angle of
        // THIS face (always include self). Area weight comes from faceN's mag.
        const dot = ux * faceU[t2 * 3] + uy * faceU[t2 * 3 + 1] + uz * faceU[t2 * 3 + 2];
        if (t2 === t || dot >= cosThresh) { sx += faceN[t2 * 3]; sy += faceN[t2 * 3 + 1]; sz += faceN[t2 * 3 + 2]; }
      }
      const l = Math.hypot(sx, sy, sz) || 1;
      const o = t * 9 + k * 3;
      out[o] = sx / l; out[o + 1] = sy / l; out[o + 2] = sz / l;
    }
  }
  return out;
}
