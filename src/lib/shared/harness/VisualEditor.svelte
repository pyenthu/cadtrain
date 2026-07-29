<script lang="ts">
  // VisualEditor — the human authoring surface (rung 4b MVP). A palette of PanelKinds
  // + the current panels with add / remove / reorder / rename — each calling a `gui`
  // verb on the SAME .app the AI edits (D16: three surfaces, one manifest). Button-based
  // for now; drag-to-place is a follow-up (mine Svelte Visual Builder patterns).
  import type { AppManifest } from '$lib/appkit/manifest/types';
  import { dispatch } from '$lib/appkit/verbs/dispatch';
  import { PANEL_KINDS } from '$lib/appkit/verbs/gui';

  let { app }: { app: AppManifest } = $props();
  let newKind = $state<string>('text');
  let seq = $state(0);

  const store = () => ({ appStore: app as any });

  async function add() {
    seq += 1;
    await dispatch('definePanel', { panel: { id: `p${seq}_${newKind}`, kind: newKind, title: `${newKind} panel` } }, store());
  }
  const remove = (id: string) => dispatch('removePanel', { panelId: id }, store());
  async function move(id: string, delta: number) {
    const i = (app.panels ?? []).findIndex((p) => p.id === id);
    await dispatch('movePanel', { panelId: id, to: i + delta }, store());
  }
  const rename = (id: string, title: string) => dispatch('setPanelProp', { panelId: id, key: 'title', value: title }, store());
</script>

<div class="ve">
  <div class="palette">
    <label>Add panel:</label>
    <select bind:value={newKind}>{#each PANEL_KINDS as k}<option value={k}>{k}</option>{/each}</select>
    <button class="add" onclick={() => add()}>＋ add</button>
  </div>
  <ul class="panels">
    {#each app.panels ?? [] as p, i (p.id)}
      <li>
        <span class="kind">{p.kind}</span>
        <input value={p.title ?? p.id} onchange={(e) => rename(p.id, (e.currentTarget as HTMLInputElement).value)} />
        <button onclick={() => move(p.id, -1)} disabled={i === 0} title="up">↑</button>
        <button onclick={() => move(p.id, 1)} disabled={i === (app.panels?.length ?? 0) - 1} title="down">↓</button>
        <button class="rm" onclick={() => remove(p.id)} title="remove">✕</button>
      </li>
    {/each}
    {#if !(app.panels?.length)}<li class="empty">no panels — add one from the palette</li>{/if}
  </ul>
  <div class="hint">Edits call the same gui verbs the AI uses — Save (top bar) persists them. Drag-to-place is a follow-up.</div>
</div>

<style>
  .ve { display: flex; flex-direction: column; gap: 12px; padding: 14px; font: 13px system-ui, Arial, sans-serif; color: #0f172a; height: 100%; overflow: auto; }
  .palette { display: flex; align-items: center; gap: 8px; }
  .palette label { color: #64748b; }
  .palette select { padding: 4px 6px; border: 1px solid #cbd5e1; border-radius: 6px; }
  .palette .add { padding: 4px 10px; border: 1px solid #0369a1; border-radius: 6px; background: #0369a1; color: #fff; font: 600 12px system-ui; cursor: pointer; }
  .panels { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .panels li { display: flex; align-items: center; gap: 6px; border: 1px solid #e5e7eb; border-radius: 6px; padding: 5px 8px; background: #fff; }
  .panels .kind { font: 600 10px system-ui; text-transform: uppercase; color: #94a3b8; min-width: 52px; }
  .panels input { flex: 1; padding: 4px 6px; border: 1px solid #e5e7eb; border-radius: 5px; font: 13px system-ui; }
  .panels button { padding: 3px 8px; border: 1px solid #cbd5e1; border-radius: 5px; background: #fff; cursor: pointer; }
  .panels button:disabled { opacity: .4; cursor: default; }
  .panels .rm { color: #b91c1c; border-color: #fecaca; }
  .panels .empty { justify-content: center; color: #94a3b8; font-style: italic; }
  .hint { color: #94a3b8; font-size: 11px; font-style: italic; }
</style>
