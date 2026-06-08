/**
 * composition-bake.ts — graph → baked Manifold geometry.
 *
 * Per docs/plans/composition-architecture.md. Slice 1 implementation
 * (2026-06-06): a CLIENT-SIDE adapter that emits the graph via
 * composition-emit and routes through the existing
 * `/api/primitives/preview` endpoint. The server bake path stays
 * unchanged for now (uses primitive-loader's sandbox).
 *
 * Later slices migrate this to a server-side direct-graph interpreter
 * that skips JS sandbox eval entirely — at which point the
 * /api/primitives/preview-graph endpoint takes over and this client
 * adapter becomes a thin POST wrapper.
 *
 * The bake input is the FULL Graph plus paramValues (assembly-level
 * meta.params snapshot). The interpreter walks the graph, resolves
 * ArgValue.kind === 'param' against paramValues, ArgValue.kind ===
 * 'literal' as-is, and ArgValue.kind === 'expr' via JS eval inside the
 * assembly's scope (only for arbitrary expressions; not the common
 * case).
 *
 * Public API:
 *
 *   bakeGraphPreview(graph, exemplarId, paramValues?)
 *     → Promise<PreviewResult>
 *
 *     Emits source via composition-emit; POSTs to /api/primitives/preview;
 *     returns { ok, full, cut, message, … } — same shape as the existing
 *     primitive preview. The editor mounts the result on PrimitiveDualCanvas.
 */
import { emitGraph } from './composition-emit';
import type { Graph } from './composition-graph';

export interface PreviewBake {
  ok: boolean;
  message?: string;
  full?: { positions: number[]; indices?: number[] };
  cut?: { positions: number[]; indices?: number[] };
  // pass-through for color-by-source + GLB fields the existing endpoint emits
  [k: string]: unknown;
}

export interface BakeOptions {
  /** The assembly id (becomes the function name in the emitted source). */
  id: string;
  /** Assembly-level meta.params values (drives `kind: 'param'` resolution). */
  paramValues?: Record<string, number | string | boolean>;
  /** When true, the server is asked for full + cut meshes (cutaway preview). */
  cutaway?: boolean;
  /** When true, bypass the bake cache for this call (forces a fresh
   *  /api/primitives/preview?bust=1). Used by the 🔄 Rebuild button. */
  bust?: boolean;
}

/** Bake a graph by emitting source + routing through /api/primitives/preview.
 *  Slice-1 implementation; the server uses the existing primitive-loader. */
export async function bakeGraphPreview(graph: Graph, opts: BakeOptions): Promise<PreviewBake> {
  const r = emitGraph(graph, { id: opts.id });
  // Positional params for the existing /preview endpoint, in meta.params order.
  const positional: (number | string | boolean)[] = Object.keys(graph.params).map((k) => {
    const v = opts.paramValues?.[k];
    return v ?? graph.params[k]!.default;
  });
  const resp = await fetch(`/api/primitives/preview${opts.bust ? '?bust=1' : ''}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      source: r.source,
      name: opts.id,
      params: positional,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    return { ok: false, message: `preview ${resp.status}: ${text.slice(0, 240)}` };
  }
  const data = await resp.json() as PreviewBake;
  return data;
}

/** Convenience: just emit the source (no bake). Used by the live source pane. */
export function emitSource(graph: Graph, id: string): string {
  return emitGraph(graph, { id }).source;
}
