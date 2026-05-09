/**
 * POST /api/wells/extract
 *
 * Body: multipart/form-data:
 *   - file=<File>      — PDF or image (PNG/JPG)
 *   - text=<string>    — optional supplementary text (deviation tally
 *                        pasted from a doc, etc.)
 *   - model=<string>   — optional model override
 *
 * Returns a WSON object (per src/lib/wells/schema.ts) extracted by
 * Claude vision. PDF inputs go through type:document so the model
 * sees the text layer + vector elements directly — no rasterising on
 * our side, which preserves the deviation tables that often live as
 * embedded text in the source PDFs.
 *
 * Backend selection via WELLS_BACKEND env var:
 *   - api (default) — direct @anthropic-ai/sdk call (per-token billed,
 *                     works in dev and Railway production)
 *   - cli           — spawns local `claude` CLI (Pro/Max subscription
 *                     billed, local dev only — no claude binary in
 *                     Railway containers)
 *
 * The endpoint validates with validateWson before returning.
 */

import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { validateWson, type Wson } from '$lib/wells/schema';
import { extractViaApi, extractViaCli } from '$lib/wells/backend';
import type { RequestHandler } from './$types';

type Backend = 'api' | 'cli';

export const POST: RequestHandler = async ({ request }) => {
  const backend = (env.WELLS_BACKEND ?? 'api') as Backend;
  if (backend !== 'api' && backend !== 'cli') {
    throw error(500, `WELLS_BACKEND must be 'api' or 'cli' (got '${backend}')`);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch (e) {
    throw error(400, `expected multipart/form-data: ${(e as Error).message}`);
  }
  const file = form.get('file');
  const supplementaryText = (form.get('text') as string | null) ?? '';
  const modelOverride = (form.get('model') as string | null) ?? '';

  if (!(file instanceof File)) throw error(400, 'no `file` field in form data');

  const fileBuffer = Buffer.from(await file.arrayBuffer());
  const mime = file.type || 'application/octet-stream';

  const fn = backend === 'cli' ? extractViaCli : extractViaApi;

  let result: Awaited<ReturnType<typeof extractViaApi>>;
  try {
    result = await fn({
      fileBuffer,
      mime,
      filename: file.name,
      supplementaryText,
      modelOverride,
    });
  } catch (e) {
    console.error(`[wells/extract] ${backend} backend error:`, e);
    throw error(500, (e as Error).message || 'extraction failed');
  }

  // Strip code fences if Claude returned ```json ... ``` despite our ask.
  let raw = result.rawText;
  if (raw.includes('```')) {
    const start = raw.indexOf('```');
    const end = raw.lastIndexOf('```');
    if (end > start) {
      let body = raw.slice(start + 3, end).trim();
      if (body.startsWith('json')) body = body.slice(4).trim();
      raw = body;
    }
  }

  let wson: Wson;
  try {
    wson = JSON.parse(raw);
  } catch (e) {
    console.error('[wells/extract] JSON parse failed. Raw:', raw.slice(0, 500));
    throw error(500, `${result.modelUsed} returned non-JSON output: ${(e as Error).message}`);
  }

  const issues = validateWson(wson);
  console.log(
    `[wells/extract:${backend}] ${result.durationMs}ms model=${result.modelUsed} ` +
      `well="${wson.meta?.wellName ?? '?'}" ` +
      `oh=${wson.oh?.length ?? 0} ch=${wson.ch?.length ?? 0} ` +
      `comp=${wson.completions?.length ?? 0} perf=${wson.perforations?.length ?? 0} ` +
      `strata=${wson.strata?.length ?? 0} profile=${wson.profile?.length ?? 0} ` +
      `issues=${issues.length}`,
  );

  return json({ wson, issues, model: result.modelUsed, backend });
};
