/**
 * wire-state.svelte.ts — the drag-to-wire interaction for the graph editor
 * (modularize K.65, Phase C).
 *
 * `WireState` is a PER-INSTANCE class (one `new WireState(...)` per
 * GraphEditorPane), NOT a module-level `$state` singleton — `/primitives` keeps
 * all tab panes mounted at once (`{#each tabs}` + `class:visible`), and an
 * in-flight wire is per-pane transient state; a singleton would leak the drag
 * across panes. The `$state` lives in class fields (Svelte 5 compiles runes in
 * `.svelte.ts` class fields).
 *
 * The class never closes over a pane's `graph` $state: it is handed `getGraph`
 * / `setGraph` (and `clientToGraph`, which needs the pane's canvasEl/pan/zoom)
 * at construction, and every mutator does `this.setGraph(setX(this.getGraph(),
 * …))`. Methods are ARROW fields so `this` stays bound when they're used as
 * Svelte event handlers regardless of how they're referenced.
 *
 * Tap-to-connect: drag-from-socket-to-socket is unreliable on touch (the drop
 * never registers), so the user can TAP a source socket to ARM a wire then TAP
 * a target to complete it. Always on for coarse (touch) pointers; desktop opts
 * in via the 🔗 toolbar toggle (`connectMode`). The drag path is unchanged for
 * the mouse. The arm/move/up bookkeeping (justArmed/pointerMoved/downAt) lives
 * here; GraphEditorPane's canvas + sketch-stage pointer handlers read/write it.
 */
import {
  setMethodInput,
  setTransformChild,
  setCallArg,
  asParam,
  asExpr,
  setPolygonCoord,
  setPolyRepeatCount,
  setTransformAxisValue,
  setTransformAxis,
  setTxfmnAxis,
  setSketchOpField,
  appendContainerChild,
  setRepeatCount,
  addRepeatChild,
  setRepeatChildAt,
  setExprInputBinding,
  setSplinePointsExpr,
  setWarpPath,
  setWarpChildAt,
  setPartsTableDataInput,
  bindMaterial,
  type Graph,
  type NodeId,
  type MvNode,
  type RotNode,
  type CallNode,
} from '$lib/graph/composition-graph';
import { exprBlockMember } from '$lib/graph/graph-exprs';
import { checkOutputFeeds, slotExpectedType, POLYGON_POINTS, SPLINE_POINTS } from '$lib/graph/wire-check';
import { releaseImplicitCapture } from './pointer-capture';

/** wireFrom is either a node's output socket OR a param's output chip. On
 *  release over an input socket the connection is committed. An Expr-block
 *  output socket additionally carries `outName` (WHICH named output) so a
 *  consumer can reference the matching `<blockvar>_<outName>` emitted const. */
export type WireSource =
  | { kind: 'out'; nodeId: NodeId; outName?: string }
  | { kind: 'param-out'; paramName: string }
  /** A MATERIAL node's output (G-MAT-CARD) — a dedicated kind so a material wire
   *  dropped on a normal arg/socket is silently ignored (no cross-talk with the
   *  expr/geometry `out` channel). Only endWireOnMaterial accepts it. */
  | { kind: 'material-out'; nodeId: NodeId };

export class WireState {
  /** The armed source socket (node output or param output), or null. */
  from = $state<WireSource | null>(null);
  /** The in-flight wire's free end, in graph space (tracks the pointer). */
  mouse = $state<{ x: number; y: number } | null>(null);
  /** Desktop opt-in tap-connect toggle (🔗). */
  connectMode = $state(false);
  /** True on a coarse (touch) pointer — forces tap-connect on. */
  isCoarse = $state(false);
  /** true only for the one pointerup right after arming. */
  justArmed = false;
  /** set once the pointer drags past threshold since arming. */
  pointerMoved = false;
  /** client px where the arming pointerdown happened (drag-vs-tap threshold). */
  downAt = { x: 0, y: 0 };
  /** Plain-language reason the LAST drop was refused (typed-expression-outputs,
   *  Phase B). Null when the last wire was accepted. The shell surfaces it as a
   *  transient message; cleared when a new wire is armed. */
  lastReject = $state<string | null>(null);

  #getGraph: () => Graph;
  #setGraph: (g: Graph) => void;
  #clientToGraph: (cx: number, cy: number) => { x: number; y: number };

  constructor(
    getGraph: () => Graph,
    setGraph: (g: Graph) => void,
    clientToGraph: (cx: number, cy: number) => { x: number; y: number },
  ) {
    this.#getGraph = getGraph;
    this.#setGraph = setGraph;
    this.#clientToGraph = clientToGraph;
  }

  /** connectMode (desktop) OR isCoarse (touch) → tap-to-connect is active. */
  get tapConnect(): boolean { return this.connectMode || this.isCoarse; }

  /** Clear any in-flight wire (source + free end). */
  cancel = () => { this.from = null; this.mouse = null; };

  armWire = (ev: PointerEvent) => {
    this.justArmed = true;
    this.pointerMoved = false;
    this.lastReject = null;            // a fresh wire clears the stale reject hint
    this.downAt = { x: ev.clientX, y: ev.clientY };
  };

  startWire = (ev: PointerEvent, nodeId: NodeId) => {
    ev.stopPropagation();
    releaseImplicitCapture(ev);
    this.from = { kind: 'out', nodeId };
    this.mouse = this.#clientToGraph(ev.clientX, ev.clientY);
    this.armWire(ev);
  };

  startParamWire = (ev: PointerEvent, paramName: string) => {
    ev.stopPropagation();
    releaseImplicitCapture(ev);
    this.from = { kind: 'param-out', paramName };
    this.mouse = this.#clientToGraph(ev.clientX, ev.clientY);
    this.armWire(ev);
  };

  /** Start a wire from an Expr-block OUTPUT socket — carries the named output
   *  so the drop target (a Call arg or another block's input) references the
   *  matching `<blockvar>_<outName>` emitted const. */
  startExprOutWire = (ev: PointerEvent, nodeId: NodeId, outName: string) => {
    ev.stopPropagation();
    releaseImplicitCapture(ev);
    this.from = { kind: 'out', nodeId, outName };
    this.mouse = this.#clientToGraph(ev.clientX, ev.clientY);
    this.armWire(ev);
  };

  /** Start a wire from a MATERIAL node's output socket (G-MAT-CARD). Drop it on
   *  a part's ◑ material socket (endWireOnMaterial) to assign the appearance. */
  startMaterialWire = (ev: PointerEvent, nodeId: NodeId) => {
    ev.stopPropagation();
    releaseImplicitCapture(ev);
    this.from = { kind: 'material-out', nodeId };
    this.mouse = this.#clientToGraph(ev.clientX, ev.clientY);
    this.armWire(ev);
  };

  /** Drop a material wire onto a Call node's ◑ material input socket → bind that
   *  material to the part. Only a `material-out` source binds; anything else is
   *  ignored (a geometry/expr wire can't feed a material slot). */
  endWireOnMaterial = (ev: PointerEvent, callId: NodeId) => {
    ev.stopPropagation();
    const from = this.from;
    if (from?.kind === 'material-out' && from.nodeId !== callId) {
      this.#setGraph(bindMaterial(this.#getGraph(), callId, from.nodeId));
    }
    this.from = null; this.mouse = null;
  };

  endWireOnInput = (ev: PointerEvent, targetId: NodeId, slot: 'obj' | 'arg' | 'child') => {
    ev.stopPropagation();
    const from = this.from;
    if (!from) return;
    // Only node-output wires fit method/transform sockets (those carry shapes).
    if (from.kind !== 'out' || from.nodeId === targetId) { this.from = null; this.mouse = null; return; }
    if (slot === 'obj' || slot === 'arg') {
      this.#setGraph(setMethodInput(this.#getGraph(), targetId, slot, from.nodeId));
    } else {
      this.#setGraph(setTransformChild(this.#getGraph(), targetId, from.nodeId));
    }
    this.from = null; this.mouse = null;
  };

  endWireOnCallArg = (ev: PointerEvent, callId: NodeId, key: string) => {
    ev.stopPropagation();
    const from = this.from;
    if (!from) return;
    if (from.kind === 'param-out') {
      this.#setGraph(setCallArg(this.#getGraph(), callId, key, asParam(from.paramName)));
    } else if (from.kind === 'out' && from.nodeId !== callId) {
      if (from.outName != null) {
        // Structural wire-check (Phase B): block an expr output whose inferred
        // structure can't feed this engine's DATA slot (r_sweep.path wants
        // list<point3>, .section wants list<point2>). Unmodelled slots / unknown
        // structures pass through (conservative — don't over-block).
        const g = this.#getGraph();
        const call = g.nodes[callId] as CallNode | undefined;
        const expect = call?.type === 'call' ? slotExpectedType(call.src, key) : null;
        if (expect) {
          const feed = checkOutputFeeds(g, from.nodeId, from.outName, expect);
          if (!feed.ok) { this.lastReject = feed.reason; this.from = null; this.mouse = null; return; }
        }
        // Wire from an Expr block's named OUTPUT → reference its emitted numeric
        // const `<blockvar>_<outName>` (emitExprBlocks prelude). The arg becomes
        // a plain `expr` ArgValue carrying that identifier.
        this.#setGraph(setCallArg(this.#getGraph(), callId, key, asExpr(exprBlockMember(from.nodeId, from.outName))));
      } else {
        // Wire from another node's OUTPUT into this Call's arg. The only other
        // producer that flows into a Call arg is a Polygon/Sketch node (the
        // profile slot on r_revolve / r_weld_extrude). Encoded as an `expr`
        // ArgValue carrying the `__POLY__<sourceId>` sentinel; composition-emit.ts
        // post-substitutes it with the source node's varName at emit time.
        this.#setGraph(setCallArg(this.#getGraph(), callId, key, asExpr(`__POLY__${from.nodeId}`)));
      }
    }
    this.from = null; this.mouse = null;
  };

  /** Wire a param's output onto a polygon vertex's r or z coord. */
  endWireOnPolygonCoord = (ev: PointerEvent, polygonId: NodeId, idx: number, axis: 'r' | 'z') => {
    ev.stopPropagation();
    const from = this.from;
    if (!from) return;
    if (from.kind === 'param-out') {
      this.#setGraph(setPolygonCoord(this.#getGraph(), polygonId, idx, axis, asParam(from.paramName)));
    } else if (from.kind === 'out' && from.outName != null && from.nodeId !== polygonId) {
      this.#setGraph(setPolygonCoord(this.#getGraph(), polygonId, idx, axis, asExpr(exprBlockMember(from.nodeId, from.outName))));
    }
    this.from = null; this.mouse = null;
  };

  /** Drop a wire onto a PolyRepeatNode's NPts (count) input socket. Wires
   *  `p.<name>` → loop.count. Drops from a node output are ignored (count is
   *  a SCALAR, not a node). */
  endWireOnPolyRepeatCount = (ev: PointerEvent, repeatId: NodeId) => {
    ev.stopPropagation();
    const from = this.from;
    if (!from) return;
    if (from.kind === 'param-out') {
      this.#setGraph(setPolyRepeatCount(this.#getGraph(), repeatId, asParam(from.paramName)));
    } else if (from.kind === 'out' && from.outName != null && from.nodeId !== repeatId) {
      this.#setGraph(setPolyRepeatCount(this.#getGraph(), repeatId, asExpr(exprBlockMember(from.nodeId, from.outName))));
    }
    this.from = null; this.mouse = null;
  };

  /** Drop a wire onto a polygon's repeat-ref row (#157). When the wire's source
   *  is a poly_repeat node's output socket, REPOINT the row to that source. */
  endWireOnPolygonRepeatRef = (ev: PointerEvent, polygonId: NodeId, idx: number) => {
    ev.stopPropagation();
    const from = this.from as any;
    if (!from) return;
    if (from.kind === 'node-out') {
      const g = this.#getGraph();
      const src = g.nodes[from.nodeId];
      if (src && (src as any).type === 'poly_repeat') {
        const poly = g.nodes[polygonId] as any;
        if (poly?.type === 'polygon') {
          const points = [...poly.points];
          points[idx] = { kind: 'repeat-ref', sourceId: from.nodeId };
          this.#setGraph({ ...g, nodes: { ...g.nodes, [polygonId]: { ...poly, points } } });
        }
      }
    }
    this.from = null; this.mouse = null;
  };

  /** Repoint a polygon's expr-list-ref by dragging an expr OUTPUT onto its
   *  socket (#11 drag-to-wire). Structural wire-check (Phase B): the points slot
   *  wants a list of 2D points — a scalar / a 3D-points output is refused with a
   *  plain-language reason; an unknown structure passes (conservative). */
  endWireOnPolygonExprListRef = (ev: PointerEvent, polygonId: NodeId, idx: number) => {
    ev.stopPropagation();
    const from = this.from;
    if (!from || from.kind !== 'out' || from.outName == null) { this.from = null; this.mouse = null; return; }
    const g = this.#getGraph();
    const feed = checkOutputFeeds(g, from.nodeId, from.outName, POLYGON_POINTS);
    if (!feed.ok) { this.lastReject = feed.reason; this.from = null; this.mouse = null; return; }
    const poly = g.nodes[polygonId] as any;
    if (poly?.type === 'polygon' && poly.points[idx]?.kind === 'expr-list-ref') {
      const points = [...poly.points];
      points[idx] = { kind: 'expr-list-ref', sourceId: from.nodeId, output: from.outName };
      this.#setGraph({ ...g, nodes: { ...g.nodes, [polygonId]: { ...poly, points } } });
    }
    this.from = null; this.mouse = null;
  };

  /** Drop a wire onto a spline node's CONTROL-POINTS input socket (TODO #26).
   *  The source must be an expr instance's `list<point>` OUTPUT; wiring it makes
   *  those points the spline's control points (OVERRIDING its manual `points`),
   *  which the spline still smooths + arc-length-resamples. Structural
   *  wire-check: the slot wants a list of points of ANY arity (`list<point2|3>`);
   *  a scalar / plain-number output is refused with a plain-language reason, an
   *  unknown structure passes (conservative). */
  endWireOnSplinePoints = (ev: PointerEvent, splineId: NodeId) => {
    ev.stopPropagation();
    const from = this.from;
    if (!from || from.kind !== 'out' || from.outName == null || from.nodeId === splineId) {
      this.from = null; this.mouse = null; return;
    }
    const g = this.#getGraph();
    const feed = checkOutputFeeds(g, from.nodeId, from.outName, SPLINE_POINTS);
    if (!feed.ok) { this.lastReject = feed.reason; this.from = null; this.mouse = null; return; }
    this.#setGraph(setSplinePointsExpr(g, splineId, asExpr(exprBlockMember(from.nodeId, from.outName))));
    this.from = null; this.mouse = null;
  };

  /** Drop a wire onto a warp node's PATH input socket (#36). The source is a
   *  SplineNode's `path` output (or an expr instance's `list<point>` output); its
   *  emitted const (`_x_<id>_<out>` = exprBlockMember) becomes the warp's `path`
   *  arg, so `warpSpline(child, _x_<id>_path, …)` bends the child along it.
   *  Param-chip drops set the path to `p.<name>`. */
  endWireOnWarpPath = (ev: PointerEvent, warpId: NodeId) => {
    ev.stopPropagation();
    const from = this.from;
    if (!from) return;
    if (from.kind === 'param-out') {
      this.#setGraph(setWarpPath(this.#getGraph(), warpId, asParam(from.paramName)));
    } else if (from.kind === 'out' && from.outName != null && from.nodeId !== warpId) {
      this.#setGraph(setWarpPath(this.#getGraph(), warpId, asExpr(exprBlockMember(from.nodeId, from.outName))));
    }
    this.from = null; this.mouse = null;
  };

  /** Drop a solid onto a warp's i-th SOLID input socket (#36b multi-input). Any
   *  node OUTPUT can be bent; `index === current count` = the "＋ solid" append
   *  slot (grows children[]), else it rebinds that slot. ≥2 solids ⇒ each is warped
   *  SEPARATELY along the shared path (no compose → no fusion). */
  endWireOnWarpSolid = (ev: PointerEvent, warpId: NodeId, index: number) => {
    ev.stopPropagation();
    const from = this.from;
    if (!from) return;
    if (from.kind === 'out' && from.nodeId !== warpId) {
      this.#setGraph(setWarpChildAt(this.#getGraph(), warpId, index, from.nodeId));
    }
    this.from = null; this.mouse = null;
  };

  /** Wire a param's output onto one of a mv/rot's three xyz slots. */
  endWireOnTransformAxis = (ev: PointerEvent, transformId: NodeId, axis: 0 | 1 | 2) => {
    ev.stopPropagation();
    const from = this.from;
    if (!from) return;
    if (from.kind === 'param-out') {
      this.#setGraph(setTransformAxisValue(this.#getGraph(), transformId, axis, asParam(from.paramName)));
    } else if (from.kind === 'out' && from.outName != null && from.nodeId !== transformId) {
      this.#setGraph(setTransformAxisValue(this.#getGraph(), transformId, axis, asExpr(exprBlockMember(from.nodeId, from.outName))));
    }
    this.from = null; this.mouse = null;
  };

  /** Wire a param's output onto one of a txfmn's six axes (rot.xyz / mv.xyz). */
  endWireOnTxfmnAxis = (ev: PointerEvent, txfmnId: NodeId, section: 'rot' | 'mv', axis: 0 | 1 | 2) => {
    ev.stopPropagation();
    const from = this.from;
    if (!from) return;
    if (from.kind === 'param-out') {
      this.#setGraph(setTxfmnAxis(this.#getGraph(), txfmnId, section, axis, asParam(from.paramName)));
    } else if (from.kind === 'out' && from.outName != null && from.nodeId !== txfmnId) {
      this.#setGraph(setTxfmnAxis(this.#getGraph(), txfmnId, section, axis, asExpr(exprBlockMember(from.nodeId, from.outName))));
    }
    this.from = null; this.mouse = null;
  };

  /** Replace a param-wired transform axis with a literal default. */
  unwireTransformAxis = (transformId: NodeId, axis: 0 | 1 | 2, fallback = 0) => {
    const g = this.#getGraph();
    const node = g.nodes[transformId];
    if (!node || (node.type !== 'mv' && node.type !== 'rot')) return;
    const field = node.type === 'mv' ? (node as MvNode).offset : (node as RotNode).rot;
    const cur = field[axis];
    const literal = cur?.kind === 'literal' ? cur.value : (cur?.kind === 'param' ? (g.params[cur.param]?.default ?? fallback) : fallback);
    this.#setGraph(setTransformAxis(g, transformId, axis, typeof literal === 'number' ? literal : fallback));
  };

  /** Wire a param's output onto a sketch op coord/field (r|z|radius|dist). */
  endWireOnSketchCoord = (ev: PointerEvent, sketchId: NodeId, opIdx: number, field: 'r' | 'z' | 'radius' | 'dist') => {
    ev.stopPropagation();
    const from = this.from;
    if (!from) return;
    if (from.kind === 'param-out') {
      this.#setGraph(setSketchOpField(this.#getGraph(), sketchId, opIdx, field, asParam(from.paramName)));
    } else if (from.kind === 'out' && from.outName != null && from.nodeId !== sketchId) {
      this.#setGraph(setSketchOpField(this.#getGraph(), sketchId, opIdx, field, asExpr(exprBlockMember(from.nodeId, from.outName))));
    }
    this.from = null; this.mouse = null;
  };

  /** S.3: wire a param's output onto a POINT's r/z socket on the 2D canvas.
   *  Mirrors endWireOnSketchCoord but invoked from the on-canvas sockets. */
  endWireOnSketchPoint = (ev: PointerEvent, sketchId: NodeId, opIdx: number, axis: 'r' | 'z') => {
    ev.stopPropagation();
    const from = this.from;
    if (!from) return;
    if (from.kind === 'param-out') {
      this.#setGraph(setSketchOpField(this.#getGraph(), sketchId, opIdx, axis, asParam(from.paramName)));
    } else if (from.kind === 'out' && from.outName != null && from.nodeId !== sketchId) {
      this.#setGraph(setSketchOpField(this.#getGraph(), sketchId, opIdx, axis, asExpr(exprBlockMember(from.nodeId, from.outName))));
    }
    this.from = null; this.mouse = null;
  };

  /** Drag-wire target — when a wire ends on a container's slot, append the
   *  source node as a child of that container. Idempotent. */
  endWireOnContainerSlot = (ev: PointerEvent, containerId: NodeId) => {
    const from = this.from;
    if (!from) return;
    ev.stopPropagation();
    this.#setGraph(appendContainerChild(this.#getGraph(), containerId, (from as any).nodeId));
    this.from = null; this.mouse = null;
  };

  /** Drag-wire ending on a Repeat node's count socket — sets the count to a
   *  param (when the source is a param chip). */
  endWireOnRepeatCount = (ev: PointerEvent, repeatId: NodeId) => {
    const from = this.from;
    if (!from) return;
    ev.stopPropagation();
    if (from.kind === 'param-out') {
      this.#setGraph(setRepeatCount(this.#getGraph(), repeatId, asParam(from.paramName)));
    } else if (from.kind === 'out' && from.outName != null && from.nodeId !== repeatId) {
      this.#setGraph(setRepeatCount(this.#getGraph(), repeatId, asExpr(exprBlockMember(from.nodeId, from.outName))));
    }
    this.from = null; this.mouse = null;
  };

  /** Drag-wire ending on a Repeat node's "+ part" slot — APPEND the wire source
   *  as a new repeated part (the Repeat now accepts multiple children, combined
   *  per-iteration via place([...])). Works for any node with an output socket. */
  endWireOnRepeatChild = (ev: PointerEvent, repeatId: NodeId) => {
    const from = this.from;
    if (!from) return;
    ev.stopPropagation();
    this.#setGraph(addRepeatChild(this.#getGraph(), repeatId, (from as any).nodeId));
    this.from = null; this.mouse = null;
  };

  /** Drop a wire onto an Expr block's INPUT socket (B.7 v2, step 1.5). Persists
   *  the binding keyed by the derived input NAME:
   *   - a PARAM-output chip → `{kind:'param'}` (emits `p.<name>`),
   *   - another block's OUTPUT socket → `{kind:'expr'}` referencing its emitted
   *     `<blockvar>_<outName>` const.
   *  Other node outputs (geometry producers) are ignored — a block input is a
   *  SCALAR, not a shape. */
  endWireOnExprInput = (ev: PointerEvent, exprId: NodeId, inputName: string) => {
    ev.stopPropagation();
    const from = this.from;
    if (!from) { this.mouse = null; return; }
    if (from.kind === 'param-out') {
      this.#setGraph(setExprInputBinding(this.#getGraph(), exprId, inputName, asParam(from.paramName)));
    } else if (from.kind === 'out' && from.nodeId !== exprId && from.outName != null) {
      this.#setGraph(setExprInputBinding(this.#getGraph(), exprId, inputName, asExpr(exprBlockMember(from.nodeId, from.outName))));
    }
    this.from = null; this.mouse = null;
  };

  /** Drag-wire ending on an EXISTING part row's socket — rebind that index. */
  endWireOnRepeatChildAt = (ev: PointerEvent, repeatId: NodeId, idx: number) => {
    const from = this.from;
    if (!from) return;
    ev.stopPropagation();
    this.#setGraph(setRepeatChildAt(this.#getGraph(), repeatId, idx, (from as any).nodeId));
    this.from = null; this.mouse = null;
  };

  /** Drop a wire onto a parts_table's external DATA-INPUT socket (#38c). A plain
   *  node OUTPUT whose runtime value is a list<record> — a `list`/`stack`/`group`
   *  container, a `parts_map`, another `parts_table` aggregate, a `repeat` — feeds
   *  the table's rows (each element → one row); the table then SOURCES its rows from
   *  it instead of the inline rows. The reference is the source node's emitted VAR,
   *  so an EXPR-block output (which carries `outName` and lives in a prelude const,
   *  not a node var) is IGNORED, as are param-chip / material drops. */
  endWireOnPartsTableData = (ev: PointerEvent, tableId: NodeId) => {
    ev.stopPropagation();
    const from = this.from;
    if (from?.kind === 'out' && from.outName == null && from.nodeId !== tableId) {
      this.#setGraph(setPartsTableDataInput(this.#getGraph(), tableId, from.nodeId));
    }
    this.from = null; this.mouse = null;
  };
}
