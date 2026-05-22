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
  let tests: Entry[] = $state([]);
  let archived: Entry[] = $state([]);
  // Multi-tab (like /components): each opened primitive is a tab kept
  // MOUNTED so it stays rendered/loaded when you switch — open several to
  // compare. serverSource is per-tab (dirty tracking + save).
  type Tab = { entry: Entry; serverSource: string; loading: boolean };
  let openTabs: Tab[] = $state([]);
  let activeId: string | null = $state(null);
  let activeTab = $derived(openTabs.find((t) => t.entry.id === activeId) ?? null);
  let status = $state('');
  let showArchive = $state(false);
  let showTests = $state(false);

  async function refreshList() {
    const r = await fetch('/api/primitives/list');
    const data = await r.json();
    entries = data.merged;
    tests = data.tests ?? [];
    archived = data.archived ?? [];
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
    // Default-open the first VOLUME primitive (bundle ones can 500 on
    // source-load); fall back to the first entry.
    const initial = [...entries, ...tests].find((e) => e.id === 't_spinner') ?? entries.find((e) => e.source === 'volume') ?? entries[0];
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

  /** Save As… — persist the CURRENT (live, possibly-unsaved) editor buffer
   *  under a NEW id, creating a new volume primitive without touching the
   *  original. Differs from Duplicate (which clones the SAVED source): this
   *  takes the in-flight `editedSource` straight from PrimitiveView. The meta
   *  id/name are rewritten to the new id; refuses an existing id (collision
   *  guard lives in PrimitiveView's popup too, this is the server-side-of-UI
   *  backstop). Opens the new primitive on success. */
  async function saveAsEntry(srcId: string, newId: string, editedSource: string) {
    if (!/^[a-z][a-z0-9_]*$/i.test(newId)) { status = `Invalid id "${newId}".`; return false; }
    if (entries.some((x) => x.id === newId) || tests.some((x) => x.id === newId)) {
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
    const created = entries.find((x) => x.id === newId) ?? tests.find((x) => x.id === newId);
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
</script>

<div class="prim-page">
  <aside class="prim-rail">
    <header>
      <h2>Primitives</h2>
      <p class="sub">Backend toolkit — raw geometry functions</p>
    </header>

    <div class="prim-list">
      {#each entries as e (e.id)}
        <div class="prim-row-wrap" class:active={activeId === e.id} class:open={openTabs.some((t) => t.entry.id === e.id)}>
          <button class="prim-row" type="button" onclick={() => openTab(e)}>
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

    <!-- Tests category — primitives parked under primitives/tests/ on the
         volume (location IS the category). Collapsible folder. -->
    <div class="prim-tests">
      <button class="prim-arch-head" type="button" onclick={() => (showTests = !showTests)}>
        <span class="prim-arch-caret">{showTests ? '▾' : '▸'}</span>
        Tests {#if tests.length}({tests.length}){/if}
      </button>
      {#if showTests}
        {#if tests.length === 0}
          <div class="prim-empty">none yet</div>
        {:else}
          {#each tests as e (e.id)}
            <div class="prim-row-wrap" class:active={activeId === e.id} class:open={openTabs.some((t) => t.entry.id === e.id)}>
              <button class="prim-row" type="button" onclick={() => openTab(e)}>
                <span class="prim-name">{e.id}</span>
                <span class="prim-tag vol">test</span>
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
                catalog={[...entries, ...tests]}
              />
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </main>
</div>

<style>
  .prim-page { display: grid; grid-template-columns: 240px 1fr; height: 100%; min-height: 0; font: 13px Arial; color: #222; }
  .prim-rail { border-right: 1px solid #ddd; background: #fafafa; overflow-y: auto; padding: 12px 8px; display: flex; flex-direction: column; }
  .prim-rail header { padding: 0 6px 8px; border-bottom: 1px solid #eee; }
  .prim-rail h2 { margin: 0; font: 700 14px Arial; color: #cc2222; }
  .prim-rail .sub { margin: 2px 0 0; font: 11px Arial; color: #777; }
  .prim-list { padding: 8px 0; flex: 1; }
  .prim-row-wrap { display: flex; align-items: center; gap: 2px; margin: 1px 0; border-radius: 4px; }
  .prim-row-wrap:hover { background: #f0e8e8; }
  .prim-row-wrap.active { background: #fef0f0; }
  .prim-row-wrap.active .prim-name { color: #cc2222; }
  .prim-row-wrap.open .prim-name { font-weight: 800; }  /* open in a tab */
  .prim-row { display: flex; align-items: center; gap: 6px; flex: 1; padding: 6px 8px; background: transparent; border: 0; border-radius: 4px; text-align: left; cursor: pointer; font: inherit; color: inherit; }
  .prim-trash { background: transparent; border: 0; padding: 4px 6px; color: #aaa; cursor: pointer; font: 14px monospace; border-radius: 3px; }
  .prim-trash:hover { color: #cc2222; background: #fff; }
  .prim-dup { background: transparent; border: 0; padding: 4px 6px; color: #aaa; cursor: pointer; font: 12px monospace; border-radius: 3px; }
  .prim-dup:hover { color: #2266cc; background: #fff; }

  .prim-tests { margin-top: 12px; border-top: 1px solid #eee; padding-top: 6px; }
  .prim-grouphead { padding: 4px 8px; font: 600 11px Arial; color: #888; }
  .prim-empty { padding: 2px 8px 6px; font: italic 11px Arial; color: #bbb; }
  .prim-demolink { display: block; padding: 5px 8px; font: 600 13px monospace; color: #2266cc; text-decoration: none; border-radius: 4px; }
  .prim-demolink:hover { background: #eef3fb; }

  .prim-archive { margin-top: 12px; border-top: 1px solid #eee; padding-top: 6px; }
  .prim-arch-head { background: transparent; border: 0; width: 100%; text-align: left; padding: 4px 8px; font: 600 11px Arial; color: #888; cursor: pointer; display: flex; align-items: center; gap: 4px; border-radius: 3px; }
  .prim-arch-head:hover { background: #f0f0f0; color: #555; }
  .prim-arch-caret { font: 10px monospace; width: 10px; }
  .prim-arch-list { padding: 2px 0; }
  .prim-row-arch { padding: 4px 8px; gap: 4px; align-items: center; display: flex; }
  .prim-row-arch:hover { background: #f5f5f5; }
  .prim-name-arch { flex: 1; font: 12px monospace; color: #888; }
  .prim-mini { background: transparent; border: 1px solid #ddd; border-radius: 3px; padding: 2px 6px; font: 11px monospace; color: #888; cursor: pointer; }
  .prim-mini:hover { color: #2266cc; border-color: #2266cc; background: #fff; }
  .prim-mini-danger:hover { color: #cc2222; border-color: #cc2222; }
  .prim-name { font: 600 13px monospace; flex: 1; }
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
