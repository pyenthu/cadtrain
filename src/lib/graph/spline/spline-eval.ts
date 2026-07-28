/**
 * spline-eval.ts — resolve a spline's WIRED control-points expression (#26) to
 * concrete `[x,y,z]` points for the editor to DISPLAY.
 *
 * When a `SplineNode.pointsExpr` is set (an expr instance's `list<point>` output
 * wired into the spline), the manual `points` array is stale — the bake resamples
 * the WIRED variable instead (composition-emit.emitSplineBlocks). This helper
 * evaluates that same variable client-side so the SplineEditorPopup / SplineScene
 * can render the expression's actual points (the violet handles, the curve, the
 * projection, the N samples all follow them) rather than the old manual handles.
 *
 * REUSE, not a second eval path: it lowers every expr instance's outputs with the
 * EXACT emitter the bake uses (`emitExprBlocks` → compileListFormula /
 * compileImperative), then evaluates those `const` lines in a `new Function`
 * sandbox seeded with the same math globals the bake sandbox injects
 * (math-lib.ts, index-aligned) and the part's params (defaults — matching the
 * polygon 2D-preview convention). The wired ref `_x_<srcId>_<out>` is the exact
 * identifier `exprBlockMember(srcId, out)` those const lines declare, so reading
 * it back yields the compiled output value.
 *
 * PURE + display-only — never mutates the graph, never throws (any parse / eval /
 * cycle failure → `[]`, so the caller shows an "expression has no points yet"
 * state instead of crashing the popup / WASM core).
 */
import { emitExprBlocks } from '$lib/graph/composition/composition-emit';
import * as mathLib from '$lib/graph/expr/math-lib';
import type { Graph, ArgValue } from '$lib/graph/composition/composition-graph';
import type { Vec3 } from '$lib/graph/spline/spline-resample';

// Math primitives injected as BARE names — index-aligned name/value lists, the
// same single source of truth the primitive sandbox uses (primitive-sandbox.ts).
const MATH_NAMES = Object.keys(mathLib);
const MATH_VALUES = MATH_NAMES.map((n) => (mathLib as any)[n]);

/** Coerce an evaluated list into a clean `Vec3[]` — keep only array elements,
 *  pad 2D `[x,y]` points to `z = 0` (resampleSpline / SplineScene want triples),
 *  drop non-finite / non-array entries. */
function toVec3Array(out: unknown): Vec3[] {
  if (!Array.isArray(out)) return [];
  const res: Vec3[] = [];
  for (const p of out) {
    if (!Array.isArray(p)) continue;
    const x = Number(p[0]);
    const y = Number(p[1]);
    const z = Number(p[2] ?? 0);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    res.push([x, y, z]);
  }
  return res;
}

/**
 * Resolve a wired `pointsExpr` to concrete control points, or `[]` if it can't
 * be evaluated (not an expr ref, unknown var, invalid formula, eval error).
 *
 * @param graph the part graph (supplies the expr defs/instances + param defaults)
 * @param pointsExpr `SplineNode.pointsExpr` — a `{kind:'expr', expr:'_x_<id>_<out>'}`
 */
export function resolveWiredSplinePoints(graph: Graph, pointsExpr: ArgValue | undefined): Vec3[] {
  // Only an expr-output reference produces a list; a param is a scalar → nothing.
  if (!pointsExpr || pointsExpr.kind !== 'expr') return [];
  const targetVar = String(pointsExpr.expr ?? '');
  // The wired ref is exprBlockMember(srcId, out) = `_x_<id>_<out>` — a plain JS
  // identifier. Guard so we only ever splice a safe name into the return line.
  if (!/^_x_[A-Za-z0-9_$]+$/.test(targetVar)) return [];

  // Part params → the `p.*` scope, using declared defaults (same convention as
  // the polygon 2D preview; the editor has no per-bake param values).
  const params: Record<string, number> = {};
  for (const [k, v] of Object.entries(graph.params ?? {})) params[k] = Number((v as any)?.default ?? 0);

  // Lower EVERY expr instance's outputs exactly as the bake does. The target var
  // is declared among these lines (exprBlockMember(srcId, out)).
  let lines: string[];
  try { lines = emitExprBlocks(graph); } catch { return []; }
  if (!lines.some((l) => l.includes(targetVar))) return [];

  const body = `${lines.join('\n')}\nreturn (typeof ${targetVar} !== 'undefined') ? ${targetVar} : undefined;`;
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function('p', ...MATH_NAMES, body);
    return toVec3Array(fn(params, ...MATH_VALUES));
  } catch {
    return [];
  }
}
