// svg-emit.ts — PURE per-triangle GOURAUD SVG emitter for PrimitiveSvgView.
//
// Split into two PURE stages (batch-5 Phase 0) so a light-only change re-shades
// WITHOUT re-projecting:
//
//   projectScene(entries, camera, …)  →  ProjectedScene
//     Depends ONLY on geometry + camera + scale. Projects every vertex to
//     pixels, runs the Phong subdivision (positions → screen), stores each
//     emitted sub-triangle's CAMERA-FACING corner normals (NOT a shade), does
//     the back-face cull + degenerate drop, and projects the crease/silhouette
//     edge segments ONCE. Cache this keyed by geo+camera+scale.
//
//   shadeAndEmit(projected, {lightAngle, …})  →  <svg>
//     Depends on the LIGHT (+ per-part opacity). Turns each ProjTri's corner
//     normals into a Lambert shade, emits the 2-stop <linearGradient> (or flat
//     fill), does the GLOBAL painter's sort (opaque bucket first, then the
//     transparent bucket painted over with `fill-opacity`), and BUILDS the
//     <svg>. This is the ONLY stage a light-dial drag re-runs.
//
// `emitSvg` remains as a thin convenience wrapper (project → shade) so a
// one-shot caller / test can still get an <svg> in a single call.
//
// PER-PART TRANSPARENCY (batch-5 Phase 2): `projectScene` takes an ARRAY of
// entries (one per Manifold/TF sub-part) each with a base colour + a part
// index; `shadeAndEmit` receives per-part opacity and paints OPAQUE parts
// first, TRANSPARENT parts over the top with `fill-opacity` — the SVG analogue
// of PrimitiveDualScene's opaque-first `renderOrder` + `depthWrite:false`. A
// single-entry call (the merged full/cutVC mesh) is byte-identical to the
// pre-split emitter.
//
// NO Svelte, NO scene-state import, NO module-level MUTABLE state, NO global
// counters — `gid` is LOCAL to shadeAndEmit so it resets every call. Every
// tuning constant + the view params arrive via `opts`.

import * as THREE from 'three';
import { triangleKeepMask } from '$lib/shared/svg-reduce';

const SVG_NS = 'http://www.w3.org/2000/svg';

// ── Projection stage inputs ──────────────────────────────────────────────────

/** One projectable entry = a geometry + its part identity. For the merged
 *  single-mesh path this is a one-element array (`pi:0`, base = the default
 *  solid colour). For a Manifold/TF composite it is one entry PER sub-part. */
export interface ProjectEntry {
  geo: THREE.BufferGeometry;
  /** Part index — carried onto every emitted ProjTri so `shadeAndEmit` can look
   *  up this part's opacity / transparency bucket. */
  pi: number;
  /** Fallback base colour (0..1 RGB) used when the geometry has NO per-vertex
   *  `color` attribute (full-mode composite parts carry their colour on the
   *  appearance, not the mesh). Ignored per-vertex when a colour attr exists. */
  base: [number, number, number];
}

export interface ProjectOptions {
  /** View-only exaggeration [xScale, xScale, zScale] (positions only). */
  sX: number;
  sZ: number;
  /** Back-face cull — drop triangles whose outward normal faces away from the
   *  camera. TRUE only for a CLOSED solid mesh (visually identical, ~halves the
   *  fill count); MUST be FALSE for the cutaway/open mesh (its exposed concave
   *  inner walls legitimately face away yet are visible). */
  backfaceCull: boolean;
  /** Above this many triangles (PER entry) → flat per-face fill (no gradients). */
  HIGH_TRI: number;
}

/** One projected, screen-space (sub-)triangle. Shading is NOT baked in — the
 *  three CAMERA-FACING corner normals are stored so a light change re-shades
 *  without re-projecting. */
export interface ProjTri {
  ax: number; ay: number; bx: number; by: number; cx: number; cy: number;
  /** 3 corner normals (9 floats), already flipped to face the camera. */
  n: number[];
  /** Mean NDC depth (global painter's sort key). */
  z: number;
  /** Base colour (0..1) — per-vertex colour when present, else the entry base. */
  r: number; g: number; b: number;
  /** Owning part index (opacity / bucket lookup at shade time). */
  pi: number;
  /** Monster-mesh flat-fill face (shade = mean of the 3 corner shades). */
  flat: boolean;
}

export interface ProjectedScene {
  tris: ProjTri[];
  /** Concatenated, already-projected crease/silhouette edge path (`M..L..`). */
  edgePath: string;
  /** Camera world-forward direction — `shadeAndEmit` derives L (spun by the
   *  light angle) + V (= −viewDir) from it, so shading needs no camera. */
  viewDir: [number, number, number];
  renderW: number;
  renderH: number;
  fitToContainer: boolean;
  /** Source triangle count (across all entries). */
  triCount: number;
  /** Source triangles skipped before emit — back-face-culled + degenerate. */
  culledCount: number;
  /** True when ANY entry took the high-poly flat-fill fallback. */
  flatFill: boolean;
}

// ── Shade stage inputs ───────────────────────────────────────────────────────

export interface ShadeOptions {
  /** Per-instance id namespace, prefixed onto every gradient id. `url(#id)`
   *  resolves DOCUMENT-WIDE, so the N PrimitiveSvgView svgs mounted in
   *  /primitives must NOT share an `g{n}` namespace — a unique prefix per mount
   *  makes collisions impossible (past bug `svg_gradient_id_collision`). */
  idPrefix: string;
  /** Key-light angle (deg) — spins L about the view axis. */
  lightAngle: number;
  /** Draw the black 20° crease/silhouette edge outline on top. */
  showEdges: boolean;
  /** Lighting terms: s = AMBIENT + KEY·max(0,n·L) + FILL·max(0,n·V), clamped 1. */
  AMBIENT: number;
  KEY: number;
  FILL: number;
  /** Base-colour mute toward luminance (DESAT) + dim (BRIGHT) — 3D tone match. */
  DESAT: number;
  BRIGHT: number;
  /** Per-part effective opacity (0..1), indexed by ProjTri.pi. Missing → 1. */
  partAlpha?: number[];
  /** Per-part transparency flag, indexed by ProjTri.pi. When true the part's
   *  polys carry `fill-opacity` + paint in the TRANSPARENT bucket (after every
   *  opaque part). Missing/false → opaque bucket, no fill-opacity (byte-identical
   *  to the pre-transparency emitter). */
  partTrans?: boolean[];
}

// ── Legacy single-call options (emitSvg wrapper) ─────────────────────────────

export interface SvgEmitOptions extends ProjectOptions, ShadeOptions {
  /** Default solid-mesh base colour (used when no per-vertex colour attr). */
  DEF_R: number;
  DEF_G: number;
  DEF_B: number;
}

export interface SvgEmitResult {
  /** The fully-built, styled <svg> (download target / mount target). */
  svg: SVGSVGElement;
  /** Source triangle count (perf guard / toolbar). */
  triCount: number;
  /** Polygons actually written (> triCount when Phong refinement subdivides). */
  emitCount: number;
  /** True when the high-poly flat-fill fallback was taken (triCount > HIGH_TRI). */
  flatFill: boolean;
  /** Source triangles skipped before emit — back-face-culled + degenerate. */
  culledCount: number;
}

// 0..1 channel → 0..255, clamped.
function ch(v: number): number {
  return Math.round(Math.max(0, Math.min(1, v)) * 255);
}
// base×shade RGB floats → `#rrggbb`.
function rgbHex(r: number, g: number, b: number): string {
  return `#${((1 << 24) + (ch(r) << 16) + (ch(g) << 8) + ch(b)).toString(16).slice(1)}`;
}
// alpha 0..1 → a compact `fill-opacity` string (trailing zeros trimmed).
function alphaStr(a: number): string {
  const s = a.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  return s === '' ? '0' : s;
}

/**
 * PROJECTION STAGE — project every entry's geometry to screen space + build the
 * emitted (sub-)triangle list with per-corner CAMERA-FACING normals, plus the
 * projected crease-edge path. Depends only on geometry + camera + scale; PURE.
 */
export function projectScene(
  entries: ProjectEntry[],
  camera: THREE.Camera,
  renderW: number,
  renderH: number,
  fitToContainer: boolean,
  opts: ProjectOptions,
): ProjectedScene {
  const { sX, sZ, backfaceCull, HIGH_TRI } = opts;

  const viewDir = camera.getWorldDirection(new THREE.Vector3()).normalize();
  // V = camera-side direction (surface → lens); used to flip normals toward the
  // camera so shading is two-sided (concave inner / cut faces light like the
  // outer skin) AND for the back-face cull test.
  const V = viewDir.clone().negate();

  const tris: ProjTri[] = [];
  let edgePath = '';
  let triCount = 0;
  let culledCount = 0;
  let flatFill = false;

  const p = new THREE.Vector3(), nrm = new THREE.Vector3();
  const Pa = new THREE.Vector3(), Pb = new THREE.Vector3(), Pc = new THREE.Vector3();
  const Na = new THREE.Vector3(), Nb = new THREE.Vector3(), Nc = new THREE.Vector3();
  const Pg = new THREE.Vector3(), Ng = new THREE.Vector3();
  const pe = new THREE.Vector3();

  // Phong refinement constants (see the shade stage for the full rationale).
  const KMAX = 6;            // cap subdivision so the SVG can't explode
  const TARGET = 0.05;       // ~2.9° per sub-step — finer than the eye resolves
  const SUBDIV_PX = 10;      // min on-screen sub-triangle edge (px)
  const EMIT_BUDGET = 16000; // ceiling on emitted polys (per entry)

  for (const entry of entries) {
    const geo = entry.geo;
    const posAttr = geo.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!posAttr || posAttr.count === 0) continue;
    const nrmAttr = geo.getAttribute('normal') as THREE.BufferAttribute | undefined;
    const colAttr = geo.getAttribute('color') as THREE.BufferAttribute | undefined;
    const vCount = posAttr.count;
    const idx = geo.index;

    const triN = idx ? Math.floor(idx.count / 3) : Math.floor(vCount / 3);
    triCount += triN;
    const entryFlat = triN > HIGH_TRI;
    if (entryFlat) {
      flatFill = true;
      console.warn(
        `[PrimitiveSvgView] ${triN} tris > ${HIGH_TRI}: flat per-face fill (no gradients)`,
      );
    }

    // ── Per-vertex: project to pixels + camera-facing normal + base colour ──
    const sx = new Float32Array(vCount);
    const sy = new Float32Array(vCount);
    const sz = new Float32Array(vCount);
    // camera-facing per-vertex normals (nx/ny/nz interleaved)
    const vn = new Float32Array(vCount * 3);
    const cr = new Float32Array(vCount), cg = new Float32Array(vCount), cb = new Float32Array(vCount);
    for (let i = 0; i < vCount; i++) {
      p.set(posAttr.getX(i) * sX, posAttr.getY(i) * sX, posAttr.getZ(i) * sZ).project(camera);
      sx[i] = (p.x * 0.5 + 0.5) * renderW;
      sy[i] = (-p.y * 0.5 + 0.5) * renderH;
      sz[i] = p.z;
      if (nrmAttr) {
        nrm.set(nrmAttr.getX(i), nrmAttr.getY(i), nrmAttr.getZ(i));
        // TWO-SIDED: flip toward the camera so concave inner / cut faces light
        // like the outer skin. After the flip n·V ≥ 0, so the shade stage uses
        // AMBIENT + KEY·max(0,n·L) + FILL·max(0,n·V) directly.
        if (nrm.dot(V) < 0) nrm.negate();
        vn[i * 3] = nrm.x; vn[i * 3 + 1] = nrm.y; vn[i * 3 + 2] = nrm.z;
      } else {
        vn[i * 3] = 0; vn[i * 3 + 1] = 0; vn[i * 3 + 2] = 0;
      }
      cr[i] = colAttr ? colAttr.getX(i) : entry.base[0];
      cg[i] = colAttr ? colAttr.getY(i) : entry.base[1];
      cb[i] = colAttr ? colAttr.getZ(i) : entry.base[2];
    }

    // Triangle vertex indices.
    const a = new Int32Array(triN), b = new Int32Array(triN), c = new Int32Array(triN);
    for (let t = 0; t < triN; t++) {
      if (idx) { a[t] = idx.getX(3 * t); b[t] = idx.getX(3 * t + 1); c[t] = idx.getX(3 * t + 2); }
      else { a[t] = 3 * t; b[t] = 3 * t + 1; c[t] = 3 * t + 2; }
    }

    // ── Triangle reduction (pure): back-face cull + degenerate drop ──────────
    const keep = triangleKeepMask(
      {
        triN, a, b, c,
        pos: posAttr.array as ArrayLike<number>,
        nrm: nrmAttr ? (nrmAttr.array as ArrayLike<number>) : undefined,
      },
      { view: [V.x, V.y, V.z], cull: backfaceCull },
    );
    culledCount += triN - keep.kept;
    const km = keep.mask;

    let emittedInEntry = 0;
    for (let t = 0; t < triN; t++) {
      if (!km[t]) continue; // back-face-culled or degenerate → skip
      const ia = a[t], ib = b[t], ic = c[t];
      const br = cr[ia], bgc = cg[ia], bl = cb[ia]; // face colour = vertex a's
      const zTri = (sz[ia] + sz[ib] + sz[ic]) / 3;

      if (entryFlat) {
        // Monster mesh → ONE flat-fill face (shade = mean of corner shades,
        // resolved at shade time). Store all 3 corner normals + flat flag.
        tris.push({
          ax: sx[ia], ay: sy[ia], bx: sx[ib], by: sy[ib], cx: sx[ic], cy: sy[ic],
          n: [vn[ia * 3], vn[ia * 3 + 1], vn[ia * 3 + 2],
              vn[ib * 3], vn[ib * 3 + 1], vn[ib * 3 + 2],
              vn[ic * 3], vn[ic * 3 + 1], vn[ic * 3 + 2]],
          z: zTri, r: br, g: bgc, b: bl, pi: entry.pi, flat: true,
        });
        emittedInEntry++;
        continue;
      }

      // Subdivision level K = how finely to Phong-sample this face.
      let K = 1;
      if (nrmAttr) {
        Na.set(nrmAttr.getX(ia), nrmAttr.getY(ia), nrmAttr.getZ(ia));
        Nb.set(nrmAttr.getX(ib), nrmAttr.getY(ib), nrmAttr.getZ(ib));
        Nc.set(nrmAttr.getX(ic), nrmAttr.getY(ic), nrmAttr.getZ(ic));
        const dmin = Math.min(Na.dot(Nb), Nb.dot(Nc), Na.dot(Nc));
        const spread = Math.acos(Math.max(-1, Math.min(1, dmin)));
        K = Math.max(1, Math.min(KMAX, Math.ceil(spread / TARGET)));
        const ax = sx[ia], ay = sy[ia], bx = sx[ib], by = sy[ib], cx = sx[ic], cy = sy[ic];
        const maxEdge = Math.max(
          Math.hypot(bx - ax, by - ay),
          Math.hypot(cx - bx, cy - by),
          Math.hypot(ax - cx, ay - cy),
        );
        K = Math.min(K, Math.max(1, Math.floor(maxEdge / SUBDIV_PX)));
        if (emittedInEntry + K * K > EMIT_BUDGET) K = 1; // budget guard
      }

      if (K <= 1) {
        // Flat enough (or no normals) → one gradient from the corner normals.
        tris.push({
          ax: sx[ia], ay: sy[ia], bx: sx[ib], by: sy[ib], cx: sx[ic], cy: sy[ic],
          n: [vn[ia * 3], vn[ia * 3 + 1], vn[ia * 3 + 2],
              vn[ib * 3], vn[ib * 3 + 1], vn[ib * 3 + 2],
              vn[ic * 3], vn[ic * 3 + 1], vn[ic * 3 + 2]],
          z: zTri, r: br, g: bgc, b: bl, pi: entry.pi, flat: false,
        });
        emittedInEntry++;
        continue;
      }

      // Sample a barycentric grid, interpolate the LOCAL position (→ reproject,
      // keeping NDC z) + the normal (→ renormalise → flip toward camera).
      Pa.set(posAttr.getX(ia), posAttr.getY(ia), posAttr.getZ(ia));
      Pb.set(posAttr.getX(ib), posAttr.getY(ib), posAttr.getZ(ib));
      Pc.set(posAttr.getX(ic), posAttr.getY(ic), posAttr.getZ(ic));
      const gpx: number[] = [], gpy: number[] = [], gpz: number[] = [];
      const gnx: number[] = [], gny: number[] = [], gnz: number[] = [];
      const rowStart: number[] = [];
      let gi = 0;
      for (let i = 0; i <= K; i++) {
        rowStart[i] = gi;
        for (let j = 0; j <= K - i; j++) {
          const wa = (K - i - j) / K, wb = i / K, wc = j / K;
          Pg.set(
            (Pa.x * wa + Pb.x * wb + Pc.x * wc) * sX,
            (Pa.y * wa + Pb.y * wb + Pc.y * wc) * sX,
            (Pa.z * wa + Pb.z * wb + Pc.z * wc) * sZ,
          ).project(camera);
          gpx[gi] = (Pg.x * 0.5 + 0.5) * renderW;
          gpy[gi] = (-Pg.y * 0.5 + 0.5) * renderH;
          gpz[gi] = Pg.z;
          Ng.set(
            Na.x * wa + Nb.x * wb + Nc.x * wc,
            Na.y * wa + Nb.y * wb + Nc.y * wc,
            Na.z * wa + Nb.z * wb + Nc.z * wc,
          );
          Ng.divideScalar(Ng.length() || 1);
          if (Ng.dot(V) < 0) Ng.negate(); // camera-facing (matches per-vertex)
          gnx[gi] = Ng.x; gny[gi] = Ng.y; gnz[gi] = Ng.z;
          gi++;
        }
      }
      // Stitch the grid into up/down sub-triangles.
      for (let i = 0; i < K; i++) {
        const r0 = rowStart[i], r1 = rowStart[i + 1];
        for (let j = 0; j < K - i; j++) {
          const p00 = r0 + j, p01 = r0 + j + 1, p10 = r1 + j;
          tris.push({
            ax: gpx[p00], ay: gpy[p00], bx: gpx[p01], by: gpy[p01], cx: gpx[p10], cy: gpy[p10],
            n: [gnx[p00], gny[p00], gnz[p00], gnx[p01], gny[p01], gnz[p01], gnx[p10], gny[p10], gnz[p10]],
            z: (gpz[p00] + gpz[p01] + gpz[p10]) / 3, r: br, g: bgc, b: bl, pi: entry.pi, flat: false,
          });
          emittedInEntry++;
          if (j < K - i - 1) {
            const p11 = r1 + j + 1;
            tris.push({
              ax: gpx[p01], ay: gpy[p01], bx: gpx[p11], by: gpy[p11], cx: gpx[p10], cy: gpy[p10],
              n: [gnx[p01], gny[p01], gnz[p01], gnx[p11], gny[p11], gnz[p11], gnx[p10], gny[p10], gnz[p10]],
              z: (gpz[p01] + gpz[p11] + gpz[p10]) / 3, r: br, g: bgc, b: bl, pi: entry.pi, flat: false,
            });
            emittedInEntry++;
          }
        }
      }
    }

    // ── Crease/silhouette edge path (per entry, projected once) ──────────────
    // Depends only on geometry + camera — cached with the scene, so a light-dial
    // drag never rebuilds EdgesGeometry (was the P3 per-render cost).
    const eg = new THREE.EdgesGeometry(geo, 20);
    const ep = eg.getAttribute('position') as THREE.BufferAttribute;
    const segs = Math.floor(ep.count / 2);
    for (let s = 0; s < segs; s++) {
      const i0 = 2 * s, i1 = i0 + 1;
      pe.set(ep.getX(i0) * sX, ep.getY(i0) * sX, ep.getZ(i0) * sZ).project(camera);
      const x0 = (pe.x * 0.5 + 0.5) * renderW, y0 = (-pe.y * 0.5 + 0.5) * renderH;
      pe.set(ep.getX(i1) * sX, ep.getY(i1) * sX, ep.getZ(i1) * sZ).project(camera);
      const x1 = (pe.x * 0.5 + 0.5) * renderW, y1 = (-pe.y * 0.5 + 0.5) * renderH;
      edgePath += `M${x0.toFixed(2)},${y0.toFixed(2)}L${x1.toFixed(2)},${y1.toFixed(2)}`;
    }
    eg.dispose();
  }

  return {
    tris, edgePath, viewDir: [viewDir.x, viewDir.y, viewDir.z],
    renderW, renderH, fitToContainer, triCount, culledCount, flatFill,
  };
}

/**
 * SHADE STAGE — turn a ProjectedScene into a styled <svg>. Depends on the LIGHT
 * (+ per-part opacity) only; a light-dial / x-ray drag re-runs JUST this. PURE:
 * touches no DOM outside the new <svg> tree.
 */
export function shadeAndEmit(scene: ProjectedScene, opts: ShadeOptions): SvgEmitResult {
  const {
    idPrefix, lightAngle, showEdges, AMBIENT, KEY, FILL, DESAT, BRIGHT,
    partAlpha, partTrans,
  } = opts;
  const { renderW, renderH, fitToContainer } = scene;

  const mute = (r: number, g: number, b: number): [number, number, number] => {
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    return [
      (r + (lum - r) * DESAT) * BRIGHT,
      (g + (lum - g) * DESAT) * BRIGHT,
      (b + (lum - b) * DESAT) * BRIGHT,
    ];
  };

  // Rebuild L (spun by the slider) + V from the cached view direction.
  const viewDir = new THREE.Vector3(scene.viewDir[0], scene.viewDir[1], scene.viewDir[2]);
  const L = new THREE.Vector3(-0.4, 0.85, -0.35).normalize();
  L.applyAxisAngle(viewDir, (lightAngle * Math.PI) / 180);
  const V = viewDir.clone().negate();
  const Lx = L.x, Ly = L.y, Lz = L.z, Vx = V.x, Vy = V.y, Vz = V.z;
  // Normals are stored CAMERA-FACING (n·V ≥ 0), so the two-sided flip is done.
  const shadeN = (nx: number, ny: number, nz: number): number =>
    Math.min(1, AMBIENT + KEY * Math.max(0, nx * Lx + ny * Ly + nz * Lz) + FILL * Math.max(0, nx * Vx + ny * Vy + nz * Vz));

  // ── Build the <svg> shell ──────────────────────────────────────────────────
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', String(renderW));
  svg.setAttribute('height', String(renderH));
  svg.setAttribute('viewBox', `0 0 ${renderW} ${renderH}`);
  const defs = document.createElementNS(SVG_NS, 'defs');
  svg.appendChild(defs);
  const bgRect = document.createElementNS(SVG_NS, 'rect');
  bgRect.setAttribute('x', '0'); bgRect.setAttribute('y', '0');
  bgRect.setAttribute('width', String(renderW)); bgRect.setAttribute('height', String(renderH));
  bgRect.setAttribute('fill', '#ffffff');
  svg.appendChild(bgRect);

  // GLOBAL painter's sort. We COLLECT every (sub-)triangle with its mean NDC
  // depth, then paint the OPAQUE bucket first (globally z-sorted, far→near) and
  // the TRANSPARENT bucket over the top (globally z-sorted, `fill-opacity`) —
  // the SVG analogue of the 3D pane's opaque-first renderOrder + depthWrite:false
  // (PrimitiveDualScene). So a transparent casing shows the tubing through it.
  let gid = 0;
  const draws: { z: number; bucket: 0 | 1; poly: SVGElement; grad?: SVGElement }[] = [];

  // Emit ONE screen-space triangle as an exact 2-stop Gouraud gradient (flat
  // fill when its 3 shades are ~equal or it's degenerate). `alpha < 1` sets
  // `fill-opacity` + paints in the transparent bucket. Returns 1 if it drew.
  function appendTri(
    ax: number, ay: number, bx: number, by: number, cx: number, cy: number,
    s0: number, s1: number, s2: number, br0: number, bg0: number, bl0: number,
    z: number, alpha: number, bucket: 0 | 1,
  ): number {
    const [br, bgc, bl] = mute(br0, bg0, bl0);
    const det = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (!Number.isFinite(det) || Math.abs(det) < 1e-7) return 0; // degenerate
    const poly = document.createElementNS(SVG_NS, 'polygon');
    poly.setAttribute(
      'points',
      `${ax.toFixed(2)},${ay.toFixed(2)} ${bx.toFixed(2)},${by.toFixed(2)} ${cx.toFixed(2)},${cy.toFixed(2)}`,
    );
    if (alpha < 1) poly.setAttribute('fill-opacity', alphaStr(alpha));
    // The 3 corner shades define a plane s(x,y)=A·x+B·y+C over screen coords.
    const A = ((s1 - s0) * (cy - ay) - (s2 - s0) * (by - ay)) / det;
    const B = ((bx - ax) * (s2 - s0) - (cx - ax) * (s1 - s0)) / det;
    const gmag = Math.hypot(A, B);
    if (gmag < 1e-6) {
      poly.setAttribute('fill', rgbHex(br * s0, bgc * s0, bl * s0));
      draws.push({ z, bucket, poly });
      return 1;
    }
    const gx = A / gmag, gy = B / gmag;
    const ta = ax * gx + ay * gy, tb = bx * gx + by * gy, tc = cx * gx + cy * gy;
    let tlo = ta, slo = s0, thi = ta, shi = s0;
    if (tb < tlo) { tlo = tb; slo = s1; }  if (tb > thi) { thi = tb; shi = s1; }
    if (tc < tlo) { tlo = tc; slo = s2; }  if (tc > thi) { thi = tc; shi = s2; }
    if (thi - tlo < 1e-4) {
      poly.setAttribute('fill', rgbHex(br * s0, bgc * s0, bl * s0));
      draws.push({ z, bucket, poly });
      return 1;
    }
    const grad = document.createElementNS(SVG_NS, 'linearGradient');
    const id = `${idPrefix}g${gid++}`;
    grad.setAttribute('id', id);
    grad.setAttribute('gradientUnits', 'userSpaceOnUse');
    grad.setAttribute('x1', (gx * tlo).toFixed(2));
    grad.setAttribute('y1', (gy * tlo).toFixed(2));
    grad.setAttribute('x2', (gx * thi).toFixed(2));
    grad.setAttribute('y2', (gy * thi).toFixed(2));
    const stop0 = document.createElementNS(SVG_NS, 'stop');
    stop0.setAttribute('offset', '0');
    stop0.setAttribute('stop-color', rgbHex(br * slo, bgc * slo, bl * slo));
    const stop1 = document.createElementNS(SVG_NS, 'stop');
    stop1.setAttribute('offset', '1');
    stop1.setAttribute('stop-color', rgbHex(br * shi, bgc * shi, bl * shi));
    grad.appendChild(stop0); grad.appendChild(stop1);
    poly.setAttribute('fill', `url(#${id})`);
    draws.push({ z, bucket, poly, grad });
    return 1;
  }

  let emitted = 0;
  for (const t of scene.tris) {
    const alpha = partAlpha?.[t.pi] ?? 1;
    const bucket: 0 | 1 = (partTrans?.[t.pi] ?? false) ? 1 : 0;
    if (t.flat) {
      // Monster-mesh flat face — mean of the 3 corner shades, one flat fill.
      const s = (
        shadeN(t.n[0], t.n[1], t.n[2]) + shadeN(t.n[3], t.n[4], t.n[5]) + shadeN(t.n[6], t.n[7], t.n[8])
      ) / 3;
      const det = (t.bx - t.ax) * (t.cy - t.ay) - (t.by - t.ay) * (t.cx - t.ax);
      if (!Number.isFinite(det) || Math.abs(det) < 1e-7) continue;
      const [mr, mg, mb] = mute(t.r, t.g, t.b);
      const poly = document.createElementNS(SVG_NS, 'polygon');
      poly.setAttribute('points', `${t.ax.toFixed(2)},${t.ay.toFixed(2)} ${t.bx.toFixed(2)},${t.by.toFixed(2)} ${t.cx.toFixed(2)},${t.cy.toFixed(2)}`);
      poly.setAttribute('fill', rgbHex(mr * s, mg * s, mb * s));
      if (alpha < 1) poly.setAttribute('fill-opacity', alphaStr(alpha));
      draws.push({ z: t.z, bucket, poly });
      emitted++;
      continue;
    }
    emitted += appendTri(
      t.ax, t.ay, t.bx, t.by, t.cx, t.cy,
      shadeN(t.n[0], t.n[1], t.n[2]), shadeN(t.n[3], t.n[4], t.n[5]), shadeN(t.n[6], t.n[7], t.n[8]),
      t.r, t.g, t.b, t.z, alpha, bucket,
    );
  }

  // Paint: OPAQUE bucket first, then TRANSPARENT bucket; within each bucket
  // back-to-front (far first → near on top). For an all-opaque scene this is the
  // pure `v.z - u.z` sort (byte-identical to the pre-transparency emitter).
  draws.sort((u, v) => (u.bucket - v.bucket) || (v.z - u.z));
  for (const dr of draws) {
    if (dr.grad) defs.appendChild(dr.grad);
    svg.appendChild(dr.poly);
  }

  // Edge outline — pre-projected crease/silhouette path, drawn ON TOP. Gated on
  // showEdges (the ONLY projection-independent toggle → no re-projection needed).
  if (showEdges && scene.edgePath) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', scene.edgePath);
    path.setAttribute('stroke', '#000000');
    path.setAttribute('stroke-width', '1');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
  }

  // Sizing. PERSP: fill the stage, no scroll. ORTHO: natural pixel size.
  svg.style.display = 'block';
  if (fitToContainer) {
    svg.style.width = '100%';
    svg.style.height = '100%';
  } else {
    svg.style.width = `${renderW}px`;
    svg.style.height = `${renderH}px`;
    svg.style.margin = '0 auto';
  }

  return { svg, triCount: scene.triCount, emitCount: emitted, flatFill: scene.flatFill, culledCount: scene.culledCount };
}

/**
 * Convenience one-shot: project a SINGLE geometry then shade it. Byte-identical
 * to the pre-split emitter. The shell uses `projectScene` + `shadeAndEmit`
 * directly so it can cache the projection across light-dial drags.
 */
export function emitSvg(
  geo: THREE.BufferGeometry,
  camera: THREE.Camera,
  renderW: number,
  renderH: number,
  fitToContainer: boolean,
  opts: SvgEmitOptions,
): SvgEmitResult {
  const scene = projectScene(
    [{ geo, pi: 0, base: [opts.DEF_R, opts.DEF_G, opts.DEF_B] }],
    camera, renderW, renderH, fitToContainer,
    { sX: opts.sX, sZ: opts.sZ, backfaceCull: opts.backfaceCull, HIGH_TRI: opts.HIGH_TRI },
  );
  return shadeAndEmit(scene, {
    idPrefix: opts.idPrefix, lightAngle: opts.lightAngle, showEdges: opts.showEdges,
    AMBIENT: opts.AMBIENT, KEY: opts.KEY, FILL: opts.FILL, DESAT: opts.DESAT, BRIGHT: opts.BRIGHT,
  });
}
