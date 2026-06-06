<!--
  /vocab — the K.68 vocabulary as a first-class surface in cadtrain.

  Three panels:
    1. Top bar: version, term counts, lock-file freshness.
    2. Left: Mermaid diagram (renders from docs/parts/vocabulary-graph.mmd).
       Clicking a node selects the term, highlighted in the diagram +
       loaded into the right-side detail panel.
    3. Right: term detail — definition, params, rule (JSON), exemplar id,
       lock-file drift status, action links (jump to dt_<term>, view rule,
       open vocab.json on GitHub).

  Searchable term browser is between the diagram + the detail to keep the
  primary workflow ("which term am I looking at?") in one glance.

  Mermaid is loaded with a dynamic import in onMount so SSR doesn't fail.
-->
<script lang="ts">
  import { onMount } from 'svelte';

  let { data } = $props();
  type Term = string;
  type VocabEntry = any;
  type SeedEntry  = any;
  // Lazy reference-silhouette renderer — used when an entry has compjson_ref.
  let CompJsonSilhouette = $state<any>(null);

  // Top-level state
  let mermaid: any = null;
  let renderedSvg = $state<string>('');
  let renderError = $state<string | null>(null);
  let selected = $state<Term | null>(null);
  let search = $state('');

  // Resizable diagram|detail split — flexible divider, defaults to 50/50.
  let splitPct = $state(50);
  let gridEl: HTMLElement | undefined = $state();
  let dragging = false;
  function startDrag() {
    dragging = true;
    window.addEventListener('pointermove', onDrag);
    window.addEventListener('pointerup', stopDrag);
  }
  function onDrag(e: PointerEvent) {
    if (!dragging || !gridEl) return;
    const r = gridEl.getBoundingClientRect();
    splitPct = Math.max(18, Math.min(82, ((e.clientX - r.left) / r.width) * 100));
  }
  function stopDrag() {
    dragging = false;
    window.removeEventListener('pointermove', onDrag);
    window.removeEventListener('pointerup', stopDrag);
  }
  // Refresh state — per-term + global. While a regen is in flight, the
  // matching button shows ↻… and is disabled. After completion the
  // Scene cache for the affected exemplar is invalidated so the next
  // tab switch re-fetches the live bake.
  let regenBusy = $state<Record<string, boolean>>({});
  let regenAllBusy = $state(false);
  let regenStatus = $state<string | null>(null);

  async function refreshTerm(term: Term) {
    if (regenBusy[term]) return;
    regenBusy = { ...regenBusy, [term]: true };
    regenStatus = `regenerating ${term}…`;
    try {
      const r = await fetch(`/api/vocab/regenerate?term=${encodeURIComponent(term)}`, { method: 'POST' });
      const data = await r.json();
      if (data.ok) {
        const b = data.regenerated?.[0]?.bake;
        regenStatus = b
          ? `✓ ${term} regenerated · ${b.verts} verts · z=${b.z_extent} · r=${b.outer_r}`
          : `✓ ${term} regenerated`;
        // Invalidate the Scene cache so the next mount picks up the fresh bake.
        const exemplar = vocab?.terms?.[term]?.exemplar;
        if (exemplar) {
          const { [exemplar]: _, ...rest } = sceneCache;
          sceneCache = rest;
        }
      } else {
        regenStatus = `✗ ${term}: ${data.failures?.[0]?.error ?? 'unknown error'}`;
      }
    } catch (e: any) {
      regenStatus = `✗ ${term}: ${e?.message ?? e}`;
    } finally {
      regenBusy = { ...regenBusy, [term]: false };
    }
  }
  async function refreshAll() {
    if (regenAllBusy) return;
    regenAllBusy = true;
    regenStatus = 'regenerating all terms…';
    try {
      const r = await fetch('/api/vocab/regenerate?all=1', { method: 'POST' });
      const data = await r.json();
      if (data.ok) {
        regenStatus = `✓ regenerated ${data.regenerated?.length ?? 0} terms`;
      } else {
        const failed = (data.failures ?? []).map((f: any) => `${f.term}: ${f.error}`).join(' · ');
        regenStatus = `✗ ${data.failures?.length ?? '?'} failed — ${failed}`;
      }
      // Invalidate every Scene cache entry — anything could have changed.
      sceneCache = {};
    } catch (e: any) {
      regenStatus = `✗ ${e?.message ?? e}`;
    } finally {
      regenAllBusy = false;
    }
  }
  // Right-pane tab — Definition (default) shows the rule + params + lock;
  // Scene mounts PrimitiveDualCanvas for the selected term's exemplar.
  let detailTab = $state<'definition' | 'scene'>('definition');
  // Lazy-loaded scene canvas (Threlte WebGL — SSR-incompatible, dynamic).
  let PrimitiveDualCanvas = $state<any>(null);
  // Per-term cache of (source, defaultArgs) so flipping back to Scene
  // doesn't refetch. Keyed by exemplar id.
  let sceneCache = $state<Record<string, { source: string; args: (number | string)[] } | 'loading' | 'error'>>({});
  // Inference cache for seeds — keyed by term. The Scene tab kicks off the
  // /api/vocab/infer call on first view; the result feeds both the
  // inferred-polygon list AND a live PrimitiveDualCanvas bake. Promote()
  // then writes the polygon back into vocabulary.seeds.json.
  interface InferResult {
    polygon: Array<[number, number]>;
    source: string;
    bbox: { r_max: number; z_max: number };
    axisymmetric: boolean;
    warnings: string[];
    internal_features: Array<{ kind: string; fill_color: string; polygon: number[][] }>;
    bake?: { ok: boolean; verts?: number; z_extent?: number; outer_r?: number; message?: string };
    exemplar: string;
  }
  let inferCache = $state<Record<string, InferResult | 'loading' | 'error' | { error: string }>>({});
  // K.69 — proposed-bake cache. Distinct from inferCache: this is the
  // PROPOSED (hand-drafted) rule baked via /api/vocab/bake-proposed, NOT
  // the auto-derived single-revolve. The amber proposal card shows it
  // next to the 2D drawing for direct comparison.
  interface ProposedBake {
    exemplar: string;
    source: string;
    bake: { ok: boolean; verts?: number; z_extent?: number; outer_r?: number; message?: string };
  }
  let proposedBakeCache = $state<Record<string, ProposedBake | 'loading' | { error: string }>>({});
  // Left pane: Topology | Browse tabs — share the vertical space instead of stacking.
  let leftTab = $state<'topology' | 'browse'>('topology');
  // Per-term bake tab in the Scene right pane: Inferred | Proposed (vertical tabs).
  let bakeTab = $state<Record<string, 'inferred' | 'proposed'>>({});
  function setBakeTab(term: Term, t: 'inferred' | 'proposed') {
    bakeTab = { ...bakeTab, [term]: t };
    if (t === 'proposed' && !proposedBakeCache[term]) runProposedBake(term);
  }
  // Per-term parameter overrides (drives the proposed bake via slider input).
  // Stored as positional [number, number, …] in meta.params declaration order
  // so it matches what the function signature expects.
  let paramOverrides = $state<Record<string, number[]>>({});
  // Debounce slider input → bake re-fetch by 250ms so dragging is smooth.
  let bakeDebounceTimers: Record<string, ReturnType<typeof setTimeout>> = {};
  function updateParam(term: Term, idx: number, value: number) {
    const cur = paramOverrides[term] ?? defaultParams(term);
    const next = cur.slice(); next[idx] = value;
    paramOverrides = { ...paramOverrides, [term]: next };
    clearTimeout(bakeDebounceTimers[term]);
    bakeDebounceTimers[term] = setTimeout(() => runProposedBake(term, next), 250);
  }
  function defaultParams(term: Term): number[] {
    const entry = getProposed(term);
    if (!entry?.params) return [];
    return Object.values(entry.params).map((p: any) => p.default);
  }
  // Derived view-models referenced from the markup — Svelte5 strict about
  // {@const} placement, so the inline derivations live up here.
  let activeBakeTab = $derived<'inferred' | 'proposed'>(selected ? (bakeTab[selected] ?? 'inferred') : 'inferred');
  let proposedEntry = $derived(selected ? getProposed(selected) : null);
  let currentParams = $derived(selected ? (paramOverrides[selected] ?? defaultParams(selected)) : []);
  let promoteProposedBusy = $state<Record<string, boolean>>({});
  let promoteProposedStatus = $state<string | null>(null);
  async function promoteProposed(term: Term) {
    if (promoteProposedBusy[term]) return;
    promoteProposedBusy = { ...promoteProposedBusy, [term]: true };
    promoteProposedStatus = `promoting ${term} → vocabulary.json…`;
    try {
      const r = await fetch(`/api/vocab/promote-proposed?term=${encodeURIComponent(term)}`, { method: 'POST' });
      const data = await r.json();
      if (data.ok) {
        promoteProposedStatus = `✓ ${term} promoted to vocabulary.json v${data.new_vocab_version}` +
          (data.exemplar_saved ? ` · exemplar ${data.exemplar} saved to volume` : ` · ⚠ exemplar save: ${data.exemplar_save_error ?? 'unknown'}`) +
          (data.seed_marked ? ' · seed flipped to status:promoted' : '');
      } else {
        promoteProposedStatus = `✗ ${term}: ${data.message ?? 'promote failed'}`;
      }
    } catch (e: any) {
      promoteProposedStatus = `✗ ${term}: ${e?.message ?? e}`;
    } finally {
      promoteProposedBusy = { ...promoteProposedBusy, [term]: false };
    }
  }
  async function runProposedBake(term: Term, params?: number[]) {
    // params undefined → first bake or refresh with current overrides;
    // params explicit → slider-driven re-bake, skip the early-return so each
    // tick lands a fresh bake.
    const explicit = Array.isArray(params);
    if (!explicit && proposedBakeCache[term] && proposedBakeCache[term] !== 'loading') return;
    if (!explicit) proposedBakeCache = { ...proposedBakeCache, [term]: 'loading' };
    try {
      const r = await fetch(`/api/vocab/bake-proposed?term=${encodeURIComponent(term)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ params: params ?? [] }),
      });
      const data = await r.json();
      if (!r.ok || !data?.ok) {
        proposedBakeCache = { ...proposedBakeCache, [term]: { error: data?.message ?? `HTTP ${r.status}` } };
        return;
      }
      proposedBakeCache = { ...proposedBakeCache, [term]: { exemplar: data.exemplar, source: data.source, bake: data.bake } };
    } catch (e: any) {
      proposedBakeCache = { ...proposedBakeCache, [term]: { error: e?.message ?? String(e) } };
    }
  }
  let promoteBusy = $state<Record<string, boolean>>({});
  let promoteStatus = $state<string | null>(null);

  async function runInfer(term: Term) {
    if (inferCache[term] && inferCache[term] !== 'error') return;
    inferCache = { ...inferCache, [term]: 'loading' };
    try {
      const r = await fetch(`/api/vocab/infer?term=${encodeURIComponent(term)}`, { method: 'POST' });
      const data = await r.json();
      if (!r.ok || !data?.ok) {
        inferCache = { ...inferCache, [term]: { error: data?.message ?? `HTTP ${r.status}` } };
        return;
      }
      inferCache = { ...inferCache, [term]: data as InferResult };
    } catch (e: any) {
      inferCache = { ...inferCache, [term]: { error: e?.message ?? String(e) } };
    }
  }
  async function promote(term: Term) {
    const inf = inferCache[term];
    if (!inf || typeof inf !== 'object' || 'error' in inf) {
      promoteStatus = `✗ ${term}: nothing to promote — run Infer first`;
      return;
    }
    if (promoteBusy[term]) return;
    promoteBusy = { ...promoteBusy, [term]: true };
    promoteStatus = `promoting ${term}…`;
    try {
      const r = await fetch(`/api/vocab/promote?term=${encodeURIComponent(term)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ polygon: inf.polygon, source: 'inferred' }),
      });
      const data = await r.json();
      if (data.ok) {
        promoteStatus = `✓ ${term} promoted — status flipped to 'promoted'. Reload to see the rule in vocabulary.seeds.json.`;
      } else {
        promoteStatus = `✗ ${term}: ${data.message ?? 'promotion failed'}`;
      }
    } catch (e: any) {
      promoteStatus = `✗ ${term}: ${e?.message ?? e}`;
    } finally {
      promoteBusy = { ...promoteBusy, [term]: false };
    }
  }

  // When a term is selected + the Scene tab is active, fetch its
  // source + default params once. The component shows a loading state
  // until ready.
  $effect(() => {
    if (detailTab !== 'scene') return;
    if (!selectedEntry) return;
    const exemplarId = selectedEntry.exemplar as string;
    if (!exemplarId) return;
    if (sceneCache[exemplarId]) return;
    sceneCache = { ...sceneCache, [exemplarId]: 'loading' };
    (async () => {
      try {
        const r = await fetch(`/api/primitives/source?name=${encodeURIComponent(exemplarId)}`);
        if (!r.ok) throw new Error(`source ${exemplarId}: ${r.status}`);
        const d = await r.json();
        const args = Object.values(d.params ?? {}).map((p: any) => p.default);
        sceneCache = { ...sceneCache, [exemplarId]: { source: d.source, args } };
      } catch {
        sceneCache = { ...sceneCache, [exemplarId]: 'error' };
      }
    })();
  });

  const vocab = data.vocab as { version: string; terms: Record<Term, VocabEntry> } | null;
  const lock  = data.lock as { vocab_version: string; terms: Record<Term, any> } | null;
  const mmd   = data.mmd as string | null;
  const seeds = data.seeds as { version: string; terms: Record<Term, SeedEntry>; stats: any } | null;
  // K.69 — proposed promoted entries, keyed by seed slug. Renders in the
  // seed Scene tab as a "Proposed vocab entry — review before promoting"
  // preview card. Edits land in docs/parts/proposed-vocab-entries.json
  // (out-of-band for now — chat-driven; promote takes the whole entry once
  // the user approves).
  const proposed = data.proposed as { version: string; entries: Record<Term, any> } | null;
  function getProposed(term: Term): any | null { return proposed?.entries?.[term] ?? null; }

  // Derived view models — curated and seed terms walk through the same
  // browser/detail UI. Seeds get a distinct `seed` chip + a different
  // Scene tab body (silhouette only, no 3D bake — they have no rule
  // and no exemplar to load).
  function isSeed(term: Term): boolean {
    return !!seeds?.terms?.[term] && !vocab?.terms?.[term];
  }
  function lookup(term: Term): VocabEntry | SeedEntry | null {
    return vocab?.terms?.[term] ?? seeds?.terms?.[term] ?? null;
  }

  let termList = $derived<Array<{ term: Term; entry: any; seed: boolean }>>(() => {
    const out: Array<{ term: Term; entry: any; seed: boolean }> = [];
    if (vocab) for (const [t, e] of Object.entries(vocab.terms)) out.push({ term: t, entry: e, seed: false });
    if (seeds) for (const [t, e] of Object.entries(seeds.terms)) if (!vocab?.terms?.[t]) out.push({ term: t, entry: e, seed: true });
    return out;
  });
  let filteredTerms = $derived(() => {
    const q = search.trim().toLowerCase();
    const list = termList();
    if (!q) return list;
    return list.filter(({ term, entry }) => {
      if (term.toLowerCase().includes(q)) return true;
      if ((entry.definition ?? entry.description ?? '').toLowerCase().includes(q)) return true;
      const syns = (entry.synonyms ?? []) as string[];
      return syns.some((s) => s.toLowerCase().includes(q));
    });
  });
  let primCount  = $derived(termList().filter((x) => !x.seed && x.entry.kind === 'rev').length);
  let asmCount   = $derived(termList().filter((x) => !x.seed && x.entry.kind === 'asm').length);
  let seedCount  = $derived(termList().filter((x) =>  x.seed).length);
  let selectedEntry = $derived<any>(selected ? lookup(selected) : null);
  let selectedIsSeed = $derived<boolean>(selected ? isSeed(selected) : false);

  // Drift detection — compare lock.source_hash to whatever's "current".
  // For v0.1, we just count terms where the lock exists; the runner is
  // the authoritative source of drift. Future: hit the live source endpoint
  // here and re-hash for in-page diffs.
  let lockTermCount = $derived(lock ? Object.keys(lock.terms ?? {}).length : 0);

  // Lazy-load PrimitiveDualCanvas — WebGL / threlte → SSR-incompatible.
  onMount(async () => {
    try {
      const mod = await import('$lib/shared/PrimitiveDualCanvas.svelte');
      PrimitiveDualCanvas = mod.default;
    } catch { /* fall back to "scene unavailable" message */ }
    try {
      const mod = await import('$lib/shared/CompJsonSilhouette.svelte');
      CompJsonSilhouette = mod.default;
    } catch { /* silhouette renderer optional */ }
  });

  // Render Mermaid on mount + when mmd changes.
  onMount(async () => {
    if (!mmd) return;
    try {
      const m = await import('mermaid');
      mermaid = m.default;
      mermaid.initialize({
        startOnLoad: false,
        theme: 'default',
        themeVariables: {
          fontFamily: 'ui-sans-serif, system-ui, Arial',
          primaryColor: '#e0f2fe',
          primaryTextColor: '#0c4a6e',
          primaryBorderColor: '#0369a1',
          lineColor: '#475569',
        },
        flowchart: { useMaxWidth: true, curve: 'basis' },
      });
      const { svg } = await mermaid.render('vocab-graph', mmd);
      renderedSvg = svg;
      // Wire click handlers post-render — Mermaid emits each node with
      // class `node` and an id like "flowchart-<term>-N". Walk + attach.
      queueMicrotask(() => {
        const root = document.getElementById('vocab-diagram');
        if (!root) return;
        for (const el of root.querySelectorAll('.node')) {
          const labelEl = el.querySelector('.nodeLabel, text');
          const raw = labelEl?.textContent?.trim() ?? '';
          // Mermaid puts the line break HTML into label text — first token before <br/>
          const term = raw.split(/\s|<br|\n/)[0];
          if (!term) continue;
          (el as HTMLElement).style.cursor = 'pointer';
          el.addEventListener('click', () => { selected = term; });
        }
      });
    } catch (e: any) {
      renderError = e?.message ?? String(e);
    }
  });

  function selectTerm(t: Term) { selected = t; }

  function ruleSummary(entry: VocabEntry): string {
    const r = entry?.rule;
    if (!r) return '';
    if (r.kind === 'primitive') {
      return r.derived_from_profile
        ? `primitive · polygon_inline · derived from ${r.derived_from_profile}`
        : `primitive · ${r.template ?? '?'}`;
    }
    if (r.kind === 'compose') {
      const imps = (r.imports ?? []).map((i: any) => `${i.alias}:${i.term}`).join(', ');
      const cType = r.composition?.type ?? '?';
      return `compose · ${cType} · imports {${imps}}`;
    }
    return r.kind ?? '?';
  }
</script>

<svelte:head>
  <title>Vocab · CAD Train</title>
</svelte:head>

<div class="vocab-root">
  <header class="vocab-bar">
    <h1>Vocab</h1>
    {#if vocab}
      <span class="bar-meta">v{vocab.version}</span>
      <span class="bar-meta">{termList().length} terms</span>
      <span class="bar-chip prim">{primCount} primitives</span>
      <span class="bar-chip asm">{asmCount} assemblies</span>
      {#if seedCount}<span class="bar-chip seed">{seedCount} seeds</span>{/if}
      {#if lock}
        <span class="bar-meta">lock: v{lock.vocab_version}, {lockTermCount} entries</span>
      {:else}
        <span class="bar-meta">no lock file</span>
      {/if}
    {:else}
      <span class="bar-meta error">no vocabulary loaded</span>
    {/if}
    <span class="bar-spacer"></span>
    {#if regenStatus}<span class="bar-status">{regenStatus}</span>{/if}
    <button
      class="bar-btn"
      type="button"
      disabled={regenAllBusy}
      title="Regenerate every term from the vocabulary + re-bake on the volume"
      onclick={refreshAll}
    >{regenAllBusy ? '↻ …' : '↻ Refresh all'}</button>
    <a class="bar-link" href="https://github.com/pyenthu/cadtrain/blob/main/docs/parts/vocabulary.json" target="_blank" rel="noopener">vocab.json ↗</a>
    <a class="bar-link" href="https://github.com/pyenthu/cadtrain/blob/main/docs/parts/vocabulary.lock.json" target="_blank" rel="noopener">lock ↗</a>
    <a class="bar-link" href="https://github.com/pyenthu/cadtrain/blob/main/docs/parts/vocabulary.md" target="_blank" rel="noopener">md ↗</a>
  </header>

  <main class="vocab-grid" bind:this={gridEl} style="grid-template-columns: {splitPct}fr 7px {100 - splitPct}fr">
    <!-- LEFT: Topology | Browse tabs (share vertical space, switch freely). -->
    <section class="diagram-pane">
      <div class="left-tabs" role="tablist">
        <button class="left-tab" class:active={leftTab === 'topology'} role="tab" aria-selected={leftTab === 'topology'}
          type="button" onclick={() => (leftTab = 'topology')}>Topology</button>
        <button class="left-tab" class:active={leftTab === 'browse'} role="tab" aria-selected={leftTab === 'browse'}
          type="button" onclick={() => (leftTab = 'browse')}>Browse <span class="tab-count">{termList().length}</span></button>
        <span class="tab-spacer"></span>
        {#if leftTab === 'topology'}<span class="hint">click a node →</span>{/if}
      </div>

      {#if leftTab === 'topology'}
        {#if mmd}
          <div id="vocab-diagram" class="diagram">
            {#if renderedSvg}
              {@html renderedSvg}
            {:else if renderError}
              <pre class="error">Mermaid render failed: {renderError}</pre>
              <pre class="raw">{mmd}</pre>
            {:else}
              <div class="loading">rendering…</div>
            {/if}
          </div>
        {:else}
          <div class="empty">no vocabulary-graph.mmd on disk — run <code>bun scripts/render-vocab-graph.ts &gt; docs/parts/vocabulary-graph.mmd</code></div>
        {/if}
      {:else}
        <div class="browser browser-full">
          <input
            type="text"
            class="browser-search"
            placeholder="search terms · synonyms · definitions"
            bind:value={search}
          />
          <div class="browser-list">
            {#each filteredTerms() as { term, entry, seed } (term)}
              <button
                class="browser-row"
                class:active={selected === term}
                class:asm={!seed && entry.kind === 'asm'}
                class:seed
                type="button"
                onclick={() => selectTerm(term)}
              >
                <span class="row-kind">{seed ? 'seed' : (entry.kind === 'asm' ? 'asm' : 'rev')}</span>
                <span class="row-name">{term}</span>
                <span class="row-rule">{seed
                  ? `${entry.category} · ${entry.sub_category}${entry.variants?.length > 1 ? ` · ${entry.variants.length} variants` : ''}`
                  : ruleSummary(entry)}</span>
              </button>
            {/each}
            {#if filteredTerms().length === 0}
              <div class="empty">no terms match "{search}"</div>
            {/if}
          </div>
        </div>
      {/if}
    </section>

    <!-- draggable divider -->
    <div
      class="vdivider"
      class:dragging
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panels"
      onpointerdown={startDrag}
      ondblclick={() => (splitPct = 50)}
      title="Drag to resize · double-click for 50/50"
    ></div>

    <!-- RIGHT: term details -->
    <aside class="detail-pane">
      {#if !selected}
        <div class="detail-empty">
          <p>Click a node in the diagram or a row in the list to view a term's full rule + params + provenance.</p>
        </div>
      {:else if !selectedEntry}
        <div class="detail-empty error">"{selected}" not found in vocabulary.json</div>
      {:else}
        {@const e = selectedEntry}
        <div class="detail-head">
          <span class="detail-kind" class:asm={!selectedIsSeed && e.kind === 'asm'} class:seed={selectedIsSeed}>{selectedIsSeed ? 'seed' : e.kind}</span>
          <h2>{selected}</h2>
        </div>
        <!-- Tab strip — Definition (rule + params + lock) | Scene (live 3D
             for curated terms, silhouette + variants table for seeds). -->
        <div class="tab-strip" role="tablist">
          <button class="tab-btn" class:active={detailTab === 'definition'} role="tab" aria-selected={detailTab === 'definition'}
            type="button" onclick={() => (detailTab = 'definition')}>Definition</button>
          <button class="tab-btn" class:active={detailTab === 'scene'} role="tab" aria-selected={detailTab === 'scene'}
            type="button" onclick={() => (detailTab = 'scene')}>Scene</button>
          <span class="tab-spacer"></span>
          {#if !selectedIsSeed}
            <button class="tab-refresh" type="button"
              disabled={regenBusy[selected!]}
              title={`Regenerate ${selected} from vocab + re-bake. Invalidates the Scene cache so the next mount picks up the fresh source.`}
              onclick={() => refreshTerm(selected!)}
            >{regenBusy[selected!] ? '↻ …' : '↻ Refresh'}</button>
            <span class="tab-exemplar"><code>{e.exemplar}</code></span>
          {:else}
            <span class="tab-exemplar"><code>seed · no rule yet</code></span>
          {/if}
        </div>
        {#if detailTab === 'scene'}
          <div class="scene-pane">
            {#if selectedIsSeed}
              <!-- Seeds: top row = 2D drawing + Inferred 3D side-by-side.
                   Below = inferred polygon + bake numbers + Promote button.
                   At the bottom = metadata + variants table. -->
              {@const inf = inferCache[selected!]}
              <div class="seed-scene">
                <div class="seed-row">
                  {#if e.compjson_ref && CompJsonSilhouette}
                    <CompJsonSilhouette ref={e.compjson_ref} title="2D vendor reference" height={320} />
                  {:else}
                    <div class="silhouette empty-card">no compjson_ref on file</div>
                  {/if}

                  <!-- VERTICAL TABS: Inferred vs Proposed bake. Each tab's
                       content swaps in this single canvas pane. -->
                  <div class="bake-vtabs">
                    <div class="vtab-strip" role="tablist">
                      <button class="vtab" class:active={activeBakeTab === 'inferred'} role="tab" aria-selected={activeBakeTab === 'inferred'}
                        type="button" onclick={() => setBakeTab(selected!, 'inferred')}>Inferred</button>
                      <button class="vtab" class:active={activeBakeTab === 'proposed'} role="tab" aria-selected={activeBakeTab === 'proposed'}
                        type="button" disabled={!proposedEntry}
                        title={proposedEntry ? 'Proposed rich rule (boolean_modify)' : 'no proposed entry for this term'}
                        onclick={() => setBakeTab(selected!, 'proposed')}>Proposed</button>
                    </div>

                    <div class="vtab-content">
                      {#if activeBakeTab === 'inferred'}
                        <div class="bake-head">
                          <div class="bake-title">Inferred 3D · r_revolve</div>
                          <span class="spacer"></span>
                          {#if !inf || inf === 'error'}
                            <button class="bar-btn" type="button" onclick={() => runInfer(selected!)}>Infer</button>
                          {:else if inf === 'loading'}
                            <span class="bar-status">inferring…</span>
                          {:else if 'error' in inf}
                            <button class="bar-btn" type="button" onclick={() => runInfer(selected!)}>retry</button>
                          {:else}
                            <span class="bar-meta">{inf.bake?.verts ?? '?'} verts · z={inf.bake?.z_extent ?? '?'} · r={inf.bake?.outer_r ?? '?'}</span>
                          {/if}
                        </div>
                        {#if !inf}
                          <div class="infer-cta">
                            Click <strong>Infer</strong> to derive an axisymmetric profile from the 2D drawing.
                            <br>Deterministic — half-section + OD-calibration → <code>r_revolve</code> polygon.
                          </div>
                        {:else if inf === 'loading'}
                          <div class="empty">inferring polygon + bake…</div>
                        {:else if 'error' in inf}
                          <div class="error">inference failed: {inf.error}</div>
                        {:else if !inf.bake?.ok}
                          <div class="error">bake failed: {inf.bake?.message ?? 'no bake result'}</div>
                        {:else if PrimitiveDualCanvas}
                          <PrimitiveDualCanvas
                            id={inf.exemplar}
                            name={inf.exemplar}
                            description={`Inferred from ${e.compjson_ref}`}
                            args={[]}
                            source={inf.source}
                            showControls={true}
                            showLabels={false}
                          />
                        {:else}
                          <div class="empty">3D canvas loading…</div>
                        {/if}
                      {:else}
                        <!-- Proposed tab -->
                        {@const pb = proposedBakeCache[selected!]}
                        <div class="bake-head">
                          <div class="bake-title">Proposed 3D · {proposedEntry?.rule?.kind ?? '?'}</div>
                          <span class="spacer"></span>
                          {#if !pb}
                            <button class="bar-btn" type="button" onclick={() => runProposedBake(selected!)}>Bake proposed</button>
                          {:else if pb === 'loading'}
                            <span class="bar-status">baking…</span>
                          {:else if 'error' in (pb as any)}
                            <button class="bar-btn" type="button" onclick={() => runProposedBake(selected!)}>retry</button>
                            <span class="bar-status err">err: {(pb as any).error}</span>
                          {:else}
                            <span class="bar-meta">{(pb as ProposedBake).bake?.verts ?? '?'} verts · z={(pb as ProposedBake).bake?.z_extent ?? '?'} · r={(pb as ProposedBake).bake?.outer_r ?? '?'}</span>
                          {/if}
                        </div>
                        {#if !pb}
                          <div class="infer-cta">
                            Click <strong>Bake proposed</strong> to render the hand-drafted rule (e.g. <code>boolean_modify</code> with the angled cut).
                            <br>Drag the sliders below the canvas to re-bake with different params.
                          </div>
                        {:else if pb === 'loading'}
                          <div class="empty">baking proposed source…</div>
                        {:else if 'error' in (pb as any)}
                          <div class="error">bake failed: {(pb as any).error}</div>
                        {:else if !(pb as ProposedBake).bake?.ok}
                          <div class="error">bake failed: {(pb as ProposedBake).bake?.message ?? 'no bake result'}</div>
                        {:else if PrimitiveDualCanvas}
                          {@const proposedPb = pb as ProposedBake}
                          <PrimitiveDualCanvas
                            id={proposedPb.exemplar}
                            name={proposedPb.exemplar}
                            description={proposedEntry?.definition}
                            args={paramOverrides[selected!] ?? defaultParams(selected!)}
                            source={proposedPb.source}
                            showControls={true}
                            showLabels={false}
                          />
                          {#if proposedEntry?.params}
                            <div class="param-sliders">
                              <div class="ps-cap">params · drag to re-bake live</div>
                              {#each Object.entries(proposedEntry.params) as [pk, pdef], idx (pk)}
                                {@const cur = (paramOverrides[selected!] ?? defaultParams(selected!))[idx] ?? (pdef as any).default}
                                <div class="ps-row">
                                  <span class="ps-key">{pk}</span>
                                  <input class="ps-slider" type="range"
                                    min={(pdef as any).min ?? 0}
                                    max={(pdef as any).max ?? 100}
                                    step={(pdef as any).step ?? 0.1}
                                    value={cur}
                                    oninput={(ev) => updateParam(selected!, idx, Number((ev.target as HTMLInputElement).value))}
                                  />
                                  <input class="ps-num" type="number"
                                    min={(pdef as any).min ?? 0}
                                    max={(pdef as any).max ?? 100}
                                    step={(pdef as any).step ?? 0.1}
                                    value={cur}
                                    oninput={(ev) => updateParam(selected!, idx, Number((ev.target as HTMLInputElement).value))}
                                  />
                                  <span class="ps-unit">{(pdef as any).unit ?? ''}</span>
                                </div>
                              {/each}
                            </div>
                          {/if}
                        {:else}
                          <div class="empty">3D canvas loading…</div>
                        {/if}
                      {/if}
                    </div>
                  </div>
                </div>

                {#if inf && typeof inf === 'object' && !('error' in inf) && inf.polygon?.length}
                  <div class="infer-details">
                    <div class="cap-row">
                      <div class="caption">Profile polygon — {inf.polygon.length} verts · axisymmetric: {inf.axisymmetric ? 'yes' : 'no'}</div>
                      <span class="spacer"></span>
                      <button class="bar-btn promote-btn" type="button" disabled={promoteBusy[selected!]}
                        title="Write this polygon into vocabulary.seeds.json as the seed's rule and flip status to promoted."
                        onclick={() => promote(selected!)}
                      >{promoteBusy[selected!] ? 'promoting…' : '✓ Promote → vocabulary'}</button>
                    </div>
                    <details class="block">
                      <summary>polygon vertices · [r in, z in]</summary>
                      <pre class="code">{inf.polygon.map(([r, z]: [number, number], i: number) => `  [${i.toString().padStart(2)}]  r=${r.toFixed(4).padStart(8)}  z=${z.toFixed(4).padStart(8)}`).join('\n')}</pre>
                    </details>
                    {#if inf.internal_features?.length}
                      <details class="block">
                        <summary>{inf.internal_features.length} internal feature{inf.internal_features.length === 1 ? '' : 's'} (seats / elastomer / marks)</summary>
                        <pre class="code">{inf.internal_features.map((f: any, i: number) => `[${i}] ${f.kind} (fill ${f.fill_color}) — ${f.polygon.length} verts`).join('\n')}</pre>
                      </details>
                    {/if}
                    {#if inf.warnings?.length}
                      <details class="block" open>
                        <summary>{inf.warnings.length} warning{inf.warnings.length === 1 ? '' : 's'}</summary>
                        <ul class="warn-list">
                          {#each inf.warnings as w (w)}<li>⚠ {w}</li>{/each}
                        </ul>
                      </details>
                    {/if}
                    <details class="block">
                      <summary>generated source (.rev.ts)</summary>
                      <pre class="code">{inf.source}</pre>
                    </details>
                  </div>
                {/if}

                {#if proposedEntry}
                  {@const prop = proposedEntry}
                  <div class="proposal-card">
                    <div class="cap-row">
                      <div class="caption">Proposed vocab entry — review before promoting</div>
                      <span class="spacer"></span>
                      <span class="prop-status">draft · review only · bake in the <em>Proposed</em> tab above</span>
                    </div>

                    <div class="prop-grid">
                      <div class="prop-field">
                        <div class="prop-label">definition</div>
                        <p class="prop-definition">{prop.definition}</p>
                      </div>

                      <div class="prop-field">
                        <div class="prop-label">kind · extends</div>
                        <div class="prop-val">
                          <span class="prop-chip kind">{prop.kind}</span>
                          {#if prop.extends}
                            <span class="prop-arrow">extends</span>
                            <span class="prop-chip ext">{prop.extends}</span>
                          {/if}
                          <span class="prop-cat">{prop.category} · {prop.sub_category}</span>
                        </div>
                      </div>

                      {#if prop.synonyms?.length}
                        <div class="prop-field">
                          <div class="prop-label">synonyms ({prop.synonyms.length})</div>
                          <div class="prop-chips">
                            {#each prop.synonyms as s (s)}<span class="prop-chip syn">{s}</span>{/each}
                          </div>
                        </div>
                      {/if}

                      {#if prop.function?.length}
                        <div class="prop-field">
                          <div class="prop-label">function · intent</div>
                          <div class="prop-chips">
                            {#each prop.function as f (f)}<span class="prop-chip fn">{f}</span>{/each}
                          </div>
                        </div>
                      {/if}

                      {#if prop.form?.length}
                        <div class="prop-field">
                          <div class="prop-label">form · shape</div>
                          <div class="prop-chips">
                            {#each prop.form as f (f)}<span class="prop-chip form">{f}</span>{/each}
                          </div>
                        </div>
                      {/if}

                      {#if prop.variants?.length}
                        <div class="prop-field">
                          <div class="prop-label">variants ({prop.variants.length})</div>
                          <div class="prop-chips">
                            {#each prop.variants as v (v)}<span class="prop-chip variant">{v}</span>{/each}
                          </div>
                        </div>
                      {/if}

                      {#if prop.references?.length}
                        <div class="prop-field">
                          <div class="prop-label">references</div>
                          <div class="prop-chips">
                            {#each prop.references as r (r)}<a class="prop-ref" href={r} target="_blank" rel="noopener">{r.replace(/^https?:\/\//, '')}</a>{/each}
                          </div>
                        </div>
                      {/if}

                      {#if prop.params}
                        <details class="block">
                          <summary>params ({Object.keys(prop.params).length})</summary>
                          <table class="params-table">
                            <thead><tr><th>key</th><th>default</th><th>min</th><th>max</th><th>step</th><th>unit</th></tr></thead>
                            <tbody>
                              {#each Object.entries(prop.params) as [k, p] (k)}
                                <tr><td><code>{k}</code></td><td>{(p as any).default}</td><td>{(p as any).min ?? '—'}</td><td>{(p as any).max ?? '—'}</td><td>{(p as any).step ?? '—'}</td><td>{(p as any).unit ?? '—'}</td></tr>
                              {/each}
                            </tbody>
                          </table>
                        </details>
                      {/if}

                      {#if prop.rule}
                        <details class="block" open>
                          <summary>rule · {prop.rule.kind}{prop.rule.engine ? ` · engine: ${(prop.rule.engine as string[]).join(', ')}` : ''}</summary>
                          {#if prop.rule.body?.preamble?.length}
                            <div class="rule-section">
                              <div class="prop-label">body · preamble</div>
                              <pre class="code">{prop.rule.body.preamble.join('\n')}</pre>
                            </div>
                          {/if}
                          {#if prop.rule.body?.polygon?.length}
                            <div class="rule-section">
                              <div class="prop-label">body · polygon ({prop.rule.body.polygon.length} verts)</div>
                              <pre class="code">{prop.rule.body.polygon.map((p: string, i: number) => `  [${i}] ${p}`).join('\n')}</pre>
                            </div>
                          {/if}
                          {#if prop.rule.modifiers?.length}
                            <div class="rule-section">
                              <div class="prop-label">modifiers ({prop.rule.modifiers.length})</div>
                              <pre class="code">{JSON.stringify(prop.rule.modifiers, null, 2)}</pre>
                            </div>
                          {/if}
                        </details>
                      {/if}

                      {#if prop.expects_bake}
                        <details class="block">
                          <summary>expects bake</summary>
                          <pre class="code">{JSON.stringify(prop.expects_bake, null, 2)}</pre>
                        </details>
                      {/if}

                      <details class="block">
                        <summary>raw proposed JSON</summary>
                        <pre class="code">{JSON.stringify(prop, null, 2)}</pre>
                      </details>
                    </div>

                    <div class="prop-actions">
                      <button
                        class="bar-btn promote-btn"
                        type="button"
                        disabled={promoteProposedBusy[selected!] || !proposedBakeCache[selected!] || proposedBakeCache[selected!] === 'loading' || (proposedBakeCache[selected!] && 'error' in (proposedBakeCache[selected!] as any))}
                        title="Lift this proposed entry into vocabulary.json (curated terms) AND save dt_<term>.prim.ts to the volume. Bake the proposal first."
                        onclick={() => promoteProposed(selected!)}
                      >{promoteProposedBusy[selected!] ? 'promoting…' : '✓ Promote to vocabulary.json'}</button>
                      <span class="prop-actions-hint">
                        {#if !proposedBakeCache[selected!] || proposedBakeCache[selected!] === 'loading'}
                          bake the proposed 3D first (button at top right of this card)
                        {:else}
                          writes vocabulary.json + saves <code>{prop.exemplar ?? `dt_${selected}`}</code> to volume
                        {/if}
                      </span>
                    </div>
                    {#if promoteProposedStatus}<div class="promote-status">{promoteProposedStatus}</div>{/if}
                    <div class="prop-footer">
                      Editing is by chat — tell me what to change and I'll update
                      <code>docs/parts/proposed-vocab-entries.json</code>.
                    </div>
                  </div>
                {/if}

                <div class="seed-meta">
                  <div class="kv-row"><span class="kv-key">category</span><span class="kv-val">{e.category} · {e.sub_category}</span></div>
                  {#if e.metadata?.tool_comp}
                    <div class="kv-row"><span class="kv-key">tool_comp</span><span class="kv-val"><code>{e.metadata.tool_comp}</code></span></div>
                  {/if}
                  <div class="kv-row"><span class="kv-key">defaults (1st row)</span>
                    <span class="kv-val">OD {e.dims_from_catalogue?.od_in ?? '—'}" · ID {e.dims_from_catalogue?.id_in ?? '—'}" · L {e.dims_from_catalogue?.length_ft ?? '—'} ft</span>
                  </div>
                  {#if e.variants?.length}
                    <details class="block">
                      <summary>{e.variants.length} catalogue variant{e.variants.length === 1 ? '' : 's'}</summary>
                      <table class="params-table">
                        <thead><tr><th>#</th><th>OD"</th><th>ID"</th><th>L ft</th><th>weight</th><th>company</th><th>top thread</th><th>bot thread</th><th>grade</th></tr></thead>
                        <tbody>
                          {#each e.variants as v (v.comp_id)}
                            <tr>
                              <td><code>{v.comp_id}</code></td>
                              <td>{v.od_in ?? '—'}</td>
                              <td>{v.id_in ?? '—'}</td>
                              <td>{v.length_ft ?? '—'}</td>
                              <td>{v.weight_lb ?? '—'}</td>
                              <td>{v.company ?? '—'}</td>
                              <td>{v.top_thread ?? '—'}</td>
                              <td>{v.bot_thread ?? '—'}</td>
                              <td>{v.grade ?? '—'}</td>
                            </tr>
                          {/each}
                        </tbody>
                      </table>
                    </details>
                  {/if}
                </div>
                {#if promoteStatus}<div class="promote-status">{promoteStatus}</div>{/if}
              </div>
            {:else}
              {@const sc = sceneCache[e.exemplar]}
              <div class="curated-scene" class:with-ref={!!e.compjson_ref && CompJsonSilhouette}>
                <div class="bake-3d">
                  {#if !PrimitiveDualCanvas}
                    <div class="empty">scene component loading…</div>
                  {:else if !sc || sc === 'loading'}
                    <div class="empty">fetching {e.exemplar}…</div>
                  {:else if sc === 'error'}
                    <div class="error">couldn't load {e.exemplar} — does it exist on the volume? (Run <code>bun scripts/regenerate-from-vocab.ts</code>)</div>
                  {:else}
                    {@const params = sc as { source: string; args: (number | string)[] }}
                    <PrimitiveDualCanvas
                      id={e.exemplar}
                      name={e.exemplar}
                      description={e.definition}
                      args={params.args}
                      source={params.source}
                      showControls={true}
                      showLabels={false}
                    />
                  {/if}
                </div>
                {#if e.compjson_ref && CompJsonSilhouette}
                  <CompJsonSilhouette ref={e.compjson_ref} title="2D vendor reference" height={300} />
                {/if}
              </div>
            {/if}
          </div>
        {:else if selectedIsSeed}
        <!-- Seed definition tab: catalogue metadata, synonyms, dims, variants
             count. No rule / params / lock — those land on promotion. -->
        <p class="detail-def">{e.description ?? '(no description)'}</p>
        {#if e.synonyms?.length}
          <div class="syn-row">
            <span class="syn-label">synonyms</span>
            {#each e.synonyms as s (s)}<span class="syn-chip">{s}</span>{/each}
          </div>
        {/if}
        <div class="kv-row"><span class="kv-key">category</span><span class="kv-val">{e.category} · {e.sub_category}</span></div>
        {#if e.metadata?.tool_comp}
          <div class="kv-row"><span class="kv-key">tool_comp</span><span class="kv-val"><code>{e.metadata.tool_comp}</code></span></div>
        {/if}
        {#if e.metadata?.tags?.length}
          <div class="kv-row"><span class="kv-key">tags</span><span class="kv-val">{e.metadata.tags.join(', ')}</span></div>
        {/if}
        <div class="kv-row"><span class="kv-key">variants</span><span class="kv-val">{e.variants?.length ?? 0} catalogue row{(e.variants?.length ?? 0) === 1 ? '' : 's'}</span></div>
        {#if e.compjson_ref}
          <div class="kv-row"><span class="kv-key">silhouette</span><span class="kv-val"><code>{e.compjson_ref}</code></span></div>
        {/if}
        <details class="block">
          <summary>raw seed JSON</summary>
          <pre class="code">{JSON.stringify(e, null, 2)}</pre>
        </details>
        {:else}
        <p class="detail-def">{e.definition ?? '(no definition)'}</p>
        {#if e.synonyms?.length}
          <div class="syn-row">
            <span class="syn-label">synonyms</span>
            {#each e.synonyms as s (s)}<span class="syn-chip">{s}</span>{/each}
          </div>
        {/if}
        {#if e.extends}
          <div class="kv-row"><span class="kv-key">extends</span><span class="kv-val">{e.extends}</span></div>
        {/if}
        <div class="kv-row"><span class="kv-key">exemplar</span>
          <a class="kv-val link" href="/primitives" onclick={(ev) => { ev.preventDefault(); if (typeof window !== 'undefined') window.open(`/primitives?open=${e.exemplar}`, '_blank'); }}>{e.exemplar}</a>
        </div>
        <div class="kv-row"><span class="kv-key">rule</span><span class="kv-val">{ruleSummary(e)}</span></div>

        {#if e.params}
          <details class="block" open>
            <summary>params ({Object.keys(e.params).length})</summary>
            <table class="params-table">
              <thead><tr><th>key</th><th>default</th><th>min</th><th>max</th><th>step</th><th>unit</th></tr></thead>
              <tbody>
                {#each Object.entries(e.params) as [k, p] (k)}
                  <tr><td><code>{k}</code></td><td>{(p as any).default}</td><td>{(p as any).min ?? '—'}</td><td>{(p as any).max ?? '—'}</td><td>{(p as any).step ?? '—'}</td><td>{(p as any).unit ?? '—'}</td></tr>
                {/each}
              </tbody>
            </table>
          </details>
        {/if}

        {#if e.rule?.kind === 'primitive' && e.rule?.preamble}
          <details class="block">
            <summary>preamble ({e.rule.preamble.length} lines)</summary>
            <pre class="code">{e.rule.preamble.join('\n')}</pre>
          </details>
        {/if}
        {#if e.rule?.kind === 'primitive' && e.rule?.polygon}
          <details class="block">
            <summary>polygon ({e.rule.polygon.length} vertices)</summary>
            <pre class="code">{e.rule.polygon.map((p: string, i: number) => `  [${i}] ${p}`).join('\n')}</pre>
          </details>
        {/if}
        {#if e.rule?.kind === 'compose'}
          <details class="block" open>
            <summary>composition</summary>
            <pre class="code">{JSON.stringify(e.rule.composition, null, 2)}</pre>
          </details>
        {/if}
        {#if e.expects_bake}
          <details class="block">
            <summary>expects bake</summary>
            <pre class="code">{JSON.stringify(e.expects_bake, null, 2)}</pre>
          </details>
        {/if}
        {#if lock?.terms?.[selected]}
          <details class="block">
            <summary>lock entry · drift</summary>
            <pre class="code">{JSON.stringify(lock.terms[selected], null, 2)}</pre>
          </details>
        {/if}
        <details class="block">
          <summary>full rule JSON</summary>
          <pre class="code">{JSON.stringify(e.rule, null, 2)}</pre>
        </details>
        {/if}
      {/if}
    </aside>
  </main>
</div>

<style>
  .vocab-root { display: grid; grid-template-rows: auto 1fr; height: 100vh; }
  .vocab-bar {
    display: flex; align-items: center; gap: 12px;
    padding: 8px 16px; border-bottom: 1px solid #e5e7eb;
    background: #f8fafc;
  }
  .vocab-bar h1 { font: 600 16px Arial; margin: 0; color: #0c4a6e; }
  .bar-meta { font: 12px ui-monospace, monospace; color: #475569; }
  .bar-meta.error { color: #b91c1c; }
  .bar-chip { padding: 2px 8px; border-radius: 9999px; font: 600 11px Arial; }
  .bar-chip.prim { background: #e0f2fe; color: #0c4a6e; border: 1px solid #0369a1; }
  .bar-chip.asm { background: #dcfce7; color: #14532d; border: 1px solid #15803d; }
  .bar-chip.seed { background: #fef3c7; color: #78350f; border: 1px solid #d97706; }
  .bar-spacer { flex: 1; }
  .bar-link { font: 12px Arial; color: #2563eb; text-decoration: none; }
  .bar-link:hover { text-decoration: underline; }

  .vocab-grid { display: grid; overflow: hidden; }
  /* flexible divider between diagram | detail (default 50/50, drag to resize) */
  .vdivider { cursor: col-resize; background: #e5e7eb; transition: background 0.1s; touch-action: none; }
  .vdivider:hover, .vdivider.dragging { background: #cc2222; }

  .diagram-pane { display: grid; grid-template-rows: auto 1fr; overflow: hidden; min-height: 0; }
  .diagram-head { display: flex; align-items: baseline; gap: 12px; padding: 8px 16px; border-bottom: 1px solid #f1f5f9; }
  .diagram-head h2 { margin: 0; font: 600 13px Arial; color: #1f2937; }
  .diagram-head .hint { font: 11px Arial; color: #9ca3af; }
  .diagram { padding: 12px 16px; overflow: auto; background: #fff; }
  .diagram :global(svg) { max-width: 100%; height: auto; }
  .diagram :global(.node) { transition: filter 80ms; }
  .diagram :global(.node:hover) { filter: brightness(0.95); }
  .loading, .empty { color: #6b7280; font: 12px Arial; padding: 8px; }
  .error { color: #b91c1c; font: 11px ui-monospace, monospace; padding: 8px; }
  .raw { font: 11px ui-monospace, monospace; color: #475569; }

  .browser { border-top: 1px solid #e5e7eb; max-height: 280px; display: grid; grid-template-rows: auto 1fr; }
  .browser-search { padding: 6px 12px; border: 0; border-bottom: 1px solid #f1f5f9; font: 13px Arial; outline: none; }
  .browser-search:focus { background: #f9fafb; }
  .browser-list { overflow: auto; }
  .browser-row { display: grid; grid-template-columns: 36px 120px 1fr; align-items: center; gap: 8px; padding: 4px 12px; width: 100%; background: transparent; border: 0; text-align: left; cursor: pointer; font: 12px Arial; }
  .browser-row:hover { background: #f9fafb; }
  .browser-row.active { background: #e0f2fe; }
  .browser-row.asm .row-kind { background: #dcfce7; color: #14532d; }
  .browser-row.seed .row-kind { background: #fef3c7; color: #78350f; }
  .browser-row.seed.active { background: #fffbeb; }
  .row-kind { padding: 1px 6px; border-radius: 4px; background: #e0f2fe; color: #0c4a6e; font: 600 10px Arial; text-transform: uppercase; text-align: center; }
  .row-name { font: 600 12px ui-monospace, monospace; color: #1f2937; }
  .row-rule { color: #6b7280; font: 11px Arial; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .detail-pane { padding: 16px 20px; overflow: auto; background: #fafafa; }
  .detail-empty { color: #6b7280; font: 13px Arial; padding: 12px; }
  .detail-empty.error { color: #b91c1c; }
  .detail-head { display: flex; align-items: baseline; gap: 12px; margin-bottom: 8px; }
  .detail-head h2 { font: 700 18px ui-monospace, monospace; margin: 0; color: #1f2937; }
  .detail-kind { padding: 2px 8px; border-radius: 4px; font: 600 11px Arial; text-transform: uppercase; }
  .detail-kind { background: #e0f2fe; color: #0c4a6e; }
  .detail-kind.asm { background: #dcfce7; color: #14532d; }
  .detail-kind.seed { background: #fef3c7; color: #78350f; }
  .detail-def { color: #374151; font: 13px Arial; line-height: 1.45; margin: 4px 0 12px; }
  .syn-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 10px; }
  .syn-label { font: 11px Arial; color: #6b7280; }
  .syn-chip { padding: 1px 8px; border-radius: 9999px; background: #f3f4f6; color: #475569; font: 11px Arial; }
  .kv-row { display: grid; grid-template-columns: 100px 1fr; gap: 8px; padding: 4px 0; font: 12px Arial; }
  .kv-key { color: #6b7280; }
  .kv-val { color: #1f2937; font-family: ui-monospace, monospace; }
  .kv-val.link { color: #2563eb; text-decoration: underline; cursor: pointer; }

  /* Tab strip between detail-head and the tabbed body. */
  .tab-strip { display: flex; align-items: center; gap: 4px; border-bottom: 1px solid #e5e7eb; margin: 8px 0 12px; padding-bottom: 2px; }
  .tab-btn { background: transparent; border: 0; border-bottom: 2px solid transparent; padding: 6px 10px; font: 600 12px Arial; color: #6b7280; cursor: pointer; }
  .tab-btn:hover { color: #1f2937; }
  .tab-btn.active { color: #0c4a6e; border-bottom-color: #0369a1; }
  .tab-spacer { flex: 1; }
  .tab-exemplar { font: 11px Arial; color: #6b7280; margin-left: 8px; }
  .tab-exemplar code { font: 11px ui-monospace, monospace; color: #1f2937; }
  .tab-refresh, .bar-btn { font: 600 11px Arial; padding: 3px 10px; border: 1px solid #0369a1; background: #e0f2fe; color: #0c4a6e; border-radius: 4px; cursor: pointer; }
  .tab-refresh:hover:not(:disabled), .bar-btn:hover:not(:disabled) { background: #bae6fd; }
  .tab-refresh:disabled, .bar-btn:disabled { opacity: 0.5; cursor: default; }
  .bar-status { font: 11px ui-monospace, monospace; color: #475569; padding: 0 8px; }
  /* Scene pane — sized to the detail pane's remaining height so the WebGL canvas fills it.
     Curated terms with a compjson_ref show the 3D bake left + 2D silhouette right.
     Seed terms (no rule yet) show only silhouette + variants table. */
  .scene-pane { min-height: 420px; background: #fff; border: 1px solid #e5e7eb; border-radius: 4px; overflow: hidden; }
  .curated-scene { display: grid; grid-template-rows: 1fr; height: calc(100vh - 220px); }
  .curated-scene.with-ref { grid-template-columns: 1.4fr 1fr; }
  .bake-3d { overflow: hidden; min-width: 0; }
  /* Seed scene — 2D drawing + Inferred 3D side-by-side, polygon details
     below, metadata + variants table at the bottom. Scrolls vertically. */
  .seed-scene { display: grid; gap: 12px; padding: 12px; height: calc(100vh - 220px); overflow: auto; }
  .seed-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; align-items: stretch; }
  .seed-row > * { min-width: 0; }
  .seed-meta { display: grid; gap: 4px; align-content: start; }
  /* Inferred-3D card — mirrors CompJsonSilhouette card styling so the two
     panels read as a balanced pair. The PrimitiveDualCanvas takes the
     remaining vertical space. */
  .infer-card {
    display: grid; grid-template-rows: auto 1fr;
    gap: 4px;
    background: #fafaf9; border: 1px solid #e7e5e4; border-radius: 6px;
    padding: 8px;
    min-height: 320px;
    overflow: hidden;
  }
  .infer-card .cap-row { display: flex; align-items: center; gap: 8px; }
  .infer-card .caption {
    font: 600 11px Arial; color: #57534e;
    text-transform: uppercase; letter-spacing: 0.5px;
  }
  .infer-card .spacer { flex: 1; }
  .infer-card .bar-meta { font: 10px ui-monospace, monospace; color: #57534e; }
  .infer-cta { padding: 24px 16px; text-align: center; color: #57534e; font: 12px Arial; line-height: 1.6; }
  .infer-cta code { font: 11px ui-monospace, monospace; color: #1e40af; }
  .empty-card { display: flex; align-items: center; justify-content: center; color: #a8a29e; font: 11px Arial; min-height: 320px; background: #fafaf9; border: 1px dashed #e7e5e4; border-radius: 6px; }
  .infer-details { display: grid; gap: 6px; padding: 8px 12px; background: #fff; border: 1px solid #e7e5e4; border-radius: 6px; }
  .infer-details .cap-row { display: flex; align-items: center; gap: 8px; padding-bottom: 4px; border-bottom: 1px solid #f5f5f4; margin-bottom: 4px; }
  .infer-details .caption { font: 600 12px Arial; color: #1f2937; }
  .infer-details .spacer { flex: 1; }
  .warn-list { margin: 4px 0 0 16px; padding: 0; }
  .warn-list li { font: 11px Arial; color: #78350f; padding: 2px 0; }
  .promote-btn { background: #dcfce7; border-color: #15803d; color: #14532d; }
  .promote-btn:hover:not(:disabled) { background: #bbf7d0; }
  .promote-status {
    padding: 8px 12px; margin-top: 8px;
    background: #fffbeb; border: 1px solid #fbbf24; border-radius: 4px;
    font: 12px Arial; color: #78350f;
  }
  /* K.69 — proposed-vocab-entry preview card. Reads as a focused review
     surface: definition front-and-center, then chips for the structured
     retrieval fields (synonyms / function / form / variants / references),
     then the rule + params under collapsible details. Read-only. */
  .proposal-card {
    display: grid; grid-template-rows: auto 1fr auto;
    gap: 8px;
    padding: 12px 14px;
    background: #fef3c7; border: 1px solid #fbbf24; border-radius: 6px;
  }
  .proposal-card .cap-row { display: flex; align-items: center; gap: 8px; padding-bottom: 6px; border-bottom: 1px solid #fbbf24; }
  .proposal-card .caption { font: 600 12px Arial; color: #78350f; text-transform: uppercase; letter-spacing: 0.5px; }
  .proposal-card .spacer { flex: 1; }
  .prop-status { font: 11px Arial; color: #92400e; }
  .prop-grid { display: grid; gap: 10px; }
  .prop-field { display: grid; gap: 4px; }
  .prop-label { font: 600 10px Arial; color: #78350f; text-transform: uppercase; letter-spacing: 0.6px; }
  .prop-definition { font: 13px/1.55 Arial; color: #1f2937; margin: 0; background: #fff; padding: 8px 10px; border-radius: 4px; border: 1px solid #fde68a; }
  .prop-val { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .prop-chips { display: flex; flex-wrap: wrap; gap: 4px; }
  .prop-chip { padding: 2px 8px; border-radius: 9999px; font: 11px Arial; background: #fff; border: 1px solid #fde68a; color: #78350f; }
  .prop-chip.kind    { background: #dcfce7; color: #14532d; border-color: #15803d; font-weight: 600; }
  .prop-chip.ext     { background: #e0f2fe; color: #0c4a6e; border-color: #0369a1; font-weight: 600; }
  .prop-chip.syn     { background: #f3f4f6; color: #475569; border-color: #e5e7eb; }
  .prop-chip.fn      { background: #ede9fe; color: #5b21b6; border-color: #c4b5fd; }
  .prop-chip.form    { background: #fef3c7; color: #78350f; border-color: #fbbf24; }
  .prop-chip.variant { background: #fce7f3; color: #831843; border-color: #f9a8d4; }
  .prop-cat { font: 11px Arial; color: #92400e; margin-left: 4px; }
  .prop-arrow { font: 11px Arial; color: #92400e; }
  .prop-ref { font: 11px Arial; color: #1d4ed8; text-decoration: none; padding: 2px 8px; background: #fff; border: 1px solid #93c5fd; border-radius: 4px; }
  .prop-ref:hover { background: #dbeafe; }
  .rule-section { margin: 8px 12px 4px; }
  .prop-footer {
    font: 12px Arial; color: #78350f; line-height: 1.55;
    padding: 10px 12px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 4px;
  }
  .prop-footer code { font: 11px ui-monospace, monospace; background: #fef3c7; padding: 1px 4px; border-radius: 2px; }
  .proposed-3d { display: grid; gap: 4px; background: #fff; padding: 8px; border: 1px solid #fde68a; border-radius: 4px; margin: 4px 0; }
  .proposed-3d-canvas { height: 380px; overflow: hidden; }
  /* Vertical-tabs container for Inferred|Proposed bakes in the seed scene. */
  .bake-vtabs { display: grid; grid-template-columns: 88px 1fr; gap: 0; background: #fafaf9; border: 1px solid #e7e5e4; border-radius: 6px; overflow: hidden; min-height: 360px; }
  .vtab-strip { display: flex; flex-direction: column; background: #f5f5f4; border-right: 1px solid #e7e5e4; padding: 6px 0; gap: 4px; }
  .vtab {
    background: transparent; border: 0; border-left: 3px solid transparent;
    padding: 10px 12px; font: 600 12px Arial; color: #57534e;
    cursor: pointer; text-align: left;
    transition: background 0.1s;
  }
  .vtab:hover:not(:disabled) { background: #e7e5e4; }
  .vtab.active { background: #fff; color: #0c4a6e; border-left-color: #0369a1; }
  .vtab:disabled { color: #d6d3d1; cursor: not-allowed; }
  .vtab-content { padding: 8px 10px; overflow: auto; display: grid; gap: 6px; align-content: start; }
  .bake-head { display: flex; align-items: center; gap: 8px; padding-bottom: 4px; border-bottom: 1px solid #f5f5f4; }
  .bake-head .spacer { flex: 1; }
  .bake-title { font: 600 11px Arial; color: #57534e; text-transform: uppercase; letter-spacing: 0.5px; }
  .bake-head .bar-meta { font: 10px ui-monospace, monospace; color: #57534e; }
  .bake-head .bar-status { font: 11px Arial; color: #6b7280; }
  .bake-head .bar-status.err { color: #b91c1c; }
  /* Param sliders driving the proposed bake live. */
  .param-sliders { display: grid; gap: 4px; padding: 8px; background: #fff; border: 1px solid #e7e5e4; border-radius: 4px; }
  .ps-cap { font: 600 10px Arial; color: #57534e; text-transform: uppercase; letter-spacing: 0.6px; padding-bottom: 4px; border-bottom: 1px solid #f5f5f4; }
  .ps-row { display: grid; grid-template-columns: 90px 1fr 70px 30px; gap: 6px; align-items: center; }
  .ps-key { font: 600 11px ui-monospace, monospace; color: #1f2937; }
  .ps-slider { width: 100%; }
  .ps-num { width: 100%; padding: 2px 4px; font: 11px ui-monospace, monospace; border: 1px solid #d6d3d1; border-radius: 3px; }
  .ps-unit { font: 10px Arial; color: #6b7280; }
  /* Left-pane tab strip — Topology | Browse. */
  .left-tabs { display: flex; align-items: center; gap: 4px; padding: 6px 12px 0; border-bottom: 1px solid #f1f5f9; }
  .left-tab { background: transparent; border: 0; border-bottom: 2px solid transparent; padding: 6px 12px; font: 600 12px Arial; color: #6b7280; cursor: pointer; }
  .left-tab:hover { color: #1f2937; }
  .left-tab.active { color: #0c4a6e; border-bottom-color: #0369a1; }
  .left-tab .tab-count { font: 10px ui-monospace, monospace; color: #6b7280; margin-left: 4px; }
  /* Browse tab — fills the diagram-pane's 1fr row. min-height: 0 lets the
     inner list overflow properly inside the grid track. */
  .browser-full { max-height: none !important; border-top: 0 !important; height: 100%; min-height: 0; }
  .browser-full .browser-list { min-height: 0; overflow-y: auto; }
  .prop-actions { display: flex; align-items: center; gap: 12px; padding: 8px 12px; background: #fffbeb; border: 1px solid #fbbf24; border-radius: 4px; margin-top: 8px; }
  .prop-actions-hint { font: 11px Arial; color: #78350f; flex: 1; }
  .prop-actions-hint code { font: 11px ui-monospace, monospace; background: #fef3c7; padding: 1px 4px; border-radius: 2px; }

  .block { margin-top: 12px; border: 1px solid #e5e7eb; border-radius: 4px; background: #fff; }
  .block summary { padding: 8px 12px; font: 600 12px Arial; color: #1f2937; cursor: pointer; user-select: none; }
  .block summary:hover { background: #f9fafb; }
  .block[open] summary { border-bottom: 1px solid #f1f5f9; }
  .code { padding: 10px 12px; margin: 0; font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; color: #1f2937; overflow: auto; max-height: 320px; }
  .params-table { width: 100%; border-collapse: collapse; font: 11px Arial; }
  .params-table th, .params-table td { padding: 4px 8px; border-bottom: 1px solid #f1f5f9; text-align: left; }
  .params-table th { background: #f9fafb; font-weight: 600; color: #475569; }
  .params-table td code { font: 600 11px ui-monospace, monospace; color: #0c4a6e; }
</style>
