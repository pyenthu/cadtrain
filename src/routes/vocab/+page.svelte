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

  import ParamGrid from '$lib/shared/ParamGrid.svelte';

  let { data } = $props();
  type Term = string;
  type VocabEntry = any;
  type SeedEntry  = any;
  // Lazy reference-silhouette renderer — used when an entry has compjson_ref.
  let CompJsonSilhouette = $state<any>(null);
  // Per-term open/closed state for the Parameters accordion in the Proposed tab.
  let paramsOpen = $state<Record<string, boolean>>({});
  // K.63 graph editor inline-iframe panel toggle (Phase 8). One panel max,
  // global state — when the user picks a different term we keep the panel
  // open but the iframe's src changes to the new exemplar (reactive).
  let editorOpen = $state(false);
  function isParamsOpen(term: Term): boolean { return paramsOpen[term] !== false; }
  function toggleParamsOpen(term: Term) { paramsOpen = { ...paramsOpen, [term]: !isParamsOpen(term) }; }

  // Top-level state
  let mermaid: any = null;
  let renderedSvg = $state<string>('');
  let renderError = $state<string | null>(null);
  let selected = $state<Term | null>(null);
  let search = $state('');

  // Resizable diagram|detail split — defaults 30/70 (left rail thin, right
  // pane gets most of the floor for params + canvas + rule details).
  let splitPct = $state(30);
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
  // Right-pane top-tab (seed-only) — Inferred (auto-derived 2D→r_revolve)
  // vs Proposed (rich hand-drafted entry). Default to Proposed since it's
  // the primary workflow (rich rule + sliders); $effect below flips to
  // Inferred when the selection has no proposed entry.
  let detailTab = $state<'inferred' | 'proposed'>('proposed');
  $effect(() => {
    // When the selected term changes, prefer Proposed if it has an entry,
    // else Inferred. Runs reactively on `selected` change.
    if (!selected) return;
    if (!selectedIsSeed) return;
    detailTab = getProposed(selected) ? 'proposed' : 'inferred';
  });
  // Definition / tags popover state — encapsulates the rich verbiage
  // (definition + synonyms / function / form / variants / references) into a
  // single ⓘ button so the tab body focuses on params + 3D bake (matching
  // /primitives' layout).
  let infoPopoverOpen = $state(false);
  function infoPopoverOutside(e: MouseEvent) {
    if (!infoPopoverOpen) return;
    const t = e.target as HTMLElement | null;
    if (!t?.closest('.info-popover-wrap')) infoPopoverOpen = false;
  }
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
  // Build a {paramKey: value} map for ParamGrid (it expects keyed records, not arrays).
  function paramMap(term: Term): Record<string, number> {
    const entry = getProposed(term);
    if (!entry?.params) return {};
    const arr = paramOverrides[term] ?? defaultParams(term);
    const out: Record<string, number> = {};
    Object.keys(entry.params).forEach((k, i) => { out[k] = arr[i] ?? (entry.params[k].default as number); });
    return out;
  }
  // ParamGrid onPending / onCommit handlers — convert (key, value) back to the
  // positional override array used by /api/vocab/bake-proposed.
  function paramUpdateByKey(term: Term, key: string, value: number) {
    const entry = getProposed(term);
    if (!entry?.params) return;
    const idx = Object.keys(entry.params).indexOf(key);
    if (idx < 0) return;
    updateParam(term, idx, value);
  }
  // Derived view-models referenced from the markup — Svelte5 strict about
  // {@const} placement, so the inline derivations live up here.
  let activeBakeTab = $derived<'inferred' | 'proposed'>(selected ? (bakeTab[selected] ?? 'inferred') : 'inferred');
  let proposedEntry = $derived(selected ? getProposed(selected) : null);
  let currentParams = $derived(selected ? (paramOverrides[selected] ?? defaultParams(selected)) : []);
  // STABLE args reference for PrimitiveDualCanvas. Without this, the inline
  // `paramOverrides[selected] ?? defaultParams(selected)` returns a fresh
  // array each render → canvas re-mounts → auto-fit loops indefinitely.
  // $derived memoises by computed value identity, so consumers get the
  // same array reference until paramOverrides[selected] actually changes.
  let stableProposedArgs = $derived.by((): number[] => {
    if (!selected) return [];
    const override = paramOverrides[selected];
    if (override) return override;          // user-edited array kept as-is
    return defaultParams(selected);          // fresh defaults only on (re-)select
  });
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

  // When a curated term is selected, fetch its source + default params
  // once. Triggers regardless of tab (curated has no top-tabs). Seeds
  // ignore this — they use inferCache / proposedBakeCache for their
  // own per-tab canvas mounts.
  $effect(() => {
    if (!selectedEntry) return;
    if (selectedIsSeed) return;
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

<svelte:window onclick={infoPopoverOutside} />

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
          <!-- Bake-info + Bake/Promote inlined into the title row (Proposed tab only). -->
          {#if selectedIsSeed && detailTab === 'proposed' && proposedEntry}
            {@const _pb = proposedBakeCache[selected!]}
            <span class="head-bake-info">· Proposed 3D · <code>{proposedEntry.rule?.kind ?? '?'}</code></span>
            {#if !_pb}
              <button class="bar-btn" type="button" onclick={() => runProposedBake(selected!)}>Bake</button>
            {:else if _pb === 'loading'}
              <span class="head-bake-stat">baking…</span>
            {:else if 'error' in (_pb as any)}
              <button class="bar-btn" type="button" onclick={() => runProposedBake(selected!)}>retry</button>
              <span class="head-bake-stat err">err: {(_pb as any).error}</span>
            {:else}
              <span class="head-bake-stat">· {(_pb as ProposedBake).bake?.verts ?? '?'} verts · z={(_pb as ProposedBake).bake?.z_extent ?? '?'} · r={(_pb as ProposedBake).bake?.outer_r ?? '?'}</span>
            {/if}
            <!-- Promote button — disabled until a successful bake is in cache. -->
            <button class="promote-btn primary head-promote" type="button"
              disabled={promoteProposedBusy[selected!] || !_pb || _pb === 'loading' || (typeof _pb === 'object' && 'error' in (_pb as any)) || !((_pb as ProposedBake)?.bake?.ok)}
              title="Lift this proposed entry into vocabulary.json AND save dt_<term>.prim.ts to the volume."
              onclick={() => promoteProposed(selected!)}
            >{promoteProposedBusy[selected!] ? 'promoting…' : '✓ Promote'}</button>
          {/if}
          <span class="head-spacer"></span>
          <!-- Definition & tags popover — opens a wide panel with the rich
               definition, synonyms / function / form / variants / references.
               Encapsulates the verbiage out of the tab body so the body
               focuses on params + 3D bake (/primitives-style). -->
          <div class="info-popover-wrap">
            <button class="info-pop-btn" type="button" aria-haspopup="dialog" aria-expanded={infoPopoverOpen}
              title="Definition · synonyms · function · form · references"
              onclick={(ev) => { ev.stopPropagation(); infoPopoverOpen = !infoPopoverOpen; }}
            >ⓘ Definition & tags</button>
            {#if infoPopoverOpen}
              <div class="info-pop-panel" role="dialog" aria-label="Definition and tags">
                {#if selectedIsSeed && proposedEntry}
                  <p class="def-line rich">{proposedEntry.definition}</p>
                  <div class="info-row">
                    <span class="prop-chip kind">{proposedEntry.kind}</span>
                    {#if proposedEntry.extends}
                      <span class="prop-arrow">extends</span>
                      <span class="prop-chip ext">{proposedEntry.extends}</span>
                    {/if}
                    <span class="prop-cat">{proposedEntry.category} · {proposedEntry.sub_category}</span>
                  </div>
                  {#if proposedEntry.synonyms?.length}
                    <div class="chips-row"><span class="chips-label">synonyms</span>
                      {#each proposedEntry.synonyms as s (s)}<span class="prop-chip syn">{s}</span>{/each}
                    </div>
                  {/if}
                  {#if proposedEntry.function?.length}
                    <div class="chips-row"><span class="chips-label">function</span>
                      {#each proposedEntry.function as f (f)}<span class="prop-chip fn">{f}</span>{/each}
                    </div>
                  {/if}
                  {#if proposedEntry.form?.length}
                    <div class="chips-row"><span class="chips-label">form</span>
                      {#each proposedEntry.form as f (f)}<span class="prop-chip form">{f}</span>{/each}
                    </div>
                  {/if}
                  {#if proposedEntry.variants?.length}
                    <div class="chips-row"><span class="chips-label">variants</span>
                      {#each proposedEntry.variants as v (v)}<span class="prop-chip variant">{v}</span>{/each}
                    </div>
                  {/if}
                  {#if proposedEntry.references?.length}
                    <div class="chips-row"><span class="chips-label">references</span>
                      {#each proposedEntry.references as r (r)}<a class="prop-ref" href={r} target="_blank" rel="noopener">{r.replace(/^https?:\/\//, '')}</a>{/each}
                    </div>
                  {/if}
                {:else if selectedIsSeed}
                  <p class="def-line">{e.description ?? '(no description)'}</p>
                  <div class="info-row">
                    <span class="info-chip cat">{e.category} · {e.sub_category}</span>
                    {#if e.metadata?.tool_comp}<code class="info-code">{e.metadata.tool_comp}</code>{/if}
                  </div>
                {:else}
                  <p class="def-line rich">{e.definition ?? '(no definition)'}</p>
                  {#if e.synonyms?.length}
                    <div class="chips-row"><span class="chips-label">synonyms</span>
                      {#each e.synonyms as s (s)}<span class="prop-chip syn">{s}</span>{/each}
                    </div>
                  {/if}
                  {#if e.extends}
                    <div class="chips-row"><span class="chips-label">extends</span><span class="prop-chip ext">{e.extends}</span></div>
                  {/if}
                {/if}
              </div>
            {/if}
          </div>
          {#if !selectedIsSeed}
            <button class="tab-refresh" type="button"
              disabled={regenBusy[selected!]}
              title={`Regenerate ${selected} from vocab + re-bake.`}
              onclick={() => refreshTerm(selected!)}
            >{regenBusy[selected!] ? '↻ …' : '↻ Refresh'}</button>
            <code class="head-exemplar">{e.exemplar}</code>
            <!-- K.63 graph editor — toggles an inline iframe panel that mounts
                 /graph-editor?id=<exemplar>&embed=1 below the rest of the
                 term detail. embed=1 hides the SvelteKit nav so the iframe
                 is just the editor chrome. Click again (or the ✕ on the
                 panel) to close. -->
            <button class="head-graph-link" type="button"
              class:on={editorOpen}
              onclick={() => (editorOpen = !editorOpen)}
              title="Open this exemplar in the graph editor (K.63 composition model)">
              🧬 Graph editor {editorOpen ? '▾' : ''}
            </button>
          {/if}
        </div>

        {#if editorOpen && selected && e.exemplar}
          <section class="vocab-graph-embed">
            <header class="vge-bar">
              <strong>🧬 Graph editor</strong>
              <code>{e.exemplar}</code>
              <span class="vge-sp"></span>
              <a class="vge-link" href={`/graph-editor?id=${e.exemplar}`} target="_blank"
                title="Open in a full /graph-editor tab">↗ open full</a>
              <button class="vge-close" type="button"
                onclick={() => (editorOpen = false)} title="Close editor panel">✕</button>
            </header>
            <iframe
              class="vge-iframe"
              src={`/graph-editor?id=${e.exemplar}&embed=1`}
              title={`Graph editor — ${e.exemplar}`}>
            </iframe>
          </section>
        {/if}
        {#if selectedIsSeed}
          {@const prop = proposedEntry}
          {#if detailTab === 'inferred' && promoteStatus}<div class="vocab-tab-status">{promoteStatus}</div>{/if}
          {#if detailTab === 'proposed' && promoteProposedStatus}<div class="vocab-tab-status">{promoteProposedStatus}</div>{/if}
          <!-- Vertical trapezoidal rail (left, /primitives pattern) + tab body
               that hosts a PrimitiveView for /primitives-style chrome. -->
          <div class="vocab-tabs">
            <div class="vocab-vrail" role="tablist" aria-label="Bake interpretation">
              <button class="vocab-vtab" class:active={detailTab === 'inferred'}
                type="button" role="tab" aria-selected={detailTab === 'inferred'}
                title="Inferred — auto-derived from the 2D drawing"
                onclick={() => (detailTab = 'inferred')}>
                <span class="vocab-vtab-ic">∿</span>
                <span class="vocab-vtab-lbl">Inferred</span>
              </button>
              <button class="vocab-vtab" class:active={detailTab === 'proposed'}
                type="button" role="tab" aria-selected={detailTab === 'proposed'}
                disabled={!prop}
                title={prop ? 'Proposed — rich hand-drafted rule' : 'no proposed entry yet'}
                onclick={() => (detailTab = 'proposed')}>
                <span class="vocab-vtab-ic">◆</span>
                <span class="vocab-vtab-lbl">Proposed</span>
              </button>
            </div>

          {#if detailTab === 'inferred'}
            {@const inf = inferCache[selected!]}
            <div class="tab-body">
              <!-- Terse seed description + catalogue chips -->
              <p class="def-line">{e.description ?? '(no description)'}</p>
              <div class="info-row">
                <span class="info-chip cat">{e.category} · {e.sub_category}</span>
                {#if e.metadata?.tool_comp}
                  <code class="info-code">{e.metadata.tool_comp}</code>
                {/if}
                <span class="info-chip dim">OD {e.dims_from_catalogue?.od_in ?? '—'}" · ID {e.dims_from_catalogue?.id_in ?? '—'}" · L {e.dims_from_catalogue?.length_ft ?? '—'} ft</span>
                {#if (e.variants?.length ?? 0) > 1}<span class="info-chip variant">{e.variants.length} variants</span>{/if}
              </div>

              <!-- 2D drawing + Inferred 3D side-by-side -->
              <div class="view-row">
                {#if e.compjson_ref && CompJsonSilhouette}
                  <CompJsonSilhouette ref={e.compjson_ref} title="2D vendor reference" height={300} />
                {:else}
                  <div class="empty-card">no compjson_ref on file</div>
                {/if}
                <div class="bake-card">
                  <header class="bake-head">
                    <div class="bake-title">Inferred 3D · r_revolve</div>
                    <span class="spacer"></span>
                    {#if !inf}
                      <button class="bar-btn" type="button" onclick={() => runInfer(selected!)}>Infer</button>
                    {:else if inf === 'loading'}
                      <span class="bar-status">inferring…</span>
                    {:else if 'error' in (inf as any)}
                      <button class="bar-btn" type="button" onclick={() => runInfer(selected!)}>retry</button>
                      <span class="bar-status err">err: {(inf as any).error}</span>
                    {:else}
                      <span class="bar-meta">{(inf as InferResult).bake?.verts ?? '?'} verts · z={(inf as InferResult).bake?.z_extent ?? '?'} · r={(inf as InferResult).bake?.outer_r ?? '?'}</span>
                    {/if}
                  </header>
                  <div class="bake-body">
                    {#if !inf}
                      <div class="bake-cta">
                        Click <strong>Infer</strong> to derive an axisymmetric profile from the 2D drawing.
                        <br>Deterministic — half-section + OD-calibration → <code>r_revolve</code> polygon.
                      </div>
                    {:else if inf === 'loading'}
                      <div class="empty">inferring polygon + bake…</div>
                    {:else if 'error' in (inf as any)}
                      <div class="error">inference failed: {(inf as any).error}</div>
                    {:else if !(inf as InferResult).bake?.ok}
                      <div class="error">bake failed: {(inf as InferResult).bake?.message ?? 'no bake result'}</div>
                    {:else if PrimitiveDualCanvas}
                      {@const inferredI = inf as InferResult}
                      <PrimitiveDualCanvas
                        id={inferredI.exemplar}
                        name={inferredI.exemplar}
                        description=""
                        args={[]}
                        source={inferredI.source}
                        showControls={true}
                        showLabels={false}
                      />
                    {:else}
                      <div class="empty">3D canvas loading…</div>
                    {/if}
                  </div>
                </div>
              </div>

              <!-- Inferred details: polygon vertices · warnings · source -->
              {#if inf && typeof inf === 'object' && !('error' in (inf as any)) && (inf as InferResult).polygon?.length}
                {@const inf2 = inf as InferResult}
                <details class="block">
                  <summary>polygon vertices ({inf2.polygon.length}) · axisymmetric: {inf2.axisymmetric ? 'yes' : 'no'}</summary>
                  <pre class="code">{inf2.polygon.map(([r, z]: [number, number], i: number) => `  [${i.toString().padStart(2)}]  r=${r.toFixed(4).padStart(8)}  z=${z.toFixed(4).padStart(8)}`).join('\n')}</pre>
                </details>
                {#if inf2.internal_features?.length}
                  <details class="block">
                    <summary>{inf2.internal_features.length} internal feature{inf2.internal_features.length === 1 ? '' : 's'} (seats / elastomer / marks)</summary>
                    <pre class="code">{inf2.internal_features.map((f: any, i: number) => `[${i}] ${f.kind} (fill ${f.fill_color}) — ${f.polygon.length} verts`).join('\n')}</pre>
                  </details>
                {/if}
                {#if inf2.warnings?.length}
                  <details class="block" open>
                    <summary>{inf2.warnings.length} warning{inf2.warnings.length === 1 ? '' : 's'}</summary>
                    <ul class="warn-list">
                      {#each inf2.warnings as w (w)}<li>⚠ {w}</li>{/each}
                    </ul>
                  </details>
                {/if}
                <details class="block">
                  <summary>generated source (.rev.ts)</summary>
                  <pre class="code">{inf2.source}</pre>
                </details>
                <div class="promote-footer">
                  <button class="promote-btn" type="button" disabled={promoteBusy[selected!]}
                    title="Write the inferred polygon back into vocabulary.seeds.json as the seed's rule and flip status to promoted."
                    onclick={() => promote(selected!)}
                  >{promoteBusy[selected!] ? 'promoting…' : '✓ Promote inferred polygon → seeds.json'}</button>
                  <span class="promote-hint">cheap promotion: stores the auto-polygon (no rich definition)</span>
                </div>
              {/if}

              <!-- Catalogue variants table -->
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
              <details class="block">
                <summary>raw seed JSON</summary>
                <pre class="code">{JSON.stringify(e, null, 2)}</pre>
              </details>
            </div>
          {:else if prop}
            <!-- PROPOSED tab body -->
            {@const pb = proposedBakeCache[selected!]}
            <div class="tab-body">
              <!-- Definition + chips encapsulated in the ⓘ Definition & tags
                   popover (top-right of detail-head). Tab body focuses on
                   params + 3D bake — /primitives format. -->

              <!-- 2-col layout: LEFT = canvas (full height of column);
                   RIGHT = parameters on top, rule + details below. -->
              <div class="proposed-grid">
                <div class="proposed-canvas-col">
                  <div class="bake-card no-head">
                    <div class="bake-body">
                      {#if !pb}
                        <div class="bake-cta">
                          Click <strong>Bake</strong> to render the hand-drafted <code>{prop.rule?.kind}</code> rule.
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
                          description=""
                          args={stableProposedArgs}
                          source={proposedPb.source}
                          showControls={true}
                          showLabels={false}
                        />
                      {:else}
                        <div class="empty">3D canvas loading…</div>
                      {/if}
                    </div>
                  </div>
                </div>

                <div class="proposed-right-col">
                  <!-- Parameters at top of the right column -->
                  {#if prop.params}
                    {@const pmap = paramMap(selected!)}
                    <div class="pg-acc-wrap">
                      <div class="pg-acc-head" class:collapsed={!isParamsOpen(selected!)}
                        role="button" tabindex="0"
                        aria-expanded={isParamsOpen(selected!)}
                        onclick={() => toggleParamsOpen(selected!)}
                        onkeydown={(ek) => { if (ek.key === 'Enter' || ek.key === ' ') { ek.preventDefault(); toggleParamsOpen(selected!); } }}>
                        <span class="pg-acc-title">Parameters</span>
                        <span class="pg-acc-count">({Object.keys(prop.params).length})</span>
                        <div class="pv-spacer"></div>
                        <span class="pg-acc-hint">drag to re-bake</span>
                      </div>
                      {#if isParamsOpen(selected!)}
                        <div class="pg-acc-body">
                          <ParamGrid
                            schema={prop.params as any}
                            pending={pmap}
                            applied={pmap}
                            onPending={(k, v) => paramUpdateByKey(selected!, k, v)}
                            onCommit={(k, v) => paramUpdateByKey(selected!, k, v)}
                            variant="fn"
                          />
                        </div>
                      {/if}
                    </div>
                  {/if}

                  <!-- Rule + details below parameters -->
                  <div class="rule-details-col">
                    {#if prop.rule}
                      <!-- Composition tree (visual) — mirrors CompositionEditor's
                           folder+file row style. boolean_modify renders as a
                           Subtract/Add/Intersect folder containing the body
                           call + each modifier shape as a child file. -->
                      <details class="block" open>
                        <summary>composition · {prop.rule.kind}{prop.rule.engine ? ` · engine: ${(prop.rule.engine as string[]).join(', ')}` : ''}</summary>
                        {#if prop.rule.kind === 'boolean_modify' && prop.rule.modifiers?.length}
                          {@const firstOp = prop.rule.modifiers[0].op}
                          {@const opGlyph = firstOp === 'subtract' ? '⊖' : firstOp === 'add' ? '⊕' : '⊗'}
                          {@const bodyVerts = prop.rule.body?.polygon?.length ?? 0}
                          {@const bodyEngine = (prop.rule.engine as string[])[0] ?? 'r_revolve'}
                          <div class="ce-tree" role="tree" aria-label="Composition tree">
                            <div class="ce-row ce-folder" style="--depth: 0">
                              <span class="ce-icon">📁</span>
                              <span class="ce-op-chip" data-op={firstOp}>{opGlyph} {firstOp}</span>
                              <span class="ce-folder-meta">{1 + prop.rule.modifiers.length} operands</span>
                            </div>
                            <div class="ce-folder-children">
                              <details class="ce-row-wrap" open>
                                <summary class="ce-row ce-file" style="--depth: 1">
                                  <span class="ce-icon">📄</span>
                                  <span class="ce-call-name">ƒ {bodyEngine}</span>
                                  <span class="ce-call-args">(profile, segments)</span>
                                  <span class="ce-spacer"></span>
                                  <span class="ce-call-meta">{bodyVerts} verts</span>
                                </summary>
                                <div class="ce-detail" style="--depth: 1">
                                  {#if prop.rule.body?.preamble?.length}
                                    <div class="ce-detail-label">preamble</div>
                                    <pre class="ce-detail-code">{prop.rule.body.preamble.join('\n')}</pre>
                                  {/if}
                                  {#if prop.rule.body?.polygon?.length}
                                    <div class="ce-detail-label">polygon · {bodyVerts} verts</div>
                                    <pre class="ce-detail-code">{prop.rule.body.polygon.map((p: string, i: number) => `  [${i}] ${p}`).join('\n')}</pre>
                                  {/if}
                                </div>
                              </details>

                              <!-- Modifier calls — one row per shape. -->
                              {#each prop.rule.modifiers as mod, i (i)}
                                {@const mGlyph = mod.op === 'subtract' ? '⊖' : mod.op === 'add' ? '⊕' : '⊗'}
                                <details class="ce-row-wrap" open>
                                  <summary class="ce-row ce-file" style="--depth: 1" data-op={mod.op}>
                                    <span class="ce-icon">📄</span>
                                    <span class="ce-mod-op">{mGlyph}</span>
                                    <span class="ce-call-name">{mod.shape.kind}</span>
                                    <span class="ce-call-args">({(Object.entries(mod.shape).filter(([k]) => k !== 'kind').map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join(', '))})</span>
                                  </summary>
                                  <div class="ce-detail" style="--depth: 1">
                                    {#each Object.entries(mod.shape).filter(([k]) => k !== 'kind') as [k, v] (k)}
                                      <div class="ce-detail-row">
                                        <span class="ce-detail-key">{k}</span>
                                        <span class="ce-detail-val">{typeof v === 'string' ? v : JSON.stringify(v)}</span>
                                      </div>
                                    {/each}
                                  </div>
                                </details>
                              {/each}
                            </div>
                            <div class="ce-result">= Result</div>
                          </div>
                        {:else}
                          <!-- Fallback for non-boolean_modify rules: show the JSON. -->
                          <pre class="code">{JSON.stringify(prop.rule, null, 2)}</pre>
                        {/if}
                      </details>
                    {/if}
                    <details class="block">
                      <summary>definition</summary>
                      <p class="def-line rich">{prop.definition}</p>
                    </details>
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
                </div>
              </div>

              <!-- Promote button now lives inline in the title row alongside
                   Bake — see the detail-head block above. -->
              {#if promoteProposedStatus}<div class="promote-status">{promoteProposedStatus}</div>{/if}
            </div>
          {:else}
            <!-- Proposed tab but no entry on file -->
            <div class="tab-body">
              <div class="empty cta-empty">
                No proposed entry for <code>{selected}</code> yet.<br>
                Switch to <strong>Inferred</strong> for the auto-derived polygon, or hand-write an entry in <code>docs/parts/proposed-vocab-entries.json</code>.
              </div>
            </div>
          {/if}
          </div>
        {:else}
          <!-- CURATED term — no top tabs, single stacked body. -->
          {@const sc = sceneCache[e.exemplar]}
          <div class="tab-body">
            <p class="def-line rich">{e.definition ?? '(no definition)'}</p>
            {#if e.synonyms?.length}
              <div class="chips-row">
                <span class="chips-label">synonyms</span>
                {#each e.synonyms as s (s)}<span class="prop-chip syn">{s}</span>{/each}
              </div>
            {/if}
            <div class="info-row">
              {#if e.extends}
                <span class="info-chip ext-info">extends {e.extends}</span>
              {/if}
              <a class="info-chip link" href="/primitives" onclick={(ev) => { ev.preventDefault(); if (typeof window !== 'undefined') window.open(`/primitives?open=${e.exemplar}`, '_blank'); }}>open <code>{e.exemplar}</code> in /primitives ↗</a>
              <span class="info-chip rule">{ruleSummary(e)}</span>
            </div>

            <!-- 2D (when ref) + 3D side-by-side -->
            <div class="view-row">
              {#if e.compjson_ref && CompJsonSilhouette}
                <CompJsonSilhouette ref={e.compjson_ref} title="2D reference" height={300} />
              {:else}
                <div class="empty-card faded">no 2D reference</div>
              {/if}
              <div class="bake-card">
                <header class="bake-head">
                  <div class="bake-title">3D · {e.kind}</div>
                  <span class="spacer"></span>
                </header>
                <div class="bake-body">
                  {#if !PrimitiveDualCanvas}
                    <div class="empty">scene component loading…</div>
                  {:else if !sc || sc === 'loading'}
                    <div class="empty">fetching {e.exemplar}…</div>
                  {:else if sc === 'error'}
                    <div class="error">couldn't load {e.exemplar} — does it exist on the volume?</div>
                  {:else}
                    {@const params = sc as { source: string; args: (number | string)[] }}
                    <PrimitiveDualCanvas
                      id={e.exemplar}
                      name={e.exemplar}
                      description=""
                      args={params.args}
                      source={params.source}
                      showControls={true}
                      showLabels={false}
                    />
                  {/if}
                </div>
              </div>
            </div>

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
              <details class="block">
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
          </div>
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
  /* Composition-tree visual — mirrors CompositionEditor's folder/file row look. */
  .ce-tree { padding: 4px 0; font: 12px Arial; color: #1f2937; }
  .ce-row { display: flex; align-items: center; gap: 6px; padding: 2px 6px 2px calc(6px + var(--depth, 0) * 16px); border-radius: 3px; }
  .ce-row.ce-folder { background: #fff8e6; border: 1px solid #fbbf24; font-weight: 600; }
  .ce-row.ce-file { background: #f8fafc; border: 1px solid #e2e8f0; cursor: pointer; }
  .ce-row.ce-file:hover { background: #e0f2fe; }
  .ce-folder-children { display: flex; flex-direction: column; gap: 2px; margin-left: 12px; padding-left: 6px; border-left: 2px solid #fbbf24; margin-top: 2px; }
  .ce-row-wrap { display: flex; flex-direction: column; }
  .ce-row-wrap summary { list-style: none; }
  .ce-row-wrap summary::-webkit-details-marker { display: none; }
  .ce-icon { font-size: 12px; opacity: 0.8; }
  .ce-op-chip { padding: 1px 8px; border-radius: 9999px; background: #fef3c7; color: #78350f; border: 1px solid #fbbf24; font: 600 11px Arial; text-transform: uppercase; letter-spacing: 0.5px; }
  .ce-folder-meta { font: 10px Arial; color: #92400e; margin-left: auto; }
  .ce-call-name { font: 600 12px ui-monospace, SFMono-Regular, Menlo, monospace; color: #cc2222; }
  .ce-call-args { font: 11px ui-monospace, monospace; color: #6b7280; }
  .ce-call-meta { font: 10px Arial; color: #9ca3af; }
  .ce-spacer { flex: 1; }
  .ce-mod-op { display: inline-block; min-width: 16px; text-align: center; font: 600 13px Arial; color: #b91c1c; }
  .ce-row.ce-file[data-op="add"] .ce-mod-op { color: #15803d; }
  .ce-row.ce-file[data-op="intersect"] .ce-mod-op { color: #6d28d9; }
  .ce-detail { padding: 6px 8px 8px calc(8px + (var(--depth, 0) + 1) * 16px); background: #fff; border-left: 2px dashed #e2e8f0; margin: 2px 0 2px 14px; display: grid; gap: 3px; }
  .ce-detail-label { font: 600 10px Arial; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; }
  .ce-detail-code { margin: 0; padding: 6px 8px; font: 11px ui-monospace, monospace; color: #1f2937; background: #fafaf9; border: 1px solid #e5e7eb; border-radius: 3px; overflow: auto; max-height: 220px; }
  .ce-detail-row { display: grid; grid-template-columns: 130px 1fr; gap: 6px; font: 11px Arial; }
  .ce-detail-key { font: 11px ui-monospace, monospace; color: #6b7280; }
  .ce-detail-val { font: 11px ui-monospace, monospace; color: #0c4a6e; }
  .ce-result { margin: 4px 0 0 16px; padding: 3px 10px; font: 600 11px Arial; color: #14532d; background: #dcfce7; border: 1px solid #86efac; border-radius: 9999px; display: inline-block; }
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

  .block { margin-top: 2px; border: 1px solid #e5e7eb; border-radius: 4px; background: #fff; }
  .block summary { padding: 3px 10px; font: 600 12px Arial; color: #1f2937; cursor: pointer; user-select: none; }
  .block summary:hover { background: #f9fafb; }
  .block[open] summary { border-bottom: 1px solid #f1f5f9; }
  .code { padding: 10px 12px; margin: 0; font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; color: #1f2937; overflow: auto; max-height: 320px; }
  .params-table { width: 100%; border-collapse: collapse; font: 11px Arial; }
  .params-table th, .params-table td { padding: 4px 8px; border-bottom: 1px solid #f1f5f9; text-align: left; }
  .params-table th { background: #f9fafb; font-weight: 600; color: #475569; }
  .params-table td code { font: 600 11px ui-monospace, monospace; color: #0c4a6e; }

  /* === K.69 right-pane redesign — Inferred/Proposed top tabs ============ */
  .detail-pane { padding: 0; display: flex; flex-direction: column; overflow: hidden; min-height: 0; }
  .detail-pane > .tab-body { flex: 1 1 auto; }
  .detail-pane .detail-head { display: flex; align-items: baseline; gap: 8px; padding: 2px 12px 0; border-bottom: 1px solid #f1f5f9; min-height: 0; }
  .detail-pane .detail-head h2 { margin: 0; font: 700 16px ui-monospace, monospace; }
  .head-spacer { flex: 1; }
  .head-exemplar { font: 11px ui-monospace, monospace; color: #6b7280; }
  .head-graph-link { font: 600 11px Arial; color: #6d28d9; background: #ede9fe; border: 1px solid #c4b5fd; border-radius: 4px; padding: 3px 8px; text-decoration: none; display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
  .head-graph-link:hover { background: #ddd6fe; color: #4c1d95; border-color: #a78bfa; }
  .head-graph-link.on { background: #6d28d9; color: #fff; border-color: #4c1d95; }
  .head-graph-link.on:hover { background: #4c1d95; }

  /* Inline iframe panel — sits below the term-detail header when the
     toggle is on. Height-sized to give the editor real estate without
     stealing the whole pane (so the user can still scroll back up to
     the params + rule details + bake). */
  .vocab-graph-embed { display: flex; flex-direction: column; height: 70vh; margin-top: 14px; border: 2px solid #c4b5fd; border-radius: 6px; overflow: hidden; background: #fff; box-shadow: 0 2px 8px rgba(109, 40, 217, 0.1); }
  .vge-bar { display: flex; align-items: center; gap: 10px; padding: 6px 12px; background: #faf5ff; border-bottom: 1px solid #e9d5ff; font: 600 12px Arial; color: #4c1d95; }
  .vge-bar code { font: 11px ui-monospace, monospace; color: #6b7280; background: #ede9fe; padding: 2px 6px; border-radius: 3px; }
  .vge-sp { flex: 1; }
  .vge-link { font: 600 11px Arial; color: #6d28d9; text-decoration: none; padding: 3px 8px; border: 1px solid #c4b5fd; border-radius: 4px; }
  .vge-link:hover { background: #ede9fe; }
  .vge-close { background: transparent; border: 0; font: 16px Arial; color: #6b7280; cursor: pointer; padding: 0 6px; line-height: 1; }
  .vge-close:hover { color: #b91c1c; }
  .vge-iframe { flex: 1 1 auto; width: 100%; border: 0; background: #fafaf9; }
  /* Status line above the tabs (for promote success/failure). */
  .vocab-tab-status { font: 11px ui-monospace, monospace; color: #15803d; padding: 4px 16px; background: #f0fdf4; border-bottom: 1px solid #86efac; }
  /* Vertical trapezoidal Inferred|Proposed rail (restored 2026-06-06). */
  .vocab-tabs { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: 28px 1fr; overflow: hidden; }
  .vocab-vrail {
    display: flex; flex-direction: column; gap: 0;
    padding: 0; background: #ececec;
    border-right: 1px solid #e5e5e5;
    align-items: stretch;
  }
  .vocab-vtab {
    position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 3px; padding: 6px 0;
    border: 0; background: transparent; color: #444;
    cursor: pointer;
    clip-path: polygon(0 14%, 100% 0, 100% 100%, 0 86%);
    font: inherit; line-height: 1;
    transition: color 0.1s, background 0.1s;
  }
  .vocab-vtab:hover:not(:disabled) { color: #cc2222; background: #e2e2e2; }
  .vocab-vtab.active { color: #cc2222; background: #fafafa; }
  .vocab-vtab:disabled { color: #c0c0c0; cursor: not-allowed; opacity: 0.5; }
  .vocab-vtab-ic { font-size: 13px; opacity: 0.95; line-height: 1; }
  .vocab-vtab-lbl { writing-mode: vertical-rl; transform: rotate(180deg); font: 700 11px Arial; letter-spacing: 1.2px; line-height: 1; white-space: nowrap; }
  /* ⓘ Definition & tags popover (encapsulates rich verbiage out of tab body). */
  .info-popover-wrap { position: relative; }
  .info-pop-btn {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 5px 12px;
    background: #fff; border: 1px solid #d6d3d1; border-radius: 6px;
    font: 600 12px Arial; color: #0c4a6e;
    cursor: pointer;
  }
  .info-pop-btn:hover { border-color: #0369a1; background: #e0f2fe; }
  .info-pop-panel {
    position: absolute; top: calc(100% + 6px); right: 0;
    width: 420px; max-width: 90vw; max-height: 75vh;
    background: #fff; border: 1px solid #0369a1; border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.14);
    padding: 14px 16px; z-index: 50;
    overflow-y: auto;
    display: grid; gap: 10px; align-content: start;
  }
  .info-pop-panel .def-line.rich { margin: 0; }
  /* Accordion shell — copied from /primitives PrimitiveView (.pg-acc-*). */
  .pg-acc-wrap { border: 3px solid #d4d4dc; border-radius: 4px; background: #fff; padding: 0 3px 1px; margin: 0; }
  .pg-acc-head {
    display: flex; align-items: center; gap: 4px;
    padding: 2px 6px; margin: 0;
    background: transparent; border: 0;
    cursor: pointer;
    border-radius: 3px;
  }
  .pg-acc-head:hover { background: #ececf2; color: #cc2222; }
  .pg-acc-head.collapsed { background: #fafafa; }
  .pg-acc-title { font: bold 13px Arial; color: #333; flex: 0 0 auto; }
  .pg-acc-count { font: 11px ui-monospace, monospace; color: #6b7280; }
  .pg-acc-hint { font: 11px Arial; color: #9ca3af; }
  .pv-spacer { flex: 1; }
  .pg-acc-body { padding: 2px 4px 2px; max-height: 320px; overflow-y: auto; }
  /* Seed-tab host — full-width container; the switcher lives as a popover in
     the detail-head, not as a vertical rail. */
  .seed-tab-host { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
  /* Tab-switcher popover (replaces the vertical rail). Button sits in the
     detail-head; click opens a floating panel with the two options. */
  .tab-popover-wrap { position: relative; }
  .tab-pop-btn {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 5px 12px;
    background: #fff; border: 1px solid #d6d3d1; border-radius: 6px;
    font: 600 12px Arial; color: #1f2937;
    cursor: pointer;
  }
  .tab-pop-btn:hover { border-color: #cc2222; color: #cc2222; }
  .tab-pop-caret { font-size: 9px; color: #6b7280; }
  .tab-pop-menu {
    position: absolute; top: calc(100% + 4px); right: 0;
    min-width: 220px;
    background: #fff; border: 1px solid #cc2222; border-radius: 6px;
    box-shadow: 0 4px 14px rgba(0,0,0,0.12);
    padding: 4px 0; z-index: 50;
  }
  .tab-pop-item {
    display: flex; align-items: center; gap: 8px; width: 100%;
    padding: 6px 12px;
    background: transparent; border: 0;
    font: 13px Arial; color: #1f2937;
    cursor: pointer; text-align: left;
  }
  .tab-pop-item:hover:not(:disabled) { background: #fef0f0; color: #cc2222; }
  .tab-pop-item.active { background: #fee2e2; color: #991b1b; font-weight: 600; }
  .tab-pop-item:disabled { color: #d1d5db; cursor: not-allowed; }
  .tab-pop-ic { font-size: 14px; }
  .tab-pop-sub { font: 10px Arial; color: #9ca3af; margin-left: auto; }
  /* 2-column params tiles when promoted to the top. */
  .param-sliders.top-2col {
    display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 10px 12px;
    background: #fef3c7; border: 1px solid #fbbf24; border-radius: 6px;
  }
  .param-sliders.top-2col .ps-cap { grid-column: 1 / -1; font: 600 10px Arial; color: #78350f; text-transform: uppercase; letter-spacing: 0.6px; padding-bottom: 4px; border-bottom: 1px solid #fbbf24; margin: 0; }
  .ps-tile { display: grid; gap: 4px; padding: 6px 8px; background: #fff; border: 1px solid #fde68a; border-radius: 4px; }
  .ps-tile-head { display: flex; align-items: baseline; justify-content: space-between; gap: 6px; }
  .ps-tile-head .ps-key { font: 600 11px ui-monospace, monospace; color: #1f2937; }
  .ps-tile-head .ps-unit { font: 10px Arial; color: #92400e; }
  .ps-tile-ctrls { display: grid; grid-template-columns: 1fr 60px; gap: 4px; align-items: center; }
  .ps-tile-ctrls .ps-slider { width: 100%; min-width: 0; }
  .ps-tile-ctrls .ps-num { width: 100%; padding: 2px 4px; font: 11px ui-monospace, monospace; border: 1px solid #d6d3d1; border-radius: 3px; }
  /* Tab body — scrollable inner column. */
  .tab-body { padding: 6px 14px 14px; overflow-y: auto; display: grid; gap: 8px; align-content: start; min-height: 0; }
  .tab-body .def-line { font: 13px/1.55 Arial; color: #374151; margin: 0; }
  .tab-body .def-line.rich { font-size: 14px; color: #1f2937; padding: 10px 12px; background: #f8fafc; border-left: 3px solid #0369a1; border-radius: 0 4px 4px 0; }
  /* Compact info-chip row beneath the definition. */
  .info-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .info-chip { padding: 2px 8px; border-radius: 9999px; font: 11px Arial; background: #f3f4f6; color: #475569; border: 1px solid #e5e7eb; }
  .info-chip.cat       { background: #ede9fe; color: #5b21b6; border-color: #c4b5fd; }
  .info-chip.dim       { background: #e0f2fe; color: #0c4a6e; border-color: #0369a1; font-family: ui-monospace, monospace; }
  .info-chip.variant   { background: #fef3c7; color: #78350f; border-color: #fbbf24; }
  .info-chip.ext-info  { background: #fce7f3; color: #831843; border-color: #f9a8d4; }
  .info-chip.link      { background: #dbeafe; color: #1d4ed8; border-color: #93c5fd; text-decoration: none; }
  .info-chip.link:hover { background: #bfdbfe; }
  .info-chip.rule      { background: #f3f4f6; font-family: ui-monospace, monospace; }
  .info-code { font: 11px ui-monospace, monospace; background: #fef3c7; color: #78350f; padding: 2px 6px; border-radius: 3px; border: 1px solid #fbbf24; }
  /* Chip groups — synonyms, function, form, variants, references. */
  .chips-row { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
  .chips-label { font: 600 10px Arial; color: #6b7280; text-transform: uppercase; letter-spacing: 0.6px; min-width: 80px; }
  /* 2D drawing + 3D bake side-by-side. */
  .view-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; align-items: stretch; min-height: 320px; }
  .view-row.solo { grid-template-columns: 1fr; min-height: 420px; }
  .view-row > * { min-width: 0; }
  /* 30/70 canvas | rule-details row in the Proposed tab. */
  .canvas-rule-row { display: grid; grid-template-columns: 3fr 7fr; gap: 12px; align-items: stretch; min-height: 360px; }
  .canvas-rule-row > * { min-width: 0; }
  .rule-details-col { display: flex; flex-direction: column; gap: 6px; overflow-y: auto; }
  /* New 2-col layout: LEFT = canvas (full height of column); RIGHT =
     params (top) + rule + details (below). */
  .proposed-grid { display: grid; grid-template-columns: 4fr 6fr; gap: 10px; align-items: stretch; min-height: 560px; }
  .proposed-grid > * { min-width: 0; }
  .proposed-canvas-col { display: flex; flex-direction: column; }
  .proposed-canvas-col .bake-card { flex: 1 1 auto; }
  /* Keep the bake-card a flex column so .bake-body has a defined height,
     otherwise the inner canvas collapses to 0 → auto-fit fires → bake-card
     grows → loop ("magnification keeps going indefinitely"). */
  .proposed-canvas-col .bake-card.no-head { display: flex; flex-direction: column; }
  .proposed-canvas-col .bake-card.no-head .bake-body { flex: 1 1 auto; min-height: 480px; padding: 4px; overflow: hidden; }
  .proposed-right-col { display: flex; flex-direction: column; gap: 4px; overflow-y: auto; }
  .proposed-right-col .rule-details-col { max-height: none; flex: 1 1 auto; gap: 2px; }
  /* Inline bake-info in the title row (replaces the in-card bake-head). */
  .head-bake-info { font: 11px Arial; color: #6b7280; margin-left: 6px; }
  .head-bake-info code { font: 11px ui-monospace, monospace; color: #0c4a6e; background: #f0f9ff; padding: 1px 5px; border-radius: 3px; }
  .head-bake-stat { font: 11px ui-monospace, monospace; color: #57534e; margin-left: 4px; }
  .head-bake-stat.err { color: #b91c1c; }
  .head-promote { padding: 2px 10px; font: 600 11px Arial; margin-left: 8px; }
  /* Compact accordions in the right column. */
  .proposed-right-col .block { margin: 0; }
  .proposed-right-col .pg-acc-wrap { margin: 0; padding: 0 2px 1px; }
  .bake-card {
    display: grid; grid-template-rows: auto 1fr;
    background: #fafaf9; border: 1px solid #e7e5e4; border-radius: 6px;
    overflow: hidden;
  }
  .bake-card .bake-head { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid #e7e5e4; background: #fff; }
  .bake-card .bake-head .spacer { flex: 1; }
  .bake-card .bake-title { font: 600 11px Arial; color: #57534e; text-transform: uppercase; letter-spacing: 0.5px; }
  .bake-card .bake-body { padding: 6px; overflow: hidden; min-height: 0; }
  .bake-cta { padding: 24px 16px; text-align: center; color: #57534e; font: 12px Arial; line-height: 1.6; }
  .bake-cta code { font: 11px ui-monospace, monospace; color: #1e40af; }
  .empty-card.faded { opacity: 0.6; }
  .cta-empty { padding: 40px 20px; text-align: center; color: #6b7280; font: 13px/1.6 Arial; background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 6px; }
  /* Promote footer at the bottom of the active tab body. */
  .promote-footer { display: flex; align-items: center; gap: 12px; padding: 12px 14px; margin-top: 6px; background: #f0fdf4; border: 1px solid #86efac; border-radius: 6px; }
  .promote-btn {
    font: 600 12px Arial; padding: 6px 14px;
    background: #dcfce7; color: #14532d; border: 1px solid #15803d; border-radius: 4px;
    cursor: pointer;
  }
  .promote-btn:hover:not(:disabled) { background: #bbf7d0; }
  .promote-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .promote-btn.primary { background: #16a34a; color: #fff; border-color: #15803d; }
  .promote-btn.primary:hover:not(:disabled) { background: #15803d; }
  .promote-hint { font: 11px Arial; color: #166534; flex: 1; }
  .promote-hint code { font: 11px ui-monospace, monospace; background: #dcfce7; padding: 1px 4px; border-radius: 2px; }
</style>
