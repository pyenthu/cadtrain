<script lang="ts">
  // /primitives — sidebar of primitives + PrimitiveView for the
  // selected one. The actual three-mode UI (Viewer / Editor / Source)
  // and Apply / Save semantics live in PrimitiveView. This page is
  // the route shell: list, selection, source fetch + persistence.
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
    editable: boolean;
  }

  let entries: Entry[] = $state([]);
  let archived: Entry[] = $state([]);
  let selected: Entry | null = $state(null);
  let serverSource = $state('');
  let editedSource = $state('');
  let status = $state('');
  let showArchive = $state(false);

  async function refreshList() {
    const r = await fetch('/api/primitives/list');
    const data = await r.json();
    entries = data.merged;
    archived = data.archived ?? [];
  }

  async function fetchSourceFor(id: string): Promise<{ source: string; origin: string } | null> {
    try {
      const r = await fetch(`/api/primitives/source?name=${encodeURIComponent(id)}`);
      if (!r.ok) { status = `Server returned ${r.status}: ${await r.text()}`; return null; }
      const data = await r.json() as { source: string; origin: string };
      status = `Loaded from ${data.origin}.`;
      return data;
    } catch (e: any) {
      status = `Error: ${e?.message ?? e}`;
      return null;
    }
  }

  async function loadFromServer() {
    if (!selected) return;
    const data = await fetchSourceFor(selected.id);
    if (data) { editedSource = data.source; serverSource = data.source; }
  }

  async function selectEntry(e: Entry) {
    // Pre-load source BEFORE swapping `selected` so the {#key} remount
    // of PrimitiveView lands with the correct initialSource on first
    // render — otherwise the child mounts with stale source, then we
    // need a prop-syncing effect (which caused an update-depth loop).
    const data = await fetchSourceFor(e.id);
    if (data) { editedSource = data.source; serverSource = data.source; }
    selected = e;
  }

  onMount(async () => {
    await refreshList();
    if (entries.length > 0) {
      const initial = entries.find((e) => e.id === 'warp_helix') ?? entries[0];
      await selectEntry(initial);
    }
  });

  async function saveSource(newSource: string) {
    if (!selected || !selected.editable) return;
    const r = await fetch('/api/primitives/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: selected.id, source: newSource }),
    });
    if (!r.ok) { status = `Save failed: ${await r.text()}`; return; }
    status = 'Saved to volume.';
    await refreshList();
    const updated = entries.find((e) => e.id === selected!.id);
    if (updated) selected = updated;
    serverSource = newSource;
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

  async function saveDefaults(applied: Record<string, number>) {
    if (!selected || !selected.editable) return;
    const next = rewriteDefaultsInSource(editedSource, applied);
    await saveSource(next);
    editedSource = next;
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
    if (created) await selectEntry(created);
  }

  function cloneToVolume() {
    if (selected) cloneEntry(selected);
  }

  async function deletePrimitive() {
    if (!selected || !selected.editable) return;
    await archiveById(selected.id);
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
    if (selected?.id === id) {
      selected = entries[0] ?? null;
      if (selected) await selectEntry(selected);
    }
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
        <div class="prim-row-wrap" class:active={selected?.id === e.id}>
          <button class="prim-row" type="button" onclick={() => selectEntry(e)}>
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
    {#if !selected}
      <div class="placeholder">No primitives yet.</div>
    {:else}
      <div class="actions-strip">
        <button class="prim-btn small" type="button" onclick={cloneToVolume}>⎘ Duplicate</button>
        {#if selected.editable}
          <button class="prim-btn danger small" type="button" onclick={deletePrimitive}>Delete</button>
        {/if}
      </div>

      {#key selected.id}
        <PrimitiveView
          id={selected.id}
          name={selected.name}
          description={selected.description}
          paramSchema={selected.params}
          editable={selected.editable}
          initialSource={serverSource}
          {serverSource}
          onSaveSource={saveSource}
          onSaveDefaults={saveDefaults}
          onReloadSource={loadFromServer}
        />
      {/key}
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
  .prim-row { display: flex; align-items: center; gap: 6px; flex: 1; padding: 6px 8px; background: transparent; border: 0; border-radius: 4px; text-align: left; cursor: pointer; font: inherit; color: inherit; }
  .prim-trash { background: transparent; border: 0; padding: 4px 6px; color: #aaa; cursor: pointer; font: 14px monospace; border-radius: 3px; }
  .prim-trash:hover { color: #cc2222; background: #fff; }
  .prim-dup { background: transparent; border: 0; padding: 4px 6px; color: #aaa; cursor: pointer; font: 12px monospace; border-radius: 3px; }
  .prim-dup:hover { color: #2266cc; background: #fff; }

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

  .prim-btn { padding: 5px 10px; border: 1px solid #ccc; border-radius: 4px; background: #fff; font: 12px Arial; cursor: pointer; }
  .prim-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .prim-btn.small { padding: 3px 8px; font-size: 11px; }
  .prim-btn.danger { background: #fff; color: #cc2222; border-color: #cc2222; }

  .placeholder { flex: 1; display: flex; align-items: center; justify-content: center; color: #777; }
</style>
