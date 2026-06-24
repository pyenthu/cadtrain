import { describe, it, expect } from 'vitest';
import {
  newGraph,
  addExprNode,
  addExprOutput,
  setExprOutputName,
  setExprOutputFormula,
  removeExprOutput,
} from './composition-graph';
import { deriveExprInputs } from './graph-exprs';
import type { ExprNode } from './composition-graph-types';

const exprOf = (g: any, id: string) => g.nodes[id] as ExprNode;

describe('Expr block — model + mutators (B.7 v2, step 1)', () => {
  it('adds a floating Expr block (one output `out = a`), NOT in the root list', () => {
    const { graph, id } = addExprNode(newGraph());
    const n = exprOf(graph, id);
    expect(n.type).toBe('expr');
    expect(n.outputs).toEqual([{ name: 'out', formula: 'a' }]);
    expect(graph.layout[id]).toBeTruthy();
    const root = graph.nodes[graph.root] as any;
    expect((root.children ?? []).includes(id)).toBe(false);
  });

  it('supports multiple named outputs with their own formulas', () => {
    let { graph, id } = addExprNode(newGraph());
    graph = setExprOutputName(graph, id, 0, 'wall');
    graph = setExprOutputFormula(graph, id, 0, '(od - id) / 2');
    graph = addExprOutput(graph, id);
    graph = setExprOutputName(graph, id, 1, 'bore');
    graph = setExprOutputFormula(graph, id, 1, 'od > 10 ? id : 0');
    expect(exprOf(graph, id).outputs).toEqual([
      { name: 'wall', formula: '(od - id) / 2' },
      { name: 'bore', formula: 'od > 10 ? id : 0' },
    ]);
  });

  it('keeps at least one output (removeExprOutput no-op on the last)', () => {
    let { graph, id } = addExprNode(newGraph());
    graph = addExprOutput(graph, id);
    expect(exprOf(graph, id).outputs).toHaveLength(2);
    graph = removeExprOutput(graph, id, 1);
    graph = removeExprOutput(graph, id, 0);
    expect(exprOf(graph, id).outputs).toHaveLength(1);
  });

  it('mutators are immutable — the original graph is untouched', () => {
    const { graph: g0, id } = addExprNode(newGraph());
    const g1 = setExprOutputFormula(g0, id, 0, 'a + b');
    expect(exprOf(g0, id).outputs[0]!.formula).toBe('a');
    expect(exprOf(g1, id).outputs[0]!.formula).toBe('a + b');
  });
});

describe('deriveExprInputs — hybrid port model (auto-derive inputs)', () => {
  const block = (outputs: { name: string; formula: string }[]): ExprNode =>
    ({ id: 'x', type: 'expr', outputs });

  it('free symbols become inputs, in first-appearance order', () => {
    expect(deriveExprInputs(block([{ name: 'out', formula: '(od - id) / 2' }])))
      .toEqual(['od', 'id']);
  });

  it('excludes allow-listed functions and constants', () => {
    expect(deriveExprInputs(block([{ name: 'out', formula: 'clamp(min(a, b), 0, pi)' }])))
      .toEqual(['a', 'b']); // clamp/min are fns, pi is a constant
  });

  it('a formula referencing a SIBLING output is not an input', () => {
    const n = block([
      { name: 'wall', formula: '(od - id) / 2' },
      { name: 'mid', formula: 'wall + od' },
    ]);
    expect(deriveExprInputs(n)).toEqual(['od', 'id']); // `wall` is an output, not an input
  });

  it('dedupes across outputs and skips unparseable formulas', () => {
    const n = block([
      { name: 'a', formula: 'x + y' },
      { name: 'b', formula: 'x *' },       // parse error → skipped
      { name: 'c', formula: 'y * z' },
    ]);
    expect(deriveExprInputs(n)).toEqual(['x', 'y', 'z']);
  });
});
