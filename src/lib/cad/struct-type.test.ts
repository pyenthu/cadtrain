/**
 * struct-type.test.ts — structural inference for expression outputs (Phase A).
 *
 * Covers the keystone: an array literal is recognised as `list<pointN>` for ANY
 * arity (2D / 3D), mixed-length rows are a plain-language error, scalars stay
 * scalar, and the `range`/`map`/`concat` list builders infer correctly.
 */
import { describe, it, expect } from 'vitest';
import {
  inferStructure, structLabel, checkFeed,
  listOfPoints, T_SCALAR, T_LIST_POINT2, T_LIST_POINT3,
  type StructType,
} from './struct-type';

/** Convenience — infer + label in one shot (throws if inference errored). */
function label(formula: string): string {
  const { type, error } = inferStructure(formula);
  expect(error).toBeNull();
  return structLabel(type);
}

describe('inferStructure — array literals → list<pointN>', () => {
  it('a 3D point list → list<point3>', () => {
    const { type, error } = inferStructure('[[0,2,2],[2,0,1]]');
    expect(error).toBeNull();
    expect(type).toEqual<StructType>({
      kind: 'list', len: 2,
      of: { kind: 'list', len: 3, of: { kind: 'scalar' } },
    });
    expect(structLabel(type)).toBe('list<point3>');
  });

  it('a 2D point list → list<point2>', () => {
    expect(label('[[0,2],[2,0]]')).toBe('list<point2>');
  });

  it('a 4D point list → list<point4> (any arity)', () => {
    expect(label('[[0,0,0,0],[1,1,1,1]]')).toBe('list<point4>');
  });

  it('the canonical keystone literal bakes-shape to list<point3>', () => {
    expect(label('[[0,0,0],[2,0,1],[2,2,1]]')).toBe('list<point3>');
  });

  it('a flat number list → list<number>', () => {
    expect(label('[1, 2, 3, 4]')).toBe('list<number>');
  });

  it('mixed inner lengths → a plain-language error', () => {
    const { type, error } = inferStructure('[[0,2,2],[2,0]]');
    expect(type).toBeNull();
    expect(error).toBe('rows have mixed lengths: 3, 2');
  });
});

describe('inferStructure — scalars', () => {
  it('a bare number → scalar', () => {
    const { type, error } = inferStructure('5');
    expect(error).toBeNull();
    expect(type).toEqual<StructType>({ kind: 'scalar' });
    expect(structLabel(type)).toBe('number');
  });

  it('an arithmetic expression over symbols → scalar', () => {
    const { type } = inferStructure('(r0 + width) / 2');
    expect(type).toEqual<StructType>({ kind: 'scalar' });
  });

  it('a comparison → flag', () => {
    const { type } = inferStructure('diff > 0');
    expect(type).toEqual<StructType>({ kind: 'flag' });
  });

  it('a ternary infers its branch type (scalar)', () => {
    expect(label('diff > 0 ? diff : 0')).toBe('number');
  });
});

describe('inferStructure — list builders (range / map / concat)', () => {
  it('map(range(0,N), f(i)=[cos,sin,i]) → list<point3>', () => {
    expect(label('map(range(0, N), f(i) = [cos(i), sin(i), i])')).toBe('list<point3>');
  });

  it('map(range(0,N), f(i)=[r,z]) → list<point2>', () => {
    expect(label('map(range(0, N), f(i) = [r0 * cos(i), r0 * sin(i)])')).toBe('list<point2>');
  });

  it('range(stop) alone → list<number>', () => {
    expect(label('range(5)')).toBe('list<number>');
  });

  it('a constant range carries its length', () => {
    const { type } = inferStructure('range(0, 4)');
    expect(type).toEqual<StructType>({ kind: 'list', of: { kind: 'scalar' }, len: 4 });
  });

  it('concat of two point maps → list<point2>', () => {
    const f =
      'concat(' +
      'map(range(0, N), f(i) = [r0 * cos(i), r0 * sin(i)]), ' +
      'map(range(0, N), f(j) = [r0 * cos(j), r0 * sin(j)])' +
      ')';
    expect(label(f)).toBe('list<point2>');
  });
});

describe('inferStructure — robustness', () => {
  it('an empty formula has no structure (no error)', () => {
    expect(inferStructure('   ')).toEqual({ type: null, error: null });
  });

  it('a parse error surfaces as a plain-language error, never throws', () => {
    const { type, error } = inferStructure('[[1,2],');
    expect(type).toBeNull();
    expect(error).toMatch(/parse error/);
  });

  it('the `return` sugar is stripped before inference', () => {
    expect(label('return [[0,0,0],[1,1,1]]')).toBe('list<point3>');
  });
});

// ─── structural compatibility (Phase B) ───────────────────────────────────────

/** Infer a formula and check it against an expected slot structure. */
function feed(formula: string, expect_: StructType) {
  return checkFeed(inferStructure(formula).type, expect_);
}

describe('checkFeed — list<point3> path slot', () => {
  it('list<point3> output FEEDS a path slot', () => {
    expect(feed('[[0,2,2],[2,0,1]]', T_LIST_POINT3)).toEqual({ ok: true, reason: null });
  });

  it('a map producing point3 rows feeds a path slot', () => {
    const r = feed('map(range(0,4), f(i)=[cos(i),sin(i),i])', T_LIST_POINT3);
    expect(r.ok).toBe(true);
  });

  it('list<point2> is REJECTED on a path slot with a plain-language reason', () => {
    const r = feed('[[0,2],[2,0]]', T_LIST_POINT3);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe(
      'this needs a list of 3D points like [x, y, z], but the output is a list of 2D points like [x, y]',
    );
  });

  it('a flat list of numbers is REJECTED on a path slot', () => {
    const r = feed('[1, 2, 3]', T_LIST_POINT3);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe(
      'this needs a list of 3D points like [x, y, z], but the output is a list of plain numbers',
    );
  });

  it('a single number is REJECTED on a path slot', () => {
    const r = feed('5', T_LIST_POINT3);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe(
      'this needs a list of 3D points like [x, y, z], but the output is a single number',
    );
  });
});

describe('checkFeed — list<point2> section / polygon slot', () => {
  it('list<point2> FEEDS a section slot', () => {
    expect(feed('[[0,2],[2,0]]', T_LIST_POINT2)).toEqual({ ok: true, reason: null });
  });

  it('list<point3> is REJECTED on a 2D section slot', () => {
    const r = feed('[[0,2,2],[2,0,1]]', T_LIST_POINT2);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe(
      'this needs a list of 2D points like [x, y], but the output is a list of 3D points like [x, y, z]',
    );
  });

  it('an any-arity point list accepts both 2D and 3D', () => {
    expect(feed('[[0,2],[2,0]]', listOfPoints()).ok).toBe(true);
    expect(feed('[[0,2,2],[2,0,1]]', listOfPoints()).ok).toBe(true);
  });
});

describe('checkFeed — scalar slot + conservative allow', () => {
  it('a scalar feeds a scalar slot', () => {
    expect(feed('(r0 + width) / 2', T_SCALAR)).toEqual({ ok: true, reason: null });
  });
  it('a list is rejected on a scalar slot', () => {
    expect(feed('[[0,0],[1,1]]', T_SCALAR).ok).toBe(false);
  });
  it('an empty / null source is ALLOWED (never over-block)', () => {
    expect(checkFeed(null, T_LIST_POINT3)).toEqual({ ok: true, reason: null });
  });
  it('an unknown source is ALLOWED (never over-block)', () => {
    expect(checkFeed({ kind: 'unknown' }, T_LIST_POINT3)).toEqual({ ok: true, reason: null });
  });
});
