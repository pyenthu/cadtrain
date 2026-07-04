/**
 * graph-to-tf.ts — compile a composition GRAPH → a TrueForm (TF) INSTRUCTION
 * RECIPE (TODO #46, v0).
 *
 * This is the analogue of `composition-emit.ts`, but instead of emitting a
 * Manifold source body it walks the same node graph and lowers each node to a
 * data-only `TfInstr` describing the equivalent TrueForm op. The mapping targets
 * the ops that `src/lib/shared/tf_examples/*` + `trueform-client.ts` actually
 * expose:
 *
 *   Call r_revolve         → { op:'revolve', profile:[[r,z]…], segments }   (tfRevolveProfile)
 *   Call r_cuboid          → { op:'box', w, h, d }                          (boxMesh)
 *   Call *cyl*             → { op:'cylinder', radius, height, segments }    (cylinderMesh)
 *   Call r_sweep           → { op:'sweep', path:[[x,y,z]…], radius, radialSegments, capped }  (tubeMesh + capOpenEnds)
 *   Call <composite>       → recurse into the sub-part's graph + splice its root instr(s)
 *   Method subtract/add/…  → { op:'booleanDifference'|'Union'|'Intersection', obj, arg }
 *   Container list/group   → { op:'union', children }                       (booleanUnion fold)
 *   Container stack        → { op:'union', children, mated:true }           (stacked end-to-end)
 *   Mv                     → { op:'translate', offset, child }              (makeTranslation)
 *   Rot                    → { op:'rotate', deg, child }                    (makeRotation)
 *   Txfmn                  → rotate ∘ translate (rot inner, mv outer)
 *   Repeat                 → { op:'repeat', count, child }
 *   Polygon / Sketch       → { op:'profile', profile:[[r,z]…] }             (a lathe input, not a solid)
 *   anything else          → { op:'UNSUPPORTED', nodeType, detail }
 *
 * v0 is the COMPILER + a readable recipe emitter only — NOT the client-execution
 * wiring (a later #46 step actually invokes tf with these instructions). The
 * translator is PURE: no WASM, no browser, no tf import. ArgValue params/exprs
 * are evaluated numerically against the supplied params (defaults filled from
 * `graph.params`) so the printed profiles are concrete `[r,z]` numbers, exactly
 * like the hand-written tf_examples profiles.
 */

import type {
  Graph,
  GraphNode,
  ArgValue,
  NodeId,
  PolygonNode,
  SketchNode,
  ExprNode,
  SplineNode,
} from './composition-graph-types';
import { STACK_REF_PARAM, resolveEffectiveAppearance } from './composition-graph-mutate';

/** Resolve a COMPOSITE Call's `src` id → its own composition graph (+ optional
 *  default params), so `graphToTf` can recurse into a sub-part and inline it. The
 *  translator stays PURE + testable: the caller (server endpoint / test) injects
 *  the actual source-fetch + `meta.graph` parse. `null` ⇒ unresolvable → the Call
 *  is left UNSUPPORTED. */
export type ResolveComposite = (id: string) => { graph: Graph; params?: Record<string, number> } | null;

// ─── instruction data model ─────────────────────────────────────────────────

export type Vec3 = [number, number, number];
export type ProfilePt = [number, number];

/** A single node lowered to its TrueForm equivalent. A tree: booleans / transforms
 *  / containers hold child `TfInstr`s, mirroring the graph's expression nesting. */
export type TfInstr =
  | { op: 'revolve'; profile: ProfilePt[]; segments: number; note?: string }
  | { op: 'box'; w: number; h: number; d: number }
  | { op: 'cylinder'; radius: number; height: number; segments: number }
  | { op: 'sweep'; path: Vec3[]; radius: number; radialSegments: number; capped?: boolean }
  | { op: 'booleanDifference'; obj: TfInstr; arg: TfInstr }
  | { op: 'booleanUnion'; obj: TfInstr; arg: TfInstr }
  | { op: 'booleanIntersection'; obj: TfInstr; arg: TfInstr }
  | { op: 'union'; children: TfInstr[]; mated?: boolean; offsets?: (number | null)[] }
  | { op: 'translate'; offset: Vec3; child: TfInstr }
  | { op: 'rotate'; deg: Vec3; child: TfInstr }
  | { op: 'repeat'; count: number; child: TfInstr; mode?: string; stackRef?: number | null }
  | { op: 'profile'; profile: ProfilePt[]; note?: string }
  | { op: 'UNSUPPORTED'; nodeType: string; detail?: string };

/** One part's render appearance (per-part-mesh TF path). colour + opacity +
 *  texture, resolved from the output Call's effective appearance (wired material
 *  ▸ per-part override). Undefined per entry ⇒ that part uses the scene default. */
export interface TfAppearance {
  colorOuter?: string;
  colorInner?: string;
  texture?: string;
  opacity?: number;
}

/** The full recipe: the ordered list of TF instructions the graph's ROOT
 *  produces (its unconsumed outputs), plus any coverage notes gathered
 *  during the walk. */
export interface TfRecipe {
  id?: string;
  instrs: TfInstr[];
  /** Per-PART appearance, aligned 1:1 with `instrs` (each top-level instr is a
   *  part). Drives the per-part-mesh TF render (each part its own textured mesh).
   *  Sparse: an entry is undefined when that output has no explicit appearance. */
  partAppearance?: (TfAppearance | undefined)[];
  /** Human-readable notes — approximations + unsupported nodes hit. */
  notes: string[];
}

// ─── numeric evaluation of ArgValues ────────────────────────────────────────

/** Merge caller params over graph.params defaults → a flat `{name: number}`
 *  scope for expression evaluation. */
function paramScope(graph: Graph, params: Record<string, number>): Record<string, number> {
  const scope: Record<string, number> = {};
  for (const [k, schema] of Object.entries(graph.params ?? {})) {
    const d = (schema as any)?.default;
    scope[k] = Number.isFinite(Number(d)) ? Number(d) : 0;
  }
  for (const [k, v] of Object.entries(params ?? {})) {
    if (Number.isFinite(Number(v))) scope[k] = Number(v);
  }
  return scope;
}

/** Evaluate an ArgValue to a number. `expr` strings run in a `p.*` + `Math`
 *  scope (the same shape composition-emit assumes). Returns NaN on any failure
 *  so the caller can flag it rather than crash. */
function evalArg(v: ArgValue | undefined, scope: Record<string, number>): number {
  if (!v) return NaN;
  if (v.kind === 'literal') return Number(v.value);
  if (v.kind === 'param') return Number(scope[v.param]);
  // expr — evaluate `<js>` with `p` bound to the scope + Math available.
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function('p', 'Math', `"use strict"; return (${v.expr});`);
    return Number(fn(scope, Math));
  } catch {
    return NaN;
  }
}

/** Evaluate an ArgValue expected to be an integer count / segment (fallback default). */
function evalInt(v: ArgValue | undefined, scope: Record<string, number>, fallback: number): number {
  const n = evalArg(v, scope);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

/** Evaluate an ArgValue expected to be a boolean (literal `true`/`false`, the
 *  string forms, or 1/0). Non-literal / unknown → `fallback`. */
function evalBool(v: ArgValue | undefined, fallback: boolean): boolean {
  if (!v || v.kind !== 'literal') return fallback;
  const val: any = v.value;
  if (typeof val === 'boolean') return val;
  if (val === 'true' || val === 1) return true;
  if (val === 'false' || val === 0) return false;
  return fallback;
}

// ─── profile resolution (polygon / sketch → [r,z] points) ───────────────────

/** Resolve a `polygon` node's ordered vertices to concrete `[r,z]` points.
 *  Only literal-vertex entries are supported in v0 — repeat / expr-list refs are
 *  flagged (they need the loop machinery / expr blocks). */
function resolvePolygon(node: PolygonNode, scope: Record<string, number>, notes: string[]): ProfilePt[] {
  const pts: ProfilePt[] = [];
  for (const entry of node.points as any[]) {
    if (!entry) continue;
    if (entry.kind === 'point' || entry.r != null) {
      pts.push([evalArg(entry.r, scope), evalArg(entry.z, scope)]);
    } else {
      notes.push(`polygon ${node.id}: skipped a '${entry.kind}' entry (repeat/expr-ref not resolved in v0)`);
    }
  }
  return pts;
}

/** Resolve a `sketch` node's op list to a concrete `[r,z]` polyline. Handles
 *  `line` ops (abs + rel, tracking a running cursor). `fillet`/`chamfer` round
 *  the PREVIOUS corner — v0 approximates them as a sharp step (exactly what the
 *  hand-written tf_examples do) and notes it. `spline` end-points are kept as a
 *  straight segment (the curve interior is dropped). Repeat / expr-list refs are
 *  flagged. */
function resolveSketch(node: SketchNode, scope: Record<string, number>, notes: string[]): ProfilePt[] {
  const pts: ProfilePt[] = [];
  let cur: ProfilePt = [0, 0];
  let first = true;
  for (const op of node.ops as any[]) {
    if (!op) continue;
    if (op.op === 'line' || op.op === 'spline') {
      const rv = evalArg(op.r, scope);
      const zv = evalArg(op.z, scope);
      // First op is always absolute (compileSketch forces this); rel adds to the cursor.
      const abs = first || op.mode !== 'rel';
      const pt: ProfilePt = abs ? [rv, zv] : [cur[0] + rv, cur[1] + zv];
      if (op.op === 'spline') {
        notes.push(`sketch ${node.id}: spline op approximated as a straight segment to its end-point (v0)`);
      }
      pts.push(pt);
      cur = pt;
      first = false;
    } else if (op.op === 'fillet' || op.op === 'chamfer') {
      notes.push(`sketch ${node.id}: '${op.op}' approximated as a sharp corner (v0, like the tf_examples lathe)`);
    } else if (op.op === 'repeat-ref' || op.op === 'expr-list-ref') {
      notes.push(`sketch ${node.id}: skipped a '${op.op}' op (loop/expr expansion not resolved in v0)`);
    }
  }
  return pts;
}

/** A Call's `profile` arg carries a `__POLY__<nodeId>` sentinel expr pointing at
 *  the polygon / sketch that supplies its `[r,z]` loop. Resolve that node → points. */
function resolveProfileArg(
  profileArg: ArgValue | undefined,
  graph: Graph,
  scope: Record<string, number>,
  notes: string[],
): ProfilePt[] | null {
  if (!profileArg || profileArg.kind !== 'expr') return null;
  const m = profileArg.expr.match(/__POLY__(n_[a-z0-9_]+)/i);
  if (!m) return null;
  const src = graph.nodes[m[1]!];
  if (!src) return null;
  if (src.type === 'polygon') return resolvePolygon(src as PolygonNode, scope, notes);
  if (src.type === 'sketch') return resolveSketch(src as SketchNode, scope, notes);
  return null;
}

// ─── sweep resolution (path spline + circular section radius) ────────────────

/** Find the `SplineNode` a Call arg refers to. A wired spline output is encoded
 *  `{kind:'expr', expr:'_x_<splineId>_path'}` (emitSplineBlocks), so the arg's
 *  expr starts with `_x_<id>_`. Returns the matching spline node, or null. */
function resolveSplineNode(arg: ArgValue | undefined, graph: Graph): SplineNode | null {
  if (!arg || arg.kind !== 'expr') return null;
  for (const n of Object.values(graph.nodes)) {
    if (n && n.type === 'spline' && arg.expr.startsWith(`_x_${n.id}_`)) return n as SplineNode;
  }
  return null;
}

/** Uniform Catmull-Rom resample of `ctrl` control points → `samples` concrete
 *  `[x,y,z]` points. Mirrors `tf_examples/s_tube_demo.buildSweepPath` (parameter-
 *  space Catmull-Rom, endpoints CLAMPED for an open path, WRAPPED for a closed
 *  loop) so the recipe carries the SAME concrete path the hand-written demo
 *  sweeps — the sweep analogue of how `revolve` carries a concrete profile. */
export function resampleCatmullRom(ctrl: Vec3[], samples: number, closed = false): Vec3[] {
  const n = ctrl.length;
  if (n === 0 || samples <= 0) return [];
  if (n === 1) return Array.from({ length: samples }, () => [...ctrl[0]] as Vec3);
  const P = (i: number): Vec3 =>
    closed ? ctrl[((i % n) + n) % n] : ctrl[Math.max(0, Math.min(n - 1, i))];
  const span = closed ? n : n - 1;       // CLOSED wraps last→first; OPEN hits both ends
  const last = closed ? samples : samples - 1;
  const out: Vec3[] = [];
  for (let s = 0; s < samples; s++) {
    const u = (s / last) * span;
    let seg = Math.floor(u);
    if (!closed && seg > n - 2) seg = n - 2;
    const t = u - seg;
    const p0 = P(seg - 1), p1 = P(seg), p2 = P(seg + 1), p3 = P(seg + 2);
    const t2 = t * t, t3 = t2 * t;
    const pt: Vec3 = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      pt[k] = 0.5 * (
        2 * p1[k] +
        (-p0[k] + p2[k]) * t +
        (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 +
        (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3
      );
    }
    out.push(pt);
  }
  return out;
}

/** Resolve a sweep SECTION spline → its circular radius (`tubeMesh` takes ONE
 *  scalar radius). Two shapes are supported:
 *   1. a spline WIRED to a circle expr (`pointsExpr` → an `ExprNode` with a
 *      `rad`/`radius`/`r` param binding) — the `sweep_tube_demo` pattern; the
 *      binding is evaluated in `scope`.
 *   2. a spline with LITERAL points roughly equidistant (≤10% dev) from their
 *      xy-centroid → the mean radius.
 *  A non-circular / unresolvable section → null (caller keeps it UNSUPPORTED). */
function sectionRadiusOf(
  spline: SplineNode | null,
  graph: Graph,
  scope: Record<string, number>,
  notes: string[],
): number | null {
  if (!spline) return null;
  // (1) wired from a circle expr → read its radius param binding.
  if (spline.pointsExpr && spline.pointsExpr.kind === 'expr') {
    const srcExpr = spline.pointsExpr.expr;
    for (const n of Object.values(graph.nodes)) {
      if (!n || n.type !== 'expr' || !srcExpr.startsWith(`_x_${n.id}_`)) continue;
      const b = (n as ExprNode).bindings ?? {};
      const radArg = b.rad ?? b.radius ?? b.r;
      const r = evalArg(radArg, scope);
      if (Number.isFinite(r) && r > 0) return r;
      notes.push(`sweep section ${spline.id}: expr '${(n as ExprNode).defId}' has no resolvable circular 'rad' binding — UNSUPPORTED`);
      return null;
    }
    notes.push(`sweep section ${spline.id}: wired points-expr '${srcExpr}' did not resolve to an expr node — UNSUPPORTED`);
    return null;
  }
  // (2) literal ring — mean radius from the xy-centroid, if roughly circular.
  const pts = spline.points;
  if (Array.isArray(pts) && pts.length >= 3) {
    let cx = 0, cy = 0;
    for (const p of pts) { cx += p[0]; cy += p[1]; }
    cx /= pts.length; cy /= pts.length;
    const radii = pts.map((p) => Math.hypot(p[0] - cx, p[1] - cy));
    const mean = radii.reduce((a, b) => a + b, 0) / radii.length;
    const maxDev = Math.max(...radii.map((r) => Math.abs(r - mean)));
    if (mean > 0 && maxDev <= mean * 0.1) return mean;
    notes.push(`sweep section ${spline.id}: literal points not circular (rad dev ${((maxDev / (mean || 1)) * 100).toFixed(0)}%) — no scalar radius, UNSUPPORTED`);
    return null;
  }
  return null;
}

// ─── engine vs composite classification ──────────────────────────────────────

/** Engine `src` ids that have NO TrueForm generator (linear extrude / loft) — a
 *  Call to one is explicitly UNSUPPORTED (never treated as a composite). */
const NO_TF_ENGINES = new Set(['r_loft', 'r_weld_extrude', 'r_extrude']);

/** True when a Call `src` is an ENGINE primitive (handled directly, or explicitly
 *  UNSUPPORTED) rather than a COMPOSITE volume part. Everything NOT an engine is a
 *  candidate for composite recursion (`resolveComposite`). Shared with the server
 *  endpoint so both agree on which Call srcs to fetch + inline. */
export function isEngineSrc(src: string): boolean {
  return (
    src === 'r_revolve' ||
    src === 'r_cuboid' ||
    src === 'r_sweep' ||
    /cyl/i.test(src) ||
    NO_TF_ENGINES.has(src)
  );
}

// ─── consumed-set (output filtering, mirrors composition-emit) ───────────────

/** Nodes referenced as an INPUT by another node — dropped from the root's
 *  visible output list (matches composition-emit.computeConsumedSet). */
function computeConsumed(graph: Graph): Set<NodeId> {
  const consumed = new Set<NodeId>();
  for (const n of Object.values(graph.nodes)) {
    if (!n) continue;
    if (n.type === 'method') {
      if ((n as any).obj) consumed.add((n as any).obj);
      if ((n as any).arg) consumed.add((n as any).arg);
    } else if (n.type === 'mv' || n.type === 'rot' || n.type === 'txfmn') {
      if ((n as any).child) consumed.add((n as any).child);
    } else if (n.type === 'repeat') {
      for (const c of (n as any).children ?? []) consumed.add(c);
    } else if (n.type === 'stack' || n.type === 'group') {
      for (const c of (n as any).children ?? []) consumed.add(c);
    } else if (n.type === 'list' && n.id !== graph.root) {
      for (const c of (n as any).children ?? []) consumed.add(c);
    } else if (n.type === 'call') {
      for (const v of Object.values((n as any).args as Record<string, ArgValue>)) {
        if (v.kind !== 'expr') continue;
        const matches = v.expr.match(/__POLY__(n_[a-z0-9_]+)/gi);
        if (!matches) continue;
        for (const mm of matches) consumed.add(mm.slice('__POLY__'.length));
      }
    }
  }
  return consumed;
}

// ─── the walk ────────────────────────────────────────────────────────────────

/** Max composite-recursion depth (defence against a runaway / mis-authored dep
 *  chain; the cycle guard already stops true loops). */
const MAX_COMPOSITE_DEPTH = 12;

/**
 * The effective per-child STACK MATE OFFSET (the value Manifold's `stack()` reads
 * as a child's `_stackRef`), resolved with the SAME precedence the emit path uses:
 *   1. the stack's `childRefs[cid]` OVERRIDE (a finite number — `withStackRef`), else
 *   2. the child PART's own `stack_ref` param default (what its emitted geom stamps
 *      as `_stackRef`) — found by unwrapping any mv/rot/txfmn wrapper down to the
 *      underlying composite Call and reading its resolved `graph.params.stack_ref`, else
 *   3. `null` — unauthored; the executor then uses its small weld-overlap nudge.
 * Pure: the composite lookup goes through the injected `resolve` (guarded by `seen`
 * + `depth`, like the Call recursion) and never touches WASM.
 */
function effectiveStackRef(
  cid: NodeId,
  childRefs: Record<NodeId, number> | undefined,
  graph: Graph,
  resolve: ResolveComposite | undefined,
  seen: Set<string>,
  depth: number,
): number | null {
  // 1. explicit per-child override on this stack.
  if (childRefs && Object.prototype.hasOwnProperty.call(childRefs, cid)) {
    const ov = Number(childRefs[cid]);
    if (Number.isFinite(ov)) return ov;
  }
  // 2. the child part's own stack_ref default — unwrap transform wrappers to the
  //    underlying Call (mv/rot/txfmn propagate _stackRef in manifold-helpers).
  let node = graph.nodes[cid] as GraphNode | undefined;
  const guard = new Set<NodeId>();
  while (node && (node.type === 'mv' || node.type === 'rot' || node.type === 'txfmn')) {
    if (guard.has(node.id)) break;
    guard.add(node.id);
    node = graph.nodes[(node as any).child];
  }
  if (node && node.type === 'call') {
    const src = (node as any).src as string;
    if (!isEngineSrc(src) && resolve && !seen.has(src) && depth < MAX_COMPOSITE_DEPTH) {
      const resolved = resolve(src);
      const def = (resolved?.graph?.params as any)?.[STACK_REF_PARAM]?.default;
      if (def != null && Number.isFinite(Number(def))) return Number(def);
    }
  }
  return null;
}

/** Lower a single node → its TfInstr, recursing into referenced children. The
 *  `resolve`/`seen`/`depth` context threads composite-Call recursion state. */
function lowerNode(
  node: GraphNode | undefined,
  graph: Graph,
  scope: Record<string, number>,
  notes: string[],
  resolve: ResolveComposite | undefined,
  seen: Set<string>,
  depth: number,
): TfInstr {
  if (!node) return { op: 'UNSUPPORTED', nodeType: '(missing)', detail: 'referenced node not found' };
  const ref = (id: NodeId) => lowerNode(graph.nodes[id], graph, scope, notes, resolve, seen, depth);

  switch (node.type) {
    case 'call': {
      const src = (node as any).src as string;
      const args = (node as any).args as Record<string, ArgValue>;
      if (src === 'r_revolve') {
        const profile = resolveProfileArg(args.profile, graph, scope, notes);
        const segments = evalInt(args.segments, scope, 64);
        if (!profile) {
          notes.push(`call ${node.id} (r_revolve): profile arg was not a resolvable __POLY__ sketch/polygon`);
          return { op: 'revolve', profile: [], segments, note: 'profile unresolved' };
        }
        return { op: 'revolve', profile, segments };
      }
      if (src === 'r_cuboid') {
        return {
          op: 'box',
          w: evalArg(args.w, scope),
          h: evalArg(args.h, scope),
          d: evalArg(args.d, scope),
        };
      }
      if (src === 'r_sweep') {
        // A circular section swept along a spline PATH → tf's tubeMesh (fixed
        // circular section along a parallel-transport curve) + capped ends. The
        // `path` arg wires to a spline node (control points → concrete Catmull-
        // Rom resample, mirroring tf_examples/s_tube_demo); the `section` arg
        // wires to a circle → its scalar radius. Anything tf's tubeMesh can't
        // do (no wired spline path, non-circular section) stays UNSUPPORTED so
        // the caller falls back to the Manifold mesh-import path.
        const pathNode = resolveSplineNode(args.path, graph);
        const secSpline = resolveSplineNode(args.section, graph);
        const radius = sectionRadiusOf(secSpline, graph, scope, notes);
        if (!pathNode || radius == null) {
          const why = !pathNode
            ? 'path arg is not a resolvable spline node'
            : 'section is not a resolvable circular profile';
          notes.push(`call ${node.id} (r_sweep): ${why} — UNSUPPORTED (mesh-import fallback)`);
          return {
            op: 'UNSUPPORTED',
            nodeType: 'call:r_sweep',
            detail: !pathNode ? 'path not resolvable' : 'non-circular/unresolved section',
          };
        }
        const closedPath = evalBool(args.closedPath, pathNode.closed ?? false);
        const capped = evalBool(args.caps, !closedPath);
        const samples = Math.max(2, evalInt(pathNode.samples, scope, 32));
        const ctrl = (pathNode.points ?? []).map((p) => [p[0], p[1], p[2]] as Vec3);
        const path = resampleCatmullRom(ctrl, samples, closedPath);
        const radialSegments = Math.max(3, evalInt(secSpline?.samples, scope, 32));
        return { op: 'sweep', path, radius, radialSegments, capped };
      }
      if (/cyl/i.test(src)) {
        // A cylinder-like engine → cylinderMesh(radius, height, segments). Best-effort
        // on common arg names (r/radius, len/length/h/height).
        const radius = evalArg(args.r ?? args.radius, scope);
        const height = evalArg(args.len ?? args.length ?? args.h ?? args.height, scope);
        const segments = evalInt(args.segments ?? args.seg, scope, 64);
        return { op: 'cylinder', radius, height, segments };
      }
      if (NO_TF_ENGINES.has(src)) {
        // r_weld_extrude / r_loft / r_extrude — TrueForm has no linear extrude /
        // profile-loft (see trueform-api-notes.md § ⛔). Flag it.
        notes.push(`call ${node.id}: engine '${src}' has no TrueForm equivalent (no extrude/loft in tf) — UNSUPPORTED`);
        return { op: 'UNSUPPORTED', nodeType: `call:${src}`, detail: 'no TF generator for this engine' };
      }
      // Not an engine → a COMPOSITE volume part. Resolve its own graph (via the
      // injected fetcher), map this Call's args → the sub-part's param scope, and
      // recurse — splicing the sub-recipe's root instr(s) in place of the Call.
      if (!resolve) {
        notes.push(`call ${node.id}: composite '${src}' cannot be inlined (no resolver) — UNSUPPORTED`);
        return { op: 'UNSUPPORTED', nodeType: `call:${src}`, detail: 'no composite resolver' };
      }
      if (seen.has(src)) {
        notes.push(`call ${node.id}: composite '${src}' is a CYCLE (already in the recursion path) — UNSUPPORTED`);
        return { op: 'UNSUPPORTED', nodeType: `call:${src}`, detail: 'composite cycle' };
      }
      if (depth >= MAX_COMPOSITE_DEPTH) {
        notes.push(`call ${node.id}: composite '${src}' exceeds depth cap ${MAX_COMPOSITE_DEPTH} — UNSUPPORTED`);
        return { op: 'UNSUPPORTED', nodeType: `call:${src}`, detail: 'composite depth cap' };
      }
      const resolved = resolve(src);
      if (!resolved || !resolved.graph) {
        notes.push(`call ${node.id}: composite '${src}' did not resolve to a graph — UNSUPPORTED`);
        return { op: 'UNSUPPORTED', nodeType: `call:${src}`, detail: 'composite unresolved' };
      }
      // Map the Call's args → numeric sub-param values, evaluated in the CURRENT
      // scope (so a parent param/expr flows into the child). Merge over the
      // sub-part's declared defaults.
      const callParams: Record<string, number> = {};
      for (const [k, v] of Object.entries(args)) {
        const nv = evalArg(v, scope);
        if (Number.isFinite(nv)) callParams[k] = nv;
      }
      const subParams = { ...(resolved.params ?? {}), ...callParams };
      const subRecipe = graphToTfInner(
        resolved.graph, subParams, resolve, depth + 1, new Set([...seen, src]),
      );
      for (const nt of subRecipe.notes) notes.push(`[${src}] ${nt}`);
      const subInstrs = subRecipe.instrs;
      if (subInstrs.length === 0) {
        notes.push(`call ${node.id}: composite '${src}' produced no output instrs — UNSUPPORTED`);
        return { op: 'UNSUPPORTED', nodeType: `call:${src}`, detail: 'composite empty' };
      }
      // One output → splice it directly; several → union them (the sub-part's
      // unconsumed outputs, mirroring executeTfRecipe's multi-root union).
      return subInstrs.length === 1 ? subInstrs[0]! : { op: 'union', children: subInstrs };
    }

    case 'method': {
      const op = (node as any).op as 'subtract' | 'add' | 'intersect';
      const obj = ref((node as any).obj);
      const arg = ref((node as any).arg);
      if (op === 'subtract') return { op: 'booleanDifference', obj, arg };
      if (op === 'add') return { op: 'booleanUnion', obj, arg };
      return { op: 'booleanIntersection', obj, arg };
    }

    case 'list':
    case 'group':
    case 'stack': {
      const isStack = node.type === 'stack';
      const childIds = ((node as any).children as NodeId[]) ?? [];
      // PER-CHILD COUNT (×N): a child listed in this container's `childCounts` is
      // repeated N times — mirroring composition-emit's
      // `...Array(N).fill(0).map(() => withStackRef(child, ref))`. In a STACK
      // container the copies stack END-TO-END down +Z (`repeat` mode 'stack'), so
      // the executor's buildMatedStack places them by Z-extent instead of piling
      // them all at the shared local origin (the g_dp_stand overlap-at-origin bug).
      // A count of 1 (or an absent entry) lowers the child directly, unchanged.
      const childCounts = (node as any).childCounts as Record<NodeId, ArgValue> | undefined;
      // PER-CHILD MATE OFFSET (#stack_ref). A stack advances its Z-cursor past each
      // child by (child length + stackRef), NOT flush — matching Manifold's
      // `stack()`: `cursor = tail(placed) + _stackRef` (graded delta: 0 = flush,
      // + = gap, − = OVERLAP). The effective ref is the stack's `childRefs`
      // override, else the child part's own `stack_ref` default, else null (=
      // unauthored → the executor's 0.1 weld nudge). Only a STACK container mates;
      // a list/group leaves children where they sit.
      const childRefs = (node as { childRefs?: Record<NodeId, number> }).childRefs;
      const offsets: (number | null)[] = [];
      const children = childIds.map((cid) => {
        const inst = ref(cid);
        const stackRef = isStack
          ? effectiveStackRef(cid, childRefs, graph, resolve, seen, depth)
          : null;
        offsets.push(stackRef);
        const count = childCounts ? evalInt(childCounts[cid], scope, 1) : 1;
        if (count > 1) {
          return { op: 'repeat' as const, count, child: inst, ...(isStack ? { mode: 'stack', stackRef } : {}) };
        }
        return inst;
      });
      return {
        op: 'union',
        children,
        ...(isStack ? { mated: true, offsets } : {}),
      };
    }

    case 'mv': {
      const offset = (node as any).offset.map((v: ArgValue) => evalArg(v, scope)) as Vec3;
      return { op: 'translate', offset, child: ref((node as any).child) };
    }

    case 'rot': {
      const deg = (node as any).rot.map((v: ArgValue) => evalArg(v, scope)) as Vec3;
      return { op: 'rotate', deg, child: ref((node as any).child) };
    }

    case 'txfmn': {
      // rotate FIRST (inner), then translate (outer) — matches composition-emit.
      const rot = (node as any).rot.map((v: ArgValue) => evalArg(v, scope)) as Vec3;
      const off = (node as any).offset.map((v: ArgValue) => evalArg(v, scope)) as Vec3;
      const child = ref((node as any).child ?? '');
      const rotId = rot.every((n) => n === 0);
      const mvId = off.every((n) => n === 0);
      let inst: TfInstr = child;
      if (!rotId) inst = { op: 'rotate', deg: rot, child: inst };
      if (!mvId) inst = { op: 'translate', offset: off, child: inst };
      return inst;
    }

    case 'repeat': {
      const count = evalInt((node as any).count, scope, 1);
      const children = ((node as any).children as NodeId[]) ?? [];
      const child = children.length === 1
        ? ref(children[0]!)
        : { op: 'union' as const, children: children.map(ref) };
      return { op: 'repeat', count, child, ...(( node as any).op ? { mode: (node as any).op } : {}) };
    }

    case 'polygon':
      return { op: 'profile', profile: resolvePolygon(node as PolygonNode, scope, notes) };

    case 'sketch':
      return { op: 'profile', profile: resolveSketch(node as SketchNode, scope, notes) };

    default:
      notes.push(`node ${node.id}: type '${(node as any).type}' has no TF mapping — UNSUPPORTED`);
      return { op: 'UNSUPPORTED', nodeType: (node as any).type };
  }
}

/** Compile a composition graph → a TrueForm instruction recipe. Walks the ROOT's
 *  unconsumed children (the composition's outputs), lowering each. `resolveComposite`
 *  (optional) lets a Call to a COMPOSITE volume part be inlined: its own graph is
 *  fetched, its args mapped in, and its root instr(s) spliced in place — so an
 *  assembly of assemblies (e.g. `s_tube_demo` → `sweep_tube_demo` → `r_sweep`)
 *  compiles to one fully-inlined recipe. Without a resolver, composite Calls stay
 *  UNSUPPORTED (unchanged v0 behaviour). */
export function graphToTf(
  graph: Graph,
  params: Record<string, number> = {},
  resolveComposite?: ResolveComposite,
): TfRecipe {
  return graphToTfInner(graph, params, resolveComposite, 0, new Set());
}

/** Internal recursion body — carries the composite `depth` + `seen` cycle-guard. */
function graphToTfInner(
  graph: Graph,
  params: Record<string, number>,
  resolve: ResolveComposite | undefined,
  depth: number,
  seen: Set<string>,
): TfRecipe {
  const scope = paramScope(graph, params);
  const notes: string[] = [];
  const root = graph.nodes[graph.root];

  let outputs: NodeId[];
  if (root && root.type === 'list') {
    const consumed = computeConsumed(graph);
    outputs = (root.children as NodeId[]).filter((c) => !consumed.has(c));
    if (outputs.length === 0) outputs = root.children as NodeId[]; // degenerate — show them all
  } else {
    outputs = [graph.root];
  }

  const instrs = outputs.map((id) => lowerNode(graph.nodes[id], graph, scope, notes, resolve, seen, depth));
  // Per-part appearance (aligned with instrs) — each output part's effective
  // appearance (wired material ▸ per-part override) for the per-part-mesh TF
  // render. Only Call outputs carry appearance today; other output shapes → none.
  const partAppearance = outputs.map((id) => {
    const n = graph.nodes[id];
    if (n?.type !== 'call') return undefined;
    const eff = resolveEffectiveAppearance(graph, id);
    const a: TfAppearance = {};
    if (eff.colorOuter) a.colorOuter = eff.colorOuter;
    if (eff.colorInner) a.colorInner = eff.colorInner;
    if (eff.texture) a.texture = eff.texture;
    if (typeof eff.opacity === 'number' && eff.opacity > 0 && eff.opacity < 1) a.opacity = eff.opacity;
    return Object.keys(a).length ? a : undefined;
  });
  return { instrs, notes, ...(partAppearance.some(Boolean) ? { partAppearance } : {}) };
}

// ─── pretty-printer ──────────────────────────────────────────────────────────

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return 'NaN';
  // Trim to a readable precision without trailing-zero noise.
  const r = Math.round(n * 1e6) / 1e6;
  return String(r);
}

function fmtProfile(profile: ProfilePt[]): string {
  return `[${profile.map(([r, z]) => `[${fmtNum(r)}, ${fmtNum(z)}]`).join(', ')}]`;
}

function fmtVec(v: Vec3): string {
  return `[${v.map(fmtNum).join(', ')}]`;
}

/** Render ONE TfInstr as an indented, TF-flavoured pseudo-call tree. */
function fmtInstr(inst: TfInstr, indent: number): string {
  const pad = '  '.repeat(indent);
  switch (inst.op) {
    case 'revolve':
      return `${pad}tfRevolveProfile(segments=${inst.segments}${inst.note ? `, ${inst.note}` : ''})\n` +
        `${pad}  profile = ${fmtProfile(inst.profile)}`;
    case 'box':
      return `${pad}boxMesh(w=${fmtNum(inst.w)}, h=${fmtNum(inst.h)}, d=${fmtNum(inst.d)})`;
    case 'cylinder':
      return `${pad}cylinderMesh(radius=${fmtNum(inst.radius)}, height=${fmtNum(inst.height)}, segments=${inst.segments})`;
    case 'sweep':
      return `${pad}tubeMesh(radius=${fmtNum(inst.radius)}, radialSegments=${inst.radialSegments}, capped=${inst.capped !== false}) along a ${inst.path.length}-pt swept path`;
    case 'booleanDifference':
    case 'booleanUnion':
    case 'booleanIntersection':
      return `${pad}${inst.op}(\n` +
        `${fmtInstr(inst.obj, indent + 1)},\n` +
        `${fmtInstr(inst.arg, indent + 1)}\n` +
        `${pad})`;
    case 'union': {
      const refs = inst.offsets?.some((o) => o != null)
        ? ` mate-offsets=[${inst.offsets.map((o) => (o == null ? '·' : fmtNum(o))).join(', ')}]`
        : '';
      const label = (inst.mated ? 'stack/union (mated end-to-end)' : 'booleanUnion (fold)') + refs;
      if (inst.children.length === 1) return fmtInstr(inst.children[0]!, indent);
      return `${pad}${label} [\n` +
        inst.children.map((c) => fmtInstr(c, indent + 1)).join(',\n') +
        `\n${pad}]`;
    }
    case 'translate':
      return `${pad}makeTranslation(${fmtVec(inst.offset)}) applied to\n` +
        `${fmtInstr(inst.child, indent + 1)}`;
    case 'rotate':
      return `${pad}makeRotation(${fmtVec(inst.deg)}°) applied to\n` +
        `${fmtInstr(inst.child, indent + 1)}`;
    case 'repeat':
      return `${pad}repeat ×${inst.count}${inst.mode ? ` (${inst.mode})` : ''}${inst.stackRef != null ? ` mate-offset=${fmtNum(inst.stackRef)}` : ''} of\n` +
        `${fmtInstr(inst.child, indent + 1)}`;
    case 'profile':
      return `${pad}profile ${fmtProfile(inst.profile)}${inst.note ? `  // ${inst.note}` : ''}`;
    case 'UNSUPPORTED':
      return `${pad}⛔ UNSUPPORTED <${inst.nodeType}>${inst.detail ? ` — ${inst.detail}` : ''}`;
  }
}

/** Pretty-print a recipe (or a bare instruction list) as a readable TF plan. */
export function tfRecipeText(recipe: TfRecipe | TfInstr[], id?: string): string {
  const instrs = Array.isArray(recipe) ? recipe : recipe.instrs;
  const notes = Array.isArray(recipe) ? [] : recipe.notes;
  const header = id ?? (Array.isArray(recipe) ? undefined : recipe.id);
  const lines: string[] = [];
  if (header) lines.push(`${header} →`);
  instrs.forEach((inst, i) => {
    lines.push(`  [output ${i}]`);
    lines.push(fmtInstr(inst, 2));
  });
  if (notes.length > 0) {
    lines.push('  notes:');
    for (const n of notes) lines.push(`    - ${n}`);
  }
  return lines.join('\n');
}
