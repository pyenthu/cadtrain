import { describe, it, expect } from 'vitest';
import { PolygonKind } from '../polygon';
import { PolyRepeatKind } from '../poly-repeat';
import type { EmitCtx, SizeConsts } from '../../node-kind';
import type { PolygonNode, PolyRepeatNode, ArgValue } from '$lib/graph/composition/composition-graph-types';

const lit = (v: number): ArgValue => ({ kind: 'literal', value: v });
const par = (p: string): ArgValue => ({ kind: 'param', param: p });
const ctx = (nodes: Record<string, any> = {}): EmitCtx => ({
  ref: (id) => id.toUpperCase(),
  emitValue: (v) => (v.kind === 'expr' ? (v as any).expr : String((v as any).value ?? (v as any).param)),
  emitCall: (s) => s,
  varNames: new Map(), listProducers: new Set(), nodes,
  exprBlockVar: (id) => `_x_${id}`,
});
const CONSTS: SizeConsts = {
  OUTPUT_BOX_MIN_W: 24, OUTPUT_ARROW_W: 30, OUTPUT_MIN_H: 56,
  POLY_VTX_PITCH: 45, POLY_RREF_PITCH: 38, EXPR_BODY_TOP: 32, EXPR_ROW_H: 26,
};
const poly = (points: any[]): PolygonNode => ({ id: 'pg', type: 'polygon', points } as any);

describe('PolygonKind', () => {
  it('literal vertices emit as [r, z] pairs', () => {
    expect(PolygonKind.emitExpr(poly([{ r: lit(1), z: lit(2) }, { r: par('od'), z: lit(0) }]), ctx()))
      .toBe('[[1, 2], [od, 0]]');
  });
  it('an inline repeat entry spreads an Array.from', () => {
    expect(PolygonKind.emitExpr(poly([{ kind: 'repeat', count: lit(4), r: lit(1), z: lit(0) }]), ctx()))
      .toBe('[...Array.from({ length: 4 }, (_, i) => [1, 0])]');
  });
  it('a repeat-ref chases its PolyRepeatNode source', () => {
    const nodes = { pr: { id: 'pr', type: 'poly_repeat', count: lit(3), loopVar: 'k', r: par('a'), z: par('b') } };
    expect(PolygonKind.emitExpr(poly([{ kind: 'repeat-ref', sourceId: 'pr' }]), ctx(nodes)))
      .toBe('[...Array.from({ length: 3 }, (_, k) => { const NPts = 3; return [a, b]; })]');
  });
  it('an expr-list-ref splices the ExprNode output const', () => {
    const nodes = { e: { id: 'e', type: 'expr' } };
    expect(PolygonKind.emitExpr(poly([{ kind: 'expr-list-ref', sourceId: 'e', output: 'pts' }]), ctx(nodes)))
      .toBe('[..._x_e_pts]');
  });
  it('validate = [] (polygon has no arm); inputRefs = []', () => {
    expect(PolygonKind.validate(poly([]), {} as any)).toEqual([]);
    expect(PolygonKind.inputRefs(poly([]))).toEqual([]);
  });
  it('size: cumulative per-entry-kind walk + 66 chrome', () => {
    // 2 literal vertices → 45*2 = 90; h = 36 + 90 + 30 = 156
    const { h } = PolygonKind.size(poly([{ r: lit(1), z: lit(1) }, { r: lit(2), z: lit(2) }]),
      { width: 200, root: 'r', consts: CONSTS });
    expect(h).toBe(156);
  });
  it('size: a persisted layout height overrides the auto walk', () => {
    const { h } = PolygonKind.size(poly([{ r: lit(1), z: lit(1) }]),
      { width: 200, root: 'r', consts: CONSTS, layout: { h: 300 } });
    expect(h).toBe(300);
  });
});

describe('PolyRepeatKind', () => {
  const pr = (bindings: any[] = []): PolyRepeatNode =>
    ({ id: 'pr', type: 'poly_repeat', count: lit(3), loopVar: 'i', r: lit(0), z: lit(0), bindings } as any);
  it('emits nothing (producer node) + validate/inputRefs empty', () => {
    expect(PolyRepeatKind.emitExpr(pr(), ctx())).toBeNull();
    expect(PolyRepeatKind.validate(pr(), {} as any)).toEqual([]);
    expect(PolyRepeatKind.inputRefs(pr())).toEqual([]);
  });
  it('size: fixed 240 wide; height grows with the bindings rows', () => {
    expect(PolyRepeatKind.size(pr(), { width: 0, root: 'r' })).toEqual({ w: 240, h: 154 + (28 + 0 + 24) - 24 });
    expect(PolyRepeatKind.size(pr([{ name: 'a', value: lit(1) }, { name: 'b', value: lit(2) }]), { width: 0, root: 'r' }))
      .toEqual({ w: 240, h: 154 + (28 + 2 * 22 + 24) - 24 });
  });
});
