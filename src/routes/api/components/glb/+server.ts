/**
 * GET /api/components/glb?id=<id>&cut=1
 *
 * Streams a library part's baked `mesh.glb` (or `mesh.cut.glb` when
 * `cut=1`). Dev-local like every other /api/components/* endpoint
 * (NOT proxied), so it serves from the same LOCAL library that
 * /api/components/{list,geom,save} operate on — even when
 * CADTRAIN_VOLUME_REMOTE_URL is set for /api/volume + kb-sources.
 *
 * The GLB stage tab in /components uses this for library parts;
 * bundle primitives still load from /components/<id>.glb (the
 * vite-served static asset). 404 when the id isn't a library part
 * or the bake hasn't run yet for this part (no mesh.glb on disk).
 */

import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { resolvePart, PART_FILES } from '$lib/server/library';
import { checkVolumeAuth } from '$lib/server/volume';

export const GET: RequestHandler = async ({ request, url }) => {
  checkVolumeAuth(request, url);

  const id = url.searchParams.get('id') ?? '';
  if (!/^[a-z][a-z0-9_]*$/.test(id)) throw error(400, `Invalid or missing id "${id}"`);

  const cut = url.searchParams.get('cut') === '1';
  const part = await resolvePart(id);
  if (!part) throw error(404, `Library part "${id}" not found.`);

  const fileName = cut ? 'mesh.cut.glb' : PART_FILES.mesh;
  const path = join(part.dir, fileName);

  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (e: any) {
    if (e?.code === 'ENOENT') {
      throw error(404, `No baked ${cut ? 'cut ' : ''}GLB for "${id}" — save the part to trigger a bake.`);
    }
    throw error(500, `Failed to read GLB: ${e?.message ?? e}`);
  }

  return new Response(new Uint8Array(bytes), {
    headers: {
      'content-type': 'model/gltf-binary',
      'cache-control': 'no-cache',
    },
  });
};
