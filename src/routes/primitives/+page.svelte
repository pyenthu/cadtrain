<script lang="ts">
  // Sidebar + tabbed-editor primitives browser, modeled on SVTC's tab system
  // (src/lib/components/SimpleTabs/SimpleTabs.svelte + src/lib/tabs/tabs.svelte.js).
  //
  //   sidebar (left)  — folder tree of primitives. Click a primitive → opens
  //                     a tab. Click "+" next to a folder → opens a "new
  //                     primitive" tab seeded from that folder's first member.
  //   tab bar (top)   — one button per open tab; click selects, × closes.
  //   tab body        — left toolbar (per-tab actions) + param editor + a
  //                     thumbnail preview of the current parameter set.
  //
  // The cards grid is gone; navigation is sidebar-driven and editing happens
  // in the tab body. No card click ever navigates off the route — the
  // toolbar's "Open in Author" is the explicit handoff.
  //
  // 4-level hierarchy backing this: primitive → composition → component →
  // assembly (~/.claude/plans/silly-conjuring-deer.md). Compounds appear in
  // the sidebar with a dashed-border affordance; they are stand-ins until
  // Phase B decomposes them into real atoms.
  import { Canvas } from '@threlte/core';
  import { WebGLRenderer } from 'three';
  import { onMount } from 'svelte';
  import { COMPONENTS, type ComponentDef } from '$lib/components/library';
  import { initManifold } from '$lib/components/builder';
  import { buildAuthored } from '$lib/authoring/compose';
  import { emptyAuthoredComponent, type AuthoredComponent } from '$lib/authoring/schema';
  import FloatingPanel from '$lib/shared/FloatingPanel.svelte';
  import KbTableViewer from '$lib/shared/KbTableViewer.svelte';
  import CodeEditor from '$lib/shared/CodeEditor.svelte';
  import MarkdownView from '$lib/shared/MarkdownView.svelte';
  import { COMPONENTS_L3, type ComponentL3 } from '$lib/components/components-l3';
  import { ASSEMBLIES_L4, type AssemblyL4 } from '$lib/components/assemblies-l4';
  import { generateTubingComponent, type TubingInputs, type Grade, type ConnectionType } from '$lib/components/rules/tubing';
  // Vite ?raw — bundles the file's text at build time so the client can show
  // the script that produces each primitive's geometry in-tab.
  import builderSource from '$lib/components/builder.ts?raw';
  // NEW declarative pipeline — runes-class specs that compile to the same
  // imperative ManifoldCAD source as builder.ts. Lives in the XML Primitive
  // tab; kept separate from the legacy primitives until the swap is trusted.
  import { loadRunesRegistry, defaultsFor, type RunesEntry, type DerivedSchema, type ParamSchema } from '$lib/components/runes';
  import { discoverHelpers } from '$lib/components/manifold-helpers-meta';

  function createRenderer(canvas: HTMLCanvasElement) {
    return new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  }

  /** Extract the body of a named builder function from builder.ts source.
   *  Matches `<id>(p) {` then reads through balanced braces. Returns the
   *  full `<id>(p) { … }` block as a string, or null if not present. */
  function extractBuilder(src: string, id: string): string | null {
    const re = new RegExp(`\\n\\s{2}${id}\\(p\\)\\s*\\{`);
    const m = re.exec(src);
    if (!m) return null;
    let i = m.index + m[0].length;          // just past the opening `{`
    let depth = 1;
    while (i < src.length && depth > 0) {
      const ch = src[i];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      i++;
    }
    if (depth !== 0) return null;
    // Re-include the signature for context.
    return src.slice(m.index + 1, i).replace(/^\s{2}/, '');
  }

  interface Folder {
    id: string;
    name: string;
    /** Predicate run against COMPONENTS items to claim leaves into this folder. */
    match: (c: { id: string; category: string }) => boolean;
    sub?: Folder[];
    /** Compounds are small assemblies, not true primitive atoms. Renders a
     *  dashed border on sidebar items + a compound badge in the tab. */
    compound?: boolean;
  }

  // Four sidebar tabs mirror the 4-level hierarchy + a 5th for KB browsing:
  //   Primitives    - level 1: atomic geometric shapes (+ derived variants
  //                   indented under their parent as 📁 folders).
  //   Compositions  - level 2: small named assemblies of primitives
  //                   ("compounds" — temporary stand-ins until Phase B).
  //   Components    - level 3: complete physical items (tubing joint,
  //                   pup joint, packer). Placeholder for the in-situ
  //                   authoring surface that replaced /author.
  //   Assemblies    - level 4: multi-component products (full strings,
  //                   BHAs). Deferred; placeholder.
  //   KB            - reference tables, driven by /kb/index.json. Not
  //                   part of the geometric hierarchy but lives here for
  //                   one-stop-shop access.
  const TREE: Folder[] = [
    // XML Primitive — the NEW declarative pipeline. Pinned to the top of
    // the rail so it's immediately reachable while the legacy primitives
    // are migrated. Doesn't claim COMPONENTS entries; the sidebar renders
    // a runes-class list under this tab.
    {
      id: 'xml_primitive',
      name: 'XML Primitive',
      match: () => false,
    },
    {
      id: 'primitives',
      name: 'Primitives',
      match: (c) => [
        'hollow_cylinder', 'taper', 'shoulder',
        'grooved_cylinder', 'slotted_cylinder', 'seal_bore',
        'threaded_box', 'threaded_pin',
        'threaded_pin_collared',
        'slips', 'j_latch', 'packer_element',
        // Catalog-inspired (Halliburton Intelligent Completions + Multilateral)
        'window_cutout', 'whipstock', 'sliding_sleeve',
        // Drill pipe
        'drill_pipe_tool_joint',
      ].includes(c.id),
    },
    {
      id: 'compositions',
      name: 'Compositions',
      compound: true,
      match: (c) => c.category === 'connection',
      sub: [
        { id: 'api_tubular',  name: 'API tubular',  compound: true, match: (c) => ['thread_eue', 'thread_ltc'].includes(c.id) },
        { id: 'drill_string', name: 'Drill string', compound: true, match: (c) => ['thread_if', 'thread_fh', 'thread_nc'].includes(c.id) },
      ],
    },
    {
      id: 'components',
      name: 'Components',
      match: () => false, // populated later — placeholder for level 3.
    },
    {
      id: 'assemblies',
      name: 'Assemblies',
      match: () => false, // deferred — placeholder for level 4.
    },
    // KB tab — special: doesn't claim COMPONENTS entries. The sidebar
    // renders a separate KB list under this tab (driven by /kb/index.json)
    // and clicking a KB opens it as a 'kb'-kind main tab.
    {
      id: 'kb',
      name: 'KB',
      match: () => false,
    },
  ];

  function itemsInFolder(folder: Folder): typeof COMPONENTS {
    // Direct matches via the folder's predicate.
    const direct = COMPONENTS.filter((c) => folder.match(c));
    // Derived children of any directly-matched parent are also IN the
    // folder — a parent in Primitives means its specializations live
    // there too. This lets the sidebar render the "folder" treatment
    // without each variant having to be listed by id.
    const directIds = new Set(direct.map((c) => c.id));
    const inherited = COMPONENTS.filter((c) => c.parent && directIds.has(c.parent) && !directIds.has(c.id));
    return [...direct, ...inherited];
  }

  function isCompound(c: { id: string; category: string }): boolean {
    function walk(tree: Folder[]): boolean {
      for (const f of tree) {
        if (f.compound && f.match(c)) return true;
        if (f.sub && walk(f.sub)) return true;
      }
      return false;
    }
    return walk(TREE);
  }

  const PIPE_PRIMS = new Set(['hollow_cylinder', 'thread_eue', 'thread_ltc']);

  // Library ids don't match the on-disk `prim_*` directories one-to-one
  // (e.g. `thread_eue` → `prim_eue_external_upset_end`). This table maps a
  // primitive id to its training_data dir so the preview <img> resolves.
  const IMG_DIR: Record<string, string> = {
    hollow_cylinder: 'prim_hollow_cylinder',
    threaded_box:    'prim_threaded_box_female',
    threaded_pin:    'prim_threaded_pin_male',
    thread_if:       'prim_if_internal_flush',
    thread_fh:       'prim_fh_full_hole',
    thread_nc:       'prim_nc_numbered_connection',
    thread_eue:      'prim_eue_external_upset_end',
    thread_ltc:      'prim_ltc_long_thread_coupled',
    taper:           'prim_taper_cone',
    shoulder:        'prim_shoulder_step',
    slotted_cylinder: 'prim_slotted_cylinder',
    seal_bore:       'prim_seal_bore_polished',
    grooved_cylinder: 'prim_grooved_cylinder',
    slips:           'prim_slip_assembly',
    j_latch:         'prim_j-latch_profile',
    packer_element:  'prim_packer_element',
  };
  function imgSrc(primId: string): string {
    // Walk parent chain so derived primitives (box_stc → threaded_box) fall
    // back to their parent's image when they don't ship one of their own.
    let cur = COMPONENTS.find((c) => c.id === primId);
    while (cur && !IMG_DIR[cur.id] && cur.parent) {
      cur = COMPONENTS.find((c) => c.id === cur!.parent);
    }
    const id = cur?.id ?? primId;
    return `/training_data/${IMG_DIR[id] ?? `prim_${id}`}/images/default.png`;
  }

  // ── Tab model ────────────────────────────────────────────────────────────
  // Tabs live in-memory only — closing them discards local param edits, the
  // way SVTC's "ephemeral" tabs work. Persistence happens through "Open in
  // Author" which seeds an AuthoredComponent.
  interface Tab {
    /** Unique tab key. For an existing primitive, this is the primitive id;
     *  for a "new from <folder>" draft tab, it is `new:<folder>:<nonce>`;
     *  for a KB tab, it is `kb:<kbId>`; for level-3/4 composite tabs it is
     *  `comp:<id>` or `asm:<id>`. */
    id: string;
    /** What kind of content this tab hosts. Drives the tab-body render
     *  (primitive → live 3D scene + params popup; kb → table viewer;
     *  composite → multi-part geometry from a baked AuthoredComponent spec
     *  with no param editing; xml-primitive → runes-class viewer that
     *  shows the compiled imperative ManifoldCAD source). */
    kind: 'primitive' | 'kb' | 'composite' | 'xml-primitive';
    /** Baked AuthoredComponent spec for composite (level 3 / 4) tabs. */
    compositeSpec?: import('$lib/authoring/schema').AuthoredComponent;
    /** Runes-class entry (only set when kind === 'xml-primitive'). */
    runesEntry?: RunesEntry;
    /** In-memory edit buffer for the runes-class .ts source shown in the
     *  Script popup → Svelte tab. Initialized from runesEntry.source on
     *  open; mutated on every keystroke via CodeEditor.onChange. Cleared
     *  on save. Null = unedited (editor renders runesEntry.source). */
    sourceDraft?: string | null;
    /** Save status for the Svelte source editor. UI-only feedback. */
    saveStatus?: 'idle' | 'saving' | 'saved' | 'error';
    /** Last save error message (when saveStatus === 'error'). */
    saveError?: string;
    /** Inline "add parameter" form state. Per-tab so opening the form on
     *  one tab doesn't bleed into another, and switching tabs preserves
     *  the half-filled draft. */
    paramForm?: {
      open: boolean;
      name: string;
      type: 'numeric' | 'shape' | 'thread' | 'custom';
      unit: string;
      defaultValue: string;
      min: string;
      max: string;
      step: string;
      label: string;
      error: string;
    };
    /** Underlying primitive definition id (only set when kind === 'primitive'). */
    primId: string;
    /** KB id (only set when kind === 'kb'). */
    kbId?: string;
    /** Display label in the tab bar. */
    label: string;
    /** Local working copy of params; sliders/inputs bind here. */
    params: Record<string, number>;
    /** True iff this tab was opened from "+" — surfaces a "Save as new primitive"
     *  affordance instead of the standard "Open in Author". */
    draft: boolean;
    /** Per-tab "draft variables" surfaced at the top of the Script popup as
     *  `const <name> = <expr>;` lines. Editable here so the user can sketch
     *  intermediate values for a future primitive; not yet wired into the
     *  geometry pipeline (the project disallows dynamic eval). */
    vars: { name: string; expr: string }[];
  }

  let openTabs = $state<Tab[]>([]);
  let activeTabId = $state<string | null>(null);
  /** Which top-level group the sidebar is showing. Replaces the previous
   *  collapsible folder tree — now a tab strip across the top of the
   *  sidebar with a flat primitive list beneath. Defaults to XML Primitive
   *  (the new declarative pipeline) so it's the entry point on first load. */
  let sidebarTab = $state<string>('xml_primitive');
  /** Free-text filter for the active tab's primitive list. Matches against
   *  name, id, and tag list — case-insensitive substring. Persists across
   *  sidebar-tab switches so a "thread" search remains as you bounce
   *  between Primitives ↔ Compounds. */
  let filter = $state('');
  /** Expand state for parents with derived children (e.g. threaded_box →
   *  EUE). Sidebar lists collapse children by default; clicking a parent's
   *  chevron toggles its membership in this set. */
  let parentExpanded = $state<Set<string>>(new Set(['threaded_box']));
  function toggleParent(id: string, ev?: MouseEvent) {
    ev?.stopPropagation();
    const next = new Set(parentExpanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    parentExpanded = next;
  }
  /** Index of children per parent id, built from the library's `parent` field. */
  const CHILDREN_BY_PARENT: Record<string, ComponentDef[]> = (() => {
    const out: Record<string, ComponentDef[]> = {};
    for (const c of COMPONENTS) {
      if (c.parent) (out[c.parent] ??= []).push(c);
    }
    return out;
  })();
  let nonce = 0;

  /** Does this ComponentDef match the current filter? Compares against the
   *  name, id, and joined tag list. Empty filter matches everything. */
  function matchesFilter(c: ComponentDef): boolean {
    const q = filter.trim().toLowerCase();
    if (!q) return true;
    if (c.name.toLowerCase().includes(q)) return true;
    if (c.id.toLowerCase().includes(q)) return true;
    if (c.tags.some((t) => t.toLowerCase().includes(q))) return true;
    return false;
  }

  // Hover callout — shows a rich tooltip (thumbnail + name + description +
  // tags + badge) anchored to the right of the hovered sidebar item. This
  // replaces the old cards grid; the same information surfaces on demand
  // when the cursor lingers over a primitive in the sidebar list.
  let hoveredId = $state<string | null>(null);
  let hoverTop = $state(0);
  function onHoverItem(id: string, ev: MouseEvent) {
    hoveredId = id;
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    hoverTop = r.top;
  }
  function onLeaveItem() { hoveredId = null; }
  let hoveredDef = $derived<ComponentDef | null>(
    hoveredId ? COMPONENTS.find((c) => c.id === hoveredId) ?? null : null,
  );

  /** Flat ordered list of primitive ids currently visible in the sidebar
   *  (active tab only, in render order — leaves first, then sub-group
   *  members). Drives arrow-key cursor navigation. */
  /** Visible children of a parent within a given scope. Used to flatten the
   *  parent → children walk into the cursor-navigation id list. Children
   *  only contribute when their parent is expanded AND they pass the filter. */
  function visibleChildren(parent: ComponentDef, scope: ComponentDef[]): ComponentDef[] {
    if (!parentExpanded.has(parent.id)) return [];
    const kids = CHILDREN_BY_PARENT[parent.id] ?? [];
    return kids.filter((k) => scope.includes(k) && matchesFilter(k));
  }
  /** True iff `c` should render as a top-level entry rather than nested
   *  under its parent in the given scope. A child whose parent is also
   *  in the scope renders only under that parent. */
  function isTopLevel(c: ComponentDef, scope: ComponentDef[]): boolean {
    return !c.parent || !scope.some((x) => x.id === c.parent);
  }

  let sidebarIds = $derived.by(() => {
    const folder = TREE.find((f) => f.id === sidebarTab);
    if (!folder) return [] as string[];
    const items = itemsInFolder(folder).filter(matchesFilter);
    const subClaims = (folder.sub ?? []).flatMap((sf) => itemsInFolder(sf));
    const leaves = items.filter((c) => !subClaims.includes(c) && isTopLevel(c, items));
    const subItems = (folder.sub ?? []).flatMap((sf) => itemsInFolder(sf).filter(matchesFilter));
    const subLeaves = subItems.filter((c) => isTopLevel(c, subItems));
    const ids: string[] = [];
    for (const c of leaves) {
      ids.push(c.id);
      for (const kid of visibleChildren(c, items)) ids.push(kid.id);
    }
    for (const c of subLeaves) {
      ids.push(c.id);
      for (const kid of visibleChildren(c, subItems)) ids.push(kid.id);
    }
    return ids;
  });
  let cursorIdx = $state(0);
  // Reset cursor whenever the active sidebar tab changes so the cursor
  // doesn't land past the end of the new tab's flat list.
  $effect(() => { sidebarTab; filter; cursorIdx = 0; });
  function onSidebarKey(e: KeyboardEvent) {
    if (sidebarIds.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      cursorIdx = (cursorIdx + 1) % sidebarIds.length;
      focusCursor();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      cursorIdx = (cursorIdx - 1 + sidebarIds.length) % sidebarIds.length;
      focusCursor();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const id = sidebarIds[cursorIdx];
      if (id) openPrim(id);
    }
  }
  function focusCursor() {
    const id = sidebarIds[cursorIdx];
    if (!id) return;
    // Defer one frame so the focus lands after Svelte applies the update.
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-prim-id="${id}"]`) as HTMLElement | null;
      el?.focus();
    });
  }

  function openPrim(id: string) {
    const def = COMPONENTS.find((c) => c.id === id);
    if (!def) return;
    if (openTabs.find((t) => t.id === id)) {
      activeTabId = id;
      return;
    }
    openTabs = [
      ...openTabs,
      { id, kind: 'primitive', primId: id, label: def.name, params: structuredClone(def.defaults), draft: false, vars: [] },
    ];
    activeTabId = id;
  }

  // ── KB tab handling ──────────────────────────────────────────────────────
  interface KbEntry {
    id: string;
    title: string;
    description: string;
    row_count: number;
    source_kind?: string;
    categories?: string[];
  }
  let kbList = $state<KbEntry[]>([]);
  let kbListError = $state<string | null>(null);
  onMount(async () => {
    try {
      const r = await fetch('/kb/index.json', { cache: 'no-cache' });
      if (!r.ok) throw new Error(`${r.status}`);
      const data = await r.json();
      kbList = (data.kbs ?? []).map((k: any) => ({
        id: k.id, title: k.title, description: k.description, row_count: k.row_count,
        source_kind: k.source_kind, categories: k.categories ?? [],
      }));
    } catch (e: any) {
      kbListError = e?.message ?? String(e);
    }
  });
  // KB-specific hover state — shows a card-style callout (title /
  // description / row count / source kind / categories) to the right of
  // the sidebar when a KB row is hovered, matching the primitive callout.
  let hoveredKbId = $state<string | null>(null);
  let hoverKbTop = $state(0);
  function onHoverKb(id: string, ev: MouseEvent) {
    hoveredKbId = id;
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    hoverKbTop = r.top;
  }
  function onLeaveKb() { hoveredKbId = null; }
  let hoveredKb = $derived<KbEntry | null>(hoveredKbId ? kbList.find((k) => k.id === hoveredKbId) ?? null : null);
  function openKb(kb: KbEntry) {
    const id = `kb:${kb.id}`;
    if (openTabs.find((t) => t.id === id)) {
      activeTabId = id;
      return;
    }
    openTabs = [
      ...openTabs,
      { id, kind: 'kb', primId: '', kbId: kb.id, label: kb.title, params: {}, draft: false, vars: [] },
    ];
    activeTabId = id;
  }

  /** Generate a tubing composite from a casing-tubing KB row + open it as
   *  a tab. Inputs come straight off the row; the rules in
   *  src/lib/components/rules/tubing.ts handle KB lookup + geometry build.
   *  Only TBG-type rows make sense here; for non-tubing rows we no-op. */
  async function openTubingFromKbRow(row: Record<string, any>) {
    if (row?.type !== 'TBG' && row?.type !== 'CSG') return;
    const inputs: TubingInputs = {
      size_in: Number(row.size_in),
      weight_lbft: Number(row.weight_lbft),
      grade: row.grade as Grade,
      connection: (row.connection ?? 'EUE') as ConnectionType,
    };
    if (!Number.isFinite(inputs.size_in) || !Number.isFinite(inputs.weight_lbft)) return;
    const id = `tbg_${row.size_label?.replace(/[^\d.]/g, '')}_${inputs.weight_lbft}_${inputs.grade}_${inputs.connection}`.toLowerCase();
    const name = `${row.size_label} ${inputs.weight_lbft} lb/ft ${inputs.grade} ${inputs.connection}`;
    const spec = await generateTubingComponent(id, name, inputs);
    openComposite('comp', { id, name, spec });
  }

  function openRunes(entry: RunesEntry) {
    const id = `xml:${entry.meta.id}`;
    if (openTabs.find((t) => t.id === id)) {
      activeTabId = id;
      return;
    }
    // Seed params from the runes meta so the slider grid is populated.
    // buildPrimitiveManifold consults RUNES_REGISTRY directly, so the
    // geometry pipeline picks up entry.geom by id without further wiring.
    const seed = defaultsFor(entry.meta);
    openTabs = [
      ...openTabs,
      { id, kind: 'xml-primitive', runesEntry: entry, primId: entry.meta.id, label: entry.meta.name, params: seed, draft: false, vars: [] },
    ];
    activeTabId = id;
  }

  function openComposite(prefix: 'comp' | 'asm', entry: { id: string; name: string; spec?: any; route?: string }) {
    if ((entry as any).route) {
      // Legacy tool entry — punt to the existing viewer route.
      window.location.href = (entry as any).route;
      return;
    }
    const id = `${prefix}:${entry.id}`;
    if (openTabs.find((t) => t.id === id)) {
      activeTabId = id;
      return;
    }
    openTabs = [
      ...openTabs,
      { id, kind: 'composite', compositeSpec: entry.spec, primId: '', label: entry.name, params: {}, draft: false, vars: [] },
    ];
    activeTabId = id;
  }

  function openNewDraft(folder: Folder, ev?: MouseEvent) {
    ev?.stopPropagation();
    // Seed the draft from the first existing leaf in the folder so the
    // param schema is meaningful. The user can then tweak + "save as new".
    const leaves = itemsInFolder(folder);
    const seed = leaves[0];
    if (!seed) return;
    const id = `new:${folder.id}:${++nonce}`;
    openTabs = [
      ...openTabs,
      { id, primId: seed.id, label: `${seed.name} (new)`, params: structuredClone(seed.defaults), draft: true, vars: [] },
    ];
    activeTabId = id;
  }

  function closeTab(id: string, ev?: MouseEvent) {
    ev?.stopPropagation();
    const idx = openTabs.findIndex((t) => t.id === id);
    if (idx < 0) return;
    openTabs = openTabs.filter((t) => t.id !== id);
    if (activeTabId === id) {
      activeTabId = openTabs[idx]?.id ?? openTabs[idx - 1]?.id ?? null;
    }
  }

  function setActive(id: string) { activeTabId = id; }

  // Floating-panel visibility. Auxiliary panes (preview, script) live here
  // rather than in fixed layout columns so the main tab body stays
  // focused on the parameter editor — borrowed from SVTC's FloatingPanel
  // pattern. Toolbar buttons toggle each panel; positions persist in state
  // so reopening lands them where the user left them.
  // The preview is the focal point in the tab body, so it always renders
  // inline. Params + script are popups — toolbar buttons toggle them.
  // Resizable sidebar — drag the right edge to grow/shrink. Default
  // 200px (down from 260) since the lists are short and the stage
  // wants the room.
  let sidebarWidth = $state(200);
  let sidebarDragging = $state(false);
  function startSidebarDrag(e: MouseEvent) {
    e.preventDefault();
    sidebarDragging = true;
    const onMove = (ev: MouseEvent) => {
      sidebarWidth = Math.max(140, Math.min(520, ev.clientX));
    };
    const onUp = () => {
      sidebarDragging = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // Single consolidated "Inspector" popup. Replaced the previous separate
  // Params and Script popups so only one floating panel is ever visible
  // per tab. Tab strip inside the popup switches between views.
  // Inspector defaults to OPEN + DOCKED so editing is in-flow on first
  // landing. Toggling either via the toolbar / dock button still works.
  let showInspector = $state(true);
  // Dock the Inspector as a vertical column on the right of the tab body.
  // When false, it's a draggable floating popup.
  let inspectorDocked = $state(true);
  // Width of the docked Inspector column in px. User-resizable via a
  // drag handle on the column's left edge. Clamped on drag.
  let inspectorDocWidth = $state(456);
  let inspectorDocDragging = $state(false);
  function startDockResize(e: MouseEvent) {
    e.preventDefault();
    inspectorDocDragging = true;
    const tabBody = (e.currentTarget as HTMLElement).closest('.tab-body') as HTMLElement | null;
    const rect = tabBody?.getBoundingClientRect();
    const onMove = (ev: MouseEvent) => {
      // Width = distance from cursor to the right edge of the tab body.
      const right = rect ? rect.right : window.innerWidth;
      inspectorDocWidth = Math.max(280, Math.min(900, right - ev.clientX));
    };
    const onUp = () => {
      inspectorDocDragging = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }
  type InspectorTab = 'params' | 'svelte' | 'parts' | 'script' | 'md';
  // Default to Parts — it's the leftmost tab for runes primitives and the
  // module-library affordance is the most useful entry point. The snap-tab
  // effect below redirects to 'params' when the active tab is a legacy
  // primitive (no Parts tab there).
  let inspectorTab = $state<InspectorTab>('parts');
  /** Selected sub-tab inside the Params section. Tracks the `group` field
   *  of the displayed params. null = "show all". Resets per-tab via the
   *  $effect below when activeTab changes. */
  let selectedParamGroup = $state<string | null>(null);

  /** Ordered unique groups present in a params record. Params without a
   *  `group` field bucket into '__default__'. */
  function paramGroupsOf(params: Readonly<Record<string, { group?: string }>>): string[] {
    const groups: string[] = [];
    for (const v of Object.values(params)) {
      const g = v.group ?? '__default__';
      if (!groups.includes(g)) groups.push(g);
    }
    return groups;
  }
  // Async runes registry — fetched from /api/runes/list. Replaces the
  // static `import.meta.glob` import so newly-created primitives appear
  // in the sidebar without a dev-server restart.
  let runesList = $state<RunesEntry[]>([]);
  let runesListError = $state<string | null>(null);
  async function refreshRunesList() {
    try {
      runesList = await loadRunesRegistry();
      runesListError = null;
    } catch (e: any) {
      runesListError = e?.message ?? String(e);
    }
  }

  // Sidebar "+ New primitive" form — creates a fresh runes file via the
  // save endpoint with create:true. After success we re-fetch the list
  // (no page reload needed — the API picks up the new file immediately).
  let newPrimForm = $state<{ open: boolean; id: string; name: string; error: string; saving: boolean } | null>(null);
  async function createNewPrimitive() {
    if (!newPrimForm) return;
    const id = newPrimForm.id.trim();
    const name = newPrimForm.name.trim() || id;
    if (!/^[a-z][a-z0-9_]*$/.test(id)) {
      newPrimForm.error = 'ID must start with a lowercase letter; only [a-z0-9_].';
      return;
    }
    if (runesList.find((e) => e.meta.id === id)) {
      newPrimForm.error = `"${id}" already exists.`;
      return;
    }
    newPrimForm.saving = true;
    newPrimForm.error = '';
    const stub = `import { tube } from '../manifold-helpers';

export const meta = {
  id: '${id}',
  name: '${name.replace(/'/g, "\\'")}',
  description: '',
  tags: [],
  params: {
    od:     { label: 'OD',     min: 0.5,  max: 6,  step: 0.1,  unit: 'in', default: 2.0 },
    wall:   { label: 'Wall',   min: 0.05, max: 1,  step: 0.05, unit: 'in', default: 0.2 },
    length: { label: 'Length', min: 0.5,  max: 15, step: 0.1,  unit: 'in', default: 4.0 },
  },
  validate: (p: Record<string, number>): string[] => {
    const errs: string[] = [];
    if (p.wall * 2 >= p.od) errs.push('wall too thick');
    return errs;
  },
} as const;

export const geom = (p: Record<string, number>) => {
  const id = p.od - 2 * p.wall;
  return tube(p.od / 2, id / 2, p.length);
};
`;
    try {
      const r = await fetch('/api/runes/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, source: stub, create: true }),
      });
      if (!r.ok) {
        const txt = await r.text();
        newPrimForm.error = `${r.status} — ${txt.slice(0, 160)}`;
        newPrimForm.saving = false;
        return;
      }
      // Success — re-fetch the registry from the API so the new entry
      // shows up in the sidebar without a page reload. Then auto-open
      // it as a tab.
      newPrimForm = null;
      await refreshRunesList();
      const fresh = runesList.find((e) => e.meta.id === id);
      if (fresh) openRunes(fresh);
    } catch (e: any) {
      newPrimForm.error = e?.message ?? String(e);
      newPrimForm.saving = false;
    }
  }

  // ── Derived-param helpers — UI-side resolution + display formatting ─────
  // The same resolveDerived() logic ships in src/lib/components/runes/index.ts
  // (used by buildPrimitiveManifold before geom runs). We re-implement a
  // tolerant version here so the Params tab can show a value even when a
  // single from() throws (e.g. user dragged a slider into a transient
  // invalid state). Returns a record keyed by derived-name with the
  // computed number, or NaN when the function threw.
  function resolveDerivedSafe(
    derived: Readonly<Record<string, DerivedSchema>>,
    params: Record<string, number>,
  ): Record<string, number> {
    const out: Record<string, number> = { ...params };
    for (const [k, schema] of Object.entries(derived)) {
      try { out[k] = schema.from(out); } catch { out[k] = NaN; }
    }
    return out;
  }

  /** Tidy display for a derived value — 3 decimals max, fixed-trim trailing
   *  zeros, "—" when NaN/undefined. */
  function fmtDerived(v: number | undefined): string {
    if (v === undefined || !isFinite(v)) return '—';
    const r = Math.round(v * 1000) / 1000;
    return String(r);
  }

  // ── Parts library — what the geom function can import + compose ─────────
  // The Inspector's Svelte tab renders this as a left rail. Each entry is a
  // module that exports a Manifold-returning function:
  //   • Helpers from manifold-helpers (cyl, tube, mv, rot) — primitive Manifold ops.
  //   • Other runes primitives — each `geom(p)` returns a Manifold, so they
  //     compose via union/subtract/etc. inside a more complex part.
  //
  // Click an entry → snippet (import line at top + call at bottom) is
  // appended to the editor's source draft so the user can move it where
  // needed. We don't mutate the saved file until the user hits Save.
  // Catalog is derived from the actual `@part`-tagged exports in
  // manifold-helpers.ts. Adding a new helper (with the `/** @part … */`
  // JSDoc tag) automatically surfaces it here — no UI edits needed.
  const HELPERS = discoverHelpers();

  /** Insert a line into the geom function body, right before the closing
   *  `};`. Brace-walks the body so nested `{}` (object literals, arrow
   *  functions in params, etc.) don't fool us. Falls back to appending at
   *  the end of the source if the geom function can't be located. The
   *  inserted line carries a `// + part:` marker so the user can grep for
   *  recently-added scaffolding and wire it into their return. */
  function insertIntoGeomBody(src: string, line: string): string {
    const re = /export\s+const\s+geom\s*=\s*\([^)]*\)\s*=>\s*\{/;
    const m = re.exec(src);
    if (!m) return src.replace(/\s*$/, '') + `\n${line}\n`;
    const open = m.index + m[0].length;
    let i = open;
    let depth = 1;
    let inS: '"' | "'" | '`' | null = null;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (inS) {
        if (c === '\\') { i += 2; continue; }
        if (c === inS) inS = null;
      } else {
        if (c === '"' || c === "'" || c === '`') inS = c as any;
        else if (c === '{') depth++;
        else if (c === '}') depth--;
      }
      if (depth === 0) break;
      i++;
    }
    if (depth !== 0) return src.replace(/\s*$/, '') + `\n${line}\n`;
    // i points at the matching closing `}`. Insert the line, indented
    // two spaces, on its own line just before the close.
    const before = src.slice(0, i).replace(/\s*$/, '\n');
    return before + `  ${line}\n` + src.slice(i);
  }

  /** Pick a starter call expression for a helper, smart-defaulting to the
   *  active tab's params when the names line up. If the tab has `od`,
   *  `wall`, `length` etc., we wire `p.od`, `(p.od - 2 * p.wall) / 2`,
   *  `p.length` so the inserted line renders something meaningful right
   *  away. Falls back to numeric literals when params don't match — the
   *  user adjusts before composing. Signatures pinned to the actual
   *  exports in manifold-helpers.ts (mv/rot take a vec3 array). */
  function defaultHelperCall(name: string, paramKeys: Set<string>): string {
    const has = (k: string) => paramKeys.has(k);
    switch (name) {
      case 'cyl':
        return has('length') && has('od')
          ? `cyl(p.length, p.od / 2, p.od / 2)`
          : `cyl(1, 0.5, 0.5)`;
      case 'tube':
        return has('od') && has('wall') && has('length')
          ? `tube(p.od / 2, (p.od - 2 * p.wall) / 2, p.length)`
          : `tube(0.75, 0.5, 1)`;
      case 'mv':  return `mv(part, [0, 0, 0])`;
      case 'rot': return `rot(part, [0, 0, 0])`;
      default:    return `${name}()`;
    }
  }

  /** Add a manifold-helpers import + a starter call inside geom().
   *  Idempotent on the import; the call line is appended every click so
   *  the user can stamp out multiple instances if needed. */
  function snippetForHelper(src: string, name: string, paramKeys: Set<string>): string {
    let next = src;
    const importRe = /import\s*\{\s*([^}]*)\s*\}\s*from\s*['"]\.\.\/manifold-helpers['"];?/;
    const m = importRe.exec(next);
    if (m) {
      const names = m[1].split(',').map((s) => s.trim()).filter(Boolean);
      if (!names.includes(name)) {
        names.push(name);
        next = next.slice(0, m.index) + `import { ${names.join(', ')} } from '../manifold-helpers';` + next.slice(m.index + m[0].length);
      }
    } else {
      next = `import { ${name} } from '../manifold-helpers';\n` + next;
    }
    const baseCall = defaultHelperCall(name, paramKeys);
    const constName = uniqueConstName(next, name);
    return insertIntoGeomBody(next, `const ${constName} = ${baseCall}; // + part: ${name}`);
  }

  /** Add a runes-primitive import (`geom as <id>Geom`) + a starter call
   *  inside geom(). The call uses the imported primitive's defaults map
   *  so it renders something sensible the moment you wire it into the
   *  return. */
  function snippetForRunes(src: string, entry: RunesEntry): string {
    const id = entry.meta.id;
    const alias = id.replace(/_(\w)/g, (_, c) => c.toUpperCase()) + 'Geom';
    let next = src;
    const importRe = new RegExp(`import\\s*\\{[^}]*\\bgeom as ${alias}\\b[^}]*\\}\\s*from\\s*['"]\\.\\/${id}['"];?`);
    if (!importRe.test(next)) {
      next = `import { geom as ${alias} } from './${id}';\n` + next;
    }
    const defaults = Object.entries(entry.meta.params)
      .map(([k, v]: [string, any]) => `${k}: ${v?.default ?? 0}`)
      .join(', ');
    const constName = uniqueConstName(next, id);
    return insertIntoGeomBody(next, `const ${constName} = ${alias}({ ${defaults} }); // + part: ${entry.meta.name}`);
  }

  /** Pick a const name that doesn't collide with anything already declared
   *  in the source. Strips trailing _N counter on the base, then walks up. */
  function uniqueConstName(src: string, base: string): string {
    const root = base.replace(/_\d+$/, '');
    for (let i = 1; i < 100; i++) {
      const name = `${root}_${i}`;
      const re = new RegExp(`\\b${name}\\b`);
      if (!re.test(src)) return name;
    }
    return `${root}_${Date.now()}`;
  }

  /** Remove a manifold-helpers helper from the import list. If it was the
   *  only name, the entire import line is dropped. No-op if not present. */
  function removeHelperImport(src: string, name: string): string {
    const importRe = /import\s*\{\s*([^}]*)\s*\}\s*from\s*['"]\.\.\/manifold-helpers['"];?\n?/;
    const m = importRe.exec(src);
    if (!m) return src;
    const names = m[1].split(',').map((s) => s.trim()).filter(Boolean).filter((n) => n !== name);
    if (names.length === 0) return src.slice(0, m.index) + src.slice(m.index + m[0].length);
    return src.slice(0, m.index) + `import { ${names.join(', ')} } from '../manifold-helpers';\n` + src.slice(m.index + m[0].length);
  }

  /** Compute fold ranges for the Inspector's Svelte tab to apply on first
   *  mount — collapses imports + the `meta = { ... }` body so the user
   *  lands inside `geom`. CodeMirror folds the region BETWEEN `from` and
   *  `to`; the opener line itself stays visible with a `+` pill. We start
   *  each range at the end of the opener (right after `{` or after the
   *  last import's newline) and end at the matching closer.
   *
   *  - Imports range: from end-of-line of the LAST consecutive import at
   *    file top, to itself — wait, that doesn't fold anything. Instead we
   *    fold from the end of the FIRST import line through the end of the
   *    LAST consecutive import — collapses the whole import stack into
   *    the first line (which keeps `+ Add` parts visible in the parts
   *    panel anyway, so visual cost is minimal).
   *  - Meta range: from the `{` after `export const meta =` through the
   *    matching `}`. Brace-walks to handle nested object literals (params,
   *    validate) cleanly.
   *
   *  Returns [] for non-runes sources (no meta block found). */
  function runesDefaultFolds(src: string): Array<{ from: number; to: number }> {
    const out: Array<{ from: number; to: number }> = [];

    // Imports — find the run of consecutive `import ...;` lines at top.
    const lines = src.split('\n');
    let lastImportEnd = -1;
    let firstImportEnd = -1;
    let offset = 0;
    for (const line of lines) {
      const trimmed = line.trim();
      const isImport = /^import\b/.test(trimmed);
      const isBlank = trimmed === '';
      if (isImport) {
        if (firstImportEnd < 0) firstImportEnd = offset + line.length;
        lastImportEnd = offset + line.length;
      } else if (!isBlank && lastImportEnd >= 0) {
        break; // hit non-import, non-blank — end of import stack
      }
      offset += line.length + 1; // +1 for the newline
    }
    if (firstImportEnd >= 0 && lastImportEnd > firstImportEnd) {
      out.push({ from: firstImportEnd, to: lastImportEnd });
    }

    // Meta — find `export const meta = {` and brace-walk to the matching `}`.
    const metaRe = /export\s+const\s+meta\s*=\s*\{/;
    const m = metaRe.exec(src);
    if (m) {
      const openBracePos = m.index + m[0].length - 1; // position of `{`
      let i = openBracePos + 1;
      let depth = 1;
      let inS: '"' | "'" | '`' | null = null;
      while (i < src.length && depth > 0) {
        const c = src[i];
        if (inS) {
          if (c === '\\') { i += 2; continue; }
          if (c === inS) inS = null;
        } else {
          if (c === '"' || c === "'" || c === '`') inS = c as any;
          else if (c === '{') depth++;
          else if (c === '}') depth--;
        }
        if (depth === 0) break;
        i++;
      }
      if (depth === 0) {
        // Fold from just after the opening `{` through just before the
        // closing `}` so the opener + closer lines stay readable.
        out.push({ from: openBracePos + 1, to: i });
      }
    }

    return out;
  }

  /** Drop the import line for a runes primitive's geom. */
  function removeRunesImport(src: string, id: string): string {
    const importRe = new RegExp(`import\\s*\\{[^}]*\\bgeom as \\w+\\b[^}]*\\}\\s*from\\s*['"]\\.\\/${id}['"];?\\n?`);
    return src.replace(importRe, '');
  }

  /** Parse the source and return which helpers / runes primitives are
   *  currently imported. The Parts tab renders ONLY these — the catalog
   *  (everything else available) sits behind an explicit "+ Add" picker.
   *  Encapsulation: each primitive surfaces just its own direct deps. */
  function importedFromSource(src: string): { helpers: Set<string>; runes: Set<string> } {
    const helpers = new Set<string>();
    const runes = new Set<string>();
    const helpersRe = /import\s*\{\s*([^}]*)\s*\}\s*from\s*['"]\.\.\/manifold-helpers['"];?/g;
    for (const m of src.matchAll(helpersRe)) {
      for (const n of m[1].split(',').map((s) => s.trim()).filter(Boolean)) helpers.add(n);
    }
    const runesRe = /import\s*\{[^}]*\bgeom as \w+\b[^}]*\}\s*from\s*['"]\.\/([a-z][a-z0-9_]*)['"];?/g;
    for (const m of src.matchAll(runesRe)) runes.add(m[1]);
    return { helpers, runes };
  }

  function removeHelper(name: string) {
    if (!activeTab || activeTab.kind !== 'xml-primitive' || !activeTab.runesEntry) return;
    const cur = activeTab.sourceDraft ?? activeTab.runesEntry.source;
    activeTab.sourceDraft = removeHelperImport(cur, name);
  }
  function removeRunes(id: string) {
    if (!activeTab || activeTab.kind !== 'xml-primitive' || !activeTab.runesEntry) return;
    const cur = activeTab.sourceDraft ?? activeTab.runesEntry.source;
    activeTab.sourceDraft = removeRunesImport(cur, id);
  }

  // Toggle the "+ Add" picker per section in the Parts tab. We keep these
  // at module scope rather than per-tab — picker open-state is cheap UI
  // chrome, doesn't need to survive tab switches.
  let partsAddHelperOpen = $state(false);
  let partsAddRunesOpen  = $state(false);

  function insertHelperSnippet(name: string) {
    if (!activeTab || activeTab.kind !== 'xml-primitive' || !activeTab.runesEntry) return;
    const cur = activeTab.sourceDraft ?? activeTab.runesEntry.source;
    const keys = new Set(Object.keys(activeTab.params));
    activeTab.sourceDraft = snippetForHelper(cur, name, keys);
  }
  function insertRunesSnippet(entry: RunesEntry) {
    if (!activeTab || activeTab.kind !== 'xml-primitive' || !activeTab.runesEntry) return;
    if (entry.meta.id === activeTab.runesEntry.meta.id) return; // can't import yourself
    const cur = activeTab.sourceDraft ?? activeTab.runesEntry.source;
    activeTab.sourceDraft = snippetForRunes(cur, entry);
  }

  // ── Delete a runes primitive ─────────────────────────────────────────────
  // Calls DELETE /api/runes/delete which (a) refuses if the primitive is
  // referenced by any authored component (returns 409 + reference list),
  // (b) deletes the .ts source + .glb otherwise, (c) invalidates the
  // server-side list cache. On success we re-fetch the registry and close
  // any open tab for the deleted id. Any open Params/Svelte/MD popups for
  // that tab go with the tab.
  async function deleteRunes(entry: RunesEntry) {
    const id = entry.meta.id;
    const name = entry.meta.name;
    const ok = window.confirm(
      `Delete primitive "${name}" (${id})?\n\nThis removes the source file and the baked GLB. ` +
      `If any authored component uses it, the request will be refused.`,
    );
    if (!ok) return;
    try {
      const r = await fetch('/api/runes/delete', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (r.status === 409) {
        const body = await r.json().catch(() => ({}));
        const refs = (body?.references ?? []) as Array<{ id: string; name: string; parts: string[] }>;
        const list = refs.map((r) => `  • ${r.name} (${r.id}) — parts: ${r.parts.join(', ')}`).join('\n');
        window.alert(
          `Cannot delete "${name}" — it is referenced by ${refs.length} authored component${refs.length === 1 ? '' : 's'}:\n\n${list}\n\nRemove those parts first.`,
        );
        return;
      }
      if (!r.ok) {
        const txt = await r.text();
        window.alert(`Delete failed (${r.status}): ${txt.slice(0, 200)}`);
        return;
      }
      // Close any open tab for this primitive.
      const tabId = `xml:${id}`;
      if (openTabs.find((t) => t.id === tabId)) closeTab(tabId);
      // Re-fetch the registry so the sidebar updates.
      await refreshRunesList();
    } catch (e: any) {
      window.alert(`Delete failed: ${e?.message ?? String(e)}`);
    }
  }

  function openInspector(tab: InspectorTab) {
    inspectorTab = tab;
    showInspector = true;
  }
  // When the active tab changes, snap the inspector tab to one that's
  // valid for the new tab's kind (e.g. 'script' is xml-only-invalid).
  $effect(() => {
    if (!activeTab) return;
    if (activeTab.kind === 'xml-primitive' && inspectorTab === 'script') inspectorTab = 'svelte';
    if (activeTab.kind !== 'xml-primitive' && (inspectorTab === 'svelte' || inspectorTab === 'md' || inspectorTab === 'parts')) inspectorTab = 'params';
  });
  let showCutaway = $state(true);
  let showEdges = $state(true);

  // ── Live Threlte scene state ─────────────────────────────────────────────
  // Mirrors /author's pattern: lazy-import ComponentScene to keep the
  // route's initial bundle small, init manifold WASM on mount, rebuild geo
  // when the active tab's params change (debounced 200ms to coalesce
  // slider drags into one rebuild instead of fifty).
  let SceneComponent = $state<any>(null);
  /** Lazy-loaded camera/light controls overlay (cog button at the canvas
   *  top-right). Shared with /author via $lib/shared/SceneControls + the
   *  module-level reactive state in $lib/shared/scene-state.svelte.ts, so
   *  edits here persist to /author and vice versa within a session. */
  let SceneControls = $state<any>(null);
  let ready = $state(false);
  let geo = $state<any>(null);
  let geoVersion = $state(0);
  let buildError = $state<string | null>(null);

  /** Pretty-print a buildError for the inline strip. Manifold ops stringify
   *  the bad argument with `.toString()` when type-checking fails — for
   *  functions that yields the entire source body, swamping the strip and
   *  obscuring the actual problem.
   *
   *  Detect the common case ("Cannot pass <fn source> as a Manifold") and
   *  rewrite to a short summary + an actionable hint. Everything else
   *  passes through unchanged. */
  function formatBuildError(raw: string | null): { msg: string; hint?: string } | null {
    if (!raw) return null;
    const m = /^Cannot pass "([\s\S]+?)" as a Manifold/.exec(raw);
    if (m && (m[1].includes('=>') || /^\s*function\b/.test(m[1]))) {
      return {
        msg: 'A Manifold op got a function instead of a Manifold.',
        hint:
          'You imported a primitive\'s geom but used it directly. Call it first — e.g. ' +
          '`taperedConeGeom({ od: 2.875, … })` — and pass the RESULT to `.add()` / `.subtract()`. ' +
          'The Parts tab\'s "+ Add primitive" inserts the call snippet for you.',
      };
    }
    return { msg: raw };
  }
  onMount(async () => {
    import('$lib/shared/ComponentScene.svelte').then((m) => { SceneComponent = m.default; });
    import('$lib/shared/SceneControls.svelte').then((m) => { SceneControls = m.default; });
    initManifold().then(() => { ready = true; });
    // Async-load the registry from /api/runes/list before deciding what
    // to auto-open. box_conn is the active work-in-progress primitive —
    // landing there saves a click every reload. Falls back to Tube if
    // box_conn isn't installed.
    await refreshRunesList();
    if (openTabs.length === 0) {
      const entry =
        runesList.find((e) => e.meta.id === 'conn_box') ??
        runesList.find((e) => e.meta.id === 'hollow_cylinder');
      if (entry) openRunes(entry);
    }
  });

  /** Compose a minimal AuthoredComponent for the active tab so buildAuthored
   *  can construct + finalize the geometry. Single part, no ops. */
  function activeSpec(): AuthoredComponent | null {
    if (!activeTab) return null;
    if (activeTab.kind === 'primitive' || activeTab.kind === 'xml-primitive') {
      const s = emptyAuthoredComponent();
      s.id = activeTab.primId;
      s.name = activeTab.label;
      s.parts = [{ id: 'p0', kind: 'primitive', prim: activeTab.primId, params: { ...activeTab.params } }];
      return s;
    }
    if (activeTab.kind === 'composite' && activeTab.compositeSpec) {
      return activeTab.compositeSpec;
    }
    return null;
  }

  let buildKey = $derived(
    activeTab && (activeTab.kind === 'primitive' || activeTab.kind === 'xml-primitive')
      ? JSON.stringify({ id: activeTab.primId, p: activeTab.params })
      : activeTab && activeTab.kind === 'composite'
      ? `comp:${activeTab.id}`
      : '',
  );
  let buildTimer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    const _k = buildKey;
    if (!ready || !activeTab || activeTab.kind === 'kb') { geo = null; buildError = null; return; }
    if (buildTimer) clearTimeout(buildTimer);
    buildTimer = setTimeout(async () => {
      const spec = activeSpec();
      if (!spec) return;
      try {
        geo = await buildAuthored(spec);
        geoVersion++;
        buildError = null;
      } catch (e: any) {
        buildError = e?.message ?? String(e);
      }
    }, 200);
  });

  async function saveRunesSource(tab: Tab): Promise<boolean> {
    if (tab.kind !== 'xml-primitive' || !tab.runesEntry) return false;
    const next = tab.sourceDraft ?? tab.runesEntry.source;
    tab.saveStatus = 'saving';
    tab.saveError = undefined;
    try {
      const r = await fetch('/api/runes/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: tab.runesEntry.meta.id, source: next }),
      });
      if (!r.ok) {
        const txt = await r.text();
        tab.saveStatus = 'error';
        tab.saveError = `${r.status} ${r.statusText} — ${txt.slice(0, 160)}`;
        return false;
      }
      tab.saveStatus = 'saved';
      // Re-fetch the registry from the API so the in-memory tab entry
      // matches what's now on disk. Then update the tab's reference.
      await refreshRunesList();
      const fresh = runesList.find((e) => e.meta.id === tab.runesEntry!.meta.id);
      if (fresh) tab.runesEntry = { ...fresh, source: next };
      tab.sourceDraft = null;
      return true;
    } catch (e: any) {
      tab.saveStatus = 'error';
      tab.saveError = e?.message ?? String(e);
      return false;
    }
  }

  function discardRunesDraft(tab: Tab) {
    tab.sourceDraft = null;
    tab.saveStatus = 'idle';
    tab.saveError = undefined;
  }

  function resetParams(tab: Tab) {
    if (tab.kind === 'xml-primitive' && tab.runesEntry) {
      tab.params = defaultsFor(tab.runesEntry.meta);
      return;
    }
    const def = COMPONENTS.find((c) => c.id === tab.primId);
    if (def) tab.params = structuredClone(def.defaults);
  }

  async function copyId(tab: Tab) {
    try { await navigator.clipboard.writeText(tab.primId); } catch {}
  }

  let activeTab = $derived(openTabs.find((t) => t.id === activeTabId) ?? null);
  /** True when the active tab is parameter-driven (regular primitive OR a
   *  runes-class XML primitive). Both share the same toolbar / 3D scene /
   *  Params + Script popups; the only difference is what gets shown in
   *  the Script popup (hand-written builder vs runes-compiled source). */
  let isParamTab = $derived(activeTab?.kind === 'primitive' || activeTab?.kind === 'xml-primitive');
  /** activeDef provides the metadata the stage block uses to render the
   *  header (name / id / category / description / tags). For 'primitive'
   *  tabs it's the matching ComponentDef from COMPONENTS. For 'composite'
   *  tabs (level-3 components or level-4 assemblies) we synthesize a
   *  ComponentDef-shaped object from the AuthoredComponent spec so the
   *  same render path covers both cases. KB tabs short-circuit before
   *  this is read. */
  let activeDef = $derived.by<ComponentDef | null>(() => {
    if (!activeTab) return null;
    if (activeTab.kind === 'composite' && activeTab.compositeSpec) {
      const spec = activeTab.compositeSpec;
      return {
        id: spec.id,
        name: spec.name,
        category: 'composite',
        description: spec.description ?? '',
        tags: spec.tags ?? [],
        params: {},
        defaults: {},
      } as ComponentDef;
    }
    // XML primitive — synthesize a ComponentDef from the runes meta.
    if (activeTab.kind === 'xml-primitive' && activeTab.runesEntry) {
      const m = activeTab.runesEntry.meta;
      // ComponentDef.params expects { label, min, max, step, unit? } — our
      // PrimitiveMeta.params adds `default` (a superset). Cast through.
      return {
        id: m.id,
        name: m.name,
        category: 'basic',
        description: m.description ?? '',
        tags: [...(m.tags ?? [])],
        params: m.params as any,
        defaults: defaultsFor(m),
      } as ComponentDef;
    }
    return COMPONENTS.find((c) => c.id === activeTab.primId) ?? null;
  });
  /** Source of the active primitive's builder function, sliced out of
   *  builder.ts at build time. Falls back to a friendly note if the slice
   *  couldn't find the function (e.g. inline arrow form that doesn't match
   *  the `<id>(p) {` shape extractBuilder expects). */
  let builderText = $derived.by<string>(() => {
    if (!activeTab) return '';
    // XML primitive — runes file IS the source; the Inspector shows it in
    // the Svelte tab, so the Script tab is hidden for these. Keep the
    // builderText derive intact for legacy primitives.
    return extractBuilder(builderSource, activeTab.primId) ?? '// (no script — builder function not found in builder.ts)';
  });

  /** Auto-generate a markdown block from a runes-file's meta. Used by the
   *  Inspector's MD tab. Replaces the deleted runes/docs.ts. */
  function generateMd(entry: RunesEntry, currentParams: Record<string, number>): string {
    const m = entry.meta;
    const lines: string[] = [];
    lines.push(`# ${m.name}`);
    lines.push('');
    if (m.description) { lines.push(m.description); lines.push(''); }
    lines.push(`**id:** \`${m.id}\``);
    lines.push('');
    lines.push('## Parameters');
    lines.push('');
    lines.push('| Name | Default | Range | Step | Unit | Label |');
    lines.push('|---|---|---|---|---|---|');
    for (const [k, v] of Object.entries(m.params)) {
      lines.push(`| \`${k}\` | ${v.default} | ${v.min} – ${v.max} | ${v.step} | ${v.unit ?? ''} | ${v.label} |`);
    }
    if (m.tags && m.tags.length) {
      lines.push('');
      lines.push('## Tags');
      lines.push('');
      lines.push(m.tags.map((t) => `\`${t}\``).join(' · '));
    }
    if (m.validate) {
      const errs = m.validate(currentParams);
      lines.push('');
      lines.push('## Constraints');
      lines.push('');
      lines.push(`\`validate(p)\` — ${errs.length === 0 ? 'currently passes ✓' : `currently fails: ${errs.join('; ')}`}`);
    }
    return lines.join('\n');
  }

  // ── Draft-only param add/remove ──────────────────────────────────────────
  // Adds a "draft param" row to a draft tab's params. The change is purely
  // UI for now — it doesn't propagate to library.ts or builder.ts, so the
  // geometry pipeline ignores extras. Surfaced so the user can sketch what
  // a new primitive's schema would look like before committing to code.
  // ── Script-popup draft variables ─────────────────────────────────────────
  // Add / remove "draft variables" surfaced at the top of the Script popup.
  // These render as `const <name> = <expr>;` lines above the builder body —
  // same idea as ManifoldCAD's web playground where variables live at the
  // top of the script. The lines are session-only display until task #9/#10
  // (spec MD → builder generator) wires them into geometry.
  function addVar(tab: Tab) {
    let i = 1;
    while (tab.vars.some((v) => v.name === `v${i}`)) i++;
    tab.vars = [...tab.vars, { name: `v${i}`, expr: '0' }];
  }
  function removeVar(tab: Tab, idx: number) {
    tab.vars = tab.vars.filter((_, i) => i !== idx);
  }

  function addParam(tab: Tab) {
    let i = 1;
    while (`new_${i}` in tab.params) i++;
    tab.params = { ...tab.params, [`new_${i}`]: 1 };
  }

  // ── Param-form for adding a NEW parameter to a runes class ───────────────
  // Click the "+" next to the Parameters title to open the form. On submit
  // the new param is added to the tab's in-memory params (slider shows up
  // immediately) AND spliced into the tab's sourceDraft (the .ts source
  // shown in the Svelte tab editor) so the user can review + save to disk.
  // The save flow is the same one the editor already uses.
  function openParamForm(tab: Tab) {
    tab.paramForm = {
      open: true,
      name: '',
      type: 'numeric',
      unit: '',
      defaultValue: '1',
      min: '0',
      max: '10',
      step: '0.1',
      label: '',
      error: '',
    };
  }
  function closeParamForm(tab: Tab) {
    if (tab.paramForm) tab.paramForm.open = false;
  }
  /** Splice a new param entry into the `params: { ... }` block of a runes
   *  file's `meta` object literal. Returns the modified source or null if
   *  the source shape doesn't match expectations. */
  function insertParamIntoSource(
    src: string,
    name: string,
    defaultValue: number,
    meta: { label: string; min: number; max: number; step: number; unit?: string; type?: string },
  ): string | null {
    // Locate the `params: {` opening within the `meta` literal. Tolerant
    // of whitespace; matches the first occurrence (each runes file has one).
    const paramsRe = /\bparams\s*:\s*\{/;
    const m = paramsRe.exec(src);
    if (!m) return null;
    let i = m.index + m[0].length;
    let depth = 1;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      if (depth === 0) break;
      i++;
    }
    if (depth !== 0) return null;
    const closeIdx = i;
    const lineStart = src.lastIndexOf('\n', closeIdx) + 1;
    const closeIndent = src.slice(lineStart, closeIdx).match(/^(\s*)/)?.[1] ?? '    ';
    const entryIndent = closeIndent + '  ';
    const parts: string[] = [`label: '${(meta.label || name).replace(/'/g, "\\'")}'`];
    if (Number.isFinite(meta.min))  parts.push(`min: ${meta.min}`);
    if (Number.isFinite(meta.max))  parts.push(`max: ${meta.max}`);
    if (Number.isFinite(meta.step)) parts.push(`step: ${meta.step}`);
    parts.push(`default: ${defaultValue}`);
    if (meta.unit) parts.push(`unit: '${meta.unit.replace(/'/g, "\\'")}'`);
    if (meta.type && meta.type !== 'numeric') parts.push(`type: '${meta.type.replace(/'/g, "\\'")}'`);
    const entry = `${entryIndent}${name}: { ${parts.join(', ')} },\n`;
    return src.slice(0, closeIdx).replace(/\s*$/, '\n') + entry + closeIndent + src.slice(closeIdx);
  }

  async function submitParamForm(tab: Tab) {
    if (!tab.paramForm || !tab.runesEntry) return;
    const f = tab.paramForm;
    const name = f.name.trim();
    if (!/^[a-z][a-zA-Z0-9_]*$/.test(name)) {
      f.error = 'Name must start with a lowercase letter; use only letters, digits, underscores.';
      return;
    }
    if (name in tab.params) {
      f.error = `"${name}" already exists.`;
      return;
    }
    const def    = Number(f.defaultValue);
    const minN   = Number(f.min);
    const maxN   = Number(f.max);
    const stepN  = Number(f.step);
    if (!Number.isFinite(def)) { f.error = 'Default must be a number.'; return; }
    if (f.type === 'numeric' && (!Number.isFinite(minN) || !Number.isFinite(maxN) || !Number.isFinite(stepN))) {
      f.error = 'Min, max, and step must all be numbers for a numeric param.';
      return;
    }

    // 1) In-memory: slider appears immediately.
    tab.params = { ...tab.params, [name]: def };

    // 2) Splice into source draft.
    const current = tab.sourceDraft ?? tab.runesEntry.source;
    const updated = insertParamIntoSource(current, name, def, {
      label: f.label.trim() || name,
      min:   minN,
      max:   maxN,
      step:  stepN,
      unit:  f.unit.trim() || undefined,
      type:  f.type,
    });
    if (updated == null) {
      f.error = 'Could not splice into source — file shape unexpected. Open the Svelte tab and add it manually.';
      return;
    }
    tab.sourceDraft = updated;

    // 3) Auto-save to disk so the new param persists across reloads —
    // people miss the manual Save button in the Svelte tab. Errors
    // surface on the form so the user sees what happened.
    const ok = await saveRunesSource(tab);
    if (!ok) {
      f.error = `Splice succeeded but save failed: ${tab.saveError ?? 'unknown'}. Open the Svelte tab to retry.`;
      return;
    }

    // 4) Close + reset.
    f.open = false;
    f.error = '';
    f.name = '';
  }
  function removeParam(tab: Tab, key: string) {
    const next = { ...tab.params };
    delete next[key];
    tab.params = next;
  }
  /** Definition for a key, or a synthetic one for user-added draft params. */
  function paramDef(def: ComponentDef, key: string) {
    return def.params[key] ?? { label: key, min: 0, max: 100, step: 0.1, unit: '' };
  }
</script>

<div class="layout">
  <aside class="sidebar" tabindex="0" onkeydown={onSidebarKey} style="width: {sidebarWidth}px">
    <div class="sb-hdr">
      <span class="sb-hdr-mark">◆</span>
      <span class="sb-hdr-text">Components</span>
    </div>

    <div class="sb-split">
      <!-- Vertical tab rail on the left — one button per top-level group.
           Selected tab swaps the flat list shown to its right. -->
      <div class="sb-rail">
        {#each TREE as f (f.id)}
          {@const count = f.id === 'components' ? COMPONENTS_L3.filter((c) => c.tier === 3).length
                       : f.id === 'compositions' ? itemsInFolder(f).length + COMPONENTS_L3.filter((c) => c.tier === 2).length
                       : f.id === 'assemblies' ? ASSEMBLIES_L4.length
                       : f.id === 'kb' ? kbList.length
                       : f.id === 'xml_primitive' ? runesList.length
                       : itemsInFolder(f).length}
          <button
            class="sb-tab"
            class:active={sidebarTab === f.id}
            class:compound={f.compound}
            onclick={() => (sidebarTab = f.id)}
            title="{f.name} ({count})"
          >
            <span class="sb-tab-name">{f.name}</span>
            <span class="sb-tab-count">{count}</span>
          </button>
        {/each}
      </div>

    {#snippet primItem(c: ComponentDef, scope: ComponentDef[], depth: number)}
      {@const compound = isCompound(c)}
      {@const kids = CHILDREN_BY_PARENT[c.id] ?? []}
      {@const hasKids = kids.some((k) => scope.includes(k) && matchesFilter(k))}
      {@const expanded = parentExpanded.has(c.id)}
      <div class="prim-row" style="--depth: {depth}">
        {#if hasKids}
          <button
            class="prim-caret"
            type="button"
            aria-label={expanded ? 'Collapse children' : 'Expand children'}
            onclick={(e) => toggleParent(c.id, e)}
          >{expanded ? '▾' : '▸'}</button>
        {:else}
          <span class="prim-caret-spacer"></span>
        {/if}
        <button
          class="prim-link"
          class:active={activeTab?.primId === c.id && !activeTab?.draft}
          class:cursor={sidebarIds[cursorIdx] === c.id}
          class:compound
          class:child={depth > 0}
          class:folder={hasKids}
          data-prim-id={c.id}
          onclick={() => { openPrim(c.id); cursorIdx = sidebarIds.indexOf(c.id); }}
          onmouseenter={(e) => onHoverItem(c.id, e)}
          onmouseleave={onLeaveItem}
          onfocus={(e) => onHoverItem(c.id, e as unknown as MouseEvent)}
          onblur={onLeaveItem}
        >
          {#if hasKids}
            <!-- Folder glyph signals "base class with derived children".
                 Filled when expanded, outlined when collapsed. -->
            <span class="prim-folder">{expanded ? '📂' : '📁'}</span>
          {:else}
            <span class="dot" class:pipe={PIPE_PRIMS.has(c.id)}></span>
          {/if}
          <span class="pl-name">{c.name}</span>
          {#if hasKids}<span class="prim-kid-count">{kids.length}</span>{/if}
        </button>
      </div>
      {#if expanded && hasKids}
        {#each kids.filter((k) => scope.includes(k) && matchesFilter(k)) as kid (kid.id)}
          {@render primItem(kid, scope, depth + 1)}
        {/each}
      {/if}
    {/snippet}

    <div class="sb-body">
      <!-- Filter — substring match across name, id, tags. Cheap to scale to
           many primitives; the list re-renders client-side. -->
      <div class="sb-filter">
        <input
          type="text"
          placeholder="Filter…"
          bind:value={filter}
          aria-label="Filter primitives"
        />
        {#if filter}
          <button class="sb-filter-x" type="button" onclick={() => (filter = '')} aria-label="Clear filter">×</button>
        {/if}
      </div>

      {#if sidebarTab === 'components'}
        <!-- Level-3 Components — multi-PART physical items (HF-1 packer,
             HS-ICV valve, Bottom Sub, Ratch-Latch). Filtered from
             COMPONENTS_L3 by tier === 3. -->
        {@const filt = COMPONENTS_L3.filter((c) => c.tier === 3 && (!filter || c.name.toLowerCase().includes(filter.toLowerCase()) || c.tags.some((t) => t.toLowerCase().includes(filter.toLowerCase()))))}
        {@const groups = Array.from(new Set(filt.map((c) => c.group ?? 'Other')))}
        {#each groups as g (g)}
          <div class="sb-subhead">{g}</div>
          <div class="sb-list">
            {#each filt.filter((c) => (c.group ?? 'Other') === g) as c (c.id)}
              <button
                class="prim-link"
                class:active={activeTab?.id === `comp:${c.id}`}
                onclick={() => openComposite('comp', c)}
                title={c.description}
              >
                <span class="dot" class:pipe={c.kind === 'tool'}></span>
                <span class="pl-name">{c.name}</span>
                {#if c.kind === 'tool'}<span class="prim-kid-count">tool</span>{/if}
              </button>
            {/each}
          </div>
        {/each}
        {#if filt.length === 0}<div class="sb-empty">No components match "{filter}".</div>{/if}
      {/if}
      {#if sidebarTab === 'assemblies'}
        {@const filt = ASSEMBLIES_L4.filter((a) => !filter || a.name.toLowerCase().includes(filter.toLowerCase()) || a.tags.some((t) => t.toLowerCase().includes(filter.toLowerCase())))}
        {@const groups = Array.from(new Set(filt.map((a) => a.group ?? 'Other')))}
        {#each groups as g (g)}
          <div class="sb-subhead">{g}</div>
          <div class="sb-list">
            {#each filt.filter((a) => (a.group ?? 'Other') === g) as a (a.id)}
              <button
                class="prim-link"
                class:active={activeTab?.id === `asm:${a.id}`}
                onclick={() => openComposite('asm', a)}
                title={a.description}
              >
                <span class="dot"></span>
                <span class="pl-name">{a.name}</span>
              </button>
            {/each}
          </div>
        {/each}
        {#if filt.length === 0}<div class="sb-empty">No assemblies match "{filter}".</div>{/if}
      {/if}
      {#if sidebarTab === 'xml_primitive'}
        <!-- Single-file primitives — auto-discovered from src/lib/components/runes
             via import.meta.glob. The "+ New" button at the top creates a
             new file via /api/runes/save (create:true). Vite HMR picks up
             the new file and adds it to the list automatically. -->
        <button
          class="sb-add"
          type="button"
          onclick={() => (newPrimForm = newPrimForm ? null : { open: true, id: '', name: '', error: '', saving: false })}
          title="Create a new primitive"
        >+ New primitive</button>

        {#if newPrimForm?.open}
          <div class="param-form">
            <div class="pf-row">
              <label>ID<input class="pf-in" type="text" placeholder="e.g. gear_box" bind:value={newPrimForm.id} /></label>
            </div>
            <div class="pf-row">
              <label>Name<input class="pf-in" type="text" placeholder="Display name" bind:value={newPrimForm.name} /></label>
            </div>
            {#if newPrimForm.error}<p class="pf-err">{newPrimForm.error}</p>{/if}
            <div class="pf-actions">
              <button class="save-btn" type="button" disabled={newPrimForm.saving} onclick={createNewPrimitive}>
                {newPrimForm.saving ? 'Creating…' : 'Create'}
              </button>
              <button class="discard-btn" type="button" onclick={() => (newPrimForm = null)}>Cancel</button>
            </div>
          </div>
        {/if}

        <div class="sb-list">
          {#each runesList.filter((r) => !filter || r.meta.name.toLowerCase().includes(filter.toLowerCase()) || r.meta.id.toLowerCase().includes(filter.toLowerCase())) as entry (entry.meta.id)}
            <div class="prim-row" class:active={activeTab?.id === `xml:${entry.meta.id}`}>
              <button
                class="prim-link"
                class:active={activeTab?.id === `xml:${entry.meta.id}`}
                onclick={() => openRunes(entry)}
                title={entry.meta.name}
              >
                <span class="dot"></span>
                <span class="pl-name">{entry.meta.name}</span>
              </button>
              <button
                class="prim-del"
                type="button"
                title={`Delete ${entry.meta.name}`}
                aria-label={`Delete ${entry.meta.name}`}
                onclick={(e) => { e.stopPropagation(); deleteRunes(entry); }}
              ></button>
            </div>
          {/each}
        </div>
      {/if}
      {#if sidebarTab === 'kb'}
        <!-- KB list — driven by /kb/index.json. Each row is a card-link
             with the same prim-link styling; hover surfaces the rich
             callout. Click opens the KB as a tab in the main tab bar. -->
        {#if kbListError}
          <div class="sb-empty">{kbListError}</div>
        {:else if kbList.length === 0}
          <div class="sb-empty">No KBs registered.</div>
        {:else}
          <div class="sb-list">
            {#each kbList.filter((k) => !filter || k.title.toLowerCase().includes(filter.toLowerCase()) || (k.categories ?? []).some((c) => c.toLowerCase().includes(filter.toLowerCase()))) as kb (kb.id)}
              <button
                class="prim-link"
                class:active={activeTab?.id === `kb:${kb.id}`}
                onclick={() => openKb(kb)}
                onmouseenter={(e) => onHoverKb(kb.id, e)}
                onmouseleave={onLeaveKb}
                onfocus={(e) => onHoverKb(kb.id, e as unknown as MouseEvent)}
                onblur={onLeaveKb}
              >
                <span class="dot"></span>
                <span class="pl-name">{kb.title}</span>
                <span class="prim-kid-count">{kb.row_count.toLocaleString()}</span>
              </button>
            {/each}
          </div>
        {/if}
      {/if}
      {#each TREE as f (f.id)}
        {#if f.id === sidebarTab && f.id !== 'kb' && f.id !== 'components' && f.id !== 'assemblies' && f.id !== 'xml_primitive'}
          {@const items = itemsInFolder(f).filter(matchesFilter)}
          {@const subClaims = (f.sub ?? []).flatMap((sf) => itemsInFolder(sf))}
          {@const leafItems = items.filter((c) => !subClaims.includes(c) && isTopLevel(c, items))}
          <!-- + New button at the top of the list (was at the bottom). -->
          <button class="sb-add" onclick={() => openNewDraft(f)} title="New primitive in {f.name}">
            + New {f.name.toLowerCase().replace(/s$/, '')}
          </button>
          <!-- Direct leaves of the active tab, if any. -->
          {#if leafItems.length > 0}
            <div class="sb-list">
              {#each leafItems as c (c.id)}
                {@render primItem(c, items, 0)}
              {/each}
            </div>
          {/if}
          <!-- Sub-folder groups (e.g. Compounds → API tubular / Drill string)
               render as inline section headers, still flat. -->
          {#if f.sub}
            {#each f.sub as sub (sub.id)}
              {@const subItems = itemsInFolder(sub).filter(matchesFilter)}
              {@const subTop = subItems.filter((c) => isTopLevel(c, subItems))}
              {#if subTop.length > 0}
                <div class="sb-subhead">{sub.name}</div>
                <div class="sb-list">
                  {#each subTop as c (c.id)}
                    {@render primItem(c, subItems, 0)}
                  {/each}
                </div>
              {/if}
            {/each}
          {/if}
          {#if leafItems.length === 0 && (f.sub ?? []).every((sf) => itemsInFolder(sf).filter(matchesFilter).length === 0)}
            <div class="sb-empty">No primitives match "{filter}".</div>
          {/if}

          <!-- Compositions tab also lists tier=2 entries from COMPONENTS_L3
               (tubing joints, LatchRite window, etc.) — single-part items
               assembled from primitives, opened as composite tabs. -->
          {#if f.id === 'compositions'}
            {@const l2 = COMPONENTS_L3.filter((c) => c.tier === 2 && (!filter || c.name.toLowerCase().includes(filter.toLowerCase()) || c.tags.some((t) => t.toLowerCase().includes(filter.toLowerCase()))))}
            {@const l2groups = Array.from(new Set(l2.map((c) => c.group ?? 'Other')))}
            {#each l2groups as g (g)}
              <div class="sb-subhead">{g}</div>
              <div class="sb-list">
                {#each l2.filter((c) => (c.group ?? 'Other') === g) as c (c.id)}
                  <button
                    class="prim-link"
                    class:active={activeTab?.id === `comp:${c.id}`}
                    onclick={() => openComposite('comp', c)}
                    title={c.description}
                  >
                    <span class="dot"></span>
                    <span class="pl-name">{c.name}</span>
                  </button>
                {/each}
              </div>
            {/each}
          {/if}
        {/if}
      {/each}
    </div>
    </div>
  </aside>

  <!-- Drag handle — sits between the sidebar and the rest of the layout.
       Mousedown anywhere on it starts a drag that resizes the sidebar. -->
  <div
    class="sidebar-resizer"
    class:dragging={sidebarDragging}
    role="separator"
    aria-orientation="vertical"
    aria-label="Resize sidebar"
    onmousedown={startSidebarDrag}
  ></div>

  <!-- Hover callout — replaces the old cards grid. Pops out to the right
       of the sidebar when an item is hovered/focused; shows the same
       thumbnail + name + id + tags + description the card used to. -->
  {#if hoveredKb}
    <div class="callout" style="top: {hoverKbTop}px;">
      <div class="cl-thumb kb-thumb"><span>KB</span></div>
      <div class="cl-body">
        <div class="cl-hdr">
          <span class="cl-name">{hoveredKb.title}</span>
          <span class="cl-id">{hoveredKb.id}</span>
        </div>
        <div class="cl-badges">
          <span class="badge cat">{hoveredKb.row_count.toLocaleString()} rows</span>
          {#if hoveredKb.source_kind}<span class="badge cat">{hoveredKb.source_kind.replace(/_/g, ' ')}</span>{/if}
        </div>
        {#if hoveredKb.description}<p class="cl-desc">{hoveredKb.description}</p>{/if}
        {#if hoveredKb.categories?.length}
          <div class="cl-tags">
            {#each hoveredKb.categories as t}<span class="tag">{t}</span>{/each}
          </div>
        {/if}
      </div>
    </div>
  {/if}
  {#if hoveredDef}
    {@const compound = isCompound(hoveredDef)}
    <div class="callout" style="top: {hoverTop}px;">
      <div class="cl-thumb">
        <img
          src={imgSrc(hoveredDef.id)}
          alt={hoveredDef.name}
          loading="lazy"
          onerror={(e) => { (e.currentTarget as HTMLElement).style.display = 'none'; }}
        />
      </div>
      <div class="cl-body">
        <div class="cl-hdr">
          <span class="cl-name">{hoveredDef.name}</span>
          <span class="cl-id">{hoveredDef.id}</span>
        </div>
        <div class="cl-badges">
          <span class="badge cat">{hoveredDef.category}</span>
          {#if compound}<span class="badge compound-tag">compound</span>{/if}
          {#if PIPE_PRIMS.has(hoveredDef.id)}<span class="badge pipe">pipe</span>{/if}
        </div>
        {#if hoveredDef.description}
          <p class="cl-desc">{hoveredDef.description}</p>
        {/if}
        {#if hoveredDef.tags?.length}
          <div class="cl-tags">
            {#each hoveredDef.tags.slice(0, 6) as t}<span class="tag">{t}</span>{/each}
          </div>
        {/if}
      </div>
    </div>
  {/if}

  <main class="content">
    <!-- Tab bar — mirrors SVTC's SimpleTabs top bar. -->
    <div class="tab-bar">
      {#each openTabs as tab (tab.id)}
        {@const compound = isCompound({ id: tab.primId, category: COMPONENTS.find((c) => c.id === tab.primId)?.category ?? '' })}
        <button
          class="tab"
          class:active={tab.id === activeTabId}
          class:compound
          onclick={() => setActive(tab.id)}
          title={tab.label}
          type="button"
        >
          {#if tab.draft}<span class="dirty">●</span>{/if}
          <span class="tab-label">{tab.label}</span>
          <span
            class="tab-x"
            role="button"
            tabindex="0"
            aria-label="Close {tab.label}"
            onclick={(e) => closeTab(tab.id, e)}
            onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); closeTab(tab.id); } }}
          >×</span>
        </button>
      {/each}
      {#if openTabs.length === 0}
        <div class="tab-bar-empty">No tabs open · pick a primitive from the sidebar</div>
      {/if}
    </div>

    <!-- KB tab body — embedded table viewer. Skips the primitive editor. -->
    {#if activeTab && activeTab.kind === 'kb' && activeTab.kbId}
      <div class="tab-body kb-tab">
        <KbTableViewer
          kbId={activeTab.kbId}
          rowAction={activeTab.kbId === 'casing-tubing-data'
            ? { icon: '▶', title: 'Preview as tubing component', onAction: openTubingFromKbRow }
            : null}
        />
      </div>
    {:else if activeTab && activeDef}
      {@const compound = isCompound(activeDef)}
      <div
        class="tab-body"
        class:dock-right={showInspector && inspectorDocked}
        class:resizing-dock={inspectorDocDragging}
        style={showInspector && inspectorDocked ? `grid-template-columns: 42px 1fr ${inspectorDocWidth}px;` : ''}
      >
        <!-- Left toolbar — primitive actions + popups for preview/script.
             Composite tabs (level-3 components, level-4 assemblies) hide
             Params + Reset since params are baked into each part's spec
             and aren't editable from a single popup. -->
        <div class="toolbar">
          <!-- Single Inspector toggle. Replaces the old four-button row
               (Params / Svelte / Script / MD) — the popup's internal tab
               strip handles navigation between views. Icon is the Svelte
               atom for runes-class tabs; falls back to the script glyph
               for legacy primitives that have no Svelte source. -->
          <button
            class="tb-btn"
            type="button"
            class:on={showInspector}
            onclick={() => (showInspector = !showInspector)}
            title="Toggle Inspector"
          >
            <span class="tb-ic">{activeTab.kind === 'xml-primitive' ? '⚛' : '</>'}</span>
          </button>
          {#if isParamTab}
            <button class="tb-btn" type="button" onclick={() => resetParams(activeTab!)} title="Reset to defaults">
              <span class="tb-ic">↺</span>
            </button>
          {/if}
          <button class="tb-btn" type="button" onclick={() => copyId(activeTab!)} title="Copy primitive id">
            <span class="tb-ic">⎘</span>
          </button>
          <button class="tb-btn" type="button" onclick={() => closeTab(activeTab!.id)} title="Close tab">
            <span class="tb-ic">×</span>
          </button>
          <!-- Spacer pushes Save to the bottom of the toolbar so it reads
               as the terminal action without needing extra divider markup. -->
          <span class="tb-spacer"></span>
          <button class="tb-btn save" type="button" title="Save (placeholder — not yet wired)" aria-disabled="true">
            <span class="tb-ic">💾</span>
          </button>
        </div>

        <!-- Center — the preview IS the page. Params + script come up as
             popups via the toolbar so the rendered shape stays dominant. -->
        <div class="stage">
          <header class="stage-hdr">
            <div class="stage-title">
              <h2 class="stage-name">{activeDef.name}</h2>
              <span class="stage-id">{activeDef.id}</span>
            </div>
            <div class="stage-badges">
              <span class="badge cat">{activeDef.category}</span>
              {#if compound}<span class="badge compound-tag">compound — to be decomposed</span>{/if}
              {#if PIPE_PRIMS.has(activeDef.id)}<span class="badge pipe">pipe</span>{/if}
              {#if activeTab.draft}<span class="badge draft-tag">draft</span>{/if}
              {#if activeTab.kind === 'xml-primitive'}<span class="badge pipe">runes-class</span>{/if}
            </div>
          </header>

          {#if activeDef.description}
            <p class="stage-desc">{activeDef.description}</p>
          {/if}

          <div class="stage-3d">
            {#if SceneComponent && geo}
              <Canvas {createRenderer}>
                {@const Scene = SceneComponent}
                <Scene {geo} {geoVersion} {showCutaway} {showEdges} />
              </Canvas>
              {#if SceneControls}
                {@const Controls = SceneControls}
                <Controls />
              {/if}
              {#if buildError}
                <!-- Last-good mesh stays mounted so the user keeps visual
                     context. Small chip in the corner flags that the
                     geometry is stale until the error is fixed; the full
                     message lives in the Svelte editor's error strip. -->
                <div class="stage-stale" title={buildError}>
                  <span class="stage-stale-icon">⚠</span>
                  geometry stale — see editor
                </div>
              {/if}
            {:else}
              <div class="stage-loading">
                {#if isParamTab}
                  <img
                    class="stage-fallback"
                    src={imgSrc(activeTab.primId)}
                    alt={activeDef.name}
                    loading="lazy"
                    onerror={(e) => { (e.currentTarget as HTMLElement).style.display = 'none'; }}
                  />
                {/if}
                <span class="stage-loading-text">
                  {#if buildError}
                    error · see editor
                  {:else if ready}
                    Building…
                  {:else}
                    Loading scene…
                  {/if}
                </span>
              </div>
            {/if}
          </div>

          <div class="stage-controls">
            <label><input type="checkbox" bind:checked={showCutaway} /> Cross-section</label>
            <label><input type="checkbox" bind:checked={showEdges} /> Edges</label>
            <span class="stage-hint">
              {#if isParamTab}
                <button class="inline-btn" type="button" onclick={() => openInspector('params')}>Params</button>
                ·
              {/if}
              <button class="inline-btn" type="button" onclick={() => openInspector('script')}>Script</button>
              {#if activeTab.kind === 'xml-primitive'}
                · <button class="inline-btn" type="button" onclick={() => openInspector('md')}>Docs</button>
              {/if}
            </span>
          </div>
        </div>

      <!-- Floating popups — params + builder script. Nested INSIDE
           .tab-body so containerRelative anchors them to the tab area
           rather than to the viewport (which would overlap the sidebar). -->
      {#if showInspector && inspectorDocked}
        <!-- Drag handle for the docked Inspector's left edge. Bound to
             inspectorDocWidth via startDockResize; clamps in handler. -->
        <div
          class="dock-resize"
          style={`right: ${inspectorDocWidth}px;`}
          onmousedown={startDockResize}
          role="separator"
          aria-label="Resize inspector"
        ></div>
      {/if}
      <!-- Single Inspector popup — replaces the previous Params + Script
           floating panels. One panel per tab, with a tab strip across the
           top that switches between Params, Svelte source (xml-primitive
           only), Compiled script, and auto-generated MD docs (xml-primitive
           only). Toolbar buttons jump to specific tabs without forcing the
           user to find them inside the popup. -->
      <FloatingPanel
        title="Inspector · {activeDef.name}"
        visible={showInspector}
        onClose={() => (showInspector = false)}
        containerRelative
        docked={inspectorDocked}
        onToggleDock={() => (inspectorDocked = !inspectorDocked)}
        x={50} y={8}
        width="min(680px, calc(100% - 80px))"
        maxHeight="calc(100% - 16px)"
      >
        <!-- Tags pinned above the tab strip — always visible regardless of
             which inspector tab is active, so the primitive's classification
             stays in view while editing params / source / docs. -->
        {#if activeDef.tags?.length}
          <div class="insp-tags">
            {#each activeDef.tags as t}<span class="tag">{t}</span>{/each}
          </div>
        {/if}

        <div class="insp-tabs">
          {#if activeTab.kind === 'xml-primitive'}
            <!-- Runes primitives: tab order is Parts → Params → Svelte → MD.
                 Parts is leftmost (and the default selection) so the
                 module-library is the first thing the user sees on open. -->
            <button class="insp-tab" class:active={inspectorTab === 'parts'} type="button" onclick={() => (inspectorTab = 'parts')}>
              <span class="ic">⊞</span> Parts
            </button>
          {/if}
          {#if isParamTab}
            <button class="insp-tab" class:active={inspectorTab === 'params'} type="button" onclick={() => (inspectorTab = 'params')}>
              <span class="ic">⚙</span> Params
            </button>
          {/if}
          {#if activeTab.kind === 'xml-primitive'}
            <button class="insp-tab" class:active={inspectorTab === 'svelte'} type="button" onclick={() => (inspectorTab = 'svelte')}>
              <span class="ic">⚛</span> Svelte
            </button>
            <button class="insp-tab" class:active={inspectorTab === 'md'} type="button" onclick={() => (inspectorTab = 'md')}>
              <span class="ic">📖</span> MD
            </button>
          {:else}
            <!-- Legacy primitives: Script tab extracts from builder.ts. -->
            <button class="insp-tab" class:active={inspectorTab === 'script'} type="button" onclick={() => (inspectorTab = 'script')}>
              <span class="ic">{'</>'}</span> Script
            </button>
          {/if}
        </div>

        {#if inspectorTab === 'params' && isParamTab}
          {@const allDefs = (activeTab.runesEntry?.meta.params ?? activeDef.params) as Readonly<Record<string, ParamSchema & { group?: string }>>}
          {@const groups = paramGroupsOf(allDefs)}
          {@const showGroupTabs = groups.length > 1}
          {@const activeGroup = showGroupTabs ? (selectedParamGroup && groups.includes(selectedParamGroup) ? selectedParamGroup : groups[0]) : null}
          <div class="ed-sec">
            <div class="ed-sec-h">
              Parameters <span class="muted">{Object.keys(activeTab.params).length}</span>
              {#if activeTab.kind === 'xml-primitive'}
                <button class="add-param-plus" type="button" onclick={() => openParamForm(activeTab!)} title="Add a parameter">+</button>
              {:else if activeTab.draft}
                <button class="row-add" type="button" onclick={() => addParam(activeTab!)} title="Add a draft parameter">+ param</button>
              {/if}
            </div>

            {#if activeTab.paramForm?.open}
              {@const f = activeTab.paramForm}
              <div class="param-form">
                <div class="pf-row">
                  <label>Name<input class="pf-in" type="text" placeholder="e.g. threadCount" bind:value={f.name} /></label>
                  <label>Label<input class="pf-in" type="text" placeholder="display label" bind:value={f.label} /></label>
                </div>
                <div class="pf-row">
                  <label>Type
                    <select class="pf-in" bind:value={f.type}>
                      <option value="numeric">numeric</option>
                      <option value="shape">shape (round / flat)</option>
                      <option value="thread">thread (API / NPT / …)</option>
                      <option value="custom">custom</option>
                    </select>
                  </label>
                  <label>Unit<input class="pf-in" type="text" placeholder="in, mm, lb…" bind:value={f.unit} /></label>
                  <label>Default<input class="pf-in" type="number" bind:value={f.defaultValue} /></label>
                </div>
                {#if f.type === 'numeric'}
                  <div class="pf-row">
                    <label>Min<input class="pf-in" type="number" bind:value={f.min} /></label>
                    <label>Max<input class="pf-in" type="number" bind:value={f.max} /></label>
                    <label>Step<input class="pf-in" type="number" bind:value={f.step} /></label>
                  </div>
                {:else}
                  <p class="pf-note">Non-numeric types are stored as metadata for now; their default value still drives the slider until type-specific controls land.</p>
                {/if}
                {#if f.error}<p class="pf-err">{f.error}</p>{/if}
                <div class="pf-actions">
                  <button class="save-btn" type="button" onclick={() => submitParamForm(activeTab!)}>Add</button>
                  <button class="discard-btn" type="button" onclick={() => closeParamForm(activeTab!)}>Cancel</button>
                  <span class="pf-hint">Adds to this tab and to the source draft. Save in the Svelte tab to persist.</span>
                </div>
              </div>
            {/if}
            <!-- Param-group sub-tabs. When the primitive's params declare a
                 `group` field (e.g. box_conn → "Body" / "Cone"), we render
                 each group as its own tab inside this section. When ALL
                 params share the same group (or no group is set), no tab
                 strip renders — the grid behaves as before. allDefs /
                 groups / activeGroup are hoisted to the parent {#if} above
                 (Svelte 5 requires {@const} as direct child of a block). -->
            {#if showGroupTabs}
              <div class="pg-tabs">
                {#each groups as g (g)}
                  <button
                    class="pg-tab"
                    class:active={activeGroup === g}
                    type="button"
                    onclick={() => (selectedParamGroup = g)}
                  >{g === '__default__' ? 'General' : g}</button>
                {/each}
              </div>
            {/if}
            <!-- Grid of param cards. Each card has label · slider · number
                 inline. When group-tabs are active, only the params matching
                 the selected group render. -->
            <div class="pr-grid">
              {#each Object.keys(activeTab.params).filter((k) => !showGroupTabs || (allDefs[k]?.group ?? '__default__') === activeGroup) as key (key)}
                {@const def = paramDef(activeDef, key)}
                {@const isExtra = !(key in activeDef.params)}
                <div class="pr-card" class:extra={isExtra}>
                  <span class="pr-lbl" title={def.label}>{def.label}{def.unit ? ` (${def.unit})` : ''}{isExtra ? '*' : ''}</span>
                  <input class="pr-range" type="range" min={def.min} max={def.max} step={def.step} bind:value={activeTab.params[key]} />
                  <input class="pr-num" type="number" step={def.step} bind:value={activeTab.params[key]} />
                  {#if activeTab.draft}
                    <button class="row-x" type="button" onclick={() => removeParam(activeTab!, key)} title="Remove parameter" aria-label="Remove parameter">×</button>
                  {/if}
                </div>
              {/each}
            </div>
          </div>

          {#if activeTab.kind === 'xml-primitive' && activeTab.runesEntry?.meta.derived}
            {@const derivedMeta = activeTab.runesEntry.meta.derived}
            {@const resolved = resolveDerivedSafe(derivedMeta, activeTab.params)}
            <div class="ed-sec">
              <div class="ed-sec-h">
                Derived <span class="muted">{Object.keys(derivedMeta).length} · read-only</span>
              </div>
              <div class="pr-grid">
                {#each Object.entries(derivedMeta) as [key, schema] (key)}
                  <div class="pr-card derived" title={`Computed: ${schema.label}`}>
                    <span class="pr-lbl">{schema.label}{schema.unit ? ` (${schema.unit})` : ''}</span>
                    <span class="pr-derived-spacer"></span>
                    <span class="pr-derived-val">{fmtDerived(resolved[key])}</span>
                  </div>
                {/each}
              </div>
            </div>
          {/if}
        {:else if inspectorTab === 'svelte' && activeTab.kind === 'xml-primitive' && activeTab.runesEntry}
          {@const entry = activeTab.runesEntry}
          {@const m = entry.meta}
          {@const dirty = activeTab.sourceDraft != null && activeTab.sourceDraft !== entry.source}
          {@const paramCount = Object.keys(m.params).length}
          {@const validateErrs = m.validate ? m.validate(activeTab.params) : []}
          <div class="anatomy svelte">
            <span class="ana-chip kind">{m.id}</span>
            <span class="ana-chip">params · {paramCount}</span>
            {#if m.validate}
              <span class="ana-chip" class:ok={validateErrs.length === 0} class:err={validateErrs.length > 0}>
                {validateErrs.length === 0 ? 'validate ✓' : `validate ✗ (${validateErrs.length})`}
              </span>
            {/if}
          </div>
          {@const editorSource = activeTab.sourceDraft ?? entry.source}
          {@const defaultFolds = runesDefaultFolds(editorSource)}
          <div class="editor-wrap">
            <CodeEditor
              value={editorSource}
              lang="typescript"
              variant="svelte"
              readonly={false}
              initialFold={defaultFolds}
              onChange={(next) => { if (activeTab) activeTab.sourceDraft = next; }}
            />
          </div>
          {#if buildError}
            {@const err = formatBuildError(buildError)}
            <!-- Inline error strip — surfaces the latest geom() exception
                 in-place under the editor. The 3D stage keeps the LAST
                 GOOD mesh mounted; only this strip + the corner chip on
                 the stage flag the error. Click × to dismiss until the
                 next throw. Long messages (e.g. Manifold stringifying a
                 function body) get pre-formatted by formatBuildError to a
                 short summary + hint. -->
            <div class="ed-error" role="status">
              <span class="ed-err-icon">⚠</span>
              <div class="ed-err-body">
                <div class="ed-err-msg">{err?.msg}</div>
                {#if err?.hint}
                  <div class="ed-err-hint">{err.hint}</div>
                {/if}
              </div>
              <button class="ed-err-clear" type="button" onclick={() => (buildError = null)} aria-label="Dismiss error">×</button>
            </div>
          {/if}
          <div class="save-row">
            <button class="save-btn" type="button" disabled={!dirty || activeTab.saveStatus === 'saving'} onclick={() => saveRunesSource(activeTab!)}>
              {activeTab.saveStatus === 'saving' ? 'Saving…' : 'Save to disk'}
            </button>
            <button class="discard-btn" type="button" disabled={!dirty} onclick={() => discardRunesDraft(activeTab!)}>Discard</button>
            {#if activeTab.saveStatus === 'saved'}
              <span class="save-status ok">Saved · Vite HMR will reload the page</span>
            {:else if activeTab.saveStatus === 'error'}
              <span class="save-status err">Error: {activeTab.saveError}</span>
            {:else if dirty}
              <span class="save-status muted">Unsaved changes</span>
            {/if}
          </div>
          <p class="code-note">Source: <code>src/lib/components/runes/{m.id}.ts</code>.
            Save writes the file; Vite HMR picks up the change and reloads with the new geometry.</p>
        {:else if inspectorTab === 'script' && activeTab.kind !== 'xml-primitive'}
          <div class="ed-sec">
            <div class="ed-sec-h">
              Variables <span class="muted">{activeTab.vars.length}</span>
              <button class="row-add" type="button" onclick={() => addVar(activeTab!)} title="Add a variable">+ var</button>
            </div>
            {#if activeTab.vars.length === 0}
              <p class="vars-empty">No variables yet — click <strong>+ var</strong> to add one. They will appear as <code>const &lt;name&gt; = &lt;expr&gt;;</code> at the top of the script below.</p>
            {/if}
            {#each activeTab.vars as v, i (i)}
              <div class="var-row">
                <input class="var-name" type="text" bind:value={activeTab.vars[i].name} placeholder="name" />
                <span class="eq">=</span>
                <input class="var-expr" type="text" bind:value={activeTab.vars[i].expr} placeholder="expression" />
                <button class="row-x" type="button" onclick={() => removeVar(activeTab!, i)} aria-label="Remove variable">×</button>
              </div>
            {/each}
          </div>
          <div class="ed-sec">
            <div class="ed-sec-h">Builder script</div>
            <div class="editor-wrap"><CodeEditor value={builderText} lang="javascript" readonly /></div>
            <p class="code-note">Builder body is read-only — the project disallows dynamic eval (see CLAUDE.md).</p>
          </div>
        {:else if inspectorTab === 'parts' && activeTab.kind === 'xml-primitive' && activeTab.runesEntry}
          {@const selfId = activeTab.runesEntry.meta.id}
          {@const curSrc = activeTab.sourceDraft ?? activeTab.runesEntry.source}
          {@const imported = importedFromSource(curSrc)}
          {@const usedHelpers = HELPERS.filter((h) => imported.helpers.has(h.name))}
          {@const usedRunes = runesList.filter((r) => imported.runes.has(r.meta.id))}
          {@const availableHelpers = HELPERS.filter((h) => !imported.helpers.has(h.name))}
          {@const availableRunes = runesList.filter((r) => r.meta.id !== selfId && !imported.runes.has(r.meta.id))}
          {@const usedCount = usedHelpers.length + usedRunes.length}
          {@const availableCount = availableHelpers.length + availableRunes.length}
          <div class="parts-pane">
            <p class="parts-intro">
              The physical objects this primitive composes — each card is a shape that yields a
              Manifold (cyl/tube from the helpers, plus any other runes). Transforms like <code>mv</code>
              and <code>rot</code> aren't here; write those directly in the Svelte code.
              Click <strong>×</strong> to drop an import; click <strong>+ Add primitive</strong> for more.
            </p>

            <div class="parts-group">
              <div class="parts-h">
                Primitives <span class="muted">in use · {usedCount}</span>
              </div>
              {#if usedCount === 0}
                <div class="parts-empty">No primitives imported yet.</div>
              {:else}
                <div class="parts-grid">
                  {#each usedHelpers as h (`h:${h.name}`)}
                    <div class="part-card used" title={h.desc}>
                      <button class="part-x" type="button" aria-label={`Remove ${h.name}`} title={`Remove ${h.name}`} onclick={() => removeHelper(h.name)}>×</button>
                      <span class="part-name">{h.name}</span>
                      <span class="part-sig">{h.sig}</span>
                      <span class="part-desc">{h.desc}</span>
                    </div>
                  {/each}
                  {#each usedRunes as p (`r:${p.meta.id}`)}
                    <div class="part-card used" title={`Composed: ${p.meta.name}`}>
                      <button class="part-x" type="button" aria-label={`Remove ${p.meta.name}`} title={`Remove ${p.meta.name}`} onclick={() => removeRunes(p.meta.id)}>×</button>
                      <span class="part-name">{p.meta.name}</span>
                      <span class="part-sig">geom({Object.keys(p.meta.params).join(', ')})</span>
                      <span class="part-desc">{p.meta.description ?? ''}</span>
                    </div>
                  {/each}
                </div>
              {/if}
              {#if availableCount > 0}
                <button class="parts-add-btn" type="button" onclick={() => (partsAddHelperOpen = !partsAddHelperOpen)}>
                  {partsAddHelperOpen ? '− Hide catalog' : '+ Add primitive'}
                </button>
                {#if partsAddHelperOpen}
                  <div class="parts-picker">
                    {#each availableHelpers as h (`h:${h.name}`)}
                      <button class="part-pick" type="button" title={h.desc} onclick={() => { insertHelperSnippet(h.name); partsAddHelperOpen = false; }}>
                        <span class="part-name">{h.name}</span>
                        <span class="part-sig">{h.sig}</span>
                      </button>
                    {/each}
                    {#each availableRunes as p (`r:${p.meta.id}`)}
                      <button class="part-pick" type="button" title={`Compose ${p.meta.name}`} onclick={() => { insertRunesSnippet(p); partsAddHelperOpen = false; }}>
                        <span class="part-name">{p.meta.name}</span>
                        <span class="part-sig">geom({Object.keys(p.meta.params).join(', ')})</span>
                      </button>
                    {/each}
                  </div>
                {/if}
              {/if}
            </div>
          </div>
        {:else if inspectorTab === 'md' && activeTab.kind === 'xml-primitive' && activeTab.runesEntry}
          {@const docs = generateMd(activeTab.runesEntry, activeTab.params)}
          <div class="md-wrap">
            <MarkdownView value={docs} />
          </div>
          <p class="code-note">Auto-generated from the primitive's <code>meta</code> — params, tags, validate state. Edit the runes file (Svelte tab) to update.</p>
        {/if}
      </FloatingPanel>
      </div>
    {:else}
      <div class="empty">
        <h1>Primitives</h1>
        <p>
          {COMPONENTS.length} base shapes grouped into <strong>Primitives</strong> (true atoms),
          <strong>Compounds</strong> (small assemblies — temporary stand-ins), <strong>Features</strong>,
          and <strong>Mechanical</strong>. Click any entry in the sidebar to open it as a tab; click
          <strong>+</strong> on a folder header to start a new draft in that folder.
        </p>
        <p class="hint">Tabs persist for the session. Editing here doesn't save — use the toolbar's
          <strong>Author →</strong> button to carry params into <code>/author</code>.</p>
      </div>
    {/if}
  </main>
</div>

<style>
  .layout {
    display: flex; flex-direction: row;
    height: 100%; overflow: hidden;
    font-family: Arial, sans-serif;
  }

  /* ── Sidebar ──────────────────────────────────────────────────────────── */
  .sidebar {
    /* Width is bound from script — defaults to 200px, drag the resizer
       to grow / shrink. flex-shrink: 0 keeps the inline width sticky. */
    width: 200px; flex-shrink: 0;
    background: #f7f7f9;
    /* Border now lives on the resizer so dragging feels continuous. */
    display: flex; flex-direction: column;
    overflow: hidden;
  }
  /* 4px thin handle between sidebar and content. Cursor is ew-resize on
     hover; expands its visual hit-area into a 1px line so it doesn't
     feel like a chunky bar at rest. */
  .sidebar-resizer {
    flex: 0 0 4px;
    cursor: ew-resize;
    background: #e2e2e8;
    transition: background 100ms;
  }
  .sidebar-resizer:hover, .sidebar-resizer.dragging { background: #cc2222; }
  .sb-hdr {
    padding: 14px 14px 12px;
    background: linear-gradient(135deg, #1f2329 0%, #2b2f36 55%, #3a3f47 100%);
    color: #fff;
    border-bottom: 2px solid #cc2222;
    display: flex; align-items: center; gap: 10px;
    box-shadow: inset 0 -1px 0 rgba(255,255,255,0.06);
  }
  .sb-hdr-mark {
    color: #cc2222;
    font-size: 14px; line-height: 1;
    text-shadow: 0 0 12px rgba(204,34,34,0.6);
  }
  .sb-hdr-text {
    font: 900 13px Arial, sans-serif;
    text-transform: uppercase;
    letter-spacing: 4px;
    background: linear-gradient(90deg, #fff 0%, #cc2222 100%);
    -webkit-background-clip: text; background-clip: text;
    color: transparent;
    -webkit-text-stroke: 0.4px rgba(255,255,255,0.15);
  }
  /* Two-column split inside the sidebar: vertical tab rail on the left,
     flat primitive list on the right. */
  .sb-split {
    flex: 1; min-height: 0;
    display: grid;
    /* Widened from 28px → 40px so the rotated tab labels keep their
       breathing room even when the scrollbar appears (6 tabs × 120px
       overflows on shorter viewports and the scrollbar would otherwise
       eat into the wedge content). */
    grid-template-columns: 40px 1fr;
    overflow: hidden;
  }
  /* Vertical tab rail — text is rotated so each tab reads bottom-to-top.
     Each tab is a slim wedge (angled top/bottom edges) pointing into the
     list area. Clean, vertical, more visual than horizontal labels. */
  .sb-rail {
    background: #efeff3;
    border-right: 1px solid #e2e2e8;
    display: flex; flex-direction: column;
    padding: 0; gap: 0;
    overflow-y: auto;
    /* Reserve a fixed-width gutter for the scrollbar so its appearance
       doesn't shift the wedges horizontally. Combined with the thinner
       scrollbar styling below, the labels stay centered with the
       scrollbar or without it. */
    scrollbar-gutter: stable;
    scrollbar-width: thin;
    scrollbar-color: #c4c4cc transparent;
  }
  .sb-rail::-webkit-scrollbar { width: 6px; }
  .sb-rail::-webkit-scrollbar-thumb { background: #c4c4cc; border-radius: 3px; }
  .sb-rail::-webkit-scrollbar-track { background: transparent; }
  .sb-tab {
    background: #e6e6ec; border: 1px solid #d8d8de;
    color: #666;
    cursor: pointer;
    /* More vertical padding so the rotated label has breathing room at
       the top and bottom of each wedge — previously the longer labels
       (e.g. "XML Primitive") visually crowded the chevron edges. */
    padding: 18px 1px;
    width: 100%; min-height: 120px;
    display: flex; flex-direction: column-reverse;
    align-items: center; justify-content: center; gap: 6px;
    /* Wedge: square left edge against rail, angled right edge pointing
       outward toward the list when active. */
    clip-path: polygon(0 8px, 100% 0, 100% 100%, 0 calc(100% - 8px));
    transition: background 100ms, color 100ms;
  }
  .sb-tab:hover { background: #fff; color: #cc2222; }
  .sb-tab.active {
    background: #cc2222; color: #fff; border-color: #cc2222;
    /* Active tab juts right into the list, like an SVTC-style chevron. */
    clip-path: polygon(0 8px, 100% 0, 110% 50%, 100% 100%, 0 calc(100% - 8px));
  }
  .sb-tab-name {
    writing-mode: vertical-rl; transform: rotate(180deg);
    font: bold 10px Arial; letter-spacing: 1.5px; text-transform: uppercase;
    white-space: nowrap;
  }
  .sb-tab.compound .sb-tab-name { font-style: italic; }
  .sb-tab-count {
    writing-mode: vertical-rl; transform: rotate(180deg);
    font: bold 9px monospace; color: #aaa;
    background: #fff; border-radius: 6px;
    padding: 2px 2px;
    min-height: 14px; text-align: center;
  }
  .sb-tab.active .sb-tab-count { color: #cc2222; background: rgba(255,255,255,0.9); }
  .sb-body {
    display: flex; flex-direction: column; gap: 4px;
    padding: 8px 8px 12px;
    overflow-y: auto;
  }
  /* Filter input — sits at the top of the list so it's always reachable. */
  .sb-filter {
    position: relative;
    margin-bottom: 6px;
  }
  .sb-filter input {
    width: 100%;
    padding: 5px 22px 5px 8px;
    border: 1px solid #d8d8de; border-radius: 4px;
    background: #fff; color: #333;
    font: 11px Arial;
    box-sizing: border-box;
  }
  .sb-filter input:focus { outline: none; border-color: #cc2222; }
  .sb-filter-x {
    position: absolute; top: 50%; right: 4px;
    transform: translateY(-50%);
    background: transparent; border: none; cursor: pointer;
    color: #999; font: bold 14px Arial; line-height: 1;
    padding: 0 2px;
  }
  .sb-filter-x:hover { color: #cc2222; }
  .sb-empty {
    font: 10px Arial; color: #999;
    padding: 8px 6px;
    text-align: center;
  }
  .sb-list { display: flex; flex-direction: column; gap: 1px; }
  .sb-subhead {
    font: bold 9px Arial; color: #888;
    text-transform: uppercase; letter-spacing: 0.5px;
    margin: 6px 0 2px; padding: 0 4px;
  }
  .sb-add {
    background: #fff; border: 1px dashed #cc2222; cursor: pointer;
    color: #cc2222;
    font: bold 9px Arial; letter-spacing: 0.5px; text-transform: uppercase;
    padding: 4px 8px; border-radius: 4px;
    margin: 0 0 6px;
    text-align: center;
  }
  .sb-add:hover { background: #cc2222; color: #fff; }
  /* Row wraps the caret + the clickable primitive button. Children indent
     via --depth so derived primitives nest under their parent. */
  .prim-row {
    display: flex; align-items: center; gap: 2px;
    padding-left: calc(var(--depth, 0) * 14px);
  }
  .prim-caret, .prim-caret-spacer {
    width: 14px; height: 20px; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
  }
  .prim-caret {
    background: transparent; border: none; cursor: pointer;
    color: #888; font-size: 9px; padding: 0;
  }
  .prim-caret:hover { color: #cc2222; }
  .prim-kid-count {
    font: bold 9px monospace; color: #aaa;
    background: #ececf0; padding: 1px 5px; border-radius: 8px;
    margin-left: auto;
  }
  .prim-link.active .prim-kid-count { color: #fff; background: rgba(255,255,255,0.2); }
  .prim-link {
    flex: 1; min-width: 0;
    background: transparent; border: 1px solid transparent;
    cursor: pointer; font: 11px Arial; color: #555;
    text-align: left;
    display: flex; align-items: center; gap: 6px;
    padding: 3px 8px;
    border-radius: 3px;
  }
  .prim-link.child { font-size: 10px; color: #777; }
  .prim-link.child .dot { background: #d8c878; }
  .prim-link.child.active { color: #fff; }
  .prim-link.child.active .dot { background: #fff; }
  /* Folder treatment — parents with derived children. Bolder name + the
     dot is replaced by a folder glyph so the base class reads as a
     container that holds the derivations. */
  .prim-link.folder { font-weight: bold; color: #333; }
  .prim-link.folder.active { color: #fff; }
  .prim-folder { font-size: 11px; line-height: 1; flex-shrink: 0; }
  .prim-link:hover { background: #ebebef; color: #cc2222; }
  .prim-link.active { background: #cc2222; color: #fff; }
  .prim-link.cursor { outline: 2px solid #cc2222; outline-offset: -2px; }
  .prim-link.compound { border-style: dashed; border-color: #e2c882; }
  .prim-link.compound.active { border-color: #cc2222; }

  /* Runes-row container — wraps the prim-link + a hover-revealed delete
     button. Hover the row, the × appears on the right. */
  .prim-row {
    display: flex; align-items: center; gap: 2px;
    border-radius: 3px;
  }
  .prim-row .prim-link { flex: 1; }
  .prim-del {
    flex-shrink: 0;
    width: 18px; height: 18px;
    display: none; align-items: center; justify-content: center;
    background: transparent; border: none; cursor: pointer;
    font: bold 12px Arial; line-height: 1; color: #aaa;
    border-radius: 3px;
    margin-right: 4px;
  }
  .prim-del::before { content: '×'; }
  .prim-row:hover .prim-del { display: inline-flex; }
  .prim-del:hover { background: #fdecec; color: #cc2222; }
  .prim-row.active .prim-del { color: rgba(255,255,255,0.7); display: inline-flex; }
  .prim-row.active .prim-del:hover { background: rgba(255,255,255,0.2); color: #fff; }

  /* Hover callout — anchored to the right of the sidebar, vertically
     aligned with the hovered item. Replaces the old cards grid: same
     thumbnail + tag info, surfaced on demand. */
  .callout {
    position: fixed; left: 268px; z-index: 30;
    width: 320px;
    background: #fff;
    border: 1px solid #d8d8de; border-radius: 8px;
    box-shadow: 0 8px 28px rgba(0,0,0,0.14);
    display: grid; grid-template-columns: 110px 1fr;
    pointer-events: none;
    overflow: hidden;
  }
  .cl-thumb {
    background: #f8f8fa;
    border-right: 1px solid #ececf0;
    display: flex; align-items: center; justify-content: center;
    padding: 8px;
  }
  .cl-thumb img { max-width: 100%; max-height: 100%; object-fit: contain; }
  .cl-body { padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
  .cl-hdr { display: flex; flex-direction: column; gap: 1px; }
  .cl-name { font: bold 13px Arial; color: #222; }
  .cl-id { font: 10px monospace; color: #888; }
  .cl-badges { display: flex; flex-wrap: wrap; gap: 4px; }
  .cl-desc { font: 11px Arial; color: #555; line-height: 1.5; margin: 0; }
  .cl-tags { display: flex; flex-wrap: wrap; gap: 3px; }
  .cl-tags .tag { font: 9px Arial; color: #555; background: #f0f0f0; padding: 2px 6px; border-radius: 9px; }
  .pl-name { flex: 1; }
  .dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: #cfcfd6; flex-shrink: 0;
  }
  .dot.pipe { background: #cc2222; }
  .prim-link.active .dot { background: #fff; }

  /* ── Main content (tab bar + body) ────────────────────────────────────── */
  .content {
    flex: 1; min-width: 0;
    display: flex; flex-direction: column;
    overflow: hidden;
    background: #fff;
  }

  /* Tab bar — modeled on SVTC SimpleTabs. */
  .tab-bar {
    display: flex; align-items: flex-end;
    background: #2b2f36;
    border-bottom: 1px solid #d8d8de;
    overflow-x: auto;
    flex-shrink: 0;
    min-height: 32px;
  }
  .tab {
    display: flex; align-items: center; gap: 6px;
    padding: 6px 10px;
    background: transparent; color: #d0d0d6;
    border: none; border-right: 1px solid #1f2329;
    font: bold 12px Arial;
    cursor: pointer;
    max-width: 220px; min-width: 0;
    flex-shrink: 0;
  }
  .tab:hover { background: #3a3f47; color: #fff; }
  .tab.active {
    background: #fff; color: #222;
    border-top: 2px solid #cc2222;
    margin-bottom: -1px;
  }
  .tab.compound { font-style: italic; }
  .tab-label {
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    flex: 1; min-width: 0;
  }
  .tab-x {
    width: 16px; height: 16px;
    display: inline-flex; align-items: center; justify-content: center;
    border-radius: 3px; font-size: 14px; line-height: 1;
    color: #aaa;
  }
  .tab.active .tab-x { color: #999; }
  .tab-x:hover { background: rgba(0,0,0,0.08); color: #cc2222; }
  .dirty { color: #ff9a3c; font-size: 10px; line-height: 1; flex-shrink: 0; }
  .tab-bar-empty {
    padding: 8px 14px;
    font: 11px Arial; color: #888;
    align-self: center;
  }

  /* Tab body. Toolbar + single-column stage — params and script live in
     contained floating popups so they overlay the tab without burning
     permanent space. `position: relative` anchors those popups here. */
  .tab-body {
    flex: 1; min-height: 0;
    display: grid;
    grid-template-columns: 42px 1fr;
    overflow: hidden;
    position: relative;
  }
  /* When the Inspector is docked, carve out a third column on the right
     for it (1/3 of the tab body). The FloatingPanel renders into that
     column with its docked styling so the stage shrinks to 2/3 cleanly
     without overlap. */
  .tab-body.dock-right {
    /* Default 3rd column when no inline style overrides — kept as a
       fallback for first-paint before inspectorDocWidth is applied. */
    grid-template-columns: 42px 1fr 456px;
  }
  .tab-body.resizing-dock { user-select: none; cursor: col-resize; }
  /* Drag handle on the left edge of the docked Inspector column. Sits
     inside .tab-body (position: relative) and overlays the boundary. */
  .dock-resize {
    position: absolute;
    top: 0; bottom: 0;
    width: 6px;
    transform: translateX(3px);
    cursor: col-resize;
    z-index: 60;
    background: transparent;
  }
  .dock-resize:hover { background: rgba(204, 34, 34, 0.18); }
  .tab-body.resizing-dock .dock-resize { background: rgba(204, 34, 34, 0.32); }
  .tab-body.kb-tab { grid-template-columns: 1fr; }
  .tab-body.xml-tab {
    grid-template-columns: 1fr;
    padding: 18px 24px 24px;
    overflow-y: auto;
    align-content: start;
  }
  .xml-hdr {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 4px;
  }
  .xml-name { margin: 0 0 2px; font-size: 18px; }
  .xml-id { font-family: var(--mono, ui-monospace, monospace); font-size: 11px; opacity: 0.62; }
  .xml-badges { display: flex; gap: 6px; }
  .xml-desc { font-size: 13px; line-height: 1.5; opacity: 0.85; margin: 8px 0 18px; max-width: 720px; }
  .xml-desc code { font-family: var(--mono, ui-monospace, monospace); font-size: 12px; padding: 0 4px; background: rgba(255,255,255,0.06); border-radius: 3px; }
  .xml-section { margin-bottom: 18px; }
  .xml-section h3 { margin: 0 0 8px; font-size: 13px; opacity: 0.8; text-transform: uppercase; letter-spacing: 0.04em; }
  .xml-tbl { width: 100%; max-width: 720px; border-collapse: collapse; font-size: 12px; font-family: var(--mono, ui-monospace, monospace); }
  .xml-tbl th, .xml-tbl td { text-align: left; padding: 4px 10px; border-bottom: 1px solid rgba(255,255,255,0.08); }
  .xml-tbl th { opacity: 0.7; font-weight: 500; }
  .xml-src {
    background: rgba(0,0,0,0.32);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 4px;
    padding: 12px 14px;
    font-family: var(--mono, ui-monospace, monospace);
    font-size: 12px;
    line-height: 1.5;
    overflow-x: auto;
    margin: 0 0 8px;
    white-space: pre;
  }
  .xml-note { font-size: 12px; opacity: 0.7; margin: 4px 0 0; }
  .xml-note code { font-family: var(--mono, ui-monospace, monospace); padding: 0 3px; background: rgba(255,255,255,0.06); border-radius: 3px; }
  .xml-toolbar { position: absolute; top: 8px; right: 10px; gap: 4px; }
  .kb-thumb {
    background: #cc2222 !important;
    color: #fff;
    font: bold 18px Arial; letter-spacing: 2px;
  }
  .kb-thumb span { letter-spacing: 2px; }

  /* Left toolbar — narrow icon-only column. Native title= tooltips appear
     on hover; no under-icon labels so the column stays slim. */
  .toolbar {
    background: #f7f7f9;
    border-right: 1px solid #e2e2e8;
    display: flex; flex-direction: column;
    padding: 6px 5px; gap: 4px;
  }
  .tb-btn {
    width: 30px; height: 30px;
    display: flex; align-items: center; justify-content: center;
    background: #fff; border: 1px solid #cfcfd6;
    border-radius: 5px; cursor: pointer; color: #333;
    text-decoration: none;
    padding: 0;
    box-shadow: 0 1px 0 rgba(0,0,0,0.04);
  }
  .tb-btn:hover { background: #fafafa; border-color: #cc2222; color: #cc2222; }
  .tb-spacer { flex: 1; }
  .tb-btn.save { background: #f3f7f3; border-color: #b9d2b9; color: #2c5e2c; }
  .tb-btn.save:hover { background: #e6f1e6; border-color: #2c5e2c; }
  .tb-btn.on {
    background: #cc2222; border-color: #cc2222; color: #fff;
    box-shadow: inset 0 1px 0 rgba(0,0,0,0.08);
  }
  .tb-ic {
    font: bold 16px "Apple Symbols", "Segoe UI Symbol", system-ui, sans-serif;
    line-height: 1;
  }

  /* Center stage — preview-first layout. The rendered primitive is the
     dominant element; params + script live in floating popups. */
  .stage {
    overflow-y: auto;
    padding: 20px 28px 32px;
    min-width: 0;
    display: flex; flex-direction: column;
    align-items: stretch;
  }
  .stage-hdr { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 6px; }
  .stage-name { margin: 0; font-size: 20px; color: #cc2222; }
  .stage-id { font: 10px monospace; color: #888; }
  .stage-badges { display: flex; flex-wrap: wrap; gap: 4px; max-width: 280px; justify-content: flex-end; }
  .stage-desc { font: 12px Arial; color: #555; line-height: 1.5; margin: 8px 0 16px; max-width: 720px; }
  .stage-3d {
    flex: 1; min-height: 320px;
    background: #fff;
    border: 1px solid #e8e8e8; border-radius: 6px;
    position: relative;
    overflow: hidden;
  }
  .stage-3d :global(canvas) { display: block; width: 100% !important; height: 100% !important; }
  .stage-loading {
    position: absolute; inset: 0;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 12px;
    background: #fafafa;
    pointer-events: none;
  }
  .stage-loading-text { font: 11px Arial; color: #999; letter-spacing: 0.5px; text-transform: uppercase; }
  .stage-fallback { max-width: 60%; max-height: 60%; object-fit: contain; opacity: 0.65; }
  /* Small persistent chip pinned in the stage corner when a geom() error
     prevents the rebuild but a previous good mesh is still on screen.
     Mostly a wayfinder — the full error message lives in the editor's
     .ed-error strip. */
  .stage-stale {
    position: absolute; top: 8px; left: 8px;
    background: #fff3cd; color: #6f5500;
    border: 1px solid #f0d57a; border-radius: 4px;
    padding: 3px 8px;
    font: 10px Arial; line-height: 1.3;
    display: inline-flex; align-items: center; gap: 5px;
    z-index: 5;
    pointer-events: auto;
    cursor: help;
  }
  .stage-stale-icon { font-size: 11px; }
  .stage-controls {
    display: flex; align-items: center; gap: 14px;
    margin: 8px 0 0;
    font: 11px Arial; color: #555;
  }
  .stage-controls label { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
  .stage-controls input[type="checkbox"] { accent-color: #cc2222; }
  .stage-hint { margin-left: auto; color: #888; font: 11px Arial; }
  .inline-btn {
    background: transparent; border: none; padding: 0;
    color: #cc2222; cursor: pointer; text-decoration: underline;
    font: inherit;
  }
  .inline-btn:hover { color: #a91d1d; }
  .ed-hdr { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 6px; }
  .ed-name { margin: 0; font-size: 20px; color: #cc2222; }
  .ed-id { font: 10px monospace; color: #888; }
  .ed-badges { display: flex; flex-wrap: wrap; gap: 4px; max-width: 280px; justify-content: flex-end; }
  .badge { font: 8px Arial; padding: 2px 6px; border-radius: 8px; text-transform: uppercase; letter-spacing: 0.5px; display: inline-block; }
  .badge.pipe { background: #cc2222; color: #fff; }
  .badge.cat { background: #eef0f5; color: #555; }
  .badge.compound-tag { background: #fff3cd; color: #8a6d3b; border: 1px solid #faecbb; }
  .badge.draft-tag { background: #d6efff; color: #1a5b8a; }
  .ed-desc { font: 12px Arial; color: #555; line-height: 1.5; margin: 8px 0 18px; max-width: 640px; }
  .ed-sec { display: flex; flex-direction: column; gap: 2px; margin-bottom: 10px; }
  .ed-sec-h {
    font: bold 9px Arial; color: #888;
    text-transform: uppercase; letter-spacing: 1px;
    padding-bottom: 3px; margin-bottom: 2px;
    border-bottom: 1px solid #f0f0f0;
    display: flex; align-items: center;
  }
  .muted { color: #bbb; font-weight: normal; margin-left: 4px; }
  /* Compact "+" next to the Parameters title — opens the inline form. */
  .add-param-plus {
    margin-left: auto;
    width: 22px; height: 22px;
    display: inline-flex; align-items: center; justify-content: center;
    background: #cc2222; color: #fff; border: none;
    border-radius: 50%;
    font: bold 14px Arial;
    line-height: 1;
    cursor: pointer;
    transition: background 100ms, transform 100ms;
  }
  .add-param-plus:hover { background: #aa1818; transform: scale(1.06); }

  /* Inline form below the Parameters title for adding a new param. */
  .param-form {
    margin: 4px 0 12px;
    padding: 10px 12px;
    background: #fdf6f6;
    border: 1px solid #f0c8c8;
    border-radius: 4px;
  }
  .pf-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 6px;
  }
  /* Label inline with input — keeps the form on fewer lines without
     changing the font. The text node before the <input> sits as a flex
     item to its left. */
  .pf-row label {
    display: inline-flex; flex-direction: row;
    align-items: center;
    font: 10px Arial; color: #666;
    flex: 1; min-width: 110px;
    gap: 4px;
  }
  .pf-row label .pf-in { flex: 1; min-width: 0; }
  .pf-in {
    font: 11px ui-monospace, monospace;
    padding: 4px 6px;
    border: 1px solid #d8d8de;
    border-radius: 3px;
    background: #fff;
    text-transform: none;
    letter-spacing: 0;
  }
  .pf-in::-webkit-outer-spin-button, .pf-in::-webkit-inner-spin-button { appearance: none; margin: 0; }
  .pf-note { font: 10px Arial; color: #888; font-style: italic; margin: 4px 0 6px; }
  .pf-err  { font: 11px Arial; color: #cc2222; margin: 4px 0; }
  .pf-actions {
    display: flex; align-items: center; gap: 6px;
    margin-top: 6px;
  }
  .pf-hint { font: 10px Arial; color: #888; font-style: italic; margin-left: 4px; }

  /* Auto-flowing grid of param cards in the Inspector → Params tab. Each
     card has label · slider · number on a single row. We aim for 3 columns
     at a comfortable inspector width, but if the panel narrows below
     ~3 × min-card the rows wrap to fewer columns instead of squishing the
     slider/value into unreadable widths. */
  .pr-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 8px 10px;
    padding: 4px 0 2px;
  }
  .pr-card {
    /* Inline row inside each card: label · slider · number value (· × in
       draft tabs). Slider stretches to fill remaining width; the number
       input has a fixed width and no spinner arrows. */
    display: grid;
    grid-template-columns: minmax(64px, max-content) 1fr 48px auto;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    background: #fafafa;
    border: 1px solid #eaeaef;
    border-radius: 4px;
    min-width: 0;
  }
  .pr-lbl {
    font: 10px Arial; color: #555;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .pr-card.extra .pr-lbl { color: #1a5b8a; font-style: italic; }

  /* Group sub-tabs inside the Params section. One tab per `group` value
     declared in the primitive's meta.params (e.g. box_conn → Body / Cone).
     Click selects which group's params render in the grid below. */
  .pg-tabs {
    display: flex; gap: 2px;
    border-bottom: 1px solid #d8d8e0;
    margin: 4px 0 8px;
    overflow-x: auto;
  }
  .pg-tab {
    flex-shrink: 0;
    background: transparent;
    border: 1px solid transparent;
    border-bottom: none;
    cursor: pointer;
    font: 11px Arial; color: #777;
    padding: 4px 12px 5px;
    border-radius: 4px 4px 0 0;
    margin-bottom: -1px;
  }
  .pg-tab:hover { color: #cc2222; background: #fafafa; }
  .pg-tab.active {
    background: #fff;
    border-color: #d8d8e0;
    border-bottom-color: #fff;
    color: #cc2222;
    font-weight: bold;
  }
  /* Derived param — read-only computed value, no slider. Tinted to read
     as "output", not "input". The spacer keeps the value visually
     aligned with the number column of the input cards above. */
  .pr-card.derived {
    background: #f4f0fb;
    border-color: #d8cde6;
  }
  .pr-card.derived .pr-lbl { color: #5b4a8e; }
  .pr-derived-spacer { } /* takes the 1fr slot from the grid template */
  .pr-derived-val {
    font: 11px monospace;
    color: #3b2b6a;
    text-align: right;
    min-width: 48px;
  }
  /* Strip the up/down spinner arrows from number inputs in the Params
     grid — they crowd the value and aren't needed when there's a slider
     beside them. */
  .pr-num::-webkit-outer-spin-button,
  .pr-num::-webkit-inner-spin-button {
    -webkit-appearance: none;
    appearance: none;
    margin: 0;
  }
  .pr-num { -moz-appearance: textfield; appearance: textfield; }
  /* Legacy inline param row — kept for any callers outside the
     Inspector that still use the .pr / .lbl shape. */
  .pr {
    display: grid;
    grid-template-columns: 64px 1fr 48px auto;
    align-items: center; gap: 6px;
    padding: 2px 0;
  }
  .lbl {
    font: 10px Arial; color: #555;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .pr-num {
    font: 10px monospace;
    padding: 1px 3px; border: 1px solid #ddd; border-radius: 3px;
    text-align: right;
    width: 100%;
    min-width: 0;
  }
  .pr-range { accent-color: #cc2222; height: 3px; min-width: 0; width: 100%; }
  .pr.extra .lbl { color: #1a5b8a; font-style: italic; }
  .row-add {
    margin-left: auto;
    background: #fff; border: 1px dashed #cc2222; color: #cc2222;
    font: bold 9px Arial; letter-spacing: 0.5px;
    padding: 1px 8px; border-radius: 9px; cursor: pointer;
  }
  .row-add:hover { background: #cc2222; color: #fff; }
  .row-x {
    background: transparent; border: none; cursor: pointer;
    width: 20px; height: 20px;
    display: flex; align-items: center; justify-content: center;
    font: bold 14px Arial; color: #c98686;
    border-radius: 3px;
  }
  .row-x:hover { background: #fdecec; color: #cc2222; }
  .code {
    background: #1f2329; color: #d8d8df;
    border-radius: 4px;
    padding: 12px 14px;
    font: 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    line-height: 1.55;
    overflow-x: auto;
    max-height: 480px; overflow-y: auto;
    margin: 0;
    white-space: pre;
  }
  .code-note { font: 10px Arial; color: #888; line-height: 1.5; margin: 6px 0 0; }
  .code-note code { font: 10px monospace; background: #f0f0f0; padding: 1px 4px; border-radius: 3px; color: #444; }

  /* ── Parts tab — module-library browser ────────────────────────────────
     Shows two groups of clickable cards:
       • Helpers from manifold-helpers.ts (cyl, tube, mv, rot)
       • Other runes primitives (each exports geom(p) → Manifold)
     Click → snippetForHelper / snippetForRunes splices an import (and a
     hint comment) into the active tab's sourceDraft. Visible only on the
     Parts inspector tab; the Svelte editor still owns the actual code. */
  .parts-pane { display: flex; flex-direction: column; gap: 12px; padding: 4px 0 2px; }
  .parts-intro { font: 11px Arial; color: #555; margin: 0; line-height: 1.5; }
  .parts-intro code { font: 10px monospace; background: #f0f0f0; padding: 1px 4px; border-radius: 3px; color: #444; }
  .parts-group { display: flex; flex-direction: column; gap: 6px; }
  .parts-h {
    font: bold 10px Arial; letter-spacing: 0.4px; text-transform: uppercase;
    color: #555; padding: 2px 0;
  }
  .parts-h .muted { font-weight: normal; color: #999; text-transform: none; letter-spacing: 0; margin-left: 6px; }
  .parts-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 6px;
  }
  .part-card {
    text-align: left;
    background: #fafafa;
    border: 1px solid #e6e6ec;
    border-radius: 4px;
    padding: 6px 8px;
    cursor: pointer;
    display: flex; flex-direction: column; gap: 2px;
    transition: background 0.08s, border-color 0.08s;
  }
  .part-card:hover { background: #f1ecfb; border-color: #b8a8e0; }
  .part-name { font: bold 11px monospace; color: #333; }
  .part-sig  { font: 10px monospace; color: #777; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .part-desc { font: 10px Arial; color: #888; line-height: 1.4; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .parts-empty { font: 11px Arial; color: #888; font-style: italic; padding: 6px 2px; }

  /* Used-card variant — non-clickable label card with a small × in the
     corner to drop the import. Hover reveals the × to avoid clutter. */
  .part-card.used { position: relative; cursor: default; }
  .part-card.used:hover { background: #fafafa; border-color: #e6e6ec; }
  .part-x {
    position: absolute; top: 3px; right: 4px;
    width: 16px; height: 16px;
    display: none; align-items: center; justify-content: center;
    background: transparent; border: none; cursor: pointer;
    font: bold 12px Arial; line-height: 1; color: #aaa;
    border-radius: 3px;
  }
  .part-card.used:hover .part-x { display: inline-flex; }
  .part-x:hover { background: #fdecec; color: #cc2222; }

  /* "+ Add helper / + Add primitive" toggle — same look as the other small
     in-pane action buttons. Sits on its own row below the used-cards grid. */
  .parts-add-btn {
    align-self: flex-start;
    background: #fff;
    border: 1px dashed #c8c8d0; border-radius: 4px;
    padding: 3px 10px;
    font: 11px Arial; color: #555;
    cursor: pointer;
    margin-top: 2px;
  }
  .parts-add-btn:hover { background: #f4f0fb; border-color: #b8a8e0; color: #1a5b8a; }

  /* Catalog picker — appears below the "+ Add" button, lists what's NOT
     yet imported. Click an entry to splice the import + auto-close picker. */
  .parts-picker {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 4px;
    padding: 6px;
    margin-top: 4px;
    background: #fbfaff;
    border: 1px solid #e2dff0;
    border-radius: 4px;
  }
  .part-pick {
    text-align: left;
    background: #fff;
    border: 1px solid #e6e6ec;
    border-radius: 3px;
    padding: 4px 6px;
    cursor: pointer;
    display: flex; flex-direction: column; gap: 1px;
  }
  .part-pick:hover { background: #f1ecfb; border-color: #b8a8e0; }
  /* Inspector popup — single panel with a tab strip across the top.
     Replaces the previous separate Params + Script popups so only one
     floating panel is visible per tab. */
  /* Tags strip pinned above the inspector tab row. Always visible across
     all four tabs so the primitive's classification stays in view while
     editing params / source / docs. */
  .insp-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 6px 0 10px;
    border-bottom: 1px dashed #e2e2e8;
    margin-bottom: 8px;
  }
  .insp-tabs {
    display: flex;
    align-items: stretch;
    gap: 2px;
    margin: 0 0 12px;
    border-bottom: 2px solid #e2e2e8;
    padding-bottom: 0;
  }
  .insp-tab {
    background: transparent;
    border: none;
    color: #666;
    font: bold 11px Arial;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    padding: 5px 10px;
    margin-bottom: -2px;
    border-bottom: 2px solid transparent;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    transition: color 100ms, border-color 100ms;
  }
  .insp-tab:hover { color: #cc2222; }
  .insp-tab.active {
    color: #cc2222;
    border-bottom-color: #cc2222;
  }
  .insp-tab .ic { font-size: 13px; opacity: 0.85; }
  .md-wrap { height: 360px; }
  /* Legacy script-tabs kept for any callers that still use it; the
     consolidated Inspector uses .insp-tabs above. */
  .script-tabs {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-bottom: 10px;
    border-bottom: 1px solid #e2e2e8;
    padding-bottom: 6px;
  }
  .script-tab {
    background: #f0f0f5;
    border: 1px solid #d8d8de;
    color: #666;
    font: bold 10px Arial;
    text-transform: uppercase;
    letter-spacing: 1px;
    padding: 5px 12px;
    border-radius: 3px 3px 0 0;
    cursor: pointer;
    transition: background 100ms, color 100ms;
  }
  .script-tab:hover { background: #fff; color: #cc2222; }
  .script-tab.active {
    background: #cc2222;
    color: #fff;
    border-color: #cc2222;
  }
  .script-tabs-hint {
    font: 10px Arial;
    color: #999;
    font-style: italic;
    margin-left: 8px;
    flex: 1;
  }
  .editor-wrap {
    height: 320px;
    margin: 4px 0;
  }
  /* Structural strip above the editor — surfaces class anatomy or
     compile-output shape so the tab reads as a "thing" rather than
     just a wall of code. Two color schemes mirror the editor variants. */
  .anatomy {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 6px 8px;
    border-radius: 4px 4px 0 0;
    border: 1px solid;
    border-bottom: none;
    margin: 0 0 -1px;            /* tuck into the editor's top border */
  }
  .anatomy.svelte { background: #f0ecf8; border-color: #d8d4e8; }
  .anatomy.script { background: #26262c; border-color: #353540; }
  .ana-chip {
    font: bold 9px Arial;
    text-transform: uppercase;
    letter-spacing: 1px;
    padding: 3px 7px;
    border-radius: 10px;
    background: #fff;
    color: #555;
    border: 1px solid #d8d8de;
  }
  .ana-chip.kind { background: #3b3b8a; color: #fff; border-color: #3b3b8a; }
  .ana-chip.ok   { background: #e8f5e8; color: #2a8a2a; border-color: #cae5ca; }
  .ana-chip.emit { background: #efe6f6; color: #6b3d92; border-color: #d8c7e6; }
  .ana-chip.dark { background: #2e2e36; color: #c8c8d0; border-color: #3f3f4a; }
  .ana-chip.dark.kind { background: #f0a040; color: #1e1e22; border-color: #f0a040; }
  .ana-chip.dark.amber { color: #f0a040; border-color: #5a4828; }
  /* Inline error strip pinned below the Svelte editor. Per the user's
     "error capture inside this one only" rule — geom() exceptions surface
     here, NOT as a full-canvas red banner over the 3D scene. The stage
     keeps the last-good mesh + a small corner chip; the actual message
     lives in this strip so the editor and the error stay co-located. */
  .ed-error {
    display: flex; align-items: flex-start; gap: 6px;
    background: #f8d7da; color: #721c24;
    border: 1px solid #f0b3b9; border-radius: 4px;
    padding: 6px 8px; margin-top: 6px;
    font: 11px monospace; line-height: 1.4;
    max-height: 180px; overflow-y: auto;
  }
  .ed-err-icon { flex-shrink: 0; font-size: 12px; padding-top: 1px; }
  .ed-err-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
  .ed-err-msg  { word-break: break-word; }
  .ed-err-hint {
    font: 10px Arial; color: #5a1a1f; line-height: 1.5;
    background: rgba(255,255,255,0.45);
    border-radius: 3px; padding: 4px 6px;
  }
  .ed-err-hint code,
  .ed-err-msg code {
    font: 10px monospace;
    background: rgba(255,255,255,0.6);
    padding: 0 3px; border-radius: 2px;
  }
  .ed-err-clear {
    flex-shrink: 0;
    background: transparent; border: none; cursor: pointer;
    color: #721c24; font: bold 13px Arial; line-height: 1;
    padding: 0 4px; border-radius: 3px;
  }
  .ed-err-clear:hover { background: rgba(204, 34, 34, 0.18); }

  .save-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 8px;
  }
  .save-btn, .discard-btn {
    font: bold 11px Arial;
    padding: 5px 12px;
    border-radius: 3px;
    cursor: pointer;
    border: 1px solid #d8d8de;
    transition: background 100ms, color 100ms;
  }
  .save-btn { background: #cc2222; color: #fff; border-color: #cc2222; }
  .save-btn:hover:not(:disabled) { background: #aa1818; }
  .save-btn:disabled, .discard-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .discard-btn { background: #fff; color: #666; }
  .discard-btn:hover:not(:disabled) { background: #f3f3f7; color: #cc2222; }
  .save-status { font: 10px Arial; }
  .save-status.ok { color: #2a8a2a; }
  .save-status.err { color: #cc2222; }
  .save-status.muted { color: #888; font-style: italic; }
  /* Draft-variable rows in the Script popup — same row layout as params. */
  .var-row { display: flex; align-items: center; gap: 4px; padding: 3px 0; }
  .var-name {
    width: 80px; font: 10px monospace;
    padding: 2px 5px; border: 1px solid #ddd; border-radius: 3px;
  }
  .var-expr {
    flex: 1; min-width: 0; font: 10px monospace;
    padding: 2px 5px; border: 1px solid #ddd; border-radius: 3px;
  }
  .var-name:focus, .var-expr:focus { outline: none; border-color: #cc2222; }
  .eq { font: bold 10px monospace; color: #888; }
  .vars-empty { font: 10px Arial; color: #888; line-height: 1.5; margin: 4px 0 0; }
  .vars-empty code { font: 10px monospace; background: #f0f0f0; padding: 1px 4px; border-radius: 3px; }
  .ed-tags { display: flex; flex-wrap: wrap; gap: 4px; }
  .tag { font: 9px Arial; color: #555; background: #f0f0f0; padding: 2px 6px; border-radius: 9px; }

  /* Empty state when no tab is active. */
  .empty {
    flex: 1; overflow-y: auto;
    padding: 28px 32px;
    color: #555;
  }
  .empty h1 { margin: 0 0 12px; font-size: 22px; color: #cc2222; }
  .empty p { font: 13px Arial; max-width: 680px; line-height: 1.55; margin: 0 0 12px; }
  .empty strong { color: #222; }
  .empty .hint { font-size: 12px; color: #777; }
  .empty code { font: 11px monospace; background: #f0f0f0; padding: 1px 5px; border-radius: 3px; }

  @media (max-width: 700px) {
    .layout { flex-direction: column; }
    .sidebar {
      width: 100%; max-height: 220px;
      border-right: none; border-bottom: 1px solid #e2e2e8;
    }
  }
</style>
