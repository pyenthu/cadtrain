/**
 * POST /api/feedback
 *
 * Record user feedback on an identification. Updates accepted / wrong_match
 * counters on the retrieved cache records so the next retrieval can demote
 * bad matches and promote good ones.
 *
 * Body: {
 *   verdict: 'correct' | 'wrong',
 *   retrieved_ids: string[]   // ids returned by /api/identify as few-shot examples
 * }
 */

import { json, error } from '@sveltejs/kit';
import { getCache } from '$lib/training/cache';
import type { RequestHandler } from './$types';
import { join } from 'path';

const CACHE_PATH = join(process.cwd(), 'training_data', 'cache.jsonl');

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const { verdict, retrieved_ids } = body as {
    verdict: 'correct' | 'wrong';
    retrieved_ids: string[];
  };

  if (verdict !== 'correct' && verdict !== 'wrong') {
    throw error(400, 'verdict must be "correct" or "wrong"');
  }
  if (!Array.isArray(retrieved_ids) || retrieved_ids.length === 0) {
    throw error(400, 'retrieved_ids must be a non-empty array');
  }

  try {
    const cache = await getCache(CACHE_PATH);
    if (verdict === 'correct') {
      for (const id of retrieved_ids) cache.incrementAccepted(id);
    } else {
      for (const id of retrieved_ids) cache.incrementWrongMatch(id);
    }
    return json({ ok: true, verdict, count: retrieved_ids.length });
  } catch (e: any) {
    console.error('Feedback error:', e);
    throw error(500, e.message || 'Feedback failed');
  }
};
