<!--
  /fem/[id] — per-primitive stress analysis page.

  Loads the primitive's params from /api/primitives/source, lets the
  user dial axial load + torque + bending + material, and shows the
  closed-form section stress live. Stage 1 — no mesh, no solver.
-->
<script lang="ts">
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import {
    computeStress, MATERIAL_GRADES, DEFAULT_YIELD_KSI,
    stressColor, fmtNum,
    type StressInputs, type StressResults,
  } from '$lib/fem/closed-form-stress';

  let id = $derived(page.params.id);

  // Primitive data — loaded once on mount per id.
  let primName = $state('');
  let primTags = $state<string[]>([]);
  let primParams = $state<Record<string, { default?: number; label?: string; unit?: string }>>({});
  let loadStatus = $state<'loading' | 'ok' | 'error'>('loading');
  let loadError = $state('');

  // Stage 1 inputs (user-editable).
  let F_lbf = $state(0);
  let T_ftlbf = $state(0);
  let M_ftlbf = $state(0);
  let sigma_y_ksi = $state(DEFAULT_YIELD_KSI);
  let OD_in = $state(4.5);
  let ID_in = $state(2.0);

  async function load(id: string) {
    loadStatus = 'loading';
    try {
      const r = await fetch(`/api/primitives/source?name=${encodeURIComponent(id)}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      primName = data.name ?? id;
      primTags = data.tags ?? [];
      primParams = data.params ?? {};
      // Auto-seed OD/ID from the primitive's defaults when present (any of
      // od/OD/D/diameter; id/ID/bore).
      const odKey = ['od', 'OD', 'd', 'D', 'diameter'].find((k) => primParams[k]?.default != null);
      const idKey = ['id', 'ID', 'bore'].find((k) => primParams[k]?.default != null);
      if (odKey) OD_in = Number(primParams[odKey]!.default!);
      if (idKey) ID_in = Number(primParams[idKey]!.default!);
      loadStatus = 'ok';
    } catch (e: any) {
      loadStatus = 'error';
      loadError = e?.message ?? String(e);
    }
  }

  onMount(() => { load(id); });
  // Reload when id changes (route navigation between primitives).
  $effect(() => { if (id) load(id); });

  // Live results — recompute on every input change.
  let results = $derived<StressResults>(computeStress({
    F_lbf, T_ftlbf, M_ftlbf, sigma_y_ksi, OD_in, ID_in,
  }));

  // Fraction of yield (0..1+) for the stress bar.
  let stressFrac = $derived(Math.min(1.5, results.sigma_vm_ksi / Math.max(sigma_y_ksi, 1e-9)));
</script>

<svelte:head>
  <title>{id} — FEM / CAD Train</title>
</svelte:head>

<main class="fem-id-root">
  <header class="fem-id-head">
    <a href="/fem" class="fem-back">← FEM</a>
    <h1>{id}</h1>
    {#if primTags.length > 0}
      <div class="fem-tags">
        {#each primTags as t (t)}<span class="fem-tag">{t}</span>{/each}
      </div>
    {/if}
  </header>

  {#if loadStatus === 'loading'}
    <div class="fem-empty">Loading {id}…</div>
  {:else if loadStatus === 'error'}
    <div class="fem-err">Failed to load {id}: {loadError}</div>
  {:else}
    <section class="fem-grid">
      <!-- ── Inputs ────────────────────────────────────────────── -->
      <div class="fem-card fem-inputs">
        <h2>Loads</h2>
        <label>
          <span>Axial F (lbf)</span>
          <input type="number" bind:value={F_lbf} step="1000">
        </label>
        <label>
          <span>Torque T (ft-lbf)</span>
          <input type="number" bind:value={T_ftlbf} step="100">
        </label>
        <label>
          <span>Bending M (ft-lbf)</span>
          <input type="number" bind:value={M_ftlbf} step="100">
        </label>
        <h2 class="fem-h2-spaced">Section</h2>
        <label>
          <span>OD (in)</span>
          <input type="number" bind:value={OD_in} step="0.125" min="0.5">
        </label>
        <label>
          <span>ID (in)</span>
          <input type="number" bind:value={ID_in} step="0.125" min="0">
        </label>
        <h2 class="fem-h2-spaced">Material</h2>
        <label>
          <span>Grade</span>
          <select bind:value={sigma_y_ksi}>
            {#each MATERIAL_GRADES as g (g.id)}
              <option value={g.yield_ksi}>{g.label} (σ_y = {g.yield_ksi} ksi)</option>
            {/each}
          </select>
        </label>
      </div>

      <!-- ── Results ───────────────────────────────────────────── -->
      <div class="fem-card fem-results">
        <h2>Section properties</h2>
        <div class="fem-stat-row">
          <div class="fem-stat"><span class="fem-stat-lbl">A</span><span class="fem-stat-val">{fmtNum(results.A_in2, 3)} in²</span></div>
          <div class="fem-stat"><span class="fem-stat-lbl">I</span><span class="fem-stat-val">{fmtNum(results.I_in4, 3)} in⁴</span></div>
          <div class="fem-stat"><span class="fem-stat-lbl">J</span><span class="fem-stat-val">{fmtNum(results.J_in4, 3)} in⁴</span></div>
        </div>

        <h2 class="fem-h2-spaced">Stresses (ksi)</h2>
        <div class="fem-stat-row">
          <div class="fem-stat"><span class="fem-stat-lbl">σ axial</span><span class="fem-stat-val">{fmtNum(results.sigma_a_ksi)}</span></div>
          <div class="fem-stat"><span class="fem-stat-lbl">σ bending</span><span class="fem-stat-val">{fmtNum(results.sigma_b_ksi)}</span></div>
          <div class="fem-stat"><span class="fem-stat-lbl">τ torsion</span><span class="fem-stat-val">{fmtNum(results.tau_ksi)}</span></div>
        </div>

        <h2 class="fem-h2-spaced">Von Mises + safety</h2>
        <div class="fem-vm-row">
          <span class="fem-vm-lbl">σ vm</span>
          <span class="fem-vm-val" style="color: {stressColor(results.sigma_vm_ksi, sigma_y_ksi)}">
            {fmtNum(results.sigma_vm_ksi)} ksi
          </span>
          <span class="fem-vm-sep">/</span>
          <span class="fem-vm-yield">σ_y {sigma_y_ksi} ksi</span>
        </div>

        <!-- Stress bar — fills proportional to σ_vm / σ_y. Soft maximum at 1.5×. -->
        <div class="fem-bar">
          <div class="fem-bar-fill"
               style="width: {Math.min(100, (stressFrac / 1.5) * 100)}%;
                      background: {stressColor(results.sigma_vm_ksi, sigma_y_ksi)};"></div>
          <div class="fem-bar-tick fem-bar-tick-yield"></div>
        </div>
        <div class="fem-bar-labels">
          <span>0</span>
          <span class="fem-bar-yield-label">σ_y</span>
          <span>1.5×</span>
        </div>

        <div class="fem-verdict-row">
          <div class="fem-sf">
            <span class="fem-sf-lbl">Safety factor</span>
            <span class="fem-sf-val">{fmtNum(results.safety_factor, 2)}</span>
          </div>
          <div class="fem-verdict fem-verdict-{results.verdict.toLowerCase()}">
            {results.verdict}
          </div>
        </div>
        <p class="fem-spec">
          API 5C3 / 7-2 design check: SF ≥ 1.5 OK, 1.0 ≤ SF &lt; 1.5 Marginal,
          SF &lt; 1.0 Yields.
        </p>
      </div>
    </section>
  {/if}

  <footer class="fem-footer">
    Stage 1 — closed-form analytical. No mesh, no FEA solver.
    Future stages: pure-JS linear FEA → WASM tet meshing → server-side
    CalculiX. See <code>docs/research/FEM.md</code>.
  </footer>
</main>

<style>
  .fem-id-root {
    max-width: 980px; margin: 0 auto; padding: 24px 16px;
    font: 14px ui-sans-serif, system-ui, sans-serif; color: #222;
  }
  .fem-id-head { margin-bottom: 16px; }
  .fem-back {
    font: 600 12px ui-sans-serif; color: #1e40af; text-decoration: none;
    display: inline-block; padding: 2px 0;
  }
  .fem-back:hover { text-decoration: underline; }
  .fem-id-head h1 {
    font: 700 22px ui-monospace, SFMono-Regular, Menlo, monospace;
    margin: 4px 0 6px; color: #0c2e6e;
  }
  .fem-tags { display: flex; gap: 4px; flex-wrap: wrap; }
  .fem-tag {
    background: #f0f0f5; color: #555;
    font: 11px ui-monospace; padding: 2px 6px; border-radius: 6px;
  }
  .fem-empty, .fem-err {
    padding: 24px; text-align: center; color: #777; font-style: italic;
    border: 1px dashed #ddd; border-radius: 8px;
  }
  .fem-err { color: #b91c1c; border-color: #fda4af; }

  .fem-grid {
    display: grid;
    grid-template-columns: 280px 1fr;
    gap: 16px;
  }
  @media (max-width: 720px) {
    .fem-grid { grid-template-columns: 1fr; }
  }

  .fem-card {
    background: #fff; border: 1px solid #ddd; border-radius: 8px;
    padding: 14px;
  }
  .fem-card h2 {
    font: 600 12px ui-sans-serif; color: #333; margin: 0 0 8px;
    text-transform: uppercase; letter-spacing: 0.04em;
  }
  .fem-card h2.fem-h2-spaced { margin-top: 16px; }

  .fem-inputs label {
    display: grid; grid-template-columns: 1fr auto; gap: 8px;
    align-items: center; margin: 6px 0;
  }
  .fem-inputs label > span:first-child {
    font: 13px ui-sans-serif; color: #444;
  }
  .fem-inputs input[type="number"], .fem-inputs select {
    width: 110px; padding: 4px 8px;
    border: 1px solid #ccc; border-radius: 4px;
    font: 13px ui-monospace, SFMono-Regular, Menlo, monospace;
    text-align: right;
  }
  .fem-inputs select { width: 180px; text-align: left; }

  .fem-stat-row {
    display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px;
    margin-bottom: 4px;
  }
  .fem-stat {
    display: flex; flex-direction: column;
    padding: 6px 8px; background: #fafafa; border-radius: 4px;
  }
  .fem-stat-lbl { font: 10px ui-sans-serif; color: #888; text-transform: uppercase; }
  .fem-stat-val {
    font: 600 13px ui-monospace, SFMono-Regular, Menlo, monospace;
    color: #222;
  }

  .fem-vm-row {
    display: flex; align-items: baseline; gap: 8px;
    padding: 8px; background: #fafafa; border-radius: 4px;
    margin-bottom: 8px;
  }
  .fem-vm-lbl { font: 11px ui-sans-serif; color: #888; }
  .fem-vm-val {
    font: 700 18px ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .fem-vm-sep { color: #888; }
  .fem-vm-yield {
    font: 13px ui-monospace, SFMono-Regular, Menlo, monospace;
    color: #555;
  }

  .fem-bar {
    position: relative; height: 18px; background: #eee;
    border-radius: 9px; overflow: hidden; margin: 8px 0 4px;
  }
  .fem-bar-fill {
    height: 100%; transition: width 100ms, background 100ms;
  }
  .fem-bar-tick-yield {
    position: absolute; top: 0; left: 66.66%;
    width: 2px; height: 100%; background: #444;
  }
  .fem-bar-labels {
    display: flex; justify-content: space-between;
    font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; color: #888;
  }
  .fem-bar-yield-label {
    /* Position so it visually aligns with the yield tick (66.66% from left).
     * Flex space-between leaves us 3 items so the middle item naturally
     * centers — close enough for a label. */
    color: #444;
  }

  .fem-verdict-row {
    display: flex; align-items: center; justify-content: space-between;
    margin-top: 12px; padding-top: 12px; border-top: 1px solid #eee;
  }
  .fem-sf { display: flex; flex-direction: column; gap: 2px; }
  .fem-sf-lbl { font: 11px ui-sans-serif; color: #888; }
  .fem-sf-val {
    font: 700 20px ui-monospace, SFMono-Regular, Menlo, monospace;
    color: #222;
  }
  .fem-verdict {
    padding: 6px 14px; border-radius: 6px;
    font: 700 13px ui-sans-serif; letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .fem-verdict-ok       { background: #d1fae5; color: #065f46; }
  .fem-verdict-marginal { background: #fef3c7; color: #92400e; }
  .fem-verdict-yields   { background: #fee2e2; color: #991b1b; }

  .fem-spec {
    font: 11px ui-sans-serif; color: #888; margin: 8px 0 0;
    font-style: italic;
  }

  .fem-footer {
    margin-top: 16px; padding: 12px; text-align: center;
    background: #fafafa; border: 1px dashed #ddd; border-radius: 6px;
    font: 11px ui-sans-serif; color: #888;
  }
  .fem-footer code {
    background: #f0f0f5; padding: 1px 4px; border-radius: 3px;
    font: 11px ui-monospace, SFMono-Regular, Menlo, monospace;
  }
</style>
