<script lang="ts">
  // Primitives library — see ~/.claude/plans/components-primitives-split.md.
  //
  // v3: real 3D preview (wrapped in Canvas + SceneControls — v2 missed
  // the Canvas wrapper, so the scene never mounted). Two source-load
  // buttons (server vs local-bundle) and loud error surfacing.
  import { onMount } from 'svelte';
  import { Canvas } from '@threlte/core';
  import { WebGLRenderer } from 'three';
  import { discoverHelpers, discoverOperators, type HelperMeta, type OperatorMeta } from '$lib/cad/manifold-helpers-meta';

  type Entry = { name: string; kind: 'prim' | 'op'; sig: string; desc: string };

  const DEMO_COMPONENT: Record<string, string> = {
    helix_band: 'thread_helix',
    cyl: 'tapered_cone',
    tube: 'hollow_cylinder',
    profile_extrude: 'profile_extrude_demo',
  };

  let entries: Entry[] = $state([]);
  let selected: Entry | null = $state(null);
  let editedSource: string = $state('');
  let serverSource: string = $state('');
  let localBundleSource: string = $state('');
  let primSource: string = $state('');
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

  onMount(async () => {
    const prims = discoverHelpers();
    const ops = discoverOperators();
    entries = [
      ...prims.map((p): Entry => ({ name: p.name, kind: 'prim', sig: `(${p.props.map((pr) => pr.name).join(', ')})`, desc: p.desc })),
      ...ops.map((o): Entry => ({ name: o.name, kind: 'op', sig: `[${o.label}]`, desc: o.desc })),
    ];
    if (entries.length > 0) selected = entries.find((e) => e.name === 'helix_band') ?? entries[0];

    previewStatus = 'loading bundle source…';
    const mod = await import('$lib/cad/manifold-helpers.ts?raw');
    primSource = mod.default;

    previewStatus = 'loading scene components…';
    const [scene, glbScene, controls] = await Promise.all([
      import('$lib/shared/ComponentScene.svelte'),
      import('$lib/shared/ComponentSceneGlb.svelte'),
      import('$lib/shared/SceneControls.svelte'),
    ]);
    SceneComponent = scene.default;
    SceneGlbComponent = glbScene.default;
    SceneControls = controls.default;

    refreshFromBuiltIn();
  });

  function extractSource(src: string, name: string): string {
    const needle = `export function ${name}`;
    const idx = src.indexOf(needle);
    if (idx < 0) return '';
    let i = idx + needle.length;
    while (i < src.length && src[i] !== '{') i++;
    if (i >= src.length) return '';
    let depth = 0;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    let docStart = idx;
    const docMatch = src.lastIndexOf('/**', idx);
    if (docMatch >= 0 && src.slice(docMatch, idx).match(/\*\/\s*$/)) {
      docStart = docMatch;
    }
    return src.slice(docStart, i);
  }

  function refreshFromBuiltIn() {
    if (!selected) return;
    const src = extractSource(primSource, selected.name);
    editedSource = src;
    serverSource = src;
    localBundleSource = src;
    status = '';
  }

  async function rebuildPreview() {
    if (!selected) {
      geo = null;
      previewError = null;
      previewStatus = 'idle';
      return;
    }
    if (selected.kind === 'op') {
      geo = null;
      previewError = null;
      previewStatus = 'operator — no standalone render';
      return;
    }
    const compId = DEMO_COMPONENT[selected.name] ?? selected.name;
    previewStatus = `building ${compId}…`;
    previewError = null;
    try {
      const [{ initManifold, setCircularSegmentMode }, { buildComponent }, { metaById }] = await Promise.all([
        import('$lib/cad/manifold-helpers'),
        import('$lib/cad/builder'),
        import('$lib/cad/components'),
      ]);
      await initManifold();
      setCircularSegmentMode('default');
      const meta = metaById(compId);
      if (!meta) {
        previewError = `No demo component "${compId}" registered. Restart \`bun run dev\` to pick up new bundle components.`;
        geo = null;
        previewStatus = 'error';
        return;
      }
      const defaults: Record<string, number> = {};
      for (const [k, schema] of Object.entries(meta.params)) {
        defaults[k] = (schema as any).default ?? 0;
      }
      const result = buildComponent(compId, defaults);
      geo = result;
      geoVersion++;
      previewStatus = `built ${compId} (${result?.full?.positions?.length ? Math.floor(result.full.positions.length / 3) : '?'} verts)`;
    } catch (e: any) {
      previewError = `Build failed: ${e?.message ?? e}`;
      geo = null;
      previewStatus = 'error';
    }
  }

  $effect(() => {
    if (selected && primSource) refreshFromBuiltIn();
  });

  $effect(() => {
    if (selected && primSource && SceneComponent) rebuildPreview();
  });

  async function loadFromServer() {
    if (!selected) return;
    loading = true;
    status = 'Loading from server…';
    try {
      const r = await fetch(`/api/primitives/source?name=${encodeURIComponent(selected.name)}`);
      if (!r.ok) {
        status = `Server returned ${r.status}: ${await r.text()}`;
        loading = false;
        return;
      }
      const data = await r.json() as { source: string };
      editedSource = data.source;
      serverSource = data.source;
      status = 'Loaded from server.';
    } catch (e: any) {
      status = `Error: ${e?.message ?? e}`;
    }
    loading = false;
  }

  function loadFromLocal() {
    if (!selected) return;
    editedSource = localBundleSource;
    status = 'Loaded from in-memory client bundle.';
  }

  let isDirty = $derived(editedSource !== serverSource);

  // GLB URL — bundle primitives serve from /components/<id>.glb (Vite
  // static asset baked at build time). Cache-busted on geoVersion so a
  // rebuild refreshes both panes. Library demo components would route
  // through /api/components/glb but every DEMO_COMPONENT today is a
  // bundle primitive.
  let demoCompId = $derived(selected ? (DEMO_COMPONENT[selected.name] ?? selected.name) : '');
  let glbUrl = $derived.by(() => {
    if (!demoCompId || selected?.kind === 'op') return '';
    return `/components/${demoCompId}.glb?t=${geoVersion}`;
  });
</script>

<div class="prim-page">
  <aside class="prim-rail">
    <header>
      <h2>Primitives</h2>
      <p class="sub">Backend toolkit — raw geometry functions</p>
    </header>

    <div class="prim-list">
      {#each entries as e (e.name)}
        <button
          class="prim-row"
          class:active={selected?.name === e.name}
          type="button"
          onclick={() => (selected = e)}
        >
          <span class="prim-name">{e.name}</span>
          <span class="prim-sig">{e.sig}</span>
        </button>
      {/each}
    </div>
  </aside>

  <main class="prim-main">
    {#if !selected}
      <div class="placeholder">Pick a primitive on the left.</div>
    {:else}
      <header class="prim-head">
        <div>
          <h1>{selected.name}</h1>
          <p class="desc">{selected.desc}</p>
        </div>
        <div class="head-actions">
          <button class="prim-btn" type="button" onclick={loadFromLocal} title="Read source from the in-memory client bundle">Load local</button>
          <button class="prim-btn" type="button" onclick={loadFromServer} disabled={loading} title="Read source from disk via /api/primitives/source">
            {loading ? 'Loading…' : 'Load from server'}
          </button>
          <button class="prim-btn" type="button" onclick={() => rebuildPreview()} title="Rebuild the 3D preview">Rebuild preview</button>
          <button class="prim-btn" type="button" disabled title="Coming next">Save to volume</button>
          <button class="prim-btn" type="button" disabled title="Coming next">AI assist</button>
        </div>
      </header>

      <div class="prim-split">
        <div class="prim-stage">
          <div class="editor-meta">
            <span class="meta-pill" class:dirty={isDirty}>{isDirty ? 'modified (not saved)' : 'in sync with server'}</span>
            {#if status}<span class="meta-status">{status}</span>{/if}
          </div>
          <textarea
            class="prim-editor"
            spellcheck="false"
            bind:value={editedSource}
            placeholder="// no source — select a primitive"
          ></textarea>
          <div class="editor-footnote">
            Edits in-memory only — Save to volume + Monaco syntax highlighting land in v4.
          </div>
        </div>

        <div class="prim-preview">
          <div class="preview-meta">
            {#if selected.kind === 'op'}
              Operator — no standalone render.
            {:else}
              Preview: <code>{demoCompId}</code>
              {#if DEMO_COMPONENT[selected.name]}<span class="preview-meta-sub">(calls <code>{selected.name}</code> internally)</span>{/if}
              · status: <span class="preview-status-text">{previewStatus}</span>
            {/if}
            {#if selected.kind === 'prim'}
              <span class="stage-view-toggle">
                <button class="stage-view-btn" class:active={stageView === 'mesh'} type="button" onclick={() => (stageView = 'mesh')}>Mesh</button>
                <button class="stage-view-btn" class:active={stageView === 'glb'} type="button" onclick={() => (stageView = 'glb')}>GLB</button>
              </span>
            {/if}
          </div>
          <div class="preview-stage">
            {#if previewError}
              <div class="preview-error">
                <strong>Preview error:</strong>
                <br />
                {previewError}
              </div>
            {:else if selected.kind === 'op'}
              <div class="preview-empty">Operators transform an existing manifold — no standalone render.</div>
            {:else if stageView === 'glb'}
              {#if SceneGlbComponent}
                {@const GlbScene = SceneGlbComponent}
                <Canvas {createRenderer}>
                  <GlbScene url={glbUrl} />
                </Canvas>
                {#if SceneControls}{@const Controls = SceneControls}<Controls />{/if}
                <div class="stage-glb-hint" title={glbUrl}>
                  served from <code>{glbUrl}</code>
                </div>
              {:else}
                <div class="preview-loading">Loading GLB scene…</div>
              {/if}
            {:else if !SceneComponent || !geo}
              <div class="preview-loading">{previewStatus}</div>
            {:else}
              <Canvas {createRenderer}>
                {@const Scene = SceneComponent}
                <Scene {geo} {geoVersion} showCutaway={true} showEdges={true} />
              </Canvas>
              {#if SceneControls}
                {@const Controls = SceneControls}
                <Controls />
              {/if}
            {/if}
          </div>
        </div>
      </div>
    {/if}
  </main>
</div>

<style>
  .prim-page {
    display: grid; grid-template-columns: 260px 1fr;
    height: 100%; min-height: 0;
    font: 13px Arial; color: #222;
  }
  .prim-rail {
    border-right: 1px solid #ddd;
    background: #fafafa;
    overflow-y: auto;
    padding: 12px 8px;
  }
  .prim-rail header { padding: 0 6px 8px; border-bottom: 1px solid #eee; }
  .prim-rail h2 { margin: 0; font: 700 14px Arial; color: #cc2222; }
  .prim-rail .sub { margin: 2px 0 0; font: 11px Arial; color: #777; }
  .prim-list { padding: 8px 0; }
  .prim-row {
    display: flex; align-items: center; gap: 6px;
    width: 100%; padding: 6px 8px; margin: 1px 0;
    background: transparent; border: 0; border-radius: 4px;
    text-align: left; cursor: pointer; font: inherit; color: inherit;
  }
  .prim-row:hover { background: #f0e8e8; }
  .prim-row.active { background: #fef0f0; color: #cc2222; }
  .prim-name { font: 600 13px monospace; }
  .prim-sig { font: 11px monospace; color: #999; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .prim-main {
    display: flex; flex-direction: column;
    min-height: 0; overflow: hidden;
  }
  .prim-head {
    padding: 14px 18px 10px; border-bottom: 1px solid #eee;
    display: flex; justify-content: space-between; align-items: flex-start;
    gap: 12px;
  }
  .prim-head h1 { margin: 0; font: 700 18px monospace; color: #cc2222; }
  .prim-head .desc { margin: 4px 0 0; color: #555; max-width: 540px; }
  .head-actions { display: flex; gap: 6px; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end; }

  .prim-split {
    display: grid; grid-template-columns: 1fr 1fr;
    flex: 1; min-height: 0; overflow: hidden;
  }
  .prim-stage {
    padding: 14px 18px;
    border-right: 1px solid #eee;
    display: flex; flex-direction: column;
    min-height: 0;
  }
  .editor-meta {
    display: flex; align-items: center; gap: 10px;
    margin-bottom: 6px;
  }
  .meta-pill {
    font: 11px Arial; color: #555;
    background: #f0f0f0; padding: 2px 8px; border-radius: 10px;
  }
  .meta-pill.dirty { background: #fff8e6; color: #6a5500; }
  .meta-status { font: 11px Arial; color: #888; }
  .prim-editor {
    flex: 1; min-height: 0;
    background: #fafafa; border: 1px solid #ddd; border-radius: 4px;
    padding: 12px; font: 12px/1.5 monospace; color: #222;
    resize: none;
  }
  .prim-editor:focus { outline: 2px solid #cc2222; outline-offset: -2px; }
  .editor-footnote {
    margin-top: 6px;
    font: 11px Arial; color: #888;
  }

  .prim-preview {
    padding: 14px 18px;
    display: flex; flex-direction: column;
    min-height: 0;
    background: #1a1a1a;
  }
  .preview-meta {
    font: 11px Arial; color: #ccc;
    padding-bottom: 8px;
  }
  .preview-meta code { background: #333; padding: 1px 6px; border-radius: 3px; color: #fff; font: 11px monospace; }
  .preview-meta-sub { color: #888; }
  .preview-status-text { color: #ffd87a; font-family: monospace; }
  .preview-stage {
    flex: 1; min-height: 0;
    background: #2a2a2a; border-radius: 4px;
    position: relative;
    overflow: hidden;
  }
  .preview-loading, .preview-empty, .preview-error {
    position: absolute; inset: 0;
    display: flex; align-items: center; justify-content: center;
    color: #aaa; padding: 12px;
    text-align: center;
  }
  .preview-error {
    color: #ff8888;
    flex-direction: column; gap: 6px;
    font-size: 12px;
  }
  .preview-error strong { color: #ffaaaa; }

  .stage-view-toggle {
    display: inline-flex; margin-left: 10px;
    background: #333; border-radius: 4px; padding: 2px;
  }
  .stage-view-btn {
    background: transparent; border: 0; color: #aaa;
    padding: 2px 10px; cursor: pointer; font: 11px Arial;
    border-radius: 3px;
  }
  .stage-view-btn.active { background: #cc2222; color: #fff; }
  .stage-view-btn:hover:not(.active) { color: #ddd; }
  .stage-glb-hint {
    position: absolute; bottom: 8px; right: 8px;
    background: rgba(0, 0, 0, 0.7); color: #ddd;
    padding: 4px 8px; border-radius: 3px;
    font: 10px monospace;
  }
  .stage-glb-hint code { color: #ffd87a; }

  .prim-btn {
    padding: 6px 12px; border: 1px solid #ccc; border-radius: 4px;
    background: #fff; font: inherit; cursor: pointer;
  }
  .prim-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .placeholder {
    flex: 1; display: flex; align-items: center; justify-content: center;
    color: #777;
  }
</style>
