<!--
  CompositionEditor — K.63 .asm.ts editor.

  Renders two sections from the assembly source:
    1. Imports — flat list of name = src alias declarations.
    2. Composition — nested recursive tree (single root).

  M2 ships READ-ONLY render. Each node shows its type glyph + a
  one-line summary; children expand inline with indent. M3 adds
  editing (arg slots, op swap, wrap, delete); M3+ adds drag-drop.

  Editing API contract (when wired):
    onSourceChange(newSource) — called whenever a mutation is applied.
    Parent (PrimitiveView) sets editedSource ← newSource which triggers
    the existing recognize / preview / bake pipeline.
-->
<script lang="ts">
  import {
    parseImports, parseComposition, type TreeNode, type ImportDef,
  } from '$lib/cad/composition-tree';

  let { source = '' }: { source: string } = $props();

  // Re-parse on every source change. Cheap enough — recursive descent
  // over a few hundred chars in typical assemblies.
  let imports = $derived<ImportDef[]>(parseImports(source));
  let composition = $derived<TreeNode | null>(parseComposition(source));

  function glyphFor(type: TreeNode['type']): string {
    switch (type) {
      case 'call':    return 'ƒ';
      case 'method':  return '⊖';        // generic CSG glyph
      case 'list':    return '◫';
      case 'stack':   return '⫾';
      case 'overlay': return '⤴';
      case 'mv':      return '↦';
      case 'rot':     return '↻';
      case 'ref':     return '→';
      case 'literal': return '·';
    }
  }
  /** A short one-line summary for the node header — what the user sees
   *  before expanding. Keeps things scannable in big trees. */
  function summaryFor(n: TreeNode): string {
    switch (n.type) {
      case 'call':    return `${n.fn}(${n.args.length === 0 ? '' : '…'})`;
      case 'method':  return n.op;
      case 'list':    return `list (${n.children.length})`;
      case 'stack':   return `stack (${n.children.length})`;
      case 'overlay': return `overlay @${n.at}`;
      case 'mv':      return 'mv';
      case 'rot':     return 'rot';
      case 'ref':     return n.target;
      case 'literal': return n.value || '·';
    }
  }
  function methodOpClass(op: string): string {
    return op === 'add' ? 'op-add' : op === 'intersect' ? 'op-inter' : 'op-sub';
  }
</script>

<div class="ce-root">
  <!-- ─── Imports ──────────────────────────────────────────────────── -->
  <section class="ce-section ce-imports">
    <header class="ce-section-head">
      <span class="ce-section-title">📥 Imports</span>
      <span class="ce-section-count">{imports.length}</span>
    </header>
    {#if imports.length === 0}
      <div class="ce-empty">No imports. Click + to alias a primitive.</div>
    {:else}
      <div class="ce-imports-list">
        {#each imports as imp (imp.name)}
          <div class="ce-import-row">
            <span class="ce-imp-name">{imp.name}</span>
            <span class="ce-imp-eq">=</span>
            <span class="ce-imp-src">{imp.src}</span>
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <!-- ─── Composition ──────────────────────────────────────────────── -->
  <section class="ce-section ce-composition">
    <header class="ce-section-head">
      <span class="ce-section-title">▼ Composition</span>
    </header>
    {#if composition === null}
      <div class="ce-empty">No composition yet. Click + to add a root node.</div>
    {:else}
      <div class="ce-tree">{@render node(composition, 0)}</div>
    {/if}
  </section>
</div>

<!-- ─── Recursive node render ─────────────────────────────────────── -->
{#snippet node(n: TreeNode, depth: number)}
  <div class="ce-node ce-node-{n.type}" style="--depth: {depth}">
    <header class="ce-node-head">
      <span class="ce-node-glyph ce-node-glyph-{n.type}">{glyphFor(n.type)}</span>
      <span class="ce-node-summary {n.type === 'method' ? methodOpClass(n.op) : ''}">{summaryFor(n)}</span>
      {#if n.name}
        <span class="ce-node-name">as {n.name}</span>
      {/if}
    </header>
    {@render children(n, depth)}
  </div>
{/snippet}

{#snippet children(n: TreeNode, depth: number)}
  {#if n.type === 'call' && n.args.length > 0}
    <div class="ce-node-body">
      {#each n.args as a, i (a.id)}
        <div class="ce-arg-row">
          <span class="ce-arg-label">arg {i}:</span>
          {@render node(a, depth + 1)}
        </div>
      {/each}
    </div>
  {:else if n.type === 'method'}
    <div class="ce-node-body">
      <div class="ce-arg-row">
        <span class="ce-arg-label">obj:</span>
        {@render node(n.obj, depth + 1)}
      </div>
      <div class="ce-arg-row">
        <span class="ce-arg-label">arg:</span>
        {@render node(n.arg, depth + 1)}
      </div>
    </div>
  {:else if (n.type === 'list' || n.type === 'stack')}
    <div class="ce-node-body">
      {#each n.children as c (c.id)}
        {@render node(c, depth + 1)}
      {/each}
    </div>
  {:else if n.type === 'overlay'}
    <div class="ce-node-body">
      <div class="ce-arg-row">
        <span class="ce-arg-label">anchor:</span>
        {@render node(n.anchor, depth + 1)}
      </div>
      <div class="ce-arg-row">
        <span class="ce-arg-label">child:</span>
        {@render node(n.child, depth + 1)}
      </div>
    </div>
  {:else if n.type === 'mv'}
    <div class="ce-node-body">
      <div class="ce-arg-row">
        <span class="ce-arg-label">child:</span>
        {@render node(n.child, depth + 1)}
      </div>
      <div class="ce-arg-row">
        <span class="ce-arg-label">offset:</span>
        <span class="ce-arg-tuple">
          {@render node(n.offset[0], depth + 1)}
          {@render node(n.offset[1], depth + 1)}
          {@render node(n.offset[2], depth + 1)}
        </span>
      </div>
    </div>
  {:else if n.type === 'rot'}
    <div class="ce-node-body">
      <div class="ce-arg-row">
        <span class="ce-arg-label">child:</span>
        {@render node(n.child, depth + 1)}
      </div>
      <div class="ce-arg-row">
        <span class="ce-arg-label">rot:</span>
        <span class="ce-arg-tuple">
          {@render node(n.rot[0], depth + 1)}
          {@render node(n.rot[1], depth + 1)}
          {@render node(n.rot[2], depth + 1)}
        </span>
      </div>
    </div>
  {/if}
{/snippet}

<style>
  .ce-root {
    display: flex; flex-direction: column; gap: 8px; padding: 6px;
    font: 13px ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .ce-section {
    background: #fff; border: 1px solid #ddd; border-radius: 6px;
    padding: 8px;
  }
  .ce-section-head {
    display: flex; align-items: center; gap: 6px;
    margin-bottom: 6px; padding-bottom: 4px;
    border-bottom: 1px solid #eee;
  }
  .ce-section-title { font: 600 12px ui-sans-serif, system-ui; color: #333; }
  .ce-section-count {
    background: #f0f0f5; color: #555; font-size: 11px;
    padding: 1px 6px; border-radius: 8px; font-weight: 600;
  }
  .ce-empty { color: #888; font-style: italic; padding: 6px 4px; }

  /* Imports */
  .ce-imports { background: #eef5ff; border-color: #bcd3ee; }
  .ce-import-row {
    display: flex; align-items: center; gap: 6px; padding: 3px 0;
    color: #1e3a8a;
  }
  .ce-imp-name { font-weight: 700; color: #0c2e6e; }
  .ce-imp-eq { color: #5e88c3; }
  .ce-imp-src { color: #1e3a8a; }

  /* Composition tree */
  .ce-composition { background: #fafafa; }
  .ce-tree { display: flex; flex-direction: column; gap: 2px; }
  .ce-node {
    border-left: 2px solid #e0e0e0;
    padding-left: 8px;
    margin-left: calc(var(--depth, 0) * 12px);
  }
  .ce-node-head {
    display: flex; align-items: center; gap: 6px;
    padding: 4px 0;
    color: #333;
  }
  .ce-node-glyph {
    display: inline-flex; align-items: center; justify-content: center;
    width: 18px; height: 18px; border-radius: 4px;
    font-weight: 700; font-size: 11px;
  }
  .ce-node-glyph-call    { background: #fef3c7; color: #92400e; }
  .ce-node-glyph-method  { background: #fce7f3; color: #9d174d; }
  .ce-node-glyph-list    { background: #e0e7ff; color: #3730a3; }
  .ce-node-glyph-stack   { background: #ccfbf1; color: #115e59; }
  .ce-node-glyph-overlay { background: #fae8ff; color: #6b21a8; }
  .ce-node-glyph-mv      { background: #fef3c7; color: #78350f; }
  .ce-node-glyph-rot     { background: #fef3c7; color: #78350f; }
  .ce-node-glyph-ref     { background: #e0f2fe; color: #0c4a6e; }
  .ce-node-glyph-literal { background: #f5f5f5; color: #525252; }
  .ce-node-summary { font-weight: 600; }
  .ce-node-summary.op-sub   { color: #9d174d; }
  .ce-node-summary.op-add   { color: #115e59; }
  .ce-node-summary.op-inter { color: #6b21a8; }
  .ce-node-name {
    color: #888; font-style: italic; font-size: 11px;
    margin-left: 4px;
  }
  .ce-node-body {
    display: flex; flex-direction: column; gap: 2px;
    margin-top: 2px;
  }
  .ce-arg-row {
    display: flex; align-items: flex-start; gap: 6px;
    padding-left: 8px;
  }
  .ce-arg-label {
    font-size: 11px; color: #888;
    min-width: 56px; padding-top: 4px;
  }
  .ce-arg-tuple {
    display: inline-flex; gap: 4px; flex: 1;
  }
  .ce-arg-tuple > * { flex: 1; }

  /* Leaf compaction — literal / ref have no body so squeeze them. */
  .ce-node-literal .ce-node-head,
  .ce-node-ref     .ce-node-head { padding: 2px 0; }
</style>
