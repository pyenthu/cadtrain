import { json } from '@sveltejs/kit';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { volumePath } from '$lib/server/volume';
import { listEntitiesIn } from '$lib/server/primitive-paths';
import { stdlibIds, stdlibActiveEntries, stdstaleEntries } from '$lib/server/stdlib';

// Stage G v4 — see ~/.claude/plans/components-primitives-split.md.
// (nested completions group, 2026-05-23; industrial category removed 2026-05-27)
//
// Returns the volume primitive catalog the /primitives sidebar shows (basic,
// completions/<family>, archive, merged flat). Params load lazily via /source.

interface PrimEntry {
  id: string;
  source: 'bundle' | 'volume' | 'stdlib' | 'stdstale';
  name: string;
  description: string;
  params: Record<string, any>;
  editable: boolean;
  /** Set when the part lives in a sub-bucket inside its family
   *  (primitives/completions/<family>/<subfolder>/). Undefined for parts at
   *  the family root. Drives the nested "<subfolder> 📁" fold in the sidebar. */
  subfolder?: string;
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
  // Subfolder NAMES per family (independent of whether the subfolder holds parts
  // yet) so the sidebar shows a freshly-mkdir'd folder even when empty.
  const completionSubfolders: Record<string, string[]> = {};
  // Same pattern for Basic — flat root parts PLUS subfolder-tagged ones (e.g.
  // basic/revolved/, basic/extruded/, basic/test_primitives/). Surfaces the
  // nested fold in the Primitives tab the same way Completions families do.
  const basicSubfolders: string[] = [];
  const root = volumePath(PRIMS_ROOT);

  // CHEAP listing — id only, NO source read. The sidebar shows just the id;
  // a part's params/name/description load LAZILY when it's opened (see
  // /api/primitives/source). listEntitiesIn enumerates the new flat files
  // (<id>.prim.ts / .asm.ts) AND any not-yet-migrated legacy <id>/source.ts
  // folders, so the catalog is a directory listing (no per-part source read).
  // Rule 18 still holds: derived from the FS, no central index to drift.
  const mk = (id: string): PrimEntry =>
    ({ id, source: 'volume', name: id, description: '', params: {}, editable: true });
  async function collectSub(name: string, into: PrimEntry[], subList?: string[]) {
    const dir = join(root, name);
    for (const e of await listEntitiesIn(dir)) into.push(mk(e.id));
    // Recurse one level into subfolders so basic/ can host Revolved/, Extruded/,
    // test_primitives/. The 3-level resolver (primitive-paths.findPrim) already
    // resolves these — this just surfaces them in the list response.
    if (!subList) return;
    let kids: any[] = [];
    try { kids = await readdir(dir, { withFileTypes: true }); } catch { /* ignore */ }
    for (const sub of kids) {
      if (!sub.isDirectory()) continue;
      subList.push(sub.name);
      for (const e of await listEntitiesIn(join(dir, sub.name))) into.push({ ...mk(e.id), subfolder: sub.name });
    }
    subList.sort();
  }
  // Two-level by default + one OPTIONAL level deeper for user-created
  // sub-buckets: primitives/completions/<family>/<subfolder?>/<id>.prim.ts.
  // Each family sub-dir becomes a key (even when empty) so the sidebar shows
  // where parts will land. Parts in a subfolder carry `subfolder: <name>` so
  // the sidebar can fold them into a nested 📁 within the family.
  async function collectCompletions() {
    const subRoot = join(root, 'completions');
    if (!existsSync(subRoot)) return;
    for (const fam of await readdir(subRoot, { withFileTypes: true })) {
      if (!fam.isDirectory()) continue;
      const famDir = join(subRoot, fam.name);
      const entries: PrimEntry[] = (await listEntitiesIn(famDir)).map((e) => mk(e.id));
      // Recurse one level for user subfolders (drill_pipe/tests/, etc.).
      const subs: string[] = [];
      let kids: any[] = [];
      try { kids = await readdir(famDir, { withFileTypes: true }); } catch { /* ignore */ }
      for (const sub of kids) {
        if (!sub.isDirectory()) continue;
        subs.push(sub.name);
        const subDir = join(famDir, sub.name);
        for (const e of await listEntitiesIn(subDir)) {
          entries.push({ ...mk(e.id), subfolder: sub.name });
        }
      }
      completions[fam.name] = entries;
      if (subs.length) { subs.sort(); completionSubfolders[fam.name] = subs; }
    }
  }
  if (existsSync(root)) {
    // Flat parts live directly under primitives/ as <id>.prim.ts (or a legacy
    // <id>/source.ts folder). Category dirs (basic/archive/
    // completions/profiles) have no source of their own, so listEntitiesIn
    // skips them — they're recursed explicitly below.
    for (const e of await listEntitiesIn(root)) volume.push(mk(e.id));
    await collectSub('basic', basic, basicSubfolders);
    await collectSub('archive', archived);
    await collectCompletions();
  }

  // Stdlib primitives are git-tracked src parts — canonical + read-only — and
  // get their OWN sidebar group (distinct from volume Basic) so their provenance
  // (from src/) is obvious. They shadow any same-named volume copy: drop the
  // volume dupes everywhere first. params load lazily via /source (which also
  // serves stdlib first), consistent with the volume entries.
  // src-side primitives (stdlib + stdstale) are git-tracked, canonical, read-only.
  // They shadow any same-named volume copy → drop the volume dupes first.
  // The sidebar renders stdlib + stdstale as SEPARATE groups so the deprecation
  // signal is visible. stdstale entries carry `source: 'stdstale'` so the
  // client can tag them visually + warn against creating new uses.
  const stdIds = new Set(stdlibIds());
  const stdlib: PrimEntry[] = [];
  const stdstale: PrimEntry[] = [];
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
      ...stdlibActiveEntries().map((e) => ({
        id: e.id, source: 'stdlib' as const, name: e.name, description: e.description, params: {}, editable: false,
      })),
    );
    stdstale.push(
      ...stdstaleEntries().map((e) => ({
        id: e.id, source: 'stdstale' as const, name: e.name, description: e.description, params: {}, editable: false,
      })),
    );
  }

  const merged = [...volume];
  return json({ stdlib, stdstale, basic, basicSubfolders, completions, completionSubfolders, archived, merged });
};
