// JSON-recipe model for library parts. Each part is a single
// `part.json` file (no .ts source, no sandbox, no esbuild). The
// server interpreter walks the recipe, evaluates Tier 1 expressions,
// dispatches calls to bundle helpers / library deps via Manifold WASM,
// and folds the results through the composition list to a single
// Manifold. See ~/.claude/plans/grammar-split-init-compose.md for the
// rationale and ../../../docs/PART_JSON_FORMAT.md (TODO) for the
// schema doc.
//
// Why JSON over the previous .ts approach:
//  - No new Function / no esbuild. No sandbox to harden, no allowlist
//    to maintain, no grammar regex that gets fooled by comments.
//  - AI emits a structured object (one zod check rejects malformed
//    payloads). Syntax errors are impossible.
//  - The inspector becomes a form over the recipe, not a code editor.
//  - Operators (mv, rot, add, subtract, intersect, ...) are first-class
//    JSON nodes — drag/reorder is a list mutation.
//
// Tier 1 expression language: literals, parens, +, -, *, /, %, unary -,
// p.<paramName>, <INST>.<propName> cross-instance references, and a
// whitelist of Math.* functions. NO conditionals, NO loops, NO
// closures, NO Manifold methods (those are operator nodes, not
// expressions). Conditionals will eventually be modelled as discrete
// "branch" nodes in a future phase.

import { GeomAcc, empty, cyl, tube, mv, rot } from '$lib/cad/manifold-helpers';
import { discoverHelpers, discoverOperators } from '$lib/cad/manifold-helpers-meta';

// ── Schema ───────────────────────────────────────────────────────────────────

/** Param schema entry — mirrors the existing ParamSchema in
 *  src/lib/cad/components/index.ts. Kept here as a plain interface so
 *  the recipe layer doesn't depend on the bundle-primitive runtime. */
export interface RecipeParamSchema {
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  unit?: string;
  type?: string;
  group?: string;
  description?: string;
  choices?: Record<string, number>;
}

/** A single argument value. Two shapes:
 *  - `{ lit: 4.5 }`           — numeric literal.
 *  - `{ expr: "p.dp_od + 1" }` — Tier 1 expression evaluated against
 *    the current params + already-bound instances. */
export type RecipeArg =
  | { lit: number }
  | { expr: string };

/** One instance — a base call plus zero or more transform reassignments
 *  (mv / rot / etc.). The interpreter calls `call(args)` to produce the
 *  base Manifold, then folds each transform through. */
export interface RecipeTransform {
  op: string; // 'mv' | 'rot' | …  — must be one of the operator names from manifold-helpers-meta
  args: RecipeArg[]; // positional args BEYOND the implicit first part arg
}

export interface RecipeInstance {
  /** Uppercase instance name: `A`, `B`, … — referenced by composition + by other instances' expressions. */
  name: string;
  /** Helper name (cyl, tube, …) OR another part's id. The interpreter
   *  picks the right dispatch at execution time. */
  call: string;
  /** For HELPER calls: positional args mapped to the helper's prop
   *  names by index (from manifold-helpers-meta).
   *  For COMPONENT calls: keyed args mapped to the component's
   *  meta.params keys. */
  args: Record<string, RecipeArg>;
  /** Sequential post-effects applied to the instance. Empty for a
   *  bare-shape instance. */
  transforms?: RecipeTransform[];
}

/** One composition step — apply `op` to the accumulator with `of`'s
 *  Manifold. Order matters; the interpreter walks left-to-right. */
export interface RecipeCompose {
  op: 'add' | 'subtract' | 'intersect';
  of: string; // instance name
}

/** The full recipe. Mirrors what the inspector edits. */
export interface PartRecipe {
  meta: {
    id: string;
    name: string;
    description?: string;
    tags?: string[];
    params: Record<string, RecipeParamSchema>;
    family?: string;
    level?: number;
    autoTranslate?: boolean;
    instanceColors?: Record<string, string>;
    instanceTopMode?: Record<string, 'stack' | 'overlay' | 'origin'>;
    instanceTopOffset?: Record<string, number>;
  };
  instances: RecipeInstance[];
  composition: RecipeCompose[];
}

// ── Tier 1 expression evaluator ──────────────────────────────────────────────
// Tiny recursive-descent parser. Handles:
//   - numeric literals (int or float)
//   - `p.<name>` param refs (against the params bag)
//   - `<INST>.<prop>` cross-instance refs (against already-bound
//     instance args — the interpreter resolves these before calling
//     each downstream instance's geom).
//   - unary -, +, *, /, %, parens
//   - Math.<fn>(...) with a whitelist of fn names
//
// Intentionally NO `?:`, `if`, comparisons, string ops. Tier 1 is
// "arithmetic over numbers". The recipe layer rejects programs that
// can't be expressed this way — by design.

const MATH_WHITELIST = new Set([
  'abs', 'sign', 'floor', 'ceil', 'round', 'trunc',
  'sqrt', 'cbrt', 'pow', 'exp', 'log', 'log2', 'log10',
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2',
  'min', 'max',
  'PI', 'E',
]);

interface EvalEnv {
  /** params bag — `p.<name>` lookups. */
  p: Record<string, number>;
  /** instance-name → resolved-arg-map. Cross-instance refs
   *  (`A.length`) look up `instances['A']['length']`. */
  instances: Record<string, Record<string, number>>;
}

interface Token { kind: string; value: string; pos: number; }

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i + 1;
      while (j < src.length && /[0-9.eE+\-]/.test(src[j])) {
        // Allow `e-` / `e+` only when preceded by a digit (avoid eating a binary +/-)
        if ((src[j] === '+' || src[j] === '-') && !/[eE]/.test(src[j - 1])) break;
        j++;
      }
      out.push({ kind: 'num', value: src.slice(i, j), pos: i });
      i = j; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      out.push({ kind: 'id', value: src.slice(i, j), pos: i });
      i = j; continue;
    }
    if ('+-*/%(),.'.includes(c)) {
      out.push({ kind: c, value: c, pos: i });
      i++; continue;
    }
    throw new Error(`Unexpected character "${c}" at ${i} in expression "${src}"`);
  }
  return out;
}

/** Evaluate a Tier 1 expression against the env. Throws on any
 *  reference the env doesn't satisfy (undefined param, undefined
 *  instance, unknown Math.* fn). NaN / Infinity propagate. */
export function evalExpr(src: string, env: EvalEnv): number {
  const toks = tokenize(src);
  let i = 0;
  const peek = () => toks[i];
  const eat = (kind: string) => {
    const t = toks[i];
    if (!t || t.kind !== kind) throw new Error(`Expected ${kind} at ${t?.pos ?? src.length}`);
    i++;
    return t;
  };
  const parseExpr = (): number => {
    let left = parseTerm();
    while (peek() && (peek().kind === '+' || peek().kind === '-')) {
      const op = eat(peek().kind).value;
      const right = parseTerm();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  };
  const parseTerm = (): number => {
    let left = parseUnary();
    while (peek() && (peek().kind === '*' || peek().kind === '/' || peek().kind === '%')) {
      const op = eat(peek().kind).value;
      const right = parseUnary();
      left = op === '*' ? left * right : op === '/' ? left / right : left % right;
    }
    return left;
  };
  const parseUnary = (): number => {
    if (peek() && (peek().kind === '-' || peek().kind === '+')) {
      const op = eat(peek().kind).value;
      const v = parseUnary();
      return op === '-' ? -v : v;
    }
    return parseAtom();
  };
  const parseAtom = (): number => {
    const t = peek();
    if (!t) throw new Error(`Unexpected end of expression "${src}"`);
    if (t.kind === 'num') { i++; return Number(t.value); }
    if (t.kind === '(') { eat('('); const v = parseExpr(); eat(')'); return v; }
    if (t.kind === 'id') {
      i++;
      // p.<name> or INST.<prop> or Math.<fn>(args) or Math.PI/E
      if (peek()?.kind === '.') {
        eat('.');
        const prop = eat('id').value;
        if (t.value === 'p') {
          const v = env.p[prop];
          if (typeof v !== 'number') throw new Error(`Unknown param "p.${prop}"`);
          return v;
        }
        if (t.value === 'Math') {
          if (!MATH_WHITELIST.has(prop)) throw new Error(`Math.${prop} is not allowed in Tier 1`);
          // Constant (PI, E) — no parens.
          if (peek()?.kind !== '(') return (Math as any)[prop];
          // Function — parse args.
          eat('(');
          const args: number[] = [];
          if (peek()?.kind !== ')') {
            args.push(parseExpr());
            while (peek()?.kind === ',') { eat(','); args.push(parseExpr()); }
          }
          eat(')');
          return (Math as any)[prop](...args);
        }
        // INST.<prop>
        const inst = env.instances[t.value];
        if (!inst) throw new Error(`Unknown instance "${t.value}" in "${src}"`);
        if (!(prop in inst)) throw new Error(`Instance "${t.value}" has no prop "${prop}"`);
        return inst[prop];
      }
      // Bare identifier — no support yet (could add helpers like `pi`).
      throw new Error(`Bare identifier "${t.value}" not supported — use p.${t.value} for params`);
    }
    throw new Error(`Unexpected token "${t.value}" at ${t.pos} in "${src}"`);
  };
  const result = parseExpr();
  if (i !== toks.length) {
    throw new Error(`Trailing tokens after expression "${src}" at ${toks[i].pos}`);
  }
  return result;
}

/** Resolve a single RecipeArg to a number. */
export function resolveArg(arg: RecipeArg, env: EvalEnv): number {
  if ('lit' in arg) return arg.lit;
  return evalExpr(arg.expr, env);
}

// ── Interpreter ──────────────────────────────────────────────────────────────

/** Resolved dependency module — either a bundle helper (positional
 *  args) or a library component (keyed args). */
export interface RecipeDep {
  kind: 'helper' | 'component';
  /** For helpers: ordered list of prop names (positional dispatch).
   *  For components: the meta.params keys (for validation). */
  propNames: string[];
  /** Callable that produces a Manifold from a resolved-args bag.
   *  Helpers receive a positional array; components receive an object. */
  build: (args: Record<string, number>) => any;
}

/** Helper-runtime table — the bridge between the recipe's positional
 *  args and the ManifoldCAD helper signatures. Shared between
 *  loadVolumeRecipe (the disk-loaded path) and bake-preview (the
 *  inline-recipe live-preview path) so both interpret an identical
 *  recipe identically.
 *
 *  Transforms (mv/rot) are invoked through the interpreter's
 *  transform path with `[manifold, ...txArgs]` — so the runtime
 *  unpacks args[0] as the Manifold and args[1..3] as the vec3 x/y/z.
 *  This means a recipe transform writes its vec3 as THREE scalar args:
 *    { "op": "mv", "args": [{lit:0},{lit:0},{expr:"A.length"}] }
 *  Future extension: support a fourth shape `{vec:[...]}` so a single
 *  vec3 arg can be written; for now scalars-only keeps Tier 1 trivial. */
export function createHelperRuntime(): Record<string, (args: any[]) => any> {
  return {
    cyl:  (a) => cyl(a[0], a[1], a[2]),
    tube: (a) => tube(a[0], a[1], a[2]),
    mv:   (a) => mv(a[0], [a[1], a[2], a[3]]),
    rot:  (a) => rot(a[0], [a[1], a[2], a[3]]),
  };
}

/** A dep resolver that wires every available bundle helper / operator
 *  plus a caller-supplied component map. Shared by loadVolumeRecipe
 *  and the bake-preview inline-recipe path so the dispatch contract
 *  stays consistent.
 *
 *  Resolution order: **helpers / operators first, then components**.
 *  The bundle helpers (`cyl`, `tube`, `mv`, `rot`, …) are a canonical
 *  namespace — every recipe assumes their signatures. A library part
 *  that picks one of those names is unreachable as a dep (rename it
 *  to something unique like `<id>_part`). */
export function createResolveDep(
  componentByCall: Map<string, { meta: any; geom: (args: any) => any }>,
): (callName: string) => RecipeDep {
  const helperByName = new Map(discoverHelpers().map((h) => [h.name, h]));
  const operatorByName = new Map(discoverOperators().map((o) => [o.name, o]));
  const runtime = createHelperRuntime();
  return (callName: string): RecipeDep => {
    const h = helperByName.get(callName);
    if (h) {
      const fn = runtime[callName];
      if (!fn) throw new Error(`Helper "${callName}" has no runtime wiring`);
      return { kind: 'helper', propNames: h.props.map((p) => p.name), build: fn };
    }
    const op = operatorByName.get(callName);
    if (op) {
      const fn = runtime[callName];
      if (!fn) throw new Error(`Operator "${callName}" has no runtime wiring`);
      // Operators (mv/rot) are only invoked via the transform path,
      // which uses positional args — propNames is dead for them.
      // Synthesize a placeholder so the helper-dispatch contract stays
      // uniform (kind: 'helper').
      return { kind: 'helper', propNames: ['x', 'y', 'z'], build: fn };
    }
    const comp = componentByCall.get(callName);
    if (!comp) throw new Error(`Unknown call "${callName}" — not a helper, operator, or known component`);
    return {
      kind: 'component',
      propNames: Object.keys(comp.meta.params ?? {}),
      build: (args: Record<string, number>) => comp.geom(args),
    };
  };
}

/** Build a complete Manifold from a recipe. Resolves dependencies
 *  via `resolveDep`. Throws on any expression error, dep miss, or
 *  composition op referencing an undeclared instance. */
export function buildRecipe(
  recipe: PartRecipe,
  params: Record<string, number>,
  resolveDep: (callName: string) => RecipeDep,
): any {
  // Walk instances in source order so cross-instance refs see only
  // already-bound predecessors (matches the .ts loader's semantics).
  const instances: Record<string, Record<string, number>> = {};
  const manifolds: Record<string, any> = {};
  const env: EvalEnv = { p: params, instances };

  for (const inst of recipe.instances) {
    const dep = resolveDep(inst.call);
    // Resolve every arg via the expression evaluator.
    const resolved: Record<string, number> = {};
    for (const [k, v] of Object.entries(inst.args)) {
      try { resolved[k] = resolveArg(v, env); }
      catch (e: any) { throw new Error(`Instance "${inst.name}" arg "${k}": ${e?.message ?? e}`); }
    }
    instances[inst.name] = resolved;
    // Dispatch to the helper / component.
    let m: any;
    if (dep.kind === 'helper') {
      // Positional: ordered by helper's propNames; missing props are
      // omitted (helper applies its default).
      const positional = dep.propNames.map((n) => resolved[n]).filter((v) => v !== undefined);
      m = dep.build(positional as any);
    } else {
      m = dep.build(resolved);
    }
    // Apply transforms (mv / rot / …).
    if (inst.transforms) {
      for (const tx of inst.transforms) {
        const txDep = resolveDep(tx.op);
        const txArgs = tx.args.map((a) => resolveArg(a, env));
        // Transforms take the manifold as the first arg, then the
        // resolved positional args.
        m = txDep.build([m, ...txArgs] as any);
      }
    }
    manifolds[inst.name] = m;
  }

  // Fold composition steps through a GeomAcc — same accumulator the
  // .ts path uses (geom.add / geom.subtract / geom.intersect).
  const acc = new GeomAcc();
  for (const step of recipe.composition) {
    const m = manifolds[step.of];
    if (!m) throw new Error(`Composition step references unknown instance "${step.of}"`);
    if (step.op === 'add') acc.add(m);
    else if (step.op === 'subtract') acc.subtract(m);
    else if (step.op === 'intersect') acc.intersect(m);
    else throw new Error(`Unknown composition op "${(step as any).op}"`);
  }
  return acc.current ?? empty();
}
