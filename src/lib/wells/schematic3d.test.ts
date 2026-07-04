/**
 * schematic3d.test.ts — headless verification for the ported SVTC 3D
 * well-schematic engine (`threeD/`, `dtx.ts`, `parametric/`). Runs under
 * `bun run test` (vitest, node env) — the reliable overnight check, independent
 * of any browser rendering.
 *
 * Covers:
 *   • pure math — WellProfile min-curvature TVD monotonic; getInterNode frame
 *     orthonormal + right-handed; autoNodes / lerpDTX monotonic depth transform.
 *   • geometry — building the sample WSON's feature meshes (cutTube / cutCylinder
 *     / cutSphere) yields non-degenerate BufferGeometry with finite, sane
 *     tri/vert counts, AND the parametric builder returns a manifold,
 *     non-zero-volume solid. Warp verified to bend the deviated sample off-axis.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { WellProfile } from './threeD/profile';
import { buildWellDirection, sampleCentreline } from './threeD';
import {
  initManifold, cutCylinder, cutTube, cutSphere, warpGeometry,
  beginWellTiming, readWellTiming,
} from './threeD/manifoldCut';
import { bakerPacker } from './threeD/parametric/bakerPacker';
import { buildCached, getBuilder } from './threeD/parametric';
import { autoNodes, lerpDTX, dtxRemapSurvey } from './dtx';
import { sampleWells } from './samples';

// A deterministic J-shape (build-and-hold) survey: vertical → build to 45° → hold.
const jSurvey = [
  { md: 0, dev: 0, az: 30 },
  { md: 1000, dev: 0, az: 30 },
  { md: 1600, dev: 45, az: 30 },
  { md: 3000, dev: 45, az: 30 },
];

const sample9 = sampleWells.find((w) => w.slug.startsWith('09'))!;

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

describe('manifold geometry — sample WSON features', () => {
  beforeAll(async () => { await initManifold(); });

  const diaScale = 6;

  function assertSaneGeo(geo: THREE.BufferGeometry | null, label: string) {
    expect(geo, label).not.toBeNull();
    const pos = geo!.getAttribute('position');
    expect(pos, `${label} position attr`).toBeTruthy();
    expect(pos.count, `${label} vert count`).toBeGreaterThan(30);
    // Non-indexed triangle soup → count multiple of 3.
    expect(pos.count % 3, `${label} tri soup`).toBe(0);
    const arr = pos.array as ArrayLike<number>;
    for (let i = 0; i < arr.length; i++) expect(Number.isFinite(arr[i]), `${label} finite[${i}]`).toBe(true);
    geo!.computeBoundingBox();
    const size = new THREE.Vector3(); geo!.boundingBox!.getSize(size);
    // Non-degenerate extent in all 3 axes (proxy for non-zero volume).
    expect(size.x + size.y + size.z, `${label} extent`).toBeGreaterThan(1);
  }

  it('builds an OH cutCylinder (vertical fast-path — no survey)', () => {
    const oh = sample9.wson.oh![sample9.wson.oh!.length - 1];
    const dir = buildWellDirection(null, sample9.wson.meta.td!);
    const geo = cutCylinder(oh.top, oh.bot, (oh.bitSize * diaScale) / 2, 'x', [0.9, 0.8, 1], {}, dir, 0);
    assertSaneGeo(geo, 'OH cutCylinder');
  });

  it('builds a casing cutTube along the DEVIATED survey (warp path)', () => {
    const ch = sample9.wson.ch!.find((c) => c.type === 'production')!;
    const dir = buildWellDirection(sample9.wson.profile, sample9.wson.meta.td!);
    const id = ch.id ?? ch.od * 0.92;
    // Window across the 3200 m kick-off (600 m span keeps the extrude fast while
    // still exercising the warp through the build section).
    const geo = cutTube(3100, 3600, (id * diaScale) / 2, (ch.od * diaScale) / 2, 'x', [0.6, 0.6, 0.7], {}, dir, 0);
    assertSaneGeo(geo, 'CH cutTube (deviated)');
    // The 09 sample kicks off to 25° from 3200 m; a casing crossing that zone
    // must be warped OFF the vertical axis (some verts have |x|+|y| > small).
    const pos = geo!.getAttribute('position');
    let maxOff = 0;
    for (let i = 0; i < pos.count; i++) maxOff = Math.max(maxOff, Math.hypot(pos.getX(i), pos.getY(i)));
    expect(maxOff, 'warp lateral departure').toBeGreaterThan(20);
  }, 30000);

  it('deviated + cutaway builds a HALF-SECTION cut (Strategy E), attributed to the cutaway phase', () => {
    // Regression: a deviated well with cutaway ON must still produce a
    // cross-section (the half cross-section extrude), NOT a full solid — and the
    // diagnostic must charge that CSG to `cutaway`, not `solid`, so the badge
    // does not misreport "cutaway 0ms · 0 CSG" for deviated wells.
    const ch = sample9.wson.ch!.find((c) => c.type === 'production')!;
    const dir = buildWellDirection(sample9.wson.profile, sample9.wson.meta.td!);
    const id = ch.id ?? ch.od * 0.92;

    // Distinct RED main color so the grey cut-face triangles are unambiguous
    // (default cutColor ≈ [0.62,0.62,0.66]).
    beginWellTiming();
    const geo = cutTube(3100, 3600, (id * diaScale) / 2, (ch.od * diaScale) / 2, 'x', [0.9, 0.1, 0.1], {}, dir, 0);
    const timing = readWellTiming();
    assertSaneGeo(geo, 'deviated cutaway cutTube');

    // The half-section CSG must be COUNTED and TIMED under `cutaway` (not solid),
    // so the diagnostic badge does not misreport "cutaway 0ms · 0 CSG".
    expect(timing.csgOps, 'deviated cutaway CSG op count').toBeGreaterThan(0);
    expect(timing.cutaway, 'deviated cutaway phase ms').toBeGreaterThan(0);

    // A genuine half-section has a GREY cut FACE (per-vertex cutColor) — a full
    // (un-cut) solid tube would carry only the RED main color. Count grey verts.
    const col = geo!.getAttribute('color');
    let grey = 0, red = 0;
    for (let i = 0; i < col.count; i++) {
      const r = col.getX(i), g = col.getY(i), b = col.getZ(i);
      if (r > 0.7 && g < 0.3 && b < 0.3) red++;
      else if (Math.abs(r - g) < 0.15 && Math.abs(g - b) < 0.15 && r > 0.4 && r < 0.8) grey++;
    }
    expect(red, 'main (wall) color present').toBeGreaterThan(0);
    expect(grey, 'grey cut-face triangles present (cross-section, not a solid)').toBeGreaterThan(0);
  }, 30000);

  it('differential cutaway — outer strings cut 180° (½ vol), completions 90° (¾ vol)', () => {
    // Enhancement over SVTC's uniform 180°: outer well layers lose a full HALF
    // (annular cross-section), completions lose only a 90° WEDGE so the jewelry
    // reads whole (270° stays). Same tube geometry, two cut angles.
    // Signed-tetrahedron volume of a watertight non-indexed triangle soup.
    function meshVolume(geo: THREE.BufferGeometry): number {
      const pos = geo.getAttribute('position').array as ArrayLike<number>;
      let v = 0;
      for (let i = 0; i < pos.length; i += 9) {
        const ax = pos[i],     ay = pos[i + 1], az = pos[i + 2];
        const bx = pos[i + 3], by = pos[i + 4], bz = pos[i + 5];
        const cx = pos[i + 6], cy = pos[i + 7], cz = pos[i + 8];
        v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
      }
      return Math.abs(v) / 6;
    }
    function countCutFaceGreys(geo: THREE.BufferGeometry): number {
      const col = geo.getAttribute('color');
      let grey = 0;
      for (let i = 0; i < col.count; i++) {
        const r = col.getX(i), g = col.getY(i), b = col.getZ(i);
        if (Math.abs(r - g) < 0.15 && Math.abs(g - b) < 0.15 && r > 0.4 && r < 0.8) grey++;
      }
      return grey;
    }

    const R = 20, r = 10, top = 0, bot = 100;
    const fullVol = Math.PI * (R * R - r * r) * (bot - top); // ideal annular shell

    // 180° — outer-string cut (vertical fast-path, distinct RED wall color).
    beginWellTiming();
    const g180 = cutTube(top, bot, r, R, 'x', [0.9, 0.1, 0.1], {}, null, 0, 180)!;
    const t180 = readWellTiming();
    // 90° — completion wedge, SAME tube.
    beginWellTiming();
    const g90 = cutTube(top, bot, r, R, 'x', [0.9, 0.1, 0.1], {}, null, 0, 90)!;
    const t90 = readWellTiming();

    expect(g180).not.toBeNull();
    expect(g90).not.toBeNull();

    const v180 = meshVolume(g180), v90 = meshVolume(g90);
    // 180° keeps HALF the shell; 90° keeps THREE QUARTERS (270°).
    expect(v180 / fullVol, '180° ≈ ½ volume').toBeGreaterThan(0.45);
    expect(v180 / fullVol, '180° ≈ ½ volume').toBeLessThan(0.55);
    expect(v90 / fullVol, '90° ≈ ¾ volume').toBeGreaterThan(0.70);
    expect(v90 / fullVol, '90° ≈ ¾ volume').toBeLessThan(0.80);
    // Direct ratio: ¾ ÷ ½ = 1.5 — the wedge keeps 50% MORE material than the half.
    expect(v90 / v180, '90°/180° ≈ 1.5').toBeGreaterThan(1.35);
    expect(v90 / v180, '90°/180° ≈ 1.5').toBeLessThan(1.65);

    // Distinct bbox: 180° removes the whole x<0 half → min.x ≈ 0; 90° removes
    // only the x<0∧y<0 quadrant → x still reaches −R (an asymmetric notch, not a half).
    g180.computeBoundingBox(); g90.computeBoundingBox();
    expect(g180.boundingBox!.min.x, '180° half → min.x ≈ 0').toBeGreaterThan(-1);
    expect(g90.boundingBox!.min.x, '90° notch → x still reaches −R').toBeLessThan(-R * 0.8);

    // Both are genuine cutaways: grey cut-face tris + CSG ran.
    expect(countCutFaceGreys(g180), '180° grey cut face').toBeGreaterThan(0);
    expect(countCutFaceGreys(g90), '90° grey cut face').toBeGreaterThan(0);
    expect(t180.csgOps, '180° csgOps>0').toBeGreaterThan(0);
    expect(t90.csgOps, '90° csgOps>0').toBeGreaterThan(0);
  });

  it('builds a perforation cutSphere at the perf midpoint', () => {
    const p = sample9.wson.perforations![0];
    const dir = buildWellDirection(sample9.wson.profile, sample9.wson.meta.td!);
    const node = dir.getInterNode((p.top + p.bot) / 2)!;
    expect(node).toBeTruthy();
    const geo = cutSphere({ x: node.pt[0], y: node.pt[1], z: node.pt[2] }, 20, 'x', [1, 0.3, 0.3]);
    assertSaneGeo(geo, 'perf cutSphere');
  });

  it('warpGeometry barely moves a vertical well but bends a deviated one', () => {
    // buildWellDirection(null) synthesises a vertical survey; cleanSurvey nudges
    // dev by 0.02° so no two directions collide, giving a MICRO curvature — the
    // warp therefore displaces verts only a hair (near-no-op), not at all.
    const flat = buildWellDirection(null, 3000);
    const gV = new THREE.CylinderGeometry(5, 5, 100, 16, 8).rotateX(Math.PI / 2).translate(0, 0, 1500);
    const beforeV = (gV.getAttribute('position').array as Float32Array).slice();
    warpGeometry(gV, flat);
    const afterV = gV.getAttribute('position').array as Float32Array;
    let maxMoveV = 0;
    for (let i = 0; i < beforeV.length; i++) maxMoveV = Math.max(maxMoveV, Math.abs(beforeV[i] - afterV[i]));
    expect(maxMoveV, 'vertical warp is near-no-op').toBeLessThan(1);

    // A genuinely deviated well bends the same geometry substantially.
    const dev = buildWellDirection(jSurvey, 3000);
    const gD = new THREE.CylinderGeometry(5, 5, 100, 16, 8).rotateX(Math.PI / 2).translate(0, 0, 1500);
    const beforeD = (gD.getAttribute('position').array as Float32Array).slice();
    warpGeometry(gD, dev);
    const afterD = gD.getAttribute('position').array as Float32Array;
    let maxMoveD = 0;
    for (let i = 0; i < beforeD.length; i++) maxMoveD = Math.max(maxMoveD, Math.abs(beforeD[i] - afterD[i]));
    expect(maxMoveD, 'deviated warp bends').toBeGreaterThan(50);
  });
});

describe('parametric builder — Baker packer', () => {
  beforeAll(async () => { await initManifold(); });

  it('resolves via the registry by tool_comp code', () => {
    expect(getBuilder('PACKERS.PACKER_BAKER_PERMANENT')).toBe(bakerPacker);
    expect(getBuilder('packers.packer_baker')).toBe(bakerPacker); // case-insensitive
    expect(getBuilder('MISC.NOPE')).toBeNull();
  });

  it('builds a manifold, non-zero-volume solid with sane counts', async () => {
    const res = await buildCached(bakerPacker, { od: 5, id: 2, length: 0.6, slipRingCount: 2 });
    expect(res.isManifold).toBe(true);
    const pos = res.geometry.getAttribute('position');
    expect(pos.count).toBeGreaterThan(90);
    expect(pos.count % 3).toBe(0);
    const size = new THREE.Vector3(); res.bbox.getSize(size);
    // OD 5" → ~5 across x/y; length 0.6 → ~0.6 in z. Non-zero volume in all axes.
    expect(size.x).toBeGreaterThan(3);
    expect(size.y).toBeGreaterThan(3);
    expect(size.z).toBeGreaterThan(0.3);
  });

  it('caches identical param signatures', async () => {
    const a = await buildCached(bakerPacker, { od: 5, id: 2, length: 0.6, slipRingCount: 2 });
    const b = await buildCached(bakerPacker, { od: 5, id: 2, length: 0.6, slipRingCount: 2 });
    expect(a).toBe(b);
  });
});
