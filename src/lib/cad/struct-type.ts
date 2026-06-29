/**
 * struct-type.ts — structural TYPE INFERENCE for expression OUTPUTS
 * (typed-expression-outputs, Phase A).
 *
 * Today an expression output is annotated by hand (`scalar` | `list<point>`).
 * This module derives the structure DIRECTLY from the formula so an output left
 * at the new "auto" default can be typed without a manual annotation — and,
 * crucially, so a raw array literal like `[[0,2,2],[2,0,1]]` is recognised as a
 * `list<point3>` for ANY point arity (2D / 3D / N), not a hard-coded 2D guess.
 *
 * Pure module (no Svelte, no graph deps). It shares the SAME minimal mathjs
 * parser core as graph-exprs.ts (parse + node types only — no evaluate, no
 * function library) so the AST it walks is byte-identical to the one validation
 * + emit walk.
 *
 *   inferStructure(formula) → { type: StructType | null, error: string | null }
 *   structLabel(type)       → 'list<point3>' | 'list<point2>' | 'number' | …
 *
 * The walk is intentionally shallow + structural: a number / symbol / arithmetic
 * expression is a `scalar`, an array literal is a `list` (with consistent-length
 * detection → `len`, and a plain-language error on mixed inner lengths), and the
 * three list builders (`range` / `map` / `concat`) infer their element type from
 * the index range + the lambda body. It never EVALUATES — it only describes the
 * shape the formula will produce.
 */
import { create, parseDependencies, type MathNode } from 'mathjs';
const { parse } = create(parseDependencies);

// ─── the descriptor ─────────────────────────────────────────────────────────

/** A recursive description of the shape an expression produces. Flat by
 *  design (the research's flat-`list<element>` decision) but recursive so a
 *  `list<list<…>>` (a list of points) is expressible. `len` is the STATICALLY
 *  known element count when it can be determined (an array literal's item
 *  count, a constant `range`/`concat` length) — undefined when the count is
 *  data-dependent (a `map` over a `range(N)` with a symbolic `N`). */
export type StructType =
  | { kind: 'scalar' }
  | { kind: 'flag' }                                   // a boolean (comparison / literal true/false)
  | { kind: 'list'; of: StructType; len?: number }
  | { kind: 'record'; fields: { name: string; type: StructType }[] }
  | { kind: 'unknown' };                               // shape can't be determined

export interface InferResult {
  /** The inferred descriptor, or null when inference failed (see `error`). */
  type: StructType | null;
  /** A plain-language reason inference failed (parse error, mixed lengths, …),
   *  or null on success. */
  error: string | null;
}

// ─── label ──────────────────────────────────────────────────────────────────

/** ELEMENT label — how the thing INSIDE a list reads. A `list<scalar>` of known
 *  arity ≥ 2 reads as a POINT of that arity: len-2 → `point2`, len-3 → `point3`,
 *  len-N → `pointN` (so any arity is named — the keystone of "works for ANY
 *  point arity"). Any other list-of-scalar (unknown / 0/1-wide) stays
 *  `list<number>`. */
function elemLabel(t: StructType): string {
  switch (t.kind) {
    case 'scalar':  return 'number';
    case 'flag':    return 'flag';
    case 'unknown': return '?';
    case 'record':  return 'record';
    case 'list': {
      if (t.of.kind === 'scalar' && typeof t.len === 'number' && t.len >= 2) {
        return `point${t.len}`;
      }
      return `list<${elemLabel(t.of)}>`;
    }
  }
}

/** Human label for a descriptor — the badge text. The TOP-LEVEL list always
 *  reads as `list<…>` (a flat number list is `list<number>`, NOT `pointN` — the
 *  point-collapse applies only to the ELEMENT type), so a list of 3-wide number
 *  rows is `list<point3>` and a flat number list is `list<number>`. */
export function structLabel(t: StructType | null): string {
  if (!t) return '?';
  switch (t.kind) {
    case 'scalar':  return 'number';
    case 'flag':    return 'flag';
    case 'unknown': return '?';
    case 'record':  return 'record';
    case 'list':    return `list<${elemLabel(t.of)}>`;
  }
}

// ─── inference ──────────────────────────────────────────────────────────────

const ok = (type: StructType): InferResult => ({ type, error: null });
const fail = (error: string): InferResult => ({ type: null, error });

/** Structurally equal descriptors (used to detect heterogeneous array rows). */
function sameKind(a: StructType, b: StructType): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'list' && b.kind === 'list') return sameKind(a.of, b.of);
  return true;
}

/** `return` is reader-friendly sugar in a multi-line list body; mathjs has no
 *  return keyword (the last block statement is the value), so drop it before
 *  parsing — mirrors graph-exprs.stripReturn so inference + emit agree. */
function stripReturn(formula: string): string {
  return formula.replace(/\breturn\b/g, ' ');
}

/** Numeric literal value of a node if it is a plain constant number (used to
 *  resolve a constant `range(...)` length), else null. */
function constNum(node: any): number | null {
  if (node?.type === 'ConstantNode' && typeof node.value === 'number') return node.value;
  // a unary minus on a constant: `range(0, -1)` etc.
  if (node?.type === 'OperatorNode' && node.op === '-' && (node.args ?? []).length === 1) {
    const inner = constNum(node.args[0]);
    return inner == null ? null : -inner;
  }
  return null;
}

/** Infer the structure of one parsed mathjs node. */
function inferNode(node: any): InferResult {
  switch (node?.type) {
    case 'ConstantNode':
      return ok(typeof node.value === 'boolean' ? { kind: 'flag' } : { kind: 'scalar' });

    case 'SymbolNode':
      // A bare name is (in this CAD grammar) a numeric param/var. Treat as scalar.
      return ok({ kind: 'scalar' });

    case 'ParenthesisNode':
      return inferNode(node.content);

    case 'OperatorNode': {
      // Comparison / logical operators yield a boolean; arithmetic yields a number.
      const BOOL_OPS = new Set(['==', '!=', '<', '>', '<=', '>=', 'and', 'or', 'not', 'xor']);
      return ok(BOOL_OPS.has(node.op) ? { kind: 'flag' } : { kind: 'scalar' });
    }

    case 'ConditionalNode': {
      // `cond ? a : b` — both branches should agree; infer the true branch and
      // fall back to the false branch when the true side is unknown.
      const t = inferNode(node.trueExpr);
      if (t.error) return t;
      if (t.type && t.type.kind !== 'unknown') return t;
      return inferNode(node.falseExpr);
    }

    case 'ArrayNode':
      return inferArray(node.items ?? []);

    case 'FunctionAssignmentNode':
      // a lambda `f(i) = body` — its structure IS its body's (map uses this).
      return inferNode(node.expr);

    case 'AssignmentNode':
      // `name = value` used as a value resolves to its right-hand side.
      return inferNode(node.value);

    case 'BlockNode': {
      const blocks = (node.blocks ?? []) as any[];
      if (!blocks.length) return ok({ kind: 'unknown' });
      return inferNode(blocks[blocks.length - 1].node);
    }

    case 'FunctionNode':
      return inferFunction(node);

    default:
      return ok({ kind: 'unknown' });
  }
}

/** Infer an array literal `[a, b, …]` — a `list`, with consistent-length
 *  detection (mixed inner lengths is a plain-language error). */
function inferArray(items: any[]): InferResult {
  if (items.length === 0) return ok({ kind: 'list', of: { kind: 'unknown' }, len: 0 });

  const elems: StructType[] = [];
  for (const it of items) {
    const r = inferNode(it);
    if (r.error) return r;                     // propagate the first failure
    elems.push(r.type ?? { kind: 'unknown' });
  }

  // Mixed inner lengths — the canonical "rows have mixed lengths: 3, 2" error.
  if (elems.every((e) => e.kind === 'list')) {
    const lens = elems
      .map((e) => (e as Extract<StructType, { kind: 'list' }>).len)
      .filter((n): n is number => typeof n === 'number');
    const distinct = [...new Set(lens)];
    if (distinct.length > 1) {
      return fail(`rows have mixed lengths: ${lens.join(', ')}`);
    }
  }

  // Heterogeneous element KINDS (a scalar next to a list, etc.).
  const first = elems[0]!;
  if (!elems.every((e) => sameKind(e, first))) {
    const kinds = [...new Set(elems.map((e) => e.kind))];
    return fail(`rows have mixed types: ${kinds.join(', ')}`);
  }

  return ok({ kind: 'list', of: first, len: items.length });
}

/** Infer a function call — only the three list builders change the shape; every
 *  allow-listed math function (cos / sin / sqrt / …) returns a scalar. */
function inferFunction(node: any): InferResult {
  const fn: string = node.fn?.name ?? '';
  const args: any[] = node.args ?? [];

  if (fn === 'range') {
    // range(stop) | range(start, stop) → a list<scalar>; length known only when
    // the bounds are constant.
    let len: number | undefined;
    if (args.length === 1) {
      const stop = constNum(args[0]);
      if (stop != null) len = Math.max(0, Math.floor(stop));
    } else if (args.length >= 2) {
      const start = constNum(args[0]);
      const stop = constNum(args[1]);
      if (start != null && stop != null) len = Math.max(0, Math.floor(stop - start));
    }
    return ok({ kind: 'list', of: { kind: 'scalar' }, len });
  }

  if (fn === 'map') {
    // map(arr, f(i)=body) → a list whose ELEMENT type is the lambda body's, and
    // whose LENGTH is the source list's length.
    const arr = args[0] ? inferNode(args[0]) : ok({ kind: 'unknown' });
    if (arr.error) return arr;
    const body = args[1] ? inferNode(args[1]) : ok({ kind: 'unknown' });
    if (body.error) return body;
    const len = arr.type?.kind === 'list' ? arr.type.len : undefined;
    return ok({ kind: 'list', of: body.type ?? { kind: 'unknown' }, len });
  }

  if (fn === 'concat') {
    // concat(a, b, …) → a list; element type from the first list arg, length =
    // the sum of the parts' lengths when all are known.
    const parts: StructType[] = [];
    for (const a of args) {
      const r = inferNode(a);
      if (r.error) return r;
      parts.push(r.type ?? { kind: 'unknown' });
    }
    const firstList = parts.find((p) => p.kind === 'list') as
      | Extract<StructType, { kind: 'list' }>
      | undefined;
    const of = firstList?.of ?? { kind: 'unknown' as const };
    let len: number | undefined = 0;
    for (const p of parts) {
      if (p.kind === 'list' && typeof p.len === 'number') len += p.len;
      else { len = undefined; break; }
    }
    return ok({ kind: 'list', of, len });
  }

  // Any other (allow-listed) math function → a scalar value.
  return ok({ kind: 'scalar' });
}

/**
 * Infer the structure of an expression-output formula. Never throws: a parse
 * failure or a structural inconsistency surfaces as `{ type: null, error }`.
 * An empty formula has no structure yet → `{ type: null, error: null }`.
 */
export function inferStructure(formula: string): InferResult {
  const f = stripReturn(formula);
  if (f.trim() === '') return { type: null, error: null };
  let ast: MathNode;
  try {
    ast = parse(f);
  } catch (e: any) {
    return fail(`parse error: ${e?.message ?? String(e)}`);
  }
  return inferNode(ast as any);
}
