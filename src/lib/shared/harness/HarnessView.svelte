<script lang="ts">
  // HarnessView — Layer 4. Reads a self-contained .app manifest → renders its panels
  // via the PanelKind registry → wires every control/source to dispatch(). Knows
  // NOTHING about wells: all wells-ness lives in the .app + the verbs.
  // See docs/architecture/app-harness.md §6.
  import type { AppManifest, Binding } from '$lib/appkit/manifest/types';
  import { dispatch } from '$lib/appkit/verbs/dispatch';
  import { resolveArgs } from '$lib/appkit/manifest/refs';
  import { panelComponent } from './panels/registry';
  import { createClientEngine } from './client-engine';

  let { app, onBuild }: { app: AppManifest; onBuild?: (prompt: string) => Promise<void> } = $props();

  // The CLIENT engine — data verbs read real parts via /api/primitives/list.
  const engine = createClientEngine();
  // Runtime scope for $active / $item / $params refs in bindings.
  let active = $state<string | undefined>(undefined);
  let params = $state<Record<string, unknown>>({});

  /** Resolve a binding's refs against the live scope, then dispatch it. */
  async function run(binding: Binding | undefined, item?: unknown): Promise<unknown> {
    if (!binding) return;
    const args = resolveArgs(binding.args, { active, item, params });
    return dispatch(binding.verb, args, { appStore: app as any, engine });
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
</script>

<div class="harness">
  <header class="harness-head">
    <strong>{app.title ?? app.app}</strong>
    <span class="tag">.app · {app.panels.length} panels</span>
  </header>
  <div class="harness-grid">
    {#each app.panels as panel (panel.id)}
      {@const Comp = panelComponent(panel.kind)}
      <section class="panel">
        <div class="panel-head">{panel.title ?? panel.id}<span class="kind">{panel.kind}</span></div>
        <div class="panel-body"><Comp {panel} {run} {select} {active} {params} {onBuild} /></div>
      </section>
    {/each}
  </div>
</div>

<style>
  .harness { display: flex; flex-direction: column; height: 100%; font: 13px/1.4 system-ui, Arial, sans-serif; color: #0f172a; }
  .harness-head { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid #e5e7eb; background: #f8fafc; }
  .harness-head .tag { color: #64748b; font-size: 11px; }
  .harness-grid { display: grid; grid-template-columns: 220px minmax(280px, 1fr) 320px; gap: 12px; padding: 12px; flex: 1; min-height: 0; align-content: start; }
  .panel { border: 1px solid #e5e7eb; border-radius: 8px; background: #fff; display: flex; flex-direction: column; overflow: hidden; min-height: 120px; }
  .panel-head { display: flex; justify-content: space-between; align-items: center; padding: 7px 10px; border-bottom: 1px solid #eef2f6; background: #fafafa; font-weight: 600; }
  .panel-head .kind { font: 600 10px system-ui; text-transform: uppercase; letter-spacing: .4px; color: #94a3b8; }
  .panel-body { padding: 10px; overflow: auto; flex: 1; }
</style>
