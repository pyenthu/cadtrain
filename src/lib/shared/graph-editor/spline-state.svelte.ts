/**
 * spline-state.svelte.ts — PER-INSTANCE state + handlers for the spline-editor
 * cluster (TODO #15 / #24 / #26; GEP modularize #940, cut after WireLayer +
 * ProfilePreview). Mirrors WireState / SketchState / ProfilePreviewState.
 *
 * Owns the spline-editor popup open/anchor state (`splineEditId`,
 * `splinePopPos`), the live `splineNode` + resolved `splineDisplayPoints`
 * derivations behind the popup, the `onSpline*` mutators, and the
 * `splineOverlays` diagnostic-overlay derivation the RightPane 3D bake reads.
 *
 * NOT a module singleton — `/primitives` mounts N panes (`{#each tabs}` +
 * `class:visible`); an open spline popup + its overlays are per-pane state, so a
 * module-level `$state` would leak the editor + plotted-overlay set across panes.
 * Construct with getters/setters into the pane's `graph` $state and a
 * `bumpBakeNonce` bridge (so a point/samples/closed edit nudges the pane's
 * re-bake $effect the same way the inline handlers did `bakeNonce++`).
 *
 * Handlers are ARROW fields so `this` stays bound when they're used as Svelte
 * event handlers (`onPointsChange={spline.onSplinePoints}`, etc.).
 */
import {
  setSplinePoints,
  setSplineSamples,
  setSplineClosed,
  setSplinePointsExpr,
  setSplinePlot,
  asLiteral,
  type Graph,
} from '$lib/cad/composition-graph';
import { resolveWiredSplinePoints } from '$lib/cad/spline-eval';
import { resampleSpline } from '$lib/cad/spline-resample';

// ─── plotted-spline diagnostic overlays (TODO #24) ─────────────────────────
// Auto-colour palette — distinct hues so PATH vs SECTION (and any further
// plotted splines) read apart at a glance. A node's explicit `plotColor` wins.
const SPLINE_PLOT_COLORS = ['#e11d48', '#2563eb', '#16a34a', '#d97706', '#9333ea', '#0891b2'];

export class SplineState {
  #getGraph: () => Graph;
  #setGraph: (g: Graph) => void;
  #bumpBakeNonce: () => void;

  get graph(): Graph { return this.#getGraph(); }

  // ─── spline-editor popup (TODO #15) ───────────────────────────────────────
  // GEP owns the open + anchor; SplineEditorPopup is self-contained chrome.
  splineEditId = $state<string | null>(null);
  splinePopPos = $state<{ left: number; top: number }>({ left: 120, top: 80 });

  constructor(
    getGraph: () => Graph,
    setGraph: (g: Graph) => void,
    bumpBakeNonce: () => void,
  ) {
    this.#getGraph = getGraph;
    this.#setGraph = setGraph;
    this.#bumpBakeNonce = bumpBakeNonce;
  }

  openSplineEditor = (ev: MouseEvent | undefined, id: string) => {
    const node = this.graph.nodes[id] as any;
    if (!node || node.type !== 'spline') return;
    if (ev) this.splinePopPos = { left: ev.clientX + 12, top: Math.max(12, ev.clientY - 40) };
    else this.splinePopPos = { left: 120, top: 80 };
    this.splineEditId = id;
  };

  /** Live node behind the open popup (reactive — so edits reflect immediately). */
  splineNode = $derived(this.splineEditId ? (this.graph.nodes[this.splineEditId] as any) : null);

  /** The CONTROL POINTS the editor renders. When the spline's points are WIRED
   *  from an expression (#26), evaluate that expression's output live (reuses the
   *  bake's emitExprBlocks lowering) so the popup shows the RESOLVED points, not
   *  the stale manual handles. Unwired ⇒ the manual `points`. `$derived` so it
   *  tracks graph / param / expression edits. */
  splineDisplayPoints = $derived.by<[number, number, number][]>(() => {
    const n = this.splineNode;
    if (!n) return [];
    if (n.pointsExpr != null) return resolveWiredSplinePoints(this.graph, n.pointsExpr);
    return (n.points ?? []) as [number, number, number][];
  });

  onSplinePoints = (pts: [number, number, number][]) => {
    if (!this.splineEditId) return;
    this.#setGraph(setSplinePoints(this.graph, this.splineEditId, pts));
    this.#bumpBakeNonce();
  };

  onSplineSamples = (n: number) => {
    if (!this.splineEditId) return;
    this.#setGraph(setSplineSamples(this.graph, this.splineEditId, asLiteral(n)));
    this.#bumpBakeNonce();
  };

  onSplineClosed = (v: boolean) => {
    if (!this.splineEditId) return;
    // The spline owns loop-ness; a sweep wired to its path auto-follows (emit
    // forces closedPath/caps). Nudge the bake so the change re-renders.
    this.#setGraph(setSplineClosed(this.graph, this.splineEditId, v));
    this.#bumpBakeNonce();
  };

  /** Drop the wired control-points source (#26) → back to the manual points. */
  onSplineUnwire = () => {
    if (!this.splineEditId) return;
    this.#setGraph(setSplinePointsExpr(this.graph, this.splineEditId, null));
    this.#bumpBakeNonce();
  };

  /** Toggle the PLOT-in-the-main-3D-bake diagnostic overlay for the spline being
   *  edited (TODO #24). VIEW-ONLY — no re-bake, only the overlay set changes. */
  onSplinePlot = (v: boolean) => {
    if (!this.splineEditId) return;
    this.#setGraph(setSplinePlot(this.graph, this.splineEditId, v));
  };

  /** Every spline with `plot === true`, resolved to { curve, control points,
   *  colour } for the main-bake overlay. Reuses resolveWiredSplinePoints (#26)
   *  for wired control points and resampleSpline (the SAME curve the bake uses)
   *  for the display polyline — NO second point resolver. `$derived` so it
   *  tracks point drags / N / wiring / plot toggles live. */
  splineOverlays = $derived.by(() => {
    const out: { id: string; color: string; curve: [number, number, number][]; points: [number, number, number][]; closed?: boolean }[] = [];
    let ci = 0;
    for (const n of Object.values(this.graph.nodes)) {
      if ((n as any).type !== 'spline' || (n as any).plot !== true) continue;
      const sp = n as any;
      const points: [number, number, number][] = sp.pointsExpr != null
        ? resolveWiredSplinePoints(this.graph, sp.pointsExpr)
        : ((sp.points ?? []) as [number, number, number][]);
      const color = (typeof sp.plotColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(sp.plotColor))
        ? sp.plotColor
        : SPLINE_PLOT_COLORS[ci % SPLINE_PLOT_COLORS.length];
      ci++;
      if (points.length < 2) { // still show the handles even if the curve can't form
        out.push({ id: sp.id, color, curve: [], points, closed: sp.closed === true });
        continue;
      }
      const N = sp.samples?.kind === 'literal' ? Math.max(2, Number(sp.samples.value)) : 48;
      // Dense polyline for a smooth overlay tube (≥ N, capped): the bake's own
      // resampleSpline, so the plotted curve matches the swept spine.
      const dense = Math.max(N, Math.min(256, points.length * 24));
      let curve: [number, number, number][] = [];
      try { curve = resampleSpline(points as any, dense, sp.closed === true) as any; } catch { curve = []; }
      out.push({ id: sp.id, color, curve, points, closed: sp.closed === true });
    }
    return out;
  });
}
