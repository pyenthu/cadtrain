/**
 * wson-to-graph.test — the WSON→graph ladder.
 *
 * Guards the seam that makes a well "just an assembly": the translator must emit
 * a REAL composition graph that `emitGraph` compiles to source calling the `bw_*`
 * volume parts. If this passes, the well rides the same bake path as every other
 * assembly — Manifold/TF, cutaway, and `GraphEditorPane` for free.
 *
 * Headless by design (CLAUDE.md Rule 26): no browser, no volume round-trip.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { emitGraph } from '$lib/graph/composition/composition-emit';
import { hydrateGraph } from '$lib/graph/composition/composition-graph-hydrate';
import { SEGMENTS_PARAM, WsonTranslateError, wsonToGraph } from '../wson-to-graph';
import { parseWson } from '../wson';
import type { Wson } from '../wson';

/** A 9⅝" surface casing, 0→300 m. wall = (9.625 - 8.835) / 2 = 0.395. */
const ONE_CASING: Wson = {
  meta: { wellName: 'rung-1', td: 300 },
  ch: [{ od: 9.625, id: 8.835, top: 0, bot: 300, type: 'surface' }],
};

/** Open hole + cement + casing, the `w_multi_string` relationship: a 9.625"
 *  casing cemented inside a 12.25" hole. `cementing.od` is the CASING it cements
 *  (inner), so the annulus is 9.625 → 12.25, i.e. wall 1.3125. */
const SECTIONED: Wson = {
  meta: { wellName: 'rung-2', td: 900 },
  oh: [{ bitSize: 12.25, top: 0, bot: 900 }],
  cementing: [{ od: 9.625, top: 0, bot: 900 }],
  ch: [{ od: 9.625, id: 8.835, top: 0, bot: 900, type: 'surface' }],
};

const nodesOfType = (g: ReturnType<typeof wsonToGraph>, t: string) =>
  Object.values(g.nodes).filter((n: any) => n.type === t) as any[];
const callBySrc = (g: ReturnType<typeof wsonToGraph>, src: string) =>
  nodesOfType(g, 'call').find((n) => n.src === src);

describe('wsonToGraph — one casing → one bw_casing Call', () => {
  it('emits a list root whose child is the placing Mv, not the raw Call', () => {
    const g = wsonToGraph(ONE_CASING);
    const root: any = g.nodes[g.root];
    expect(root.type).toBe('list');
    expect(root.children).toHaveLength(1);
    const child: any = g.nodes[root.children[0]];
    expect(child.type).toBe('mv');
    expect(g.nodes[child.child]).toMatchObject({ type: 'call', src: 'bw_casing' });
  });

  it('maps od/wall/length off the WSON row', () => {
    const call = callBySrc(wsonToGraph(ONE_CASING), 'bw_casing');
    expect(call.args.od).toEqual({ kind: 'literal', value: 9.625 });
    expect(call.args.wall.value).toBeCloseTo(0.395, 6);
    expect(call.args.length).toEqual({ kind: 'literal', value: 300 });
  });

  it('never passes `top` as an arg — bw_casing declares it but ignores it', () => {
    // Its body hardcodes mv(solid, [0,0,0]); passing top would silently place
    // every string at surface. Placement lives on the Mv node instead.
    expect(callBySrc(wsonToGraph(ONE_CASING), 'bw_casing').args.top).toBeUndefined();
  });

  it('rounds derived dims — no binary-float noise reaches the saved file', () => {
    // (9.625 - 8.835) / 2 === 0.3949999999999996 in IEEE754.
    expect(callBySrc(wsonToGraph(ONE_CASING), 'bw_casing').args.wall.value).toBe(0.395);
  });

  it('wires segments to the assembly param, and declares that param', () => {
    const g = wsonToGraph(ONE_CASING);
    expect(callBySrc(g, 'bw_casing').args.segments).toEqual({ kind: 'param', param: SEGMENTS_PARAM });
    // Without the declaration the emitted body reads `p.segments` off an
    // assembly that has no such param — it emits, and it bakes wrong.
    expect(g.params[SEGMENTS_PARAM]).toMatchObject({ default: 24 });
    expect(g.imports).toContain('bw_casing');
  });

  it('is deterministic — re-translating an unchanged well yields an identical graph', () => {
    expect(wsonToGraph(ONE_CASING)).toEqual(wsonToGraph(ONE_CASING));
  });

  it('omits wall when the row has no id, so bw_casing default applies', () => {
    const call = callBySrc(wsonToGraph({ ...ONE_CASING, ch: [{ od: 7, top: 0, bot: 100 }] }), 'bw_casing');
    expect(call.args.wall).toBeUndefined();
  });
});

describe('wsonToGraph — every structural section becomes a Call', () => {
  it('emits open hole, cement and casing, outer→inner', () => {
    const g = wsonToGraph(SECTIONED);
    const srcs = (g.nodes[g.root] as any).children.map((id: string) => g.nodes[(g.nodes[id] as any).child]);
    expect(srcs.map((n: any) => n.src)).toEqual(['bw_open_hole', 'bw_cement', 'bw_casing']);
    expect(g.imports).toEqual(['bw_open_hole', 'bw_cement', 'bw_casing']);
  });

  it('open hole takes its od from bitSize', () => {
    expect(callBySrc(wsonToGraph(SECTIONED), 'bw_open_hole').args.od.value).toBe(12.25);
  });

  it('builds the cement annulus from the casing OUT to the hole', () => {
    // cementing.od is the casing being cemented (inner); the hole at the
    // interval midpoint is the outer. 9.625 inside 12.25 → od 12.25, wall 1.3125
    // — the value w_multi_string hand-encodes, and what WellSchematic3D draws.
    const cem = callBySrc(wsonToGraph(SECTIONED), 'bw_cement');
    expect(cem.args.od.value).toBe(12.25);
    expect(cem.args.wall.value).toBe(1.3125);
  });

  it('picks the hole at the interval MIDPOINT when the well steps down', () => {
    // 13.375" casing cemented 0→300; hole is 26" over 0-60 and 17.5" over 60-300.
    // Midpoint 150 lands in the 17.5" hole → wall (17.5 - 13.375)/2 = 2.0625.
    const stepped: Wson = {
      meta: { wellName: 'stepped' },
      oh: [{ bitSize: 26, top: 0, bot: 60 }, { bitSize: 17.5, top: 60, bot: 300 }],
      cementing: [{ od: 13.375, top: 0, bot: 300 }],
      ch: [{ od: 13.375, top: 0, bot: 300 }],
    };
    const cem = callBySrc(wsonToGraph(stepped), 'bw_cement');
    expect(cem.args.od.value).toBe(17.5);
    expect(cem.args.wall.value).toBe(2.0625);
  });

  it('falls back to the renderer 1.15x ratio when no open hole covers it', () => {
    const noHole: Wson = { ...SECTIONED, oh: [] };
    const cem = callBySrc(wsonToGraph(noHole), 'bw_cement');
    expect(cem.args.od.value).toBeCloseTo(9.625 * 1.15, 6);
    expect(cem.args.wall.value).toBeCloseTo((9.625 * 1.15 - 9.625) / 2, 6);
  });

  it('throws on a degenerate annulus rather than baking it inside-out', () => {
    const inverted: Wson = {
      meta: { wellName: 'bad' },
      oh: [{ bitSize: 8.5, top: 0, bot: 900 }],
      cementing: [{ od: 9.625, top: 0, bot: 900 }],
    };
    expect(() => wsonToGraph(inverted)).toThrow(/non-positive annulus/);
  });

  it('places each element down-hole by its top depth (Z-down: +z is deeper)', () => {
    const deep: Wson = {
      meta: { wellName: 'deep' },
      ch: [{ od: 9.625, id: 8.835, top: 0, bot: 300 }, { od: 7, id: 6.2, top: 300, bot: 900 }],
    };
    const g = wsonToGraph(deep);
    const zs = nodesOfType(g, 'mv').map((m) => m.offset[2].value).sort((a, b) => a - b);
    expect(zs).toEqual([0, 300]);
    // The 7" liner's length is its own span, not its bottom depth.
    const liner = nodesOfType(g, 'call').find((c) => c.args.od.value === 7);
    expect(liner.args.length.value).toBe(600);
  });
});

describe('wsonToGraph — NO FALLBACK: untranslatable wells throw', () => {
  it('throws when the well has no structural sections', () => {
    expect(() => wsonToGraph({ meta: { wellName: 'x' } })).toThrow(WsonTranslateError);
  });

  it('throws on a non-positive length rather than emitting a degenerate part', () => {
    const bad: Wson = { meta: { wellName: 'x' }, ch: [{ od: 7, top: 500, bot: 500 }] };
    expect(() => wsonToGraph(bad)).toThrow(/non-positive length/);
  });
});

describe('wsonToGraph — the graph is real: it compiles through emitGraph', () => {
  it('emits a complete .asm.ts — meta.params backs every p.<name> the body reads', () => {
    const r = emitGraph(hydrateGraph(wsonToGraph(ONE_CASING)), { id: 'w_rung1' });
    expect(r.errors ?? []).toHaveLength(0);
    expect((r.meta as any).params).toHaveProperty(SEGMENTS_PARAM);
    expect((r.meta as any).uses).toContain('bw_casing');
    expect(r.source).toContain('export function w_rung1(');
    expect(r.body).toContain('bw_casing(');
    expect(r.body).toContain('p.segments');
    expect(r.source).toContain('wall: 0.395');
  });

  it('emits an mv(...) placing each section down-hole', () => {
    const body = emitGraph(hydrateGraph(wsonToGraph(SECTIONED)), { id: 'w_rung2' }).body;
    for (const src of ['bw_open_hole(', 'bw_cement(', 'bw_casing(']) expect(body).toContain(src);
    expect(body).toContain('mv(');
  });

  it('translates a REAL sample well (01-vertical-land-producer)', () => {
    const raw = readFileSync('src/lib/wells/samples/01-vertical-land-producer.wson', 'utf8');
    const { wson } = parseWson(raw);
    const g = wsonToGraph(wson);
    // 3 casing strings + its open holes + cement intervals, each with an Mv.
    expect(nodesOfType(g, 'call').length).toBe(nodesOfType(g, 'mv').length);
    expect(nodesOfType(g, 'call').length).toBeGreaterThanOrEqual(3);
    const r = emitGraph(hydrateGraph(g), { id: 'w_s01' });
    expect(r.errors ?? []).toHaveLength(0);
    expect(r.body).toContain('bw_casing(');
  });
});

describe('wsonToGraph — RUNG 3: a deviated well warps along its survey', () => {
  const sample04 = () => parseWson(
    readFileSync('src/lib/wells/samples/04-horizontal-shale-pnp.wson', 'utf8'),
  ).wson;

  it('emits exactly one spline + one warp, and the root is that warp alone', () => {
    const g = wsonToGraph(sample04());
    expect(nodesOfType(g, 'spline')).toHaveLength(1);
    expect(nodesOfType(g, 'warp')).toHaveLength(1);
    const root: any = g.nodes[g.root];
    const warp = nodesOfType(g, 'warp')[0];
    expect(root.children).toEqual([warp.id]);
  });

  it('warps EVERY element — children length equals the element (Mv) count', () => {
    const g = wsonToGraph(sample04());
    const warp = nodesOfType(g, 'warp')[0];
    const elementCount = nodesOfType(g, 'mv').length; // one Mv per structural section + completion
    expect(elementCount).toBe(14); // 3 open holes + 3 cement + 3 casing + 5 completions (RUNG 5)
    expect(warp.children).toHaveLength(elementCount);
    // Each wired child is an Mv node (the placed element), and the warp bends
    // every one separately along the SAME spline path.
    for (const cid of warp.children) expect(g.nodes[cid]?.type).toBe('mv');
  });

  it('wires the warp path to the spline and pins originZ = 0 (true-station bend)', () => {
    const g = wsonToGraph(sample04());
    const spline = nodesOfType(g, 'spline')[0];
    const warp = nodesOfType(g, 'warp')[0];
    expect(spline.points.length).toBeGreaterThanOrEqual(2);
    expect(warp.path).toEqual({ kind: 'expr', expr: `_x_${spline.id}_path` });
    expect(warp.originZ).toEqual({ kind: 'literal', value: 0 });
    // The spline's control points must actually deviate laterally.
    const maxLateral = Math.max(...spline.points.map((p: number[]) => Math.hypot(p[0], p[1])));
    expect(maxLateral).toBeGreaterThan(1);
  });

  it('compiles through emitGraph — resampleSpline + warpSpline + originZ: 0, no errors', () => {
    const r = emitGraph(hydrateGraph(wsonToGraph(sample04())), { id: 'w_s04' });
    expect(r.errors ?? []).toHaveLength(0);
    expect(r.body).toContain('resampleSpline(');
    expect(r.body).toContain('warpSpline(');
    expect(r.body).toContain('originZ: 0');
    expect(r.body).toContain('bw_casing(');
  });

  it('is deterministic — re-translating the deviated well yields an identical graph', () => {
    expect(wsonToGraph(sample04())).toEqual(wsonToGraph(sample04()));
  });

  it('does NOT warp a vertical well — sample 01 emits no spline/warp', () => {
    const raw = readFileSync('src/lib/wells/samples/01-vertical-land-producer.wson', 'utf8');
    const g = wsonToGraph(parseWson(raw).wson);
    expect(nodesOfType(g, 'spline')).toHaveLength(0);
    expect(nodesOfType(g, 'warp')).toHaveLength(0);
    const root: any = g.nodes[g.root];
    // Root children stay the element Mvs, byte-identical to RUNG 2.
    expect(root.children).toEqual(nodesOfType(g, 'mv').map((m: any) => m.id));
  });

  it('NO FALLBACK: a deviated-flagged survey with < 2 finite stations throws', () => {
    // isDeviated trips (2 stations, dev 5° > 0.5°), but only ONE has a finite MD,
    // so the trajectory cannot be built — surfaced, never emitted straight.
    const flagged: Wson = {
      meta: { wellName: 'fake-dev' },
      ch: [{ od: 7, id: 6.2, top: 0, bot: 1000 }],
      profile: [{ md: 0, dev: 5, az: 0 }, { md: Number.NaN, dev: 5, az: 0 }],
    };
    expect(() => wsonToGraph(flagged)).toThrow(WsonTranslateError);
  });
});

// ─── N2 — the wells SAMPLE LADDER (TODO #42e) ────────────────────────────────
//
// Each rung proves the same seam three ways: (1) `wsonToGraph` translates it,
// (2) `emitGraph`→`hydrateGraph` compiles the emitted source, (3) the graph
// shape is what the rung is meant to isolate. Fixtures live in
// `src/lib/wells/samples/` (bundled by `samples.ts`'s eager glob). S5
// (completions) is owned by the N1 agent; the structural translator does not
// emit completions/perforations yet, so these rungs assert on oh/cement/casing.

/** Read a bundled lib sample by slug (the `src/lib/wells/samples/` set). */
const libSample = (slug: string): Wson =>
  parseWson(readFileSync(`src/lib/wells/samples/${slug}.wson`, 'utf8')).wson;

/** Emit → hydrate → assert the graph compiles to a complete `.asm.ts`. */
const emitOK = (g: ReturnType<typeof wsonToGraph>, id: string) => {
  const r = emitGraph(hydrateGraph(g), { id });
  expect(r.errors ?? []).toHaveLength(0);
  return r;
};

describe('S1 — 10-three-open-holes: hole nesting + Mv depth placement alone', () => {
  const g = () => wsonToGraph(libSample('10-three-open-holes'));

  it('translates 3 telescoping open holes into 3 bw_open_hole Calls (no casing/cement)', () => {
    const calls = nodesOfType(g(), 'call');
    expect(calls.map((c) => c.src)).toEqual(['bw_open_hole', 'bw_open_hole', 'bw_open_hole']);
    expect(g().imports).toEqual(['bw_open_hole']);
  });

  it('each hole takes its od from bitSize, telescoping smaller with depth', () => {
    const ods = nodesOfType(g(), 'call').map((c) => c.args.od.value);
    expect(ods).toEqual([17.5, 12.25, 8.5]);
    // Strictly decreasing — a real telescoped hole nests smaller bits deeper.
    expect(ods[0]).toBeGreaterThan(ods[1]);
    expect(ods[1]).toBeGreaterThan(ods[2]);
  });

  it('places each hole down-hole by its top, with length = its own span (Z-down)', () => {
    const mvs = nodesOfType(g(), 'mv').sort((a, b) => a.offset[2].value - b.offset[2].value);
    expect(mvs.map((m) => m.offset[2].value)).toEqual([0, 300, 800]);
    const lens = nodesOfType(g(), 'call').map((c) => c.args.length.value);
    expect(lens).toEqual([300, 500, 400]); // 0→300, 300→800, 800→1200
  });

  it('is VERTICAL — no spline / warp is emitted', () => {
    expect(nodesOfType(g(), 'spline')).toHaveLength(0);
    expect(nodesOfType(g(), 'warp')).toHaveLength(0);
  });

  it('emits a complete .asm.ts calling bw_open_hole', () => {
    const r = emitOK(g(), 'w_s1_three_oh');
    expect(r.body).toContain('bw_open_hole(');
    expect(r.body).toContain('mv(');
  });
});

describe('S2 — 11-vertical-land-producer: the reference VERTICAL well (SVTC)', () => {
  const wson = () => libSample('11-vertical-land-producer');
  const g = () => wsonToGraph(wson());

  it('is the SVTC vertical file — NO profile key (the S2↔S4 isolation)', () => {
    // The whole point of S2: it must be the truly-vertical SVTC file, not the
    // Desktop 11-station-profile copy. If a profile ever creeps in, S2 becomes
    // deviated and the isolation with S4 collapses.
    expect(wson().profile).toBeUndefined();
  });

  it('translates exactly 3 open holes + 3 cement + 3 casing, outer→inner per group', () => {
    const bySrc = nodesOfType(g(), 'call').map((c) => c.src);
    expect(bySrc.filter((s) => s === 'bw_open_hole')).toHaveLength(3);
    expect(bySrc.filter((s) => s === 'bw_cement')).toHaveLength(3);
    expect(bySrc.filter((s) => s === 'bw_casing')).toHaveLength(3);
    // Emission order: the STRUCTURAL shells first, outer→inner (every open hole,
    // then every cement, then every casing) so a transparent casing renders over
    // its jewelry. The completion string (RUNG 5) follows — assert the structural
    // prefix, not the whole list, so adding jewelry can't break this rung.
    expect(bySrc.slice(0, 9)).toEqual([
      'bw_open_hole', 'bw_open_hole', 'bw_open_hole',
      'bw_cement', 'bw_cement', 'bw_cement',
      'bw_casing', 'bw_casing', 'bw_casing',
    ]);
    // Everything after the structural prefix is the completion string, one Call
    // per WSON row — derived from the fixture, never a magic number.
    expect(bySrc.slice(9)).toHaveLength(wson().completions?.length ?? 0);
    expect(nodesOfType(g(), 'call')).toHaveLength(nodesOfType(g(), 'mv').length);
  });

  it('builds the production-string cement annulus from the 9⅝" casing OUT to the 12¼" hole', () => {
    // cementing[2] = { od: 9.625, top: 700, bot: 1070 }; midpoint 885 sits in the
    // 12.25" hole (300→1070) → od 12.25, wall (12.25-9.625)/2 = 1.3125.
    const cem = nodesOfType(g(), 'call').filter((c) => c.src === 'bw_cement');
    const prod = cem.find((c) => c.args.od.value === 12.25);
    expect(prod).toBeDefined();
    expect(prod.args.wall.value).toBe(1.3125);
  });

  it('is VERTICAL — no spline / warp', () => {
    expect(nodesOfType(g(), 'spline')).toHaveLength(0);
    expect(nodesOfType(g(), 'warp')).toHaveLength(0);
  });

  it('emits a complete .asm.ts (oh + cement + casing, all placed by mv)', () => {
    const r = emitOK(g(), 'w_s2_vertical');
    for (const src of ['bw_open_hole(', 'bw_cement(', 'bw_casing(']) expect(r.body).toContain(src);
    expect(r.body).toContain('mv(');
    expect(r.body).not.toContain('warpSpline(');
  });
});

describe('S3 — negative: a hole NARROWER than its casing must throw (cementDims guard)', () => {
  // The guard is the point. A production casing cemented inside a hole SMALLER
  // than the casing itself is a degenerate (inside-out) annulus; cementDims must
  // surface it, never bake it. NO FALLBACK.
  it('throws WsonTranslateError when the hole od < the cemented casing od', () => {
    const inverted: Wson = {
      meta: { wellName: 'S3 inverted annulus' },
      oh: [{ bitSize: 8.5, top: 0, bot: 900 }],          // 8.5" hole …
      cementing: [{ od: 9.625, top: 0, bot: 900 }],      // … around a 9.625" casing
      ch: [{ od: 9.625, id: 8.681, top: 0, bot: 900, type: 'production' }],
    };
    expect(() => wsonToGraph(inverted)).toThrow(WsonTranslateError);
    expect(() => wsonToGraph(inverted)).toThrow(/non-positive annulus/);
  });

  it('the SAME well with a wider (12¼") hole translates cleanly — proves the guard is the only failure', () => {
    const ok: Wson = {
      meta: { wellName: 'S3 valid annulus' },
      oh: [{ bitSize: 12.25, top: 0, bot: 900 }],
      cementing: [{ od: 9.625, top: 0, bot: 900 }],
      ch: [{ od: 9.625, id: 8.681, top: 0, bot: 900, type: 'production' }],
    };
    const cem = callBySrc(wsonToGraph(ok), 'bw_cement');
    expect(cem.args.od.value).toBe(12.25);
    expect(cem.args.wall.value).toBe(1.3125);
  });
});

describe('S4 — 13-vertical-land-producer-deviated: the SAME well + one profile key', () => {
  const wson = () => libSample('13-vertical-land-producer-deviated');
  const g = () => wsonToGraph(wson());

  it('carries an 11-station J-profile building to 38° — deviated by the ONE added key', () => {
    const prof = wson().profile!;
    expect(prof).toHaveLength(11);
    expect(Math.max(...prof.map((s) => s.dev))).toBe(38);
  });

  it('S2↔S4 isolation: identical oh/ch/cementing, differing ONLY in `profile`', () => {
    // The isolation this rung exists for: vertical-vs-deviated is exactly the
    // presence of `profile[]`, nothing else. Strip it from S4 → byte-identical S2.
    const s2 = libSample('11-vertical-land-producer');
    const s4 = wson();
    expect(s4.oh).toEqual(s2.oh);
    expect(s4.ch).toEqual(s2.ch);
    expect(s4.cementing).toEqual(s2.cementing);
    expect(s2.profile).toBeUndefined();
    expect(s4.profile).toBeDefined();
  });

  it('emits exactly one spline + one warp; the root is that warp alone', () => {
    const graph = g();
    expect(nodesOfType(graph, 'spline')).toHaveLength(1);
    expect(nodesOfType(graph, 'warp')).toHaveLength(1);
    const warp = nodesOfType(graph, 'warp')[0];
    expect((graph.nodes[graph.root] as any).children).toEqual([warp.id]);
  });

  it('warps EVERY element — structural AND completion jewelry — along ONE spline', () => {
    const graph = g();
    const warp = nodesOfType(graph, 'warp')[0];
    // 9 structural (3 oh + 3 cement + 3 casing) + one per completion row. Derived
    // from the fixture: a deviated well must bend its tubing string with its
    // casing, so the completion count belongs in this total, not outside it.
    const structural = 9;
    const expected = structural + (wson().completions?.length ?? 0);
    expect(nodesOfType(graph, 'mv')).toHaveLength(expected);
    expect(warp.children).toHaveLength(expected);
    for (const cid of warp.children) expect(graph.nodes[cid]?.type).toBe('mv');
    // The jewelry is genuinely inside the warp, not merely present in the graph.
    const warpedSrc = warp.children.map((cid: string) => graph.nodes[(graph.nodes[cid] as any).child]?.src);
    expect(warpedSrc).toContain('bw_prod_tubing');
    expect(warpedSrc).toContain('bw_packer');
    // originZ = 0 → each element bends at its TRUE station.
    expect(warp.originZ).toEqual({ kind: 'literal', value: 0 });
  });

  it('the spline actually deviates laterally (the survey builds to 38°)', () => {
    const spline = nodesOfType(g(), 'spline')[0];
    const maxLateral = Math.max(...spline.points.map((p: number[]) => Math.hypot(p[0], p[1])));
    expect(maxLateral).toBeGreaterThan(1);
  });

  it('compiles through emitGraph — resampleSpline + warpSpline + originZ: 0', () => {
    const r = emitOK(g(), 'w_s4_deviated');
    expect(r.body).toContain('resampleSpline(');
    expect(r.body).toContain('warpSpline(');
    expect(r.body).toContain('originZ: 0');
    expect(r.body).toContain('bw_casing(');
  });

  it('is deterministic — re-translating the deviated well is byte-identical', () => {
    expect(g()).toEqual(g());
  });
});

describe('wsonToGraph — RUNG 5: completions become bw_* Calls placed by depth', () => {
  const sample01 = () => parseWson(
    readFileSync('src/lib/wells/samples/01-vertical-land-producer.wson', 'utf8'),
  ).wson;

  /** One casing + one completion — the minimal well for a mapping assertion. */
  const withComp = (c: Wson['completions']): Wson => ({
    meta: { wellName: 'c' },
    ch: [{ od: 9.625, id: 8.681, top: 0, bot: 1000, type: 'production' }],
    completions: c,
  });

  it('emits one bw_* Call+Mv per completion, INSIDE the casing (outer→inner order)', () => {
    const g = wsonToGraph(sample01());
    const outputs = (g.nodes[g.root] as any).children.map((id: string) => g.nodes[(g.nodes[id] as any).child]);
    // 3 oh + 3 cement + 3 casing, THEN the 7-item completion string — the
    // structural shells first so a transparent casing renders over its jewelry.
    expect(outputs.map((n: any) => n.src)).toEqual([
      'bw_open_hole', 'bw_open_hole', 'bw_open_hole',
      'bw_cement', 'bw_cement', 'bw_cement',
      'bw_casing', 'bw_casing', 'bw_casing',
      'bw_hanger', 'bw_prod_tubing', 'bw_nipple', 'bw_prod_tubing',
      'bw_packer', 'bw_prod_tubing', 'bw_mule_shoe',
    ]);
  });

  it('maps each tool_comp code to its bw_* part via the explicit map — od + length off the row', () => {
    const cases: Array<[string, string]> = [
      ['tbgHanger', 'bw_hanger'],
      ['MISC.TUBING', 'bw_prod_tubing'],
      ['MISC.TUBING_PUP', 'bw_prod_tubing'],
      ['FLOW_CONTROL.NIPPLE_R_LANDING', 'bw_nipple'],
      ['MISC.MULE_SHOE', 'bw_mule_shoe'],
      ['PACKERS.PACKER_BAKER_PERMANENT', 'bw_packer'],
    ];
    for (const [code, part] of cases) {
      const g = wsonToGraph(withComp([{ tool_comp: code, od: 2.875, top: 0, bot: 30 }]));
      const comp = callBySrc(g, part);
      expect(comp, `${code} → ${part}`).toBeTruthy();
      expect(comp.args.od).toEqual({ kind: 'literal', value: 2.875 });
      expect(comp.args.length).toEqual({ kind: 'literal', value: 30 });
    }
  });

  it('resolves completion depth through the autoTop chain BEFORE the Mv (manual holds, auto resumes)', () => {
    const g = wsonToGraph(withComp([
      { tool_comp: 'MISC.TUBING', od: 2.875, top: 0, bot: 10 },                              // auto (first) → 0..10
      { tool_comp: 'FLOW_CONTROL.NIPPLE_R_LANDING', od: 2.875, top: 500, bot: 503, autoTop: false }, // manual → holds 500
      { tool_comp: 'MISC.MULE_SHOE', od: 2.875, top: 0, bot: 2 },                             // auto → resumes 503..505
    ]));
    const mvZ = (alias: string) => {
      const call = nodesOfType(g, 'call').find((n) => n.alias === alias);
      return nodesOfType(g, 'mv').find((m) => m.child === call.id).offset[2].value;
    };
    expect(mvZ('COMP_1')).toBe(0);
    expect(mvZ('COMP_2')).toBe(500);   // manual anchor held, NOT snapped to the tubing bot (10)
    expect(mvZ('COMP_3')).toBe(503);   // auto resumed from the manual item's bot
    // COMP_3's length is its own span (505 - 503), not its absolute depth.
    expect(nodesOfType(g, 'call').find((n) => n.alias === 'COMP_3').args.length.value).toBe(2);
  });

  it('NO FALLBACK: an unmapped tool_comp throws naming the code + index', () => {
    const w = withComp([
      { tool_comp: 'MISC.TUBING', od: 2.875, top: 0, bot: 10 },
      { tool_comp: 'MISC.SIDE_POCKET_MANDREL', od: 4, top: 10, bot: 20 }, // no bw_* part exists
    ]);
    expect(() => wsonToGraph(w)).toThrow(WsonTranslateError);
    expect(() => wsonToGraph(w)).toThrow(/completion 1 has an unmapped tool_comp "MISC.SIDE_POCKET_MANDREL"/);
  });

  it('NO FALLBACK: a missing/empty tool_comp throws naming the index (real reports carry these)', () => {
    // The xlsxtowson completion reports have rows with NO tool_comp at all.
    const w = withComp([
      { tool_comp: 'MISC.TUBING', od: 2.875, top: 0, bot: 10 },
      { tool_comp: '', od: 3.5, top: 10, bot: 20 },                 // empty → index 1
      { tool_comp: 'MISC.MULE_SHOE', od: 2.875, top: 20, bot: 22 },
    ]);
    expect(() => wsonToGraph(w)).toThrow(/completion 1 has a missing\/empty tool_comp/);
  });

  it('SKIPS perforations — no bw_* perf part, so none are emitted (reported gap, not invented)', () => {
    const g = wsonToGraph({
      meta: { wellName: 'perf' },
      ch: [{ od: 9.625, id: 8.681, top: 0, bot: 1000, type: 'production' }],
      perforations: [{ top: 900, bot: 950, label: 'zone' }],
    });
    // Only the casing Call — the perforation adds no Call (no stand-in part).
    expect(nodesOfType(g, 'call').map((n) => n.src)).toEqual(['bw_casing']);
  });

  it('the completion string compiles through emitGraph — bw_* completion Calls, no errors', () => {
    const r = emitGraph(hydrateGraph(wsonToGraph(sample01())), { id: 'w_s01c' });
    expect(r.errors ?? []).toHaveLength(0);
    for (const src of ['bw_hanger(', 'bw_prod_tubing(', 'bw_nipple(', 'bw_packer(', 'bw_mule_shoe(']) {
      expect(r.body).toContain(src);
    }
    expect((r.meta as any).uses).toContain('bw_nipple');
  });

  it('is deterministic — re-translating the completion string yields an identical graph', () => {
    expect(wsonToGraph(sample01())).toEqual(wsonToGraph(sample01()));
  });
});

// ─── Mixed-unit guard: AXIAL params must be supplied in metres ────────────────
//
// The well is authored radially in INCHES (`od`) and axially in METRES (`length`,
// `Mv` depth), while every `bw_*` part's defaults are authored in inches. So an
// axial param the translator forgets to pass keeps an inch number in a metre
// scene. Measured on `bw_packer`: `{od, length: 0.5}` alone baked a 6.0-long
// packer with genus -1 (its 6-inch-default seal band overshot the 0.5 body at
// both ends and split the solid). Radial params may safely default.
describe('completion args — axial params are passed in the row unit', () => {
  const packerWell = (lengthM: number): Wson => ({
    meta: { wellName: 'p' },
    ch: [{ od: 9.625, id: 8.681, top: 0, bot: 1000, type: 'production' }],
    completions: [{ tool_comp: 'PACKERS.PACKER_BAKER_PERMANENT', od: 8.681, top: 10, bot: 10 + lengthM }],
  });

  it('bw_packer receives seal_len in METRES, scaled to the row length', () => {
    const g = wsonToGraph(packerWell(0.5));
    const packer = callBySrc(g, 'bw_packer');
    expect(packer).toBeTruthy();
    // 6/24 of the body length — the part's own authored proportion.
    expect(packer!.args.seal_len.value).toBeCloseTo(0.5 * (6 / 24), 6);
    // The seal must never exceed the body, or the solid splits in two.
    expect(packer!.args.seal_len.value).toBeLessThan(packer!.args.length.value);
  });

  it('seal_len tracks length — a 5 m packer gets a 5x bigger seal', () => {
    const a = callBySrc(wsonToGraph(packerWell(0.5)), 'bw_packer')!.args.seal_len.value;
    const b = callBySrc(wsonToGraph(packerWell(2.5)), 'bw_packer')!.args.seal_len.value;
    expect(b / a).toBeCloseTo(5, 6);
  });

  it('seal_od is RADIAL — stays in inches, proportional to od', () => {
    const p = callBySrc(wsonToGraph(packerWell(0.5)), 'bw_packer')!;
    expect(p.args.seal_od.value).toBeCloseTo(8.681 * (9.5 / 8.681), 6);
    expect(p.args.seal_od.value).toBeGreaterThan(p.args.od.value); // seal protrudes
  });

  it('parts with no extra axial params are untouched (od + length only)', () => {
    const g = wsonToGraph({
      meta: { wellName: 'n' },
      ch: [{ od: 9.625, id: 8.681, top: 0, bot: 1000, type: 'production' }],
      completions: [{ tool_comp: 'MISC.MULE_SHOE', od: 2.875, top: 10, bot: 10.2 }],
    } as Wson);
    expect(Object.keys(callBySrc(g, 'bw_mule_shoe')!.args).sort()).toEqual(['length', 'od']);
  });
});
