/**
 * bake-client — the MAIN-THREAD API for the client-side Manifold executor
 * (PR2 of docs/plans/client-side-execution.md).
 *
 * Owns ONE `bake-worker.ts` Web Worker, a message queue with "latest-wins"
 * cancellation (param drags supersede fast — a superseded bake resolves to the
 * `BAKE_CANCELLED` sentinel instead of blocking the caller), and a per-client
 * IndexedDB mesh cache keyed on `scriptHash + params + options` (survives
 * reload; same key discipline as the server script cache → no stale-dep
 * recurrence; KERNEL_VERSION in the key busts it across a WASM upgrade).
 *
 * NOT wired into any canvas — that's PR3. The returned `{ full, cutVC,
 * instanced }` shape matches /api/primitives/preview exactly so PR3 can swap
 * backends with zero scene changes.
 *
 * This module references `Worker` + `indexedDB`, so it is CLIENT-ONLY — import
 * it from browser code only (lazy-import in a Svelte component). The unit tests
 * exercise the pure core (`bake-worker-core.ts`) directly, not this file.
 */
import { deserializeComponentResult } from './mesh-serial';
import { isManifoldFatalTrap, describeManifoldError } from '$lib/cad/manifold-trap';
import { bakeCacheKey, type BakeOptions, type TransferableComponentResult } from './bake-worker-core';
import type * as THREE from 'three';

/** Sentinel a superseded (cancelled) bake resolves to — so a fast param drag
 *  doesn't leave callers awaiting a result that no longer matters. */
export const BAKE_CANCELLED = Symbol('bake-cancelled');

/** The geometry shape the scene consumes — identical to the deserialized
 *  server-preview result. */
export interface BakeGeo {
  full: THREE.BufferGeometry;
  cutVC: THREE.BufferGeometry;
  instanced?: { instances: number[][]; count: number };
  parts?: { geo: THREE.BufferGeometry; appearance?: import('$lib/shared/part-appearance').PartAppearance; id?: string }[];
  cutParts?: { geo: THREE.BufferGeometry; appearance?: import('$lib/shared/part-appearance').PartAppearance; id?: string }[];
}

export type BakeResult = BakeGeo | typeof BAKE_CANCELLED;

/** True when a `run()` result was superseded by a newer request. */
export function isCancelled(r: BakeResult): r is typeof BAKE_CANCELLED {
  return r === BAKE_CANCELLED;
}

export interface BakeRunArgs {
  /** Self-contained script text from /api/primitives/compile. */
  script: string;
  /** sha256(script) from /api/primitives/compile — the cache key root. */
  scriptHash: string;
  /** Positional args (number | string) OR a single object. */
  params: Array<number | string> | Record<string, unknown>;
  options?: BakeOptions;
  /** 🔄 force-refresh: skip the IndexedDB cache READ so the worker re-bakes from
   *  scratch. The fresh result still WRITES to the cache (so later identical
   *  requests are instant again). Default false = cache-first (byte-identical). */
  bust?: boolean;
}

// ── Worker reply protocol (mirrors bake-worker.ts postMessage) ──────────────
interface WorkerOk extends TransferableComponentResult { id: number; ok: true }
interface WorkerErr { id: number; ok: false; error: string }
type WorkerReply = WorkerOk | WorkerErr;

interface Job {
  id: number;
  key: string;
  args: BakeRunArgs;
  resolve: (r: BakeResult) => void;
  reject: (e: unknown) => void;
  settled: boolean;
  /** Fatal-trap retries already spent on this job (see `MAX_TRAP_RETRIES`). */
  trapRetries: number;
}

let nextId = 0;
const pending = new Map<number, Job>();   // dispatched to the worker, awaiting reply
let waiting: Job | null = null;           // newest job not yet dispatched
let dispatching = false;

// ── Fatal-trap guard (/plan #981) ────────────────────────────────────────────
//
// A WASM trap inside the worker POISONS its Manifold module: the worker catches
// the throw and replies `{ok:false}`, so the worker SURVIVES — and every later
// bake on it fails, typically with `emval_methodCallers[caller] is not a
// function` naming whatever part was on the stack. Before this guard, the only
// cure was reloading the page. TF has had this for a while (`isTfFatalTrap` +
// respawn, tf-bake-client); Manifold had nothing.
//
// A trapped worker is unrecoverable, so we terminate it. A FRESH worker is a
// clean Manifold module, so the job is worth exactly one retry: if the geometry
// itself is what traps, the retry traps too and we surface the error instead of
// looping. Budget is per-job, not global — a genuinely bad part must not consume
// the retries of the good bake that follows it.
export const MAX_TRAP_RETRIES = 1;

/**
 * What to do with a job whose worker just trapped. Pure, so the subtle case is
 * testable: if a NEWER request is already waiting, re-queueing this job would
 * overwrite `waiting`, and that newer job would never dispatch — its caller would
 * hang forever. A superseded job's result is wanted by nobody, so cancel it and
 * let the newer one run on the fresh worker.
 */
export function planTrapRecovery(
  trapRetries: number,
  hasNewerWaiting: boolean,
  maxRetries: number = MAX_TRAP_RETRIES,
): 'retry' | 'cancel' | 'reject' {
  if (hasNewerWaiting) return 'cancel';
  return trapRetries < maxRetries ? 'retry' : 'reject';
}

/** Kill the worker so the next `getWorker()` builds a clean one. */
function killWorker(): void {
  try { worker?.terminate(); } catch { /* already dead */ }
  worker = null;
}

/** Resolve/reject a job at most once (cancelled jobs may still get a late
 *  worker reply — settling is idempotent so that reply is harmlessly dropped). */
function settle(job: Job, r: BakeResult): void {
  if (!job.settled) { job.settled = true; job.resolve(r); }
}

/** Opt-in perf logging — `localStorage.cad-bake-timings === '1'`. Gates both the
 *  worker's internal logs (passed in the message) and the [bake-worker] log here. */
function timingsOn(): boolean {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem('cad-bake-timings') === '1'; } catch { return false; }
}

let worker: Worker | null = null;
function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./bake-worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent<WorkerReply>) => {
      const data = ev.data;
      const job = pending.get(data.id);
      if (!job) return;
      pending.delete(data.id);
      if (data.ok) {
        const t = (data as any).timings;
        if (t && timingsOn()) { try { console.log(`[bake-worker] build=${(t.build ?? 0).toFixed(1)} · mesh=${(t.mesh ?? 0).toFixed(1)} · cutaway=${(t.cutaway ?? 0).toFixed(1)} · serialize=${(t.serialize ?? 0).toFixed(1)} ms`); } catch {} }
        const payload: TransferableComponentResult = {
          full: data.full, cutVC: data.cutVC, instanced: data.instanced,
          // Per-part meshes (transparent-composite / color-by-source path). The
          // worker packs these into the reply; carry them through so the scene's
          // per-part arm renders (dropping them here → single merged mesh → an
          // opacity<1 subpart like bw_open_hole renders OPAQUE). Also cached below.
          ...(data.parts ? { parts: data.parts } : {}),
          ...(data.cutParts ? { cutParts: data.cutParts } : {}),
        };
        // Cache even a SUPERSEDED bake — it's a valid mesh; storing it makes the
        // next identical request instant. Best-effort (cache failure is benign).
        void idbPut(job.key, payload);
        const _td0 = (typeof performance !== 'undefined' ? performance.now() : 0);
        const geo = deserializeComponentResult(payload as any) as BakeGeo;
        if (timingsOn()) { try { console.log(`[bake-deserialize] main-thread BufferGeometry build=${((typeof performance !== 'undefined' ? performance.now() : 0) - _td0).toFixed(1)} ms`); } catch {} }
        // Surface the worker's per-phase timings on the mesh so the caller's
        // badge can report the REAL bake cost (this was `fresh · 0 ms` before —
        // #987). A fresh worker bake, so `cached: false`.
        (geo as any).__bakeMeta = { cached: false, phases: t };
        settle(job, geo);
      } else if (!job.settled) {
        // A FATAL WASM trap leaves this worker's Manifold module corrupted, but
        // the worker itself alive — so every later bake on it would fail too.
        // Kill it, and give the job one shot on a clean module.
        if (isManifoldFatalTrap(data.error)) {
          try { console.error(`[bake-worker] fatal Manifold trap; terminating worker. raw: ${String(data.error).slice(0, 200)}`); } catch {}
          killWorker();
          // Every other in-flight job ran on that same poisoned module. They are
          // already superseded by construction (run() cancels them), but settle
          // defensively so nothing awaits a worker that no longer exists.
          for (const p of pending.values()) { if (p !== job) settle(p, BAKE_CANCELLED); }
          pending.clear();

          switch (planTrapRecovery(job.trapRetries, waiting !== null)) {
            case 'retry':
              job.trapRetries++;
              // Re-queue on a fresh worker. NOT via `run()` — that supersedes all
              // jobs, including the one we are trying to retry.
              waiting = job;
              void dispatch();
              return;
            case 'cancel':
              // A newer request already supersedes this one; it must not overwrite
              // `waiting`. Let the newer job bake on the clean worker.
              settle(job, BAKE_CANCELLED);
              void dispatch();
              return;
            case 'reject':
              job.settled = true;
              job.reject(new Error(describeManifoldError(data.error)));
              return;
          }
        }
        job.settled = true;
        job.reject(new Error(data.error));
      }
    };
    worker.onerror = (ev) => {
      // A worker-level error has no request id — fail every in-flight job so no
      // caller hangs, then drop the worker so the next run() respawns it.
      // Surface the FULL ErrorEvent (message is often empty for a script
      // LOAD/PARSE failure — the filename/lineno are the real signal there).
      const e = ev as ErrorEvent;
      const detail =
        [e?.message, e?.filename && `@ ${e.filename}:${e.lineno ?? '?'}:${e.colno ?? '?'}`]
          .filter(Boolean).join(' ') || 'unknown (worker script failed to load/parse)';
      try { console.error('[bake-worker] worker-level error', { message: e?.message, filename: e?.filename, lineno: e?.lineno, colno: e?.colno, error: e?.error }); } catch {}
      const err = new Error(`bake worker error: ${detail}`);
      for (const job of pending.values()) { if (!job.settled) { job.settled = true; job.reject(err); } }
      pending.clear();
      worker?.terminate();
      worker = null;
    };
    // A structured-clone failure on an incoming message (not a bake error) —
    // surface it rather than silently dropping the reply.
    worker.onmessageerror = (ev) => {
      try { console.error('[bake-worker] messageerror (uncloneable reply)', ev); } catch {}
      const err = new Error('bake worker messageerror: reply could not be deserialized');
      for (const job of pending.values()) { if (!job.settled) { job.settled = true; job.reject(err); } }
      pending.clear();
    };
  }
  return worker;
}

/**
 * Bake a compiled script in the worker. Returns the `{ full, cutVC, instanced }`
 * geometry, or `BAKE_CANCELLED` if a newer `run()` superseded this one before it
 * finished. Checks the IndexedDB cache first (instant hit), else bakes + stores.
 */
function run(args: BakeRunArgs): Promise<BakeResult> {
  return new Promise<BakeResult>((resolve, reject) => {
    const job: Job = {
      id: ++nextId,
      key: bakeCacheKey(args.scriptHash, args.params, args.options),
      args,
      resolve,
      reject,
      settled: false,
      trapRetries: 0,
    };
    // Supersede the previously-waiting (undispatched) job + any in-flight jobs:
    // their results no longer matter, so resolve them cancelled now rather than
    // leaving the caller blocked behind a stale bake.
    if (waiting) settle(waiting, BAKE_CANCELLED);
    for (const p of pending.values()) settle(p, BAKE_CANCELLED);
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
    let cached: TransferableComponentResult | null = null;
    // 🔄 bust skips the cache READ → a genuine fresh worker bake (the result is
    // still idbPut below, so the next non-bust request is instant again).
    if (!job.args.bust) { try { cached = await idbGet(job.key); } catch { /* cache miss / unavailable */ } }
    if (job.settled) return;                       // superseded during the await
    if (cached) {
      const g = deserializeComponentResult(cached as any) as BakeGeo;
      // Mark the mesh so the caller's badge can say "cached" honestly — an
      // IndexedDB scriptHash hit, not a compile-cache hit. No bake ran, so no
      // phase timings.
      (g as any).__bakeMeta = { cached: true };
      settle(job, g);
      return;
    }
    pending.set(job.id, job);
    // Strip any non-cloneable wrapper (callers pass Svelte $state PROXY arrays,
    // which structured-clone rejects → DataCloneError). A JSON round-trip yields
    // plain numbers/strings/arrays/objects — params + options are all JSON data.
    const plainParams = JSON.parse(JSON.stringify(job.args.params ?? []));
    const plainOptions = JSON.parse(JSON.stringify(job.args.options ?? {}));
    getWorker().postMessage({ id: job.id, script: job.args.script, params: plainParams, options: plainOptions, timings: timingsOn() });
  } finally {
    dispatching = false;
    if (waiting) void dispatch();                  // a newer job arrived mid-dispatch
  }
}

/** Drop the worker (e.g. on teardown). Next `run()` respawns it. */
function dispose(): void {
  worker?.terminate();
  worker = null;
  for (const job of pending.values()) settle(job, BAKE_CANCELLED);
  pending.clear();
  if (waiting) { settle(waiting, BAKE_CANCELLED); waiting = null; }
}

export const bakeClient = { run, dispose };

// ── IndexedDB mesh cache (tiny hand-rolled wrapper — no heavy dep) ──────────
const DB_NAME = 'cadtrain-bake-cache';
const STORE = 'meshes';
let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDB(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    if (typeof indexedDB === 'undefined') { resolve(null); return; }
    let req: IDBOpenDBRequest;
    try { req = indexedDB.open(DB_NAME, 1); } catch { resolve(null); return; }
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  return dbPromise;
}

async function idbGet(key: string): Promise<TransferableComponentResult | null> {
  const db = await openDB();
  if (!db) return null;
  return new Promise<TransferableComponentResult | null>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const r = tx.objectStore(STORE).get(key);
      r.onsuccess = () => resolve((r.result as TransferableComponentResult) ?? null);
      r.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

async function idbPut(key: string, val: TransferableComponentResult): Promise<void> {
  const db = await openDB();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(val, key);
  } catch { /* quota / version error → skip (cache is an optimisation) */ }
}
