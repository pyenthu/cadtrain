import { describe, it, expect } from 'vitest';
import { RepeatKind } from './repeat';
import type { EmitCtx } from '../node-kind';
import type { Graph, RepeatNode, ArgValue } from '../../composition-graph-types';

const lit = (v: number): ArgValue => ({ kind: 'literal', value: v });
const par = (p: string): ArgValue => ({ kind: 'param', param: p });
const ctx = (): EmitCtx => ({
  ref: (id) => id.toUpperCase(),
  emitValue: (v) => (v.kind === 'expr' ? (v as any).expr : String((v as any).value ?? (v as any).param)),
  emitCall: (s) => s,
  varNames: new Map(), listProducers: new Set(), nodes: {},
});
const graph = (nodes: Record<string, any>, params: Record<string, any> = {}): Graph =>
  ({ nodes, root: 'r', params, edges: [], imports: [], layout: {} } as any);
const rep = (extra: Partial<RepeatNode> = {}): RepeatNode =>
  ({ id: 'rp', type: 'repeat', children: ['a'], count: lit(3), ...extra } as any);

describe('RepeatKind', () => {
  it('default op → stack of an identity clone (byte-identical legacy form)', () => {
    expect(RepeatKind.emitExpr(rep(), ctx()))
      .toBe('stack(Array.from({ length: 3 }, () => A))');
  });
  it('op=list → the bare array; op=place → place(array)', () => {
    expect(RepeatKind.emitExpr(rep({ op: 'list' }), ctx())).toBe('Array.from({ length: 3 }, () => A)');
    expect(RepeatKind.emitExpr(rep({ op: 'place' }), ctx())).toBe('place(Array.from({ length: 3 }, () => A))');
  });
  it('two children compose per-iteration via place([...])', () => {
    expect(RepeatKind.emitExpr(rep({ children: ['a', 'b'] }), ctx()))
      .toBe('stack(Array.from({ length: 3 }, () => place([A, B])))');
  });
  it('a loop var + bindings emit the N/NPts preamble + const lines', () => {
    const n = rep({ loopVar: 'k', bindings: [{ name: 'amp', value: par('h') }] as any });
    expect(RepeatKind.emitExpr(n, ctx()))
      .toBe('stack(Array.from({ length: 3 }, (_, k) => { const N = 3; const NPts = 3; const amp = h; return A; }))');
  });
  it('global modifiers wrap the unit innermost-first', () => {
    const n = rep({ modifiers: [{ kind: 'mv', vec: [lit(0), lit(1), lit(0)] }] as any });
    expect(RepeatKind.emitExpr(n, ctx()))
      .toBe('stack(Array.from({ length: 3 }, (_, i) => { const N = 3; const NPts = 3; return mv(A, [0, 1, 0]); }))');
  });
  it('bodyExpr code override replaces the children body verbatim', () => {
    expect(RepeatKind.emitExpr(rep({ bodyExpr: 'myShape(i)' }), ctx()))
      .toBe('stack(Array.from({ length: 3 }, (_, i) => { const N = 3; const NPts = 3; return myShape(i); }))');
  });

  it('validate: empty non-code repeat flags a missing child + a deleted count param', () => {
    expect(RepeatKind.validate(rep(), graph({ a: {} }))).toEqual([]);
    const errs = RepeatKind.validate(rep({ children: [], count: par('gone') }), graph({}));
    expect(errs).toContainEqual({ nodeId: 'rp', slot: 'child', badRef: '', kind: 'missing-node' });
    expect(errs).toContainEqual({ nodeId: 'rp', slot: 'count', badRef: 'gone', kind: 'missing-param' });
  });
  it('validate: a bodyExpr suppresses the empty-child error', () => {
    expect(RepeatKind.validate(rep({ children: [], bodyExpr: 'x()' }), graph({}))).toEqual([]);
  });

  it('inputRefs = children; size grows 24px per part above the 110 floor', () => {
    expect(RepeatKind.inputRefs(rep({ children: ['a', 'b'] }))).toEqual(['a', 'b']);
    // 1 part → max(110, 64 + 2*24) = 112
    expect(RepeatKind.size(rep(), { width: 200, root: 'r' })).toEqual({ w: 200, h: 112 });
    // 3 parts → 64 + 4*24 = 160
    expect(RepeatKind.size(rep({ children: ['a', 'b', 'c'] }), { width: 200, root: 'r' })).toEqual({ w: 200, h: 160 });
  });
});
