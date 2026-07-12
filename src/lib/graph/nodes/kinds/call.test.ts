import { describe, it, expect } from 'vitest';
import { CallKind } from './call';
import type { EmitCtx } from '../node-kind';
import type { Graph, CallNode, ArgValue } from '../../composition-graph-types';

const lit = (v: number): ArgValue => ({ kind: 'literal', value: v });
const par = (p: string): ArgValue => ({ kind: 'param', param: p });
const ex = (e: string): ArgValue => ({ kind: 'expr', expr: e } as any);
const node = (args: Record<string, ArgValue>): CallNode => ({ id: 'c1', type: 'call', src: 'r_revolve', alias: 'A', args });
const ctx = (): EmitCtx => ({
  ref: (id) => id,
  emitValue: (v) => String((v as any).value ?? (v as any).param),
  emitCall: (src, args) => `${src}(${Object.keys(args).join(',')})`, // fake — real one is emitCallExpr
  varNames: new Map(), listProducers: new Set(), nodes: {},
});
const graph = (params: Record<string, any> = {}): Graph =>
  ({ nodes: {}, root: 'r', params, edges: [], imports: [], layout: {} } as any);

describe('CallKind', () => {
  it('emitExpr delegates to ctx.emitCall(src, args)', () => {
    expect(CallKind.emitExpr(node({ profile: lit(1), segments: lit(96) }), ctx())).toBe('r_revolve(profile,segments)');
  });
  it('validate flags a since-deleted param arg (slot args.<key>, no index)', () => {
    expect(CallKind.validate(node({ od: lit(2) }), graph())).toEqual([]);
    const errs = CallKind.validate(node({ od: par('gone') }), graph({}));
    expect(errs).toEqual([{ nodeId: 'c1', slot: 'args.od', badRef: 'gone', kind: 'missing-param' }]);
  });
  it('size: width from ctx, height grows with arg count', () => {
    expect(CallKind.size(node({ a: lit(1), b: lit(2), c: lit(3) }), { width: 168, root: 'r' }))
      .toEqual({ w: 168, h: 50 + 3 * 22 }); // 116
    expect(CallKind.size(node({}), { width: 168, root: 'r' })).toEqual({ w: 168, h: 80 }); // floor
  });
  it('inputRefs: scans __POLY__<id> sentinels out of expr args (← computeConsumedSet)', () => {
    expect(CallKind.inputRefs(node({ od: lit(2) }))).toEqual([]); // no expr args
    expect(CallKind.inputRefs(node({ profile: ex('__POLY__n_abc123') }))).toEqual(['n_abc123']);
    // multiple sentinels across args, plain expr ignored
    expect(CallKind.inputRefs(node({ p: ex('__POLY__n_aa'), q: ex('od*2'), r: ex('__POLY__n_bb') })))
      .toEqual(['n_aa', 'n_bb']);
  });
  it('sockets: inputs = arg keys, output true', () => {
    expect(CallKind.sockets(node({ profile: lit(1), segments: lit(2) }))).toEqual({ inputs: ['profile', 'segments'], output: true });
  });
});
