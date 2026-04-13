/**
 * POST /api/accept
 *
 * Append a user-validated identification to the persistent training cache.
 * Called when user clicks "Save to Training" or auto-refine converges.
 */

import { json, error } from '@sveltejs/kit';
import { getCache } from '$lib/training/cache';
import { computePHash, makeThumbnail } from '$lib/training/phash';
import type { RequestHandler } from './$types';
import { join } from 'path';
import { randomBytes } from 'crypto';

const CACHE_PATH = join(process.cwd(), 'training_data', 'cache.jsonl');

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const { image_b64, component_id, params, source = 'refined' } = body;

  if (!image_b64 || !component_id || !params) {
    throw error(400, 'Missing image_b64, component_id, or params');
  }

  try {
    // Decode and hash
    const b64Data = image_b64.includes(',') ? image_b64.split(',')[1] : image_b64;
    const buffer = Buffer.from(b64Data, 'base64');
    const hash = await computePHash(buffer);
    const thumb = await makeThumbnail(buffer, 256);

    // Append
    const cache = await getCache(CACHE_PATH);
    await cache.append({
      id: randomBytes(6).toString('hex'),
      hash,
      component_id,
      params,
      image_b64: thumb,
      source,
      created: new Date().toISOString(),
      uses: 0,
      accepted: 0,
    });

    const stats = cache.stats();
    return json({ ok: true, cache_size: stats.total, stats });
  } catch (e: any) {
    console.error('Accept error:', e);
    throw error(500, e.message || 'Accept failed');
  }
};
