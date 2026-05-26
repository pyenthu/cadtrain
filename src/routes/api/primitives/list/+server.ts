import { json } from '@sveltejs/kit';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { volumePath } from '$lib/server/volume';
import { discoverHelpers } from '$lib/cad/manifold-helpers-meta';
import { listEntitiesIn } from '$lib/server/primitive-paths';

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

  // CHEAP listing — id only, NO source read. The sidebar shows just the id;
  // a part's params/name/description load LAZILY when it's opened (see
  // /api/primitives/source). listEntitiesIn enumerates the new flat files
  // (<id>.prim.ts / .asm.ts) AND any not-yet-migrated legacy <id>/source.ts
  // folders, so the catalog is a directory listing (no per-part source read).
  // Rule 18 still holds: derived from the FS, no central index to drift.
  const mk = (id: string): PrimEntry =>
    ({ id, source: 'volume', name: id, description: '', params: {}, editable: true });
  async function collectSub(name: string, into: PrimEntry[]) {
    for (const e of await listEntitiesIn(join(root, name))) into.push(mk(e.id));
  }
  // Two-level: primitives/completions/<family>/<id>.prim.ts. Each family sub-dir
  // becomes a key (even when empty) so the sidebar shows where parts will land.
  async function collectCompletions() {
    const subRoot = join(root, 'completions');
    if (!existsSync(subRoot)) return;
    for (const fam of await readdir(subRoot, { withFileTypes: true })) {
      if (!fam.isDirectory()) continue;
      completions[fam.name] = (await listEntitiesIn(join(subRoot, fam.name))).map((e) => mk(e.id));
    }
  }
  if (existsSync(root)) {
    // Flat parts live directly under primitives/ as <id>.prim.ts (or a legacy
    // <id>/source.ts folder). Category dirs (basic/industrial/archive/
    // completions/profiles) have no source of their own, so listEntitiesIn
    // skips them — they're recursed explicitly below.
    for (const e of await listEntitiesIn(root)) volume.push(mk(e.id));
    await collectSub('basic', basic);
    await collectSub('industrial', industrial);
    await collectSub('archive', archived);
    await collectCompletions();
  }

  // Bundle raw helpers (cyl/tube/profile_extrude/revolve/helix_band …) are the
  // unstable backend toolkit (Rule 17/20): runtime-injected into the sandbox and
  // used INSIDE the r_* leaves, but NOT shown in the /primitives sidebar — the UI
  // surfaces only the new-style r_* components + composites. They stay in the
  // `bundle` field for any internal use; `merged` (the sidebar's loose top
  // section) carries only volume primitives.
  const bundleIds = new Set(bundle.map((b) => b.id));
  const merged = [...volume];
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
