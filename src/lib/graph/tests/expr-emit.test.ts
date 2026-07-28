import { describe, it, expect } from 'vitest';
import {
  newGraph,
  addParam,
  hydrateGraph,
  addExprDef,
  addExprInstance,
  addExprDefParam,
  setExprDefParamName,
  setExprDefParamDefault,
  addExprDefConst,
  setExprDefConstName,
  setExprDefConstValue,
  addExprDefVar,
  setExprDefVarName,
  setExprDefVarFormula,
  addExprDefOutput,
  setExprDefOutputName,
  setExprDefOutputFormula,
  setExprInputBinding,
  asParam,
  asLiteral,
} from '$lib/graph/composition/composition-graph';
import { emitGraph, emitExprBlocks } from '$lib/graph/composition/composition-emit';
import { exprBlockVar, orderExprDef } from '$lib/graph/expr/graph-exprs';
import type { ExprDef } from '$lib/graph/composition/composition-graph-types';

/** Index of the first `const <name> =` declaration in the emitted body. */
const declAt = (body: string, name: string) => body.indexOf(`const ${name} =`);

/** Build a four-section def `wall(od, id) → wall` with a const `two` and a var
 *  `diff`. Returns { graph, defId }. */
function fourSectionDef(g0 = newGraph()) {
  let { graph, id: defId } = addExprDef(g0);
  graph = addExprDefParam(graph, defId);  // od
  graph = setExprDefParamName(graph, defId, 0, 'od');
  graph = addExprDefParam(graph, defId);  // id
  graph = setExprDefParamName(graph, defId, 1, 'id');
  graph = addExprDefConst(graph, defId);
  graph = setExprDefConstName(graph, defId, 0, 'two');
  graph = setExprDefConstValue(graph, defId, 0, 2);
  graph = addExprDefVar(graph, defId);
  graph = setExprDefVarName(graph, defId, 0, 'diff');
  graph = setExprDefVarFormula(graph, defId, 0, 'od - id');
  graph = addExprDefOutput(graph, defId);
  graph = setExprDefOutputName(graph, defId, 0, 'wall');
  graph = setExprDefOutputFormula(graph, defId, 0, 'diff / two');
  return { graph, defId };
}

describe('emitExprBlocks — four-section ExprDef instance prelude (B.7 v3)', () => {
  it('emits params → consts → vars → outputs, locals rewritten to V_*', () => {
    let { graph, defId } = fourSectionDef();
    graph = addParam(graph, 'od_body', { default: 5 });
    const inst = addExprInstance(graph, defId); graph = inst.graph;
    graph = setExprInputBinding(graph, inst.id, 'od', asParam('od_body'));
    graph = setExprInputBinding(graph, inst.id, 'id', asLiteral(2));

    const { body } = emitGraph(graph, { id: 'test_wall' });
    const V = exprBlockVar(inst.id);

    expect(body).toContain(`const ${V}_od = p.od_body;`);   // PARAM (wired)
    expect(body).toContain(`const ${V}_id = 2;`);           // PARAM (literal)
    expect(body).toContain(`const ${V}_two = 2;`);          // CONST
    expect(body).toContain(`const ${V}_diff = ${V}_od - ${V}_id;`);    // VAR
    expect(body).toContain(`const ${V}_wall = ${V}_diff / ${V}_two;`); // OUTPUT

    // Section order: params + consts before the var, the var before the output.
    expect(declAt(body, `${V}_od`)).toBeLessThan(declAt(body, `${V}_two`));
    expect(declAt(body, `${V}_two`)).toBeLessThan(declAt(body, `${V}_diff`));
    expect(declAt(body, `${V}_diff`)).toBeLessThan(declAt(body, `${V}_wall`));
  });

  it('a param with no binding emits its default, else 0', () => {
    let { graph, id: defId } = addExprDef(newGraph());
    graph = addExprDefParam(graph, defId);
    graph = setExprDefParamName(graph, defId, 0, 'gap');
    graph = setExprDefParamDefault(graph, defId, 0, 7);
    graph = addExprDefParam(graph, defId);
    graph = setExprDefParamName(graph, defId, 1, 'bare');
    graph = addExprDefOutput(graph, defId);
    graph = setExprDefOutputName(graph, defId, 0, 'sum');
    graph = setExprDefOutputFormula(graph, defId, 0, 'gap + bare');
    const inst = addExprInstance(graph, defId); graph = inst.graph;

    const { body } = emitGraph(graph, { id: 'test_default' });
    const V = exprBlockVar(inst.id);
    expect(body).toContain(`const ${V}_gap = 7;`);  // default
    expect(body).toContain(`const ${V}_bare = 0;`); // no default, no binding
    expect(body).toContain(`const ${V}_sum = ${V}_gap + ${V}_bare;`);
  });

  it('two instances of one def → two independent V-namespaced groups', () => {
    const built = fourSectionDef();
    let graph = built.graph;
    const a = addExprInstance(graph, built.defId); graph = a.graph;
    graph = setExprInputBinding(graph, a.id, 'od', asLiteral(10));
    const b = addExprInstance(graph, built.defId); graph = b.graph;
    graph = setExprInputBinding(graph, b.id, 'od', asLiteral(20));

    const { body } = emitGraph(graph, { id: 'test_two' });
    const Va = exprBlockVar(a.id);
    const Vb = exprBlockVar(b.id);
    expect(Va).not.toBe(Vb);
    expect(body).toContain(`const ${Va}_od = 10;`);
    expect(body).toContain(`const ${Vb}_od = 20;`);
    expect(body).toContain(`const ${Va}_wall = ${Va}_diff / ${Va}_two;`);
    expect(body).toContain(`const ${Vb}_wall = ${Vb}_diff / ${Vb}_two;`);
  });

  it('editing the def propagates to every instance', () => {
    const built = fourSectionDef();
    let graph = built.graph;
    const a = addExprInstance(graph, built.defId); graph = a.graph;
    const b = addExprInstance(graph, built.defId); graph = b.graph;
    graph = setExprDefOutputFormula(graph, built.defId, 0, 'diff * two');

    const { body } = emitGraph(graph, { id: 'test_edit' });
    const Va = exprBlockVar(a.id);
    const Vb = exprBlockVar(b.id);
    expect(body).toContain(`const ${Va}_wall = ${Va}_diff * ${Va}_two;`);
    expect(body).toContain(`const ${Vb}_wall = ${Vb}_diff * ${Vb}_two;`);
    expect(body).not.toContain(`/ ${Va}_two`);
  });

  it('outputs emit in TOPO order (a referenced sibling output emits first)', () => {
    // Declare `b = a + 1` BEFORE `a = 5` so declaration order is [b, a] but
    // topo must reorder to [a, b].
    let { graph, id: defId } = addExprDef(newGraph());
    graph = addExprDefOutput(graph, defId);
    graph = setExprDefOutputName(graph, defId, 0, 'b');
    graph = setExprDefOutputFormula(graph, defId, 0, 'a + 1');
    graph = addExprDefOutput(graph, defId);
    graph = setExprDefOutputName(graph, defId, 1, 'a');
    graph = setExprDefOutputFormula(graph, defId, 1, '5');
    const inst = addExprInstance(graph, defId); graph = inst.graph;

    const { body } = emitGraph(graph, { id: 'test_topo' });
    const V = exprBlockVar(inst.id);
    expect(declAt(body, `${V}_a`)).toBeGreaterThan(-1);
    expect(declAt(body, `${V}_a`)).toBeLessThan(declAt(body, `${V}_b`));
    expect(body).toContain(`const ${V}_b = ${V}_a + 1;`);
  });

  it('a cyclic def falls back to declaration order + a flag, never throws', () => {
    let { graph, id: defId } = addExprDef(newGraph());
    graph = addExprDefVar(graph, defId);
    graph = setExprDefVarName(graph, defId, 0, 'x');
    graph = setExprDefVarFormula(graph, defId, 0, 'y + 1');
    graph = addExprDefVar(graph, defId);
    graph = setExprDefVarName(graph, defId, 1, 'y');
    graph = setExprDefVarFormula(graph, defId, 1, 'x + 1');
    const def = (graph.exprDefs ?? []).find((d) => d.id === defId)!;
    const ordered = orderExprDef(def);
    expect(ordered.cyclic).toBe(true);
    const varItems = ordered.order.filter((o) => o.section === 'var');
    expect(varItems.map((o: any) => o.vardef.name)).toEqual(['x', 'y']);

    const inst = addExprInstance(graph, defId); graph = inst.graph;
    expect(() => emitGraph(graph, { id: 'test_cycle' })).not.toThrow();
  });

  it('no exprDefs / no instances ⇒ no prelude (byte-identical guarantee)', () => {
    const g = newGraph();
    expect(emitExprBlocks(g)).toEqual([]);
    const { body } = emitGraph(g, { id: 'empty' });
    expect(body).not.toContain('_x_');

    // A def with NO instance also emits nothing.
    const { graph } = fourSectionDef();
    expect(emitExprBlocks(graph)).toEqual([]);
    expect(emitGraph(graph, { id: 'no_inst' }).body).not.toContain('_x_');
  });
});

describe('hydrateGraph — v2/v1 expression migration (B.7 v3, §v3.7)', () => {
  it('migrates a v2 ExprNode{outputs,bindings} → ExprDef + instance, emit preserved', () => {
    const rootId = 'n_root0';
    const exprId = 'n_expr0';
    const serialised = {
      root: rootId,
      params: {},
      imports: [],
      layout: {},
      nodes: {
        [rootId]: { id: rootId, type: 'list', children: [] },
        [exprId]: {
          id: exprId, type: 'expr',
          outputs: [{ name: 'wall', formula: '(od - id) / 2' }],
          bindings: { od: { kind: 'literal', value: 8 }, id: { kind: 'literal', value: 2 } },
        },
      },
    };
    const g = hydrateGraph(serialised);

    expect(g.exprDefs?.length).toBe(1);
    const def = g.exprDefs![0]!;
    expect(def.outputs).toEqual([{ name: 'wall', formula: '(od - id) / 2' }]);
    expect(def.params.map((p) => p.name)).toEqual(['od', 'id']);
    expect(def.params.every((p) => p.default === undefined)).toBe(true);
    expect(def.consts).toEqual([]);
    expect(def.vars).toEqual([]);

    const inst = g.nodes[exprId] as any;
    expect(inst.type).toBe('expr');
    expect(inst.defId).toBe(def.id);
    expect(inst.outputs).toBeUndefined();
    expect(inst.bindings).toEqual({ od: { kind: 'literal', value: 8 }, id: { kind: 'literal', value: 2 } });

    const { body } = emitGraph(g, { id: 'mig' });
    const V = exprBlockVar(exprId);
    expect(body).toContain(`const ${V}_od = 8;`);
    expect(body).toContain(`const ${V}_id = 2;`);
    expect(body).toContain(`const ${V}_wall = (${V}_od - ${V}_id) / 2;`);
  });

  it('migration is idempotent (re-hydrating the migrated graph is a no-op)', () => {
    const rootId = 'n_root1';
    const exprId = 'n_expr1';
    const serialised = {
      root: rootId, params: {}, imports: [], layout: {},
      nodes: {
        [rootId]: { id: rootId, type: 'list', children: [] },
        [exprId]: { id: exprId, type: 'expr', outputs: [{ name: 'out', formula: 'a' }] },
      },
    };
    const g1 = hydrateGraph(serialised);
    const reSer = JSON.parse(JSON.stringify({ ...g1, edges: undefined }));
    const g2 = hydrateGraph(reSer);
    expect(g2.exprDefs?.length).toBe(1);
    expect((g2.nodes[exprId] as any).defId).toBe((g1.nodes[exprId] as any).defId);
  });

  it('migrates a v1 graph.exprs[] row → a single-output def (name-deduped)', () => {
    const rootId = 'n_root2';
    const serialised = {
      root: rootId, params: {}, imports: [], layout: {},
      nodes: { [rootId]: { id: rootId, type: 'list', children: [] } },
      exprs: [{ name: 'wall', src: '(p.od - p.id) / 2' }],
    };
    const g = hydrateGraph(serialised);
    expect(g.exprs).toEqual([{ name: 'wall', src: '(p.od - p.id) / 2' }]); // legacy path kept
    const def = (g.exprDefs ?? []).find((d) => d.name === 'wall');
    expect(def).toBeTruthy();
    expect(def!.outputs).toEqual([{ name: 'wall', formula: '(p.od - p.id) / 2' }]);

    const reSer = JSON.parse(JSON.stringify({ ...g, edges: undefined }));
    const g2 = hydrateGraph(reSer);
    expect((g2.exprDefs ?? []).filter((d) => d.name === 'wall').length).toBe(1);
  });

  it('round-trips a graph carrying exprDefs through serialise → hydrate', () => {
    const { graph, defId } = fourSectionDef();
    const withInst = addExprInstance(graph, defId);
    const { meta } = emitGraph(withInst.graph, { id: 'rt' });
    const g2 = hydrateGraph((meta as any).graph);
    const def: ExprDef | undefined = (g2.exprDefs ?? []).find((d) => d.id === defId);
    expect(def).toBeTruthy();
    expect(def!.params.map((p) => p.name)).toEqual(['od', 'id']);
    expect(def!.consts).toEqual([{ name: 'two', value: 2 }]);
    expect(def!.vars).toEqual([{ name: 'diff', formula: 'od - id' }]);
    expect(def!.outputs).toEqual([{ name: 'wall', formula: 'diff / two' }]);
  });
});
