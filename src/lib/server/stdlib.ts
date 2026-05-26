/**
 * stdlib — the git-tracked, type-checked "standard library" primitives that
 * live in src (src/lib/cad/stdlib/<id>.ts), NOT on the volume.
 *
 * WHY src and not the volume: engine/standard-library primitives (r_revolve, …)
 * are infrastructure, not user content. Keeping them in src buys version
 * history, diff review, one-keystroke rollback, TypeScript type-checking, and
 * tests — and they don't need live GUI editing. User-authored domain parts stay
 * on the volume (data-canonical). The resolver serves stdlib BEFORE the volume
 * so a stdlib id is canonical; /api/primitives/save refuses stdlib ids.
 *
 * HOW the source ships to prod: import.meta.glob with `query:'?raw'` inlines
 * each file's TEXT into the build at compile time, so the source string is
 * baked into the runtime image (unlike manifold-helpers.ts, whose raw .ts isn't
 * shipped). The same source string is fed to the existing sandbox pipeline
 * (transpile → stripImports → inject helpers), so a stdlib primitive executes
 * exactly like a volume part — it's just sourced from src instead of the volume.
 *
 * Adding a stdlib primitive: drop a new `<id>.ts` (exporting `meta` + a function
 * named `<id>`) into src/lib/cad/stdlib/. It auto-registers here.
 */
import { extractMetaFromSource } from '$lib/server/primitives-meta';

// Eager raw-source map: { '/src/lib/cad/stdlib/r_revolve.ts': '<source text>' }.
const rawSources = import.meta.glob('/src/lib/cad/stdlib/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** id → raw source text. id is the filename minus `.ts`. */
const byId = new Map<string, string>();
for (const [path, src] of Object.entries(rawSources)) {
  const file = path.split('/').pop() ?? '';
  const id = file.replace(/\.ts$/, '');
  if (!id || id === 'index') continue;
  byId.set(id, src);
}

/** Raw source text for a stdlib primitive id, or null if not a stdlib id. */
export function stdlibSource(id: string): string | null {
  return byId.get(id) ?? null;
}

/** True when `id` is a stdlib primitive (canonical in src, read-only on volume). */
export function isStdlib(id: string): boolean {
  return byId.has(id);
}

/** All stdlib primitive ids. */
export function stdlibIds(): string[] {
  return [...byId.keys()];
}

export interface StdlibEntry {
  id: string;
  name: string;
  description: string;
  params: Record<string, any>;
  profiles: Record<string, any>;
}

/** Lightweight catalog entry for each stdlib primitive (meta extracted from
 *  source, same parser the volume list/source endpoints use). */
export function stdlibEntries(): StdlibEntry[] {
  const out: StdlibEntry[] = [];
  for (const [id, src] of byId) {
    let meta: any = null;
    try {
      meta = extractMetaFromSource(src);
    } catch {
      /* leave meta null — still list the id */
    }
    out.push({
      id,
      name: meta?.name ?? id,
      description: meta?.description ?? '',
      params: meta?.params ?? {},
      profiles: meta?.profiles ?? {},
    });
  }
  return out;
}
