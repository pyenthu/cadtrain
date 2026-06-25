/**
 * sketch-repeat.test.ts — the load-bearing correctness seam for B.2 (#805).
 *
 * Locks the TWO sketch-repeat expansion sites together:
 *  - PURE: a hand-unrolled ops list and the repeat-expanded one must
 *    `compileSketch` to byte-identical `(r,z)`;
 *  - EMIT: the emitted `...Array.from(...).flat()` source, sandbox-evaluated,
 *    must yield the SAME numeric ops as `expandSketchOps`.
 */
import { describe, expect, it } from 'vitest';
import { expandSketchOps, type EvalArg } from './sketch-repeat';
import { compileSketch, type SketchOp } from './sketch';
import { asLiteral, asExpr, newGraph } from './composition-graph';
import { addSketch, addSketchRepeat, setSketchRepeatAdvance, setSketchRepeatCount } from './composition-graph';
import { emitGraph } from './composition-emit';
import type { SketchOpEntry, SketchRepeatNode, SketchRepeatRef, NodeId } from './composition-graph-types';

// Local evalArg mirroring the editor's (literal | param | expr with `with(p)`).
const evalArg: EvalArg = (a: any, p) => {
  if (!a) return 0;
  if (a.kind === 'literal') return Number(a.value) || 0;
  if (a.kind === 'param') return Number(p[a.param] ?? 0);
  try { return Number(new Function('p', `with(p){ return (${String(a.expr)}); }`)(p)) || 0; } catch { return 0; }
};

const L = asLiteral;
const lookupFrom = (...nodes: SketchRepeatNode[]) =>
  (id: NodeId) => nodes.find((n) => n.id === id);

describe('expandSketchOps — pure', () => {
  it('no repeat-ref ⇒ same numeric ops as a plain resolve (byte-identical path)', () => {
    const ops: SketchOpEntry[] = [
      { op: 'line', r: L(0.5), z: L(0) },
      { op: 'line', r: L(0.5), z: L(2) },
      { op: 'fillet', radius: L(0.25) },
      { op: 'line', r: L(1.5), z: L(2) },
    ];
    const out = expandSketchOps(ops, () => undefined, evalArg, {});
    expect(out).toEqual([
      { op: 'line', r: 0.5, z: 0, mode: undefined },
      { op: 'line', r: 0.5, z: 2, mode: undefined },
      { op: 'fillet', radius: 0.25 },
      { op: 'line', r: 1.5, z: 2, mode: undefined },
    ]);
  });

  it('hand-unrolled == repeat-expanded → identical compiled (r,z)', () => {
    // 3 copies of a 2-op rel V-tooth, no synthetic advance (pure self-tile).
    const proto: SketchOpEntry[] = [
      { op: 'line', r: L(0.3), z: L(0.25), mode: 'rel' },
      { op: 'line', r: L(-0.3), z: L(0.25), mode: 'rel' },
    ];
    const rpt: SketchRepeatNode = { id: 'n_r1', type: 'sketch_repeat', count: L(3), loopVar: 'i', ops: proto };
    const ref: SketchRepeatRef = { op: 'repeat-ref', sourceId: 'n_r1' };
    const sketchOps = [
      { op: 'line', r: L(0.5), z: L(0) } as SketchOpEntry,
      ref,
      { op: 'line', r: L(1.5), z: L(3) } as SketchOpEntry,
      { op: 'line', r: L(1.5), z: L(0) } as SketchOpEntry,
    ];
    const expanded = expandSketchOps(sketchOps, lookupFrom(rpt), evalArg, {});

    // Hand-unrolled equivalent (3× the prototype inline).
    const handOps: SketchOp[] = [
      { op: 'line', r: 0.5, z: 0, mode: undefined },
      ...[0, 1, 2].flatMap(() => ([
        { op: 'line', r: 0.3, z: 0.25, mode: 'rel' } as SketchOp,
        { op: 'line', r: -0.3, z: 0.25, mode: 'rel' } as SketchOp,
      ])),
      { op: 'line', r: 1.5, z: 3, mode: undefined },
      { op: 'line', r: 1.5, z: 0, mode: undefined },
    ];
    expect(expanded).toEqual(handOps);
    expect(compileSketch(expanded, 64)).toEqual(compileSketch(handOps, 64));
  });

  it('count = 0 ⇒ the repeat contributes no ops', () => {
    const rpt: SketchRepeatNode = { id: 'n_r', type: 'sketch_repeat', count: L(0), loopVar: 'i',
      ops: [{ op: 'line', r: L(0.3), z: L(0.25), mode: 'rel' }] };
    const out = expandSketchOps(
      [{ op: 'line', r: L(0), z: L(0) }, { op: 'repeat-ref', sourceId: 'n_r' } as SketchRepeatRef],
      lookupFrom(rpt), evalArg, {});
    expect(out).toEqual([{ op: 'line', r: 0, z: 0, mode: undefined }]);
  });

  it('negative count clamps to 0', () => {
    const rpt: SketchRepeatNode = { id: 'n_r', type: 'sketch_repeat', count: L(-5), loopVar: 'i',
      ops: [{ op: 'line', r: L(0.3), z: L(0.25), mode: 'rel' }] };
    const out = expandSketchOps([{ op: 'repeat-ref', sourceId: 'n_r' } as SketchRepeatRef], lookupFrom(rpt), evalArg, {});
    expect(out).toEqual([]);
  });

  it('count = 1 ⇒ one prototype copy', () => {
    const rpt: SketchRepeatNode = { id: 'n_r', type: 'sketch_repeat', count: L(1), loopVar: 'i',
      ops: [{ op: 'line', r: L(0.3), z: L(0.25), mode: 'rel' }] };
    const out = expandSketchOps([{ op: 'repeat-ref', sourceId: 'n_r' } as SketchRepeatRef], lookupFrom(rpt), evalArg, {});
    expect(out).toEqual([{ op: 'line', r: 0.3, z: 0.25, mode: 'rel' }]);
  });

  it('rel tiling accumulates across iterations (4 copies reach the expected z)', () => {
    // each copy advances z by 0.5; start at (0,0); after 4 → z = 2.
    const rpt: SketchRepeatNode = { id: 'n_r', type: 'sketch_repeat', count: L(4), loopVar: 'i',
      ops: [{ op: 'line', r: L(0), z: L(0.5), mode: 'rel' }] };
    const ops = [
      { op: 'line', r: L(0), z: L(0) } as SketchOpEntry,
      { op: 'repeat-ref', sourceId: 'n_r' } as SketchRepeatRef,
    ];
    const expanded = expandSketchOps(ops, lookupFrom(rpt), evalArg, {});
    // toVerts walks the running cursor: 0 → 0.5 → 1.0 → 1.5 → 2.0
    const pts = compileSketch(expanded, 64);
    const maxZ = Math.max(...pts.map((q) => q[1]));
    expect(maxZ).toBeCloseTo(2.0, 6);
  });

  it('per-iteration advance prepends a leading rel move when dr/dz is set', () => {
    const rpt: SketchRepeatNode = { id: 'n_r', type: 'sketch_repeat', count: L(2), loopVar: 'i',
      dr: L(0), dz: L(1),
      ops: [{ op: 'line', r: L(0.3), z: L(0), mode: 'rel' }] };
    const out = expandSketchOps([{ op: 'repeat-ref', sourceId: 'n_r' } as SketchRepeatRef], lookupFrom(rpt), evalArg, {});
    expect(out).toEqual([
      { op: 'line', r: 0, z: 1, mode: 'rel' },     // advance, iter 0
      { op: 'line', r: 0.3, z: 0, mode: 'rel' },   // proto,   iter 0
      { op: 'line', r: 0, z: 1, mode: 'rel' },     // advance, iter 1
      { op: 'line', r: 0.3, z: 0, mode: 'rel' },   // proto,   iter 1
    ]);
  });

  it('loop var + NPts are in scope for prototype exprs (tapering)', () => {
    const rpt: SketchRepeatNode = { id: 'n_r', type: 'sketch_repeat', count: L(3), loopVar: 'i',
      ops: [{ op: 'line', r: asExpr('0.5 + i*0.1'), z: asExpr('i / NPts'), mode: 'rel' }] };
    const out = expandSketchOps([{ op: 'repeat-ref', sourceId: 'n_r' } as SketchRepeatRef], lookupFrom(rpt), evalArg, {});
    expect(out).toEqual([
      { op: 'line', r: 0.5, z: 0, mode: 'rel' },
      { op: 'line', r: 0.6, z: 1 / 3, mode: 'rel' },
      { op: 'line', r: 0.7, z: 2 / 3, mode: 'rel' },
    ]);
  });

  it('bindings cascade in the loop scope', () => {
    const rpt: SketchRepeatNode = { id: 'n_r', type: 'sketch_repeat', count: L(2), loopVar: 'i',
      bindings: [{ name: 'amp', value: asExpr('0.2 * (i + 1)') }],
      ops: [{ op: 'line', r: asExpr('amp'), z: L(1), mode: 'rel' }] };
    const out = expandSketchOps([{ op: 'repeat-ref', sourceId: 'n_r' } as SketchRepeatRef], lookupFrom(rpt), evalArg, {});
    expect(out).toEqual([
      { op: 'line', r: 0.2, z: 1, mode: 'rel' },
      { op: 'line', r: 0.4, z: 1, mode: 'rel' },
    ]);
  });

  it('seam fillet — a fillet as the first prototype op rounds the tooth seam', () => {
    const rpt: SketchRepeatNode = { id: 'n_r', type: 'sketch_repeat', count: L(2), loopVar: 'i',
      ops: [
        { op: 'fillet', radius: L(0.05) },
        { op: 'line', r: L(0.3), z: L(0.25), mode: 'rel' },
        { op: 'line', r: L(-0.3), z: L(0.25), mode: 'rel' },
      ] };
    const ops = [
      { op: 'line', r: L(0.5), z: L(0) } as SketchOpEntry,
      { op: 'repeat-ref', sourceId: 'n_r' } as SketchRepeatRef,
      { op: 'line', r: L(1.5), z: L(2) } as SketchOpEntry,
    ];
    const expanded = expandSketchOps(ops, lookupFrom(rpt), evalArg, {});
    // The flat splice puts a fillet right after the (0.5,0) vertex → it compiles
    // without throwing and yields a sampled point list.
    expect(() => compileSketch(expanded, 64)).not.toThrow();
    expect(compileSketch(expanded, 64).length).toBeGreaterThan(2);
  });

  it('a missing / mistyped source ref is dropped (defensive)', () => {
    const out = expandSketchOps(
      [{ op: 'line', r: L(0), z: L(0) }, { op: 'repeat-ref', sourceId: 'n_missing' } as SketchRepeatRef],
      () => undefined, evalArg, {});
    expect(out).toEqual([{ op: 'line', r: 0, z: 0, mode: undefined }]);
  });

  it('scaleX/scaleY apply to the whole tiled profile (downstream of expansion)', () => {
    const rpt: SketchRepeatNode = { id: 'n_r', type: 'sketch_repeat', count: L(3), loopVar: 'i',
      ops: [{ op: 'line', r: L(0), z: L(0.5), mode: 'rel' }] };
    const ops = [
      { op: 'line', r: L(0), z: L(0) } as SketchOpEntry,
      { op: 'repeat-ref', sourceId: 'n_r' } as SketchRepeatRef,
      { op: 'line', r: L(1), z: L(0) } as SketchOpEntry,
    ];
    const expanded = expandSketchOps(ops, lookupFrom(rpt), evalArg, {});
    const plain = compileSketch(expanded, 64);
    const scaled = compileSketch(expanded, 64, 2, 3);
    // Scaling the already-expanded ops == scaling the compiled points.
    const byHand = plain.map(([r, z]) => [r * 2, z * 3]);
    expect(scaled).toEqual(byHand);
  });
});

describe('sketch-repeat — emit ⇄ expander agreement', () => {
  // Build a graph: a sketch with a repeat-ref + its SketchRepeatNode, emit the
  // body, sandbox-eval it with `sketch` stubbed to capture the resolved ops,
  // and assert they equal expandSketchOps (closes the two-site loop).
  function captureEmittedOps(g: any): SketchOp[] {
    const out = emitGraph(g, { id: 'spec_sketch_repeat', description: 'sr' });
    const captured: SketchOp[][] = [];
    const sketch = (ops: SketchOp[]) => { captured.push(ops); return { __sketch: true }; };
    // The body references only `sketch` here (bare sketch output, literal coords).
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function('sketch', 'p', out.body)(sketch, {});
    return captured[0] ?? [];
  }

  it('emitted Array.from spread compiles to the same ops as expandSketchOps', () => {
    let g = newGraph();
    const a = addSketch(g); g = a.graph;
    const sk = a.id;
    const r = addSketchRepeat(g, sk); g = r.graph;
    g = setSketchRepeatCount(g, r.id, asLiteral(4));
    g = setSketchRepeatAdvance(g, r.id, 'dz', asLiteral(0.5));

    const node = g.nodes[sk] as any;
    const rptNode = g.nodes[r.id] as SketchRepeatNode;
    const expected = expandSketchOps(node.ops, lookupFrom(rptNode), evalArg, {});

    const emitted = captureEmittedOps(g);
    expect(emitted).toEqual(expected);
    expect(compileSketch(emitted, 64)).toEqual(compileSketch(expected, 64));
  });
});
