import { describe, it, expect } from 'vitest';
import { newGraph, addCall, addPolygon, type CallNode, type PolygonNode } from './composition-graph';
import { dispatchEditorTool, readEditorState } from './editor-tools';

/**
 * Pure-fn tests for the Phase-1 editor tool dispatcher. Build a tiny graph, run
 * addParam + setCallArg + wireArgToParam + addPolygonPoint + setPolygonCoord,
 * and assert the resulting graph — no browser, no Claude.
 */

function fixture() {
  const base = newGraph();
  const { graph: g1, id: callId } = addCall(base, 'r_cuboid', {}, undefined);
  const { graph: g2, id: polyId } = addPolygon(g1); // 3 default points
  return { graph: g2, callId, polyId, alias: (g2.nodes[callId] as CallNode).alias };
}

describe('dispatchEditorTool — Phase 1', () => {
  it('addParam adds a PARAMS row', () => {
    const { graph } = fixture();
    const r = dispatchEditorTool('addParam', { name: 'OD', default: 3.5, min: 1, max: 10, step: 0.1 }, graph);
    expect(r.error).toBeUndefined();
    expect(r.graph.params.OD).toEqual({ default: 3.5, min: 1, max: 10, step: 0.1 });
    // idempotent on a second add
    const r2 = dispatchEditorTool('addParam', { name: 'OD', default: 9 }, r.graph);
    expect(r2.error).toBeUndefined();
    expect((r2.result as any).idempotent).toBe(true);
    expect(r2.graph.params.OD!.default).toBe(3.5); // unchanged
  });

  it('setParamSchema errors when the param is missing, updates when present', () => {
    const { graph } = fixture();
    const miss = dispatchEditorTool('setParamSchema', { name: 'NOPE', default: 1 }, graph);
    expect(miss.error).toMatch(/no param named/);
    const g1 = dispatchEditorTool('addParam', { name: 'wall', default: 0.2 }, graph).graph;
    const ok = dispatchEditorTool('setParamSchema', { name: 'wall', default: 0.25, max: 1 }, g1);
    expect(ok.error).toBeUndefined();
    expect(ok.graph.params.wall).toEqual({ default: 0.25, max: 1 });
  });

  it('setCallArg sets a literal (object form) and accepts a bare scalar', () => {
    const { graph, callId } = fixture();
    const r = dispatchEditorTool('setCallArg', { node: callId, key: 'w', value: { kind: 'literal', value: 2 } }, graph);
    expect(r.error).toBeUndefined();
    expect((r.graph.nodes[callId] as CallNode).args.w).toEqual({ kind: 'literal', value: 2 });
    // bare scalar → literal
    const r2 = dispatchEditorTool('setCallArg', { node: callId, key: 'h', value: 5 }, r.graph);
    expect((r2.graph.nodes[callId] as CallNode).args.h).toEqual({ kind: 'literal', value: 5 });
  });

  it('wireArgToParam resolves a node by ALIAS and wires to a param', () => {
    const { graph, callId, alias } = fixture();
    const g1 = dispatchEditorTool('addParam', { name: 'OD', default: 3.5 }, graph).graph;
    const r = dispatchEditorTool('wireArgToParam', { node: alias, key: 'd', param: 'OD' }, g1);
    expect(r.error).toBeUndefined();
    expect((r.graph.nodes[callId] as CallNode).args.d).toEqual({ kind: 'param', param: 'OD' });
  });

  it('setCallArg errors on an unknown node', () => {
    const { graph } = fixture();
    const r = dispatchEditorTool('setCallArg', { node: 'n_zzzzzz', key: 'w', value: 1 }, graph);
    expect(r.error).toMatch(/node not found/);
  });

  it('addPolygonPoint appends a vertex; setPolygonCoord sets one coord', () => {
    const { graph, polyId } = fixture();
    const before = (graph.nodes[polyId] as PolygonNode).points.length;
    const r = dispatchEditorTool('addPolygonPoint', { polygon: polyId }, graph);
    expect(r.error).toBeUndefined();
    expect((r.graph.nodes[polyId] as PolygonNode).points.length).toBe(before + 1);

    const r2 = dispatchEditorTool('setPolygonCoord', { polygon: polyId, idx: 0, axis: 'r', value: 2 }, r.graph);
    expect(r2.error).toBeUndefined();
    const p0 = (r2.graph.nodes[polyId] as PolygonNode).points[0]!;
    expect(p0.kind).toBe('point');
    expect((p0 as any).r).toEqual({ kind: 'literal', value: 2 });

    // expr ArgValue on z
    const r3 = dispatchEditorTool(
      'setPolygonCoord',
      { polygon: polyId, idx: 0, axis: 'z', value: { kind: 'expr', expr: 'p.len/2' } },
      r2.graph,
    );
    expect((((r3.graph.nodes[polyId] as PolygonNode).points[0]) as any).z).toEqual({ kind: 'expr', expr: 'p.len/2' });
  });

  it('setPolygonCoord errors on an out-of-range idx', () => {
    const { graph, polyId } = fixture();
    const r = dispatchEditorTool('setPolygonCoord', { polygon: polyId, idx: 99, axis: 'r', value: 1 }, graph);
    expect(r.error).toMatch(/out of range/);
  });

  it('getEditorState reports params + nodes + selection without mutating', () => {
    const { graph, callId, polyId } = fixture();
    const g1 = dispatchEditorTool('addParam', { name: 'OD', default: 3.5 }, graph).graph;
    const r = dispatchEditorTool('getEditorState', {}, g1, { selectedId: callId, activeTab: 'tab-1' });
    expect(r.error).toBeUndefined();
    expect(r.graph).toBe(g1); // read-only — same reference
    const state = r.result as ReturnType<typeof readEditorState>;
    expect(state.params.some((p) => p.name === 'OD')).toBe(true);
    expect(state.nodes.some((n) => n.id === callId && n.type === 'call')).toBe(true);
    expect(state.nodes.some((n) => n.id === polyId && n.type === 'polygon')).toBe(true);
    expect(state.selectedId).toBe(callId);
    expect(state.activeTab).toBe('tab-1');
  });

  it('rejects an unknown tool name', () => {
    const { graph } = fixture();
    const r = dispatchEditorTool('frobnicate', {}, graph);
    expect(r.error).toMatch(/unknown tool/);
  });
});
