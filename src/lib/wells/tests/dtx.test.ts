import { describe, it, expect } from 'vitest';
import { autoNodes, lerpDTX, type DtxNode, type Dtx } from '../dtx';

/**
 * CHANGE 1 — NORMALIZED warp-autoscale grade. `autoNodes(nodes, maxDepth, opts)`
 * grows a NEW optional 3rd arg. With `opts.footprintFrac` the magnification is a
 * FRACTION OF TOTAL length (`footprintFrac × maxDepth`), so a short element reads
 * the same on a 257-unit completion or a 3000-m well — instead of the legacy
 * ABSOLUTE `50/(0.3·len)` grade that balloons a tiny element on a short string.
 * ABSENT opts must stay byte-identical (the /wells + wson-2d callers rely on it).
 */

/** The display footprint (span in DISPLAY depth) an interval `[a,b]` occupies. */
const footprintOf = (dtx: Dtx, a: number, b: number) => lerpDTX(dtx, b) - lerpDTX(dtx, a);

/** A faithful copy of the ORIGINAL (pre-Change-1) absolute grade — the byte-parity
 *  reference. If autoNodes(nodes, maxDepth) ever drifts from this, the golden fails. */
function autoNodesLegacyRef(nodes: DtxNode[], maxDepth: number): Dtx {
  const breaks = new Set<number>([0, maxDepth]);
  for (const nd of nodes) { breaks.add(nd.start); breaks.add(nd.end); }
  const bpts = [...breaks].sort((a, b) => a - b);
  const intervals: { len: number; w: number }[] = [];
  for (let i = 0; i < bpts.length - 1; i++) {
    const s = bpts[i], e = bpts[i + 1], len = e - s;
    if (len <= 0) continue;
    let weight = 1;
    for (const nd of nodes) {
      if (nd.start <= s && nd.end >= e && len < 50) {
        const w = 50 / (0.3 * len);
        weight = Math.max(weight, isFinite(w) ? w : 1);
      }
    }
    intervals.push({ len, w: weight });
  }
  const totalW = intervals.reduce((sum, iv) => sum + iv.len * iv.w, 0);
  const depth = [0], depthTx = [0];
  let cumReal = 0, cumWt = 0;
  for (const iv of intervals) {
    cumReal += iv.len; cumWt += iv.len * iv.w;
    depth.push(cumReal);
    depthTx.push(totalW > 0 ? cumWt * maxDepth / totalW : cumReal);
  }
  return { depth, depthTx };
}

describe('autoNodes NORMALIZED grade (Change 1)', () => {
  // (1) UNCAPPED: a short element (target/len < maxRatio) gets a display footprint
  //     ≈ footprintFrac·maxDepth.
  it('a short element footprint ≈ footprintFrac·maxDepth (uncapped)', () => {
    const maxDepth = 1000, frac = 0.03;                 // target = 30
    const nodes: DtxNode[] = [{ start: 500, end: 510 }]; // len 10 ⇒ w = min(30/10, 6) = 3
    const dtx = autoNodes(nodes, maxDepth, { footprintFrac: frac, maxRatio: 6 });
    const fp = footprintOf(dtx, 500, 510);
    const target = frac * maxDepth;                     // 30
    // Slightly below target (totalW > maxDepth from the boost), but clearly close.
    expect(fp).toBeGreaterThan(target * 0.9);
    expect(fp).toBeLessThanOrEqual(target * 1.001);
    // Total length preserved (anchored 0→0, maxDepth→maxDepth).
    expect(dtx.depthTx[dtx.depthTx.length - 1]).toBeCloseTo(maxDepth, 6);
    expect(dtx.depth[dtx.depth.length - 1]).toBeCloseTo(maxDepth, 6);
  });

  // (2) CAPPED: a tiny element can't exceed len·maxRatio.
  it('a tiny element is capped at maxRatio (footprint ≈ len·maxRatio, ≪ target)', () => {
    const maxDepth = 1000, frac = 0.03, maxRatio = 6;   // target = 30
    const nodes: DtxNode[] = [{ start: 500, end: 502 }]; // len 2 ⇒ 30/2 = 15, capped to 6
    const dtx = autoNodes(nodes, maxDepth, { footprintFrac: frac, maxRatio });
    const fp = footprintOf(dtx, 500, 502);
    expect(fp).toBeLessThan(frac * maxDepth * 0.5);      // clearly capped, not near target
    // ≈ len·maxRatio·maxDepth/totalW = 12·1000/1010 ≈ 11.9.
    expect(fp).toBeGreaterThan(10);
    expect(fp).toBeLessThan(13);
  });

  // (3) SCALE-INVARIANT: the same footprintFrac + a proportionally-placed element
  //     gives the SAME footprint/maxDepth on a 257-unit and a 3000-m well.
  it('the grade is scale-invariant (footprint/maxDepth constant across well lengths)', () => {
    const frac = 0.05;
    const grade = (maxDepth: number) => {
      const center = maxDepth * 0.5, len = maxDepth * 0.02; // 2% of total (uncapped: 0.05/6 < 0.02 < 0.05)
      const dtx = autoNodes([{ start: center - len / 2, end: center + len / 2 }], maxDepth, { footprintFrac: frac });
      return footprintOf(dtx, center - len / 2, center + len / 2) / maxDepth;
    };
    const gA = grade(257), gB = grade(3000);
    expect(Math.abs(gA - gB) / gA).toBeLessThan(0.02); // within 2% — effectively identical
  });

  // (4) footprintFrac = 0 ⇒ IDENTITY (strength 0 must NOT fall back to the absolute grade).
  it('footprintFrac 0 ⇒ identity LUT (no magnification)', () => {
    const maxDepth = 1000;
    const nodes: DtxNode[] = [{ start: 100, end: 110 }];
    const dtx = autoNodes(nodes, maxDepth, { footprintFrac: 0 });
    for (let d = 0; d <= maxDepth; d += 50) expect(lerpDTX(dtx, d)).toBeCloseTo(d, 6);
  });

  // (5) GOLDEN: ABSENT opts is byte-identical to the legacy absolute grade — and that
  //     absolute grade balloons a short element far more than the normalized one (the
  //     very problem Change 1 fixes).
  it('golden: absent opts ≡ legacy absolute grade (byte-identical)', () => {
    const cases: { nodes: DtxNode[]; maxDepth: number }[] = [
      { nodes: [{ start: 100, end: 110 }], maxDepth: 1000 },
      { nodes: [{ start: 40, end: 45 }, { start: 300, end: 380 }], maxDepth: 500 },
      { nodes: [], maxDepth: 257 },
      { nodes: [{ start: 10, end: 12 }], maxDepth: 40 },
    ];
    for (const { nodes, maxDepth } of cases) {
      const got = autoNodes(nodes, maxDepth);
      const ref = autoNodesLegacyRef(nodes, maxDepth);
      expect(got.depth).toEqual(ref.depth);
      expect(got.depthTx).toEqual(ref.depthTx);
    }
  });

  it('the absolute grade balloons a short element far more than the normalized one', () => {
    const maxDepth = 1000;
    const nodes: DtxNode[] = [{ start: 100, end: 110 }]; // len 10
    const absolute = footprintOf(autoNodes(nodes, maxDepth), 100, 110);                     // ~144 (14%)
    const normalized = footprintOf(autoNodes(nodes, maxDepth, { footprintFrac: 0.03 }), 100, 110); // ~29 (3%)
    expect(absolute).toBeGreaterThan(normalized * 3);
  });
});
