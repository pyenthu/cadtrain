<!--
  /graph-editor — Slices 1+4+5 of the visual composition editor.

  Three-pane layout:
    LEFT (40%)  — SVG graph canvas with Call/Method/Mv/Rot nodes, picker, wires
    MIDDLE(35%) — live 3D Threlte bake
    RIGHT (25%) — live .asm.ts source

  Slices delivered:
    1 (foundation)  — drop one Call, see canvas + bake + source
    4 (CSG)         — drop ⊖ ⊕ ⊗ method nodes; drag-wire from a node's
                       output socket to a method's obj/arg input
    5 (transforms)  — drop mv/rot wrapper nodes; drag-wire to set child;
                       3 xyz inputs on each transform card

  Save: writes <exemplar>.asm.ts to the volume via /api/primitives/save.

  Per docs/plans/composition-architecture.md.
-->
<script lang="ts">
  import { onMount, tick } from 'svelte';
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
    setMethodInput,
    setTransformChild,
    setTransformAxis,
    setTransformAxisValue,
    setViewport,
    addStackPlaceholder,
    addRepeatPlaceholder,
    setRepeatChild,
    setRepeatCount,
    setRepeatOp,
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
  import { dragNumber } from '$lib/shared/dragNumber';
  import { PROFILE_REGISTRY, defaultsFor, type ProfileDef } from '$lib/shared/profile-presets';

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
  /** Drift detection (Phase 11). Per src-name → its meta.params keys
   *  as last seen on the volume. Compared to each Call's args keys; a
   *  mismatch marks the Call as drifted. Refresh syncs the Call's args
   *  back to the expected shape (preserves existing values for shared
   *  keys, fills new keys with the primitive's defaults). */
  let expectedParams = $state<Record<string, string[]>>({});
  let expectedDefaults = $state<Record<string, Record<string, number>>>({});
  /** Profile-typed arg keys per src. `expectedProfileKeys['r_revolve'] = {profile}`.
   *  Populated alongside expectedParams from the primitive's meta.params
   *  scan; lookup at Call-card render time decides whether to show the
   *  profile chip + picker (#119) instead of a generic expression input. */
  let expectedProfileKeys = $state<Record<string, Set<string>>>({});
  /** Which "set" the primitive's profile uses — drives the kind filter in
   *  the profile picker popover. r_revolve → 'revolve' (r,z half-section);
   *  r_extrude / r_weld_extrude → 'cartesian' (x,y polygon). */
  let expectedProfileSet = $state<Record<string, 'revolve' | 'cartesian'>>({});

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
  function polyRepeatModeFor(repeatId: string): 'revolve' | 'cartesian' {
    for (const n of Object.values(graph.nodes)) {
      if ((n as any).type !== 'polygon') continue;
      const pts = (n as any).points ?? [];
      for (const p of pts) {
        if (p?.kind === 'repeat-ref' && p.sourceId === repeatId) {
          return polygonModeFor((n as any).id);
        }
      }
    }
    return profileSet;
  }
  function polygonModeFor(polyId: string): 'revolve' | 'cartesian' {
    for (const n of Object.values(graph.nodes)) {
      if ((n as any).type !== 'call') continue;
      const args = (n as any).args ?? {};
      for (const v of Object.values(args)) {
        if ((v as any).kind !== 'expr') continue;
        const expr = String((v as any).expr ?? '');
        if (!expr.includes('__POLY__' + polyId)) continue;
        const src = String((n as any).src ?? '');
        if (src === 'r_weld_extrude' || src === 'r_extrude') return 'cartesian';
        if (src === 'r_revolve') return 'revolve';
      }
    }
    return profileSet;
  }

  /** Polygon 2D-preview popup state — when set, a floating SVG of the
   *  polygon at the named id renders near its card so the user can SEE
   *  the 2D shape even while the right-pane is showing the 3D BAKE of
   *  a consuming revolve / extrude.
   *
   *  Open: click the 👁 button on the polygon title.
   *  Pin:  click the 📌 in the popup head to make it PERSISTENT — clicks
   *        on the canvas (and edits inside the polygon table) don't
   *        dismiss it. The popup stays anchored next to the polygon card
   *        and updates live as the user types coords.
   *  Close: click the 👁 again, click the popup's × button, or unpin +
   *        click anywhere outside the popup.
   *
   *  Pinned state is preserved per browser session via sessionStorage so
   *  a quick page reload doesn't lose the pin (cross-session: the polygon
   *  id changes on a fresh save, so persisting longer doesn't help). */
  let polyPreviewFor = $state<string | null>(null);
  let polyPreviewPos = $state<{ left: number; top: number }>({ left: 0, top: 0 });
  // Pinned BY DEFAULT (#155, 2026-06-10): without this an outside click
  // dismisses the popup mid-edit. Pinning makes "open + edit" the default
  // flow and "click pin to unpin" the explicit close gesture.
  let polyPreviewPinned = $state<boolean>(true);
  /** Frozen SVG view (center + half-extent) — DECOUPLED from polygon points
   *  so dragging a vertex doesn't trigger a global re-fit (the canvas was
   *  visibly zooming while you dragged a point — #155). The view is set
   *  ONCE on popup-open by `fitPolyPreview()` and after that only changes
   *  when the user clicks a toolbar button (zoom +/−, fit). Drag updates
   *  the polygon's POINTS without ever touching the view. */
  let polyPreviewView = $state<{ cx: number; cy: number; half: number }>({ cx: 0.5, cy: 0.5, half: 0.7 });
  /** User-resizable popup size — persisted across sessions so the
   *  preferred dimensions stick. Default 240 × 240; min 160 × 160. */
  let polyPreviewSize = $state<{ w: number; h: number }>({ w: 240, h: 240 });
  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem('ge-poly-preview-size');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed?.w === 'number' && typeof parsed?.h === 'number') {
          polyPreviewSize = {
            w: Math.max(160, Math.round(parsed.w)),
            h: Math.max(160, Math.round(parsed.h)),
          };
        }
      }
    } catch { /* ignore */ }
  }
  /** Drag-resize the popup via the bottom-right corner grip. Tracks
   *  start size + start cursor position so each pointermove computes
   *  an absolute size (dx + start.w, dy + start.h) instead of
   *  accumulating round-off across moves. */
  let polyPreviewResize = $state<{ startW: number; startH: number; startX: number; startY: number } | null>(null);
  function startPolyPreviewResize(ev: PointerEvent) {
    if (ev.button !== 0) return;
    polyPreviewResize = {
      startW: polyPreviewSize.w, startH: polyPreviewSize.h,
      startX: ev.clientX, startY: ev.clientY,
    };
    (ev.currentTarget as Element).setPointerCapture(ev.pointerId);
    ev.stopPropagation();
    ev.preventDefault();
  }
  function polyPreviewResizeMove(ev: PointerEvent) {
    if (!polyPreviewResize) return;
    const r = polyPreviewResize;
    polyPreviewSize = {
      w: Math.max(160, Math.round(r.startW + (ev.clientX - r.startX))),
      h: Math.max(160, Math.round(r.startH + (ev.clientY - r.startY))),
    };
  }
  function polyPreviewResizeEnd(ev: PointerEvent) {
    if (!polyPreviewResize) return;
    (ev.currentTarget as Element).releasePointerCapture(ev.pointerId);
    polyPreviewResize = null;
    try { localStorage.setItem('ge-poly-preview-size', JSON.stringify(polyPreviewSize)); } catch { /* ignore */ }
  }
  // ── Drag the popover by its title bar (2026-06-11) ────────────────────
  // The popover's default anchor is next to the polygon card on the graph
  // canvas — but when the user is also editing a loop card, that card
  // can sit ON TOP of the popover. Grab-and-move lets the user drop the
  // popover over the Threlte 3D canvas (or anywhere else) so it stays
  // visible. State tracks the down-cursor + start position so each move
  // is absolute (no accumulating drift). Position is NOT persisted —
  // a re-open re-anchors to the polygon card on the graph canvas.
  let polyPreviewDrag = $state<{ startX: number; startY: number; startLeft: number; startTop: number } | null>(null);
  function startPolyPreviewDrag(ev: PointerEvent) {
    // Only the grab-grip itself starts the drag — the toolbar buttons
    // and the pin/close icons inside the head must NOT pull the popover.
    if (ev.button !== 0) return;
    polyPreviewDrag = {
      startX: ev.clientX, startY: ev.clientY,
      startLeft: polyPreviewPos.left, startTop: polyPreviewPos.top,
    };
    (ev.currentTarget as Element).setPointerCapture(ev.pointerId);
    ev.stopPropagation();
    ev.preventDefault();
  }
  function polyPreviewDragMove(ev: PointerEvent) {
    if (!polyPreviewDrag) return;
    const d = polyPreviewDrag;
    polyPreviewPos = {
      left: Math.max(0, d.startLeft + (ev.clientX - d.startX)),
      top:  Math.max(0, d.startTop  + (ev.clientY - d.startY)),
    };
  }
  function polyPreviewDragEnd(ev: PointerEvent) {
    if (!polyPreviewDrag) return;
    (ev.currentTarget as Element).releasePointerCapture(ev.pointerId);
    polyPreviewDrag = null;
  }
  /** Snap the popover back to its anchor next to the active polygon
   *  card on the graph canvas (2026-06-11). Inverse of "drag it onto
   *  the 3D canvas to keep it visible" — once the loop edit is done,
   *  one click reels it back. Computes the position from the active
   *  polygon's current screen bbox so panning the canvas doesn't
   *  matter. */
  function snapPolyPreviewToCard() {
    if (!polyPreviewFor) return;
    if (typeof document === 'undefined') return;
    // The polygon card's outer <g> carries data-node-id so we can find
    // it without threading refs. Fall back to the eye button's bbox
    // when that data attribute isn't present.
    const cardEl = document.querySelector(`[data-node-id="${polyPreviewFor}"]`) as Element | null;
    const r = cardEl?.getBoundingClientRect();
    if (r) {
      polyPreviewPos = { left: r.right + 24, top: r.top };
    }
  }
  function openPolyPreview(ev: PointerEvent, polyId: string) {
    ev.stopPropagation();
    // Toggle off when the same polygon's 👁 is clicked again. Re-pin on
    // close so the next open is pinned again (default state, #155).
    if (polyPreviewFor === polyId) {
      polyPreviewFor = null; polyPreviewPinned = true; return;
    }
    // Anchor to the polygon CARD's right edge, not the eye-button's. The
    // 👁 is rendered as an SVG <text> at x = size.w - 30 INSIDE the card,
    // so its rect.right lands ~10–20px short of the card's right edge —
    // the popup would overlap the card. Walk up to the closest .ge-node
    // group (the card's outer <g>) and use ITS bbox so the popup lands
    // cleanly outside the card with comfortable breathing room.
    const target = ev.currentTarget as Element | null;
    const card = (target as any)?.closest?.('.ge-node') as Element | null;
    const r = (card ?? target)?.getBoundingClientRect();
    if (r) polyPreviewPos = { left: r.right + 24, top: r.top };
    polyPreviewFor = polyId;
    fitPolyPreview();
  }
  /** Compute a viewBox center + half-extent that frames the current
   *  polygon points with ~16% padding. For revolve profiles this snaps
   *  to the points' bbox; for cartesian it's symmetric around (0,0) so
   *  the user sees the origin (extrude rotates around it). 16% =
   *  enough breathing room that dragging a vertex slightly past the
   *  edge keeps it visible without immediately clipping. */
  function fitPolyPreview() {
    if (!polyPreviewFor) return;
    const node = graph.nodes[polyPreviewFor];
    if (!node || node.type !== 'polygon') return;
    const pts = polyToPoints(node);
    const isCart = polygonModeFor(polyPreviewFor) === 'cartesian';
    let xMin = 0, xMax = 1, yMin = 0, yMax = 1;
    if (pts.length > 0) {
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      xMin = Math.min(...xs); xMax = Math.max(...xs);
      yMin = Math.min(...ys); yMax = Math.max(...ys);
    }
    if (isCart) {
      const half = Math.max(Math.abs(xMin), Math.abs(xMax), Math.abs(yMin), Math.abs(yMax), 0.001) * 1.16;
      polyPreviewView = { cx: 0, cy: 0, half };
    } else {
      const w = Math.max(xMax - xMin, 0.001);
      const h = Math.max(yMax - yMin, 0.001);
      const cx = (xMin + xMax) / 2;
      const cy = (yMin + yMax) / 2;
      const half = Math.max(w, h) / 2 * 1.16;
      polyPreviewView = { cx, cy, half };
    }
  }
  /** Multiply the view's half-extent by `factor`. < 1 = zoom in (smaller
   *  view), > 1 = zoom out. Center stays put. */
  function zoomPolyPreview(factor: number) {
    polyPreviewView = { ...polyPreviewView, half: Math.max(0.001, polyPreviewView.half * factor) };
  }
  /** Toolbar append — adds a new vertex at the END of the polygon's
   *  points list, seeded from the previous last point. Same semantics
   *  as the per-row `+` button without needing a specific row clicked. */
  function appendPolyPoint() {
    if (!polyPreviewFor) return;
    graph = addPolygonPoint(graph, polyPreviewFor);
  }
  /** Toolbar delete — arms a "click-to-delete" cursor mode (2026-06-10).
   *  When armed, the next click on a vertex dot in the SVG (either the
   *  popup or the right-pane preview) REMOVES that vertex instead of
   *  opening the expression popover or starting a drag. The mode is
   *  STICKY (multiple deletes in a row work) — exit via clicking the
   *  toolbar button again, pressing Escape, or closing the popup. */
  let polyDeleteMode = $state<boolean>(false);
  function togglePolyDeleteMode() {
    polyDeleteMode = !polyDeleteMode;
    polyDrag = null; // cancel any in-flight drag when arming
  }
  /** Delete a SPECIFIC vertex from the active polygon — wired to the
   *  vertex-dot click handler when polyDeleteMode is on. Refuses to
   *  delete the only remaining point (would orphan the node geometry). */
  function deletePolyVertexAt(polyId: string, idx: number) {
    const n = graph.nodes[polyId] as any;
    if (!n?.points || n.points.length <= 1) return;
    graph = removePolygonPoint(graph, polyId, idx);
  }
  /** Evaluate a polygon's entries into concrete [x, y] number pairs.
   *  Literal coords pass through; expr/param coords are evaluated against
   *  the graph's current PARAMS defaults via `new Function` with `p` bound.
   *  REPEAT blocks (#154) expand to N points: the loop var (default `i`,
   *  range 0..count-1) is in scope for the r and z expressions. Anything
   *  that fails to evaluate is treated as 0 so the popup never crashes —
   *  the user sees a degenerate but still-rendered preview. */
  function polyToPoints(node: any): [number, number][] {
    if (!node || node.type !== 'polygon') return [];
    const params: Record<string, number> = {};
    for (const [k, v] of Object.entries(graph.params ?? {})) {
      params[k] = Number((v as any)?.default ?? 0);
    }
    const evalCoord = (val: any, extra?: Record<string, number>): number => {
      try {
        if (!val) return 0;
        if (val.kind === 'literal') return Number(val.value) || 0;
        if (val.kind === 'param')   return Number(params[val.param]) || 0;
        if (val.kind === 'expr') {
          // Math primitives + PI/tau already in scope via Function shadowing.
          const env = { ...params, ...(extra ?? {}) };
          const keys = Object.keys(env);
          const args = keys.map((k) => env[k]);
          const fn = new Function(
            'p', 'Math', 'PI', 'tau', 'cos', 'sin', 'tan', 'sqrt', 'abs',
            ...keys,
            `return (${String(val.expr)});`,
          );
          const out = fn(
            params, Math, Math.PI, 2 * Math.PI, Math.cos, Math.sin, Math.tan, Math.sqrt, Math.abs,
            ...args,
          );
          return Number.isFinite(out) ? Number(out) : 0;
        }
      } catch { /* ignore eval errors */ }
      return 0;
    };
    const out: [number, number][] = [];
    for (const entry of (node.points as any[])) {
      // repeat-ref (#157) — chase the sourceId to its PolyRepeatNode and
      // expand its r/z expressions across i = 0..count-1. The loop var
      // (named on the source) is bound in scope for the expressions.
      if (entry?.kind === 'repeat-ref') {
        const src = graph.nodes[entry.sourceId] as any;
        if (!src || src.type !== 'poly_repeat') continue;
        const n = Math.max(0, Math.min(2048, Math.round(evalCoord(src.count))));
        const loopVar = String(src.loopVar || 'i');
        const bindings = Array.isArray(src.bindings) ? src.bindings : [];
        for (let i = 0; i < n; i++) {
          // Loop var + NPts (the resolved count) in scope from the start —
          // the user expects to write `theta = i * tau / NPts` and have
          // NPts mean "the count for THIS loop". Bindings evaluate against
          // the running `extra` so later bindings can reference earlier
          // ones, the loop var, or NPts the same way the emitted JS const
          // cascade does at runtime.
          const extra: Record<string, number> = { [loopVar]: i, NPts: n };
          for (const b of bindings) {
            if (!b || typeof b.name !== 'string' || !b.name) continue;
            extra[b.name] = evalCoord(b.value, extra);
          }
          out.push([evalCoord(src.r, extra), evalCoord(src.z, extra)]);
        }
        continue;
      }
      // DEPRECATED inline repeat (pre-#157) — kept for any in-memory
      // graph that bypassed the hydrate migration. New saves never emit
      // this kind.
      if (entry?.kind === 'repeat') {
        const n = Math.max(0, Math.min(2048, Math.round(evalCoord(entry.count))));
        const loopVar = String(entry.loopVar || 'i');
        for (let i = 0; i < n; i++) {
          const extra = { [loopVar]: i };
          out.push([evalCoord(entry.r, extra), evalCoord(entry.z, extra)]);
        }
        continue;
      }
      // Literal vertex (legacy entries pre-#154 lack `kind` — treat as
      // point so old files keep working without a migration script).
      out.push([evalCoord(entry?.r), evalCoord(entry?.z)]);
    }
    return out;
  }

  /** Polygon-vertex drag state — when set, a `<circle>` dot on EITHER 2D
   *  surface (the right-pane 2D PREVIEW or the popup) is being dragged.
   *  Tracks the polygon node id, the vertex index, and the owning <svg>
   *  so pointermove can invert screen → svg → graph coords against the
   *  same viewBox.
   *
   *  Drag is gated: only fires when BOTH the vertex's r AND z are
   *  literals — wired (param/expr) coords would silently overwrite the
   *  wiring, so they read as `not-allowed` cursor and ignore pointerdown.
   *  Update on each pointermove rewrites the (r, z) ArgValues through
   *  `setPolygonCoord` (the same path the inline number inputs use), so
   *  the table, the popup, and the right-pane SVG all stay in sync.
   *
   *  Coord inversion math:
   *    revolve  (no transform)            graph_x = svgX, graph_y = svgY
   *    cartesian (scale(1,-1) translate)  graph_x = svgX, graph_y = -svgY
   *
   *  The SVG group transform on the cartesian path is
   *  `scale(1,-1) translate(0, -(2*yMin + h))`; since both surfaces
   *  build their viewBox symmetrically around 0 in cartesian mode
   *  (xMin = -half, yMin = -half), -(2*yMin + h) = 0 and the y-flip is
   *  pure scale(1,-1). Inverting reduces to graph_y = -svgY. */
  let polyDrag = $state<{
    polyId: string;
    idx: number;
    svgEl: SVGSVGElement;
    mode: 'revolve' | 'cartesian';
    /** Cursor position at pointerdown (clientX/Y). Lets pointerup
     *  decide whether the gesture was a CLICK (open expression
     *  popover) or a DRAG (already wrote new coords during move).
     *  A click is < 3 px movement total + pointerup within 250 ms. */
    startX: number;
    startY: number;
    startTime: number;
    moved: boolean;
    /** When true, the vertex has at least one non-literal coord — the
     *  drag path is suppressed (a non-literal can't accept a literal
     *  coord without breaking wiring) but a CLICK still opens the
     *  popover so the user can edit the expression. */
    parametric: boolean;
  } | null>(null);

  /** Begin a pointer gesture on a polygon vertex dot. Two outcomes:
   *    LITERAL/LITERAL coords  — drag path active. Movement past 3 px
   *                              writes new coords each pointermove.
   *                              Pointerup with no movement opens the
   *                              expression popover so the user can
   *                              CONVERT the literal to an expression.
   *    Any PARAMETRIC coord   — drag path disabled (would clobber the
   *                              binding). Pointerup opens the
   *                              expression popover for the wired axis. */
  function startPolyVertexDrag(
    ev: PointerEvent,
    polyId: string,
    idx: number,
    mode: 'revolve' | 'cartesian',
  ) {
    if (ev.button !== 0) return;
    const node: any = graph.nodes[polyId];
    if (!node || node.type !== 'polygon') return;
    const pt = node.points?.[idx];
    if (!pt) return;
    const parametric = pt.r?.kind !== 'literal' || pt.z?.kind !== 'literal';
    const circle = ev.currentTarget as SVGCircleElement;
    const svgEl = circle.ownerSVGElement;
    if (!svgEl) return;
    ev.stopPropagation();
    ev.preventDefault();
    try { circle.setPointerCapture(ev.pointerId); } catch { /* older browsers */ }
    polyDrag = {
      polyId, idx, svgEl, mode, parametric,
      startX: ev.clientX, startY: ev.clientY,
      startTime: (typeof performance !== 'undefined' ? performance : Date).now(),
      moved: false,
    };
  }

  /** Invert a screen-space cursor position to graph (r, z) (or x, y for
   *  cartesian) using the same SVG viewBox the dot was rendered into.
   *  Only writes coords once the cursor has moved more than 3 px from
   *  the pointerdown position — under that threshold the gesture is
   *  still a candidate click. */
  function polyDragMove(ev: PointerEvent) {
    if (!polyDrag) return;
    const d = polyDrag;
    const dist = Math.hypot(ev.clientX - d.startX, ev.clientY - d.startY);
    if (dist < 3) return;
    polyDrag.moved = true;
    // Parametric dots refuse the drag — movement triggers nothing,
    // but pointerup still opens the popover.
    if (d.parametric) return;
    const svgEl = d.svgEl;
    const vb = svgEl.viewBox?.baseVal;
    const rect = svgEl.getBoundingClientRect();
    if (!vb || rect.width === 0 || rect.height === 0) return;
    const svgX = vb.x + (ev.clientX - rect.left) * vb.width / rect.width;
    const svgY = vb.y + (ev.clientY - rect.top) * vb.height / rect.height;
    const graphX = svgX;
    const graphY = d.mode === 'cartesian' ? -svgY : svgY;
    const rRounded = Math.round(graphX * 1000) / 1000;
    const zRounded = Math.round(graphY * 1000) / 1000;
    graph = setPolygonCoord(graph, d.polyId, d.idx, 'r', { kind: 'literal', value: rRounded });
    graph = setPolygonCoord(graph, d.polyId, d.idx, 'z', { kind: 'literal', value: zRounded });
  }

  /** End the gesture. If no movement happened AND the pointer was up
   *  within 250 ms of down, treat as a click → open polyExprPop for
   *  the appropriate axis. */
  function polyDragEnd(ev: PointerEvent) {
    if (!polyDrag) return;
    const d = polyDrag;
    const target = ev.currentTarget as SVGCircleElement | null;
    try { target?.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
    polyDrag = null;
    const dt = (typeof performance !== 'undefined' ? performance : Date).now() - d.startTime;
    const isClick = !d.moved && dt < 250;
    if (!isClick) return;
    // DELETE MODE — clicking a vertex removes it (stays armed for the
    // next click, so the user can scrub through multiple deletes).
    if (polyDeleteMode) {
      deletePolyVertexAt(d.polyId, d.idx);
      return;
    }
    // CLICK semantics:
    //   * One coord parametric, one literal → open popover for the
    //     parametric axis (edit its expression).
    //   * Both literal → open popover for r (the user can also click
    //     ƒ on z in the table; click→edit-r is the common case).
    //   * Both parametric → open popover for r.
    const node: any = graph.nodes[d.polyId];
    const pt = node?.points?.[d.idx];
    if (!pt) return;
    const axis: 'r' | 'z' = (pt.r.kind !== 'literal') ? 'r'
                          : (pt.z.kind !== 'literal') ? 'z'
                          : 'r';
    const cur = pt[axis];
    const initialExpr = cur.kind === 'expr'    ? cur.expr
                      : cur.kind === 'param'   ? `p.${cur.param}`
                      : String(cur.value ?? 0);
    openPolyExprPop(ev as any, d.polyId, d.idx, axis, initialExpr);
  }

  // ─── Insert-mode (click on edge to insert a vertex) (#155, 2026-06-10) ─
  let polyInsertMode = $state<boolean>(false);
  /** Hover ghost — when polyInsertMode is on, pointermove on the SVG
   *  computes the nearest edge under the cursor + the perpendicular
   *  projection landing point. The popup renders this as a green line
   *  over the edge + a green circle at the projection so the user can
   *  see WHERE the new vertex will land before they click. Cleared on
   *  pointerleave. */
  let polyInsertHover = $state<null | {
    i: number;
    ax: number; ay: number;
    bx: number; by: number;
    px: number; py: number;
    /** True when the edge sits inside a repeat-block expansion — the
     *  click will be refused. The renderer flips the highlight from
     *  green→orange + draws a 🚫 marker at the projection so the user
     *  sees the block BEFORE clicking. */
    blocked: boolean;
  }>(null);
  function togglePolyInsertMode() {
    polyInsertMode = !polyInsertMode;
    if (polyInsertMode) polyDeleteMode = false;
    if (!polyInsertMode) polyInsertHover = null;
    polyDrag = null;
  }
  /** Vertex-proximity hover (2026-06-11). When the cursor is within
   *  ~2× the rendered dot radius of a polygon vertex, surface a
   *  highlight halo + (for parametric vertices) a small ƒ glyph so
   *  the user sees the dot is clickable for expression editing.
   *  Independent of insert/delete modes — applies always while the
   *  popup is open. `parametric` means r OR z is non-literal; the
   *  click handler routes to openPolyExprPop in that case. `inRepeat`
   *  means the dot is generated by a repeat-block; clicking opens the
   *  source loop card's r/z popover (a future polish) — for now the
   *  click is a no-op in repeat-expanded points. */
  let polyHoverVertex = $state<null | {
    i: number; px: number; py: number;
    parametric: boolean;
    inRepeat: boolean;
  }>(null);
  function clearPolyInsertHover() { polyInsertHover = null; polyHoverVertex = null; }
  function handleSvgInsertMove(ev: PointerEvent, polyId: string, isCart: boolean) {
    const svgEl = ev.currentTarget as SVGSVGElement;
    const vb = svgEl?.viewBox?.baseVal;
    const rect = svgEl?.getBoundingClientRect();
    if (!vb || !rect || rect.width === 0 || rect.height === 0) {
      polyInsertHover = null; polyHoverVertex = null; return;
    }
    const svgX = vb.x + (ev.clientX - rect.left) * vb.width / rect.width;
    const svgY = vb.y + (ev.clientY - rect.top) * vb.height / rect.height;
    const graphX = svgX;
    const graphY = isCart ? -svgY : svgY;
    const node: any = graph.nodes[polyId];
    if (!node || node.type !== 'polygon') {
      polyInsertHover = null; polyHoverVertex = null; return;
    }
    const pts = polyToPoints(node);
    if (pts.length === 0) { polyInsertHover = null; polyHoverVertex = null; return; }

    // ── Vertex proximity (always on, not just in insert mode) ─────────
    // The hover halo lives whenever the popup is open — clicking a
    // parametric vertex opens the ƒ-popup so the user needs to see
    // them as "tappable." Hit radius bumped to view-half * 0.09
    // (2026-06-11) so the click target is comfortably bigger than
    // the visual halo (~0.028 of w) — the user mostly clicks a few
    // pixels off the centre and wanted more breathing room.
    const view = polyPreviewView;
    const hitR = view.half * 0.09;
    let bestVi = -1, bestVd = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const d = Math.hypot(graphX - pts[i][0], graphY - pts[i][1]);
      if (d < hitR && d < bestVd) { bestVd = d; bestVi = i; }
    }
    if (bestVi >= 0) {
      const entryIdx = entryIdxForEvalIdx(node, bestVi);
      const inRepeat = entryIdx === null;
      const entry = entryIdx !== null ? node.points[entryIdx] : null;
      const parametric = inRepeat
        || (entry && (entry.r?.kind !== 'literal' || entry.z?.kind !== 'literal'));
      polyHoverVertex = {
        i: bestVi,
        px: pts[bestVi][0], py: pts[bestVi][1],
        parametric: !!parametric,
        inRepeat,
      };
    } else {
      polyHoverVertex = null;
    }

    // ── Edge hover (insert mode only) ────────────────────────────────
    if (!polyInsertMode) { polyInsertHover = null; return; }
    if (pts.length < 2) { polyInsertHover = null; return; }
    let bestI = -1, bestD = Infinity, bestPx = 0, bestPy = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len2 = dx * dx + dy * dy;
      if (len2 < 1e-9) continue;
      let t = ((graphX - a[0]) * dx + (graphY - a[1]) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const px = a[0] + t * dx;
      const py = a[1] + t * dy;
      const d = Math.hypot(graphX - px, graphY - py);
      if (d < bestD) { bestD = d; bestI = i; bestPx = px; bestPy = py; }
    }
    if (bestI < 0) { polyInsertHover = null; return; }
    const b = pts[(bestI + 1) % pts.length];
    const blocked = entryIdxForEvalIdx(node, bestI) === null;
    polyInsertHover = {
      i: bestI,
      ax: pts[bestI][0], ay: pts[bestI][1],
      bx: b[0], by: b[1],
      px: bestPx, py: bestPy,
      blocked,
    };
  }
  /** Cheap PARAMS-only eval for an ArgValue → number. Mirrors the
   *  evalCoord pipeline inside polyToPoints but standalone (no extra
   *  loop-var bindings). Used by entryIdxForEvalIdx to size each
   *  repeat-ref / repeat span without re-expanding the whole polygon. */
  function evalArgValueScalar(val: any): number {
    try {
      if (!val) return 0;
      if (val.kind === 'literal') return Number(val.value) || 0;
      if (val.kind === 'param') {
        return Number((graph.params as any)?.[val.param]?.default ?? 0);
      }
      if (val.kind === 'expr') {
        const params: Record<string, number> = {};
        for (const [k, v] of Object.entries(graph.params ?? {})) {
          params[k] = Number((v as any)?.default ?? 0);
        }
        const fn = new Function(
          'p', 'Math', 'PI', 'tau', 'cos', 'sin', 'tan', 'sqrt', 'abs',
          `return (${String(val.expr)});`,
        );
        const out = fn(params, Math, Math.PI, 2 * Math.PI, Math.cos, Math.sin, Math.tan, Math.sqrt, Math.abs);
        return Number.isFinite(out) ? Number(out) : 0;
      }
    } catch { /* ignore */ }
    return 0;
  }
  /** Map an evaluated-points-index back to the ENTRY index in the polygon's
   *  `points` array. Walks entries advancing `cursor` by each entry's
   *  expansion span. Repeat-ref / inline-repeat entries with N points
   *  cover [cursor..cursor+N); literal vertices cover {cursor}. Returns
   *  the entry index when the eval idx lands on a literal vertex; returns
   *  null when it falls inside a repeat expansion (those edges can't
   *  be UI-inserted — the user tweaks count/expressions instead). */
  function entryIdxForEvalIdx(node: any, evalIdx: number): number | null {
    let cursor = 0;
    for (let i = 0; i < node.points.length; i++) {
      const entry = node.points[i];
      let span = 1;
      if (entry?.kind === 'repeat-ref') {
        const src = graph.nodes[entry.sourceId] as any;
        span = (src && src.type === 'poly_repeat')
          ? Math.max(0, Math.min(2048, Math.round(evalArgValueScalar(src.count))))
          : 0;
      } else if (entry?.kind === 'repeat') {
        span = Math.max(0, Math.min(2048, Math.round(evalArgValueScalar(entry.count))));
      }
      if (evalIdx < cursor + span) {
        // Fell inside this entry. Only literal vertices accept a UI insert.
        if (entry?.kind === 'point' || !entry?.kind) return i;
        return null;
      }
      cursor += span;
    }
    return null;
  }
  /** Click anywhere on the SVG background while polyInsertMode is on:
   *  find the polygon edge closest to the click point, insert a new
   *  vertex between its endpoints at the click position. The new vertex
   *  is a LITERAL [r, z]. Refuses to act when the closest edge touches
   *  a repeat-block expansion (entryIdxForEvalIdx returns null). */
  function handleSvgInsertClick(ev: MouseEvent, polyId: string, isCart: boolean) {
    if (!polyInsertMode) return;
    const svgEl = (ev.currentTarget as SVGSVGElement);
    const vb = svgEl?.viewBox?.baseVal;
    const rect = svgEl?.getBoundingClientRect();
    if (!vb || !rect || rect.width === 0 || rect.height === 0) return;
    const svgX = vb.x + (ev.clientX - rect.left) * vb.width / rect.width;
    const svgY = vb.y + (ev.clientY - rect.top) * vb.height / rect.height;
    const graphX = svgX;
    const graphY = isCart ? -svgY : svgY;
    const node: any = graph.nodes[polyId];
    if (!node || node.type !== 'polygon') return;
    const pts = polyToPoints(node);
    if (pts.length < 2) { graph = addPolygonPoint(graph, polyId); return; }
    // Nearest-edge hit-test via point-to-segment perpendicular distance.
    let bestI = -1, bestD = Infinity, bestPx = 0, bestPy = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len2 = dx * dx + dy * dy;
      if (len2 < 1e-9) continue;
      let t = ((graphX - a[0]) * dx + (graphY - a[1]) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const px = a[0] + t * dx;
      const py = a[1] + t * dy;
      const d = Math.hypot(graphX - px, graphY - py);
      if (d < bestD) { bestD = d; bestI = i; bestPx = px; bestPy = py; }
    }
    if (bestI < 0) return;
    const entryIdx = entryIdxForEvalIdx(node, bestI);
    if (entryIdx === null) return; // edge inside a repeat block — refuse
    const r = Math.round(bestPx * 1000) / 1000;
    const z = Math.round(bestPy * 1000) / 1000;
    graph = addPolygonPoint(graph, polyId, entryIdx);
    graph = setPolygonCoord(graph, polyId, entryIdx + 1, 'r', { kind: 'literal', value: r });
    graph = setPolygonCoord(graph, polyId, entryIdx + 1, 'z', { kind: 'literal', value: z });
  }

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
   *  single polygon (no solid producer), use polygonModeFor on that
   *  polygon's id so the preview adapts to a downstream extrude even
   *  though extrude only becomes the consumer after wiring. With no
   *  polygon present, fall back to the file's saved set. */
  const rootPolygonMode = $derived.by<'revolve' | 'cartesian'>(() => {
    const polygons = Object.values(graph.nodes).filter((n) => (n as any).type === 'polygon') as any[];
    if (polygons.length === 0) return profileSet;
    return polygonModeFor(polygons[0].id);
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
   *  like the ⚙ canvas menu. Holds the instructions + the description
   *  textarea; the generated graph opens via props.onGenerated. */
  let aiMenuOpen = $state(false);
  let aiBtnEl = $state<HTMLButtonElement | null>(null);
  let aiMenuPos = $state<{ left: number; top: number }>({ left: 56, top: 120 });
  let aiPrompt = $state('');
  let aiBusy = $state(false);
  let aiError = $state<string | null>(null);
  let aiCandidates = $state<string[]>([]);
  /** Popover width — user-resizable via the native CSS resize grip
   *  (bottom-right corner); persisted so the chosen width sticks. */
  let aiMenuW = $state<number>(360);
  try { const w = Number(localStorage.getItem('ge-ai-menu-w')); if (w >= 264) aiMenuW = Math.min(720, w); } catch { /* SSR/off */ }
  let aiPanelEl = $state<HTMLDivElement | null>(null);
  function persistAiMenuW() {
    if (!aiPanelEl) return;
    const w = aiPanelEl.offsetWidth;
    if (w >= 264) {
      aiMenuW = w;
      try { localStorage.setItem('ge-ai-menu-w', String(w)); } catch { /* ignore */ }
    }
  }
  async function openAiMenu() {
    if (aiBtnEl) {
      const r = aiBtnEl.getBoundingClientRect();
      aiMenuPos = { left: r.right + 6, top: r.top };
    }
    aiError = null;
    aiMenuOpen = true;
    // The ✨ button lives at the BOTTOM of the rail, so anchoring the
    // popover's top to the button spills it below the viewport. After it
    // renders, measure + clamp so the whole panel stays on-screen (shift
    // UP if needed, never above a 12px top margin).
    await tick();
    if (aiPanelEl) {
      const h = aiPanelEl.offsetHeight;
      const margin = 12;
      const maxTop = window.innerHeight - h - margin;
      aiMenuPos = { ...aiMenuPos, top: Math.max(margin, Math.min(aiMenuPos.top, maxTop)) };
    }
  }
  async function generateFromPrompt() {
    const prompt = aiPrompt.trim();
    if (!prompt || aiBusy) return;
    aiBusy = true;
    aiError = null;
    aiCandidates = [];
    try {
      const r = await fetch('/api/rag/prompt', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      if (!r.ok) { aiError = `generate ${r.status}: ${(await r.text()).slice(0, 200)}`; return; }
      const j = await r.json();
      if (!j?.graph) { aiError = 'no graph in response'; return; }
      aiCandidates = Array.isArray(j.candidates) ? j.candidates : [];
      // Hydrate the proposed graph INTO the CURRENT tab (in place) — the
      // user generates from the open editor and the changes land HERE,
      // not in a new tab (2026-06-12). Auto-layout since a generated
      // graph carries no saved positions; set exemplarId so the first
      // Save lands under the suggested name.
      try {
        graph = autoLayoutGraph(hydrateGraph(j.graph));
      } catch (e) {
        console.warn('[graph-editor] generated graph failed to hydrate', e);
        aiError = 'the generated graph could not be loaded';
        return;
      }
      const gid = String(j.id || '').trim();
      if (/^[a-z_][a-z0-9_]*$/i.test(gid)) exemplarId = gid;
      // Notify the parent so it can rename the active tab's label (it must
      // NOT open a new tab — props.id only seeds on mount, so updating it
      // is a safe relabel, not a remount).
      props.onGenerated?.(exemplarId, j.graph, aiCandidates);
      aiPrompt = '';
      aiMenuOpen = false;
    } catch (e: any) {
      aiError = e?.message ?? String(e);
    } finally {
      aiBusy = false;
    }
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
    if (ev.key === 'Escape' && (polyDeleteMode || polyInsertMode)) {
      polyDeleteMode = false; polyInsertMode = false;
      return;
    }
    if (ev.key === 'Escape' && wireFrom) {
      wireFrom = null; wireMouse = null; wireJustArmed = false;
      return;
    }
    if (ev.key === 'Escape' && selectedSplineOpIdx != null) {
      selectedSplineOpIdx = null;
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
    ev.preventDefault();
    if (target.tagName === 'INPUT') (target as HTMLInputElement).blur();
    runBake();
  }
  onMount(() => {
    window.addEventListener('keydown', onWindowKeydown);
    try { isCoarse = window.matchMedia('(pointer: coarse)').matches; } catch { /* SSR/off */ }
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
      const r = await bakeGraphPreview(graph, { id: exemplarId, bust: bakeNonce > 1, ghosts: ghostIds });
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
      bakeNonce++;
      setTimeout(() => { rebuildStatus = null; rebuildBusy = false; }, 2000);
    } catch (e: any) {
      rebuildStatus = `✗ ${e?.message ?? String(e)}`;
      rebuildBusy = false;
    }
  }

  let PrimitiveDualCanvas = $state<any>(null);
  /** Set when a URL `?id=<name>` is given but the loaded source has no
   *  meta.graph (legacy text-format assembly OR a leaf primitive). The
   *  canvas stays empty + a banner surfaces above the source pane explaining
   *  why. The user can still Save a NEW graph alongside the legacy file —
   *  but we don't fight the user with auto-translation. */
  let legacyLoad = $state<{ id: string; reason: 'no-graph' | 'fetch-failed' } | null>(null);
  onMount(async () => {
    try {
      const mod = await import('$lib/shared/PrimitiveDualCanvas.svelte');
      PrimitiveDualCanvas = mod.default;
    } catch { /* canvas unavailable */ }

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

  /** Client-side graph-block extractor — walks balanced braces to isolate
   *  the `graph: {...}` literal inside the meta block, then evals as plain
   *  data via `new Function`. Pure object/array literals → safe.
   *  Returns undefined when the source has no graph block (legacy part). */
  function extractGraphFromSource(src: string): any | undefined {
    if (!src) return undefined;
    const m = /(^|[\s,{])graph\s*:\s*\{/m.exec(src);
    if (!m) return undefined;
    const startBrace = src.indexOf('{', m.index + m[0].length - 1);
    if (startBrace < 0) return undefined;
    let depth = 0;
    let end = -1;
    for (let i = startBrace; i < src.length; i++) {
      const c = src[i];
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end < 0) return undefined;
    const block = src.slice(startBrace, end + 1);
    try { return new Function(`return (${block});`)(); } catch { return undefined; }
  }
  /** Pull `drawingMd: '...'` (single-quoted, newlines escaped) out of a
   *  saved meta block. Companion to extractGraphFromSource for endpoints
   *  that don't return the parsed meta field. Returns '' when absent. */
  function extractDrawingMdFromSource(src: string): string {
    if (!src) return '';
    const m = /(^|[\s,{])drawingMd\s*:\s*'((?:\\'|[^'])*)'/m.exec(src);
    if (!m) return '';
    return (m[2] ?? '').replace(/\\n/g, '\n').replace(/\\'/g, "'").replace(/\\\\/g, '\\');
  }

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
    if (wireFrom) {
      if (!wirePointerMoved) {
        const dx = ev.clientX - wireDownAt.x, dy = ev.clientY - wireDownAt.y;
        if (dx * dx + dy * dy > 36) wirePointerMoved = true; // moved >6px ⇒ a drag, not a tap
      }
      const pt = clientToGraph(ev.clientX, ev.clientY);
      wireMouse = pt;
    }
  }
  function onCanvasPointerUp(ev: PointerEvent) {
    if (panning) { panning = false; canvasEl?.releasePointerCapture(ev.pointerId); }
    if (wireFrom) {
      // Tap-to-connect: a no-drag tap that just ARMED the wire stays armed so
      // the NEXT tap on a target socket completes it (touch + connect-mode).
      // Any other release — a drag that missed its target, or a tap on empty
      // canvas while already armed — cancels the in-flight wire.
      if (tapConnect && wireJustArmed && !wirePointerMoved) {
        wireJustArmed = false; // consume; the wire is now parked, waiting for a target tap
      } else {
        wireFrom = null; wireMouse = null; wireJustArmed = false;
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
    bringToFront(id);
    dragging = id;
    dragStart = { x: ev.clientX, y: ev.clientY };
    dragOrig = graph.layout[id] ?? { x: 0, y: 0 };
    (ev.currentTarget as Element).setPointerCapture(ev.pointerId);
    ev.stopPropagation();
  }
  function onNodePointerMove(ev: PointerEvent) {
    if (!dragging) return;
    const dx = (ev.clientX - dragStart.x) / zoom;
    const dy = (ev.clientY - dragStart.y) / zoom;
    // Preserve `w` so a position drag doesn't wipe out a previous resize.
    graph = setLayout(graph, dragging, { x: dragOrig.x + dx, y: dragOrig.y + dy, w: dragOrig.w });
  }
  function onNodePointerUp(ev: PointerEvent) {
    if (dragging) {
      (ev.currentTarget as Element).releasePointerCapture(ev.pointerId);
      dragging = null;
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
    const sz = nodeSize(node);
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
  const CARD_X0 = 8, CARD_Y0 = 8, CARD_PAD = 8, CARD_TITLE_H = 26;
  // PARAM_W is DYNAMIC — derived from the longest label so chips like
  // p.totalLen don't clip. Constants below are the FIXED footprint of the
  // pin + input + trash; the label slot expands to fit the longest name.
  const PARAM_W_MIN = 124, PARAM_H = 22, PARAM_GAP = 2;
  const PARAM_PIN_W = 14;        // 📌 column (icon only)
  const PARAM_INPUT_W = 48;      // numeric input column
  const PARAM_TRASH_W = 18;      // 🗑 column
  const PARAM_GAPS = 4 * 6;      // 4× 6 px gap between pin/name/val/trash
  const PARAM_CHIP_PAD = 12;     // 6 px L + R chip padding
  /** Approx char width for 11 px monospace — used to widen the chip to fit
   *  the longest `p.<name>` label without clipping. Caller passes the
   *  longest label CHAR COUNT (including the `p.` prefix). The 7.5 px
   *  bias gives a little extra slack so labels don't sit RIGHT against
   *  the ellipsis threshold. */
  function chipWidthFor(longestLabelChars: number): number {
    const labelPx = Math.max(40, Math.ceil(longestLabelChars * 7.5));
    const w = PARAM_CHIP_PAD + PARAM_PIN_W + PARAM_GAPS + labelPx + PARAM_INPUT_W + PARAM_TRASH_W;
    return Math.max(PARAM_W_MIN, w);
  }
  // Live longest-label-len → live chip width. Updates as params are added
  // / renamed / deleted; the wire endpoints + socket positions all read
  // PARAM_W so they track the chip's growing/shrinking right edge.
  let PARAM_W = $derived.by(() => {
    const names = Object.keys(graph.params ?? {});
    if (names.length === 0) return PARAM_W_MIN;
    const longest = Math.max(...names.map((n) => ('p.' + n).length));
    return chipWidthFor(longest);
  });
  /** Position of the i-th chip's top-left INSIDE the params card. */
  function paramPos(_name: string, i: number): { x: number; y: number } {
    return {
      x: CARD_X0 + CARD_PAD,
      y: CARD_Y0 + CARD_TITLE_H + CARD_PAD + i * (PARAM_H + PARAM_GAP),
    };
  }
  /** Card outer rect dimensions — derived from chip count + chip width. */
  function paramCardSize(n: number, chipW: number): { w: number; h: number } {
    return {
      w: CARD_PAD * 2 + chipW,
      h: CARD_TITLE_H + CARD_PAD * 2 + Math.max(1, n) * PARAM_H + Math.max(0, n - 1) * PARAM_GAP,
    };
  }
  let pcs = $derived(paramCardSize(Object.entries(graph.params ?? {}).length, PARAM_W));
  /** Where a param chip's OUTPUT socket sits — in GRAPH space (the wires
   *  render inside the pan/zoom group, so we convert from the chip's fixed
   *  viewport position back into graph coords). The conversion ensures the
   *  wire's endpoint always lands on the visual chip socket regardless of
   *  pan/zoom. The chip's group is translated to paramPos, and the socket
   *  inside that group sits at (PARAM_W + CARD_PAD + 4, PARAM_H / 2).  */
  /** Pull every `p.<ident>` reference out of an expression string. Returns
   *  unique names in first-occurrence order. Used to render wires from the
   *  referenced param chips into the arg slot when arg.kind === 'expr'. */
  function extractParamRefs(expr: string): string[] {
    if (!expr) return [];
    const re = /\bp\.([a-zA-Z_]\w*)\b/g;
    const seen = new Set<string>();
    const out: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(expr)) !== null) {
      const name = m[1]!;
      if (!seen.has(name)) { seen.add(name); out.push(name); }
    }
    return out;
  }
  function paramSocketPos(name: string, i: number): { x: number; y: number } {
    const p = paramPos(name, i);
    const vx = p.x + PARAM_W + CARD_PAD + 4;
    const vy = p.y + PARAM_H / 2;
    // viewport → graph: invert outer transform `translate(pan) ∘ scale(zoom)`.
    return { x: (vx - pan.x) / zoom, y: (vy - pan.y) / zoom };
  }

  // ─── drag-to-wire ───────────────────────────────────────────────────────
  // wireFrom is either a node's output socket OR a param's output chip. On
  // release over an input socket, the connection is committed.
  type WireSource =
    | { kind: 'out'; nodeId: NodeId }
    | { kind: 'param-out'; paramName: string };
  let wireFrom = $state<WireSource | null>(null);
  let wireMouse = $state<{ x: number; y: number } | null>(null);
  // Tap-to-connect. Drag-from-socket-to-socket is unreliable on touch (the
  // drop never registers), so instead of press-drag-release the user can TAP
  // a source socket to ARM a wire, then TAP a target socket to complete it.
  // Always on for coarse (touch) pointers; desktop users opt in via the 🔗
  // toolbar toggle. The drag path still works unchanged for the mouse.
  let connectMode = $state(false);
  let isCoarse = $state(false);
  const tapConnect = $derived(connectMode || isCoarse);
  let wireJustArmed = false;    // true only for the one pointerup right after arming
  let wirePointerMoved = false; // set once the pointer drags past threshold since arming
  let wireDownAt = { x: 0, y: 0 };
  function clientToGraph(cx: number, cy: number) {
    if (!canvasEl) return { x: cx, y: cy };
    const r = canvasEl.getBoundingClientRect();
    return { x: ((cx - r.left) - pan.x) / zoom, y: ((cy - r.top) - pan.y) / zoom };
  }
  // On touch/pen, the browser sets IMPLICIT pointer capture on the element
  // that received pointerdown, so every later pointermove/pointerup for this
  // pointerId is dispatched to the SOURCE socket — the target socket's
  // onpointerup never fires and the wire can't complete. Release it here so
  // events route to whatever element is under the finger (same as mouse).
  function releaseImplicitCapture(ev: PointerEvent) {
    try {
      const el = ev.currentTarget as Element;
      if (el.hasPointerCapture?.(ev.pointerId)) el.releasePointerCapture(ev.pointerId);
    } catch { /* older browsers */ }
  }
  function armWire(ev: PointerEvent) {
    wireJustArmed = true;
    wirePointerMoved = false;
    wireDownAt = { x: ev.clientX, y: ev.clientY };
  }
  function startWire(ev: PointerEvent, nodeId: NodeId) {
    ev.stopPropagation();
    releaseImplicitCapture(ev);
    wireFrom = { kind: 'out', nodeId };
    wireMouse = clientToGraph(ev.clientX, ev.clientY);
    armWire(ev);
  }
  function startParamWire(ev: PointerEvent, paramName: string) {
    ev.stopPropagation();
    releaseImplicitCapture(ev);
    wireFrom = { kind: 'param-out', paramName };
    wireMouse = clientToGraph(ev.clientX, ev.clientY);
    armWire(ev);
  }
  function endWireOnInput(ev: PointerEvent, targetId: NodeId, slot: 'obj' | 'arg' | 'child') {
    ev.stopPropagation();
    if (!wireFrom) return;
    // Only node-output wires fit method/transform sockets (those carry shapes).
    if (wireFrom.kind !== 'out' || wireFrom.nodeId === targetId) { wireFrom = null; wireMouse = null; return; }
    if (slot === 'obj' || slot === 'arg') {
      graph = setMethodInput(graph, targetId, slot, wireFrom.nodeId);
    } else {
      graph = setTransformChild(graph, targetId, wireFrom.nodeId);
    }
    wireFrom = null; wireMouse = null;
  }
  function endWireOnCallArg(ev: PointerEvent, callId: NodeId, key: string) {
    ev.stopPropagation();
    if (!wireFrom) return;
    if (wireFrom.kind === 'param-out') {
      graph = setCallArg(graph, callId, key, asParam(wireFrom.paramName));
    } else if (wireFrom.kind === 'out' && wireFrom.nodeId !== callId) {
      // Wire from another node's OUTPUT into this Call's arg. Today the
      // only producer that flows into a Call arg is a Polygon node (the
      // profile slot on r_revolve / r_weld_extrude). We encode the link
      // as an `expr` ArgValue carrying the `__POLY__<sourceId>` sentinel;
      // composition-emit.ts post-substitutes it with the source node's
      // varName at emit time. Visible wire renders from the source's
      // output socket to this arg's input socket via the same bezier
      // path used for param wires.
      graph = setCallArg(graph, callId, key, asExpr(`__POLY__${wireFrom.nodeId}`));
    }
    wireFrom = null; wireMouse = null;
  }
  /** Wire a param's output onto a polygon vertex's r or z coord. */
  function endWireOnPolygonCoord(ev: PointerEvent, polygonId: NodeId, idx: number, axis: 'r' | 'z') {
    ev.stopPropagation();
    if (!wireFrom) return;
    if (wireFrom.kind === 'param-out') {
      graph = setPolygonCoord(graph, polygonId, idx, axis, asParam(wireFrom.paramName));
    }
    wireFrom = null; wireMouse = null;
  }

  /** Drop a wire onto a PolyRepeatNode's NPts (count) input socket
   *  (2026-06-11). Wires `p.<name>` → loop.count = { kind:'param',
   *  param:<name> }. Drops from a node output (poly_repeat or other)
   *  are ignored — count takes a SCALAR, not a node. */
  function endWireOnPolyRepeatCount(ev: PointerEvent, repeatId: NodeId) {
    ev.stopPropagation();
    if (!wireFrom) return;
    if (wireFrom.kind === 'param-out') {
      graph = setPolyRepeatCount(graph, repeatId, asParam(wireFrom.paramName));
    }
    wireFrom = null; wireMouse = null;
  }
  /** Drop a wire onto a polygon's repeat-ref row (#157). When the wire's
   *  source is a poly_repeat node's output socket, REPOINT the row to
   *  that source. Drops from anything else are ignored. */
  function endWireOnPolygonRepeatRef(ev: PointerEvent, polygonId: NodeId, idx: number) {
    ev.stopPropagation();
    if (!wireFrom) return;
    if (wireFrom.kind === 'node-out') {
      const src = graph.nodes[wireFrom.nodeId];
      if (src && (src as any).type === 'poly_repeat') {
        const poly = graph.nodes[polygonId] as any;
        if (poly?.type === 'polygon') {
          const points = [...poly.points];
          points[idx] = { kind: 'repeat-ref', sourceId: wireFrom.nodeId };
          graph = { ...graph, nodes: { ...graph.nodes, [polygonId]: { ...poly, points } } };
        }
      }
    }
    wireFrom = null; wireMouse = null;
  }

  /** Wire a param's output onto one of a mv/rot's three xyz slots. */
  function endWireOnTransformAxis(ev: PointerEvent, transformId: NodeId, axis: 0 | 1 | 2) {
    ev.stopPropagation();
    if (!wireFrom) return;
    if (wireFrom.kind === 'param-out') {
      graph = setTransformAxisValue(graph, transformId, axis, asParam(wireFrom.paramName));
    }
    wireFrom = null; wireMouse = null;
  }
  /** Replace a param-wired transform axis with a literal default. */
  function unwireTransformAxis(transformId: NodeId, axis: 0 | 1 | 2, fallback = 0) {
    const node = graph.nodes[transformId];
    if (!node || (node.type !== 'mv' && node.type !== 'rot')) return;
    const field = node.type === 'mv' ? (node as MvNode).offset : (node as RotNode).rot;
    const cur = field[axis];
    const literal = cur?.kind === 'literal' ? cur.value : (cur?.kind === 'param' ? (graph.params[cur.param]?.default ?? fallback) : fallback);
    graph = setTransformAxis(graph, transformId, axis, typeof literal === 'number' ? literal : fallback);
  }
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
      const sz = nodeSize(node);
      out.push({ id, x: pos.x, y: pos.y, w: sz.w, h: sz.h });
    }
    return out;
  });

  /** Bezier from (x1,y1) to (x2,y2) — orthogonally routed AROUND any card
   *  whose body the default S-curve would cut through. The source + target
   *  endpoint cards are auto-detected (point sits within EDGE_TOLERANCE
   *  of a card's bounding box → that card is excluded from the obstacle
   *  set). If any non-endpoint obstacle intrudes, the curve's control
   *  points lift to the closer clear Y level (above or below all
   *  blockers), giving the wire a clean arch instead of a straight line
   *  through the offending card body. */
  function bezier(x1: number, y1: number, x2: number, y2: number): string {
    const dx = Math.max(40, Math.abs(x2 - x1) * 0.4);
    const cx1 = x1 + dx, cy1 = y1;
    const cx2 = x2 - dx, cy2 = y2;
    const defaultPath = `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`;
    // Tiny wires (e.g. a self-edge or the in-flight stub) don't need routing.
    const span = Math.hypot(x2 - x1, y2 - y1);
    if (span < 60 || cardObstacles.length === 0) return defaultPath;

    const EDGE_TOLERANCE = 10;
    const CLEAR_BUF = 28; // px above/below blocking cards (was 18 — bump
                          // so the arch reads clearly outside the body)
    const onEdge = (px: number, py: number, o: { x: number; y: number; w: number; h: number }) =>
      px >= o.x - EDGE_TOLERANCE && px <= o.x + o.w + EDGE_TOLERANCE &&
      py >= o.y - EDGE_TOLERANCE && py <= o.y + o.h + EDGE_TOLERANCE;

    // Endpoint cards — wires START and END on socket points that sit on
    // card edges; those cards are NOT obstacles for this wire.
    const endpointCards = new Set<string>();
    for (const o of cardObstacles) {
      if (onEdge(x1, y1, o) || onEdge(x2, y2, o)) endpointCards.add(o.id);
    }

    // Sample a cubic bezier given its control points; returns the worst
    // intrusion (top + bottom clearance of every offending card). The
    // router runs this on the default path AND on each lifted iteration
    // to catch wires whose arch itself crosses another card.
    function intrudeBounds(ax: number, ay: number, bx: number, by: number, cAx: number, cAy: number, cBx: number, cBy: number) {
      const samples = 14;
      let topClear = Infinity, botClear = -Infinity;
      let hits = 0;
      for (let i = 1; i < samples; i++) {
        const t = i / samples;
        const t1 = 1 - t;
        const sx = t1*t1*t1*ax + 3*t1*t1*t*cAx + 3*t1*t*t*cBx + t*t*t*bx;
        const sy = t1*t1*t1*ay + 3*t1*t1*t*cAy + 3*t1*t*t*cBy + t*t*t*by;
        for (const o of cardObstacles) {
          if (endpointCards.has(o.id)) continue;
          if (sx >= o.x && sx <= o.x + o.w && sy >= o.y && sy <= o.y + o.h) {
            hits++;
            if (o.y < topClear) topClear = o.y - CLEAR_BUF;
            if (o.y + o.h > botClear) botClear = o.y + o.h + CLEAR_BUF;
          }
        }
      }
      return { hits, topClear, botClear };
    }

    // First pass — default bezier. Picks an arch side + a Y level.
    const first = intrudeBounds(x1, y1, x2, y2, cx1, cy1, cx2, cy2);
    if (first.hits === 0) return defaultPath;
    const midY = (y1 + y2) / 2;
    let goUp = (midY - first.topClear) <= (first.botClear - midY);
    let arcY = goUp ? first.topClear : first.botClear;

    // Iterative refinement — lift the arch until it ALSO clears any card
    // its bend would otherwise cross. Caps at 4 passes (rarely needed for
    // typical graphs) and at the canvas bounds so we don't fly off.
    for (let pass = 0; pass < 4; pass++) {
      const re = intrudeBounds(x1, y1, x2, y2, cx1, arcY, cx2, arcY);
      if (re.hits === 0) break;
      // The arch itself is hitting a new card. Bump arcY further in the
      // same direction by the worst clearance we just collected.
      if (goUp)  arcY = Math.min(arcY, re.topClear);
      else       arcY = Math.max(arcY, re.botClear);
    }
    return `M ${x1} ${y1} C ${cx1} ${arcY}, ${cx2} ${arcY}, ${x2} ${y2}`;
  }

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
  /** Minimum width the card can shrink to — derived from the row content.
   *  For Call cards: key column (70 px for "label") + value cell (input +
   *  actions = ~76 px) + horizontal padding ~16 px. Everything else uses
   *  its native fixed default — the user resizes those rarely. */
  function cardMinWidth(node: any): number {
    if (node.type === 'call')   return 168; // 70 key + 76 value + 22 chrome
    if (node.type === 'method') return 96;  // ⊖ + label + × (sockets sit on edges)
    if (node.type === 'mv' || node.type === 'rot') return 116;
    if (node.type === 'repeat') return 170;
    if (node.type === 'list' || node.type === 'stack' || node.type === 'group') return 110;
    if (node.type === 'polygon') return 180; // tighter vertical layout — input + chrome fits at 180
    return 130;
  }
  /** Auto-fit width based on the card's content — title length + longest
   *  arg key character count + value cell footprint. The result is the
   *  DEFAULT width when no user override is set; the user can always
   *  drag the grip to override. */
  function cardAutoWidth(node: any): number {
    if (node.type === 'call') {
      const argKeys = Object.keys(node.args ?? {});
      const titleChars = (node.alias?.length ?? 0) + 3 + (node.src?.length ?? 0); // "A · dt_tube"
      const longestKey = argKeys.length ? Math.max(...argKeys.map((k) => k.length)) : 4;
      // 70 key column was a constant; widen if the longest key needs more
      // (still letting the input cell breathe).
      const keyW = Math.max(70, longestKey * 8 + 8);
      const valueW = 124; // input + ƒ + × comfortably
      const padding = 22;
      const fromArgs = keyW + valueW + padding;
      const fromTitle = titleChars * 7 + 50; // ⇄ ↻ × glyphs + side padding
      return Math.max(220, fromArgs, fromTitle);
    }
    if (node.type === 'method') return 110;
    if (node.type === 'mv' || node.type === 'rot') return 136;
    if (node.type === 'repeat') return 230;
    if (node.type === 'polygon') return 200; // narrowed for the vertical-stack layout
    if (node.type === 'list' || node.type === 'stack' || node.type === 'group') {
      // Auto-width based on the LONGEST child-slot label. Each slot prints
      // either the child's "alias · src" (call), "op(…)" (method/transform),
      // or a fallback. Width = padding + socket + longest_label + chrome.
      const labels: string[] = [];
      for (const cid of (node as any).children ?? []) {
        const child = graph.nodes[cid];
        if (!child) continue;
        labels.push(
          child.type === 'call'   ? `${(child as any).alias} · ${(child as any).src}` :
          child.type === 'method' ? `${(child as any).op}(…)` :
          child.type === 'mv'     ? 'mv(…)' :
          child.type === 'rot'    ? 'rot(…)' :
          child.type === 'stack'  ? 'stack(…)' :
          child.type === 'repeat' ? `repeat × ${(child as any).count?.kind === 'literal' ? (child as any).count.value : '…'}` :
          '(missing)',
        );
      }
      const longest = labels.length ? Math.max(...labels.map((s) => s.length)) : 12;
      // ~7 px per char monospace + 18 px socket + 44 px for the ▲▼ reorder
      // arrows + 14 px × button + 16 px padding. Title row has the ▶ chevron
      // + name + ⚙ gear so the header itself needs room; account for the min.
      const titleW = 90; // ▶ Output + gear with padding
      const rowW = longest * 7 + 18 + 44 + 14 + 16;
      // 120 px floor matches the Call card's min and reads as a real
      // container, not a half-collapsed sliver.
      return Math.max(120, Math.max(rowW, titleW));
    }
    return 180;
  }
  // ─── Polygon card row geometry ──────────────────────────────────────
  // The left-edge sockets + incoming wires are SVG, but the rows are HTML
  // inside a foreignObject — these constants MUST mirror the CSS:
  //   .ge-poly-vertex  border 1 + pad 2 + 18 + gap 1 + 18 + pad 2 + border 1
  //                    = 43px + 2px margin-bottom            → 45px pitch
  //   .ge-poly-rref    36px border-box + 2px margin-bottom   → 38px pitch
  //   .ge-poly-repeat  (deprecated inline block) ≈ 72px + 2px margin
  // Rows are heterogeneous, so socket Y is a cumulative walk, not idx*pitch.
  const POLY_VTX_PITCH = 45;
  const POLY_RREF_PITCH = 38;
  function polyEntryH(pt: any): number {
    if (pt?.kind === 'repeat-ref') return POLY_RREF_PITCH;
    if (pt?.kind === 'repeat') return 74; // deprecated inline block
    return POLY_VTX_PITCH;
  }
  /** Y of the idx-th row's top edge, in CARD coords (0 = card top). */
  function polyRowTop(node: any, idx: number): number {
    const pts: any[] = node?.points ?? [];
    let y = 36; // header + divider = the foreignObject's y offset
    for (let i = 0; i < Math.min(idx, pts.length); i++) y += polyEntryH(pts[i]);
    return y;
  }
  /** Socket centers in CARD coords. r/z sit on the two stacked sub-rows
   *  (border 1 + pad 2 + half of 18 = 12; + row 18 + gap 1 = 31); a
   *  repeat-ref row has ONE socket centered on its 36px body. */
  function polySockR(node: any, idx: number): number { return polyRowTop(node, idx) + 12; }
  function polySockZ(node: any, idx: number): number { return polyRowTop(node, idx) + 31; }
  function polySockRef(node: any, idx: number): number { return polyRowTop(node, idx) + 18; }

  // ─── Sketch op row geometry (mirrors the polygon pattern) ───────────────
  // Each line/spline op renders two STACKED sub-rows (r over z) like a polygon
  // vertex; fillet/chamfer is a single short row. SVG wire sockets sit at the
  // computed sub-row centres so params can be wired onto a coord.
  function sketchEntryH(op: any): number {
    return (op?.op === 'fillet' || op?.op === 'chamfer') ? 24 : 45; // 45 = POLY_VTX_PITCH (socket math +12/+31)
  }
  function sketchRowTop(node: any, idx: number): number {
    const ops: any[] = node?.ops ?? [];
    let y = 36; // header + divider
    for (let i = 0; i < Math.min(idx, ops.length); i++) y += sketchEntryH(ops[i]);
    return y;
  }
  function sketchSockR(node: any, idx: number): number { return sketchRowTop(node, idx) + 12; }
  function sketchSockZ(node: any, idx: number): number { return sketchRowTop(node, idx) + 31; }
  function sketchSockVal(node: any, idx: number): number { return sketchRowTop(node, idx) + 12; }
  /** When the ops list scrolls, the left-edge SVG sockets must shift up by the
   *  same amount (they don't live inside the scrolling HTML). Hide a row's
   *  sockets once its top scrolls outside the visible card band [36, scH]. */
  function sketchRowVisible(node: any, idx: number, scH: number): boolean {
    const top = sketchRowTop(node, idx) - sketchOpsScrollTop;
    return top >= 36 && top <= scH;
  }
  /** Wire a param's output onto a sketch op coord/field (r|z|radius|dist). */
  function endWireOnSketchCoord(ev: PointerEvent, sketchId: NodeId, opIdx: number, field: 'r' | 'z' | 'radius' | 'dist') {
    ev.stopPropagation();
    if (!wireFrom) return;
    if (wireFrom.kind === 'param-out') {
      graph = setSketchOpField(graph, sketchId, opIdx, field, asParam(wireFrom.paramName));
    }
    wireFrom = null; wireMouse = null;
  }
  /** S.3: wire a param's output onto a POINT's r/z socket on the 2D canvas.
   *  Mirrors endWireOnSketchCoord but is invoked from the on-canvas sockets. */
  function endWireOnSketchPoint(ev: PointerEvent, sketchId: NodeId, opIdx: number, axis: 'r' | 'z') {
    ev.stopPropagation();
    if (!wireFrom) return;
    if (wireFrom.kind === 'param-out') {
      graph = setSketchOpField(graph, sketchId, opIdx, axis, asParam(wireFrom.paramName));
    }
    wireFrom = null; wireMouse = null;
  }

  function nodeSize(node: any): { w: number; h: number } {
    // Width source of truth: graph.layout[id].w (persisted) → cardAutoWidth
    // fallback. The min clamp protects rows from collapsing below the
    // input+actions footprint even when a stale saved width is too small.
    const savedW = graph.layout[node.id]?.w;
    const baseW = typeof savedW === 'number' ? savedW : cardAutoWidth(node);
    const w = Math.max(cardMinWidth(node), baseW);
    if (node.type === 'call') {
      const argCount = Object.keys(node.args ?? {}).length;
      return { w, h: Math.max(80, 50 + argCount * 22) };
    }
    if (node.type === 'method') return { w, h: 64 };
    if (node.type === 'mv' || node.type === 'rot') return { w, h: 110 };
    if (node.type === 'repeat') return { w, h: 110 };
    if (node.type === 'list' || node.type === 'stack' || node.type === 'group') {
      const slots = (node.children?.length ?? 0) + 1;
      return { w, h: Math.max(60, 40 + slots * 22) };
    }
    if (node.type === 'polygon') {
      // Default height: header + N visible vertices + footer. User can
      // resize (corner grip works for height too now) to grow/shrink.
      // Persisted height in layout[id].h wins over the auto-fit.
      const MAX_VISIBLE = 8;
      const pts: any[] = (node as any).points ?? [];
      const rows = pts.slice(0, MAX_VISIBLE);
      const savedH = graph.layout[node.id]?.h;
      const rowsH = rows.length
        ? rows.reduce((a, pt) => a + polyEntryH(pt), 0)
        : POLY_VTX_PITCH;
      const autoH = 36 + rowsH + 30;
      const h = typeof savedH === 'number' ? Math.max(120, savedH) : autoH;
      return { w, h };
    }
    if (node.type === 'sketch') {
      // header + per-op rows (line/spline = stacked r/z = 45, corner = 24) +
      // footer. Uses sketchEntryH so the card height matches the socket row math.
      const ops: any[] = (node as any).ops ?? [];
      const rowsH = ops.reduce((a, o) => a + sketchEntryH(o), 0);
      const savedH = graph.layout[node.id]?.h;
      const autoH = 36 + Math.max(44, rowsH) + 62;
      const h = typeof savedH === 'number' ? Math.max(140, savedH) : autoH;
      return { w: Math.max(w, 210), h };
    }
    if (node.type === 'poly_repeat') {
      // 3-section card (#157) — params + bindings + loop. Variable height
      // so the bindings list can grow. Base: 154 px for params + loop +
      // chrome; each binding adds 22 px; section header + add-button add
      // a baseline 50 px when bindings exist; the no-binding case still
      // shows a compact `+ binding` add button so the affordance is
      // always visible.
      const bindings = (node as any).bindings ?? [];
      const bindingsH = 28 + bindings.length * 22 + 24; // hdr + rows + add btn
      return { w: 240, h: 154 + bindingsH - 24 };
    }
    return { w, h: 80 };
  }
  /** Input socket Y for the i-th child slot of a container (list/stack/group). */
  function containerSlotY(i: number): number { return 40 + i * 22; }
  /** Drag-wire target — when a wire ends on a container's slot, append the
   *  source node as a child of that container. Idempotent (won't double-add). */
  function endWireOnContainerSlot(ev: PointerEvent, containerId: NodeId) {
    if (!wireFrom) return;
    ev.stopPropagation();
    graph = appendContainerChild(graph, containerId, wireFrom.nodeId);
    wireFrom = null; wireMouse = null;
  }
  function nodePos(id: NodeId): { x: number; y: number } {
    return graph.layout[id] ?? { x: 0, y: 0 };
  }
  function outputSocketAt(id: NodeId): { x: number; y: number } {
    const node = graph.nodes[id];
    if (!node) return { x: 0, y: 0 };
    const { w, h } = nodeSize(node);
    const p = nodePos(id);
    // mv / rot put their OUTPUT socket on the title row's right edge
    // (y=16) — same vertical line as the child input on the left. Other
    // node types keep the middle-right edge default.
    if (node.type === 'mv' || node.type === 'rot') return { x: p.x + w, y: p.y + 16 };
    if (node.type === 'method') return { x: p.x + w, y: p.y + 14 };
    return { x: p.x + w, y: p.y + h / 2 };
  }
  function inputSocketAt(id: NodeId, slot: 'obj' | 'arg' | 'child'): { x: number; y: number } {
    const p = nodePos(id);
    const node = graph.nodes[id];
    if (!node) return p;
    if (slot === 'obj')  return { x: p.x, y: p.y + 42 };
    if (slot === 'arg')  return { x: p.x, y: p.y + 56 };
    // mv / rot put their child socket on the LEFT EDGE, vertically aligned
    // with the title row (y=16). Axis sockets line the rest of the left
    // edge underneath. Repeat keeps the legacy bottom-edge position via
    // its own renderer.
    if (slot === 'child' && (node.type === 'mv' || node.type === 'rot')) {
      return { x: p.x, y: p.y + 16 };
    }
    /* child (legacy left-edge for method/repeat) */
    return { x: p.x, y: p.y + 50 };
  }
  /** Container slot input socket position — the i-th child slot of a
   *  list/stack/group container's card. Used to draw the visible "piped
   *  into output" wires from each child node's output socket to its slot
   *  in the Output (root list) card. */
  function containerSlotInputAt(containerId: NodeId, i: number): { x: number; y: number } {
    const p = nodePos(containerId);
    return { x: p.x, y: p.y + containerSlotY(i) };
  }

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
        // stdstale carries r_revolve/r_extrude/r_weld_extrude (the engines being phased
        // out of stdlib but still callable); INCLUDE them so r_revolve + r_extrude
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
    let paramKeys: string[] = [];
    let defaults: Record<string, number> = {};
    try {
      const r = await fetch(`/api/primitives/source?name=${encodeURIComponent(src)}`);
      const d = await r.json() as any;
      const profileKeys = new Set<string>();
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
          profileKeys.add(k);
        } else {
          args[k] = asLiteral(p?.default ?? 0);
        }
        paramKeys.push(k);
        defaults[k] = Number(p?.default ?? 0);
      }
      // Infer the profile "set" (revolve vs cartesian) from the primitive
      // name. r_revolve → revolve (r,z); r_extrude / r_weld_extrude →
      // cartesian (x,y). Drives the kind filter in the picker.
      if (profileKeys.size > 0) {
        expectedProfileKeys = { ...expectedProfileKeys, [src]: profileKeys };
        expectedProfileSet = {
          ...expectedProfileSet,
          [src]: src === 'r_revolve' ? 'revolve' : 'cartesian',
        };
      }
    } catch { /* leave args empty */ }
    const result = addCall(graph, src, args);
    graph = result.graph;
    // Cache the expected params for drift detection — same fetch we just did.
    if (paramKeys.length > 0) {
      expectedParams = { ...expectedParams, [src]: paramKeys };
      expectedDefaults = { ...expectedDefaults, [src]: defaults };
    }
  }

  /** Lazy-load expected params for any Call whose src we haven't fetched
   *  yet (URL hydrate, paste-in from clipboard, etc.). Idempotent — only
   *  fetches each src once per session. */
  // Attempted-once guard — without it a `src` that 404s (renamed/missing
  // dependency) never lands in expectedParams, so the reactive effect below
  // re-fires and re-fetches it on every graph change → a tight loop that
  // floods /api/primitives/source (hammered prod, 2026-06-13). Record the
  // attempt FIRST so failures don't retry.
  const attemptedParams = new Set<string>();
  async function loadExpectedParamsFor(src: string) {
    if (!src || expectedParams[src] || attemptedParams.has(src)) return;
    attemptedParams.add(src);
    try {
      const r = await fetch(`/api/primitives/source?name=${encodeURIComponent(src)}`);
      if (!r.ok) return;
      const d = await r.json() as any;
      const keys = Object.keys(d.params ?? {});
      const defaults: Record<string, number> = {};
      const profileKeys = new Set<string>();
      for (const [k, p] of Object.entries((d.params ?? {}) as Record<string, any>)) {
        defaults[k] = Number(p.default ?? 0);
        if (p && typeof p === 'object' && p.type === 'profile') profileKeys.add(k);
      }
      expectedParams = { ...expectedParams, [src]: keys };
      expectedDefaults = { ...expectedDefaults, [src]: defaults };
      if (profileKeys.size > 0) {
        expectedProfileKeys = { ...expectedProfileKeys, [src]: profileKeys };
        expectedProfileSet = {
          ...expectedProfileSet,
          [src]: src === 'r_revolve' ? 'revolve' : 'cartesian',
        };
      }
    } catch { /* skip */ }
  }

  // Whenever the graph changes, fetch expected params for any new src.
  $effect(() => {
    const srcs = new Set<string>();
    for (const n of Object.values(graph.nodes)) {
      if (n.type === 'call') srcs.add(n.src);
    }
    for (const src of srcs) loadExpectedParamsFor(src);
  });

  /** A Call is "drifted" when its args keys differ from the underlying
   *  primitive's CURRENT meta.params keys. Returns false when expected
   *  params haven't been fetched yet (don't false-positive). */
  function isCallDrifted(callId: NodeId): boolean {
    const node = graph.nodes[callId];
    if (!node || node.type !== 'call') return false;
    const expected = expectedParams[node.src];
    if (!expected) return false;
    const have = Object.keys(node.args ?? {}).sort();
    const want = [...expected].sort();
    if (have.length !== want.length) return true;
    return have.some((k, i) => k !== want[i]);
  }

  /** Sync a drifted Call's args back to the primitive's CURRENT params:
   *    • keep existing arg values for keys that survive
   *    • add new keys with the primitive's default values
   *    • drop orphan keys
   *  Wholesale args replacement instead of incremental setCallArg so
   *  the graph diff is one transaction. */
  function refreshCallArgs(callId: NodeId) {
    const node = graph.nodes[callId];
    if (!node || node.type !== 'call') return;
    const expected = expectedParams[node.src];
    const defaults = expectedDefaults[node.src] ?? {};
    if (!expected) return;
    const newArgs: Record<string, any> = {};
    for (const k of expected) {
      const existing = (node.args as any)?.[k];
      newArgs[k] = existing ?? asLiteral(defaults[k] ?? 0);
    }
    // Replace the args wholesale (adds new keys, strips orphans), then
    // finalize() so graph.edges + imports are rebuilt — a raw node-spread
    // left graph.edges stale (phantom wires / wrong orphan detection). #2.
    const updated = { ...node, args: { ...newArgs } } as any;
    graph = finalize({ ...graph, nodes: { ...graph.nodes, [callId]: updated } });
  }
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
  /** Right-pane tab: 3D bake or live source. */
  let rightTab = $state<'bake' | 'source' | 'md'>('bake');
  onMount(() => {
    try {
      const a = Number(localStorage.getItem('ge-splitA-v4'));
      if (a >= 30 && a <= 85) splitA = a;
      const t = localStorage.getItem('ge-right-tab');
      if (t === 'bake' || t === 'source' || t === 'md') rightTab = t;
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
  function setRightTab(t: 'bake' | 'source' | 'md') {
    rightTab = t;
    try { localStorage.setItem('ge-right-tab', t); } catch { /* ignore */ }
  }

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
  /** ArgValue → editable string (literal number, p.<param>, or raw expr). */
  function argStr(a: any): string {
    if (!a) return '0';
    if (a.kind === 'literal') return String(a.value);
    if (a.kind === 'param') return `p.${a.param}`;
    return String(a.expr ?? '');
  }
  /** Editable string → ArgValue: a bare number → literal, else expr. */
  function argFrom(s: string): any {
    const t = (s ?? '').trim();
    if (/^-?\d*\.?\d+$/.test(t)) return { kind: 'literal', value: Number(t) };
    return { kind: 'expr', expr: t };
  }

  // ─── Full-tab sketch editor (plan M.2) ─────────────────────────────────
  let editingSketchId = $state<string | null>(null);
  let sketchTool = $state<'select' | 'line' | 'spline' | 'fillet' | 'chamfer'>('select');
  let sketchSvgEl = $state<SVGSVGElement | null>(null);
  function openSketchEditor(id: string) { editingSketchId = id; sketchTool = 'select'; selectedCornerOpIdx = null; selectedSplineOpIdx = null; sketchFrame = null; sketchCardSize = null; sketchOpsScrollTop = 0; }
  function closeSketchEditor() { editingSketchId = null; sketchDrag = null; splineDrag = null; selectedCornerOpIdx = null; selectedSplineOpIdx = null; sketchFrame = null; sketchCardSize = null; sketchOpsScrollTop = 0; }

  /** Param scope {name: default} for evaluating ArgValue fields to numbers. */
  function sketchParamScope(): Record<string, number> {
    const s: Record<string, number> = {};
    for (const [k, v] of Object.entries(graph.params)) s[k] = Number((v as any)?.default ?? 0);
    return s;
  }
  function evalArg(a: any, p: Record<string, number>): number {
    if (!a) return 0;
    if (a.kind === 'literal') return Number(a.value) || 0;
    if (a.kind === 'param') return Number(p[a.param] ?? 0);
    try { return Number(new Function('p', `with(p){ return (${String(a.expr)}); }`)(p)) || 0; } catch { return 0; }
  }
  /** The active sketch resolved to numbers: compiled outline + draggable
   *  anchors + extents (for the editor viewBox). */
  let sketchEditor = $derived.by(() => {
    if (!editingSketchId) return null;
    const node = graph.nodes[editingSketchId] as any;
    if (!node || node.type !== 'sketch') return null;
    const p = sketchParamScope();
    const ops: SketchOp[] = node.ops.map((o: any) => {
      if (o.op === 'line') return { op: 'line', r: evalArg(o.r, p), z: evalArg(o.z, p), mode: o.mode };
      if (o.op === 'spline') return {
        op: 'spline', r: evalArg(o.r, p), z: evalArg(o.z, p), mode: o.mode,
        pts: (o.pts ?? []).map((c: any) => [evalArg(c[0], p), evalArg(c[1], p)] as [number, number]),
        h0: o.h0 ? [evalArg(o.h0[0], p), evalArg(o.h0[1], p)] as [number, number] : undefined,
        h1: o.h1 ? [evalArg(o.h1[0], p), evalArg(o.h1[1], p)] as [number, number] : undefined,
      };
      if (o.op === 'fillet') return { op: 'fillet', radius: evalArg(o.radius, p) };
      return { op: 'chamfer', dist: evalArg(o.dist, p) };
    });
    const seg = node.segments ? evalArg(node.segments, p) : 64;
    let pts: [number, number][] = [];
    try { pts = compileSketch(ops, seg); } catch { pts = []; }
    const anchors: { opIdx: number; r: number; z: number; kind: string; literal: boolean; rel: boolean; corner: 'fillet' | 'chamfer' | null; cornerOpIdx: number | null }[] = [];
    // Accumulate a running cursor so relative (Δr,Δz) ops resolve to their
    // ABSOLUTE canvas positions — mirrors compileSketch/toVerts. The first
    // point op is always absolute.
    let cur: [number, number] = [0, 0]; let started = false;
    node.ops.forEach((o: any, i: number) => {
      if (o.op === 'line' || o.op === 'spline') {
        const nx = node.ops[i + 1];
        const corner = nx && (nx.op === 'fillet' || nx.op === 'chamfer') ? nx.op as 'fillet' | 'chamfer' : null;
        const rel = o.mode === 'rel' && started;
        const ar = rel ? cur[0] + evalArg(o.r, p) : evalArg(o.r, p);
        const az = rel ? cur[1] + evalArg(o.z, p) : evalArg(o.z, p);
        cur = [ar, az]; started = true;
        anchors.push({ opIdx: i, r: ar, z: az, kind: o.op, literal: o.r?.kind === 'literal' && o.z?.kind === 'literal', rel, corner, cornerOpIdx: corner ? i + 1 : null });
      }
    });
    const all = [...pts, ...anchors.map((a) => [a.r, a.z] as [number, number])];
    const xs = all.map((q) => q[0]); const ys = all.map((q) => q[1]);
    const minX = Math.min(0, ...xs), maxX = Math.max(1, ...xs), minY = Math.min(0, ...ys), maxY = Math.max(1, ...ys);
    return { node, ops, pts, anchors, ext: { minX, maxX, minY, maxY } };
  });

  // ─── S.1: focused, WIREABLE mini node-graph inside the sketcher ─────────
  // The sketcher's left column renders TWO real cards — the PARAMS card and
  // the sketch node card — in their OWN SVG coordinate space (no pan/zoom).
  // A param's output socket can be drag-wired straight onto a sketch
  // coordinate's input socket, exactly like the main graph but scoped to
  // editingSketchId. Reuses startParamWire + endWireOnSketchCoord + the
  // sketchSock* row math + the in-flight wireFrom/wireMouse preview.
  let miniSvgEl = $state<SVGSVGElement | null>(null);
  const MINI_PX = 10, MINI_PY = 10, MINI_GAP = 46, MINI_SCW = 152, MINI_FOOT_H = 58;
  /** i-th param chip top-left in mini coords. */
  function miniParamPos(i: number) {
    return { x: MINI_PX + CARD_PAD, y: MINI_PY + CARD_TITLE_H + CARD_PAD + i * (PARAM_H + PARAM_GAP) };
  }
  /** i-th param OUTPUT socket centre in mini coords (mirrors the main card). */
  function miniParamSock(i: number) {
    const p = miniParamPos(i);
    return { x: p.x + PARAM_W + CARD_PAD + 4, y: p.y + PARAM_H / 2 };
  }
  /** Whole mini-canvas layout (sketch card rect + viewBox), derived from the
   *  live param count + sketch ops so socket rows + the viewBox track edits. */
  let miniLayout = $derived.by(() => {
    const se = sketchEditor;
    if (!se) return null;
    const sx = MINI_PX + pcs.w + MINI_GAP, sy = MINI_PY;
    const opsH = (se.node.ops as any[]).reduce((a, op) => a + sketchEntryH(op), 0);
    const sch = 36 + opsH + MINI_FOOT_H;
    const w = sx + MINI_SCW + 12;
    const h = Math.max(MINI_PY + pcs.h, sy + sch) + 12;
    return { sx, sy, sch, w, h };
  });
  /** Simple cubic for the mini wire layer. (The main `bezier` routes around
   *  main-graph card obstacles whose coords don't apply in this space.) */
  function miniBez(x1: number, y1: number, x2: number, y2: number): string {
    const dx = Math.max(18, Math.abs(x2 - x1) * 0.5);
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  }
  /** client → cards-overlay coords. The overlay SVG (S.2) has NO viewBox and
   *  fills the stage at width/height:100% ⇒ user units are 1:1 with CSS px,
   *  so the mapping is just the rect offset. Drives the in-flight wire. */
  function miniEventToCoord(ev: PointerEvent): { x: number; y: number } | null {
    if (!miniSvgEl) return null;
    const r = miniSvgEl.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  }
  function miniPointerMove(ev: PointerEvent) {
    if (wireFrom) { const p = miniEventToCoord(ev); if (p) wireMouse = p; }
  }
  function miniPointerUp() {
    if (!wireFrom) return;
    // Mirror the main canvas: a no-drag tap that armed the wire stays armed
    // (tap-connect); any other release on empty space cancels the in-flight.
    if (tapConnect && wireJustArmed && !wirePointerMoved) { wireJustArmed = false; return; }
    wireFrom = null; wireMouse = null; wireJustArmed = false;
  }

  // FROZEN viewBox frame. Deriving the viewBox from the LIVE point extents
  // made the canvas rescale on every point drag (jarring). Freeze the frame
  // on open; only an explicit Fit re-derives it. Used for BOTH the SVG
  // viewBox and pointer→coord mapping so they stay consistent.
  let sketchFrame = $state<{ minX: number; maxX: number; minY: number; maxY: number } | null>(null);
  $effect(() => {
    if (editingSketchId && sketchEditor && !sketchFrame) {
      const e = sketchEditor.ext;
      sketchFrame = { minX: e.minX, maxX: e.maxX, minY: e.minY, maxY: e.maxY };
    }
  });
  function fitSketchFrame() {
    if (!sketchEditor) return;
    const e = sketchEditor.ext;
    sketchFrame = { minX: e.minX, maxX: e.maxX, minY: e.minY, maxY: e.maxY };
  }

  /** Map a pointer event to sketch (r,z) coords via the SVG viewBox. */
  function sketchEventToCoord(ev: PointerEvent): [number, number] | null {
    if (!sketchSvgEl || !sketchEditor) return null;
    const rect = sketchSvgEl.getBoundingClientRect();
    const { minX, maxX, minY, maxY } = sketchFrame ?? sketchEditor.ext;
    const pad = Math.max(maxX - minX, maxY - minY) * 0.12 + 0.2;
    const vbW = (maxX - minX) + 2 * pad, vbH = (maxY - minY) + 2 * pad;
    const fx = (ev.clientX - rect.left) / rect.width;
    const fy = (ev.clientY - rect.top) / rect.height;
    const r = (minX - pad) + fx * vbW;
    const z = (minY - pad) + fy * vbH;   // SVG y-down == z-down (revolve), so no flip
    return [Math.round(r * 1000) / 1000, Math.round(z * 1000) / 1000];
  }
  let sketchDrag = $state<{ opIdx: number } | null>(null);
  function sketchAnchorDown(ev: PointerEvent, opIdx: number, literal: boolean, kind?: string) {
    ev.stopPropagation();
    sketchTapMoved = false;
    // With the fillet/chamfer tool active, clicking a vertex anchor rounds/
    // bevels THAT corner (exact op index — no nearest-search needed).
    if (sketchTool === 'fillet' || sketchTool === 'chamfer') { cornerAtOpIdx(opIdx); return; }
    if (sketchTool !== 'select') return;
    // Click a spline's endpoint anchor → select that spline (reveals its
    // through-point + end-handle dots); clicking any other anchor clears it.
    if (kind === 'spline') { selectedSplineOpIdx = opIdx; selectedCornerOpIdx = null; }
    else selectedSplineOpIdx = null;
    if (!literal) return;
    sketchDrag = { opIdx };
    (ev.currentTarget as Element).setPointerCapture?.(ev.pointerId);
  }
  function sketchAnchorMove(ev: PointerEvent) {
    if (!sketchDrag || !editingSketchId) return;
    sketchTapMoved = true;
    const c = sketchEventToCoord(ev); if (!c) return;
    // For a relative (Δ) op, write the delta from the previous vertex's
    // absolute position so the increment is preserved; else write absolute.
    const node = graph.nodes[editingSketchId] as any;
    const op = node?.ops?.[sketchDrag.opIdx];
    const se = sketchEditor;
    let r = c[0], z = c[1];
    if (op?.mode === 'rel' && se) {
      const ai = se.anchors.findIndex((a) => a.opIdx === sketchDrag!.opIdx);
      if (ai > 0) { const prev = se.anchors[ai - 1]; r = +(c[0] - prev.r).toFixed(3); z = +(c[1] - prev.z).toFixed(3); }
    }
    graph = setSketchOpField(graph, editingSketchId, sketchDrag.opIdx, 'r', { kind: 'literal', value: r });
    graph = setSketchOpField(graph, editingSketchId, sketchDrag.opIdx, 'z', { kind: 'literal', value: z });
  }
  function sketchAnchorUp() { sketchDrag = null; }
  // Mobile equivalent of the mouse ondblclick → open the point's coordinate
  // popover. `dblclick` doesn't reliably fire for touch, so detect a
  // double-TAP (two quick taps on the same anchor with no drag between).
  let sketchLastTap: { opIdx: number; t: number } | null = null;
  let sketchTapMoved = false;
  function sketchAnchorTap(ev: PointerEvent, sid: NodeId, opIdx: number, curR: string) {
    if (ev.pointerType !== 'touch') return;        // mouse path is ondblclick
    if (sketchTapMoved) { sketchLastTap = null; return; } // it was a drag, not a tap
    if (sketchTool !== 'select') return;
    const now = Date.now();
    if (sketchLastTap && sketchLastTap.opIdx === opIdx && now - sketchLastTap.t < 350) {
      sketchLastTap = null;
      openSketchExprPop(ev as unknown as MouseEvent, sid, opIdx, 'r', curR);
    } else {
      sketchLastTap = { opIdx, t: now };
    }
  }

  // ─── M.3: per-corner fillet/chamfer by click + a live radius dial ───────
  // With the fillet/chamfer tool active, clicking near a CORNER inserts that
  // op right after the corner's vertex (so the engine rounds THAT corner with
  // its own radius), and selects it so the toolbar radius/dist dial edits it
  // live. Clicking a corner that already has the op just selects it.
  let selectedCornerOpIdx = $state<number | null>(null);
  const selectedCorner = $derived.by(() => {
    if (selectedCornerOpIdx == null || !editingSketchId) return null;
    const node = graph.nodes[editingSketchId] as any;
    const o = node?.ops?.[selectedCornerOpIdx];
    if (!o || (o.op !== 'fillet' && o.op !== 'chamfer')) return null;
    const p = sketchParamScope();
    const field = o.op === 'fillet' ? 'radius' : 'dist';
    const arg = o[field];                 // the raw ArgValue (literal | param | expr)
    const bound = arg?.kind === 'param' || arg?.kind === 'expr';
    const label = arg?.kind === 'param' ? `p.${arg.param}` : arg?.kind === 'expr' ? String(arg.expr) : null;
    return { idx: selectedCornerOpIdx, kind: o.op as 'fillet' | 'chamfer', field, value: evalArg(arg, p), bound, label, paramName: arg?.kind === 'param' ? arg.param : null };
  });
  /** Names of the graph's params (PARAMS card) — the wireable `p.*` set. */
  const paramNames = $derived(Object.keys(graph.params ?? {}));
  /** Bind / unbind the selected corner's radius|dist to a param `p.<name>`. */
  function bindCornerParam(name: string) {
    const sc = selectedCorner; if (!sc || !editingSketchId) return;
    if (name === '__literal__' || name === '') {
      graph = setSketchOpField(graph, editingSketchId, sc.idx, sc.field as any, { kind: 'literal', value: Math.max(0, Math.round(sc.value * 1000) / 1000) });
    } else {
      graph = setSketchOpField(graph, editingSketchId, sc.idx, sc.field as any, asParam(name));
    }
  }
  /** Round/bevel the corner at vertex op `vIdx` with the active tool, then
   *  select it for the radius/dist dial. Inserts the corner op right after the
   *  vertex; if the corner already has one, switches its kind or just selects. */
  function cornerAtOpIdx(vIdx: number) {
    if (!editingSketchId) return;
    selectedSplineOpIdx = null;
    const node = graph.nodes[editingSketchId] as any;
    const next = node.ops[vIdx + 1];
    if (next && (next.op === 'fillet' || next.op === 'chamfer')) {
      if (next.op !== sketchTool) {
        graph = removeSketchOp(graph, editingSketchId, vIdx + 1);
        graph = addSketchOp(graph, editingSketchId, sketchTool as any, vIdx);
      }
    } else {
      graph = addSketchOp(graph, editingSketchId, sketchTool as any, vIdx);
    }
    selectedCornerOpIdx = vIdx + 1;
  }
  /** Canvas click with the fillet/chamfer tool → round the NEAREST vertex. */
  function applyCornerAt(c: [number, number]) {
    if (!editingSketchId) return;
    const se = sketchEditor;
    if (!se || !se.anchors.length) {
      graph = addSketchOp(graph, editingSketchId, sketchTool as any);
      selectedCornerOpIdx = (graph.nodes[editingSketchId] as any).ops.length - 1;
      return;
    }
    let bestOpIdx = -1, bestD = Infinity;
    for (const a of se.anchors) {
      const d = Math.hypot(a.r - c[0], a.z - c[1]);
      if (d < bestD) { bestD = d; bestOpIdx = a.opIdx; }
    }
    cornerAtOpIdx(bestOpIdx);
  }
  function setCornerValue(v: number) {
    const sc = selectedCorner; if (!sc || !editingSketchId) return;
    graph = setSketchOpField(graph, editingSketchId, sc.idx, sc.field as any, { kind: 'literal', value: Math.max(0, Math.round(v * 1000) / 1000) });
  }
  function removeSelectedCorner() {
    if (selectedCornerOpIdx == null || !editingSketchId) return;
    graph = removeSketchOp(graph, editingSketchId, selectedCornerOpIdx);
    selectedCornerOpIdx = null;
  }

  // ─── Phase 2: spline-as-entity editing (docs/plans/spline-redesign.md §6a) ─
  // Selecting a spline endpoint anchor (SELECT tool) sets selectedSplineOpIdx.
  // That reveals draggable through-point dots + two relative end-handle dots,
  // all stored in the chord-affine frame (a=prev vertex, b=this op's r,z).
  let selectedSplineOpIdx = $state<number | null>(null);
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  /** Resolve the selected spline to absolute on-canvas geometry: chord
   *  endpoints a/b, through-point dots, and the two end-handle dots (each
   *  carries `set` — true when the op stores it, false = a ghost default the
   *  user can grab to CREATE the handle). */
  const selectedSpline = $derived.by(() => {
    if (selectedSplineOpIdx == null || !sketchEditor) return null;
    const se = sketchEditor;
    const ai = se.anchors.findIndex((x) => x.opIdx === selectedSplineOpIdx);
    if (ai < 0 || se.anchors[ai].kind !== 'spline') return null;
    const b: [number, number] = [se.anchors[ai].r, se.anchors[ai].z];
    // Previous vertex (wraps — the sketch outline is closed), same as the
    // engine's chord start `a`.
    const prev = se.anchors[(ai - 1 + se.anchors.length) % se.anchors.length];
    const a: [number, number] = [prev.r, prev.z];
    const o = se.node.ops[selectedSplineOpIdx] as any;
    const p = sketchParamScope();
    const pts = (o.pts ?? []).map((c: any, k: number) => {
      const u = evalArg(c[0], p), v = evalArg(c[1], p);
      const abs = chordToAbs(a, b, u, v);
      return { k, x: abs[0], y: abs[1] };
    });
    // Handle dot: stored h displaces off `a` (h0) or `b` (h1); absent → a
    // sensible default along the chord (±1/3) shown as a ghost.
    const handleDot = (h: any, base: 'a' | 'b') => {
      const set = !!h;
      const u = set ? evalArg(h[0], p) : (base === 'a' ? 1 / 3 : -1 / 3);
      const v = set ? evalArg(h[1], p) : 0;
      const absA = chordToAbs(a, b, u, v);        // a + chord-frame disp
      const dx = absA[0] - a[0], dy = absA[1] - a[1];
      const O = base === 'a' ? a : b;
      return { set, x: O[0] + dx, y: O[1] + dy };
    };
    return { opIdx: selectedSplineOpIdx, a, b, pts, h0: handleDot(o.h0, 'a'), h1: handleDot(o.h1, 'b') };
  });

  let splineDrag = $state<{ which: 'pt' | 'h0' | 'h1'; ptIdx?: number } | null>(null);
  function splineCompDown(ev: PointerEvent, which: 'pt' | 'h0' | 'h1', ptIdx?: number) {
    ev.stopPropagation();
    if (sketchTool !== 'select') return;
    splineDrag = { which, ptIdx };
    (ev.currentTarget as Element).setPointerCapture?.(ev.pointerId);
  }
  function splineCompMove(ev: PointerEvent) {
    if (!splineDrag || !editingSketchId) return;
    const ss = selectedSpline; if (!ss) return;
    const c = sketchEventToCoord(ev); if (!c) return;
    const { a, b } = ss;
    if (splineDrag.which === 'pt') {
      const [u, v] = absToChord(a, b, c);
      graph = setSketchSplinePoint(graph, editingSketchId, ss.opIdx, splineDrag.ptIdx!, 'u', asLiteral(r3(u)));
      graph = setSketchSplinePoint(graph, editingSketchId, ss.opIdx, splineDrag.ptIdx!, 'v', asLiteral(r3(v)));
    } else {
      // h0 displaces off a (use the pointer directly); h1 displaces off b —
      // shift the pointer into a's frame so absToChord yields the (u,v) of the
      // displacement off b.
      const which = splineDrag.which;
      const p: [number, number] = which === 'h0' ? c : [a[0] + (c[0] - b[0]), a[1] + (c[1] - b[1])];
      const [u, v] = absToChord(a, b, p);
      graph = setSketchSplineHandle(graph, editingSketchId, ss.opIdx, which, 'u', asLiteral(r3(u)));
      graph = setSketchSplineHandle(graph, editingSketchId, ss.opIdx, which, 'v', asLiteral(r3(v)));
    }
  }
  function splineCompUp(ev: PointerEvent) { releaseImplicitCapture(ev); splineDrag = null; }

  function addSplinePt() {
    if (selectedSplineOpIdx == null || !editingSketchId) return;
    graph = addSketchSplinePoint(graph, editingSketchId, selectedSplineOpIdx);
  }
  function removeSplinePt() {
    const ss = selectedSpline; if (!ss || ss.pts.length === 0 || !editingSketchId) return;
    graph = removeSketchSplinePoint(graph, editingSketchId, ss.opIdx, ss.pts.length - 1);
  }
  function autoTangentSpline() {
    if (selectedSplineOpIdx == null || !editingSketchId) return;
    graph = clearSketchSplineHandle(graph, editingSketchId, selectedSplineOpIdx, 'h0');
    graph = clearSketchSplineHandle(graph, editingSketchId, selectedSplineOpIdx, 'h1');
  }
  /** Shortest distance from point (px,py) to segment a→b (clamped to the ends). */
  function ptSegDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx, cy = ay + t * dy;
    return Math.hypot(px - cx, py - cy);
  }
  /** Click on the canvas with a tool active → add an op. With the line/spline
   *  tool and ≥2 vertices, the new point is inserted ON the nearest EDGE
   *  (splitting that segment at the right sequence position) rather than always
   *  appended; clicks far from every edge fall back to the append behaviour. */
  function sketchCanvasClick(ev: PointerEvent) {
    if (!editingSketchId) return;
    if (sketchTool === 'select') {
      selectedSplineOpIdx = null;
      // Begin a view PAN — drag the empty canvas to reposition the view for
      // better visibility. (Anchors/sockets stopPropagation on their own
      // pointerdown, so this only fires on empty canvas.) A click with no
      // movement leaves the frame unchanged (just deselects, above).
      const se2 = sketchEditor;
      if (se2 && sketchSvgEl) {
        const f = sketchFrame ?? se2.ext;
        const pad = Math.max(f.maxX - f.minX, f.maxY - f.minY) * 0.12 + 0.2;
        const vbW = (f.maxX - f.minX) + 2 * pad, vbH = (f.maxY - f.minY) + 2 * pad;
        const rect = sketchSvgEl.getBoundingClientRect();
        sketchPanDrag = { minX: f.minX, maxX: f.maxX, minY: f.minY, maxY: f.maxY,
          px: ev.clientX, py: ev.clientY, sx: vbW / rect.width, sy: vbH / rect.height };
        try { (ev.currentTarget as Element).setPointerCapture?.(ev.pointerId); } catch { /* ignore */ }
      }
      return;
    }
    const c = sketchEventToCoord(ev); if (!c) return;
    if (sketchTool === 'fillet' || sketchTool === 'chamfer') { applyCornerAt(c); return; }
    // Edge-aware insertion (line/spline): find the nearest edge between
    // consecutive vertices (incl. the closing edge back to the first), then
    // insert the op after that edge's START vertex so it lands between them.
    let afterIdx: number | undefined;
    const se = sketchEditor;
    if (se && se.anchors.length >= 2) {
      const an = se.anchors;
      const f = sketchFrame ?? se.ext;
      const span = Math.max(f.maxX - f.minX, f.maxY - f.minY) || 1;
      const thresh = span * 0.15;
      let bestD = Infinity, bestStart = -1;
      for (let i = 0; i < an.length; i++) {
        const a = an[i], b = an[(i + 1) % an.length];
        const d = ptSegDist(c[0], c[1], a.r, a.z, b.r, b.z);
        if (d < bestD) { bestD = d; bestStart = i; }
      }
      if (bestStart >= 0 && bestD <= thresh) {
        const start = an[bestStart];
        // Skip past the start vertex's own corner op (if any) so the fillet/
        // chamfer stays attached to the original vertex, not the new one.
        afterIdx = start.cornerOpIdx ?? start.opIdx;
      }
    }
    graph = addSketchOp(graph, editingSketchId, sketchTool, afterIdx);
    const node = graph.nodes[editingSketchId] as any;
    const idx = typeof afterIdx === 'number' ? afterIdx + 1 : node.ops.length - 1;
    graph = setSketchOpField(graph, editingSketchId, idx, 'r', { kind: 'literal', value: c[0] });
    graph = setSketchOpField(graph, editingSketchId, idx, 'z', { kind: 'literal', value: c[1] });
  }

  // ─── Pan + zoom the sketcher VIEW (sketchFrame is the view rect) ─────────
  // Drag empty canvas to pan; wheel to zoom toward the cursor. Both just move
  // sketchFrame; Fit (⤢) re-frames to the sketch.
  let sketchPanDrag = $state<{ minX: number; maxX: number; minY: number; maxY: number; px: number; py: number; sx: number; sy: number } | null>(null);
  function sketchCanvasWheel(ev: WheelEvent) {
    if (!editingSketchId) return;
    const f = sketchFrame ?? sketchEditor?.ext;
    if (!f) return;
    ev.preventDefault();
    const c = sketchEventToCoord(ev as unknown as PointerEvent); if (!c) return;
    const k = ev.deltaY > 0 ? 1.12 : 1 / 1.12;   // out / in, zoom toward cursor
    sketchFrame = {
      minX: c[0] - (c[0] - f.minX) * k, maxX: c[0] + (f.maxX - c[0]) * k,
      minY: c[1] - (c[1] - f.minY) * k, maxY: c[1] + (f.maxY - c[1]) * k,
    };
  }

  // ─── Draggable top toolbar in the sketch editor ─────────────────────────
  // The status / radius-dial / Done bar floats over the stage and can be
  // dragged anywhere (offsets are relative to the editor container).
  let sketchBarPos = $state<{ x: number; y: number }>({ x: 16, y: 10 });
  let sketchBarDrag: { sx: number; sy: number; px: number; py: number } | null = null;
  function sketchBarDown(ev: PointerEvent) {
    ev.stopPropagation();
    sketchBarDrag = { sx: sketchBarPos.x, sy: sketchBarPos.y, px: ev.clientX, py: ev.clientY };
    try { (ev.currentTarget as Element).setPointerCapture?.(ev.pointerId); } catch { /* ignore */ }
  }
  function sketchBarMove(ev: PointerEvent) {
    if (!sketchBarDrag) return;
    sketchBarPos = { x: sketchBarDrag.sx + (ev.clientX - sketchBarDrag.px), y: sketchBarDrag.sy + (ev.clientY - sketchBarDrag.py) };
  }
  function sketchBarUp(ev: PointerEvent) {
    if (!sketchBarDrag) return;
    sketchBarDrag = null;
    try { (ev.currentTarget as Element).releasePointerCapture?.(ev.pointerId); } catch { /* ignore */ }
  }

  // ─── S.2: floating, draggable PARAMS + sketch cards over the 2D canvas ───
  // The two mini-graph cards float ON TOP of the big 2D draw stage (like the
  // main graph's PARAMS overlay), each draggable by its title bar. Positions
  // live in the cards-overlay SVG's pixel space (1:1 with the stage; the
  // overlay has no viewBox). The wire layer + sockets re-route from these
  // positions, so wiring a param → coord keeps working as the cards move.
  let sketchCardPos = $state<{ params: { x: number; y: number }; sketch: { x: number; y: number } }>(
    { params: { x: 64, y: 56 }, sketch: { x: 64, y: 244 } }
  );
  let sketchCardDrag: { which: 'params' | 'sketch'; sx: number; sy: number; px: number; py: number } | null = null;
  // Resizable sketch card (overrides MINI_SCW / ml.sch when set). null = auto-fit.
  let sketchCardSize = $state<{ w: number; h: number } | null>(null);
  let sketchCardResize: { sw: number; sh: number; px: number; py: number } | null = null;
  // Live scroll offset of the ops list — left-edge SVG sockets must shift by
  // this (and hide when scrolled out of the card) since they don't scroll with
  // the inner HTML.
  let sketchOpsScrollTop = $state(0);
  function sketchCardResizeDown(ev: PointerEvent) {
    if (ev.button !== 0) return;
    ev.stopPropagation();
    const w = sketchCardSize?.w ?? MINI_SCW;
    const h = sketchCardSize?.h ?? (miniLayout?.sch ?? 200);
    sketchCardResize = { sw: w, sh: h, px: ev.clientX, py: ev.clientY };
    try { (ev.currentTarget as Element).setPointerCapture?.(ev.pointerId); } catch { /* ignore */ }
  }
  function sketchCardResizeMove(ev: PointerEvent) {
    if (!sketchCardResize) return;
    const d = sketchCardResize;
    sketchCardSize = {
      w: Math.max(140, d.sw + (ev.clientX - d.px)),
      h: Math.max(120, d.sh + (ev.clientY - d.py)),
    };
  }
  function sketchCardResizeUp(ev: PointerEvent) {
    if (!sketchCardResize) return;
    sketchCardResize = null;
    releaseImplicitCapture(ev);
  }
  function sketchCardDown(ev: PointerEvent, which: 'params' | 'sketch') {
    if (ev.button !== 0) return;
    ev.stopPropagation();
    releaseImplicitCapture(ev);
    const p = sketchCardPos[which];
    sketchCardDrag = { which, sx: p.x, sy: p.y, px: ev.clientX, py: ev.clientY };
  }
  /** Stage-level pointermove. The cards overlay is pointer-events:none over
   *  its empty area (so drawing passes through), so an in-flight wire over the
   *  empty canvas would lose its move events — the STAGE always gets them. One
   *  handler covers both: a card-title drag OR in-flight wire tracking. */
  function sketchStageMove(ev: PointerEvent) {
    if (sketchPanDrag) {
      const d = sketchPanDrag;
      const dx = (ev.clientX - d.px) * d.sx, dy = (ev.clientY - d.py) * d.sy;
      sketchFrame = { minX: d.minX - dx, maxX: d.maxX - dx, minY: d.minY - dy, maxY: d.maxY - dy };
      return;
    }
    if (sketchCardDrag) {
      const d = sketchCardDrag;
      sketchCardPos = { ...sketchCardPos, [d.which]: { x: d.sx + (ev.clientX - d.px), y: d.sy + (ev.clientY - d.py) } };
      return;
    }
    if (wireFrom) { const p = miniEventToCoord(ev); if (p) wireMouse = p; }
  }
  function sketchStageUp(_ev: PointerEvent) {
    if (sketchPanDrag) { sketchPanDrag = null; return; }
    if (sketchCardDrag) { sketchCardDrag = null; return; }
    miniPointerUp();
  }
  /** Param OUTPUT socket centre, ABS in cards-overlay px — tracks the params
   *  card as it drags (mirrors miniParamSock but offset by sketchCardPos). */
  function miniParamSockAbs(i: number) {
    return {
      x: sketchCardPos.params.x + CARD_PAD + PARAM_W + CARD_PAD + 4,
      y: sketchCardPos.params.y + CARD_TITLE_H + CARD_PAD + i * (PARAM_H + PARAM_GAP) + PARAM_H / 2,
    };
  }
  /** S.3: map a sketch (r,z) coord → cards-overlay px so a param→point wire can
   *  be drawn in the overlay (where the PARAMS card lives) but land on the
   *  point as it actually renders in the 2D SVG. Replicates the SVG's
   *  preserveAspectRatio="xMidYMid meet" letterboxing (anchors render with meet,
   *  so the wire must too). Reads sketchFrame (reactive) so it re-evaluates on
   *  Fit and on anchor drags; the SVG pixel size is read live from the DOM. */
  function sketchPtToOverlay(r: number, z: number): { x: number; y: number } | null {
    const f = sketchFrame ?? sketchEditor?.ext;
    if (!f || !sketchSvgEl) return null;
    const rect = sketchSvgEl.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const span = Math.max(f.maxX - f.minX, f.maxY - f.minY) || 1;
    const pad = span * 0.12 + 0.2;
    const minVX = f.minX - pad, minVY = f.minY - pad;
    const vbW = (f.maxX - f.minX) + 2 * pad, vbH = (f.maxY - f.minY) + 2 * pad;
    const scale = Math.min(rect.width / vbW, rect.height / vbH);
    const ox = (rect.width - vbW * scale) / 2;
    const oy = (rect.height - vbH * scale) / 2;
    const sx = rect.left + ox + (r - minVX) * scale;
    const sy = rect.top + oy + (z - minVY) * scale;
    if (!miniSvgEl) return { x: sx, y: sy };
    const orect = miniSvgEl.getBoundingClientRect();
    return { x: sx - orect.left, y: sy - orect.top };
  }

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

  function dropSolid(op: 'revolve' | 'extrude') {
    closePicker();
    // Find an existing polygon, or create one — a revolve / extrude is
    // useless without a profile to operate on. Auto-attached polygons
    // become non-deletable while the revolve consumes them (the × on
    // the polygon card greys out + the title carries a 🔒). User must
    // delete the revolve first to unlock the polygon.
    let polyId: string | undefined =
      (Object.values(graph.nodes).find((n) => (n as any).type === 'polygon') as any)?.id;
    if (!polyId) {
      // Seed the new polygon with a default appropriate to the producer:
      // a small (0..1, 0..1) triangle for revolve (sits on the r ≥ 0 half
      // and reads as a half-section), a unit square centered on (0, 0)
      // for extrude (cartesian cross-section, respects the origin-centered
      // viewport in cartesian SVG preview mode).
      const initial = op === 'extrude' ? POLY_EXTRUDE_DEFAULT : POLY_REVOLVE_DEFAULT;
      const r = addPolygon(graph, initial);
      graph = r.graph;
      polyId = r.id;
    }
    const profileArg = { kind: 'expr' as const, expr: '__POLY__' + polyId };
    if (op === 'revolve') {
      graph = addCall(graph, 'r_revolve', {
        profile: profileArg as any,
        segments: { kind: 'literal', value: 96 } as any,
      }).graph;
    } else {
      // r_weld_extrude actual sig (stdstale/r_weld_extrude.ts meta.params):
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

  // ─── stack/list reorder popover ─────────────────────────────────────────
  // ⚙ button on container cards (stack / list / group / root output) opens
  // a popover showing each child as a row with ▲ / ▼ to reorder. Mutates
  // container.children directly; the visible slots + wires re-derive.
  let containerPop = $state<{ containerId: NodeId; x: number; y: number } | null>(null);
  function openContainerPop(ev: MouseEvent, containerId: NodeId) {
    ev.stopPropagation();
    containerPop = { containerId, x: ev.clientX, y: ev.clientY };
  }
  function closeContainerPop() { containerPop = null; }
  function moveChild(containerId: NodeId, index: number, delta: -1 | 1) {
    const node = graph.nodes[containerId] as any;
    if (!node || !Array.isArray(node.children)) return;
    const newIndex = index + delta;
    if (newIndex < 0 || newIndex >= node.children.length) return;
    const newChildren = [...node.children];
    [newChildren[index], newChildren[newIndex]] = [newChildren[newIndex]!, newChildren[index]!];
    graph = { ...graph, nodes: { ...graph.nodes, [containerId]: { ...node, children: newChildren } } };
  }

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
  /** Drag-wire ending on a Repeat node's count socket — sets the count
   *  to a param (when wireFrom is a param chip). Same pattern as the
   *  Call arg wire targets. */
  function endWireOnRepeatCount(ev: PointerEvent, repeatId: NodeId) {
    if (!wireFrom) return;
    ev.stopPropagation();
    if (wireFrom.kind === 'param-out') {
      graph = setRepeatCount(graph, repeatId, asParam(wireFrom.paramName));
    }
    wireFrom = null; wireMouse = null;
  }
  /** Drag-wire ending on a Repeat node's child slot — set the wire source
   *  as the new child. Idempotent and works for any node type that has an
   *  output socket. */
  function endWireOnRepeatChild(ev: PointerEvent, repeatId: NodeId) {
    if (!wireFrom) return;
    ev.stopPropagation();
    graph = setRepeatChild(graph, repeatId, wireFrom.nodeId);
    wireFrom = null; wireMouse = null;
  }

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

  // ─── multi-source ƒ-expression popup editor ─────────────────────────────
  // When an arg's kind === 'expr' AND the expression references 2+ distinct
  // params, the inline text input is too cramped to author cleanly. The
  // collapsed chip — "ƒ(p.od, p.wall)" — opens this popup with a bigger
  // text area + click-to-insert chips for every declared param. Applied
  // value commits back to the arg via setCallArg(asExpr(...)).
  /** Svelte action — after a fixed-position popover paints, measure it and
   *  shift left/up so the WHOLE thing stays on-screen (the expr popovers
   *  open at the click point and otherwise spill off the bottom/right when
   *  the vertex is near an edge). Re-runs when the bound value changes. */
  function clampToViewport(node: HTMLElement, _dep?: unknown) {
    const margin = 10;
    const fit = () => {
      const r = node.getBoundingClientRect();
      let l = r.left, t = r.top;
      if (r.right > window.innerWidth - margin) l = Math.max(margin, window.innerWidth - r.width - margin);
      if (r.bottom > window.innerHeight - margin) t = Math.max(margin, window.innerHeight - r.height - margin);
      if (l !== r.left) node.style.left = `${l}px`;
      if (t !== r.top) node.style.top = `${t}px`;
    };
    requestAnimationFrame(fit);
    return { update: () => requestAnimationFrame(fit) };
  }
  let argExprPop = $state<{ callId: NodeId; key: string; draft: string; x: number; y: number } | null>(null);
  function openArgExprPop(ev: MouseEvent, callId: NodeId, key: string, currentExpr: string) {
    ev.stopPropagation();
    argExprPop = { callId, key, draft: currentExpr, x: ev.clientX, y: ev.clientY };
  }
  function closeArgExprPop() { argExprPop = null; }
  function applyArgExprPop() {
    if (!argExprPop) return;
    graph = setCallArg(graph, argExprPop.callId, argExprPop.key, asExpr(argExprPop.draft));
    argExprPop = null;
  }

  // ─── Sketch coord expression popover (S.2) ─────────────────────────────
  /** The ƒ button on a sketch-card coord row (r / z / fillet radius /
   *  chamfer dist) opens this. Same UX as the Call-arg argExprPop: edit a JS
   *  expression like `p.od / 2 - p.wall`, apply → the coord becomes
   *  kind:'expr'. Keyed to a sketch op field, written via setSketchOpField. */
  let sketchExprPop = $state<{ sid: NodeId; opIdx: number; field: 'r' | 'z' | 'radius' | 'dist'; draft: string; drafts?: { r: string; z: string }; x: number; y: number } | null>(null);
  function openSketchExprPop(ev: MouseEvent, sid: NodeId, opIdx: number, field: 'r' | 'z' | 'radius' | 'dist', currentExpr: string) {
    ev.stopPropagation();
    // For a point coordinate (line/spline r/z) populate BOTH axis drafts so
    // the popover shows r AND z behind a tab strip — same UX as the polygon
    // vertex editor. fillet radius / chamfer dist are single-value, no tabs.
    let drafts: { r: string; z: string } | undefined;
    if (field === 'r' || field === 'z') {
      const op = (graph.nodes[sid] as any)?.ops?.[opIdx];
      const other: 'r' | 'z' = field === 'r' ? 'z' : 'r';
      drafts = { [field]: currentExpr, [other]: argToDraftStr(op?.[other]) } as { r: string; z: string };
    }
    sketchExprPop = { sid, opIdx, field, draft: currentExpr, drafts, x: ev.clientX, y: ev.clientY };
    sketchDelArmed = false;
  }
  /** Switch the active r/z tab — stash the current draft into the inactive
   *  axis, load the other axis's draft. Pure state; Apply writes both. */
  /** Flip the popover's point between abs and Δ relative, then refresh the
   *  drafts from the (possibly converted) stored coords so the textarea +
   *  tabs show the new values. */
  function toggleSketchExprPopMode() {
    if (!sketchExprPop || !sketchExprPop.drafts) return;
    const op = (graph.nodes[sketchExprPop.sid] as any)?.ops?.[sketchExprPop.opIdx];
    if (!op || (op.op !== 'line' && op.op !== 'spline')) return;
    toggleSketchOpMode(sketchExprPop.sid, sketchExprPop.opIdx, op);
    const op2 = (graph.nodes[sketchExprPop.sid] as any)?.ops?.[sketchExprPop.opIdx];
    if (!op2) return;
    const drafts = { r: argToDraftStr(op2.r), z: argToDraftStr(op2.z) } as { r: string; z: string };
    const field = sketchExprPop.field === 'z' ? 'z' : 'r';
    sketchExprPop = { ...sketchExprPop, drafts, draft: drafts[field] };
  }
  function switchSketchExprAxis(newAxis: 'r' | 'z') {
    if (!sketchExprPop || !sketchExprPop.drafts) return;
    const old = sketchExprPop.field;
    if (old === newAxis) return;
    sketchExprPop = {
      ...sketchExprPop,
      drafts: { ...sketchExprPop.drafts, [old]: sketchExprPop.draft } as { r: string; z: string },
      field: newAxis,
      draft: sketchExprPop.drafts[newAxis],
    };
  }
  // Per-line abs/relative coord toggle. The axis label doubles as the control:
  // click it to flip the op between absolute (r/z) and incremental (Δr/Δz).
  // For LITERAL coords we convert the value (abs↔delta vs the previous vertex)
  // so the point doesn't jump; expr/param coords just flip the flag.
  function toggleSketchOpMode(sid: NodeId, idx: number, op: any) {
    const toRel = op?.mode !== 'rel';
    const se = sketchEditor;
    if (se && op?.r?.kind === 'literal' && op?.z?.kind === 'literal') {
      const ai = se.anchors.findIndex((a) => a.opIdx === idx);
      if (ai > 0) {
        const prev = se.anchors[ai - 1], curAbs = se.anchors[ai]; // anchors are resolved absolutes
        const r = toRel ? +(curAbs.r - prev.r).toFixed(3) : +curAbs.r.toFixed(3);
        const z = toRel ? +(curAbs.z - prev.z).toFixed(3) : +curAbs.z.toFixed(3);
        graph = setSketchOpField(graph, sid, idx, 'r', { kind: 'literal', value: r });
        graph = setSketchOpField(graph, sid, idx, 'z', { kind: 'literal', value: z });
      }
    }
    graph = setSketchOpMode(graph, sid, idx, toRel ? 'rel' : 'abs');
  }
  /** Axis label that reflects the op's coord mode: Δr/Δz when relative,
   *  r/z (or spl r/spl z for splines) when absolute. */
  function sketchAxisLabel(op: any, axis: 'r' | 'z'): string {
    if (op?.mode === 'rel') return axis === 'r' ? 'Δr' : 'Δz';
    return op?.op === 'spline' ? (axis === 'r' ? 'spl r' : 'spl z') : axis;
  }
  // # of point ops in the popover's sketch — guards the delete button (can't
  // remove the only point).
  const sketchPopPtCount = $derived(
    sketchExprPop ? ((graph.nodes[sketchExprPop.sid] as any)?.ops ?? []).filter((o: any) => o.op === 'line' || o.op === 'spline').length : 0
  );
  function closeSketchExprPop() { sketchExprPop = null; sketchDelArmed = false; }
  // Two-step delete confirm (no native dialog — that blocks the extension):
  // first click ARMS the button, second click within the armed state deletes.
  let sketchDelArmed = $state(false);
  function onSketchDeleteClick() {
    if (!sketchDelArmed) { sketchDelArmed = true; return; }
    deleteSketchExprPopPoint();
  }
  /** Delete the point (op) the popover is editing, then close. */
  function deleteSketchExprPopPoint() {
    if (!sketchExprPop) return;
    graph = removeSketchOp(graph, sketchExprPop.sid, sketchExprPop.opIdx);
    sketchExprPop = null;
    sketchDelArmed = false;
  }
  // Drag the point popover by its header (grab the title bar). Mirrors the
  // sketch-toolbar drag — offset-based so the cursor stays where you grabbed.
  let sketchExprPopDrag: { dx: number; dy: number } | null = null;
  function sketchExprPopDown(ev: PointerEvent) {
    if (!sketchExprPop) return;
    ev.preventDefault(); ev.stopPropagation();
    sketchExprPopDrag = { dx: ev.clientX - sketchExprPop.x, dy: ev.clientY - sketchExprPop.y };
    try { (ev.currentTarget as Element).setPointerCapture?.(ev.pointerId); } catch { /* ignore */ }
  }
  function sketchExprPopMove(ev: PointerEvent) {
    if (!sketchExprPopDrag || !sketchExprPop) return;
    sketchExprPop = { ...sketchExprPop, x: ev.clientX - sketchExprPopDrag.dx, y: ev.clientY - sketchExprPopDrag.dy };
  }
  function sketchExprPopUp(ev: PointerEvent) {
    if (!sketchExprPopDrag) return;
    sketchExprPopDrag = null;
    try { (ev.currentTarget as Element).releasePointerCapture?.(ev.pointerId); } catch { /* ignore */ }
  }
  function applySketchExprPop() {
    if (!sketchExprPop) return;
    if (sketchExprPop.drafts) {
      // Dual r/z: fold the active tab's live draft back in, write both axes.
      const drafts = { ...sketchExprPop.drafts, [sketchExprPop.field]: sketchExprPop.draft } as { r: string; z: string };
      graph = setSketchOpField(graph, sketchExprPop.sid, sketchExprPop.opIdx, 'r', asExpr(drafts.r));
      graph = setSketchOpField(graph, sketchExprPop.sid, sketchExprPop.opIdx, 'z', asExpr(drafts.z));
    } else {
      graph = setSketchOpField(graph, sketchExprPop.sid, sketchExprPop.opIdx, sketchExprPop.field, asExpr(sketchExprPop.draft));
    }
    sketchExprPop = null;
  }
  function insertParamIntoSketchDraft(name: string) {
    if (!sketchExprPop) return;
    const ref = `p.${name}`;
    const draft = sketchExprPop.draft;
    const sep = draft.length > 0 && !/\s$/.test(draft) ? ' ' : '';
    sketchExprPop = { ...sketchExprPop, draft: draft + sep + ref };
  }

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
  function argToDraftStr(v: any): string {
    if (!v) return '';
    if (v.kind === 'expr')    return String(v.expr ?? '');
    if (v.kind === 'param')   return `p.${v.param}`;
    if (v.kind === 'literal') return String(v.value ?? 0);
    return '';
  }
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
  // ─── Profile picker popover (#119) ─────────────────────────────────────
  /** Open when the user clicks a profile chip on a Call card. Lists every
   *  curated kind from PROFILE_REGISTRY filtered by the primitive's `set`
   *  (revolve vs cartesian). Selecting a kind rewrites the arg's expr to
   *  a fresh `{kind, params}` JSON descriptor seeded with defaults. */
  let profilePop = $state<{ callId: NodeId; key: string; src: string; set: 'revolve' | 'cartesian'; currentKind: string; x: number; y: number } | null>(null);
  function openProfilePop(ev: MouseEvent, callId: NodeId, key: string, src: string, currentKind: string) {
    ev.stopPropagation();
    const set = expectedProfileSet[src] ?? (src === 'r_revolve' ? 'revolve' : 'cartesian');
    profilePop = { callId, key, src, set, currentKind, x: ev.clientX, y: ev.clientY };
  }
  function closeProfilePop() { profilePop = null; }

  // ─── Node-ref profile (a wired polygon/sketch) — swap / detach ──────────
  // A revolve/extrude `profile` arg wired to a producer carries a
  // `__POLY__<id>` expr. This popover lets the user SWAP it to a different
  // polygon/sketch in the graph or DETACH it entirely (× on the chip).
  let profileRefPop = $state<{ callId: NodeId; key: string; x: number; y: number } | null>(null);
  function openProfileRefPop(ev: MouseEvent, callId: NodeId, key: string) {
    ev.stopPropagation();
    profileRefPop = { callId, key, x: ev.clientX, y: ev.clientY };
  }
  function closeProfileRefPop() { profileRefPop = null; }
  /** All profile-producing nodes (polygon + sketch) — the swap candidates. */
  function profileProducers() {
    return Object.values(graph.nodes).filter((n: any) => n.type === 'polygon' || n.type === 'sketch') as any[];
  }
  function producerLabel(id: NodeId): string {
    const n = graph.nodes[id] as any;
    if (!n) return '(missing)';
    if (n.type === 'sketch') return `sketch`;
    if (n.type === 'polygon') return `polygon · ${(n.points ?? []).length} pts`;
    return n.type;
  }
  function swapProfileRef(callId: NodeId, key: string, nodeId: NodeId) {
    graph = setCallArg(graph, callId, key, asExpr(`__POLY__${nodeId}`));
    profileRefPop = null;
  }
  /** Detach the profile — clears the arg to an empty slot the user re-fills. */
  function detachProfile(callId: NodeId, key: string) {
    graph = setCallArg(graph, callId, key, asExpr(''));
  }
  function selectProfileKind(kindId: string) {
    if (!profilePop) return;
    const def: ProfileDef | undefined = PROFILE_REGISTRY[kindId];
    if (!def) return;
    const desc = { kind: kindId, params: defaultsFor(def) };
    graph = setCallArg(graph, profilePop.callId, profilePop.key, asExpr(JSON.stringify(desc)));
    profilePop = null;
  }
  /** Parse the current expr ArgValue into a `{kind, params}` descriptor.
   *  Returns null when the expr isn't a parseable JSON object (e.g. the
   *  user wrote a custom math expression). The chip renderer falls back
   *  to "expr ƒ" in that case. */
  function parseProfileExpr(expr: string): { kind?: string; params?: Record<string, number> } | null {
    if (!expr || !expr.trim().startsWith('{')) return null;
    try { return JSON.parse(expr); } catch { return null; }
  }
  /** Curated kinds available for a given set, sorted by label. */
  function kindsForSet(set: 'revolve' | 'cartesian'): ProfileDef[] {
    return Object.values(PROFILE_REGISTRY)
      .filter((d) => d.set === set)
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  function insertParamIntoDraft(name: string) {
    if (!argExprPop) return;
    const ref = `p.${name}`;
    const draft = argExprPop.draft;
    // Append with a space if there's existing text + the last char isn't whitespace.
    const sep = draft.length > 0 && !/\s$/.test(draft) ? ' ' : '';
    argExprPop = { ...argExprPop, draft: draft + sep + ref };
  }
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
    graph = autoLayoutGraph(graph, { rowGap: 220, columnGap: 300 });
    // Finish with a PURE push-apart (no params-card obstacle / wires /
    // bounds — those were compressing the clean columns). With the column
    // gaps this is usually a no-op, but it cleanly de-overlaps any residual
    // collision (e.g. many same-depth siblings) without pulling columns in.
    try { applyPushApart({ useBounds: false, useObstacles: false, useWires: false }); }
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
  function applyPushApart(opts: { useBounds?: boolean; useObstacles?: boolean; useWires?: boolean } = {}) {
    const { useBounds = true, useObstacles = true, useWires = true } = opts;
    // The params card is a viewport-fixed obstacle nodes get pushed clear
    // of. PURE mode (auto-layout's pass) skips it + the wires + the bounds —
    // those pull cards toward the viewport/params channel and were
    // COMPRESSING the clean column layout back together. Pure pairwise
    // separation only de-overlaps, never compresses.
    const obstacles: { id: string; x: number; y: number; w: number; h: number }[] = [];
    if (useObstacles) {
      const pcardSize = paramCardSize(paramEntries.length, PARAM_W);
      obstacles.push({
        id: '__obs_params_card',
        x: (CARD_X0 - pan.x) / zoom,
        y: (CARD_Y0 - pan.y) / zoom,
        // socket spills past the card's right edge by ~12 px — pad accordingly
        w: (pcardSize.w + 14) / zoom,
        h: pcardSize.h / zoom,
      });
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
        const est = nodeSize(graph.nodes[id]);
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
        const a = outputSocketAt(srcId);
        const b = inputSocketAt(id, slot);
        out.push({ fromId: srcId, toId: id, ax: a.x, ay: a.y, bx: b.x, by: b.y });
      };
      if (node.type === 'method') {
        if (node.obj) addInputWire(node.obj, 'obj');
        if (node.arg) addInputWire(node.arg, 'arg');
      } else if (node.type === 'mv' || node.type === 'rot' || node.type === 'repeat') {
        if (node.child) addInputWire(node.child, 'child');
      } else if (node.type === 'stack' || node.type === 'group') {
        node.children.forEach((c, i) => {
          if (!graph.nodes[c]) return;
          const a = outputSocketAt(c);
          const b = containerSlotInputAt(id, i);
          out.push({ fromId: c, toId: id, ax: a.x, ay: a.y, bx: b.x, by: b.y });
        });
      } else if (node.type === 'list' && id === graph.root) {
        // Root-list children draw a wire to the Output card's slots.
        node.children.forEach((c, i) => {
          if (!graph.nodes[c]) return;
          const a = outputSocketAt(c);
          const b = containerSlotInputAt(id, i);
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
  /** Inline wrappers should NOT render on the main canvas — their xyz inputs
   *  surface inside their child's Call card instead. */
  function isInlineWrapper(nodeId: NodeId): boolean {
    const n = graph.nodes[nodeId];
    if (!n || (n.type !== 'mv' && n.type !== 'rot')) return false;
    const childId = (n as MvNode | RotNode).child;
    if (!childId) return false;
    const child = graph.nodes[childId];
    return child?.type === 'call' && inlineTransformOf(graph, childId, n.type) === nodeId;
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
      } else if (n.type === 'mv' || n.type === 'rot' || n.type === 'repeat') {
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
  // Display order: the reserved stack-reference param is PINNED first (no
  // trash button); the rest keep insertion order. paramEntries is the single
  // source for both the chip render AND the param-wire `findIndex` lookups, so
  // reordering here keeps every socket index aligned automatically.
  let paramEntries = $derived(
    Object.entries(graph.params).sort(([a], [b]) =>
      a === STACK_REF_PARAM ? -1 : b === STACK_REF_PARAM ? 1 : 0),
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
  <aside class="ge-vrail">
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
      class:on={connectMode}
      onclick={() => { connectMode = !connectMode; if (!connectMode) { wireFrom = null; wireMouse = null; } }}
      data-tip={connectMode
        ? 'Click-to-connect ON — tap a source socket, then a target (Esc cancels)'
        : 'Click-to-connect — wire two sockets by tapping them, no dragging'}>🔗</button>
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

  {#if aiMenuOpen}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="ge-canvas-menu-shade" onclick={() => aiMenuOpen = false}></div>
    <!-- ✨ generate popover — same anchored-dropdown chrome as the ⚙ menu.
         Instructions live here (not inline in the sidebar): describe →
         BM25-retrieve similar parts → Claude proposes a graph → opens in
         a NEW tab; nothing is saved until the user hits Save there. -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="ge-canvas-menu ge-ai-menu"
      bind:this={aiPanelEl}
      onpointerup={persistAiMenuW}
      style="left: {aiMenuPos.left}px; top: {aiMenuPos.top}px; width: {aiMenuW}px">
      <div class="ge-ai-title">✨ Generate a part</div>
      <div class="ge-ai-hint">Describe the part in plain words — e.g.
        <em>flat coil disc, 2 turns, 60 segments</em>. Similar parts are
        retrieved from the RAG corpus and Claude proposes a parametric
        graph, opened in a new tab for review. Nothing touches the volume
        until you Save.</div>
      <!-- svelte-ignore a11y_autofocus -->
      <textarea class="ge-ai-input" rows="3" autofocus
        placeholder="hexagonal prism with a central round bore…"
        bind:value={aiPrompt}
        disabled={aiBusy}
        onkeydown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); generateFromPrompt(); } }}></textarea>
      <div class="ge-ai-actions">
        <button class="ge-ai-go" type="button"
          disabled={aiBusy || !aiPrompt.trim()}
          onclick={generateFromPrompt}>{aiBusy ? 'generating…' : 'Generate'}</button>
        {#if aiError}
          <span class="ge-ai-err" title={aiError}>failed — hover for detail</span>
        {:else if aiCandidates.length > 0}
          <span class="ge-ai-from">from: {aiCandidates.join(' · ')}</span>
        {/if}
      </div>
    </div>
  {/if}

  {#if canvasMenuOpen}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="ge-canvas-menu-shade" onclick={() => canvasMenuOpen = false}></div>
    <!-- Compact Flowbite-style dropdown anchored to the ⚙ button's
         bounding rect (see openCanvasMenu). Two action rows + a separator
         + two checkbox rows for the left/right canvas-edge boundaries.
         The checkbox toggle is BOOLEAN repellant on/off; the small edge
         buttons on the canvas still expose the tri-state (off →
         repellant → confiner) cycle for the rare confiner case. -->
    <div class="ge-canvas-menu"
      style="left: {canvasMenuPos.left}px; top: {canvasMenuPos.top}px">
      <button class="ge-cm-row action" type="button"
        onclick={() => { autoLayout(); canvasMenuOpen = false; }}
        title="Rearrange nodes left-to-right by depth columns (clean by construction)">
        <span class="ge-cm-icon">📐</span>
        <span class="ge-cm-label">Auto-layout</span>
      </button>
      <button class="ge-cm-row action" type="button"
        onclick={() => { pushApart(); canvasMenuOpen = false; }}
        title="Push overlapping cards apart IN PLACE (keeps your manual arrangement; clears the params card + edge bounds below)">
        <span class="ge-cm-icon">🧲</span>
        <span class="ge-cm-label">Push apart</span>
      </button>
      <div class="ge-cm-sep"></div>
      <label class="ge-cm-row check"
        title="Push nodes away from the LEFT canvas edge during push-apart">
        <input type="checkbox"
          checked={boundLeft === 'repellant'}
          onchange={(ev) => {
            const on = (ev.currentTarget as HTMLInputElement).checked;
            boundLeft = on ? 'repellant' : 'off';
            try { localStorage.setItem('ge-bound-left', boundLeft); } catch { /* ignore */ }
          }} />
        <span class="ge-cm-label">Left boundary</span>
      </label>
      <label class="ge-cm-row check"
        title="Push nodes DOWN from the TOP canvas edge during push-apart (keeps cards from drifting off-screen above the PARAMS dock)">
        <input type="checkbox"
          checked={boundTop === 'repellant'}
          onchange={(ev) => {
            const on = (ev.currentTarget as HTMLInputElement).checked;
            boundTop = on ? 'repellant' : 'off';
            try { localStorage.setItem('ge-bound-top', boundTop); } catch { /* ignore */ }
          }} />
        <span class="ge-cm-label">Top boundary</span>
      </label>
      <label class="ge-cm-row check"
        title="Push nodes away from the RIGHT canvas edge during push-apart">
        <input type="checkbox"
          checked={boundRight === 'repellant'}
          onchange={(ev) => {
            const on = (ev.currentTarget as HTMLInputElement).checked;
            boundRight = on ? 'repellant' : 'off';
            try { localStorage.setItem('ge-bound-right', boundRight); } catch { /* ignore */ }
          }} />
        <span class="ge-cm-label">Right boundary</span>
      </label>
    </div>
  {/if}

  <main class="ge-grid" bind:this={gridEl}
    style="grid-template-columns: {splitA}% 6px 1fr">
    <!-- LEFT — graph canvas -->
    <section class="ge-canvas-pane">
      {#if wireFrom && tapConnect}
        <div class="ge-connect-hint">🔗 Tap a target socket to connect · <kbd>Esc</kbd> to cancel</div>
      {/if}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <svg
        bind:this={canvasEl}
        class="ge-canvas"
        class:dragging={!!dragging || !!wireFrom}
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
                  {#if pIdx >= 0}
                    {@const ps = paramSocketPos((v as any).param, pIdx)}
                    {@const pos = nodePos(n.id)}
                    {@const argY = pos.y + 36 + 14 + argIdx * 22}
                    <path class="ge-wire param" d={bezier(ps.x, ps.y, pos.x, argY)}/>
                  {/if}
                {:else if (v as any).kind === 'expr'}
                  <!-- Expression arg — draw a wire from EACH referenced
                       p.<name> chip to this slot. Multi-source = visually
                       obvious; styled .expr to distinguish from direct
                       param wires (amber dashed vs orange dashed). -->
                  {#each extractParamRefs((v as any).expr) as refName (refName)}
                    {@const pIdx = paramEntries.findIndex(([nm]) => nm === refName)}
                    {#if pIdx >= 0}
                      {@const ps = paramSocketPos(refName, pIdx)}
                      {@const pos = nodePos(n.id)}
                      {@const argY = pos.y + 36 + 14 + argIdx * 22}
                      <path class="ge-wire param expr" d={bezier(ps.x, ps.y, pos.x, argY)}/>
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
                    {@const srcSize = nodeSize(graph.nodes[sourceId])}
                    {@const srcPos = nodePos(sourceId)}
                    {@const pos = nodePos(n.id)}
                    {@const argY = pos.y + 36 + 14 + argIdx * 22}
                    <path class="ge-wire noderef"
                      d={bezier(srcPos.x + srcSize.w, srcPos.y + srcSize.h / 2, pos.x, argY)}/>
                  {/if}
                {/if}
              {/each}
              <!-- Inline transform axis wires (mv/rot wrapping this Call) -->
              {@const cSize = nodeSize(n)}
              {@const inlMv  = inlineTransformOf(graph, n.id, 'mv')}
              {@const inlRot = inlineTransformOf(graph, n.id, 'rot')}
              {#if inlMv}
                {@const mvN = graph.nodes[inlMv] as MvNode}
                {#each [0,1,2] as i (i)}
                  {#if (mvN.offset[i] as any).kind === 'param'}
                    {@const pIdx = paramEntries.findIndex(([nm]) => nm === (mvN.offset[i] as any).param)}
                    {#if pIdx >= 0}
                      {@const ps = paramSocketPos((mvN.offset[i] as any).param, pIdx)}
                      {@const pos = nodePos(n.id)}
                      {@const axisY = pos.y + cSize.h + 4 + 18 + i * 18}
                      <path class="ge-wire param" d={bezier(ps.x, ps.y, pos.x, axisY)}/>
                    {/if}
                  {:else if (mvN.offset[i] as any).kind === 'expr'}
                    {#each extractParamRefs((mvN.offset[i] as any).expr) as refName (refName)}
                      {@const pIdx = paramEntries.findIndex(([nm]) => nm === refName)}
                      {#if pIdx >= 0}
                        {@const ps = paramSocketPos(refName, pIdx)}
                        {@const pos = nodePos(n.id)}
                        {@const axisY = pos.y + cSize.h + 4 + 18 + i * 18}
                        <path class="ge-wire param expr" d={bezier(ps.x, ps.y, pos.x, axisY)}/>
                      {/if}
                    {/each}
                  {/if}
                {/each}
              {/if}
              {#if inlRot}
                {@const rotN = graph.nodes[inlRot] as RotNode}
                {#each [0,1,2] as i (i)}
                  {#if (rotN.rot[i] as any).kind === 'param'}
                    {@const pIdx = paramEntries.findIndex(([nm]) => nm === (rotN.rot[i] as any).param)}
                    {#if pIdx >= 0}
                      {@const ps = paramSocketPos((rotN.rot[i] as any).param, pIdx)}
                      {@const pos = nodePos(n.id)}
                      {@const rotY = pos.y + cSize.h + 4 + (inlMv ? 80 : 0) + 18 + i * 18}
                      <path class="ge-wire param" d={bezier(ps.x, ps.y, pos.x, rotY)}/>
                    {/if}
                  {:else if (rotN.rot[i] as any).kind === 'expr'}
                    {#each extractParamRefs((rotN.rot[i] as any).expr) as refName (refName)}
                      {@const pIdx = paramEntries.findIndex(([nm]) => nm === refName)}
                      {#if pIdx >= 0}
                        {@const ps = paramSocketPos(refName, pIdx)}
                        {@const pos = nodePos(n.id)}
                        {@const rotY = pos.y + cSize.h + 4 + (inlMv ? 80 : 0) + 18 + i * 18}
                        <path class="ge-wire param expr" d={bezier(ps.x, ps.y, pos.x, rotY)}/>
                      {/if}
                    {/each}
                  {/if}
                {/each}
              {/if}
            {:else if n.type === 'repeat'}
              <!-- Repeat count param-wire — chip → top-left count socket -->
              {#if (n as any).count?.kind === 'param'}
                {@const pIdx = paramEntries.findIndex(([nm]) => nm === (n as any).count.param)}
                {#if pIdx >= 0}
                  {@const ps = paramSocketPos((n as any).count.param, pIdx)}
                  {@const pos = nodePos(n.id)}
                  <path class="ge-wire param" d={bezier(ps.x, ps.y, pos.x, pos.y + 17)}/>
                {/if}
              {:else if (n as any).count?.kind === 'expr'}
                {#each extractParamRefs((n as any).count.expr) as refName (refName)}
                  {@const pIdx = paramEntries.findIndex(([nm]) => nm === refName)}
                  {#if pIdx >= 0}
                    {@const ps = paramSocketPos(refName, pIdx)}
                    {@const pos = nodePos(n.id)}
                    <path class="ge-wire param expr" d={bezier(ps.x, ps.y, pos.x, pos.y + 17)}/>
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
                  {#if pIdx >= 0}
                    {@const ps = paramSocketPos(pt.r.param, pIdx)}
                    <path class="ge-wire param" d={bezier(ps.x, ps.y, pos.x, rTopY)}/>
                  {/if}
                {:else if pt.r?.kind === 'expr'}
                  {#each extractParamRefs(pt.r.expr) as refName (refName)}
                    {@const pIdx = paramEntries.findIndex(([nm]) => nm === refName)}
                    {#if pIdx >= 0}
                      {@const ps = paramSocketPos(refName, pIdx)}
                      <path class="ge-wire param expr" d={bezier(ps.x, ps.y, pos.x, rTopY)}/>
                    {/if}
                  {/each}
                {/if}
                {#if pt.z?.kind === 'param'}
                  {@const pIdx = paramEntries.findIndex(([nm]) => nm === pt.z.param)}
                  {#if pIdx >= 0}
                    {@const ps = paramSocketPos(pt.z.param, pIdx)}
                    <path class="ge-wire param" d={bezier(ps.x, ps.y, pos.x, zTopY)}/>
                  {/if}
                {:else if pt.z?.kind === 'expr'}
                  {#each extractParamRefs(pt.z.expr) as refName (refName)}
                    {@const pIdx = paramEntries.findIndex(([nm]) => nm === refName)}
                    {#if pIdx >= 0}
                      {@const ps = paramSocketPos(refName, pIdx)}
                      <path class="ge-wire param expr" d={bezier(ps.x, ps.y, pos.x, zTopY)}/>
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
                    {@const srcSize = nodeSize(src as any)}
                    {@const srcX = srcXY.x + srcSize.w}
                    {@const srcY = srcXY.y + srcSize.h / 2}
                    {@const tgtX = pos.x}
                    {@const tgtY = pos.y + polySockRef(n, idx)}
                    <path class="ge-wire poly-rref" d={bezier(srcX, srcY, tgtX, tgtY)} fill="none"/>
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
                    {#if pIdx >= 0}
                      {@const ps = paramSocketPos(av.param, pIdx)}
                      <path class="ge-wire param" d={bezier(ps.x, ps.y, pos.x, pos.y + (sy as number))}/>
                    {/if}
                  {:else if av?.kind === 'expr'}
                    {#each extractParamRefs(av.expr) as refName (refName)}
                      {@const pIdx = paramEntries.findIndex(([nm]) => nm === refName)}
                      {#if pIdx >= 0}
                        {@const ps = paramSocketPos(refName, pIdx)}
                        <path class="ge-wire param expr" d={bezier(ps.x, ps.y, pos.x, pos.y + (sy as number))}/>
                      {/if}
                    {/each}
                  {/if}
                {/each}
              {/each}
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
                {#if pIdx >= 0}
                  {@const ps = paramSocketPos((n as any).count.param, pIdx)}
                  <path class="ge-wire param" d={bezier(ps.x, ps.y, tgtX, tgtY)}/>
                {/if}
              {:else if (n as any).count?.kind === 'expr'}
                {#each extractParamRefs((n as any).count.expr) as refName (refName)}
                  {@const pIdx = paramEntries.findIndex(([nm]) => nm === refName)}
                  {#if pIdx >= 0}
                    {@const ps = paramSocketPos(refName, pIdx)}
                    <path class="ge-wire param expr" d={bezier(ps.x, ps.y, tgtX, tgtY)}/>
                  {/if}
                {/each}
              {/if}
            {/if}
          {/each}

          <!-- WIRES: render method.obj/arg + transform.child as bezier paths. -->
          {#each allNodes as n (n.id)}
            {#if n.type === 'method'}
              {#if (n as any).obj && graph.nodes[(n as any).obj]}
                {@const src = outputSocketAt((n as any).obj)}
                {@const tgt = inputSocketAt(n.id, 'obj')}
                <path class="ge-wire obj" d={bezier(src.x, src.y, tgt.x, tgt.y)} fill="none"/>
              {/if}
              {#if (n as any).arg && graph.nodes[(n as any).arg]}
                {@const src = outputSocketAt((n as any).arg)}
                {@const tgt = inputSocketAt(n.id, 'arg')}
                <path class="ge-wire arg" d={bezier(src.x, src.y, tgt.x, tgt.y)} fill="none"/>
              {/if}
            {:else if n.type === 'mv' || n.type === 'rot'}
              {#if (n as any).child && graph.nodes[(n as any).child]}
                {@const src = outputSocketAt((n as any).child)}
                {@const tgt = inputSocketAt(n.id, 'child')}
                <path class="ge-wire child" d={bezier(src.x, src.y, tgt.x, tgt.y)} fill="none"/>
              {/if}
            {:else if n.type === 'repeat'}
              <!-- Repeat node's child wire — bottom-left input socket -->
              {#if (n as any).child && graph.nodes[(n as any).child]}
                {@const src = outputSocketAt((n as any).child)}
                {@const pos = nodePos(n.id)}
                {@const size = nodeSize(n)}
                <path class="ge-wire child" d={bezier(src.x, src.y, pos.x, pos.y + size.h - 18)} fill="none"/>
              {/if}
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
                  {@const src = outputSocketAt(childId)}
                  {@const tgt = containerSlotInputAt(n.id, i)}
                  <path class="ge-wire output" class:root={n.id === graph.root}
                    d={bezier(src.x, src.y, tgt.x, tgt.y)} fill="none"/>
                {/if}
              {/each}
            {/if}
          {/each}

          <!-- In-flight wire being dragged -->
          {#if wireFrom && wireMouse}
            {@const src = outputSocketAt(wireFrom.nodeId)}
            <path class="ge-wire in-flight" d={bezier(src.x, src.y, wireMouse.x, wireMouse.y)} fill="none"/>
          {/if}

          <!-- NODE CARDS -->
          {#each allNodes as n (n.id)}
            {@const pos = nodePos(n.id)}
            {@const size = nodeSize(n)}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <g transform="translate({pos.x},{pos.y})" class="ge-node"
              data-node-id={n.id}
              role="group"
              onpointerdown={() => bringToFront(n.id)}>
              {#if n.type === 'call'}
                {@const call = n as any}
                {@const inlineMv  = inlineTransformOf(graph, n.id, 'mv')}
                {@const inlineRot = inlineTransformOf(graph, n.id, 'rot')}
                {@const mvNode    = inlineMv  ? (graph.nodes[inlineMv]  as MvNode)  : null}
                {@const rotNode   = inlineRot ? (graph.nodes[inlineRot] as RotNode) : null}
                {@const cardH     = size.h + (inlineMv ? 80 : 0) + (inlineRot ? 80 : 0)}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <rect role="button" tabindex="-1" class="ge-node-bg call" width={size.w} height={cardH} rx="6"
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
                    role={props.onOpenTab ? 'link' : null}
                    data-tip={props.onOpenTab ? 'Open this part in a new tab' : null}
                    onclick={(ev) => {
                      if (!props.onOpenTab) return;
                      ev.stopPropagation();
                      props.onOpenTab(call.src);
                    }}>{call.src}</tspan>
                </text>
                <!-- Drift badge (Phase 11) — when the underlying primitive's params
                     differ from this Call's args keys, surface ⚠ + a Refresh
                     pointerdown handler that brings the Call back into sync. -->
                {#if isCallDrifted(n.id)}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <text role="button" tabindex="-1" x={size.w - 96} y="22"
                    class="ge-drift-btn"
                    onpointerdown={(ev) => { ev.stopPropagation(); refreshCallArgs(n.id); }}>⚠</text>
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
                  onpointerdown={(ev) => { ev.stopPropagation(); deleteNode(n.id); }}>×</text>
                <line x1="0" y1="32" x2={size.w} y2="32" class="ge-node-divider"/>
                <foreignObject x="6" y="36" width={size.w - 12} height={size.h - 40} class="ge-fo">
                  <div class="ge-args" xmlns="http://www.w3.org/1999/xhtml">
                    {#each Object.entries(call.args ?? {}) as [k, v] (k)}
                      <!-- Unified row: [key_label][value_body][trailing_actions]
                           The value_body shows the literal input, the wired
                           param chip body (label-only), or the expression input.
                           The trailing_actions cell always pins ƒ + × to the
                           right edge so every row's controls land at the
                           same spot. -->
                      <div class="ge-arg-row">
                        <button class="ge-arg-key wire-btn" type="button" title="Wire to outer param"
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
                                onclick={(ev) => openArgExprPop(ev, n.id, k, String((v as any).value ?? 0))}>ƒ</button>
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
                                onclick={(ev) => openArgExprPop(ev, n.id, k, 'p.' + (v as any).param)}>ƒ</button>
                              <button class="ge-arg-action x" type="button"
                                title="Unwire — back to literal"
                                onclick={() => unwireArgToLiteral(n.id, k)}>×</button>
                            </span>
                          </span>
                        {:else}
                          {@const expr = (v as any).expr ?? ''}
                          {@const refs = extractParamRefs(expr)}
                          {@const isProfileSlot = !!expectedProfileKeys[call.src]?.has(k)}
                          {@const polyM = String(expr).match(/^__POLY__(n_[a-z0-9]+)$/i)}
                          {@const profileDesc = isProfileSlot ? parseProfileExpr(expr) : null}
                          {#if isProfileSlot && polyM && graph.nodes[polyM[1]]}
                            <!-- NODE-REF profile: wired to a polygon/sketch.
                                 ▾ swaps to a different producer; × detaches. -->
                            <span class="ge-arg-cell">
                              <!-- svelte-ignore a11y_click_events_have_key_events -->
                              <span class="ge-arg-profilechip noderef" role="button" tabindex="-1"
                                title="Click to swap to a different profile"
                                onclick={(ev) => openProfileRefPop(ev, n.id, k)}>
                                <span class="ge-arg-profilechip-kind">▢ {producerLabel(polyM[1])} ▾</span>
                              </span>
                              <span class="ge-arg-actions">
                                <button class="ge-arg-action edit" type="button" title="Detach this profile"
                                  onclick={() => detachProfile(n.id, k)}>×</button>
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
                                onclick={(ev) => openProfilePop(ev, n.id, k, call.src, profileDesc.kind ?? '')}>
                                <span class="ge-arg-profilechip-kind">▾ {kindDef?.label ?? profileDesc.kind}</span>
                              </span>
                              <span class="ge-arg-actions">
                                <button class="ge-arg-action edit" type="button" title="Swap to a polygon/sketch profile"
                                  onclick={(ev) => openProfileRefPop(ev, n.id, k)}>▢</button>
                                <button class="ge-arg-action edit" type="button" title="Edit raw JSON descriptor"
                                  onclick={(ev) => openArgExprPop(ev, n.id, k, expr)}>✎</button>
                              </span>
                            </span>
                          {:else if isProfileSlot && (!expr || expr.trim() === '')}
                            <!-- EMPTY profile slot — detached / never wired.
                                 Pick a producer (or a built-in kind) to fill it. -->
                            <span class="ge-arg-cell">
                              <!-- svelte-ignore a11y_click_events_have_key_events -->
                              <span class="ge-arg-profilechip empty" role="button" tabindex="-1"
                                title="Pick a profile for this revolve/extrude"
                                onclick={(ev) => openProfileRefPop(ev, n.id, k)}>
                                <span class="ge-arg-profilechip-kind">▢ pick a profile ▾</span>
                              </span>
                            </span>
                          {:else if refs.length >= 2}
                            <!-- Multi-source ƒ chip — too dense for inline editing; click to open popup. -->
                            <span class="ge-arg-cell">
                              <!-- svelte-ignore a11y_click_events_have_key_events -->
                              <span class="ge-arg-fnchip" role="button" tabindex="-1"
                                title={`Click to edit · expression: ${expr}`}
                                onclick={(ev) => openArgExprPop(ev, n.id, k, expr)}>
                                ƒ(<span class="ge-arg-fnchip-refs">{refs.map((r) => 'p.' + r).join(', ')}</span>) ✎
                              </span>
                              <span class="ge-arg-actions">
                                <button class="ge-arg-action fx on" type="button" title="Edit expression"
                                  onclick={(ev) => openArgExprPop(ev, n.id, k, expr)}>ƒ</button>
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
                                  onclick={(ev) => openArgExprPop(ev, n.id, k, expr)}>ƒ</button>
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
                {#if mvNode}
                  <foreignObject x="6" y={size.h + 4} width={size.w - 12} height="72">
                    <div class="ge-inline-xform mv" xmlns="http://www.w3.org/1999/xhtml">
                      <div class="ge-inline-label">⇄ mv</div>
                      {#each ['x','y','z'] as axis, i (axis)}
                        {@const av = mvNode.offset[i] as any}
                        <div class="ge-arg-row tight">
                          <span class="ge-arg-key">{axis}</span>
                          {#if av.kind === 'param'}
                            <span class="ge-arg-pchip" title="Wired to param">
                              p.{av.param}
                              <button class="ge-arg-pchip-x" type="button"
                                onclick={() => unwireTransformAxis(inlineMv!, i as 0|1|2)}>×</button>
                            </span>
                          {:else}
                            <input class="ge-arg-input" type="number" step="0.5"
                              value={av.kind === 'literal' ? av.value : 0}
                              use:dragNumber={{
                                step: 0.5,
                                get: () => Number(av.value ?? 0),
                                set: (val) => onTransformAxis(inlineMv!, i as 0|1|2, val),
                              }}
                              oninput={(e) => onTransformAxis(inlineMv!, i as 0|1|2, Number((e.target as HTMLInputElement).value))}
                            />
                          {/if}
                        </div>
                      {/each}
                    </div>
                  </foreignObject>
                  <!-- Per-axis input sockets on the LEFT edge — drag a param chip
                       output socket onto one to wire that axis. -->
                  {#each [0,1,2] as i (i)}
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <circle role="button" tabindex="-1" class="ge-sock in param tiny"
                      cx="0" cy={size.h + 4 + 18 + i * 18} r="4"
                      onpointerup={(ev) => endWireOnTransformAxis(ev, inlineMv!, i as 0|1|2)}/>
                  {/each}
                {/if}
                {#if rotNode}
                  {@const rotY = size.h + 4 + (inlineMv ? 80 : 0)}
                  <foreignObject x="6" y={rotY} width={size.w - 12} height="72">
                    <div class="ge-inline-xform rot" xmlns="http://www.w3.org/1999/xhtml">
                      <div class="ge-inline-label">↻ rot</div>
                      {#each ['rx','ry','rz'] as axis, i (axis)}
                        {@const av = rotNode.rot[i] as any}
                        <div class="ge-arg-row tight">
                          <span class="ge-arg-key">{axis}</span>
                          {#if av.kind === 'param'}
                            <span class="ge-arg-pchip" title="Wired to param">
                              p.{av.param}
                              <button class="ge-arg-pchip-x" type="button"
                                onclick={() => unwireTransformAxis(inlineRot!, i as 0|1|2)}>×</button>
                            </span>
                          {:else}
                            <input class="ge-arg-input" type="number" step="1"
                              value={av.kind === 'literal' ? av.value : 0}
                              use:dragNumber={{
                                step: 1,
                                get: () => Number(av.value ?? 0),
                                set: (val) => onTransformAxis(inlineRot!, i as 0|1|2, val),
                              }}
                              oninput={(e) => onTransformAxis(inlineRot!, i as 0|1|2, Number((e.target as HTMLInputElement).value))}
                            />
                          {/if}
                        </div>
                      {/each}
                    </div>
                  </foreignObject>
                  {#each [0,1,2] as i (i)}
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <circle role="button" tabindex="-1" class="ge-sock in param tiny"
                      cx="0" cy={rotY + 18 + i * 18} r="4"
                      onpointerup={(ev) => endWireOnTransformAxis(ev, inlineRot!, i as 0|1|2)}/>
                  {/each}
                {/if}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <!-- Output: if a Call has an inline mv/rot wrapper, the visible
                     output is the WRAPPER's output (the transformed result), so
                     wires from this socket originate from the wrapper id. Without
                     this, downstream methods would bypass the inline transform —
                     emit would be `A.subtract(B)` instead of `mv(A,...).subtract(B)`. -->
                <circle role="button" tabindex="-1" class="ge-sock out" cx={size.w} cy={cardH / 2} r="6"
                  onpointerdown={(ev) => startWire(ev, inlineRot ?? inlineMv ?? n.id)}/>
                <!-- Per-arg input sockets on the left edge of the Call card.
                     Drag a param chip's output socket onto one to wire. -->
                {#each Object.keys(call.args ?? {}) as ak, ai (ak)}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <circle role="button" tabindex="-1" class="ge-sock in param"
                    cx="0" cy={36 + 14 + ai * 22} r="5"
                    onpointerup={(ev) => endWireOnCallArg(ev, n.id, ak)}/>
                {/each}

              {:else if n.type === 'method'}
                {@const m = n as any}
                <!-- Compact title-row layout (matches mv/rot): op glyph +
                     name in the title at top, obj/arg sockets on the left
                     below, output on the title-row right edge. -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <rect role="button" tabindex="-1" class="ge-node-bg method" width={size.w} height={size.h} rx="6"
                  onpointerdown={(ev) => onNodePointerDown(ev, n.id)}
                  onpointermove={onNodePointerMove}
                  onpointerup={onNodePointerUp}
                />
                <text x="14" y="20" class="ge-node-title">
                  {m.op === 'subtract' ? '⊖' : m.op === 'add' ? '⊕' : '⊗'} {m.op}
                </text>
                <line x1="0" y1="28" x2={size.w} y2="28" class="ge-node-divider"/>
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <text role="button" tabindex="-1" x={size.w - 22} y="20" class="ge-node-x"
                  onpointerdown={(ev) => { ev.stopPropagation(); deleteNode(n.id); }}>×</text>
                <!-- Input sockets, stacked under the divider -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle role="button" tabindex="-1" class="ge-sock in obj" cx="0" cy="42" r="6"
                  onpointerup={(ev) => endWireOnInput(ev, n.id, 'obj')}/>
                <text x="10" y="45" class="ge-sock-label">obj</text>
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle role="button" tabindex="-1" class="ge-sock in arg" cx="0" cy="56" r="6"
                  onpointerup={(ev) => endWireOnInput(ev, n.id, 'arg')}/>
                <text x="10" y="59" class="ge-sock-label">arg</text>
                <!-- OUTPUT socket on the title-row right edge -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle role="button" tabindex="-1" class="ge-sock out" cx={size.w} cy="14" r="6"
                  onpointerdown={(ev) => startWire(ev, n.id)}/>

              {:else if n.type === 'mv' || n.type === 'rot'}
                {@const t = n as any}
                {@const fieldName = n.type === 'mv' ? 'offset' : 'rot'}
                {@const axisRowH = 24}
                {@const axisStartY = 40}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <rect role="button" tabindex="-1" class="ge-node-bg transform" class:rot={n.type === 'rot'}
                  width={size.w} height={size.h} rx="6"
                  onpointerdown={(ev) => onNodePointerDown(ev, n.id)}
                  onpointermove={onNodePointerMove}
                  onpointerup={onNodePointerUp}
                />
                <text x="14" y="22" class="ge-node-title">
                  {n.type === 'mv' ? '⇄ mv' : '↻ rot'}
                </text>
                <line x1="0" y1="32" x2={size.w} y2="32" class="ge-node-divider"/>
                <!-- CHILD socket on the LEFT EDGE, vertically aligned with
                     the title row. Implicit — no label since the position
                     itself communicates "shape comes in here". Sits at the
                     top of the same left-edge column as the axis sockets.
                     inputSocketAt('child') reports this point so existing
                     wires draw correctly. -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle role="button" tabindex="-1" class="ge-sock in child" cx="0" cy="16" r="6"
                  onpointerup={(ev) => endWireOnInput(ev, n.id, 'child')}/>
                <!-- Each axis row: edge socket + label + input + × — same
                     column model as the params card so wiring is obvious
                     + the right edge stays consistent. -->
                <foreignObject x="14" y={axisStartY - 4} width={size.w - 18} height={3 * axisRowH + 6}>
                  <div class="ge-xyz" xmlns="http://www.w3.org/1999/xhtml">
                    {#each ['x','y','z'] as axisLabel, i (axisLabel)}
                      {@const axis = (t as any)[fieldName][i]}
                      <div class="ge-arg-row">
                        <span class="ge-arg-key axis">{n.type === 'mv' ? '' : 'r'}{axisLabel}</span>
                        {#if axis.kind === 'param'}
                          <!-- Wired param. ƒ opens the shared expression
                               popover (consistent with polygon/loop ƒ
                               buttons, 2026-06-11) prefilled with `p.<name>`
                               so the user can compose like `p.od / 2`. × unwires
                               back to literal 0. -->
                          <span class="ge-arg-cell wired">
                            <span class="ge-arg-pchip" title="Wired to param">p.{axis.param}</span>
                            <span class="ge-arg-actions">
                              <button class="ge-arg-action fx" type="button"
                                title="Edit expression (e.g. p.wall / 2)"
                                onclick={(ev) => openTransformAxisExprPop(ev as any, n.id, i as 0|1|2)}>ƒ</button>
                              <button class="ge-arg-action x" type="button" title="Unwire — back to literal"
                                onclick={() => onTransformAxis(n.id, i as 0|1|2, 0)}>×</button>
                            </span>
                          </span>
                        {:else if axis.kind === 'expr'}
                          <!-- Expression mode — inline text input PLUS ƒ
                               opens the popover for chip-assisted editing
                               (same as polygon/loop). -->
                          <span class="ge-arg-cell">
                            <input class="ge-arg-input expr" type="text"
                              placeholder="e.g. p.od / 2"
                              value={axis.expr}
                              oninput={(e) => onTransformAxisExprEdit(n.id, i as 0|1|2, (e.target as HTMLInputElement).value)}
                            />
                            <span class="ge-arg-actions">
                              <button class="ge-arg-action fx on" type="button"
                                title="Edit expression in popover"
                                onclick={(ev) => openTransformAxisExprPop(ev as any, n.id, i as 0|1|2)}>ƒ</button>
                            </span>
                          </span>
                        {:else}
                          <span class="ge-arg-cell">
                            <input class="ge-arg-input" type="number" step={n.type === 'mv' ? 0.5 : 1}
                              value={axis.value}
                              use:dragNumber={{
                                step: n.type === 'mv' ? 0.5 : 1,
                                get: () => Number(axis.value ?? 0),
                                set: (val) => onTransformAxis(n.id, i as 0|1|2, val),
                              }}
                              oninput={(e) => onTransformAxis(n.id, i as 0|1|2, Number((e.target as HTMLInputElement).value))}
                            />
                            <span class="ge-arg-actions">
                              <button class="ge-arg-action fx" type="button"
                                title="Write an expression"
                                onclick={(ev) => openTransformAxisExprPop(ev as any, n.id, i as 0|1|2)}>ƒ</button>
                            </span>
                          </span>
                        {/if}
                      </div>
                    {/each}
                  </div>
                </foreignObject>
                <!-- Per-axis input sockets — ON the left edge (cx=0). Drag a
                     param chip onto one and the axis becomes wired (via
                     endWireOnTransformAxis). -->
                {#each [0, 1, 2] as i}
                  {@const cy = axisStartY + i * axisRowH + axisRowH / 2 - 4}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <circle role="button" tabindex="-1" class="ge-sock in param tiny" cx="0" cy={cy} r="4"
                    onpointerup={(ev) => endWireOnTransformAxis(ev, n.id, i as 0|1|2)}/>
                {/each}
                <!-- × delete — moved further from the right edge so it
                     doesn't crowd the title-row output socket. -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <text role="button" tabindex="-1" x={size.w - 22} y="22" class="ge-node-x"
                  onpointerdown={(ev) => { ev.stopPropagation(); deleteNode(n.id); }}>×</text>
                <!-- OUTPUT socket on the title-row RIGHT EDGE (y=16) —
                     same vertical line as the child input on the left. -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle role="button" tabindex="-1" class="ge-sock out" cx={size.w} cy="16" r="6"
                  onpointerdown={(ev) => startWire(ev, n.id)}/>

              {:else if n.type === 'repeat'}
                {@const rep = n as any}
                {@const countKind = rep.count?.kind ?? 'literal'}
                {@const countLiteral = countKind === 'literal' ? Number(rep.count.value) : 1}
                {@const countDisplay = countKind === 'param' ? `p.${rep.count.param}`
                  : countKind === 'expr' ? rep.count.expr
                  : String(countLiteral)}
                {@const repOp = (rep.op ?? 'stack') as 'stack' | 'list' | 'place'}
                {@const childNode = rep.child ? graph.nodes[rep.child] : null}
                {@const childLabel = !childNode ? '(drop a node into the child socket)'
                  : childNode.type === 'call' ? `${childNode.alias} · ${childNode.src}`
                  : childNode.type === 'method' ? `${childNode.op}(…)`
                  : childNode.type === 'repeat' ? `repeat × ${childNode.count?.kind === 'literal' ? childNode.count.value : '…'}`
                  : childNode.type}
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
                  onpointerup={(ev) => endWireOnRepeatCount(ev, n.id)}/>
                {#if countKind === 'literal'}
                  <foreignObject x="92" y="6" width="56" height="22">
                    <input class="ge-repeat-count-inline" type="number" min="1" step="1"
                      xmlns="http://www.w3.org/1999/xhtml"
                      value={countLiteral}
                      use:dragNumber={{
                        step: 1,
                        get: () => countLiteral,
                        set: (val) => { graph = setRepeatCount(graph, n.id, asLiteral(Math.max(1, Math.round(val)))); },
                      }}
                      oninput={(e) => { graph = setRepeatCount(graph, n.id, asLiteral(Math.max(1, Math.round(Number((e.target as HTMLInputElement).value))))); }}/>
                  </foreignObject>
                {:else}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <text role="button" tabindex="-1" x="92" y="22"
                    class="ge-repeat-count-chip" class:param={countKind === 'param'} class:expr={countKind === 'expr'}
                    title={countKind === 'param' ? `Wired to param — click × on the chip to unwire` : `Expression — edit below`}
                    onpointerdown={(ev) => ev.stopPropagation()}>{countDisplay}</text>
                  {#if countKind === 'param'}
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <text role="button" tabindex="-1" x="92" y="22" dx={countDisplay.length * 7 + 4}
                      class="ge-repeat-count-x"
                      onpointerdown={(ev) => { ev.stopPropagation(); graph = setRepeatCount(graph, n.id, asLiteral(graph.params[rep.count.param]?.default ?? 1)); }}>×</text>
                  {/if}
                {/if}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <text role="button" tabindex="-1" x={size.w - 14} y="22" class="ge-node-x"
                  onpointerdown={(ev) => { ev.stopPropagation(); deleteNode(n.id); }}>×</text>
                <line x1="0" y1="32" x2={size.w} y2="32" class="ge-node-divider"/>
                <!-- Repeat is a pure BUILDER — produces a list of N copies of
                     its child. To combine the list (mate, stack, overlap),
                     wire the output into a Stack / other consumer. Source
                     emit defaults to a bare Array.from(...). Legacy parts
                     without an `op` field still emit stack(Array.from(...))
                     for backward compat. -->
                <text x={size.w / 2} y="56" class="ge-repeat-sub" text-anchor="middle">
                  builds a list of {countDisplay} ×
                </text>
                <text x={size.w / 2} y="78" class="ge-repeat-child" text-anchor="middle">
                  {childLabel}
                </text>
                <!-- Child input socket — drop any node's output here to repeat it. -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle role="button" tabindex="-1" class="ge-sock in child" cx="0" cy={size.h - 18} r="6"
                  onpointerup={(ev) => endWireOnRepeatChild(ev, n.id)}/>
                <text x="10" y={size.h - 14} class="ge-sock-label">child</text>
                <!-- Output -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle role="button" tabindex="-1" class="ge-sock out" cx={size.w} cy={size.h / 2} r="6"
                  onpointerdown={(ev) => startWire(ev, n.id)}/>

              {:else if n.type === 'list' || n.type === 'stack' || n.type === 'group'}
                {@const isRoot = n.id === graph.root}
                {@const container = n as any}
                {@const title = isRoot ? '▶ Output' : n.type === 'stack' ? '↕ Stack' : n.type === 'group' ? '{} Group' : '[ ] List'}
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
                  onpointerdown={(ev) => openContainerPop(ev, n.id)}>⚙</text>
                {#if !isRoot}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <text role="button" tabindex="-1" x={size.w - 14} y="22" class="ge-node-x"
                    onpointerdown={(ev) => { ev.stopPropagation(); deleteNode(n.id); }}>×</text>
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
                    onpointerup={(ev) => endWireOnContainerSlot(ev, n.id)}/>
                  <text x="10" y={containerSlotY(i) + 4} class="ge-sock-label">{childLabel}</text>
                  <!-- ▲▼ reorder this part up / down in the stack. The slots
                       (and the stacked geometry) re-derive from children order.
                       Hidden at the ends so you can't move past the edge. -->
                  {#if i > 0}
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <text role="button" tabindex="-1" class="ge-container-slot-move"
                      x={size.w - 50} y={containerSlotY(i) + 4}
                      data-tip="Move up in the stack"
                      onpointerdown={(ev) => { ev.stopPropagation(); moveChild(n.id, origIdx, -1); }}>▲</text>
                  {/if}
                  {#if i < visibleChildren.length - 1}
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <text role="button" tabindex="-1" class="ge-container-slot-move"
                      x={size.w - 32} y={containerSlotY(i) + 4}
                      data-tip="Move down in the stack"
                      onpointerdown={(ev) => { ev.stopPropagation(); moveChild(n.id, origIdx, 1); }}>▼</text>
                  {/if}
                  <!-- × removes this child from the container -->
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <text role="button" tabindex="-1" class="ge-container-slot-x"
                    x={size.w - 14} y={containerSlotY(i) + 4}
                    onpointerdown={(ev) => { ev.stopPropagation(); graph = removeContainerChildAt(graph, n.id, origIdx); }}>×</text>
                {/each}
                <!-- Trailing + drop slot — drag any output socket onto here to append. -->
                {@const trailY = containerSlotY(visibleChildren.length)}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle role="button" tabindex="-1" class="ge-sock in child trail" cx="0" cy={trailY} r="5"
                  onpointerup={(ev) => endWireOnContainerSlot(ev, n.id)}/>
                <text x="10" y={trailY + 4} class="ge-sock-label trail">+ drop here</text>
                <!-- Non-root containers have an OUTPUT socket — their result
                     can feed upstream (e.g. into a method.obj). -->
                {#if !isRoot}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <circle role="button" tabindex="-1" class="ge-sock out" cx={size.w} cy={size.h / 2} r="6"
                    onpointerdown={(ev) => startWire(ev, n.id)}/>
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
                <text x="10" y="22" class="ge-node-title">◇ polygon · {poly.points.length} pts{polyConsumed ? ' · 🔒' : ''}</text>
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
                  data-tip={polyConsumed
                    ? 'Polygon is wired into a Revolve / Extrude — delete the consumer first to unlock this polygon.'
                    : 'Delete polygon'}
                  onpointerdown={(ev) => { ev.stopPropagation(); if (!polyConsumed) deleteNode(n.id); }}>×</text>
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
                            onclick={() => { graph = movePolygonPoint(graph, n.id, idx, -1); }}>▲</button>
                          <button class="ge-poly-mv" type="button" title="Move down" disabled={idx === poly.points.length - 1}
                            onclick={() => { graph = movePolygonPoint(graph, n.id, idx, 1); }}>▼</button>
                          <button class="ge-poly-ins" type="button" title="Insert a vertex above this row"
                            onclick={() => { graph = addPolygonPoint(graph, n.id, idx - 1); }}>+</button>
                          <button class="ge-poly-del" type="button" title="Remove this loop ref (drops the source card too)" disabled={poly.points.length <= 1}
                            onclick={() => { graph = removePolygonPoint(graph, n.id, idx); }}>×</button>
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
                              oninput={(e) => { graph = setPolygonRepeatCount(graph, n.id, idx, { kind: 'literal', value: Math.max(0, Math.round(Number((e.target as HTMLInputElement).value) || 0)) }); }}/>
                            <span class="ge-poly-repeat-label">loop</span>
                            <input class="ge-poly-input ge-poly-repeat-var" type="text" maxlength="6"
                              value={String(pt.loopVar || 'i')}
                              title="Loop variable bound in the r and z expressions (default i)"
                              oninput={(e) => { graph = setPolygonRepeatLoopVar(graph, n.id, idx, String((e.target as HTMLInputElement).value) || 'i'); }}/>
                            <span class="ge-poly-repeat-spacer"></span>
                            <button class="ge-poly-mv" type="button" title="Move up" disabled={idx === 0}
                              onclick={() => { graph = movePolygonPoint(graph, n.id, idx, -1); }}>▲</button>
                            <button class="ge-poly-mv" type="button" title="Move down" disabled={idx === poly.points.length - 1}
                              onclick={() => { graph = movePolygonPoint(graph, n.id, idx, 1); }}>▼</button>
                            <button class="ge-poly-ins" type="button" title="Insert a vertex above this row"
                              onclick={() => { graph = addPolygonPoint(graph, n.id, idx - 1); }}>+</button>
                            <button class="ge-poly-del" type="button" title="Remove repeat block" disabled={poly.points.length <= 1}
                              onclick={() => { graph = removePolygonPoint(graph, n.id, idx); }}>×</button>
                          </div>
                          <div class="ge-poly-repeat-row">
                            <span class="ge-poly-axis-label">{ax0}({pt.loopVar || 'i'})</span>
                            <input class="ge-poly-input expr" type="text"
                              value={pt.r?.kind === 'expr' ? pt.r.expr : pt.r?.kind === 'literal' ? String(pt.r.value) : ''}
                              placeholder="cos(i*2*PI/6)"
                              oninput={(e) => { graph = setPolygonCoord(graph, n.id, idx, 'r', { kind: 'expr', expr: (e.target as HTMLInputElement).value }); }}/>
                          </div>
                          <div class="ge-poly-repeat-row">
                            <span class="ge-poly-axis-label">{ax1}({pt.loopVar || 'i'})</span>
                            <input class="ge-poly-input expr" type="text"
                              value={pt.z?.kind === 'expr' ? pt.z.expr : pt.z?.kind === 'literal' ? String(pt.z.value) : ''}
                              placeholder="sin(i*2*PI/6)"
                              oninput={(e) => { graph = setPolygonCoord(graph, n.id, idx, 'z', { kind: 'expr', expr: (e.target as HTMLInputElement).value }); }}/>
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
                              graph = setPolygonCoord(graph, n.id, idx, 'r', { kind: 'literal', value: v });
                            }}><svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path fill="currentColor" d="M6 2h4l1 1h3v2H2V3h3l1-1zm-2 4h8l-1 8H5L4 6zm2 2v6h1V8H6zm3 0v6h1V8H9z"/></svg></button>
                        {:else if pt.r.kind === 'expr'}
                          <button class="ge-poly-unwire" type="button"
                            title="Back to a number (clears the expression)"
                            onclick={() => { graph = setPolygonCoord(graph, n.id, idx, 'r', { kind: 'literal', value: 0 }); }}><svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path fill="currentColor" d="M6 2h4l1 1h3v2H2V3h3l1-1zm-2 4h8l-1 8H5L4 6zm2 2v6h1V8H6zm3 0v6h1V8H9z"/></svg></button>
                        {:else}
                          <span></span>
                        {/if}
                        <span class="ge-poly-axis-label">{ax0}</span>
                        {#if pt.r.kind === 'literal'}
                          <input class="ge-poly-input" type="number" step="0.05"
                            value={pt.r.value}
                            oninput={(e) => { graph = setPolygonCoord(graph, n.id, idx, 'r', { kind: 'literal', value: Number((e.target as HTMLInputElement).value) }); }}/>
                        {:else if pt.r.kind === 'param'}
                          <!-- svelte-ignore a11y_click_events_have_key_events -->
                          <!-- svelte-ignore a11y_no_static_element_interactions -->
                          <span class="ge-poly-chip" title={`Wired to p.${pt.r.param} — click to write an expression like p.${pt.r.param} / 2`}
                            onclick={(ev) => openPolyExprPop(ev as any, n.id, idx, 'r', `p.${pt.r.param}`)}>p.{pt.r.param}</span>
                        {:else}
                          <input class="ge-poly-input expr" type="text"
                            value={pt.r.expr}
                            placeholder="p.od / 2"
                            oninput={(e) => { graph = setPolygonCoord(graph, n.id, idx, 'r', { kind: 'expr', expr: (e.target as HTMLInputElement).value }); }}/>
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
                          onclick={() => { graph = movePolygonPoint(graph, n.id, idx, -1); }}>▲</button>
                        <button class="ge-poly-mv" type="button" title="Move down" disabled={idx === poly.points.length - 1}
                          onclick={() => { graph = movePolygonPoint(graph, n.id, idx, 1); }}>▼</button>
                        <button class="ge-poly-ins" type="button" title="Insert a vertex above this row"
                          onclick={() => { graph = addPolygonPoint(graph, n.id, idx - 1); }}>+</button>
                        <!-- Axis-1 sub-row (bottom): [socket-gutter w/ 🗑] + label
                             + input + ƒ + delete. Mirrors the r sub-row's gutter
                             layout — trash appears only when wired/expr. -->
                        {#if pt.z.kind === 'param'}
                          <button class="ge-poly-unwire" type="button"
                            title={`Disconnect from p.${pt.z.param} (keep current numeric value)`}
                            onclick={() => {
                              const v = Number((graph.params as any)?.[(pt.z as any).param]?.default ?? 0);
                              graph = setPolygonCoord(graph, n.id, idx, 'z', { kind: 'literal', value: v });
                            }}><svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path fill="currentColor" d="M6 2h4l1 1h3v2H2V3h3l1-1zm-2 4h8l-1 8H5L4 6zm2 2v6h1V8H6zm3 0v6h1V8H9z"/></svg></button>
                        {:else if pt.z.kind === 'expr'}
                          <button class="ge-poly-unwire" type="button"
                            title="Back to a number (clears the expression)"
                            onclick={() => { graph = setPolygonCoord(graph, n.id, idx, 'z', { kind: 'literal', value: 0 }); }}><svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path fill="currentColor" d="M6 2h4l1 1h3v2H2V3h3l1-1zm-2 4h8l-1 8H5L4 6zm2 2v6h1V8H6zm3 0v6h1V8H9z"/></svg></button>
                        {:else}
                          <span></span>
                        {/if}
                        <span class="ge-poly-axis-label">{ax1}</span>
                        {#if pt.z.kind === 'literal'}
                          <input class="ge-poly-input" type="number" step="0.05"
                            value={pt.z.value}
                            oninput={(e) => { graph = setPolygonCoord(graph, n.id, idx, 'z', { kind: 'literal', value: Number((e.target as HTMLInputElement).value) }); }}/>
                        {:else if pt.z.kind === 'param'}
                          <!-- svelte-ignore a11y_click_events_have_key_events -->
                          <!-- svelte-ignore a11y_no_static_element_interactions -->
                          <span class="ge-poly-chip" title={`Wired to p.${pt.z.param} — click to write an expression like p.${pt.z.param} / 2`}
                            onclick={(ev) => openPolyExprPop(ev as any, n.id, idx, 'z', `p.${pt.z.param}`)}>p.{pt.z.param}</span>
                        {:else}
                          <input class="ge-poly-input expr" type="text"
                            value={pt.z.expr}
                            placeholder="p.len"
                            oninput={(e) => { graph = setPolygonCoord(graph, n.id, idx, 'z', { kind: 'expr', expr: (e.target as HTMLInputElement).value }); }}/>
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
                          onclick={() => { graph = removePolygonPoint(graph, n.id, idx); }}>×</button>
                      </div>
                      {/if}
                    {/each}
                    </div>
                    <div class="ge-poly-add-row">
                      <button class="ge-poly-add" type="button" title="Add a vertex below the last row"
                        onclick={() => { graph = addPolygonPoint(graph, n.id); }}>+ vertex</button>
                      <button class="ge-poly-add repeat" type="button" title="Add a REPEAT block — expands to N points via a loop"
                        onclick={() => { graph = addPolygonRepeat(graph, n.id); }}>+ repeat</button>
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
                      onpointerup={(ev) => endWireOnPolygonRepeatRef(ev, n.id, idx)}/>
                  {:else if idx < 8 && pt?.kind !== 'repeat'}
                    <!-- Vertex r/z sockets — two stacked, one per axis. -->
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <circle role="button" tabindex="-1"
                      class={`ge-sock in poly-coord${pt.r.kind === 'param' ? ' wired' : ''}`}
                      cx="0" cy={polySockR(n, idx)} r="5"
                      onpointerup={(ev) => endWireOnPolygonCoord(ev, n.id, idx, 'r')}/>
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <circle role="button" tabindex="-1"
                      class={`ge-sock in poly-coord${pt.z.kind === 'param' ? ' wired' : ''}`}
                      cx="0" cy={polySockZ(n, idx)} r="5"
                      onpointerup={(ev) => endWireOnPolygonCoord(ev, n.id, idx, 'z')}/>
                  {/if}
                {/each}
                <!-- OUTPUT socket on right edge — wires to the Output card. -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle role="button" tabindex="-1" class="ge-sock out" cx={size.w} cy={size.h / 2} r="6"
                  onpointerdown={(ev) => startWire(ev, n.id)}/>

              {:else if n.type === 'sketch'}
                {@const sk = n as any}
                {@const skConsumed = consumedSet.has(n.id)}
                <!-- Sketch card (plan M.1) — CAD-operator profile producer:
                     line/spline points + fillet/chamfer corner mods compile
                     to (r,z) via Maker.js. Output socket wires into a
                     revolve/extrude profile arg like a polygon. -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <rect role="button" tabindex="-1" class="ge-node-bg sketch"
                  width={size.w} height={size.h} rx="6"
                  style="width: {size.w}px; height: {size.h}px"
                  onpointerdown={(ev) => onNodePointerDown(ev, n.id)}
                  onpointermove={onNodePointerMove}
                  onpointerup={onNodePointerUp}/>
                <text x="10" y="22" class="ge-node-title">✐ sketch{skConsumed ? ' · 🔒' : ''}</text>
                <!-- ✎ open the full-tab sketch editor (plan M.2). -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <text role="button" tabindex="-1" x={size.w - 32} y="22" class="ge-sketch-edit-btn"
                  data-tip="Edit in the full-tab sketch editor"
                  onpointerdown={(ev) => { ev.stopPropagation(); openSketchEditor(n.id); }}>✎</text>
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <text role="button" tabindex="-1" x={size.w - 14} y="22" class="ge-node-x"
                  class:disabled={skConsumed}
                  data-tip={skConsumed ? 'Wired into a Revolve/Extrude — delete the consumer first.' : 'Delete sketch'}
                  onpointerdown={(ev) => { ev.stopPropagation(); if (!skConsumed) deleteNode(n.id); }}>×</text>
                <line x1="0" y1="32" x2={size.w} y2="32" class="ge-node-divider"/>
                <foreignObject x="6" y="36" width={size.w - 12} height={size.h - 40} class="ge-fo">
                  <div class="ge-sketch" xmlns="http://www.w3.org/1999/xhtml">
                    <div class="ge-sketch-ops">
                      {#each (sk.ops as Array<any>) as op, idx (idx)}
                        {#if op.op === 'line' || op.op === 'spline'}
                          <!-- Two STACKED sub-rows (r over z) — compact + each
                               coord has a left-edge wire socket (rendered as SVG
                               siblings below) so a param can be wired in. -->
                          <div class="ge-sketch-vtx" class:editing={sketchExprPop?.sid === n.id && sketchExprPop?.opIdx === idx} style="height: {sketchEntryH(op)}px">
                            <div class="ge-sketch-srow">
                              <button class="ge-sketch-axis" class:spline={op.op === 'spline'} class:rel={op.mode === 'rel'} title="Toggle absolute / Δ relative (offset from previous point)" onclick={() => toggleSketchOpMode(n.id, idx, op)}>{sketchAxisLabel(op, 'r')}</button>
                              <input class="ge-sketch-in" type="text" value={argStr(op.r)} title={op.mode === 'rel' ? 'Δr — offset from previous point' : 'r — number or p.param'}
                                onchange={(e) => { graph = setSketchOpField(graph, n.id, idx, 'r', argFrom((e.target as HTMLInputElement).value)); }}/>
                              <button class="ge-sketch-fx" type="button" title="Write/edit an expression for r" class:on={op.r?.kind === 'expr'}
                                onclick={(ev) => openSketchExprPop(ev, n.id, idx, 'r', argStr(op.r))}>ƒ</button>
                              <button class="ge-sketch-btn" type="button" title="Move up" disabled={idx === 0}
                                onclick={() => { graph = moveSketchOp(graph, n.id, idx, -1); }}>▲</button>
                            </div>
                            <div class="ge-sketch-srow">
                              <button class="ge-sketch-axis" class:spline={op.op === 'spline'} class:rel={op.mode === 'rel'} title="Toggle absolute / Δ relative (offset from previous point)" onclick={() => toggleSketchOpMode(n.id, idx, op)}>{sketchAxisLabel(op, 'z')}</button>
                              <input class="ge-sketch-in" type="text" value={argStr(op.z)} title={op.mode === 'rel' ? 'Δz — offset from previous point' : 'z'}
                                onchange={(e) => { graph = setSketchOpField(graph, n.id, idx, 'z', argFrom((e.target as HTMLInputElement).value)); }}/>
                              <button class="ge-sketch-fx" type="button" title="Write/edit an expression for z" class:on={op.z?.kind === 'expr'}
                                onclick={(ev) => openSketchExprPop(ev, n.id, idx, 'z', argStr(op.z))}>ƒ</button>
                              <button class="ge-sketch-btn" type="button" title="Move down" disabled={idx === sk.ops.length - 1}
                                onclick={() => { graph = moveSketchOp(graph, n.id, idx, 1); }}>▼</button>
                              <button class="ge-sketch-btn del" type="button" title="Remove op" disabled={sk.ops.length <= 1}
                                onclick={() => { graph = removeSketchOp(graph, n.id, idx); }}>×</button>
                            </div>
                          </div>
                        {:else}
                          <div class="ge-sketch-vtx corner" class:editing={sketchExprPop?.sid === n.id && sketchExprPop?.opIdx === idx} style="height: {sketchEntryH(op)}px">
                            <div class="ge-sketch-srow">
                              <span class="ge-sketch-axis corner" class:chamfer={op.op === 'chamfer'} title={op.op === 'fillet' ? 'fillet radius' : 'chamfer distance'}>{op.op === 'fillet' ? 'fillet' : 'chamf'}</span>
                              <input class="ge-sketch-in" type="text" value={argStr(op.op === 'fillet' ? op.radius : op.dist)} title={op.op === 'fillet' ? 'fillet radius' : 'chamfer dist'}
                                onchange={(e) => { graph = setSketchOpField(graph, n.id, idx, op.op === 'fillet' ? 'radius' : 'dist', argFrom((e.target as HTMLInputElement).value)); }}/>
                              <button class="ge-sketch-fx" type="button" title="Write/edit an expression" class:on={(op.op === 'fillet' ? op.radius : op.dist)?.kind === 'expr'}
                                onclick={(ev) => openSketchExprPop(ev, n.id, idx, op.op === 'fillet' ? 'radius' : 'dist', argStr(op.op === 'fillet' ? op.radius : op.dist))}>ƒ</button>
                              <button class="ge-sketch-btn" type="button" title="Move up" disabled={idx === 0}
                                onclick={() => { graph = moveSketchOp(graph, n.id, idx, -1); }}>▲</button>
                              <button class="ge-sketch-btn" type="button" title="Move down" disabled={idx === sk.ops.length - 1}
                                onclick={() => { graph = moveSketchOp(graph, n.id, idx, 1); }}>▼</button>
                              <button class="ge-sketch-btn del" type="button" title="Remove op" disabled={sk.ops.length <= 1}
                                onclick={() => { graph = removeSketchOp(graph, n.id, idx); }}>×</button>
                            </div>
                          </div>
                        {/if}
                      {/each}
                    </div>
                    <div class="ge-sketch-foot">
                      <button class="ge-sketch-add" type="button" title="Add a line segment" onclick={() => { graph = addSketchOp(graph, n.id, 'line'); }}>+ line</button>
                      <button class="ge-sketch-add" type="button" title="Add a Bézier spline" onclick={() => { graph = addSketchOp(graph, n.id, 'spline'); }}>+ spline</button>
                      <button class="ge-sketch-add" type="button" title="Round the previous corner" onclick={() => { graph = addSketchOp(graph, n.id, 'fillet'); }}>+ fillet</button>
                      <button class="ge-sketch-add" type="button" title="Bevel the previous corner" onclick={() => { graph = addSketchOp(graph, n.id, 'chamfer'); }}>+ chamfer</button>
                    </div>
                  </div>
                </foreignObject>
                <!-- Per-coord wire sockets (drag a PARAMS output onto one to
                     wire p.<name> into that coord). Mirrors the polygon card. -->
                {#each (sk.ops as Array<any>) as op, idx (idx)}
                  {#if op.op === 'line' || op.op === 'spline'}
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <circle role="button" tabindex="-1" class="ge-sock in poly-coord" cx="0" cy={sketchSockR(n, idx)} r="4"
                      class:wired={op.r?.kind === 'param'} data-tip="Drag a param here → r"
                      onpointerup={(ev) => endWireOnSketchCoord(ev, n.id, idx, 'r')}/>
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <circle role="button" tabindex="-1" class="ge-sock in poly-coord" cx="0" cy={sketchSockZ(n, idx)} r="4"
                      class:wired={op.z?.kind === 'param'} data-tip="Drag a param here → z"
                      onpointerup={(ev) => endWireOnSketchCoord(ev, n.id, idx, 'z')}/>
                  {:else}
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <circle role="button" tabindex="-1" class="ge-sock in poly-coord" cx="0" cy={sketchSockVal(n, idx)} r="4"
                      class:wired={(op.op === 'fillet' ? op.radius : op.dist)?.kind === 'param'} data-tip="Drag a param here"
                      onpointerup={(ev) => endWireOnSketchCoord(ev, n.id, idx, op.op === 'fillet' ? 'radius' : 'dist')}/>
                  {/if}
                {/each}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle role="button" tabindex="-1" class="ge-sock out" cx={size.w} cy={size.h / 2} r="6"
                  onpointerdown={(ev) => startWire(ev, n.id)}/>

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
                  onpointerdown={(ev) => { ev.stopPropagation(); graph = removeNode(graph, n.id); }}>×</text>
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
                          oninput={(e) => { graph = setPolyRepeatCount(graph, pr.id, { kind: 'literal', value: Math.max(0, Math.round(Number((e.target as HTMLInputElement).value) || 0)) }); }}/>
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
                          oninput={(e) => { graph = setPolyRepeatCount(graph, pr.id, { kind: 'expr', expr: (e.target as HTMLInputElement).value }); }}/>
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
                        oninput={(e) => { graph = setPolyRepeatLoopVar(graph, pr.id, String((e.target as HTMLInputElement).value) || 'i'); }}/>
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
                        onclick={() => { graph = addPolyRepeatBinding(graph, pr.id); }}>+</button>
                    </div>
                    {#each (pr.bindings ?? []) as bind, bIdx (bIdx)}
                      <div class="ge-prc-bind-row">
                        <input class="ge-poly-input ge-prc-bind-name" type="text" maxlength="12"
                          value={bind.name}
                          placeholder="name"
                          title="Binding name (used in r and z expressions)"
                          oninput={(e) => { graph = setPolyRepeatBindingName(graph, pr.id, bIdx, String((e.target as HTMLInputElement).value)); }}/>
                        <span class="ge-prc-eq">=</span>
                        <input class="ge-poly-input expr" type="text"
                          value={bind.value?.kind === 'expr' ? bind.value.expr : bind.value?.kind === 'literal' ? String(bind.value.value) : ''}
                          placeholder="p.od / 2"
                          oninput={(e) => { graph = setPolyRepeatBindingValue(graph, pr.id, bIdx, { kind: 'expr', expr: (e.target as HTMLInputElement).value }); }}/>
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
                          onclick={() => { graph = removePolyRepeatBinding(graph, pr.id, bIdx); }}>×</button>
                      </div>
                    {/each}
                    <div class="ge-prc-section-head">Loop ƒ({pr.loopVar || 'i'})</div>
                    <div class="ge-prc-expr-row">
                      <span class="ge-prc-label">{prAx0}</span>
                      <input class="ge-poly-input expr" type="text"
                        value={pr.r?.kind === 'expr' ? pr.r.expr : pr.r?.kind === 'literal' ? String(pr.r.value) : ''}
                        placeholder={prAx0Ph}
                        oninput={(e) => { graph = setPolyRepeatCoord(graph, pr.id, 'r', { kind: 'expr', expr: (e.target as HTMLInputElement).value }); }}/>
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
                        oninput={(e) => { graph = setPolyRepeatCoord(graph, pr.id, 'z', { kind: 'expr', expr: (e.target as HTMLInputElement).value }); }}/>
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
                  onpointerdown={(ev) => startWire(ev, n.id)}/>
                <!-- NPts input socket — left edge, aligned with the NPts
                     row inside the foreignObject (header 28 + section
                     head 18 + half-row 11 ≈ 57). Drag a param's output
                     onto this socket to wire p.<name> → NPts. -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle role="button" tabindex="-1"
                  class={`ge-sock in poly-repeat-in${pr.count?.kind === 'param' ? ' wired' : ''}`}
                  cx="0" cy="57" r="5"
                  onpointerup={(ev) => endWireOnPolyRepeatCount(ev, pr.id)}/>
              {/if}
              <!-- ─── Bottom-right corner resize grip ─────────────────────
                   Diagonal handle in the card's bottom-right corner —
                   drag to widen/shrink. Moved off the right edge so it
                   doesn't fight the output sockets that live there (Call
                   output, Polygon output, Container output all sit at
                   x=size.w, vertically centred). Two short stacked
                   strokes give the classic "↘" resize-handle look at
                   ~10 × 10 px. The Output card (root) skips the grip. -->
              {#if n.id !== graph.root}
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
          {/each}

          {#if allNodes.filter((n) => n.id !== graph.root).length === 0}
            <text x="80" y="100" class="ge-canvas-hint">Click <tspan font-weight="bold">+ Drop</tspan> to add a Call, CSG op, or transform.</text>
          {/if}
        </g>

        <!-- PARAMS CARD — tacked outside the pan/zoom group so it stays
             glued to the viewport top-left. Holds N param chips vertically,
             with a title bar that has a + rounded button to add a new param.
             Each chip is vertically symmetric, with: 📌 pin (left),
             p.name + input value, 🗑 trash (right), output socket OUTSIDE
             the card's right edge for drag-wiring. -->
        <g class="ge-params-card" transform="translate({CARD_X0},{CARD_Y0})">
          <rect class="ge-params-card-bg" width={pcs.w} height={pcs.h} rx="8"/>
          <text x="10" y={CARD_TITLE_H - 9} class="ge-params-card-title">Params</text>
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <circle role="button" tabindex="-1" class="ge-params-add-btn"
            cx={pcs.w - 14} cy={CARD_TITLE_H - 13} r="9"
            onpointerdown={(ev) => { ev.stopPropagation(); openAddParamPop(ev); }}/>
          <text x={pcs.w - 14} y={CARD_TITLE_H - 9} class="ge-params-add-glyph" text-anchor="middle" pointer-events="none">+</text>
          <line x1="0" y1={CARD_TITLE_H} x2={pcs.w} y2={CARD_TITLE_H} class="ge-params-card-divider"/>
        </g>
        <!-- Chips render in viewport coords too. Output sockets stick out
             of the card's right edge so they can still be drag-targeted. -->
        {#each paramEntries as [name, p], i (name)}
          {@const pos = paramPos(name, i)}
          <g class="ge-param-card" transform="translate({pos.x},{pos.y})">
            <!-- Chip body — HTML/CSS flex layout inside a foreignObject so
                 pin / name / input / trash align cleanly without manual
                 SVG-coordinate math. Dynamic chip width (PARAM_W) tracks
                 the longest label so labels never clip; the label cell
                 itself flex-grows to absorb the slack. -->
            <foreignObject x="0" y="0" width={PARAM_W} height={PARAM_H}>
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
                  <button class="trash" type="button" title="Remove p.{name}"
                    onpointerdown={(ev) => { ev.stopPropagation(); onRemoveParam(name); }}>🗑</button>
                {:else}
                  <span class="trash locked" title="Reserved — cannot be deleted">🔒</span>
                {/if}
              </div>
            </foreignObject>
            <!-- Output socket — OUTSIDE the chip right edge so it's never clipped -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <circle role="button" tabindex="-1" class="ge-sock out param"
              cx={PARAM_W + CARD_PAD + 4} cy={PARAM_H / 2} r="5"
              onpointerdown={(ev) => startParamWire(ev, name)}/>
          </g>
        {/each}
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
      {#if editingSketchId && sketchEditor}
        {@const se = sketchEditor}
        {@const sid = editingSketchId}
        {@const fr = sketchFrame ?? se.ext}
        {@const span = Math.max(fr.maxX - fr.minX, fr.maxY - fr.minY) || 1}
        {@const pad = span * 0.12 + 0.2}
        {@const vb = `${fr.minX - pad} ${fr.minY - pad} ${(fr.maxX - fr.minX) + 2 * pad} ${(fr.maxY - fr.minY) + 2 * pad}`}
        {@const hr = span * 0.018}
        {@const sw = span * 0.008}
        <div class="ge-sketch-editor">
          <!-- Tool palette — LEFT vertical rail (matches the main editor vrail). -->
          <div class="ge-sketch-vtools">
            <button class="ge-stool" class:on={sketchTool === 'select'} title="Select / drag points" onclick={() => (sketchTool = 'select')}>⬚</button>
            <div class="ge-stool-sep"></div>
            <button class="ge-stool" class:on={sketchTool === 'line'} title="Line — click the canvas to add points" onclick={() => (sketchTool = 'line')}>╱</button>
            <button class="ge-stool" class:on={sketchTool === 'spline'} title="Spline — click to add a Bézier point" onclick={() => (sketchTool = 'spline')}>∿</button>
            <button class="ge-stool" class:on={sketchTool === 'fillet'} title="Fillet — click a corner to round it" onclick={() => (sketchTool = 'fillet')}>◜</button>
            <button class="ge-stool" class:on={sketchTool === 'chamfer'} title="Chamfer — click a corner to bevel it" onclick={() => (sketchTool = 'chamfer')}>⊿</button>
            <div class="ge-stool-sep"></div>
            <button class="ge-stool" title="Fit — re-frame the view to the sketch (the view stays fixed while you drag points)" onclick={fitSketchFrame}>⤢</button>
          </div>
          <!-- S.2: the 2D draw stage fills the sketcher (minus the tool rail +
               the 3D pane). The PARAMS card + sketch card FLOAT over it as a
               draggable overlay (.ge-sketch-side / .ge-sketch-cards) — each
               drags by its TITLE bar — and stay fully wireable: drag a param's
               output socket onto a coord's input socket to wire p.<name>, wires
               re-route from the moved card, 3D re-bakes live. The overlay is
               pointer-events:none so drawing passes through; only the card
               bodies + sockets capture events. Stage-level pointer handlers
               track both a card-title drag and an in-flight wire that crosses
               the empty canvas (which would otherwise eat the move events). -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="ge-sketch-stage" onpointermove={sketchStageMove} onpointerup={sketchStageUp}>
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <svg bind:this={sketchSvgEl} class="ge-sketch-svg" class:tool={sketchTool !== 'select'} class:panning={!!sketchPanDrag}
              viewBox={vb} preserveAspectRatio="xMidYMid meet"
              onpointerdown={sketchCanvasClick} onwheel={sketchCanvasWheel}>
              <!-- revolve axis at r = 0 -->
              <line x1="0" y1={fr.minY - pad} x2="0" y2={fr.maxY + pad} stroke="#cbd5e1" stroke-width={sw * 0.5} stroke-dasharray={`${sw * 4} ${sw * 3}`}/>
              {#if se.pts.length > 2}
                <polygon points={se.pts.map((q) => `${q[0]},${q[1]}`).join(' ')} fill="rgba(147,51,234,0.12)" stroke="#7c3aed" stroke-width={sw} stroke-linejoin="round"/>
              {/if}
              {#each se.anchors as a, i (a.opIdx)}
                <!-- corner badge: ring on filleted/chamfered vertices; gold when selected -->
                {#if a.corner}
                  <circle cx={a.r} cy={a.z} r={hr * 1.9} fill="none"
                    stroke={a.cornerOpIdx === selectedCornerOpIdx ? '#f59e0b' : (a.corner === 'fillet' ? '#0e7490' : '#b45309')}
                    stroke-width={hr * 0.4} pointer-events="none"/>
                {/if}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle cx={a.r} cy={a.z} r={hr}
                  class="ge-sk-anchor" class:locked={!a.literal}
                  fill={a.kind === 'spline' ? '#0891b2' : '#7c3aed'} stroke="#fff" stroke-width={hr * 0.25}
                  onpointerdown={(ev) => sketchAnchorDown(ev, a.opIdx, a.literal, a.kind)}
                  onpointermove={sketchAnchorMove}
                  onpointerup={(ev) => { sketchAnchorUp(); sketchAnchorTap(ev, sid, a.opIdx, argStr(se.node.ops[a.opIdx].r)); }}
                  ondblclick={(ev) => openSketchExprPop(ev, sid, a.opIdx, 'r', argStr(se.node.ops[a.opIdx].r))}/>
                <!-- Number every point (1,2,3…) in small font next to it. -->
                <text x={a.r + hr * 1.7} y={a.z - hr * 1.3} font-size={hr * 2.0} fill={i === 0 ? '#15803d' : '#6d28d9'} font-weight="700" pointer-events="none" style="paint-order: stroke" stroke="#fff" stroke-width={hr * 0.5}>{i + 1}</text>
                <!-- (Param→point on-canvas sockets/badges removed — param links
                     read on the sketch CARD only, per user; the drawing stays clean.) -->
              {/each}
              <!-- Phase 2: selected spline's relative through-points + end handles.
                   Amber dots; thin dashed handle lines off the endpoints. Ghost
                   (low-opacity) end handles are defaults the user grabs to create
                   an h0/h1; solid ones are stored. -->
              {#if selectedSpline}
                {@const ss = selectedSpline}
                <line x1={ss.a[0]} y1={ss.a[1]} x2={ss.h0.x} y2={ss.h0.y} stroke="#d97706"
                  stroke-width={sw * 0.7} stroke-dasharray={`${sw * 2} ${sw * 2}`}
                  opacity={ss.h0.set ? 0.9 : 0.4} pointer-events="none"/>
                <line x1={ss.b[0]} y1={ss.b[1]} x2={ss.h1.x} y2={ss.h1.y} stroke="#d97706"
                  stroke-width={sw * 0.7} stroke-dasharray={`${sw * 2} ${sw * 2}`}
                  opacity={ss.h1.set ? 0.9 : 0.4} pointer-events="none"/>
                {#each ss.pts as pt (pt.k)}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <circle cx={pt.x} cy={pt.y} r={hr} class="ge-sk-spt"
                    fill="#f59e0b" stroke="#fff" stroke-width={hr * 0.25}
                    onpointerdown={(ev) => splineCompDown(ev, 'pt', pt.k)}
                    onpointermove={splineCompMove} onpointerup={splineCompUp}/>
                  <!-- per-point delete: a small × above-right of THIS through-point -->
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <circle class="ge-sk-spt-del-hit" role="button" tabindex="-1"
                    cx={pt.x + hr * 1.5} cy={pt.y - hr * 1.5} r={hr * 0.9}
                    data-tip="Delete this through-point"
                    onpointerdown={(ev) => { ev.stopPropagation(); if (editingSketchId) graph = removeSketchSplinePoint(graph, editingSketchId, ss.opIdx, pt.k); }}/>
                  <text x={pt.x + hr * 1.5} y={pt.y - hr * 1.5 + hr * 0.5} font-size={hr * 1.4} text-anchor="middle"
                    fill="#fff" font-weight="700" pointer-events="none">×</text>
                {/each}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle cx={ss.h0.x} cy={ss.h0.y} r={hr * 0.82} class="ge-sk-spt"
                  fill="#fbbf24" stroke="#b45309" stroke-width={hr * 0.3}
                  opacity={ss.h0.set ? 1 : 0.45}
                  onpointerdown={(ev) => splineCompDown(ev, 'h0')}
                  onpointermove={splineCompMove} onpointerup={splineCompUp}/>
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle cx={ss.h1.x} cy={ss.h1.y} r={hr * 0.82} class="ge-sk-spt"
                  fill="#fbbf24" stroke="#b45309" stroke-width={hr * 0.3}
                  opacity={ss.h1.set ? 1 : 0.45}
                  onpointerdown={(ev) => splineCompDown(ev, 'h1')}
                  onpointermove={splineCompMove} onpointerup={splineCompUp}/>
              {/if}
            </svg>
            <!-- Floating, draggable cards overlay (S.2): the real PARAMS card +
                 sketch node card, on top of the 2D stage. 1:1 px coordinate
                 space (no viewBox). Root is pointer-events:none so the canvas
                 underneath stays drawable; each card group re-enables events.
                 Wires + the in-flight preview route from sketchCardPos. -->
            {#if miniLayout}
              {@const ml = miniLayout}
              {@const sn = se.node}
              {@const scW = sketchCardSize?.w ?? MINI_SCW}
              {@const scH = sketchCardSize?.h ?? ml.sch}
              <svg class="ge-sketch-cards" bind:this={miniSvgEl}>
                <!-- committed wires: every param-driven coord → its param socket -->
                {#each (sn.ops as Array<any>) as op, idx (idx)}
                  {#if sketchRowVisible(sn, idx, scH)}
                    {@const fields = (op.op === 'line' || op.op === 'spline')
                      ? [['r', sketchSockR(sn, idx)], ['z', sketchSockZ(sn, idx)]]
                      : op.op === 'fillet' ? [['radius', sketchSockVal(sn, idx)]]
                      : op.op === 'chamfer' ? [['dist', sketchSockVal(sn, idx)]] : []}
                    {#each fields as [field, sy] (field)}
                      {@const av = (op as any)[field]}
                      {@const ty = sketchCardPos.sketch.y + (sy as number) - sketchOpsScrollTop}
                      {#if av?.kind === 'param'}
                        {@const pi = paramNames.indexOf(av.param)}
                        {#if pi >= 0}{@const a = miniParamSockAbs(pi)}<path class="ge-wire param" d={miniBez(a.x, a.y, sketchCardPos.sketch.x, ty)}/>{/if}
                      {:else if av?.kind === 'expr'}
                        {#each extractParamRefs(av.expr) as ref (ref)}
                          {@const pi = paramNames.indexOf(ref)}
                          {#if pi >= 0}{@const a = miniParamSockAbs(pi)}<path class="ge-wire param expr" d={miniBez(a.x, a.y, sketchCardPos.sketch.x, ty)}/>{/if}
                        {/each}
                      {/if}
                    {/each}
                  {/if}
                {/each}
                <!-- (Param→on-canvas-point wires removed — param links are shown
                     on the sketch CARD only, per user. Card→coord wires below.) -->

                <!-- PARAMS card — drag by its title bar -->
                <g class="card" transform="translate({sketchCardPos.params.x},{sketchCardPos.params.y})">
                  <rect class="ge-params-card-bg" width={pcs.w} height={pcs.h} rx="8"/>
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <rect class="ge-sketch-card-title" x="0" y="0" width={pcs.w} height={CARD_TITLE_H} rx="8"
                    onpointerdown={(ev) => sketchCardDown(ev, 'params')}/>
                  <text x="10" y={CARD_TITLE_H - 9} class="ge-params-card-title" pointer-events="none">Params</text>
                  <!-- + add a new param (same handler as the main params card) -->
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <circle role="button" tabindex="-1" class="ge-params-add-btn"
                    cx={pcs.w - 14} cy={CARD_TITLE_H - 13} r="9"
                    data-tip="Add a parameter"
                    onpointerdown={(ev) => { ev.stopPropagation(); openAddParamPop(ev); }}/>
                  <text x={pcs.w - 14} y={CARD_TITLE_H - 9} class="ge-params-add-glyph" text-anchor="middle" pointer-events="none">+</text>
                  <line x1="0" y1={CARD_TITLE_H} x2={pcs.w} y2={CARD_TITLE_H} class="ge-params-card-divider" pointer-events="none"/>
                  {#if paramEntries.length === 0}
                    <text x="10" y={CARD_TITLE_H + 22} class="ge-sketch-mini-empty">No params yet — add them on the graph.</text>
                  {/if}
                  {#each paramEntries as [name, p], i (name)}
                    <g transform="translate({CARD_PAD},{CARD_TITLE_H + CARD_PAD + i * (PARAM_H + PARAM_GAP)})">
                      <foreignObject x="0" y="0" width={PARAM_W} height={PARAM_H}>
                        <div class="ge-param-chip" xmlns="http://www.w3.org/1999/xhtml">
                          <span class="name" title="p.{name}">p.{name}</span>
                          <input class="val" type="number" step="0.05" value={(p as any).default}
                            onchange={(e) => onParamDefault(name, Number((e.target as HTMLInputElement).value))}/>
                        </div>
                      </foreignObject>
                      <!-- Output socket — drag onto a sketch coord input socket. -->
                      <!-- svelte-ignore a11y_no_static_element_interactions -->
                      <circle role="button" tabindex="-1" class="ge-sock out param"
                        cx={PARAM_W + CARD_PAD + 4} cy={PARAM_H / 2} r="5"
                        data-tip="Drag onto a sketch coord to wire p.{name}"
                        onpointerdown={(ev) => startParamWire(ev, name)}/>
                    </g>
                  {/each}
                </g>

                <!-- SKETCH node card — drag by its title bar; per-coord wire
                     sockets (LEFT edge) + a ƒ button on every coord row. -->
                <g class="card" transform="translate({sketchCardPos.sketch.x},{sketchCardPos.sketch.y})">
                  <rect class="ge-node-bg sketch" width={scW} height={scH} rx="6"/>
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <rect class="ge-sketch-card-title" x="0" y="0" width={scW} height="32" rx="6"
                    onpointerdown={(ev) => sketchCardDown(ev, 'sketch')}/>
                  <text x="10" y="22" class="ge-node-title" pointer-events="none">✐ sketch</text>
                  <line x1="0" y1="32" x2={scW} y2="32" class="ge-node-divider" pointer-events="none"/>
                  <foreignObject x="6" y="36" width={scW - 12} height={scH - 40} class="ge-fo">
                    <div class="ge-sketch" xmlns="http://www.w3.org/1999/xhtml">
                      <!-- svelte-ignore a11y_no_static_element_interactions -->
                      <div class="ge-sketch-ops" onscroll={(e) => (sketchOpsScrollTop = (e.currentTarget as HTMLElement).scrollTop)}>
                        {#each (sn.ops as Array<any>) as op, idx (idx)}
                          {#if op.op === 'line' || op.op === 'spline'}
                            <div class="ge-sketch-vtx" class:editing={sketchExprPop?.sid === sid && sketchExprPop?.opIdx === idx} style="height: {sketchEntryH(op)}px">
                              <div class="ge-sketch-srow">
                                <button class="ge-sketch-axis" class:spline={op.op === 'spline'} class:rel={op.mode === 'rel'} title="Toggle absolute / Δ relative (offset from previous point)" onclick={() => toggleSketchOpMode(sid, idx, op)}>{sketchAxisLabel(op, 'r')}</button>
                                <input class="ge-sketch-in" type="text" value={argStr(op.r)} title={op.mode === 'rel' ? 'Δr — offset from previous point' : 'r — number or p.param'}
                                  onchange={(e) => { graph = setSketchOpField(graph, sid, idx, 'r', argFrom((e.target as HTMLInputElement).value)); }}/>
                                <button class="ge-sketch-fx" type="button" title="Write/edit an expression for r" class:on={op.r?.kind === 'expr'}
                                  onclick={(ev) => openSketchExprPop(ev, sid, idx, 'r', argStr(op.r))}>ƒ</button>
                                <button class="ge-sketch-btn" type="button" title="Move up" disabled={idx === 0}
                                  onclick={() => { graph = moveSketchOp(graph, sid, idx, -1); }}>▲</button>
                              </div>
                              <div class="ge-sketch-srow">
                                <button class="ge-sketch-axis" class:spline={op.op === 'spline'} class:rel={op.mode === 'rel'} title="Toggle absolute / Δ relative (offset from previous point)" onclick={() => toggleSketchOpMode(sid, idx, op)}>{sketchAxisLabel(op, 'z')}</button>
                                <input class="ge-sketch-in" type="text" value={argStr(op.z)} title={op.mode === 'rel' ? 'Δz — offset from previous point' : 'z'}
                                  onchange={(e) => { graph = setSketchOpField(graph, sid, idx, 'z', argFrom((e.target as HTMLInputElement).value)); }}/>
                                <button class="ge-sketch-fx" type="button" title="Write/edit an expression for z" class:on={op.z?.kind === 'expr'}
                                  onclick={(ev) => openSketchExprPop(ev, sid, idx, 'z', argStr(op.z))}>ƒ</button>
                                <button class="ge-sketch-btn" type="button" title="Move down" disabled={idx === sn.ops.length - 1}
                                  onclick={() => { graph = moveSketchOp(graph, sid, idx, 1); }}>▼</button>
                                <button class="ge-sketch-btn del" type="button" title="Remove op" disabled={sn.ops.length <= 1}
                                  onclick={() => { graph = removeSketchOp(graph, sid, idx); }}>×</button>
                              </div>
                            </div>
                          {:else}
                            <div class="ge-sketch-vtx corner" class:editing={sketchExprPop?.sid === sid && sketchExprPop?.opIdx === idx} style="height: {sketchEntryH(op)}px">
                              <div class="ge-sketch-srow">
                                <span class="ge-sketch-axis corner" class:chamfer={op.op === 'chamfer'} title={op.op === 'fillet' ? 'fillet radius' : 'chamfer distance'}>{op.op === 'fillet' ? 'fillet' : 'chamf'}</span>
                                <input class="ge-sketch-in" type="text" value={argStr(op.op === 'fillet' ? op.radius : op.dist)} title={op.op === 'fillet' ? 'fillet radius' : 'chamfer dist'}
                                  onchange={(e) => { graph = setSketchOpField(graph, sid, idx, op.op === 'fillet' ? 'radius' : 'dist', argFrom((e.target as HTMLInputElement).value)); }}/>
                                <button class="ge-sketch-fx" type="button" title="Write/edit an expression" class:on={(op.op === 'fillet' ? op.radius : op.dist)?.kind === 'expr'}
                                  onclick={(ev) => openSketchExprPop(ev, sid, idx, op.op === 'fillet' ? 'radius' : 'dist', argStr(op.op === 'fillet' ? op.radius : op.dist))}>ƒ</button>
                                <button class="ge-sketch-btn" type="button" title="Move up" disabled={idx === 0}
                                  onclick={() => { graph = moveSketchOp(graph, sid, idx, -1); }}>▲</button>
                                <button class="ge-sketch-btn" type="button" title="Move down" disabled={idx === sn.ops.length - 1}
                                  onclick={() => { graph = moveSketchOp(graph, sid, idx, 1); }}>▼</button>
                                <button class="ge-sketch-btn del" type="button" title="Remove op" disabled={sn.ops.length <= 1}
                                  onclick={() => { graph = removeSketchOp(graph, sid, idx); }}>×</button>
                              </div>
                            </div>
                          {/if}
                        {/each}
                      </div>
                      <div class="ge-sketch-foot">
                        <button class="ge-sketch-add" type="button" title="Add a line segment" onclick={() => { graph = addSketchOp(graph, sid, 'line'); }}>+ line</button>
                        <button class="ge-sketch-add" type="button" title="Add a Bézier spline" onclick={() => { graph = addSketchOp(graph, sid, 'spline'); }}>+ spline</button>
                        <button class="ge-sketch-add" type="button" title="Round the previous corner" onclick={() => { graph = addSketchOp(graph, sid, 'fillet'); }}>+ fillet</button>
                        <button class="ge-sketch-add" type="button" title="Bevel the previous corner" onclick={() => { graph = addSketchOp(graph, sid, 'chamfer'); }}>+ chamfer</button>
                      </div>
                    </div>
                  </foreignObject>
                  <!-- Per-coord INPUT sockets (drop a param's output socket here).
                       They live in card-space, so when the ops list scrolls they
                       shift up by sketchOpsScrollTop and hide once their row
                       scrolls out of the visible card band. -->
                  {#each (sn.ops as Array<any>) as op, idx (idx)}
                    {#if sketchRowVisible(sn, idx, scH)}
                      {#if op.op === 'line' || op.op === 'spline'}
                        <!-- svelte-ignore a11y_no_static_element_interactions -->
                        <circle role="button" tabindex="-1" class={`ge-sock in poly-coord${op.r?.kind === 'param' ? ' wired' : ''}`}
                          cx="0" cy={sketchSockR(sn, idx) - sketchOpsScrollTop} r="4" data-tip="Drag a param here → r"
                          onpointerup={(ev) => endWireOnSketchCoord(ev, sid, idx, 'r')}/>
                        <!-- svelte-ignore a11y_no_static_element_interactions -->
                        <circle role="button" tabindex="-1" class={`ge-sock in poly-coord${op.z?.kind === 'param' ? ' wired' : ''}`}
                          cx="0" cy={sketchSockZ(sn, idx) - sketchOpsScrollTop} r="4" data-tip="Drag a param here → z"
                          onpointerup={(ev) => endWireOnSketchCoord(ev, sid, idx, 'z')}/>
                      {:else}
                        <!-- svelte-ignore a11y_no_static_element_interactions -->
                        <circle role="button" tabindex="-1" class={`ge-sock in poly-coord${(op.op === 'fillet' ? op.radius : op.dist)?.kind === 'param' ? ' wired' : ''}`}
                          cx="0" cy={sketchSockVal(sn, idx) - sketchOpsScrollTop} r="4" data-tip="Drag a param here"
                          onpointerup={(ev) => endWireOnSketchCoord(ev, sid, idx, op.op === 'fillet' ? 'radius' : 'dist')}/>
                      {/if}
                    {/if}
                  {/each}
                  <!-- Bottom-right resize grip — drag to set a fixed card size
                       (the ops list then scrolls when ops overflow). -->
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <path class="ge-sketch-resize-grip" d={`M ${scW - 3} ${scH - 14} L ${scW - 3} ${scH - 3} L ${scW - 14} ${scH - 3} Z`}
                    onpointerdown={sketchCardResizeDown} onpointermove={sketchCardResizeMove} onpointerup={sketchCardResizeUp}/>
                </g>

                <!-- in-flight preview: param out socket → cursor -->
                {#if wireFrom?.kind === 'param-out' && wireMouse}
                  {@const pi = paramNames.indexOf(wireFrom.paramName)}
                  {#if pi >= 0}
                    {@const a = miniParamSockAbs(pi)}
                    <path class="ge-wire in-flight" d={miniBez(a.x, a.y, wireMouse.x, wireMouse.y)} pointer-events="none"/>
                  {/if}
                {/if}
              </svg>
            {/if}
            <!-- DRAGGABLE top bar — the live corner radius/dist dial or spline
                 controls. Floats over the stage; drag the ⣿ handle to reposition.
                 Only rendered when a corner or spline is selected — otherwise it
                 would show as an empty floating box (just the grip). -->
            {#if selectedCorner || selectedSpline}
            <div class="ge-sketch-topbar" style="left: {sketchBarPos.x}px; top: {sketchBarPos.y}px">
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <span class="ge-sketch-grip" title="Drag the toolbar"
                onpointerdown={sketchBarDown} onpointermove={sketchBarMove} onpointerup={sketchBarUp}>⣿</span>
              {#if selectedCorner}
                <div class="ge-stool-sep"></div>
                <span class="ge-sketch-dial">
                  <span class="ge-sketch-dial-lbl">{selectedCorner.kind === 'fillet' ? '◜ radius' : '⊿ dist'}</span>
                  {#if selectedCorner.bound}
                    <!-- Param/expr-driven: show the binding + live resolved value;
                         ↩ unties back to a literal you can drag. -->
                    <span class="ge-sketch-bound" title="Driven by {selectedCorner.label}">ƒ {selectedCorner.label}</span>
                    <span class="ge-sketch-resolved">= {Math.round(selectedCorner.value * 1000) / 1000}</span>
                    <button class="ge-sketch-dial-x untie" title="Unbind → literal" onclick={() => bindCornerParam('__literal__')}>↩</button>
                  {:else}
                    <input class="ge-sketch-range" type="range" min="0" max={span * 0.5} step={span / 200}
                      value={selectedCorner.value}
                      oninput={(e) => setCornerValue(+(e.currentTarget as HTMLInputElement).value)} />
                    <input class="ge-sketch-num" type="number" min="0" step="0.01"
                      value={Math.round(selectedCorner.value * 1000) / 1000}
                      onchange={(e) => setCornerValue(+(e.currentTarget as HTMLInputElement).value)} />
                    <span class="ge-sketch-wire-hint">↦ tap a param →</span>
                  {/if}
                  <button class="ge-sketch-dial-x" title="Remove this corner" onclick={removeSelectedCorner}>✕</button>
                </span>
              {/if}
              {#if selectedSpline}
                <div class="ge-stool-sep"></div>
                <span class="ge-sketch-dial">
                  <span class="ge-sketch-dial-lbl">∿ spline · {selectedSpline.pts.length} pt</span>
                  <button class="ge-stool" title="Add a through-point (mid-chord)" onclick={addSplinePt}>+ pt</button>
                  <button class="ge-stool" title="Remove the last through-point" disabled={selectedSpline.pts.length === 0} onclick={removeSplinePt}>− pt</button>
                  <button class="ge-stool" title="Clear both end handles → auto Catmull-Rom tangent" disabled={!selectedSpline.h0.set && !selectedSpline.h1.set} onclick={autoTangentSpline}>auto tangent</button>
                </span>
              {/if}
            </div>
            {/if}
            <!-- Standalone Done tick — pinned top-right, above the canvas/overlay. -->
            <button class="ge-sketch-done-tick" title="Done — back to the graph" onclick={closeSketchEditor}>✓</button>
            <div class="ge-sketch-hint">
              {#if sketchTool === 'select'}Drag the violet points to reshape · pick a tool to add ops
              {:else if sketchTool === 'fillet' || sketchTool === 'chamfer'}Click a corner to {sketchTool} it, then use the dial to set the {sketchTool === 'fillet' ? 'radius' : 'distance'}
              {:else}Click the canvas to add a {sketchTool}{/if}
            </div>
          </div>
        </div>
      {/if}
    </section>

    <!-- Divider: canvas ↔ right pane -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="ge-divider" role="separator" tabindex="-1" aria-orientation="vertical"
      onpointerdown={startSplitDrag}
      onpointermove={onSplitMove}
      onpointerup={endSplitDrag}></div>

    <!-- RIGHT pane — tabbed: 3D bake / live source. One tab visible at a
         time; both keep their state mounted so switching is instant. -->
    <section class="ge-right-pane">
      <div class="ge-pane-tabs" role="tablist">
        <button class="ge-pane-tab" class:active={rightTab === 'bake'}
          type="button" role="tab" aria-selected={rightTab === 'bake'}
          data-tip={!hasSolidProducer ? '2D preview — resolved polygon (axis at r=0 for revolve, centered for cartesian)' : '3D bake — live mesh + GLB preview'}
          onclick={() => setRightTab('bake')}>{!hasSolidProducer ? '2D preview' : '3D bake'}</button>
        <button class="ge-pane-tab" class:active={rightTab === 'source'}
          type="button" role="tab" aria-selected={rightTab === 'source'}
          data-tip={`SRC — the emitted ${exemplarId}.asm.ts auto-generated from the graph`}
          onclick={() => setRightTab('source')}>SRC</button>
        <button class="ge-pane-tab" class:active={rightTab === 'md'}
          type="button" role="tab" aria-selected={rightTab === 'md'}
          data-tip="MD — hand-authored drawing-descriptor markdown. Saved as meta.drawingMd."
          onclick={() => setRightTab('md')}>MD{drawingMd ? ` · ${drawingMd.length}c` : ''}</button>
      </div>
      <div class="ge-pane-bodies">
        <div class="ge-bake-body" class:hidden={rightTab !== 'bake'}>
          {#if !hasSolidProducer}
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
                      {@const entryIdx = rootPoly ? entryIdxForEvalIdx(rootPoly, i) : null}
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
                          startPolyVertexDrag(ev, rootPolygonId, i, v.yFlip ? 'cartesian' : 'revolve');
                        }}
                        onpointerenter={(ev) => { if (rootPolygonId) showSvgTip(ev, rootPolygonId, entryIdx, i, profilePts.length, p); }}
                        onpointermove={(ev) => { polyDragMove(ev); moveSvgTip(ev); }}
                        onpointerleave={() => { if (rootPolygonId) hideSvgTip(rootPolygonId, entryIdx); }}
                        onpointerup={polyDragEnd}>
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
          {:else if !bake}<div class="ge-empty">Drop nodes to bake.</div>
          {:else if bake === 'loading'}<div class="ge-empty">baking…</div>
          {:else if !bake.ok}
            <div class="ge-err">
              <div>{bake.message ?? 'bake failed'}</div>
              {#if /EMPTY solid|stack: item|degenerate|parameter 0 has unknown type|memory access out of bounds/.test(bake.message ?? '')}
                {#if /EMPTY solid|stack: item|degenerate|\[in .+→|\(in .+→/.test(bake.message ?? '')}
                  <!-- A dependency CHAIN ([in X → Y]) means this came from a
                       named primitive's geometry, NOT a stale server. It's a
                       GEOMETRY error: a CSG/revolve produced invalid/empty
                       geometry (subtract that removes everything, NaN/0 param,
                       degenerate profile). Point the user at the params, and do
                       NOT offer the restart button (clicking it wedged the dev
                       server, 2026-06-13). -->
                  <div class="ge-err-hint geom">
                    ⚠ A primitive produced <strong>invalid or empty geometry</strong> — e.g. a
                    subtract that removes everything (same OD on both sides), or a
                    NaN/0 parameter feeding a revolve. Check the parameters of the
                    part(s) in the chain above. This is a geometry issue, not a
                    server problem — no restart needed.
                  </div>
                {:else}
                  <!-- Bare OOB with no dep chain — can be a stale dev server
                       (Vite HMR skips server modules: primitive-loader /
                       composition-graph / emit). -->
                  <div class="ge-err-hint">
                    ⚠ Looks like a stale dev server (Vite HMR skips server modules after
                    edits to composition-graph / composition-emit / primitive-loader).
                    <div class="ge-err-hint-actions">
                      <button class="ge-err-restart-btn" type="button"
                        disabled={restartBusy} onclick={restartDevServer}>
                        {restartBusy ? '🔄 restarting…' : '🔄 Restart dev server'}
                      </button>
                      <span class="ge-err-hint-or">or manually:</span>
                      <code>pkill -f 'bun run dev' && bun run dev</code>
                    </div>
                    {#if restartStatus}<div class="ge-err-restart-stat">{restartStatus}</div>{/if}
                  </div>
                {/if}
              {/if}
            </div>
          {:else if PrimitiveDualCanvas && (props.active ?? true)}
            <PrimitiveDualCanvas id={exemplarId} name={exemplarId} description=""
              args={bake.args ?? paramDefaults}
              source={bake.source}
              showControls={true} showLabels={false}/>
            <!-- Cache status row + Rebuild button (Phase 1.5) -->
            {@const bakeMeta = (bake as any).bake ?? {}}
            <div class="ge-bake-meta">
              {#if bakeMeta.cached}
                {@const cacheMs = Number(bakeMeta._t?.fetch_total) || 0}
                <span class="ge-cache-badge cached"
                  title={`hash: ${bakeMeta.cacheHash ?? '?'} · client round-trip ${cacheMs} ms (mesh decode + paint)`}>
                  ✓ cached{cacheMs > 0 ? ` · ${Math.round(cacheMs)} ms` : ''}
                </span>
              {:else if bakeMeta.cacheHash}
                {@const serverMs = Object.entries(bakeMeta._t ?? {}).reduce((a: number, [k, b]: [string, any]) => {
                  // fetch_total is the client-perspective round-trip we
                  // stash in composition-bake; don't double-count it
                  // against the server-side phase sum.
                  if (k === 'fetch_total') return a;
                  const n = Number(b);
                  return a + (Number.isFinite(n) ? n : 0);
                }, 0)}
                <span class="ge-cache-badge fresh" title={`hash: ${bakeMeta.cacheHash}`}>fresh · {Math.round(serverMs as number)} ms</span>
              {/if}
              {#if bakeMeta.cutawaySkipped}
                <span class="ge-cache-badge skipped" title="Cutaway CSG auto-skipped for big manifolds (> 15k tris). Click Load to compute it.">cutaway off (perf)</span>
                <button class="ge-cutaway-load-btn" type="button"
                  disabled={cutawayBusy} onclick={loadCutaway}
                  title="Bake cutaway on-demand for this part">
                  {cutawayBusy ? '🔄 …' : 'Load'}
                </button>
                {#if cutawayStatus}<span class="ge-rebuild-stat">{cutawayStatus}</span>{/if}
              {/if}
              <span class="ge-bake-meta-spacer"></span>
              <button class="ge-rebuild-btn" type="button"
                disabled={rebuildBusy} onclick={rebuildCache}
                title="Clear this part's cache then re-bake from scratch">
                {rebuildBusy ? '🔄 …' : '🔄 Rebuild'}
              </button>
              {#if rebuildStatus}<span class="ge-rebuild-stat">{rebuildStatus}</span>{/if}
            </div>
          {:else}<div class="ge-empty">3D canvas loading…</div>
          {/if}
        </div>
        <div class="ge-source-body" class:hidden={rightTab !== 'source'}>
          {#if legacyLoad}
            <div class="ge-legacy-banner">
              {#if legacyLoad.reason === 'no-graph'}
                <strong>{legacyLoad.id}</strong> opened in legacy mode — its source has
                no <code>meta.graph</code> block, so the canvas can't hydrate. Save
                here to overwrite with a graph-format part. The legacy PrimitiveView
                editor was removed 2026-06-09 — graph editor is the only editor now.
              {:else}
                Could not fetch <strong>{legacyLoad.id}</strong> from the volume.
                Check the id + your volume connection.
              {/if}
            </div>
          {/if}
          <!-- Filename header — the SAM info that used to live in the tab
               label. Moved into the body so the tab strip stays compact. -->
          <div class="ge-source-header">
            <code>{exemplarId}.asm.ts</code>
            <span class="ge-source-header-hint">auto-generated from the graph — edits here are discarded on next save</span>
          </div>
          <pre class="ge-source">{sourceText}</pre>
        </div>
        <div class="ge-md-body" class:hidden={rightTab !== 'md'}>
          <div class="ge-md-toolbar">
            <span class="ge-md-hint">Drawing-descriptor markdown — saved as <code>meta.drawingMd</code></span>
            <span class="ge-md-toolbar-actions">
              <!-- ✨ AI generate — kicks off a Claude-vision describe call
                   that drafts a markdown description from the current
                   bake + source + node graph. Endpoint TBD (#117 follow-up);
                   today this just toasts a stub message. -->
              <button class="ge-md-ai-btn" type="button"
                onclick={generateMdWithAi}
                disabled={mdAiBusy}
                data-tip="Generate description with AI (Claude vision — uses the current bake + graph as context)">
                {mdAiBusy ? '…' : '✨ AI'}
              </button>
              <span class="ge-md-count">{drawingMd.length} char{drawingMd.length === 1 ? '' : 's'}</span>
            </span>
          </div>
          <textarea class="ge-md-textarea"
            placeholder="# How to draw this part&#10;&#10;Notes, sketch references, parameter meanings, gotchas…"
            bind:value={drawingMd}></textarea>
        </div>
      </div>
    </section>
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

  {#if profilePop}
    <!-- Profile-kind picker popover (#119). Lists curated kinds filtered
         by the primitive's `set` (revolve = r,z half-section; cartesian =
         x,y polygon). Click a kind → arg's expr is replaced with a fresh
         {kind, params} JSON descriptor seeded with defaults. -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="ge-wire-shade" onclick={closeProfilePop}></div>
    <div class="ge-profile-pop"
      style="left: {Math.min(profilePop.x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 280)}px; top: {Math.min(profilePop.y, (typeof window !== 'undefined' ? window.innerHeight : 800) - 360)}px">
      <div class="ge-profile-pop-head">
        <span class="ge-profile-pop-title">Profile · {profilePop.set}</span>
        <span class="ge-profile-pop-hint">{profilePop.key} · {profilePop.src}</span>
      </div>
      <div class="ge-profile-pop-list">
        {#each kindsForSet(profilePop.set) as def (def.id)}
          <button class="ge-profile-pop-item"
            class:active={def.id === profilePop.currentKind}
            type="button"
            onclick={() => selectProfileKind(def.id)}>
            <span class="ge-profile-pop-item-name">{def.label}</span>
            <span class="ge-profile-pop-item-id">{def.id}</span>
          </button>
        {/each}
      </div>
    </div>
  {/if}

  {#if profileRefPop}
    <!-- Node-ref profile swap picker. Lists every polygon/sketch in the graph
         (the new sketch IS a profile producer — combining the 2D drawing
         program with the profile editor) + a shortcut to the built-in kinds. -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="ge-wire-shade" onclick={closeProfileRefPop}></div>
    <div class="ge-profile-pop"
      style="left: {Math.min(profileRefPop.x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 280)}px; top: {Math.min(profileRefPop.y, (typeof window !== 'undefined' ? window.innerHeight : 800) - 360)}px">
      <div class="ge-profile-pop-head">
        <span class="ge-profile-pop-title">Choose a profile</span>
        <span class="ge-profile-pop-hint">{profileRefPop.key} · wire a polygon / sketch</span>
      </div>
      <div class="ge-profile-pop-list">
        {#each profileProducers() as prod (prod.id)}
          {@const curExpr = String((graph.nodes[profileRefPop.callId] as any)?.args?.[profileRefPop.key]?.expr ?? '')}
          <button class="ge-profile-pop-item"
            class:active={curExpr === `__POLY__${prod.id}`}
            type="button"
            onclick={() => swapProfileRef(profileRefPop!.callId, profileRefPop!.key, prod.id)}>
            <span class="ge-profile-pop-item-name">{prod.type === 'sketch' ? '✐ ' : '◇ '}{producerLabel(prod.id)}</span>
            <span class="ge-profile-pop-item-id">{prod.id}</span>
          </button>
        {/each}
        {#if profileProducers().length === 0}
          <div class="ge-profile-pop-empty">No polygon or sketch in this graph yet. Drop one (✎ → polygon / sketch) first.</div>
        {/if}
      </div>
    </div>
  {/if}

  {#if argExprPop}
    <!-- ƒ-expression editor popup — wider input + click-to-insert chips for
         every declared param. Used when an arg references 2+ params (the
         inline text box becomes too cramped to read). -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="ge-wire-shade" onclick={closeArgExprPop}></div>
    <div class="ge-wire-pop ge-expr-pop"
      use:clampToViewport={argExprPop}
      style="left: {Math.min(argExprPop.x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 460)}px; top: {argExprPop.y}px">
      <div class="ge-wire-head">ƒ <code>{argExprPop.key}</code> expression</div>
      <textarea class="ge-expr-textarea" rows="3"
        placeholder="e.g. p.od / 2 - p.wall"
        value={argExprPop.draft}
        oninput={(e) => { if (argExprPop) argExprPop = { ...argExprPop, draft: (e.target as HTMLTextAreaElement).value }; }}></textarea>
      <div class="ge-expr-pop-row">
        <span class="ge-expr-pop-label">insert:</span>
        {#each paramEntries as [name, p] (name)}
          <button class="ge-expr-pop-chip" type="button"
            onclick={() => insertParamIntoDraft(name)}
            title={`Append p.${name} to the expression (default ${(p as any).default})`}>p.{name}</button>
        {/each}
        {#if paramEntries.length === 0}
          <span class="ge-empty">no params declared</span>
        {/if}
      </div>
      <div class="ge-expr-pop-row right">
        <button class="ge-param-add ghost" type="button" onclick={closeArgExprPop}>cancel</button>
        <button class="ge-param-add" type="button" onclick={applyArgExprPop}>apply</button>
      </div>
    </div>
  {/if}

  {#if sketchExprPop}
    <!-- Sketch coord ƒ-expression editor (S.2) — same UX as argExprPop, keyed
         to a sketch op field (r / z / fillet radius / chamfer dist). Apply →
         setSketchOpField with kind:'expr'; the 3D re-bakes live. -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="ge-wire-shade" onclick={closeSketchExprPop}></div>
    <div class="ge-wire-pop ge-expr-pop"
      use:clampToViewport={sketchExprPop}
      style="left: {sketchExprPop.x}px; top: {sketchExprPop.y}px">
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="ge-wire-head ge-wire-head-drag" title="Drag to move"
        onpointerdown={sketchExprPopDown} onpointermove={sketchExprPopMove} onpointerup={sketchExprPopUp}>ƒ sketch point <code>{sketchExprPop.field}</code> expression</div>
      {#if sketchExprPop.drafts}
        {@const _op = (graph.nodes[sketchExprPop.sid] as any)?.ops?.[sketchExprPop.opIdx]}
        {@const _rel = _op?.mode === 'rel'}
        <!-- r / z tab strip + abs/Δ toggle — edit both coordinates of the point
             without closing the popover (mirrors the polygon vertex editor).
             Apply writes BOTH axes. -->
        <div class="ge-expr-pop-tabs">
          <button class="ge-expr-pop-tab" type="button"
            class:on={sketchExprPop.field === 'r'}
            onclick={() => switchSketchExprAxis('r')}>{_rel ? 'Δr' : 'r'}</button>
          <button class="ge-expr-pop-tab" type="button"
            class:on={sketchExprPop.field === 'z'}
            onclick={() => switchSketchExprAxis('z')}>{_rel ? 'Δz' : 'z'}</button>
          <button class="ge-expr-pop-mode" type="button" class:rel={_rel}
            title="Toggle absolute / Δ relative (offset from previous point)"
            onclick={toggleSketchExprPopMode}>{_rel ? 'Δ rel' : 'abs'}</button>
        </div>
      {/if}
      <textarea class="ge-expr-textarea" rows="3"
        placeholder="e.g. p.od / 2 - p.wall"
        value={sketchExprPop.draft}
        onkeydown={(e) => { if (e.key === 'Enter' && !(e as KeyboardEvent).shiftKey) { (e as KeyboardEvent).preventDefault(); applySketchExprPop(); } }}
        oninput={(e) => { if (sketchExprPop) sketchExprPop = { ...sketchExprPop, draft: (e.target as HTMLTextAreaElement).value }; }}></textarea>
      <div class="ge-expr-pop-row">
        <span class="ge-expr-pop-label">insert:</span>
        {#each paramEntries as [name, p] (name)}
          <button class="ge-expr-pop-chip" type="button"
            onclick={() => insertParamIntoSketchDraft(name)}
            title={`Append p.${name} to the expression (default ${(p as any).default})`}>p.{name}</button>
        {/each}
        {#if paramEntries.length === 0}
          <span class="ge-empty">no params declared</span>
        {/if}
      </div>
      <div class="ge-expr-pop-row right">
        <button class="ge-param-add danger" type="button" class:armed={sketchDelArmed} disabled={sketchPopPtCount <= 1}
          title={sketchPopPtCount <= 1 ? 'Can’t delete the only point' : (sketchDelArmed ? 'Click again to confirm' : 'Delete this point')}
          onclick={onSketchDeleteClick}>{sketchDelArmed ? 'confirm delete?' : '🗑 delete'}</button>
        <button class="ge-param-add ghost" type="button" onclick={closeSketchExprPop}>cancel</button>
        <button class="ge-param-add" type="button" onclick={applySketchExprPop}>apply</button>
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
      ? polygonModeFor(polyExprPop.polygonId)
      : (polyExprPop.repeatId ? polyRepeatModeFor(polyExprPop.repeatId) : 'revolve')}
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

  {#if containerPop}
    {@const cnode = graph.nodes[containerPop.containerId] as any}
    {@const ctitle = cnode?.id === graph.root ? '▶ Output' : cnode?.type === 'stack' ? '↕ Stack' : cnode?.type === 'group' ? '{} Group' : '[ ] List'}
    {@const isStack = cnode?.type === 'stack'}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="ge-wire-shade" onclick={closeContainerPop}></div>
    <div class="ge-wire-pop ge-container-pop"
      style="left: {Math.min(containerPop.x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 380)}px; top: {containerPop.y}px">
      <div class="ge-wire-head">{ctitle} · order</div>
      {#if (cnode?.children ?? []).length === 0}
        <div class="ge-empty">no children yet — drag-wire something into this card</div>
      {:else}
        <table class="ge-container-table">
          <thead>
            <tr><th>#</th><th>node</th><th>kind</th>{#if isStack}<th title="Per-child z-offset: blank = inherit the part's own stack_ref · 0 = end-to-end flush · negative = overlap into the next · positive = leave a gap">stack ref</th><th title="Copies of this child, mated end-to-end (replaces a Repeat node): blank/1 = single · a number or a param expr like p.n">× N</th>{/if}<th>order</th><th></th></tr>
          </thead>
          <tbody>
            {#each cnode.children as childId, i (childId)}
              {@const cn = graph.nodes[childId]}
              {@const kind = cn?.type === 'repeat' && (cn as any).op === 'list' ? 'list (×N)' : cn?.type ?? '?'}
              {@const label = cn?.type === 'call' ? `${(cn as any).alias} · ${(cn as any).src}`
                : cn?.type === 'method' ? `${(cn as any).op}(…)`
                : cn?.type === 'mv' ? 'mv(…)'
                : cn?.type === 'rot' ? 'rot(…)'
                : cn?.type === 'stack' ? 'stack(…)'
                : cn?.type === 'repeat' ? `repeat × ${(cn as any).count?.kind === 'literal' ? (cn as any).count.value : '…'}`
                : '(missing)'}
              {@const inheritedRef = cn?.type === 'call' ? expectedDefaults[(cn as any).src]?.[STACK_REF_PARAM] : undefined}
              {@const overrideRef = (cnode.childRefs ?? {})[childId]}
              <tr>
                <td class="ge-cp-idx">{i + 1}</td>
                <td class="ge-cp-name">{label}</td>
                <td class="ge-cp-kind">{kind}</td>
                {#if isStack}
                  <td class="ge-cp-ref">
                    <!-- Per-child stack-ref OVERRIDE. Blank value = inherit the
                         part's own stack_ref (shown as the placeholder when we
                         know it). Commit on Enter/blur (Apply-on-Enter convention);
                         empty clears the override → inherit. -->
                    <input
                      class="ge-cp-ref-input"
                      type="text"
                      inputmode="decimal"
                      value={overrideRef ?? ''}
                      placeholder={inheritedRef != null ? String(inheritedRef) : 'inherit'}
                      title={overrideRef != null
                        ? `Override for this stack: ${overrideRef} (clear to inherit ${inheritedRef ?? 0})`
                        : `Inheriting ${inheritedRef != null ? `the part's ${inheritedRef}` : '0 (no stack_ref on the part)'} — type a number to override here`}
                      onkeydown={(e) => { if ((e as KeyboardEvent).key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                      onchange={(e) => {
                        const raw = (e.target as HTMLInputElement).value.trim();
                        const v = raw === '' ? null : Number(raw);
                        graph = setStackChildRef(graph, cnode.id, childId, v == null || Number.isNaN(v) ? null : v);
                      }} />
                  </td>
                  {@const countVal = (cnode.childCounts ?? {})[childId]}
                  {@const countDisplay = countVal == null ? ''
                    : countVal.kind === 'literal' ? String(countVal.value)
                    : countVal.kind === 'param' ? `p.${countVal.param}`
                    : countVal.expr}
                  <td class="ge-cp-count">
                    <!-- Per-child COUNT (×N). Blank/1 = a single copy; a number
                         or a param expr (e.g. p.n) places N copies mated
                         end-to-end — no separate Repeat node. Commit on
                         Enter/blur; empty or ≤1 clears. -->
                    <input
                      class="ge-cp-count-input"
                      type="text"
                      value={countDisplay}
                      placeholder="1"
                      title={countVal != null
                        ? `Placing ${countDisplay} copies mated end-to-end (clear or set 1 for a single copy)`
                        : 'Single copy — type a number (or a param expr like p.n) to stack N copies'}
                      onkeydown={(e) => { if ((e as KeyboardEvent).key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                      onchange={(e) => {
                        const raw = (e.target as HTMLInputElement).value.trim();
                        let next = null;
                        if (raw !== '') {
                          const n = Number(raw);
                          if (Number.isFinite(n)) next = n <= 1 ? null : asLiteral(Math.floor(n));
                          else next = asExpr(raw);
                        }
                        graph = setStackChildCount(graph, cnode.id, childId, next);
                      }} />
                  </td>
                {/if}
                <td class="ge-cp-order">
                  <button type="button" class="ge-cp-arrow" title="Move up" disabled={i === 0}
                    onclick={() => moveChild(containerPop!.containerId, i, -1)}>▲</button>
                  <button type="button" class="ge-cp-arrow" title="Move down" disabled={i === cnode.children.length - 1}
                    onclick={() => moveChild(containerPop!.containerId, i, 1)}>▼</button>
                </td>
                <td class="ge-cp-del">
                  <button type="button" class="ge-cp-remove" title="Remove from container"
                    onclick={() => { graph = removeContainerChildAt(graph, containerPop!.containerId, i); }}>×</button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
      <div class="ge-expr-pop-row right">
        <button class="ge-param-add" type="button" onclick={closeContainerPop}>done</button>
      </div>
    </div>
  {/if}

  {#if polyPreviewFor && graph.nodes[polyPreviewFor]}
    {@const previewMode = polygonModeFor(polyPreviewFor)}
    {@const pts = polyToPoints(graph.nodes[polyPreviewFor])}
    {@const isCart = previewMode === 'cartesian'}
    <!-- Frozen view (#155): viewBox derived from polyPreviewView, NOT
         from the points' live bbox. Dragging a vertex updates pts but
         polyPreviewView stays put — no auto-zoom mid-drag. The toolbar
         buttons (zoom +/− · fit · + · 🗑) are the only path to mutate
         the view. -->
    {@const xMin = polyPreviewView.cx - polyPreviewView.half}
    {@const yMin = polyPreviewView.cy - polyPreviewView.half}
    {@const w = polyPreviewView.half * 2}
    {@const h = polyPreviewView.half * 2}
    {@const pad = 0}
    {@const vb = `${xMin} ${yMin} ${w} ${h}`}
    {@const d = pts.length
      ? pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ') + ' Z'
      : ''}
    {@const dClose = pts.length > 1
      ? `M ${pts[pts.length - 1][0]} ${pts[pts.length - 1][1]} L ${pts[0][0]} ${pts[0][1]}`
      : ''}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    {#if !polyPreviewPinned}
      <!-- Outside-click shade only when NOT pinned. Pinning makes the
           popup persist while the user edits polygon coords. A drag in
           progress also prevents dismissal — releasing the pointer over
           the shade region after dragging shouldn't close the popup. -->
      <div class="ge-poly-preview-shade" onclick={() => { if (!polyDrag) polyPreviewFor = null; }}></div>
    {/if}
    <div class="ge-poly-preview" class:pinned={polyPreviewPinned}
      style="left: {polyPreviewPos.left}px; top: {polyPreviewPos.top}px; width: {polyPreviewSize.w}px; height: {polyPreviewSize.h}px">
      <div class="ge-poly-preview-head">
        <!-- Drag grip — pick up the popover by this dot-cluster and drop
             it anywhere (e.g. over the 3D canvas) so it stays visible
             while you edit a loop card on the graph canvas. svelte-ignore
             the pointer-driven role — the title attribute already
             communicates the affordance. -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <span class="ge-poly-preview-grab"
          title="Drag to reposition"
          onpointerdown={startPolyPreviewDrag}
          onpointermove={polyPreviewDragMove}
          onpointerup={polyPreviewDragEnd}>⋮⋮</span>
        <span class="ge-poly-preview-count">2D · {pts.length} pts</span>
        <!-- Drawing toolbar (#155): zoom +/− / fit / append vertex / pop
             last vertex. Frozen view means these are the ONLY way to
             change the SVG framing; drag never re-zooms. -->
        <div class="ge-poly-preview-toolbar">
          <button class="ge-poly-tb-btn" type="button" title="Zoom in"
            onclick={() => zoomPolyPreview(0.8)}>＋</button>
          <button class="ge-poly-tb-btn" type="button" title="Zoom out"
            onclick={() => zoomPolyPreview(1.25)}>－</button>
          <button class="ge-poly-tb-btn" type="button" title="Fit to points"
            onclick={fitPolyPreview}>⊡</button>
          <span class="ge-poly-tb-sep"></span>
          <!-- Mode toggles: ＋pt = "click on an edge to insert a vertex
               there" — armed state shows green tint until clicked again
               (or Escape). 🗑 = "click on a vertex to delete it" — armed
               state shows red tint. Both modes stay sticky so the user
               can chain edits. -->
          <button class="ge-poly-tb-btn ge-poly-tb-mode" type="button"
            class:on={polyInsertMode}
            title={polyInsertMode ? 'Insert mode ON — click an edge to add a vertex (Esc to exit)' : 'Insert mode: click an edge to add a vertex'}
            onclick={togglePolyInsertMode}>＋pt</button>
          <button class="ge-poly-tb-btn ge-poly-tb-mode del" type="button"
            class:on={polyDeleteMode}
            title={polyDeleteMode ? 'Delete mode ON — click a vertex to remove it (Esc to exit)' : 'Delete mode: click a vertex to remove it'}
            onclick={togglePolyDeleteMode} style="font-size: 10px">🗑</button>
        </div>
        <span class="ge-poly-preview-spacer"></span>
        <!-- Snap back to the polygon card on the graph canvas — the
             inverse of drag-it-onto-the-3D-canvas. Useful once a loop
             edit is done and the user wants the popover out of the
             3D-canvas region without closing it. -->
        <button class="ge-poly-preview-snap" type="button"
          title="Snap back to the polygon card"
          onclick={snapPolyPreviewToCard}>↩</button>
        <button class="ge-poly-preview-pin" type="button"
          class:on={polyPreviewPinned}
          title={polyPreviewPinned ? 'Unpin (popup will close on outside click)' : 'Pin (popup stays open while you edit)'}
          onclick={() => (polyPreviewPinned = !polyPreviewPinned)}>📌</button>
        <button class="ge-poly-preview-close" type="button"
          onclick={() => { polyPreviewFor = null; polyPreviewPinned = true; }} aria-label="Close">×</button>
      </div>
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <svg viewBox={vb} preserveAspectRatio="xMidYMid meet"
        xmlns="http://www.w3.org/2000/svg"
        class="ge-poly-preview-svg"
        class:insert-mode={polyInsertMode}
        class:delete-mode={polyDeleteMode}
        onclick={(ev) => { if (polyInsertMode && polyPreviewFor) handleSvgInsertClick(ev, polyPreviewFor, isCart); }}
        onpointermove={(ev) => { if (polyPreviewFor) handleSvgInsertMove(ev, polyPreviewFor, isCart); }}
        onpointerleave={clearPolyInsertHover}>
        <g transform={previewMode === 'cartesian' ? `scale(1, -1) translate(0, ${-(2 * yMin + h)})` : ''}>
          {#if previewMode !== 'cartesian'}
            <!-- Axis dashes for revolve profiles (r = 0 vertical line). -->
            <line x1="0" y1={yMin - pad} x2="0" y2={yMin + h + pad}
              stroke="#94a3b8" stroke-width={Math.max(w, h) * 0.005}
              stroke-dasharray={`${Math.max(w, h) * 0.02} ${Math.max(w, h) * 0.02}`}/>
          {:else}
            <!-- Cartesian cross-section: show both axes through origin
                 so the user sees the (0, 0) center the extrude rotates
                 around. Thin grey crosshair, dashed. -->
            {@const aw = Math.max(w, h) * 0.005}
            {@const ad = `${Math.max(w, h) * 0.02} ${Math.max(w, h) * 0.02}`}
            <line x1={xMin - pad} y1="0" x2={xMin + w + pad} y2="0"
              stroke="#94a3b8" stroke-width={aw} stroke-dasharray={ad}/>
            <line x1="0" y1={yMin - pad} x2="0" y2={yMin + h + pad}
              stroke="#94a3b8" stroke-width={aw} stroke-dasharray={ad}/>
          {/if}
          <path d={d} fill="rgba(204, 34, 34, 0.22)" stroke="#991b1b"
            stroke-width={Math.max(w, h) * 0.008} stroke-linejoin="round"/>
          <!-- Dashed auto-closure from last → first. -->
          <path d={dClose} fill="none" stroke="#991b1b"
            stroke-width={Math.max(w, h) * 0.006}
            stroke-dasharray={`${Math.max(w, h) * 0.02} ${Math.max(w, h) * 0.015}`} stroke-linecap="round"/>
          <!-- Insert-mode HOVER GHOST — fat stroke on the nearest edge +
               a translucent dot at the perpendicular projection point.
               Allowed edges = GREEN (committing will land a vertex);
               edges inside a repeat-block expansion = ORANGE + 🚫 no-entry
               glyph at the projection point so the user can see at a
               glance that this edge is generator-owned. pointer-events:none
               on every layer so the highlight never steals the click. -->
          {#if polyInsertMode && polyInsertHover}
            {@const hov = polyInsertHover}
            {@const stroke = hov.blocked ? '#ea580c' : '#16a34a'}
            {@const fill   = hov.blocked ? '#ea580c' : '#16a34a'}
            {@const sub    = hov.blocked ? '#9a3412' : '#15803d'}
            <line x1={hov.ax} y1={hov.ay} x2={hov.bx} y2={hov.by}
              stroke={stroke} stroke-width={Math.max(w, h) * 0.014}
              stroke-linecap="round" stroke-opacity="0.7" pointer-events="none"/>
            <circle cx={hov.px} cy={hov.py}
              r={Math.max(w, h) * 0.018}
              fill={fill} fill-opacity="0.55"
              stroke={sub} stroke-width={Math.max(w, h) * 0.005}
              pointer-events="none"/>
            {#if hov.blocked}
              <!-- 🚫 no-entry glyph rendered as a vector (circle + slash)
                   inside the SAME <g> as the path so it inherits the same
                   coord system + cartesian Y-flip. Drawn slightly bigger
                   than the projection dot so it reads as an overlay. -->
              {@const nr = Math.max(w, h) * 0.035}
              {@const nx = hov.px}
              {@const ny = hov.py}
              {@const sw = Math.max(w, h) * 0.008}
              <circle cx={nx} cy={ny} r={nr}
                fill="none" stroke="#9a3412" stroke-width={sw}
                pointer-events="none"/>
              <line x1={nx - nr * 0.7} y1={ny - nr * 0.7}
                    x2={nx + nr * 0.7} y2={ny + nr * 0.7}
                stroke="#9a3412" stroke-width={sw}
                stroke-linecap="round" pointer-events="none"/>
            {/if}
          {/if}
          <!-- Vertex hover halo (2026-06-11) — when the cursor is within
               ~3× the dot radius of a vertex, draw a soft ring around it
               so the user sees the point is interactive. Parametric +
               repeat-expanded points get a violet ring + a small ƒ glyph
               next to the dot signalling "click to edit expression";
               plain literal points get a neutral blue ring meaning
               "drag to move." pointer-events:none so the halo never
               intercepts the actual click that opens the popover. -->
          {#if polyHoverVertex}
            {@const hv = polyHoverVertex}
            {@const halo = hv.parametric ? '#6d28d9' : '#0369a1'}
            {@const haloR = Math.max(w, h) * 0.028}
            <circle cx={hv.px} cy={hv.py} r={haloR}
              fill={halo} fill-opacity="0.15"
              stroke={halo} stroke-width={Math.max(w, h) * 0.005}
              stroke-opacity="0.7"
              pointer-events="none"/>
            {#if hv.parametric}
              <!-- ƒ glyph just above the dot — vector so it inherits the
                   cartesian Y-flip with the rest of the <g>. Drawn as a
                   single bold character with a subtle background pill. -->
              {@const fxR = Math.max(w, h) * 0.022}
              {@const fxX = hv.px + haloR * 1.2}
              {@const fxY = hv.py - haloR * 0.4}
              <circle cx={fxX} cy={fxY} r={fxR}
                fill="#ede9fe" stroke="#6d28d9"
                stroke-width={Math.max(w, h) * 0.004}
                pointer-events="none"/>
              <text x={fxX} y={fxY}
                font-family="ui-monospace, monospace"
                font-size={Math.max(w, h) * 0.028}
                font-weight="700"
                fill="#5b21b6"
                text-anchor="middle"
                dominant-baseline="central"
                transform={previewMode === 'cartesian' ? `scale(1, -1) translate(0, ${-2 * fxY})` : ''}
                pointer-events="none">ƒ</text>
            {/if}
          {/if}
          {#each pts as p, i}
            {@const popupPolyNode = graph.nodes[polyPreviewFor] as any}
            <!-- Map the evaluated point index back to its ENTRY index
                 in the polygon so a loop-expanded point reads the right
                 entry kind (a single repeat-ref entry expands to N
                 points; without this all but the first would look up
                 the wrong entry or undefined and render as red). -->
            {@const entryIdx = entryIdxForEvalIdx(popupPolyNode, i)}
            {@const entry = entryIdx !== null ? popupPolyNode?.points?.[entryIdx] : null}
            {@const fromLoop = entryIdx === null}
            {@const parametricVertex = !!entry && entry.kind === 'point'
              && (entry.r?.kind !== 'literal' || entry.z?.kind !== 'literal')}
            {@const draggable = !!entry && entry.kind === 'point' && !parametricVertex && !fromLoop}
            {@const dotR = Math.max(w, h) * 0.012}
            <!-- Colour scheme (2026-06-11):
                 * literal vertex (drag to move)      = red   #991b1b
                 * parametric vertex (click to edit)   = violet #6d28d9
                 * LOOP-GENERATED point                = purple #a855f7
                                                        with darker ring
                                                        for extra contrast
                 The loop color is a distinctly LIGHTER violet so the user
                 can tell which dots came from a generator at a glance. -->
            {@const fill = fromLoop ? '#a855f7' : (parametricVertex ? '#6d28d9' : '#991b1b')}
            {@const stroke = fromLoop ? '#6d28d9' : (parametricVertex ? '#a78bfa' : 'none')}
            {@const isHl = !!hlVertex && hlVertex.polyId === polyPreviewFor && entryIdx === hlVertex.idx}
            {#if isHl}
              <circle cx={p[0]} cy={p[1]} r={dotR * 2.6} fill="none" stroke="#2563eb" stroke-width={dotR * 0.6} pointer-events="none"/>
            {/if}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <circle cx={p[0]} cy={p[1]} r={isHl ? dotR * 1.7 : dotR}
              fill={fill}
              stroke={stroke}
              stroke-width={fromLoop || parametricVertex ? dotR * 0.5 : 0}
              class:locked={!draggable}
              class:parametric={parametricVertex || fromLoop}
              onpointerdown={(ev) => startPolyVertexDrag(ev, polyPreviewFor!, i, isCart ? 'cartesian' : 'revolve')}
              onpointerenter={(ev) => showSvgTip(ev, polyPreviewFor!, entryIdx, i, pts.length, p)}
              onpointermove={(ev) => { polyDragMove(ev); moveSvgTip(ev); }}
              onpointerleave={() => hideSvgTip(polyPreviewFor!, entryIdx)}
              onpointerup={polyDragEnd}>
            </circle>
            <!-- Point-order markers: green ring + "1" on the FIRST vertex,
                 orange ring + count on the LAST. Non-interactive. -->
            {#if i === 0}
              <circle cx={p[0]} cy={p[1]} r={dotR * 1.8} fill="none" stroke="#16a34a" stroke-width={dotR * 0.45} pointer-events="none"/>
              <text x={p[0] + dotR * 2.4} y={p[1] - dotR * 1.6} fill="#15803d" font-size={dotR * 3.4} font-weight="700" pointer-events="none" style="paint-order: stroke" stroke="#fff" stroke-width={dotR * 0.7}>1</text>
            {:else if i === pts.length - 1}
              <circle cx={p[0]} cy={p[1]} r={dotR * 1.8} fill="none" stroke="#ea580c" stroke-width={dotR * 0.45} pointer-events="none"/>
              <text x={p[0] + dotR * 2.4} y={p[1] - dotR * 1.6} fill="#c2410c" font-size={dotR * 3.4} font-weight="700" pointer-events="none" style="paint-order: stroke" stroke="#fff" stroke-width={dotR * 0.7}>{pts.length}</text>
            {/if}
          {/each}
        </g>
      </svg>
      <!-- Bottom-right resize grip — drag to grow/shrink the popup
           diagonally. Persists size to localStorage on release. -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="ge-poly-preview-grip"
        onpointerdown={startPolyPreviewResize}
        onpointermove={polyPreviewResizeMove}
        onpointerup={polyPreviewResizeEnd}>↘</div>
    </div>
  {/if}

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

  /* ─── Canvas-settings popover (Flowbite-style compact dropdown) ─────── */
  /* Backdrop covers the viewport so an outside click closes the menu.
     `position: fixed` matches the menu's own fixed positioning so we don't
     need to chase a positioned ancestor — works the same whether mounted
     standalone (/graph-editor) or as a /primitives tab body. */
  .ge-canvas-menu-shade {
    position: fixed; inset: 0;
    z-index: 99;
  }
  /* ✨ generate popover — shares the .ge-canvas-menu shell; violet accents
     match the rest of the AI/parametric family. */
  .ge-vrail-btn.ai { color: #6d28d9; }
  .ge-vrail-btn.ai:hover, .ge-vrail-btn.ai.on { background: #ede9fe; color: #4c1d95; border-color: #a78bfa; }
  .ge-ai-menu {
    padding: 8px; gap: 6px;
    /* User-resizable via the native bottom-right grip; width persisted
       to localStorage (ge-ai-menu-w). overflow:hidden is required for
       CSS resize to engage. */
    resize: horizontal; overflow: hidden;
    min-width: 264px; max-width: 720px;
  }
  .ge-ai-title { font: 700 12px Arial; color: #4c1d95; }
  .ge-ai-hint { font: 11px Arial; color: #6b7280; line-height: 1.45; }
  .ge-ai-hint em { color: #5b21b6; font-style: normal; }
  .ge-ai-input {
    width: 100%; box-sizing: border-box; resize: vertical;
    padding: 5px 8px; font: 12px ui-monospace, monospace;
    border: 1px solid #c4b5fd; border-radius: 4px; background: #faf5ff;
  }
  .ge-ai-input:focus { outline: 1px solid #6d28d9; background: #fff; }
  .ge-ai-input:disabled { opacity: 0.6; }
  .ge-ai-actions { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .ge-ai-go {
    padding: 4px 12px; font: 600 12px Arial; cursor: pointer;
    background: #6d28d9; color: #fff; border: 1px solid #5b21b6; border-radius: 4px;
  }
  .ge-ai-go:hover:not(:disabled) { background: #5b21b6; }
  .ge-ai-go:disabled { opacity: 0.5; cursor: default; }
  .ge-ai-err { font: 10px Arial; color: #b91c1c; }
  .ge-ai-from { font: 10px Arial; color: #6b7280; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ge-canvas-menu {
    position: fixed;
    background: #fff; border: 1px solid #d6d3d1; border-radius: 6px;
    padding: 4px; width: 200px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.12), 0 2px 4px rgba(0,0,0,0.06);
    z-index: 100; display: flex; flex-direction: column;
  }
  /* Menu row — uniform height + horizontal layout (icon + label),
     matches the Flowbite DropdownItem visual rhythm. */
  .ge-cm-row {
    display: flex; align-items: center; gap: 8px;
    width: 100%; padding: 6px 10px; box-sizing: border-box;
    background: transparent; border: 0; border-radius: 4px; cursor: pointer;
    font: 500 12px Arial; color: #1f2937;
    text-align: left;
  }
  .ge-cm-row:hover { background: #f3f4f6; color: #0c4a6e; }
  .ge-cm-row.check { cursor: pointer; user-select: none; }
  .ge-cm-row.check input { margin: 0; cursor: pointer; accent-color: #cc2222; }
  .ge-cm-icon { width: 16px; text-align: center; font-size: 13px; line-height: 1; }
  .ge-cm-label { flex: 1 1 auto; }
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
  .ge-profile-2d svg circle,
  .ge-poly-preview-svg circle {
    cursor: grab;
    touch-action: none;
    transition: stroke-width 80ms ease, stroke 80ms ease;
    stroke: transparent;
    stroke-width: 0;
  }
  .ge-profile-2d svg circle:hover,
  .ge-poly-preview-svg circle:hover {
    stroke: rgba(153, 27, 27, 0.28);
    stroke-width: 0.012em;
    /* Stroke-width in em scales with the parent's font-size — not the SVG
       viewBox. The numeric value here is tuned against the path stroke
       width (sw) which is bbox-relative; the resulting halo reads
       proportional at common card sizes. */
  }
  .ge-profile-2d svg circle:active,
  .ge-poly-preview-svg circle:active { cursor: grabbing; }
  .ge-profile-2d svg circle.locked,
  .ge-poly-preview-svg circle.locked { cursor: not-allowed; opacity: 0.7; }
  .ge-profile-2d svg circle.locked:hover,
  .ge-poly-preview-svg circle.locked:hover { stroke: transparent; stroke-width: 0; }
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

  .ge-canvas { width: 100%; height: 100%; background: #fafaf9; cursor: grab; touch-action: none; }
  .ge-canvas.dragging { cursor: grabbing; }

  .ge-node-bg { fill: #fff; stroke: #0369a1; stroke-width: 2; cursor: grab; touch-action: none; }
  .ge-node-bg.method { fill: #fef3c7; stroke: #d97706; stroke-width: 2; }
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
  .ge-repeat-child { font: 600 12px ui-monospace, monospace; fill: #831843; }
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
  /* Reorder popover table */
  .ge-container-pop { min-width: 340px; max-width: 480px; padding: 8px 6px 4px; }
  .ge-container-table { width: 100%; border-collapse: collapse; font: 11px Arial; }
  .ge-container-table th { text-align: left; padding: 4px 6px; font: 600 10px Arial; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #e5e7eb; }
  .ge-container-table td { padding: 4px 6px; border-bottom: 1px solid #f3f4f6; vertical-align: middle; }
  .ge-cp-idx { width: 24px; color: #9ca3af; font: 600 11px ui-monospace, monospace; }
  .ge-cp-name { font: 600 11px ui-monospace, monospace; color: #0c4a6e; }
  .ge-cp-kind { font: 10px ui-monospace, monospace; color: #6b7280; }
  .ge-cp-ref { width: 64px; }
  .ge-cp-ref-input { width: 56px; box-sizing: border-box; padding: 2px 4px; font: 11px ui-monospace, monospace; text-align: right; border: 1px solid #d1d5db; border-radius: 3px; color: #0c4a6e; background: #fff; }
  .ge-cp-ref-input::placeholder { color: #b0b7c0; font-style: italic; }
  .ge-cp-ref-input:focus { outline: none; border-color: #0ea5e9; }
  .ge-cp-count { width: 56px; }
  .ge-cp-count-input { width: 48px; box-sizing: border-box; padding: 2px 4px; font: 11px ui-monospace, monospace; text-align: right; border: 1px solid #d1d5db; border-radius: 3px; color: #166534; background: #fff; }
  .ge-cp-count-input::placeholder { color: #b0b7c0; font-style: italic; }
  .ge-cp-count-input:focus { outline: none; border-color: #22c55e; }
  .ge-cp-order { width: 56px; white-space: nowrap; }
  .ge-cp-arrow { background: transparent; border: 1px solid #d1d5db; color: #6b7280; padding: 1px 5px; font: 10px Arial; cursor: pointer; border-radius: 3px; margin-right: 2px; }
  .ge-cp-arrow:hover:not(:disabled) { background: #f3f4f6; color: #111827; }
  .ge-cp-arrow:disabled { opacity: 0.3; cursor: default; }
  .ge-cp-del { width: 24px; text-align: right; }
  .ge-cp-remove { background: transparent; border: 0; font: 14px Arial; color: #b91c1c; cursor: pointer; padding: 0 4px; }
  .ge-cp-remove:hover { color: #7f1d1d; }
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
  /* Floating 2D-preview popup — fixed position next to the 👁 button.
     Useful when the right pane is showing 3D BAKE (because a revolve
     is consuming the polygon) and the user still wants to see the
     underlying 2D shape. */
  .ge-poly-preview-shade { position: fixed; inset: 0; z-index: 99; }
  .ge-poly-preview {
    /* Width + height set inline from polyPreviewSize. min-width/min-height
       enforce the resize-grip floor in case the inline values get out of
       sync with the helper clamps. */
    position: fixed; min-width: 160px; min-height: 160px;
    background: #fff; border: 1px solid #d6d3d1; border-radius: 8px;
    box-shadow: 0 6px 18px rgba(0,0,0,0.12), 0 2px 4px rgba(0,0,0,0.06);
    z-index: 100; display: flex; flex-direction: column;
    overflow: hidden;
  }
  /* Drag-resize grip — bottom-right corner. 14×14 hit area + a faint
     ↘ glyph that brightens on hover. Slate by default, violet on hover
     so it matches the pin's accent palette. */
  .ge-poly-preview-grip {
    position: absolute; right: 1px; bottom: 1px;
    width: 14px; height: 14px; padding: 0;
    display: flex; align-items: center; justify-content: center;
    font: 10px Arial; color: #94a3b8;
    cursor: nwse-resize; user-select: none;
    z-index: 1;
  }
  .ge-poly-preview-grip:hover { color: #6d28d9; }
  .ge-poly-preview-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 6px 10px; border-bottom: 1px solid #f1f5f9;
    font: 600 11px Arial; color: #57534e;
  }
  .ge-poly-preview-count { white-space: nowrap; }
  .ge-poly-preview-spacer { flex: 1 1 auto; }
  /* Drag grip on the popover's title bar — pick-up affordance for the
     drag-anywhere flow (2026-06-11). Tight 14×16 box on the LEFT of
     the head so it reads as "handle"; cursor:grab on hover, grabbing
     during drag. Light grey dots until hovered. */
  .ge-poly-preview-grab {
    display: inline-flex; align-items: center; justify-content: center;
    width: 14px; height: 16px;
    margin-right: 4px;
    font: 700 9px ui-monospace, monospace; color: #94a3b8;
    line-height: 1; letter-spacing: -1px;
    cursor: grab; user-select: none;
    border-radius: 3px;
    transition: color 100ms, background 100ms;
  }
  .ge-poly-preview-grab:hover { color: #1f2937; background: #f1f5f9; }
  .ge-poly-preview-grab:active { cursor: grabbing; }
  /* Snap-back button — sits next to the pin icon, ↩ glyph reads as
     "send back". Tight 18×18 to match the pin/close affordances. */
  .ge-poly-preview-snap {
    width: 22px; height: 18px; padding: 0;
    background: transparent; border: 0; cursor: pointer;
    font: 600 12px Arial; color: #94a3b8; line-height: 1; opacity: 0.7;
    transition: opacity 100ms, color 100ms;
  }
  .ge-poly-preview-snap:hover { opacity: 1; color: #0c4a6e; }
  /* Drawing toolbar (#155) — small flat buttons left of the pin/close,
     freeze-then-zoom + add/delete vertex controls. Tight 18 × 18 with
     a faint hover wash; matches the inspector chrome. */
  .ge-poly-preview-toolbar {
    display: flex; align-items: center; gap: 1px;
    margin: 0 6px 0 8px;
  }
  .ge-poly-tb-btn {
    height: 18px; min-width: 18px; padding: 0 4px;
    background: transparent; border: 1px solid transparent; border-radius: 3px;
    font: 600 11px Arial; color: #57534e; line-height: 1; cursor: pointer;
    transition: background 80ms, border-color 80ms, color 80ms;
  }
  .ge-poly-tb-btn:hover { background: #f1f5f9; border-color: #cbd5e1; color: #1f2937; }
  .ge-poly-tb-btn:active { background: #e2e8f0; }
  /* Armed state — green for insert, red for delete. Bold border so the
     user has a clear "this mode is active" signal even when their mouse
     is on the SVG canvas. */
  .ge-poly-tb-mode.on { background: #dcfce7; border-color: #16a34a; color: #15803d; }
  .ge-poly-tb-mode.on:hover { background: #bbf7d0; }
  .ge-poly-tb-mode.del.on { background: #fee2e2; border-color: #b91c1c; color: #7f1d1d; }
  .ge-poly-tb-mode.del.on:hover { background: #fecaca; }
  .ge-poly-tb-sep {
    width: 1px; height: 12px; background: #e2e8f0; margin: 0 4px;
  }
  /* Mode cursors over the SVG canvas. Insert mode = `copy` so the user
     sees a "+ landing" hint when hovering an edge; delete mode = `crosshair`
     plus a soft red wash so vertex circles read as "armed for deletion". */
  .ge-poly-preview-svg.insert-mode { cursor: copy; background: #f0fdf4; }
  .ge-poly-preview-svg.delete-mode { cursor: crosshair; background: #fef2f2; }
  .ge-poly-preview-svg.delete-mode circle { cursor: not-allowed; }
  /* Pin toggle — when ON, the popup persists across canvas clicks so the
     user can edit polygon coords with the SVG live in the corner. */
  .ge-poly-preview-pin {
    width: 22px; height: 18px; padding: 0;
    background: transparent; border: 0; cursor: pointer;
    font: 11px Arial; color: #94a3b8; line-height: 1; opacity: 0.55;
    transition: opacity 100ms, color 100ms;
  }
  .ge-poly-preview-pin:hover { opacity: 1; color: #57534e; }
  .ge-poly-preview-pin.on { opacity: 1; color: #6d28d9; transform: rotate(-30deg); }
  .ge-poly-preview-pin.on:hover { color: #5b21b6; }
  /* Pinned popup state — slightly thicker border + violet accent so the
     user has a clear visual signal the popup is sticky. */
  .ge-poly-preview.pinned {
    border-color: #a78bfa; box-shadow: 0 6px 18px rgba(109, 40, 217, 0.18), 0 2px 4px rgba(109, 40, 217, 0.10);
  }
  .ge-poly-preview-close {
    width: 18px; height: 18px; padding: 0;
    background: transparent; border: 0; cursor: pointer;
    font: 14px Arial; color: #b91c1c; line-height: 1;
  }
  .ge-poly-preview-close:hover { background: #fee2e2; border-radius: 3px; }
  .ge-poly-preview-svg {
    flex: 1 1 auto; min-height: 0; width: 100%;
    background: #fafaf9; display: block;
  }
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
  /* ─── Sketch card (plan M.1) ─────────────────────────────────────────── */
  .ge-node-bg.sketch { fill: #faf5ff; stroke: #9333ea; }
  .ge-sketch { font: 11px ui-monospace, monospace; color: #1f2937; display: flex; flex-direction: column; height: 100%; min-height: 0; }
  /* Sketch op rows mirror the polygon: line/spline = two STACKED sub-rows
     (r over z) inside a fixed-height vtx so the SVG wire sockets (cy =
     rowTop+12 / +31) line up; corner ops are one short row. No margins —
     row height MUST equal sketchEntryH or the sockets drift. */
  .ge-sketch-ops { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
  .ge-sketch-vtx { box-sizing: border-box; display: flex; flex-direction: column; justify-content: center; gap: 1px; padding: 0 2px 0 4px; margin: 0; border: 1px solid #e9d5ff; border-radius: 4px; background: rgba(250,245,255,0.6); }
  .ge-sketch-vtx.corner { background: rgba(243,232,255,0.85); border-color: #d8b4fe; }
  /* Row of the point currently being edited in the coordinate popover — amber
     ring to match the popover's amber chrome + the canvas point's edit state. */
  .ge-sketch-vtx.editing { border-color: #f59e0b; background: rgba(254,243,199,0.7); box-shadow: 0 0 0 1px #f59e0b; }
  .ge-sketch-srow { display: flex; align-items: center; gap: 3px; height: 18px; }
  .ge-sketch-axis { width: 40px; flex: none; font: 700 9px ui-monospace, monospace; color: #7c3aed; text-align: right; white-space: nowrap; }
  /* clickable abs/Δ toggle variant — used on line/spline coord rows */
  button.ge-sketch-axis { border: none; background: none; padding: 0; cursor: pointer; }
  button.ge-sketch-axis:hover { text-decoration: underline; }
  .ge-sketch-axis.rel { color: #ea580c; }   /* relative (Δ) coords */
  .ge-sketch-axis.spline { color: #0891b2; }
  .ge-sketch-axis.corner { color: #0e7490; }      /* fillet */
  .ge-sketch-axis.corner.chamfer { color: #b45309; }
  .ge-sketch-in { width: 100%; min-width: 0; padding: 1px 4px; font: 11px ui-monospace, monospace; border: 1px solid #d6d3d1; border-radius: 2px; box-sizing: border-box; cursor: text; }
  .ge-sketch-in.wide { flex: 1 1 auto; }
  .ge-sketch-in:hover { background: #faf5ff; }
  .ge-sketch-in:focus { outline: 1px solid #7c3aed; background: #fff; }
  .ge-sketch-btn { width: 14px; height: 17px; padding: 0; flex: none; background: #fff; border: 1px solid #d6d3d1; border-radius: 2px; font: 8px Arial; color: #57534e; cursor: pointer; display: flex; align-items: center; justify-content: center; }
  .ge-sketch-btn:hover:not(:disabled) { background: #f3e8ff; color: #6b21a8; }
  .ge-sketch-btn:disabled { opacity: 0.35; cursor: default; }
  .ge-sketch-btn.del:hover:not(:disabled) { background: #fee2e2; color: #991b1b; }
  .ge-sketch-foot { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 4px; }
  .ge-sketch-add { padding: 2px 6px; font: 600 10px Arial; background: #f3e8ff; color: #6b21a8; border: 1px solid #d8b4fe; border-radius: 3px; cursor: pointer; }
  .ge-sketch-add:hover { background: #e9d5ff; }
  /* ─── Full-tab sketch editor (plan M.2) ──────────────────────────────── */
  .ge-sketch-edit-btn { font: 13px system-ui; fill: #7c3aed; cursor: pointer; }
  .ge-sketch-edit-btn:hover { fill: #5b21b6; }
  .ge-sketch-editor { position: absolute; inset: 0; z-index: 60; background: #fbfbfd; display: flex; flex-direction: column; }
  /* TOP horizontal tool palette (sketch items run left→right across the top). */
  .ge-sketch-vtools { display: flex; flex-direction: row; align-items: center; gap: 4px; padding: 2px 8px; border-bottom: 1px solid #e2e8f0; background: #fff; flex: 0 0 auto; }
  .ge-stool { width: 25px; height: 22px; padding: 0; display: flex; align-items: center; justify-content: center; background: #fff; border: 1px solid #d6d3d1; border-radius: 5px; font: 13px ui-monospace, monospace; color: #57534e; cursor: pointer; }
  .ge-stool:hover { background: #f3e8ff; color: #6b21a8; border-color: #c4b5fd; }
  .ge-stool.on { background: #ede9fe; color: #5b21b6; border-color: #a78bfa; }
  .ge-stool.done { width: auto; height: 24px; padding: 0 12px; font: 600 12px Arial; color: #15803d; border-color: #6ee7b7; }
  .ge-stool.done:hover { background: #d1fae5; }
  .ge-stool-sep { width: 1px; height: 16px; background: #e2e8f0; margin: 0 3px; }
  .ge-stool-label { font: 600 12px Arial; color: #6b21a8; padding: 0 4px; white-space: nowrap; }
  /* DRAGGABLE floating top bar (status + corner dial + Done). */
  .ge-sketch-topbar {
    position: absolute; z-index: 5; display: flex; align-items: center; gap: 6px;
    padding: 5px 8px; background: rgba(255,255,255,0.96); border: 1px solid #e2e8f0;
    border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.12);
  }
  .ge-sketch-grip { cursor: grab; touch-action: none; color: #94a3b8; font-size: 14px; line-height: 1; padding: 0 2px; user-select: none; }
  .ge-sketch-grip:active { cursor: grabbing; }
  .ge-sketch-dial { display: flex; align-items: center; gap: 5px; }
  .ge-sketch-dial-lbl { font: 600 11px ui-monospace, monospace; color: #0e7490; white-space: nowrap; }
  .ge-sketch-range { width: 110px; accent-color: #0891b2; touch-action: none; }
  .ge-sketch-num { width: 56px; font: 12px ui-monospace, monospace; padding: 2px 4px; border: 1px solid #cbd5e1; border-radius: 4px; }
  .ge-sketch-wire-hint { font: 11px Arial; color: #b45309; white-space: nowrap; }
  .ge-sketch-bound { font: 600 11px ui-monospace, monospace; color: #92400e; background: #fef3c7; border: 1px solid #f59e0b; border-radius: 9999px; padding: 1px 8px; }
  /* S.2: floating cards overlay — covers the whole editor area but is
     pointer-events:none so the 2D canvas underneath stays drawable. */
  .ge-sketch-side { position: absolute; inset: 0; z-index: 4; pointer-events: none; }
  .ge-sketch-cards { position: absolute; inset: 0; width: 100%; height: 100%; display: block; pointer-events: none; touch-action: none; }
  /* Only the card bodies (+ their sockets/inputs) capture pointer events. */
  .ge-sketch-cards g.card { pointer-events: auto; }
  /* Transparent title-bar hit area — drags the card. */
  .ge-sketch-card-title { fill: transparent; cursor: grab; }
  .ge-sketch-card-title:active { cursor: grabbing; }
  .ge-sketch-mini-hd { font: 700 10px Arial; letter-spacing: 0.5px; color: #92400e; padding: 8px 8px 4px; }
  .ge-sketch-mini { width: 100%; height: auto; display: block; touch-action: none; }
  .ge-sketch-mini-empty { font: 11px Arial; fill: #94a3b8; }
  /* ƒ button on a sketch coord row — opens the expression popover. */
  .ge-sketch-fx { width: 16px; height: 17px; padding: 0; flex: none; background: #fff; border: 1px solid #d6d3d1; border-radius: 2px; font: 700 11px serif; color: #57534e; cursor: pointer; display: flex; align-items: center; justify-content: center; }
  .ge-sketch-fx:hover { background: #ede9fe; color: #5b21b6; border-color: #c4b5fd; }
  .ge-sketch-fx.on { background: #ede9fe; color: #5b21b6; border-color: #a78bfa; }
  .ge-sketch-resolved { font: 11px ui-monospace, monospace; color: #64748b; }
  .ge-sketch-dial-x.untie { border-color: #fbbf24; color: #b45309; }
  .ge-sketch-dial-x.untie:hover { background: #fef3c7; }
  .ge-sketch-dial-x { width: 20px; height: 20px; padding: 0; background: #fff; border: 1px solid #fca5a5; border-radius: 4px; color: #b91c1c; cursor: pointer; font: 11px Arial; }
  .ge-sketch-dial-x:hover { background: #fee2e2; }
  .ge-sketch-stage { flex: 1 1 auto; min-height: 0; position: relative; display: flex; }
  .ge-sketch-svg { flex: 1 1 auto; width: 100%; height: 100%;
    background:
      linear-gradient(#eef2f6 1px, transparent 1px) 0 0 / 24px 24px,
      linear-gradient(90deg, #eef2f6 1px, transparent 1px) 0 0 / 24px 24px, #fbfbfd; }
  .ge-sketch-svg { cursor: grab; touch-action: none; }
  .ge-sketch-svg.tool { cursor: crosshair; }
  .ge-sketch-svg.panning { cursor: grabbing; }
  .ge-sk-anchor { cursor: grab; touch-action: none; }
  .ge-sk-anchor:hover { stroke: #fde68a; }
  .ge-sk-anchor.locked { cursor: not-allowed; opacity: 0.6; }
  .ge-sk-spt { cursor: grab; touch-action: none; }
  .ge-sk-spt:hover { stroke: #fde68a; }
  /* Per-point spline delete hit target (× glyph rides on top, pointer-events:none). */
  .ge-sk-spt-del-hit { fill: #dc2626; stroke: #fff; stroke-width: 0.4px; cursor: pointer; touch-action: none; }
  .ge-sk-spt-del-hit:hover { fill: #b91c1c; }
  /* Bottom-right resize grip on the sketch card. */
  .ge-sketch-resize-grip { fill: #c4b5fd; cursor: nwse-resize; touch-action: none; }
  .ge-sketch-resize-grip:hover { fill: #a78bfa; }
  /* Standalone Done tick — pinned top-right of the sketcher, above everything. */
  .ge-sketch-done-tick {
    position: absolute; top: 10px; right: 14px; z-index: 10;
    width: 34px; height: 34px; padding: 0; display: flex; align-items: center; justify-content: center;
    background: #ecfdf5; color: #15803d; border: 1px solid #6ee7b7; border-radius: 9999px;
    font: 700 17px Arial; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.14);
  }
  .ge-sketch-done-tick:hover { background: #d1fae5; border-color: #34d399; }
  .ge-sketch-hint { position: absolute; left: 12px; bottom: 10px; font: 11px Arial; color: #6b7280; background: rgba(255,255,255,0.85); padding: 3px 8px; border-radius: 4px; pointer-events: none; }
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
  .ge-arg-row { display: grid; grid-template-columns: 70px 1fr; gap: 4px; align-items: center; padding: 0; height: 22px; box-sizing: border-box; }
  /* mv/rot axis rows live inside .ge-xyz — collapse the key column to
     14 px and drop the gap so the input box sits right next to the
     rx/ry/rz label, no wasted horizontal space. */
  .ge-xyz .ge-arg-row { grid-template-columns: 14px 1fr; gap: 2px; }
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
  .ge-inline-xform { font: 11px Arial; color: #1f2937; line-height: 1.4; padding: 4px 0 0; border-top: 1px dashed #c4b5fd; }
  .ge-inline-xform.mv  { color: #5b21b6; }
  .ge-inline-xform.rot { color: #831843; border-top-color: #f9a8d4; }
  .ge-inline-label { font: 600 10px Arial; color: inherit; text-transform: uppercase; letter-spacing: 0.5px; padding: 0 0 2px; }
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
  /* Combined right pane (tabbed): bake + source in one column with a tab strip.
     30 % default width gives the canvas 70 % to show the graph. */
  .ge-right-pane { display: grid; grid-template-rows: auto 1fr; overflow: hidden; border-left: 1px solid #e5e7eb; }
  .ge-pane-tabs { display: flex; gap: 0; background: #f5f5f4; border-bottom: 1px solid #e7e5e4; }
  .ge-pane-tab { flex: 1 1 auto; padding: 6px 12px; font: 600 11px Arial; color: #78716c; background: transparent; border: 0; border-bottom: 2px solid transparent; cursor: pointer; text-transform: uppercase; letter-spacing: 0.5px; transition: background 0.12s, color 0.12s, border-color 0.12s; }
  .ge-pane-tab code { font: 11px ui-monospace, monospace; color: #57534e; text-transform: none; letter-spacing: 0; }
  .ge-pane-tab:hover { background: #fafaf9; color: #1c1917; }
  .ge-pane-tab.active { color: #0c4a6e; border-bottom-color: #0369a1; background: #fff; }
  .ge-pane-tab.active code { color: #0c4a6e; }
  .ge-pane-bodies { position: relative; display: grid; min-height: 0; overflow: hidden; }
  .ge-pane-bodies > .ge-bake-body,
  .ge-pane-bodies > .ge-source-body,
  .ge-pane-bodies > .ge-md-body { grid-area: 1 / 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; }
  /* SRC tab — filename header above the <pre>. Light row, monospace
     filename + a faded hint reminding the user the file is generated. */
  .ge-source-header {
    display: flex; align-items: center; justify-content: space-between;
    gap: 8px; padding: 6px 10px;
    border-bottom: 1px solid #e5e7eb; background: #f8fafc;
  }
  .ge-source-header code { font: 12px ui-monospace, monospace; color: #0c4a6e; }
  .ge-source-header-hint { font: 10px Arial; color: #78716c; }
  /* MD tab — toolbar row + full-pane textarea. Stays mounted while hidden
     so the user can flip between SRC/MD without losing in-progress typing. */
  .ge-md-body { padding: 8px; gap: 6px; }
  .ge-md-toolbar {
    display: flex; align-items: center; justify-content: space-between;
    gap: 8px; font: 10px Arial; color: #78716c;
  }
  .ge-md-toolbar code { font-family: ui-monospace, monospace; color: #44403c; }
  .ge-md-toolbar-actions { display: flex; align-items: center; gap: 8px; }
  .ge-md-count { flex: 0 0 auto; color: #a8a29e; }
  /* ✨ AI button — small violet pill, the established "smart / generated"
     colour in the editor (matches ƒ promote-to-expression chips). */
  .ge-md-ai-btn {
    background: #ede9fe; color: #5b21b6;
    border: 1px solid #c4b5fd; border-radius: 4px;
    padding: 2px 8px; font: 600 11px Arial; cursor: pointer;
    transition: background 100ms, color 100ms;
  }
  .ge-md-ai-btn:hover { background: #c4b5fd; color: #3b0764; }
  .ge-md-ai-btn:disabled { opacity: 0.6; cursor: wait; }
  .ge-md-textarea {
    flex: 1 1 auto; min-height: 0; resize: none;
    padding: 8px 10px;
    font: 12px ui-monospace, monospace; line-height: 1.5; color: #1f2937;
    background: #fafaf9; border: 1px solid #d6d3d1; border-radius: 4px;
    box-sizing: border-box;
  }
  .ge-md-textarea:focus { outline: 1px solid #0369a1; background: #fff; }
  .ge-pane-bodies > .hidden { display: none; }
  .ge-legacy-banner { padding: 8px 12px; font: 11px ui-monospace, monospace; line-height: 1.5; color: #78350f; background: #fef3c7; border-bottom: 1px solid #fbbf24; }
  .ge-legacy-banner strong { color: #92400e; }
  .ge-legacy-banner a { color: #0369a1; }
  .ge-pane-head { padding: 6px 12px; font: 600 11px Arial; color: #57534e; text-transform: uppercase; letter-spacing: 0.5px; background: #f5f5f4; border-bottom: 1px solid #e7e5e4; }
  .ge-pane-head code { font: 11px ui-monospace, monospace; color: #0c4a6e; text-transform: none; letter-spacing: 0; }
  .ge-bake-body { overflow: hidden; min-height: 0; }
  .ge-empty { padding: 20px; text-align: center; color: #9ca3af; font: 12px Arial; }
  .ge-err { padding: 20px; color: #b91c1c; font: 12px ui-monospace, monospace; display: flex; flex-direction: column; gap: 10px; }
  .ge-err-hint { padding: 10px 12px; background: #fef3c7; color: #78350f; border: 1px solid #fbbf24; border-radius: 4px; font: 11px Arial; line-height: 1.4; }
  .ge-err-hint code { font: 11px ui-monospace, monospace; background: rgba(0,0,0,0.06); padding: 1px 5px; border-radius: 2px; }
  .ge-err-hint-actions { display: flex; align-items: center; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
  .ge-err-hint-or { font: 11px Arial; color: #92400e; }
  .ge-err-restart-btn { font: 600 11px Arial; color: #fff; background: #d97706; border: 1px solid #b45309; border-radius: 4px; padding: 4px 10px; cursor: pointer; transition: background 0.12s; }
  .ge-err-restart-btn:hover:not(:disabled) { background: #b45309; }
  .ge-err-restart-btn:disabled { opacity: 0.7; cursor: progress; }
  .ge-err-restart-stat { margin-top: 6px; font: 11px ui-monospace, monospace; color: #92400e; }
  /* Bake cache status row + Rebuild button */
  .ge-bake-meta { display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: #fafaf9; border-top: 1px solid #e7e5e4; font: 11px Arial; }
  .ge-bake-meta-spacer { flex: 1 1 auto; }
  .ge-cache-badge { padding: 2px 8px; border-radius: 12px; font: 600 10px ui-monospace, monospace; }
  .ge-cache-badge.cached { background: #d1fae5; color: #065f46; border: 1px solid #6ee7b7; }
  .ge-cache-badge.fresh { background: #fef3c7; color: #92400e; border: 1px solid #fde68a; }
  .ge-cache-badge.skipped { background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; }
  .ge-rebuild-btn { font: 600 11px Arial; color: #1c1917; background: #fff; border: 1px solid #d6d3d1; border-radius: 4px; padding: 3px 10px; cursor: pointer; transition: background 0.12s; }
  .ge-rebuild-btn:hover:not(:disabled) { background: #f5f5f4; }
  .ge-rebuild-btn:disabled { opacity: 0.7; cursor: progress; }
  .ge-rebuild-stat { font: 11px ui-monospace, monospace; color: #57534e; }
  /* Lazy cutaway load button — sits next to the "cutaway off (perf)" badge */
  .ge-cutaway-load-btn { font: 600 10px Arial; color: #fff; background: #b91c1c; border: 1px solid #991b1b; border-radius: 4px; padding: 2px 8px; cursor: pointer; transition: background 0.12s; }
  .ge-cutaway-load-btn:hover:not(:disabled) { background: #991b1b; }
  .ge-cutaway-load-btn:disabled { opacity: 0.7; cursor: progress; }
  .ge-source { margin: 0; padding: 10px 14px; font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; color: #1f2937; background: #fafaf9; overflow: auto; white-space: pre; }
  .ge-source-pane { border-left: 1px solid #e5e7eb; }

  .ge-picker-shade { position: fixed; inset: 0; background: rgba(0,0,0,0.2); z-index: 100; }
  /* Multi-source ƒ-chip — shown on a Call's arg row when expr references 2+ params */
  .ge-arg-fnchip { display: inline-flex; align-items: center; gap: 2px; flex: 1 1 auto; padding: 1px 6px; font: 600 10px ui-monospace, monospace; background: #fef3c7; color: #78350f; border: 1px solid #f59e0b; border-radius: 9999px; cursor: pointer; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; transition: background 0.12s; }
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
  .ge-profile-pop-empty { padding: 10px; font: 11px Arial; color: #94a3b8; line-height: 1.4; }
  /* Profile picker popover */
  .ge-profile-pop {
    position: fixed; width: 280px; max-height: 360px;
    background: #fff; border: 1px solid #d6d3d1; border-radius: 8px;
    box-shadow: 0 6px 18px rgba(0,0,0,0.10), 0 2px 4px rgba(0,0,0,0.06);
    z-index: 200; display: flex; flex-direction: column;
  }
  .ge-profile-pop-head {
    display: flex; flex-direction: column; gap: 1px;
    padding: 8px 12px; border-bottom: 1px solid #f1f5f9;
  }
  .ge-profile-pop-title { font: 600 11px Arial; color: #5b21b6; text-transform: uppercase; letter-spacing: 0.6px; }
  .ge-profile-pop-hint { font: 10px ui-monospace, monospace; color: #78716c; }
  .ge-profile-pop-list { flex: 1 1 auto; overflow-y: auto; padding: 4px 0; }
  .ge-profile-pop-item {
    display: flex; align-items: center; justify-content: space-between;
    width: 100%; padding: 6px 12px; box-sizing: border-box;
    background: transparent; border: 0; cursor: pointer;
    text-align: left; font: 12px Arial; color: #1f2937;
  }
  .ge-profile-pop-item:hover { background: #f3f4f6; color: #5b21b6; }
  .ge-profile-pop-item.active { background: #ede9fe; color: #4c1d95; font-weight: 600; }
  .ge-profile-pop-item-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ge-profile-pop-item-id { font: 10px ui-monospace, monospace; color: #a8a29e; }
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
