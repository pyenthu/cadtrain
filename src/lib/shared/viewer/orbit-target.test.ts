import { describe, it, expect } from 'vitest';
import { computeOrbitTarget } from './orbit-target';

describe('computeOrbitTarget', () => {
  it('pins x and y to the vertical (drilling) axis, whatever the bbox centre', () => {
    // A part whose geometry is off-axis in x AND y (e.g. a deviated well body).
    const t = computeOrbitTarget({ x: 5, y: -7, z: 120 });
    expect(t[0]).toBe(0); // on-axis x
    expect(t[1]).toBe(0); // on-axis y — the TODO #74 fix (was partCenter.y)
    expect(t[2]).toBe(120);
  });

  it('follows the part z-centre for a tall Z-down well', () => {
    // Z-down: deep part, z-centre well below the wellhead.
    expect(computeOrbitTarget({ x: 0, y: 0, z: 250 })).toEqual([0, 0, 250]);
  });

  it('keeps a short part centred near the origin', () => {
    expect(computeOrbitTarget({ x: 0, y: 0, z: 0.5 })).toEqual([0, 0, 0.5]);
  });

  it('adds the axial Z-pan (zFocus) onto the z-centre, staying on-axis', () => {
    // The vertical slider pans the look-at up/down the bore without re-aiming.
    expect(computeOrbitTarget({ x: 0, y: 3, z: 100 }, -30)).toEqual([0, 0, 70]);
    expect(computeOrbitTarget({ x: 0, y: 3, z: 100 }, 30)).toEqual([0, 0, 130]);
  });

  it('defaults zFocus to 0', () => {
    expect(computeOrbitTarget({ x: 0, y: 0, z: 42 })).toEqual([0, 0, 42]);
  });

  it('is robust to non-finite inputs (never emits NaN into the camera target)', () => {
    expect(computeOrbitTarget({ x: 0, y: 0, z: NaN as unknown as number })).toEqual([0, 0, 0]);
    expect(computeOrbitTarget({ x: 0, y: 0, z: 10 }, NaN as unknown as number)).toEqual([0, 0, 10]);
  });

  it('keeps the target ON-AXIS (x=y=0) at ANY zFocus and ANY off-axis part centre', () => {
    // The load-bearing invariant for a tall Z-down well: panning down the bore
    // (zFocus) or an off-axis bbox centre must NEVER move the look-at off the
    // drilling axis — otherwise the part drifts off-centre while orbiting (#74).
    // Sweep a grid of off-axis centres × pan depths and assert x=y=0 throughout,
    // with z tracking (centre.z + zFocus) exactly.
    for (const cx of [-9, 0, 4.2, 30]) {
      for (const cy of [-11, 0, 3, 55]) {
        for (const cz of [0, 0.5, 120, 2999.7]) {
          for (const zFocus of [-500, -30, 0, 30, 500]) {
            const t = computeOrbitTarget({ x: cx, y: cy, z: cz }, zFocus);
            expect(t[0]).toBe(0);
            expect(t[1]).toBe(0);
            expect(t[2]).toBeCloseTo(cz + zFocus, 10);
          }
        }
      }
    }
  });
});
