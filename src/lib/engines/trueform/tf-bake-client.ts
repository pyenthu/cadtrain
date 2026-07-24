/**
 * tf-bake-client — the MAIN-THREAD API for the client-side TrueForm executor
 * (mirrors `src/lib/graph/bake-client.ts` for the TF backend).
 *
 * Owns ONE `tf-worker.ts` Web Worker and a "latest-wins" job queue: a fast spline
 * drag supersedes in-flight bakes (they resolve to {@link TF_CANCELLED} instead of
 * blocking the caller). The worker returns RAW mesh data — the main thread runs
 * `tfMeshToGeo` (THREE) on it, so no THREE ever enters the worker.
 *
 * WORKER DEATH vs TRANSPORT FAILURE — two different recoveries:
 *   • A worker DEATH (`onerror`/`onmessageerror` — a WASM trap during a bake, or an
 *     unclassifiable crash) drops the dead worker and RESPAWNS a fresh one (a clean
 *     module realm) for the next DIFFERENT request; the trapped job REJECTS (blank
 *     canvas + reason). We NEVER re-run a trap on the MAIN THREAD: its only post-trap
 *     self-heal is `resetTf()`'s `?tfgen=N` cache-bust re-import, which is
 *     unresolvable under Vite dev, so ONE main-thread trap poisons every later bake
 *     until a page reload — and a WASM module can't get a fresh realm on the main
 *     thread anyway. A fresh WORKER is a new realm → a clean gen-0 TF kernel.
 *   • A genuine TRANSPORT failure where NO WASM has run — `new Worker()` throws, or
 *     `postMessage` throws (uncloneable request) — marks the worker broken and
 *     TRANSPARENTLY re-runs on the MAIN THREAD via the shared `tf-worker-core` (the
 *     gen-0 import resolves fine; nothing has trapped, so nothing to poison).
 *
 * A genuine BUILD failure (the worker posted `{ ok:false, error }`, or the
 * main-thread fallback threw) REJECTS so the canvas blanks with the reason
 * (native-only contract: no Manifold stand-in).
 *
 * Client-only: references `Worker`. Import it from browser code (lazy-import in a
 * Svelte component). The pure core (`tf-worker-core.ts`) is what the tests drive.
 */
import { ensureTf, isTfFatalTrap } from './trueform-client';
import { buildTfRecipe, type TfWorkerRequest, type TfTransferable } from './tf-worker-core';

/** Sentinel a superseded (cancelled) bake resolves to — a fast param/spline drag
 *  shouldn't leave the caller awaiting a result that no longer matters. */
export const TF_CANCELLED = Symbol('tf-cancelled');

/** The raw geometry the caller (rebuildTf) turns into THREE via `tfMeshToGeo`. */
export type TfBakeResult = TfTransferable | typeof TF_CANCELLED;

export function isTfCancelled(r: TfBakeResult): r is typeof TF_CANCELLED {
  return r === TF_CANCELLED;
}

/** What the caller asks for — a native recipe build, honouring cutaway. */
export interface TfBakeArgs {
  mode: 'native';
  recipe?: import('$lib/graph/graph-to-tf').TfRecipe;
  cutaway: boolean;
  /** Non-persisted spline-aware VIEW scale for a warped part (Problem 2) — incl. the
   *  optional AUTOSCALE `dtx` LUT. Forwarded verbatim to the worker + keyed.
   *  `verticalDtx`/`verticalMaxDepth` (Change 2) are carried but IGNORED by TF — the
   *  post-bake vertical z-stretch is MF-only for now. */
  warpViewScale?: { radial?: number; depth?: number; dtx?: import('$lib/engines/manifold/warp-spline').DtxLut; verticalDtx?: boolean; verticalMaxDepth?: number };
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
  /** Recipe signature — a worker death re-dispatches the waiting job only if it is a
   *  DIFFERENT recipe than the one that just trapped (else it would just re-trap). */
  sig: string;
  /** Last-seen timings (attached to the resolved payload for the badge). */
  timings?: TfBakeTimings;
}

let nextId = 0;
const pending = new Map<number, Job>(); // dispatched to the worker, awaiting reply
let waiting: Job | null = null;          // newest job not yet dispatched
let dispatching = false;
let workerBroken = false;                // worker literally unusable (new Worker()/postMessage threw) → main-thread fallback
let consecutiveDeaths = 0;               // worker crashes since the last healthy reply (respawn-thrash backstop)
let lastSentSig: string | null = null;   // recipe signature last dispatched to the worker
const MAX_RESPAWN = 3;                    // cap auto-respawns across consecutive crashes

function timingsOn(): boolean {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem('cad-bake-timings') === '1'; } catch { return false; }
}

function settle(job: Job, r: TfBakeResult): void {
  if (!job.settled) { job.settled = true; job.resolve(r); }
}

/** Stable-ish signature of a bake request — same recipe ⇒ same string. Used to
 *  tell a re-trap of the SAME geometry from a genuinely new request. */
function recipeSig(args: TfBakeArgs): string {
  try { return JSON.stringify({ m: args.mode, c: args.cutaway, r: args.recipe, w: args.warpViewScale }); }
  catch { return `sig-${++nextId}`; } // circular/proxy → unique, treated as "different"
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
        consecutiveDeaths = 0;   // a healthy reply — clear the respawn backstop
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
    // A worker DEATH — a WASM trap that escaped runTfGuarded (memory OOB /
    // unreachable during a bake) or an unclassifiable crash. We NEVER fall back to
    // the main thread here: its only post-trap self-heal is `resetTf()`'s `?tfgen=N`
    // re-import, unresolvable under Vite dev, so one main-thread trap poisons EVERY
    // later bake until a page reload — and a WASM module can't get a fresh realm on
    // the main thread anyway. A fresh WORKER IS a fresh realm (clean gen-0 kernel),
    // so on a death we:
    //   • drop the dead worker (next getWorker() spawns a clean one);
    //   • reject the IN-FLIGHT job(s) that crashed it with the reason (native-only:
    //     the canvas blanks + shows it — no Manifold stand-in);
    //   • re-dispatch the newest WAITING job ONLY if it is a DIFFERENT recipe than
    //     the one that just died (re-running the same bad geometry just re-traps);
    //   • a soft cap (MAX_RESPAWN) stops auto-respawn thrash; a healthy reply and any
    //     new user request (see run()) reset the counter.
    // `looksLikeTrap` is diagnostic only — the recovery is identical either way.
    const onWorkerDeath = (detail: string, looksLikeTrap: boolean) => {
      try { worker?.terminate(); } catch { /* noop */ }
      worker = null;
      const inflight = [...pending.values()];
      pending.clear();
      for (const job of inflight) if (!job.settled) { job.settled = true; job.reject(new Error(detail)); }
      consecutiveDeaths++;
      try { console.warn(`[tf-worker] worker died (#${consecutiveDeaths}${looksLikeTrap ? ', WASM trap' : ''}) → ${waiting ? 'fresh worker for newest request' : 'idle'}: ${detail}`); } catch { /* noop */ }
      if (!waiting) return;                          // nothing queued — the reject already blanked the canvas
      const w = waiting;
      const sameRecipe = w.sig === lastSentSig;      // exactly the geometry that just died — don't re-trap
      if (sameRecipe || consecutiveDeaths > MAX_RESPAWN) {
        waiting = null;
        if (!w.settled) { w.settled = true; w.reject(new Error(detail)); }
        return;
      }
      void dispatch();                               // fresh getWorker() for the newest, DIFFERENT request
    };
    worker.onerror = (ev) => {
      const e = ev as ErrorEvent;
      // A worker ErrorEvent's `message` is often empty for a WASM trap — recover it
      // from `error.message`, and classify a trap by message OR a trueform-wasm
      // filename (the trap's origin), so a bare `[object ErrorEvent]` still counts.
      const msg = String(e?.message || (e as any)?.error?.message || (e as any)?.error || '');
      const fromWasm = /trueform_wasm|\.wasm(\?|$|:)/i.test(e?.filename ?? '');
      const detail = [msg, e?.filename && `@ ${e.filename}:${e.lineno ?? '?'}`].filter(Boolean).join(' ') || 'worker crashed (WASM trap or script load failure)';
      onWorkerDeath(detail, isTfFatalTrap(msg) || fromWasm);
    };
    worker.onmessageerror = () => onWorkerDeath('uncloneable reply (messageerror)', false);
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
    const req: TfWorkerRequest = { id: job.id, mode: job.args.mode, recipe: job.args.recipe, cutaway: job.args.cutaway, warpViewScale: job.args.warpViewScale };
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
    const job: Job = { id: ++nextId, args, sig: recipeSig(args), resolve, reject, settled: false };
    consecutiveDeaths = 0; // a NEW user request is intent, not respawn thrash — clear the backstop
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
    const msg: TfWorkerRequest = { id: job.id, mode: job.args.mode, recipe, cutaway: job.args.cutaway, warpViewScale: job.args.warpViewScale, timings: timingsOn() };
    lastSentSig = job.sig; // remember what we handed the worker — a death checks this to avoid re-trapping
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
