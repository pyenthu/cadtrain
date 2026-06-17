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
}

let nextId = 0;
const pending = new Map<number, Job>();   // dispatched to the worker, awaiting reply
let waiting: Job | null = null;           // newest job not yet dispatched
let dispatching = false;

/** Resolve/reject a job at most once (cancelled jobs may still get a late
 *  worker reply — settling is idempotent so that reply is harmlessly dropped). */
function settle(job: Job, r: BakeResult): void {
  if (!job.settled) { job.settled = true; job.resolve(r); }
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
        const payload: TransferableComponentResult = { full: data.full, cutVC: data.cutVC, instanced: data.instanced };
        // Cache even a SUPERSEDED bake — it's a valid mesh; storing it makes the
        // next identical request instant. Best-effort (cache failure is benign).
        void idbPut(job.key, payload);
        settle(job, deserializeComponentResult(payload as any) as BakeGeo);
      } else if (!job.settled) {
        job.settled = true;
        job.reject(new Error(data.error));
      }
    };
    worker.onerror = (ev) => {
      // A worker-level error has no request id — fail every in-flight job so no
      // caller hangs, then drop the worker so the next run() respawns it.
      const err = new Error(`bake worker error: ${ev.message ?? 'unknown'}`);
      for (const job of pending.values()) { if (!job.settled) { job.settled = true; job.reject(err); } }
      pending.clear();
      worker?.terminate();
      worker = null;
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
    try { cached = await idbGet(job.key); } catch { /* cache miss / unavailable */ }
    if (job.settled) return;                       // superseded during the await
    if (cached) {
      settle(job, deserializeComponentResult(cached as any) as BakeGeo);
      return;
    }
    pending.set(job.id, job);
    // Strip any non-cloneable wrapper (callers pass Svelte $state PROXY arrays,
    // which structured-clone rejects → DataCloneError). A JSON round-trip yields
    // plain numbers/strings/arrays/objects — params + options are all JSON data.
    const plainParams = JSON.parse(JSON.stringify(job.args.params ?? []));
    const plainOptions = JSON.parse(JSON.stringify(job.args.options ?? {}));
    getWorker().postMessage({ id: job.id, script: job.args.script, params: plainParams, options: plainOptions });
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
