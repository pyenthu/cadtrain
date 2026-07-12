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
import { tfLoftProfile } from './loft';
import { tfSweepSection } from './sweep-section';
import { tfResult, tfMeshData, tfAnalyze, buildOpenCurve, capOpenEnds, runTfGuarded, weldMeshByPosition, applyTfCutaway, type TfDemoResult, type TfMeshData, type TfMeshStats, type TfCutPlane } from '../trueform-client';
import type { TfRecipe, TfInstr, Vec3 } from '$lib/engines/trueform/graph-to-tf';
import { warpMeshJS, subdivideAxialAdaptive, densifyProfileAxial } from '$lib/engines/manifold/warp-spline';

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

/** Cap for the GENERIC (non-revolve) warp densifier's z-stations. subdivideAxialAdaptive
 *  plane-SPLITS an already-built mesh, so its default cap of 128 stations balloons even a
 *  small tube into tens of thousands of triangles (192 tris → ~26 k at 128) AND — because
 *  every tube wall quad's diagonal spans z+circumference — introduces off-ring "spanning"
 *  triangles (Rule 25). Only box/sweep/loft warps still take this path (no clean profile to
 *  re-lathe); a modest cap keeps them bendable without the blow-up. */
const GENERIC_WARP_MAX_STATIONS = 24;

/** True when this instr tree can be warped by densifying at the PROFILE level and
 *  re-building — i.e. every LEAF is a revolve/profile and the interior is only
 *  transforms / booleans / unions (e.g. a hollow tube = `revolve(outer).subtract(
 *  revolve(inner))`, which is what bw_casing / bw_open_hole compile to). Such a
 *  tree is densified per-leaf into CLEAN ring×segment grids (see {@link
 *  densifyRevolveTree}), so the warp bends smoothly WITHOUT the plane-split
 *  diagonal artifact + vert explosion subdivideAxialAdaptive inflicts on an
 *  already-triangulated tube (the TODO #39 regression). */
export function isRevolveTree(instr: any): boolean {
  if (!instr) return false;
  switch (instr.op) {
    case 'revolve':
    case 'profile':
      return Array.isArray(instr.profile) && instr.profile.length >= MIN_PROFILE_PTS;
    case 'translate':
    case 'rotate':
    case 'cutaway':
      return isRevolveTree(instr.child);
    case 'booleanDifference':
    case 'booleanUnion':
    case 'booleanIntersection':
      return isRevolveTree(instr.obj) && isRevolveTree(instr.arg);
    case 'union':
      return Array.isArray(instr.children) && instr.children.length > 0 && instr.children.every(isRevolveTree);
    default:
      return false;
  }
}

/** Deep-clone a revolve-tree instr (see {@link isRevolveTree}), replacing every
 *  revolve/profile `profile` with its axially-densified version (densifyProfileAxial
 *  along `path`) so each leaf lathes into a clean ring×segment grid dense enough to
 *  bend as a smooth arc. Interior transforms/booleans/unions pass through
 *  structurally — the booleans then run on the DENSE cylinders, and their lateral
 *  walls (which don't self-intersect on coaxial tubes) keep those rings, so the warp
 *  is smooth with NO plane-split spanning triangles. Pure data transform. */
export function densifyRevolveTree(instr: any, path: any): any {
  switch (instr.op) {
    case 'revolve':
    case 'profile':
      return { ...instr, profile: densifyProfileAxial(instr.profile, path, {}) };
    case 'translate':
    case 'rotate':
    case 'cutaway':
      return { ...instr, child: densifyRevolveTree(instr.child, path) };
    case 'booleanDifference':
    case 'booleanUnion':
    case 'booleanIntersection':
      return { ...instr, obj: densifyRevolveTree(instr.obj, path), arg: densifyRevolveTree(instr.arg, path) };
    case 'union':
      return { ...instr, children: instr.children.map((c: any) => densifyRevolveTree(c, path)) };
    default:
      return instr;
  }
}

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
 * Bake a TF mesh's LAZY `transformation` (a row-major 4×4 NDArray — translation in
 * m[3],m[7],m[11]) into a flat world-space point buffer.
 *
 * TF stores transforms lazily on the mesh HANDLE, not baked into the vertex buffer;
 * a boolean op bakes them as a side effect, but `tfMeshData` reads the RAW LOCAL
 * buffer. The warp path extracts points to bend them, so any transform NOT followed
 * by a boolean is silently lost — specifically an OUTER `mv`/`rot`/`txfmn` on a warp
 * child (e.g. `w1_oh_warp`: `mv([0,10,20], casing)` → warp): the mv is the outermost
 * transform, no boolean bakes it, so the casing warped at arc-length 0 (the spline
 * top) instead of advancing to its mv-z station — the "z-offset no-ops on TF warp,
 * works in 3D bake" bug. Baking it here makes the TF warp match the Manifold path,
 * where transforms bake into vertices immediately. Absent/identity transform → the
 * buffer is returned unchanged (golden: an un-moved warp child is byte-identical).
 */
function bakeTransformIntoPoints(mesh: any, pts: Float32Array): Float32Array {
  const has = typeof mesh?.has_transformation === 'function' ? mesh.has_transformation() : !!mesh?.transformation;
  if (!has) return pts;
  const m = mesh.transformation?.data as ArrayLike<number> | undefined;
  if (!m || m.length < 16) return pts;
  const out = new Float32Array(pts.length);
  for (let i = 0; i < pts.length; i += 3) {
    const x = pts[i], y = pts[i + 1], z = pts[i + 2];
    out[i]     = m[0] * x + m[1] * y + m[2] * z + m[3];
    out[i + 1] = m[4] * x + m[5] * y + m[6] * z + m[7];
    out[i + 2] = m[8] * x + m[9] * y + m[10] * z + m[11];
  }
  return out;
}

/**
 * Rebuild a mesh with its LAZY `transformation` baked into the vertex buffer, when
 * that transform would otherwise be dropped. TF keeps an outer mv/rot/txfmn lazy on
 * the handle; a following boolean bakes it as a side effect, but a transform that
 * WRAPS a whole ROOT output has no such boolean — `mv(sectionCut(solid), …)` /
 * `mv(revolve(solid), …)` — so `tfMeshData` (which reads the RAW LOCAL buffer)
 * silently loses the move ("mv-after-cutaway no-ops on TF, honoured on Manifold";
 * Manifold bakes transforms into vertices eagerly). Baking here at the root makes
 * TF match Manifold. Identity / absent / no real 4×4 (the mock kernel) → the handle
 * is returned unchanged, so an already-baked mesh is untouched (idempotent).
 */
function bakeMeshTransform(t: any, mesh: any): any {
  const has = typeof mesh?.has_transformation === 'function' ? mesh.has_transformation() : !!mesh?.transformation;
  if (!has) return mesh;
  const m = mesh.transformation?.data as ArrayLike<number> | undefined;
  if (!m || m.length < 16) return mesh;
  const md = tfMeshData(mesh);
  return t.mesh(md.faces, bakeTransformIntoPoints(mesh, md.points));
}

/**
 * Local Z-extent (min/max of a built mesh's own vertex buffer) — the axial size
 * used to stack a MATED container end-to-end. Reads `mesh.points.data` directly
 * (the LOCAL point buffer, before any `.transformation` the mesh carries), so it
 * is the child's intrinsic length regardless of where it will be placed. Returns
 * `{min:0,max:0}` for an empty/degenerate buffer (a zero-length child just doesn't
 * advance the cursor). */
/** Axis-aligned bbox of a built mesh's LOCAL point buffer (ignores `.transformation`). */
function meshBbox(mesh: any): {
  minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number;
} {
  const d = mesh?.points?.data as ArrayLike<number> | undefined;
  if (!d || d.length < 3) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < d.length; i += 3) {
    const x = d[i], y = d[i + 1], z = d[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  if (!Number.isFinite(minX)) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };
  }
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

/**
 * TF mirror of Manifold's `sectionCut` — subtract an authored angular wedge
 * (pie slice of `az` degrees, full Z height + margin) from `solid`. `offset` is
 * a ROTATIONAL bearing about Z: the arc sweeps from `offset`° to `(offset+az)`°
 * (CCW), so the cutaway faces a chosen bearing — NOT an axial Z shift. Matches
 * `manifold-helpers.sectionCut`.
 */
function buildSectionCut(t: any, solid: any, az: number, offset: number): any {
  if (!(az > 0) || az >= 360) return solid;
  const bb = meshBbox(solid);
  const MARGIN = 20;
  const R = Math.max(
    Math.abs(bb.minX), Math.abs(bb.maxX),
    Math.abs(bb.minY), Math.abs(bb.maxY),
  ) + MARGIN;
  const zlen = (bb.maxZ - bb.minZ) + 2 * MARGIN;
  const z0 = bb.minZ - MARGIN;
  const seg = Math.max(2, Math.ceil(az / 5));
  const section: [number, number][] = [[0, 0]];
  for (let i = 0; i <= seg; i++) {
    const a = ((offset + (az * i) / seg) * Math.PI) / 180;
    section.push([R * Math.cos(a), R * Math.sin(a)]);
  }
  const wedge = tfExtrudeProfile(t, section, { length: zlen });
  applyTransform(t, wedge, t.makeTranslation(0, 0, z0));
  return t.booleanDifference(solid, wedge).mesh;
}

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
    case 'loft':
      // A 2D section swept down Z while SCALED by a smooth shape-along-length
      // curve (barrel/waist/flare/ogive/scurve) + twist → the ported welded-grid
      // loft (tf_examples/loft.ts), the native analogue of Manifold's r_loft +
      // BREP's ThruSections loft. Watertight + positively oriented by the builder.
      return tfLoftProfile(t, instr.profile, {
        length: instr.length,
        divs: instr.divs,
        twist: instr.twist,
        bulge: instr.bulge,
        shape: instr.shape,
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
    case 'sweep_section':
      // An ARBITRARY 2D section transported along the path's RMF frames + welded
      // (tf_examples/sweep-section) — the native analogue of Manifold's
      // sweepAlongPath, for a NON-circular r_sweep section. Optional #51 smoothing
      // pass is applied inside tfSweepSection (guarded, default off).
      return tfSweepSection(t, instr.section, instr.path, {
        closedPath: instr.closedPath,
        closedSection: instr.closedSection,
        caps: instr.capped,
        smooth: instr.smooth,
      });
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

      // REVOLVE-TREE fast path (the durable fix — Rule 25). A bare revolve OR any
      // tree of transforms/booleans/unions whose LEAVES are all revolves (e.g. a
      // hollow tube `revolve(outer).subtract(revolve(inner))` = bw_casing) is
      // densified at the PROFILE level and re-built: each leaf lathes into a clean
      // ring×segment grid, the booleans run on those dense cylinders, and the warp
      // bends the result smoothly. This replaces the plane-split subdivideAxialAdaptive
      // path for composites too — that path exploded a 192-tri tube to ~26 k tris of
      // off-ring spanning triangles (TODO #39: faceted sides + ~53 k verts). buildInstr
      // re-runs the booleans on the densified tree; buildRevolveMesh shares verts, so
      // no weld is needed and the adapter's crease-aware normals read round.
      if (isRevolveTree(childInstr)) {
        const built = buildInstr(t, densifyRevolveTree(childInstr, instr.path as any));
        const md = tfMeshData(built);
        const local = md.points instanceof Float32Array ? md.points : new Float32Array(md.points);
        // Bake the child's lazy transform (an outer mv/rot) into world coords BEFORE
        // warping — else warpMeshJS bends the un-moved local points (see bug note above).
        const src = bakeTransformIntoPoints(built, local);
        const { positions } = warpMeshJS(src, null, instr.path as any, { stretch: instr.stretch, originZ: instr.originZ });
        return t.mesh(md.faces, positions);
      }

      // GENERIC path — only a non-revolve child (box / sweep / loft) reaches here,
      // where there is no clean profile to re-lathe. Insert curvature-adaptive
      // z-stations (CAPPED so it can't balloon — see GENERIC_WARP_MAX_STATIONS),
      // then re-weld by position so t.mesh recovers shared-edge connectivity →
      // smooth normals.
      const child = buildInstr(t, instr.child);
      const md = tfMeshData(child); // { points: Float(32|64)Array, faces: Int32Array }
      const local = md.points instanceof Float32Array ? md.points : new Float32Array(md.points);
      const src = bakeTransformIntoPoints(child, local); // honor an outer mv/rot (see bug note above)
      const dense = subdivideAxialAdaptive(src, null, md.faces, instr.path as any, { maxStations: GENERIC_WARP_MAX_STATIONS });
      const welded = weldMeshByPosition(dense.positions, dense.faces);
      const { positions } = warpMeshJS(welded.points, null, instr.path as any, { stretch: instr.stretch, originZ: instr.originZ });
      return t.mesh(welded.faces, positions);
    }
    case 'cutaway':
      return buildSectionCut(t, buildInstr(t, instr.child), instr.az, instr.offset);
    case 'UNSUPPORTED':
      throw new TfUnsupportedError(instr.nodeType);
    default:
      throw new TfUnsupportedError((instr as any).op ?? 'unknown');
  }
}

/**
 * CONCATENATE flat triangle-mesh data (a plain vertex/index APPEND — NO boolean).
 * The separate-parts analogue of Manifold's `mergeBufferGeometries` in
 * `render-helpers.ts:finalizeSeparateParts`: overlapping / coincident bodies
 * survive untouched (a tubing string inside an open hole stays a string; 9
 * concentric coincident-face casings never reach TF's mesh boolean, so they can't
 * trap). Each part's face indices are offset by the running vertex base so the
 * combined buffer indexes the appended vertices correctly. Pure — no WASM.
 */
function concatMeshData(datas: TfMeshData[]): TfMeshData {
  if (datas.length === 1) return datas[0];
  let nPts = 0, nFaces = 0;
  for (const d of datas) { nPts += d.points.length; nFaces += d.faces.length; }
  const points = new Float32Array(nPts);
  const faces = new Int32Array(nFaces);
  let po = 0, fo = 0, vBase = 0;
  for (const d of datas) {
    points.set(d.points, po);
    for (let i = 0; i < d.faces.length; i++) faces[fo + i] = d.faces[i] + vBase;
    po += d.points.length;
    fo += d.faces.length;
    vBase += d.points.length / 3;
  }
  return { points, faces };
}

/**
 * Aggregate the per-PART topology verdicts into one honest whole-assembly stat,
 * WITHOUT ever building (or booleaning) a combined handle. Each part was already
 * built cleanly, so `tfAnalyze(tf, part)` is safe; summing avoids allocating a
 * coincident-face concat handle just to analyse it. closed/manifold = AND across
 * parts; χ / tris / verts / boundary loops / volume = SUM (a disjoint union's χ
 * is the sum of its bodies'). Volume is only meaningful when every part closed.
 */
function aggregateStats(tf: any, meshes: any[]): TfMeshStats {
  let tris = 0, verts = 0, euler = 0, boundaryLoops = 0, signedVolume = 0, volume = 0;
  let closed = true, manifold = true, allClosed = true;
  for (const m of meshes) {
    const s = tfAnalyze(tf, m);
    tris += s.tris; verts += s.verts; euler += s.euler;
    boundaryLoops += Math.max(0, s.boundaryLoops);
    closed = closed && s.closed;
    manifold = manifold && s.manifold;
    if (s.closed && Number.isFinite(s.volume)) { signedVolume += s.signedVolume; volume += s.volume; }
    else allClosed = false;
  }
  return {
    tris, verts, closed, manifold, euler, boundaryLoops,
    signedVolume: allClosed ? signedVolume : NaN,
    volume: allClosed ? volume : NaN,
  };
}

/**
 * Execute a `TfRecipe` against a live TrueForm kernel → a {@link TfDemoResult}
 * (mesh data + tf's topology verdict, cut when `opts.cutaway`). Builds each
 * unconsumed ROOT output instr as its OWN body and — BY DEFAULT — keeps them
 * SEPARATE: their render meshes are CONCATENATED (a flat vertex/index append, no
 * `booleanUnion`), mirroring the Manifold `finalizeSeparateParts` path. This
 * honours the no-compose rule (no union unless a graph explicitly asks) AND
 * removes the `w_multi_string` trap (concentric coincident-face casings whose
 * union aborts TF's mesh boolean at 192 segs — Manifold + BREP build the same
 * union fine; only TF's boolean aborts). The historical union-fold happens ONLY
 * when a single root output exists (byte-identical to before — and g_dp_joint /
 * g_dp_stand mated stacks are a single `{op:'union',mated}` instr, so their
 * intentional end-to-end WELD still runs inside buildInstr) or when the recipe
 * opts in via `recipe.compose`. Each body is oriented outward
 * (`positivelyOriented`, try/catch like the demos) and finalised via
 * {@link tfResult} (fold path) / {@link applyTfCutaway} (separate path).
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
    // Build each ROOT output (= a PART) as its OWN mesh first. Bake any LAZY
    // transform the output carries (an OUTER mv/rot/txfmn wrapping the whole part,
    // e.g. `mv(sectionCut(solid), …)`) into the vertex buffer — no downstream
    // boolean follows it to bake it, and the render reads the raw local buffer, so
    // it would otherwise be dropped (see bakeMeshTransform).
    const partMeshes = instrs.map((instr) => {
      const m = bakeMeshTransform(t, buildInstr(t, instr));
      try { return t.positivelyOriented(m); } catch { return m; }
    });

    // SEPARATE-by-default: the recipe's unconsumed ROOT outputs are DISTINCT
    // bodies, so we do NOT booleanUnion-fold them (see the doc block above — no
    // compose, and no coincident-face w_multi_string trap). The fold is kept ONLY
    // when there's a single root (byte-identical to the historical path, incl. the
    // g_dp_joint / g_dp_stand mated stack, which is ONE `{op:'union',mated}` instr
    // whose end-to-end weld runs inside buildInstr) or the recipe opts in via
    // `compose`. An explicit `.add()` (→ `{op:'booleanUnion'}`) or a grouping
    // container (→ `{op:'union'}`) still folds INSIDE buildInstr regardless.
    const separate = recipe.compose !== true && partMeshes.length > 1;

    // PER-PART meshes for the per-part-texture display (task #2/#3): extract each
    // part's flat mesh data NOW — BEFORE the fold below may consume the handles.
    // Built REGARDLESS of cutaway (BUG 2 fix): the per-part material (steel/etc.)
    // must show on the FULL view whether or not the cut toggle is on — the scene
    // renders `parts` on the full view and the merged grey/red section on the cut
    // view (per-part material ON the cut section is out of scope, v1). A SINGLE
    // output part with its own appearance (e.g. a `material` preset — bw_open_hole =
    // one steel g_shaft) must still render per-part so its metalness/tint lands.
    // The SEPARATE path ALSO needs the per-part data (to concatenate the full
    // render mesh), so extract it whenever appearance-bearing OR separate.
    const appearance = recipe.partAppearance;
    const wantParts = !!appearance && appearance.some(Boolean) && partMeshes.length >= 1;
    const partData = (wantParts || separate) ? partMeshes.map((m) => tfMeshData(m)) : null;

    // PER-PART CUT meshes — cut EACH part on its OWN +x,+y quadrant box (same
    // world x=0/y=0 planes for every part). Feeds BOTH the per-part-material cut
    // display (`cutParts`, v2) AND — in the separate path — the concatenated cut
    // `data`. We cut a FRESH handle rebuilt from the extracted part data (not the
    // original `partMeshes[i]`), so a per-part boolean never disturbs a handle the
    // fold path still consumes. applyTfCutaway self-guards → uncut + no planes on
    // failure (that part shows with no revealed section); a part that doesn't
    // cross the plane keeps its skin. Computed only when needed (cutaway + we have
    // per-part data + something reads it).
    let perPartCut: { data: TfMeshData; planes?: TfCutPlane[] }[] | null = null;
    if (opts?.cutaway && partData && (wantParts || separate)) {
      perPartCut = partData.map((pd) => {
        const fresh = t.mesh(pd.faces, pd.points);
        const { mesh: cm, planes } = applyTfCutaway(t, fresh);
        return { data: tfMeshData(cm), planes };
      });
    }

    let merged: TfDemoResult;
    if (!separate) {
      // FOLD — single root output (or opt-in `compose`): union the roots into one
      // solid (a no-op copy for a single part) + finalise via tfResult (the same
      // cutaway + analyse back-end every demo uses). Mirrors dp_joint's welded box+
      // tube+pin. Unchanged historical behaviour.
      let solid = partMeshes[0];
      for (let i = 1; i < partMeshes.length; i++) {
        solid = t.booleanUnion(solid, partMeshes[i]).mesh;
      }
      // Enforce one consistent outward orientation (harmless if already positive).
      try { solid = t.positivelyOriented(solid); } catch { /* keep the union as-is */ }
      merged = tfResult(tf, t, solid, { cutaway: opts?.cutaway, cuttable: true });
    } else {
      // SEPARATE — concatenate the per-part render meshes (flat append, NO boolean).
      // full-view mesh = concat of the uncut parts; cut-view `data` = concat of the
      // per-part cuts. Stats are aggregated from the clean per-part verdicts (no
      // coincident-face combined handle is ever built or booleaned).
      const fullConcat = concatMeshData(partData!);
      const stats = aggregateStats(tf, partMeshes);
      const anyPlanes = opts?.cutaway ? perPartCut?.find((c) => c.planes)?.planes : undefined;
      if (opts?.cutaway && perPartCut && anyPlanes) {
        // A cutaway ran on ≥1 part → `data` is the CUT concat + `cutPlanes`, and
        // `fullData` carries the UNCUT concat so the cross-section toggle is a pure
        // view-switch with no re-bake (mirrors the fold path's tfResult {data,fullData}).
        const cutConcat = concatMeshData(perPartCut.map((c) => c.data));
        merged = { data: cutConcat, stats, cutPlanes: anyPlanes, fullData: fullConcat };
      } else {
        // No cutaway (or nothing crossed the plane) → `data` IS the full mesh.
        merged = { data: fullConcat, stats };
      }
    }

    // Per-part APPEARANCE display, both paths: `parts` (full-view material) rides
    // on the result so the full view always shows each part's material; `cutParts`
    // (per-part cut material) is attached ONLY when the cutaway actually produced
    // the exposed planes — the render path gates its per-part-cut arm on the same
    // `cutPlanes`, so the two stay consistent (no cutParts without planes to shade).
    if (wantParts && partData) merged.parts = partData.map((data, i) => ({ data, appearance: appearance![i] }));
    if (wantParts && perPartCut && merged.cutPlanes) {
      merged.cutParts = perPartCut.map((c, i) => ({ data: c.data, appearance: appearance![i] }));
    }
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
    case 'loft':
      // A section needs at least a triangle's worth of points to enclose area.
      return (instr.profile?.length ?? 0) < MIN_PROFILE_PTS;
    case 'sweep':
      // A sweep needs at least a start + end point to define a curve.
      return (instr.path?.length ?? 0) < 2;
    case 'sweep_section':
      // An arbitrary-section sweep needs a ≥2-pt path AND a ≥3-pt closed section.
      return (instr.path?.length ?? 0) < 2 || (instr.section?.length ?? 0) < 3;
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
    case 'cutaway':
      return instrHasUnsupported(instr.child);
    default:
      return false;
  }
}
