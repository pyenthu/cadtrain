<script lang="ts">
  // VisualEditor — the human authoring surface. A SEARCH BAR over the component catalog
  // (Increment 8) + the current panels with add / remove / reorder / rename — each calling
  // a `gui` verb on the SAME .app the AI edits (D16: three surfaces, one manifest).
  import type { AppManifest } from '$lib/appkit/manifest/types';
  import { dispatch } from '$lib/appkit/verbs/dispatch';
  import { searchCatalog } from '$lib/appkit/catalog/catalog';
  import { getComponentMeta } from '$lib/appkit/catalog/components';

  let { app }: { app: AppManifest } = $props();
  let seq = $state(0);
  let query = $state('');
  let open = $state(false);
  let openId = $state<string | null>(null); // which panel's props are expanded

  const results = $derived(searchCatalog(query, { type: 'component' }).slice(0, 8));

  const store = () => ({ appStore: app as any });

  /** Default props for a kind, from its catalog meta (so an added component looks right). */
  function defaultProps(kind: string): Record<string, unknown> | undefined {
    const props: Record<string, unknown> = {};
    for (const p of getComponentMeta(kind)?.props ?? []) if (p.default !== undefined) props[p.name] = p.default;
    return Object.keys(props).length ? props : undefined;
  }

  async function addKind(kind: string) {
    seq += 1;
    const meta = getComponentMeta(kind);
    const panel: Record<string, unknown> = { id: `p${seq}_${kind}`, kind, title: `${meta?.name ?? kind}` };
    const props = defaultProps(kind);
    if (props) panel.props = props;
    if (meta?.acceptsChildren) panel.children = [];
    await dispatch('definePanel', { panel }, store());
    query = '';
    open = false;
  }
  const remove = (id: string) => dispatch('removePanel', { panelId: id }, store());
  async function move(id: string, delta: number) {
    const i = (app.panels ?? []).findIndex((p) => p.id === id);
    await dispatch('movePanel', { panelId: id, to: i + delta }, store());
  }
  const rename = (id: string, title: string) => dispatch('setPanelProp', { panelId: id, key: 'title', value: title }, store());

  // ── Per-component props editor (⚙) ──────────────────────────────────────────
  const toggleProps = (id: string) => (openId = openId === id ? null : id);
  const propVal = (p: any, name: string, dflt: unknown) => p.props?.[name] ?? dflt;
  const setProp = (id: string, name: string, value: unknown) =>
    dispatch('setComponentProp', { panelId: id, name, value }, store());
</script>

<div class="ve">
  <div class="search">
    <input
      class="q"
      placeholder="Search components — table · card · button · text · list · 3d…"
      bind:value={query}
      onfocus={() => (open = true)}
      onblur={() => setTimeout(() => (open = false), 160)}
    />
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
  <ul class="panels">
    {#each app.panels ?? [] as p, i (p.id)}
      {@const meta = getComponentMeta(p.kind)}
      <li class="prow">
        <div class="row">
          <span class="kind">{p.kind}</span>
          <input value={p.title ?? p.id} onchange={(e) => rename(p.id, (e.currentTarget as HTMLInputElement).value)} />
          <button class="gear" class:on={openId === p.id} disabled={!meta?.props?.length} onclick={() => toggleProps(p.id)} title={meta?.props?.length ? 'edit props' : 'no props'}>⚙</button>
          <button onclick={() => move(p.id, -1)} disabled={i === 0} title="up">↑</button>
          <button onclick={() => move(p.id, 1)} disabled={i === (app.panels?.length ?? 0) - 1} title="down">↓</button>
          <button class="rm" onclick={() => remove(p.id)} title="remove">✕</button>
        </div>
        {#if openId === p.id && meta?.props?.length}
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
        {/if}
      </li>
    {/each}
    {#if !(app.panels?.length)}<li class="empty">no panels — search the catalog above to add one</li>{/if}
  </ul>
  <div class="hint">Edits call the same gui verbs the AI uses — Save (top bar) persists them.</div>
</div>

<style>
  .ve { display: flex; flex-direction: column; gap: 12px; padding: 14px; font: 13px system-ui, Arial, sans-serif; color: #0f172a; height: 100%; overflow: auto; }
  .search { position: relative; }
  .search .q { width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 8px; font: 13px system-ui; }
  .search .q:focus { outline: none; border-color: #0369a1; box-shadow: 0 0 0 3px rgba(3,105,161,.12); }
  .results { list-style: none; margin: 4px 0 0; padding: 4px; position: absolute; z-index: 20; left: 0; right: 0; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.10); max-height: 320px; overflow: auto; }
  .results li { margin: 0; }
  .results button { display: grid; grid-template-columns: auto auto 1fr; align-items: baseline; gap: 8px; width: 100%; text-align: left; padding: 7px 9px; border: 0; border-radius: 6px; background: transparent; cursor: pointer; }
  .results button:hover { background: #f1f5f9; }
  .results .rk { font-weight: 600; }
  .results .rg { font: 600 9px system-ui; text-transform: uppercase; letter-spacing: .3px; color: #0369a1; background: #eff6ff; padding: 1px 5px; border-radius: 999px; }
  .results .rd { color: #64748b; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .panels { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .panels .prow { border: 1px solid #e5e7eb; border-radius: 6px; background: #fff; overflow: hidden; }
  .panels .row { display: flex; align-items: center; gap: 6px; padding: 5px 8px; }
  .panels .kind { font: 600 10px system-ui; text-transform: uppercase; color: #94a3b8; min-width: 52px; }
  .panels .row > input { flex: 1; padding: 4px 6px; border: 1px solid #e5e7eb; border-radius: 5px; font: 13px system-ui; }
  .panels button { padding: 3px 8px; border: 1px solid #cbd5e1; border-radius: 5px; background: #fff; cursor: pointer; }
  .panels button:disabled { opacity: .4; cursor: default; }
  .panels .gear.on { border-color: #0369a1; background: #eff6ff; }
  .panels .rm { color: #b91c1c; border-color: #fecaca; }
  .panels .empty { padding: 6px 8px; text-align: center; color: #94a3b8; font-style: italic; border: 1px solid #e5e7eb; border-radius: 6px; }
  .panels .props { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 10px; padding: 8px 10px; border-top: 1px dashed #e5e7eb; background: #f8fafc; }
  .panels .prop { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .panels .prop .pl { color: #64748b; font-size: 12px; }
  .panels .prop input[type=text], .panels .prop input[type=number], .panels .prop select { width: 60%; padding: 3px 6px; border: 1px solid #cbd5e1; border-radius: 5px; font: 12px system-ui; }
  .panels .prop input[type=color] { width: 34px; height: 24px; padding: 0; border: 1px solid #cbd5e1; border-radius: 5px; }
  .hint { color: #94a3b8; font-size: 11px; font-style: italic; }
</style>
