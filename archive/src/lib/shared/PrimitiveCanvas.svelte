<script lang="ts">
  // Shared canvas surface for any volume or bundle primitive. Fetches
  // /api/primitives/preview, rehydrates the mesh, renders via Threlte.
  //
  // The drawing call is the same for every primitive — what differs
  // between the generic /primitives view and per-primitive view.svelte
  // is the surrounding inspector chrome, not this canvas. Pass `source`
  // when you want live source-edit preview (sandbox path); omit it to
  // let the server resolve from disk (bundle / volume fast path).
  import { onMount } from 'svelte';
  import { Canvas } from '@threlte/core';
  import { WebGLRenderer } from 'three';
  import { deserializeComponentResult } from '$lib/cad/mesh-serial';
  import { scene } from '$lib/shared/scene-state.svelte';

  let {
    id,
    name = id,
    args,
    source,
    showControls = true,
    onstatus,
    onerror,
  }: {
    id: string;
    name?: string;
    /** Positional args. Numbers for scalar params; strings for polygon
     *  params (JSON-encoded `[[x,y],...]`). */
    args: (number | string)[];
    source?: string;
    showControls?: boolean;
    onstatus?: (s: 'idle' | 'building' | 'ok' | 'error') => void;
    onerror?: (e: string | null) => void;
  } = $props();

  let SceneComponent = $state<any>(null);
  let SceneControls = $state<any>(null);
  let geo = $state<any>(null);
  let geoVersion = $state(0);
  let status = $state<'idle' | 'building' | 'ok' | 'error'>('idle');
  let error = $state<string | null>(null);

  function emitStatus(s: typeof status) { status = s; onstatus?.(s); }
  function emitError(e: string | null) { error = e; onerror?.(e); }

  function createRenderer(canvas: HTMLCanvasElement) {
    return new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  }

  onMount(async () => {
    const [scn, controls] = await Promise.all([
      import('$lib/shared/ComponentScene.svelte'),
      import('$lib/shared/SceneControls.svelte'),
    ]);
    SceneComponent = scn.default;
    SceneControls = controls.default;
    rebuild();
  });

  // Re-fetch whenever id, args, or source change. The dep on `args`
  // tracks the array reference — callers should produce a new array
  // (e.g. spread or Array.from) when params change so this fires.
  let pending: AbortController | null = null;
  async function rebuild() {
    if (!id) return;
    emitError(null);
    emitStatus('building');
    pending?.abort();
    const ac = new AbortController();
    pending = ac;
    try {
      const r = await fetch('/api/primitives/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id,
          name,
          source: source ?? '',
          params: args,
          mode: source ? 'sandbox' : 'bundle',
        }),
        signal: ac.signal,
      });
      if (ac.signal.aborted) return;
      if (!r.ok) {
        emitError(`Preview failed (${r.status}): ${await r.text()}`);
        emitStatus('error');
        return;
      }
      const data = await r.json();
      geo = deserializeComponentResult({ full: data.full, cutVC: data.cutVC });
      geoVersion++;
      emitStatus('ok');
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      emitError(`Preview error: ${e?.message ?? e}`);
      emitStatus('error');
    }
  }

  $effect(() => {
    // Re-trigger on id / args / source changes. Access each to register
    // dependencies. `args` access reads its identity — pass a fresh
    // array each time params change.
    void id; void args; void source;
    if (SceneComponent) rebuild();
  });
</script>

<div class="pc-stage">
  {#if error}
    <div class="pc-error"><strong>Preview error</strong><br />{error}</div>
  {:else if !SceneComponent || !geo}
    <div class="pc-loading">{status}</div>
  {:else}
    <Canvas {createRenderer}>
      {@const Scene = SceneComponent}
      <Scene {geo} {geoVersion} showCutaway={scene.showCutaway} showEdges={scene.showEdges} />
    </Canvas>
    {#if showControls && SceneControls}{@const Controls = SceneControls}<Controls />{/if}
  {/if}
</div>

<style>
  .pc-stage { position: relative; width: 100%; height: 100%; min-height: 0; background: #2a2a2a; border-radius: 4px; overflow: hidden; }
  .pc-loading, .pc-error { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #aaa; padding: 12px; text-align: center; font: 12px Arial; }
  .pc-error { color: #ff8888; flex-direction: column; gap: 6px; }
</style>
