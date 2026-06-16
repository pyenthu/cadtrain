<!--
  /fem/[id]/tension — Stage 2 (Track B) 3D tension-test viewer.

  User dials axial F at each end of a tubular shaft and watches σ_vm
  + ΔL update live. The 3D viewer loads the primitive's GLB via
  /api/primitives/bake-preview, then:
    - colors every vertex by σ_vm (uniform across the body for
      uniaxial — same color everywhere — but plumbed as a per-vertex
      attribute so Stage 3's pure-JS FEA can drop in a non-uniform
      field via the same code path).
    - stretches the mesh along z by (1 + ε · scale) where `scale` is
      the deformation-amplification slider — the unloaded ε ≈ 0.001
      is invisible without help.

  Engine equations live in `$lib/fem/tension-stress-3d` (Rule 22).
-->
<script lang="ts">
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import {
    computeTensionStress,
    MATERIAL_GRADES,
    DEFAULT_YIELD_KSI,
    DEFAULT_E_PSI,
    stressColorRGB,
    viridisRGB,
    fmtNum,
    fmtStrain,
    TENSION_METHODS,
    type TensionResults,
  } from '$lib/fem/tension-stress-3d';
  import { stressColor } from '$lib/fem/closed-form-stress';

  let id = $derived(page.params.id);

  // ── Primitive load (source + meta) ────────────────────────────────
  let primSource = $state('');
  let primParams = $state<Record<string, { default?: number; label?: string; unit?: string }>>({});
  let loadStatus = $state<'loading' | 'ok' | 'error'>('loading');
  let loadError = $state('');

  // ── Inputs ────────────────────────────────────────────────────────
  let F_lbf = $state(50_000);          // 50 klbf — mid-range pull
  let OD_in = $state(4.5);
  let ID_in = $state(2.0);
  let L_in = $state(30);               // 30 in = 2.5 ft sample shaft
  let sigma_y_ksi = $state(DEFAULT_YIELD_KSI);
  let E_psi = $state(DEFAULT_E_PSI);

  // Visualization controls — amplify the imperceptible ε for display
  // (real ε at 25 ksi / 30 Msi ≈ 0.0008 → 0.024" over 30" — invisible
  // on a 30" shaft on screen). `viridis` toggles the LUT method.
  let deformScale = $state(100);
  let method = $state<string>('closed-form');
  let useViridis = $state(false);

  async function load(id: string) {
    loadStatus = 'loading';
    try {
      const r = await fetch(`/api/primitives/source?name=${encodeURIComponent(id)}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      primSource = data.source ?? '';
      primParams = data.params ?? {};
      // Auto-seed OD / ID / L from primitive defaults when available.
      const odKey = ['od', 'OD', 'd', 'D', 'diameter'].find((k) => primParams[k]?.default != null);
      const idKey = ['id', 'ID', 'bore'].find((k) => primParams[k]?.default != null);
      const lKey  = ['length', 'L', 'len', 'l'].find((k) => primParams[k]?.default != null);
      if (odKey) OD_in = Number(primParams[odKey]!.default!);
      if (idKey) ID_in = Number(primParams[idKey]!.default!);
      if (lKey)  L_in  = Number(primParams[lKey]!.default!);
      loadStatus = 'ok';
    } catch (e: any) {
      loadStatus = 'error';
      loadError = e?.message ?? String(e);
    }
  }

  onMount(() => { load(id); });
  $effect(() => { if (id) load(id); });

  // ── Live results ──────────────────────────────────────────────────
  let results = $derived<TensionResults>(computeTensionStress({
    F_lbf, OD_in, ID_in, L_in, sigma_y_ksi, E_psi,
  }));
  let stressFrac = $derived(Math.min(1.5, results.sigma_vm_ksi / Math.max(sigma_y_ksi, 1e-9)));

  // ── 3D viewer (lazy-imported so SSR-off pages don't choke) ───────
  // Threlte + Three pull in WebGL → must be client-side. We dynamically
  // import a sibling Scene module on mount; the bake-preview fetch
  // (which decodes the GLB) starts as soon as inputs are live.
  let TensionScene = $state<any>(null);
  let Canvas = $state<any>(null);
  let glbUrl = $state<string | null>(null);
  let glbStatus = $state<'idle' | 'building' | 'ok' | 'error'>('idle');
  let glbError = $state<string | null>(null);

  onMount(async () => {
    const [scene, threlte] = await Promise.all([
      import('./TensionScene.svelte'),
      import('@threlte/core'),
    ]);
    TensionScene = scene.default;
    Canvas = threlte.Canvas;
  });

  // Re-bake when primitive id / source / params change. The mesh
  // GEOMETRY only depends on the part — F + scale + grade re-apply on
  // top via the scene's vertex colors + z-scale. So we DON'T need to
  // re-fetch the GLB every time the user drags F.
  let bakePending: AbortController | null = null;
  async function rebake() {
    if (!primSource) return;
    glbStatus = 'building';
    glbError = null;
    bakePending?.abort();
    const ac = new AbortController();
    bakePending = ac;

    // Build a params record from the primitive's meta defaults (the
    // viewer wants the part rendered AT its design geometry — the
    // /fem/[id]/tension page treats OD/ID/L as separate analysis
    // inputs the user can override, but the 3D mesh is the part).
    const params: Record<string, number | string> = {};
    for (const [k, def] of Object.entries(primParams)) {
      if (def && def.default != null) params[k] = Number(def.default);
    }

    try {
      const r = await fetch('/api/primitives/bake-preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, name: id, source: primSource, params }),
        signal: ac.signal,
      });
      if (ac.signal.aborted) return;
      if (!r.ok) {
        glbError = `Bake failed (${r.status}): ${await r.text()}`;
        glbStatus = 'error';
        return;
      }
      const data = await r.json();
      // Convert base64 GLB → blob URL for GLTFLoader consumption.
      const b64 = data.full as string;
      if (!b64) {
        glbError = 'No GLB returned';
        glbStatus = 'error';
        return;
      }
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'model/gltf-binary' });
      if (glbUrl) URL.revokeObjectURL(glbUrl);
      glbUrl = URL.createObjectURL(blob);
      glbStatus = 'ok';
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      glbError = e?.message ?? String(e);
      glbStatus = 'error';
    }
  }

  $effect(() => {
    if (loadStatus === 'ok' && primSource) rebake();
  });

  // Pure stress + strain: the scene applies these directly.
  let vmColor = $derived(
    useViridis ? viridisRGB(stressFrac / 1.5) : stressColorRGB(results.sigma_vm_ksi, sigma_y_ksi)
  );
  // z-scale to apply to the GLB: `1 + ε · scale`. Tension stretches the
  // shaft along its length (Z-down convention — length runs along z).
  let zStretch = $derived(1 + results.epsilon * deformScale);
</script>

<svelte:head>
  <title>{id} tension — FEM / CAD Train</title>
</svelte:head>

<main class="ft-root">
  <header class="ft-head">
    <a href={`/fem/${encodeURIComponent(id)}`} class="ft-back">← {id}</a>
    <h1>{id} — 3D tension test</h1>
    <p class="ft-sub">
      Equal axial pull F at each end of the shaft. σ + ε visualized in 3D.
      <em>Stage 2 (Track B) — closed-form uniform σ; mesh re-colored live.</em>
    </p>
  </header>

  {#if loadStatus === 'loading'}
    <div class="ft-empty">Loading {id}…</div>
  {:else if loadStatus === 'error'}
    <div class="ft-err">Failed to load {id}: {loadError}</div>
  {:else}
    <section class="ft-grid">
      <!-- ── Left: inputs + results ──────────────────────────────── -->
      <div class="ft-card ft-inputs">
        <div class="ft-method">
          <label>
            <span>Method</span>
            <select bind:value={method}>
              {#each TENSION_METHODS as m (m.id)}
                <option value={m.id} disabled={m.status === 'pending'}>{m.label}</option>
              {/each}
            </select>
          </label>
        </div>

        <h2>Load</h2>
        <label>
          <span>Axial F (lbf) — each end</span>
          <input type="number" bind:value={F_lbf} step="1000">
        </label>
        <input type="range" class="ft-slider" min="0" max="500000" step="1000" bind:value={F_lbf}>

        <h2 class="ft-h2-spaced">Section</h2>
        <label><span>OD (in)</span><input type="number" bind:value={OD_in} step="0.125" min="0.5"></label>
        <label><span>ID (in)</span><input type="number" bind:value={ID_in} step="0.125" min="0"></label>
        <label><span>L (in)</span><input type="number" bind:value={L_in} step="1" min="1"></label>

        <h2 class="ft-h2-spaced">Material</h2>
        <label>
          <span>Grade</span>
          <select bind:value={sigma_y_ksi}>
            {#each MATERIAL_GRADES as g (g.id)}
              <option value={g.yield_ksi}>{g.label} (σ_y = {g.yield_ksi} ksi)</option>
            {/each}
          </select>
        </label>
        <label>
          <span>E (Msi)</span>
          <input type="number" bind:value={E_psi} step="100000" min="1000000">
        </label>

        <h2 class="ft-h2-spaced">Visualization</h2>
        <label>
          <span>Deformation × {deformScale}</span>
          <input type="range" min="1" max="1000" step="1" bind:value={deformScale}>
        </label>
        <label class="ft-checkbox">
          <input type="checkbox" bind:checked={useViridis}>
          <span>Viridis gradient (vs traffic-light)</span>
        </label>

        <h2 class="ft-h2-spaced">Results</h2>
        <table class="ft-results">
          <tbody>
            <tr><th>A</th><td>{fmtNum(results.A_in2, 3)} in²</td></tr>
            <tr><th>σ axial</th><td>{fmtNum(results.sigma_a_ksi)} ksi</td></tr>
            <tr><th>ε axial</th><td>{fmtStrain(results.epsilon)} {Math.abs(results.epsilon) < 0.01 && results.epsilon !== 0 ? 'µε' : 'in/in'}</td></tr>
            <tr><th>ΔL</th><td>{fmtNum(results.deltaL_in, 4)} in</td></tr>
            <tr><th>L'</th><td>{fmtNum(results.L_prime_in, 3)} in</td></tr>
            <tr>
              <th>σ vm</th>
              <td style="color: {stressColor(results.sigma_vm_ksi, sigma_y_ksi)}; font-weight: 700;">
                {fmtNum(results.sigma_vm_ksi)} ksi
              </td>
            </tr>
            <tr><th>SF</th><td>{fmtNum(results.safety_factor, 2)}</td></tr>
            <tr>
              <th>Verdict</th>
              <td>
                <span class="ft-verdict ft-verdict-{results.verdict.toLowerCase()}">{results.verdict}</span>
              </td>
            </tr>
          </tbody>
        </table>

        <!-- Stress bar (same idiom as /fem/[id]). -->
        <div class="ft-bar">
          <div class="ft-bar-fill"
               style="width: {Math.min(100, (stressFrac / 1.5) * 100)}%;
                      background: {stressColor(results.sigma_vm_ksi, sigma_y_ksi)};"></div>
          <div class="ft-bar-tick"></div>
        </div>
        <div class="ft-bar-labels"><span>0</span><span>σ_y</span><span>1.5×</span></div>
      </div>

      <!-- ── Right: 3D viewer ──────────────────────────────────────── -->
      <div class="ft-card ft-viewer">
        <div class="ft-viewer-head">
          <span class="ft-viewer-status ft-status-{glbStatus}">
            {glbStatus === 'building' ? 'baking GLB…'
             : glbStatus === 'ok' ? 'ready'
             : glbStatus === 'error' ? 'error'
             : 'idle'}
          </span>
          <span class="ft-viewer-meta">σ_vm uniform — every vertex same color</span>
        </div>
        <div class="ft-stage">
          {#if glbError}
            <div class="ft-stage-err">{glbError}</div>
          {:else if Canvas && TensionScene && glbUrl}
            {@const TCanvas = Canvas}
            {@const TScene = TensionScene}
            <TCanvas>
              <TScene
                url={glbUrl}
                zStretch={zStretch}
                color={vmColor}
              />
            </TCanvas>
            <div class="ft-stage-overlay">
              <div class="ft-overlay-row">
                <span>F</span><strong>{(F_lbf/1000).toFixed(1)} klbf</strong>
              </div>
              <div class="ft-overlay-row">
                <span>σ_vm</span>
                <strong style="color: {stressColor(results.sigma_vm_ksi, sigma_y_ksi)}">
                  {fmtNum(results.sigma_vm_ksi)} ksi
                </strong>
              </div>
              <div class="ft-overlay-row">
                <span>ε</span><strong>{fmtStrain(results.epsilon)} {Math.abs(results.epsilon) < 0.01 && results.epsilon !== 0 ? 'µε' : ''}</strong>
              </div>
              <div class="ft-overlay-row">
                <span>z-stretch</span><strong>{zStretch.toFixed(4)}×</strong>
              </div>
            </div>
          {:else}
            <div class="ft-stage-loading">{glbStatus === 'building' ? 'baking GLB…' : 'loading 3D viewer…'}</div>
          {/if}
        </div>
        <footer class="ft-viewer-foot">
          ← F &nbsp; ◯═══════════◯ &nbsp; F →
          &nbsp; tension; equal pull both ends; uniform σ
        </footer>
      </div>
    </section>
  {/if}

  <footer class="ft-footer">
    Stage 2 (Track B) — closed-form uniform σ rendered in 3D. Future
    methods plug in via the Method dropdown. See
    <code>src/lib/fem/FEM.md</code>.
  </footer>
</main>

<style>
  .ft-root {
    max-width: 1280px; margin: 0 auto; padding: 24px 16px;
    font: 14px ui-sans-serif, system-ui, sans-serif; color: #222;
  }
  .ft-head { margin-bottom: 16px; }
  .ft-back {
    font: 600 12px ui-sans-serif; color: #1e40af; text-decoration: none;
    display: inline-block; padding: 2px 0;
  }
  .ft-back:hover { text-decoration: underline; }
  .ft-head h1 {
    font: 700 22px ui-monospace, SFMono-Regular, Menlo, monospace;
    margin: 4px 0 6px; color: #0c2e6e;
  }
  .ft-sub { color: #555; line-height: 1.5; margin: 0; }
  .ft-sub em { color: #777; font-style: italic; }

  .ft-empty, .ft-err {
    padding: 24px; text-align: center; color: #777; font-style: italic;
    border: 1px dashed #ddd; border-radius: 8px;
  }
  .ft-err { color: #b91c1c; border-color: #fda4af; }

  .ft-grid {
    display: grid;
    grid-template-columns: 320px 1fr;
    gap: 16px;
  }
  @media (max-width: 860px) {
    .ft-grid { grid-template-columns: 1fr; }
  }

  .ft-card {
    background: #fff; border: 1px solid #ddd; border-radius: 8px;
    padding: 14px;
  }
  .ft-card h2 {
    font: 600 11px ui-sans-serif; color: #333; margin: 0 0 8px;
    text-transform: uppercase; letter-spacing: 0.04em;
  }
  .ft-card h2.ft-h2-spaced { margin-top: 16px; }

  .ft-method {
    margin-bottom: 12px; padding-bottom: 12px;
    border-bottom: 1px solid #eee;
  }
  .ft-method label { display: flex; gap: 8px; align-items: center; }
  .ft-method select {
    flex: 1; padding: 4px 8px; border: 1px solid #ccc; border-radius: 4px;
    font: 12px ui-sans-serif;
  }

  .ft-inputs label {
    display: grid; grid-template-columns: 1fr auto; gap: 8px;
    align-items: center; margin: 6px 0;
  }
  .ft-inputs label > span:first-child {
    font: 12px ui-sans-serif; color: #444;
  }
  .ft-inputs input[type="number"], .ft-inputs select {
    width: 110px; padding: 4px 8px;
    border: 1px solid #ccc; border-radius: 4px;
    font: 12px ui-monospace, SFMono-Regular, Menlo, monospace;
    text-align: right;
  }
  .ft-inputs select { width: 160px; text-align: left; }
  .ft-slider {
    width: 100%; margin: 0 0 6px;
  }
  .ft-inputs input[type="range"] { width: 110px; }
  .ft-checkbox {
    grid-template-columns: auto 1fr !important;
  }
  .ft-checkbox input[type="checkbox"] { width: auto !important; }

  .ft-results { width: 100%; border-collapse: collapse; margin-top: 4px; }
  .ft-results th {
    text-align: left; font: 11px ui-sans-serif; color: #777;
    padding: 4px 4px 4px 0; font-weight: 400; vertical-align: top;
  }
  .ft-results td {
    text-align: right; padding: 4px 0;
    font: 13px ui-monospace, SFMono-Regular, Menlo, monospace;
    color: #222;
  }
  .ft-verdict {
    padding: 2px 8px; border-radius: 4px;
    font: 700 11px ui-sans-serif; text-transform: uppercase; letter-spacing: 0.04em;
  }
  .ft-verdict-ok       { background: #d1fae5; color: #065f46; }
  .ft-verdict-marginal { background: #fef3c7; color: #92400e; }
  .ft-verdict-yields   { background: #fee2e2; color: #991b1b; }

  .ft-bar {
    position: relative; height: 14px; background: #eee;
    border-radius: 7px; overflow: hidden; margin: 12px 0 4px;
  }
  .ft-bar-fill { height: 100%; transition: width 100ms, background 100ms; }
  .ft-bar-tick {
    position: absolute; top: 0; left: 66.66%;
    width: 2px; height: 100%; background: #444;
  }
  .ft-bar-labels {
    display: flex; justify-content: space-between;
    font: 10px ui-monospace, SFMono-Regular, Menlo, monospace; color: #888;
  }

  .ft-viewer {
    display: flex; flex-direction: column; min-height: 600px;
    padding: 0;
  }
  .ft-viewer-head {
    display: flex; justify-content: space-between; align-items: center;
    padding: 8px 14px; border-bottom: 1px solid #eee;
    font: 11px ui-sans-serif; color: #555;
  }
  .ft-viewer-status {
    padding: 2px 8px; border-radius: 4px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.04em;
  }
  .ft-status-building { background: #fef3c7; color: #92400e; }
  .ft-status-ok       { background: #d1fae5; color: #065f46; }
  .ft-status-error    { background: #fee2e2; color: #991b1b; }
  .ft-status-idle     { background: #f0f0f5; color: #555; }
  .ft-viewer-meta { font-style: italic; color: #888; }

  .ft-stage {
    position: relative;
    flex: 1; min-height: 520px;
    background: #1a1a1a;
  }
  .ft-stage-loading, .ft-stage-err {
    position: absolute; inset: 0;
    display: flex; align-items: center; justify-content: center;
    color: #aaa; padding: 14px; text-align: center;
    font: 12px ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .ft-stage-err { color: #ff8888; }
  .ft-stage-overlay {
    position: absolute; top: 10px; right: 10px;
    background: rgba(0,0,0,0.6); color: #fff;
    padding: 8px 12px; border-radius: 6px;
    display: flex; flex-direction: column; gap: 4px;
    font: 12px ui-monospace, SFMono-Regular, Menlo, monospace;
    pointer-events: none;
  }
  .ft-overlay-row {
    display: flex; justify-content: space-between; gap: 16px;
  }
  .ft-overlay-row span { opacity: 0.7; }

  .ft-viewer-foot {
    padding: 8px 14px; border-top: 1px solid #eee;
    font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; color: #888;
    background: #fafafa;
  }

  .ft-footer {
    margin-top: 16px; padding: 12px; text-align: center;
    background: #fafafa; border: 1px dashed #ddd; border-radius: 6px;
    font: 11px ui-sans-serif; color: #888;
  }
  .ft-footer code {
    background: #f0f0f5; padding: 1px 4px; border-radius: 3px;
    font: 11px ui-monospace, SFMono-Regular, Menlo, monospace;
  }
</style>
