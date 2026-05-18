<script lang="ts">
  // Primitives library — see ~/.claude/plans/components-primitives-split.md.
  //
  // v2 adds the visual preview pane: each primitive maps to a demo
  // component (or itself, if it IS a component) which is built client-
  // side via buildComponent and rendered in ComponentScene. Params
  // for the demo come from HELPER_DEFAULTS / the component's
  // meta.params.default. Bundle primitives only for now; volume
  // primitives ship with Stage G v3.
  import { onMount } from 'svelte';
  import { discoverHelpers, discoverOperators, type HelperMeta, type OperatorMeta } from '$lib/cad/manifold-helpers-meta';

  type Entry = { name: string; kind: 'prim' | 'op'; sig: string; desc: string };

  // Each primitive maps to a component that renders it visually. mv/rot
  // (operators) have no standalone render — they need a manifold input,
  // so they fall back to "no preview".
  const DEMO_COMPONENT: Record<string, string> = {
    helix_band: 'thread_helix',
    cyl: 'tapered_cone',
    tube: 'hollow_cylinder',
  };

  let entries: Entry[] = $state([]);
  let selected: Entry | null = $state(null);
  let editedSource: string = $state('');
  let serverSource: string = $state('');
  let primSource: string = $state('');
  let loading = $state(false);
  let status = $state('');

  // Scene loader + state. Lazy-imported because Threlte / ManifoldCAD
  // can't SSR — same pattern as /components.
  let SceneComponent = $state<any>(null);
  let geo = $state<any>(null);
  let geoVersion = $state(0);
  let buildError = $state<string | null>(null);

  onMount(async () => {
    const prims = discoverHelpers();
    const ops = discoverOperators();
    entries = [
      ...prims.map((p): Entry => ({ name: p.name, kind: 'prim', sig: `(${p.props.map((pr) => pr.name).join(', ')})`, desc: p.desc })),
      ...ops.map((o): Entry => ({ name: o.name, kind: 'op', sig: `[${o.label}]`, desc: o.desc })),
    ];
    if (entries.length > 0) selected = entries.find((e) => e.name === 'helix_band') ?? entries[0];
    const mod = await import('$lib/cad/manifold-helpers.ts?raw');
    primSource = mod.default;
    const scene = await import('$lib/shared/ComponentScene.svelte');
    SceneComponent = scene.default;
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
    status = '';
  }

  // Build geometry for the selected primitive via its DEMO_COMPONENT
  // (the bundle component that wraps the primitive). Operators (mv/rot)
  // have no standalone render — they need an input manifold — so the
  // preview pane shows a placeholder for them.
  async function rebuildPreview() {
    if (!selected) return;
    if (selected.kind === 'op') {
      geo = null;
      buildError = null;
      return;
    }
    const compId = DEMO_COMPONENT[selected.name] ?? selected.name;
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
        buildError = `No demo component "${compId}" — primitive has no visual wrapper yet.`;
        geo = null;
        return;
      }
      const defaults: Record<string, number> = {};
      for (const [k, schema] of Object.entries(meta.params)) {
        defaults[k] = (schema as any).default ?? 0;
      }
      const result = buildComponent(compId, defaults);
      geo = result;
      geoVersion++;
      buildError = null;
    } catch (e: any) {
      buildError = `Build failed: ${e?.message ?? e}`;
      geo = null;
    }
  }

  $effect(() => {
    if (selected && primSource) refreshFromBuiltIn();
  });

  // Trigger rebuild whenever selection changes (after primSource is loaded
  // + Scene is mounted, so the panel is ready to display).
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

  let isDirty = $derived(editedSource !== serverSource);
  let demoCompId = $derived(selected ? (DEMO_COMPONENT[selected.name] ?? selected.name) : '');
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
          <button class="prim-btn" type="button" onclick={loadFromServer} disabled={loading}>
            {loading ? 'Loading…' : 'Load from server'}
          </button>
          <button class="prim-btn" type="button" disabled title="Coming next">Save to volume</button>
          <button class="prim-btn" type="button" disabled title="Coming next">AI assist</button>
        </div>
      </header>

      <div class="prim-split">
        <!-- Left: editor -->
        <div class="prim-stage">
          <div class="editor-meta">
            <span class="meta-pill" class:dirty={isDirty}>{isDirty ? 'modified (not saved)' : 'in sync with bundle'}</span>
            {#if status}<span class="meta-status">{status}</span>{/if}
          </div>
          <textarea
            class="prim-editor"
            spellcheck="false"
            bind:value={editedSource}
            placeholder="// no source — select a primitive"
          ></textarea>
          <div class="editor-footnote">
            Edits in-memory only — Save to volume + Monaco syntax highlighting
            land in v3 (see plan).
          </div>
        </div>

        <!-- Right: 3D preview -->
        <div class="prim-preview">
          <div class="preview-meta">
            {#if selected.kind === 'op'}
              Operator — no standalone render (transforms an input manifold).
            {:else if demoCompId === selected.name}
              Preview: <code>{selected.name}</code> (itself a component)
            {:else}
              Preview via demo component: <code>{demoCompId}</code> (calls <code>{selected.name}</code> internally)
            {/if}
          </div>
          <div class="preview-stage">
            {#if buildError}
              <div class="preview-error">{buildError}</div>
            {:else if !SceneComponent || !geo}
              <div class="preview-loading">Loading preview…</div>
            {:else}
              <svelte:component this={SceneComponent} {geo} {geoVersion} showCutaway={true} showEdges={true} />
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
  .head-actions { display: flex; gap: 6px; flex-shrink: 0; }

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
  .preview-stage {
    flex: 1; min-height: 0;
    background: #2a2a2a; border-radius: 4px;
    position: relative;
    overflow: hidden;
  }
  .preview-loading, .preview-error {
    position: absolute; inset: 0;
    display: flex; align-items: center; justify-content: center;
    color: #aaa; padding: 12px;
  }
  .preview-error { color: #ff8888; }

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
