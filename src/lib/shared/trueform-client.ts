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

/**
 * From-scratch demo geometry (commit 2): a TrueForm-generated box, returned as
 * flat mesh data. Proves the kernel loads + generates + hands back a mesh on the
 * main thread. `boxMesh(w,h,d)` is centred at the origin.
 */
export async function tfDemoBox(w = 4, h = 4, d = 4): Promise<TfMeshData> {
  const tf = await ensureTf();
  const box = (tf as any).boxMesh(w, h, d);
  return tfMeshData(box);
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

/** A demo result: flat mesh data for the adapter + tf's own topology verdict. */
export interface TfDemoResult {
  data: TfMeshData;
  stats: TfMeshStats;
}

/**
 * SWEEP demo — the real payoff. TrueForm has no revolve/loft/extrude, but
 * `tubeMesh(curves, radius, radialSegments)` sweeps a circular section along a
 * 3D polyline using parallel-transport frames (RMF) — i.e. a genuine pipe/sweep.
 * Here we sweep along a HELIX to prove tf builds smooth curved geometry from an
 * algorithm-driven path (a coil / spring — the kind of thing `CrossSection`
 * can't do without axial sampling).
 *
 * NOTE ON WATERTIGHTNESS: `tubeMesh` does NOT cap the ends, so an open helix
 * comes back with 2 boundary loops (`closed:false`). That is CORRECT for an
 * uncapped sweep, not a defect. Pass `closedPath:true` to sweep along a full
 * loop (→ a torus-like closed tube, `closed:true`, genus 1) to see a watertight
 * result from the same primitive.
 */
export async function tfSweepDemo(opts: {
  coilRadius?: number;
  tubeRadius?: number;
  pitch?: number;
  turns?: number;
  ptsPerTurn?: number;
  radialSegments?: number;
  closedPath?: boolean;
} = {}): Promise<TfDemoResult> {
  const tf = await ensureTf();
  const t = tf as any;
  const {
    coilRadius = 6,
    tubeRadius = 1.2,
    pitch = 3.5,
    turns = 3,
    ptsPerTurn = 64,
    radialSegments = 24,
    closedPath = false,
  } = opts;

  const n = Math.max(4, Math.round(turns * ptsPerTurn));
  const pts = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    // A closed path samples one full circle (no pitch); an open path spirals.
    const a = closedPath ? (i / n) * 2 * Math.PI : (i / ptsPerTurn) * 2 * Math.PI;
    pts[i * 3 + 0] = coilRadius * Math.cos(a);
    pts[i * 3 + 1] = coilRadius * Math.sin(a);
    pts[i * 3 + 2] = closedPath ? 0 : (i / ptsPerTurn) * pitch;
  }

  // A `Curves` = paths (offset-blocked index blocks) over a shared point buffer.
  // One path spanning all n points; +1 wrapping index when the path is closed.
  const idx: number[] = [];
  for (let i = 0; i < n; i++) idx.push(i);
  if (closedPath) idx.push(0);
  const offsets = t.ndarray(new Int32Array([0, idx.length]), [2]);
  const data = t.ndarray(new Int32Array(idx), [idx.length]);
  const paths = t.offsetBlockedBuffer(offsets, data);
  const crv = t.curves(paths, pts);

  const mesh = t.tubeMesh(crv, tubeRadius, radialSegments);
  return { data: tfMeshData(mesh), stats: tfAnalyze(tf, mesh) };
}

/**
 * BOOLEAN demo — exercises the CSG kernel + directly tests the memory's caveat
 * that TrueForm's boolean is not automatically watertight. Builds a bored pipe
 * (a downhole-relevant solid): an outer solid cylinder MINUS a taller, narrower
 * inner cylinder that punches all the way through → a hollow tube capped by two
 * annular faces. A correct boolean returns this `closed:true`, `manifold:true`,
 * genus-1 (χ = 0). `tfAnalyze` reports whether tf actually delivered that.
 */
export async function tfBooleanDemo(opts: {
  outerRadius?: number;
  innerRadius?: number;
  height?: number;
  segments?: number;
} = {}): Promise<TfDemoResult> {
  const tf = await ensureTf();
  const t = tf as any;
  const { outerRadius = 6, innerRadius = 3.5, height = 16, segments = 64 } = opts;
  const outer = t.cylinderMesh(outerRadius, height, segments);
  // Slightly taller so the bore fully punches through both caps (no coplanar
  // coincident faces → cleaner boolean).
  const inner = t.cylinderMesh(innerRadius, height + 4, segments);
  const res = t.booleanDifference(outer, inner);
  const mesh = res.mesh;
  return { data: tfMeshData(mesh), stats: tfAnalyze(tf, mesh) };
}

/** Which demo the TF tab renders. `box` is the original from-scratch primitive. */
export type TfDemoKind = 'box' | 'sweep' | 'boolean';

/** Dispatch a TF-tab demo by kind. Returns mesh data (+ stats for sweep/boolean). */
export async function tfDemo(kind: TfDemoKind): Promise<TfDemoResult> {
  if (kind === 'sweep') return tfSweepDemo();
  if (kind === 'boolean') return tfBooleanDemo();
  const tf = await ensureTf();
  const box = (tf as any).boxMesh(4, 4, 4);
  return { data: tfMeshData(box), stats: tfAnalyze(tf, box) };
}
