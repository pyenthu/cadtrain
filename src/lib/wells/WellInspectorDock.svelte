<script lang="ts">
  /**
   * WellInspectorDock — the RIGHT-hand editor/inspector dock for /wells (W-B,
   * `docs/plans/wells-interface.md` §B / `wells-ewells-gaps.md` B4). SVTC
   * `CompletionsEditor` + `SurveyEditor` parity, cadtrain-styled + 3D-first.
   *
   * INSPECTOR-ON-SELECT: it reacts to a `selected` prop (the currently selected
   * well element). When a element is selected it shows that element's editable
   * properties — type/string, depth (MD range), od/id/wall/length, grade/weight,
   * tool, colour — grouped into a clean form. Editing a field emits a routable
   * patch via `onEdit`. When nothing is selected it shows a read-only empty state.
   *
   * SELF-CONTAINED: takes ALL data via props (`selected` + `elements`) and emits
   * every change via callbacks (`onEdit` / `onSelect`). It never touches the WSON
   * store, the 3D scene, or the shell — the parent wires it up. The pure prop→
   * form logic (which fields, how a patch is built) lives in `well-inspector.ts`
   * (headless-tested); this component is UI only.
   *
   * Commit-on-change: numeric/text inputs commit on Enter or blur (native
   * `change`), never per keystroke (memory `feedback_apply_on_enter`); the colour
   * swatch + string `<select>` commit immediately.
   */
  import {
    type WellInspectorElement,
    type WellElementPatch,
    type InspectorField,
    inspectorFields,
    fieldGroups,
    buildPatch,
    wallOf,
    KIND_META,
  } from './well-inspector';

  let {
    selected = null,
    elements = [],
    onEdit,
    onSelect,
    collapsed = $bindable(false),
    title = 'Inspector',
  }: {
    /** The currently selected element (inspector-on-select). `null` → empty state. */
    selected?: WellInspectorElement | null;
    /** The full element list — the pickable index at the top of the dock. */
    elements?: WellInspectorElement[];
    /** Emit one field edit (routable: carries `kind` + `index`). */
    onEdit?: (patch: WellElementPatch) => void;
    /** Selection changed from within the dock (clicking the element list). */
    onSelect?: (el: WellInspectorElement | null) => void;
    /** Collapse the dock body to a thin rail (bindable so the shell can drive it). */
    collapsed?: boolean;
    title?: string;
  } = $props();

  // The form spec for the selected element, grouped for display. Recomputes when
  // `selected` (or any of its fields) changes — inspector-on-select.
  const fields = $derived(selected ? inspectorFields(selected) : []);
  const groups = $derived(fieldGroups(fields));
  const kindMeta = $derived(selected ? KIND_META[selected.kind] : null);

  /** Commit a field edit → build a routable patch (`buildPatch` owns the
   *  coercion + wall→id translation) and forward it. Blank/NaN → no patch. */
  function commit(field: InspectorField, raw: string) {
    if (!selected || field.readonly) return;
    const patch = buildPatch(selected, field.key, raw);
    if (patch) onEdit?.(patch);
  }

  const fmtVal = (v: number | string | undefined) =>
    v == null ? '' : typeof v === 'number' ? String(v) : v;

  function pick(el: WellInspectorElement) {
    onSelect?.(el.elKey === selected?.elKey ? null : el);
  }
</script>

<aside class="wid" class:collapsed aria-label="Well element inspector">
  <!-- Dock title bar — collapse toggle + title. -->
  <div class="wid-bar">
    <button
      class="wid-collapse"
      type="button"
      aria-expanded={!collapsed}
      aria-label={collapsed ? 'Expand inspector' : 'Collapse inspector'}
      title={collapsed ? 'Expand inspector' : 'Collapse inspector'}
      onclick={() => (collapsed = !collapsed)}
    >
      <span class="wid-chev" class:open={!collapsed}>▸</span>
    </button>
    <span class="wid-title">{title}</span>
    {#if selected}<span class="wid-badge">{KIND_META[selected.kind].name}</span>{/if}
  </div>

  {#if !collapsed}
    <div class="wid-body">
      <!-- Element picker — the pickable index (optional; empty when no list). -->
      {#if elements.length}
        <div class="wid-list" role="listbox" aria-label="Well elements">
          {#each elements as el (el.elKey)}
            {@const on = el.elKey === selected?.elKey}
            <button
              class="wid-row"
              class:on
              type="button"
              role="option"
              aria-selected={on}
              onclick={() => pick(el)}
            >
              <span class="wid-dot" style="background:{el.color}"></span>
              <span class="wid-row-glyph">{KIND_META[el.kind].glyph}</span>
              <span class="wid-row-label">{el.label}</span>
              {#if el.top != null && el.bot != null}
                <span class="wid-row-depth">{el.top}–{el.bot}m</span>
              {/if}
            </button>
          {/each}
        </div>
      {/if}

      <!-- Detail form OR empty state. -->
      {#if selected && kindMeta}
        <div class="wid-detail">
          <header class="wid-head">
            <span class="wid-swatch" style="background:{selected.color}"></span>
            <span class="wid-head-glyph">{kindMeta.glyph}</span>
            <span class="wid-head-label" title={selected.label}>{selected.label}</span>
          </header>

          {#each groups as g (g.group)}
            <section class="wid-group">
              <div class="wid-group-h">{g.group}</div>
              <div class="wid-fields">
                {#each g.fields as f (f.key)}
                  <label class="wid-field">
                    <span class="wid-field-k">{f.label}</span>
                    {#if f.type === 'select'}
                      <select
                        class="wid-input"
                        value={fmtVal(f.value)}
                        disabled={f.readonly}
                        onchange={(e) => commit(f, (e.currentTarget as HTMLSelectElement).value)}
                      >
                        {#each f.options ?? [] as opt}
                          <option value={opt}>{opt}</option>
                        {/each}
                      </select>
                    {:else if f.type === 'color'}
                      <span class="wid-color-wrap">
                        <input
                          class="wid-color"
                          type="color"
                          value={fmtVal(f.value) || '#e53e3e'}
                          disabled={f.readonly}
                          oninput={(e) => commit(f, (e.currentTarget as HTMLInputElement).value)}
                        />
                        <span class="wid-color-hex">{fmtVal(f.value) || '#e53e3e'}</span>
                      </span>
                    {:else if f.type === 'number'}
                      <span class="wid-num">
                        <input
                          class="wid-input"
                          type="number"
                          step={f.step}
                          value={fmtVal(f.value)}
                          readonly={f.readonly}
                          onchange={(e) => commit(f, (e.currentTarget as HTMLInputElement).value)}
                        />
                        {#if f.unit}<span class="wid-unit">{f.unit}</span>{/if}
                      </span>
                    {:else}
                      <input
                        class="wid-input"
                        type="text"
                        value={fmtVal(f.value)}
                        readonly={f.readonly}
                        onchange={(e) => commit(f, (e.currentTarget as HTMLInputElement).value)}
                      />
                    {/if}
                  </label>
                {/each}
              </div>
            </section>
          {/each}

          <!-- Derived read-outs (non-editable context). -->
          <div class="wid-derived">
            {#if selected.top != null && selected.bot != null}
              <span class="wid-derived-i">
                <span class="wid-derived-k">Span</span>{(selected.bot - selected.top).toFixed(1)} m
              </span>
            {/if}
            {#if wallOf(selected) != null}
              <span class="wid-derived-i">
                <span class="wid-derived-k">Wall</span>{wallOf(selected)!.toFixed(3)} in
              </span>
            {/if}
          </div>
        </div>
      {:else}
        <div class="wid-empty">
          <div class="wid-empty-ic">◌</div>
          <p class="wid-empty-t">No element selected</p>
          <p class="wid-empty-s">
            Select a well element {elements.length ? 'from the list above or ' : ''}on the
            diagram to inspect + edit its properties.
          </p>
        </div>
      {/if}
    </div>
  {/if}
</aside>

<style>
  .wid {
    flex: none;
    width: 268px;
    height: 100%;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: #16161f;
    border-left: 1px solid #2a2a3e;
    color: #e8e8ef;
    font-family: Arial, sans-serif;
    overflow: hidden;
  }
  .wid.collapsed {
    width: 34px;
  }

  /* ── Title bar ─────────────────────────────────────────────────────────── */
  .wid-bar {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 34px;
    padding: 0 8px;
    background: #10101a;
    border-bottom: 1px solid #2a2a3e;
  }
  .wid-collapse {
    flex: none;
    background: none;
    border: none;
    color: #889;
    cursor: pointer;
    padding: 2px;
    display: flex;
    align-items: center;
  }
  .wid-collapse:hover { color: #fff; }
  .wid-chev {
    display: inline-block;
    font-size: 11px;
    transition: transform 0.12s ease;
  }
  .wid-chev.open { transform: rotate(90deg); }
  .wid-title {
    font: 700 12px Arial;
    color: #fff;
    letter-spacing: 0.2px;
    white-space: nowrap;
    overflow: hidden;
  }
  .wid.collapsed .wid-title,
  .wid.collapsed .wid-badge { display: none; }
  .wid-badge {
    margin-left: auto;
    font: 600 10px ui-monospace, monospace;
    background: #232340;
    border: 1px solid #34345a;
    border-radius: 9999px;
    padding: 1px 8px;
    color: #aab;
    white-space: nowrap;
  }

  .wid-body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
  }

  /* ── Element picker list ───────────────────────────────────────────────── */
  .wid-list {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 6px;
    border-bottom: 1px solid #2a2a3e;
    max-height: 210px;
    overflow-y: auto;
  }
  .wid-row {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    background: #1a1a2a;
    border: 1px solid transparent;
    border-radius: 5px;
    padding: 4px 7px;
    color: #aab;
    cursor: pointer;
    text-align: left;
    font: 11px ui-monospace, monospace;
  }
  .wid-row:hover { background: #1f1f34; color: #d8d8ef; }
  .wid-row.on {
    background: #232340;
    border-color: #cc3333;
    color: #fff;
  }
  .wid-dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.15);
  }
  .wid-row-glyph { flex: none; color: #99a; font-size: 11px; }
  .wid-row.on .wid-row-glyph { color: #ffd; }
  .wid-row-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .wid-row-depth {
    flex: none;
    color: #667;
    font-size: 10px;
  }
  .wid-row.on .wid-row-depth { color: #99a; }

  /* ── Detail form ───────────────────────────────────────────────────────── */
  .wid-detail {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 10px;
  }
  .wid-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-bottom: 8px;
    border-bottom: 1px solid #2a2a3e;
  }
  .wid-swatch {
    flex: none;
    width: 14px;
    height: 14px;
    border-radius: 4px;
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.18);
  }
  .wid-head-glyph { flex: none; color: #cc4444; font-size: 13px; }
  .wid-head-label {
    font: 700 13px Arial;
    color: #fff;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .wid-group {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .wid-group-h {
    font: 700 9px Arial;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: #667;
  }
  .wid-fields {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .wid-field {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .wid-field-k {
    flex: none;
    width: 74px;
    font: 11px ui-monospace, monospace;
    color: #99a;
  }
  .wid-input {
    flex: 1;
    min-width: 0;
    background: #10101a;
    border: 1px solid #2f2f46;
    border-radius: 5px;
    color: #e8e8ef;
    font: 12px ui-monospace, monospace;
    padding: 4px 7px;
    outline: none;
  }
  .wid-input:focus {
    border-color: #cc3333;
    background: #14141f;
  }
  .wid-input:read-only,
  .wid-input:disabled {
    color: #778;
    background: #14141c;
    cursor: default;
  }
  .wid-num {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
  }
  .wid-unit {
    flex: none;
    font: 10px ui-monospace, monospace;
    color: #667;
    min-width: 24px;
  }
  .wid-color-wrap {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .wid-color {
    flex: none;
    width: 34px;
    height: 24px;
    padding: 0;
    border: 1px solid #2f2f46;
    border-radius: 5px;
    background: #10101a;
    cursor: pointer;
  }
  .wid-color-hex {
    font: 11px ui-monospace, monospace;
    color: #99a;
  }

  .wid-derived {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
    padding-top: 8px;
    border-top: 1px solid #2a2a3e;
  }
  .wid-derived-i {
    font: 11px ui-monospace, monospace;
    color: #cdd;
    white-space: nowrap;
  }
  .wid-derived-k {
    color: #667;
    margin-right: 5px;
    text-transform: uppercase;
    font-size: 9px;
    letter-spacing: 0.4px;
  }

  /* ── Empty state ───────────────────────────────────────────────────────── */
  .wid-empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 24px 18px;
    text-align: center;
  }
  .wid-empty-ic {
    font-size: 34px;
    color: #cc3333;
    opacity: 0.35;
    line-height: 1;
  }
  .wid-empty-t {
    margin: 0;
    font: 600 13px Arial;
    color: #aab;
  }
  .wid-empty-s {
    margin: 0;
    max-width: 210px;
    font: 11px ui-monospace, monospace;
    color: #667;
    line-height: 1.5;
  }
</style>
