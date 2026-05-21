<script lang="ts">
  // TEMPORARY demo viewer for the primitive-recipe slice (dual-control).
  // Renders ONE embedded recipe (the t_bolt_hexhead worked example) via
  // /api/primitives/recipe-preview, with a slider per composite param so
  // you can watch the params drive the leaves (drag shaft_len → the hex
  // head follows the shaft top, via the cross-param mv expression).
  //
  // This is NOT the Builder UI (step 3) — it's self-contained (its own
  // fetch + scene mount, no shared-component edits) so it's safe to
  // delete once the real /primitives recipe path lands.
  // See docs/PRIMITIVE_RECIPE.md.
  import { onMount } from 'svelte';
  import { Canvas } from '@threlte/core';
  import { WebGLRenderer } from 'three';
  import { deserializeComponentResult } from '$lib/cad/mesh-serial';
  import { scene } from '$lib/shared/scene-state.svelte';

  // The worked example (mirrors docs/examples/t_bolt_hexhead.recipe.json).
  const recipe = {
    meta: {
      id: 't_bolt_hexhead_r',
      name: 't_bolt_hexhead (recipe)',
      description: 'Round shaft (r_cylinder) + hex head (r_extrude). Composite params drive both; the head placement cross-references shaft_len.',
      params: {
        shaft_od:   { label: 'shaft OD',   min: 0.5, max: 4, step: 0.1, default: 1.6 },
        shaft_len:  { label: 'shaft len',  min: 1,   max: 8, step: 0.1, default: 4.5 },
        head_thick: { label: 'head thick', min: 0.4, max: 3, step: 0.1, default: 1.3 },
      },
      material: { outer: { color: '#6f8a7d', metallic: 0.6, roughness: 0.4 }, inner: { color: '#3a3a3a', metallic: 0.1, roughness: 0.9 } },
    },
    instances: [
      { name: 'A', call: 'r_cylinder', args: { od: { expr: 'p.shaft_od' }, length: { expr: 'p.shaft_len' }, segments: { lit: 64 } } },
      { name: 'B', call: 'r_extrude',
        args: { profile: { val: [[1.6,0],[0.8,1.3856],[-0.8,1.3856],[-1.6,0],[-0.8,-1.3856],[0.8,-1.3856]] }, height: { expr: 'p.head_thick' } },
        transforms: [ { op: 'mv', args: [ { lit: 0 }, { lit: 0 }, { expr: '-(p.shaft_len / 2) - p.head_thick' } ] } ] },
    ],
    composition: [ { op: 'add', of: 'A' }, { op: 'add', of: 'B' } ],
  };

  let params = $state<Record<string, number>>(
    Object.fromEntries(Object.entries(recipe.meta.params).map(([k, v]) => [k, v.default])),
  );

  let SceneComponent = $state<any>(null);
  let SceneControls = $state<any>(null);
  let geo = $state<any>(null);
  let geoVersion = $state(0);
  let status = $state('idle');
  let error = $state<string | null>(null);

  function createRenderer(canvas: HTMLCanvasElement) {
    return new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  }

  let pending: AbortController | null = null;
  async function rebuild() {
    status = 'building'; error = null;
    pending?.abort();
    const ac = new AbortController(); pending = ac;
    try {
      const r = await fetch('/api/primitives/recipe-preview', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ recipe, params }), signal: ac.signal,
      });
      if (ac.signal.aborted) return;
      if (!r.ok) { error = `${r.status}: ${await r.text()}`; status = 'error'; return; }
      const data = await r.json();
      geo = deserializeComponentResult({ full: data.full, cutVC: data.cutVC });
      geoVersion++; status = 'ok';
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      error = e?.message ?? String(e); status = 'error';
    }
  }

  onMount(async () => {
    const [scn, ctl] = await Promise.all([
      import('$lib/shared/ComponentScene.svelte'),
      import('$lib/shared/SceneControls.svelte'),
    ]);
    SceneComponent = scn.default; SceneControls = ctl.default;
    rebuild();
  });

  function setParam(k: string, v: number) { params = { ...params, [k]: v }; rebuild(); }
</script>

<div class="rt-root">
  <aside class="rt-side">
    <h1>{recipe.meta.name}</h1>
    <p class="rt-desc">{recipe.meta.description}</p>
    <p class="rt-note">Demo viewer for the primitive-recipe slice — drag a slider and watch the composite params drive the <code>r_cylinder</code> + <code>r_extrude</code> leaves. <a href="/primitives">/primitives</a> is the real route (recipe Builder pending).</p>
    {#each Object.entries(recipe.meta.params) as [k, v] (k)}
      <label class="rt-param">
        <span class="rt-plabel">{v.label}<em>{params[k]}</em></span>
        <input type="range" min={v.min} max={v.max} step={v.step}
          value={params[k]} oninput={(e) => setParam(k, +(e.target as HTMLInputElement).value)} />
      </label>
    {/each}
    <div class="rt-status" class:err={status === 'error'}>{status}{#if error}: {error}{/if}</div>
    <details class="rt-json"><summary>recipe.json</summary><pre>{JSON.stringify(recipe, null, 2)}</pre></details>
  </aside>
  <main class="rt-stage">
    {#if error}
      <div class="rt-msg rt-err">{error}</div>
    {:else if !SceneComponent || !geo}
      <div class="rt-msg">{status}…</div>
    {:else}
      <Canvas {createRenderer}>
        {@const Scene = SceneComponent}
        <Scene {geo} {geoVersion} showCutaway={scene.showCutaway} showEdges={scene.showEdges} />
      </Canvas>
      {#if SceneControls}{@const Controls = SceneControls}<Controls />{/if}
    {/if}
  </main>
</div>

<style>
  .rt-root { display: grid; grid-template-columns: 320px 1fr; height: 100%; min-height: 0; font: 13px Arial; color: #222; }
  .rt-side { border-right: 1px solid #ddd; background: #fafafa; padding: 14px; overflow-y: auto; }
  .rt-side h1 { margin: 0 0 4px; font: 700 15px monospace; color: #cc2222; }
  .rt-desc { margin: 0 0 8px; font-size: 12px; color: #444; line-height: 1.35; }
  .rt-note { margin: 0 0 14px; font-size: 11px; color: #777; line-height: 1.35; }
  .rt-note code { background: #eee; padding: 0 4px; border-radius: 3px; }
  .rt-param { display: block; margin: 10px 0; }
  .rt-plabel { display: flex; justify-content: space-between; font: 600 12px Arial; color: #333; margin-bottom: 3px; }
  .rt-plabel em { font-style: normal; color: #cc2222; font-family: monospace; }
  .rt-param input { width: 100%; accent-color: #cc2222; }
  .rt-status { margin-top: 12px; font: 11px monospace; color: #888; }
  .rt-status.err { color: #cc2222; }
  .rt-json { margin-top: 14px; }
  .rt-json summary { cursor: pointer; font: 11px Arial; color: #777; }
  .rt-json pre { font: 10px ui-monospace, monospace; background: #fff; border: 1px solid #eee; border-radius: 4px; padding: 8px; overflow: auto; max-height: 280px; }
  .rt-stage { position: relative; background: #2a2a2a; min-height: 0; }
  .rt-msg { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #aaa; }
  .rt-err { color: #ff8888; padding: 20px; text-align: center; }
</style>
