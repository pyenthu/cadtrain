import { json, error } from '@sveltejs/kit';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import { volumePath } from '$lib/server/volume';
import { extractMetaFromSource } from '$lib/server/primitives-meta';

// Stage G v1 of the components/primitives split — see
// ~/.claude/plans/components-primitives-split.md.
//
// Returns the raw TypeScript source for a single bundle primitive.
// The /primitives editor uses this so the "Load from server" button
// can refresh the editor pane against on-disk content (vs in-memory
// edits). Future: volume-loaded primitives will resolve here too —
// query goes to <volume>/primitives/<name>/source.ts before falling
// back to the bundle.
//
// GET /api/primitives/source?name=helix_band
//   → { source: "<JSDoc + function + body>" }

const HELPERS_PATH = resolve(process.cwd(), 'src/lib/cad/manifold-helpers.ts');

function extractSource(src: string, name: string): string {
  // Same algorithm as the client-side extractor — keeps the two in sync.
  // (Future: factor into a shared util once we have a second caller.)
  const needle = `export function ${name}`;
  const idx = src.indexOf(needle);
  if (idx < 0) return '';
  let i = idx + needle.length;
  while (i < src.length && src[i] !== '{') i++;
  if (i >= src.length) return '';
  let depth = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  let docStart = idx;
  const docMatch = src.lastIndexOf('/**', idx);
  if (docMatch >= 0 && src.slice(docMatch, idx).match(/\*\/\s*$/)) {
    docStart = docMatch;
  }
  return src.slice(docStart, i);
}

// Resolve a primitive's source.ts under the volume's primitives/ tree.
// Post-restructure (2026-05-23) parts live in CATEGORY sub-folders — basic/,
// industrial/, archive/, and the nested completions/<family>/ — instead of
// flat. We search: flat primitives/<name>/, then one level deep
// (primitives/<cat>/<name>/), then two (primitives/<cat>/<family>/<name>/),
// so the lookup survives future category renames without another code edit.
async function findVolumeSource(name: string): Promise<string | null> {
  const root = volumePath('primitives');
  if (!existsSync(root)) return null;
  const direct = join(root, name, 'source.ts');
  if (existsSync(direct)) return direct;
  let lvl1;
  try { lvl1 = await readdir(root, { withFileTypes: true }); } catch { return null; }
  for (const cat of lvl1) {
    if (!cat.isDirectory()) continue;
    const p1 = join(root, cat.name, name, 'source.ts');
    if (existsSync(p1)) return p1;
    let lvl2;
    try { lvl2 = await readdir(join(root, cat.name), { withFileTypes: true }); } catch { continue; }
    for (const fam of lvl2) {
      if (!fam.isDirectory()) continue;
      const p2 = join(root, cat.name, fam.name, name, 'source.ts');
      if (existsSync(p2)) return p2;
    }
  }
  return null;
}

export const GET = async ({ url }) => {
  const name = url.searchParams.get('name');
  if (!name) throw error(400, 'name query param required');
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw error(400, 'invalid primitive name');
  // Volume first — a volume primitive with the same id SHADOWS the bundle.
  const volSrc = await findVolumeSource(name);
  if (volSrc) {
    const src = await readFile(volSrc, 'utf8');
    // Return the extracted meta too — the list is now a cheap directory
    // listing (no params), so the params/name/description load HERE,
    // lazily, when a primitive is opened. Meta-less/old sources just omit.
    let meta: any = null;
    try { meta = extractMetaFromSource(src); } catch { /* leave null */ }
    return json({
      source: src, origin: 'volume',
      name: meta?.name, description: meta?.description, params: meta?.params ?? {},
      profiles: meta?.profiles ?? {},
    });
  }
  // Bundle fallback — reads the compiled-in helpers source. This file is NOT
  // shipped in the production runtime image (only the built output is), so
  // guard against it: a missing file means "not a volume part and no source
  // to extract" → 404, never a 500.
  if (!existsSync(HELPERS_PATH)) throw error(404, `primitive "${name}" not found`);
  const src = await readFile(HELPERS_PATH, 'utf8');
  const extracted = extractSource(src, name);
  if (!extracted) throw error(404, `primitive "${name}" not found`);
  return json({ source: extracted, origin: 'bundle' });
};
