/**
 * well-bake-client.test — headless coverage of the /wells integration seam:
 * the element → job-spec mapping (id + complete geometry cache key), the survey
 * fingerprint, the reply → THREE.BufferGeometry deserialize, and the streaming
 * reconcile helper driven against a pool with an injected mock worker. (The
 * pure pool scheduling is covered in well-bake-pool.test.ts.)
 */
import { describe, it, expect } from 'vitest';
import {
  buildShellRequest, shellCacheKey, shellJobSpec, surveyFingerprint,
  shellReplyToGeometry, bakeWellShells, type ShellElement,
} from '../well-bake-client';
import { WellBakePool, type WorkerLike } from '../well-bake-pool';
import type { SurveyRequest } from '../well-bake-protocol';

const survey0: SurveyRequest = { profile: null, td: 1000 };
const surveyDev: SurveyRequest = { profile: [{ md: 0, dev: 0, az: 0 }, { md: 500, dev: 30, az: 45 }], td: 1000 };

function el(over: Partial<ShellElement> = {}): ShellElement {
  return {
    id: 'ch:0', form: 'tube', top: 0, bot: 100, innerR: 4, outerR: 5,
    color: [0.5, 0.5, 0.6], cutAxis: 'x', cutAzimuthDeg: 0, cutDeg: 180, ...over,
  };
}

// ── cache key completeness ────────────────────────────────────────────────────
describe('shellCacheKey — every geometry-affecting input is in the key', () => {
  const base = buildShellRequest(el(), survey0);
  const key = shellCacheKey(base);

  it('is stable for identical inputs', () => {
    expect(shellCacheKey(buildShellRequest(el(), survey0))).toBe(key);
  });

  it.each<[string, ShellElement]>([
    ['top', el({ top: 1 })],
    ['bot', el({ bot: 101 })],
    ['innerR', el({ innerR: 3 })],
    ['outerR', el({ outerR: 6 })],
    ['cutAxis', el({ cutAxis: 'y' })],
    ['cutAzimuthDeg', el({ cutAzimuthDeg: 90 })],
    ['cutDeg', el({ cutDeg: 90 })],
    ['color (baked into vertex colours)', el({ color: [0.1, 0.2, 0.3] })],
    ['cutColor', el({ cutColor: [0.8, 0.7, 0.5] })],
    ['cutVariance', el({ cutVariance: 0.2 })],
    ['form', el({ form: 'cylinder' })],
  ])('changes when %s changes', (_label, changed) => {
    expect(shellCacheKey(buildShellRequest(changed, survey0))).not.toBe(key);
  });

  it('changes when the SURVEY changes (busts warped meshes)', () => {
    expect(shellCacheKey(buildShellRequest(el(), surveyDev))).not.toBe(key);
  });

  it('surveyFingerprint distinguishes vertical vs deviated + td', () => {
    expect(surveyFingerprint(survey0)).not.toBe(surveyFingerprint(surveyDev));
    expect(surveyFingerprint({ profile: null, td: 1000 })).not.toBe(surveyFingerprint({ profile: null, td: 2000 }));
    expect(surveyFingerprint(survey0)).toBe(surveyFingerprint({ profile: null, td: 1000 }));
  });
});

describe('shellJobSpec — id + key + payload', () => {
  it('carries the stable element id and the shell request as payload', () => {
    const s = shellJobSpec(el({ id: 'oh:2' }), survey0);
    expect(s.id).toBe('oh:2');
    expect(s.key).toBe(shellCacheKey(buildShellRequest(el({ id: 'oh:2' }), survey0)));
    expect(s.payload).toMatchObject({ type: 'shell', form: 'tube', innerR: 4, outerR: 5, survey: survey0 });
  });

  it('omits absent optional fields from the request', () => {
    const req = buildShellRequest(el(), survey0);
    expect('center' in req).toBe(false);
    expect('radius' in req).toBe(false);
    expect('cutColor' in req).toBe(false);
  });

  it('includes sphere center/radius when present', () => {
    const req = buildShellRequest(el({ form: 'sphere', center: [1, 2, 3], radius: 9 }), survey0);
    expect(req).toMatchObject({ form: 'sphere', center: [1, 2, 3], radius: 9 });
  });
});

// ── reply → THREE ─────────────────────────────────────────────────────────────
describe('shellReplyToGeometry', () => {
  it('rehydrates a WellShellResult into a coloured BufferGeometry', () => {
    const data = { geo: { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], colors: [1, 0, 0, 1, 0, 0, 1, 0, 0] }, tris: 1 };
    const geo = shellReplyToGeometry({ id: 'x', key: 'k', data });
    expect(geo.getAttribute('position').count).toBe(3);
    expect(geo.getAttribute('color').count).toBe(3);
    expect(geo.getAttribute('normal')).toBeTruthy(); // recomputed (none supplied)
  });
});

// ── streaming reconcile through a real pool + mock worker ─────────────────────
class EchoWorker implements WorkerLike {
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessageerror: ((ev: unknown) => void) | null = null;
  postMessage(msg: unknown): void {
    const { jobId } = msg as { jobId: number };
    // Reply on a microtask with a canned 1-triangle mesh so the pool + client
    // deserialize path runs end-to-end.
    queueMicrotask(() => this.onmessage?.({
      data: { jobId, ok: true, data: { geo: { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], colors: [0, 1, 0, 0, 1, 0, 0, 1, 0] }, tris: 1 } },
    }));
  }
  terminate(): void {}
}

describe('bakeWellShells — streaming + keep-all', () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('streams one BufferGeometry per element', async () => {
    const pool = new WellBakePool({ maxWorkers: 4, createWorker: () => new EchoWorker() });
    const got = new Map<string, boolean>();
    bakeWellShells(pool, [
      shellJobSpec(el({ id: 'oh:0', form: 'cylinder' }), survey0),
      shellJobSpec(el({ id: 'ch:0' }), survey0),
      shellJobSpec(el({ id: 'cem:0' }), survey0),
    ], (id, geo) => { got.set(id, geo.getAttribute('position').count === 3); });
    await flush();
    expect([...got.keys()].sort()).toEqual(['cem:0', 'ch:0', 'oh:0']);
    expect([...got.values()].every(Boolean)).toBe(true);
    pool.dispose();
  });

  it('re-bakes only the changed element on a second reconcile (keep-all)', async () => {
    let dispatches = 0;
    const pool = new WellBakePool({
      maxWorkers: 4,
      createWorker: () => {
        const w = new EchoWorker();
        const post = w.postMessage.bind(w);
        w.postMessage = (m: unknown) => { dispatches++; post(m); };
        return w;
      },
    });
    const results: string[] = [];
    const specs1 = [shellJobSpec(el({ id: 'a' }), survey0), shellJobSpec(el({ id: 'b' }), survey0)];
    bakeWellShells(pool, specs1, (id) => results.push(id));
    await flush();
    expect(dispatches).toBe(2);

    // b's geometry changes (outerR), a unchanged.
    const specs2 = [shellJobSpec(el({ id: 'a' }), survey0), shellJobSpec(el({ id: 'b', outerR: 9 }), survey0)];
    pool.reconcile(specs2);
    await flush();
    expect(dispatches).toBe(3);                 // only b re-dispatched
    expect(results.filter((r) => r === 'a')).toHaveLength(1); // a NOT re-emitted
    pool.dispose();
  });
});
