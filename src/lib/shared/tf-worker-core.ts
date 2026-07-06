/**
 * tf-worker-core — the PURE dispatch + serialize core of the client-side
 * TrueForm executor. This is to the TF backend what `bake-worker-core.ts` is to
 * the Manifold backend: the isomorphic body the Web Worker (`tf-worker.ts`) calls
 * off the UI thread, factored OUT of the worker shell so it carries ZERO
 * worker/DOM dependency and can be unit-tested in vitest with a MOCK kernel.
 *
 * WHY A WORKER AT ALL — the TF tab used to run the WHOLE build (executeTfRecipe /
 * warpMeshJS / the boolean fold) on the MAIN THREAD inside `rebuildTf`, which
 * janked the UI on every spline drag exactly like the pre-worker Manifold bake
 * did. Moving the geometry build into a Worker (mirroring `bake-worker`) frees the
 * UI thread so the TF tab feels as smooth as the 3D-BAKE tab.
 *
 * THE SPLIT (THREE stays main-thread): the worker returns RAW MESH DATA — flat
 * `{ points: Float32Array, faces: Int32Array }` buffers + tf's topology `stats` +
 * `cutPlanes` + per-part data — transferred zero-copy. The MAIN THREAD then runs
 * `tfMeshToGeo` (which needs THREE) on that raw data, exactly as `rebuildTf` did
 * before. So no THREE import ever enters the worker.
 *
 * NATIVE-ONLY (do not regress): the TF tab NEVER imports the Manifold mesh. The
 * caller (rebuildTf) does the pure `recipeHasUnsupported` guard BEFORE posting, so
 * the worker only ever receives a buildable request; a genuine build FAILURE
 * throws here → the worker posts `{ ok:false, error }` → the main thread blanks
 * the canvas + shows the reason. No silent stand-in.
 *
 * TESTABILITY: `buildTfRecipe(mockTf, req)` runs the NATIVE recipe path against an
 * injected kernel handle (the same mock `execute.test.ts` uses), and
 * `packTfResult` is a pure typed-array pack — both provable in Node without the
 * 31 MB WASM kernel (the kernel itself only runs in-browser under cross-origin
 * isolation, so the actual WASM bake is verified in the browser, not headlessly).
 */
import { executeTfRecipe } from './tf_examples/execute';
import { getTfExample } from './tf_examples';
import type { TfDemoResult, TfMeshStats, TfCutPlane } from './trueform-client';
import type { TfRecipe, TfAppearance } from '$lib/cad/graph-to-tf';

/** A build request — the JSON-cloneable message the main thread posts to the
 *  worker. `native` executes a graph→TF recipe (the "actual" part path); `demo`
 *  dispatches a `tf_examples/` builder by name. Both honour `cutaway`. */
export interface TfWorkerRequest {
  /** Monotonic job id (worker echoes it back so the client matches the reply). */
  id: number;
  /** native = execute `recipe` in TF; demo = run the named `tf_examples` builder. */
  mode: 'native' | 'demo';
  /** native mode: the compiled graph→TF recipe (data-only, JSON-cloneable). */
  recipe?: TfRecipe;
  /** demo mode: the `tf_examples/` builder name (falls back to `r_cyl`). */
  tfDemo?: string;
  /** Mirror the Manifold cutaway — a half-quadrant boolean section cut. */
  cutaway: boolean;
  /** Opt-in perf logging (worker warm + build). */
  timings?: boolean;
}

/**
 * Dispatch a build request against an ALREADY-INITIALISED TrueForm kernel handle
 * → a {@link TfDemoResult} (raw mesh data + tf's topology verdict + optional
 * cutPlanes/parts). Injects `tf`/`t` (never calls `ensureTf` itself) so the
 * NATIVE path is unit-testable with a mock kernel, exactly like `executeTfRecipe`.
 *
 * The DEMO path calls the registered builder's `build()`, which ensures the
 * kernel internally (idempotent/cached) — so it is exercised in-browser, not in
 * the mock test (which only drives the native path).
 */
export async function buildTfRecipe(tf: any, req: TfWorkerRequest): Promise<TfDemoResult> {
  if (req.mode === 'native') {
    if (!req.recipe) throw new Error('native TF build requires a recipe');
    // Same call shape rebuildTf used inline: executeTfRecipe(tf, tf, recipe, opts).
    return executeTfRecipe(tf, tf, req.recipe, { cutaway: req.cutaway });
  }
  // DEMO: registry dispatch, falling back to r_cyl on an unknown name (mirrors
  // rebuildTf's `getTfExample(tfDemo) ?? getTfExample('r_cyl')`).
  const ex = getTfExample(req.tfDemo ?? 'r_cyl') ?? getTfExample('r_cyl');
  if (!ex) throw new Error(`unknown TF demo: ${req.tfDemo}`);
  return ex.build({ cutaway: req.cutaway });
}

/** The transfer-ready shape of a TF build result — flat typed arrays on their OWN
 *  (non-shared) ArrayBuffers so the worker can postMessage them with a transfer
 *  list. The main thread feeds `data`/`parts[].data` straight into `tfMeshToGeo`
 *  and reads `stats`/`cutPlanes` unchanged. */
export interface TfTransferable {
  data: { points: Float32Array; faces: Int32Array };
  stats: TfMeshStats;
  cutPlanes?: TfCutPlane[];
  /** The UNCUT full mesh, present only when a cutaway ran (then `data` is the cut
   *  section). Lets the cross-section toggle be a pure view-switch, no re-bake. */
  fullData?: { points: Float32Array; faces: Int32Array };
  parts?: { data: { points: Float32Array; faces: Int32Array }; appearance?: TfAppearance }[];
}

/** Copy a mesh's point/face arrays into FRESH typed arrays on regular (non-shared)
 *  ArrayBuffers. TrueForm's `mesh.points.data` can be a Float32Array VIEW onto the
 *  kernel's SharedArrayBuffer heap (tf runs pthreads under cross-origin isolation);
 *  a SharedArrayBuffer is NOT transferable, so we must materialise an owned copy
 *  before adding its buffer to the transfer list. `new Float32Array(src)` allocates
 *  a new plain ArrayBuffer + copies element-wise. */
function copyMesh(m: { points: ArrayLike<number>; faces: ArrayLike<number> }): {
  points: Float32Array;
  faces: Int32Array;
} {
  return { points: new Float32Array(m.points), faces: new Int32Array(m.faces) };
}

/**
 * Pack a {@link TfDemoResult} onto TRANSFERABLE typed-array buffers + collect the
 * transfer list. Returns the packed payload and the ArrayBuffers to pass as
 * postMessage's 2nd arg (zero-copy hand-off of the geometry).
 */
export function packTfResult(r: TfDemoResult): { payload: TfTransferable; transfer: ArrayBuffer[] } {
  const transfer: ArrayBuffer[] = [];
  const data = copyMesh(r.data);
  transfer.push(data.points.buffer, data.faces.buffer);
  const payload: TfTransferable = { data, stats: r.stats };
  if (r.cutPlanes) payload.cutPlanes = r.cutPlanes;
  if (r.fullData) {
    const fd = copyMesh(r.fullData);
    transfer.push(fd.points.buffer, fd.faces.buffer);
    payload.fullData = fd;
  }
  if (r.parts && r.parts.length) {
    payload.parts = r.parts.map((p) => {
      const pd = copyMesh(p.data);
      transfer.push(pd.points.buffer, pd.faces.buffer);
      return { data: pd, appearance: p.appearance };
    });
  }
  return { payload, transfer };
}
