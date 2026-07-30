<script lang="ts">
  // VisualEditor — the human authoring surface as a COLLAPSIBLE COMPONENT TREE (the .app is
  // a nested children[] tree — HTML/Svelte-style — so we show + edit it as one). A search bar
  // adds to the root or, when a container's ＋ is armed, as a CHILD. Per node: collapse,
  // rename, ⚙ props, ↑↓ within siblings, ✕. Every edit calls a `gui` verb on the ONE .app.
  import type { AppManifest } from '$lib/appkit/manifest/types';
  import { dispatch } from '$lib/appkit/verbs/dispatch';
  import { searchCatalog } from '$lib/appkit/catalog/catalog';
  import { getComponentMeta } from '$lib/appkit/catalog/components';
  import { panelEditor } from './panels/editor-registry';

  let { app }: { app: AppManifest } = $props();
  let query = $state('');
  let searchOpen = $state(false); // the add-component search popover
  let searchStyle = $state(''); // fixed-position style anchored to the clicked ＋
  let openPanel = $state<any>(null); // the node whose settings popover is open
  let openStyle = $state(''); // fixed-position style anchored to the ⚙ button
  let settingsTab = $state<'props' | 'style'>('props'); // component editor tab
  let appOpen = $state(false); // app-level settings popover
  let appStyle = $state('');
  let appTab = $state<'vars' | 'structures' | 'style'>('vars');
  let addTarget = $state<string | null>(null); // container id to add INTO (null → root)
  let collapsed = $state<Set<string>>(new Set());
  let queryEl = $state<HTMLInputElement>();

  const results = $derived(searchCatalog(query, { type: 'component' }).slice(0, 8));
  const store = () => ({ appStore: app as any });

  function defaultProps(kind: string): Record<string, unknown> | undefined {
    const props: Record<string, unknown> = {};
    for (const p of getComponentMeta(kind)?.props ?? []) if (p.default !== undefined) props[p.name] = p.default;
    return Object.keys(props).length ? props : undefined;
  }

  async function addKind(kind: string) {
    const meta = getComponentMeta(kind);
    const panel: Record<string, unknown> = { id: kind, kind, title: meta?.name ?? kind };
    const props = defaultProps(kind);
    if (props) panel.props = props;
    if (meta?.acceptsChildren) panel.children = [];
    if (addTarget) await dispatch('addChildPanel', { parentId: addTarget, panel }, store());
    else await dispatch('definePanel', { panel }, store());
    closeSearch();
  }

  /** Open the add-component search POPOVER anchored to the clicked ＋ (target = a parent id
   *  to add INTO, or null for the root). */
  function openSearch(target: string | null, btn: HTMLElement) {
    addTarget = target;
    if (target) uncollapse(target);
    query = '';
    const r = btn.getBoundingClientRect();
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
    searchStyle = `top:${r.bottom + 4}px; left:${Math.max(8, Math.min(r.left, vw - 300))}px;`;
    searchOpen = true;
    setTimeout(() => queryEl?.focus(), 0);
  }
  function closeSearch() {
    searchOpen = false;
    addTarget = null;
    query = '';
  }

  const remove = (id: string) => dispatch('removePanel', { panelId: id }, store());
  const move = (id: string, idx: number, delta: number) =>
    dispatch('movePanel', { panelId: id, to: idx + delta }, store());
  const indent = (id: string) => dispatch('indentPanel', { panelId: id }, store()); // → demote into prev
  const outdent = (id: string) => dispatch('outdentPanel', { panelId: id }, store()); // ← promote out
  const rename = (id: string, title: string) => dispatch('setPanelProp', { panelId: id, key: 'title', value: title }, store());

  function openSettings(p: any, btn: HTMLElement) {
    if (openPanel?.id === p.id) return closeSettings();
    settingsTab = 'props';
    const r = btn.getBoundingClientRect();
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
    openStyle = `top:${r.bottom + 4}px; left:${Math.max(8, Math.min(r.left, vw - 320))}px;`;
    openPanel = p;
  }
  const closeSettings = () => (openPanel = null);
  const propVal = (p: any, name: string, dflt: unknown) => p.props?.[name] ?? dflt;
  const setProp = (id: string, name: string, value: unknown) =>
    dispatch('setComponentProp', { panelId: id, name, value }, store());

  // ── Wiring (source + events) — bind a component to a verb without hand-editing JSON ──
  const SOURCE_KINDS = new Set(['list', 'form', 'table', 'grid', 'edittable', 'bake3d', 'svg']);
  const DATA_VERBS = ['listDocs', 'listParts', 'loadData', 'getParams', 'bake', 'loadDoc', 'http', 'compile', 'getSource'];
  const MUTATE_VERBS = ['setParam', 'addRow', 'removeRow', 'reorderRow', 'patchDoc', 'http'];
  const ARG_KEY: Record<string, string> = { loadData: 'slot', http: 'url', listParts: 'category', listDocs: 'docType' };
  const eventsFor = (kind: string): string[] => (kind === 'button' ? ['click'] : kind === 'edittable' ? ['save'] : []);
  const wireableKind = (kind: string) => SOURCE_KINDS.has(kind) || eventsFor(kind).length > 0;

  /** Build a binding's args from a single primary arg (contextual per verb). */
  function argsFor(verb: string, arg: string): Record<string, unknown> {
    const a = (arg ?? '').trim();
    if (!a) return verb === 'getParams' || verb === 'bake' || verb === 'loadDoc' ? { id: '$active' } : {};
    return { [ARG_KEY[verb] ?? 'id']: a };
  }
  function argOf(b: any): string {
    if (!b?.args) return '';
    const k = ARG_KEY[b.verb];
    if (k) return String(b.args[k] ?? '');
    return b.args.id && b.args.id !== '$active' ? String(b.args.id) : '';
  }
  const argHint = (verb: string) =>
    ({ loadData: 'slot name', http: '/api/…', listParts: 'category', listDocs: 'docType' } as Record<string, string>)[verb] ?? '(uses $active)';

  const setSource = (id: string, verb: string, arg?: string) =>
    dispatch('setPanelProp', { panelId: id, key: 'source', value: verb ? { verb, args: argsFor(verb, arg ?? '') } : undefined }, store());
  function setEvent(p: any, ev: string, verb: string, arg?: string) {
    const on = { ...(p.on ?? {}) };
    if (verb) on[ev] = { verb, args: argsFor(verb, arg ?? '') };
    else delete on[ev];
    return dispatch('setPanelProp', { panelId: p.id, key: 'on', value: on }, store());
  }

  // ── App-level settings (variables + style) ──────────────────────────────────
  function openApp(btn: HTMLElement) {
    if (appOpen) return (appOpen = false);
    const r = btn.getBoundingClientRect();
    appStyle = `top:${r.bottom + 4}px; left:${Math.max(8, r.left)}px;`;
    appOpen = true;
  }
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
  const setTheme = (k: 'mode' | 'accent', v: string) => (app.theme = { ...(app.theme ?? {}), [k]: v });
  // Data structures (reusable field sets)
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

  function toggleCollapse(id: string) {
    const s = new Set(collapsed);
    s.has(id) ? s.delete(id) : s.add(id);
    collapsed = s;
  }
  function uncollapse(id: string) {
    if (collapsed.has(id)) {
      const s = new Set(collapsed);
      s.delete(id);
      collapsed = s;
    }
  }
</script>

{#snippet propsForm(p, meta)}
  <div class="props">
    {#each meta.props as spec (spec.name)}
      <label class="prop">
        <span class="pl">{spec.label ?? spec.name}</span>
        {#if spec.type === 'boolean'}
          <input type="checkbox" checked={!!propVal(p, spec.name, spec.default)} onchange={(e) => setProp(p.id, spec.name, (e.currentTarget as HTMLInputElement).checked)} />
        {:else if spec.type === 'select'}
          <select value={String(propVal(p, spec.name, spec.default) ?? '')} onchange={(e) => setProp(p.id, spec.name, (e.currentTarget as HTMLSelectElement).value)}>
            {#each spec.options ?? [] as opt}<option value={opt}>{opt}</option>{/each}
          </select>
        {:else if spec.type === 'number'}
          <input type="number" value={propVal(p, spec.name, spec.default) ?? ''} onchange={(e) => setProp(p.id, spec.name, Number((e.currentTarget as HTMLInputElement).value))} />
        {:else if spec.type === 'color'}
          <input type="color" value={String(propVal(p, spec.name, spec.default) ?? '#000000')} onchange={(e) => setProp(p.id, spec.name, (e.currentTarget as HTMLInputElement).value)} />
        {:else}
          <input type="text" value={String(propVal(p, spec.name, spec.default) ?? '')} placeholder={spec.name} onchange={(e) => setProp(p.id, spec.name, (e.currentTarget as HTMLInputElement).value)} />
        {/if}
      </label>
    {/each}
  </div>
{/snippet}

{#snippet wiring(p)}
  <div class="wire">
    {#if SOURCE_KINDS.has(p.kind)}
      <label class="prop">
        <span class="pl">🔌 source</span>
        <select value={p.source?.verb ?? ''} onchange={(e) => setSource(p.id, (e.currentTarget as HTMLSelectElement).value)}>
          <option value="">— none —</option>
          {#each DATA_VERBS as v}<option value={v}>{v}</option>{/each}
        </select>
      </label>
      {#if p.source?.verb}
        <label class="prop">
          <span class="pl">arg</span>
          <input value={argOf(p.source)} placeholder={argHint(p.source.verb)} onchange={(e) => setSource(p.id, p.source.verb, (e.currentTarget as HTMLInputElement).value)} />
        </label>
      {/if}
    {/if}
    {#each eventsFor(p.kind) as ev}
      <label class="prop">
        <span class="pl">⚡ on {ev}</span>
        <select value={p.on?.[ev]?.verb ?? ''} onchange={(e) => setEvent(p, ev, (e.currentTarget as HTMLSelectElement).value)}>
          <option value="">— none —</option>
          {#each [...DATA_VERBS, ...MUTATE_VERBS] as v}<option value={v}>{v}</option>{/each}
        </select>
      </label>
      {#if p.on?.[ev]?.verb}
        <label class="prop">
          <span class="pl">{ev} arg</span>
          <input value={argOf(p.on[ev])} placeholder={argHint(p.on[ev].verb)} onchange={(e) => setEvent(p, ev, p.on[ev].verb, (e.currentTarget as HTMLInputElement).value)} />
        </label>
      {/if}
    {/each}
  </div>
{/snippet}

{#snippet node(p, siblings, idx, depth)}
  {@const meta = getComponentMeta(p.kind)}
  {@const kids = p.children ?? []}
  {@const shown = !collapsed.has(p.id)}
  {@const canEdit = !!meta?.props?.length || wireableKind(p.kind)}
  {@const prevNests = idx > 0 && !!getComponentMeta(siblings[idx - 1]?.kind)?.acceptsChildren}
  <li class="node" class:target={addTarget === p.id}>
    <div class="row" class:sel={openPanel?.id === p.id}>
      <button class="caret" class:hide={!kids.length} onclick={() => toggleCollapse(p.id)} title={shown ? 'collapse' : 'expand'}>{shown ? '▾' : '▸'}</button>
      <button class="gear" class:on={openPanel?.id === p.id} disabled={!canEdit} onclick={(e) => openSettings(p, e.currentTarget as HTMLElement)} title={canEdit ? 'settings' : 'no settings'}>⚙</button>
      <span class="kind" title={p.title ?? p.id}>{p.kind}</span>
      {#if meta?.acceptsChildren}<button class="add-child" title="add child" onclick={(e) => openSearch(p.id, e.currentTarget as HTMLElement)}>＋</button>{/if}
      <button onclick={() => outdent(p.id)} disabled={depth === 0} title="promote (out of parent)">←</button>
      <button onclick={() => move(p.id, idx, -1)} disabled={idx === 0} title="up">↑</button>
      <button onclick={() => move(p.id, idx, 1)} disabled={idx === siblings.length - 1} title="down">↓</button>
      <button onclick={() => indent(p.id)} disabled={!prevNests} title="demote (into previous)">→</button>
      <button class="rm" onclick={() => remove(p.id)} title="remove">✕</button>
    </div>
    {#if kids.length && shown}
      <ul class="children">
        {#each kids as c, ci (c.id)}{@render node(c, kids, ci, depth + 1)}{/each}
      </ul>
    {/if}
  </li>
{/snippet}

<div class="ve">
  <div class="topbar">
    <button class="add-top" onclick={(e) => openSearch(null, e.currentTarget as HTMLElement)} disabled={searchOpen} title="add a component">＋ Add</button>
    <button class="app-top" class:on={appOpen} onclick={(e) => openApp(e.currentTarget as HTMLElement)} title="app settings — variables + style">⚙ App</button>
  </div>

  <ul class="tree">
    {#each app.panels ?? [] as p, i (p.id)}{@render node(p, app.panels, i, 0)}{/each}
    {#if !(app.panels?.length)}<li class="empty">empty — search above to add a component</li>{/if}
  </ul>

  <div class="hint">A tree of components (nest with ＋ on containers). Edits call the same gui verbs the AI uses.</div>
</div>

{#if appOpen}
  <div class="settings-backdrop" role="presentation" onclick={() => (appOpen = false)}></div>
  <div class="settings-pop app-pop" style={appStyle}>
    <div class="sp-head">
      <span class="sp-kind">App</span>
      <div class="sp-tabs">
        <button class:on={appTab === 'vars'} onclick={() => (appTab = 'vars')}>Variables</button>
        <button class:on={appTab === 'structures'} onclick={() => (appTab = 'structures')}>Data</button>
        <button class:on={appTab === 'style'} onclick={() => (appTab = 'style')}>Style</button>
      </div>
      <button class="sp-close" onclick={() => (appOpen = false)} title="close">✕</button>
    </div>
    {#if appTab === 'vars'}
      <div class="wire">
        {#each compEntries as [name, formula] (name)}
          <div class="var-row">
            <input class="vn" value={name} onchange={(e) => renameComputed(name, (e.currentTarget as HTMLInputElement).value)} />
            <input class="vf" value={formula} placeholder="= w * h" onchange={(e) => setFormula(name, (e.currentTarget as HTMLInputElement).value)} />
            <button class="rm" onclick={() => delComputed(name)} title="remove">✕</button>
          </div>
        {/each}
        {#if !compEntries.length}<div class="sp-note">no variables — a formula over params/vars, referenced as $vars.name</div>{/if}
        <button class="ete-add" onclick={addComputed}>＋ variable</button>
      </div>
    {:else if appTab === 'structures'}
      <div class="wire">
        {#each structEntries as [name, fields] (name)}
          <div class="var-row">
            <input class="vn" value={name} onchange={(e) => renameStructure(name, (e.currentTarget as HTMLInputElement).value)} />
            <input class="vf" value={fieldsCsv(fields)} placeholder="od, id, top" onchange={(e) => setFields(name, (e.currentTarget as HTMLInputElement).value)} />
            <button class="rm" onclick={() => delStructure(name)} title="remove">✕</button>
          </div>
        {/each}
        {#if !structEntries.length}<div class="sp-note">no structures — a reusable field set; a table adopts one via its “From structure” picker</div>{/if}
        <button class="ete-add" onclick={addStructure}>＋ structure</button>
      </div>
    {:else}
      <div class="wire">
        <label class="prop"><span class="pl">theme</span>
          <select value={(app.theme?.mode as string) ?? 'light'} onchange={(e) => setTheme('mode', (e.currentTarget as HTMLSelectElement).value)}>
            <option value="light">light</option><option value="dark">dark</option>
          </select>
        </label>
        <label class="prop"><span class="pl">accent</span>
          <input type="color" value={(app.theme?.accent as string) ?? '#0369a1'} onchange={(e) => setTheme('accent', (e.currentTarget as HTMLInputElement).value)} />
        </label>
        <span class="pl">custom CSS</span>
        <textarea class="app-css" value={app.css ?? ''} placeholder=".harness .cell {'{'} border-radius: 12px {'}'}" oninput={(e) => (app.css = (e.currentTarget as HTMLTextAreaElement).value)}></textarea>
      </div>
    {/if}
  </div>
{/if}

{#if searchOpen}
  <div class="settings-backdrop" role="presentation" onclick={closeSearch}></div>
  <div class="search-pop" style={searchStyle}>
    <input
      bind:this={queryEl}
      class="q"
      placeholder={addTarget ? `add into “${addTarget}”…` : 'search components — div · row · text · table · 3d…'}
      bind:value={query}
    />
    <ul class="results">
      {#each results as r (r.key)}
        <li>
          <button onmousedown={(e) => { e.preventDefault(); addKind(r.key); }}>
            <span class="rk">{r.name}</span>
            <span class="rg">{r.group}</span>
            <span class="rd">{r.description}</span>
          </button>
        </li>
      {/each}
      {#if !results.length}<li class="no-res">no match</li>{/if}
    </ul>
  </div>
{/if}

{#if openPanel}
  {@const meta = getComponentMeta(openPanel.kind)}
  <div class="settings-backdrop" role="presentation" onclick={closeSettings}></div>
  <div class="settings-pop" style={openStyle}>
    <div class="sp-head">
      <span class="sp-kind">{openPanel.kind}</span>
      <div class="sp-tabs">
        <button class:on={settingsTab === 'props'} onclick={() => (settingsTab = 'props')}>Props</button>
        <button class:on={settingsTab === 'style'} onclick={() => (settingsTab = 'style')}>Style</button>
      </div>
      <button class="sp-close" onclick={closeSettings} title="close">✕</button>
    </div>
    <label class="prop">
      <span class="pl">title</span>
      <input value={openPanel.title ?? ''} placeholder={openPanel.id} onchange={(e) => rename(openPanel.id, (e.currentTarget as HTMLInputElement).value)} />
    </label>
    {#if settingsTab === 'props'}
      {#if panelEditor(openPanel.kind)}
        {@const CustomEditor = panelEditor(openPanel.kind)}
        <CustomEditor panel={openPanel} structures={app.structures} onProp={(name, value) => setProp(openPanel.id, name, value)} />
      {:else if meta?.props?.length}
        {@render propsForm(openPanel, meta)}
      {/if}
      {#if wireableKind(openPanel.kind)}{@render wiring(openPanel)}{/if}
    {:else}
      <div class="wire">
        <label class="prop"><span class="pl">CSS classes</span>
          <input value={(openPanel.props?.class as string) ?? ''} placeholder="e.g. p-4 rounded" onchange={(e) => setProp(openPanel.id, 'class', (e.currentTarget as HTMLInputElement).value)} />
        </label>
        <label class="prop"><span class="pl">inline style</span>
          <input value={(openPanel.props?.style as string) ?? ''} placeholder="e.g. padding:12px;background:#f8fafc" onchange={(e) => setProp(openPanel.id, 'style', (e.currentTarget as HTMLInputElement).value)} />
        </label>
        <div class="sp-note">Inline style always applies; Tailwind classes only if already in the build.</div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .ve { display: flex; flex-direction: column; gap: 8px; padding: 10px; font: 12.5px system-ui, Arial, sans-serif; color: #0f172a; height: 100%; overflow: auto; }
  .topbar { display: flex; gap: 6px; }
  .add-top { padding: 6px 12px; border: 1px solid #0369a1; border-radius: 7px; background: #0369a1; color: #fff; font: 600 12.5px system-ui; cursor: pointer; }
  .add-top:hover:not(:disabled) { filter: brightness(1.08); }
  .add-top:disabled { opacity: .5; cursor: default; }
  .app-top { margin-left: auto; padding: 6px 11px; border: 1px solid #cbd5e1; border-radius: 7px; background: #fff; color: #334155; font: 600 12.5px system-ui; cursor: pointer; }
  .app-top.on { border-color: #0369a1; background: #eff6ff; color: #0369a1; }
  .app-pop { width: 320px; }
  .var-row { display: flex; align-items: center; gap: 4px; }
  .var-row .vn { width: 34%; padding: 3px 6px; border: 1px solid #cbd5e1; border-radius: 5px; font: 600 12px system-ui; }
  .var-row .vf { flex: 1; min-width: 0; padding: 3px 6px; border: 1px solid #cbd5e1; border-radius: 5px; font: 12px ui-monospace, monospace; }
  .var-row .rm { padding: 1px 6px; border: 1px solid #fecaca; border-radius: 4px; background: #fff; color: #b91c1c; cursor: pointer; font-size: 11px; }
  .app-css { width: 100%; box-sizing: border-box; min-height: 84px; padding: 6px 8px; border: 1px solid #cbd5e1; border-radius: 6px; font: 12px ui-monospace, monospace; resize: vertical; }
  .search-pop { position: fixed; z-index: 41; width: 300px; max-height: 62vh; overflow: auto; background: #fff; border: 1px solid #e5e7eb; border-radius: 9px; box-shadow: 0 14px 40px rgba(2,6,23,.18); padding: 6px; }
  .search-pop .q { width: 100%; box-sizing: border-box; padding: 6px 9px; border: 1px solid #cbd5e1; border-radius: 7px; font: 12.5px system-ui; margin-bottom: 4px; }
  .search-pop .q:focus { outline: none; border-color: #0369a1; box-shadow: 0 0 0 3px rgba(3,105,161,.12); }
  .no-res { padding: 8px 9px; color: #94a3b8; font-style: italic; font-size: 12px; }
  .results { list-style: none; margin: 0; padding: 0; }
  .results button { display: grid; grid-template-columns: auto auto 1fr; align-items: baseline; gap: 8px; width: 100%; text-align: left; padding: 6px 9px; border: 0; border-radius: 6px; background: transparent; cursor: pointer; }
  .results button:hover { background: #f1f5f9; }
  .results .rk { font-weight: 600; }
  .results .rg { font: 600 9px system-ui; text-transform: uppercase; letter-spacing: .3px; color: #0369a1; background: #eff6ff; padding: 1px 5px; border-radius: 999px; }
  .results .rd { color: #64748b; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .tree, .children { list-style: none; margin: 0; padding: 0; }
  .children { margin-left: 8px; padding-left: 7px; border-left: 1px solid #e5e7eb; }
  .node { margin-top: 2px; }
  .node.target > .row { outline: 2px solid #0369a1; outline-offset: 1px; border-radius: 5px; }
  .row { display: flex; align-items: center; gap: 3px; padding: 1px 5px; border: 1px solid #e8edf2; border-radius: 5px; background: #fff; }
  .row:hover { border-color: #cbd5e1; }
  .row.sel { border-color: #0369a1; background: #f0f9ff; }
  .caret { width: 15px; border: 0; background: transparent; color: #94a3b8; cursor: pointer; padding: 0; font-size: 10px; }
  .caret.hide { visibility: hidden; }
  /* the KIND is the row label (dark, readable); the title lives in the tooltip (title=) */
  .kind { flex: 1; min-width: 40px; padding: 2px 4px; font: 600 13px system-ui; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: default; }
  .row button { padding: 1px 6px; border: 1px solid #d7dee6; border-radius: 4px; background: #fff; cursor: pointer; font-size: 11px; line-height: 1.4; }
  .row button:disabled { opacity: .3; cursor: default; }
  .add-child { color: #0369a1; border-color: #bae6fd !important; font-weight: 700; }
  .gear.on { border-color: #0369a1; background: #eff6ff; }
  .rm { color: #b91c1c; border-color: #fecaca !important; }
  .empty { padding: 8px; text-align: center; color: #94a3b8; font-style: italic; border: 1px dashed #e5e7eb; border-radius: 6px; margin-top: 4px; }

  .prop { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .prop .pl { color: #64748b; font-size: 12px; }
  .prop input[type=text], .prop input[type=number], .prop select { flex: 1; min-width: 0; width: auto; max-width: 62%; padding: 3px 6px; border: 1px solid #cbd5e1; border-radius: 5px; font: 12px system-ui; }
  .prop input[type=color] { width: 32px; height: 22px; padding: 0; border: 1px solid #cbd5e1; border-radius: 5px; }
  .hint { color: #94a3b8; font-size: 11px; font-style: italic; }

  /* Settings popover (props + wiring + title) — anchored to the ⚙ button */
  .settings-backdrop { position: fixed; inset: 0; z-index: 40; }
  .settings-pop { position: fixed; z-index: 41; width: 300px; max-height: 72vh; overflow: auto; background: #fff; border: 1px solid #e5e7eb; border-radius: 9px; box-shadow: 0 14px 40px rgba(2,6,23,.18); padding: 9px 11px; display: flex; flex-direction: column; gap: 4px; }
  .sp-head { display: flex; align-items: center; justify-content: space-between; }
  .sp-kind { font: 600 9.5px system-ui; text-transform: uppercase; letter-spacing: .3px; color: #94a3b8; }
  .sp-tabs { display: flex; gap: 2px; }
  .sp-tabs button { padding: 2px 9px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: #64748b; font: 600 11px system-ui; cursor: pointer; }
  .sp-tabs button.on { color: #0369a1; border-bottom-color: #0369a1; }
  .sp-note { color: #94a3b8; font-size: 10.5px; font-style: italic; margin-top: 2px; }
  .sp-close { border: 0; background: transparent; color: #64748b; cursor: pointer; font-size: 13px; padding: 0 2px; }
  .settings-pop .props, .settings-pop .wire { display: flex; flex-direction: column; gap: 7px; margin: 4px 0 0; }
  .settings-pop .prop input[type=text], .settings-pop .prop select, .settings-pop .prop input[type=number] { max-width: 60%; }
</style>
