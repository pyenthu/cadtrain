import { describe, it, expect } from 'vitest';
import { clampBox } from './popover-clamp';

// Viewport used across cases.
const VW = 1000;
const VH = 800;

describe('clampBox', () => {
  it('leaves an in-bounds position untouched', () => {
    expect(clampBox(100, 100, 200, 150, VW, VH)).toEqual({ x: 100, y: 100 });
  });

  it('pulls a box back from the right/bottom edge by its full size + margin', () => {
    // x=950 with a 200-wide box would spill to 1150; clamp to 1000-200-8 = 792.
    // y=780 with a 150-tall box would spill to 930; clamp to 800-150-8 = 642.
    expect(clampBox(950, 780, 200, 150, VW, VH)).toEqual({ x: 792, y: 642 });
  });

  it('pins the near edge to the margin when dragged past top/left', () => {
    expect(clampBox(-50, -30, 200, 150, VW, VH)).toEqual({ x: 8, y: 8 });
  });

  it('respects a custom margin', () => {
    expect(clampBox(-50, 900, 200, 150, VW, VH, 20)).toEqual({ x: 20, y: 630 });
  });

  it('pins a box larger than the viewport to the near edge (margin)', () => {
    // A 1200-wide box can never fit; keep its left edge (the grab strip) reachable.
    expect(clampBox(500, 500, 1200, 900, VW, VH)).toEqual({ x: 8, y: 8 });
  });

  it('clamps exactly to the far edge when the box just fits', () => {
    // maxX = 1000 - 200 - 8 = 792; a large x snaps there.
    expect(clampBox(10_000, 10_000, 200, 150, VW, VH).x).toBe(792);
  });
});
