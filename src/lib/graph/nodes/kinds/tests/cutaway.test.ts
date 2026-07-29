import { describe, it, expect } from 'vitest';
import { CutawayKind, cutawayChildren, cutawayIsMulti } from '../cutaway';
import type { EmitCtx } from '../../node-kind';
import type { Graph, CutawayNode, ArgValue } from '$lib/graph/composition/composition-graph-types';

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
