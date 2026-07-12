import { describe, it, expect } from 'vitest';
import { parseLoops, serializeLoops } from '../expr-loops';

const SPIRAL = [
  'outer(i) = [(r0 + growth*i/NPts)*cos(i*turns*tau/NPts), (r0 + growth*i/NPts)*sin(i*turns*tau/NPts)]',
  'inner(j) = [(r0 + growth*(NPts-1-j)/NPts - width)*cos((NPts-1-j)*turns*tau/NPts), (r0 + growth*(NPts-1-j)/NPts - width)*sin((NPts-1-j)*turns*tau/NPts)]',
  'return concat(map(range(0, NPts), outer), map(range(0, NPts), inner))',
].join('\n');

describe('expr-loops parse/serialize', () => {
  it('parses the multi-line named-helper spiral into 2 loops with var/range/body', () => {
    const f = parseLoops(SPIRAL);
    expect(f).not.toBeNull();
    expect(f!.loops).toHaveLength(2);
    expect(f!.loops[0]!.varName).toBe('i');
    expect(f!.loops[1]!.varName).toBe('j');
    expect(f!.loops[0]!.start).toBe('0');
    expect(f!.loops[0]!.stop).toBe('NPts');
    expect(f!.loops[0]!.body).toContain('cos');
    // inner edge counts backward (NPts-1-j); mathjs toString spaces it out
    expect(f!.loops[1]!.body.replace(/\s/g, '')).toContain('NPts-1-j');
  });

  it('parses a single inline map(range, f(i)=…)', () => {
    const f = parseLoops('map(range(0, 8), f(i) = [cos(i), sin(i)])');
    expect(f).not.toBeNull();
    expect(f!.loops).toHaveLength(1);
    expect(f!.loops[0]).toMatchObject({ varName: 'i', start: '0', stop: '8' });
  });

  it('parses range(stop) single-arg as start 0', () => {
    const f = parseLoops('map(range(N), f(i) = [i, 0])');
    expect(f!.loops[0]).toMatchObject({ start: '0', stop: 'N' });
  });

  it('round-trips: serialize(parse(x)) re-parses to the same loop count + vars + range', () => {
    const a = parseLoops(SPIRAL)!;
    const round = serializeLoops(a);
    const b = parseLoops(round);
    expect(b).not.toBeNull();
    expect(b!.loops.map((l) => [l.varName, l.start, l.stop]))
      .toEqual(a.loops.map((l) => [l.varName, l.start, l.stop]));
  });

  it('returns null for a non-loop formula (editor falls back to text)', () => {
    expect(parseLoops('diff > 0 ? diff : 0')).toBeNull();
    expect(parseLoops('[1, 2, 3]')).toBeNull();
    expect(parseLoops('')).toBeNull();
  });

  it('serializes one loop inline, many loops as named-helpers + concat', () => {
    expect(serializeLoops({ loops: [{ varName: 'i', start: '0', stop: 'N', body: '[i, 0]' }] }))
      .toBe('map(range(0, N), f(i) = [i, 0])');
    const two = serializeLoops({ loops: [
      { varName: 'i', start: '0', stop: 'N', body: '[i, 0]' },
      { varName: 'j', start: '0', stop: 'N', body: '[0, j]' },
    ] });
    expect(two).toContain('loop0(i) = [i, 0]');
    expect(two).toContain('return concat(map(range(0, N), loop0), map(range(0, N), loop1))');
  });
});
