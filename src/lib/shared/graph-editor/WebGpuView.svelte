<script lang="ts">
  // ───────────────────────────────────────────────────────────────────────
  // WebGpuView.svelte — the "WGPU" render tab (#998). A WebGPU GPU-rasterizer
  // sibling of B·SVG: instead of the browser's SVG renderer, it draws the OCCT
  // TRUE-boundary as GPU line primitives.
  //
  // Pipeline:
  //   1) feature-detect `navigator.gpu` → adapter → device (proof-of-life gate,
  //      unchanged from the original scaffold — a blocklisted GPU still falls
  //      back gracefully to the "WebGPU unavailable" panel).
  //   2) build a MINIMAL line pipeline (line-list topology, a fit-transform
  //      uniform, a light-teal fragment) once the device is up.
  //   3) whenever `source` (+ `paramValues`) changes and this tab is mounted,
  //      POST /api/brep/svg with `format:'polylines'` → the raw projected 2D
  //      boundary polylines + bbox (the #998 endpoint mode). Expand them to a
  //      line-list vertex buffer, fit the bbox → clip space (aspect-preserving
  //      letterbox, Y-flip to match B·SVG's Z-down orientation), and draw.
  //
  // Dependency-free: raw WebGPU API only (no `@webgpu/types`, no npm add), so
  // the production build stays green even though the WebGPU lib types are
  // absent. All GPU objects are `any`; the `GPUBufferUsage` flag enum is read off
  // `globalThis` (not referenced as a bare TS global) and every access is guarded
  // — nothing here runs unless a real device exists. When no device is present,
  // or the part hasn't baked yet, we degrade to a text state (never a hard error).
  //
  // NOTE: the GPU DRAW itself cannot be verified headless (no adapter in Node) —
  // build-green proves it compiles + wires; the silhouette on screen is a human
  // eyeball check.
  // ───────────────────────────────────────────────────────────────────────
  import { onMount } from 'svelte';
  import { webgpuSupported } from './webgpu-support';

  let {
    /** Part source (emitted graph body) — POSTed to /api/brep/svg for its boundary. */
    source = '',
    /** Current param values (name → number), graph.params order — mirrors B·SVG. */
    paramValues = {} as Record<string, number>,
    /** Background clear colour [r,g,b,a] in 0..1 (the dark field the lines draw on). */
    clearColor = [0.04, 0.09, 0.16, 1] as [number, number, number, number],
    width = 480,
    height = 320,
  }: {
    source?: string;
    paramValues?: Record<string, number>;
    clearColor?: [number, number, number, number];
    width?: number;
    height?: number;
  } = $props();

  let canvasEl = $state<HTMLCanvasElement | null>(null);
  // 'probing' until the async init settles; then 'ok' (a device is live) or
  // 'unavailable' (no navigator.gpu / no adapter / init threw).
  let status = $state<'probing' | 'ok' | 'unavailable'>('probing');
  let detail = $state('');
  let adapterInfo = $state('');
  // Reactive UI flags (never READ by the fetch effect → no self-trigger loop).
  let deviceReady = $state(false);   // flips true when the pipeline is built; gates the fetch effect
  let busy = $state(false);          // a polyline fetch is in flight
  let hasGeometry = $state(false);   // ≥1 boundary segment currently uploaded
  let segCount = $state(0);          // line-segments drawn (human-visible count)
  let fetchError = $state('');       // last /api/brep/svg failure/reason (empty = none)

  // ── GPU handles (plain `let`, typed `any` — see header). Kept for redraw + dispose.
  let device: any = null;
  let ctx: any = null;
  let pipeline: any = null;
  let uniformBuf: any = null;   // 16-byte vec4 fit transform (sx, sy, tx, ty)
  let bindGroup: any = null;
  let vertexBuf: any = null;    // recreated per polyline upload
  let gpuBU: any = null;        // GPUBufferUsage flag enum (off globalThis)

  // ── Non-reactive geometry cache (a resize redraws WITHOUT refetching). ──────
  let lastFetchKey = '';                 // dedup: skip refetch when {source,params} unchanged
  let lastBBox: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
  let lastVertices: Float32Array | null = null;
  let lastVertexCount = 0;

  // WGSL: a vertex shader applying the fit transform (vec4 uniform: sx, sy, tx, ty),
  // a fragment shader painting a light teal stroke. line-list topology.
  const WGSL = /* wgsl */ `
    struct U { xf: vec4<f32> };
    @group(0) @binding(0) var<uniform> u: U;
    @vertex fn vs(@location(0) p: vec2<f32>) -> @builtin(position) vec4<f32> {
      return vec4<f32>(p.x * u.xf.x + u.xf.z, p.y * u.xf.y + u.xf.w, 0.0, 1.0);
    }
    @fragment fn fs() -> @location(0) vec4<f32> {
      return vec4<f32>(0.36, 0.83, 0.80, 1.0);
    }`;

  /** Expand polylines → a flat line-list vertex array (each segment = 2 verts). */
  function polylinesToLineList(polylines: number[][][]): Float32Array {
    let segs = 0;
    for (const pl of polylines) if (pl && pl.length >= 2) segs += pl.length - 1;
    const arr = new Float32Array(segs * 4); // 2 verts × 2 floats per segment
    let o = 0;
    for (const pl of polylines) {
      if (!pl || pl.length < 2) continue;
      for (let i = 0; i + 1 < pl.length; i++) {
        arr[o++] = pl[i][0]; arr[o++] = pl[i][1];
        arr[o++] = pl[i + 1][0]; arr[o++] = pl[i + 1][1];
      }
    }
    return arr;
  }

  /** bbox → clip-space fit transform (sx, sy, tx, ty), aspect-preserving letterbox.
   *  sy is NEGATED (Y-flip): the projected 2D frame is Z-down (larger z lower on
   *  screen, SVG-y grows down), while WebGPU clip-y grows UP — so we flip to keep
   *  the same orientation the B·SVG tab shows. */
  function computeFit(
    bbox: { minX: number; minY: number; maxX: number; maxY: number },
    w: number, h: number,
  ): [number, number, number, number] {
    const bw = Math.max(bbox.maxX - bbox.minX, 1e-6);
    const bh = Math.max(bbox.maxY - bbox.minY, 1e-6);
    const cx = (bbox.minX + bbox.maxX) / 2;
    const cy = (bbox.minY + bbox.maxY) / 2;
    const M = 0.9; // 10% letterbox padding
    const scalePx = Math.min((w * M) / bw, (h * M) / bh); // px per world unit (equal both axes)
    const sx = (scalePx * 2) / w;
    const sy = -(scalePx * 2) / h; // Y-flip
    return [sx, sy, -cx * sx, -cy * sy];
  }

  /** ONE render pass: clear to the background, then (if geometry is uploaded)
   *  write the fit uniform + draw the boundary line-list. */
  function render(w: number, h: number) {
    if (!device || !ctx || !pipeline) return;
    const [r, g, b, a] = clearColor;
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: ctx.getCurrentTexture().createView(),
        clearValue: { r, g, b, a },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    if (lastVertices && lastVertexCount >= 2 && lastBBox && vertexBuf) {
      const xf = computeFit(lastBBox, w, h);
      device.queue.writeBuffer(uniformBuf, 0, new Float32Array(xf));
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.setVertexBuffer(0, vertexBuf);
      pass.draw(lastVertexCount);
    }
    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  /** (Re)create the vertex buffer for the current polyline vertices. */
  function uploadVertices(vertices: Float32Array) {
    try { vertexBuf?.destroy?.(); } catch { /* already gone */ }
    vertexBuf = device.createBuffer({
      size: Math.max(vertices.byteLength, 16),
      usage: gpuBU.VERTEX | gpuBU.COPY_DST,
    });
    device.queue.writeBuffer(vertexBuf, 0, vertices);
  }

  /** Drop any uploaded geometry (keeps the device/pipeline) and clear the canvas. */
  function clearGeometry() {
    lastVertices = null; lastVertexCount = 0; lastBBox = null;
    hasGeometry = false; segCount = 0;
    render(width, height);
  }

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
          const info = adapter.info ?? (adapter.requestAdapterInfo ? await adapter.requestAdapterInfo() : null);
          if (info) adapterInfo = [info.vendor, info.architecture, info.description].filter(Boolean).join(' · ');
        } catch { /* info is optional */ }

        const dev = await adapter.requestDevice();
        if (disposed) { try { dev.destroy?.(); } catch { /* ignore */ } return; }
        device = dev;

        // 3) Configure the canvas context.
        const canvas = canvasEl;
        const context = canvas?.getContext('webgpu') as any;
        if (!canvas || !context) {
          status = 'unavailable';
          detail = 'Could not acquire a "webgpu" canvas context.';
          return;
        }
        ctx = context;
        const format = gpu.getPreferredCanvasFormat();
        ctx.configure({ device: dev, format, alphaMode: 'premultiplied' });

        // 4) Build the line pipeline ONCE. GPUBufferUsage is a runtime global —
        //    read it off globalThis so we don't reference a bare TS global (no
        //    @webgpu/types). Fit transform lives in a 16-byte (vec4) uniform.
        gpuBU = (globalThis as any).GPUBufferUsage;
        const module = dev.createShaderModule({ code: WGSL });
        pipeline = dev.createRenderPipeline({
          layout: 'auto',
          vertex: {
            module, entryPoint: 'vs',
            buffers: [{ arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] }],
          },
          fragment: { module, entryPoint: 'fs', targets: [{ format }] },
          primitive: { topology: 'line-list' },
        });
        uniformBuf = dev.createBuffer({ size: 16, usage: gpuBU.UNIFORM | gpuBU.COPY_DST });
        bindGroup = dev.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: [{ binding: 0, resource: { buffer: uniformBuf } }],
        });

        // Initial clear (proof-of-life) — the fetch effect draws geometry next.
        render(width, height);

        if (!disposed) {
          status = 'ok';
          detail = 'GPU device + line pipeline live — projected boundary drawn as GPU lines.';
          deviceReady = true; // gate the fetch effect open
        }
      } catch (e: any) {
        if (!disposed) { status = 'unavailable'; detail = `WebGPU init failed: ${String(e?.message ?? e)}`; }
      }
    })();

    // Dispose: free GPU resources when the tab/pane unmounts.
    return () => {
      disposed = true;
      try { vertexBuf?.destroy?.(); } catch { /* ignore */ }
      try { uniformBuf?.destroy?.(); } catch { /* ignore */ }
      try { device?.destroy?.(); } catch { /* already gone */ }
      device = null; ctx = null; pipeline = null; vertexBuf = null; uniformBuf = null; bindGroup = null;
      deviceReady = false;
    };
  });

  // ── Fetch + draw the projected boundary. Runs when the device is ready and the
  //    source/params (or canvas size) change. Deduped on {source,params} so a
  //    resize just re-fits + redraws the CACHED polylines (no refetch). Mirrors
  //    the B·SVG effect's active-tab-only + content-key discipline (RightPane
  //    only mounts this component when its tab is the active pane's active tab).
  $effect(() => {
    if (!deviceReady) return;
    const w = width, h = height;          // tracked → resize re-fits
    const src = source ?? '';
    const params = paramValues ?? {};
    const key = JSON.stringify({ s: src, p: params });

    // No baked part yet → clear + show the "bake first" hint.
    if (!src.trim()) { lastFetchKey = ''; fetchError = ''; clearGeometry(); return; }

    // Unchanged source/params (only the canvas resized) → re-fit + redraw cache.
    if (key === lastFetchKey) { render(w, h); return; }

    lastFetchKey = key;
    busy = true; fetchError = '';
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/brep/svg', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ source: src, paramValues: params, format: 'polylines' }),
        });
        if (!r.ok) { if (!cancelled) { fetchError = `HTTP ${r.status}`; clearGeometry(); } return; }
        const data = await r.json();
        if (cancelled) return;
        if (data?.supported && Array.isArray(data.polylines) && data.polylines.length && data.bbox) {
          lastBBox = data.bbox;
          lastVertices = polylinesToLineList(data.polylines);
          lastVertexCount = lastVertices.length / 2;
          segCount = lastVertexCount / 2;
          hasGeometry = lastVertexCount >= 2;
          if (hasGeometry) { uploadVertices(lastVertices); render(w, h); }
          else clearGeometry();
        } else {
          fetchError = data?.reason ?? 'no BREP boundary for this part';
          clearGeometry();
        }
      } catch (e: any) {
        if (!cancelled) { fetchError = String(e?.message ?? e); clearGeometry(); }
      } finally {
        if (!cancelled) busy = false;
      }
    })();
    return () => { cancelled = true; };
  });

  // Small overlay message when the canvas has no boundary to show yet.
  let emptyMsg = $derived(
    busy ? 'projecting boundary…'
      : fetchError ? fetchError
      : (!source || !source.trim()) ? 'no boundary yet — bake first'
      : !hasGeometry ? 'no BREP boundary for this part'
      : '',
  );
</script>

<div class="wgpu-view">
  {#if status === 'unavailable'}
    <div class="wgpu-fallback">
      <div class="wgpu-fallback-title">WebGPU unavailable</div>
      <p class="wgpu-fallback-body">{detail || 'This browser or environment does not expose a usable WebGPU device.'}</p>
      <p class="wgpu-fallback-hint">The B·SVG tab renders the same boundary without a GPU — use it as the fallback.</p>
    </div>
  {:else}
    <div class="wgpu-stage" style="width:{width}px; max-width:100%;">
      <canvas bind:this={canvasEl} {width} {height} class="wgpu-canvas"></canvas>
      {#if status === 'ok' && emptyMsg}
        <div class="wgpu-empty">{emptyMsg}</div>
      {/if}
    </div>
    <div class="wgpu-meta" class:ok={status === 'ok'}>
      {#if status === 'probing'}
        <span>probing WebGPU…</span>
      {:else}
        <span title={detail}>✓ WebGPU line render{adapterInfo ? ` · ${adapterInfo}` : ''}{hasGeometry ? ` · ${segCount} segs` : ''}</span>
      {/if}
    </div>
  {/if}
</div>

<style>
  .wgpu-view { display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 8px; height: 100%; min-height: 0; padding: 12px; background: #fff; }
  .wgpu-stage { position: relative; }
  .wgpu-canvas { display: block; max-width: 100%; height: auto; border: 1px solid #e5e7eb; border-radius: 6px;
    background: #0b1220; }
  .wgpu-empty { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    font: 11px Arial; color: #94a3b8; pointer-events: none; text-align: center; padding: 8px; }
  .wgpu-meta { font: 10.5px Arial; color: #6b7280; }
  .wgpu-meta.ok { color: #15803d; }
  .wgpu-fallback { margin: auto; max-width: 380px; padding: 18px 20px; text-align: center;
    background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; }
  .wgpu-fallback-title { font: 700 13px Arial; color: #334155; margin-bottom: 8px; }
  .wgpu-fallback-body { font: 11.5px/1.6 Arial; color: #64748b; margin: 0 0 8px; }
  .wgpu-fallback-hint { font: 11px/1.5 Arial; color: #94a3b8; margin: 0; }
</style>
