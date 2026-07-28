import { describe, it, expect } from 'vitest';
import { planeAxes, applyPlaneLock, pointsBbox, gridFor, snapCoord, snapVec3, parsePointsInput } from '$lib/graph/spline/spline-view';
import type { Vec3 } from '$lib/graph/spline/spline-resample';

describe('planeAxes', () => {
  it('maps each plane to its in-plane + locked axes', () => {
    expect(planeAxes('xy')).toEqual({ uAxis: 0, vAxis: 1, lockAxis: 2 });
    expect(planeAxes('xz')).toEqual({ uAxis: 0, vAxis: 2, lockAxis: 1 });
    expect(planeAxes('yz')).toEqual({ uAxis: 1, vAxis: 2, lockAxis: 0 });
    expect(planeAxes('free')).toBeNull();
  });
});

describe('applyPlaneLock', () => {
  const orig: Vec3 = [1, 2, 3];
  const hit: Vec3 = [9, 9, 9];
  it('keeps z (XY view), moves x/y', () => {
    expect(applyPlaneLock(orig, hit, 2)).toEqual([9, 9, 3]);
  });
  it('keeps y (XZ view), moves x/z', () => {
    expect(applyPlaneLock(orig, hit, 1)).toEqual([9, 2, 9]);
  });
  it('keeps x (YZ view), moves y/z', () => {
    expect(applyPlaneLock(orig, hit, 0)).toEqual([1, 9, 9]);
  });
  it('rounds in-plane coords to 3 dp', () => {
    expect(applyPlaneLock([0, 0, 5], [1.23456, 7.89123, 0], 2)).toEqual([1.235, 7.891, 5]);
  });
});

describe('pointsBbox', () => {
  it('returns a unit box for no points', () => {
    const b = pointsBbox([]);
    expect(b.center).toEqual([0, 0, 0]);
    expect(b.span).toBe(2);
  });
  it('computes center + max span', () => {
    const b = pointsBbox([[0, 0, 0], [10, 2, -4]]);
    expect(b.center).toEqual([5, 1, -2]);
    expect(b.span).toBe(10); // x span dominates
    expect(b.min).toEqual([0, 0, -4]);
    expect(b.max).toEqual([10, 2, 0]);
  });
});

describe('gridFor', () => {
  it('floors at a minimum size', () => {
    expect(gridFor(0).size).toBe(6);
  });
  it('pads + returns an even division count', () => {
    const g = gridFor(10);
    expect(g.size).toBe(15);
    expect(g.divisions % 2).toBe(0);
    expect(g.divisions).toBeLessThanOrEqual(40);
  });
});

describe('snapCoord / snapVec3', () => {
  it('rounds to the nearest multiple of step', () => {
    expect(snapCoord(1.2, 0.5)).toBe(1);
    expect(snapCoord(1.3, 0.5)).toBe(1.5);
    expect(snapCoord(-1.1, 0.5)).toBe(-1);
    expect(snapCoord(-1.3, 0.5)).toBe(-1.5);
    expect(snapCoord(7, 2)).toBe(8);
  });
  it('is a no-op (3 dp clean) for a non-positive / non-finite step', () => {
    expect(snapCoord(1.23456, 0)).toBe(1.235);
    expect(snapCoord(1.23456, -1)).toBe(1.235);
    expect(snapCoord(1.23456, NaN)).toBe(1.235);
  });
  it('snaps every axis of a Vec3', () => {
    expect(snapVec3([1.2, 2.7, -0.9], 0.5)).toEqual([1, 2.5, -1]);
  });
  it('keeps snapped values clean to 3 dp', () => {
    // 0.1-step snapping must not leak float noise (0.30000000000000004).
    expect(snapVec3([0.31, 0.29, 0.16], 0.1)).toEqual([0.3, 0.3, 0.2]);
  });
});

describe('parsePointsInput', () => {
  it('parses a JSON array-of-arrays (3D)', () => {
    expect(parsePointsInput('[[0,0,0],[3,1,2]]')).toEqual([[0, 0, 0], [3, 1, 2]]);
  });
  it('pads JSON 2D points to z=0', () => {
    expect(parsePointsInput('[[1,2],[3,4]]')).toEqual([[1, 2, 0], [3, 4, 0]]);
  });
  it('chunks a flat numeric JSON array by 3', () => {
    expect(parsePointsInput('[0,0,0,3,1,2]')).toEqual([[0, 0, 0], [3, 1, 2]]);
  });
  it('parses one point per line (whitespace or comma separated)', () => {
    expect(parsePointsInput('0 0 0\n3 1 2')).toEqual([[0, 0, 0], [3, 1, 2]]);
    expect(parsePointsInput('0,0,0\n3, 1, 2')).toEqual([[0, 0, 0], [3, 1, 2]]);
  });
  it('tolerates per-row brackets and blank lines', () => {
    expect(parsePointsInput('(0, 0, 0)\n\n[3 1 2]\n')).toEqual([[0, 0, 0], [3, 1, 2]]);
  });
  it('drops short / non-finite rows', () => {
    expect(parsePointsInput('0 0 0\nfoo\n5\n3 1 2')).toEqual([[0, 0, 0], [3, 1, 2]]);
  });
  it('returns [] for empty / garbage input', () => {
    expect(parsePointsInput('')).toEqual([]);
    expect(parsePointsInput('   ')).toEqual([]);
    expect(parsePointsInput('not points')).toEqual([]);
  });
});
