import { describe, it, expect } from 'vitest';
import { tfExamples, getTfExample } from './index';

/**
 * Guards the tf_examples REGISTRY: the auto-glob must list every demo file (and
 * ONLY demo files — the revolve helper + this test module are filtered out), in
 * the deterministic `ORDER`, and `getTfExample` must resolve each name to a
 * builder. No WASM loads — building the list never calls a builder's `build()`.
 */
describe('tf_examples registry', () => {
  const EXPECTED = ['box', 'r_cyl', 's_cyl', 'helix', 'bored_pipe', 'dp_pin', 'cone'];

  it('lists all example demos (and nothing else) in deterministic order', () => {
    expect(tfExamples.map((e) => e.name)).toEqual(EXPECTED);
  });

  it('gives every example a non-empty human label', () => {
    for (const e of tfExamples) {
      expect(typeof e.label).toBe('string');
      expect(e.label.length).toBeGreaterThan(0);
    }
  });

  it('getTfExample resolves each name → a builder with a build() fn', () => {
    for (const name of EXPECTED) {
      const ex = getTfExample(name);
      expect(ex, `getTfExample(${name})`).toBeTruthy();
      expect(ex!.name).toBe(name);
      expect(typeof ex!.build).toBe('function');
      expect(ex!.cuttable).toBe(true); // all current demos are closed solids
    }
  });

  it('returns undefined for an unknown name', () => {
    expect(getTfExample('does_not_exist')).toBeUndefined();
  });
});
