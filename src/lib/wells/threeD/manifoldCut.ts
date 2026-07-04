/**
 * manifoldCut — CSG cutaway via manifold-3d, cadtrain-style.
 *
 * PORTED from SVTC `src/lib/apps/wson/threeD/manifoldCut.js` (the CROWN JEWEL).
 * Two adaptations for cadtrain:
 *   1. `initManifold()` delegates to cadtrain's SHARED Manifold singleton
 *      (`$lib/cad/manifold-helpers` → `globalThis.__cadtrain_manifold__`) so
 *      every Manifold built here shares one WASM Module + one prototype chain
 *      with the rest of cadtrain's geometry core (Rule 17 / manifold-helpers).
 *      We do NOT spin up a second `manifold-3d` Module.
 *   2. We keep SVTC's explicit per-primitive segment counts (64 / 32) so we
 *      never mutate cadtrain's global `setCircularSegments` (default 256).
 *
 * Key principle (why we never convert THREE → manifold): ExtrudeGeometry /
 * TubeGeometry produce non-manifold meshes that manifold-3d rejects. Instead
 * we BUILD every primitive in manifold-3d directly (`Manifold.cylinder`,
 * `Manifold.sphere`, `Manifold.cube`, `CrossSection` extrudes) — watertight by
 * construction — then cut with a half-space box (or build the half cross-
 * section for deviated wells) and convert to a THREE.BufferGeometry with
 * per-triangle vertex colors (grey cut face, mainColor elsewhere).
 *
 * The parallel-transport `warpGeometry` is the "wrap-to-spline equivalent":
 * it bends a straight Z-axis BufferGeometry along the wellbore using a
 * rotation-minimizing frame sampled from the centerline — the smooth,
 * non-twisting warp SVTC settled on after abandoning dirWarp3D for planar wells.
 */

import * as THREE from 'three';
import { initManifold as cadInitManifold } from '$lib/cad/manifold-helpers';
// Vite emits manifold.wasm as a build asset + rewrites this to its served (same-
// origin) URL — the CORP-clean URL Emscripten's locateFile needs under COEP.
import manifoldWasmUrl from 'manifold-3d/manifold.wasm?url';
import type { WellDirection } from './direction';

let _wasm: any = null;

// ── Diagnostic phase timing ─────────────────────────────────────────────────
// PURE INSTRUMENTATION (no behaviour change). The 3D build is the /wells perf
// hot path (docs/research/wells-perf-ewells-vs-cadtrain.md): per-string Manifold
// solids + a boolean cutaway + per-vertex warp + mesh extraction, all synchronous
// on the main thread. We accumulate wall-clock per phase into a module singleton
// so WellSchematic3D can snapshot a whole build pass and surface a flash badge.
export interface WellPhaseTiming {
  /** Manifold primitive construction (cylinder / extrude / sphere). */
  solid: number;
  /** Boolean CSG — the half-space cutaway subtract (+ annulus inner subtract). */
  cutaway: number;
  /** manifold → THREE.BufferGeometry mesh extraction (+ per-vertex colours). */
  extract: number;
  /** Parallel-transport per-vertex warp along the survey. */
  warp: number;
  /** # boolean/CSG ops performed. */
  csgOps: number;
  /** # Manifold primitives built. */
  builds: number;
}

/** A whole build-pass summary (phase timing + tallies) for the flash badge. */
export interface WellBuildTiming extends WellPhaseTiming {
  /** Total wall-clock of the build pass (ms) — includes untimed JS overhead. */
  total: number;
  /** # strings/elements rendered (oh + casing + cement + tubing + perfs + comps). */
  strings: number;
  /** Total triangles across all built display geometries. */
  tris: number;
  /** true when the half-section cutaway (CSG) was active for this pass. */
  cutActive: boolean;
}

function zeroTiming(): WellPhaseTiming {
  return { solid: 0, cutaway: 0, extract: 0, warp: 0, csgOps: 0, builds: 0 };
}

let _timing: WellPhaseTiming = zeroTiming();

/** SSR-safe monotonic clock (0 when performance is unavailable). */
function _now(): number {
  return typeof performance !== 'undefined' ? performance.now() : 0;
}

/** Reset the phase accumulator — call at the START of a build pass. */
export function beginWellTiming(): void { _timing = zeroTiming(); }

/** Snapshot the accumulated phase timing since the last beginWellTiming(). */
export function readWellTiming(): WellPhaseTiming { return { ..._timing }; }

/** Initialise (or reuse) cadtrain's shared Manifold WASM singleton. Idempotent.
 *  Returns the wasm module exposing `{ Manifold, CrossSection, ... }`. */
export async function initManifold(): Promise<any> {
  if (_wasm) return _wasm;
  // COEP require-corp (set app-wide for TrueForm pthreads) blocks the default
  // main-thread `new URL('manifold.wasm', import.meta.url)` fetch → init throws →
  // the /wells 3D never gets manifoldReady → blank cutaway. Point Emscripten at
  // the Vite-served asset URL (same proven locateFile the client-bake worker uses,
  // bake-worker.ts) so the wasm loads same-origin under COEP.
  await cadInitManifold({ locateFile: (p: string) => (p.endsWith('.wasm') ? manifoldWasmUrl : p) });
  const G = globalThis as any;
  _wasm = G.__cadtrain_manifold__?.wasm ?? null;
  if (!_wasm) throw new Error('[wells/manifoldCut] cadtrain Manifold singleton unavailable after initManifold()');
  return _wasm;
}

export function isManifoldReady(): boolean { return _wasm !== null; }

// ── Internal: build the half-space cutter cube (180° — removes one HALF) ──────
function cutterBox(cutAxis: string) {
  const { Manifold } = _wasm;
  const BIG = 1e5;
  if (cutAxis === 'x') {
    return Manifold.cube([BIG, BIG * 2, BIG * 2]).translate([-BIG, -BIG, -BIG]);
  }
  if (cutAxis === 'y') {
    return Manifold.cube([BIG * 2, BIG, BIG * 2]).translate([-BIG, -BIG, -BIG]);
  }
  return Manifold.cube([BIG * 2, BIG * 2, BIG]).translate([-BIG, -BIG, -BIG]);
}

// The second axis paired with the primary `cutAxis` to carve a 90° WEDGE. The
// removed region is the INTERSECTION of the two half-spaces (one quadrant) so
// subtracting it leaves 270° of the solid — the completion reads whole with a
// notch to the bore. Pairing keeps the notch straddling the same primary plane
// the 180° cut uses (x→[x,y], y→[y,x], z→[z,x]).
function quadrantAxes(cutAxis: string): [string, string] {
  if (cutAxis === 'y') return ['y', 'x'];
  if (cutAxis === 'z') return ['z', 'x'];
  return ['x', 'y'];
}

// ── Internal: build the 90° quadrant cutter (removes ONE quarter — 270° stays)
// = the intersection of two orthogonal half-space boxes. Subtracting it removes
// a 90° wedge, exposing TWO flat cut faces (one on each half-space plane).
function cutterQuadrant(cutAxis: string) {
  const [a, b] = quadrantAxes(cutAxis);
  return cutterBox(a).intersect(cutterBox(b));
}

/** The 3D cutter for a given cut angle (180 = half-space, 90 = quadrant wedge). */
function cutterFor(cutAxis: string, cutDeg: number) {
  return cutDeg === 90 ? cutterQuadrant(cutAxis) : cutterBox(cutAxis);
}

/** The axis (or axes) whose plane(s) carry the grey cut face for a cut angle.
 *  180° exposes one plane (cutAxis); 90° exposes both quadrant planes. */
function cutFaceAxes(cutAxis: string, cutDeg: number): string | string[] {
  return cutDeg === 90 ? quadrantAxes(cutAxis) : cutAxis;
}

// ── Internal: manifold → THREE with vertex colors on the cut face ────────────
// `cutColor` default is a neutral grey; override per-primitive (cement uses a
// beige so the cross-section reads as cement, not steel). `cutVariance` (0..1)
// adds per-triangle hash-based brightness jitter so cement reads as aggregate.
function manifoldToColoredGeo(
  manifold: any, cutAxis: string | string[], mainColor: number[],
  cutColor: number[] = [0.62, 0.62, 0.66], cutVariance = 0,
): THREE.BufferGeometry {
  const mesh = manifold.getMesh();
  const vp = mesh.vertProperties;
  const tri = mesh.triVerts;
  const np = mesh.numProp;
  const nt = tri.length / 3;
  const outPos = new Float32Array(nt * 9);
  const outCol = new Float32Array(nt * 9);
  // A triangle is a cut face when all 3 verts lie on ANY exposed cut plane.
  // 180° cuts expose one plane; the 90° quadrant wedge exposes two.
  const axIdxs = (Array.isArray(cutAxis) ? cutAxis : [cutAxis])
    .map((a) => (a === 'x' ? 0 : a === 'y' ? 1 : 2));
  const EPS = 1;
  const [mr, mg, mb] = mainColor;
  const [cr0, cg0, cb0] = cutColor;
  for (let i = 0; i < nt; i++) {
    const a = tri[i * 3], b = tri[i * 3 + 1], c = tri[i * 3 + 2];
    const ax = vp[a * np],     ay = vp[a * np + 1], az = vp[a * np + 2];
    const bx = vp[b * np],     by = vp[b * np + 1], bz = vp[b * np + 2];
    const cx = vp[c * np],     cy = vp[c * np + 1], cz = vp[c * np + 2];
    outPos[i * 9 + 0] = ax; outPos[i * 9 + 1] = ay; outPos[i * 9 + 2] = az;
    outPos[i * 9 + 3] = bx; outPos[i * 9 + 4] = by; outPos[i * 9 + 5] = bz;
    outPos[i * 9 + 6] = cx; outPos[i * 9 + 7] = cy; outPos[i * 9 + 8] = cz;
    let isCut = false;
    for (const axIdx of axIdxs) {
      const av = axIdx === 0 ? ax : axIdx === 1 ? ay : az;
      const bv = axIdx === 0 ? bx : axIdx === 1 ? by : bz;
      const cv = axIdx === 0 ? cx : axIdx === 1 ? cy : cz;
      if (Math.abs(av) < EPS && Math.abs(bv) < EPS && Math.abs(cv) < EPS) { isCut = true; break; }
    }
    let r, g, b2;
    if (isCut) {
      r = cr0; g = cg0; b2 = cb0;
      if (cutVariance > 0) {
        // Stable per-triangle hash of the centroid (classic frag-shader noise
        // trick) → salt-and-pepper speckled look.
        const mx = (ax + bx + cx) / 3;
        const my = (ay + by + cy) / 3;
        const mz = (az + bz + cz) / 3;
        const h = Math.abs(Math.sin(mx * 12.9898 + my * 78.233 + mz * 37.719) * 43758.5453);
        const delta = ((h - Math.floor(h)) - 0.5) * cutVariance;
        r = Math.max(0, Math.min(1, r + delta));
        g = Math.max(0, Math.min(1, g + delta));
        b2 = Math.max(0, Math.min(1, b2 + delta));
      }
    } else {
      r = mr; g = mg; b2 = mb;
    }
    for (let j = 0; j < 3; j++) {
      outCol[i * 9 + j * 3 + 0] = r;
      outCol[i * 9 + j * 3 + 1] = g;
      outCol[i * 9 + j * 3 + 2] = b2;
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(outPos, 3));
  out.setAttribute('color', new THREE.BufferAttribute(outCol, 3));
  out.computeVertexNormals();
  return out;
}

// ── Deviation detection — shared by warpGeometry + the per-primitive
// fast-path skip for straight vertical wells. ───────────────────────────────
function hasRealDeviation(wellDir: WellDirection | null | undefined): boolean {
  if (!wellDir?.segments?.length) return false;
  return wellDir.segments.some((s: any) =>
    Math.abs(s.q1?.[0] ?? 0) > 1e-6 || Math.abs(s.q1?.[1] ?? 0) > 1e-6 ||
    Math.abs(s.q2?.[0] ?? 0) > 1e-6 || Math.abs(s.q2?.[1] ?? 0) > 1e-6
  );
}

// ── Parallel-transport warp — bend a straight Z-axis BufferGeometry along the
// wellbore using a rotation-minimizing frame sampled from the centerline.
//
// Why not wellnew's dirWarp3D? For planar wells (constant azimuth) the ported
// wellnew math treats local Y as "along-tangent depth" rather than a
// tangent-perpendicular radial, so a vertex at local (0, R) shrinks by cos(inc)
// instead of staying at the correct perpendicular offset — which both twists
// the cut face and rotates the cross-section spuriously.
//
// Instead: sample the centerline, finite-difference tangents, build a
// parallel-transport frame (right, up) that rotates minimally along the well,
// and place each vertex at `centerline(MD) + x·right + y·up`.
export function warpGeometry(geo: THREE.BufferGeometry, wellDir: WellDirection | null | undefined): THREE.BufferGeometry {
  if (!wellDir?.segments?.length) return geo;
  const anyDev = wellDir.segments.some((s: any) =>
    Math.abs(s.q1?.[0] ?? 0) > 1e-6 || Math.abs(s.q1?.[1] ?? 0) > 1e-6 ||
    Math.abs(s.q2?.[0] ?? 0) > 1e-6 || Math.abs(s.q2?.[1] ?? 0) > 1e-6
  );
  if (!anyDev) return geo;

  const pos = geo.attributes.position as THREE.BufferAttribute;
  if (pos.count === 0) return geo;

  const _tWarp = _now();

  // ── Sample centerline + build parallel-transport frame ──────────────────
  const stepMD = 5;
  const td = wellDir.maxDepth;
  const samples: any[] = [];  // { md, pt:[x,y,z], tangent, right, up }
  for (let md = 0; md <= td; md += stepMD) {
    const n = wellDir.getInterNode(md);
    if (n) samples.push({ md, pt: [n.pt[0], n.pt[1], n.pt[2]] });
  }
  // Ensure a sample AT maxDepth (getInterNode returns null at md=td because
  // getSegment is strict `<` on md2; nudge just inside).
  const last = wellDir.getInterNode(Math.max(0, td - 1e-3));
  if (last) samples.push({ md: td, pt: [last.pt[0], last.pt[1], last.pt[2]] });
  if (samples.length < 2) { _timing.warp += _now() - _tWarp; return geo; }

  // Finite-difference tangents from neighboring sample positions.
  for (let i = 0; i < samples.length; i++) {
    const a = samples[Math.max(0, i - 1)];
    const b = samples[Math.min(samples.length - 1, i + 1)];
    const dx = b.pt[0] - a.pt[0], dy = b.pt[1] - a.pt[1], dz = b.pt[2] - a.pt[2];
    const mag = Math.hypot(dx, dy, dz);
    samples[i].tangent = mag > 1e-9 ? [dx / mag, dy / mag, dz / mag] : [0, 0, 1];
  }

  // Initial frame — pick `right` in the horizontal plane of the starting
  // tangent. Vertical start → right = world +X, up = world +Y.
  const t0 = samples[0].tangent;
  let right;
  const h0 = Math.hypot(t0[0], t0[1]);
  if (h0 < 1e-6) right = [1, 0, 0];
  else           right = [t0[0] / h0, t0[1] / h0, 0];
  let up = [
    t0[1] * right[2] - t0[2] * right[1],
    t0[2] * right[0] - t0[0] * right[2],
    t0[0] * right[1] - t0[1] * right[0],
  ];
  const upMag = Math.hypot(up[0], up[1], up[2]);
  if (upMag > 1e-9) up = [up[0] / upMag, up[1] / upMag, up[2] / upMag];
  else up = [0, 1, 0];
  samples[0].right = right;
  samples[0].up = up;

  // Parallel transport: at each step rotate the frame by the angle between
  // consecutive tangents around their cross-product. Cross-product = 0 when the
  // tangent is unchanged (straight segments), so the frame propagates without
  // drift through vertical + tangent sections.
  for (let i = 1; i < samples.length; i++) {
    const tp = samples[i - 1].tangent, tc = samples[i].tangent;
    const ax = tp[1] * tc[2] - tp[2] * tc[1];
    const ay = tp[2] * tc[0] - tp[0] * tc[2];
    const az = tp[0] * tc[1] - tp[1] * tc[0];
    const axisMag = Math.hypot(ax, ay, az);
    if (axisMag < 1e-9) {
      samples[i].right = samples[i - 1].right;
      samples[i].up = samples[i - 1].up;
      continue;
    }
    const nax = ax / axisMag, nay = ay / axisMag, naz = az / axisMag;
    const cosA = Math.max(-1, Math.min(1, tp[0]*tc[0] + tp[1]*tc[1] + tp[2]*tc[2]));
    const sinA = axisMag;
    samples[i].right = rodrigues(samples[i - 1].right, nax, nay, naz, sinA, cosA);
    samples[i].up    = rodrigues(samples[i - 1].up,    nax, nay, naz, sinA, cosA);
  }

  // ── Warp each vertex ─────────────────────────────────────────────────────
  const lastIdx = samples.length - 1;
  for (let i = 0; i < pos.count; i++) {
    const ox = pos.getX(i), oy = pos.getY(i), oz = pos.getZ(i);
    // Find the two samples bracketing this MD.
    let idx = Math.floor(oz / stepMD);
    if (idx < 0) idx = 0; else if (idx > lastIdx - 1) idx = lastIdx - 1;
    const s0 = samples[idx], s1 = samples[idx + 1];
    const denom = s1.md - s0.md || 1;
    const t = Math.max(0, Math.min(1, (oz - s0.md) / denom));

    const cx = s0.pt[0] + (s1.pt[0] - s0.pt[0]) * t;
    const cy = s0.pt[1] + (s1.pt[1] - s0.pt[1]) * t;
    const cz = s0.pt[2] + (s1.pt[2] - s0.pt[2]) * t;
    const rx = s0.right[0] + (s1.right[0] - s0.right[0]) * t;
    const ry = s0.right[1] + (s1.right[1] - s0.right[1]) * t;
    const rz = s0.right[2] + (s1.right[2] - s0.right[2]) * t;
    const ux = s0.up[0] + (s1.up[0] - s0.up[0]) * t;
    const uy = s0.up[1] + (s1.up[1] - s0.up[1]) * t;
    const uz = s0.up[2] + (s1.up[2] - s0.up[2]) * t;

    pos.setXYZ(i,
      cx + ox * rx + oy * ux,
      cy + ox * ry + oy * uy,
      cz + ox * rz + oy * uz,
    );
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  _timing.warp += _now() - _tWarp;
  return geo;
}

// Rodrigues rotation of v around unit axis k by angle with sin, cos precomputed.
function rodrigues(v: number[], kx: number, ky: number, kz: number, sinA: number, cosA: number): number[] {
  const cx = ky * v[2] - kz * v[1];
  const cy = kz * v[0] - kx * v[2];
  const cz = kx * v[1] - ky * v[0];
  const kd = kx * v[0] + ky * v[1] + kz * v[2];
  const one = 1 - cosA;
  return [
    v[0] * cosA + cx * sinA + kx * kd * one,
    v[1] * cosA + cy * sinA + ky * kd * one,
    v[2] * cosA + cz * sinA + kz * kd * one,
  ];
}

// ── Public primitive builders — each produces a THREE.BufferGeometry with the
//    half-section already applied and colored, ready for
//    MeshStandardMaterial(vertexColors:true). ────────────────────────────────

// Depth subdivision for the bore extrusion — one intermediate ring every ~5 MD
// units (gives the warp enough Z samples to bend smoothly).
function boreNDivisions(len: number): number { return Math.max(20, Math.ceil(len / 5)); }

// Map the legacy cutAxis UI ('x'|'y'|'z') into an extra azimuth offset so the
// survey-native path can always CSG against cutterBox('x') in straight space.
function resolveAzimuthDeg(cutAxis: string, cutAzimuthDeg: number): number {
  const base = cutAxis === 'y' ? 90 : 0;
  return (cutAzimuthDeg || 0) + base;
}

/** Solid cylinder along Z from z=top to z=bot, with the chosen half removed. */
export function cutCylinder(
  top: number, bot: number, radius: number, cutAxis: string, mainColor: number[],
  style: any = {}, wellDir: WellDirection | null = null, cutAzimuthDeg = 0, cutDeg = 180,
): THREE.BufferGeometry | null {
  if (!_wasm) throw new Error('manifold-3d not initialised');
  const { Manifold, CrossSection } = _wasm;
  const len = bot - top;
  if (!(len > 0) || !(radius > 0)) return null;

  // Vertical-well fast path — Manifold.cylinder + axis-aligned cutter
  // (cutterBox=180° half, cutterQuadrant=90° wedge).
  if (!hasRealDeviation(wellDir)) {
    let t = _now();
    const cyl = Manifold.cylinder(len, radius, radius, 64).translate([0, 0, top]);
    _timing.solid += _now() - t; _timing.builds++;
    t = _now();
    const result = cyl.subtract(cutterFor(cutAxis, cutDeg));
    _timing.cutaway += _now() - t; _timing.csgOps++;
    t = _now();
    const g = manifoldToColoredGeo(result, cutFaceAxes(cutAxis, cutDeg), mainColor, style.cutColor, style.cutVariance);
    _timing.extract += _now() - t;
    return g;
  }

  // Strategy E (deviated wells) — build the cross-section in 2D, extrude it
  // directly. The flat side(s) of the disc become the cut face; every X=0 vertex
  // maps to the wellbore centerline under warpGeometry so the cut face follows
  // the tangent automatically. 180° keeps HALF (intersect a half-plane); 90°
  // keeps 270° (subtract one quadrant square) so completions read whole.
  // The 2D boolean IS the cutaway (it carves the flat section face); charge it to
  // `cutaway` — like the vertical-path subtract — so the badge honestly reflects
  // that a cut ran on deviated wells (else it misreports "cutaway 0ms").
  let t = _now();
  const section = cutDeg === 90
    ? CrossSection.circle(radius, 64).subtract(
        CrossSection.square([radius * 3, radius * 3], true).translate([-radius * 1.5, -radius * 1.5]))
    : CrossSection.circle(radius, 64).intersect(
        CrossSection.square([radius * 3, radius * 3], true).translate([-radius * 1.5, 0]));
  _timing.cutaway += _now() - t; _timing.csgOps++; // section boolean = 1 CSG cut
  t = _now();
  const cyl = Manifold.extrude(section, len, boreNDivisions(len)).translate([0, 0, top]);
  _timing.solid += _now() - t; _timing.builds++;
  t = _now();
  const geo = manifoldToColoredGeo(cyl, cutFaceAxes('x', cutDeg), mainColor, style.cutColor, style.cutVariance);
  _timing.extract += _now() - t;
  const azDeg = resolveAzimuthDeg(cutAxis, cutAzimuthDeg);
  if (azDeg % 360 !== 0) geo.rotateZ((azDeg * Math.PI) / 180);
  return warpGeometry(geo, wellDir);
}

/** Hollow tube (annulus) along Z from z=top to z=bot, with the chosen half
 *  removed. innerR=0 collapses to a solid cylinder. */
export function cutTube(
  top: number, bot: number, innerR: number, outerR: number, cutAxis: string, mainColor: number[],
  style: any = {}, wellDir: WellDirection | null = null, cutAzimuthDeg = 0, cutDeg = 180,
): THREE.BufferGeometry | null {
  if (!_wasm) throw new Error('manifold-3d not initialised');
  const { Manifold, CrossSection } = _wasm;
  const len = bot - top;
  if (!(len > 0) || !(outerR > innerR) || !(innerR >= 0)) return null;

  // Vertical-well fast path (cutterBox=180° half, cutterQuadrant=90° wedge).
  if (!hasRealDeviation(wellDir)) {
    let t = _now();
    const outer = Manifold.cylinder(len, outerR, outerR, 64);
    const inner = Manifold.cylinder(len + 0.02, innerR, innerR, 64).translate([0, 0, -0.01]);
    _timing.solid += _now() - t; _timing.builds += 2;
    t = _now();
    const ring = outer.subtract(inner).translate([0, 0, top]);
    const result = ring.subtract(cutterFor(cutAxis, cutDeg));
    _timing.cutaway += _now() - t; _timing.csgOps += 2; // annulus hollow-out + cut
    t = _now();
    const g = manifoldToColoredGeo(result, cutFaceAxes(cutAxis, cutDeg), mainColor, style.cutColor, style.cutVariance);
    _timing.extract += _now() - t;
    return g;
  }

  // Strategy E (deviated wells) — annular 2D CrossSection extrude. The flat
  // side(s) of the section become extruded walls triangulated at ring density;
  // no 3D cutterBox, no coincident caps, no fins on deviated wells. 180° keeps
  // HALF (intersect a half-plane); 90° keeps 270° (subtract one quadrant square)
  // so completion tubing reads mostly whole along the trajectory.
  let t = _now();
  const keep = (r: number) =>
    cutDeg === 90
      ? CrossSection.circle(r, 64).subtract(
          CrossSection.square([outerR * 3, outerR * 3], true).translate([-outerR * 1.5, -outerR * 1.5]))
      : CrossSection.circle(r, 64).intersect(
          CrossSection.square([outerR * 3, outerR * 3], true).translate([-outerR * 1.5, 0]));
  const outerSec = keep(outerR);
  let ringCs;
  let ops = 1; // outer section boolean
  if (innerR > 0) {
    const innerSec = keep(innerR);
    ringCs = outerSec.subtract(innerSec);
    ops += 2; // inner section boolean + annulus subtract
  } else {
    ringCs = outerSec;
  }
  // The annular 2D booleans ARE the cutaway (they carve the flat section
  // face) — charge them to `cutaway`, not `solid`, so the badge is honest.
  _timing.cutaway += _now() - t; _timing.csgOps += ops;
  t = _now();
  const ring = Manifold.extrude(ringCs, len, boreNDivisions(len)).translate([0, 0, top]);
  _timing.solid += _now() - t; _timing.builds++;
  t = _now();
  const geo = manifoldToColoredGeo(ring, cutFaceAxes('x', cutDeg), mainColor, style.cutColor, style.cutVariance);
  _timing.extract += _now() - t;
  const azDeg = resolveAzimuthDeg(cutAxis, cutAzimuthDeg);
  if (azDeg % 360 !== 0) geo.rotateZ((azDeg * Math.PI) / 180);
  return warpGeometry(geo, wellDir);
}

/** Sphere (perforation marker) at a world-space center, half removed. Spheres
 *  are already positioned at world coords by the caller (via getInterNode), so
 *  they are NOT warped — warping would double-displace them. */
export function cutSphere(
  center: { x: number; y: number; z: number }, radius: number, cutAxis: string, mainColor: number[], style: any = {},
): THREE.BufferGeometry | null {
  if (!_wasm) throw new Error('manifold-3d not initialised');
  const { Manifold } = _wasm;
  if (!(radius > 0)) return null;
  let t = _now();
  const sph = Manifold.sphere(radius, 32).translate([center.x, center.y, center.z]);
  _timing.solid += _now() - t; _timing.builds++;
  t = _now();
  const result = sph.subtract(cutterBox(cutAxis));
  _timing.cutaway += _now() - t; _timing.csgOps++;
  t = _now();
  const g = manifoldToColoredGeo(result, cutAxis, mainColor, style.cutColor, style.cutVariance);
  _timing.extract += _now() - t;
  return g;
}
