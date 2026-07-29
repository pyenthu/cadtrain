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
  };
}
