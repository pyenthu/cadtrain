import { describe, it, expect } from 'vitest';
import { planeAxes, applyPlaneLock, pointsBbox, gridFor } from './spline-view';
import type { Vec3 } from './spline-resample';

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
