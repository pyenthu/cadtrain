import { json } from '@sveltejs/kit';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { volumePath } from '$lib/server/volume';
import { listEntitiesIn } from '$lib/server/primitive-paths';
import { stdlibIds, stdlibEntries } from '$lib/server/stdlib';

// Stage G v4 — see ~/.claude/plans/components-primitives-split.md.
// (nested completions group, 2026-05-23; industrial category removed 2026-05-27)
//
// Returns the volume primitive catalog the /primitives sidebar shows (basic,
// completions/<family>, archive, merged flat). Params load lazily via /source.

interface PrimEntry {
  id: string;
  source: 'bundle' | 'volume' | 'stdlib';
  name: string;
  description: string;
  params: Record<string, any>;
  editable: boolean;
}

const PRIMS_ROOT = 'primitives';

export const GET = async () => {
  const volume: PrimEntry[] = [];
  const basic: PrimEntry[] = [];
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
    // <id>/source.ts folder). Category dirs (basic/archive/
    // completions/profiles) have no source of their own, so listEntitiesIn
    // skips them — they're recursed explicitly below.
    for (const e of await listEntitiesIn(root)) volume.push(mk(e.id));
    await collectSub('basic', basic);
    await collectSub('archive', archived);
    await collectCompletions();
  }

  // Stdlib primitives are git-tracked src parts — canonical + read-only — and
  // get their OWN sidebar group (distinct from volume Basic) so their provenance
  // (from src/) is obvious. They shadow any same-named volume copy: drop the
  // volume dupes everywhere first. params load lazily via /source (which also
  // serves stdlib first), consistent with the volume entries.
  const stdIds = new Set(stdlibIds());
  const stdlib: PrimEntry[] = [];
  if (stdIds.size) {
    const dropDupes = (arr: PrimEntry[]) => {
      for (let i = arr.length - 1; i >= 0; i--) {
        const e = arr[i];
        if (e && stdIds.has(e.id)) arr.splice(i, 1);
      }
    };
    dropDupes(volume);
    dropDupes(basic);
    dropDupes(archived);
    for (const fam of Object.keys(completions)) {
      const arr = completions[fam];
      if (arr) dropDupes(arr);
    }
    stdlib.push(
      ...stdlibEntries().map((e) => ({
        id: e.id, source: 'stdlib' as const, name: e.name, description: e.description, params: {}, editable: false,
      })),
    );
  }

  const merged = [...volume];
  return json({ stdlib, basic, completions, archived, merged });
};
