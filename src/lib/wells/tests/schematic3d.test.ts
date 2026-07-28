/**
 * schematic3d.test.ts — headless verification for the ported SVTC 3D
 * well-schematic PURE MATH (`threeD/profile.ts`, `threeD/index.ts`, `dtx.ts`).
 * Runs under `bun run test` (vitest, node env) — the reliable overnight check,
 * independent of any browser rendering.
 *
 * NOTE: the geometry/cutaway (`manifoldCut`) + parametric-builder coverage that
 * used to live here was removed with the pure-THREE `WellSchematic3D` shell
 * cluster (#42h(c), 2026-07-28). The 3D `/wells` view now renders through
 * `GraphEditorPane` (`WellViewPlaceholder` bakes `wsonToGraph`), so those
 * builders no longer exist. What remains is the survey/depth math still used by
 * `wson-2d.ts`, `WellProfile` (also covered by `graph/tests/survey-to-xyz`), and
 * the `threeD` direction barrel.
 *
 * Covers:
 *   • pure math — WellProfile min-curvature TVD monotonic; getInterNode frame
 *     orthonormal + right-handed; autoNodes / lerpDTX monotonic depth transform.
 */
import { describe, it, expect } from 'vitest';
import { WellProfile } from '../threeD/profile';
import { buildWellDirection, sampleCentreline } from '../threeD';
import { autoNodes, lerpDTX, dtxRemapSurvey } from '../dtx';

// A deterministic J-shape (build-and-hold) survey: vertical → build to 45° → hold.
const jSurvey = [
  { md: 0, dev: 0, az: 30 },
  { md: 1000, dev: 0, az: 30 },
  { md: 1600, dev: 45, az: 30 },
  { md: 3000, dev: 45, az: 30 },
];

function isFiniteVec(a: number[]): boolean { return a.every((x) => Number.isFinite(x)); }
function len3(a: number[]): number { return Math.hypot(a[0], a[1], a[2]); }
function dot3(a: number[], b: number[]): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross3(a: number[], b: number[]): number[] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

describe('WellProfile — min-curvature segments', () => {
  it('produces finite segments with a virtual 2000-unit tail', () => {
    const prof = new WellProfile(jSurvey);
    const segs = prof.segments;
    expect(segs.length).toBeGreaterThanOrEqual(jSurvey.length - 1);
    for (const s of segs) {
      expect(isFiniteVec(s.p1)).toBe(true);
      expect(isFiniteVec(s.p2)).toBe(true);
      expect(isFiniteVec(s.q1)).toBe(true);
      expect(isFiniteVec(s.ptPivot)).toBe(true);
      expect(Number.isFinite(s.radCurvature)).toBe(true);
    }
    // The last cleaned station sits 2000 beyond the deepest real MD.
    expect(prof.survey.at(-1)!.md).toBeCloseTo(jSurvey.at(-1)!.md + 2000, 6);
  });

  it('TVD is monotonic non-decreasing down the J-shape well', () => {
    const dir = buildWellDirection(jSurvey, 3000);
    let prevTvd = -Infinity;
    for (let md = 0; md <= 3000; md += 50) {
      const n = dir.getInterNode(md);
      if (!n) continue;
      const tvd = n.pt[2];
      expect(Number.isFinite(tvd)).toBe(true);
      expect(tvd).toBeGreaterThanOrEqual(prevTvd - 1e-6);
      prevTvd = tvd;
    }
    // A 45° hold well: horizontal offset must grow (well departs from vertical).
    const toe = dir.getInterNode(2999)!;
    expect(Math.hypot(toe.pt[0], toe.pt[1])).toBeGreaterThan(100);
  });

  it('getInterNode frame is orthonormal + right-handed', () => {
    const dir = buildWellDirection(jSurvey, 3000);
    for (let md = 200; md <= 2800; md += 200) {
      const n = dir.getInterNode(md);
      if (!n) continue;
      expect(len3(n.norm)).toBeCloseTo(1, 4);
      expect(len3(n.tangent)).toBeCloseTo(1, 4);
      // norm ⊥ tangent.
      expect(Math.abs(dot3(n.norm, n.tangent))).toBeLessThan(1e-3);
      // binormal = norm × tangent is unit (right-handed orthonormal triple).
      expect(len3(cross3(n.norm, n.tangent))).toBeCloseTo(1, 3);
    }
  });

  it('sampleCentreline returns a finite, ordered polyline', () => {
    const dir = buildWellDirection(jSurvey, 3000);
    const pts = sampleCentreline(dir, 0, 3000, 25);
    expect(pts.length).toBeGreaterThan(10);
    for (const p of pts) expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
    // z increases along the polyline.
    for (let i = 1; i < pts.length; i++) expect(pts[i].z).toBeGreaterThanOrEqual(pts[i - 1].z - 1e-6);
  });
});

describe('DTX depth transform', () => {
  const nodes = [{ start: 2800, end: 2810 }, { start: 2812, end: 2814 }]; // clustered stack near TD
  const maxDepth = 3000;
  const dtx = autoNodes(nodes, maxDepth);

  it('autoNodes yields monotonic depth + depthTx anchored to [0, maxDepth]', () => {
    expect(dtx.depth[0]).toBe(0);
    expect(dtx.depthTx[0]).toBe(0);
    for (let i = 1; i < dtx.depth.length; i++) {
      expect(dtx.depth[i]).toBeGreaterThanOrEqual(dtx.depth[i - 1]);
      expect(dtx.depthTx[i]).toBeGreaterThanOrEqual(dtx.depthTx[i - 1]);
    }
    expect(dtx.depth.at(-1)).toBeCloseTo(maxDepth, 3);
    expect(dtx.depthTx.at(-1)).toBeCloseTo(maxDepth, 3);
  });

  it('lerpDTX is monotonic and expands the clustered stack', () => {
    let prev = -Infinity;
    for (let d = 0; d <= maxDepth; d += 25) {
      const v = lerpDTX(dtx, d);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-6);
      prev = v;
    }
    // The 10 m stack interval [2800,2810] occupies MORE than 10 m of display
    // depth (that is the whole point of DTX emphasis).
    const displaySpan = lerpDTX(dtx, 2810) - lerpDTX(dtx, 2800);
    expect(displaySpan).toBeGreaterThan(10);
  });

  it('dtxRemapSurvey keeps station count + monotonic MD', () => {
    const remapped = dtxRemapSurvey(dtx, jSurvey);
    expect(remapped).toHaveLength(jSurvey.length);
    for (let i = 1; i < remapped.length; i++) expect(remapped[i].md).toBeGreaterThanOrEqual(remapped[i - 1].md - 1e-6);
  });
});
