import { describe, it, expect } from 'vitest';
import {
  newGraph,
  addExprDef,
  addExprInstance,
  setExprDefName,
  removeExprDef,
  addExprDefParam,
  setExprDefParamName,
  setExprDefParamDefault,
  removeExprDefParam,
  addExprDefConst,
  setExprDefConstName,
  setExprDefConstValue,
  addExprDefVar,
  setExprDefVarFormula,
  addExprDefOutput,
  setExprDefOutputName,
  setExprDefOutputFormula,
  removeExprDefOutput,
  setExprInputBinding,
  clearExprInputBinding,
  asLiteral,
} from './composition-graph';
import { deriveInputNames } from './graph-exprs';
import type { ExprDef, ExprNode } from './composition-graph-types';

const defOf = (g: any, id: string): ExprDef => (g.exprDefs ?? []).find((d: ExprDef) => d.id === id)!;

describe('ExprDef — definition + section mutators (B.7 v3)', () => {
  it('adds an EMPTY def (auto-named, four empty sections)', () => {
    const { graph, id } = addExprDef(newGraph());
    const d = defOf(graph, id);
    expect(d.name).toBe('expr_1');
    expect(d).toMatchObject({ params: [], consts: [], vars: [], outputs: [] });
  });

  it('builds all four sections + renames the def', () => {
    let { graph, id } = addExprDef(newGraph());
    graph = setExprDefName(graph, id, 'wall');
    graph = addExprDefParam(graph, id);
    graph = setExprDefParamName(graph, id, 0, 'od');
    graph = setExprDefParamDefault(graph, id, 0, 5);
    graph = addExprDefConst(graph, id);
    graph = setExprDefConstName(graph, id, 0, 'two');
    graph = setExprDefConstValue(graph, id, 0, 2);
    graph = addExprDefVar(graph, id);
    graph = setExprDefVarFormula(graph, id, 0, 'od / two');
    graph = addExprDefOutput(graph, id);
    graph = setExprDefOutputName(graph, id, 0, 'r');
    graph = setExprDefOutputFormula(graph, id, 0, 'v1');

    const d = defOf(graph, id);
    expect(d.name).toBe('wall');
    expect(d.params).toEqual([{ name: 'od', default: 5 }]);
    expect(d.consts).toEqual([{ name: 'two', value: 2 }]);
    expect(d.vars).toEqual([{ name: 'v1', formula: 'od / two' }]);
    expect(d.outputs).toEqual([{ name: 'r', formula: 'v1' }]);
  });

  it('clears a param default via undefined', () => {
    let { graph, id } = addExprDef(newGraph());
    graph = addExprDefParam(graph, id);
    graph = setExprDefParamDefault(graph, id, 0, 9);
    expect(defOf(graph, id).params[0]!.default).toBe(9);
    graph = setExprDefParamDefault(graph, id, 0, undefined);
    expect(defOf(graph, id).params[0]!.default).toBeUndefined();
  });

  it('auto-names new rows uniquely across the whole def namespace', () => {
    let { graph, id } = addExprDef(newGraph());
    graph = addExprDefParam(graph, id);   // p1
    graph = setExprDefParamName(graph, id, 0, 'c1'); // collides with the next const default name
    graph = addExprDefConst(graph, id);   // would be c1 → bumps to c2
    expect(defOf(graph, id).consts[0]!.name).toBe('c2');
  });

  it('removes rows + the whole def', () => {
    let { graph, id } = addExprDef(newGraph());
    graph = addExprDefParam(graph, id);
    graph = addExprDefParam(graph, id);
    graph = removeExprDefParam(graph, id, 0);
    expect(defOf(graph, id).params).toHaveLength(1);
    graph = addExprDefOutput(graph, id);
    graph = removeExprDefOutput(graph, id, 0);
    expect(defOf(graph, id).outputs).toHaveLength(0);
    graph = removeExprDef(graph, id);
    expect((graph.exprDefs ?? []).length).toBe(0);
  });

  it('mutators are immutable — the original graph is untouched', () => {
    const { graph: g0, id } = addExprDef(newGraph());
    const g1 = setExprDefName(g0, id, 'renamed');
    expect(defOf(g0, id).name).toBe('expr_1');
    expect(defOf(g1, id).name).toBe('renamed');
  });
});

describe('Expr instance — drop + per-PARAM bindings (B.7 v3)', () => {
  it('drops a thin instance referencing the def, NOT in the root list', () => {
    const built = addExprDef(newGraph());
    const { graph, id } = addExprInstance(built.graph, built.id);
    const n = graph.nodes[id] as ExprNode;
    expect(n.type).toBe('expr');
    expect(n.defId).toBe(built.id);
    expect(graph.layout[id]).toBeTruthy();
    const root = graph.nodes[graph.root] as any;
    expect((root.children ?? []).includes(id)).toBe(false);
  });

  it('binds + clears a PARAM, dropping the bindings field when empty', () => {
    const built = addExprDef(newGraph());
    let { graph, id } = addExprInstance(built.graph, built.id);
    graph = setExprInputBinding(graph, id, 'od', asLiteral(8));
    expect((graph.nodes[id] as ExprNode).bindings).toEqual({ od: asLiteral(8) });
    graph = clearExprInputBinding(graph, id, 'od');
    expect((graph.nodes[id] as ExprNode).bindings).toBeUndefined();
  });
});

describe('deriveInputNames — v2→v3 migration helper', () => {
  it('free symbols become params, in first-appearance order', () => {
    expect(deriveInputNames([{ name: 'out', formula: '(od - id) / 2' }])).toEqual(['od', 'id']);
  });
  it('excludes allow-listed functions and constants', () => {
    expect(deriveInputNames([{ name: 'out', formula: 'clamp(min(a, b), 0, pi)' }])).toEqual(['a', 'b']);
  });
  it('a formula referencing a SIBLING output is not a param', () => {
    expect(deriveInputNames([
      { name: 'wall', formula: '(od - id) / 2' },
      { name: 'mid', formula: 'wall + od' },
    ])).toEqual(['od', 'id']);
  });
  it('dedupes across formulas and skips unparseable ones', () => {
    expect(deriveInputNames([
      { name: 'a', formula: 'x + y' },
      { name: 'b', formula: 'x *' },
      { name: 'c', formula: 'y * z' },
    ])).toEqual(['x', 'y', 'z']);
  });
});
