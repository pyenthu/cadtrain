<script lang="ts">
  // Live-bake GLB sibling to PrimitiveCanvas. POSTs the source + params
  // to /api/primitives/bake-preview, decodes the returned GLB bytes
  // into a Blob URL, and hands it to ComponentSceneGlb. Re-fetches
  // when id / args / source change.
  //
  // The point of this component is direct comparison with the Mesh
  // view: same primitive, baked through the production buildGlbBytes
  // path. Used in PrimitiveView's canvas pane as a side-by-side panel.
  import { onMount } from 'svelte';
  import { Canvas } from '@threlte/core';
  import { WebGLRenderer } from 'three';

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
    args: (number | string)[];
    source?: string;
    showControls?: boolean;
    onstatus?: (s: 'idle' | 'building' | 'ok' | 'error') => void;
    onerror?: (e: string | null) => void;
  } = $props();

  let SceneGlb = $state<any>(null);
  let SceneControls = $state<any>(null);
  let blobUrl = $state<string | null>(null);
  let status = $state<'idle' | 'building' | 'ok' | 'error'>('idle');
  let error = $state<string | null>(null);

  function emitStatus(s: typeof status) { status = s; onstatus?.(s); }
  function emitError(e: string | null) { error = e; onerror?.(e); }

  function createRenderer(canvas: HTMLCanvasElement) {
    return new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  }

  function setBlobUrl(b64: string | null) {
    // Free the prior object URL so we don't leak; browsers cap to a
    // few thousand simultaneous blobs.
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    if (!b64) { blobUrl = null; return; }
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'model/gltf-binary' });
    blobUrl = URL.createObjectURL(blob);
  }

  function downloadGlb() {
    if (!blobUrl) return;
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `${id}.glb`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  onMount(async () => {
    const [glbScene, controls] = await Promise.all([
      import('$lib/shared/ComponentSceneGlb.svelte'),
      import('$lib/shared/SceneControls.svelte'),
    ]);
    SceneGlb = glbScene.default;
    SceneControls = controls.default;
    rebuild();
  });

  // Build the body for /bake-preview. The endpoint also accepts the
  // params as a record (so it can dispatch via the source's meta
  // order) — but to mirror /preview's interface I send args ALSO as a
  // record keyed by Object.fromEntries(name, value). The server falls
  // back to positional when needed; here we always have args.
  let pending: AbortController | null = null;
  async function rebuild() {
    if (!id) return;
    emitError(null);
    emitStatus('building');
    pending?.abort();
    const ac = new AbortController();
    pending = ac;
    try {
      const r = await fetch('/api/primitives/bake-preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id,
          name,
          source: source ?? '',
          // Positional args; the endpoint pairs them with param names
          // pulled from `export const meta` in source.
          args,
        }),
        signal: ac.signal,
      });
      if (ac.signal.aborted) return;
      if (!r.ok) {
        emitError(`Bake failed (${r.status}): ${await r.text()}`);
        emitStatus('error');
        return;
      }
      const data = await r.json();
      setBlobUrl(data.full);
      emitStatus('ok');
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      emitError(`Bake error: ${e?.message ?? e}`);
      emitStatus('error');
    }
  }

  $effect(() => {
    void id; void args; void source;
    if (SceneGlb) rebuild();
  });
</script>

<div class="pgc-stage">
  {#if error}
    <div class="pgc-error"><strong>GLB bake error</strong><br />{error}</div>
  {:else if !SceneGlb || !blobUrl}
    <div class="pgc-loading">{status}</div>
  {:else}
    <Canvas {createRenderer}>
      {@const Scene = SceneGlb}
      <Scene url={blobUrl} />
    </Canvas>
    {#if showControls && SceneControls}{@const Controls = SceneControls}<Controls />{/if}
  {/if}
  {#if blobUrl}
    <button class="pgc-dl" type="button" title="Download {id}.glb" onclick={downloadGlb}>⬇ GLB</button>
  {/if}
</div>

<style>
  .pgc-stage { position: relative; width: 100%; height: 100%; min-height: 0; background: #1a1a1a; border-radius: 4px; overflow: hidden; }
  .pgc-loading, .pgc-error { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #aaa; padding: 12px; text-align: center; font: 12px Arial; }
  .pgc-error { color: #ff8888; flex-direction: column; gap: 6px; }
  .pgc-dl { position: absolute; bottom: 8px; right: 8px; z-index: 5; background: rgba(0,0,0,0.6); color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 4px 10px; font: 11px Arial; cursor: pointer; }
  .pgc-dl:hover { background: #cc2222; border-color: #cc2222; }
</style>
