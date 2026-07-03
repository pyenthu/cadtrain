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
  import { bakeClient, isCancelled } from '$lib/cad/bake-client';
  import { brepResponseToGeo, type BrepPreviewResponse } from '$lib/shared/brep-adapter';
  import { scene } from '$lib/shared/scene-state.svelte';

  let { id, name = id, description = '', args, source, showControls = true, showLabels = true, sceneOffset = 4.5, sceneStackAxis = 'x', colorOuter = undefined, colorInner = undefined, bakeMesh = true, bakeGlb = true, meshSegments = undefined, onRebuild = undefined, backend = 'manifold', brepSource = undefined, brepParams = undefined, tolerance = 0.05, onBakeMeta = undefined, viewZScale = undefined, viewXScale = undefined, overlays = undefined, autoScaleOwner = true, tfDemo = 'r_cyl' }: {
    id: string; name?: string; description?: string; args: (number | string)[]; source?: string; showControls?: boolean;
    /** Spline DIAGNOSTIC overlays (TODO #24) — plotted splines' resolved curves +
     *  control points, drawn INSIDE the live-mesh group so they align with the
     *  baked geometry. VIEW-ONLY; passed straight through to PrimitiveDualScene. */
    overlays?: import('$lib/shared/PrimitiveDualScene.svelte').SplineOverlay[];
    /** Saved per-part editor VIEW scale (VIEW-ONLY) for the PRIMARY open part.
     *  When set, opening this part APPLIES the saved z/x exaggeration to `scene`
     *  and disables auto-normalize (scene.scaleAuto = false); when both are
     *  undefined the part auto-normalizes on load as before. Only the editor's
     *  primary canvas passes these — a nested subpart never does, so a subpart's
     *  saved scale can't leak into the parent/viewer scale. */
    viewZScale?: number;
    viewXScale?: number;
    /** Geometry backend. 'manifold' (default) → /api/primitives/preview (the 3D +
     *  GLB tabs, byte-identical). 'brep' → /api/brep/preview (server-side OCCT
     *  true-curve mesh); the GLB half, segment dial + ⬇GLB are suppressed and the
     *  segment dial is relabelled to the OCCT linear-deflection `tol`. 'tf' →
     *  the client-side, MAIN-THREAD TrueForm kernel ($lib/shared/trueform-client);
     *  like BREP it suppresses the GLB half + routes to its own bake path. */
    backend?: 'manifold' | 'brep' | 'tf';
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
    /** Only the PRIMARY 3D-bake canvas owns the shared auto-normalize scale.
     *  GLB/BREP secondary canvases pass false so two mounted scenes can't
     *  ping-pong the shared scene.xScale/zScale (freeze fix, 2026-07-02). */
    autoScaleOwner?: boolean;
    /** TF backend only: which client-side TrueForm demo to render — a name from
     *  the `tf_examples/` registry (box · r_cyl · s_cyl · helix · bored_pipe ·
     *  dp_pin · cone). Resolved via `getTfExample(name)`; unknown → r_cyl. */
    tfDemo?: import('$lib/shared/tf_examples').TfExampleName;
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
  // TrueForm backend (client-side, main-thread WASM). Like BREP it suppresses
  // the GLB half + routes to its own bake path (rebuildTf); unlike BREP it runs
  // entirely in the browser via $lib/shared/trueform-client.
  let isTf = $derived(backend === 'tf');
  let effBakeGlb = $derived((isBrep || isTf) ? false : bakeGlb);
  // TrueForm bake time (ms) for the current mesh — appended to the stats line.
  let tfMs = $state<number | null>(null);
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
    // STRAY / degenerate triangles — near-zero-area tris (the coplanar slivers a
    // CSG boolean leaves at tilted coincident caps; memory r_sweep_normals_and_twist).
    // Cheap per-bake scan of the child mesh; surfaced as the ⚠ badge + Remove button.
    const stray = countStrayTris(g) * n;
    return { tris: childTris * n, verts: childVerts * n, instanced: !!inst, count: n, childTris, stray };
  });
  // Count near-zero-area triangles (< 1% of the mean triangle area). Works on
  // indexed or non-indexed BufferGeometry. Absolute detector for degenerate/
  // sliver strays; genus needs the Manifold (server) so it's not computed here.
  function countStrayTris(g: any): number {
    const pos = g?.getAttribute?.('position'); if (!pos) return 0;
    const P = pos.array as ArrayLike<number>;
    const idx = g.index?.array as ArrayLike<number> | undefined;
    const nt = idx ? Math.floor(idx.length / 3) : Math.floor(P.length / 9);
    if (nt < 1) return 0;
    const areas = new Float64Array(nt); let sum = 0;
    for (let t = 0; t < nt; t++) {
      const a = (idx ? idx[t * 3] : t * 3) * 3, b = (idx ? idx[t * 3 + 1] : t * 3 + 1) * 3, c = (idx ? idx[t * 3 + 2] : t * 3 + 2) * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const ar = 0.5 * Math.sqrt(nx * nx + ny * ny + nz * nz); areas[t] = ar; sum += ar;
    }
    const thr = (sum / nt) * 1e-2; let stray = 0;
    for (let t = 0; t < nt; t++) if (areas[t] < thr) stray++;
    return stray;
  }
  // Remove-strays (v0 — client-side): rebuild the live-mesh geometry dropping the
  // near-zero-area tris + re-weld normals. A STARTING POINT; the durable removal
  // (Manifold merge/simplify or the annular-sweep rebuild) is TBD — see the badge.
  function removeStrays() {
    const g = (geo as any)?.full as any; if (!g) return;
    const pos = g.getAttribute('position'); const P = pos.array as ArrayLike<number>;
    const idx = g.index?.array as ArrayLike<number> | undefined;
    const nt = idx ? Math.floor(idx.length / 3) : Math.floor(P.length / 9);
    const nrmAttr = g.getAttribute('normal'); const colAttr = g.getAttribute('color');
    const outP: number[] = [], outN: number[] = [], outC: number[] = [];
    let sum = 0; const areas = new Float64Array(nt);
    for (let t = 0; t < nt; t++) {
      const ai = idx ? idx[t * 3] : t * 3, bi = idx ? idx[t * 3 + 1] : t * 3 + 1, ci = idx ? idx[t * 3 + 2] : t * 3 + 2;
      const a = ai * 3, b = bi * 3, c = ci * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const ar = 0.5 * Math.sqrt(nx * nx + ny * ny + nz * nz); areas[t] = ar; sum += ar;
    }
    const thr = (sum / nt) * 1e-2;
    const push = (i: number) => {
      const p = i * 3; outP.push(P[p], P[p + 1], P[p + 2]);
      if (nrmAttr) { const na = nrmAttr.array as ArrayLike<number>; outN.push(na[p], na[p + 1], na[p + 2]); }
      if (colAttr) { const ca = colAttr.array as ArrayLike<number>; outC.push(ca[p], ca[p + 1], ca[p + 2]); }
    };
    for (let t = 0; t < nt; t++) {
      if (areas[t] < thr) continue;
      const ai = idx ? idx[t * 3] : t * 3, bi = idx ? idx[t * 3 + 1] : t * 3 + 1, ci = idx ? idx[t * 3 + 2] : t * 3 + 2;
      push(ai); push(bi); push(ci);
    }
    // Lazy-import THREE only inside the handler (canvas already pulls it in).
    import('three').then((THREE) => {
      const ng = new THREE.BufferGeometry();
      ng.setAttribute('position', new THREE.BufferAttribute(new Float32Array(outP), 3));
      if (outN.length) ng.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(outN), 3));
      if (outC.length) ng.setAttribute('color', new THREE.BufferAttribute(new Float32Array(outC), 3));
      geo = { ...(geo as any), full: ng }; geoVersion++;
    });
  }
  let scaleMenuOpen = $state(false);
  let meshStatus = $state<'idle'|'building'|'ok'|'error'>('idle');
  /** Which backend produced the current live mesh — shown as a badge. */
  let meshBackend = $state<'client'|'server'|null>(null);
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

  // Coarse-during-drag: while the part is changing fast, bake the live mesh at a
  // low circular-seg count (cuts build+mesh+cutaway ~4×), then snap to full res
  // once changes settle. Smooth normals (scene.smoothShade) keep the coarse mesh
  // shading round, so the draft phase is barely noticeable. Plan: bake-perf.md.
  const DRAFT_SEG = 64;
  const DRAFT_SETTLE_MS = 220;
  // Leading debounce for the DRAFT pass. A burst of key changes (e.g. a fast
  // param scrub, or several re-keys in the same tick) that arrives within this
  // window collapses to ONE draft+full instead of one pair per key — the pending
  // draft is cancelled + rescheduled on each call. Kept tiny so a genuine single
  // edit still feels near-instant (< the ~50ms perceptible threshold). The main
  // mount-time churn is fixed upstream (RightPane keeps the canvas mounted across
  // 'loading'); this is defense-in-depth for within-instance re-key bursts.
  const DRAFT_LEAD_MS = 24;
  let draftTimer: ReturnType<typeof setTimeout> | null = null;
  let draftLeadTimer: ReturnType<typeof setTimeout> | null = null;
  // Perf logs ([bake-client]/[bake-worker]/finalize) opt-in via this flag.
  function bakeTimingsOn(): boolean {
    try { return localStorage.getItem('cad-bake-timings') === '1'; } catch { return false; }
  }

  // Compiled-script cache (client-exec perf): the compiled script depends ONLY
  // on (name, source) — NOT on params. So param SCRUBBING reuses the cached
  // script and skips the /compile round-trip, baking locally each tick. Keyed on
  // name|source; bounded LRU. Only successes are cached.
  type CompiledEntry = { supported: boolean; script?: string; scriptHash?: string; reason?: string; partColors?: any };
  const compileCache = new Map<string, CompiledEntry>();
  const COMPILE_CACHE_MAX = 24;
  async function getCompiled(name: string, src: string, signal: AbortSignal): Promise<CompiledEntry> {
    const key = `${name}|${src}`;
    const hit = compileCache.get(key);
    if (hit) { compileCache.delete(key); compileCache.set(key, hit); return hit; } // LRU touch
    const cr = await fetch('/api/primitives/compile', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, source: src }), signal,
    });
    const cd = await cr.json();
    const entry: CompiledEntry = { supported: !!cd?.supported, script: cd?.script, scriptHash: cd?.scriptHash, reason: cd?.reason, partColors: cd?.partColors };
    if (entry.supported && entry.script) {
      compileCache.set(key, entry);
      while (compileCache.size > COMPILE_CACHE_MAX) compileCache.delete(compileCache.keys().next().value as string);
    }
    return entry;
  }

  async function rebuildMesh(bust = false, segArg?: number) {
    if (!id) return;
    // segArg overrides the user's seg ONLY for this bake (coarse-during-drag).
    // It is NOT folded into the keyed $effect, so the draft pass can't re-trigger.
    const segUsed = segArg ?? effSegments;
    // P2 lazy-cutVC: bake the cutaway (cutVC) ONLY when the user is VIEWING the
    // cross-section. cutaway:true forces the compute; cutaway:FALSE (not undefined)
    // force-SKIPS it — the old `|| undefined` left it to the tri-count threshold,
    // which still computed the ~45ms cut on medium parts (g_dp_joint ~13.6k tris)
    // even with Cross-section OFF. Toggling it ON re-bakes (showCutaway is in both
    // the body + the keyed $effect), so no blank. The flag keys the fetch cache.
    const cutFlag = scene.showCutaway;
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
    // Crease angle for the baked smooth normals — BUILD-TIME, so it must be in
    // the request body (re-bakes). Sent only when it differs from the default 60
    // → the default request + cache key stay byte-identical to the legacy bake.
    const crease = (typeof scene.creaseAngle === 'number' && scene.creaseAngle !== 60) ? scene.creaseAngle : undefined;
    // "True round silhouette" — BUILD-TIME geometry smoothing, sent only when ON
    // (omitted → byte-identical default bake + cache key). Reuse the crease angle
    // as the sharp-edge threshold; tolerance defaults server/worker-side.
    const smooth = scene.roundSurface ? { minSharpAngle: scene.creaseAngle } : undefined;
    const body = JSON.stringify({ id, name, source: source ?? '', params: args, mode: source ? 'sandbox' : 'bundle', cutaway: cutFlag, colorOuter, colorInner, instanced: true, ...(segUsed ? { segments: segUsed } : {}), ...(warp ? { warp } : {}), ...(crease ? { creaseAngle: crease } : {}), ...(smooth ? { smooth } : {}) });
    const cached = bust ? undefined : cacheGet(`mesh:${body}`);
    if (cached) {
      geo = deserializeComponentResult({ full: cached.full, cutVC: cached.cutVC, instanced: cached.instanced });
      geoVersion++; meshStatus = 'ok'; err = null;
      return;
    }
    meshStatus = 'building';
    meshAc?.abort(); const ac = new AbortController(); meshAc = ac;
    // CLIENT-SIDE BAKE (PR3) — behind `localStorage.cad-client-bake === '1'`
    // (default OFF; server path below is the untouched fallback). Compile the
    // LIVE source → run the Manifold worker. The `{full,cutVC,instanced}` shape
    // matches the server exactly, so the scene needs no changes. zScale/xScale
    // stay render-time (not sent), keeping byte-parity with the server bake.
    const clientBake = scene.clientBake;
    if (clientBake && name) {
      try {
        // Cached compile (skips the /compile fetch on param scrubs — same source).
        const _tc0 = performance.now();
        const cd = await getCompiled(name, source ?? '', ac.signal);
        const _tCompile = performance.now() - _tc0;
        if (ac.signal.aborted) return;
        if (cd?.supported && cd.script) {
          const options = { cutaway: cutFlag, instanced: true,
            ...(segUsed ? { segments: segUsed } : {}), ...(warp ? { warp } : {}),
            ...(crease ? { creaseAngle: crease } : {}), ...(smooth ? { smooth } : {}), colorOuter, colorInner,
            // #86: color-by-source LUT from compile → client bake tints each
            // subpart in its own colour (a single override still wins in finalize).
            ...(cd.partColors ? { parts: cd.partColors } : {}) };
          const _tb0 = performance.now();
          const result = await bakeClient.run({ script: cd.script, scriptHash: cd.scriptHash, params: args, options });
          const _tBake = performance.now() - _tb0;
          if (ac.signal.aborted || isCancelled(result)) return;
          geo = result; geoVersion++; meshStatus = 'ok'; err = null; meshBackend = 'client';
          if (bakeTimingsOn()) { try { console.log(`[bake-client] compile=${_tCompile.toFixed(1)}ms · worker(bake+transfer)=${_tBake.toFixed(1)}ms · cutaway=${scene.showCutaway ? 'on' : 'off'} · seg=${segUsed ?? 'full(256)'}${segArg ? ' (draft)' : ''}`); } catch {} }
          return;
        }
        // unsupported by the client kernel → fall through to the server path.
      } catch (e: any) {
        if (e?.name === 'AbortError' || ac.signal.aborted) return;
        // any client-bake failure → fall through to the server path (fallback intact).
        console.warn('[client-bake] failed, falling back to server:', e?.message ?? e);
      }
    }
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
      geoVersion++; meshStatus = 'ok'; err = null; meshBackend = 'server';
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
  // TrueForm backend: run the client-side, MAIN-THREAD TrueForm kernel and build
  // a THREE.BufferGeometry from the result. Commit 3 renders a from-scratch
  // TrueForm box (proves the kernel loads + generates in-browser); a later commit
  // will run the part body through tf booleans. Errors surface the real WASM
  // message in the canvas + the parent badge (supported:false).
  let tfAc: AbortController | null = null;
  async function rebuildTf(_bust = false) {
    meshStatus = 'building'; brepReason = null; err = null;
    tfAc?.abort(); const ac = new AbortController(); tfAc = ac;
    try {
      const [{ getTfExample }, { tfMeshToGeo }, { ensureTf }] = await Promise.all([
        import('$lib/shared/tf_examples'),
        import('$lib/shared/trueform-adapter'),
        import('$lib/shared/trueform-client'),
      ]);
      if (ac.signal.aborted) return;
      // Warm the TrueForm kernel BEFORE timing so `tfMs` reflects the pure
      // GEOMETRY-BUILD time (revolve/boolean), NOT the one-time ~31MB WASM
      // download + pthread worker-pool init. ensureTf() is cached/idempotent,
      // so build()'s internal ensureTf then returns instantly — the init cost
      // is paid here, outside the timed window.
      await ensureTf();
      if (ac.signal.aborted) return;
      const t0 = performance.now();
      // Mirror the Manifold cutaway: the SAME `scene.showCutaway` toggle drives a
      // half-quadrant boolean cut on the TF solid. The cut result carries the two
      // exposed cut planes (`cutPlanes`); we feed them to the adapter so the
      // revealed cross-section renders GREY (interior) and the outer skin RED —
      // the same `cutVC` / `vertexColors` branch as the Manifold + BREP sections.
      // The Z-slider (scene.zFocus) pans the shared camera, so it applies here
      // too — no per-backend slider wiring needed.
      // Registry dispatch: resolve the demo name → its builder (fall back to
      // r_cyl if an unknown name ever arrives). The example CONTENT lives in
      // tf_examples/<name>.ts; this canvas just drives the kernel.
      const ex = getTfExample(tfDemo) ?? getTfExample('r_cyl');
      if (!ex) throw new Error(`unknown TF demo: ${tfDemo}`);
      const { data, stats, cutPlanes } = await ex.build({ cutaway: scene.showCutaway });
      if (ac.signal.aborted) return;
      if (cutPlanes) {
        const cutVC = tfMeshToGeo(data, undefined, { planes: cutPlanes });
        geo = { cutVC };
      } else {
        geo = { full: tfMeshToGeo(data) };
      }
      geoVersion++;
      tfMs = performance.now() - t0; meshStatus = 'ok'; err = null;
      const tris = data.faces.length / 3, verts = data.points.length / 3;
      // Surface tf's OWN topology verdict (the watertightness check) as the
      // reason line + console — the KNOWN TrueForm weakness is non-watertight
      // booleans / uncapped sweeps. A clean half-cut solid stays closed+manifold.
      if (stats) {
        brepReason =
          `${tfDemo}${cutPlanes ? ' · cutaway' : ''} · ${stats.closed ? 'watertight (closed)' : `open (${stats.boundaryLoops} boundary loop${stats.boundaryLoops === 1 ? '' : 's'})`}` +
          ` · ${stats.manifold ? 'manifold' : 'NON-manifold'} · χ=${stats.euler}` +
          (stats.closed ? ` · vol=${stats.volume.toFixed(2)}` : '');
        console.log('[tf] demo', tfDemo, cutPlanes ? '(cutaway)' : '', stats);
      }
      onBakeMeta?.({ cached: false, ms: tfMs, tris, verts, supported: true });
    } catch (e: any) {
      if (e?.name === 'AbortError' || ac.signal.aborted) return;
      err = 'TF: ' + (e?.message ?? e); meshStatus = 'error'; brepReason = 'TrueForm: ' + (e?.message ?? e);
      onBakeMeta?.({ cached: false, ms: 0, tris: 0, verts: 0, supported: false, reason: String(e?.message ?? e) });
    }
  }

  // Mesh FIRST, then GLB — so the fast mesh (~2 s) renders before the slow GLB
  // bake (~20 s) hogs Node's single thread. Each is gated by its prop so the
  // mesh-only 3D tab never triggers the GLB bake, and the lazy GLB tab never
  // re-bakes the mesh. BREP/TF route to their own bake paths.
  async function rebuild(bust = false, segArg?: number) {
    if (isTf) { await rebuildTf(bust); return; }
    if (isBrep) { await rebuildBrep(bust); return; }
    if (bakeMesh) await rebuildMesh(bust, segArg);
    if (effBakeGlb) rebuildGlb(bust);
  }

  // Two-phase bake (coarse-during-drag): bake a coarse mesh NOW for instant
  // feedback, then a full-res mesh (+ GLB) once changes idle for DRAFT_SETTLE_MS.
  // Continuous scrubbing keeps resetting the timer → only coarse bakes until the
  // user settles. Skipped (single full bake) for BREP, GLB-only, or already-coarse.
  function scheduleBake(bust = false) {
    // Cancel BOTH the pending draft-lead AND the pending full so a burst of
    // re-keys collapses to a single draft+full (coalesce).
    if (draftLeadTimer) { clearTimeout(draftLeadTimer); draftLeadTimer = null; }
    if (draftTimer) { clearTimeout(draftTimer); draftTimer = null; }
    const full = effSegments ?? 256;
    if (isBrep || isTf || !bakeMesh || full <= DRAFT_SEG) {
      // Single full bake (no draft phase) — still lead-debounced so a burst
      // collapses to one bake instead of one per key.
      draftLeadTimer = setTimeout(() => { draftLeadTimer = null; rebuild(bust); }, DRAFT_LEAD_MS);
      return;
    }
    // Coarse draft after a tiny lead (collapses bursts), then full on settle.
    draftLeadTimer = setTimeout(() => {
      draftLeadTimer = null;
      rebuildMesh(bust, DRAFT_SEG);                     // coarse mesh, ~instant
      draftTimer = setTimeout(() => { draftTimer = null; rebuild(false); }, DRAFT_SETTLE_MS); // full mesh + GLB on settle
    }, DRAFT_LEAD_MS);
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
    meshAc?.abort(); glbAc?.abort(); brepAc?.abort(); tfAc?.abort();
    if (draftTimer) { clearTimeout(draftTimer); draftTimer = null; }
    if (draftLeadTimer) { clearTimeout(draftLeadTimer); draftLeadTimer = null; }
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
    const key = isTf
      ? JSON.stringify({ b: 'tf', demo: tfDemo, src: brepSource ?? source ?? '', p: brepParams ?? {}, cut: scene.showCutaway })
      : isBrep
      ? JSON.stringify({ b: 'brep', src: brepSource ?? source ?? '', p: brepParams ?? {}, tol: effTol, cut: scene.showCutaway })
      : JSON.stringify({ id, args, source: source ?? '', cut: scene.showCutaway, colorOuter, colorInner, segments: effSegments, warpNonce: scene.warpBakeNonce, crease: scene.creaseAngle, round: scene.roundSurface, clientBake: scene.clientBake });
    if (!Scene || key === lastRebuildKey) return;
    lastRebuildKey = key;
    scheduleBake();
  });
  let lastGlbCut: boolean | null = null;
  $effect(() => {
    if (isBrep || isTf) return; // no GLB half in BREP/TF mode
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
    // Total slider travel = 1.1× the rendered part's z-length: 0.05·L (5%) of
    // headroom on EACH side of the extent → span = L + 2·(0.05·L) = 1.1·L. So the
    // thumb scrolls the look-at from just-above the top to just-below the bottom
    // and only ~5% past either end. zFocus 0 = the part centre. (Set pad = 0 for
    // EXACTLY the part length with no overshoot.)
    const pad = (max - min) * 0.05;
    return { min: min - cz - pad, max: max - cz + pad };
  });
  // Pan STEP scales with ZOOM so the slider stays in sync with what's framed:
  // the on-screen vertical span is 2·dist·tan(fov/2) (fov 45°, camera looks
  // along ±Y), so a step of (visible span)/120 keeps the pan resolution
  // proportional to the visible part length — fine when zoomed in, coarse when
  // zoomed out. Distance is to the PANNED target (partCenter + zFocus on z),
  // which is invariant under the pan itself, so dragging the slider never
  // changes its own step (no jitter); only zoom / orbit (scene.cam) does.
  // (zStep removed — the slider is now step="any"; a value-dependent step caused
  //  the thumb to re-snap mid-drag, which read as blocky scrolling on long parts.)
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

  // On a NEW part load: if this (PRIMARY) part has a SAVED view scale, APPLY it
  // and pin auto-normalize OFF so the user's saved z/x exaggeration sticks;
  // otherwise re-enable auto default-scale (so a manual scale on the previous
  // part doesn't leave the next one un-normalized). PrimitiveDualScene then
  // computes xScale/zScale from the new bbox. Reading `id` makes it the dep.
  // (A nested subpart never receives viewZScale/viewXScale, so its saved scale
  // can't override the parent/viewer scale.)
  $effect(() => {
    id; // eslint-disable-line no-unused-expressions — dependency only
    if (viewZScale != null || viewXScale != null) {
      if (viewZScale != null) scene.zScale = viewZScale;
      if (viewXScale != null) scene.xScale = viewXScale;
      scene.scaleAuto = false;
    } else {
      scene.scaleAuto = true;
    }
  });

  // #12: dismiss the X-dia / Z-depth scale popover on a click OUTSIDE it. The
  // toggle button itself is excluded so its own click still toggles (the open
  // click bubbles to window — without the guard it would immediately re-close).
  function closeScaleOnOutside(e: MouseEvent) {
    if (!scaleMenuOpen) return;
    const t = e.target as HTMLElement | null;
    if (t && t.closest('.pd-scale-menu, .pd-scale-btn')) return;
    scaleMenuOpen = false;
  }
</script>

<svelte:window onclick={closeScaleOnOutside} />

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
  <!-- Fit-vertical (#11): frame the WHOLE part length. Auto-on for long parts
       at load (bug #10 — long parts cut off until you scroll). -->
  <button class="pd-fit-btn" type="button" class:on={scene.fitLength}
    title="Fit the whole part length in view + centre the Z slider (toggle)"
    onclick={() => { scene.fitLength = !scene.fitLength; scene.zFocus = 0; scene.scaleAuto = true; }}>⇕ fit</button>
  <!-- Shade mode (Smooth/Auto/Flat) lives in the gear Shade control now — the
       canvas ◐ quick-toggle was removed 2026-06-18 to keep one home. -->
  <!-- Bake-backend badge (client-exec): which kernel produced the live mesh. -->
  {#if meshBackend && meshStatus === 'ok'}
    <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
    <span class="pd-backend-badge {meshBackend}" role="button" tabindex="-1"
      title={meshBackend === 'client' ? 'Baked client-side (Web Worker) — click to switch to server' : 'Baked server-side — click to switch to client'}
      onclick={() => { scene.clientBake = !scene.clientBake; try { localStorage.setItem('cad-client-bake', scene.clientBake ? '1' : '0'); } catch {} }}>
      {meshBackend === 'client' ? '⚡ client' : '☁ server'}</span>
  {/if}
  {#if scaleMenuOpen}
    <div class="pd-scale-menu">
      <div class="pd-scale-row">
        <span class="pd-scale-lbl">X-dia ×{scene.xScale.toFixed(2)}</span>
        <input type="range" min="0.25" max="8" step="0.25" bind:value={scene.xScale} oninput={() => (scene.scaleAuto = false)} />
      </div>
      <div class="pd-scale-row">
        <span class="pd-scale-lbl">Z-depth ×{scene.zScale.toFixed(2)}</span>
        <input type="range" min="0.05" max="2" step="0.05" bind:value={scene.zScale} oninput={() => (scene.scaleAuto = false)} />
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
      <!-- BREP tolerance only. The live-mesh "seg" override was removed (2026-06-17):
           it only CAPPED the part's segments param (no effect when the param was
           already lower) — confusing + redundant. The part's `segments` param is the
           control; coarse-during-drag still coarsens internally via DRAFT_SEG. -->
      <label class="pd-seg" title="OCCT linear deflection (tolerance) — lower = finer/slower">
        <span>tol</span>
        <input type="number" min="0.005" max="1" step="0.005" value={effTol}
          onchange={(e) => { const v = Number((e.currentTarget as HTMLInputElement).value); tolOverride = (Number.isFinite(v) && v > 0) ? v : undefined; }} />
      </label>
    {/if}
  </div>
  <!-- Z-pan: scroll the camera + look-at down the drilling axis (tall assemblies).
       Top = z 0 (top of the part), drag down to follow it deeper (Z-down). -->
  <div class="pd-zpan">
    <!-- Z-pan range is DERIVED from the rendered part's Z extent (zSpan, above)
         so full slider travel scrolls exactly from the top of the mesh/GLB to
         the bottom. step="any" → continuous: a dynamic step that depended on the
         slider's own zFocus re-snapped the thumb mid-drag (blocky on long parts). -->
    <input class="pd-zslider" type="range" min={zSpan.min} max={zSpan.max} step="any"
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
    <!-- Welded-CURVE engines (r_sweep along a path/spline, r_loft, r_surface,
         r_helical_surface) build NON-PLANAR quads, so flatShading exposes every
         section/path facet — forcing the user to add lots of points. Their smooth
         normals (calculateNormals(0,60)) are already baked; smooth-shade them so a
         ROUND tube reads round with FEW points (the 60° crease keeps genuine sharp
         section corners hard). Match the ENGINE id AND any PART that composes one of
         these engines (its meta.uses / body references the id) so spline-sweep parts
         smooth too — not just the bare engine preview. -->
    {@const usesWeldedCurve =
      typeof source === 'string' && /\br_(sweep|loft|surface|helical_surface)\b/.test(source)}
    <!-- BREP carries OCCT exact-surface normals → smooth-shade the solid so the
         true curvature reads (the cut half-section is faceted regardless).
         TrueForm (tf) is an exact-kernel boolean/generator: its output carries
         crease-aware normals from trueform-adapter (smooth curved walls, hard
         rims), so smooth-shade it too or flatShading facets every cylinder — a
         bored pipe reads blocky. tf-only; Manifold parts keep their heuristic. -->
    {@const smoothShadeAuto =
      isBrep ||
      isTf ||
      id === 'r_weld_extrude' ||
      id === 'r_sweep' || id === 'r_loft' || id === 'r_surface' || id === 'r_helical_surface' ||
      usesWeldedCurve ||
      (id === 'r_extrude' && Math.abs(twistArg) > 0.001)}
    <!-- The user's SceneControls "Shading" override wins over the per-part
         heuristic: 'auto' keeps the heuristic, 'smooth'/'flat' force it.
         Render-time only (a material flatShading flip — no re-bake). -->
    {@const smoothShade =
      scene.smoothShade === 'smooth' ? true
      : scene.smoothShade === 'flat' ? false
      : smoothShadeAuto}
    <Canvas {createRenderer}>
      <!-- Only one of mesh/GLB is baked per tab now → centre it (offset 0). -->
      <S {geo} {geoVersion} glbUrl={glbBlobUrl} showCutaway={scene.showCutaway} {smoothShade} {autoScaleOwner} overlays={overlays ?? []} offset={(bakeMesh && effBakeGlb) ? sceneOffset : 0} stackAxis={sceneStackAxis} />
    </Canvas>
    {#if showControls && SceneControls}{@const Controls = SceneControls}<Controls />{/if}
  {:else}
    <div class="pd-loading">loading…</div>
  {/if}
  {#if glbBlobUrl && !isBrep && !isTf}<button class="pd-dl" type="button" title="Download {id}.glb" onclick={downloadGlb}>⬇ GLB</button>{/if}
  {#if err}<div class="pd-err">{err}</div>{/if}
  <!-- BREP: no OCCT-buildable solid for this part (revolve / extrude / loft / CSG only).
       TF: reuses the same centred-message chrome for its "no path" / error text. -->
  {#if (isBrep || isTf) && brepReason}<div class="pd-brep-reason" class:pd-reason-bottom={isTf}>{brepReason}</div>{/if}
  <!-- Part stats at the bottom: tri / vert count (instanced → child × N).
       BREP appends the OCCT bake time. -->
  {#if stats}
    <div class="pd-stats" title={stats.instanced ? `${stats.childTris.toLocaleString()} tris/child × ${stats.count} instances` : ''}>
      {stats.tris.toLocaleString()} tris · {stats.verts.toLocaleString()} verts{stats.instanced ? ` · ×${stats.count} instanced` : ''}{#if isBrep && brepMs != null} · {Math.round(brepMs)}ms OCCT{/if}{#if isTf && tfMs != null} · {Math.round(tfMs)}ms TF{/if}{#if stats.stray > 0} · <span class="pd-stray" title="Near-zero-area (degenerate/sliver) triangles — usually coplanar strays a CSG boolean left at tilted coincident caps.">⚠ {stats.stray.toLocaleString()} stray</span> <button class="pd-stray-btn" type="button" onclick={removeStrays} title="Remove strays (v0): drops the near-zero-area triangles + re-welds. NOTE: for a curved-hollow CSG the genus stays corrupted (phantom handles) — this is cosmetic; the durable fix is the annular sweep. We'll refine the real removal later.">remove</button>{/if}
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
  .pd-fit-btn {
    position: absolute; top: 30px; left: 76px; z-index: 6;
    padding: 2px 8px; border: 1px solid #d6d3d1; border-radius: 4px;
    background: rgba(255,255,255,0.9); color: #57534e; cursor: pointer;
    font: 600 10px Arial; letter-spacing: 0.3px;
  }
  .pd-fit-btn:hover { background: #fff; border-color: #cc2222; color: #a02520; }
  .pd-fit-btn.on { background: #fef2f2; border-color: #cc2222; color: #a02520; }
  .pd-shade-btn {
    position: absolute; top: 30px; left: 130px; z-index: 6;
    padding: 2px 8px; border: 1px solid #d6d3d1; border-radius: 4px;
    background: rgba(255,255,255,0.9); color: #57534e; cursor: pointer;
    font: 600 10px Arial; letter-spacing: 0.3px; text-transform: capitalize;
  }
  .pd-shade-btn:hover { background: #fff; border-color: #6366f1; color: #4338ca; }
  .pd-backend-badge {
    position: absolute; top: 30px; left: 175px; z-index: 6;
    padding: 2px 8px; border-radius: 4px; font: 700 10px Arial; letter-spacing: 0.3px;
    pointer-events: auto; cursor: pointer; user-select: none;
  }
  .pd-backend-badge:hover { filter: brightness(0.96); }
  .pd-backend-badge.client { background: #ecfdf5; border: 1px solid #34d399; color: #047857; }
  .pd-backend-badge.server { background: #eff6ff; border: 1px solid #93c5fd; color: #1d4ed8; }
  .pd-bake-tools { position: absolute; top: 30px; left: 130px; z-index: 6; display: flex; align-items: center; gap: 4px; }
  .pd-mini-btn { padding: 2px 6px; border: 1px solid #d6d3d1; border-radius: 4px; background: rgba(255,255,255,0.9); color: #57534e; cursor: pointer; font: 600 11px Arial; }
  .pd-mini-btn:hover { background: #fff; border-color: #cc2222; color: #a02520; }
  .pd-seg { display: inline-flex; align-items: center; gap: 3px; font: 600 10px Arial; color: #57534e; background: rgba(255,255,255,0.9); border: 1px solid #d6d3d1; border-radius: 4px; padding: 1px 4px; }
  .pd-seg input { width: 40px; font: 10px ui-monospace, monospace; color: #57534e; border: 1px solid #e7e5e4; border-radius: 3px; padding: 1px 3px; background: #fff; }
  .pd-stats { position: absolute; bottom: 6px; left: 12px; z-index: 6; font: 600 10px ui-monospace, monospace; color: #78716c; background: rgba(255,255,255,0.82); border-radius: 3px; padding: 1px 6px; pointer-events: none; }
  .pd-stray { color: #b45309; font-weight: 700; }
  .pd-stray-btn { pointer-events: auto; cursor: pointer; font: 700 9px ui-monospace, monospace; color: #b45309; background: #fef3c7; border: 1px solid #f59e0b; border-radius: 3px; padding: 0 4px; margin-left: 2px; }
  .pd-stray-btn:hover { background: #fde68a; }
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
  /* TF topology verdict shows WITH a rendered part → anchor it at the bottom
     (above the stats line) instead of dead-centre, so it doesn't overlap. */
  .pd-brep-reason.pd-reason-bottom { top: auto; bottom: 28px; transform: translateX(-50%); }
  /* Vertical Z-pan slider, left edge. */
  /* Z-pan vertical slider on the RIGHT edge — keeps the left clear for the
     2D SVG overlay (and the 'Mesh (live)' label sitting top-left). */
  /* #11: half-height slider — anchor at the top and cap the column to ~half the
     pane (was top:56px→bottom:16px, i.e. nearly the full height). The slider is
     flex:1 inside, so halving the column halves the slider. */
  .pd-zpan { position: absolute; right: 6px; top: 56px; height: 46%; z-index: 6; display: flex; flex-direction: column; align-items: center; gap: 6px; }
  /* Vertical range slider — modern path: `writing-mode: vertical-lr` alone.
     Drop `appearance: slider-vertical` (deprecated in Chrome 124+, removal
     warned via the runtime banner). Default direction:ltr makes top=min
     bottom=max, which matches Z-down (top of part = z 0 = slider top). */
  .pd-zslider { writing-mode: vertical-lr; width: 16px; flex: 1 1 auto; min-height: 0; cursor: ns-resize; accent-color: #cc2222; }
  .pd-zreset { flex: 0 0 auto; width: 20px; height: 20px; border: 1px solid rgba(0,0,0,0.25); background: rgba(255,255,255,0.85); border-radius: 50%; cursor: pointer; font: 12px Arial; color: #555; line-height: 1; padding: 0; }
  .pd-zreset:hover { color: #cc2222; border-color: #cc2222; }
</style>
