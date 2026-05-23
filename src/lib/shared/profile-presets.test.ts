import { describe, it, expect } from 'vitest';
import { resolveProfile, PROFILE_REGISTRY, defaultsFor, type Pt } from './profile-presets';

// The original hardcoded ProfileEditor presets — the parametric registry must
// reproduce these byte-for-byte at default params so picking a kind matches the
// old preset buttons.
const ngon = (n: number, r = 0.5): Pt[] =>
  Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; return [r * Math.cos(a), r * Math.sin(a)] as Pt; });
const OLD: Record<string, Pt[]> = {
  rect: [[-0.5, -0.3], [0.5, -0.3], [0.5, 0.3], [-0.5, 0.3]],
  ellipse: ngon(24, 0.5),
  ngon: ngon(6, 0.5),
  l: [[0, 0], [0.6, 0], [0.6, 0.2], [0.2, 0.2], [0.2, 0.6], [0, 0.6]],
  t: [[-0.5, 0.3], [0.5, 0.3], [0.5, 0.1], [0.1, 0.1], [0.1, -0.5], [-0.1, -0.5], [-0.1, 0.1], [-0.5, 0.1]],
  plus: [[0.5, -0.15], [0.5, 0.15], [0.15, 0.15], [0.15, 0.5], [-0.15, 0.5], [-0.15, 0.15], [-0.5, 0.15], [-0.5, -0.15], [-0.15, -0.15], [-0.15, -0.5], [0.15, -0.5], [0.15, -0.15]],
  star: (() => { const N = 5, out: Pt[] = []; for (let i = 0; i < N * 2; i++) { const a = (i / (N * 2)) * Math.PI * 2 - Math.PI / 2; const r = i % 2 === 0 ? 0.5 : 0.2; out.push([r * Math.cos(a), r * Math.sin(a)]); } return out; })(),
  cylinder: [[0, 0], [1.2, 0], [1.2, 3], [0, 3]],
  tube: [[0.7, 0], [1.2, 0], [1.2, 3], [0.7, 3]],
  cone: [[0, 0], [1.4, 3], [0, 3]],
  barrel: [[0, 0], [1.0, 0], [1.4, 1.5], [1.0, 3], [0, 3]],
};

function expectClose(a: Pt[], b: Pt[]) {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) {
    expect(a[i][0]).toBeCloseTo(b[i][0], 9);
    expect(a[i][1]).toBeCloseTo(b[i][1], 9);
  }
}

describe('profile registry — defaults reproduce the legacy presets', () => {
  for (const [kind, pts] of Object.entries(OLD)) {
    it(`${kind} at default params`, () => {
      expectClose(resolveProfile({ kind, params: {} }), pts);
    });
  }
});

describe('resolveProfile descriptor union', () => {
  it('passes a legacy bare array through unchanged', () => {
    const arr: Pt[] = [[1, 2], [3, 4], [5, 6]];
    expect(resolveProfile(arr)).toBe(arr);
  });
  it('returns { points } directly (detached profile)', () => {
    const pts: Pt[] = [[0, 0], [1, 0], [0, 1]];
    expect(resolveProfile({ points: pts })).toBe(pts);
  });
  it('prefers points over _gen on a re-linkable detached profile', () => {
    const pts: Pt[] = [[0, 0], [2, 0], [1, 2]];
    expect(resolveProfile({ points: pts, _gen: { kind: 'rect', params: {} } })).toBe(pts);
  });
  it('merges partial params over defaults', () => {
    const out = resolveProfile({ kind: 'rect', params: { w: 2 } });
    // w overridden to 2, h stays at default 0.6
    expect(out).toEqual([[-1, -0.3], [1, -0.3], [1, 0.3], [-1, 0.3]]);
  });
  it('throws on an unknown kind', () => {
    expect(() => resolveProfile({ kind: 'nope', params: {} })).toThrow(/unknown profile kind/);
  });
});

describe('registry sanity', () => {
  it('every kind builds a ≥3-vertex polygon at defaults', () => {
    for (const def of Object.values(PROFILE_REGISTRY)) {
      const pts = def.build(defaultsFor(def));
      expect(pts.length).toBeGreaterThanOrEqual(3);
      for (const p of pts) { expect(Number.isFinite(p[0])).toBe(true); expect(Number.isFinite(p[1])).toBe(true); }
    }
  });
});
