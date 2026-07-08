/**
 * tf-bake-client — the MAIN-THREAD API for the client-side TrueForm executor
 * (mirrors `src/lib/cad/bake-client.ts` for the TF backend).
 *
 * Owns ONE `tf-worker.ts` Web Worker and a "latest-wins" job queue: a fast spline
 * drag supersedes in-flight bakes (they resolve to {@link TF_CANCELLED} instead of
 * blocking the caller). The worker returns RAW mesh data — the main thread runs
 * `tfMeshToGeo` (THREE) on it, so no THREE ever enters the worker.
 *
 * WORKER-TRANSPORT FALLBACK: the TF WASM worker is NEW (it was historically run on
 * the main thread — see trueform-client.ts). If the worker fails at the TRANSPORT
 * level (fails to spawn, a script load/parse error, an uncloneable reply — i.e. an
 * `onerror`/`onmessageerror`, NOT a build error the worker deliberately posted
 * back), we mark the worker broken and TRANSPARENTLY re-run the SAME build on the
 * MAIN THREAD via the shared `tf-worker-core`. This preserves today's working TF
 * behaviour as a safety net (the worker is a perf optimisation, not a correctness
 * dependency) while delivering the off-thread build whenever the worker works.
 *
 * A genuine BUILD failure (the worker posted `{ ok:false, error }`, or the
 * main-thread fallback threw) is NOT a transport failure — it REJECTS so the
 * canvas blanks with the reason (native-only contract: no Manifold stand-in).
 *
 * Client-only: references `Worker`. Import it from browser code (lazy-import in a
 * Svelte component). The pure core (`tf-worker-core.ts`) is what the tests drive.
 */
import { ensureTf } from './trueform-client';
import { buildTfRecipe, type TfWorkerRequest, type TfTransferable } from './tf-worker-core';

/** Sentinel a superseded (cancelled) bake resolves to — a fast param/spline drag
 *  shouldn't leave the caller awaiting a result that no longer matters. */
export const TF_CANCELLED = Symbol('tf-cancelled');

/** The raw geometry the caller (rebuildTf) turns into THREE via `tfMeshToGeo`. */
export type TfBakeResult = TfTransferable | typeof TF_CANCELLED;

export function isTfCancelled(r: TfBakeResult): r is typeof TF_CANCELLED {
  return r === TF_CANCELLED;
}

/** What the caller asks for — a native recipe build or a demo, honouring cutaway. */
export interface TfBakeArgs {
  mode: 'native' | 'demo';
  recipe?: import('$lib/cad/graph-to-tf').TfRecipe;
  tfDemo?: string;
  cutaway: boolean;
}

/** Per-bake timing (worker warm + build), surfaced for the badge/console. */
export interface TfBakeTimings { warm: number; build: number; }

// ── Worker reply protocol (mirrors tf-worker.ts postMessage) ────────────────
interface WorkerOk extends TfTransferable { id: number; ok: true; timings?: TfBakeTimings }
interface WorkerErr { id: number; ok: false; error: string }
type WorkerReply = WorkerOk | WorkerErr;

interface Job {
  id: number;
  args: TfBakeArgs;
  resolve: (r: TfBakeResult) => void;
  reject: (e: unknown) => void;
  settled: boolean;
  /** Last-seen timings (attached to the resolved payload for the badge). */
  timings?: TfBakeTimings;
}

let nextId = 0;
const pending = new Map<number, Job>(); // dispatched to the worker, awaiting reply
let waiting: Job | null = null;          // newest job not yet dispatched
let dispatching = false;
let workerBroken = false;                // gave up on the worker → main-thread fallback
let workerDeaths = 0;                     // consecutive worker deaths w/o a healthy reply
const MAX_WORKER_RESPAWNS = 3;            // after this many, stop respawning → main thread

function timingsOn(): boolean {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem('cad-bake-timings') === '1'; } catch { return false; }
}

function settle(job: Job, r: TfBakeResult): void {
  if (!job.settled) { job.settled = true; job.resolve(r); }
}

let worker: Worker | null = null;
function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./tf-worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent<WorkerReply>) => {
      const data = ev.data;
      const job = pending.get(data.id);
      if (!job) return;
      pending.delete(data.id);
      if (data.ok) {
        workerDeaths = 0;   // a healthy reply — restore the respawn budget
        const t = (data as WorkerOk).timings;
        if (t && timingsOn()) { try { console.log(`[tf-worker] warm=${(t.warm ?? 0).toFixed(1)} · build=${(t.build ?? 0).toFixed(1)} ms`); } catch { /* noop */ } }
        const payload: TfTransferable = { data: data.data, stats: data.stats, cutPlanes: data.cutPlanes, fullData: data.fullData, parts: data.parts, cutParts: data.cutParts };
        (payload as any).__timings = t;
        settle(job, payload);
      } else if (!job.settled) {
        // A build error the worker DELIBERATELY posted back → reject (blank canvas).
        job.settled = true;
        job.reject(new Error(data.error));
      }
    };
    // A worker DEATH — either a WASM trap that escaped runTfGuarded (memory OOB /
    // unreachable during a bake) OR a genuine transport failure (script won't
    // load). We can't reliably tell them apart from the ErrorEvent, and it matters
    // because the MAIN-THREAD fallback's TF self-heal (`?tfgen=N` cache-bust
    // re-import) is BROKEN under Vite dev — a bare specifier + query with
    // @vite-ignore doesn't resolve, so ONE trap on the main thread poisons EVERY
    // later bake ("Failed to resolve module specifier '@polydera/trueform?tfgen=1'")
    // until a page reload. A fresh WORKER, by contrast, is a NEW module realm → a
    // clean TF kernel via the plain gen-0 import (resolves in dev + prod). So on a
    // worker death we RESPAWN a fresh worker (up to a cap) instead of latching onto
    // the broken main thread:
    //   • reject the IN-FLIGHT job(s) (the one that trapped) with the reason —
    //     re-running the same bad geometry would just re-trap the fresh worker;
    //   • re-dispatch the newest WAITING job (the user's current request) onto it;
    //   • only after MAX_WORKER_RESPAWNS consecutive deaths (a worker that
    //     genuinely won't stay up) give up and latch to the main-thread fallback.
    // A healthy reply resets workerDeaths (see onmessage).
    const onWorkerDeath = (detail: string) => {
      try { worker?.terminate(); } catch { /* noop */ }
      worker = null;
      workerDeaths++;
      const giveUp = workerDeaths > MAX_WORKER_RESPAWNS;
      try { console.warn(`[tf-worker] worker died (#${workerDeaths}) → ${giveUp ? 'main-thread fallback' : 'respawn fresh worker'}: ${detail}`); } catch { /* noop */ }
      // The in-flight job(s) crashed the worker → reject with the reason (matches
      // the worker's deliberate {ok:false} blank+reason for a bad bake).
      const inflight = [...pending.values()];
      pending.clear();
      for (const job of inflight) if (!job.settled) { job.settled = true; job.reject(new Error(detail)); }
      if (giveUp) {
        workerBroken = true;
        if (waiting) { const w = waiting; waiting = null; void runOnMainThread(w); }
      } else if (waiting) {
        void dispatch();   // fresh getWorker() picks up the newest request
      }
    };
    worker.onerror = (ev) => {
      const e = ev as ErrorEvent;
      onWorkerDeath([e?.message, e?.filename && `@ ${e.filename}:${e.lineno ?? '?'}`].filter(Boolean).join(' ') || 'worker crashed (WASM trap or script load failure)');
    };
    worker.onmessageerror = () => onWorkerDeath('uncloneable reply (messageerror)');
  }
  return worker;
}

/** Run a job on the MAIN THREAD via the shared core — the transport fallback (and
 *  the only path once the worker is known broken). A build error here REJECTS
 *  (native-only: blank canvas + reason), matching the worker's `{ok:false}`. */
async function runOnMainThread(job: Job): Promise<void> {
  try {
    const tf = await ensureTf();
    if (job.settled) return; // superseded during warm
    const req: TfWorkerRequest = { id: job.id, mode: job.args.mode, recipe: job.args.recipe, tfDemo: job.args.tfDemo, cutaway: job.args.cutaway };
    const result = await buildTfRecipe(tf, req);
    if (job.settled) return; // superseded during build
    // packTfResult copies into owned typed arrays; on the main thread we don't need
    // the transfer list, just the payload shape tfMeshToGeo consumes.
    const { packTfResult } = await import('./tf-worker-core');
    const { payload } = packTfResult(result);
    settle(job, payload);
  } catch (e) {
    if (!job.settled) { job.settled = true; job.reject(e); }
  }
}

/**
 * Bake a TF build in the worker (or on the main thread if the worker is broken).
 * Returns the raw {@link TfTransferable} geometry, or {@link TF_CANCELLED} if a
 * newer `run()` superseded this one before it finished.
 */
function run(args: TfBakeArgs): Promise<TfBakeResult> {
  return new Promise<TfBakeResult>((resolve, reject) => {
    const job: Job = { id: ++nextId, args, resolve, reject, settled: false };
    // Supersede the previously-waiting + all in-flight jobs (latest-wins).
    if (waiting) settle(waiting, TF_CANCELLED);
    for (const p of pending.values()) settle(p, TF_CANCELLED);
    waiting = job;
    void dispatch();
  });
}

async function dispatch(): Promise<void> {
  if (dispatching || !waiting) return;
  dispatching = true;
  const job = waiting;
  waiting = null;
  try {
    if (workerBroken) { void runOnMainThread(job); return; }
    pending.set(job.id, job);
    // Recipes are plain JSON but callers may pass Svelte $state PROXY arrays inside
    // — a JSON round-trip yields plain cloneable data (structured-clone rejects
    // proxies with DataCloneError, same trap bake-client guards).
    const recipe = job.args.recipe ? JSON.parse(JSON.stringify(job.args.recipe)) : undefined;
    const msg: TfWorkerRequest = { id: job.id, mode: job.args.mode, recipe, tfDemo: job.args.tfDemo, cutaway: job.args.cutaway, timings: timingsOn() };
    try {
      getWorker().postMessage(msg);
    } catch (e) {
      // postMessage itself threw (e.g. DataCloneError) → transport fallback.
      pending.delete(job.id);
      try { console.warn('[tf-worker] postMessage failed → main-thread fallback:', (e as any)?.message ?? e); } catch { /* noop */ }
      workerBroken = true;
      try { worker?.terminate(); } catch { /* noop */ }
      worker = null;
      void runOnMainThread(job);
    }
  } finally {
    dispatching = false;
    if (waiting) void dispatch();
  }
}

/** Drop the worker (teardown). Next `run()` respawns it. */
function dispose(): void {
  try { worker?.terminate(); } catch { /* noop */ }
  worker = null;
  for (const job of pending.values()) settle(job, TF_CANCELLED);
  pending.clear();
  if (waiting) { settle(waiting, TF_CANCELLED); waiting = null; }
}

export const tfBakeClient = { run, dispose };
