/**
 * /api/rag/scan-refs — report (and optionally repair) cross-references
 * to a renamed primitive id (#165).
 *
 *   POST /api/rag/scan-refs?old=<oldId>&new=<newId>          → report-only
 *   POST /api/rag/scan-refs?old=<oldId>&new=<newId>&repair=1 → rewrite each
 *                                                              affected file
 *
 * Walks every `<id>.{prim,asm,prvl,prex,rev,exp}.ts` file under
 * `<volume>/primitives/` (active + archived) and finds primitives whose
 * source mentions `src: '<oldId>'` — the canonical place a graph-editor
 * Call node carries a reference to another primitive (meta.graph block).
 * Also catches the parts-builder pattern `meta.uses: [..., 'oldId', ...]`
 * so a renamed leaf surfaces in any assembly that lists it as a dep.
 *
 * Default behaviour (no `repair`): return the list of affected ids
 * without touching disk — the UI uses this to size a toast for the user.
 *
 * Repair mode (`?repair=1`): regex-rewrite each match in place:
 *   - `src: '<old>'`  → `src: '<new>'`  (graph-editor Call src)
 *   - `'<old>'` inside a `uses: [...]` array  → `'<new>'`
 * Then write the updated source back via `fs.writeFile` to the same path.
 * The match is intentionally narrow — we only touch the two grammars we
 * know how to undo. A string literal `'<old>'` floating in a comment or
 * a debug log stays untouched.
 *
 * Lives under /api/rag/ because that's where the user spec placed it —
 * paired with the corpus rebuild endpoint, both touch the volume's
 * primitives tree at a corpus level. Functionally it is a primitives
 * cross-reference scanner; the path is a convention choice.
 *
 * Proxied to prod via hooks.server.ts (single live store, Rule 13).
 */

import { json, error } from '@sveltejs/kit';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { volumePath } from '$lib/server/volume';

const ID_RE = /^[a-z][a-z0-9_]*$/i;
const PART_EXT_RE = /\.(prim|exp|rev|asm|prvl|prex)\.ts$/i;

/** Best-effort directory walk over `<volume>/primitives/` (any depth).
 *  Skips anything that can't be readdir'd rather than throwing — a flaky
 *  file or permission glitch in one corner shouldn't abort the scan. */
async function walkParts(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: import('node:fs').Dirent[] = [];
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { await walk(p); continue; }
      if (!e.isFile()) continue;
      if (PART_EXT_RE.test(e.name)) out.push(p);
    }
  }
  await walk(root);
  return out;
}

/** Build the two regexes that match a reference to `oldId`:
 *   1. graph-editor Call src — `src: 'oldId'` (single OR double quotes).
 *   2. parts uses — a quoted oldId inside a `uses: [...]` array literal.
 *  The uses regex is permissive about whitespace and accepts any order
 *  inside the array. */
function buildRefRegexes(oldId: string) {
  const esc = oldId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // src: 'oldId'  or  src:"oldId"
  const reSrc = new RegExp(`\\bsrc\\s*:\\s*(['"])${esc}\\1`, 'g');
  // uses: [..., 'oldId', ...] — match the full uses array then check the id.
  // We do this in two phases (find the array, then check membership) so the
  // single-pass regex stays simple. The array regex is non-greedy on its
  // contents to avoid eating across multiple arrays in pathological files.
  const reUses = new RegExp(`\\buses\\s*:\\s*\\[[^\\]]*?\\b${esc}\\b[^\\]]*?\\]`);
  return { reSrc, reUses };
}

/** Derive the affected primitive's own id from its filename. Returns null
 *  if the filename doesn't fit the `<id>.<kind>.ts` shape (defensive — the
 *  walk filter already enforces this). */
function idFromFile(path: string): string | null {
  const base = path.split('/').pop() ?? '';
  const m = base.match(/^([a-z][a-z0-9_]*)\.(prim|exp|rev|asm|prvl|prex)\.ts$/i);
  return m ? m[1] : null;
}

/** Rewrite every reference to oldId in `src`, returning the new source AND
 *  the count of substitutions made (so the caller can report "repaired N
 *  files" rather than "touched N files"). Two passes: src:'oldId' first,
 *  then quoted oldId inside any uses:[…] array. We re-parse the uses arrays
 *  string-by-string rather than running a regex with backreferences. */
function rewriteSource(src: string, oldId: string, newId: string): { out: string; n: number } {
  const esc = oldId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let n = 0;
  let out = src;

  // Pass 1: src: 'oldId'  →  src: 'newId'
  out = out.replace(new RegExp(`(\\bsrc\\s*:\\s*)(['"])${esc}\\2`, 'g'), (_m, p1, q) => {
    n += 1;
    return `${p1}${q}${newId}${q}`;
  });

  // Pass 2: uses: [..., 'oldId', ...] — find each uses array, then swap any
  // bare 'oldId' inside it. Scoped to the array so we don't accidentally
  // touch the user's string literals outside the deps list.
  const reUsesArr = new RegExp(`(\\buses\\s*:\\s*\\[)([^\\]]*)(\\])`, 'g');
  out = out.replace(reUsesArr, (_m, head, body, tail) => {
    const newBody = body.replace(
      new RegExp(`(['"])${esc}\\1`, 'g'),
      (_mm: string, q: string) => { n += 1; return `${q}${newId}${q}`; },
    );
    return `${head}${newBody}${tail}`;
  });

  return { out, n };
}

export const POST = async ({ url }) => {
  const oldId = url.searchParams.get('old');
  const newId = url.searchParams.get('new');
  const repair = url.searchParams.get('repair') === '1' || url.searchParams.get('repair') === 'true';

  if (!oldId || !ID_RE.test(oldId)) throw error(400, 'old query param required (lowercase id)');
  if (!newId || !ID_RE.test(newId)) throw error(400, 'new query param required (lowercase id)');
  if (oldId === newId) return json({ ok: true, affected: [], repaired: [], note: 'no change' });

  const root = volumePath('primitives');
  if (!existsSync(root)) return json({ ok: true, affected: [], repaired: [], note: 'no primitives dir' });

  const { reSrc, reUses } = buildRefRegexes(oldId);
  const files = await walkParts(root);

  const affected: { id: string; path: string }[] = [];
  for (const path of files) {
    let src = '';
    try { src = await readFile(path, 'utf8'); } catch { continue; }
    // Skip the renamed file itself — its meta.id was already rewritten by
    // /api/primitives/rename, and a self-reference in meta.uses is a
    // legitimate (if rare) thing the user should not see fixed up.
    const ownId = idFromFile(path);
    if (ownId === newId || ownId === oldId) continue;
    // reUses has a single shot per file (good enough for this binary signal);
    // reSrc gets a fresh `lastIndex = 0` per file since it's /g.
    reSrc.lastIndex = 0;
    if (reSrc.test(src) || reUses.test(src)) {
      affected.push({ id: ownId ?? path, path });
    }
  }

  if (!repair) {
    return json({
      ok: true,
      oldId, newId,
      affected: affected.map((a) => a.id),
      repaired: [],
    });
  }

  // Repair pass: re-read + rewrite + write each affected file. We re-read
  // rather than cache the source from the scan above because between the
  // scan and the rewrite a concurrent /save could have landed.
  const repaired: string[] = [];
  const failed: { id: string; error: string }[] = [];
  for (const { id, path } of affected) {
    try {
      const before = await readFile(path, 'utf8');
      const { out, n } = rewriteSource(before, oldId, newId);
      if (n === 0) continue; // no-op (scan was a false positive)
      await writeFile(path, out, 'utf8');
      repaired.push(id);
    } catch (e: any) {
      failed.push({ id, error: e?.message ?? String(e) });
    }
  }

  return json({
    ok: true,
    oldId, newId,
    affected: affected.map((a) => a.id),
    repaired,
    failed,
  });
};
