/**
 * expr-schema.ts — the SHARED allowlist for the expression builder
 * (B.6 / id 914).
 *
 * This is the single source of truth for what a calculated expression
 * (`graph.exprs[]`, see composition-graph-types.ts `GraphExpr`) may contain.
 * It is imported by BOTH the validator and the emitter (graph-exprs.ts) so the
 * two can never drift — the grammar the popup statically validates is exactly
 * the grammar the bake `const e_<name> = …` evaluates (docs/plans/
 * expression-builder.md §5 + §9 "Don't drift two evaluators").
 *
 * Pure data + tiny helpers. No mathjs import here (kept dependency-free so the
 * allowlist is cheap to import anywhere); the AST walk lives in graph-exprs.ts.
 */

// ─── allowlists ─────────────────────────────────────────────────────────────

/** Allowed FUNCTION names (called as `fn(args)`). Common CAD math only — no
 *  I/O, no reflection, no host globals. Anything outside this set is rejected
 *  as a `FunctionNode` with a disallowed callee. */
export const ALLOWED_FUNCTIONS: ReadonlySet<string> = new Set([
  'sin', 'cos', 'tan',
  'asin', 'acos', 'atan', 'atan2',
  'sqrt', 'cbrt', 'hypot',
  'abs', 'sign',
  'min', 'max', 'clamp',
  'pow', 'exp', 'log', 'log2', 'log10',
  'floor', 'ceil', 'round', 'mod',
]);

/** Allowed bare CONSTANT symbols (referenced as a plain `SymbolNode`, not
 *  called). `e` is deliberately EXCLUDED — it is the reserved namespace root
 *  for `e.<name>` calculated-expression references (a bare `e` would be both
 *  ambiguous and useless in arithmetic). */
export const ALLOWED_CONSTANTS: ReadonlySet<string> = new Set([
  'pi', 'tau', 'PI',
]);

/** The two namespace ROOTS valid only as the object of a member access:
 *  `p.<param>` (positional bake input) and `e.<name>` (calculated expr). A
 *  bare `p` or `e` SymbolNode is rejected — only the dotted member form is a
 *  number. */
export const NAMESPACE_ROOTS: ReadonlySet<string> = new Set(['p', 'e']);

/** Per-function arity. A `number` is an exact count; a `[min, max]` tuple is an
 *  inclusive range (`Infinity` max = variadic). Functions absent from this map
 *  are not arity-checked (but must still be in ALLOWED_FUNCTIONS to be called).
 */
export const FUNCTION_ARITY: Readonly<Record<string, number | [number, number]>> = {
  // unary
  sin: 1, cos: 1, tan: 1,
  asin: 1, acos: 1, atan: 1,
  sqrt: 1, cbrt: 1,
  abs: 1, sign: 1,
  exp: 1, log2: 1, log10: 1,
  floor: 1, ceil: 1, round: 1,
  // fixed-binary
  atan2: 2, pow: 2, mod: 2,
  // ranged
  log: [1, 2],            // log(x) | log(x, base)
  min: [1, Infinity],
  max: [1, Infinity],
  hypot: [1, Infinity],
  clamp: 3,
};

// ─── allowed-input builder ──────────────────────────────────────────────────

/** The allowed-input set for a given schema context. `dotted` holds the full
 *  member names (`p.od`, `e.wall`); `roots` is the set of valid namespace
 *  roots so a bare-root SymbolNode can be told apart from an unknown symbol. */
export interface AllowedInputs {
  dotted: ReadonlySet<string>;
  roots: ReadonlySet<string>;
}

/** Build the allowed-input set from the part's param names + the declared expr
 *  names. `p.<param>` covers positional bake inputs; `e.<name>` covers other
 *  calculated expressions (so one expr can reference another — the topo layer
 *  in graph-exprs.ts orders them). Imported by the validator. */
export function buildAllowedInputs(paramNames: Iterable<string>, exprNames: Iterable<string>): AllowedInputs {
  const dotted = new Set<string>();
  for (const p of paramNames) dotted.add(`p.${p}`);
  for (const e of exprNames) dotted.add(`e.${e}`);
  return { dotted, roots: NAMESPACE_ROOTS };
}

/** AST node types that are SAFE inside a calculated expression. The validator
 *  rejects any node whose `type` is not in this set — which structurally rules
 *  out AssignmentNode / FunctionAssignmentNode / BlockNode / ObjectNode /
 *  RangeNode / ArrayNode (no side effects, no declarations, no host access).
 *  `AccessorNode` + `IndexNode` are allowed but further constrained to the
 *  `p.`/`e.` namespaces by the per-node walk. */
export const SAFE_NODE_TYPES: ReadonlySet<string> = new Set([
  'ConstantNode',
  'OperatorNode',
  'ParenthesisNode',
  'FunctionNode',
  'SymbolNode',
  'AccessorNode',
  'IndexNode',
  'ConditionalNode',
]);

/** Is `name` a valid identifier for an expr output / param (so `e.<name>` /
 *  `p.<name>` are well-formed)? */
export function isIdentSafe(name: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(name);
}
