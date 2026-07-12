/**
 * The decision half of the client-side fatal-trap guard (/plan #981).
 *
 * `bake-client.ts` touches `Worker` + `indexedDB`, so it cannot run headless —
 * but the tricky part is not the plumbing, it is deciding what to do with the
 * job whose worker just died. That is pure, and it is what these tests pin.
 */
import { describe, it, expect } from 'vitest';
import { planTrapRecovery, MAX_TRAP_RETRIES } from '$lib/engines/manifold/bake-client';

describe('planTrapRecovery', () => {
  it('retries a fresh job once — a clean worker is a clean Manifold module', () => {
    expect(planTrapRecovery(0, false)).toBe('retry');
  });

  it('rejects once the retry budget is spent — geometry that traps will trap again', () => {
    expect(planTrapRecovery(MAX_TRAP_RETRIES, false)).toBe('reject');
    expect(planTrapRecovery(MAX_TRAP_RETRIES + 5, false)).toBe('reject');
  });

  it('CANCELS instead of retrying when a newer job is already waiting', () => {
    // The hang this prevents: retrying assigns `waiting = job`, which would
    // overwrite the newer job — whose caller then awaits a promise nothing ever
    // settles. A superseded bake's result is wanted by nobody, so drop it.
    expect(planTrapRecovery(0, true)).toBe('cancel');
  });

  it('cancels a superseded job even when its retry budget is spent (never rejects a stale bake)', () => {
    expect(planTrapRecovery(MAX_TRAP_RETRIES, true)).toBe('cancel');
  });

  it('honours a custom budget', () => {
    expect(planTrapRecovery(1, false, 3)).toBe('retry');
    expect(planTrapRecovery(3, false, 3)).toBe('reject');
    expect(planTrapRecovery(0, false, 0)).toBe('reject'); // budget 0 = never retry
  });

  it('the default budget is one — enough to clear a poisoned module, not to loop', () => {
    expect(MAX_TRAP_RETRIES).toBe(1);
  });
});
