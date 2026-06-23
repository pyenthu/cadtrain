// svg-emit.ts — PURE per-triangle GOURAUD SVG emitter for PrimitiveSvgView.
//
// Given a baked geometry + a (pre-built) camera + view/shade params, project
// every vertex, compute a per-vertex Lambert shade, emit each screen-space
// triangle as a 2-stop <linearGradient> (or a flat fill when degenerate / ~flat
// / above HIGH_TRI), do the GLOBAL painter's sort, and BUILD + return the
// <svg>. NO Svelte, NO scene-state import, NO module-level MUTABLE state, NO
// global counters — `gid` is LOCAL to emitSvg so it resets every call. Every
// tuning constant + the view params arrive via `opts`. See PrimitiveSvgView for
// the shell + the full shading rationale.

import * as THREE from 'three';

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface SvgEmitOptions {
  /** View-only exaggeration [xScale, xScale, zScale] (positions only). */
  sX: number;
  sZ: number;
  /** Key-light angle (deg) — spins L about the view axis. */
  lightAngle: number;
  /** Draw the black 20° crease/silhouette edge outline on top. */
  showEdges: boolean;
  /** Above this many triangles → flat per-face fill (no gradients). */
  HIGH_TRI: number;
  /** Lighting terms: s = AMBIENT + KEY·max(0,n·L) + FILL·max(0,n·V), clamped 1. */
  AMBIENT: number;
  KEY: number;
  FILL: number;
  /** Default solid-mesh base colour (used when no per-vertex colour attr). */
  DEF_R: number;
  DEF_G: number;
  DEF_B: number;
  /** Base-colour mute toward luminance (DESAT) + dim (BRIGHT) — 3D tone match. */
  DESAT: number;
  BRIGHT: number;
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
}

// 0..1 channel → 0..255, clamped.
function ch(v: number): number {
  return Math.round(Math.max(0, Math.min(1, v)) * 255);
}
// base×shade RGB floats → `#rrggbb`.
function rgbHex(r: number, g: number, b: number): string {
  return `#${((1 << 24) + (ch(r) << 16) + (ch(g) << 8) + ch(b)).toString(16).slice(1)}`;
}

/**
 * Emit `geo` as a Gouraud <svg> using the supplied `camera` + `renderW/H`. The
 * returned <svg> is fully built + styled; the caller mounts it (replaceChildren)
 * and owns the first-paint re-raster. Pure: no DOM is touched outside the new
 * <svg> tree, no module state mutates.
 */
export function emitSvg(
  geo: THREE.BufferGeometry,
  camera: THREE.Camera,
  renderW: number,
  renderH: number,
  fitToContainer: boolean,
  opts: SvgEmitOptions,
): SvgEmitResult {
  const {
    sX, sZ, lightAngle, showEdges, HIGH_TRI,
    AMBIENT, KEY, FILL, DEF_R, DEF_G, DEF_B, DESAT, BRIGHT,
  } = opts;

  /** Mute a base colour toward its luminance + dim — matches the lit 3D tone. */
  const mute = (r: number, g: number, b: number): [number, number, number] => {
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    return [
      (r + (lum - r) * DESAT) * BRIGHT,
      (g + (lum - g) * DESAT) * BRIGHT,
      (b + (lum - b) * DESAT) * BRIGHT,
    ];
  };

  const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
  const nrmAttr = geo.getAttribute('normal') as THREE.BufferAttribute | undefined;
  const colAttr = geo.getAttribute('color') as THREE.BufferAttribute | undefined;
  const vCount = posAttr.count;
  const idx = geo.index;

  // Triangle count → perf guard + flat-fill fallback for monster meshes.
  const triN = idx ? Math.floor(idx.count / 3) : Math.floor(vCount / 3);
  const flatFill = triN > HIGH_TRI;
  if (flatFill) {
    console.warn(
      `[PrimitiveSvgView] ${triN} tris > ${HIGH_TRI}: flat per-face fill (no gradients)`,
    );
  }

  // Key light: upper-front so a cylinder catches a soft highlight, then spun
  // about the VIEW axis by the slider so dragging sweeps the highlight around.
  // n·L is evaluated in the part's LOCAL space (normals aren't view-scaled), so
  // the shade follows the true surface; the view-axis is close enough in local
  // space (the exaggeration only scales, never rotates).
  const viewDir = camera.getWorldDirection(new THREE.Vector3()).normalize();
  const L = new THREE.Vector3(-0.4, 0.85, -0.35).normalize();
  L.applyAxisAngle(viewDir, (lightAngle * Math.PI) / 180);
  // Camera-side fill direction (points from the surface back toward the lens).
  const V = viewDir.clone().negate();

  // ── Per-vertex: project to pixels + Lambert shade + base colour ──────────
  const sx = new Float32Array(vCount);   // screen x (px)
  const sy = new Float32Array(vCount);   // screen y (px)
  const sz = new Float32Array(vCount);   // NDC depth (-1 near … +1 far)
  const sh = new Float32Array(vCount);   // Lambert shade 0..1
  const cr = new Float32Array(vCount), cg = new Float32Array(vCount), cb = new Float32Array(vCount);
  const p = new THREE.Vector3(), nrm = new THREE.Vector3();
  for (let i = 0; i < vCount; i++) {
    // scale (view exaggeration) → project to NDC → pixels (match the viewBox).
    p.set(posAttr.getX(i) * sX, posAttr.getY(i) * sX, posAttr.getZ(i) * sZ).project(camera);
    sx[i] = (p.x * 0.5 + 0.5) * renderW;
    sy[i] = (-p.y * 0.5 + 0.5) * renderH;
    sz[i] = p.z;
    if (nrmAttr) {
      nrm.set(nrmAttr.getX(i), nrmAttr.getY(i), nrmAttr.getZ(i));
      // TWO-SIDED lighting (DoubleSide): flip the normal to face the camera
      // before shading. A cutaway exposes CONCAVE inner walls + cut faces whose
      // baked normals point AWAY from the lens; without the flip their n·L and
      // n·V collapse to ~0 → the curved grey bore reads flat AND its shading
      // runs reversed vs the outer skin. The convex outer already faces the
      // camera (n·V≥0) so it's untouched.
      if (nrm.dot(V) < 0) nrm.negate();
      // ambient floor + rotatable key highlight + constant camera headlight.
      sh[i] = Math.min(
        1,
        AMBIENT + KEY * Math.max(0, nrm.dot(L)) + FILL * Math.max(0, nrm.dot(V)),
      );
    } else {
      sh[i] = 1; // no normals → flat-bright (shouldn't happen post-bake-fix)
    }
    cr[i] = colAttr ? colAttr.getX(i) : DEF_R;
    cg[i] = colAttr ? colAttr.getY(i) : DEF_G;
    cb[i] = colAttr ? colAttr.getZ(i) : DEF_B;
  }

  // Triangle vertex indices (indexed or sequential non-indexed).
  const a = new Int32Array(triN), b = new Int32Array(triN), c = new Int32Array(triN);
  for (let t = 0; t < triN; t++) {
    if (idx) { a[t] = idx.getX(3 * t); b[t] = idx.getX(3 * t + 1); c[t] = idx.getX(3 * t + 2); }
    else { a[t] = 3 * t; b[t] = 3 * t + 1; c[t] = 3 * t + 2; }
  }

  // ── Build the <svg> ──────────────────────────────────────────────────────
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', String(renderW));
  svg.setAttribute('height', String(renderH));
  svg.setAttribute('viewBox', `0 0 ${renderW} ${renderH}`);
  const defs = document.createElementNS(SVG_NS, 'defs');
  svg.appendChild(defs);
  // White background.
  const bgRect = document.createElementNS(SVG_NS, 'rect');
  bgRect.setAttribute('x', '0'); bgRect.setAttribute('y', '0');
  bgRect.setAttribute('width', String(renderW)); bgRect.setAttribute('height', String(renderH));
  bgRect.setAttribute('fill', '#ffffff');
  svg.appendChild(bgRect);

  // GLOBAL painter's sort. We COLLECT every (sub-)triangle here with its own
  // mean NDC depth, then sort the whole list back-to-front and paint once
  // (below). A per-PARENT sort was unreliable for the cutaway: the flat grey
  // cut face stays a few HUGE triangles while the curved red outer subdivides
  // into thousands of tiny ones, and one mean-depth per huge face can't
  // interleave correctly with the small ones → red bled over the grey bore
  // (inner/outer mis-occluded). Sorting every emitted triangle individually
  // fixes it. `grad` is undefined for a flat fill.
  let gid = 0;
  const draws: { z: number; poly: SVGElement; grad?: SVGElement }[] = [];
  // Emit ONE screen-space triangle as an exact 2-stop Gouraud gradient (flat
  // fill when its 3 shades are ~equal or it's degenerate). `z` = its mean NDC
  // depth (for the global sort). Returns 1 if it drew, else 0.
  function appendTri(
    ax: number, ay: number, bx: number, by: number, cx: number, cy: number,
    s0: number, s1: number, s2: number, br0: number, bg0: number, bl0: number,
    z: number,
  ): number {
    // Mute the base toward the lit 3D tone (see `mute`) before shading.
    const [br, bgc, bl] = mute(br0, bg0, bl0);
    // Signed screen area×2 (== the 3×3 determinant for the gradient solve).
    const det = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (!Number.isFinite(det) || Math.abs(det) < 1e-7) return 0; // degenerate
    const poly = document.createElementNS(SVG_NS, 'polygon');
    poly.setAttribute(
      'points',
      `${ax.toFixed(2)},${ay.toFixed(2)} ${bx.toFixed(2)},${by.toFixed(2)} ${cx.toFixed(2)},${cy.toFixed(2)}`,
    );
    // The 3 corner shades define a plane s(x,y)=A·x+B·y+C over screen coords.
    // Solve A,B (the screen-space gradient ∇s) from the 2×2 system:
    //   s1-s0 = A(bx-ax)+B(by-ay)
    //   s2-s0 = A(cx-ax)+B(cy-ay)
    const A = ((s1 - s0) * (cy - ay) - (s2 - s0) * (by - ay)) / det;
    const B = ((bx - ax) * (s2 - s0) - (cx - ax) * (s1 - s0)) / det;
    const gmag = Math.hypot(A, B);
    if (gmag < 1e-6) {
      // ∇s≈0 → uniformly lit → flat fill at that shade (the common flat-face
      // case, and the no-op case after subdivision shrinks the shade range).
      poly.setAttribute('fill', rgbHex(br * s0, bgc * s0, bl * s0));
      draws.push({ z, poly });
      return 1;
    }
    // Unit gradient direction. Project the 3 vertices onto it: shade is a
    // monotonic-linear function of that projection (s = gmag·tproj + const),
    // so the min/max-projected corners carry the min/max shade. A gradient
    // line between those two points reproduces s EXACTLY across the triangle.
    const gx = A / gmag, gy = B / gmag;
    const ta = ax * gx + ay * gy, tb = bx * gx + by * gy, tc = cx * gx + cy * gy;
    let tlo = ta, slo = s0, thi = ta, shi = s0;
    if (tb < tlo) { tlo = tb; slo = s1; }  if (tb > thi) { thi = tb; shi = s1; }
    if (tc < tlo) { tlo = tc; slo = s2; }  if (tc > thi) { thi = tc; shi = s2; }
    if (thi - tlo < 1e-4) {
      poly.setAttribute('fill', rgbHex(br * s0, bgc * s0, bl * s0));
      draws.push({ z, poly });
      return 1;
    }
    const grad = document.createElementNS(SVG_NS, 'linearGradient');
    const id = `g${gid++}`;
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
    draws.push({ z, poly, grad });
    return 1;
  }

  // PHONG REFINEMENT (no re-bake). Plain Gouraud samples the shade only at the
  // bake's vertices, so on a COARSE curve (32-seg) the highlight — which peaks
  // mid-face — reads flat and pulses as the light turns. We fix it at emit
  // time: where the surface curves, subdivide the triangle in barycentric
  // space and sample the INTERPOLATED-then-renormalised normal (true Phong) at
  // each sub-point. So shading fidelity tracks the normal field, not the
  // triangle count — a coarse bake shades like a fine one. The bake, the edge
  // outline, and every other pane stay coarse/cheap. Flat faces (cut plane,
  // shoulders) have ~0 normal spread → K=1 → zero extra polygons.
  const KMAX = 6;            // cap subdivision so the SVG can't explode
  const TARGET = 0.05;       // ~2.9° per sub-step — finer than the eye resolves
  const SUBDIV_PX = 10;      // min on-screen sub-triangle edge (px) — see kScreen below
  const EMIT_BUDGET = 16000; // ceiling on emitted polys (SVG tab is used rarely)
  let emitted = 0;
  const Pa = new THREE.Vector3(), Pb = new THREE.Vector3(), Pc = new THREE.Vector3();
  const Na = new THREE.Vector3(), Nb = new THREE.Vector3(), Nc = new THREE.Vector3();
  const Pg = new THREE.Vector3(), Ng = new THREE.Vector3();
  // TWO-SIDED: flip the (Phong-interpolated) normal toward the camera so
  // concave inner / cut faces light like the outer skin (nv<0 → use −n).
  const shadeOf = (n: THREE.Vector3) => {
    const nv = n.dot(V);
    const nl = nv < 0 ? -n.dot(L) : n.dot(L);
    return Math.min(1, AMBIENT + KEY * Math.max(0, nl) + FILL * Math.abs(nv));
  };

  for (let t = 0; t < triN; t++) {
    const ia = a[t], ib = b[t], ic = c[t];
    // Base colour for THIS face = vertex a's colour (the cutaway bakes one flat
    // colour per face — all 3 verts equal — so vertex a IS the face colour).
    const br = cr[ia], bgc = cg[ia], bl = cb[ia];
    const zTri = (sz[ia] + sz[ib] + sz[ic]) / 3; // face mean depth (sort key)

    if (flatFill) {
      // Monster mesh → one flat fill per face at the mean shade (no gradient,
      // no subdivision) so the SVG stays bounded.
      const s = (sh[ia] + sh[ib] + sh[ic]) / 3;
      const [mr, mg, mb] = mute(br, bgc, bl);
      const ax = sx[ia], ay = sy[ia], bx = sx[ib], by = sy[ib], cx = sx[ic], cy = sy[ic];
      const det = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (!Number.isFinite(det) || Math.abs(det) < 1e-7) continue;
      const poly = document.createElementNS(SVG_NS, 'polygon');
      poly.setAttribute('points', `${ax.toFixed(2)},${ay.toFixed(2)} ${bx.toFixed(2)},${by.toFixed(2)} ${cx.toFixed(2)},${cy.toFixed(2)}`);
      poly.setAttribute('fill', rgbHex(mr * s, mg * s, mb * s));
      draws.push({ z: zTri, poly });
      emitted++;
      continue;
    }

    // Subdivision level K = how finely to Phong-sample this face. Two caps:
    //   (1) NORMAL spread — how much the surface curves across the face.
    //   (2) SCREEN size  — never split below ~SUBDIV_PX px. Banding only shows
    //       on LARGE faces; subdividing a tiny triangle just multiplies DOM
    //       nodes for nothing. This is the main speed lever: a dense/twisted
    //       bake (g_star, dp_joint — thousands of small tris) stops exploding
    //       the fill count, while a coarse bake (few big tris) still refines.
    let K = 1;
    if (nrmAttr) {
      Na.set(nrmAttr.getX(ia), nrmAttr.getY(ia), nrmAttr.getZ(ia));
      Nb.set(nrmAttr.getX(ib), nrmAttr.getY(ib), nrmAttr.getZ(ib));
      Nc.set(nrmAttr.getX(ic), nrmAttr.getY(ic), nrmAttr.getZ(ic));
      const dmin = Math.min(Na.dot(Nb), Nb.dot(Nc), Na.dot(Nc));
      const spread = Math.acos(Math.max(-1, Math.min(1, dmin)));
      K = Math.max(1, Math.min(KMAX, Math.ceil(spread / TARGET)));
      // cap by on-screen size (longest projected edge / SUBDIV_PX)
      const ax = sx[ia], ay = sy[ia], bx = sx[ib], by = sy[ib], cx = sx[ic], cy = sy[ic];
      const maxEdge = Math.max(
        Math.hypot(bx - ax, by - ay),
        Math.hypot(cx - bx, cy - by),
        Math.hypot(ax - cx, ay - cy),
      );
      K = Math.min(K, Math.max(1, Math.floor(maxEdge / SUBDIV_PX)));
      if (emitted + K * K > EMIT_BUDGET) K = 1; // budget guard
    }

    if (K <= 1) {
      // Flat enough (or no normals) → one gradient from the corner shades.
      emitted += appendTri(
        sx[ia], sy[ia], sx[ib], sy[ib], sx[ic], sy[ic],
        sh[ia], sh[ib], sh[ic], br, bgc, bl, zTri,
      );
      continue;
    }

    // Sample a barycentric grid: row i (i=0..K) holds points j=0..K-i, with
    // weights wa=(K-i-j)/K, wb=i/K, wc=j/K. Interpolate the LOCAL position
    // (→ reproject, perspective-correct, keeping NDC z for the sort) and the
    // normal (→ renormalise → shade).
    Pa.set(posAttr.getX(ia), posAttr.getY(ia), posAttr.getZ(ia));
    Pb.set(posAttr.getX(ib), posAttr.getY(ib), posAttr.getZ(ib));
    Pc.set(posAttr.getX(ic), posAttr.getY(ic), posAttr.getZ(ic));
    const gpx: number[] = [], gpy: number[] = [], gpz: number[] = [], gps: number[] = [];
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
        gps[gi] = shadeOf(Ng);
        gi++;
      }
    }
    // Stitch the grid into up/down sub-triangles and emit each as a gradient.
    for (let i = 0; i < K; i++) {
      const r0 = rowStart[i], r1 = rowStart[i + 1];
      for (let j = 0; j < K - i; j++) {
        const p00 = r0 + j, p01 = r0 + j + 1, p10 = r1 + j;
        emitted += appendTri(
          gpx[p00], gpy[p00], gpx[p01], gpy[p01], gpx[p10], gpy[p10],
          gps[p00], gps[p01], gps[p10], br, bgc, bl,
          (gpz[p00] + gpz[p01] + gpz[p10]) / 3,
        );
        if (j < K - i - 1) {
          const p11 = r1 + j + 1;
          emitted += appendTri(
            gpx[p01], gpy[p01], gpx[p11], gpy[p11], gpx[p10], gpy[p10],
            gps[p01], gps[p11], gps[p10], br, bgc, bl,
            (gpz[p01] + gpz[p11] + gpz[p10]) / 3,
          );
        }
      }
    }
  }
  const emitCount = emitted;

  // Paint the collected triangles back-to-front (far first → near on top).
  draws.sort((u, v) => v.z - u.z);
  for (const dr of draws) {
    if (dr.grad) defs.appendChild(dr.grad);
    svg.appendChild(dr.poly);
  }

  // Edge outline — black crease/silhouette lines at a 20° threshold (matches
  // the 3D pane's <Edges thresholdAngle={20}>), drawn ON TOP of the fills. No
  // HLR — all creases draw, fine for a technical drawing. Gated on showEdges.
  if (showEdges) {
    const eg = new THREE.EdgesGeometry(geo, 20);
    const ep = eg.getAttribute('position') as THREE.BufferAttribute;
    const segs = Math.floor(ep.count / 2);
    const pe = new THREE.Vector3();
    let d = '';
    for (let s = 0; s < segs; s++) {
      const i0 = 2 * s, i1 = i0 + 1;
      pe.set(ep.getX(i0) * sX, ep.getY(i0) * sX, ep.getZ(i0) * sZ).project(camera);
      const x0 = (pe.x * 0.5 + 0.5) * renderW, y0 = (-pe.y * 0.5 + 0.5) * renderH;
      pe.set(ep.getX(i1) * sX, ep.getY(i1) * sX, ep.getZ(i1) * sZ).project(camera);
      const x1 = (pe.x * 0.5 + 0.5) * renderW, y1 = (-pe.y * 0.5 + 0.5) * renderH;
      d += `M${x0.toFixed(2)},${y0.toFixed(2)}L${x1.toFixed(2)},${y1.toFixed(2)}`;
    }
    eg.dispose();
    if (d) {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', d);
      path.setAttribute('stroke', '#000000');
      path.setAttribute('stroke-width', '1');
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(path);
    }
  }

  // Sizing. PERSP: fill the stage, no scroll (viewBox preserves aspect). ORTHO:
  // natural pixel size → overflows the stage → scrollbar.
  svg.style.display = 'block';
  if (fitToContainer) {
    svg.style.width = '100%';
    svg.style.height = '100%';
  } else {
    svg.style.width = `${renderW}px`;
    svg.style.height = `${renderH}px`;
    svg.style.margin = '0 auto';
  }

  return { svg, triCount: triN, emitCount, flatFill };
}
