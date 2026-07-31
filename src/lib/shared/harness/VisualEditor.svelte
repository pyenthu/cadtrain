<script lang="ts">
  // VisualEditor — the human authoring surface as a COLLAPSIBLE COMPONENT TREE (the .app is
  // a nested children[] tree — HTML/Svelte-style — so we show + edit it as one). A search bar
  // adds to the root or, when a container's ＋ is armed, as a CHILD. Per node: collapse,
  // rename, ⚙ props, ↑↓ within siblings, ✕. Every edit calls a `gui` verb on the ONE .app.
  import type { AppManifest } from '$lib/appkit/manifest/types';
  import { dispatch } from '$lib/appkit/verbs/dispatch';
  import { searchCatalog } from '$lib/appkit/catalog/catalog';
  import { getComponentMeta } from '$lib/appkit/catalog/components';
  import { resolveRef } from '$lib/appkit/manifest/refs';
  import { panelEditor } from './panels/editor-registry';

  let {
    app,
    onScopedBuild,
  }: { app: AppManifest; onScopedBuild?: (panelId: string, kind: string, prompt: string) => Promise<unknown> } = $props();
  let query = $state('');
  let searchOpen = $state(false); // the add-component search popover
  let searchStyle = $state(''); // fixed-position style anchored to the clicked ＋
  let behaviorOnly = $state(false); // target is a leaf → offer only popover/tooltip
  let openPanelId = $state<string | null>(null); // settings popover target (by id → live-resolved so it survives an AI rebuild)
  let openStyle = $state(''); // fixed-position style anchored to the ⚙ button
  let settingsTab = $state<'props' | 'style' | 'events'>('props'); // component editor tab
  let aiPrompt = $state(''); // component-scoped AI prompt (top of the ⚙ popover)
  let aiBusy = $state(false);
  let addTarget = $state<string | null>(null); // container id to add INTO (null → root)
  let collapsed = $state<Set<string>>(new Set());
  let queryEl = $state<HTMLInputElement>();
  let templates = $state<Array<{ id: string; name: string; count: number }>>([]); // saved components (.app→component)

  const results = $derived(
    (behaviorOnly
      ? searchCatalog(query, { type: 'component' }).filter((r) => r.key === 'popover' || r.key === 'tooltip')
      : searchCatalog(query, { type: 'component' })
    ).slice(0, 8),
  );
  const store = () => ({ appStore: app as any });

  /** Find a panel by id anywhere in the tree (so the open popover re-resolves after any edit). */
  function findPanel(list: any[], id: string): any {
    for (const p of list ?? []) {
      if (p.id === id) return p;
      const c = findPanel(p.children, id);
      if (c) return c;
    }
    return null;
  }
  const openPanel = $derived(openPanelId ? findPanel(app.panels, openPanelId) : null);

  /** Fixed-position style anchored to a button that STAYS in the viewport: clamps left, caps the
   *  height to the space below, and flips ABOVE the anchor when there's more room up top. */
  function anchorStyle(btn: HTMLElement, width = 300): string {
    const r = btn.getBoundingClientRect();
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
    const left = Math.max(8, Math.min(r.left, vw - width - 8));
    const below = vh - r.bottom - 12;
    const above = r.top - 12;
    if (below >= 220 || below >= above) return `top:${r.bottom + 4}px; left:${left}px; max-height:${Math.max(140, below)}px;`;
    return `bottom:${vh - r.top + 4}px; left:${left}px; max-height:${Math.max(140, above)}px;`;
  }

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
  function openSearch(target: string | null, btn: HTMLElement, canNest = true) {
    addTarget = target;
    behaviorOnly = !!target && !canNest; // a leaf can only host popover/tooltip
    if (target) uncollapse(target);
    query = '';
    searchStyle = anchorStyle(btn, 300);
    searchOpen = true;
    fetchTemplates(); // saved components appear alongside catalog results
    setTimeout(() => queryEl?.focus(), 0);
  }
  function closeSearch() {
    searchOpen = false;
    addTarget = null;
    behaviorOnly = false;
    query = '';
  }

  // ── .app → component (save a composition; insert saved ones from the palette) ──
  const templateResults = $derived(
    query.trim() ? templates.filter((t) => t.name.toLowerCase().includes(query.trim().toLowerCase())) : templates,
  );
  async function fetchTemplates() {
    try {
      const r = await fetch('/api/app/templates');
      if (r.ok) templates = (await r.json()).templates ?? [];
    } catch {
      /* ignore */
    }
  }
  async function insertTemplate(id: string) {
    try {
      const r = await fetch(`/api/app/templates?id=${encodeURIComponent(id)}`);
      if (!r.ok) throw new Error(await r.text());
      const t = await r.json();
      await dispatch('insertTree', { nodes: t.tree, parentId: addTarget ?? undefined }, store());
    } catch {
      /* ignore */
    }
    closeSearch();
  }

  const remove = (id: string) => dispatch('removePanel', { panelId: id }, store());
  const move = (id: string, idx: number, delta: number) =>
    dispatch('movePanel', { panelId: id, to: idx + delta }, store());
  const indent = (id: string) => dispatch('indentPanel', { panelId: id }, store()); // → demote into prev
  const outdent = (id: string) => dispatch('outdentPanel', { panelId: id }, store()); // ← promote out
  const rename = (id: string, title: string) => dispatch('setPanelProp', { panelId: id, key: 'title', value: title }, store());

  function openSettings(p: any, btn: HTMLElement) {
    if (openPanelId === p.id) return closeSettings();
    settingsTab = 'props';
    aiPrompt = '';
    openStyle = anchorStyle(btn, 320);
    openPanelId = p.id;
  }
  const closeSettings = () => (openPanelId = null);
  /** Run the ⚙ popover's ✨ bar — a component-scoped AI edit via the parent. */
  async function runScopedAi() {
    if (!openPanel || !aiPrompt.trim() || !onScopedBuild) return;
    aiBusy = true;
    try {
      await onScopedBuild(openPanel.id, openPanel.kind, aiPrompt.trim());
      aiPrompt = '';
    } finally {
      aiBusy = false;
    }
  }
  // Resolve a prop for DISPLAY: promoted props hold a $vars.<id>.<key> ref, so resolve it against
  // the store (the same resolver the components use) → the input shows the real value, not the ref.
  // Writes go through setProp → setComponentProp, which writes back THROUGH the ref to the store.
  const propVal = (p: any, name: string, dflt: unknown) =>
    resolveRef(p.props?.[name], { vars: app.vars ?? {} }) ?? dflt;
  const setProp = (id: string, name: string, value: unknown) =>
    dispatch('setComponentProp', { panelId: id, name, value }, store());

  // ── Wiring (source + events) — bind a component to a verb without hand-editing JSON ──
  const SOURCE_KINDS = new Set(['list', 'form', 'table', 'grid', 'edittable', 'bake3d', 'svg']);
  const DATA_VERBS = ['listDocs', 'listParts', 'loadData', 'getParams', 'bake', 'loadDoc', 'http', 'compile', 'getSource'];
  const MUTATE_VERBS = ['setParam', 'addRow', 'removeRow', 'reorderRow', 'patchDoc', 'http'];
  const ARG_KEY: Record<string, string> = { loadData: 'slot', http: 'url', listParts: 'category', listDocs: 'docType' };
  const eventsFor = (kind: string): string[] => (kind === 'button' ? ['click'] : kind === 'edittable' ? ['save'] : []);

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

{#snippet sourceWiring(p)}
  {#if SOURCE_KINDS.has(p.kind)}
    <div class="wire">
      <div class="wire-h">Data source</div>
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
    </div>
  {/if}
{/snippet}

{#snippet eventWiring(p)}
  <div class="wire">
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
    {#if !eventsFor(p.kind).length}
      <div class="sp-empty">
        <span>No standard events for <b>{p.kind}</b> yet.</span>
        <span class="sp-note">Fire an app event or wire a verb here once event propagation lands — or ask ✨ above.</span>
      </div>
    {/if}
  </div>
{/snippet}

{#snippet node(p, siblings, idx, depth)}
  {@const meta = getComponentMeta(p.kind)}
  {@const kids = p.children ?? []}
  {@const shown = !collapsed.has(p.id)}
  {@const prevNests = idx > 0 && !!getComponentMeta(siblings[idx - 1]?.kind)?.acceptsChildren}
  <li class="node" class:target={addTarget === p.id}>
    <div class="row" class:sel={openPanel?.id === p.id}>
      <button class="caret" class:hide={!kids.length} onclick={() => toggleCollapse(p.id)} title={shown ? 'collapse' : 'expand'}>{shown ? '▾' : '▸'}</button>
      <button class="gear" class:on={openPanel?.id === p.id} onclick={(e) => openSettings(p, e.currentTarget as HTMLElement)} title="settings">⚙</button>
      <span class="kind" title={p.title ?? p.id}>{p.kind}</span>
      <button class="add-child" title={meta?.acceptsChildren ? 'add child' : 'add popover / tooltip'} onclick={(e) => openSearch(p.id, e.currentTarget as HTMLElement, !!meta?.acceptsChildren)}>＋</button>
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
  </div>

  <ul class="tree">
    {#each app.panels ?? [] as p, i (p.id)}{@render node(p, app.panels, i, 0)}{/each}
    {#if !(app.panels?.length)}<li class="empty">empty — search above to add a component</li>{/if}
  </ul>

  <div class="hint">A tree of components (nest with ＋ on containers). Edits call the same gui verbs the AI uses.</div>
</div>

{#if searchOpen}
  <div class="settings-backdrop" role="presentation" onclick={closeSearch}></div>
  <div class="search-pop" style={searchStyle}>
    <input
      bind:this={queryEl}
      class="q"
      placeholder={behaviorOnly ? `popover / tooltip for “${addTarget}”…` : addTarget ? `add into “${addTarget}”…` : 'search components — div · row · text · table · 3d…'}
      bind:value={query}
    />
    {#if templateResults.length}
      <div class="res-group">Saved components</div>
      <ul class="results">
        {#each templateResults as t (t.id)}
          <li>
            <button onmousedown={(e) => { e.preventDefault(); insertTemplate(t.id); }}>
              <span class="rk">⊞ {t.name}</span>
              <span class="rg">component</span>
              <span class="rd">{t.count} top-level node{t.count === 1 ? '' : 's'}</span>
            </button>
          </li>
        {/each}
      </ul>
      <div class="res-group">Components</div>
    {/if}
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
      <input class="sp-title" value={openPanel.title ?? ''} placeholder={openPanel.id}
        onchange={(e) => rename(openPanel.id, (e.currentTarget as HTMLInputElement).value)} />
      <button class="sp-close" onclick={closeSettings} title="close">✕</button>
    </div>

    <form class="sp-ai" onsubmit={(e) => { e.preventDefault(); runScopedAi(); }}>
      <span class="sp-ai-ic">✨</span>
      <input placeholder={`style, add a variable, event or code for this ${openPanel.kind}…`}
        bind:value={aiPrompt} disabled={aiBusy || !onScopedBuild} />
      <button type="submit" class="sp-ai-go" disabled={aiBusy || !aiPrompt.trim() || !onScopedBuild} title="ask AI">
        {aiBusy ? '…' : '→'}
      </button>
    </form>

    <div class="sp-tabs">
      <button class:on={settingsTab === 'props'} onclick={() => (settingsTab = 'props')}>Props</button>
      <button class:on={settingsTab === 'style'} onclick={() => (settingsTab = 'style')}>Style</button>
      <button class:on={settingsTab === 'events'} onclick={() => (settingsTab = 'events')}>Events</button>
    </div>

    <div class="sp-body">
      {#if settingsTab === 'props'}
        {#if panelEditor(openPanel.kind)}
          {@const CustomEditor = panelEditor(openPanel.kind)}
          <CustomEditor panel={openPanel} structures={app.structures} onProp={(name, value) => setProp(openPanel.id, name, value)} />
        {:else if meta?.props?.length}
          {@render propsForm(openPanel, meta)}
        {:else}
          <div class="sp-empty"><span>No props for <b>{openPanel.kind}</b>.</span><span class="sp-note">Use Style or Events, or ask ✨ above.</span></div>
        {/if}
        {@render sourceWiring(openPanel)}
      {:else if settingsTab === 'style'}
        <div class="wire">
          <label class="prop"><span class="pl">CSS classes</span>
            <input value={(openPanel.props?.class as string) ?? ''} placeholder="e.g. p-4 rounded" onchange={(e) => setProp(openPanel.id, 'class', (e.currentTarget as HTMLInputElement).value)} />
          </label>
          <label class="prop"><span class="pl">inline style</span>
            <input value={(openPanel.props?.style as string) ?? ''} placeholder="e.g. padding:12px;background:#f8fafc" onchange={(e) => setProp(openPanel.id, 'style', (e.currentTarget as HTMLInputElement).value)} />
          </label>
          <div class="sp-note">Inline style always applies; Tailwind classes only if already in the build.</div>
        </div>
      {:else}
        {@render eventWiring(openPanel)}
      {/if}
    </div>
  </div>
{/if}

<style>
  .ve { display: flex; flex-direction: column; gap: 6px; padding: 8px; font: 10px system-ui, Arial, sans-serif; color: #0f172a; height: 100%; overflow: auto; }
  .topbar { display: flex; gap: 5px; }
  .add-top { padding: 4px 10px; border: 1px solid #0369a1; border-radius: 6px; background: #0369a1; color: #fff; font: 600 10px system-ui; cursor: pointer; }
  .add-top:hover:not(:disabled) { filter: brightness(1.08); }
  .add-top:disabled { opacity: .5; cursor: default; }
  .res-group { font: 600 9px system-ui; text-transform: uppercase; letter-spacing: .4px; color: #94a3b8; padding: 4px 9px 2px; }
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
  .children { margin-left: 6px; padding-left: 6px; border-left: 1px solid #e5e7eb; }
  .node { margin-top: 0; }
  .node.target > .row { outline: 2px solid #0369a1; outline-offset: 1px; border-radius: 5px; }
  .row { display: flex; align-items: center; gap: 2px; padding: 0 4px; border: 1px solid #e8edf2; border-radius: 4px; background: #fff; }
  .row:hover { border-color: #cbd5e1; }
  .row.sel { border-color: #0369a1; background: #f0f9ff; }
  .caret { width: 12px; border: 0; background: transparent; color: #94a3b8; cursor: pointer; padding: 0; font-size: 8px; }
  .caret.hide { visibility: hidden; }
  /* the KIND is the row label (dark, readable); the title lives in the tooltip (title=) */
  .kind { flex: 1; min-width: 36px; padding: 1px 3px; font: 600 10.5px system-ui; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: default; }
  .row button { padding: 0 5px; border: 1px solid #d7dee6; border-radius: 4px; background: #fff; cursor: pointer; font-size: 9px; line-height: 1.5; }
  .row button:disabled { opacity: .3; cursor: default; }
  .add-child { color: #0369a1; border-color: #bae6fd !important; font-weight: 700; }
  .gear.on { border-color: #0369a1; background: #eff6ff; }
  .rm { color: #b91c1c; border-color: #fecaca !important; }
  .empty { padding: 6px; text-align: center; color: #94a3b8; font-style: italic; border: 1px dashed #e5e7eb; border-radius: 6px; margin-top: 2px; }

  .prop { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .prop .pl { color: #64748b; font-size: 12px; }
  .prop input[type=text], .prop input[type=number], .prop select { flex: 1; min-width: 0; width: auto; max-width: 62%; padding: 3px 6px; border: 1px solid #cbd5e1; border-radius: 5px; font: 12px system-ui; }
  .prop input[type=color] { width: 32px; height: 22px; padding: 0; border: 1px solid #cbd5e1; border-radius: 5px; }
  .hint { color: #94a3b8; font-size: 11px; font-style: italic; }

  /* Settings popover (AI · props · style · events) — anchored to the ⚙ button */
  .settings-backdrop { position: fixed; inset: 0; z-index: 40; }
  .settings-pop { position: fixed; z-index: 41; width: 320px; max-height: 72vh; overflow: auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 11px; box-shadow: 0 16px 44px rgba(2,6,23,.2); padding: 10px; display: flex; flex-direction: column; gap: 9px; }
  .sp-head { display: flex; align-items: center; gap: 7px; }
  .sp-kind { flex: 0 0 auto; font: 700 9px system-ui; text-transform: uppercase; letter-spacing: .4px; color: #0369a1; background: #eff6ff; padding: 3px 7px; border-radius: 999px; }
  .sp-title { flex: 1; min-width: 0; padding: 4px 8px; border: 1px solid transparent; border-radius: 6px; font: 600 13px system-ui; color: #0f172a; background: #f6f8fa; }
  .sp-title:hover { border-color: #e2e8f0; }
  .sp-title:focus { outline: none; border-color: #0369a1; background: #fff; box-shadow: 0 0 0 3px rgba(3,105,161,.1); }
  .sp-close { flex: 0 0 auto; width: 22px; height: 22px; border: 0; background: transparent; color: #94a3b8; cursor: pointer; font-size: 13px; border-radius: 5px; }
  .sp-close:hover { background: #f1f5f9; color: #0f172a; }
  /* component-scoped AI bar (top) */
  .sp-ai { display: flex; align-items: center; gap: 6px; padding: 5px 6px 5px 9px; border: 1.5px solid #d8b4fe; border-radius: 9px; background: #faf5ff; }
  .sp-ai-ic { font-size: 13px; line-height: 1; }
  .sp-ai input { flex: 1; min-width: 0; border: 0; background: transparent; font: 12px system-ui; color: #0f172a; }
  .sp-ai input:focus { outline: none; }
  .sp-ai input::placeholder { color: #a78bda; }
  .sp-ai-go { flex: 0 0 auto; width: 26px; height: 24px; border: 0; border-radius: 7px; background: #7c3aed; color: #fff; font-size: 14px; cursor: pointer; }
  .sp-ai-go:hover:not(:disabled) { filter: brightness(1.08); }
  .sp-ai-go:disabled { opacity: .45; cursor: default; }
  .sp-tabs { display: flex; gap: 2px; border-bottom: 1px solid #e5e7eb; }
  .sp-tabs button { padding: 4px 11px; border: 0; border-bottom: 2px solid transparent; margin-bottom: -1px; background: transparent; color: #64748b; font: 600 11.5px system-ui; cursor: pointer; }
  .sp-tabs button:hover { color: #0f172a; }
  .sp-tabs button.on { color: #0369a1; border-bottom-color: #0369a1; }
  .sp-body { display: flex; flex-direction: column; gap: 8px; }
  .wire-h { font: 600 9px system-ui; text-transform: uppercase; letter-spacing: .3px; color: #94a3b8; }
  .sp-empty { display: flex; flex-direction: column; gap: 3px; padding: 8px; border: 1px dashed #e5e7eb; border-radius: 7px; color: #64748b; font-size: 12px; }
  .sp-empty b { color: #0f172a; }
  .sp-note { color: #94a3b8; font-size: 10.5px; font-style: italic; }
  .settings-pop .props, .settings-pop .wire { display: flex; flex-direction: column; gap: 7px; }
  .settings-pop .prop input[type=text], .settings-pop .prop select, .settings-pop .prop input[type=number] { max-width: 60%; }
</style>
