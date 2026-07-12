import { describe, it, expect } from 'vitest';
import { MethodKind } from '../method';
import type { EmitCtx } from '../../node-kind';
import type { Graph, MethodNode } from '../../../composition-graph-types';

const node: MethodNode = { id: 'm1', type: 'method', op: 'subtract', obj: 'a', arg: 'b' };
const ctx = (): EmitCtx => ({
  ref: (id) => (id === 'a' ? 'A' : id === 'b' ? 'B' : `?${id}`),
  emitValue: (v) => String((v as any).value),
  varNames: new Map(), listProducers: new Set(), nodes: {},
});
const graph = (nodes: Record<string, any>): Graph => ({ nodes, root: 'r', params: {}, edges: [], imports: [], layout: {} } as any);

describe('MethodKind', () => {
  it('emitExpr → obj.op(arg)', () => {
    expect(MethodKind.emitExpr(node, ctx())).toBe('A.subtract(B)');
  });
  it('validate flags a missing obj and arg', () => {
    expect(MethodKind.validate(node, graph({ a: {}, b: {} }))).toEqual([]);
    const errs = MethodKind.validate(node, graph({ a: {} })); // arg 'b' missing
    expect(errs).toEqual([{ nodeId: 'm1', slot: 'arg', badRef: 'b', kind: 'missing-node' }]);
  });
  it('inputRefs = [obj, arg]', () => {
    expect(MethodKind.inputRefs(node)).toEqual(['a', 'b']);
  });
  it('size = fixed 40×40 operator circle', () => {
    expect(MethodKind.size(node, { width: 999, root: 'r' })).toEqual({ w: 40, h: 40 });
  });
  it('sockets = obj/arg inputs + output', () => {
    expect(MethodKind.sockets(node)).toEqual({ inputs: ['obj', 'arg'], output: true });
  });
});
