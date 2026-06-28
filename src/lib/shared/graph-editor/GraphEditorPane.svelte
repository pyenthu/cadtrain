<!--
  GraphEditorPane.svelte — THE node-graph CAD editor SHELL.
  Mounted full-screen by /graph-editor and once-per-tab by /primitives.

  ── MODULE MAP (modularize round 2 — see docs/plans/graph-editor-pane.md) ──
  This file is the composing SHELL: viewport pan/zoom, the bake-orchestration
  $effects, the param/properties left card, the SVG wire overlay, and the
  launcher glue (open*) for the popovers/overlays below. Feature surfaces live
  in siblings — edit THOSE, not here, for feature work:
    · geom.ts / args.ts              — pure socket/wire/card math + ArgValue fmt
    · graph-editor-bake(.svelte).ts  — source/meta parsers + `expected` cache
    · wire-state.svelte.ts           — WireState class (drag-to-wire)
    · NodeCard.svelte                — every per-node card (call/mv/rot/poly/…)
    · sketch-state.svelte.ts + SketchNodeCard + SketchEditorPane  — sketch
    · poly-preview-state.svelte.ts + PolyPreview.svelte           — polygon 2D
    · RepeatEditorPane.svelte        — repeat-node overlay
    · Popovers.svelte / CanvasMenu / AiMenu — anchored popovers + rail menus
    · expr/ExpressionBuilderPopup + ExpressionsMenu — the Σ expression editor
    · RightPane.svelte / ParamsCard / PropertiesCard — right column + left card

  STATE RULE: per-instance state is a CLASS (WireState/SketchState/
  PolyPreviewState) — /primitives mounts N panes, so a module-level $state would
  LEAK across tabs. The ONE shared singleton is `expected` (graph-editor-bake
  .svelte.ts) — intentional + idempotent (a primitive's params are tab-invariant).

  Save: writes <exemplar>.asm.ts to the volume via /api/primitives/save.
  Plans: docs/plans/graph-editor-pane.md · composition-architecture.md.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { scene } from '$lib/shared/scene-state.svelte';
  import {
    newGraph,
    addCall,
    addPolygon,
    addSketch,
    addSketchOp,
    setSketchOpField,
    setSketchOpKind,
    setSketchOpMode,
    finalize,
    moveSketchOp,
    removeSketchOp,
    setSketchSegments,
    addSketchSplinePoint,
    setSketchSplinePoint,
    removeSketchSplinePoint,
    setSketchSplineHandle,
    clearSketchSplineHandle,
    setPolygonCoord,
    addPolygonPoint,
    addPolygonRepeat,
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
    addMethodPlaceholder,
    addMvPlaceholder,
    addRotPlaceholder,
    addTxfmnPlaceholder,
    setTransformAxis,
    setTransformAxisValue,
    setTxfmnAxis,
    setViewport,
    addExprDef,
    addExprInstance,
    removeExprDef,
    addStackPlaceholder,
    addRepeatPlaceholder,
    setRepeatChild,
    addRepeatChild,
    addRepeatModifier,
    setRepeatModifierAxis,
    setRepeatModifierKind,
    moveRepeatModifier,
    removeRepeatModifier,
    appendContainerChild,
    removeContainerChildAt,
    setCallArg,
    removeNode,
    setLayout,
    asLiteral,
    asExpr,
    asParam,
    addParam,
    removeParam,
    setParamSchema,
    addStackRef,
    hasStackRef,
    setPartColorOuter,
    setPartColorInner,
    setPartMaterial,
    setPartAppearance,
    setStackChildRef,
    setStackChildCount,
    STACK_REF_PARAM,
    wrapInTransform,
    unwrapTransform,
    inlineTransformOf,
    hydrateGraph,
    type Graph,
    type NodeId,
    type CsgOp,
    type MvNode,
    type RotNode,
  } from '$lib/cad/composition-graph';
  import { emitGraph, consumedByCall } from '$lib/cad/composition-emit';
  import { emitProfileGraph } from '$lib/cad/composition-emit-profile';
  import { bakeGraphPreview } from '$lib/cad/composition-bake';
  import { autoLayoutGraph, forceSeparate } from '$lib/cad/composition-layout';
  import { compileSketch, chordToAbs, absToChord, type SketchOp } from '$lib/cad/sketch';
  import { sketchColLayout, sketchEntryH } from '$lib/cad/sketch-layout';
  // Pure socket / card / position geometry (P1/G1 extraction — see
  // docs/plans/modularize.md). These take captured state (graph, pan/zoom,
  // CARD_Y0, PARAM_W, cardObstacles, sketch.sketchOpsScrollTop) as explicit args.
  import {
    bezier, chipWidthFor, paramCardSize, extractParamRefs, paramSocketPos,
    cardMinWidth, polySockR, polySockZ, polySockRef,
    sketchCols, sketchSockR, sketchSockZ, sketchSockVal,
    sketchRowVisible, nodeSize, containerSlotY, rootOutputSockY,
    attachedTransforms, isAttachedTransform,
    xformStripAt, xformSocketAt, xformOutputAt, xformArrows,
    inlineCardH, outputSocketAt, inputSocketAt, containerSlotInputAt,
    exprInputSockY, exprOutputSockY,
    entryIdxForEvalIdx, miniBez,
    CARD_X0, CARD_PAD, CARD_TITLE_H, PARAM_W_MIN, PARAM_H, PARAM_GAP, STRIP_W, STRIP_H,
  } from './geom';
  import { exprBlockMember } from '$lib/cad/graph-exprs';
  import { PolyPreviewState } from './poly-preview-state.svelte';
  import PolyPreview from './PolyPreview.svelte';
  import { dragNumber } from '$lib/shared/dragNumber';
  import RightPane from './RightPane.svelte';
  // The 4 self-contained popovers (container reorder · arg ƒ-expr · profile-kind
  // · profile-node-ref) live in Popovers.svelte (modularize K.65 Phase A). GEP
  // drives them via `bind:this={popovers}` from its node-render arms. The
  // sketch/poly/param/wire popovers stay here (coupled to phases E/F/D). The
  // viewport-clamp action is shared via popover-clamp.ts so the two callers
  // (Popovers' argExpr + GEP's sketch/poly expr popovers) can't drift.
  import Popovers from './Popovers.svelte';
  import PropertiesCard from './PropertiesCard.svelte';
  import ParamsCard from './ParamsCard.svelte';
  // Expression builder popover (B.6 / id 914, PR-3). A popover-first surface for
  // authoring calculated `e.<name>` exprs (graph.exprs[]) — opened from the Σ
  // rail launcher; expand-to-full inside the popup. Per-instance state lives in
  // the popup; GEP owns only the open flag + anchor + commit→graph.exprs wiring.
  import ExpressionBuilderPopup from './expr/ExpressionBuilderPopup.svelte';
  import ExpressionsMenu from './expr/ExpressionsMenu.svelte';
  import TypeDefinerPopover from '$lib/shared/TypeDefinerPopover.svelte';
  import AutoWireSuggestPanel from './AutoWireSuggestPanel.svelte';
  import type { ExprDef } from '$lib/cad/composition-graph-types';
  // Sketch NODE CARD render arm (Phase E Step 2, block 1). Takes the ONE per-pane
  // `sketch` SketchState instance; only SETS sketch.sketchExprPop (the coord
  // ƒ-popover still renders in the shell — the Phase-E-revert fix).
  import SketchNodeCard from './SketchNodeCard.svelte';
  import NodeCard from './NodeCard.svelte';
  // Full-tab sketch editor overlay (Phase E Step 2, block 2). Self-guards on
  // sketch.editingSketchId; only SETS sketch.sketchExprPop (popover in shell).
  import SketchEditorPane from './SketchEditorPane.svelte';
  import RepeatEditorPane from './RepeatEditorPane.svelte';
  import CanvasMenu from './CanvasMenu.svelte';
  import AiMenu from './AiMenu.svelte';
  import { clampToViewport } from './popover-clamp';
  import { releaseImplicitCapture } from './pointer-capture';
  // Per-pane drag-to-wire state + handlers (Phase C). A per-instance class
  // (NOT a singleton — /primitives mounts all tab panes at once); `wire` is
  // constructed below once `graph`/`clientToGraph` are in scope.
  import { WireState } from './wire-state.svelte';
  import { SketchState } from './sketch-state.svelte';
  // Source/meta parsers + the expected-params cache (drift detection) —
  // modularize K.65 Phase B. `expected` is a shared singleton $state cache keyed
  // by primitive src; the graph-touching fns take/return graph explicitly.
  import {
    extractGraphFromSource, extractDrawingMdFromSource,
    expected, ingestMeta, loadExpectedParamsFor, isCallDrifted, refreshCallArgs,
  } from './graph-editor-bake.svelte';
  import { PROFILE_REGISTRY } from '$lib/shared/profile-presets';
  import {
    argStr, argFrom, argToDraftStr, evalArg, sketchParamScope,
    producerLabel, parseProfileExpr,
  } from './args';

  /** Props (component contract — same surface mounted by /graph-editor for
   *  full-page work and by /primitives for the tabbed multi-instance view).
   *
   *  UNIFIED MODEL (post-K.72): there is ONE editor, ONE graph type, ONE
   *  save endpoint. The output type of the graph (polygon literal vs
   *  manifold) decides what the right pane renders (2D SVG vs 3D bake),
   *  not a prop. A graph with only a Polygon node saves as a profile-
   *  shaped file; a graph with a revolve/extrude saves as a part-shaped
   *  file — the save endpoint inspects the emitted meta and chooses the
   *  on-disk location, the editor itself doesn't branch.
   *
   *    id     — the primitive to load on mount. When null/undefined the
   *             component opens a fresh default graph (`test_graph_a`).
   *    embed  — when true the global SvelteKit nav is hidden via the head
   *             style injection below + the inner chrome layout collapses
   *             so the editor fits inside another page's tab/iframe. */
  interface Props {
    id?: string | null;
    embed?: boolean;
    /** Optional callback to open another primitive id in a new editor
     *  tab — wired by the /primitives parent so clicking a call card's
     *  title navigates to that part's own editor. When unset the click
     *  is a no-op (e.g. /vocab's embed where there's no tab strip). */
    onOpenTab?: (id: string) => void;
    /** Tab visibility (2026-06-11). When false (an inactive /primitives
     *  tab), the 3D canvas is UNMOUNTED so its WebGL context is released
     *  — browsers cap at ~16 contexts, so N open tabs each holding one
     *  ran the page out of contexts. All other editor state (graph,
     *  bake result, zoom) stays mounted; reactivating remounts the
     *  canvas which repaints from the PrimitiveDualCanvas fetch cache.
     *  Defaults true so standalone mounts (/graph-editor, /vocab) are
     *  unaffected. */
    active?: boolean;
    /** RAG Phase 2 — a generated composition graph to hydrate INSTEAD of
     *  fetching `id` from the volume. The part doesn't exist on disk yet;
     *  `id` still seeds exemplarId so the user's first Save lands under
     *  that name. */
    seedGraph?: any;
    /** RAG Phase 2 — wired by /primitives. When set, the vertical rail
     *  shows a ✨ button whose popover takes a part description, POSTs
     *  /api/rag/prompt, and hands the proposed {id, graph} back to the
     *  parent to open as a new seeded tab. Hidden when unset (standalone
     *  /graph-editor / /vocab mounts have no tab strip to open into). */
    onGenerated?: (id: string, graph: any, candidates: string[]) => void;
    /** Target folder for a NEW part's first Save — the active folder-tab /
     *  subfolder in the /primitives sidebar (location IS category, Rule 16).
     *  A 1–3-segment path under primitives/ (e.g. 'completions/drill_pipe').
     *  Ignored for parts that already exist on disk (save writes back in
     *  place server-side). Defaults to 'basic'. */
    createDir?: string;
    /** Fired after a successful Save — lets /primitives refresh the sidebar
     *  list (+ optimistically surface a brand-new part immediately, since the
     *  proxied /list lags writes by seconds). (id, dir). */
    onSaved?: (id: string, dir: string) => void;
  }
  const props: Props = $props();
  // exemplarId is the WRITABLE working id — Save / Save-as / typing in the
  // id input mutate it locally. The `id` prop only seeds it; once mounted
  // we stop reading the prop so the user's typed value isn't reverted.
  let graph = $state<Graph>(newGraph());
  let exemplarId = $state<string>(props.id ?? 'test_graph_a');
  let saveStatus = $state<string | null>(null);
  /** Embed mode — when the editor is mounted inside another surface (the
   *  /primitives tab strip, the /vocab Editor tab), hide the global layout
   *  nav so the chrome doesn't double-up. The page's own .ge-bar stays
   *  since it hosts Save / + Drop / id input — the in-context controls. */
  let embed = $state<boolean>(!!props.embed);
  // Drift detection (Phase 11) — the expected-params cache + loaders moved to
  // graph-editor-bake.svelte.ts (Phase B). `expected.{params,defaults,
  // profileKeys,profileSet}` is the shared singleton cache; isCallDrifted /
  // refreshCallArgs / loadExpectedParamsFor are imported above.

  // The extracted popover component (Phase A). Bound via `bind:this` so the
  // node-render arms can call `popovers.openContainerPop/openArgExprPop/
  // openProfilePop/openProfileRefPop/moveChild/detachProfile(...)`.
  let popovers: Popovers | undefined = $state();

  // ─── expression definition editor (B.7 / id 914, v3) ───────────────────────
  // The four-section ExprDef editor (PARAMS · CONSTS · VARIABLES · OUTPUTS).
  // Opened from the Σ rail launcher (on the part's first def, creating an empty
  // one if none) or from an instance card's ✎ button (on that instance's def).
  // Commit replaces the whole def in graph.exprDefs (so every instance updates).
  // The full Expressions menu (list + drop-instance) is PR-3.
  let exprPop = $state<{
    anchor: { x: number; y: number };
    defId: string;
  } | null>(null);
  let exprPopDef = $derived.by<ExprDef | null>(() =>
    exprPop ? ((graph.exprDefs ?? []).find((d) => d.id === exprPop!.defId) ?? null) : null,
  );
  // The Σ Expressions MENU (B.7 v3 PR-3) — lists graph.exprDefs and is the home
  // of the define → instance → wire flow. Opening it is the Σ rail button's job;
  // the four-section editor (exprPop) is opened FROM the menu (✎ / +).
  let exprMenu = $state<{ anchor: { x: number; y: number } } | null>(null);
  // ◇ Type Definer popover (typed-ports L2b/c) — the shared composite-type library.
  let typesPop = $state(false);
  // ✨ Auto-wire suggestions popover (the generative typed-ports hook).
  let suggestPop = $state(false);
  let vrailEl = $state<HTMLElement | null>(null); // the left rail (anchors the Σ menu from the picker)
  // defId → how many ExprNode instances reference it (drives the delete guard).
  let exprInstanceCounts = $derived.by<Record<string, number>>(() => {
    const counts: Record<string, number> = {};
    for (const n of Object.values(graph.nodes)) {
      if (n.type === 'expr') counts[n.defId] = (counts[n.defId] ?? 0) + 1;
    }
    return counts;
  });
  /** Σ launcher — open the Expressions menu anchored to the Σ button. */
  function openExprPop(ev: MouseEvent) {
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    exprMenu = { anchor: { x: r.right + 8, y: r.top } };
  }
  /** Menu + → create a new (empty) def and open the editor on it right away. */
  function addExprDefAndEdit(ev: MouseEvent) {
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const made = addExprDef(graph); graph = made.graph;
    exprMenu = null;
    exprPop = { anchor: { x: r.right + 8, y: r.top }, defId: made.id };
  }
  /** Menu ✎ — close the menu and open the editor on this def. */
  function editExprDefFromMenu(ev: MouseEvent, defId: string) {
    exprMenu = null;
    openExprDefEditor(ev, defId);
  }
  /** Menu ⦻ — drop an instance of this def onto the canvas. */
  function dropExprInstance(defId: string) {
    graph = addExprInstance(graph, defId).graph;
  }
  /** Menu × (after the inline confirm) — remove the def AND every instance of it. */
  function deleteExprDef(defId: string) {
    let g = graph;
    for (const n of Object.values(g.nodes)) {
      if (n.type === 'expr' && n.defId === defId) g = removeNode(g, n.id);
    }
    graph = removeExprDef(g, defId);
  }
  /** Instance-card ✎ — open the editor bound to that instance's def. */
  function openExprDefEditor(ev: MouseEvent, defId: string) {
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    // A dangling defId (def deleted out from under the instance): make a fresh
    // empty def and repoint nothing here (PR-4 owns recreation); just open one.
    if (!(graph.exprDefs ?? []).some((d) => d.id === defId)) {
      const made = addExprDef(graph); graph = made.graph; defId = made.id;
    }
    exprPop = { anchor: { x: r.right + 8, y: r.top }, defId };
  }
  /** Commit the whole edited def back into graph.exprDefs (every instance reads
   *  through it, so this updates them all). */
  function commitExpr(def: ExprDef) {
    const list = (graph.exprDefs ?? []).slice();
    const idx = list.findIndex((d) => d.id === def.id);
    if (idx >= 0) list[idx] = def; else list.push(def);
    graph = { ...graph, exprDefs: list };
    exprPop = null;
  }

  let emitted = $derived(emitGraph(graph, { id: exemplarId, drawingMd }));
  // The SOURCE the LIVE SOURCE tab + the bake canvas see — it's the
  // GHOST-emit when any 👁 is active (so the canvas re-posts the same
  // source the auto-bake just baked, gets the same response, and
  // renders the cutters alongside the result). When no ghosts active
  // it falls back to the plain emit. MD is included so the SRC tab's
  // text matches what Save writes to disk.
  let emittedForRender = $derived(emitGraph(graph, { id: exemplarId, ghosts: ghostIds, drawingMd }));
  let sourceText = $derived(emittedForRender.source);
  // Memoised param-defaults — a STABLE reference for the canvas `args` fallback.
  // A fresh `Object.values(...).map(...)` per render re-mounts the canvas / loops
  // its auto-fit (see fresh_array_props_effect_loops). Only changes when the
  // param defaults actually change.
  let paramDefaults = $derived(Object.values(graph.params).map((p) => p.default));

  let bake = $state<{ ok: boolean; source?: string; args?: (number | string)[]; bake?: any; message?: string } | 'loading' | null>(null);
  let bakeTimer: ReturnType<typeof setTimeout> | undefined;
  /** Mode the polygon at `polyId` should render under — revolve (r, z)
   *  with axis at r=0, or cartesian (x, y) centered around origin.
   *  Decided by the consuming Call: r_revolve → revolve; r_weld_extrude
   *  / r_extrude → cartesian; nothing consumes it → fall back to the
   *  file's saved set (profileSet, default 'revolve'). Polygon CARD
   *  column labels, the 2D-preview popup, and the right-pane 2D
   *  PREVIEW all consult this so a polygon wired to extrude reads as
   *  cartesian everywhere it surfaces. */
  /** Pick the axis label set for a PolyRepeatNode based on the polygon(s)
   *  that consume it. A poly_repeat fed into an r_revolve uses (r, z);
   *  one fed into r_extrude uses (x, y). Walks every polygon's points
   *  for a repeat-ref whose sourceId matches; returns the first
   *  consumer's mode, falling back to the active profile's set.
   *  Multi-consumer ambiguity (rare) gets the first match — deterministic
   *  enough for the label task. */
  // ─── Polygon 2D-preview overlay (R6a) — state + handlers live in
  //     poly-preview-state.svelte.ts (per-instance class). The coord ƒ-popover
  //     (polyExprPop) stays in this shell below; polyUI only OPENS it. ───────
  const polyUI = new PolyPreviewState(
    () => graph,
    (g) => { graph = g; },
    () => profileSet,
    (ev, polygonId, idx, axis, expr) => openPolyExprPop(ev, polygonId, idx, axis, expr),
  );

  // Escape exits delete/insert mode — handled in onWindowKeydown (registered +
  // cleaned up in onMount). Previously a top-level addEventListener here leaked
  // one anonymous handler per component instance (multi-tab) — Cursor review #1.

  /** Profile-mode preview state — populated by /api/primitives/profiles/resolve
   *  with the polygon points the build() returns at default params. Driven
   *  by a separate effect that fires on profile load + on bakeNonce changes
   *  (the Bake button reuses the same nonce so the user gets a re-resolve
   *  after editing). `profileSet` ('revolve' | 'cartesian') changes how the
   *  SVG renders the axis + Y orientation. */
  let profilePts = $state<[number, number][]>([]);
  let profileSet = $state<'revolve' | 'cartesian'>('revolve');
  let profileResolveErr = $state<string | null>(null);
  let profileSource = $state<string>('');
  /** Profile's meta.params (loaded from the file's meta block) — used as
   *  the default param dict when calling /resolve. We can't just read
   *  graph.params because profiles loaded in legacy mode (no meta.graph
   *  block) have an empty graph + empty params, but the build() needs
   *  the file's declared param defaults to produce points. */
  let profileMetaParams = $state<Record<string, { default?: number }>>({});
  /** Universal output-type detection — does the graph produce a 3D
   *  Manifold or 2D polygon points?
   *
   *  2D output (polygon literal) when the graph contains ONLY:
   *    - polygon nodes
   *    - the root list / nested list / group containers
   *    - nothing else
   *
   *  3D output when ANY other node type is present — Call, method,
   *  mv/rot transform, repeat, stack. Those all produce manifolds (or
   *  arrays of manifolds), so the right pane needs the 3D bake.
   *
   *  This is the "one universal graph" promise: the editor decides
   *  what to render from the graph's content, not from a fixed
   *  `kind: 'part' | 'profile'` flag. */
  const hasSolidProducer = $derived(
    Object.values(graph.nodes).some((n) => {
      const t = (n as any).type;
      if (t === 'polygon') return false;
      if (t === 'list' || t === 'group') return false;
      return true;
    }),
  );
  /** Derived viewBox + path for the 2D SVG preview (revolve: axis at r=0,
   *  Z-down; cartesian: Y-flip so positive points up). Mirrors the SVG
   *  logic in the deleted ProfilePane. */
  const profileView = $derived.by(() => {
    const pts = profilePts;
    if (pts.length === 0) return null;
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const xMin0 = Math.min(...xs), xMax0 = Math.max(...xs);
    const yMin0 = Math.min(...ys), yMax0 = Math.max(...ys);
    const isCart = rootPolygonMode === 'cartesian';
    // Cartesian mode: center the SVG on (0, 0) — the extrude rotates
    // around the origin, so the viewport should show that as the center
    // even when the polygon's bbox is off-center. viewBox half-extent =
    // the largest absolute coord in either axis, so positive and negative
    // sides are mirrored around 0. Revolve mode keeps the natural bbox-
    // fit so the polygon hugs the visible area.
    let xMin: number, yMin: number, w: number, h: number;
    if (isCart) {
      const half = Math.max(Math.abs(xMin0), Math.abs(xMax0), Math.abs(yMin0), Math.abs(yMax0), 0.001);
      xMin = -half; yMin = -half; w = 2 * half; h = 2 * half;
    } else {
      xMin = xMin0; yMin = yMin0;
      w = Math.max(0.001, xMax0 - xMin0); h = Math.max(0.001, yMax0 - yMin0);
    }
    const pad = Math.max(w, h) * 0.08;
    return {
      vb: `${xMin - pad} ${yMin - pad} ${w + 2 * pad} ${h + 2 * pad}`,
      d: pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ') + ' Z',
      // Closure: dashed segment from last point back to first.
      dClose: pts.length > 1
        ? `M ${pts[pts.length - 1][0]} ${pts[pts.length - 1][1]} L ${pts[0][0]} ${pts[0][1]}`
        : '',
      yFlip: isCart,
      axis: !isCart,
      xMin, yMin, w, h, pad,
    };
  });
  /** Mode for the right-pane 2D PREVIEW — when the graph's output is a
   *  single polygon (no solid producer), use polyUI.polygonModeFor on that
   *  polygon's id so the preview adapts to a downstream extrude even
   *  though extrude only becomes the consumer after wiring. With no
   *  polygon present, fall back to the file's saved set. */
  const rootPolygonMode = $derived.by<'revolve' | 'cartesian'>(() => {
    const polygons = Object.values(graph.nodes).filter((n) => (n as any).type === 'polygon') as any[];
    if (polygons.length === 0) return profileSet;
    return polyUI.polygonModeFor(polygons[0].id);
  });
  /** Companion to `rootPolygonMode` — id of the polygon whose vertices
   *  are visible in the right-pane 2D PREVIEW (the only one that exists
   *  in 2D-output mode). Used by the vertex-drag pointerdown to know
   *  which node's coords to rewrite. Null when there's no polygon in
   *  the graph (the 2D pane shows the on-disk build's points then, and
   *  those aren't editable). */
  const rootPolygonId = $derived.by<string | null>(() => {
    const polygons = Object.values(graph.nodes).filter((n) => (n as any).type === 'polygon') as any[];
    return polygons.length === 0 ? null : polygons[0].id;
  });
  /** Profile-mode resolve — calls /api/primitives/profiles/resolve with
   *  `profileSource` (loaded from the file) and current default params,
   *  populating `profilePts` for the right-pane 2D SVG. Re-fires on
   *  source change and on bakeNonce bumps (the 🔨 button triggers a
   *  manual re-resolve). The graph itself doesn't yet feed back into
   *  profileSource — that's the Step-2 profile emit pipeline.
   *  PROFILE_TODO Phase 2.2: emit graph → build() body each change. */
  /** Profile-mode resolve. Two source paths:
   *   * GRAPH path — the canvas has pen_* nodes wired. The graph is
   *     emitted via composition-emit-profile.ts into a build() body;
   *     we POST that to /resolve. This is what gives the user a LIVE
   *     2D preview as they drop / edit pen nodes.
   *   * ON-DISK path — empty/legacy graph (no pen nodes). We fall back
   *     to the original profileSource loaded from the file so the
   *     preview still shows SOMETHING.
   *
   *  Params come from the graph's own meta.params (PARAMS card sliders)
   *  when present, otherwise the file's meta.params defaults. Debounced
   *  120 ms so a slider drag doesn't flood /resolve. */
  let profileResolveTimer: ReturnType<typeof setTimeout> | undefined;
  let lastProfileResolveKey = '';
  $effect(() => {
    // 2D resolve fires when the graph's output is a polygon (no solid
    // producer present). When a revolve/extrude lives in the graph, the
    // part-bake pipeline takes over and this effect short-circuits.
    if (hasSolidProducer) return;
    void bakeNonce; // re-run on manual bake

    // Pick the source: emit the graph when it has profile-shaped nodes
    // (Polygon — the canonical path — or legacy pen_* Calls); else fall
    // back to the on-disk profileSource. Bug in v2 first cut — only
    // pen_* was checked, so a polygon's edits went unnoticed and the
    // preview kept showing the file's untouched shape.
    const hasGraphContent = Object.values(graph.nodes).some((n) => {
      const t = (n as any).type;
      if (t === 'polygon') return true;
      if (t === 'call' && String((n as any).src ?? '').startsWith('pen_')) return true;
      return false;
    });
    const src = hasGraphContent ? emitProfileGraph(graph).source : profileSource;
    if (!src) return;

    // Param dict — prefer graph.params (the editor-controlled sliders)
    // when populated; fall back to the file's meta.params.
    const params: Record<string, number> = {};
    const graphParams = graph.params ?? {};
    if (Object.keys(graphParams).length > 0) {
      for (const [k, v] of Object.entries(graphParams)) {
        params[k] = Number((v as any)?.default ?? 0);
      }
    } else {
      for (const [k, v] of Object.entries(profileMetaParams)) {
        params[k] = Number((v as any)?.default ?? 0);
      }
    }

    // Dedupe — this $effect re-fires on EVERY render (graph identity churn,
    // tab activation, unrelated state), not just on real source/param
    // changes. Without a guard, a failing resolve (400) re-POSTed the
    // identical body 4-5× per interaction. Key includes bakeNonce so the
    // 🔨 button still forces a retry of an unchanged body.
    const body = JSON.stringify({ source: src, params });
    const resolveKey = `${bakeNonce}:${body}`;
    clearTimeout(profileResolveTimer);
    profileResolveTimer = setTimeout(async () => {
      if (resolveKey === lastProfileResolveKey) return;
      lastProfileResolveKey = resolveKey;
      try {
        const r = await fetch('/api/primitives/profiles/resolve', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body,
        });
        if (!r.ok) { profileResolveErr = `Resolve ${r.status}: ${(await r.text()).slice(0, 160)}`; return; }
        const d = await r.json();
        profilePts = Array.isArray(d.points) ? d.points : [];
        profileResolveErr = null;
      } catch (e: any) { profileResolveErr = e?.message ?? String(e); }
    }, 120);
  });

  /** Re-bake nonce — increment to trigger a fresh /api/primitives/preview
   *  call. Used by the 🔨 Bake button (manual rebake), the 🔄 Rebuild
   *  button (cache wipe + rebake), and the initial-load auto-bake. */
  let bakeNonce = $state(0);
  /** Set by the explicit 🔄 Rebuild button (rebuildCache) to force the NEXT
   *  composition-bake to run FRESH (`?bust=1`) regardless of bakeNonce. A
   *  rebuild is, by the user's mental model, a real bake — so the yellow
   *  "fresh · N ms" badge must show, never the green "✓ cached". `bakeNonce > 1`
   *  alone is unreliable: after a cold load bakeNonce can still be 0 (the
   *  initial bake fires before any nonce bump), so the first Rebuild only
   *  reaches 1 → `1 > 1` is false → it cache-HITS the entry the canvas's own
   *  rebuild(true) just re-wrote → badge wrongly reads "cached". Plain (non-
   *  reactive) so consuming it inside the bake effect can't loop the effect. */
  let manualBustPending = false;
  /** Tracks whether the source the user is LOOKING AT has changed since
   *  the bake panel last rendered geometry. Shown as a small "stale" badge
   *  next to the Bake button so the user knows there's a pending change. */
  let bakeStale = $derived(
    typeof bake === 'object' && bake && bake.source !== undefined && bake.source !== emittedForRender.source,
  );
  /** Auto-bake mode — defaults ON with a long debounce so slider scrubs
   *  don't fire intermediate bakes. Press Enter in any input to force-
   *  bake immediately (skips the debounce). The 🔨 Bake button always
   *  bakes regardless of the toggle. Persisted to localStorage. */
  let autoBake = $state(true);
  /** Suppress the first-render bake until the URL hydrate has settled,
   *  so we don't bake the empty default graph before redirecting state. */
  let firstBakeDone = false;
  onMount(() => {
    try {
      // Default to ON unless the user explicitly disabled it.
      const v = localStorage.getItem('ge-auto-bake');
      autoBake = v === null ? true : v === '1';
    } catch { /* localStorage blocked */ }
  });
  function setAutoBake(v: boolean) {
    autoBake = v;
    try { localStorage.setItem('ge-auto-bake', v ? '1' : '0'); } catch { /* ignore */ }
    if (v) {
      bakeNonce++; // re-bake when flipping ON
    } else {
      // Cancel any pending debounced auto-bake so toggling OFF actually
      // STOPS the next bake from firing — the $effect below early-bailed
      // on `!autoBake` without clearing the timer, so a bake set 600 ms
      // before the toggle would still land 100 ms after. (#115)
      clearTimeout(autoBakeTimer);
    }
  }
  /** Per-card ghost set — Call cards (and any node) flagged with the eye
   *  icon get their emitted Manifold APPENDED to the return list, so the
   *  bake renders them alongside the normal result. Useful for eyeballing
   *  the volume that a subtract is removing (toggle the cutter card on,
   *  see its body sitting inside the void it carved). Lives in editor
   *  state only; saved files are never affected. */
  let ghostSet = $state<Record<string, boolean>>({});
  let ghostIds = $derived(Object.keys(ghostSet).filter((id) => ghostSet[id]));
  function toggleNodeGhost(id: string) {
    ghostSet = { ...ghostSet, [id]: !ghostSet[id] };
    bakeNonce++;
  }
  function clearAllGhosts() {
    ghostSet = {};
    bakeNonce++;
  }
  /** Canvas-settings popover (anchored to the ⚙ button on the vertical
   *  rail). Holds layout tools (auto-layout, push apart) that don't need
   *  to be one-click from the rail — and future view/nav controls. */
  let canvasMenuOpen = $state(false);
  /** Ref to the ⚙ button so we can position the popover next to ITS
   *  bounding rect instead of a hardcoded `top: 220px` (which drifted
   *  as buttons came and went above it — ghost-clear, undo, etc.). */
  let settingsBtnEl = $state<HTMLButtonElement | null>(null);
  let canvasMenuPos = $state<{ left: number; top: number }>({ left: 56, top: 220 });
  function openCanvasMenu() {
    if (settingsBtnEl) {
      const r = settingsBtnEl.getBoundingClientRect();
      // Anchor to the right of the rail button; align top of menu with
      // top of button. `position: fixed` so it lives in viewport space
      // and we don't have to chase a positioned ancestor.
      canvasMenuPos = { left: r.right + 6, top: r.top };
    }
    canvasMenuOpen = true;
  }
  /** ✨ AI-generate popover (RAG Phase 2) — anchored to the rail button
   *  like the ⚙ canvas menu. The prompt/busy/error/candidate state + the
   *  generate fetch live in AiMenu.svelte; GEP owns only the open + anchor. */
  let aiMenuOpen = $state(false);
  let aiBtnEl = $state<HTMLButtonElement | null>(null);
  let aiMenuPos = $state<{ left: number; top: number }>({ left: 56, top: 120 });
  function openAiMenu() {
    if (aiBtnEl) {
      const r = aiBtnEl.getBoundingClientRect();
      aiMenuPos = { left: r.right + 6, top: r.top };
    }
    // The ✨ button is at the BOTTOM of the rail, so the popover may spill
    // below the viewport — AiMenu clamps its own top on mount.
    aiMenuOpen = true;
  }
  /** AiMenu success handler — hydrate the proposed graph INTO the CURRENT tab
   *  (in place); the user generates from the open editor and the changes land
   *  HERE, not in a new tab (2026-06-12). Auto-layout since a generated graph
   *  carries no saved positions; set exemplarId so the first Save lands under
   *  the suggested name. THROWS on a bad graph so AiMenu can surface the error
   *  + keep its panel open. */
  function handleAiGenerated(id: string, rawGraph: any, candidates: string[]) {
    graph = autoLayoutGraph(hydrateGraph(rawGraph));
    const gid = String(id || '').trim();
    if (/^[a-z_][a-z0-9_]*$/i.test(gid)) exemplarId = gid;
    // Notify the parent so it can rename the active tab's label (it must NOT
    // open a new tab — props.id only seeds on mount, so updating it is a safe
    // relabel, not a remount).
    props.onGenerated?.(exemplarId, rawGraph, candidates);
  }

  /** Canvas-edge boundary toggles (#116). Each edge cycles
   *    off → repellant → confiner → off
   *  Repellant = a thin tall virtual obstacle just outside the canvas edge,
   *  fed into forceSeparate.obstacles → pushes nodes AWAY from that edge.
   *  Confiner = forceSeparate.confinerBounds → clamps nodes INSIDE the
   *  visible region on each iteration. Persisted to localStorage so the
   *  user's choice survives across reloads. */
  /** Simplified to boolean: 'off' | 'repellant'. The tri-state cycle
   *  (off → repellant → confiner → off) was reachable only via the
   *  small circular edge buttons (🔒 / 🔺 / ⏹) pinned to the canvas
   *  edges; those buttons were removed (redundant with the ⚙ menu
   *  checkboxes). Legacy 'confiner' values in localStorage are
   *  treated as 'off' on read so users with an old persisted state
   *  don't get a stuck confiner with no UI to clear it. */
  type BoundState = 'off' | 'repellant';
  let boundLeft = $state<BoundState>('off');
  let boundRight = $state<BoundState>('off');
  /** Top edge boundary — push-apart pushes nodes DOWN from the top.
   *  Without it, cards drift off the top of the visible canvas (the
   *  PARAMS dock + the tab strip end up obscuring them). Default ON
   *  for new sessions because the top edge is far more annoying than
   *  the left/right to push nodes off-screen. */
  let boundTop = $state<BoundState>('repellant');
  onMount(() => {
    try {
      const l = localStorage.getItem('ge-bound-left');
      if (l === 'repellant') boundLeft = 'repellant';
      const r = localStorage.getItem('ge-bound-right');
      if (r === 'repellant') boundRight = 'repellant';
      const t = localStorage.getItem('ge-bound-top');
      // Explicit 'off' (user turned it off) wins over the default 'repellant'.
      if (t === 'off') boundTop = 'off';
      else if (t === 'repellant') boundTop = 'repellant';
    } catch { /* localStorage blocked — fine */ }
  });
  /** Set + persist a canvas-edge boundary. Called by CanvasMenu's checkboxes;
   *  the bound* state stays here because pushApart reads it. */
  function setBound(edge: 'left' | 'top' | 'right', v: BoundState) {
    if (edge === 'left') boundLeft = v;
    else if (edge === 'top') boundTop = v;
    else boundRight = v;
    try { localStorage.setItem(`ge-bound-${edge}`, v); } catch { /* ignore */ }
  }
  /** Run a bake now. Called by the 🔨 Bake button + initial-load + nonce
   *  bumps. Reads the current emitted source so manual bakes always
   *  reflect the latest graph state. */
  function runBake() {
    bakeNonce++;
  }
  /** Window-level Enter handler — when the user presses Enter while
   *  focused on any input/textarea inside the editor, trigger a bake.
   *  Lets the user scrub a value, hit Enter, see the new render — no
   *  click required. Skipped for IME composition + modifier keys (those
   *  are reserved for shortcuts elsewhere). */
  function onWindowKeydown(ev: KeyboardEvent) {
    if (ev.key === 'Escape' && (polyUI.polyDeleteMode || polyUI.polyInsertMode)) {
      polyUI.polyDeleteMode = false; polyUI.polyInsertMode = false;
      return;
    }
    if (ev.key === 'Escape' && wire.from) {
      wire.from = null; wire.mouse = null; wire.justArmed = false;
      return;
    }
    if (ev.key === 'Escape' && sketch.selectedSplineOpIdx != null) {
      sketch.selectedSplineOpIdx = null;
      return;
    }
    if (ev.key !== 'Enter') return;
    if (ev.isComposing) return;
    if (ev.shiftKey || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const target = ev.target as HTMLElement | null;
    if (!target) return;
    const tag = target.tagName;
    // Only fire on text-like editing surfaces — buttons / canvas / etc.
    // shouldn't capture Enter for re-bake.
    if (tag !== 'INPUT' && tag !== 'TEXTAREA') return;
    // multi-line editors (the imperative loop body) opt out: Enter = newline,
    // and they push to the canvas via their own ✓ tick, not a global re-bake.
    if (target.hasAttribute('data-enter-newline')) return;
    ev.preventDefault();
    if (target.tagName === 'INPUT') (target as HTMLInputElement).blur();
    runBake();
  }
  onMount(() => {
    window.addEventListener('keydown', onWindowKeydown);
    try { wire.isCoarse = window.matchMedia('(pointer: coarse)').matches; } catch { /* SSR/off */ }
    return () => window.removeEventListener('keydown', onWindowKeydown);
  });
  // ─── Global dark tooltip ────────────────────────────────────────────────
  // Replaces the native browser tooltip (slow + unstyled) with a single
  // floating black-bg-white-text bubble that follows the cursor. Picks up:
  //   * any element with a `data-tip="..."` attribute (preferred)
  //   * any element with a native `title` attribute (the `title` is hoisted
  //     to `data-tip` on first hover so the browser doesn't show its own
  //     yellow bubble alongside ours)
  // Both work with the new resize grip + every existing tooltip in the
  // editor without per-element changes.
  onMount(() => {
    if (typeof document === 'undefined') return;
    let tipEl: HTMLDivElement | null = null;
    let activeTarget: HTMLElement | null = null;
    function ensureTip() {
      if (tipEl) return tipEl;
      tipEl = document.createElement('div');
      tipEl.className = 'ge-floating-tip';
      tipEl.style.cssText = [
        'position: fixed',
        'background: #111827',
        'color: #f9fafb',
        'font: 11px Arial',
        'padding: 4px 8px',
        'border-radius: 4px',
        'pointer-events: none',
        'z-index: 9999',
        'max-width: 280px',
        'white-space: pre-line',
        'box-shadow: 0 2px 6px rgba(0,0,0,0.25)',
        'opacity: 0',
        'transition: opacity 90ms',
      ].join(';');
      document.body.appendChild(tipEl);
      return tipEl;
    }
    function show(target: HTMLElement, text: string) {
      activeTarget = target;
      const tip = ensureTip();
      tip.textContent = text;
      tip.style.opacity = '1';
    }
    function hide() {
      activeTarget = null;
      if (tipEl) tipEl.style.opacity = '0';
    }
    function onOver(ev: MouseEvent) {
      let el = ev.target as HTMLElement | null;
      while (el && el !== document.body) {
        const dt = el.getAttribute?.('data-tip');
        const t  = !dt && el.getAttribute?.('title');
        if (dt || t) {
          if (t) {
            // Hoist native title to data-tip so the browser stops
            // rendering its own yellow rectangle.
            el.setAttribute('data-tip', t);
            el.removeAttribute('title');
          }
          show(el, dt ?? t ?? '');
          return;
        }
        el = el.parentElement;
      }
      hide();
    }
    function onMove(ev: MouseEvent) {
      if (!activeTarget || !tipEl) return;
      // Track the cursor at a small offset; the tip clamps to the viewport.
      const offsetX = 14;
      const offsetY = 18;
      const x = Math.min(window.innerWidth - tipEl.offsetWidth - 8, ev.clientX + offsetX);
      const y = Math.min(window.innerHeight - tipEl.offsetHeight - 8, ev.clientY + offsetY);
      tipEl.style.left = `${x}px`;
      tipEl.style.top  = `${y}px`;
    }
    function onOut(ev: MouseEvent) {
      // Only hide when leaving the active target completely.
      const rel = (ev as any).relatedTarget as HTMLElement | null;
      if (!activeTarget) return;
      if (rel && activeTarget.contains(rel)) return;
      hide();
    }
    // A tap/click anywhere dismisses the tip (touch shows it on tap but never
    // fires a mouseout, so it would otherwise stick).
    function onDown(ev: Event) {
      if (activeTarget && !activeTarget.contains(ev.target as Node)) hide();
    }
    document.addEventListener('mouseover', onOver);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseout', onOut);
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('scroll', hide, true);
    return () => {
      document.removeEventListener('mouseover', onOver);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseout', onOut);
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('scroll', hide, true);
      tipEl?.remove();
      tipEl = null;
    };
  });
  $effect(() => {
    // Track bakeNonce + the FIRST-load condition (any visible node + no
    // prior bake). Subsequent graph changes don't fire here — they go
    // through the debounced auto-bake effect below.
    bakeNonce;
    // Profile mode usually skips the part-bake pipeline (the right-pane
    // 2D preview renders from `profilePts` resolved via /resolve). BUT
    // when the profile graph contains a solid-producer (r_revolve or
    // r_weld_extrude), the output is a Manifold and we route through
    // the part bake pipeline (/preview) so the right pane gets a 3D
    // mesh. The 2D-vs-3D switch is driven by `hasSolidProducer` below.
    // Polygon-only graphs (no solid producer) skip the part-bake — the
    // right pane shows the inline 2D SVG instead. CRITICAL: don't set
    // firstBakeDone here. Tab-open sequence is:
    //   1. graph starts empty  -> !hasSolidProducer  -> this branch
    //   2. load hydrates graph -> hasSolidProducer flips true
    // If step 1 sets firstBakeDone=true, step 2's main-bake fall-through
    // sees the guard `if (firstBakeDone && bakeNonce === 0) return` and
    // BLOCKS the initial bake. Leaving firstBakeDone alone here lets the
    // bake fire once the real graph appears, even with autoBake OFF.
    if (!hasSolidProducer) {
      bake = null; return;
    }
    const hasNode = Object.values(graph.nodes).some((n) => n.type !== 'list' || n.children.length > 0);
    if (!hasNode) { bake = null; firstBakeDone = false; return; }
    // Initial-load case: graph hydrated, no bake yet → fire one bake.
    // Otherwise wait for bakeNonce changes (manual Bake / Enter / Rebuild).
    if (firstBakeDone && bakeNonce === 0) return;
    bake = 'loading';
    clearTimeout(bakeTimer);
    bakeTimer = setTimeout(async () => {
      // Consume the manual-rebuild flag at the instant the bake fires so an
      // explicit 🔄 Rebuild ALWAYS busts (fresh), while normal edits/auto-bakes
      // keep the `bakeNonce > 1` heuristic (and legitimately show "cached" on
      // a real cache hit). Read+reset is non-reactive → no effect re-fire.
      const forceBust = manualBustPending;
      manualBustPending = false;
      const r = await bakeGraphPreview(graph, { id: exemplarId, bust: bakeNonce > 1 || forceBust, ghosts: ghostIds });
      // A manual 🔄 Rebuild is FRESH by definition — the server re-baked
      // (bust=1). Pin cached:false on the stored result so the badge shows the
      // yellow "fresh · N ms", never green "✓ cached", even if a later
      // server/response nuance reports otherwise. (User-reported: badge stuck
      // on "cached" after rebuild though the bake genuinely re-ran.)
      if (forceBust && r.ok) (r as any).cached = false;
      // Hand the canvas the EXACT same source the bake just ran on (the
      // ghost-flag aware emit) so its own /preview re-fetch returns the
      // same mesh — otherwise the cuboids get baked once + immediately
      // thrown away by the canvas's no-ghost re-bake. Capture `args` at the
      // SAME instant for the SAME reason: `source` and the positional arg
      // array MUST stay consistent. Reading args live in the template lets a
      // param add/delete change the arg COUNT a frame before the re-emitted
      // source catches up — the canvas then bakes the old N-param source with
      // N±1 args, so a trailing param resolves to `undefined` → NaN geometry
      // → a degenerate mesh that corrupts the shared camera-fit and blanks the
      // 3D until reload. Pairing them here makes every (source, args) the
      // canvas sees a matched set.
      bake = {
        ok: r.ok,
        source: emittedForRender.source,
        args: Object.values(graph.params).map((p) => p.default),
        bake: r,
        message: r.message as string | undefined,
      };
      firstBakeDone = true;
    }, 250);
  });
  /** Trigger a single initial bake once the graph has nodes — kicks off
   *  from the URL-load path so loading dt_stand renders without waiting
   *  for the user to click Bake. */
  $effect(() => {
    const hasNode = Object.values(graph.nodes).some((n) => n.type !== 'list' || n.children.length > 0);
    if (hasNode && !firstBakeDone && bake !== 'loading') {
      bakeNonce++;
    }
  });
  // Auto-bake with a LONG debounce when source changes. The window is
  // 700 ms — long enough that slider scrubs don't fire intermediate
  // bakes, short enough that you don't feel sluggish after stopping.
  // Enter in any input force-fires immediately (see onWindowKeydown).
  let autoBakeTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    emittedForRender.source; // track — also catches ghostIds changes
    if (!autoBake) {
      // Don't just skip — actively cancel anything that was scheduled
      // while we were on. Without this, flipping the toggle off lets
      // the last pending bake leak through 700 ms later.
      clearTimeout(autoBakeTimer);
      return;
    }
    if (!firstBakeDone) return;
    clearTimeout(autoBakeTimer);
    autoBakeTimer = setTimeout(() => { bakeNonce++; }, 700);
  });

  // ─── Lazy cutaway load ──────────────────────────────────────────────────
  // When the bake auto-skips the cutaway (big Repeat × N, > 15k tris), the
  // bake panel surfaces "cutaway off (perf)" with a "Load" button. Click
  // re-bakes with cutaway:true (forced) and merges the new cutVC into the
  // bake state so the scene's cutaway toggle starts showing actual geometry.
  // This is the "first load, then cut" pattern.
  let cutawayBusy = $state(false);
  let cutawayStatus = $state<string | null>(null);
  async function loadCutaway() {
    if (cutawayBusy) return;
    if (typeof bake !== 'object' || !bake || !bake.source) return;
    cutawayBusy = true;
    cutawayStatus = '🔄 baking cutaway…';
    try {
      const params = Object.values(graph.params).map((p) => p.default);
      const r = await fetch('/api/primitives/preview?bust=1', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          source: bake.source,
          name: exemplarId,
          params,
          cutaway: true,
        }),
      });
      if (!r.ok) {
        cutawayStatus = `✗ ${r.status}: ${(await r.text()).slice(0, 140)}`;
        cutawayBusy = false;
        return;
      }
      const data = await r.json();
      // Merge cutVC + clear the skip flag in-place so the badge disappears.
      const cur = (bake as any).bake ?? {};
      cur.cutVC = data.cutVC;
      cur.cutawaySkipped = false;
      cur.cached = data.cached;
      cur.cacheHash = data.cacheHash;
      bake = { ...(bake as any) };
      cutawayStatus = `✓ cutaway baked (${Object.keys(data._t ?? {}).length ? Math.round(Object.values(data._t).reduce((a: number, b: any) => a + (Number(b) || 0), 0)) : '?'} ms)`;
      setTimeout(() => { cutawayStatus = null; cutawayBusy = false; }, 2000);
    } catch (e: any) {
      cutawayStatus = `✗ ${e?.message ?? String(e)}`;
      cutawayBusy = false;
    }
  }

  // 🔄 Rebuild this part's cache + re-bake (Phase 1.5 of bake-cache.md).
  // Wipes cache/<exemplarId>/ then bumps the bake nonce to force a fresh
  // /api/primitives/preview that repopulates the cache on the cold path.
  let rebuildBusy = $state(false);
  let rebuildStatus = $state<string | null>(null);
  async function rebuildCache() {
    if (rebuildBusy) return;
    rebuildBusy = true;
    rebuildStatus = '🔄 clearing cache…';
    try {
      const r = await fetch(`/api/cache/clear?id=${encodeURIComponent(exemplarId)}`, { method: 'POST' });
      const d = await r.json();
      if (d.ok) rebuildStatus = `✓ cleared ${d.cleared} · re-baking…`;
      else      rebuildStatus = `⚠ ${d.error ?? 'clear failed'}`;
      // Force the composition-bake (the badge's data source) to run FRESH on
      // this explicit Rebuild — independent of bakeNonce, and immune to the
      // canvas's own rebuild(true) having just re-populated the server cache.
      manualBustPending = true;
      bakeNonce++;
      setTimeout(() => { rebuildStatus = null; rebuildBusy = false; }, 2000);
    } catch (e: any) {
      rebuildStatus = `✗ ${e?.message ?? String(e)}`;
      rebuildBusy = false;
    }
  }

  /** Set when a URL `?id=<name>` is given but the loaded source has no
   *  meta.graph (legacy text-format assembly OR a leaf primitive). The
   *  canvas stays empty + a banner surfaces above the source pane explaining
   *  why. The user can still Save a NEW graph alongside the legacy file —
   *  but we don't fight the user with auto-translation. */
  let legacyLoad = $state<{ id: string; reason: 'no-graph' | 'fetch-failed' } | null>(null);
  onMount(async () => {
    // (PrimitiveDualCanvas lazy import moved into RightPane.svelte — P5/G5.)

    // Id load: when the `id` prop is set, fetch the part's source from the
    // volume + hydrate meta.graph into the canvas. If the source is missing
    // or has no meta.graph, we surface a banner instead of fabricating state.
    //
    // graph extraction: we look at `data.graph` (preferred — the server
    // extracts it via extractMetaFromSource) BUT fall back to a client-side
    // brace-walking parser on `data.source` so the load path works against
    // a prod endpoint that hasn't been redeployed with the graph field yet.
    // Seeded graph (RAG Phase 2) — an AI-proposed graph passed in directly
    // by the parent. Hydrate it instead of fetching by id: the part does
    // not exist on the volume yet; the user reviews/tweaks and the first
    // Save creates it. Auto-layout always (a generated graph has no saved
    // card positions).
    if (props.seedGraph && typeof props.seedGraph === 'object') {
      try {
        graph = autoLayoutGraph(hydrateGraph(props.seedGraph));
        return;
      } catch (e) {
        console.warn('[graph-editor] seedGraph failed to hydrate', e);
        // fall through to the id-load path (which will banner on 404)
      }
    }

    try {
      const id = props.id ?? null;
      if (id && /^[a-z_][a-z0-9_]*$/i.test(id)) {
        const r = await fetch(`/api/primitives/source?name=${encodeURIComponent(id)}`);
        if (!r.ok) { legacyLoad = { id, reason: 'fetch-failed' }; exemplarId = id; return; }
        const d = await r.json();
        // Capture optional profile-shape hints from the loaded meta. These
        // populate the 2D-resolve effect when the loaded graph is polygon-
        // only. A part graph doesn't surface these fields — the effect
        // short-circuits via hasSolidProducer anyway.
        if (d.set === 'cartesian' || d.set === 'revolve') {
          profileSet = d.set;
        }
        profileMetaParams = d.params ?? {};
        profileSource = String(d.source ?? '');
        exemplarId = id;
        // Pull the drawing-descriptor markdown out of the saved meta if
        // present. Falls back to extracting from the source string for
        // older endpoints that don't surface every meta field.
        const md = d.drawingMd ?? d.draw_md ?? extractDrawingMdFromSource(d.source ?? '');
        if (typeof md === 'string') drawingMd = md;
        const graphJson = d.graph ?? extractGraphFromSource(d.source ?? '');
        if (graphJson && typeof graphJson === 'object') {
          graph = hydrateGraph(graphJson);
          // A — auto-layout on first load. When a freshly-translated part
          // (e.g. dt_stand, dt_joint) lands without saved layout entries
          // for its node cards, the visible nodes pile at the default-grid
          // position. Run autoLayoutGraph once so the user arrives at an
          // arranged canvas. Skip when the file HAS saved positions
          // (= the user already arranged + saved; respect their layout).
          const visibleIds = Object.values(graph.nodes)
            .filter((n) => !isInlineWrapper(n.id) && n.id !== graph.root)
            .map((n) => n.id);
          const savedCount = visibleIds.filter((id) => !!graphJson.layout?.[id]).length;
          if (visibleIds.length > 0 && savedCount === 0) {
            graph = autoLayoutGraph(graph);
          }
          // Restore canvas viewport — pan + zoom were captured at save time.
          if (graph.viewport) {
            pan = { ...graph.viewport.pan };
            zoom = graph.viewport.zoom;
          }
          exemplarId = id;
        } else {
          legacyLoad = { id, reason: 'no-graph' };
          exemplarId = id;
          // Banner lives in the source tab — auto-switch so the explanation
          // is visible by default rather than hidden behind the bake tab.
          rightTab = 'source';
        }
      }
    } catch { /* URL parse / network failures are non-fatal */ }
  });

  // extractGraphFromSource / extractDrawingMdFromSource → graph-editor-bake.svelte.ts (Phase B).

  // ─── canvas state — pan + zoom ─────────────────────────────────────────
  let pan = $state({ x: 0, y: 0 });
  let zoom = $state(1);
  let canvasEl: SVGSVGElement | undefined = $state();
  /** Pan the canvas so a given node id is centered in the viewport — used
   *  by the broken-reference banner chips to scroll a deleted-ref node into
   *  view. No-op when the node has no layout entry (legacy graphs). */
  function panToNode(id: NodeId) {
    const pos = graph.layout[id];
    if (!pos || !canvasEl) return;
    const rect = canvasEl.getBoundingClientRect();
    pan = {
      x: rect.width / 2 - pos.x * zoom,
      y: rect.height / 2 - pos.y * zoom,
    };
  }
  let panning = false; let panStart = { x: 0, y: 0 }; let panOrig = { x: 0, y: 0 };
  function onCanvasPointerDown(ev: PointerEvent) {
    // Middle button + Shift ALWAYS pan, even over content (power-user handle).
    // Plain left-click pans ONLY when the target is the canvas background —
    // the SVG itself or the grid rect. Any other target (a button, an input,
    // a node body) gets its own handler — pointerdown bubbles up to the
    // canvas but we DON'T capture/pan when the click was meant for a child.
    const isShortcut = ev.button === 1 || ev.shiftKey;
    const target = ev.target as Element;
    const isBackground =
      target === canvasEl ||
      (target.tagName.toLowerCase() === 'rect' && (target.getAttribute('fill') ?? '').includes('grid'));
    if (isShortcut || (ev.button === 0 && isBackground)) {
      panning = true; panStart = { x: ev.clientX, y: ev.clientY }; panOrig = { ...pan };
      canvasEl?.setPointerCapture(ev.pointerId);
      ev.preventDefault();
    }
  }
  function onCanvasPointerMove(ev: PointerEvent) {
    if (panning) {
      pan = { x: panOrig.x + (ev.clientX - panStart.x), y: panOrig.y + (ev.clientY - panStart.y) };
    }
    if (wire.from) {
      if (!wire.pointerMoved) {
        const dx = ev.clientX - wire.downAt.x, dy = ev.clientY - wire.downAt.y;
        if (dx * dx + dy * dy > 36) wire.pointerMoved = true; // moved >6px ⇒ a drag, not a tap
      }
      const pt = clientToGraph(ev.clientX, ev.clientY);
      wire.mouse = pt;
    }
  }
  function onCanvasPointerUp(ev: PointerEvent) {
    if (panning) { panning = false; canvasEl?.releasePointerCapture(ev.pointerId); }
    if (wire.from) {
      // Tap-to-connect: a no-drag tap that just ARMED the wire stays armed so
      // the NEXT tap on a target socket completes it (touch + connect-mode).
      // Any other release — a drag that missed its target, or a tap on empty
      // canvas while already armed — cancels the in-flight wire.
      if (wire.tapConnect && wire.justArmed && !wire.pointerMoved) {
        wire.justArmed = false; // consume; the wire is now parked, waiting for a target tap
      } else {
        wire.from = null; wire.mouse = null; wire.justArmed = false;
      }
    }
  }
  function onCanvasWheel(ev: WheelEvent) {
    ev.preventDefault();
    const k = Math.exp(-ev.deltaY * 0.001);
    zoom = Math.max(0.2, Math.min(3, zoom * k));
  }

  // ─── drag-from-sidebar drop target (#161, 2026-06-11) ─────────────────
  /** When a sidebar primitive row is being dragged over the canvas, this
   *  flips true so the SVG gets a dashed highlight + cursor:copy. Cleared
   *  on dragleave / drop / drag end. */
  let dragOverActive = $state<boolean>(false);
  /** Convert a client (screen) coord to graph (canvas) coord by inverting
   *  the SVG's current pan + zoom. Used so the dropped Call lands where
   *  the cursor was, not at a fixed default position. */
  function clientToCanvas(clientX: number, clientY: number): { x: number; y: number } {
    if (!canvasEl) return { x: 0, y: 0 };
    const r = canvasEl.getBoundingClientRect();
    return {
      x: (clientX - r.left - pan.x) / zoom,
      y: (clientY - r.top  - pan.y) / zoom,
    };
  }
  function onCanvasDragOver(ev: DragEvent) {
    if (!ev.dataTransfer) return;
    // Only react to OUR mime — other drags (HTML images etc.) pass through.
    const types = Array.from(ev.dataTransfer.types ?? []);
    if (!types.includes('application/x-cadtrain-prim')) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'copy';
    dragOverActive = true;
  }
  function onCanvasDragLeave(ev: DragEvent) {
    // Only clear when we actually LEAVE the SVG (not when crossing child
    // nodes inside it). relatedTarget null = left the document; check
    // containment otherwise.
    const rt = ev.relatedTarget as Node | null;
    if (rt && canvasEl && (canvasEl as Node).contains(rt)) return;
    dragOverActive = false;
  }
  async function onCanvasDrop(ev: DragEvent) {
    dragOverActive = false;
    if (!ev.dataTransfer) return;
    const src = ev.dataTransfer.getData('application/x-cadtrain-prim');
    if (!src) return;
    ev.preventDefault();
    // Drop position in graph coords; default seed for the new Call.
    const xy = clientToCanvas(ev.clientX, ev.clientY);
    // Pull the dragged part's meta so we can seed default args from
    // its params (same as the picker path uses).
    let args: Record<string, ArgValue> = {};
    try {
      const r = await fetch(`/api/primitives/source?name=${encodeURIComponent(src)}`);
      if (r.ok) {
        const data = await r.json();
        const params = (data?.params && typeof data.params === 'object') ? data.params : {};
        for (const [k, v] of Object.entries(params)) {
          const d = (v as any)?.default;
          args[k] = (typeof d === 'number' || typeof d === 'string' || typeof d === 'boolean')
            ? asLiteral(d as any)
            : asLiteral(0);
        }
      }
    } catch { /* network failure — drop with empty args, user can edit */ }
    const { graph: next, id: newId } = addCall(graph, src, args);
    // Replace the auto-position with the drop coords.
    graph = { ...next, layout: { ...next.layout, [newId]: xy } };
    bringToFront(newId);
  }

  // ─── drag-to-move node cards ────────────────────────────────────────────
  let dragging: string | null = null;
  let dragOrig = { x: 0, y: 0 }; let dragStart = { x: 0, y: 0 };
  // Tracks whether a node pointer-gesture actually MOVED — distinguishes a drag
  // from a click (pointerdown preventDefault suppresses the native click event,
  // so the CSG circle opens its popover on a no-move pointerup instead).
  let dragMoved = false;
  /** Z-order ordering of node ids — last one wins (renders ON TOP). When the
   *  user clicks a node, we move its id to the END of this array so it pops
   *  to the front. Nodes not in this list render BEFORE the listed ones,
   *  in their natural Object.values order (= insertion order). */
  let zOrder = $state<string[]>([]);
  function bringToFront(id: string) {
    // Filter out the id (idempotent if not in list), then append.
    zOrder = [...zOrder.filter((x) => x !== id), id];
  }
  function onNodePointerDown(ev: PointerEvent, id: string) {
    if (ev.button !== 0) return;
    // preventDefault stops the browser from ALSO starting a native text
    // selection on the card's foreignObject content — without it the drag
    // selects swathes of text AND the native selection-drag can swallow the
    // pointerup so the card "sticks" to the cursor (never releases).
    ev.preventDefault();
    bringToFront(id);
    dragging = id;
    dragMoved = false;
    dragStart = { x: ev.clientX, y: ev.clientY };
    dragOrig = graph.layout[id] ?? { x: 0, y: 0 };
    (ev.currentTarget as Element).setPointerCapture(ev.pointerId);
    ev.stopPropagation();
  }
  // rAF-coalesce the layout write: a pointermove fires up to ~120 Hz and each
  // `graph = setLayout(...)` re-renders every card/wire/bezier — on a dense graph
  // that exceeds the inter-event budget and the dragged card trails the cursor.
  // Stash the latest target and apply at most once per painted frame.
  let dragRaf = 0;
  let dragPending: { x: number; y: number; w?: number } | null = null;
  function flushDrag() {
    dragRaf = 0;
    if (!dragging || !dragPending) return;
    graph = setLayout(graph, dragging, dragPending);
  }
  function onNodePointerMove(ev: PointerEvent) {
    if (!dragging) return;
    const dx = (ev.clientX - dragStart.x) / zoom;
    const dy = (ev.clientY - dragStart.y) / zoom;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragMoved = true;
    // Preserve `w` so a position drag doesn't wipe out a previous resize.
    dragPending = { x: dragOrig.x + dx, y: dragOrig.y + dy, w: (dragOrig as any).w };
    if (!dragRaf) dragRaf = requestAnimationFrame(flushDrag);
  }
  function onNodePointerUp(ev: PointerEvent) {
    if (dragging) {
      const id = dragging;
      // Flush the final position so the card lands exactly where released.
      if (dragRaf) { cancelAnimationFrame(dragRaf); dragRaf = 0; }
      if (dragPending) { graph = setLayout(graph, dragging, dragPending); dragPending = null; }
      (ev.currentTarget as Element).releasePointerCapture(ev.pointerId);
      dragging = null;
      // A no-move tap on a compact CSG circle opens its action popover (the
      // native click is suppressed by pointerdown's preventDefault).
      if (!dragMoved) {
        const node = graph.nodes[id] as any;
        if (node?.type === 'method') popovers?.openCsgPop(ev, id, node.op);
      }
    }
  }

  // ─── Card resize (right-edge grip) ─────────────────────────────────────
  let resizing = $state<string | null>(null);
  let resizeStartX = 0;
  let resizeStartY = 0;
  let resizeOrigW = 0;
  let resizeOrigH = 0;
  function onResizePointerDown(ev: PointerEvent, id: string) {
    if (ev.button !== 0) return;
    resizing = id;
    resizeStartX = ev.clientX;
    resizeStartY = ev.clientY;
    const node = graph.nodes[id];
    if (!node) return;
    const sz = nodeSize(graph,node);
    resizeOrigW = sz.w;
    resizeOrigH = sz.h;
    (ev.currentTarget as Element).setPointerCapture(ev.pointerId);
    ev.stopPropagation();
    ev.preventDefault();
  }
  function onResizePointerMove(ev: PointerEvent) {
    if (!resizing) return;
    // Width AND height grow with horizontal + vertical drag (diagonal
    // resize). User chose the corner grip to enable both axes - the
    // polygon card uses height to control scrollable list area; other
    // cards ignore the height override (their nodeSize doesn't consult
    // layout.h) but the persistence is harmless.
    const dx = (ev.clientX - resizeStartX) / zoom;
    const dy = (ev.clientY - resizeStartY) / zoom;
    setCardSize(resizing, resizeOrigW + dx, resizeOrigH + dy);
  }
  function onResizePointerUp(ev: PointerEvent) {
    if (!resizing) return;
    (ev.currentTarget as Element).releasePointerCapture(ev.pointerId);
    resizing = null;
  }

  // ─── param chip positioning ─────────────────────────────────────────────
  // Chips are TACKED to the viewport top-left by default (📌). They render
  // OUTSIDE the pan/zoom transform — so when the user pans the canvas, the
  // chips stay where they are. This avoids the "ugly default-grid" problem
  // when you reload and your chips were arranged carefully on the canvas.
  // Position is purely derived from the chip's index in paramEntries.
  // Params card geometry. Outer card sits at (CARD_X0, CARD_Y0). The title
  // bar takes CARD_TITLE_H; chips fill the body below it. Each chip is
  // PARAM_W × PARAM_H, with PARAM_GAP between rows. The whole card is wide
  // enough to wrap the chip + padding; the socket sits OUTSIDE the card's
  // right edge so it can be drag-wired from.
  // CARD_X0 / CARD_PAD / CARD_TITLE_H are imported from $lib/cad/graph-editor-geom.
  // ─── Properties card (pinned ABOVE Params) ────────────────────────────────
  // A small viewport-glued card holding part-level z-offset / colour / material.
  // It sits at the very top-left (PROPS_X0, PROPS_Y0); the Params card is then
  // pushed DOWN by the Properties card's live height + a gap (see CARD_Y0).
  // Collapsible — when collapsed only its header shows and Params tucks right
  // under it.
  const PROPS_X0 = 8, PROPS_Y0 = 8, PROPS_W = 236;
  // Combined left card: ONE viewport-glued card with a tab header
  // (Params | Properties) pinned at (PROPS_X0, PROPS_Y0). The tab header is
  // TAB_HEADER_H tall; the ACTIVE tab's body renders directly below it. This
  // replaces the old stacked PROPERTIES-above-PARAMS layout to save vertical
  // space.
  const TAB_HEADER_H = 26;
  // Column layout: a single label row above a single control row (2 rows
  // tall, not 4 stacked rows). PROPS_BODY_H = label (14) + gap (4) + ctrl (22).
  const PROPS_BODY_H = 40;
  // Active left tab — persisted across reloads. REPLACES the old propsExpanded
  // collapse: the properties body shows whenever its tab is active.
  let leftTab = $state<'params' | 'properties'>('params');
  if (typeof localStorage !== 'undefined') {
    const saved = localStorage.getItem('ge-left-tab');
    if (saved === 'params' || saved === 'properties') leftTab = saved;
  }
  $effect(() => {
    if (typeof localStorage !== 'undefined') localStorage.setItem('ge-left-tab', leftTab);
  });
  // Properties-tab body height — grows with the per-part table (#13): a
  // z-offset row + table header + (Default + N parts) rows. Computed off the
  // Output's child count directly to avoid declaration-order coupling.
  const propsBodyH = $derived.by(() => {
    const nRows = partsForProps.length + 1; // + the "Default" row
    return 64 + nRows * 22 + CARD_PAD * 2 + 5;
  });
  // Params card top — pinned directly under the tab header. CONSTANT now (was
  // derived off the stacked Properties card): the param rows / output sockets /
  // param→arg wires ALL derive from CARD_Y0, so they follow this single source.
  const CARD_Y0 = PROPS_Y0 + TAB_HEADER_H;
  // PARAM_W is DYNAMIC — derived from the longest label so chips like
  // p.totalLen don't clip. Constants below are the FIXED footprint of the
  // pin + input + trash; the label slot expands to fit the longest name.
  // PARAM_W_MIN / PARAM_H / PARAM_GAP (+ the chip-footprint consts used by
  // chipWidthFor) are imported from $lib/cad/graph-editor-geom.
  // Live longest-label-len → live chip width. Updates as params are added
  // / renamed / deleted; the wire endpoints + socket positions all read
  // PARAM_W so they track the chip's growing/shrinking right edge.
  let PARAM_W = $derived.by(() => {
    const names = Object.keys(graph.params ?? {});
    if (names.length === 0) return PARAM_W_MIN;
    const longest = Math.max(...names.map((n) => ('p.' + n).length));
    return chipWidthFor(longest);
  });
  // stack_ref no longer renders as a chip (it lives in the Properties card),
  // so exclude it from the Params card row count.
  let pcs = $derived(paramCardSize(
    Object.keys(graph.params ?? {}).filter((n) => n !== STACK_REF_PARAM).length,
    PARAM_W,
  ));
  // ─── drag-to-wire ───────────────────────────────────────────────────────
  // The wire-drag state (from/mouse/justArmed/pointerMoved/downAt/wire.connectMode/
  // wire.isCoarse/wire.tapConnect) + every start*/endWireOn*/unwireTransformAxis handler
  // moved to wire-state.svelte.ts (Phase C) as the per-instance `wire` below.
  // GEP's canvas + sketch-stage pointer handlers read/write `wire.*`.
  // clientToGraph stays here (needs canvasEl/pan/zoom) and is handed to `wire`.
  function clientToGraph(cx: number, cy: number) {
    if (!canvasEl) return { x: cx, y: cy };
    const r = canvasEl.getBoundingClientRect();
    return { x: ((cx - r.left) - pan.x) / zoom, y: ((cy - r.top) - pan.y) / zoom };
  }
  const wire = new WireState(() => graph, (g) => { graph = g; }, clientToGraph);
  // Per-instance full-tab sketch editor state (Phase E). Shared home for the
  // sketch state referenced by BOTH the node-card arm and the full-tab editor.
  const sketch = new SketchState(() => graph, (g) => { graph = g; }, wire, () => pcs, () => PARAM_W);
  /** Names of the graph's params (PARAMS card) — the wireable `p.*` set. Shared
   *  by the main-graph param markup AND the sketch overlay. */
  const paramNames = $derived(Object.keys(graph.params ?? {}));

  // ─── Repeat windowed editor (#7) ─────────────────────────────────────────
  // Per-instance GEP-local state (each /primitives tab is its own GEP instance).
  // The Repeat card's ✎ opens a full-tab overlay (mirrors the sketch editor):
  // iterators top strip + two tabs (Loop body / Graphical modifiers).
  // The full overlay (state + deriveds + handlers) lives in RepeatEditorPane;
  // GEP keeps only the trigger (editingRepeatId + open/close, passed to NodeCard)
  // and `nodeShortLabel` (a NodeCard prop, also used to label the repeat card).
  let editingRepeatId = $state<string | null>(null);
  function openRepeatEditor(id: string) { editingRepeatId = id; }
  function closeRepeatEditor() { editingRepeatId = null; }
  /** Short label for a node, shown in the Repeat PARTS list (card + editor). */
  function nodeShortLabel(c: any): string {
    if (!c) return '(unwired)';
    return c.type === 'call' ? `${c.alias} · ${c.src}`
      : c.type === 'method' ? `${c.op}(…)`
      : c.type === 'repeat' ? `repeat × ${c.count?.kind === 'literal' ? c.count.value : '…'}`
      : c.type === 'sketch' ? '✐ sketch' : c.type;
  }
  // endWireOnInput / endWireOnCallArg / endWireOnPolygonCoord /
  // endWireOnPolyRepeatCount / endWireOnPolygonRepeatRef / endWireOnTransformAxis
  // / unwireTransformAxis → wire-state.svelte.ts (Phase C); called as `wire.*`.
  /** Card bounding boxes in graph space — used by `bezier()` to route
   *  wires AROUND non-endpoint cards instead of straight through them.
   *  Inline mv/rot wrappers (rendered as decorations on the parent Call,
   *  not as standalone cards) are filtered out. */
  let cardObstacles = $derived.by(() => {
    const out: { id: string; x: number; y: number; w: number; h: number }[] = [];
    for (const id of Object.keys(graph.nodes)) {
      const node = graph.nodes[id];
      if (!node) continue;
      if (isInlineWrapper(id)) continue;
      const pos = graph.layout[id];
      if (!pos) continue;
      const sz = nodeSize(graph,node);
      out.push({ id, x: pos.x, y: pos.y, w: sz.w, h: sz.h });
    }
    return out;
  });

  // Socket position helpers — match the node card geometries below.
  // Call card: 200×<auto>; output socket on right edge mid-card.
  // Method card: 180×100; sockets on left (obj at y+30, arg at y+70) + right (output y+50).
  // Mv/Rot card: 200×120; left (child y+40) + right (output y+60).
  // ─── Per-card user resize overrides ───────────────────────────────────
  /** Sets the user-override width on a card, clamped to the card's
   *  MINIMUM-content width (key column + input + actions + padding).
   *  Width round-trips through graph.layout[id].w so resize persists
   *  across Save → reload (T #111). */
  function setCardWidth(id: string, w: number) {
    const node = graph.nodes[id];
    if (!node) return;
    const min = cardMinWidth(node);
    const clamped = Math.max(min, Math.round(w));
    const cur = graph.layout[id] ?? { x: 0, y: 0 };
    graph = setLayout(graph, id, { ...cur, w: clamped });
  }
  /** Set both width AND height for a card. Height is honoured only by
   *  nodes that consult `layout[id].h` in their nodeSize override (today
   *  just polygon — its scrollable list expands with extra height). For
   *  cards that don't read .h, the value is still persisted (cheap) and
   *  becomes meaningful as soon as those cards opt into the read. */
  function setCardSize(id: string, w: number, h: number) {
    const node = graph.nodes[id];
    if (!node) return;
    const minW = cardMinWidth(node);
    const clampedW = Math.max(minW, Math.round(w));
    const clampedH = Math.max(80, Math.round(h));
    const cur = graph.layout[id] ?? { x: 0, y: 0 };
    graph = setLayout(graph, id, { ...cur, w: clampedW, h: clampedH });
  }
  // ─── Sketch op row geometry (mirrors the polygon pattern) ───────────────
  // Each line/spline op renders two STACKED sub-rows (r over z) like a polygon
  // vertex; fillet/chamfer is a single short row. SVG wire sockets sit at the
  // computed sub-row centres so params can be wired onto a coord.
  // sketchEntryH + sketchColLayout live in $lib/cad/sketch-layout (pure, tested).
  // All row/socket geometry delegates to sketchColLayout so the HTML rows and
  // SVG sockets share ONE column partition. `cols` defaults to 1 → byte-identical
  // to the legacy single-column walk (36 + Σ sketchEntryH(prior ops)).
  // endWireOnSketchCoord / endWireOnSketchPoint / endWireOnContainerSlot →
  // wire-state.svelte.ts (Phase C); called as `wire.*`.
  function nodePos(id: NodeId): { x: number; y: number } {
    return graph.layout[id] ?? { x: 0, y: 0 };
  }
  // ─── inline mv/rot transform STRIPS + socket positions ──────────────────
  // The strip geometry + socket/output position math (inlineXform*, nodeSize,
  // outputSocketAt / inputSocketAt / containerSlotInputAt, the STRIP_* consts)
  // now live in `$lib/cad/graph-editor-geom.ts` (pure, tested). They take
  // `graph` as their first argument; the render code below passes it in.

  // ─── picker — drops graph nodes (polygon, solids, ops, position) ────────
  let pickerOpen = $state(false);
  /** Nested-submenu state for the + picker. Parents (solids / ops /
   *  position / container) open a right-anchored flyout on hover or
   *  click. Hovering a different parent switches; hovering the Call
   *  rail or clicking outside the picker closes everything. */
  let submenuKey = $state<string | null>(null);
  let submenuTopY = $state<number>(0);
  function openSubmenu(ev: PointerEvent, key: string) {
    const target = ev.currentTarget as Element | null;
    const r = target?.getBoundingClientRect();
    if (r) submenuTopY = r.top;
    submenuKey = key;
  }
  /** Call (primitive) picker — its OWN popover, opened by a dedicated
   *  rail button. Cleaner logical separation: + drops structural graph
   *  nodes; this button drops a Call to a saved primitive. */
  let callPickerOpen = $state(false);
  let callPickerPos = $state<{ left: number; top: number }>({ left: 56, top: 110 });
  let callBtnEl = $state<HTMLButtonElement | null>(null);
  async function openCallPicker() {
    if (callBtnEl) {
      const r = callBtnEl.getBoundingClientRect();
      callPickerPos = { left: r.right + 6, top: r.top };
    }
    if (pickerSrcs.length === 0) {
      try {
        const r = await fetch('/api/primitives/list');
        const d = await r.json() as any;
        const completions = d.completions && typeof d.completions === 'object' ? d.completions : {};
        const flat = [
          ...(Array.isArray(d.basic)    ? d.basic    : []),
          ...(Array.isArray(d.stdlib)   ? d.stdlib   : []),
          ...(Array.isArray(d.stdstale) ? d.stdstale : []),
          ...Object.values(completions).flat(),
        ] as Array<{ id: string; source: string }>;
        const seen = new Set<string>();
        const meta: Record<string, { source: string }> = {};
        const ids: string[] = [];
        for (const e of flat) {
          if (!e?.id || seen.has(e.id)) continue;
          seen.add(e.id); ids.push(e.id); meta[e.id] = { source: e.source };
        }
        pickerSrcs = ids;
        pickerSrcMeta = meta;
      } catch { /* empty list — sidebar may still work */ }
    }
    callPickerOpen = true;
  }
  function closeCallPicker() { callPickerOpen = false; pickerFilter = ''; }
  let pickerSrcs = $state<string[]>([]);
  let pickerFilter = $state('');
  /** Anchor for the picker dropdown — same pattern as the ⚙ canvas-
   *  settings menu. We bind:this on the + rail button and read its
   *  getBoundingClientRect when opening so the picker sits flush
   *  next to it (not pinned at a hardcoded `top: 60px`). */
  let dropBtnEl = $state<HTMLButtonElement | null>(null);
  let pickerPos = $state<{ left: number; top: number }>({ left: 56, top: 60 });
  async function openPicker() {
    if (dropBtnEl) {
      const r = dropBtnEl.getBoundingClientRect();
      pickerPos = { left: r.right + 6, top: r.top };
    }
    pickerOpen = true;
    if (pickerSrcs.length === 0) {
      try {
        const r = await fetch('/api/primitives/list');
        const d = await r.json() as any;
        // completions is an OBJECT keyed by family ({drill_pipe: [...], packers: [...]}) —
        // flatten its values; basic + stdlib/stdstale + completions are arrays of {id, source, …}.
        // stdstale (origin) now carries only r_extrude (in stdlib/stale/; r_revolve was
        // promoted to active stdlib 2026-06-28, r_weld_extrude was always stdlib); INCLUDE them so r_extrude
        // are reachable as Calls in the picker (#105 surface step).
        const basicItems = Array.isArray(d.basic) ? d.basic : [];
        const stdlibItems = Array.isArray(d.stdlib) ? d.stdlib : [];
        const stdstaleItems = Array.isArray(d.stdstale) ? d.stdstale : [];
        const completionItems: any[] = d.completions && typeof d.completions === 'object'
          ? (Object.values(d.completions) as any[][]).flat()
          : [];
        const all = [...basicItems, ...stdlibItems, ...stdstaleItems, ...completionItems];
        // Stash {id, source} so the sort dropdown can group by source.
        const seen = new Set<string>();
        pickerSrcs = [];
        pickerSrcMeta = {};
        for (const p of all) {
          if (!p?.id || seen.has(p.id)) continue;
          seen.add(p.id);
          pickerSrcs.push(p.id);
          pickerSrcMeta[p.id] = { source: p.source ?? 'volume' };
        }
        // Stdlib glob-cache patch — Vite's `import.meta.glob('/stdlib/*.ts')`
        // caches the matched set at first module load; adding a NEW file to
        // src/lib/cad/stdlib/ doesn't refresh it without a server restart
        // (the source + bake endpoints still resolve it because they read
        // fs directly). Probe the source endpoint for a known stdlib id
        // here so a freshly-added primitive becomes pickable WITHOUT a
        // restart. Remove this once the glob's HMR story is solid.
        for (const id of ['r_cuboid']) {
          if (seen.has(id)) continue;
          try {
            const sr = await fetch(`/api/primitives/source?name=${encodeURIComponent(id)}`);
            if (sr.ok) {
              const sd = await sr.json() as any;
              if (sd?.source) {
                pickerSrcs.push(id);
                pickerSrcMeta[id] = { source: 'stdlib' };
                seen.add(id);
              }
            }
          } catch { /* skip — not resolvable */ }
        }
        pickerSrcs.sort();
      } catch { /* fall through */ }
    }
  }
  /** Per-id metadata (source: 'basic'|'stdlib'|'stdstale'|'volume') used
   *  by the picker's sort dropdown. Populated alongside pickerSrcs. */
  let pickerSrcMeta = $state<Record<string, { source: string }>>({});
  /** Sort mode for the +Drop picker primitive list. Persisted to
   *  localStorage so the user's pick survives across sessions.
   *    'name'   — A→Z (default)
   *    'recent' — recently used first (per localStorage 'ge-picker-recent')
   *    'source' — group by source: stdlib → basic → stdstale → completions */
  let pickerSort = $state<'name' | 'recent' | 'source'>('name');
  let pickerRecent = $state<string[]>([]);
  onMount(() => {
    try {
      const m = localStorage.getItem('ge-picker-sort');
      if (m === 'name' || m === 'recent' || m === 'source') pickerSort = m;
      const r = localStorage.getItem('ge-picker-recent');
      if (r) pickerRecent = JSON.parse(r) as string[];
    } catch { /* storage blocked */ }
  });
  function setPickerSort(m: 'name' | 'recent' | 'source') {
    pickerSort = m;
    try { localStorage.setItem('ge-picker-sort', m); } catch { /* ignore */ }
  }
  /** Track usage when a primitive is dropped — feeds the 'recent' sort. */
  function bumpRecent(id: string) {
    pickerRecent = [id, ...pickerRecent.filter((x) => x !== id)].slice(0, 30);
    try { localStorage.setItem('ge-picker-recent', JSON.stringify(pickerRecent)); } catch { /* ignore */ }
  }
  function closePicker() { pickerOpen = false; pickerFilter = ''; }
  async function dropCall(src: string) {
    closePicker();
    bumpRecent(src);
    let args: Record<string, any> = {};
    try {
      const r = await fetch(`/api/primitives/source?name=${encodeURIComponent(src)}`);
      const d = await r.json() as any;
      for (const [k, p] of Object.entries((d.params ?? {}) as Record<string, any>)) {
        // Profile-typed args (r_revolve / r_extrude) carry a {kind, params}
        // DESCRIPTOR as their default — not a number. Encode as an `expr`
        // ArgValue: emit injects the literal object syntax, the body's
        // resolveProfile(...) call inside the primitive collapses it to
        // points. The profile-picker chip in the Call card (#119) reads
        // the descriptor + offers a kind swap; absent the picker the user
        // can still hand-edit the JSON in the ƒ popup.
        if (p && typeof p === 'object' && p.type === 'profile' && p.default && typeof p.default === 'object') {
          args[k] = asExpr(JSON.stringify(p.default));
        } else {
          args[k] = asLiteral(p?.default ?? 0);
        }
      }
      // Cache expected params (keys/defaults/profile set) for drift detection —
      // same fetch we just did; shared singleton in graph-editor-bake.svelte.ts.
      ingestMeta(src, d.params ?? {});
    } catch { /* leave args empty */ }
    const result = addCall(graph, src, args);
    graph = result.graph;
  }

  // loadExpectedParamsFor / isCallDrifted / refreshCallArgs → graph-editor-bake.svelte.ts
  // (Phase B). isCallDrifted/refreshCallArgs now take `graph`; markup passes it.

  // Whenever the graph changes, fetch expected params for any new src.
  $effect(() => {
    const srcs = new Set<string>();
    for (const n of Object.values(graph.nodes)) {
      if (n.type === 'call') srcs.add(n.src);
    }
    for (const src of srcs) loadExpectedParamsFor(src);
  });

  // ─── Resizable 2-pane divider ──────────────────────────────────────────
  // The editor's main area is split canvas | (bake/source tabs). Default
  // ratio is canvas 76 % / right 24 %, giving the node graph more room and a
  // narrower 3D-preview pane (was 70/30). Persisted as client state
  // (localStorage) so the user's preferred split survives reloads without
  // bloating meta.graph. (Storage key bumped to -v3 when the default changed
  // so existing users pick up the narrower preview.)
  let splitA = $state(56);          // canvas pane % — 3D preview gets the rest (~44%, prominent)
  let gridEl: HTMLElement | undefined = $state();
  let splitDragging = false;
  /** Right-pane tab: 3D bake or live source. RightPane owns persistence
   *  (localStorage `ge-right-tab`) + setRightTab; this stays as the bound
   *  value so the legacy-load path below can force it to 'source'. */
  let rightTab = $state<'bake' | 'source' | 'md' | 'svg' | 'glb' | 'brep'>('bake');
  onMount(() => {
    try {
      const a = Number(localStorage.getItem('ge-splitA-v4'));
      if (a >= 30 && a <= 85) splitA = a;
    } catch { /* localStorage blocked — fine */ }
  });
  function startSplitDrag(ev: PointerEvent) {
    if (ev.button !== 0) return;
    splitDragging = true;
    (ev.currentTarget as Element).setPointerCapture(ev.pointerId);
    ev.preventDefault();
  }
  function onSplitMove(ev: PointerEvent) {
    if (!splitDragging || !gridEl) return;
    const r = gridEl.getBoundingClientRect();
    const pct = ((ev.clientX - r.left) / r.width) * 100;
    splitA = Math.max(30, Math.min(85, pct));
  }
  function endSplitDrag(ev: PointerEvent) {
    if (!splitDragging) return;
    (ev.currentTarget as Element).releasePointerCapture(ev.pointerId);
    splitDragging = false;
    try { localStorage.setItem('ge-splitA-v4', String(splitA)); } catch { /* ignore */ }
  }

  // (BREP brepMeta/brepParamValues + SVG PrimitiveSvgView/svgMeshJson/svgRes +
  //  the SVG-bake $effect moved into RightPane.svelte — P5/G5.)

  // Draft mode for the 3D-bake live mesh (coarse 64-seg → fast iteration on big
  // stacks). View-only; persisted. Off by default (full fidelity).
  let meshDraft = $state(false);
  onMount(() => {
    try { meshDraft = localStorage.getItem('ge-mesh-draft') === '1'; } catch { /* ignore */ }
  });
  $effect(() => { try { localStorage.setItem('ge-mesh-draft', meshDraft ? '1' : '0'); } catch { /* ignore */ } });

  /** Drawing descriptor markdown — hand-authored "how to draw this part"
   *  reference. Stored alongside the graph as `meta.drawingMd` so it
   *  round-trips through save → reload. Hydrated from any saved file in
   *  the URL-load block below; empty for fresh graphs. */
  let drawingMd = $state<string>('');
  /** ✨ AI-generate spinner. Drives POST /api/primitives/describe — one
   *  Claude call that infers a drawing-descriptor markdown from the emitted
   *  source + bake stats and REPLACES drawingMd (this is a generate action).
   *  On failure the error is prepended as an HTML comment so existing MD is
   *  never wiped. (#117) */
  let mdAiBusy = $state(false);
  async function generateMdWithAi() {
    if (mdAiBusy) return;
    mdAiBusy = true;
    try {
      const r = await fetch('/api/primitives/describe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: exemplarId,
          source: emitted.source,
          bake: typeof bake === 'object' && bake ? (bake as any).bake : null,
        }),
      });
      if (r.ok) {
        const j = await r.json();
        if (j.markdown) drawingMd = j.markdown;
      } else {
        let detail = `HTTP ${r.status}`;
        try { detail = (await r.text()) || detail; } catch { /* ignore */ }
        drawingMd = `<!-- describe failed: ${detail.replace(/-->/g, '--&gt;')} -->\n\n` + drawingMd;
      }
    } catch (e: any) {
      const detail = String(e?.message ?? e).replace(/-->/g, '--&gt;');
      drawingMd = `<!-- describe failed: ${detail} -->\n\n` + drawingMd;
    } finally {
      mdAiBusy = false;
    }
  }

  function dropCsg(op: CsgOp) { closePicker(); graph = addMethodPlaceholder(graph, op).graph; }
  function dropMv()  { closePicker(); graph = addMvPlaceholder(graph).graph; }
  function dropRot() { closePicker(); graph = addRotPlaceholder(graph).graph; }
  function dropTxfmn() { closePicker(); graph = addTxfmnPlaceholder(graph).graph; }
  function dropStack(){ closePicker(); graph = addStackPlaceholder(graph).graph; }

  /** Profile-mode "pen" nodes — turtle-graphics-style polygon authoring.
   *  Each pen node lands as a Call with a synthetic src tag (`pen_mv`,
   *  `pen_line`, …) and default literal args. The Phase 2b profile-
   *  emit pipeline interprets these src tags into build() body output.
   *
   *  Why CALL nodes (not a new node type): keeps the graph data model
   *  unchanged, so wire / layout / autoLayout / push-apart all work
   *  uniformly. The src string is a sentinel — the emitter and the
   *  picker both pattern-match against `pen_*` to decide their behavior.
   *
   *  Defaults are Z-down friendly (revolve set): mv puts the pen at
   *  origin; line pulls outward by 1 in r; lineR pushes down 1 in z;
   *  lineZ same. The user adjusts the literal args from there or
   *  wires them to assembly params (od, len, …) via the ƒ-popup. */
  function dropPen(op: 'mv' | 'line' | 'lineR' | 'lineZ') {
    closePicker();
    const args: Record<string, { kind: 'literal'; value: number }> = (() => {
      if (op === 'mv')    return { r: asLiteral(0), z: asLiteral(0) };
      if (op === 'line')  return { r: asLiteral(1), z: asLiteral(0) };
      if (op === 'lineR') return { dr: asLiteral(0), dz: asLiteral(1) };
      return { dz: asLiteral(1) }; // lineZ
    })();
    graph = addCall(graph, `pen_${op}`, args).graph;
  }

  /** Profile-mode Polygon — the canonical (and only) producer for the
   *  new profile editor. Drops a single PolygonNode with three default
   *  vertices; the user edits the inline table to wire each point's
   *  r/z to a PARAMS slider, paste an expression, reorder rows, or
   *  add / remove rows. Replaces the per-pen-op Call cards from Phase
   *  2a — far more compact + matches how a parametric polygon actually
   *  thinks. */
  function dropPolygon() {
    closePicker();
    graph = addPolygon(graph).graph;
  }
  /** Drop a `sketch` node (plan M.1) — a profile producer with CAD operators
   *  (line · spline · fillet · chamfer) that compile to (r,z) via Maker.js.
   *  Wires into a revolve/extrude profile arg the same way a polygon does. */
  function dropSketch() {
    closePicker();
    graph = addSketch(graph).graph;
  }
  /** Picker "ƒ expr" item (B.7 v3) — route to the Σ Expressions MENU instead of
   *  silently dropping an instance of a (possibly empty, unwireable) def. The
   *  menu is where you define a named expr with params/outputs and THEN drop a
   *  wireable instance of it. Anchored to the Σ rail button. */
  function dropExpr() {
    closePicker();
    const btn = vrailEl?.querySelector('.ge-vrail-btn.expr') as HTMLElement | null;
    const r = btn?.getBoundingClientRect();
    exprMenu = { anchor: r ? { x: r.right + 8, y: r.top } : { x: 56, y: 120 } };
  }
  /** ArgValue → editable string (literal number, p.<param>, or raw expr). */
  // argStr / argFrom → graph-editor-args.ts (P2/G2).

  // FROZEN sketcher viewBox: deriving it from LIVE point extents rescaled the
  // canvas on every drag. Freeze on open (only Fit re-derives). The state lives
  // on `sketch` (SketchState); this $effect stays in the component for its
  // effect context (Phase E).
  $effect(() => {
    if (sketch.editingSketchId && sketch.sketchEditor && !sketch.frame) {
      const e = sketch.sketchEditor.ext;
      sketch.frame = { minX: e.minX, maxX: e.maxX, minY: e.minY, maxY: e.maxY };
    }
  });

  /** Drop an r_revolve / r_weld_extrude Call inside a profile graph.
   *  These are 3D solid producers — the polygon's output flows into the
   *  Call's `profile` arg, and the Output card receives a Manifold
   *  instead of a polygon. The right-pane swap (2D PREVIEW → 3D BAKE)
   *  happens automatically: the bake effect detects `r_revolve` or
   *  `r_weld_extrude` in the graph and routes to /api/primitives/preview.
   *
   *  Auto-wire: if a Polygon node already exists in the graph, we
   *  immediately wire its emitted points into the new Call's `profile`
   *  arg via an `expr` ArgValue that emits the polygon's literal array.
   *  The user can also leave the slot empty and wire it manually. */
  /** Default polygon vertices for the auto-attached polygon when
   *  dropSolid creates one. Revolve gets the small triangle (matches
   *  the plain dropPolygon default); extrude gets a unit square
   *  centered on the origin so the user sees a sensible default
   *  cross-section that respects the cartesian (x, y) coord system. */
  const POLY_REVOLVE_DEFAULT = [
    { r: asLiteral(0), z: asLiteral(0) },
    { r: asLiteral(1), z: asLiteral(0) },
    { r: asLiteral(1), z: asLiteral(1) },
  ];
  const POLY_EXTRUDE_DEFAULT = [
    { r: asLiteral(-1), z: asLiteral(-1) },
    { r: asLiteral( 1), z: asLiteral(-1) },
    { r: asLiteral( 1), z: asLiteral( 1) },
    { r: asLiteral(-1), z: asLiteral( 1) },
  ];

  function dropSolid(op: 'revolve' | 'extrude' | 'loft') {
    closePicker();
    // Find an existing PROFILE PRODUCER to feed the solid, or create one.
    // REVOLVE defaults to the SKETCH engine (line/spline/fillet (r,z) ops) —
    // smoother, CAD-style half-sections beat a raw polygon, and the sketch
    // wires into the profile arg the same `__POLY__<id>` way (per dropSketch).
    // EXTRUDE / LOFT keep the cartesian (x,y) polygon. The producer becomes
    // non-deletable while the solid consumes it (× greys out + 🔒 on the card);
    // delete the solid first to unlock it.
    let profileId: string | undefined;
    if (op === 'revolve') {
      profileId = (Object.values(graph.nodes).find((n) => (n as any).type === 'sketch') as any)?.id;
      if (!profileId) {
        const r = addSketch(graph);
        graph = r.graph;
        profileId = r.id;
      }
    } else {
      // loft + extrude both take a cartesian (x,y) cross-section.
      profileId = (Object.values(graph.nodes).find((n) => (n as any).type === 'polygon') as any)?.id;
      if (!profileId) {
        const r = addPolygon(graph, POLY_EXTRUDE_DEFAULT);
        graph = r.graph;
        profileId = r.id;
      }
    }
    const profileArg = { kind: 'expr' as const, expr: '__POLY__' + profileId };
    if (op === 'revolve') {
      graph = addCall(graph, 'r_revolve', {
        profile: profileArg as any,
        segments: { kind: 'literal', value: 96 } as any,
      }).graph;
    } else if (op === 'loft') {
      // r_loft (stdlib) sig: profile · length · divs · twist · bulge · shape ·
      // segments. Defaults to a barrel bulge so the new node visibly differs
      // from a plain extrude. shape stays the engine default ('barrel') even if
      // the enum field reads blank in the card — it bakes via the default.
      graph = addCall(graph, 'r_loft', {
        profile:  profileArg as any,
        length:   { kind: 'literal', value: 6 } as any,
        divs:     { kind: 'literal', value: 48 } as any,
        twist:    { kind: 'literal', value: 0 } as any,
        bulge:    { kind: 'literal', value: 0.4 } as any,
        shape:    { kind: 'literal', value: 'barrel' } as any,
        segments: { kind: 'literal', value: 48 } as any,
      }).graph;
    } else {
      // r_weld_extrude actual sig (stdlib/r_weld_extrude.ts meta.params):
      //   profile · length · divs · twist · taper · segments
      // Earlier draft used `height` (CrossSection.extrude arg name) which
      // didn't match meta.params → drift warning + bake skipped.
      graph = addCall(graph, 'r_weld_extrude', {
        profile: profileArg as any,
        length:   { kind: 'literal', value: 2 } as any,
        divs:     { kind: 'literal', value: 12 } as any,
        twist:    { kind: 'literal', value: 0 } as any,
        taper:    { kind: 'literal', value: 0 } as any,
        segments: { kind: 'literal', value: 32 } as any,
      }).graph;
    }
  }

  // The stack/list reorder popover (containerPop + openContainerPop/moveChild)
  // moved to Popovers.svelte (Phase A) — driven via `popovers.openContainerPop`
  // / `popovers.moveChild` from the container card arms.

  // ─── dev-server restart from the bake error ─────────────────────────────
  // POSTs to /api/__dev_restart which spawns a detached restart of `bun run
  // dev`. The current dev server dies; the browser keeps polling and reloads
  // bake state once the new server comes up. ~2-3 seconds in practice.
  let restartBusy = $state(false);
  let restartStatus = $state<string | null>(null);
  async function restartDevServer() {
    if (restartBusy) return;
    restartBusy = true;
    restartStatus = 'killing dev server…';
    try {
      const r = await fetch('/api/__dev_restart', { method: 'POST' });
      if (!r.ok) {
        const txt = await r.text();
        restartStatus = `✗ ${r.status}: ${txt.slice(0, 120)}`;
        restartBusy = false;
        return;
      }
      restartStatus = '🔄 waiting for new server…';
      // Poll the cache-stats endpoint until it answers — that means a fresh
      // bun run dev came up.
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        await new Promise((res) => setTimeout(res, 500));
        try {
          const ping = await fetch('/api/cache/stats', { cache: 'no-store' });
          if (ping.ok) {
            restartStatus = '✓ dev server ready — re-baking…';
            // Trigger a bake re-run by tweaking the graph state slightly.
            graph = { ...graph };
            setTimeout(() => { restartStatus = null; restartBusy = false; }, 1500);
            return;
          }
        } catch { /* still down */ }
      }
      restartStatus = '⚠ timeout waiting for restart — check /tmp/cadtrain-dev.log';
      restartBusy = false;
    } catch (e: any) {
      restartStatus = `✗ ${e?.message ?? String(e)}`;
      restartBusy = false;
    }
  }
  /** Drop a Repeat + a Stack adjacent + pre-wire Repeat output → Stack
   *  first slot. The canonical pattern (Repeat → Stack → Output) becomes
   *  one click. User can ⚙ open the Stack popover or × the Stack if they
   *  want raw list output instead. */
  function dropRepeat() {
    closePicker();
    const r = addRepeatPlaceholder(graph);
    const s = addStackPlaceholder(r.graph);
    let g2 = appendContainerChild(s.graph, s.id, r.id);
    // Offset the Stack to the right of the Repeat so the wire reads
    // left-to-right immediately, without needing 📐 Auto-layout.
    const rPos = g2.layout[r.id] ?? { x: 80, y: 80 };
    g2 = setLayout(g2, s.id, { x: rPos.x + 260, y: rPos.y });
    graph = g2;
  }
  // endWireOnRepeatCount / endWireOnRepeatChild → wire-state.svelte.ts (Phase C);
  // called as `wire.*` from the Repeat node's count + child slot sockets.

  function deleteNode(id: string) { graph = removeNode(graph, id); }
  function onArgEdit(id: string, key: string, value: number) {
    graph = setCallArg(graph, id, key, asLiteral(value));
  }
  /** Convert an arg between literal and expression modes (ƒ toggle).
   *  literal → expr seeded with the literal value as text (e.g. 1.5 → "1.5")
   *  expr → literal parsed via parseFloat, falling back to 0 if unparseable
   *  param  → expr seeded as "p.<paramName>" (no-op for the user — they could
   *           click × to fully unwire, but starting from the live binding is
   *           a natural way to compose `p.od / 2`). */
  function toggleArgExprMode(id: string, key: string) {
    const node = graph.nodes[id];
    if (!node || node.type !== 'call') return;
    const cur = (node as any).args[key];
    if (cur?.kind === 'expr') {
      const n = parseFloat(String(cur.expr));
      graph = setCallArg(graph, id, key, asLiteral(isNaN(n) ? 0 : n));
    } else if (cur?.kind === 'param') {
      graph = setCallArg(graph, id, key, asExpr(`p.${cur.param}`));
    } else {
      const seed = cur?.kind === 'literal' ? String(cur.value) : '0';
      graph = setCallArg(graph, id, key, asExpr(seed));
    }
  }
  function onArgExprEdit(id: string, key: string, expr: string) {
    graph = setCallArg(graph, id, key, asExpr(expr));
  }

  // The multi-source ƒ-expression popup editor (argExprPop) moved to
  // Popovers.svelte (Phase A) — opened via `popovers.openArgExprPop(...)`.
  // `clampToViewport` is now imported from ./popover-clamp (the sketch/poly
  // expression popovers below still use it).


  // ─── Polygon coord expression popover ──────────────────────────────────
  /** Click on a polygon vertex's wired `p.<name>` chip (or the ƒ button on
   *  an expr coord) opens this small popover. User edits a JS expression
   *  like `p.od / 2` or `p.od - p.wall`, presses Enter → coord becomes
   *  kind:'expr' with that expression. Same UX as the Call-arg argExprPop. */
  /** The expression popover targets either a polygon vertex
   *  (polygonId + idx) or a PolyRepeatNode's r/z slot (repeatId).
   *  Discriminator: `repeatId` present ⇒ loop, else vertex. */
  let polyExprPop = $state<{
    polygonId?: string; idx?: number;
    repeatId?: string;
    bindingIdx?: number;
    axis: 'r' | 'z'; draft: string;
    /** Per-axis drafts when the popover is on a vertex or loop r/z slot
     *  (#157, 2026-06-11). Lets the tab strip switch axes without
     *  losing typing on the previous tab. Apply writes BOTH if either
     *  differs from the stored value, so editing r + z + apply in one
     *  flow Just Works. Absent for binding/count popovers (single slot). */
    drafts?: { r: string; z: string };
    x: number; y: number;
  } | null>(null);
  /** Vertex highlight (2026-06-12) — the vertex currently being EDITED (its
   *  expr popover is open) or HOVERED on the card. Reflected in BOTH the
   *  card row (blue outline) and the profile SVGs (wider dot) so the user
   *  can see which point an input maps to. */
  let hoverVertex = $state<{ polyId: string; idx: number } | null>(null);
  let hlVertex = $derived.by<{ polyId: string; idx: number } | null>(() => {
    if (polyExprPop && polyExprPop.polygonId && typeof polyExprPop.idx === 'number') {
      return { polyId: polyExprPop.polygonId, idx: polyExprPop.idx };
    }
    return hoverVertex;
  });
  function setHoverVertex(polyId: string, idx: number) { hoverVertex = { polyId, idx }; }
  function clearHoverVertex(polyId: string, idx: number) {
    if (hoverVertex && hoverVertex.polyId === polyId && hoverVertex.idx === idx) hoverVertex = null;
  }
  /** Tooltip shown while browsing the 2D profile SVG — black bg / white text
   *  at the cursor with the vertex number + (r,z). Set on dot pointerenter,
   *  cleared on leave. */
  let svgTip = $state<{ x: number; y: number; text: string } | null>(null);
  function showSvgTip(ev: PointerEvent, polyId: string, entryIdx: number | null, evalI: number, total: number, p: [number, number]) {
    if (entryIdx !== null) setHoverVertex(polyId, entryIdx);
    svgTip = {
      x: ev.clientX, y: ev.clientY,
      text: `#${evalI + 1}/${total} · r ${p[0].toFixed(3)} · z ${p[1].toFixed(3)}`,
    };
  }
  function moveSvgTip(ev: PointerEvent) { if (svgTip) svgTip = { ...svgTip, x: ev.clientX, y: ev.clientY }; }
  function hideSvgTip(polyId: string, entryIdx: number | null) { if (entryIdx !== null) clearHoverVertex(polyId, entryIdx); svgTip = null; }
  /** Format an ArgValue as a string the popover textarea can edit. */
  // argToDraftStr → graph-editor-args.ts (P2/G2).
  function openPolyExprPop(ev: MouseEvent, polygonId: string, idx: number, axis: 'r' | 'z', currentExpr: string) {
    ev.stopPropagation();
    // Populate BOTH axis drafts so the tab strip can switch without
    // losing typing on the other tab. The axis-passed currentExpr is
    // authoritative for the active tab (callers may have computed it
    // from a custom prefill); the OTHER tab loads from on-disk state.
    const poly = graph.nodes[polygonId] as any;
    const pt = poly?.points?.[idx];
    const otherAxis: 'r' | 'z' = axis === 'r' ? 'z' : 'r';
    const drafts = {
      [axis]: currentExpr,
      [otherAxis]: argToDraftStr(pt?.[otherAxis]),
    } as { r: string; z: string };
    polyExprPop = { polygonId, idx, axis, draft: currentExpr, drafts, x: ev.clientX, y: ev.clientY };
  }
  /** Variant for the PolyRepeatNode's r/z expressions (#157, 2026-06-11). */
  function openPolyRepeatExprPop(ev: MouseEvent, repeatId: string, axis: 'r' | 'z', currentExpr: string) {
    ev.stopPropagation();
    const pr = graph.nodes[repeatId] as any;
    const otherAxis: 'r' | 'z' = axis === 'r' ? 'z' : 'r';
    const drafts = {
      [axis]: currentExpr,
      [otherAxis]: argToDraftStr(pr?.[otherAxis]),
    } as { r: string; z: string };
    polyExprPop = { repeatId, axis, draft: currentExpr, drafts, x: ev.clientX, y: ev.clientY };
  }
  /** Switch tab — save current draft into drafts[old axis], load
   *  drafts[new axis] as the active draft. Pure state transition; no
   *  graph mutation until Apply. */
  function switchPolyExprAxis(newAxis: 'r' | 'z') {
    if (!polyExprPop || !polyExprPop.drafts) return;
    const old = polyExprPop.axis;
    if (old === newAxis) return;
    polyExprPop = {
      ...polyExprPop,
      drafts: { ...polyExprPop.drafts, [old]: polyExprPop.draft } as { r: string; z: string },
      axis: newAxis,
      draft: polyExprPop.drafts[newAxis],
    };
  }
  /** Variant for a PolyRepeatNode BINDING's value expression. `bindingIdx`
   *  distinguishes the binding from the r/z slot when applying. */
  function openPolyBindingExprPop(ev: MouseEvent, repeatId: string, bindingIdx: number, currentExpr: string) {
    ev.stopPropagation();
    polyExprPop = { repeatId, bindingIdx, axis: 'r', draft: currentExpr, x: ev.clientX, y: ev.clientY };
  }
  /** Variant for a PolyRepeatNode's `count` (NPts) — passed through the
   *  shared popover state with a sentinel `axis: 'count' as any` that
   *  the apply path checks first. */
  function openPolyRepeatCountExprPop(ev: MouseEvent, repeatId: string, currentExpr: string) {
    ev.stopPropagation();
    polyExprPop = { repeatId, axis: 'count' as any, draft: currentExpr, x: ev.clientX, y: ev.clientY };
  }
  /** ƒ button on an mv/rot axis — opens the shared expression popover
   *  (2026-06-11). Consistent with the polygon vertex + loop r/z
   *  buttons: click ALWAYS opens the editor with the current value
   *  prefilled; apply writes back via setTransformAxisValue with
   *  asExpr(draft). Discriminator `transformId` + numeric `axis` (0|1|2)
   *  added to the shared state union. */
  function openTransformAxisExprPop(ev: MouseEvent, transformId: string, axis: 0 | 1 | 2) {
    ev.stopPropagation();
    const node = graph.nodes[transformId] as (MvNode | RotNode) | undefined;
    if (!node) return;
    const field = node.type === 'mv' ? (node as MvNode).offset : (node as RotNode).rot;
    const cur = field[axis];
    const prefill = cur.kind === 'expr'    ? String(cur.expr ?? '')
                  : cur.kind === 'param'   ? `p.${cur.param}`
                  : String(cur.value ?? 0);
    polyExprPop = {
      transformId, transformAxis: axis,
      axis: 'r', // sentinel; apply path branches on transformId first
      draft: prefill, x: ev.clientX, y: ev.clientY,
    } as any;
  }
  function closePolyExprPop() { polyExprPop = null; }
  function applyPolyExprPop() {
    if (!polyExprPop) return;
    // mv/rot axis — write via setTransformAxisValue with asExpr(draft).
    const txId = (polyExprPop as any).transformId as string | undefined;
    const txAxis = (polyExprPop as any).transformAxis as (0 | 1 | 2) | undefined;
    if (txId && (txAxis === 0 || txAxis === 1 || txAxis === 2)) {
      graph = setTransformAxisValue(graph, txId, txAxis, asExpr(polyExprPop.draft));
      polyExprPop = null;
      return;
    }
    if (polyExprPop.repeatId && polyExprPop.bindingIdx !== undefined) {
      graph = setPolyRepeatBindingValue(graph, polyExprPop.repeatId, polyExprPop.bindingIdx, asExpr(polyExprPop.draft));
    } else if (polyExprPop.repeatId && (polyExprPop.axis as any) === 'count') {
      graph = setPolyRepeatCount(graph, polyExprPop.repeatId, asExpr(polyExprPop.draft));
    } else if (polyExprPop.repeatId) {
      // Tabbed loop r/z — write BOTH axes from drafts so editing across
      // tabs commits together. Snapshot active draft into drafts[axis]
      // first so the in-progress edit isn't lost.
      const drafts = polyExprPop.drafts
        ? { ...polyExprPop.drafts, [polyExprPop.axis]: polyExprPop.draft }
        : { [polyExprPop.axis]: polyExprPop.draft } as Record<'r' | 'z', string>;
      if (drafts.r !== undefined) graph = setPolyRepeatCoord(graph, polyExprPop.repeatId, 'r', asExpr(drafts.r));
      if (drafts.z !== undefined) graph = setPolyRepeatCoord(graph, polyExprPop.repeatId, 'z', asExpr(drafts.z));
    } else if (polyExprPop.polygonId !== undefined && polyExprPop.idx !== undefined) {
      // Tabbed vertex r/z — same pattern as loop r/z above.
      const drafts = polyExprPop.drafts
        ? { ...polyExprPop.drafts, [polyExprPop.axis]: polyExprPop.draft }
        : { [polyExprPop.axis]: polyExprPop.draft } as Record<'r' | 'z', string>;
      if (drafts.r !== undefined) graph = setPolygonCoord(graph, polyExprPop.polygonId, polyExprPop.idx, 'r', asExpr(drafts.r));
      if (drafts.z !== undefined) graph = setPolygonCoord(graph, polyExprPop.polygonId, polyExprPop.idx, 'z', asExpr(drafts.z));
    }
    polyExprPop = null;
  }
  function insertParamIntoPolyDraft(name: string) {
    if (!polyExprPop) return;
    const ref = `p.${name}`;
    const draft = polyExprPop.draft;
    const sep = draft.length > 0 && !/\s$/.test(draft) ? ' ' : '';
    polyExprPop = { ...polyExprPop, draft: draft + sep + ref };
  }
  // The profile-kind picker (profilePop) + profile-node-ref swap/detach
  // (profileRefPop, swapProfileRef, detachProfile, selectProfileKind) moved to
  // Popovers.svelte (Phase A). Opened via `popovers.openProfilePop(...)` /
  // `popovers.openProfileRefPop(...)`; `popovers.detachProfile(...)` is the × on
  // the chip. producerLabel/parseProfileExpr/PROFILE_REGISTRY stay here for the
  // node-card profile chip; profileProducers/kindsForSet/defaultsFor are now
  // used only inside Popovers.svelte.

  function onTransformAxis(id: string, axis: 0 | 1 | 2, value: number) {
    graph = setTransformAxis(graph, id, axis, value);
  }
  /** ƒ button on an mv/rot axis — toggle the axis between literal /
   *  expression mode. Mirrors toggleArgExprMode on Call args. Going IN to
   *  expr mode seeds the draft with `p.<name>` (when wired) or the current
   *  literal value, so the input stays meaningful after the toggle. */
  function toggleTransformAxisExprMode(id: string, axis: 0 | 1 | 2) {
    const node = graph.nodes[id] as (MvNode | RotNode) | undefined;
    if (!node) return;
    const field = node.type === 'mv' ? (node as MvNode).offset : (node as RotNode).rot;
    const cur = field[axis];
    if (cur.kind === 'expr') {
      // Try to recover a literal from the expression — if the expression
      // is just a number string we keep the value; otherwise reset to 0.
      const n = Number(cur.expr);
      graph = setTransformAxisValue(graph, id, axis, asLiteral(Number.isFinite(n) ? n : 0));
      return;
    }
    let seed = '';
    if (cur.kind === 'param') seed = `p.${cur.param}`;
    else if (cur.kind === 'literal') seed = String(cur.value);
    graph = setTransformAxisValue(graph, id, axis, asExpr(seed));
  }
  /** Edit the expression value on an mv/rot axis. */
  function onTransformAxisExprEdit(id: string, axis: 0 | 1 | 2, expr: string) {
    graph = setTransformAxisValue(graph, id, axis, asExpr(expr));
  }

  // ─── TXFMN (unified ROT/MV transform card) axis helpers ──────────────────
  // The standalone TxfmnNode carries rot:[x,y,z] + offset:[x,y,z]; all six
  // axis cells edit through setTxfmnAxis(graph, id, section, axis, value).
  function onTxfmnAxis(id: string, section: 'rot' | 'mv', axis: 0 | 1 | 2, value: number) {
    graph = setTxfmnAxis(graph, id, section, axis, asLiteral(Number.isFinite(value) ? value : 0));
  }
  /** ƒ toggle on a txfmn axis — literal/param ⇄ expression (mirrors
   *  toggleTransformAxisExprMode but section-aware). */
  function toggleTxfmnAxisExprMode(id: string, section: 'rot' | 'mv', axis: 0 | 1 | 2) {
    const node = graph.nodes[id] as any;
    if (!node || node.type !== 'txfmn') return;
    const cur = (section === 'rot' ? node.rot : node.offset)[axis];
    if (cur?.kind === 'expr') {
      const n = Number(cur.expr);
      graph = setTxfmnAxis(graph, id, section, axis, asLiteral(Number.isFinite(n) ? n : 0));
      return;
    }
    const seed = cur?.kind === 'param' ? `p.${cur.param}` : cur?.kind === 'literal' ? String(cur.value) : '';
    graph = setTxfmnAxis(graph, id, section, axis, asExpr(seed));
  }
  function onTxfmnAxisExprEdit(id: string, section: 'rot' | 'mv', axis: 0 | 1 | 2, expr: string) {
    graph = setTxfmnAxis(graph, id, section, axis, asExpr(expr));
  }
  function resetGraph() { graph = newGraph(); }

  // ─── auto-layout (Phase 20) ────────────────────────────────────────────
  // 📐 Auto-layout runs the heuristic layered algorithm in
  // src/lib/cad/composition-layout.ts → rearranges every node by depth
  // column with a barycenter tiebreaker (cheap, deterministic, ~120 LOC,
  // zero deps). One-step undo restores the prior layout.
  //
  // Phase 21 (deferred) will swap in dagre when graphs grow past ~15 nodes.
  let undoLayout = $state<Record<string, { x: number; y: number }> | null>(null);
  function autoLayout() {
    undoLayout = { ...graph.layout };
    // Generous column + row gaps so the depth-column layout is clean BY
    // CONSTRUCTION: rowGap 220 clears the tallest cards within a column,
    // and the __POLY__ profile edges (K.78) put polygons in the column
    // BEFORE their consumer calls instead of piling into depth 0.
    // The PROPERTIES + PARAMS cards are passed as obstacles so the placement
    // shoves any node off them FROM THE START (not just in the nudge pass).
    graph = autoLayoutGraph(graph, {
      rowGap: 220,
      columnGap: 300,
      obstacles: overlayCardObstacles(),
      nodeSize: (id) => nodeSize(graph,graph.nodes[id]),
    });
    // Finish with a push-apart that keeps the card obstacles ON (so the
    // pairwise de-overlap can't shove a node back onto the PROPERTIES /
    // PARAMS cards) but leaves wires + viewport bounds OFF — those pull
    // cards toward the viewport/params channel and were COMPRESSING the
    // clean columns. The card obstacles only repel nodes that actually
    // overlap the top-left cards, so they don't compress the layout.
    try { applyPushApart({ useBounds: false, useObstacles: true, useWires: false }); }
    catch (e) { console.warn('[graph-editor] push-apart after auto-layout failed', e); }
  }
  function undoAutoLayout() {
    if (!undoLayout) return;
    graph = { ...graph, layout: { ...undoLayout } };
    undoLayout = null;
  }
  // Phase 22 — 🧲 Push apart. Resolves overlapping cards via pairwise
  // bounding-box separation. Includes the tacked params card as a
  // viewport-fixed obstacle so nodes get pushed clear of it too.
  // The same undoLayout snapshot is reused so the user can ↶ undo this
  // just like an auto-layout. (Standalone entry point kept for the ↶-undo
  // semantics; auto-layout calls applyPushApart directly without re-snapshotting.)
  function pushApart() {
    undoLayout = { ...graph.layout };
    applyPushApart();
  }
  /** The single viewport-tacked overlay card — the combined tab card
   *  (header + the ACTIVE tab's body) — projected from screen-fixed coords
   *  into GRAPH space at the current pan/zoom. Returned as
   *  forceSeparate/autoLayoutGraph obstacle so node cards get pushed clear of
   *  it and never overlap. The card is glued to the top-left of the viewport
   *  (PROPS_X0 px from the left), so `(screenX - pan.x) / zoom` maps the
   *  card's screen rect into graph space; a larger card footprint at low zoom
   *  maps to a larger graph rect, which is correct. */
  function overlayCardObstacles(): { id: string; x: number; y: number; w: number; h: number }[] {
    // Card height = tab header + whichever tab body is showing. The params
    // body socket spills ~14 px past the card's right edge, so pad the width.
    const pcardSize = paramCardSize(paramEntries.length, PARAM_W);
    const bodyH = leftTab === 'params' ? pcardSize.h : propsBodyH;
    const w = Math.max(PROPS_W, pcardSize.w + 14);
    return [{
      id: '__obs_left_card',
      x: (PROPS_X0 - pan.x) / zoom,
      y: (PROPS_Y0 - pan.y) / zoom,
      w: w / zoom,
      h: (TAB_HEADER_H + bodyH) / zoom,
    }];
  }
  function applyPushApart(opts: { useBounds?: boolean; useObstacles?: boolean; useWires?: boolean } = {}) {
    const { useBounds = true, useObstacles = true, useWires = true } = opts;
    // The PROPERTIES + PARAMS cards are viewport-fixed obstacles nodes get
    // pushed clear of. PURE mode skips them + the wires + the bounds — wires
    // and bounds pull cards toward the viewport/params channel and were
    // COMPRESSING the clean column layout back together. Pure pairwise
    // separation only de-overlaps, never compresses.
    const obstacles: { id: string; x: number; y: number; w: number; h: number }[] = [];
    if (useObstacles) {
      obstacles.push(...overlayCardObstacles());
    }
    // Boundary walls (#116). The visible canvas region in graph space is
    // ([0, rect.width]/zoom shifted by -pan.x, etc.). Repellant walls
    // ride the obstacles channel — a tall thin rect JUST OUTSIDE the edge
    // that pushes any node touching the edge away. Confiner walls clamp
    // to the visible interior via confinerBounds. If both edges are off,
    // we skip the rect lookup entirely.
    let confinerBounds: { minX?: number; maxX?: number; minY?: number } | undefined;
    if (useBounds && canvasEl && (boundLeft !== 'off' || boundRight !== 'off' || boundTop !== 'off')) {
      const rect = canvasEl.getBoundingClientRect();
      // Viewport edges in graph space — the wall IS the current section
      // boundary. Cards past the edge (off-screen) get pulled back inside;
      // cards inside don't get touched. To catch cards that are already
      // far off-screen, each wall extends as a FULL HALF-PLANE in the
      // off-screen direction — viewport-end → ±FAR — so a card anywhere
      // outside the visible region overlaps it and gets pushed back in.
      const FAR = 10000;
      const gxLeft = (0 - pan.x) / zoom;
      const gxRight = (rect.width - pan.x) / zoom;
      const gyTop = (0 - pan.y) / zoom;
      const gyBottom = (rect.height - pan.y) / zoom;
      const wallY = gyTop - FAR;
      const wallH = (gyBottom - gyTop) + 2 * FAR;
      // Repellant mode ALSO sets a confinerBounds clamp on that side —
      // gives a hard "stay inside the viewport" guarantee on top of the
      // half-plane obstacle, so pairwise pushes that ricochet a card past
      // the boundary in one iteration get yanked back at the end of that
      // same iteration. Without this, a chain of 5+ cards can cascade and
      // send the last 1-2 off-screen as the resolver moves things around.
      if (boundLeft === 'repellant') {
        obstacles.push({
          id: '__obs_wall_left',
          x: gxLeft - FAR, y: wallY, w: FAR, h: wallH,
        });
        confinerBounds = { ...(confinerBounds ?? {}), minX: gxLeft };
      }
      if (boundRight === 'repellant') {
        obstacles.push({
          id: '__obs_wall_right',
          x: gxRight, y: wallY, w: FAR, h: wallH,
        });
        confinerBounds = { ...(confinerBounds ?? {}), maxX: gxRight };
      }
      // Top edge — half-plane above the viewport, pushes nodes down.
      // Extend wall width FAR beyond the visible x-range so a card sitting
      // ABOVE the viewport (any x) gets caught.
      if (boundTop === 'repellant') {
        // Pad by some buffer (24 px) so cards land well clear of the tab
        // strip / PARAMS card overlay, not flush against the edge.
        const topPad = 24 / zoom;
        obstacles.push({
          id: '__obs_wall_top',
          x: gxLeft - FAR, y: gyTop + topPad - FAR, w: (gxRight - gxLeft) + 2 * FAR, h: FAR,
        });
        confinerBounds = { ...(confinerBounds ?? {}), minY: gyTop + topPad };
      }
    }
    // Collect the visible wires so push-apart can route cards AROUND them
    // (Phase 22b — wire repulsion). Skipped in pure mode.
    const wires = useWires ? collectWires() : [];
    // Real rendered card heights from the DOM (the nodeSize estimate
    // undersizes cards with foreignObject param/accordion bodies, so
    // forceSeparate thought cards cleared when they visually overlapped —
    // K.78). getBBox is in the card's local graph units, so no zoom
    // division needed. Fall back to the estimate when a card isn't in the
    // DOM yet.
    const realH = new Map<string, number>();
    if (typeof document !== 'undefined') {
      for (const el of Array.from(document.querySelectorAll('g.ge-node[data-node-id]'))) {
        const nid = el.getAttribute('data-node-id');
        if (!nid) continue;
        try { const bb = (el as any).getBBox?.(); if (bb && bb.height > 0) realH.set(nid, bb.height); } catch { /* detached */ }
      }
    }
    graph = forceSeparate(graph, {
      nodeSize: (id) => {
        const est = nodeSize(graph,graph.nodes[id]);
        const measured = realH.get(id);
        // Use the larger of estimate / measured, with a sane floor so
        // small estimates can't pack cards too tightly.
        return { w: est.w, h: Math.max(est.h, measured ?? 0, 120) };
      },
      padding: 24,
      obstacles,
      wires,
      wirePadding: 16,
      confinerBounds,
    });
  }

  /** Enumerate every visible wire in the graph as a line segment in
   *  GRAPH space. Used by pushApart so wires push non-endpoint cards
   *  perpendicular to the segment when a card sits on top of one.
   *  Mirrors the SVG render path's wire enumeration (method obj/arg,
   *  mv/rot/repeat child, container child → output). */
  function collectWires(): { fromId?: NodeId; toId?: NodeId; ax: number; ay: number; bx: number; by: number }[] {
    const out: { fromId?: NodeId; toId?: NodeId; ax: number; ay: number; bx: number; by: number }[] = [];
    for (const [id, node] of Object.entries(graph.nodes)) {
      if (!node) continue;
      const addInputWire = (srcId: NodeId, slot: 'obj' | 'arg' | 'child') => {
        if (!graph.nodes[srcId]) return;
        const a = outputSocketAt(graph,srcId);
        const b = inputSocketAt(graph,id, slot);
        out.push({ fromId: srcId, toId: id, ax: a.x, ay: a.y, bx: b.x, by: b.y });
      };
      if (node.type === 'method') {
        if (node.obj) addInputWire(node.obj, 'obj');
        if (node.arg) addInputWire(node.arg, 'arg');
      } else if (node.type === 'mv' || node.type === 'rot' || node.type === 'txfmn' || node.type === 'repeat') {
        if (node.child) addInputWire(node.child, 'child');
      } else if (node.type === 'stack' || node.type === 'group') {
        node.children.forEach((c, i) => {
          if (!graph.nodes[c]) return;
          const a = outputSocketAt(graph,c);
          const b = containerSlotInputAt(graph,id, i);
          out.push({ fromId: c, toId: id, ax: a.x, ay: a.y, bx: b.x, by: b.y });
        });
      } else if (node.type === 'list' && id === graph.root) {
        // Root-list children draw a wire to the Output card's slots.
        node.children.forEach((c, i) => {
          if (!graph.nodes[c]) return;
          const a = outputSocketAt(graph,c);
          const b = containerSlotInputAt(graph,id, i);
          out.push({ fromId: c, toId: id, ax: a.x, ay: a.y, bx: b.x, by: b.y });
        });
      }
    }
    return out;
  }

  // ─── inline transforms on Call cards ────────────────────────────────────
  function toggleInlineTransform(callId: NodeId, kind: 'mv' | 'rot') {
    const existing = inlineTransformOf(graph, callId, kind);
    if (existing) {
      graph = unwrapTransform(graph, existing);
    } else {
      graph = wrapInTransform(graph, callId, kind).graph;
    }
  }
  /** Attached transforms should NOT render on the main canvas — their xyz
   *  inputs surface as STRIPS inside their base Call card instead. This now
   *  catches free-standing mv/rot whose `.child` chain reaches a Call (not just
   *  the directly-wrapping inline case); a transform wrapping a Method/Stack/etc.
   *  stays a normal card. */
  function isInlineWrapper(nodeId: NodeId): boolean {
    return isAttachedTransform(graph, nodeId);
  }

  // ─── assembly-level params (Slice 3 first cut) ──────────────────────────
  let newParamName = $state('');
  let newParamDefault = $state(0);
  let addParamPop = $state<{ x: number; y: number } | null>(null);
  function openAddParamPop(ev: PointerEvent) { addParamPop = { x: ev.clientX, y: ev.clientY }; }
  function closeAddParamPop() { addParamPop = null; }
  function onAddParam() {
    const name = newParamName.trim();
    if (!name) return;
    graph = addParam(graph, name, { default: newParamDefault, step: 0.05 });
    newParamName = ''; newParamDefault = 0;
    addParamPop = null;
  }
  function onParamDefault(name: string, value: number) {
    const cur = graph.params[name];
    if (!cur) return;
    graph = setParamSchema(graph, name, { ...cur, default: value });
  }
  function onAddStackRef() {
    graph = addStackRef(graph);
    addParamPop = null;
  }
  // ─── Properties card handlers ─────────────────────────────────────────────
  /** The live z-offset value the Properties card shows. Falls back to 0 when
   *  the part hasn't opted into the reserved stack_ref param yet. */
  let zOffsetVal = $derived(
    hasStackRef(graph) ? Number((graph.params[STACK_REF_PARAM] as any)?.default) || 0 : 0,
  );
  /** Apply-on-Enter z-offset commit. Lazily adds the reserved stack_ref param
   *  the first time the user edits it (a 0 with no param stays "unset"). */
  function onZOffset(value: number) {
    const v = Number.isFinite(value) ? value : 0;
    let g = graph;
    if (!hasStackRef(g)) {
      if (v === 0) return; // editing to 0 with no param yet → no-op (stays unset)
      g = addStackRef(g);
    }
    const cur = g.params[STACK_REF_PARAM];
    if (!cur) return;
    graph = setParamSchema(g, STACK_REF_PARAM, { ...cur, default: v });
  }
  function onPartColorOuter(hex: string | null) { graph = setPartColorOuter(graph, hex); }
  function onPartColorInner(hex: string | null) { graph = setPartColorInner(graph, hex); }
  function onPartMaterial(mat: string | null) { graph = setPartMaterial(graph, mat); }
  /** Per-part appearance patch (OUT/IN colour + material), keyed by part id. */
  function onPartAppearance(id: string, patch: { colorOuter?: string | null; colorInner?: string | null; material?: string | null }) {
    graph = setPartAppearance(graph, id, patch);
  }
  /** The LEAF parts of the Output (A/B/C…) shown as rows in the PROPERTIES
   *  table. Recurses through containers (list/stack/group) and repeats so the
   *  actual Call parts surface (not the wrapping Stack). Labelled by Call alias;
   *  deduped by node id. */
  const partsForProps = $derived.by(() => {
    const out: { id: string; label: string; appearance: any }[] = [];
    const seen = new Set<string>();
    const visit = (id: string) => {
      const n = graph.nodes[id] as any;
      if (!n || seen.has(id)) return;
      seen.add(id);
      if (n.type === 'list' || n.type === 'stack' || n.type === 'group' || n.type === 'repeat') {
        for (const c of (n.children ?? [])) visit(c);
        return;
      }
      // Only 3D geometry producers are PARTS — polygon/sketch/poly_repeat are
      // 2D profile producers (consumed by a Call via __POLY__), not parts.
      if (n.type !== 'call' && n.type !== 'method') return;
      const label = n.type === 'call' ? (n.alias || n.src) : `${n.op}(…)`;
      out.push({ id, label, appearance: (graph.partAppearance?.[id] ?? {}) });
    };
    visit(graph.root);
    return out;
  });
  // Default swatch colours + material list moved into PropertiesCard.svelte (Phase D).
  function onRemoveParam(name: string) {
    if (name === STACK_REF_PARAM) return; // reserved — no trash button anyway
    const r = removeParam(graph, name);
    if (r.orphans.length > 0) {
      // Surface to the user — the editor refuses, expects them to unwire first.
      alert(`Can't remove ${name}: ${r.orphans.length} call arg${r.orphans.length === 1 ? '' : 's'} still wired to it. Unwire first.`);
      return;
    }
    graph = r.graph;
  }
  /** Wire popover state — when the user clicks an arg's wire icon, this opens
   *  a small menu with param choices. */
  let wirePop = $state<{ callId: NodeId; key: string; x: number; y: number } | null>(null);
  function openWirePop(ev: MouseEvent, callId: NodeId, key: string) {
    ev.stopPropagation();
    wirePop = { callId, key, x: ev.clientX, y: ev.clientY };
  }
  function closeWirePop() { wirePop = null; }
  function wireArgToParam(callId: NodeId, key: string, paramName: string) {
    graph = setCallArg(graph, callId, key, asParam(paramName));
    wirePop = null;
  }
  function unwireArgToLiteral(callId: NodeId, key: string) {
    const node = graph.nodes[callId];
    if (!node || node.type !== 'call') return;
    const cur = (node as any).args[key];
    const literal = cur?.kind === 'literal' ? cur.value : (graph.params[cur?.param]?.default ?? 0);
    graph = setCallArg(graph, callId, key, asLiteral(typeof literal === 'number' ? literal : 0));
    wirePop = null;
  }

  // ─── Save ─────────────────────────────────────────────────────────────
  let saveBusy = $state(false);
  async function saveGraph() {
    if (saveBusy) return;
    saveBusy = true;
    saveStatus = `saving ${exemplarId}…`;
    // Capture current viewport into the graph BEFORE serialising.
    graph = setViewport(graph, pan, zoom);
    try {
      // Unified save — one endpoint, one body shape. The graph emit walks
      // every node type uniformly (composition-emit.ts handles polygon
      // as a literal-array case alongside Call / method / mv / repeat).
      // The output type doesn't change the save destination: every saved
      // file is .prim.ts in basic/. The right-pane render surface (2D
      // vs 3D) is decided by hasSolidProducer at READ time, not encoded
      // into the file location.
      const r = await fetch('/api/primitives/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: exemplarId,
          source: emitted.source,
          kind: 'asm',
          // Active folder-tab dir for a brand-new part (server ignores this for
          // an existing id — it writes back in place). Defaults to basic/.
          dir: props.createDir || 'basic',
        }),
      });
      if (r.ok) {
        saveStatus = `✓ ${exemplarId} saved to ${props.createDir || 'basic'}/`;
        props.onSaved?.(exemplarId, props.createDir || 'basic');
      } else {
        saveStatus = `✗ save ${r.status}: ${(await r.text()).slice(0, 160)}`;
      }
    } catch (e: any) {
      saveStatus = `✗ ${e?.message ?? e}`;
    } finally {
      saveBusy = false;
    }
  }

  // Derived view-helpers.
  // Visible nodes on the canvas: every node EXCEPT inline mv/rot wrappers
  // (those render inline inside their Call's card). The ROOT list IS visible
  // now — it shows up as the ▶ Output card so the user can see + curate what
  // the function returns. Non-root lists/stacks/groups also render as cards.
  let allNodes = $derived.by(() => {
    const all = Object.values(graph.nodes).filter((n) => !isInlineWrapper(n.id));
    // Z-order sort: nodes in `zOrder` render AFTER the rest, in the order they
    // were brought to front. SVG paints later elements ON TOP — that's how
    // we get click-to-front. Unlisted nodes keep their natural insertion order.
    if (zOrder.length === 0) return all;
    const zMap = new Map<string, number>();
    zOrder.forEach((id, i) => zMap.set(id, i));
    return [...all].sort((a, b) => {
      const aZ = zMap.get(a.id);
      const bZ = zMap.get(b.id);
      if (aZ === undefined && bZ === undefined) return 0;
      if (aZ === undefined) return -1;
      if (bZ === undefined) return 1;
      return aZ - bZ;
    });
  });
  /** Excludes the root list — that's the always-present ▶ Output card,
   *  not a user-dropped node. Used by the status bar + empty-canvas hint. */
  let visibleNodeCount = $derived(allNodes.filter((n) => n.id !== graph.root).length);

  /** Set of node ids that are CONSUMED by another node — i.e. referenced as
   *  the input slot of a method.obj/arg, mv/rot/repeat.child, or as a child
   *  of stack/group. Mirrors composition-emit.ts computeConsumedSet so the
   *  editor and the emit agree on what's "intermediate" vs "output".
   *
   *  Used by the ▶ Output card slot rendering — consumed children stay in
   *  root.children for data integrity but aren't shown as Output slots
   *  (they aren't in the function's return either). */
  let consumedSet = $derived.by(() => {
    const set = new Set<string>();
    for (const n of Object.values(graph.nodes)) {
      if (n.type === 'method') {
        if ((n as any).obj) set.add((n as any).obj);
        if ((n as any).arg) set.add((n as any).arg);
      } else if (n.type === 'mv' || n.type === 'rot' || n.type === 'txfmn' || n.type === 'repeat') {
        if ((n as any).child) set.add((n as any).child);
      } else if (n.type === 'stack' || n.type === 'group') {
        for (const c of (n as any).children) set.add(c);
      } else if (n.type === 'list' && n.id !== graph.root) {
        for (const c of (n as any).children) set.add(c);
      } else if (n.type === 'call') {
        // Call args carrying a __POLY__<sourceId> expr consume the source.
        // Without this, the polygon shows up as an Output child alongside
        // the revolve that's USING it — two outputs visible when there's
        // only one actual return value (the revolve's solid).
        for (const v of Object.values((n as any).args ?? {})) {
          if ((v as any).kind !== 'expr') continue;
          const matches = String((v as any).expr ?? '').match(/__POLY__(n_[a-z0-9]+)/gi);
          if (!matches) continue;
          for (const m of matches) set.add(m.slice('__POLY__'.length));
        }
      }
    }
    return set;
  });
  // The reserved stack-reference param is EXCLUDED from the chip list — its
  // z-offset now lives in the Properties card above the Params card, not as a
  // duplicate chip. (The model keeps it reserved/undeletable.) paramEntries is
  // the single source for both the chip render AND the param-wire `findIndex`
  // lookups, so filtering here keeps every socket index aligned automatically.
  let paramEntries = $derived(
    Object.entries(graph.params).filter(([name]) => name !== STACK_REF_PARAM),
  );
  let filteredSrcs = $derived.by(() => {
    const q = pickerFilter.trim().toLowerCase();
    const base = q ? pickerSrcs.filter((s) => s.toLowerCase().includes(q)) : pickerSrcs.slice();
    // Sort mode applied AFTER filter so the user sees the relevant set in
    // the chosen order. 'name' = lexicographic A→Z, 'recent' = LRU-first
    // from `pickerRecent`, then alpha for the tail, 'source' = group by
    // origin (stdlib first → basic → completions → stdstale).
    if (pickerSort === 'recent' && pickerRecent.length > 0) {
      const rec = new Set(pickerRecent);
      const recentSet = base.filter((s) => rec.has(s)).sort((a, b) => pickerRecent.indexOf(a) - pickerRecent.indexOf(b));
      const rest = base.filter((s) => !rec.has(s)).sort();
      return [...recentSet, ...rest];
    }
    if (pickerSort === 'source') {
      const order = { stdlib: 0, basic: 1, volume: 1, completions: 2, stdstale: 3 } as Record<string, number>;
      return base.sort((a, b) => {
        const sa = order[pickerSrcMeta[a]?.source ?? 'volume'] ?? 9;
        const sb = order[pickerSrcMeta[b]?.source ?? 'volume'] ?? 9;
        return sa !== sb ? sa - sb : a.localeCompare(b);
      });
    }
    return base.sort();
  });
</script>

<svelte:head>
  <title>Graph editor · CAD Train</title>
  {#if embed}
    <!-- Hide the outer SvelteKit layout chrome when iframed. Injected as
         raw CSS in <head> so it can reach across scoped boundaries. -->
    {@html `<style>
      #nav-menu-wrapper { display: none !important; }
      .layout { padding: 0 !important; height: 100% !important; }
      .layout .content { padding: 0 !important; height: 100% !important; }
      html, body { height: 100%; margin: 0; overflow: hidden; }
    </style>`}
  {/if}
</svelte:head>

<div class="ge-root" class:embed>
  <!-- Title + id input removed (2026-06-09 — redundant with the /primitives
       tab strip showing the part id; the rename / save-as flow surfaces a
       prompt on demand instead of the always-on input). The graph editor
       header row is gone; the canvas + left vertical rail now sit flush
       with the page chrome above. -->

  {#if emitted.validationErrors.length > 0}
    <!-- Broken-reference banner. Surfaces deleted-node / deleted-param refs
         BEFORE the bake explodes as a cryptic WASM out-of-bounds. Each row
         is precise enough to find + fix in the editor: node id + slot + the
         missing ref. Clicking selects the offending node. -->
    <div class="ge-valerr" role="status" aria-live="polite">
      <strong>⚠ {emitted.validationErrors.length} broken reference{emitted.validationErrors.length === 1 ? '' : 's'}</strong>
      <span class="ge-valerr-hint">— bake will fail until fixed:</span>
      <ul>
        {#each emitted.validationErrors as e (e.nodeId + e.slot)}
          <li>
            <button class="ge-valerr-chip" type="button" title="Pan to {e.nodeId}"
              onclick={() => panToNode(e.nodeId)}>{e.nodeId}</button>
            <span class="ge-valerr-slot">{e.slot}</span>
            →
            <span class="ge-valerr-bad" title={e.kind}>{e.kind === 'missing-param' ? 'param' : 'node'} "{e.badRef}" not found</span>
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  <!-- Vertical toolbar — primary actions stacked left of the canvas. Each
       button is icon-only with a data-tip; the dark tooltip layer (mounted
       in onMount) renders the labels on hover. Auto-layout + Push apart
       moved to a canvas-settings popover. -->
  <aside class="ge-vrail" bind:this={vrailEl}>
    <!-- Operations: polygon, solids, ops, position, container.
         Pencil icon = "drop a graph operation" — drawing/structural ops. -->
    <button class="ge-vrail-btn" type="button"
      bind:this={dropBtnEl} onclick={openPicker}
      data-tip="Drop an operation (polygon, solid, op, position, container)">✎</button>
    <!-- Fetch + drop a saved primitive part. Distinct from the
         operations menu — this is for stamping a saved Call into the
         graph. + icon emphasises 'add a part'. -->
    <button class="ge-vrail-btn" type="button"
      bind:this={callBtnEl} onclick={openCallPicker}
      data-tip="Fetch a part — primitives library">+</button>
    <!-- Click-to-connect: tap a source socket, then a target socket — no
         dragging. Always available on touch; this toggle turns it on for the
         mouse too. Drag-to-wire still works regardless. -->
    <button class="ge-vrail-btn connect" type="button"
      class:on={wire.connectMode}
      onclick={() => { wire.connectMode = !wire.connectMode; if (!wire.connectMode) { wire.from = null; wire.mouse = null; } }}
      data-tip={wire.connectMode
        ? 'Click-to-connect ON — tap a source socket, then a target (Esc cancels)'
        : 'Click-to-connect — wire two sockets by tapping them, no dragging'}>🔗</button>
    <!-- ── Authoring group: expressions · types · suggestions ── -->
    <div class="ge-vrail-sep"></div>
    <!-- Σ Expression builder (B.6 / id 914) — open the calculated-expression
         popover, seeded with the part's param names as the input schema. -->
    <button class="ge-vrail-btn expr" type="button"
      class:on={!!exprMenu || !!exprPop}
      onclick={openExprPop}
      data-tip="Expressions — define reusable calc blocks, then drop instances to wire">Σ</button>
    <!-- ◇ Type Definer (typed-ports) — define/manage composite record types
         (Point{r,z}, Casing{…}) in the shared volume library. -->
    <button class="ge-vrail-btn types" type="button"
      class:on={typesPop}
      onclick={() => (typesPop = !typesPop)}
      data-tip="Types — define composite shapes (records) for the node graph">◇</button>
    <!-- ✨ Suggested wirings — the generative typed-ports hook: type-matched
         output→slot pairs you can apply with one click. -->
    <button class="ge-vrail-btn suggest" type="button"
      class:on={suggestPop}
      onclick={() => (suggestPop = !suggestPop)}
      data-tip="Suggest wirings — type-compatible output → slot pairs (e.g. a list⟨point⟩ expression into a polygon)">✨</button>
    <!-- ── end authoring group ── -->
    <div class="ge-vrail-sep"></div>
    <button class="ge-vrail-btn save" type="button" disabled={saveBusy || emitted.validationErrors.length > 0} onclick={saveGraph}
      data-tip={saveBusy ? 'Saving…' : emitted.validationErrors.length > 0 ? `Fix ${emitted.validationErrors.length} broken reference${emitted.validationErrors.length === 1 ? '' : 's'} before saving` : `Save ${exemplarId} to the volume`}>💾</button>
    <button class="ge-vrail-btn bake" type="button" onclick={runBake}
      class:stale={bakeStale}
      data-tip={bakeStale ? 'Source changed — click or press Enter to re-bake' : 'Bake now (Enter in any input also bakes)'}>
      {bakeStale ? '🔨●' : '🔨'}
    </button>
    <button class="ge-vrail-btn auto" type="button"
      class:on={autoBake}
      onclick={() => setAutoBake(!autoBake)}
      data-tip={autoBake ? 'Auto-bake ON — toggle off to bake only on demand' : 'Auto-bake OFF — toggle on to bake on every change (700 ms debounce)'}>
      ⚡
    </button>
    <!-- Bake BACKEND toggle (client-exec): 💻 local (Manifold Web Worker) vs
         ☁ remote (server /api/primitives/preview). Persisted; the bake pane's
         badge + the SRC ⚡compiled subtab reflect it. -->
    <button class="ge-vrail-btn bakeloc" type="button"
      class:on={scene.clientBake}
      onclick={() => { scene.clientBake = !scene.clientBake; try { localStorage.setItem('cad-client-bake', scene.clientBake ? '1' : '0'); } catch {} }}
      data-tip={scene.clientBake ? 'Bake = LOCAL (client Web Worker). Click → switch to remote (server).' : 'Bake = REMOTE (server). Click → switch to local (client Web Worker).'}>
      {scene.clientBake ? '💻' : '☁'}
    </button>
    {#if ghostIds.length > 0}
      <button class="ge-vrail-btn ghost-clear" type="button"
        onclick={clearAllGhosts}
        data-tip={`Clear ${ghostIds.length} ghost overlay${ghostIds.length === 1 ? '' : 's'} and bake the final result`}>
        👁✕<span class="ge-vrail-badge">{ghostIds.length}</span>
      </button>
    {/if}
    {#if undoLayout}
      <button class="ge-vrail-btn" type="button" onclick={undoAutoLayout}
        data-tip="Restore the prior layout (undo auto-layout / push apart)">↶</button>
    {/if}
    <div class="ge-vrail-sep"></div>
    <button class="ge-vrail-btn settings" type="button"
      bind:this={settingsBtnEl}
      onclick={() => canvasMenuOpen ? (canvasMenuOpen = false) : openCanvasMenu()}
      class:on={canvasMenuOpen}
      data-tip="Layout tools — auto-layout (+ push apart), edge bounds">⚙</button>
    <!-- ✨ AI generate sits CENTERED in the gap between ⚙ and reset:
         an equal flex spacer above and below floats it to the midpoint. -->
    <div class="ge-vrail-spacer"></div>
    {#if props.onGenerated}
      <button class="ge-vrail-btn ai" type="button"
        bind:this={aiBtnEl}
        class:on={aiMenuOpen}
        onclick={() => aiMenuOpen ? (aiMenuOpen = false) : openAiMenu()}
        data-tip="Generate a part from a description (AI)">✨</button>
    {/if}
    <div class="ge-vrail-spacer"></div>
    <button class="ge-vrail-btn reset" type="button" onclick={resetGraph}
      data-tip="Reset the graph to an empty canvas">⟲</button>
  </aside>

  {#if exprMenu}
    <ExpressionsMenu
      defs={graph.exprDefs ?? []}
      instanceCounts={exprInstanceCounts}
      anchor={exprMenu.anchor}
      onAdd={addExprDefAndEdit}
      onEdit={editExprDefFromMenu}
      onDrop={dropExprInstance}
      onDelete={deleteExprDef}
      onClose={() => (exprMenu = null)} />
  {/if}

  {#if exprPop && exprPopDef}
    <ExpressionBuilderPopup
      def={exprPopDef}
      anchor={exprPop.anchor}
      onCommit={commitExpr}
      onCancel={() => (exprPop = null)} />
  {/if}

  {#if typesPop}
    <TypeDefinerPopover onClose={() => (typesPop = false)} />
  {/if}

  {#if suggestPop}
    <AutoWireSuggestPanel {graph} setGraph={(g) => (graph = g)} onClose={() => (suggestPop = false)} />
  {/if}

  {#if aiMenuOpen}
    <AiMenu
      pos={aiMenuPos}
      onGenerated={handleAiGenerated}
      onClose={() => (aiMenuOpen = false)} />
  {/if}

  {#if canvasMenuOpen}
    <CanvasMenu
      pos={canvasMenuPos}
      onAutoLayout={autoLayout}
      onPushApart={pushApart}
      {boundLeft}
      {boundTop}
      {boundRight}
      onSetBound={setBound}
      onClose={() => (canvasMenuOpen = false)} />
  {/if}

  <main class="ge-grid" bind:this={gridEl}
    style="grid-template-columns: {splitA}% 6px 1fr">
    <!-- LEFT — graph canvas -->
    <section class="ge-canvas-pane">
      {#if wire.from && wire.tapConnect}
        <div class="ge-connect-hint">🔗 Tap a target socket to connect · <kbd>Esc</kbd> to cancel</div>
      {/if}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <svg
        bind:this={canvasEl}
        class="ge-canvas"
        class:dragging={!!dragging || !!wire.from}
        class:drop-target={dragOverActive}
        xmlns="http://www.w3.org/2000/svg"
        role="application"
        aria-label="Graph canvas"
        onpointerdown={onCanvasPointerDown}
        onpointermove={onCanvasPointerMove}
        onpointerup={onCanvasPointerUp}
        onwheel={onCanvasWheel}
        ondragover={onCanvasDragOver}
        ondragleave={onCanvasDragLeave}
        ondrop={onCanvasDrop}
      >
        <g transform="translate({pan.x},{pan.y}) scale({zoom})">
          <defs>
            <pattern id="ge-grid" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M40 0 L0 0 0 40" fill="none" stroke="#e5e7eb" stroke-width="0.5"/>
            </pattern>
            <!-- Sequence-arrow head for the inline transform-chain arrows. -->
            <marker id="ge-xform-arrowhead" viewBox="0 0 8 8" refX="6" refY="4"
              markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0 0 L8 4 L0 8 z" fill="#7c3aed"/>
            </marker>
          </defs>
          <rect x="-2000" y="-2000" width="4000" height="4000" fill="url(#ge-grid)"/>

          <!-- PARAM CHIPS render OUTSIDE the pan/zoom group (below) so they
               stay tacked to the viewport top-left even when the canvas
               is panned. -->
          {#if paramEntries.length === 0}
            <text x="120" y="35" class="ge-canvas-hint">← drop an outer dial here; drag its socket onto an arg.</text>
          {/if}

          <!-- PARAM WIRES — for every {Call.args[k] OR mv.offset[i] OR rot.rot[i]}
               with kind 'param', draw a bezier from the param chip's output
               socket to the consumer's input socket. -->
          {#each allNodes as n (n.id)}
            {#if n.type === 'call'}
              {#each Object.entries((n as any).args ?? {}) as [k, v], argIdx (k)}
                {#if (v as any).kind === 'param'}
                  {@const pIdx = paramEntries.findIndex(([nm]) => nm === (v as any).param)}
                  {#if pIdx >= 0 && leftTab === 'params'}
                    {@const ps = paramSocketPos(CARD_Y0, PARAM_W, pan, zoom,(v as any).param, pIdx)}
                    {@const pos = nodePos(n.id)}
                    {@const argY = pos.y + 36 + 14 + argIdx * 22}
                    <path class="ge-wire param" d={bezier(cardObstacles,ps.x, ps.y, pos.x, argY)}/>
                  {/if}
                {:else if (v as any).kind === 'expr'}
                  <!-- Expression arg — draw a wire from EACH referenced
                       p.<name> chip to this slot. Multi-source = visually
                       obvious; styled .expr to distinguish from direct
                       param wires (amber dashed vs orange dashed). -->
                  {#each extractParamRefs((v as any).expr) as refName (refName)}
                    {@const pIdx = paramEntries.findIndex(([nm]) => nm === refName)}
                    {#if pIdx >= 0 && leftTab === 'params'}
                      {@const ps = paramSocketPos(CARD_Y0, PARAM_W, pan, zoom,refName, pIdx)}
                      {@const pos = nodePos(n.id)}
                      {@const argY = pos.y + 36 + 14 + argIdx * 22}
                      <path class="ge-wire param expr" d={bezier(cardObstacles,ps.x, ps.y, pos.x, argY)}/>
                    {/if}
                  {/each}
                  <!-- NODE-REF expr — `__POLY__<sourceId>` sentinel set by
                       endWireOnCallArg when the user drags from a polygon
                       (or any producer) output socket onto this Call arg.
                       Render a green bezier from the source node's right
                       output socket to the input arg socket, matching the
                       polygon → revolve wire the user just made visible. -->
                  {@const polyMatch = String((v as any).expr ?? '').match(/^__POLY__(n_[a-z0-9]+)$/i)}
                  {#if polyMatch && graph.nodes[polyMatch[1]]}
                    {@const sourceId = polyMatch[1]}
                    {@const srcSize = nodeSize(graph,graph.nodes[sourceId])}
                    {@const srcPos = nodePos(sourceId)}
                    {@const pos = nodePos(n.id)}
                    {@const argY = pos.y + 36 + 14 + argIdx * 22}
                    <path class="ge-wire noderef"
                      d={bezier(cardObstacles,srcPos.x + srcSize.w, srcPos.y + srcSize.h / 2, pos.x, argY)}/>
                  {/if}
                  <!-- EXPR-OUTPUT ref — the arg references an expr instance's
                       emitted output const (_x_<id>_<out>). Draw a wire from
                       that instance's right-edge output socket → this arg. -->
                  {#each allNodes as exn (exn.id)}
                    {#if exn.type === 'expr'}
                      {@const exDef = (graph.exprDefs ?? []).find((d) => d.id === (exn as any).defId)}
                      {#each ((exDef as any)?.outputs ?? []) as eo, eoIdx (eo.name)}
                        {#if String((v as any).expr ?? '').includes(exprBlockMember(exn.id, eo.name))}
                          {@const srcSize = nodeSize(graph, exn)}
                          {@const srcPos = nodePos(exn.id)}
                          {@const cpos = nodePos(n.id)}
                          {@const cargY = cpos.y + 36 + 14 + argIdx * 22}
                          <path class="ge-wire noderef" d={bezier(cardObstacles, srcPos.x + srcSize.w, srcPos.y + exprOutputSockY(eoIdx), cpos.x, cargY)}/>
                        {/if}
                      {/each}
                    {/if}
                  {/each}
                {/if}
              {/each}
              <!-- Attached transform axis wires (every mv/rot in the chain that
                   bottoms out at this Call) — endpoints come from xformSocketAt()
                   so each wire lands on the moved strip socket exactly. -->
              {#each attachedTransforms(graph, n.id) as xId, xi (xId)}
                {@const xn = graph.nodes[xId]}
                {@const vals = xn.type === 'rot' ? (xn as RotNode).rot : (xn as MvNode).offset}
                {#each [0,1,2] as i (i)}
                  {@const av = vals[i] as any}
                  {#if av.kind === 'param'}
                    {@const pIdx = paramEntries.findIndex(([nm]) => nm === av.param)}
                    {#if pIdx >= 0 && leftTab === 'params'}
                      {@const ps = paramSocketPos(CARD_Y0, PARAM_W, pan, zoom, av.param, pIdx)}
                      {@const pos = nodePos(n.id)}
                      {@const sk = xformSocketAt(graph, n.id, xi, i)}
                      <path class="ge-wire param" d={bezier(cardObstacles,ps.x, ps.y, pos.x + sk.x, pos.y + sk.y)}/>
                    {/if}
                  {:else if av.kind === 'expr'}
                    {#each extractParamRefs(av.expr) as refName (refName)}
                      {@const pIdx = paramEntries.findIndex(([nm]) => nm === refName)}
                      {#if pIdx >= 0 && leftTab === 'params'}
                        {@const ps = paramSocketPos(CARD_Y0, PARAM_W, pan, zoom, refName, pIdx)}
                        {@const pos = nodePos(n.id)}
                        {@const sk = xformSocketAt(graph, n.id, xi, i)}
                        <path class="ge-wire param expr" d={bezier(cardObstacles,ps.x, ps.y, pos.x + sk.x, pos.y + sk.y)}/>
                      {/if}
                    {/each}
                    <!-- EXPR-OUTPUT ref → transform axis socket. -->
                    {@const tpos = nodePos(n.id)}
                    {@const tsk = xformSocketAt(graph, n.id, xi, i)}
                    {#each allNodes as exn (exn.id)}
                      {#if exn.type === 'expr'}
                        {@const exDef = (graph.exprDefs ?? []).find((d) => d.id === (exn as any).defId)}
                        {#each ((exDef as any)?.outputs ?? []) as eo, eoIdx (eo.name)}
                          {#if String(av.expr ?? '').includes(exprBlockMember(exn.id, eo.name))}
                            {@const srcSize = nodeSize(graph, exn)}
                            {@const srcPos = nodePos(exn.id)}
                            <path class="ge-wire noderef" d={bezier(cardObstacles, srcPos.x + srcSize.w, srcPos.y + exprOutputSockY(eoIdx), tpos.x + tsk.x, tpos.y + tsk.y)}/>
                          {/if}
                        {/each}
                      {/if}
                    {/each}
                  {/if}
                {/each}
              {/each}
            {:else if n.type === 'repeat'}
              <!-- Repeat count param-wire — chip → top-left count socket -->
              {#if (n as any).count?.kind === 'param'}
                {@const pIdx = paramEntries.findIndex(([nm]) => nm === (n as any).count.param)}
                {#if pIdx >= 0 && leftTab === 'params'}
                  {@const ps = paramSocketPos(CARD_Y0, PARAM_W, pan, zoom,(n as any).count.param, pIdx)}
                  {@const pos = nodePos(n.id)}
                  <path class="ge-wire param" d={bezier(cardObstacles,ps.x, ps.y, pos.x, pos.y + 17)}/>
                {/if}
              {:else if (n as any).count?.kind === 'expr'}
                {#each extractParamRefs((n as any).count.expr) as refName (refName)}
                  {@const pIdx = paramEntries.findIndex(([nm]) => nm === refName)}
                  {#if pIdx >= 0 && leftTab === 'params'}
                    {@const ps = paramSocketPos(CARD_Y0, PARAM_W, pan, zoom,refName, pIdx)}
                    {@const pos = nodePos(n.id)}
                    <path class="ge-wire param expr" d={bezier(cardObstacles,ps.x, ps.y, pos.x, pos.y + 17)}/>
                  {/if}
                {/each}
                <!-- EXPR-OUTPUT ref → repeat count socket. -->
                {@const rpos = nodePos(n.id)}
                {#each allNodes as exn (exn.id)}
                  {#if exn.type === 'expr'}
                    {@const exDef = (graph.exprDefs ?? []).find((d) => d.id === (exn as any).defId)}
                    {#each ((exDef as any)?.outputs ?? []) as eo, eoIdx (eo.name)}
                      {#if String((n as any).count.expr ?? '').includes(exprBlockMember(exn.id, eo.name))}
                        {@const srcSize = nodeSize(graph, exn)}
                        {@const srcPos = nodePos(exn.id)}
                        <path class="ge-wire noderef" d={bezier(cardObstacles, srcPos.x + srcSize.w, srcPos.y + exprOutputSockY(eoIdx), rpos.x, rpos.y + 17)}/>
                      {/if}
                    {/each}
                  {/if}
                {/each}
              {/if}
            {:else if n.type === 'polygon'}
              <!-- Polygon per-coord param wires. Each vertex has two
                   input sockets stacked on the LEFT edge of the card at
                   y = polySockR/Z(n, idx) — cumulative row walk that
                   mirrors the .ge-poly-vertex / .ge-poly-rref CSS.
                   Walk every point; for each coord with kind:'param'
                   (or 'expr' referencing p.<name>), draw a bezier from
                   the chip's output socket to that coord's input socket. -->
              {#each ((n as any).points ?? []) as pt, idx (idx)}
                {@const pos = nodePos(n.id)}
                {@const rTopY = pos.y + polySockR(n, idx)}
                {@const zTopY = pos.y + polySockZ(n, idx)}
                {#if pt.r?.kind === 'param'}
                  {@const pIdx = paramEntries.findIndex(([nm]) => nm === pt.r.param)}
                  {#if pIdx >= 0 && leftTab === 'params'}
                    {@const ps = paramSocketPos(CARD_Y0, PARAM_W, pan, zoom,pt.r.param, pIdx)}
                    <path class="ge-wire param" d={bezier(cardObstacles,ps.x, ps.y, pos.x, rTopY)}/>
                  {/if}
                {:else if pt.r?.kind === 'expr'}
                  {#each extractParamRefs(pt.r.expr) as refName (refName)}
                    {@const pIdx = paramEntries.findIndex(([nm]) => nm === refName)}
                    {#if pIdx >= 0 && leftTab === 'params'}
                      {@const ps = paramSocketPos(CARD_Y0, PARAM_W, pan, zoom,refName, pIdx)}
                      <path class="ge-wire param expr" d={bezier(cardObstacles,ps.x, ps.y, pos.x, rTopY)}/>
                    {/if}
                  {/each}
                  <!-- EXPR-OUTPUT ref → polygon r coord. -->
                  {#each allNodes as exn (exn.id)}
                    {#if exn.type === 'expr'}
                      {@const exDef = (graph.exprDefs ?? []).find((d) => d.id === (exn as any).defId)}
                      {#each ((exDef as any)?.outputs ?? []) as eo, eoIdx (eo.name)}
                        {#if String(pt.r.expr ?? '').includes(exprBlockMember(exn.id, eo.name))}
                          {@const srcSize = nodeSize(graph, exn)}
                          {@const srcPos = nodePos(exn.id)}
                          <path class="ge-wire noderef" d={bezier(cardObstacles, srcPos.x + srcSize.w, srcPos.y + exprOutputSockY(eoIdx), pos.x, rTopY)}/>
                        {/if}
                      {/each}
                    {/if}
                  {/each}
                {/if}
                {#if pt.z?.kind === 'param'}
                  {@const pIdx = paramEntries.findIndex(([nm]) => nm === pt.z.param)}
                  {#if pIdx >= 0 && leftTab === 'params'}
                    {@const ps = paramSocketPos(CARD_Y0, PARAM_W, pan, zoom,pt.z.param, pIdx)}
                    <path class="ge-wire param" d={bezier(cardObstacles,ps.x, ps.y, pos.x, zTopY)}/>
                  {/if}
                {:else if pt.z?.kind === 'expr'}
                  {#each extractParamRefs(pt.z.expr) as refName (refName)}
                    {@const pIdx = paramEntries.findIndex(([nm]) => nm === refName)}
                    {#if pIdx >= 0 && leftTab === 'params'}
                      {@const ps = paramSocketPos(CARD_Y0, PARAM_W, pan, zoom,refName, pIdx)}
                      <path class="ge-wire param expr" d={bezier(cardObstacles,ps.x, ps.y, pos.x, zTopY)}/>
                    {/if}
                  {/each}
                  <!-- EXPR-OUTPUT ref → polygon z coord. -->
                  {#each allNodes as exn (exn.id)}
                    {#if exn.type === 'expr'}
                      {@const exDef = (graph.exprDefs ?? []).find((d) => d.id === (exn as any).defId)}
                      {#each ((exDef as any)?.outputs ?? []) as eo, eoIdx (eo.name)}
                        {#if String(pt.z.expr ?? '').includes(exprBlockMember(exn.id, eo.name))}
                          {@const srcSize = nodeSize(graph, exn)}
                          {@const srcPos = nodePos(exn.id)}
                          <path class="ge-wire noderef" d={bezier(cardObstacles, srcPos.x + srcSize.w, srcPos.y + exprOutputSockY(eoIdx), pos.x, zTopY)}/>
                        {/if}
                      {/each}
                    {/if}
                  {/each}
                {/if}
                <!-- Repeat-ref wire (#157) — from the source poly_repeat's
                     output socket to this row's input socket on the
                     polygon's left edge. Distinctive violet skin so it
                     reads as "this loop feeds this row". -->
                {#if pt?.kind === 'repeat-ref'}
                  {@const src = graph.nodes[pt.sourceId]}
                  {#if src && src.type === 'poly_repeat'}
                    {@const srcXY = nodePos(src.id)}
                    {@const srcSize = nodeSize(graph,src as any)}
                    {@const srcX = srcXY.x + srcSize.w}
                    {@const srcY = srcXY.y + srcSize.h / 2}
                    {@const tgtX = pos.x}
                    {@const tgtY = pos.y + polySockRef(n, idx)}
                    <path class="ge-wire poly-rref" d={bezier(cardObstacles,srcX, srcY, tgtX, tgtY)} fill="none"/>
                  {/if}
                {/if}
              {/each}
            {:else if n.type === 'sketch'}
              <!-- Sketch per-coord param wires (main canvas) — mirror the
                   polygon pass. Each op's coord input sockets sit on the LEFT
                   edge at sketchSockR/Z/Val(n, idx); draw a bezier from the
                   param chip's output socket to any param/expr-wired coord so
                   the wiring is visible in the graph, not just the sketcher. -->
              {#each ((n as any).ops ?? []) as op, idx (idx)}
                {@const pos = nodePos(n.id)}
                {@const fields = (op.op === 'line' || op.op === 'spline')
                  ? [['r', sketchSockR(n, idx)], ['z', sketchSockZ(n, idx)]]
                  : op.op === 'fillet' ? [['radius', sketchSockVal(n, idx)]]
                  : op.op === 'chamfer' ? [['dist', sketchSockVal(n, idx)]] : []}
                {#each fields as [field, sy] (field)}
                  {@const av = (op as any)[field]}
                  {#if av?.kind === 'param'}
                    {@const pIdx = paramEntries.findIndex(([nm]) => nm === av.param)}
                    {#if pIdx >= 0 && leftTab === 'params'}
                      {@const ps = paramSocketPos(CARD_Y0, PARAM_W, pan, zoom,av.param, pIdx)}
                      <path class="ge-wire param" d={bezier(cardObstacles,ps.x, ps.y, pos.x, pos.y + (sy as number))}/>
                    {/if}
                  {:else if av?.kind === 'expr'}
                    {#each extractParamRefs(av.expr) as refName (refName)}
                      {@const pIdx = paramEntries.findIndex(([nm]) => nm === refName)}
                      {#if pIdx >= 0 && leftTab === 'params'}
                        {@const ps = paramSocketPos(CARD_Y0, PARAM_W, pan, zoom,refName, pIdx)}
                        <path class="ge-wire param expr" d={bezier(cardObstacles,ps.x, ps.y, pos.x, pos.y + (sy as number))}/>
                      {/if}
                    {/each}
                    <!-- EXPR-OUTPUT ref → sketch op coord/point socket. -->
                    {#each allNodes as exn (exn.id)}
                      {#if exn.type === 'expr'}
                        {@const exDef = (graph.exprDefs ?? []).find((d) => d.id === (exn as any).defId)}
                        {#each ((exDef as any)?.outputs ?? []) as eo, eoIdx (eo.name)}
                          {#if String(av.expr ?? '').includes(exprBlockMember(exn.id, eo.name))}
                            {@const srcSize = nodeSize(graph, exn)}
                            {@const srcPos = nodePos(exn.id)}
                            <path class="ge-wire noderef" d={bezier(cardObstacles, srcPos.x + srcSize.w, srcPos.y + exprOutputSockY(eoIdx), pos.x, pos.y + (sy as number))}/>
                          {/if}
                        {/each}
                      {/if}
                    {/each}
                  {/if}
                {/each}
              {/each}
            {:else if n.type === 'expr'}
              <!-- EXPR INSTANCE param wires (B.7 v3). For each PARAM binding
                   that references a p.<name> chip, draw a bezier from that chip
                   to the instance's input socket (left edge, line-aligned to the
                   param's row via exprInputSockY). Without this the binding sets
                   but no wire is visible. -->
              {@const exDef = (graph.exprDefs ?? []).find((d) => d.id === (n as any).defId)}
              {@const exBind = (n as any).bindings ?? {}}
              {#if exDef && leftTab === 'params'}
                {@const pos = nodePos(n.id)}
                {#each ((exDef as any).params ?? []) as ep, epIdx (ep.name)}
                  {@const bind = exBind[ep.name]}
                  {#if bind?.kind === 'param'}
                    {@const pIdx = paramEntries.findIndex(([nm]) => nm === bind.param)}
                    {#if pIdx >= 0}
                      {@const ps = paramSocketPos(CARD_Y0, PARAM_W, pan, zoom, bind.param, pIdx)}
                      <path class="ge-wire param" d={bezier(cardObstacles, ps.x, ps.y, pos.x, pos.y + exprInputSockY(epIdx))}/>
                    {/if}
                  {:else if bind?.kind === 'expr'}
                    {#each extractParamRefs(bind.expr) as refName (refName)}
                      {@const pIdx = paramEntries.findIndex(([nm]) => nm === refName)}
                      {#if pIdx >= 0}
                        {@const ps = paramSocketPos(CARD_Y0, PARAM_W, pan, zoom, refName, pIdx)}
                        <path class="ge-wire param expr" d={bezier(cardObstacles, ps.x, ps.y, pos.x, pos.y + exprInputSockY(epIdx))}/>
                      {/if}
                    {/each}
                  {/if}
                {/each}
              {/if}
            {:else if n.type === 'poly_repeat'}
              <!-- PolyRepeat NPts (count) param wire (2026-06-11). When
                   count is kind:'param', draw a bezier from the param
                   chip's output to the loop card's NPts input socket
                   on the left edge at y=57. Mirror branch for expr
                   coords that REFERENCE a p.<name>. -->
              {@const pos = nodePos(n.id)}
              {@const tgtX = pos.x}
              {@const tgtY = pos.y + 57}
              {#if (n as any).count?.kind === 'param'}
                {@const pIdx = paramEntries.findIndex(([nm]) => nm === (n as any).count.param)}
                {#if pIdx >= 0 && leftTab === 'params'}
                  {@const ps = paramSocketPos(CARD_Y0, PARAM_W, pan, zoom,(n as any).count.param, pIdx)}
                  <path class="ge-wire param" d={bezier(cardObstacles,ps.x, ps.y, tgtX, tgtY)}/>
                {/if}
              {:else if (n as any).count?.kind === 'expr'}
                {#each extractParamRefs((n as any).count.expr) as refName (refName)}
                  {@const pIdx = paramEntries.findIndex(([nm]) => nm === refName)}
                  {#if pIdx >= 0 && leftTab === 'params'}
                    {@const ps = paramSocketPos(CARD_Y0, PARAM_W, pan, zoom,refName, pIdx)}
                    <path class="ge-wire param expr" d={bezier(cardObstacles,ps.x, ps.y, tgtX, tgtY)}/>
                  {/if}
                {/each}
                <!-- EXPR-OUTPUT ref → poly_repeat NPts socket. -->
                {#each allNodes as exn (exn.id)}
                  {#if exn.type === 'expr'}
                    {@const exDef = (graph.exprDefs ?? []).find((d) => d.id === (exn as any).defId)}
                    {#each ((exDef as any)?.outputs ?? []) as eo, eoIdx (eo.name)}
                      {#if String((n as any).count.expr ?? '').includes(exprBlockMember(exn.id, eo.name))}
                        {@const srcSize = nodeSize(graph, exn)}
                        {@const srcPos = nodePos(exn.id)}
                        <path class="ge-wire noderef" d={bezier(cardObstacles, srcPos.x + srcSize.w, srcPos.y + exprOutputSockY(eoIdx), tgtX, tgtY)}/>
                      {/if}
                    {/each}
                  {/if}
                {/each}
              {/if}
            {:else if n.type === 'txfmn'}
              <!-- Standalone xform axis wires (B.7 v3). Six axis sockets on the
                   left edge at cy = 48 + i*24 (rot x/y/z then mv x/y/z; mirrors
                   NodeCard axisStartY=40 + i*axisRowH=24 + 12 − 4). For each axis
                   that is param/expr-wired, draw the param-chip wire; for each
                   that references an expr instance's OUTPUT const, draw the
                   expr-output wire. -->
              {@const tpos = nodePos(n.id)}
              {#each [0, 1, 2, 3, 4, 5] as i (i)}
                {@const sa = (i % 3) as 0 | 1 | 2}
                {@const av = (i < 3 ? (n as any).rot : (n as any).offset)?.[sa]}
                {@const tgtY = tpos.y + 48 + i * 24}
                {#if av?.kind === 'param'}
                  {@const pIdx = paramEntries.findIndex(([nm]) => nm === av.param)}
                  {#if pIdx >= 0 && leftTab === 'params'}
                    {@const ps = paramSocketPos(CARD_Y0, PARAM_W, pan, zoom, av.param, pIdx)}
                    <path class="ge-wire param" d={bezier(cardObstacles, ps.x, ps.y, tpos.x, tgtY)}/>
                  {/if}
                {:else if av?.kind === 'expr'}
                  {#each extractParamRefs(av.expr) as refName (refName)}
                    {@const pIdx = paramEntries.findIndex(([nm]) => nm === refName)}
                    {#if pIdx >= 0 && leftTab === 'params'}
                      {@const ps = paramSocketPos(CARD_Y0, PARAM_W, pan, zoom, refName, pIdx)}
                      <path class="ge-wire param expr" d={bezier(cardObstacles, ps.x, ps.y, tpos.x, tgtY)}/>
                    {/if}
                  {/each}
                  <!-- EXPR-OUTPUT ref → txfmn axis socket. -->
                  {#each allNodes as exn (exn.id)}
                    {#if exn.type === 'expr'}
                      {@const exDef = (graph.exprDefs ?? []).find((d) => d.id === (exn as any).defId)}
                      {#each ((exDef as any)?.outputs ?? []) as eo, eoIdx (eo.name)}
                        {#if String(av.expr ?? '').includes(exprBlockMember(exn.id, eo.name))}
                          {@const srcSize = nodeSize(graph, exn)}
                          {@const srcPos = nodePos(exn.id)}
                          <path class="ge-wire noderef" d={bezier(cardObstacles, srcPos.x + srcSize.w, srcPos.y + exprOutputSockY(eoIdx), tpos.x, tgtY)}/>
                        {/if}
                      {/each}
                    {/if}
                  {/each}
                {/if}
              {/each}
            {/if}
          {/each}

          <!-- WIRES: render method.obj/arg + transform.child as bezier paths. -->
          {#each allNodes as n (n.id)}
            {#if n.type === 'method'}
              {#if (n as any).obj && graph.nodes[(n as any).obj]}
                {@const src = outputSocketAt(graph,(n as any).obj)}
                {@const tgt = inputSocketAt(graph,n.id, 'obj')}
                <path class="ge-wire obj" d={bezier(cardObstacles,src.x, src.y, tgt.x, tgt.y)} fill="none"/>
              {/if}
              {#if (n as any).arg && graph.nodes[(n as any).arg]}
                {@const src = outputSocketAt(graph,(n as any).arg)}
                {@const tgt = inputSocketAt(graph,n.id, 'arg')}
                <path class="ge-wire arg" d={bezier(cardObstacles,src.x, src.y, tgt.x, tgt.y)} fill="none"/>
              {/if}
            {:else if n.type === 'mv' || n.type === 'rot'}
              {#if (n as any).child && graph.nodes[(n as any).child]}
                {@const src = outputSocketAt(graph,(n as any).child)}
                {@const tgt = inputSocketAt(graph,n.id, 'child')}
                <path class="ge-wire child" d={bezier(cardObstacles,src.x, src.y, tgt.x, tgt.y)} fill="none"/>
              {/if}
            {:else if n.type === 'txfmn'}
              <!-- txfmn child wire — same left-edge child socket as mv/rot. -->
              {#if (n as any).child && graph.nodes[(n as any).child]}
                {@const src = outputSocketAt(graph,(n as any).child)}
                {@const tgt = inputSocketAt(graph,n.id, 'child')}
                <path class="ge-wire child" d={bezier(cardObstacles,src.x, src.y, tgt.x, tgt.y)} fill="none"/>
              {/if}
            {:else if n.type === 'repeat'}
              <!-- Repeat node's PART wires — one per child, into its row socket
                   on the left edge (cy = 68 + ci*24 in the card markup). -->
              {@const pos = nodePos(n.id)}
              {#each ((n as any).children ?? []) as cid, ci (cid + ':' + ci)}
                {#if graph.nodes[cid]}
                  {@const src = outputSocketAt(graph, cid)}
                  <path class="ge-wire child" d={bezier(cardObstacles,src.x, src.y, pos.x, pos.y + 68 + ci * 24)} fill="none"/>
                {/if}
              {/each}
            {:else if n.type === 'list' || n.type === 'stack' || n.type === 'group'}
              <!-- Container wires: each visible child of a container shows as
                   a bezier from the child's output socket → the container's
                   slot input socket. For the ROOT (▶ Output), consumed
                   children are filtered out so we don't draw wires into
                   non-existent slots — matches the slot-render filter. -->
              {@const visKids = (n.id === graph.root
                ? (n as any).children.filter((cid: string) => !consumedSet.has(cid))
                : (n as any).children) as string[]}
              {#each visKids as childId, i (childId)}
                {#if graph.nodes[childId]}
                  {@const src = outputSocketAt(graph,childId)}
                  <!-- ROOT Output card centers its sockets (rootOutputSockY) —
                       the wire MUST hit the same Y, else it lands on the wrong
                       socket. Non-root containers stay top-anchored. -->
                  {@const rootPos = nodePos(n.id)}
                  {@const tgt = n.id === graph.root
                    ? { x: rootPos.x, y: rootPos.y + rootOutputSockY(nodeSize(graph, n).h, i, visKids.length) }
                    : containerSlotInputAt(graph,n.id, i)}
                  <path class="ge-wire output" class:root={n.id === graph.root}
                    d={bezier(cardObstacles,src.x, src.y, tgt.x, tgt.y)} fill="none"/>
                {/if}
              {/each}
            {/if}
          {/each}

          <!-- In-flight wire being dragged -->
          {#if wire.from && wire.mouse}
            {@const src = outputSocketAt(graph,wire.from.nodeId)}
            <path class="ge-wire in-flight" d={bezier(cardObstacles,src.x, src.y, wire.mouse.x, wire.mouse.y)} fill="none"/>
          {/if}

          <!-- NODE CARDS -->
          {#each allNodes as n (n.id)}
            <NodeCard
              {n}
              pos={nodePos(n.id)}
              size={nodeSize(graph, n)}
              {graph}
              setGraph={(g) => (graph = g)}
              {wire}
              {sketch}
              {popovers}
              {ghostSet}
              rootId={graph.root}
              onOpenTab={props.onOpenTab}
              STRIP_W={STRIP_W}
              STRIP_H={STRIP_H}
              {expected}
              {consumedSet}
              {hlVertex}
              polyPreviewFor={polyUI.polyPreviewFor}
              onBringToFront={bringToFront}
              {onNodePointerDown}
              {onNodePointerMove}
              {onNodePointerUp}
              onDeleteNode={deleteNode}
              {toggleInlineTransform}
              {toggleNodeGhost}
              {onArgEdit}
              {onArgExprEdit}
              {toggleArgExprMode}
              {unwireArgToLiteral}
              {openWirePop}
              {onTransformAxis}
              {onTransformAxisExprEdit}
              {openTransformAxisExprPop}
              {openPolyExprPop}
              {openPolyRepeatExprPop}
              {openPolyBindingExprPop}
              {openPolyRepeatCountExprPop}
              {openExprDefEditor}
              {setHoverVertex}
              {clearHoverVertex}
              openPolyPreview={polyUI.openPolyPreview}
              polyRepeatModeFor={polyUI.polyRepeatModeFor}
              polygonModeFor={polyUI.polygonModeFor}
              {onTxfmnAxis}
              {toggleTxfmnAxisExprMode}
              {onTxfmnAxisExprEdit}
              {openRepeatEditor}
              {nodeShortLabel}
              {onResizePointerDown}
              {onResizePointerMove}
              {onResizePointerUp}
            />
          {/each}

          {#if allNodes.filter((n) => n.id !== graph.root).length === 0}
            <text x="80" y="100" class="ge-canvas-hint">Click <tspan font-weight="bold">+ Drop</tspan> to add a Call, CSG op, or transform.</text>
          {/if}
        </g>

        <!-- COMBINED LEFT CARD — ONE viewport-glued card (outside the pan/zoom
             group) with a tab header. Tab "Params" shows the param chips +
             their output sockets (and the param→arg wires); tab "Properties"
             shows part-level z-offset / colour / material. Replaces the old
             stacked PROPERTIES-above-PARAMS pair to save vertical space. -->
        <foreignObject x={PROPS_X0} y={PROPS_Y0} width={PROPS_W} height={TAB_HEADER_H}>
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="ge-left-tabs" xmlns="http://www.w3.org/1999/xhtml"
               onpointerdown={(e) => e.stopPropagation()}>
            <button class="ge-left-tab" class:on={leftTab === 'params'} type="button"
              title="Part parameters" onclick={() => (leftTab = 'params')}>Params</button>
            <button class="ge-left-tab" class:on={leftTab === 'properties'} type="button"
              title="Part properties — z-offset, colours, material"
              onclick={() => (leftTab = 'properties')}>⚙ Properties</button>
          </div>
        </foreignObject>

        {#if leftTab === 'properties'}
          <!-- PROPERTIES body (PropertiesCard.svelte, Phase D) — directly below
               the tab header. Positioned with GEP's layout constants; edits
               route back through the graph mutators passed as callbacks. -->
          <PropertiesCard
            x={PROPS_X0} y={PROPS_Y0 + TAB_HEADER_H} w={PROPS_W} h={propsBodyH}
            {graph}
            {zOffsetVal}
            parts={partsForProps}
            onZOffset={onZOffset}
            onColorOuter={onPartColorOuter}
            onColorInner={onPartColorInner}
            onMaterial={onPartMaterial}
            onPartAppearance={onPartAppearance} />
        {/if}

        {#if leftTab === 'params'}
          <!-- PARAMS card (ParamsCard.svelte, Phase D) — viewport-glued, outside
               the pan/zoom group. Position math from geom (shared with the
               param→arg wires in the node arms); wire-state + add-param popover
               stay in GEP, passed as callbacks. -->
          <ParamsCard
            {paramEntries}
            {pcs}
            cardY0={CARD_Y0}
            paramW={PARAM_W}
            onOpenAddParamPop={openAddParamPop}
            {onParamDefault}
            {onRemoveParam}
            onStartParamWire={wire.startParamWire} />
        {/if}
      </svg>
      <!-- In-canvas status strip — bottom-left. Lifted out of the top
           toolbar so the canvas itself carries the local feedback
           (saveStatus + node count + zoom). Pointer-events:none on the
           wrap; the badges themselves are non-interactive so they don't
           steal canvas drags. -->
      <div class="ge-canvas-status">
        {#if saveStatus}
          <span class="ge-canvas-status-save">{saveStatus}</span>
        {/if}
        <span class="ge-canvas-status-stat">{visibleNodeCount} node{visibleNodeCount === 1 ? '' : 's'} · z {zoom.toFixed(2)}</span>
      </div>
      <!-- Boundary edge toggles (#116): the small circular buttons that
           used to sit on the canvas edges (🔒 confiner / 🔺 repellant /
           ⏹ off) were removed — the ⚙ canvas-settings menu now owns
           these as boolean checkbox rows. -->

      <!-- Full-tab sketch editor (plan M.2) — lives INSIDE .ge-canvas-pane so
           its position:absolute inset:0 overlay covers ONLY the canvas pane;
           the 3D BAKE pane stays visible on the right, separated by the
           draggable divider, and re-bakes live as the sketch changes. Tools
           rail + PARAMS + OPS on the LEFT, the 2D sketch in the CENTRE.
           ✓ Done returns to the graph. -->
      <SketchEditorPane
        {sketch} {graph} setGraph={(g) => (graph = g)} {wire}
        {paramEntries} {paramNames} {pcs} {PARAM_W}
        {onParamDefault} onOpenAddParamPop={openAddParamPop} />

      <!-- Repeat pattern editor (#7) — full-tab overlay over the canvas pane,
           mirroring the sketch editor. Mounted only when a Repeat is open; the
           overlay (iterators / PARAMS / PARTS / LOOP BODY) lives in
           RepeatEditorPane. The 3D pane re-bakes live on every `graph` mutation. -->
      {#if editingRepeatId}
        <RepeatEditorPane repeatId={editingRepeatId} {graph} {bake}
          setGraph={(g) => (graph = g)} onClose={closeRepeatEditor} />
      {/if}
    </section>

    <!-- Divider: canvas ↔ right pane -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="ge-divider" role="separator" tabindex="-1" aria-orientation="vertical"
      onpointerdown={startSplitDrag}
      onpointermove={onSplitMove}
      onpointerup={endSplitDrag}></div>

    <!-- RIGHT pane — tabbed: 3D bake / source / md / svg / glb / brep.
         Extracted to RightPane.svelte (P5/G5). The 2D profile preview stays
         here as a parent-scoped snippet (drag-wired to the polygon machinery
         + tooltip + `.ge-profile-2d*` styles). STABLE refs only — bake /
         paramDefaults / graph are passed as-is (no inline literals). -->
    <RightPane
      {bake} {exemplarId} {paramDefaults} {graph} {hasSolidProducer}
      active={props.active}
      {legacyLoad} {sourceText}
      {cutawayBusy} {cutawayStatus} {rebuildStatus} {restartBusy} {restartStatus} {mdAiBusy}
      bind:rightTab bind:drawingMd
      onRebuild={rebuildCache} onRestart={restartDevServer}
      onLoadCutaway={loadCutaway} onGenerateMd={generateMdWithAi}>
      {#snippet profilePreview()}
            <!-- Profile mode: inline SVG of the resolved polygon. The
                 graph-driven re-emit is Phase 2.2 — for now this shows
                 the on-disk build()'s shape at default params. Closure
                 (last → first vertex) drawn as a dashed line so the
                 implicit polygon-close is visible. -->
            {#if profileView}
              {@const v = profileView}
              {@const sw = Math.max(v.w, v.h) * 0.008}
              {@const vsw = Math.max(v.w, v.h) * 0.005}
              {@const ph = Math.max(v.w, v.h) * 0.012}
              <div class="ge-profile-2d">
                <div class="ge-profile-2d-head">{exemplarId} · {profilePts.length} pts · {rootPolygonMode}</div>
                <svg viewBox={v.vb} preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
                  <g transform={v.yFlip ? `scale(1, -1) translate(0, ${-(2 * v.yMin + v.h)})` : ''}>
                    {#if v.axis}
                      <!-- Revolve axis (r = 0 vertical dash line). -->
                      <line x1="0" y1={v.yMin - v.pad} x2="0" y2={v.yMin + v.h + v.pad}
                        stroke="#94a3b8" stroke-width={vsw}
                        stroke-dasharray={`${Math.max(v.w, v.h) * 0.02} ${Math.max(v.w, v.h) * 0.02}`}/>
                    {:else if v.yFlip}
                      <!-- Cartesian crosshair (extrude cross-section): show
                           both axes through (0, 0) so the user sees the
                           center the extrude rotates around. -->
                      {@const ad = `${Math.max(v.w, v.h) * 0.02} ${Math.max(v.w, v.h) * 0.02}`}
                      <line x1={v.xMin - v.pad} y1="0" x2={v.xMin + v.w + v.pad} y2="0"
                        stroke="#94a3b8" stroke-width={vsw} stroke-dasharray={ad}/>
                      <line x1="0" y1={v.yMin - v.pad} x2="0" y2={v.yMin + v.h + v.pad}
                        stroke="#94a3b8" stroke-width={vsw} stroke-dasharray={ad}/>
                    {/if}
                    <path d={v.d}
                      fill="rgba(204, 34, 34, 0.22)" stroke="#991b1b" stroke-width={sw}
                      stroke-linejoin="round"/>
                    <!-- Auto-closure dashed line — visual reminder that the
                         polygon implicitly closes the last vertex back to
                         the first. -->
                    <path d={v.dClose}
                      fill="none" stroke="#991b1b" stroke-width={sw * 0.7}
                      stroke-dasharray={`${sw * 2.5} ${sw * 2}`} stroke-linecap="round"/>
                    {#each profilePts as p, i}
                      {@const rootPoly = rootPolygonId ? (graph.nodes[rootPolygonId] as any) : null}
                      <!-- Same eval-idx → entry-idx mapping as the popup
                           preview so loop-generated points read their
                           true entry kind instead of falling off the
                           array. (2026-06-11) -->
                      {@const entryIdx = rootPoly ? entryIdxForEvalIdx(graph,rootPoly, i) : null}
                      {@const entry = entryIdx !== null ? rootPoly?.points?.[entryIdx] : null}
                      {@const fromLoop = entryIdx === null}
                      {@const parametricVertex = !!entry && entry.kind === 'point'
                        && (entry.r?.kind !== 'literal' || entry.z?.kind !== 'literal')}
                      {@const draggable = !!entry && entry.kind === 'point' && !parametricVertex && !fromLoop}
                      {@const fill = fromLoop ? '#a855f7' : (parametricVertex ? '#6d28d9' : '#991b1b')}
                      {@const stroke = fromLoop ? '#6d28d9' : (parametricVertex ? '#a78bfa' : 'none')}
                      {@const isHl = !!hlVertex && hlVertex.polyId === rootPolygonId && entryIdx === hlVertex.idx}
                      {#if isHl}
                        <circle cx={p[0]} cy={p[1]} r={ph * 2.6} fill="none" stroke="#2563eb" stroke-width={ph * 0.6} pointer-events="none"/>
                      {/if}
                      <!-- svelte-ignore a11y_no_static_element_interactions -->
                      <circle cx={p[0]} cy={p[1]} r={isHl ? ph * 1.7 : ph}
                        fill={fill}
                        stroke={stroke}
                        stroke-width={fromLoop || parametricVertex ? ph * 0.5 : 0}
                        class:locked={!draggable}
                        class:parametric={parametricVertex || fromLoop}
                        onpointerdown={(ev) => {
                          if (!rootPolygonId) return;
                          polyUI.startPolyVertexDrag(ev, rootPolygonId, i, v.yFlip ? 'cartesian' : 'revolve');
                        }}
                        onpointerenter={(ev) => { if (rootPolygonId) showSvgTip(ev, rootPolygonId, entryIdx, i, profilePts.length, p); }}
                        onpointermove={(ev) => { polyUI.polyDragMove(ev); moveSvgTip(ev); }}
                        onpointerleave={() => { if (rootPolygonId) hideSvgTip(rootPolygonId, entryIdx); }}
                        onpointerup={polyUI.polyDragEnd}>
                      </circle>
                      <!-- Point-order markers: green ring + "1" on the FIRST
                           vertex, orange ring + count on the LAST, so the
                           winding / point sequence is readable. Non-interactive. -->
                      {#if i === 0}
                        <circle cx={p[0]} cy={p[1]} r={ph * 1.8} fill="none" stroke="#16a34a" stroke-width={ph * 0.45} pointer-events="none"/>
                        <text x={p[0] + ph * 2.4} y={p[1] - ph * 1.6} fill="#15803d" font-size={ph * 3.4} font-weight="700" pointer-events="none" style="paint-order: stroke" stroke="#fff" stroke-width={ph * 0.7}>1</text>
                      {:else if i === profilePts.length - 1}
                        <circle cx={p[0]} cy={p[1]} r={ph * 1.8} fill="none" stroke="#ea580c" stroke-width={ph * 0.45} pointer-events="none"/>
                        <text x={p[0] + ph * 2.4} y={p[1] - ph * 1.6} fill="#c2410c" font-size={ph * 3.4} font-weight="700" pointer-events="none" style="paint-order: stroke" stroke="#fff" stroke-width={ph * 0.7}>{profilePts.length}</text>
                      {/if}
                    {/each}
                  </g>
                </svg>
              </div>
            {:else if profileResolveErr}
              <div class="ge-err"><div>{profileResolveErr}</div></div>
            {:else}
              <div class="ge-empty">resolving polygon…</div>
            {/if}
      {/snippet}
    </RightPane>
  </main>

  {#if addParamPop}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="ge-wire-shade" onclick={closeAddParamPop}></div>
    <div class="ge-wire-pop" style="left: {addParamPop.x}px; top: {addParamPop.y}px; min-width: 220px">
      <div class="ge-wire-head">+ new param</div>
      <div class="ge-addparam-row">
        <input class="ge-addparam-input" type="text" placeholder="name (e.g. outerOD)" bind:value={newParamName}
          onkeydown={(e) => { if (e.key === 'Enter') onAddParam(); }}/>
      </div>
      <div class="ge-addparam-row">
        <input class="ge-addparam-input num" type="number" step="0.05" placeholder="default" bind:value={newParamDefault}
          onkeydown={(e) => { if (e.key === 'Enter') onAddParam(); }}/>
      </div>
      <div class="ge-addparam-row">
        <button class="ge-param-add" type="button" onclick={onAddParam}>add</button>
        <button class="ge-param-add ghost" type="button" onclick={closeAddParamPop}>cancel</button>
      </div>
      {#if !hasStackRef(graph)}
        <div class="ge-addparam-row" style="border-top: 1px solid #2a2a2a; padding-top: 8px; flex-direction: column; align-items: stretch; gap: 4px;">
          <button class="ge-param-add ghost" type="button" onclick={onAddStackRef}>🔗 + stack ref</button>
          <span style="font-size: 9px; color: #888; line-height: 1.3;">how this part mates in a stack: 0 = end-to-end · negative = overlap · positive = advance</span>
        </div>
      {/if}
    </div>
  {/if}
  {#if wirePop}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="ge-wire-shade" onclick={closeWirePop}></div>
    <div class="ge-wire-pop" style="left: {wirePop.x}px; top: {wirePop.y}px">
      <div class="ge-wire-head">wire <code>{wirePop.key}</code> to:</div>
      {#if paramEntries.length === 0}
        <div class="ge-empty">no params yet — add one in the strip above</div>
      {/if}
      {#each paramEntries as [name, p] (name)}
        <button class="ge-wire-item" type="button"
          onclick={() => wireArgToParam(wirePop!.callId, wirePop!.key, name)}>p.{name} <span class="ge-wire-default">({(p as any).default})</span></button>
      {/each}
      <button class="ge-wire-item literal" type="button"
        onclick={() => unwireArgToLiteral(wirePop!.callId, wirePop!.key)}>← back to literal</button>
    </div>
  {/if}

  <!-- The container · arg-ƒ-expr · profile-kind · profile-node-ref popovers
       (Phase A). `bind:graph` lets the apply* handlers mutate the graph; the
       open* fns are called from the node-render arms via `bind:this={popovers}`. -->
  <Popovers
    bind:this={popovers}
    bind:graph
    expectedProfileSet={expected.profileSet}
    expectedDefaults={expected.defaults}
    {paramEntries} />

  {#if sketch.sketchExprPop}
    <!-- Sketch coord ƒ-expression editor (S.2) — same UX as argExprPop, keyed
         to a sketch op field (r / z / fillet radius / chamfer dist). Apply →
         setSketchOpField with kind:'expr'; the 3D re-bakes live. -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="ge-wire-shade" onclick={sketch.closeSketchExprPop}></div>
    <div class="ge-wire-pop ge-expr-pop"
      use:clampToViewport={sketch.sketchExprPop}
      style="left: {sketch.sketchExprPop.x}px; top: {sketch.sketchExprPop.y}px">
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="ge-wire-head ge-wire-head-drag" title="Drag to move"
        onpointerdown={sketch.sketchExprPopDown} onpointermove={sketch.sketchExprPopMove} onpointerup={sketch.sketchExprPopUp}>ƒ sketch point <code>{sketch.sketchExprPop.field}</code> expression</div>
      {#if sketch.sketchExprPop.drafts}
        {@const _op = (graph.nodes[sketch.sketchExprPop.sid] as any)?.ops?.[sketch.sketchExprPop.opIdx]}
        {@const _rel = _op?.mode === 'rel'}
        <!-- r / z tab strip + abs/Δ toggle — edit both coordinates of the point
             without closing the popover (mirrors the polygon vertex editor).
             Apply writes BOTH axes. -->
        <div class="ge-expr-pop-tabs">
          <button class="ge-expr-pop-tab" type="button"
            class:on={sketch.sketchExprPop.field === 'r'}
            onclick={() => sketch.switchSketchExprAxis('r')}>{_rel ? 'Δr' : 'r'}</button>
          <button class="ge-expr-pop-tab" type="button"
            class:on={sketch.sketchExprPop.field === 'z'}
            onclick={() => sketch.switchSketchExprAxis('z')}>{_rel ? 'Δz' : 'z'}</button>
          <button class="ge-expr-pop-mode" type="button" class:rel={_rel}
            title="Toggle absolute / Δ relative (offset from previous point)"
            onclick={sketch.toggleSketchExprPopMode}>{_rel ? 'Δ rel' : 'abs'}</button>
        </div>
      {/if}
      <textarea class="ge-expr-textarea" rows="3"
        placeholder="e.g. p.od / 2 - p.wall"
        value={sketch.sketchExprPop.draft}
        onkeydown={(e) => { if (e.key === 'Enter' && !(e as KeyboardEvent).shiftKey) { (e as KeyboardEvent).preventDefault(); sketch.applySketchExprPop(); } }}
        oninput={(e) => { if (sketch.sketchExprPop) sketch.sketchExprPop = { ...sketch.sketchExprPop, draft: (e.target as HTMLTextAreaElement).value }; }}></textarea>
      <div class="ge-expr-pop-row">
        <span class="ge-expr-pop-label">insert:</span>
        {#each paramEntries as [name, p] (name)}
          <button class="ge-expr-pop-chip" type="button"
            onclick={() => sketch.insertParamIntoSketchDraft(name)}
            title={`Append p.${name} to the expression (default ${(p as any).default})`}>p.{name}</button>
        {/each}
        {#if paramEntries.length === 0}
          <span class="ge-empty">no params declared</span>
        {/if}
      </div>
      <div class="ge-expr-pop-row right">
        <button class="ge-param-add danger" type="button" class:armed={sketch.sketchDelArmed} disabled={sketch.sketchPopPtCount <= 1}
          title={sketch.sketchPopPtCount <= 1 ? 'Can’t delete the only point' : (sketch.sketchDelArmed ? 'Click again to confirm' : 'Delete this point')}
          onclick={sketch.onSketchDeleteClick}>{sketch.sketchDelArmed ? 'confirm delete?' : '🗑 delete'}</button>
        <button class="ge-param-add ghost" type="button" onclick={sketch.closeSketchExprPop}>cancel</button>
        <button class="ge-param-add" type="button" onclick={sketch.applySketchExprPop}>apply</button>
      </div>
    </div>
  {/if}

  <!-- Profile-SVG hover tooltip — black bg / white text at the cursor while
       browsing the 2D profile points. -->
  {#if svgTip}
    <div class="ge-svg-tip" style="left: {svgTip.x + 12}px; top: {svgTip.y + 12}px">{svgTip.text}</div>
  {/if}

  {#if polyExprPop}
    {@const tabbed = !!polyExprPop.drafts}
    {@const isLoopAxis = !!(polyExprPop.repeatId && polyExprPop.bindingIdx === undefined && (polyExprPop.axis as any) !== 'count')}
    {@const tabMode = polyExprPop.polygonId
      ? polyUI.polygonModeFor(polyExprPop.polygonId)
      : (polyExprPop.repeatId ? polyUI.polyRepeatModeFor(polyExprPop.repeatId) : 'revolve')}
    {@const labelR = tabMode === 'cartesian' ? 'x' : 'r'}
    {@const labelZ = tabMode === 'cartesian' ? 'y' : 'z'}
    <!-- Polygon coord expression popover — same UX as argExprPop but
         keyed to a polygon vertex's r or z slot. Insert chips append
         `p.<name>` to the draft so the user can compose like
         `p.od / 2 - p.wall` with click + keyboard. Enter applies. -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="ge-wire-shade" onclick={closePolyExprPop}></div>
    <div class="ge-wire-pop ge-expr-pop"
      use:clampToViewport={polyExprPop}
      style="left: {Math.min(polyExprPop.x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 460)}px; top: {polyExprPop.y}px">
      <div class="ge-wire-head">
        {#if (polyExprPop as any).transformId}
          {@const txn = graph.nodes[(polyExprPop as any).transformId]}
          {@const txKind = (txn as any)?.type === 'rot' ? 'rot' : 'mv'}
          {@const axLetter = ['x','y','z'][(polyExprPop as any).transformAxis] ?? 'x'}
          ƒ {txKind} <code>{txKind === 'rot' ? 'r' : ''}{axLetter}</code> expression
        {:else if polyExprPop.repeatId && polyExprPop.bindingIdx !== undefined}
          ƒ loop binding expression
        {:else if polyExprPop.repeatId && (polyExprPop.axis as any) === 'count'}
          ƒ loop <code>NPts</code> expression
        {:else if isLoopAxis}
          ƒ loop expression
        {:else}
          ƒ vertex <code>#{polyExprPop.idx}</code> expression
        {/if}
      </div>
      {#if tabbed}
        <!-- Axis tab strip (#157, 2026-06-11) — switch between r/x and
             z/y without closing the popover. Per-axis drafts are kept
             so a typed expression on the inactive tab isn't lost; Apply
             writes BOTH tabs back to the graph. -->
        <div class="ge-expr-pop-tabs">
          <button class="ge-expr-pop-tab" type="button"
            class:on={polyExprPop.axis === 'r'}
            onclick={() => switchPolyExprAxis('r')}>{labelR}</button>
          <button class="ge-expr-pop-tab" type="button"
            class:on={polyExprPop.axis === 'z'}
            onclick={() => switchPolyExprAxis('z')}>{labelZ}</button>
        </div>
      {/if}
      <textarea class="ge-expr-textarea" rows="3"
        placeholder="e.g. p.od / 2 - p.wall"
        value={polyExprPop.draft}
        onkeydown={(e) => { if (e.key === 'Enter' && !(e as KeyboardEvent).shiftKey) { (e as KeyboardEvent).preventDefault(); applyPolyExprPop(); } }}
        oninput={(e) => { if (polyExprPop) polyExprPop = { ...polyExprPop, draft: (e.target as HTMLTextAreaElement).value }; }}></textarea>
      <div class="ge-expr-pop-row">
        <span class="ge-expr-pop-label">insert:</span>
        {#each paramEntries as [name, p] (name)}
          <button class="ge-expr-pop-chip" type="button"
            onclick={() => insertParamIntoPolyDraft(name)}
            title={`Append p.${name} (default ${(p as any).default})`}>p.{name}</button>
        {/each}
        {#if paramEntries.length === 0}
          <span class="ge-empty">no params declared — add one in the PARAMS card</span>
        {/if}
      </div>
      <div class="ge-expr-pop-row right">
        <button class="ge-param-add ghost" type="button" onclick={closePolyExprPop}>cancel</button>
        <button class="ge-param-add" type="button" onclick={applyPolyExprPop}>apply</button>
      </div>
    </div>
  {/if}

  <!-- container reorder popover moved to Popovers.svelte (Phase A). -->

  <!-- Polygon 2D-preview overlay → PolyPreview.svelte (R6a Step 2). State +
       handlers live on polyUI (PolyPreviewState). The coord ƒ-popover
       (polyExprPop) stays in this shell; polyUI.openExprPop routes to it. -->
  <PolyPreview {polyUI} {graph} {hlVertex} {showSvgTip} {moveSvgTip} {hideSvgTip} />

  {#if pickerOpen}
    <!-- Compact Flowbite-style nav dropdown — anchored to the +Drop rail
         button. Single column, tight rows, subtle section dividers. (#118) -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="ge-picker-shade" onclick={closePicker}></div>
    <div class="ge-picker"
      style="left: {pickerPos.left}px; top: {pickerPos.top}px">
      <!-- Polygon — 2D vertex list producer. Output flows into a
           revolve/extrude (for 3D solids) or directly to Output
           (for a profile-shaped save). -->
      <!-- Top level: 5 items (polygon, solid▸, ops▸, transform▸,
           container▸) + the Call sub-section. Each ▸ parent opens a
           right-anchored flyout submenu on hover. Cuts the top-level
           row count nearly in half so the picker reads like a real
           nav menu instead of a long directory. -->
      <button class="ge-pick-item" type="button" onclick={dropPolygon}>
        <span class="ge-pick-icon">◇</span><span class="ge-pick-name">polygon</span><span class="ge-pick-hint">2D pts</span>
      </button>
      <button class="ge-pick-item" type="button" onclick={dropSketch}>
        <span class="ge-pick-icon">✐</span><span class="ge-pick-name">sketch</span><span class="ge-pick-hint">line·arc·fillet</span>
      </button>
      <button class="ge-pick-item" type="button" onclick={dropExpr}>
        <span class="ge-pick-icon">ƒ</span><span class="ge-pick-name">expr</span><span class="ge-pick-hint">calc block</span>
      </button>
      <div class="ge-cm-sep"></div>
      <button class="ge-pick-item parent" type="button"
        class:on={submenuKey === 'solids'}
        onmouseenter={(ev) => openSubmenu(ev as any, 'solids')}
        onclick={(ev) => openSubmenu(ev as any, 'solids')}>
        <span class="ge-pick-icon">○</span><span class="ge-pick-name">solids</span><span class="ge-pick-chev">›</span>
      </button>
      <button class="ge-pick-item parent" type="button"
        class:on={submenuKey === 'ops'}
        onmouseenter={(ev) => openSubmenu(ev as any, 'ops')}
        onclick={(ev) => openSubmenu(ev as any, 'ops')}>
        <span class="ge-pick-icon">⊕</span><span class="ge-pick-name">ops</span><span class="ge-pick-chev">›</span>
      </button>
      <button class="ge-pick-item parent" type="button"
        class:on={submenuKey === 'position'}
        onmouseenter={(ev) => openSubmenu(ev as any, 'position')}
        onclick={(ev) => openSubmenu(ev as any, 'position')}>
        <span class="ge-pick-icon">⇄</span><span class="ge-pick-name">position</span><span class="ge-pick-chev">›</span>
      </button>
      <button class="ge-pick-item parent" type="button"
        class:on={submenuKey === 'container'}
        onmouseenter={(ev) => openSubmenu(ev as any, 'container')}
        onclick={(ev) => openSubmenu(ev as any, 'container')}>
        <span class="ge-pick-icon">↕</span><span class="ge-pick-name">container</span><span class="ge-pick-chev">›</span>
      </button>
    </div>

    <!-- Submenu flyouts — anchored right of the picker at the parent's
         y. One renders at a time based on submenuKey. Mouse-leave closes. -->
    {#if submenuKey === 'solids'}
      <div class="ge-picker ge-picker-flyout"
        style="left: {pickerPos.left + 200}px; top: {submenuTopY}px"
        onmouseleave={() => (submenuKey = null)}>
        <button class="ge-pick-item" type="button" onclick={() => { dropSolid('revolve'); submenuKey = null; }}>
          <span class="ge-pick-icon">○</span><span class="ge-pick-name">revolve</span><span class="ge-pick-hint">spin</span>
        </button>
        <button class="ge-pick-item" type="button" onclick={() => { dropSolid('extrude'); submenuKey = null; }}>
          <span class="ge-pick-icon">▭</span><span class="ge-pick-name">extrude</span><span class="ge-pick-hint">sweep</span>
        </button>
        <button class="ge-pick-item" type="button" onclick={() => { dropSolid('loft'); submenuKey = null; }}>
          <span class="ge-pick-icon">◇</span><span class="ge-pick-name">loft</span><span class="ge-pick-hint">bulge</span>
        </button>
      </div>
    {:else if submenuKey === 'ops'}
      <div class="ge-picker ge-picker-flyout"
        style="left: {pickerPos.left + 200}px; top: {submenuTopY}px"
        onmouseleave={() => (submenuKey = null)}>
        <button class="ge-pick-item" type="button" onclick={() => { dropCsg('subtract'); submenuKey = null; }}>
          <span class="ge-pick-icon">⊖</span><span class="ge-pick-name">subtract</span>
        </button>
        <button class="ge-pick-item" type="button" onclick={() => { dropCsg('add'); submenuKey = null; }}>
          <span class="ge-pick-icon">⊕</span><span class="ge-pick-name">add</span>
        </button>
        <button class="ge-pick-item" type="button" onclick={() => { dropCsg('intersect'); submenuKey = null; }}>
          <span class="ge-pick-icon">⊗</span><span class="ge-pick-name">intersect</span>
        </button>
      </div>
    {:else if submenuKey === 'position'}
      <div class="ge-picker ge-picker-flyout"
        style="left: {pickerPos.left + 200}px; top: {submenuTopY}px"
        onmouseleave={() => (submenuKey = null)}>
        <button class="ge-pick-item" type="button" onclick={() => { dropMv(); submenuKey = null; }}>
          <span class="ge-pick-icon">⇄</span><span class="ge-pick-name">mv</span><span class="ge-pick-hint">x y z</span>
        </button>
        <button class="ge-pick-item" type="button" onclick={() => { dropRot(); submenuKey = null; }}>
          <span class="ge-pick-icon">↻</span><span class="ge-pick-name">rot</span><span class="ge-pick-hint">rx ry rz</span>
        </button>
        <button class="ge-pick-item" type="button" onclick={() => { dropTxfmn(); submenuKey = null; }}>
          <span class="ge-pick-icon">⇆</span><span class="ge-pick-name">xform</span><span class="ge-pick-hint">rot + mv</span>
        </button>
      </div>
    {:else if submenuKey === 'container'}
      <div class="ge-picker ge-picker-flyout"
        style="left: {pickerPos.left + 200}px; top: {submenuTopY}px"
        onmouseleave={() => (submenuKey = null)}>
        <button class="ge-pick-item" type="button" onclick={() => { dropStack(); submenuKey = null; }}>
          <span class="ge-pick-icon">↕</span><span class="ge-pick-name">stack</span>
        </button>
        <button class="ge-pick-item" type="button" onclick={() => { dropRepeat(); submenuKey = null; }}>
          <span class="ge-pick-icon">⋯</span><span class="ge-pick-name">repeat</span><span class="ge-pick-hint">× N</span>
        </button>
      </div>
    {/if}
  {/if}

  {#if callPickerOpen}
    <!-- Call (primitive) picker — own popover, opened by the dedicated
         rail button. Logically separate from the operations menu. -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="ge-picker-shade" onclick={closeCallPicker}></div>
    <div class="ge-picker"
      style="left: {callPickerPos.left}px; top: {callPickerPos.top}px; height: 360px">
      <div class="ge-picker-call-section">
        <div class="ge-picker-call-head">
          <input class="ge-picker-search" type="text"
            placeholder="filter primitives…" bind:value={pickerFilter}/>
          <div class="ge-picker-sort">
            <button class="ge-pick-sort" class:active={pickerSort === 'name'}
              type="button" onclick={() => setPickerSort('name')}>A–Z</button>
            <button class="ge-pick-sort" class:active={pickerSort === 'recent'}
              type="button" onclick={() => setPickerSort('recent')}>recent</button>
            <button class="ge-pick-sort" class:active={pickerSort === 'source'}
              type="button" onclick={() => setPickerSort('source')}>src</button>
          </div>
        </div>
        <div class="ge-picker-list">
          {#each filteredSrcs as src (src)}
            {@const meta = pickerSrcMeta[src]}
            <button class="ge-pick-item" type="button"
              onclick={() => { dropCall(src); closeCallPicker(); }}>
              <span class="ge-pick-name code">{src}</span>
              {#if pickerSort === 'source' && meta?.source}<span class="ge-pick-src-tag src-{meta.source}">{meta.source}</span>{/if}
            </button>
          {/each}
          {#if pickerSrcs.length === 0}<div class="ge-empty">loading…</div>{/if}
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  /* 48 px left rail + 1fr body. Rows: slim header + canvas grid. */
  .ge-root {
    display: grid;
    /* Title header removed (redundant with the /primitives tab strip).
       Single content row now; the validation-error banner inserts an
       auto row at the top only when shown. */
    grid-template-rows: 1fr;
    grid-template-columns: 38px 1fr;
    /* 100% fits inside the layout's content row. min-height: 0 lets the
       grid actually CLAMP at 100% — without it CSS grid sizes 1fr to
       max-content of the canvas + side pane, blowing the height out
       2-3× and overflowing the viewport. */
    height: 100%; min-height: 0; font-family: Arial; color: #1f2937;
    position: relative;
  }
  .ge-root > .ge-vrail   { grid-row: 1; grid-column: 1; min-height: 0; }
  .ge-root > .ge-grid    { grid-row: 1; grid-column: 2; min-height: 0; }
  .ge-root > .ge-valerr  { grid-column: 1 / -1; }
  /* ─── Vertical action rail ─────────────────────────────────────────── */
  .ge-vrail {
    display: flex; flex-direction: column;
    align-items: center; gap: 4px;
    padding: 6px 3px; background: #f8fafc;
    border-right: 1px solid #e5e7eb;
    overflow-y: auto;
  }
  .ge-vrail-btn {
    display: flex; align-items: center; justify-content: center;
    width: 30px; height: 30px; padding: 0;
    background: #fff; color: #44403c;
    border: 1px solid #cbd5e1; border-radius: 6px;
    font-size: 14px; line-height: 1; cursor: pointer;
    transition: background 120ms, border-color 120ms, color 120ms;
    position: relative;
  }
  .ge-vrail-btn:hover { background: #eff6ff; color: #0c4a6e; border-color: #93c5fd; }
  .ge-vrail-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  /* thin group divider in the rail (authoring tools vs actions). */
  .ge-vrail-sep { width: 20px; height: 1px; background: #d4d4d8; margin: 3px 0; flex: none; }
  /* authoring group accents — Σ expressions (teal), ◇ types (indigo), ✨ suggest (amber). */
  .ge-vrail-btn.expr    { color: #0e7490; }
  .ge-vrail-btn.types   { color: #6d28d9; border-color: #ddd6fe; }
  .ge-vrail-btn.types:hover { background: #f5f3ff; color: #5b21b6; border-color: #a78bfa; }
  .ge-vrail-btn.types.on { background: #ede9fe; color: #5b21b6; border-color: #a78bfa; }
  .ge-vrail-btn.suggest { color: #d97706; }
  .ge-vrail-btn.suggest:hover { background: #fffbeb; color: #b45309; border-color: #fcd34d; }
  .ge-vrail-btn.suggest.on { background: #fef3c7; color: #b45309; border-color: #fcd34d; }
  .ge-vrail-btn.save    { color: #15803d; }
  .ge-vrail-btn.save:hover { background: #d1fae5; color: #14532d; border-color: #6ee7b7; }
  .ge-vrail-btn.bake    { color: #ea580c; }
  .ge-vrail-btn.bake:hover { background: #ffedd5; color: #9a3412; border-color: #fdba74; }
  .ge-vrail-btn.bake.stale {
    color: #ea580c; border-color: #f97316;
    animation: ge-bake-pulse 1.4s ease-in-out infinite;
  }
  .ge-vrail-btn.auto    { color: #78716c; }
  .ge-vrail-btn.auto.on { background: #fef3c7; color: #92400e; border-color: #fbbf24; }
  .ge-vrail-btn.ghost-clear { background: #c4b5fd; color: #4c1d95; border-color: #8b5cf6; }
  .ge-vrail-btn.ghost-clear:hover { background: #a78bfa; color: #2e1065; }
  .ge-vrail-btn.connect { color: #0e7490; }
  .ge-vrail-btn.connect:hover { background: #cffafe; color: #155e75; border-color: #67e8f9; }
  .ge-vrail-btn.connect.on { background: #06b6d4; color: #fff; border-color: #0891b2; }
  .ge-vrail-btn.settings.on { background: #dbeafe; color: #1e40af; border-color: #60a5fa; }
  .ge-vrail-btn.reset:hover { background: #fee2e2; color: #991b1b; border-color: #fca5a5; }
  .ge-vrail-badge {
    position: absolute; top: -4px; right: -4px;
    background: #ea580c; color: #fff;
    font: 700 9px Arial; padding: 0 4px; border-radius: 9999px;
    min-width: 14px; height: 14px; line-height: 14px; text-align: center;
  }
  .ge-vrail-sep { width: 24px; height: 1px; background: #e5e7eb; margin: 4px 0; }
  .ge-vrail-spacer { flex: 1 1 auto; }

  /* ─── Rail-button accents (the ⚙ canvas-settings popover moved to
         CanvasMenu.svelte, the ✨ generate popover to AiMenu.svelte) ──── */
  /* ✨ generate rail button — violet accents match the AI/parametric family. */
  .ge-vrail-btn.ai { color: #6d28d9; }
  .ge-vrail-btn.ai:hover, .ge-vrail-btn.ai.on { background: #ede9fe; color: #4c1d95; border-color: #a78bfa; }
  /* .ge-cm-sep is still used by the +Drop node-pick menu below — keep it. */
  .ge-cm-sep { height: 1px; background: #f1f5f9; margin: 4px 6px; }
  /* ─── Profile-mode 2D preview ────────────────────────────────────── */
  .ge-profile-2d { display: flex; flex-direction: column; height: 100%; min-height: 0; padding: 12px; box-sizing: border-box; }
  .ge-profile-2d-head { font: 600 11px Arial; color: #57534e; margin-bottom: 8px; letter-spacing: 0.3px; }
  .ge-profile-2d svg { flex: 1 1 auto; min-height: 240px; width: 100%; background: #fafaf9; border: 1px solid #e5e7eb; border-radius: 4px; }
  /* Polygon vertex dots are draggable when BOTH coords are literal — the
     pointermove rewrites (r, z) directly. Wired (param / expr) coords get
     a not-allowed cursor; dragging them would silently overwrite the
     wiring. Hover adds a translucent halo via stroke so the drop target
     reads as interactive (stroke is independent of the inline r attr,
     unlike a CSS r override which fights the geometry attribute). */
  /* (The .ge-poly-preview-svg circle halves moved to PolyPreview.svelte — R6a.) */
  .ge-profile-2d svg circle {
    cursor: grab;
    touch-action: none;
    transition: stroke-width 80ms ease, stroke 80ms ease;
    stroke: transparent;
    stroke-width: 0;
  }
  .ge-profile-2d svg circle:hover {
    stroke: rgba(153, 27, 27, 0.28);
    stroke-width: 0.012em;
    /* Stroke-width in em scales with the parent's font-size — not the SVG
       viewBox. The numeric value here is tuned against the path stroke
       width (sw) which is bbox-relative; the resulting halo reads
       proportional at common card sizes. */
  }
  .ge-profile-2d svg circle:active { cursor: grabbing; }
  .ge-profile-2d svg circle.locked { cursor: not-allowed; opacity: 0.7; }
  .ge-profile-2d svg circle.locked:hover { stroke: transparent; stroke-width: 0; }
  /* Embed mode (`?embed=1`) — page is iframed inside /vocab (or similar).
     Override the 100vh so the iframe parent controls the height. */
  .ge-root.embed { height: 100%; }
  .ge-bar { display: flex; align-items: center; gap: 10px; padding: 6px 14px; border-bottom: 1px solid #e5e7eb; background: #f8fafc; }
  .ge-bar h1 { font: 700 15px Arial; margin: 0; color: #0c4a6e; }
  .ge-id { padding: 4px 10px; font: 12px ui-monospace, monospace; border: 1px solid #d6d3d1; border-radius: 4px; width: 180px; }
  .ge-btn { padding: 4px 12px; font: 600 12px Arial; background: #0369a1; color: #fff; border: 0; border-radius: 4px; cursor: pointer; }
  .ge-btn:hover { background: #0c4a6e; }
  .ge-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .ge-btn.save { background: #15803d; }
  .ge-btn.save:hover { background: #166534; }
  .ge-btn.bake { background: #ea580c; }
  .ge-btn.bake:hover { background: #c2410c; }
  .ge-btn.bake.stale { background: #f97316; animation: ge-bake-pulse 1.4s ease-in-out infinite; }
  @keyframes ge-bake-pulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(249, 115, 22, 0.4); }
    50%      { box-shadow: 0 0 0 5px rgba(249, 115, 22, 0); }
  }
  .ge-auto-bake-toggle { display: inline-flex; align-items: center; gap: 4px; font: 11px Arial; color: #57534e; cursor: pointer; user-select: none; }
  .ge-auto-bake-toggle input { margin: 0; }
  /* Reset-ghosts button — appears when at least one card is ghosted.
     Violet to match the per-card 👁 toggle's active colour. */
  .ge-btn.ghost-clear {
    background: #c4b5fd; color: #4c1d95;
    padding: 3px 9px; font: 12px Arial; border: 1px solid #8b5cf6;
  }
  .ge-btn.ghost-clear:hover { background: #a78bfa; color: #2e1065; }
  /* Per-card 👁 eye toggle — a small SVG button on each Call card,
     left of the × delete. Activates ghost overlay for that card. */
  .ge-node-ghost { font: 12px Arial; cursor: pointer; user-select: none; opacity: 0.5; }
  .ge-node-ghost:hover { opacity: 1; }
  .ge-node-ghost.on { opacity: 1; fill: #6d28d9; }
  .ge-btn.ghost { background: #e5e7eb; color: #1f2937; }
  .ge-btn.ghost:hover { background: #d1d5db; }
  .ge-save-stat { font: 11px ui-monospace, monospace; color: #15803d; }
  /* In-canvas status strip — pinned bottom-left of the canvas pane.
     pointer-events:none so it doesn't intercept canvas drags; the badges
     themselves are non-interactive so click+drag pass straight through. */
  .ge-canvas-status {
    position: absolute; left: 12px; bottom: 10px;
    display: flex; align-items: center; gap: 10px;
    pointer-events: none;
    z-index: 4;
  }
  .ge-canvas-status-save {
    background: rgba(220, 252, 231, 0.92);
    color: #15803d; border: 1px solid #86efac;
    padding: 3px 9px; border-radius: 4px;
    font: 11px ui-monospace, monospace;
    box-shadow: 0 1px 2px rgba(0,0,0,0.06);
    animation: ge-canvas-status-fade-in 180ms ease-out;
  }
  .ge-canvas-status-stat {
    background: rgba(248, 250, 252, 0.85);
    color: #475569; border: 1px solid #e2e8f0;
    padding: 3px 9px; border-radius: 4px;
    font: 11px ui-monospace, monospace;
    box-shadow: 0 1px 2px rgba(0,0,0,0.04);
  }
  @keyframes ge-canvas-status-fade-in {
    from { opacity: 0; transform: translateY(4px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  /* Boundary edge toggles (#116) — the small circular ⏹/🔺/🔒 buttons
     pinned to the canvas edges were removed; the ⚙ canvas-settings menu
     now exposes Left / Right boundary as boolean checkbox rows. */
  /* Broken-reference banner — sits between the toolbar and the canvas so
     the user can't miss it. Amber theme matches the existing stale-server
     hint; click a node-id chip to select-and-pan to the offending node. */
  .ge-valerr {
    padding: 8px 14px; background: #fef3c7; border-bottom: 1px solid #fcd34d;
    color: #78350f; font: 12px Arial; line-height: 1.5;
  }
  .ge-valerr strong { color: #92400e; }
  .ge-valerr-hint { color: #a16207; }
  .ge-valerr ul { margin: 4px 0 0; padding: 0 0 0 18px; }
  .ge-valerr li { font-family: ui-monospace, monospace; font-size: 11px; }
  .ge-valerr-chip {
    background: #fde68a; color: #78350f; border: 1px solid #d97706; border-radius: 3px;
    padding: 0 6px; font: 11px ui-monospace, monospace; cursor: pointer;
  }
  .ge-valerr-chip:hover { background: #fcd34d; }
  .ge-valerr-slot { color: #a16207; }
  .ge-valerr-bad { color: #b91c1c; }
  .ge-stat { font: 11px ui-monospace, monospace; color: #6b7280; margin-left: auto; }
  /* grid-template-columns set inline (splitA% 6px splitB% 6px 1fr) — both
     dividers live between sections; the source pane gets the remainder. */
  .ge-grid { display: grid; overflow: hidden; }
  .ge-divider { background: #e5e7eb; cursor: col-resize; touch-action: none; transition: background 0.12s; }

  /* ─── Mobile — VERTICAL sectioning in PORTRAIT only (plan K.53) ───────── */
  /* Narrow + portrait: the canvas | preview side-by-side split is too
     cramped, so stack them — graph canvas on TOP, the 3D/SRC/MD pane BELOW.
     LANDSCAPE keeps the two sections side-by-side (wide enough). `!important`
     overrides the inline `grid-template-columns: {splitA}%…`. */
  @media (max-width: 820px) and (orientation: portrait) {
    .ge-grid {
      grid-template-columns: 1fr !important;
      /* Node-graph canvas on TOP gets the dominant share; the 3D/SRC/MD
         preview BELOW is capped. A greedy `minmax(180px, 44vh)` preview was
         eating 343 of 451px and squeezing the editing canvas to a ~100px
         sliver. Proportional fr tracks (node ~1.5 : preview 1) keep the node
         canvas the larger pane while both stay usable and scale with height. */
      grid-template-rows: minmax(140px, 1.5fr) 8px minmax(120px, 1fr) !important;
    }
    .ge-divider { cursor: row-resize; }
  }
  .ge-divider:hover, .ge-divider:active { background: #0369a1; }
  .ge-canvas-pane { overflow: hidden; position: relative; }
  .ge-connect-hint {
    position: absolute; top: 8px; left: 50%; transform: translateX(-50%);
    z-index: 20; padding: 5px 12px; border-radius: 9999px;
    background: #06b6d4; color: #fff; font: 600 12px Arial; white-space: nowrap;
    box-shadow: 0 2px 8px rgba(8, 145, 178, 0.35); pointer-events: none;
  }
  .ge-connect-hint kbd {
    background: rgba(255,255,255,0.25); border-radius: 3px; padding: 0 4px;
    font: 600 11px ui-monospace, monospace;
  }
  /* + param button + delete × on canvas chip + add-param popover rows. */
  .ge-param-card-x { font: 13px Arial; fill: #b91c1c; cursor: pointer; user-select: none; }
  .ge-param-add-bg { fill: #fef3c7; stroke: #d97706; stroke-width: 2; stroke-dasharray: 4 3; cursor: pointer; }
  .ge-param-add-bg:hover { fill: #fde68a; }
  .ge-param-add-glyph { font: 600 10px Arial; fill: #92400e; text-transform: uppercase; letter-spacing: 0.5px; }
  .ge-addparam-row { padding: 6px 10px; display: flex; gap: 6px; }
  .ge-addparam-input { flex: 1; padding: 3px 8px; font: 11px ui-monospace, monospace; border: 1px solid #d6d3d1; border-radius: 3px; }
  .ge-addparam-input.num { max-width: 100px; }
  .ge-param-add { padding: 3px 12px; font: 600 11px Arial; background: #fbbf24; color: #78350f; border: 0; border-radius: 3px; cursor: pointer; }
  .ge-param-add:hover { background: #d97706; color: #fff; }
  .ge-param-add.ghost { background: #e5e7eb; color: #1f2937; }
  .ge-param-add.ghost:hover { background: #d1d5db; }
  .ge-param-add.danger { margin-right: auto; background: #fee2e2; color: #b91c1c; }
  .ge-param-add.danger:hover { background: #ef4444; color: #fff; }
  .ge-param-add.danger:disabled { opacity: 0.4; cursor: not-allowed; }
  .ge-param-add.danger:disabled:hover { background: #fee2e2; color: #b91c1c; }
  .ge-param-add.danger.armed { background: #dc2626; color: #fff; }
  .ge-param-add.danger.armed:hover { background: #b91c1c; color: #fff; }

  .ge-canvas { width: 100%; height: 100%; background: #fafaf9; cursor: grab; touch-action: none;
    /* No text selection while dragging cards / panning. Inputs + editable
       fields opt back IN below so values stay selectable. */
    user-select: none; -webkit-user-select: none; }
  .ge-canvas.dragging { cursor: grabbing; }
  /* Re-enable selection inside editable fields (card inputs, expr boxes). */
  .ge-canvas input, .ge-canvas textarea, .ge-canvas [contenteditable] {
    user-select: text; -webkit-user-select: text; }

  .ge-node-bg { fill: #fff; stroke: #0369a1; stroke-width: 2; cursor: grab; touch-action: none; }
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
  .ge-node-bg.container { fill: #ecfdf5; stroke: #047857; stroke-width: 2; }
  /* Polygon card — warm peach background (matches the `.prvl` tag in the
     sidebar + the +Add Vertex CTA). Stroke amber to differentiate from
     Call (blue) and Method (yellow). */
  .ge-node-bg.polygon { fill: #fff7ed; stroke: #c2410c; stroke-width: 2; }
  .ge-node-bg.container.root { fill: #f0fdf4; stroke: #15803d; stroke-width: 2.5; }
  .ge-node-bg.container.stack { fill: #ecfeff; stroke: #0e7490; }
  /* Repeat × N — distinct color so it reads as "iteration", not "container". */
  .ge-node-bg.repeat { fill: #fdf2f8; stroke: #be185d; stroke-width: 2; }
  /* PolyRepeat card (#157) — violet skin matches the parametric-vertex
     palette + the repeat-ref row inside polygons. */
  .ge-node-bg.poly-repeat { fill: #f5f3ff; stroke: #6d28d9; stroke-width: 2; }
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
  .ge-repeat-sub { font: 11px Arial; fill: #831843; opacity: 0.85; }
  .ge-repeat-sub.code { font: italic 11px ui-monospace, monospace; fill: #be185d; }
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
  /* container reorder popover CSS (.ge-container-* / .ge-cp-*) → Popovers.svelte (Phase A) */
  /* Inline ×N / z-offset fields on the Stack node card (foreignObject). */
  .ge-stack-inline-input { width: 100%; height: 18px; box-sizing: border-box; padding: 1px 3px; font: 10px ui-monospace, monospace; text-align: right; border: 1px solid #cbd5e1; border-radius: 3px; color: #0f172a; background: #fff; }
  .ge-stack-inline-input::placeholder { color: #b8c0cc; font-style: italic; }
  .ge-stack-inline-input:focus { outline: none; border-color: #0ea5e9; }
  .ge-sock-label.trail { fill: #9ca3af; font-style: italic; }
  .ge-sock.trail { fill: #fff; stroke: #9ca3af; stroke-dasharray: 2 2; }
  .ge-node-title { font: 600 12px Arial; fill: #0c4a6e; pointer-events: none; }
  /* Drag-drop-target highlight on the canvas SVG when a sidebar primitive
     row is being dragged over (#161). Subtle dashed violet outline +
     cursor:copy on the cells inside; cleared on dragleave/drop. */
  .ge-canvas.drop-target {
    outline: 2px dashed #a855f7;
    outline-offset: -4px;
    background: rgba(168, 85, 247, 0.04);
    cursor: copy;
  }
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
  .ge-node-x.disabled { fill: #cbd5e1; cursor: not-allowed; }
  /* Polygon 👁 preview-toggle (sits just left of the × delete). */
  .ge-poly-eye { font: 12px Arial; fill: #475569; cursor: pointer; user-select: none; opacity: 0.7; }
  .ge-poly-eye:hover { fill: #0c4a6e; opacity: 1; }
  .ge-poly-eye.on { fill: #6d28d9; opacity: 1; }
  .ge-method-op { font: 900 36px Arial; fill: #92400e; pointer-events: none; }
  .ge-method-name { font: 11px Arial; fill: #92400e; text-transform: uppercase; letter-spacing: 0.5px; pointer-events: none; }
  .ge-fo { overflow: visible; }
  .ge-args, .ge-xyz { font: 11px Arial; color: #1f2937; line-height: 1.5; }
  /* ─── Polygon card table (profile-mode sole producer) ──────────────── */
  /* Compact reorderable vertex list. Each row is a 26-px grid that
     mirrors the SVG nodeSize math (header 36 + rows*26 + footer 30).
     Layout per row:
       idx · ▲ · ▼ · r-input · ƒ · z-input · ƒ · ×                      */
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
  /* ─── Repeat-block row ───────────────────────────────────────────────
     A polygon entry of kind 'repeat' that expands to N points at
     evaluation time. Three-row layout: header (count + loop var +
     reorder/del controls) followed by two expression rows (r(i) and
     z(i)). Distinct violet skin so the user reads "this is a generator,
     not a single vertex" at a glance. */
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
  .ge-sock.out.poly-repeat-out { fill: #6d28d9; stroke: #5b21b6; }
  /* NPts input socket on the loop card — yellow-ish so it reads as a
     PARAM input (matches the param-bezier palette elsewhere). Wired
     state fills the dot when count is wire-bound. */
  .ge-sock.in.poly-repeat-in { fill: #fff7ed; stroke: #c2410c; stroke-width: 2; }
  .ge-sock.in.poly-repeat-in.wired { fill: #fbbf24; stroke: #92400e; }
  /* IMPORTANT: row height is 22 px to match the input-socket spacing
     math in the SVG (cy = 36 + 14 + i * 22). Don't change without
     updating ALL three sites: the cy expression on socket circles,
     argY computation for the param/expr wires, and inline mv/rot axis
     positions. Misalignment of even 3-4 px per row stacks visibly. */
  /* minmax(0,1fr) (not bare 1fr) so a long expr/fnchip in the value column
     can't force the track wider than the card — the `auto` min of a plain
     1fr is the cell's min-content, which overflowed (#7). */
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
  /* Inline mv/rot transform block — compact HORIZONTAL layout (x/y/z side by
     side); sockets render as SVG along the bottom edge (see markup). */
  /* Inline transform STRIPS hang off the Call card's right edge — each is a
     small bordered card (header + x/y/z inputs). Sized to the foreignObject
     (STRIP_W × STRIP_H in script). */
  .ge-inline-xform { box-sizing: border-box; width: 100%; height: 100%;
    font: 11px Arial; color: #1f2937; padding: 3px 5px; display: flex;
    flex-direction: column; gap: 1px; border: 1px solid #c4b5fd;
    border-radius: 5px; background: #f5f3ff;
    box-shadow: 0 1px 2px rgba(76, 29, 149, 0.12); }
  .ge-inline-xform.mv  { color: #5b21b6; border-color: #c4b5fd; background: #f5f3ff; }
  .ge-inline-xform.rot { color: #831843; border-color: #f9a8d4; background: #fdf2f8; }
  .ge-inline-hdr { font: 700 9px Arial; color: inherit; text-transform: uppercase; letter-spacing: 0.5px; padding: 0; }
  .ge-inline-axes { display: flex; gap: 3px; align-items: flex-start; }
  /* Label ABOVE the input (stacked) so each axis is a narrow column → the whole
     strip is narrower than a label-beside-input row. */
  .ge-inline-axis { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; align-items: stretch; gap: 0; }
  .ge-inline-axkey { font: 600 8px Arial; color: #9ca3af; text-align: center; line-height: 1.1; }
  .ge-inline-input { width: 100%; min-width: 0; box-sizing: border-box; font: 11px Arial; padding: 1px 2px;
    border: 1px solid #d1d5db; border-radius: 3px; text-align: center; background: #fff;
    /* No number spinners — they clutter the tiny strips. */
    appearance: textfield; -moz-appearance: textfield; }
  .ge-inline-input::-webkit-inner-spin-button,
  .ge-inline-input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
  .ge-inline-input:focus { outline: none; border-color: #7c3aed; }
  .ge-inline-pchip { display: inline-flex; align-items: center; gap: 1px; max-width: 100%; overflow: hidden;
    white-space: nowrap; text-overflow: ellipsis; font: 600 10px Arial; color: #5b21b6;
    background: #ede9fe; border-radius: 3px; padding: 1px 3px; }
  .ge-arg-row.tight { padding: 0; }
  .ge-canvas-hint { font: 13px Arial; fill: #9ca3af; }

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

  .ge-wire { stroke-width: 2; stroke-linecap: round; fill: none; }
  .ge-wire.obj { stroke: #b91c1c; }
  .ge-wire.arg { stroke: #d97706; }
  .ge-wire.child { stroke: #6d28d9; }
  .ge-wire.param { stroke: #d97706; stroke-dasharray: 2 2; opacity: 0.85; }
  /* Expression wires — multi-source. Same color as direct-param wires
     but a longer dash so it reads as "composed via expression" not
     "wired directly". Helps when both wire types meet at the same slot. */
  .ge-wire.param.expr { stroke: #b45309; stroke-dasharray: 5 3; opacity: 0.75; }
  /* Node-ref wire (polygon → revolve.profile etc) — orange solid, slightly
     bolder than param wires so the producer→consumer connection reads as
     "value flow" rather than "param injection". */
  .ge-wire.noderef { stroke: #c2410c; stroke-width: 2.4; fill: none; opacity: 0.9; }
  .ge-wire.in-flight { stroke: #15803d; stroke-dasharray: 6 4; }
  /* Inline transform-chain SEQUENCE arrows — show the op order (card → strips
     → output). Subtle purple, non-interactive (sits under the sockets). */
  .ge-xform-arrow { stroke: #7c3aed; stroke-width: 1.4; fill: none; opacity: 0.7;
    stroke-linecap: round; pointer-events: none; }
  /* output: piping a node into a container's slot. Green = "this is what the
     function returns / what gets stacked". root variant is slightly thicker
     to mark "this lands in the function's final return". */
  .ge-wire.output { stroke: #15803d; opacity: 0.7; }
  .ge-wire.output.root { stroke: #047857; stroke-width: 2.5; opacity: 0.85; }
  /* Param chips on canvas — small amber rounded rectangles at the top with
     output socket. The HTML strip above stays for adding/removing; these
     mirror the same data for visual wiring. */
  .ge-params-card-bg { fill: #fffbeb; stroke: #d97706; stroke-width: 1.5; filter: drop-shadow(0 2px 3px rgba(0,0,0,0.06)); }
  .ge-params-card-title { font: 700 12px Arial; fill: #78350f; user-select: none; text-transform: uppercase; letter-spacing: 0.5px; }
  .ge-params-card-divider { stroke: #fde68a; stroke-width: 1; }
  .ge-params-add-btn { fill: #fcd34d; stroke: #d97706; stroke-width: 1.5; cursor: pointer; transition: fill 0.12s; }
  .ge-params-add-btn:hover { fill: #f59e0b; }
  .ge-params-add-glyph { font: 700 14px Arial; fill: #78350f; user-select: none; }
  /* Flex-row chip — pin | name (flex-grow) | input (fixed) | trash (fixed).
     Flowbite-style aesthetic: rounded body, soft amber, even spacing,
     items vertically centered. Width is controlled by the surrounding
     <foreignObject>, which itself reads the dynamic PARAM_W computed from
     the longest label so labels never clip. */
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
  /* Hide native number-input spinners — drag-to-scrub via dragNumber +
     keyboard arrows are the input methods; the chevrons take horizontal
     space we can't afford in tight cells. */
  :global(.ge-param-chip .val::-webkit-outer-spin-button),
  :global(.ge-param-chip .val::-webkit-inner-spin-button),
  :global(.ge-arg-input::-webkit-outer-spin-button),
  :global(.ge-arg-input::-webkit-inner-spin-button) { -webkit-appearance: none; margin: 0; }
  :global(.ge-param-chip .val[type='number']),
  :global(.ge-arg-input[type='number']) { -moz-appearance: textfield; appearance: textfield; }
  .ge-sock.in.param { stroke: #d97706; }
  .ge-sock.out.param { stroke: #d97706; fill: #fef3c7; }
  .ge-sock.in.param:hover, .ge-sock.out.param:hover { fill: #fde68a; }
  .ge-sock.tiny { stroke-width: 1.5; }
  /* ─── Properties card (above Params) ─────────────────────────────────────
     Same amber lineage as the Params card; a touch lighter so the two read
     as a stacked pair. The whole card lives inside one foreignObject. */
  /* Combined left card — tab header (Params | Properties). Matches the amber
     props/params palette. Two equal-width buttons; the active one fills. */
  .ge-left-tabs {
    display: flex; width: 100%; height: 26px; box-sizing: border-box;
    background: #fffbeb; border: 1.5px solid #d97706; border-radius: 8px;
    overflow: hidden; filter: drop-shadow(0 2px 3px rgba(0,0,0,0.06));
  }
  .ge-left-tab {
    flex: 1 1 0; min-width: 0; height: 100%; padding: 0; border: none;
    background: transparent; cursor: pointer; user-select: none;
    font: 700 11px Arial; color: #b45309; opacity: 0.7;
    text-transform: uppercase; letter-spacing: 0.5px; white-space: nowrap;
  }
  .ge-left-tab + .ge-left-tab { border-left: 1px solid #fde68a; }
  .ge-left-tab:hover { opacity: 1; }
  .ge-left-tab.on { background: #fde68a; color: #78350f; opacity: 1; }
  /* .ge-props-card / .ge-props-body / .ge-props-col CSS → PropertiesCard.svelte (Phase D) */
  /* Right-edge resize grip — semi-transparent slate, lights up on hover.
     Cursor: ew-resize so the affordance is obvious. */
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

  .ge-bake-pane, .ge-source-pane { display: grid; grid-template-rows: auto 1fr; overflow: hidden; }
  .ge-source-pane:has(.ge-legacy-banner) { grid-template-rows: auto auto 1fr; }
  /* Right-pane tab/body/bake-meta/source/md/legacy/err-hint styles moved to
     RightPane.svelte (P5/G5). `.ge-empty` + base `.ge-err` stay here because
     the parent-scoped profile-preview snippet still uses them. */
  .ge-empty { padding: 20px; text-align: center; color: #9ca3af; font: 12px Arial; }
  .ge-err { padding: 20px; color: #b91c1c; font: 12px ui-monospace, monospace; display: flex; flex-direction: column; gap: 10px; }
  .ge-source-pane { border-left: 1px solid #e5e7eb; }

  .ge-picker-shade { position: fixed; inset: 0; background: rgba(0,0,0,0.2); z-index: 100; }
  /* Multi-source ƒ-chip — shown on a Call's arg row when expr references 2+ params */
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
  /* profile picker popover CSS (.ge-profile-pop*) → Popovers.svelte (Phase A) */
  /* ƒ expression popup */
  .ge-expr-pop { min-width: 420px; max-width: 460px; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
  .ge-expr-textarea { width: 100%; box-sizing: border-box; padding: 6px 8px; font: 12px ui-monospace, monospace; border: 1px solid #d6d3d1; border-radius: 4px; resize: vertical; background: #faf5ff; color: #5b21b6; }
  .ge-expr-textarea:focus { outline: 1px solid #6d28d9; background: #fff; }
  .ge-expr-pop-row { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; padding: 4px 6px; }
  .ge-expr-pop-row.right { justify-content: flex-end; gap: 8px; }
  .ge-expr-pop-label { font: 11px Arial; color: #6b7280; margin-right: 4px; }
  .ge-expr-pop-chip { font: 600 11px ui-monospace, monospace; color: #78350f; background: #fef3c7; border: 1px solid #fbbf24; border-radius: 4px; padding: 2px 7px; cursor: pointer; transition: background 0.1s; }
  .ge-expr-pop-chip:hover { background: #fde68a; }
  /* Axis tab strip — sits just below the head label, lets the user
     switch between r/x and z/y without closing the popover. */
  .ge-expr-pop-tabs {
    display: flex; gap: 1px; padding: 4px 8px 0;
    border-bottom: 1px solid #fef3c7;
  }
  .ge-expr-pop-tab {
    flex: 0 0 auto; padding: 3px 12px;
    background: #fff7ed; border: 1px solid #fed7aa; border-bottom: 0;
    border-top-left-radius: 4px; border-top-right-radius: 4px;
    font: 600 11px ui-monospace, monospace; color: #92400e; cursor: pointer;
    transition: background 80ms, color 80ms;
  }
  .ge-expr-pop-tab:hover { background: #ffedd5; color: #7c2d12; }
  .ge-expr-pop-tab.on {
    background: #fef3c7; color: #78350f; border-color: #fbbf24;
    position: relative; top: 1px; /* nudge so the bottom border merges with the strip */
  }
  /* abs/Δ mode toggle — pushed to the right of the r/z tabs */
  .ge-expr-pop-mode {
    margin-left: auto; align-self: center; padding: 2px 9px;
    background: #fff; border: 1px solid #cbd5e1; border-radius: 999px;
    font: 600 10px ui-monospace, monospace; color: #475569; cursor: pointer;
  }
  .ge-expr-pop-mode:hover { background: #f1f5f9; }
  .ge-expr-pop-mode.rel { background: #fff7ed; border-color: #fdba74; color: #ea580c; }
  /* Expression / wire / param popovers — these need to float ABOVE the
     polygon SVG popup (z-index 100) when both are open, so editing a
     parametric vertex's expression while the 2D preview is pinned doesn't
     get visually blocked. 2026-06-10. */
  .ge-wire-shade { position: fixed; inset: 0; background: transparent; z-index: 200; }
  .ge-wire-pop { position: fixed; min-width: 200px; background: #fff; border: 1px solid #fbbf24; border-radius: 6px; box-shadow: 0 4px 14px rgba(0,0,0,0.18); padding: 4px 0; z-index: 210; }
  .ge-wire-head { padding: 6px 10px; font: 600 11px Arial; color: #78350f; border-bottom: 1px solid #fef3c7; }
  .ge-wire-head-drag { cursor: grab; touch-action: none; user-select: none; }
  .ge-wire-head-drag:active { cursor: grabbing; }
  .ge-wire-head code { font: 11px ui-monospace, monospace; background: #fef3c7; padding: 1px 4px; border-radius: 2px; }
  .ge-wire-item { width: 100%; padding: 5px 12px; background: transparent; border: 0; text-align: left; font: 12px ui-monospace, monospace; color: #78350f; cursor: pointer; display: flex; gap: 8px; align-items: center; }
  .ge-wire-item:hover { background: #fef3c7; }
  .ge-wire-item.literal { color: #6b7280; border-top: 1px solid #f1f5f9; }
  .ge-wire-default { font: 10px ui-monospace, monospace; color: #92400e; }
  /* +Drop picker — mirrors the ⚙ canvas-settings dropdown look (same
     220 px column width, 4 px outer padding, 6 px row padding, 6 px
     border-radius, identical hover treatment). Visual contract matched
     to .ge-canvas-menu / .ge-cm-row so a user fluent in one popover is
     fluent in the other. (#146) */
  .ge-picker {
    /* Position is set inline via the openPicker bounding rect — fall
       back to the rail-top defaults if the ref hasn't resolved yet. */
    position: fixed; top: 60px; left: 56px;
    width: 196px;
    background: #fff; border: 1px solid #d6d3d1; border-radius: 6px;
    padding: 4px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.12), 0 2px 4px rgba(0,0,0,0.06);
    z-index: 101; overflow: hidden;
    /* Compact nested-menu structure: top-level fits its content
       (no fixed height); flyout submenus open to the right on hover. */
    display: flex; flex-direction: column;
  }
  /* Parent row in the top-level menu — has a chevron on the right
     indicating a flyout submenu. Hover or click opens it. */
  .ge-pick-item.parent .ge-pick-chev {
    flex: 0 0 auto; font: 600 14px Arial; color: #94a3b8; line-height: 1;
  }
  .ge-pick-item.parent.on,
  .ge-pick-item.parent:hover { background: #f3f4f6; color: #0c4a6e; }
  .ge-pick-item.parent:hover .ge-pick-chev,
  .ge-pick-item.parent.on .ge-pick-chev { color: #0c4a6e; }
  /* Flyout submenu — anchored to the right of the picker at the parent's
     y. Same width/look as the main picker so it reads as a continuation. */
  .ge-picker-flyout {
    width: 160px;
    z-index: 102;
  }
  /* Row item — matches .ge-cm-row exactly: full-width button, 6/10 px
     padding, 12 px Arial, 4 px row radius, slate hover. */
  .ge-pick-item {
    display: flex; align-items: center; gap: 8px;
    width: 100%; padding: 6px 10px; box-sizing: border-box;
    background: transparent; border: 0; border-radius: 4px; cursor: pointer;
    font: 500 12px Arial; color: #1f2937;
    text-align: left;
  }
  .ge-pick-item:hover { background: #f3f4f6; color: #0c4a6e; }
  .ge-pick-icon {
    flex: 0 0 16px; width: 16px;
    font-size: 13px; color: #64748b; text-align: center; line-height: 1;
  }
  .ge-pick-item:hover .ge-pick-icon { color: #0c4a6e; }
  .ge-pick-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ge-pick-name.code { font-family: ui-monospace, monospace; }
  .ge-pick-hint { flex: 0 0 auto; font: 10px ui-monospace, monospace; color: #a8a29e; }
  /* Call (primitive) section — fixed-ish height with internal scroll so
     the items above don't get pushed out when 50+ primitives load.
     The filter + sort sub-header sits at the TOP of this section
     (own sub-row), keeping the controls scoped to the list they govern. */
  .ge-picker-call-section { display: flex; flex-direction: column; min-height: 0; flex: 1 1 auto; }
  .ge-picker-call-head {
    display: flex; align-items: center; gap: 4px;
    padding: 2px 4px 4px;
  }
  .ge-picker-search {
    flex: 1 1 auto; min-width: 0;
    padding: 3px 6px; font: 11px ui-monospace, monospace;
    border: 1px solid #e5e7eb; border-radius: 3px; background: #f9fafb;
  }
  .ge-picker-search:focus { outline: 1px solid #1e40af; background: #fff; border-color: #1e40af; }
  .ge-picker-sort { display: flex; align-items: center; gap: 2px; flex: 0 0 auto; }
  .ge-pick-sort {
    flex: 0 0 auto; padding: 1px 4px; font: 9px Arial;
    background: #fff; border: 1px solid #e5e7eb; border-radius: 3px;
    cursor: pointer; color: #57534e;
  }
  .ge-pick-sort:hover { background: #f3f4f6; }
  .ge-pick-sort.active { background: #1e40af; color: #fff; border-color: #1e40af; }
  .ge-picker-list { min-height: 0; flex: 1 1 auto; overflow-y: auto; }
  .ge-pick-src-tag {
    flex: 0 0 auto;
    font: 9px ui-monospace, monospace; padding: 1px 5px; border-radius: 3px;
    margin-left: 6px; text-transform: lowercase;
  }
  .ge-pick-src-tag.src-stdlib { background: #dbeafe; color: #1e40af; }
  .ge-pick-src-tag.src-basic { background: #f5f5f4; color: #44403c; }
  .ge-pick-src-tag.src-volume { background: #f5f5f4; color: #44403c; }
  .ge-pick-src-tag.src-completions { background: #fef3c7; color: #92400e; }
  .ge-pick-src-tag.src-stdstale { background: #fee2e2; color: #991b1b; }
</style>
