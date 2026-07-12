import { describe, it, expect } from 'vitest';
import { sumBakeTimings, bakeBadgeTotals, type ClientBakeMeta } from '../bake-badge';

// ─────────────────────────────────────────────────────────────────────────
// Pins the timing math behind the MF_CLIENT bake badge (#987). The badge used
// to sum an EMPTY set (it excluded /compile's only field, `fetch_total`) and so
// printed "fresh · 0 ms" for a multi-second bake. These tests lock in that the
// real per-phase worker timings sum correctly and that cached vs fresh derive
// the right numbers — the exact seam that regressed, tested without a browser.
// ─────────────────────────────────────────────────────────────────────────

describe('sumBakeTimings', () => {
  it('sums all five phases', () => {
    expect(sumBakeTimings({ build: 10, mesh: 20, cutaway: 5, finalize: 3, serialize: 2 })).toBe(40);
  });

  it('is NOT zero for a real multi-second bake (the #987 regression)', () => {
    // The whole bug was a real bake reading 0. A populated phase set must sum > 0.
    const phases = { build: 4200, mesh: 900, cutaway: 700, finalize: 150, serialize: 80 };
    expect(sumBakeTimings(phases)).toBe(6030);
    expect(sumBakeTimings(phases)).toBeGreaterThan(0);
  });

  it('treats any missing phase as 0', () => {
    expect(sumBakeTimings({ build: 12 })).toBe(12);
    expect(sumBakeTimings({ mesh: 7, serialize: 3 })).toBe(10);
  });

  it('returns 0 for undefined / null / empty phases (a cache hit has none)', () => {
    expect(sumBakeTimings(undefined)).toBe(0);
    expect(sumBakeTimings(null)).toBe(0);
    expect(sumBakeTimings({})).toBe(0);
  });
});

describe('bakeBadgeTotals', () => {
  it('fresh bake: compile + wall bake shown separately, plus the phase sum', () => {
    const meta: ClientBakeMeta = {
      cached: false,
      compileMs: 120,
      bakeMs: 6400,
      phases: { build: 4200, mesh: 900, cutaway: 700, finalize: 150, serialize: 80 },
    };
    expect(bakeBadgeTotals(meta)).toEqual({
      cached: false,
      compileMs: 120,
      bakeMs: 6400,
      phaseSum: 6030,
    });
  });

  it('phaseSum never exceeds the wall bakeMs (transfer + decode are outside the phases)', () => {
    const meta: ClientBakeMeta = {
      cached: false,
      compileMs: 50,
      bakeMs: 6400,
      phases: { build: 4200, mesh: 900, cutaway: 700, finalize: 150, serialize: 80 },
    };
    const t = bakeBadgeTotals(meta);
    expect(t.phaseSum).toBeLessThanOrEqual(t.bakeMs);
  });

  it('cache hit: compile forced to 0, no phases → phaseSum 0, bakeMs (decode+paint) kept', () => {
    const meta: ClientBakeMeta = { cached: true, compileMs: 120, bakeMs: 8 };
    expect(bakeBadgeTotals(meta)).toEqual({
      cached: true,
      compileMs: 0,
      bakeMs: 8,
      phaseSum: 0,
    });
  });
});
