/**
 * POST /api/wells/extract
 *
 * Body: multipart/form-data with one of:
 *   - file=<File>      — PDF or image (PNG/JPG)
 *   - text=<string>    — optional supplementary text (deviation tally
 *                        pasted from a doc, etc.); merged into prompt
 *
 * Returns a WSON object (per src/lib/wells/schema.ts) extracted by
 * Claude vision. PDF inputs go through type:document so the model
 * sees the text layer + vector elements directly — no rasterising on
 * our side, which preserves the deviation tables that often live as
 * embedded text in the source PDFs.
 *
 * The endpoint validates with validateWson before returning. Soft
 * issues (e.g. tubing-in-ch heuristic) are surfaced in the response
 * but don't block — the user can fix in the /wells UI before save.
 */

import { json, error } from '@sveltejs/kit';
import Anthropic from '@anthropic-ai/sdk';
import { env } from '$env/dynamic/private';
import { validateWson, type Wson } from '$lib/wells/schema';
import { EXTRACTOR_SYSTEM_PROMPT, EXTRACTOR_USER_INSTRUCTION } from '$lib/wells/prompt';
import type { RequestHandler } from './$types';

const MODEL = env.WELLS_MODEL ?? 'claude-opus-4-7';
const MAX_TOKENS = 8192;

export const POST: RequestHandler = async ({ request }) => {
  if (!env.ANTHROPIC_API_KEY) throw error(500, 'ANTHROPIC_API_KEY not set');

  let form: FormData;
  try {
    form = await request.formData();
  } catch (e) {
    throw error(400, `expected multipart/form-data: ${(e as Error).message}`);
  }
  const file = form.get('file');
  const text = (form.get('text') as string | null) ?? '';

  if (!(file instanceof File)) throw error(400, 'no `file` field in form data');

  const buffer = Buffer.from(await file.arrayBuffer());
  const base64 = buffer.toString('base64');
  const mime = file.type || 'application/octet-stream';

  // Build the message content. PDFs use the document block (preserves
  // text + vector); images use the image block.
  const userContent: Anthropic.Messages.ContentBlockParam[] = [];

  if (mime === 'application/pdf') {
    userContent.push({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: base64 },
    });
  } else if (mime.startsWith('image/')) {
    userContent.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: mime as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
        data: base64,
      },
    });
  } else {
    throw error(400, `unsupported file type: ${mime} (use PDF or image)`);
  }

  if (text.trim()) {
    userContent.push({
      type: 'text',
      text: `Supplementary text from the document (deviation tally, notes, etc.):\n\n${text.trim()}`,
    });
  }
  userContent.push({ type: 'text', text: EXTRACTOR_USER_INSTRUCTION });

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  let raw: string;
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: EXTRACTOR_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    });
    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw error(500, 'no text content in Claude response');
    }
    raw = textBlock.text.trim();
  } catch (e) {
    console.error('[wells/extract] Claude error:', e);
    throw error(500, (e as Error).message || 'extraction failed');
  }

  // Strip code fences if Claude returned ```json ... ``` despite our ask.
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
    throw error(500, `Claude returned non-JSON output: ${(e as Error).message}`);
  }

  const issues = validateWson(wson);
  console.log(
    `[wells/extract] well="${wson.meta?.wellName ?? '?'}" ` +
      `oh=${wson.oh?.length ?? 0} ch=${wson.ch?.length ?? 0} ` +
      `comp=${wson.completions?.length ?? 0} perf=${wson.perforations?.length ?? 0} ` +
      `strata=${wson.strata?.length ?? 0} profile=${wson.profile?.length ?? 0} ` +
      `issues=${issues.length}`,
  );

  return json({ wson, issues, model: MODEL });
};
