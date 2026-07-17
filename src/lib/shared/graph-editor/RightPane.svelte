<script lang="ts">
  // ─────────────────────────────────────────────────────────────────────────
  // RightPane — the node-graph editor's right-hand tabbed column.
  //
  // Extracted from GraphEditorPane (modularize P5/G5). Hosts the 6 tabs:
  //   bake (3D mesh / 2D profile) · source · md · svg · glb · brep.
  // Owns its own tab selection + persistence, the lazy canvas imports, the
  // BREP param-value derive + cached/fresh badge, and the SVG-tab on-demand
  // coarse-mesh bake. PARENT keeps the bake result, drawingMd, cutaway/rebuild
  // state + the functions that mutate them — passed in as props / callbacks.
  //
  // The 2D profile preview (profile-mode bake tab) is a PARENT-scoped snippet:
  // it stays wired to the parent's polygon-drag + tooltip machinery (and its
  // `.ge-profile-2d*` styles live in the parent because the snippet DOM carries
  // the parent's scope hash). We just render it here.
  // ─────────────────────────────────────────────────────────────────────────
  import { onMount } from 'svelte';
  import type { Snippet } from 'svelte';
  // TF-tab demo registry — the dropdown list + dispatch names (one file per demo
  // graph → TrueForm recipe compiler (pure, no WASM). Lets the TF tab's "actual"
  // mode build the part NATIVELY in tf from its graph ops instead of importing
  // the baked Manifold mesh.
  import { graphToTf } from '$lib/engines/trueform/graph-to-tf';
  import { recipeHasUnsupported as recipeHasUnsupportedLocal, tfServerKey, tfRecipePending as computeTfRecipePending } from './tf-recipe-timing';
  // Pure MF_CLIENT bake-badge timing math (#987) — sum the worker's per-phase
  // timings; unit-tested in tests/bake-badge.test.ts.
  import { sumBakeTimings, type ClientBakeMeta } from './bake-badge';
  // Embed feature-flags: which tabs are available (RightPaneTab === RightTab).
  import type { RightPaneTab } from './embed-config';

  type RightTab = 'bake' | 'source' | 'md' | 'svg' | 'glb' | 'brep' | 'brepsvg' | 'tf' | 'mfserver';

  let {
    /* ── INPUT (parent → pane) — pass STABLE references ── */
    bake,                          // bake result object | 'loading' | false (parent state)
    exemplarId,                    // part id / geom-fn name
    paramDefaults,                 // $derived number[] from graph.params (stable per graph)
    graph,                         // composition graph (for brepParamValues + colours)
    hasSolidProducer,              // 3D-bake vs 2D-profile bake tab
    active = true,                 // tab/pane visibility gate (props.active in parent)
    tabs = null,                   // embed config: which tab ids to show (null = ALL)
    legacyLoad = null,             // legacy-load banner state
    sourceText,                    // emitted .asm.ts source
    rebuildStatus = null,
    restartBusy = false,
    restartStatus = null,
    mdAiBusy = false,
    splineOverlays = undefined,    // TODO #24 — plotted-spline diagnostic overlays for the 3D bake
    autoTf = true,                 // false ⇒ never LAND on the TF tab from persisted state (/wells)
    /* ── BINDABLE (shared two-way) ── */
    rightTab = $bindable('bake'),  // pane owns persistence; parent sets 'source' on legacy load
    drawingMd = $bindable(''),     // parent state (feeds emitGraph) — bound by the MD textarea
    /* ── CALLBACKS (pane → parent mutations) ── */
    onRebuild,                     // parent rebuildCache — clears cache + re-bakes
    onRestart,                     // parent restartDevServer
    onGenerateMd,                  // parent generateMdWithAi — sets drawingMd
    /* ── SNIPPET ── */
    profilePreview,                // parent-scoped 2D profile preview (drag-wired)
  }: {
    bake: any;
    exemplarId: string;
    paramDefaults: number[];
    graph: any;
    hasSolidProducer: boolean;
    active?: boolean;
    /** Embed feature-flag: the resolved set of tab ids to show (from
     *  embed-config.ts). `null`/absent = every tab (byte-for-byte the full UI).
     *  A restricted list hides the tab buttons not in it; a persisted/active
     *  tab that's now hidden is clamped to the first visible one. */
    tabs?: readonly RightPaneTab[] | null;
    /** `false` ⇒ the persisted `ge-right-tab` is never allowed to restore to 'tf'.
     *  The TF tab button stays — the user can still ASK for TF by clicking it —
     *  but a stale localStorage from /primitives must not silently make /wells
     *  open on a kernel that traps on well geometry. */
    autoTf?: boolean;
    legacyLoad?: { id: string; reason: 'no-graph' | 'fetch-failed'; origin?: string } | null;
    sourceText: string;
    rebuildStatus?: string | null;
    restartBusy?: boolean;
    restartStatus?: string | null;
    mdAiBusy?: boolean;
    /** TODO #24 — plotted-spline diagnostic overlays; forwarded to the 3D bake. */
    splineOverlays?: import('$lib/shared/viewer/PrimitiveDualScene.svelte').SplineOverlay[];
    rightTab?: RightTab;
    drawingMd?: string;
    onRebuild?: () => void;
    onRestart?: () => void;
    onGenerateMd?: () => void;
    profilePreview?: Snippet;
  } = $props();

  // ─── Lazy canvas imports (mesh+GLB dual canvas + SVG view) ─────────────────
  let PrimitiveDualCanvas = $state<any>(null);
  let PrimitiveSvgView = $state<any>(null);
  onMount(async () => {
    try {
      const mod = await import('$lib/shared/viewer/PrimitiveDualCanvas.svelte');
      PrimitiveDualCanvas = mod.default;
    } catch { /* canvas unavailable */ }
  });
  onMount(async () => {
    try {
      const mod = await import('$lib/shared/svg/PrimitiveSvgView.svelte');
      PrimitiveSvgView = mod.default;
    } catch { /* svg view unavailable */ }
  });

  // ─── Keep the 3D canvas MOUNTED across the `bake==='loading'` sentinel ─────
  // `bake` cycles object → 'loading' → object on EVERY re-bake (first load also
  // fires several as expected-params / drift settle during hydration). If the
  // template swaps the canvas out for a "baking…" placeholder on each 'loading',
  // the PrimitiveDualCanvas UNMOUNTS + REMOUNTS every cycle — and a fresh canvas
  // instance resets its content-key bake dedup (lastRebuildKey='') so it re-bakes
  // the SAME geometry ~4× on load, churning the main thread (which now runs the
  // bake, client-bake being default) → node press/drag feels laggy right after a
  // part opens. Holding the last SUCCESSFUL bake lets us render the canvas from it
  // during the transient 'loading', keeping ONE instance alive: identical
  // successive (source,args) collapse to a single bake via the canvas's own key
  // dedup, while a REAL edit changes them → the key flips → a fresh bake (bake
  // freshness preserved — no stale geometry). A genuine bake ERROR (bake.ok
  // false) still replaces the canvas with the error panel below.
  let lastGoodBake = $state<any>(null);
  $effect(() => {
    if (typeof bake === 'object' && bake && bake.ok) lastGoodBake = bake;
  });
  // What the canvas + bake-meta render from: the live bake when it's a good
  // object, else the last good one (so 'loading'/transient states don't remount).
  const displayBake = $derived(
    (typeof bake === 'object' && bake && bake.ok) ? bake : lastGoodBake,
  );

  // ─── Tab selection + persistence (ge-right-tab) ───────────────────────────
  onMount(() => {
    try {
      const t = localStorage.getItem('ge-right-tab');
      if (t === 'tf' && !autoTf) return; // /wells: keep the default 'bake'; TF only on an explicit click
      // MF_SERVER is NEVER restored. It runs Manifold synchronously on Node's
      // only thread; a page reload that silently reopened it would bake a whole
      // well on the server and wedge every route. One deliberate click, always.
      if (t === 'mfserver') return;
      if (t === 'bake' || t === 'source' || t === 'md' || t === 'svg' || t === 'glb' || t === 'brep' || t === 'brepsvg' || t === 'tf') rightTab = t;
    } catch { /* localStorage blocked — fine */ }
  });
  function setRightTab(t: RightTab) {
    rightTab = t;
    try { localStorage.setItem('ge-right-tab', t); } catch { /* ignore */ }
  }

  // ─── Embed tab gating ─────────────────────────────────────────────────────
  // `tabs` (null = full UI) restricts which tab BUTTONS render. `tabOn` is the
  // per-button gate; when a hidden tab is the active/persisted one, clamp to the
  // first visible tab so the pane never lands on a tab whose button is gone.
  // Default (tabs === null) keeps every button + never clamps → unchanged UI.
  function tabOn(t: RightTab): boolean {
    return !tabs || tabs.includes(t as RightPaneTab);
  }
  $effect(() => {
    if (tabs && tabs.length > 0 && !tabs.includes(rightTab as RightPaneTab)) {
      rightTab = tabs[0] as RightTab;
    }
  });

  // ─── BREP tab — server-side OpenCascade (OCCT) render ──────────────────────
  // Reuses the SHARED PrimitiveDualCanvas chrome (backend="brep"): same canvas,
  // camera/lights/orbit, ⚙ scale gear, SceneControls, Z-pan, stats + 🔄. Posts
  // the emitted source + current param values to /api/brep/preview; the server
  // extracts the (revolve / extrude / loft / CSG) solid, builds it in OCCT, and
  // adaptively tessellates → true-curve mesh with exact normals. Parts with no
  // OCCT-buildable solid come back supported:false → the reason shows in-chrome.
  // brepMeta is fed by the canvas's onBakeMeta and drives the cached/fresh badge.
  let brepMeta = $state<{ cached: boolean; ms: number; tris: number; verts: number; supported: boolean; reason?: string } | null>(null);
  // TF tab — client-side TrueForm bake meta (drives the fresh/error badge).
  let tfMeta = $state<{ cached: boolean; ms: number; tris: number; verts: number; supported: boolean; reason?: string } | null>(null);
  // Which client-side TrueForm demo the TF tab renders — a name from the
  // tf_examples registry (box · r_cyl · s_cyl · helix · bored_pipe · dp_pin · cone).
  // TrueForm has no revolve/loft/extrude, so these show what tf CAN build directly
  // (primitives, tubeMesh sweeps, CSG) + the two revolved parts (lathe via tf.mesh).
  // TF always builds THIS part natively now (the demo selector was removed
  // 2026-07-08); `tfActualOn` stays true to drive the server-compile path below.
  const tfActualOn = true;
  // Param name → current value (graph.params order ↔ bake.args / paramDefaults).
  let brepParamValues = $derived.by(() => {
    const vals = (bake?.args ?? paramDefaults) as number[];
    const out: Record<string, number> = {};
    Object.keys(graph.params).forEach((k, i) => { out[k] = vals[i]; });
    return out;
  });
  // Compile the graph → a TrueForm recipe at the CURRENT param values. Fed to the
  // TF canvas so "actual" mode builds natively (executeTfRecipe). CLIENT-side
  // graphToTf handles direct-engine parts (revolve/cuboid/cylinder → g_collar,
  // g_dp_pin, …) instantly. It CANNOT resolve COMPOSITE Calls (a part that Calls
  // another volume part, e.g. s_tube_demo → sweep_tube_demo) — those need the async
  // dep-inlining only the SERVER /api/tf/compile does. So: use the local recipe when
  // it's fully supported; otherwise fetch the server-resolved (composite-inlined)
  // recipe. Keeps the fast client path for the common case, server only when needed.
  let tfRecipeLocal = $derived.by(() => {
    try { return graphToTf(graph, brepParamValues); } catch { return undefined; }
  });
  // recipeHasUnsupportedLocal / tfServerKey / computeTfRecipePending are pure —
  // extracted to ./tf-recipe-timing.ts (unit-tested there).
  let tfRecipeServer = $state<import('$lib/engines/trueform/graph-to-tf').TfRecipe | undefined>(undefined);
  // The recipe the canvas uses: the server-resolved one when present (composites),
  // else the instant client one.
  let tfRecipe = $derived(tfRecipeServer ?? tfRecipeLocal);
  // Signature (graph structure + params + bust) that the CURRENT tfRecipeServer
  // was resolved FOR. This is the anti-double-build marker: on an edit
  // tfRecipeLocal recomputes to a fresh UNSUPPORTED recipe, but tfRecipeServer
  // still holds the PREVIOUS resolve → `tfRecipe` would momentarily expose a
  // stale-but-supported recipe and the canvas would bake once on it (stale
  // topology + the new args) BEFORE the real recipe lands. We stamp each resolve
  // with the key it was for; the recipe is "pending" until that stamp matches the
  // live graph, and the canvas holds its mesh until then → one bake, not two.
  let tfServerResolvedKey = $state('');
  // Server-compile wall time (ms) for the LAST /api/tf/compile round-trip — the
  // composite-dependency resolve that DOMINATES a TF redraw for parts that Call
  // other volume parts (it does serial, prod-proxied /api/primitives/source
  // fetches per dep). 0 = the instant client recipe was used (no server hop).
  // The badge adds this to the ~4 ms kernel build so "fresh · N ms TF" reflects
  // the TRUE end-to-end redraw the user waits on, not just the kernel slice.
  let tfCompileMs = $state(0);
  // 🔄 on the TF canvas bumps this → the compile effect re-runs and RE-FETCHES the
  // server recipe (re-resolves composite deps), not just the client-cached recipe.
  let tfRecipeBust = $state(0);
  // Non-reactive marker of the last bust value we've compiled with — lets the
  // effect tell a 🔄 rebake (tfRecipeBust changed) from a param/graph change, so
  // ONLY a rebake sends bust:true (bypasses the server dep-source cache, #1).
  let lastBustCompiled = 0;
  // True while a composite part NEEDS a server recipe but the live server recipe
  // hasn't caught up to the current graph/params/bust yet. Passed to the canvas
  // (tfPending) so it SKIPS the throwaway bake on the stale recipe. Note: once the
  // server resolve LANDS for the current key — even one that is still unsupported
  // — this flips false, so a genuinely-unsupported part still reaches the canvas
  // and blanks+errors per the native-only rule (that contract lives in rebuildTf).
  let tfRecipePending = $derived(computeTfRecipePending({
    actualOn: tfActualOn,
    local: tfRecipeLocal,
    serverResolvedKey: tfServerResolvedKey,
    currentKey: tfServerKey(graph, brepParamValues, tfRecipeBust),
  }));
  // When the client recipe has UNSUPPORTED nodes AND "actual" is on, fetch the
  // server-inlined recipe (composites resolved). Re-fires on graph/param change,
  // and on a 🔄 bust (tfRecipeBust).
  $effect(() => {
    const local = tfRecipeLocal;
    const g = graph, p = brepParamValues;
    const bustNow = tfRecipeBust; // dep: a 🔄 bust forces a fresh /api/tf/compile round-trip
    // ACTIVE-TAB-ONLY, same discipline as the SVG fetch below. /api/tf/compile
    // resolves composite deps SERIALLY against the prod-proxied /source, so a
    // multi-dep part (a well: 8 bw_* deps) costs ~5s per call. Compiling that
    // for a tab nobody is looking at is pure latency — and when the TF canvas
    // then traps, each respawn re-runs it. Measured on /wells GRAPH: 3 calls,
    // 5.1s + 5.1s + 1.9s, all invisible. Gate BEFORE the reset below so a hidden
    // tab simply leaves the last recipe alone rather than churning it.
    if (rightTab !== 'tf' || !(active ?? true)) return;
    if (!tfActualOn || !local || !recipeHasUnsupportedLocal(local)) { tfRecipeServer = undefined; tfCompileMs = 0; tfServerResolvedKey = ''; return; }
    const forceFresh = bustNow !== lastBustCompiled; // true only when this run is a 🔄 rebake
    lastBustCompiled = bustNow;
    const resolveKey = tfServerKey(g, p, bustNow); // stamp this resolve so tfRecipePending can tell fresh from stale
    let cancelled = false;
    (async () => {
      const t0 = performance.now();
      try {
        const r = await fetch('/api/tf/compile', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ graph: g, params: p, id: exemplarId, bust: forceFresh }),
        });
        if (!r.ok) { if (!cancelled) tfServerResolvedKey = resolveKey; return; } // resolve pending → fall through to local (blank+error on genuine unsupported)
        const data = await r.json();
        if (!cancelled) {
          if (data?.recipe) { tfCompileMs = performance.now() - t0; tfRecipeServer = data.recipe; }
          tfServerResolvedKey = resolveKey; // mark resolved for THIS graph → tfRecipePending clears → canvas bakes once
        }
      } catch { if (!cancelled) tfServerResolvedKey = resolveKey; } // resolve pending; keep last recipe → mesh-import fallback
    })();
    return () => { cancelled = true; };
  });

  // ─── SVG tab — vector render of the baked geometry (PrimitiveSvgView) ─────
  // The SVG view needs the same { full, cutVC } mesh-JSON the 3D pane bakes; we
  // fetch it from /api/primitives/preview only when the SVG tab is active
  // (active-tab-only discipline) and the body changes, so it never duplicates
  // work while hidden.
  // Carries `parts`/`cutParts` too (batch-5 Phase 2) — the per-part meshes +
  // their PartAppearance (opacity/colour) that the SVG view needs for per-part
  // transparency. The server already serializes them; dropping them here was the
  // root cause of the SVG ignoring per-part opacity (same class as the earlier
  // bake-client drop).
  let svgMeshJson = $state<import('$lib/engines/manifold/mesh-serial').SerializedComponentResult | null>(null);
  let svgMeshKey = $state<string>('');
  let svgMeshBusy = $state(false);

  // MF_CLIENT bake timings, reported by the canvas after each real bake (#987).
  // The badge USED to read `bake._t`, but `bake` is now the /compile response
  // (validateGraphBake), whose only timing is `fetch_total` — which the badge
  // excluded — so it always summed to `fresh · 0 ms`. This carries the actual
  // compile + worker-bake cost from PrimitiveDualCanvas.
  let clientBakeMeta = $state<ClientBakeMeta | null>(null);
  // SVG resolution: 'coarse' (32 segments, DEFAULT — a vector drawing doesn't
  // need 256-facet circles; ~an order of magnitude lighter so it renders fast +
  // stays under the high-poly warning) vs 'high' (full 256). Toggle lives in the
  // SVG view toolbar; persisted. Only this SVG fetch passes `segments`; the
  // 3D/GLB panes stay full-res.
  let svgRes = $state<'coarse' | 'high'>('coarse');
  onMount(() => {
    try { const v = localStorage.getItem('ge-svg-res'); if (v === 'coarse' || v === 'high') svgRes = v; } catch { /* ignore */ }
  });

  // SRC subtab (client-exec): EMITTED .asm.ts vs the COMPILED dep-inlined Manifold
  // script (/api/primitives/compile — what the client Worker runs). Fetched on
  // demand from the LIVE sourceText so it tracks edits.
  let srcSubtab = $state<'emitted' | 'compiled'>('emitted');
  let compiledScript = $state('');
  let compiledStatus = $state<'idle' | 'loading' | 'error'>('idle');
  let lastCompileKey = '';
  $effect(() => {
    if (rightTab !== 'source' || srcSubtab !== 'compiled') return;
    const key = `${exemplarId}|${sourceText}`;
    if (key === lastCompileKey) return;
    lastCompileKey = key;
    compiledStatus = 'loading';
    fetch('/api/primitives/compile', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: exemplarId, source: sourceText }) })
      .then((r) => r.json())
      .then((d) => { compiledScript = d?.supported ? d.script : `// not supported by the client kernel:\n// ${d?.reason ?? 'unknown'}`; compiledStatus = 'idle'; })
      .catch((e) => { compiledScript = `// compile failed: ${e?.message ?? e}`; compiledStatus = 'error'; });
  });
  // ─── MF_SERVER arming ───────────────────────────────────────────────────
  // The server bake runs Manifold synchronously on Node's single thread: while
  // it works, nothing else on the server answers. So opening the tab must not
  // start one, and neither must a param edit while the tab happens to be open.
  //
  // `mfServerJob` is a FROZEN (source, args) snapshot taken at the instant the
  // user clicks "Bake on server". The canvas is mounted with those values, so
  // later edits to the graph do not re-trigger it — a second bake needs a
  // second click. Leaving the tab disarms, so re-entering asks again.
  let mfServerJob = $state<{ source: string; args: (number | string)[] } | null>(null);
  $effect(() => { if (rightTab !== 'mfserver') mfServerJob = null; });
  /** The armed snapshot no longer matches the live graph — offer a re-bake. */
  let mfServerStale = $derived.by(() => {
    if (!mfServerJob || typeof displayBake !== 'object' || !displayBake) return false;
    return displayBake.source !== mfServerJob.source
      || JSON.stringify(displayBake.args ?? paramDefaults) !== JSON.stringify(mfServerJob.args);
  });
  function armMfServer() {
    if (typeof displayBake !== 'object' || !displayBake?.source) return;
    mfServerJob = { source: displayBake.source, args: displayBake.args ?? paramDefaults };
  }

  function setSvgRes(v: 'coarse' | 'high') {
    svgRes = v;
    try { localStorage.setItem('ge-svg-res', v); } catch { /* ignore */ }
  }
  $effect(() => {
    if (rightTab !== 'svg') return;
    // bake transiently goes to 'loading'/null on a re-bake (e.g. after Save). Null
    // the mesh AND reset the key, so when bake returns with the SAME source the
    // key guard below doesn't block the re-fetch — otherwise the SVG vanishes on
    // Save and never comes back (the mesh was cleared but the key still matched).
    if (typeof bake !== 'object' || !bake || !bake.source) { svgMeshJson = null; svgMeshKey = ''; return; }
    const src = bake.source;
    const params = bake.args ?? paramDefaults;
    const segs = svgRes === 'coarse' ? 32 : undefined; // coarse → cap at 32
    // High → a segment FLOOR of 256 so assemblies whose deps hard-code a low
    // `segments` (e.g. dt_tube → g_shaft @32) bake their curved bores SMOOTH
    // instead of 32-faceted (the plain `segments` lever only caps DOWN).
    const segFloor = svgRes === 'high' ? 256 : undefined;
    // Match the 3D pane's bake EXACTLY (PrimitiveDualCanvas l.221): same params
    // AND the part's assigned colours + instanced classification. Without these
    // the server fell back to a different cutVC colour path (default red/grey,
    // inner mis-classified) so the SVG ignored the part's selected colours and
    // painted the bore red. Key includes them so a colour edit re-fetches.
    const cOut = (graph as any)?.colorOuter, cIn = (graph as any)?.colorInner;
    const key = JSON.stringify({ s: src, a: params, seg: segs ?? 'full', floor: segFloor ?? 0, cOut, cIn });
    if (key === svgMeshKey) return; // already have this mesh
    svgMeshKey = key;
    svgMeshBusy = true;
    (async () => {
      try {
        // Mirror PrimitiveDualCanvas's preview request shape: name = the geom
        // function, params = the ordered value array, mode = sandbox (we always
        // have source here). cutaway:true forces the cut even for big stacks.
        // NB: NO `instanced` — the SVG wants the plain merged mesh; the instanced
        // bake returns canonical-child + instance data that inflates the bbox and
        // renders blank/tiny here (regressed g_cone + g_barrel).
        const body: any = { id: exemplarId, name: exemplarId, source: src, params, mode: 'sandbox', cutaway: true };
        if (cOut) body.colorOuter = cOut;
        if (cIn) body.colorInner = cIn;
        if (segs != null) body.segments = segs;
        if (segFloor != null) body.segmentsFloor = segFloor;
        const r = await fetch('/api/primitives/preview', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!r.ok) { svgMeshJson = null; return; }
        const data = await r.json();
        // Thread parts/cutParts (+ PartAppearance opacity) through to the SVG
        // view so a transparent sub-part renders see-through (Phase 2). NB no
        // `instanced` was requested, so the merged full/cutVC are the real mesh.
        svgMeshJson = {
          full: data.full, cutVC: data.cutVC,
          ...(data.parts ? { parts: data.parts } : {}),
          ...(data.cutParts ? { cutParts: data.cutParts } : {}),
        };
      } catch { svgMeshJson = null; }
      finally { svgMeshBusy = false; }
    })();
  });

  // ─── BREP-SVG tab — server-side OCCT true-boundary (HLR) → SVG ─────────────
  // The vector sibling of the BREP MESH tab: instead of tessellating the OCCT
  // solid, /api/brep/svg projects its TRUE boundary (silhouette + sharp edges,
  // hidden-line removed) to an SVG string. We POST the SAME body the BREP mesh
  // path feeds the canvas — { source: bake.source, paramValues: brepParamValues } —
  // and render the returned `svg` with {@html} (our own server output).
  //
  // Same active-tab-only + content-key discipline as the SVG-mesh and TF fetches
  // above: fetch ONLY when this tab is the active tab of the active pane, keyed on
  // { source, params } (the same graph+params identity the BREP mesh canvas keys
  // its OCCT bake on) so it never refetches on an unrelated re-render, and the
  // transient bake==='loading' sentinel is IGNORED (we keep the last SVG rather
  // than blank+refetch every re-bake).
  let brepSvgStr = $state('');
  let brepSvgMeta = $state<{ ms: number; mode?: string } | null>(null);
  let brepSvgSupported = $state(true);
  let brepSvgReason = $state('');
  let brepSvgBusy = $state(false);
  let brepSvgError = $state('');
  // NON-reactive dedup ref: the fetch effect READS this to skip re-projecting the
  // same source+params. It must NOT be $state — a reactive read here would make
  // the effect depend on a key it also WRITES, so setting the key re-runs the
  // effect, whose cleanup cancels the in-flight fetch → the result is dropped and
  // the tab hangs on "Projecting…" forever (the B·SVG-blank bug).
  let brepSvgKey = '';
  // Fill/shading mode for the projection: 'none' = outline only (hollow — reads
  // as a wireframe grid on faceted/warped solids), 'silhouette' = flat-filled
  // solid (keeps clean HLR occlusion), 'lambert' = per-face normal shading.
  // Default shaded so a solid looks solid, not a hollow grid. Exposed as a toggle.
  let brepSvgFill = $state<'none' | 'silhouette' | 'lambert'>('lambert');
  // ── B·SVG 2D pan/zoom (image-viewer style, client-only) ──────────────────────
  // The injected SVG is centered at identity (scale 1, no pan) = the default fit.
  // Wheel zooms toward the cursor, drag pans, ⌖ resets. State lives here (not in
  // the SVG string) so re-projections don't fight it; it's RESET whenever a new
  // projection loads (see the effect below) so a new part/fill starts fitted.
  let bsvgScale = $state(1);
  let bsvgTx = $state(0);
  let bsvgTy = $state(0);
  let bsvgDragging = $state(false);
  let bsvgLastX = 0, bsvgLastY = 0;
  const BSVG_MIN = 0.2, BSVG_MAX = 8;
  function bsvgResetView() { bsvgScale = 1; bsvgTx = 0; bsvgTy = 0; }
  function bsvgWheel(e: WheelEvent) {
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const next = Math.max(BSVG_MIN, Math.min(BSVG_MAX, bsvgScale * factor));
    const k = next / bsvgScale;                 // keep the point under the cursor fixed
    bsvgTx = cx - k * (cx - bsvgTx);
    bsvgTy = cy - k * (cy - bsvgTy);
    bsvgScale = next;
  }
  function bsvgPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;                  // left-drag only
    bsvgDragging = true;
    bsvgLastX = e.clientX; bsvgLastY = e.clientY;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }
  function bsvgPointerMove(e: PointerEvent) {
    if (!bsvgDragging) return;
    bsvgTx += e.clientX - bsvgLastX;
    bsvgTy += e.clientY - bsvgLastY;
    bsvgLastX = e.clientX; bsvgLastY = e.clientY;
  }
  function bsvgPointerUp(e: PointerEvent) {
    if (!bsvgDragging) return;
    bsvgDragging = false;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  }
  $effect(() => {
    if (rightTab !== 'brepsvg' || !(active ?? true)) return;
    // Only (re)fetch off a real baked solid + non-empty source (mirror the BREP
    // mesh tab's guard). During 'loading' / no-source, leave the last SVG in place.
    if (typeof bake !== 'object' || !bake || !bake.source) return;
    const src = bake.source as string;
    const params = brepParamValues; // graph.params order ↔ current values
    const fill = brepSvgFill; // reactive: switching the fill mode re-projects
    // 'shaded' = Lambert face fills with NO facet-edge grid (strokeVisible:'none')
    // → a clean shaded solid; outline/filled keep the line-art edges.
    const svgOpts = fill === 'lambert' ? { fill, strokeVisible: 'none' } : { fill };
    const key = JSON.stringify({ s: src, p: params, o: svgOpts });
    if (key === brepSvgKey) return; // already have this projection
    brepSvgKey = key;
    bsvgResetView(); // a new part/projection re-fits (these vars aren't tracked here)
    brepSvgBusy = true;
    brepSvgError = '';
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/brep/svg', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ source: src, paramValues: params, ...svgOpts }),
        });
        if (!r.ok) { if (!cancelled) { brepSvgError = `HTTP ${r.status}`; brepSvgStr = ''; brepSvgMeta = null; } return; }
        const data = await r.json();
        if (cancelled) return;
        if (data?.supported) {
          brepSvgStr = data.svg ?? '';
          brepSvgMeta = data.meta ?? null;
          brepSvgSupported = true;
          brepSvgReason = '';
        } else {
          brepSvgSupported = false;
          brepSvgReason = data?.reason ?? 'no BREP-SVG path for this part';
          brepSvgStr = '';
          brepSvgMeta = null;
        }
      } catch (e: any) {
        if (!cancelled) { brepSvgError = String(e?.message ?? e); brepSvgStr = ''; brepSvgMeta = null; }
      } finally {
        if (!cancelled) brepSvgBusy = false;
      }
    })();
    return () => { cancelled = true; };
  });
</script>

<!-- RIGHT pane — tabbed: 3D bake / live source. One tab visible at a
     time; both keep their state mounted so switching is instant. -->
<section class="ge-right-pane">
  <div class="ge-pane-tabs" role="tablist">
    <!-- Tab buttons are gated by the embed config (`tabOn`); default = all shown. -->
    {#if tabOn('bake')}
    <button class="ge-pane-tab" class:active={rightTab === 'bake'}
      type="button" role="tab" aria-selected={rightTab === 'bake'}
      data-tip={!hasSolidProducer ? '2D preview — resolved polygon (axis at r=0 for revolve, centered for cartesian)' : 'MF_CLIENT — Manifold, baked in a browser Web Worker. The default, and the only backend on the main canvas.'}
      onclick={() => setRightTab('bake')}>{!hasSolidProducer ? '2D preview' : 'MF_CLIENT'}</button>
    {/if}
    {#if tabOn('tf')}
    <button class="ge-pane-tab" class:active={rightTab === 'tf'}
      type="button" role="tab" aria-selected={rightTab === 'tf'}
      data-tip="TF — TrueForm (Polydera) client-side exact-mesh kernel. Runs the WASM boolean/generator kernel on the MAIN THREAD (no worker); from-scratch generators + booleans."
      onclick={() => setRightTab('tf')}>TF</button>
    {/if}
    {#if tabOn('source')}
    <button class="ge-pane-tab" class:active={rightTab === 'source'}
      type="button" role="tab" aria-selected={rightTab === 'source'}
      data-tip={`SRC — the emitted ${exemplarId}.asm.ts auto-generated from the graph`}
      onclick={() => setRightTab('source')}>SRC</button>
    {/if}
    {#if tabOn('md')}
    <button class="ge-pane-tab" class:active={rightTab === 'md'}
      type="button" role="tab" aria-selected={rightTab === 'md'}
      data-tip="MD — hand-authored drawing-descriptor markdown. Saved as meta.drawingMd."
      onclick={() => setRightTab('md')}>MD{drawingMd ? ` · ${drawingMd.length}c` : ''}</button>
    {/if}
    {#if tabOn('svg')}
    <button class="ge-pane-tab" class:active={rightTab === 'svg'}
      type="button" role="tab" aria-selected={rightTab === 'svg'}
      data-tip="SVG — vector render of the baked geometry (downloadable .svg)"
      onclick={() => setRightTab('svg')}>SVG</button>
    {/if}
    {#if tabOn('glb')}
    <button class="ge-pane-tab" class:active={rightTab === 'glb'}
      type="button" role="tab" aria-selected={rightTab === 'glb'}
      data-tip="GLB — half-sectioned bake (downloadable). Baked on demand — the bake is slow, so it only runs when you open this tab."
      onclick={() => setRightTab('glb')}>GLB</button>
    {/if}
    {#if tabOn('brep')}
    <button class="ge-pane-tab" class:active={rightTab === 'brep'}
      type="button" role="tab" aria-selected={rightTab === 'brep'}
      data-tip="BREP — server-side OpenCascade (OCCT) true-curve render. Adaptive tessellation + exact normals. Revolve · extrude · loft · CSG · composed parts."
      onclick={() => setRightTab('brep')}>BREP</button>
    {/if}
    {#if tabOn('brepsvg')}
    <button class="ge-pane-tab" class:active={rightTab === 'brepsvg'}
      type="button" role="tab" aria-selected={rightTab === 'brepsvg'}
      data-tip="BREP-SVG — server-side OpenCascade (OCCT) TRUE-boundary projection. Projects the OCCT solid's silhouette + sharp edges (hidden-line removed) to a vector SVG. The boundary sibling of the BREP mesh tab."
      onclick={() => setRightTab('brepsvg')}>B·SVG</button>
    {/if}
    {#if tabOn('mfserver')}
    <button class="ge-pane-tab mfserver" class:active={rightTab === 'mfserver'}
      type="button" role="tab" aria-selected={rightTab === 'mfserver'}
      data-tip="MF_SERVER — the SAME Manifold kernel, baked on the server via /api/primitives/preview. Rare: parity checks + diagnosing a client-bake failure. Manifold is synchronous and Node is single-threaded, so a heavy part here stalls every route until it finishes. Never opens by itself; never restored on reload."
      onclick={() => setRightTab('mfserver')}>MF_SERVER</button>
    {/if}
  </div>
  <div class="ge-pane-bodies">
    <div class="ge-bake-body" class:hidden={rightTab !== 'bake'}>
      {#if !hasSolidProducer}
        <!-- Profile mode: the 2D resolved-polygon preview is a parent-scoped
             snippet (drag-wired to the parent's polygon machinery). -->
        {@render profilePreview?.()}
      {:else if !bake && !lastGoodBake}<div class="ge-empty">Drop nodes to bake.</div>
      {:else if bake === 'loading' && !lastGoodBake}<div class="ge-empty">baking…</div>
      {:else if typeof bake === 'object' && bake && !bake.ok}
        <div class="ge-err">
          <div>{bake.message ?? 'bake failed'}</div>
          {#if /EMPTY solid|stack: item|degenerate|parameter 0 has unknown type|memory access out of bounds/.test(bake.message ?? '')}
            {#if /EMPTY solid|stack: item|degenerate|\[in .+→|\(in .+→/.test(bake.message ?? '')}
              <!-- A dependency CHAIN ([in X → Y]) means this came from a
                   named primitive's geometry, NOT a stale server. It's a
                   GEOMETRY error: a CSG/revolve produced invalid/empty
                   geometry (subtract that removes everything, NaN/0 param,
                   degenerate profile). Point the user at the params, and do
                   NOT offer the restart button (clicking it wedged the dev
                   server, 2026-06-13). -->
              <div class="ge-err-hint geom">
                ⚠ A primitive produced <strong>invalid or empty geometry</strong> — e.g. a
                subtract that removes everything (same OD on both sides), or a
                NaN/0 parameter feeding a revolve. Check the parameters of the
                part(s) in the chain above. This is a geometry issue, not a
                server problem — no restart needed.
              </div>
            {:else}
              <!-- Bare OOB with no dep chain — can be a stale dev server
                   (Vite HMR skips server modules: primitive-loader /
                   composition-graph / emit). -->
              <div class="ge-err-hint">
                ⚠ Looks like a stale dev server (Vite HMR skips server modules after
                edits to composition-graph / composition-emit / primitive-loader).
                <div class="ge-err-hint-actions">
                  <button class="ge-err-restart-btn" type="button"
                    disabled={restartBusy} onclick={onRestart}>
                    {restartBusy ? '🔄 restarting…' : '🔄 Restart dev server'}
                  </button>
                  <span class="ge-err-hint-or">or manually:</span>
                  <code>pkill -f 'bun run dev' && bun run dev</code>
                </div>
                {#if restartStatus}<div class="ge-err-restart-stat">{restartStatus}</div>{/if}
              </div>
            {/if}
          {/if}
        </div>
      {:else if PrimitiveDualCanvas && displayBake && (active ?? true)}
        <!-- Render from displayBake (last good bake) so the canvas stays MOUNTED
             across the transient bake==='loading' — see lastGoodBake note above.
             Identical (source,args) then cache-dedup to a single bake on load. -->
        <PrimitiveDualCanvas id={exemplarId} name={exemplarId} description=""
          args={displayBake.args ?? paramDefaults}
          source={displayBake.source}
          colorOuter={graph.colorOuter} colorInner={graph.colorInner} opacity={graph.opacity} texture={graph.texture} material={graph.material}
          viewZScale={graph.viewZScale} viewXScale={graph.viewXScale}
          bakeGlb={false}
          overlays={splineOverlays}
          onRebuild={onRebuild}
          onBakeTimings={(m) => (clientBakeMeta = m)}
          autoScaleOwner={rightTab === 'bake'}
          showControls={true} showLabels={false}/>
        {#if bake === 'loading'}<div class="ge-baking-badge">baking…</div>{/if}
        <!-- Bake-cost row. Reports the CLIENT bake (MF_CLIENT worker), NOT the
             /compile round-trip — see clientBakeMeta. `bake.cacheHash` (compile
             identity) is kept only as the title/hash. -->
        {@const bakeMeta = (displayBake as any).bake ?? {}}
        <div class="ge-bake-meta">
          {#if clientBakeMeta}
            {@const cm = clientBakeMeta}
            {#if cm.cached}
              <span class="ge-cache-badge cached"
                title={`IndexedDB bake-cache hit (scriptHash ${bakeMeta.cacheHash ?? '?'}). ${Math.round(cm.bakeMs)} ms = mesh decode + paint.`}>
                ✓ cached · {Math.round(cm.bakeMs)} ms
              </span>
            {:else}
              {@const ph = cm.phases}
              {@const phaseSum = sumBakeTimings(ph)}
              <span class="ge-cache-badge fresh"
                title={`fresh worker bake (scriptHash ${bakeMeta.cacheHash ?? '?'}). compile ${Math.round(cm.compileMs)} ms · bake+transfer ${Math.round(cm.bakeMs)} ms${ph ? ` · phases ${Math.round(phaseSum)} ms [build ${Math.round(ph.build ?? 0)} · mesh ${Math.round(ph.mesh ?? 0)} · cut ${Math.round(ph.cutaway ?? 0)} · finalize ${Math.round(ph.finalize ?? 0)} · serialize ${Math.round(ph.serialize ?? 0)}]` : ''}`}>
                fresh · ⚙ {Math.round(cm.compileMs)} · 🔨 {Math.round(cm.bakeMs)} ms
              </span>
            {/if}
          {:else if bakeMeta.cacheHash}
            <span class="ge-cache-badge fresh" title={`hash: ${bakeMeta.cacheHash}`}>baking…</span>
          {/if}
          <span class="ge-bake-meta-spacer"></span>
          {#if rebuildStatus}<span class="ge-rebuild-stat">{rebuildStatus}</span>{/if}
        </div>
      {:else}<div class="ge-empty">3D canvas loading…</div>
      {/if}
    </div>
    <div class="ge-source-body" class:hidden={rightTab !== 'source'}>
      {#if legacyLoad}
        <div class="ge-legacy-banner">
          {#if legacyLoad.reason === 'no-graph' && (legacyLoad.origin === 'stdlib' || legacyLoad.origin === 'stdstale')}
            <strong>{legacyLoad.id}</strong> is a read-only <strong>stdlib engine</strong>,
            not an editable part — it's a hand-written primitive with no
            <code>meta.graph</code>, so the node canvas stays empty (and Save is
            blocked). Engines are meant to be <strong>composed into a part</strong>:
            open a blank graph and <em>+ Drop</em> <code>{legacyLoad.id}</code> as a
            node, or open a demo that uses it (e.g. <code>helical_demo</code>,
            <code>pin_thread</code>) to see + dial it. Its source + params are
            shown below for reference.
          {:else if legacyLoad.reason === 'no-graph'}
            <strong>{legacyLoad.id}</strong> opened in legacy mode — its source has
            no <code>meta.graph</code> block, so the canvas can't hydrate. Save
            here to overwrite with a graph-format part. The legacy PrimitiveView
            editor was removed 2026-06-09 — graph editor is the only editor now.
          {:else}
            Could not fetch <strong>{legacyLoad.id}</strong> from the volume.
            Check the id + your volume connection.
          {/if}
        </div>
      {/if}
      <!-- Filename header — the SAM info that used to live in the tab
           label. Moved into the body so the tab strip stays compact. -->
      <div class="ge-source-header">
        <div class="ge-src-subtabs">
          <button class="ge-src-subtab" class:on={srcSubtab === 'emitted'} type="button"
            onclick={() => (srcSubtab = 'emitted')}>{exemplarId}.asm.ts</button>
          <button class="ge-src-subtab" class:on={srcSubtab === 'compiled'} type="button"
            data-tip="The self-contained, dep-inlined Manifold script /api/primitives/compile emits — what the client Worker runs"
            onclick={() => (srcSubtab = 'compiled')}>⚡ compiled</button>
        </div>
        <span class="ge-source-header-hint">
          {srcSubtab === 'emitted' ? 'auto-generated from the graph — edits here are discarded on next save'
            : 'dep-inlined client bake script' + (compiledStatus === 'loading' ? ' · compiling…' : compiledScript ? ` · ${compiledScript.length} chars` : '')}
        </span>
      </div>
      {#if srcSubtab === 'emitted'}
        <pre class="ge-source">{sourceText}</pre>
      {:else}
        <pre class="ge-source compiled">{compiledScript || (compiledStatus === 'loading' ? '// compiling…' : '// (no script)')}</pre>
      {/if}
    </div>
    <div class="ge-md-body" class:hidden={rightTab !== 'md'}>
      <div class="ge-md-toolbar">
        <span class="ge-md-hint">Drawing-descriptor markdown — saved as <code>meta.drawingMd</code></span>
        <span class="ge-md-toolbar-actions">
          <!-- ✨ AI generate — kicks off a Claude-vision describe call
               that drafts a markdown description from the current
               bake + source + node graph. Endpoint TBD (#117 follow-up);
               today this just toasts a stub message. -->
          <button class="ge-md-ai-btn" type="button"
            onclick={onGenerateMd}
            disabled={mdAiBusy}
            data-tip="Generate description with AI (Claude vision — uses the current bake + graph as context)">
            {mdAiBusy ? '…' : '✨ AI'}
          </button>
          <span class="ge-md-count">{drawingMd.length} char{drawingMd.length === 1 ? '' : 's'}</span>
        </span>
      </div>
      <textarea class="ge-md-textarea"
        placeholder="# How to draw this part&#10;&#10;Notes, sketch references, parameter meanings, gotchas…"
        bind:value={drawingMd}></textarea>
    </div>
    <div class="ge-svg-body" class:hidden={rightTab !== 'svg'}>
      {#if rightTab === 'svg'}
        {#if PrimitiveSvgView && svgMeshJson}
          <PrimitiveSvgView meshJson={svgMeshJson} name={exemplarId} active={rightTab === 'svg'} res={svgRes} onSetRes={setSvgRes} busy={svgMeshBusy} />
        {:else if svgMeshBusy}
          <div class="ge-empty">Baking SVG…</div>
        {:else}
          <div class="ge-empty">No geometry to render yet — bake the part first.</div>
        {/if}
      {/if}
    </div>
    <!-- GLB tab — the slow GLB bake (full cutaway subtract, ~20 s cold)
         runs ONLY when this tab is open, and ONLY bakes the GLB (no mesh).
         Mounted on demand so iteration on the 3D-bake tab never waits on it. -->
    <div class="ge-glb-body" class:hidden={rightTab !== 'glb'}>
      {#if rightTab === 'glb' && (active ?? true)}
        {#if PrimitiveDualCanvas && bake && typeof bake === 'object' && bake.source}
          <PrimitiveDualCanvas id={exemplarId} name={exemplarId} description=""
            args={bake.args ?? paramDefaults}
            source={bake.source}
            colorOuter={graph.colorOuter} colorInner={graph.colorInner} opacity={graph.opacity} texture={graph.texture}
            viewZScale={graph.viewZScale} viewXScale={graph.viewXScale}
            bakeMesh={false}
            autoScaleOwner={active && rightTab === 'glb'}
            showControls={true} showLabels={false}/>
        {:else}
          <div class="ge-empty">No geometry yet — bake the part first (open the 3D bake tab).</div>
        {/if}
      {/if}
    </div>
    <!-- MF_SERVER tab — the SAME Manifold kernel as MF_CLIENT, run on the server.
         Mounted ONLY after an explicit click (see `mfServerJob`), and only while
         this is the active tab of the active pane. This is the one place in the
         app that POSTs /api/primitives/preview for a live mesh. -->
    <div class="ge-glb-body" class:hidden={rightTab !== 'mfserver'}>
      {#if rightTab === 'mfserver' && (active ?? true)}
        {#if !(typeof displayBake === 'object' && displayBake && displayBake.source)}
          <div class="ge-empty">No geometry yet — bake the part first (open the MF_CLIENT tab).</div>
        {:else if !mfServerJob}
          <!-- ARMED-OFF: nothing has been sent to the server. -->
          <div class="ge-mfserver-gate">
            <div class="ge-mfserver-gate-title">☁ Server bake — click to load</div>
            <p class="ge-mfserver-gate-body">
              Nothing is baked here until you ask. Manifold runs <strong>synchronously
              on Node's single thread</strong>, so while this bake runs the server
              answers nothing else — a large part stalls every route until it
              finishes. MF_CLIENT does the same work in a browser worker.
            </p>
            <p class="ge-mfserver-gate-body dim">
              Use this only to check parity against MF_CLIENT, or to diagnose a
              client-bake failure.
            </p>
            <button class="ge-mfserver-gate-btn" type="button" onclick={armMfServer}>
              Bake <code>{exemplarId}</code> on the server
            </button>
          </div>
        {:else if PrimitiveDualCanvas}
          <!-- ARMED: bake the FROZEN snapshot. Param edits do not re-fire this. -->
          <PrimitiveDualCanvas id={exemplarId} name={exemplarId} description=""
            args={mfServerJob.args}
            source={mfServerJob.source}
            backend="manifold-server"
            colorOuter={graph.colorOuter} colorInner={graph.colorInner} opacity={graph.opacity} texture={graph.texture} material={graph.material}
            viewZScale={graph.viewZScale} viewXScale={graph.viewXScale}
            bakeGlb={false}
            autoScaleOwner={active && rightTab === 'mfserver'}
            showControls={true} showLabels={false}/>
          <div class="ge-mfserver-bar">
            {#if mfServerStale}
              <span class="ge-mfserver-stale">● graph changed since this bake</span>
            {/if}
            <span class="ge-bake-meta-spacer"></span>
            <button class="ge-mfserver-rebtn" type="button" onclick={armMfServer}
              title="Send the CURRENT graph to /api/primitives/preview again">
              ☁ Bake again
            </button>
          </div>
        {/if}
      {/if}
    </div>
    <!-- BREP tab — server-side OpenCascade (OCCT) true-curve render in the
         SHARED PrimitiveDualCanvas chrome (backend="brep"): same canvas,
         camera/lights/orbit, ⚙ scale gear, SceneControls, Z-pan, stats + 🔄.
         Posts the emitted source + current param values to /api/brep/preview. -->
    <div class="ge-glb-body" class:hidden={rightTab !== 'brep'}>
      {#if rightTab === 'brep' && (active ?? true)}
        {#if PrimitiveDualCanvas && bake && typeof bake === 'object' && bake.source}
          <!-- Forward part APPEARANCE (base colour · MATL metalness/roughness ·
               opacity + transparent) so the BREP mesh shades through the SAME
               shared scene path as MF/TF — PrimitiveDualScene's matPBR =
               materialPreset(material) + the colorOuter fallback arm — with no
               BREP-specific material. metalness/roughness/opacity apply to BOTH
               the solid + cut arms; base colour applies to the solid arm. The
               CUT half-section's outer/inner vertex colours are now baked
               server-side from colorOuter/colorInner (rebuildBrep sends them →
               brep-occt honours them, red/grey only as fallback — #997). Smooth
               vertex normals are a separate concern handled in brep-adapter via
               crease-normals (#993) — out of scope here. -->
          <PrimitiveDualCanvas id={exemplarId} name={exemplarId} description=""
            args={bake.args ?? paramDefaults}
            source={bake.source}
            backend="brep"
            brepSource={bake.source}
            brepParams={brepParamValues}
            colorOuter={graph.colorOuter} colorInner={graph.colorInner} opacity={graph.opacity} texture={graph.texture} material={graph.material}
            viewZScale={graph.viewZScale} viewXScale={graph.viewXScale}
            onBakeMeta={(m) => (brepMeta = m)}
            autoScaleOwner={active && rightTab === 'brep'}
            showControls={true} showLabels={false}/>
          <!-- Cache/fresh badge row — mirrors the 3D-bake .ge-bake-meta. -->
          <div class="ge-bake-meta">
            {#if brepMeta && brepMeta.supported === false}
              <span class="ge-cache-badge skipped" title="No OCCT-buildable solid in this part (BREP covers revolve / extrude / loft / CSG).">{brepMeta.reason ?? 'no BREP path for this part'}</span>
            {:else if brepMeta?.cached}
              <span class="ge-cache-badge cached" title="Served from the client BREP fetch cache">✓ cached</span>
            {:else if brepMeta}
              <span class="ge-cache-badge fresh" title="Freshly tessellated by OCCT">fresh · {Math.round(brepMeta.ms)} ms OCCT</span>
            {/if}
            <span class="ge-bake-meta-spacer"></span>
          </div>
        {:else}
          <div class="ge-empty">No source yet — bake the part first.</div>
        {/if}
      {/if}
    </div>
    <!-- BREP-SVG tab — server-side OCCT true-boundary (HLR) → SVG projection.
         The vector sibling of the BREP MESH tab: POSTs the SAME
         { source, paramValues } to /api/brep/svg and renders the returned SVG
         string ({@html} — our own server output). Fetched active-tab-only +
         keyed on source+params (see the brepSvg effect). -->
    <div class="ge-glb-body" class:hidden={rightTab !== 'brepsvg'}>
      {#if rightTab === 'brepsvg' && (active ?? true)}
        {#if !(bake && typeof bake === 'object' && bake.source)}
          <div class="ge-empty">No source yet — bake the part first.</div>
        {:else if brepSvgError}
          <div class="ge-err"><div>BREP-SVG failed: {brepSvgError}</div></div>
        {:else if brepSvgSupported === false}
          <!-- No OCCT-buildable solid — mirror the BREP mesh tab's unsupported state. -->
          <div class="ge-empty">{brepSvgReason || 'no BREP-SVG path for this part'}</div>
        {:else if brepSvgStr}
          <!-- Pan/zoom viewport: wheel = zoom toward cursor, drag = pan, ⌖ = fit.
               The injected SVG rides a transform wrapper; identity = default fit. -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="ge-brepsvg-scroll" class:grabbing={bsvgDragging}
            onwheel={bsvgWheel} onpointerdown={bsvgPointerDown}
            onpointermove={bsvgPointerMove} onpointerup={bsvgPointerUp}
            onpointercancel={bsvgPointerUp}>
            <div class="ge-brepsvg-view"
              style="transform: translate({bsvgTx}px, {bsvgTy}px) scale({bsvgScale})">{@html brepSvgStr}</div>
            <button class="ge-brepsvg-reset" type="button"
              title="Reset view (fit)" aria-label="Reset BREP-SVG view to fit"
              onpointerdown={(e) => e.stopPropagation()} onclick={bsvgResetView}>⌖</button>
          </div>
          <!-- Cache/fresh badge row — mirrors the BREP mesh .ge-bake-meta. -->
          <div class="ge-bake-meta">
            {#if brepSvgBusy}
              <span class="ge-cache-badge fresh" title="Re-projecting the OCCT boundary">projecting…</span>
            {:else if brepSvgMeta}
              <span class="ge-cache-badge fresh" title="OCCT true-boundary projection (hidden-line removed)">fresh · {Math.round(brepSvgMeta.ms)} ms OCCT{brepSvgMeta.mode ? ` · ${brepSvgMeta.mode}` : ''}</span>
            {/if}
            <span class="ge-bake-meta-spacer"></span>
            <!-- Fill/shading mode — outline (line-art) · filled (flat silhouette) ·
                 shaded (per-face lambert). Re-projects on switch (the effect keys on fill). -->
            <div class="ge-bsvg-fill" role="group" aria-label="BREP-SVG fill mode">
              <button type="button" class:on={brepSvgFill === 'none'}
                title="Outline only — true-boundary line-art (hidden-line removed)"
                onclick={() => (brepSvgFill = 'none')}>outline</button>
              <button type="button" class:on={brepSvgFill === 'silhouette'}
                title="Flat-filled silhouette — solid fill, clean HLR edges"
                onclick={() => (brepSvgFill = 'silhouette')}>filled</button>
              <button type="button" class:on={brepSvgFill === 'lambert'}
                title="Shaded — per-face normal (lambert) shading"
                onclick={() => (brepSvgFill = 'lambert')}>shaded</button>
            </div>
          </div>
        {:else if brepSvgBusy}
          <div class="ge-empty">Projecting BREP → SVG…</div>
        {:else}
          <div class="ge-empty">No geometry to render yet — bake the part first.</div>
        {/if}
      {/if}
    </div>
    <!-- TF tab — TrueForm (Polydera) client-side exact-mesh kernel. Runs the
         WASM boolean/generator kernel on the MAIN THREAD (no worker) in the
         SHARED PrimitiveDualCanvas chrome (backend="tf"). The ~31MB WASM is
         lazy-loaded only when this tab first opens. The demo is chosen from the
         tf_examples registry dropdown (default r_cyl). -->
    <div class="ge-glb-body" class:hidden={rightTab !== 'tf'}>
      <!-- Gate on `active` (the /primitives current-tab flag): /primitives mounts
           EVERY tab's pane, and `ge-right-tab` is a SHARED localStorage key, so
           without this ALL panes would have rightTab==='tf' and bake concurrently
           through the ONE shared TF worker → its global latest-wins supersede
           CANCELS all but the last → every pane but one blanks. Only the visible
           pane bakes. (active ?? true) keeps single /graph-editor unchanged. -->
      {#if rightTab === 'tf' && (active ?? true)}
        {#if PrimitiveDualCanvas && bake && typeof bake === 'object' && bake.source}
          <!-- TF is a native engine surface now: THIS part is always built natively
               in TrueForm from its graph (native-only — if TF can't build an op the
               canvas blanks with the reason). The old demo-example selector/toggle
               was removed 2026-07-08. -->
          <PrimitiveDualCanvas id={exemplarId} name={exemplarId} description=""
            args={bake.args ?? paramDefaults}
            source={bake.source}
            backend="tf"
            tfActual={true}
            tfRecipe={tfRecipe}
            tfPending={tfRecipePending}
            brepSource={bake.source}
            brepParams={brepParamValues}
            colorOuter={graph.colorOuter} colorInner={graph.colorInner} opacity={graph.opacity} texture={graph.texture} material={graph.material}
            viewZScale={graph.viewZScale} viewXScale={graph.viewXScale}
            onBakeMeta={(m) => (tfMeta = m)}
            onRebuild={() => (tfRecipeBust += 1)}
            autoScaleOwner={active && rightTab === 'tf'}
            showControls={true} showLabels={false}/>
          <!-- Cache/fresh badge row — mirrors the BREP .ge-bake-meta. -->
          <div class="ge-bake-meta">
            {#if tfMeta && tfMeta.supported === false}
              <span class="ge-cache-badge skipped" title="TrueForm could not build this part.">{tfMeta.reason ?? 'no TF path for this part'}</span>
            {:else if tfMeta}
              {@const kernelMs = tfMeta.ms}
              {@const s = tfMeta.steps}
              {@const totalMs = kernelMs + tfCompileMs}
              {@const seg = (lbl, v) => `${lbl} ${Math.round(v)}`}
              <span class="ge-cache-badge fresh"
                title={`TF redraw ${Math.round(totalMs)} ms end-to-end` +
                  (tfCompileMs > 0 ? `\n• server recipe-compile: ${Math.round(tfCompileMs)} ms (composite dep resolve — serial prod-proxied /api/primitives/source fetches; main cost)` : '\n• server recipe-compile: 0 (instant client recipe, no server hop)') +
                  (s ? `\n• dynamic imports: ${Math.round(s.imports)} ms (0 after first)\n• kernel warm (ensureTf): ${Math.round(s.warm)} ms (one-time ~31MB WASM; 0 after)\n• geometry build (executeTfRecipe): ${Math.round(s.build)} ms (main thread)\n• mesh→THREE (normals/weld): ${Math.round(s.mesh)} ms` : '')}>
                fresh · {Math.round(totalMs)} ms TF
                <span class="ge-tf-steps">= {seg('compile', tfCompileMs)}{s ? ` + ${seg('imp', s.imports)} + ${seg('warm', s.warm)} + ${seg('build', s.build)} + ${seg('mesh', s.mesh)}` : ` + ${seg('build', kernelMs)}`} ms</span>
              </span>
            {/if}
            <span class="ge-bake-meta-spacer"></span>
          </div>
        {:else}
          <div class="ge-empty">No source yet — bake the part first.</div>
        {/if}
      {/if}
    </div>
  </div>
</section>

<style>
  /* MF_SERVER — visually marked as the exceptional path, so nobody parks on it. */
  .ge-pane-tab.mfserver { color: #d98a2b; }
  .ge-pane-tab.mfserver.active { color: #ffb454; }
  /* MF_SERVER gate — the tab shows THIS until the user clicks. No bake runs. */
  .ge-mfserver-gate { margin: auto; max-width: 420px; padding: 20px 22px; text-align: center;
    background: #fffbf0; border: 1px solid #e6c98a; border-radius: 8px; }
  .ge-mfserver-gate-title { font: 700 13px Arial; color: #8a6d00; margin-bottom: 10px; }
  .ge-mfserver-gate-body { font: 11.5px/1.6 Arial; color: #57534e; margin: 0 0 8px; }
  .ge-mfserver-gate-body.dim { color: #8a8580; }
  .ge-mfserver-gate-btn { margin-top: 6px; font: 600 11.5px Arial; color: #fff; background: #b45309;
    border: 1px solid #92400e; border-radius: 5px; padding: 7px 14px; cursor: pointer; }
  .ge-mfserver-gate-btn:hover { background: #92400e; }
  .ge-mfserver-gate-btn code { font: 11.5px ui-monospace, monospace; color: #ffe6c2; }
  .ge-mfserver-bar { display: flex; align-items: center; gap: 8px; padding: 4px 8px;
    border-top: 1px solid #e7e5e4; background: #fffbf0; }
  .ge-mfserver-stale { font: 10.5px Arial; color: #b45309; }
  .ge-mfserver-rebtn { font: 600 10.5px Arial; color: #8a6d00; background: #fff7e6;
    border: 1px solid #e6c98a; border-radius: 4px; padding: 3px 9px; cursor: pointer; }
  .ge-mfserver-rebtn:hover { background: #ffedcc; }

  /* Right pane: VERTICAL tab rail on the left + content. */
  .ge-right-pane { display: grid; grid-template-columns: auto 1fr; overflow: hidden; border-left: 1px solid #e5e7eb; }
  /* 8 vertical tabs no longer fit a short viewport — scroll rather than clip the
     last one (MF_SERVER was unreachable at 784px tall). Scrollbar hidden: the
     tabs are their own affordance. */
  .ge-pane-tabs { display: flex; flex-direction: column; gap: 0; background: #f5f5f4; border-right: 1px solid #e7e5e4; overflow-y: auto; scrollbar-width: none; }
  .ge-pane-tabs::-webkit-scrollbar { width: 0; height: 0; }
  .ge-pane-tab { flex: 0 0 auto; writing-mode: vertical-rl; display: flex; align-items: center; justify-content: center; min-height: 52px; white-space: nowrap; padding: 4px 7px; font: 600 11px Arial; color: #78716c; background: transparent; border: 0; border-left: 3px solid transparent; cursor: pointer; text-transform: uppercase; letter-spacing: 0.6px; transition: background 0.12s, color 0.12s, border-color 0.12s; }
  .ge-pane-tab code { font: 11px ui-monospace, monospace; color: #57534e; text-transform: none; letter-spacing: 0; }
  .ge-pane-tab:hover { background: #fafaf9; color: #1c1917; }
  .ge-pane-tab.active { color: #0c4a6e; border-left-color: #0369a1; background: #fff; }
  .ge-pane-tab.active code { color: #0c4a6e; }
  .ge-pane-bodies { position: relative; display: grid; min-height: 0; overflow: hidden; }
  .ge-pane-bodies > .ge-bake-body,
  .ge-pane-bodies > .ge-source-body,
  .ge-pane-bodies > .ge-svg-body,
  .ge-pane-bodies > .ge-glb-body,
  .ge-pane-bodies > .ge-md-body { grid-area: 1 / 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; }
  /* SVG tab — PrimitiveSvgView fills the pane (it manages its own toolbar +
     scroll). Give it a defined height so the renderer's container isn't 0px. */
  .ge-svg-body { min-height: 0; }
  /* BREP-SVG tab — raw server SVG string ({@html}) in an image-viewer-style
     pan/zoom viewport. The viewport clips; the inner .ge-brepsvg-view carries the
     translate()/scale() transform. The {@html}-injected <svg> is UNSCOPED → :global. */
  .ge-brepsvg-scroll { position: relative; flex: 1 1 auto; min-height: 0; overflow: hidden;
    background: #fff; cursor: grab; touch-action: none; }
  .ge-brepsvg-scroll.grabbing { cursor: grabbing; }
  .ge-brepsvg-view { position: absolute; inset: 0; display: flex; align-items: center;
    justify-content: center; padding: 12px; transform-origin: 0 0; will-change: transform; }
  .ge-brepsvg-view :global(svg) { max-width: 100%; max-height: 100%; height: auto; }
  /* Reset-to-fit control, floated top-right of the viewport. */
  .ge-brepsvg-reset { position: absolute; top: 6px; right: 6px; z-index: 2;
    width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center;
    border: 1px solid #d1d5db; border-radius: 5px; background: rgba(255, 255, 255, 0.92);
    color: #374151; cursor: pointer; font-size: 13px; line-height: 1; padding: 0; }
  .ge-brepsvg-reset:hover { background: #f3f4f6; border-color: #9ca3af; }
  /* Fill-mode segmented toggle (outline / filled / shaded), right of the badge row. */
  .ge-bsvg-fill { display: inline-flex; border: 1px solid #d1d5db; border-radius: 5px;
    overflow: hidden; margin-left: 8px; }
  .ge-bsvg-fill button { border: none; background: #fff; color: #6b7280; cursor: pointer;
    font-size: 10px; line-height: 1; padding: 3px 7px; border-right: 1px solid #e5e7eb; }
  .ge-bsvg-fill button:last-child { border-right: none; }
  .ge-bsvg-fill button:hover { background: #f3f4f6; }
  .ge-bsvg-fill button.on { background: #2563eb; color: #fff; }
  /* SRC tab — filename header above the <pre>. Light row, monospace
     filename + a faded hint reminding the user the file is generated. */
  .ge-source-header {
    display: flex; align-items: center; gap: 8px; padding: 3px 10px;
    border-bottom: 1px solid #e5e7eb; background: #f8fafc;
    white-space: nowrap; overflow: hidden; min-height: 0;
  }
  .ge-source-header code { font: 12px ui-monospace, monospace; color: #0c4a6e; }
  /* Truncate the hint so the header stays ONE slim row instead of wrapping. */
  .ge-source-header-hint { font: 10px Arial; color: #78716c; margin-left: auto; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .ge-src-subtabs { display: inline-flex; gap: 4px; }
  .ge-src-subtab { font: 600 11px ui-monospace, monospace; padding: 2px 8px; border: 1px solid #e7e5e4; border-radius: 4px; background: #fff; color: #57534e; cursor: pointer; }
  .ge-src-subtab:hover { border-color: #0ea5e9; color: #0c4a6e; }
  .ge-src-subtab.on { background: #e0f2fe; border-color: #0ea5e9; color: #0c4a6e; }
  .ge-source.compiled { background: #f0fdf4; }
  /* MD tab — toolbar row + full-pane textarea. Stays mounted while hidden
     so the user can flip between SRC/MD without losing in-progress typing. */
  .ge-md-body { padding: 8px; gap: 6px; }
  .ge-md-toolbar {
    display: flex; align-items: center; justify-content: space-between;
    gap: 8px; font: 10px Arial; color: #78716c;
  }
  .ge-md-toolbar code { font-family: ui-monospace, monospace; color: #44403c; }
  .ge-md-toolbar-actions { display: flex; align-items: center; gap: 8px; }
  .ge-md-count { flex: 0 0 auto; color: #a8a29e; }
  /* ✨ AI button — small violet pill, the established "smart / generated"
     colour in the editor (matches ƒ promote-to-expression chips). */
  .ge-md-ai-btn {
    background: #ede9fe; color: #5b21b6;
    border: 1px solid #c4b5fd; border-radius: 4px;
    padding: 2px 8px; font: 600 11px Arial; cursor: pointer;
    transition: background 100ms, color 100ms;
  }
  .ge-md-ai-btn:hover { background: #c4b5fd; color: #3b0764; }
  .ge-md-ai-btn:disabled { opacity: 0.6; cursor: wait; }
  .ge-md-textarea {
    flex: 1 1 auto; min-height: 0; resize: none;
    padding: 8px 10px;
    font: 12px ui-monospace, monospace; line-height: 1.5; color: #1f2937;
    background: #fafaf9; border: 1px solid #d6d3d1; border-radius: 4px;
    box-sizing: border-box;
  }
  .ge-md-textarea:focus { outline: 1px solid #0369a1; background: #fff; }
  .ge-pane-bodies > .hidden { display: none; }
  .ge-legacy-banner { padding: 8px 12px; font: 11px ui-monospace, monospace; line-height: 1.5; color: #78350f; background: #fef3c7; border-bottom: 1px solid #fbbf24; }
  .ge-legacy-banner strong { color: #92400e; }
  .ge-legacy-banner a { color: #0369a1; }
  .ge-bake-body { overflow: hidden; min-height: 0; position: relative; }
  /* .ge-empty + base .ge-err are shared with the parent (the parent-scoped
     profile-preview snippet uses them too) — duplicated here for the pane. */
  .ge-empty { padding: 20px; text-align: center; color: #9ca3af; font: 12px Arial; }
  /* "baking…" badge shown OVER the (still-mounted) canvas during a re-bake, so
     the canvas no longer unmounts on the transient bake==='loading'. */
  .ge-baking-badge { position: absolute; top: 8px; left: 50%; transform: translateX(-50%); z-index: 8; padding: 2px 10px; border-radius: 12px; font: 600 10px ui-monospace, monospace; background: rgba(17,24,39,0.72); color: #e5e7eb; pointer-events: none; }
  .ge-err { padding: 20px; color: #b91c1c; font: 12px ui-monospace, monospace; display: flex; flex-direction: column; gap: 10px; }
  .ge-err-hint { padding: 10px 12px; background: #fef3c7; color: #78350f; border: 1px solid #fbbf24; border-radius: 4px; font: 11px Arial; line-height: 1.4; }
  .ge-err-hint code { font: 11px ui-monospace, monospace; background: rgba(0,0,0,0.06); padding: 1px 5px; border-radius: 2px; }
  .ge-err-hint-actions { display: flex; align-items: center; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
  .ge-err-hint-or { font: 11px Arial; color: #92400e; }
  .ge-err-restart-btn { font: 600 11px Arial; color: #fff; background: #d97706; border: 1px solid #b45309; border-radius: 4px; padding: 4px 10px; cursor: pointer; transition: background 0.12s; }
  .ge-err-restart-btn:hover:not(:disabled) { background: #b45309; }
  .ge-err-restart-btn:disabled { opacity: 0.7; cursor: progress; }
  .ge-err-restart-stat { margin-top: 6px; font: 11px ui-monospace, monospace; color: #92400e; }
  /* Bake cache status row + Rebuild button */
  .ge-bake-meta { display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: #fafaf9; border-top: 1px solid #e7e5e4; font: 11px Arial; }
  .ge-bake-meta-spacer { flex: 1 1 auto; }
  .ge-draft-toggle { display: inline-flex; align-items: center; gap: 3px; font: 600 11px Arial; color: #57534e; cursor: pointer; user-select: none; }
  .ge-draft-toggle input { margin: 0; cursor: pointer; appearance: auto; -webkit-appearance: auto; accent-color: #d97706; width: 13px; height: 13px; }
  .ge-cache-badge { padding: 2px 8px; border-radius: 12px; font: 600 10px ui-monospace, monospace; }
  .ge-cache-badge.cached { background: #d1fae5; color: #065f46; border: 1px solid #6ee7b7; }
  .ge-cache-badge.fresh { background: #fef3c7; color: #92400e; border: 1px solid #fde68a; }
  .ge-tf-steps { font-weight: 500; opacity: 0.72; margin-left: 2px; }
  .ge-cache-badge.skipped { background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; }
  .ge-rebuild-btn { font: 600 11px Arial; color: #1c1917; background: #fff; border: 1px solid #d6d3d1; border-radius: 4px; padding: 3px 10px; cursor: pointer; transition: background 0.12s; }
  .ge-rebuild-btn:hover:not(:disabled) { background: #f5f5f4; }
  .ge-rebuild-btn:disabled { opacity: 0.7; cursor: progress; }
  .ge-rebuild-stat { font: 11px ui-monospace, monospace; color: #57534e; }
  .ge-source { margin: 0; padding: 10px 14px; font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; color: #1f2937; background: #fafaf9; overflow: auto; white-space: pre; }
</style>
