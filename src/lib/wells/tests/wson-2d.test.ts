/**
 * wson-2d.test.ts — pins the PURE 2D-schematic geometry builder (wson-2d.ts).
 *
 * Invariants: one body seg per component, rects mirrored about the centreline,
 * depth Y strictly monotonic (deeper = larger Y), a shared remap matches the
 * 3D formula, and a deviated well produces a bent centreline path (non-zero
 * horizontal spread). No DOM, no WASM — headless.
 */
import { describe, it, expect } from 'vitest';
import {
  computeWson2D, buildRemap, maxDepthOf, compTypeOf, type Wson2DInput,
} from '../wson-2d';
import { autoNodes, lerpDTX } from '../dtx';

const VERTICAL: Wson2DInput = {
  meta: { td: 1070 },
  oh: [
    { bitSize: 26, top: 0, bot: 60 },
    { bitSize: 17.5, top: 60, bot: 300 },
    { bitSize: 12.25, top: 300, bot: 1070 },
  ],
  ch: [
    { od: 20, id: 19.124, top: 0, bot: 60, grade: 'K55', type: 'conductor' },
    { od: 13.375, id: 12.415, top: 0, bot: 300, grade: 'K55', type: 'surface' },
    { od: 9.625, id: 8.681, top: 0, bot: 1070, grade: 'L80', type: 'production' },
  ],
  perforations: [{ top: 1040, bot: 1060, label: 'Main reservoir' }],
  completions: [
    { description: 'Tubing Hanger', tool_comp: 'tbgHanger', od: 8.681, top: 0, bot: 0.5 },
    { description: 'Tubing Joints', tool_comp: 'MISC.TUBING', od: 2.875, top: 0.5, bot: 1025 },
    { description: 'Baker Permanent Packer', tool_comp: 'PACKERS.PACKER_BAKER_PERMANENT', od: 8.681, top: 1028, bot: 1028.5 },
    { description: 'Mule Shoe', tool_comp: 'MISC.MULE_SHOE', od: 2.875, top: 1029.8, bot: 1030 },
  ],
  cementing: [
    { od: 20, top: 0, bot: 60 },
    { od: 13.375, top: 0, bot: 300 },
    { od: 9.625, top: 700, bot: 1070 },
  ],
};

const DEVIATED: Wson2DInput = {
  meta: { td: 2000 },
  oh: [{ bitSize: 8.5, top: 0, bot: 2000 }],
  ch: [{ od: 5.5, top: 0, bot: 2000, grade: 'P110', type: 'production' }],
  perforations: [{ top: 1800, bot: 1900, label: 'Stage 1' }],
  profile: [
    { md: 0, dev: 0, az: 90 },
    { md: 500, dev: 0, az: 90 },
    { md: 1200, dev: 45, az: 90 },
    { md: 2000, dev: 90, az: 90 },
  ],
};

const OPTS = { diaScale: 6, zScale: 1, dtx: true, directional: true };

describe('maxDepthOf', () => {
  it('picks the deepest MD across all layers', () => {
    expect(maxDepthOf(VERTICAL)).toBe(1070);
    expect(maxDepthOf({ oh: [{ bitSize: 8, top: 0, bot: 500 }] })).toBe(500);
    expect(maxDepthOf({})).toBe(1000); // fallback
  });
});

describe('buildRemap — matches the WellSchematic3D formula', () => {
  it('equals (dtx?lerpDTX:md)*zScale', () => {
    const rawTd = maxDepthOf(VERTICAL);
    const dtx = autoNodes(
      [
        { start: 0, end: 0.5 }, { start: 0.5, end: 1025 }, { start: 1028, end: 1028.5 },
        { start: 1029.8, end: 1030 }, { start: 1040, end: 1060 },
      ],
      rawTd,
    );
    const remap = buildRemap(VERTICAL, { dtx: true, zScale: 2 });
    for (const md of [0, 300, 1030, 1070]) {
      expect(remap(md)).toBeCloseTo(lerpDTX(dtx, md) * 2, 6);
    }
  });

  it('is identity×zScale when dtx off', () => {
    const remap = buildRemap(VERTICAL, { dtx: false, zScale: 1.5 });
    expect(remap(400)).toBeCloseTo(600, 6);
    expect(remap(0)).toBe(0);
  });
});

describe('computeWson2D — vertical well', () => {
  const s = computeWson2D(VERTICAL, OPTS);

  it('is not deviated and has a straight (constant-X) centreline', () => {
    expect(s.deviated).toBe(false);
    const xs = new Set(s.centerline.map((p) => Math.round(p[0])));
    expect(xs.size).toBe(1); // straight vertical → single X
    expect([...xs][0]).toBe(Math.round(s.centerX));
  });

  it('one body seg per open hole + casing; tubing joints split out', () => {
    expect(s.openHole.length).toBe(3);
    expect(s.casing.length).toBe(3);
    expect(s.tubing).not.toBeNull();
    // 4 completions minus the 1 tubing-joints string = 3 comp segs
    expect(s.completions.length).toBe(3);
  });

  it('rects are mirrored about the centreline (x + w/2 === centerX)', () => {
    for (const seg of [...s.openHole, ...s.casing]) {
      expect(seg.rect.x + seg.rect.w / 2).toBeCloseTo(s.centerX, 6);
      expect(seg.rect.w).toBeGreaterThan(0);
    }
  });

  it('wider tubulars → wider rects (radius drives width)', () => {
    const oh26 = s.openHole.find((o) => o.label.startsWith('26'))!;
    const oh12 = s.openHole.find((o) => o.label.startsWith('12.25'))!;
    expect(oh26.rect.w).toBeGreaterThan(oh12.rect.w);
    // 26" bit vs 12.25" bit → exactly proportional
    expect(oh26.rect.w / oh12.rect.w).toBeCloseTo(26 / 12.25, 4);
  });

  it('depth Y is monotonic (deeper = larger Y)', () => {
    const ys = [0, 100, 300, 700, 1070].map((d) => s.depthToY(d));
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThan(ys[i - 1]);
  });

  it('cement is a two-sided annulus, both sides equal width and off-centre', () => {
    expect(s.cement.length).toBeGreaterThan(0);
    for (const c of s.cement) {
      expect(c.leftRect.w).toBeCloseTo(c.rightRect.w, 6);
      expect(c.leftRect.x + c.leftRect.w).toBeLessThanOrEqual(s.centerX + 1e-6); // left of centre
      expect(c.rightRect.x).toBeGreaterThanOrEqual(s.centerX - 1e-6);           // right of centre
    }
  });

  it('perf arrows: two chevrons per PERF_DIST interval, symmetric about centre', () => {
    const pf = s.perfs[0];
    // (1060-1040)/3 ≈ 7 intervals → 14 arrows
    expect(pf.arrows.length).toBe(14);
    // left arrow tip.x < centerX < right arrow tip.x
    expect(pf.arrows[0][0][0]).toBeLessThan(s.centerX);
    expect(pf.arrows[1][0][0]).toBeGreaterThan(s.centerX);
  });

  it('emits label anchors banked left (bh) / right (completions+perf)', () => {
    const left = s.labels.filter((l) => l.side === 'left');
    const right = s.labels.filter((l) => l.side === 'right');
    expect(left.length).toBeGreaterThan(0);  // oh + casing + cement
    expect(right.length).toBeGreaterThan(0); // completions + perf
    for (const l of left) expect(l.ax).toBeLessThanOrEqual(s.centerX + 1e-6);
    for (const r of right) expect(r.ax).toBeGreaterThanOrEqual(s.centerX - 1e-6);
  });

  it('has a TD marker at the deepest open hole', () => {
    expect(s.td).not.toBeNull();
    expect(s.td!.md).toBe(1070);
    expect(s.td!.xL).toBeLessThan(s.td!.xR);
  });

  it('DTX emphasis: the packed completion stack near TD expands vertically', () => {
    const withDtx = computeWson2D(VERTICAL, { ...OPTS, dtx: true });
    const noDtx = computeWson2D(VERTICAL, { ...OPTS, dtx: false });
    // The 2 m span 1028–1030 gets more display height under DTX than without.
    const spanD = withDtx.depthToY(1030) - withDtx.depthToY(1028);
    const spanN = noDtx.depthToY(1030) - noDtx.depthToY(1028);
    expect(spanD).toBeGreaterThan(spanN);
  });
});

describe('computeWson2D — deviated well', () => {
  const s = computeWson2D(DEVIATED, OPTS);

  it('is deviated and the centreline bends (non-zero horizontal spread)', () => {
    expect(s.deviated).toBe(true);
    const xs = s.centerline.map((p) => p[0]);
    const spread = Math.max(...xs) - Math.min(...xs);
    expect(spread).toBeGreaterThan(1); // the lateral departs horizontally
  });

  it('centreline TVD (Y) still increases monotonically along MD', () => {
    for (let i = 1; i < s.centerline.length; i++) {
      expect(s.centerline[i][1]).toBeGreaterThanOrEqual(s.centerline[i - 1][1] - 1e-6);
    }
  });

  it('body segs carry closed polygons (not rects) when deviated', () => {
    for (const seg of [...s.openHole, ...s.casing]) {
      expect(seg.poly.length).toBeGreaterThan(4);
    }
  });

  it('straight mode (directional off) removes the bend', () => {
    const straight = computeWson2D(DEVIATED, { ...OPTS, directional: false });
    expect(straight.deviated).toBe(false);
    const xs = new Set(straight.centerline.map((p) => Math.round(p[0])));
    expect(xs.size).toBe(1);
  });
});

describe('compTypeOf', () => {
  it('classifies by tool_comp / description keywords', () => {
    expect(compTypeOf({ description: 'Baker Permanent Packer' })).toBe('packer');
    expect(compTypeOf({ description: 'Tubing Hanger' })).toBe('hanger');
    expect(compTypeOf({ tool_comp: 'ICD.NOZZLE' })).toBe('icd');
    expect(compTypeOf({ description: '5.5in Liner' })).toBe('liner');
    expect(compTypeOf({ description: 'Tubing Joints' })).toBe('tubing');
  });
});
