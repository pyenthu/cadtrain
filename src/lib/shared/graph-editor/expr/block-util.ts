/**
 * block-util.ts — tiny shared helpers for the read-only expression block tree
 * (expression builder PR-3; docs/plans/expression-builder.md §4/§7).
 *
 * The block components hold their AST node ref and highlight red iff that node
 * appears in the validator's error list. Error identity is REFERENCE equality:
 * `validateExpr` returns the SAME MathNode objects the renderer walks (the AST
 * is parsed once, derived, and shared), so `e.node === node` is a faithful key.
 */
import { getContext } from 'svelte';
import type { MathNode } from 'mathjs';
import type { ExprError } from '$lib/cad/graph-exprs';

/** Does any error key the given node? (red-highlight test for a block) */
export function hasError(errors: ExprError[], node: MathNode | undefined | null): boolean {
  if (!node) return false;
  return errors.some((e) => e.node === node);
}

/** Context key for the "clicked error → focus this block" highlight. The popup
 *  puts a `$state({ node })` object under this key; every block reads it (no
 *  prop threading) and rings itself when `node === ownNode`. */
export const EXPR_FOCUS_KEY = Symbol('exprFocus');

/** Read the focus-state object from context (undefined outside the popup). */
export function focusStore(): { node: MathNode | null } | undefined {
  return getContext(EXPR_FOCUS_KEY);
}

/** Pretty operator glyph for display (× / ÷ read better than * /). */
export function opGlyph(op: string): string {
  switch (op) {
    case '*': return '×';
    case '/': return '÷';
    default: return op;
  }
}

/** The `p.od` / `e.wall` full member name for an AccessorNode (best-effort). */
export function accessorName(node: any): string {
  const root = node?.object?.type === 'SymbolNode' ? node.object.name : '?';
  const prop = typeof node?.name === 'string' ? node.name : '?';
  return `${root}.${prop}`;
}
