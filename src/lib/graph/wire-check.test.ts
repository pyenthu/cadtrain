/**
 * wire-check.test.ts — structural wire-checking for the graph editor (Phase B).
 *
 * Covers the consumer slot table (r_sweep.path → list<point3>, .section →
 * list<point2>), the polygon points expectation, and the end-to-end verdict:
 * an expr instance whose def-output formula produces list<point3> FEEDS the path
 * slot; a list<point2> output is REJECTED on the path slot with a plain-language
 * reason; unknown / un-modelled cases are allowed (conservative).
 */
import { describe, it, expect } from 'vitest';
import {
  slotExpectedType,
  inferGraphOutputStruct,
  checkOutputFeeds,
  POLYGON_POINTS,
} from './wire-check';
import { listOfPoints } from './struct-type';
import type { Graph } from './composition-graph-types';

/** A minimal graph holding ONE expr instance + def with a single named output. */
function graphWithOutput(formula: string, shape?: 'list' | 'auto'): Graph {
  return {
    nodes: { n1: { id: 'n1', type: 'expr', defId: 'd1' } },
    exprDefs: [
      { id: 'd1', name: 'D', params: [], consts: [], vars: [], outputs: [{ name: 'out', formula, shape }] },
    ],
  } as unknown as Graph;
}

describe('slotExpectedType — consumer table', () => {
  it('r_sweep.path expects a list of 3D points', () => {
    expect(slotExpectedType('r_sweep', 'path')).toEqual(listOfPoints(3));
  });
  it('r_sweep.section expects a list of 2D points', () => {
    expect(slotExpectedType('r_sweep', 'section')).toEqual(listOfPoints(2));
  });
  it('an unmodelled (engine, key) returns null → allow', () => {
    expect(slotExpectedType('r_sweep', 'caps')).toBeNull();
    expect(slotExpectedType('r_revolve', 'profile')).toBeNull();
  });
});

describe('inferGraphOutputStruct — resolve an instance output formula', () => {
  it('infers list<point3> from a literal output formula', () => {
    const s = inferGraphOutputStruct(graphWithOutput('[[0,0,0],[1,1,1]]'), 'n1', 'out');
    expect(s).toEqual({ kind: 'list', of: { kind: 'list', of: { kind: 'scalar' }, len: 3 }, len: 2 });
  });
  it('returns null for a missing node / output', () => {
    expect(inferGraphOutputStruct(graphWithOutput('5'), 'nope', 'out')).toBeNull();
    expect(inferGraphOutputStruct(graphWithOutput('5'), 'n1', 'ghost')).toBeNull();
  });
});

describe('checkOutputFeeds — the editor verdict', () => {
  it('a list<point3> output FEEDS r_sweep.path', () => {
    const g = graphWithOutput('[[0,0,0],[1,1,1]]');
    expect(checkOutputFeeds(g, 'n1', 'out', slotExpectedType('r_sweep', 'path'))).toEqual({
      ok: true, reason: null,
    });
  });

  it('a list<point2> output is REJECTED on r_sweep.path with a plain reason', () => {
    const g = graphWithOutput('[[0,0],[1,1]]');
    const r = checkOutputFeeds(g, 'n1', 'out', slotExpectedType('r_sweep', 'path'));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe(
      'this needs a list of 3D points like [x, y, z], but the output is a list of 2D points like [x, y]',
    );
  });

  it('a list<point2> output FEEDS the polygon points slot', () => {
    const g = graphWithOutput('[[0,0],[1,1]]');
    expect(checkOutputFeeds(g, 'n1', 'out', POLYGON_POINTS)).toEqual({ ok: true, reason: null });
  });

  it('a list<point3> output is REJECTED on the polygon points (2D) slot', () => {
    const g = graphWithOutput('[[0,0,0],[1,1,1]]');
    const r = checkOutputFeeds(g, 'n1', 'out', POLYGON_POINTS);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/needs a list of 2D points/);
  });

  it('a scalar output is REJECTED on r_sweep.path', () => {
    const g = graphWithOutput('5');
    const r = checkOutputFeeds(g, 'n1', 'out', slotExpectedType('r_sweep', 'path'));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/but the output is a single number/);
  });

  it('an empty-formula output is ALLOWED (unknown ⇒ no over-block)', () => {
    const g = graphWithOutput('');
    expect(checkOutputFeeds(g, 'n1', 'out', slotExpectedType('r_sweep', 'path'))).toEqual({
      ok: true, reason: null,
    });
  });

  it('a null expectation (unmodelled slot) is always allowed', () => {
    const g = graphWithOutput('5');
    expect(checkOutputFeeds(g, 'n1', 'out', null)).toEqual({ ok: true, reason: null });
  });
});
