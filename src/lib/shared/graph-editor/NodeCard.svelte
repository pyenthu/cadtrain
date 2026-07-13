<!--
  NodeCard.svelte — per-node SVG card render block (modularize K.65, Phase F).
  Renders the <g transform> wrapper for each graph node: call, method, mv/rot,
  txfmn, repeat, list/stack/group, polygon, poly_repeat, sketch (via SketchNodeCard),
  plus the bottom-right resize grip. Shell-owned popovers (polyExprPop, etc.) stay
  in GraphEditorPane; this card only CALLS the open* handlers.
-->
<script lang="ts">
  import {
    inlineTransformOf,
    setRepeatCount,
    moveRepeatChild,
    removeRepeatChildAt,
    setStackChildCount,
    setStackChildRef,
    removeContainerChildAt,
    setPolygonCoord,
    addPolygonPoint,
    addPolygonRepeat,
    addPolygonExprList,
    removePolygonPoint,
    movePolygonPoint,
    setPolygonRepeatCount,
    setPolygonRepeatLoopVar,
    setPolyRepeatCount,
    setPolyRepeatLoopVar,
    setPolyRepeatCoord,
    addPolyRepeatBinding,
    setPolyRepeatBindingName,
    setPolyRepeatBindingValue,
    removePolyRepeatBinding,
    setSketchRepeatCount,
    setSketchRepeatLoopVar,
    setSketchRepeatAdvance,
    addSketchRepeatBinding,
    setSketchRepeatBindingName,
    setSketchRepeatBindingValue,
    removeSketchRepeatBinding,
    addSketchOp,
    setSketchOpField,
    setSketchOpMode,
    moveSketchOp,
    removeSketchOp,
    removeNode,
    removeMaterialNode,
    resolveEffectiveAppearance,
    setSplinePlot,
    removeWarpChild,
    setCutawayAz,
    setCutawayOffset,
    setPartsMapSrc,
    setPartsMapList,
    setPartsMapArg,
    addPartsMapArg,
    removePartsMapArg,
    setPartsMapOp,
    setPartsTableColumns,
    addPartsTableRow,
    duplicatePartsTableRow,
    removePartsTableRow,
    setPartsTableCell,
    setPartsTableRowMaterial,
    asLiteral,
    STACK_REF_PARAM,
    type Graph,
    type NodeId,
  } from '$lib/graph/composition-graph';
  import { dragNumber } from '$lib/shared/ui/dragNumber';
  import { PROFILE_REGISTRY } from '$lib/shared/profiles/profile-presets';
  import {
    extractParamRefs,
    polySockR, polySockZ, polySockRef,
    exprInputSockY, exprOutputSockY,
    containerSlotY, rootOutputSockY,
    OUTPUT_ARROW_W,
    WARP_CHILD_CY, WARP_PATH_CY, warpSolidCY, CUTAWAY_CHILD_CY,
  } from './geom';
  import { isCallDrifted, refreshCallArgs } from './graph-editor-bake.svelte';
  import { portType, listOf, structColor } from '$lib/graph/port-types';
  import { inferStructure, structLabel } from '$lib/graph/struct-type';
  import { isImperative } from '$lib/graph/expr-imperative';
  import { producerLabel, parseProfileExpr, argStr, argFrom } from './args';

  // typed-expression-outputs (Phase B) — the SOCKET descriptor for an expr
  // OUTPUT: colour + label + whether it draws as a list. An EXPLICIT annotation
  // (shape:'list'/'scalar', not 'auto') wins via the registry PortType; an
  // 'auto'/unset output is typed by INFERRING the formula's structure, so the
  // socket colour tracks what was actually built ([[x,y,z],…] → sky list<point3>).
  function exprOutPort(out: any) {
    const explicit = out?.shape && out.shape !== 'auto';
    if (explicit) {
      const id = out.shape === 'list' ? `list<${out.elem ?? 'point'}>` : (out.elem ?? 'scalar');
      if (out.shape === 'list') listOf(out.elem ?? 'point'); // ensure derived list type is registered
      const pt = portType(id);
      if (pt) return { color: pt.color, label: pt.label, isList: out.shape === 'list' };
    }
    // 'auto' / unset → infer from the formula. An imperative (loop-builder) body
    // always materialises a flat point list.
    if (isImperative(out?.formula ?? '')) {
      return { color: structColor({ kind: 'list', of: { kind: 'list', of: { kind: 'scalar' } } }), label: 'list of points', isList: true };
    }
    const t = inferStructure(out?.formula ?? '').type;
    return { color: structColor(t), label: structLabel(t), isList: t?.kind === 'list' };
  }
  import SketchNodeCard from './SketchNodeCard.svelte';
  import PartsTableCard from './PartsTableCard.svelte';
  import { partsTableRowVar } from '$lib/graph/nodes/kinds/parts-table';
  import { DeleteConfirm } from './delete-confirm.svelte';
  import type Popovers from './Popovers.svelte';
  import type { SketchState } from './sketch-state.svelte';
  import type { WireState } from './wire-state.svelte';
  import type { ExpectedParams } from './graph-editor-bake.svelte';

  let {
    n,
    pos,
    size,
    graph,
    setGraph,
    wire,
    sketch,
    popovers,
    ghostSet,
    rootId,
    onOpenTab,
    expected,
    consumedSet,
    hlVertex,
    polyPreviewFor,
    selected = false,
    onBringToFront,
    onNodePointerDown,
    onNodePointerMove,
    onNodePointerUp,
    onDeleteNode,
    toggleInlineTransform,
    toggleNodeGhost,
    onArgEdit,
    onArgExprEdit,
    toggleArgExprMode,
    unwireArgToLiteral,
    openWirePop,
    openPolyExprPop,
    openPolyRepeatExprPop,
    openPolyBindingExprPop,
    openPolyRepeatCountExprPop,
    openExprDefEditor,
    onOpenSplineEditor,
    onOpenMaterialEditor,
    onOpenPartMaterial,
    onOpenPartsSrcPicker,
    setHoverVertex,
    clearHoverVertex,
    openPolyPreview,
    polyRepeatModeFor,
    polygonModeFor,
    onTxfmnAxis,
    toggleTxfmnAxisExprMode,
    onTxfmnAxisExprEdit,
    openRepeatEditor,
    nodeShortLabel,
    onResizePointerDown,
    onResizePointerMove,
    onResizePointerUp,
  }: {
    n: any;
    pos: { x: number; y: number };
    size: { w: number; h: number };
    graph: Graph;
    setGraph: (g: Graph) => void;
    wire: WireState;
    sketch: SketchState;
    popovers: Popovers | undefined;
    ghostSet: Record<string, boolean>;
    rootId: string;
    onOpenTab?: (id: string) => void;
    expected: ExpectedParams;
    consumedSet: Set<string>;
    hlVertex: { polyId: string; idx: number } | null;
    polyPreviewFor: string | null;
    /** True when this is the AI's "this/here" selection (ge-assist ctx). */
    selected?: boolean;
    onBringToFront: (id: string) => void;
    onNodePointerDown: (ev: PointerEvent, id: string) => void;
    onNodePointerMove: (ev: PointerEvent) => void;
    onNodePointerUp: (ev: PointerEvent) => void;
    onDeleteNode: (id: string) => void;
    toggleInlineTransform: (callId: NodeId, kind: 'mv' | 'rot') => void;
    toggleNodeGhost: (id: string) => void;
    onArgEdit: (id: string, key: string, value: number) => void;
    onArgExprEdit: (id: string, key: string, expr: string) => void;
    toggleArgExprMode: (id: string, key: string) => void;
    unwireArgToLiteral: (id: string, key: string) => void;
    openWirePop: (ev: MouseEvent, id: string, key: string) => void;
    openPolyExprPop: (ev: MouseEvent, polygonId: string, idx: number, axis: 'r' | 'z', currentExpr: string) => void;
    openPolyRepeatExprPop: (ev: MouseEvent, repeatId: string, axis: 'r' | 'z', prefill: string) => void;
    openPolyBindingExprPop: (ev: MouseEvent, repeatId: string, bindingIdx: number, prefill: string) => void;
    openPolyRepeatCountExprPop: (ev: MouseEvent, repeatId: string, prefill: string) => void;
    openExprDefEditor: (ev: MouseEvent, defId: string) => void;
    /** Open the 3D spline-editor popup for a `spline` node (TODO #15). */
    onOpenSplineEditor: (ev: MouseEvent, id: string) => void;
    /** Open the material-editor popover for a material node (G-MAT-CARD). Optional
     *  so callers that don't wire material editing still type-check. */
    onOpenMaterialEditor?: (ev: PointerEvent, id: string) => void;
    /** Open the per-PART appearance popover (colour/material/opacity) for a Call
     *  node, anchored to its material swatch chip. (#66/#982 — material moved
     *  off the PROPERTIES table onto the card.) */
    onOpenPartMaterial?: (ev: PointerEvent, id: string) => void;
    /** Open the template-part SEARCH picker for a parts_table (#38b R3),
     *  anchored to the selector chip on its title row. */
    onOpenPartsSrcPicker?: (ev: PointerEvent, id: string) => void;
    setHoverVertex: (polyId: string, idx: number) => void;
    clearHoverVertex: (polyId: string, idx: number) => void;
    openPolyPreview: (ev: PointerEvent, polyId: string) => void;
    polyRepeatModeFor: (repeatId: string) => 'revolve' | 'cartesian';
    polygonModeFor: (polyId: string) => 'revolve' | 'cartesian';
    onTxfmnAxis: (id: string, section: 'rot' | 'mv', axis: 0 | 1 | 2, value: number) => void;
    toggleTxfmnAxisExprMode: (id: string, section: 'rot' | 'mv', axis: 0 | 1 | 2) => void;
    onTxfmnAxisExprEdit: (id: string, section: 'rot' | 'mv', axis: 0 | 1 | 2, expr: string) => void;
    openRepeatEditor: (id: string) => void;
    nodeShortLabel: (c: any) => string;
    onResizePointerDown: (ev: PointerEvent, id: string) => void;
    onResizePointerMove: (ev: PointerEvent) => void;
    onResizePointerUp: (ev: PointerEvent) => void;
  } = $props();

  // Two-step delete confirm for this card's × (first click arms → ✓, second
  // deletes). One node per NodeCard, so a single instance keyed by n.id suffices.
  const del = new DeleteConfirm();
</script>

            <g transform="translate({pos.x},{pos.y})" class="ge-node" class:ai-selected={selected}
              data-node-id={n.id}
              role="group"
              onpointerdown={() => onBringToFront(n.id)}>
              {#if n.type === 'call'}
                {@const call = n as any}
                {@const inlineMv  = inlineTransformOf(graph, n.id, 'mv')}
                {@const inlineRot = inlineTransformOf(graph, n.id, 'rot')}
                {@const matBound = !!graph.materialBindings?.[n.id]}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <rect role="button" tabindex="-1" class="ge-node-bg call" width={size.w} height={size.h} rx="6"
                  onpointerdown={(ev) => onNodePointerDown(ev, n.id)}
                  onpointermove={onNodePointerMove}
                  onpointerup={onNodePointerUp}
                />
                <!-- The src half of the title is a HYPERLINK that opens
                     the referenced primitive in a new editor tab — wired
                     via the onOpenTab prop from /primitives. Split the
                     two halves so the alias stays plain text + only the
                     primitive id reads as clickable (underline-on-hover).
                     Falls back to a no-op when onOpenTab is unset
                     (/vocab's embed has no tab strip). -->
                <text x="10" y="22" class="ge-node-title">
                  <tspan>{call.alias} · </tspan>
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <!-- svelte-ignore a11y_click_events_have_key_events -->
                  <tspan class="ge-node-title-link"
                    role={onOpenTab ? 'link' : null}
                    data-tip={onOpenTab ? 'Open this part in a new tab' : null}
                    onclick={(ev) => {
                      if (!onOpenTab) return;
                      ev.stopPropagation();
                      onOpenTab(call.src);
                    }}>{call.src}</tspan>
                </text>
                <!-- Drift badge (Phase 11) — when the underlying primitive's params
                     differ from this Call's args keys, surface ⚠ + a Refresh
                     pointerdown handler that brings the Call back into sync. -->
                {#if isCallDrifted(graph, n.id)}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <text role="button" tabindex="-1" x={size.w - 96} y="22"
                    class="ge-drift-btn"
                    onpointerdown={(ev) => { ev.stopPropagation(); setGraph(refreshCallArgs(graph, n.id)); }}>⚠</text>
                {/if}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <text role="button" tabindex="-1" x={size.w - 56} y="22" class="ge-xform-btn" class:on={!!inlineMv}
                  onpointerdown={(ev) => { ev.stopPropagation(); toggleInlineTransform(n.id, 'mv'); }}>⇄</text>
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <text role="button" tabindex="-1" x={size.w - 38} y="22" class="ge-xform-btn" class:on={!!inlineRot}
                  onpointerdown={(ev) => { ev.stopPropagation(); toggleInlineTransform(n.id, 'rot'); }}>↻</text>
                <!-- 👁 ghost toggle — when on, this Call's emitted Manifold is
                     ALSO returned alongside the normal result. Lets the user
                     see a cutter (or any intermediate part) overlaid on the
                     final bake to eyeball its volume. -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <text role="button" tabindex="-1" x={size.w - 56} y="22"
                  class="ge-node-ghost" class:on={!!ghostSet[n.id]}
                  data-tip={ghostSet[n.id] ? `Hide ${call.alias} from the bake overlay` : `Show ${call.alias} alongside the bake (ghost overlay)`}
                  onpointerdown={(ev) => { ev.stopPropagation(); toggleNodeGhost(n.id); }}>👁</text>
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <text role="button" tabindex="-1" x={size.w - 14} y="22" class="ge-node-x"
                  class:armed={del.isArmed(n.id)}
                  data-tip={del.isArmed(n.id) ? 'Click again to delete' : 'Delete node'}
                  onpointerdown={(ev) => { ev.stopPropagation(); if (del.request(n.id)) onDeleteNode(n.id); }}>{del.isArmed(n.id) ? '✓' : '×'}</text>
                <!-- MATERIAL input socket (◑, left edge of the header) — drop a
                     material node's output here to assign its appearance
                     (colour/texture/opacity) to this part, replacing the
                     Properties per-part assignment. `wired` = a material is bound. -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle role="button" tabindex="-1" class="ge-sock in material-in" class:wired={matBound}
                  cx="0" cy="16" r="6"
                  data-tip={matBound ? 'material: wired — drop another material to reassign (delete the material node to unwire)' : 'material: wire a ◑ material node here to set this part’s colour · texture · opacity'}
                  onpointerup={(ev) => wire.endWireOnMaterial(ev, n.id)}/>
                {#if matBound}<text x="9" y="20" class="ge-mat-bound" style="pointer-events:none">◑</text>{/if}
                <!-- Material swatch CHIP → per-part appearance popover (colour ·
                     finish · opacity), #66/#982. The ◑ socket at the left edge is
                     the wire hookup; this chip is the quick per-part override.
                     Filled with the part's EFFECTIVE outside colour so the card
                     previews its own colour. Hidden when the host doesn't wire the
                     popover (e.g. /vocab embed). -->
                {#if onOpenPartMaterial}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <rect role="button" tabindex="-1" class="ge-mat-swatch"
                    x={size.w - 78} y="9" width="14" height="14" rx="3"
                    fill={(resolveEffectiveAppearance(graph, n.id) as any)?.colorOuter ?? (graph as any).colorOuter ?? '#cc2222'}
                    class:bound={matBound}
                    data-tip={matBound ? 'material: WIRED to a ◑ node — click to edit this part’s colour · finish · opacity override' : 'material: this part’s colour · finish · opacity (click) — or wire a ◑ material node into the left socket'}
                    onpointerdown={(ev) => { ev.stopPropagation(); onOpenPartMaterial(ev, n.id); }}/>
                {/if}
                <line x1="0" y1="32" x2={size.w} y2="32" class="ge-node-divider"/>
                <foreignObject x="6" y="36" width={size.w - 12} height={size.h - 40} class="ge-fo">
                  <div class="ge-args" xmlns="http://www.w3.org/1999/xhtml">
                    {#each Object.entries(call.args ?? {}) as [k, v] (k)}
                      {@const argTip = expected.tips[call.src]?.[k]}
                      <!-- Unified row: [key_label][value_body][trailing_actions]
                           The value_body shows the literal input, the wired
                           param chip body (label-only), or the expression input.
                           The trailing_actions cell always pins ƒ + × to the
                           right edge so every row's controls land at the
                           same spot. -->
                      <div class="ge-arg-row">
                        <button class="ge-arg-key wire-btn" type="button"
                          title={argTip ? `${argTip}\n(click to wire to an outer param)` : 'Wire to outer param'}
                          onclick={(ev) => openWirePop(ev, n.id, k)}>{k}</button>
                        {#if (v as any).kind === 'literal'}
                          <span class="ge-arg-cell">
                            <input class="ge-arg-input" type="number" step="0.05"
                              value={(v as any).value}
                              use:dragNumber={{
                                step: 0.05,
                                get: () => Number((v as any).value) || 0,
                                set: (val) => onArgEdit(n.id, k, val),
                              }}
                              oninput={(e) => onArgEdit(n.id, k, Number((e.target as HTMLInputElement).value))}
                            />
                            <span class="ge-arg-actions">
                              <button class="ge-arg-action fx" type="button" title="Edit as an expression (ƒ)"
                                onclick={(ev) => popovers!.openArgExprPop(ev, n.id, k, String((v as any).value ?? 0))}>ƒ</button>
                            </span>
                          </span>
                        {:else if (v as any).kind === 'param'}
                          <!-- Wired param: chip body shows the label only; ƒ + ×
                               live in the trailing actions cell, vertically
                               aligned with the literal-case ƒ button so the
                               right edge stays consistent across rows. -->
                          <span class="ge-arg-cell wired">
                            <span class="ge-arg-pchip" title="Wired to param">p.{(v as any).param}</span>
                            <span class="ge-arg-actions">
                              <button class="ge-arg-action fx" type="button"
                                title="Edit as an expression (e.g. p.wall / 2)"
                                onclick={(ev) => popovers!.openArgExprPop(ev, n.id, k, 'p.' + (v as any).param)}>ƒ</button>
                              <button class="ge-arg-action x" type="button"
                                title="Unwire — back to literal"
                                onclick={() => unwireArgToLiteral(n.id, k)}>×</button>
                            </span>
                          </span>
                        {:else}
                          {@const expr = (v as any).expr ?? ''}
                          {@const refs = extractParamRefs(expr)}
                          {@const isProfileSlot = !!expected.profileKeys[call.src]?.has(k)}
                          {@const polyM = String(expr).match(/^__POLY__(n_[a-z0-9_]+)$/i)}
                          {@const profileDesc = isProfileSlot ? parseProfileExpr(expr) : null}
                          {#if isProfileSlot && polyM && graph.nodes[polyM[1]]}
                            <!-- NODE-REF profile: wired to a polygon/sketch.
                                 ▾ swaps to a different producer; × detaches. -->
                            <span class="ge-arg-cell">
                              <!-- svelte-ignore a11y_click_events_have_key_events -->
                              <span class="ge-arg-profilechip noderef" role="button" tabindex="-1"
                                title="Click to swap to a different profile"
                                onclick={(ev) => popovers!.openProfileRefPop(ev, n.id, k)}>
                                <span class="ge-arg-profilechip-kind">▢ {producerLabel(graph, polyM[1])} ▾</span>
                              </span>
                              <span class="ge-arg-actions">
                                <button class="ge-arg-action edit" type="button" title="Detach this profile"
                                  onclick={() => popovers!.detachProfile(n.id, k)}>×</button>
                              </span>
                            </span>
                          {:else if isProfileSlot && profileDesc && profileDesc.kind}
                            <!-- Profile chip (#119) — replaces the raw JSON expr
                                 for r_revolve / r_extrude / r_weld_extrude args
                                 typed as `profile`. Click opens the kind picker
                                 popover with curated kinds filtered by set. -->
                            {@const kindDef = PROFILE_REGISTRY[profileDesc.kind]}
                            <span class="ge-arg-cell">
                              <!-- svelte-ignore a11y_click_events_have_key_events -->
                              <span class="ge-arg-profilechip" role="button" tabindex="-1"
                                title={`Click to swap profile kind · current: ${profileDesc.kind}`}
                                onclick={(ev) => popovers!.openProfilePop(ev, n.id, k, call.src, profileDesc.kind ?? '')}>
                                <span class="ge-arg-profilechip-kind">▾ {kindDef?.label ?? profileDesc.kind}</span>
                              </span>
                              <span class="ge-arg-actions">
                                <button class="ge-arg-action edit" type="button" title="Swap to a polygon/sketch profile"
                                  onclick={(ev) => popovers!.openProfileRefPop(ev, n.id, k)}>▢</button>
                                <button class="ge-arg-action edit" type="button" title="Edit raw JSON descriptor"
                                  onclick={(ev) => popovers!.openArgExprPop(ev, n.id, k, expr)}>✎</button>
                              </span>
                            </span>
                          {:else if isProfileSlot && (!expr || expr.trim() === '')}
                            <!-- EMPTY profile slot — detached / never wired.
                                 Pick a producer (or a built-in kind) to fill it. -->
                            <span class="ge-arg-cell">
                              <!-- svelte-ignore a11y_click_events_have_key_events -->
                              <span class="ge-arg-profilechip empty" role="button" tabindex="-1"
                                title="Pick a profile for this revolve/extrude"
                                onclick={(ev) => popovers!.openProfileRefPop(ev, n.id, k)}>
                                <span class="ge-arg-profilechip-kind">▢ pick a profile ▾</span>
                              </span>
                            </span>
                          {:else if refs.length >= 2}
                            <!-- Multi-source ƒ chip — too dense for inline editing; click to open popup. -->
                            <span class="ge-arg-cell">
                              <!-- svelte-ignore a11y_click_events_have_key_events -->
                              <span class="ge-arg-fnchip" role="button" tabindex="-1"
                                title={`Click to edit · expression: ${expr}`}
                                onclick={(ev) => popovers!.openArgExprPop(ev, n.id, k, expr)}>
                                ƒ(<span class="ge-arg-fnchip-refs">{refs.map((r) => 'p.' + r).join(', ')}</span>) ✎
                              </span>
                              <span class="ge-arg-actions">
                                <button class="ge-arg-action fx on" type="button" title="Edit expression"
                                  onclick={(ev) => popovers!.openArgExprPop(ev, n.id, k, expr)}>ƒ</button>
                                <button class="ge-arg-action x" type="button" title="Back to literal"
                                  onclick={() => toggleArgExprMode(n.id, k)}>×</button>
                              </span>
                            </span>
                          {:else}
                            <span class="ge-arg-cell">
                              <input class="ge-arg-input expr" type="text"
                                placeholder="e.g. p.od / 2"
                                value={expr}
                                oninput={(e) => onArgExprEdit(n.id, k, (e.target as HTMLInputElement).value)}
                              />
                              <span class="ge-arg-actions">
                                <button class="ge-arg-action fx on" type="button" title="Edit expression in popover"
                                  onclick={(ev) => popovers!.openArgExprPop(ev, n.id, k, expr)}>ƒ</button>
                                <button class="ge-arg-action x" type="button" title="Back to literal"
                                  onclick={() => toggleArgExprMode(n.id, k)}>×</button>
                              </span>
                            </span>
                          {/if}
                        {/if}
                      </div>
                    {/each}
                  </div>
                </foreignObject>
                <!-- Output — the Call's OWN right edge (#25). mv/rot transforms
                     are STANDALONE chainable icon nodes now, never strips on this
                     Call; a transform wires FROM this output via its `.child`
                     input. Emit is unchanged (`mv(A,…)` still wraps this Call). -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle role="button" tabindex="-1" class="ge-sock out" cx={size.w} cy={size.h / 2} r="6"
                  onpointerdown={(ev) => wire.startWire(ev, n.id)}/>
                <!-- Per-arg input sockets on the left edge of the Call card.
                     Drag a param chip's output socket onto one to wire. -->
                {#each Object.keys(call.args ?? {}) as ak, ai (ak)}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <circle role="button" tabindex="-1" class="ge-sock in param"
                    cx="0" cy={36 + 14 + ai * 22} r="5"
                    onpointerup={(ev) => wire.endWireOnCallArg(ev, n.id, ak)}/>
                {/each}

              {:else if n.type === 'method'}
                {@const m = n as any}
                {@const glyph = m.op === 'subtract' ? '−' : m.op === 'add' ? '+' : '×'}
                {@const cx = size.w / 2}
                {@const cy = size.h / 2}
                <!-- COMPACT CSG operator: a circle with the op glyph, A wired in
                     on TOP, B on the BOTTOM, result out the RIGHT (A op B). No
                     card — it reads as a wire-in operator, not a container. -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle role="button" tabindex="-1" class="ge-csg-circle" cx={cx} cy={cy} r={cx}
                  onpointerdown={(ev) => onNodePointerDown(ev, n.id)}
                  onpointermove={onNodePointerMove}
                  onpointerup={onNodePointerUp}
                />
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <text role="button" tabindex="-1" x={cx} y={cy + 6} class="ge-csg-glyph" text-anchor="middle"
                  onpointerdown={(ev) => { ev.stopPropagation(); popovers!.openCsgPop(ev, n.id, m.op); }}>{glyph}</text>
                <!-- A (obj) input — TOP, label OUTSIDE above -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle role="button" tabindex="-1" class="ge-sock in obj" cx={cx} cy="0" r="6"
                  onpointerup={(ev) => wire.endWireOnInput(ev, n.id, 'obj')}/>
                <text x={cx + 11} y="-2" class="ge-csg-ab">A</text>
                <!-- B (arg) input — BOTTOM, label OUTSIDE below -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle role="button" tabindex="-1" class="ge-sock in arg" cx={cx} cy={size.h} r="6"
                  onpointerup={(ev) => wire.endWireOnInput(ev, n.id, 'arg')}/>
                <text x={cx + 11} y={size.h + 12} class="ge-csg-ab">B</text>
                <!-- OUTPUT — RIGHT -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle role="button" tabindex="-1" class="ge-sock out" cx={size.w} cy={cy} r="6"
                  onpointerdown={(ev) => wire.startWire(ev, n.id)}/>

              {:else if n.type === 'mv' || n.type === 'rot'}
                {@const glyph = n.type === 'mv' ? '⇄' : '↻'}
                {@const cx = size.w / 2}
                {@const cy = size.h / 2}
                <!-- COMPACT transform operator (mirrors the CSG method icon):
                     a small glyph card — child shape wires in on the LEFT, the
                     transformed result out the RIGHT. The x/y/z values are
                     edited in a click POPOVER (openTransformPop) rather than an
                     inline card, so the node stays a small icon. No per-axis
                     drag sockets — param-wire an axis via a ƒ expression
                     (`p.<name>`) in the popover. -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <rect role="button" tabindex="-1" class="ge-node-bg transform" class:rot={n.type === 'rot'}
                  width={size.w} height={size.h} rx="8"
                  onpointerdown={(ev) => onNodePointerDown(ev, n.id)}
                  onpointermove={onNodePointerMove}
                  onpointerup={onNodePointerUp}
                />
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <text role="button" tabindex="-1" x={cx} y={cy + 7} class="ge-xform-glyph" text-anchor="middle"
                  data-tip={n.type === 'mv' ? 'mv — edit x/y/z' : 'rot — edit rx/ry/rz'}
                  onpointerdown={(ev) => { ev.stopPropagation(); popovers!.openTransformPop(ev, n.id); }}>{glyph}</text>
                <!-- CHILD input — LEFT edge, vertically centred. -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle role="button" tabindex="-1" class="ge-sock in child" cx="0" cy={cy} r="6"
                  onpointerup={(ev) => wire.endWireOnInput(ev, n.id, 'child')}/>
                <!-- OUTPUT — RIGHT edge, vertically centred. -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle role="button" tabindex="-1" class="ge-sock out" cx={size.w} cy={cy} r="6"
                  onpointerdown={(ev) => wire.startWire(ev, n.id)}/>

              {:else if n.type === 'txfmn'}
                {@const t = n as any}
                {@const axisStartY = 40}
                {@const axisRowH = 24}
                <!-- Unified TXFMN card — one ROT/MV table (rx/ry/rz over x/y/z)
                     replacing a composed Rot+Mv. Each cell edits via
                     setTxfmnAxis(section, axis). Standalone card (never inline). -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <rect role="button" tabindex="-1" class="ge-node-bg transform"
                  width={size.w} height={size.h} rx="6"
                  onpointerdown={(ev) => onNodePointerDown(ev, n.id)}
                  onpointermove={onNodePointerMove}
                  onpointerup={onNodePointerUp}/>
                <text x="14" y="22" class="ge-node-title">⇆ xform</text>
                <line x1="0" y1="32" x2={size.w} y2="32" class="ge-node-divider"/>
                <!-- CHILD socket — left edge, title-row aligned (y=16). -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle role="button" tabindex="-1" class="ge-sock in child" cx="0" cy="16" r="6"
                  onpointerup={(ev) => wire.endWireOnInput(ev, n.id, 'child')}/>
                <foreignObject x="14" y={axisStartY - 4} width={size.w - 18} height={6 * axisRowH + 6}>
                  <div class="ge-xyz" xmlns="http://www.w3.org/1999/xhtml">
                    {#each [0, 1, 2, 3, 4, 5] as i (i)}
                      {@const section = i < 3 ? 'rot' : 'mv'}
                      {@const sa = (i % 3) as 0 | 1 | 2}
                      {@const axis = (section === 'rot' ? t.rot : t.offset)[sa]}
                      {@const axisLetter = ['x', 'y', 'z'][sa]}
                      <div class="ge-arg-row">
                        <span class="ge-arg-key axis">{section === 'rot' ? 'r' : ''}{axisLetter}</span>
                        {#if axis.kind === 'param'}
                          <span class="ge-arg-cell wired">
                            <span class="ge-arg-pchip" title="Wired to param">p.{axis.param}</span>
                            <span class="ge-arg-actions">
                              <button class="ge-arg-action fx" type="button" title="Edit as expression"
                                onclick={() => toggleTxfmnAxisExprMode(n.id, section, sa)}>ƒ</button>
                              <button class="ge-arg-action x" type="button" title="Unwire — back to literal 0"
                                onclick={() => onTxfmnAxis(n.id, section, sa, 0)}>×</button>
                            </span>
                          </span>
                        {:else if axis.kind === 'expr'}
                          <span class="ge-arg-cell">
                            <input class="ge-arg-input expr" type="text" placeholder="e.g. p.od / 2"
                              value={axis.expr}
                              oninput={(e) => onTxfmnAxisExprEdit(n.id, section, sa, (e.target as HTMLInputElement).value)}/>
                            <span class="ge-arg-actions">
                              <button class="ge-arg-action fx on" type="button" title="Back to a number"
                                onclick={() => toggleTxfmnAxisExprMode(n.id, section, sa)}>ƒ</button>
                            </span>
                          </span>
                        {:else}
                          <span class="ge-arg-cell">
                            <input class="ge-arg-input" type="number" step={section === 'rot' ? 1 : 0.5}
                              value={axis.value}
                              use:dragNumber={{
                                step: section === 'rot' ? 1 : 0.5,
                                get: () => Number(axis.value ?? 0),
                                set: (val) => onTxfmnAxis(n.id, section, sa, val),
                              }}
                              oninput={(e) => onTxfmnAxis(n.id, section, sa, Number((e.target as HTMLInputElement).value))}/>
                            <span class="ge-arg-actions">
                              <button class="ge-arg-action fx" type="button" title="Write an expression"
                                onclick={() => toggleTxfmnAxisExprMode(n.id, section, sa)}>ƒ</button>
                            </span>
                          </span>
                        {/if}
                      </div>
                    {/each}
                  </div>
                </foreignObject>
                <!-- ROT / MV divider — between row 2 and row 3. -->
                <line x1="10" y1={axisStartY + 3 * axisRowH} x2={size.w - 6} y2={axisStartY + 3 * axisRowH} class="ge-node-divider"/>
                <!-- Per-axis param-drop sockets — left edge (cx=0). -->
                {#each [0, 1, 2, 3, 4, 5] as i}
                  {@const section = i < 3 ? 'rot' : 'mv'}
                  {@const sa = (i % 3) as 0 | 1 | 2}
                  {@const cy = axisStartY + i * axisRowH + axisRowH / 2 - 4}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <circle role="button" tabindex="-1" class="ge-sock in param tiny" cx="0" cy={cy} r="4"
                    onpointerup={(ev) => wire.endWireOnTxfmnAxis(ev, n.id, section, sa)}/>
                {/each}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <text role="button" tabindex="-1" x={size.w - 22} y="22" class="ge-node-x"
                  class:armed={del.isArmed(n.id)}
                  data-tip={del.isArmed(n.id) ? 'Click again to delete' : 'Delete node'}
                  onpointerdown={(ev) => { ev.stopPropagation(); if (del.request(n.id)) onDeleteNode(n.id); }}>{del.isArmed(n.id) ? '✓' : '×'}</text>
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle role="button" tabindex="-1" class="ge-sock out" cx={size.w} cy="16" r="6"
                  onpointerdown={(ev) => wire.startWire(ev, n.id)}/>

              {:else if n.type === 'repeat'}
                {@const rep = n as any}
                {@const countKind = rep.count?.kind ?? 'literal'}
                {@const countLiteral = countKind === 'literal' ? Number(rep.count.value) : 1}
                {@const countDisplay = countKind === 'param' ? `p.${rep.count.param}`
                  : countKind === 'expr' ? rep.count.expr
                  : String(countLiteral)}
                <!-- Truncate the count "variable" (a long param name or expr)
                     so it never overflows the card / collides with ✎ + ×.
                     SVG <text> ignores CSS ellipsis, so clip the string. -->
                {@const countShort = countDisplay.length > 11 ? countDisplay.slice(0, 10) + '…' : countDisplay}
                {@const repOp = (rep.op ?? 'stack') as 'stack' | 'list' | 'place'}
                {@const repParts = (rep.children ?? []) as string[]}
                {@const hasBodyExpr = typeof rep.bodyExpr === 'string' && rep.bodyExpr.trim().length > 0}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <rect role="button" tabindex="-1" class="ge-node-bg repeat"
                  width={size.w} height={size.h} rx="6"
                  onpointerdown={(ev) => onNodePointerDown(ev, n.id)}
                  onpointermove={onNodePointerMove}
                  onpointerup={onNodePointerUp}/>
                <!-- Title row: ↻ Repeat × N — N renders as a number input
                     when literal, OR a clickable chip when wired to a
                     param OR an expression. INPUT socket at the LEFT EDGE
                     of the count row lets the user drag-wire a param chip
                     onto it — same pattern as Call args. -->
                <text x="14" y="22" class="ge-node-title">↻ Repeat ×</text>
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle role="button" tabindex="-1" class="ge-sock in param" cx="0" cy="17" r="5"
                  onpointerup={(ev) => wire.endWireOnRepeatCount(ev, n.id)}/>
                {#if countKind === 'literal'}
                  <foreignObject x="92" y="6" width="56" height="22">
                    <input class="ge-repeat-count-inline" type="number" min="1" step="1"
                      xmlns="http://www.w3.org/1999/xhtml"
                      value={countLiteral}
                      use:dragNumber={{
                        step: 1,
                        get: () => countLiteral,
                        set: (val) => { setGraph(setRepeatCount(graph, n.id, asLiteral(Math.max(1, Math.round(val))))); },
                      }}
                      oninput={(e) => { setGraph(setRepeatCount(graph, n.id, asLiteral(Math.max(1, Math.round(Number((e.target as HTMLInputElement).value)))))); }}/>
                  </foreignObject>
                {:else}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <text role="button" tabindex="-1" x="92" y="22"
                    class="ge-repeat-count-chip" class:param={countKind === 'param'} class:expr={countKind === 'expr'}
                    title={countKind === 'param' ? `Wired to param (${countDisplay}) — click × on the chip to unwire` : `Expression (${countDisplay}) — edit below`}
                    onpointerdown={(ev) => ev.stopPropagation()}>{countShort}</text>
                  {#if countKind === 'param'}
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <text role="button" tabindex="-1" x="92" y="22" dx={countShort.length * 7 + 4}
                      class="ge-repeat-count-x"
                      onpointerdown={(ev) => { ev.stopPropagation(); setGraph(setRepeatCount(graph, n.id, asLiteral(graph.params[rep.count.param]?.default ?? 1))); }}>×</text>
                  {/if}
                {/if}
                <!-- ✎ open the Repeat pattern editor (#7). Tinted when the
                     repeat carries modifiers/bindings (a real pattern). -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <text role="button" tabindex="-1" x={size.w - 32} y="22"
                  class="ge-sketch-edit-btn" class:patterned={((rep.modifiers?.length ?? 0) + (rep.bindings?.length ?? 0)) > 0}
                  data-tip="Open the Repeat pattern editor (iterators · graphical modifiers)"
                  onpointerdown={(ev) => { ev.stopPropagation(); openRepeatEditor(n.id); }}>✎</text>
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <text role="button" tabindex="-1" x={size.w - 14} y="22" class="ge-node-x"
                  class:armed={del.isArmed(n.id)}
                  data-tip={del.isArmed(n.id) ? 'Click again to delete' : 'Delete node'}
                  onpointerdown={(ev) => { ev.stopPropagation(); if (del.request(n.id)) onDeleteNode(n.id); }}>{del.isArmed(n.id) ? '✓' : '×'}</text>
                <line x1="0" y1="32" x2={size.w} y2="32" class="ge-node-divider"/>
                <!-- Repeat is a pure BUILDER — produces a list of N copies of
                     its child (combine downstream via a Stack). Minimal card:
                     no verbose descriptor; ✎ opens the Repeat pattern editor. -->
                <!-- PARTS list — one socket row per repeated part (combined
                     per-iteration via place([...])); a trailing "+ part" socket
                     appends. Each row's socket rebinds that index. -->
                {#each repParts as cid, ci (cid + ':' + ci)}
                  {@const py = 68 + ci * 24}
                  {@const cLabelRaw = nodeShortLabel(graph.nodes[cid])}
                  {@const cLabel = cLabelRaw.length > 20 ? cLabelRaw.slice(0, 19) + '…' : cLabelRaw}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <circle role="button" tabindex="-1" class="ge-sock in child" cx="0" cy={py} r="6"
                    onpointerup={(ev) => wire.endWireOnRepeatChildAt(ev, n.id, ci)}/>
                  <text x="12" y={py + 4} class="ge-repeat-part-label">{cLabel}</text>
                  {#if repParts.length > 1}
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <text role="button" tabindex="-1" x={size.w - 58} y={py + 4} class="ge-repeat-part-mv" class:disabled={ci === 0}
                      onpointerdown={(ev) => { ev.stopPropagation(); if (ci > 0) setGraph(moveRepeatChild(graph, n.id, ci, -1)); }}>▲</text>
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <text role="button" tabindex="-1" x={size.w - 44} y={py + 4} class="ge-repeat-part-mv" class:disabled={ci === repParts.length - 1}
                      onpointerdown={(ev) => { ev.stopPropagation(); if (ci < repParts.length - 1) setGraph(moveRepeatChild(graph, n.id, ci, 1)); }}>▼</text>
                  {/if}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <text role="button" tabindex="-1" x={size.w - 28} y={py + 4} class="ge-repeat-part-x"
                    onpointerdown={(ev) => { ev.stopPropagation(); setGraph(removeRepeatChildAt(graph, n.id, ci)); }}>×</text>
                {/each}
                {#if hasBodyExpr}
                  <!-- code-body repeat: edit via ✎ (no inline body text). -->
                {:else}
                  <!-- "+ part" drop socket — append a new repeated part. -->
                  {@const addY = 68 + repParts.length * 24}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <circle role="button" tabindex="-1" class="ge-sock in child add" cx="0" cy={addY} r="6"
                    onpointerup={(ev) => wire.endWireOnRepeatChild(ev, n.id)}/>
                  <text x="12" y={addY + 4} class="ge-sock-label add">{repParts.length === 0 ? '+ drop a part to repeat' : '+ part'}</text>
                {/if}
                <!-- Output -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle role="button" tabindex="-1" class="ge-sock out" cx={size.w} cy={size.h / 2} r="6"
                  onpointerdown={(ev) => wire.startWire(ev, n.id)}/>

              {:else if n.type === 'list' || n.type === 'stack' || n.type === 'group'}
                {@const isRoot = n.id === rootId}
                {@const container = n as any}
                {#if isRoot}
                  <!-- ▶ OUTPUT NODE (#13) — compact: a small input BOX on the
                       left (sockets on its left edge, cx=0) feeding a big
                       right-pointing ARROW (the part's result). Reads as
                       "inputs → ➜ out". Sized by nodeSize()'s root branch:
                       boxW = size.w − OUTPUT_ARROW_W, a fixed MINIMUM so the
                       arrow stays legible. The input sockets + drop-to-wire +
                       ⚙ reorder all behave exactly as the old card. -->
                  {@const acy = size.h / 2}
                  {@const ax = size.w - 30}
                  {@const visibleChildren = (container.children as string[])
                    .map((cid: string, origIdx: number) => ({ cid, origIdx }))
                    .filter(({ cid }) => !consumedSet.has(cid))}
                  {@const nOut = visibleChildren.length}
                  <!-- #31 collapsed Output — a SINGLE rounded box (full width) with the
                       green arrow drawn INSIDE it (right portion, no protruding tip) +
                       ONE socket on the LEFT edge accepting ALL output wires (drop
                       APPENDS; remove an output by clicking its wire → Delete). A count
                       badge shows how many parts are output when >1. -->
                  <!-- Box body (drag handle). -->
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <rect role="button" tabindex="-1" class="ge-output-box"
                    x="0" y="4" width={size.w} height={size.h - 8} rx="5"
                    style="width: {size.w}px; height: {size.h - 8}px"
                    onpointerdown={(ev) => onNodePointerDown(ev, n.id)}
                    onpointermove={onNodePointerMove}
                    onpointerup={onNodePointerUp}/>
                  <!-- green arrow INSIDE the box (right portion) — doubles as drag handle. -->
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <path role="button" tabindex="-1" class="ge-output-arrow"
                    d={`M ${ax} ${acy - 5} L ${ax + 13} ${acy - 5} L ${ax + 13} ${acy - 11} L ${size.w - 6} ${acy} L ${ax + 13} ${acy + 11} L ${ax + 13} ${acy + 5} L ${ax} ${acy + 5} Z`}
                    onpointerdown={(ev) => onNodePointerDown(ev, n.id)}
                    onpointermove={onNodePointerMove}
                    onpointerup={onNodePointerUp}/>
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <ellipse role="button" tabindex="-1" class="ge-sock in child multi" class:wired={nOut > 0}
                    cx="0" cy={acy} rx="7" ry="6"
                    data-tip="output: wire one or MORE parts here (drop APPENDS another; remove by clicking a wire → Delete)."
                    onpointerup={(ev) => wire.endWireOnContainerSlot(ev, n.id)}/>
                  {#if nOut > 1}
                    <text x="10" y={acy + 4} class="ge-output-count">×{nOut}</text>
                  {/if}
                {:else}
                {@const title = n.type === 'stack' ? '↕ Stack' : n.type === 'group' ? '{} Group' : '[ ] List'}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <!-- ROOT CONTAINER WIDTH FIX: the container rect's SVG
                     `width` attribute is being IGNORED by the browser (the
                     rect renders at the full parent SVG width ~590 px).
                     Inline CSS `style="width: ..."` IS honoured. Setting
                     it explicitly here pins the actual visual size to
                     size.w even when the SVG attribute is overridden by
                     some unknown CSS cascade artifact (Tailwind v4 layer
                     interaction, suspected). Same trick for height for
                     consistency. -->
                <rect role="button" tabindex="-1"
                  class={`ge-node-bg container${isRoot ? ' root' : ''}${n.type === 'stack' ? ' stack' : ''}`}
                  width={size.w} height={size.h} rx="6"
                  style="width: {size.w}px; height: {size.h}px"
                  onpointerdown={(ev) => onNodePointerDown(ev, n.id)}
                  onpointermove={onNodePointerMove}
                  onpointerup={onNodePointerUp}
                />
                <text x="14" y="22" class="ge-node-title">{title}</text>
                <!-- ⚙ opens the reorder popover. Available on root too — the
                     Output card benefits from manual ordering just as much. -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <text role="button" tabindex="-1" x={isRoot ? size.w - 14 : size.w - 32} y="22"
                  class="ge-container-cog"
                  onpointerdown={(ev) => popovers!.openContainerPop(ev, n.id)}>⚙</text>
                {#if !isRoot}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <text role="button" tabindex="-1" x={size.w - 14} y="22" class="ge-node-x"
                    class:armed={del.isArmed(n.id)}
                  data-tip={del.isArmed(n.id) ? 'Click again to delete' : 'Delete node'}
                  onpointerdown={(ev) => { ev.stopPropagation(); if (del.request(n.id)) onDeleteNode(n.id); }}>{del.isArmed(n.id) ? '✓' : '×'}</text>
                {/if}
                <line x1="0" y1="32" x2={size.w} y2="32" class="ge-node-divider"/>
                <!-- Children slots — for the ROOT (▶ Output) we hide children
                     that are CONSUMED by another node. Those children stay
                     in root.children for the graph's data integrity, but
                     the source emit's output filter strips them from the
                     return value, so showing them as Output slots was
                     misleading (the user saw "J is output" but actually
                     it's just the repeat's input). For non-root stack/group
                     we show all children — they ARE the container's value. -->
                {@const visibleChildren = isRoot
                  ? (container.children as string[])
                      .map((cid: string, origIdx: number) => ({ cid, origIdx }))
                      .filter(({ cid }) => !consumedSet.has(cid))
                  : (container.children as string[])
                      .map((cid: string, origIdx: number) => ({ cid, origIdx }))}
                {#each visibleChildren as { cid: childId, origIdx }, i (childId)}
                  {@const childNode = graph.nodes[childId]}
                  {@const childLabel = childNode?.type === 'call'
                    ? `${(childNode as any).alias} · ${(childNode as any).src}`
                    : childNode?.type === 'method' ? `${(childNode as any).op}(…)`
                    : childNode?.type === 'mv' ? 'mv(…)'
                    : childNode?.type === 'rot' ? 'rot(…)'
                    : childNode?.type === 'stack' ? 'stack(…)'
                    : childNode?.type === 'repeat' ? `× ${childNode.count?.kind === 'literal' ? childNode.count.value : '…'}`
                    : '(missing)'}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <circle role="button" tabindex="-1" class="ge-sock in child" cx="0" cy={containerSlotY(i)} r="5"
                    onpointerup={(ev) => wire.endWireOnContainerSlot(ev, n.id)}/>
                  <text x="10" y={containerSlotY(i) + 4} class="ge-sock-label">{childLabel}</text>
                  <!-- Inline per-child controls on STACK cards: ×N count +
                       z-offset, mirroring the ⚙ popover so the common case
                       needs no popover. HTML inputs inside a foreignObject;
                       pointerdown stopPropagation so editing doesn't drag the
                       node. Commit on Enter/blur (Apply-on-Enter). -->
                  {#if n.type === 'stack'}
                    {@const countVal = (container.childCounts ?? {})[childId]}
                    {@const countDisplay = countVal == null ? ''
                      : countVal.kind === 'literal' ? String(countVal.value)
                      : countVal.kind === 'param' ? `p.${countVal.param}`
                      : countVal.expr}
                    {@const overrideRef = (container.childRefs ?? {})[childId]}
                    {@const inheritedRef = childNode?.type === 'call' ? expected.defaults[(childNode as any).src]?.[STACK_REF_PARAM] : undefined}
                    <foreignObject x={size.w - 148} y={containerSlotY(i) - 10} width="42" height="20" class="ge-fo">
                      <!-- svelte-ignore a11y_no_static_element_interactions -->
                      <input class="ge-stack-inline-input" type="text"
                        value={countDisplay} placeholder="×1"
                        title="Copies of this child mated end-to-end (blank/1 = single · a number or a param expr like p.n)"
                        onpointerdown={(e) => e.stopPropagation()}
                        onkeydown={(e) => { if ((e as KeyboardEvent).key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                        onchange={(e) => {
                          const raw = (e.target as HTMLInputElement).value.trim();
                          let next = null;
                          if (raw !== '') {
                            const v = Number(raw);
                            if (Number.isFinite(v)) next = v <= 1 ? null : asLiteral(Math.floor(v));
                            else next = asExpr(raw);
                          }
                          setGraph(setStackChildCount(graph, n.id, childId, next));
                        }} />
                    </foreignObject>
                    <foreignObject x={size.w - 104} y={containerSlotY(i) - 10} width="48" height="20" class="ge-fo">
                      <!-- svelte-ignore a11y_no_static_element_interactions -->
                      <input class="ge-stack-inline-input" type="text" inputmode="decimal"
                        value={overrideRef ?? ''} placeholder={inheritedRef != null ? `z ${inheritedRef}` : 'z'}
                        title={overrideRef != null
                          ? `z-offset override: ${overrideRef} (clear to inherit ${inheritedRef ?? 0})`
                          : `z-offset — inheriting ${inheritedRef != null ? `the part's ${inheritedRef}` : '0'}; type a number to override (0 = flush · + = gap · − = overlap)`}
                        onpointerdown={(e) => e.stopPropagation()}
                        onkeydown={(e) => { if ((e as KeyboardEvent).key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                        onchange={(e) => {
                          const raw = (e.target as HTMLInputElement).value.trim();
                          const v = raw === '' ? null : Number(raw);
                          setGraph(setStackChildRef(graph, n.id, childId, v == null || Number.isNaN(v) ? null : v));
                        }} />
                    </foreignObject>
                  {/if}
                  <!-- ▲▼ reorder this part up / down in the stack. The slots
                       (and the stacked geometry) re-derive from children order.
                       Hidden at the ends so you can't move past the edge. -->
                  {#if i > 0}
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <text role="button" tabindex="-1" class="ge-container-slot-move"
                      x={size.w - 50} y={containerSlotY(i) + 4}
                      data-tip="Move up in the stack"
                      onpointerdown={(ev) => { ev.stopPropagation(); popovers!.moveChild(n.id, origIdx, -1); }}>▲</text>
                  {/if}
                  {#if i < visibleChildren.length - 1}
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <text role="button" tabindex="-1" class="ge-container-slot-move"
                      x={size.w - 32} y={containerSlotY(i) + 4}
                      data-tip="Move down in the stack"
                      onpointerdown={(ev) => { ev.stopPropagation(); popovers!.moveChild(n.id, origIdx, 1); }}>▼</text>
                  {/if}
                  <!-- × removes this child from the container -->
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <text role="button" tabindex="-1" class="ge-container-slot-x"
                    x={size.w - 14} y={containerSlotY(i) + 4}
                    onpointerdown={(ev) => { ev.stopPropagation(); setGraph(removeContainerChildAt(graph, n.id, origIdx)); }}>×</text>
                {/each}
                <!-- Trailing + drop slot — drag any output socket onto here to append. -->
                {@const trailY = containerSlotY(visibleChildren.length)}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle role="button" tabindex="-1" class="ge-sock in child trail" cx="0" cy={trailY} r="5"
                  onpointerup={(ev) => wire.endWireOnContainerSlot(ev, n.id)}/>
                <text x="10" y={trailY + 4} class="ge-sock-label trail">+ drop here</text>
                <!-- Non-root containers have an OUTPUT socket — their result
                     can feed upstream (e.g. into a method.obj). -->
                {#if !isRoot}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <circle role="button" tabindex="-1" class="ge-sock out" cx={size.w} cy={size.h / 2} r="6"
                    onpointerdown={(ev) => wire.startWire(ev, n.id)}/>
                {/if}
                {/if}

              {:else if n.type === 'polygon'}
                {@const poly = n as any}
                <!-- Polygon card — the profile editor's sole producer.
                     Compact reorderable vertex table where each (r, z)
                     coord is an editable literal OR an expression. ƒ
                     toggles a row's slot from literal to expr; the
                     expression syntax matches Call args (p.<name> wires
                     to the PARAMS slider, full JS allowed inside the box).
                     Output socket on the right edge feeds into Output. -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <rect role="button" tabindex="-1" class="ge-node-bg polygon"
                  width={size.w} height={size.h} rx="6"
                  style="width: {size.w}px; height: {size.h}px"
                  onpointerdown={(ev) => onNodePointerDown(ev, n.id)}
                  onpointermove={onNodePointerMove}
                  onpointerup={onNodePointerUp}
                />
                {@const polyConsumed = consumedSet.has(n.id)}
                <text x="10" y="22" class="ge-node-title">◇ polygon{polyConsumed ? ' · 🔒' : ''}</text>
                <!-- 👁 button — opens a floating SVG popup of the polygon's
                     current 2D shape. Useful when a downstream revolve
                     is showing the 3D BAKE on the right pane and the user
                     still wants to see the underlying 2D profile. -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <text role="button" tabindex="-1" x={size.w - 30} y="22"
                  class="ge-poly-eye" class:on={polyPreviewFor === n.id}
                  data-tip={polyPreviewFor === n.id ? 'Close 2D preview' : 'Show 2D preview'}
                  onpointerdown={(ev) => openPolyPreview(ev as any, n.id)}>👁</text>
                <!-- Delete disabled while another node consumes this polygon
                     (e.g. a revolve's profile arg wired via __POLY__<id>).
                     The 🔒 in the title signals the lock; hover tooltip
                     explains the constraint. Unwire the consumer first to
                     unlock + delete. -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <text role="button" tabindex="-1" x={size.w - 14} y="22" class="ge-node-x"
                  class:disabled={polyConsumed}
                  class:armed={del.isArmed(n.id)}
                  data-tip={polyConsumed
                    ? 'Polygon is wired into a Revolve / Extrude — delete the consumer first to unlock this polygon.'
                    : del.isArmed(n.id) ? 'Click again to delete' : 'Delete polygon'}
                  onpointerdown={(ev) => { ev.stopPropagation(); if (!polyConsumed && del.request(n.id)) onDeleteNode(n.id); }}>{del.isArmed(n.id) ? '✓' : '×'}</text>
                <line x1="0" y1="32" x2={size.w} y2="32" class="ge-node-divider"/>
                {@const polyMode = polygonModeFor(n.id)}
                {@const ax0 = polyMode === 'cartesian' ? 'x' : 'r'}
                {@const ax1 = polyMode === 'cartesian' ? 'y' : 'z'}
                <foreignObject x="6" y="36" width={size.w - 12} height={size.h - 40} class="ge-fo">
                  <div class="ge-polygon" xmlns="http://www.w3.org/1999/xhtml">
                    <!-- Vertex list — scrollable when count exceeds the cap.
                         Each vertex is two stacked sub-rows: top = socket
                         gutter + axis-0 label + value + ƒ + ▲▼+ ; bottom =
                         socket gutter + axis-1 label + value + ƒ + × .
                         The action columns are symmetric — top row adds a
                         new vertex ABOVE this one, bottom row removes this
                         vertex. Tight 16-px sub-row height keeps the card
                         compact even for many vertices. -->
                    <div class="ge-poly-vtx-list">
                    {#each (poly.points as Array<any>) as pt, idx (idx)}
                      {#if pt?.kind === 'repeat-ref'}
                        <!-- Repeat-ref summary row (#157) — points to a SEPARATE
                             PolyRepeatNode card. Shows a compact summary
                             "↳ Loop · × N" with the source's current count.
                             Editing the loop's expressions happens on the
                             source card; this row is just the splice anchor +
                             reorder + delete. -->
                        {@const src = graph.nodes[pt.sourceId]}
                        {@const srcCount = src?.type === 'poly_repeat' ? (src.count?.kind === 'literal' ? src.count.value : '?') : '?'}
                        {@const isMissing = !src || src.type !== 'poly_repeat'}
                        <div class="ge-poly-rref" class:missing={isMissing}
                          title={isMissing ? 'The loop card this row points to was deleted' : 'Loop ref — edit the expressions on the separate loop card'}>
                          <span class="ge-poly-rref-glyph" aria-hidden="true">↳</span>
                          <span class="ge-poly-rref-label">
                            Loop {isMissing ? '(missing)' : '· ×'} {isMissing ? '' : srcCount}
                          </span>
                          <span class="ge-poly-rref-spacer"></span>
                          <button class="ge-poly-mv" type="button" title="Move up" disabled={idx === 0}
                            onclick={() => { setGraph(movePolygonPoint(graph, n.id, idx, -1)); }}>▲</button>
                          <button class="ge-poly-mv" type="button" title="Move down" disabled={idx === poly.points.length - 1}
                            onclick={() => { setGraph(movePolygonPoint(graph, n.id, idx, 1)); }}>▼</button>
                          <button class="ge-poly-ins" type="button" title="Insert a vertex above this row"
                            onclick={() => { setGraph(addPolygonPoint(graph, n.id, idx - 1)); }}>+</button>
                          <button class="ge-poly-del" type="button" title="Remove this loop ref (drops the source card too)" disabled={poly.points.length <= 1}
                            onclick={() => { setGraph(removePolygonPoint(graph, n.id, idx)); }}>×</button>
                        </div>
                      {:else if pt?.kind === 'expr-list-ref'}
                        <!-- #11 — a list<point> OUTPUT of an expression instance,
                             spliced into the polygon as its points (the
                             expr-as-builder path). Summary row only; the formula
                             is edited on the expression (Σ menu). -->
                        {@const esrc = graph.nodes[pt.sourceId]}
                        {@const edef = (esrc as any)?.type === 'expr' ? (graph.exprDefs ?? []).find((d) => d.id === (esrc as any).defId) : null}
                        {@const eMissing = !esrc || (esrc as any).type !== 'expr' || !edef}
                        {@const elabel = edef ? `${edef.name} · ${pt.output}` : 'expr list (missing)'}
                        <div class="ge-poly-rref expr" class:missing={eMissing}
                          title={eMissing ? 'The expression this points to was deleted' : `list⟨point⟩ from ${elabel}`}>
                          <span class="ge-poly-rref-glyph" aria-hidden="true">ƒ[]</span>
                          <span class="ge-poly-rref-label">{elabel}</span>
                          <span class="ge-poly-rref-spacer"></span>
                          <button class="ge-poly-mv" type="button" title="Move up" disabled={idx === 0}
                            onclick={() => { setGraph(movePolygonPoint(graph, n.id, idx, -1)); }}>▲</button>
                          <button class="ge-poly-mv" type="button" title="Move down" disabled={idx === poly.points.length - 1}
                            onclick={() => { setGraph(movePolygonPoint(graph, n.id, idx, 1)); }}>▼</button>
                          <button class="ge-poly-del" type="button" title="Remove this expr-list ref" disabled={poly.points.length <= 1}
                            onclick={() => { setGraph(removePolygonPoint(graph, n.id, idx)); }}>×</button>
                        </div>
                      {:else if pt?.kind === 'repeat'}
                        <!-- DEPRECATED — inline repeat block (#154). Hydrate
                             migrates these to repeat-refs on file open, so
                             this branch is rarely hit in practice; kept as
                             a safety net for graphs that bypass hydration. -->
                        <div class="ge-poly-repeat">
                          <div class="ge-poly-repeat-head">
                            <span class="ge-poly-repeat-badge">× N</span>
                            <input class="ge-poly-input ge-poly-repeat-count" type="number" min="0" step="1"
                              value={pt.count?.kind === 'literal' ? pt.count.value : 6}
                              title="Number of points this block expands to (i = 0..N−1)"
                              oninput={(e) => { setGraph(setPolygonRepeatCount(graph, n.id, idx, { kind: 'literal', value: Math.max(0, Math.round(Number((e.target as HTMLInputElement).value) || 0)) })); }}/>
                            <span class="ge-poly-repeat-label">loop</span>
                            <input class="ge-poly-input ge-poly-repeat-var" type="text" maxlength="6"
                              value={String(pt.loopVar || 'i')}
                              title="Loop variable bound in the r and z expressions (default i)"
                              oninput={(e) => { setGraph(setPolygonRepeatLoopVar(graph, n.id, idx, String((e.target as HTMLInputElement).value) || 'i')); }}/>
                            <span class="ge-poly-repeat-spacer"></span>
                            <button class="ge-poly-mv" type="button" title="Move up" disabled={idx === 0}
                              onclick={() => { setGraph(movePolygonPoint(graph, n.id, idx, -1)); }}>▲</button>
                            <button class="ge-poly-mv" type="button" title="Move down" disabled={idx === poly.points.length - 1}
                              onclick={() => { setGraph(movePolygonPoint(graph, n.id, idx, 1)); }}>▼</button>
                            <button class="ge-poly-ins" type="button" title="Insert a vertex above this row"
                              onclick={() => { setGraph(addPolygonPoint(graph, n.id, idx - 1)); }}>+</button>
                            <button class="ge-poly-del" type="button" title="Remove repeat block" disabled={poly.points.length <= 1}
                              onclick={() => { setGraph(removePolygonPoint(graph, n.id, idx)); }}>×</button>
                          </div>
                          <div class="ge-poly-repeat-row">
                            <span class="ge-poly-axis-label">{ax0}({pt.loopVar || 'i'})</span>
                            <input class="ge-poly-input expr" type="text"
                              value={pt.r?.kind === 'expr' ? pt.r.expr : pt.r?.kind === 'literal' ? String(pt.r.value) : ''}
                              placeholder="cos(i*2*PI/6)"
                              oninput={(e) => { setGraph(setPolygonCoord(graph, n.id, idx, 'r', { kind: 'expr', expr: (e.target as HTMLInputElement).value })); }}/>
                          </div>
                          <div class="ge-poly-repeat-row">
                            <span class="ge-poly-axis-label">{ax1}({pt.loopVar || 'i'})</span>
                            <input class="ge-poly-input expr" type="text"
                              value={pt.z?.kind === 'expr' ? pt.z.expr : pt.z?.kind === 'literal' ? String(pt.z.value) : ''}
                              placeholder="sin(i*2*PI/6)"
                              oninput={(e) => { setGraph(setPolygonCoord(graph, n.id, idx, 'z', { kind: 'expr', expr: (e.target as HTMLInputElement).value })); }}/>
                          </div>
                        </div>
                      {:else}
                      <!-- svelte-ignore a11y_no_static_element_interactions -->
                      <div class="ge-poly-vertex"
                        class:vtx-active={hlVertex && hlVertex.polyId === n.id && hlVertex.idx === idx}
                        class:vtx-fn={pt.r?.kind !== 'literal' || pt.z?.kind !== 'literal'}
                        onmouseenter={() => setHoverVertex(n.id, idx)}
                        onmouseleave={() => clearHoverVertex(n.id, idx)}>
                        <!-- Axis-0 sub-row (top): [socket-gutter w/ 🗑 unwire] + label
                             + input + ƒ + reorder + insert-above. The 🗑 sits IN the
                             gutter column directly beside the SVG socket on the left
                             edge — same column as the existing socket overlay so a
                             user reading right-to-left from the input lands on
                             "[break-connection] [socket]" naturally. -->
                        {#if pt.r.kind === 'param'}
                          <button class="ge-poly-unwire" type="button"
                            title={`Disconnect from p.${pt.r.param} (keep current numeric value)`}
                            onclick={() => {
                              const v = Number((graph.params as any)?.[(pt.r as any).param]?.default ?? 0);
                              setGraph(setPolygonCoord(graph, n.id, idx, 'r', { kind: 'literal', value: v }));
                            }}><svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path fill="currentColor" d="M6 2h4l1 1h3v2H2V3h3l1-1zm-2 4h8l-1 8H5L4 6zm2 2v6h1V8H6zm3 0v6h1V8H9z"/></svg></button>
                        {:else if pt.r.kind === 'expr'}
                          <button class="ge-poly-unwire" type="button"
                            title="Back to a number (clears the expression)"
                            onclick={() => { setGraph(setPolygonCoord(graph, n.id, idx, 'r', { kind: 'literal', value: 0 })); }}><svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path fill="currentColor" d="M6 2h4l1 1h3v2H2V3h3l1-1zm-2 4h8l-1 8H5L4 6zm2 2v6h1V8H6zm3 0v6h1V8H9z"/></svg></button>
                        {:else}
                          <span></span>
                        {/if}
                        <span class="ge-poly-axis-label">{ax0}</span>
                        {#if pt.r.kind === 'literal'}
                          <input class="ge-poly-input" type="number" step="0.05"
                            value={pt.r.value}
                            oninput={(e) => { setGraph(setPolygonCoord(graph, n.id, idx, 'r', { kind: 'literal', value: Number((e.target as HTMLInputElement).value) })); }}/>
                        {:else if pt.r.kind === 'param'}
                          <!-- svelte-ignore a11y_click_events_have_key_events -->
                          <!-- svelte-ignore a11y_no_static_element_interactions -->
                          <span class="ge-poly-chip" title={`Wired to p.${pt.r.param} — click to write an expression like p.${pt.r.param} / 2`}
                            onclick={(ev) => openPolyExprPop(ev as any, n.id, idx, 'r', `p.${pt.r.param}`)}>p.{pt.r.param}</span>
                        {:else}
                          <input class="ge-poly-input expr" type="text"
                            value={pt.r.expr}
                            placeholder="p.od / 2"
                            oninput={(e) => { setGraph(setPolygonCoord(graph, n.id, idx, 'r', { kind: 'expr', expr: (e.target as HTMLInputElement).value })); }}/>
                        {/if}
                        <!-- ƒ button — ALWAYS opens the expression popover (#156,
                             2026-06-10). Previously it toggled modes inline:
                             pressing ƒ on `p.od / 2` would reset the value to
                             literal 0, silently losing the expression. Use the
                             trash button to clear; ƒ is for editing. -->
                        <button class="ge-poly-fx" type="button"
                          title={pt.r.kind === 'literal' ? 'Write an expression' : 'Edit expression'}
                          class:on={pt.r.kind !== 'literal'}
                          onclick={(ev) => {
                            const prefill = pt.r.kind === 'literal'
                              ? String((pt.r as any).value ?? 0)
                              : pt.r.kind === 'param'
                                ? `p.${(pt.r as any).param}`
                                : String((pt.r as any).expr ?? '');
                            openPolyExprPop(ev as any, n.id, idx, 'r', prefill);
                          }}>ƒ</button>
                        <button class="ge-poly-mv" type="button" title="Move up" disabled={idx === 0}
                          onclick={() => { setGraph(movePolygonPoint(graph, n.id, idx, -1)); }}>▲</button>
                        <button class="ge-poly-mv" type="button" title="Move down" disabled={idx === poly.points.length - 1}
                          onclick={() => { setGraph(movePolygonPoint(graph, n.id, idx, 1)); }}>▼</button>
                        <button class="ge-poly-ins" type="button" title="Insert a vertex above this row"
                          onclick={() => { setGraph(addPolygonPoint(graph, n.id, idx - 1)); }}>+</button>
                        <!-- Axis-1 sub-row (bottom): [socket-gutter w/ 🗑] + label
                             + input + ƒ + delete. Mirrors the r sub-row's gutter
                             layout — trash appears only when wired/expr. -->
                        {#if pt.z.kind === 'param'}
                          <button class="ge-poly-unwire" type="button"
                            title={`Disconnect from p.${pt.z.param} (keep current numeric value)`}
                            onclick={() => {
                              const v = Number((graph.params as any)?.[(pt.z as any).param]?.default ?? 0);
                              setGraph(setPolygonCoord(graph, n.id, idx, 'z', { kind: 'literal', value: v }));
                            }}><svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path fill="currentColor" d="M6 2h4l1 1h3v2H2V3h3l1-1zm-2 4h8l-1 8H5L4 6zm2 2v6h1V8H6zm3 0v6h1V8H9z"/></svg></button>
                        {:else if pt.z.kind === 'expr'}
                          <button class="ge-poly-unwire" type="button"
                            title="Back to a number (clears the expression)"
                            onclick={() => { setGraph(setPolygonCoord(graph, n.id, idx, 'z', { kind: 'literal', value: 0 })); }}><svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path fill="currentColor" d="M6 2h4l1 1h3v2H2V3h3l1-1zm-2 4h8l-1 8H5L4 6zm2 2v6h1V8H6zm3 0v6h1V8H9z"/></svg></button>
                        {:else}
                          <span></span>
                        {/if}
                        <span class="ge-poly-axis-label">{ax1}</span>
                        {#if pt.z.kind === 'literal'}
                          <input class="ge-poly-input" type="number" step="0.05"
                            value={pt.z.value}
                            oninput={(e) => { setGraph(setPolygonCoord(graph, n.id, idx, 'z', { kind: 'literal', value: Number((e.target as HTMLInputElement).value) })); }}/>
                        {:else if pt.z.kind === 'param'}
                          <!-- svelte-ignore a11y_click_events_have_key_events -->
                          <!-- svelte-ignore a11y_no_static_element_interactions -->
                          <span class="ge-poly-chip" title={`Wired to p.${pt.z.param} — click to write an expression like p.${pt.z.param} / 2`}
                            onclick={(ev) => openPolyExprPop(ev as any, n.id, idx, 'z', `p.${pt.z.param}`)}>p.{pt.z.param}</span>
                        {:else}
                          <input class="ge-poly-input expr" type="text"
                            value={pt.z.expr}
                            placeholder="p.len"
                            oninput={(e) => { setGraph(setPolygonCoord(graph, n.id, idx, 'z', { kind: 'expr', expr: (e.target as HTMLInputElement).value })); }}/>
                        {/if}
                        <button class="ge-poly-fx" type="button"
                          title={pt.z.kind === 'literal' ? 'Write an expression' : 'Edit expression'}
                          class:on={pt.z.kind !== 'literal'}
                          onclick={(ev) => {
                            const prefill = pt.z.kind === 'literal'
                              ? String((pt.z as any).value ?? 0)
                              : pt.z.kind === 'param'
                                ? `p.${(pt.z as any).param}`
                                : String((pt.z as any).expr ?? '');
                            openPolyExprPop(ev as any, n.id, idx, 'z', prefill);
                          }}>ƒ</button>
                        <!-- Cols 5-6 empty placeholders to anchor × in col 7
                             (the symmetric counterpart to the top row's +). -->
                        <span></span>
                        <span></span>
                        <button class="ge-poly-del" type="button" title="Remove vertex" disabled={poly.points.length <= 1}
                          onclick={() => { setGraph(removePolygonPoint(graph, n.id, idx)); }}>×</button>
                      </div>
                      {/if}
                    {/each}
                    </div>
                    <div class="ge-poly-add-row">
                      <button class="ge-poly-add" type="button" title="Add a vertex below the last row"
                        onclick={() => { setGraph(addPolygonPoint(graph, n.id)); }}>+ vertex</button>
                      <button class="ge-poly-add repeat" type="button" title="Add a REPEAT block — expands to N points via a loop"
                        onclick={() => { setGraph(addPolygonRepeat(graph, n.id)); }}>+ repeat</button>
                      <button class="ge-poly-add expr" type="button" title="Add an EXPRESSION that emits the points — a map() → list⟨point⟩, edited on the Σ expression"
                        onclick={() => { setGraph(addPolygonExprList(graph, n.id).graph); }}>+ expr</button>
                    </div>
                  </div>
                </foreignObject>
                <!-- Per-vertex coord input sockets — SVG circles outside the
                     foreignObject so they participate in the wire system.
                     Two sockets per vertex, one per sub-row stacked on the
                     LEFT edge:
                       top    (cy = polySockR)  -> axis-0 (r / x)
                       bottom (cy = polySockZ)  -> axis-1 (z / y)
                     Positions come from the polyRowTop cumulative walk
                     (rows are heterogeneous). Only renders sockets
                     for visible vertices (up to MAX_VISIBLE) so scrolled-
                     off rows aren't wirable from outside the card. -->
                {#each (poly.points as Array<any>) as pt, idx (idx)}
                  {#if idx < 8 && pt?.kind === 'repeat-ref'}
                    <!-- Repeat-ref input socket (#157) — single socket
                         centered vertically on the row. Wires in from a
                         PolyRepeatNode's output. Drag from this socket to
                         a different poly_repeat to repoint the ref. -->
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <circle role="button" tabindex="-1"
                      class="ge-sock in poly-rref-in wired"
                      cx="0" cy={polySockRef(n, idx)} r="6"
                      onpointerup={(ev) => wire.endWireOnPolygonRepeatRef(ev, n.id, idx)}/>
                  {:else if idx < 8 && pt?.kind === 'expr-list-ref'}
                    <!-- expr-list-ref input socket (#11 drag-to-wire) — drag a
                         list<point> expr OUTPUT here to repoint which expression
                         supplies the polygon's points. -->
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <circle role="button" tabindex="-1"
                      class="ge-sock in poly-elist-in wired"
                      cx="0" cy={polySockRef(n, idx)} r="6"
                      onpointerup={(ev) => wire.endWireOnPolygonExprListRef(ev, n.id, idx)}/>
                  {:else if idx < 8 && pt?.kind !== 'repeat' && pt?.kind !== 'expr-list-ref'}
                    <!-- Vertex r/z sockets — two stacked, one per axis. (Repeat-ref
                         + expr-list-ref rows have no per-coord sockets.) -->
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <circle role="button" tabindex="-1"
                      class={`ge-sock in poly-coord${pt.r.kind === 'param' ? ' wired' : ''}`}
                      cx="0" cy={polySockR(n, idx)} r="5"
                      onpointerup={(ev) => wire.endWireOnPolygonCoord(ev, n.id, idx, 'r')}/>
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <circle role="button" tabindex="-1"
                      class={`ge-sock in poly-coord${pt.z.kind === 'param' ? ' wired' : ''}`}
                      cx="0" cy={polySockZ(n, idx)} r="5"
                      onpointerup={(ev) => wire.endWireOnPolygonCoord(ev, n.id, idx, 'z')}/>
                  {/if}
                {/each}
                <!-- OUTPUT socket on right edge — wires to the Output card. -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle role="button" tabindex="-1" class="ge-sock out" cx={size.w} cy={size.h / 2} r="6"
                  onpointerdown={(ev) => wire.startWire(ev, n.id)}/>

              {:else if n.type === 'sketch'}
                <SketchNodeCard {sketch} {n} {size} {graph} setGraph={setGraph} {wire}
                  consumed={consumedSet.has(n.id)}
                  {onNodePointerDown} {onNodePointerMove} {onNodePointerUp}
                  {onDeleteNode} />

              {:else if n.type === 'poly_repeat'}
                {@const pr = n as any}
                <!-- PolyRepeat card (#157, 2026-06-10) — generates N points
                     via a (count, loopVar, r-expr, z-expr) tuple. Output
                     splices into one or more polygons at their repeat-ref
                     entries. Two sections: Params (count + loop var)
                     and Loop (r(i) + z(i) expressions). -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <rect role="button" tabindex="-1" class="ge-node-bg poly-repeat"
                  width={size.w} height={size.h} rx="6"
                  style="width: {size.w}px; height: {size.h}px"
                  onpointerdown={(ev) => onNodePointerDown(ev, n.id)}
                  onpointermove={onNodePointerMove}
                  onpointerup={onNodePointerUp}/>
                {@const prMode = polyRepeatModeFor(pr.id)}
                {@const prAx0 = prMode === 'cartesian' ? 'x' : 'r'}
                {@const prAx1 = prMode === 'cartesian' ? 'y' : 'z'}
                {@const prAx0Ph = prMode === 'cartesian' ? 'cos(i*2*PI/6)' : 'cos(i*2*PI/6)'}
                {@const prAx1Ph = prMode === 'cartesian' ? 'sin(i*2*PI/6)' : 'sin(i*2*PI/6)'}
                <text x="10" y="20" class="ge-node-title">↻ loop · {prAx0}/{prAx1}</text>
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <text role="button" tabindex="-1" x={size.w - 14} y="20" class="ge-node-x"
                  data-tip="Delete loop (refs in polygons will show as 'missing')"
                  onpointerdown={(ev) => { ev.stopPropagation(); setGraph(removeNode(graph, n.id)); }}>×</text>
                <line x1="0" y1="28" x2={size.w} y2="28" class="ge-node-divider"/>
                <foreignObject x="6" y="32" width={size.w - 12} height={size.h - 38} class="ge-fo">
                  <div class="ge-poly-repeat-card" xmlns="http://www.w3.org/1999/xhtml">
                    <div class="ge-prc-section-head">Params</div>
                    <div class="ge-prc-params">
                      <span class="ge-prc-label">NPts</span>
                      {#if pr.count?.kind === 'literal'}
                        <input class="ge-poly-input" type="number" min="0" step="1"
                          value={pr.count.value}
                          title="Number of points this loop generates (i = 0..NPts−1) — click ƒ to wire to a param"
                          oninput={(e) => { setGraph(setPolyRepeatCount(graph, pr.id, { kind: 'literal', value: Math.max(0, Math.round(Number((e.target as HTMLInputElement).value) || 0)) })); }}/>
                      {:else if pr.count?.kind === 'param'}
                        <!-- svelte-ignore a11y_click_events_have_key_events -->
                        <!-- svelte-ignore a11y_no_static_element_interactions -->
                        <span class="ge-poly-chip" title={`Wired to p.${pr.count.param} — click to edit`}
                          onclick={(ev) => openPolyRepeatCountExprPop(ev as any, pr.id, `p.${pr.count.param}`)}>p.{pr.count.param}</span>
                      {:else}
                        <input class="ge-poly-input expr" type="text"
                          value={pr.count.expr}
                          placeholder="p.teeth"
                          title="NPts expression — eval'd once at bake time"
                          oninput={(e) => { setGraph(setPolyRepeatCount(graph, pr.id, { kind: 'expr', expr: (e.target as HTMLInputElement).value })); }}/>
                      {/if}
                      <button class="ge-poly-fx" type="button"
                        title="Wire NPts to a param / expression"
                        class:on={pr.count?.kind !== 'literal'}
                        onclick={(ev) => {
                          const prefill = pr.count?.kind === 'expr' ? String(pr.count.expr)
                                        : pr.count?.kind === 'param' ? `p.${pr.count.param}`
                                        : String(pr.count?.value ?? 6);
                          openPolyRepeatCountExprPop(ev as any, pr.id, prefill);
                        }}>ƒ</button>
                      <span class="ge-prc-label">var</span>
                      <input class="ge-poly-input" type="text" maxlength="6"
                        value={String(pr.loopVar || 'i')}
                        title="Loop variable bound in r and z expressions"
                        oninput={(e) => { setGraph(setPolyRepeatLoopVar(graph, pr.id, String((e.target as HTMLInputElement).value) || 'i')); }}/>
                    </div>
                    <!-- Bindings section (#157, 2026-06-11) — local
                         constants like `amplitude = p.thread_height` or
                         `theta = i * tau / NPts`. Each binding evaluates
                         PER ITERATION (inside the loop), so it can use
                         the loop var + NPts + earlier bindings. The
                         label is `Bindings ƒ({i})` to match the Loop
                         section head so the user sees "these are inside
                         the loop body" at a glance. -->
                    <div class="ge-prc-section-head ge-prc-bindings-head">
                      <span>Bindings ƒ({pr.loopVar || 'i'})</span>
                      <button class="ge-prc-add" type="button" title="Add a local binding (evaluated each iteration)"
                        onclick={() => { setGraph(addPolyRepeatBinding(graph, pr.id)); }}>+</button>
                    </div>
                    {#each (pr.bindings ?? []) as bind, bIdx (bIdx)}
                      <div class="ge-prc-bind-row">
                        <input class="ge-poly-input ge-prc-bind-name" type="text" maxlength="12"
                          value={bind.name}
                          placeholder="name"
                          title="Binding name (used in r and z expressions)"
                          oninput={(e) => { setGraph(setPolyRepeatBindingName(graph, pr.id, bIdx, String((e.target as HTMLInputElement).value))); }}/>
                        <span class="ge-prc-eq">=</span>
                        <input class="ge-poly-input expr" type="text"
                          value={bind.value?.kind === 'expr' ? bind.value.expr : bind.value?.kind === 'literal' ? String(bind.value.value) : ''}
                          placeholder="p.od / 2"
                          oninput={(e) => { setGraph(setPolyRepeatBindingValue(graph, pr.id, bIdx, { kind: 'expr', expr: (e.target as HTMLInputElement).value })); }}/>
                        <button class="ge-poly-fx" type="button"
                          title="Edit expression with param chips"
                          class:on={bind.value?.kind !== 'literal'}
                          onclick={(ev) => {
                            const prefill = bind.value?.kind === 'expr' ? String(bind.value.expr)
                                          : bind.value?.kind === 'literal' ? String(bind.value.value)
                                          : '';
                            openPolyBindingExprPop(ev as any, pr.id, bIdx, prefill);
                          }}>ƒ</button>
                        <button class="ge-poly-del ge-prc-bind-del" type="button" title="Remove this binding"
                          onclick={() => { setGraph(removePolyRepeatBinding(graph, pr.id, bIdx)); }}>×</button>
                      </div>
                    {/each}
                    <div class="ge-prc-section-head">Loop ƒ({pr.loopVar || 'i'})</div>
                    <div class="ge-prc-expr-row">
                      <span class="ge-prc-label">{prAx0}</span>
                      <input class="ge-poly-input expr" type="text"
                        value={pr.r?.kind === 'expr' ? pr.r.expr : pr.r?.kind === 'literal' ? String(pr.r.value) : ''}
                        placeholder={prAx0Ph}
                        oninput={(e) => { setGraph(setPolyRepeatCoord(graph, pr.id, 'r', { kind: 'expr', expr: (e.target as HTMLInputElement).value })); }}/>
                      <button class="ge-poly-fx" type="button"
                        title="Edit expression with param chips"
                        class:on={pr.r?.kind !== 'literal'}
                        onclick={(ev) => {
                          const prefill = pr.r?.kind === 'expr' ? String(pr.r.expr)
                                        : pr.r?.kind === 'literal' ? String(pr.r.value)
                                        : '';
                          openPolyRepeatExprPop(ev as any, pr.id, 'r', prefill);
                        }}>ƒ</button>
                    </div>
                    <div class="ge-prc-expr-row">
                      <span class="ge-prc-label">{prAx1}</span>
                      <input class="ge-poly-input expr" type="text"
                        value={pr.z?.kind === 'expr' ? pr.z.expr : pr.z?.kind === 'literal' ? String(pr.z.value) : ''}
                        placeholder={prAx1Ph}
                        oninput={(e) => { setGraph(setPolyRepeatCoord(graph, pr.id, 'z', { kind: 'expr', expr: (e.target as HTMLInputElement).value })); }}/>
                      <button class="ge-poly-fx" type="button"
                        title="Edit expression with param chips"
                        class:on={pr.z?.kind !== 'literal'}
                        onclick={(ev) => {
                          const prefill = pr.z?.kind === 'expr' ? String(pr.z.expr)
                                        : pr.z?.kind === 'literal' ? String(pr.z.value)
                                        : '';
                          openPolyRepeatExprPop(ev as any, pr.id, 'z', prefill);
                        }}>ƒ</button>
                    </div>
                  </div>
                </foreignObject>
                <!-- Output socket on the right edge — wires into a polygon's
                     repeat-ref row. The wire visualisation is computed in
                     the connector layer below; this socket is the source. -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle role="button" tabindex="-1" class="ge-sock out poly-repeat-out"
                  cx={size.w} cy={size.h / 2} r="6"
                  onpointerdown={(ev) => wire.startWire(ev, n.id)}/>
                <!-- NPts input socket — left edge, aligned with the NPts
                     row inside the foreignObject (header 28 + section
                     head 18 + half-row 11 ≈ 57). Drag a param's output
                     onto this socket to wire p.<name> → NPts. -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle role="button" tabindex="-1"
                  class={`ge-sock in poly-repeat-in${pr.count?.kind === 'param' ? ' wired' : ''}`}
                  cx="0" cy="57" r="5"
                  onpointerup={(ev) => wire.endWireOnPolyRepeatCount(ev, pr.id)}/>

              {:else if n.type === 'sketch_repeat'}
                {@const sr = n as any}
                <!-- Sketch-repeat card (B.2 / #805) — the poly_repeat analog
                     for the 2D sketch surface. Holds a PROTOTYPE run of sketch
                     ops that tiles `count`× when the sketch compiles. PARAMS
                     (count/loopVar/dr/dz) + bindings + the prototype op list
                     (edited via the same sketch-op mutators). Output splices
                     into the parent sketch's ↻ repeat-ref row. -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <rect role="button" tabindex="-1" class="ge-node-bg sketch-repeat"
                  width={size.w} height={size.h} rx="6"
                  style="width: {size.w}px; height: {size.h}px"
                  onpointerdown={(ev) => onNodePointerDown(ev, n.id)}
                  onpointermove={onNodePointerMove}
                  onpointerup={onNodePointerUp}/>
                <text x="10" y="20" class="ge-node-title">↻ sketch repeat</text>
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <text role="button" tabindex="-1" x={size.w - 14} y="20" class="ge-node-x"
                  data-tip="Delete repeat (the sketch's ↻ row will show 'missing source')"
                  onpointerdown={(ev) => { ev.stopPropagation(); setGraph(removeNode(graph, n.id)); }}>×</text>
                <line x1="0" y1="28" x2={size.w} y2="28" class="ge-node-divider"/>
                <foreignObject x="6" y="32" width={size.w - 12} height={size.h - 38} class="ge-fo">
                  <div class="ge-poly-repeat-card" xmlns="http://www.w3.org/1999/xhtml">
                    <div class="ge-prc-section-head">Params</div>
                    <div class="ge-sr-params">
                      <span class="ge-prc-label">count</span>
                      <input class="ge-poly-input" type="text"
                        value={argStr(sr.count)}
                        title="Iterations (i = 0..count−1) — a number or p.param / expression"
                        onchange={(e) => { setGraph(setSketchRepeatCount(graph, sr.id, argFrom((e.target as HTMLInputElement).value))); }}/>
                      <span class="ge-prc-label">var</span>
                      <input class="ge-poly-input" type="text" maxlength="6"
                        value={String(sr.loopVar || 'i')}
                        title="Loop variable bound in prototype op exprs (NPts = count is also in scope)"
                        oninput={(e) => { setGraph(setSketchRepeatLoopVar(graph, sr.id, String((e.target as HTMLInputElement).value) || 'i')); }}/>
                    </div>
                    <div class="ge-sr-params">
                      <span class="ge-prc-label" title="Per-iteration advance in r (stride between copies)">Δr</span>
                      <input class="ge-poly-input" type="text"
                        value={sr.dr != null ? argStr(sr.dr) : ''} placeholder="0"
                        title="Per-iteration r advance — a leading rel move per copy (blank = none)"
                        onchange={(e) => { setGraph(setSketchRepeatAdvance(graph, sr.id, 'dr', argFrom((e.target as HTMLInputElement).value || '0'))); }}/>
                      <span class="ge-prc-label" title="Per-iteration advance in z (pitch between copies)">Δz</span>
                      <input class="ge-poly-input" type="text"
                        value={sr.dz != null ? argStr(sr.dz) : ''} placeholder="0"
                        title="Per-iteration z advance / pitch — a leading rel move per copy (blank = none)"
                        onchange={(e) => { setGraph(setSketchRepeatAdvance(graph, sr.id, 'dz', argFrom((e.target as HTMLInputElement).value || '0'))); }}/>
                    </div>
                    <!-- Bindings — local per-iteration named values (in scope
                         for the prototype op exprs alongside i + NPts). -->
                    <div class="ge-prc-section-head ge-prc-bindings-head">
                      <span>Bindings ƒ({sr.loopVar || 'i'})</span>
                      <button class="ge-prc-add" type="button" title="Add a local binding (evaluated each iteration)"
                        onclick={() => { setGraph(addSketchRepeatBinding(graph, sr.id)); }}>+</button>
                    </div>
                    {#each (sr.bindings ?? []) as bind, bIdx (bIdx)}
                      <div class="ge-prc-bind-row">
                        <input class="ge-poly-input ge-prc-bind-name" type="text" maxlength="12"
                          value={bind.name} placeholder="name"
                          oninput={(e) => { setGraph(setSketchRepeatBindingName(graph, sr.id, bIdx, String((e.target as HTMLInputElement).value))); }}/>
                        <span class="ge-prc-eq">=</span>
                        <input class="ge-poly-input expr" type="text"
                          value={argStr(bind.value)} placeholder="p.thread_height"
                          onchange={(e) => { setGraph(setSketchRepeatBindingValue(graph, sr.id, bIdx, argFrom((e.target as HTMLInputElement).value))); }}/>
                        <button class="ge-poly-del ge-prc-bind-del" type="button" title="Remove this binding"
                          onclick={() => { setGraph(removeSketchRepeatBinding(graph, sr.id, bIdx)); }}>×</button>
                      </div>
                    {/each}
                    <!-- Prototype ops — the run that tiles count×. Edited with
                         the same sketch-op mutators (the repeat node owns its
                         own `ops`). NO nested + repeat (v1). -->
                    <div class="ge-prc-section-head">Prototype ops</div>
                    {#each (sr.ops as Array<any>) as op, opIdx (opIdx)}
                      <div class="ge-sr-op-row">
                        {#if op.op === 'line' || op.op === 'spline'}
                          <button class="ge-sr-mode" class:rel={op.mode === 'rel'} type="button"
                            title="Toggle absolute / Δ relative (offset from previous point)"
                            onclick={() => { setGraph(setSketchOpMode(graph, sr.id, opIdx, op.mode === 'rel' ? 'abs' : 'rel')); }}>{op.op === 'spline' ? '~' : ''}{op.mode === 'rel' ? 'Δ' : 'abs'}</button>
                          <input class="ge-poly-input ge-sr-coord" type="text" value={argStr(op.r)} title="r / Δr"
                            onchange={(e) => { setGraph(setSketchOpField(graph, sr.id, opIdx, 'r', argFrom((e.target as HTMLInputElement).value))); }}/>
                          <input class="ge-poly-input ge-sr-coord" type="text" value={argStr(op.z)} title="z / Δz"
                            onchange={(e) => { setGraph(setSketchOpField(graph, sr.id, opIdx, 'z', argFrom((e.target as HTMLInputElement).value))); }}/>
                        {:else}
                          <span class="ge-sr-mode corner">{op.op === 'fillet' ? 'fil' : 'chm'}</span>
                          <input class="ge-poly-input ge-sr-coord wide" type="text" value={argStr(op.op === 'fillet' ? op.radius : op.dist)} title={op.op === 'fillet' ? 'fillet radius' : 'chamfer dist'}
                            onchange={(e) => { setGraph(setSketchOpField(graph, sr.id, opIdx, op.op === 'fillet' ? 'radius' : 'dist', argFrom((e.target as HTMLInputElement).value))); }}/>
                        {/if}
                        <button class="ge-poly-del" type="button" title="Move up" disabled={opIdx === 0}
                          onclick={() => { setGraph(moveSketchOp(graph, sr.id, opIdx, -1)); }}>▲</button>
                        <button class="ge-poly-del" type="button" title="Move down" disabled={opIdx === sr.ops.length - 1}
                          onclick={() => { setGraph(moveSketchOp(graph, sr.id, opIdx, 1)); }}>▼</button>
                        <button class="ge-poly-del" type="button" title="Remove op" disabled={sr.ops.length <= 1}
                          onclick={() => { setGraph(removeSketchOp(graph, sr.id, opIdx)); }}>×</button>
                      </div>
                    {/each}
                    <div class="ge-sr-foot">
                      <button class="ge-sr-add" type="button" title="Add a line" onclick={() => { setGraph(addSketchOp(graph, sr.id, 'line')); }}>+ line</button>
                      <button class="ge-sr-add" type="button" title="Add a spline" onclick={() => { setGraph(addSketchOp(graph, sr.id, 'spline')); }}>+ spline</button>
                      <button class="ge-sr-add" type="button" title="Round the previous corner" onclick={() => { setGraph(addSketchOp(graph, sr.id, 'fillet')); }}>+ fillet</button>
                      <button class="ge-sr-add" type="button" title="Bevel the previous corner" onclick={() => { setGraph(addSketchOp(graph, sr.id, 'chamfer')); }}>+ chamfer</button>
                    </div>
                  </div>
                </foreignObject>
                <!-- Output socket — its expanded prototype splices into the
                     parent sketch's ↻ repeat-ref row (auto-wired at create). -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle role="button" tabindex="-1" class="ge-sock out poly-repeat-out"
                  cx={size.w} cy={size.h / 2} r="6"
                  onpointerdown={(ev) => wire.startWire(ev, n.id)}/>

              {:else if n.type === 'expr'}
                {@const ex = n as any}
                {@const exprDef = (graph.exprDefs ?? []).find((d) => d.id === ex.defId)}
                {@const exParams = (exprDef?.params ?? []) as Array<any>}
                {@const exOutputs = (exprDef?.outputs ?? []) as Array<any>}
                <!-- Expr INSTANCE (B.7 v3) — a thin reference to a per-part
                     ExprDef. Reads THROUGH the def: title = def name, input
                     sockets (LEFT) = def.params, output sockets (RIGHT) =
                     def.outputs (line-aligned to their rows). Editing is via the
                     ✎ button → the def's four-section editor (shared by every
                     instance). A dangling defId shows an error chip. -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <rect role="button" tabindex="-1" class="ge-node-bg expr"
                  width={size.w} height={size.h} rx="6"
                  style="width: {size.w}px; height: {size.h}px"
                  onpointerdown={(ev) => onNodePointerDown(ev, n.id)}
                  onpointermove={onNodePointerMove}
                  onpointerup={onNodePointerUp}/>
                <text x="10" y="20" class="ge-node-title">ƒ {exprDef?.name ?? '(missing def)'}</text>
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <text role="button" tabindex="-1" x={size.w - 32} y="20" class="ge-node-x"
                  data-tip="Edit this expression definition"
                  onpointerdown={(ev) => { ev.stopPropagation(); openExprDefEditor(ev as any, ex.defId); }}>✎</text>
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <text role="button" tabindex="-1" x={size.w - 14} y="20" class="ge-node-x"
                  data-tip="Delete this expression instance"
                  onpointerdown={(ev) => { ev.stopPropagation(); setGraph(removeNode(graph, n.id)); }}>×</text>
                <line x1="0" y1="28" x2={size.w} y2="28" class="ge-node-divider"/>
                <foreignObject x="6" y="32" width={size.w - 12} height={size.h - 38} class="ge-fo">
                  <div class="ge-expr-card" xmlns="http://www.w3.org/1999/xhtml">
                    {#if !exprDef}
                      <div class="ge-expr-in-label muted">dangling def — ✎ to recreate</div>
                    {:else}
                      <!-- Input gutter — one label per PARAM, aligned to the
                           left-edge sockets. -->
                      <div class="ge-expr-inputs">
                        {#each exParams as p (p.name)}
                          <div class="ge-expr-in-label" title={`Param ${p.name} (wire a value into its socket)`}>{p.name}</div>
                        {/each}
                        {#if exParams.length === 0}
                          <div class="ge-expr-in-label muted">(no params)</div>
                        {/if}
                      </div>
                      <!-- Output rows — name-only label next to each output socket.
                           The ` = formula` value was dropped: it overflowed the card
                           into the output socket. Name stays the socket's label; the
                           formula is kept as the row's hover title. -->
                      <div class="ge-expr-outputs">
                        {#each exOutputs as out (out.name)}
                          <div class="ge-expr-out-row ge-expr-ro">
                            <span class="ge-expr-name" title={out.formula}>{out.name}</span>
                          </div>
                        {/each}
                        {#if exOutputs.length === 0}
                          <div class="ge-expr-in-label muted">(no outputs)</div>
                        {/if}
                      </div>
                    {/if}
                  </div>
                </foreignObject>
                <!-- INPUT sockets (left edge) — one per PARAM, aligned to its
                     gutter label. Drop a value wire here to bind the param. -->
                {#each exParams as p, iIdx (p.name)}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <circle role="button" tabindex="-1" class="ge-sock in expr-in"
                    cx="0" cy={exprInputSockY(iIdx)} r="5"
                    onpointerup={(ev) => wire.endWireOnExprInput(ev, n.id, p.name)}/>
                {/each}
                <!-- OUTPUT sockets (right edge) — one per OUTPUT, line-aligned to
                     its row. Start a wire toward a consumer. -->
                {#each exOutputs as out, oIdx (out.name)}
                  {@const opt = exprOutPort(out)}
                  {@const isList = opt.isList}
                  <!-- Output socket coloured by its INFERRED (or annotated) type
                       (typed-expression-outputs Phase B): a point-list reads
                       indigo/sky + larger; a scalar stays teal. -->
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <circle role="button" tabindex="-1" class="ge-sock out expr-out" class:list={isList}
                    style={`fill: ${opt.color}; stroke: ${opt.color}`}
                    cx={size.w} cy={exprOutputSockY(oIdx)} r={isList ? 6 : 5}
                    data-tip={`${out.name}: ${opt.label}${isList ? ' — drag onto a polygon’s ƒ[] row to wire' : ''}`}
                    onpointerdown={(ev) => wire.startExprOutWire(ev, n.id, out.name)}/>
                {/each}
              {:else if n.type === 'spline'}
                {@const splinePort = portType('list<point3>')}
                {@const ptsPort = portType('list<point3>')}
                {@const wired = (n as any).pointsExpr != null}
                {@const plotted = (n as any).plot === true}
                {@const sw = size.w}
                {@const sh = size.h}
                <!-- Spline PATH producer (TODO #15) — minimal card: a curved-spline
                     glyph + ✎ edit + × close + the list<point3> output socket. All
                     the detail (points, N, 3D edit) lives in SplineEditorPopup.
                     LEFT edge carries a control-POINTS input socket (TODO #26):
                     wire an expr's list<point> output here to drive the control
                     points; unwired uses the manual points. -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <rect role="button" tabindex="-1" class="ge-node-bg spline" class:wired
                  width={sw} height={sh} rx="6"
                  data-tip="Spline path → r_sweep.path (list of 3D points). Wire an expr's points into the LEFT socket to drive control points · ✎ edit manually in 3D · drag the RIGHT socket into a sweep's path."
                  style="width: {sw}px; height: {sh}px"
                  onpointerdown={(ev) => onNodePointerDown(ev, n.id)}
                  onpointermove={onNodePointerMove}
                  onpointerup={onNodePointerUp}/>
                <!-- POINTS INPUT socket (left edge, centered) — accepts an expr's
                     list<point2|3> output as the spline's control points (#26).
                     `wire.endWireOnSplinePoints` type-checks + stores pointsExpr. -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle role="button" tabindex="-1" class="ge-sock in expr-in list" class:wired
                  style={ptsPort ? `fill: ${ptsPort.color}; stroke: ${ptsPort.color}` : ''}
                  cx="0" cy={sh / 2} r="6"
                  data-tip={wired ? 'points: from a wired expression — drop another to repoint' : `points: ${ptsPort?.label ?? 'list of points'} — wire an expr’s points output here to drive the control points`}
                  onpointerup={(ev) => wire.endWireOnSplinePoints(ev, n.id)}/>
                {#if wired}
                  <!-- wired badge — the manual editor is overridden by the expr -->
                  <text x="11" y="12" class="ge-sp-wired-badge">ƒ pts</text>
                {/if}
                <!-- inline row (ONE row): ✎ edit · 📈 plot-toggle · small spline glyph · × -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <text role="button" tabindex="-1" x="11" y={sh / 2 + 5} class="ge-node-x ge-sp-glyph"
                  data-tip="Edit this spline's control points in 3D"
                  onpointerdown={(ev) => { ev.stopPropagation(); onOpenSplineEditor(ev as any, n.id); }}>✎</text>
                <!-- 📈 plot-in-main-3D-bake toggle (TODO #24) — VIEW-ONLY overlay, now on
                     the SAME row as ✎ (compact spline card). -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <text role="button" tabindex="-1" x="27" y={sh / 2 + 5} class="ge-sp-plot" class:on={plotted}
                  data-tip="Plot this spline in the main 3D bake (overlay curve + points, so several splines read relative to each other + the swept mesh). View-only."
                  onpointerdown={(ev) => { ev.stopPropagation(); setGraph(setSplinePlot(graph, n.id, !plotted)); }}>📈</text>
                <path class="ge-spline-preview" fill="none"
                  d={`M 46 ${sh * 0.62} Q ${sw * 0.6} ${sh * 0.28} ${sw - 26} ${sh * 0.5}`}/>
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <text role="button" tabindex="-1" x={sw - 19} y={sh / 2 + 5} class="ge-node-x ge-sp-glyph"
                  data-tip="Delete this spline node"
                  onpointerdown={(ev) => { ev.stopPropagation(); setGraph(removeNode(graph, n.id)); }}>×</text>
                <!-- OUTPUT socket (right edge, centered) — list<point3> → r_sweep.path.
                     `'path'` matches emitSplineBlocks' exprBlockMember(id,'path'). -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle role="button" tabindex="-1" class="ge-sock out expr-out list"
                  style={splinePort ? `fill: ${splinePort.color}; stroke: ${splinePort.color}` : ''}
                  cx={sw} cy={sh / 2} r="6"
                  data-tip={`path: ${splinePort?.label ?? 'list of 3D points'} — drag onto a sweep’s path arg`}
                  onpointerdown={(ev) => wire.startExprOutWire(ev, n.id, 'path')}/>

              {:else if n.type === 'material'}
                {@const m = n as any}
                {@const mw = size.w}
                {@const mh = size.h}
                {@const swatch = m.colorOuter ?? '#cc2222'}
                <!-- MATERIAL node (G-MAT-CARD) — a COMPACT pill: a colour badge +
                     "◑ name" label + the material OUTPUT socket. Click the badge/
                     label to edit (colour · inner · material · opacity · texture)
                     in a popover; drag the RIGHT socket onto a part's ◑ socket to
                     assign it, replacing the Properties per-part assignment. -->
                <!-- Pill body — DRAG to move (like any node). -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <rect role="button" tabindex="-1" class="ge-node-bg material"
                  width={mw} height={mh} rx={mh / 2}
                  data-tip="Material — drag to move · click the colour badge to edit · drag the RIGHT socket into a part's ◑ socket to assign it."
                  style="width: {mw}px; height: {mh}px"
                  onpointerdown={(ev) => onNodePointerDown(ev, n.id)}
                  onpointermove={onNodePointerMove}
                  onpointerup={onNodePointerUp}/>
                <!-- ◑ glyph (bigger, LEFT) — CLICK to open the editor. -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <text role="button" tabindex="-1" x="11" y={mh / 2 + 6} class="ge-mat-glyph"
                  data-tip="Edit this material (colour · inner · material · opacity · texture)"
                  onpointerdown={(ev) => { ev.stopPropagation(); onOpenMaterialEditor?.(ev, n.id); }}>◑</text>
                <!-- name (display; drag falls through to the body) -->
                <text x="30" y={mh / 2 + 4} class="ge-mat-label" pointer-events="none">{m.name ?? 'material'}</text>
                <!-- material colour BADGE (after the name) — click to edit too. -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <rect role="button" tabindex="-1" class="ge-mat-badge"
                  x={mw - 50} y={mh / 2 - 6} width="18" height="12" rx="2" style={`fill: ${swatch}`}
                  data-tip="Edit this material (colour · inner · material · opacity · texture)"
                  onpointerdown={(ev) => { ev.stopPropagation(); onOpenMaterialEditor?.(ev, n.id); }}/>
                <!-- × delete -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <text role="button" tabindex="-1" x={mw - 24} y={mh / 2 + 4} class="ge-node-x ge-mat-del"
                  data-tip="Delete this material node (also unwires any parts using it)"
                  onpointerdown={(ev) => { ev.stopPropagation(); setGraph(removeMaterialNode(graph, n.id)); }}>×</text>
                <!-- OUTPUT socket (right edge, centered) — material channel. -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle role="button" tabindex="-1" class="ge-sock out material-out"
                  cx={mw} cy={mh / 2} r="6"
                  data-tip="material out — drag onto a part's ◑ material socket to assign this appearance"
                  onpointerdown={(ev) => wire.startMaterialWire(ev, n.id)}/>

              {:else if n.type === 'warp'}
                {@const w = n as any}
                {@const warpKids = (Array.isArray(w.children) && w.children.length) ? w.children : (w.child ? [w.child] : [])}
                {@const pathWired = (w.path?.kind === 'expr' && String(w.path.expr) !== '[]' && String(w.path.expr).trim() !== '')
                  || w.path?.kind === 'param'}
                {@const nSolids = warpKids.length}
                {@const wcy = size.h / 2}
                <!-- Warp / bend MODIFIER (#36 / #36b) — SINGLE compact CHIP ROW (like
                     the mv/rot icon chips): the ≈ icon centred, every wired `solid`
                     fans into the ONE ×N socket on the LEFT edge, the SPLINE `path`
                     drops onto the TOP-MIDDLE socket, the bent result exits the RIGHT
                     edge. ⚙ = refine/stretch/validate popover; × = delete. 1 solid →
                     warpSpline(child,path); ≥2 → each warped SEPARATELY (a part inside
                     a transparent open-hole stays independent). -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <rect role="button" tabindex="-1" class="ge-node-bg warp"
                  width={size.w} height={size.h} rx="8"
                  data-tip="Warp: bend built solids along a spline. Wire one or MORE solids into the LEFT ×N socket (drop adds another) + a SPLINE'S path into the TOP-MIDDLE socket. Each solid is warped separately (no fusion). ⚙ opts: refine = smoother bend; stretch = span the whole spline; validate = warn on an inverted bend."
                  onpointerdown={(ev) => onNodePointerDown(ev, n.id)}
                  onpointermove={onNodePointerMove}
                  onpointerup={onNodePointerUp}/>
                <!-- ≈ warp icon — centred (decorative; drag falls through to the chip). -->
                <text x={size.w / 2} y={wcy + 6} class="ge-warp-icon" text-anchor="middle" pointer-events="none">≈</text>
                <!-- PATH input — TOP-MIDDLE socket (#compact): a spline's `path` output
                     drops here (X = card middle, cy = top edge). -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle role="button" tabindex="-1" class="ge-sock in expr-in list" class:wired={pathWired}
                  cx={size.w / 2} cy={WARP_PATH_CY} r="6"
                  data-tip={pathWired ? 'path: wired to a spline — drop another to repoint' : 'path: wire a spline’s output (list of points) here'}
                  onpointerup={(ev) => wire.endWireOnWarpPath(ev, n.id)}/>
                <!-- SOLIDS input — ONE compact ×N socket on the LEFT edge (#31): every
                     wired solid fans into it (drop = APPEND another; remove a solid by
                     clicking its wire → delete). The ×N badge shows how many are wired. -->
                <text x="13" y={WARP_CHILD_CY + 4} class="ge-warp-lbl" class:wired={nSolids > 0}>{nSolids > 0 ? `×${nSolids}` : ''}</text>
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <ellipse role="button" tabindex="-1" class="ge-sock in child multi" class:wired={nSolids > 0}
                  cx="0" cy={WARP_CHILD_CY} rx="8" ry="6"
                  data-tip="solids: wire one or MORE built parts to bend along the SAME spline (drop APPENDS another; each warped separately). Remove a solid by clicking its wire → Delete."
                  onpointerup={(ev) => wire.endWireOnWarpSolid(ev, n.id, warpKids.length)}/>
                <!-- ⚙ options (refine / stretch / validate) → popover — top-right, compact -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <text role="button" tabindex="-1" x={size.w - 38} y="15" class="ge-container-cog ge-warp-cog"
                  data-tip="Warp options — refine · stretch · validate"
                  onpointerdown={(ev) => { ev.stopPropagation(); popovers?.openWarpPop(ev, n.id); }}>⚙</text>
                <!-- delete × — top-right corner, compact -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <text role="button" tabindex="-1" x={size.w - 20} y="15" class="ge-node-x ge-warp-x"
                  class:armed={del.isArmed(n.id)}
                  data-tip={del.isArmed(n.id) ? 'Click again to delete' : 'Delete node'}
                  onpointerdown={(ev) => { ev.stopPropagation(); if (del.request(n.id)) onDeleteNode(n.id); }}>{del.isArmed(n.id) ? '✓' : '×'}</text>
                <!-- OUTPUT — RIGHT edge, vertically centred -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle role="button" tabindex="-1" class="ge-sock out" cx={size.w} cy={wcy} r="6"
                  data-tip="the bent solid — wire into Output, a CSG op, or another modifier"
                  onpointerdown={(ev) => wire.startWire(ev, n.id)}/>

              {:else if n.type === 'cutaway'}
                {@const cu = n as any}
                {@const cuChildWired = typeof cu.child === 'string' && !!cu.child && !!graph.nodes[cu.child]}
                {@const azVal = cu.az?.kind === 'literal' ? Number(cu.az.value) : NaN}
                {@const offVal = cu.offset?.kind === 'literal' ? Number(cu.offset.value) : NaN}
                <!-- Cutaway / cross-section MODIFIER — subtracts an authored
                     angular wedge from the wired `solid` (child), emitting
                     sectionCut(child, { az, offset }). solid wires in on the
                     LEFT, sectioned result out the RIGHT; az (angular sweep) +
                     offset (axial position) in the body row. -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <rect role="button" tabindex="-1" class="ge-node-bg cutaway"
                  width={size.w} height={size.h} rx="6"
                  data-tip="Cutaway: subtract an authored angular cross-section wedge from a built solid. Wire the SOLID into the left socket. az = how much to cut (0 = none, 180 = half-section, 360 = full removal); offset = axial (Z) position of the cut."
                  onpointerdown={(ev) => onNodePointerDown(ev, n.id)}
                  onpointermove={onNodePointerMove}
                  onpointerup={onNodePointerUp}/>
                <text x="12" y="20" class="ge-node-title">✂ section</text>
                <line x1="0" y1="28" x2={size.w} y2="28" class="ge-node-divider"/>
                <!-- delete × (top-right) -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <text role="button" tabindex="-1" x={size.w - 18} y="20" class="ge-node-x"
                  class:armed={del.isArmed(n.id)}
                  data-tip={del.isArmed(n.id) ? 'Click again to delete' : 'Delete node'}
                  onpointerdown={(ev) => { ev.stopPropagation(); if (del.request(n.id)) onDeleteNode(n.id); }}>{del.isArmed(n.id) ? '✓' : '×'}</text>
                <!-- SOLID (child) input — LEFT, CUTAWAY_CHILD_CY -->
                <text x="14" y={CUTAWAY_CHILD_CY + 4} class="ge-cut-lbl" class:wired={cuChildWired}>solid</text>
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle role="button" tabindex="-1" class="ge-sock in child" class:wired={cuChildWired}
                  cx="0" cy={CUTAWAY_CHILD_CY} r="6"
                  data-tip="solid: wire the built part to section (any node's output)"
                  onpointerup={(ev) => wire.endWireOnInput(ev, n.id, 'child')}/>
                <!-- OPTS row: az (angular sweep) + offset (axial position) -->
                <foreignObject x="10" y={CUTAWAY_CHILD_CY + 22} width={size.w - 16} height="34">
                  <div class="ge-cut-opts" xmlns="http://www.w3.org/1999/xhtml">
                    <label class="ge-cut-fld" title="Angular sweep of the removed wedge (degrees): 0 = no cut, 180 = half-section, 360 = full removal">
                      az
                      <input class="ge-arg-input" type="number" min="0" max="360" step="5"
                        value={Number.isFinite(azVal) ? azVal : 180}
                        oninput={(e) => setGraph(setCutawayAz(graph, n.id, asLiteral(Number((e.target as HTMLInputElement).value))))}/>
                    </label>
                    <label class="ge-cut-fld" title="Axial (Z) position of the cut (Z-down: + moves down-hole)">
                      off
                      <input class="ge-arg-input" type="number" step="1"
                        value={Number.isFinite(offVal) ? offVal : 0}
                        oninput={(e) => setGraph(setCutawayOffset(graph, n.id, asLiteral(Number((e.target as HTMLInputElement).value))))}/>
                    </label>
                  </div>
                </foreignObject>
                <!-- OUTPUT — RIGHT edge, vertically centred -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle role="button" tabindex="-1" class="ge-sock out" cx={size.w} cy={size.h / 2} r="6"
                  data-tip="the sectioned solid — wire into Output, a CSG op, or another modifier"
                  onpointerdown={(ev) => wire.startWire(ev, n.id)}/>
              {:else if n.type === 'parts_map'}
                {@const pm = n as any}
                {@const pmArgs = Object.keys(pm.argMap ?? {})}
                {@const pmList = pm.list?.kind === 'param' ? pm.list.param : ''}
                <!-- parts_map (#38 Phase 3) — instantiate `src` once per row of a
                     list<record> param. rows ← a p.<param>; each arg ← a row field
                     (s.<field>); op combines the N (list = spread by a Stack). -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <rect role="button" tabindex="-1" class="ge-node-bg parts-map"
                  width={size.w} height={size.h} rx="6"
                  data-tip="parts_map: instantiate a template part once per row of a list<record> param. Set the part id (src), point rows at p.<listParam>, and map each arg to a row field (s.od)."
                  onpointerdown={(ev) => onNodePointerDown(ev, n.id)}
                  onpointermove={onNodePointerMove}
                  onpointerup={onNodePointerUp}/>
                <text x="12" y="20" class="ge-node-title">⧉ parts_map</text>
                <line x1="0" y1="28" x2={size.w} y2="28" class="ge-node-divider"/>
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <text role="button" tabindex="-1" x={size.w - 18} y="20" class="ge-node-x"
                  class:armed={del.isArmed(n.id)}
                  data-tip={del.isArmed(n.id) ? 'Click again to delete' : 'Delete node'}
                  onpointerdown={(ev) => { ev.stopPropagation(); if (del.request(n.id)) onDeleteNode(n.id); }}>{del.isArmed(n.id) ? '✓' : '×'}</text>
                <foreignObject x="8" y="32" width={size.w - 16} height={size.h - 40}>
                  <div class="ge-pm" xmlns="http://www.w3.org/1999/xhtml">
                    <label class="ge-pm-row"><span>src</span>
                      <input class="ge-arg-input" value={pm.src ?? ''} placeholder="part id (e.g. g_cube)"
                        onchange={(e) => setGraph(setPartsMapSrc(graph, n.id, (e.target as HTMLInputElement).value.trim()))}/>
                    </label>
                    <label class="ge-pm-row"><span>rows</span>
                      <input class="ge-arg-input" value={pmList ? 'p.' + pmList : ''} placeholder="p.<listParam>"
                        onchange={(e) => { const v = (e.target as HTMLInputElement).value.trim().replace(/^p\./, ''); setGraph(setPartsMapList(graph, n.id, v || null)); }}/>
                    </label>
                    {#each pmArgs as k (k)}
                      <div class="ge-pm-arg">
                        <span class="ge-pm-key" title={k}>{k}</span>
                        <input class="ge-arg-input" value={pm.argMap[k]?.expr ?? ''} title="row expression, e.g. s.od"
                          onchange={(e) => setGraph(setPartsMapArg(graph, n.id, k, (e.target as HTMLInputElement).value))}/>
                        <button class="ge-pm-x" type="button" title="remove arg"
                          onclick={() => setGraph(removePartsMapArg(graph, n.id, k))}>×</button>
                      </div>
                    {/each}
                    <div class="ge-pm-foot">
                      <input class="ge-arg-input ge-pm-addk" placeholder="+ arg"
                        onkeydown={(e) => { if (e.key === 'Enter') { const t = e.target as HTMLInputElement; if (t.value.trim()) { setGraph(addPartsMapArg(graph, n.id, t.value.trim())); t.value = ''; } } }}/>
                      <div class="ge-pm-ops">
                        {#each ['list', 'stack', 'place'] as op (op)}
                          <button class="ge-pm-op" class:on={(pm.op ?? 'list') === op} type="button"
                            onclick={() => setGraph(setPartsMapOp(graph, n.id, op as 'list' | 'stack' | 'place'))}>{op}</button>
                        {/each}
                      </div>
                    </div>
                  </div>
                </foreignObject>
                <!-- OUTPUT — RIGHT edge; the list<geometry> of N instances -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle role="button" tabindex="-1" class="ge-sock out" cx={size.w} cy={size.h / 2} r="6"
                  data-tip="the N part instances (list<geometry>) — wire into a Stack / Output"
                  onpointerdown={(ev) => wire.startWire(ev, n.id)}/>
              {:else if n.type === 'parts_table'}
                {@const pt = n as any}
                <!-- parts_table (#38b) — ONE node, N inline ROWS of the SAME template
                     part. The TITLE ROW carries the single title (R1), the template
                     SEARCH-picker chip (R2/R3) and the aggregate "Multi part" output
                     (R4); the scrollable row table is the decoupled PartsTableCard
                     below the divider (R5). The top strip is the SVG drag handle. -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <rect role="button" tabindex="-1" class="ge-node-bg parts-table"
                  width={size.w} height={size.h} rx="6"
                  data-tip="parts_table: N rows of ONE template part. Pick the template, add columns (its params), then add/edit rows — each row bakes as its own instance."
                  onpointerdown={(ev) => onNodePointerDown(ev, n.id)}
                  onpointermove={onNodePointerMove}
                  onpointerup={onNodePointerUp}/>
                <!-- Just the ▤ marker — "parts_table" is evident + lives in the card
                     tooltip (data-tip on the bg rect), so the title text is dropped
                     and the selector chip takes the title row (user 2026-07-13). -->
                <text x="14" y="20" class="ge-node-title">▤</text>
                <!-- External DATA-INPUT socket (#38c) — top-left of the card. Drop an
                     upstream list-producer's output here to SOURCE the rows FROM that
                     runtime list (each element → one row) instead of the inline rows;
                     the columns still map each element's fields to the template's
                     params. `wired` = a list is bound (the inline rows are ignored). -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle role="button" tabindex="-1" class="ge-sock in pt-data-in" class:wired={!!pt.dataInput}
                  cx="0" cy="16" r="6"
                  data-tip={pt.dataInput ? 'rows: WIRED to an upstream list — each element becomes a row (delete the wire to go back to inline rows)' : 'rows: wire an upstream list-producer here (a list · another table · a parts_map · a repeat) to feed the table its rows'}
                  onpointerup={(ev) => wire.endWireOnPartsTableData(ev, n.id)}/>
                <!-- Template-part selector chip → opens the search picker (R2/R3).
                     Starts right after the ▤ marker + leaves a gap before the
                     right-side multi/×/socket cluster. -->
                <foreignObject x="26" y="5" width={Math.max(80, size.w - 116)} height="19">
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <div class="ge-pt-srcsel" class:empty={!pt.src} xmlns="http://www.w3.org/1999/xhtml"
                    title="Choose the template part to repeat"
                    onpointerdown={(ev) => { ev.stopPropagation(); onOpenPartsSrcPicker?.(ev as any, n.id); }}>
                    <span class="ge-pt-srcsel-id">{pt.src || 'select part'}</span>
                    <span class="ge-pt-srcsel-ic">🔍</span>
                  </div>
                </foreignObject>
                <line x1="0" y1="28" x2={size.w} y2="28" class="ge-node-divider"/>
                <!-- The title-row aggregate output socket (R4) sits at the right edge;
                     its role is spelled out in the socket's own tooltip, so no label
                     text clutters the title row (user 2026-07-13 — "remove MULTI"). -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <!-- Close button — an X icon in a circle, vertically centred on the
                     title row (aligned with the aggregate socket at cy=16); the
                     armed state swaps to a green ✓ circle (user 2026-07-13). -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <g class="ge-pt-close" class:armed={del.isArmed(n.id)}
                  role="button" tabindex="-1" transform="translate({size.w - 22}, 15)"
                  data-tip={del.isArmed(n.id) ? 'Click again to delete' : 'Delete node'}
                  onpointerdown={(ev) => { ev.stopPropagation(); if (del.request(n.id)) onDeleteNode(n.id); }}>
                  <circle class="ge-pt-close-bg" cx="0" cy="0" r="8"/>
                  {#if del.isArmed(n.id)}
                    <path class="ge-pt-close-mark" d="M -3.5 0 L -1 3 L 4 -3.5"/>
                  {:else}
                    <path class="ge-pt-close-mark" d="M -3.2 -3.2 L 3.2 3.2 M 3.2 -3.2 L -3.2 3.2"/>
                  {/if}
                </g>
                <foreignObject x="2" y="30" width={size.w - 4} height={size.h - 33}>
                  <div class="ge-pt-host" xmlns="http://www.w3.org/1999/xhtml">
                    <PartsTableCard
                      node={pt}
                      paramNames={expected.params[pt.src] ?? []}
                      onColumns={(cols) => setGraph(setPartsTableColumns(graph, n.id, cols))}
                      onAddRow={() => setGraph(addPartsTableRow(graph, n.id))}
                      onDuplicateRow={(i) => setGraph(duplicatePartsTableRow(graph, n.id, i))}
                      onRemoveRow={(i) => setGraph(removePartsTableRow(graph, n.id, i))}
                      onCell={(i, col, val) => setGraph(setPartsTableCell(graph, n.id, i, col, val))}
                      onRowMaterial={(i, mat) => setGraph(setPartsTableRowMaterial(graph, n.id, i, mat))}
                      onRowSocketDown={(_i, ev) => wire.startWire(ev, n.id)}
                    />
                  </div>
                </foreignObject>
                <!-- OUTPUT — the aggregate "Multi part" list<geometry> on the TITLE ROW
                     right edge (R4). Per-row ◇ sockets stay wireable; when this is
                     wired, downstream gets the whole table and supersedes them. -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle role="button" tabindex="-1" class="ge-sock out" cx={size.w} cy="16" r="6"
                  data-tip="Multi part — the whole table as one list<geometry>. Wire into a Stack / Output (supersedes the individual row sockets), or leave unconsumed to render every row at the root."
                  onpointerdown={(ev) => wire.startWire(ev, n.id)}/>
              {/if}
              <!-- ─── Bottom-right corner resize grip ─────────────────────
                   Diagonal handle in the card's bottom-right corner —
                   drag to widen/shrink. Moved off the right edge so it
                   doesn't fight the output sockets that live there (Call
                   output, Polygon output, Container output all sit at
                   x=size.w, vertically centred). Two short stacked
                   strokes give the classic "↘" resize-handle look at
                   ~10 × 10 px. The Output card (root) skips the grip. -->
              {#if n.id !== rootId && n.type !== 'method' && n.type !== 'mv' && n.type !== 'rot'}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <g class="ge-resize-corner"
                  data-tip="Drag to resize"
                  onpointerdown={(ev) => onResizePointerDown(ev, n.id)}
                  onpointermove={onResizePointerMove}
                  onpointerup={onResizePointerUp}>
                  <!-- Larger transparent hit target so the 10 × 10 visual
                       isn't pixel-fragile to click. -->
                  <rect class="ge-resize-corner-hit"
                    x={size.w - 14} y={size.h - 14} width="14" height="14"/>
                  <!-- Visual diagonal strokes (two parallel short lines). -->
                  <line class="ge-resize-corner-line"
                    x1={size.w - 8} y1={size.h - 2}
                    x2={size.w - 2} y2={size.h - 8}/>
                  <line class="ge-resize-corner-line"
                    x1={size.w - 5} y1={size.h - 2}
                    x2={size.w - 2} y2={size.h - 5}/>
                </g>
              {/if}
            </g>

<style>
  .ge-node-ghost { font: 12px Arial; cursor: pointer; user-select: none; opacity: 0.5; }
  .ge-node-ghost:hover { opacity: 1; }
  .ge-node-ghost.on { opacity: 1; fill: #6d28d9; }
  .ge-node-bg { fill: #fff; stroke: #0369a1; stroke-width: 2; cursor: grab; touch-action: none; }
  /* AI "this/here" selection — the last-touched card, the ge-assist ctx target. */
  .ge-node.ai-selected .ge-node-bg { stroke: #7c3aed !important; stroke-width: 3 !important; filter: drop-shadow(0 0 3px rgba(124, 58, 237, 0.55)); }
  .ge-node-bg.method { fill: #fef3c7; stroke: #d97706; stroke-width: 2; }
  /* Compact CSG operator circle (subtract/add/intersect) — amber like the old method card. */
  .ge-csg-circle { fill: #fef3c7; stroke: #d97706; stroke-width: 2; cursor: grab; touch-action: none; }
  .ge-csg-circle:hover { fill: #fde68a; }
  .ge-csg-glyph { fill: #92400e; font: 700 22px Arial; cursor: pointer; user-select: none; }
  .ge-csg-glyph:hover { fill: #b45309; }
  /* A/B input titles — bigger, sit OUTSIDE the circle (above A, below B). */
  .ge-csg-ab { fill: #b45309; font: 800 13px Arial; pointer-events: none; user-select: none; }
  /* Trash delete tucked at the circle's top-right edge. */
  .ge-csg-trash { font-size: 12px; cursor: pointer; user-select: none; opacity: 0.75; }
  .ge-csg-trash:hover { opacity: 1; }
  .ge-node-bg.transform { fill: #ede9fe; stroke: #6d28d9; stroke-width: 2; }
  .ge-node-bg.transform.rot { fill: #fce7f3; stroke: #be185d; }
  /* Compact mv/rot icon glyph (mirrors ge-csg-glyph but in transform-purple). */
  .ge-xform-glyph { fill: #6d28d9; font: 700 20px Arial; cursor: pointer; user-select: none; }
  .ge-xform-glyph:hover { fill: #4c1d95; }
  /* Warp / bend modifier card (#36) — teal, distinct from transform-purple. */
  .ge-node-bg.warp { fill: #ecfeff; stroke: #0e7490; stroke-width: 2; }
  /* Compact ≈ icon centred in the chip (mirrors ge-xform-glyph, in warp-teal). */
  .ge-warp-icon { fill: #0e7490; font: 700 20px Arial; user-select: none; }
  .ge-warp-lbl { fill: #0e7490; font: 600 11px Arial; pointer-events: none; user-select: none; }
  .ge-warp-lbl.wired { fill: #0369a1; font-weight: 700; }
  /* #31 compact multi-input socket — an elongated (barred) shape marks a socket
     that accepts MANY incoming wires, vs the round single-input socket. */
  .ge-sock.multi { stroke-width: 2; }
  .ge-sock.multi.wired { fill: #0369a1; }
  /* #31 collapsed Output count badge (×N) next to the single arrow socket. */
  .ge-output-count { fill: #047857; font: 600 10px Arial; pointer-events: none; user-select: none; }
  /* Compact chip ⚙ options + × delete — top-right, sized to fit the 40 px row. */
  .ge-warp-cog { font-size: 15px; }
  .ge-warp-x { font-size: 13px; }
  .ge-warp-opts { display: flex; align-items: center; gap: 4px; font: 10px Arial; }
  .ge-warp-refine { display: flex; align-items: center; gap: 2px; color: #0e7490; font-weight: 600; }
  .ge-warp-refine .ge-arg-input { width: 34px; }
  .ge-warp-tog {
    border: 1px solid #67e8f9; background: #fff; color: #0e7490; border-radius: 4px;
    padding: 1px 5px; font: 600 10px Arial; cursor: pointer;
  }
  .ge-warp-tog.on { background: #0e7490; color: #fff; border-color: #0e7490; }
  .ge-node-bg.cutaway { fill: #fef2f2; stroke: #b91c1c; stroke-width: 2; }
  .ge-cut-lbl { fill: #b91c1c; font: 600 11px Arial; pointer-events: none; user-select: none; }
  .ge-cut-lbl.wired { fill: #991b1b; font-weight: 700; }
  .ge-cut-opts { display: flex; align-items: center; gap: 6px; font: 10px Arial; }
  .ge-cut-fld { display: flex; align-items: center; gap: 2px; color: #b91c1c; font-weight: 600; }
  .ge-cut-fld .ge-arg-input { width: 40px; }
  /* parts_map card (#38 Phase 3) — violet, matching the data-driven / list family. */
  .ge-node-bg.parts-map { fill: #f5f3ff; stroke: #6d28d9; stroke-width: 2; }
  /* parts_table card (#38b) — same violet family; the body is the decoupled
     PartsTableCard, hosted in a foreignObject that fills the node below the title. */
  .ge-node-bg.parts-table { fill: #fdfcff; stroke: #7c3aed; stroke-width: 2; }
  /* External DATA-INPUT socket (#38c) — violet like the card; filled when a list is
     wired in (rows sourced from the upstream, inline rows ignored). */
  .ge-sock.in.pt-data-in { fill: #fff; stroke: #7c3aed; stroke-width: 2; }
  .ge-sock.in.pt-data-in.wired { fill: #7c3aed; stroke: #5b21b6; }
  /* Host is hard-clipped; the card owns its own row-list scroll (R5). */
  .ge-pt-host { width: 100%; height: 100%; overflow: hidden; }
  /* Template-part selector chip on the title row (R2/R3). */
  .ge-pt-srcsel {
    display: flex; align-items: center; justify-content: space-between; gap: 4px;
    height: 100%; box-sizing: border-box; padding: 0 5px; cursor: pointer;
    background: #fff; border: 1px solid #c9b6ef; border-radius: 4px;
    font: 600 10px ui-monospace, monospace; color: #4a2f7a; overflow: hidden;
  }
  .ge-pt-srcsel:hover { border-color: #7c3aed; background: #faf7ff; }
  .ge-pt-srcsel.empty { color: #9a86c0; font-style: italic; }
  .ge-pt-srcsel-id { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ge-pt-srcsel-ic { flex: none; font-size: 9px; opacity: 0.7; }
  .ge-pm { display: flex; flex-direction: column; gap: 3px; font: 10px Arial; overflow: auto; height: 100%; }
  .ge-pm-row { display: flex; align-items: center; gap: 4px; }
  .ge-pm-row > span { width: 30px; color: #6d28d9; font-weight: 600; flex: none; }
  .ge-pm-arg { display: flex; align-items: center; gap: 3px; }
  .ge-pm-key { width: 44px; flex: none; color: #5b21b6; font: 10px ui-monospace, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ge-pm-x { flex: none; border: none; background: none; color: #a1a1aa; cursor: pointer; font-size: 12px; line-height: 1; padding: 0 2px; }
  .ge-pm-x:hover { color: #dc2626; }
  .ge-pm-foot { display: flex; align-items: center; gap: 4px; margin-top: 2px; }
  .ge-pm-addk { width: 52px; flex: none; }
  .ge-pm-ops { display: flex; gap: 2px; margin-left: auto; }
  .ge-pm-op { border: 1px solid #d6d3d1; border-radius: 3px; background: #fff; color: #57534e; font: 9px Arial; padding: 1px 4px; cursor: pointer; }
  .ge-pm-op.on { background: #6d28d9; color: #fff; border-color: #6d28d9; }
  .ge-node-bg.container { fill: #ecfdf5; stroke: #047857; stroke-width: 2; }
  /* Polygon card — warm peach background (matches the `.prvl` tag in the
     sidebar + the +Add Vertex CTA). Stroke amber to differentiate from
     Call (blue) and Method (yellow). */
  .ge-node-bg.polygon { fill: #fff7ed; stroke: #c2410c; stroke-width: 2; }
  .ge-node-bg.container.root { fill: #f0fdf4; stroke: #15803d; stroke-width: 2.5; }
  .ge-node-bg.container.stack { fill: #ecfeff; stroke: #0e7490; }
  /* ▶ Output node (#13) — compact input box + big result arrow. */
  .ge-output-box { fill: #f0fdf4; stroke: #15803d; stroke-width: 2; cursor: grab; touch-action: none; }
  .ge-output-arrow { fill: #15803d; stroke: #166534; stroke-width: 1; cursor: grab; touch-action: none; }
  .ge-output-arrow:hover { fill: #16a34a; }
  .ge-output-arrow-label { font: 700 10px Arial; fill: #fff; text-anchor: middle; pointer-events: none; user-select: none; }
  .ge-output-tag { font: 700 11px Arial; fill: #15803d; pointer-events: none; user-select: none; }
  /* Repeat × N — distinct color so it reads as "iteration", not "container". */
  .ge-node-bg.repeat { fill: #fdf2f8; stroke: #be185d; stroke-width: 2; }
  /* PolyRepeat card (#157) — violet skin matches the parametric-vertex
     palette + the repeat-ref row inside polygons. */
  .ge-node-bg.poly-repeat { fill: #f5f3ff; stroke: #6d28d9; stroke-width: 2; }
  /* Expr block (B.7 v2) — teal skin so it reads as a CALCULATION node,
     distinct from the violet profile-loop palette. */
  .ge-node-bg.expr { fill: #ecfeff; stroke: #0e7490; stroke-width: 2; }
  /* Spline PATH producer (TODO #15) — violet family, matches list<point3>. */
  .ge-node-bg.spline { fill: #f5f3ff; stroke: #7c3aed; stroke-width: 2; }
  /* Material card (G-MAT-CARD) — emerald producer, matches the material-out socket. */
  .ge-node-bg.material { fill: #ecfdf5; stroke: #10b981; stroke-width: 1.5; cursor: pointer; }
  .ge-mat-glyph { font-size: 17px; fill: #065f46; cursor: pointer; user-select: none; }
  .ge-mat-label { font: 700 11px ui-monospace, monospace; fill: #065f46; user-select: none; }
  .ge-mat-badge { stroke: #555; stroke-width: 0.75; cursor: pointer; }
  .ge-mat-del { font-size: 13px; }
  .ge-sock.out.material-out { fill: #10b981; stroke: #059669; stroke-width: 2; }
  /* Material swatch chip on the Call card (#66/#982) — the per-part colour/finish/
     opacity trigger. Filled with the part's effective outside colour. */
  .ge-mat-swatch { stroke: #94a3b8; stroke-width: 1; cursor: pointer; }
  .ge-mat-swatch:hover { stroke: #0369a1; stroke-width: 2; }
  .ge-mat-swatch.bound { stroke: #059669; stroke-width: 2; }
  .ge-sock.in.material-in { fill: #fff; stroke: #10b981; stroke-width: 1.5; }
  .ge-sock.in.material-in.wired { fill: #10b981; stroke: #059669; stroke-width: 2; }
  .ge-mat-bound { font-size: 9px; fill: #fff; }
  /* Wired-points state (#26) — a deeper fill so it reads as "expression-driven". */
  .ge-node-bg.spline.wired { fill: #ede9fe; stroke: #6d28d9; }
  .ge-sp-wired-badge { font: 700 9px ui-monospace, monospace; fill: #6d28d9; pointer-events: none; }
  .ge-spline-preview { stroke: #7c3aed; stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; fill: none; pointer-events: none; }
  .ge-expr-card { display: flex; gap: 6px; font: 11px Arial; height: 100%; }
  .ge-expr-inputs { display: flex; flex-direction: column; gap: 0; flex: 0 0 auto; min-width: 40px; }
  .ge-expr-in-label { height: 26px; line-height: 26px; font: 600 11px ui-monospace, monospace; color: #0e7490; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ge-expr-in-label.muted { color: #94a3b8; font-style: italic; font-weight: 400; }
  .ge-expr-outputs { display: flex; flex-direction: column; gap: 0; flex: 1 1 auto; min-width: 0; }
  .ge-expr-out-row { display: flex; align-items: center; gap: 3px; height: 26px; }
  .ge-expr-name { flex: 1 1 auto; min-width: 0; text-align: right; color: #0e7490; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ge-expr-ro .ge-expr-name { font: 700 11px ui-monospace, monospace; }
  .ge-expr-add-row { display: flex; margin-top: 4px; }
  .ge-sock.expr-in { fill: #67e8f9; stroke: #0e7490; }
  .ge-sock.expr-out { fill: #06b6d4; stroke: #0e7490; }
  /* Repeat count input — inline in the title row, big + editable. */
  .ge-repeat-count-inline { width: 100%; box-sizing: border-box; padding: 2px 6px; font: 700 14px ui-monospace, monospace; color: #be185d; background: #fff; border: 1px solid #fbcfe8; border-radius: 4px; text-align: center; cursor: ew-resize; }
  .ge-repeat-count-inline:focus { outline: 1px solid #be185d; cursor: text; }
  .ge-repeat-bound { font: 10px ui-monospace, monospace; fill: #be185d; pointer-events: none; }
  /* Count chip when wired to a param or expression — replaces the input */
  .ge-repeat-count-chip { font: 700 12px ui-monospace, monospace; fill: #831843; cursor: pointer; user-select: none; }
  .ge-repeat-count-chip.param { fill: #be185d; }
  .ge-repeat-count-chip.expr { fill: #b45309; font-style: italic; }
  .ge-repeat-count-x { font: 12px Arial; fill: #b91c1c; cursor: pointer; user-select: none; }
  .ge-repeat-count-x:hover { fill: #7f1d1d; }
  /* Body labels — "builds a list of N ×" + child name */
  .ge-repeat-child { font: 600 12px ui-monospace, monospace; fill: #831843; }
  /* PARTS list rows on the Repeat card (multi-child) */
  .ge-repeat-part-label { font: 600 11px ui-monospace, monospace; fill: #831843; pointer-events: none; }
  .ge-repeat-part-mv { font: 9px Arial; fill: #9d174d; cursor: pointer; user-select: none; }
  .ge-repeat-part-mv.disabled { opacity: 0.3; pointer-events: none; }
  .ge-repeat-part-x { font: 600 12px Arial; fill: #b91c1c; cursor: pointer; user-select: none; }
  .ge-sock.in.child.add { fill: #fff; stroke: #db2777; stroke-dasharray: 2 2; }
  .ge-sock-label.add { fill: #be185d; font-style: italic; }
  .ge-repeat-op-hint { font: 9px ui-monospace, monospace; fill: #9d174d; opacity: 0.6; }
  .ge-container-slot-x { font: 12px Arial; fill: #b91c1c; cursor: pointer; user-select: none; }
  .ge-container-slot-x:hover { fill: #7f1d1d; }
  .ge-container-slot-move { font: 13px Arial; fill: #0e7490; cursor: pointer; user-select: none; }
  .ge-container-slot-move:hover { fill: #155e75; }
  /* Touch: bigger reorder + remove glyphs so they're finger-tappable. */
  @media (pointer: coarse) {
    .ge-container-slot-move { font-size: 17px; }
    .ge-container-slot-x { font-size: 16px; }
  }
  .ge-container-cog { font: 13px Arial; fill: #047857; cursor: pointer; user-select: none; }
  .ge-container-cog:hover { fill: #065f46; }
  .ge-stack-inline-input { width: 100%; height: 18px; box-sizing: border-box; padding: 1px 3px; font: 10px ui-monospace, monospace; text-align: right; border: 1px solid #cbd5e1; border-radius: 3px; color: #0f172a; background: #fff; }
  .ge-stack-inline-input::placeholder { color: #b8c0cc; font-style: italic; }
  .ge-stack-inline-input:focus { outline: none; border-color: #0ea5e9; }
  .ge-sock-label.trail { fill: #9ca3af; font-style: italic; }
  /* Call-card title hyperlink: the SRC half of "<alias> · <src>" is
     clickable — opens that primitive in a new editor tab via onOpenTab.
     Re-enable pointer-events on the tspan only (the parent <text> stays
     pointer-events:none so it doesn't fight the card drag). */
  .ge-node-title .ge-node-title-link {
    pointer-events: visiblePainted; cursor: pointer;
    text-decoration: underline; text-decoration-color: transparent;
    transition: text-decoration-color 100ms, fill 100ms;
  }
  .ge-node-title .ge-node-title-link:hover {
    fill: #075985; text-decoration-color: #0369a1;
  }
  .ge-node-divider { stroke: #e5e7eb; }
  .ge-node-x { font: 14px Arial; fill: #b91c1c; cursor: pointer; user-select: none; }
  /* parts_table close button — an X icon in a circle (user 2026-07-13). */
  .ge-pt-close { cursor: pointer; }
  .ge-pt-close-bg { fill: #fff; stroke: #e0bcbc; stroke-width: 1; transition: fill 0.1s, stroke 0.1s; }
  .ge-pt-close:hover .ge-pt-close-bg { fill: #fde8e8; stroke: #b91c1c; }
  .ge-pt-close-mark { stroke: #b91c1c; stroke-width: 1.7; fill: none; stroke-linecap: round; stroke-linejoin: round; }
  .ge-pt-close.armed .ge-pt-close-bg { fill: #16a34a; stroke: #16a34a; }
  .ge-pt-close.armed .ge-pt-close-mark { stroke: #fff; stroke-width: 2; }
  /* Spline card ✎/× — larger glyph = bigger click target on the compact card. */
  .ge-node-x.ge-sp-glyph { font-size: 17px; }
  /* Spline 📈 plot-in-main-bake toggle (TODO #24) — dim when off, full when on. */
  .ge-sp-plot { font: 12px Arial; cursor: pointer; user-select: none; opacity: 0.4; filter: grayscale(1); }
  .ge-sp-plot:hover { opacity: 0.85; filter: none; }
  .ge-sp-plot.on { opacity: 1; filter: none; }
  .ge-node-x.disabled { fill: #cbd5e1; cursor: not-allowed; }
  /* Armed (awaiting confirm): ✓ glyph, brighter + bold so the two-step reads. */
  .ge-node-x.armed { fill: #16a34a; font-weight: 700; }
  /* Polygon 👁 preview-toggle (sits just left of the × delete). */
  .ge-poly-eye { font: 12px Arial; fill: #475569; cursor: pointer; user-select: none; opacity: 0.7; }
  .ge-poly-eye:hover { fill: #0c4a6e; opacity: 1; }
  .ge-poly-eye.on { fill: #6d28d9; opacity: 1; }
  .ge-method-name { font: 11px Arial; fill: #92400e; text-transform: uppercase; letter-spacing: 0.5px; pointer-events: none; }
  .ge-fo { overflow: visible; }
  .ge-polygon { font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; color: #1f2937; display: flex; flex-direction: column; height: 100%; min-height: 0; }
  /* Scrollable vertex list — caps at the foreignObject's available
     height; scrolls when the vertex count exceeds the visible cap. */
  .ge-poly-vtx-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
  /* Each vertex is a 2-row × 7-column grid wrapped in a rounded outline
     so it reads as one block. Tight 2-px gap between vertices keeps the
     list compact while making the block boundaries scannable.
       row 1: gutter | label | input | ƒ | ▲ | ▼ | +     ← insert above
       row 2: gutter | label | input | ƒ | .  | .  | ×    ← delete this
     The col-7 action is symmetric: top adds a vertex above this row,
     bottom removes this row. Sub-row height = 16 px so the inner
     content is 32 px; plus 2 px padding top/bottom = 36 px total per
     vertex card. */
  .ge-poly-vertex {
    display: grid;
    /* Col 1 = socket gutter + unwire 🗑 (18px to fit the 16px button +
       padding); col 2 = axis label; col 3 = value/expr/chip; col 4 = ƒ;
       cols 5/6 = ▲▼ (reorder); col 7 = + (insert above) / × (delete). */
    grid-template-columns: 18px 12px 1fr 14px 16px 16px 14px;
    grid-template-rows: 18px 18px;
    gap: 1px 2px; align-items: center;
    padding: 2px 2px;
    margin-bottom: 2px;
    border: 1px solid #fed7aa;
    border-radius: 5px;
    background: rgba(255, 247, 237, 0.5);
  }
  .ge-poly-vertex:last-child { margin-bottom: 0; }
  .ge-poly-vertex:hover { background: #fff7ed; border-color: #fdba74; }
  /* The vertex being edited / hovered — blue outline mirrors the wider
     blue dot in the profile SVG so the row↔point correspondence is clear. */
  .ge-poly-vertex.vtx-active {
    background: #eff6ff;
    border-color: #2563eb;
    box-shadow: 0 0 0 1px #2563eb;
  }
  /* Function (parametric) vertex rows — blue left accent so an expr-driven
     vertex reads as blue, matching the editor's blue ƒ language. */
  .ge-poly-vertex.vtx-fn { border-left: 3px solid #2563eb; }
  .ge-poly-vertex.vtx-fn .ge-poly-fx.on { background: #dbeafe; color: #1e40af; border-color: #60a5fa; }
  /* Profile-SVG hover tooltip — black bg, white text, follows the cursor. */
  .ge-svg-tip {
    position: fixed; z-index: 1200; pointer-events: none;
    background: #111827; color: #fff;
    font: 11px ui-monospace, SFMono-Regular, Menlo, monospace;
    padding: 3px 7px; border-radius: 4px; white-space: nowrap;
    box-shadow: 0 2px 6px rgba(0,0,0,0.35);
  }
  /* ─── Sketch / Repeat card chrome ─────────────────────────────────────────
     The sketch NODE CARD + full-tab EDITOR moved to SketchNodeCard.svelte +
     SketchEditorPane.svelte (modularize K.65 Phase E Step 2); their CSS travels
     with them. Only the Repeat card ✎ trigger + the overlay Done tick (reused
     by the Repeat editor below) stay here. */
  .ge-sketch-edit-btn { font: 13px system-ui; fill: #7c3aed; cursor: pointer; }
  .ge-sketch-edit-btn:hover { fill: #5b21b6; }
  /* ✎ on the Repeat card tints when the repeat carries a pattern. */
  .ge-sketch-edit-btn.patterned { fill: #be185d; }
  /* Standalone Done tick — pinned top-right of the overlay editors. */
  .ge-sketch-done-tick {
    position: absolute; top: 10px; right: 14px; z-index: 10;
    width: 34px; height: 34px; padding: 0; display: flex; align-items: center; justify-content: center;
    background: #ecfdf5; color: #15803d; border: 1px solid #6ee7b7; border-radius: 9999px;
    font: 700 17px Arial; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.14);
  }
  .ge-sketch-done-tick:hover { background: #d1fae5; border-color: #34d399; }
  /* ─── Repeat pattern editor overlay (#7) ─────────────────────────────── */
  .ge-repeat-editor {
    position: absolute; inset: 0; z-index: 60; background: #fdf2f8;
    display: flex; flex-direction: column; gap: 0; overflow: auto;
    font: 12px ui-monospace, monospace; color: #1f2937;
  }
  .ge-rep-head { display: flex; align-items: center; justify-content: space-between; padding: 6px 12px; border-bottom: 1px solid #fbcfe8; background: #fff; }
  .ge-rep-title { font: 700 12px Arial; color: #9d174d; }
  .ge-rep-iter { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 10px; padding: 6px 12px; border-bottom: 1px solid #fce7f3; }
  .ge-rep-field { display: flex; flex-direction: column; gap: 1px; font: 600 9px Arial; color: #9d174d; text-transform: uppercase; letter-spacing: 0.4px; }
  .ge-rep-in { font: 12px ui-monospace, monospace; padding: 3px 6px; border: 1px solid #f9a8d4; border-radius: 4px; width: 120px; box-sizing: border-box; }
  .ge-rep-in.narrow { width: 70px; }
  .ge-rep-in.axis { width: 86px; }
  .ge-rep-in:focus { outline: 1px solid #db2777; background: #fff; }
  .ge-rep-sel { font: 12px ui-monospace, monospace; padding: 3px 6px; border: 1px solid #f9a8d4; border-radius: 4px; }
  .ge-rep-hint { font: 11px Arial; color: #9ca3af; align-self: center; }
  .ge-rep-hint code, .ge-rep-note code { background: #fce7f3; color: #9d174d; padding: 0 4px; border-radius: 3px; }
  .ge-rep-binds { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid #fce7f3; }
  .ge-rep-binds-lbl { font: 600 11px ui-monospace, monospace; color: #be185d; }
  .ge-rep-bind { display: inline-flex; align-items: center; gap: 4px; }
  .ge-rep-eq { color: #9ca3af; }
  .ge-rep-add { font: 600 11px Arial; padding: 3px 9px; background: #fdf2f8; color: #9d174d; border: 1px dashed #f9a8d4; border-radius: 5px; cursor: pointer; }
  .ge-rep-add:hover { background: #fce7f3; border-style: solid; }
  .ge-rep-x { width: 20px; height: 20px; padding: 0; background: #fff; border: 1px solid #fca5a5; border-radius: 4px; color: #b91c1c; cursor: pointer; font: 11px Arial; }
  .ge-rep-x:hover { background: #fee2e2; }
  .ge-rep-tabs { display: flex; gap: 0; padding: 0 12px; border-bottom: 1px solid #fbcfe8; background: #fff; }
  .ge-rep-tab { font: 600 12px Arial; padding: 8px 14px; background: transparent; border: 0; border-bottom: 2px solid transparent; color: #9ca3af; cursor: pointer; }
  .ge-rep-tab.on { color: #9d174d; border-bottom-color: #db2777; }
  .ge-rep-tab:hover { color: #be185d; }
  .ge-rep-tabbody { padding: 12px; display: flex; flex-direction: column; gap: 8px; }
  .ge-rep-body-card { background: #fff; border: 1px solid #fbcfe8; border-radius: 6px; padding: 12px; display: flex; flex-direction: column; gap: 6px; max-width: 520px; }
  .ge-rep-body-lbl { font: 600 11px Arial; color: #9d174d; }
  .ge-rep-child { font: 13px ui-monospace, monospace; color: #1f2937; background: #fce7f3; border-radius: 4px; padding: 4px 8px; align-self: flex-start; }
  .ge-rep-note { font: 11px Arial; color: #6b7280; line-height: 1.5; max-width: 560px; }
  .ge-rep-presets { display: flex; align-items: center; gap: 8px; }
  .ge-rep-presets-lbl { font: 600 10px Arial; color: #9d174d; text-transform: uppercase; letter-spacing: 0.4px; }
  .ge-rep-preset { font: 600 11px Arial; padding: 4px 10px; background: #fce7f3; color: #9d174d; border: 1px solid #f9a8d4; border-radius: 9999px; cursor: pointer; }
  .ge-rep-preset:hover { background: #fbcfe8; }
  .ge-rep-mod { display: flex; align-items: center; gap: 6px; }
  .ge-rep-kind { font: 600 11px ui-monospace, monospace; padding: 4px 8px; background: #ede9fe; color: #5b21b6; border: 1px solid #c4b5fd; border-radius: 5px; cursor: pointer; width: 64px; }
  .ge-rep-kind.rot { background: #fce7f3; color: #be185d; border-color: #f9a8d4; }
  .ge-rep-mv { width: 22px; height: 24px; padding: 0; background: #fff; border: 1px solid #d6d3d1; border-radius: 4px; font: 9px Arial; color: #57534e; cursor: pointer; }
  .ge-rep-mv:hover:not(:disabled) { background: #f3e8ff; }
  .ge-rep-mv:disabled { opacity: 0.35; cursor: default; }
  .ge-rep-mod-add { display: flex; gap: 6px; }
  /* PARTS section + wired⇄code body (Loop-body tab) */
  .ge-rep-section-lbl { font: 700 10px Arial; color: #9d174d; text-transform: uppercase; letter-spacing: 0.5px; }
  .ge-rep-section-sub { font: 400 10px Arial; color: #9ca3af; text-transform: none; letter-spacing: 0; margin-left: 6px; }
  .ge-rep-parts { display: flex; flex-direction: column; gap: 5px; padding-bottom: 8px; border-bottom: 1px solid #fce7f3; margin-bottom: 8px; }
  .ge-rep-part-row { display: flex; align-items: center; gap: 8px; }
  .ge-rep-part-idx { font: 600 10px ui-monospace, monospace; color: #f9a8d4; width: 14px; text-align: right; }
  .ge-rep-part-name { font: 12px ui-monospace, monospace; color: #1f2937; background: #fce7f3; border-radius: 4px; padding: 3px 8px; flex: 1; }
  .ge-rep-bodymode { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
  .ge-rep-seg { font: 600 11px Arial; padding: 3px 12px; background: #fff; color: #9ca3af; border: 1px solid #f9a8d4; border-radius: 9999px; cursor: pointer; }
  .ge-rep-seg.on { background: #db2777; color: #fff; border-color: #db2777; }
  .ge-rep-revert { font: 600 11px Arial; padding: 3px 10px; background: #fff; color: #b91c1c; border: 1px solid #fca5a5; border-radius: 5px; cursor: pointer; margin-left: auto; }
  .ge-rep-revert:hover { background: #fee2e2; }
  .ge-rep-code { width: 100%; box-sizing: border-box; font: 12px ui-monospace, monospace; color: #1f2937; background: #fff; border: 1px solid #f9a8d4; border-radius: 6px; padding: 8px 10px; resize: vertical; }
  .ge-rep-code:focus { outline: 1px solid #db2777; }
  .ge-rep-code.readonly { background: #fdf2f8; color: #6b7280; white-space: pre; overflow: auto; margin: 0; }
  .ge-rep-code.err { border-color: #f87171; }
  .ge-rep-bakeerr { font: 600 11px ui-monospace, monospace; color: #b91c1c; background: #fee2e2; border: 1px solid #fca5a5; border-radius: 5px; padding: 6px 10px; margin-top: 6px; }
  /* Compact section layout (tab-less redesign) + per-part modifiers */
  .ge-rep-sec { display: flex; flex-direction: column; gap: 5px; padding: 7px 12px; border-bottom: 1px solid #fce7f3; }
  .ge-rep-sec-head { display: flex; align-items: center; gap: 8px; }
  .ge-rep-sec-lbl { font: 700 10px Arial; color: #9d174d; text-transform: uppercase; letter-spacing: 0.5px; }
  .ge-rep-sec-sub { font: 400 10px Arial; color: #9ca3af; flex: 1; }
  .ge-rep-prow { display: flex; align-items: center; gap: 6px; }
  .ge-rep-in.grow { width: auto; flex: 1; min-width: 90px; }
  .ge-rep-add.sm { padding: 2px 8px; font-size: 10px; }
  .ge-rep-note.sm { font-size: 10px; margin: 0; max-width: 620px; }
  .ge-rep-part { display: flex; flex-direction: column; gap: 4px; }
  .ge-rep-pmod { display: flex; align-items: center; gap: 5px; padding-left: 24px; }
  .ge-rep-round { width: 22px; height: 22px; border-radius: 9999px; padding: 0; background: #fce7f3; color: #9d174d; border: 1px solid #f9a8d4; cursor: pointer; font: 13px/1 Arial; }
  .ge-rep-round:hover { background: #fbcfe8; border-color: #db2777; }
  .ge-poly-axis-label {
    font: 600 9px ui-monospace, monospace; color: #94a3b8;
    text-transform: uppercase; letter-spacing: 0.5px;
    text-align: center;
  }
  .ge-poly-mv {
    width: 16px; height: 18px; padding: 0;
    background: #fff; border: 1px solid #d6d3d1; border-radius: 2px;
    font: 8px Arial; color: #57534e; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
  }
  .ge-poly-mv:hover:not(:disabled) { background: #f3f4f6; color: #1f2937; border-color: #94a3b8; }
  .ge-poly-mv:disabled { opacity: 0.35; cursor: default; }
  /* Wired-coord chip — replaces the input when the coord is kind:'param'.
     Reuses the violet palette for "wired" everywhere else in the editor. */
  .ge-poly-chip {
    display: inline-flex; align-items: center; justify-content: center;
    padding: 1px 6px; font: 11px ui-monospace, monospace;
    color: #5b21b6; background: #ede9fe; border: 1px solid #c4b5fd;
    border-radius: 3px; width: 100%; box-sizing: border-box;
    cursor: pointer; user-select: none;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    transition: background 100ms;
  }
  .ge-poly-chip:hover { background: #c4b5fd; color: #2e1065; }
  .ge-poly-input {
    padding: 1px 4px; font: 11px ui-monospace, monospace;
    border: 1px solid #d6d3d1; border-radius: 2px; width: 100%;
    cursor: text; min-width: 0; box-sizing: border-box;
  }
  /* Strip the native number-input spinner — the up/down adjuster arrows
     waste horizontal space inside our compact 1fr column and add visual
     noise. Same trick used everywhere else in the editor. */
  .ge-poly-input[type="number"] {
    -moz-appearance: textfield; appearance: textfield;
  }
  .ge-poly-input[type="number"]::-webkit-outer-spin-button,
  .ge-poly-input[type="number"]::-webkit-inner-spin-button {
    -webkit-appearance: none; margin: 0;
  }
  /* Unwire button — sits in the SOCKET GUTTER column on the left edge of
     each sub-row. Only renders when the coord is wired or an expression;
     literal mode shows nothing (no link to break). Distinctive look: black
     trash glyph with a 1px black border so it reads as a deliberate
     "break this link" affordance, not a decorative chrome bit. SVG icon
     (not emoji) for crispness at small sizes — 11 × 11 px. */
  .ge-poly-unwire {
    width: 16px; height: 16px; padding: 0;
    background: #fff; border: 1px solid #1f2937; border-radius: 3px;
    cursor: pointer; color: #1f2937; opacity: 0.9;
    display: flex; align-items: center; justify-content: center;
    transition: background 100ms, opacity 100ms;
  }
  .ge-poly-unwire:hover { background: #f1f5f9; opacity: 1; }
  .ge-poly-unwire:active { background: #e2e8f0; }
  .ge-poly-input:hover { background: #f0f9ff; }
  .ge-poly-input:focus { outline: 1px solid #0369a1; background: #fff; }
  .ge-poly-input.expr { background: #faf5ff; color: #5b21b6; border-color: #c4b5fd; }
  .ge-poly-input.expr:focus { background: #fff; outline-color: #6d28d9; }
  .ge-poly-fx {
    width: 14px; height: 18px; padding: 0;
    background: #fff; border: 1px solid #d6d3d1; border-radius: 2px;
    font: 600 10px Arial; color: #6b7280; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
  }
  .ge-poly-fx:hover { background: #f5f5f4; border-color: #94a3b8; color: #0c4a6e; }
  .ge-poly-fx.on { background: #ddd6fe; color: #5b21b6; border-color: #a78bfa; }
  .ge-poly-del {
    width: 16px; height: 18px; padding: 0;
    /* Red outline — matches the unwire-🗑 button's bordered look so
       destructive-edge controls visually pair. */
    background: #fff; border: 1px solid #b91c1c; border-radius: 3px;
    cursor: pointer;
    font: 700 12px Arial; color: #b91c1c; line-height: 1;
    display: flex; align-items: center; justify-content: center;
  }
  .ge-poly-del:hover:not(:disabled) { background: #fee2e2; border-color: #7f1d1d; color: #7f1d1d; }
  .ge-poly-del:disabled { opacity: 0.3; cursor: default; }
  /* Insert-above button — symmetric counterpart to × in the bottom sub-row.
     Same 14 × 18 box; green palette to distinguish add-vs-remove at a
     glance (× is red). Click inserts a new vertex at this row's index,
     shifting this row + everything below down by one. */
  .ge-poly-ins {
    width: 14px; height: 18px; padding: 0;
    background: transparent; border: 0; cursor: pointer;
    font: 600 13px Arial; color: #15803d; line-height: 1;
    display: flex; align-items: center; justify-content: center;
  }
  .ge-poly-ins:hover { background: #dcfce7; border-radius: 2px; color: #14532d; }
  /* Footer add-row — two side-by-side buttons: "+ vertex" (orange) and
     "+ repeat" (violet). Stacked vertically when the card is narrow. */
  .ge-poly-add-row { display: flex; gap: 4px; margin-top: 4px; }
  .ge-poly-add {
    flex: 1 1 0; min-width: 0;
    padding: 4px 6px; font: 600 11px Arial;
    background: #fff7ed; color: #9a3412; border: 1px dashed #fdba74;
    border-radius: 4px; cursor: pointer;
  }
  .ge-poly-add:hover { background: #ffedd5; border-style: solid; border-color: #fb923c; color: #7c2d12; }
  /* Repeat-block variant — violet skin (matches the parametric-vertex
     colour family) so the visual contrast against "+ vertex" reads
     instantly as "this is a different KIND of thing". */
  .ge-poly-add.repeat {
    background: #f5f3ff; color: #5b21b6; border-color: #c4b5fd;
  }
  .ge-poly-add.repeat:hover { background: #ede9fe; border-style: solid; border-color: #a78bfa; color: #4c1d95; }
  .ge-poly-add.expr {
    background: #eef2ff; color: #4338ca; border-color: #a5b4fc;
  }
  .ge-poly-add.expr:hover { background: #e0e7ff; border-style: solid; border-color: #818cf8; color: #3730a3; }
  .ge-poly-repeat {
    margin-bottom: 2px; padding: 4px 4px 4px 6px;
    border: 1px solid #c4b5fd; border-radius: 5px;
    background: rgba(245, 243, 255, 0.6);
    display: flex; flex-direction: column; gap: 3px;
  }
  .ge-poly-repeat:hover { background: #f5f3ff; border-color: #a78bfa; }
  .ge-poly-repeat-head {
    display: flex; align-items: center; gap: 3px;
  }
  .ge-poly-repeat-badge {
    font: 700 9px Arial; color: #5b21b6; background: #ede9fe;
    border: 1px solid #c4b5fd; border-radius: 3px;
    padding: 1px 5px; letter-spacing: 0.5px;
  }
  .ge-poly-repeat-label {
    font: 9px ui-monospace, monospace; color: #6b7280;
    text-transform: uppercase; letter-spacing: 0.5px;
  }
  .ge-poly-repeat-count { width: 36px; min-width: 36px; flex: 0 0 36px; }
  .ge-poly-repeat-var   { width: 28px; min-width: 28px; flex: 0 0 28px; }
  .ge-poly-repeat-spacer { flex: 1 1 auto; }
  .ge-poly-repeat-row {
    display: grid;
    grid-template-columns: 38px 1fr;
    gap: 4px; align-items: center;
  }
  .ge-poly-repeat-row .ge-poly-axis-label {
    text-align: left; padding-left: 2px;
    color: #5b21b6; /* match the violet family */
  }
  /* ─── Repeat-ref summary row (#157) ──────────────────────────────────
     One-row strip inside the polygon table that represents a wire INTO
     a separate PolyRepeatNode card. Compact (matches vertex-row height
     so the per-row SVG socket overlay aligns), violet skin, shows the
     source's current count + a 5-char id stub for cross-card lookup. */
  .ge-poly-rref {
    margin-bottom: 2px; padding: 0 4px 0 6px;
    height: 36px; box-sizing: border-box;
    border: 1px solid #c4b5fd; border-radius: 5px;
    background: rgba(245, 243, 255, 0.6);
    display: flex; align-items: center; gap: 4px;
  }
  .ge-poly-rref:hover { background: #f5f3ff; border-color: #a78bfa; }
  .ge-poly-rref.missing { background: #fff7ed; border-color: #fb923c; }
  .ge-poly-rref.expr { background: #eef2ff; border-color: #a5b4fc; }
  .ge-poly-rref.expr .ge-poly-rref-glyph { color: #4338ca; }
  .ge-poly-rref.expr .ge-poly-rref-label { color: #3730a3; }
  .ge-poly-rref-glyph { font: 700 14px Arial; color: #5b21b6; line-height: 1; }
  .ge-poly-rref-label { font: 600 11px Arial; color: #4c1d95; white-space: nowrap; }
  .ge-poly-rref-spacer { flex: 1 1 auto; }
  /* ─── PolyRepeat card inner content (#157) ──────────────────────────
     Two sections — Params (count + loop var inline) and Loop ƒ(i)
     (two stacked expression rows). Compact 12-px label column, 1fr
     for the input so the expressions get most of the width. */
  .ge-poly-repeat-card {
    display: flex; flex-direction: column; gap: 4px;
    font: 11px Arial; color: #1f2937;
  }
  .ge-prc-section-head {
    font: 700 9px Arial; color: #6d28d9;
    text-transform: uppercase; letter-spacing: 0.6px;
    margin-top: 1px;
  }
  .ge-prc-params {
    display: grid;
    /* [NPts label] [value/chip] [ƒ] [var label] [var input] */
    grid-template-columns: 28px 48px 16px 22px 1fr;
    gap: 4px; align-items: center;
  }
  .ge-prc-expr-row {
    display: grid; grid-template-columns: 14px 1fr 16px;
    gap: 4px; align-items: center;
  }
  .ge-prc-label {
    font: 600 10px ui-monospace, monospace; color: #5b21b6;
    text-align: center;
  }
  /* Bindings section — variable-height list of local-name = value rows
     between Params and Loop. Inline "+ binding" button on the section
     head. Each row: name-input · = · value-expr · ƒ · × */
  .ge-prc-bindings-head {
    display: flex; align-items: center; justify-content: space-between;
    gap: 6px;
  }
  .ge-prc-add {
    height: 14px; min-width: 14px; padding: 0 4px;
    background: #ede9fe; border: 1px solid #c4b5fd; border-radius: 3px;
    font: 700 10px Arial; color: #5b21b6; line-height: 1; cursor: pointer;
  }
  .ge-prc-add:hover { background: #ddd6fe; border-color: #a78bfa; }
  .ge-prc-bind-row {
    display: grid; grid-template-columns: 56px 10px 1fr 16px 16px;
    gap: 3px; align-items: center;
  }
  .ge-prc-bind-name {
    font: 600 11px ui-monospace, monospace; color: #5b21b6;
  }
  .ge-prc-eq {
    font: 600 11px ui-monospace, monospace; color: #6b7280;
    text-align: center;
  }
  .ge-prc-bind-del { width: 16px; height: 16px; font: 700 11px Arial; }
  /* Repeat-ref wire (#157) — violet, slightly thicker than the param
     bezier so it reads as "data flow" not "param wiring". */
  .ge-wire.poly-rref {
    stroke: #6d28d9; stroke-width: 2.5; stroke-opacity: 0.75;
    fill: none;
  }
  /* Repeat-ref input socket on the polygon's left edge — violet, larger
     than a coord socket so the user can land a wire reliably. */
  .ge-sock.in.poly-rref-in { fill: #ede9fe; stroke: #6d28d9; stroke-width: 2; }
  .ge-sock.in.poly-rref-in.wired { fill: #6d28d9; }
  .ge-sock.in.poly-elist-in { fill: #eef2ff; stroke: #4f46e5; stroke-width: 2; }
  .ge-sock.in.poly-elist-in.wired { fill: #4f46e5; }
  .ge-sock.out.expr-out.list { stroke-width: 2; }
  .ge-sock.out.poly-repeat-out { fill: #6d28d9; stroke: #5b21b6; }
  /* ─── sketch-repeat card (#805) ───────────────────────────────────────── */
  .ge-node-bg.sketch-repeat { fill: #f5f3ff; stroke: #7c3aed; stroke-width: 2; }
  .ge-sr-params {
    display: grid; grid-template-columns: 34px 1fr 30px 1fr;
    gap: 4px; align-items: center; margin: 1px 0;
  }
  .ge-sr-op-row {
    display: grid; grid-template-columns: 30px 1fr 1fr 14px 14px 14px;
    gap: 3px; align-items: center; margin: 1px 0;
  }
  .ge-sr-coord.wide { grid-column: span 2; }
  .ge-sr-mode {
    height: 17px; padding: 0; background: #fff; border: 1px solid #d6d3d1;
    border-radius: 2px; font: 700 8px ui-monospace, monospace; color: #7c3aed;
    cursor: pointer;
  }
  .ge-sr-mode:hover { background: #ede9fe; }
  .ge-sr-mode.rel { color: #ea580c; border-color: #fdba74; }
  .ge-sr-mode.corner { color: #0e7490; border-color: #99f6e4; cursor: default; display: flex; align-items: center; justify-content: center; }
  .ge-sr-foot { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 4px; }
  .ge-sr-add {
    padding: 2px 5px; font: 600 9px Arial; background: #ede9fe; color: #5b21b6;
    border: 1px solid #c4b5fd; border-radius: 3px; cursor: pointer;
  }
  .ge-sr-add:hover { background: #ddd6fe; }
  /* NPts input socket on the loop card — yellow-ish so it reads as a
     PARAM input (matches the param-bezier palette elsewhere). Wired
     state fills the dot when count is wire-bound. */
  .ge-sock.in.poly-repeat-in { fill: #fff7ed; stroke: #c2410c; stroke-width: 2; }
  .ge-sock.in.poly-repeat-in.wired { fill: #fbbf24; stroke: #92400e; }
  .ge-arg-row { display: grid; grid-template-columns: 70px minmax(0, 1fr); gap: 4px; align-items: center; padding: 0; height: 22px; box-sizing: border-box; }
  /* mv/rot axis rows live inside .ge-xyz — collapse the key column to
     14 px and drop the gap so the input box sits right next to the
     rx/ry/rz label, no wasted horizontal space. */
  .ge-xyz .ge-arg-row { grid-template-columns: 14px minmax(0, 1fr); gap: 2px; }
  .ge-arg-key { font: 11px ui-monospace, monospace; color: #6b7280; }
  /* Axis labels (x/y/z, rx/ry/rz) on the mv/rot single-column card. Slim
     fixed column, LEFT-justified so the rx/ry/rz labels read in a clean
     column header pattern instead of right-bumping against the input. */
  .ge-arg-key.axis {
    flex: 0 0 14px; text-align: left;
    font: 600 10px ui-monospace, monospace; color: #6b21a8;
    padding: 0;
  }
  .ge-arg-input { padding: 1px 4px; font: 11px ui-monospace, monospace; border: 1px solid #d6d3d1; border-radius: 2px; width: 100%; cursor: ew-resize; }
  .ge-arg-input:hover { background: #f0f9ff; }
  .ge-arg-input:focus { cursor: text; outline: 1px solid #0369a1; background: #fff; }
  .ge-arg-input.expr { cursor: text; background: #faf5ff; color: #5b21b6; border-color: #c4b5fd; }
  .ge-arg-input.expr:focus { background: #fff; outline-color: #6d28d9; }
  /* Two-element cell: [ input | ƒ ] — keeps the grid 70px-key + 1fr-value
     layout intact while giving each arg row a literal/expr mode toggle. */
  .ge-arg-cell { display: flex; align-items: stretch; gap: 4px; }
  .ge-arg-cell > input { flex: 1 1 auto; min-width: 0; }
  .ge-arg-cell.wired > .ge-arg-pchip { flex: 1 1 auto; min-width: 0; }
  /* Trailing actions — pinned to the right of the value cell. Same flex
     row in every arg state (literal / wired / expr) so ƒ and × always
     land at the right edge of the row, vertically aligned with the
     input's right border. */
  .ge-arg-actions {
    display: inline-flex; align-items: center; gap: 2px;
    flex: 0 0 auto;
  }
  .ge-arg-action {
    display: inline-flex; align-items: center; justify-content: center;
    width: 18px; height: 18px; padding: 0;
    background: transparent; border: 1px solid #e5e7eb; border-radius: 3px;
    color: #6b7280; cursor: pointer; line-height: 1;
    font: 700 11px serif;
  }
  .ge-arg-action.fx { font: 700 11px serif; }
  .ge-arg-action.edit { font: 11px Arial; color: #9ca3af; }
  .ge-arg-action.x { font: 12px Arial; color: #b91c1c; border-color: #fecaca; }
  .ge-arg-action:hover { background: #ede9fe; color: #5b21b6; border-color: #c4b5fd; }
  .ge-arg-action.fx.on { background: #ede9fe; color: #5b21b6; border-color: #c4b5fd; }
  .ge-arg-action.x:hover { background: #fee2e2; color: #991b1b; border-color: #fca5a5; }
  /* Legacy .ge-arg-fx class — kept so anything still using it gets the
     same look. Will be removed in a follow-up when no callers remain. */
  .ge-arg-fx { flex: 0 0 auto; padding: 0 5px; font: 700 11px serif; background: transparent; border: 1px solid #e5e7eb; border-radius: 2px; color: #6b7280; cursor: pointer; line-height: 1; }
  .ge-arg-fx:hover { background: #ede9fe; color: #5b21b6; border-color: #c4b5fd; }
  .ge-arg-fx.on { background: #ede9fe; color: #5b21b6; border-color: #c4b5fd; }
  .ge-param-card-input { cursor: ew-resize; }
  .ge-param-card-input:focus { cursor: text; }
  :global(body.dragnum-active) { cursor: ew-resize !important; }
  :global(body.dragnum-active *) { cursor: ew-resize !important; }
  /* Wired-param chip body — label-only (ƒ + × moved out to .ge-arg-actions).
     Pill-shaped so it visually reads as a "wire connection" not an input. */
  .ge-arg-pchip {
    display: inline-flex; align-items: center; min-width: 0;
    padding: 1px 8px; font: 600 10px ui-monospace, monospace;
    background: #fef3c7; color: #78350f; border: 1px solid #fbbf24;
    border-radius: 9999px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .ge-arg-pchip.ƒ { background: #ede9fe; color: #5b21b6; border-color: #c4b5fd; }
  .ge-arg-key.wire-btn { background: transparent; border: 0; padding: 1px 4px; font: 11px ui-monospace, monospace; color: #6b7280; cursor: pointer; text-align: left; border-radius: 2px; }
  .ge-arg-key.wire-btn:hover { background: #fef3c7; color: #78350f; }
  .ge-xform-btn { font: 13px Arial; fill: #6b7280; cursor: pointer; user-select: none; }
  .ge-xform-btn:hover { fill: #6d28d9; }
  .ge-xform-btn.on { fill: #6d28d9; font-weight: bold; }
  .ge-drift-btn { font: 700 14px Arial; fill: #d97706; cursor: pointer; user-select: none; }
  .ge-drift-btn:hover { fill: #92400e; }
  /* (Inline mv/rot transform STRIP styles removed #25 — mv/rot are standalone
     icon nodes now; strips no longer render off the Call card.) */
  .ge-xform-btn { font: 13px Arial; fill: #6b7280; cursor: pointer; user-select: none; }
  .ge-xform-btn:hover { fill: #6d28d9; }
  .ge-xform-btn.on { fill: #6d28d9; font-weight: bold; }
  .ge-drift-btn { font: 700 14px Arial; fill: #d97706; cursor: pointer; user-select: none; }
  .ge-drift-btn:hover { fill: #92400e; }
  .ge-sock { fill: #fff; stroke: #0c4a6e; stroke-width: 2; cursor: crosshair; touch-action: none; }
  /* Touch devices: the SVG sockets are tiny (r=4-6 ≈ 8-12px) and hard to hit
     with a finger. Scale them up on COARSE pointers only — this enlarges both
     the visible dot AND the SVG hit geometry, centered on each socket so its
     cx/cy stay put. Mouse users keep the compact dots. */
  @media (pointer: coarse) {
    .ge-sock { transform-box: fill-box; transform-origin: center; transform: scale(1.5); }
  }
  .ge-sock.out { stroke: #15803d; }
  .ge-sock.in.obj { stroke: #b91c1c; }
  .ge-sock.in.arg { stroke: #d97706; }
  .ge-sock.in.child { stroke: #6d28d9; }
  /* Polygon per-coord input sockets — orange (matches the polygon card
     palette). Wired state fills with the same violet as Call wired args. */
  .ge-sock.in.poly-coord { stroke: #c2410c; }
  .ge-sock.in.poly-coord.wired { fill: #ede9fe; stroke: #6d28d9; }
  /* Connector line from each per-coord socket into its corresponding
     input cell. Subtle slate by default so it reads as a visual hint
     (top socket → first cell, bottom → second cell). Wired state
     switches to violet matching the socket fill + the param-wire color
     elsewhere in the editor. */
  .ge-poly-connector { stroke: #cbd5e1; stroke-width: 1.5; fill: none; pointer-events: none; }
  .ge-poly-connector.wired { stroke: #6d28d9; stroke-width: 1.8; }
  .ge-sock:hover { fill: #fef3c7; }
  .ge-sock-label { font: 10px ui-monospace, monospace; fill: #6b7280; pointer-events: none; }
  .ge-sketch-edit-btn { font: 13px system-ui; fill: #7c3aed; cursor: pointer; }
  .ge-sketch-edit-btn:hover { fill: #5b21b6; }
  /* ✎ on the Repeat card tints when the repeat carries a pattern. */
  .ge-sketch-edit-btn.patterned { fill: #be185d; }
  .ge-resize-grip {
    fill: #cbd5e1; opacity: 0.55; cursor: ew-resize;
    transition: fill 120ms, opacity 120ms;
  }
  .ge-resize-grip:hover { fill: #6366f1; opacity: 0.95; }
  /* Bottom-right corner resize handle — moved from the right edge so the
     output sockets sitting at x=size.w have their full hit area back.
     Hit rect is larger than the visible strokes for forgiveness. */
  .ge-resize-corner { cursor: nwse-resize; }
  .ge-resize-corner-hit { fill: transparent; }
  .ge-resize-corner-line { stroke: #94a3b8; stroke-width: 1.5; stroke-linecap: round; fill: none; pointer-events: none; }
  .ge-resize-corner:hover .ge-resize-corner-line { stroke: #6366f1; stroke-width: 2; }
  .ge-arg-fnchip { display: inline-flex; align-items: center; gap: 2px; flex: 1 1 auto; min-width: 0; padding: 1px 6px; font: 600 10px ui-monospace, monospace; background: #fef3c7; color: #78350f; border: 1px solid #f59e0b; border-radius: 9999px; cursor: pointer; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; transition: background 0.12s; }
  /* The refs sub-span must also shrink, else its min-content keeps the chip wide. */
  .ge-arg-fnchip-refs { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .ge-arg-fnchip:hover { background: #fde68a; }
  .ge-arg-fnchip-refs { color: #b45309; font-weight: 500; }
  /* Profile chip (#119) — appears on r_revolve / r_extrude / r_weld_extrude
     Call card rows where the underlying param is `type: 'profile'`. Shows
     the current kind label with a ▾ disclosure glyph; click opens the
     kind picker popover. */
  .ge-arg-profilechip {
    display: inline-flex; align-items: center; gap: 4px; flex: 1 1 auto;
    padding: 1px 8px; font: 600 10px ui-monospace, monospace;
    background: #ede9fe; color: #5b21b6;
    border: 1px solid #c4b5fd; border-radius: 9999px;
    cursor: pointer; max-width: 100%;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    transition: background 120ms;
  }
  .ge-arg-profilechip:hover { background: #c4b5fd; color: #2e1065; }
  .ge-arg-profilechip-kind { font-weight: 700; }
  /* Node-ref profile (wired to a polygon/sketch): teal. Empty slot: dashed. */
  .ge-arg-profilechip.noderef { background: #cffafe; color: #155e75; border-color: #67e8f9; }
  .ge-arg-profilechip.noderef:hover { background: #a5f3fc; color: #164e63; }
  .ge-arg-profilechip.empty { background: #fff; color: #b45309; border: 1px dashed #fbbf24; }
  .ge-arg-profilechip.empty:hover { background: #fffbeb; }
</style>
