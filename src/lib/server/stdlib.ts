/**
 * stdlib + stdlib/stale — the git-tracked, type-checked "standard library"
 * primitives that live in src (src/lib/cad/stdlib/<id>.ts, deprecated ones in
 * src/lib/cad/stdlib/stale/<id>.ts), NOT on the volume.
 *
 * WHY src and not the volume: engine/standard-library primitives are
 * infrastructure, not user content. Keeping them in src buys version
 * history, diff review, one-keystroke rollback, TypeScript type-checking,
 * and tests — and they don't need live GUI editing. User-authored domain
 * parts stay on the volume (data-canonical). The resolver serves these
 * BEFORE the volume so the ids are canonical; /api/primitives/save refuses
 * either origin.
 *
 * WHY two locations: `stdlib/` holds the actively-recommended engine
 * primitives. `stdlib/stale/` holds engines that are being deprecated but kept
 * resolvable so existing parts that reference them (via meta.uses) keep
 * baking until they're migrated to the replacement. Sidebar renders them
 * as separate groups so the visual signal is clear ("stale — use the new
 * scaffolds via the folder + button instead").
 *
 * HOW the source ships to prod: import.meta.glob with `query:'?raw'` inlines
 * each file's TEXT into the build at compile time, so the source string is
 * baked into the runtime image (unlike manifold-helpers.ts, whose raw .ts
 * isn't shipped). The same source string is fed to the existing sandbox
 * pipeline (transpile → stripImports → inject helpers), so a stdlib /
 * stdstale primitive executes exactly like a volume part — just sourced
 * from src.
 *
 * Adding a stdlib primitive: drop a new `<id>.ts` (exporting `meta` + a
 * function named `<id>`) into src/lib/cad/stdlib/. It auto-registers here.
 * Deprecating: `git mv src/lib/cad/stdlib/<id>.ts src/lib/cad/stdlib/stale/`.
 */
import { extractMetaFromSource } from '$lib/server/primitives-meta';

export type StdOrigin = 'stdlib' | 'stdstale';

// Eager raw-source maps — separate per-origin glob so we know which dir
// each id came from (drives the sidebar grouping + the "stale" warning).
const stdlibRaw = import.meta.glob('/src/lib/cad/stdlib/*.ts', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;
// Deprecated engines now live in a `stale/` SUBFOLDER of stdlib (relocated
// 2026-06-28 from the old top-level stdstale/ dir). Origin stays 'stdstale' so
// the API/sidebar/picker keep classifying + flagging them unchanged. The main
// stdlib glob above is non-recursive (*.ts), so it does NOT pick these up.
const stdstaleRaw = import.meta.glob('/src/lib/cad/stdlib/stale/*.ts', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

type Entry = { source: string; origin: StdOrigin };
/** id → { source, origin }. id is the filename minus `.ts`. */
const byId = new Map<string, Entry>();
function load(rawMap: Record<string, string>, origin: StdOrigin) {
  for (const [path, src] of Object.entries(rawMap)) {
    const file = path.split('/').pop() ?? '';
    const id = file.replace(/\.ts$/, '');
    if (!id || id === 'index') continue;
    byId.set(id, { source: src, origin });
  }
}
// stdlib FIRST so a stdlib id wins if both dirs happen to declare it (the
// last-write-wins case during a half-applied move).
load(stdlibRaw, 'stdlib');
load(stdstaleRaw, 'stdstale');
// (no-op HMR nudge — keeps `import.meta.glob` invalidating cleanly when a
// new <id>.ts is added under stdlib/, without restarting the dev server)

/** Raw source text for a stdlib or stdstale primitive id, or null if neither. */
export function stdlibSource(id: string): string | null {
  return byId.get(id)?.source ?? null;
}

/** True when `id` resolves to a stdlib OR stdstale primitive (canonical in
 *  src, read-only on volume). Save/delete endpoints refuse either. */
export function isStdlib(id: string): boolean {
  return byId.has(id);
}

/** All resolvable src-side primitive ids (stdlib + stdstale). */
export function stdlibIds(): string[] {
  return [...byId.keys()];
}

export interface StdlibEntry {
  id: string;
  name: string;
  description: string;
  params: Record<string, any>;
  profiles: Record<string, any>;
  origin: StdOrigin;
}

/** Lightweight catalog entry for each src-side primitive (meta extracted
 *  from source, same parser the volume list/source endpoints use). */
export function stdlibEntries(): StdlibEntry[] {
  const out: StdlibEntry[] = [];
  for (const [id, { source: src, origin }] of byId) {
    let meta: any = null;
    try { meta = extractMetaFromSource(src); } catch { /* leave null */ }
    out.push({
      id,
      name: meta?.name ?? id,
      description: meta?.description ?? '',
      params: meta?.params ?? {},
      profiles: meta?.profiles ?? {},
      origin,
    });
  }
  return out;
}

/** Only the stdlib-origin entries. */
export function stdlibActiveEntries(): StdlibEntry[] {
  return stdlibEntries().filter((e) => e.origin === 'stdlib');
}

/** Only the stdstale-origin entries. */
export function stdstaleEntries(): StdlibEntry[] {
  return stdlibEntries().filter((e) => e.origin === 'stdstale');
}
