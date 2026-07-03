/**
 * trueform-client — CLIENT-SIDE (browser, MAIN THREAD) TrueForm kernel driver.
 *
 * TrueForm (`@polydera/trueform`) is Polydera's exact-mesh boolean / generator
 * kernel (WASM). It powers the graph editor's **TF tab** — a third geometry
 * backend next to Manifold (Mesh/GLB) and OCCT (BREP). Unlike BREP (server-side
 * OCCT) this runs entirely in the browser, ON THE MAIN THREAD — no Web Worker.
 * Three prior attempts stalled at Web-Worker init (the wasm's `import.meta.url`
 * asset resolution + `type:"module"` pthread worker fail inside a nested worker);
 * running on the main thread sidesteps that and surfaces real error messages.
 *
 * The ~31MB WASM is loaded lazily: `ensureTf()` dynamic-imports the module and
 * awaits `tf.init()` only the FIRST time the TF tab opens, so the default bundle
 * is never bloated for users who never touch the tab. `@polydera/trueform` is
 * excluded from Vite optimizeDeps (see vite.config) so the dep is served raw and
 * its `new URL("trueform_wasm.wasm", import.meta.url)` resolves next to the file.
 *
 * ⚠ CROSS-ORIGIN ISOLATION REQUIRED (verified 2026-07-02): trueform@0.9.8 is
 * built WITH pthreads. `tf.init()` pre-creates a worker pool (sized to
 * navigator.hardwareConcurrency — no opt-out) and transfers the WASM memory
 * (a SharedArrayBuffer) to each worker, which THROWS
 *   DataCloneError: SharedArrayBuffer transfer requires self.crossOriginIsolated
 * unless the document is served with COOP:same-origin + COEP:require-corp (or
 * credentialless). Running on the MAIN THREAD does not avoid this — there is no
 * single-threaded fallback in this build. The TF tab therefore only works under
 * cross-origin isolation; enabling it is an app-wide call (see vite.config).
 */

/** The lazily-imported + initialised TrueForm module (`import * as tf`). */
type Tf = typeof import('@polydera/trueform');

let _tf: Tf | null = null;
let _initPromise: Promise<Tf> | null = null;

/**
 * Lazy-import + initialise the TrueForm WASM kernel on the MAIN THREAD, cached.
 * Safe to call repeatedly — the first call loads + inits, later calls resolve to
 * the same module. Throws (with the real message) if the WASM fails to load.
 */
export async function ensureTf(): Promise<Tf> {
  if (_tf) return _tf;
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    const tf = (await import('@polydera/trueform')) as Tf;
    await tf.init();
    _tf = tf;
    return tf;
  })();
  return _initPromise;
}

/** Whether the kernel is already initialised (no async needed). */
export function tfReady(): boolean {
  return _tf != null;
}

/**
 * A raw triangle-mesh payload extracted from a TrueForm `Mesh` — flat typed
 * arrays ready for `tfMeshToGeo` (kept adapter-friendly + worker-transferable).
 * `points` is [V*3] xyz, `faces` is [F*3] vertex indices.
 */
export interface TfMeshData {
  points: Float32Array;
  faces: Int32Array;
}

/** Pull the flat point + face arrays out of a TrueForm `Mesh` handle. */
export function tfMeshData(mesh: any): TfMeshData {
  const pd = mesh.points.data as Float32Array | Float64Array;
  const points = pd instanceof Float32Array ? pd : new Float32Array(pd);
  const fd = mesh.faces.data as Int32Array;
  const faces = fd instanceof Int32Array ? fd : new Int32Array(fd);
  return { points, faces };
}

// ── Capping open sweeps → watertight solids ─────────────────────────────────
// `tubeMesh` sweeps a circular section along a path but does NOT cap the ends,
// so a swept tube comes back OPEN (one boundary loop per end). An open mesh has
// no enclosed interior, so the cutaway (a boolean half-quadrant cut) has nothing
// to reveal and is skipped. Capping each open loop with a centroid triangle-fan
// turns the tube into a CLOSED, watertight solid → it cuts like the other solids.

/** A flat triangle-mesh payload (same shape as {@link TfMeshData}); the result
 *  of the PURE cap builder, ready for `tf.mesh(faces, points)`. */
export interface FlatMesh {
  points: Float32Array;
  faces: Int32Array;
}

/**
 * PURE cap builder (no WASM) — close each open boundary loop with a centroid
 * triangle-fan. `points` is the [V*3] vertex buffer, `faces` the [F*3] index
 * buffer, `loops` the ordered vertex-index lists of the open boundaries (as
 * returned by tf's `boundaryPaths`). For each loop we add ONE centroid vertex
 * and a fan of `L` triangles closing the opening, so every former boundary edge
 * is now shared by exactly two faces (watertight, 2-manifold).
 *
 * WINDING (the load-bearing detail): each cap triangle must traverse its shared
 * boundary edge in the OPPOSITE direction to the wall face that owns it — that's
 * the manifold-orientation rule, and it makes the cap AGREE with the existing
 * walls (whatever direction they run). So we look up the boundary edge (a→b) in
 * the set of directed half-edges present in the input faces: if the wall uses
 * a→b we wind the cap (b, a, centroid); otherwise (a, b, centroid). The result
 * is a SINGLE consistently-oriented surface (walls + caps agree). The caller
 * then runs it through `positivelyOriented` to flip the whole thing OUTWARD if
 * the source walls happened to be inward (tf's `tubeMesh` walls are — see the
 * unit + kernel tests). A fixed winding that ignored the wall direction mixed
 * orientations and defeated `positivelyOriented`, which is why this matters.
 *
 * A loop whose first index repeats at the end (a closed path) is de-duplicated;
 * loops with < 3 distinct verts are skipped (can't cap). Isolated + exported so
 * the fan/centroid/winding logic can be tested without the 31 MB WASM kernel.
 */
export function buildCappedMesh(
  points: ArrayLike<number>,
  faces: ArrayLike<number>,
  loops: readonly (readonly number[])[],
): FlatMesh {
  const outPts: number[] = Array.from(points as ArrayLike<number>);
  const outFaces: number[] = Array.from(faces as ArrayLike<number>);
  // Directed half-edges present in the EXISTING faces (before we add caps) — the
  // cap winds opposite to whichever direction the wall runs (manifold rule).
  const present = new Set<number>();
  const nV0 = (outPts.length / 3) | 0;
  const STRIDE = nV0 + 1; // > max index, so a*STRIDE+b uniquely encodes a→b
  const enc = (a: number, b: number) => a * STRIDE + b;
  for (let f = 0; f < faces.length; f += 3) {
    const a = faces[f], b = faces[f + 1], c = faces[f + 2];
    present.add(enc(a, b)); present.add(enc(b, c)); present.add(enc(c, a));
  }
  let nextV = nV0;
  for (const raw of loops) {
    // A closed path may repeat its first index at the end — drop the duplicate.
    let loop = raw as readonly number[];
    if (loop.length > 1 && loop[0] === loop[loop.length - 1]) loop = loop.slice(0, -1);
    const L = loop.length;
    if (L < 3) continue; // degenerate — nothing to cap
    let cx = 0, cy = 0, cz = 0;
    for (const v of loop) { cx += outPts[v * 3]; cy += outPts[v * 3 + 1]; cz += outPts[v * 3 + 2]; }
    cx /= L; cy /= L; cz /= L;
    const ci = nextV++;
    outPts.push(cx, cy, cz);
    for (let i = 0; i < L; i++) {
      const a = loop[i], b = loop[(i + 1) % L];
      // Oppose the wall's boundary half-edge → orientation consistent with walls.
      if (present.has(enc(a, b))) outFaces.push(b, a, ci);
      else outFaces.push(a, b, ci);
    }
  }
  return { points: Float32Array.from(outPts), faces: Int32Array.from(outFaces) };
}

/** Read tf's `boundaryPaths` OffsetBlockedBuffer into plain vertex-index arrays
 *  (one per open loop). Empty → already closed. */
function tfBoundaryLoops(t: any, mesh: any): number[][] {
  const bp = t.boundaryPaths(mesh);
  const n = bp.length as number;
  const out: number[][] = [];
  for (let i = 0; i < n; i++) {
    const nd = bp.get(i);
    const d = nd.data as Int32Array | Int8Array | ArrayLike<number>;
    out.push(Array.from(d as ArrayLike<number>, (x) => x | 0));
  }
  return out;
}

/**
 * Cap the open ends of a swept/uncapped tube `Mesh` → a CLOSED, watertight solid.
 * Finds the open boundary loops (`boundaryPaths`), closes each with a centroid
 * triangle-fan wound to agree with the walls ({@link buildCappedMesh}), rebuilds
 * via `tf.mesh`, then runs the result through `positivelyOriented` so walls +
 * caps share ONE consistent OUTWARD orientation (positive signed volume) — tf's
 * `tubeMesh` walls are consistently INWARD, so this flip is what makes the solid
 * cut cleanly. Returns the ORIGINAL mesh unchanged when it's already closed (no
 * loops) or if any step throws (never worse than the uncapped tube).
 */
export function capOpenEnds(t: any, mesh: any): any {
  try {
    const loops = tfBoundaryLoops(t, mesh);
    if (loops.length === 0) return mesh; // already watertight
    const src = tfMeshData(mesh);
    const capped = buildCappedMesh(src.points, src.faces, loops);
    let m = t.mesh(capped.faces, capped.points);
    // Enforce a single consistent outward orientation (manifold-edge voting +
    // volume-sign flip) — the robust winding fix the fan alone can't guarantee.
    try { m = t.positivelyOriented(m); } catch { /* keep the plain capped mesh */ }
    return m;
  } catch {
    return mesh; // degenerate / non-orientable → leave the open tube as-is
  }
}

/**
 * Topology / watertightness stats for a TrueForm `Mesh`, computed with tf's OWN
 * predicates (topology/sync + geometry/sync). This is the honest "is it a valid
 * solid?" check — the KNOWN TrueForm weakness is booleans / swept caps that come
 * back non-watertight (open boundary loops) or non-manifold (>2 faces on an edge).
 *
 * - `closed`   = `isClosed` — no boundary edges → watertight (the key flag).
 * - `manifold` = `isManifold` — every edge shared by ≤ 2 faces.
 * - `euler`    = V − E + F (a closed genus-g surface has χ = 2 − 2g).
 * - `boundaryLoops` = number of open boundary paths (0 for a watertight solid;
 *   an uncapped swept tube has 2 — one per open end).
 * - `signedVolume` / `volume` are only meaningful for a closed mesh.
 */
export interface TfMeshStats {
  tris: number;
  verts: number;
  closed: boolean;
  manifold: boolean;
  euler: number;
  boundaryLoops: number;
  signedVolume: number;
  volume: number;
}

/** Run tf's topology/geometry predicates over a mesh handle → plain stats. */
export function tfAnalyze(tf: Tf, mesh: any): TfMeshStats {
  const t = tf as any;
  const tris = mesh.numberOfFaces as number;
  const verts = mesh.numberOfPoints as number;
  const closed = !!t.isClosed(mesh);
  const manifold = !!t.isManifold(mesh);
  const euler = Number(t.eulerCharacteristic(mesh));
  let boundaryLoops = 0;
  try {
    boundaryLoops = t.boundaryPaths(mesh).length as number;
  } catch {
    boundaryLoops = closed ? 0 : -1;
  }
  // Volume calls throw / return NaN on an open mesh — guard so the demo never
  // crashes on an intentionally open sweep.
  let signedVolume = NaN;
  let volume = NaN;
  if (closed) {
    try { signedVolume = Number(t.signedVolume(mesh)); } catch { /* ignore */ }
    try { volume = Number(t.volume(mesh)); } catch { /* ignore */ }
  }
  return { tris, verts, closed, manifold, euler, boundaryLoops, signedVolume, volume };
}

/** One planar cut face of the cutaway box (world plane axis + offset). Handed to
 *  the adapter so it can colour the newly-exposed cross-section faces grey. */
export interface TfCutPlane { axis: 0 | 1 | 2; coord: number }

/** A demo result: flat mesh data for the adapter + tf's own topology verdict.
 *  `cutPlanes` is present ONLY when a cross-section cut was applied (the TF
 *  cutaway path) — the adapter colours triangles flush with any of these planes
 *  as the revealed interior (grey), everything else as outer skin (red). */
export interface TfDemoResult {
  data: TfMeshData;
  stats: TfMeshStats;
  cutPlanes?: TfCutPlane[];
}

/**
 * A single open `Curves` path over a shared point buffer (indices 0..n-1) — the
 * `tubeMesh` sweep input. Kept as a KERNEL helper here (used by the sweep-style
 * examples in `tf_examples/`); the demo CONTENT lives there, not in this driver.
 */
export function buildOpenCurve(t: any, pts: Float32Array, n: number): any {
  const idx: number[] = [];
  for (let i = 0; i < n; i++) idx.push(i);
  const offsets = t.ndarray(new Int32Array([0, idx.length]), [2]);
  const data = t.ndarray(new Int32Array(idx), [idx.length]);
  return t.curves(t.offsetBlockedBuffer(offsets, data), pts);
}

/**
 * Apply the SECTIONAL cutaway to a closed solid mesh — the TF mirror of the
 * Manifold 3D-bake cutaway. Manifold removes the +x,+y quadrant over the part's
 * full Z (`manifold-helpers.ts:getCutBox`): a corner box at world x∈[0,xspan],
 * y∈[0,yspan] spanning the whole Z range + margin, exposing the interior on the
 * x=0 and y=0 planes. We reproduce that box in TrueForm (`boxMesh` is centred →
 * translate it into the +x,+y corner) and `booleanDifference(solid, cutter)`.
 * Returns the cut mesh + the two exposed cut planes so the adapter can colour
 * the revealed section faces grey. Any failure → the un-cut solid, no planes.
 */
export function applyTfCutaway(t: any, mesh: any): { mesh: any; planes?: TfCutPlane[] } {
  try {
    const pts = mesh.points.data as Float32Array | Float64Array;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < pts.length; i += 3) {
      const x = pts[i], y = pts[i + 1], z = pts[i + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    const MARGIN = 20;
    const xspan = Math.max(Math.abs(minX), Math.abs(maxX)) + MARGIN;
    const yspan = Math.max(Math.abs(minY), Math.abs(maxY)) + MARGIN;
    const zlen = (maxZ - minZ) + 2 * MARGIN;
    // boxMesh is CENTERED at origin; translate so it occupies x∈[0,xspan],
    // y∈[0,yspan], z∈[minZ-MARGIN, minZ-MARGIN+zlen] — the same +x,+y corner box
    // Manifold's getCutBox builds (M.cube([...], false).translate([0,0,minZ-M])).
    const cutter = t.boxMesh(xspan, yspan, zlen);
    cutter.transformation = t.makeTranslation(xspan / 2, yspan / 2, (minZ - MARGIN) + zlen / 2);
    const cut = t.booleanDifference(mesh, cutter).mesh;
    // Exposed planes = the cutter's inner walls (world x=0 and y=0).
    return { mesh: cut, planes: [{ axis: 0, coord: 0 }, { axis: 1, coord: 0 }] };
  } catch {
    return { mesh };
  }
}

/**
 * Finalise a built tf `Mesh` handle into a {@link TfDemoResult} — the shared
 * back-end of every `tf_examples/` builder. When `opts.cutaway` is set AND the
 * example is `cuttable` (a closed solid), the mesh is cut (half-quadrant boolean,
 * mirroring the Manifold cutaway via {@link applyTfCutaway}) and `cutPlanes` is
 * returned so the adapter renders a grey-interior / red-outer cross-section.
 * Otherwise the plain solid + its topology verdict is returned. Kept here (the
 * kernel driver) so the example CONTENT files stay thin and don't each reimplement
 * the cutaway + analyse plumbing.
 */
export function tfResult(
  tf: Tf,
  t: any,
  solid: any,
  opts: { cutaway?: boolean; cuttable?: boolean } = {},
): TfDemoResult {
  if (opts.cutaway && opts.cuttable) {
    const { mesh: cut, planes } = applyTfCutaway(t, solid);
    if (planes) {
      // Analyse the CUT solid — a clean half-cut is still closed + manifold.
      return { data: tfMeshData(cut), stats: tfAnalyze(tf, cut), cutPlanes: planes };
    }
  }
  return { data: tfMeshData(solid), stats: tfAnalyze(tf, solid) };
}

// ── "actual" import — the user's REAL baked part through the TF kernel ───────
// The tf_examples above are self-contained TF geometry. The "actual" TF-tab mode
// instead imports the part's ALREADY-baked Manifold triangle mesh (from the 3D
// bake) and runs it through TrueForm's OWN topology predicates — so the user sees
// their real geometry in the TF engine + learns whether it survives TF's
// watertight/manifold/χ check. `tfImportMesh` is the driver for that path.

/**
 * PURE mesh weld (no WASM) — collapse coincident vertices in a (possibly
 * non-indexed) triangle mesh into a compact, INDEXED mesh with shared vertices,
 * quantising positions to `quantum`. cadtrain's render geometry (`manifoldToGeo`)
 * is usually a NON-INDEXED triangle soup (each triangle carries its own three
 * corner verts for crease-aware normals). Feeding that soup straight to `tf.mesh`
 * makes EVERY edge unshared → tf reports it open + non-manifold even for a clean
 * revolve. Welding by position reconstructs the real shared-edge connectivity so
 * tf's verdict is meaningful. This is the identity operation for TOPOLOGY —
 * coincident verts ARE the same vertex — so it can't HIDE a genuine defect: a
 * genuinely open mesh stays open, and topological handles (a bad boolean's phantom
 * genus) survive the weld and still show up in χ. Degenerate triangles (two corners
 * that welded together) are dropped. Isolated + exported so the weld can be tested
 * without the 31 MB kernel.
 */
export function weldMeshByPosition(
  positions: ArrayLike<number>,
  indices?: ArrayLike<number> | null,
  quantum = 1e-4,
): FlatMesh {
  const nSrcV = (positions.length / 3) | 0;
  const idx: ArrayLike<number> =
    indices && indices.length
      ? indices
      : Array.from({ length: nSrcV }, (_, i) => i); // soup → implicit 0..3F-1
  const map = new Map<string, number>();
  const outPts: number[] = [];
  const outFaces: number[] = [];
  const q = quantum > 0 ? quantum : 1e-4;
  const keyFor = (vi: number) => {
    const x = positions[vi * 3], y = positions[vi * 3 + 1], z = positions[vi * 3 + 2];
    return `${Math.round(x / q)},${Math.round(y / q)},${Math.round(z / q)}`;
  };
  const weld = (vi: number): number => {
    const k = keyFor(vi);
    let ni = map.get(k);
    if (ni === undefined) {
      ni = (outPts.length / 3) | 0;
      outPts.push(positions[vi * 3], positions[vi * 3 + 1], positions[vi * 3 + 2]);
      map.set(k, ni);
    }
    return ni;
  };
  for (let f = 0; f + 2 < idx.length; f += 3) {
    const a = weld(idx[f] | 0), b = weld(idx[f + 1] | 0), c = weld(idx[f + 2] | 0);
    if (a === b || b === c || c === a) continue; // collapsed → drop
    outFaces.push(a, b, c);
  }
  return { points: Float32Array.from(outPts), faces: Int32Array.from(outFaces) };
}

/**
 * Import a raw triangle mesh (the part's baked Manifold geometry) into TrueForm
 * and return its TF verdict — the "actual" TF-tab path. `positions` is the flat
 * [V*3] xyz buffer, `indices` the flat [F*3] vertex indices (pass `null`/empty for
 * a non-indexed soup — one triangle per 3 consecutive verts). The mesh is welded
 * by position ({@link weldMeshByPosition}) so tf's topology predicates see the real
 * connectivity, built via `tf.mesh(faces, points)` (same flat-buffer call the
 * revolve/cap builders use), oriented outward, then run through {@link tfResult}
 * (cutaway when requested + verdict via {@link tfAnalyze}).
 *
 * GRACEFUL on a bad mesh: a non-watertight / non-manifold part won't throw —
 * `tfAnalyze` reports `closed:false` / `manifold:false` instead. `positivelyOriented`
 * and the cutaway boolean CAN throw on a degenerate input; each is caught so the
 * user still gets the raw mesh + verdict (WHY it isn't TF-valid) rather than an error.
 */
export async function tfImportMesh(
  positions: Float32Array | number[],
  indices?: Uint32Array | number[] | null,
  opts: { cutaway?: boolean } = {},
): Promise<TfDemoResult> {
  const tf = await ensureTf();
  const t = tf as any;
  const { points, faces } = weldMeshByPosition(positions, indices ?? null);
  let solid = t.mesh(faces, points);
  // Orient outward (positive signed volume) — a bad mesh can make this throw;
  // keep the raw mesh so the verdict still surfaces.
  try { solid = t.positivelyOriented(solid); } catch { /* keep raw */ }
  try {
    // cuttable:true → tfResult applies the half-quadrant cut when opts.cutaway is
    // set (applyTfCutaway self-guards a failing boolean → falls back to the solid).
    return tfResult(tf, t, solid, { cutaway: opts.cutaway, cuttable: true });
  } catch {
    // Any predicate/cut failure on a degenerate import → still return mesh + verdict.
    return { data: tfMeshData(solid), stats: tfAnalyze(tf, solid) };
  }
}
