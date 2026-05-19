import { json } from '@sveltejs/kit';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { volumePath } from '$lib/server/volume';
import { discoverHelpers } from '$lib/cad/manifold-helpers-meta';
import { extractMetaFromSource } from '$lib/server/primitives-meta';

// Stage G v4 — see ~/.claude/plans/components-primitives-split.md.
//
// Returns the combined catalog of primitives the /primitives UI shows:
//   - bundle (compiled into the app, src/lib/cad/manifold-helpers.ts)
//   - volume ($APP_DATA_DIR/primitives/<id>/source.ts + meta.json)
//
// Each entry carries `editable` — bundle ones are false, volume ones are
// true. Volume primitives with an id that collides with a bundle one
// shadow the bundle (a way to override a built-in for experimentation).

interface PrimEntry {
  id: string;
  source: 'bundle' | 'volume';
  name: string;
  description: string;
  params: Record<string, any>;
  editable: boolean;
}

const PRIMS_ROOT = 'primitives';

export const GET = async () => {
  const bundle: PrimEntry[] = discoverHelpers().map((h) => ({
    id: h.name,
    source: 'bundle',
    name: h.name,
    description: h.desc,
    // Synthesize a params schema from the discovered prop list. Defaults
    // come from HELPER_DEFAULTS via discoverHelpers().props[i].default.
    params: Object.fromEntries(
      h.props.map((p) => [p.name, { label: p.name, min: -10, max: 10, step: 0.1, default: p.default }]),
    ),
    editable: false,
  }));

  const volume: PrimEntry[] = [];
  const archived: PrimEntry[] = [];
  const root = volumePath(PRIMS_ROOT);
  if (existsSync(root)) {
    const entries = await readdir(root, { withFileTypes: true });
    for (const dirent of entries) {
      if (!dirent.isDirectory()) continue;
      if (dirent.name === 'archive') {
        // Recurse one level into archive/<id>/ for the archived list.
        const archiveRoot = join(root, 'archive');
        const inner = await readdir(archiveRoot, { withFileTypes: true });
        for (const d2 of inner) {
          if (!d2.isDirectory()) continue;
          const e = await loadVolumeEntry(join(archiveRoot, d2.name), d2.name);
          if (e) archived.push(e);
        }
        continue;
      }
      const id = dirent.name;
      const e = await loadVolumeEntry(join(root, id), id);
      if (e) volume.push(e);
    }
  }

  async function loadVolumeEntry(dir: string, id: string): Promise<PrimEntry | null> {
    const sourcePath = join(dir, 'source.ts');
    if (!existsSync(sourcePath)) return null;
    try {
      const src = await readFile(sourcePath, 'utf8');
      let meta: any = null;
      try { meta = extractMetaFromSource(src); }
      catch {
        const metaPath = join(dir, 'meta.json');
        if (existsSync(metaPath)) meta = JSON.parse(await readFile(metaPath, 'utf8'));
      }
      if (!meta) return null;
      return {
        id,
        source: 'volume',
        name: meta.name ?? id,
        description: meta.description ?? '',
        params: meta.params ?? {},
        editable: true,
      };
    } catch { return null; }
  }

  // Volume shadows bundle on id collision (later in the merged list
  // means it overrides — for UI purposes we just attach the override flag).
  const bundleIds = new Set(bundle.map((b) => b.id));
  const merged = [
    ...bundle.filter((b) => !volume.some((v) => v.id === b.id)),
    ...volume,
  ];
  return json({
    bundle,
    volume,
    archived,
    merged,
    shadows: volume.filter((v) => bundleIds.has(v.id)).map((v) => v.id),
  });
};
