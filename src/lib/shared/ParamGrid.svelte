<script lang="ts">
  /**
   * ParamGrid — the shared parameter editor used by the `/primitives`
   * inspector, replicating the `/components` inspector's prop-card grid
   * (`.pr-card` / `.pr-num.drag` / `.pr-choice`). Single-row cards in an
   * auto-fit grid; drag-to-scrub number inputs with Enter-only commit;
   * enum dropdowns + boolean checkboxes commit immediately.
   *
   * Commit model:
   *   - typing a number      → onPending(key, v)  (dirty until Enter)
   *   - drag-scrub            → onPending(key, v)  (dirty — NO live commit;
   *                             geometry is a server round-trip, so we don't
   *                             rebuild per drag tick; press Enter/Apply)
   *   - Enter                 → onCommit(key, v)   (apply that param)
   *   - enum / boolean change → onCommit(key, v)   (apply immediately)
   *
   * Polygon params are skipped here (the Profile tab edits those).
   */
  import { dragNumber } from './dragNumber';

  export type ParamSchema = {
    label?: string;
    type?: 'number' | 'boolean' | 'polygon' | 'enum';
    min?: number;
    max?: number;
    step?: number;
    options?: string[];
    default: number | [number, number][];
    unit?: string;
  };

  let {
    schema,
    pending,
    applied,
    onPending,
    onCommit,
    onDelete,
    variant = 'default',
  }: {
    schema: Record<string, ParamSchema>;
    pending: Record<string, number | [number, number][]>;
    applied: Record<string, number | [number, number][]>;
    onPending: (key: string, value: number) => void;
    onCommit: (key: string, value: number) => void;
    /** When provided, each card shows a ✕ to delete that param. The parent
     *  confirms (the ev anchors a confirm popup) before actually removing it. */
    onDelete?: (key: string, ev: MouseEvent) => void;
    /** 'fn' = profile-editor look: the VARIABLE NAME as the label + a
     *  draggable text input (no spinner arrows), matching ProfileFnEditor. */
    variant?: 'default' | 'fn';
  } = $props();

  let keys = $derived(Object.keys(schema).filter((k) => schema[k].type !== 'polygon'));

  function num(k: string): number {
    const v = pending[k] ?? schema[k].default;
    return typeof v === 'number' ? v : 0;
  }
  function isDirty(k: string): boolean {
    return (pending[k] ?? schema[k].default) !== (applied[k] ?? schema[k].default);
  }
</script>

<div class="pr-grid">
  {#each keys as key (key)}
    {@const ps = schema[key]}
    {@const value = num(key)}
    <div class="pr-card" class:dirty={isDirty(key)}>
      <div class="pr-card-head">
        <span class="pr-keyname" title={ps.label ?? key}>{variant === 'fn' ? key : (ps.label ?? key)}</span>
        {#if ps.unit}<span class="pr-unit-inline">({ps.unit})</span>{/if}
      </div>

      {#if ps.type === 'boolean'}
        <input
          class="pr-bool"
          type="checkbox"
          checked={!!value}
          onchange={(e) => onCommit(key, (e.currentTarget as HTMLInputElement).checked ? 1 : 0)}
        />
      {:else if ps.type === 'enum'}
        <select
          class="pr-choice"
          value={value}
          onchange={(e) => onCommit(key, Number((e.currentTarget as HTMLSelectElement).value))}
        >
          {#each ps.options ?? [] as label, i (i)}
            <option value={i}>{label}</option>
          {/each}
        </select>
      {:else}
        <input
          class="pr-num drag"
          class:fn={variant === 'fn'}
          type={variant === 'fn' ? 'text' : 'number'}
          inputmode="decimal"
          step={ps.step ?? 0.1}
          min={ps.min}
          max={ps.max}
          {value}
          oninput={(e) => onPending(key, Number((e.currentTarget as HTMLInputElement).value))}
          onkeydown={(e) => {
            if (e.key === 'Enter') {
              const v = Number((e.currentTarget as HTMLInputElement).value);
              if (Number.isFinite(v)) onCommit(key, v);
            } else if (e.key === 'Escape') {
              (e.currentTarget as HTMLInputElement).value = String(value);
            }
          }}
          use:dragNumber={{
            step: ps.step ?? 0.1,
            min: ps.min,
            max: ps.max,
            get: () => num(key),
            // Drag-scrub updates PENDING only (dirty) — NOT a live commit.
            // The geometry is a server round-trip, so we don't rebuild on
            // every drag tick; the user presses Enter / Apply to commit.
            set: (v) => onPending(key, v),
          }}
          title="Type or drag to scrub (dirty) · Enter or Apply to commit"
        />
      {/if}

      {#if onDelete}
        <button class="pr-del" type="button" title="Delete this parameter" aria-label="Delete parameter" onclick={(e) => onDelete?.(key, e)}>✕</button>
      {/if}
    </div>
  {/each}
</div>

<style>
  .pr-grid {
    display: grid;
    /* Narrower min track → params flow into 2 columns at the inspector width
       (≈390px usable, 3px gap). */
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 3px;
    padding: 2px 0;
  }
  .pr-card {
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 1px 4px;
    background: #fafafa;
    border: 1px solid #eaeaef;
    border-radius: 3px;
    min-width: 0;
  }
  .pr-card.dirty { background: #fff8e6; border-color: #f0d8a8; }
  .pr-card-head { display: contents; }
  .pr-card-head .pr-keyname {
    flex: 0 0 auto;
    max-width: 50%;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font: 12px monospace; color: #333;
  }
  .pr-unit-inline {
    font: 10px Arial; color: #222;
    flex-shrink: 0;
    margin-right: 2px;
  }
  .pr-num {
    flex: 1; min-width: 0; order: 1;
    font: 10px monospace;
    padding: 1px 3px; border: 1px solid #ddd; border-radius: 3px;
    text-align: right;
  }
  .pr-num.drag {
    cursor: ew-resize;
    padding: 3px 6px;
    font-size: 11px;
    background: linear-gradient(180deg, #fff 0%, #fafafa 100%);
  }
  /* fn variant — matches ProfileFnEditor's draggable `.num`: monospace,
     right-aligned, ew-resize, faint pink fill. type=text → no spinner arrows. */
  .pr-num.fn {
    font-family: 'SF Mono', Menlo, monospace;
    text-align: right;
    cursor: ew-resize;
    background: #fdf8f7;
  }
  .pr-num:focus { outline: 1px solid #cc2222; border-color: #cc2222; }
  .pr-choice {
    flex: 1; min-width: 0; order: 1;
    font: 11px Arial; padding: 3px 6px;
    border: 1px solid #ccc; border-radius: 3px; background: #fff; cursor: pointer;
  }
  .pr-choice:hover { border-color: #cc2222; }
  .pr-choice:focus { outline: 1px solid #cc2222; }
  .pr-bool { width: 16px; height: 16px; margin: 0 auto 0 0; cursor: pointer; accent-color: #cc2222; }
  /* per-param delete — only rendered when onDelete is supplied. Sits after the
     value input (order:2) so it's the rightmost element in the single-row card. */
  .pr-del {
    order: 2; flex: 0 0 auto;
    border: 0; background: transparent; cursor: pointer;
    color: #c4c4d0; font-size: 11px; line-height: 1; padding: 0 1px;
  }
  .pr-del:hover { color: #cc2222; }

  /* Themed cursor while a drag-scrub is active (set on <body> by the
     dragNumber action). */
  :global(body.dragnum-active) { cursor: ew-resize !important; user-select: none !important; }
</style>
