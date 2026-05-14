/**
 * GET /api/components/list
 *
 * Returns the current registry of single-file components. Two read
 * sources merged at request time:
 *
 *   1. **Bundle** — `src/lib/cad/components/<id>.ts` shipped via the
 *      runtime image. Provides the 26 baseline primitives. Read-only at
 *      runtime — saves never modify these files in production (writes go
 *      to the volume; see (2)).
 *   2. **Volume** — `<volume>/components/<id>.ts` (volumePath('components')).
 *      Writable. Saves from /api/components/save land here in prod;
 *      sidecar .md files from /api/components/instructions also live
 *      here. Volume wins on id collision, so a saved overlay shadows
 *      the bundle file at runtime.
 *
 * Each entry carries the metadata needed by the sidebar + Inspector
 * (id / name / params / validate? presence) plus the raw .ts source
 * text for the Inspector's Svelte tab. The geom function itself is
 * NOT serialized — it's still imported statically by the registry
 * loader (build-time `import.meta.glob`) and joined to the API
 * response by id, so geometry execution stays local to the client
 * bundle (no eval, no network round-trip per slider drag).
 *
 * A volume-only entry (no bundled .ts) appears in the list with
 * `origin: 'volume'` and `hasGeom: false` — the UI surfaces it as
 * "needs bundle rebuild" so the user knows clicking it won't render
 * geometry yet.
 *
 * NOT proxied: unlike /api/volume + /api/kb/*, this endpoint does not
 * forward to prod when CADTRAIN_VOLUME_REMOTE_URL is set. The dev app
 * renders components from its build-time import.meta.glob over the
 * LOCAL src/ tree, so the list has to reflect what's renderable HERE.
 * All /api/components/* endpoints are dev-local for this reason.
 *
 * Cache: small in-memory cache keyed by file mtime across BOTH dirs.
 * Invalidated by save / instructions / delete on write.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readdir, readFile, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { getCachedList, setCachedList } from './cache';
import { volumePath } from '$lib/server/volume';

const SRC_DIR = join(process.cwd(), 'src', 'lib', 'cad', 'components');
const VOLUME_DIR = volumePath('components');

interface ComponentListEntry {
  id: string;
  name: string;
  description?: string;
  tags?: readonly string[];
  params: Record<string, unknown>;
  hasValidate: boolean;
  source: string;
  /** Per-primitive AI instructions doc — content of `<id>.md` if present
   *  next to `<id>.ts`. Sent alongside each /api/components/refine prompt so
   *  the model has the primitive's evolving spec in context. Empty
   *  string when the .md file doesn't exist. */
  instructions: string;
  /** Where this entry was read from. 'bundle' = src/lib/cad/components
   *  in the shipped image. 'volume' = $APP_DATA_DIR/components, written
   *  by /api/components/save in prod. A 'volume' entry might not have
   *  bundled geom yet — see hasGeom. */
  origin: 'bundle' | 'volume';
  /** True when the build-time component registry has a compiled geom
   *  function for this id. Always true for 'bundle' entries; for
   *  'volume' entries, true only when the id collides with a bundled
   *  primitive (the overlay shadows the bundle source but reuses its
   *  geom). false means "needs bundle rebuild to render". */
  hasGeom: boolean;
}

async function dirSig(dir: string): Promise<string> {
  // Snapshot a directory's relevant files + mtimes for cache invalidation.
  // Missing dir is fine — returns empty string, contributes nothing.
  if (!existsSync(dir)) return '';
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return '';
  }
  const files = entries.filter((f) => (f.endsWith('.ts') || f.endsWith('.md')) && f !== 'index.ts');
  const parts: string[] = [];
  for (const f of files.sort()) {
    try {
      const s = await stat(join(dir, f));
      parts.push(`${f}:${s.mtimeMs}`);
    } catch { /* file disappeared between readdir and stat — skip */ }
  }
  return parts.join('|');
}

async function buildSignature(): Promise<string> {
  // Cover both read sources so cache invalidation reflects either side.
  const a = await dirSig(SRC_DIR);
  const b = await dirSig(VOLUME_DIR);
  return `bundle:${a}|volume:${b}`;
}

// ── Source-text meta extractor ───────────────────────────────────────────
//
// The component files have a well-controlled format (see hollow_cylinder.ts
// for the canonical shape). We extract the `meta` object via brace-walk
// + targeted regexes — no dynamic import, no eval. This:
//   - works for any file the API can READ (codebase, /data volume, S3 sync)
//   - sidesteps TS-vs-JS parsing concerns at runtime
//   - keeps the list endpoint fast (regex on small source files)

/** Find the body of `export const meta = { ... }` — returns the inside
 *  (between the outermost braces) or null if not present. */
function extractMetaBody(src: string): string | null {
  const re = /export\s+const\s+meta\s*=\s*\{/;
  const m = re.exec(src);
  if (!m) return null;
  let i = m.index + m[0].length;
  let depth = 1;
  while (i < src.length && depth > 0) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    if (depth === 0) return src.slice(m.index + m[0].length, i);
    i++;
  }
  return null;
}

/** Pull a top-level field's raw value from inside the meta body. Walks
 *  the body forward, skipping nested braces/brackets/strings to find a
 *  field at depth 0. Returns the trimmed value text, or null. */
function pullField(body: string, field: string): string | null {
  const head = new RegExp(`(^|,|\\{|\\n)\\s*${field}\\s*:\\s*`);
  const m = head.exec(body);
  if (!m) return null;
  const start = m.index + m[0].length;
  // Walk forward to the next top-level comma or end of body, balancing
  // quotes/braces/brackets/parens.
  let i = start;
  let depth = 0;
  let inS: '"' | "'" | '`' | null = null;
  while (i < body.length) {
    const c = body[i];
    if (inS) {
      if (c === '\\') { i += 2; continue; }
      if (c === inS) inS = null;
    } else {
      if (c === '"' || c === "'" || c === '`') inS = c as any;
      else if (c === '{' || c === '[' || c === '(') depth++;
      else if (c === '}' || c === ']' || c === ')') {
        if (depth === 0) break;
        depth--;
      } else if (c === ',' && depth === 0) break;
    }
    i++;
  }
  return body.slice(start, i).trim();
}

function unquoteString(v: string | null): string | undefined {
  if (!v) return undefined;
  const m = /^['"`](.*)['"`]$/s.exec(v);
  return m ? m[1] : undefined;
}

function parseTagsArray(v: string | null): string[] {
  if (!v) return [];
  const m = /^\[([\s\S]*)\]$/.exec(v.trim());
  if (!m) return [];
  return [...m[1].matchAll(/['"`]([^'"`]+)['"`]/g)].map((mm) => mm[1]);
}

/** Parse the params object's body (the text between the outermost
 *  `{ ... }` of the params: { ... } block). Each entry is one line:
 *    name: { label: '...', min: N, max: N, step: N, unit: '...', default: N, type: '...' },
 *  Walks brace depth so nested objects don't confuse the comma split. */
function parseParams(v: string | null): Record<string, Record<string, unknown>> {
  if (!v) return {};
  const m = /^\{([\s\S]*)\}$/.exec(v.trim());
  if (!m) return {};
  const body = m[1];
  const out: Record<string, Record<string, unknown>> = {};

  // Tokenize entries by walking brace depth.
  const entries: string[] = [];
  let i = 0, start = 0, depth = 0;
  let inS: '"' | "'" | '`' | null = null;
  while (i < body.length) {
    const c = body[i];
    if (inS) {
      if (c === '\\') { i += 2; continue; }
      if (c === inS) inS = null;
    } else {
      if (c === '"' || c === "'" || c === '`') inS = c as any;
      else if (c === '{' || c === '[' || c === '(') depth++;
      else if (c === '}' || c === ']' || c === ')') depth--;
      else if (c === ',' && depth === 0) {
        const e = body.slice(start, i).trim();
        if (e) entries.push(e);
        start = i + 1;
      }
    }
    i++;
  }
  const tail = body.slice(start).trim();
  if (tail) entries.push(tail);

  for (const e of entries) {
    const km = /^(\w+)\s*:\s*\{([\s\S]*)\}$/.exec(e);
    if (!km) continue;
    const name = km[1];
    const inner = km[2];
    const rec: Record<string, unknown> = {};
    // Each subfield is `key: literal` separated by commas. Most are
    // numeric / string / bool — but a `choices: { ... }` nested object
    // is also supported (used for lookup-style discrete params).
    for (const fm of inner.matchAll(/(\w+)\s*:\s*(\{[^}]*\}|'[^']*'|"[^"]*"|`[^`]*`|-?\d+(?:\.\d+)?(?:e-?\d+)?|true|false)/g)) {
      const k = fm[1];
      const raw = fm[2];
      let val: unknown;
      if (raw.startsWith('{')) {
        const obj: Record<string, number> = {};
        for (const om of raw.matchAll(/(\w+)\s*:\s*(-?\d+(?:\.\d+)?)/g)) {
          obj[om[1]] = Number(om[2]);
        }
        val = obj;
      } else if (raw.startsWith("'") || raw.startsWith('"') || raw.startsWith('`')) {
        val = raw.slice(1, -1);
      } else if (raw === 'true') val = true;
      else if (raw === 'false') val = false;
      else val = Number(raw);
      rec[k] = val;
    }
    out[name] = rec;
  }
  return out;
}

/** Read a single component file (and its .md sibling, if present) into
 *  a ComponentListEntry. Returns null when the source can't be parsed
 *  as a valid component (missing meta block, missing id, etc). */
async function readComponentFile(
  dir: string,
  filename: string,
  origin: 'bundle' | 'volume',
  bundledIds: Set<string>,
): Promise<ComponentListEntry | null> {
  const path = join(dir, filename);
  let source = '';
  try { source = await readFile(path, 'utf8'); } catch { return null; }
  const body = extractMetaBody(source);
  if (!body) return null;
  const id = unquoteString(pullField(body, 'id'));
  const name = unquoteString(pullField(body, 'name'));
  if (!id || !name) return null;
  // Read the .md sibling from the SAME directory the .ts came from —
  // volume .md sits next to volume .ts, bundle .md sits next to bundle .ts.
  let instructions = '';
  try { instructions = await readFile(join(dir, `${id}.md`), 'utf8'); } catch { /* no .md */ }
  // A volume entry has bundled geom only when the id ALSO exists in the
  // build-time bundle (i.e. the overlay shadows a known primitive's source
  // but reuses its compiled geom function). Brand-new volume-only ids
  // have no geom until the bundle rebuilds.
  const hasGeom = origin === 'bundle' || bundledIds.has(id);
  return {
    id,
    name,
    description: unquoteString(pullField(body, 'description')) ?? '',
    tags: parseTagsArray(pullField(body, 'tags')),
    params: parseParams(pullField(body, 'params')),
    hasValidate: /\bvalidate\s*:/.test(body),
    source,
    instructions,
    origin,
    hasGeom,
  };
}

async function readDir(dir: string, origin: 'bundle' | 'volume', bundledIds: Set<string>): Promise<ComponentListEntry[]> {
  if (!existsSync(dir)) return [];
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const files = entries.filter((f) => f.endsWith('.ts') && f !== 'index.ts');
  const out: ComponentListEntry[] = [];
  for (const f of files) {
    const rec = await readComponentFile(dir, f, origin, bundledIds);
    if (rec) out.push(rec);
  }
  return out;
}

async function buildList(): Promise<ComponentListEntry[]> {
  // First pass — discover which ids the bundle ships. Used by the second
  // pass to decide whether a volume entry has compiled geom available.
  // A volume entry shadowing a bundle id inherits the bundle's geom; a
  // volume-only entry needs a bundle rebuild before it can render.
  const bundleFirst = await readDir(SRC_DIR, 'bundle', new Set());
  const bundledIds = new Set(bundleFirst.map((e) => e.id));

  // Second pass — re-read bundle (so hasGeom is true) plus the volume
  // overlay. Volume wins on id collision, so we Map-merge with volume
  // last.
  const merged = new Map<string, ComponentListEntry>();
  const bundle = await readDir(SRC_DIR, 'bundle', bundledIds);
  for (const e of bundle) merged.set(e.id, e);
  const volume = await readDir(VOLUME_DIR, 'volume', bundledIds);
  for (const e of volume) merged.set(e.id, e);

  // Stable alphabetical order so the sidebar doesn't reshuffle on refresh.
  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export const GET: RequestHandler = async ({ request }) => {
  // NOT proxied. The local dev app renders components from its
  // build-time import.meta.glob over the LOCAL src/ tree — so the list
  // must reflect what's actually renderable here (local bundle + local
  // volume overlay), not prod's. Proxying made the UI show prod-only
  // components the local app can't render ("Unknown component"). All
  // /api/components/* endpoints are dev-local for the same reason.
  let signature: string;
  try {
    signature = await buildSignature();
  } catch (e: any) {
    throw error(500, `Failed to scan components directory: ${e?.message ?? e}`);
  }

  // Serve from cache when nothing has changed.
  const cached = getCachedList();
  if (cached && cached.signature === signature) {
    if (request.headers.get('if-none-match') === signature) {
      return new Response(null, { status: 304, headers: { etag: signature } });
    }
    return json(cached.payload as ComponentListEntry[], {
      headers: { etag: signature, 'cache-control': 'no-cache' },
    });
  }

  let payload: ComponentListEntry[];
  try {
    payload = await buildList();
  } catch (e: any) {
    throw error(500, `Failed to build components list: ${e?.message ?? e}`);
  }

  setCachedList({ signature, payload });
  return json(payload, { headers: { etag: signature, 'cache-control': 'no-cache' } });
};
