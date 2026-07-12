<script module lang="ts">
  // Shared across ALL instances + survives unmount/remount (tab switches).
  const fetchCache = new Map<string, any>();
</script>

<script lang="ts">
  // One canvas showing the live mesh (left) + baked GLB (right) side-by-side
  // in a SINGLE WebGL context — replaces the stacked PrimitiveCanvas +
  // PrimitiveGlbCanvas (was 2 contexts per tab → the WebGL-context leak,
  // todo_webgl_context_leak). Geometry + GLB are both produced CLIENT-SIDE
  // (bake worker + glb-client); only backend='manifold-server' touches /preview.
  import { onMount, onDestroy } from 'svelte';
  import { Canvas } from '@threlte/core';
  import { WebGLRenderer } from 'three';
  import { deserializeComponentResult } from '$lib/engines/manifold/mesh-serial';
  import { bakeClient, isCancelled } from '$lib/engines/manifold/bake-client';
  import { brepResponseToGeo, type BrepPreviewResponse } from '$lib/engines/brep/brep-adapter';
  import { scene } from '$lib/shared/viewer/scene-state.svelte';

  let { id, name = id, description = '', args, source, showControls = true, showLabels = true, sceneOffset = 4.5, colorOuter = undefined, colorInner = undefined, opacity = undefined, texture = undefined, material = undefined, bakeMesh = true, bakeGlb = true, meshSegments = undefined, onRebuild = undefined, backend = 'manifold', brepSource = undefined, brepParams = undefined, tolerance = 0.05, onBakeMeta = undefined, onBakeTimings = undefined, viewZScale = undefined, viewXScale = undefined, overlays = undefined, autoScaleOwner = true, tfActual = false, tfRecipe = undefined, tfPending = false }: {
    id: string; name?: string; description?: string; args: (number | string)[]; source?: string; showControls?: boolean;
    /** Spline DIAGNOSTIC overlays (TODO #24) — plotted splines' resolved curves +
     *  control points, drawn INSIDE the live-mesh group so they align with the
     *  baked geometry. VIEW-ONLY; passed straight through to PrimitiveDualScene. */
    overlays?: import('$lib/shared/viewer/PrimitiveDualScene.svelte').SplineOverlay[];
    /** Saved per-part editor VIEW scale (VIEW-ONLY) for the PRIMARY open part.
     *  When set, opening this part APPLIES the saved z/x exaggeration to `scene`
     *  and disables auto-normalize (scene.scaleAuto = false); when both are
     *  undefined the part auto-normalizes on load as before. Only the editor's
     *  primary canvas passes these — a nested subpart never does, so a subpart's
     *  saved scale can't leak into the parent/viewer scale. */
    viewZScale?: number;
    viewXScale?: number;
    /** Geometry backend — EXPLICIT, never inferred, never falls back.
     *
     *  'manifold' (default, the MF_CLIENT tab + every main canvas) → compile on
     *    the server, bake in the client Manifold Web Worker. The ONLY backend the
     *    main canvas may use. A part the client kernel can't build is an ERROR;
     *    it is NOT re-run on the server (that hid bugs and poisoned the dev
     *    server's Manifold singleton — /plan 979).
     *  'manifold-server' (the MF_SERVER tab ONLY) → /api/primitives/preview.
     *    Manifold's API is synchronous and Node is single-threaded, so a heavy
     *    bake starves the event loop and wedges every route. Diagnosis + parity
     *    only; never auto-selected, never the main canvas.
     *  'brep' → /api/brep/preview (server-side OCCT true-curve mesh); the GLB
     *    half, segment dial + ⬇GLB are suppressed and the segment dial is
     *    relabelled to the OCCT linear-deflection `tol`.
     *  'tf' → the client-side, MAIN-THREAD TrueForm kernel
     *    ($lib/shared/trueform-client); like BREP it suppresses the GLB half. */
    backend?: 'manifold' | 'manifold-server' | 'brep' | 'tf';
    /** BREP mode: the emitted part source POSTed to /api/brep/preview. */
    brepSource?: string;
    /** BREP mode: param name → current value (graph.params order ↔ bake.args). */
    brepParams?: Record<string, number>;
    /** BREP mode: OCCT linear deflection (lower = finer). Seeds the in-canvas
     *  `tol` dial and is keyed into the fetch cache. Default 0.05. */
    tolerance?: number;
    /** BREP mode: surfaced bake meta after each fetch (drives the parent badge). */
    onBakeMeta?: (m: { cached: boolean; ms: number; tris: number; verts: number; supported: boolean; reason?: string; steps?: { imports: number; warm: number; build: number; mesh: number } }) => void;
    /** MF_CLIENT bake timings for the badge (#987). `compileMs` = the /compile
     *  round-trip (0 on a cache hit); `bakeMs` = worker bake + transfer + main-
     *  thread deserialize; `phases` = the worker's per-stage split; `cached` =
     *  an IndexedDB scriptHash hit (no bake ran). */
    onBakeTimings?: (m: { cached: boolean; compileMs: number; bakeMs: number; phases?: { build?: number; mesh?: number; cutaway?: number; finalize?: number; serialize?: number } }) => void;
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
    /** Part-level render OPACITY (0–1, VIEW-ONLY). <1 renders the part semi-
     *  transparent; passed straight to PrimitiveDualScene, which multiplies it
     *  by the scene x-ray slider. Undefined ⇒ fully opaque. NOT baked (a material
     *  property), so it never keys the fetch cache / re-bake. */
    opacity?: number;
    /** Part-level named material TEXTURE (G-MAT2, VIEW-ONLY) — passed straight
     *  to PrimitiveDualScene, which resolves it to a procedural map. undefined /
     *  unknown ⇒ no map (identical to today). NOT baked (a material property). */
    texture?: string;
    /** Part-level MATL PBR PRESET ('none'|'steel'|'aluminum'|'titanium'|'brass',
     *  VIEW-ONLY) — passed straight to PrimitiveDualScene, which resolves it
     *  (via materialPreset) to MeshStandardMaterial metalness/roughness + a
     *  metallic tint on the non-vertex-coloured (TF) fallback arm. undefined /
     *  'none' ⇒ the neutral material (identical to today). NOT baked. */
    material?: string;
    /** When false, the top 'Mesh (live)' + 'GLB (bake)' label chips are
     *  hidden — used by the typed-builder panes where the labels add
     *  visual clutter without information value (only one scene anyway). */
    showLabels?: boolean;
    /** Half-separation between the live mesh (-offset) and the GLB (+offset)
     *  along the drilling (Z) axis. Default 4.5. */
    sceneOffset?: number;
    /** Only the PRIMARY 3D-bake canvas owns the shared auto-normalize scale.
     *  GLB/BREP secondary canvases pass false so two mounted scenes can't
     *  ping-pong the shared scene.xScale/zScale (freeze fix, 2026-07-02). */
    autoScaleOwner?: boolean;
    /** TF backend only: when true, import the part's
     *  OWN baked Manifold mesh into the TF kernel — the user sees their real
     *  geometry in TrueForm + tf's independent watertight/manifold/χ verdict. */
    tfActual?: boolean;
    /** TF "actual" mode only: the graph compiled to a `TfRecipe` (graphToTf).
     *  When present AND fully supported (no UNSUPPORTED nodes), rebuildTf builds
     *  the part NATIVELY in TrueForm from this recipe (revolve/box/cyl/boolean/
     *  transform/warp ops). Absent or containing an unsupported node → the TF tab
     *  BLANKS with an error (no Manifold-mesh import — native-only, per user rule). */
    tfRecipe?: import('$lib/engines/trueform/graph-to-tf').TfRecipe;
    /** TF "actual" mode only: true while a COMPOSITE part's server recipe is
     *  still resolving (RightPane's /api/tf/compile round-trip). `tfRecipe` may
     *  transiently still hold the PREVIOUS resolved recipe (stale-but-supported),
     *  so building now would be a throwaway on stale topology + the fresh args —
     *  the double-build. While pending the keyed rebuild `$effect` HOLDS the
     *  current mesh (skips the bake) and fires exactly once when the fresh recipe
     *  lands. Distinct from "genuinely unsupported" (pending is false once ANY
     *  server resolve for the live graph lands → that still blanks+errors). */
    tfPending?: boolean;
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
  /** MF_SERVER backend — the ONLY code path in the app allowed to POST
   *  /api/primitives/preview for the live mesh. Reached exclusively from the
   *  MF_SERVER tab, which the user must click; nothing selects it implicitly. */
  let isServerMf = $derived(backend === 'manifold-server');
  let effBakeGlb = $derived((isBrep || isTf) ? false : bakeGlb);
  // TrueForm bake time (ms) for the current mesh — appended to the stats line.
  let tfMs = $state<number | null>(null);
  /** Collect the distinct UNSUPPORTED nodeTypes in a recipe (deep walk) — names
   *  the ops TrueForm can't build, for the native-only error message (the TF tab
   *  never imports a Manifold mesh — no native build ⇒ blank canvas + this reason). */
  function unsupportedOpsOf(r: import('$lib/engines/trueform/graph-to-tf').TfRecipe | undefined): string[] {
    const out = new Set<string>();
    const walk = (i: any) => {
      if (!i) return;
      if (i.op === 'UNSUPPORTED') out.add(i.nodeType ?? 'unknown');
      walk(i.obj); walk(i.arg); walk(i.child);
      if (Array.isArray(i.children)) i.children.forEach(walk);
    };
    (r?.instrs ?? []).forEach(walk);
    return [...out];
  }
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
      import('$lib/shared/viewer/PrimitiveDualScene.svelte'),
      import('$lib/shared/viewer/SceneControls.svelte'),
    ]);
    // No rebuild() here — setting Scene re-fires the keyed $effect below,
    // which owns ALL rebuild triggering (single path, no double-fetch).
    Scene = scn.default; SceneControls = controls.default;
  });

  /** GLB bytes → blob URL. Takes an ArrayBuffer now: the GLB is exported in the
   *  browser (glb-client.ts), not fetched as base64 from /bake-preview. */
  function setGlbBlob(buf: ArrayBuffer | null) {
    if (glbBlobUrl) URL.revokeObjectURL(glbBlobUrl);
    if (!buf) { glbBlobUrl = null; return; }
    glbBlobUrl = URL.createObjectURL(new Blob([buf], { type: 'model/gltf-binary' }));
  }

  // Module-scope fetch cache (2026-06-11) — survives unmount/remount.
  // Inactive /primitives tabs now UNMOUNT this component (WebGL-context
  // cap), so switching back would re-bake unchanged geometry. Cache the results for
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
  async function getCompiled(name: string, src: string, signal: AbortSignal, bust = false): Promise<CompiledEntry> {
    const key = `${name}|${src}`;
    // 🔄 force-refresh (bust) skips the cache READ so /compile is re-hit — the
    // fresh entry still overwrites the cache below. Otherwise LRU-touch + reuse.
    const hit = bust ? undefined : compileCache.get(key);
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
      geo = deserializeComponentResult({
        full: cached.full, cutVC: cached.cutVC, instanced: cached.instanced,
        parts: cached.parts, cutParts: cached.cutParts,
      });
      geoVersion++; meshStatus = 'ok'; err = null;
      return;
    }
    meshStatus = 'building';
    meshAc?.abort(); const ac = new AbortController(); meshAc = ac;
    // MF_CLIENT — the only backend the main canvas uses. Compile the LIVE source
    // on the server, bake in the Manifold Web Worker. The `{full,cutVC,instanced}`
    // shape matches MF_SERVER exactly, so the scene needs no changes.
    // zScale/xScale stay render-time (not sent), keeping byte-parity.
    //
    // NO FALLBACK, of any kind. Neither a client-bake FAILURE nor a client-kernel
    // capability GAP re-runs on the server. The old `catch → fetch('/preview')`
    // cost hours: a WASM trap in the browser worker reappeared as a mystery
    // *server* 400 (`emval_methodCallers[caller] is not a function`), poisoned the
    // dev server's Manifold singleton through the fallback request, and made the
    // backend badge look stuck on "server". The `supported === false` arm used to
    // be excused as "a capability gap, not a masked failure" and still silently
    // reached /preview — that is exactly the implicit server bake the MF_SERVER
    // tab exists to make explicit. Say so and stop; the user clicks MF_SERVER.
    if (!isServerMf) {
      if (!name) { err = 'client bake needs a part name'; meshStatus = 'error'; meshBackend = 'client'; return; }
      try {
        // Cached compile (skips the /compile fetch on param scrubs — same source).
        const _tc0 = performance.now();
        const cd = await getCompiled(name, source ?? '', ac.signal, bust);
        const _tCompile = performance.now() - _tc0;
        if (ac.signal.aborted) return;
        if (!cd?.supported || !cd.script) {
          err = `the client Manifold kernel cannot build this part${cd?.reason ? `: ${cd.reason}` : ''} — open the MF_SERVER tab to bake it on the server`;
          meshStatus = 'error'; meshBackend = 'client';
          return;
        }
        const options = { cutaway: cutFlag, instanced: true,
          ...(segUsed ? { segments: segUsed } : {}), ...(warp ? { warp } : {}),
          ...(crease ? { creaseAngle: crease } : {}), ...(smooth ? { smooth } : {}), colorOuter, colorInner,
          // #86: color-by-source LUT from compile → client bake tints each
          // subpart in its own colour (a single override still wins in finalize).
          ...(cd.partColors ? { parts: cd.partColors } : {}) };
        const _tb0 = performance.now();
        const result = await bakeClient.run({ script: cd.script, scriptHash: cd.scriptHash, params: args, options, bust });
        const _tBake = performance.now() - _tb0;
        if (ac.signal.aborted || isCancelled(result)) return;
        geo = result; geoVersion++; meshStatus = 'ok'; err = null; meshBackend = 'client';
        if (bakeTimingsOn()) { try { console.log(`[bake-client] compile=${_tCompile.toFixed(1)}ms · worker(bake+transfer)=${_tBake.toFixed(1)}ms · cutaway=${scene.showCutaway ? 'on' : 'off'} · seg=${segUsed ?? 'full(256)'}${segArg ? ' (draft)' : ''}`); } catch {} }
        // Report the REAL cost to the badge (#987). A cache hit skips the compile
        // fetch cost too, so compileMs only counts on a genuine bake.
        {
          const bm = (result as any)?.__bakeMeta;
          onBakeTimings?.({
            cached: !!bm?.cached,
            compileMs: bm?.cached ? 0 : _tCompile,
            bakeMs: _tBake,
            phases: bm?.phases,
          });
        }
        return;
      } catch (e: any) {
        if (e?.name === 'AbortError' || ac.signal.aborted) return;
        const msg = String(e?.message ?? e);
        console.error('[bake-client] FAILED (no fallback):', msg);
        err = `client bake failed: ${msg}`;
        meshStatus = 'error';
        meshBackend = 'client';
        return;
      }
    }
    // MF_SERVER — the explicit, isolated server bake. See the `backend` prop doc.
    try {
      const r = await fetch('/api/primitives/preview' + (bust ? '?bust=1' : ''), {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body,
        signal: ac.signal,
      });
      if (ac.signal.aborted) return;
      if (!r.ok) { err = `Preview ${r.status}`; meshStatus = 'error'; return; }
      const data = await r.json();
      cachePut(`mesh:${body}`, { full: data.full, cutVC: data.cutVC, instanced: data.instanced, parts: data.parts, cutParts: data.cutParts });
      geo = deserializeComponentResult({
        full: data.full, cutVC: data.cutVC, instanced: data.instanced,
        parts: data.parts, cutParts: data.cutParts,
      });
      geoVersion++; meshStatus = 'ok'; err = null; meshBackend = 'server';
    } catch (e: any) { if (e?.name !== 'AbortError') { err = String(e?.message ?? e); meshStatus = 'error'; } }
  }
  // GLB — exported IN THE BROWSER from the client worker's bake (glb-client.ts).
  // It used to POST /api/primitives/bake-preview, which ran a SECOND synchronous
  // Manifold bake on Node's only thread; opening the GLB tab on a big part
  // stalled every route. Same kernel, same mesh, no server.
  async function rebuildGlb(bust = false) {
    if (!id || !name) return;
    const body = JSON.stringify({ id, name, source: source ?? '', args, cut: glbCut, colorOuter, colorInner, segments: effSegments });
    const cachedBuf = bust ? undefined : cacheGet(`glb:${body}`);
    if (cachedBuf) { setGlbBlob(cachedBuf); glbStatus = 'ok'; return; }
    glbStatus = 'building';
    glbAc?.abort(); const ac = new AbortController(); glbAc = ac;
    try {
      const cd = await getCompiled(name, source ?? '', ac.signal, bust);
      if (ac.signal.aborted) return;
      if (!cd?.supported || !cd.script) {
        err = `GLB: the client Manifold kernel cannot build this part${cd?.reason ? `: ${cd.reason}` : ''}`;
        glbStatus = 'error'; return;
      }
      // `instanced:false` — the GLB must carry the real merged/exploded meshes,
      // not a canonical child plus transforms (the SVG pane learned this too).
      const segUsed = effSegments;
      const options = { cutaway: glbCut, instanced: false,
        ...(segUsed ? { segments: segUsed } : {}), colorOuter, colorInner,
        ...(cd.partColors ? { parts: cd.partColors } : {}) };
      const result: any = await bakeClient.run({ script: cd.script, scriptHash: cd.scriptHash, params: args, options, bust });
      if (ac.signal.aborted || isCancelled(result)) return;
      const { exportGlbClient } = await import('$lib/graph/glb-client');
      // A cut GLB exports the half-section (cutVC); otherwise the solid.
      const parts = glbCut ? result.cutParts : result.parts;
      const full = glbCut ? result.cutVC : result.full;
      // Only a part with a REAL colour source keeps COLOR_0 — see glb-client.ts.
      const coloured = !!(colorOuter || colorInner || cd.partColors?.active);
      const buf = await exportGlbClient({ full, parts, name, coloured });
      if (ac.signal.aborted) return;
      cachePut(`glb:${body}`, buf);
      setGlbBlob(buf);
      glbStatus = 'ok';
    } catch (e: any) { if (e?.name !== 'AbortError') { err = `GLB export failed: ${String(e?.message ?? e)}`; glbStatus = 'error'; } }
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
    // Send the part's colours so the server bakes the CUT half-section's
    // outer/inner vertex colours from the real appearance instead of the legacy
    // red/grey (#997) — the SAME colorOuter/colorInner the MF + GLB requests send
    // above. Undefined ⇒ omitted ⇒ brep-occt falls back to red/grey (back-compat).
    const body = JSON.stringify({ source: brepSource ?? source ?? '', paramValues: brepParams ?? {}, tolerance: effTol, cut, colorOuter, colorInner });
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
      const _tImp0 = performance.now();
      // The geometry BUILD (executeTfRecipe / warpMeshJS / boolean fold)
      // now runs OFF the main thread in `tf-worker.ts` via `tf-bake-client` — the
      // TF tab used to jank the UI because it built inline here (like the pre-worker
      // Manifold bake). THREE stays main-thread: the worker returns RAW mesh data,
      // `tfMeshToGeo` runs below. The pure `recipeHasUnsupported` guard stays here
      // (no WASM) so the native-only error path is instant + the worker only ever
      // gets buildable work.
      const [{ tfMeshToGeo, hexToRgb01 }, { recipeHasUnsupported }, { tfBakeClient, isTfCancelled }, { materialPreset }, { warpVertex }] = await Promise.all([
        import('$lib/engines/trueform/trueform-adapter'),
        import('$lib/engines/trueform/tf_examples/execute'),
        import('$lib/engines/trueform/tf-bake-client'),
        import('$lib/shared/viewer/material-preset'),
        import('$lib/graph/warp-geom'),
      ]);
      const importsMs = performance.now() - _tImp0; // dynamic-import cost (0 after 1st)
      if (ac.signal.aborted) return;
      // "actual" mode picks a NATIVE TrueForm build (from the graph→TF recipe — a
      // real part built in tf from its ops). Native requires a recipe with NO
      // unsupported node (tf has no extrude/loft → those aren't buildable natively).
      const useNative = tfActual && !!tfRecipe && !recipeHasUnsupported(tfRecipe);
      // STRICT NATIVE-ONLY (user rule): the TF tab NEVER imports the Manifold
      // mesh. If TrueForm has no native builder for the part, we BLANK the canvas
      // and surface WHY — no silent Manifold stand-in (same "no fallback = error"
      // philosophy as /wells). "actual" mode is native-recipe-or-error.
      if (tfActual && !useNative) {
        const reason = tfRecipe
          ? `TrueForm has no native builder for: ${unsupportedOpsOf(tfRecipe).join(', ') || 'unknown op(s)'}`
          : 'no TrueForm recipe for this graph yet (composite still resolving, or no TF path)';
        geo = {}; geoVersion++;
        meshStatus = 'error'; err = null; tfMs = null;
        brepReason = `TF · ${name ?? id} · ✖ not built natively — ${reason}`;
        onBakeMeta?.({ cached: false, ms: 0, tris: 0, verts: 0, supported: false, reason });
        return;
      }
      const t0 = performance.now();
      // Mirror the Manifold cutaway: the SAME `scene.showCutaway` toggle drives a
      // half-quadrant boolean cut on the TF solid (in the worker). The cut result
      // carries the two exposed cut planes (`cutPlanes`); we feed them to the
      // adapter so the revealed cross-section renders GREY (interior) / outer skin
      // RED — the same `cutVC` / `vertexColors` branch as Manifold + BREP. The
      // Z-slider (scene.zFocus) pans the shared camera, so it applies here too.
      // Build dispatch — NATIVE-ONLY (no Manifold import anywhere), OFF-THREAD:
      //  • NATIVE ("actual") — execute the graph→TF recipe in the worker.
      //  • DEMO — registry dispatch in the worker (falls back to r_cyl).
      // The worker warms the kernel + builds; on a worker-TRANSPORT failure the
      // client transparently re-runs the same build on the main thread. A genuine
      // BUILD failure REJECTS → the outer catch blanks the canvas + shows the reason.
      const result = await tfBakeClient.run(
        { mode: 'native', recipe: tfRecipe!, cutaway: scene.showCutaway },
      );
      if (ac.signal.aborted || isTfCancelled(result)) return;
      // Worker-reported timings: warm (one-time ~31MB WASM + pthread pool) + build
      // (the TF geometry work). Fall back to a main-thread delta if absent.
      const tim = (result as any).__timings as { warm: number; build: number } | undefined;
      const warmMs = tim?.warm ?? 0;
      const buildMs = tim?.build ?? (performance.now() - t0);
      const { data, stats, cutPlanes, fullData, parts, cutParts } = result;
      // Scene SINE-WARP → bake it into the TF mesh vertices (mirrors Manifold's
      // finalizeManifold `applyWarp`, the SAME `amp·sin(z·freq)` math via the shared
      // `warpVertex`). TF returns raw point arrays, so we displace them IN PLACE
      // before `tfMeshToGeo` (which recomputes normals from the warped positions).
      // A pure per-vertex position transform — NOT a subdivision/mesh-rewrite, so
      // Rule 25's OOB warning (subdividing a welded MeshGL) doesn't apply. The
      // toggle re-triggers this bake via `warpNonce` in the effect key above.
      // CAVEAT (needs live check): a coarse native TF build may chord the sine
      // (no build-time Z-densify like Manifold's `_axialMaxZSpan`), and cutaway+warp
      // together can slightly mis-classify the grey interior (cutPlanes aren't warped).
      const sceneWarp = scene.warpEnabled ? { amp: scene.warpAmp, freq: scene.warpFreq, axis: (scene.warpAxis === 'y' ? 'y' : 'x') as 'x' | 'y' } : undefined;
      if (sceneWarp) {
        const seen = new Set<object>();
        const t: [number, number, number] = [0, 0, 0];
        const warpPts = (pts?: number[] | Float32Array) => {
          if (!pts || seen.has(pts as object)) return;
          seen.add(pts as object);
          for (let i = 0; i + 2 < pts.length; i += 3) {
            t[0] = pts[i]; t[1] = pts[i + 1]; t[2] = pts[i + 2];
            warpVertex(t, sceneWarp.amp, sceneWarp.freq, sceneWarp.axis);
            pts[i] = t[0]; pts[i + 1] = t[1]; pts[i + 2] = t[2];
          }
        };
        warpPts(data?.points); warpPts(fullData?.points);
        parts?.forEach((p) => warpPts(p.data?.points));
        cutParts?.forEach((p) => warpPts(p.data?.points));
      }
      const _tMesh0 = performance.now();
      // Assemble BOTH meshes + parts TOGETHER (mirrors Manifold's {full,cutVC}) so
      // the cross-section toggle is a pure VIEW-SWITCH with NO re-bake and never
      // blanks (BUG 1). When a cutaway ran, `data` is the CUT section (+cutPlanes)
      // and `fullData` is the UNCUT solid; otherwise `data` IS the full solid and
      // `fullData` is absent → `full` falls back to `data`. `parts` (per-part
      // material) is built regardless of cutaway (BUG 2) and rides on `geo` so the
      // full view always shows its material; the scene shows the merged grey/red
      // section on the cut view (per-part material on the cut is out of scope, v1).
      const full = tfMeshToGeo(fullData ?? data);
      const cutVC = cutPlanes ? tfMeshToGeo(data, undefined, { planes: cutPlanes }) : undefined;
      // PER-PART CUT geo (v2): when a cutaway ran on an appearance-bearing recipe,
      // each part's cut mesh is section-coloured with its OUTER skin in the part's
      // material tint (steel/aluminum/…, via materialPreset — an explicit colorOuter
      // override wins) and the revealed interior left GREY (SECTION_INNER default) so
      // the cross-section cue survives. Rendered with per-part metalness/roughness in
      // the scene's per-part-cut arm; falls back to the merged grey/red `cutVC` when
      // absent. Outer omitted (→ adapter red default) when the part has no material.
      const cutPartGeos = cutPlanes && cutParts && cutParts.length
        ? cutParts.map((p) => {
            const a = p.appearance ?? {};
            const outerHex = a.colorOuter ?? materialPreset(a.material).color;
            const outer = outerHex ? hexToRgb01(outerHex) : undefined;
            return { geo: tfMeshToGeo(p.data, undefined, { planes: cutPlanes, outer }), appearance: p.appearance };
          })
        : null;
      geo = {
        full,
        ...(cutVC ? { cutVC } : {}),
        ...(parts && parts.length
          ? { parts: parts.map((p) => ({ geo: tfMeshToGeo(p.data), appearance: p.appearance })) }
          : {}),
        ...(cutPartGeos && cutPartGeos.length ? { cutParts: cutPartGeos } : {}),
      };
      const meshMs = performance.now() - _tMesh0; // TF mesh → THREE.BufferGeometry (normals/weld)
      geoVersion++;
      // Pure geometry cost = worker build + main-thread mesh-convert (excludes the
      // one-time kernel warm, reported separately in steps.warm).
      tfMs = buildMs + meshMs; meshStatus = 'ok'; err = null;
      const tris = data.faces.length / 3, verts = data.points.length / 3;
      // Surface tf's OWN topology verdict (the watertightness check) as the
      // reason line + console — the KNOWN TrueForm weakness is non-watertight
      // booleans / uncapped sweeps. A clean half-cut solid stays closed+manifold.
      // The mesh shown is ALWAYS built by TrueForm natively — no Manifold import
      // path — so the verdict always leads with "TF BAKE".
      const label = `TF BAKE · ${name ?? id}`;
      if (stats) {
        brepReason =
          `${label}${cutPlanes ? ' · cutaway' : ''} · ${stats.closed ? 'watertight (closed)' : `open (${stats.boundaryLoops} boundary loop${stats.boundaryLoops === 1 ? '' : 's'})`}` +
          ` · ${stats.manifold ? 'manifold' : 'NON-manifold'} · χ=${stats.euler}` +
          (stats.closed ? ` · vol=${stats.volume.toFixed(2)}` : '');
        console.log('[tf]', label, cutPlanes ? '(cutaway)' : '', stats);
      }
      onBakeMeta?.({ cached: false, ms: tfMs, tris, verts, supported: true,
        steps: { imports: importsMs, warm: warmMs, build: buildMs, mesh: meshMs } });
    } catch (e: any) {
      if (e?.name === 'AbortError' || ac.signal.aborted) return;
      // NATIVE-ONLY: a TrueForm build failure blanks the canvas (no Manifold
      // stand-in) and shows the reason. The user must see WHY, not a fake mesh.
      geo = {}; geoVersion++; tfMs = null;
      err = 'TF: ' + (e?.message ?? e); meshStatus = 'error';
      brepReason = `TF · ${name ?? id} · ✖ TrueForm build failed — ${e?.message ?? e}`;
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
      // `rcp` = the compiled recipe signature: "actual" swaps the client recipe
      // (composites → UNSUPPORTED) for the server-inlined one ASYNCHRONOUSLY, and
      // only the NESTED ops change (s_tube stays booleanDifference at the root), so
      // the whole recipe must be in the key or the native re-bake never fires.
      ? JSON.stringify({ b: 'tf', actual: tfActual, id, src: brepSource ?? source ?? '', p: tfActual ? args : (brepParams ?? {}), rcp: tfActual && tfRecipe ? tfRecipe : '', seg: effSegments, cut: scene.showCutaway, warpNonce: scene.warpBakeNonce })
      : isBrep
      ? JSON.stringify({ b: 'brep', src: brepSource ?? source ?? '', p: brepParams ?? {}, tol: effTol, cut: scene.showCutaway })
      // `b` keeps MF_CLIENT and MF_SERVER on separate cache entries, so the two
      // tabs can show their meshes side by side (that IS the parity check).
      : JSON.stringify({ b: backend, id, args, source: source ?? '', cut: scene.showCutaway, colorOuter, colorInner, segments: effSegments, warpNonce: scene.warpBakeNonce, crease: scene.creaseAngle, round: scene.roundSurface });
    if (!Scene) return;
    // TF composite parts: while the server recipe is still resolving, `tfRecipe`
    // may still expose the PREVIOUS (stale-but-supported) recipe, so an edit
    // (args changed) would trigger a throwaway bake on stale topology before the
    // fresh recipe lands — the double-build. Hold the current mesh; when tfPending
    // flips false the fresh recipe has landed → this effect re-runs (tfPending is
    // a dep) with the new `key` and bakes exactly once. Reading tfPending here is
    // deliberate so it stays reactive. We DON'T advance lastRebuildKey while
    // pending, so the post-resolve key comparison still fires the single bake.
    if (isTf && tfActual && tfPending) return;
    if (key === lastRebuildKey) return;
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

  // #12: dismiss the Radial / Z-depth scale popover on a click OUTSIDE it. The
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
       exaggerate the radial (X+Y) diameter and compress the Z-depth (view-only)
       so long thin tools stay readable without losing diametric detail. -->
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
  <!-- Bake-backend badge — REPORTS which kernel produced the live mesh; it is not
       a switch. The backend is chosen by which tab you are on (MF_CLIENT /
       MF_SERVER), never by a hidden toggle that silently moves every canvas in
       the app onto the single-threaded server bake. -->
  {#if meshBackend && meshStatus === 'ok'}
    <span class="pd-backend-badge {meshBackend}"
      title={meshBackend === 'client'
        ? 'MF_CLIENT — baked in the browser (Manifold Web Worker)'
        : 'MF_SERVER — baked on the server (/api/primitives/preview)'}>
      {meshBackend === 'client' ? '⚡ client' : '☁ server'}</span>
  {/if}
  {#if scaleMenuOpen}
    <div class="pd-scale-menu">
      <div class="pd-scale-row">
        <span class="pd-scale-lbl">Radial ×{scene.xScale.toFixed(2)}</span>
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
      typeof source === 'string' && /\br_(sweep|loft|surface|helical_surface|revolve)\b/.test(source)}
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
      // r_revolve is a welded surface-of-revolution — its curved side wall (≤60°
      // facets) should shade smooth in the Manifold tab too (matching TF). The
      // 60° crease keeps genuine sharp edges (cap rims, profile steps) hard, so a
      // revolve reads round while a cube unioned in stays faceted. Composed parts
      // that call r_revolve (g_shaft/g_collar/g_dp_*) match via usesWeldedCurve.
      id === 'r_revolve' ||
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
      <S {geo} {geoVersion} glbUrl={glbBlobUrl} showCutaway={scene.showCutaway} {smoothShade} {autoScaleOwner} opacity={opacity ?? 1} {texture} {colorOuter} {colorInner} {material} overlays={overlays ?? []} offset={(bakeMesh && effBakeGlb) ? sceneOffset : 0} />
    </Canvas>
    {#if showControls && SceneControls}{@const Controls = SceneControls}<Controls />{/if}
  {:else}
    <div class="pd-loading">loading…</div>
  {/if}
  {#if glbBlobUrl && !isBrep && !isTf}<button class="pd-dl" type="button" title="Download {id}.glb" onclick={downloadGlb}>⬇ GLB</button>{/if}
  {#if err}<div class="pd-err">{err}</div>{/if}
  <!-- BREP: no OCCT-buildable solid for this part (revolve / extrude / loft / CSG only).
       TF: reuses the same centred-message chrome for its "no path" / error text. -->
  {#if (isBrep || isTf) && brepReason}<div class="pd-brep-reason" class:pd-reason-bottom={isTf} class:pd-reason-warn={isTf && meshStatus === 'error'}>{brepReason}</div>{/if}
  <!-- Part stats at the bottom: tri / vert count (instanced → child × N).
       BREP appends the OCCT bake time. -->
  {#if stats}
    <div class="pd-stats" title={stats.instanced ? `${stats.childTris.toLocaleString()} tris/child × ${stats.count} instances` : ''}>
      {stats.tris.toLocaleString()} tris · {stats.verts.toLocaleString()} verts{stats.instanced ? ` · ×${stats.count} instanced` : ''}{#if isBrep && brepMs != null} · {Math.round(brepMs)}ms OCCT{/if}{#if isTf && tfMs != null} · {Math.round(tfMs)}ms TF{/if}{#if stats.stray > 0} · <span class="pd-stray" title="Near-zero-area (degenerate) triangles — usually a CSG boolean at tilted coincident caps.">⚠ {stats.stray.toLocaleString()} stray</span> <button class="pd-stray-btn" type="button" onclick={removeStrays} title="Drop degenerate tris + re-weld (cosmetic — genus unchanged; durable fix = annular sweep).">remove</button>{/if}
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
  /* "actual" fell back to the imported MANIFOLD mesh (not a native TF build) —
     read it as a warning, not a normal verdict. */
  .pd-brep-reason.pd-reason-warn { color: #b91c1c; border-color: #fca5a5; background: rgba(254,242,242,0.96); }
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
