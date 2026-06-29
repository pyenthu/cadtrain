/**
 * struct-type.test.ts — structural inference for expression outputs (Phase A).
 *
 * Covers the keystone: an array literal is recognised as `list<pointN>` for ANY
 * arity (2D / 3D), mixed-length rows are a plain-language error, scalars stay
 * scalar, and the `range`/`map`/`concat` list builders infer correctly.
 */
import { describe, it, expect } from 'vitest';
import { inferStructure, structLabel, type StructType } from './struct-type';

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
