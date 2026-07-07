import { describe, it, expect } from 'vitest';
import { SplineKind } from './spline';
import { WarpKind } from './warp';
import type { EmitCtx } from '../node-kind';
import type { Graph, WarpNode, ArgValue } from '../../composition-graph-types';

const lit = (v: number): ArgValue => ({ kind: 'literal', value: v });
const par = (p: string): ArgValue => ({ kind: 'param', param: p });
const ctx = (): EmitCtx => ({
  ref: (id) => (id === 'c' ? 'C' : `?${id}`),
  emitValue: (v) => (v.kind === 'expr' ? (v as any).expr : String((v as any).value ?? (v as any).param)),
  emitCall: (s) => s, varNames: new Map(), listProducers: new Set(), nodes: {},
});
const graph = (nodes: Record<string, any>, params: Record<string, any> = {}): Graph =>
  ({ nodes, root: 'r', params, edges: [], imports: [], layout: {} } as any);
const warp = (extra: Partial<WarpNode> = {}): WarpNode =>
  ({ id: 'w1', type: 'warp', child: 'c', path: { kind: 'expr', expr: '_x_s_path' } as any, ...extra });

describe('SplineKind', () => {
  it('emit null, validate [], size {w,40}', () => {
    expect(SplineKind.emitExpr({} as any, ctx())).toBeNull();
    expect(SplineKind.validate({} as any, graph({}))).toEqual([]);
    expect(SplineKind.size({} as any, { width: 200, root: 'r' })).toEqual({ w: 200, h: 40 });
  });
});

describe('WarpKind', () => {
  it('terse warpSpline(child, path) with no opts', () => {
    expect(WarpKind.emitExpr(warp(), ctx())).toBe('warpSpline(C, _x_s_path)');
  });
  it('emits only the set opt levers, in order refine/stretch/validate', () => {
    expect(WarpKind.emitExpr(warp({ refine: lit(4), stretch: true, validate: true }), ctx()))
      .toBe('warpSpline(C, _x_s_path, { refine: 4, stretch: true, validate: true })');
    expect(WarpKind.emitExpr(warp({ stretch: true }), ctx())).toBe('warpSpline(C, _x_s_path, { stretch: true })');
  });
  it('validate flags null child + a since-deleted path/refine param', () => {
    expect(WarpKind.validate(warp(), graph({ c: {} }))).toEqual([]);
    const errs = WarpKind.validate(warp({ child: null, path: par('gone'), refine: par('r') }), graph({}));
    expect(errs).toContainEqual({ nodeId: 'w1', slot: 'child', badRef: '', kind: 'missing-node' });
    expect(errs).toContainEqual({ nodeId: 'w1', slot: 'path', badRef: 'gone', kind: 'missing-param' });
    expect(errs).toContainEqual({ nodeId: 'w1', slot: 'refine', badRef: 'r', kind: 'missing-param' });
  });
  it('size grows for the ＋solid append row; inputRefs=[child]', () => {
    // #36b: single solid → 2 socket rows (child + ＋append) → 40 + 2*22 + 12 = 96.
    expect(WarpKind.size(warp(), { width: 150, root: 'r' })).toEqual({ w: 150, h: 96 });
    expect(WarpKind.inputRefs(warp())).toEqual(['c']);
    // multi: two solids → 3 rows → 40 + 3*22 + 12 = 118; both children consumed.
    const multi = { ...warp(), child: undefined, children: ['c', 'd'] } as any;
    expect(WarpKind.size(multi, { width: 150, root: 'r' })).toEqual({ w: 150, h: 118 });
    expect(WarpKind.inputRefs(multi)).toEqual(['c', 'd']);
  });
});
