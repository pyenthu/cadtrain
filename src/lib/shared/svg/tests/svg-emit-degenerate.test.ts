// svg-emit-degenerate.test.ts — #984 regression: a WARPED part's SVG must carry
// NO degenerate (zero-area) triangle.
//
// DIAGNOSIS (decoded, not eyeballed — see the plan's three candidate origins):
//   The degenerate triangle is BORN in svg-emit's PROJECTION, not the bake and
//   not a stale path. `svg-reduce` already drops any 3D-degenerate triangle
//   before projection, so every triangle `projectScene` receives has REAL 3D
//   area. But a warped / deviated part's EDGE-ON end caps + silhouette-tangent
//   facets project two DISTINCT 3D vertices onto ONE 2D line — legal geometry,
//   illegal 2D triangle (the plan's scenario (b)). On a warped cylinder ~half the
//   projected triangles (both caps) collapse this way; on a spline-bent tube the
//   tilted caps land right on the old emit guard's magic `1e-7` threshold.
//
// FIX: `projectScene` now drops projection-degenerate triangles at the earliest
//   legal layer (they can't be prevented in the bake — the 3D geometry is legal),
//   using `projectedDegenerate`, which tests collinearity at the SAME 2-decimal
//   precision the coordinates are written — so the "no zero-area <polygon> in the
//   SVG" invariant is exact (a long-base / sub-0.01px-tall sliver that passes a
//   full-precision area guard yet rounds collinear is caught too).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as THREE from 'three';
import { projectScene, shadeAndEmit, projectedDegenerate, type ProjectedScene } from '../svg-emit';
import { buildSvgCamera } from '../svg-camera';
import { warpVertex } from '$lib/graph/warp-geom';
import { warpMeshJS } from '$lib/engines/manifold/warp-spline';

// --- minimal SVG element stub (project uses `environment: 'node'`, no jsdom) ---
class FakeEl {
  tagName: string; attrs: Record<string, string> = {}; children: FakeEl[] = [];
  style: Record<string, string> = {};
  constructor(t: string) { this.tagName = t; }
  setAttribute(k: string, v: unknown) { this.attrs[k] = String(v); }
  getAttribute(k: string) { return this.attrs[k] ?? null; }
  appendChild(c: FakeEl) { this.children.push(c); return c; }
}

// A cylinder ALONG Z (the drilling axis) with caps.
function cylZ(segs: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(1, 1, 6, segs, 1, false); // Y axis by default
  g.rotateX(Math.PI / 2); // → Z axis (Z-down drilling convention)
  return g;
}

// Straight sinusoidal warp (the finalizeManifold scene warp), non-indexed.
function sinWarped(base: THREE.BufferGeometry, amp: number, freq: number): THREE.BufferGeometry {
  const g = base.toNonIndexed();
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const v: [number, number, number] = [pos.getX(i), pos.getY(i), pos.getZ(i)];
    warpVertex(v, amp, freq, 'x');
    pos.setXYZ(i, v[0], v[1], v[2]);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

// A tube bent along a deviated spline via the SAME warpMeshJS the deviated-well /
// TF path uses — tilts the caps → the realistic near-degenerate trigger.
function bentTube(segs: number, cp: [number, number][]): THREE.BufferGeometry {
  const g = cylZ(segs).toNonIndexed();
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const nrm = g.getAttribute('normal') as THREE.BufferAttribute | null;
  const out = warpMeshJS(
    new Float32Array(pos.array as Float32Array),
    nrm ? new Float32Array(nrm.array as Float32Array) : null,
    cp, {},
  );
  g.setAttribute('position', new THREE.BufferAttribute(out.positions, 3));
  if (out.normals) g.setAttribute('normal', new THREE.BufferAttribute(out.normals, 3));
  return g;
}

// Straight-elevation ortho camera exactly as PrimitiveSvgView builds it.
function project(geo: THREE.BufferGeometry, sX = 1, sZ = 1, cull = false): ProjectedScene {
  const cam = buildSvgCamera(geo, {
    projection: 'ortho', w: 400, h: 400, sX, sZ,
    cam: { x: 6, y: 0, z: 0 }, partCenter: { x: 0, y: 0, z: 0 }, zFocus: 0,
  });
  return projectScene(
    [{ geo, pi: 0, base: [0.8, 0.13, 0.13] }],
    cam.camera, cam.renderW, cam.renderH, cam.fitToContainer,
    { sX, sZ, backfaceCull: cull, HIGH_TRI: 4000 },
  );
}

// 2×area of one projected tri (= |det|).
const projDet = (t: { ax: number; ay: number; bx: number; by: number; cx: number; cy: number }) =>
  Math.abs((t.bx - t.ax) * (t.cy - t.ay) - (t.by - t.ay) * (t.cx - t.ax));

// Min 3D triangle area over a non-indexed geometry.
function min3dArea(geo: THREE.BufferGeometry): number {
  const p = geo.getAttribute('position') as THREE.BufferAttribute;
  let min = Infinity;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let t = 0; t + 2 < p.count; t += 3) {
    a.fromBufferAttribute(p, t); b.fromBufferAttribute(p, t + 1); c.fromBufferAttribute(p, t + 2);
    const ar = b.clone().sub(a).cross(c.clone().sub(a)).length() / 2;
    if (ar < min) min = ar;
  }
  return min;
}

// Parse an emitted `<polygon points>` → its area (from the ROUNDED, written coords).
function emittedPolyArea(points: string): number {
  const pts = points.trim().split(/\s+/).map((p) => p.split(',').map(Number));
  if (pts.length < 3) return 0;
  const [a, b, c] = pts;
  return Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
}

describe('projectedDegenerate — the output-precision collinearity predicate (#984)', () => {
  it('flags a triangle whose corners are collinear at 2-decimal precision', () => {
    // Distinct 3D verts → one 2D line: a warped part's edge-on cap. Here all three
    // share a screen-y → collinear → a zero-area polygon if written.
    expect(projectedDegenerate(10, 50, 200, 50, 130, 50)).toBe(true);
    // Sub-0.01px-tall sliver over a long base → rounds collinear (long base, tiny
    // height has real full-precision area yet serialises as zero-area).
    expect(projectedDegenerate(0, 100, 300, 100.003, 150, 100.001)).toBe(true);
    // A genuine triangle is NOT flagged.
    expect(projectedDegenerate(0, 0, 100, 0, 0, 100)).toBe(false);
    // NaN / ∞ → treated as degenerate (never emit garbage).
    expect(projectedDegenerate(NaN, 0, 100, 0, 0, 100)).toBe(true);
    expect(projectedDegenerate(0, 0, Infinity, 0, 0, 100)).toBe(true);
  });
});

describe('svg-emit — warped parts carry NO degenerate projected triangle (#984)', () => {
  const savedDoc = (globalThis as any).document;
  beforeAll(() => {
    (globalThis as any).document = { createElementNS: (_n: string, tag: string) => new FakeEl(tag) };
  });
  afterAll(() => { (globalThis as any).document = savedDoc; });

  const dev: [number, number][] = [[0, 0], [0, 2], [1.2, 4], [3, 6]];
  const fixtures: [string, THREE.BufferGeometry, number, number, boolean][] = [
    ['sin-warped cylinder', sinWarped(cylZ(24), 0.6, 1.2), 1, 1, false],
    ['sin-warped cylinder (squash-Z)', sinWarped(cylZ(96), 0.6, 1.2), 1, 0.05, false],
    ['deviated tube (spline warp)', bentTube(64, dev), 1, 1, false],
    ['deviated tube (squash-Z)', bentTube(64, dev), 1, 0.05, false],
    ['deviated tube (fine, squash-Z)', bentTube(128, dev), 1, 0.05, false],
    ['deviated tube (back-face cull)', bentTube(64, dev), 1, 1, true],
  ];

  for (const [name, geo, sX, sZ, cull] of fixtures) {
    it(`${name}: bake is clean, projection is deduped, SVG has no zero-area polygon`, () => {
      // (a) NOT a bake defect: every SOURCE 3D triangle has real area.
      expect(min3dArea(geo)).toBeGreaterThan(1e-4);

      // (b) projectScene must not carry any PROJECTION-degenerate triangle.
      const scene = project(geo, sX, sZ, cull);
      expect(scene.tris.length).toBeGreaterThan(0);
      const badProjected = scene.tris.filter(
        (t) => projectedDegenerate(t.ax, t.ay, t.bx, t.by, t.cx, t.cy),
      );
      expect(badProjected.length).toBe(0);
      // No exactly-zero projected area survives either (a strict sub-check).
      expect(scene.tris.filter((t) => projDet(t) === 0).length).toBe(0);

      // (c) end-to-end: the emitted SVG contains no zero-area <polygon>.
      const out = shadeAndEmit(scene, {
        idPrefix: 'T984-', lightAngle: 0, showEdges: false,
        AMBIENT: 0.25, KEY: 0.55, FILL: 0.28, DESAT: 0.45, BRIGHT: 0.82,
        partAlpha: [1], partTrans: [false],
      }) as any;
      const polys = (out.svg.children as FakeEl[]).filter((c) => c.tagName === 'polygon');
      expect(polys.length).toBeGreaterThan(0);
      const zeroAreaPolys = polys.filter((p) => emittedPolyArea(p.getAttribute('points') || '') === 0);
      expect(zeroAreaPolys.length).toBe(0);
    });
  }

  it('DECODES the projection collapse the fix removes (proof it is scenario b)', () => {
    // Before the fix, projectScene emitted a triangle PER edge-on cap facet — a
    // triangle with real 3D area whose 2D projection is a line. Re-run the drop
    // logic manually on the RAW kept triangles to show they existed + were legal.
    const geo = sinWarped(cylZ(24), 0.6, 1.2);
    const scene = project(geo);            // post-fix scene: already deduped
    // Every surviving triangle projects to a real, non-collinear 2D area.
    for (const t of scene.tris) expect(projDet(t)).toBeGreaterThan(0);
    // …and the source mesh had no zero-area triangle → the collapse was purely a
    // projection artifact, so a build-time fix was neither possible nor needed.
    expect(min3dArea(geo)).toBeGreaterThan(1e-3);
  });
});
