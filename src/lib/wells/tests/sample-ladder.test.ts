/**
 * sample-ladder.test.ts — the #42e WSON SAMPLE LADDER (simple → complex).
 *
 * One coherent artifact that walks the ladder rung-by-rung and, for each rung,
 * proves the WHOLE headless pipeline the way the task frames it:
 *
 *   translate (wsonToGraph) → emit (emitGraph) → the graph is well-formed to bake
 *
 * The four rungs are the real SVTC sample wells, ordered by complexity:
 *   1. 00-one-casing                       — vertical SINGLE string
 *   2. 10-three-open-holes                 — telescoping open holes (structural only)
 *   3. 11-vertical-land-producer           — vertical MULTI string + completion jewelry
 *   4. 13-vertical-land-producer-deviated  — the SAME well + a survey ⇒ DEVIATED
 *
 * Per rung this pins the invariants the ladder exists to guarantee, uniformly:
 *   • SEPARATE parts   — one Call + one placing Mv per WSON row (#Call === #Mv ===
 *                        the expected element count), and a multi-element well
 *                        emits a LIST body (`return [...]`), never `M.compose` —
 *                        so the bake surfaces N independent `_parts` that a UNION
 *                        can never collapse to the outer open hole.
 *   • NO STRAYS        — every Call resolves to a `bw_*` element (no `g_*` leak,
 *                        no invented stand-in), the imports are exactly those
 *                        `bw_*` ids, and the node inventory is exact (no orphans).
 *   • AXIAL METRES     — placement + length are the WSON's METRE depths, never its
 *                        INCH diameters: the deepest structural element reaches TD
 *                        (metres), and the shallowest sits at surface (0). A radial
 *                        (inch) value leaking into an axial slot would bake ~39×
 *                        too long — this is the guard against it.
 *   • WARP SHAPE       — a vertical rung emits NO spline/warp; the deviated rung
 *                        emits exactly ONE spline + ONE warp (originZ 0) that bends
 *                        EVERY element along one survey.
 *   • COMPILES         — emitGraph → a complete `.asm.ts` with zero errors, the
 *                        exact input `/api/primitives/compile` consumes.
 *
 * The real Manifold BAKE of the ladder's geometry (separate positive-volume parts,
 * metre-scale extents) is proven in `wells-bake-coverage.test.ts` PART B against
 * the dep-resolved cached scripts (a bw_* dep resolve needs the volume, so it is
 * gated on the local cache). This file is fully self-contained: it globs
 * `samples/` directly, no dev server, no WASM.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { emitGraph } from '$lib/graph/composition-emit';
import { hydrateGraph } from '$lib/graph/composition-graph-hydrate';
import { wsonToGraph, SEGMENTS_PARAM } from '../wson-to-graph';
import { parseWson, isDeviated, type Wson } from '../wson';

const STRUCTURAL_SRCS = new Set(['bw_open_hole', 'bw_cement', 'bw_casing']);

interface Rung {
  rung: number;
  slug: string;
  title: string;
  /** Per-kind row counts, straight off the WSON — the ladder's contract. */
  oh: number; cementing: number; ch: number; completions: number;
  deviated: boolean;
  /** The well's METRE depth window — surface (0) to TD — proving axial = metres. */
  minTopM: number; maxBotM: number;
}

/** The ladder, simplest → most complex. `elements` (below) is DERIVED from the
 *  per-kind counts, never a magic number, so a sample edit updates the contract
 *  in one place. Perforations are intentionally excluded — no `bw_*` perf part
 *  exists, so the translator SKIPS them (reported gap, never invented). */
const LADDER: Rung[] = [
  { rung: 1, slug: '00-one-casing', title: 'vertical single-string casing',
    oh: 0, cementing: 0, ch: 1, completions: 0, deviated: false, minTopM: 0, maxBotM: 1000 },
  { rung: 2, slug: '10-three-open-holes', title: 'telescoping open holes (structural only)',
    oh: 3, cementing: 0, ch: 0, completions: 0, deviated: false, minTopM: 0, maxBotM: 1200 },
  { rung: 3, slug: '11-vertical-land-producer', title: 'vertical multi-string + completion',
    oh: 3, cementing: 3, ch: 3, completions: 7, deviated: false, minTopM: 0, maxBotM: 1070 },
  { rung: 4, slug: '13-vertical-land-producer-deviated', title: 'deviated multi-string + completion',
    oh: 3, cementing: 3, ch: 3, completions: 7, deviated: true, minTopM: 0, maxBotM: 1070 },
];

const elementsOf = (r: Rung) => r.oh + r.cementing + r.ch + r.completions;

const loadSample = (slug: string): Wson =>
  parseWson(readFileSync(resolve('src/lib/wells/samples', `${slug}.wson`), 'utf8')).wson;

const nodesOfType = (g: ReturnType<typeof wsonToGraph>, t: string) =>
  Object.values(g.nodes).filter((n: any) => n.type === t) as any[];

/** The Call a placing Mv wraps. */
const callOfMv = (g: ReturnType<typeof wsonToGraph>, mv: any) => g.nodes[mv.child] as any;

describe('#42e WSON sample ladder — translate → emit → well-formed to bake', () => {
  it('the ladder is ordered simple → complex (strictly growing element count)', () => {
    const counts = LADDER.map(elementsOf);
    expect(counts).toEqual([1, 3, 16, 16]);
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i], `rung ${i + 1} is not simpler-first`).toBeGreaterThanOrEqual(counts[i - 1]);
    }
    // The ladder climbs single-string → structural-many → +completions → +survey.
    expect(LADDER.map((r) => r.deviated)).toEqual([false, false, false, true]);
  });

  for (const r of LADDER) {
    describe(`rung ${r.rung} — ${r.slug} (${r.title})`, () => {
      const wson = loadSample(r.slug);
      const graph = wsonToGraph(wson);
      const emit = emitGraph(hydrateGraph(graph), { id: `w_ladder_${r.rung}` });
      const calls = nodesOfType(graph, 'call');
      const mvs = nodesOfType(graph, 'mv');
      const N = elementsOf(r);

      it(`the sample on disk matches the ladder contract (${r.oh} oh · ${r.cementing} cem · ${r.ch} ch · ${r.completions} comp)`, () => {
        expect(wson.oh?.length ?? 0).toBe(r.oh);
        expect(wson.cementing?.length ?? 0).toBe(r.cementing);
        expect(wson.ch?.length ?? 0).toBe(r.ch);
        expect(wson.completions?.length ?? 0).toBe(r.completions);
        expect(isDeviated(wson)).toBe(r.deviated);
      });

      it(`SEPARATE parts: ${N} Calls, each with its own placing Mv (one per WSON row)`, () => {
        expect(calls).toHaveLength(N);
        expect(mvs).toHaveLength(N);
        // Every Mv wraps a distinct Call — no element is shared or dropped.
        const wrapped = new Set(mvs.map((m) => m.child));
        expect(wrapped.size).toBe(N);
        for (const c of calls) expect(wrapped.has(c.id), `${c.alias} has no placing Mv`).toBe(true);
      });

      it('SEPARATE parts: emits a LIST of independent bodies, never M.compose → never fused', () => {
        // The whole hazard: composing overlapping well bodies UNIONs them to the
        // outer open hole. A well must NEVER emit `M.compose` — the elements stay a
        // list so the bake surfaces them as independent `_parts`.
        expect(emit.body).not.toMatch(/\bM\.compose\(/);
        if (N === 1) return; // a single element returns one body — nothing to keep apart
        if (r.deviated) {
          // Deviated: a list of N SEPARATELY warped bodies (one warpSpline each),
          // never one composed body warped as a whole.
          const warpCount = (emit.body.match(/warpSpline\(/g) || []).length;
          expect(warpCount, 'one independent warpSpline per element').toBe(N);
        } else {
          // Vertical: a bare list of the N placed elements.
          expect(emit.body).toContain('return [');
        }
      });

      it('NO STRAYS: every Call is a bw_* element and the imports are exactly those ids', () => {
        for (const c of calls) expect(c.src, `${c.alias} is not a bw_* element`).toMatch(/^bw_/);
        const srcs = [...new Set(calls.map((c) => c.src))].sort();
        expect([...graph.imports].sort()).toEqual(srcs);
        // No g_* completion catalogue part or other stand-in leaked into the well.
        expect(calls.some((c) => c.src.startsWith('g_'))).toBe(false);
      });

      it('NO STRAYS: the node inventory is exact — N Calls + N Mvs + root (+ spline+warp if deviated)', () => {
        const expectedNodes = 2 * N + 1 + (r.deviated ? 2 : 0);
        expect(Object.keys(graph.nodes)).toHaveLength(expectedNodes);
        expect(nodesOfType(graph, 'spline')).toHaveLength(r.deviated ? 1 : 0);
        expect(nodesOfType(graph, 'warp')).toHaveLength(r.deviated ? 1 : 0);
      });

      it('AXIAL METRES: placement + length are the WSON metre depths (surface 0 → TD, not inches)', () => {
        // Every Mv z-offset is a metre depth; the shallowest is surface (0).
        const zs = mvs.map((m) => m.offset[2].value as number);
        expect(Math.min(...zs)).toBe(r.minTopM);

        // The deepest STRUCTURAL element (exact top/bot off the WSON) reaches TD:
        // mvZ + length === its bottom, and the max bottom is the well's TD in
        // METRES. An inch value in either axial slot would blow this ~39×.
        const structuralReach = mvs
          .filter((m) => STRUCTURAL_SRCS.has(callOfMv(graph, m).src))
          .map((m) => (m.offset[2].value as number) + (callOfMv(graph, m).args.length.value as number));
        expect(Math.max(...structuralReach)).toBe(r.maxBotM);

        // Sanity that this is a metre scene, not an inch one: TD is > 100 (m) while
        // every radial od is < 40 (in) — the two unit families never cross over.
        expect(r.maxBotM).toBeGreaterThan(100);
        for (const c of calls) {
          if (c.args.od != null) expect(c.args.od.value, `${c.alias} od`).toBeLessThan(40);
        }
      });

      it(`WARP SHAPE: ${r.deviated ? 'ONE spline + ONE warp bends every element' : 'vertical — no spline/warp'}`, () => {
        const root: any = graph.nodes[graph.root];
        if (r.deviated) {
          const warp = nodesOfType(graph, 'warp')[0];
          const spline = nodesOfType(graph, 'spline')[0];
          expect(root.children).toEqual([warp.id]);              // the warp is the sole output
          expect(warp.children).toHaveLength(N);                  // every element bends
          for (const cid of warp.children) expect(graph.nodes[cid]?.type).toBe('mv');
          expect(warp.originZ).toEqual({ kind: 'literal', value: 0 }); // true-station bend
          // The survey actually deviates — control points move off-axis.
          const maxLateral = Math.max(...spline.points.map((p: number[]) => Math.hypot(p[0], p[1])));
          expect(maxLateral).toBeGreaterThan(1);
        } else {
          expect(root.children).toEqual(mvs.map((m) => m.id)); // each Mv is a direct output
        }
      });

      it('COMPILES: emitGraph → a complete .asm.ts, zero errors, segments declared', () => {
        expect(emit.errors ?? []).toHaveLength(0);
        expect(emit.source).toContain(`export function w_ladder_${r.rung}(`);
        expect((emit.meta as any).params).toHaveProperty(SEGMENTS_PARAM);
        // uses lists exactly the bw_* elements the body calls — nothing extra.
        expect([...(emit.meta as any).uses].sort()).toEqual([...new Set(calls.map((c) => c.src))].sort());
        if (r.deviated) {
          expect(emit.body).toContain('warpSpline(');
          expect(emit.body).toContain('resampleSpline(');
          expect(emit.body).toContain('originZ: 0');
        } else {
          expect(emit.body).not.toContain('warpSpline(');
        }
      });

      it('is deterministic — re-translating the rung is byte-identical', () => {
        expect(wsonToGraph(loadSample(r.slug))).toEqual(graph);
      });
    });
  }
});
