/**
 * profile-preview-state.svelte.ts — PER-INSTANCE state + resolve effect for the
 * right-pane 2D profile PREVIEW (GEP modularize #940 CUT 2; mirrors
 * PolyPreviewState / SketchState / WireState).
 *
 * Owns the profile-mode preview cluster: the resolved polygon points
 * (`profilePts`), the profile set (`revolve` | `cartesian`), the on-disk source
 * + meta.params captured at load, the debounced
 * `/api/primitives/profiles/resolve` effect, and the derived viewBox/path
 * (`profileView`) + `rootPolygonMode` / `rootPolygonId` the SVG reads.
 *
 * NOT a module singleton — `/primitives` mounts N panes, so each pane gets its
 * own `new ProfilePreviewState(...)` (a module-level `$state` would leak resolve
 * state across panes). Construct with getters into the pane's `graph` +
 * `bakeNonce` + `hasSolidProducer`, plus the pane's `PolyPreviewState` (for
 * `polygonModeFor`, so a polygon wired to extrude reads as cartesian here too).
 *
 * `profileSet` is a public `$state` field (not private) so the SHELL's `polyUI`
 * ctor (`() => profilePrev.profileSet`) and the load hydration
 * (`profilePrev.profileSet = d.set`) can read/write it — the same shared-mode
 * wiring the cluster had inline.
 *
 * The debounced resolve `$effect` lives in the constructor — the class is
 * constructed during component init (top of GEP's `<script>`), so the `$effect`
 * is tied to that component's lifecycle (registered + torn down with the pane).
 */
import { emitProfileGraph } from '$lib/cad/composition-emit-profile';
import type { Graph } from '$lib/cad/composition-graph';
import type { PolyPreviewState } from './poly-preview-state.svelte';

type Mode = 'revolve' | 'cartesian';

export class ProfilePreviewState {
  #getGraph: () => Graph;
  #getBakeNonce: () => number;
  #getHasSolidProducer: () => boolean;
  #polyUI: PolyPreviewState;

  get graph(): Graph { return this.#getGraph(); }

  // ─── state ───────────────────────────────────────────────────────────────
  /** Resolved polygon points at default params — populated by the resolve
   *  effect below via /api/primitives/profiles/resolve. */
  profilePts = $state<[number, number][]>([]);
  /** File's saved profile set — changes how the SVG renders the axis + Y
   *  orientation. PUBLIC so the shell's polyUI ctor + load hydration touch it. */
  profileSet = $state<Mode>('revolve');
  profileResolveErr = $state<string | null>(null);
  profileSource = $state<string>('');
  /** Profile's meta.params (loaded from the file's meta block) — the default
   *  param dict for /resolve when graph.params is empty (legacy profiles). */
  profileMetaParams = $state<Record<string, { default?: number }>>({});

  #resolveTimer: ReturnType<typeof setTimeout> | undefined;
  #lastResolveKey = '';

  // ─── derived ───────────────────────────────────────────────────────────────
  /** Mode for the right-pane 2D PREVIEW — when the graph's output is a single
   *  polygon (no solid producer), use polyUI.polygonModeFor on that polygon's id
   *  so the preview adapts to a downstream extrude even though extrude only
   *  becomes the consumer after wiring. With no polygon present, fall back to
   *  the file's saved set. */
  rootPolygonMode = $derived.by<Mode>(() => {
    const polygons = Object.values(this.graph.nodes).filter((n) => (n as any).type === 'polygon') as any[];
    if (polygons.length === 0) return this.profileSet;
    return this.#polyUI.polygonModeFor(polygons[0].id);
  });

  /** Companion to `rootPolygonMode` — id of the polygon whose vertices are
   *  visible in the right-pane 2D PREVIEW (the only one that exists in
   *  2D-output mode). Null when there's no polygon in the graph. */
  rootPolygonId = $derived.by<string | null>(() => {
    const polygons = Object.values(this.graph.nodes).filter((n) => (n as any).type === 'polygon') as any[];
    return polygons.length === 0 ? null : polygons[0].id;
  });

  /** Derived viewBox + path for the 2D SVG preview (revolve: axis at r=0,
   *  Z-down; cartesian: Y-flip so positive points up). Mirrors the SVG logic
   *  in the deleted ProfilePane. */
  profileView = $derived.by(() => {
    const pts = this.profilePts;
    if (pts.length === 0) return null;
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const xMin0 = Math.min(...xs), xMax0 = Math.max(...xs);
    const yMin0 = Math.min(...ys), yMax0 = Math.max(...ys);
    const isCart = this.rootPolygonMode === 'cartesian';
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

  constructor(
    getGraph: () => Graph,
    getBakeNonce: () => number,
    getHasSolidProducer: () => boolean,
    polyUI: PolyPreviewState,
  ) {
    this.#getGraph = getGraph;
    this.#getBakeNonce = getBakeNonce;
    this.#getHasSolidProducer = getHasSolidProducer;
    this.#polyUI = polyUI;

    /** Profile-mode resolve. Two source paths:
     *   * GRAPH path — the canvas has polygon / pen_* nodes wired. The graph is
     *     emitted via composition-emit-profile.ts into a build() body; we POST
     *     that to /resolve for a LIVE 2D preview as the user edits.
     *   * ON-DISK path — empty/legacy graph (no such nodes). Fall back to the
     *     original profileSource loaded from the file so the preview shows
     *     SOMETHING.
     *
     *  Params come from the graph's own meta.params (PARAMS card sliders) when
     *  present, otherwise the file's meta.params defaults. Debounced 120 ms so a
     *  slider drag doesn't flood /resolve. Re-fires on source change + on
     *  bakeNonce bumps (the 🔨 button forces a manual re-resolve). */
    $effect(() => {
      // 2D resolve fires when the graph's output is a polygon (no solid
      // producer present). When a revolve/extrude lives in the graph, the
      // part-bake pipeline takes over and this effect short-circuits.
      if (this.#getHasSolidProducer()) return;
      void this.#getBakeNonce(); // re-run on manual bake

      const graph = this.graph;
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
      const src = hasGraphContent ? emitProfileGraph(graph).source : this.profileSource;
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
        for (const [k, v] of Object.entries(this.profileMetaParams)) {
          params[k] = Number((v as any)?.default ?? 0);
        }
      }

      // Dedupe — this $effect re-fires on EVERY render (graph identity churn,
      // tab activation, unrelated state), not just on real source/param
      // changes. Without a guard, a failing resolve (400) re-POSTed the
      // identical body 4-5× per interaction. Key includes bakeNonce so the
      // 🔨 button still forces a retry of an unchanged body.
      const body = JSON.stringify({ source: src, params });
      const resolveKey = `${this.#getBakeNonce()}:${body}`;
      clearTimeout(this.#resolveTimer);
      this.#resolveTimer = setTimeout(async () => {
        if (resolveKey === this.#lastResolveKey) return;
        this.#lastResolveKey = resolveKey;
        try {
          const r = await fetch('/api/primitives/profiles/resolve', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body,
          });
          if (!r.ok) { this.profileResolveErr = `Resolve ${r.status}: ${(await r.text()).slice(0, 160)}`; return; }
          const d = await r.json();
          this.profilePts = Array.isArray(d.points) ? d.points : [];
          this.profileResolveErr = null;
        } catch (e: any) { this.profileResolveErr = e?.message ?? String(e); }
      }, 120);
    });
  }
}
