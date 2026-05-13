/**
 * Serve a single PDF from `kb-sources/` for the embedded viewer in
 * the /primitives Sources tab. Path-restricted to kb-sources/ + must
 * end in `.pdf` so this endpoint can't be turned into an arbitrary
 * file-read primitive.
 *
 * Lives only in dev — `kb-sources/` is gitignored, so the prod
 * deployment (Railway) has no PDFs to serve. The handler returns a
 * 404 in that case and the client renders a "PDF not available on
 * this deployment" notice.
 */

import { error } from '@sveltejs/kit';
import { readFile } from 'fs/promises';
import { resolve, sep } from 'path';
import type { RequestHandler } from './$types';

const ROOT = resolve(process.cwd(), 'kb-sources');

export const GET: RequestHandler = async ({ url }) => {
  const path = url.searchParams.get('path');
  if (!path) throw error(400, 'Missing path parameter');
  // Reject anything that isn't a kb-sources/<file>.pdf reference. The
  // leading prefix must match; .. traversal and absolute paths are
  // refused. Final resolved path must still live under ROOT.
  if (!path.startsWith('kb-sources/')) throw error(400, 'Path must start with kb-sources/');
  if (path.includes('..')) throw error(400, 'Path traversal not allowed');
  if (!path.toLowerCase().endsWith('.pdf')) throw error(400, 'Only .pdf files are served');

  const rel = path.replace(/^kb-sources\//, '').replace(/\//g, sep);
  const abs = resolve(ROOT, rel);
  if (!abs.startsWith(ROOT + sep) && abs !== ROOT) throw error(400, 'Resolved path escapes kb-sources/');

  let buf: Buffer;
  try {
    buf = await readFile(abs);
  } catch {
    throw error(404, `kb-sources file not found: ${path}`);
  }

  return new Response(new Uint8Array(buf), {
    headers: {
      'content-type': 'application/pdf',
      'content-length': String(buf.byteLength),
      'cache-control': 'private, max-age=300',
      // Inline display, not download.
      'content-disposition': `inline; filename="${rel.split(sep).pop()}"`,
    },
  });
};
