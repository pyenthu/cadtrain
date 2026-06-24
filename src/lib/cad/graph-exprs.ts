/**
 * graph-exprs.ts — PURE topo-eval + static validation for the calculated
 * expressions of the expression builder (B.6 / id 914).
 *
 * Two concerns, both pure + tested (graph-exprs.test.ts + expr-validate.test.ts):
 *
 *  1. ORDER + EMIT — parse each `GraphExpr.src` with mathjs, extract its
 *     `e.<name>` references, build a dependency DAG among the declared exprs,
 *     topo-sort it, detect cycles (returns a clear error object — NEVER throws
 *     uncaught), and produce the ordered `const e_<name> = <src>;` emit
 *     sequence. The emitter (composition-emit.ts) prepends that block ahead of
 *     the consuming body; `e.<name>` references resolve to those consts.
 *
 *  2. VALIDATION — `validateExpr(ast, schema)` walks the AST and rejects
 *     SymbolNodes not in the allowed inputs, FunctionNodes not in the allowlist
 *     (+ arity), member access outside the `p.`/`e.` namespaces, and any node
 *     type outside SAFE_NODE_TYPES (which structurally rules out assignments,
 *     function declarations, blocks, object/array literals — no side effects,
 *     no host access). Returns a flat error list keyed to the offending nodes.
 *
 * The allowlist + arity + safe-node set live in the SHARED expr-schema.ts so
 * the validator and the emitter can never drift (one grammar, one truth).
 *
 * The `e.<name>` EMIT CONVENTION: each declared expr becomes a top-of-body
 * `const e_<name> = <src>;`. References `e.<name>` (in expr srcs AND in any
 * consuming ArgValue) are rewritten to the flat identifier `e_<name>` so they
 * resolve to the const. `p.<param>` is UNCHANGED — `p` is the live params
 * object already in bake scope.
 */

// Tree-shake: build a MINIMAL mathjs instance with ONLY `parse` + its node
// types (no `evaluate`, no function library) via the factory/dependency-
// injection entry. The monolith `import { parse } from 'mathjs'` pulls the
// fully-configured instance (~250 KB gzip); `create(parseDependencies)` drops
// that to the parser core (docs/plans/expression-builder.md §9). PR-3's live
// numeric preview will add `evaluateDependencies` if/when needed.
import { create, parseDependencies, type MathNode } from 'mathjs';
const { parse } = create(parseDependencies);
import type { GraphExpr, ExprNode } from './composition-graph-types';
import {
  ALLOWED_FUNCTIONS,
  ALLOWED_CONSTANTS,
  FUNCTION_ARITY,
  SAFE_NODE_TYPES,
  buildAllowedInputs,
  isIdentSafe,
  type AllowedInputs,
} from './expr-schema';

// ─── the e.<name> emit convention ───────────────────────────────────────────

/** The flat-identifier prefix a declared `e.<name>` becomes in emitted JS:
 *  `e.wall` → `e_wall`. (A flat const per expr, NOT an `e` object literal, so
 *  one expr can reference an earlier one in topo order.) */
export const EXPR_VAR_PREFIX = 'e_';

/** The flat var name for a declared expr (`wall` → `e_wall`). */
export function exprVarName(name: string): string {
  return EXPR_VAR_PREFIX + name;
}

/** Rewrite every `e.<name>` member reference in a source string to the flat
 *  `e_<name>` identifier the emit declares. `p.<param>` is left untouched.
 *  Anchored so it only fires on a real `e` namespace root (word-boundary
 *  before `e`, an identifier after the dot) — never inside `pe.x`, `somee.x`,
 *  or a flat `e_wall` it already produced (idempotent). Used by the emitter on
 *  the const block + the consuming body in one pass. */
export function rewriteExprRefs(src: string): string {
  return src.replace(/(^|[^\w$.])e\.([A-Za-z_$][\w$]*)/g, (_m, pre: string, name: string) => `${pre}${EXPR_VAR_PREFIX}${name}`);
}

// ─── error model (never throw uncaught) ─────────────────────────────────────

/** One validation error, keyed to the offending AST node (so the visual
 *  builder can highlight exactly that block). `node` is undefined for whole-
 *  expression errors (parse failure). */
export interface ExprError {
  /** The offending AST node, when the error is local to one. */
  node?: MathNode;
  /** Human-readable message. */
  msg: string;
}

/** The result of ordering a set of exprs for emit. A discriminated union so
 *  callers handle the cycle / parse-error case explicitly — this module never
 *  throws on bad user input. */
export type OrderResult =
  | { ok: true; order: string[] }
  | { ok: false; error: string };

// ─── reference extraction ───────────────────────────────────────────────────

/** Extract the set of `e.<name>` references in one already-parsed AST — the
 *  edges of the dependency DAG. An `e.<name>` is an AccessorNode whose object
 *  is the SymbolNode `e` and whose property is `name`. */
export function extractExprRefs(ast: MathNode): Set<string> {
  const refs = new Set<string>();
  ast.traverse((node: any) => {
    if (node.type === 'AccessorNode'
      && node.object?.type === 'SymbolNode'
      && node.object.name === 'e'
      && typeof node.name === 'string'
      && node.name.length > 0) {
      refs.add(node.name);
    }
  });
  return refs;
}

/** Auto-derive an Expr block's INPUT socket names (hybrid port model, B.7 v2).
 *  An input is every FREE symbol across the block's output formulas that is
 *  NOT one of the block's own output names and NOT an allow-listed
 *  function/constant. Returns names in first-appearance order. Unparseable
 *  formulas are skipped (the caller freezes the block's last-good ports). */
export function deriveExprInputs(node: ExprNode): string[] {
  const outNames = new Set(node.outputs.map((o) => o.name));
  const seen = new Set<string>();
  const inputs: string[] = [];
  for (const out of node.outputs) {
    const parsed = parseExpr(out.formula);
    if (!parsed.ok) continue;
    parsed.ast.traverse((n: any, _path: string, parent: any) => {
      if (n.type !== 'SymbolNode') return;
      if (parent?.type === 'FunctionNode' && parent.fn === n) return; // function name
      if (ALLOWED_CONSTANTS.has(n.name)) return;                      // pi, e, …
      if (outNames.has(n.name)) return;                               // sibling output
      if (!seen.has(n.name)) { seen.add(n.name); inputs.push(n.name); }
    });
  }
  return inputs;
}

/** Parse one expression source. Returns the AST or a parse error — never
 *  throws. */
export function parseExpr(src: string): { ok: true; ast: MathNode } | { ok: false; error: string } {
  try {
    return { ok: true, ast: parse(src) };
  } catch (e: any) {
    return { ok: false, error: `parse error: ${e?.message ?? String(e)}` };
  }
}

/** Every bare value SYMBOL in a formula — function names + allow-listed
 *  constants (pi, e, …) excluded. Used by the Expr-block emitter to discover
 *  which sibling outputs a formula references (free-symbol ∩ output-names =
 *  the local dependency edges → topo order). Unparseable ⇒ empty set. */
export function freeSymbols(formula: string): Set<string> {
  const out = new Set<string>();
  const parsed = parseExpr(formula);
  if (!parsed.ok) return out;
  parsed.ast.traverse((n: any, _path: string, parent: any) => {
    if (n.type !== 'SymbolNode') return;
    if (parent?.type === 'FunctionNode' && parent.fn === n) return; // function name
    if (ALLOWED_CONSTANTS.has(n.name)) return;                      // pi, e, …
    out.add(n.name);
  });
  return out;
}

// ─── Expr-block emit naming (B.7 / id 914 v2, step 1.5) ─────────────────────
//
// An Expr block emits a flat `const <blockvar>_<member> = …;` per derived
// INPUT and per declared OUTPUT into the body PRELUDE (see emitExprBlocks in
// composition-emit.ts). `<blockvar>` is a PURE function of the node id so the
// emitter AND the wire handler (which has no access to the topo order) compute
// the SAME identifier when an output socket is wired into a consumer's arg.

/** Stable per-block JS var prefix derived from the node id. `n_abc123` →
 *  `_x_n_abc123`. Deterministic — no graph / topo dependency. */
export function exprBlockVar(nodeId: string): string {
  return '_x_' + nodeId.replace(/[^A-Za-z0-9_$]/g, '_');
}

/** The flat const name an Expr block input/output binds to:
 *  `exprBlockMember('n_abc', 'wall')` → `_x_n_abc_wall`. */
export function exprBlockMember(nodeId: string, member: string): string {
  return `${exprBlockVar(nodeId)}_${member}`;
}

/** Rewrite a formula's LOCAL names (its derived inputs + sibling output names)
 *  to the namespaced `<blockvar>_<name>` consts the block emits. Word-boundary
 *  anchored; a name preceded by `.` (member access) is left alone. Formulas use
 *  ONLY local names (never `p.*`/`e.*`), so a bare-symbol rewrite is safe —
 *  mirrors `rewriteExprRefs`. */
export function rewriteExprLocalRefs(formula: string, blockVar: string, locals: ReadonlySet<string>): string {
  return formula.replace(/(^|[^\w$.])([A-Za-z_$][\w$]*)/g, (m, pre: string, id: string) =>
    locals.has(id) ? `${pre}${blockVar}_${id}` : m);
}

// ─── topological order ──────────────────────────────────────────────────────

/** Topologically order the declared exprs by their `e.<name>` dependencies so
 *  a `const e_<name>` is always emitted AFTER the consts it references. Detects
 *  cycles + duplicate / unsafe names and returns a clear error (never throws).
 *  References to UNDECLARED `e.*` names are ignored here (they are surfaced by
 *  the per-expr validator as "Unknown input"); topo only orders edges among
 *  the declared set. */
export function topoOrderExprs(exprs: readonly GraphExpr[]): OrderResult {
  // Index by name; reject dup / unsafe names up front.
  const byName = new Map<string, GraphExpr>();
  for (const ex of exprs) {
    if (!isIdentSafe(ex.name)) return { ok: false, error: `invalid expr name: "${ex.name}"` };
    if (byName.has(ex.name)) return { ok: false, error: `duplicate expr name: "${ex.name}"` };
    byName.set(ex.name, ex);
  }

  // Build the dependency edges (name → set of declared e.* names it uses).
  const deps = new Map<string, Set<string>>();
  for (const ex of exprs) {
    const parsed = parseExpr(ex.src);
    if (!parsed.ok) return { ok: false, error: `${ex.name}: ${parsed.error}` };
    const refs = extractExprRefs(parsed.ast);
    const declaredRefs = new Set<string>();
    for (const r of refs) if (byName.has(r)) declaredRefs.add(r);
    deps.set(ex.name, declaredRefs);
  }

  // Kahn-style DFS topo sort with cycle detection. WHITE=unseen,
  // GREY=on-stack, BLACK=done.
  const order: string[] = [];
  const colour = new Map<string, 0 | 1 | 2>();
  for (const name of byName.keys()) colour.set(name, 0);

  let cycleErr: string | null = null;
  const stack: string[] = [];
  const visit = (name: string): void => {
    if (cycleErr) return;
    const c = colour.get(name);
    if (c === 2) return;
    if (c === 1) {
      const from = stack.indexOf(name);
      const loop = [...stack.slice(from), name].join(' → ');
      cycleErr = `cyclic expression dependency: ${loop}`;
      return;
    }
    colour.set(name, 1);
    stack.push(name);
    for (const dep of deps.get(name) ?? []) {
      visit(dep);
      if (cycleErr) return;
    }
    stack.pop();
    colour.set(name, 2);
    order.push(name);
  };

  // Visit in declaration order for a stable, deterministic result.
  for (const ex of exprs) {
    visit(ex.name);
    if (cycleErr) return { ok: false, error: cycleErr };
  }
  return { ok: true, order };
}

// ─── emit ────────────────────────────────────────────────────────────────────

/** The ordered `const e_<name> = <src>;` declaration lines for a set of exprs,
 *  or a clear error (cycle / parse failure / bad name). The const RHS keeps the
 *  raw `src`; nested `e.<other>` references are NOT yet rewritten here — the
 *  emitter applies `rewriteExprRefs` across the whole body (const block +
 *  consumers) in one pass so the flat-identifier convention is applied exactly
 *  once. Returns `lines: []` for an empty/absent expr set (the byte-identical
 *  guarantee). */
export function emitExprConsts(exprs: readonly GraphExpr[] | undefined): { ok: true; lines: string[] } | { ok: false; error: string } {
  if (!exprs || exprs.length === 0) return { ok: true, lines: [] };
  const ordered = topoOrderExprs(exprs);
  if (!ordered.ok) return { ok: false, error: ordered.error };
  const byName = new Map(exprs.map((e) => [e.name, e]));
  const lines = ordered.order.map((name) => {
    const ex = byName.get(name)!;
    return `const ${exprVarName(name)} = ${ex.src};`;
  });
  return { ok: true, lines };
}

// ─── validation (the AST allowlist walk) ────────────────────────────────────

/** The validation context — the allowed inputs (`p.*` + `e.*`) for one expr. */
export interface ExprSchema {
  inputs: AllowedInputs;
}

/** Build the validation schema from the part's param names + the declared expr
 *  names. */
export function buildExprSchema(paramNames: Iterable<string>, exprNames: Iterable<string>): ExprSchema {
  return { inputs: buildAllowedInputs(paramNames, exprNames) };
}

/** Check a function call's arity against FUNCTION_ARITY. Returns an error
 *  message or null. */
function arityError(fn: string, argc: number): string | null {
  const a = FUNCTION_ARITY[fn];
  if (a == null) return null;
  if (typeof a === 'number') {
    return argc === a ? null : `${fn} expects ${a} argument${a === 1 ? '' : 's'}, got ${argc}`;
  }
  const [min, max] = a;
  if (argc < min) return `${fn} expects at least ${min} argument${min === 1 ? '' : 's'}, got ${argc}`;
  if (argc > max) return `${fn} expects at most ${max} arguments, got ${argc}`;
  return null;
}

/**
 * Validate an already-parsed expression AST against the schema. Returns a flat
 * list of errors keyed to nodes — EMPTY means the expression is safe to emit /
 * evaluate. Gate evaluation + emit on this returning empty.
 *
 * Rejects, per docs/plans/expression-builder.md §5:
 *  - any node type outside SAFE_NODE_TYPES (assignments, function declarations,
 *    blocks, object/array literals, ranges — structurally unsafe / side-effecty)
 *  - SymbolNodes that are not an allowlisted constant (a bare unknown name)
 *  - member access (`obj.prop`) outside the `p.`/`e.` namespaces or naming an
 *    input that isn't declared
 *  - FunctionNodes whose callee is not a bare allowlisted function name, or
 *    that violate the function's arity
 */
export function validateExpr(ast: MathNode, schema: ExprSchema): ExprError[] {
  const errs: ExprError[] = [];
  const { dotted, roots } = schema.inputs;

  ast.traverse((node: any, _path: string, parent: any) => {
    // 1. Node-type gate — anything not explicitly safe is rejected.
    if (!SAFE_NODE_TYPES.has(node.type)) {
      errs.push({ node, msg: `unsupported syntax: ${node.type}` });
      return; // don't double-report children of an already-rejected node
    }

    switch (node.type) {
      case 'FunctionNode': {
        const callee = node.fn;
        if (!callee || callee.type !== 'SymbolNode') {
          errs.push({ node, msg: 'disallowed call (callee must be a plain function name)' });
          break;
        }
        const fn = callee.name;
        if (!ALLOWED_FUNCTIONS.has(fn)) {
          errs.push({ node, msg: `disallowed function: ${fn}` });
          break;
        }
        const ae = arityError(fn, (node.args ?? []).length);
        if (ae) errs.push({ node, msg: ae });
        break;
      }

      case 'AccessorNode': {
        // Only DOT access into the `p.`/`e.` namespaces is allowed — bracket
        // access (`p["od"]`, `p[i]`, `p["constructor"]`) is rejected outright
        // so dynamic / prototype reach is structurally impossible.
        if (node.index?.dotNotation !== true) {
          errs.push({ node, msg: `member access must use dot notation: ${describeAccess(node)}` });
          break;
        }
        const obj = node.object;
        if (!obj || obj.type !== 'SymbolNode' || !roots.has(obj.name)) {
          errs.push({ node, msg: `unknown input: ${describeAccess(node)}` });
          break;
        }
        const prop = typeof node.name === 'string' ? node.name : '';
        const full = `${obj.name}.${prop}`;
        if (!prop || !dotted.has(full)) {
          errs.push({ node, msg: `unknown input: ${full}` });
        }
        break;
      }

      case 'SymbolNode': {
        // Skip symbols validated in another node's context:
        //  - a function name (the `fn` child of a FunctionNode)
        //  - the object root of an AccessorNode (validated at the AccessorNode)
        if (parent?.type === 'FunctionNode' && parent.fn === node) break;
        if (parent?.type === 'AccessorNode' && parent.object === node) break;
        if (ALLOWED_CONSTANTS.has(node.name)) break;
        // A bare namespace root (`p` / `e`) used as a value is not a number.
        errs.push({ node, msg: `unknown input: ${node.name}` });
        break;
      }
    }
  });

  return errs;
}

/** Best-effort human description of a member-access node for error text. */
function describeAccess(node: any): string {
  const obj = node?.object;
  const root = obj?.type === 'SymbolNode' ? obj.name : (obj?.type ?? '?');
  const prop = typeof node?.name === 'string' ? node.name : '?';
  return `${root}.${prop}`;
}

/** Convenience: parse + validate one source string against a schema. Returns
 *  the AST + errors (parse failure surfaces as a single error, no AST). Never
 *  throws. */
export function parseAndValidate(src: string, schema: ExprSchema): { ast: MathNode | null; errors: ExprError[] } {
  const parsed = parseExpr(src);
  if (!parsed.ok) return { ast: null, errors: [{ msg: parsed.error }] };
  return { ast: parsed.ast, errors: validateExpr(parsed.ast, schema) };
}
