/**
 * POST /api/author/save
 *
 * Append or replace an authored component in the persistent authoring
 * cache. Pairs with src/routes/(build)/author/+page.svelte's Save button
 * and with the library browser which reloads records by id via the
 * GET /api/author/list endpoint.
 */

import { json, error } from '@sveltejs/kit';
import { getAuthoredCache } from '$lib/authoring/cache';
import { writeContextDoc } from '$lib/authoring/context';
import { computePHash } from '$lib/training/phash';
import type { AuthoredComponent } from '$lib/authoring/schema';
import type { RequestHandler } from './$types';
import { join } from 'path';
import { randomBytes } from 'crypto';

const CACHE_PATH = join(process.cwd(), 'training_data', 'authored_cache.jsonl');
const CONTEXT_PATH = join(process.cwd(), 'training_data', 'authored_context.md');

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

export const POST: RequestHandler = async ({ request }) => {
  let body: Partial<AuthoredComponent>;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'Invalid JSON body');
  }

  if (!body.parts || !Array.isArray(body.parts) || body.parts.length === 0) {
    throw error(400, 'AuthoredComponent must have at least one part');
  }
  if (!body.name || typeof body.name !== 'string') {
    throw error(400, 'AuthoredComponent must have a non-empty name');
  }

  // Derive id from name if caller didn't provide one.
  const id = (body.id && body.id.trim()) ? slugify(body.id) : `${slugify(body.name)}_${randomBytes(3).toString('hex')}`;

  // Compute pHash from the optional thumbnail so later findSimilarByHash
  // has something to match against. Safe to skip if no thumbnail was sent.
  let hash: string | undefined = body.hash;
  if (!hash && body.thumbnail_b64) {
    try {
      const b64 = body.thumbnail_b64.includes(',')
        ? body.thumbnail_b64.split(',')[1]
        : body.thumbnail_b64;
      hash = await computePHash(Buffer.from(b64, 'base64'));
    } catch (e) {
      console.warn('[author/save] pHash failed, continuing without hash:', e);
    }
  }

  const record: AuthoredComponent = {
    id,
    name: body.name,
    description: body.description ?? '',
    tags: body.tags ?? [],
    version: 1,
    created: body.created ?? new Date().toISOString(),
    source: body.source ?? 'manual',
    parts: body.parts,
    ops: body.ops ?? [],
    thumbnail_b64: body.thumbnail_b64,
    hash,
    authoring_log: body.authoring_log,
  };

  try {
    const cache = await getAuthoredCache(CACHE_PATH);
    await cache.append(record);

    // Regenerate the growing context doc so /api/author/suggest picks it
    // up on its next call. Best-effort — a failure here doesn't block save.
    try { writeContextDoc(CONTEXT_PATH, cache); } catch (e) {
      console.warn('[author/save] context doc write failed:', e);
    }

    return json({ ok: true, id: record.id, total: cache.stats().total });
  } catch (e: any) {
    console.error('[author/save] error:', e);
    throw error(500, e.message || 'Save failed');
  }
};
