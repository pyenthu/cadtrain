<script lang="ts">
  // HarnessView — Layer 4. Reads a self-contained .app manifest → renders its panels
  // via the PanelKind registry → wires every control/source to dispatch(). Knows
  // NOTHING about wells: all wells-ness lives in the .app + the verbs.
  // See docs/architecture/app-harness.md §6.
  import type { AppManifest, Binding, EventMap } from '$lib/appkit/manifest/types';
  import { dispatch } from '$lib/appkit/verbs/dispatch';
  import { resolveArgs } from '$lib/appkit/manifest/refs';
  import { evalComputed } from '$lib/appkit/manifest/compute';
  import PanelNode from './panels/PanelNode.svelte';
  import { createClientEngine } from './client-engine';

  let { app, onBuild }: { app: AppManifest; onBuild?: (prompt: string) => Promise<void> } = $props();

  // The CLIENT engine — data verbs read real parts via /api/primitives/list.
  const engine = createClientEngine();
  // Runtime scope for $active / $item / $params / $vars refs in bindings.
  let active = $state<string | undefined>(undefined);
  let params = $state<Record<string, unknown>>({});

  // Declarative computed variables — reactive over the live params scope. Referenced
  // by bindings/props/text as $vars.<name> (manifest/compute.ts, reused everywhere).
  const vars = $derived(evalComputed(app.computed, { params, active, ...params }));

  /** Resolve a binding's refs against the live scope, then dispatch it. */
  async function run(binding: Binding | undefined, item?: unknown): Promise<unknown> {
    if (!binding) return;
    const args = resolveArgs(binding.args, { active, item, params, vars });
    return dispatch(binding.verb, args, { appStore: app as any, engine });
  }

  /** Fire a node's declarative event: run on[event] as a SEQUENCE (single or array),
   *  in order. `on: { click: [{verb:'save'}, {verb:'bake'}] }`. */
  async function fire(node: { on?: EventMap } | undefined, event: string, item?: unknown): Promise<void> {
    const spec = node?.on?.[event];
    if (!spec) return;
    const list = Array.isArray(spec) ? spec : [spec];
    for (const b of list) await run(b, item);
  }

  /** Select a doc (a list click): make it active + load its params → the form
   *  panel re-renders with that doc's real params. */
  async function select(item: any): Promise<void> {
    const id = item?.id;
    if (!id) return;
    active = id;
    try {
      const r = (await dispatch('loadDoc', { id }, { engine })) as { params?: Record<string, unknown> };
      params = r?.params ?? {};
    } catch {
      params = {};
    }
  }

  /** CSS grid placement from a panel's declarative layout (12-col responsive grid).
   *  No layout → auto-flow, spanning 4 columns (≈3 per row). */
  function gridStyle(L?: { col?: number; row?: number; w?: number; h?: number }): string {
    const w = L?.w ?? 4;
    const h = L?.h ?? 1;
    const col = L?.col != null ? `${L.col} / span ${w}` : `span ${w}`;
    const row = L?.row != null ? `${L.row} / span ${h}` : `span ${h}`;
    return `grid-column: ${col}; grid-row: ${row};`;
  }

  /** Theme → CSS variables (consistent palette; light/dark + accent from app.theme). */
  function themeVars(t?: { mode?: 'light' | 'dark'; accent?: string }): string {
    const dark = t?.mode === 'dark';
    const v: Record<string, string> = {
      '--h-bg': dark ? '#0f172a' : '#ffffff',
      '--h-surface': dark ? '#1e293b' : '#ffffff',
      '--h-head': dark ? '#111827' : '#fafafa',
      '--h-border': dark ? '#334155' : '#e5e7eb',
      '--h-text': dark ? '#e2e8f0' : '#0f172a',
      '--h-muted': dark ? '#94a3b8' : '#64748b',
      '--h-accent': t?.accent ?? '#0369a1',
    };
    return Object.entries(v)
      .map(([k, val]) => `${k}:${val}`)
      .join(';');
  }
</script>

<div class="harness" style={themeVars(app.theme)}>
  <header class="harness-head">
    <strong>{app.title ?? app.app}</strong>
    <span class="tag">.app · {app.panels.length} panels</span>
  </header>
  <div class="harness-grid">
    {#each app.panels as panel (panel.id)}
      <section class="panel" style={gridStyle(panel.layout)}>
        <div class="panel-head">{panel.title ?? panel.id}<span class="kind">{panel.kind}</span></div>
        <div class="panel-body"><PanelNode node={panel} {run} {fire} {select} {active} {params} {vars} {onBuild} /></div>
      </section>
    {/each}
  </div>
</div>

<style>
  .harness { display: flex; flex-direction: column; height: 100%; font: 13px/1.4 system-ui, Arial, sans-serif; color: var(--h-text); background: var(--h-bg); }
  .harness-head { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--h-border); background: var(--h-head); }
  .harness-head .tag { color: var(--h-muted); font-size: 11px; }
  .harness-grid { display: grid; grid-template-columns: repeat(12, 1fr); grid-auto-rows: minmax(120px, auto); gap: 12px; padding: 12px; flex: 1; min-height: 0; align-content: start; overflow: auto; }
  .panel { border: 1px solid var(--h-border); border-radius: 8px; background: var(--h-surface); display: flex; flex-direction: column; overflow: hidden; min-height: 120px; }
  .panel-head { display: flex; justify-content: space-between; align-items: center; padding: 7px 10px; border-bottom: 1px solid var(--h-border); background: var(--h-head); font-weight: 600; }
  .panel-head .kind { font: 600 10px system-ui; text-transform: uppercase; letter-spacing: .4px; color: var(--h-muted); }
  .panel-body { padding: 10px; overflow: auto; flex: 1; }
</style>
