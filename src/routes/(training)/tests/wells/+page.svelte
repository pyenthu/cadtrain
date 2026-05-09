<script lang="ts">
  type Wson = any;

  type ModelId = 'opus' | 'sonnet' | 'haiku';
  type BackendId = 'api' | 'cli';

  interface Case {
    id: string;
    title: string;
    subtitle: string;
    source: string;
    source_kind: 'image' | 'pdf';
    truth: string | null;
    extracted: Record<BackendId, Record<ModelId, string>>;
    has_truth: boolean;
  }

  interface ModelDef { id: ModelId; label: string; }
  interface BackendDef { id: BackendId; label: string; description: string; }

  interface Manifest {
    cases: Case[];
    backends: BackendDef[];
    models: ModelDef[];
    convertFactor?: number;
    convertNote?: string;
  }

  type BackendModelMap = Record<BackendId, Record<ModelId, Wson | null>>;
  const emptyMatrix = (): BackendModelMap => ({
    api: { opus: null, sonnet: null, haiku: null },
    cli: { opus: null, sonnet: null, haiku: null },
  });

  let manifest = $state<Manifest | null>(null);
  let selectedId = $state<string | null>(null);
  let selectedModel = $state<ModelId>('opus');
  let selectedBackend = $state<BackendId>('api');
  let truth = $state<Wson | null>(null);
  let extractedMatrix = $state<BackendModelMap>(emptyMatrix());
  let unitFix = $state(false);
  let loadError = $state<string | null>(null);
  let extracted = $derived(extractedMatrix[selectedBackend][selectedModel]);
  let extractedByModel = $derived(extractedMatrix[selectedBackend]);

  const M2FT_DEFAULT = 3.28084;
  let factor = $derived(manifest?.convertFactor ?? M2FT_DEFAULT);

  async function loadManifest() {
    try {
      const r = await fetch('/eval/wells/index.json', { cache: 'no-cache' });
      if (!r.ok) throw new Error(`index.json ${r.status}`);
      manifest = await r.json();
      if (manifest && manifest.cases.length && !selectedId) {
        selectedId = manifest.cases[0].id;
      }
    } catch (e: any) {
      loadError = e?.message ?? String(e);
    }
  }

  async function loadCase(id: string) {
    if (!manifest) return;
    const c = manifest.cases.find(x => x.id === id);
    if (!c) return;
    truth = null;
    extractedMatrix = emptyMatrix();
    try {
      const fetchOne = async (url: string) => {
        try {
          const r = await fetch(url);
          if (!r.ok) return null;
          return await r.json();
        } catch { return null; }
      };
      const tasks: Array<[BackendId, ModelId, Promise<Wson | null>]> = [];
      for (const b of ['api', 'cli'] as BackendId[]) {
        for (const m of ['opus', 'sonnet', 'haiku'] as ModelId[]) {
          tasks.push([b, m, fetchOne(c.extracted[b][m])]);
        }
      }
      const results = await Promise.all(tasks.map(t => t[2]));
      const next = emptyMatrix();
      tasks.forEach(([b, m], i) => { next[b][m] = results[i]; });
      extractedMatrix = next;
      if (c.has_truth && c.truth) {
        truth = await fetch(c.truth).then(r => r.json());
      }
    } catch (err: any) {
      loadError = err?.message ?? String(err);
    }
  }

  $effect(() => { loadManifest(); });
  $effect(() => { if (selectedId) loadCase(selectedId); });

  let current = $derived(manifest?.cases.find(c => c.id === selectedId) ?? null);

  function adjustExtractedDepth(v: any): any {
    if (typeof v !== 'number') return v;
    if (!unitFix) return v;
    return v / factor;
  }

  function fmt(n: any, digits = 1): string {
    if (n === null || n === undefined) return '—';
    if (typeof n !== 'number') return String(n);
    return n.toFixed(digits);
  }

  function numClose(a: any, b: any, rel = 0.05, abs_tol = 1.0): boolean {
    if (a === null || a === undefined || b === null || b === undefined) return false;
    const x = Number(a), y = Number(b);
    if (Number.isNaN(x) || Number.isNaN(y)) return false;
    return Math.abs(x - y) <= Math.max(abs_tol, rel * Math.max(Math.abs(x), Math.abs(y)));
  }

  // Build aligned interval rows: greedy-match extracted to truth, mark unmatched.
  type IntervalRow = {
    label: string;
    truth: any;
    extracted: any;
    truthTop: number | null;
    truthBot: number | null;
    extTop: number | null;
    extBot: number | null;
    topMatch: boolean;
    botMatch: boolean;
  };

  function alignIntervals(extList: any[] = [], truthList: any[] = []): IntervalRow[] {
    const used = new Set<number>();
    const rows: IntervalRow[] = [];
    const adj = (v: any) => (typeof v === 'number' ? adjustExtractedDepth(v) : v);

    for (const t of truthList) {
      const tTop = t.top ?? null, tBot = t.bot ?? null;
      let bestI = -1, bestS = Infinity;
      for (let i = 0; i < extList.length; i++) {
        if (used.has(i)) continue;
        const e = extList[i];
        const eTop = adj(e.top), eBot = adj(e.bot);
        const s =
          (typeof tTop === 'number' && typeof eTop === 'number' ? Math.abs(eTop - tTop) : 1e6) +
          (typeof tBot === 'number' && typeof eBot === 'number' ? Math.abs(eBot - tBot) : 0);
        if (s < bestS) { bestS = s; bestI = i; }
      }
      if (bestI >= 0) {
        used.add(bestI);
        const e = extList[bestI];
        const eTop = adj(e.top), eBot = adj(e.bot);
        rows.push({
          label: t.name ?? t.label ?? t.description ?? '',
          truth: t,
          extracted: e,
          truthTop: tTop,
          truthBot: tBot,
          extTop: eTop,
          extBot: eBot,
          topMatch: numClose(eTop, tTop),
          botMatch: numClose(eBot, tBot),
        });
      } else {
        rows.push({
          label: t.name ?? t.label ?? t.description ?? '',
          truth: t,
          extracted: null,
          truthTop: tTop,
          truthBot: tBot,
          extTop: null,
          extBot: null,
          topMatch: false,
          botMatch: false,
        });
      }
    }
    // Unmatched extracted entries → extra rows
    for (let i = 0; i < extList.length; i++) {
      if (used.has(i)) continue;
      const e = extList[i];
      const eTop = adj(e.top), eBot = adj(e.bot);
      rows.push({
        label: '(extra) ' + (e.name ?? e.label ?? e.description ?? ''),
        truth: null,
        extracted: e,
        truthTop: null,
        truthBot: null,
        extTop: eTop,
        extBot: eBot,
        topMatch: false,
        botMatch: false,
      });
    }
    return rows;
  }

  let chRows = $derived(extracted && truth ? alignIntervals(extracted.ch ?? [], truth.ch ?? []) : []);
  let perfRows = $derived(extracted && truth ? alignIntervals(extracted.perforations ?? [], truth.perforations ?? []) : []);
  let compRows = $derived(extracted && truth ? alignIntervals(extracted.completions ?? [], truth.completions ?? []) : []);
  let strataRows = $derived(extracted && truth ? alignIntervals(extracted.strata ?? [], truth.strata ?? []) : []);

  function tally(rows: IntervalRow[]) {
    const truthN = rows.filter(r => r.truth).length;
    const matched = rows.filter(r => r.truth && r.topMatch && (r.truth.bot == null || r.botMatch)).length;
    return { matched, truthN };
  }

  let chTally = $derived(tally(chRows));
  let perfTally = $derived(tally(perfRows));
  let compTally = $derived(tally(compRows));
  let strataTally = $derived(tally(strataRows));

  // Summary across all interval sections for a given (backend, model)
  function summaryFor(backendId: BackendId, modelId: ModelId): { matched: number; total: number } {
    const e = extractedMatrix[backendId][modelId];
    if (!e || !truth) return { matched: 0, total: 0 };
    const ch = alignIntervals(e.ch ?? [], truth.ch ?? []);
    const pf = alignIntervals(e.perforations ?? [], truth.perforations ?? []);
    const cp = alignIntervals(e.completions ?? [], truth.completions ?? []);
    const st = alignIntervals(e.strata ?? [], truth.strata ?? []);
    const tots = [tally(ch), tally(pf), tally(cp), tally(st)];
    return {
      matched: tots.reduce((s, x) => s + x.matched, 0),
      total: tots.reduce((s, x) => s + x.truthN, 0),
    };
  }
  let modelSummary = $derived.by(() => {
    if (!truth || !manifest) return null;
    return Object.fromEntries(manifest.models.map(m => [m.id, summaryFor(selectedBackend, m.id)])) as Record<ModelId, { matched: number; total: number }>;
  });
  // Per-backend roll-up across all 3 models — the badges on the outer tabs
  let backendSummary = $derived.by(() => {
    if (!truth || !manifest) return null;
    const out: Record<BackendId, { matched: number; total: number; loaded: number }> = {
      api: { matched: 0, total: 0, loaded: 0 },
      cli: { matched: 0, total: 0, loaded: 0 },
    };
    for (const b of ['api', 'cli'] as BackendId[]) {
      for (const m of ['opus', 'sonnet', 'haiku'] as ModelId[]) {
        const s = summaryFor(b, m);
        out[b].matched += s.matched;
        out[b].total += s.total;
        if (extractedMatrix[b][m]) out[b].loaded += 1;
      }
    }
    return out;
  });

  let metaRows = $derived.by(() => {
    if (!truth || !extracted) return [];
    const t = truth.meta ?? {};
    const e = extracted.meta ?? {};
    const adj = (v: any) => (typeof v === 'number' ? adjustExtractedDepth(v) : v);
    const fields: Array<[string, string, boolean]> = [
      ['wellName', 'string', false],
      ['td', 'number', true],
      ['rkbToGl', 'number', true],
      ['description', 'string', false],
    ];
    return fields.map(([key, kind, isDepth]) => {
      const tv = t[key];
      const ev = e[key];
      const evAdj = isDepth ? adj(ev) : ev;
      const match = kind === 'string'
        ? ((tv ?? '').toString().trim().toLowerCase() === (ev ?? '').toString().trim().toLowerCase())
        : numClose(evAdj, tv);
      return { key, truth: tv, extracted: evAdj, raw: ev, match };
    });
  });
</script>

<svelte:head><title>Wells Eval — CAD Train</title></svelte:head>

<div class="layout">
  <main class="content">
    <header class="page-head">
      <h1>Wells Extraction — Real-World Eval</h1>
      <p>
        7 paired schematic PNGs + ground-truth WSON from
        <code>~/Desktop/SAMPLE/schematics/xlsxtowson/</code>. Each was posted to
        <code>/api/wells/extract</code> (Claude opus-4-7) and the result is shown
        side-by-side against ground truth.
      </p>
      {#if manifest}
        <div class="bug-note">
          <strong>Prompt bug:</strong> {manifest.convertNote}
        </div>
      {/if}
      <label class="toggle">
        <input type="checkbox" bind:checked={unitFix} />
        Apply meter↔feet correction (extracted ÷ {factor.toFixed(5)})
      </label>
    </header>

    {#if loadError}
      <div class="err">Failed to load: {loadError}</div>
    {/if}

    {#if current}
      <div class="case">
        <section class="src-pane">
          <div class="pane-head">
            <h2>Source</h2>
            <span class="dim">{current.subtitle}</span>
          </div>
          <div class="src-frame">
            {#if current.source_kind === 'pdf'}
              <iframe title="source pdf" src={current.source}></iframe>
            {:else}
              <img src={current.source} alt={current.title} />
            {/if}
          </div>
        </section>

        <section class="diff-pane">
          <div class="pane-head">
            <h2>Extracted vs Truth</h2>
            {#if extracted && truth}
              <div class="tallies">
                <span class="pill" class:ok={chTally.matched === chTally.truthN}>casings {chTally.matched}/{chTally.truthN}</span>
                <span class="pill" class:ok={perfTally.matched === perfTally.truthN}>perfs {perfTally.matched}/{perfTally.truthN}</span>
                <span class="pill" class:ok={compTally.matched === compTally.truthN}>comp {compTally.matched}/{compTally.truthN}</span>
                <span class="pill" class:ok={strataTally.matched === strataTally.truthN}>strata {strataTally.matched}/{strataTally.truthN}</span>
              </div>
            {/if}
          </div>

          {#if manifest}
            <div class="tabs tabs-outer">
              {#each manifest.backends as b}
                {@const s = backendSummary?.[b.id]}
                <button
                  class="tab"
                  class:active={selectedBackend === b.id}
                  class:no-data={s ? s.loaded === 0 : true}
                  onclick={() => selectedBackend = b.id}
                  title={b.description}
                >
                  <span class="tab-label">{b.label}</span>
                  {#if s && s.total > 0}
                    <span class="tab-score" class:perfect={s.matched === s.total}>
                      {s.matched}/{s.total}
                    </span>
                  {:else if s}
                    <span class="tab-score dim">{s.loaded}/3 loaded</span>
                  {/if}
                </button>
              {/each}
            </div>

            <div class="tabs tabs-inner">
              {#each manifest.models as m}
                {@const s = modelSummary?.[m.id]}
                {@const loaded = extractedByModel[m.id] !== null}
                <button
                  class="tab"
                  class:active={selectedModel === m.id}
                  class:no-data={!loaded}
                  onclick={() => selectedModel = m.id}
                >
                  <span class="tab-label">{m.label}</span>
                  {#if s && s.total > 0}
                    <span class="tab-score" class:perfect={s.matched === s.total}>
                      {s.matched}/{s.total}
                    </span>
                  {:else if !loaded}
                    <span class="tab-score dim">—</span>
                  {/if}
                </button>
              {/each}
            </div>
          {/if}

          {#if !extracted}
            <div class="loading">Loading…</div>
          {:else if !truth}
            <div class="bug-note">
              No ground-truth WSON for this case. Showing extracted output only.
            </div>
            <h3>Meta</h3>
            <pre class="raw">{JSON.stringify(extracted.meta ?? {}, null, 2)}</pre>
            <h3>Casings (ch) — {(extracted.ch ?? []).length}</h3>
            <pre class="raw">{JSON.stringify(extracted.ch ?? [], null, 2)}</pre>
            <h3>Perforations — {(extracted.perforations ?? []).length}</h3>
            <pre class="raw">{JSON.stringify(extracted.perforations ?? [], null, 2)}</pre>
            <h3>Completions — {(extracted.completions ?? []).length}</h3>
            <pre class="raw">{JSON.stringify(extracted.completions ?? [], null, 2)}</pre>
            <h3>Strata — {(extracted.strata ?? []).length}</h3>
            <pre class="raw">{JSON.stringify(extracted.strata ?? [], null, 2)}</pre>
            <h3>Profile (deviation) — {(extracted.profile ?? []).length} stations</h3>
            <pre class="raw">{JSON.stringify((extracted.profile ?? []).slice(0, 10), null, 2)}{(extracted.profile ?? []).length > 10 ? '\n…' : ''}</pre>
          {:else}
            <h3>Meta</h3>
            <table class="diff">
              <thead>
                <tr><th>field</th><th>truth</th><th>extracted{unitFix ? ' (corrected)' : ''}</th><th>raw</th></tr>
              </thead>
              <tbody>
                {#each metaRows as r}
                  <tr class:ok={r.match} class:miss={!r.match}>
                    <td><code>{r.key}</code></td>
                    <td>{r.truth ?? '—'}</td>
                    <td>{typeof r.extracted === 'number' ? fmt(r.extracted, 2) : (r.extracted ?? '—')}</td>
                    <td class="dim">{typeof r.raw === 'number' ? fmt(r.raw, 2) : (r.raw ?? '—')}</td>
                  </tr>
                {/each}
              </tbody>
            </table>

            <h3>Casings (ch)</h3>
            {@render IntervalTable(chRows)}

            <h3>Perforations</h3>
            {@render IntervalTable(perfRows)}

            <h3>Completions</h3>
            {@render IntervalTable(compRows)}

            <h3>Strata</h3>
            {@render IntervalTable(strataRows)}
          {/if}
        </section>
      </div>
    {/if}
  </main>

  <aside class="navigator">
    <div class="nav-head">
      <span>Cases</span>
      <span class="count">{manifest?.cases.length ?? 0}</span>
    </div>
    {#if manifest}
      {#each manifest.cases as c}
        <button
          class="nav-item"
          class:active={c.id === selectedId}
          onclick={() => selectedId = c.id}
        >
          <span class="nav-title">{c.title}</span>
          <span class="nav-sub">{c.id.slice(0, 50)}…</span>
        </button>
      {/each}
    {/if}
    <div class="nav-back"><a href="/tests">← back to /tests</a></div>
  </aside>
</div>

{#snippet IntervalTable(rows: IntervalRow[])}
  {#if rows.length === 0}
    <div class="empty-sect">— no entries —</div>
  {:else}
    <table class="diff">
      <thead>
        <tr><th>label</th><th>truth top</th><th>extracted top</th><th>truth bot</th><th>extracted bot</th></tr>
      </thead>
      <tbody>
        {#each rows as r}
          <tr>
            <td>{r.label || '—'}</td>
            <td>{r.truthTop ?? '—'}</td>
            <td class:ok={r.topMatch} class:miss={r.truthTop != null && !r.topMatch}>
              {typeof r.extTop === 'number' ? fmt(r.extTop, 2) : (r.extTop ?? '—')}
            </td>
            <td>{r.truthBot ?? '—'}</td>
            <td class:ok={r.botMatch} class:miss={r.truthBot != null && !r.botMatch}>
              {typeof r.extBot === 'number' ? fmt(r.extBot, 2) : (r.extBot ?? '—')}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
{/snippet}

<style>
  .layout { display: flex; height: 100%; font-family: Arial, sans-serif; background: #fafafa; }
  .content { flex: 1; overflow-y: auto; padding: 20px 24px; min-width: 0; }
  .page-head h1 { margin: 0 0 6px; font-size: 20px; color: #333; }
  .page-head p { margin: 0 0 8px; color: #888; font-size: 12px; line-height: 1.5; }
  .page-head code { background: #f0f0f0; padding: 1px 5px; border-radius: 3px; font: 11px monospace; }
  .bug-note { background: #fff5cd; border-left: 3px solid #c98900; padding: 8px 12px; margin: 8px 0; font-size: 12px; color: #444; line-height: 1.5; border-radius: 3px; }
  .toggle { display: inline-flex; gap: 8px; align-items: center; font-size: 12px; color: #444; cursor: pointer; padding: 6px 10px; background: white; border: 1px solid #e0e0e0; border-radius: 4px; }

  .case { display: grid; grid-template-columns: minmax(380px, 1fr) minmax(0, 1.4fr); gap: 18px; margin-top: 16px; align-items: stretch; }
  .src-pane, .diff-pane { background: white; border: 1px solid #e0e0e0; border-radius: 6px; padding: 14px; }
  .pane-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding-bottom: 8px; border-bottom: 1px solid #eee; margin-bottom: 12px; }
  .pane-head h2 { margin: 0; font-size: 14px; color: #333; }
  .pane-head .dim { font-size: 10px; color: #999; font-family: monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 70%; }

  .src-frame { display: flex; justify-content: center; align-items: flex-start; max-height: 1100px; overflow: auto; background: #f5f5f5; border-radius: 4px; padding: 8px; }
  .src-frame img { max-width: 100%; height: auto; }
  .src-frame iframe { width: 100%; height: 1000px; border: none; background: white; }

  .tallies { display: flex; gap: 6px; flex-wrap: wrap; }
  .pill { font: 10px Arial; padding: 2px 8px; border-radius: 11px; background: #f8d7da; color: #721c24; }
  .pill.ok { background: #d4edda; color: #155724; }

  .tabs { display: flex; gap: 4px; border-bottom: 1px solid #e0e0e0; }
  .tabs-outer { margin: 8px 0 0; background: #f0f4ff; padding: 4px 4px 0; border-radius: 6px 6px 0 0; border: 1px solid #d6dcef; border-bottom: none; }
  .tabs-outer .tab { font-size: 13px; }
  .tabs-outer .tab.active { background: white; border-bottom-color: white; box-shadow: 0 -1px 0 #16213e inset; color: #16213e; }
  .tabs-inner { margin: 0 0 14px; padding-left: 6px; }
  .tab { display: flex; gap: 8px; align-items: center; padding: 8px 14px; background: none; border: none; border-bottom: 2px solid transparent; cursor: pointer; font-size: 12px; color: #666; border-radius: 4px 4px 0 0; transition: background 0.15s; }
  .tab:hover { background: #f5f5f5; }
  .tab.active { color: #16213e; border-bottom-color: #16213e; font-weight: bold; background: #f0f4ff; }
  .tab.no-data { opacity: 0.4; }
  .tab-label { font-size: 12px; }
  .tab-score { font: bold 10px monospace; padding: 2px 6px; border-radius: 8px; background: #fdecea; color: #762626; }
  .tab-score.perfect { background: #d4edda; color: #155724; }
  .tab-score.dim { background: #e9ecef; color: #888; }

  .diff-pane h3 { margin: 14px 0 6px; font-size: 12px; color: #555; text-transform: uppercase; letter-spacing: 1px; }
  .diff { width: 100%; border-collapse: collapse; font-size: 12px; }
  .diff th, .diff td { padding: 5px 8px; border-bottom: 1px solid #f0f0f0; text-align: left; }
  .diff th { font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 1px; font-weight: normal; background: #fafafa; }
  .diff td.ok, .diff tr.ok { background: #e8f5e9; color: #1b5e20; }
  .diff td.miss, .diff tr.miss { background: #fdecea; color: #762626; }
  .diff td.dim { color: #999; font-family: monospace; font-size: 11px; }
  .diff code { font-size: 11px; }
  .empty-sect { font-size: 11px; color: #aaa; padding: 6px; }
  .raw { background: #f5f5f5; border: 1px solid #e0e0e0; border-radius: 4px; padding: 10px; font: 11px monospace; max-height: 280px; overflow: auto; white-space: pre-wrap; margin: 0 0 8px; }

  .err { background: #f8d7da; color: #721c24; padding: 10px 14px; border-radius: 6px; font-size: 12px; margin: 12px 0; }
  .loading { padding: 20px; text-align: center; color: #aaa; font-size: 12px; }

  .navigator { width: 280px; min-width: 280px; background: white; border-left: 1px solid #e0e0e0; padding: 16px 10px; overflow-y: auto; }
  .nav-head { display: flex; justify-content: space-between; align-items: baseline; padding: 0 8px 10px; border-bottom: 1px solid #eee; margin-bottom: 8px; font: bold 11px Arial; color: #16213e; text-transform: uppercase; letter-spacing: 1px; }
  .nav-head .count { font-size: 10px; color: #999; font-weight: normal; }
  .nav-item { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; width: 100%; text-align: left; padding: 8px 12px; margin-bottom: 2px; border: none; background: none; border-radius: 4px; cursor: pointer; }
  .nav-item:hover { background: #f5f5f5; }
  .nav-item.active { background: #16213e; }
  .nav-item.active .nav-title { color: white; }
  .nav-item.active .nav-sub { color: #aec0d9; }
  .nav-title { font: bold 12px Arial; color: #333; line-height: 1.3; }
  .nav-sub { font: 9px monospace; color: #888; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
  .nav-back { padding: 12px 8px; border-top: 1px solid #eee; margin-top: 8px; font-size: 11px; }
  .nav-back a { color: #16213e; text-decoration: none; }
  .nav-back a:hover { text-decoration: underline; }
</style>
