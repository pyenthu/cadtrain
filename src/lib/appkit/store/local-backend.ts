// src/lib/appkit/store/local-backend.ts — the `local` AppStore backend (client side).
// Reads/writes .app files from a local dir served by /api/app/* (server-side fs).
// Runtime-dynamic: no rebuild to see an edited .app. This is the v1 storage path
// (D9); a browser File System Access variant + the volume backend are future.
import type { AppStore } from './app-store';
import type { AppManifest } from '../manifest/types';

export function createLocalStore(fetchFn: typeof fetch = fetch): AppStore {
  return {
    async load(id) {
      const r = await fetchFn(`/api/app/load?id=${encodeURIComponent(id)}`);
      if (!r.ok) throw new Error(`load "${id}": ${r.status} ${await r.text()}`);
      return (await r.json()) as AppManifest;
    },
    async list() {
      const r = await fetchFn('/api/app/list');
      if (!r.ok) throw new Error(`list: ${r.status}`);
      return r.json();
    },
    async save(id, app) {
      const r = await fetchFn('/api/app/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, app }),
      });
      if (!r.ok) throw new Error(`save "${id}": ${r.status} ${await r.text()}`);
    },
  };
}
