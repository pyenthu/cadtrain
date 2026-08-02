// POST /api/app/capture  { prompt, app, trace?, raw? } → captureBuild.
//
// The flywheel-capture gap fix (#49): the in-browser phi/WebLLM builder runs the model CLIENT-side
// (residency: inference stays local) and so can't `captureBuild` directly — that appends to the
// shared corpus (`ai/app-rag/builds.jsonl` on the volume). So the client POSTs its FINISHED build
// here and the server records it. This closes the learning loop for Qwen's OWN builds — before, only
// the cli/cloud path captured (`/api/app/generate`), so the local model could never feed the flywheel
// it's meant to improve. Append-only raw log; promotion to a golden stays a separate, human-gated
// step (`/api/app/promote`). Mirrors the record shape captured at /api/app/generate exactly.
import { json, error, type RequestHandler } from '@sveltejs/kit';
import { captureBuild } from '$lib/server/app-corpus';

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => null)) as
    | { prompt?: string; app?: any; trace?: Array<{ verb: string; args: unknown; ok: boolean; error?: string }>; raw?: string }
    | null;
  if (!body?.prompt?.trim() || !body.app || typeof body.app !== 'object') throw error(400, 'missing prompt/app');

  const app = body.app;
  const trace = Array.isArray(body.trace) ? body.trace : undefined;
  // steps = the count of verbs that actually applied (mirrors out.steps on the cli/cloud path); the
  // hygiene gate (isCleanBuild) later drops steps<1 / all-failed builds from what teaches the model.
  const steps = trace ? trace.filter((t) => t?.ok).length : Array.isArray(app.panels) ? app.panels.length : 0;

  try {
    await captureBuild({
      ts: Date.now(),
      prompt: String(body.prompt),
      steps,
      app: {
        app: app.app,
        panels: ((app.panels ?? []) as any[]).map((p) => ({ id: p.id, kind: p.kind, source: p.source })),
      },
      trace,
      raw: typeof body.raw === 'string' ? body.raw : undefined,
    });
  } catch (e) {
    throw error(500, `capture failed: ${String((e as any)?.message ?? e)}`);
  }
  return json({ ok: true, steps });
};
