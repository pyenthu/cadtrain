/**
 * brep-client — main-thread API STUB for the client-side OCCT/BREP executor
 * (P1 of docs/plans/brep-client-side.md, i.e. client-side-execution.md PR5).
 *
 * ⚠ SCAFFOLD ONLY — default OFF, zero behaviour change. This file deliberately
 * does NOT import replicad and does NOT instantiate a Web Worker, so Vite never
 * bundles the 10 MB emscripten OCCT glue and `bun run build` stays green. The
 * real worker (`brep-worker.ts`) + the ported executor (`brep-executor.ts`) land
 * in P1 after the P0 browser spike proves the WASM loads in a Vite worker chunk.
 *
 * It mirrors `bake-client.ts` (the Manifold client executor) so the P1 wiring is
 * a structural fill-in, not a redesign. Nothing imports this on the hot path yet
 * — exactly like `bake-client.ts` shipped unwired in PR2 ("that's PR3").
 *
 * CLIENT-ONLY: `runBrepClient` will reference `Worker` + `indexedDB` once real —
 * import it from browser code only (lazy-import in a Svelte component).
 */
import type * as THREE from 'three';

/** localStorage flag gating the client OCCT path. Default OFF (opt-IN) — the
 *  inverse of `cad-client-bake`, which is opt-OUT. During rollout BREP stays
 *  server-side unless the user explicitly turns the client kernel on. */
export const BREP_CLIENT_FLAG = 'cad-client-brep';

/** True when the user has opted into the client-side OCCT executor. SSR-safe
 *  (returns false when `localStorage` is unavailable). */
export function brepClientEnabled(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(BREP_CLIENT_FLAG) === '1';
  } catch {
    return false;
  }
}

/** Thrown by the stub `runBrepClient` until P1 wires the real worker. Callers
 *  (the `rebuildBrep` branch) MUST catch this and fall back to the server
 *  `/api/brep/preview` path, so a stray flag flip can never blank the tab. */
export const BREP_CLIENT_NOT_READY = 'BREP_CLIENT_NOT_READY';

/** Args for a client BREP bake — mirrors `bake-client.ts` `BakeRunArgs`.
 *  `source` is the dep-INLINED emitted part source from /api/primitives/compile
 *  (design B in the plan: the worker imports the executor and runs the source;
 *  deps are already inlined so no client-side dep fetch). */
export interface BrepRunArgs {
  /** Dep-inlined emitted part source (from /api/primitives/compile). */
  source: string;
  /** sha256 of `source` — the IndexedDB cache key root (folds in deps → the
   *  deja-vu stale-dep bug stays structurally impossible). */
  scriptHash: string;
  /** param name → current value (graph.params order ↔ bake.args). */
  paramValues: Record<string, number>;
  /** OCCT linear deflection (lower = finer). */
  tolerance?: number;
  /** OCCT angular deflection. */
  angularTolerance?: number;
  /** Half-section cutaway (inner-grey / outer-red), like the server `cut`. */
  cut?: boolean;
}

/** The geometry shape the BREP scene consumes — same wrapper `brep-adapter.ts`
 *  `brepResponseToGeo` produces, so the P1 canvas swap is zero scene change. */
export interface BrepGeo {
  full?: THREE.BufferGeometry;
  cutVC?: THREE.BufferGeometry;
}

/**
 * STUB. In P1 this owns one `brep-worker.ts` Web Worker (warm OCCT singleton,
 * latest-wins cancellation, IndexedDB mesh cache keyed on `scriptHash + params +
 * cut + KERNEL_VERSION`) and returns `{ full } | { cutVC }`.
 *
 * Until then it throws `BREP_CLIENT_NOT_READY` so any caller behind the (default
 * OFF) flag transparently falls back to the server path.
 */
export function runBrepClient(_args: BrepRunArgs): Promise<BrepGeo> {
  return Promise.reject(new Error(BREP_CLIENT_NOT_READY));
}

export const brepClient = { enabled: brepClientEnabled, run: runBrepClient };
