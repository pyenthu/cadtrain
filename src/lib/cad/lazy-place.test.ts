/**
 * `autoPlace` keeps a list-returning geom fn's outputs as SEPARATE `_parts`, and
 * builds the single composed body only ON DEMAND.
 *
 * Why: `place()` is `M.compose`, and M.compose on OVERLAPPING bodies is a UNION —
 * the nested body is destroyed. A well is the pathological case (every element
 * sits inside the open hole), so eagerly composing 16 elements collapsed them to
 * the outer hole alone. These tests pin both halves: compose is a union (so we
 * must not do it for a well), and reading `_parts` never triggers it.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initManifold, cyl, mv, place } from './manifold-helpers';
import { buildPrimitiveGeom } from '$lib/server/primitive-loader';

beforeAll(async () => { await initManifold(); }, 120_000);

const tris = (m: any) => m.getMesh().triVerts.length / 3;
const noDeps: typeof fetch = (async () => { throw new Error('no deps expected'); }) as any;

describe('M.compose is a UNION on overlapping bodies', () => {
  it('a nested body is destroyed by compose — identical to .add()', () => {
    const big = cyl(10, 5);
    const small = cyl(10, 2); // strictly inside `big` (same z range, smaller r)
    const composed = place([big, small]);
    const unioned = big.add(small);
    expect(composed.volume()).toBeCloseTo(big.volume(), 3);   // small contributes nothing
    expect(composed.volume()).toBeCloseTo(unioned.volume(), 3);
    expect(tris(composed)).toBe(tris(unioned));
  });

  it('disjoint bodies are merely concatenated', () => {
    const a = cyl(10, 2);
    const b = mv(cyl(10, 2), [50, 0, 0]); // far apart in x
    const composed = place([a, b]);
    expect(composed.volume()).toBeCloseTo(a.volume() + b.volume(), 3);
    expect(tris(composed)).toBe(tris(a) + tris(b));
  });
});

describe('autoPlace: separate parts, lazy compose', () => {
  // Two nested cylinders — the shape that compose would collapse.
  const SRC = `
export const meta = { id: 'nested', name: 'nested', kind: 'asm', uses: [], params: {} };
export function nested() {
  const outer = cyl(10, 5);
  const inner = cyl(10, 2);
  return [outer, inner];
}`;

  it('exposes both bodies on _parts, and does NOT compose to get them', async () => {
    const fn = await buildPrimitiveGeom(SRC, 'nested', noDeps);
    const out: any = await fn({});
    expect(out.__isLazyPlace).toBe(true);
    expect(Array.isArray(out._parts)).toBe(true);
    expect(out._parts).toHaveLength(2);
    // The inner body SURVIVES — this is the whole point.
    expect(out._parts[1].volume()).toBeGreaterThan(0);
    expect(out._parts[1].volume()).toBeLessThan(out._parts[0].volume());
    // Nothing forced the union.
    expect(out.__composedOrNull).toBeNull();
  });

  it('composes on demand, once, and memoises', async () => {
    const fn = await buildPrimitiveGeom(SRC, 'nested', noDeps);
    const out: any = await fn({});
    expect(out.__composedOrNull).toBeNull();
    const t = tris(out);                        // forces
    expect(out.__composedOrNull).not.toBeNull();
    const before = out.__composedOrNull;
    expect(tris(out)).toBe(t);                  // second read reuses
    expect(out.__composedOrNull).toBe(before);
  });

  it('the composed body still behaves like a Manifold (parents can CSG a list dep)', async () => {
    const fn = await buildPrimitiveGeom(SRC, 'nested', noDeps);
    const out: any = await fn({});
    expect(typeof out.volume()).toBe('number');
    expect(typeof out.genus()).toBe('number');
    const shifted = out.translate([1, 0, 0]);   // a real Manifold op through the proxy
    expect(shifted.volume()).toBeCloseTo(out.volume(), 6);
  });

  it('a single-body return is NOT wrapped (byte-identical to before)', async () => {
    const one = `
export const meta = { id: 'one', name: 'one', kind: 'asm', uses: [], params: {} };
export function one() { return [cyl(10, 5)]; }`;
    const fn = await buildPrimitiveGeom(one, 'one', noDeps);
    const out: any = await fn({});
    expect(out.__isLazyPlace).toBeUndefined();
    expect(typeof out.getMesh).toBe('function');
  });
});
