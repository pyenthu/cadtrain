<script lang="ts">
  // EditableTableEditor — the per-component (bundle) editor for the editable table: an
  // Excel-like COLUMN manager (add / rename / reorder / delete) that writes props.columns as
  // the comma-sep string the render parses, plus the add-row label + data-file slot. Rendered
  // in the tree's settings popover when present (else the generic props form). See
  // src/lib/app_components/CLAUDE.md.
  import type { Panel } from '$lib/appkit/manifest/types';
  let { panel, onProp }: { panel: Panel; onProp: (name: string, value: unknown) => void } = $props();

  const cols = $derived(
    String((panel.props?.columns as string) ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const commit = (next: string[]) => onProp('columns', next.join(', '));
  const rename = (i: number, v: string) => commit(cols.map((c, j) => (j === i ? v.trim() : c)));
  const del = (i: number) => commit(cols.filter((_, j) => j !== i));
  const moveCol = (i: number, d: number) => {
    const n = [...cols];
    const [c] = n.splice(i, 1);
    n.splice(i + d, 0, c);
    commit(n);
  };
  const add = () => commit([...cols, `col${cols.length + 1}`]);
</script>

<div class="ete">
  <div class="ete-h">Columns</div>
  {#each cols as c, i (i)}
    <div class="ete-row">
      <span class="ci">{i + 1}</span>
      <input value={c} onchange={(e) => rename(i, (e.currentTarget as HTMLInputElement).value)} />
      <button onclick={() => moveCol(i, -1)} disabled={i === 0} title="up">↑</button>
      <button onclick={() => moveCol(i, 1)} disabled={i === cols.length - 1} title="down">↓</button>
      <button class="rm" onclick={() => del(i)} title="remove">✕</button>
    </div>
  {/each}
  {#if !cols.length}<div class="ete-empty">no columns yet</div>{/if}
  <button class="ete-add" onclick={add}>＋ column</button>

  <label class="ete-f"><span>Add-row label</span>
    <input value={(panel.props?.addLabel as string) ?? ''} placeholder="+ Add row" onchange={(e) => onProp('addLabel', (e.currentTarget as HTMLInputElement).value)} />
  </label>
  <label class="ete-f"><span>Data slot</span>
    <input value={(panel.props?.slot as string) ?? ''} placeholder="(none — server-resolved)" onchange={(e) => onProp('slot', (e.currentTarget as HTMLInputElement).value)} />
  </label>
</div>

<style>
  .ete { display: flex; flex-direction: column; gap: 5px; margin-top: 4px; }
  .ete-h { font: 600 10px system-ui; text-transform: uppercase; letter-spacing: .3px; color: #94a3b8; }
  .ete-row { display: flex; align-items: center; gap: 4px; }
  .ete-row .ci { width: 16px; text-align: center; font: 600 10px system-ui; color: #94a3b8; }
  .ete-row input { flex: 1; min-width: 0; padding: 3px 6px; border: 1px solid #cbd5e1; border-radius: 5px; font: 12px system-ui; }
  .ete-row button { padding: 1px 6px; border: 1px solid #d7dee6; border-radius: 4px; background: #fff; cursor: pointer; font-size: 11px; }
  .ete-row button:disabled { opacity: .35; cursor: default; }
  .ete-row .rm { color: #b91c1c; border-color: #fecaca; }
  .ete-empty { color: #94a3b8; font-style: italic; font-size: 12px; }
  .ete-add { align-self: flex-start; padding: 3px 9px; border: 1px solid #0369a1; border-radius: 5px; background: #eff6ff; color: #0369a1; font: 600 11px system-ui; cursor: pointer; }
  .ete-f { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 3px; }
  .ete-f span { color: #64748b; font-size: 12px; }
  .ete-f input { width: 58%; padding: 3px 6px; border: 1px solid #cbd5e1; border-radius: 5px; font: 12px system-ui; }
</style>
