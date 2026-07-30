// src/lib/appkit/manifest/validate.ts — structural validation of a loaded .app.
import type { AppManifest } from './types';

export type ValidateResult =
  | { ok: true; app: AppManifest }
  | { ok: false; errors: string[] };

export function validateManifest(x: unknown): ValidateResult {
  const errors: string[] = [];
  const a = x as any;
  if (!a || typeof a !== 'object') return { ok: false, errors: ['.app is not an object'] };
  if (typeof a.app !== 'string') errors.push('.app missing "app" (string)');
  if (!Array.isArray(a.panels)) {
    errors.push('.app missing "panels" (array)');
  } else {
    a.panels.forEach((p: any, i: number) => {
      if (!p || typeof p !== 'object') errors.push(`panel[${i}] is not an object`);
      else {
        if (!p.id) errors.push(`panel[${i}] missing "id"`);
        if (!p.kind) errors.push(`panel[${i}] missing "kind"`);
      }
    });
  }
  if (errors.length) return { ok: false, errors };
  dedupePanelIds(a); // normalize — duplicate ids break keyed renders + id-keyed lookups
  return { ok: true, app: a as AppManifest };
}

/** Rename duplicate panel ids (across the panel tree + popovers) so every id is unique.
 *  Duplicates crash keyed {#each} and collide in preloaded[]/findPanel(). Mutates in place. */
export function dedupePanelIds(app: any): void {
  const walk = (list: any[], seen: Set<string>) => {
    for (const p of list ?? []) {
      if (!p || typeof p !== 'object') continue;
      const base = String(p.id ?? 'p');
      let id = base;
      let n = 2;
      while (seen.has(id)) id = `${base}-${n++}`;
      seen.add(id);
      p.id = id;
      if (Array.isArray(p.children)) walk(p.children, seen);
    }
  };
  walk(app?.panels, new Set<string>());
  walk(app?.popovers, new Set<string>());
}
