/**
 * Volume root resolution for standalone bun scripts.
 *
 * `src/lib/server/volume.ts` is the app-side source of truth, but it
 * imports `$env/dynamic/private` + `@sveltejs/kit`, which don't resolve
 * outside the SvelteKit runtime. This is a plain-node mirror of the same
 * resolution chain so scripts (extract_figures.ts, overnight_extract.ts)
 * can read/write the volume without the framework.
 *
 * Keep the chain in sync with volume.ts `resolveRoot()`.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

export function volumeRoot(): string {
  const env = process.env;
  if (env.CADTRAIN_VOLUME_ROOT) return resolve(env.CADTRAIN_VOLUME_ROOT);
  if (env.RAILWAY_VOLUME_MOUNT_PATH && existsSync(env.RAILWAY_VOLUME_MOUNT_PATH)) {
    return resolve(env.RAILWAY_VOLUME_MOUNT_PATH);
  }
  if (env.APP_DATA_DIR && existsSync(env.APP_DATA_DIR)) return resolve(env.APP_DATA_DIR);
  if (existsSync('/app_data')) return '/app_data';
  const cwd = process.cwd();
  if (existsSync(resolve(cwd, 'kb-sources'))) return cwd;
  const dev = resolve(cwd, '.dev-volume');
  if (!existsSync(dev)) {
    try { mkdirSync(dev, { recursive: true }); } catch { /* read-only FS */ }
  }
  return dev;
}

/** Resolve a relative path under the volume root. */
export function volumePath(rel: string): string {
  return resolve(volumeRoot(), rel);
}
