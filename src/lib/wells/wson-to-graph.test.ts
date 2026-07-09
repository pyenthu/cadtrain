/**
 * wson-to-graph.test — rung 1 of the WSON→graph ladder.
 *
 * Guards the seam that makes a well "just an assembly": the translator must emit
 * a REAL composition graph that `emitGraph` compiles to source calling the
 * `bw_casing` volume part. If this passes, the well rides the same bake path as
 * every other assembly — Manifold/TF, cutaway, and `GraphEditorPane` for free.
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
const WELL: Wson = {
  meta: { wellName: 'rung-1', td: 300 },
  ch: [{ od: 9.625, id: 8.835, top: 0, bot: 300, type: 'surface' }],
};

const callNode = (g: ReturnType<typeof wsonToGraph>) =>
  Object.values(g.nodes).find((n: any) => n.type === 'call') as any;

describe('wsonToGraph — rung 1: one casing → one bw_casing Call', () => {
  it('emits a list root whose only child is the casing Call', () => {
    const g = wsonToGraph(WELL);
    const root: any = g.nodes[g.root];
    expect(root.type).toBe('list');
    expect(root.children).toHaveLength(1);
    expect(g.nodes[root.children[0]]).toMatchObject({ type: 'call', src: 'bw_casing' });
  });

  it('maps od/wall/length/top off the WSON row', () => {
    const call = callNode(wsonToGraph(WELL));
    expect(call.args.od).toEqual({ kind: 'literal', value: 9.625 });
    // wall is DERIVED from od/id, via the one existing resolveStructural policy.
    expect(call.args.wall.value).toBeCloseTo(0.395, 6);
    expect(call.args.length).toEqual({ kind: 'literal', value: 300 });
    expect(call.args.top).toEqual({ kind: 'literal', value: 0 });
  });

  it('rounds derived dims — no binary-float noise reaches the saved file', () => {
    // (9.625 - 8.835) / 2 === 0.3949999999999996 in IEEE754.
    expect(callNode(wsonToGraph(WELL)).args.wall.value).toBe(0.395);
  });

  it('declares the segments param it wires to, and imports bw_casing', () => {
    // Without this the emitted body reads `p.segments` off an assembly that has
    // no such param — it emitted, and it would have baked wrong.
    const g = wsonToGraph(WELL);
    expect(g.params[SEGMENTS_PARAM]).toMatchObject({ default: 24 });
    expect(g.imports).toContain('bw_casing');
  });

  it('wires segments to the assembly param, not a baked literal', () => {
    const call = callNode(wsonToGraph(WELL));
    expect(call.args.segments).toEqual({ kind: 'param', param: SEGMENTS_PARAM });
  });

  it('is deterministic — re-translating an unchanged well yields an identical graph', () => {
    expect(wsonToGraph(WELL)).toEqual(wsonToGraph(WELL));
  });

  it('omits wall when the row has no id, so bw_casing default applies', () => {
    const call = callNode(wsonToGraph({ ...WELL, ch: [{ od: 7, top: 0, bot: 100 }] }));
    expect(call.args.wall).toBeUndefined();
    expect(call.args.od.value).toBe(7);
  });

  it('selects the requested casing row', () => {
    const two: Wson = { ...WELL, ch: [WELL.ch![0], { od: 7, id: 6.2, top: 300, bot: 900 }] };
    const call = callNode(wsonToGraph(two, { casingIndex: 1 }));
    expect(call.args.od.value).toBe(7);
    expect(call.args.top.value).toBe(300);
    expect(call.args.length.value).toBe(600);
    expect(call.alias).toBe('CSG_2');
  });
});

describe('wsonToGraph — NO FALLBACK: untranslatable wells throw', () => {
  it('throws when the well has no casing strings', () => {
    expect(() => wsonToGraph({ meta: { wellName: 'x' } })).toThrow(WsonTranslateError);
  });

  it('throws on an out-of-range casingIndex', () => {
    expect(() => wsonToGraph(WELL, { casingIndex: 5 })).toThrow(/out of range/);
  });

  it('throws on a non-positive length rather than emitting a degenerate part', () => {
    const bad: Wson = { ...WELL, ch: [{ od: 7, top: 500, bot: 500 }] };
    expect(() => wsonToGraph(bad)).toThrow(/non-positive length/);
  });
});

describe('wsonToGraph — the graph is real: it compiles through emitGraph', () => {
  it('emits a body that calls bw_casing with the row dimensions', () => {
    const body = emitGraph(hydrateGraph(wsonToGraph(WELL)), { id: 'w_rung1' }).body;
    expect(body).toContain('bw_casing(');
    expect(body).toContain('9.625');
    // segments arrives as the assembly param, i.e. `p.segments`, not a literal.
    expect(body).toContain('p.segments');
  });

  it('emits a complete .asm.ts — meta.params backs every p.<name> the body reads', () => {
    const r = emitGraph(hydrateGraph(wsonToGraph(WELL)), { id: 'w_rung1' });
    expect(r.errors ?? []).toHaveLength(0);
    expect((r.meta as any).params).toHaveProperty(SEGMENTS_PARAM);
    expect((r.meta as any).uses).toContain('bw_casing');
    expect(r.source).toContain('export function w_rung1(');
    // Bake-verified 2026-07-09 via /api/primitives/preview: 300 verts,
    // z 0..300, outer-r 4.8125 (= od/2), cutVC present.
    expect(r.source).toContain('wall: 0.395');
  });

  it('translates a REAL sample well (01-vertical-land-producer)', () => {
    const raw = readFileSync('src/routes/wells/samples/01-vertical-land-producer.wson', 'utf8');
    const { wson } = parseWson(raw);
    const call = callNode(wsonToGraph(wson));
    // First ch row is the 20" conductor, 0→60 m.
    expect(call.args.od.value).toBe(20);
    expect(call.args.length.value).toBe(60);
    expect(emitGraph(hydrateGraph(wsonToGraph(wson)), { id: 'w_s01' }).body).toContain('bw_casing(');
  });
});
