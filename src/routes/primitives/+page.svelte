<script lang="ts">
  // Primitives library — the lower-tier authoring surface. See
  // ~/.claude/plans/components-primitives-split.md Stage G.
  //
  // v1 (this commit):
  //   - Flat sidebar listing every @part / @op-tagged primitive
  //   - Editable code pane (textarea — Monaco/CodeMirror coming later)
  //   - "Load from server" round-trips through /api/primitives/source so
  //     you can see the live disk content (vs your in-memory edits)
  //   - Save / AI assist still placeholders
  import { onMount } from 'svelte';
  import { discoverHelpers, discoverOperators, type HelperMeta, type OperatorMeta } from '$lib/cad/manifold-helpers-meta';

  type Entry = { name: string; kind: 'prim' | 'op'; sig: string; desc: string };

  let entries: Entry[] = $state([]);
  let selected: Entry | null = $state(null);
  let editedSource: string = $state('');
  let serverSource: string = $state('');
  let primSource: string = $state('');
  let loading = $state(false);
  let status = $state('');

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
    refreshFromBuiltIn();
  });

  // Extract one function's source by walking from `export function <name>`
  // forward through a brace-matched body. Includes the JSDoc immediately
  // above the export if present. Robust against multi-line return types,
  // nested object literals, etc — replaces the prior regex that missed
  // helix_band due to its `): any {` return-type wrap.
  function extractSource(src: string, name: string): string {
    const needle = `export function ${name}`;
    const idx = src.indexOf(needle);
    if (idx < 0) return '';
    // Walk forward to the first `{` (skipping the (...) params + optional return type)
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

  // Refire when selection changes
  $effect(() => {
    if (selected && primSource) refreshFromBuiltIn();
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
          Currently a textarea — Monaco syntax highlighting + live preview land
          next. Edits stay in-memory; persisting requires the Save-to-volume
          endpoint (not wired yet — see plan Stage G).
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
  .prim-stage {
    flex: 1; min-height: 0; overflow: hidden;
    padding: 14px 18px;
    display: flex; flex-direction: column;
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
