<!--
  StackRowPopover.svelte — the per-row ⚙ "more" popover for a PartsStackCard row.
  A parts_stack row shows only its element + length inline; THIS popover exposes the
  element's SPECIFIC params (its other meta.params) at the parent level, plus the
  absolute placement depth (`top`). MATERIAL is NOT here — an element's appearance
  comes from the part's OWN definition / its own material editor (user 2026-07-23).
  Decoupled — takes the row's src + param names + current args + top, emits per-arg /
  per-top intent callbacks; imports nothing from GEP.
-->
<script lang="ts">
  import type { ArgValue } from '$lib/graph/composition/composition-graph-types';

  let {
    src,
    paramNames,
    args,
    top,
    anchor,
    onArg,
    onTop,
    onClose,
  }: {
    src: string;
    /** The element's meta.params names, EXCLUDING `length` (edited inline on the row). */
    paramNames: string[];
    args: Record<string, ArgValue>;
    /** The row's absolute placement depth (`top`) — undefined ⇒ mates end-to-end. */
    top: ArgValue | undefined;
    anchor: { x: number; y: number };
    onArg: (name: string, value: { expr: string } | number | string | boolean | null) => void;
    /** Set / clear the placement depth — a literal, an `{expr}`, or null to clear. */
    onTop: (value: { expr: string } | number | null) => void;
    onClose: () => void;
  } = $props();

  /** The current text for the placement-depth field. */
  function topText(): string {
    const v = top;
    if (!v) return '';
    if (v.kind === 'literal') return String(v.value);
    if (v.kind === 'expr') return v.expr;
    return `p.${v.param}${v.field ? '.' + v.field : ''}`;
  }
  function commitTop(raw: string) {
    const t = raw.trim();
    if (t === '') { onTop(null); return; }
    if (t.startsWith('=')) { onTop({ expr: t.slice(1).trim() }); return; }
    const n = Number(t);
    if (Number.isFinite(n) && /^[-+]?[0-9.eE]+$/.test(t)) onTop(n);
    else onTop({ expr: t });
  }

  /** The current text for a param cell — its arg (literal or ƒ), else '' (default). */
  function argText(name: string): string {
    const v = args?.[name];
    if (!v) return '';
    if (v.kind === 'literal') return String(v.value);
    if (v.kind === 'expr') return v.expr;
    return `p.${v.param}${v.field ? '.' + v.field : ''}`;
  }
  function isFx(name: string): boolean {
    const v = args?.[name];
    return !!v && v.kind !== 'literal';
  }
  /** Commit a param on Enter/blur — blank clears, `=`/non-numeric → expr, else literal. */
  function commitArg(name: string, raw: string) {
    const t = raw.trim();
    if (t === '') { onArg(name, null); return; }
    if (t.startsWith('=')) { onArg(name, { expr: t.slice(1).trim() }); return; }
    const n = Number(t);
    if (Number.isFinite(n) && /^[-+]?[0-9.eE]+$/.test(t)) onArg(name, n);
    else onArg(name, { expr: t });
  }

  // Portal to <body> — same fixed-in-foreignObject fix as RowMaterialPopover.
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy() { node.remove(); } };
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="sr-scrim" use:portal onpointerdown={onClose}></div>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="sr-pop" use:portal style={`left:${anchor.x}px; top:${anchor.y}px`}
     onpointerdown={(e) => e.stopPropagation()}>
  <div class="sr-head"><span class="sr-title">{src || 'element'}</span><button class="sr-x" onclick={onClose} title="Close" aria-label="Close">×</button></div>

  <!-- PLACEMENT — an absolute depth (Z-down `top`). Set ⇒ this element is placed at
       that depth (mv) instead of mating end-to-end. Blank ⇒ mates (running string). -->
  <div class="sr-sec-label">placement</div>
  <label class="sr-field sr-field-depth" class:sr-fx={top && top.kind !== 'literal'}>
    <span>place at depth (top) — blank = mate end-to-end</span>
    <input class="sr-in" value={topText()} placeholder="mate"
      onkeydown={(e) => { if (e.key === 'Enter') commitTop((e.currentTarget as HTMLInputElement).value); }}
      onblur={(e) => commitTop((e.currentTarget as HTMLInputElement).value)} />
  </label>

  {#if paramNames.length}
    <div class="sr-sec-label">params</div>
    <div class="sr-params">
      {#each paramNames as name (name)}
        <label class="sr-field" class:sr-fx={isFx(name)}>
          <span>{name}</span>
          <input class="sr-in" value={argText(name)} placeholder="·"
            onkeydown={(e) => { if (e.key === 'Enter') commitArg(name, (e.currentTarget as HTMLInputElement).value); }}
            onblur={(e) => commitArg(name, (e.currentTarget as HTMLInputElement).value)} />
        </label>
      {/each}
    </div>
  {:else}
    <div class="sr-empty">no extra params{src ? '' : ' — pick an element first'}</div>
  {/if}
</div>

<style>
  .sr-scrim { position: fixed; inset: 0; z-index: 1000; }
  .sr-pop {
    position: fixed; z-index: 1001; width: 236px;
    background: #f6f1fe; border: 1.5px solid #7c3aed; border-radius: 8px;
    box-shadow: 0 6px 20px rgba(0,0,0,0.18); padding: 8px;
    font: 700 11px ui-monospace, monospace; color: #3a2a55;
    display: flex; flex-direction: column; gap: 7px;
    max-height: 70vh; overflow-y: auto;
  }
  .sr-head { display: flex; align-items: center; justify-content: space-between; }
  .sr-title { font-size: 11px; color: #3a2a55; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sr-x { border: none; background: none; cursor: pointer; font-size: 17px; color: #6b3fb0; padding: 0 2px; line-height: 1; }
  .sr-x:hover { color: #3a2a55; }
  .sr-sec-label { text-transform: uppercase; letter-spacing: 0.3px; font-size: 9px; color: #6b3fb0; border-bottom: 1px solid #ddd0f5; padding-bottom: 2px; }
  .sr-empty { font-size: 10px; color: #9b86c9; font-style: italic; }

  /* Params — label-over-input, two per row. */
  .sr-params { display: grid; grid-template-columns: 1fr 1fr; gap: 5px 7px; }
  .sr-field { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .sr-field > span { font-size: 9px; color: #6b3fb0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sr-in { width: 100%; box-sizing: border-box; height: 22px; padding: 0 5px; font: 600 11px ui-monospace, monospace; color: #3a2a55; background: #fff; border: 1px solid #c9b6ef; border-radius: 4px; }
  .sr-in:focus { border-color: #8a5cd6; outline: none; }
  .sr-fx .sr-in { color: #6b3fb0; font-style: italic; }
</style>
