<!--
  CompositionEditor — K.63 .asm.ts editor (folder-tree visual, M3 Options 1+2).

  Renders the assembly source as a file-explorer tree:

    📁 [ ] root                      ← Folder (List, no op)
     ├ 📁 ⊖ subtract  as bored        ← Folder (Method, op=subtract)
     │  ├ 📄 ƒ shaft(...)              ← File (Call)
     │  └ 📄 ƒ shaft(...)              ← File (Call)
     └ 📄 ƒ collar(...)               ← File (Call) at the top level

  Folder kinds = container nodes (List/Method/Stack/Overlay/Mv/Rot).
  File kinds = leaves (Call/Ref/Literal). Each row is ONE LINE; indentation
  is purely padding-left keyed off `depth`. Container folders are
  expandable; clicking a folder name toggles expand/collapse.

  Call nodes carry OPTIONAL inline mv / rot transforms (Option 1 — data
  layer in composition-tree.ts wraps the call in `rot(mv(<call>, [...]),
  [...])` when set). The Mv-folder / Rot-folder kinds still exist for
  multi-child transforms; the inline form is the common case.

  Imports section remains a flat list of `name = src` alias declarations.

  Every mutation funnels through `applyToSource` (the data layer's one-shot
  entry point) → emits a new source string → calls `onSourceChange(s)`.
-->
<script lang="ts">
  import {
    parseImports, parseComposition, parseDependencyParamKeys, applyToSource,
    replaceNode, deleteNode, newNodeId, childrenOf, emitNode,
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

  let imports = $derived<ImportDef[]>(parseImports(source));
  // src primitive id → ordered paramKeys (snapshot from meta.dependencies).
  // Drives prop-style arg labelling for Call rows whose fn is an import alias.
  let depParamKeys = $derived<Map<string, string[]>>(parseDependencyParamKeys(source));
  // Live fetch cache for primitives missing a dependency snapshot — we
  // ask /api/primitives/source for each new import.src once and cache its
  // Object.keys(params) ordering so labels stay in sync as the user adds
  // imports without saving yet.
  let livePK = $state<Map<string, string[]>>(new Map());
  $effect(() => {
    const wantSrcs = imports.map((i) => i.src);
    for (const src of wantSrcs) {
      if (depParamKeys.has(src) || livePK.has(src)) continue;
      // Mark optimistically so we don't double-fetch.
      livePK.set(src, []);
      fetch(`/api/primitives/source?name=${encodeURIComponent(src)}`)
        .then((r) => r.ok ? r.json() : null)
        .then((data) => {
          const keys = data?.params ? Object.keys(data.params) : [];
          livePK = new Map(livePK).set(src, keys);
        })
        .catch(() => { /* leave empty — labels fall back to arg0/arg1 */ });
    }
  });
  // alias → paramKeys: snapshot first, live cache second.
  let aliasParamKeys = $derived<Map<string, string[]>>(
    new Map(imports.map((imp) => [
      imp.name,
      depParamKeys.get(imp.src) ?? livePK.get(imp.src) ?? [],
    ]))
  );
  function labelForArg(call: Extract<TreeNode, { type: 'call' }>, i: number): string {
    const keys = aliasParamKeys.get(call.fn);
    return keys?.[i] ?? `arg${i}`;
  }
  let composition = $derived<TreeNode | null>(parseComposition(source));
  let rootKindBadge = $derived<string>(
    composition === null ? '[ ]'
      : composition.type === 'list' ? '[ ]'
      : composition.type === 'stack' ? '↓'
      : composition.type === 'method' ? '⊖'
      : composition.type === 'overlay' ? '⤴'
      : composition.type === 'mv' ? '↦'
      : composition.type === 'rot' ? '↻'
      : '·'
  );

  // Common sandbox helpers — typeahead candidates for Call.fn alongside
  // import aliases and volume primitives. The same SANDBOX_FN_NAMES the
  // previous nested-card render used.
  const SANDBOX_FN_NAMES = [
    'cyl', 'tube', 'mv', 'rot', 'place', 'stack', 'overlay',
    'helix_band', 'revolve', 'profile_extrude', 'empty',
    'resolveProfile', 'cs', 'extrude_csg', 'ext',
  ];

  // Container kinds = "folder" UI. Leaf kinds = "file" UI.
  const FOLDER_KINDS = new Set<NodeType>(['list', 'stack', 'method', 'overlay', 'mv', 'rot']);
  function isFolder(n: TreeNode): boolean { return FOLDER_KINDS.has(n.type); }

  // ─── Mutation entry point ─────────────────────────────────────────────
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
    commit([...imports, { name, src: primId }], composition);
    closeImportPopup();
  }
  function removeImport(name: string) {
    commit(imports.filter((i) => i.name !== name), composition);
  }

  let importCandidates = $derived.by(() => {
    const q = (importPopup?.query ?? '').toLowerCase();
    const usedSrcs = new Set(imports.map((i) => i.src));
    const all = (catalog ?? [])
      .map((e) => e.id)
      .filter((cid) => cid !== id && (!q || cid.toLowerCase().includes(q)));
    const seen = new Set<string>();
    const uniq: string[] = [];
    for (const cid of all) { if (!seen.has(cid)) { seen.add(cid); uniq.push(cid); } }
    return uniq.sort((a, b) => {
      const ua = usedSrcs.has(a) ? 1 : 0;
      const ub = usedSrcs.has(b) ? 1 : 0;
      if (ua !== ub) return ua - ub;
      return a.localeCompare(b);
    });
  });

  // ─── Composition root creation ────────────────────────────────────────
  let rootPopup = $state<{ x: number; y: number; step: 'folder' | 'fn'; query: string; parentId?: string } | null>(null);
  function openFilePopup(parentId: string | undefined, ev: MouseEvent) {
    const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    rootPopup = { x: rect.left, y: rect.bottom + 4, step: 'fn', query: '', parentId };
  }
  function openFolderPopup(parentId: string | undefined, ev: MouseEvent) {
    const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    rootPopup = { x: rect.left, y: rect.bottom + 4, step: 'folder', query: '', parentId };
  }
  function closeRootPopup() { rootPopup = null; }

  function appendChildToList(parentId: string, node: TreeNode) {
    if (!composition) return;
    const parent = findById(composition, parentId);
    if (!parent || (parent.type !== 'list' && parent.type !== 'stack')) return;
    const replacement: TreeNode = { ...parent, children: [...parent.children, node] };
    commit(imports, replaceNode(composition, parentId, replacement));
    // Auto-expand the parent so the new child is visible.
    expanded[parentId] = true;
  }
  function insertCallIntoComposition(node: TreeNode) {
    if (composition === null) {
      const listRoot: TreeNode = { type: 'list', id: newNodeId(), children: [node] };
      commit(imports, listRoot);
      return;
    }
    if (composition.type === 'list' || composition.type === 'stack') {
      appendChildToList(composition.id, node);
      return;
    }
    const listRoot: TreeNode = { type: 'list', id: newNodeId(), children: [composition, node] };
    commit(imports, listRoot);
  }
  async function insertImportUse(imp: ImportDef) {
    const callNode = await callWithDefaults(imp.name);
    const finalNode = (callNode.type === 'call' && callNode.args.length === 0)
      ? { ...await callWithDefaults(imp.src), fn: imp.name }
      : { ...(callNode as any), fn: imp.name };
    insertCallIntoComposition(finalNode as TreeNode);
  }

  function makePlaceholder(): TreeNode {
    return { type: 'literal', id: newNodeId(), value: '' };
  }
  function makeLiteral(v: string): TreeNode { return { type: 'literal', id: newNodeId(), value: v }; }
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

  function createFolder(type: NodeType) {
    const node = makeNodeOfKind(type);
    const pid = rootPopup?.parentId;
    if (pid) {
      appendChildToList(pid, node);
    } else if (composition === null) {
      // Empty root = implicit List. A list/stack folder BECOMES the new root
      // (the synthetic List collapses into the chosen container kind).
      // Other folder kinds get wrapped in a List so the root stays a
      // collection the user can keep adding to.
      if (type === 'list' || type === 'stack') {
        commit(imports, node);
      } else {
        const listRoot: TreeNode = { type: 'list', id: newNodeId(), children: [node] };
        commit(imports, listRoot);
      }
    } else if (composition.type === 'list' || composition.type === 'stack') {
      appendChildToList(composition.id, node);
    } else {
      // Existing scalar root + user adds a sibling folder → promote to List.
      const listRoot: TreeNode = { type: 'list', id: newNodeId(), children: [composition, node] };
      commit(imports, listRoot);
    }
    expanded[node.id] = true;
    closeRootPopup();
  }
  async function createCallNode(fn: string) {
    const pid = rootPopup?.parentId;
    // `fn` is an import alias (file-picker is imports-only). Defaults must
    // come from the alias's SOURCE primitive, not the alias name — the
    // alias is never a fetch-able primitive id, so callWithDefaults(fn)
    // alone falls through to an empty-args Call. Resolve to imp.src for
    // the defaults fetch, then re-stamp fn to the alias.
    const imp = imports.find((i) => i.name === fn);
    const fetched = imp ? await callWithDefaults(imp.src) : await callWithDefaults(fn);
    const node = (fetched.type === 'call') ? { ...fetched, fn } : fetched;
    if (pid) appendChildToList(pid, node);
    else insertCallIntoComposition(node); // wraps in List when root is empty/scalar
    closeRootPopup();
  }
  // Per user constraint: composition's "+ file" only offers IMPORTS.
  // The Imports section is the vocabulary of this assembly; the composition
  // can only use what's been declared. No catalog primitives or sandbox
  // helpers in the file picker — those are how you populate IMPORTS.
  let fnCandidates = $derived.by(() => {
    const q = (rootPopup?.query ?? '').toLowerCase();
    return imports
      .map((i) => i.name)
      .filter((n) => !q || n.toLowerCase().includes(q));
  });

  function tagFor(_fn: string): { tag: string; cls: string } {
    // Everything in the picker is an import alias by definition now.
    return { tag: 'import', cls: '' };
  }

  async function callWithDefaults(fn: string): Promise<TreeNode> {
    try {
      const r = await fetch(`/api/primitives/source?name=${encodeURIComponent(fn)}`);
      if (r.ok) {
        const data = await r.json();
        const params = data?.params ?? {};
        const args: TreeNode[] = Object.entries(params).map(([_, p]: [string, any]) => {
          const def = p?.default;
          const value =
            def == null ? ''
            : typeof def === 'number' ? String(def)
            : typeof def === 'string' ? def
            : Array.isArray(def) ? JSON.stringify(def)
            : typeof def === 'object' && 'kind' in def
              ? `resolveProfile(${JSON.stringify(def)})`
              : '';
          return makeLiteral(value);
        });
        return { type: 'call', id: newNodeId(), fn, args };
      }
    } catch { /* fall through to empty-args Call */ }
    return makeNodeOfKind('call', fn);
  }

  // ─── Per-node mutations ──────────────────────────────────────────────
  function deleteN(nid: string) {
    if (!composition) return;
    const next = deleteNode(composition, nid);
    commit(imports, next);
  }

  function swapOp(node: TreeNode & { type: 'method' }, op: CsgOp) {
    if (!composition) return;
    commit(imports, replaceNode(composition, node.id, { ...node, op }));
    opPopup = null;
  }

  function commitLiteral(node: TreeNode & { type: 'literal' }, value: string) {
    if (!composition) return;
    commit(imports, replaceNode(composition, node.id, { ...node, value }));
    litEdit = null;
  }

  function commitArgPicker(node: TreeNode, choice: { kind: 'literal' | 'ref' | 'call'; value: string }) {
    if (!composition) return;
    let replacement: TreeNode;
    if (choice.kind === 'literal') replacement = makeLiteral(choice.value);
    else if (choice.kind === 'ref') replacement = { type: 'ref', id: newNodeId(), target: choice.value };
    else replacement = makeNodeOfKind('call', choice.value);
    commit(imports, replaceNode(composition, node.id, replacement));
    argPicker = null;
  }

  // ─── Inline transforms on Call (Option 1) ────────────────────────────
  /** Toggle the inline mv triplet on a Call. Off → add [0,0,0]; on → remove. */
  function toggleCallMv(call: TreeNode & { type: 'call' }) {
    if (!composition) return;
    const next: TreeNode = call.mv
      ? { ...call, mv: undefined }
      : { ...call, mv: [makeLiteral('0'), makeLiteral('0'), makeLiteral('0')] };
    commit(imports, replaceNode(composition, call.id, next));
  }
  function toggleCallRot(call: TreeNode & { type: 'call' }) {
    if (!composition) return;
    const next: TreeNode = call.rot
      ? { ...call, rot: undefined }
      : { ...call, rot: [makeLiteral('0'), makeLiteral('0'), makeLiteral('0')] };
    commit(imports, replaceNode(composition, call.id, next));
  }
  /** Commit a single axis value of a Call's mv or rot. Skips when no change. */
  /** Edit a Call's positional arg in place. Rewrites the arg as a
   *  literal carrying the user's text (numbers, expressions, refs all
   *  serialize via emitNode → `value` verbatim). Empty string clears
   *  back to the literal placeholder. */
  function commitCallArg(call: TreeNode & { type: 'call' }, i: number, value: string) {
    if (!composition) return;
    const cur = call.args[i];
    if (!cur) return;
    const next: TreeNode = (cur.type === 'literal')
      ? { ...cur, value }
      : { type: 'literal', id: cur.id, value };
    const updatedArgs = [...call.args];
    updatedArgs[i] = next;
    const replacement: TreeNode = { ...call, args: updatedArgs };
    commit(imports, replaceNode(composition, call.id, replacement));
  }

  function commitTransformAxis(call: TreeNode & { type: 'call' }, slot: 'mv' | 'rot', axis: 0 | 1 | 2, value: string) {
    if (!composition) return;
    const triplet = (slot === 'mv' ? call.mv : call.rot);
    if (!triplet) return;
    const updated = [...triplet] as [TreeNode, TreeNode, TreeNode];
    updated[axis] = { ...(triplet[axis] as any), value };
    const next: TreeNode = slot === 'mv'
      ? { ...call, mv: updated }
      : { ...call, rot: updated };
    commit(imports, replaceNode(composition, call.id, next));
  }

  // Inline transform editor — which file's mv/rot row is open. Keyed by
  // node.id. `mv` opens the mv row, `rot` opens the rot row. Both can be
  // open at once.
  let openTransform = $state<Record<string, { mv?: boolean; rot?: boolean }>>({});
  function toggleTransformRow(id: string, slot: 'mv' | 'rot') {
    const cur = openTransform[id] ?? {};
    openTransform = { ...openTransform, [id]: { ...cur, [slot]: !cur[slot] } };
  }

  // ─── Local popup state ────────────────────────────────────────────────
  let opPopup = $state<{ nodeId: string; x: number; y: number } | null>(null);
  let litEdit = $state<{ nodeId: string; value: string } | null>(null);
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

  let opPopupNode = $derived(opPopup && composition ? findById(composition, opPopup.nodeId) : null);

  function findById(root: TreeNode, nid: string): TreeNode | null {
    if (root.id === nid) return root;
    for (const c of childrenOf(root)) {
      const h = findById(c, nid);
      if (h) return h;
    }
    return null;
  }

  let refCandidates = $derived(imports.map((i) => i.name));

  // ─── Expansion state ─────────────────────────────────────────────────
  // Default: all folders expanded. Track per-id collapsed state so user
  // toggles persist while editing. `expanded[id] === false` = collapsed.
  let expanded = $state<Record<string, boolean>>({});

  // Top-level accordion sections (Imports + Composition). Both default open.
  let importsOpen = $state(true);
  let compositionOpen = $state(true);
  function isExpanded(id: string): boolean {
    return expanded[id] !== false; // default to open
  }
  function toggleExpand(id: string) {
    expanded = { ...expanded, [id]: !isExpanded(id) };
  }

  // ─── Glyphs + labels ─────────────────────────────────────────────────
  /** Container kind → folder-row badge (left of the name). The op chip
   *  for `method` is rendered separately and is clickable to swap. */
  function folderKindBadge(n: TreeNode): string {
    switch (n.type) {
      case 'list':    return '[ ]';      // place (no op)
      case 'stack':   return '↓';        // auto-mate
      case 'method':  return '';         // op chip rendered separately
      case 'overlay': return '⤴';        // datum align
      case 'mv':      return '↦';        // translate
      case 'rot':     return '↻';        // rotate
      default:        return '';
    }
  }
  function folderKindLabel(n: TreeNode): string {
    switch (n.type) {
      case 'list':    return 'list';
      case 'stack':   return 'stack';
      case 'method':  return 'method';
      case 'overlay': return 'overlay';
      case 'mv':      return 'mv';
      case 'rot':     return 'rot';
      default:        return '';
    }
  }
  function opGlyph(op: CsgOp): string {
    return op === 'add' ? '⊕' : op === 'intersect' ? '∩' : '⊖';
  }
  function methodOpClass(op: string): string {
    return op === 'add' ? 'op-add' : op === 'intersect' ? 'op-inter' : 'op-sub';
  }
  /** File row title for a leaf kind (call / ref / literal). */
  function fileTitle(n: TreeNode): string {
    if (n.type === 'call') {
      const args = n.args.map((a: TreeNode) => emitShort(a)).join(', ');
      return `${n.fn || '?'}(${args})`;
    }
    if (n.type === 'ref') return `→ ${n.target || '?'}`;
    if (n.type === 'literal') return n.value || '·';
    return '';
  }
  /** Short emitter used to print a Call's arg list inline. Keeps the row
   *  one line; nested calls collapse to `<fn>(…)`. */
  function emitShort(n: TreeNode): string {
    switch (n.type) {
      case 'literal': return n.value || '·';
      case 'ref':     return n.target || '?';
      case 'call':    return `${n.fn || '?'}(${n.args.length ? '…' : ''})`;
      case 'method':  return `(method)`;
      case 'list':    return `[${n.children.length}]`;
      case 'stack':   return `↓[${n.children.length}]`;
      case 'overlay': return `overlay`;
      case 'mv':      return `mv(…)`;
      case 'rot':     return `rot(…)`;
      default:        return '';
    }
  }
  function triValuePreview(arr: [TreeNode, TreeNode, TreeNode]): string {
    return `[${arr.map((a) => a.type === 'literal' ? (a.value || '0') : emitShort(a)).join(', ')}]`;
  }
</script>

<div class="ce-root">
  <!-- ─── Imports ──────────────────────────────────────────────────── -->
  <section class="ce-section ce-imports" class:collapsed={!importsOpen}>
    <header class="ce-section-head"
      role="button" tabindex="0"
      aria-expanded={importsOpen}
      onclick={() => (importsOpen = !importsOpen)}
      onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); importsOpen = !importsOpen; } }}>
      <span class="ce-section-twist">{importsOpen ? '▾' : '▸'}</span>
      <span class="ce-section-title">📥 Imports</span>
      <span class="ce-section-count">{imports.length}</span>
      {#if canEdit}
        <button class="ce-add-btn" type="button" title="Add import" onclick={(e) => { e.stopPropagation(); openImportPopup(e); }}>+ Import</button>
      {/if}
    </header>
    {#if importsOpen}
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
              <button class="ce-imp-use" type="button"
                title={`Insert ${imp.name}() into the composition with ${imp.src}'s defaults`}
                onclick={() => insertImportUse(imp)}>+ use</button>
              <button class="ce-imp-del" type="button" title="Remove import" onclick={() => removeImport(imp.name)}>×</button>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
    {/if}
  </section>

  <!-- ─── Composition (folder tree) ────────────────────────────────── -->
  <section class="ce-section ce-composition" class:collapsed={!compositionOpen}
    ondragover={(e) => { if (canEdit && e.dataTransfer?.types.includes('application/x-primitive-id')) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; } }}
    ondrop={(e) => {
      if (!canEdit) return;
      if (!e.dataTransfer?.types.includes('application/x-primitive-id')) return;
      e.preventDefault();
      const dropped = e.dataTransfer.getData('application/x-primitive-id');
      if (!dropped) return;
      callWithDefaults(dropped).then(insertCallIntoComposition);
    }}>
    <!-- Compose root row IS the section title. Click to toggle.
         When the root is a List/Stack the body renders its children
         directly (so the list itself doesn't double-render); when the
         root is a single non-folder node it renders as the sole child.
         rootKindBadge is the $derived above. -->
    <header class="ce-row ce-folder-row ce-comp-root"
      role="button" tabindex="0"
      aria-expanded={compositionOpen}
      onclick={() => (compositionOpen = !compositionOpen)}
      onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); compositionOpen = !compositionOpen; } }}>
      <span class="ce-twist">{compositionOpen ? '▾' : '▸'}</span>
      <span class="ce-glyph">📁</span>
      <span class="ce-kind-badge">{rootKindBadge}</span>
      <span class="ce-name">compose</span>
      <span class="ce-row-spacer"></span>
      {#if canEdit}
        <button class="ce-row-btn" type="button" title="Add a file (import)" onclick={(e) => { e.stopPropagation(); openFilePopup(undefined, e); }}>+ file</button>
        <button class="ce-row-btn" type="button" title="Add a sub-compose (list or operation)" onclick={(e) => { e.stopPropagation(); openFolderPopup(undefined, e); }}>+ compose</button>
      {/if}
    </header>
    {#if compositionOpen}
      {#if composition === null}
        <div class="ce-tree">
          <div class="ce-row ce-empty-row" style="--depth: 1">
            <span class="ce-empty-hint">empty — drag an import or click + file / + compose</span>
          </div>
        </div>
      {:else if composition.type === 'list' || composition.type === 'stack'}
        <!-- Root list/stack — render its children at depth 0; the header IS the list row. -->
        <div class="ce-tree">
          {#if composition.children.length === 0}
            <div class="ce-row ce-empty-row" style="--depth: 1">
              <span class="ce-empty-hint">empty — drag an import or click + file / + compose</span>
            </div>
          {:else}
            {#each composition.children as child (child.id)}
              {@render row(child, 0)}
            {/each}
          {/if}
        </div>
      {:else}
        <!-- Root is a single non-folder node — render it as the only child. -->
        <div class="ce-tree">
          {@render row(composition, 0)}
        </div>
      {/if}
    {/if}
  </section>
</div>

<!-- ─── Recursive row render ──────────────────────────────────────── -->
{#snippet row(n: TreeNode, depth: number)}
  {#if isFolder(n)}
    {@render folderRow(n, depth)}
  {:else}
    {@render fileRow(n, depth)}
  {/if}
{/snippet}

{#snippet folderRow(n: TreeNode, depth: number)}
  {@const open = isExpanded(n.id)}
  <div class="ce-row ce-folder-row" class:collapsed={!open} style="--depth: {depth}">
    <button class="ce-twist" type="button" title={open ? 'Collapse' : 'Expand'} onclick={() => toggleExpand(n.id)}>
      {open ? '▾' : '▸'}
    </button>
    <span class="ce-glyph">📁</span>
    {#if n.type === 'method'}
      {#if canEdit}
        <button
          class="ce-op-chip {methodOpClass(n.op)}"
          type="button"
          title="Swap op"
          onclick={(ev) => openOpPopup(ev, n.id)}
        >{opGlyph(n.op)} {n.op}</button>
      {:else}
        <span class="ce-op-chip {methodOpClass(n.op)}">{opGlyph(n.op)} {n.op}</span>
      {/if}
    {:else}
      <span class="ce-kind-badge">{folderKindBadge(n)}</span>
    {/if}
    <span class="ce-name">{folderKindLabel(n)}</span>
    {#if n.name}
      <span class="ce-as">as {n.name}</span>
    {/if}
    <span class="ce-row-spacer"></span>
    {#if canEdit}
      {#if n.type === 'list' || n.type === 'stack'}
        <button class="ce-row-btn" type="button" title="Add a file (import)" onclick={(e) => openFilePopup(n.id, e)}>+ file</button>
        <button class="ce-row-btn" type="button" title="Add a sub-compose (list or operation)" onclick={(e) => openFolderPopup(n.id, e)}>+ compose</button>
      {/if}
      <button class="ce-row-btn ce-row-x" type="button" title="Delete" onclick={() => deleteN(n.id)}>×</button>
    {/if}
  </div>

  {#if open}
    {@render folderChildren(n, depth + 1)}
  {/if}
{/snippet}

{#snippet folderChildren(n: TreeNode, depth: number)}
  {#if n.type === 'list' || n.type === 'stack'}
    <div class="ce-folder-children"
      ondragover={(e) => { if (e.dataTransfer?.types.includes('application/x-primitive-id')) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; } }}
      ondrop={(e) => {
        if (!e.dataTransfer?.types.includes('application/x-primitive-id')) return;
        e.preventDefault();
        const dropped = e.dataTransfer.getData('application/x-primitive-id');
        if (dropped) callWithDefaults(dropped).then((node) => appendChildToList(n.id, node));
      }}>
      {#each n.children as c (c.id)}
        {@render row(c, depth)}
      {/each}
      {#if n.children.length === 0}
        <div class="ce-row ce-empty-row" style="--depth: {depth}">
          <span class="ce-empty-hint">empty — drop here or use + file / + folder above</span>
        </div>
      {/if}
    </div>
  {:else if n.type === 'method'}
    <div class="ce-folder-children">
      {@render slotRow('obj', n.obj, depth)}
      {@render slotRow('arg', n.arg, depth)}
    </div>
  {:else if n.type === 'overlay'}
    <div class="ce-folder-children">
      {@render slotRow('anchor', n.anchor, depth)}
      {@render slotRow('child',  n.child,  depth)}
    </div>
  {:else if n.type === 'mv'}
    <div class="ce-folder-children">
      {@render slotRow('child', n.child, depth)}
      <div class="ce-row ce-axis-row" style="--depth: {depth}">
        <span class="ce-axis-label">offset</span>
        {#each n.offset as ax, i (ax.id)}
          {@render axisInput(ax, depth, i)}
        {/each}
      </div>
    </div>
  {:else if n.type === 'rot'}
    <div class="ce-folder-children">
      {@render slotRow('child', n.child, depth)}
      <div class="ce-row ce-axis-row" style="--depth: {depth}">
        <span class="ce-axis-label">rot</span>
        {#each n.rot as ax, i (ax.id)}
          {@render axisInput(ax, depth, i)}
        {/each}
      </div>
    </div>
  {/if}
{/snippet}

{#snippet slotRow(label: string, child: TreeNode, depth: number)}
  <div class="ce-slot-wrap">
    <span class="ce-slot-label" style="--depth: {depth}">{label}:</span>
    {@render row(child, depth)}
  </div>
{/snippet}

{#snippet axisInput(ax: TreeNode, depth: number, idx: number)}
  {#if ax.type === 'literal' && canEdit}
    <input
      class="ce-axis-input"
      type="text"
      value={ax.value}
      placeholder="0"
      onblur={(e) => commitLiteral(ax, (e.currentTarget as HTMLInputElement).value)}
      onkeydown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }}
    />
  {:else if ax.type === 'literal'}
    <span class="ce-axis-val">{ax.value || '0'}</span>
  {:else}
    <span class="ce-axis-val">{emitShort(ax)}</span>
  {/if}
{/snippet}

{#snippet fileRow(n: TreeNode, depth: number)}
  {@const callOpen = n.type === 'call' && isExpanded(n.id)}
  {@const callHasProps = n.type === 'call' && n.args.length > 0}
  <div class="ce-row ce-file-row" style="--depth: {depth}">
    {#if n.type === 'call' && callHasProps}
      <button class="ce-twist" type="button" title={callOpen ? 'Collapse properties' : 'Expand properties'} onclick={() => toggleExpand(n.id)}>{callOpen ? '▾' : '▸'}</button>
    {:else}
      <span class="ce-twist-spacer"></span>
    {/if}
    <span class="ce-glyph">📄</span>
    {#if n.type === 'call'}
      <span class="ce-file-fn-glyph">ƒ</span>
      <span class="ce-file-title" title={fileTitle(n)} onclick={() => { if (callHasProps) toggleExpand(n.id); }}>{n.fn}{n.args.length > 0 ? `(${n.args.length})` : '()'}</span>
    {:else if n.type === 'ref'}
      <span class="ce-file-ref-glyph">🔗</span>
      <span class="ce-file-title">{fileTitle(n)}</span>
    {:else if n.type === 'literal'}
      <span class="ce-file-lit-glyph">📝</span>
      {#if canEdit && litEdit && litEdit.nodeId === n.id}
        <input
          class="ce-lit-input"
          value={litEdit.value}
          oninput={(e) => { if (litEdit) litEdit = { ...litEdit, value: (e.currentTarget as HTMLInputElement).value }; }}
          onblur={() => { if (litEdit) commitLiteral(n as any, litEdit.value); }}
          onkeydown={(e) => {
            if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
            else if (e.key === 'Escape') litEdit = null;
          }}
        />
      {:else if canEdit && !n.value}
        <button class="ce-empty-arg" type="button" title="Set value" onclick={(ev) => openArgPicker(ev, n.id)}>+ value</button>
      {:else if canEdit}
        <button class="ce-file-title ce-lit-btn" type="button" title="Edit value" onclick={() => openLitEdit(n as any)}>{n.value}</button>
      {:else}
        <span class="ce-file-title">{n.value || '·'}</span>
      {/if}
    {/if}

    <!-- Inline transform chips (Option 1) — visible when set. Reflect
         current mv / rot triplet. -->
    {#if n.type === 'call' && n.mv}
      <button class="ce-tx-chip ce-tx-chip-mv" type="button"
        title="Edit inline mv triplet"
        disabled={!canEdit}
        onclick={() => toggleTransformRow(n.id, 'mv')}
      >@ mv {triValuePreview(n.mv)}</button>
    {/if}
    {#if n.type === 'call' && n.rot}
      <button class="ce-tx-chip ce-tx-chip-rot" type="button"
        title="Edit inline rot triplet"
        disabled={!canEdit}
        onclick={() => toggleTransformRow(n.id, 'rot')}
      >↻ rot {triValuePreview(n.rot)}</button>
    {/if}

    <span class="ce-row-spacer"></span>

    {#if canEdit && n.type === 'call'}
      <button class="ce-row-btn ce-row-tx" class:active={!!n.mv} type="button"
        title={n.mv ? 'Remove mv' : 'Add inline mv (translate)'}
        onclick={() => toggleCallMv(n as any)}>↦</button>
      <button class="ce-row-btn ce-row-tx" class:active={!!n.rot} type="button"
        title={n.rot ? 'Remove rot' : 'Add inline rot (rotate)'}
        onclick={() => toggleCallRot(n as any)}>↻</button>
    {/if}
    {#if canEdit}
      <button class="ce-row-btn ce-row-x" type="button" title="Delete" onclick={() => deleteN(n.id)}>×</button>
    {/if}
  </div>

  <!-- Inline transform editor — expands below the file row when toggled. -->
  {#if n.type === 'call' && n.mv && openTransform[n.id]?.mv}
    <div class="ce-row ce-tx-edit-row" style="--depth: {depth}">
      <span class="ce-tx-edit-label">mv</span>
      {#each n.mv as ax, i (ax.id)}
        {#if ax.type === 'literal'}
          <input
            class="ce-axis-input"
            type="text"
            value={ax.value}
            placeholder="0"
            disabled={!canEdit}
            onblur={(e) => commitTransformAxis(n as any, 'mv', i as 0 | 1 | 2, (e.currentTarget as HTMLInputElement).value)}
            onkeydown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }}
          />
        {:else}
          <span class="ce-axis-val">{emitShort(ax)}</span>
        {/if}
      {/each}
    </div>
  {/if}
  {#if n.type === 'call' && n.rot && openTransform[n.id]?.rot}
    <div class="ce-row ce-tx-edit-row" style="--depth: {depth}">
      <span class="ce-tx-edit-label">rot</span>
      {#each n.rot as ax, i (ax.id)}
        {#if ax.type === 'literal'}
          <input
            class="ce-axis-input"
            type="text"
            value={ax.value}
            placeholder="0"
            disabled={!canEdit}
            onblur={(e) => commitTransformAxis(n as any, 'rot', i as 0 | 1 | 2, (e.currentTarget as HTMLInputElement).value)}
            onkeydown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }}
          />
        {:else}
          <span class="ce-axis-val">{emitShort(ax)}</span>
        {/if}
      {/each}
    </div>
  {/if}

  <!-- Properties grid — Call's positional args rendered as labeled
       name/value cells, 2 per row. Labels come from the dependency
       snapshot (meta.dependencies → src primitive paramKeys). -->
  {#if n.type === 'call' && callHasProps && callOpen}
    <div class="ce-props-grid" style="--depth: {depth}">
      {#each n.args as arg, i (arg.id)}
        <div class="ce-prop-cell">
          <span class="ce-prop-label">{labelForArg(n, i)}</span>
          {#if arg.type === 'literal'}
            <input
              class="ce-prop-input"
              type="text"
              value={arg.value}
              placeholder="0"
              disabled={!canEdit}
              onblur={(e) => commitCallArg(n as any, i, (e.currentTarget as HTMLInputElement).value)}
              onkeydown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }}
            />
          {:else}
            <span class="ce-prop-val" title={emitNode(arg)}>{emitShort(arg)}</span>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
{/snippet}

<!-- ─── Popups ─────────────────────────────────────────────────────── -->

<!-- Import picker -->
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

<!-- + file / + folder picker -->
{#if rootPopup}
  <FloatingPanel
    title={rootPopup.step === 'fn' ? '+ file (import)' : '+ compose (list / operation)'}
    subtitle={rootPopup.step === 'fn'
      ? (imports.length === 0 ? 'No imports yet — add one in the Imports section first' : 'Pick an import alias')
      : 'List = collection. Method = boolean op. Others are advanced containers.'}
    visible={true}
    x={rootPopup.x}
    y={rootPopup.y}
    width="320px"
    maxHeight="60vh"
    onClose={closeRootPopup}
  >
    <div class="ce-pop">
      {#if rootPopup.step === 'folder'}
        <div class="ce-kind-grid">
          <button class="ce-kind-btn" type="button" onclick={() => createFolder('list')}>
            <span class="ce-kind-glyph">[ ]</span><span class="ce-kind-lbl">List</span>
          </button>
          <button class="ce-kind-btn" type="button" onclick={() => createFolder('stack')}>
            <span class="ce-kind-glyph">↓</span><span class="ce-kind-lbl">Stack</span>
          </button>
          <button class="ce-kind-btn" type="button" onclick={() => createFolder('method')}>
            <span class="ce-kind-glyph">⊖</span><span class="ce-kind-lbl">Method</span>
          </button>
          <button class="ce-kind-btn" type="button" onclick={() => createFolder('overlay')}>
            <span class="ce-kind-glyph">⤴</span><span class="ce-kind-lbl">Overlay</span>
          </button>
          <button class="ce-kind-btn" type="button" onclick={() => createFolder('mv')}>
            <span class="ce-kind-glyph">↦</span><span class="ce-kind-lbl">Mv</span>
          </button>
          <button class="ce-kind-btn" type="button" onclick={() => createFolder('rot')}>
            <span class="ce-kind-glyph">↻</span><span class="ce-kind-lbl">Rot</span>
          </button>
        </div>
      {:else}
        <input
          class="ce-search"
          type="search"
          placeholder="Filter imports…"
          autofocus
          value={rootPopup.query}
          oninput={(e) => { if (rootPopup) rootPopup = { ...rootPopup, query: (e.currentTarget as HTMLInputElement).value }; }}
        />
        <div class="ce-pop-list">
          {#each fnCandidates as fn (fn)}
            <button class="ce-pop-item" type="button" onclick={() => createCallNode(fn)}>
              <span class="ce-pop-id">{fn}</span>
              <span class="ce-pop-tag">import</span>
            </button>
          {/each}
          {#if fnCandidates.length === 0}
            <div class="ce-pop-empty">
              {imports.length === 0
                ? 'No imports declared. Add a primitive in the Imports section above first.'
                : 'No matches'}
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </FloatingPanel>
{/if}

<!-- Method op picker -->
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
          >{opGlyph(op as CsgOp)} {op}</button>
        {/each}
      </div>
    </div>
  </FloatingPanel>
{/if}

<!-- Arg picker -->
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
    display: flex; flex-direction: column; gap: 4px; padding: 2px 3px;
    font: 13px ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .ce-section {
    background: #fff; border: 1px solid #ddd; border-radius: 6px;
    padding: 3px 5px;
  }
  .ce-section-head {
    display: flex; align-items: center; gap: 5px;
    margin-bottom: 2px; padding-bottom: 2px;
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
  .ce-empty { color: #888; font-style: italic; padding: 3px 4px; }

  /* Accordion section twist + collapsed visuals */
  .ce-section-head { cursor: pointer; user-select: none; }
  .ce-section-head:hover { background: rgba(0,0,0,0.02); }
  .ce-section-twist { color: #888; font-size: 10px; width: 12px; text-align: center; }
  .ce-section.collapsed .ce-section-head { margin-bottom: 0; padding-bottom: 0; border-bottom: 0; }

  /* Imports */
  .ce-imports { background: #eef5ff; border-color: #bcd3ee; }
  .ce-imports-list { display: flex; flex-direction: column; gap: 0; }
  .ce-import-row {
    display: flex; align-items: center; gap: 5px; padding: 1px 2px;
    color: #1e3a8a; min-height: 20px; line-height: 1.4;
  }
  .ce-imp-name { font-weight: 700; color: #0c2e6e; }
  .ce-imp-eq { color: #5e88c3; }
  .ce-imp-src { color: #1e3a8a; flex: 1; }
  .ce-imp-use {
    appearance: none; background: #eef5ff; border: 1px solid #b8d4f2;
    border-radius: 4px; padding: 1px 8px;
    font: 600 11px ui-sans-serif; color: #1e40af; cursor: pointer;
    margin-left: auto; margin-right: 4px;
  }
  .ce-imp-use:hover { background: #ddeaff; border-color: #1e40af; }
  .ce-imp-del {
    background: transparent; border: none; cursor: pointer;
    color: #888; font-size: 14px; line-height: 1;
    width: 18px; height: 18px; border-radius: 3px;
    padding: 0;
  }
  .ce-imp-del:hover { background: #fdecec; color: #cc2222; }

  /* Composition — flat tree */
  .ce-composition { background: #fafafa; }
  .ce-tree {
    display: flex; flex-direction: column;
    gap: 0;
    font: 13px ui-sans-serif, system-ui;
  }
  .ce-folder-children { display: flex; flex-direction: column; gap: 0; }
  .ce-slot-wrap { display: flex; flex-direction: column; gap: 0; }
  .ce-slot-label {
    font-size: 10px; color: #888;
    padding: 1px 0 0 calc(var(--depth, 0) * 16px + 32px);
  }

  /* One-line rows */
  .ce-row {
    display: flex; align-items: center; gap: 4px;
    padding: 1px 4px;
    padding-left: calc(var(--depth, 0) * 14px + 2px);
    border-radius: 3px;
    min-height: 20px;
    line-height: 1.4;
  }
  .ce-row:hover { background: #f0f4fa; }
  .ce-folder-row { font-weight: 600; color: #1f2937; }
  .ce-folder-row.collapsed { opacity: 0.85; }
  .ce-file-row { color: #1f2937; }

  .ce-twist {
    background: transparent; border: none; cursor: pointer;
    width: 14px; height: 14px;
    color: #888; font-size: 10px; line-height: 1;
    padding: 0; display: inline-flex; align-items: center; justify-content: center;
  }
  .ce-twist:hover { color: #1e3a8a; }
  .ce-twist-spacer { display: inline-block; width: 14px; }

  .ce-glyph { font-size: 14px; line-height: 1; }
  .ce-kind-badge {
    font: 11px ui-monospace, SFMono-Regular, Menlo, monospace;
    color: #555; background: #f0f0f5; padding: 0 6px; border-radius: 3px;
    min-width: 16px; text-align: center;
  }
  .ce-name { font-weight: 600; color: #1f2937; }
  .ce-as { color: #888; font-style: italic; font-size: 11px; margin-left: 2px; }

  /* Method op chip — replaces kind badge, click to swap. */
  .ce-op-chip {
    appearance: none;
    border: 1px solid transparent;
    background: #f5f5f5;
    color: #444;
    font: 600 11px ui-sans-serif, system-ui;
    padding: 1px 6px;
    border-radius: 3px;
    cursor: pointer;
  }
  .ce-op-chip:hover { border-color: #bcd3ee; background: #eef5ff; }
  .ce-op-chip.op-sub   { background: #fce7f3; color: #9d174d; }
  .ce-op-chip.op-add   { background: #ccfbf1; color: #115e59; }
  .ce-op-chip.op-inter { background: #fae8ff; color: #6b21a8; }

  /* File row — call / ref / literal */
  .ce-file-fn-glyph,
  .ce-file-ref-glyph,
  .ce-file-lit-glyph {
    display: inline-flex; align-items: center; justify-content: center;
    width: 18px; height: 16px; border-radius: 3px;
    font: 700 10px ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .ce-file-fn-glyph  { background: #fef3c7; color: #92400e; }
  .ce-file-ref-glyph { background: #e0f2fe; color: #0c4a6e; font-size: 12px; }
  .ce-file-lit-glyph { background: #f5f5f5; color: #525252; font-size: 11px; }
  .ce-file-title {
    color: #1f2937; font: 600 12px ui-monospace, SFMono-Regular, Menlo, monospace;
    max-width: 320px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }

  .ce-row-spacer { flex: 1; }
  .ce-row-btn {
    background: transparent; border: 1px solid transparent; border-radius: 3px;
    cursor: pointer; padding: 1px 5px;
    font: 600 11px ui-sans-serif, system-ui;
    color: #555;
    opacity: 0;
    transition: opacity 0.1s;
  }
  .ce-row:hover .ce-row-btn { opacity: 1; }
  .ce-row-btn:hover { background: #eef5ff; border-color: #bcd3ee; color: #0c2e6e; }
  .ce-row-btn.ce-row-x { color: #b94545; font-weight: 700; }
  .ce-row-btn.ce-row-x:hover { background: #fdecec; border-color: #f5a5a5; color: #cc2222; }
  .ce-row-btn.ce-row-tx { font-size: 13px; padding: 0 5px; }
  .ce-row-btn.ce-row-tx.active {
    background: #fffbeb; border-color: #fbbf24; color: #92400e; opacity: 1;
  }

  /* Inline transform chips on file rows */
  .ce-tx-chip {
    background: #fffbeb; border: 1px solid #fde68a;
    color: #92400e;
    font: 600 11px ui-monospace, SFMono-Regular, Menlo, monospace;
    padding: 1px 6px; border-radius: 3px;
    cursor: pointer;
    margin-left: 4px;
  }
  .ce-tx-chip:hover:not(:disabled) { background: #fef3c7; border-color: #f59e0b; }
  .ce-tx-chip:disabled { cursor: default; opacity: 0.85; }
  .ce-tx-chip-rot { background: #fae8ff; border-color: #e9d5ff; color: #6b21a8; }
  .ce-tx-chip-rot:hover:not(:disabled) { background: #f3e8ff; border-color: #c084fc; }

  /* Inline 3-input transform editor row */
  .ce-tx-edit-row {
    padding-left: calc(var(--depth, 0) * 16px + 36px);
    background: #fffbeb;
    border-left: 2px solid #fbbf24;
    margin-left: calc(var(--depth, 0) * 16px + 12px);
    padding-left: 6px;
  }
  .ce-tx-edit-label {
    font: 600 11px ui-monospace, SFMono-Regular, Menlo, monospace;
    color: #92400e;
    min-width: 28px;
  }
  .ce-axis-row {
    padding-left: calc(var(--depth, 0) * 16px + 36px);
  }
  .ce-axis-label {
    font-size: 11px; color: #888;
    min-width: 48px;
  }
  .ce-axis-input {
    border: 1px solid #d0d0d0; border-radius: 3px;
    padding: 1px 4px; font: 12px ui-monospace, SFMono-Regular, Menlo, monospace;
    width: 60px;
    background: #fff;
  }
  .ce-axis-input:focus { outline: 2px solid #bcd3ee; border-color: #bcd3ee; }
  .ce-axis-val {
    font: 12px ui-monospace, SFMono-Regular, Menlo, monospace;
    color: #444; padding: 1px 4px;
    min-width: 24px; text-align: center;
  }

  /* Properties grid — Call args rendered as label/value pairs, 2 per row.
     Sits in the expanded body of a file (Call) row, indented under it. */
  .ce-props-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    column-gap: 6px;
    row-gap: 2px;
    padding: 2px 6px 4px;
    padding-left: calc(var(--depth, 0) * 14px + 36px);
    background: #fafafa;
    border-left: 2px solid #d4d4dc;
    margin-left: calc(var(--depth, 0) * 14px + 12px);
  }
  .ce-prop-cell {
    display: grid;
    grid-template-columns: minmax(48px, 1fr) minmax(60px, 1.4fr);
    align-items: center;
    column-gap: 4px;
    min-width: 0;
  }
  .ce-prop-label {
    font: 11px ui-monospace, SFMono-Regular, Menlo, monospace;
    color: #555;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .ce-prop-input {
    border: 1px solid #d0d0d0; border-radius: 3px;
    padding: 1px 4px; font: 12px ui-monospace, SFMono-Regular, Menlo, monospace;
    width: 100%; min-width: 0; background: #fff;
  }
  .ce-prop-input:focus { outline: 2px solid #bcd3ee; border-color: #bcd3ee; }
  .ce-prop-val {
    font: 12px ui-monospace, SFMono-Regular, Menlo, monospace;
    color: #444; padding: 1px 4px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }

  /* Inline literal edit (file row literal) */
  .ce-lit-input {
    border: 1px solid #bcd3ee; border-radius: 3px;
    padding: 1px 4px; font: 12px ui-monospace, SFMono-Regular, Menlo, monospace;
    background: #fff; min-width: 80px;
  }
  .ce-lit-btn {
    background: transparent; border: 1px dashed transparent;
    cursor: pointer; padding: 1px 4px; font: inherit;
    border-radius: 3px; color: inherit;
  }
  .ce-lit-btn:hover { border-color: #bcd3ee; background: #eef5ff; }

  .ce-empty-arg {
    background: #fffbeb; border: 1px dashed #fbbf24; cursor: pointer;
    color: #92400e; padding: 1px 6px; border-radius: 3px;
    font: 600 11px ui-sans-serif, system-ui;
  }
  .ce-empty-arg:hover { background: #fef3c7; }

  /* Empty hint row */
  .ce-empty-row {
    padding-left: calc(var(--depth, 0) * 16px + 32px);
  }
  .ce-empty-hint {
    color: #999; font-style: italic; font-size: 11px;
  }
  .ce-empty-row:hover { background: transparent; }

  /* Popup chrome (unchanged from prior render) */
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
  :global(.ce-pop-tag-primitive) { background: #fef3c7; color: #92400e; }
  .ce-pop-tag-helper { background: #ccfbf1; color: #115e59; }
  .ce-pop-empty { color: #888; font-style: italic; padding: 8px; text-align: center; }
  .ce-pop-confirm {
    background: #1e3a8a; color: #fff; border: none; border-radius: 4px;
    padding: 4px 8px; font: 600 12px ui-sans-serif, system-ui;
    cursor: pointer;
  }
  .ce-pop-confirm:hover { background: #1e40af; }

  .ce-kind-grid {
    display: grid; grid-template-columns: repeat(3, 1fr);
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
