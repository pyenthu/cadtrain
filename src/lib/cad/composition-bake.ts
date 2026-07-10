/**
 * composition-bake.ts — graph → emitted source + a CHEAP validity check.
 *
 * HISTORY (2026-07-10). This used to be `bakeGraphPreview`: the editor POSTed
 * the whole assembly to `/api/primitives/preview`, waited for a full server-side
 * Manifold bake, and then THREW THE MESH AWAY — it only ever read `ok`,
 * `message` and `cacheHash`. The canvas re-baked the same geometry client-side a
 * moment later. So every graph edit paid for two bakes, one of them on Node's
 * single thread, and one of them for nothing.
 *
 * On a 26-element well that server bake is ~300k triangles of JSON the editor
 * discards. Manifold's API is synchronous, so it starved the event loop and
 * wedged every other route while it ran (the /wells hang, and the repeated
 * "primitives or wells not loading").
 *
 * NOW: `validateGraphBake` emits the source and asks `/api/primitives/compile`
 * — dep resolution + script emit, no WASM, no mesh, server-cached — for
 * `{supported, reason, scriptHash}`. That is exactly the signal the editor
 * needed: does this graph resolve, and what is its identity for the badge.
 *
 * THE MESH IS THE CANVAS'S JOB. `PrimitiveDualCanvas` bakes it in the Manifold
 * Web Worker (backend='manifold'). The server bake still exists behind the
 * explicit MF_SERVER tab (backend='manifold-server') for parity/diagnosis.
 *
 * Public API:
 *
 *   validateGraphBake(graph, opts) → Promise<GraphBakeCheck>
 *   emitSource(graph, id)          → string
 */
import { emitGraph } from './composition-emit';
import type { Graph } from './composition-graph';

/** Result of the graph validity check. `ok:false` means the graph does not
 *  resolve (missing dep, cycle, unparseable source) — a real, reportable error;
 *  it does NOT mean the geometry is bad. Geometry errors surface from the
 *  canvas's own bake, which is the only thing that builds geometry. */
export interface GraphBakeCheck {
  ok: boolean;
  message?: string;
  /** Compile-script hash — the graph's identity, shown in the editor badge. */
  cacheHash?: string;
  /** The server already had this compile cached. */
  cached?: boolean;
}

export interface BakeOptions {
  /** The assembly id (becomes the function name in the emitted source). */
  id: string;
  /** Assembly-level meta.params values (drives `kind: 'param'` resolution). */
  paramValues?: Record<string, number | string | boolean>;
  /** When true, bypass the compile cache for this call. Used by 🔄 Rebuild. */
  bust?: boolean;
  /** Ghost set — node IDs whose Manifold is appended to the return list
   *  so the bake includes them as overlays. Each Call card's 👁 toggle
   *  drives this; saved files are never affected. */
  ghosts?: string[];
}

/** Emit the graph and ask the server whether it COMPILES. No WASM, no mesh, no
 *  event-loop starvation — dep resolution + script emit only, and the server
 *  caches it. See the module header for why this is not a bake. */
export async function validateGraphBake(graph: Graph, opts: BakeOptions): Promise<GraphBakeCheck> {
  const r = emitGraph(graph, { id: opts.id, ghosts: opts.ghosts });
  const tStart = (typeof performance !== 'undefined' ? performance : Date).now();
  let resp: Response;
  try {
    resp = await fetch('/api/primitives/compile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // POST reads `bust` from the BODY (the GET arm is the one that takes ?bust=1).
      body: JSON.stringify({ name: opts.id, source: r.source, bust: !!opts.bust }),
    });
  } catch (e: any) {
    return { ok: false, message: `compile request failed: ${String(e?.message ?? e)}` };
  }
  if (!resp.ok) {
    const text = await resp.text();
    return { ok: false, message: `compile ${resp.status}: ${text.slice(0, 240)}` };
  }
  const data = await resp.json();
  const fetchMs = +((typeof performance !== 'undefined' ? performance : Date).now() - tStart).toFixed(1);
  if (!data?.supported) return { ok: false, message: String(data?.reason ?? 'graph does not compile') };
  return { ok: true, cacheHash: data.scriptHash, cached: !!data.cached, _t: { fetch_total: fetchMs } } as GraphBakeCheck;
}

/** Convenience: just emit the source (no bake). Used by the live source pane. */
export function emitSource(graph: Graph, id: string): string {
  return emitGraph(graph, { id }).source;
}
