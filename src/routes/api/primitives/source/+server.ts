import { json, error } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

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

export const GET = async ({ url }) => {
  const name = url.searchParams.get('name');
  if (!name) throw error(400, 'name query param required');
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw error(400, 'invalid primitive name');
  const src = await readFile(HELPERS_PATH, 'utf8');
  const extracted = extractSource(src, name);
  if (!extracted) throw error(404, `primitive "${name}" not found`);
  return json({ source: extracted });
};
