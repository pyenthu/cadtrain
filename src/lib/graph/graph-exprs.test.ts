/**
 * graph-exprs.test.ts — PR-1 of the expression builder (B.6 / id 914).
 *
 * Covers the pure topo-eval + emit layer:
 *  - topo order (a `const e_*` is declared after the consts it references)
 *  - cycle → clear error (never throws)
 *  - an `e.*` referencing `p.*` (positional bake input)
 *  - NO-exprs ⇒ byte-identical emit (the sparse/optional guarantee)
 */
import { describe, expect, it } from 'vitest';
import {
  topoOrderExprs,
  emitExprConsts,
  extractExprRefs,
  parseExpr,
  rewriteExprRefs,
  exprVarName,
} from './graph-exprs';
import { newGraph, addCall, addParam } from './composition-graph';
import { asExpr } from './composition-graph-types';
import { emitGraph } from './composition-emit';
import type { GraphExpr } from './composition-graph-types';

describe('graph-exprs — reference extraction', () => {
  it('extracts only e.* references (not p.* or bare symbols)', () => {
    const p = parseExpr('e.wall + p.od / 2 + e.gap - pi');
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const refs = extractExprRefs(p.ast);
    expect([...refs].sort()).toEqual(['gap', 'wall']);
  });
});

describe('graph-exprs — topo order', () => {
  it('orders dependents after their dependencies', () => {
    const exprs: GraphExpr[] = [
      { name: 'outer', src: 'e.mid * 2' },
      { name: 'mid', src: 'e.base + 1' },
      { name: 'base', src: 'p.od' },
    ];
    const res = topoOrderExprs(exprs);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.order.indexOf('base')).toBeLessThan(res.order.indexOf('mid'));
    expect(res.order.indexOf('mid')).toBeLessThan(res.order.indexOf('outer'));
  });

  it('emits const lines in dependency order', () => {
    const exprs: GraphExpr[] = [
      { name: 'outer', src: 'e.base * 2' },
      { name: 'base', src: 'p.od / 2' },
    ];
    const res = emitExprConsts(exprs);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.lines).toEqual([
      'const e_base = p.od / 2;',
      'const e_outer = e.base * 2;',
    ]);
    // base declared before outer
    expect(res.lines[0]).toContain('e_base');
    expect(res.lines[1]).toContain('e_outer');
  });
});

describe('graph-exprs — cycle detection (never throws)', () => {
  it('returns a clear error on a direct cycle', () => {
    const exprs: GraphExpr[] = [
      { name: 'a', src: 'e.b + 1' },
      { name: 'b', src: 'e.a + 1' },
    ];
    const res = topoOrderExprs(exprs);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/cyclic/i);
  });

  it('returns a clear error on a self-cycle', () => {
    const res = topoOrderExprs([{ name: 'a', src: 'e.a + 1' }]);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/cyclic/i);
  });

  it('emitExprConsts surfaces the cycle error rather than throwing', () => {
    const res = emitExprConsts([
      { name: 'x', src: 'e.y' },
      { name: 'y', src: 'e.x' },
    ]);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/cyclic/i);
  });

  it('rejects duplicate + unsafe names', () => {
    expect(topoOrderExprs([{ name: 'a', src: '1' }, { name: 'a', src: '2' }]).ok).toBe(false);
    expect(topoOrderExprs([{ name: '1bad', src: '1' }]).ok).toBe(false);
  });
});

describe('graph-exprs — e.* referencing p.*', () => {
  it('emits a const referencing the live params object', () => {
    const res = emitExprConsts([{ name: 'wall', src: '(p.od - p.id) / 2' }]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.lines).toEqual(['const e_wall = (p.od - p.id) / 2;']);
  });
});

describe('graph-exprs — rewriteExprRefs', () => {
  it('rewrites e.<name> to e_<name>, leaves p.* untouched', () => {
    expect(rewriteExprRefs('e.wall * 2 + p.od')).toBe('e_wall * 2 + p.od');
    expect(exprVarName('wall')).toBe('e_wall');
  });
  it('is idempotent + does not touch identifiers that merely end in e', () => {
    expect(rewriteExprRefs('e_wall + p.shape')).toBe('e_wall + p.shape');
    expect(rewriteExprRefs('phase.x')).toBe('phase.x');
  });
});

describe('graph-exprs — emit integration', () => {
  it('NO exprs ⇒ byte-identical emit (absent vs empty array)', () => {
    let g = newGraph();
    const r = addCall(g, 'r_cuboid', { od: asExpr('p.od') });
    g = r.graph;
    g = addParam(g, 'od', { default: 3 });

    const absent = emitGraph(g, { id: 'demo' }).source;
    const empty = emitGraph({ ...g, exprs: [] }, { id: 'demo' }).source;
    expect(empty).toBe(absent);
    // and nothing expr-shaped leaked into the body
    expect(absent).not.toContain('const e_');
  });

  it('with exprs ⇒ prepends the const block + rewrites e.* in the body', () => {
    let g = newGraph();
    const r = addCall(g, 'r_cuboid', { od: asExpr('e.wall * 2') });
    g = r.graph;
    g = addParam(g, 'od', { default: 3 });
    g = addParam(g, 'id', { default: 1 });
    g = { ...g, exprs: [{ name: 'wall', src: '(p.od - p.id) / 2' }] };

    const { body } = emitGraph(g, { id: 'demo' });
    // The body (not the meta.graph JSON, which stores raw ArgValues) carries
    // the prepended const + the rewritten reference.
    expect(body).toContain('const e_wall = (p.od - p.id) / 2;');
    expect(body).toContain('e_wall * 2');     // body reference rewritten
    expect(body).not.toContain('e.wall');     // raw namespace ref fully rewritten
  });

  it('with a cyclic expr set ⇒ a loud throw is emitted, not silent drift', () => {
    let g = newGraph();
    const r = addCall(g, 'r_cuboid', {});
    g = r.graph;
    g = { ...g, exprs: [{ name: 'a', src: 'e.b' }, { name: 'b', src: 'e.a' }] };
    const src = emitGraph(g, { id: 'demo' }).source;
    expect(src).toMatch(/throw new Error\([^)]*expression error/);
  });

  it('round-trips exprs through serialise (meta.graph carries them)', () => {
    let g = newGraph();
    g = { ...g, exprs: [{ name: 'wall', src: 'p.od / 2' }] };
    const { meta } = emitGraph(g, { id: 'demo' });
    const graphBlock = (meta as any).graph;
    expect(graphBlock.exprs).toEqual([{ name: 'wall', src: 'p.od / 2' }]);
  });
});
