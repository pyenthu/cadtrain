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
  // in $lib/shared/tf_examples/). Static import is metadata only; no WASM loads
  // until a builder's build() runs inside PrimitiveDualCanvas.
  import { tfExamples } from '$lib/shared/tf_examples';
  // graph → TrueForm recipe compiler (pure, no WASM). Lets the TF tab's "actual"
  // mode build the part NATIVELY in tf from its graph ops instead of importing
  // the baked Manifold mesh.
  import { graphToTf } from '$lib/cad/graph-to-tf';

  type RightTab = 'bake' | 'source' | 'md' | 'svg' | 'glb' | 'brep' | 'tf';

  let {
    /* ── INPUT (parent → pane) — pass STABLE references ── */
    bake,                          // bake result object | 'loading' | false (parent state)
    exemplarId,                    // part id / geom-fn name
    paramDefaults,                 // $derived number[] from graph.params (stable per graph)
    graph,                         // composition graph (for brepParamValues + colours)
    hasSolidProducer,              // 3D-bake vs 2D-profile bake tab
    active = true,                 // tab/pane visibility gate (props.active in parent)
    legacyLoad = null,             // legacy-load banner state
    sourceText,                    // emitted .asm.ts source
    cutawayBusy = false,
    cutawayStatus = null,
    rebuildStatus = null,
    restartBusy = false,
    restartStatus = null,
    mdAiBusy = false,
    splineOverlays = undefined,    // TODO #24 — plotted-spline diagnostic overlays for the 3D bake
    /* ── BINDABLE (shared two-way) ── */
    rightTab = $bindable('bake'),  // pane owns persistence; parent sets 'source' on legacy load
    drawingMd = $bindable(''),     // parent state (feeds emitGraph) — bound by the MD textarea
    /* ── CALLBACKS (pane → parent mutations) ── */
    onRebuild,                     // parent rebuildCache — clears cache + re-bakes
    onRestart,                     // parent restartDevServer
    onLoadCutaway,                 // parent loadCutaway — re-bakes w/ cutaway, sets bake/cutawayBusy
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
    legacyLoad?: { id: string; reason: 'no-graph' | 'fetch-failed'; origin?: string } | null;
    sourceText: string;
    cutawayBusy?: boolean;
    cutawayStatus?: string | null;
    rebuildStatus?: string | null;
    restartBusy?: boolean;
    restartStatus?: string | null;
    mdAiBusy?: boolean;
    /** TODO #24 — plotted-spline diagnostic overlays; forwarded to the 3D bake. */
    splineOverlays?: import('$lib/shared/PrimitiveDualScene.svelte').SplineOverlay[];
    rightTab?: RightTab;
    drawingMd?: string;
    onRebuild?: () => void;
    onRestart?: () => void;
    onLoadCutaway?: () => void;
    onGenerateMd?: () => void;
    profilePreview?: Snippet;
  } = $props();

  // ─── Lazy canvas imports (mesh+GLB dual canvas + SVG view) ─────────────────
  let PrimitiveDualCanvas = $state<any>(null);
  let PrimitiveSvgView = $state<any>(null);
  onMount(async () => {
    try {
      const mod = await import('$lib/shared/PrimitiveDualCanvas.svelte');
      PrimitiveDualCanvas = mod.default;
    } catch { /* canvas unavailable */ }
  });
  onMount(async () => {
    try {
      const mod = await import('$lib/shared/PrimitiveSvgView.svelte');
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
      if (t === 'bake' || t === 'source' || t === 'md' || t === 'svg' || t === 'glb' || t === 'brep' || t === 'tf') rightTab = t;
    } catch { /* localStorage blocked — fine */ }
  });
  function setRightTab(t: RightTab) {
    rightTab = t;
    try { localStorage.setItem('ge-right-tab', t); } catch { /* ignore */ }
  }

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
  let tfDemoKind = $state<string>('r_cyl');
  // "actual" mode: import the OPEN part's OWN baked Manifold mesh into the TF
  // kernel (instead of a demo) and show tf's independent topology verdict. When
  // ON the demo dropdown is disabled; OFF → back to the selected demo.
  let tfActualOn = $state<boolean>(false);
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
  /** Pure walk — does any instr (or a nested boolean/transform/union child) stay
   *  UNSUPPORTED? Mirrors execute.ts's recipeHasUnsupported without importing it
   *  (that would pull the TF/WASM bundle into the graph-editor chunk eagerly). */
  function recipeHasUnsupportedLocal(r: import('$lib/cad/graph-to-tf').TfRecipe | undefined): boolean {
    if (!r?.instrs) return false;
    const walk = (i: any): boolean =>
      !!i && (i.op === 'UNSUPPORTED' ||
        walk(i.obj) || walk(i.arg) || walk(i.child) ||
        (Array.isArray(i.children) && i.children.some(walk)));
    return r.instrs.some(walk);
  }
  let tfRecipeServer = $state<import('$lib/cad/graph-to-tf').TfRecipe | undefined>(undefined);
  // The recipe the canvas uses: the server-resolved one when present (composites),
  // else the instant client one.
  let tfRecipe = $derived(tfRecipeServer ?? tfRecipeLocal);
  // When the client recipe has UNSUPPORTED nodes AND "actual" is on, fetch the
  // server-inlined recipe (composites resolved). Re-fires on graph/param change.
  $effect(() => {
    const local = tfRecipeLocal;
    const g = graph, p = brepParamValues;
    if (!tfActualOn || !local || !recipeHasUnsupportedLocal(local)) { tfRecipeServer = undefined; return; }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/tf/compile', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ graph: g, params: p, id: exemplarId }),
        });
        if (!r.ok) return;
        const data = await r.json();
        if (!cancelled && data?.recipe) tfRecipeServer = data.recipe;
      } catch { /* keep the local recipe → mesh-import fallback */ }
    })();
    return () => { cancelled = true; };
  });

  // ─── SVG tab — vector render of the baked geometry (PrimitiveSvgView) ─────
  // The SVG view needs the same { full, cutVC } mesh-JSON the 3D pane bakes; we
  // fetch it from /api/primitives/preview only when the SVG tab is active
  // (active-tab-only discipline) and the body changes, so it never duplicates
  // work while hidden.
  let svgMeshJson = $state<{ full: any; cutVC: any } | null>(null);
  let svgMeshKey = $state<string>('');
  let svgMeshBusy = $state(false);
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
        svgMeshJson = { full: data.full, cutVC: data.cutVC };
      } catch { svgMeshJson = null; }
      finally { svgMeshBusy = false; }
    })();
  });
</script>

<!-- RIGHT pane — tabbed: 3D bake / live source. One tab visible at a
     time; both keep their state mounted so switching is instant. -->
<section class="ge-right-pane">
  <div class="ge-pane-tabs" role="tablist">
    <button class="ge-pane-tab" class:active={rightTab === 'bake'}
      type="button" role="tab" aria-selected={rightTab === 'bake'}
      data-tip={!hasSolidProducer ? '2D preview — resolved polygon (axis at r=0 for revolve, centered for cartesian)' : '3D bake — live mesh + GLB preview'}
      onclick={() => setRightTab('bake')}>{!hasSolidProducer ? '2D preview' : '3D bake'}</button>
    <button class="ge-pane-tab" class:active={rightTab === 'source'}
      type="button" role="tab" aria-selected={rightTab === 'source'}
      data-tip={`SRC — the emitted ${exemplarId}.asm.ts auto-generated from the graph`}
      onclick={() => setRightTab('source')}>SRC</button>
    <button class="ge-pane-tab" class:active={rightTab === 'md'}
      type="button" role="tab" aria-selected={rightTab === 'md'}
      data-tip="MD — hand-authored drawing-descriptor markdown. Saved as meta.drawingMd."
      onclick={() => setRightTab('md')}>MD{drawingMd ? ` · ${drawingMd.length}c` : ''}</button>
    <button class="ge-pane-tab" class:active={rightTab === 'svg'}
      type="button" role="tab" aria-selected={rightTab === 'svg'}
      data-tip="SVG — vector render of the baked geometry (downloadable .svg)"
      onclick={() => setRightTab('svg')}>SVG</button>
    <button class="ge-pane-tab" class:active={rightTab === 'glb'}
      type="button" role="tab" aria-selected={rightTab === 'glb'}
      data-tip="GLB — half-sectioned bake (downloadable). Baked on demand — the bake is slow, so it only runs when you open this tab."
      onclick={() => setRightTab('glb')}>GLB</button>
    <button class="ge-pane-tab" class:active={rightTab === 'brep'}
      type="button" role="tab" aria-selected={rightTab === 'brep'}
      data-tip="BREP — server-side OpenCascade (OCCT) true-curve render. Adaptive tessellation + exact normals. Revolve · extrude · loft · CSG · composed parts."
      onclick={() => setRightTab('brep')}>BREP</button>
    <button class="ge-pane-tab" class:active={rightTab === 'tf'}
      type="button" role="tab" aria-selected={rightTab === 'tf'}
      data-tip="TF — TrueForm (Polydera) client-side exact-mesh kernel. Runs the WASM boolean/generator kernel on the MAIN THREAD (no worker); from-scratch generators + booleans."
      onclick={() => setRightTab('tf')}>TF</button>
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
          colorOuter={graph.colorOuter} colorInner={graph.colorInner}
          viewZScale={graph.viewZScale} viewXScale={graph.viewXScale}
          bakeGlb={false}
          overlays={splineOverlays}
          onRebuild={onRebuild}
          autoScaleOwner={rightTab === 'bake'}
          showControls={true} showLabels={false}/>
        {#if bake === 'loading'}<div class="ge-baking-badge">baking…</div>{/if}
        <!-- Cache status row + Rebuild button (Phase 1.5) -->
        {@const bakeMeta = (displayBake as any).bake ?? {}}
        <div class="ge-bake-meta">
          <!-- Draft toggle + Rebuild moved into the 3D canvas (under the
               ⚙ scale gear): the canvas owns the adjustable segment count +
               the 🔄 fresh-bake button now. -->
          {#if bakeMeta.cached}
            {@const cacheMs = Number(bakeMeta._t?.fetch_total) || 0}
            <span class="ge-cache-badge cached"
              title={`hash: ${bakeMeta.cacheHash ?? '?'} · client round-trip ${cacheMs} ms (mesh decode + paint)`}>
              ✓ cached{cacheMs > 0 ? ` · ${Math.round(cacheMs)} ms` : ''}
            </span>
          {:else if bakeMeta.cacheHash}
            {@const serverMs = Object.entries(bakeMeta._t ?? {}).reduce((a: number, [k, b]: [string, any]) => {
              // fetch_total is the client-perspective round-trip we
              // stash in composition-bake; don't double-count it
              // against the server-side phase sum.
              if (k === 'fetch_total') return a;
              const n = Number(b);
              return a + (Number.isFinite(n) ? n : 0);
            }, 0)}
            <span class="ge-cache-badge fresh" title={`hash: ${bakeMeta.cacheHash}`}>fresh · {Math.round(serverMs as number)} ms</span>
          {/if}
          {#if bakeMeta.cutawaySkipped}
            <span class="ge-cache-badge skipped" title="Cutaway CSG auto-skipped for big manifolds (> 15k tris). Click Load to compute it.">cutaway off (perf)</span>
            <button class="ge-cutaway-load-btn" type="button"
              disabled={cutawayBusy} onclick={onLoadCutaway}
              title="Bake cutaway on-demand for this part">
              {cutawayBusy ? '🔄 …' : 'Load'}
            </button>
            {#if cutawayStatus}<span class="ge-rebuild-stat">{cutawayStatus}</span>{/if}
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
      {#if rightTab === 'glb'}
        {#if PrimitiveDualCanvas && bake && typeof bake === 'object' && bake.source}
          <PrimitiveDualCanvas id={exemplarId} name={exemplarId} description=""
            args={bake.args ?? paramDefaults}
            source={bake.source}
            colorOuter={graph.colorOuter} colorInner={graph.colorInner}
            viewZScale={graph.viewZScale} viewXScale={graph.viewXScale}
            bakeMesh={false}
            autoScaleOwner={active && rightTab === 'glb'}
            showControls={true} showLabels={false}/>
        {:else}
          <div class="ge-empty">No geometry yet — bake the part first (open the 3D bake tab).</div>
        {/if}
      {/if}
    </div>
    <!-- BREP tab — server-side OpenCascade (OCCT) true-curve render in the
         SHARED PrimitiveDualCanvas chrome (backend="brep"): same canvas,
         camera/lights/orbit, ⚙ scale gear, SceneControls, Z-pan, stats + 🔄.
         Posts the emitted source + current param values to /api/brep/preview. -->
    <div class="ge-glb-body" class:hidden={rightTab !== 'brep'}>
      {#if rightTab === 'brep'}
        {#if PrimitiveDualCanvas && bake && typeof bake === 'object' && bake.source}
          <PrimitiveDualCanvas id={exemplarId} name={exemplarId} description=""
            args={bake.args ?? paramDefaults}
            source={bake.source}
            backend="brep"
            brepSource={bake.source}
            brepParams={brepParamValues}
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
    <!-- TF tab — TrueForm (Polydera) client-side exact-mesh kernel. Runs the
         WASM boolean/generator kernel on the MAIN THREAD (no worker) in the
         SHARED PrimitiveDualCanvas chrome (backend="tf"). The ~31MB WASM is
         lazy-loaded only when this tab first opens. The demo is chosen from the
         tf_examples registry dropdown (default r_cyl). -->
    <div class="ge-glb-body" class:hidden={rightTab !== 'tf'}>
      {#if rightTab === 'tf'}
        {#if PrimitiveDualCanvas && bake && typeof bake === 'object' && bake.source}
          <!-- Demo selector: populated from the $lib/shared/tf_examples registry
               (one file per demo). TrueForm has no revolve/loft/extrude, so these
               show what tf CAN build directly — primitives, tubeMesh sweeps, CSG —
               plus the revolved parts (dp_pin/cone) built via the tf.mesh lathe. -->
          <div class="ge-tf-demo-row">
            <span class="ge-tf-demo-label">tf demo</span>
            <select class="ge-tf-demo-select" bind:value={tfDemoKind} disabled={tfActualOn} aria-label="TrueForm demo geometry">
              {#each tfExamples as ex (ex.name)}
                <option value={ex.name}>{ex.label}</option>
              {/each}
            </select>
            <!-- "actual" — import THIS part's own baked mesh into TF (not a demo). -->
            <button type="button" class="ge-tf-actual-btn" class:on={tfActualOn}
              aria-pressed={tfActualOn}
              title="Import this part's own baked Manifold mesh into the TrueForm kernel and show tf's watertight/manifold/χ verdict on your real geometry."
              onclick={() => (tfActualOn = !tfActualOn)}>actual</button>
          </div>
          <PrimitiveDualCanvas id={exemplarId} name={exemplarId} description=""
            args={bake.args ?? paramDefaults}
            source={bake.source}
            backend="tf"
            tfDemo={tfDemoKind}
            tfActual={tfActualOn}
            tfRecipe={tfRecipe}
            brepSource={bake.source}
            brepParams={brepParamValues}
            viewZScale={graph.viewZScale} viewXScale={graph.viewXScale}
            onBakeMeta={(m) => (tfMeta = m)}
            autoScaleOwner={active && rightTab === 'tf'}
            showControls={true} showLabels={false}/>
          <!-- Cache/fresh badge row — mirrors the BREP .ge-bake-meta. -->
          <div class="ge-bake-meta">
            {#if tfMeta && tfMeta.supported === false}
              <span class="ge-cache-badge skipped" title="TrueForm could not build this part.">{tfMeta.reason ?? 'no TF path for this part'}</span>
            {:else if tfMeta}
              <span class="ge-cache-badge fresh" title="Built client-side by the TrueForm WASM kernel (main thread)">fresh · {Math.round(tfMeta.ms)} ms TF</span>
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
  /* Right pane: VERTICAL tab rail on the left + content. */
  .ge-right-pane { display: grid; grid-template-columns: auto 1fr; overflow: hidden; border-left: 1px solid #e5e7eb; }
  .ge-pane-tabs { display: flex; flex-direction: column; gap: 0; background: #f5f5f4; border-right: 1px solid #e7e5e4; }
  .ge-pane-tab { flex: 0 0 auto; writing-mode: vertical-rl; display: flex; align-items: center; justify-content: center; min-height: 70px; white-space: nowrap; padding: 4px 7px; font: 600 11px Arial; color: #78716c; background: transparent; border: 0; border-left: 3px solid transparent; cursor: pointer; text-transform: uppercase; letter-spacing: 0.6px; transition: background 0.12s, color 0.12s, border-color 0.12s; }
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
  .ge-tf-demo-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 5px 8px; background: #faf9f8; border-bottom: 1px solid #e7e5e4; font: 600 11px Arial; color: #57534e; }
  .ge-tf-demo-row .ge-tf-demo-label { text-transform: uppercase; letter-spacing: 0.5px; color: #a8a29e; }
  .ge-tf-demo-row .ge-tf-demo-select { font: 600 11px Arial; color: #57534e; background: #fff; border: 1px solid #d6d3d1; border-radius: 5px; padding: 3px 6px; cursor: pointer; accent-color: #7c3aed; }
  .ge-tf-demo-row .ge-tf-demo-select:focus { outline: none; border-color: #7c3aed; }
  .ge-tf-demo-row .ge-tf-demo-select:disabled { opacity: 0.5; cursor: not-allowed; }
  .ge-tf-demo-row .ge-tf-actual-btn { font: 600 11px Arial; color: #57534e; background: #fff; border: 1px solid #d6d3d1; border-radius: 5px; padding: 3px 10px; cursor: pointer; text-transform: uppercase; letter-spacing: 0.5px; }
  .ge-tf-demo-row .ge-tf-actual-btn:hover { border-color: #7c3aed; color: #6d28d9; }
  .ge-tf-demo-row .ge-tf-actual-btn.on { background: #7c3aed; border-color: #7c3aed; color: #fff; }
  .ge-draft-toggle { display: inline-flex; align-items: center; gap: 3px; font: 600 11px Arial; color: #57534e; cursor: pointer; user-select: none; }
  .ge-draft-toggle input { margin: 0; cursor: pointer; appearance: auto; -webkit-appearance: auto; accent-color: #d97706; width: 13px; height: 13px; }
  .ge-cache-badge { padding: 2px 8px; border-radius: 12px; font: 600 10px ui-monospace, monospace; }
  .ge-cache-badge.cached { background: #d1fae5; color: #065f46; border: 1px solid #6ee7b7; }
  .ge-cache-badge.fresh { background: #fef3c7; color: #92400e; border: 1px solid #fde68a; }
  .ge-cache-badge.skipped { background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; }
  .ge-rebuild-btn { font: 600 11px Arial; color: #1c1917; background: #fff; border: 1px solid #d6d3d1; border-radius: 4px; padding: 3px 10px; cursor: pointer; transition: background 0.12s; }
  .ge-rebuild-btn:hover:not(:disabled) { background: #f5f5f4; }
  .ge-rebuild-btn:disabled { opacity: 0.7; cursor: progress; }
  .ge-rebuild-stat { font: 11px ui-monospace, monospace; color: #57534e; }
  /* Lazy cutaway load button — sits next to the "cutaway off (perf)" badge */
  .ge-cutaway-load-btn { font: 600 10px Arial; color: #fff; background: #b91c1c; border: 1px solid #991b1b; border-radius: 4px; padding: 2px 8px; cursor: pointer; transition: background 0.12s; }
  .ge-cutaway-load-btn:hover:not(:disabled) { background: #991b1b; }
  .ge-cutaway-load-btn:disabled { opacity: 0.7; cursor: progress; }
  .ge-source { margin: 0; padding: 10px 14px; font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; color: #1f2937; background: #fafaf9; overflow: auto; white-space: pre; }
</style>
