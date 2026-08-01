<script lang="ts">
  // /app_design/eval — a COMPREHENSIVE, REPEATABLE in-browser eval harness for the app-builder.
  // Measures how faithfully a provider (the in-browser Qwen3-4B via WebGPU · Claude CLI · Claude
  // API) reproduces our GOLDEN .app builds from the natural-language prompt scripts, WITHOUT
  // hand-driving the studio chat. For each selected app × N runs it starts from an EMPTY app,
  // replays EVAL_PROMPTS[id] one prompt at a time (Phi mutates in-browser via buildAppWithPhi;
  // cli/cloud POST /api/app/generate and forward the returned app), then scores the finished app
  // with scoreApp(built, golden) — a 0..1 structural similarity + 6-facet breakdown. Results are
  // shown as a colour-graded matrix (apps × Overall+facets) that live-updates as runs land.
  //
  // Client-only (these app routes already run SSR-off — root +layout.ts). Nothing runs on mount;
  // a run only starts on the Run button. Phi is free/client; cli/cloud hit the metered/subscription
  // paths (expected for on-demand runs). See docs/plans/app-build-eval.md.
  import {
    scoreApp,
    preorderKinds,
    dataVarNames,
    dataStructureNames,
    type AppLike,
    type ScoreBreakdown,
  } from '$lib/appkit/ai/score-app';
  import { APP_IDS, EVAL_PROMPTS, type EvalAppId } from '$lib/appkit/ai/eval-fixtures';

  type Provider = 'phi' | 'cli' | 'cloud';
  type Facet = keyof ScoreBreakdown; // panelKinds · nesting · vars · structures · theme · meta
  const FACETS: Facet[] = ['panelKinds', 'nesting', 'vars', 'structures', 'theme', 'meta'];
  const FACET_LABEL: Record<Facet, string> = {
    panelKinds: 'panelKinds',
    nesting: 'nesting',
    vars: 'vars',
    structures: 'structures',
    theme: 'theme',
    meta: 'meta',
  };

  // The committed Claude reference numbers — Claude CLI, INCREMENTAL (one call per atomic prompt),
  // with the incremental-discipline fix (scripts/eval-app-build.ts --provider cli --incremental).
  // Data facets are 100% across all three; residual gaps are panel-nesting only (design wraps each
  // nodetree in a container; ewell's interleaved rail + centre schematic). Qwen is measured vs these.
  const CLAUDE_REF: Record<EvalAppId, number> = { plan: 1.0, design: 0.9, ewell: 0.687 };

  interface RunResult {
    score: number;
    breakdown: ScoreBreakdown;
  }
  interface AppRow {
    id: EvalAppId;
    status: 'idle' | 'golden' | 'running' | 'done' | 'error';
    progress: string;
    runs: RunResult[];
    avg: ({ overall: number } & Record<Facet, number>) | null;
    error: string;
    builtKinds: string[];
    goldenKinds: string[];
    builtVars: string[];
    goldenVars: string[];
    builtStructures: string[];
    goldenStructures: string[];
    lastBuiltApp: AppLike | null;
    stepScores: number[]; // per-rung overall score of the LATEST run — the "where does it diverge" curve
    expanded: boolean;
  }

  function emptyRow(id: EvalAppId): AppRow {
    return {
      id,
      status: 'idle',
      progress: '',
      runs: [],
      avg: null,
      error: '',
      builtKinds: [],
      goldenKinds: [],
      builtVars: [],
      goldenVars: [],
      builtStructures: [],
      goldenStructures: [],
      lastBuiltApp: null,
      stepScores: [],
      expanded: false,
    };
  }

  let provider = $state<Provider>('phi');
  let appSel = $state<'all' | EvalAppId>('all');
  let runsN = $state(1);
  let ground = $state(true); // RAG grounding on/off — the independent variable (raw vs grounded lift)
  let running = $state(false);
  let rows = $state<AppRow[]>(APP_IDS.map(emptyRow));

  // Phi (in-browser Qwen3-4B / WebGPU) load state.
  const webgpuOk = typeof navigator !== 'undefined' && !!(navigator as { gpu?: unknown }).gpu;
  let phiLoaded = $state(false);
  let phiLoading = $state(false);
  let phiProgress = $state(0);
  let phiText = $state('');

  const rowFor = (id: EvalAppId) => rows.find((r) => r.id === id)!;
  const selectedIds = (): EvalAppId[] => (appSel === 'all' ? [...APP_IDS] : [appSel]);
  const pct = (x: number | null | undefined) => (x == null ? '—' : `${(x * 100).toFixed(1)}%`);
  const varsLine = (vars: string[], structs: string[]) =>
    (vars.join(', ') || '—') + (structs.length ? `  ·  structures: ${structs.join(', ')}` : '');

  /** Red→green heat for a 0..1 score. Null → neutral grey. */
  function heat(v: number | null | undefined): string {
    if (v == null) return 'background:#f1f5f9;color:#94a3b8;';
    const hue = Math.round(Math.max(0, Math.min(1, v)) * 130); // 0=red → 130=green
    return `background:hsl(${hue},68%,42%);color:#fff;`;
  }

  function averaged(runs: RunResult[]): { overall: number } & Record<Facet, number> {
    const n = runs.length || 1;
    const out = { overall: 0, panelKinds: 0, nesting: 0, vars: 0, structures: 0, theme: 0, meta: 0 };
    for (const r of runs) {
      out.overall += r.score;
      for (const f of FACETS) out[f] += r.breakdown[f];
    }
    out.overall /= n;
    for (const f of FACETS) out[f] /= n;
    return out;
  }

  /** Population stdev of the per-run overall scores — the variance readout. */
  function stdev(runs: RunResult[]): number {
    if (runs.length < 2) return 0;
    const m = runs.reduce((s, r) => s + r.score, 0) / runs.length;
    return Math.sqrt(runs.reduce((s, r) => s + (r.score - m) ** 2, 0) / runs.length);
  }

  // Summary row = average across the apps that have a score.
  const scoredRows = $derived(rows.filter((r) => r.avg));
  const summary = $derived.by(() => {
    if (!scoredRows.length) return null;
    const out = { overall: 0, panelKinds: 0, nesting: 0, vars: 0, structures: 0, theme: 0, meta: 0 };
    for (const r of scoredRows) {
      out.overall += r.avg!.overall;
      for (const f of FACETS) out[f] += r.avg![f];
    }
    out.overall /= scoredRows.length;
    for (const f of FACETS) out[f] /= scoredRows.length;
    return out;
  });

  const goldenCache = new Map<string, AppLike>();
  async function fetchGolden(id: EvalAppId): Promise<AppLike> {
    if (goldenCache.has(id)) return goldenCache.get(id)!;
    const r = await fetch(`/api/volume?path=ai/app-rag/golden/${id}.app&raw=1`);
    if (!r.ok) throw new Error(`golden ${id} fetch ${r.status}`);
    const g = (await r.json()) as AppLike;
    goldenCache.set(id, g);
    return g;
  }

  /** The RAG grounding for one prompt — the SAME server-side retrieval the cli/cloud path uses,
   *  fetched so the in-browser phi builder can be grounded too. Best-effort: '' on any failure. */
  async function fetchGrounding(prompt: string): Promise<string> {
    try {
      const r = await fetch('/api/app/ground', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      if (!r.ok) return '';
      return ((await r.json()) as { grounding?: string }).grounding ?? '';
    } catch {
      return '';
    }
  }

  let phiMod: typeof import('$lib/appkit/ai/webllm-build') | null = null;
  async function loadPhiModel(): Promise<void> {
    if (phiLoaded || phiLoading) return;
    phiLoading = true;
    phiText = 'loading Qwen2.5-1.5B (one-time ~1.6 GB, cached in-browser)…';
    try {
      phiMod = await import('$lib/appkit/ai/webllm-build');
      if (!phiMod.isWebGPUAvailable()) throw new Error('WebGPU unavailable — use Chrome/Edge desktop');
      if (!phiMod.phiReady()) {
        await phiMod.loadPhi((p) => {
          phiProgress = p.progress;
          phiText = p.text;
        });
      }
      phiLoaded = true;
      phiText = 'model ready';
    } catch (e) {
      phiText = `load failed: ${String((e as { message?: string })?.message ?? e)}`;
      throw e;
    } finally {
      phiLoading = false;
    }
  }

  /** Build one app once: EMPTY → replay every prompt in order → return the finished app. Scores
   *  vs the golden AFTER EACH prompt (the per-rung curve) so we see exactly where a build diverges —
   *  the "incrementally at each step" diagnostic, mirroring the headless runner's summary.json. */
  async function buildOnce(id: EvalAppId, runLabel: string, row: AppRow, golden: AppLike): Promise<AppLike> {
    let app: AppLike = { app: id, title: id, panels: [] };
    const prompts = EVAL_PROMPTS[id];
    const stepScores: number[] = [];
    for (let i = 0; i < prompts.length; i++) {
      const step = prompts[i]!;
      row.progress = `${runLabel} · prompt ${i + 1}/${prompts.length}`;
      if (provider === 'phi') {
        // phi runs in-browser and never hits /api/app/generate, so it gets NO grounding unless we
        // fetch it here. /api/app/ground runs the SAME server-side retrieval the cli/cloud path uses
        // (residency-clean: retrieval on the local server, inference in-browser). Toggle via `ground`.
        const grounding = ground ? await fetchGrounding(step) : '';
        // buildAppWithPhi mutates `app` in place (returns {trace, raw}); keep the same object.
        await phiMod!.buildAppWithPhi(app as any, step, grounding);
      } else {
        // cli/cloud POST /api/app/generate, which already grounds via buildGrounding server-side.
        const res = await fetch('/api/app/generate', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ app, prompt: step, provider }),
        });
        if (!res.ok) throw new Error(`generate ${res.status}: ${(await res.text()).slice(0, 200)}`);
        const j = await res.json();
        app = j.app as AppLike; // forward the mutated manifest to the next prompt
      }
      stepScores.push(scoreApp(app, golden).score); // score this rung vs the golden
      row.stepScores = [...stepScores];
    }
    return app;
  }

  async function runAll(): Promise<void> {
    if (running) return;
    running = true;
    const ids = selectedIds();
    for (const id of ids) Object.assign(rowFor(id), emptyRow(id));
    try {
      if (provider === 'phi') await loadPhiModel(); // ensure the model is resident before timing
      for (const id of ids) {
        const row = rowFor(id);
        row.status = 'golden';
        let golden: AppLike;
        try {
          golden = await fetchGolden(id);
        } catch (e) {
          row.status = 'error';
          row.error = String((e as { message?: string })?.message ?? e);
          continue;
        }
        // Golden detail up-front so the panel shows the target even before the first run lands.
        row.goldenKinds = preorderKinds(golden);
        row.goldenVars = dataVarNames(golden);
        row.goldenStructures = dataStructureNames(golden);
        row.status = 'running';
        const runResults: RunResult[] = [];
        try {
          for (let r = 1; r <= Math.max(1, runsN); r++) {
            const built = await buildOnce(id, `run ${r}/${Math.max(1, runsN)}`, row, golden);
            const sc = scoreApp(built, golden);
            runResults.push({ score: sc.score, breakdown: sc.breakdown });
            row.runs = [...runResults];
            row.avg = averaged(runResults);
            row.builtKinds = sc.detail.builtKinds;
            row.builtVars = sc.detail.builtVars;
            row.builtStructures = sc.detail.builtStructures;
            row.lastBuiltApp = built;
            // Persist every build as a real, inspectable file (helpful, model-aware name) so the
            // model's output isn't lost: <appsDir>/versions/<id>-<model>.<n>.app.json + a history
            // row logging the score. Best-effort — a malformed build just won't save.
            const modelTag = (provider === 'phi' ? 'qwen15b' : provider === 'cli' ? 'claude' : 'claudeapi') + (ground ? '' : '-raw');
            void fetch('/api/app/snapshot', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ id: `${id}-${modelTag}`, app: built, prompt: `${provider} build · score ${(sc.score * 100).toFixed(0)}% vs golden` }),
            }).catch(() => {});
          }
          row.status = 'done';
          row.progress = '';
        } catch (e) {
          row.status = 'error';
          row.error = String((e as { message?: string })?.message ?? e);
        }
      }
    } finally {
      running = false;
    }
  }

  function downloadApp(row: AppRow): void {
    if (!row.lastBuiltApp) return;
    const blob = new Blob([JSON.stringify(row.lastBuiltApp, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${row.id}.built.app`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const providerLabel: Record<Provider, string> = {
    phi: 'Phi / Qwen2.5-1.5B (in-browser)',
    cli: 'Claude CLI (subscription)',
    cloud: 'Claude API (metered)',
  };
</script>

<div class="eval">
  <header class="hd">
    <div class="hd-l">
      <a class="back" href="/app_design">← Studio</a>
      <h1>App-build eval</h1>
      <span class="sub">reproduce goldens · score per-facet · no hand-driving</span>
    </div>
    <div class="ref">Claude CLI reference (incremental): plan {pct(CLAUDE_REF.plan)} · design {pct(CLAUDE_REF.design)} · ewell {pct(CLAUDE_REF.ewell)}</div>
  </header>

  <section class="ctrls">
    <label class="fld">
      <span>Provider</span>
      <select bind:value={provider} disabled={running}>
        <option value="phi">Phi / Qwen2.5-1.5B (in-browser)</option>
        <option value="cli">Claude CLI (subscription)</option>
        <option value="cloud">Claude API (metered)</option>
      </select>
    </label>
    <label class="fld">
      <span>App</span>
      <select bind:value={appSel} disabled={running}>
        <option value="all">all</option>
        {#each APP_IDS as id (id)}
          <option value={id}>{id}</option>
        {/each}
      </select>
    </label>
    <label class="fld">
      <span>Runs</span>
      <input type="number" min="1" max="10" bind:value={runsN} disabled={running} />
    </label>
    <label class="fld chk" title="RAG grounding: retrieved golden pairs + clean builds prepended to the prompt (phi fetches /api/app/ground; cli/cloud already ground server-side)">
      <span>RAG</span>
      <input type="checkbox" bind:checked={ground} disabled={running} />
    </label>
    <button class="run" onclick={runAll} disabled={running || (provider === 'phi' && !webgpuOk)}>
      {running ? 'Running…' : 'Run'}
    </button>

    {#if provider === 'phi'}
      <div class="phi">
        {#if !webgpuOk}
          <span class="warn">WebGPU unavailable — Phi needs Chrome/Edge desktop</span>
        {:else}
          <button class="load" onclick={loadPhiModel} disabled={phiLoaded || phiLoading || running}>
            {phiLoaded ? '✓ model ready' : phiLoading ? 'loading…' : 'Load model'}
          </button>
          {#if phiLoading || (phiText && !phiLoaded)}
            <div class="bar"><div class="bar-in" style="width:{Math.round(phiProgress * 100)}%"></div></div>
          {/if}
          {#if phiText}<span class="pt">{phiText}</span>{/if}
        {/if}
      </div>
    {:else}
      <span class="note">{providerLabel[provider]} — hits the {provider === 'cli' ? 'subscription' : 'metered'} path on each run.</span>
    {/if}
  </section>

  <section class="matrix">
    <table>
      <thead>
        <tr>
          <th class="app-h">App</th>
          <th>Overall</th>
          {#each FACETS as f (f)}
            <th>{FACET_LABEL[f]}</th>
          {/each}
          <th>Claude ref</th>
          <th class="st-h">Runs</th>
        </tr>
      </thead>
      <tbody>
        {#each rows as row (row.id)}
          {#if appSel === 'all' || appSel === row.id}
            <tr class="app-row" class:err={row.status === 'error'}>
              <td class="app-c">
                <button class="tgl" onclick={() => (row.expanded = !row.expanded)}>
                  <span class="caret">{row.expanded ? '▾' : '▸'}</span>{row.id}
                </button>
              </td>
              <td class="cell strong" style={heat(row.avg?.overall)}>{pct(row.avg?.overall)}</td>
              {#each FACETS as f (f)}
                <td class="cell" style={heat(row.avg ? row.avg[f] : null)}>{pct(row.avg ? row.avg[f] : null)}</td>
              {/each}
              <td class="cell ref-c">{pct(CLAUDE_REF[row.id])}</td>
              <td class="st">
                {#if row.status === 'running' || row.status === 'golden'}
                  <span class="spin">●</span> {row.progress || row.status}
                {:else if row.status === 'error'}
                  <span class="badge err">error</span>
                {:else if row.status === 'done'}
                  {row.runs.length}× {#if row.runs.length > 1}<span class="sig">σ {(stdev(row.runs) * 100).toFixed(1)}</span>{/if}
                {:else}
                  <span class="badge idle">idle</span>
                {/if}
              </td>
            </tr>
            {#if row.expanded}
              <tr class="detail-row">
                <td colspan={FACETS.length + 4}>
                  <div class="detail">
                    {#if row.error}<div class="derr">⚠ {row.error}</div>{/if}
                    {#if row.runs.length}
                      <div class="dline"><b>per-run overall:</b> {row.runs.map((r) => pct(r.score)).join(' · ')}{#if row.runs.length > 1} <span class="sig">(σ {(stdev(row.runs) * 100).toFixed(1)})</span>{/if}</div>
                    {/if}
                    {#if row.stepScores.length}
                      <div class="dline"><b>per-rung ({row.stepScores.length}):</b> <span class="curve">{row.stepScores.map((s) => pct(s)).join(' → ')}</span></div>
                    {/if}
                    <div class="cmp">
                      <div class="col">
                        <div class="ch">built kinds ({row.builtKinds.length})</div>
                        <div class="cv">{row.builtKinds.join(', ') || '—'}</div>
                      </div>
                      <div class="col">
                        <div class="ch">golden kinds ({row.goldenKinds.length})</div>
                        <div class="cv">{row.goldenKinds.join(', ') || '—'}</div>
                      </div>
                    </div>
                    <div class="cmp">
                      <div class="col">
                        <div class="ch">built vars / structures</div>
                        <div class="cv">{varsLine(row.builtVars, row.builtStructures)}</div>
                      </div>
                      <div class="col">
                        <div class="ch">golden vars / structures</div>
                        <div class="cv">{varsLine(row.goldenVars, row.goldenStructures)}</div>
                      </div>
                    </div>
                    {#if row.lastBuiltApp}
                      <button class="cap" onclick={() => downloadApp(row)}>⤓ capture built .app</button>
                    {/if}
                  </div>
                </td>
              </tr>
            {/if}
          {/if}
        {/each}
        {#if summary}
          <tr class="sum-row">
            <td class="app-c"><b>average ({scoredRows.length} app{scoredRows.length === 1 ? '' : 's'})</b></td>
            <td class="cell strong" style={heat(summary.overall)}>{pct(summary.overall)}</td>
            {#each FACETS as f (f)}
              <td class="cell" style={heat(summary[f])}>{pct(summary[f])}</td>
            {/each}
            <td class="cell ref-c"></td>
            <td class="st"></td>
          </tr>
        {/if}
      </tbody>
    </table>
    <p class="foot">
      Facets are weighted panelKinds .40 · nesting .20 · vars .15 · theme .10 · meta .08 · structures .07.
      Scoring is promotion-invariant (panel-id-keyed vars/structures are ignored). Phi runs entirely
      in the browser (free); CLI/API bill the subscription/metered path.
    </p>
  </section>
</div>

<style>
  .eval { position: fixed; inset: 0; overflow: auto; padding: 18px 22px 40px; font: 13px system-ui, Arial, sans-serif; color: #0f172a; background: #fff; }
  .hd { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; flex-wrap: wrap; border-bottom: 1px solid #e2e8f0; padding-bottom: 12px; }
  .hd-l { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
  .back { color: #7c3aed; text-decoration: none; font-weight: 600; }
  .back:hover { text-decoration: underline; }
  h1 { margin: 0; font-size: 18px; font-weight: 700; }
  .sub { color: #64748b; font-size: 12px; }
  .ref { color: #475569; font-size: 12px; }

  .ctrls { display: flex; align-items: flex-end; gap: 14px; flex-wrap: wrap; padding: 14px 0; }
  .fld { display: flex; flex-direction: column; gap: 4px; font: 600 11px system-ui; color: #475569; }
  .fld select, .fld input { padding: 6px 8px; border: 1px solid #cbd5e1; border-radius: 6px; font: 13px system-ui; color: #0f172a; background: #fff; }
  .fld input { width: 62px; }
  .fld.chk { align-items: flex-start; }
  .fld.chk input { width: auto; height: 16px; margin-top: 6px; }
  .run { padding: 8px 20px; border: 1px solid #7c3aed; border-radius: 8px; background: #7c3aed; color: #fff; font: 600 13px system-ui; cursor: pointer; }
  .run:disabled { opacity: 0.5; cursor: not-allowed; }
  .note { color: #64748b; font-size: 12px; align-self: center; }
  .warn { color: #b45309; font-size: 12px; align-self: center; }

  .phi { display: flex; align-items: center; gap: 10px; }
  .load { padding: 7px 14px; border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; font: 600 12px system-ui; cursor: pointer; }
  .load:disabled { opacity: 0.6; cursor: default; }
  .bar { width: 160px; height: 8px; border-radius: 5px; background: #e2e8f0; overflow: hidden; }
  .bar-in { height: 100%; background: #7c3aed; transition: width 0.2s; }
  .pt { color: #64748b; font-size: 11px; max-width: 320px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .matrix { margin-top: 8px; }
  table { border-collapse: collapse; width: 100%; }
  thead th { text-align: center; font: 600 11px system-ui; color: #475569; padding: 6px 8px; border-bottom: 2px solid #cbd5e1; white-space: nowrap; }
  th.app-h { text-align: left; }
  th.st-h { text-align: left; }
  .app-row td { border-bottom: 1px solid #eef2f7; padding: 5px 8px; }
  .app-row.err .app-c { color: #b91c1c; }
  .app-c { font-weight: 600; }
  .tgl { border: 0; background: none; font: 600 13px system-ui; color: #0f172a; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; padding: 2px 0; }
  .caret { color: #94a3b8; width: 12px; display: inline-block; }
  .cell { text-align: center; font-variant-numeric: tabular-nums; font-size: 12px; min-width: 62px; border-radius: 4px; }
  .cell.strong { font-weight: 700; }
  .ref-c { color: #64748b; background: #f8fafc; }
  .st { font-size: 11px; color: #475569; white-space: nowrap; }
  .spin { color: #7c3aed; animation: pulse 1s infinite; }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
  .sig { color: #94a3b8; }
  .badge { display: inline-block; padding: 1px 7px; border-radius: 10px; font: 600 10px system-ui; }
  .badge.idle { background: #f1f5f9; color: #94a3b8; }
  .badge.err { background: #fee2e2; color: #b91c1c; }

  .detail-row td { padding: 0; }
  .detail { background: #f8fafc; border: 1px solid #eef2f7; border-radius: 8px; margin: 2px 0 10px; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
  .derr { color: #b91c1c; font-size: 12px; }
  .dline { font-size: 12px; color: #334155; }
  .curve { font: 12px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; color: #475569; word-break: break-word; }
  .cmp { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .col { min-width: 0; }
  .ch { font: 600 10px system-ui; text-transform: uppercase; letter-spacing: 0.03em; color: #94a3b8; margin-bottom: 3px; }
  .cv { font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; color: #0f172a; word-break: break-word; }
  .cap { align-self: flex-start; padding: 5px 12px; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; font: 600 11px system-ui; cursor: pointer; }
  .cap:hover { background: #f1f5f9; }

  .sum-row td { border-top: 2px solid #cbd5e1; padding: 8px; }
  .foot { color: #94a3b8; font-size: 11px; margin-top: 14px; max-width: 900px; line-height: 1.6; }
</style>
