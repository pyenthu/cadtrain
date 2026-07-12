<script lang="ts">
  /**
   * ProfileFn3DCanvas — small Threlte preview that mirrors the 2D editor SVG
   * in 3D. Takes the live `points` from ProfileFnEditor + the `set` (revolve |
   * cartesian) and synthesizes a tiny one-shot primitive that pipes them
   * through r_revolve / r_extrude. The mesh comes back via the existing
   * /api/primitives/preview path so we don't duplicate the WASM build chain
   * here — pure thin client. Renders next to the 2D preview, NOT instead of.
   */
  import { onMount } from 'svelte';
  import { Canvas } from '@threlte/core';
  import { WebGLRenderer } from 'three';
  import { deserializeComponentResult } from '$lib/engines/manifold/mesh-serial';

  type Pt = [number, number];
  let { points, set, depth = 2 }: { points: Pt[]; set: 'revolve' | 'cartesian'; depth?: number } = $props();

  let Scene = $state<any>(null);
  let geo = $state<any>(null);
  let geoVersion = $state(0);
  let err = $state<string | null>(null);
  let status = $state<'idle' | 'building' | 'ok' | 'error'>('idle');

  // Lazy-load the same Threlte scene used by /primitives so we get camera +
  // lights + warp toggle for free; it just doesn't need a GLB pane here.
  onMount(async () => {
    const m = await import('$lib/shared/viewer/PrimitiveDualScene.svelte');
    Scene = m.default;
  });

  function createRenderer(canvas: HTMLCanvasElement) {
    return new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  }

  // Synthesize a primitive source that wraps the current points + sweeps them
  // via the stdlib engine, then POST to /api/primitives/preview. Debounced via
  // an $effect so dragging a param doesn't drown the dev server.
  let ac: AbortController | null = null;
  $effect(() => {
    void points; void set; void depth;
    if (!points || points.length < 3) { geo = null; status = 'idle'; return; }
    const ptsJson = JSON.stringify(points);
    const src = set === 'cartesian'
      ? `export const meta = { id: '_p3d', name: '_p3d', uses: ['r_extrude'], params: { depth: { default: ${depth}, min: 0.1, max: 20, step: 0.1 } } };
export function _p3d(depth) {
  const profile = ${ptsJson};
  return r_extrude(profile, p.depth);
}`
      : `export const meta = { id: '_p3d', name: '_p3d', uses: ['r_revolve'], params: { segments: { default: 96, min: 8, max: 192, step: 4 } } };
export function _p3d(segments) {
  const profile = ${ptsJson};
  return r_revolve(profile, p.segments);
}`;
    const args = set === 'cartesian' ? [depth] : [96];
    ac?.abort(); const my = new AbortController(); ac = my;
    status = 'building';
    const timer = setTimeout(async () => {
      try {
        const r = await fetch('/api/primitives/preview', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: '_p3d', name: '_p3d', source: src, params: args, mode: 'sandbox' }),
          signal: my.signal,
        });
        if (my.signal.aborted) return;
        if (!r.ok) { err = `preview ${r.status}`; status = 'error'; return; }
        const data = await r.json();
        geo = deserializeComponentResult({ full: data.full, cutVC: data.cutVC });
        geoVersion++; err = null; status = 'ok';
      } catch (e: any) {
        if (e?.name !== 'AbortError') { err = String(e?.message ?? e); status = 'error'; }
      }
    }, 180);
    return () => { clearTimeout(timer); my.abort(); };
  });
</script>

<div class="p3d-host">
  <div class="p3d-label" class:bad={!!err}>3D · {status}{err ? ` · ${err}` : ''}</div>
  {#if Scene}
    {@const S = Scene}
    <Canvas {createRenderer}>
      <S {geo} {geoVersion} offset={0} />
    </Canvas>
  {:else}
    <div class="p3d-loading">loading 3D…</div>
  {/if}
</div>

<style>
  .p3d-host { position: relative; width: 100%; height: 100%; min-height: 160px; background: #fcfaf9; border: 1px solid #ececf2; border-radius: 6px; overflow: hidden; }
  .p3d-label { position: absolute; top: 6px; left: 8px; z-index: 5; font: 600 10px Arial; color: #555; background: rgba(255,255,255,0.85); padding: 2px 6px; border-radius: 3px; pointer-events: none; }
  .p3d-label.bad { color: #cc2222; background: rgba(255, 245, 245, 0.95); }
  .p3d-loading { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #aaa; font: 12px Arial; }
</style>
