/**
 * well-bake-pool.test — headless coverage of the WellBakePool SCHEDULING policy
 * (#42b-A). The real Worker + Manifold can't run in node, so we inject a MOCK
 * worker and drive replies by hand — that isolates exactly the queue/scheduling
 * logic where the bugs hide (keep-all supersede, per-element dedup, worker-cap
 * scaling, cancellation, streaming, crash isolation). Geometry correctness +
 * the actual parallel speedup are BROWSER-verified after merge.
 */
import { describe, it, expect } from 'vitest';
import {
  WellBakePool, WELL_BAKE_CANCELLED, defaultWorkerCount,
  type WorkerLike, type WellBakeJobSpec,
} from '../well-bake-pool';

// ── Mock worker + fleet ───────────────────────────────────────────────────────
class MockWorker implements WorkerLike {
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessageerror: ((ev: unknown) => void) | null = null;
  posted: Array<{ jobId: number; payload: unknown }> = [];
  current: number | null = null;
  terminated = false;

  postMessage(msg: unknown): void {
    const m = msg as { jobId: number; payload: unknown };
    this.posted.push(m);
    this.current = m.jobId;
  }
  terminate(): void { this.terminated = true; }

  /** Reply OK to the worker's current (last-posted, un-replied) job. */
  reply(data: unknown = { ok: 1 }): void {
    const id = this.current; this.current = null;
    this.onmessage?.({ data: { jobId: id, ok: true, data } });
  }
  /** Reply ERROR to the current job. */
  replyErr(error = 'boom'): void {
    const id = this.current; this.current = null;
    this.onmessage?.({ data: { jobId: id, ok: false, error } });
  }
  /** Reply OK to a SPECIFIC (possibly stale) dispatch id. */
  replyTo(jobId: number, data: unknown = { ok: 1 }): void {
    this.onmessage?.({ data: { jobId, ok: true, data } });
  }
  crash(ev: unknown = { message: 'worker crashed' }): void { this.onerror?.(ev); }
}

function fleet() {
  const workers: MockWorker[] = [];
  const createWorker = () => { const w = new MockWorker(); workers.push(w); return w; };
  return { workers, createWorker };
}

/** Total messages posted across every worker. */
function allPosted(workers: MockWorker[]): Array<{ jobId: number; payload: unknown }> {
  return workers.flatMap((w) => w.posted);
}
/** How many times a given payload was dispatched (across all workers). */
function countPayload(workers: MockWorker[], payload: unknown): number {
  return allPosted(workers).filter((m) => JSON.stringify(m.payload) === JSON.stringify(payload)).length;
}

function spec(id: string, key: string, payload: unknown = { id, key }): WellBakeJobSpec {
  return { id, key, payload };
}

// ── worker-count clamp ────────────────────────────────────────────────────────
describe('defaultWorkerCount — clamp(hardwareConcurrency-1, 1, 4)', () => {
  const withHC = (hc: number | undefined, fn: () => void) => {
    // `navigator` is a getter-only global in node → override via defineProperty.
    const had = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', {
      value: hc === undefined ? undefined : { hardwareConcurrency: hc },
      configurable: true, writable: true,
    });
    try { fn(); } finally {
      if (had) Object.defineProperty(globalThis, 'navigator', had);
      else delete (globalThis as any).navigator;
    }
  };

  it('clamps to at least 1', () => { withHC(1, () => expect(defaultWorkerCount()).toBe(1)); });
  it('leaves one core for the UI (2 → 1, 3 → 2, 5 → 4)', () => {
    withHC(2, () => expect(defaultWorkerCount()).toBe(1));
    withHC(3, () => expect(defaultWorkerCount()).toBe(2));
    withHC(5, () => expect(defaultWorkerCount()).toBe(4));
  });
  it('caps at 4 for many cores', () => { withHC(64, () => expect(defaultWorkerCount()).toBe(4)); });
  it('defaults sanely when navigator is absent (SSR/node)', () => {
    withHC(undefined, () => { const n = defaultWorkerCount(); expect(n).toBeGreaterThanOrEqual(1); expect(n).toBeLessThanOrEqual(4); });
  });

  it('pool honours an explicit maxWorkers, floored at 1', () => {
    const { createWorker } = fleet();
    expect(new WellBakePool({ maxWorkers: 3, createWorker }).maxWorkers).toBe(3);
    expect(new WellBakePool({ maxWorkers: 0, createWorker }).maxWorkers).toBe(1);
    expect(new WellBakePool({ maxWorkers: -5, createWorker }).maxWorkers).toBe(1);
  });
});

// ── lazy spawn + worker cap ───────────────────────────────────────────────────
describe('worker spawning — lazy, capped', () => {
  it('spawns lazily (1 job → 1 worker even with cap 4)', () => {
    const { workers, createWorker } = fleet();
    const pool = new WellBakePool({ maxWorkers: 4, createWorker });
    pool.submit(spec('a', 'k'));
    expect(workers.length).toBe(1);
    expect(pool.stats).toMatchObject({ workers: 1, busy: 1, queued: 0, inflight: 1 });
  });

  it('never spawns more than maxWorkers; extra jobs queue', () => {
    const { workers, createWorker } = fleet();
    const pool = new WellBakePool({ maxWorkers: 2, createWorker });
    for (let i = 0; i < 6; i++) pool.submit(spec(`e${i}`, `k${i}`));
    expect(workers.length).toBe(2);
    expect(pool.stats).toMatchObject({ workers: 2, busy: 2, inflight: 2, queued: 4 });
  });

  it('drains the queue as workers reply, staying at the cap', () => {
    const { workers, createWorker } = fleet();
    const pool = new WellBakePool({ maxWorkers: 2, createWorker });
    for (let i = 0; i < 5; i++) pool.submit(spec(`e${i}`, `k${i}`));
    expect(pool.stats.queued).toBe(3);
    workers[0].reply();                       // frees a slot → next queued dispatched
    expect(pool.stats.queued).toBe(2);
    expect(pool.stats.busy).toBe(2);
    workers[1].reply();
    expect(pool.stats.queued).toBe(1);
    expect(workers.length).toBe(2);           // still only 2 workers
  });
});

// ── per-element dedup ─────────────────────────────────────────────────────────
describe('per-element dedup — same id+key bakes once', () => {
  it('a duplicate submit attaches to the in-flight job (one dispatch, both resolve)', async () => {
    const { workers, createWorker } = fleet();
    const pool = new WellBakePool({ maxWorkers: 4, createWorker });
    const p1 = pool.submit(spec('a', 'k1', 'PAY'));
    const p2 = pool.submit(spec('a', 'k1', 'PAY'));   // dedup
    expect(countPayload(workers, 'PAY')).toBe(1);      // ONE bake
    workers[0].reply({ mesh: 1 });
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual(r2);
    expect(r1).toMatchObject({ id: 'a', key: 'k1', data: { mesh: 1 } });
  });

  it('a re-submit of a DONE id+key resolves instantly from cache (no re-bake)', async () => {
    const { workers, createWorker } = fleet();
    const pool = new WellBakePool({ maxWorkers: 4, createWorker });
    const p1 = pool.submit(spec('a', 'k1', 'PAY'));
    workers[0].reply({ mesh: 7 });
    await p1;
    const before = countPayload(workers, 'PAY');
    const r2 = await pool.submit(spec('a', 'k1', 'PAY'));
    expect(countPayload(workers, 'PAY')).toBe(before);   // no new dispatch
    expect(r2).toMatchObject({ id: 'a', key: 'k1', data: { mesh: 7 } });
  });
});

// ── keep-all supersede (the crux) ─────────────────────────────────────────────
describe('keep-all reconcile — supersede ONLY the changed element', () => {
  it('re-bakes only the element whose key changed; siblings kept', () => {
    const { workers, createWorker } = fleet();
    const pool = new WellBakePool({ maxWorkers: 4, createWorker });
    pool.reconcile([spec('A', 'a1', 'A1'), spec('B', 'b1', 'B1'), spec('C', 'c1', 'C1')]);
    expect(pool.stats.inflight).toBe(3);
    // Finish all three.
    for (const w of workers) w.reply();
    expect(pool.stats).toMatchObject({ inflight: 0, queued: 0, done: 3 });

    // B changes; A + C unchanged.
    pool.reconcile([spec('A', 'a1', 'A1'), spec('B', 'b2', 'B2'), spec('C', 'c1', 'C1')]);
    expect(countPayload(workers, 'A1')).toBe(1);   // A NOT re-baked
    expect(countPayload(workers, 'C1')).toBe(1);   // C NOT re-baked
    expect(countPayload(workers, 'B2')).toBe(1);   // only B re-baked
    expect(countPayload(workers, 'B1')).toBe(1);   // (old B baked exactly once)
  });

  it('re-baking a sibling does NOT cancel the others in flight', () => {
    const { workers, createWorker } = fleet();
    const pool = new WellBakePool({ maxWorkers: 4, createWorker });
    pool.reconcile([spec('A', 'a1'), spec('B', 'b1'), spec('C', 'c1')]);
    // A + C still in flight (not replied). Now B's key changes.
    pool.reconcile([spec('A', 'a1'), spec('B', 'b2'), spec('C', 'c1')]);
    // A + C jobs untouched (still inflight), B re-queued (a 4th dispatch).
    expect(pool.stats.inflight).toBe(4); // A, C original + old-B(dropped-but-inflight) + new-B
    // The old B dispatch is marked cancelled; replying it is dropped.
    const results: string[] = [];
    pool.onResult((r) => results.push(r.id));
    for (const w of workers) w.reply();
    // A, C, and the NEW B resolve; the superseded old-B is dropped.
    expect(results.sort()).toEqual(['A', 'B', 'C']);
  });

  it('cancels a queued element removed from the set (never dispatched)', () => {
    const { workers, createWorker } = fleet();
    const pool = new WellBakePool({ maxWorkers: 1, createWorker });
    pool.reconcile([spec('A', 'a1', 'A1'), spec('B', 'b1', 'B1')]); // A inflight, B queued
    expect(pool.stats).toMatchObject({ inflight: 1, queued: 1 });
    pool.reconcile([spec('A', 'a1', 'A1')]);                        // B removed
    expect(pool.stats.queued).toBe(0);
    workers[0].reply();                                             // finish A
    expect(countPayload(workers, 'B1')).toBe(0);                    // B never baked
  });

  it('drops the late reply of a removed IN-FLIGHT element', () => {
    const { workers, createWorker } = fleet();
    const pool = new WellBakePool({ maxWorkers: 2, createWorker });
    const got: string[] = [];
    pool.onResult((r) => got.push(r.id));
    pool.reconcile([spec('A', 'a1'), spec('B', 'b1')]);  // both inflight
    pool.reconcile([spec('A', 'a1')]);                    // B removed while inflight
    for (const w of workers) w.reply();                   // B's reply must be dropped
    expect(got).toEqual(['A']);
  });

  it('is idempotent — reconciling an unchanged set re-bakes nothing', () => {
    const { workers, createWorker } = fleet();
    const pool = new WellBakePool({ maxWorkers: 4, createWorker });
    pool.reconcile([spec('A', 'a1', 'A1')]);
    workers[0].reply();
    pool.reconcile([spec('A', 'a1', 'A1')]);
    pool.reconcile([spec('A', 'a1', 'A1')]);
    expect(countPayload(workers, 'A1')).toBe(1);
  });
});

// ── cancellation ──────────────────────────────────────────────────────────────
describe('cancellation', () => {
  it('cancel() resolves the job CANCELLED and drops its late reply', async () => {
    const { workers, createWorker } = fleet();
    const pool = new WellBakePool({ maxWorkers: 4, createWorker });
    const p = pool.submit(spec('a', 'k'));
    const jobId = workers[0].posted[0].jobId;
    pool.cancel('a');
    expect(await p).toBe(WELL_BAKE_CANCELLED);
    // A late worker reply for the cancelled dispatch is harmlessly ignored.
    let emitted = 0; pool.onResult(() => emitted++);
    workers[0].replyTo(jobId, { mesh: 1 });
    expect(emitted).toBe(0);
  });

  it('supersede (same id, new key) resolves the first CANCELLED, bakes the second', async () => {
    const { workers, createWorker } = fleet();
    const pool = new WellBakePool({ maxWorkers: 4, createWorker });
    const p1 = pool.submit(spec('a', 'k1', 'V1'));
    const firstJobId = workers[0].posted[0].jobId;
    const p2 = pool.submit(spec('a', 'k2', 'V2'));   // supersede → new worker (w0 still busy)
    expect(await p1).toBe(WELL_BAKE_CANCELLED);
    // A late reply to the FIRST (superseded) dispatch is dropped...
    workers[0].replyTo(firstJobId, { stale: true });
    // ...the SECOND dispatch (on the freshly-spawned worker) resolves p2.
    workers[1].reply({ fresh: true });
    expect(await p2).toMatchObject({ id: 'a', key: 'k2', data: { fresh: true } });
    expect(countPayload(workers, 'V2')).toBe(1);
  });

  it('cancelAll() resolves everything CANCELLED and clears the queue', async () => {
    const { createWorker } = fleet();
    const pool = new WellBakePool({ maxWorkers: 2, createWorker });
    const ps = [pool.submit(spec('a', '1')), pool.submit(spec('b', '2')), pool.submit(spec('c', '3'))];
    pool.cancelAll();
    expect(pool.stats).toMatchObject({ queued: 0, done: 0 });
    for (const p of ps) expect(await p).toBe(WELL_BAKE_CANCELLED);
  });

  it('dispose() terminates every worker and cancels in-flight jobs', async () => {
    const { workers, createWorker } = fleet();
    const pool = new WellBakePool({ maxWorkers: 3, createWorker });
    const p = pool.submit(spec('a', '1'));
    pool.dispose();
    expect(workers.every((w) => w.terminated)).toBe(true);
    expect(await p).toBe(WELL_BAKE_CANCELLED);
    // Post-dispose submit is a no-op cancelled.
    expect(await pool.submit(spec('b', '2'))).toBe(WELL_BAKE_CANCELLED);
  });
});

// ── streaming + errors + crash isolation ─────────────────────────────────────
describe('streaming, errors, crash isolation', () => {
  it('onResult streams each element as its worker finishes (progressive)', () => {
    const { workers, createWorker } = fleet();
    const pool = new WellBakePool({ maxWorkers: 3, createWorker });
    const order: string[] = [];
    pool.onResult((r) => order.push(r.id));
    pool.reconcile([spec('A', 'a'), spec('B', 'b'), spec('C', 'c')]);
    workers[1].reply();   // B finishes first
    workers[0].reply();   // then A
    expect(order).toEqual(['B', 'A']);   // streamed in completion order, not submit order
  });

  it('a worker error rejects the job and fires onError (NO fallback)', async () => {
    const { workers, createWorker } = fleet();
    const pool = new WellBakePool({ maxWorkers: 4, createWorker });
    const errs: Array<[string, string]> = [];
    pool.onError((id, e) => errs.push([id, e.message]));
    const p = pool.submit(spec('a', 'k'));
    workers[0].replyErr('manifold exploded');
    await expect(p).rejects.toThrow(/manifold exploded/);
    expect(errs).toEqual([['a', 'manifold exploded']]);
  });

  it('a worker CRASH fails only its job + respawns; siblings continue', async () => {
    const { workers, createWorker } = fleet();
    const pool = new WellBakePool({ maxWorkers: 2, createWorker });
    const errs: string[] = [];
    pool.onError((id) => errs.push(id));
    // A on worker0, B on worker1, C + D queued.
    const pA = pool.submit(spec('A', 'a'));
    pool.submit(spec('B', 'b'));
    pool.submit(spec('C', 'c'));
    pool.submit(spec('D', 'd'));
    expect(workers.length).toBe(2);
    workers[0].crash({ message: 'segfault' });    // worker0 dies mid-A
    await expect(pA).rejects.toThrow(/segfault/);
    expect(errs).toEqual(['A']);
    expect(workers[0].terminated).toBe(true);
    // The pump respawns a fresh worker for the queued C (and later D).
    expect(workers.length).toBeGreaterThan(2);
    // Sibling B (worker1) is untouched and still resolvable.
    expect(pool.stats.busy).toBeGreaterThanOrEqual(1);
  });
});
