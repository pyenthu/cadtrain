// POST /api/app/ground  { prompt, k? } → { grounding } — the RAG grounding string for ONE prompt.
// Exposes the SAME retrieval the server build path uses (server/app-corpus.buildGrounding over the
// volume corpus: ranked golden pairs + clean builds) so the CLIENT-side phi/WebLLM builder — which
// never hits /api/app/generate — gets identical grounding. Residency: retrieval runs on THIS server
// over the LOCAL corpus; the model still runs entirely in-browser. Read-only; no disk writes.
import { json, error, type RequestHandler } from '@sveltejs/kit';
import { buildGrounding } from '$lib/server/app-corpus';

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => null)) as
    | { prompt?: string; k?: number; docType?: string }
    | null;
  if (!body?.prompt) throw error(400, 'missing prompt');
  const k = typeof body.k === 'number' && body.k > 0 ? body.k : 3;
  // docType-scoped retrieval (#49): scope grounding to the app's own family when known.
  const docType = typeof body.docType === 'string' && body.docType ? body.docType : undefined;
  const grounding = await buildGrounding(body.prompt, k, docType);
  return json({ grounding });
};
