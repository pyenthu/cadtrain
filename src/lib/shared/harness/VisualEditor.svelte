<script lang="ts">
  // VisualEditor — the human authoring surface as a COLLAPSIBLE COMPONENT TREE (the .app is
  // a nested children[] tree — HTML/Svelte-style — so we show + edit it as one). A search bar
  // adds to the root or, when a container's ＋ is armed, as a CHILD. Per node: collapse,
  // rename, ⚙ props, ↑↓ within siblings, ✕. Every edit calls a `gui` verb on the ONE .app.
  import type { AppManifest } from '$lib/appkit/manifest/types';
  import { dispatch } from '$lib/appkit/verbs/dispatch';
  import { searchCatalog } from '$lib/appkit/catalog/catalog';
  import { getComponentMeta } from '$lib/appkit/catalog/components';

  let { app }: { app: AppManifest } = $props();
  let query = $state('');
  let open = $state(false);
  let openId = $state<string | null>(null); // which node's props are expanded
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
    query = '';
    open = false;
    addTarget = null;
  }

  function addChildTo(id: string) {
    addTarget = id;
    query = '';
    open = true;
    uncollapse(id);
    queryEl?.focus();
  }

  const remove = (id: string) => dispatch('removePanel', { panelId: id }, store());
  const move = (id: string, idx: number, delta: number) =>
    dispatch('movePanel', { panelId: id, to: idx + delta }, store());
  const indent = (id: string) => dispatch('indentPanel', { panelId: id }, store()); // → demote into prev
  const outdent = (id: string) => dispatch('outdentPanel', { panelId: id }, store()); // ← promote out
  const rename = (id: string, title: string) => dispatch('setPanelProp', { panelId: id, key: 'title', value: title }, store());

  const toggleProps = (id: string) => (openId = openId === id ? null : id);
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
    <div class="row">
      <button class="caret" class:hide={!kids.length} onclick={() => toggleCollapse(p.id)} title={shown ? 'collapse' : 'expand'}>{shown ? '▾' : '▸'}</button>
      <span class="kind">{p.kind}</span>
      <input value={p.title ?? p.id} onchange={(e) => rename(p.id, (e.currentTarget as HTMLInputElement).value)} />
      {#if meta?.acceptsChildren}<button class="add-child" title="add child" onclick={() => addChildTo(p.id)}>＋</button>{/if}
      <button class="gear" class:on={openId === p.id} disabled={!canEdit} onclick={() => toggleProps(p.id)} title={canEdit ? 'props + wiring' : 'nothing to edit'}>⚙</button>
      <button onclick={() => outdent(p.id)} disabled={depth === 0} title="promote (out of parent)">←</button>
      <button onclick={() => move(p.id, idx, -1)} disabled={idx === 0} title="up">↑</button>
      <button onclick={() => move(p.id, idx, 1)} disabled={idx === siblings.length - 1} title="down">↓</button>
      <button onclick={() => indent(p.id)} disabled={!prevNests} title="demote (into previous)">→</button>
      <button class="rm" onclick={() => remove(p.id)} title="remove">✕</button>
    </div>
    {#if openId === p.id && canEdit}
      {#if meta?.props?.length}{@render propsForm(p, meta)}{/if}
      {#if wireableKind(p.kind)}{@render wiring(p)}{/if}
    {/if}
    {#if kids.length && shown}
      <ul class="children">
        {#each kids as c, ci (c.id)}{@render node(c, kids, ci, depth + 1)}{/each}
      </ul>
    {/if}
  </li>
{/snippet}

<div class="ve">
  <div class="search">
    <input
      bind:this={queryEl}
      class="q"
      placeholder={addTarget ? `Search — adding INTO “${addTarget}”…` : 'Search components — div · row · text · table · button · 3d…'}
      bind:value={query}
      onfocus={() => (open = true)}
      onblur={() => setTimeout(() => (open = false), 160)}
    />
    {#if addTarget}<button class="cancel-target" onclick={() => (addTarget = null)} title="add to root instead">to root ✕</button>{/if}
    {#if open && results.length}
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
      </ul>
    {/if}
  </div>

  <ul class="tree">
    {#each app.panels ?? [] as p, i (p.id)}{@render node(p, app.panels, i, 0)}{/each}
    {#if !(app.panels?.length)}<li class="empty">empty — search above to add a component</li>{/if}
  </ul>

  <div class="hint">A tree of components (nest with ＋ on containers). Edits call the same gui verbs the AI uses.</div>
</div>

<style>
  .ve { display: flex; flex-direction: column; gap: 8px; padding: 10px; font: 12.5px system-ui, Arial, sans-serif; color: #0f172a; height: 100%; overflow: auto; }
  .search { position: relative; display: flex; gap: 6px; }
  .search .q { flex: 1; box-sizing: border-box; padding: 6px 9px; border: 1px solid #cbd5e1; border-radius: 7px; font: 12.5px system-ui; }
  .search .q:focus { outline: none; border-color: #0369a1; box-shadow: 0 0 0 3px rgba(3,105,161,.12); }
  .cancel-target { padding: 4px 8px; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; font: 600 11px system-ui; cursor: pointer; white-space: nowrap; }
  .results { list-style: none; margin: 4px 0 0; padding: 4px; position: absolute; z-index: 20; left: 0; right: 0; top: 100%; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.10); max-height: 320px; overflow: auto; }
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
  .caret { width: 15px; border: 0; background: transparent; color: #94a3b8; cursor: pointer; padding: 0; font-size: 10px; }
  .caret.hide { visibility: hidden; }
  .kind { font: 600 9px system-ui; text-transform: uppercase; color: #94a3b8; min-width: 42px; letter-spacing: .2px; }
  .row > input { flex: 1; min-width: 40px; padding: 2px 5px; border: 1px solid transparent; border-radius: 4px; font: 12.5px system-ui; background: transparent; }
  .row > input:hover { border-color: #eef2f6; } .row > input:focus { border-color: #bae6fd; background: #fff; outline: none; }
  .row button { padding: 1px 6px; border: 1px solid #d7dee6; border-radius: 4px; background: #fff; cursor: pointer; font-size: 11px; line-height: 1.4; }
  .row button:disabled { opacity: .3; cursor: default; }
  .add-child { color: #0369a1; border-color: #bae6fd !important; font-weight: 700; }
  .gear.on { border-color: #0369a1; background: #eff6ff; }
  .rm { color: #b91c1c; border-color: #fecaca !important; }
  .empty { padding: 8px; text-align: center; color: #94a3b8; font-style: italic; border: 1px dashed #e5e7eb; border-radius: 6px; margin-top: 4px; }

  .props { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 10px; padding: 8px 10px; margin: 2px 0 0 24px; border: 1px solid #eef2f6; border-radius: 6px; background: #f8fafc; }
  .prop { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .prop .pl { color: #64748b; font-size: 12px; }
  .prop input[type=text], .prop input[type=number], .prop select { width: 58%; padding: 3px 6px; border: 1px solid #cbd5e1; border-radius: 5px; font: 12px system-ui; }
  .prop input[type=color] { width: 32px; height: 22px; padding: 0; border: 1px solid #cbd5e1; border-radius: 5px; }
  .hint { color: #94a3b8; font-size: 11px; font-style: italic; }
</style>
