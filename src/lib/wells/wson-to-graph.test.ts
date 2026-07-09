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
import { emitGraph } from '$lib/cad/composition-emit';
import { hydrateGraph } from '$lib/cad/composition-graph-hydrate';
import { SEGMENTS_PARAM, WsonTranslateError, wsonToGraph } from './wson-to-graph';
import { parseWson } from './wson';
import type { Wson } from './wson';

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
    const raw = readFileSync('src/routes/wells/samples/01-vertical-land-producer.wson', 'utf8');
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
