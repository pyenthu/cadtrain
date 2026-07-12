import { describe, it, expect } from 'vitest';
import { SketchKind } from '../sketch';
import { SketchRepeatKind } from '../sketch-repeat';
import { ExprKind } from '../expr';
import type { EmitCtx, SizeConsts } from '../../node-kind';
import type { SketchNode, SketchRepeatNode, ExprNode, ArgValue } from '../../../composition-graph-types';

const lit = (v: number): ArgValue => ({ kind: 'literal', value: v });
const par = (p: string): ArgValue => ({ kind: 'param', param: p });
// Fake emitSketchOpObject — enough shape to assert wiring, not the real emitter.
const fakeSketchOp = (o: any): string =>
  o.op === 'line' ? `{ op: 'line', r: ${o.r?.value ?? o.r?.param}, z: ${o.z?.value ?? o.z?.param} }` : '';
const ctx = (nodes: Record<string, any> = {}): EmitCtx => ({
  ref: (id) => id.toUpperCase(),
  emitValue: (v) => (v.kind === 'expr' ? (v as any).expr : String((v as any).value ?? (v as any).param)),
  emitCall: (s) => s,
  varNames: new Map(), listProducers: new Set(), nodes,
  exprBlockVar: (id) => `_x_${id}`,
  emitSketchOp: fakeSketchOp,
});
const CONSTS: SizeConsts = {
  OUTPUT_BOX_MIN_W: 24, OUTPUT_ARROW_W: 30, OUTPUT_MIN_H: 56,
  POLY_VTX_PITCH: 45, POLY_RREF_PITCH: 38, EXPR_BODY_TOP: 32, EXPR_ROW_H: 26,
};
const graph = (params: Record<string, any> = {}): any => ({ nodes: {}, root: 'r', params });
const sk = (ops: any[], extra: Partial<SketchNode> = {}): SketchNode => ({ id: 'sk', type: 'sketch', ops, ...extra } as any);

describe('SketchKind', () => {
  it('emits sketch([...ops], segments) with the default 64 segments', () => {
    expect(SketchKind.emitExpr(sk([{ op: 'line', r: lit(1), z: lit(0) }]), ctx()))
      .toBe("sketch([{ op: 'line', r: 1, z: 0 }], 64)");
  });
  it('explicit segments + whole-sketch scale append the scale args', () => {
    const n = sk([{ op: 'line', r: lit(1), z: lit(0) }], { segments: lit(96), scaleX: lit(2) } as any);
    expect(SketchKind.emitExpr(n, ctx())).toBe("sketch([{ op: 'line', r: 1, z: 0 }], 96, 2, 1)");
  });
  it('a repeat-ref splices its SketchRepeatNode prototype via Array.from(...).flat()', () => {
    const nodes = { sr: { id: 'sr', type: 'sketch_repeat', count: lit(2), loopVar: 'i', ops: [{ op: 'line', r: lit(1), z: lit(0) }] } };
    expect(SketchKind.emitExpr(sk([{ op: 'repeat-ref', sourceId: 'sr' }]), ctx(nodes)))
      .toBe("sketch([...Array.from({ length: 2 }, (_, i) => { const NPts = 2; return [{ op: 'line', r: 1, z: 0 }]; }).flat()], 64)");
  });
  it('an expr-list-ref maps the ExprNode output const to line ops', () => {
    const nodes = { e: { id: 'e', type: 'expr' } };
    expect(SketchKind.emitExpr(sk([{ op: 'expr-list-ref', sourceId: 'e', output: 'pts' }]), ctx(nodes)))
      .toBe("sketch([...(_x_e_pts).map((__p) => ({ op: 'line', r: __p[0], z: __p[1] }))], 64)");
  });
  it('validate flags a since-deleted param in a line op', () => {
    expect(SketchKind.validate(sk([{ op: 'line', r: lit(1), z: lit(0) }]), graph())).toEqual([]);
    const errs = SketchKind.validate(sk([{ op: 'line', r: par('gone'), z: lit(0) }]), graph());
    expect(errs).toEqual([{ nodeId: 'sk', slot: 'ops[0].r', badRef: 'gone', kind: 'missing-param' }]);
  });
  it('inputRefs: repeat-ref ops consume their SketchRepeatNode source (← computeConsumedSet)', () => {
    expect(SketchKind.inputRefs(sk([{ op: 'line', r: lit(1), z: lit(0) }]))).toEqual([]);
    expect(SketchKind.inputRefs(sk([
      { op: 'repeat-ref', sourceId: 'sr1' },
      { op: 'line', r: lit(1), z: lit(0) },
      { op: 'repeat-ref', sourceId: 'sr2' },
      { op: 'repeat-ref' }, // no sourceId → skipped
    ]))).toEqual(['sr1', 'sr2']);
  });
  it('size floors width at 210 and grows height with the column layout', () => {
    const { w, h } = SketchKind.size(sk([{ op: 'line', r: lit(1), z: lit(0) }]), { width: 100, root: 'r', consts: CONSTS });
    expect(w).toBeGreaterThanOrEqual(210);
    expect(h).toBeGreaterThan(0);
  });
});

describe('SketchRepeatKind', () => {
  const sr = (ops: any[] = [], bindings: any[] = []): SketchRepeatNode =>
    ({ id: 'sr', type: 'sketch_repeat', count: lit(2), loopVar: 'i', ops, bindings } as any);
  it('producer: emit null, validate/inputRefs empty', () => {
    expect(SketchRepeatKind.emitExpr(sr(), ctx())).toBeNull();
    expect(SketchRepeatKind.validate(sr(), graph())).toEqual([]);
    expect(SketchRepeatKind.inputRefs(sr())).toEqual([]);
  });
  it('size: fixed 252 wide; height grows with ops + bindings', () => {
    const base = SketchRepeatKind.size(sr(), { width: 0, root: 'r' });
    expect(base.w).toBe(252);
    const bigger = SketchRepeatKind.size(sr([{ op: 'line' }, { op: 'line' }], [{ name: 'a', value: lit(1) }]), { width: 0, root: 'r' });
    expect(bigger.h).toBe(base.h + 2 * 24 + 1 * 22);
  });
});

describe('ExprKind', () => {
  const en = (bindings: Record<string, ArgValue> = {}): ExprNode => ({ id: 'e', type: 'expr', defId: 'd', bindings } as any);
  it('emit null (non-geometry calc node)', () => {
    expect(ExprKind.emitExpr(en(), ctx())).toBeNull();
  });
  it('validate flags a binding wired to a since-deleted param', () => {
    expect(ExprKind.validate(en({ a: lit(1) }), graph())).toEqual([]);
    expect(ExprKind.validate(en({ a: par('gone') }), graph())).toEqual([
      { nodeId: 'e', slot: 'bindings.a', badRef: 'gone', kind: 'missing-param' },
    ]);
  });
  it('size reads THROUGH the def: taller of {params, outputs} rows', () => {
    const def = { id: 'd', params: [{ name: 'a' }, { name: 'b' }, { name: 'c' }], outputs: [{ name: 'out' }] };
    // 3 params vs 1 output → 3 rows → h = 32 + 3*26 + 30 = 140
    expect(ExprKind.size(en(), { width: 260, root: 'r', consts: CONSTS, exprDefs: [def] }))
      .toEqual({ w: 260, h: 140 });
    // dangling defId → 1-row fallback → h = 32 + 26 + 30 = 88
    expect(ExprKind.size(en(), { width: 260, root: 'r', consts: CONSTS, exprDefs: [] }))
      .toEqual({ w: 260, h: 88 });
  });
});
