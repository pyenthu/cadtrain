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
  import { OrbitControls, Edges } from '@threlte/extras';
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

  // Camera framing ≈ midpoint of the wellbore.
  const cameraTarget = $derived(() => {
    if (centre.length === 0) return new THREE.Vector3(0, 0, td / 2);
    return centre[Math.floor(centre.length / 2)].clone();
  });
  const cameraDistance = $derived(() => {
    if (centre.length === 0) return td * 1.5;
    const b = new THREE.Box3().setFromPoints(centre);
    const size = new THREE.Vector3(); b.getSize(size);
    return Math.max(size.x, size.y, size.z, td * 0.5) * 1.6;
  });

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

  // Dispose base geoms on unmount.
  onDestroy(() => {
    [...ohGeoms, ...chGeoms, ...cementGeoms].forEach((g) => g.geom?.dispose?.());
    tubingGeom?.dispose?.();
  });
</script>

<!-- Lights -->
<T.AmbientLight intensity={0.5} />
<T.DirectionalLight position={[50, -100, 80]} intensity={0.7} />
<T.DirectionalLight position={[-80, 100, -50]} intensity={0.35} />
<T.DirectionalLight position={[50, 100, 80]} intensity={0.5} />
<T.HemisphereLight args={['#87ceeb', '#3d2817', 0.3]} />

<!-- Camera — industry convention: X/Y surface, Z depth (positive down),
     up = [0,0,-1] so screen-up = surface. Offset in +X / -Y so a +X-normal
     cutaway faces the viewer. -->
<T.PerspectiveCamera
  makeDefault
  position={[cameraDistance() * 0.8, -cameraDistance(), cameraTarget().z - cameraDistance() * 0.3]}
  fov={40}
  near={1}
  far={Math.max(10000, cameraDistance() * 20)}
  up={[0, 0, -1]}
  oncreate={(cam) => onCameraMove?.({ x: cam.position.x, y: cam.position.y, z: cam.position.z })}
>
  <OrbitControls target={[cameraTarget().x, cameraTarget().y, cameraTarget().z]} enableDamping />
</T.PerspectiveCamera>

<T.AxesHelper args={[100]} />

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
