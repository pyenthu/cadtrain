import { describe, it, expect } from 'vitest';
import {
  newGraph,
  addParam,
  addExprNode,
  addExprOutput,
  setExprOutputName,
  setExprOutputFormula,
  setExprInputBinding,
  asParam,
  asLiteral,
} from './composition-graph';
import { emitGraph, emitExprBlocks } from './composition-emit';
import { exprBlockVar } from './graph-exprs';

/** Index of the first `const <name> =` declaration in the emitted body. */
const declAt = (body: string, name: string) => body.indexOf(`const ${name} =`);

describe('emitExprBlocks — Expr-block prelude (B.7 v2, step 1.5)', () => {
  it('emits input consts then output consts, output formula rewritten to the namespaced consts', () => {
    let { graph, id } = addExprNode(newGraph());
    graph = addParam(graph, 'od_body', { default: 5 });
    graph = setExprOutputName(graph, id, 0, 'wall');
    graph = setExprOutputFormula(graph, id, 0, '(od - id) / 2');
    // Inputs derive as [od, id]; bind od → a param, id → a literal.
    graph = setExprInputBinding(graph, id, 'od', asParam('od_body'));
    graph = setExprInputBinding(graph, id, 'id', asLiteral(2));

    const { body } = emitGraph(graph, { id: 'test_wall' });
    const v = exprBlockVar(id);

    expect(body).toContain(`const ${v}_od = p.od_body;`);
    expect(body).toContain(`const ${v}_id = 2;`);
    expect(body).toContain(`const ${v}_wall = (${v}_od - ${v}_id) / 2;`);

    // Input consts emit BEFORE the output that consumes them.
    expect(declAt(body, `${v}_od`)).toBeLessThan(declAt(body, `${v}_wall`));
    expect(declAt(body, `${v}_id`)).toBeLessThan(declAt(body, `${v}_wall`));
    // od derives before id (first-appearance order in the formula).
    expect(declAt(body, `${v}_od`)).toBeLessThan(declAt(body, `${v}_id`));
  });

  it('orders multiple outputs in LOCAL topo order (a referenced sibling output emits first)', () => {
    // Declare `b` (formula `a + 1`) BEFORE `a` (formula `od`) so declaration
    // order is [b, a] but topo MUST reorder to [a, b].
    let { graph, id } = addExprNode(newGraph());
    graph = setExprOutputName(graph, id, 0, 'b');
    graph = setExprOutputFormula(graph, id, 0, 'a + 1');
    graph = addExprOutput(graph, id);
    graph = setExprOutputName(graph, id, 1, 'a');
    graph = setExprOutputFormula(graph, id, 1, 'od');

    const { body } = emitGraph(graph, { id: 'test_topo' });
    const v = exprBlockVar(id);

    // `a` (the dependency) emits before `b` (which references it).
    expect(declAt(body, `${v}_a`)).toBeGreaterThan(-1);
    expect(declAt(body, `${v}_b`)).toBeGreaterThan(-1);
    expect(declAt(body, `${v}_a`)).toBeLessThan(declAt(body, `${v}_b`));
    expect(body).toContain(`const ${v}_b = ${v}_a + 1;`);
    // `a` is an output, not an input — only `od` is a derived input.
    expect(body).toContain(`const ${v}_od = 0 /* unbound input */;`);
  });

  it('an unbound input emits a safe 0 default and the output references it', () => {
    // The default block is `out = a` ⇒ one derived input `a`, unbound.
    const { graph, id } = addExprNode(newGraph());
    const { body } = emitGraph(graph, { id: 'test_unbound' });
    const v = exprBlockVar(id);
    expect(body).toContain(`const ${v}_a = 0 /* unbound input */;`);
    expect(body).toContain(`const ${v}_out = ${v}_a;`);
  });

  it('no expr blocks ⇒ no prelude (byte-identical guarantee)', () => {
    const g = newGraph();
    expect(emitExprBlocks(g)).toEqual([]);
    const { body } = emitGraph(g, { id: 'empty' });
    expect(body).not.toContain('_x_');
  });

  it('the binding storage is name-keyed and reconciles on a formula edit', () => {
    let { graph, id } = addExprNode(newGraph());
    graph = setExprOutputName(graph, id, 0, 'wall');
    graph = setExprOutputFormula(graph, id, 0, '(od - id) / 2');
    graph = setExprInputBinding(graph, id, 'od', asLiteral(8));
    graph = setExprInputBinding(graph, id, 'id', asLiteral(2));
    expect((graph.nodes[id] as any).bindings).toEqual({ od: asLiteral(8), id: asLiteral(2) });

    // Drop `id` from the formula — its binding must be pruned (name-keyed).
    graph = setExprOutputFormula(graph, id, 0, 'od * 2');
    expect((graph.nodes[id] as any).bindings).toEqual({ od: asLiteral(8) });
  });
});
