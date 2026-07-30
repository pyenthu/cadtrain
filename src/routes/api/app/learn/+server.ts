// /api/app/learn — the learning surface (#38 flywheel).
//   GET  → { candidates } — golden-promotion candidates ranked from the shared corpus (the
//          human one-click-promotes via /api/app/promote).
//   POST { note, prompt?, app?, trace? } → capture a ⚠ Report (a non-conformance = the NEGATIVE
//          signal). Reviewed to fix a rule-card or author a corrected golden; never grounds.
import { json, error, type RequestHandler } from '@sveltejs/kit';
import { getPromotionCandidates, reportNonConformance } from '$lib/server/app-corpus';

export const GET: RequestHandler = async () => {
  return json({ candidates: await getPromotionCandidates(12) });
};

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => null)) as
    | { note?: string; prompt?: string; app?: unknown; trace?: unknown }
    | null;
  if (!body?.note?.trim()) throw error(400, 'missing note');
  await reportNonConformance({
    ts: Date.now(),
    prompt: body.prompt ?? '',
    note: body.note.trim(),
    app: body.app,
    trace: body.trace,
  });
  return json({ ok: true });
};
