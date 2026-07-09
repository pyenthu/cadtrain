import { describe, it, expect } from 'vitest';
import { ContainerKind } from './container';
import { StackKind } from './stack';
import type { EmitCtx, SizeConsts } from '../node-kind';
import type { Graph, ContainerNode, ArgValue } from '../../composition-graph-types';

const lit = (v: number): ArgValue => ({ kind: 'literal', value: v });
// ref → uppercased id; emitValue → the literal/param text.
const ctx = (listProducers: string[] = []): EmitCtx => ({
  ref: (id) => id.toUpperCase(),
  emitValue: (v) => String((v as any).value ?? (v as any).param),
  emitCall: (s) => s,
  varNames: new Map(), listProducers: new Set(listProducers), nodes: {},
});
const graph = (nodes: Record<string, any>): Graph =>
  ({ nodes, root: 'root', params: {}, edges: [], imports: [], layout: {} } as any);
// Mirror geom.ts SIZE_CONSTS (the real values geom injects).
const CONSTS: SizeConsts = {
  OUTPUT_BOX_MIN_W: 24, OUTPUT_ARROW_W: 30, OUTPUT_MIN_H: 56,
  POLY_VTX_PITCH: 45, POLY_RREF_PITCH: 38, EXPR_BODY_TOP: 32, EXPR_ROW_H: 26,
};
const list = (children: string[], id = 'l'): ContainerNode => ({ id, type: 'list', children } as any);

describe('ContainerKind (list / group)', () => {
  it('emitExpr → a bare JS array of the children vars', () => {
    expect(ContainerKind.emitExpr(list(['a', 'b']), ctx())).toBe('[A, B]');
    expect(ContainerKind.emitExpr(list([]), ctx())).toBe('[]');
  });
  it('validate flags each missing child by slot children[i]', () => {
    expect(ContainerKind.validate(list(['a', 'b']), graph({ a: {}, b: {} }))).toEqual([]);
    expect(ContainerKind.validate(list(['a', 'gone']), graph({ a: {} }))).toEqual([
      { nodeId: 'l', slot: 'children[1]', badRef: 'gone', kind: 'missing-node' },
    ]);
  });
  it('inputRefs = children', () => expect(ContainerKind.inputRefs(list(['a', 'b']))).toEqual(['a', 'b']));
  it('size: non-root grows one 22px slot per child + a trailing drop slot', () => {
    // 2 children → slots=3 → h = max(60, 40 + 3*22) = 106
    expect(ContainerKind.size(list(['a', 'b']), { width: 110, root: 'root', consts: CONSTS }))
      .toEqual({ w: 110, h: 106 });
  });
  it('size: the ROOT ▶ Output card is the compact box + arrow, FIXED height (#31 one socket)', () => {
    // #31 collapsed Output: ONE socket regardless of child count → fixed h = OUTPUT_MIN_H (56); w = 24 + 30.
    expect(ContainerKind.size(list(['a'], 'root'), { width: 999, root: 'root', consts: CONSTS }))
      .toEqual({ w: 54, h: 56 });
    // Many children → STILL 56 (no per-output growth).
    expect(ContainerKind.size(list(['a', 'b', 'c'], 'root'), { width: 999, root: 'root', consts: CONSTS }))
      .toEqual({ w: 54, h: 56 });
  });
});

describe('StackKind', () => {
  const stk = (children: string[], extra: Partial<ContainerNode> = {}): ContainerNode =>
    ({ id: 'st', type: 'stack', children, ...extra } as any);

  it('bare children mate via stack([...])', () => {
    expect(StackKind.emitExpr(stk(['a', 'b']), ctx())).toBe('stack([A, B])');
  });
  it('list-producing children spread with ...', () => {
    expect(StackKind.emitExpr(stk(['a', 'b']), ctx(['b']))).toBe('stack([A, ...B])');
  });
  it('per-child ×N count → Array(n).fill', () => {
    expect(StackKind.emitExpr(stk(['a'], { childCounts: { a: lit(3) } as any }), ctx()))
      .toBe('stack([...Array(Math.max(1, Math.floor(3) | 0)).fill(A)])');
  });
  it('a literal count ≤ 1 is a single copy (no spread)', () => {
    expect(StackKind.emitExpr(stk(['a'], { childCounts: { a: lit(1) } as any }), ctx()))
      .toBe('stack([A])');
  });
  it('per-child stack-ref override wraps via withStackRef', () => {
    expect(StackKind.emitExpr(stk(['a'], { childRefs: { a: 2 } as any }), ctx()))
      .toBe('stack([withStackRef(A, 2)])');
  });
  it('validate shares the container children-walk; size shares containerSize', () => {
    expect(StackKind.validate(stk(['gone']), graph({}))).toEqual([
      { nodeId: 'st', slot: 'children[0]', badRef: 'gone', kind: 'missing-node' },
    ]);
    expect(StackKind.size(stk(['a', 'b']), { width: 120, root: 'root', consts: CONSTS }))
      .toEqual({ w: 120, h: 106 });
  });
});
