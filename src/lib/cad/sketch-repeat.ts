/**
 * sketch-repeat.ts — pure expansion of a sketch's repeat-refs into a flat
 * numeric op stream (B.2 / id 805). Kept OUT of sketch.ts so the compile
 * engine stays lean; sketch.ts re-exports nothing here.
 *
 * THE LOAD-BEARING CORRECTNESS SEAM. Two sites must produce identical
 * geometry from a sketch that contains a `repeat-ref`:
 *   1. the CLIENT live preview (`SketchState.sketchEditor`) calls
 *      `expandSketchOps` → numeric `SketchOp[]` → `compileSketch`;
 *   2. the EMIT path (`composition-emit.ts` `case 'sketch'`) writes a
 *      `...Array.from({length:count}, (_, i) => [ …op objects… ]).flat()`
 *      spread into the `sketch([...])` source, which the bake sandbox runs
 *      through the SAME `compileSketch`.
 * `sketch-repeat.test.ts` locks the two together: a hand-unrolled ops list and
 * the repeat-expanded one must compile to byte-identical `(r,z)`.
 *
 * The expansion is UPSTREAM of compileSketch, so:
 *  - one continuous flat op list ⇒ `toVerts`' running cursor walks across
 *    iteration boundaries → rel-mode prototype ops tile seamlessly (threads);
 *  - `scaleX/scaleY` (a final multiply in compileSketch) keep working unchanged.
 */
import type { ArgValue, NodeId, SketchOpEntry, SketchRepeatNode, SketchRepeatRef, SketchExprListRef } from './composition-graph-types';
import type { SketchOp } from './sketch';

/** Evaluate one ArgValue to a number against a scope. Injected so the client
 *  preview reuses its own `evalArg` (param scope + expr evaluator) — keeps this
 *  module pure + framework-free. */
export type EvalArg = (a: ArgValue | undefined, scope: Record<string, number>) => number;

/** Resolve an `expr-list-ref` (#11 sketch edition) to its `[r,z]` points, or
 *  `undefined` when the source / output / formula can't be resolved. Injected so
 *  the 2D live preview can compile the expression instance's `list<point>`
 *  output to numbers (the headline: the expression's profile renders live);
 *  keeps this module pure + framework-free (the emit path passes no resolver and
 *  splices the source's prelude const instead). */
export type EvalExprList = (sourceId: NodeId, output: string) => [number, number][] | undefined;

const IDENT_RE = /^[A-Za-z_$][\w$]*$/;

/** Resolve a single ArgValue-bearing sketch op to its numeric `SketchOp`
 *  form (mirrors the per-op map in `SketchState.sketchEditor`). */
function resolveOp(op: SketchOpEntry, evalArg: EvalArg, scope: Record<string, number>): SketchOp {
  if (op.op === 'line') {
    return { op: 'line', r: evalArg(op.r, scope), z: evalArg(op.z, scope), mode: op.mode };
  }
  if (op.op === 'spline') {
    return {
      op: 'spline',
      r: evalArg(op.r, scope),
      z: evalArg(op.z, scope),
      mode: op.mode,
      pts: (op.pts ?? []).map((c) => [evalArg(c[0], scope), evalArg(c[1], scope)] as [number, number]),
      h0: op.h0 ? ([evalArg(op.h0[0], scope), evalArg(op.h0[1], scope)] as [number, number]) : undefined,
      h1: op.h1 ? ([evalArg(op.h1[0], scope), evalArg(op.h1[1], scope)] as [number, number]) : undefined,
    };
  }
  if (op.op === 'fillet') return { op: 'fillet', radius: evalArg(op.radius, scope) };
  return { op: 'chamfer', dist: evalArg(op.dist, scope) };
}

/** Expand one SketchRepeatNode to its flat numeric prototype-stream, tiled
 *  `count` times. `i` (loopVar) + `NPts` (= clamped count) + bindings are in
 *  scope for every prototype op expr. A non-absent `dr`/`dz` advance prepends
 *  a leading `{op:'line', mode:'rel'}` per iteration (the land/gap vertex);
 *  this presence-gate is mirrored verbatim by the emit spread so the two
 *  expansion sites stay byte-identical. Nested repeat-refs are skipped (v1). */
function expandRepeatNode(src: SketchRepeatNode, evalArg: EvalArg, scope: Record<string, number>): SketchOp[] {
  const rawCount = Math.floor(evalArg(src.count, scope));
  const count = Number.isFinite(rawCount) && rawCount > 0 ? rawCount : 0;
  if (count === 0) return [];
  const loopVar = IDENT_RE.test(String(src.loopVar || '')) ? String(src.loopVar) : 'i';
  const hasAdvance = src.dr != null || src.dz != null;
  const bindings = (src.bindings ?? []).filter((b) => b && typeof b.name === 'string' && IDENT_RE.test(b.name));

  const out: SketchOp[] = [];
  for (let i = 0; i < count; i++) {
    const iterScope: Record<string, number> = { ...scope, [loopVar]: i, NPts: count };
    // Bindings cascade left-to-right (each may reference earlier ones + the loop var).
    for (const b of bindings) iterScope[b.name] = evalArg(b.value, iterScope);
    if (hasAdvance) {
      out.push({ op: 'line', r: evalArg(src.dr, iterScope), z: evalArg(src.dz, iterScope), mode: 'rel' });
    }
    for (const op of src.ops) {
      if ((op as any)?.op === 'repeat-ref') continue; // SKIPPED nested sketch repeat (v1)
      out.push(resolveOp(op, evalArg, iterScope));
    }
  }
  return out;
}

/**
 * Expand a parent sketch's ops (which may contain `repeat-ref` entries) into a
 * flat numeric `SketchOp[]` ready for `compileSketch`. Non-ref ops resolve with
 * the base scope; a ref splices its source node's tiled prototype in at its
 * position. A ref whose source is missing / not a sketch_repeat is dropped
 * (defensive, mirrors the hydrate guard).
 */
export function expandSketchOps(
  ops: Array<SketchOpEntry | SketchRepeatRef | SketchExprListRef>,
  lookup: (id: NodeId) => SketchRepeatNode | undefined,
  evalArg: EvalArg,
  scope: Record<string, number>,
  evalExprList?: EvalExprList,
): SketchOp[] {
  const out: SketchOp[] = [];
  for (const entry of ops) {
    if ((entry as any)?.op === 'repeat-ref') {
      const src = lookup((entry as SketchRepeatRef).sourceId);
      if (!src || src.type !== 'sketch_repeat') continue;
      out.push(...expandRepeatNode(src, evalArg, scope));
    } else if ((entry as any)?.op === 'expr-list-ref') {
      // #11 — splice an expression instance's list<point> OUTPUT as absolute
      // `line` ops (already-resolved numbers). No resolver (the emit path) ⇒
      // skip — emit references the source's prelude const directly instead.
      const ref = entry as SketchExprListRef;
      const pts = evalExprList?.(ref.sourceId, ref.output);
      if (!pts) continue;
      for (const p of pts) out.push({ op: 'line', r: p[0], z: p[1] });
    } else {
      out.push(resolveOp(entry as SketchOpEntry, evalArg, scope));
    }
  }
  return out;
}
