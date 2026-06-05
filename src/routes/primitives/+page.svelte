<script lang="ts">
  // /primitives — sidebar of primitives + a MULTI-TAB center (like
  // /components): clicking a primitive opens it in a tab; multiple tabs
  // stay open to compare, and each PrimitiveView is kept MOUNTED so it
  // stays rendered/loaded when you switch tabs. The three-mode UI
  // (Params / Profile / Source / AI) + Apply/Save live in PrimitiveView;
  // this page is the route shell: list, tabs, source fetch + persistence.
  //
  // Plan: ~/.claude/plans/per-primitive-svelte-views.md.
  import { onMount } from 'svelte';
  import PrimitiveView from '$lib/shared/PrimitiveView.svelte';
  import FloatingPanel from '$lib/shared/FloatingPanel.svelte';
  import { stubSource, buildPartStubFromBase, buildFnProfileStub } from '$lib/cad/primitive-stub';
  import {
    templatesFor, type ProfileTemplate,
    buildExtrudeSource, buildRevolveSource, buildAssemblySource,
  } from '$lib/cad/profile-templates';

  interface Entry {
    id: string;
    source: 'bundle' | 'volume' | 'stdlib' | 'stdstale';
    name: string;
    description: string;
    params: Record<string, any>;
    /** Encapsulated profile defaults (meta.profiles) — the Svelte-component
     *  model. Profiles live here, NOT in params/signature, so compositions
     *  stay clean. Loaded lazily with the source. */
    profiles?: Record<string, any>;
    editable: boolean;
    /** Subfolder NAME inside the family (e.g. 'tests') when the part lives at
     *  primitives/completions/<family>/<subfolder>/<id>.prim.ts. Undefined for
     *  parts at the family root. */
    subfolder?: string;
  }

  let entries: Entry[] = $state([]);
  // Basic — the raw r_* geometry primitives, parked under primitives/basic/
  // on the volume (location IS the category).
  let basic: Entry[] = $state([]);
  // Standard library — r_* building blocks served from src/lib/cad/stdlib/
  // (git-tracked, canonical, read-only). Own sidebar group, above Basic.
  let stdlib: Entry[] = $state([]);
  // stdstale — deprecated stdlib engines (r_extrude / r_revolve as of
  // 2026-06-05). Still resolvable so legacy parts keep baking, but the
  // sidebar renders them in their own group with a yellow tint so the
  // user knows to author NEW parts via the folder + button instead.
  let stdstale: Entry[] = $state([]);
  // Completions is nested by family: { <family>: Entry[] }. Family dirs
  // may be empty (structure only); the sidebar shows them regardless so
  // the user sees where each family's parts will land.
  let completions: Record<string, Entry[]> = $state({});
  // Subfolder names per family (independent of whether they have parts yet) so
  // a freshly-mkdir'd folder shows up immediately. Keyed by family id.
  let completionSubfolders: Record<string, string[]> = $state({});
  // Same shape for Basic — surfaces a Revolved/Extruded/test_primitives split.
  let basicSubfolders: string[] = $state([]);
  let archived: Entry[] = $state([]);
  // Just-created parts the prod list read hasn't caught up to yet (the list is
  // proxied to Railway and can trail the write by seconds). refreshList re-merges
  // these into their bucket until the server includes them — so a new part shows
  // up + stays put instead of vanishing on the next refresh. {id, dir}.
  let pendingCreated: { id: string; dir: string }[] = $state([]);
  function mergePending() {
    const serverIds = new Set([...basic, ...Object.values(completions).flat()].map((x) => x.id));
    // Drop any the server has now caught up to.
    pendingCreated = pendingCreated.filter((pc) => !serverIds.has(pc.id));
    for (const pc of pendingCreated) {
      // basic | basic/<sub> | completions/<fam> | completions/<fam>/<sub> — split
      // to figure out which bucket the just-created part belongs in.
      let bucket: 'basic' | 'completions' | null = null;
      let fam: string | null = null;
      let sub: string | undefined;
      if (pc.dir === 'basic')                       { bucket = 'basic'; }
      else if (pc.dir.startsWith('basic/'))         { bucket = 'basic';       sub = pc.dir.slice('basic/'.length); }
      else if (pc.dir.startsWith('completions/'))   { bucket = 'completions'; [fam, sub] = pc.dir.slice('completions/'.length).split('/') as [string, string|undefined]; }
      const e: Entry = { id: pc.id, source: 'volume', name: pc.id, description: '', params: {}, editable: true, subfolder: sub };
      if (bucket === 'basic') basic = [...basic, e];
      else if (bucket === 'completions' && fam) completions = { ...completions, [fam]: [...(completions[fam] ?? []), e] };
    }
  }

  // Display order + labels for the Completions family sub-folders. Sourced
  // from src/lib/cad/components/families.ts (the central family map); these
  // are the 7 user-approved completion families. Any family dir the server
  // returns that isn't listed here still renders (appended, raw key).
  const COMPLETION_FAMILIES: { id: string; label: string }[] = [
    { id: 'drill_pipe',      label: 'Drill Pipe' },
    { id: 'tubulars',        label: 'Tubulars' },
    { id: 'packers',         label: 'Packers' },
    { id: 'wellhead_xt',     label: 'Wellhead & XT' },
    { id: 'fishing',         label: 'Fishing' },
    { id: 'artificial_lift', label: 'Artificial Lift' },
    { id: 'flow_control',    label: 'Flow Control' },
  ];
  // Ordered family list for rendering: known families first (in order),
  // then any unexpected keys the server returns.
  let completionFamilies = $derived.by(() => {
    const known = COMPLETION_FAMILIES.filter((f) => f.id in completions);
    const knownIds = new Set(COMPLETION_FAMILIES.map((f) => f.id));
    const extra = Object.keys(completions)
      .filter((k) => !knownIds.has(k))
      .map((k) => ({ id: k, label: k }));
    return [...known, ...extra];
  });
  // Multi-tab (like /components): each opened primitive is a tab kept
  // MOUNTED so it stays rendered/loaded when you switch — open several to
  // compare. serverSource is per-tab (dirty tracking + save).
  type Tab = { entry: Entry; serverSource: string; loading: boolean; kind?: 'prim' | 'exp' | 'rev' | 'asm' };
  let openTabs: Tab[] = $state([]);
  let activeId: string | null = $state(null);
  let activeTab = $derived(openTabs.find((t) => t.entry.id === activeId) ?? null);
  let status = $state('');
  let showArchive = $state(false);
  let showStdlib = $state(true);
  // stdstale group default-collapsed — it's reference-only, not the
  // primary surface a user reaches for.
  let showStdstale = $state(false);
  let showBasic = $state(true);
  let showCompletions = $state(true);
  // Sidebar section tabs (vertical, editor format) — Primitives = profile
  // builder + stdlib + Basic; Components = Completions families; Archive =
  // archived parts. Persisted so the user lands back on the same section.
  type SidebarSection = 'primitives' | 'components' | 'archive';
  let section = $state<SidebarSection>(
    (typeof localStorage !== 'undefined' && (localStorage.getItem('prim-sidebar-section') as SidebarSection)) || 'primitives'
  );
  $effect(() => { try { localStorage.setItem('prim-sidebar-section', section); } catch { /* ignore */ } });
  // Per-family collapse state inside Completions, keyed by family id.
  let openFamilies: Record<string, boolean> = $state({});
  // Per-subfolder collapse state inside a family, keyed `<family>/<subfolder>`.
  let openSubfolders: Record<string, boolean> = $state({});

  async function refreshList() {
    try {
      const r = await fetch('/api/primitives/list');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      entries = data.merged ?? [];
      stdlib = data.stdlib ?? [];
      stdstale = data.stdstale ?? [];
      basic = data.basic ?? [];
      completions = data.completions ?? {};
      completionSubfolders = data.completionSubfolders ?? {};
      basicSubfolders = data.basicSubfolders ?? [];
      archived = data.archived ?? [];
      mergePending(); // keep just-created parts visible until the list catches up
      status = '';
    } catch (e: any) {
      // Volume proxy unreachable (e.g. ISP DNS-blocks the prod host) — degrade
      // gracefully instead of leaving `entries` undefined and crashing onMount.
      entries = []; stdlib = []; stdstale = []; basic = []; basicSubfolders = []; completions = {}; completionSubfolders = {}; archived = [];
      status = `⚠ Volume unreachable — couldn't load primitives (${e?.message ?? e}). Check your network/DNS, then reload.`;
    }
  }

  type SourceData = { source: string; origin: string; name?: string; description?: string; params?: Record<string, any>; profiles?: Record<string, any> };
  async function fetchSourceFor(id: string): Promise<SourceData | null> {
    try {
      const r = await fetch(`/api/primitives/source?name=${encodeURIComponent(id)}`);
      if (!r.ok) { status = `Server returned ${r.status}: ${await r.text()}`; return null; }
      const data = await r.json() as SourceData;
      status = `Loaded from ${data.origin}.`;
      return data;
    } catch (e: any) {
      status = `Error: ${e?.message ?? e}`;
      return null;
    }
  }

  // Open a primitive in a tab (or focus it if already open). Pre-loads its
  // source so the PrimitiveView mounts with the right initialSource.
  function openTab(e: Entry) {
    const existing = openTabs.find((t) => t.entry.id === e.id);
    if (existing) { activeId = e.id; return; }
    // Add + focus the tab IMMEDIATELY (non-blocking), then load its source
    // in the background and mount the view when it arrives. Opening and
    // switching never stall, and multiple tabs load concurrently.
    openTabs = [...openTabs, { entry: e, serverSource: '', loading: true }];
    activeId = e.id;
    fetchSourceFor(e.id).then((data) => {
      // Replace the tab object (new ref) so $state reactivity fires — do
      // NOT mutate the original raw object (it isn't the proxied element).
      // The list is now lazy (id only), so the params/name/description
      // arrive HERE with the source and we fold them into the entry BEFORE
      // PrimitiveView mounts (it only mounts once loading=false). Bundle
      // primitives carry their params from the list, so keep those when the
      // source doesn't supply any.
      openTabs = openTabs.map((t) => {
        if (t.entry.id !== e.id) return t;
        const entry = data
          ? {
              ...t.entry,
              params: data.params && Object.keys(data.params).length ? data.params : t.entry.params,
              profiles: data.profiles && Object.keys(data.profiles).length ? data.profiles : t.entry.profiles,
              name: data.name ?? t.entry.name,
              description: data.description ?? t.entry.description,
            }
          : t.entry;
        return { ...t, entry, serverSource: data?.source ?? '', kind: data?.kind, loading: false };
      });
    });
  }
  function closeTab(id: string, ev?: Event) {
    ev?.stopPropagation();
    const i = openTabs.findIndex((t) => t.entry.id === id);
    openTabs = openTabs.filter((t) => t.entry.id !== id);
    if (activeId === id) activeId = (openTabs[i] ?? openTabs[i - 1] ?? openTabs.at(-1))?.entry.id ?? null;
  }
  async function loadFromServerFor(tab: Tab) {
    const data = await fetchSourceFor(tab.entry.id);
    if (data) openTabs = openTabs.map((t) => t.entry.id === tab.entry.id ? { ...t, serverSource: data.source } : t);
  }

  onMount(async () => {
    await refreshList();
    // Default-open my_assy first (testing convenience for the assembly work).
    // Falls back to the first Basic / volume entry when my_assy doesn't exist.
    const all = [...entries, ...basic, ...Object.values(completions).flat()];
    const initial = all.find((e) => e.id === 'my_assy')
      ?? basic?.[0] ?? entries?.find((e) => e.source === 'volume') ?? entries?.[0];
    if (initial) openTab(initial);
  });

  async function saveSourceFor(tab: Tab, newSource: string) {
    if (!tab.entry.editable) return;
    const r = await fetch('/api/primitives/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: tab.entry.id, source: newSource }),
    });
    if (!r.ok) { status = `Save failed: ${await r.text()}`; return; }
    status = `Saved ${tab.entry.id}.`;
    await refreshList();
    // Refresh the tab's entry from the saved source — params.<>.default
    // values change when a typed-builder save rewrites defaults, and we
    // need the new defaults to land in entry.params so PrimitiveView's
    // effectiveSchema → defaultsDirty resets to false after save.
    const data = await fetchSourceFor(tab.entry.id);
    openTabs = openTabs.map((t) => {
      if (t.entry.id !== tab.entry.id) return t;
      const entry = data ? {
        ...t.entry,
        params: data.params && Object.keys(data.params).length ? data.params : t.entry.params,
        profiles: data.profiles && Object.keys(data.profiles).length ? data.profiles : t.entry.profiles,
        name: data.name ?? t.entry.name,
        description: data.description ?? t.entry.description,
      } : t.entry;
      return { ...t, entry, serverSource: data?.source ?? newSource };
    });
  }

  // Rewrite the default literals inside `export const meta = {...}` so
  // current applied slider values become the new defaults. Targeted
  // regex against `<paramName>: { ..., default: <number>, ... }` — only
  // mutates the meta block, leaves the function body untouched.
  function rewriteDefaultsInSource(src: string, applied: Record<string, number>): string {
    let out = src;
    for (const [pname, value] of Object.entries(applied)) {
      const re = new RegExp(`(\\b${pname}\\s*:\\s*\\{[^}]*\\bdefault\\s*:\\s*)-?\\d+(?:\\.\\d+)?`, 'g');
      out = out.replace(re, `$1${value}`);
    }
    return out;
  }

  async function saveDefaultsFor(tab: Tab, applied: Record<string, number>) {
    if (!tab.entry.editable) return;
    await saveSourceFor(tab, rewriteDefaultsInSource(tab.serverSource, applied));
  }

  /** Suggest the next id for a clone: increment a trailing number
   *  (raw_helix_4 → raw_helix_5, skipping any that already exist),
   *  else append `_copy`. */
  function suggestNextId(id: string): string {
    const existing = new Set(entries.map((e) => e.id));
    const m = id.match(/^(.*?)(\d+)$/);
    if (m) {
      let n = parseInt(m[2], 10) + 1;
      let cand = `${m[1]}${n}`;
      while (existing.has(cand)) { n++; cand = `${m[1]}${n}`; }
      return cand;
    }
    let cand = `${id}_copy`;
    let i = 2;
    while (existing.has(cand)) { cand = `${id}_copy${i}`; i++; }
    return cand;
  }

  /** Duplicate any primitive (bundle or volume) into a new VOLUME
   *  primitive. Clones the SAVED source (save in-editor edits first if
   *  you want them carried), rewriting the function header + meta id +
   *  name to the new id. Refuses an id that already exists. */
  async function cloneEntry(e: Entry) {
    const newId = prompt(`Duplicate "${e.id}" as new id:`, suggestNextId(e.id));
    if (!newId) return;
    if (!/^[a-z][a-z0-9_]*$/i.test(newId)) { status = `Invalid id "${newId}".`; return; }
    if (entries.some((x) => x.id === newId)) { status = `"${newId}" already exists.`; return; }
    const data = await fetchSourceFor(e.id);
    if (!data) return;
    const fnRe = new RegExp(`(export\\s+function\\s+)${e.id}(\\s*\\()`);
    const idRe = new RegExp(`(\\bid\\s*:\\s*['"\`])${e.id}(['"\`])`);
    const nameRe = new RegExp(`(\\bname\\s*:\\s*['"\`])${e.id}(['"\`])`);
    const src = data.source
      .replace(fnRe, `$1${newId}$2`)
      .replace(idRe, `$1${newId}$2`)
      .replace(nameRe, `$1${newId}$2`);
    // Preserve the source's TYPE + LOCATION on clone. Without these, save
    // defaulted to kind:'prim' in basic/ root — the user got a .prim.ts
    // file (old composite editor + "No parts recognized" empty state) in
    // the wrong folder. The source endpoint surfaces kind directly;
    // the Entry carries subfolder + (for completions) family. Mirror the
    // source's location exactly so a clone sits next to its sibling.
    const cloneKind = (data as any).kind ?? undefined;
    // Entry doesn't carry the family — walk completions[] to find the
    // bucket (if any). Falls back to basic/ root for stdlib + un-bucketed
    // entries. The save endpoint refuses stdlib ids anyway.
    let family: string | undefined;
    for (const [fam, list] of Object.entries(completions)) {
      if (list.some((x) => x.id === e.id)) { family = fam; break; }
    }
    let cloneDir: string;
    if (family) {
      cloneDir = e.subfolder ? `completions/${family}/${e.subfolder}` : `completions/${family}`;
    } else {
      cloneDir = e.subfolder ? `basic/${e.subfolder}` : 'basic';
    }
    const r = await fetch('/api/primitives/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: newId, source: src, dir: cloneDir, kind: cloneKind }),
    });
    if (!r.ok) { status = `Clone failed: ${await r.text()}`; return; }
    status = `Duplicated ${e.id} → ${newId}.`;
    await refreshList();
    const created = entries.find((x) => x.id === newId);
    if (created) openTab(created);
  }

  /** Create a NEW primitive inside a group folder (the sidebar "+" affordance).
   *  Writes a stub to primitives/<dir>/<id>/, opens the folder, refreshes, and
   *  opens the new part for editing. dir ∈ basic | completions/<family>. */
  // ── New-primitive popup (FloatingPanel — automatable, no native prompt) ──
  // Name + a searchable "start from" picker of r_* base primitives. The new
  // part is a composite that wraps the chosen r_* (meta.uses + a call), so it
  // follows the r_* authoring model (never raw cyl/tube).
  let createPanel = $state<{ dir: string; label: string; x: number; y: number } | null>(null);
  let createId = $state('');
  let createBase = $state('r_revolve');
  let createSearch = $state('');
  let createBusy = $state(false);
  let createErr = $state('');

  // ── Typed-create picker (sidebar `+`) ─────────────────────────────────
  // Three-step flow: pick TYPE (Extrude/Profile/Assembly), pick TEMPLATE
  // (curated profile-templates), pick ID. Scaffolds .exp / .rev / .asm
  // sources from src/lib/cad/profile-templates.ts and POSTs /save with
  // `kind` so the right typed-builder mounts on first open.
  type TypedKind = 'exp' | 'rev' | 'asm';
  let typedCreate = $state<{
    dir: string; label: string; x: number; y: number;
    step: 'type' | 'template' | 'name';
    kind?: TypedKind;
    templateId?: string;
    id: string;
    busy: boolean;
    err: string;
  } | null>(null);
  function openTypedCreate(dir: string, label: string, ev: MouseEvent) {
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    typedCreate = {
      dir, label,
      x: Math.min(r.right + 6, window.innerWidth - 340),
      y: Math.min(r.top, window.innerHeight - 440),
      step: 'type', id: '', busy: false, err: '',
    };
  }
  function closeTypedCreate() { typedCreate = null; }
  async function submitTypedCreate() {
    if (!typedCreate || typedCreate.busy) return;
    const t = typedCreate;
    if (!t.kind) { t.err = 'pick a part type'; return; }
    if (t.kind !== 'asm' && !t.templateId) { t.err = 'pick a template'; return; }
    const newId = t.id.trim();
    if (!/^[a-z][a-z0-9_]*$/i.test(newId)) { t.err = 'id must be [a-z][a-z0-9_]*'; return; }
    const all = [...entries, ...stdlib, ...basic, ...Object.values(completions).flat()];
    if (all.some((x) => x.id === newId)) { t.err = `"${newId}" already exists`; return; }
    t.busy = true; t.err = '';
    try {
      // Look the template up.
      let source: string;
      if (t.kind === 'asm') {
        source = buildAssemblySource(newId);
      } else {
        const axis = t.kind === 'exp' ? 'cartesian' : 'revolve';
        const tpl = templatesFor(axis).find((x) => x.id === t.templateId);
        if (!tpl) { t.err = 'template not found'; return; }
        source = t.kind === 'exp' ? buildExtrudeSource(newId, tpl) : buildRevolveSource(newId, tpl);
      }
      const r = await fetch('/api/primitives/save', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: newId, source, dir: t.dir, kind: t.kind }),
      });
      if (!r.ok) { t.err = `save failed: ${await r.text()}`; return; }
      status = `Created ${newId} in ${t.label}.`;
      if (t.dir === 'basic') showBasic = true;
      // Show immediately + open in a tab. Same pattern the legacy create flow uses.
      pendingCreated = [...pendingCreated, { id: newId, source: 'volume', name: newId, description: '', params: {}, editable: true }];
      closeTypedCreate();
      await refreshList();
      const newEntry = [...entries, ...basic, ...Object.values(completions).flat()].find((e) => e.id === newId)
        ?? { id: newId, source: 'volume' as const, name: newId, description: '', params: {}, editable: true };
      openTab(newEntry);
    } catch (e: any) {
      t.err = String(e?.message ?? e);
    } finally {
      t.busy = false;
    }
  }
  // Cards shown in the template-pick step. Filter by kind.
  function templatesForKind(kind: TypedKind): ProfileTemplate[] {
    if (kind === 'exp') return templatesFor('cartesian');
    if (kind === 'rev') return templatesFor('revolve');
    return [];
  }
  // Base options = the stdlib function-first bases (r_revolve / r_extrude — pick
  // a profile FUNCTION inside the new part) PLUS the simple r_* leaves in Basic.
  // r_rotate is retired (stdlib r_revolve replaces it), so it's excluded.
  let createBaseList = $derived.by(() => {
    const q = createSearch.trim().toLowerCase();
    const fromStdlib = stdlib.map((b) => b.id).filter((id) => id.startsWith('r_'));
    const fromBasic = basic.map((b) => b.id).filter((id) => id.startsWith('r_') && id !== 'r_rotate');
    const rs = [...new Set([...fromStdlib, ...fromBasic])].sort();
    return q ? rs.filter((b) => b.toLowerCase().includes(q) || baseLabel(b).toLowerCase().includes(q)) : rs;
  });
  function baseLabel(b: string): string {
    if (b === 'r_revolve') return 'r_revolve  ◆ function profile (revolve)';
    if (b === 'r_extrude') return 'r_extrude  ◆ function profile (extrude)';
    return b;
  }
  function openCreate(dir: string, label: string, ev: MouseEvent) {
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    createId = ''; createSearch = ''; createBase = 'r_revolve'; createErr = '';
    createPanel = { dir, label, x: Math.min(r.right + 6, window.innerWidth - 320), y: Math.min(r.top, window.innerHeight - 360) };
  }
  function closeCreate() { createPanel = null; }

  // ── New-FOLDER popup (FloatingPanel) ──────────────────────────────────────
  // Adds a subfolder INSIDE a family: primitives/completions/<family>/<name>/.
  // Reuses /api/volume's POST ?action=mkdir; no new endpoint. The 3rd-level
  // resolver walk (primitive-paths.findPrim) makes parts inside the new folder
  // discoverable; the list endpoint surfaces the subfolder even when empty.
  // parent is the path under primitives/ to mkdir INTO — 'basic' for the
  // Primitives-tab Basic group; 'completions/<family>' for a family folder.
  let mkdirPanel = $state<{ parent: string; label: string; x: number; y: number } | null>(null);
  let mkdirName = $state('');
  let mkdirBusy = $state(false);
  let mkdirErr = $state('');
  const SUB_RE = /^[a-z][a-z0-9_]*$/;
  function openMkdir(parent: string, label: string, ev: MouseEvent) {
    ev.stopPropagation();
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    mkdirName = ''; mkdirErr = '';
    mkdirPanel = { parent, label, x: Math.min(r.right + 6, window.innerWidth - 280), y: Math.min(r.top, window.innerHeight - 220) };
  }
  function closeMkdir() { mkdirPanel = null; }
  async function submitMkdir() {
    if (!mkdirPanel || mkdirBusy) return;
    const name = mkdirName.trim();
    if (!SUB_RE.test(name)) { mkdirErr = 'Lowercase letters, digits, underscore. Must start with a letter.'; return; }
    const parent = mkdirPanel.parent;
    // Existing subfolders to check for collisions — basic or completions/<fam>.
    const existing = parent === 'basic' ? basicSubfolders
      : parent.startsWith('completions/') ? (completionSubfolders[parent.slice('completions/'.length)] ?? [])
      : [];
    if (existing.includes(name)) { mkdirErr = `"${name}" already exists in ${mkdirPanel.label}.`; return; }
    const path = `primitives/${parent}/${name}`;
    mkdirBusy = true;
    try {
      const r = await fetch(`/api/volume?path=${encodeURIComponent(path)}&action=mkdir`, { method: 'POST' });
      if (!r.ok) { mkdirErr = `mkdir failed: ${await r.text()}`; return; }
      status = `Created folder "${name}" in ${mkdirPanel.label}.`;
      // Optimistic: surface the new folder + auto-open it before the list catches up.
      if (parent === 'basic') {
        basicSubfolders = [...basicSubfolders, name].sort();
        showBasic = true;
        openSubfolders = { ...openSubfolders, [`basic/${name}`]: true };
      } else if (parent.startsWith('completions/')) {
        const fam = parent.slice('completions/'.length);
        completionSubfolders = { ...completionSubfolders, [fam]: [...existing, name].sort() };
        openFamilies = { ...openFamilies, [fam]: true };
        openSubfolders = { ...openSubfolders, [`${fam}/${name}`]: true };
      }
      closeMkdir();
      await refreshList();
    } finally { mkdirBusy = false; }
  }

  // ── Move-to-folder popup (FloatingPanel) ──────────────────────────────────
  // A part's on-volume folder IS its sidebar group (location = category,
  // Rule 16), so moving the file regroups it. Open a folder picker anchored to
  // the row's 📁 button; POST /api/primitives/move; refresh.
  let movePanel = $state<{ id: string; from: string; x: number; y: number } | null>(null);
  let moveBusy = $state(false);
  let moveTargets = $derived.by(() => {
    const all: { to: string; label: string }[] = [
      { to: 'basic', label: 'Basic' },
    ];
    // Subfolders inside Basic (Revolved / Extruded / test_primitives / …).
    for (const sub of basicSubfolders) {
      all.push({ to: `basic/${sub}`, label: `Basic / ${sub}` });
    }
    for (const f of completionFamilies) {
      all.push({ to: `completions/${f.id}`, label: `Completions / ${f.label}` });
      for (const sub of completionSubfolders[f.id] ?? []) {
        all.push({ to: `completions/${f.id}/${sub}`, label: `Completions / ${f.label} / ${sub}` });
      }
    }
    return movePanel ? all.filter((t) => t.to !== movePanel!.from) : all;
  });
  function openMove(id: string, from: string, ev: MouseEvent) {
    ev.stopPropagation();
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    movePanel = { id, from, x: Math.min(r.right + 6, window.innerWidth - 240), y: Math.min(r.top, window.innerHeight - 320) };
  }
  function closeMove() { movePanel = null; }
  async function moveTo(to: string) {
    if (!movePanel || moveBusy) return;
    const id = movePanel.id;
    moveBusy = true;
    try {
      const r = await fetch(`/api/primitives/move?id=${encodeURIComponent(id)}&to=${encodeURIComponent(to)}`, { method: 'POST' });
      if (!r.ok) { status = `Move failed: ${await r.text()}`; return; }
      status = `Moved "${id}" → ${to}.`;
      closeMove();
      await refreshList();
    } finally { moveBusy = false; }
  }
  // Build a composite stub that wraps the chosen base r_* (mirrors its params).
  async function buildStubFromBase(id: string, base: string): Promise<string | null> {
    // Stdlib function-first bases get a profile-selector wrapper; other r_*
    // leaves mirror their params.
    if (base === 'r_revolve' || base === 'r_extrude') return buildFnProfileStub(id, base);
    try {
      const res = await fetch(`/api/primitives/source?name=${encodeURIComponent(base)}`);
      if (!res.ok) return null;
      const params: Record<string, any> = (await res.json()).params ?? {};
      return buildPartStubFromBase(id, base, params);
    } catch { return null; }
  }
  async function submitCreate() {
    if (!createPanel || createBusy) return;
    const all = [...entries, ...stdlib, ...basic, ...Object.values(completions).flat()];
    const newId = createId.trim();
    if (!/^[a-z][a-z0-9_]*$/i.test(newId)) { createErr = 'id must be [a-z][a-z0-9_]*'; return; }
    if (all.some((x) => x.id === newId)) { createErr = `"${newId}" already exists`; return; }
    if (!createBase) { createErr = 'pick a base primitive'; return; }
    createBusy = true; createErr = '';
    const { dir, label } = createPanel;
    try {
      const source = await buildStubFromBase(newId, createBase) ?? stubSource(newId);
      const r = await fetch('/api/primitives/save', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: newId, source, dir }),
      });
      if (!r.ok) { createErr = `save failed: ${await r.text()}`; return; }
      status = `Created ${newId} in ${label}.`;
      if (dir === 'basic') showBasic = true;
      else if (dir.startsWith('completions/')) { showCompletions = true; openFamilies[dir.slice('completions/'.length)] = true; }
      closeCreate();
      // Show the new part IMMEDIATELY — the prod list read (proxied to Railway)
      // can trail the write, so don't gate the UI on it. Track it as pending +
      // refresh (mergePending keeps it visible until the server catches up), then
      // open it. The source endpoint is fresh, so the tab loads even mid-lag.
      if (!pendingCreated.some((pc) => pc.id === newId)) pendingCreated = [...pendingCreated, { id: newId, dir }];
      await refreshList();
      const created = [...entries, ...stdlib, ...basic, ...Object.values(completions).flat()].find((x) => x.id === newId)
        ?? ({ id: newId, source: 'volume', name: newId, description: '', params: {}, editable: true } as Entry);
      openTab(created);
      status = `Created ${newId} in ${label}.`;
    } catch (e: any) { createErr = `error: ${e?.message ?? e}`; }
    finally { createBusy = false; }
  }

  /** Save As… — persist the CURRENT (live, possibly-unsaved) editor buffer
   *  under a NEW id, creating a new volume primitive without touching the
   *  original. Differs from Duplicate (which clones the SAVED source): this
   *  takes the in-flight `editedSource` straight from PrimitiveView. The meta
   *  id/name are rewritten to the new id; refuses an existing id (collision
   *  guard lives in PrimitiveView's popup too, this is the server-side-of-UI
   *  backstop). Opens the new primitive on success. */
  async function saveAsEntry(srcId: string, newId: string, editedSource: string) {
    if (!/^[a-z][a-z0-9_]*$/i.test(newId)) { status = `Invalid id "${newId}".`; return false; }
    if (entries.some((x) => x.id === newId) || basic.some((x) => x.id === newId)) {
      status = `"${newId}" already exists — pick another name.`;
      return false;
    }
    const idRe = /(\bid\s*:\s*['"`])[a-z0-9_]*(['"`])/i;
    const nameRe = /(\bname\s*:\s*['"`])[a-z0-9_]*(['"`])/i;
    // Rewrite the FIRST id: / name: literal inside the meta block. The meta
    // declaration is at the top of source, so the first match is meta.id /
    // meta.name (matches the cloneEntry convention but keyed to the literal,
    // not the source dir-id, so it works regardless of the old value).
    let src = editedSource.replace(idRe, `$1${newId}$2`);
    if (nameRe.test(src)) src = src.replace(nameRe, `$1${newId}$2`);
    // Preserve the SOURCE entry's TYPE + LOCATION so Save As lands next
    // to the original (not at primitives/ root). Mirrors cloneEntry's
    // family walk + subfolder + kind preservation. Without this, every
    // Save As silently created a flat <id>.prim.ts at the volume root,
    // invisible in the sidebar's category groups.
    const srcEntry = [...entries, ...basic, ...Object.values(completions).flat(), ...archived]
      .find((x) => x.id === srcId);
    let family: string | undefined;
    for (const [fam, list] of Object.entries(completions)) {
      if (list.some((x) => x.id === srcId)) { family = fam; break; }
    }
    const sub = srcEntry?.subfolder;
    const targetDir = family
      ? (sub ? `completions/${family}/${sub}` : `completions/${family}`)
      : (sub ? `basic/${sub}` : 'basic');
    // Read the source's KIND so a Save As on an assembly stays an
    // assembly (.asm.ts), not silently typed as a plain prim.
    let srcKind: string | undefined;
    try {
      const d = await fetchSourceFor(srcId);
      srcKind = (d as any)?.kind;
    } catch { /* fall back to default 'prim' on the server side */ }
    const r = await fetch('/api/primitives/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: newId, source: src, dir: targetDir, kind: srcKind }),
    });
    if (!r.ok) { status = `Save As failed: ${await r.text()}`; return false; }
    status = `Saved ${srcId} as → ${newId}.`;
    await refreshList();
    const created = entries.find((x) => x.id === newId) ?? basic.find((x) => x.id === newId);
    if (created) openTab(created);
    return true;
  }

  // Soft-delete: trash button moves to archive/ (recoverable). Two-step
  // delete protects against accidental loss of a primitive that took
  // effort to build.
  async function renameById(id: string) {
    const raw = prompt(`Rename "${id}" to:`, id);
    if (!raw) return;
    const newId = raw.trim();
    if (!newId || newId === id) return;
    if (!/^[a-z][a-z0-9_]*$/i.test(newId)) {
      alert(`Invalid name "${newId}". Use lowercase letters, digits, underscore; must start with a letter.`);
      return;
    }
    const r = await fetch(`/api/primitives/rename?id=${encodeURIComponent(id)}&to=${encodeURIComponent(newId)}`, { method: 'POST' });
    if (!r.ok) { status = `Rename failed: ${await r.text()}`; return; }
    const data = await r.json().catch(() => ({}));
    const deps: string[] = data?.dependents ?? [];
    status = deps.length
      ? `Renamed "${id}" → "${newId}". ⚠ ${deps.length} assemblies still reference the old id: ${deps.join(', ')}`
      : `Renamed "${id}" → "${newId}".`;
    // Close any tab open under the old id (its source is stale anyway).
    closeTab(id);
    await refreshList();
  }

  async function archiveById(id: string) {
    if (!confirm(`Archive volume primitive "${id}"?\n\nIt will move to the Archive section — use the trash icon there to permanently delete.`)) return;
    const r = await fetch(`/api/primitives/delete?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!r.ok) { status = `Archive failed: ${await r.text()}`; return; }
    status = `Archived "${id}".`;
    pendingCreated = pendingCreated.filter((pc) => pc.id !== id); // don't resurrect a deleted just-created part
    await refreshList();
    closeTab(id);
  }

  async function restoreById(id: string) {
    const r = await fetch(`/api/primitives/restore?id=${encodeURIComponent(id)}`, { method: 'POST' });
    if (!r.ok) { status = `Restore failed: ${await r.text()}`; return; }
    status = `Restored "${id}".`;
    await refreshList();
  }

  async function purgeById(id: string) {
    if (!confirm(`Permanently delete "${id}"?\n\nThis CANNOT be undone — the source.ts is gone.`)) return;
    const r = await fetch(`/api/primitives/delete?id=${encodeURIComponent(id)}&permanent=true`, { method: 'DELETE' });
    if (!r.ok) { status = `Permanent delete failed: ${await r.text()}`; return; }
    status = `Permanently deleted "${id}".`;
    pendingCreated = pendingCreated.filter((pc) => pc.id !== id); // don't resurrect a purged part
    await refreshList();
  }

  // ── Archive: multi-select + bulk permanent delete ──────────────────────
  // Checkbox set of selected archived ids; cleared whenever the archive
  // list refreshes or when the user explicitly clears.
  let archiveSelected: Set<string> = $state(new Set());
  function toggleArchiveSelect(id: string) {
    const next = new Set(archiveSelected);
    if (next.has(id)) next.delete(id); else next.add(id);
    archiveSelected = next;
  }
  function selectAllArchive() {
    archiveSelected = new Set(archived.map((a) => a.id));
  }
  function clearArchiveSelection() { archiveSelected = new Set(); }
  let archiveAllSelected = $derived(archived.length > 0 && archiveSelected.size === archived.length);
  async function purgeSelected() {
    const ids = [...archiveSelected];
    if (ids.length === 0) return;
    if (!confirm(`Permanently delete ${ids.length} archived part${ids.length > 1 ? 's' : ''}?\n\nThis CANNOT be undone.\n\nIds:\n${ids.slice(0, 20).join(', ')}${ids.length > 20 ? '\n…' : ''}`)) return;
    let ok = 0, fail = 0;
    for (const id of ids) {
      const r = await fetch(`/api/primitives/delete?id=${encodeURIComponent(id)}&permanent=true`, { method: 'DELETE' });
      if (r.ok) { ok++; pendingCreated = pendingCreated.filter((pc) => pc.id !== id); }
      else { fail++; }
    }
    status = `Permanently deleted ${ok} of ${ids.length} archived part${ok > 1 ? 's' : ''}${fail ? ` (${fail} failed)` : ''}.`;
    archiveSelected = new Set();
    await refreshList();
  }

  // Collapsible sidebar (persisted; mirrors SVTC's home-page sidebar pattern).
  let railCollapsed = $state(typeof localStorage !== 'undefined' && localStorage.getItem('prim-rail-collapsed') === '1');
  $effect(() => { try { localStorage.setItem('prim-rail-collapsed', railCollapsed ? '1' : '0'); } catch { /* ignore */ } });

  // Resizable sidebar — drag the right edge to widen so long primitive names
  // are readable. Width persisted; clamped to a sane range.
  const RAIL_MIN = 160, RAIL_MAX = 560;
  const railInit = (() => {
    const v = typeof localStorage !== 'undefined' ? Number(localStorage.getItem('prim-rail-width')) : NaN;
    return Number.isFinite(v) && v >= RAIL_MIN && v <= RAIL_MAX ? v : 240;
  })();
  let railWidth = $state(railInit);
  let railResizing = $state(false);
  function startRailResize(ev: PointerEvent) {
    ev.preventDefault();
    railResizing = true;
    const move = (e: PointerEvent) => {
      railWidth = Math.max(RAIL_MIN, Math.min(RAIL_MAX, e.clientX));
    };
    const up = () => {
      railResizing = false;
      try { localStorage.setItem('prim-rail-width', String(Math.round(railWidth))); } catch { /* ignore */ }
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
</script>

<!-- Folder glyph for the sidebar group/family headers — open (expanded) vs
     closed (collapsed), Heroicons folder / folder-open. Gives the tree a
     file-manager "these are folders" read. -->
{#snippet folderIcon(open: boolean)}
  <svg class="prim-folder-ico" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    {#if open}
      <path d="M19.906 9c.382 0 .749.057 1.094.162V9a3 3 0 0 0-3-3h-3.879a.75.75 0 0 1-.53-.22L11.47 3.66A2.25 2.25 0 0 0 9.879 3H6a3 3 0 0 0-3 3v3.162A3.756 3.756 0 0 1 4.094 9h15.812ZM4.094 10.5a2.25 2.25 0 0 0-2.227 2.568l.857 6A2.25 2.25 0 0 0 4.951 21H19.05a2.25 2.25 0 0 0 2.227-1.932l.857-6a2.25 2.25 0 0 0-2.227-2.568H4.094Z"/>
    {:else}
      <path d="M19.5 21a3 3 0 0 0 3-3v-4.5a3 3 0 0 0-3-3h-15a3 3 0 0 0-3 3V18a3 3 0 0 0 3 3h15ZM1.5 10.146V6a3 3 0 0 1 3-3h5.379a2.25 2.25 0 0 1 1.59.659l2.122 2.121c.14.141.331.22.53.22H19.5a3 3 0 0 1 3 3v1.146A4.483 4.483 0 0 0 19.5 9h-15a4.483 4.483 0 0 0-3 1.146Z"/>
    {/if}
  </svg>
{/snippet}

<!-- Row action: rename a volume part / assembly in place. Prompts for
     the new id, calls /api/primitives/rename. -->
{#snippet renameBtn(eid: string)}
  <button class="prim-rename" type="button" title="Rename" aria-label="Rename" onclick={(ev) => { ev.stopPropagation(); renameById(eid); }}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M16.862 4.487l1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125"/>
    </svg>
  </button>
{/snippet}

<!-- Row action: file this part into another folder (opens the folder picker). -->
{#snippet moveBtn(eid: string, from: string)}
  <button class="prim-move" type="button" title="Move to another folder" aria-label="Move to folder" onclick={(ev) => openMove(eid, from, ev)}>
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19.5 21a3 3 0 0 0 3-3v-4.5a3 3 0 0 0-3-3h-15a3 3 0 0 0-3 3V18a3 3 0 0 0 3 3h15ZM1.5 10.146V6a3 3 0 0 1 3-3h5.379a2.25 2.25 0 0 1 1.59.659l2.122 2.121c.14.141.331.22.53.22H19.5a3 3 0 0 1 3 3v1.146A4.483 4.483 0 0 0 19.5 9h-15a4.483 4.483 0 0 0-3 1.146Z"/></svg>
  </button>
{/snippet}

<!-- Row action: archive (soft-delete) — leftmost visible icon, only for editable
     volume parts. Absolute-positioned in the row's left margin so the file name
     doesn't shift right on non-editable rows; editable rows reserve ~22px of
     clearance via the :has() rule in .prim-row-wrap CSS. -->
{#snippet trashBtn(eid: string)}
  <button class="prim-trash" type="button" title="Archive (soft delete)" aria-label="Archive" onclick={(ev) => { ev.stopPropagation(); archiveById(eid); }}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m5 5v6m4-6v6"/>
    </svg>
  </button>
{/snippet}

<div class="prim-page" class:rail-collapsed={railCollapsed} class:rail-resizing={railResizing}
  style={railCollapsed ? '' : `grid-template-columns: ${railWidth}px 1fr;`}>
  {#if !railCollapsed}
    <div class="prim-rail-resize" role="separator" aria-orientation="vertical"
      title="Drag to resize · double-click to reset"
      style={`left: ${railWidth}px;`}
      onpointerdown={startRailResize}
      ondblclick={() => { railWidth = 240; try { localStorage.setItem('prim-rail-width', '240'); } catch { /* ignore */ } }}></div>
  {/if}
  <aside class="prim-rail">
    <header>
      <button class="prim-rail-toggle" type="button" title="Collapse sidebar" onclick={() => railCollapsed = true}>«</button>
      <h2>Primitives</h2>
      <p class="sub">Backend toolkit — raw geometry functions</p>
    </header>

    <!-- Vertical section tabs (editor format — trapezoidal, vertical-text,
         tight rail). Three sections own the formerly-stacked groups:
           Primitives  → Profile builder link + (loose) + stdlib + Basic
           Components  → Completions families
           Archive     → archived parts (empty state when none) -->
    <div class="prim-tabs">
      <div class="prim-vrail" role="tablist" aria-label="Sidebar sections">
        <button class="prim-vtab" class:active={section === 'primitives'} type="button" role="tab" aria-selected={section === 'primitives'} title="Primitives — profile builder + stdlib + Basic" onclick={() => (section = 'primitives')}>
          <span class="prim-vtab-ic">📐</span>
          <span class="prim-vtab-lbl">Primitives</span>
        </button>
        <button class="prim-vtab" class:active={section === 'components'} type="button" role="tab" aria-selected={section === 'components'} title="Components — Completions families" onclick={() => (section = 'components')}>
          <span class="prim-vtab-ic">🧩</span>
          <span class="prim-vtab-lbl">Components</span>
        </button>
        <button class="prim-vtab" class:active={section === 'archive'} type="button" role="tab" aria-selected={section === 'archive'} title="Archive — soft-deleted parts" onclick={() => (section = 'archive')}>
          <span class="prim-vtab-ic">🗄</span>
          <span class="prim-vtab-lbl">Archive{#if archived.length} ({archived.length}){/if}</span>
        </button>
      </div>

      <div class="prim-tabpanel">
        {#if section === 'primitives'}
          <a class="prim-profiles-link" href="/primitives/profiles" title="Open the full-screen profile builder">ƒ Profile builder ›</a>

          <!-- Loose top section — uncategorized volume primitives (empty by default). -->
          {#if entries.length}
            <div class="prim-list">
              {#each entries as e (e.id)}
                <div class="prim-row-wrap" class:active={activeId === e.id} class:open={openTabs.some((t) => t.entry.id === e.id)}>
                  {#if e.editable}{@render trashBtn(e.id)}{/if}
                  <button class="prim-row" type="button" draggable={true} ondragstart={(ev) => ev.dataTransfer?.setData('application/x-primitive-id', e.id)} onclick={() => openTab(e)}>
                    <span class="prim-name">{e.id}</span>
                    <span class="prim-tag" class:vol={e.source === 'volume'}>{e.source === 'volume' ? 'vol' : 'bnd'}</span>
                  </button>
                  <button class="prim-dup" type="button" title="Duplicate to a new volume primitive" aria-label="Duplicate" onclick={() => cloneEntry(e)}>⎘</button>
                  {#if e.editable}{@render renameBtn(e.id)}{/if}
                  {@render moveBtn(e.id, '')}
                </div>
              {/each}
            </div>
          {/if}

          <!-- stdlib — git-tracked r_* canonical building blocks (read-only). -->
          {#if stdlib.length}
            <div class="prim-tests">
              <div class="prim-head-row">
                <button class="prim-arch-head" type="button" onclick={() => (showStdlib = !showStdlib)}>
                  {@render folderIcon(showStdlib)}
                  stdlib {#if stdlib.length}({stdlib.length}){/if}
                </button>
              </div>
              {#if showStdlib}
                {#each stdlib as e (e.id)}
                  <div class="prim-row-wrap" class:active={activeId === e.id} class:open={openTabs.some((t) => t.entry.id === e.id)}>
                    <button class="prim-row" type="button" draggable={true} ondragstart={(ev) => ev.dataTransfer?.setData('application/x-primitive-id', e.id)} onclick={() => openTab(e)}>
                      <span class="prim-name">{e.id}</span>
                      <span class="prim-tag src" title="from src/lib/cad/stdlib — read-only">src</span>
                    </button>
                    <button class="prim-dup" type="button" title="Duplicate to a new editable volume primitive" aria-label="Duplicate" onclick={() => cloneEntry(e)}>⎘</button>
                  </div>
                {/each}
              {/if}
            </div>
          {/if}

          <!-- stdstale — deprecated stdlib engines (still resolvable so
               legacy parts keep baking) tinted yellow. Authoring new parts
               should go via the folder + button instead. -->
          {#if stdstale.length}
            <div class="prim-tests prim-stdstale">
              <div class="prim-head-row">
                <button class="prim-arch-head" type="button"
                  title="Deprecated stdlib engines — kept resolvable for legacy parts only. Create new parts via the + button in Basic / Completions."
                  onclick={() => (showStdstale = !showStdstale)}>
                  {@render folderIcon(showStdstale)}
                  stdstale {#if stdstale.length}({stdstale.length}){/if}
                </button>
              </div>
              {#if showStdstale}
                {#each stdstale as e (e.id)}
                  <div class="prim-row-wrap" class:active={activeId === e.id} class:open={openTabs.some((t) => t.entry.id === e.id)}>
                    <button class="prim-row" type="button" draggable={true} ondragstart={(ev) => ev.dataTransfer?.setData('application/x-primitive-id', e.id)} onclick={() => openTab(e)}>
                      <span class="prim-name">{e.id}</span>
                      <span class="prim-tag stale" title="Deprecated — kept resolvable from src/lib/cad/stdstale for legacy parts only">stale</span>
                    </button>
                    <button class="prim-dup" type="button" title="Duplicate to a new editable volume primitive" aria-label="Duplicate" onclick={() => cloneEntry(e)}>⎘</button>
                  </div>
                {/each}
              {/if}
            </div>
          {/if}

          <!-- Basic — r_* volume primitives at primitives/basic/, optionally
               with nested subfolders (Revolved / Extruded / test_primitives /
               …). Root parts render directly under Basic; each subfolder is
               its own collapsible fold one indent deeper, mirroring Components. -->
          {@const basicRoot = basic.filter((e) => !e.subfolder)}
          <div class="prim-tests">
            <div class="prim-head-row">
              <button class="prim-arch-head" type="button" onclick={() => (showBasic = !showBasic)}>
                {@render folderIcon(showBasic)}
                Basic {#if basic.length}({basic.length}){/if}
              </button>
              <button class="prim-add prim-add-folder" type="button" title="New folder in Basic" aria-label="New folder" onclick={(e) => openMkdir('basic', 'Basic', e)}>
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19.5 21a3 3 0 0 0 3-3v-4.5a3 3 0 0 0-3-3h-15a3 3 0 0 0-3 3V18a3 3 0 0 0 3 3h15ZM1.5 10.146V6a3 3 0 0 1 3-3h5.379a2.25 2.25 0 0 1 1.59.659l2.122 2.121c.14.141.331.22.53.22H19.5a3 3 0 0 1 3 3v1.146A4.483 4.483 0 0 0 19.5 9h-15a4.483 4.483 0 0 0-3 1.146Z"/></svg>
                <span class="prim-add-folder-plus">+</span>
              </button>
              <button class="prim-add" type="button" title="New primitive in Basic" aria-label="Add primitive" onclick={(e) => openTypedCreate('basic', 'Basic', e)}>＋</button>
            </div>
            {#if showBasic}
              {#if basicRoot.length === 0 && basicSubfolders.length === 0}
                <div class="prim-empty">none yet</div>
              {/if}
              <!-- Root parts (no subfolder). -->
              {#each basicRoot as e (e.id)}
                <div class="prim-row-wrap" class:active={activeId === e.id} class:open={openTabs.some((t) => t.entry.id === e.id)}>
                  {#if e.editable}{@render trashBtn(e.id)}{/if}
                  <button class="prim-row" type="button" draggable={true} ondragstart={(ev) => ev.dataTransfer?.setData('application/x-primitive-id', e.id)} onclick={() => openTab(e)}>
                    <span class="prim-name">{e.id}</span>
                    <span class="prim-tag vol">vol</span>
                  </button>
                  <button class="prim-dup" type="button" title="Duplicate to a new volume primitive" aria-label="Duplicate" onclick={() => cloneEntry(e)}>⎘</button>
                  {#if e.editable}{@render renameBtn(e.id)}{/if}
                  {@render moveBtn(e.id, 'basic')}
                </div>
              {/each}
              <!-- Subfolders (Revolved/Extruded/test_primitives/…). -->
              {#each basicSubfolders as sub (sub)}
                {@const subParts = basic.filter((e) => e.subfolder === sub)}
                {@const subKey = `basic/${sub}`}
                <div class="prim-subfolder">
                  <div class="prim-head-row">
                    <button class="prim-sub-head" type="button" onclick={() => (openSubfolders[subKey] = !openSubfolders[subKey])}>
                      {@render folderIcon(openSubfolders[subKey])}
                      {sub} {#if subParts.length}({subParts.length}){/if}
                    </button>
                    <button class="prim-add" type="button" title={`New primitive in Basic / ${sub}`} aria-label="Add primitive" onclick={(e) => openTypedCreate(`basic/${sub}`, `Basic / ${sub}`, e)}>＋</button>
                  </div>
                  {#if openSubfolders[subKey]}
                    {#if subParts.length === 0}
                      <div class="prim-empty prim-fam-empty">empty</div>
                    {:else}
                      {#each subParts as e (e.id)}
                        <div class="prim-row-wrap prim-fam-row" class:active={activeId === e.id} class:open={openTabs.some((t) => t.entry.id === e.id)}>
                          {#if e.editable}{@render trashBtn(e.id)}{/if}
                          <button class="prim-row" type="button" draggable={true} ondragstart={(ev) => ev.dataTransfer?.setData('application/x-primitive-id', e.id)} onclick={() => openTab(e)}>
                            <span class="prim-name">{e.id}</span>
                            <span class="prim-tag vol">vol</span>
                          </button>
                          <button class="prim-dup" type="button" title="Duplicate to a new volume primitive" aria-label="Duplicate" onclick={() => cloneEntry(e)}>⎘</button>
                  {#if e.editable}{@render renameBtn(e.id)}{/if}
                          {@render moveBtn(e.id, `basic/${sub}`)}
                        </div>
                      {/each}
                    {/if}
                  {/if}
                </div>
              {/each}
            {/if}
          </div>

        {:else if section === 'components'}
          <!-- Completions families AS the top-level folders (no outer
               "Completions" wrapper — the Components tab IS the context). -->
          {#if completionFamilies.length === 0}
            <div class="prim-empty">no families yet</div>
          {:else}
            {#each completionFamilies as fam (fam.id)}
              {@const allParts = completions[fam.id] ?? []}
              {@const rootParts = allParts.filter((e) => !e.subfolder)}
              {@const subs = completionSubfolders[fam.id] ?? []}
              <div class="prim-tests prim-cmp-fam">
                <div class="prim-head-row">
                  <button class="prim-arch-head" type="button" onclick={() => (openFamilies[fam.id] = !openFamilies[fam.id])}>
                    {@render folderIcon(openFamilies[fam.id])}
                    {fam.label} {#if allParts.length}({allParts.length}){/if}
                  </button>
                  <button class="prim-add prim-add-folder" type="button" title={`New folder in ${fam.label}`} aria-label="New folder" onclick={(e) => openMkdir(`completions/${fam.id}`, fam.label, e)}>
                    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19.5 21a3 3 0 0 0 3-3v-4.5a3 3 0 0 0-3-3h-15a3 3 0 0 0-3 3V18a3 3 0 0 0 3 3h15ZM1.5 10.146V6a3 3 0 0 1 3-3h5.379a2.25 2.25 0 0 1 1.59.659l2.122 2.121c.14.141.331.22.53.22H19.5a3 3 0 0 1 3 3v1.146A4.483 4.483 0 0 0 19.5 9h-15a4.483 4.483 0 0 0-3 1.146Z"/></svg>
                    <span class="prim-add-folder-plus">+</span>
                  </button>
                  <button class="prim-add" type="button" title={`New primitive in ${fam.label}`} aria-label="Add primitive" onclick={(e) => openTypedCreate(`completions/${fam.id}`, fam.label, e)}>＋</button>
                </div>
                {#if openFamilies[fam.id]}
                  {#if allParts.length === 0 && subs.length === 0}
                    <div class="prim-empty">empty</div>
                  {/if}
                  <!-- Parts at the family root (no subfolder). -->
                  {#each rootParts as e (e.id)}
                    <div class="prim-row-wrap" class:active={activeId === e.id} class:open={openTabs.some((t) => t.entry.id === e.id)}>
                      {#if e.editable}{@render trashBtn(e.id)}{/if}
                      <button class="prim-row" type="button" draggable={true} ondragstart={(ev) => ev.dataTransfer?.setData('application/x-primitive-id', e.id)} onclick={() => openTab(e)}>
                        <span class="prim-name">{e.id}</span>
                        <span class="prim-tag vol">vol</span>
                      </button>
                      <button class="prim-dup" type="button" title="Duplicate to a new volume primitive" aria-label="Duplicate" onclick={() => cloneEntry(e)}>⎘</button>
                  {#if e.editable}{@render renameBtn(e.id)}{/if}
                      {@render moveBtn(e.id, `completions/${fam.id}`)}
                    </div>
                  {/each}
                  <!-- Subfolders (drill_pipe/tests/, …) as nested folds. -->
                  {#each subs as sub (sub)}
                    {@const subParts = allParts.filter((e) => e.subfolder === sub)}
                    {@const subKey = `${fam.id}/${sub}`}
                    <div class="prim-subfolder">
                      <div class="prim-head-row">
                        <button class="prim-sub-head" type="button" onclick={() => (openSubfolders[subKey] = !openSubfolders[subKey])}>
                          {@render folderIcon(openSubfolders[subKey])}
                          {sub} {#if subParts.length}({subParts.length}){/if}
                        </button>
                        <button class="prim-add" type="button" title={`New primitive in ${fam.label} / ${sub}`} aria-label="Add primitive" onclick={(e) => openTypedCreate(`completions/${fam.id}/${sub}`, `${fam.label} / ${sub}`, e)}>＋</button>
                      </div>
                      {#if openSubfolders[subKey]}
                        {#if subParts.length === 0}
                          <div class="prim-empty prim-fam-empty">empty</div>
                        {:else}
                          {#each subParts as e (e.id)}
                            <div class="prim-row-wrap prim-fam-row" class:active={activeId === e.id} class:open={openTabs.some((t) => t.entry.id === e.id)}>
                              {#if e.editable}{@render trashBtn(e.id)}{/if}
                              <button class="prim-row" type="button" draggable={true} ondragstart={(ev) => ev.dataTransfer?.setData('application/x-primitive-id', e.id)} onclick={() => openTab(e)}>
                                <span class="prim-name">{e.id}</span>
                                <span class="prim-tag vol">vol</span>
                              </button>
                              <button class="prim-dup" type="button" title="Duplicate to a new volume primitive" aria-label="Duplicate" onclick={() => cloneEntry(e)}>⎘</button>
                  {#if e.editable}{@render renameBtn(e.id)}{/if}
                              {@render moveBtn(e.id, `completions/${fam.id}/${sub}`)}
                            </div>
                          {/each}
                        {/if}
                      {/if}
                    </div>
                  {/each}
                {/if}
              </div>
            {/each}
          {/if}

        {:else if section === 'archive'}
          <!-- Archive — always shows, empty state when no archived parts. -->
          <div class="prim-archive prim-archive-tab">
            {#if archived.length === 0}
              <div class="prim-empty">no archived parts</div>
            {:else}
              <!-- Bulk select bar: select-all checkbox + per-row checkboxes
                   + 'Delete N permanently' button. The button is only enabled
                   when at least one row is checked. -->
              <div class="prim-arch-bar">
                <label class="prim-arch-allcheck" title="Select / deselect all">
                  <input type="checkbox" checked={archiveAllSelected} indeterminate={archiveSelected.size > 0 && !archiveAllSelected} onchange={() => archiveAllSelected ? clearArchiveSelection() : selectAllArchive()} />
                  <span>{archiveAllSelected ? 'all' : archiveSelected.size > 0 ? `${archiveSelected.size} selected` : 'select all'}</span>
                </label>
                <button class="prim-arch-purge" type="button" disabled={archiveSelected.size === 0} onclick={purgeSelected} title="Delete selected — PERMANENTLY">
                  delete{archiveSelected.size > 0 ? ` ${archiveSelected.size}` : ''} ×
                </button>
              </div>
              <div class="prim-arch-list">
                {#each archived as a (a.id)}
                  <div class="prim-row-wrap prim-row-arch" class:selected={archiveSelected.has(a.id)}>
                    <input class="prim-arch-check" type="checkbox" checked={archiveSelected.has(a.id)} onchange={() => toggleArchiveSelect(a.id)} aria-label={`Select ${a.id}`} />
                    <span class="prim-name prim-name-arch" title={a.description}>{a.id}</span>
                    <button class="prim-mini" type="button" title="Restore to active" onclick={() => restoreById(a.id)}>↶</button>
                    <button class="prim-mini prim-mini-danger" type="button" title="Permanent delete" onclick={() => purgeById(a.id)}>×</button>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
      </div>
    </div>

    {#if status}<div class="status">{status}</div>{/if}
  </aside>

  {#if railCollapsed}
    <button class="prim-rail-expand" type="button" title="Show sidebar" onclick={() => railCollapsed = false}>»</button>
  {/if}

  <main class="prim-main">
    {#if openTabs.length === 0}
      <div class="placeholder">Click a primitive to open it in a tab.</div>
    {:else}
      <div class="prim-tabstrip" role="tablist">
        {#each openTabs as t (t.entry.id)}
          <button
            class="prim-tabchip"
            class:active={activeId === t.entry.id}
            type="button"
            role="tab"
            onclick={() => (activeId = t.entry.id)}
          >
            <span class="prim-tabchip-name">{t.entry.id}</span>
            <span
              class="prim-tabchip-x"
              role="button"
              tabindex="0"
              aria-label={`Close ${t.entry.id}`}
              onclick={(e) => closeTab(t.entry.id, e)}
              onkeydown={(e) => { if (e.key === 'Enter') closeTab(t.entry.id, e); }}
            >×</span>
          </button>
        {/each}
      </div>

      <!-- Every open tab's view stays MOUNTED; only the active one is
           shown (display:none on the rest). So switching tabs keeps each
           primitive rendered/loaded — no refetch, no remount. -->
      <div class="prim-tabviews">
        {#each openTabs as t (t.entry.id)}
          <div class="prim-tabview" class:hidden={activeId !== t.entry.id}>
            {#if t.loading}
              <div class="prim-loading">Loading <code>{t.entry.id}</code>…</div>
            {:else}
              <PrimitiveView
                id={t.entry.id}
                name={t.entry.name}
                description={t.entry.description}
                kind={t.kind}
                paramSchema={t.entry.params}
                profileSchema={t.entry.profiles ?? {}}
                editable={t.entry.editable}
                initialSource={t.serverSource}
                serverSource={t.serverSource}
                onSaveSource={(s) => saveSourceFor(t, s)}
                onSaveDefaults={(a) => saveDefaultsFor(t, a)}
                onSaveAs={(newId, src) => saveAsEntry(t.entry.id, newId, src)}
                onReloadSource={() => loadFromServerFor(t)}
                onDuplicate={() => cloneEntry(t.entry)}
                onDelete={t.entry.editable ? () => archiveById(t.entry.id) : undefined}
                catalog={[...entries, ...stdlib, ...basic, ...Object.values(completions).flat()]}
              />
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </main>
</div>

{#if typedCreate}
  <FloatingPanel title={`New part · ${typedCreate.label}`} visible={true} x={typedCreate.x} y={typedCreate.y} width="340px" maxHeight="75vh" onClose={closeTypedCreate}>
    <div class="tc-pop">
      {#if typedCreate.step === 'type'}
        <p class="tc-q">What kind of part?</p>
        <div class="tc-types">
          <button class="tc-type" type="button" onclick={() => { typedCreate!.kind = 'exp'; typedCreate!.step = 'template'; }}>
            <span class="tc-type-ic">⊞</span>
            <span class="tc-type-lbl">Extrude Part</span>
            <span class="tc-type-sub">Inline (x,y) profile · r_weld_extrude</span>
          </button>
          <button class="tc-type" type="button" onclick={() => { typedCreate!.kind = 'rev'; typedCreate!.step = 'template'; }}>
            <span class="tc-type-ic">◯</span>
            <span class="tc-type-lbl">Profile Part</span>
            <span class="tc-type-sub">Inline (r,z) half-section · r_revolve</span>
          </button>
          <button class="tc-type" type="button" onclick={() => { typedCreate!.kind = 'asm'; typedCreate!.step = 'name'; }}>
            <span class="tc-type-ic">⛓</span>
            <span class="tc-type-lbl">Assembly</span>
            <span class="tc-type-sub">Compose other r_* parts</span>
          </button>
        </div>
      {:else if typedCreate.step === 'template'}
        <div class="tc-step-head">
          <button class="tc-back" type="button" onclick={() => { typedCreate!.step = 'type'; }}>← back</button>
          <span class="tc-q">Pick a template</span>
        </div>
        <div class="tc-grid">
          {#each templatesForKind(typedCreate.kind!) as t (t.id)}
            <button class="tc-card" type="button"
              onclick={() => { typedCreate!.templateId = t.id; typedCreate!.step = 'name'; }}>
              <span class="tc-card-lbl">{t.label}</span>
              <span class="tc-card-id">{t.id}</span>
            </button>
          {/each}
        </div>
      {:else}
        <div class="tc-step-head">
          <button class="tc-back" type="button" onclick={() => { typedCreate!.step = typedCreate!.kind === 'asm' ? 'type' : 'template'; }}>← back</button>
          <span class="tc-q">Name your part</span>
        </div>
        <div class="tc-name">
          <input bind:value={typedCreate.id} placeholder="e.g. my_hex_nut" spellcheck="false" autofocus
            onkeydown={(e) => { if (e.key === 'Enter' && typedCreate!.id.trim() && !typedCreate!.busy) submitTypedCreate(); }} />
          <button class="tc-create" type="button" disabled={typedCreate.busy || !typedCreate.id.trim()} onclick={() => submitTypedCreate()}>
            {typedCreate.busy ? '…' : 'Create'}
          </button>
        </div>
        <div class="tc-summary">
          {typedCreate.kind === 'exp' ? 'Extrude Part' : typedCreate.kind === 'rev' ? 'Profile Part' : 'Assembly'}
          {typedCreate.templateId ? ` · ${typedCreate.templateId}` : ''}
        </div>
        {#if typedCreate.err}<div class="tc-err">{typedCreate.err}</div>{/if}
      {/if}
    </div>
  </FloatingPanel>
{/if}

{#if createPanel}
  <FloatingPanel title={`New primitive · ${createPanel.label}`} visible={true} x={createPanel.x} y={createPanel.y} width="300px" maxHeight="70vh" onClose={closeCreate}>
    <div class="prim-create">
      <label class="prim-create-row">id
        <input bind:value={createId} placeholder="e.g. dp_pin" spellcheck="false" autofocus
          onkeydown={(e) => { if (e.key === 'Enter' && createId.trim() && !createBusy) submitCreate(); }} />
      </label>
      <div class="prim-create-base">
        <div class="prim-create-baselabel">start from <code>{baseLabel(createBase)}</code></div>
        <input class="prim-create-search" bind:value={createSearch} placeholder="search r_*…" spellcheck="false" />
        <div class="prim-create-list">
          {#each createBaseList as b (b)}
            <button class="prim-create-opt" class:sel={b === createBase} type="button" onclick={() => (createBase = b)}>{baseLabel(b)}</button>
          {/each}
          {#if createBaseList.length === 0}<div class="prim-create-empty">no base matches</div>{/if}
        </div>
      </div>
      {#if createErr}<div class="prim-create-err">{createErr}</div>{/if}
      <div class="prim-create-note">→ <code>primitives/{createPanel.dir}/</code></div>
      <div class="prim-create-foot">
        <div style="flex:1;"></div>
        <button class="prim-mini-btn" type="button" onclick={closeCreate}>Cancel</button>
        <button class="prim-mini-btn primary" type="button" disabled={createBusy || !createId.trim()} onclick={submitCreate}>{createBusy ? '…' : 'Create'}</button>
      </div>
    </div>
  </FloatingPanel>
{/if}

{#if movePanel}
  <FloatingPanel title={`Move "${movePanel.id}" to…`} visible={true} x={movePanel.x} y={movePanel.y} width="220px" maxHeight="60vh" onClose={closeMove}>
    <div class="prim-move-menu">
      {#each moveTargets as t (t.to)}
        <button class="prim-move-opt" type="button" disabled={moveBusy} onclick={() => moveTo(t.to)}>
          {@render folderIcon(false)}
          <span>{t.label}</span>
        </button>
      {/each}
      {#if moveTargets.length === 0}<div class="prim-create-empty">nowhere else to move it</div>{/if}
    </div>
  </FloatingPanel>
{/if}

{#if mkdirPanel}
  <FloatingPanel title={`New folder in ${mkdirPanel.label}`} visible={true} x={mkdirPanel.x} y={mkdirPanel.y} width="260px" maxHeight="50vh" onClose={closeMkdir}>
    <div class="prim-create">
      <label class="prim-create-row">name
        <input bind:value={mkdirName} placeholder="e.g. tests" spellcheck="false" autofocus
          onkeydown={(e) => { if (e.key === 'Enter' && mkdirName.trim() && !mkdirBusy) submitMkdir(); }} />
      </label>
      {#if mkdirErr}<div class="prim-create-err">{mkdirErr}</div>{/if}
      <div class="prim-create-note">→ <code>primitives/completions/{mkdirPanel.family}/{mkdirName || '<name>'}/</code></div>
      <div class="prim-create-foot">
        <div style="flex:1;"></div>
        <button class="prim-mini-btn" type="button" onclick={closeMkdir}>Cancel</button>
        <button class="prim-mini-btn primary" type="button" disabled={mkdirBusy || !mkdirName.trim()} onclick={submitMkdir}>{mkdirBusy ? '…' : 'Create'}</button>
      </div>
    </div>
  </FloatingPanel>
{/if}

<style>
  .prim-page { display: grid; grid-template-columns: 240px 1fr; height: 100%; min-height: 0; font: 13px Arial; color: #222; position: relative; }
  .prim-page.rail-collapsed { grid-template-columns: 0 1fr; }
  .prim-page.rail-collapsed .prim-rail { display: none; }
  /* Rail OWNS layout but the TABPANEL scrolls (so the vrail stays fixed). */
  .prim-rail { border-right: 1px solid #ddd; background: #fafafa; overflow: hidden; padding: 4px 3px 0; display: flex; flex-direction: column; line-height: 1.15; min-height: 0; }
  /* Vertical section tabs — editor format (trapezoidal, vertical-text), tight rail. */
  .prim-tabs { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: 24px 1fr; margin: 6px -6px 0; border-top: 1px solid #e5e5e5; }
  .prim-vrail { display: flex; flex-direction: column; gap: 2px; padding: 6px 0; border-right: 1px solid #e5e5e5; background: #ececec; align-items: stretch; }
  .prim-vtab { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px; padding: 12px 0; border: 0; background: transparent; color: #444; cursor: pointer; clip-path: polygon(0 14%, 100% 0, 100% 100%, 0 86%); font: inherit; line-height: 1; }
  .prim-vtab:hover { color: #cc2222; background: #e2e2e2; }
  .prim-vtab.active { color: #cc2222; background: #fafafa; }
  .prim-vtab-ic { font-size: 12px; opacity: 0.95; line-height: 1; }
  .prim-vtab-lbl { writing-mode: vertical-rl; transform: rotate(180deg); font: 700 11px Arial; letter-spacing: 1.2px; line-height: 1; white-space: nowrap; }
  .prim-tabpanel { overflow-y: auto; padding: 2px 3px 6px; min-width: 0; }
  .prim-tabpanel > .prim-tests:first-of-type { margin-top: 4px; border-top: 0; padding-top: 0; }
  /* Drag handle straddling the rail/main boundary (rail is overflow:auto, so
     the handle lives on .prim-page which is position:relative). */
  .prim-rail-resize { position: absolute; top: 0; bottom: 0; width: 7px; margin-left: -3px; z-index: 20; cursor: col-resize; }
  .prim-rail-resize::after { content: ''; position: absolute; top: 0; bottom: 0; left: 3px; width: 1px; background: transparent; }
  .prim-rail-resize:hover::after, .prim-page.rail-resizing .prim-rail-resize::after { background: #2266cc; width: 2px; left: 2px; }
  .prim-page.rail-resizing { cursor: col-resize; user-select: none; }
  .prim-rail header { padding: 0 3px 3px; border-bottom: 1px solid #eee; position: relative; }
  .prim-rail-toggle { position: absolute; top: -2px; right: 0; border: none; background: transparent; color: #999; font-size: 16px; line-height: 1; cursor: pointer; padding: 2px 4px; }
  .prim-rail-toggle:hover { color: #cc2222; }
  .prim-rail-expand { position: absolute; top: 8px; left: 8px; z-index: 20; border: 1px solid #ddd; background: #fff; color: #555; font-size: 14px; line-height: 1; cursor: pointer; padding: 5px 9px; border-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.12); }
  .prim-rail-expand:hover { color: #cc2222; border-color: #cc2222; }
  .prim-rail h2 { margin: 0; font: 700 14px Arial; color: #cc2222; }
  .prim-rail .sub { margin: 2px 0 0; font: 11px Arial; color: #777; }
  .prim-profiles-link { display: inline-block; margin-top: 6px; font: 600 11px Arial; color: #c4392f; text-decoration: none; }
  .prim-profiles-link:hover { text-decoration: underline; }
  .prim-list { padding: 2px 0; flex: 1; }
  .prim-row-wrap { display: flex; align-items: center; gap: 2px; margin: 0; border-radius: 4px; position: relative; }
  /* Editable rows reserve a TIGHT left gutter for the absolute-positioned
     trash. 14px = 12px icon + 2px breathing — filename sits as close to the
     trash as possible without overlapping. Non-editable rows (stdlib, archive)
     have no trash → no gutter → filename stays at its current x. */
  .prim-row-wrap:has(.prim-trash) { padding-left: 14px; }
  .prim-row-wrap:hover { background: #f0e8e8; }
  .prim-row-wrap.active { background: #fef0f0; }
  .prim-row-wrap.active .prim-name { color: #cc2222; }
  .prim-row-wrap.open .prim-name { font-weight: 800; }  /* open in a tab */
  .prim-row { display: flex; align-items: center; gap: 6px; flex: 1; padding: 2px 6px; background: transparent; border: 0; border-radius: 4px; text-align: left; cursor: pointer; font: inherit; color: inherit; line-height: 1.25; }
  /* Trash button — absolute-positioned in the left gutter so the row's other
     content keeps its layout (the gutter is created above on editable rows
     only). ALWAYS VISIBLE (not hover-revealed); muted #999 idle → red-on-hover.
     SVG trash icon (Heroicons style). */
  .prim-trash {
    position: absolute; left: 0; top: 50%; transform: translateY(-50%);
    background: transparent; border: 0; padding: 0;
    color: #999; cursor: pointer; border-radius: 3px;
    display: inline-flex; align-items: center; justify-content: center;
    line-height: 1;
  }
  .prim-trash:hover { color: #cc2222; background: #fff; }
  .prim-trash svg { width: 12px; height: 12px; }
  .prim-dup { background: transparent; border: 0; padding: 2px 6px; color: #aaa; cursor: pointer; font: 12px monospace; border-radius: 3px; }
  .prim-dup:hover { color: #2266cc; background: #fff; }
  .prim-move { background: transparent; border: 0; padding: 2px 5px; color: #aaa; cursor: pointer; border-radius: 3px; display: inline-flex; align-items: center; }
  .prim-move svg { width: 13px; height: 13px; }
  .prim-move:hover { color: #e0a93b; background: #fff; }
  .prim-rename { background: transparent; border: 0; padding: 2px 5px; color: #aaa; cursor: pointer; border-radius: 3px; display: inline-flex; align-items: center; }
  .prim-rename svg { width: 12px; height: 12px; }
  .prim-rename:hover { color: #2266cc; background: #fff; }
  /* Move-to-folder picker menu (FloatingPanel body). */
  .prim-move-menu { display: flex; flex-direction: column; gap: 2px; padding: 2px; }
  .prim-move-opt { display: flex; align-items: center; gap: 7px; width: 100%; text-align: left; padding: 6px 8px; background: transparent; border: 0; border-radius: 4px; cursor: pointer; font: 600 12px Arial; color: #333; }
  .prim-move-opt svg { width: 14px; height: 14px; color: #e0a93b; flex: 0 0 auto; }
  .prim-move-opt:hover { background: #f0f4fb; color: #1a4fa0; }
  .prim-move-opt:disabled { opacity: 0.5; cursor: default; }

  .prim-tests { margin-top: 6px; border-top: 1px solid #eee; padding-top: 3px; }
  .prim-empty { padding: 1px 8px 3px; font: italic 11px Arial; color: #bbb; }

  /* Completions → family sub-folders (one level deeper than the flat
     groups). Caret + label indented; parts indented again. */
  .prim-fam { margin-left: 6px; }
  .prim-fam-head { background: transparent; border: 0; width: 100%; text-align: left; padding: 2px 8px; font: 700 13px Arial; color: #1a1a1a; cursor: pointer; display: flex; align-items: center; gap: 6px; border-radius: 3px; -webkit-font-smoothing: antialiased; }
  /* Folder header row: the collapse toggle (flex:1) + an "＋ add" button that
     creates a new primitive in that folder. */
  .prim-head-row { display: flex; align-items: center; }
  .prim-head-row > button:first-child { flex: 1; min-width: 0; }
  .prim-add { flex: 0 0 auto; background: transparent; border: 0; color: #bbb; font: 700 14px Arial; cursor: pointer; padding: 0 8px; line-height: 1; border-radius: 3px; }
  .prim-add:hover { color: #2266cc; background: #eef3fb; }
  /* "📁+" — new-folder button next to the new-primitive ＋. Amber on hover. */
  .prim-add-folder { padding: 0 5px; display: inline-flex; align-items: center; gap: 1px; position: relative; }
  .prim-add-folder svg { width: 13px; height: 13px; color: #bbb; }
  .prim-add-folder .prim-add-folder-plus { font: 700 11px Arial; color: #bbb; line-height: 1; }
  .prim-add-folder:hover svg, .prim-add-folder:hover .prim-add-folder-plus { color: #e0a93b; }
  .prim-add-folder:hover { background: #fdf6e3; }
  /* Subfolder fold inside a family (e.g. drill_pipe/tests/). Indented one
     step under the family root parts; head reads slightly smaller than the
     family title. */
  /* Subfolder + family rows: drop the per-level margin-left now that the
     trash gutter handles the visible offset. Keeps rows aligned with the
     folder header instead of pushed further right on every nesting level. */
  .prim-subfolder { margin-left: 0; }
  .prim-sub-head { background: transparent; border: 0; width: 100%; text-align: left; padding: 2px 8px; font: 600 12px Arial; color: #333; cursor: pointer; display: flex; align-items: center; gap: 6px; border-radius: 3px; }
  .prim-sub-head:hover { background: #f0f0f0; color: #000; }
  /* New-primitive popup (FloatingPanel — replaces the native prompt). */
  .prim-create { display: flex; flex-direction: column; gap: 8px; padding: 2px; }
  /* Typed-create picker — 3 stacked steps inside a FloatingPanel. */
  .tc-pop { display: flex; flex-direction: column; gap: 10px; padding: 4px 2px; }
  .tc-q { margin: 0; font: 600 12px Arial; color: #444; }
  .tc-step-head { display: flex; align-items: center; gap: 10px; }
  .tc-back { font: 10px Arial; color: #c4392f; background: transparent; border: 0; cursor: pointer; padding: 2px 4px; border-radius: 3px; }
  .tc-back:hover { background: #fceeec; }
  /* Type chooser — 3 big cards stacked. */
  .tc-types { display: flex; flex-direction: column; gap: 6px; }
  .tc-type { display: grid; grid-template-columns: 30px 1fr; grid-template-rows: auto auto; gap: 1px 10px; align-items: center; padding: 8px 12px; border: 1px solid #e3c4bf; background: #fbf4f3; border-radius: 6px; cursor: pointer; text-align: left; }
  .tc-type:hover { background: #fceeec; border-color: #c4392f; }
  .tc-type-ic { grid-row: 1 / 3; font: 22px monospace; color: #c4392f; text-align: center; }
  .tc-type-lbl { font: 700 13px Arial; color: #222; }
  .tc-type-sub { font: 10px Arial; color: #888; }
  /* Template grid — small cards, 2 per row. */
  .tc-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .tc-card { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border: 1px solid #e0e0e0; background: #fff; border-radius: 5px; cursor: pointer; text-align: left; }
  .tc-card:hover { background: #fceeec; border-color: #c4392f; }
  .tc-card-lbl { font: 600 12px Arial; color: #333; }
  .tc-card-id { font: 9px ui-monospace, Menlo, monospace; color: #999; }
  /* Name step. */
  .tc-name { display: flex; gap: 6px; align-items: center; }
  .tc-name input { flex: 1; min-width: 0; font: 12px ui-monospace, Menlo, monospace; padding: 5px 8px; border: 1px solid #d4d4dc; border-radius: 4px; }
  .tc-name input:focus { outline: none; border-color: #c4392f; }
  .tc-create { font: 700 11px Arial; padding: 5px 12px; background: #c4392f; color: #fff; border: 0; border-radius: 4px; cursor: pointer; }
  .tc-create:hover:not(:disabled) { background: #b23329; }
  .tc-create:disabled { opacity: 0.5; cursor: not-allowed; }
  .tc-summary { font: 10px Arial; color: #888; padding-left: 2px; }
  .tc-err { font: 11px Arial; color: #c4392f; }

  .prim-create-row { display: flex; align-items: center; gap: 8px; font: 11px Arial; color: #555; }
  .prim-create-row input { flex: 1; min-width: 0; font: 12px ui-monospace, monospace; padding: 4px 6px; border: 1px solid #d4d4dc; border-radius: 4px; }
  .prim-create-base { display: flex; flex-direction: column; gap: 4px; }
  .prim-create-baselabel { font: 11px Arial; color: #555; }
  .prim-create-baselabel code { font: 11px ui-monospace, monospace; color: #cc2222; }
  .prim-create-search { font: 11px Arial; padding: 3px 6px; border: 1px solid #d4d4dc; border-radius: 4px; }
  .prim-create-list { display: flex; flex-wrap: wrap; gap: 4px; max-height: 132px; overflow-y: auto; padding: 2px; border: 1px solid #eee; border-radius: 5px; }
  .prim-create-opt { font: 11px ui-monospace, monospace; padding: 2px 7px; border: 1px solid #ddd; border-radius: 4px; background: #fff; cursor: pointer; color: #444; }
  .prim-create-opt:hover { border-color: #2266cc; background: #f5f8fe; }
  .prim-create-opt.sel { border-color: #2266cc; background: #2266cc; color: #fff; }
  .prim-create-empty { font: 11px Arial; color: #999; padding: 6px; }
  .prim-create-foot { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .prim-create-note { font: 10px Arial; color: #999; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .prim-create-note code { font: 10px ui-monospace, monospace; color: #888; }
  .prim-create-err { font: 10px Arial; color: #c0392b; }
  .prim-mini-btn { padding: 3px 10px; border: 1px solid #ccc; border-radius: 4px; background: #fff; font: 11px Arial; cursor: pointer; }
  .prim-mini-btn.primary { background: #2266cc; border-color: #2266cc; color: #fff; }
  .prim-mini-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .prim-fam-head:hover { background: #f0f0f0; color: #000; }
  .prim-fam-empty { margin-left: 4px; }
  .prim-fam-row { margin-left: 0; }

  .prim-archive { margin-top: 6px; border-top: 1px solid #eee; padding-top: 3px; }
  .prim-arch-head { background: transparent; border: 0; width: 100%; text-align: left; padding: 3px 8px; font: 700 14px Arial; color: #1a1a1a; cursor: pointer; display: flex; align-items: center; gap: 6px; border-radius: 3px; -webkit-font-smoothing: antialiased; }
  .prim-arch-head:hover { background: #f0f0f0; color: #000; }
  /* Folder glyph — amber so the groups read as folders (file-manager look). */
  .prim-folder-ico { width: 13px; height: 13px; flex: 0 0 auto; color: #e0a93b; display: inline-block; vertical-align: middle; }
  .prim-arch-list { padding: 1px 0; }
  .prim-row-arch { padding: 2px 8px; gap: 4px; align-items: center; display: flex; }
  .prim-row-arch:hover { background: #f5f5f5; }
  .prim-name-arch { flex: 1; font: 11px monospace; color: #888; }
  .prim-mini { background: transparent; border: 1px solid #ddd; border-radius: 3px; padding: 2px 6px; font: 11px monospace; color: #888; cursor: pointer; }
  .prim-mini:hover { color: #2266cc; border-color: #2266cc; background: #fff; }
  .prim-mini-danger:hover { color: #cc2222; border-color: #cc2222; }
  /* Archive bulk-select bar — top of the archive list. select-all checkbox on
     the left, 'delete N' button (red, disabled when nothing selected) on the
     right. */
  .prim-arch-bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px 8px 6px; border-bottom: 1px solid #eee; margin-bottom: 4px; }
  .prim-arch-allcheck { display: inline-flex; align-items: center; gap: 5px; font: 600 10px Arial; color: #666; text-transform: uppercase; letter-spacing: 0.04em; cursor: pointer; }
  .prim-arch-allcheck input { cursor: pointer; }
  .prim-arch-purge { font: 700 10px Arial; text-transform: uppercase; letter-spacing: 0.04em; padding: 3px 9px; border: 1px solid #e0bebb; background: #fff; color: #c4392f; border-radius: 4px; cursor: pointer; }
  .prim-arch-purge:hover:not(:disabled) { background: #c4392f; color: #fff; border-color: #c4392f; }
  .prim-arch-purge:disabled { opacity: 0.4; cursor: not-allowed; }
  /* Per-row checkbox sits inline before the name; selected rows get a faint
     pink background so the chosen set reads at a glance. */
  .prim-row-wrap.prim-row-arch.selected { background: #fdecea; }
  .prim-arch-check { margin: 0 4px 0 2px; cursor: pointer; }
  .prim-name { font: 600 11px monospace; flex: 1; }
  .prim-tag { font: 9px Arial; padding: 1px 5px; border-radius: 8px; background: #ddd; color: #555; }
  .prim-tag.vol { background: #cc2222; color: #fff; }
  .prim-tag.src { background: #2b6cb0; color: #fff; }
  /* stdstale entries — yellow chip so the deprecation signal carries
     visually even when scanning the sidebar quickly. */
  .prim-tag.stale { background: #fbbf24; color: #78350f; }
  .prim-stdstale .prim-arch-head { color: #92400e; }
  .status { font: 10px Arial; color: #777; padding: 6px 8px; border-top: 1px solid #eee; }

  .prim-main { display: flex; flex-direction: column; min-height: 0; overflow: hidden; }

  /* Tab strip — like /components: open primitives as tabs, click to focus,
     × to close. */
  .prim-tabstrip { display: flex; gap: 2px; padding: 5px 6px 0; background: #fafafa; border-bottom: 1px solid #ddd; overflow-x: auto; flex-shrink: 0; }
  .prim-tabchip { display: flex; align-items: center; gap: 6px; padding: 5px 6px 5px 10px; font: 12px monospace; color: #666; background: #f0f0f0; border: 1px solid #ddd; border-bottom: none; border-radius: 5px 5px 0 0; cursor: pointer; white-space: nowrap; max-width: 190px; }
  .prim-tabchip:hover { color: #cc2222; }
  .prim-tabchip.active { background: #fff; color: #cc2222; border-color: #cc2222; margin-bottom: -1px; font-weight: 600; }
  .prim-tabchip-name { overflow: hidden; text-overflow: ellipsis; }
  .prim-tabchip-x { display: inline-flex; width: 15px; height: 15px; align-items: center; justify-content: center; border-radius: 3px; color: #aaa; font: 13px Arial; flex-shrink: 0; }
  .prim-tabchip-x:hover { background: #fdeceb; color: #c4392f; }
  /* Views: every open tab stays mounted; only the active is shown so the
     mesh + edits persist across tab switches (kept LOADED). */
  .prim-tabviews { flex: 1; min-height: 0; position: relative; }
  .prim-tabview { position: absolute; inset: 0; display: flex; flex-direction: column; min-height: 0; }
  .prim-tabview.hidden { display: none; }
  .prim-loading { flex: 1; display: flex; align-items: center; justify-content: center; color: #999; font: 12px Arial; }
  .prim-loading code { font: 12px monospace; color: #cc2222; background: #f6f6f8; padding: 1px 6px; border-radius: 3px; margin: 0 4px; }


  .placeholder { flex: 1; display: flex; align-items: center; justify-content: center; color: #777; }
</style>
