<script lang="ts">
  // ───────────────────────────────────────────────────────────────────────
  // WebGpuView.svelte — SPIKE, NOT WIRED. A proof-of-life scaffold for a
  // future "WGPU" render tab: a WebGPU GPU-rasterizer sibling of B·SVG that
  // would draw the OCCT boundary vector paths on the GPU instead of via the
  // browser's SVG renderer.
  //
  // This component is NOT registered in embed-config.ts / RightPane.svelte and
  // is imported by nothing — it exists so the human can drop it into a scratch
  // route and confirm WebGPU comes up on their machine. Integration plan +
  // rationale: docs/research/webgpu-onedraw-tab.md.
  //
  // What it does today: feature-detect `navigator.gpu`, request an adapter +
  // device on mount, and CLEAR the canvas to a solid colour via a render pass
  // (the minimal "the GPU pipeline is alive" test). No geometry yet — the real
  // tab would upload the projected polylines/paths and rasterize fills.
  //
  // Dependency-free: raw WebGPU API only (no `@webgpu/types`, no npm add), so
  // the production build stays green even though the WebGPU lib types are
  // absent. All GPU types are referenced via `any`/`unknown` + narrow casts and
  // every access is guarded — nothing here runs unless a real device exists.
  // ───────────────────────────────────────────────────────────────────────
  import { onMount } from 'svelte';
  import { webgpuSupported } from './webgpu-support';

  let {
    /** Clear colour [r,g,b,a] in 0..1 — the proof-of-life fill. */
    clearColor = [0.04, 0.09, 0.16, 1] as [number, number, number, number],
    width = 480,
    height = 320,
  }: {
    clearColor?: [number, number, number, number];
    width?: number;
    height?: number;
  } = $props();

  let canvasEl = $state<HTMLCanvasElement | null>(null);
  // 'probing' until the async init settles; then 'ok' (a device cleared the
  // canvas) or 'unavailable' (no navigator.gpu / no adapter / init threw).
  let status = $state<'probing' | 'ok' | 'unavailable'>('probing');
  let detail = $state('');
  let adapterInfo = $state('');

  // The live device — kept so we can dispose it on unmount. Typed `any` because
  // we deliberately don't depend on @webgpu/types (see header).
  let device: any = null;

  onMount(() => {
    let disposed = false;

    (async () => {
      // 1) Synchronous capability gate — no `navigator.gpu`, no attempt.
      if (!webgpuSupported()) {
        status = 'unavailable';
        detail = 'navigator.gpu is not present — this browser/build has no WebGPU.';
        return;
      }
      try {
        // 2) Adapter → device. `requestAdapter()` can resolve to null on a
        //    blocklisted / software-only GPU even when navigator.gpu exists.
        const gpu = (navigator as any).gpu;
        const adapter = await gpu.requestAdapter();
        if (!adapter) {
          status = 'unavailable';
          detail = 'navigator.gpu exists but requestAdapter() returned null (no usable GPU adapter).';
          return;
        }
        try {
          // `adapter.info` is newer; fall back to the deprecated
          // requestAdapterInfo() when absent. Best-effort label only.
          const info = adapter.info ?? (adapter.requestAdapterInfo ? await adapter.requestAdapterInfo() : null);
          if (info) adapterInfo = [info.vendor, info.architecture, info.description].filter(Boolean).join(' · ');
        } catch { /* info is optional */ }

        const dev = await adapter.requestDevice();
        if (disposed) { try { dev.destroy?.(); } catch { /* ignore */ } return; }
        device = dev;

        // 3) Configure the canvas context + run ONE render pass that just
        //    clears to `clearColor`. If this paints, the whole GPU path
        //    (adapter → device → context → queue → present) is alive.
        const canvas = canvasEl;
        const ctx = canvas?.getContext('webgpu') as any;
        if (!canvas || !ctx) {
          status = 'unavailable';
          detail = 'Could not acquire a "webgpu" canvas context.';
          return;
        }
        const format = gpu.getPreferredCanvasFormat();
        ctx.configure({ device: dev, format, alphaMode: 'premultiplied' });

        const [r, g, b, a] = clearColor;
        const encoder = dev.createCommandEncoder();
        const pass = encoder.beginRenderPass({
          colorAttachments: [{
            view: ctx.getCurrentTexture().createView(),
            clearValue: { r, g, b, a },
            loadOp: 'clear',
            storeOp: 'store',
          }],
        });
        // No draw calls yet — clearing IS the proof-of-life. The real tab would
        // set a pipeline here and draw the projected boundary polylines/fills.
        pass.end();
        dev.queue.submit([encoder.finish()]);

        if (!disposed) { status = 'ok'; detail = 'GPU device acquired — canvas cleared via a render pass.'; }
      } catch (e: any) {
        if (!disposed) { status = 'unavailable'; detail = `WebGPU init failed: ${String(e?.message ?? e)}`; }
      }
    })();

    // Dispose: destroy the device so the GPU resources are released when the
    // tab/pane unmounts (the lifecycle the real tab would follow on tab-close).
    return () => {
      disposed = true;
      try { device?.destroy?.(); } catch { /* already gone */ }
      device = null;
    };
  });
</script>

<div class="wgpu-view">
  {#if status === 'unavailable'}
    <div class="wgpu-fallback">
      <div class="wgpu-fallback-title">WebGPU unavailable</div>
      <p class="wgpu-fallback-body">{detail || 'This browser or environment does not expose a usable WebGPU device.'}</p>
      <p class="wgpu-fallback-hint">The B·SVG tab renders the same boundary without a GPU — use it as the fallback.</p>
    </div>
  {:else}
    <canvas bind:this={canvasEl} {width} {height} class="wgpu-canvas"></canvas>
    <div class="wgpu-meta" class:ok={status === 'ok'}>
      {#if status === 'probing'}
        <span>probing WebGPU…</span>
      {:else}
        <span title={detail}>✓ WebGPU device live{adapterInfo ? ` · ${adapterInfo}` : ''}</span>
      {/if}
    </div>
  {/if}
</div>

<style>
  .wgpu-view { display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 8px; height: 100%; min-height: 0; padding: 12px; background: #fff; }
  .wgpu-canvas { max-width: 100%; height: auto; border: 1px solid #e5e7eb; border-radius: 6px;
    background: #0b1220; }
  .wgpu-meta { font: 10.5px Arial; color: #6b7280; }
  .wgpu-meta.ok { color: #15803d; }
  .wgpu-fallback { margin: auto; max-width: 380px; padding: 18px 20px; text-align: center;
    background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; }
  .wgpu-fallback-title { font: 700 13px Arial; color: #334155; margin-bottom: 8px; }
  .wgpu-fallback-body { font: 11.5px/1.6 Arial; color: #64748b; margin: 0 0 8px; }
  .wgpu-fallback-hint { font: 11px/1.5 Arial; color: #94a3b8; margin: 0; }
</style>
