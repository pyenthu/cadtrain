/**
 * GET /api/components/list
 *
 * Returns the current registry of single-file components from two sources:
 *
 *   1. **Bundle** — `src/lib/cad/components/<id>.ts` shipped in the
 *      runtime image. The 26 baseline primitives. `origin: 'bundle'`,
 *      `renderMode: 'client'` — Vite's `import.meta.glob` compiled their
 *      geom, so the client runs it directly. Classified by families.ts.
 *   2. **Library** — `<volume>/library/<category>/<id>/component.ts`.
 *      Each part is a self-contained directory (see `library.ts`); its
 *      LOCATION is its category. `origin` IS the category
 *      (`test` | `basic` | `parts` | `assemblies`), `renderMode:
 *      'server'` — rendered via /api/components/geom. `family` / `level`
 *      come from the part's `meta.json`; `picture` points at its
 *      `picture.png` if present.
 *
 * On id collision, the library part wins (it's the live authored copy).
 *
 * Each entry carries the metadata the sidebar + Inspector need (id /
 * name / params / validate? presence) plus the raw `component.ts`
 * source for the Inspector's editor.
 *
 * NOT proxied — authoring is dev-local. Only /api/components/geom (a
 * data read) proxies.
 *
 * Cache: small in-memory cache keyed by an mtime signature across the
 * bundle dir + every library part. Invalidated by save / instructions /
 * delete / move on write.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readdir, readFile, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { getCachedList, setCachedList } from './cache';
import {
  listLibraryParts,
  type LibraryCategory,
  type ResolvedPart,
} from '$lib/server/library';

const SRC_DIR = join(process.cwd(), 'src', 'lib', 'cad', 'components');

interface ComponentListEntry {
  id: string;
  name: string;
  description?: string;
  tags?: readonly string[];
  params: Record<string, unknown>;
  hasValidate: boolean;
  source: string;
  /** Per-component AI instructions doc — content of the `.md` sidecar
   *  (`instructions.md` for a library part, `<id>.md` for a bundle
   *  primitive). Sent with each /api/components/refine prompt. Empty
   *  when absent. */
  instructions: string;
  /** Where this entry was read from:
   *   - 'bundle' — src/lib/cad/components in the shipped image.
   *   - 'test' | 'basic' | 'parts' | 'assemblies' — the library
   *     category directory the part currently sits in. */
  origin: 'bundle' | LibraryCategory;
  /** Fine classification axis, from a library part's `meta.json`.
   *  `family` for Parts, `level` for Basic. Absent for bundle entries
   *  (they use families.ts) and uncategorized library parts. */
  family?: string;
  level?: number;
  /** Assembly-level toggle from a library part's `meta.json`. When
   *  true (default), the inspector auto-inserts a `mv` transform on
   *  every newly-added part so it stacks below the previous one.
   *  Absent for bundle entries. */
  autoTranslate?: boolean;
  /** Per-instance viewer colours from a library part's `meta.json`,
   *  keyed by instance name (`A`, `B`, ...). Phase A: inspector surfaces
   *  a swatch + left-border stripe; scene + GLB unchanged. Unset
   *  instances fall back to a hash-by-name palette default at the UI
   *  layer. Absent for bundle entries. */
  instanceColors?: Record<string, string>;
  /** Per-instance CSG op from a library part's `meta.json`, keyed by
   *  instance name (`A`, `B`, ...). 'add' | 'subtract' | 'intersect'.
   *  Used by the loader to rewrite `geom.add(<inst>);` at execute time.
   *  Unset entries default to 'add'. Absent for bundle entries (they
   *  always render client-side from the static .ts). */
  instanceOps?: Record<string, 'add' | 'subtract' | 'intersect'>;
  /** Per-instance placement mode from `meta.json`, keyed by instance
   *  name (`A`, `B`, ...). 'stack' (default) | 'overlay' | 'origin'.
   *  Used by the loader to rewrite the `top:` arg per instance. */
  instanceTopMode?: Record<string, 'stack' | 'overlay' | 'origin'>;
  /** Offset for instances in 'overlay' mode. Number, part units. */
  instanceTopOffset?: Record<string, number>;
  /** Ready-to-use URL for the part's `picture.png` — the dev-local
   *  `/api/components/picture?id=<id>` endpoint. Absent for bundle
   *  entries and library parts with no picture. */
  picture?: string;
  /** True when a compiled geom for this id is in the build-time bundle
   *  (always true for `origin: 'bundle'`). false → renders server-side
   *  via /api/components/geom. */
  hasGeom: boolean;
  /** How the client obtains geometry: 'client' runs the compiled geom
   *  directly; 'server' POSTs to /api/components/geom. */
  renderMode: 'client' | 'server';
}

// ── Cache signature ──────────────────────────────────────────────────────────

async function bundleSig(): Promise<string> {
  if (!existsSync(SRC_DIR)) return '';
  let entries: string[];
  try {
    entries = await readdir(SRC_DIR);
  } catch {
    return '';
  }
  const files = entries.filter((f) => (f.endsWith('.ts') || f.endsWith('.md')) && f !== 'index.ts');
  const parts: string[] = [];
  for (const f of files.sort()) {
    try {
      const s = await stat(join(SRC_DIR, f));
      parts.push(`${f}:${s.mtimeMs}`);
    } catch { /* file vanished between readdir + stat — skip */ }
  }
  return parts.join('|');
}

async function librarySig(parts: ResolvedPart[]): Promise<string> {
  const out: string[] = [];
  for (const p of parts) {
    let cm = 0;
    let mm = 0;
    try { cm = (await stat(p.componentPath)).mtimeMs; } catch { /* gone — skip mtime */ }
    try { mm = (await stat(join(p.dir, 'meta.json'))).mtimeMs; } catch { /* no meta.json */ }
    out.push(`${p.category}/${p.id}:${cm}:${mm}:${p.hasPicture ? 'P' : ''}${p.hasInstructions ? 'M' : ''}`);
  }
  return out.join('|');
}

// ── Source-text meta extractor ───────────────────────────────────────────────
//
// Component files have a well-controlled format (see hollow_cylinder.ts for
// the canonical shape). We extract `meta` via brace-walk + targeted regexes
// — no dynamic import, no eval. Works for any file the API can READ and
// sidesteps TS-vs-JS runtime parsing.

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

/** Pull a top-level field's raw value from inside the meta body. */
function pullField(body: string, field: string): string | null {
  const head = new RegExp(`(^|,|\\{|\\n)\\s*${field}\\s*:\\s*`);
  const m = head.exec(body);
  if (!m) return null;
  const start = m.index + m[0].length;
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

/** Parse the params object's body. */
function parseParams(v: string | null): Record<string, Record<string, unknown>> {
  if (!v) return {};
  const m = /^\{([\s\S]*)\}$/.exec(v.trim());
  if (!m) return {};
  const body = m[1];
  const out: Record<string, Record<string, unknown>> = {};

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

/** Parsed component-source fields shared by bundle + library entries. */
interface ParsedComponent {
  id: string;
  name: string;
  description: string;
  tags: string[];
  params: Record<string, unknown>;
  hasValidate: boolean;
}

/** Parse a `component.ts` / `<id>.ts` source string into its meta fields.
 *  Returns null when the source isn't a valid component (no meta block,
 *  missing id/name). */
function parseComponentSource(source: string): ParsedComponent | null {
  const body = extractMetaBody(source);
  if (!body) return null;
  const id = unquoteString(pullField(body, 'id'));
  const name = unquoteString(pullField(body, 'name'));
  if (!id || !name) return null;
  return {
    id,
    name,
    description: unquoteString(pullField(body, 'description')) ?? '',
    tags: parseTagsArray(pullField(body, 'tags')),
    params: parseParams(pullField(body, 'params')),
    hasValidate: /\bvalidate\s*:/.test(body),
  };
}

// ── Read sources ─────────────────────────────────────────────────────────────

async function readBundleEntries(): Promise<ComponentListEntry[]> {
  if (!existsSync(SRC_DIR)) return [];
  let entries: string[];
  try {
    entries = await readdir(SRC_DIR);
  } catch {
    return [];
  }
  const out: ComponentListEntry[] = [];
  for (const f of entries.filter((f) => f.endsWith('.ts') && f !== 'index.ts')) {
    let source = '';
    try { source = await readFile(join(SRC_DIR, f), 'utf8'); } catch { continue; }
    const parsed = parseComponentSource(source);
    if (!parsed) continue;
    let instructions = '';
    try { instructions = await readFile(join(SRC_DIR, `${parsed.id}.md`), 'utf8'); } catch { /* no .md */ }
    out.push({
      id: parsed.id,
      name: parsed.name,
      description: parsed.description,
      tags: parsed.tags,
      params: parsed.params,
      hasValidate: parsed.hasValidate,
      source,
      instructions,
      origin: 'bundle',
      hasGeom: true,
      renderMode: 'client',
    });
  }
  return out;
}

async function readLibraryEntries(): Promise<ComponentListEntry[]> {
  const parts = await listLibraryParts();
  const out: ComponentListEntry[] = [];
  for (const part of parts) {
    let source = '';
    try { source = await readFile(part.componentPath, 'utf8'); } catch { continue; }
    const parsed = parseComponentSource(source);
    if (!parsed) continue;
    let instructions = '';
    if (part.hasInstructions) {
      try { instructions = await readFile(join(part.dir, 'instructions.md'), 'utf8'); } catch { /* race */ }
    }
    out.push({
      id: parsed.id,
      name: parsed.name,
      description: parsed.description,
      tags: parsed.tags,
      params: parsed.params,
      hasValidate: parsed.hasValidate,
      source,
      instructions,
      origin: part.category,
      ...(part.meta.family ? { family: part.meta.family } : {}),
      ...(part.meta.level != null ? { level: part.meta.level } : {}),
      ...(part.meta.autoTranslate != null ? { autoTranslate: part.meta.autoTranslate } : {}),
      ...(part.meta.instanceColors ? { instanceColors: part.meta.instanceColors } : {}),
      ...(part.meta.instanceOps ? { instanceOps: part.meta.instanceOps } : {}),
      ...(part.meta.instanceTopMode ? { instanceTopMode: part.meta.instanceTopMode } : {}),
      ...(part.meta.instanceTopOffset ? { instanceTopOffset: part.meta.instanceTopOffset } : {}),
      ...(part.hasPicture ? { picture: `/api/components/picture?id=${encodeURIComponent(parsed.id)}` } : {}),
      hasGeom: false,
      renderMode: 'server',
    });
  }
  return out;
}

async function buildList(parts: ResolvedPart[]): Promise<ComponentListEntry[]> {
  // Merge bundle + library. Library wins on id collision — it's the live
  // authored copy; a bundle primitive of the same id is the stale baseline.
  const merged = new Map<string, ComponentListEntry>();
  for (const e of await readBundleEntries()) merged.set(e.id, e);
  for (const e of await readLibraryEntries()) merged.set(e.id, e);
  // `parts` is unused here directly — it's resolved once in GET and reused
  // for the signature; readLibraryEntries re-lists, which is fine (cached).
  void parts;
  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export const GET: RequestHandler = async ({ request }) => {
  // NOT proxied — authoring is dev-local (see file header).
  let signature: string;
  let parts: ResolvedPart[];
  try {
    parts = await listLibraryParts();
    signature = `bundle:${await bundleSig()}|lib:${await librarySig(parts)}`;
  } catch (e: any) {
    throw error(500, `Failed to scan component sources: ${e?.message ?? e}`);
  }

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
    payload = await buildList(parts);
  } catch (e: any) {
    throw error(500, `Failed to build components list: ${e?.message ?? e}`);
  }

  setCachedList({ signature, payload });
  return json(payload, { headers: { etag: signature, 'cache-control': 'no-cache' } });
};
