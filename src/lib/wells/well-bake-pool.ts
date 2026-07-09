/**
 * well-bake-pool — the PARALLEL, per-element bake pool for the /wells 3D
 * schematic (#42b-A, `docs/plans/wells-build-architecture.md` §3b).
 *
 * WHY THIS IS NOT `bake-client.ts`. The graph editor's `bake-client` owns ONE
 * worker with **latest-wins** cancellation: a param drag SUPERSEDES the previous
 * bake (there is only ever one part on screen). A well is the opposite — N
 * elements (open holes, casings, cement, tubing, perfs, completions) are all on
 * screen AT ONCE and must build CONCURRENTLY. Superseding a sibling because a
 * *different* element changed would blank the well. So this pool is:
 *
 *   • **N workers** — `clamp(hardwareConcurrency-1, 1, 4)`. Each worker holds its
 *     OWN Manifold WASM instance (true parallelism, no shared-singleton
 *     contention, per-worker crash isolation). Spawned LAZILY up to the cap.
 *   • **Keep-all** — a key change cancels ONLY the superseded element's job;
 *     siblings keep building. Well-switch cancels everything (`cancelAll`).
 *   • **Per-element dedup** — a job is keyed by a stable element `id`; an
 *     unchanged element (same `key`) is never re-baked when a sibling changes
 *     (kills the `{#key geomKey}` full-remount churn — bake only what changed).
 *   • **Streaming** — each element resolves as its worker finishes; the scene
 *     paints top-down instead of blocking on the slowest string.
 *   • **NO fallback** — a worker error rejects that element's job and fires
 *     `onError`; the scene surfaces it (project rule: engine failure = error).
 *
 * This module is PURE SCHEDULING — it holds no THREE / Manifold / geometry
 * knowledge and never touches the DOM, so it unit-tests headlessly against a
 * mock worker (the real Worker can't run in node). The worker payload is opaque
 * `unknown` (structured-clone-safe); the geometry request/reply shapes live in
 * `well-bake-protocol.ts`, and the THREE deserialize lives in the consumer
 * (`well-bake-client.ts`).
 *
 * Transfer: outgoing messages carry an optional transfer list (usually empty on
 * submit); the worker replies with zero-copy transferable geometry buffers,
 * which arrive on `ev.data` unchanged — the pool forwards them to the caller.
 */

/** A superseded / cancelled job resolves to this sentinel (mirrors
 *  `bake-client.BAKE_CANCELLED`) so a caller awaiting `submit()` never hangs on
 *  a result that no longer matters. */
export const WELL_BAKE_CANCELLED = Symbol('well-bake-cancelled');

/** The minimal Worker surface the pool depends on — a real `Worker` satisfies
 *  it, and tests inject a mock. Keeps the pool testable without a real Worker. */
export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessageerror?: ((ev: unknown) => void) | null;
}

/** One element's bake request. */
export interface WellBakeJobSpec {
  /** STABLE across rebuilds — the scheduling + dedup identity (an element id). */
  id: string;
  /** Cache/dedup key: changes iff a geometry-affecting input changed. Same id +
   *  same key ⇒ NO re-bake (the unchanged-sibling win). */
  key: string;
  /** Structured-clone-safe request forwarded verbatim to the worker. */
  payload: unknown;
  /** Optional zero-copy transfer list for the OUTGOING message (rarely used —
   *  well requests are plain data; the reply is where transfer matters). */
  transfer?: Transferable[];
}

/** A finished bake handed back to the caller / `onResult`. `data` is the
 *  worker's reply payload (opaque here — the consumer deserializes it). */
export interface WellBakeReply {
  id: string;
  key: string;
  data: unknown;
}

export interface WellBakePoolOptions {
  /** Worker cap. Default `clamp(hardwareConcurrency-1, 1, 4)`. */
  maxWorkers?: number;
  /** Factory for one worker — defaults to the real `wells-bake-worker.ts`.
   *  Injected by tests with a mock. */
  createWorker?: () => WorkerLike;
}

/** Live counters for tests / a devtools badge. */
export interface WellBakePoolStats {
  workers: number;   // workers spawned
  maxWorkers: number;
  busy: number;      // workers currently baking
  queued: number;    // jobs waiting for a free worker
  inflight: number;  // jobs dispatched, awaiting a reply
  done: number;      // resolved jobs still tracked (dedup memory)
}

// ── Worker reply protocol (mirror of wells-bake-worker.ts postMessage) ────────
interface WorkerOkReply { jobId: number; ok: true; data: unknown }
interface WorkerErrReply { jobId: number; ok: false; error: string }
type WorkerReply = WorkerOkReply | WorkerErrReply;

type JobState = 'queued' | 'inflight' | 'done' | 'cancelled';

interface Waiter {
  resolve: (r: WellBakeReply | typeof WELL_BAKE_CANCELLED) => void;
  reject: (e: unknown) => void;
  settled: boolean;
}

interface InternalJob {
  id: string;
  key: string;
  payload: unknown;
  transfer: Transferable[] | undefined;
  waiters: Waiter[];
  state: JobState;
  /** Dispatch id (worker correlation) — assigned when dispatched, else null. */
  dispatchId: number | null;
  /** Cached reply once done, so a later `submit()` of the same id+key resolves
   *  instantly (and so a stats snapshot can count it). */
  result: WellBakeReply | null;
}

interface WorkerSlot {
  worker: WorkerLike;
  /** dispatchId of the job it is running, or null when idle. */
  busy: number | null;
}

/** `clamp(hardwareConcurrency-1, 1, 4)` — one core kept for the UI thread, capped
 *  at 4 because each worker holds its own ~tens-of-MB Manifold WASM instance
 *  (design §3g). SSR/node-safe: `navigator` may be undefined. */
export function defaultWorkerCount(): number {
  const hc = (typeof navigator !== 'undefined' && Number.isFinite(navigator.hardwareConcurrency))
    ? navigator.hardwareConcurrency
    : 4;
  return Math.max(1, Math.min(4, Math.floor(hc) - 1));
}

export class WellBakePool {
  readonly maxWorkers: number;
  private readonly createWorker: () => WorkerLike;

  private slots: WorkerSlot[] = [];
  private queue: InternalJob[] = [];
  /** The CURRENT job for each element id (queued | inflight | done). At most one
   *  per id — a supersede replaces it. */
  private byId = new Map<string, InternalJob>();
  /** dispatchId → job, for reply correlation. */
  private inflight = new Map<number, InternalJob>();
  private nextDispatchId = 0;
  private disposed = false;

  private resultSubs = new Set<(r: WellBakeReply) => void>();
  private errorSubs = new Set<(id: string, err: Error) => void>();

  constructor(opts: WellBakePoolOptions = {}) {
    this.maxWorkers = Math.max(1, Math.floor(opts.maxWorkers ?? defaultWorkerCount()));
    this.createWorker = opts.createWorker ?? defaultCreateWorker;
  }

  // ── Subscriptions ─────────────────────────────────────────────────────────
  /** Stream every finished bake. Returns an unsubscribe fn. */
  onResult(cb: (r: WellBakeReply) => void): () => void {
    this.resultSubs.add(cb);
    return () => this.resultSubs.delete(cb);
  }
  /** Stream every worker error (per element). Returns an unsubscribe fn. */
  onError(cb: (id: string, err: Error) => void): () => void {
    this.errorSubs.add(cb);
    return () => this.errorSubs.delete(cb);
  }

  // ── Submit one element ────────────────────────────────────────────────────
  /**
   * Bake one element. Resolves with its `WellBakeReply` when the worker
   * finishes, or `WELL_BAKE_CANCELLED` if a newer request (different key, same
   * id) or `cancel`/`cancelAll`/`dispose` superseded it. Rejects on a worker
   * error. Dedups: a re-submit with the SAME id+key attaches to the existing
   * job (or returns its cached result) instead of re-baking.
   */
  submit(spec: WellBakeJobSpec): Promise<WellBakeReply | typeof WELL_BAKE_CANCELLED> {
    if (this.disposed) return Promise.resolve(WELL_BAKE_CANCELLED);
    return new Promise((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, settled: false };
      const existing = this.byId.get(spec.id);
      if (existing && existing.state !== 'cancelled' && existing.key === spec.key) {
        // Dedup — identical work already active or done.
        if (existing.state === 'done' && existing.result) {
          settleWaiter(waiter, existing.result);
        } else {
          existing.waiters.push(waiter);
        }
        return;
      }
      // New id OR changed key ⇒ supersede any existing job for this id, enqueue.
      if (existing) this.cancelJob(existing);
      const job: InternalJob = {
        id: spec.id, key: spec.key, payload: spec.payload, transfer: spec.transfer,
        waiters: [waiter], state: 'queued', dispatchId: null, result: null,
      };
      this.byId.set(spec.id, job);
      this.queue.push(job);
      this.pump();
    });
  }

  /**
   * Reconcile the pool to a desired set of element jobs (the scene's keep-all
   * entry point). For each spec: unchanged (same id+key) ⇒ kept as-is (no
   * re-bake); changed key ⇒ superseded + re-queued; new id ⇒ queued. Any
   * tracked element ABSENT from `specs` is cancelled (removed element). Results
   * stream via `onResult` — this returns nothing (fire-and-forget); use
   * `submit` when you need a per-element promise.
   */
  reconcile(specs: WellBakeJobSpec[]): void {
    if (this.disposed) return;
    const desired = new Map<string, WellBakeJobSpec>();
    for (const s of specs) desired.set(s.id, s);

    // 1. Cancel jobs whose id vanished OR whose key changed.
    for (const [id, job] of [...this.byId]) {
      const want = desired.get(id);
      if (!want || want.key !== job.key) {
        this.cancelJob(job);
        this.byId.delete(id);
      }
    }
    // 2. Queue new / changed elements (unchanged ones were kept in step 1).
    for (const s of specs) {
      const cur = this.byId.get(s.id);
      if (cur && cur.key === s.key && cur.state !== 'cancelled') continue; // unchanged → keep
      const job: InternalJob = {
        id: s.id, key: s.key, payload: s.payload, transfer: s.transfer,
        waiters: [], state: 'queued', dispatchId: null, result: null,
      };
      this.byId.set(s.id, job);
      this.queue.push(job);
    }
    this.pump();
  }

  /** Cancel the tracked job for one element (queued or in-flight). An in-flight
   *  job's worker is left to finish (aborting would waste the warm WASM) but its
   *  reply is dropped. */
  cancel(id: string): void {
    const job = this.byId.get(id);
    if (!job) return;
    this.cancelJob(job);
    this.byId.delete(id);
  }

  /** Cancel EVERYTHING (well-switch). In-flight workers finish + drop; the pool
   *  stays alive (workers reused for the next well). */
  cancelAll(): void {
    for (const job of this.byId.values()) this.cancelJob(job);
    this.byId.clear();
    this.queue = [];
  }

  /** Tear down — terminate every worker + cancel every job. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelAll();
    for (const slot of this.slots) { try { slot.worker.terminate(); } catch { /* noop */ } }
    this.slots = [];
    this.inflight.clear();
    this.resultSubs.clear();
    this.errorSubs.clear();
  }

  get stats(): WellBakePoolStats {
    let done = 0;
    for (const j of this.byId.values()) if (j.state === 'done') done++;
    return {
      workers: this.slots.length,
      maxWorkers: this.maxWorkers,
      busy: this.slots.reduce((n, s) => n + (s.busy !== null ? 1 : 0), 0),
      queued: this.queue.length,
      inflight: this.inflight.size,
      done,
    };
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /** Mark a job cancelled + settle its waiters. Removes it from the queue if it
   *  was waiting; an in-flight job stays in `inflight` so its late reply is
   *  correlated + dropped (freeing the worker). Does NOT touch `byId` — callers
   *  manage that so a supersede can immediately re-key the id. */
  private cancelJob(job: InternalJob): void {
    if (job.state === 'cancelled' || job.state === 'done') {
      // A done job has no waiters to settle; just flip it so reconcile treats it
      // as gone. An already-cancelled job is a no-op.
      job.state = 'cancelled';
      return;
    }
    job.state = 'cancelled';
    if (job.dispatchId === null) {
      const qi = this.queue.indexOf(job);
      if (qi >= 0) this.queue.splice(qi, 1);
    }
    for (const w of job.waiters) settleWaiter(w, WELL_BAKE_CANCELLED);
    job.waiters = [];
  }

  /** Dispatch queued jobs onto free workers until one runs out. */
  private pump(): void {
    if (this.disposed) return;
    while (this.queue.length > 0) {
      // Skip jobs cancelled while queued.
      const job = this.queue[0];
      if (job.state === 'cancelled') { this.queue.shift(); continue; }
      const slot = this.acquireSlot();
      if (!slot) break; // all workers busy + cap reached — wait for a reply
      this.queue.shift();
      const dispatchId = ++this.nextDispatchId;
      job.dispatchId = dispatchId;
      job.state = 'inflight';
      slot.busy = dispatchId;
      this.inflight.set(dispatchId, job);
      try {
        slot.worker.postMessage({ jobId: dispatchId, payload: job.payload }, job.transfer ?? []);
      } catch (e) {
        // A synchronous postMessage failure (uncloneable payload) fails just
        // this job — free the slot + surface the error, keep siblings alive.
        slot.busy = null;
        this.inflight.delete(dispatchId);
        this.failJob(job, e instanceof Error ? e : new Error(String(e)));
      }
    }
  }

  /** An idle slot, or a freshly-spawned one if under the cap, else null. */
  private acquireSlot(): WorkerSlot | null {
    for (const s of this.slots) if (s.busy === null) return s;
    if (this.slots.length < this.maxWorkers) {
      const worker = this.createWorker();
      const slot: WorkerSlot = { worker, busy: null };
      worker.onmessage = (ev) => this.onWorkerMessage(slot, ev.data as WorkerReply);
      worker.onerror = (ev) => this.onWorkerError(slot, ev);
      worker.onmessageerror = (ev) => this.onWorkerError(slot, ev);
      this.slots.push(slot);
      return slot;
    }
    return null;
  }

  private onWorkerMessage(slot: WorkerSlot, reply: WorkerReply): void {
    if (!reply || typeof reply.jobId !== 'number') return;
    const job = this.inflight.get(reply.jobId);
    // Free the slot regardless (it finished its task).
    if (slot.busy === reply.jobId) slot.busy = null;
    this.inflight.delete(reply.jobId);
    if (!job) { this.pump(); return; }
    if (job.state === 'cancelled') { this.pump(); return; } // superseded — drop

    if (reply.ok) {
      const out: WellBakeReply = { id: job.id, key: job.key, data: reply.data };
      job.state = 'done';
      job.result = out;
      for (const w of job.waiters) settleWaiter(w, out);
      job.waiters = [];
      for (const cb of this.resultSubs) { try { cb(out); } catch { /* subscriber error is not the pool's problem */ } }
    } else {
      this.failJob(job, new Error(reply.error || 'well bake worker error'));
    }
    this.pump();
  }

  /** A worker-level error (script load/parse crash, or an uncloneable reply) —
   *  has no jobId, so fail the job that worker was running, then drop + respawn
   *  the worker on demand (its WASM may be corrupt). Siblings on other workers
   *  are untouched. */
  private onWorkerError(slot: WorkerSlot, ev: unknown): void {
    const e = ev as { message?: string; filename?: string; lineno?: number };
    const detail = e?.message
      ? `${e.message}${e.filename ? ` @ ${e.filename}:${e.lineno ?? '?'}` : ''}`
      : 'unknown (well bake worker crashed)';
    const err = new Error(`well bake worker error: ${detail}`);
    const running = slot.busy !== null ? this.inflight.get(slot.busy) : null;
    // Drop the crashed worker so the next pump respawns a clean one.
    const idx = this.slots.indexOf(slot);
    if (idx >= 0) this.slots.splice(idx, 1);
    try { slot.worker.terminate(); } catch { /* noop */ }
    if (running) {
      this.inflight.delete(running.dispatchId as number);
      this.failJob(running, err);
    }
    this.pump();
  }

  /** Reject a job's waiters + fire onError, then mark it cancelled so reconcile
   *  re-queues it on the next pass (or a re-submit re-bakes). */
  private failJob(job: InternalJob, err: Error): void {
    job.state = 'cancelled';
    job.result = null;
    for (const w of job.waiters) { if (!w.settled) { w.settled = true; w.reject(err); } }
    job.waiters = [];
    for (const cb of this.errorSubs) { try { cb(job.id, err); } catch { /* noop */ } }
  }
}

function settleWaiter(w: Waiter, r: WellBakeReply | typeof WELL_BAKE_CANCELLED): void {
  if (!w.settled) { w.settled = true; w.resolve(r); }
}

/** Default factory — the real `wells-bake-worker.ts` module worker. Kept out of
 *  the class so the pure scheduling core never imports the worker (which pulls
 *  in the `?url` wasm asset); tests inject a mock and never load this path. */
function defaultCreateWorker(): WorkerLike {
  return new Worker(new URL('./threeD/wells-bake-worker.ts', import.meta.url), {
    type: 'module',
  }) as unknown as WorkerLike;
}
