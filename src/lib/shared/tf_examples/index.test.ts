import { describe, it, expect } from 'vitest';
import { tfExamples, getTfExample } from './index';

/**
 * Guards the tf_examples REGISTRY: the auto-glob lists every demo file (and ONLY
 * demo files — the revolve helper + test modules are filtered out). The list is
 * AUTO-DERIVED, so this test is order-agnostic + doesn't need editing when a new
 * `tf_examples/<name>.ts` is added — it just checks the core demos are present,
 * the sort rule holds, and every listed name resolves. No WASM loads (no build()).
 */
describe('tf_examples registry', () => {
  // A FLOOR, not an exhaustive list — new parts are auto-picked-up and must NOT
  // require touching this test. These core demos must always be present.
  const CORE = ['box', 'r_cyl', 's_cyl', 'helix', 'bored_pipe', 'dp_pin', 'cone'];

  it('auto-lists at least the core demos (order-agnostic)', () => {
    const names = tfExamples.map((e) => e.name);
    for (const n of CORE) expect(names, `registry missing ${n}`).toContain(n);
    expect(new Set(names).size).toBe(names.length); // no duplicate names
  });

  it('is sorted by (order ?? end, then label)', () => {
    const full = tfExamples.map((e) => getTfExample(e.name)!);
    for (let i = 1; i < full.length; i++) {
      const a = full[i - 1], b = full[i];
      const oa = a.order ?? Number.MAX_SAFE_INTEGER, ob = b.order ?? Number.MAX_SAFE_INTEGER;
      const ok = oa < ob || (oa === ob && a.label.localeCompare(b.label) <= 0);
      expect(ok, `out of order: ${a.name} before ${b.name}`).toBe(true);
    }
  });

  it('gives every example a non-empty human label', () => {
    for (const e of tfExamples) {
      expect(typeof e.label).toBe('string');
      expect(e.label.length).toBeGreaterThan(0);
    }
  });

  it('getTfExample resolves every listed name → a builder with a build() fn', () => {
    for (const { name } of tfExamples) {
      const ex = getTfExample(name);
      expect(ex, `getTfExample(${name})`).toBeTruthy();
      expect(ex!.name).toBe(name);
      expect(typeof ex!.build).toBe('function');
    }
  });

  it('returns undefined for an unknown name', () => {
    expect(getTfExample('does_not_exist')).toBeUndefined();
  });
});
