/**
 * GET /api/cache/entry?id=<part_id>&hash=<hash>[&mesh=1]
 *
 * Returns one bake-cache entry's `.meta` sidecar (params, options, stats,
 * timing, timestamps). With `&mesh=1` it also inlines the mesh-JSON payload
 * (`{ full, cutVC, instanced? }`) so the Cache inspector can feed it to
 * PrimitiveSvgView for a 3D preview without re-baking.
 *
 * Validation: id must match the part-id sanitiser, hash must be lowercase
 * hex — both reject `.`/`/`, so the joined path can't escape the cache root
 * (path-traversal guard). Missing files return `meta: null` / `mesh: null`
 * rather than 404 so the UI degrades gracefully.
 *
 * Local-only: the bake cache is not in `VOLUME_PROXY_PATHS`.
 */
import { json } from '@sveltejs/kit';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { volumePath } from '$lib/server/volume';

const CACHE_DIR = 'cache';
const PART_ID_RE = /^[a-z_][a-z0-9_]*$/i;
const HASH_RE = /^[a-f0-9]{4,64}$/i;

export const GET = async ({ url }) => {
  const id = url.searchParams.get('id') ?? '';
  const hash = url.searchParams.get('hash') ?? '';
  const wantMesh = url.searchParams.get('mesh') === '1';

  if (!PART_ID_RE.test(id) || !HASH_RE.test(hash)) {
    return json({ ok: false, error: 'invalid id/hash' }, { status: 400 });
  }

  const dir = join(volumePath(CACHE_DIR), id);

  let meta: unknown = null;
  try {
    meta = JSON.parse(await readFile(join(dir, `${hash}.meta`), 'utf8'));
  } catch {
    meta = null;
  }

  let bytes = 0;
  let mtime = 0;
  try {
    const st = await stat(join(dir, `${hash}.json`));
    bytes = st.size;
    mtime = st.mtimeMs;
  } catch {
    /* missing payload — leave 0 */
  }

  const resp: Record<string, unknown> = { ok: true, id, hash, meta, bytes, mtime };

  if (wantMesh) {
    try {
      resp.mesh = JSON.parse(await readFile(join(dir, `${hash}.json`), 'utf8'));
    } catch {
      resp.mesh = null;
    }
  }

  return json(resp);
};
