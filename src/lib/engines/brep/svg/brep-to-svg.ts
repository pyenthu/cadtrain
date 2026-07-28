/**
 * brep-to-svg — project a BREP solid's TRUE BOUNDARY (exact analytic faces +
 * edges) to 2D SVG paths, NOT a projected triangle soup.
 *
 * A revolved cylinder must come out as a handful of outline segments (two
 * silhouette lines + the two cap edges), never the hundreds of triangles its
 * tessellation carries. Two projection paths (see docs/research/
 * brep-svg-boundary-projection.md):
 *
 *   PRIMARY  `mode:'hlr'`  — OCCT hidden-line removal via replicad's MANAGED
 *     wrapper `drawProjection(shape, camera)` → { visible, hidden } `Drawing`s,
 *     each with `.toSVGPaths()` / `.toSVGViewBox()`. HLR removes occluded edges
 *     and yields silhouette + sharp + smooth-crease lines as real 2D curves.
 *     Managed = self-cleaning `Drawing`s, so NO raw HLRBRep_* lifetime juggling
 *     (the abort/singleton-poison risk — Rule 25).
 *
 *   FALLBACK `mode:'edges'` — direct edge projection: `solid.edges` +
 *     `edge.pointAt(t)` tessellation, projected with an ortho elevation camera
 *     (mirrors src/lib/shared/svg/svg-camera.ts: eye +Y, up = -Z / Z-down). No
 *     hidden-line removal (front + back edges drawn), but never traps. Also the
 *     automatic recovery if `drawProjection` throws.
 *
 * Optional `fill:'lambert'` shades each face by its analytic normal
 * (`face.normalAt()` · light) — regions bounded by the REAL projected wires,
 * the boundary-surface complement to the mesh-Lambert task (/plan #985).
 *
 * SERVER-ONLY (OCCT runs in Node). The BREP_SVG right-pane tab is NOT wired
 * here — that is graph-editor UI, left to the caller.
 */
import { ensureOC } from '../brep-occt';
import { creaseAwareCornerNormals, DEFAULT_CREASE_ANGLE } from '$lib/engines/trueform/crease-normals';

export type BrepSvgMode = 'hlr' | 'edges';
export type BrepSvgFill = 'none' | 'silhouette' | 'lambert';

export interface BrepSvgOpts {
  /** 'hlr' (default) = managed hidden-line removal; 'edges' = direct edge projection. */
  mode?: BrepSvgMode;
  /** 'none' (default) outline only · 'silhouette' fills the visible outline flat ·
   *  'lambert' TESSELLATED per-triangle shading with CREASE-AWARE SMOOTHED normals
   *  (the same normalizer the 3D BREP view uses) — a curved face reads as a smooth
   *  gradient, not one flat tone. Forces the ortho projector. */
  fill?: BrepSvgFill;
  /** replicad ProjectionPlane string ('front'|'top'|'XZ'|…) or a ProjectionCamera.
   *  Default: front elevation — eye on +Y looking at origin, X horizontal, Z-down. */
  camera?: unknown;
  /** Draw HLR hidden edges dashed (hlr mode only). */
  hiddenLines?: boolean;
  /** SVG viewBox margin in world units (default 2). */
  margin?: number;
  strokeVisible?: string;   // default '#111'
  strokeHidden?: string;    // default '#9aa0a6'
  strokeWidth?: number;     // world units; default ≈ 0.5% of the viewBox
  fillColor?: string;       // base body fill for silhouette/lambert (default '#c8ccd2')
  light?: [number, number, number];  // lambert light direction (default over-shoulder)
  ambient?: number;         // lambert ambient floor 0..1 (default 0.35)
  background?: string;      // svg background rect colour (default none = transparent)
}

type Vec3 = [number, number, number];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec3): Vec3 => { const L = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / L, a[1] / L, a[2] / L]; };
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const fmt = (n: number) => (Number.isFinite(n) ? +n.toFixed(4) : 0);

/** Flatten replicad's `toSVGPaths()` (string[] | string[][]) to a flat string[]. */
function flattenPaths(p: string[] | string[][] | undefined): string[] {
  if (!p) return [];
  return (p as unknown[]).flat(Infinity).filter((s): s is string => typeof s === 'string' && s.length > 0);
}

/** "minX minY W H" → [minX, minY, W, H] (0s on a malformed box). */
function parseViewBox(vb: string): [number, number, number, number] {
  const n = vb.trim().split(/\s+/).map(Number);
  return (n.length === 4 && n.every(Number.isFinite)) ? (n as [number, number, number, number]) : [0, 0, 1, 1];
}

const rgb = (hex: string): Vec3 => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0.78, 0.8, 0.82];
  return [parseInt(m[1].slice(0, 2), 16) / 255, parseInt(m[1].slice(2, 4), 16) / 255, parseInt(m[1].slice(4, 6), 16) / 255];
};
const toHex = (c: Vec3): string =>
  '#' + c.map((v) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0')).join('');

/**
 * Ortho projector for the fallback + Lambert paths. Uses a fixed Z-DOWN front
 * elevation (X horizontal, +Z pointing DOWN on screen, eye +Y) by default so
 * fills + edges share ONE consistent 2D frame that matches the 3D views'
 * up = [0,0,-1]. A REAL supplied ProjectionCamera object overrides that with its
 * own basis (xAxis/yAxis/direction); a camera STRING is ignored (default frame).
 */
function orthoProjector(replicad: any, cameraOpt: unknown) {
  // DEFAULT front-elevation frame for the Z-DOWN world: X horizontal (screen-right
  // = +X, never mirrored), eye on +Y looking at the origin, and the SCREEN vertical
  // = +Z pointing DOWN. Paired with project()'s `-dot(v, yAxis)`, yAxis = [0,0,-1]
  // maps larger z (deeper) to larger SVG-y (LOWER on screen) — matching the 3D
  // views' camera up = [0,0,-1]. NOTE: a freshly-built default ProjectionCamera's
  // YDirection is +Z (which rendered large-z at the TOP — the upside-down bug), so
  // for the default frame we must NOT read a camera basis; we hard-set the Z-down one.
  let xAxis: Vec3 = [1, 0, 0], yAxis: Vec3 = [0, 0, -1], viewDir: Vec3 = [0, -1, 0];
  // Only a REAL supplied ProjectionCamera object overrides the default frame (its
  // own basis is honoured verbatim). A camera STRING — or nothing — keeps the
  // Z-down front elevation above.
  if (cameraOpt && typeof cameraOpt === 'object') {
    try {
      const cam = cameraOpt as any;
      const rd = (v: any): Vec3 => [v.x, v.y, v.z];
      xAxis = rd(cam.xAxis); yAxis = rd(cam.yAxis); viewDir = rd(cam.direction);
    } catch { /* keep front-elevation defaults */ }
  }
  const project = (p: { x: number; y: number; z: number }): [number, number] => {
    const v: Vec3 = [p.x, p.y, p.z];
    // SVG y grows DOWN — negate the frame's vertical. For the default Z-down frame
    // (yAxis = [0,0,-1]) this sends larger z to larger SVG-y (bottom); x untouched.
    return [dot(v, xAxis), -dot(v, yAxis)];
  };
  return { project, xAxis, yAxis, viewDir };
}

/** Adaptive sample count for an edge: a straight LINE needs 1 span, a curve many. */
function edgeSampleCount(edge: any): number {
  try {
    const gt = String(edge.geomType ?? '').toUpperCase();
    if (gt.includes('LINE')) return 1;
    const len = Number(edge.length) || 1;
    return clamp(Math.ceil(len * 3) + 12, 12, 160);
  } catch { return 24; }
}

/** Tessellate one replicad Edge to a 3D polyline via pointAt(t), t∈[0,1]. */
function sampleEdge(edge: any): { x: number; y: number; z: number }[] {
  const n = edgeSampleCount(edge);
  const pts: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i <= n; i++) {
    try { const v = edge.pointAt(i / n); pts.push({ x: v.x, y: v.y, z: v.z }); }
    catch { /* skip a bad sample */ }
  }
  return pts;
}

/** points → an SVG path `d` ("M x y L x y … [Z]"). */
function polyD(pts2: [number, number][], close = false): string {
  if (pts2.length === 0) return '';
  let d = `M ${fmt(pts2[0][0])} ${fmt(pts2[0][1])}`;
  for (let i = 1; i < pts2.length; i++) d += ` L ${fmt(pts2[i][0])} ${fmt(pts2[i][1])}`;
  return close ? d + ' Z' : d;
}

interface SvgAssembly { viewBox: [number, number, number, number]; body: string; mode: BrepSvgMode; }

/** PRIMARY — managed HLR (drawProjection) → visible/hidden Drawings → SVG paths. */
function hlrAssembly(replicad: any, solid: any, opts: BrepSvgOpts): SvgAssembly {
  // Z-DOWN front elevation. replicad's Drawing→SVG emits screen-y = -(dot(v,
  // camYDir)) (it mirrors the blueprint across the x-axis, and the viewBox negates
  // the max-y). With the old camera (eye +Y, dir -Y, xAxis +X) OCCT derives
  // camYDir = dir × xAxis = +Z, so screen-y = -z → large z at the TOP (upside
  // down for our Z-down world). Putting the eye on -Y (dir +Y) with the SAME
  // xAxis = +X flips camYDir to dir × xAxis = [0,0,-1], so screen-y = +z → large z
  // at the BOTTOM, consistent with the ortho (shaded/edges) projector above and
  // the 3D views. xAxis stays [1,0,0] so screen-x = world-x (never mirrored); the
  // outer silhouette is view-side-independent (identical for revolves).
  const camera = (opts.camera ?? new replicad.ProjectionCamera([0, -100, 0], [0, 1, 0], [1, 0, 0])) as any;
  const { visible, hidden } = replicad.drawProjection(solid, camera);
  const margin = opts.margin ?? 2;
  const viewBox = parseViewBox(visible.toSVGViewBox(margin));
  const visPaths = flattenPaths(visible.toSVGPaths());
  if (visPaths.length === 0) throw new Error('HLR produced no visible edges');

  const strokeVisible = opts.strokeVisible ?? '#111';
  const strokeHidden = opts.strokeHidden ?? '#9aa0a6';
  const sw = opts.strokeWidth ?? Math.max(Math.max(viewBox[2], viewBox[3]) * 0.005, 1e-3);

  let body = '';
  // Flat silhouette fill = the SAME visible paths filled (perfectly aligned, cheap).
  if (opts.fill === 'silhouette') {
    const fillC = opts.fillColor ?? '#c8ccd2';
    for (const d of visPaths) body += `<path d="${d}" fill="${fillC}" fill-rule="evenodd" stroke="none"/>`;
  }
  // Hidden edges (occluded) as dashed grey.
  if (opts.hiddenLines) {
    for (const d of flattenPaths(hidden.toSVGPaths())) {
      body += `<path d="${d}" fill="none" stroke="${strokeHidden}" stroke-width="${fmt(sw)}" stroke-dasharray="${fmt(sw * 4)} ${fmt(sw * 3)}"/>`;
    }
  }
  // Visible boundary edges on top.
  for (const d of visPaths) {
    body += `<path d="${d}" fill="none" stroke="${strokeVisible}" stroke-width="${fmt(sw)}" stroke-linejoin="round" stroke-linecap="round"/>`;
  }
  return { viewBox, body, mode: 'hlr' };
}

/** Bounding box of the projected 2D boundary polylines (tight — NO viewBox margin). */
export interface BrepBBox { minX: number; minY: number; maxX: number; maxY: number; }

/**
 * Project every boundary edge of the solid to a 2D polyline via the SAME ortho
 * projector the `mode:'edges'` SVG path uses — the raw `[x,y]` point arrays the
 * edge SVG `<path d>`s are built from (see `edgeAssembly`), plus the tight 2D
 * bounds. This is the single source of both the SVG edge paths (`edgeAssembly`)
 * and the raw-JSON polylines accessor (`brepSolidToPolylines`), so the two share
 * one 2D frame verbatim — no re-projection, no drift.
 */
function projectEdgePolylines(
  replicad: any,
  solid: any,
  cameraOpt: unknown,
): { polylines: [number, number][][]; bbox: BrepBBox } {
  const proj = orthoProjector(replicad, cameraOpt);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const bump = (p: [number, number]) => { if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0]; if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; };
  let edges: any[] = [];
  try { edges = solid.edges; } catch { edges = []; }
  const polylines: [number, number][][] = [];
  for (const edge of edges) {
    const pts3 = sampleEdge(edge);
    if (pts3.length < 2) continue;
    const pts2 = pts3.map((p) => { const q = proj.project(p); bump(q); return q; });
    polylines.push(pts2);
  }
  if (!Number.isFinite(minX)) { minX = 0; minY = 0; maxX = 1; maxY = 1; }
  return { polylines, bbox: { minX, minY, maxX, maxY } };
}

/**
 * Project the solid's FRONT-FACING surface triangles to 2D fill rings via the
 * SAME ortho projector `projectEdgePolylines` uses — so the filled regions land
 * in the IDENTICAL 2D frame as the edge polylines (no re-projection, no drift).
 * Each ring is a triangle `[[x,y],[x,y],[x,y]]`; drawn together their UNION reads
 * as the filled silhouette the `fill:'silhouette'` SVG mode paints. A per-ring
 * Lambert shade (0..1, the same crease-aware normalizer `meshLambertAssembly`
 * uses) rides along for optional per-region shading. Back-facing triangles are
 * culled. This is the fill sibling of the raw-polyline accessor (#999 — the WGPU
 * shading pass). Meshing/degenerate failure degrades to an EMPTY fill set so the
 * outline still renders (never throws).
 */
function projectFillPolygons(
  replicad: any,
  solid: any,
  opts: BrepSvgOpts,
): { fills: [number, number][][]; shades: number[] } {
  try {
    const proj = orthoProjector(replicad, opts.camera);
    const mesh = solid.mesh({ tolerance: 0.01, angularTolerance: 0.12 });
    const V: number[] = mesh?.vertices ?? [];
    const Tr: number[] = mesh?.triangles ?? [];
    if (Tr.length < 3 || V.length < 9) return { fills: [], shades: [] };
    // Crease-aware smoothed per-corner normals — smooth curves, hard creases (the
    // exact-kernel shading pass the 3D BREP view + meshLambertAssembly share).
    const cn = creaseAwareCornerNormals(V, Tr, DEFAULT_CREASE_ANGLE);
    const light = norm(opts.light ?? [0.35, 1, -0.55]);
    const ambient = opts.ambient ?? 0.35;
    const fills: [number, number][][] = [];
    const shades: number[] = [];
    const nt = (Tr.length / 3) | 0;
    for (let t = 0; t < nt; t++) {
      const ia = Tr[t * 3], ib = Tr[t * 3 + 1], ic = Tr[t * 3 + 2];
      const pa: Vec3 = [V[ia * 3], V[ia * 3 + 1], V[ia * 3 + 2]];
      const pb: Vec3 = [V[ib * 3], V[ib * 3 + 1], V[ib * 3 + 2]];
      const pc: Vec3 = [V[ic * 3], V[ic * 3 + 1], V[ic * 3 + 2]];
      const o = t * 9;
      const N = norm([
        cn[o] + cn[o + 3] + cn[o + 6],
        cn[o + 1] + cn[o + 4] + cn[o + 7],
        cn[o + 2] + cn[o + 5] + cn[o + 8],
      ]);
      if (dot(N, proj.viewDir) >= 0) continue; // back-facing → cull
      const shade = clamp(Math.abs(dot(N, light)), ambient, 1);
      const qa = proj.project({ x: pa[0], y: pa[1], z: pa[2] });
      const qb = proj.project({ x: pb[0], y: pb[1], z: pb[2] });
      const qc = proj.project({ x: pc[0], y: pc[1], z: pc[2] });
      if (![qa[0], qa[1], qb[0], qb[1], qc[0], qc[1]].every(Number.isFinite)) continue;
      fills.push([qa, qb, qc]);
      shades.push(shade);
    }
    return { fills, shades };
  } catch { return { fills: [], shades: [] }; }
}

/** FALLBACK — direct edge projection (line-art, no fill). The `fill:'lambert'`
 *  path is handled by meshLambertAssembly; this is `mode:'edges'` + HLR recovery. */
function edgeAssembly(replicad: any, solid: any, opts: BrepSvgOpts): SvgAssembly {
  const margin = opts.margin ?? 2;
  const { polylines, bbox } = projectEdgePolylines(replicad, solid, opts.camera);
  if (polylines.length === 0) throw new Error('edge projection produced no edges');
  const { minX, minY, maxX, maxY } = bbox;

  const strokeVisible = opts.strokeVisible ?? '#111';
  const viewBox: [number, number, number, number] = [minX - margin, minY - margin, (maxX - minX) + 2 * margin, (maxY - minY) + 2 * margin];
  const sw = opts.strokeWidth ?? Math.max(Math.max(viewBox[2], viewBox[3]) * 0.005, 1e-3);
  let body = '';
  if (strokeVisible !== 'none') {
    for (const pts2 of polylines) body += `<path d="${polyD(pts2, false)}" fill="none" stroke="${strokeVisible}" stroke-width="${fmt(sw)}" stroke-linejoin="round" stroke-linecap="round"/>`;
  }
  return { viewBox, body, mode: 'edges' };
}

/**
 * SHADED — tessellate the solid and Lambert-shade each triangle by a CREASE-AWARE
 * SMOOTHED normal (`creaseAwareCornerNormals`, the exact-kernel shading pass the
 * 3D BREP view uses). Smoothing across shallow dihedrals turns a curved face's
 * facets into a smooth gradient (a plain cylinder shades, not one flat tone),
 * while real creases (rims, box corners) stay hard. Back-face culled + painter-
 * sorted (farthest first), no interior edge grid. This is the "shaded" fill.
 */
function meshLambertAssembly(replicad: any, solid: any, opts: BrepSvgOpts): SvgAssembly {
  const proj = orthoProjector(replicad, opts.camera);
  const margin = opts.margin ?? 2;
  const mesh = solid.mesh({ tolerance: 0.01, angularTolerance: 0.12 });
  const V: number[] = mesh?.vertices ?? [];
  const Tr: number[] = mesh?.triangles ?? [];
  if (Tr.length < 3 || V.length < 9) throw new Error('mesh produced no triangles');
  // Crease-aware smoothed per-CORNER normals ([nt*9]) — smooth curves, hard creases.
  const cn = creaseAwareCornerNormals(V, Tr, DEFAULT_CREASE_ANGLE);

  const light = norm(opts.light ?? [0.35, 1, -0.55]);
  const ambient = opts.ambient ?? 0.35;
  const base = rgb(opts.fillColor ?? '#c8ccd2');

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const bump = (p: [number, number]) => { if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0]; if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; };

  const tris: { d: number; poly: [number, number][]; col: string }[] = [];
  const nt = (Tr.length / 3) | 0;
  for (let t = 0; t < nt; t++) {
    const ia = Tr[t * 3], ib = Tr[t * 3 + 1], ic = Tr[t * 3 + 2];
    const pa: Vec3 = [V[ia * 3], V[ia * 3 + 1], V[ia * 3 + 2]];
    const pb: Vec3 = [V[ib * 3], V[ib * 3 + 1], V[ib * 3 + 2]];
    const pc: Vec3 = [V[ic * 3], V[ic * 3 + 1], V[ic * 3 + 2]];
    // Triangle normal = mean of its 3 crease-aware corner normals (smooth).
    const o = t * 9;
    const N = norm([
      cn[o] + cn[o + 3] + cn[o + 6],
      cn[o + 1] + cn[o + 4] + cn[o + 7],
      cn[o + 2] + cn[o + 5] + cn[o + 8],
    ]);
    if (dot(N, proj.viewDir) >= 0) continue; // back-facing → cull
    const shade = clamp(Math.abs(dot(N, light)), ambient, 1);
    const col = toHex([base[0] * shade, base[1] * shade, base[2] * shade]);
    const qa = proj.project({ x: pa[0], y: pa[1], z: pa[2] }); bump(qa);
    const qb = proj.project({ x: pb[0], y: pb[1], z: pb[2] }); bump(qb);
    const qc = proj.project({ x: pc[0], y: pc[1], z: pc[2] }); bump(qc);
    // Depth key: projection onto the view dir (which points away from the eye) →
    // farthest triangles have the LARGEST value, drawn first (painter's algorithm).
    const d = (dot(pa, proj.viewDir) + dot(pb, proj.viewDir) + dot(pc, proj.viewDir)) / 3;
    tris.push({ d, poly: [qa, qb, qc], col });
  }
  if (tris.length === 0) throw new Error('no front-facing triangles');
  tris.sort((a, b) => b.d - a.d);

  if (!Number.isFinite(minX)) { minX = 0; minY = 0; maxX = 1; maxY = 1; }
  const viewBox: [number, number, number, number] = [minX - margin, minY - margin, (maxX - minX) + 2 * margin, (maxY - minY) + 2 * margin];
  // Hairline stroke in the SAME colour closes the anti-alias seams between fills.
  const sw = Math.max(Math.max(viewBox[2], viewBox[3]) * 0.0015, 1e-4);
  let body = '';
  for (const tr of tris) body += `<path d="${polyD(tr.poly, true)}" fill="${tr.col}" stroke="${tr.col}" stroke-width="${fmt(sw)}" stroke-linejoin="round"/>`;
  return { viewBox, body, mode: 'edges' };
}

function wrapSvg(a: SvgAssembly, opts: BrepSvgOpts): string {
  const [x, y, w, h] = a.viewBox.map(fmt);
  const bg = opts.background ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${opts.background}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" data-brep-svg-mode="${a.mode}">${bg}${a.body}</svg>`;
}

/**
 * Project a replicad BREP solid (a `Shape` with `.faces`/`.edges`/`.boundingBox`)
 * to an SVG string of its true boundary. Pure-ish: no volume/network — only the
 * already-initialised OCCT singleton (via replicad). `mode:'hlr'` (default) uses
 * managed hidden-line removal; on any throw it self-recovers to `mode:'edges'`.
 * `fill:'lambert'` always renders via the edge/ortho path (aligned face fills).
 */
export async function brepSolidToSvg(solid: any, opts: BrepSvgOpts = {}): Promise<string> {
  const replicad: any = await import('replicad');
  const mode: BrepSvgMode = opts.mode ?? 'hlr';
  // Lambert = tessellated smooth-normal shading (its own projector + painter sort).
  if (opts.fill === 'lambert') {
    try {
      return wrapSvg(meshLambertAssembly(replicad, solid, opts), opts);
    } catch {
      // Mesh/shade failed (degenerate solid) — degrade to a visible edge outline,
      // never the empty body a 'none' stroke would leave.
      const edgeOpts = { ...opts, fill: 'none' as const, strokeVisible: opts.strokeVisible === 'none' ? undefined : opts.strokeVisible };
      return wrapSvg(edgeAssembly(replicad, solid, edgeOpts), opts);
    }
  }
  if (mode === 'edges') {
    return wrapSvg(edgeAssembly(replicad, solid, opts), opts);
  }
  try {
    return wrapSvg(hlrAssembly(replicad, solid, opts), opts);
  } catch {
    // HLR threw (a Standard_Failure on some shapes) — recover with edge projection.
    return wrapSvg(edgeAssembly(replicad, solid, opts), opts);
  }
}

/**
 * Convenience: revolve a closed `(r,z)` half-section (same shape `revolveBrep`
 * consumes) to an SVG of its projected boundary. Ensures OCCT, builds the exact
 * surface of revolution (XZ sketch → `.revolve()`), then projects it.
 */
export async function brepRevolveToSvg(
  profile: [number, number][],
  opts: BrepSvgOpts = {},
): Promise<string> {
  await ensureOC();
  const replicad: any = await import('replicad');
  const { draw } = replicad;
  let d = draw([profile[0][0], profile[0][1]]);
  for (let i = 1; i < profile.length; i++) d = d.lineTo([profile[i][0], profile[i][1]]);
  const solid = d.close().sketchOnPlane('XZ').revolve();
  return brepSolidToSvg(solid, opts);
}

// ─── RAW POLYLINE ACCESSOR (#998 — WGPU tab) ────────────────────────────────
// The GPU line-render sibling of the SVG path: instead of emitting `<path d>`
// strings, hand back the RAW projected 2D boundary polylines the edge-mode SVG
// is built from, so a WebGPU pipeline can upload them straight to a vertex
// buffer. Same ortho projector, same 2D frame (Z-down front elevation) as the
// `mode:'edges'` SVG — NO re-projection. `mode`/`fill` are irrelevant here: the
// boundary polylines are the edge projection regardless.

export interface BrepPolylinesResult {
  /** Projected boundary as an array of polylines; each polyline an array of `[x,y]`
   *  points in the SAME 2D space the `mode:'edges'` SVG paths use. */
  polylines: number[][][];
  /** #999 — filled SILHOUETTE regions: front-facing surface triangles projected
   *  through the SAME ortho frame as `polylines` (each ring `[[x,y],[x,y],[x,y]]`).
   *  Drawn UNDER the outline they read as a filled silhouette. Empty when the solid
   *  won't mesh (outline-only, as before). */
  fills: number[][][];
  /** Optional per-fill Lambert shade (0..1), parallel to `fills` — a soft steel
   *  shading value the GPU fill can modulate by. Empty iff `fills` is empty. */
  fillShades: number[];
  /** Tight 2D bounds over BOTH polylines AND fills (NO viewBox margin) — the fit
   *  source. Union so every drawn vertex (outline + fill) lies inside. */
  bbox: BrepBBox;
  meta: { mode: 'edges'; edges: number; points: number; fills: number };
}

/**
 * Project a prebuilt OCCT solid's TRUE boundary to raw 2D polylines (the edge
 * projection the SVG path emits, exposed as points) PLUS the filled silhouette
 * triangles (#999). Both share the ortho frame; `bbox` is unioned over the two so
 * fills never fall outside it. Pure-ish: only the already-initialised replicad/OCCT
 * singleton. The caller owns the solid's lifetime.
 */
export async function brepSolidToPolylines(
  solid: any,
  opts: BrepSvgOpts = {},
): Promise<BrepPolylinesResult> {
  const replicad: any = await import('replicad');
  const { polylines, bbox } = projectEdgePolylines(replicad, solid, opts.camera);
  const { fills, shades } = projectFillPolygons(replicad, solid, opts);
  // Union the fill vertices into the bbox so the fit covers every drawn vertex.
  let { minX, minY, maxX, maxY } = bbox;
  for (const ring of fills) for (const [x, y] of ring) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  let points = 0;
  for (const pl of polylines) points += pl.length;
  return {
    polylines, fills, fillShades: shades,
    bbox: { minX, minY, maxX, maxY },
    meta: { mode: 'edges', edges: polylines.length, points, fills: fills.length },
  };
}

/**
 * Convenience: revolve a closed `(r,z)` half-section to its projected boundary
 * polylines (the `brepRevolveToSvg` sibling for the `format:'polylines'` path).
 */
export async function brepRevolveToPolylines(
  profile: [number, number][],
  opts: BrepSvgOpts = {},
): Promise<BrepPolylinesResult> {
  await ensureOC();
  const replicad: any = await import('replicad');
  const { draw } = replicad;
  let d = draw([profile[0][0], profile[0][1]]);
  for (let i = 1; i < profile.length; i++) d = d.lineTo([profile[i][0], profile[i][1]]);
  const solid = d.close().sketchOnPlane('XZ').revolve();
  return brepSolidToPolylines(solid, opts);
}

/** Alias matching the task's `brepToSvg(solid, opts)` name. */
export const brepToSvg = brepSolidToSvg;
