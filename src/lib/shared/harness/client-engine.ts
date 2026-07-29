// src/lib/shared/harness/client-engine.ts — the CLIENT AppEngine: reads/bakes/compiles
// real parts via /api/primitives/* so the harness panels + the AI build over LIVE data.
// (A server engine for the AI loop is added later.)
import type { AppEngine, EngineDoc } from '$lib/appkit/verbs/registry';

/** Fetch a part's source (proxied to prod in dev). Shared by getSource/bake/compile. */
async function fetchSource(fetchFn: typeof fetch, id: string): Promise<string> {
  const r = await fetchFn(`/api/primitives/source?name=${encodeURIComponent(id)}`);
  if (!r.ok) throw new Error(`source "${id}": ${r.status}`);
  const source = (await r.json())?.source;
  if (typeof source !== 'string') throw new Error(`no source for "${id}"`);
  return source;
}

export function createClientEngine(fetchFn: typeof fetch = fetch): AppEngine {
  return {
    async list() {
      const r = await fetchFn('/api/primitives/list');
      if (!r.ok) throw new Error(`list: ${r.status}`);
      const j = await r.json();
      const merged: any[] = Array.isArray(j.merged) ? j.merged : [];
      return merged.map((e): EngineDoc => ({ id: e.id, name: e.name, params: e.params, source: e.source }));
    },
    async getSource(id) {
      return { source: await fetchSource(fetchFn, id) };
    },
    // Bake locally via /api/primitives/preview → derive verts/tris. (Interactive 3D
    // canvas is a follow-up; this returns real bake stats.)
    async bake(id, params) {
      const source = await fetchSource(fetchFn, id);
      const r = await fetchFn('/api/primitives/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: id, source, params: params ?? {} }),
      });
      if (!r.ok) throw new Error(`bake "${id}": ${r.status} ${await r.text()}`);
      const j = await r.json();
      const full = j.full ?? {};
      const len = (x: unknown) => (Array.isArray(x) || ArrayBuffer.isView(x) ? (x as ArrayLike<number>).length : 0);
      const verts = len(full.position) ? Math.floor(len(full.position) / 3) : full.vertCount;
      const tris = len(full.index) ? Math.floor(len(full.index) / 3) : (full.triCount ?? full.triangleCount);
      return { ok: true, verts, tris };
    },
    // Compile → the dep-inlined Manifold script + scriptHash (local, stateless).
    async compile(id, params) {
      const source = await fetchSource(fetchFn, id);
      const r = await fetchFn('/api/primitives/compile', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: id, source, params: params ?? {} }),
      });
      if (!r.ok) throw new Error(`compile "${id}": ${r.status} ${await r.text()}`);
      return (await r.json()) as Record<string, unknown>;
    },
  };
}
