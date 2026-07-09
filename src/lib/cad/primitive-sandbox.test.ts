/**
 * primitive-sandbox.test.ts — the NAMES/VALUES positional contract.
 *
 * `new Function(...SANDBOX_ARG_NAMES, body)(...sandboxArgValues())` binds by
 * POSITION, so the two lists must stay index-aligned. A one-slot drift does not
 * throw — it silently binds the wrong function to every primitive's helper name
 * (e.g. `sectionCut` would become `resolveProfile`), and the failure surfaces
 * later as garbage geometry. Adding a helper is a two-line edit across both
 * lists, which is exactly the kind of edit that drifts.
 */
import { describe, it, expect } from 'vitest';
import { SANDBOX_ARG_NAMES, sandboxArgValues } from './primitive-sandbox';

describe('primitive sandbox — NAMES/VALUES index alignment', () => {
  it('the two lists are the same length', () => {
    expect(sandboxArgValues().length).toBe(SANDBOX_ARG_NAMES.length);
  });

  it('every injected name is unique (a dupe silently shadows the earlier slot)', () => {
    const dupes = SANDBOX_ARG_NAMES.filter((n, i) => SANDBOX_ARG_NAMES.indexOf(n) !== i);
    expect(dupes).toEqual([]);
  });

  it('no injected value is undefined (a bad import lands as a silent undefined)', () => {
    const vals = sandboxArgValues();
    const missing = SANDBOX_ARG_NAMES.filter((_, i) => vals[i] === undefined);
    expect(missing).toEqual([]);
  });

  it('the named helpers land on the values they claim', () => {
    const vals = sandboxArgValues();
    for (const n of ['sectionCut', 'revolveProfile', 'weldAndBuild', 'resolveProfile']) {
      const i = SANDBOX_ARG_NAMES.indexOf(n);
      expect(i, `${n} must be injected`).toBeGreaterThanOrEqual(0);
      expect(typeof vals[i], `${n} must be a function`).toBe('function');
    }
  });

  it('a sandboxed body can call an injected helper by bare name', () => {
    // Exactly how primitive-loader evaluates a part/engine source.
    const fn = new Function(...SANDBOX_ARG_NAMES, 'return typeof sectionCut;');
    expect(fn(...sandboxArgValues())).toBe('function');
  });
});
