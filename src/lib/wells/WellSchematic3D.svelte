<script lang="ts">
  /**
   * WellSchematic3D — the ported SVTC well-diagram scene, adapted for cadtrain.
   *
   * Renders a WSON as an engineering half-section 3D schematic:
   *   • open holes  → cutCylinder (translucent bore)
   *   • casings     → cutTube (steel annulus, OD/ID)
   *   • cement      → cutTube (beige speckled annulus in the OH↔casing gap)
   *   • tubing      → cutTube (gold, from the completion string)
   *   • perforations→ cutSphere markers at perf midpoints
   *   • completions → parametric registry builder (Baker packer) with a plain
   *                   cylinder FALLBACK for unknown tool_comp
   * All geometry is BUILT in manifold-3d (watertight) then warped along the
   * survey trajectory via the parallel-transport `warpGeometry`.
   *
   * SCALE PIPELINE (memory `well_schematic_3d_first`, CLAUDE.md): raw MD → DTX
   * (depth-only emphasis of cluttered zones) → warp along the survey → ×zScale.
   * `diaScale` is the OPTIONAL radial exaggeration (view dial), NOT baked into
   * the model — depths stay true (metres), diameters true (inches) × diaScale.
   *
   * This is SCENE CONTENT — mount it inside a parent Threlte `<Canvas>` (as the
   * /wells route does with WellScene). SSR is off for /wells so Three/Threlte
   * evaluate client-side only; Manifold WASM is lazy-loaded in onMount.
   *
   * Ported from SVTC `src/lib/apps/wson/Wson3DScene.svelte` (dgeo curtain,
   * annotations, perf-spurs and debug cutters intentionally dropped — not part
   * of the well-schematic core).
   */
  import { T, useThrelte } from '@threlte/core';
  import { OrbitControls, Edges, HTML } from '@threlte/extras';
  import { onDestroy, onMount } from 'svelte';
  import * as THREE from 'three';
  import type { Wson } from './wson';
  import { buildWellDirection, sampleCentreline, type WellDirection } from './threeD';
  import {
    initManifold, cutCylinder, cutTube, cutSphere, warpGeometry,
    beginWellTiming, readWellTiming, type WellBuildTiming,
  } from './threeD/manifoldCut';
  import { getBuilder, buildCached } from './threeD/parametric';
  import { autoNodes, lerpDTX, type DtxNode } from './dtx';
  import { iconFor } from './element-icons';

  let {
    wson,
    diaScale = 6,
    zScale = 1,
    dtx = true,
    cutaway = true,
    cutAxis = 'x',
    cutAzimuth = 0,
    directional = true,
    layers = { showOpenHole: true, showCasing: true, showCement: true, showTubing: true, showCompletions: true, showPerforations: true },
    whiteBg = false,
    labelAnchor = 'right',
    onCameraMove,
    onDepthMap,
    onBuildTiming,
  }: {
    wson: Wson;
    /** Radial exaggeration (inches → scene units). Optional view dial. */
    diaScale?: number;
    /** Depth stretch applied AFTER DTX (SVTC's yScale). */
    zScale?: number;
    /** Apply DTX depth emphasis (expands cluttered intervals). */
    dtx?: boolean;
    cutaway?: boolean;
    cutAxis?: 'x' | 'y' | 'z';
    cutAzimuth?: number;
    /** false → straight vertical (ignore the survey), mirrors the 2D toggle. */
    directional?: boolean;
    layers?: {
      showOpenHole?: boolean; showCasing?: boolean; showCement?: boolean;
      showTubing?: boolean; showCompletions?: boolean; showPerforations?: boolean;
    };
    /** Render the 3D scene itself on WHITE (schematic-on-paper look). When
     *  false the scene background stays transparent so the CSS stage gradient
     *  shows through — the dark aesthetic. */
    whiteBg?: boolean;
    /** In-diagram label bank side. `'right'`/`'left'` hangs a labella-style,
     *  de-overlapped bank of element chips (icon + text, leader-lined back to
     *  each element) on that side of the wellbore; `'off'` hides it. VIEW-ONLY. */
    labelAnchor?: 'left' | 'right' | 'off';
    onCameraMove?: (pos: { x: number; y: number; z: number }) => void;
    /** Share the SINGLE depth-scale (raw MD → display depth) so an overlay
     *  ruler stays in lockstep with the shells — never re-derive it. */
    onDepthMap?: (info: { remap: (md: number) => number; rawTd: number; td: number }) => void;
    /** DIAGNOSTIC — per-rebuild phase timing for the flash badge (see the
     *  `WellBuildTiming` shape). Fired on every geometry rebuild. */
    onBuildTiming?: (t: WellBuildTiming) => void;
  } = $props();

  const { camera, scene, invalidate } = useThrelte();

  let manifoldReady = $state(false);
  onMount(async () => {
    try { await initManifold(); manifoldReady = true; }
    catch (e) { console.error('[WellSchematic3D] manifold init failed', e); }
  });

  // White SCENE background — set the Three scene's clear background to white so
  // the schematic reads as a drawing on paper (the black <Edges> stay legible).
  // null → transparent, letting the route's dark CSS gradient show through.
  let _white: THREE.Color | null = null;
  $effect(() => {
    if (whiteBg) {
      _white ??= new THREE.Color('#ffffff');
      scene.background = _white;
    } else if (scene.background === _white) {
      scene.background = null;
    }
    invalidate();
  });
  onDestroy(() => { if (scene.background === _white) scene.background = null; });

  const cutActive = $derived(cutaway && manifoldReady);
  // Cutaway is REQUESTED but Manifold is still initialising. In this window we
  // must NOT fall back to the plain (un-cut) solid builders — that renders a
  // full SOLID tube and reports "0 CSG", which looks exactly like a broken
  // cutaway (worst on heavy deviated/horizontal wells, whose throwaway-solid
  // pass is the most expensive so the mislead is most visible). Skip building
  // until the cut can actually run; the derived re-fires when manifoldReady flips.
  const cutPending = $derived(cutaway && !manifoldReady);

  const rawTd = $derived(wson?.meta?.td ?? 1000);

  // ── DTX depth transform ────────────────────────────────────────────────────
  // Emphasis nodes = cluttered zones (completion stack + perf intervals).
  const dtxObj = $derived.by(() => {
    if (!dtx) return null;
    const nodes: DtxNode[] = [];
    for (const c of wson?.completions ?? []) {
      if (Number.isFinite(c.top as number) && Number.isFinite(c.bot as number)) {
        nodes.push({ start: c.top as number, end: c.bot as number });
      }
    }
    for (const p of wson?.perforations ?? []) nodes.push({ start: p.top, end: p.bot });
    return autoNodes(nodes, rawTd);
  });

  /** raw MD → display depth (DTX then ×zScale). The one place scale is applied
   *  so shells + the warped survey stay in the SAME display-depth space. */
  const remap = $derived((md: number) => (dtxObj ? lerpDTX(dtxObj, md) : md) * zScale);
  const td = $derived(remap(rawTd));

  // Publish the depth-scale so a sibling overlay (the depth ruler) can place
  // ticks/labels in the SAME display-depth space — one source of truth.
  $effect(() => { onDepthMap?.({ remap, rawTd, td }); });

  // Survey remapped through the same depth transform so getInterNode()'s
  // sampling matches the shells built at remapped top/bot.
  const remappedProfile = $derived.by(() => {
    const prof = wson?.profile;
    if (!Array.isArray(prof) || prof.length < 2) return null;
    return prof.map((s) => ({ ...s, md: remap(s.md) }));
  });

  const wellDir: WellDirection = $derived(buildWellDirection(directional ? remappedProfile : null, td));

  const profileFingerprint = $derived(JSON.stringify(wson?.profile ?? []) + '|' + td + '|' + zScale + '|' + dtx);
  const geomKey = $derived(`${cutActive}|${cutAxis}|${diaScale}|${directional}|${cutAzimuth}|${profileFingerprint}`);

  const centre = $derived(sampleCentreline(wellDir, 0, td, 20));

  // ── Camera fit (center + fill) ──────────────────────────────────────────────
  // Largest shell radius in SCENE units (od·diaScale/2). Bounds the wellbore's
  // radial girth so the fit box wraps the actual solids, not just the centreline
  // — and doubles as the label-bank lateral offset. Independent of the cutaway
  // so toggling the section never re-frames.
  const radialExtent = $derived.by(() => {
    let maxOd = 0;
    for (const o of wson?.oh ?? []) maxOd = Math.max(maxOd, o.bitSize ?? 0);
    for (const c of wson?.ch ?? []) maxOd = Math.max(maxOd, c.od ?? 0);
    for (const cm of wson?.cementing ?? []) maxOd = Math.max(maxOd, (cm.od ?? 0) * 1.15);
    for (const c of wson?.completions ?? []) maxOd = Math.max(maxOd, c.od ?? 0);
    return Math.max(2, (maxOd * diaScale) / 2);
  });

  const FOV = 40;
  // View direction OFFSET (camera ← target). +X toward the viewer so a +X-normal
  // cutaway faces us; -Y and a slight -Z (shallower) give the 3/4 schematic look.
  const VIEW_DIR = new THREE.Vector3(0.8, -1, -0.3).normalize();

  // Fit the DEVIATED bounding box (centreline expanded by the radial girth) to a
  // sphere, then place the camera so that sphere fills the frame. Works for both
  // vertical (thin deep column) and deviated (real X/Y extent) wells — the box
  // captures whichever dominates, so a horizontal lateral isn't clipped.
  const fit = $derived.by(() => {
    const pts = centre.length >= 2
      ? centre
      : [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, Math.max(1, td))];
    const box = new THREE.Box3().setFromPoints(pts);
    box.expandByScalar(radialExtent);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(1, 0.5 * Math.hypot(size.x, size.y, size.z));
    return { center, radius };
  });

  const cameraPos = $derived.by(() => {
    const { center, radius } = fit;
    // Distance so the bounding sphere subtends the FOV, plus a small margin.
    const dist = (radius / Math.sin((FOV / 2) * (Math.PI / 180))) * 1.12;
    return center.clone().add(VIEW_DIR.clone().multiplyScalar(dist));
  });

  // Re-fit (remount camera + controls) only when the FRAMING changes — the well
  // itself, the trajectory, or the Dia×/Depth× exaggeration (spec A3). Cutaway /
  // axis / azimuth changes and user orbiting keep the current view.
  const fitKey = $derived(`${directional}|${diaScale}|${profileFingerprint}`);

  // ── Colors (0..1 rgb for the vertex-color cut pipeline) ────────────────────
  function rgb(hex: string): number[] {
    const n = parseInt(hex.replace('#', ''), 16);
    return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
  }
  const COL_OH = rgb('#e9d5ff'), COL_CH = rgb('#94a3b8'), COL_CEMENT = rgb('#d6c7a1');
  const COL_TUBING = rgb('#eab308'), COL_PERF = rgb('#ef4444');
  const STYLE_CEMENT_CUT = { cutColor: rgb('#b8a883'), cutVariance: 0.18 };

  function safe<T>(fn: () => T): T | null {
    try { return fn(); } catch (e) { console.warn('[WellSchematic3D] build failed', e); return null; }
  }

  // ── Non-cutaway solids (THREE geometry built straight along Z + warp) ──────
  function solidTubeForRange(top: number, bot: number, radius: number) {
    const len = bot - top;
    if (!(len > 0) || !(radius > 0)) return null;
    const heightSegs = Math.max(20, Math.ceil(len / 5));
    const g = new THREE.CylinderGeometry(radius, radius, len, 48, heightSegs);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0, (top + bot) / 2);
    return warpGeometry(g, wellDir);
  }
  function shellForRange(top: number, bot: number, innerR: number, outerR: number) {
    const len = bot - top;
    if (!(len > 0) || !(outerR > innerR && innerR >= 0)) return null;
    const shape = new THREE.Shape();
    shape.absarc(0, 0, outerR, 0, Math.PI * 2, false);
    const hole = new THREE.Path();
    hole.absarc(0, 0, innerR, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    const steps = Math.max(20, Math.ceil(len / 5));
    const geo = new THREE.ExtrudeGeometry(shape, { steps, depth: len, bevelEnabled: false, curveSegments: 48 });
    geo.translate(0, 0, top);
    return warpGeometry(geo, wellDir);
  }

  function outerBitAtDepth(md: number): number | null {
    const oh = (wson?.oh ?? []).find((o) => md >= remap(o.top) && md <= remap(o.bot));
    return oh?.bitSize ?? null;
  }
  const EPS_IN = 0.02;

  // ── Display geometry per layer — built as ONE timed pass ────────────────────
  // The whole shell/solid + cutaway-boolean + warp + mesh-extraction build is
  // the /wells perf hot path. Compute every layer inside a single derived so we
  // can bracket a coherent build pass with the manifoldCut phase accumulator and
  // surface a flash badge (pure diagnostic — no behaviour change; the geometry
  // and template outputs are identical to the previous per-layer deriveds).
  //
  // ── #42b-A · 3D-FAST bake seam (WellBakePool) ───────────────────────────────
  // This synchronous, main-thread pass is the REFERENCE path. The parallel,
  // off-thread replacement lands via `$lib/wells/well-bake-client`
  // (`bakeWellShells` + `shellJobSpec`), which fans each cutaway shell out to
  // N Manifold workers (`WellBakePool`, byte-identical geometry — the workers
  // call these SAME manifoldCut builders). Wiring it here is the P2 progressive-
  // render swap (docs/plans/wells-build-architecture.md §3d): lift each
  // oh/ch/cement/tubing/perf row into a `ShellElement` (stable `id`), then
  //   const pool = getWellBakePool();
  //   bakeWellShells(pool, elements.map((e)=>shellJobSpec(e, survey)),
  //                  (id,geo)=> built[id]=geo, (id,err)=> failed[id]=err);
  // rendering `{#each elements as el (el.id)}` off a stable `$state` map instead
  // of `{#key geomKey}` (meshes stay mounted; only the geometry swaps as each
  // worker finishes). Kept OUT of this commit because it needs BROWSER
  // verification (progressive render / no-remount / <Edges> rebuild) — the pool,
  // worker + client seam are landed + headless-tested; this is the seam.
  function triCount(g: THREE.BufferGeometry | null | undefined): number {
    if (!g) return 0;
    return g.index ? g.index.count / 3 : (g.attributes.position?.count ?? 0) / 3;
  }
  const _now3d = () => (typeof performance !== 'undefined' ? performance.now() : 0);

  const buildBundle = $derived.by(() => {
    beginWellTiming();
    const t0 = _now3d();

    const oh = (wson?.oh ?? []).map((o) => {
      const top = remap(o.top), bot = remap(o.bot), r = (o.bitSize * diaScale) / 2;
      const geom = cutActive
        ? safe(() => cutCylinder(top, bot, r, cutAxis, COL_OH, {}, wellDir, cutAzimuth))
        : solidTubeForRange(top, bot, r);
      return { geom, label: `${o.bitSize}" OH` };
    }).filter((g) => g.geom);

    const ch = (wson?.ch ?? []).filter((c) => c.type !== 'tubing').map((c) => {
      const od = c.od;
      const id = (typeof c.id === 'number' && c.id > 0 && c.id < od) ? c.id : od * 0.92;
      const top = remap(c.top), bot = remap(c.bot);
      const innerR = (id * diaScale) / 2, outerR = (od * diaScale) / 2;
      const geom = cutActive
        ? safe(() => cutTube(top, bot, innerR, outerR, cutAxis, COL_CH, {}, wellDir, cutAzimuth))
        : shellForRange(top, bot, innerR, outerR);
      return { geom, label: `${c.od}" ${c.grade ?? ''}` };
    }).filter((g) => g.geom);

    const cement = (wson?.cementing ?? []).map((cm) => {
      const top = remap(cm.top), bot = remap(cm.bot);
      const bit = outerBitAtDepth((top + bot) / 2);
      const outer = (bit != null ? bit : cm.od * 1.15) - EPS_IN;
      const inner = cm.od + EPS_IN;
      if (outer <= inner) return { geom: null, label: '' };
      const innerR = (inner * diaScale) / 2, outerR = (outer * diaScale) / 2;
      const geom = cutActive
        ? safe(() => cutTube(top, bot, innerR, outerR, cutAxis, COL_CEMENT, STYLE_CEMENT_CUT, wellDir, cutAzimuth))
        : shellForRange(top, bot, innerR, outerR);
      return { geom, label: `Cement` };
    }).filter((g) => g.geom);

    // Tubing joints — a completion, rendered as a gold tube.
    let tubing: THREE.BufferGeometry | null = null;
    const tb = (wson?.completions ?? []).find((c) => /tubing/i.test(c.description ?? '') && /joints/i.test(c.description ?? ''));
    if (tb && tb.top != null && tb.bot != null) {
      const od = tb.od ?? 2.875, id = od * 0.85;
      const top = remap(tb.top), bot = remap(tb.bot);
      const innerR = (id * diaScale) / 2, outerR = (od * diaScale) / 2;
      // Completion (tubing) → 90° quarter WEDGE cut (270° stays intact) so the
      // jewelry reads whole with a notch to the bore — richer than SVTC's uniform 180°.
      tubing = cutActive
        ? safe(() => cutTube(top, bot, innerR, outerR, cutAxis, COL_TUBING, {}, wellDir, cutAzimuth, 90))
        : shellForRange(top, bot, innerR, outerR);
    }

    // Perforation markers — spheres at perf midpoints (world-placed, not warped).
    const perfs = (wson?.perforations ?? []).map((p) => {
      const midMd = remap((p.top + p.bot) / 2);
      const node = wellDir.getInterNode(midMd);
      if (!node) return null;
      const radius = Math.max(4, ((diaScale * 8.5) / 2) * 0.4);
      const position = new THREE.Vector3(node.pt[0], node.pt[1], node.pt[2]);
      const geom = cutActive ? safe(() => cutSphere(position, radius, cutAxis, COL_PERF)) : null;
      return { position, radius, geom, label: p.label ?? 'Perf' };
    }).filter(Boolean) as Array<{ position: THREE.Vector3; radius: number; geom: THREE.BufferGeometry | null; label: string }>;

    // ── Assemble the diagnostic timing summary for the flash badge ──────────
    const phases = readWellTiming();
    let tris = 0;
    for (const g of oh) tris += triCount(g.geom);
    for (const g of ch) tris += triCount(g.geom);
    for (const g of cement) tris += triCount(g.geom);
    tris += triCount(tubing);
    for (const g of perfs) tris += triCount(g.geom);
    const compCount = (wson?.completions ?? [])
      .filter((c) => !/tubing joints/i.test(c.description ?? '')).length;
    const strings = oh.length + ch.length + cement.length + (tubing ? 1 : 0) + perfs.length + compCount;
    const timing: WellBuildTiming = {
      ...phases,
      total: _now3d() - t0,
      strings,
      tris: Math.round(tris),
      cutActive,
    };
    return { oh, ch, cement, tubing, perfs, timing };
  });

  // Thin aliases so the template reads the same names as before.
  const ohGeoms = $derived(buildBundle.oh);
  const chGeoms = $derived(buildBundle.ch);
  const cementGeoms = $derived(buildBundle.cement);
  const tubingGeom = $derived(buildBundle.tubing);
  const perfMarkers = $derived(buildBundle.perfs);

  // Publish + log the diagnostic timing on every rebuild (dial changes recompute
  // buildBundle → this fires, flashing the badge with the fresh cost).
  $effect(() => {
    const t = buildBundle.timing;
    onBuildTiming?.(t);
    try {
      console.log('[wells-3d]',
        `total ${t.total.toFixed(0)}ms · shell ${t.solid.toFixed(0)} · cutaway ${t.cutaway.toFixed(0)} · ` +
        `warp ${t.warp.toFixed(0)} · mesh ${t.extract.toFixed(0)} · ${t.strings} strings · ` +
        `${t.csgOps} CSG · ${t.builds} solids · ${t.tris.toLocaleString()} tris · cut ${t.cutActive ? 'on' : 'off'}`,
        t);
    } catch {}
  });

  // ── Completion component markers (non-tubing-joints) ───────────────────────
  const CATEGORY_COLOR: Record<string, string> = {
    packer: '#f59e0b', hanger: '#64748b', nipple: '#ef4444',
    mandrel: '#0ea5e9', mule: '#a78bfa', valve: '#dc2626',
  };
  function compColor(desc: string): string {
    const d = desc.toLowerCase();
    if (d.includes('packer')) return CATEGORY_COLOR.packer;
    if (d.includes('hanger')) return CATEGORY_COLOR.hanger;
    if (d.includes('nipple')) return CATEGORY_COLOR.nipple;
    if (d.includes('mandrel')) return CATEGORY_COLOR.mandrel;
    if (d.includes('mule')) return CATEGORY_COLOR.mule;
    if (/scssv|trssv|trsssv/.test(d)) return CATEGORY_COLOR.valve;
    return '#94a3b8';
  }

  const compMarkers = $derived.by(() =>
    (wson?.completions ?? [])
      .filter((c) => !/tubing joints/i.test(c.description ?? ''))
      .map((c) => {
        const top = remap(c.top ?? 0), bot = remap(c.bot ?? ((c.top ?? 0) + 1));
        const node = wellDir.getInterNode((top + bot) / 2);
        if (!node) return null;
        const od = c.od ?? 4;
        const minHeight = Math.max(2, td * 0.005);
        return {
          position: new THREE.Vector3(node.pt[0], node.pt[1], node.pt[2]),
          radius: ((od * diaScale) / 2) * 1.1,
          height: Math.max(minHeight, bot - top),
          color: compColor(c.description ?? ''),
          label: c.description ?? c.tool_comp,
          toolComp: c.tool_comp ?? null,
          top, bot, od, idIn: Math.max(1.5, od * 0.4),
          params: (c.params ?? {}) as Record<string, number>,
        };
      })
      .filter(Boolean) as any[]);

  // Parametric builds populate this keyed cache asynchronously.
  const parametricGeoms = $state<Record<string, { geom: THREE.BufferGeometry; bbox: THREE.Box3 }>>({});
  const _inFlight = new Set<string>();
  $effect(() => {
    if (!manifoldReady) return;
    for (const m of compMarkers) {
      const tc = m.toolComp;
      if (!tc) continue;
      const builder = getBuilder(tc);
      if (!builder) continue;
      const length = Math.max(0.3, m.bot - m.top);
      const key = `${tc}|${m.top}|${m.bot}|${m.od}|${m.idIn}`;
      if (_inFlight.has(key) || Object.prototype.hasOwnProperty.call(parametricGeoms, key)) continue;
      _inFlight.add(key);
      const params = { od: m.od, id: m.idIn, length, slipRingCount: Number(m.params?.slipRingCount ?? 2) };
      buildCached(builder, params).then((r) => {
        parametricGeoms[key] = { geom: r.geometry, bbox: r.bbox };
        _inFlight.delete(key);
      }).catch((e) => { console.warn('[WellSchematic3D] parametric build failed', tc, e); _inFlight.delete(key); });
    }
  });

  const displayCompMarkers = $derived.by(() =>
    compMarkers.map((m) => {
      const key = m.toolComp ? `${m.toolComp}|${m.top}|${m.bot}|${m.od}|${m.idIn}` : '';
      const built = key ? parametricGeoms[key] : undefined;
      if (built) return { ...m, parametricGeom: built.geom };
      if (!cutActive) return { ...m, parametricGeom: null, geom: null };
      // Completion component (packer / nipple / mule shoe / ICD …) → 90° quarter
      // WEDGE (270° stays) so the component reads whole with a notch to the bore.
      const geom = safe(() => cutCylinder(m.top, m.bot, m.radius, cutAxis, rgb(m.color), {}, wellDir, cutAzimuth, 90));
      return { ...m, parametricGeom: null, geom };
    }));

  // ── In-diagram label bank (C2) ──────────────────────────────────────────────
  // A readable BANK of element chips hung to one side of the wellbore, each
  // leader-lined back to its element on the 3D diagram (the "anchored to the
  // diagram" annotation mode). Order-preserving 1-D de-overlap in DISPLAY-DEPTH
  // units (labella "simple" parity) separates clustered labels so their chips
  // don't pile up; the anchors stay put, only the chip's banked depth shifts.
  function spreadDepths(ideal: number[], gap: number, lo: number, hi: number): number[] {
    const n = ideal.length;
    if (n === 0) return [];
    if (n === 1) return [Math.min(hi, Math.max(lo, ideal[0]))];
    const order = ideal.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    type C = { start: number; count: number; sum: number };
    const first = (c: C) => c.sum / c.count - ((c.count - 1) * gap) / 2;
    const last = (c: C) => first(c) + (c.count - 1) * gap;
    const cl: C[] = [];
    for (let k = 0; k < n; k++) {
      cl.push({ start: k, count: 1, sum: order[k].v });
      while (cl.length >= 2) {
        const b = cl[cl.length - 1], a = cl[cl.length - 2];
        if (first(b) < last(a) + gap - 1e-9) { a.count += b.count; a.sum += b.sum; cl.pop(); }
        else break;
      }
    }
    const out = new Array<number>(n);
    for (const c of cl) { let p = first(c); for (let m = 0; m < c.count; m++) { out[order[c.start + m].i] = p; p += gap; } }
    const loPos = out[order[0].i], hiPos = out[order[n - 1].i], span = hiPos - loPos, avail = hi - lo;
    if (span > avail) { for (let k = 0; k < n; k++) out[order[k].i] = lo + (avail * k) / (n - 1); return out; }
    let shift = 0;
    if (loPos < lo) shift = lo - loPos; else if (hiPos > hi) shift = hi - hiPos;
    if (shift) for (let i = 0; i < n; i++) out[i] += shift;
    return out;
  }

  function nodeAt(displayDepth: number): THREE.Vector3 {
    const node = wellDir.getInterNode(displayDepth);
    return node ? new THREE.Vector3(node.pt[0], node.pt[1], node.pt[2]) : new THREE.Vector3(0, 0, displayDepth);
  }

  const labelBank = $derived.by(() => {
    if (labelAnchor === 'off') return [];
    type Src = { md: number; text: string; iconKey: string; color: string };
    const src: Src[] = [];
    // Casing shoes (string bottoms).
    for (const c of wson?.ch ?? []) {
      if (typeof c.bot !== 'number') continue;
      const od = c.od != null ? `${c.od}" ` : '';
      src.push({ md: c.bot, text: `${od}${c.type ?? 'csg'} shoe`, iconKey: 'shoe', color: '#94a3b8' });
    }
    // Perforations (interval midpoints).
    for (const p of wson?.perforations ?? []) {
      if (typeof p.top !== 'number' || typeof p.bot !== 'number') continue;
      src.push({ md: (p.top + p.bot) / 2, text: p.label ?? 'Perf', iconKey: 'perforation', color: '#ef4444' });
    }
    // Completions (skip the long tubing string — not a point feature).
    for (const c of wson?.completions ?? []) {
      const desc = c.description ?? c.tool_comp ?? '';
      if (!desc || /tubing joints/i.test(desc)) continue;
      const top = c.top ?? 0, bot = c.bot ?? top;
      src.push({ md: (top + bot) / 2, text: desc, iconKey: desc, color: compColor(desc) });
    }
    if (!src.length) return [];
    src.sort((a, b) => a.md - b.md);

    // De-overlapped bank depths → trajectory points, offset laterally to the side.
    const gap = Math.max(radialExtent * 1.4, td * 0.045);
    const banked = spreadDepths(src.map((s) => remap(s.md)), gap, 0, Math.max(1, td));
    const sign = labelAnchor === 'left' ? -1 : 1;
    const offX = sign * (radialExtent * 2 + Math.max(6, td * 0.02));
    const lift = Math.max(4, radialExtent * 0.5);

    return src.map((s, i) => {
      const anchor = nodeAt(remap(s.md));
      const chip = nodeAt(banked[i]);
      chip.x += offX;
      chip.y -= lift;
      return {
        key: `${s.iconKey}-${i}-${Math.round(s.md)}`,
        text: s.text,
        color: s.color,
        iconPath: iconFor(s.iconKey).path,
        anchor,
        chip,
      };
    });
  });

  // Dispose base geoms on unmount.
  onDestroy(() => {
    [...ohGeoms, ...chGeoms, ...cementGeoms].forEach((g) => g.geom?.dispose?.());
    tubingGeom?.dispose?.();
  });
</script>

<!-- Lights — ambient is lifted on the white/paper background so the standard
     materials don't read dark against the bright backdrop. -->
<T.AmbientLight intensity={whiteBg ? 0.85 : 0.5} />
<T.DirectionalLight position={[50, -100, 80]} intensity={0.7} />
<T.DirectionalLight position={[-80, 100, -50]} intensity={0.35} />
<T.DirectionalLight position={[50, 100, 80]} intensity={0.5} />
<T.HemisphereLight args={[whiteBg ? '#ffffff' : '#87ceeb', whiteBg ? '#c9cfda' : '#3d2817', 0.3]} />

<!-- Camera — industry convention: X/Y surface, Z depth (positive down),
     up = [0,0,-1] so screen-up = surface. Fit the DEVIATED bounding box so the
     well is CENTERED + FILLS the frame (spec C1/A3). Wrapped in {#key fitKey} so
     the camera re-fits on well / Dia× / Depth× change but a cutaway or orbit
     leaves the current view alone. -->
{#key fitKey}
  <T.PerspectiveCamera
    makeDefault
    position={[cameraPos.x, cameraPos.y, cameraPos.z]}
    fov={FOV}
    near={Math.max(1, fit.radius * 0.02)}
    far={Math.max(10000, fit.radius * 40)}
    up={[0, 0, -1]}
    oncreate={(cam) => onCameraMove?.({ x: cam.position.x, y: cam.position.y, z: cam.position.z })}
  >
    <OrbitControls target={[fit.center.x, fit.center.y, fit.center.z]} enableDamping />
  </T.PerspectiveCamera>
{/key}

{#key geomKey}
  <!-- {#key} forces remount on cutaway/axis/scale change so <Edges> rebuilds
       from the new CSG geometry (cadtrain pattern). -->

  {#if layers.showOpenHole}
    {#each ohGeoms as oh}
      {#if oh.geom}
        <T.Mesh geometry={oh.geom} renderOrder={0}>
          <T.MeshStandardMaterial color={cutActive ? '#ffffff' : '#c084fc'} vertexColors={cutActive}
            transparent opacity={0.25} depthWrite={false} side={THREE.DoubleSide} />
          <Edges thresholdAngle={20} color="black" />
        </T.Mesh>
      {/if}
    {/each}
  {/if}

  {#if layers.showCement}
    {#each cementGeoms as cm}
      {#if cm.geom}
        <T.Mesh geometry={cm.geom} renderOrder={1}>
          <T.MeshStandardMaterial color={cutActive ? '#ffffff' : '#d6c7a1'} vertexColors={cutActive}
            roughness={0.9} metalness={0} side={THREE.DoubleSide} />
          <Edges thresholdAngle={20} color="black" />
        </T.Mesh>
      {/if}
    {/each}
  {/if}

  {#if layers.showCasing}
    {#each chGeoms as ch}
      {#if ch.geom}
        <T.Mesh geometry={ch.geom} renderOrder={2}>
          <T.MeshStandardMaterial color={cutActive ? '#ffffff' : '#94a3b8'} vertexColors={cutActive}
            metalness={0.55} roughness={0.4} side={THREE.DoubleSide} />
          <Edges thresholdAngle={20} color="black" />
        </T.Mesh>
      {/if}
    {/each}
  {/if}

  {#if (layers.showTubing ?? true) && tubingGeom}
    <T.Mesh geometry={tubingGeom} renderOrder={3}>
      <T.MeshStandardMaterial color={cutActive ? '#ffffff' : '#eab308'} vertexColors={cutActive}
        metalness={0.7} roughness={0.3} side={THREE.DoubleSide} />
      <Edges thresholdAngle={20} color="black" />
    </T.Mesh>
  {/if}

  {#if layers.showPerforations}
    {#each perfMarkers as m}
      {#if m.geom}
        <T.Mesh geometry={m.geom}>
          <T.MeshStandardMaterial color="#ffffff" vertexColors emissive="#dc2626" emissiveIntensity={0.25} />
          <Edges thresholdAngle={20} color="black" />
        </T.Mesh>
      {:else}
        <T.Mesh position={[m.position.x, m.position.y, m.position.z]}>
          <T.SphereGeometry args={[m.radius, 32, 24]} />
          <T.MeshStandardMaterial color="#ef4444" emissive="#dc2626" emissiveIntensity={0.4} />
        </T.Mesh>
      {/if}
    {/each}
  {/if}

  {#if layers.showCompletions}
    {#each displayCompMarkers as m}
      {#if m.parametricGeom}
        <!-- Parametric solid: local frame (inches x/y, metres z). Lateral scale
             lifts inches → scene units via diaScale. -->
        <T.Mesh geometry={m.parametricGeom}
                position={[m.position.x, m.position.y, m.position.z]}
                scale={[diaScale, diaScale, 1]}>
          <T.MeshStandardMaterial color={m.color} metalness={0.45} roughness={0.45} />
          <Edges thresholdAngle={25} color="black" />
        </T.Mesh>
      {:else if m.geom}
        <T.Mesh geometry={m.geom}>
          <T.MeshStandardMaterial color="#ffffff" vertexColors metalness={0.4} roughness={0.5} />
          <Edges thresholdAngle={20} color="black" />
        </T.Mesh>
      {:else}
        <!-- Fallback cylinder (CylinderGeometry body axis = local Y → world Z
             after the X rotation). -->
        <T.Mesh position={[m.position.x, m.position.y, m.position.z]} rotation={[Math.PI / 2, 0, 0]}>
          <T.CylinderGeometry args={[m.radius, m.radius, m.height, 32]} />
          <T.MeshStandardMaterial color={m.color} metalness={0.4} roughness={0.5} />
          <Edges thresholdAngle={20} color="black" />
        </T.Mesh>
      {/if}
    {/each}
  {/if}
{/key}

<!-- Depth ruler — thin red centreline (Line, not TubeGeometry, which throws
     computeFrenetFrames on straight sections). -->
{#if centre.length >= 2}
  {@const lineGeom = new THREE.BufferGeometry().setFromPoints(centre)}
  <T.Line geometry={lineGeom}>
    <T.LineBasicMaterial color="#dc2626" transparent opacity={0.7} />
  </T.Line>
{/if}

<!-- In-diagram label bank (C2) — de-overlapped element chips hung to one side,
     each leader-lined + dotted back to its element. `<HTML>` billboards keep the
     text screen-aligned + crisp; pointerEvents:none so they never steal orbit.
     A low zIndexRange keeps them UNDER the route's element rail + depth ruler. -->
{#if labelAnchor !== 'off'}
  {#each labelBank as l (l.key)}
    {@const leader = new THREE.BufferGeometry().setFromPoints([l.anchor, l.chip])}
    <T.Line geometry={leader}>
      <T.LineBasicMaterial color={whiteBg ? '#556' : '#9fb0d0'} transparent opacity={0.5} />
    </T.Line>
    <T.Mesh position={[l.anchor.x, l.anchor.y, l.anchor.z]}>
      <T.SphereGeometry args={[Math.max(1.5, radialExtent * 0.14), 10, 8]} />
      <T.MeshBasicMaterial color={l.color} />
    </T.Mesh>
    <T.Group position={[l.chip.x, l.chip.y, l.chip.z]}>
      <HTML center pointerEvents="none" zIndexRange={[10, 0]}>
        <div class="wl-chip" class:white={whiteBg} style="--wl-accent:{l.color}">
          <svg class="wl-chip-ic" width="13" height="13" viewBox="0 0 16 16" fill="none"
            stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d={l.iconPath} />
          </svg>
          <span class="wl-chip-txt">{l.text}</span>
        </div>
      </HTML>
    </T.Group>
  {/each}
{/if}

<style>
  /* In-diagram label chip (portaled by <HTML>; Svelte still scopes these because
     the markup is compiled by THIS component). Dark by default, dark-on-white
     when the schematic-on-paper background is active. */
  .wl-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 8px 3px 6px;
    background: rgba(16, 16, 26, 0.86);
    border: 1px solid var(--wl-accent, #4a4a6a);
    border-left-width: 3px;
    border-radius: 6px;
    color: #e8e8ef;
    font: 600 11px/1 Arial, sans-serif;
    white-space: nowrap;
    pointer-events: none;
    user-select: none;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
    backdrop-filter: blur(2px);
  }
  .wl-chip.white {
    background: rgba(255, 255, 255, 0.92);
    color: #22283a;
    box-shadow: 0 1px 5px rgba(0, 0, 0, 0.18);
  }
  .wl-chip-ic {
    color: var(--wl-accent, #99a);
    flex: none;
  }
  .wl-chip-txt {
    display: inline-block;
    max-width: 190px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
