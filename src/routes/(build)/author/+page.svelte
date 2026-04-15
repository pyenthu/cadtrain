<script lang="ts">
  import { Canvas } from '@threlte/core';
  import { WebGLRenderer } from 'three';
  import { initManifold } from '$lib/components/builder';
  import { COMPONENTS } from '$lib/components/library';
  import { buildAuthored } from '$lib/authoring/compose';
  import { emptyAuthoredComponent, type AuthoredComponent, type AuthoredPart, type AuthoredOp, type CsgOpKind } from '$lib/authoring/schema';

  function createRenderer(canvas: HTMLCanvasElement) {
    return new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  }

  let ready = $state(false);
  let geo = $state<any>(null);
  let geoVersion = $state(0);
  let buildTime = $state(0);
  let buildError = $state<string | null>(null);
  let showCutaway = $state(true);
  let showEdges = $state(true);

  let spec = $state<AuthoredComponent>(emptyAuthoredComponent());

  let SceneComponent = $state<any>(null);
  $effect(() => {
    import('$lib/shared/ComponentScene.svelte').then(m => { SceneComponent = m.default; });
    initManifold().then(() => { ready = true; });
  });

  let specKey = $derived(JSON.stringify(spec));
  $effect(() => {
    const _k = specKey;
    if (!ready) return;
    if (spec.parts.length === 0) {
      geo = null;
      buildError = null;
      return;
    }
    const t0 = performance.now();
    setTimeout(async () => {
      try {
        geo = await buildAuthored(spec);
        geoVersion++;
        buildTime = performance.now() - t0;
        buildError = null;
      } catch (e: any) {
        buildError = e?.message ?? String(e);
      }
    }, 10);
  });

  function nextPartId(): string {
    let n = 0;
    while (spec.parts.some(p => p.id === `p${n}`)) n++;
    return `p${n}`;
  }

  function nextOpId(): string {
    let n = 0;
    while (spec.ops.some(o => o.out === `op${n}`)) n++;
    return `op${n}`;
  }

  function addPart() {
    const defaultPrim = COMPONENTS[0];
    const part: AuthoredPart = {
      id: nextPartId(),
      prim: defaultPrim.id,
      params: structuredClone(defaultPrim.defaults),
    };
    spec.parts = [...spec.parts, part];
  }

  function removePart(idx: number) {
    const removed = spec.parts[idx];
    spec.parts = spec.parts.filter((_, i) => i !== idx);
    spec.ops = spec.ops.filter(o => !o.inputs.includes(removed.id));
  }

  function changePrim(idx: number, newPrim: string) {
    const def = COMPONENTS.find(c => c.id === newPrim);
    if (!def) return;
    spec.parts[idx].prim = newPrim;
    spec.parts[idx].params = structuredClone(def.defaults);
  }

  function addOp() {
    if (spec.parts.length < 2 && spec.ops.length === 0) return;
    const availableIds = [...spec.parts.map(p => p.id), ...spec.ops.map(o => o.out)];
    const op: AuthoredOp = {
      op: 'union',
      inputs: availableIds.slice(0, 2),
      out: nextOpId(),
    };
    spec.ops = [...spec.ops, op];
  }

  function removeOp(idx: number) {
    const removed = spec.ops[idx];
    spec.ops = spec.ops
      .filter((_, i) => i !== idx)
      .filter(o => !o.inputs.includes(removed.out));
  }

  function paramDef(primId: string, key: string) {
    const def = COMPONENTS.find(c => c.id === primId);
    return def?.params[key];
  }

  function availableIdsFor(opIdx: number): string[] {
    const partIds = spec.parts.map(p => p.id);
    const priorOpIds = spec.ops.slice(0, opIdx).map(o => o.out);
    return [...partIds, ...priorOpIds];
  }
</script>

<div class="layout">
  <div class="sidebar">
    <div class="sec">
      <div class="sec-h">Parts <button class="add" onclick={addPart}>+</button></div>
      {#if spec.parts.length === 0}
        <div class="empty">No parts — click + to add a primitive.</div>
      {/if}
      {#each spec.parts as part, i}
        <div class="part">
          <div class="part-head">
            <span class="pid">{part.id}</span>
            <select bind:value={part.prim} onchange={(e) => changePrim(i, (e.target as HTMLSelectElement).value)}>
              {#each COMPONENTS as c}
                <option value={c.id}>{c.name}</option>
              {/each}
            </select>
            <button class="rm" onclick={() => removePart(i)}>×</button>
          </div>
          <div class="params">
            {#each Object.keys(part.params) as key}
              {@const def = paramDef(part.prim, key)}
              {#if def}
                <div class="pr">
                  <span class="lbl">{def.label}</span>
                  <input type="range" min={def.min} max={def.max} step={def.step} bind:value={part.params[key]} />
                  <input type="number" step={def.step} bind:value={part.params[key]} />
                </div>
              {/if}
            {/each}
          </div>
          <details class="tx">
            <summary>Transform</summary>
            <div class="tx-grid">
              <label>tx<input type="number" step="0.1" value={part.transform?.tx ?? 0} oninput={(e) => {
                part.transform = { ...part.transform, tx: parseFloat((e.target as HTMLInputElement).value) || 0 };
              }} /></label>
              <label>ty<input type="number" step="0.1" value={part.transform?.ty ?? 0} oninput={(e) => {
                part.transform = { ...part.transform, ty: parseFloat((e.target as HTMLInputElement).value) || 0 };
              }} /></label>
              <label>tz<input type="number" step="0.1" value={part.transform?.tz ?? 0} oninput={(e) => {
                part.transform = { ...part.transform, tz: parseFloat((e.target as HTMLInputElement).value) || 0 };
              }} /></label>
              <label>rx<input type="number" step="0.1" value={part.transform?.rx ?? 0} oninput={(e) => {
                part.transform = { ...part.transform, rx: parseFloat((e.target as HTMLInputElement).value) || 0 };
              }} /></label>
              <label>ry<input type="number" step="0.1" value={part.transform?.ry ?? 0} oninput={(e) => {
                part.transform = { ...part.transform, ry: parseFloat((e.target as HTMLInputElement).value) || 0 };
              }} /></label>
              <label>rz<input type="number" step="0.1" value={part.transform?.rz ?? 0} oninput={(e) => {
                part.transform = { ...part.transform, rz: parseFloat((e.target as HTMLInputElement).value) || 0 };
              }} /></label>
            </div>
          </details>
        </div>
      {/each}
    </div>

    <div class="sec">
      <div class="sec-h">Ops <button class="add" onclick={addOp} disabled={spec.parts.length < 2}>+</button></div>
      {#if spec.ops.length === 0}
        <div class="empty">No ops — parts will be unioned implicitly.</div>
      {/if}
      {#each spec.ops as op, i}
        <div class="op">
          <div class="op-head">
            <span class="pid">{op.out}</span>
            <select bind:value={op.op}>
              <option value="union">union</option>
              <option value="subtract">subtract</option>
              <option value="intersect">intersect</option>
            </select>
            <button class="rm" onclick={() => removeOp(i)}>×</button>
          </div>
          <div class="op-inputs">
            {#each op.inputs as _, inIdx}
              <select bind:value={op.inputs[inIdx]}>
                {#each availableIdsFor(i) as id}
                  <option value={id}>{id}</option>
                {/each}
              </select>
            {/each}
            <button class="add-in" onclick={() => {
              op.inputs = [...op.inputs, availableIdsFor(i)[0] ?? ''];
            }}>+ input</button>
            {#if op.inputs.length > 2}
              <button class="rm-in" onclick={() => {
                op.inputs = op.inputs.slice(0, -1);
              }}>− input</button>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  </div>

  <div class="viewport">
    <div class="vp-header">
      Authored Component <span class="ms">{buildTime.toFixed(0)}ms · {spec.parts.length} parts · {spec.ops.length} ops</span>
    </div>
    {#if buildError}
      <div class="err">Error: {buildError}</div>
    {/if}
    {#if SceneComponent && geo}
      <Canvas {createRenderer}>
        {@const Scene = SceneComponent}
        <Scene {geo} {geoVersion} {showCutaway} {showEdges} />
      </Canvas>
    {:else if !buildError}
      <div class="empty-viewport">Add a part to see the preview.</div>
    {/if}
    <div class="controls">
      <label><input type="checkbox" bind:checked={showCutaway} /> Cross-section</label>
      <label><input type="checkbox" bind:checked={showEdges} /> Edges</label>
    </div>
  </div>

  <div class="meta">
    <div class="sec-h">Metadata</div>
    <label>ID<input type="text" bind:value={spec.id} placeholder="e.g. my_sub" /></label>
    <label>Name<input type="text" bind:value={spec.name} placeholder="e.g. My Bottom Sub" /></label>
    <label>Description<textarea bind:value={spec.description} rows="3" placeholder="What is this component?"></textarea></label>
    <label>Tags<input type="text" placeholder="comma,separated" oninput={(e) => {
      spec.tags = (e.target as HTMLInputElement).value.split(',').map(t => t.trim()).filter(Boolean);
    }} /></label>
    <button class="save" disabled>Save (Phase 3)</button>
  </div>
</div>

<style>
  .layout { display: flex; height: 100%; font-family: Arial, sans-serif; }
  .sidebar { width: 320px; min-width: 320px; background: #f5f5f5; border-right: 1px solid #ddd; overflow-y: auto; padding: 8px; }
  .sec { margin-bottom: 16px; }
  .sec-h { display: flex; justify-content: space-between; align-items: center; font: bold 11px Arial; color: #666; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
  .add { background: #cc2222; color: white; border: none; border-radius: 3px; padding: 2px 8px; font-weight: bold; cursor: pointer; font-size: 12px; }
  .add:disabled { background: #aaa; cursor: not-allowed; }
  .empty { font: 10px Arial; color: #999; padding: 4px 0; }
  .part, .op { background: white; border: 1px solid #e0e0e0; border-radius: 4px; padding: 6px; margin-bottom: 6px; }
  .part-head, .op-head { display: flex; gap: 4px; align-items: center; margin-bottom: 4px; }
  .pid { font: bold 10px monospace; background: #eee; padding: 2px 6px; border-radius: 3px; color: #555; }
  .part-head select, .op-head select, .op-inputs select { flex: 1; font-size: 11px; padding: 2px 4px; border: 1px solid #ddd; border-radius: 3px; }
  .rm { background: #eee; border: none; color: #888; cursor: pointer; padding: 0 6px; border-radius: 3px; font-size: 14px; }
  .rm:hover { background: #ffd6d6; color: #cc2222; }
  .pr { display: flex; align-items: center; gap: 4px; margin: 2px 0; }
  .lbl { width: 60px; font-size: 9px; color: #777; flex-shrink: 0; }
  .pr input[type="range"] { flex: 1; height: 3px; accent-color: #cc2222; }
  .pr input[type="number"] { width: 40px; font: 9px monospace; border: 1px solid #ddd; border-radius: 3px; padding: 1px 3px; text-align: right; }
  .tx summary { font-size: 10px; color: #666; cursor: pointer; padding: 2px 0; }
  .tx-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 2px; padding: 4px; }
  .tx-grid label { font-size: 9px; color: #777; display: flex; flex-direction: column; gap: 1px; }
  .tx-grid input { width: 100%; font: 9px monospace; border: 1px solid #ddd; border-radius: 2px; padding: 1px 3px; box-sizing: border-box; }
  .op-inputs { display: flex; gap: 3px; flex-wrap: wrap; align-items: center; }
  .add-in, .rm-in { font: 9px Arial; background: #eee; border: none; padding: 2px 6px; border-radius: 3px; cursor: pointer; color: #666; }
  .viewport { flex: 1; position: relative; min-width: 0; background: white; }
  .vp-header { position: absolute; top: 8px; left: 16px; font: bold 13px Arial; color: #333; z-index: 10; }
  .ms { font-size: 9px; color: #888; font-weight: normal; margin-left: 6px; }
  .err { position: absolute; top: 40px; left: 16px; right: 16px; background: #ffe0e0; border: 1px solid #cc2222; color: #cc2222; padding: 8px; border-radius: 4px; font: 11px monospace; z-index: 20; }
  .empty-viewport { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #aaa; font-size: 13px; }
  .controls { position: absolute; bottom: 12px; right: 12px; display: flex; gap: 8px; background: rgba(255,255,255,0.9); padding: 6px 10px; border-radius: 4px; z-index: 10; }
  .controls label { font-size: 11px; display: flex; gap: 4px; align-items: center; cursor: pointer; }
  .meta { width: 240px; min-width: 240px; background: #fafafa; border-left: 1px solid #ddd; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
  .meta label { font: 10px Arial; color: #666; display: flex; flex-direction: column; gap: 2px; }
  .meta input, .meta textarea { font: 11px Arial; padding: 4px 6px; border: 1px solid #ddd; border-radius: 3px; font-family: Arial, sans-serif; }
  .save { margin-top: auto; background: #cc2222; color: white; border: none; padding: 8px; border-radius: 4px; font: bold 12px Arial; cursor: pointer; }
  .save:disabled { background: #aaa; cursor: not-allowed; }
</style>
