import { json } from '@sveltejs/kit';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { volumePath } from '$lib/server/volume';
import { discoverHelpers } from '$lib/cad/manifold-helpers-meta';

// Stage G v4 — see ~/.claude/plans/components-primitives-split.md.
// (tests→industrial rename + nested completions group, 2026-05-23)
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
  const basic: PrimEntry[] = [];
  const industrial: PrimEntry[] = [];
  const archived: PrimEntry[] = [];
  // Completions is NESTED one level deeper than the flat groups above:
  // primitives/completions/<family>/<id>/. The sidebar renders it as
  // Completions → collapsible family sub-folder → parts. Family dirs may
  // be empty (structure only) — they still appear so the user can see
  // where each family's parts will land.
  const completions: Record<string, PrimEntry[]> = {};
  const root = volumePath(PRIMS_ROOT);

  // CHEAP entry — id only, NO source read. The sidebar shows just the id;
  // a part's params/name/description load LAZILY when it's opened (see
  // /api/primitives/source, which returns the extracted meta). This keeps
  // the catalog a directory listing (one stat per part) instead of reading
  // + meta-parsing every source.ts on every call — the previous behaviour
  // grew to ~2s once the part count tripled. Rule 18 still holds: the list
  // is derived from the FS, no central index to drift.
  function cheapEntry(dir: string, id: string): PrimEntry | null {
    if (!existsSync(join(dir, 'source.ts'))) return null;
    return { id, source: 'volume', name: id, description: '', params: {}, editable: true };
  }
  async function collectSub(name: string, into: PrimEntry[]) {
    const subRoot = join(root, name);
    if (!existsSync(subRoot)) return;
    for (const d of await readdir(subRoot, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const e = cheapEntry(join(subRoot, d.name), d.name);
      if (e) into.push(e);
    }
  }
  // Two-level recurse: primitives/completions/<family>/<id>/. Each family
  // sub-dir becomes a key in `completions` (even when empty), and its
  // parts are collected one level below.
  async function collectCompletions() {
    const subRoot = join(root, 'completions');
    if (!existsSync(subRoot)) return;
    for (const fam of await readdir(subRoot, { withFileTypes: true })) {
      if (!fam.isDirectory()) continue;
      const parts: PrimEntry[] = [];
      const famRoot = join(subRoot, fam.name);
      for (const d of await readdir(famRoot, { withFileTypes: true })) {
        if (!d.isDirectory()) continue;
        const e = cheapEntry(join(famRoot, d.name), d.name);
        if (e) parts.push(e);
      }
      completions[fam.name] = parts;
    }
  }
  if (existsSync(root)) {
    for (const dirent of await readdir(root, { withFileTypes: true })) {
      if (!dirent.isDirectory()) continue;
      // `archive/` (soft-deleted), `basic/` (the raw r_* geometry
      // primitives), `industrial/` (the industrial-test category, formerly
      // `tests/`) and `completions/` (nested by family) are sub-folders,
      // not primitives themselves — recurse.
      if (dirent.name === 'archive')     { await collectSub('archive', archived);        continue; }
      if (dirent.name === 'basic')       { await collectSub('basic', basic);             continue; }
      if (dirent.name === 'industrial')  { await collectSub('industrial', industrial);   continue; }
      if (dirent.name === 'completions') { await collectCompletions();                    continue; }
      const e = cheapEntry(join(root, dirent.name), dirent.name);
      if (e) volume.push(e);
    }
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
    basic,
    industrial,
    completions,
    archived,
    merged,
    shadows: volume.filter((v) => bundleIds.has(v.id)).map((v) => v.id),
  });
};
