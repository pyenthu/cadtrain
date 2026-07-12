<script lang="ts">
  /**
   * TypeDefinerPanel — the visual SHAPE DEFINER + manager (typed-ports Layer 2b).
   * Define composite RECORD types (Point{r,z}, Casing{od,id,…}) from field rows,
   * see the live shape, and store them. Built-in port types are shown read-only;
   * user types persist to localStorage for now (L2c swaps in the volume library).
   * Plan: docs/plans/typed-ports.md.
   */
  import { onMount } from 'svelte';
  import {
    allPortTypes, portType, defineRecordType, listOf,
    type PortType,
  } from '$lib/graph/port-types';

  type DraftField = { name: string; typeId: string; list: boolean };
  type Draft = { id: string; label: string; fields: DraftField[] };

  const BUILTINS = ['scalar', 'flag', 'point', 'geometry'];

  let defs = $state<Draft[]>([]);          // user-defined composites (source of truth)
  let selId = $state<string | null>(null);  // which user type is open
  let draft = $state<Draft | null>(null);   // the working copy in the editor
  let tick = $state(0);                      // bump to re-read the registry

  // Element types pickable for a field (one-card primitives + user records).
  let fieldTypeOptions = $derived.by(() => {
    tick; // re-read after registration
    return allPortTypes().filter((t) => t.card === 'one');
  });

  function register(d: Draft) {
    for (const f of d.fields) if (f.list) listOf(f.typeId);
    defineRecordType(d.id, d.label || d.id, d.fields
      .filter((f) => f.name.trim())
      .map((f) => ({ name: f.name.trim(), typeId: f.list ? `list<${f.typeId}>` : f.typeId })));
    tick++;
  }
  async function load() {
    // built-in primitives (scalar/flag/point/geometry) are already registered.
    // Types live on the shared VOLUME (proxied to prod in dev) — L2c.
    try {
      const r = await fetch('/api/primitives/types');
      if (r.ok) defs = (((await r.json())?.types ?? []) as any[]).map((t): Draft => ({
        id: t.id, label: t.label ?? t.id,
        fields: (t.fields ?? []).map((f: any) => ({ name: f.name, typeId: f.typeId, list: !!f.list })),
      }));
    } catch { /* offline — built-ins still usable */ }
    for (const d of defs) register(d);
  }
  onMount(load);

  function uniqueId(base: string): string {
    const used = new Set([...defs.map((d) => d.id), ...allPortTypes().map((t) => t.id)]);
    if (!used.has(base)) return base;
    let k = 2; while (used.has(`${base}${k}`)) k++; return `${base}${k}`;
  }
  function newType() {
    const id = uniqueId('MyType');
    draft = { id, label: id, fields: [{ name: 'a', typeId: 'scalar', list: false }] };
    selId = null;
  }
  function edit(d: Draft) {
    draft = { id: d.id, label: d.label, fields: d.fields.map((f) => ({ ...f })) };
    selId = d.id;
  }
  function addField() {
    if (!draft) return;
    draft.fields = [...draft.fields, { name: `f${draft.fields.length + 1}`, typeId: 'scalar', list: false }];
  }
  function delField(i: number) { if (draft) draft.fields = draft.fields.filter((_, j) => j !== i); }
  function moveField(i: number, dir: -1 | 1) {
    if (!draft) return;
    const j = i + dir; if (j < 0 || j >= draft.fields.length) return;
    const fs = [...draft.fields]; [fs[i], fs[j]] = [fs[j]!, fs[i]!]; draft.fields = fs;
  }

  let nameErr = $derived.by(() => {
    if (!draft) return null;
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(draft.id)) return 'name: letters/digits/_ , start with a letter';
    const clash = allPortTypes().some((t) => t.id === draft!.id) && draft.id !== selId
      && !defs.some((d) => d.id === draft!.id);
    if (clash) return `'${draft.id}' is a built-in type name`;
    if (!draft.fields.some((f) => f.name.trim())) return 'add at least one field';
    return null;
  });

  let saving = $state(false);
  async function save() {
    if (!draft || nameErr) return;
    const cleaned: Draft = { id: draft.id, label: draft.label || draft.id, fields: draft.fields.filter((f) => f.name.trim()) };
    defs = [...defs.filter((d) => d.id !== selId && d.id !== cleaned.id), cleaned];
    register(cleaned); selId = cleaned.id;
    saving = true;
    try {
      await fetch('/api/primitives/types', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cleaned) });
    } catch { /* offline — the in-memory registry still has it */ }
    saving = false;
  }
  async function del(id: string) {
    defs = defs.filter((d) => d.id !== id);
    if (selId === id) { draft = null; selId = null; }
    try { await fetch(`/api/primitives/types?id=${encodeURIComponent(id)}`, { method: 'DELETE' }); } catch { /* offline */ }
  }

  // A readable one-line shape signature for preview / list.
  function sig(d: Draft): string {
    const fs = d.fields.filter((f) => f.name.trim())
      .map((f) => `${f.name}: ${f.list ? `list<${f.typeId}>` : f.typeId}`);
    return `{ ${fs.join(', ')} }`;
  }
</script>

<div class="td-root">
  <!-- LEFT — the manager: built-ins (read-only) + user types -->
  <aside class="td-side">
    <div class="td-side-head">
      <span class="td-side-title">Types</span>
      <button class="td-new" type="button" onclick={newType} title="Define a new composite type">+ new</button>
    </div>

    <div class="td-group-lbl">built-in</div>
    {#each BUILTINS as id}
      {@const t = portType(id)}
      {#if t}
        <div class="td-item builtin" title={`${t.label} — built-in, read-only`}>
          <span class="td-dot" style={`background:${t.color}`}></span>
          <span class="td-item-id">{t.id}</span>
          <span class="td-item-kind">{t.label}</span>
        </div>
      {/if}
    {/each}

    <div class="td-group-lbl">your types {#if defs.length}· {defs.length}{/if}</div>
    {#if !defs.length}
      <div class="td-empty">None yet — <button class="td-link" type="button" onclick={newType}>define one</button>.</div>
    {/if}
    {#each defs as d (d.id)}
      <div class="td-item" class:on={selId === d.id}>
        <span class="td-dot" style="background:#7c3aed"></span>
        <button class="td-item-id btn" type="button" onclick={() => edit(d)} title={sig(d)}>{d.id}</button>
        <span class="td-item-kind">{d.fields.length}f</span>
        <button class="td-del" type="button" title="Delete this type" onclick={() => del(d.id)}>×</button>
      </div>
    {/each}
  </aside>

  <!-- RIGHT — the definer -->
  <section class="td-main">
    {#if !draft}
      <div class="td-blank">
        <p>Select a type to edit, or <button class="td-link" type="button" onclick={newType}>+ define a new one</button>.</p>
        <p class="td-hint">A composite type is a named record of fields — e.g.
          <code>Point {'{'} r: number, z: number {'}'}</code> or
          <code>Casing {'{'} od, id, length, isLiner: flag {'}'}</code>. A field can
          be any type (including another of your types), optionally a <code>list</code>.</p>
      </div>
    {:else}
      <div class="td-edit">
        <div class="td-edit-head">
          <span class="td-glyph">◇</span>
          <input class="td-name" type="text" bind:value={draft.id} placeholder="TypeName" spellcheck="false" />
          <span class="td-eq">=</span>
          <code class="td-sig">{sig(draft)}</code>
        </div>

        <div class="td-fields">
          {#each draft.fields as f, i (i)}
            <div class="td-frow">
              <input class="td-fname" type="text" bind:value={f.name} placeholder="field" spellcheck="false" />
              <span class="td-colon">:</span>
              <label class="td-list" title="Make this field a list">
                <input type="checkbox" bind:checked={f.list} /> list
              </label>
              <select class="td-ftype" bind:value={f.typeId}>
                {#each fieldTypeOptions as t}
                  <option value={t.id}>{t.id}</option>
                {/each}
              </select>
              <button class="td-fmv" type="button" title="Move up" disabled={i === 0} onclick={() => moveField(i, -1)}>▲</button>
              <button class="td-fmv" type="button" title="Move down" disabled={i === draft.fields.length - 1} onclick={() => moveField(i, 1)}>▼</button>
              <button class="td-fdel" type="button" title="Remove field" onclick={() => delField(i)}>×</button>
            </div>
          {/each}
          <button class="td-addf" type="button" onclick={addField}>+ field</button>
        </div>

        <div class="td-foot">
          {#if nameErr}<span class="td-err">{nameErr}</span>{:else}<span class="td-ok">✓ ready</span>{/if}
          <span class="td-foot-sp"></span>
          <button class="td-cancel" type="button" onclick={() => { draft = null; selId = null; }}>Close</button>
          <button class="td-save" type="button" disabled={!!nameErr} onclick={save}>Save type</button>
        </div>
      </div>
    {/if}
  </section>
</div>

<style>
  .td-root { display: flex; height: 100%; min-height: 0; font: 13px/1.4 Arial, sans-serif; color: #1e293b; }
  .td-side { flex: 0 0 240px; border-right: 1px solid #e2e8f0; overflow-y: auto; padding: 8px; background: #fafafa; }
  .td-side-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
  .td-side-title { font-weight: 700; font-size: 13px; }
  .td-new { font: 600 11px Arial; color: #7c3aed; background: #f5f3ff; border: 1px solid #d8b4fe; border-radius: 5px; padding: 3px 8px; cursor: pointer; }
  .td-new:hover { background: #ede9fe; }
  .td-group-lbl { font: 700 9px Arial; letter-spacing: .08em; text-transform: uppercase; color: #94a3b8; margin: 10px 2px 4px; }
  .td-item { display: flex; align-items: center; gap: 6px; padding: 3px 4px; border-radius: 5px; }
  .td-item.on { background: #f5f3ff; }
  .td-item.builtin { opacity: .85; }
  .td-dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
  .td-item-id { font: 600 12px ui-monospace, monospace; color: #334155; }
  .td-item-id.btn { background: none; border: none; cursor: pointer; padding: 0; }
  .td-item-id.btn:hover { color: #7c3aed; text-decoration: underline; }
  .td-item-kind { font-size: 10px; color: #94a3b8; margin-left: auto; }
  .td-del { font: 700 13px Arial; color: #cbd5e1; background: none; border: none; cursor: pointer; padding: 0 2px; }
  .td-del:hover { color: #ef4444; }
  .td-empty { font-size: 11px; color: #94a3b8; padding: 4px; }
  .td-link { background: none; border: none; color: #7c3aed; cursor: pointer; padding: 0; font: inherit; text-decoration: underline; }

  .td-main { flex: 1 1 auto; min-width: 0; padding: 14px 16px; overflow-y: auto; }
  .td-blank { color: #64748b; max-width: 520px; }
  .td-hint { font-size: 12px; color: #94a3b8; margin-top: 10px; }
  .td-hint code { background: #f1f5f9; padding: 1px 5px; border-radius: 4px; font-size: 11px; color: #4338ca; }

  .td-edit-head { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
  .td-glyph { font-size: 16px; color: #7c3aed; }
  .td-name { font: 700 15px ui-monospace, monospace; color: #4338ca; border: 1px solid #cbd5e1; border-radius: 6px; padding: 5px 9px; width: 200px; }
  .td-name:focus { outline: none; border-color: #a855f7; }
  .td-eq { color: #94a3b8; }
  .td-sig { font: 12px ui-monospace, monospace; color: #64748b; background: #f8fafc; padding: 3px 8px; border-radius: 5px; }

  .td-fields { display: flex; flex-direction: column; gap: 5px; max-width: 560px; }
  .td-frow { display: flex; align-items: center; gap: 7px; }
  .td-fname { font: 600 12px ui-monospace, monospace; width: 150px; padding: 5px 8px; border: 1px solid #cbd5e1; border-radius: 5px; }
  .td-fname:focus { outline: none; border-color: #a855f7; }
  .td-colon { color: #94a3b8; }
  .td-list { font-size: 11px; color: #64748b; display: flex; align-items: center; gap: 3px; cursor: pointer; user-select: none; }
  .td-ftype { font: 12px ui-monospace, monospace; padding: 4px 6px; border: 1px solid #cbd5e1; border-radius: 5px; background: #fff; cursor: pointer; }
  .td-fmv { font-size: 10px; color: #94a3b8; background: none; border: none; cursor: pointer; padding: 0 1px; }
  .td-fmv:disabled { opacity: .3; cursor: default; }
  .td-fdel { font: 700 13px Arial; color: #cbd5e1; background: none; border: none; cursor: pointer; }
  .td-fdel:hover { color: #ef4444; }
  .td-addf { align-self: flex-start; margin-top: 4px; font: 600 11px Arial; color: #7c3aed; background: #f5f3ff; border: 1px dashed #d8b4fe; border-radius: 5px; padding: 4px 12px; cursor: pointer; }
  .td-addf:hover { background: #ede9fe; }

  .td-foot { display: flex; align-items: center; gap: 10px; margin-top: 18px; max-width: 560px; }
  .td-foot-sp { flex: 1 1 auto; }
  .td-err { font-size: 12px; color: #dc2626; }
  .td-ok { font-size: 12px; color: #16a34a; }
  .td-cancel { font: 600 12px Arial; color: #64748b; background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 6px; padding: 6px 14px; cursor: pointer; }
  .td-save { font: 600 12px Arial; color: #fff; background: #7c3aed; border: none; border-radius: 6px; padding: 6px 16px; cursor: pointer; }
  .td-save:disabled { background: #cbd5e1; cursor: default; }
</style>
