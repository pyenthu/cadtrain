/**
 * composition-material.test.ts — the MATERIAL node data core (G-MAT-CARD).
 *
 * Covers the pure model: add/update/remove material nodes, bind/unbind to a
 * Call part, effective-appearance resolution, and the emit → hydrate round-trip
 * (the floating node + materialBindings must survive save/reload).
 */
import { describe, expect, it } from 'vitest';
import {
  newGraph, addCall, addMaterialNode, updateMaterialNode, removeMaterialNode,
  bindMaterial, unbindMaterial, resolveEffectiveAppearance, hydrateGraph,
} from './composition-graph';
import { emitGraph } from './composition-emit';

function graphWithOnePart() {
  let g = newGraph();
  const { graph, id } = addCall(g, 'g_shaft');
  return { graph, callId: id };
}

describe('material node — model', () => {
  it('adds a floating material node with defaults', () => {
    const { graph } = graphWithOnePart();
    const { graph: g2, id } = addMaterialNode(graph);
    expect(g2.nodes[id].type).toBe('material');
    expect((g2.nodes[id] as any).colorOuter).toBe('#cc2222');
  });

  it('binds a material to a Call and resolves its bundle', () => {
    const { graph, callId } = graphWithOnePart();
    const { graph: g2, id: matId } = addMaterialNode(graph);
    const g3 = updateMaterialNode(g2, matId, { colorOuter: '#00aaff', opacity: 0.2, texture: 'steel' });
    const g4 = bindMaterial(g3, callId, matId);
    expect(g4.materialBindings?.[callId]).toBe(matId);
    const eff = resolveEffectiveAppearance(g4, callId);
    expect(eff).toEqual({ colorOuter: '#00aaff', opacity: 0.2, texture: 'steel' });
  });

  it('update clears a field with null / "none"', () => {
    const { graph } = graphWithOnePart();
    let { graph: g, id } = addMaterialNode(graph);
    g = updateMaterialNode(g, id, { material: 'steel', colorOuter: '#111111' });
    expect((g.nodes[id] as any).material).toBe('steel');
    g = updateMaterialNode(g, id, { material: 'none', colorOuter: null });
    expect((g.nodes[id] as any).material).toBeUndefined();
    expect((g.nodes[id] as any).colorOuter).toBeUndefined();
  });

  it('effective appearance falls back to partAppearance when unbound', () => {
    const { graph, callId } = graphWithOnePart();
    const g2 = { ...graph, partAppearance: { [callId]: { colorOuter: '#abcabc' } } };
    expect(resolveEffectiveAppearance(g2, callId)).toEqual({ colorOuter: '#abcabc' });
  });

  it('unbind restores partAppearance fallback; empty map drops to undefined', () => {
    const { graph, callId } = graphWithOnePart();
    const { graph: g2, id: matId } = addMaterialNode(graph);
    const g3 = bindMaterial(g2, callId, matId);
    const g4 = unbindMaterial(g3, callId);
    expect(g4.materialBindings).toBeUndefined();
  });

  it('removing a material node strips its bindings', () => {
    const { graph, callId } = graphWithOnePart();
    const { graph: g2, id: matId } = addMaterialNode(graph);
    const g3 = bindMaterial(g2, callId, matId);
    const g4 = removeMaterialNode(g3, matId);
    expect(g4.nodes[matId]).toBeUndefined();
    expect(g4.materialBindings).toBeUndefined();
  });
});

describe('material node — emit → hydrate round-trip', () => {
  it('material node + binding survive save/reload', () => {
    const { graph, callId } = graphWithOnePart();
    const { graph: g2, id: matId } = addMaterialNode(graph);
    const g3 = updateMaterialNode(g2, matId, { name: 'Steel', material: 'steel', opacity: 0.3 });
    const g4 = bindMaterial(g3, callId, matId);

    // Emit side: the floating node + the binding key land in the source.
    const src = emitGraph(g4, { id: 'w_mat_test' }).source;
    expect(src).toContain('materialBindings');
    expect(src).toContain("type: 'material'");

    // Hydrate side: a JSON-cloned graph (what serialize→reload does to it)
    // restores the material node + binding. g4 is shaped like the serialised
    // graph (nodes/root/params/imports/layout/materialBindings).
    const back = hydrateGraph(JSON.parse(JSON.stringify(g4)));
    // The material node round-trips (it lives in graph.nodes).
    const mat = Object.values(back.nodes).find((n: any) => n.type === 'material') as any;
    expect(mat).toBeTruthy();
    expect(mat.material).toBe('steel');
    // The binding round-trips and still resolves.
    const boundCall = Object.keys(back.materialBindings ?? {})[0];
    expect(boundCall).toBeTruthy();
    expect(resolveEffectiveAppearance(back, boundCall).material).toBe('steel');
  });

  it('a graph with no material wiring emits no materialBindings key', () => {
    const { graph } = graphWithOnePart();
    const src = emitGraph(graph, { id: 'w_plain' }).source;
    expect(src).not.toContain('materialBindings');
  });
});
