/**
 * GET /api/components/list
 *
 * Returns the current registry of single-file components. Replaces the
 * build-time `import.meta.glob` discovery in src/lib/cad/components/
 * — that pattern doesn't pick up brand-new files in a long-running
 * dev session, and won't work at all when primitives eventually live
 * outside the source tree (Railway volume; task #18).
 *
 * Each entry carries the metadata needed by the sidebar + Inspector
 * (id / name / params / validate? presence) plus the raw .ts source
 * text for the Inspector's Svelte tab. The geom function itself is
 * NOT serialized — it's still imported statically by the registry
 * loader and joined to the API response by id, so geometry execution
 * stays local to the client bundle (no eval, no network round-trip
 * per slider drag).
 *
 * Cache: small in-memory cache keyed by file mtime. Invalidated by
 * /api/components/save (writes call invalidateRunesListCache). ETag header
 * lets the browser short-circuit unchanged responses.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readdir, readFile, stat } from 'fs/promises';
import { join } from 'path';
import { getCachedList, setCachedList } from './cache';

const SRC_DIR = join(process.cwd(), 'src', 'lib', 'cad', 'components');

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
}

async function buildSignature(): Promise<string> {
  // Include both .ts and .md mtimes — editing the instructions doc for
  // a primitive must invalidate the cached list so the new instructions
  // are picked up on the next request.
  const all = await readdir(SRC_DIR);
  const files = all.filter((f) => (f.endsWith('.ts') || f.endsWith('.md')) && f !== 'index.ts');
  const parts: string[] = [];
  for (const f of files.sort()) {
    const s = await stat(join(SRC_DIR, f));
    parts.push(`${f}:${s.mtimeMs}`);
  }
  return parts.join('|');
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

async function buildList(): Promise<ComponentListEntry[]> {
  const files = (await readdir(SRC_DIR)).filter(
    (f) => f.endsWith('.ts') && f !== 'index.ts',
  );
  const out: ComponentListEntry[] = [];
  for (const f of files) {
    const path = join(SRC_DIR, f);
    let source = '';
    try { source = await readFile(path, 'utf8'); } catch { continue; }
    const body = extractMetaBody(source);
    if (!body) continue;
    const id = unquoteString(pullField(body, 'id'));
    const name = unquoteString(pullField(body, 'name'));
    if (!id || !name) continue;
    // Read the optional <id>.md alongside the .ts. Missing file = empty
    // instructions; the AI tab will surface that as a "start writing"
    // placeholder.
    let instructions = '';
    try { instructions = await readFile(join(SRC_DIR, `${id}.md`), 'utf8'); } catch { /* no .md */ }
    out.push({
      id,
      name,
      description: unquoteString(pullField(body, 'description')) ?? '',
      tags: parseTagsArray(pullField(body, 'tags')),
      params: parseParams(pullField(body, 'params')),
      hasValidate: /\bvalidate\s*:/.test(body),
      source,
      instructions,
    });
  }
  // Stable alphabetical order so the sidebar doesn't reshuffle on refresh.
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export const GET: RequestHandler = async ({ request }) => {
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
