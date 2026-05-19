<script lang="ts">
  // Primitives library — Stage G v4 — see plan
  // ~/.claude/plans/components-primitives-split.md.
  //
  // Volume primitives at <volume>/primitives/<id>/{source.ts, meta.json}
  // are editable + savable + deletable. Bundle primitives stay read-only
  // (cloning to volume is how you fork one). Live preview routes through
  // /api/primitives/preview which sandbox-executes the source.
  import { onMount } from 'svelte';
  import { Canvas } from '@threlte/core';
  import { WebGLRenderer } from 'three';
  import { deserializeComponentResult } from '$lib/cad/mesh-serial';
  import { scene } from '$lib/shared/scene-state.svelte';
  import * as THREE from 'three';

  interface Entry {
    id: string;
    source: 'bundle' | 'volume';
    name: string;
    description: string;
    params: Record<string, any>;
    editable: boolean;
  }

  let entries: Entry[] = $state([]);
  let shadows: string[] = $state([]);
  let selected: Entry | null = $state(null);
  let editedSource: string = $state('');
  let serverSource: string = $state('');
  let editedMeta: any = $state({ name: '', description: '', params: {} });
  let paramValues: Record<string, number> = $state({});
  let loading = $state(false);
  let status = $state('');

  let SceneComponent = $state<any>(null);
  let SceneGlbComponent = $state<any>(null);
  let SceneControls = $state<any>(null);
  let geo = $state<any>(null);
  let geoVersion = $state(0);
  let previewError = $state<string | null>(null);
  let previewStatus = $state<string>('idle');
  let stageView = $state<'mesh' | 'glb'>('mesh');

  function createRenderer(canvas: HTMLCanvasElement) {
    return new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  }

  async function refreshList() {
    const r = await fetch('/api/primitives/list');
    const data = await r.json();
    entries = data.merged;
    shadows = data.shadows ?? [];
  }

  async function selectEntry(e: Entry) {
    selected = e;
    editedMeta = {
      name: e.name,
      description: e.description,
      tags: [],
      params: structuredClone($state.snapshot(e.params)),
    };
    paramValues = Object.fromEntries(
      Object.entries(e.params).map(([k, v]) => [k, (v as any).default ?? 0]),
    );
    await loadFromServer();
    rebuildPreview();
  }

  onMount(async () => {
    await refreshList();
    if (entries.length > 0) {
      const initial = entries.find((e) => e.id === 'helix_band') ?? entries[0];
      await selectEntry(initial);
    }
    const [scene, glbScene, controls] = await Promise.all([
      import('$lib/shared/ComponentScene.svelte'),
      import('$lib/shared/ComponentSceneGlb.svelte'),
      import('$lib/shared/SceneControls.svelte'),
    ]);
    SceneComponent = scene.default;
    SceneGlbComponent = glbScene.default;
    SceneControls = controls.default;
    if (selected) rebuildPreview();
  });

  async function loadFromServer() {
    if (!selected) return;
    loading = true;
    status = 'Loading source from server…';
    try {
      const r = await fetch(`/api/primitives/source?name=${encodeURIComponent(selected.id)}`);
      if (!r.ok) {
        status = `Server returned ${r.status}: ${await r.text()}`;
        loading = false;
        return;
      }
      const data = await r.json() as { source: string; origin: string };
      editedSource = data.source;
      serverSource = data.source;
      status = `Loaded from ${data.origin}.`;
    } catch (e: any) {
      status = `Error: ${e?.message ?? e}`;
    }
    loading = false;
  }

  async function rebuildPreview() {
    if (!selected) return;
    previewError = null;
    previewStatus = 'building…';
    const name = selected.id;
    const args = Object.keys(selected.params).map((k) => paramValues[k] ?? 0);
    // Fast path: when the source is unedited bundle code, ask the
    // server to call the bundle helper directly (no sandbox). Sandbox
    // kicks in only for edits or volume primitives.
    const useBundlePath = selected.source === 'bundle' && editedSource === serverSource;
    try {
      const r = await fetch('/api/primitives/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          source: editedSource,
          name,
          params: args,
          mode: useBundlePath ? 'bundle' : 'sandbox',
        }),
      });
      if (!r.ok) {
        previewError = `Preview failed (${r.status}): ${await r.text()}`;
        previewStatus = 'error';
        return;
      }
      const data = await r.json();
      geo = deserializeComponentResult({ full: data.full, cutVC: data.cutVC });
      geoVersion++;
      previewStatus = 'ok';
    } catch (e: any) {
      previewError = `Preview error: ${e?.message ?? e}`;
      previewStatus = 'error';
    }
  }

  async function saveToVolume() {
    if (!selected) return;
    if (!editedSource.trim()) { status = 'Source empty.'; return; }
    loading = true;
    status = 'Saving…';
    try {
      const r = await fetch('/api/primitives/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: selected.id,
          source: editedSource,
          meta: editedMeta,
        }),
      });
      if (!r.ok) {
        status = `Save failed (${r.status}): ${await r.text()}`;
      } else {
        status = `Saved to volume.`;
        await refreshList();
        const updated = entries.find((e) => e.id === selected!.id);
        if (updated) selected = updated;
        serverSource = editedSource;
      }
    } catch (e: any) {
      status = `Error: ${e?.message ?? e}`;
    }
    loading = false;
  }

  async function cloneToVolume() {
    if (!selected) return;
    const newId = prompt(`Clone "${selected.id}" to volume as id:`, `${selected.id}_v2`);
    if (!newId) return;
    if (!/^[a-z][a-z0-9_]*$/i.test(newId)) { status = 'Invalid id'; return; }
    loading = true;
    status = `Cloning to "${newId}"…`;
    try {
      const r = await fetch('/api/primitives/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: newId,
          source: editedSource,
          meta: { ...editedMeta, name: newId },
        }),
      });
      if (!r.ok) { status = `Clone failed: ${await r.text()}`; loading = false; return; }
      status = `Cloned.`;
      await refreshList();
      const created = entries.find((e) => e.id === newId);
      if (created) await selectEntry(created);
    } catch (e: any) {
      status = `Error: ${e?.message ?? e}`;
    }
    loading = false;
  }

  async function deletePrimitive() {
    if (!selected || !selected.editable) return;
    if (!confirm(`Delete volume primitive "${selected.id}"?`)) return;
    loading = true;
    status = `Deleting…`;
    try {
      const r = await fetch(`/api/primitives/delete?id=${encodeURIComponent(selected.id)}`, { method: 'DELETE' });
      if (!r.ok) { status = `Delete failed: ${await r.text()}`; loading = false; return; }
      status = `Deleted.`;
      await refreshList();
      selected = entries[0] ?? null;
      if (selected) await selectEntry(selected);
    } catch (e: any) {
      status = `Error: ${e?.message ?? e}`;
    }
    loading = false;
  }

  function addParam() {
    const name = prompt('New param name (lowercase identifier):');
    if (!name || !/^[a-z][a-z0-9_]*$/i.test(name)) return;
    if (editedMeta.params[name]) { alert(`Param "${name}" already exists`); return; }
    editedMeta.params = {
      ...editedMeta.params,
      [name]: { label: name, min: 0, max: 10, step: 0.1, default: 1 },
    };
    paramValues = { ...paramValues, [name]: 1 };
  }

  function removeParam(name: string) {
    if (!confirm(`Remove param "${name}"?`)) return;
    const { [name]: _, ...rest } = editedMeta.params;
    editedMeta.params = rest;
    const { [name]: __, ...restVal } = paramValues;
    paramValues = restVal;
  }

  let isDirty = $derived(editedSource !== serverSource);
</script>

<div class="prim-page">
  <aside class="prim-rail">
    <header>
      <h2>Primitives</h2>
      <p class="sub">Backend toolkit — raw geometry functions</p>
    </header>

    <div class="prim-list">
      {#each entries as e (e.id)}
        <button
          class="prim-row"
          class:active={selected?.id === e.id}
          type="button"
          onclick={() => selectEntry(e)}
        >
          <span class="prim-name">{e.id}</span>
          <span class="prim-tag" class:vol={e.source === 'volume'}>{e.source === 'volume' ? 'vol' : 'bnd'}</span>
        </button>
      {/each}
    </div>
  </aside>

  <main class="prim-main">
    {#if !selected}
      <div class="placeholder">No primitives yet.</div>
    {:else}
      <header class="prim-head">
        <div>
          <h1>{selected.id}</h1>
          <p class="desc">{selected.description}</p>
        </div>
        <div class="head-actions">
          <button class="prim-btn" type="button" onclick={loadFromServer} disabled={loading}>Reload</button>
          <button class="prim-btn primary" type="button" onclick={rebuildPreview} disabled={loading}>Preview</button>
          {#if selected.editable}
            <button class="prim-btn primary" type="button" onclick={saveToVolume} disabled={loading || !isDirty}>Save</button>
            <button class="prim-btn danger" type="button" onclick={deletePrimitive} disabled={loading}>Delete</button>
          {:else}
            <button class="prim-btn" type="button" onclick={cloneToVolume} disabled={loading}>Clone to volume</button>
          {/if}
        </div>
      </header>

      <div class="prim-split">
        <div class="prim-stage">
          <div class="editor-meta">
            <span class="meta-pill" class:dirty={isDirty}>{isDirty ? 'modified' : 'in sync'}</span>
            <span class="meta-pill src-{selected.source}">{selected.source}</span>
            {#if status}<span class="meta-status">{status}</span>{/if}
          </div>

          <textarea
            class="prim-editor"
            spellcheck="false"
            bind:value={editedSource}
            placeholder="// no source"
          ></textarea>

          <!-- Params editor + sliders -->
          <div class="param-editor">
            <div class="param-head">
              <span>Parameters</span>
              <button class="prim-btn small" type="button" onclick={addParam}>+ Add</button>
            </div>
            {#each Object.entries(editedMeta.params) as [pname, pschema] (pname)}
              {@const ps = pschema as any}
              <div class="param-row">
                <span class="pname">{pname}</span>
                <input
                  class="pslider"
                  type="range"
                  min={ps.min ?? 0}
                  max={ps.max ?? 10}
                  step={ps.step ?? 0.1}
                  value={paramValues[pname] ?? ps.default ?? 0}
                  oninput={(e) => {
                    paramValues = { ...paramValues, [pname]: Number((e.currentTarget as HTMLInputElement).value) };
                  }}
                  onchange={() => rebuildPreview()}
                />
                <input
                  class="pnum"
                  type="number"
                  step={ps.step ?? 0.1}
                  value={paramValues[pname] ?? ps.default ?? 0}
                  oninput={(e) => {
                    paramValues = { ...paramValues, [pname]: Number((e.currentTarget as HTMLInputElement).value) };
                  }}
                  onkeydown={(e) => { if (e.key === 'Enter') rebuildPreview(); }}
                />
                {#if selected.editable}
                  <button class="prim-btn micro" type="button" onclick={() => removeParam(pname)} title="Remove param">×</button>
                {/if}
              </div>
            {/each}
            {#if Object.keys(editedMeta.params).length === 0}
              <div class="param-empty">No params. Add one above.</div>
            {/if}
          </div>
        </div>

        <div class="prim-preview">
          <div class="preview-meta">
            Status: <span class="preview-status-text">{previewStatus}</span>
            <span class="stage-view-toggle">
              <button class="stage-view-btn" class:active={stageView === 'mesh'} type="button" onclick={() => (stageView = 'mesh')}>Mesh</button>
              <button class="stage-view-btn" class:active={stageView === 'glb'} type="button" onclick={() => (stageView = 'glb')}>GLB</button>
            </span>
          </div>
          <div class="preview-stage">
            {#if previewError}
              <div class="preview-error"><strong>Preview error</strong><br />{previewError}</div>
            {:else if !SceneComponent || !geo}
              <div class="preview-loading">{previewStatus}</div>
            {:else if stageView === 'glb'}
              <div class="preview-loading">GLB view available only for bundle-baked primitives. Save then bake via /api/components/glb (deferred).</div>
            {:else}
              <Canvas {createRenderer}>
                {@const Scene = SceneComponent}
                <Scene {geo} {geoVersion} showCutaway={scene.showCutaway} showEdges={scene.showEdges} />
              </Canvas>
              {#if SceneControls}{@const Controls = SceneControls}<Controls />{/if}
            {/if}
          </div>
        </div>
      </div>
    {/if}
  </main>
</div>

<style>
  .prim-page { display: grid; grid-template-columns: 240px 1fr; height: 100%; min-height: 0; font: 13px Arial; color: #222; }
  .prim-rail { border-right: 1px solid #ddd; background: #fafafa; overflow-y: auto; padding: 12px 8px; }
  .prim-rail header { padding: 0 6px 8px; border-bottom: 1px solid #eee; }
  .prim-rail h2 { margin: 0; font: 700 14px Arial; color: #cc2222; }
  .prim-rail .sub { margin: 2px 0 0; font: 11px Arial; color: #777; }
  .prim-list { padding: 8px 0; }
  .prim-row { display: flex; align-items: center; gap: 6px; width: 100%; padding: 6px 8px; margin: 1px 0; background: transparent; border: 0; border-radius: 4px; text-align: left; cursor: pointer; font: inherit; color: inherit; }
  .prim-row:hover { background: #f0e8e8; }
  .prim-row.active { background: #fef0f0; color: #cc2222; }
  .prim-name { font: 600 13px monospace; flex: 1; }
  .prim-tag { font: 9px Arial; padding: 1px 5px; border-radius: 8px; background: #ddd; color: #555; }
  .prim-tag.vol { background: #cc2222; color: #fff; }

  .prim-main { display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
  .prim-head { padding: 12px 16px 8px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
  .prim-head h1 { margin: 0; font: 700 16px monospace; color: #cc2222; }
  .prim-head .desc { margin: 4px 0 0; color: #555; max-width: 540px; font-size: 12px; }
  .head-actions { display: flex; gap: 6px; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end; }

  .prim-split { display: grid; grid-template-columns: 1fr 1fr; flex: 1; min-height: 0; overflow: hidden; }
  .prim-stage { padding: 12px 16px; border-right: 1px solid #eee; display: flex; flex-direction: column; min-height: 0; gap: 8px; }
  .editor-meta { display: flex; align-items: center; gap: 8px; }
  .meta-pill { font: 10px Arial; color: #555; background: #f0f0f0; padding: 2px 8px; border-radius: 10px; }
  .meta-pill.dirty { background: #fff8e6; color: #6a5500; }
  .meta-pill.src-volume { background: #cc2222; color: #fff; }
  .meta-pill.src-bundle { background: #999; color: #fff; }
  .meta-status { font: 11px Arial; color: #888; }
  .prim-editor { flex: 1; min-height: 100px; background: #fafafa; border: 1px solid #ddd; border-radius: 4px; padding: 12px; font: 12px/1.5 monospace; color: #222; resize: none; }
  .prim-editor:focus { outline: 2px solid #cc2222; outline-offset: -2px; }

  .param-editor { border: 1px solid #ddd; border-radius: 4px; padding: 8px; background: #fff; max-height: 35%; overflow-y: auto; }
  .param-head { display: flex; justify-content: space-between; align-items: center; font: 700 11px Arial; color: #555; margin-bottom: 6px; }
  .param-row { display: grid; grid-template-columns: 80px 1fr 70px 22px; align-items: center; gap: 6px; padding: 3px 0; }
  .pname { font: 11px monospace; }
  .pslider { width: 100%; }
  .pnum { font: 11px monospace; padding: 2px 4px; border: 1px solid #ccc; border-radius: 3px; }
  .param-empty { font-size: 11px; color: #999; padding: 4px 0; }

  .prim-preview { padding: 12px 16px; display: flex; flex-direction: column; min-height: 0; background: #1a1a1a; }
  .preview-meta { font: 11px Arial; color: #ccc; padding-bottom: 6px; display: flex; align-items: center; gap: 10px; }
  .preview-status-text { color: #ffd87a; font-family: monospace; }
  .preview-stage { flex: 1; min-height: 0; background: #2a2a2a; border-radius: 4px; position: relative; overflow: hidden; }
  .preview-loading, .preview-empty, .preview-error { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #aaa; padding: 12px; text-align: center; }
  .preview-error { color: #ff8888; flex-direction: column; gap: 6px; font-size: 12px; }

  .stage-view-toggle { display: inline-flex; background: #333; border-radius: 4px; padding: 2px; margin-left: auto; }
  .stage-view-btn { background: transparent; border: 0; color: #aaa; padding: 2px 10px; cursor: pointer; font: 11px Arial; border-radius: 3px; }
  .stage-view-btn.active { background: #cc2222; color: #fff; }

  .prim-btn { padding: 5px 10px; border: 1px solid #ccc; border-radius: 4px; background: #fff; font: 12px Arial; cursor: pointer; }
  .prim-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .prim-btn.primary { background: #cc2222; color: #fff; border-color: #cc2222; }
  .prim-btn.primary:disabled { background: #888; border-color: #888; }
  .prim-btn.danger { background: #fff; color: #cc2222; border-color: #cc2222; }
  .prim-btn.small { padding: 2px 8px; font-size: 10px; }
  .prim-btn.micro { padding: 0 5px; font-size: 10px; }

  .placeholder { flex: 1; display: flex; align-items: center; justify-content: center; color: #777; }
</style>
