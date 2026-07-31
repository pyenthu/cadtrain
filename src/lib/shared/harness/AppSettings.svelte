<script lang="ts">
  // AppSettings — the APP-level settings panes (Variables · Style · Data), rendered as a full
  // panel in the studio's left sidebar (was the ⚙ App popover). One pane per `tab`. Mutates the
  // live `app` manifest directly (deep $state → reactive). Component-level settings stay a popover.
  import type { AppManifest } from '$lib/appkit/manifest/types';
  let { app, tab }: { app: AppManifest; tab: 'vars' | 'style' | 'data' | 'events' } = $props();

  // ── Data variables (app.vars: name → value) — the runes store: seeded data + promoted
  //    component props. Referenced anywhere as $vars.name (resolveRef). ──
  const varEntries = $derived(Object.entries((app.vars ?? {}) as Record<string, unknown>));
  const isScalar = (v: unknown) => v == null || ['string', 'number', 'boolean'].includes(typeof v);
  /** A one-line summary of a complex value (record / list-of-records / list). */
  function valueSummary(v: unknown): string {
    if (Array.isArray(v)) {
      const f = inferFields(v);
      return f ? `list · ${v.length} × {${f.map((x) => x.name).join(', ')}}` : `list · ${v.length} items`;
    }
    if (v && typeof v === 'object') return `record · {${Object.keys(v as object).join(', ')}}`;
    return String(v);
  }
  /** Infer a record schema from an array-of-objects (union of the first rows' keys) or a lone
   *  object — the shape behind a seeded/promoted variable. Null for a scalar list or scalar. */
  function inferFields(v: unknown): Array<{ name: string; type: string }> | null {
    const rowType = (val: unknown): string =>
      typeof val === 'number' ? 'number' : typeof val === 'boolean' ? 'boolean' : 'string';
    if (Array.isArray(v)) {
      const rows = v.filter((r) => r && typeof r === 'object' && !Array.isArray(r)) as Record<string, unknown>[];
      if (!rows.length) return null;
      const names: string[] = [];
      const typeOf: Record<string, string> = {};
      for (const r of rows.slice(0, 8)) for (const k of Object.keys(r)) {
        if (!(k in typeOf)) { names.push(k); typeOf[k] = rowType(r[k]); }
      }
      return names.map((n) => ({ name: n, type: typeOf[n] }));
    }
    if (v && typeof v === 'object') {
      return Object.entries(v as Record<string, unknown>).map(([n, val]) => ({ name: n, type: rowType(val) }));
    }
    return null;
  }
  const addVar = () => (app.vars = { ...(app.vars ?? {}), [`var${varEntries.length + 1}`]: '' });
  function renameVar(oldName: string, newName: string) {
    const v: Record<string, unknown> = { ...(app.vars ?? {}) };
    const val = v[oldName];
    delete v[oldName];
    v[newName || oldName] = val;
    app.vars = v;
  }
  function setVar(name: string, raw: string, wasNumber: boolean) {
    const val: unknown = wasNumber && raw.trim() !== '' && !Number.isNaN(Number(raw)) ? Number(raw) : raw;
    app.vars = { ...(app.vars ?? {}), [name]: val };
  }
  function delVar(name: string) {
    const v: Record<string, unknown> = { ...(app.vars ?? {}) };
    delete v[name];
    app.vars = v;
  }

  // ── Variables (app.computed: name → formula) ──
  const compEntries = $derived(Object.entries((app.computed ?? {}) as Record<string, string>));
  const addComputed = () => (app.computed = { ...(app.computed ?? {}), [`var${compEntries.length + 1}`]: '= 0' });
  function renameComputed(oldName: string, newName: string) {
    const c: Record<string, string> = { ...(app.computed ?? {}) };
    const v = c[oldName];
    delete c[oldName];
    c[newName || oldName] = v;
    app.computed = c;
  }
  const setFormula = (name: string, f: string) => (app.computed = { ...(app.computed ?? {}), [name]: f });
  function delComputed(name: string) {
    const c: Record<string, string> = { ...(app.computed ?? {}) };
    delete c[name];
    app.computed = c;
  }

  // ── Events (app.events: name → action expression a component can trigger) ──
  const eventEntries = $derived(Object.entries((app.events ?? {}) as Record<string, string>));
  const addEvent = () => (app.events = { ...(app.events ?? {}), [`event${eventEntries.length + 1}`]: '' });
  function renameEvent(oldName: string, newName: string) {
    const e: Record<string, string> = { ...(app.events ?? {}) };
    const v = e[oldName];
    delete e[oldName];
    e[newName || oldName] = v;
    app.events = e;
  }
  const setAction = (name: string, a: string) => (app.events = { ...(app.events ?? {}), [name]: a });
  function delEvent(name: string) {
    const e: Record<string, string> = { ...(app.events ?? {}) };
    delete e[name];
    app.events = e;
  }

  // ── Style (theme + app.css) ──
  const setTheme = (k: 'mode' | 'accent', v: string) => (app.theme = { ...(app.theme ?? {}), [k]: v });

  // ── Data structures (app.structures: name → fields) ──
  const structEntries = $derived(Object.entries((app.structures ?? {}) as Record<string, Array<{ name: string }>>));
  const addStructure = () => (app.structures = { ...(app.structures ?? {}), [`struct${structEntries.length + 1}`]: [] });
  function renameStructure(oldName: string, newName: string) {
    const s = { ...(app.structures ?? {}) };
    const v = s[oldName];
    delete s[oldName];
    s[newName || oldName] = v;
    app.structures = s;
  }
  const setFields = (name: string, csv: string) =>
    (app.structures = { ...(app.structures ?? {}), [name]: csv.split(',').map((x) => x.trim()).filter(Boolean).map((n) => ({ name: n })) });
  function delStructure(name: string) {
    const s = { ...(app.structures ?? {}) };
    delete s[name];
    app.structures = s;
  }
  const fieldsCsv = (fields: Array<{ name: string }>) => (fields ?? []).map((f) => f.name).join(', ');

  // Structures INFERRED from record / record-list variables — so seeded (and promoted) data shows
  // its schema even before it's declared. Excludes names already declared in app.structures.
  const inferredStructs = $derived(
    varEntries
      .map(([name, value]) => ({ name, fields: inferFields(value) }))
      .filter((s): s is { name: string; fields: Array<{ name: string; type: string }> } =>
        !!s.fields && !(app.structures ?? {})[s.name]),
  );
  function saveInferred(name: string, fields: Array<{ name: string; type: string }>) {
    app.structures = { ...(app.structures ?? {}), [name]: fields.map((f) => ({ name: f.name, type: f.type })) };
  }
</script>

<div class="as">
  {#if tab === 'vars'}
    <div class="as-h">Variables</div>
    <p class="as-hint">The app's runes store — seeded data + promoted component props. Referenced anywhere as <code>$vars.name</code>. Scalars are editable; records/lists show their shape (edit rows in the component or Data tab).</p>
    {#each varEntries as [name, value] (name)}
      <div class="row">
        <input class="k" value={name} onchange={(e) => renameVar(name, (e.currentTarget as HTMLInputElement).value)} />
        {#if isScalar(value)}
          <input class="v" value={value == null ? '' : String(value)} onchange={(e) => setVar(name, (e.currentTarget as HTMLInputElement).value, typeof value === 'number')} />
        {:else}
          <span class="v ro" title={JSON.stringify(value)}>{valueSummary(value)}</span>
        {/if}
        <button class="rm" onclick={() => delVar(name)} title="remove">✕</button>
      </div>
    {/each}
    {#if !varEntries.length}<div class="empty">no variables yet — add one, or they appear as you add components</div>{/if}
    <button class="add" onclick={addVar}>＋ variable</button>

    <div class="as-sub">Computed</div>
    <p class="as-hint">A formula over the doc params + other vars — e.g. <code>= w * h</code>.</p>
    {#each compEntries as [name, formula] (name)}
      <div class="row">
        <input class="k" value={name} onchange={(e) => renameComputed(name, (e.currentTarget as HTMLInputElement).value)} />
        <input class="v" value={formula} placeholder="= w * h" onchange={(e) => setFormula(name, (e.currentTarget as HTMLInputElement).value)} />
        <button class="rm" onclick={() => delComputed(name)} title="remove">✕</button>
      </div>
    {/each}
    {#if !compEntries.length}<div class="empty">no computed vars</div>{/if}
    <button class="add" onclick={addComputed}>＋ computed</button>
  {:else if tab === 'events'}
    <div class="as-h">Events</div>
    <p class="as-hint">Named app events a component can <em>trigger</em> — each runs an action (a verb call, e.g. <code>bake($active)</code>). Wire a component's event to fire one via its ⚙ settings.</p>
    {#each eventEntries as [name, action] (name)}
      <div class="row">
        <input class="k" value={name} onchange={(e) => renameEvent(name, (e.currentTarget as HTMLInputElement).value)} />
        <input class="v" value={action} placeholder="bake($active)" onchange={(e) => setAction(name, (e.currentTarget as HTMLInputElement).value)} />
        <button class="rm" onclick={() => delEvent(name)} title="remove">✕</button>
      </div>
    {/each}
    {#if !eventEntries.length}<div class="empty">no events yet</div>{/if}
    <button class="add" onclick={addEvent}>＋ event</button>
  {:else if tab === 'data'}
    <div class="as-h">Data structures</div>
    <p class="as-hint">Reusable field sets — a table adopts one via its “From structure” picker.</p>
    {#each structEntries as [name, fields] (name)}
      <div class="row">
        <input class="k" value={name} onchange={(e) => renameStructure(name, (e.currentTarget as HTMLInputElement).value)} />
        <input class="v" value={fieldsCsv(fields)} placeholder="od, id, top" onchange={(e) => setFields(name, (e.currentTarget as HTMLInputElement).value)} />
        <button class="rm" onclick={() => delStructure(name)} title="remove">✕</button>
      </div>
    {/each}
    {#if !structEntries.length}<div class="empty">no declared structures</div>{/if}
    <button class="add" onclick={addStructure}>＋ structure</button>

    {#if inferredStructs.length}
      <div class="as-sub">Inferred from variables</div>
      <p class="as-hint">Shapes read from your record / list variables. Save one to make it a reusable, editable structure.</p>
      {#each inferredStructs as s (s.name)}
        <div class="row">
          <span class="k ro">{s.name}</span>
          <span class="v ro" title={s.fields.map((f) => `${f.name}: ${f.type}`).join('\n')}>{s.fields.map((f) => f.name).join(', ')}</span>
          <button class="save" onclick={() => saveInferred(s.name, s.fields)} title="save as structure">＋</button>
        </div>
      {/each}
    {/if}
  {:else}
    <div class="as-h">Style</div>
    <label class="f"><span>Theme</span>
      <select value={(app.theme?.mode as string) ?? 'light'} onchange={(e) => setTheme('mode', (e.currentTarget as HTMLSelectElement).value)}>
        <option value="light">light</option><option value="dark">dark</option>
      </select>
    </label>
    <label class="f"><span>Accent</span>
      <input type="color" value={(app.theme?.accent as string) ?? '#0369a1'} onchange={(e) => setTheme('accent', (e.currentTarget as HTMLInputElement).value)} />
    </label>
    <div class="as-sub">Custom CSS</div>
    <textarea class="css" value={app.css ?? ''} placeholder={'.harness .cell { border-radius: 12px }'} oninput={(e) => (app.css = (e.currentTarget as HTMLTextAreaElement).value)}></textarea>
  {/if}
</div>

<style>
  .as { display: flex; flex-direction: column; gap: 7px; padding: 12px; font: 13px system-ui, Arial, sans-serif; color: #0f172a; height: 100%; overflow: auto; box-sizing: border-box; }
  .as-h { font: 700 13px system-ui; }
  .as-sub { font: 600 10px system-ui; text-transform: uppercase; letter-spacing: .3px; color: #94a3b8; margin-top: 4px; }
  .as-hint { margin: 0 0 4px; color: #64748b; font-size: 12px; line-height: 1.4; }
  .as-hint code { font-family: ui-monospace, monospace; font-size: 11px; background: #eef2f6; padding: 1px 4px; border-radius: 4px; }
  .row { display: flex; align-items: center; gap: 5px; }
  .row .k { width: 34%; padding: 4px 7px; border: 1px solid #cbd5e1; border-radius: 6px; font: 600 12px system-ui; }
  .row .v { flex: 1; min-width: 0; padding: 4px 7px; border: 1px solid #cbd5e1; border-radius: 6px; font: 12px ui-monospace, monospace; }
  .row .rm { padding: 2px 7px; border: 1px solid #fecaca; border-radius: 5px; background: #fff; color: #b91c1c; cursor: pointer; font-size: 11px; }
  .row .k.ro { display: flex; align-items: center; color: #0f172a; font: 600 12px system-ui; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row .v.ro { display: flex; align-items: center; color: #475569; background: #f8fafc; border-color: #e2e8f0; font: 11px ui-monospace, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: default; }
  .row .save { padding: 2px 8px; border: 1px solid #0369a1; border-radius: 5px; background: #eff6ff; color: #0369a1; cursor: pointer; font-size: 12px; }
  .empty { color: #94a3b8; font-style: italic; font-size: 12px; }
  .add { align-self: flex-start; padding: 4px 11px; border: 1px solid #0369a1; border-radius: 6px; background: #eff6ff; color: #0369a1; font: 600 12px system-ui; cursor: pointer; }
  .f { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .f span { color: #64748b; font-size: 12px; }
  .f select { width: 60%; padding: 4px 7px; border: 1px solid #cbd5e1; border-radius: 6px; font: 12px system-ui; }
  .f input[type=color] { width: 40px; height: 26px; padding: 0; border: 1px solid #cbd5e1; border-radius: 6px; }
  .css { width: 100%; box-sizing: border-box; flex: 1; min-height: 140px; padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 7px; font: 12px ui-monospace, monospace; resize: vertical; }
</style>
