/**
 * POST /api/identify
 *
 * Body: multipart/form-data with `image` field.
 *
 * Backend selection via IDENTIFY_BACKEND env var:
 *   - api (default) — RAG-augmented call to @anthropic-ai/sdk (per-token,
 *                     prod path, retrieves K=5 neighbors from cache.jsonl)
 *   - cli           — spawns local `claude --print` (Pro/Max OAuth, local
 *                     dev only). Step-1 cut: skips RAG, sends target image
 *                     + 18-primitive catalog text only. RAG via file paths
 *                     is a deferred follow-up.
 */

import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { identifyViaApi, identifyViaCli } from '$lib/identify/backend';
import type { RequestHandler } from './$types';

type Backend = 'api' | 'cli';

export const POST: RequestHandler = async ({ request }) => {
  const backend = (env.IDENTIFY_BACKEND ?? 'api') as Backend;
  if (backend !== 'api' && backend !== 'cli') {
    throw error(500, `IDENTIFY_BACKEND must be 'api' or 'cli' (got '${backend}')`);
  }

  const formData = await request.formData();
  const file = formData.get('image') as File;
  if (!file) throw error(400, 'No image file provided');

  const imageBuffer = Buffer.from(await file.arrayBuffer());
  const mime = file.type || 'image/png';

  const fn = backend === 'cli' ? identifyViaCli : identifyViaApi;

  let out: Awaited<ReturnType<typeof identifyViaApi>>;
  try {
    out = await fn({ imageBuffer, mime, filename: file.name });
  } catch (e: any) {
    console.error(`[identify:${backend}] error:`, e);
    throw error(500, e.message || 'Identification failed');
  }

  console.log(
    `[identify:${backend}] ${out.durationMs}ms model=${out.modelUsed} ` +
      `→ ${out.result?.component_id ?? '?'} (conf=${out.result?.confidence ?? '?'}) ` +
      `retrieved=${out.retrieved?.length ?? 0}`,
  );

  return json({
    ...out.result,
    retrieved_examples: out.retrieved ?? [],
    _backend: backend,
    _model: out.modelUsed,
    _ms: out.durationMs,
  });
};
