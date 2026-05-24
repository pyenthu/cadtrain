/**
 * Serve a single PDF from the persistent volume (`<VOLUME_ROOT>/kb-sources/`)
 * for the embedded viewer in the /components Sources tab.
 *
 * Path-restricted to `kb-sources/<name>.pdf` + the volume root, so this
 * endpoint can't be turned into an arbitrary file-read primitive.
 *
 * Local dev → prod: when `CADTRAIN_VOLUME_REMOTE_URL` is set, the
 * `maybeProxy()` call forwards the request to the production app so a
 * `bun dev` instance can serve PDFs that only exist on the Railway volume.
 */

import { error } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import { sep } from 'node:path';
import type { RequestHandler } from './$types';
import { safeVolumePath, maybeProxy, checkVolumeAuth, VOLUME_ROOT } from '$lib/server/volume';

export const GET: RequestHandler = async ({ url, request }) => {
  const proxied = await maybeProxy(request, url);
  if (proxied) return proxied;
  checkVolumeAuth(request, url);

  const path = url.searchParams.get('path');
  if (!path) throw error(400, 'Missing path parameter');
  if (!path.startsWith('ai/kb-sources/')) throw error(400, 'Path must start with ai/kb-sources/');
  if (path.includes('..')) throw error(400, 'Path traversal not allowed');
  if (!path.toLowerCase().endsWith('.pdf')) throw error(400, 'Only .pdf files are served');

  const abs = safeVolumePath(path);

  let buf: Buffer;
  try {
    buf = await readFile(abs);
  } catch {
    throw error(404, `kb-sources file not found on volume (${VOLUME_ROOT}): ${path}`);
  }

  return new Response(new Uint8Array(buf), {
    headers: {
      'content-type': 'application/pdf',
      'content-length': String(buf.byteLength),
      'cache-control': 'private, max-age=300',
      'content-disposition': `inline; filename="${path.split(sep).pop()}"`,
    },
  });
};
