/**
 * trueform-adapter — TrueForm mesh data → THREE.BufferGeometry.
 *
 * The TF-tab bake path ($lib/shared/trueform-client) hands back flat typed
 * arrays (`{ points: [V*3], faces: [F*3] }`). This turns them into the same
 * `{ full }` / `{ cutVC }` geometry wrapper `PrimitiveDualScene` already
 * consumes for the Manifold + BREP paths, so the shared canvas needs no
 * TrueForm-specific rendering code.
 *
 * TrueForm meshes are triangle soups (faces are always [nTri, 3]); the N-gon
 * triangulation branch is defensive — if a face array ever arrives with a
 * stride > 3 (e.g. a quad grid), each face is fan-triangulated so nothing is
 * dropped.
 *
 * SHADING — crease-aware normals (2026-07-03). TrueForm's boolean/generator
 * output is a WELDED indexed solid: the rim vertices of a bored pipe are SHARED
 * between the flat annular end-caps and the curved cylinder walls. A plain
 * `computeVertexNormals()` averages every incident face at a shared vertex, so
 * the hard cap↔wall rim smears into a rounded gradient and the flat caps pick
 * up a slope — the "bored-pipe shading problem". Instead we split normals at a
 * crease angle (default 60°, matching the Manifold live-mesh path's
 * `calculateNormals(0, 60)`): cylinder/bore walls read smooth (adjacent facets
 * are within 60°) while genuine creases — the pipe rims, box edges — stay hard.
 * This makes an exact-kernel boolean read as a solid with a clean bore once the
 * TF backend renders smooth-shaded (see PrimitiveDualCanvas `smoothShadeAuto`).
 * Output is NON-INDEXED (per-corner normals require split vertices at creases),
 * exactly like `render-helpers.ts:creaseAwareCornerNormals`, whose pure routine
 * this mirrors — duplicated (not imported) to keep the lean, worker-transferable
 * TF adapter free of the Manifold render-pipeline import graph.
 */
import * as THREE from 'three';

export interface TfMeshInput {
  /** Flat xyz vertex coordinates, length V*3. */
  points: ArrayLike<number>;
  /** Flat vertex indices. Triangles (stride 3) by default. */
  faces: ArrayLike<number>;
  /** Vertices per face. Default 3 (triangles). > 3 → fan-triangulated. */
  faceStride?: number;
}

/** Default cross-section face colours — the historical Manifold half-section
 *  convention (`render-helpers.ts:manifoldToCutVC`): outer body RED, revealed
 *  interior / cut face GREY. Kept byte-identical so a TF cutaway reads the same
 *  as the Manifold 3D-bake cutaway. */
export const SECTION_OUTER_RGB: [number, number, number] = [0.8, 0.06, 0.06];
export const SECTION_INNER_RGB: [number, number, number] = [0.45, 0.45, 0.45];

/** One planar cut face of the cutaway box, e.g. `{ axis: 0, coord: 0 }` = the
 *  world x=0 plane. A result triangle whose THREE verts all sit on such a plane
 *  is a newly-exposed cross-section face (→ grey interior). */
export interface CutPlane {
  /** 0 = x, 1 = y, 2 = z. */
  axis: 0 | 1 | 2;
  /** Plane offset along that axis (world units). */
  coord: number;
}

/** How to colour a cut result's faces into outer skin vs revealed section. */
export interface SectionColoring {
  /** The cutter box's exposed planes — a triangle flush with any of these is a
   *  section (interior/grey) face. Mirrors Manifold's `onCutX`/`onCutY` test. */
  planes: CutPlane[];
  /** RGB (0..1) for the outer body faces. Default {@link SECTION_OUTER_RGB}. */
  outer?: [number, number, number];
  /** RGB (0..1) for the revealed section faces. Default {@link SECTION_INNER_RGB}. */
  inner?: [number, number, number];
  /** Coincidence tolerance for "vertex lies on the plane" (world units). */
  eps?: number;
}

/**
 * Per-FACE cross-section colours for a cut result — the pure face→colour split
 * (unit-tested). A triangle is a SECTION face (interior → grey) when all three
 * of its vertices lie on one of the cutter's exposed planes; otherwise it is
 * outer body skin (→ red). This is the exact geometric classifier Manifold's
 * `manifoldToCutVC` uses (`onCutX`/`onCutY`) — chosen over TrueForm's
 * `faceLabels`/`labels` because those only reference the ORIGIN face in the part
 * operand and do NOT distinctly tag the cutter-created faces (empirically the
 * boolean's `labels` region covers only a subset of the true section faces).
 *
 * `index` is the flat, already-triangulated [F*3] buffer; returns a flat [F*3]
 * RGB buffer (one colour per FACE, three floats). Expand to per-corner in the
 * geometry builder.
 */
export function sectionFaceColors(
  points: ArrayLike<number>,
  index: ArrayLike<number>,
  section: SectionColoring,
): Float32Array {
  const nt = (index.length / 3) | 0;
  const out = new Float32Array(nt * 3);
  const outer = section.outer ?? SECTION_OUTER_RGB;
  const inner = section.inner ?? SECTION_INNER_RGB;
  const eps = section.eps ?? 1e-2;
  const planes = section.planes;
  for (let t = 0; t < nt; t++) {
    const a = index[t * 3], b = index[t * 3 + 1], c = index[t * 3 + 2];
    let onSection = false;
    for (let p = 0; p < planes.length; p++) {
      const ax = planes[p].axis, co = planes[p].coord;
      if (
        Math.abs(points[a * 3 + ax] - co) < eps &&
        Math.abs(points[b * 3 + ax] - co) < eps &&
        Math.abs(points[c * 3 + ax] - co) < eps
      ) { onSection = true; break; }
    }
    const rgb = onSection ? inner : outer;
    out[t * 3] = rgb[0]; out[t * 3 + 1] = rgb[1]; out[t * 3 + 2] = rgb[2];
  }
  return out;
}

/**
 * Fan-triangulate an index buffer whose faces have `stride` vertices each into
 * a flat triangle index array. stride === 3 is returned as-is (already tris).
 */
export function triangulateFaces(faces: ArrayLike<number>, stride = 3): Uint32Array {
  if (stride <= 3) return faces instanceof Uint32Array ? faces : Uint32Array.from(faces as any);
  const nFaces = Math.floor(faces.length / stride);
  const out: number[] = [];
  for (let f = 0; f < nFaces; f++) {
    const base = f * stride;
    const v0 = faces[base];
    for (let k = 1; k < stride - 1; k++) {
      out.push(v0, faces[base + k], faces[base + k + 1]);
    }
  }
  return Uint32Array.from(out);
}

/** Default crease angle (deg) — matches the Manifold live-mesh path (60°). */
const DEFAULT_CREASE_ANGLE = 60;

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

/** MEDIAN triangle edge length — the local feature scale the weld tolerance is
 *  derived from (so the tolerance auto-scales with part size AND mesh resolution;
 *  proven scale-invariant on a ×0.01 shrink). Sampled (stride) so the sort stays
 *  cheap on large meshes. Returns 0 for a mesh with no non-degenerate edges. */
export function medianEdgeLength(pos: ArrayLike<number>, tri: ArrayLike<number>): number {
  const nt = (tri.length / 3) | 0;
  if (nt === 0) return 0;
  const stride = Math.max(1, Math.floor(nt / 20000)); // cap the sample at ~60k edges
  const lens: number[] = [];
  for (let t = 0; t < nt; t += stride) {
    const a = tri[t * 3], b = tri[t * 3 + 1], c = tri[t * 3 + 2];
    for (const [x, y] of [[a, b], [b, c], [c, a]] as const) {
      const d = Math.hypot(pos[x * 3] - pos[y * 3], pos[x * 3 + 1] - pos[y * 3 + 1], pos[x * 3 + 2] - pos[y * 3 + 2]);
      if (d > 0) lens.push(d);
    }
  }
  if (lens.length === 0) return 0;
  lens.sort((p, q) => p - q);
  return lens[lens.length >> 1];
}

/** Weld tolerance as a fraction of the median edge — 0.25 recovers a booleaned
 *  composite's smooth walls (58% → 97% of side-wall corners on the demo joint,
 *  1.00 on a ×0.01 shrink) while leaving a clean standalone part at 1.00 and
 *  staying well below the ~0.5× point where genuine ring verts start to merge. */
const WELD_TOL_FRACTION = 0.25;

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
  // Weld corners by a spatial TOLERANCE (~0.25× the median edge) so a smooth band
  // averages across its facets even when an exact boolean left near-coincident
  // (not equal) seam verts — the composite-flat-shading fix (see toleranceWeldMap).
  const tol = weldTol != null ? weldTol : WELD_TOL_FRACTION * medianEdgeLength(pos, tri);
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

/**
 * Build a THREE.BufferGeometry from TrueForm data with crease-aware normals.
 * Non-indexed (split at creases) so a bored pipe reads as a smooth-walled solid
 * with a clean bore + sharp rims. `creaseAngleDeg` tunes the sharp/smooth split.
 *
 * When `section` is supplied (the TF cutaway path), a per-vertex `color`
 * attribute is emitted — outer body faces RED, revealed cross-section faces
 * GREY — so the result renders through the SAME `cutVC` / `vertexColors` branch
 * as the Manifold + BREP half-sections (`PrimitiveDualScene`). Absent `section`,
 * output is unchanged (position + normal only) → the plain solid path.
 */
export function tfMeshToGeo(data: TfMeshInput, creaseAngleDeg = DEFAULT_CREASE_ANGLE, section?: SectionColoring): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const positions = data.points instanceof Float32Array ? data.points : Float32Array.from(data.points as any);
  const index = triangulateFaces(data.faces, data.faceStride ?? 3);
  if (index.length === 0) {
    // No faces (point cloud / empty) — nothing to shade; keep the raw points.
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return g;
  }
  // Expand to a NON-INDEXED position buffer that matches the per-corner normals.
  const nCorner = index.length; // nt * 3
  const outPos = new Float32Array(nCorner * 3);
  for (let i = 0; i < nCorner; i++) {
    const v = index[i];
    outPos[i * 3] = positions[v * 3];
    outPos[i * 3 + 1] = positions[v * 3 + 1];
    outPos[i * 3 + 2] = positions[v * 3 + 2];
  }
  const normals = creaseAwareCornerNormals(positions, index, creaseAngleDeg);
  g.setAttribute('position', new THREE.BufferAttribute(outPos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  if (section) {
    // Per-face RGB (outer/section) → scatter to the 3 corners of each triangle.
    const faceCols = sectionFaceColors(positions, index, section);
    const outCol = new Float32Array(nCorner * 3);
    const nt = (index.length / 3) | 0;
    for (let t = 0; t < nt; t++) {
      const r = faceCols[t * 3], gr = faceCols[t * 3 + 1], b = faceCols[t * 3 + 2];
      for (let k = 0; k < 3; k++) {
        const o = (t * 3 + k) * 3;
        outCol[o] = r; outCol[o + 1] = gr; outCol[o + 2] = b;
      }
    }
    g.setAttribute('color', new THREE.BufferAttribute(outCol, 3));
  }
  return g;
}
