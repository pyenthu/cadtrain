/**
 * tf_examples/tf-weld — the Manifold WELDED-MESH methodology, ported to TrueForm.
 *
 * TrueForm has NO native loft / linear-extrude / arbitrary-section sweep (see
 * trueform-api-notes.md § ⛔ — only `tubeMesh`, a fixed CIRCULAR section). The
 * Manifold side builds those from a hand-wound triangle grid: tessellate an
 * ordered (u,v) vertex grid into 2 tris/quad, cap the ends, POSITION-WELD
 * coincident verts, then wrap the buffers in a Manifold (`manifold-mesh.ts`:
 * `gridPatch` / `capFan` / `weldAndBuild`). This file is the same pipeline aimed
 * at `tf.mesh(faces, points)` — the general "controllable vertex grid → welded
 * TF surface" builder that a native r_weld_extrude / arbitrary-section r_sweep /
 * NURBS-style smooth surface would sit on top of.
 *
 * SPLIT (same as `buildRevolveMesh`): the PURE grid→{points,faces} step
 * (`buildWeldGrid`) has NO WASM, so its winding / watertightness is unit-testable
 * without the 31 MB kernel; `weldGridToTf` is the thin wrapper that hands the flat
 * buffers to `tf.mesh(...)` + `positivelyOriented`.
 *
 * WINDING (the SVTC ordered-grid rule): each quad cell (r,c) — corners
 *   a=(r,c)  b=(r,c+1)  d=(r+1,c)  e=(r+1,c+1)
 * emits tris (a,b,e) + (a,e,d). This is the toolkit's `-du×dv` winding: traverse
 * the section CLOCKWISE in 2D and the swept band's normals point OUTWARD. The
 * absolute in/out sign never has to be perfect here — `positivelyOriented` (in
 * `weldGridToTf`) flips the whole solid outward at the end, exactly like
 * `weldAndBuild`'s volume-sign self-correction on the Manifold side.
 *
 * WATERTIGHT BY CONSTRUCTION: closed dimensions wrap by MODULO (no duplicate
 * seam verts on the wall → the seam quad is generated, no gap); the two open
 * path-ends are closed with centroid fans wound to AGREE with the walls (reusing
 * the proven `buildCappedMesh` half-edge rule); then a mandatory position-weld
 * (`weldMeshByPosition`) collapses any genuinely coincident verts the CALLER's
 * grid carried (a repeated profile-close point, a collapsed pole) and drops the
 * degenerate tris that fold onto — the identity operation for a clean grid.
 */
import { buildCappedMesh, weldMeshByPosition, type FlatMesh } from '../trueform-client';

/** One 3D grid vertex. */
export type V3 = readonly [number, number, number];
/** An ordered (rows × cols) vertex grid — a surface patch. `grid[u][v]` is the
 *  point at row `u` (walks the PATH / z-levels) and col `v` (walks the SECTION). */
export type WeldGrid = readonly (readonly V3[])[];

export interface WeldGridOpts {
  /** The PATH (rows / u) loops — row `nRows-1` joins back to row 0 (a torus-like
   *  closed sweep). Suppresses the end caps. Default false. */
  closedU?: boolean;
  /** The SECTION (cols / v) is a closed loop — col `nCols-1` joins back to col 0
   *  (a tube skin). Default false (an open ribbon strip). */
  closedV?: boolean;
  /** Cap the two PATH ends (first + last row) into a closed SOLID. Only meaningful
   *  with `closedV` (each end is then a closed section loop) and an open path
   *  (ignored when `closedU`). Default false. */
  caps?: boolean;
  /** Position-weld coincident verts (mandatory in the methodology; identity for a
   *  clean grid). Default true. */
  weld?: boolean;
  /** Weld quantization tolerance. Default 1e-4 (`weldMeshByPosition`'s default). */
  quantum?: number;
}

/**
 * PURE welded-grid builder (no WASM) — an ordered (rows × cols) 3D vertex grid →
 * a flat `{points:[V*3], faces:[F*3]}` triangle mesh, ready for `tf.mesh`.
 *
 * The wall is a (rows-1)×(cols-1) field of quads (2 tris each, `-du×dv` winding);
 * closed dimensions add a wrap band via MODULO indexing (no duplicate seam verts).
 * With `caps`, the first + last row loops are closed by centroid fans
 * (`buildCappedMesh`, wound opposite the wall's boundary half-edge). A final
 * position-weld (unless `weld:false`) collapses coincident verts + drops
 * degenerate tris → watertight by construction.
 */
export function buildWeldGrid(grid: WeldGrid, opts: WeldGridOpts = {}): FlatMesh {
  const nRows = grid.length;
  if (nRows < 2) return { points: new Float32Array(0), faces: new Int32Array(0) };
  const nCols = grid[0].length;
  if (nCols < 2) return { points: new Float32Array(0), faces: new Int32Array(0) };

  const closedU = opts.closedU === true;
  const closedV = opts.closedV === true;
  const wantCaps = opts.caps === true && !closedU; // a closed path has no ends to cap
  const doWeld = opts.weld !== false;

  // Flatten the grid, row-major: vertex index = r * nCols + c.
  const pts: number[] = [];
  for (let r = 0; r < nRows; r++) {
    const row = grid[r];
    for (let c = 0; c < nCols; c++) {
      const p = row[c];
      pts.push(p[0], p[1], p[2]);
    }
  }

  // Wall faces — the SVTC ordered grid, closed dims wrapped by modulo so the seam
  // quad is generated without a duplicate seam vertex. tris (a,b,e)+(a,e,d).
  const faces: number[] = [];
  const rowSteps = closedU ? nRows : nRows - 1;
  const colSteps = closedV ? nCols : nCols - 1;
  for (let r = 0; r < rowSteps; r++) {
    const rN = (r + 1) % nRows;
    for (let c = 0; c < colSteps; c++) {
      const cN = (c + 1) % nCols;
      const a = r * nCols + c;
      const b = r * nCols + cN;
      const d = rN * nCols + c;
      const e = rN * nCols + cN;
      faces.push(a, b, e);
      faces.push(a, e, d);
    }
  }

  let mesh: FlatMesh = { points: Float32Array.from(pts), faces: Int32Array.from(faces) };

  // Caps — close the first + last row loops. buildCappedMesh winds each cap
  // OPPOSITE the wall's boundary half-edge (the manifold-orientation rule), so the
  // caps AGREE with whatever direction the walls run; positivelyOriented flips the
  // finished solid outward.
  if (wantCaps) {
    const first: number[] = [];
    const last: number[] = [];
    for (let c = 0; c < nCols; c++) {
      first.push(c);
      last.push((nRows - 1) * nCols + c);
    }
    mesh = buildCappedMesh(mesh.points, mesh.faces, [first, last]);
  }

  // Mandatory position-weld — collapse coincident verts (a repeated profile-close
  // point, a collapsed pole, a caller-duplicated seam column) into shared vertices
  // + drop the degenerate tris that fold onto them. Identity for a clean grid.
  if (doWeld) mesh = weldMeshByPosition(mesh.points, mesh.faces, opts.quantum);
  return mesh;
}

/**
 * Build a welded TrueForm `Mesh` from an ordered (rows × cols) vertex grid — the
 * WASM wrapper around {@link buildWeldGrid}. Emits the flat buffers, hands them to
 * `tf.mesh(faces, points)`, then runs `positivelyOriented` so the walls + caps
 * share ONE outward orientation (positive signed volume) — freshly built TF walls
 * can come back inward, exactly like `capOpenEnds` / `tfRevolveProfile`. `t` is the
 * initialised tf module (`ensureTf()`'d by the caller). Returns the tf `Mesh`.
 */
export function weldGridToTf(t: any, grid: WeldGrid, opts: WeldGridOpts = {}): any {
  const { points, faces } = buildWeldGrid(grid, opts);
  let m = t.mesh(faces, points);
  try { m = t.positivelyOriented(m); } catch { /* keep the plain welded mesh */ }
  return m;
}

/**
 * Sweep a fixed closed 2D profile `[x,y][]` along Z over `segments` levels into a
 * (segments+1) × (profile.length) vertex grid — the section × z-levels grid that
 * {@link buildWeldGrid} extrudes into a welded solid. `z0` is the first level,
 * `zLen` the total extrusion length. A convenience for the r_weld_extrude analogue
 * (a general path→grid builder — bending / lofting — layers on by varying the
 * per-level transform instead of a straight Z offset).
 */
export function extrudeProfileGrid(
  profile: readonly (readonly [number, number])[],
  segments: number,
  z0: number,
  zLen: number,
): V3[][] {
  const N = Math.max(1, Math.floor(segments));
  const dz = zLen / N;
  const grid: V3[][] = [];
  for (let r = 0; r <= N; r++) {
    const z = z0 + r * dz;
    grid.push(profile.map(([x, y]): V3 => [x, y, z]));
  }
  return grid;
}
