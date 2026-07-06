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
import { tfExtrudeProfile } from './extrude';
import { tfResult, tfMeshData, buildOpenCurve, capOpenEnds, runTfGuarded, weldMeshByPosition, type TfDemoResult } from '../trueform-client';
import type { TfRecipe, TfInstr, Vec3 } from '$lib/cad/graph-to-tf';
import { warpMeshJS, subdivideAxialAdaptive, densifyProfileAxial } from '$lib/cad/warp-spline';

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

/** How far to punch a boolean-subtrahend sweep's path past both ends so its caps
 *  clear the outer solid's caps (mirrors s_tube_demo's BORE_EXT). */
const BORE_EXT = 1.0;

/** Extend a path by `ext` along its END TANGENTS at both ends (one extra point
 *  before the first, one after the last). Used for a sweep that's SUBTRACTED so
 *  its bore punches fully THROUGH the outer end caps — otherwise the two sweeps
 *  share coincident tilted caps and the mesh boolean stitches phantom handles
 *  (defect-2: closed+manifold but χ wrong). PROVEN: same path → χ=-16; extended
 *  → χ=0 (see the clean-boolean probe). Mirrors s_tube_demo.extendPathEnds. */
function extendPathEnds(path: Vec3[], ext = BORE_EXT): Vec3[] {
  const n = path.length;
  if (n < 2) return path;
  const nrm = (v: Vec3) => Math.hypot(v[0], v[1], v[2]) || 1;
  const s0: Vec3 = [path[0][0] - path[1][0], path[0][1] - path[1][1], path[0][2] - path[1][2]];
  const ls = nrm(s0);
  const e0: Vec3 = [path[0][0] + (s0[0] / ls) * ext, path[0][1] + (s0[1] / ls) * ext, path[0][2] + (s0[2] / ls) * ext];
  const d1: Vec3 = [path[n - 1][0] - path[n - 2][0], path[n - 1][1] - path[n - 2][1], path[n - 1][2] - path[n - 2][2]];
  const le = nrm(d1);
  const e1: Vec3 = [path[n - 1][0] + (d1[0] / le) * ext, path[n - 1][1] + (d1[1] / le) * ext, path[n - 1][2] + (d1[2] / le) * ext];
  return [e0, ...path, e1];
}

/** Build a `sweep` instr → a capped tube. `extend` punches the path through both
 *  ends (for a boolean subtrahend — avoids coincident-cap defect-2). */
function buildSweep(t: any, instr: any, extend = false): any {
  const path: Vec3[] = extend ? extendPathEnds(instr.path) : instr.path;
  const flat = flatFloat32(path);
  const tube = t.tubeMesh(buildOpenCurve(t, flat, path.length), instr.radius, instr.radialSegments || 32);
  return instr.capped === false ? tube : capOpenEnds(t, tube);
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
 * Local Z-extent (min/max of a built mesh's own vertex buffer) — the axial size
 * used to stack a MATED container end-to-end. Reads `mesh.points.data` directly
 * (the LOCAL point buffer, before any `.transformation` the mesh carries), so it
 * is the child's intrinsic length regardless of where it will be placed. Returns
 * `{min:0,max:0}` for an empty/degenerate buffer (a zero-length child just doesn't
 * advance the cursor). */
function localZExtent(mesh: any): { min: number; max: number } {
  const d = mesh?.points?.data as ArrayLike<number> | undefined;
  if (!d || d.length < 3) return { min: 0, max: 0 };
  let min = Infinity;
  let max = -Infinity;
  for (let i = 2; i < d.length; i += 3) {
    const z = d[i];
    if (z < min) min = z;
    if (z > max) max = z;
  }
  return Number.isFinite(min) ? { min, max } : { min: 0, max: 0 };
}

/** Junction interpenetration (world units) so adjacent stacked solids WELD into
 *  one watertight manifold instead of kissing at a coincident coplanar face — the
 *  tf/Manifold boolean caveat that would otherwise leave a seam / phantom handle.
 *  Mirrors dp_joint's OVERLAP; small vs. any real part length. */
const STACK_OVERLAP = 0.1;

/**
 * Build a MATED container (a graph `stack` node → `{op:'union', mated:true}`).
 *
 * A plain union folds every child at its OWN local origin, so a stack authored as
 * box(z 0..6) + tube(z 0..25) + pin(z 0..7) piles all three at z=0 and the pin is
 * buried inside the tube — the g_dp_joint bug. Here we honour `mated`: measure each
 * built child's Z-extent and place the children END-TO-END down +Z. Extents are
 * only known once the child mesh exists, so this is the executor's job (the compiler
 * can't measure a mesh it hasn't built).
 *
 * Z-DOWN convention (top = LOWER z, downhole = +z): a running `cursor` marks where
 * the NEXT child's TOP (its min z) goes. The first child's top sits at z=0; each
 * subsequent child's top meets the previous child's bottom, tucked up by
 * {@link STACK_OVERLAP} so the union welds cleanly. Each child is shifted with a
 * `makeTranslation([0,0,dz])` composed via {@link applyTransform} (respecting any
 * transform the child already carries), then unioned. Coaxial bores stay aligned →
 * one continuous through-bore. This mirrors `manifold-helpers.stack()` on the
 * Manifold side (flush end-to-end, first child at origin).
 */
/**
 * Position a list of ALREADY-BUILT meshes END-TO-END down +Z and weld them into
 * one solid — the shared placement machinery behind both a MATED stack container
 * ({@link buildMatedStack}) and a `stack`-mode `repeat` (N copies of one child).
 *
 * Z-DOWN (top = LOWER z, downhole = +z): a running `cursor` marks where the NEXT
 * mesh's TOP (its min z) goes. The first mesh's top sits at z=0; each subsequent
 * mesh's top meets the previous mesh's bottom, adjusted by that child's STACK MATE
 * OFFSET (`offsets[i]` — Manifold's `_stackRef`: 0 = flush, + = gap, − = overlap).
 * When a child has no authored offset (`null`) the cursor tucks up by {@link
 * STACK_OVERLAP} instead so the union still welds cleanly. Each mesh is slid with a
 * `makeTranslation([0,0,dz])` (composed via {@link applyTransform}, respecting any
 * transform it already carries), then unioned. Extents come from each mesh's LOCAL
 * point buffer ({@link localZExtent}), so a mesh authored at its own origin lands
 * correctly.
 */
function placeEndToEnd(t: any, meshes: any[], offsets?: (number | null)[]): any {
  let acc: any = null;
  let cursor = 0; // world z where the NEXT mesh's TOP (min z) lands
  for (let i = 0; i < meshes.length; i++) {
    const child = meshes[i];
    const { min: zMin, max: zMax } = localZExtent(child);
    const dz = cursor - zMin; // slide this mesh's TOP onto the cursor
    if (Math.abs(dz) > 1e-9) applyTransform(t, child, t.makeTranslation(0, 0, dz));
    // Advance past this mesh's length, then apply the per-child STACK MATE OFFSET
    // (the value the graph carried through as this child's `stack_ref` — matches
    // Manifold's `stack()`: `cursor = tail(placed) + _stackRef`, a graded delta:
    // 0 = flush, + = gap, − = OVERLAP the next child by |ref|, e.g. a tool-joint
    // pin threading into the next box). When no ref was authored (`null`) we keep
    // the small {@link STACK_OVERLAP} weld nudge so adjacent solids interpenetrate
    // and the boolean welds cleanly instead of kissing at a coincident face.
    const ref = offsets?.[i];
    const advance = ref != null && Number.isFinite(ref) ? ref : -STACK_OVERLAP;
    cursor += Math.max(0, zMax - zMin) + advance;
    acc = acc == null ? child : t.booleanUnion(acc, child).mesh;
  }
  if (acc == null) throw new TfUnsupportedError('placeEndToEnd(empty)');
  return acc;
}

function buildMatedStack(t: any, kids: TfInstr[], offsets?: (number | null)[]): any {
  return placeEndToEnd(t, kids.map((k) => buildInstr(t, k)), offsets);
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
    case 'weld_extrude':
      // A 2D section extruded along Z (twist + top-scale taper + intermediate
      // rings) → the ported welded-grid extrude (tf_examples/extrude.ts), the
      // native analogue of Manifold's r_weld_extrude. Watertight + positively
      // oriented by the builder.
      return tfExtrudeProfile(t, instr.profile, {
        length: instr.length,
        divs: instr.divs,
        twist: instr.twist,
        scaleTop: instr.scaleTop,
        segments: instr.segments,
      });
    case 'profile':
      // A bare profile (an unconsumed polygon/sketch) → lathe it at a default res.
      return tfRevolveProfile(t, instr.profile, 64);
    case 'box':
      return t.boxMesh(instr.w, instr.h, instr.d);
    case 'cylinder':
      return t.cylinderMesh(instr.radius, instr.height, instr.segments || 64);
    case 'sweep':
      // A circular section swept along a 3D path → tubeMesh over an open Catmull-
      // Rom curve, then capped into a closed solid (the tf_examples/s_tube_demo
      // pattern). `capped === false` (e.g. a closed-loop path) leaves it open.
      return buildSweep(t, instr);
    case 'booleanDifference':
      // Extend a swept SUBTRAHEND's path so its bore punches through the outer
      // caps (no coincident tilted caps → clean χ=0, not defect-2).
      return t.booleanDifference(
        buildInstr(t, instr.obj),
        instr.arg.op === 'sweep' ? buildSweep(t, instr.arg, true) : buildInstr(t, instr.arg),
      ).mesh;
    case 'booleanUnion':
      return t.booleanUnion(buildInstr(t, instr.obj), buildInstr(t, instr.arg)).mesh;
    case 'booleanIntersection':
      return t.booleanIntersection(
        buildInstr(t, instr.obj),
        instr.arg.op === 'sweep' ? buildSweep(t, instr.arg, true) : buildInstr(t, instr.arg),
      ).mesh;
    case 'union': {
      // list / group / stack → fold booleanUnion over the children (dp_joint pattern).
      const kids = instr.children;
      if (kids.length === 0) throw new TfUnsupportedError('union(empty)');
      // A MATED stack (graph `stack` node) auto-positions its children end-to-end
      // down +Z (each is authored at its own local origin, so a plain fold would
      // pile them at z=0 — the g_dp_joint overlap-at-origin bug). A plain (group/
      // list) union leaves the children where they already sit.
      if (instr.mated) return buildMatedStack(t, kids, instr.offsets);
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
      // Build N distinct copies of the child (each rebuilt fresh so it's its own
      // mesh handle). A STACK-mode repeat (`mode:'stack'` — e.g. g_dp_stand's
      // `stack` of N joints) positions its copies END-TO-END down +Z via the same
      // {@link placeEndToEnd} machinery a mated stack uses, so N joints stack down
      // the string instead of piling at the shared local origin. Any other mode
      // (list/place/none — no linear stride captured in v0) folds the copies at
      // the origin, the faithful approximation until graph-to-tf carries a stride.
      const n = Math.max(1, Math.floor(instr.count));
      const copies = Array.from({ length: n }, () => buildInstr(t, instr.child));
      if (instr.mode === 'stack') {
        // Every copy is the SAME child, so it mates with the same per-copy stack
        // offset (g_dp_stand: each joint overlaps the previous by |stackRef|).
        const ref = instr.stackRef;
        const offsets =
          ref != null && Number.isFinite(ref) ? (new Array(n).fill(ref) as number[]) : undefined;
        return placeEndToEnd(t, copies, offsets);
      }
      let acc = copies[0];
      for (let i = 1; i < copies.length; i++) acc = t.booleanUnion(acc, copies[i]).mesh;
      return acc;
    }
    case 'warp': {
      // TF WARP (#6): build the child mesh IN TrueForm, then bend it in PURE JS
      // (warpMeshJS: positions along the spline frame) and rebuild a TF mesh from
      // the warped points. Same engine-agnostic warp the Manifold path uses.
      //
      // The child MUST carry enough axial rings for warpMeshJS to lay a smooth arc:
      // a TF revolve/box has almost NONE (a lathe = its profile's 2 z-levels only),
      // so a bare warp collapses to 1-2 chords. There are TWO ways to densify:
      //
      //  • BUILD-TIME (revolve child, the common case incl. bw_open_hole): subdivide
      //    the half-section PROFILE along Z and re-lathe → a CLEAN ring×segment grid
      //    (buildRevolveMesh stitches perfect quads, matching Manifold's r_revolve
      //    zSegments + refine). This is the durable fix (root CLAUDE.md Rule 25).
      //    subdivideAxialAdaptive CANNOT do this for a tube: every wall quad's two
      //    tris share a DIAGONAL edge spanning both z AND the circumference, and a
      //    z-plane always cuts that diagonal → an off-ring vertex at an intermediate
      //    angle → the "strange circumferential subdivisions" / long spanning tris.
      //
      //  • POST-BUILD (non-revolve child — box/sweep/boolean): fall back to the
      //    generic curvature-adaptive triangle-split (imperfect but keeps working).
      const childInstr = instr.child as any;
      const isRevolve =
        childInstr && (childInstr.op === 'revolve' || childInstr.op === 'profile') &&
        Array.isArray(childInstr.profile) && childInstr.profile.length >= 3;

      if (isRevolve) {
        const denseProfile = densifyProfileAxial(childInstr.profile, instr.path as any, {});
        const child = tfRevolveProfile(t, denseProfile, childInstr.segments || 64);
        const md = tfMeshData(child); // buildRevolveMesh shares verts already — no weld needed
        const src = md.points instanceof Float32Array ? md.points : new Float32Array(md.points);
        const { positions } = warpMeshJS(src, null, instr.path as any, { stretch: instr.stretch });
        return t.mesh(md.faces, positions);
      }

      const child = buildInstr(t, instr.child);
      const md = tfMeshData(child); // { points: Float(32|64)Array, faces: Int32Array }
      const src = md.points instanceof Float32Array ? md.points : new Float32Array(md.points);
      // Generic densify: insert curvature-adaptive z-stations, then re-weld by
      // position so t.mesh recovers shared-edge connectivity → smooth normals.
      const dense = subdivideAxialAdaptive(src, null, md.faces, instr.path as any, {});
      const welded = weldMeshByPosition(dense.positions, dense.faces);
      const { positions } = warpMeshJS(welded.points, null, instr.path as any, { stretch: instr.stretch });
      return t.mesh(welded.faces, positions);
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
  // The whole native build (tubeMesh / boxMesh / boolean{Difference,Union,
  // Intersection} …) runs inside runTfGuarded: a boolean on degenerate/coincident
  // geometry (the defect-2 tilted-coincident-cap class) can WASM-`unreachable`,
  // which POISONS the shared TF kernel so every LATER bake fails too. The guard
  // resets the singleton on a trap (next ensureTf re-inits a clean kernel) and
  // rethrows a readable reason instead of the opaque "unreachable" + a dead kernel.
  return runTfGuarded(() => {
    // Build each ROOT output (= a PART) as its OWN mesh first.
    const partMeshes = instrs.map((instr) => {
      const m = buildInstr(t, instr);
      try { return t.positivelyOriented(m); } catch { return m; }
    });

    // PER-PART meshes for the per-part-texture display (task #2/#3): extract each
    // part's flat mesh data NOW — BEFORE the union below may consume the handles.
    // Built REGARDLESS of cutaway (BUG 2 fix): the per-part material (steel/etc.)
    // must show on the FULL view whether or not the cut toggle is on — the scene
    // renders `parts` on the full view and the merged grey/red section on the cut
    // view (per-part material ON the cut section is out of scope, v1). A SINGLE
    // output part with its own appearance (e.g. a `material` preset — bw_open_hole =
    // one steel g_shaft) must still render per-part so its metalness/tint lands;
    // `appearance.some(Boolean)` gates to appearance-bearing recipes, so parts with
    // NO appearance stay on the merged single-mesh path (byte-identical).
    const appearance = recipe.partAppearance;
    const wantParts = !!appearance && appearance.some(Boolean) && partMeshes.length >= 1;
    const partData = wantParts ? partMeshes.map((m) => tfMeshData(m)) : null;

    // Merged union — the single-mesh `data` + cutaway + stats (back-compat: the
    // composition's unconsumed outputs, mirroring dp_joint's box+tube+pin weld).
    let solid = partMeshes[0];
    for (let i = 1; i < partMeshes.length; i++) {
      solid = t.booleanUnion(solid, partMeshes[i]).mesh;
    }
    // Enforce one consistent outward orientation (harmless if already positive).
    try { solid = t.positivelyOriented(solid); } catch { /* keep the union as-is */ }
    const merged = tfResult(tf, t, solid, { cutaway: opts?.cutaway, cuttable: true });
    if (partData) merged.parts = partData.map((data, i) => ({ data, appearance: appearance![i] }));
    return merged;
  });
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
    case 'weld_extrude':
      // A section needs at least a triangle's worth of points to enclose area.
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
    case 'warp':
      return instrHasUnsupported(instr.child);
    default:
      return false;
  }
}
