<script lang="ts">
  /**
   * PrimitiveSvgView — render a baked part's geometry as a scalable, vector
   * <svg> using a CUSTOM per-triangle GOURAUD emitter. Self-contained "Route 1"
   * of docs/plans/svg-geometry-tab.md — a crisp, documentation-ready drawing of
   * the current part that downloads as a `.svg`.
   *
   * PROP CONTRACT
   * -------------
   *   meshJson : SerializedComponentResult | null
   *       The mesh-JSON `{ full, cutVC }` pair that `mesh-serial`'s
   *       `deserializeComponentResult` consumes (positions + per-vertex
   *       normals/colors, non-indexed). PREFERRED input — decouples this view
   *       from the bake (no re-baking here). `cutVC` carries the per-vertex
   *       red-outer / grey-bore cutaway colours; `full` is the solid mesh.
   *       Pass `null` (or an empty pair) and the view shows a graceful
   *       placeholder.
   *   name : string
   *       Title shown in the toolbar + the download filename (`${name}.svg`).
   *   active : boolean
   *       Only render when true (mirrors the active-tab-only WebGL discipline).
   *       When false the <svg> is detached — nothing renders, no leak.
   *
   * The component exposes nothing else. The camera is read from the shared
   * `scene` store (scene-state.svelte.ts, READ-ONLY here): camera position from
   * `scene.cam`, look-at from `scene.partCenter` (+ `scene.zFocus`), the
   * view-only `scene.xScale` / `scene.zScale` exaggeration, and
   * `scene.showCutaway` to pick `cutVC` vs `full`. Z-down convention: up =
   * [0, 0, -1], mirroring PrimitiveDualScene.
   *
   * SHADING — GOURAUD from the baked per-vertex `normal` attribute. We do NOT
   * use three's SVGRenderer: it averages each face to ONE flat fill and discards
   * the 3 vertex shades, so a revolved part BANDS (one flat fill per triangle).
   * Instead we project every vertex OURSELVES and, per vertex, compute a shade
   * `s = ambient + key·max(0, n·L) + fill·max(0, n·V)` from the (now-correct)
   * per-vertex normal — so the shade follows the actual surface everywhere
   * (straight cylinders, stepped shoulders, splined profiles). The `fill` is a
   * constant camera-side headlight so a viewer-facing surface never blacks out
   * when the key swings away. Per triangle we emit one
   * `<linearGradient gradientUnits="userSpaceOnUse">` along the screen-space
   * shade gradient ∇s, spanning the triangle, with 2 stops = baseColour×s at the
   * dark and bright corners. Coincident vertices on a shared edge carry the SAME
   * smooth normal ⇒ identical shade ⇒ neighbouring gradients match along the
   * shared edge ⇒ continuous, smooth, NO banding even at 32-seg. A single
   * light-angle slider spins L about the view so the highlight sweeps.
   */
  import * as THREE from 'three';
  import { scene } from '$lib/shared/scene-state.svelte';
  import {
    deserializeComponentResult,
    type SerializedComponentResult,
  } from '$lib/cad/mesh-serial';

  let {
    meshJson = null,
    name = 'part',
    active = false,
    res = 'coarse',
    onSetRes = undefined,
    busy = false,
  }: {
    meshJson?: SerializedComponentResult | null;
    name?: string;
    active?: boolean;
    /** Bake resolution shown in the toolbar toggle. 'coarse' = 32-segment bake
     *  (default, fast/light), 'high' = full 256. The actual bake (segments) is
     *  driven by the parent via onSetRes — this component only renders the
     *  toggle + the mesh it's handed. */
    res?: 'coarse' | 'high';
    onSetRes?: (v: 'coarse' | 'high') => void;
    /** Parent is re-baking at a new resolution → show a hint. */
    busy?: boolean;
  } = $props();

  // Above this many triangles one <linearGradient> def PER triangle balloons the
  // SVG, so we fall back to a single FLAT fill per face (still painter-sorted).
  // Coarse (32-seg) parts sit well under this — the gradient path is the target.
  const HIGH_TRI = 4000;

  const SVG_NS = 'http://www.w3.org/2000/svg';

  // Lighting terms. s = AMBIENT + KEY·max(0, n·L) + FILL·max(0, n·V), clamped to
  // 1. AMBIENT is the flat floor; KEY is the rotatable highlight (the slider
  // spins L); FILL is a constant CAMERA-SIDE headlight so a surface that faces
  // the viewer never drops to near-black when the key swings away (without the
  // fill, a dark-red base × ambient-only reads almost black — flagged in test).
  const AMBIENT = 0.25;
  const KEY = 0.55;
  const FILL = 0.28;
  // Default solid-mesh base colour (#cc2222 red); the cutaway mesh carries its
  // own per-vertex red-outer / grey-bore colours.
  const DEF_R = 0.8, DEF_G = 0.133, DEF_B = 0.133;

  // --- rehydrate mesh-JSON → THREE.BufferGeometry pair (only when it changes) ---
  let geos = $derived.by(() =>
    meshJson ? deserializeComponentResult(meshJson) : null,
  );
  function vertCount(g: THREE.BufferGeometry | undefined): number {
    return (g?.getAttribute('position') as THREE.BufferAttribute | undefined)?.count ?? 0;
  }
  let hasGeo = $derived(
    !!geos && (vertCount(geos.full) > 0 || vertCount(geos.cutVC) > 0),
  );

  // --- DOM handles (non-reactive; live across re-renders) ---
  let container = $state<HTMLDivElement | null>(null);
  // The <svg> we built last render (download target; replaced each render).
  let svgEl: SVGSVGElement | null = null;

  // ortho (default) vs persp projection — persisted so the choice sticks across
  // tab/part switches. Ortho is the technical-drawing projection (no foreshorten),
  // which is what an SVG export usually wants.
  let projection = $state<'persp' | 'ortho'>('ortho');
  $effect(() => {
    try {
      const p = localStorage.getItem('ge-svg-projection');
      if (p === 'persp' || p === 'ortho') projection = p;
    } catch { /* localStorage blocked — fine */ }
  });
  function setProjection(p: 'persp' | 'ortho') {
    projection = p;
    try { localStorage.setItem('ge-svg-projection', p); } catch { /* ignore */ }
  }

  // Single light-angle dial (0–360°) — spins the key light L about the view axis
  // so the highlight sweeps across the part. Replaces the old light/rim/cel
  // artificial-shader controls. Persisted so the choice sticks.
  let lightAngle = $state(0);
  $effect(() => {
    try {
      const a = Number(localStorage.getItem('ge-svg-lightangle'));
      if (Number.isFinite(a)) lightAngle = ((a % 360) + 360) % 360;
    } catch { /* localStorage blocked — fine */ }
  });
  function setLightAngle(v: number) {
    lightAngle = v;
    try { localStorage.setItem('ge-svg-lightangle', String(v)); } catch { /* ignore */ }
  }

  let size = $state({ w: 0, h: 0 });
  let hasRendered = $state(false);
  let warnHighPoly = $state(false);
  let triCount = $state(0);
  // Polygons actually written to the SVG — higher than triCount when Phong
  // refinement subdivides curved faces (the cost of the smooth-at-coarse look).
  let emitCount = $state(0);
  let errorMsg = $state<string | null>(null);

  // Observe the stage so the SVG re-renders crisp at the container's size.
  $effect(() => {
    if (!container) return;
    const measure = () => {
      const w = Math.max(0, Math.floor(container!.clientWidth));
      const h = Math.max(0, Math.floor(container!.clientHeight));
      if (w !== size.w || h !== size.h) size = { w, h };
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    return () => ro.disconnect();
  });

  function teardown() {
    if (container) container.replaceChildren();
    svgEl = null;
    hasRendered = false;
  }

  // 0..1 channel → 0..255, clamped.
  function ch(v: number): number {
    return Math.round(Math.max(0, Math.min(1, v)) * 255);
  }
  // base×shade RGB floats → `#rrggbb`.
  function rgbHex(r: number, g: number, b: number): string {
    return `#${((1 << 24) + (ch(r) << 16) + (ch(g) << 8) + ch(b)).toString(16).slice(1)}`;
  }

  function renderToSvg(
    pair: { full: THREE.BufferGeometry; cutVC: THREE.BufferGeometry },
    w: number,
    h: number,
  ) {
    errorMsg = null;

    // Pick cutaway (red outer / grey bore) when toggled + present, else solid.
    const useCut = scene.showCutaway && vertCount(pair.cutVC) > 0;
    const geo = useCut
      ? pair.cutVC
      : vertCount(pair.full) > 0
        ? pair.full
        : null;
    if (!geo) { errorMsg = 'No geometry to render'; return; }

    const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
    const nrmAttr = geo.getAttribute('normal') as THREE.BufferAttribute | undefined;
    const colAttr = geo.getAttribute('color') as THREE.BufferAttribute | undefined;
    const vCount = posAttr.count;
    const idx = geo.index;

    // Triangle count → perf guard + flat-fill fallback for monster meshes.
    const triN = idx ? Math.floor(idx.count / 3) : Math.floor(vCount / 3);
    triCount = triN;
    warnHighPoly = triN > HIGH_TRI;
    const flatFill = triN > HIGH_TRI;
    if (flatFill) {
      console.warn(
        `[PrimitiveSvgView] ${triN} tris > ${HIGH_TRI}: flat per-face fill (no gradients)`,
      );
    }

    // View-only exaggeration [xScale, xScale, zScale] — mirrors PrimitiveDualScene
    // so the SVG frames long thin tools the same way the 3D pane does. Applied to
    // POSITIONS only (lighting stays in unscaled local space, see below).
    const sX = scene.xScale, sZ = scene.zScale;

    // Camera. Built FIRST so we can project ourselves. Z-down (up = [0,0,-1]).
    // renderW/renderH = the SVG's pixel size. PERSP fills the container (fit, no
    // scroll). ORTHO renders at the part's NATURAL proportions (a long tool →
    // tall SVG) so the stage scrolls and you can read it at size.
    let camera: THREE.Camera;
    let renderW = Math.max(1, w);
    let renderH = Math.max(1, h);
    let fitToContainer = true;
    if (projection === 'ortho') {
      // ORTHOGRAPHIC = a straight perpendicular technical ELEVATION. We IGNORE
      // the orbited 3D camera and look dead-on perpendicular to the Z (drilling)
      // axis at the centreline (x=0, y=0), centred on the part's Z span so the
      // whole length frames. Z runs vertically; parallel edges stay parallel.
      geo.computeBoundingBox();
      const bb = geo.boundingBox;
      const halfX = bb ? 0.5 * (bb.max.x - bb.min.x) * sX : 1;
      const halfY = bb ? 0.5 * (bb.max.y - bb.min.y) * sX : 1;
      const padH = (Math.hypot(halfX, halfY) || 1) * 1.05;   // radial → horizontal
      const halfZ = bb ? 0.5 * (bb.max.z - bb.min.z) * sZ : 1;
      const padV = (Math.max(halfZ, 0.001)) * 1.05;          // z half-span → vertical
      const czWorld = bb ? 0.5 * (bb.min.z + bb.max.z) * sZ : 0;
      // Render at the part's true V/H aspect, width pinned to the container.
      // Cap the longest side so a very long tool doesn't produce a monster SVG.
      renderW = Math.max(1, w);
      renderH = Math.max(1, Math.round(renderW * (padV / padH)));
      const MAXPX = 8000;
      if (renderH > MAXPX) { renderH = MAXPX; renderW = Math.max(1, Math.round(MAXPX * (padH / padV))); }
      fitToContainer = false;
      camera = new THREE.OrthographicCamera(-padH, padH, padV, -padV, 0.1, 100000);
      camera.up.set(0, 0, -1);
      camera.position.set(0, 1000, czWorld); // +Y axis; ortho → distance is cosmetic
      camera.lookAt(0, 0, czWorld);
    } else {
      // PERSPECTIVE: mirror the 3D pane — fov 45, the live (orbitable) camera.
      camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100000);
      camera.up.set(0, 0, -1);
      camera.position.set(scene.cam.x, scene.cam.y, scene.cam.z);
      camera.lookAt(
        scene.partCenter.x,
        scene.partCenter.y,
        scene.partCenter.z + scene.zFocus,
      );
    }
    // We project by hand (camera isn't added to a Scene) → refresh its matrices.
    camera.updateMatrixWorld(true);
    (camera as THREE.PerspectiveCamera | THREE.OrthographicCamera).updateProjectionMatrix();

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
      s0: number, s1: number, s2: number, br: number, bgc: number, bl: number,
      z: number,
    ): number {
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
    const EMIT_BUDGET = 24000; // ceiling on emitted polys (SVG tab is used rarely)
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
        const ax = sx[ia], ay = sy[ia], bx = sx[ib], by = sy[ib], cx = sx[ic], cy = sy[ic];
        const det = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
        if (!Number.isFinite(det) || Math.abs(det) < 1e-7) continue;
        const poly = document.createElementNS(SVG_NS, 'polygon');
        poly.setAttribute('points', `${ax.toFixed(2)},${ay.toFixed(2)} ${bx.toFixed(2)},${by.toFixed(2)} ${cx.toFixed(2)},${cy.toFixed(2)}`);
        poly.setAttribute('fill', rgbHex(br * s, bgc * s, bl * s));
        draws.push({ z: zTri, poly });
        emitted++;
        continue;
      }

      // How far does the normal turn across this face? → subdivision level K.
      let K = 1;
      if (nrmAttr) {
        Na.set(nrmAttr.getX(ia), nrmAttr.getY(ia), nrmAttr.getZ(ia));
        Nb.set(nrmAttr.getX(ib), nrmAttr.getY(ib), nrmAttr.getZ(ib));
        Nc.set(nrmAttr.getX(ic), nrmAttr.getY(ic), nrmAttr.getZ(ic));
        const dmin = Math.min(Na.dot(Nb), Nb.dot(Nc), Na.dot(Nc));
        const spread = Math.acos(Math.max(-1, Math.min(1, dmin)));
        K = Math.max(1, Math.min(KMAX, Math.ceil(spread / TARGET)));
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
    emitCount = emitted;

    // Paint the collected triangles back-to-front (far first → near on top).
    draws.sort((u, v) => v.z - u.z);
    for (const dr of draws) {
      if (dr.grad) defs.appendChild(dr.grad);
      svg.appendChild(dr.poly);
    }

    // Edge outline — black crease/silhouette lines at a 20° threshold (matches
    // the 3D pane's <Edges thresholdAngle={20}>), drawn ON TOP of the fills. No
    // HLR — all creases draw, fine for a technical drawing. Gated on showEdges.
    if (scene.showEdges) {
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

    // Mount / refresh.
    if (container) container.replaceChildren(svg);
    svgEl = svg;
    svg.style.display = 'block';
    if (fitToContainer) {
      // PERSP: fill the stage, no scroll (viewBox preserves aspect).
      svg.style.width = '100%';
      svg.style.height = '100%';
    } else {
      // ORTHO: natural pixel size → overflows the stage → scrollbar.
      svg.style.width = `${renderW}px`;
      svg.style.height = `${renderH}px`;
      svg.style.margin = '0 auto';
    }
    hasRendered = true;
  }

  // Render whenever active + geometry present, re-firing on camera / partCenter /
  // cutaway / edges / view-scale / light-angle / size changes. Inactive → tear
  // down (nothing rendering for a hidden tab).
  $effect(() => {
    // Track reactive deps explicitly so the effect re-runs on each.
    const isActive = active;
    const pair = geos;
    const w = size.w, h = size.h;
    // camera / view deps
    void scene.cam.x; void scene.cam.y; void scene.cam.z;
    void scene.partCenter.x; void scene.partCenter.y; void scene.partCenter.z;
    void scene.zFocus; void scene.xScale; void scene.zScale;
    void scene.showCutaway; void scene.showEdges;
    void projection;
    void lightAngle;

    if (!isActive) { teardown(); return; }
    if (!container || !pair || w === 0 || h === 0) return;
    if (vertCount(pair.full) === 0 && vertCount(pair.cutVC) === 0) {
      errorMsg = null;
      return;
    }
    try {
      renderToSvg(pair, w, h);
    } catch (e) {
      errorMsg = e instanceof Error ? e.message : String(e);
    }
  });

  // Dispose rehydrated geometry when this view's mesh-JSON goes away / unmount.
  $effect(() => {
    const pair = geos;
    return () => {
      pair?.full?.dispose?.();
      pair?.cutVC?.dispose?.();
    };
  });

  function downloadSvg() {
    if (!svgEl) return;
    let xml = svgEl.outerHTML;
    if (!xml.includes('xmlns=')) {
      xml = xml.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
    }
    const blob = new Blob(
      ['<?xml version="1.0" encoding="UTF-8"?>\n', xml],
      { type: 'image/svg+xml;charset=utf-8' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(name || 'part').replace(/[^\w.-]+/g, '_')}.svg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
</script>

<div class="svg-view">
  <div class="svg-toolbar">
    <span class="svg-title" title={name}>{name || 'part'}</span>
    {#if hasRendered && triCount > 0}
      <span class="svg-tris">{triCount.toLocaleString()} tris{emitCount > triCount
        ? ` · ${emitCount.toLocaleString()} fills`
        : ''}{busy ? ' · re-baking…' : ''}</span>
    {/if}
    <!-- Resolution toggle — coarse (32-seg, default, fast) vs high (full 256).
         Drives the parent's bake via onSetRes. -->
    {#if onSetRes}
      <div class="svg-proj" role="group" aria-label="Resolution">
        <button class="svg-proj-btn" class:on={res === 'coarse'}
          title="Coarse — 32-segment bake (fast, light; the right choice for a vector drawing)"
          onclick={() => onSetRes?.('coarse')}>coarse</button>
        <button class="svg-proj-btn" class:on={res === 'high'}
          title="High — full 256-segment bake (smoother circles, heavier SVG)"
          onclick={() => onSetRes?.('high')}>high</button>
      </div>
    {/if}
    <!-- Projection toggle — ortho (default, technical drawing) vs persp. -->
    <div class="svg-proj" role="group" aria-label="Projection">
      <button class="svg-proj-btn" class:on={projection === 'persp'}
        title="Perspective projection" onclick={() => setProjection('persp')}>persp</button>
      <button class="svg-proj-btn" class:on={projection === 'ortho'}
        title="Orthographic projection — parallel edges, no foreshortening (technical drawing)"
        onclick={() => setProjection('ortho')}>ortho</button>
    </div>
    <!-- Light-angle dial — spins the key light L around the view so the Gouraud
         highlight sweeps across the part. -->
    <div class="svg-dials" title="Light angle — spin the key light around the view">
      <label class="svg-dial"><span>light {Math.round(lightAngle)}°</span>
        <input type="range" min="0" max="360" step="1" value={lightAngle}
          oninput={(e) => setLightAngle(Number((e.currentTarget as HTMLInputElement).value))} /></label>
    </div>
    <button class="svg-dl" onclick={downloadSvg} disabled={!hasRendered}>
      ⤓ .svg
    </button>
  </div>

  {#if warnHighPoly}
    <div class="svg-warn">
      high-poly — flat per-face fill (no Gouraud gradients above {HIGH_TRI.toLocaleString()}
      tris); bake at a lower segment count for a smooth, light drawing
    </div>
  {/if}

  <div class="svg-stage">
    <!-- Dedicated container we own (replaceChildren) — no Svelte children inside
         it, so overlays live as siblings. -->
    <div class="svg-canvas" bind:this={container}></div>

    {#if active && !hasGeo}
      <div class="svg-overlay">No geometry to render</div>
    {:else if errorMsg}
      <div class="svg-overlay">SVG render failed: {errorMsg}</div>
    {/if}
  </div>
</div>

<style>
  .svg-view {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-height: 0;
    background: #ffffff;
  }
  .svg-toolbar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.35rem 0.6rem;
    border-bottom: 1px solid #e3e3e3;
    flex: 0 0 auto;
  }
  .svg-title {
    font-weight: 600;
    font-size: 0.85rem;
    color: #222;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .svg-tris {
    font-size: 0.7rem;
    color: #888;
    white-space: nowrap;
  }
  .svg-proj {
    margin-left: auto;
    display: inline-flex;
    border: 1px solid #bbb;
    border-radius: 4px;
    overflow: hidden;
  }
  .svg-proj-btn {
    font-size: 0.72rem;
    padding: 0.2rem 0.5rem;
    border: 0;
    background: #fafafa;
    color: #555;
    cursor: pointer;
  }
  .svg-proj-btn + .svg-proj-btn { border-left: 1px solid #ddd; }
  .svg-proj-btn:hover { background: #f0f0f0; }
  .svg-proj-btn.on { background: #0369a1; color: #fff; }
  .svg-dials { display: inline-flex; align-items: center; gap: 8px; }
  .svg-dial { display: inline-flex; align-items: center; gap: 4px; font: 600 10px Arial; color: #57534e; }
  .svg-dial span { white-space: nowrap; }
  .svg-dial input[type="range"] { width: 88px; accent-color: #0369a1; }
  .svg-dl {
    font-size: 0.78rem;
    padding: 0.2rem 0.55rem;
    border: 1px solid #bbb;
    border-radius: 4px;
    background: #fafafa;
    cursor: pointer;
  }
  .svg-dl:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .svg-dl:not(:disabled):hover {
    background: #f0f0f0;
  }
  .svg-warn {
    flex: 0 0 auto;
    padding: 0.3rem 0.6rem;
    font-size: 0.72rem;
    color: #8a5a00;
    background: #fff4d6;
    border-bottom: 1px solid #f0e0b0;
  }
  .svg-stage {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;        /* scroll when the SVG (ortho, natural size) overflows */
    background: #ffffff;
  }
  .svg-canvas {
    /* Fills the stage for perspective (svg = 100%); grows with the svg's
       natural pixel size for ortho so the stage scrolls. */
    position: relative;
    width: 100%;
    min-height: 100%;
  }
  .svg-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #999;
    font-size: 0.85rem;
    pointer-events: none;
  }
</style>
