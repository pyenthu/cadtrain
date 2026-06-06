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

  <main class="vocab-grid">
    <!-- LEFT: diagram + term browser -->
    <section class="diagram-pane">
      <div class="diagram-head">
        <h2>Topology</h2>
        <span class="hint">click a node →</span>
      </div>
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

      <div class="browser">
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
    </section>

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
              <!-- Seeds have no rule / exemplar yet, so the Scene tab is just
                   the 2D vendor silhouette + the size variants table. The
                   point is visual review before promotion. -->
              <div class="seed-scene">
                {#if e.compjson_ref && CompJsonSilhouette}
                  <CompJsonSilhouette ref={e.compjson_ref} title="2D vendor reference" height={320} />
                {:else}
                  <div class="empty">no compjson_ref — this seed has no 2D silhouette on file.</div>
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
                    <details class="block" open>
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
                  <div class="seed-promote">
                    <strong>promote:</strong> write a <code>rule: {`{ kind:'primitive'|'compose', ... }`}</code> block into <code>vocabulary.seeds.json</code>,
                    flip <code>status</code> to <code>'promoted'</code>, and the translator will pick it up. Mid-term we'll lift promoted seeds into <code>vocabulary.json</code>.
                  </div>
                </div>
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

  .vocab-grid { display: grid; grid-template-columns: 1.6fr 1fr; overflow: hidden; }

  .diagram-pane { display: grid; grid-template-rows: auto 1fr auto; border-right: 1px solid #e5e7eb; overflow: hidden; }
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
  /* Seed scene — silhouette on top, metadata + variants table below. Scrolls. */
  .seed-scene { display: grid; grid-template-rows: auto 1fr; gap: 12px; padding: 12px; height: calc(100vh - 220px); overflow: auto; }
  .seed-meta { display: grid; gap: 4px; align-content: start; }
  .seed-promote { margin-top: 12px; padding: 10px 12px; background: #fffbeb; border: 1px solid #fbbf24; border-radius: 4px; font: 12px Arial; color: #78350f; line-height: 1.5; }
  .seed-promote code { font: 11px ui-monospace, monospace; background: #fef3c7; padding: 1px 4px; border-radius: 2px; }

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
