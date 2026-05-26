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
  import { PROFILE_REGISTRY } from '$lib/shared/profile-presets';
  import { stubSource, buildPartStubFromBase, buildRevolveStubFromProfile } from '$lib/cad/primitive-stub';

  interface Entry {
    id: string;
    source: 'bundle' | 'volume';
    name: string;
    description: string;
    params: Record<string, any>;
    /** Encapsulated profile defaults (meta.profiles) — the Svelte-component
     *  model. Profiles live here, NOT in params/signature, so compositions
     *  stay clean. Loaded lazily with the source. */
    profiles?: Record<string, any>;
    editable: boolean;
  }

  let entries: Entry[] = $state([]);
  // Basic — the raw r_* geometry primitives, parked under primitives/basic/
  // on the volume (location IS the category, mirroring Industrial).
  let basic: Entry[] = $state([]);
  let industrial: Entry[] = $state([]);
  // Completions is nested by family: { <family>: Entry[] }. Family dirs
  // may be empty (structure only); the sidebar shows them regardless so
  // the user sees where each family's parts will land.
  let completions: Record<string, Entry[]> = $state({});
  let archived: Entry[] = $state([]);

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
  type Tab = { entry: Entry; serverSource: string; loading: boolean };
  let openTabs: Tab[] = $state([]);
  let activeId: string | null = $state(null);
  let activeTab = $derived(openTabs.find((t) => t.entry.id === activeId) ?? null);
  let status = $state('');
  let showArchive = $state(false);
  let showBasic = $state(true);
  let showIndustrial = $state(false);
  let showCompletions = $state(true);
  // Per-family collapse state inside Completions, keyed by family id.
  let openFamilies: Record<string, boolean> = $state({});

  async function refreshList() {
    try {
      const r = await fetch('/api/primitives/list');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      entries = data.merged ?? [];
      basic = data.basic ?? [];
      industrial = data.industrial ?? [];
      completions = data.completions ?? {};
      archived = data.archived ?? [];
      status = '';
    } catch (e: any) {
      // Volume proxy unreachable (e.g. ISP DNS-blocks the prod host) — degrade
      // gracefully instead of leaving `entries` undefined and crashing onMount.
      entries = []; basic = []; industrial = []; completions = {}; archived = [];
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
        return { ...t, entry, serverSource: data?.source ?? '', loading: false };
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
    void loadVolProfiles();
    // Default-open the first VOLUME primitive (bundle ones can 500 on
    // source-load). The raw r_* primitives now live in the Basic group, so
    // prefer those, then any root-volume entry, then the first entry.
    const initial = basic?.[0] ?? entries?.find((e) => e.source === 'volume') ?? entries?.[0];
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
    openTabs = openTabs.map((t) => t.entry.id === tab.entry.id ? { ...t, serverSource: newSource } : t);
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
    const r = await fetch('/api/primitives/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: newId, source: src }),
    });
    if (!r.ok) { status = `Clone failed: ${await r.text()}`; return; }
    status = `Duplicated ${e.id} → ${newId}.`;
    await refreshList();
    const created = entries.find((x) => x.id === newId);
    if (created) openTab(created);
  }

  function cloneToVolume() {
    if (activeTab) cloneEntry(activeTab.entry);
  }


  /** Create a NEW primitive inside a group folder (the sidebar "+" affordance).
   *  Writes a stub to primitives/<dir>/<id>/, opens the folder, refreshes, and
   *  opens the new part for editing. dir ∈ basic | industrial | completions/<family>. */
  // ── New-primitive popup (FloatingPanel — automatable, no native prompt) ──
  // Name + a searchable "start from" picker of r_* base primitives. The new
  // part is a composite that wraps the chosen r_* (meta.uses + a call), so it
  // follows the r_* authoring model (never raw cyl/tube).
  let createPanel = $state<{ dir: string; label: string; x: number; y: number } | null>(null);
  let createId = $state('');
  let createBase = $state('r_cylinder');
  let createSearch = $state('');
  let createBusy = $state(false);
  let createErr = $state('');
  // Volume function profiles (primitives/profiles/<id>/) — fetched for the create
  // picker so a part can be born from a USER-authored/forked profile, resolved at
  // bake by P6. Refreshed when the popup opens (picks up just-forked ones).
  let volProfiles = $state<any[]>([]);
  async function loadVolProfiles() {
    try { const r = await fetch('/api/primitives/profiles/list'); if (r.ok) volProfiles = (await r.json())?.profiles ?? []; }
    catch { /* offline — curated profiles still work */ }
  }
  function profileDef(kind: string): any { return PROFILE_REGISTRY[kind] ?? volProfiles.find((v) => v.id === kind); }
  // Base options = the r_* leaves (Basic) + REVOLVE profile FUNCTIONS — curated
  // (PROFILE_REGISTRY) AND volume ƒ — as `profile:<id>`. Picking a profile
  // scaffolds a parametric revolve part whose params ARE the profile's params,
  // lifted (K.22 E); volume kinds resolve at bake via P6 (function-first loop).
  // The polygon-param leaves (r_revolve/r_extrude) take a raw [[x,y],…] profile —
  // the OLD "hardcoded vertices" way. They're excluded from the base picker so a
  // revolve/extrude part is ALWAYS born from a profile FUNCTION (the `◆ profile`
  // options → resolveProfile + lifted params), per the function-first philosophy
  // (docs/plans/profiles-directory.md: "never hardcoded points").
  const POLYGON_LEAF_BASES = new Set(['r_revolve', 'r_extrude']);
  let createBaseList = $derived.by(() => {
    const q = createSearch.trim().toLowerCase();
    const rs = [...new Set(basic.map((b) => b.id).filter((id) => id.startsWith('r_') && !POLYGON_LEAF_BASES.has(id)))].sort();
    const cur = Object.values(PROFILE_REGISTRY).filter((d) => d.set === 'revolve').map((d) => d.id);
    const vol = volProfiles.filter((v) => v.set === 'revolve' && v.hasSource).map((v) => v.id);
    const profs = [...new Set([...cur, ...vol])].map((id) => `profile:${id}`);
    const all = [...rs, ...profs];
    return q ? all.filter((b) => b.toLowerCase().includes(q) || baseLabel(b).toLowerCase().includes(q)) : all;
  });
  function baseLabel(b: string): string {
    if (b.startsWith('profile:')) { const k = b.slice(8); const d = profileDef(k); return `${d?.label ?? k} ◆ profile${PROFILE_REGISTRY[k] ? '' : ' ƒ'}`; }
    return b;
  }
  function openCreate(dir: string, label: string, ev: MouseEvent) {
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    createId = ''; createSearch = ''; createBase = 'r_cylinder'; createErr = '';
    void loadVolProfiles(); // refresh so freshly-forked ƒ profiles appear
    createPanel = { dir, label, x: Math.min(r.right + 6, window.innerWidth - 320), y: Math.min(r.top, window.innerHeight - 360) };
  }
  function closeCreate() { createPanel = null; }
  // Revolve part from a profile FUNCTION (K.22 E lift): the profile's params
  // become the PART's params, and the body resolves the profile from them each
  // bake → r_revolve. Born parametric. Curated kinds resolve in-sandbox; VOLUME
  // (ƒ) kinds resolve server-side at bake via P6 — so a forked/edited profile
  // drives the part.
  function buildStubFromProfile(id: string, kind: string): string | null {
    const def: any = profileDef(kind);
    if (!def) return null;
    return buildRevolveStubFromProfile(id, kind, def.params ?? {});
  }
  // Build a composite stub that wraps the chosen base r_* (mirrors its params).
  async function buildStubFromBase(id: string, base: string): Promise<string | null> {
    if (base.startsWith('profile:')) return buildStubFromProfile(id, base.slice(8));
    try {
      const res = await fetch(`/api/primitives/source?name=${encodeURIComponent(base)}`);
      if (!res.ok) return null;
      const params: Record<string, any> = (await res.json()).params ?? {};
      return buildPartStubFromBase(id, base, params);
    } catch { return null; }
  }
  async function submitCreate() {
    if (!createPanel || createBusy) return;
    const all = [...entries, ...basic, ...industrial, ...Object.values(completions).flat()];
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
      else if (dir === 'industrial') showIndustrial = true;
      else if (dir.startsWith('completions/')) { showCompletions = true; openFamilies[dir.slice('completions/'.length)] = true; }
      closeCreate();
      // The list read can lag the write (prod volume propagation), so the just-
      // created id may be absent on the first refresh. Retry a few times before
      // giving up so the new part reliably shows up + opens.
      let created: Entry | undefined;
      for (let attempt = 0; attempt < 4; attempt++) {
        await refreshList();
        created = [...entries, ...basic, ...industrial, ...Object.values(completions).flat()].find((x) => x.id === newId);
        if (created) break;
        await new Promise((res) => setTimeout(res, 350));
      }
      if (created) openTab(created);
      else status = `Created ${newId} in ${label} — it may take a moment to appear; click Re-scan if not.`;
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
    if (entries.some((x) => x.id === newId) || basic.some((x) => x.id === newId) || industrial.some((x) => x.id === newId)) {
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
    const r = await fetch('/api/primitives/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: newId, source: src }),
    });
    if (!r.ok) { status = `Save As failed: ${await r.text()}`; return false; }
    status = `Saved ${srcId} as → ${newId}.`;
    await refreshList();
    const created = entries.find((x) => x.id === newId) ?? basic.find((x) => x.id === newId) ?? industrial.find((x) => x.id === newId);
    if (created) openTab(created);
    return true;
  }

  async function deletePrimitive() {
    if (activeTab?.entry.editable) await archiveById(activeTab.entry.id);
  }

  // Soft-delete: trash button moves to archive/ (recoverable). Two-step
  // delete protects against accidental loss of a primitive that took
  // effort to build.
  async function archiveById(id: string) {
    if (!confirm(`Archive volume primitive "${id}"?\n\nIt will move to the Archive section — use the trash icon there to permanently delete.`)) return;
    const r = await fetch(`/api/primitives/delete?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!r.ok) { status = `Archive failed: ${await r.text()}`; return; }
    status = `Archived "${id}".`;
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
      <a class="prim-profiles-link" href="/primitives/profiles" title="Open the full-screen profile builder">ƒ Profile builder ›</a>
    </header>

    <!-- Loose top section — only renders when there are uncategorized volume
         primitives. Empty by default now (bundle helpers are hidden; loose
         primitives are archived), so the category folders start at the top. -->
    {#if entries.length}
      <div class="prim-list">
        {#each entries as e (e.id)}
          <div class="prim-row-wrap" class:active={activeId === e.id} class:open={openTabs.some((t) => t.entry.id === e.id)}>
            <button class="prim-row" type="button" draggable={true} ondragstart={(ev) => ev.dataTransfer?.setData('application/x-primitive-id', e.id)} onclick={() => openTab(e)}>
              <span class="prim-name">{e.id}</span>
              <span class="prim-tag" class:vol={e.source === 'volume'}>{e.source === 'volume' ? 'vol' : 'bnd'}</span>
            </button>
            <button class="prim-dup" type="button" title="Duplicate to a new volume primitive" aria-label="Duplicate" onclick={() => cloneEntry(e)}>⎘</button>
            {#if e.editable}
              <button class="prim-trash" type="button" title="Archive (soft delete)" aria-label="Archive" onclick={() => archiveById(e.id)}>×</button>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    <!-- Basic category — the raw r_* geometry primitives, parked under
         primitives/basic/ on the volume (location IS the category, mirrors
         Industrial). Collapsible folder. -->
    <div class="prim-tests">
      <div class="prim-head-row">
        <button class="prim-arch-head" type="button" onclick={() => (showBasic = !showBasic)}>
          <span class="prim-arch-caret">{showBasic ? '▾' : '▸'}</span>
          Basic {#if basic.length}({basic.length}){/if}
        </button>
        <button class="prim-add" type="button" title="New primitive in Basic" aria-label="Add primitive" onclick={(e) => openCreate('basic', 'Basic', e)}>＋</button>
      </div>
      {#if showBasic}
        {#if basic.length === 0}
          <div class="prim-empty">none yet</div>
        {:else}
          {#each basic as e (e.id)}
            <div class="prim-row-wrap" class:active={activeId === e.id} class:open={openTabs.some((t) => t.entry.id === e.id)}>
              <button class="prim-row" type="button" draggable={true} ondragstart={(ev) => ev.dataTransfer?.setData('application/x-primitive-id', e.id)} onclick={() => openTab(e)}>
                <span class="prim-name">{e.id}</span>
                <span class="prim-tag vol">vol</span>
              </button>
              <button class="prim-dup" type="button" title="Duplicate to a new volume primitive" aria-label="Duplicate" onclick={() => cloneEntry(e)}>⎘</button>
              {#if e.editable}
                <button class="prim-trash" type="button" title="Archive (soft delete)" aria-label="Archive" onclick={() => archiveById(e.id)}>×</button>
              {/if}
            </div>
          {/each}
        {/if}
      {/if}
    </div>

    <!-- Industrial category (formerly Tests) — primitives parked under
         primitives/industrial/ on the volume (location IS the category).
         Collapsible folder. -->
    <div class="prim-tests">
      <div class="prim-head-row">
        <button class="prim-arch-head" type="button" onclick={() => (showIndustrial = !showIndustrial)}>
          <span class="prim-arch-caret">{showIndustrial ? '▾' : '▸'}</span>
          Industrial {#if industrial.length}({industrial.length}){/if}
        </button>
        <button class="prim-add" type="button" title="New primitive in Industrial" aria-label="Add primitive" onclick={(e) => openCreate('industrial', 'Industrial', e)}>＋</button>
      </div>
      {#if showIndustrial}
        {#if industrial.length === 0}
          <div class="prim-empty">none yet</div>
        {:else}
          {#each industrial as e (e.id)}
            <div class="prim-row-wrap" class:active={activeId === e.id} class:open={openTabs.some((t) => t.entry.id === e.id)}>
              <button class="prim-row" type="button" draggable={true} ondragstart={(ev) => ev.dataTransfer?.setData('application/x-primitive-id', e.id)} onclick={() => openTab(e)}>
                <span class="prim-name">{e.id}</span>
                <span class="prim-tag vol">ind</span>
              </button>
              <button class="prim-dup" type="button" title="Duplicate to a new volume primitive" aria-label="Duplicate" onclick={() => cloneEntry(e)}>⎘</button>
              {#if e.editable}
                <button class="prim-trash" type="button" title="Archive (soft delete)" aria-label="Archive" onclick={() => archiveById(e.id)}>×</button>
              {/if}
            </div>
          {/each}
        {/if}
      {/if}
    </div>

    <!-- Completions category — NESTED by family. primitives/completions/
         <family>/<id>/ on the volume. Outer collapsible group → per-family
         collapsible sub-folders → parts. Family dirs may be empty
         (structure only) and still show. -->
    <div class="prim-tests">
      <button class="prim-arch-head" type="button" onclick={() => (showCompletions = !showCompletions)}>
        <span class="prim-arch-caret">{showCompletions ? '▾' : '▸'}</span>
        Completions {#if completionFamilies.length}({completionFamilies.length}){/if}
      </button>
      {#if showCompletions}
        {#if completionFamilies.length === 0}
          <div class="prim-empty">no families yet</div>
        {:else}
          {#each completionFamilies as fam (fam.id)}
            {@const parts = completions[fam.id] ?? []}
            <div class="prim-fam">
              <div class="prim-head-row">
                <button class="prim-fam-head" type="button" onclick={() => (openFamilies[fam.id] = !openFamilies[fam.id])}>
                  <span class="prim-arch-caret">{openFamilies[fam.id] ? '▾' : '▸'}</span>
                  {fam.label} {#if parts.length}({parts.length}){/if}
                </button>
                <button class="prim-add" type="button" title={`New primitive in ${fam.label}`} aria-label="Add primitive" onclick={(e) => openCreate(`completions/${fam.id}`, fam.label, e)}>＋</button>
              </div>
              {#if openFamilies[fam.id]}
                {#if parts.length === 0}
                  <div class="prim-empty prim-fam-empty">empty</div>
                {:else}
                  {#each parts as e (e.id)}
                    <div class="prim-row-wrap prim-fam-row" class:active={activeId === e.id} class:open={openTabs.some((t) => t.entry.id === e.id)}>
                      <button class="prim-row" type="button" draggable={true} ondragstart={(ev) => ev.dataTransfer?.setData('application/x-primitive-id', e.id)} onclick={() => openTab(e)}>
                        <span class="prim-name">{e.id}</span>
                        <span class="prim-tag vol">vol</span>
                      </button>
                      <button class="prim-dup" type="button" title="Duplicate to a new volume primitive" aria-label="Duplicate" onclick={() => cloneEntry(e)}>⎘</button>
                      {#if e.editable}
                        <button class="prim-trash" type="button" title="Archive (soft delete)" aria-label="Archive" onclick={() => archiveById(e.id)}>×</button>
                      {/if}
                    </div>
                  {/each}
                {/if}
              {/if}
            </div>
          {/each}
        {/if}
      {/if}
    </div>

    <!-- Demos — standalone test/demo pages kept under /primitives so we
         don't proliferate top-level routes. -->
    <div class="prim-tests">
      <div class="prim-grouphead">Demos</div>
      <a class="prim-demolink" href="/primitives/recipe-test">recipe-test ↗</a>
    </div>

    {#if archived.length > 0}
      <div class="prim-archive">
        <button class="prim-arch-head" type="button" onclick={() => (showArchive = !showArchive)}>
          <span class="prim-arch-caret">{showArchive ? '▾' : '▸'}</span>
          Archive ({archived.length})
        </button>
        {#if showArchive}
          <div class="prim-arch-list">
            {#each archived as a (a.id)}
              <div class="prim-row-wrap prim-row-arch">
                <span class="prim-name prim-name-arch" title={a.description}>{a.id}</span>
                <button class="prim-mini" type="button" title="Restore to active" onclick={() => restoreById(a.id)}>↶</button>
                <button class="prim-mini prim-mini-danger" type="button" title="Permanent delete" onclick={() => purgeById(a.id)}>×</button>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

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
            <div class="actions-strip">
              <button class="prim-btn small" type="button" onclick={() => cloneEntry(t.entry)}>⎘ Duplicate</button>
              {#if t.entry.editable}
                <button class="prim-btn danger small" type="button" onclick={() => archiveById(t.entry.id)}>Delete</button>
              {/if}
            </div>
            {#if t.loading}
              <div class="prim-loading">Loading <code>{t.entry.id}</code>…</div>
            {:else}
              <PrimitiveView
                id={t.entry.id}
                name={t.entry.name}
                description={t.entry.description}
                paramSchema={t.entry.params}
                profileSchema={t.entry.profiles ?? {}}
                editable={t.entry.editable}
                initialSource={t.serverSource}
                serverSource={t.serverSource}
                onSaveSource={(s) => saveSourceFor(t, s)}
                onSaveDefaults={(a) => saveDefaultsFor(t, a)}
                onSaveAs={(newId, src) => saveAsEntry(t.entry.id, newId, src)}
                onReloadSource={() => loadFromServerFor(t)}
                catalog={[...entries, ...basic, ...industrial, ...Object.values(completions).flat()]}
              />
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </main>
</div>

{#if createPanel}
  <FloatingPanel title={`New primitive · ${createPanel.label}`} visible={true} x={createPanel.x} y={createPanel.y} width="300px" maxHeight="70vh" onClose={closeCreate}>
    <div class="prim-create">
      <label class="prim-create-row">id
        <input bind:value={createId} placeholder="e.g. dp_pin" spellcheck="false" autofocus
          onkeydown={(e) => { if (e.key === 'Enter' && createId.trim() && !createBusy) submitCreate(); }} />
      </label>
      <div class="prim-create-base">
        <div class="prim-create-baselabel">start from <code>{baseLabel(createBase)}</code></div>
        <input class="prim-create-search" bind:value={createSearch} placeholder="search r_* or profile…" spellcheck="false" />
        <div class="prim-create-list">
          {#each createBaseList as b (b)}
            <button class="prim-create-opt" class:sel={b === createBase} class:prof={b.startsWith('profile:')} type="button" onclick={() => (createBase = b)}>{baseLabel(b)}</button>
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

<style>
  .prim-page { display: grid; grid-template-columns: 240px 1fr; height: 100%; min-height: 0; font: 13px Arial; color: #222; position: relative; }
  .prim-page.rail-collapsed { grid-template-columns: 0 1fr; }
  .prim-page.rail-collapsed .prim-rail { display: none; }
  .prim-rail { border-right: 1px solid #ddd; background: #fafafa; overflow-y: auto; padding: 8px 6px; display: flex; flex-direction: column; line-height: 1.2; }
  /* Drag handle straddling the rail/main boundary (rail is overflow:auto, so
     the handle lives on .prim-page which is position:relative). */
  .prim-rail-resize { position: absolute; top: 0; bottom: 0; width: 7px; margin-left: -3px; z-index: 20; cursor: col-resize; }
  .prim-rail-resize::after { content: ''; position: absolute; top: 0; bottom: 0; left: 3px; width: 1px; background: transparent; }
  .prim-rail-resize:hover::after, .prim-page.rail-resizing .prim-rail-resize::after { background: #2266cc; width: 2px; left: 2px; }
  .prim-page.rail-resizing { cursor: col-resize; user-select: none; }
  .prim-rail header { padding: 0 6px 6px; border-bottom: 1px solid #eee; position: relative; }
  .prim-rail-toggle { position: absolute; top: -2px; right: 0; border: none; background: transparent; color: #999; font-size: 16px; line-height: 1; cursor: pointer; padding: 2px 4px; }
  .prim-rail-toggle:hover { color: #cc2222; }
  .prim-rail-expand { position: absolute; top: 8px; left: 8px; z-index: 20; border: 1px solid #ddd; background: #fff; color: #555; font-size: 14px; line-height: 1; cursor: pointer; padding: 5px 9px; border-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.12); }
  .prim-rail-expand:hover { color: #cc2222; border-color: #cc2222; }
  .prim-rail h2 { margin: 0; font: 700 14px Arial; color: #cc2222; }
  .prim-rail .sub { margin: 2px 0 0; font: 11px Arial; color: #777; }
  .prim-profiles-link { display: inline-block; margin-top: 6px; font: 600 11px Arial; color: #c4392f; text-decoration: none; }
  .prim-profiles-link:hover { text-decoration: underline; }
  .prim-list { padding: 4px 0; flex: 1; }
  .prim-row-wrap { display: flex; align-items: center; gap: 2px; margin: 0; border-radius: 4px; }
  .prim-row-wrap:hover { background: #f0e8e8; }
  .prim-row-wrap.active { background: #fef0f0; }
  .prim-row-wrap.active .prim-name { color: #cc2222; }
  .prim-row-wrap.open .prim-name { font-weight: 800; }  /* open in a tab */
  .prim-row { display: flex; align-items: center; gap: 6px; flex: 1; padding: 3px 8px; background: transparent; border: 0; border-radius: 4px; text-align: left; cursor: pointer; font: inherit; color: inherit; line-height: 1.3; }
  .prim-trash { background: transparent; border: 0; padding: 2px 6px; color: #aaa; cursor: pointer; font: 14px monospace; border-radius: 3px; }
  .prim-trash:hover { color: #cc2222; background: #fff; }
  .prim-dup { background: transparent; border: 0; padding: 2px 6px; color: #aaa; cursor: pointer; font: 12px monospace; border-radius: 3px; }
  .prim-dup:hover { color: #2266cc; background: #fff; }

  .prim-tests { margin-top: 6px; border-top: 1px solid #eee; padding-top: 3px; }
  .prim-grouphead { padding: 3px 8px; font: 700 13px Arial; color: #888; }
  .prim-empty { padding: 1px 8px 3px; font: italic 11px Arial; color: #bbb; }

  /* Completions → family sub-folders (one level deeper than the flat
     groups). Caret + label indented; parts indented again. */
  .prim-fam { margin-left: 6px; }
  .prim-fam-head { background: transparent; border: 0; width: 100%; text-align: left; padding: 2px 8px; font: 700 12px Arial; color: #999; cursor: pointer; display: flex; align-items: center; gap: 4px; border-radius: 3px; }
  /* Folder header row: the collapse toggle (flex:1) + an "＋ add" button that
     creates a new primitive in that folder. */
  .prim-head-row { display: flex; align-items: center; }
  .prim-head-row > button:first-child { flex: 1; min-width: 0; }
  .prim-add { flex: 0 0 auto; background: transparent; border: 0; color: #bbb; font: 700 14px Arial; cursor: pointer; padding: 0 8px; line-height: 1; border-radius: 3px; }
  .prim-add:hover { color: #2266cc; background: #eef3fb; }
  /* New-primitive popup (FloatingPanel — replaces the native prompt). */
  .prim-create { display: flex; flex-direction: column; gap: 8px; padding: 2px; }
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
  .prim-fam-head:hover { background: #f0f0f0; color: #555; }
  .prim-fam-empty { margin-left: 14px; }
  .prim-fam-row { margin-left: 8px; }
  .prim-demolink { display: block; padding: 3px 8px; font: 600 13px monospace; color: #2266cc; text-decoration: none; border-radius: 4px; }
  .prim-demolink:hover { background: #eef3fb; }

  .prim-archive { margin-top: 6px; border-top: 1px solid #eee; padding-top: 3px; }
  .prim-arch-head { background: transparent; border: 0; width: 100%; text-align: left; padding: 3px 8px; font: 700 13px Arial; color: #888; cursor: pointer; display: flex; align-items: center; gap: 4px; border-radius: 3px; }
  .prim-arch-head:hover { background: #f0f0f0; color: #555; }
  .prim-arch-caret { font: 10px monospace; width: 10px; }
  .prim-arch-list { padding: 1px 0; }
  .prim-row-arch { padding: 2px 8px; gap: 4px; align-items: center; display: flex; }
  .prim-row-arch:hover { background: #f5f5f5; }
  .prim-name-arch { flex: 1; font: 11px monospace; color: #888; }
  .prim-mini { background: transparent; border: 1px solid #ddd; border-radius: 3px; padding: 2px 6px; font: 11px monospace; color: #888; cursor: pointer; }
  .prim-mini:hover { color: #2266cc; border-color: #2266cc; background: #fff; }
  .prim-mini-danger:hover { color: #cc2222; border-color: #cc2222; }
  .prim-name { font: 600 11px monospace; flex: 1; }
  .prim-tag { font: 9px Arial; padding: 1px 5px; border-radius: 8px; background: #ddd; color: #555; }
  .prim-tag.vol { background: #cc2222; color: #fff; }
  .status { font: 10px Arial; color: #777; padding: 6px 8px; border-top: 1px solid #eee; }

  .prim-main { display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
  .actions-strip { padding: 2px 8px 0; display: flex; justify-content: flex-end; gap: 6px; }

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

  .prim-btn { padding: 5px 10px; border: 1px solid #ccc; border-radius: 4px; background: #fff; font: 12px Arial; cursor: pointer; }
  .prim-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .prim-btn.small { padding: 3px 8px; font-size: 11px; }
  .prim-btn.danger { background: #fff; color: #cc2222; border-color: #cc2222; }

  .placeholder { flex: 1; display: flex; align-items: center; justify-content: center; color: #777; }
</style>
