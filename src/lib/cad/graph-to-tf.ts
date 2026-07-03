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
} from './composition-graph-types';

// ─── instruction data model ─────────────────────────────────────────────────

export type Vec3 = [number, number, number];
export type ProfilePt = [number, number];

/** A single node lowered to its TrueForm equivalent. A tree: booleans / transforms
 *  / containers hold child `TfInstr`s, mirroring the graph's expression nesting. */
export type TfInstr =
  | { op: 'revolve'; profile: ProfilePt[]; segments: number; note?: string }
  | { op: 'box'; w: number; h: number; d: number }
  | { op: 'cylinder'; radius: number; height: number; segments: number }
  | { op: 'booleanDifference'; obj: TfInstr; arg: TfInstr }
  | { op: 'booleanUnion'; obj: TfInstr; arg: TfInstr }
  | { op: 'booleanIntersection'; obj: TfInstr; arg: TfInstr }
  | { op: 'union'; children: TfInstr[]; mated?: boolean }
  | { op: 'translate'; offset: Vec3; child: TfInstr }
  | { op: 'rotate'; deg: Vec3; child: TfInstr }
  | { op: 'repeat'; count: number; child: TfInstr; mode?: string }
  | { op: 'profile'; profile: ProfilePt[]; note?: string }
  | { op: 'UNSUPPORTED'; nodeType: string; detail?: string };

/** The full recipe: the ordered list of TF instructions the graph's ROOT
 *  produces (its unconsumed outputs), plus any coverage notes gathered
 *  during the walk. */
export interface TfRecipe {
  id?: string;
  instrs: TfInstr[];
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

/** Lower a single node → its TfInstr, recursing into referenced children. */
function lowerNode(
  node: GraphNode | undefined,
  graph: Graph,
  scope: Record<string, number>,
  notes: string[],
): TfInstr {
  if (!node) return { op: 'UNSUPPORTED', nodeType: '(missing)', detail: 'referenced node not found' };
  const ref = (id: NodeId) => lowerNode(graph.nodes[id], graph, scope, notes);

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
      if (/cyl/i.test(src)) {
        // A cylinder-like engine → cylinderMesh(radius, height, segments). Best-effort
        // on common arg names (r/radius, len/length/h/height).
        const radius = evalArg(args.r ?? args.radius, scope);
        const height = evalArg(args.len ?? args.length ?? args.h ?? args.height, scope);
        const segments = evalInt(args.segments ?? args.seg, scope, 64);
        return { op: 'cylinder', radius, height, segments };
      }
      // r_weld_extrude / r_loft / any other engine — TrueForm has no linear
      // extrude / profile-loft (see trueform-api-notes.md § ⛔). Flag it.
      notes.push(`call ${node.id}: engine '${src}' has no TrueForm equivalent (no extrude/loft in tf) — UNSUPPORTED`);
      return { op: 'UNSUPPORTED', nodeType: `call:${src}`, detail: 'no TF generator for this engine' };
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
      const children = ((node as any).children as NodeId[]).map(ref);
      return { op: 'union', children, ...(node.type === 'stack' ? { mated: true } : {}) };
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

/** Compile a composition graph → a TrueForm instruction recipe (v0). Walks the
 *  ROOT's unconsumed children (the composition's outputs), lowering each. */
export function graphToTf(graph: Graph, params: Record<string, number> = {}): TfRecipe {
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

  const instrs = outputs.map((id) => lowerNode(graph.nodes[id], graph, scope, notes));
  return { instrs, notes };
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
    case 'booleanDifference':
    case 'booleanUnion':
    case 'booleanIntersection':
      return `${pad}${inst.op}(\n` +
        `${fmtInstr(inst.obj, indent + 1)},\n` +
        `${fmtInstr(inst.arg, indent + 1)}\n` +
        `${pad})`;
    case 'union': {
      const label = inst.mated ? 'stack/union (mated end-to-end)' : 'booleanUnion (fold)';
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
      return `${pad}repeat ×${inst.count}${inst.mode ? ` (${inst.mode})` : ''} of\n` +
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
