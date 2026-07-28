import { describe, it, expect } from 'vitest';
import { MaterialKind } from '../material';
import type { EmitCtx } from '../../node-kind';
import type { Graph, MaterialNode } from '$lib/graph/composition/composition-graph-types';

const node = (name?: string): MaterialNode => ({ id: 'mat1', type: 'material', name } as MaterialNode);
const ctx = (): EmitCtx => ({
  ref: (id) => id, emitValue: (v) => String((v as any).value),
  varNames: new Map(), listProducers: new Set(), nodes: {},
});
const graph: Graph = { nodes: {}, root: 'r', params: {}, edges: [], imports: [], layout: {} } as any;

describe('MaterialKind — view-only node', () => {
  it('emitExpr = null (never in the render tree)', () => {
    expect(MaterialKind.emitExpr(node('steel'), ctx())).toBeNull();
  });
  it('validate = [] (no broken-ref surface)', () => {
    expect(MaterialKind.validate(node('steel'), graph)).toEqual([]);
  });
  it('inputRefs = []', () => {
    expect(MaterialKind.inputRefs(node('steel'))).toEqual([]);
  });
  it('size = label-fit pill, h 30', () => {
    // default name 'material' (8 chars): max(128, 88 + 8*7.5) = max(128, 148) = 148
    expect(MaterialKind.size(node(), { width: 0, root: 'r' })).toEqual({ w: 148, h: 30 });
    // short name falls back to the 128 floor: 'x' → max(128, 88+7.5)=128
    expect(MaterialKind.size(node('x'), { width: 0, root: 'r' })).toEqual({ w: 128, h: 30 });
  });
  it('sockets = no inputs, material output', () => {
    expect(MaterialKind.sockets(node('steel'))).toEqual({ inputs: [], output: 'material' });
  });
});
