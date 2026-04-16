/**
 * GET /api/author/list
 * GET /api/author/list?id=<component_id>
 *
 * Lists authored components or returns a single one by id. The library
 * browser calls this without params to render the index; the author
 * page calls it with ?id= to load an existing record into the editor.
 */

import { json, error } from '@sveltejs/kit';
import { getAuthoredCache } from '$lib/authoring/cache';
import type { RequestHandler } from './$types';
import { join } from 'path';

const CACHE_PATH = join(process.cwd(), 'training_data', 'authored_cache.jsonl');

export const GET: RequestHandler = async ({ url }) => {
  const cache = await getAuthoredCache(CACHE_PATH);
  const id = url.searchParams.get('id');

  if (id) {
    const rec = cache.getById(id);
    if (!rec) throw error(404, `No authored component with id ${id}`);
    return json(rec);
  }

  // Index view: drop heavy fields (thumbnail base64, authoring_log) so the
  // library page loads fast. Full record available via ?id= fetch.
  const index = cache.getAll().map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    tags: r.tags,
    created: r.created,
    source: r.source,
    parts_count: r.parts.length,
    ops_count: r.ops.length,
    has_thumbnail: !!r.thumbnail_b64,
  }));
  return json({ total: index.length, records: index });
};
