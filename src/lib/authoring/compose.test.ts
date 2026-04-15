/**
 * Unit tests for the composition interpreter.
 *
 * These tests mock the ManifoldCAD builder module so they can run in a
 * pure Node (vitest) environment without loading the WASM. The real
 * integration with ManifoldCAD is exercised by the browser at runtime
 * via the /author page.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock BEFORE importing compose so the mocked module wins.
vi.mock('$lib/components/builder', () => {
  const finalizeMock = vi.fn((m: any, _maxOD: number) => ({
    full: 'FULL_GEO',
    cutVC: 'CUTVC_GEO',
    manifold: m,
  }));
  return {
    initManifold: vi.fn(async () => {}),
    buildPrimitiveManifold: vi.fn((id: string, params: Record<string, number>) =>
      makeFakeManifold({ prim: id, params })
    ),
    finalizeManifold: finalizeMock,
  };
});

import { buildAuthored } from './compose';
import {
  buildPrimitiveManifold,
  finalizeManifold,
} from '$lib/components/builder';
import type { AuthoredComponent } from './schema';

/**
 * A fake manifold that records every op applied to it so tests can
 * inspect the composition graph without running real geometry.
 */
function makeFakeManifold(tag: any): any {
  const m = {
    tag,
    ops: [] as any[],
    translate(v: number[]) {
      return makeFakeManifold({ ...this.tag, t: v });
    },
    rotate(v: number[]) {
      return makeFakeManifold({ ...this.tag, r: v });
    },
    add(other: any) {
      return makeFakeManifold({ op: 'union', a: this.tag, b: other.tag });
    },
    subtract(other: any) {
      return makeFakeManifold({ op: 'subtract', a: this.tag, b: other.tag });
    },
    intersect(other: any) {
      return makeFakeManifold({ op: 'intersect', a: this.tag, b: other.tag });
    },
  };
  return m;
}

function spec(overrides: Partial<AuthoredComponent> = {}): AuthoredComponent {
  return {
    id: 'test',
    name: 'Test',
    description: '',
    tags: [],
    version: 1,
    created: new Date().toISOString(),
    source: 'manual',
    parts: [],
    ops: [],
    ...overrides,
  };
}

describe('buildAuthored', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws on empty parts', async () => {
    await expect(buildAuthored(spec())).rejects.toThrow(/no parts/i);
  });

  it('single part, no ops → finalizes that part', async () => {
    const s = spec({
      parts: [{ id: 'p0', prim: 'hollow_cylinder', params: { od: 2.5, wall: 0.3, length: 4 } }],
    });
    const result = await buildAuthored(s);
    expect(buildPrimitiveManifold).toHaveBeenCalledWith('hollow_cylinder', { od: 2.5, wall: 0.3, length: 4 });
    expect(finalizeManifold).toHaveBeenCalledTimes(1);
    expect(result.full).toBe('FULL_GEO');
  });

  it('two parts with no ops → unions them implicitly', async () => {
    const s = spec({
      parts: [
        { id: 'p0', prim: 'hollow_cylinder', params: { od: 3, wall: 0.3, length: 5 } },
        { id: 'p1', prim: 'grooved_cylinder', params: { od: 3, wall: 0.3, length: 2 } },
      ],
    });
    await buildAuthored(s);
    // The last finalizeManifold call should have received a manifold
    // whose tag indicates a union of the two parts.
    const calls = (finalizeManifold as any).mock.calls;
    const finalManifold = calls[0][0];
    expect(finalManifold.tag.op).toBe('union');
  });

  it('applies CSG ops in declared order', async () => {
    const s = spec({
      parts: [
        { id: 'p0', prim: 'hollow_cylinder', params: { od: 4, wall: 0.3, length: 8 } },
        { id: 'p1', prim: 'hollow_cylinder', params: { od: 2, wall: 0.3, length: 8 } },
      ],
      ops: [{ op: 'subtract', inputs: ['p0', 'p1'], out: 'hollow' }],
    });
    await buildAuthored(s);
    const finalManifold = (finalizeManifold as any).mock.calls[0][0];
    expect(finalManifold.tag.op).toBe('subtract');
    expect(finalManifold.tag.a.prim).toBe('hollow_cylinder');
    expect(finalManifold.tag.b.prim).toBe('hollow_cylinder');
  });

  it('chains ops that reference earlier op outputs', async () => {
    const s = spec({
      parts: [
        { id: 'p0', prim: 'hollow_cylinder', params: { od: 4, wall: 0.3, length: 8 } },
        { id: 'p1', prim: 'hollow_cylinder', params: { od: 2, wall: 0.3, length: 8 } },
        { id: 'p2', prim: 'hollow_cylinder', params: { od: 1, wall: 0.1, length: 8 } },
      ],
      ops: [
        { op: 'subtract', inputs: ['p0', 'p1'], out: 'step1' },
        { op: 'subtract', inputs: ['step1', 'p2'], out: 'step2' },
      ],
    });
    await buildAuthored(s);
    const finalManifold = (finalizeManifold as any).mock.calls[0][0];
    expect(finalManifold.tag.op).toBe('subtract');
    // The outer subtract's `a` side should be the inner subtract.
    expect(finalManifold.tag.a.op).toBe('subtract');
  });

  it('throws on unknown input id in an op', async () => {
    const s = spec({
      parts: [{ id: 'p0', prim: 'hollow_cylinder', params: {} }],
      ops: [{ op: 'union', inputs: ['p0', 'ghost'], out: 'bad' }],
    });
    await expect(buildAuthored(s)).rejects.toThrow(/unknown input id: ghost/);
  });

  it('throws on duplicate part id', async () => {
    const s = spec({
      parts: [
        { id: 'p0', prim: 'hollow_cylinder', params: {} },
        { id: 'p0', prim: 'grooved_cylinder', params: {} },
      ],
    });
    await expect(buildAuthored(s)).rejects.toThrow(/duplicate part id: p0/i);
  });

  it('throws on op with fewer than 2 inputs', async () => {
    const s = spec({
      parts: [{ id: 'p0', prim: 'hollow_cylinder', params: {} }],
      ops: [{ op: 'union', inputs: ['p0'], out: 'bad' }],
    });
    await expect(buildAuthored(s)).rejects.toThrow(/needs at least 2 inputs/);
  });

  it('applies transform (translate + rotate) before CSG', async () => {
    const s = spec({
      parts: [
        { id: 'p0', prim: 'hollow_cylinder', params: { od: 3 }, transform: { tz: 5, rz: 1.57 } },
      ],
    });
    await buildAuthored(s);
    const finalManifold = (finalizeManifold as any).mock.calls[0][0];
    // The final manifold should carry both the rotate and translate tags.
    expect(finalManifold.tag.t).toEqual([0, 0, 5]);
    expect(finalManifold.tag.r).toEqual([0, 0, 1.57]);
  });
});
