import { describe, it, expect } from 'vitest';
import { buildRevolveMesh } from './revolve';
import { JOINT_PARTS } from './dp_joint';

/**
 * Pure guards for the dp_joint STACK (no WASM — the booleanUnion itself is verified
 * in-browser under cross-origin isolation, like every tf boolean). We assert the two
 * things the pure layer can prove: (1) each of the three Z-offset half-sections
 * (box/tube/pin) revolves to a WATERTIGHT genus-1 2-manifold (χ=0, a bored tube), and
 * (2) the three parts' Z-ranges are contiguous and OVERLAP (so the union welds cleanly
 * rather than kissing at a coplanar face) with their bores aligned into one channel.
 */

/** Count undirected edges over a flat [F*3] triangle index buffer. */
function edgeCounts(faces: ArrayLike<number>): Map<string, number> {
  const m = new Map<string, number>();
  const key = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  for (let f = 0; f < faces.length; f += 3) {
    const a = faces[f], b = faces[f + 1], c = faces[f + 2];
    for (const [x, y] of [[a, b], [b, c], [c, a]] as const) {
      m.set(key(x, y), (m.get(key(x, y)) ?? 0) + 1);
    }
  }
  return m;
}

function directedCounts(faces: ArrayLike<number>): Map<string, number> {
  const m = new Map<string, number>();
  for (let f = 0; f < faces.length; f += 3) {
    const a = faces[f], b = faces[f + 1], c = faces[f + 2];
    for (const [x, y] of [[a, b], [b, c], [c, a]] as const) {
      m.set(`${x}>${y}`, (m.get(`${x}>${y}`) ?? 0) + 1);
    }
  }
  return m;
}

function euler(points: Float32Array, faces: Int32Array): number {
  return points.length / 3 - edgeCounts(faces).size + faces.length / 3;
}

function assertClosedManifold(points: Float32Array, faces: Int32Array) {
  for (let f = 0; f < faces.length; f += 3) {
    const a = faces[f], b = faces[f + 1], c = faces[f + 2];
    expect(a !== b && b !== c && c !== a, `degenerate tri ${a},${b},${c}`).toBe(true);
  }
  for (const [edge, n] of edgeCounts(faces)) {
    expect(n, `edge ${edge} shared by ${n} faces`).toBe(2);
  }
  for (const [edge, n] of directedCounts(faces)) {
    expect(n, `directed edge ${edge} appears ${n}×`).toBe(1);
  }
}

/** [minZ, maxZ] of a half-section's z column. */
function zRange(profile: readonly (readonly [number, number])[]): [number, number] {
  const zs = profile.map((p) => p[1]);
  return [Math.min(...zs), Math.max(...zs)];
}

describe('dp_joint parts', () => {
  it('has the three expected stacked parts (box, tube, pin)', () => {
    expect(JOINT_PARTS.map((p) => p.name)).toEqual(['box', 'tube', 'pin']);
  });

  it('each Z-offset half-section revolves to a watertight genus-1 tube (χ=0)', () => {
    for (const { name, profile } of JOINT_PARTS) {
      const { points, faces } = buildRevolveMesh(profile, 64);
      assertClosedManifold(points, faces);
      // All three are BORED (min r > 0) → a hole through them → χ = 0.
      expect(euler(points, faces), `${name} euler`).toBe(0);
      // No point touches the axis (min r > 0), so V = P × segments.
      expect(points.length / 3, `${name} verts`).toBe(profile.length * 64);
    }
  });

  it('stacks box→tube→pin end-to-end with overlapping (not merely touching) junctions', () => {
    const [box, tube, pin] = JOINT_PARTS.map((p) => zRange(p.profile));
    // Box face is the top of the whole joint (min z = 0).
    expect(box[0]).toBe(0);
    // Monotone downhole order: box, then tube, then pin.
    expect(tube[0]).toBeGreaterThan(box[0]);
    expect(pin[0]).toBeGreaterThan(tube[0]);
    // Each part's top tucks INTO the part above (overlap > 0) so the union welds.
    expect(box[1] - tube[0]).toBeCloseTo(0.1, 6); // box bottom overlaps tube top
    expect(tube[1] - pin[0]).toBeCloseTo(0.1, 6); // tube bottom overlaps pin top
  });
});
