<script lang="ts">
  // Primitives library — the lower-tier authoring surface. See
  // ~/.claude/plans/components-primitives-split.md Stage G for the
  // full vision (ManifoldCAD-playground-style live TS editor, save to
  // volume, AI code assistant).
  //
  // v0 (this commit): read-only catalog of the bundle primitives shipped
  // in src/lib/cad/manifold-helpers.ts. Lists name + signature + JSDoc.
  // No editor yet, no live preview yet, no save yet — just the route
  // existing so users see the eventual home.
  import { onMount } from 'svelte';
  import { discoverHelpers, discoverOperators, type HelperMeta, type OperatorMeta } from '$lib/cad/manifold-helpers-meta';

  let primitives: HelperMeta[] = $state([]);
  let operators: OperatorMeta[] = $state([]);
  let selected: HelperMeta | OperatorMeta | null = $state(null);
  let primSource: string = $state('');

  // Pull the raw helpers source so the editor pane can render it.
  // ?raw is a Vite import suffix — returns the file as a string.
  onMount(async () => {
    primitives = discoverHelpers();
    operators = discoverOperators();
    if (primitives.length > 0) selected = primitives[0];
    const mod = await import('$lib/cad/manifold-helpers.ts?raw');
    primSource = mod.default;
  });

  // Extract the function body for the selected primitive — between
  // `export function <name>(...) {` and the matching closing brace.
  // Cheap brace-counter; good enough for the bundle primitives which
  // don't contain nested object literals with un-paired braces.
  let selectedSource = $derived.by(() => {
    if (!selected || !primSource) return '';
    const re = new RegExp(`export function ${selected.name}\\s*\\([^)]*\\)\\s*(?::[^{]*?)?\\s*\\{`, 'm');
    const m = re.exec(primSource);
    if (!m) return '';
    const start = m.index;
    let depth = 0;
    let i = m.index + m[0].length - 1;
    for (; i < primSource.length; i++) {
      const c = primSource[i];
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    // Include the JSDoc immediately above
    let docStart = start;
    const docMatch = primSource.lastIndexOf('/**', start);
    if (docMatch >= 0 && primSource.slice(docMatch, start).match(/\*\/\s*$/)) {
      docStart = docMatch;
    }
    return primSource.slice(docStart, i);
  });
</script>

<div class="prim-page">
  <aside class="prim-rail">
    <header>
      <h2>Primitives</h2>
      <p class="sub">Backend toolkit — raw geometry functions</p>
    </header>

    <div class="prim-section">
      <div class="prim-section-head">Shape primitives</div>
      {#each primitives as p (p.name)}
        <button
          class="prim-row"
          class:active={selected?.name === p.name}
          type="button"
          onclick={() => (selected = p)}
        >
          <span class="prim-name">{p.name}</span>
          <span class="prim-sig">({p.props.map((pr) => pr.name).join(', ')})</span>
        </button>
      {/each}
    </div>

    <div class="prim-section">
      <div class="prim-section-head">Operators</div>
      {#each operators as o (o.name)}
        <button
          class="prim-row"
          class:active={selected?.name === o.name}
          type="button"
          onclick={() => (selected = o)}
        >
          <span class="prim-name">{o.name}</span>
          <span class="prim-sig">[{o.label}]</span>
        </button>
      {/each}
    </div>
  </aside>

  <main class="prim-main">
    {#if !selected}
      <div class="placeholder">Pick a primitive on the left.</div>
    {:else}
      <header class="prim-head">
        <h1>{selected.name}</h1>
        <p class="desc">{('desc' in selected ? selected.desc : '')}</p>
      </header>
      <div class="prim-stage">
        <div class="prim-stage-banner">
          Live preview + parameter sliders land in the next iteration. For
          now, this is a read-only view of the source so you can see what
          the primitive does.
        </div>
        <pre class="prim-src">{selectedSource || '// not found'}</pre>
      </div>
      <footer class="prim-foot">
        <button class="prim-btn" type="button" disabled title="Coming next">Edit live</button>
        <button class="prim-btn" type="button" disabled title="Coming next">Save to volume</button>
        <button class="prim-btn" type="button" disabled title="Coming next">AI assist</button>
      </footer>
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
  .prim-section { padding: 8px 0; }
  .prim-section-head {
    font: 700 10px Arial; color: #888; text-transform: uppercase;
    letter-spacing: 0.5px; padding: 4px 6px;
  }
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
  }
  .prim-head h1 { margin: 0; font: 700 18px monospace; color: #cc2222; }
  .prim-head .desc { margin: 4px 0 0; color: #555; }
  .prim-stage {
    flex: 1; min-height: 0; overflow-y: auto;
    padding: 14px 18px;
  }
  .prim-stage-banner {
    background: #fff8e6; border: 1px solid #f0d97a; border-radius: 4px;
    padding: 8px 12px; margin-bottom: 12px;
    font-size: 12px; color: #6a5500;
  }
  .prim-src {
    background: #fafafa; border: 1px solid #ddd; border-radius: 4px;
    padding: 12px; font: 12px/1.5 monospace; color: #222;
    white-space: pre; overflow-x: auto;
  }
  .prim-foot {
    padding: 10px 18px; border-top: 1px solid #eee;
    display: flex; gap: 8px;
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
