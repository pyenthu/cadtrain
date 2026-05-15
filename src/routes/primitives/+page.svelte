<script lang="ts">
  // Sidebar + tabbed-editor primitives browser, modeled on SVTC's tab system
  // (src/lib/cad/SimpleTabs/SimpleTabs.svelte + src/lib/tabs/tabs.svelte.js).
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
  import { COMPONENTS, type ComponentDef } from '$lib/cad/library';
  import { initManifold, setRenderZScale } from '$lib/cad/builder';
  import { scene } from '$lib/shared/scene-state.svelte';
  import { buildAuthored } from '$lib/authoring/compose';
  import { deserializeComponentResult } from '$lib/cad/mesh-serial';
  import { emptyAuthoredComponent, type AuthoredComponent } from '$lib/authoring/schema';
  import FloatingPanel from '$lib/shared/FloatingPanel.svelte';
  import KbTableViewer from '$lib/shared/KbTableViewer.svelte';
  import CodeEditor from '$lib/shared/CodeEditor.svelte';
  import { formatTypescript, checkTypescriptSyntax } from '$lib/shared/format-ts';
  import type { Completion } from '@codemirror/autocomplete';
  import MarkdownView from '$lib/shared/MarkdownView.svelte';
  import { COMPONENTS_L3, type ComponentL3 } from '$lib/cad/components-l3';
  import { ASSEMBLIES_L4, type AssemblyL4 } from '$lib/cad/assemblies-l4';
  import { generateTubingComponent, type TubingInputs, type Grade, type ConnectionType } from '$lib/cad/rules/tubing';
  // Vite ?raw — bundles the file's text at build time so the client can show
  // the script that produces each primitive's geometry in-tab.
  import builderSource from '$lib/cad/builder.ts?raw';
  // NEW declarative pipeline — component specs that compile to the same
  // imperative ManifoldCAD source as builder.ts. Lives in the XML Primitive
  // tab; kept separate from the legacy primitives until the swap is trusted.
  import { loadComponentRegistry, defaultsFor, type ComponentEntry, type DerivedSchema, type ParamSchema } from '$lib/cad/components';
  import { FAMILIES, FAMILY_BY_ID, familyOf, loadEnabledFamilies, saveEnabledFamilies, type Family,
           LEVELS, levelOf, loadEnabledLevels, saveEnabledLevels, type Level } from '$lib/cad/components/families';
  import { discoverHelpers } from '$lib/cad/manifold-helpers-meta';

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
    // a component list under this tab.
    // Basic — pure geometric building blocks. Restricted to component
    // ids whose family is 'basic' in $lib/cad/components/families.ts.
    {
      id: 'basic',
      name: 'Basic',
      match: () => false,
    },
    // Components — named real-world parts, grouped by family
    // (Casing & Tubing, Drillstring, Wellheads & Christmas Trees,
    // Packers & Bridge Plugs, Fishing & Intervention, Artificial Lift,
    // Flow Control). The filter popup next to the search bar controls
    // which families are visible.
    {
      id: 'components',
      name: 'Parts',
      match: () => false,
    },
    {
      id: 'assemblies',
      name: 'Assemblies',
      match: () => false, // deferred — placeholder for level 4.
    },
    // KB tab — single rail entry housing two sub-tabs:
    //   - Sources: raw documents that feed the structured KB tables
    //     (vendor PDFs, operator inventory, industry charts, vendor URLs).
    //     Listed via /api/kb/sources, which reads <volume>/kb-sources/.
    //   - DB: the structured KB tables themselves, listed from
    //     /kb/index.json. Clicking a row opens the table as a main tab.
    // Sub-tab state lives in kbSubTab below; the rail count combines both.
    {
      id: 'kb',
      name: 'KB',
      match: () => false,
    },
    // Operator — higher-level CAD operations (cut slots, extrude, twist,
    // roll, cut threads) that splice into the active primitive's geom
    // body. Was a separate dark top-strip toggle previously; folded into
    // the rail so the visual real estate doesn't cover the canvas title.
    {
      id: 'operator',
      name: 'Operator',
      match: () => false,
    },
    // Test — the holding area. Two things live here: the numbered
    // figure gallery (raw PDF-page renders from extract_figures.ts), and
    // figure-derived components-in-progress (library/test/<id>/ — they
    // render normally but aren't classified into Basic/Parts/Assemblies
    // until the user hits Move). Also keeps the manual source-link
    // scratch pad. A part stays in Test until explicitly moved.
    {
      id: 'test',
      name: 'Test',
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
     *  with no param editing; xml-primitive → component viewer that
     *  shows the compiled imperative ManifoldCAD source). */
    kind: 'primitive' | 'kb' | 'composite' | 'xml-primitive' | 'source';
    /** Embedded-viewer state for kind === 'source'. The Sources sidebar
     *  row click sets these; the main tab body renders an <iframe>
     *  pointing at either a public URL or the /api/kb/source-pdf
     *  endpoint for local PDFs. */
    sourceUrl?: string;
    sourceFile?: string;
    sourceLabel?: string;
    sourceKind?: string;
    /** Baked AuthoredComponent spec for composite (level 3 / 4) tabs. */
    compositeSpec?: import('$lib/authoring/schema').AuthoredComponent;
    /** Runes-class entry (only set when kind === 'xml-primitive'). */
    componentEntry?: ComponentEntry;
    /** Explicit reference-picture URL override. Set when a tab is opened
     *  from a Test-tab figure (the extract-N.png under <volume>/figures/)
     *  or from a library part's picture.png; the Picture stage tab uses
     *  this instead of the volume lookup. */
    pictureUrl?: string;
    /** Volume-relative path of the source FIGURE for a figure-draft
     *  (e.g. `figures/extract-50.png`). On first save it's passed to
     *  /api/components/save so the server copies it into the new part
     *  directory as `picture.png` — the picture then travels with the
     *  part. Unset for non-figure tabs. */
    figureFile?: string;
    /** True for a figure-draft: a blank component shell with a picture
     *  but no geometry yet. The build pipeline is skipped and the Render
     *  stage shows an "not constructed yet" empty-state instead of an
     *  error. Cleared once the component is actually constructed. */
    unconstructed?: boolean;
    /** In-memory edit buffer for the component .ts source shown in the
     *  Script popup → Svelte tab. Initialized from componentEntry.source on
     *  open; mutated on every keystroke via CodeEditor.onChange. Cleared
     *  on save. Null = unedited (editor renders componentEntry.source). */
    sourceDraft?: string | null;
    /** Save status for the Svelte source editor. UI-only feedback. */
    saveStatus?: 'idle' | 'saving' | 'saved' | 'error';
    /** Last save error message (when saveStatus === 'error'). */
    saveError?: string;
    /** AI Refine — pending state from the AI Inspector tab. While the
     *  user composes a prompt + waits for a Claude response + decides to
     *  Accept/Reject, this lives per-tab so switching primitives doesn't
     *  lose the in-flight conversation. `pending` is the proposed source
     *  that hasn't been merged into sourceDraft yet (Accept moves it).
     *  `instructionsDraft` is the editable mirror of the primitive's
     *  <id>.md — the persistent "spec" that gets sent alongside every
     *  prompt. null = unchanged from disk; string = dirty edits. */
    ai?: {
      prompt: string;
      status: 'idle' | 'sending' | 'pending' | 'error';
      pending?: string;
      error?: string;
      instructionsDraft?: string | null;
      instructionsStatus?: 'idle' | 'saving' | 'saved' | 'error';
      instructionsError?: string;
      /** Last few prompt/response pairs in this session. UI-only — not
       *  persisted across reloads. */
      history: Array<{ prompt: string; ts: number; accepted?: boolean }>;
    };
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
    /** Param-description editor — popup state. `drafts` holds the
     *  edited description text per param key; submit splices each one
     *  into the meta block's params entry. */
    descForm?: {
      open: boolean;
      drafts: Record<string, string>;
      error?: string;
    };
    /** Per-param edit popup — opens via the ✎ button on a specific
     *  card. Holds the original key plus in-flight drafts for every
     *  user-editable field on the param schema. All numeric fields
     *  are strings here so the inputs can hold transient invalid
     *  values during editing; submit parses + validates. */
    paramEdit?: {
      key: string;
      name: string;
      label: string;
      desc: string;
      unit: string;
      group: string;        // which part-accordion bar to nest under
      defaultStr: string;
      minStr: string;
      maxStr: string;
      stepStr: string;
      error?: string;
    } | null;
    /** Per-arg formula editor — opens via the ƒ button inside an
     *  instance-prop cell. Holds the in-flight expression text + a
     *  cursor index used by the typeahead to compute the word-at-caret. */
    formulaEdit?: {
      instance: string;
      argIdx: number;
      raw: string;
      caret: number;
    } | null;
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
  let sidebarTab = $state<string>('basic');
  /** Sub-tab inside the KB rail tab. Sources = raw vendor / catalogue
   *  documents on the volume; DB = structured KB tables from
   *  /kb/index.json. Default to Sources because that's the more common
   *  drop-in flow now (upload PDF → appears immediately). */
  let kbSubTab = $state<'sources' | 'db'>('sources');
  /** Collapsed family-group headers, keyed `<context>:<familyId>` so
   *  collapsing "Drillstring" in Components doesn't also collapse it
   *  in the KB tabs. State is in-memory only — refresh resets. */
  let collapsedFamilies = $state<Set<string>>(new Set());
  function toggleFamilyCollapse(ctx: string, familyId: string) {
    const key = `${ctx}:${familyId}`;
    const next = new Set(collapsedFamilies);
    if (next.has(key)) next.delete(key); else next.add(key);
    collapsedFamilies = next;
  }
  function isFamilyCollapsed(ctx: string, familyId: string): boolean {
    return collapsedFamilies.has(`${ctx}:${familyId}`);
  }
  /** Which non-basic families show in the Components tab. Persisted to
   *  localStorage via the helpers in $lib/cad/components/families.ts —
   *  initialized in onMount once `localStorage` is available. */
  let enabledFamilies = $state<Set<Family>>(new Set());
  /** Filter popup visibility — anchored to the Families button in the
   *  Components tab. */
  let familyFilterOpen = $state<boolean>(false);
  /** Pixel coordinates for the FloatingPanel — set on open from the
   *  button's bounding rect, à la SVTC's ScaleSpreadPopover. */
  let familyFilterX = $state<number>(80);
  let familyFilterY = $state<number>(80);
  let familyFilterBtn: HTMLButtonElement | undefined = $state();

  /** Coords for the per-param Edit popup. Anchored to the ✎ button on
   *  open via getBoundingClientRect (SVTC-style FloatingPanel). One
   *  shared popup — at most one param edit is open at a time. */
  let paramEditX = $state<number>(80);
  let paramEditY = $state<number>(80);

  /** Coords for the per-arg Formula popup. Anchored to the ƒ button. */
  let formulaEditX = $state<number>(80);
  let formulaEditY = $state<number>(80);

  /** Compute the identifier the user is currently typing — the
   *  contiguous run of `[A-Za-z0-9._]` ending at the caret. Returns the
   *  empty string when the caret sits after whitespace or punctuation. */
  function wordAtCaret(text: string, caret: number): { word: string; start: number } {
    const re = /[A-Za-z0-9._]/;
    let i = caret;
    while (i > 0 && re.test(text[i - 1])) i--;
    return { word: text.slice(i, caret), start: i };
  }

  /** Replace the word at `caret` with `replacement` (no surrounding
   *  spaces). Returns the new text + the new caret position (end of the
   *  inserted token). */
  function replaceWordAtCaret(text: string, caret: number, replacement: string): { text: string; caret: number } {
    const w = wordAtCaret(text, caret);
    const next = text.slice(0, w.start) + replacement + text.slice(caret);
    return { text: next, caret: w.start + replacement.length };
  }

  function toggleFamilyFilter() {
    if (familyFilterOpen) { familyFilterOpen = false; return; }
    if (familyFilterBtn) {
      const r = familyFilterBtn.getBoundingClientRect();
      familyFilterX = Math.round(r.right + 8);
      familyFilterY = Math.round(r.top);
    }
    familyFilterOpen = true;
  }
  function setAllFamilies(on: boolean) {
    const next = new Set<Family>();
    if (on) for (const fam of FAMILIES) if (fam.id !== 'basic') next.add(fam.id);
    enabledFamilies = next;
    saveEnabledFamilies(next);
  }

  // Parallel state for the Basic-tab Level filter — same shape as the
  // Family filter on Parts, just operates on Level (1|2) instead of
  // Family. See $lib/cad/components/families.ts LEVELS.
  let enabledLevels = $state<Set<Level>>(new Set());
  let levelFilterOpen = $state<boolean>(false);
  let levelFilterX = $state<number>(80);
  let levelFilterY = $state<number>(80);
  let levelFilterBtn: HTMLButtonElement | undefined = $state();

  function toggleLevelFilter() {
    if (levelFilterOpen) { levelFilterOpen = false; return; }
    if (levelFilterBtn) {
      const r = levelFilterBtn.getBoundingClientRect();
      levelFilterX = Math.round(r.right + 8);
      levelFilterY = Math.round(r.top);
    }
    levelFilterOpen = true;
  }
  function setAllLevels(on: boolean) {
    const next = new Set<Level>();
    if (on) for (const l of LEVELS) next.add(l.id);
    enabledLevels = next;
    saveEnabledLevels(next);
  }

  // Test rail tab — link scratchpad. Each link has a stable id (used for
  // dedup + delete), a URL, and optional human-readable label. State
  // persists to localStorage as 'cad:testLinks'.
  interface TestLink {
    id: string;
    url: string;
    label?: string;
    addedAt: number;
  }
  const TEST_LINKS_KEY = 'cad:testLinks';
  let testLinks = $state<TestLink[]>([]);
  let testInput = $state('');
  let testInputError = $state('');

  function loadTestLinks(): TestLink[] {
    try {
      const raw = localStorage.getItem(TEST_LINKS_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr.filter((x) => x && typeof x.url === 'string');
    } catch { return []; }
  }
  function saveTestLinks(links: TestLink[]) {
    try { localStorage.setItem(TEST_LINKS_KEY, JSON.stringify(links)); }
    catch { /* private mode etc. */ }
  }
  function addTestLink() {
    const raw = testInput.trim();
    if (!raw) return;
    // Sanity-check it parses as a URL. Reject otherwise — surface the
    // error inline rather than silently dropping the input.
    try { new URL(raw); }
    catch { testInputError = 'Not a valid URL'; return; }
    if (testLinks.some((l) => l.url === raw)) {
      testInputError = 'Already in the list';
      return;
    }
    let label: string | undefined;
    try {
      const u = new URL(raw);
      label = u.hostname.replace(/^www\./, '') + u.pathname.replace(/\/$/, '');
    } catch { /* fallthrough */ }
    const next = [...testLinks, { id: `tl_${Date.now()}`, url: raw, label, addedAt: Date.now() }];
    testLinks = next;
    saveTestLinks(next);
    testInput = '';
    testInputError = '';
  }
  function deleteTestLink(id: string) {
    const next = testLinks.filter((l) => l.id !== id);
    testLinks = next;
    saveTestLinks(next);
  }
  // Stage sub-tab: Render = 3D canvas, Picture = per-primitive
  // reference image used to author/refine the part. Image lives on the
  // volume at <volume>/components/<id>.source.png, served via
  // /api/volume?path=components/<id>.source.png. Defaults to 'render'
  // on every primitive switch (don't strand the user in an empty
  // Picture tab when they navigate around).
  let stageTab = $state<'picture' | '3d'>('3d');
  // Inside the 3D stage, toggle between the live ManifoldCAD mesh
  // (rebuilt on every param drag) and the static baked GLB. Same
  // SceneControls, same camera, just different geometry source.
  let stageView = $state<'mesh' | 'glb'>('mesh');
  /** Track whether the active primitive's source image actually exists.
   *  Set true when <img> loads; set false on error (404 / missing).
   *  Reset to null on tab switch (loading state).  */
  let pictureLoadStatus = $state<'loading' | 'present' | 'missing'>('loading');
  let pictureUploadStatus = $state<'idle' | 'uploading' | 'error'>('idle');
  let pictureUploadError = $state<string>('');

  /** Per-primitive picture URL. Stable for a given id; the <img> tag
   *  re-fetches whenever the id changes. Cache-busts on upload by
   *  appending a timestamp param after a successful POST. */
  let pictureCacheKey = $state<number>(0);
  function pictureUrlFor(primId: string): string {
    return `/api/volume?path=${encodeURIComponent(`components/${primId}.source.png`)}${pictureCacheKey ? `&v=${pictureCacheKey}` : ''}`;
  }

  /** PUT a new source picture for the active primitive. Used by the
   *  upload <input>/drop-zone in the empty-state Picture pane. */
  async function uploadPicture(primId: string, file: File) {
    pictureUploadStatus = 'uploading';
    pictureUploadError = '';
    try {
      const buf = await file.arrayBuffer();
      const r = await fetch(`/api/volume?path=${encodeURIComponent(`components/${primId}.source.png`)}`, {
        method: 'PUT',
        body: buf,
        headers: { 'content-type': file.type || 'image/png' },
      });
      if (!r.ok) throw new Error(`upload failed: ${r.status}`);
      pictureCacheKey = Date.now();
      pictureLoadStatus = 'loading';
      pictureUploadStatus = 'idle';
    } catch (e: any) {
      pictureUploadStatus = 'error';
      pictureUploadError = e?.message ?? String(e);
    }
  }

  // Extraction-results manifest from the overnight_extract.ts pipeline.
  // Auto-loaded from /tests/extracted/manifest.json at mount; renders
  // as a header section above the manual links in the Test rail tab.
  interface ExtractionResult {
    id: string;
    name: string;
    family?: string;
    source_pdf: string;
    source_page?: number | string;
    brief_description: string;
    iters_done: number;
    final_verdict: 'MATCH' | 'INCOMPLETE' | 'ERROR';
    error?: string;
    url: string;
    /** Rendered source PDF page — the original figure the .ts was
     *  interpreted from. Copied into the volume on promote so the
     *  stage Picture tab shows it next to the 3D render. */
    source_image?: string;
  }
  let extractionResults = $state<ExtractionResult[]>([]);
  let extractionLoadedAt = $state<string | null>(null);

  async function loadExtractionManifest() {
    try {
      const r = await fetch('/tests/extracted/manifest.json', { cache: 'no-store' });
      if (!r.ok) return;
      const payload = await r.json();
      if (Array.isArray(payload?.items)) {
        extractionResults = payload.items as ExtractionResult[];
        extractionLoadedAt = payload.generated_at ?? null;
      }
    } catch { /* no manifest yet — silent */ }
  }

  // Picture-first figure gallery. `scripts/extract_figures.ts` renders
  // every page of the figure-rich kb-source PDFs to numbered PNGs on the
  // VOLUME (<volume>/figures/, served via /api/volume — not static/, not
  // git). The Test tab shows the thumbnails as a numbered grid — the
  // user curates ("extract 7") and then the generate pipeline runs on
  // that specific figure.
  interface FigureItem {
    n: number;
    id: string;        // "extract-N"
    pdf: string;
    page: number;
    file: string;      // volume-relative: figures/extract-N.png
    thumb: string;     // volume-relative: figures/extract-N.thumb.png
  }
  /** Browser URL for a volume-relative path, via the /api/volume CRUD. */
  function volumeUrl(rel: string): string {
    return `/api/volume?path=${encodeURIComponent(rel)}`;
  }
  let figures = $state<FigureItem[]>([]);
  let figuresLoadedAt = $state<string | null>(null);
  /** Per-figure delete status — surfaces an in-flight spinner on the
   *  cell and disables the button so a double-click can't double-delete. */
  let figureDeleting = $state<Record<string, boolean>>({});

  /** Permanently delete a figure: unlink the PNG + thumbnail from the
   *  volume via the /api/volume CRUD, then rewrite gallery.json without
   *  it. Real delete — the files are gone from disk (re-runnable only by
   *  re-executing scripts/extract_figures.ts). */
  async function deleteFigure(fig: FigureItem) {
    if (figureDeleting[fig.id]) return;
    figureDeleting = { ...figureDeleting, [fig.id]: true };
    try {
      await fetch(volumeUrl(fig.file), { method: 'DELETE' });
      await fetch(volumeUrl(fig.thumb), { method: 'DELETE' });
      // Rewrite gallery.json without this figure so a reload stays consistent.
      const next = figures.filter((f) => f.id !== fig.id);
      await fetch(volumeUrl('figures/gallery.json'), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ generated_at: figuresLoadedAt ?? new Date().toISOString(), items: next }),
      });
      figures = next;
      // If the deleted figure's draft tab is open, leave it — the user
      // may still be working on it; only the gallery entry is gone.
    } catch {
      /* leave the figure in place on failure — a reload will resync */
    } finally {
      const { [fig.id]: _, ...rest } = figureDeleting;
      figureDeleting = rest;
    }
  }

  async function loadFiguresGallery() {
    try {
      const r = await fetch(volumeUrl('figures/gallery.json'), { cache: 'no-store' });
      if (!r.ok) return;
      const payload = await r.json();
      if (Array.isArray(payload?.items)) {
        figures = payload.items as FigureItem[];
        figuresLoadedAt = payload.generated_at ?? null;
      }
    } catch { /* no gallery yet — silent */ }
  }

  /** Stub .ts source for a freshly-opened figure draft — a blank
   *  component skeleton. The Inspector's Svelte tab shows this; the
   *  user (or the AI Refine tab) fills in the geometry from the figure
   *  on the Picture tab. Mirrors the shape overnight_extract.ts emits. */
  function draftStubSource(draftId: string, figureId: string): string {
    return `import { tube, cyl, mv, rot, M } from '../manifold-helpers';
import { defineGeom } from '.';

export const meta = {
  id: '${draftId}',
  name: '${figureId}',
  description: '',
  tags: ['draft'],
  params: {},
} as const;

// Not constructed yet — the reference figure is on the Picture tab.
// Describe the part in the AI Refine tab, or write the geom by hand.
export const geom = defineGeom(meta, (_p) => cyl(1, 1));
`;
  }

  /** Open a gallery figure as a BLANK component-builder draft: the full
   *  xml-primitive UI (Render + Picture stage tabs, Inspector) backed by
   *  a synthetic empty ComponentEntry. The Picture tab shows the
   *  extract-N.png; the Render tab shows an "not constructed yet"
   *  empty-state because there's no geometry yet. This is the figure
   *  "as a component, before it's been constructed". */
  function openFigureAsDraft(fig: FigureItem) {
    const draftId = fig.id.replace(/-/g, '_'); // extract-7 → extract_7
    const id = `draft:${draftId}`;
    if (openTabs.find((t) => t.id === id)) {
      activeTabId = id;
      stageTab = 'picture';
      pictureLoadStatus = 'loading';
      return;
    }
    const entry: ComponentEntry = {
      meta: { id: draftId, name: fig.id, description: '', tags: ['draft'], params: {} },
      // Never invoked — the build effect short-circuits on `unconstructed`.
      geom: () => { throw new Error('figure draft has no geometry yet'); },
      source: draftStubSource(draftId, fig.id),
      instructions: '',
      // A figure draft becomes a library/test part on first save.
      origin: 'test',
      renderMode: 'server',
    };
    openTabs = [
      ...openTabs,
      {
        id, kind: 'xml-primitive', componentEntry: entry, primId: draftId,
        label: fig.id, params: {}, draft: true, vars: [],
        pictureUrl: volumeUrl(fig.file), figureFile: fig.file, unconstructed: true,
      },
    ];
    activeTabId = id;
    stageTab = 'picture';
    pictureLoadStatus = 'loading';
  }

  /** Status badge per extraction result while it's being promoted to
   *  a real primitive. The Test-tab rendering surfaces the in-flight
   *  state (`…`) and the post-save state (`●` when in the registry). */
  let extractionPromoteStatus = $state<Record<string, 'idle' | 'promoting' | 'error'>>({});
  let extractionPromoteError = $state<Record<string, string>>({});

  /** Kept around for backward-compat with any earlier callers that
   *  expected source-iframe behavior; new UI calls
   *  promoteAndOpenExtraction. Inline preview can come back if needed. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function _openExtractionInlinePreview(_entry: ExtractionResult) { /* unused */ }

  /** Promote an extracted .ts to a real primitive: fetch the file,
   *  POST it to /api/components/save, refresh the registry, then open
   *  it as a regular xml-primitive tab. The user sees the full
   *  /primitives UI — stage Render + Picture sub-tabs, params strip,
   *  AI Refine, etc. */
  async function promoteAndOpenExtraction(entry: ExtractionResult) {
    extractionPromoteError = { ...extractionPromoteError, [entry.id]: '' };
    // Fast path: if the registry already has it, just open.
    const existing = componentList.find((c) => c.meta.id === entry.id);
    if (existing) {
      openRunes(existing);
      return;
    }
    extractionPromoteStatus = { ...extractionPromoteStatus, [entry.id]: 'promoting' };
    try {
      const srcRes = await fetch(`/tests/extracted/${entry.id}/final.ts`);
      if (!srcRes.ok) throw new Error(`fetch final.ts failed: ${srcRes.status}`);
      const source = await srcRes.text();
      const saveRes = await fetch('/api/components/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: entry.id, source, create: true }),
      });
      if (!saveRes.ok && saveRes.status !== 409) {
        const text = await saveRes.text().catch(() => '');
        throw new Error(`save failed: ${saveRes.status} ${text.slice(0, 200)}`);
      }
      // Copy the source figure into the volume as components/<id>.source.png
      // so the stage Picture tab shows the original PDF page next to the
      // 3D render. Non-fatal — a missing figure just leaves Picture empty.
      if (entry.source_image) {
        try {
          const imgRes = await fetch(entry.source_image);
          if (imgRes.ok) {
            const blob = await imgRes.blob();
            await fetch(`/api/volume?path=${encodeURIComponent(`components/${entry.id}.source.png`)}`, {
              method: 'PUT',
              body: blob,
              headers: { 'content-type': 'image/png' },
            });
          }
        } catch { /* figure copy is best-effort */ }
      }
      // 409 means the id ALREADY exists in the registry (likely from a
      // prior promote in this session) — treat as success and open it.
      // Brief wait for Vite HMR to rebundle the new entry, then reload
      // the registry. Tightening this is a polish task.
      await new Promise((r) => setTimeout(r, 800));
      componentList = await loadComponentRegistry();
      const fresh = componentList.find((c) => c.meta.id === entry.id);
      if (!fresh) throw new Error(`saved but not in registry — Vite still rebundling. Refresh the page.`);
      extractionPromoteStatus = { ...extractionPromoteStatus, [entry.id]: 'idle' };
      openRunes(fresh);
    } catch (e: any) {
      extractionPromoteStatus = { ...extractionPromoteStatus, [entry.id]: 'error' };
      extractionPromoteError = { ...extractionPromoteError, [entry.id]: e?.message ?? String(e) };
    }
  }

  function openTestLink(link: TestLink) {
    // Reuse the existing source-tab plumbing — same iframe shell, same
    // tab kind. id is namespaced 'tl:' so it doesn't collide with the
    // 'src:' tabs from the Sources sub-tab.
    const id = `tl:${link.id}`;
    if (openTabs.find((t) => t.id === id)) {
      activeTabId = id;
      return;
    }
    openTabs = [
      ...openTabs,
      {
        id, kind: 'source', primId: '', label: link.label ?? link.url,
        sourceUrl: link.url, sourceLabel: link.label ?? link.url,
        params: {}, draft: false, vars: [],
      },
    ];
    activeTabId = id;
  }

  /** Click-outside Svelte action. Mounts a document-level listener that
   *  fires `cb()` on any mousedown outside `node`. Used by the family
   *  filter popup so a click anywhere else dismisses it — except the
   *  anchor button itself (it has its own toggle handler). */
  function clickOutside(node: HTMLElement, cb: () => void) {
    function onDown(e: MouseEvent) {
      const t = e.target as Node | null;
      if (!t) return;
      if (node.contains(t)) return;
      if (familyFilterBtn && familyFilterBtn.contains(t)) return;
      cb();
    }
    document.addEventListener('mousedown', onDown, true);
    return { destroy() { document.removeEventListener('mousedown', onDown, true); } };
  }
  /** Operator catalog — the Operator tab's content. Each entry is a
   *  named operation with a short description and the snippet that
   *  gets spliced into the active geom body on click. Snippets are
   *  intentionally `// TODO: …` lines; real builders come in future
   *  PRs as each operator gets implemented. */
  const OPERATORS = [
    { id: 'cut-slot',    name: 'Cut slot',    glyph: '▭', desc: 'Subtract a rectangular slot from the body.',
      snippet: '// TODO: cut slot — subtract a box from `body` at (x,y,z) with dims (w,h,d)' },
    { id: 'extrude',     name: 'Extrude',     glyph: '⇡', desc: 'Sweep a 2D profile along an axis.',
      snippet: '// TODO: extrude — take a CrossSection and extrude by `length`' },
    { id: 'twist',       name: 'Twist',       glyph: '↻', desc: 'Rotate cross-sections progressively along Z.',
      snippet: '// TODO: twist — apply progressive rotation along Z' },
    { id: 'roll',        name: 'Roll',        glyph: '◐', desc: 'Cylindrical roll / bend along a path.',
      snippet: '// TODO: roll — bend along a cylindrical path' },
    { id: 'cut-threads', name: 'Cut threads', glyph: '⫯', desc: 'Cut a helical thread groove.',
      snippet: '// TODO: cut threads — helical groove, pitch=… depth=…' },
  ] as const;
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
    /** Component-family classification (same vocabulary the Components tab
     *  uses). Set in /kb/index.json. Unknown values default to 'basic' so
     *  un-classified KBs are still visible. */
    family?: Family;
    /** Path to the KB JSON (used to fetch source metadata at mount time). */
    path?: string;
  }
  /** A source document underlying one or more KB entries. The Sources tab
   *  shows one row per unique source (deduped across KBs); families come
   *  from the KB(s) it feeds. */
  interface KbSource {
    /** Stable key: url if present, otherwise file path. */
    key: string;
    /** Human-facing label. Falls back to URL host or filename. */
    label: string;
    url?: string;
    file?: string;
    kind?: string;
    /** Family of the source (drives sidebar grouping). */
    family: Family;
    /** Title(s) of the KB(s) this source feeds (kept for backwards
     *  compat with the per-row sub-line; populated empty for entries
     *  loaded directly from the volume sidecar). */
    kbTitles: string[];
  }
  let kbList = $state<KbEntry[]>([]);
  let kbListError = $state<string | null>(null);
  let kbSources = $state<KbSource[]>([]);
  let kbSourcesError = $state<string | null>(null);
  onMount(async () => {
    // KB list still comes from the bundled /kb/index.json — those are
    // shipped tables and the list is small. Sources, on the other hand,
    // come from the persistent volume via /api/kb/sources so PDFs
    // uploaded after the deploy appear without rebuilds.
    try {
      const r = await fetch('/api/volume?path=kb/index.json', { cache: 'no-cache' });
      if (!r.ok) throw new Error(`${r.status}`);
      const data = await r.json();
      kbList = (data.kbs ?? []).map((k: any) => ({
        id: k.id, title: k.title, description: k.description, row_count: k.row_count,
        source_kind: k.source_kind, categories: k.categories ?? [],
        family: (k.family ?? 'basic') as Family,
        path: k.path,
      }));
    } catch (e: any) {
      kbListError = e?.message ?? String(e);
    }
    try {
      const r = await fetch('/api/kb/sources', { cache: 'no-cache' });
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      const data = await r.json();
      kbSources = (data.sources ?? []).map((s: any) => ({
        key: s.key,
        label: s.label,
        url: s.url,
        file: s.file,
        kind: s.kind,
        family: (s.family ?? 'basic') as Family,
        kbTitles: s.title ? [s.title] : [],
      }));
    } catch (e: any) {
      kbSourcesError = e?.message ?? String(e);
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

  /** Open a Sources row as a main tab with an embedded document viewer.
   *  URL → iframe the URL directly; local PDF → iframe via the
   *  /api/kb/source-pdf endpoint. Multiple distinct sources can have
   *  the same display label, so the tab id uses the dedup key. */
  function openSource(src: KbSource) {
    const id = `src:${src.key}`;
    if (openTabs.find((t) => t.id === id)) {
      activeTabId = id;
      return;
    }
    openTabs = [
      ...openTabs,
      {
        id, kind: 'source', primId: '', label: src.label,
        sourceUrl: src.url, sourceFile: src.file, sourceLabel: src.label, sourceKind: src.kind,
        params: {}, draft: false, vars: [],
      },
    ];
    activeTabId = id;
  }

  /** Generate a tubing composite from a casing-tubing KB row + open it as
   *  a tab. Inputs come straight off the row; the rules in
   *  src/lib/cad/rules/tubing.ts handle KB lookup + geometry build.
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

  function openRunes(entry: ComponentEntry) {
    const id = `xml:${entry.meta.id}`;
    if (openTabs.find((t) => t.id === id)) {
      activeTabId = id;
      return;
    }
    // Seed params from the component meta so the slider grid is populated.
    // buildPrimitiveManifold consults COMPONENT_REGISTRY directly, so the
    // geometry pipeline picks up entry.geom by id without further wiring.
    const seed = defaultsFor(entry.meta);
    const tab: Tab = { id, kind: 'xml-primitive', componentEntry: entry, primId: entry.meta.id, label: entry.meta.name, params: seed, draft: false, vars: [] };
    // A library part carries a ready picture URL in `entry.picture`
    // (the dev-local /api/components/picture endpoint). Wire it onto the
    // tab so the Picture stage tab shows it — the picture travels with
    // the part across categories.
    if (entry.picture) tab.pictureUrl = entry.picture;
    openTabs = [...openTabs, tab];
    activeTabId = id;
    // Pull the persisted prompt history so the AI tab's History sub-tab
    // shows past refines for this component, not just this session's.
    loadPromptHistory(tab);
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
  let sidebarWidth = $state(264);
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
  /** Tab-level info popover — opens off the `i` icon next to the
   *  stage title, shows the primitive's description (and a pointer to
   *  the MD tab if a longer notes doc exists). Single shared bit since
   *  only one tab is active at a time. */
  let stageInfoOpen = $state(false);
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
  type InspectorTab = 'params' | 'svelte' | 'parts' | 'ai' | 'script';
  // Default to Parts — it's the leftmost tab for single-file components and the
  // module-library affordance is the most useful entry point. The snap-tab
  // effect below redirects to 'params' when the active tab is a legacy
  // primitive (no Parts tab there).
  let inspectorTab = $state<InspectorTab>('parts');
  /** Sub-tab inside the AI inspector tab's prompt area: the live Prompt
   *  input vs. the persisted History of past refines. */
  let aiSubTab = $state<'prompt' | 'history'>('prompt');
  /** Instructions section view — `edit` shows the raw textarea, `preview`
   *  renders the markdown. Defaults to preview so the spec reads nicely;
   *  the user flips to edit to change it. */
  let instructionsView = $state<'edit' | 'preview'>('preview');
  /** Collapsed param-group accordion headers, keyed `<tabId>:<group>` so
   *  collapse state is per-tab. In-memory only — refresh resets. Params
   *  with a `group` field render as collapsible accordion sections. */
  let collapsedParamGroups = $state<Set<string>>(new Set());
  function toggleParamGroupCollapse(tabId: string, group: string) {
    const key = `${tabId}:${group}`;
    const next = new Set(collapsedParamGroups);
    if (next.has(key)) next.delete(key); else next.add(key);
    collapsedParamGroups = next;
  }
  function isParamGroupCollapsed(tabId: string, group: string): boolean {
    return collapsedParamGroups.has(`${tabId}:${group}`);
  }

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
  // Async component registry — fetched from /api/components/list. Replaces the
  // static `import.meta.glob` import so newly-created primitives appear
  // in the sidebar without a dev-server restart.
  let componentList = $state<ComponentEntry[]>([]);
  let componentListError = $state<string | null>(null);
  async function refreshRunesList() {
    try {
      componentList = await loadComponentRegistry();
      componentListError = null;
    } catch (e: any) {
      componentListError = e?.message ?? String(e);
    }
  }

  // ── Entry classification ─────────────────────────────────────────────────
  // A component's sidebar placement comes from `origin`:
  //   - 'bundle' — one of the 26 baseline primitives; classified by the
  //     central families.ts maps (FAMILY_BY_ID / LEVEL_BY_ID).
  //   - 'test' | 'basic' | 'parts' | 'assemblies' — a library part; the
  //     origin IS the rail tab (its directory location IS its category).
  //     family/level come from the part's meta.json.
  function entryFamily(e: ComponentEntry): Family {
    if (e.family) return e.family as Family;
    return familyOf(e.meta.id);
  }
  function entryLevel(e: ComponentEntry): Level {
    if (e.level) return e.level as Level;
    return levelOf(e.meta.id);
  }
  /** Which rail tab an entry belongs in. */
  function entryRailTab(e: ComponentEntry): 'test' | 'basic' | 'components' | 'assemblies' {
    if (e.origin === 'test') return 'test';
    if (e.origin === 'basic') return 'basic';
    if (e.origin === 'parts') return 'components';
    if (e.origin === 'assemblies') return 'assemblies';
    // bundle — classify via families.ts.
    return familyOf(e.meta.id) === 'basic' ? 'basic' : 'components';
  }

  // ── Move (promote a Test-tab part into a category) ───────────────────────
  // The Move button on a Test-tab row opens this inline form; on confirm it
  // calls /api/components/move, which atomically renames the part's whole
  // directory into the target category dir + writes its meta.json.
  let moveForm = $state<{
    id: string;
    category: 'basic' | 'parts' | 'assemblies';
    family: Family;
    level: Level;
    error: string;
    moving: boolean;
  } | null>(null);

  function openMoveForm(id: string) {
    moveForm = moveForm?.id === id
      ? null
      : { id, category: 'parts', family: 'casing_tubing', level: 1, error: '', moving: false };
  }

  async function submitMove() {
    if (!moveForm) return;
    moveForm.error = '';
    moveForm.moving = true;
    const payload: Record<string, unknown> = { id: moveForm.id, category: moveForm.category };
    if (moveForm.category === 'parts') payload.family = moveForm.family;
    if (moveForm.category === 'basic') payload.level = moveForm.level;
    try {
      const r = await fetch('/api/components/move', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const txt = await r.text().catch(() => '');
        moveForm.error = `${r.status} — ${txt.slice(0, 160)}`;
        moveForm.moving = false;
        return;
      }
      // Refresh so the part leaves Test and shows up in its new tab.
      await refreshRunesList();
      moveForm = null;
    } catch (e: any) {
      moveForm.error = e?.message ?? String(e);
      moveForm.moving = false;
    }
  }

  // Sidebar "+ New primitive" form — creates a fresh component file via the
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
    if (componentList.find((e) => e.meta.id === id)) {
      newPrimForm.error = `"${id}" already exists.`;
      return;
    }
    newPrimForm.saving = true;
    newPrimForm.error = '';
    // Blank-slate stub. The AI tab is the primary authoring surface for
    // new primitives — describe what you want there, accept the proposal,
    // and the params + geom land here. NO placeholder shape — the stage
    // shows the "Not constructed yet" empty-state via the tab's
    // `unconstructed` flag set below (mirrors the figure-draft flow).
    // The geom body throws if it ever runs before real geometry replaces
    // it, so the user can't accidentally save the stub and see a stray
    // cylinder.
    const stub = `import { defineGeom } from '.';

export const meta = {
  id: '${id}',
  name: '${name.replace(/'/g, "\\'")}',
  description: '',
  tags: [],
  params: {},
} as const;

// geom is the part accumulator — \`geom.add(part)\` is the only line
// shape the Parts tab emits. The framework provides geom (an empty
// seed) and reads the final mesh out, so this body has no \`let geom\`
// init and no \`return\` — adding parts is purely additive.
export const geom = defineGeom(meta, (p, geom) => {
});
`;
    try {
      const r = await fetch('/api/components/save', {
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
      // Success — the new part lands in library/test (the holding pen),
      // not directly in a category. Re-fetch the registry, switch the
      // sidebar to the Test tab so the user sees where it went, and
      // auto-open it as a tab.
      newPrimForm = null;
      await refreshRunesList();
      sidebarTab = 'test';
      const fresh = componentList.find((e) => e.meta.id === id);
      if (fresh) {
        openRunes(fresh);
        // Brand-new stub has no geometry yet — show the empty-state
        // instead of letting the build $effect run a throwing geom.
        // Cleared on first save (see saveRunesSource).
        const tab = openTabs.find((t) => t.id === `xml:${fresh.meta.id}`);
        if (tab) tab.unconstructed = true;
      }
    } catch (e: any) {
      newPrimForm.error = e?.message ?? String(e);
      newPrimForm.saving = false;
    }
  }

  // ── Derived-param helpers — UI-side resolution + display formatting ─────
  // The same resolveDerived() logic ships in src/lib/cad/components/index.ts
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

  /** Build the hover tooltip text for a param's key chip. Multi-line
   *  (the CSS uses `white-space: pre-line`). Skips repeating the
   *  variable name (already visible as the chip itself) — surfaces the
   *  human label, optional description, numeric range / step, default,
   *  and whether this is an extra param the schema doesn't declare. */
  function buildParamTip(_key: string, def: any, isExtra: boolean): string {
    const lines: string[] = [];
    const labelLine = def.unit ? `${def.label} (${def.unit})` : def.label;
    lines.push(labelLine);
    if (def.description) lines.push(def.description);
    if (typeof def.min === 'number' && typeof def.max === 'number') {
      const stepBit = typeof def.step === 'number' && def.step !== 1 ? `, step ${def.step}` : '';
      lines.push(`Range: ${def.min} – ${def.max}${stepBit}`);
    }
    if (typeof def.default === 'number') lines.push(`Default: ${def.default}`);
    if (def.type && def.type !== 'numeric') lines.push(`Type: ${def.type}`);
    if (isExtra) lines.push('Extra param — not declared in the source schema (the * suffix marks this).');
    return lines.join('\n');
  }

  /** Same idea for derived values. No min/max/step — they're computed,
   *  not sliders. Surfaces the label, optional description, unit, and a
   *  "computed" marker so the user understands it's read-only. */
  function buildDerivedTip(_key: string, schema: any): string {
    const lines: string[] = [];
    const labelLine = schema.unit ? `${schema.label} (${schema.unit})` : schema.label;
    lines.push(labelLine);
    if (schema.description) lines.push(schema.description);
    lines.push('Computed from other params · read-only');
    return lines.join('\n');
  }

  // ── Parts library — what the geom function can import + compose ─────────
  // The Inspector's Svelte tab renders this as a left rail. Each entry is a
  // module that exports a Manifold-returning function:
  //   • Helpers from manifold-helpers (cyl, tube, mv, rot) — primitive Manifold ops.
  //   • Other single-file components — each `geom(p)` returns a Manifold, so they
  //     compose via union/subtract/etc. inside a more complex part.
  //
  // Click an entry → snippet (import line at top + call at bottom) is
  // appended to the editor's source draft so the user can move it where
  // needed. We don't mutate the saved file until the user hits Save.
  // Catalog is derived from the actual `@part`-tagged exports in
  // manifold-helpers.ts. Adding a new helper (with the `/** @part … */`
  // JSDoc tag) automatically surfaces it here — no UI edits needed.
  const HELPERS = discoverHelpers();

  /** Static suggestions surfaced in the SVELTE-tab editor's autocomplete.
   *  Combined per-render with the active primitive's params + derived
   *  keys (see buildEditorCompletions below). Helpers are sourced from
   *  discoverHelpers() so the catalog stays in sync with the @part tags
   *  in manifold-helpers.ts. Manifold methods are hand-listed — these
   *  are runtime chains, not exported functions, so they don't show up
   *  in any source file we could parse. */
  const MANIFOLD_METHODS: Completion[] = [
    { label: 'translate', type: 'method', detail: '([x,y,z])', info: 'Chainable translate — equivalent to mv(m, vec).' },
    { label: 'rotate',    type: 'method', detail: '([rx,ry,rz])', info: 'Chainable rotate in degrees.' },
    { label: 'add',       type: 'method', detail: '(other)',  info: 'Union (CSG) — merge two Manifolds.' },
    { label: 'subtract',  type: 'method', detail: '(other)',  info: 'Difference — carve `other` out of this.' },
    { label: 'intersect', type: 'method', detail: '(other)',  info: 'Intersection — keep only the overlap.' },
    { label: 'scale',     type: 'method', detail: '([sx,sy,sz])' },
    { label: 'mirror',    type: 'method', detail: '([x,y,z])' },
    { label: 'warp',      type: 'method', detail: '(fn)' },
  ];

  const DSL_FUNCS: Completion[] = [
    { label: 'defineGeom', type: 'function', detail: '(meta, build)', info: 'Sugar wrapper — bind meta and destructure params in build.' },
  ];

  function buildEditorCompletions(m: PrimitiveMeta): Completion[] {
    const helpers: Completion[] = HELPERS.map((h) => ({
      label: h.name,
      type: 'function',
      detail: `(${h.sig.slice(h.name.length + 1, -1)})`,
      info: h.desc,
    }));
    const params: Completion[] = Object.entries(m.params).map(([k, schema]) => ({
      label: k,
      type: 'variable',
      detail: `param · ${schema.unit ?? ''}`.trim(),
      info: schema.label,
    }));
    const derived: Completion[] = Object.entries(m.derived ?? {}).map(([k, schema]) => ({
      label: k,
      type: 'variable',
      detail: `derived · ${schema.unit ?? ''}`.trim(),
      info: schema.label,
    }));
    return [...helpers, ...DSL_FUNCS, ...MANIFOLD_METHODS, ...params, ...derived];
  }

  /** Insert a line into the geom function body, right before the closing
   *  `};`. Brace-walks the body so nested `{}` (object literals, arrow
   *  functions in params, etc.) don't fool us. Falls back to appending at
   *  the end of the source if the geom function can't be located. The
   *  inserted line carries a `// + part:` marker so the user can grep for
   *  recently-added scaffolding and wire it into their return. */
  function insertIntoGeomBody(src: string, line: string): string {
    // Match BOTH shapes:
    //   (1) legacy: `export const geom = (p: Record<string, number>) => {`
    //   (2) DSL:    `export const geom = defineGeom(meta, (args) => {`
    // For shape (2) we have to balanced-paren past `defineGeom(meta, (...)`
    // so the arrow's `{` is the one we open the brace-walk against.
    const dslRe = /export\s+const\s+geom\s*=\s*defineGeom\s*\(\s*meta\s*,\s*\(/;
    const dm = dslRe.exec(src);
    let open: number;
    if (dm) {
      // Skip the destructure parens.
      let i = dm.index + dm[0].length;
      let depth = 1;
      while (i < src.length && depth > 0) {
        const c = src[i];
        if (c === '(') depth++;
        else if (c === ')') { depth--; if (depth === 0) break; }
        i++;
      }
      if (depth !== 0) return src.replace(/\s*$/, '') + `\n${line}\n`;
      i++; // past `)`
      while (i < src.length && /\s/.test(src[i])) i++;
      if (src.slice(i, i + 2) !== '=>') return src.replace(/\s*$/, '') + `\n${line}\n`;
      i += 2;
      while (i < src.length && /\s/.test(src[i])) i++;
      if (src[i] !== '{') return src.replace(/\s*$/, '') + `\n${line}\n`;
      open = i + 1;
    } else {
      const re = /export\s+const\s+geom\s*=\s*\([^)]*\)\s*=>\s*\{/;
      const m = re.exec(src);
      if (!m) return src.replace(/\s*$/, '') + `\n${line}\n`;
      open = m.index + m[0].length;
    }
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

  /** Build a starter call from the helper's typed props metadata, using
   *  each prop's literal default. The strict-grammar GUI emits ONLY
   *  atom-or-param-ref bindings, so the initial add always starts with
   *  literals — the user later edits each prop via the row's ✎ to link
   *  a param (writes `p.<name>` instead of a number). */
  function defaultHelperCall(name: string, _paramKeys: Set<string>): string {
    const helper = HELPERS.find((h) => h.name === name);
    if (!helper) return `${name}()`;
    const args = helper.props.map((p) => String(p.default));
    return `${name}(${args.join(', ')})`;
  }

  /** A single positional argument inside an instance call. The strict-
   *  grammar GUI only allows two shapes; anything else falls into
   *  `unknown` so the UI can still display the raw text. */
  type PartArg =
    | { kind: 'literal'; raw: string; value: number }
    | { kind: 'paramRef'; raw: string; name: string }
    | { kind: 'unknown'; raw: string };

  /** One instance line parsed out of the body: `const A = tube(0.5, 0.4, 4);`
   *  followed by `geom.add(A);`. Args are positional and matched against
   *  the helper's typed props by index. */
  interface PartInstance {
    /** const name on the LHS — `A`, `B`, … */
    instance: string;
    /** Function being called — `tube`, `cyl`, or a component alias. */
    callName: string;
    args: PartArg[];
    /** Byte offset where the const declaration starts (for surgical edits). */
    callStart: number;
    /** Byte offset of the closing `)` of the call. */
    callEnd: number;
  }

  /** Parse every `const X = name(args); geom.add(X);` pair out of the
   *  geom body. Tolerates extra whitespace; ignores any other code shape.
   *  Returns instances in source order. */
  function parsePartInstances(src: string): PartInstance[] {
    const out: PartInstance[] = [];
    const constRe = /\bconst\s+([A-Z][A-Z0-9]*)\s*=\s*(\w+)\s*\(/g;
    for (const m of src.matchAll(constRe)) {
      const instance = m[1];
      const callName = m[2];
      const callStart = m.index!;
      // Find matching closing paren — walk with paren depth.
      let i = m.index! + m[0].length;
      let depth = 1;
      let inS: '"' | "'" | '`' | null = null;
      while (i < src.length && depth > 0) {
        const c = src[i];
        if (inS) {
          if (c === '\\') { i += 2; continue; }
          if (c === inS) inS = null;
        } else {
          if (c === '"' || c === "'" || c === '`') inS = c as any;
          else if (c === '(') depth++;
          else if (c === ')') { depth--; if (depth === 0) break; }
        }
        i++;
      }
      if (depth !== 0) continue;
      const callEnd = i;
      // Require a matching `geom.add(<instance>);` somewhere after this.
      const addRe = new RegExp(`geom\\.add\\(\\s*${instance}\\s*\\)\\s*;`);
      if (!addRe.test(src.slice(callEnd))) continue;
      const argText = src.slice(m.index! + m[0].length, callEnd);
      out.push({ instance, callName, args: parsePartArgs(argText), callStart, callEnd });
    }
    return out;
  }

  /** Split a positional-args string by top-level commas, then classify
   *  each segment as a literal number, a param ref (`p.<name>`), or
   *  unknown (anything else — preserved as raw text). */
  function parsePartArgs(argText: string): PartArg[] {
    const segs = splitTopLevel(argText);
    return segs.map((raw): PartArg => {
      const t = raw.trim();
      if (/^-?\d+(\.\d+)?$/.test(t)) return { kind: 'literal', raw: t, value: Number(t) };
      const pm = /^p\.(\w+)$/.exec(t);
      if (pm) return { kind: 'paramRef', raw: t, name: pm[1] };
      return { kind: 'unknown', raw: t };
    });
  }

  /** Comma-split that respects nested parens / braces / strings — the
   *  helper args may contain expressions like `[0, 0, p.length]` once
   *  transforms come back in (`mv(part, [0,0,0])`). */
  function splitTopLevel(s: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let start = 0;
    let inS: '"' | "'" | '`' | null = null;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inS) {
        if (c === '\\') { i++; continue; }
        if (c === inS) inS = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') { inS = c as any; continue; }
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') depth--;
      else if (c === ',' && depth === 0) {
        out.push(s.slice(start, i));
        start = i + 1;
      }
    }
    const tail = s.slice(start).trim();
    if (tail) out.push(s.slice(start));
    return out;
  }

  /** Rewrite a single positional arg of an instance call. Used by the
   *  inline number input in the per-instance Props row. Returns the new
   *  source or `null` if the instance / arg can't be found. */
  function setInstanceArg(src: string, instance: string, argIdx: number, newRaw: string): string | null {
    const insts = parsePartInstances(src);
    const inst = insts.find((p) => p.instance === instance);
    if (!inst) return null;
    if (argIdx < 0 || argIdx >= inst.args.length) return null;
    // Slice out the raw `( <args> )` text and replace just the one arg.
    const callOpenIdx = src.indexOf('(', inst.callStart);
    if (callOpenIdx < 0) return null;
    const argText = src.slice(callOpenIdx + 1, inst.callEnd);
    const segs = splitTopLevel(argText);
    segs[argIdx] = ` ${newRaw}`;
    return src.slice(0, callOpenIdx + 1) + segs.join(',') + src.slice(inst.callEnd);
  }

  /** Find the next unused single-letter instance name (A, B, …, Z, AA, AB,
   *  …). Scans the source for existing `const <NAME>` declarations to
   *  avoid collisions. */
  function uniqueInstanceName(src: string): string {
    const used = new Set<string>();
    for (const m of src.matchAll(/\bconst\s+([A-Z][A-Z0-9]*)\s*=/g)) used.add(m[1]);
    for (let i = 0; i < 26 * 27; i++) {
      const a = i < 26 ? '' : String.fromCharCode(65 + Math.floor(i / 26) - 1);
      const b = String.fromCharCode(65 + (i % 26));
      const name = a + b;
      if (!used.has(name)) return name;
    }
    return `P_${Date.now()}`;
  }

  /** Ensure the geom body has the accumulator scaffold:
   *    let geom = empty();
   *    ...
   *    return geom;
   *  - Strips a "Not constructed yet" throw if present (fresh stub).
   *  - Imports `empty` from manifold-helpers (used as the seed).
   *  - Adds the init line if missing.
   *  - Adds the return if missing.
   *  Idempotent: re-running on a properly scaffolded body is a no-op. */
  function ensureGeomScaffold(src: string): string {
    let next = src;
    // 1. Drop the stub throw if present (one statement, replace with nothing).
    next = next.replace(
      /\s*throw new Error\('Not constructed yet[^']*'\);\s*/,
      '\n  ',
    );
    // 2. Ensure the body's arrow takes (p, geom) — the new strict-grammar
    //    shape. defineGeom dispatches on arity: 2-arg body operates on a
    //    framework-provided GeomAcc, no `let geom = empty();` / `return geom;`
    //    boilerplate required. Convert `(p)` → `(p, geom)` if needed.
    next = next.replace(
      /(defineGeom\s*\(\s*meta\s*,\s*\(\s*)p(\s*\)\s*=>\s*\{)/,
      '$1p, geom$2',
    );
    // 3. Strip legacy boilerplate (`let geom = empty();`, `return geom;`)
    //    in case we're migrating a partially-scaffolded file. The new shape
    //    has neither.
    next = next.replace(/\n?\s*let\s+geom\s*=\s*empty\(\)\s*;\s*\n?/, '\n  ');
    next = next.replace(/\n?\s*return\s+geom\s*;\s*\n?/, '\n');
    // 4. Drop the now-unused `empty` import if present (the new shape no
    //    longer needs it).
    next = stripImportName(next, '../manifold-helpers', 'empty');
    return next;
  }

  /** Remove a named import from a `from <module>` import statement. Drops
   *  the whole line if it was the only name. No-op if not present. */
  function stripImportName(src: string, modPath: string, name: string): string {
    const escMod = modPath.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    const re = new RegExp(`import\\s*\\{\\s*([^}]*)\\s*\\}\\s*from\\s*['"]${escMod}['"];?\\n?`);
    const m = re.exec(src);
    if (!m) return src;
    const names = m[1].split(',').map((s) => s.trim()).filter(Boolean).filter((n) => n !== name);
    if (names.length === 0) return src.slice(0, m.index) + src.slice(m.index + m[0].length);
    return src.slice(0, m.index) + `import { ${names.join(', ')} } from '${modPath}';\n` + src.slice(m.index + m[0].length);
  }

  /** Insert `line` at the TOP of the geom body (right after the opening
   *  brace), indented two spaces. Mirrors insertIntoGeomBody but for the
   *  prologue. */
  function insertAtGeomBodyTop(src: string, line: string): string {
    const dslRe = /export\s+const\s+geom\s*=\s*defineGeom\s*\(\s*meta\s*,\s*\(/;
    const dm = dslRe.exec(src);
    let open: number;
    if (dm) {
      let i = dm.index + dm[0].length;
      let depth = 1;
      while (i < src.length && depth > 0) {
        const c = src[i];
        if (c === '(') depth++;
        else if (c === ')') { depth--; if (depth === 0) break; }
        i++;
      }
      if (depth !== 0) return src;
      i++;
      while (i < src.length && /\s/.test(src[i])) i++;
      if (src.slice(i, i + 2) !== '=>') return src;
      i += 2;
      while (i < src.length && /\s/.test(src[i])) i++;
      if (src[i] !== '{') return src;
      open = i + 1;
    } else {
      const re = /export\s+const\s+geom\s*=\s*\([^)]*\)\s*=>\s*\{/;
      const m = re.exec(src);
      if (!m) return src;
      open = m.index + m[0].length;
    }
    // Insert right after `{` with a leading newline.
    return src.slice(0, open) + `\n  ${line}` + src.slice(open);
  }

  /** Add a manifold-helpers import + a two-line instance block at the
   *  bottom of the geom body. Strict grammar — every arg starts as a
   *  numeric literal; the user later edits a prop to link a param. */
  function snippetForHelper(src: string, name: string, _paramKeys: Set<string>): string {
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
    next = ensureGeomScaffold(next);
    const baseCall = defaultHelperCall(name, _paramKeys);
    const instName = uniqueInstanceName(next);
    return insertIntoGeomBody(next, `const ${instName} = ${baseCall};\n  geom.add(${instName});`);
  }

  /** Add a component import (`geom as <id>Geom`) + a two-line instance
   *  block. The call uses the imported primitive's declared defaults. */
  function snippetForRunes(src: string, entry: ComponentEntry): string {
    const id = entry.meta.id;
    const alias = id.replace(/_(\w)/g, (_, c) => c.toUpperCase()) + 'Geom';
    let next = src;
    const importRe = new RegExp(`import\\s*\\{[^}]*\\bgeom as ${alias}\\b[^}]*\\}\\s*from\\s*['"]\\.\\/${id}['"];?`);
    if (!importRe.test(next)) {
      next = `import { geom as ${alias} } from './${id}';\n` + next;
    }
    next = ensureGeomScaffold(next);
    const defaults = Object.entries(entry.meta.params)
      .map(([k, v]: [string, any]) => `${k}: ${v?.default ?? 0}`)
      .join(', ');
    const instName = uniqueInstanceName(next);
    return insertIntoGeomBody(next, `const ${instName} = ${alias}({ ${defaults} });\n  geom.add(${instName});`);
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
   *  Returns [] for non-component sources (no meta block found). */
  function componentDefaultFolds(src: string): Array<{ from: number; to: number }> {
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

  /** Split a component source file into a header (imports + meta block,
   *  terminated by `} as const;`) and a body (everything from the next
   *  `export const geom` onward). The SVELTE-tab UI renders each half
   *  in its own CodeEditor so the meta block can collapse out of the
   *  way while the user focuses on construction code.
   *
   *  Brace-walks the meta object so nested literals (params, derived,
   *  validate) don't trip the split. Returns `{ header: src, body: '' }`
   *  on parse failure — the caller can detect this and fall back to a
   *  single editor without the user losing access to the file.
   *
   *  Stitching invariant: `header + body === src` (modulo the trailing
   *  newline that separates them, which we keep on the header side). */
  function splitRunesSource(src: string): { header: string; body: string; ok: boolean } {
    const metaRe = /export\s+const\s+meta\s*=\s*\{/;
    const m = metaRe.exec(src);
    if (!m) return { header: src, body: '', ok: false };
    // Brace-walk through the meta object to find its closing `}`.
    let i = m.index + m[0].length;
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
        else if (c === '}') { depth--; if (depth === 0) break; }
      }
      i++;
    }
    if (depth !== 0) return { header: src, body: '', ok: false };
    // Now consume ` as const;` (whitespace-tolerant) and the newline that
    // follows. If `as const` isn't there we still split — it's only a
    // convention, not a contract.
    let j = i + 1;
    const tail = src.slice(j);
    const asConstMatch = tail.match(/^\s*as\s+const\s*;/);
    if (asConstMatch) j += asConstMatch[0].length;
    // Eat ONE trailing newline so the body starts cleanly.
    if (src[j] === '\r') j++;
    if (src[j] === '\n') j++;
    return { header: src.slice(0, j), body: src.slice(j), ok: true };
  }

  /** Parse the `export const geom = defineGeom(meta, (args) => { body });`
   *  block produced by `splitRunesSource` (i.e. the file's tail after
   *  the meta export). Returns the destructure args (with outer parens)
   *  and the construction body (the text BETWEEN the curly braces of
   *  the arrow function).
   *
   *  Round-trip stable: stitching `defineGeom(meta, ${args} => {${body}});`
   *  re-parses to the same args + body. The user edits only `body`
   *  in the main editor; `args` displays read-only above.
   *
   *  Recognises BOTH geom shapes:
   *    - `export const geom = defineGeom(meta, (args) => { … });`
   *    - `export const geom = (args) => { … };`  (raw form, e.g. what
   *      the figure-extraction pipeline emits)
   *  Both render identically — `defineGeom` is just typing sugar — so
   *  the sectioned editor works for either. `ok: false` only when the
   *  geom export can't be found at all (broken syntax); the caller then
   *  falls back to a single full-source editor. */
  function splitGeomBody(rest: string): {
    ok: boolean;
    /** Everything in `rest` BEFORE the body — up to and INCLUDING the
     *  opening `{` of the arrow function. Used as the trailing piece
     *  of the collapsible header section. */
    scaffold: string;
    /** Read-only destructure args display, e.g. `({ od, wall, length })`. */
    args: string;
    /** Construction code BETWEEN the `{` and `}` of the geom function.
     *  This is what the main body editor binds to. */
    body: string;
    /** Everything in `rest` AFTER the body — typically `});` + trailing
     *  newline. Kept verbatim so save round-trips byte-stably. */
    tail: string;
  } {
    const fail = { ok: false as const, scaffold: rest, args: '', body: '', tail: '' };
    // Two accepted head shapes — try the defineGeom wrapper first, then
    // the raw `export const geom = (args) => …` form. Either way `i`
    // ends up pointing at the `(` of the arrow-function args, and the
    // args/body/tail parsing below is identical. `tail` is captured
    // verbatim, so the `});` (wrapped) vs `};` (raw) difference is
    // preserved automatically on save.
    const defineGeomRe = /defineGeom\s*\(\s*meta\s*,\s*/;
    const rawGeomRe = /export\s+const\s+geom\s*(?::[^=]+)?=\s*/;
    const m = defineGeomRe.exec(rest) ?? rawGeomRe.exec(rest);
    if (!m) return fail;
    let i = m.index + m[0].length;
    if (rest[i] !== '(') return fail;
    let depth = 1;
    const argStart = i;
    i++;
    while (i < rest.length && depth > 0) {
      const c = rest[i];
      if (c === '(') depth++;
      else if (c === ')') { depth--; if (depth === 0) break; }
      i++;
    }
    if (depth !== 0) return fail;
    const argsRaw = rest.slice(argStart, i + 1);
    i++; // past `)`
    while (i < rest.length && /\s/.test(rest[i])) i++;
    if (rest.slice(i, i + 2) !== '=>') return fail;
    i += 2;
    while (i < rest.length && /\s/.test(rest[i])) i++;
    if (rest[i] !== '{') return fail;
    const bodyOpen = i;
    depth = 1;
    i++;
    while (i < rest.length && depth > 0) {
      const c = rest[i];
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) break; }
      i++;
    }
    if (depth !== 0) return fail;
    return {
      ok: true,
      scaffold: rest.slice(0, bodyOpen + 1),
      args: argsRaw,
      body: rest.slice(bodyOpen + 1, i),
      tail: rest.slice(i),
    };
  }

  /** Parse a component source file into its three editable regions plus the
   *  read-only args. Returns `ok: false` if any layer doesn't parse —
   *  the SVELTE tab falls back to a single-editor view in that case. */
  function splitRune(src: string): {
    ok: boolean;
    /** imports + `export const meta = {...} as const;` + the `export
     *  const geom = defineGeom(meta, (args) => {` scaffold. Bound to
     *  the collapsible header editor. */
    header: string;
    /** Read-only args text — e.g. `({ od, wall, length })`. */
    args: string;
    /** Construction body. Bound to the main body editor. */
    body: string;
    /** Closing `});` and trailing newline. Hidden, preserved verbatim
     *  on save. */
    tail: string;
  } {
    const outer = splitRunesSource(src);
    if (!outer.ok) return { ok: false, header: src, args: '', body: '', tail: '' };
    const inner = splitGeomBody(outer.body);
    if (!inner.ok) return { ok: false, header: src, args: '', body: '', tail: '' };
    return {
      ok: true,
      header: outer.header + inner.scaffold,
      args: inner.args,
      body: inner.body,
      tail: inner.tail,
    };
  }

  /** Rewrite `sourceDraft` after one of the section editors fires
   *  onChange. The other two pieces (whichever the caller didn't edit)
   *  are re-read from the current source so concurrent edits to the
   *  header and body interleave correctly. */
  function applyHeaderEdit(tab: Tab, nextHeader: string) {
    const cur = tab.sourceDraft ?? tab.componentEntry?.source ?? '';
    const split = splitRune(cur);
    if (!split.ok) { tab.sourceDraft = nextHeader; return; }
    tab.sourceDraft = nextHeader + split.body + split.tail;
  }
  function applyBodyEdit(tab: Tab, nextBody: string) {
    const cur = tab.sourceDraft ?? tab.componentEntry?.source ?? '';
    const split = splitRune(cur);
    if (!split.ok) { tab.sourceDraft = nextBody; return; }
    tab.sourceDraft = split.header + nextBody + split.tail;
  }

  /** Reassemble a component file from its three logical parts. The header
   *  is taken verbatim (the user owns formatting choices there); the
   *  geom expression is emitted in a canonical shape so format-on-save
   *  has a stable starting point. */
  function stitchRunesSource(header: string, args: string, body: string): string {
    const h = header.endsWith('\n') ? header : header + '\n';
    return `${h}\nexport const geom = defineGeom(meta, ${args} => {${body}});\n`;
  }

  /** Drop the import line for a single-file component's geom. */
  function removeRunesImport(src: string, id: string): string {
    const importRe = new RegExp(`import\\s*\\{[^}]*\\bgeom as \\w+\\b[^}]*\\}\\s*from\\s*['"]\\.\\/${id}['"];?\\n?`);
    return src.replace(importRe, '');
  }

  /** Parse the source and return which helpers / single-file components are
   *  currently imported. The Parts tab renders ONLY these — the catalog
   *  (everything else available) sits behind an explicit "+ Add" picker.
   *  Encapsulation: each primitive surfaces just its own direct deps. */
  function importedFromSource(src: string): { helpers: Set<string>; components: Set<string> } {
    const helpers = new Set<string>();
    const components = new Set<string>();
    const helpersRe = /import\s*\{\s*([^}]*)\s*\}\s*from\s*['"]\.\.\/manifold-helpers['"];?/g;
    for (const m of src.matchAll(helpersRe)) {
      for (const n of m[1].split(',').map((s) => s.trim()).filter(Boolean)) helpers.add(n);
    }
    const componentRe = /import\s*\{[^}]*\bgeom as \w+\b[^}]*\}\s*from\s*['"]\.\/([a-z][a-z0-9_]*)['"];?/g;
    for (const m of src.matchAll(componentRe)) components.add(m[1]);
    return { helpers, components };
  }

  function removeHelper(name: string) {
    if (!activeTab || activeTab.kind !== 'xml-primitive' || !activeTab.componentEntry) return;
    const cur = activeTab.sourceDraft ?? activeTab.componentEntry.source;
    activeTab.sourceDraft = removeHelperImport(cur, name);
  }
  function removeRunes(id: string) {
    if (!activeTab || activeTab.kind !== 'xml-primitive' || !activeTab.componentEntry) return;
    const cur = activeTab.sourceDraft ?? activeTab.componentEntry.source;
    activeTab.sourceDraft = removeRunesImport(cur, id);
  }

  /** Remove a single instance: drops both the `const A = …(…);` line and
   *  its `geom.add(A);` follower. If that was the last reference to the
   *  helper, also strip the helper from the manifold-helpers import. */
  function removeInstance(instance: string) {
    if (!activeTab || activeTab.kind !== 'xml-primitive' || !activeTab.componentEntry) return;
    const cur = activeTab.sourceDraft ?? activeTab.componentEntry.source;
    const insts = parsePartInstances(cur);
    const target = insts.find((i) => i.instance === instance);
    if (!target) return;
    // Walk back to start-of-line for `const X = …(`
    let lineStart = target.callStart;
    while (lineStart > 0 && cur[lineStart - 1] !== '\n') lineStart--;
    // Forward to end of the const stmt (`;` + newline)
    let constEnd = target.callEnd + 1; // skip `)`
    while (constEnd < cur.length && cur[constEnd] !== '\n') constEnd++;
    if (cur[constEnd] === '\n') constEnd++;
    // Find + strip the `geom.add(<instance>);` line that follows.
    const addRe = new RegExp(`^[ \\t]*geom\\.add\\(\\s*${instance}\\s*\\)\\s*;?[ \\t]*\\n?`, 'm');
    const rest = cur.slice(constEnd);
    const addMatch = addRe.exec(rest);
    let next: string;
    if (addMatch) {
      const addStart = constEnd + addMatch.index;
      const addEnd = addStart + addMatch[0].length;
      next = cur.slice(0, lineStart) + cur.slice(addEnd);
    } else {
      next = cur.slice(0, lineStart) + cur.slice(constEnd);
    }
    // If the helper has no surviving callers, drop its import too.
    const remaining = parsePartInstances(next);
    const stillUsed = remaining.some((i) => i.callName === target.callName);
    if (!stillUsed) next = removeHelperImport(next, target.callName);
    activeTab.sourceDraft = next;
  }

  // Toggle the "+ Add" picker per section in the Parts tab. We keep these
  // at module scope rather than per-tab — picker open-state is cheap UI
  // chrome, doesn't need to survive tab switches.
  let partsAddHelperOpen = $state(false);
  let partsAddRunesOpen  = $state(false);
  // Search filter for the "+ Add primitive" picker. Reset every time the
  // picker closes so reopening starts fresh. Focus moves to this input on
  // open (see effect below) so the user can start typing immediately.
  let partsSearch = $state('');
  let partsSearchEl = $state<HTMLInputElement | null>(null);
  $effect(() => {
    if (partsAddHelperOpen) {
      // schedule focus after the input is mounted in the DOM
      requestAnimationFrame(() => partsSearchEl?.focus());
    } else {
      partsSearch = '';
    }
  });

  /** Splice an operator's TODO snippet into the active primitive's
   *  geom body. Uses the same insertIntoGeomBody pipeline as the Parts
   *  insertion so the snippet lands inside the defineGeom function. */
  function insertOperatorSnippet(op: typeof OPERATORS[number]) {
    if (!activeTab || activeTab.kind !== 'xml-primitive' || !activeTab.componentEntry) return;
    const cur = activeTab.sourceDraft ?? activeTab.componentEntry.source;
    activeTab.sourceDraft = insertIntoGeomBody(cur, op.snippet);
  }

  function insertHelperSnippet(name: string) {
    if (!activeTab || activeTab.kind !== 'xml-primitive' || !activeTab.componentEntry) return;
    const cur = activeTab.sourceDraft ?? activeTab.componentEntry.source;
    const keys = new Set(Object.keys(activeTab.params));
    activeTab.sourceDraft = snippetForHelper(cur, name, keys);
  }
  function insertRunesSnippet(entry: ComponentEntry) {
    if (!activeTab || activeTab.kind !== 'xml-primitive' || !activeTab.componentEntry) return;
    if (entry.meta.id === activeTab.componentEntry.meta.id) return; // can't import yourself
    const cur = activeTab.sourceDraft ?? activeTab.componentEntry.source;
    activeTab.sourceDraft = snippetForRunes(cur, entry);
  }

  // ── Delete a single-file component ─────────────────────────────────────────────
  // Calls DELETE /api/components/delete which (a) refuses if the primitive is
  // referenced by any authored component (returns 409 + reference list),
  // (b) deletes the .ts source + .glb otherwise, (c) invalidates the
  // server-side list cache. On success we re-fetch the registry and close
  // any open tab for the deleted id. Any open Params/Svelte/MD popups for
  // that tab go with the tab.
  async function deleteRunes(entry: ComponentEntry) {
    const id = entry.meta.id;
    const name = entry.meta.name;
    const ok = window.confirm(
      `Delete primitive "${name}" (${id})?\n\nThis removes the source file and the baked GLB. ` +
      `If any authored component uses it, the request will be refused.`,
    );
    if (!ok) return;
    try {
      const r = await fetch('/api/components/delete', {
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
    // xml-primitive folds Params into Parts (param accordion lives inside).
    if (activeTab.kind === 'xml-primitive' && inspectorTab === 'params') inspectorTab = 'parts';
    if (activeTab.kind !== 'xml-primitive' && (inspectorTab === 'svelte' || inspectorTab === 'parts' || inspectorTab === 'ai')) inspectorTab = 'params';
  });

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
  /** Lazy-loaded GLB scene — same camera/light/axes chrome as
   *  ComponentScene but renders a static .glb instead of the live geom.
   *  Powers the stage's GLB sub-tab; shows what `bakeGlb` wrote to
   *  static/components/<id>.glb on the last save. */
  let SceneGlbComponent = $state<any>(null);
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
    import('$lib/shared/ComponentSceneGlb.svelte').then((m) => { SceneGlbComponent = m.default; });
    initManifold().then(() => { ready = true; });
    enabledFamilies = loadEnabledFamilies();
    enabledLevels = loadEnabledLevels();
    testLinks = loadTestLinks();
    loadExtractionManifest();
    loadFiguresGallery();
    // Async-load the registry from /api/components/list before deciding what
    // to auto-open. Priority:
    //   1. Last primitive the user was editing this session (sessionStorage
    //      — survives Vite HMR reloads triggered by /api/components/save).
    //   2. conn_box — active work-in-progress.
    //   3. Tube — baseline fallback.
    await refreshRunesList();
    if (openTabs.length === 0) {
      let lastId: string | null = null;
      try { lastId = sessionStorage.getItem('cad:lastActiveId'); } catch { /* private mode etc. */ }
      const entry =
        (lastId ? componentList.find((e) => e.meta.id === lastId) : undefined) ??
        componentList.find((e) => e.meta.id === 'conn_box') ??
        componentList.find((e) => e.meta.id === 'hollow_cylinder');
      if (entry) openRunes(entry);
    }
    // Refresh defaults to the Parts tab — that's where the strict-
    // grammar GUI builder lives. Previously we restored the last-used
    // inspector tab from sessionStorage, but the user wants a
    // consistent landing spot after a hard refresh: it's always Parts
    // (which auto-switches to Params for non-primitive tabs via the
    // guard in openInspector / setActiveTab).
  });

  // Persist the active component id so a Vite HMR reload (triggered by
  // /api/components/save) returns the user to the primitive they were editing,
  // not the default landing. Cleared automatically if the user closes the
  // tab (closeTab below) or navigates away.
  $effect(() => {
    if (!activeTab) return;
    if (activeTab.kind === 'xml-primitive' && activeTab.componentEntry) {
      try { sessionStorage.setItem('cad:lastActiveId', activeTab.componentEntry.meta.id); } catch {}
    }
  });
  // Inspector sub-tab is no longer persisted across reloads — every
  // refresh lands on Parts (see onMount above). The non-primitive
  // guard handles transient tabs (KB, library) auto-switching to
  // 'params' / 'svelte' as appropriate.

  /** Mouse-drag-to-scrub action for number inputs. Replaces the
   *  slider — pointerdown + horizontal drag scrubs the value; release
   *  without dragging behaves as a normal click (focus → keyboard
   *  edit). A small move threshold (3 px) separates click from drag so
   *  text-edit isn't accidentally dismissed.
   *
   *  Sensitivity adapts to step size: small steps (< 0.1) need fine
   *  drag (2 px per step); large steps (>= 1) scrub one step per px.
   *  Values snap to the schema's step and clamp to min/max. */
  type DragNumParams = {
    step: number; min?: number; max?: number;
    get: () => number; set: (v: number) => void;
  };
  function dragNumber(node: HTMLInputElement, params: DragNumParams) {
    let p = params;
    let pending = false;
    let dragging = false;
    let startX = 0;
    let startVal = 0;
    const THRESHOLD = 3;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      pending = true;
      dragging = false;
      startX = e.clientX;
      startVal = p.get();
    };
    const onMove = (e: PointerEvent) => {
      if (!pending) return;
      const dx = e.clientX - startX;
      if (!dragging && Math.abs(dx) < THRESHOLD) return;
      if (!dragging) {
        dragging = true;
        try { node.setPointerCapture(e.pointerId); } catch {}
        document.body.classList.add('dragnum-active');
        node.blur();
      }
      const step = p.step || 1;
      const pxPerStep = step < 0.1 ? 2 : step < 1 ? 1.5 : 1;
      let v = startVal + (dx / pxPerStep) * step;
      if (p.min !== undefined) v = Math.max(p.min, v);
      if (p.max !== undefined) v = Math.min(p.max, v);
      v = Math.round(v / step) * step;
      const decimals = step < 0.01 ? 4 : step < 0.1 ? 3 : step < 1 ? 2 : 0;
      v = parseFloat(v.toFixed(decimals));
      p.set(v);
    };
    const onUp = (e: PointerEvent) => {
      if (!pending) return;
      pending = false;
      if (dragging) {
        dragging = false;
        try { node.releasePointerCapture(e.pointerId); } catch {}
        document.body.classList.remove('dragnum-active');
        e.preventDefault();
      }
    };
    node.addEventListener('pointerdown', onDown);
    node.addEventListener('pointermove', onMove);
    node.addEventListener('pointerup', onUp);
    node.addEventListener('pointercancel', onUp);
    return {
      update(next: DragNumParams) { p = next; },
      destroy() {
        node.removeEventListener('pointerdown', onDown);
        node.removeEventListener('pointermove', onMove);
        node.removeEventListener('pointerup', onUp);
        node.removeEventListener('pointercancel', onUp);
      },
    };
  }

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

  /** Page-wide render-time Z-scale. Compresses the Z axis at render
   *  time so a long pipe joint stays recognisable next to its OD/wall.
   *  Geom logic is unchanged — only the final mesh is squashed. Wired
   *  through `setRenderZScale` in builder.ts; included in `buildKey`
   *  so changing it triggers the same debounced rebuild as a slider. */
  // Z× compression now lives on shared scene state — the slider sits
  // in the canvas SceneControls gear. Local effect keeps the builder
  // in sync; the buildKey reads scene.zScale so the same scene state
  // also drives debounced rebuilds.
  $effect(() => { setRenderZScale(scene.zScale); });

  let buildKey = $derived(
    activeTab && (activeTab.kind === 'primitive' || activeTab.kind === 'xml-primitive')
      ? JSON.stringify({ id: activeTab.primId, p: activeTab.params, z: scene.zScale })
      : activeTab && activeTab.kind === 'composite'
      ? `comp:${activeTab.id}:${scene.zScale}`
      : '',
  );
  let buildTimer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    const _k = buildKey;
    if (!ready || !activeTab || activeTab.kind === 'kb' || activeTab.kind === 'source') { geo = null; buildError = null; return; }
    // Figure drafts have no geometry yet — skip the build entirely so the
    // Render stage shows a clean "not constructed" empty-state rather than
    // a missing-geom error.
    if (activeTab.unconstructed) { geo = null; buildError = null; return; }
    if (buildTimer) clearTimeout(buildTimer);
    buildTimer = setTimeout(async () => {
      // Server-render path: a volume-only component (renderMode 'server')
      // has no compiled geom in this bundle — its .ts lives on the volume.
      // POST params to /api/components/geom; the server transpiles +
      // executes the .ts and returns serialized { full, cutVC }, which we
      // rehydrate into the same shape buildAuthored produces.
      const entry =
        activeTab && activeTab.kind === 'xml-primitive' ? activeTab.componentEntry : undefined;
      if (entry && entry.renderMode === 'server') {
        try {
          const r = await fetch('/api/components/geom', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              id: entry.meta.id,
              params: { ...activeTab!.params },
              zScale: scene.zScale,
            }),
          });
          if (!r.ok) {
            const txt = await r.text().catch(() => '');
            throw new Error(`geom ${r.status} — ${txt.slice(0, 160)}`);
          }
          const payload = await r.json();
          geo = deserializeComponentResult(payload);
          geoVersion++;
          buildError =
            Array.isArray(payload.validationErrors) && payload.validationErrors.length
              ? payload.validationErrors.join('; ')
              : null;
        } catch (e: any) {
          buildError = e?.message ?? String(e);
        }
        return;
      }
      // Client-render path — compiled geom is in the build-time bundle.
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
    if (tab.kind !== 'xml-primitive' || !tab.componentEntry) return false;
    // Splice every slider's current value into the meta as the new
    // `default:` BEFORE formatting. paramsDirty() upstream gates the
    // save bar, but the splice runs unconditionally here — slider
    // values that happen to equal the existing default are no-ops.
    let raw = tab.sourceDraft ?? tab.componentEntry.source;
    for (const [k, def] of Object.entries(tab.componentEntry.meta.params)) {
      const cur = tab.params[k];
      if (cur === undefined) continue;
      if (Math.round(cur * 1e6) === Math.round(def.default * 1e6)) continue;
      const next = setParamDefault(raw, k, cur);
      if (next != null) raw = next;
    }
    // Syntax gate — refuse to write code that won't parse. Otherwise
    // Vite's HMR overlay covers the whole page until the file is
    // hand-fixed on disk. We use Prettier's parser as a cheap proxy
    // for "will Vite's oxc parse this?" — they catch the same class
    // of structural errors.
    const syntaxErr = await checkTypescriptSyntax(raw);
    if (syntaxErr) {
      tab.saveStatus = 'error';
      tab.saveError = `Syntax error — not saved: ${syntaxErr}`;
      return false;
    }
    // Format-on-save. Prettier is lazy-loaded the first time this fires;
    // failures fall back to the raw source (no save is blocked by a
    // formatter error). When the result differs, sync sourceDraft so the
    // editor re-renders with the formatted version BEFORE we POST — that
    // way an HMR-triggered file reload doesn't show a stale unformatted
    // buffer.
    const next = await formatTypescript(raw);
    if (next !== raw) tab.sourceDraft = next;
    tab.saveStatus = 'saving';
    tab.saveError = undefined;
    // A figure-draft (or any id not yet in the registry) is a brand-new
    // part — the save endpoint requires `create: true` for those. An
    // existing component saves without it.
    const isNew = !componentList.some((e) => e.meta.id === tab.componentEntry!.meta.id);
    try {
      const r = await fetch('/api/components/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // On first save of a figure-draft, hand the server the source
        // figure path so it copies it into the new part directory as
        // picture.png — the picture then travels with the part.
        body: JSON.stringify({
          id: tab.componentEntry.meta.id,
          source: next,
          ...(isNew ? { create: true } : {}),
          ...(isNew && tab.figureFile ? { picture: tab.figureFile } : {}),
        }),
      });
      if (!r.ok) {
        const txt = await r.text();
        tab.saveStatus = 'error';
        tab.saveError = `${r.status} ${r.statusText} — ${txt.slice(0, 160)}`;
        return false;
      }
      tab.saveStatus = 'saved';
      tab.sourceDraft = null;
      // Re-fetch the registry so the in-memory tab entry matches disk.
      await refreshRunesList();
      const fresh = componentList.find((e) => e.meta.id === tab.componentEntry!.meta.id);
      if (fresh) tab.componentEntry = { ...fresh, source: next };
      if (isNew) {
        // A brand-new part is now a library/test directory — it renders
        // server-side via /api/components/geom, NO page reload needed
        // (the old eager-glob reload hack is gone). Clear `unconstructed`
        // so the build effect picks it up, and show where it landed.
        tab.unconstructed = false;
        sidebarTab = 'test';
      }
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

  // ── AI Refine — Claude-driven source edits ───────────────────────────────
  // The AI Inspector tab is the entry point. The user types a goal; we send
  // current source + prompt to /api/components/refine which calls Claude with a
  // system prompt encoding the component file format + ManifoldCAD ops + Z-down.
  // The response lands in tab.ai.pending; the user previews + Accepts (moves
  // into sourceDraft, the Svelte tab takes over for final save) or Rejects.

  /** Ensure the tab has an AI state initialized. Idempotent. */
  function ensureAi(tab: Tab) {
    if (!tab.ai) tab.ai = { prompt: '', status: 'idle', history: [] };
    return tab.ai;
  }

  /** Format a history timestamp compactly for the History sub-tab. */
  function formatHistoryTs(ts: number): string {
    try {
      return new Date(ts).toLocaleString(undefined, {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      });
    } catch { return ''; }
  }

  /** Load this component's persisted prompt history (from the volume,
   *  via /api/components/prompts) into tab.ai.history. Best-effort — a
   *  missing/failed fetch leaves the in-memory history untouched. */
  async function loadPromptHistory(tab: Tab) {
    if (tab.kind !== 'xml-primitive' || !tab.componentEntry) return;
    const id = tab.componentEntry.meta.id;
    try {
      const r = await fetch(`/api/components/prompts?id=${encodeURIComponent(id)}`);
      if (!r.ok) return;
      const body = await r.json();
      if (Array.isArray(body?.history)) ensureAi(tab).history = body.history;
    } catch { /* offline / endpoint error — keep whatever's in memory */ }
  }

  /** Persist tab.ai.history back to the volume. Fire-and-forget — a
   *  failed write just means the History sub-tab won't survive a reload. */
  async function savePromptHistory(tab: Tab) {
    if (tab.kind !== 'xml-primitive' || !tab.componentEntry) return;
    const id = tab.componentEntry.meta.id;
    const history = tab.ai?.history ?? [];
    try {
      await fetch(`/api/components/prompts?id=${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ history }),
      });
    } catch { /* best-effort */ }
  }

  /** Load a past prompt back into the input + switch to the Prompt sub-tab. */
  function reuseHistoryPrompt(h: { prompt: string }) {
    if (!activeTab) return;
    ensureAi(activeTab).prompt = h.prompt;
    aiSubTab = 'prompt';
  }

  async function submitAiRefine(tab: Tab) {
    if (tab.kind !== 'xml-primitive' || !tab.componentEntry) return;
    const ai = ensureAi(tab);
    const prompt = ai.prompt.trim();
    if (!prompt) return;
    ai.status = 'sending';
    ai.error = undefined;
    ai.pending = undefined;
    const id = tab.componentEntry.meta.id;
    const source = tab.sourceDraft ?? tab.componentEntry.source;
    // Use the live edits of the instructions doc if dirty; otherwise the
    // version that was loaded from disk.
    const instructions = ai.instructionsDraft ?? tab.componentEntry.instructions ?? '';
    try {
      const r = await fetch('/api/components/refine', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, source, prompt, instructions }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok || !body?.ok) {
        ai.status = 'error';
        ai.error = body?.error ?? `${r.status} ${r.statusText}`;
        return;
      }
      ai.pending = String(body.source);
      ai.status = 'pending';
      ai.history = [...ai.history, { prompt, ts: Date.now() }];
      savePromptHistory(tab);
    } catch (e: any) {
      ai.status = 'error';
      ai.error = e?.message ?? String(e);
    }
  }

  /** Save the in-memory instructionsDraft back to disk as <id>.md. The
   *  user's edits don't apply to the next refine until this is called —
   *  we wire it to a Save button + an autosave-on-blur for ergonomics. */
  async function saveInstructions(tab: Tab) {
    if (tab.kind !== 'xml-primitive' || !tab.componentEntry) return;
    const ai = ensureAi(tab);
    const instructions = ai.instructionsDraft ?? '';
    ai.instructionsStatus = 'saving';
    ai.instructionsError = undefined;
    try {
      const r = await fetch('/api/components/instructions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: tab.componentEntry.meta.id, instructions }),
      });
      if (!r.ok) {
        const txt = await r.text();
        ai.instructionsStatus = 'error';
        ai.instructionsError = `${r.status} — ${txt.slice(0, 160)}`;
        return;
      }
      // Reflect the saved value back into componentEntry so the dirty flag clears.
      if (tab.componentEntry) (tab.componentEntry as any).instructions = instructions;
      ai.instructionsDraft = null;
      ai.instructionsStatus = 'saved';
      setTimeout(() => { if (ai.instructionsStatus === 'saved') ai.instructionsStatus = 'idle'; }, 1800);
    } catch (e: any) {
      ai.instructionsStatus = 'error';
      ai.instructionsError = e?.message ?? String(e);
    }
  }

  function acceptAiProposal(tab: Tab) {
    if (!tab.ai?.pending) return;
    tab.sourceDraft = tab.ai.pending;
    if (tab.ai.history.length > 0) tab.ai.history[tab.ai.history.length - 1].accepted = true;
    tab.ai.pending = undefined;
    tab.ai.status = 'idle';
    tab.ai.prompt = '';
    savePromptHistory(tab);
    // Switch to Svelte tab so the user can review + Save the result.
    inspectorTab = 'svelte';
  }

  function rejectAiProposal(tab: Tab) {
    if (!tab.ai) return;
    if (tab.ai.history.length > 0) tab.ai.history[tab.ai.history.length - 1].accepted = false;
    tab.ai.pending = undefined;
    tab.ai.status = 'idle';
    savePromptHistory(tab);
  }

  function resetParams(tab: Tab) {
    if (tab.kind === 'xml-primitive' && tab.componentEntry) {
      tab.params = defaultsFor(tab.componentEntry.meta);
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
   *  component component). Both share the same toolbar / 3D scene /
   *  Params + Script popups; the only difference is what gets shown in
   *  the Script popup (hand-written builder vs generated source). */
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
    // component — synthesize a ComponentDef from the component meta.
    if (activeTab.kind === 'xml-primitive' && activeTab.componentEntry) {
      const m = activeTab.componentEntry.meta;
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
    // component — component file IS the source; the Inspector shows it in
    // the Svelte tab, so the Script tab is hidden for these. Keep the
    // builderText derive intact for legacy primitives.
    return extractBuilder(builderSource, activeTab.primId) ?? '// (no script — builder function not found in builder.ts)';
  });

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

  // ── Param-form for adding a NEW parameter to a component schema ───────────────
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

  /** Open the per-param description editor popup. Seeds the drafts
   *  bag with the CURRENT description on each param so existing text
   *  doesn't get wiped if the user only edits one. */
  function openDescEdit(tab: Tab) {
    if (!tab.componentEntry) return;
    const drafts: Record<string, string> = {};
    for (const [k, schema] of Object.entries(tab.componentEntry.meta.params)) {
      drafts[k] = (schema as any).description ?? '';
    }
    tab.descForm = { open: true, drafts };
  }
  function closeDescEdit(tab: Tab) {
    if (tab.descForm) tab.descForm.open = false;
  }
  async function submitDescEdit(tab: Tab) {
    if (!tab.descForm || !tab.componentEntry) return;
    const drafts = tab.descForm.drafts;
    let src = tab.sourceDraft ?? tab.componentEntry.source;
    for (const [key, desc] of Object.entries(drafts)) {
      const next = setParamDescription(src, key, desc);
      if (next == null) {
        tab.descForm.error = `Couldn't splice description for "${key}" — meta block shape unexpected.`;
        return;
      }
      src = next;
    }
    tab.sourceDraft = src;
    tab.descForm.open = false;
    tab.descForm.error = undefined;
  }

  function openParamEdit(tab: Tab, key: string, ev?: MouseEvent) {
    if (!tab.componentEntry) return;
    const schema = tab.componentEntry.meta.params[key] as any;
    tab.paramEdit = {
      key,
      name: key,
      label: schema?.label ?? '',
      desc: schema?.description ?? '',
      unit: schema?.unit ?? '',
      group: schema?.group ?? '',
      defaultStr: String(schema?.default ?? ''),
      minStr: String(schema?.min ?? ''),
      maxStr: String(schema?.max ?? ''),
      stepStr: String(schema?.step ?? ''),
    };
    // Anchor the FloatingPanel next to the clicked ✎ button.
    const btn = ev?.currentTarget as HTMLElement | undefined;
    if (btn) {
      const r = btn.getBoundingClientRect();
      paramEditX = Math.round(r.right + 6);
      paramEditY = Math.round(r.top - 4);
    }
  }
  function closeParamEdit(tab: Tab) {
    tab.paramEdit = null;
  }

  /** Open the per-arg formula popup. Pre-fills the textarea with the
   *  current raw arg so the user can edit a formula already in place. */
  function openFormulaEdit(tab: Tab, instance: string, argIdx: number, ev?: MouseEvent) {
    if (!tab.componentEntry) return;
    const cur = tab.sourceDraft ?? tab.componentEntry.source;
    const insts = parsePartInstances(cur);
    const inst = insts.find((i) => i.instance === instance);
    if (!inst) return;
    const arg = inst.args[argIdx];
    const raw = arg?.raw ?? '';
    tab.formulaEdit = { instance, argIdx, raw, caret: raw.length };
    const btn = ev?.currentTarget as HTMLElement | undefined;
    if (btn) {
      const r = btn.getBoundingClientRect();
      formulaEditX = Math.round(r.right + 6);
      formulaEditY = Math.round(r.top - 4);
    }
  }
  function closeFormulaEdit(tab: Tab) { tab.formulaEdit = null; }
  function applyFormulaEdit(tab: Tab) {
    if (!tab.formulaEdit || !tab.componentEntry) return;
    const fe = tab.formulaEdit;
    const cur = tab.sourceDraft ?? tab.componentEntry.source;
    const next = setInstanceArg(cur, fe.instance, fe.argIdx, fe.raw.trim());
    if (next != null) tab.sourceDraft = next;
    tab.formulaEdit = null;
  }

  /** Identifiers in scope for the typeahead, given the current geom
   *  source. Returns top-level params as `p.<name>` plus other
   *  instances' typed props as `<inst>.<prop>`. The caller filters by
   *  the word-at-caret. */
  function formulaCandidates(tab: Tab, excludeInstance: string): string[] {
    const out: string[] = [];
    for (const k of Object.keys(tab.params)) out.push(`p.${k}`);
    const cur = tab.sourceDraft ?? tab.componentEntry?.source ?? '';
    const insts = parsePartInstances(cur);
    for (const i of insts) {
      if (i.instance === excludeInstance) continue;
      const meta = HELPERS.find((h) => h.name === i.callName);
      if (!meta) continue;
      for (const p of meta.props) out.push(`${i.instance}.${p.name}`);
    }
    return out;
  }

  /** Snapshot-resolve a typeahead candidate to an expression that's
   *  valid at runtime. `p.<name>` is left alone (the geom body's `p`
   *  is the params object). `<inst>.<prop>` substitutes the named
   *  instance's current raw arg text — wrapped in parens so precedence
   *  is preserved when it lands inside a larger expression.
   *
   *  This is a SNAPSHOT — editing A's outerR later doesn't update
   *  earlier B-formulas that referenced it. The user re-edits B's
   *  formula to re-snapshot. Live cascade would require a metadata
   *  layer; we may add that once a real workflow demands it. */
  function resolveCandidate(tab: Tab, cand: string, excludeInstance: string): string {
    const m = /^([A-Z][A-Z0-9]*)\.(\w+)$/.exec(cand);
    if (!m) return cand;
    const [, inst, prop] = m;
    if (inst === excludeInstance) return cand;
    const cur = tab.sourceDraft ?? tab.componentEntry?.source ?? '';
    const insts = parsePartInstances(cur);
    const target = insts.find((i) => i.instance === inst);
    if (!target) return cand;
    const meta = HELPERS.find((h) => h.name === target.callName);
    if (!meta) return cand;
    const idx = meta.props.findIndex((p) => p.name === prop);
    if (idx < 0) return cand;
    const arg = target.args[idx];
    if (!arg?.raw) return cand;
    // Parenthesise compound expressions so substitution composes
    // safely; literals + simple param refs stay bare.
    return arg.kind === 'literal' || arg.kind === 'paramRef'
      ? arg.raw
      : `(${arg.raw})`;
  }
  function submitParamEdit(tab: Tab) {
    if (!tab.paramEdit || !tab.componentEntry) return;
    const pe = tab.paramEdit;
    let src = tab.sourceDraft ?? tab.componentEntry.source;

    // Rename path — confirm before refactoring references in geom body.
    if (pe.name && pe.name !== pe.key) {
      if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(pe.name)) {
        tab.paramEdit = { ...pe, error: `"${pe.name}" is not a valid identifier.` };
        return;
      }
      if (pe.name in tab.componentEntry.meta.params) {
        tab.paramEdit = { ...pe, error: `"${pe.name}" already exists as a param.` };
        return;
      }
      const ok = confirm(`Rename "${pe.key}" → "${pe.name}" and update all references in the geom body?`);
      if (!ok) return;
      const renamed = renameParamKey(src, pe.key, pe.name);
      if (renamed == null) {
        tab.paramEdit = { ...pe, error: `Couldn't rename — meta shape unexpected.` };
        return;
      }
      src = renamed;
      const cur = tab.params[pe.key];
      const renamedBag: Record<string, number> = {};
      for (const [k, v] of Object.entries(tab.params)) {
        renamedBag[k === pe.key ? pe.name : k] = v;
      }
      tab.params = renamedBag;
      if (cur !== undefined) tab.params[pe.name] = cur;
    }
    const finalKey = pe.name && pe.name !== pe.key ? pe.name : pe.key;

    // Validate + splice each numeric field. Skip when blank or unchanged.
    const numericFields: Array<{ field: 'default' | 'min' | 'max' | 'step'; str: string }> = [
      { field: 'default', str: pe.defaultStr },
      { field: 'min',     str: pe.minStr },
      { field: 'max',     str: pe.maxStr },
      { field: 'step',    str: pe.stepStr },
    ];
    for (const { field, str } of numericFields) {
      if (!str.trim()) continue;
      const v = Number(str);
      if (!Number.isFinite(v)) {
        tab.paramEdit = { ...pe, error: `"${field}" is not a valid number.` };
        return;
      }
      const next = setParamField(src, finalKey, field, Math.round(v * 1e6) / 1e6);
      if (next == null) {
        tab.paramEdit = { ...pe, error: `Couldn't set ${field} for "${finalKey}".` };
        return;
      }
      src = next;
    }
    // String fields. Empty `group` strips the field entirely (param
    // returns to the General accordion); a non-empty value puts it
    // under the matching part bar.
    const stringFields: Array<{ field: 'label' | 'unit' | 'description' | 'group'; val: string }> = [
      { field: 'label',       val: pe.label },
      { field: 'unit',        val: pe.unit },
      { field: 'description', val: pe.desc },
      { field: 'group',       val: pe.group },
    ];
    for (const { field, val } of stringFields) {
      const next = setParamField(src, finalKey, field, val);
      if (next == null) {
        tab.paramEdit = { ...pe, error: `Couldn't set ${field} for "${finalKey}".` };
        return;
      }
      src = next;
    }

    // If user changed the default, sync the live slider value so the
    // preview doesn't snap on next render due to bounds enforcement.
    const newDefault = Number(pe.defaultStr);
    if (Number.isFinite(newDefault) && tab.params[finalKey] === undefined) {
      tab.params[finalKey] = newDefault;
    }
    tab.sourceDraft = src;
    tab.paramEdit = null;
  }

  /** Rename a param key throughout a component source file. Two-phase:
   *  (1) replace the param's key declaration `oldName: {` with
   *  `newName: {` (specific match so only the declaration changes),
   *  (2) word-boundary replace `\boldName\b` across the whole source
   *  to update references in the args destructure + geom body. Known
   *  limitation: false positives if the old name appears inside a
   *  string literal or comment elsewhere in the file (rare for param
   *  names in this codebase). */
  function renameParamKey(src: string, oldName: string, newName: string): string | null {
    if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(newName)) return null;
    const esc = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Phase 1: param key declaration. Match the key followed by `:` then `{`.
    const keyRe = new RegExp(`\\b${esc}(\\s*:\\s*\\{)`, 'g');
    let next = src.replace(keyRe, `${newName}$1`);
    // Phase 2: all standalone identifier uses. The Phase-1 replacement
    // above already converted the declaration; this pass picks up the
    // destructure + body references.
    next = next.replace(new RegExp(`\\b${esc}\\b`, 'g'), newName);
    return next;
  }

  /** Generic splicer: insert / replace one field on a specific param
   *  entry's object literal. Handles string and numeric values. For
   *  empty-string values on string fields, the field is REMOVED
   *  rather than written as `''` — keeps the meta tidy. */
  function setParamField(
    src: string,
    key: string,
    field: string,
    value: string | number,
  ): string | null {
    const paramsRe = /\bparams\s*:\s*\{/;
    const pm = paramsRe.exec(src);
    if (!pm) return null;
    const entryRe = new RegExp(`(^|\\n)([ \\t]*)${key}\\s*:\\s*\\{`, 'm');
    const em = entryRe.exec(src.slice(pm.index));
    if (!em) return null;
    const entryStart = pm.index + em.index + em[1].length;
    const openBraceIdx = src.indexOf('{', entryStart);
    if (openBraceIdx < 0) return null;
    let i = openBraceIdx + 1;
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
        else if (c === '}') { depth--; if (depth === 0) break; }
      }
      i++;
    }
    if (depth !== 0) return null;
    const body = src.slice(openBraceIdx + 1, i);
    const isStr = typeof value === 'string';
    const fieldEsc = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const strRe = new RegExp(`\\b${fieldEsc}\\s*:\\s*(['"])(?:\\\\.|(?!\\1).)*\\1\\s*,?\\s*`, 'g');
    const numRe = new RegExp(`\\b${fieldEsc}\\s*:\\s*-?\\d+(?:\\.\\d+)?\\s*,?\\s*`, 'g');
    const wipe = (b: string) => b.replace(strRe, '').replace(numRe, '');
    if (isStr && !value) {
      // Empty string → strip the field entirely.
      const newBody = wipe(body).replace(/\s+,/g, ',').replace(/,\s*,/g, ',');
      return src.slice(0, openBraceIdx + 1) + newBody + src.slice(i);
    }
    const stripped = wipe(body);
    const literal = isStr
      ? `${field}: '${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
      : `${field}: ${value}`;
    // Insert as the first field — keeps ordering stable and predictable.
    const indentMatch = stripped.match(/^\s*\n([ \t]+)/);
    const indent = indentMatch?.[1] ?? ' ';
    const insertion = stripped.includes('\n') ? `\n${indent}${literal},` : ` ${literal},`;
    return src.slice(0, openBraceIdx + 1) + insertion + stripped + src.slice(i);
  }

  /** Replace the `default: <number>` field on a specific param entry
   *  in the meta block. Used by Save to persist the current slider
   *  value as the new schema default — so reopening the primitive
   *  starts where the user left it. Returns null if the param entry
   *  can't be located. */
  function setParamDefault(src: string, key: string, value: number): string | null {
    const paramsRe = /\bparams\s*:\s*\{/;
    const pm = paramsRe.exec(src);
    if (!pm) return null;
    const entryRe = new RegExp(`(^|\\n)([ \\t]*)${key}\\s*:\\s*\\{`, 'm');
    const em = entryRe.exec(src.slice(pm.index));
    if (!em) return null;
    const entryStart = pm.index + em.index + em[1].length;
    const openBraceIdx = src.indexOf('{', entryStart);
    if (openBraceIdx < 0) return null;
    let i = openBraceIdx + 1;
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
        else if (c === '}') { depth--; if (depth === 0) break; }
      }
      i++;
    }
    if (depth !== 0) return null;
    const body = src.slice(openBraceIdx + 1, i);
    // Round to a sane number of decimals so 2.875 doesn't end up as
    // 2.8750000004 after a couple of slider drags.
    const v = Math.round(value * 1e6) / 1e6;
    // Replace an existing `default: <num>` OR append.
    const existing = /\bdefault\s*:\s*-?\d+(?:\.\d+)?/;
    let newBody: string;
    if (existing.test(body)) {
      newBody = body.replace(existing, `default: ${v}`);
    } else {
      // Append before the closing brace, with a leading `, ` if there
      // are other fields.
      const trimmed = body.replace(/\s+$/, '');
      newBody = trimmed.length > 0 ? `${trimmed}, default: ${v} ` : ` default: ${v} `;
    }
    return src.slice(0, openBraceIdx + 1) + newBody + src.slice(i);
  }

  /** Detect whether any slider value in this tab differs from its
   *  schema default. Used to surface the global save bar even when
   *  `sourceDraft` hasn't been touched — moving a slider should be a
   *  savable action too. Only checks the keys that exist in the
   *  schema (extra/draft params are handled elsewhere). */
  function paramsDirty(tab: Tab): boolean {
    if (!tab.componentEntry) return false;
    const schema = tab.componentEntry.meta.params;
    for (const [k, def] of Object.entries(schema)) {
      const cur = tab.params[k];
      if (cur === undefined) continue;
      // Rounded compare — slider step can introduce float noise that
      // would otherwise show "dirty" forever.
      if (Math.round(cur * 1e6) !== Math.round(def.default * 1e6)) return true;
    }
    return false;
  }

  /** Insert or replace the `description: '...'` field on a specific
   *  param entry inside the meta block. Returns the modified source,
   *  or null if the param entry can't be located. Brace-walks the
   *  per-param object so nested literals don't trip it. */
  function setParamDescription(src: string, key: string, desc: string): string | null {
    const paramsRe = /\bparams\s*:\s*\{/;
    const pm = paramsRe.exec(src);
    if (!pm) return null;
    const entryRe = new RegExp(`(^|\\n)([ \\t]*)${key}\\s*:\\s*\\{`, 'm');
    const em = entryRe.exec(src.slice(pm.index));
    if (!em) return null;
    const entryStart = pm.index + em.index + em[1].length;
    const openBraceIdx = src.indexOf('{', entryStart);
    if (openBraceIdx < 0) return null;
    let i = openBraceIdx + 1;
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
        else if (c === '}') { depth--; if (depth === 0) break; }
      }
      i++;
    }
    if (depth !== 0) return null;
    const body = src.slice(openBraceIdx + 1, i);
    // Strip any existing description field (single OR double-quoted).
    const stripped = body.replace(/\bdescription\s*:\s*(['"])(?:\\.|(?!\1).)*\1\s*,?\s*/g, '').replace(/^\s+/, ' ').replace(/\s+$/, ' ');
    let newBody: string;
    if (desc.trim()) {
      const safe = desc.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      newBody = ` description: '${safe}',${stripped}`;
    } else {
      newBody = stripped;
    }
    return src.slice(0, openBraceIdx + 1) + newBody + src.slice(i);
  }
  /** Splice a new param entry into the `params: { ... }` block of a component
   *  file's `meta` object literal. Returns the modified source or null if
   *  the source shape doesn't match expectations. */
  function insertParamIntoSource(
    src: string,
    name: string,
    defaultValue: number,
    meta: { label: string; min: number; max: number; step: number; unit?: string; type?: string },
  ): string | null {
    // Locate the `params: {` opening within the `meta` literal. Tolerant
    // of whitespace; matches the first occurrence (each component file has one).
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
    if (!tab.paramForm || !tab.componentEntry) return;
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
    const current = tab.sourceDraft ?? tab.componentEntry.source;
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
      <span class="sb-hdr-text">Primitives</span>
    </div>
    <div class="sb-split">
      <!-- Vertical tab rail on the left — one button per top-level group.
           Selected tab swaps the flat list shown to its right. -->
      <div class="sb-rail">
        {#each TREE as f (f.id)}
          {@const count = f.id === 'basic' ? componentList.filter((r) => entryRailTab(r) === 'basic').length
                       : f.id === 'components' ? componentList.filter((r) => entryRailTab(r) === 'components' && enabledFamilies.has(entryFamily(r))).length
                       : f.id === 'assemblies' ? ASSEMBLIES_L4.length + componentList.filter((r) => entryRailTab(r) === 'assemblies').length
                       : f.id === 'kb' ? kbList.length + kbSources.length
                       : f.id === 'operator' ? OPERATORS.length
                       : f.id === 'test' ? figures.length + componentList.filter((r) => r.origin === 'test').length
                       : itemsInFolder(f).length}
          <button
            class="sb-tab"
            class:active={sidebarTab === f.id}
            class:compound={f.compound}
            onclick={() => (sidebarTab = f.id)}
            title="{f.name} ({count})"
          >
            <span class="sb-tab-name">{f.name}</span>
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

    {#snippet runesRow(entry: ComponentEntry, staged: boolean)}
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
        {#if staged}
          <button
            class="prim-post"
            type="button"
            title={`Move ${entry.meta.name} into a category`}
            onclick={(e) => { e.stopPropagation(); openMoveForm(entry.meta.id); }}
          >Move</button>
        {/if}
        <button
          class="prim-del"
          type="button"
          title={`Delete ${entry.meta.name}`}
          aria-label={`Delete ${entry.meta.name}`}
          onclick={(e) => { e.stopPropagation(); deleteRunes(entry); }}
        >
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
            <path fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" d="M3 4.5 H13 M6.5 4.5 V3.25 a0.75 0.75 0 0 1 0.75 -0.75 h1.5 a0.75 0.75 0 0 1 0.75 0.75 V4.5 M4.25 4.5 L5 13 a1 1 0 0 0 1 0.9 h4 a1 1 0 0 0 1 -0.9 L11.75 4.5 M6.75 7 V11.5 M9.25 7 V11.5" />
          </svg>
        </button>
      </div>
      {#if staged && moveForm?.id === entry.meta.id}
        <!-- Inline Move form — pick the destination category + group, then
             /api/components/move atomically renames the part's directory. -->
        <div class="post-form">
          <div class="pf-row">
            <label>Category
              <select class="pf-in" bind:value={moveForm.category}>
                <option value="parts">Parts</option>
                <option value="basic">Basic</option>
                <option value="assemblies">Assemblies</option>
              </select>
            </label>
          </div>
          {#if moveForm.category === 'parts'}
            <div class="pf-row">
              <label>Family
                <select class="pf-in" bind:value={moveForm.family}>
                  {#each FAMILIES.filter((f) => f.id !== 'basic') as fam (fam.id)}
                    <option value={fam.id}>{fam.name}</option>
                  {/each}
                </select>
              </label>
            </div>
          {:else if moveForm.category === 'basic'}
            <div class="pf-row">
              <label>Level
                <select class="pf-in" bind:value={moveForm.level}>
                  {#each LEVELS as lv (lv.id)}
                    <option value={lv.id}>{lv.name}</option>
                  {/each}
                </select>
              </label>
            </div>
          {/if}
          {#if moveForm.error}<p class="pf-err">{moveForm.error}</p>{/if}
          <div class="pf-actions">
            <button class="save-btn" type="button" disabled={moveForm.moving} onclick={submitMove}>
              {moveForm.moving ? 'Moving…' : 'Move'}
            </button>
            <button class="discard-btn" type="button" onclick={() => (moveForm = null)}>Cancel</button>
          </div>
        </div>
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
        {#if sidebarTab === 'components'}
          <button
            bind:this={familyFilterBtn}
            class="family-filter-icon"
            class:open={familyFilterOpen}
            type="button"
            onclick={toggleFamilyFilter}
            title="Filter families"
            aria-label="Filter families"
          >
            <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
              <path d="M2 3h12l-4.5 6v4l-3-1v-3L2 3z" fill="currentColor"/>
            </svg>
          </button>
        {:else if sidebarTab === 'basic'}
          <button
            bind:this={levelFilterBtn}
            class="family-filter-icon"
            class:open={levelFilterOpen}
            type="button"
            onclick={toggleLevelFilter}
            title="Filter by level"
            aria-label="Filter by level"
          >
            <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
              <path d="M2 3h12l-4.5 6v4l-3-1v-3L2 3z" fill="currentColor"/>
            </svg>
          </button>
        {/if}
      </div>

      {#if sidebarTab === 'components'}
        <!-- Named single-file components, grouped by family. Family
             classification lives in $lib/cad/components/families.ts;
             the filter icon next to the search input opens the family
             popup. Filter state persists to localStorage under
             'cad:enabledFamilies'. -->
        {@const filt = componentList.filter((r) => entryRailTab(r) === 'components'
                                              && enabledFamilies.has(entryFamily(r))
                                              && (!filter || r.meta.name.toLowerCase().includes(filter.toLowerCase()) || r.meta.id.toLowerCase().includes(filter.toLowerCase())))}
        {@const groups = FAMILIES.filter((fam) => fam.id !== 'basic' && enabledFamilies.has(fam.id) && filt.some((r) => entryFamily(r) === fam.id))}
        {#each groups as fam (fam.id)}
          {@const collapsed = isFamilyCollapsed('components', fam.id)}
          <button
            class="sb-subhead clickable"
            class:collapsed
            type="button"
            onclick={() => toggleFamilyCollapse('components', fam.id)}
          >
            <span class="sb-chevron">▾</span>
            {fam.name}
          </button>
          {#if !collapsed}
          <div class="sb-list">
            {#each filt.filter((r) => entryFamily(r) === fam.id) as entry (entry.meta.id)}
              {@render runesRow(entry, false)}
            {/each}
          </div>
          {/if}
        {/each}
        {#if filt.length === 0}<div class="sb-empty">No components in the enabled families. Try toggling more families in the filter, or clearing the search.</div>{/if}
      {/if}
      {#if sidebarTab === 'assemblies'}
        {@const filt = ASSEMBLIES_L4.filter((a) => !filter || a.name.toLowerCase().includes(filter.toLowerCase()) || a.tags.some((t) => t.toLowerCase().includes(filter.toLowerCase())))}
        {@const groups = Array.from(new Set(filt.map((a) => a.group ?? 'Other')))}
        {@const postedAsm = componentList.filter((r) => entryRailTab(r) === 'assemblies'
                                                   && (!filter || r.meta.name.toLowerCase().includes(filter.toLowerCase()) || r.meta.id.toLowerCase().includes(filter.toLowerCase())))}
        {#if postedAsm.length > 0}
          <!-- Posted volume components classified as assemblies. -->
          <div class="sb-subhead">Posted</div>
          <div class="sb-list">
            {#each postedAsm as entry (entry.meta.id)}
              {@render runesRow(entry, false)}
            {/each}
          </div>
        {/if}
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
        {#if filt.length === 0 && postedAsm.length === 0}<div class="sb-empty">No assemblies match "{filter}".</div>{/if}
      {/if}
      {#if sidebarTab === 'basic'}
        <!-- Basic — pure geometric building blocks (familyOf === 'basic').
             Auto-discovered from src/lib/cad/components/ via import.meta.glob.
             The "+ New" button at the top creates a new file via
             /api/components/save (create:true). Vite HMR picks up the new
             file and adds it to the list automatically. Named real-world
             components live in the Components tab, not here. -->
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

        <!-- Basic-tab list grouped by complexity level. Mirrors the
             family-grouped Parts tab: collapsible headers, level filter
             popup anchored to the funnel button. Level classification
             lives in $lib/cad/components/families.ts (LEVEL_BY_ID).
             Filter state persists to localStorage under
             'cad:enabledBasicLevels'. -->
        {@const bfilt = componentList.filter((r) => entryRailTab(r) === 'basic'
                                                && enabledLevels.has(entryLevel(r))
                                                && (!filter || r.meta.name.toLowerCase().includes(filter.toLowerCase()) || r.meta.id.toLowerCase().includes(filter.toLowerCase())))}
        {@const bgroups = LEVELS.filter((lv) => enabledLevels.has(lv.id) && bfilt.some((r) => entryLevel(r) === lv.id))}
        {#each bgroups as lv (lv.id)}
          {@const collapsed = isFamilyCollapsed('basic', String(lv.id))}
          <button
            class="sb-subhead clickable"
            class:collapsed
            type="button"
            onclick={() => toggleFamilyCollapse('basic', String(lv.id))}
          >
            <span class="sb-chevron">▾</span>
            {lv.name}
          </button>
          {#if !collapsed}
          <div class="sb-list">
            {#each bfilt.filter((r) => entryLevel(r) === lv.id) as entry (entry.meta.id)}
              {@render runesRow(entry, false)}
            {/each}
          </div>
          {/if}
        {/each}
        {#if bfilt.length === 0}<div class="sb-empty">No primitives in the enabled levels. Try toggling more levels in the filter, or clearing the search.</div>{/if}
      {/if}
      {#if sidebarTab === 'kb'}
        <!-- KB tab — Sources / DB sub-tab switcher. Sources lists raw
             documents on the volume; DB lists the structured KB tables
             from /kb/index.json. Same rail tab houses both, sub-tab
             chooses what to render below. -->
        <div class="sb-subtabs">
          <button class="sb-subtab" class:active={kbSubTab === 'sources'} onclick={() => (kbSubTab = 'sources')} type="button">
            Sources <span class="sb-subtab-count">{kbSources.length}</span>
          </button>
          <button class="sb-subtab" class:active={kbSubTab === 'db'} onclick={() => (kbSubTab = 'db')} type="button">
            DB <span class="sb-subtab-count">{kbList.length}</span>
          </button>
        </div>
        {#if kbSubTab === 'db'}
          {#if kbListError}
            <div class="sb-empty">{kbListError}</div>
          {:else if kbList.length === 0}
            <div class="sb-empty">No KBs registered.</div>
          {:else}
            {@const kfilt = kbList.filter((k) => !filter || k.title.toLowerCase().includes(filter.toLowerCase()) || (k.categories ?? []).some((c) => c.toLowerCase().includes(filter.toLowerCase())))}
            {@const kgroups = FAMILIES.filter((fam) => kfilt.some((k) => (k.family ?? 'basic') === fam.id))}
            {#each kgroups as fam (fam.id)}
              <div class="sb-subhead">{fam.name}</div>
              <div class="sb-list">
                {#each kfilt.filter((k) => (k.family ?? 'basic') === fam.id) as kb (kb.id)}
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
            {/each}
            {#if kfilt.length === 0}<div class="sb-empty">No KBs match "{filter}".</div>{/if}
          {/if}
        {:else}
          <!-- kbSubTab === 'sources' — raw documents on the volume. -->
          {#if kbSourcesError}
            <div class="sb-empty">{kbSourcesError}</div>
          {:else if kbSources.length === 0}
            <div class="sb-empty">No sources registered.</div>
          {:else}
            {@const sfilt = kbSources.filter((s) => !filter
                                                || s.label.toLowerCase().includes(filter.toLowerCase())
                                                || s.kbTitles.some((t) => t.toLowerCase().includes(filter.toLowerCase()))
                                                || (s.kind ?? '').toLowerCase().includes(filter.toLowerCase()))}
            {@const sgroups = FAMILIES.filter((fam) => sfilt.some((s) => s.family === fam.id))}
            {#each sgroups as fam (fam.id)}
              <div class="sb-subhead">{fam.name}</div>
              <div class="sb-list">
                {#each sfilt.filter((s) => s.family === fam.id) as src (src.key)}
                <button
                  class="prim-link source-link"
                  class:active={activeTab?.id === `src:${src.key}`}
                  type="button"
                  onclick={() => openSource(src)}
                  title={src.url ?? src.file ?? src.label}
                >
                  <span class="dot"></span>
                  <span class="pl-stack">
                    <span class="pl-name">{src.label}</span>
                    <span class="pl-sub">{src.kbTitles.join(' · ')}</span>
                  </span>
                  {#if src.file && !src.url}
                    <span class="prim-kid-count source-kind">PDF</span>
                  {:else if src.kind}
                    <span class="prim-kid-count source-kind">{src.kind.replace(/_/g, ' ')}</span>
                  {/if}
                </button>
              {/each}
            </div>
          {/each}
            {#if sfilt.length === 0}<div class="sb-empty">No sources match "{filter}".</div>{/if}
          {/if}
        {/if}
      {/if}
      {#each TREE as f (f.id)}
        {#if f.id === sidebarTab && f.id !== 'kb' && f.id !== 'components' && f.id !== 'assemblies' && f.id !== 'basic' && f.id !== 'test'}
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

        {/if}
      {/each}

      {#if sidebarTab === 'operator'}
        <div class="sb-operator">
          <p class="sb-op-intro">Click an operator to splice a stub into the active primitive's geom body. Implementations land per-operator.</p>
          {#each OPERATORS as op (op.id)}
            <button
              class="sb-op-item"
              type="button"
              title={op.desc}
              onclick={() => insertOperatorSnippet(op)}
              disabled={!activeTab || activeTab.kind !== 'xml-primitive'}
            >
              <span class="sb-op-glyph">{op.glyph}</span>
              <span class="sb-op-name">{op.name}</span>
              <span class="sb-op-desc">{op.desc}</span>
            </button>
          {/each}
        </div>
      {/if}
      {#if sidebarTab === 'test'}
        <!-- Test tab — the holding area. Sections stacked: (1) parts
             in progress — library/test/<id>/ components, built from a
             figure, awaiting Move into a category; (2) the numbered raw
             figure gallery from scripts/extract_figures.ts (a figure
             already turned into a part drops out of this grid); (3)
             extraction-pipeline results; (4) the manual link scratchpad.
             A part stays in Test until the user explicitly Moves it. -->
        {@const testParts = componentList.filter((r) => r.origin === 'test'
          && (!filter || r.meta.name.toLowerCase().includes(filter.toLowerCase()) || r.meta.id.toLowerCase().includes(filter.toLowerCase())))}
        {@const startedIds = new Set(componentList.map((r) => r.meta.id))}
        {@const rawFigures = figures.filter((f) => !startedIds.has(f.id.replace(/-/g, '_')))}
        <div class="sb-test">
          {#if testParts.length > 0}
            <div class="sb-test-sec">
              <div class="sb-test-sec-h"><span class="sb-test-sec-title">In progress</span></div>
              <div class="sb-test-sec-meta">Built from a figure — review, then <strong>Move</strong> to a category.</div>
              <div class="sb-list">
                {#each testParts as entry (entry.meta.id)}
                  {@render runesRow(entry, true)}
                {/each}
              </div>
            </div>
          {/if}
          {#if rawFigures.length > 0}
            <div class="sb-test-sec">
              <div class="sb-test-sec-h">
                <span class="sb-test-sec-title">Figures</span>
                <button
                  class="sb-test-refresh"
                  type="button"
                  title="Reload gallery"
                  onclick={loadFiguresGallery}
                >↻ {rawFigures.length}</button>
              </div>
              {#if figuresLoadedAt}
                <div class="sb-test-sec-meta">Extracted {new Date(figuresLoadedAt).toLocaleDateString()}</div>
              {/if}
                <div class="sb-fig-grid">
                  {#each rawFigures as fig (fig.id)}
                    <div
                      class="sb-fig-cell"
                      class:active={activeTab?.id === `draft:${fig.id.replace(/-/g, '_')}`}
                      class:deleting={figureDeleting[fig.id]}
                    >
                      <button
                        class="sb-fig-open"
                        type="button"
                        onclick={() => openFigureAsDraft(fig)}
                        title={`${fig.id} — ${fig.pdf} p.${fig.page}\nClick to open as a blank component (Render + Picture + Inspector).`}
                      >
                        <img class="sb-fig-thumb" src={volumeUrl(fig.thumb)} alt={fig.id} loading="lazy" />
                        <span class="sb-fig-n">{fig.n}</span>
                        <span class="sb-fig-cap">{fig.pdf.replace(/\.pdf$/, '')} · p.{fig.page}</span>
                      </button>
                      <button
                        class="sb-fig-del"
                        type="button"
                        disabled={figureDeleting[fig.id]}
                        title="Delete this figure from the volume (permanent)"
                        aria-label={`Delete ${fig.id}`}
                        onclick={(e) => { e.stopPropagation(); deleteFigure(fig); }}
                      >{figureDeleting[fig.id] ? '…' : '✕'}</button>
                    </div>
                  {/each}
                </div>
            </div>
          {/if}
          {#if extractionResults.length > 0}
            <div class="sb-test-sec">
              <div class="sb-test-sec-h">
                <span class="sb-test-sec-title">Extraction Results</span>
                <button
                  class="sb-test-refresh"
                  type="button"
                  title="Reload manifest"
                  onclick={loadExtractionManifest}
                >↻ {extractionResults.length}</button>
              </div>
              {#if extractionLoadedAt}
                <div class="sb-test-sec-meta">Updated {new Date(extractionLoadedAt).toLocaleTimeString()}</div>
              {/if}
              <div class="sb-list">
                {#each extractionResults as r (r.id)}
                  {@const inRegistry = componentList.some((c) => c.meta.id === r.id)}
                  {@const status = extractionPromoteStatus[r.id] ?? 'idle'}
                  <div class="prim-row" class:active={activeTab?.primId === r.id}>
                    <button
                      class="prim-link"
                      class:active={activeTab?.primId === r.id}
                      type="button"
                      disabled={status === 'promoting'}
                      onclick={() => promoteAndOpenExtraction(r)}
                      title={`${r.brief_description}\n\nClick to create as a part — saves to src/lib/cad/components/${r.id}.ts and opens it with the full editor + canvas.`}
                    >
                      <span class="dot" class:verdict-match={r.final_verdict === 'MATCH'} class:verdict-error={r.final_verdict === 'ERROR'} class:verdict-incomplete={r.final_verdict === 'INCOMPLETE'}></span>
                      <span class="pl-stack">
                        <span class="pl-name">{r.name}{inRegistry ? ' ◉' : ''}</span>
                        <span class="pl-sub">{r.source_pdf}{r.source_page ? ` · p.${r.source_page}` : ''} · {r.iters_done} iter{r.iters_done !== 1 ? 's' : ''}</span>
                      </span>
                      {#if status === 'promoting'}
                        <span class="prim-kid-count">…</span>
                      {:else if status === 'error'}
                        <span class="prim-kid-count verdict-error-chip" title={extractionPromoteError[r.id] ?? ''}>!</span>
                      {:else if inRegistry}
                        <span class="prim-kid-count verdict-match-chip" title="In registry — click to open">●</span>
                      {:else if r.final_verdict === 'MATCH'}
                        <span class="prim-kid-count verdict-match-chip">✓</span>
                      {:else if r.final_verdict === 'ERROR'}
                        <span class="prim-kid-count verdict-error-chip">✗</span>
                      {:else}
                        <span class="prim-kid-count">·</span>
                      {/if}
                    </button>
                  </div>
                {/each}
              </div>
            </div>
          {/if}
          <div class="sb-test-sec">
            <div class="sb-test-sec-h"><span class="sb-test-sec-title">Manual Links</span></div>
          <form class="sb-test-add" onsubmit={(e) => { e.preventDefault(); addTestLink(); }}>
            <input
              class="sb-test-input"
              type="url"
              placeholder="Paste URL and press Enter"
              bind:value={testInput}
              oninput={() => (testInputError = '')}
              aria-label="New test link URL"
            />
            <button class="sb-test-add-btn" type="submit" disabled={!testInput.trim()}>Add</button>
          </form>
          {#if testInputError}
            <div class="sb-test-err">{testInputError}</div>
          {/if}
          {#if testLinks.length === 0}
            <div class="sb-empty">Paste a URL above to start a list. Useful for vendor catalog pages or KB-source PDFs you'll revisit while authoring.</div>
          {:else}
            <div class="sb-list">
              {#each testLinks as link (link.id)}
                <div class="prim-row" class:active={activeTab?.id === `tl:${link.id}`}>
                  <button
                    class="prim-link"
                    class:active={activeTab?.id === `tl:${link.id}`}
                    type="button"
                    onclick={() => openTestLink(link)}
                    title={link.url}
                  >
                    <span class="dot"></span>
                    <span class="pl-name">{link.label ?? link.url}</span>
                  </button>
                  <button
                    class="prim-del"
                    type="button"
                    title="Delete this link"
                    aria-label={`Delete ${link.label ?? link.url}`}
                    onclick={(e) => { e.stopPropagation(); deleteTestLink(link.id); }}
                  >
                    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                      <path fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"
                        d="M3 4.5 H13 M6.5 4.5 V3.25 a0.75 0.75 0 0 1 0.75 -0.75 h1.5 a0.75 0.75 0 0 1 0.75 0.75 V4.5 M4.25 4.5 L5 13 a1 1 0 0 0 1 0.9 h4 a1 1 0 0 0 1 -0.9 L11.75 4.5 M6.75 7 V11.5 M9.25 7 V11.5" />
                    </svg>
                  </button>
                </div>
              {/each}
            </div>
          {/if}
          </div>
        </div>
      {/if}
    </div>
    </div>
  </aside>

  <!-- Family-filter FloatingPanel — anchored to the ⌕ Families button.
       Same shape as SVTC's ScaleSpreadPopover: draggable header,
       sectioned card body, footer with action buttons. -->
  <FloatingPanel
    title="Show families"
    visible={familyFilterOpen}
    onClose={() => (familyFilterOpen = false)}
    x={familyFilterX}
    y={familyFilterY}
    width="540px"
    maxHeight="60vh"
  >
    {#snippet children()}
      <div class="ff-body" use:clickOutside={() => (familyFilterOpen = false)}>
        <div class="ff-head">
          <button class="ff-btn ff-btn-ghost" type="button" onclick={() => setAllFamilies(true)}>Select all</button>
          <button class="ff-btn ff-btn-ghost" type="button" onclick={() => setAllFamilies(false)}>Unselect all</button>
          <button class="ff-btn ff-btn-primary" type="button" onclick={() => (familyFilterOpen = false)}>Done</button>
        </div>
        <div class="ff-grid">
          {#each FAMILIES.filter((fam) => fam.id !== 'basic') as fam (fam.id)}
            {@const inFamily = componentList.filter((r) => entryRailTab(r) === 'components' && entryFamily(r) === fam.id).length}
            {@const on = enabledFamilies.has(fam.id)}
            <label class="ff-section" class:enabled={on}>
              <div class="ff-section-head">
                <span class="ff-section-title">{fam.name}</span>
                <span class="ff-section-meta">{inFamily}</span>
                <input
                  type="checkbox"
                  class="ff-toggle"
                  checked={on}
                  onchange={(e) => {
                    const checked = (e.currentTarget as HTMLInputElement).checked;
                    const next = new Set(enabledFamilies);
                    if (checked) next.add(fam.id); else next.delete(fam.id);
                    enabledFamilies = next;
                    saveEnabledFamilies(next);
                  }}
                />
              </div>
              <div class="ff-section-desc">{fam.description}</div>
            </label>
          {/each}
        </div>
      </div>
    {/snippet}
  </FloatingPanel>

  <!-- Level-filter FloatingPanel — Basic-tab counterpart of the family
       filter. Same shape; LEVELS instead of FAMILIES. -->
  <FloatingPanel
    title="Show levels"
    visible={levelFilterOpen}
    onClose={() => (levelFilterOpen = false)}
    x={levelFilterX}
    y={levelFilterY}
    width="540px"
    maxHeight="60vh"
  >
    {#snippet children()}
      <div class="ff-body" use:clickOutside={() => (levelFilterOpen = false)}>
        <div class="ff-head">
          <button class="ff-btn ff-btn-ghost" type="button" onclick={() => setAllLevels(true)}>Select all</button>
          <button class="ff-btn ff-btn-ghost" type="button" onclick={() => setAllLevels(false)}>Unselect all</button>
          <button class="ff-btn ff-btn-primary" type="button" onclick={() => (levelFilterOpen = false)}>Done</button>
        </div>
        <div class="ff-grid">
          {#each LEVELS as lv (lv.id)}
            {@const inLevel = componentList.filter((r) => entryRailTab(r) === 'basic' && entryLevel(r) === lv.id).length}
            {@const on = enabledLevels.has(lv.id)}
            <label class="ff-section" class:enabled={on}>
              <div class="ff-section-head">
                <span class="ff-section-title">{lv.name}</span>
                <span class="ff-section-meta">{inLevel}</span>
                <input
                  type="checkbox"
                  class="ff-toggle"
                  checked={on}
                  onchange={(e) => {
                    const checked = (e.currentTarget as HTMLInputElement).checked;
                    const next = new Set(enabledLevels);
                    if (checked) next.add(lv.id); else next.delete(lv.id);
                    enabledLevels = next;
                    saveEnabledLevels(next);
                  }}
                />
              </div>
              <div class="ff-section-desc">{lv.description}</div>
            </label>
          {/each}
        </div>
      </div>
    {/snippet}
  </FloatingPanel>

  <!-- Per-param Edit popup — anchored to the ✎ button on open. Single
       instance reused for whichever param is being edited (at most one
       open at a time). SVTC-style: click-outside closes, draggable
       header, Apply/Cancel pinned in the footer. -->
  {#if activeTab && activeTab.kind === 'xml-primitive' && activeTab.paramEdit}
    {@const pe = activeTab.paramEdit}
    {@const willRename = pe.name !== pe.key}
    {@const ce = activeTab.componentEntry}
    {@const curSrc = (activeTab.sourceDraft ?? ce?.source ?? '')}
    {@const peImported = importedFromSource(curSrc)}
    {@const pePartGroups = [
      ...HELPERS.filter((h) => peImported.helpers.has(h.name)).map((h) => ({ key: h.name.toLowerCase(), name: h.name })),
      ...componentList.filter((r) => peImported.components.has(r.meta.id)).map((p) => ({ key: p.meta.name.toLowerCase(), name: p.meta.name })),
    ]}
    <FloatingPanel
      title={`Edit ${pe.key}`}
      visible={true}
      onClose={() => closeParamEdit(activeTab!)}
      x={paramEditX}
      y={paramEditY}
      width="380px"
      maxHeight="70vh"
    >
      {#snippet children()}
        <div class="pe-body" use:clickOutside={() => activeTab && closeParamEdit(activeTab)}>
          <div class="pr-edit-grid">
            <label class="pr-edit-lbl">Variable
              <input class="pf-in pr-edit-name" type="text" spellcheck="false" value={pe.name}
                oninput={(e) => { if (activeTab?.paramEdit) activeTab.paramEdit.name = (e.currentTarget as HTMLInputElement).value; }} />
            </label>
            <label class="pr-edit-lbl">Label
              <input class="pf-in" type="text" value={pe.label}
                oninput={(e) => { if (activeTab?.paramEdit) activeTab.paramEdit.label = (e.currentTarget as HTMLInputElement).value; }} />
            </label>
            <label class="pr-edit-lbl">Default
              <input class="pf-in" type="number" step="any" value={pe.defaultStr}
                oninput={(e) => { if (activeTab?.paramEdit) activeTab.paramEdit.defaultStr = (e.currentTarget as HTMLInputElement).value; }} />
            </label>
            <label class="pr-edit-lbl">Unit
              <input class="pf-in" type="text" value={pe.unit}
                oninput={(e) => { if (activeTab?.paramEdit) activeTab.paramEdit.unit = (e.currentTarget as HTMLInputElement).value; }} />
            </label>
            <label class="pr-edit-lbl">Min
              <input class="pf-in" type="number" step="any" value={pe.minStr}
                oninput={(e) => { if (activeTab?.paramEdit) activeTab.paramEdit.minStr = (e.currentTarget as HTMLInputElement).value; }} />
            </label>
            <label class="pr-edit-lbl">Max
              <input class="pf-in" type="number" step="any" value={pe.maxStr}
                oninput={(e) => { if (activeTab?.paramEdit) activeTab.paramEdit.maxStr = (e.currentTarget as HTMLInputElement).value; }} />
            </label>
            <label class="pr-edit-lbl">Step
              <input class="pf-in" type="number" step="any" value={pe.stepStr}
                oninput={(e) => { if (activeTab?.paramEdit) activeTab.paramEdit.stepStr = (e.currentTarget as HTMLInputElement).value; }} />
            </label>
          </div>
          {#if willRename}
            <p class="pr-edit-warn">⚠ Apply will refactor <code>{pe.key}</code> → <code>{pe.name}</code> across the geom body.</p>
          {/if}
          <label class="pr-edit-lbl pr-edit-desc-row">Description
            <input class="pf-in" type="text" placeholder="What does this parameter control?" value={pe.desc}
              oninput={(e) => { if (activeTab?.paramEdit) activeTab.paramEdit.desc = (e.currentTarget as HTMLInputElement).value; }} />
          </label>
          <label class="pr-edit-lbl pr-edit-desc-row">Part
            <select class="pf-in" value={pe.group}
              onchange={(e) => { if (activeTab?.paramEdit) activeTab.paramEdit.group = (e.currentTarget as HTMLSelectElement).value; }}>
              <option value="">(General — no part)</option>
              {#each pePartGroups as p (p.key)}
                <option value={p.name}>{p.name}</option>
              {/each}
            </select>
          </label>
          {#if pe.error}<p class="pf-err">{pe.error}</p>{/if}
          <div class="pf-actions">
            <button class="save-btn" type="button" onclick={() => submitParamEdit(activeTab!)}>Apply</button>
            <button class="discard-btn" type="button" onclick={() => closeParamEdit(activeTab!)}>Cancel</button>
          </div>
        </div>
      {/snippet}
    </FloatingPanel>
  {/if}

  <!-- Per-arg Formula popup — opened by the ƒ in an instance-prop cell.
       Mini script editor: a single-line text input + a typeahead list
       filtered by the word at the caret. Click a suggestion to splice
       it in at the caret; Apply writes the raw expression back into the
       source. The text is emitted verbatim — `p.<param>` works at
       runtime, arithmetic works (`p.od / 2`), inter-instance refs like
       `A.outerR` are documentation-only for now. -->
  {#if activeTab && activeTab.kind === 'xml-primitive' && activeTab.formulaEdit}
    {@const fe = activeTab.formulaEdit}
    {@const wac = wordAtCaret(fe.raw, fe.caret)}
    {@const cands = formulaCandidates(activeTab, fe.instance)}
    {@const filtered = wac.word
      ? cands.filter((c) => c.toLowerCase().includes(wac.word.toLowerCase()))
      : cands}
    <FloatingPanel
      title="Formula"
      visible={true}
      onClose={() => closeFormulaEdit(activeTab!)}
      x={formulaEditX}
      y={formulaEditY}
      width="320px"
      maxHeight="60vh"
    >
      {#snippet children()}
        <div class="fx-body" use:clickOutside={() => activeTab && closeFormulaEdit(activeTab)}>
          <input
            class="fx-input"
            type="text"
            placeholder="e.g. p.od / 2"
            spellcheck="false"
            autocomplete="off"
            value={fe.raw}
            oninput={(e) => {
              if (!activeTab?.formulaEdit) return;
              const el = e.currentTarget as HTMLInputElement;
              activeTab.formulaEdit.raw = el.value;
              activeTab.formulaEdit.caret = el.selectionStart ?? el.value.length;
            }}
            onkeyup={(e) => {
              if (!activeTab?.formulaEdit) return;
              const el = e.currentTarget as HTMLInputElement;
              activeTab.formulaEdit.caret = el.selectionStart ?? el.value.length;
            }}
            onclick={(e) => {
              if (!activeTab?.formulaEdit) return;
              const el = e.currentTarget as HTMLInputElement;
              activeTab.formulaEdit.caret = el.selectionStart ?? el.value.length;
            }}
            onkeydown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); applyFormulaEdit(activeTab!); }
              if (e.key === 'Escape') { e.preventDefault(); closeFormulaEdit(activeTab!); }
            }}
          />
          {#if filtered.length > 0}
            <ul class="fx-list">
              {#each filtered.slice(0, 10) as cand (cand)}
                {@const resolved = resolveCandidate(activeTab, cand, fe.instance)}
                {@const isInter = cand !== resolved}
                <li>
                  <button
                    class="fx-cand"
                    type="button"
                    title={isInter ? `Inserts: ${resolved}` : undefined}
                    onclick={() => {
                      if (!activeTab?.formulaEdit) return;
                      const r = replaceWordAtCaret(activeTab.formulaEdit.raw, activeTab.formulaEdit.caret, resolved);
                      activeTab.formulaEdit.raw = r.text;
                      activeTab.formulaEdit.caret = r.caret;
                    }}
                  >{cand}{#if isInter}<span class="fx-resolved"> → {resolved}</span>{/if}</button>
                </li>
              {/each}
            </ul>
          {/if}
          <div class="pf-actions">
            <button class="save-btn" type="button" onclick={() => applyFormulaEdit(activeTab!)}>Apply</button>
            <button class="discard-btn" type="button" onclick={() => closeFormulaEdit(activeTab!)}>Cancel</button>
          </div>
        </div>
      {/snippet}
    </FloatingPanel>
  {/if}

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
    {:else if activeTab && activeTab.kind === 'source'}
      <!-- Source tab body — embedded document viewer.
           - Local PDFs use <embed type="application/pdf"> (Chrome's
             built-in PDF viewer; <iframe sandbox=...> blocks it).
           - URLs render in <iframe> with no sandbox (most sites that
             refuse iframing do so via X-Frame-Options / CSP — sandbox
             doesn't change that, and dropping it lets pages that DO
             allow embedding work normally; the "Open externally"
             header link is the fallback).
           - Both elements are keyed by activeTab.id via the #key
             block so switching source tabs fully remounts the viewer
             instead of reusing a stale, failed-load element. -->
      {@const isPdf = !activeTab.sourceUrl && !!activeTab.sourceFile}
      {@const viewerSrc = activeTab.sourceUrl ?? (activeTab.sourceFile ? `/api/kb/source-pdf?path=${encodeURIComponent(activeTab.sourceFile)}` : '')}
      {@const isImage = /\.(png|jpe?g|webp|gif)$/i.test(viewerSrc)}
      <div class="tab-body source-tab">
        <div class="source-hdr">
          <span class="source-hdr-label">{activeTab.sourceLabel ?? activeTab.label}</span>
          {#if activeTab.sourceKind}<span class="source-hdr-kind">{activeTab.sourceKind.replace(/_/g, ' ')}</span>{/if}
          {#if isPdf}<span class="source-hdr-kind">local PDF</span>{/if}
          {#if isImage}<span class="source-hdr-kind">figure</span>{/if}
          {#if activeTab.sourceUrl}
            <a class="source-hdr-ext" href={activeTab.sourceUrl} target="_blank" rel="noopener noreferrer">Open externally ↗</a>
          {/if}
        </div>
        {#if viewerSrc}
          {#key activeTab.id}
            {#if isImage}
              <div class="source-img-wrap">
                <img class="source-img" src={viewerSrc} alt={activeTab.sourceLabel ?? activeTab.label} />
              </div>
            {:else if isPdf}
              <embed
                class="source-iframe"
                type="application/pdf"
                src={viewerSrc}
                title={activeTab.sourceLabel ?? activeTab.label}
              />
            {:else}
              <iframe
                class="source-iframe"
                src={viewerSrc}
                title={activeTab.sourceLabel ?? activeTab.label}
                referrerpolicy="no-referrer"
              ></iframe>
            {/if}
          {/key}
        {:else}
          <div class="source-empty">No URL or local file available for this source.</div>
        {/if}
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
               atom for component tabs; falls back to the script glyph
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
              {#if activeDef.description || activeTab.componentEntry?.instructions}
                <button
                  class="stage-info-btn"
                  class:active={stageInfoOpen}
                  type="button"
                  aria-label="About this primitive"
                  title="About this primitive"
                  onclick={() => (stageInfoOpen = !stageInfoOpen)}
                >i</button>
                {#if stageInfoOpen}
                  <div class="stage-info-pop" role="dialog">
                    <button
                      class="stage-info-close"
                      type="button"
                      aria-label="Close"
                      onclick={() => (stageInfoOpen = false)}
                    >×</button>
                    {#if activeDef.description}
                      <p class="stage-info-desc">{activeDef.description}</p>
                    {/if}
                    {#if activeTab.componentEntry?.instructions}
                      <p class="stage-info-more">Longer notes live in the <strong>📖 MD</strong> tab.</p>
                    {/if}
                  </div>
                {/if}
              {/if}
            </div>
            <div class="stage-badges">
              <span class="badge cat">{activeDef.category}</span>
              {#if compound}<span class="badge compound-tag">compound — to be decomposed</span>{/if}
              {#if PIPE_PRIMS.has(activeDef.id)}<span class="badge pipe">pipe</span>{/if}
              {#if activeTab.draft}<span class="badge draft-tag">draft</span>{/if}
              {#if activeTab.kind === 'xml-primitive'}<span class="badge pipe">component</span>{/if}
              <!-- Z× compression slider now lives in the canvas-corner
                   settings gear (SceneControls). Reading scene.zScale
                   for the buildKey below. -->
            </div>
          </header>

          <!-- Stage sub-tabs: Render = the 3D canvas, Picture = per-
               primitive reference image stored on the volume at
               <volume>/components/<id>.source.png. The Picture tab is
               the upstream of the "generate from picture" workflow:
               the user attaches the source crop, then Claude vision
               reads it to build / refine the .ts. -->
          <div class="stage-subtabs">
            <button
              class="stage-subtab"
              class:active={stageTab === '3d'}
              type="button"
              onclick={() => (stageTab = '3d')}
            >3D</button>
            <button
              class="stage-subtab"
              class:active={stageTab === 'picture'}
              type="button"
              onclick={() => { stageTab = 'picture'; pictureLoadStatus = 'loading'; }}
            >Picture</button>
          </div>

          {#if stageTab === 'picture'}
            <div class="stage-picture">
              {#key activeTab.id}
                {#if pictureLoadStatus !== 'missing'}
                  <img
                    class="stage-picture-img"
                    class:hidden={pictureLoadStatus !== 'present'}
                    src={activeTab.pictureUrl ?? pictureUrlFor(activeTab.primId)}
                    alt={`Reference picture for ${activeDef.name}`}
                    onload={() => (pictureLoadStatus = 'present')}
                    onerror={() => (pictureLoadStatus = 'missing')}
                  />
                {/if}
                {#if pictureLoadStatus === 'missing'}
                  <div class="stage-picture-empty">
                    <p class="stage-picture-empty-title">No reference picture for <code>{activeDef.id}</code>.</p>
                    <p class="stage-picture-empty-hint">Attach the catalog/spec crop that was used to author this primitive — Claude reads it during AI Refine so the geometry tracks the source.</p>
                    <label class="stage-picture-upload" class:disabled={pictureUploadStatus === 'uploading'}>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onchange={(e) => {
                          const f = (e.currentTarget as HTMLInputElement).files?.[0];
                          if (f) uploadPicture(activeTab!.primId, f);
                        }}
                      />
                      {pictureUploadStatus === 'uploading' ? 'Uploading…' : 'Upload picture'}
                    </label>
                    {#if pictureUploadStatus === 'error'}
                      <p class="stage-picture-err">{pictureUploadError}</p>
                    {/if}
                    <p class="stage-picture-hint">
                      Or PUT it via <code>/api/volume?path=components/{activeDef.id}.source.png</code>.
                    </p>
                  </div>
                {/if}
              {/key}
            </div>
          {:else}
          <!-- 3D stage — toggle picks the geometry source. Mesh = live
               ManifoldCAD rebuild on every param drag; GLB = the static
               file bakeGlb() wrote on last save (loads <id>.cut.glb or
               <id>.glb depending on scene.showCutaway). Both run inside
               the same Canvas with the same SceneControls. -->
          <div class="stage-3d">
            <!-- Inner toggle pill — mesh / glb selector. -->
            <div class="stage-view-toggle">
              <button class="stage-view-btn" class:active={stageView === 'mesh'} type="button" onclick={() => (stageView = 'mesh')}>Mesh</button>
              <button class="stage-view-btn" class:active={stageView === 'glb'} type="button" onclick={() => (stageView = 'glb')}>GLB</button>
            </div>
            {#if stageView === 'glb'}
              {#if SceneGlbComponent}
                {@const GlbScene = SceneGlbComponent}
                {@const glbUrl = scene.showCutaway
                  ? `/components/${activeDef.id}.cut.glb`
                  : `/components/${activeDef.id}.glb`}
                <Canvas {createRenderer}>
                  <GlbScene url={glbUrl} />
                </Canvas>
                {#if SceneControls}
                  {@const Controls = SceneControls}
                  <Controls />
                {/if}
                <div class="stage-glb-hint" title={glbUrl}>
                  served from <code>{glbUrl}</code>
                </div>
              {:else}
                <div class="stage-loading"><span class="stage-loading-text">Loading scene…</span></div>
              {/if}
            {:else if SceneComponent && geo}
              <Canvas {createRenderer}>
                {@const Scene = SceneComponent}
                <Scene {geo} {geoVersion} showCutaway={scene.showCutaway} showEdges={scene.showEdges} />
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
            {:else if activeTab.unconstructed}
              <!-- Figure draft — a blank component shell. No geometry
                   yet; the source figure is one click away on the
                   Picture tab. -->
              <div class="stage-blank">
                <div class="stage-blank-icon">◳</div>
                <p class="stage-blank-title">Not constructed yet</p>
                <p class="stage-blank-hint">
                  This is a blank component built from <code>{activeDef.id}</code>.
                  The reference figure is on the <button class="inline-btn" type="button" onclick={() => { stageTab = 'picture'; pictureLoadStatus = 'loading'; }}>Picture</button> tab.
                </p>
                <p class="stage-blank-hint">
                  Construct it with the <button class="inline-btn" type="button" onclick={() => openInspector('ai')}>AI Refine</button>
                  tab, or write the geometry by hand in the
                  <button class="inline-btn" type="button" onclick={() => openInspector('svelte')}>Svelte</button> tab.
                </p>
              </div>
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
          {/if}
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
        width="min(816px, calc(100% - 80px))"
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
            <!-- Runes primitives: tab order is AI → Parts → Builder.
                 The former Params tab is folded into Parts — each param
                 group renders as a collapsible accordion section inside
                 the Parts view. AI is leftmost (and the default selection). -->
            <button class="insp-tab insp-tab-ai" class:active={inspectorTab === 'ai'} type="button" onclick={() => (inspectorTab = 'ai')}>
              <span class="ic">✦</span> AI
            </button>
            <button class="insp-tab" class:active={inspectorTab === 'parts'} type="button" onclick={() => (inspectorTab = 'parts')}>
              <span class="ic">⊞</span> Parts
            </button>
          {:else if isParamTab}
            <!-- Legacy primitives keep the standalone Params tab — they
                 have no Parts axis (single ComponentDef, no helpers). -->
            <button class="insp-tab" class:active={inspectorTab === 'params'} type="button" onclick={() => (inspectorTab = 'params')}>
              <span class="ic">⚙</span> Params
            </button>
          {/if}
          {#if activeTab.kind === 'xml-primitive'}
            <button class="insp-tab" class:active={inspectorTab === 'svelte'} type="button" onclick={() => (inspectorTab = 'svelte')}>
              <span class="ic">🛠</span> Builder
            </button>
          {:else}
            <!-- Legacy primitives: Script tab extracts from builder.ts. -->
            <button class="insp-tab" class:active={inspectorTab === 'script'} type="button" onclick={() => (inspectorTab = 'script')}>
              <span class="ic">{'</>'}</span> Script
            </button>
          {/if}
        </div>

        {#if (inspectorTab === 'params' && isParamTab && activeTab.kind !== 'xml-primitive') || (inspectorTab === 'parts' && activeTab.kind === 'xml-primitive' && activeTab.componentEntry)}
          {@const allDefs = (activeTab.componentEntry?.meta.params ?? activeDef.params) as Readonly<Record<string, ParamSchema & { group?: string }>>}
          <!-- xml-primitive: groups = the in-use HELPERS + COMPOSED COMPONENTS;
               each is one accordion bar, content = params whose `group` field
               matches the part name (case-insensitive). Params with no
               matching part collapse into a trailing General section.
               Legacy primitives keep the simple param-group derivation
               (group field clustering) since they have no parts axis. -->
          {@const isXml = activeTab.kind === 'xml-primitive' && !!activeTab.componentEntry}
          {@const curSrc = isXml ? (activeTab.sourceDraft ?? activeTab.componentEntry!.source) : ''}
          {@const imported = isXml ? importedFromSource(curSrc) : { helpers: new Set<string>(), components: new Set<string>() }}
          {@const instances = isXml && curSrc ? parsePartInstances(curSrc) : []}
          {@const partGroups = isXml ? [
            // One accordion entry per INSTANCE (strict-grammar GUI). The
            // helper-level grouping is implied by the instance's callName;
            // a tube and a cyl in the same component each get their own
            // row with header `A = tube(…)`, `B = cyl(…)`.
            ...instances
              .filter((i) => HELPERS.some((h) => h.name === i.callName))
              .map((i) => ({
                key: `inst:${i.instance}`,
                name: i.instance,
                sig: `:${i.callName}`,
                removeKind: 'instance' as const,
                removeId: i.instance,
                instance: i,
              })),
            // Components stay grouped per component-id (the legacy shape).
            // Per-instance component breakdown can land once components
            // join the strict-grammar parser.
            ...componentList.filter((r) => imported.components.has(r.meta.id)).map((p) => ({ key: p.meta.name.toLowerCase(), name: p.meta.name, sig: `geom(${Object.keys(p.meta.params).join(', ')})`, removeKind: 'component' as const, removeId: p.meta.id, instance: undefined })),
          ] : []}
          {@const paramKeys = Object.keys(activeTab.params)}
          {@const matchedSet = new Set(partGroups.map((p) => p.key))}
          {@const orphanKeys = paramKeys.filter((k) => !matchedSet.has((allDefs[k]?.group ?? '').toLowerCase()))}
          {@const useParts = isXml && partGroups.length > 0}
          {@const groups = useParts
            ? [
                ...(orphanKeys.length > 0 ? [{ key: '__general__', name: 'General', sig: '', removeKind: null as null, removeId: '', instance: undefined }] : []),
                ...partGroups.map((p) => ({ key: p.key, name: p.name, sig: p.sig, removeKind: p.removeKind, removeId: p.removeId, instance: p.instance })),
              ]
            : paramGroupsOf(allDefs).map((g) => ({ key: g, name: g === '__default__' ? 'General' : g, sig: '', removeKind: null as null, removeId: '', instance: undefined }))}
          {@const accordion = useParts || groups.length > 1}
          <div class="ed-sec compact">
            <div class="ed-sec-h thin">
              <span class="muted">{Object.keys(activeTab.params).length}</span>
              {#if activeTab.kind === 'xml-primitive'}
                <!-- The `+` in this header opens the parts picker (geom
                     ops live here, not param schema). Param-add is a
                     secondary affordance available in the per-param row
                     edit popup; the AI tab is the primary way new params
                     enter a primitive anyway. -->
                <button class="add-param-plus" type="button" onclick={() => { partsAddHelperOpen = true; }} title="Add a part">+</button>
              {:else if activeTab.draft}
                <button class="row-add" type="button" onclick={() => addParam(activeTab!)} title="Add a draft parameter">+ param</button>
              {/if}
            </div>

            {#if activeTab.descForm?.open}
              {@const df = activeTab.descForm}
              <div class="param-form">
                <div class="pf-h">Edit descriptions <span class="muted">— shows on hover</span></div>
                {#each Object.keys(df.drafts) as key (key)}
                  <div class="pf-desc-row">
                    <span class="pr-keyname">{key}</span>
                    <input
                      class="pf-in pf-desc-input"
                      type="text"
                      placeholder="What does this parameter control?"
                      bind:value={df.drafts[key]}
                    />
                  </div>
                {/each}
                {#if df.error}<p class="pf-err">{df.error}</p>{/if}
                <div class="pf-actions">
                  <button class="save-btn" type="button" onclick={() => submitDescEdit(activeTab!)}>Apply</button>
                  <button class="discard-btn" type="button" onclick={() => closeDescEdit(activeTab!)}>Cancel</button>
                </div>
              </div>
            {/if}

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
            <!-- Param-group accordion. When the primitive's params declare a
                 `group` field (e.g. box_conn → "Body" / "Cone"), each group
                 renders as a collapsible accordion section. When ALL params
                 share the same group (or no group is set), no headers render
                 — a single flat grid. allDefs / groups / accordion are
                 hoisted to the parent {#if} above (Svelte 5 requires
                 {@const} as direct child of a block). -->
            {#each groups as g (g.key)}
              {@const groupKeys = useParts
                ? (g.key === '__general__'
                    ? orphanKeys
                    : paramKeys.filter((k) => (allDefs[k]?.group ?? '').toLowerCase() === g.key))
                : paramKeys.filter((k) => (allDefs[k]?.group ?? '__default__') === g.key)}
              {@const collapsed = accordion && isParamGroupCollapsed(activeTab.id, g.key)}
              {#if accordion}
                <button
                  class="pg-acc-head"
                  class:collapsed
                  type="button"
                  onclick={() => toggleParamGroupCollapse(activeTab!.id, g.key)}
                >
                  <span class="pg-acc-chev">{collapsed ? '▸' : '▾'}</span>
                  <span class="pg-acc-title">{g.name}</span>
                  {#if g.sig}<span class="pg-acc-sig">{g.sig}</span>{/if}
                  {#if !g.instance}<span class="pg-acc-count">{groupKeys.length}</span>{/if}
                  {#if g.removeKind === 'instance'}
                    <button
                      class="pg-acc-x"
                      type="button"
                      title={`Remove ${g.name}`}
                      aria-label={`Remove ${g.name}`}
                      onclick={(e) => { e.stopPropagation(); removeInstance(g.removeId); }}
                    >×</button>
                  {:else if g.removeKind === 'component'}
                    <button
                      class="pg-acc-x"
                      type="button"
                      title={`Remove ${g.name}`}
                      aria-label={`Remove ${g.name}`}
                      onclick={(e) => { e.stopPropagation(); removeRunes(g.removeId); }}
                    >×</button>
                  {/if}
                </button>
              {/if}
              {#if !collapsed}
              <!-- Per-instance Props grid (strict-grammar GUI). The
                   accordion entry IS the instance — the body just renders
                   one `pr-card` per typed prop. Each literal arg is a
                   number input (with drag-to-scrub); a `paramRef`
                   renders as a read-only `p.<name>` chip. -->
              {@const inst = g.instance}
              {@const helperMeta = inst ? HELPERS.find((h) => h.name === inst.callName) : null}
              {#if inst && helperMeta}
                <div class="pr-grid">
                  {#each helperMeta.props as prop, idx (prop.name)}
                    {@const arg = inst.args[idx]}
                    <div class="pr-card">
                      <div class="pr-card-head">
                        <span class="pr-keyname">{prop.name}</span>
                        {#if prop.optional}<span class="pr-unit-inline">opt</span>{/if}
                      </div>
                      <!-- Value cell: ƒ on the LEFT (always-visible
                           formula entry point), then the value indicator
                           on the right. Formula args show a compact
                           "fx" badge — full expression on hover-tooltip
                           via title=. -->
                      <div class="pr-val">
                        <button
                          class="pr-fx"
                          class:active={arg && arg.kind !== 'literal'}
                          type="button"
                          title={arg && arg.kind !== 'literal' ? `Formula: ${arg.raw}` : 'Edit as formula'}
                          aria-label="Edit as formula"
                          onclick={(e) => openFormulaEdit(activeTab!, inst.instance, idx, e)}
                        >ƒ</button>
                        {#if arg && arg.kind === 'literal'}
                          <input
                            class="pr-num drag"
                            type="number"
                            step="0.05"
                            value={arg.value}
                            onchange={(e) => {
                              const v = Number((e.currentTarget as HTMLInputElement).value);
                              if (!Number.isFinite(v) || !activeTab?.componentEntry) return;
                              const cur = activeTab.sourceDraft ?? activeTab.componentEntry.source;
                              const next = setInstanceArg(cur, inst.instance, idx, String(v));
                              if (next != null) activeTab.sourceDraft = next;
                            }}
                            use:dragNumber={{
                              step: 0.05,
                              get: () => arg.value,
                              set: (v) => {
                                if (!activeTab?.componentEntry) return;
                                const cur = activeTab.sourceDraft ?? activeTab.componentEntry.source;
                                const next = setInstanceArg(cur, inst.instance, idx, String(v));
                                if (next != null) activeTab.sourceDraft = next;
                              },
                            }}
                            title="Click to type · drag horizontally to scrub"
                          />
                        {:else if arg && arg.kind === 'paramRef'}
                          <span class="pi-fx-badge" title={`p.${arg.name}`}>fx</span>
                        {:else if arg}
                          <span class="pi-fx-badge" title={arg.raw}>fx</span>
                        {:else}
                          <span class="pi-fx-badge muted" title="not set">—</span>
                        {/if}
                      </div>
                    </div>
                  {/each}
                </div>
              {/if}
              <!-- Grid of param cards. Each card has label · slider · number
                   inline. Empty hint when a part has no params bound via
                   the `group` field. -->
              {#if groupKeys.length === 0 && useParts && g.key !== '__general__' && !g.instance}
                <div class="pg-acc-empty">
                  No params bound to <code>{g.name}</code>. Add <code>group: '{g.name}'</code> to a param schema to show it here.
                </div>
              {/if}
              <div class="pr-grid">
                {#each groupKeys as key (key)}
                {@const def = paramDef(activeDef, key)}
                {@const isExtra = !(key in activeDef.params)}
                {@const tip = buildParamTip(key, def, isExtra)}
                <div class="pr-card" class:extra={isExtra}>
                  <!-- Top row: label · unit · row buttons. Stays compact;
                       the drag-number lives below at full width. -->
                  <div class="pr-card-head">
                    <span class="pr-keyname" data-tip={tip}>{key}{isExtra ? '*' : ''}</span>
                    {#if def.unit}<span class="pr-unit-inline">({def.unit})</span>{/if}
                    {#if activeTab.kind === 'xml-primitive' && key in (activeTab.componentEntry?.meta.params ?? {})}
                      <button class="row-edit" type="button" onclick={(e) => openParamEdit(activeTab!, key, e)} title="Edit this parameter" aria-label="Edit parameter">✎</button>
                    {/if}
                    {#if activeTab.draft}
                      <button class="row-x" type="button" onclick={() => removeParam(activeTab!, key)} title="Remove parameter" aria-label="Remove parameter">×</button>
                    {/if}
                  </div>
                  {#if def.choices && Object.keys(def.choices).length}
                    <select class="pr-choice" bind:value={activeTab.params[key]}>
                      {#each Object.entries(def.choices) as [name, val] (name)}
                        <option value={val}>{name}</option>
                      {/each}
                    </select>
                  {:else}
                    <input
                      class="pr-num drag"
                      type="number"
                      step={def.step}
                      min={def.min}
                      max={def.max}
                      bind:value={activeTab.params[key]}
                      use:dragNumber={{
                        step: def.step ?? 1,
                        min: def.min,
                        max: def.max,
                        get: () => activeTab.params[key] ?? 0,
                        set: (v) => { activeTab!.params[key] = v; },
                      }}
                      title="Click to type · drag horizontally to scrub"
                    />
                  {/if}
                </div>
                {/each}
              </div>
              {/if}
            {/each}
          </div>

          {#if activeTab.kind === 'xml-primitive' && activeTab.componentEntry?.meta.derived}
            {@const derivedMeta = activeTab.componentEntry.meta.derived}
            {@const resolved = resolveDerivedSafe(derivedMeta, activeTab.params)}
            <div class="ed-sec">
              <div class="ed-sec-h">
                Derived <span class="muted">{Object.keys(derivedMeta).length} · read-only</span>
              </div>
              <div class="pr-grid">
                {#each Object.entries(derivedMeta) as [key, schema] (key)}
                  <div class="pr-card derived">
                    <div class="pr-card-head">
                      <span class="pr-keyname" data-tip={buildDerivedTip(key, schema)}>{key}</span>
                      {#if schema.unit}<span class="pr-unit-inline">({schema.unit})</span>{/if}
                    </div>
                    <span class="pr-derived-val">{fmtDerived(resolved[key])}</span>
                  </div>
                {/each}
              </div>
            </div>
          {/if}

          <!-- Imports list + "+ Add primitive" picker (was the standalone
               Parts tab content before the merge). Sits below the param
               accordion so the slider grid is the dominant surface — the
               imports list and Add button are secondary chrome. -->
          <!-- "+ Add primitive" picker. Each used part is already visible
               above as an accordion bar with its own × remove button, so
               the duplicate in-use list is gone — only the add affordance
               remains here. -->
          {#if activeTab.kind === 'xml-primitive' && activeTab.componentEntry}
            {@const selfId2 = activeTab.componentEntry.meta.id}
            {@const availableHelpers = HELPERS.filter((h) => !imported.helpers.has(h.name))}
            {@const availableComponents = componentList.filter((r) => r.meta.id !== selfId2 && !imported.components.has(r.meta.id))}
            {@const availableCount = availableHelpers.length + availableComponents.length}
            {#if availableCount > 0}
              <div class="parts-pane parts-add-only">
                <button class="parts-add-btn" type="button" onclick={() => (partsAddHelperOpen = !partsAddHelperOpen)}>
                  {partsAddHelperOpen ? '− Hide catalog' : '+ Add primitive'}
                </button>
                {#if partsAddHelperOpen}
                  {@const q = partsSearch.trim().toLowerCase()}
                  {@const filteredHelpers = q
                    ? availableHelpers.filter((h) => `${h.name} ${h.sig} ${h.desc}`.toLowerCase().includes(q))
                    : availableHelpers}
                  {@const filteredComponents = q
                    ? availableComponents.filter((p) => `${p.meta.name} ${p.meta.id} ${p.meta.description ?? ''}`.toLowerCase().includes(q))
                    : availableComponents}
                  <div class="parts-picker">
                    <input
                      bind:this={partsSearchEl}
                      bind:value={partsSearch}
                      class="pf-in parts-picker-search"
                      type="text"
                      placeholder="Filter…"
                      aria-label="Filter primitives"
                    />
                    {#each filteredHelpers as h (`h:${h.name}`)}
                      <button class="part-pick" type="button" title={h.desc} onclick={() => { insertHelperSnippet(h.name); partsAddHelperOpen = false; }}>
                        <span class="part-name">{h.name}</span>
                        <span class="part-sig">{h.sig}</span>
                      </button>
                    {/each}
                    {#each filteredComponents as p (`r:${p.meta.id}`)}
                      <button class="part-pick" type="button" title={`Compose ${p.meta.name}`} onclick={() => { insertRunesSnippet(p); partsAddHelperOpen = false; }}>
                        <span class="part-name">{p.meta.name}</span>
                        <span class="part-sig">geom({Object.keys(p.meta.params).join(', ')})</span>
                      </button>
                    {/each}
                    {#if q && filteredHelpers.length + filteredComponents.length === 0}
                      <div class="parts-picker-empty">No matches for "{partsSearch}"</div>
                    {/if}
                  </div>
                {/if}
              </div>
            {/if}
          {/if}

        {:else if inspectorTab === 'svelte' && activeTab.kind === 'xml-primitive' && activeTab.componentEntry}
          {@const entry = activeTab.componentEntry}
          {@const m = entry.meta}
          {@const dirty = activeTab.sourceDraft != null && activeTab.sourceDraft !== entry.source}
          {@const editorSource = activeTab.sourceDraft ?? entry.source}
          {@const split = splitRune(editorSource)}
          {@const editorCompletions = buildEditorCompletions(m)}
          {#if split.ok}
            <!-- Section 1: imports + meta + geom scaffolding, collapsed
                 by default. The user only expands this when they want to
                 add/remove imports, tweak meta fields, or change the
                 destructure args list. -->
            <details class="meta-section">
              <summary>
                <span class="meta-summary-chev">▶</span>
                <span class="meta-summary-title">imports · meta · signature</span>
                <span class="meta-summary-sub">click to expand · {Object.keys(m.params).length} params{m.derived ? ` · ${Object.keys(m.derived).length} derived` : ''}</span>
              </summary>
              <div class="meta-editor-wrap">
                <CodeEditor
                  value={split.header}
                  lang="typescript"
                  variant="svelte"
                  readonly={false}
                  completions={editorCompletions}
                  onChange={(next) => { if (activeTab) applyHeaderEdit(activeTab, next); }}
                  onSave={() => { if (activeTab) saveRunesSource(activeTab); }}
                />
              </div>
            </details>
            <!-- Section 2: read-only destructure args. Mirrors what the
                 collapsed signature line declares; updates automatically
                 when the user edits the header above. -->
            <div class="args-bar" title="Edit via the collapsible section above. These names are what the body can reference.">
              <span class="args-prefix">args:</span>
              <code class="args-code">{split.args} =&gt;</code>
            </div>
            <!-- Section 3: construction body. The main editor — the only
                 place the user touches for normal work. Helpers / components
                 / current params / derived all available via autocomplete. -->
            <div class="editor-wrap">
              <CodeEditor
                value={split.body}
                lang="typescript"
                variant="svelte"
                readonly={false}
                completions={editorCompletions}
                onChange={(next) => { if (activeTab) applyBodyEdit(activeTab, next); }}
                onSave={() => { if (activeTab) saveRunesSource(activeTab); }}
              />
            </div>
          {:else}
            <!-- Fallback: file doesn't match the defineGeom shape (legacy
                 primitive, or temporarily broken syntax). Render the
                 whole source in one editor so the user is never locked
                 out — they can recover and on next render the split
                 picks back up. -->
            <div class="split-warn">
              <span class="warn-icon">⚠</span>
              <span>This file doesn't match the <code>defineGeom</code> shape — showing full source. Sectioned view resumes once the structure parses.</span>
            </div>
            {@const defaultFolds = componentDefaultFolds(editorSource)}
            <div class="editor-wrap">
              <CodeEditor
                value={editorSource}
                lang="typescript"
                variant="svelte"
                readonly={false}
                initialFold={defaultFolds}
                completions={editorCompletions}
                onChange={(next) => { if (activeTab) activeTab.sourceDraft = next; }}
                onSave={() => { if (activeTab) saveRunesSource(activeTab); }}
              />
            </div>
          {/if}
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
          <p class="code-note">Source: <code>src/lib/cad/components/{m.id}.ts</code> · save via the bar below.</p>
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
        {:else if inspectorTab === 'ai' && activeTab.kind === 'xml-primitive' && activeTab.componentEntry}
          {@const ai = activeTab.ai ?? { prompt: '', status: 'idle', history: [] }}
          {@const instOnDisk = activeTab.componentEntry.instructions ?? ''}
          {@const instCurrent = ai.instructionsDraft ?? instOnDisk}
          {@const instDirty = ai.instructionsDraft != null && ai.instructionsDraft !== instOnDisk}
          <div class="ai-pane two-section">
            <!-- ─── Section 1: Prompt + History sub-tabs ────────────────────
                 Prompt = the immediate ask (combined with the instructions
                 doc below at refine-time). History = the persisted trail of
                 past refines for this component, loaded from the volume via
                 /api/components/prompts. -->
            <div class="ai-sec">
              <div class="ai-sec-h">
                <span class="ai-sec-title">✦ Prompt</span>
                <div class="inst-view-toggle">
                  <button
                    class="inst-view-btn"
                    class:active={aiSubTab === 'prompt'}
                    type="button"
                    onclick={() => (aiSubTab = 'prompt')}
                  >Prompt</button>
                  <button
                    class="inst-view-btn"
                    class:active={aiSubTab === 'history'}
                    type="button"
                    onclick={() => (aiSubTab = 'history')}
                  >History{#if ai.history.length} · {ai.history.length}{/if}</button>
                </div>
              </div>

              {#if aiSubTab === 'prompt'}
                <textarea
                  class="ai-prompt"
                  placeholder="e.g. add an internal torque shoulder at z = cone_length with width 0.25, and a 1/8 chamfer at the box top"
                  value={ai.prompt}
                  oninput={(e) => { ensureAi(activeTab!).prompt = (e.currentTarget as HTMLTextAreaElement).value; }}
                  disabled={ai.status === 'sending'}
                  rows="3"
                ></textarea>
                <div class="ai-actions">
                  <button
                    class="ai-submit"
                    type="button"
                    disabled={ai.status === 'sending' || ai.status === 'pending' || ai.prompt.trim().length === 0}
                    onclick={() => submitAiRefine(activeTab!)}
                  >
                    {#if ai.status === 'sending'}Thinking…{:else}✦ Refine source{/if}
                  </button>
                  {#if ai.status === 'sending'}
                    <span class="ai-status muted">Claude is editing the source…</span>
                  {:else if ai.status === 'error'}
                    <span class="ai-status err">Error: {ai.error}</span>
                  {:else if ai.status === 'pending'}
                    <span class="ai-status ok">Proposal ready — review below.</span>
                  {/if}
                </div>

                {#if ai.status === 'pending' && ai.pending}
                  <div class="ai-proposal">
                    <div class="ai-proposal-h">
                      <span>✦ Proposed source</span>
                      <span class="muted">{(ai.pending.match(/\n/g)?.length ?? 0) + 1} lines</span>
                    </div>
                    <pre class="ai-proposal-body">{ai.pending}</pre>
                    <div class="ai-proposal-actions">
                      <button class="ai-accept" type="button" onclick={() => acceptAiProposal(activeTab!)}>
                        Accept · open in Svelte tab
                      </button>
                      <button class="ai-reject" type="button" onclick={() => rejectAiProposal(activeTab!)}>
                        Reject
                      </button>
                    </div>
                  </div>
                {/if}
              {:else}
                <!-- History sub-tab — persisted across reloads. Click a row
                     to load that prompt back into the input. -->
                {#if ai.history.length > 0}
                  <div class="ai-history full">
                    {#each [...ai.history].reverse() as h, i (i)}
                      <div class="ai-history-row" class:accepted={h.accepted === true} class:rejected={h.accepted === false}>
                        <span class="ai-history-mark">{h.accepted === true ? '✓' : h.accepted === false ? '✗' : '·'}</span>
                        <button
                          class="ai-history-prompt"
                          type="button"
                          title="Load this prompt back into the input"
                          onclick={() => reuseHistoryPrompt(h)}
                        >{h.prompt}</button>
                        <span class="ai-history-ts">{formatHistoryTs(h.ts)}</span>
                      </div>
                    {/each}
                  </div>
                {:else}
                  <div class="ai-instructions-empty">
                    No refines yet for this component — switch to <strong>Prompt</strong>
                    and ask Claude for a change.
                  </div>
                {/if}
              {/if}
            </div>

            <!-- ─── Section 2: Instructions (slow-evolving spec) ────────────
                 Per-primitive markdown doc — the persistent "what should
                 this primitive be" context. Sent alongside every prompt so
                 Claude produces predictable / consistent output. Saved to
                 the component's <id>.md. Preview renders the markdown;
                 Edit exposes the raw textarea. (The old auto-generated
                 "MD" inspector tab was removed — the instructions ARE
                 the markdown doc now.) -->
            <div class="ai-sec">
              <div class="ai-sec-h">
                <span class="ai-sec-title">📋 Instructions <span class="muted">{activeTab.componentEntry.meta.id}.md</span></span>
                <div class="inst-view-toggle">
                  <button
                    class="inst-view-btn"
                    class:active={instructionsView === 'preview'}
                    type="button"
                    onclick={() => (instructionsView = 'preview')}
                  >Preview</button>
                  <button
                    class="inst-view-btn"
                    class:active={instructionsView === 'edit'}
                    type="button"
                    onclick={() => (instructionsView = 'edit')}
                  >Edit</button>
                </div>
              </div>
              {#if instructionsView === 'preview'}
                {#if instCurrent.trim()}
                  <div class="ai-instructions-preview">
                    <MarkdownView value={instCurrent} />
                  </div>
                {:else}
                  <div class="ai-instructions-empty">
                    No instructions yet — click <strong>Edit</strong> to write the
                    persistent spec (sent to Claude with every refine).
                  </div>
                {/if}
              {:else}
                <textarea
                  class="ai-instructions"
                  placeholder="Describe the primitive's design intent: what real-world thing it represents, which standard it targets, conventions for params, how it should compose with others. Markdown is fine. Claude reads this on every refine to produce predictable output."
                  value={instCurrent}
                  oninput={(e) => { ensureAi(activeTab!).instructionsDraft = (e.currentTarget as HTMLTextAreaElement).value; }}
                  rows="10"
                ></textarea>
              {/if}
              <div class="ai-actions">
                <button
                  class="ai-save-inst"
                  type="button"
                  disabled={!instDirty || ai.instructionsStatus === 'saving'}
                  onclick={() => saveInstructions(activeTab!)}
                >
                  {ai.instructionsStatus === 'saving' ? 'Saving…' : 'Save instructions'}
                </button>
                {#if instDirty}
                  <span class="ai-status muted">Unsaved changes — apply on next refine.</span>
                {:else if ai.instructionsStatus === 'saved'}
                  <span class="ai-status ok">Saved.</span>
                {:else if ai.instructionsStatus === 'error'}
                  <span class="ai-status err">Save failed: {ai.instructionsError}</span>
                {/if}
              </div>
            </div>
          </div>
        {/if}

        {@const srcDirty = activeTab.kind === 'xml-primitive' && activeTab.componentEntry && activeTab.sourceDraft != null && activeTab.sourceDraft !== activeTab.componentEntry.source}
        {@const pDirty = activeTab.kind === 'xml-primitive' && paramsDirty(activeTab)}
        {#if srcDirty || pDirty}
          <!-- Global save bar — visible on EVERY inspector tab the moment
               sourceDraft diverges from disk OR any slider has been
               moved away from its schema default. Deleting a part,
               adding a part, toggling skip-Z, editing a description,
               renaming a param, AND dragging sliders all surface this
               affordance without forcing a tab switch. -->
          <div class="save-row global-save">
            <button class="save-btn" type="button" disabled={activeTab.saveStatus === 'saving'} onclick={() => saveRunesSource(activeTab!)}>
              {activeTab.saveStatus === 'saving' ? 'Saving…' : 'Save to disk'}
            </button>
            <button class="discard-btn" type="button" onclick={() => discardRunesDraft(activeTab!)}>Discard</button>
            {#if activeTab.saveStatus === 'saved'}
              <span class="save-status ok">Saved · HMR will reload</span>
            {:else if activeTab.saveStatus === 'error'}
              <span class="save-status err">Error: {activeTab.saveError}</span>
            {:else}
              <span class="save-status muted">
                {pDirty && srcDirty ? 'Unsaved changes (source + params)' : pDirty ? 'Unsaved param defaults' : 'Unsaved changes'}
              </span>
            {/if}
          </div>
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
    background: #fcfcfd;
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
  /* Operator pane — list of CAD operations. Each item shows a glyph,
     the operator name, and a short description. Disabled when no
     single-file component is active (can't splice into nothing). */
  .sb-operator {
    flex: 1; min-height: 0;
    overflow-y: auto;
    padding: 8px;
    background: #fafafa;
    display: flex; flex-direction: column; gap: 6px;
  }
  .sb-op-intro {
    font: 11px Arial; color: #666;
    margin: 0 0 4px;
    line-height: 1.4;
  }
  .sb-op-item {
    display: grid;
    grid-template-columns: 24px 1fr;
    grid-template-rows: auto auto;
    align-items: center;
    gap: 2px 6px;
    padding: 8px 10px;
    background: #fff;
    border: 1px solid #e2e2e8;
    border-radius: 4px;
    cursor: pointer;
    text-align: left;
    transition: border-color 100ms, background 100ms;
  }
  .sb-op-item:hover { border-color: #cc2222; background: #fdf5f5; }
  .sb-op-item:disabled { opacity: 0.5; cursor: not-allowed; background: #f2f2f5; }
  .sb-op-glyph {
    grid-row: 1 / 3;
    font-size: 18px; line-height: 1;
    color: #cc2222;
    text-align: center;
  }
  .sb-op-name { font: 600 12px Arial; color: #222; }
  .sb-op-desc { font: 10px Arial; color: #888; line-height: 1.3; }

  /* Test tab — link scratchpad. Same visual rhythm as the Parts/Basic
     lists; only chrome difference is the URL paste row pinned at top. */
  .sb-test {
    flex: 1; min-height: 0;
    overflow-y: auto;
    padding: 8px;
    background: #fcfcfd;
    display: flex; flex-direction: column; gap: 6px;
  }
  .sb-test-add {
    display: flex; gap: 4px;
    padding-bottom: 4px;
    border-bottom: 1px solid #ececec;
  }
  .sb-test-input {
    flex: 1; min-width: 0;
    padding: 5px 7px;
    font: 11px Arial; color: #222;
    background: #fff;
    border: 1px solid #d0d0d8;
    border-radius: 3px;
  }
  .sb-test-input:focus { outline: none; border-color: #cc2222; }
  .sb-test-add-btn {
    padding: 5px 10px;
    font: 600 10px Arial; color: #fff;
    background: #cc2222;
    border: none; border-radius: 3px;
    cursor: pointer;
  }
  .sb-test-add-btn:hover:not(:disabled) { background: #a91d1d; }
  .sb-test-add-btn:disabled { background: #d99595; cursor: not-allowed; }
  .sb-test-err {
    font: 10px Arial; color: #cc2222;
    padding: 2px 4px;
  }
  .sb-test-sec { display: flex; flex-direction: column; gap: 4px; padding-bottom: 8px; }
  .sb-test-sec + .sb-test-sec { border-top: 1px solid #ececec; padding-top: 8px; }
  .sb-test-sec-h { display: flex; justify-content: space-between; align-items: center; }
  .sb-test-sec-title {
    font: 700 9px Arial; color: #888;
    text-transform: uppercase; letter-spacing: 1px;
  }
  .sb-test-sec-meta { font: 9px Arial; color: #aaa; padding: 0 2px; }
  /* Figure gallery — numbered thumbnail grid. Two columns; each cell is
     a thumbnail + its global number badge + a pdf·page caption. */
  .sb-fig-grid {
    display: grid; grid-template-columns: 1fr 1fr; gap: 6px;
    padding: 2px;
  }
  .sb-fig-cell {
    position: relative;
    background: #fff; border: 1px solid #dcdce2; border-radius: 4px;
    overflow: hidden;
  }
  .sb-fig-cell:hover { border-color: #9aa; box-shadow: 0 1px 4px rgba(0,0,0,0.1); }
  .sb-fig-cell.active { border-color: #4a72c4; box-shadow: 0 0 0 1px #4a72c4; }
  .sb-fig-open {
    position: relative; display: flex; flex-direction: column;
    gap: 2px; padding: 0; cursor: pointer; width: 100%;
    background: none; border: none; text-align: left;
  }
  /* Delete chip — top-right corner, appears on cell hover. */
  .sb-fig-del {
    position: absolute; top: 3px; right: 3px; z-index: 2;
    width: 18px; height: 18px; padding: 0; line-height: 1;
    font: 700 10px Arial; color: #fff; cursor: pointer;
    background: rgba(20,20,28,0.78); border: none; border-radius: 3px;
    opacity: 0; transition: opacity 0.1s;
  }
  .sb-fig-cell:hover .sb-fig-del { opacity: 1; }
  .sb-fig-del:hover { background: #c4392f; }
  .sb-fig-del:disabled { cursor: default; background: rgba(20,20,28,0.5); }
  .sb-fig-cell.deleting { opacity: 0.5; pointer-events: none; }
  .sb-fig-thumb {
    width: 100%; height: 88px; object-fit: cover; object-position: top;
    display: block; background: #f4f4f6;
  }
  .sb-fig-n {
    position: absolute; top: 3px; left: 3px;
    font: 700 10px Arial; color: #fff;
    background: rgba(20,20,28,0.78); border-radius: 3px;
    padding: 1px 5px; pointer-events: none;
  }
  .sb-fig-cap {
    font: 9px Arial; color: #777; padding: 2px 4px 3px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  /* Source-tab image viewer — used for figure page renders. */
  .source-img-wrap {
    flex: 1; min-height: 0; overflow: auto;
    background: #525659; display: flex; align-items: flex-start;
    justify-content: center; padding: 16px;
  }
  .source-img { max-width: 100%; height: auto; display: block; box-shadow: 0 2px 12px rgba(0,0,0,0.4); }
  .sb-test-refresh {
    font: 600 10px Arial; color: #666;
    background: #f0f0f0; border: 1px solid #d0d0d8; border-radius: 3px;
    padding: 2px 7px; cursor: pointer;
  }
  .sb-test-refresh:hover { background: #e6e6e8; color: #222; }
  .dot.verdict-match { background: #16a34a; }
  .dot.verdict-error { background: #cc2222; }
  .dot.verdict-incomplete { background: #d4d4d4; }
  .verdict-match-chip { color: #16a34a; font-weight: 700; }
  .verdict-error-chip { color: #cc2222; font-weight: 700; }
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
    color: #333;
    cursor: pointer;
    /* Content-driven height: a touch of padding around the rotated
       label + count, no fixed min-height. Each wedge ends up as tall
       as its label needs. */
    padding: 9px 2px;
    width: 100%;
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
    font: bold 9px Arial; letter-spacing: 0.8px; text-transform: uppercase;
    white-space: nowrap;
  }
  .sb-tab.compound .sb-tab-name { font-style: italic; }
  .sb-tab-count {
    writing-mode: vertical-rl; transform: rotate(180deg);
    font: bold 9px monospace; color: #555;
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
    display: flex; align-items: center; gap: 4px;
  }
  .sb-filter input {
    flex: 1; min-width: 0;
    padding: 5px 22px 5px 8px;
    border: 1px solid #d8d8de; border-radius: 4px;
    background: #fff; color: #333;
    font: 11px Arial;
    box-sizing: border-box;
  }
  .sb-filter input:focus { outline: none; border-color: #cc2222; }
  .sb-filter-x {
    position: absolute; top: 50%; right: 32px;
    transform: translateY(-50%);
    background: transparent; border: none; cursor: pointer;
    color: #999; font: bold 14px Arial; line-height: 1;
    padding: 0 2px;
  }
  /* When the family filter button isn't there (any tab other than
     Parts) the X sits at the input's right edge as it always did. */
  .sb-filter:not(:has(.family-filter-icon)) .sb-filter-x { right: 4px; }
  .sb-filter-x:hover { color: #cc2222; }
  .sb-empty {
    font: 10px Arial; color: #999;
    padding: 8px 6px;
    text-align: center;
  }
  .sb-list { display: flex; flex-direction: column; gap: 1px; }
  .sb-subhead {
    font: bold 10px Arial; color: #333;
    text-transform: uppercase; letter-spacing: 0.5px;
    margin: 6px 0 2px; padding: 0 4px;
  }
  /* Clickable family-group header — same look as .sb-subhead but with
     a chevron + cursor that signals collapsibility. */
  .sb-subhead.clickable {
    cursor: pointer;
    background: transparent; border: none; width: 100%;
    text-align: left;
    display: flex; align-items: center; gap: 6px;
  }
  .sb-subhead.clickable:hover { color: #cc2222; }
  .sb-subhead .sb-chevron {
    display: inline-block; width: 8px; font: 8px Arial;
    color: #999; transition: transform 100ms;
  }
  .sb-subhead.collapsed .sb-chevron { transform: rotate(-90deg); }
  /* Sub-tabs inside a rail tab (e.g. KB → Sources | DB). Sits at the
     top of the tab body, below the filter input. */
  .sb-subtabs {
    display: flex; gap: 4px;
    margin: 2px 0 6px;
    border-bottom: 1px solid #e5e5e5;
  }
  .sb-subtab {
    flex: 1; cursor: pointer;
    background: transparent; border: none; border-bottom: 2px solid transparent;
    color: #666; font: 10px Arial; letter-spacing: 0.4px;
    text-transform: uppercase;
    padding: 5px 8px;
    display: inline-flex; align-items: center; justify-content: center; gap: 4px;
  }
  .sb-subtab:hover { color: #333; }
  .sb-subtab.active {
    color: #cc2222; border-bottom-color: #cc2222; font-weight: 600;
  }
  .sb-subtab-count {
    display: inline-block; background: #eee; color: #555;
    border-radius: 8px; padding: 0 6px; font: 9px monospace;
  }
  .sb-subtab.active .sb-subtab-count { background: #cc2222; color: #fff; }
  .sb-add {
    background: #fff; border: 1px dashed #cc2222; cursor: pointer;
    color: #cc2222;
    font: bold 9px Arial; letter-spacing: 0.5px; text-transform: uppercase;
    padding: 4px 8px; border-radius: 4px;
    margin: 0 0 6px;
    text-align: center;
  }
  .sb-add:hover { background: #cc2222; color: #fff; }

  /* Family filter — small icon button in the .sb-filter row.
     FloatingPanel popup pattern borrowed from SVTC's ScaleSpreadPopover. */
  .family-filter-icon {
    display: inline-flex; align-items: center; justify-content: center;
    position: relative;
    width: 24px; height: 22px;
    margin-left: 2px;
    border: 1px solid #d1d5db; border-radius: 4px;
    background: #fff; color: #555;
    cursor: pointer; flex-shrink: 0;
    transition: background 80ms, color 80ms, border-color 80ms;
  }
  .family-filter-icon:hover { background: #f3f4f6; color: #cc2222; border-color: #cc2222; }
  .family-filter-icon.open { background: #cc2222; color: #fff; border-color: #cc2222; }

  /* Floating-panel body — top action bar + 2-column scrollable grid
     of family cards. Cap height at 60vh; vertical scroll inside the
     panel when the cards overflow. */
  .ff-body {
    display: flex; flex-direction: column;
    max-height: 60vh; min-height: 0;
    font: 11px ui-sans-serif, system-ui, sans-serif;
    color: #0f172a;
  }
  .ff-head {
    display: flex; align-items: center; gap: 6px;
    padding: 8px 12px;
    border-bottom: 1px solid #e2e8f0;
    background: #fff;
    flex-shrink: 0;
  }
  .ff-grid {
    display: grid; grid-template-columns: 1fr 1fr; gap: 6px;
    padding: 10px 12px;
    overflow-y: auto;
    min-height: 0;
  }
  .ff-section {
    display: flex; flex-direction: column; gap: 4px;
    padding: 7px 9px;
    background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px;
    cursor: pointer;
    transition: background 0.1s, border-color 0.1s;
    min-width: 0;
  }
  .ff-section:hover { border-color: #cbd5e1; }
  .ff-section.enabled {
    background: #fff;
    border-color: #cc2222;
    box-shadow: 0 0 0 1px rgba(204,34,34,0.08);
  }
  .ff-section-head {
    display: flex; align-items: center; gap: 6px;
  }
  .ff-section-title {
    flex: 1; min-width: 0;
    font: 600 11px ui-sans-serif, system-ui, sans-serif;
    color: #1e293b; letter-spacing: 0.01em;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .ff-section-meta {
    font: 10px ui-monospace, SFMono-Regular, Menlo, monospace;
    color: #64748b;
  }
  .ff-toggle {
    width: 13px; height: 13px;
    accent-color: #cc2222; cursor: pointer; flex-shrink: 0;
  }
  .ff-section-desc {
    font: 10px ui-sans-serif, system-ui, sans-serif;
    color: #64748b; line-height: 1.35;
  }
  .ff-btn {
    height: 24px; padding: 0 10px; border-radius: 4px;
    font: 11px ui-sans-serif, system-ui, sans-serif; line-height: 1;
    cursor: pointer;
  }
  .ff-btn-ghost {
    background: #fff; color: #475569; border: 1px solid #cbd5e1;
  }
  .ff-btn-ghost:hover { background: #f8fafc; color: #1e293b; }
  .ff-btn-primary {
    background: #cc2222; color: #fff; border: 1px solid #a01818;
    font-weight: 500; margin-left: auto;
  }
  .ff-btn-primary:hover { background: #a01818; }
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
    cursor: pointer; font: 11px Arial; color: #222;
    text-align: left;
    display: flex; align-items: center; gap: 6px;
    padding: 3px 8px;
    border-radius: 3px;
  }
  .prim-link.child { font-size: 10px; color: #444; }
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

  /* Runes-row container — wraps the prim-link + a persistent delete
     button. The × is always visible (faded), goes red on hover, and the
     server-side reference check refuses the delete when the primitive is
     used by another authored component. */
  .prim-row {
    display: flex; align-items: center; gap: 2px;
    border-radius: 3px;
  }
  .prim-row .prim-link { flex: 1; }
  .prim-del {
    flex-shrink: 0;
    width: 16px; height: 16px;
    display: inline-flex; align-items: center; justify-content: center;
    background: #fff;
    border: 1px solid #777;
    cursor: pointer;
    font: bold 12px Arial; line-height: 1; color: #444;
    border-radius: 4px;
    margin-right: 4px;
    padding: 0;
    transition: background 0.1s, color 0.1s, border-color 0.1s;
  }
  .prim-del:hover { background: #fdecec; border-color: #cc2222; color: #cc2222; }
  /* SVG size scales with row state: idle row shows a smaller icon
     (less visual weight in a long list), the active row gets the
     full-sized icon. */
  .prim-del svg { width: 11px; height: 11px; transition: width 80ms, height 80ms; }
  .prim-del:hover svg { width: 13px; height: 13px; }
  .prim-row.active .prim-del { background: rgba(255,255,255,0.9); border-color: rgba(255,255,255,0.95); color: #cc2222; }
  .prim-row.active .prim-del svg { width: 13px; height: 13px; }
  .prim-row.active .prim-del:hover { background: #fff; border-color: #fff; color: #a01818; }

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
  /* Stack: source label on top, KB title sub-line beneath. Used by the
     Sources tab so the user knows which KB(s) a raw document feeds. */
  .pl-stack { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .pl-stack .pl-name { flex: none; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pl-sub { font: 9px Arial; color: #666; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .prim-link.active .pl-sub,
  .prim-link:hover .pl-sub { color: #ccc; }
  .prim-link.source-link { text-decoration: none; }
  .prim-link.source-link.active { background: #cc2222; color: #fff; }
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

  /* Source tab — header strip with label + kind badge + "Open externally"
     link, then a full-height iframe for the document body. The iframe
     fills the rest of the tab body via flex:1. */
  .tab-body.source-tab {
    grid-template-columns: 1fr;
    display: flex; flex-direction: column;
    min-height: 0;
  }
  .source-hdr {
    display: flex; align-items: center; gap: 10px;
    padding: 8px 14px;
    background: #f8fafc; border-bottom: 1px solid #e2e8f0;
    font: 12px ui-sans-serif, system-ui, sans-serif;
    color: #1e293b;
    flex-shrink: 0;
  }
  .source-hdr-label { font-weight: 600; }
  .source-hdr-kind {
    background: #e2e8f0; color: #475569;
    font: 10px ui-monospace, SFMono-Regular, Menlo, monospace;
    padding: 2px 7px; border-radius: 10px;
    text-transform: lowercase; letter-spacing: 0.02em;
  }
  .source-hdr-ext {
    margin-left: auto;
    color: #cc2222; font-weight: 500; text-decoration: none;
  }
  .source-hdr-ext:hover { text-decoration: underline; }
  .source-iframe {
    flex: 1 1 auto;
    width: 100%; min-height: 0;
    border: 0; background: #fff;
  }
  .source-empty {
    flex: 1 1 auto;
    display: flex; align-items: center; justify-content: center;
    color: #64748b; font: 12px ui-sans-serif, system-ui, sans-serif;
  }
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
  /* Z-scale slider — tucked into the badges row. Inline so it doesn't
     consume another row of vertical real estate above the 3D stage. */
  .z-scale {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 2px 8px;
    background: #f5f3fb;
    border: 1px solid #d8d4e8;
    border-radius: 12px;
    font: 10px Arial; color: #555;
  }
  .z-scale-lbl { font-weight: 600; color: #7c4dff; }
  .z-scale input[type="range"] { width: 80px; height: 14px; accent-color: #7c4dff; }
  .z-scale-val { font: 10px ui-monospace, monospace; color: #444; min-width: 28px; text-align: right; }
  .stage-title { position: relative; display: flex; align-items: baseline; gap: 6px; }
  .stage-name { margin: 0; font-size: 20px; color: #cc2222; }
  .stage-id { font: 10px monospace; color: #888; }
  .stage-badges { display: flex; flex-wrap: wrap; gap: 4px; max-width: 280px; justify-content: flex-end; }
  .stage-desc { font: 12px Arial; color: #555; line-height: 1.5; margin: 8px 0 16px; max-width: 720px; }
  /* Info icon next to the title — opens a small popover with the
     primitive's description. Replaces the always-visible <p.stage-desc>;
     the description is now off-screen by default to keep the page top
     focused on the rendered shape. */
  .stage-info-btn {
    display: inline-flex; align-items: center; justify-content: center;
    width: 18px; height: 18px;
    border: 1px solid #d8d4e8;
    border-radius: 50%;
    background: #fff;
    color: #7c4dff;
    font: 600 11px/1 'Times New Roman', serif;
    font-style: italic;
    cursor: pointer;
    transition: background 100ms, color 100ms, transform 100ms;
    align-self: center;
    padding: 0;
  }
  .stage-info-btn:hover { background: #7c4dff; color: #fff; }
  .stage-info-btn.active { background: #7c4dff; color: #fff; transform: scale(1.05); }
  .stage-info-pop {
    position: absolute;
    top: calc(100% + 8px);
    left: 0;
    z-index: 50;
    min-width: 280px;
    max-width: 420px;
    background: #fff;
    border: 1px solid #d8d4e8;
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(60, 40, 120, 0.15);
    padding: 10px 14px 12px;
  }
  .stage-info-pop::before {
    content: '';
    position: absolute;
    top: -6px; left: 14px;
    width: 10px; height: 10px;
    background: #fff;
    border-left: 1px solid #d8d4e8;
    border-top: 1px solid #d8d4e8;
    transform: rotate(45deg);
  }
  .stage-info-desc { font: 13px Arial; color: #333; line-height: 1.5; margin: 0 24px 6px 0; }
  .stage-info-more { font: 11px Arial; color: #777; margin: 6px 24px 0 0; }
  .stage-info-close {
    position: absolute; top: 4px; right: 6px;
    width: 18px; height: 18px;
    border: none; background: transparent;
    color: #888; font: 16px/1 Arial; cursor: pointer;
    padding: 0; line-height: 18px;
  }
  .stage-info-close:hover { color: #cc2222; }
  /* Stage sub-tabs: Render | Picture. Slim strip directly under the
     header. Visual rhythm matches the KB sub-tabs inside the rail. */
  .stage-subtabs {
    display: flex; gap: 4px;
    border-bottom: 1px solid #e2e2e8;
    margin-bottom: 6px;
  }
  .stage-subtab {
    padding: 4px 14px;
    font: 600 10px Arial; color: #888;
    text-transform: uppercase; letter-spacing: 0.8px;
    background: transparent;
    border: none; border-bottom: 2px solid transparent;
    cursor: pointer;
    transition: color 100ms, border-color 100ms;
  }
  .stage-subtab:hover { color: #333; }
  .stage-subtab.active { color: #cc2222; border-bottom-color: #cc2222; }

  .stage-picture {
    flex: 1; min-height: 0;
    display: flex; align-items: center; justify-content: center;
    background: #fafafa;
    border: 1px solid #ececec;
    border-radius: 4px;
    overflow: hidden;
    position: relative;
  }
  .stage-picture-img { max-width: 100%; max-height: 100%; object-fit: contain; }
  .stage-picture-img.hidden { display: none; }
  .stage-picture-empty {
    display: flex; flex-direction: column; align-items: center; gap: 8px;
    padding: 24px; max-width: 480px; text-align: center;
    color: #555;
  }
  .stage-picture-empty-title { font: 13px Arial; margin: 0; color: #222; }
  .stage-picture-empty-title code { font: 12px monospace; background: #f0f0f0; padding: 1px 5px; border-radius: 3px; }
  .stage-picture-empty-hint { font: 11px Arial; margin: 0; line-height: 1.5; }
  .stage-picture-hint { font: 10px Arial; margin: 0; color: #888; }
  .stage-picture-hint code { font: 10px monospace; background: #f0f0f0; padding: 1px 4px; border-radius: 3px; }
  .stage-picture-upload {
    display: inline-block;
    padding: 6px 14px;
    font: 600 11px Arial; color: #fff;
    background: #cc2222;
    border-radius: 4px;
    cursor: pointer;
  }
  .stage-picture-upload:hover { background: #a91d1d; }
  .stage-picture-upload.disabled { background: #d99595; cursor: not-allowed; }
  .stage-picture-upload input { display: none; }
  .stage-picture-err { font: 10px Arial; color: #cc2222; margin: 0; }

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
  /* Figure-draft empty-state — shown on the Render tab when a component
     has a picture but no geometry yet. */
  .stage-blank {
    position: absolute; inset: 0;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 8px; padding: 32px; text-align: center;
    background: repeating-linear-gradient(45deg, #fafafa, #fafafa 10px, #f4f4f6 10px, #f4f4f6 20px);
  }
  .stage-blank-icon { font-size: 40px; color: #c4c4cc; line-height: 1; }
  .stage-blank-title {
    font: 700 12px Arial; color: #777; margin: 0;
    text-transform: uppercase; letter-spacing: 1px;
  }
  .stage-blank-hint { font: 11px Arial; color: #888; margin: 0; line-height: 1.6; max-width: 380px; }
  .stage-blank-hint code { font: 11px monospace; background: #ececf0; padding: 1px 5px; border-radius: 3px; color: #555; }
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
  /* Mesh / GLB toggle pill — pinned to the top-left of the 3D stage.
     Two segments share a single rounded container; active segment has
     the project red. */
  .stage-view-toggle {
    position: absolute; top: 8px; left: 8px;
    z-index: 5;
    display: inline-flex;
    background: rgba(0, 0, 0, 0.55);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 4px;
    overflow: hidden;
    user-select: none;
  }
  .stage-view-btn {
    background: transparent; color: #ddd;
    border: none;
    padding: 4px 10px;
    font: 10px Arial; letter-spacing: 0.4px; text-transform: uppercase;
    cursor: pointer;
    transition: background 80ms, color 80ms;
  }
  .stage-view-btn:hover { background: rgba(255, 255, 255, 0.08); color: #fff; }
  .stage-view-btn.active { background: #cc2222; color: #fff; }
  /* GLB stage corner chip — mirrors .stage-stale chrome, neutral grey
     palette since it's informational (the URL the GLB was served from)
     rather than a warning. */
  .stage-glb-hint {
    position: absolute; bottom: 8px; left: 8px;
    background: #f3f3f7; color: #555;
    border: 1px solid #e2e2e8; border-radius: 4px;
    padding: 3px 8px;
    font: 10px Arial; line-height: 1.3;
    z-index: 5;
    pointer-events: auto;
  }
  .stage-glb-hint code { font: 10px ui-monospace, monospace; color: #333; }
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
  /* Move form — inline under a Test-tab "in progress" row. Reuses the
     .pf-* shell, tinted neutral (a promote action, not destructive). */
  .post-form {
    margin: 2px 0 8px 18px;
    padding: 8px 10px;
    background: #f4f6f8;
    border: 1px solid #d4dde4;
    border-radius: 4px;
  }
  /* Move button on a Test-tab row — sits left of the delete button. */
  .prim-post {
    flex-shrink: 0;
    font: 600 10px Arial;
    padding: 2px 8px;
    border: 1px solid #3b6e9c;
    background: #3b6e9c; color: #fff;
    border-radius: 3px; cursor: pointer;
  }
  .prim-post:hover { background: #2f5a82; border-color: #2f5a82; }
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
  /* Description-editor popup — one row per param: key chip + text input.
     Shares the .param-form shell so styling stays consistent. */
  .pf-h { font: 11px Arial; color: #444; margin-bottom: 6px; font-weight: 600; }
  .pf-h .muted { color: #999; font-weight: 400; }
  .pf-desc-row {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
  }
  .pf-desc-input { width: 100%; min-width: 0; }

  /* Auto-flowing grid of param cards in the Inspector → Params tab. Each
     card has label · slider · number on a single row. We aim for 3 columns
     at a comfortable inspector width, but if the panel narrows below
     ~3 × min-card the rows wrap to fewer columns instead of squishing the
     slider/value into unreadable widths. */
  /* 4-column grid at typical inspector widths; auto-fit drops to fewer
     columns when the panel narrows. min-card width keeps a usable
     drag-input + label-row footprint. */
  .pr-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
    gap: 6px;
    padding: 4px 0 2px;
  }
  /* Card stacks vertically: header row (label · unit · buttons) on top,
     value control (drag-number / choice select / derived readout)
     below at full card width. */
  .pr-card {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 3px 5px;
    background: #fafafa;
    border: 1px solid #eaeaef;
    border-radius: 3px;
    min-width: 0;
  }
  .pr-card-head {
    display: flex; align-items: center; gap: 4px;
    min-width: 0;
  }
  .pr-card-head .pr-keyname {
    flex: 1; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .pr-unit-inline {
    font: 10px Arial; color: #888;
    flex-shrink: 0;
  }
  .ed-sec.compact { gap: 0; margin-bottom: 6px; }
  .ed-sec-h.thin { font-size: 11px; padding: 2px 0; gap: 6px; align-items: center; }
  .ed-sec.compact .pr-grid { gap: 3px 6px; padding: 2px 0 0; }
  /* Per-row ✎ edit button — matches the × visually (same size + border
     pattern) so the two affordances read as a pair. */
  .row-edit {
    width: 18px; height: 18px;
    display: inline-flex; align-items: center; justify-content: center;
    background: #fff;
    border: 1px solid #d8d4e8;
    border-radius: 4px;
    color: #7c4dff;
    font: 11px/1 Arial;
    cursor: pointer;
    padding: 0;
    transition: background 0.1s, color 0.1s, border-color 0.1s;
  }
  .row-edit:hover { background: #f1edfa; color: #5a30e0; border-color: #7c4dff; }
  /* skip-Z-center toggle — lives in the Params header next to `+`.
     Small checkbox + caption, no chrome. */
  .meta-flag {
    display: inline-flex; align-items: center; gap: 4px;
    font: 10px Arial; color: #555;
    cursor: pointer;
    user-select: none;
    margin-right: 8px;
  }
  .meta-flag input[type="checkbox"] {
    width: 12px; height: 12px;
    accent-color: #7c4dff;
    margin: 0;
  }
  /* Per-param edit popover — appears below the card whose ✎ was
     clicked. Spans the full grid row so it doesn't get squeezed by
     the cards next to it; sits as a separate grid item via display:
     contents-style positioning. */
  .pr-edit-pop {
    grid-column: 1 / -1;
    background: #fdf6f6;
    border: 1px solid #f0c8c8;
    border-radius: 4px;
    padding: 8px 10px;
    margin-bottom: 4px;
  }
  .pr-edit-h { font: 11px Arial; color: #444; margin-bottom: 6px; font-weight: 600; }
  .pr-edit-h code { font: 11px ui-monospace, monospace; background: #fff; padding: 1px 5px; border-radius: 3px; border: 1px solid #e8d8d8; color: #7c4dff; }
  .pr-edit-lbl { display: flex; flex-direction: column; gap: 3px; font: 10px Arial; color: #666; }
  .pr-edit-lbl .pf-in { width: 100%; min-width: 0; }
  .pr-edit-name { font-family: ui-monospace, SFMono-Regular, Menlo, monospace !important; color: #7c4dff; }
  /* 2-column grid for the param edit popup — keeps Variable / Label /
     Default / Unit / Min / Max / Step compact. Description spans
     full width on its own row. */
  .pr-edit-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 6px 8px;
    margin-bottom: 6px;
  }
  .pr-edit-desc-row { margin-bottom: 6px; }
  .pr-edit-warn {
    font: 11px Arial; color: #a85b00; margin: 0 0 6px;
    background: #fff7e8; border: 1px solid #f0d8a8; border-radius: 3px;
    padding: 4px 8px; line-height: 1.4;
  }
  .pr-edit-warn code { font: 11px ui-monospace, monospace; background: #fff; padding: 1px 4px; border-radius: 3px; border: 1px solid #f0d8a8; color: #7c4dff; }
  /* Body of the per-param Edit FloatingPanel — same padding rhythm as
     the family-filter ff-body. The grid + warn rows above carry their
     own spacing; we just give the popup some breathing room. */
  .pe-body { padding: 8px 10px 10px; display: flex; flex-direction: column; gap: 6px; }

  /* Instance-prop value cell: input/chip + inline ƒ button. The ƒ
     opens the formula editor; tight gap keeps the cell compact. */
  .pr-val { display: flex; align-items: stretch; gap: 3px; min-width: 0; }
  .pr-val > .pr-num,
  .pr-val > .pi-paramref,
  .pr-val > .pi-raw { flex: 1; min-width: 0; }
  .pr-fx {
    flex-shrink: 0;
    width: 18px;
    background: #fafafa;
    border: 1px solid #eaeaef;
    border-radius: 3px;
    color: #7c4dff;
    cursor: pointer;
    font: italic bold 11px 'Times New Roman', serif;
    padding: 0;
    line-height: 1;
  }
  .pr-fx:hover { background: #f0eafe; border-color: #7c4dff; }
  .pr-fx.active { background: #f0eafe; border-color: #7c4dff; color: #7c4dff; }
  /* Compact "fx" badge — replaces the inline raw expression text. The
     full formula is on the title attr (hover tooltip). Stays narrow
     so the cell remains tidy regardless of expression length. */
  .pi-fx-badge {
    flex: 1; min-width: 0;
    display: inline-flex; align-items: center; justify-content: center;
    font: italic 11px 'Times New Roman', serif;
    color: #7c4dff;
    background: #f5f0ff;
    border: 1px solid #d8c8f0;
    border-radius: 3px;
    padding: 0 6px;
    cursor: help;
  }
  .pi-fx-badge.muted { color: #aaa; background: #fafafa; border-color: #e2e2e8; font-style: normal; }

  /* Formula popup — small body with a single-line input + a filtered
     candidate list below. */
  .fx-body { padding: 6px 8px 8px; display: flex; flex-direction: column; gap: 6px; }
  .fx-input {
    width: 100%; box-sizing: border-box;
    font: 11px ui-monospace, SFMono-Regular, Menlo, monospace;
    padding: 4px 6px;
    border: 1px solid #d8d8de;
    border-radius: 3px;
  }
  .fx-input:focus { outline: none; border-color: #7c4dff; }
  .fx-list {
    list-style: none; margin: 0; padding: 0;
    max-height: 200px; overflow-y: auto;
    border: 1px solid #eaeaef; border-radius: 3px;
    background: #fff;
  }
  .fx-cand {
    width: 100%; text-align: left;
    background: transparent; border: 0;
    padding: 3px 8px;
    font: 11px ui-monospace, monospace; color: #444;
    cursor: pointer;
  }
  .fx-cand:hover { background: #f3f0fc; color: #7c4dff; }
  .fx-resolved { color: #888; font-style: italic; }
  /* Variable-name chip — monospace, muted background, lets the user see
     the identifier they'll type in the geom body. */
  .pr-keyname {
    font: 10px ui-monospace, SFMono-Regular, Menlo, monospace;
    color: #7c4dff;
    background: #f1edfa;
    padding: 1px 5px;
    border-radius: 3px;
    border: 1px solid #e2dcf2;
    user-select: all;
  }
  .pr-lbl {
    font: 10px Arial; color: #555;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  /* Custom hover tooltips for [data-tip] — replaces the native
     `title=` popup so the description appears instantly (no 1s delay)
     and is readable (multi-line wrap, dark pill instead of pale OS
     tooltip). Applied to .pr-keyname + .pr-lbl. */
  [data-tip] {
    position: relative;
  }
  [data-tip]:hover::after {
    content: attr(data-tip);
    position: absolute;
    bottom: calc(100% + 6px);
    left: 0;
    z-index: 200;
    background: #1f1f24;
    color: #fff;
    padding: 6px 10px;
    border-radius: 4px;
    font: 11px/1.45 Arial;
    max-width: 300px;
    width: max-content;
    white-space: pre-line;
    box-shadow: 0 4px 12px rgba(0,0,0,0.18);
    pointer-events: none;
  }
  [data-tip]:hover::before {
    content: '';
    position: absolute;
    bottom: 100%;
    left: 10px;
    z-index: 201;
    width: 0; height: 0;
    border: 4px solid transparent;
    border-top-color: #1f1f24;
    pointer-events: none;
  }
  .pr-card.extra .pr-lbl { color: #1a5b8a; font-style: italic; }

  /* Param-group accordion headers inside the Params section. One header
     per `group` value declared in the primitive's meta.params (e.g.
     box_conn → Body / Cone). Click toggles the group's grid open/closed. */
  .pg-acc-head {
    display: flex; align-items: center; gap: 5px; width: 100%;
    background: #f3f3f7;
    border: 1px solid #e2e2e8;
    border-radius: 3px;
    cursor: pointer;
    font: 11px Arial; color: #555;
    padding: 2px 6px;
    margin: 2px 0 1px;
    text-align: left;
    min-height: 22px;
  }
  .pg-acc-head:first-of-type { margin-top: 0; }
  /* For instance rows the title is `A` and sig is `:tube`. Render them
     tight together (no gap) so the colon reads as one token. */
  .pg-acc-head .pg-acc-title + .pg-acc-sig { margin-left: -5px; }
  .pg-acc-head:hover { background: #ececf2; color: #cc2222; }
  .pg-acc-head.collapsed { background: #fafafa; }
  .pg-acc-chev { font-size: 9px; color: #999; width: 10px; flex-shrink: 0; }
  .pg-acc-head:hover .pg-acc-chev { color: #cc2222; }
  .pg-acc-title { font-weight: bold; flex: 1; }
  .pg-acc-count {
    font: 10px Arial; color: #888;
    background: #fff;
    padding: 1px 5px;
    border-radius: 3px;
    border: 1px solid #e2e2e8;
    min-width: 16px;
    text-align: center;
  }
  .pg-acc-sig {
    font: 10px ui-monospace, monospace; color: #888;
    flex: 0 1 auto;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    max-width: 50%;
  }
  .pg-acc-x {
    width: 16px; height: 16px;
    display: inline-flex; align-items: center; justify-content: center;
    background: transparent; color: #888;
    border: 1px solid transparent;
    border-radius: 3px;
    cursor: pointer;
    font: 12px Arial; line-height: 1;
    flex-shrink: 0;
  }
  .pg-acc-x:hover { color: #cc2222; border-color: #f0c8c8; background: #fff; }
  .pg-acc-empty {
    font: 10px Arial; color: #888; font-style: italic;
    padding: 6px 8px;
    background: #fafafa;
    border: 1px dashed #e2e2e8;
    border-radius: 3px;
    margin: 2px 0 4px;
  }
  .pg-acc-empty code { font: 10px ui-monospace, monospace; color: #555; background: #fff; padding: 0 3px; border-radius: 2px; }
  /* Per-instance Props block — one per `const X = call(...); geom.add(X);`
     pair in the body. The Props grid below it reuses the existing
     stacked card layout. */
  .pi-list { display: flex; flex-direction: column; gap: 6px; margin: 2px 0 6px; }
  .pi-card {
    border: 1px solid #e8e8ee;
    border-radius: 4px;
    padding: 4px 6px 6px;
    background: #fcfcfd;
  }
  .pi-head {
    display: flex; align-items: baseline; gap: 6px;
    font: 11px Arial; color: #555;
    margin-bottom: 4px;
  }
  .pi-name {
    font: bold 11px ui-monospace, monospace; color: #cc2222;
    background: #fff; border: 1px solid #f0d5d5; border-radius: 3px;
    padding: 0 5px;
  }
  .pi-call { font: 10px ui-monospace, monospace; color: #999; }
  /* Param-ref binding — appears when a prop was edited to link to a
     primitive-level param. Visual distinct from the literal input so the
     user sees at a glance that the value is bound, not a number. */
  .pi-paramref {
    font: 11px ui-monospace, monospace; color: #1a5b8a;
    background: #eef4fa; border: 1px solid #c5d8e8; border-radius: 3px;
    padding: 2px 6px;
    text-align: center;
  }
  .pi-raw {
    font: 10px ui-monospace, monospace; color: #888;
    background: #fafafa; border: 1px dashed #ddd; border-radius: 3px;
    padding: 2px 6px;
    text-align: center;
  }
  /* Derived param — read-only computed value, no slider. Tinted to read
     as "output", not "input". The spacer keeps the value visually
     aligned with the number column of the input cards above. */
  .pr-card.derived {
    background: #f4f0fb;
    border-color: #d8cde6;
  }
  .pr-card.derived .pr-lbl { color: #5b4a8e; }
  .pr-derived-val {
    font: 11px monospace;
    color: #3b2b6a;
    text-align: right;
    padding: 3px 6px;
    border: 1px dashed #d8cde6;
    border-radius: 3px;
    background: #fbf9ff;
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
  /* Drag-to-scrub variant: bigger hit-area + ew-resize cursor so the
     drag affordance is discoverable. Slider was retired in favour of
     pointer-drag on this input — saves a row and lets the user still
     click + type the number. */
  .pr-num.drag {
    cursor: ew-resize;
    padding: 3px 6px;
    font-size: 11px;
    background: linear-gradient(180deg, #fff 0%, #fafafa 100%);
  }
  .pr-num.drag:hover { border-color: #cc2222; }
  .pr-num.drag:focus { cursor: text; background: #fff; }
  :global(body.dragnum-active) { cursor: ew-resize !important; user-select: none; }
  :global(body.dragnum-active *) { cursor: ew-resize !important; }
  .pr-choice {
    font: 10px monospace;
    padding: 1px 3px; border: 1px solid #ddd; border-radius: 3px;
    background: #fff; cursor: pointer;
    grid-column: span 2;
    width: 100%; min-width: 0;
  }
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
       • Other single-file components (each exports geom(p) → Manifold)
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

  /* ── AI Refine tab ────────────────────────────────────────────────────── */
  .ai-pane { display: flex; flex-direction: column; gap: 10px; padding: 4px 0 2px; }
  .ai-pane.two-section { gap: 14px; }
  .ai-sec { display: flex; flex-direction: column; gap: 6px; }
  .ai-sec-h {
    display: flex; align-items: baseline; gap: 8px;
    padding-bottom: 2px;
    border-bottom: 1px solid #e2dff0;
  }
  .ai-sec-title { font: bold 11px Arial; color: #3b3b8a; letter-spacing: 0.3px; }
  .ai-sec-title .muted { font-weight: normal; color: #888; font-family: ui-monospace, monospace; font-size: 10px; margin-left: 4px; }
  .ai-sec-sub { font: 10px Arial; color: #999; font-style: italic; }
  .ai-instructions {
    font: 12px ui-monospace, SFMono-Regular, monospace;
    padding: 8px 10px;
    border: 1px solid #d8d4e8; border-radius: 4px;
    background: #fdfcff; color: #22223b;
    resize: vertical;
    min-height: 120px;
  }
  .ai-instructions:focus { outline: 2px solid #3b3b8a; outline-offset: -1px; }
  .ai-save-inst {
    background: #fff; color: #3b3b8a;
    border: 1px solid #b8b4d8; border-radius: 4px;
    cursor: pointer;
    font: bold 11px Arial; padding: 5px 12px;
  }
  .ai-save-inst:hover:not(:disabled) { background: #f4f0fb; }
  .ai-save-inst:disabled { color: #b8b4c8; border-color: #ddd; cursor: not-allowed; }
  .ai-intro { font: 11px Arial; color: #555; margin: 0; line-height: 1.5; }
  .ai-prompt {
    font: 12px ui-monospace, SFMono-Regular, monospace;
    padding: 8px 10px;
    border: 1px solid #d8d4e8; border-radius: 4px;
    background: #f5f3fb; color: #22223b;
    resize: vertical;
    min-height: 70px;
  }
  .ai-prompt:focus { outline: 2px solid #3b3b8a; outline-offset: -1px; }
  .ai-actions { display: flex; align-items: center; gap: 10px; }
  .ai-submit {
    background: #3b3b8a; color: #fff;
    border: 1px solid #2a2a6a; border-radius: 4px;
    cursor: pointer;
    font: bold 11px Arial; padding: 6px 14px;
  }
  .ai-submit:hover:not(:disabled) { background: #2a2a6a; }
  .ai-submit:disabled { background: #b8b4c8; border-color: #b8b4c8; cursor: not-allowed; }
  .ai-status { font: 11px Arial; }
  .ai-status.muted { color: #888; font-style: italic; }
  .ai-status.err   { color: #cc2222; }
  .ai-status.ok    { color: #2a8a5a; font-weight: bold; }

  /* Proposal preview — read-only pre block + Accept/Reject. */
  .ai-proposal {
    border: 1px solid #b8a8e0;
    background: #f7f4ff;
    border-radius: 4px;
    overflow: hidden;
  }
  .ai-proposal-h {
    display: flex; justify-content: space-between; align-items: center;
    background: #ece5fa; color: #3b2b6a;
    padding: 5px 10px;
    font: bold 11px Arial;
  }
  .ai-proposal-h .muted { color: #7a6aa5; font-weight: normal; font-size: 10px; }
  .ai-proposal-body {
    margin: 0;
    padding: 10px;
    font: 11px ui-monospace, SFMono-Regular, monospace;
    color: #22223b;
    background: #fff;
    max-height: 280px; overflow: auto;
    white-space: pre;
  }
  .ai-proposal-actions {
    display: flex; gap: 6px;
    padding: 6px 10px;
    background: #f7f4ff;
    border-top: 1px solid #ddd5f0;
  }
  .ai-accept {
    background: #2a8a5a; color: #fff;
    border: 1px solid #1f6c45; border-radius: 4px;
    cursor: pointer;
    font: bold 11px Arial; padding: 5px 12px;
  }
  .ai-accept:hover { background: #1f6c45; }
  .ai-reject {
    background: #fff; color: #cc2222;
    border: 1px solid #f0b3b9; border-radius: 4px;
    cursor: pointer;
    font: bold 11px Arial; padding: 5px 12px;
  }
  .ai-reject:hover { background: #fdecec; }

  /* History — short list of past prompts with their accept/reject outcome. */
  .ai-history {
    border-top: 1px solid #e2e2e8;
    margin-top: 4px; padding-top: 8px;
    display: flex; flex-direction: column; gap: 3px;
  }
  .ai-history-h {
    font: bold 10px Arial; color: #666;
    letter-spacing: 0.4px; text-transform: uppercase;
    margin-bottom: 2px;
  }
  .ai-history-row {
    display: flex; align-items: flex-start; gap: 6px;
    font: 11px Arial; color: #555;
    padding: 3px 0;
  }
  .ai-history-mark { flex-shrink: 0; width: 12px; text-align: center; color: #aaa; }
  .ai-history-row.accepted .ai-history-mark { color: #2a8a5a; }
  .ai-history-row.rejected .ai-history-mark { color: #cc2222; }
  .ai-history-prompt {
    flex: 1; min-width: 0;
    overflow: hidden; text-overflow: ellipsis;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    /* button reset — the row is click-to-reload */
    border: none; background: none; padding: 0; margin: 0;
    font: 11px Arial; color: #555; text-align: left; cursor: pointer;
  }
  .ai-history-prompt:hover { color: #18181b; text-decoration: underline; }
  .ai-history-ts {
    flex-shrink: 0; font: 10px Arial; color: #a1a1aa; white-space: nowrap;
  }
  /* History sub-tab — full-height scrollable list (vs the old inline strip). */
  .ai-history.full {
    border-top: none; margin-top: 0; padding-top: 0;
    max-height: 320px; overflow-y: auto;
  }

  /* AI tab label tint — the ✦ icon picks up the lavender palette so users
     find it quickly in the strip. */
  .insp-tab-ai .ic { color: #3b3b8a; }
  .insp-tab-ai.active .ic { color: #fff; }

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
  /* Filter input pinned at the top of the picker grid — spans every
     column so the search box always reads as a single bar regardless of
     how many primitive cards fit per row. */
  .parts-picker-search { grid-column: 1 / -1; width: 100%; box-sizing: border-box; }
  .parts-picker-empty {
    grid-column: 1 / -1;
    font: 10px Arial; color: #888; font-style: italic;
    padding: 4px 2px;
  }
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
  /* Instructions section — markdown preview / edit toggle. */
  .inst-view-toggle { display: inline-flex; gap: 2px; margin-left: auto; }
  .inst-view-btn {
    font-size: 10px; padding: 2px 8px; border: 1px solid #d4d4d8;
    background: #fff; color: #52525b; cursor: pointer; border-radius: 3px;
  }
  .inst-view-btn.active { background: #18181b; color: #fafafa; border-color: #18181b; }
  .ai-instructions-preview {
    border: 1px solid #e4e4e7; border-radius: 4px; padding: 8px 12px;
    max-height: 320px; overflow-y: auto; background: #fcfcfd;
  }
  .ai-instructions-empty {
    border: 1px dashed #d4d4d8; border-radius: 4px; padding: 14px;
    font-size: 11px; color: #71717a; background: #fafafa;
  }
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
  /* Collapsible "imports + meta + signature" section above the body
     editor. Closed by default so the user lands on construction code. */
  .meta-section {
    margin: 4px 0;
    border: 1px solid #d8d4e8;
    border-radius: 4px;
    background: #f5f3fb;
    overflow: hidden;
  }
  .meta-section > summary {
    list-style: none;
    cursor: pointer;
    padding: 6px 10px;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: #22223b;
    user-select: none;
  }
  .meta-section > summary::-webkit-details-marker { display: none; }
  .meta-summary-chev {
    display: inline-block;
    transition: transform 120ms;
    color: #7c4dff;
    font-size: 10px;
    width: 12px;
  }
  .meta-section[open] > summary > .meta-summary-chev { transform: rotate(90deg); }
  .meta-summary-title { font-weight: 600; }
  .meta-summary-sub { color: #6a6a8a; font-size: 11px; }
  .meta-editor-wrap {
    height: 240px;
    border-top: 1px solid #d8d4e8;
  }
  /* Read-only args bar — mirrors the destructure list the collapsed
     header declares. Sticks above the main body editor as documentation
     of what names are in scope. */
  .args-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 6px 0 0;
    padding: 6px 10px;
    background: #ebe7f5;
    border: 1px solid #d8d4e8;
    border-bottom: none;
    border-radius: 4px 4px 0 0;
    font-size: 11px;
  }
  .args-prefix { color: #6a6a8a; text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600; }
  .args-code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    color: #3b3b8a;
    background: transparent;
  }
  /* Tucks the body editor under the args bar — shared border, no gap. */
  .args-bar + .editor-wrap { margin-top: -1px; }
  .args-bar + .editor-wrap :global(.cm-host) { border-top-left-radius: 0; border-top-right-radius: 0; }
  /* Fallback warning strip — shown when the file doesn't match the
     defineGeom shape. Stays out of the way; doesn't lock the user out. */
  .split-warn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    margin: 4px 0;
    background: #fff4e0;
    border: 1px solid #ffd08a;
    border-radius: 4px;
    color: #7a5a10;
    font-size: 11px;
  }
  .split-warn .warn-icon { color: #c87000; }
  .split-warn code { background: #fff; padding: 1px 4px; border-radius: 3px; }
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
