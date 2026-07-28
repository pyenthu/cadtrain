import { describe, it, expect } from 'vitest';
import { MvKind } from '../mv';
import { RotKind } from '../rot';
import type { EmitCtx } from '../../node-kind';
import type { Graph, MvNode, RotNode, ArgValue } from '$lib/graph/composition/composition-graph-types';

const lit = (v: number): ArgValue => ({ kind: 'literal', value: v });
const par = (p: string): ArgValue => ({ kind: 'param', param: p });
const triple = (a: number, b: number, c: number): [ArgValue, ArgValue, ArgValue] => [lit(a), lit(b), lit(c)];
const ctx = (): EmitCtx => ({
  ref: (id) => (id === 'c' ? 'C' : `?${id}`),
  emitValue: (v) => String((v as any).value ?? (v as any).param),
  varNames: new Map(), listProducers: new Set(), nodes: {},
});
const graph = (nodes: Record<string, any>, params: Record<string, any> = {}): Graph =>
  ({ nodes, root: 'r', params, edges: [], imports: [], layout: {} } as any);

describe('MvKind', () => {
  const n: MvNode = { id: 'v1', type: 'mv', child: 'c', offset: triple(1, 2, 3) };
  it('emitExpr → mv(child, [x,y,z])', () => expect(MvKind.emitExpr(n, ctx())).toBe('mv(C, [1, 2, 3])'));
  it('validate flags missing child + since-deleted offset param', () => {
    expect(MvKind.validate(n, graph({ c: {} }))).toEqual([]);
    const bad: MvNode = { id: 'v1', type: 'mv', child: 'gone', offset: [par('p'), lit(0), lit(0)] };
    const errs = MvKind.validate(bad, graph({}));
    expect(errs).toContainEqual({ nodeId: 'v1', slot: 'child', badRef: 'gone', kind: 'missing-node' });
    expect(errs).toContainEqual({ nodeId: 'v1', slot: 'offset[0]', badRef: 'p', kind: 'missing-param' });
  });
  it('inputRefs = [child]; size 40×40', () => {
    expect(MvKind.inputRefs(n)).toEqual(['c']);
    expect(MvKind.size(n, { width: 99, root: 'r' })).toEqual({ w: 40, h: 40 });
  });
});

describe('RotKind', () => {
  const n: RotNode = { id: 'r1', type: 'rot', child: 'c', rot: triple(90, 0, 0) };
  it('emitExpr → rot(child, [rx,ry,rz])', () => expect(RotKind.emitExpr(n, ctx())).toBe('rot(C, [90, 0, 0])'));
  it('validate + inputRefs + size', () => {
    expect(RotKind.validate(n, graph({ c: {} }))).toEqual([]);
    expect(RotKind.inputRefs(n)).toEqual(['c']);
    expect(RotKind.size(n, { width: 99, root: 'r' })).toEqual({ w: 40, h: 40 });
  });
});
