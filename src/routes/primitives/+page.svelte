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
  import { COMPONENTS_L3, type ComponentL3 } from '$lib/components/components-l3';
  import { ASSEMBLIES_L4, type AssemblyL4 } from '$lib/components/assemblies-l4';
  import { generateTubingComponent, type TubingInputs, type Grade, type ConnectionType } from '$lib/components/rules/tubing';
  // Vite ?raw — bundles the file's text at build time so the client can show
  // the script that produces each primitive's geometry in-tab.
  import builderSource from '$lib/components/builder.ts?raw';

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
    {
      id: 'primitives',
      name: 'Primitives',
      match: (c) => [
        'hollow_cylinder', 'taper', 'shoulder',
        'grooved_cylinder', 'slotted_cylinder', 'seal_bore',
        'threaded_box', 'threaded_pin',
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
     *  with no param editing). */
    kind: 'primitive' | 'kb' | 'composite';
    /** Baked AuthoredComponent spec for composite (level 3 / 4) tabs. */
    compositeSpec?: import('$lib/authoring/schema').AuthoredComponent;
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
   *  sidebar with a flat primitive list beneath. */
  let sidebarTab = $state<string>('primitives');
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
  let showParams = $state(false);
  let showScript = $state(false);
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
  onMount(() => {
    import('$lib/shared/ComponentScene.svelte').then((m) => { SceneComponent = m.default; });
    import('$lib/shared/SceneControls.svelte').then((m) => { SceneControls = m.default; });
    initManifold().then(() => { ready = true; });
  });

  /** Compose a minimal AuthoredComponent for the active tab so buildAuthored
   *  can construct + finalize the geometry. Single part, no ops. */
  function activeSpec(): AuthoredComponent | null {
    if (!activeTab) return null;
    if (activeTab.kind === 'primitive') {
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
    activeTab && activeTab.kind === 'primitive'
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

  function resetParams(tab: Tab) {
    const def = COMPONENTS.find((c) => c.id === tab.primId);
    if (def) tab.params = structuredClone(def.defaults);
  }

  async function copyId(tab: Tab) {
    try { await navigator.clipboard.writeText(tab.primId); } catch {}
  }

  let activeTab = $derived(openTabs.find((t) => t.id === activeTabId) ?? null);
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
    return COMPONENTS.find((c) => c.id === activeTab.primId) ?? null;
  });
  /** Source of the active primitive's builder function, sliced out of
   *  builder.ts at build time. Falls back to a friendly note if the slice
   *  couldn't find the function (e.g. inline arrow form that doesn't match
   *  the `<id>(p) {` shape extractBuilder expects). */
  let builderText = $derived(
    activeTab ? extractBuilder(builderSource, activeTab.primId) ?? '// (no script — builder function not found in builder.ts)' : '',
  );

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
  <aside class="sidebar" tabindex="0" onkeydown={onSidebarKey}>
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
        {#if f.id === sidebarTab && f.id !== 'kb' && f.id !== 'components' && f.id !== 'assemblies'}
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
      <div class="tab-body">
        <!-- Left toolbar — primitive actions + popups for preview/script.
             Composite tabs (level-3 components, level-4 assemblies) hide
             Params + Reset since params are baked into each part's spec
             and aren't editable from a single popup. -->
        <div class="toolbar">
          {#if activeTab.kind === 'primitive'}
            <button class="tb-btn" type="button" class:on={showParams} onclick={() => (showParams = !showParams)} title="Toggle parameters popup">
              <span class="tb-ic">⚙</span>
            </button>
          {/if}
          <button class="tb-btn" type="button" class:on={showScript} onclick={() => (showScript = !showScript)} title="Builder script">
            <span class="tb-ic">{'</>'}</span>
          </button>
          {#if activeTab.kind === 'primitive'}
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
            {:else if buildError}
              <div class="stage-err">Build error: {buildError}</div>
            {:else}
              <div class="stage-loading">
                {#if activeTab.kind === 'primitive'}
                  <img
                    class="stage-fallback"
                    src={imgSrc(activeTab.primId)}
                    alt={activeDef.name}
                    loading="lazy"
                    onerror={(e) => { (e.currentTarget as HTMLElement).style.display = 'none'; }}
                  />
                {/if}
                <span class="stage-loading-text">{ready ? 'Building…' : 'Loading scene…'}</span>
              </div>
            {/if}
          </div>

          <div class="stage-controls">
            <label><input type="checkbox" bind:checked={showCutaway} /> Cross-section</label>
            <label><input type="checkbox" bind:checked={showEdges} /> Edges</label>
            <span class="stage-hint">
              {#if activeTab.kind === 'primitive'}
                <button class="inline-btn" type="button" onclick={() => (showParams = true)}>Params</button>
                ·
              {/if}
              <button class="inline-btn" type="button" onclick={() => (showScript = true)}>Script</button>
            </span>
          </div>
        </div>

      <!-- Floating popups — params + builder script. Nested INSIDE
           .tab-body so containerRelative anchors them to the tab area
           rather than to the viewport (which would overlap the sidebar). -->
      <FloatingPanel
        title="Params · {activeDef.name}"
        visible={showParams && activeTab.kind === 'primitive'}
        onClose={() => (showParams = false)}
        containerRelative
        x={50} y={8}
        width="260px"
        maxHeight="calc(100% - 16px)"
      >
        <div class="ed-sec">
          <div class="ed-sec-h">
            Parameters <span class="muted">{Object.keys(activeTab.params).length}</span>
            {#if activeTab.draft}
              <button class="row-add" type="button" onclick={() => addParam(activeTab!)} title="Add a draft parameter">+ param</button>
            {/if}
          </div>
          {#each Object.keys(activeTab.params) as key (key)}
            {@const def = paramDef(activeDef, key)}
            {@const isExtra = !(key in activeDef.params)}
            <!-- Inline row: label + slider + number all on one line. -->
            <div class="pr" class:extra={isExtra}>
              <span class="lbl" title={def.label}>{def.label}{def.unit ? ` (${def.unit})` : ''}{isExtra ? '*' : ''}</span>
              <input class="pr-range" type="range" min={def.min} max={def.max} step={def.step} bind:value={activeTab.params[key]} />
              <input class="pr-num" type="number" step={def.step} bind:value={activeTab.params[key]} />
              {#if activeTab.draft}
                <button class="row-x" type="button" onclick={() => removeParam(activeTab!, key)} title="Remove parameter" aria-label="Remove parameter">×</button>
              {/if}
            </div>
          {/each}
        </div>

        {#if activeDef.tags?.length}
          <div class="ed-sec">
            <div class="ed-sec-h">Tags</div>
            <div class="ed-tags">
              {#each activeDef.tags as t}<span class="tag">{t}</span>{/each}
            </div>
          </div>
        {/if}
      </FloatingPanel>

      <FloatingPanel
        title="Script · {activeTab.primId}"
        visible={showScript}
        onClose={() => (showScript = false)}
        containerRelative
        x={300} y={32}
        width="min(560px, calc(100% - 80px))"
        maxHeight="calc(100% - 64px)"
      >
        <!-- Variables — mirrors ManifoldCAD's playground pattern: declare
             named values at the top of the script, then the builder body
             references them. Editing here is session-only display until
             plan tasks 9/10 wire it into the codegen pipeline. -->
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
          <pre class="code"><code>{#if activeTab.vars.length > 0}{activeTab.vars.map((v) => `const ${v.name || '_'} = ${v.expr || '0'};`).join('\n')}{'\n\n'}{/if}{builderText}</code></pre>
          <p class="code-note">Builder body is read-only — the project disallows dynamic eval (see CLAUDE.md).
            Variables above are a draft surface for sketching what a new primitive's script header could look like.</p>
        </div>
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
    width: 260px; flex-shrink: 0;
    background: #f7f7f9;
    border-right: 1px solid #e2e2e8;
    display: flex; flex-direction: column;
    overflow: hidden;
  }
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
    grid-template-columns: 28px 1fr;
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
  }
  .sb-tab {
    background: #e6e6ec; border: 1px solid #d8d8de;
    color: #666;
    cursor: pointer;
    padding: 8px 1px;
    width: 100%; min-height: 80px;
    display: flex; flex-direction: column-reverse;
    align-items: center; justify-content: center; gap: 3px;
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
  .tab-body.kb-tab { grid-template-columns: 1fr; }
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
  .stage-loading, .stage-err {
    position: absolute; inset: 0;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 12px;
    background: #fafafa;
    pointer-events: none;
  }
  .stage-loading-text { font: 11px Arial; color: #999; letter-spacing: 0.5px; text-transform: uppercase; }
  .stage-fallback { max-width: 60%; max-height: 60%; object-fit: contain; opacity: 0.65; }
  .stage-err { font: 11px monospace; color: #721c24; background: #f8d7da; padding: 12px; }
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
  /* Compact inline param row: label · slider · number — all one line. */
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
