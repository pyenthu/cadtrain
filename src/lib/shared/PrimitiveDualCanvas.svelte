<script module lang="ts">
  // Shared across ALL instances + survives unmount/remount (tab switches).
  const fetchCache = new Map<string, any>();
</script>

<script lang="ts">
  // One canvas showing the live mesh (left) + baked GLB (right) side-by-side
  // in a SINGLE WebGL context — replaces the stacked PrimitiveCanvas +
  // PrimitiveGlbCanvas (was 2 contexts per tab → the WebGL-context leak,
  // todo_webgl_context_leak). Fetches both /preview and /bake-preview.
  import { onMount, onDestroy } from 'svelte';
  import { Canvas } from '@threlte/core';
  import { WebGLRenderer } from 'three';
  import { deserializeComponentResult } from '$lib/cad/mesh-serial';
  import { scene } from '$lib/shared/scene-state.svelte';

  let { id, name = id, description = '', args, source, showControls = true, showLabels = true, sceneOffset = 4.5, sceneStackAxis = 'x' }: {
    id: string; name?: string; description?: string; args: (number | string)[]; source?: string; showControls?: boolean;
    /** When false, the top 'Mesh (live)' + 'GLB (bake)' label chips are
     *  hidden — used by the typed-builder panes where the labels add
     *  visual clutter without information value (only one scene anyway). */
    showLabels?: boolean;
    /** Half-separation between the live mesh (-offset) and the GLB (+offset),
     *  along the axis chosen by sceneStackAxis. Default 4.5 (side-by-side). */
    sceneOffset?: number;
    /** Which axis to stack along. 'x' = side-by-side (default), 'z' = vertical
     *  along the drilling axis — typed builders use this with a small offset
     *  so the user can orbit up/down to see mesh vs GLB. */
    sceneStackAxis?: 'x' | 'z';
  } = $props();

  let Scene = $state<any>(null);
  let SceneControls = $state<any>(null);
  let geo = $state<any>(null);
  let geoVersion = $state(0);
  let glbBlobUrl = $state<string | null>(null);
  let glbCut = $state(false);
  let meshStatus = $state<'idle'|'building'|'ok'|'error'>('idle');
  let glbStatus = $state<'idle'|'building'|'ok'|'error'>('idle');
  let err = $state<string | null>(null);

  let renderer: WebGLRenderer | null = null;
  function createRenderer(canvas: HTMLCanvasElement) {
    renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    return renderer;
  }

  onMount(async () => {
    const [scn, controls] = await Promise.all([
      import('$lib/shared/PrimitiveDualScene.svelte'),
      import('$lib/shared/SceneControls.svelte'),
    ]);
    Scene = scn.default; SceneControls = controls.default;
    rebuild();
  });

  function setGlbBlob(b64: string | null) {
    if (glbBlobUrl) URL.revokeObjectURL(glbBlobUrl);
    if (!b64) { glbBlobUrl = null; return; }
    const bin = atob(b64); const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    glbBlobUrl = URL.createObjectURL(new Blob([bytes], { type: 'model/gltf-binary' }));
  }

  // Module-scope fetch cache (2026-06-11) — survives unmount/remount.
  // Inactive /primitives tabs now UNMOUNT this component (WebGL-context
  // cap), so switching back would re-hit /preview + /bake-preview for
  // unchanged geometry. Cache the raw responses keyed by the full request
  // body; a remount with the same id/args/source repaints instantly.
  // Small LRU — GLB payloads can be MBs for tall assemblies.
  const FETCH_CACHE_MAX = 12;
  function cacheGet(key: string): any | undefined {
    const v = fetchCache.get(key);
    if (v !== undefined) { fetchCache.delete(key); fetchCache.set(key, v); } // refresh recency
    return v;
  }
  function cachePut(key: string, val: any) {
    if (fetchCache.has(key)) fetchCache.delete(key);
    fetchCache.set(key, val);
    while (fetchCache.size > FETCH_CACHE_MAX) fetchCache.delete(fetchCache.keys().next().value as string);
  }

  let meshAc: AbortController | null = null;
  let glbAc: AbortController | null = null;
  async function rebuildMesh() {
    if (!id) return;
    const body = JSON.stringify({ id, name, source: source ?? '', params: args, mode: source ? 'sandbox' : 'bundle' });
    const cached = cacheGet(`mesh:${body}`);
    if (cached) {
      geo = deserializeComponentResult({ full: cached.full, cutVC: cached.cutVC });
      geoVersion++; meshStatus = 'ok'; err = null;
      return;
    }
    meshStatus = 'building';
    meshAc?.abort(); const ac = new AbortController(); meshAc = ac;
    try {
      const r = await fetch('/api/primitives/preview', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body,
        signal: ac.signal,
      });
      if (ac.signal.aborted) return;
      if (!r.ok) { err = `Preview ${r.status}`; meshStatus = 'error'; return; }
      const data = await r.json();
      cachePut(`mesh:${body}`, { full: data.full, cutVC: data.cutVC });
      geo = deserializeComponentResult({ full: data.full, cutVC: data.cutVC });
      geoVersion++; meshStatus = 'ok'; err = null;
    } catch (e: any) { if (e?.name !== 'AbortError') { err = String(e?.message ?? e); meshStatus = 'error'; } }
  }
  async function rebuildGlb() {
    if (!id) return;
    const body = JSON.stringify({ id, name, source: source ?? '', args, cut: glbCut });
    const cachedB64 = cacheGet(`glb:${body}`);
    if (cachedB64) { setGlbBlob(cachedB64); glbStatus = 'ok'; return; }
    glbStatus = 'building';
    glbAc?.abort(); const ac = new AbortController(); glbAc = ac;
    try {
      const r = await fetch('/api/primitives/bake-preview', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body,
        signal: ac.signal,
      });
      if (ac.signal.aborted) return;
      if (!r.ok) { err = `Bake ${r.status}`; glbStatus = 'error'; return; }
      const data = await r.json();
      const b64 = glbCut && data.cut ? data.cut : data.full;
      cachePut(`glb:${body}`, b64);
      setGlbBlob(b64);
      glbStatus = 'ok';
    } catch (e: any) { if (e?.name !== 'AbortError') { err = String(e?.message ?? e); glbStatus = 'error'; } }
  }
  function rebuild() { rebuildMesh(); rebuildGlb(); }

  onDestroy(() => {
    // Release the WebGL context NOW, not at GC time — the whole point of
    // unmounting inactive tabs' canvases is freeing the browser's ~16
    // context budget. dispose() drops GPU resources; forceContextLoss()
    // tells the browser the context is reclaimable immediately.
    meshAc?.abort(); glbAc?.abort();
    if (glbBlobUrl) URL.revokeObjectURL(glbBlobUrl);
    try { renderer?.dispose(); renderer?.forceContextLoss(); } catch { /* already lost */ }
    renderer = null;
  });

  $effect(() => { void id; void args; void source; if (Scene) rebuild(); });
  $effect(() => { void glbCut; if (Scene) rebuildGlb(); });

  function downloadGlb() {
    if (!glbBlobUrl) return;
    const a = document.createElement('a'); a.href = glbBlobUrl; a.download = `${id}.glb`;
    document.body.appendChild(a); a.click(); a.remove();
  }
</script>

<div class="pd-stage">
  {#if showLabels}
    <div class="pd-label pd-label-l">Mesh (live){#if meshStatus === 'building'} · …{/if}</div>
    <div class="pd-label pd-label-r">
      <span>GLB (bake){#if glbStatus === 'building'} · …{/if}</span>
      <label class="pd-toggle" title="Half-sectioned bake"><input type="checkbox" bind:checked={glbCut} /> cut</label>
    </div>
  {/if}
  {#if name}<div class="pd-title">{name}</div>{/if}
  {#if description}<div class="pd-desc">{description}</div>{/if}
  <!-- Z-pan: scroll the camera + look-at down the drilling axis (tall assemblies).
       Top = z 0 (top of the part), drag down to follow it deeper (Z-down). -->
  <div class="pd-zpan">
    <!-- Z-pan range expanded 90 units (−10 → 80) → 250 units (−50 → 200)
         so tall multi-joint assemblies (drill stands, completion strings)
         can be scrolled end-to-end without the slider hitting its stop. -->
    <input class="pd-zslider" type="range" min="-50" max="200" step="0.5"
      bind:value={scene.zFocus} aria-label="Pan camera along Z" title="Pan view along Z ({scene.zFocus.toFixed(1)})" />
    <button class="pd-zreset" type="button" title="Reset Z pan" onclick={() => (scene.zFocus = 0)}>⊙</button>
  </div>
  {#if Scene}
    {@const S = Scene}
    <!-- smoothShade experiment (2026-05-28): rebake whenever the renderer
         actually NEEDS smooth shading — extrude variants with twist > 0 emit
         non-planar quads that read as a sawtooth under flatShading; the live
         mesh switches to calculateNormals(3, 60) vertex normals so the side
         reads smooth while flat-face creases (>60°) stay sharp.
         * r_weld_extrude — twist is always present (reserved for morphed).
         * r_extrude — twist is param index 2 in meta.params order
           (profile, height, twist, divs). Smooth-shade only when |twist| > 0.
         All other primitives keep flatShading (cube/hex stay faceted). -->
    {@const twistArg = Number((args as any[])?.[2] ?? 0)}
    {@const smoothShade =
      id === 'r_weld_extrude' ||
      (id === 'r_extrude' && Math.abs(twistArg) > 0.001)}
    <Canvas {createRenderer}>
      <S {geo} {geoVersion} glbUrl={glbBlobUrl} showCutaway={scene.showCutaway} {smoothShade} offset={sceneOffset} stackAxis={sceneStackAxis} />
    </Canvas>
    {#if showControls && SceneControls}{@const Controls = SceneControls}<Controls />{/if}
  {:else}
    <div class="pd-loading">loading…</div>
  {/if}
  {#if glbBlobUrl}<button class="pd-dl" type="button" title="Download {id}.glb" onclick={downloadGlb}>⬇ GLB</button>{/if}
  {#if err}<div class="pd-err">{err}</div>{/if}
</div>

<style>
  .pd-stage { position: relative; width: 100%; height: 100%; min-height: 0; background: #ffffff; border-radius: 4px; overflow: hidden; }
  .pd-label { position: absolute; top: 6px; z-index: 5; font: 600 10px Arial; color: #fff; background: rgba(0,0,0,0.6); padding: 2px 8px; border-radius: 3px; }
  /* Pushed below the in-canvas title (top-left) so they don't overlap. */
  .pd-label-l { left: 8px; top: 34px; pointer-events: none; }
  .pd-label-r { right: 8px; display: flex; gap: 8px; align-items: center; }
  .pd-toggle { pointer-events: auto; display: inline-flex; gap: 3px; align-items: center; cursor: pointer; }
  .pd-loading { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #aaa; font: 12px Arial; }
  /* Title (top-left) + description (bottom) as DOM overlays — NOT a Threlte
     <HTML> overlay, which rendered a pointer-events:auto wrapper at z-index 8
     that swallowed clicks on the ⬇ GLB button + the cut toggle. */
  /* Overlays were originally light-on-dark; the scene background is now WHITE
     (per .pd-stage), so the title and description need dark-on-light. Drop
     the dark drop-shadow and switch to a contrasting deep red / charcoal. */
  .pd-title { position: absolute; top: 8px; left: 12px; z-index: 5; pointer-events: none; font: 700 15px ui-monospace, SFMono-Regular, Menlo, monospace; color: #a02520; letter-spacing: 0.3px; text-shadow: 0 1px 2px rgba(255,255,255,0.95); }
  .pd-desc { position: absolute; bottom: 8px; left: 12px; right: 96px; z-index: 5; pointer-events: none; font: 11px Arial; color: #333; line-height: 1.35; text-align: center; text-shadow: 0 1px 2px rgba(255,255,255,0.95); }
  .pd-dl { position: absolute; bottom: 8px; right: 8px; z-index: 6; background: rgba(0,0,0,0.6); color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 4px 10px; font: 11px Arial; cursor: pointer; }
  .pd-dl:hover { background: #cc2222; border-color: #cc2222; }
  .pd-err { position: absolute; bottom: 8px; left: 8px; z-index: 5; color: #ff8888; font: 11px Arial; background: rgba(0,0,0,0.6); padding: 3px 8px; border-radius: 3px; max-width: 55%; }
  /* Vertical Z-pan slider, left edge. */
  /* Z-pan vertical slider on the RIGHT edge — keeps the left clear for the
     2D SVG overlay (and the 'Mesh (live)' label sitting top-left). */
  .pd-zpan { position: absolute; right: 6px; top: 56px; bottom: 16px; z-index: 6; display: flex; flex-direction: column; align-items: center; gap: 6px; }
  /* Vertical range slider — modern path: `writing-mode: vertical-lr` alone.
     Drop `appearance: slider-vertical` (deprecated in Chrome 124+, removal
     warned via the runtime banner). Default direction:ltr makes top=min
     bottom=max, which matches Z-down (top of part = z 0 = slider top). */
  .pd-zslider { writing-mode: vertical-lr; width: 16px; flex: 1 1 auto; min-height: 0; cursor: ns-resize; accent-color: #cc2222; }
  .pd-zreset { flex: 0 0 auto; width: 20px; height: 20px; border: 1px solid rgba(0,0,0,0.25); background: rgba(255,255,255,0.85); border-radius: 50%; cursor: pointer; font: 12px Arial; color: #555; line-height: 1; padding: 0; }
  .pd-zreset:hover { color: #cc2222; border-color: #cc2222; }
</style>
