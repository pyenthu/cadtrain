<!--
  CompositionEditor — K.63 .asm.ts editor.

  Renders two sections from the assembly source:
    1. Imports — flat list of `name = src` alias declarations.
    2. Composition — nested recursive tree (single root).

  M3 adds EDITING on top of the M2 read-only render:
    * M3a — `+ Import` button → primitive picker popup; × per row removes.
    * M3b — `+ Add root` when composition === null → kind picker; for Call
            shows fn typeahead (import aliases + sandbox helpers).
    * M3c — per-node hover toolbar (× delete), method op swap (click op),
            inline literal text edit, ref/literal arg picker.

  Every mutation funnels through `applyToSource` (the data layer's one-shot
  entry point) → emits a new source string → calls `onSourceChange(s)`. The
  parent (PrimitiveView) sets `editedSource ← s`, which triggers re-parse
  + the existing recognize / preview / bake pipeline.
-->
<script lang="ts">
  import {
    parseImports, parseComposition, applyToSource,
    replaceNode, deleteNode, newNodeId,
    type TreeNode, type ImportDef, type CsgOp, type NodeType,
  } from '$lib/cad/composition-tree';
  import FloatingPanel from './FloatingPanel.svelte';

  let {
    source = '',
    id = '',
    canEdit = false,
    catalog = [],
    onSourceChange,
  }: {
    source: string;
    id: string;
    canEdit?: boolean;
    catalog?: Array<{ id: string }>;
    onSourceChange?: (newSource: string) => void;
  } = $props();

  // Re-parse on every source change. Cheap enough — recursive descent
  // over a few hundred chars in typical assemblies.
  let imports = $derived<ImportDef[]>(parseImports(source));
  let composition = $derived<TreeNode | null>(parseComposition(source));

  // Common sandbox helpers — typeahead candidates for Call.fn alongside
  // import aliases. Subset of SANDBOX_ARG_NAMES that's actually useful to
  // call as a top-level geometry expression (no Math/M/CS plumbing).
  const SANDBOX_FN_NAMES = [
    'cyl', 'tube', 'mv', 'rot', 'place', 'stack', 'overlay',
    'helix_band', 'revolve', 'profile_extrude', 'empty',
    'resolveProfile', 'cs', 'extrude_csg', 'ext',
  ];

  // ─── Mutation entry point ─────────────────────────────────────────────
  // Every edit ends here. Re-parse → mutate in memory → re-emit → push back
  // to parent. We re-derive `imports`/`composition` from the FRESH source
  // automatically via $derived once the parent sets editedSource ← out.
  function commit(newImports: readonly ImportDef[], newRoot: TreeNode | null) {
    if (!canEdit) return;
    const out = applyToSource(source, id, newImports, newRoot);
    onSourceChange?.(out);
  }

  // ─── Imports ──────────────────────────────────────────────────────────

  let importPopup = $state<{ x: number; y: number; query: string } | null>(null);
  function openImportPopup(ev: MouseEvent) {
    const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    importPopup = { x: rect.left, y: rect.bottom + 4, query: '' };
  }
  function closeImportPopup() { importPopup = null; }

  /** Next free single-letter alias (A, B, …, Z, AA, AB, …). */
  function nextAlias(taken: ReadonlySet<string>): string {
    for (let i = 0; i < 10000; i++) {
      let n = i, name = '';
      do { name = String.fromCharCode(65 + (n % 26)) + name; n = Math.floor(n / 26) - 1; } while (n >= 0);
      if (!taken.has(name)) return name;
    }
    return 'X' + Math.random().toString(36).slice(2, 5);
  }

  function addImport(primId: string) {
    const taken = new Set(imports.map((i) => i.name));
    const name = nextAlias(taken);
    const next = [...imports, { name, src: primId }];
    commit(next, composition);
    closeImportPopup();
  }

  function removeImport(name: string) {
    const next = imports.filter((i) => i.name !== name);
    commit(next, composition);
  }

  let importCandidates = $derived.by(() => {
    const q = (importPopup?.query ?? '').toLowerCase();
    const usedSrcs = new Set(imports.map((i) => i.src));
    // Catalog ids except this assembly itself + already-imported sources.
    // Allow re-import (a second alias) by NOT filtering used; users may want
    // two aliases for the same primitive. But default sort = unused first.
    const all = (catalog ?? [])
      .map((e) => e.id)
      .filter((cid) => cid !== id && (!q || cid.toLowerCase().includes(q)));
    // Dedupe (catalog can carry the same id twice across categories).
    const seen = new Set<string>();
    const uniq: string[] = [];
    for (const cid of all) {
      if (seen.has(cid)) continue;
      seen.add(cid);
      uniq.push(cid);
    }
    // Stable sort: unused first, then alphabetical.
    return uniq.sort((a, b) => {
      const ua = usedSrcs.has(a) ? 1 : 0;
      const ub = usedSrcs.has(b) ? 1 : 0;
      if (ua !== ub) return ua - ub;
      return a.localeCompare(b);
    });
  });

  // ─── Composition root creation (M3b) ──────────────────────────────────

  let rootPopup = $state<{ x: number; y: number; step: 'kind' | 'fn'; query: string } | null>(null);
  function openRootPopup(ev: MouseEvent) {
    const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    rootPopup = { x: rect.left, y: rect.bottom + 4, step: 'kind', query: '' };
  }
  function closeRootPopup() { rootPopup = null; }

  function makePlaceholder(): TreeNode {
    return { type: 'literal', id: newNodeId(), value: '' };
  }
  function makeNodeOfKind(type: NodeType, fn?: string): TreeNode {
    const nid = newNodeId();
    switch (type) {
      case 'call':    return { type, id: nid, fn: fn ?? '', args: [] };
      case 'method':  return { type, id: nid, op: 'subtract', obj: makePlaceholder(), arg: makePlaceholder() };
      case 'list':    return { type, id: nid, children: [] };
      case 'stack':   return { type, id: nid, children: [] };
      case 'overlay': return { type, id: nid, anchor: makePlaceholder(), child: makePlaceholder(), at: 'head' };
      case 'mv':      return { type, id: nid, child: makePlaceholder(),
                                offset: [makeLiteral('0'), makeLiteral('0'), makeLiteral('0')] };
      case 'rot':     return { type, id: nid, child: makePlaceholder(),
                                rot:    [makeLiteral('0'), makeLiteral('0'), makeLiteral('0')] };
      case 'ref':     return { type, id: nid, target: '' };
      case 'literal': return { type, id: nid, value: '' };
    }
  }
  function makeLiteral(v: string): TreeNode { return { type: 'literal', id: newNodeId(), value: v }; }

  function createRoot(type: NodeType) {
    if (type === 'call') {
      // Two-step — pick the fn so the new node lands with a real callable.
      rootPopup = { ...(rootPopup ?? { x: 0, y: 0 } as any), step: 'fn', query: '' };
      return;
    }
    commit(imports, makeNodeOfKind(type));
    closeRootPopup();
  }
  function createCallRoot(fn: string) {
    commit(imports, makeNodeOfKind('call', fn));
    closeRootPopup();
  }
  let fnCandidates = $derived.by(() => {
    const q = (rootPopup?.query ?? '').toLowerCase();
    const aliases = imports.map((i) => i.name);
    const helpers = SANDBOX_FN_NAMES;
    const merged = [...aliases, ...helpers];
    const seen = new Set<string>();
    return merged
      .filter((n) => !seen.has(n) && (seen.add(n), true))
      .filter((n) => !q || n.toLowerCase().includes(q));
  });

  // ─── Per-node mutations (M3c) ─────────────────────────────────────────

  function deleteN(nid: string) {
    if (!composition) return;
    const next = deleteNode(composition, nid);
    commit(imports, next);
  }

  function swapOp(node: TreeNode & { type: 'method' }, op: CsgOp) {
    if (!composition) return;
    const replacement: TreeNode = { ...node, op };
    const next = replaceNode(composition, node.id, replacement);
    commit(imports, next);
    opPopup = null;
  }

  function commitLiteral(node: TreeNode & { type: 'literal' }, value: string) {
    if (!composition) return;
    const replacement: TreeNode = { ...node, value };
    const next = replaceNode(composition, node.id, replacement);
    commit(imports, next);
    litEdit = null;
  }

  function commitArgPicker(node: TreeNode, choice: { kind: 'literal' | 'ref' | 'call'; value: string }) {
    if (!composition) return;
    let replacement: TreeNode;
    if (choice.kind === 'literal') replacement = makeLiteral(choice.value);
    else if (choice.kind === 'ref') replacement = { type: 'ref', id: newNodeId(), target: choice.value };
    else replacement = makeNodeOfKind('call', choice.value);
    const next = replaceNode(composition, node.id, replacement);
    commit(imports, next);
    argPicker = null;
  }

  // ─── Local popup state ────────────────────────────────────────────────

  // op swap (click a method's op text).
  let opPopup = $state<{ nodeId: string; x: number; y: number } | null>(null);
  // inline literal edit (click a Literal's value).
  let litEdit = $state<{ nodeId: string; value: string } | null>(null);
  // generic arg picker (click an empty placeholder Literal).
  let argPicker = $state<{ nodeId: string; x: number; y: number; tab: 'literal' | 'ref' | 'call'; query: string; literalVal: string } | null>(null);

  function openOpPopup(ev: MouseEvent, nodeId: string) {
    if (!canEdit) return;
    const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    opPopup = { nodeId, x: rect.left, y: rect.bottom + 4 };
  }
  function openLitEdit(node: TreeNode & { type: 'literal' }) {
    if (!canEdit) return;
    litEdit = { nodeId: node.id, value: node.value };
  }
  function openArgPicker(ev: MouseEvent, nodeId: string) {
    if (!canEdit) return;
    const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    argPicker = { nodeId, x: rect.left, y: rect.bottom + 4, tab: 'literal', query: '', literalVal: '' };
  }

  // Method nodes whose op popup is open — find by id for snapshot data.
  let opPopupNode = $derived(opPopup && composition ? findById(composition, opPopup.nodeId) : null);

  function findById(root: TreeNode, nid: string): TreeNode | null {
    if (root.id === nid) return root;
    switch (root.type) {
      case 'call':    for (const a of root.args)     { const h = findById(a, nid); if (h) return h; } return null;
      case 'method':  return findById(root.obj, nid) ?? findById(root.arg, nid);
      case 'list':
      case 'stack':   for (const c of root.children) { const h = findById(c, nid); if (h) return h; } return null;
      case 'overlay': return findById(root.anchor, nid) ?? findById(root.child, nid);
      case 'mv':      return findById(root.child, nid) ?? findById(root.offset[0], nid) ?? findById(root.offset[1], nid) ?? findById(root.offset[2], nid);
      case 'rot':     return findById(root.child, nid) ?? findById(root.rot[0], nid) ?? findById(root.rot[1], nid) ?? findById(root.rot[2], nid);
      case 'ref':
      case 'literal': return null;
    }
  }

  // Sibling refs available for the "ref" arg picker tab — every named
  // alias is fair game (the emitted body declares `const A = shaft;`).
  let refCandidates = $derived(imports.map((i) => i.name));

  // ─── Glyphs + summaries ───────────────────────────────────────────────

  function glyphFor(type: TreeNode['type']): string {
    switch (type) {
      case 'call':    return 'ƒ';
      case 'method':  return '⊖';
      case 'list':    return '◫';
      case 'stack':   return '⫾';
      case 'overlay': return '⤴';
      case 'mv':      return '↦';
      case 'rot':     return '↻';
      case 'ref':     return '→';
      case 'literal': return '·';
    }
  }
  function summaryFor(n: TreeNode): string {
    switch (n.type) {
      case 'call':    return `${n.fn || '?'}(${n.args.length === 0 ? '' : '…'})`;
      case 'method':  return n.op;
      case 'list':    return `list (${n.children.length})`;
      case 'stack':   return `stack (${n.children.length})`;
      case 'overlay': return `overlay @${n.at}`;
      case 'mv':      return 'mv';
      case 'rot':     return 'rot';
      case 'ref':     return n.target || '?';
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
      {#if canEdit}
        <button class="ce-add-btn" type="button" title="Add import" onclick={openImportPopup}>+ Import</button>
      {/if}
    </header>
    {#if imports.length === 0}
      <div class="ce-empty">
        {canEdit ? 'No imports. Click + Import to alias a primitive.' : 'No imports.'}
      </div>
    {:else}
      <div class="ce-imports-list">
        {#each imports as imp (imp.name)}
          <div class="ce-import-row">
            <span class="ce-imp-name">{imp.name}</span>
            <span class="ce-imp-eq">=</span>
            <span class="ce-imp-src">{imp.src}</span>
            {#if canEdit}
              <button class="ce-imp-del" type="button" title="Remove import" onclick={() => removeImport(imp.name)}>×</button>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <!-- ─── Composition ──────────────────────────────────────────────── -->
  <section class="ce-section ce-composition">
    <header class="ce-section-head">
      <span class="ce-section-title">▼ Composition</span>
      {#if canEdit && composition === null}
        <button class="ce-add-btn" type="button" title="Add composition root" onclick={openRootPopup}>+ Add root</button>
      {/if}
    </header>
    {#if composition === null}
      <div class="ce-empty">
        {canEdit ? 'No composition yet. Click + Add root to start.' : 'No composition.'}
      </div>
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
      {#if n.type === 'method' && canEdit}
        <button
          class="ce-node-summary ce-op-btn {methodOpClass(n.op)}"
          type="button"
          title="Swap op"
          onclick={(ev) => openOpPopup(ev, n.id)}
        >{n.op}</button>
      {:else if n.type === 'literal' && canEdit}
        {#if litEdit?.nodeId === n.id}
          <input
            class="ce-lit-input"
            value={litEdit.value}
            oninput={(e) => { if (litEdit) litEdit = { ...litEdit, value: (e.currentTarget as HTMLInputElement).value }; }}
            onblur={() => { if (litEdit) commitLiteral(n, litEdit.value); }}
            onkeydown={(e) => {
              if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
              else if (e.key === 'Escape') litEdit = null;
            }}
          />
        {:else if !n.value}
          <button
            class="ce-empty-arg"
            type="button"
            title="Set value"
            onclick={(ev) => openArgPicker(ev, n.id)}
          >+ value</button>
        {:else}
          <button
            class="ce-node-summary ce-lit-btn"
            type="button"
            title="Edit value"
            onclick={() => openLitEdit(n)}
          >{n.value}</button>
        {/if}
      {:else}
        <span class="ce-node-summary {n.type === 'method' ? methodOpClass(n.op) : ''}">{summaryFor(n)}</span>
      {/if}
      {#if n.name}
        <span class="ce-node-name">as {n.name}</span>
      {/if}
      {#if canEdit}
        <button class="ce-node-del" type="button" title="Delete node" onclick={() => deleteN(n.id)}>×</button>
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

<!-- ─── Popups ─────────────────────────────────────────────────────── -->

<!-- M3a — Import picker -->
{#if importPopup}
  <FloatingPanel
    title="Add import"
    subtitle="Pick a primitive to alias"
    visible={true}
    x={importPopup.x}
    y={importPopup.y}
    width="320px"
    maxHeight="60vh"
    onClose={closeImportPopup}
  >
    <div class="ce-pop">
      <input
        class="ce-search"
        type="search"
        placeholder="Search primitives…"
        autofocus
        value={importPopup.query}
        oninput={(e) => { if (importPopup) importPopup = { ...importPopup, query: (e.currentTarget as HTMLInputElement).value }; }}
      />
      <div class="ce-pop-list">
        {#each importCandidates as cid (cid)}
          <button class="ce-pop-item" type="button" onclick={() => addImport(cid)}>
            <span class="ce-pop-id">{cid}</span>
          </button>
        {/each}
        {#if importCandidates.length === 0}
          <div class="ce-pop-empty">No matches</div>
        {/if}
      </div>
    </div>
  </FloatingPanel>
{/if}

<!-- M3b — Root creation -->
{#if rootPopup}
  <FloatingPanel
    title={rootPopup.step === 'kind' ? 'Add root' : 'Pick a function'}
    subtitle={rootPopup.step === 'kind' ? 'Choose a node kind' : 'Import alias or sandbox helper'}
    visible={true}
    x={rootPopup.x}
    y={rootPopup.y}
    width="320px"
    maxHeight="60vh"
    onClose={closeRootPopup}
  >
    <div class="ce-pop">
      {#if rootPopup.step === 'kind'}
        <div class="ce-kind-grid">
          <button class="ce-kind-btn" type="button" onclick={() => createRoot('call')}>
            <span class="ce-kind-glyph">ƒ</span><span class="ce-kind-lbl">Call</span>
          </button>
          <button class="ce-kind-btn" type="button" onclick={() => createRoot('method')}>
            <span class="ce-kind-glyph">⊖</span><span class="ce-kind-lbl">Method</span>
          </button>
          <button class="ce-kind-btn" type="button" onclick={() => createRoot('list')}>
            <span class="ce-kind-glyph">◫</span><span class="ce-kind-lbl">List</span>
          </button>
          <button class="ce-kind-btn" type="button" onclick={() => createRoot('stack')}>
            <span class="ce-kind-glyph">⫾</span><span class="ce-kind-lbl">Stack</span>
          </button>
          <button class="ce-kind-btn" type="button" onclick={() => createRoot('overlay')}>
            <span class="ce-kind-glyph">⤴</span><span class="ce-kind-lbl">Overlay</span>
          </button>
          <button class="ce-kind-btn" type="button" onclick={() => createRoot('mv')}>
            <span class="ce-kind-glyph">↦</span><span class="ce-kind-lbl">Mv</span>
          </button>
          <button class="ce-kind-btn" type="button" onclick={() => createRoot('rot')}>
            <span class="ce-kind-glyph">↻</span><span class="ce-kind-lbl">Rot</span>
          </button>
          <button class="ce-kind-btn" type="button" onclick={() => createRoot('literal')}>
            <span class="ce-kind-glyph">·</span><span class="ce-kind-lbl">Literal</span>
          </button>
        </div>
      {:else}
        <input
          class="ce-search"
          type="search"
          placeholder="Filter functions…"
          autofocus
          value={rootPopup.query}
          oninput={(e) => { if (rootPopup) rootPopup = { ...rootPopup, query: (e.currentTarget as HTMLInputElement).value }; }}
        />
        <div class="ce-pop-list">
          {#each fnCandidates as fn (fn)}
            <button class="ce-pop-item" type="button" onclick={() => createCallRoot(fn)}>
              <span class="ce-pop-id">{fn}</span>
              {#if imports.find((i) => i.name === fn)}
                <span class="ce-pop-tag">alias</span>
              {:else}
                <span class="ce-pop-tag ce-pop-tag-helper">helper</span>
              {/if}
            </button>
          {/each}
          {#if fnCandidates.length === 0}
            <div class="ce-pop-empty">No matches</div>
          {/if}
        </div>
      {/if}
    </div>
  </FloatingPanel>
{/if}

<!-- M3c — Method op picker -->
{#if opPopup && opPopupNode && opPopupNode.type === 'method'}
  <FloatingPanel
    title="Swap op"
    visible={true}
    x={opPopup.x}
    y={opPopup.y}
    width="160px"
    maxHeight="40vh"
    onClose={() => (opPopup = null)}
  >
    <div class="ce-pop">
      <div class="ce-op-list">
        {#each ['add', 'subtract', 'intersect'] as op (op)}
          <button
            class="ce-op-pick {methodOpClass(op)}"
            type="button"
            onclick={() => swapOp(opPopupNode as any, op as CsgOp)}
          >{op}</button>
        {/each}
      </div>
    </div>
  </FloatingPanel>
{/if}

<!-- M3c — Arg picker (empty literal placeholder click) -->
{#if argPicker}
  <FloatingPanel
    title="Set value"
    subtitle="Literal · Ref · Call"
    visible={true}
    x={argPicker.x}
    y={argPicker.y}
    width="320px"
    maxHeight="60vh"
    onClose={() => (argPicker = null)}
  >
    <div class="ce-pop">
      <div class="ce-tabs">
        <button class="ce-tab" class:active={argPicker.tab === 'literal'} type="button"
          onclick={() => { if (argPicker) argPicker = { ...argPicker, tab: 'literal' }; }}>Literal</button>
        <button class="ce-tab" class:active={argPicker.tab === 'ref'} type="button"
          onclick={() => { if (argPicker) argPicker = { ...argPicker, tab: 'ref' }; }}>Ref</button>
        <button class="ce-tab" class:active={argPicker.tab === 'call'} type="button"
          onclick={() => { if (argPicker) argPicker = { ...argPicker, tab: 'call' }; }}>Call</button>
      </div>
      {#if argPicker.tab === 'literal'}
        <input
          class="ce-search"
          type="text"
          placeholder="e.g. p.od or 1.5"
          autofocus
          value={argPicker.literalVal}
          oninput={(e) => { if (argPicker) argPicker = { ...argPicker, literalVal: (e.currentTarget as HTMLInputElement).value }; }}
          onkeydown={(e) => {
            if (e.key === 'Enter' && argPicker) {
              const target = composition && findById(composition, argPicker.nodeId);
              if (target) commitArgPicker(target, { kind: 'literal', value: argPicker.literalVal });
            }
          }}
        />
        <button class="ce-pop-confirm" type="button" onclick={() => {
          if (!argPicker) return;
          const target = composition && findById(composition, argPicker.nodeId);
          if (target) commitArgPicker(target, { kind: 'literal', value: argPicker.literalVal });
        }}>Set literal</button>
      {:else if argPicker.tab === 'ref'}
        <div class="ce-pop-list">
          {#each refCandidates as ref (ref)}
            <button class="ce-pop-item" type="button" onclick={() => {
              if (!argPicker) return;
              const target = composition && findById(composition, argPicker.nodeId);
              if (target) commitArgPicker(target, { kind: 'ref', value: ref });
            }}>
              <span class="ce-pop-id">{ref}</span>
              <span class="ce-pop-tag">alias</span>
            </button>
          {/each}
          {#if refCandidates.length === 0}
            <div class="ce-pop-empty">No imports to reference yet</div>
          {/if}
        </div>
      {:else}
        <input
          class="ce-search"
          type="search"
          placeholder="Filter functions…"
          value={argPicker.query}
          oninput={(e) => { if (argPicker) argPicker = { ...argPicker, query: (e.currentTarget as HTMLInputElement).value }; }}
        />
        <div class="ce-pop-list">
          {#each fnCandidates as fn (fn)}
            <button class="ce-pop-item" type="button" onclick={() => {
              if (!argPicker) return;
              const target = composition && findById(composition, argPicker.nodeId);
              if (target) commitArgPicker(target, { kind: 'call', value: fn });
            }}>
              <span class="ce-pop-id">{fn}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </FloatingPanel>
{/if}

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
  .ce-add-btn {
    margin-left: auto;
    background: #eef5ff; border: 1px solid #bcd3ee; color: #0c2e6e;
    font: 600 11px ui-sans-serif, system-ui;
    padding: 2px 8px; border-radius: 4px; cursor: pointer;
  }
  .ce-add-btn:hover { background: #ddeaff; border-color: #8eb6e6; }
  .ce-empty { color: #888; font-style: italic; padding: 6px 4px; }

  /* Imports */
  .ce-imports { background: #eef5ff; border-color: #bcd3ee; }
  .ce-import-row {
    display: flex; align-items: center; gap: 6px; padding: 3px 0;
    color: #1e3a8a;
  }
  .ce-imp-name { font-weight: 700; color: #0c2e6e; }
  .ce-imp-eq { color: #5e88c3; }
  .ce-imp-src { color: #1e3a8a; flex: 1; }
  .ce-imp-del {
    background: transparent; border: none; cursor: pointer;
    color: #888; font-size: 14px; line-height: 1;
    width: 18px; height: 18px; border-radius: 3px;
    padding: 0;
  }
  .ce-imp-del:hover { background: #fdecec; color: #cc2222; }

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

  /* Per-node controls */
  .ce-op-btn, .ce-lit-btn {
    background: transparent; border: 1px dashed transparent;
    cursor: pointer; padding: 1px 4px; font: inherit;
    border-radius: 3px;
  }
  .ce-op-btn:hover, .ce-lit-btn:hover {
    border-color: #bcd3ee; background: #eef5ff;
  }
  .ce-empty-arg {
    background: #fffbeb; border: 1px dashed #fbbf24; cursor: pointer;
    color: #92400e; padding: 1px 6px; border-radius: 3px;
    font: 600 11px ui-sans-serif, system-ui;
  }
  .ce-empty-arg:hover { background: #fef3c7; }
  .ce-lit-input {
    border: 1px solid #bcd3ee; border-radius: 3px;
    padding: 1px 4px; font: inherit;
    background: #fff; min-width: 80px;
  }
  .ce-node-del {
    background: transparent; border: none; cursor: pointer;
    color: #ccc; font-size: 14px; line-height: 1;
    width: 18px; height: 18px; border-radius: 3px;
    margin-left: auto; padding: 0;
    visibility: hidden;
  }
  .ce-node-head:hover .ce-node-del { visibility: visible; }
  .ce-node-del:hover { background: #fdecec; color: #cc2222; }

  /* Leaf compaction — literal / ref have no body so squeeze them. */
  .ce-node-literal .ce-node-head,
  .ce-node-ref     .ce-node-head { padding: 2px 0; }

  /* Popup chrome */
  .ce-pop {
    display: flex; flex-direction: column; gap: 6px;
    padding: 4px;
    font: 13px ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .ce-search {
    width: 100%; box-sizing: border-box;
    border: 1px solid #ddd; border-radius: 4px;
    padding: 4px 6px; font: inherit;
  }
  .ce-search:focus { outline: 2px solid #bcd3ee; border-color: #bcd3ee; }
  .ce-pop-list {
    display: flex; flex-direction: column; gap: 1px;
    max-height: 40vh; overflow-y: auto;
  }
  .ce-pop-item {
    display: flex; align-items: center; gap: 6px;
    background: #fff; border: 1px solid #eee; border-radius: 3px;
    padding: 4px 6px; cursor: pointer;
    font: inherit; text-align: left;
  }
  .ce-pop-item:hover { background: #eef5ff; border-color: #bcd3ee; }
  .ce-pop-id { font-weight: 600; color: #0c2e6e; flex: 1; }
  .ce-pop-tag {
    font-size: 10px; padding: 1px 5px; border-radius: 8px;
    background: #e0e7ff; color: #3730a3; font-weight: 600;
  }
  .ce-pop-tag-helper { background: #ccfbf1; color: #115e59; }
  .ce-pop-empty { color: #888; font-style: italic; padding: 8px; text-align: center; }
  .ce-pop-confirm {
    background: #1e3a8a; color: #fff; border: none; border-radius: 4px;
    padding: 4px 8px; font: 600 12px ui-sans-serif, system-ui;
    cursor: pointer;
  }
  .ce-pop-confirm:hover { background: #1e40af; }

  .ce-kind-grid {
    display: grid; grid-template-columns: repeat(4, 1fr);
    gap: 4px;
  }
  .ce-kind-btn {
    display: flex; flex-direction: column; align-items: center; gap: 2px;
    background: #fff; border: 1px solid #ddd; border-radius: 4px;
    padding: 8px 4px; cursor: pointer; font: inherit;
  }
  .ce-kind-btn:hover { background: #eef5ff; border-color: #bcd3ee; }
  .ce-kind-glyph { font-size: 18px; font-weight: 700; color: #444; }
  .ce-kind-lbl { font-size: 10px; color: #666; font-weight: 600; }

  .ce-op-list { display: flex; flex-direction: column; gap: 2px; }
  .ce-op-pick {
    background: #fff; border: 1px solid #ddd; border-radius: 3px;
    padding: 4px 8px; cursor: pointer;
    font: 600 12px ui-sans-serif, system-ui;
    text-align: left;
  }
  .ce-op-pick.op-add   { color: #115e59; }
  .ce-op-pick.op-sub   { color: #9d174d; }
  .ce-op-pick.op-inter { color: #6b21a8; }
  .ce-op-pick:hover    { background: #eef5ff; border-color: #bcd3ee; }

  .ce-tabs { display: flex; gap: 2px; border-bottom: 1px solid #eee; }
  .ce-tab {
    background: transparent; border: none; cursor: pointer;
    padding: 4px 8px; font: 600 11px ui-sans-serif, system-ui;
    color: #888; border-bottom: 2px solid transparent;
  }
  .ce-tab.active { color: #0c2e6e; border-bottom-color: #1e3a8a; }
  .ce-tab:hover { color: #0c2e6e; }
</style>
