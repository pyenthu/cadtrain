import { json, error } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { extractMetaFromSource } from '$lib/server/primitives-meta';
import { findPrim } from '$lib/server/primitive-paths';
import { stdlibSource } from '$lib/server/stdlib';

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
  // Stdlib FIRST — git-tracked src primitives are canonical and read-only, so
  // they SHADOW any same-named volume part (the opposite of the manifold-helpers
  // bundle fallback below, which a volume part may override). editable:false is
  // the GUI's read-only signal.
  const std = stdlibSource(name);
  if (std) {
    let meta: any = null;
    try { meta = extractMetaFromSource(std); } catch { /* leave null */ }
    return json({
      source: std, origin: 'stdlib', editable: false,
      name: meta?.name, description: meta?.description, params: meta?.params ?? {},
      profiles: meta?.profiles ?? {},
    });
  }
  // Volume next — a volume primitive with the same id SHADOWS the bundle.
  // ACTIVE-ONLY (findPrim defaults to active): archive/ is never resolved here,
  // so an archived copy can't shadow the active part (the save-doesn't-persist
  // bug). Save is likewise active-only — load + save now agree.
  const hit = await findPrim(name);
  if (hit) {
    const src = await readFile(hit.path, 'utf8');
    // Return the extracted meta too — the list is now a cheap directory
    // listing (no params), so the params/name/description load HERE,
    // lazily, when a primitive is opened. Meta-less/old sources just omit.
    let meta: any = null;
    try { meta = extractMetaFromSource(src); } catch { /* leave null */ }
    return json({
      source: src, origin: 'volume',
      // File-kind mid-extension — drives the typed-builder dispatch in
      // PrimitiveView (exp → ExtrudePartBuilder, rev → RevolvePartBuilder,
      // asm → AssemblyEditor, prim → legacy AssemblyEditor). Comes from
      // findPrim's PRIM_KINDS-aware resolution.
      kind: hit.kind,
      name: meta?.name, description: meta?.description, params: meta?.params ?? {},
      profiles: meta?.profiles ?? {},
      // K.63 composition graph — present on assemblies built via /graph-editor,
      // undefined on leaves + legacy assemblies. Drives the editor's load flow.
      graph: meta?.graph,
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
