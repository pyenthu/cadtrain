/**
 * wson-to-graph.cement.test — #996 cement as a DERIVED annulus.
 *
 * Cement is NOT an authored `{od,id}` part: it is `outerBoundary − casingOD`,
 * clipped to `[TOC, shoe]`, segmented at every tubular/hole breakpoint so the
 * open-hole→cased-lap transition splits into separate concentric annuli. These
 * tests pin the pure derivation (`deriveCementSegments`) AND that the emitted
 * graph carries the right `bw_cement` Calls (od/wall/length + Mv placement).
 * Grounding: docs/research/cement-annulus-detection.md.
 *
 * Headless by design (CLAUDE.md Rule 26): no browser, no volume, no geometry bake.
 */
import { describe, expect, it, vi } from 'vitest';
import { emitGraph } from '$lib/graph/composition/composition-emit';
import { hydrateGraph } from '$lib/graph/composition/composition-graph-hydrate';
import { deriveCementSegments, wsonToGraph } from '../wson-to-graph';
import { lintWson } from '../wson';
import type { Wson } from '../wson';

// ── Fixtures ────────────────────────────────────────────────────────────────

/** One 9⅝" production casing cemented from TOC=300 up to its 900 m shoe, inside
 *  a 12¼" open hole. Annulus = hole wall (12.25) − casing OD (9.625). */
const OPENHOLE_TOC: Wson = {
  meta: { wellName: 'derived-cement', td: 900 },
  oh: [{ bitSize: 12.25, top: 0, bot: 900 }],
  ch: [{ od: 9.625, id: 8.835, top: 0, bot: 900, type: 'production', cement: { toc: 300 } }],
};

/** A 9⅝" liner hung at 400 m INSIDE a 13⅜" surface casing (shoe 500 m) and
 *  cemented back to its hanger (TOC=400). Below 500 m it is in a 12¼" open hole.
 *  The cement interval [400,900] therefore CROSSES a boundary at the surface shoe:
 *    [400,500]  outer = surface-casing ID 12.615  (cased lap)
 *    [500,900]  outer = open-hole wall   12.25     (open hole)
 *  → 2 segments. */
const CASED_LAP: Wson = {
  meta: { wellName: 'liner-lap', td: 900 },
  oh: [{ bitSize: 12.25, top: 500, bot: 900 }],
  ch: [
    { od: 13.375, id: 12.615, top: 0, bot: 500, type: 'surface' },
    { od: 9.625, id: 8.835, top: 400, bot: 900, type: 'liner', cement: { toc: 400, role: 'primary' } },
  ],
};

const nodesOfType = (g: ReturnType<typeof wsonToGraph>, t: string) =>
  Object.values(g.nodes).filter((n: any) => n.type === t) as any[];
/** All bw_cement Calls, paired with the Mv that places them (offset[2] = top). */
const cementElements = (g: ReturnType<typeof wsonToGraph>) => {
  const mvs = nodesOfType(g, 'mv');
  return nodesOfType(g, 'call')
    .filter((c) => c.src === 'bw_cement')
    .map((call) => ({ call, mv: mvs.find((m) => m.child === call.id) }));
};

// ── Pure derivation ───────────────────────────────────────────────────────────

describe('deriveCementSegments — outer boundary − casing OD, clipped to [TOC, shoe]', () => {
  it('one casing in open hole, TOC partway up → one segment TOC→shoe (od=hole, id=casingOD)', () => {
    const segs = deriveCementSegments(OPENHOLE_TOC);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({
      stringIndex: 0, top: 300, bot: 900, od: 12.25, id: 9.625, against: 'openhole',
    });
  });

  it('tags the segment with its NORSOK annulus letter + barrier role', () => {
    const seg = deriveCementSegments(OPENHOLE_TOC)[0];
    // Sole casing: 'A' is reserved for the (uncemented) tubing↔casing annulus, so
    // cement outside the innermost casing is annulus 'B'.
    expect(seg.annulus).toBe('B');
    expect(seg.role).toBe('primary'); // default when unspecified
  });

  it('SEGMENTS at a cased-lap breakpoint → 2 concentric annuli (open hole vs previous casing ID)', () => {
    const segs = deriveCementSegments(CASED_LAP);
    expect(segs).toHaveLength(2);
    // Shallow segment: inside the surface casing (its ID is the outer wall).
    expect(segs[0]).toMatchObject({ top: 400, bot: 500, od: 12.615, id: 9.625, against: 'casing' });
    // Deep segment: below the surface shoe, in open hole.
    expect(segs[1]).toMatchObject({ top: 500, bot: 900, od: 12.25, id: 9.625, against: 'openhole' });
    // Both belong to the liner and its annulus.
    expect(segs.map((s) => s.stringIndex)).toEqual([1, 1]);
    expect(new Set(segs.map((s) => s.annulus))).toEqual(new Set(['B']));
  });

  it('collapses a breakpoint that does NOT change the outer boundary (adjacent equal-OD merge)', () => {
    // An inner 7" liner hung at 450 m adds a depth breakpoint inside the 9⅝"
    // string's cement interval, but it is radially INSIDE the annulus so the outer
    // wall stays the 12¼" hole across it → the two sub-segments merge back to one.
    const inner: Wson = {
      meta: { wellName: 'merge' },
      oh: [{ bitSize: 12.25, top: 0, bot: 900 }],
      ch: [
        { od: 9.625, id: 8.835, top: 0, bot: 900, cement: { toc: 0 } },
        { od: 7, id: 6.2, top: 450, bot: 900 },
      ],
    };
    const segs = deriveCementSegments(inner);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ top: 0, bot: 900, od: 12.25, id: 9.625 });
  });

  it('STAGE cementing (multi-interval) → one segment per disjoint interval', () => {
    const stage: Wson = {
      meta: { wellName: 'stage' },
      oh: [{ bitSize: 12.25, top: 0, bot: 900 }],
      ch: [{ od: 9.625, id: 8.835, top: 0, bot: 900, cement: { intervals: [{ top: 0, bot: 200 }, { top: 600, bot: 900 }] } }],
    };
    const segs = deriveCementSegments(stage);
    expect(segs).toHaveLength(2);
    expect(segs.map((s) => [s.top, s.bot])).toEqual([[0, 200], [600, 900]]);
  });

  it('DERIVED — re-derives when the casing program changes (open hole → smaller bit)', () => {
    const wider = deriveCementSegments(OPENHOLE_TOC)[0];
    const narrower = deriveCementSegments({
      ...OPENHOLE_TOC, oh: [{ bitSize: 11, top: 0, bot: 900 }],
    })[0];
    expect(wider.od).toBe(12.25);
    expect(narrower.od).toBe(11); // no hand-edited OD to drift
  });

  it('never fabricates a barrier: no TOC + no intervals ⇒ emit nothing (no throw)', () => {
    const noToc: Wson = {
      meta: { wellName: 'no-toc' },
      oh: [{ bitSize: 12.25, top: 0, bot: 900 }],
      ch: [{ od: 9.625, id: 8.835, top: 0, bot: 900, cement: { role: 'none' } }],
    };
    expect(deriveCementSegments(noToc)).toEqual([]);
  });

  it('warns + skips a degenerate annulus (casing wider than its hole) rather than inverting', () => {
    const bad: Wson = {
      meta: { wellName: 'degenerate' },
      oh: [{ bitSize: 8.5, top: 0, bot: 900 }],
      ch: [{ od: 9.625, id: 8.835, top: 0, bot: 900, cement: { toc: 0 } }],
    };
    const warn = vi.fn();
    expect(deriveCementSegments(bad, warn)).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it('a string with no `cement` spec derives NOTHING (additive — existing wells unchanged)', () => {
    const plain: Wson = {
      meta: { wellName: 'plain' },
      oh: [{ bitSize: 12.25, top: 0, bot: 900 }],
      cementing: [{ od: 9.625, top: 0, bot: 900 }], // legacy authored path
      ch: [{ od: 9.625, id: 8.835, top: 0, bot: 900 }],
    };
    expect(deriveCementSegments(plain)).toEqual([]);
  });
});

// ── Emitted graph ─────────────────────────────────────────────────────────────

describe('wsonToGraph — derived cement becomes bw_cement Calls placed down-hole', () => {
  it('emits one bw_cement Call with the annulus od/wall/length + an Mv at the TOC', () => {
    const g = wsonToGraph(OPENHOLE_TOC);
    const cems = cementElements(g);
    expect(cems).toHaveLength(1);
    const { call, mv } = cems[0];
    expect(call.args.od).toEqual({ kind: 'literal', value: 12.25 });
    expect(call.args.wall).toEqual({ kind: 'literal', value: 1.3125 }); // (12.25-9.625)/2
    expect(call.args.length).toEqual({ kind: 'literal', value: 600 });  // 900-300
    // Z-down: placed at the TOC (300 m), NOT at surface.
    expect(mv.offset[2]).toEqual({ kind: 'literal', value: 300 });
    // Annulus letter rides the alias for the editor + WBS.
    expect(call.alias).toMatch(/^CEM_B/);
  });

  it('emits 2 bw_cement Calls for the cased-lap well, outer→inner before the casing', () => {
    const g = wsonToGraph(CASED_LAP);
    const cems = cementElements(g);
    expect(cems).toHaveLength(2);
    const byTop = cems.slice().sort((a, b) => a.mv.offset[2].value - b.mv.offset[2].value);
    expect(byTop.map((c) => c.call.args.od.value)).toEqual([12.615, 12.25]);
    expect(byTop.map((c) => c.mv.offset[2].value)).toEqual([400, 500]);
    // Cement is emitted BEFORE the casing strings (outer → inner).
    const rootKids = (g.nodes[g.root] as any).children.map((id: string) => g.nodes[(g.nodes[id] as any).child].src);
    expect(rootKids.indexOf('bw_cement')).toBeLessThan(rootKids.indexOf('bw_casing'));
    expect(g.imports).toContain('bw_cement');
  });

  it('a well with NO per-string cement emits no derived cement (additive)', () => {
    const plain: Wson = {
      meta: { wellName: 'plain', td: 300 },
      ch: [{ od: 9.625, id: 8.835, top: 0, bot: 300 }],
    };
    expect(cementElements(wsonToGraph(plain))).toHaveLength(0);
  });

  it('the derived-cement graph compiles through emitGraph (rides the real bake path)', () => {
    const r = emitGraph(hydrateGraph(wsonToGraph(CASED_LAP)), { id: 'w_cement' });
    expect(r.errors ?? []).toHaveLength(0);
    expect((r.meta as any).uses).toContain('bw_cement');
    expect(r.body).toContain('bw_cement(');
    expect(r.body).toContain('mv(');
  });
});

// ── Model + lint ──────────────────────────────────────────────────────────────

describe('WSON cement spec — additive + lightly linted', () => {
  it('lints a TOC deeper than the shoe as a warning (not fatal)', () => {
    const bad: Wson = {
      meta: { wellName: 'toc-below-shoe' },
      ch: [{ od: 9.625, top: 0, bot: 500, cement: { toc: 600 } }],
    };
    const issues = lintWson(bad);
    expect(issues.some((i) => i.level === 'warn' && i.path.includes('cement.toc'))).toBe(true);
  });

  it('a clean cement spec lints without error', () => {
    expect(lintWson(OPENHOLE_TOC).filter((i) => i.level === 'error')).toHaveLength(0);
  });
});
