import { describe, it, expect } from 'vitest';
import { CutawayKind } from '../cutaway';
import type { EmitCtx } from '../../node-kind';
import type { Graph, CutawayNode, ArgValue } from '$lib/graph/composition/composition-graph-types';

const lit = (v: number): ArgValue => ({ kind: 'literal', value: v });
const par = (p: string): ArgValue => ({ kind: 'param', param: p });
const ctx = (): EmitCtx => ({
  ref: (id) => (id === 'c' ? 'C' : `?${id}`),
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
