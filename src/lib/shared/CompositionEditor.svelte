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
    parseImports, parseComposition, parseDependencyParamKeys, applyToSource, addAssemblyParam,
    replaceNode, deleteNode, newNodeId, childrenOf, emitNode, walkTree,
    type TreeNode, type ImportDef, type CsgOp, type NodeType,
  } from '$lib/cad/composition-tree';
  import { paramKeysOf } from '$lib/cad/assembly-deps';
  import FloatingPanel from './FloatingPanel.svelte';
  import { INSTANCE_PALETTE, colorsForInstance } from './instance-colors';

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

  // ─── Per-instance colours (outer / inner) ─────────────────────────────
  // Mirror PrimitiveView's `meta.instanceColors[name] = { outer, inner }`
  // shape — same parse + serialize so the bake pipeline picks the colours
  // up the same way it does for primitive composites. Keyed by the Call's
  // alias (A, B, C, …); two Calls with the same fn but different aliases
  // can carry different colours.
  function instanceColorsSpan(): { start: number; end: number; objStart: number } | null {
    const m = /instanceColors\s*:\s*\{/.exec(source);
    if (!m) return null;
    const objStart = source.indexOf('{', m.index);
    let depth = 0, i = objStart;
    for (; i < source.length; i++) {
      const c = source[i];
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    return { start: m.index, end: i, objStart };
  }
  function readInstanceColors(): Record<string, { outer?: string; inner?: string }> {
    const span = instanceColorsSpan();
    if (!span) return {};
    try {
      const obj = new Function('return (' + source.slice(span.objStart, span.end) + ')')();
      const out: Record<string, { outer?: string; inner?: string }> = {};
      for (const k of Object.keys(obj || {})) {
        const v = obj[k];
        out[k] = typeof v === 'string' ? { outer: v } : (v && typeof v === 'object' ? v : {});
      }
      return out;
    } catch { return {}; }
  }
  /** Resolved {outer, inner} for a Call alias — merges any override over the
   *  fallback INSTANCE_PALETTE colour. */
  function instanceColors(name: string): { outer: string; inner: string } {
    return colorsForInstance(name, readInstanceColors()[name]);
  }
  function serializeInstanceColors(obj: Record<string, { outer?: string; inner?: string }>): string {
    const entries = Object.entries(obj)
      .filter(([, v]) => v && (v.outer || v.inner))
      .map(([k, v]) => {
        const parts: string[] = [];
        if (v.outer) parts.push(`outer: '${v.outer}'`);
        if (v.inner) parts.push(`inner: '${v.inner}'`);
        return `${k}: { ${parts.join(', ')} }`;
      });
    return `instanceColors: { ${entries.join(', ')} }`;
  }
  function setInstanceColor(name: string, which: 'outer' | 'inner', hex: string) {
    if (!canEdit) return;
    const cur = readInstanceColors();
    cur[name] = { ...(cur[name] || {}), [which]: hex };
    const block = serializeInstanceColors(cur);
    const span = instanceColorsSpan();
    let out = source;
    if (span) {
      out = source.slice(0, span.start) + block + source.slice(span.end);
    } else {
      const mm = /export\s+const\s+meta\s*=\s*\{/.exec(source);
      if (!mm) return;
      const at = mm.index + mm[0].length;
      out = source.slice(0, at) + `\n  ${block},` + source.slice(at);
    }
    onSourceChange?.(out);
  }
  let colorPopup = $state<{ name: string; which: 'outer' | 'inner'; x: number; y: number } | null>(null);
  function openColorPopup(name: string, which: 'outer' | 'inner', ev: MouseEvent) {
    ev.stopPropagation();
    colorPopup = { name, which, x: ev.clientX, y: ev.clientY };
  }
  function pickColor(hex: string) {
    if (!colorPopup) return;
    setInstanceColor(colorPopup.name, colorPopup.which, hex);
    colorPopup = null;
  }
  // Settings popup — one ⚙ button per Call replaces the cluster of inline
  // chips (outer/inner swatches, future per-instance rename/lock). Click
  // toggle: same button closes the popup; clicking on a different Call's
  // gear retargets the popup without an intermediate close.
  let settingsPopup = $state<{ name: string; x: number; y: number } | null>(null);
  function openSettingsPopup(name: string, ev: MouseEvent) {
    ev.stopPropagation();
    if (settingsPopup && settingsPopup.name === name) { settingsPopup = null; return; }
    const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    settingsPopup = {
      name,
      x: Math.min(rect.left, window.innerWidth - 280),
      y: Math.min(rect.bottom + 4, window.innerHeight - 200),
    };
  }
  function closeSettingsPopup() { settingsPopup = null; }
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
  /** Remove EVERY import that points to this src (used by the row trash —
   *  rows are deduped by src, so the user expects "remove this primitive
   *  from my available list"). Only safe when no Call references those
   *  aliases; we guard with hasInstancesOf below. */
  function removeImportSrc(src: string) {
    commit(imports.filter((i) => i.src !== src), composition);
  }
  /** Imports list deduplicated by src. Display-only — the underlying
   *  `imports` array can carry multiple `{name, src}` rows for the same
   *  src (one per dropped instance in the compose), but the section
   *  shows ONE row per primitive. */
  let uniqueImports = $derived.by<ImportDef[]>(() => {
    const out: ImportDef[] = [];
    const seen = new Set<string>();
    for (const imp of imports) {
      if (seen.has(imp.src)) continue;
      seen.add(imp.src);
      out.push(imp);
    }
    return out;
  });
  /** True when ANY Call in the tree references one of this src's aliases.
   *  Disables the trash button so the user can't orphan a Call mid-compose. */
  function hasInstancesOf(src: string): boolean {
    if (!composition) return false;
    const aliases = new Set(imports.filter((i) => i.src === src).map((i) => i.name));
    let hit = false;
    walkTree(composition, (n) => {
      if (hit) return;
      if (n.type === 'call' && aliases.has(n.fn)) hit = true;
    });
    return hit;
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
  /** Drop a new INSTANCE of this primitive into the composition. Each call
   *  allocates a FRESH letter alias so the compose tree reads
   *  `A: spiral, B: spiral, C: spiral` even when they're the same import.
   *  The imports section displays one row per unique src (deduplicated),
   *  so the proliferating aliases stay invisible there. */
  async function insertImportUse(imp: ImportDef) {
    const taken = new Set(imports.map((i) => i.name));
    const freshAlias = nextAlias(taken);
    const newImports = [...imports, { name: freshAlias, src: imp.src }];
    const fetched = await callWithDefaults(imp.src);
    const callNode = buildLiftedCall(fetched, freshAlias);
    const lifted = liftedSpecs(fetched, freshAlias);
    // Commit the import + composition + lifted params in one go.
    let root: TreeNode;
    if (composition === null) {
      root = { type: 'list', id: newNodeId(), children: [callNode] };
    } else if (composition.type === 'list' || composition.type === 'stack') {
      const replacement: TreeNode = { ...composition, children: [...composition.children, callNode] };
      root = replaceNode(composition, composition.id, replacement);
      expanded[composition.id] = true;
    } else {
      root = { type: 'list', id: newNodeId(), children: [composition, callNode] };
    }
    commitWithLifts(newImports, root, lifted);
  }

  /** Unwrap callWithDefaults' result, stamp the fresh alias on .fn, and
   *  carry paramKeys onto the Call so emitNode produces the object form
   *  `B({k1: v1, k2: v2, ...})` — each slot visibly named, args are the
   *  child primitive's DEFAULT VALUES as literals. The assembly's
   *  meta.params is NOT auto-modified — the user decides which child
   *  params to surface as assembly knobs by adding them through the
   *  Parameters panel + editing the corresponding Call arg from a
   *  literal default to `p.<key>`. */
  function buildLiftedCall(fetched: TreeNode | { node: TreeNode; paramKeys: string[]; specs: any[] }, alias: string): TreeNode {
    if ('node' in (fetched as any)) {
      const { node, paramKeys } = fetched as { node: TreeNode; paramKeys: string[]; specs: { key: string }[] };
      if (node.type !== 'call') return { ...node, fn: alias } as any;
      return { ...node, fn: alias, paramKeys };
    }
    const node = fetched as TreeNode;
    return node.type === 'call' ? { ...node, fn: alias } : node;
  }
  /** Stub kept for callers — auto-lift is gone, so this always returns []. */
  function liftedSpecs(_fetched: TreeNode | { specs: any[] }, _alias: string): Array<{ name: string; label: string; min: number; max: number; step: number; default: number }> {
    return [];
  }
  /** Commit a composition mutation. Auto-lift removed; meta.params edits
   *  are user-driven via the Parameters panel. */
  function commitWithLifts(
    newImports: readonly ImportDef[],
    newRoot: TreeNode | null,
    _lifts: Array<{ name: string; label: string; min: number; max: number; step: number; default: number }>,
  ) {
    if (!canEdit) return;
    const out = applyToSource(source, id, newImports, newRoot);
    onSourceChange?.(out);
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
  /** Add a new Call into the composition for the picked SRC. Always
   *  allocates a fresh letter alias (so two adds of `spiral` produce
   *  `A: spiral` + `B: spiral`). Mirrors insertImportUse — same alias
   *  allocation, but driven by the file-picker popup. */
  async function createCallNode(src: string) {
    const pid = rootPopup?.parentId;
    const taken = new Set(imports.map((i) => i.name));
    const freshAlias = nextAlias(taken);
    const newImports = [...imports, { name: freshAlias, src }];
    const fetched = await callWithDefaults(src);
    const node = buildLiftedCall(fetched, freshAlias);
    const lifted = liftedSpecs(fetched, freshAlias);
    let newRoot: TreeNode | null = composition;
    if (pid) {
      const parent = composition && findById(composition, pid);
      if (parent && (parent.type === 'list' || parent.type === 'stack')) {
        const replacement: TreeNode = { ...parent, children: [...parent.children, node] };
        newRoot = replaceNode(composition!, pid, replacement);
        expanded[pid] = true;
      }
    } else if (composition === null) {
      newRoot = { type: 'list', id: newNodeId(), children: [node] };
    } else if (composition.type === 'list' || composition.type === 'stack') {
      const replacement: TreeNode = { ...composition, children: [...composition.children, node] };
      newRoot = replaceNode(composition, composition.id, replacement);
      expanded[composition.id] = true;
    } else {
      newRoot = { type: 'list', id: newNodeId(), children: [composition, node] };
    }
    commitWithLifts(newImports, newRoot, lifted);
    closeRootPopup();
  }
  // Composition's "+ file" offers each imported PRIMITIVE (deduped by src) —
  // not every alias. Picking creates a new Call with a fresh letter alias
  // (the imports section stays a single row per primitive; the compose
  // tree carries the alphabet labels).
  let fnCandidates = $derived.by(() => {
    const q = (rootPopup?.query ?? '').toLowerCase();
    return uniqueImports
      .map((i) => i.src)
      .filter((s) => !q || s.toLowerCase().includes(q));
  });

  function tagFor(_fn: string): { tag: string; cls: string } {
    return { tag: 'import', cls: '' };
  }

  /** Engine-style param names that get SNAPSHOTTED as literals rather than
   *  lifted to assembly params. Pure resolution dials — the user almost
   *  never wants to drive them from the assembly's top-level knobs. */
  const ENGINE_PARAM_KEYS = new Set(['segments', 'divs']);

  /** Fetch the child primitive's source, extract param defaults, and return
   *  BOTH a Call node (with args as snapshot literals) AND the param specs
   *  the caller can lift onto the assembly. Each non-engine param gets
   *  contributed to `liftSpecs`; the caller decides whether to lift them
   *  and replace the literals with `p.<alias>_<key>` references. */
  async function callWithDefaults(fn: string): Promise<{
    node: TreeNode;
    paramKeys: string[];
    specs: Array<{ key: string; default: number; min: number; max: number; step: number; label: string }>;
  } | TreeNode> {
    try {
      const r = await fetch(`/api/primitives/source?name=${encodeURIComponent(fn)}`);
      if (r.ok) {
        const data = await r.json();
        const params = data?.params ?? {};
        const paramKeys = Object.keys(params);
        const specs: Array<{ key: string; default: number; min: number; max: number; step: number; label: string }> = [];
        const args: TreeNode[] = paramKeys.map((key) => {
          const p: any = params[key];
          const def = p?.default;
          const value =
            def == null ? ''
            : typeof def === 'number' ? String(def)
            : typeof def === 'string' ? def
            : Array.isArray(def) ? JSON.stringify(def)
            : typeof def === 'object' && 'kind' in def
              ? `resolveProfile(${JSON.stringify(def)})`
              : '';
          if (!ENGINE_PARAM_KEYS.has(key) && typeof def === 'number') {
            specs.push({
              key, default: def,
              min: typeof p?.min === 'number' ? p.min : 0,
              max: typeof p?.max === 'number' ? p.max : 10,
              step: typeof p?.step === 'number' ? p.step : 0.1,
              label: typeof p?.label === 'string' ? p.label : key,
            });
          }
          return makeLiteral(value);
        });
        return { node: { type: 'call', id: newNodeId(), fn, args }, paramKeys, specs };
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

  /** Wrap a Call in a method node, in place. The Call becomes the .obj
   *  side; a fresh sibling Call of the same import alias (cloned defaults)
   *  becomes the .arg side. Op defaults to 'subtract' — the most common
   *  bore-it-out case A(od).subtract(A(id)); user can swap to add /
   *  intersect via the op chip on the method folder row. */
  async function wrapCallInMethod(call: TreeNode & { type: 'call' }, op: CsgOp = 'subtract') {
    if (!composition) return;
    // Sibling: resolve fn alias → src, fetch defaults, restamp fn back to
    // the alias. Same path createCallNode + insertImportUse follow.
    const imp = imports.find((i) => i.name === call.fn);
    const fetched = imp ? await callWithDefaults(imp.src) : await callWithDefaults(call.fn);
    // `fetched` is either a bare TreeNode (network failure path) or the
    // rich {node, paramKeys, specs} envelope. Unwrap to the Call node +
    // capture paramKeys so the sibling emits in object form. Args stay
    // as the child's DEFAULT LITERALS — same rule as buildLiftedCall:
    // assembly knobs are user-decided, not auto-wired on wrap.
    const fNode: TreeNode = ('node' in (fetched as any))
      ? (fetched as any).node
      : (fetched as TreeNode);
    const fParamKeys: string[] | undefined = ('node' in (fetched as any))
      ? (fetched as any).paramKeys
      : undefined;
    const sibling: TreeNode = (fNode.type === 'call' && fParamKeys && fParamKeys.length)
      ? { ...fNode, fn: call.fn, paramKeys: fParamKeys }
      : (fNode.type === 'call' ? { ...fNode, fn: call.fn } : fNode);
    const wrapped: TreeNode = {
      type: 'method',
      id: newNodeId(),
      op,
      obj: call,
      arg: sibling,
    };
    commit(imports, replaceNode(composition, call.id, wrapped));
    expanded[wrapped.id] = true;
    if (sibling.type === 'call') expanded[sibling.id] = true;
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
  // Bottom-toolbar 'Transform' / 'Method' mini-pickers for a Call row.
  let callActionPopup = $state<{ nodeId: string; x: number; y: number; kind: 'transform' | 'method' } | null>(null);
  function openCallActionPopup(ev: MouseEvent, nodeId: string, kind: 'transform' | 'method') {
    if (!canEdit) return;
    // Toggle: clicking the same button while it's already open closes it.
    // Matches the accordion-style open/close behaviour the rest of the
    // editor uses (file rows, gear icons, etc.) — uniform "click to
    // toggle" feel instead of "click to open, click outside to close".
    if (callActionPopup && callActionPopup.nodeId === nodeId && callActionPopup.kind === kind) {
      callActionPopup = null;
      return;
    }
    const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    callActionPopup = { nodeId, x: rect.left, y: rect.bottom + 4, kind };
  }
  function closeCallActionPopup() { callActionPopup = null; }
  let callActionPopupNode = $derived(
    callActionPopup && composition ? findById(composition, callActionPopup.nodeId) : null
  );

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

  // ─── ƒ function / expression editor popup ────────────────────────────
  // The prop-cell input is wide enough for short literals (`4.5`, `p.od`)
  // but cramped for longer expressions (`p.od/2 - p.wall`,
  // `Math.PI * p.od`). The ƒ chip beside each cell opens a FloatingPanel
  // with a wider input + clickable chips for assembly param refs (`p.x`)
  // and common operators / Math constants. Apply commits via
  // commitCallArg → same path as the inline input.
  let fxEdit = $state<{ callId: string; argIdx: number; raw: string; px: number; py: number } | null>(null);
  // Assembly's own meta.params keys — drives the `p.<name>` chip list.
  // Updates reactively as the user adds / removes assembly params.
  let assemblyParamKeys = $derived<string[]>(paramKeysOf(source));
  // Wired vs unwired: a meta.params key is "wired" when something in the
  // composition tree references `p.<key>` (in any Call arg literal or
  // mv/rot triplet). An UNWIRED key is a knob that does NOTHING when
  // dialed — the classic silent bug the user hit on e_tube.length. The
  // chip below surfaces those + offers an Auto-wire shortcut that walks
  // every Call and swaps a matching-paramKey LITERAL DEFAULT for `p.<key>`.
  // (Until the K.67 graph promotion lands, this is a hand-rolled
  // string-substitution diff; matches what the user would do via the ƒ
  // popup but in one click.)
  let wiredParamRefs = $derived<Set<string>>(() => {
    const out = new Set<string>();
    if (!composition) return out;
    const RE = /\bp\.(\w+)/g;
    walkTree(composition, (n) => {
      const visit = (lit: TreeNode | undefined) => {
        if (!lit || lit.type !== 'literal') return;
        const v = lit.value || '';
        let m: RegExpExecArray | null;
        RE.lastIndex = 0;
        while ((m = RE.exec(v)) !== null) out.add(m[1]!);
      };
      if (n.type === 'call') {
        for (const a of n.args) visit(a);
        if (n.mv) for (const a of n.mv) visit(a);
        if (n.rot) for (const a of n.rot) visit(a);
      } else if (n.type === 'mv') {
        for (const a of n.offset) visit(a);
      } else if (n.type === 'rot') {
        for (const a of n.rot) visit(a);
      } else if (n.type === 'literal') {
        visit(n);
      }
    });
    return out;
  }) as unknown as Set<string>;
  let unwiredParams = $derived<string[]>(
    assemblyParamKeys.filter((k) => !(wiredParamRefs as Set<string>).has(k))
  );

  /** Walk every Call and replace LITERAL DEFAULT arg slots whose
   *  paramKey matches one of the assembly's meta.params keys with a
   *  `p.<key>` reference. Idempotent — slots already containing a
   *  `p.<...>` expression are left alone. Mirrors what the user
   *  would do through the ƒ popup on each slot, in one click. */
  function autoWireUnwired() {
    if (!canEdit || !composition) return;
    const wantWired = new Set(unwiredParams);
    if (wantWired.size === 0) return;
    let nextRoot: TreeNode = composition;
    walkTree(composition, (n) => {
      if (n.type !== 'call' || !n.paramKeys) return;
      for (let i = 0; i < n.args.length; i++) {
        const k = n.paramKeys[i];
        if (!k || !wantWired.has(k)) continue;
        const a = n.args[i];
        if (!a || a.type !== 'literal') continue;
        // Skip slots already carrying a `p.X` expression.
        if (/\bp\.\w+/.test(a.value)) continue;
        const newLit: TreeNode = { ...a, value: `p.${k}` };
        nextRoot = replaceNode(nextRoot, a.id, newLit);
      }
    });
    if (nextRoot !== composition) commit(imports, nextRoot);
  }
  function openFx(call: TreeNode & { type: 'call' }, argIdx: number, ev: MouseEvent) {
    if (!canEdit) return;
    const arg = call.args[argIdx];
    if (!arg) return;
    const raw = arg.type === 'literal' ? arg.value : emitNode(arg);
    const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    fxEdit = {
      callId: call.id, argIdx, raw,
      // Clamp into viewport so a deep-nested chip's popup doesn't fall off-screen.
      px: Math.min(rect.left, window.innerWidth - 320),
      py: Math.min(rect.bottom + 4, window.innerHeight - 260),
    };
  }
  function closeFx() { fxEdit = null; }
  function fxAppend(token: string) {
    if (!fxEdit) return;
    // Append with a sensible separator: bare names / numbers get a space;
    // operators slot in directly. Mirrors PrimitiveView's openFx pattern.
    const cur = fxEdit.raw;
    const sep = cur && !cur.endsWith(' ') && !/[+\-*/(]\s*$/.test(cur) && !/^[+\-*/)]/.test(token) ? ' ' : '';
    fxEdit = { ...fxEdit, raw: cur + sep + token };
  }
  function applyFx() {
    if (!fxEdit || !composition) return;
    const call = findById(composition, fxEdit.callId);
    if (!call || call.type !== 'call') { fxEdit = null; return; }
    commitCallArg(call, fxEdit.argIdx, fxEdit.raw.trim());
    fxEdit = null;
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

  // Exclusive-accordion for FILE (Call) rows — only one body open at a
  // time, except 📌-pinned rows stay open alongside. Mirrors
  // PrimitiveView's pinnedParts model so the inspector feel is uniform.
  let activeCall = $state<string | null>(null);
  let pinnedCalls = $state<Set<string>>(new Set());
  function isCallOpen(id: string): boolean {
    return pinnedCalls.has(id) || activeCall === id;
  }
  function toggleCallOpen(id: string) {
    if (pinnedCalls.has(id)) return; // unpin first to close
    activeCall = activeCall === id ? null : id;
  }
  function togglePinCall(id: string) {
    const next = new Set(pinnedCalls);
    if (next.has(id)) { next.delete(id); if (activeCall === id) activeCall = null; }
    else { next.add(id); if (activeCall === id) activeCall = null; }
    pinnedCalls = next;
  }

  // Top-level accordion sections (Imports + Composition). Both default
  // open. The 📌 pin is informational here — these don't auto-collapse
  // when other rows open. Carried for visual consistency with the rest
  // of the inspector.
  let importsOpen = $state(true);
  let importsPinned = $state(false);
  let compositionOpen = $state(true);
  let compositionPinned = $state(false);
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

<!-- Trash glyph snippet — same outlined SVG as the sidebar prim-trash
     button. Reused everywhere we used to render "×" for delete/remove. -->
{#snippet trashGlyph()}
  <svg class="ce-trash-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m5 5v6m4-6v6"/>
  </svg>
{/snippet}

<div class="ce-root">
  <!-- ─── Unwired-param alert (tactical fix; K.67 graph promotion will
       make this impossible by construction) — surfaces meta.params keys
       that no Call slot reads. Dialing them silently does nothing today;
       Auto-wire substitutes `p.<key>` into every matching unwired slot
       in one click. -->
  {#if unwiredParams.length > 0}
    <div class="ce-unwired-chip" role="status">
      <span class="ce-unwired-icon">⚠</span>
      <span class="ce-unwired-msg">
        {unwiredParams.length === 1 ? 'Param' : 'Params'}
        {#each unwiredParams as k, i (k)}<code class="ce-unwired-key">{k}</code>{#if i < unwiredParams.length - 1}, {/if}{/each}
        not wired — dialing does nothing.
      </span>
      {#if canEdit}
        <button class="ce-unwired-fix" type="button"
          title="Substitute `p.<key>` into every matching unwired Call slot"
          onclick={autoWireUnwired}>Auto-wire</button>
      {/if}
    </div>
  {/if}

  <!-- ─── Imports ──────────────────────────────────────────────────── -->
  <section class="ce-section ce-imports" class:collapsed={!importsOpen}>
    <header class="ce-section-head"
      role="button" tabindex="0"
      aria-expanded={importsOpen}
      onclick={() => (importsOpen = !importsOpen)}
      onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); importsOpen = !importsOpen; } }}>
      <button class="ce-pin" class:pinned={importsPinned} type="button"
        title={importsPinned ? 'Unpin' : 'Pin open (visual cue)'}
        onclick={(e) => { e.stopPropagation(); importsPinned = !importsPinned; if (importsPinned) importsOpen = true; }}>📌</button>
      <span class="ce-section-twist">{importsOpen ? '▾' : '▸'}</span>
      <span class="ce-section-title">📥 Imports</span>
      <span class="ce-section-count">{uniqueImports.length}</span>
      {#if canEdit}
        <button class="ce-add-btn" type="button" title="Add import" onclick={(e) => { e.stopPropagation(); openImportPopup(e); }}>+ Import</button>
      {/if}
    </header>
    {#if importsOpen}
    {#if uniqueImports.length === 0}
      <div class="ce-empty">
        {canEdit ? 'No imports. Click + Import to add a primitive.' : 'No imports.'}
      </div>
    {:else}
      <div class="ce-imports-list">
        {#each uniqueImports as imp (imp.src)}
          {@const hasInstances = hasInstancesOf(imp.src)}
          <div class="ce-import-row">
            {#if canEdit}
              <button class="ce-imp-add" type="button"
                title={`Drop a new instance of ${imp.src} into the composition (gets a fresh letter alias)`}
                aria-label={`Add ${imp.src} instance to composition`}
                onclick={() => insertImportUse(imp)}>+</button>
            {/if}
            <div class="ce-imp-pill" title={imp.src}>
              <span class="ce-imp-src">{imp.src}</span>
            </div>
            {#if canEdit}
              <button class="ce-imp-del" type="button"
                title={hasInstances ? `Remove all instances from the composition before removing ${imp.src} from imports` : `Remove ${imp.src} from imports`}
                aria-label={`Remove import ${imp.src}`}
                disabled={hasInstances}
                onclick={() => removeImportSrc(imp.src)}>{@render trashGlyph()}</button>
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
      callWithDefaults(dropped).then((f) => insertCallIntoComposition(('node' in (f as any)) ? (f as any).node : (f as TreeNode)));
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
      <button class="ce-pin" class:pinned={compositionPinned} type="button"
        title={compositionPinned ? 'Unpin' : 'Pin open (visual cue)'}
        onclick={(e) => { e.stopPropagation(); compositionPinned = !compositionPinned; if (compositionPinned) compositionOpen = true; }}>📌</button>
      <span class="ce-twist">{compositionOpen ? '▾' : '▸'}</span>
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
        <!-- Root list/stack — header IS the list row; children render at
             depth 1 so the parent→child relationship reads visually. -->
        <div class="ce-tree">
          {#if composition.children.length === 0}
            <div class="ce-row ce-empty-row" style="--depth: 1">
              <span class="ce-empty-hint">empty — drag an import or click + file / + compose</span>
            </div>
          {:else}
            {#each composition.children as child (child.id)}
              {@render row(child, 1)}
            {/each}
          {/if}
        </div>
      {:else}
        <!-- Root is a single non-folder node — render it at depth 1 so it
             still reads as a child of the compose header. -->
        <div class="ce-tree">
          {@render row(composition, 1)}
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
      <button class="ce-row-btn ce-row-x" type="button" title="Delete" onclick={() => deleteN(n.id)} aria-label="Delete">{@render trashGlyph()}</button>
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
        if (dropped) callWithDefaults(dropped).then((f) => appendChildToList(n.id, ('node' in (f as any)) ? (f as any).node : (f as TreeNode)));
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
  {@const callOpen = n.type === 'call' && isCallOpen(n.id)}
  {@const callExpandable = n.type === 'call'}
  <div class="ce-row ce-file-row" class:open={callOpen} style="--depth: {depth}"
    role={callExpandable ? 'button' : undefined}
    tabindex={callExpandable ? 0 : -1}
    onclick={callExpandable ? () => toggleCallOpen(n.id) : undefined}
    onkeydown={callExpandable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCallOpen(n.id); } } : undefined}>
    {#if callExpandable}
      <!-- 📌 pin only — the twist arrow was dropped because clicking the row
           itself toggles open/close (same UX as the rest of the editor). -->
      <button class="ce-pin" class:pinned={pinnedCalls.has(n.id)} type="button"
        title={pinnedCalls.has(n.id) ? 'Unpin (allow auto-collapse)' : 'Pin open (stays open while other rows open)'}
        onclick={(e) => { e.stopPropagation(); togglePinCall(n.id); }}>📌</button>
    {/if}
    {#if n.type === 'call'}
      {@const callSrc = imports.find((i) => i.name === n.fn)?.src}
      {@const pc = instanceColors(n.fn)}
      {#if canEdit}
        <!-- ⚙ Settings BEFORE the title — consolidates per-instance knobs
             (outer + inner colours today, room for rename / freeze later).
             Sits to the LEFT of the name so the title-bar reads
             pin · twist · ⚙ · name : src · status · trash. -->
        <button class="ce-gear" type="button"
          class:open={settingsPopup?.name === n.fn}
          title={`Settings — ${n.fn}`}
          onclick={(e) => openSettingsPopup(n.fn, e)}
          aria-label={`Settings for ${n.fn}`}>⚙</button>
      {/if}
      <span class="ce-file-title" title={fileTitle(n)}>
        {n.fn}{#if callSrc}<span class="ce-file-src">: {callSrc}</span>{/if}
      </span>
      <!-- mv/rot indicator dots — terse status, no triplet preview. The
           edit surface lives in the expanded body below. -->
      {#if n.mv}<span class="ce-tx-dot ce-tx-dot-mv" title="mv set">↦</span>{/if}
      {#if n.rot}<span class="ce-tx-dot ce-tx-dot-rot" title="rot set">↻</span>{/if}
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

    <span class="ce-row-spacer"></span>

    {#if canEdit}
      <button class="ce-row-btn ce-row-x" type="button" title="Delete" aria-label="Delete" onclick={(e) => { e.stopPropagation(); deleteN(n.id); }}>{@render trashGlyph()}</button>
    {/if}
  </div>

  <!-- Expanded body — properties grid + mv/rot editors + transform
       add-buttons. All transform editing surfaces moved into the
       collapsible body so the title stays compact. -->
  {#if n.type === 'call' && callOpen}
    {#if n.args.length > 0}
      <!-- Properties grid — Call's positional args, 2 per row. -->
      <div class="ce-props-grid" style="--depth: {depth}">
        {#each n.args as arg, i (arg.id)}
          <div class="ce-prop-cell">
            <span class="ce-prop-label">{labelForArg(n, i)}</span>
            <div class="ce-prop-value-wrap">
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
              <!-- ƒ chip — opens the popup for longer expressions (more
                   room than the inline input + clickable param refs +
                   operator shortcuts). Tinted blue when the slot already
                   carries a non-literal / multi-token expression. -->
              <button
                type="button"
                class="ce-fx-chip"
                class:hot={arg.type !== 'literal' || (arg.type === 'literal' && arg.value && (arg.value.length > 6 || /[a-zA-Z]/.test(arg.value)))}
                title="Edit as a function / expression (param names · Math.*)"
                disabled={!canEdit}
                onclick={(e) => openFx(n as any, i, e as MouseEvent)}
              >ƒ</button>
            </div>
          </div>
        {/each}
      </div>
    {/if}

    <!-- mv editor row + inline remove. Shown when n.mv is set. -->
    {#if n.mv}
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
        {#if canEdit}
          <button class="ce-row-btn ce-row-x" type="button" title="Remove mv" aria-label="Remove mv" onclick={() => toggleCallMv(n as any)}>{@render trashGlyph()}</button>
        {/if}
      </div>
    {/if}
    <!-- rot editor row + inline remove. Shown when n.rot is set. -->
    {#if n.rot}
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
        {#if canEdit}
          <button class="ce-row-btn ce-row-x" type="button" title="Remove rot" aria-label="Remove rot" onclick={() => toggleCallRot(n as any)}>{@render trashGlyph()}</button>
        {/if}
      </div>
    {/if}

    <!-- Action toolbar — two grouped buttons: Transform opens a
         mini-picker with mv / rot; Method opens a mini-picker with
         subtract / add / intersect. The popups commit immediately on
         pick; sits at the BOTTOM of the body. -->
    {#if canEdit}
      <div class="ce-tx-toolbar" style="--depth: {depth}">
        <button class="ce-row-btn ce-tx-add" type="button"
          class:open={callActionPopup?.nodeId === n.id && callActionPopup?.kind === 'transform'}
          title="Attach a transform (mv / rot) — click again to close"
          disabled={!!n.mv && !!n.rot}
          onclick={(ev) => openCallActionPopup(ev, n.id, 'transform')}>↦ Transform ▾</button>
        <button class="ce-row-btn ce-tx-add" type="button"
          class:open={callActionPopup?.nodeId === n.id && callActionPopup?.kind === 'method'}
          title="Wrap in a CSG method (subtract / add / intersect) — click again to close"
          onclick={(ev) => openCallActionPopup(ev, n.id, 'method')}>⊖ Method ▾</button>
      </div>
    {/if}
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

<!-- Call-row bottom-toolbar action picker — Transform (mv/rot) and
     Method (subtract/add/intersect). Closes on pick. -->
{#if callActionPopup && callActionPopupNode && callActionPopupNode.type === 'call'}
  <FloatingPanel
    title={callActionPopup.kind === 'transform' ? 'Attach transform' : 'Wrap in method'}
    subtitle={callActionPopup.kind === 'transform'
      ? 'Translate or rotate this part'
      : `${callActionPopupNode.fn}.op(${callActionPopupNode.fn})`}
    visible={true}
    x={callActionPopup.x}
    y={callActionPopup.y}
    width="200px"
    maxHeight="40vh"
    onClose={closeCallActionPopup}
  >
    <div class="ce-pop">
      <div class="ce-op-list">
        {#if callActionPopup.kind === 'transform'}
          {#if !callActionPopupNode.mv}
            <button class="ce-op-pick" type="button"
              onclick={() => { toggleCallMv(callActionPopupNode as any); closeCallActionPopup(); }}>↦ mv (translate)</button>
          {/if}
          {#if !callActionPopupNode.rot}
            <button class="ce-op-pick" type="button"
              onclick={() => { toggleCallRot(callActionPopupNode as any); closeCallActionPopup(); }}>↻ rot (rotate)</button>
          {/if}
          {#if callActionPopupNode.mv && callActionPopupNode.rot}
            <div class="ce-pop-empty">Both already attached. Remove one above to re-add.</div>
          {/if}
        {:else}
          <button class="ce-op-pick" type="button"
            onclick={() => { wrapCallInMethod(callActionPopupNode as any, 'subtract'); closeCallActionPopup(); }}>⊖ subtract — bore out / cut</button>
          <button class="ce-op-pick" type="button"
            onclick={() => { wrapCallInMethod(callActionPopupNode as any, 'add'); closeCallActionPopup(); }}>⊕ add — union</button>
          <button class="ce-op-pick" type="button"
            onclick={() => { wrapCallInMethod(callActionPopupNode as any, 'intersect'); closeCallActionPopup(); }}>⊗ intersect — common volume</button>
        {/if}
      </div>
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

<!-- Per-instance colour picker — outer (skin) and inner (cut) swatches
     for each Call row. Persists to meta.instanceColors on this assembly's
     source so the bake pipeline picks the colour up the same way it does
     for primitive composites. -->
<!-- Consolidated per-instance settings — one popup, ⚙ button opens it.
     Two clean colour chips (outer + inner) in a Tailwind-ish card. Each
     chip shows the current colour + a native picker on click. Tiny ⟲
     resets inner to grey. -->
{#if settingsPopup}
  {@const sname = settingsPopup.name}
  {@const spc = instanceColors(sname)}
  <FloatingPanel title={`Settings — ${sname}`} visible={true} x={settingsPopup.x} y={settingsPopup.y} width="220px" onClose={closeSettingsPopup}>
    <div class="ce-set-card">
      <!-- Both colour pickers on one row to conserve vertical space. The
           chip's background is the colour swatch; the hidden <input
           type="color"> overlays so click anywhere on the chip opens
           the OS picker. ⟲ resets inner to grey. -->
      <div class="ce-set-row">
        <label class="ce-set-chip" style="background:{spc.outer}"
          title={`Outer — ${spc.outer}. External skin of this instance.`}>
          <input type="color" value={spc.outer}
            oninput={(e) => setInstanceColor(sname, 'outer', (e.currentTarget as HTMLInputElement).value)} />
          <span class="ce-set-tag">Outer</span>
        </label>
        <label class="ce-set-chip" style="background:{spc.inner}"
          title={`Inner — ${spc.inner}. Shown where this instance is cut.`}>
          <input type="color" value={spc.inner}
            oninput={(e) => setInstanceColor(sname, 'inner', (e.currentTarget as HTMLInputElement).value)} />
          <span class="ce-set-tag">Inner</span>
        </label>
        <button type="button" class="ce-set-reset" title="Reset inner to grey (#888888)" onclick={() => setInstanceColor(sname, 'inner', '#888888')}>⟲</button>
      </div>
    </div>
  </FloatingPanel>
{/if}

{#if colorPopup}
  <FloatingPanel
    title={`${colorPopup.which === 'outer' ? 'Outer (skin)' : 'Inner (cut)'} — ${colorPopup.name}`}
    visible={true}
    x={colorPopup.x}
    y={colorPopup.y}
    width="208px"
    onClose={() => (colorPopup = null)}
  >
    <div style="display:flex; flex-direction:column; gap:8px; padding:4px;">
      <div style="display:grid; grid-template-columns:repeat(6,1fr); gap:5px;">
        {#each INSTANCE_PALETTE as c (c)}
          <button type="button" title={c} onclick={() => pickColor(c)}
            style="height:22px; border-radius:4px; border:1px solid #ccc; background:{c}; cursor:pointer;"
            aria-label={c}></button>
        {/each}
      </div>
      <label style="display:flex; align-items:center; gap:6px; font:11px Arial; color:#555;">
        custom
        <input type="color" oninput={(e) => pickColor((e.currentTarget as HTMLInputElement).value)}
          style="width:38px; height:24px; padding:0; border:1px solid #ccc; border-radius:4px; background:none; cursor:pointer;" />
      </label>
      {#if colorPopup.which === 'inner'}
        <button class="ce-btn" type="button" onclick={() => pickColor('#888888')}>Reset to grey</button>
      {/if}
      <p style="font:10px Arial; color:#888; margin:0;">
        {colorPopup.which === 'outer' ? 'External skin of this instance.' : 'Shown where this instance is cut (bore wall / cross-section).'}
      </p>
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

<!-- ƒ function / expression editor — wider input for long expressions
     + clickable assembly-param chips + common operator/Math shortcuts.
     Mirrors PrimitiveView's fxEdit popup so the inspector feel is uniform. -->
{#if fxEdit}
  <FloatingPanel title="ƒ function / expression" visible={true} x={fxEdit.px} y={fxEdit.py} width="320px" onClose={closeFx}>
    <div style="display:flex; flex-direction:column; gap:6px; padding:4px;">
      <input bind:value={fxEdit.raw} spellcheck="false" placeholder="e.g. p.od / 2 - p.wall"
        onkeydown={(e) => { if (e.key === 'Enter') applyFx(); }}
        style="font:11px ui-monospace, monospace; padding:4px 6px; border:1px solid #d4e1f5; border-radius:4px;" />
      {#if assemblyParamKeys.length}
        <div style="display:flex; flex-wrap:wrap; gap:4px; align-items:center;">
          <span style="font:10px Arial; color:#888;">link a param:</span>
          {#each assemblyParamKeys as pn (pn)}
            <button type="button" title={`insert p.${pn}`} onclick={() => fxAppend('p.' + pn)}
              style="font:10px ui-monospace,monospace; padding:1px 6px; border:1px solid #d4e1f5; border-radius:3px; background:#eef3fb; cursor:pointer;">p.{pn}</button>
          {/each}
        </div>
      {:else}
        <div style="font:10px Arial; color:#888;">No assembly params yet — add one in the Parameters panel, then link it here as <code>p.&lt;name&gt;</code>.</div>
      {/if}
      <div style="display:flex; flex-wrap:wrap; gap:4px;">
        {#each ['+', '-', '*', '/', '(', ')', 'Math.PI'] as t (t)}
          <button type="button" onclick={() => fxAppend(t)}
            style="font:10px ui-monospace,monospace; padding:1px 6px; border:1px solid #ddd; border-radius:3px; background:#fafafa; cursor:pointer;">{t}</button>
        {/each}
      </div>
      <div style="display:flex; justify-content:flex-end; gap:6px;">
        <button class="ce-btn" type="button" onclick={closeFx}>Cancel</button>
        <button class="ce-btn ce-btn-primary" type="button" onclick={applyFx}>Apply</button>
      </div>
      <p style="font:10px Arial; color:#888; margin:2px 0 0;">Param names + <code>Math.*</code> resolve at build. Enter to apply.</p>
    </div>
  </FloatingPanel>
{/if}

<style>
  .ce-root {
    display: flex; flex-direction: column; gap: 4px; padding: 2px 3px;
    font: 13px ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  /* Unwired-param alert chip — sits at the very top of the editor when
     meta.params has knobs that nothing in the composition reads. Yellow
     attention bar with an Auto-wire shortcut. */
  .ce-unwired-chip {
    display: flex; align-items: center; gap: 6px;
    padding: 4px 8px; margin: 0 0 2px 0;
    background: #fffbeb; border: 1px solid #fbbf24;
    border-radius: 4px;
    font: 11px ui-sans-serif, system-ui;
    color: #92400e;
  }
  .ce-unwired-icon { font-size: 13px; flex: 0 0 auto; }
  .ce-unwired-msg { flex: 1 1 auto; min-width: 0; line-height: 1.3; }
  .ce-unwired-key {
    font: 11px ui-monospace, SFMono-Regular, Menlo, monospace;
    background: rgba(146, 64, 14, 0.1); padding: 0 4px;
    border-radius: 3px; color: #92400e;
  }
  .ce-unwired-fix {
    flex: 0 0 auto;
    padding: 2px 8px; border: 1px solid #f59e0b;
    background: #fbbf24; color: #78350f; cursor: pointer;
    border-radius: 3px;
    font: 600 11px ui-sans-serif, system-ui;
  }
  .ce-unwired-fix:hover { background: #f59e0b; color: #fff; }
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

  /* 📌 pin — same affordance as PrimitiveView's pinnedParts model.
     Pinned rows tint amber to signal "stays open". */
  .ce-pin {
    background: transparent; border: none; cursor: pointer;
    width: 14px; height: 14px;
    opacity: 0.35;
    font-size: 10px; line-height: 1;
    padding: 0;
    margin-right: 6px;
    border-radius: 3px;
    flex: 0 0 auto;
  }
  .ce-pin:hover { opacity: 0.85; background: #f0e7d5; }
  .ce-pin.pinned { opacity: 1; background: #fbbf24; }
  .ce-pin.pinned:hover { background: #f59e0b; }

  /* Per-instance ⚙ Settings button — consolidates the outer/inner colour
     swatches (and future per-instance knobs). Conspicuous resting state
     with a SOLID outline so the user sees it; gear glyph is bumped a
     notch larger but the button frame stays compact via tighter
     padding. Engaged state mirrors .ce-tx-add.open. */
  .ce-gear {
    background: #fff; border: 1px solid #c4c4cc;
    cursor: pointer; padding: 0 2px;
    font: 15px ui-sans-serif, system-ui; line-height: 1;
    color: #666; border-radius: 3px;
    height: 18px; flex: 0 0 auto;
    display: inline-flex; align-items: center; justify-content: center;
    /* Breathing room between the chip and the alias text that follows. */
    margin-right: 6px;
  }
  .ce-gear:hover { color: #2266cc; background: #eef5ff; border-color: #2266cc; }
  .ce-gear.open { color: #2266cc; background: #eef5ff; border-color: #2266cc; }

  /* Per-instance Settings popup — single-row card with two colour
     chips. Each chip's background IS the swatch; the native <input
     type="color"> sits invisibly on top so clicking the chip anywhere
     opens the OS picker. Conservative on vertical space. */
  .ce-set-card { padding: 4px; }
  .ce-set-row {
    display: flex; align-items: stretch; gap: 6px;
  }
  .ce-set-chip {
    position: relative; flex: 1 1 0; min-width: 0;
    display: inline-flex; align-items: center; justify-content: center;
    height: 36px;
    border: 1px solid #d0d0d0; border-radius: 8px;
    box-shadow: 0 1px 2px rgba(0,0,0,0.06);
    cursor: pointer; overflow: hidden;
    transition: transform 0.05s ease, box-shadow 0.05s ease;
  }
  .ce-set-chip:hover { box-shadow: 0 2px 5px rgba(0,0,0,0.12); }
  .ce-set-chip:active { transform: translateY(1px); }
  .ce-set-chip input[type="color"] {
    position: absolute; inset: 0; opacity: 0; cursor: pointer;
    padding: 0; border: 0; background: none;
  }
  /* The Outer / Inner label sits on the swatch; subtle white tint with
     a dark text shadow so it stays readable on any background colour. */
  .ce-set-tag {
    font: 600 11px ui-sans-serif, system-ui;
    color: #fff;
    text-shadow: 0 1px 2px rgba(0,0,0,0.45);
    padding: 0 6px; pointer-events: none;
    background: rgba(0,0,0,0.18); border-radius: 4px;
  }
  .ce-set-reset {
    flex: 0 0 auto; width: 28px; height: 36px;
    border: 1px solid #d0d0d0; border-radius: 8px;
    background: #fafafa; cursor: pointer;
    font: 14px ui-sans-serif, system-ui; color: #888;
    transition: background 0.05s ease, color 0.05s ease;
  }
  .ce-set-reset:hover { background: #f0f0f0; color: #2266cc; }

  /* Open Call file row — subtle background tint so the user sees which
     row is the active inspector. */
  .ce-file-row.open { background: #eef5ff; }
  .ce-file-row[role="button"] { cursor: pointer; }

  /* Imports — 2-column compact grid. Each row is [+] [pill] [🗑] so the
     primary insert action lives on the LEFT (the user's natural read
     direction) and the destructive delete sits at the right edge. */
  .ce-imports { background: #eef5ff; border-color: #bcd3ee; }
  .ce-imports-list {
    display: grid;
    grid-template-columns: 1fr 1fr;
    column-gap: 6px;
    row-gap: 2px;
  }
  .ce-import-row {
    display: flex; align-items: center; gap: 4px;
    padding: 1px 2px;
    color: #1e3a8a; min-height: 22px; line-height: 1.4;
    min-width: 0;
  }
  /* Outlined alias=src pill — reads like a chip in a directory. */
  .ce-imp-pill {
    display: inline-flex; align-items: center; gap: 3px;
    border: 1px solid #bcd3ee;
    background: #fff;
    border-radius: 9px;
    padding: 1px 8px;
    font: 12px ui-monospace, SFMono-Regular, Menlo, monospace;
    flex: 1 1 auto; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .ce-imp-name { font-weight: 700; color: #0c2e6e; flex: 0 0 auto; }
  .ce-imp-eq { color: #5e88c3; flex: 0 0 auto; }
  .ce-imp-src {
    color: #1e3a8a; flex: 1 1 auto; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  /* Rounded + insert-into-composition button (LEFT of the pill). */
  .ce-imp-add {
    appearance: none; background: #eef5ff; border: 1px solid #b8d4f2;
    border-radius: 50%;
    width: 16px; height: 16px; padding: 0;
    font: 700 12px ui-sans-serif; color: #1e40af; cursor: pointer;
    line-height: 14px; text-align: center;
    flex: 0 0 auto;
  }
  .ce-imp-add:hover { background: #1e40af; color: #fff; border-color: #1e40af; }
  /* Trash button (RIGHT of the pill) — outlined SVG, grey idle → red on
     hover. Same visual language as the sidebar's prim-trash. */
  .ce-imp-del {
    background: transparent; border: none; cursor: pointer;
    color: #888;
    width: 18px; height: 18px; border-radius: 3px;
    padding: 0;
    display: inline-flex; align-items: center; justify-content: center;
    flex: 0 0 auto;
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

  /* One-line rows. The indent step (18px) is wide enough to read at a
     glance + light dotted guide line draws the parent → child arrow
     visually. */
  .ce-row {
    display: flex; align-items: center; gap: 2px;
    padding: 1px 4px;
    padding-left: calc(var(--depth, 0) * 18px + 0px);
    border-radius: 3px;
    min-height: 20px;
    line-height: 1.4;
    position: relative;
  }
  .ce-row[style*="--depth: 1"]::before,
  .ce-row[style*="--depth: 2"]::before,
  .ce-row[style*="--depth: 3"]::before,
  .ce-row[style*="--depth: 4"]::before,
  .ce-row[style*="--depth: 5"]::before {
    content: '';
    position: absolute;
    top: 0; bottom: 0;
    left: calc(var(--depth, 0) * 18px - 10px);
    width: 1px;
    background: #d4d4dc;
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
  /* `: shaft` tail — same colon-as-labeller as the import pill, lighter
     so the alias `A` reads as the primary identifier. */
  .ce-file-src { color: #5e88c3; font-weight: 400; margin-left: 4px; }

  /* Per-instance OUTER (skin) + INNER (cut) colour swatches. Outer is a
     square, inner a circle — mirrors PrimitiveView's pv-swatch shape so
     the visual language stays consistent across product surfaces. */
  .ce-swatch {
    flex: 0 0 auto;
    width: 12px; height: 12px;
    margin-left: 4px;
    padding: 0;
    border: 1px solid rgba(0, 0, 0, 0.35);
    border-radius: 3px;
    cursor: pointer;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.4);
  }
  .ce-swatch:hover { outline: 1px solid #4a78c0; outline-offset: 1px; }
  .ce-swatch-inner { margin-left: 2px; border-radius: 50%; }

  /* Reused for the inner-reset button inside the colour popup. */
  .ce-btn {
    background: #eef5ff; border: 1px solid #b8d4f2;
    border-radius: 4px;
    padding: 4px 10px;
    font: 600 11px ui-sans-serif, system-ui;
    color: #1e40af;
    cursor: pointer;
  }
  .ce-btn:hover { background: #ddeaff; border-color: #1e40af; }

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
  /* Trash button in tree rows + mv/rot remove. SVG-only, no border —
     keeps a quiet look until hover (red tint matches the sidebar's
     prim-trash). */
  .ce-row-btn.ce-row-x {
    color: #888;
    border: none; background: transparent;
    padding: 0;
    width: 20px; height: 20px;
    display: inline-flex; align-items: center; justify-content: center;
    opacity: 0.7;
  }
  .ce-row-btn.ce-row-x:hover { background: #fdecec; color: #cc2222; opacity: 1; }
  .ce-trash-svg { width: 12px; height: 12px; }
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

  /* Inline 3-input transform editor row — flat indent (matches .ce-props-grid). */
  .ce-tx-edit-row {
    background: #fffbeb;
    border-left: 2px solid #fbbf24;
    margin-left: 6px;
    padding-left: 8px;
  }
  .ce-tx-edit-label {
    font: 600 11px ui-monospace, SFMono-Regular, Menlo, monospace;
    color: #92400e;
    min-width: 28px;
  }
  .ce-axis-row {
    padding-left: 36px;
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
     Sits in the expanded body of a file (Call) row. Indentation is FLAT
     (no depth multiplier) so prop cells at every level of the composition
     line up vertically — same left edge regardless of how deeply the
     parent Call is nested. */
  .ce-props-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    column-gap: 6px;
    row-gap: 2px;
    padding: 2px 6px 4px 8px;
    background: #fafafa;
    border-left: 2px solid #d4d4dc;
    margin-left: 6px;
  }
  .ce-prop-cell {
    display: grid;
    grid-template-columns: minmax(48px, 1fr) minmax(60px, 1.4fr);
    align-items: center;
    column-gap: 4px;
    min-width: 0;
  }
  /* Value side of a prop cell wraps the input/value + the ƒ chip. Flex so
     the input takes whatever's left after the chip claims its 18px. */
  .ce-prop-value-wrap {
    display: flex; align-items: center; gap: 2px; min-width: 0;
  }
  .ce-prop-value-wrap > .ce-prop-input,
  .ce-prop-value-wrap > .ce-prop-val { flex: 1 1 auto; min-width: 0; }
  /* ƒ chip — tiny, sits to the right of the input. Tinted blue when the
     slot carries a non-trivial expression (long literal, ref, or call)
     so the user sees at a glance "this one's wired to something". */
  .ce-fx-chip {
    flex: 0 0 auto;
    background: transparent; border: 1px solid transparent;
    cursor: pointer; padding: 0 3px; font: 600 11px Arial;
    color: #bbb; border-radius: 3px; line-height: 1;
  }
  .ce-fx-chip:hover:not(:disabled) { color: #2266cc; background: #eef5ff; border-color: #d4e1f5; }
  .ce-fx-chip.hot { color: #2266cc; }
  .ce-fx-chip:disabled { cursor: default; opacity: 0.5; }
  /* Popup-shared button styles — Cancel + Apply on the fx popup. */
  .ce-btn {
    font: 11px ui-sans-serif, system-ui; padding: 2px 8px;
    border: 1px solid #d0d0d0; background: #fff; cursor: pointer;
    border-radius: 3px;
  }
  .ce-btn:hover { background: #f5f5f8; }
  .ce-btn-primary { background: #2266cc; color: #fff; border-color: #2266cc; }
  .ce-btn-primary:hover { background: #1a4ea0; border-color: #1a4ea0; }
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

  /* Title-row mv/rot indicator dots — terse "this Call has a transform
     set" cue. The actual editing surface lives in the expanded body. */
  .ce-tx-dot {
    font-size: 10px;
    padding: 0 3px;
    border-radius: 8px;
    line-height: 1;
  }
  .ce-tx-dot-mv  { color: #92400e; background: #fef3c7; }
  .ce-tx-dot-rot { color: #6b21a8; background: #f3e8ff; }

  /* Transform toolbar — sits at the BOTTOM of the expanded body,
     offers ↦ mv / ↻ rot add buttons when those slots are still empty.
     Flat indent so it lines up with the prop grid above. */
  .ce-tx-toolbar {
    display: flex; gap: 6px;
    padding: 2px 6px 4px 36px;
  }
  .ce-tx-add {
    font: 600 11px ui-sans-serif, system-ui;
    opacity: 0.9;
  }
  .ce-tx-add:hover { opacity: 1; }
  /* Active-state when its popup is open — same chip's caret reads as "engaged"
     so the user knows clicking again will close. */
  .ce-tx-add.open {
    background: #eef5ff; border-color: #bcd3ee; color: #2266cc; opacity: 1;
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
