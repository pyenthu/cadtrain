<script module lang="ts">
  // Shared across ALL instances + survives unmount/remount (tab switches).
  const fetchCache = new Map<string, any>();
</script>

<script lang="ts">
  // One canvas showing the live mesh (left) + baked GLB (right) side-by-side
  // in a SINGLE WebGL context — replaces the stacked PrimitiveCanvas +
  // PrimitiveGlbCanvas (was 2 contexts per tab → the WebGL-context leak,
  // todo_webgl_context_leak). Fetches both /preview and /bake-preview.
  import { onMount, onDestroy } from 'svelte';
  import { Canvas } from '@threlte/core';
  import { WebGLRenderer } from 'three';
  import { deserializeComponentResult } from '$lib/cad/mesh-serial';
  import { brepResponseToGeo, type BrepPreviewResponse } from '$lib/shared/brep-adapter';
  import { scene } from '$lib/shared/scene-state.svelte';

  let { id, name = id, description = '', args, source, showControls = true, showLabels = true, sceneOffset = 4.5, sceneStackAxis = 'x', colorOuter = undefined, colorInner = undefined, bakeMesh = true, bakeGlb = true, meshSegments = undefined, onRebuild = undefined, backend = 'manifold', brepSource = undefined, brepParams = undefined, tolerance = 0.05, onBakeMeta = undefined }: {
    id: string; name?: string; description?: string; args: (number | string)[]; source?: string; showControls?: boolean;
    /** Geometry backend. 'manifold' (default) → /api/primitives/preview (the 3D +
     *  GLB tabs, byte-identical). 'brep' → /api/brep/preview (server-side OCCT
     *  true-curve mesh); the GLB half, segment dial + ⬇GLB are suppressed and the
     *  segment dial is relabelled to the OCCT linear-deflection `tol`. */
    backend?: 'manifold' | 'brep';
    /** BREP mode: the emitted part source POSTed to /api/brep/preview. */
    brepSource?: string;
    /** BREP mode: param name → current value (graph.params order ↔ bake.args). */
    brepParams?: Record<string, number>;
    /** BREP mode: OCCT linear deflection (lower = finer). Seeds the in-canvas
     *  `tol` dial and is keyed into the fetch cache. Default 0.05. */
    tolerance?: number;
    /** BREP mode: surfaced bake meta after each fetch (drives the parent badge). */
    onBakeMeta?: (m: { cached: boolean; ms: number; tris: number; verts: number; supported: boolean; reason?: string }) => void;
    /** Draft mode: coarse circular-segment count for the live mesh bake (e.g. 64
     *  vs the 256 default). Cuts geom+finalize+serialize roughly linearly so big
     *  stacks iterate fast. undefined → full default. Keyed into the fetch cache.
     *  Acts as the INITIAL value for the in-canvas segments control (segOverride). */
    meshSegments?: number;
    /** Optional rebuild handler (e.g. the editor's cache-busting re-bake). When
     *  provided, the in-canvas 🔄 button calls it; else it busts the local cache. */
    onRebuild?: () => void;
    /** Bake/show the live MESH (left). Default true. The mesh bake is fast
     *  (~1-2 s); the 3D-bake tab uses mesh-only so iteration never waits on the
     *  slow GLB bake. */
    bakeMesh?: boolean;
    /** Bake/show the GLB (right). Default true. The GLB bake is SLOW (the full
     *  cutaway subtract, ~20 s cold, and it blocks Node's single thread). The
     *  GLB lives in its own lazy tab now, so the editor mounts it with
     *  bakeGlb=true ONLY when that tab is active. Default-true keeps other
     *  callers (typed builders) unchanged. */
    bakeGlb?: boolean;
    /** Per-part viewer colours (outside ← outer body, inside ← bore/cut). When
     *  set, sent to /preview so the live mesh re-bakes with them (and keyed into
     *  the fetch cache below). Unset → the legacy red/grey default bake. */
    colorOuter?: string;
    colorInner?: string;
    /** When false, the top 'Mesh (live)' + 'GLB (bake)' label chips are
     *  hidden — used by the typed-builder panes where the labels add
     *  visual clutter without information value (only one scene anyway). */
    showLabels?: boolean;
    /** Half-separation between the live mesh (-offset) and the GLB (+offset),
     *  along the axis chosen by sceneStackAxis. Default 4.5 (side-by-side). */
    sceneOffset?: number;
    /** Which axis to stack along. 'x' = side-by-side (default), 'z' = vertical
     *  along the drilling axis — typed builders use this with a small offset
     *  so the user can orbit up/down to see mesh vs GLB. */
    sceneStackAxis?: 'x' | 'z';
  } = $props();

  let Scene = $state<any>(null);
  let SceneControls = $state<any>(null);
  let geo = $state<any>(null);
  let geoVersion = $state(0);
  let glbBlobUrl = $state<string | null>(null);
  let glbCut = $state(false);
  // In-canvas adjustable segment count for the live-mesh bake (the "segments"
  // control). undefined → the prop default (meshSegments) / full 256. Drives the
  // bake request + fetch-cache key.
  let segOverride = $state<number | undefined>(undefined);
  let effSegments = $derived(segOverride ?? meshSegments);
  // BREP backend (server-side OCCT). When on, the GLB half is suppressed and the
  // segment dial becomes the OCCT linear-deflection `tol` dial.
  let isBrep = $derived(backend === 'brep');
  let effBakeGlb = $derived(isBrep ? false : bakeGlb);
  // In-canvas adjustable OCCT tolerance (the relabelled "tol" dial). undefined →
  // the prop default (tolerance). Drives the BREP fetch + fetch-cache key.
  let tolOverride = $state<number | undefined>(undefined);
  let effTol = $derived(tolOverride ?? tolerance ?? 0.05);
  // OCCT bake time (ms) for the current BREP mesh — appended to the stats line.
  let brepMs = $state<number | null>(null);
  // BREP "no path for this part" reason (supported:false) — shown in the canvas.
  let brepReason = $state<string | null>(null);
  // Tri / vert stats of the current live mesh (instanced → child × N). For the
  // BREP cut mode the geo carries only `cutVC`, so fall back to it.
  let stats = $derived.by(() => {
    const g = ((geo as any)?.full ?? (geo as any)?.cutVC) as any;
    const pos = g?.getAttribute?.('position');
    if (!pos) return null;
    const childTris = Math.round((g.index ? g.index.count : pos.count) / 3);
    const childVerts = pos.count;
    const inst = (geo as any)?.instanced;
    const n = inst ? (inst.count ?? inst.instances?.length ?? 1) : 1;
    return { tris: childTris * n, verts: childVerts * n, instanced: !!inst, count: n, childTris };
  });
  let scaleMenuOpen = $state(false);
  let meshStatus = $state<'idle'|'building'|'ok'|'error'>('idle');
  let glbStatus = $state<'idle'|'building'|'ok'|'error'>('idle');
  let err = $state<string | null>(null);

  let renderer: WebGLRenderer | null = null;
  function createRenderer(canvas: HTMLCanvasElement) {
    renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    return renderer;
  }

  onMount(async () => {
    const [scn, controls] = await Promise.all([
      import('$lib/shared/PrimitiveDualScene.svelte'),
      import('$lib/shared/SceneControls.svelte'),
    ]);
    // No rebuild() here — setting Scene re-fires the keyed $effect below,
    // which owns ALL rebuild triggering (single path, no double-fetch).
    Scene = scn.default; SceneControls = controls.default;
  });

  function setGlbBlob(b64: string | null) {
    if (glbBlobUrl) URL.revokeObjectURL(glbBlobUrl);
    if (!b64) { glbBlobUrl = null; return; }
    const bin = atob(b64); const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    glbBlobUrl = URL.createObjectURL(new Blob([bytes], { type: 'model/gltf-binary' }));
  }

  // Module-scope fetch cache (2026-06-11) — survives unmount/remount.
  // Inactive /primitives tabs now UNMOUNT this component (WebGL-context
  // cap), so switching back would re-hit /preview + /bake-preview for
  // unchanged geometry. Cache the raw responses keyed by the full request
  // body; a remount with the same id/args/source repaints instantly.
  // Small LRU — GLB payloads can be MBs for tall assemblies.
  const FETCH_CACHE_MAX = 12;
  function cacheGet(key: string): any | undefined {
    const v = fetchCache.get(key);
    if (v !== undefined) { fetchCache.delete(key); fetchCache.set(key, v); } // refresh recency
    return v;
  }
  function cachePut(key: string, val: any) {
    if (fetchCache.has(key)) fetchCache.delete(key);
    fetchCache.set(key, val);
    while (fetchCache.size > FETCH_CACHE_MAX) fetchCache.delete(fetchCache.keys().next().value as string);
  }

  let meshAc: AbortController | null = null;
  let glbAc: AbortController | null = null;
  async function rebuildMesh(bust = false) {
    if (!id) return;
    // Request the cutaway (cutVC) only when the user is VIEWING it. Large parts
    // (> ~15k tris, e.g. multi-part assemblies) auto-skip the cutaway server-side
    // for speed, so without this the live mesh's cutVC stays empty and toggling
    // cutaway ON renders blank. cutaway:true forces the server to compute it;
    // when off we omit the flag (auto-skip → fast). The flag is part of the body
    // so it keys the fetch cache separately for cut vs full.
    // `instanced: true` — opt IN to GPU instancing for the LIVE mesh. The
    // server returns the canonical child mesh + N transforms when this part is
    // a uniform Stack/Repeat (else a normal merged mesh). Only THIS live-mesh
    // call sends it; the SVG tab + GLB bake never do (they keep the merged
    // mesh). The flag is in the body so it keys the fetch cache.
    // Warp is BAKED into the geometry server-side (so the wire edges follow the
    // bulge) — send the committed warp params when enabled. `undefined` when off
    // omits the key from the JSON body → byte-identical request + cache key to
    // the pre-warp default. The body IS the fetch-cache key, so warp variants
    // memoise separately.
    const warp = scene.warpEnabled ? { amp: scene.warpAmp, freq: scene.warpFreq, axis: scene.warpAxis } : undefined;
    const body = JSON.stringify({ id, name, source: source ?? '', params: args, mode: source ? 'sandbox' : 'bundle', cutaway: scene.showCutaway || undefined, colorOuter, colorInner, instanced: true, ...(effSegments ? { segments: effSegments } : {}), ...(warp ? { warp } : {}) });
    const cached = bust ? undefined : cacheGet(`mesh:${body}`);
    if (cached) {
      geo = deserializeComponentResult({ full: cached.full, cutVC: cached.cutVC, instanced: cached.instanced });
      geoVersion++; meshStatus = 'ok'; err = null;
      return;
    }
    meshStatus = 'building';
    meshAc?.abort(); const ac = new AbortController(); meshAc = ac;
    try {
      const r = await fetch('/api/primitives/preview' + (bust ? '?bust=1' : ''), {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body,
        signal: ac.signal,
      });
      if (ac.signal.aborted) return;
      if (!r.ok) { err = `Preview ${r.status}`; meshStatus = 'error'; return; }
      const data = await r.json();
      cachePut(`mesh:${body}`, { full: data.full, cutVC: data.cutVC, instanced: data.instanced });
      geo = deserializeComponentResult({ full: data.full, cutVC: data.cutVC, instanced: data.instanced });
      geoVersion++; meshStatus = 'ok'; err = null;
    } catch (e: any) { if (e?.name !== 'AbortError') { err = String(e?.message ?? e); meshStatus = 'error'; } }
  }
  async function rebuildGlb(bust = false) {
    if (!id) return;
    const body = JSON.stringify({ id, name, source: source ?? '', args, cut: glbCut, colorOuter, colorInner });
    const cachedB64 = bust ? undefined : cacheGet(`glb:${body}`);
    if (cachedB64) { setGlbBlob(cachedB64); glbStatus = 'ok'; return; }
    glbStatus = 'building';
    glbAc?.abort(); const ac = new AbortController(); glbAc = ac;
    try {
      const r = await fetch('/api/primitives/bake-preview' + (bust ? '?bust=1' : ''), {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body,
        signal: ac.signal,
      });
      if (ac.signal.aborted) return;
      if (!r.ok) { err = `Bake ${r.status}`; glbStatus = 'error'; return; }
      const data = await r.json();
      const b64 = glbCut && data.cut ? data.cut : data.full;
      cachePut(`glb:${body}`, b64);
      setGlbBlob(b64);
      glbStatus = 'ok';
    } catch (e: any) { if (e?.name !== 'AbortError') { err = String(e?.message ?? e); glbStatus = 'error'; } }
  }
  // BREP backend: POST /api/brep/preview (server-side OCCT). Builds a
  // THREE.BufferGeometry from the response via the shared adapter and sets
  // geo = { full } (solid) or { cutVC } (coloured half-section, when the
  // Cross-section checkbox is on → cut:true re-bakes server-side). Reuses the
  // module-scope fetch cache (key includes tolerance + cut). supported:false →
  // an empty scene + a reason message in the chrome.
  let brepAc: AbortController | null = null;
  async function rebuildBrep(bust = false) {
    const cut = scene.showCutaway || undefined;
    const body = JSON.stringify({ source: brepSource ?? source ?? '', paramValues: brepParams ?? {}, tolerance: effTol, cut });
    const key = `brep:${body}`;
    const emit = (data: BrepPreviewResponse, cached: boolean) => {
      if (data.supported === false) {
        geo = null; geoVersion++; brepReason = data.reason ?? 'no BREP path for this part'; brepMs = null; meshStatus = 'ok'; err = null;
        onBakeMeta?.({ cached, ms: 0, tris: 0, verts: 0, supported: false, reason: data.reason });
        return;
      }
      geo = brepResponseToGeo(data); geoVersion++; brepReason = null;
      brepMs = data.meta?.ms ?? null; meshStatus = 'ok'; err = null;
      onBakeMeta?.({ cached, ms: data.meta?.ms ?? 0, tris: data.meta?.tris ?? 0, verts: data.meta?.verts ?? 0, supported: true });
    };
    const cached = bust ? undefined : cacheGet(key);
    if (cached) { emit(cached, true); return; }
    meshStatus = 'building'; brepReason = null;
    brepAc?.abort(); const ac = new AbortController(); brepAc = ac;
    try {
      const r = await fetch('/api/brep/preview' + (bust ? '?bust=1' : ''), {
        method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: ac.signal,
      });
      if (ac.signal.aborted) return;
      if (!r.ok) { err = `BREP ${r.status}`; meshStatus = 'error'; onBakeMeta?.({ cached: false, ms: 0, tris: 0, verts: 0, supported: false, reason: `HTTP ${r.status}` }); return; }
      const data = await r.json();
      cachePut(key, data);
      emit(data, false);
    } catch (e: any) { if (e?.name !== 'AbortError') { err = String(e?.message ?? e); meshStatus = 'error'; onBakeMeta?.({ cached: false, ms: 0, tris: 0, verts: 0, supported: false, reason: String(e?.message ?? e) }); } }
  }
  // Mesh FIRST, then GLB — so the fast mesh (~2 s) renders before the slow GLB
  // bake (~20 s) hogs Node's single thread. Each is gated by its prop so the
  // mesh-only 3D tab never triggers the GLB bake, and the lazy GLB tab never
  // re-bakes the mesh. BREP routes to its own server-side OCCT fetch.
  async function rebuild(bust = false) {
    if (isBrep) { await rebuildBrep(bust); return; }
    if (bakeMesh) await rebuildMesh(bust);
    if (effBakeGlb) rebuildGlb(bust);
  }
  // 🔄 button: force a FRESH bake (?bust=1) — clears the local fetch cache so the
  // server result is re-fetched, and notifies the parent (editor clears its own
  // persistent cache + status). Reliable regardless of whether id/args changed.
  function doRebuild() {
    fetchCache.clear();
    rebuild(true);
    onRebuild?.();
  }

  onDestroy(() => {
    // Release the WebGL context NOW, not at GC time — the whole point of
    // unmounting inactive tabs' canvases is freeing the browser's ~16
    // context budget. dispose() drops GPU resources; forceContextLoss()
    // tells the browser the context is reclaimable immediately.
    meshAc?.abort(); glbAc?.abort(); brepAc?.abort();
    if (glbBlobUrl) URL.revokeObjectURL(glbBlobUrl);
    try { renderer?.dispose(); renderer?.forceContextLoss(); } catch { /* already lost */ }
    renderer = null;
  });

  // Keyed on CONTENT, not identity. `args` arrives as a fresh array on
  // every parent render, so an identity-tracked effect re-fires constantly;
  // that was survivable when rebuild() always awaited a fetch, but a
  // synchronous cache hit writes geo/glb state inside the effect →
  // re-render → fresh args → effect → cache hit → infinite loop
  // (effect_update_depth_exceeded). Skip when the request body is
  // unchanged and the loop has nothing to feed on.
  let lastRebuildKey = '';
  $effect(() => {
    // Include showCutaway so toggling it ON for a large (cutaway-auto-skipped)
    // part re-fetches WITH the cutaway computed. rebuildGlb's body is unchanged
    // by this, so it cache-hits and stays cheap.
    // `warpBakeNonce` re-bakes the live mesh on a warp COMMIT (toggle / axis /
    // amp|freq change — see SceneControls.commitWarp), NOT per keystroke or
    // drag tick. rebuildMesh reads the live warp* values at fetch time; the GLB
    // body is unaffected so it cache-hits (the GLB pane warps via its own shader).
    // BREP keys on its own request shape (source/params/tolerance/cut); the
    // Manifold key (id/args/colors/segments/warp) doesn't apply server-side.
    const key = isBrep
      ? JSON.stringify({ b: 'brep', src: brepSource ?? source ?? '', p: brepParams ?? {}, tol: effTol, cut: scene.showCutaway })
      : JSON.stringify({ id, args, source: source ?? '', cut: scene.showCutaway, colorOuter, colorInner, segments: effSegments, warpNonce: scene.warpBakeNonce });
    if (!Scene || key === lastRebuildKey) return;
    lastRebuildKey = key;
    rebuild();
  });
  let lastGlbCut: boolean | null = null;
  $effect(() => {
    if (isBrep) return; // no GLB half in BREP mode
    if (!Scene || glbCut === lastGlbCut) return;
    const first = lastGlbCut === null; // initial run is covered by rebuild()
    lastGlbCut = glbCut;
    if (!first) rebuildGlb();
  });

  function downloadGlb() {
    if (!glbBlobUrl) return;
    const a = document.createElement('a'); a.href = glbBlobUrl; a.download = `${id}.glb`;
    document.body.appendChild(a); a.click(); a.remove();
  }

  // --- Z-pan slider range, derived from the rendered part's Z extent ---
  // scene.partZExtent + scene.partCenter are written by PrimitiveDualScene's
  // geometry effect in POST-view-scale world units (they already bake in
  // xScale/zScale AND the stacked mesh+GLB span). zFocus is ADDED to
  // partCenter.z to drive the OrbitControls look-at, so mapping the slider's
  // min/max to the extent measured as an OFFSET FROM that centre makes full
  // slider travel scroll the target from the TOP (lower z, Z-down convention)
  // to the BOTTOM (higher z) of the visible composition. zFocus 0 sits at the
  // centre → the camera auto-fit frames the whole part by default. Falls back
  // to a small symmetric range before any geometry has been measured.
  let zSpan = $derived.by(() => {
    const { min, max } = scene.partZExtent;
    const cz = scene.partCenter.z;
    if (!(max > min)) return { min: -10, max: 10 };
    const pad = (max - min) * 0.05; // headroom so the ends aren't flush against the stop
    return { min: min - cz - pad, max: max - cz + pad };
  });
  // Pan STEP scales with ZOOM so the slider stays in sync with what's framed:
  // the on-screen vertical span is 2·dist·tan(fov/2) (fov 45°, camera looks
  // along ±Y), so a step of (visible span)/120 keeps the pan resolution
  // proportional to the visible part length — fine when zoomed in, coarse when
  // zoomed out. Distance is to the PANNED target (partCenter + zFocus on z),
  // which is invariant under the pan itself, so dragging the slider never
  // changes its own step (no jitter); only zoom / orbit (scene.cam) does.
  const TAN_HALF_FOV = Math.tan((45 * Math.PI) / 180 / 2);
  let zStep = $derived.by(() => {
    const pc = scene.partCenter;
    const tz = pc.z + scene.zFocus;
    const dist = Math.hypot(scene.cam.x - pc.x, scene.cam.y - pc.y, scene.cam.z - tz);
    const visible = 2 * dist * TAN_HALF_FOV;
    const total = Math.max(1e-3, zSpan.max - zSpan.min);
    return Math.min(total / 20, Math.max(0.02, visible / 120));
  });
  // Keep zFocus inside the current part's range — a stale value left by a
  // taller part (or a hand-set zFocus) would aim the look-at off the new part.
  // Guarded so it ONLY writes when actually out of range: zSpan depends on
  // partZExtent/partCenter (NOT zFocus), so the re-run after a clamp finds
  // zFocus already in range and writes nothing → no effect loop with the
  // slider read or the pan effect in PrimitiveDualScene.
  $effect(() => {
    const { min, max } = zSpan;
    const z = scene.zFocus;
    const c = z < min ? min : z > max ? max : z;
    if (c !== z) scene.zFocus = c;
  });
</script>

<div class="pd-stage">
  {#if showLabels}
    <div class="pd-label pd-label-l">Mesh (live){#if meshStatus === 'building'} · …{/if}</div>
    <div class="pd-label pd-label-r">
      <span>GLB (bake){#if glbStatus === 'building'} · …{/if}</span>
      <label class="pd-toggle" title="Half-sectioned bake"><input type="checkbox" bind:checked={glbCut} /> cut</label>
    </div>
  {/if}
  {#if name}<div class="pd-title">{name}</div>{/if}
  {#if description}<div class="pd-desc">{description}</div>{/if}
  <!-- View-scale settings — a gear below the title opens a small menu to
       exaggerate the X-diameter and compress the Z-depth (view-only) so long
       thin tools stay readable without losing diametric detail. -->
  <button class="pd-scale-btn" type="button" class:on={scaleMenuOpen}
    title="Diameter / depth view scale"
    onclick={() => (scaleMenuOpen = !scaleMenuOpen)}>⚙ scale</button>
  {#if scaleMenuOpen}
    <div class="pd-scale-menu">
      <div class="pd-scale-row">
        <span class="pd-scale-lbl">X-dia ×{scene.xScale.toFixed(2)}</span>
        <input type="range" min="0.25" max="8" step="0.25" bind:value={scene.xScale} />
      </div>
      <div class="pd-scale-row">
        <span class="pd-scale-lbl">Z-depth ×{scene.zScale.toFixed(2)}</span>
        <input type="range" min="0.05" max="2" step="0.05" bind:value={scene.zScale} />
      </div>
      <button class="pd-scale-reset" type="button"
        onclick={() => { scene.xScale = 1; scene.zScale = 1; }}>1:1 true scale</button>
    </div>
  {/if}
  <!-- Bake tools right under the scale gear: a quick Rebuild + an adjustable
       live-mesh segment count (lower = faster/coarser; 256 = full). -->
  <div class="pd-bake-tools">
    <button class="pd-mini-btn" type="button" title="Rebuild (fresh bake)"
      onclick={doRebuild}>🔄</button>
    {#if isBrep}
      <label class="pd-seg" title="OCCT linear deflection (tolerance) — lower = finer/slower">
        <span>tol</span>
        <input type="number" min="0.005" max="1" step="0.005" value={effTol}
          onchange={(e) => { const v = Number((e.currentTarget as HTMLInputElement).value); tolOverride = (Number.isFinite(v) && v > 0) ? v : undefined; }} />
      </label>
    {:else}
      <label class="pd-seg" title="Live-mesh circular segments — lower = faster/coarser, 256 = full">
        <span>seg</span>
        <input type="number" min="8" max="256" step="8" value={effSegments ?? 256}
          onchange={(e) => { const v = Number((e.currentTarget as HTMLInputElement).value); segOverride = (Number.isFinite(v) && v >= 8 && v < 256) ? Math.round(v) : undefined; }} />
      </label>
    {/if}
  </div>
  <!-- Z-pan: scroll the camera + look-at down the drilling axis (tall assemblies).
       Top = z 0 (top of the part), drag down to follow it deeper (Z-down). -->
  <div class="pd-zpan">
    <!-- Z-pan range is DERIVED from the rendered part's Z extent (zSpan, above)
         so full slider travel scrolls exactly from the top of the mesh/GLB to
         the bottom — no fixed stops. The step (zStep) scales with zoom so the
         pan resolution tracks the visible part length as the canvas is dollied. -->
    <input class="pd-zslider" type="range" min={zSpan.min} max={zSpan.max} step={zStep}
      bind:value={scene.zFocus} aria-label="Pan camera along Z" title="Pan view along Z ({scene.zFocus.toFixed(1)})" />
    <button class="pd-zreset" type="button" title="Reset Z pan" onclick={() => (scene.zFocus = 0)}>⊙</button>
  </div>
  {#if Scene}
    {@const S = Scene}
    <!-- smoothShade experiment (2026-05-28): rebake whenever the renderer
         actually NEEDS smooth shading — extrude variants with twist > 0 emit
         non-planar quads that read as a sawtooth under flatShading; the live
         mesh switches to calculateNormals(3, 60) vertex normals so the side
         reads smooth while flat-face creases (>60°) stay sharp.
         * r_weld_extrude — twist is always present (reserved for morphed).
         * r_extrude — twist is param index 2 in meta.params order
           (profile, height, twist, divs). Smooth-shade only when |twist| > 0.
         All other primitives keep flatShading (cube/hex stay faceted). -->
    {@const twistArg = Number((args as any[])?.[2] ?? 0)}
    <!-- BREP carries OCCT exact-surface normals → smooth-shade the solid so the
         true curvature reads (the cut half-section is faceted regardless). -->
    {@const smoothShade =
      isBrep ||
      id === 'r_weld_extrude' ||
      (id === 'r_extrude' && Math.abs(twistArg) > 0.001)}
    <Canvas {createRenderer}>
      <!-- Only one of mesh/GLB is baked per tab now → centre it (offset 0). -->
      <S {geo} {geoVersion} glbUrl={glbBlobUrl} showCutaway={scene.showCutaway} {smoothShade} offset={(bakeMesh && effBakeGlb) ? sceneOffset : 0} stackAxis={sceneStackAxis} />
    </Canvas>
    {#if showControls && SceneControls}{@const Controls = SceneControls}<Controls />{/if}
  {:else}
    <div class="pd-loading">loading…</div>
  {/if}
  {#if glbBlobUrl && !isBrep}<button class="pd-dl" type="button" title="Download {id}.glb" onclick={downloadGlb}>⬇ GLB</button>{/if}
  {#if err}<div class="pd-err">{err}</div>{/if}
  <!-- BREP: no OCCT-buildable solid for this part (revolve / extrude / loft / CSG only). -->
  {#if isBrep && brepReason}<div class="pd-brep-reason">{brepReason}</div>{/if}
  <!-- Part stats at the bottom: tri / vert count (instanced → child × N).
       BREP appends the OCCT bake time. -->
  {#if stats}
    <div class="pd-stats" title={stats.instanced ? `${stats.childTris.toLocaleString()} tris/child × ${stats.count} instances` : ''}>
      {stats.tris.toLocaleString()} tris · {stats.verts.toLocaleString()} verts{stats.instanced ? ` · ×${stats.count} instanced` : ''}{#if isBrep && brepMs != null} · {Math.round(brepMs)}ms OCCT{/if}
    </div>
  {/if}
</div>

<style>
  .pd-stage { position: relative; width: 100%; height: 100%; min-height: 0; background: #ffffff; border-radius: 4px; overflow: hidden; }
  .pd-label { position: absolute; top: 6px; z-index: 5; font: 600 10px Arial; color: #fff; background: rgba(0,0,0,0.6); padding: 2px 8px; border-radius: 3px; }
  /* Pushed below the in-canvas title (top-left) so they don't overlap. */
  .pd-label-l { left: 8px; top: 34px; pointer-events: none; }
  .pd-label-r { right: 8px; display: flex; gap: 8px; align-items: center; }
  .pd-toggle { pointer-events: auto; display: inline-flex; gap: 3px; align-items: center; cursor: pointer; }
  .pd-toggle input[type='checkbox'] { appearance: auto; -webkit-appearance: auto; accent-color: #cc2222; cursor: pointer; }
  .pd-loading { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #aaa; font: 12px Arial; }
  /* Title (top-left) + description (bottom) as DOM overlays — NOT a Threlte
     <HTML> overlay, which rendered a pointer-events:auto wrapper at z-index 8
     that swallowed clicks on the ⬇ GLB button + the cut toggle. */
  /* Overlays were originally light-on-dark; the scene background is now WHITE
     (per .pd-stage), so the title and description need dark-on-light. Drop
     the dark drop-shadow and switch to a contrasting deep red / charcoal. */
  .pd-title { position: absolute; top: 8px; left: 12px; z-index: 5; pointer-events: none; font: 700 15px ui-monospace, SFMono-Regular, Menlo, monospace; color: #a02520; letter-spacing: 0.3px; text-shadow: 0 1px 2px rgba(255,255,255,0.95); }
  /* View-scale gear — sits just below the title. */
  .pd-scale-btn {
    position: absolute; top: 30px; left: 12px; z-index: 6;
    padding: 2px 8px; border: 1px solid #d6d3d1; border-radius: 4px;
    background: rgba(255,255,255,0.9); color: #57534e; cursor: pointer;
    font: 600 10px Arial; letter-spacing: 0.3px;
  }
  .pd-scale-btn:hover { background: #fff; border-color: #cc2222; color: #a02520; }
  .pd-scale-btn.on { background: #fef2f2; border-color: #cc2222; color: #a02520; }
  .pd-bake-tools { position: absolute; top: 54px; left: 12px; z-index: 6; display: flex; align-items: center; gap: 4px; }
  .pd-mini-btn { padding: 2px 6px; border: 1px solid #d6d3d1; border-radius: 4px; background: rgba(255,255,255,0.9); color: #57534e; cursor: pointer; font: 600 11px Arial; }
  .pd-mini-btn:hover { background: #fff; border-color: #cc2222; color: #a02520; }
  .pd-seg { display: inline-flex; align-items: center; gap: 3px; font: 600 10px Arial; color: #57534e; background: rgba(255,255,255,0.9); border: 1px solid #d6d3d1; border-radius: 4px; padding: 1px 4px; }
  .pd-seg input { width: 40px; font: 10px ui-monospace, monospace; color: #57534e; border: 1px solid #e7e5e4; border-radius: 3px; padding: 1px 3px; background: #fff; }
  .pd-stats { position: absolute; bottom: 6px; left: 12px; z-index: 6; font: 600 10px ui-monospace, monospace; color: #78716c; background: rgba(255,255,255,0.82); border-radius: 3px; padding: 1px 6px; pointer-events: none; }
  .pd-scale-menu {
    position: absolute; top: 56px; left: 12px; z-index: 7;
    display: flex; flex-direction: column; gap: 8px;
    padding: 10px 12px; min-width: 184px;
    background: rgba(255,255,255,0.97); border: 1px solid #e5e7eb; border-radius: 8px;
    box-shadow: 0 4px 14px rgba(0,0,0,0.14);
  }
  .pd-scale-row { display: flex; flex-direction: column; gap: 3px; }
  .pd-scale-lbl { font: 600 10px ui-monospace, monospace; color: #44403c; }
  .pd-scale-menu input[type="range"] { width: 100%; accent-color: #cc2222; height: 14px; }
  .pd-scale-reset {
    margin-top: 2px; padding: 3px 8px; border: 1px solid #d6d3d1; border-radius: 4px;
    background: #f5f5f4; color: #44403c; cursor: pointer; font: 600 10px Arial;
  }
  .pd-scale-reset:hover { background: #e7e5e4; }
  .pd-desc { position: absolute; bottom: 8px; left: 12px; right: 96px; z-index: 5; pointer-events: none; font: 11px Arial; color: #333; line-height: 1.35; text-align: center; text-shadow: 0 1px 2px rgba(255,255,255,0.95); }
  .pd-dl { position: absolute; bottom: 8px; right: 8px; z-index: 6; background: rgba(0,0,0,0.6); color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 4px 10px; font: 11px Arial; cursor: pointer; }
  .pd-dl:hover { background: #cc2222; border-color: #cc2222; }
  .pd-err { position: absolute; bottom: 8px; left: 8px; z-index: 5; color: #ff8888; font: 11px Arial; background: rgba(0,0,0,0.6); padding: 3px 8px; border-radius: 3px; max-width: 55%; }
  /* BREP "no path for this part" — centred, dark-on-light over the empty scene. */
  .pd-brep-reason { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 6; max-width: 70%; text-align: center; color: #a16207; background: rgba(255,255,255,0.9); border: 1px solid #fde68a; border-radius: 6px; padding: 8px 12px; font: 600 12px Arial; }
  /* Vertical Z-pan slider, left edge. */
  /* Z-pan vertical slider on the RIGHT edge — keeps the left clear for the
     2D SVG overlay (and the 'Mesh (live)' label sitting top-left). */
  .pd-zpan { position: absolute; right: 6px; top: 56px; bottom: 16px; z-index: 6; display: flex; flex-direction: column; align-items: center; gap: 6px; }
  /* Vertical range slider — modern path: `writing-mode: vertical-lr` alone.
     Drop `appearance: slider-vertical` (deprecated in Chrome 124+, removal
     warned via the runtime banner). Default direction:ltr makes top=min
     bottom=max, which matches Z-down (top of part = z 0 = slider top). */
  .pd-zslider { writing-mode: vertical-lr; width: 16px; flex: 1 1 auto; min-height: 0; cursor: ns-resize; accent-color: #cc2222; }
  .pd-zreset { flex: 0 0 auto; width: 20px; height: 20px; border: 1px solid rgba(0,0,0,0.25); background: rgba(255,255,255,0.85); border-radius: 50%; cursor: pointer; font: 12px Arial; color: #555; line-height: 1; padding: 0; }
  .pd-zreset:hover { color: #cc2222; border-color: #cc2222; }
</style>
