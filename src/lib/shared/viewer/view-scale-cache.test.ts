import { describe, it, expect, beforeEach } from 'vitest';
import { parseViewScale, loadViewScale, saveViewScale, type ViewScale } from './view-scale-cache';

// A tiny in-memory localStorage so the round-trip is testable in Node.
function mockStorage() {
  const m = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  };
  return m;
}

const FULL: ViewScale = {
  xScale: 3.5, zScale: 0.4, autoDepth: true, warpAutoStrength: 0.6,
  warpBakeScale: { radial: 3.5, depth: 0.4 },
};

describe('view-scale-cache — parseViewScale (shape guard)', () => {
  it('accepts a well-formed blob', () => {
    expect(parseViewScale(FULL)).toEqual(FULL);
  });
  it('rejects null / non-object / missing core scales', () => {
    expect(parseViewScale(null)).toBeNull();
    expect(parseViewScale('x')).toBeNull();
    expect(parseViewScale({ zScale: 1 })).toBeNull();       // no xScale
    expect(parseViewScale({ xScale: NaN, zScale: 1 })).toBeNull();
  });
  it('coerces partial / bad fields to sane defaults', () => {
    const v = parseViewScale({ xScale: 2, zScale: 1 });
    expect(v).toEqual({ xScale: 2, zScale: 1, autoDepth: false, warpAutoStrength: 0.4, warpBakeScale: { radial: 1, depth: 1 } });
  });
  it('clamps strength to [0,1]', () => {
    expect(parseViewScale({ xScale: 1, zScale: 1, warpAutoStrength: 5 })!.warpAutoStrength).toBe(1);
    expect(parseViewScale({ xScale: 1, zScale: 1, warpAutoStrength: -2 })!.warpAutoStrength).toBe(0);
  });
});

describe('view-scale-cache — load / save round-trip', () => {
  beforeEach(() => mockStorage());
  it('saves per-id and loads it back', () => {
    saveViewScale('w2_completion_vert', FULL);
    expect(loadViewScale('w2_completion_vert')).toEqual(FULL);
    // a different id is independent / absent
    expect(loadViewScale('other')).toBeNull();
  });
  it('an empty id is a no-op (never throws)', () => {
    expect(() => saveViewScale('', FULL)).not.toThrow();
    expect(loadViewScale('')).toBeNull();
  });
  it('a corrupt stored value degrades to null', () => {
    (globalThis as any).localStorage.setItem('ge-viewscale:bad', '{not json');
    expect(loadViewScale('bad')).toBeNull();
  });
});
