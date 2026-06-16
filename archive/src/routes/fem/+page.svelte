<!--
  /fem — Stage 1 FEM landing page.

  Lists all drill-pipe primitives on the volume + links to the
  per-primitive stress page. Stage 1 ships closed-form analytical
  stress only — no mesh, no solver. Future stages (per docs/research/
  FEM.md): pure-JS linear FEA, WASM tet meshing + linear solver,
  CalculiX server-side subprocess.
-->
<script lang="ts">
  import { onMount } from 'svelte';

  interface PrimEntry {
    id: string;
    path: string;
    origin: string;
    kind?: string;
    tags?: string[];
    params?: Record<string, { default?: number; label?: string; unit?: string }>;
  }

  let entries = $state<PrimEntry[]>([]);
  let status = $state<'loading' | 'ok' | 'error'>('loading');
  let error = $state('');

  onMount(async () => {
    try {
      const r = await fetch('/api/primitives/list');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      // Filter: anything tagged drill-pipe OR sitting under completions/drill_pipe/.
      // We surface the candidate set; Stage 1 stress applies to any tubular section.
      const all: PrimEntry[] = data.entries ?? [];
      entries = all.filter((e) =>
        (e.tags ?? []).some((t) => /drill|pipe|joint|tubing/i.test(t))
        || /drill[_-]?pipe|tubing|joint/i.test(e.path ?? '')
        || /^dp_|^t_|^drill/i.test(e.id)
      );
      // Sort by id for stable layout.
      entries.sort((a, b) => a.id.localeCompare(b.id));
      status = 'ok';
    } catch (e: any) {
      status = 'error';
      error = e?.message ?? String(e);
    }
  });

  function paramValue(p: PrimEntry, key: string): string {
    const v = p.params?.[key]?.default;
    if (v == null) return '—';
    const unit = p.params?.[key]?.unit ?? '';
    return `${v}${unit ? ` ${unit}` : ''}`;
  }
</script>

<svelte:head>
  <title>FEM — CAD Train</title>
</svelte:head>

<main class="fem-root">
  <header class="fem-head">
    <h1>FEM — Stress Analysis</h1>
    <p class="fem-sub">
      Stage 1: closed-form section stress for tubular drill-pipe primitives.
      Future stages bring full FEA. See
      <a href="/plan">/plan</a> + <code>docs/research/FEM.md</code>.
    </p>
  </header>

  {#if status === 'loading'}
    <div class="fem-empty">Loading drill-pipe primitives…</div>
  {:else if status === 'error'}
    <div class="fem-err">Failed to load: {error}</div>
  {:else if entries.length === 0}
    <div class="fem-empty">
      No drill-pipe primitives found on the volume. Stage 1 stress applies to any
      tubular cross-section — tag a primitive with <code>drill-pipe</code> or
      <code>tubing</code> to surface it here.
    </div>
  {:else}
    <ul class="fem-list">
      {#each entries as e (e.id)}
        <li class="fem-item">
          <a href={`/fem/${encodeURIComponent(e.id)}`} class="fem-link">
            <span class="fem-id">{e.id}</span>
            <span class="fem-meta">
              OD {paramValue(e, 'od') !== '—' ? paramValue(e, 'od') : paramValue(e, 'OD')}
              · ID {paramValue(e, 'id') !== '—' ? paramValue(e, 'id') : paramValue(e, 'ID')}
              · L {paramValue(e, 'length')}
            </span>
            <span class="fem-origin {e.origin}">{e.origin}</span>
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</main>

<style>
  .fem-root {
    max-width: 820px; margin: 0 auto; padding: 24px 16px;
    font: 14px ui-sans-serif, system-ui, sans-serif; color: #222;
  }
  .fem-head { margin-bottom: 16px; }
  .fem-head h1 { font: 700 22px ui-sans-serif; margin: 0 0 4px; color: #0c2e6e; }
  .fem-sub { color: #555; line-height: 1.5; margin: 0; }
  .fem-sub a { color: #1e40af; }
  .fem-sub code {
    background: #f5f5f5; padding: 1px 4px; border-radius: 3px;
    font: 12px ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .fem-empty, .fem-err {
    padding: 24px; text-align: center; color: #777; font-style: italic;
    border: 1px dashed #ddd; border-radius: 8px;
  }
  .fem-err { color: #b91c1c; border-color: #fda4af; }
  .fem-list { list-style: none; padding: 0; margin: 0; }
  .fem-item { margin: 6px 0; }
  .fem-link {
    display: grid; grid-template-columns: 1fr auto auto; gap: 12px;
    align-items: center;
    padding: 10px 14px; border: 1px solid #ddd; border-radius: 6px;
    background: #fff; text-decoration: none; color: inherit;
    transition: border-color 80ms, box-shadow 80ms;
  }
  .fem-link:hover { border-color: #1e40af; box-shadow: 0 1px 4px rgba(30,64,175,0.12); }
  .fem-id { font: 600 14px ui-monospace, SFMono-Regular, Menlo, monospace; color: #0c2e6e; }
  .fem-meta {
    font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; color: #555;
  }
  .fem-origin {
    font: 600 10px ui-sans-serif; padding: 2px 6px; border-radius: 8px;
    background: #f0f0f5; color: #555; text-transform: lowercase;
  }
  .fem-origin.stdlib { background: #dbeafe; color: #1e3a8a; }
  .fem-origin.volume { background: #fef3c7; color: #92400e; }
</style>
