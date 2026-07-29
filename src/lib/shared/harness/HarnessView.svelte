<script lang="ts">
  // HarnessView — Layer 4. Reads a self-contained .app manifest → renders its panels
  // via the PanelKind registry → wires every control/source to dispatch(). Knows
  // NOTHING about wells: all wells-ness lives in the .app + the verbs.
  // See docs/architecture/app-harness.md §6.
  import type { AppManifest, Binding } from '$lib/appkit/manifest/types';
  import { dispatch } from '$lib/appkit/verbs/dispatch';
  import { resolveArgs } from '$lib/appkit/manifest/refs';
  import { panelComponent } from './panels/registry';

  let { app }: { app: AppManifest } = $props();

  // Runtime scope for $active / $item / $params refs in bindings.
  let active = $state<string | undefined>(undefined);
  let params = $state<Record<string, unknown>>({});
  let demoN = $state(0);

  /** Resolve a binding's refs against the live scope, then dispatch it. */
  async function run(binding: Binding | undefined, item?: unknown): Promise<unknown> {
    if (!binding) return;
    const args = resolveArgs(binding.args, { active, item, params });
    return dispatch(binding.verb, args, { appStore: app as any });
  }

  // Proof that the gui-verb loop works end-to-end: definePanel mutates the live .app
  // (a $state proxy) → the grid re-renders. Data/mutate verbs are pending until rung 3.
  async function addDemoPanel() {
    demoN += 1;
    await dispatch(
      'definePanel',
      { panel: { id: `demo${demoN}`, kind: 'text', title: `Demo panel ${demoN}`, text: 'Added live by the definePanel verb.' } },
      { appStore: app as any },
    );
  }
</script>

<div class="harness">
  <header class="harness-head">
    <strong>{app.title ?? app.app}</strong>
    <span class="tag">.app · {app.panels.length} panels</span>
    <button class="demo-btn" onclick={() => addDemoPanel()}>＋ Panel (verb demo)</button>
  </header>
  <div class="harness-grid">
    {#each app.panels as panel (panel.id)}
      {@const Comp = panelComponent(panel.kind)}
      <section class="panel">
        <div class="panel-head">{panel.title ?? panel.id}<span class="kind">{panel.kind}</span></div>
        <div class="panel-body"><Comp {panel} {run} /></div>
      </section>
    {/each}
  </div>
</div>

<style>
  .harness { display: flex; flex-direction: column; height: 100%; font: 13px/1.4 system-ui, Arial, sans-serif; color: #0f172a; }
  .harness-head { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid #e5e7eb; background: #f8fafc; }
  .harness-head .tag { color: #64748b; font-size: 11px; }
  .demo-btn { margin-left: auto; font: 600 11px system-ui; padding: 4px 10px; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; cursor: pointer; }
  .demo-btn:hover { background: #eef2f6; }
  .harness-grid { display: grid; grid-template-columns: 220px minmax(280px, 1fr) 320px; gap: 12px; padding: 12px; flex: 1; min-height: 0; align-content: start; }
  .panel { border: 1px solid #e5e7eb; border-radius: 8px; background: #fff; display: flex; flex-direction: column; overflow: hidden; min-height: 120px; }
  .panel-head { display: flex; justify-content: space-between; align-items: center; padding: 7px 10px; border-bottom: 1px solid #eef2f6; background: #fafafa; font-weight: 600; }
  .panel-head .kind { font: 600 10px system-ui; text-transform: uppercase; letter-spacing: .4px; color: #94a3b8; }
  .panel-body { padding: 10px; overflow: auto; flex: 1; }
</style>
