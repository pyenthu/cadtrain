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
