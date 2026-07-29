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
  return errors.length ? { ok: false, errors } : { ok: true, app: a as AppManifest };
}
