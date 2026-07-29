// src/lib/appkit/store/app-store.ts — the .app STORAGE abstraction (D9).
// Backend-agnostic so the .app's home stays flexible (local drive / a path / later
// the volume). Rung 2 ships an in-memory store seeded from a bundled example;
// local-backend (File System Access / a local dir) + volume-backend are deferred.
import type { AppManifest } from '../manifest/types';

export interface AppStore {
  load(id: string): Promise<AppManifest>;
  list(): Promise<Array<{ id: string; title?: string }>>;
  save?(id: string, app: AppManifest): Promise<void>;
}

/** In-memory store — the rung-2 provider (and a test double). Seed it with parsed
 *  `.app` manifests keyed by id. */
export function createMemoryStore(seed: Record<string, AppManifest> = {}): AppStore {
  const apps = new Map<string, AppManifest>(Object.entries(seed));
  return {
    async load(id) {
      const a = apps.get(id);
      if (!a) throw new Error(`appkit: no .app "${id}"`);
      return a;
    },
    async list() {
      return [...apps.entries()].map(([id, a]) => ({ id, title: a.title }));
    },
    async save(id, app) {
      apps.set(id, app);
    },
  };
}
