<!--
  ParamsCard.svelte — the PARAMS tab body of the graph editor's viewport-glued
  top-left overlay card (modularize K.65, Phase D).

  SVG (not HTML) because each param chip carries an OUTPUT SOCKET that the wire
  system drag-targets: the card `<g>` (bg + title + ＋-add button + divider) plus
  one `<g>` per param — a foreignObject chip (pin · name · value · trash) and a
  `.ge-sock out param` circle just outside the chip's right edge.

  Sits OUTSIDE the pan/zoom group (rendered directly in the canvas <svg>), so it
  stays glued to the viewport top-left. Position math comes from `geom`
  (paramPos / CARD_X0 / CARD_PAD / CARD_TITLE_H / PARAM_H) — the SAME source the
  param→arg wires (still in GEP's node arms) read, so socket↔wire lockstep holds.

  Wire-state stays in GEP (Phase C): the socket calls `onStartParamWire`
  (= startParamWire) passed in, and the ＋ button calls `onOpenAddParamPop`
  (= openAddParamPop). Value edits route through onParamDefault / onRemoveParam.

  The .ge-params-card-* / .ge-param-chip / .ge-sock CSS is DUPLICATED here — the
  sketch editor's mini params card (Phase E) still uses the GEP copies; the
  duplication collapses when E moves that out.
-->
<script lang="ts">
  import { paramPos, CARD_X0, CARD_PAD, CARD_TITLE_H, PARAM_H } from './geom';
  import { STACK_REF_PARAM } from '$lib/graph/composition-graph';
  import { dragNumber } from '$lib/shared/ui/dragNumber';
  import { DeleteConfirm } from './delete-confirm.svelte';

  let {
    paramEntries,
    pcs,
    cardY0,
    paramW,
    onOpenAddParamPop,
    onParamDefault,
    onRemoveParam,
    onStartParamWire,
    onToggleParamPublic,
  }: {
    /** [name, ParamSchema][] minus the reserved stack_ref handling done inline. */
    paramEntries: [string, any][];
    /** paramCardSize() result — { w, h } of the outer card. */
    pcs: { w: number; h: number };
    /** CARD_Y0 (PROPS_Y0 + TAB_HEADER_H) — GEP-owned, not a geom constant. */
    cardY0: number;
    /** PARAM_W — dynamic chip width (longest label), a GEP $derived. */
    paramW: number;
    onOpenAddParamPop: (ev: PointerEvent) => void;
    onParamDefault: (name: string, value: number) => void;
    onRemoveParam: (name: string) => void;
    onStartParamWire: (ev: PointerEvent, name: string) => void;
    /** Flip a param's PUBLIC/PRIVATE flag (👁 public → callers see it · 🔒 private
     *  → hidden from callers, still emits its default). Own-editor only. */
    onToggleParamPublic: (name: string) => void;
  } = $props();

  // Two-step delete confirm — one instance gates all param trash buttons, keyed
  // by param name (only one row armed at a time).
  const del = new DeleteConfirm();
</script>

<!-- PARAMS CARD — tacked outside the pan/zoom group so it stays glued to the
     viewport top-left, directly under the tab header. Holds N param chips
     vertically, with a ＋ rounded button to add a new param. Each chip: 📌 pin
     (left), p.name + input value, 🗑 trash (right), output socket OUTSIDE the
     card's right edge for drag-wiring. -->
<g class="ge-params-card" transform="translate({CARD_X0},{cardY0})">
  <rect class="ge-params-card-bg" width={pcs.w} height={pcs.h} rx="8"/>
  <text x="10" y={CARD_TITLE_H - 9} class="ge-params-card-title">Params</text>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <circle role="button" tabindex="-1" class="ge-params-add-btn"
    cx={pcs.w - 14} cy={CARD_TITLE_H - 13} r="9"
    onpointerdown={(ev) => { ev.stopPropagation(); onOpenAddParamPop(ev); }}/>
  <text x={pcs.w - 14} y={CARD_TITLE_H - 9} class="ge-params-add-glyph" text-anchor="middle" pointer-events="none">+</text>
  <line x1="0" y1={CARD_TITLE_H} x2={pcs.w} y2={CARD_TITLE_H} class="ge-params-card-divider"/>
</g>
<!-- Chips render in viewport coords too. Output sockets stick out of the card's
     right edge so they can still be drag-targeted. -->
{#each paramEntries as [name, p], i (name)}
  {@const pos = paramPos(cardY0, name, i)}
  <g class="ge-param-card" transform="translate({pos.x},{pos.y})">
    <!-- Chip body — HTML/CSS flex layout inside a foreignObject so pin / name /
         input / trash align cleanly without manual SVG-coordinate math. Dynamic
         chip width (paramW) tracks the longest label so labels never clip. -->
    <foreignObject x="0" y="0" width={paramW} height={PARAM_H}>
      <div class="ge-param-chip" class:stackref={name === STACK_REF_PARAM} xmlns="http://www.w3.org/1999/xhtml">
        <span class="pin">{name === STACK_REF_PARAM ? '🔗' : '📌'}</span>
        <span class="name" title={name === STACK_REF_PARAM ? 'z-offset — how this part mates in a stack() (0 = end-to-end flush · negative = overlap into the next by that much · positive = leave that much gap). Reserved; cannot be deleted.' : `p.${name}`}>p.{name}</span>
        <input class="val" type="number" step="0.05"
          value={(p as any).default}
          use:dragNumber={{
            step: 0.05,
            get: () => Number((p as any).default) || 0,
            set: (val) => onParamDefault(name, val),
          }}
          oninput={(e) => onParamDefault(name, Number((e.target as HTMLInputElement).value))}/>
        {#if name !== STACK_REF_PARAM}
          {@const isPriv = (p as any).public === false}
          <!-- PUBLIC/PRIVATE toggle — 👁 public (callers see this param) / 🔒
               private (hidden from callers, still emits its default). Own-editor
               only; flips the schema's `public` flag. -->
          <button class="vis" type="button" class:priv={isPriv}
            title={isPriv ? 'private — hidden from callers (click to make public)' : 'public — shown to callers (click to make private)'}
            onpointerdown={(ev) => { ev.stopPropagation(); onToggleParamPublic(name); }}>{isPriv ? '🔒' : '👁'}</button>
          <button class="trash" type="button" class:armed={del.isArmed(name)}
            title={del.isArmed(name) ? 'Click again to delete p.' + name : 'Remove p.' + name}
            onpointerdown={(ev) => { ev.stopPropagation(); if (del.request(name)) onRemoveParam(name); }}>{del.isArmed(name) ? '✓' : '🗑'}</button>
        {:else}
          <span class="trash locked" title="Reserved — cannot be deleted">🔒</span>
        {/if}
      </div>
    </foreignObject>
    <!-- Output socket — OUTSIDE the chip right edge so it's never clipped -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <circle role="button" tabindex="-1" class="ge-sock out param"
      cx={paramW + CARD_PAD + 4} cy={PARAM_H / 2} r="5"
      onpointerdown={(ev) => onStartParamWire(ev, name)}/>
  </g>
{/each}

<style>
  /* DUPLICATED from GraphEditorPane.svelte (those copies still serve the sketch
     editor's mini params card until Phase E moves it). */
  .ge-params-card-bg { fill: #fffbeb; stroke: #d97706; stroke-width: 1.5; filter: drop-shadow(0 2px 3px rgba(0,0,0,0.06)); }
  .ge-params-card-title { font: 700 12px Arial; fill: #78350f; user-select: none; text-transform: uppercase; letter-spacing: 0.5px; }
  .ge-params-card-divider { stroke: #fde68a; stroke-width: 1; }
  .ge-params-add-btn { fill: #fcd34d; stroke: #d97706; stroke-width: 1.5; cursor: pointer; transition: fill 0.12s; }
  .ge-params-add-btn:hover { fill: #f59e0b; }
  .ge-params-add-glyph { font: 700 14px Arial; fill: #78350f; user-select: none; }
  /* Flex-row chip — pin | name (flex-grow) | input (fixed) | trash (fixed). */
  .ge-param-chip {
    display: flex; align-items: center;
    height: 100%; box-sizing: border-box;
    padding: 0 4px;
    background: #fef3c7; border: 1px solid #d97706; border-radius: 5px;
    color: #78350f; font: 700 10px ui-monospace, monospace;
    gap: 4px;
  }
  .ge-param-chip .pin {
    flex: 0 0 auto;
    font: 11px 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', Arial;
    user-select: none; opacity: 0.85;
    width: 14px; text-align: center;
  }
  .ge-param-chip .name {
    flex: 1 1 auto; min-width: 0;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    color: #78350f;
  }
  .ge-param-chip .val {
    flex: 0 0 44px;
    width: 44px; padding: 0 3px;
    font: 10px ui-monospace, monospace; color: #92400e; text-align: center;
    background: rgba(255,255,255,0.9); border: 1px solid #fbbf24; border-radius: 3px;
    box-sizing: border-box;
    cursor: ew-resize;
  }
  .ge-param-chip .val:focus { outline: 1px solid #d97706; background: #fff; cursor: text; }
  .ge-param-chip .trash {
    flex: 0 0 auto;
    display: inline-flex; align-items: center; justify-content: center;
    width: 18px; height: 18px; padding: 0;
    font: 12px 'Apple Color Emoji', 'Segoe UI Emoji', Arial;
    background: transparent; border: 0; cursor: pointer;
    color: #b91c1c; opacity: 0.55; border-radius: 3px;
  }
  .ge-param-chip .trash:hover { opacity: 1; background: rgba(220, 38, 38, 0.12); }
  /* Armed (awaiting confirm): ✓ glyph on a green wash, fully opaque. */
  .ge-param-chip .trash.armed { opacity: 1; color: #16a34a; background: rgba(22, 163, 74, 0.16); }
  /* PUBLIC/PRIVATE toggle — sits just left of the trash. 👁 public (dim) /
     🔒 private (amber, fully opaque so the hidden-from-callers state reads). */
  .ge-param-chip .vis {
    flex: 0 0 auto;
    display: inline-flex; align-items: center; justify-content: center;
    width: 18px; height: 18px; padding: 0;
    font: 11px 'Apple Color Emoji', 'Segoe UI Emoji', Arial;
    background: transparent; border: 0; cursor: pointer;
    opacity: 0.5; border-radius: 3px;
  }
  .ge-param-chip .vis:hover { opacity: 1; background: rgba(217, 119, 6, 0.12); }
  .ge-param-chip .vis.priv { opacity: 1; background: rgba(217, 119, 6, 0.16); }
  /* Output socket — base + param variant (the .ge-sock family is shared editor-wide;
     these copies cover this component's one socket type). */
  .ge-sock { fill: #fff; stroke: #0c4a6e; stroke-width: 2; cursor: crosshair; touch-action: none; }
  @media (pointer: coarse) {
    .ge-sock { transform-box: fill-box; transform-origin: center; transform: scale(1.5); }
  }
  .ge-sock.out { stroke: #15803d; }
  .ge-sock.out.param { stroke: #d97706; fill: #fef3c7; }
  .ge-sock.out.param:hover { fill: #fde68a; }
</style>
