import { describe, it, expect } from 'vitest';
import { CutawayKind, cutawayChildren, cutawayIsMulti } from '../cutaway';
import type { EmitCtx } from '../../node-kind';
import type { Graph, CutawayNode, ArgValue } from '$lib/graph/composition/composition-graph-types';
import { asLiteral } from '$lib/graph/composition/composition-graph-types';
import { newGraph } from '$lib/graph/composition/composition-graph-hydrate';
import { addCall, addCutaway, setCutawayChildAt } from '$lib/graph/composition/composition-graph-mutate';
import { emitGraph } from '$lib/graph/composition/composition-emit';

const lit = (v: number): ArgValue => ({ kind: 'literal', value: v });
const par = (p: string): ArgValue => ({ kind: 'param', param: p });
// ref maps a→A, b→B, c→C (uppercase) so the emitted expr reads cleanly.
const ctx = (): EmitCtx => ({
  ref: (id) => (/^[abc]$/.test(id) ? id.toUpperCase() : `?${id}`),
  emitValue: (v) => (v.kind === 'expr' ? (v as any).expr : String((v as any).value ?? (v as any).param)),
  emitCall: (s) => s, varNames: new Map(), listProducers: new Set(), nodes: {},
});
const graph = (nodes: Record<string, any>, params: Record<string, any> = {}): Graph =>
  ({ nodes, root: 'r', params, edges: [], imports: [], layout: {} } as any);
const cutaway = (extra: Partial<CutawayNode> = {}): CutawayNode =>
  ({ id: 'x1', type: 'cutaway', child: 'c', az: lit(180), offset: lit(0), ...extra });

describe('CutawayKind', () => {
  it('emits sectionCut(child, { az, offset })', () => {
    expect(CutawayKind.emitExpr(cutaway(), ctx()))
      .toBe('sectionCut(C, { az: 180, offset: 0 })');
    expect(CutawayKind.emitExpr(cutaway({ az: lit(90), offset: lit(12) }), ctx()))
      .toBe('sectionCut(C, { az: 90, offset: 12 })');
  });
  it('emits param / expr az + offset', () => {
    expect(CutawayKind.emitExpr(cutaway({ az: par('sweep'), offset: { kind: 'expr', expr: 'L/2' } as any }), ctx()))
      .toBe('sectionCut(C, { az: sweep, offset: L/2 })');
  });
  it('validate flags a null child + since-deleted az/offset params', () => {
    expect(CutawayKind.validate(cutaway(), graph({ c: {} }))).toEqual([]);
    const errs = CutawayKind.validate(cutaway({ child: null, az: par('gone'), offset: par('nope') }), graph({}));
    expect(errs).toContainEqual({ nodeId: 'x1', slot: 'child', badRef: '', kind: 'missing-node' });
    expect(errs).toContainEqual({ nodeId: 'x1', slot: 'az', badRef: 'gone', kind: 'missing-param' });
    expect(errs).toContainEqual({ nodeId: 'x1', slot: 'offset', badRef: 'nope', kind: 'missing-param' });
  });
  it('size {w,112}; inputRefs=[child]; sockets solid-in/output', () => {
    expect(CutawayKind.size(cutaway(), { width: 150, root: 'r' })).toEqual({ w: 150, h: 112 });
    expect(CutawayKind.inputRefs(cutaway())).toEqual(['c']);
    expect(CutawayKind.inputRefs(cutaway({ child: null }))).toEqual([]);
    expect(CutawayKind.sockets(cutaway())).toEqual({ inputs: ['child'], output: true });
  });
});

// ── MULTI-INPUT (mirrors WarpKind #36b): ≥2 wired solids → a bare ARRAY of per-part
//    sections (a list producer). 1 solid stays byte-identical to the legacy emit. ──
describe('CutawayKind — multiple wired solids', () => {
  it('cutawayChildren / cutawayIsMulti prefer children[] over the legacy child', () => {
    expect(cutawayChildren(cutaway())).toEqual(['c']);                          // legacy single
    expect(cutawayChildren(cutaway({ child: null }))).toEqual([]);              // unwired
    expect(cutawayChildren(cutaway({ child: 'c', children: ['a', 'b'] }))).toEqual(['a', 'b']); // children wins
    expect(cutawayIsMulti(cutaway({ children: ['a', 'b'] }))).toBe(true);
    expect(cutawayIsMulti(cutaway({ children: ['a'] }))).toBe(false);
    expect(cutawayIsMulti(cutaway())).toBe(false);
  });

  it('ONE child (children:[c]) emits byte-identical to the legacy single child', () => {
    // The single-input contract: children:[c] must lower to EXACTLY the historical
    // `sectionCut(C, { az, offset })`, character-for-character (the golden gate).
    const legacy = CutawayKind.emitExpr(cutaway(), ctx());                       // child:'c', no children
    const oneKid = CutawayKind.emitExpr(cutaway({ child: 'c', children: ['c'] }), ctx());
    expect(legacy).toBe('sectionCut(C, { az: 180, offset: 0 })');
    expect(oneKid).toBe(legacy);
  });

  it('TWO children emit a bare ARRAY of per-part sections (list producer)', () => {
    expect(CutawayKind.emitExpr(cutaway({ child: 'a', children: ['a', 'b'] }), ctx()))
      .toBe('[sectionCut(A, { az: 180, offset: 0 }), sectionCut(B, { az: 180, offset: 0 })]');
    // az/offset (param + literal) thread into EACH section identically.
    expect(CutawayKind.emitExpr(cutaway({ children: ['a', 'b'], az: par('sweep'), offset: lit(12) }), ctx()))
      .toBe('[sectionCut(A, { az: sweep, offset: 12 }), sectionCut(B, { az: sweep, offset: 12 })]');
  });

  it('inputRefs + sockets enumerate every wired child', () => {
    expect(CutawayKind.inputRefs(cutaway({ children: ['a', 'b'] }))).toEqual(['a', 'b']);
    expect(CutawayKind.sockets(cutaway({ children: ['a', 'b'] })))
      .toEqual({ inputs: ['children[0]', 'children[1]'], output: true });
    // A lone children:[c] keeps the single `child` socket (byte-identical UI).
    expect(CutawayKind.sockets(cutaway({ children: ['c'] })))
      .toEqual({ inputs: ['child'], output: true });
  });

  it('validate flags each missing child under its indexed slot (multi)', () => {
    const errs = CutawayKind.validate(cutaway({ child: 'a', children: ['a', 'gone'] }), graph({ a: {} }));
    expect(errs).toContainEqual({ nodeId: 'x1', slot: 'children[1]', badRef: 'gone', kind: 'missing-node' });
    // The present child 'a' produces no error.
    expect(errs.find((e) => e.slot === 'children[0]')).toBeUndefined();
    // Both present → no child errors.
    expect(CutawayKind.validate(cutaway({ child: 'a', children: ['a', 'b'] }), graph({ a: {}, b: {} }))).toEqual([]);
  });
});

// ── END-TO-END through the FULL emit pipeline (`emitGraph`): the kind-level tests
//    above prove `emitExpr` in isolation; these prove the multi-input feature LOWERS
//    correctly once the composition-emit list-producer registration + topoOrder
//    multi-visit + the mutate wiring API (setCutawayChildAt) are all in play. Pure
//    (no WASM): r_cuboid Calls never bake here, only their `sectionCut(<var>, …)`
//    text is asserted. ──────────────────────────────────────────────────────────
describe('sectionCut multi-input — end-to-end emit (list producer → separate bodies)', () => {
  const cuboid = (g: Graph) => addCall(g, 'r_cuboid', { x: asLiteral(2), y: asLiteral(2), z: asLiteral(6) });

  it('TWO wired solids → a bare ARRAY of per-part sections, SPREAD (…) into the root output', () => {
    // box1 + box2 both feed the cutaway (each sectioned separately); box3 is a
    // SECOND, standalone root output. So the root return holds two entries — box3
    // and the multi-cutaway — and because the cutaway is a LIST PRODUCER its array
    // is spread `...` so the sectioned parts reach the top level SEPARATELY (never
    // re-composed / re-fused). That spread is the whole point of the feature.
    let g = newGraph();
    const b1 = cuboid(g); g = b1.graph;
    const b2 = cuboid(g); g = b2.graph;
    const b3 = cuboid(g); g = b3.graph;            // standalone 2nd output (forces the … case)
    const cut = addCutaway(g); g = cut.graph;      // unwired placeholder (child null)
    g = setCutawayChildAt(g, cut.id, 0, b1.id);    // wire two solids via the multi-input API
    g = setCutawayChildAt(g, cut.id, 1, b2.id);

    const { body, validationErrors } = emitGraph(g, { id: 'section_multi_demo' });
    expect(validationErrors).toEqual([]);          // both children validate (no missing-node)

    // The cutaway lowers to `const <cut> = [sectionCut(<s1>, {…}), sectionCut(<s2>, {…})];`
    // — an array of exactly two sections over two DIFFERENT solids (topoOrder emitted
    // both cuboid consts first, so <s1>/<s2> are in scope: no TDZ).
    const m = body.match(
      /const (\w+) = \[sectionCut\((\w+), \{ az: 180, offset: 0 \}\), sectionCut\((\w+), \{ az: 180, offset: 0 \}\)\];/,
    );
    expect(m).not.toBeNull();
    const [, cutVar, s1, s2] = m!;
    expect(s1).not.toBe(s2);                       // two distinct solids sectioned
    // …and that array is SPREAD into the root return (the list-producer registration).
    expect(body).toContain(`...${cutVar}`);
    // The raw sectioned solids are CONSUMED — they must not also appear bare in the return.
    expect(body).toMatch(new RegExp(`return \\[\\w+, \\.\\.\\.${cutVar}\\];`));
  });

  it('ONE wired solid stays byte-identical to the legacy single `child` emit', () => {
    // Build a legacy single-child cutaway, emit it, then wire the SAME solid through
    // the multi-input API (→ children:[box]). cutawayChildren is length 1 either way,
    // so it must NOT become a list producer and the emitted body must be UNCHANGED,
    // character-for-character (same graph, same node ids ⇒ same var names — a true
    // byte-identical gate, not a structural look-alike).
    let g = newGraph();
    const box = cuboid(g); g = box.graph;
    const cut = addCutaway(g, box.id, asLiteral(180), asLiteral(0)); g = cut.graph;

    const before = emitGraph(g, { id: 'section_single_demo' });
    expect(before.validationErrors).toEqual([]);
    expect(before.body).toMatch(/sectionCut\(\w+, \{ az: 180, offset: 0 \}\)/);
    expect(before.body).not.toContain('[sectionCut');   // a single section is NOT an array

    const g2 = setCutawayChildAt(g, cut.id, 0, box.id);  // children:[box] — still one solid
    const after = emitGraph(g2, { id: 'section_single_demo' });
    expect(after.body).toBe(before.body);                // BYTE-IDENTICAL emit
  });
});
