/**
 * GET /api/components/picture?id=<id>
 *
 * Streams a library part's `picture.png` — the reference figure the part
 * was built from. Dev-local like every other /api/components/* endpoint
 * (NOT proxied), so it serves from the same LOCAL library that
 * /api/components/{list,geom,save} operate on.
 *
 * The list endpoint emits `picture: '/api/components/picture?id=<id>'`
 * for parts that have a picture; the client uses it directly as an
 * <img> src. 404 when the id isn't a library part or has no picture.
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

  const part = await resolvePart(id);
  if (!part || !part.hasPicture) {
    throw error(404, `No picture for "${id}".`);
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(join(part.dir, PART_FILES.picture));
  } catch (e: any) {
    throw error(500, `Failed to read picture: ${e?.message ?? e}`);
  }

  return new Response(new Uint8Array(bytes), {
    headers: {
      'content-type': 'image/png',
      'cache-control': 'no-cache',
    },
  });
};
