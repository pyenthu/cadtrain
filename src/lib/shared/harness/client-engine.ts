// src/lib/shared/harness/client-engine.ts — the CLIENT AppEngine: reads real parts
// from /api/primitives/list so the harness panels show LIVE data. (A server engine
// for the AI loop, plus bake, arrive in later rungs.)
import type { AppEngine, EngineDoc } from '$lib/appkit/verbs/registry';

export function createClientEngine(fetchFn: typeof fetch = fetch): AppEngine {
  return {
    async list() {
      const r = await fetchFn('/api/primitives/list');
      if (!r.ok) throw new Error(`list: ${r.status}`);
      const j = await r.json();
      const merged: any[] = Array.isArray(j.merged) ? j.merged : [];
      return merged.map(
        (e): EngineDoc => ({ id: e.id, name: e.name, params: e.params, source: e.source }),
      );
    },
    // Bake a part: fetch its source (proxied to prod), then bake locally via
    // /api/primitives/preview → derive verts/tris. (Full interactive 3D canvas is a
    // follow-up; this returns real bake stats.)
    async bake(id, params) {
      const s = await fetchFn(`/api/primitives/source?name=${encodeURIComponent(id)}`);
      if (!s.ok) throw new Error(`source "${id}": ${s.status}`);
      const source = (await s.json())?.source;
      if (typeof source !== 'string') throw new Error(`no source for "${id}"`);
      const r = await fetchFn('/api/primitives/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: id, source, params: params ?? {} }),
      });
      if (!r.ok) throw new Error(`bake "${id}": ${r.status} ${await r.text()}`);
      const j = await r.json();
      const full = j.full ?? {};
      const arr = (x: unknown) => (Array.isArray(x) || ArrayBuffer.isView(x) ? (x as ArrayLike<number>).length : 0);
      const verts = arr(full.position) ? Math.floor(arr(full.position) / 3) : full.vertCount;
      const tris = arr(full.index) ? Math.floor(arr(full.index) / 3) : (full.triCount ?? full.triangleCount);
      return { ok: true, verts, tris };
    },
  };
}
