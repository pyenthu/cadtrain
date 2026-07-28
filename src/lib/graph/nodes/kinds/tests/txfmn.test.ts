import { describe, it, expect } from 'vitest';
import { TxfmnKind } from '../txfmn';
import type { EmitCtx } from '../../node-kind';
import type { Graph, TxfmnNode, ArgValue } from '$lib/graph/composition/composition-graph-types';

const lit = (v: number): ArgValue => ({ kind: 'literal', value: v });
const par = (p: string): ArgValue => ({ kind: 'param', param: p });
const Z: [ArgValue, ArgValue, ArgValue] = [lit(0), lit(0), lit(0)];

const mk = (rot: [ArgValue, ArgValue, ArgValue], offset: [ArgValue, ArgValue, ArgValue], child: string | null = 'c'): TxfmnNode =>
  ({ id: 't1', type: 'txfmn', child, rot, offset });

const ctx = (): EmitCtx => ({
  ref: (id) => (id === 'c' ? 'C' : `?${id}`),
  emitValue: (v) => String((v as any).value ?? (v as any).param),
  varNames: new Map(), listProducers: new Set(), nodes: {},
});
const graph = (nodes: Record<string, any>, params: Record<string, any> = {}): Graph =>
  ({ nodes, root: 'r', params, edges: [], imports: [], layout: {} } as any);

describe('TxfmnKind — identity-elision emit (rot INNER, mv OUTER)', () => {
  it('all-zero → bare child', () => {
    expect(TxfmnKind.emitExpr(mk(Z, Z), ctx())).toBe('C');
  });
  it('pure rot → rot(child, [...])', () => {
    expect(TxfmnKind.emitExpr(mk([lit(90), lit(0), lit(0)], Z), ctx())).toBe('rot(C, [90, 0, 0])');
  });
  it('pure mv → mv(child, [...])', () => {
    expect(TxfmnKind.emitExpr(mk(Z, [lit(1), lit(2), lit(3)]), ctx())).toBe('mv(C, [1, 2, 3])');
  });
  it('both → mv(rot(child, [...]), [...]) (rot inner, mv outer)', () => {
    expect(TxfmnKind.emitExpr(mk([lit(90), lit(0), lit(0)], [lit(1), lit(0), lit(0)]), ctx()))
      .toBe('mv(rot(C, [90, 0, 0]), [1, 0, 0])');
  });
});

describe('TxfmnKind — validate / inputRefs / size', () => {
  it('flags a null child + a since-deleted param in rot/offset', () => {
    const n = mk([par('gone'), lit(0), lit(0)], Z, null);
    const errs = TxfmnKind.validate(n, graph({}, {})); // 'gone' not in params, child null
    expect(errs).toContainEqual({ nodeId: 't1', slot: 'child', badRef: '', kind: 'missing-node' });
    expect(errs).toContainEqual({ nodeId: 't1', slot: 'rot[0]', badRef: 'gone', kind: 'missing-param' });
  });
  it('clean when child exists + params declared', () => {
    expect(TxfmnKind.validate(mk(Z, Z), graph({ c: {} }))).toEqual([]);
  });
  it('inputRefs = [child] (empty when unwired)', () => {
    expect(TxfmnKind.inputRefs(mk(Z, Z))).toEqual(['c']);
    expect(TxfmnKind.inputRefs(mk(Z, Z, null))).toEqual([]);
  });
  it('size = { width from ctx, h: 226 }', () => {
    expect(TxfmnKind.size(mk(Z, Z), { width: 150, root: 'r' })).toEqual({ w: 150, h: 226 });
  });
});
