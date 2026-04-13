/**
 * GET /api/cache/stats
 *
 * Returns statistics about the persistent training cache.
 */

import { json } from '@sveltejs/kit';
import { getCache } from '$lib/training/cache';
import type { RequestHandler } from './$types';
import { join } from 'path';

const CACHE_PATH = join(process.cwd(), 'training_data', 'cache.jsonl');

export const GET: RequestHandler = async () => {
  const cache = await getCache(CACHE_PATH);
  return json(cache.stats());
};
