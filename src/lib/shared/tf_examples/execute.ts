/**
 * tf_examples/execute — the EXECUTOR for a `TfRecipe` (TODO #46).
 *
 * `graph-to-tf.ts` COMPILES a composition graph → a data-only `TfRecipe`
 * (`{ instrs: TfInstr[], notes }`). This module EXECUTES that recipe against a
 * live TrueForm kernel: it walks the instruction tree and mirrors, node-for-node,
 * the exact tf-op call patterns the hand-written `tf_examples/*` demos use —
 * `tfRevolveProfile` (lathe), `boxMesh` / `cylinderMesh` (primitives),
 * `boolean{Difference,Union,Intersection}(a,b).mesh` (CSG), and mesh
 * `transformation = makeTranslation(...).matMul(makeRotation(...))` composition.
 * So a REAL volume part builds NATIVELY in TrueForm from its graph, not by
 * importing an already-baked Manifold mesh.
 *
 * The executor is the analogue of `composition-bake.ts` for the TF backend. It is
 * NOT pure (it drives WASM), but it takes the initialised `tf` / `t` handles as
 * arguments (never calls `ensureTf` itself), so the recursion is unit-testable
 * with a MOCK `t` — no 31 MB kernel needed to prove it walks the tree correctly.
 *
 * Recipes that contain any node TrueForm can't build (`UNSUPPORTED` — e.g. a
 * linear extrude / loft, which tf has no generator for — or a revolve whose
 * profile never resolved) are caught up-front by {@link recipeHasUnsupported};
 * the caller then falls back to the mesh-import path (`tfImportMesh`) instead of
 * running a doomed native build. Executing such a recipe throws
 * {@link TfUnsupportedError} at the offending node.
 */
import { tfRevolveProfile } from './revolve';
import { tfResult, buildOpenCurve, capOpenEnds, type TfDemoResult } from '../trueform-client';
import type { TfRecipe, TfInstr, Vec3 } from '$lib/cad/graph-to-tf';

/** Flatten a `[[x,y,z]…]` path → the `[n*3]` Float32Array `buildOpenCurve` /
 *  `tubeMesh` sweep along. */
function flatFloat32(path: Vec3[]): Float32Array {
  const out = new Float32Array(path.length * 3);
  for (let i = 0; i < path.length; i++) {
    out[i * 3] = path[i][0];
    out[i * 3 + 1] = path[i][1];
    out[i * 3 + 2] = path[i][2];
  }
  return out;
}

/** Thrown by {@link executeTfRecipe} when it reaches a node TrueForm can't build
 *  natively (an `UNSUPPORTED` instr, or an unknown op). Callers gate on
 *  {@link recipeHasUnsupported} to avoid ever hitting this. */
export class TfUnsupportedError extends Error {
  nodeType: string;
  constructor(nodeType: string) {
    super(`TrueForm cannot build node '${nodeType}' natively (no TF generator)`);
    this.name = 'TfUnsupportedError';
    this.nodeType = nodeType;
  }
}

/** A revolve/profile needs at least a triangle's worth of section points to
 *  enclose any area — fewer means graph-to-tf couldn't resolve the profile, so
 *  the native lathe would produce garbage. Treated as "unsupported" → fall back. */
const MIN_PROFILE_PTS = 3;

/**
 * Compose a transform matrix onto a mesh handle. TrueForm has no transform stack;
 * each mesh carries a single `transformation` 4×4. When the mesh already has one
 * (a child that was itself translated/rotated), the NEW matrix is applied on the
 * OUTSIDE via `mat.matMul(existing)` — same column-vector convention the
 * mule_shoe demo uses (rightmost matrix applies first). A fresh mesh (no prior
 * transform) just takes `mat`.
 */
function applyTransform(t: any, mesh: any, mat: any): void {
  const existing = mesh.transformation;
  mesh.transformation = existing ? mat.matMul(existing) : mat;
}

/**
 * Recursively build ONE `TfInstr` → a TrueForm `Mesh` handle, mirroring the
 * tf_examples call patterns. Booleans/transforms/containers recurse into their
 * child instrs first, exactly as the graph nests them.
 */
function buildInstr(t: any, instr: TfInstr): any {
  switch (instr.op) {
    case 'revolve':
      // Lathe the closed half-section — the tf_examples/revolve.ts pattern.
      return tfRevolveProfile(t, instr.profile, instr.segments || 64);
    case 'profile':
      // A bare profile (an unconsumed polygon/sketch) → lathe it at a default res.
      return tfRevolveProfile(t, instr.profile, 64);
    case 'box':
      return t.boxMesh(instr.w, instr.h, instr.d);
    case 'cylinder':
      return t.cylinderMesh(instr.radius, instr.height, instr.segments || 64);
    case 'sweep': {
      // A circular section swept along a 3D path → tubeMesh over an open Catmull-
      // Rom curve, then capped into a closed solid (the tf_examples/s_tube_demo
      // pattern). `capped === false` (e.g. a closed-loop path) leaves it open.
      const flat = flatFloat32(instr.path);
      const tube = t.tubeMesh(buildOpenCurve(t, flat, instr.path.length), instr.radius, instr.radialSegments || 32);
      return instr.capped === false ? tube : capOpenEnds(t, tube);
    }
    case 'booleanDifference':
      return t.booleanDifference(buildInstr(t, instr.obj), buildInstr(t, instr.arg)).mesh;
    case 'booleanUnion':
      return t.booleanUnion(buildInstr(t, instr.obj), buildInstr(t, instr.arg)).mesh;
    case 'booleanIntersection':
      return t.booleanIntersection(buildInstr(t, instr.obj), buildInstr(t, instr.arg)).mesh;
    case 'union': {
      // list / group / stack → fold booleanUnion over the children (dp_joint pattern).
      const kids = instr.children;
      if (kids.length === 0) throw new TfUnsupportedError('union(empty)');
      let acc = buildInstr(t, kids[0]);
      for (let i = 1; i < kids.length; i++) acc = t.booleanUnion(acc, buildInstr(t, kids[i])).mesh;
      return acc;
    }
    case 'translate': {
      const child = buildInstr(t, instr.child);
      const [x, y, z] = instr.offset;
      applyTransform(t, child, t.makeTranslation(x, y, z));
      return child;
    }
    case 'rotate': {
      const child = buildInstr(t, instr.child);
      const [rx, ry, rz] = instr.deg;
      // One makeRotation per non-zero axis, composed via matMul (mule_shoe pattern).
      let mat: any = null;
      if (rx) mat = t.makeRotation(rx, 'x');
      if (ry) mat = mat ? mat.matMul(t.makeRotation(ry, 'y')) : t.makeRotation(ry, 'y');
      if (rz) mat = mat ? mat.matMul(t.makeRotation(rz, 'z')) : t.makeRotation(rz, 'z');
      if (mat) applyTransform(t, child, mat);
      return child;
    }
    case 'repeat': {
      // Build N copies + union. The v0 recipe does NOT carry the per-copy stride
      // (repeat lowered to count+child only), so copies coincide — a faithful
      // approximation until graph-to-tf captures the repeat transform. Each copy
      // is rebuilt fresh so it's a distinct mesh handle.
      const n = Math.max(1, Math.floor(instr.count));
      let acc = buildInstr(t, instr.child);
      for (let i = 1; i < n; i++) acc = t.booleanUnion(acc, buildInstr(t, instr.child)).mesh;
      return acc;
    }
    case 'UNSUPPORTED':
      throw new TfUnsupportedError(instr.nodeType);
    default:
      throw new TfUnsupportedError((instr as any).op ?? 'unknown');
  }
}

/**
 * Execute a `TfRecipe` against a live TrueForm kernel → a {@link TfDemoResult}
 * (mesh data + tf's topology verdict, cut when `opts.cutaway`). Builds each root
 * output instr, unions them into one solid, orients it outward
 * (`positivelyOriented`, try/catch like the demos), and finalises via
 * {@link tfResult} (the same cutaway + analyse back-end every demo uses).
 *
 * `tf` is the initialised module, `t` the same handle cast to any (the demos
 * pass both) — this driver never calls `ensureTf` so it stays testable with a
 * mock. Guard with {@link recipeHasUnsupported} before calling; an UNSUPPORTED
 * node throws {@link TfUnsupportedError}.
 */
export function executeTfRecipe(
  tf: any,
  t: any,
  recipe: TfRecipe,
  opts: { cutaway?: boolean } = {},
): TfDemoResult {
  const instrs = recipe?.instrs ?? [];
  if (instrs.length === 0) throw new TfUnsupportedError('(empty recipe)');
  // Build each ROOT output; union multiples into one solid (the composition's
  // unconsumed outputs, mirroring dp_joint's box+tube+pin weld).
  let solid = buildInstr(t, instrs[0]);
  for (let i = 1; i < instrs.length; i++) {
    solid = t.booleanUnion(solid, buildInstr(t, instrs[i])).mesh;
  }
  // Enforce one consistent outward orientation (harmless if already positive).
  try { solid = t.positivelyOriented(solid); } catch { /* keep the union as-is */ }
  return tfResult(tf, t, solid, { cutaway: opts?.cutaway, cuttable: true });
}

/** Deep-scan a recipe for any node TrueForm can't build natively: an explicit
 *  `UNSUPPORTED` instr anywhere in the tree, or a revolve/profile whose section
 *  never resolved (< 3 points). True → the caller should use the mesh-import
 *  fallback instead of a native TF build. */
export function recipeHasUnsupported(recipe: TfRecipe): boolean {
  return (recipe?.instrs ?? []).some(instrHasUnsupported);
}

function instrHasUnsupported(instr: TfInstr): boolean {
  switch (instr.op) {
    case 'UNSUPPORTED':
      return true;
    case 'revolve':
    case 'profile':
      return (instr.profile?.length ?? 0) < MIN_PROFILE_PTS;
    case 'sweep':
      // A sweep needs at least a start + end point to define a curve.
      return (instr.path?.length ?? 0) < 2;
    case 'booleanDifference':
    case 'booleanUnion':
    case 'booleanIntersection':
      return instrHasUnsupported(instr.obj) || instrHasUnsupported(instr.arg);
    case 'union':
      return instr.children.some(instrHasUnsupported);
    case 'translate':
    case 'rotate':
    case 'repeat':
      return instrHasUnsupported(instr.child);
    default:
      return false;
  }
}
