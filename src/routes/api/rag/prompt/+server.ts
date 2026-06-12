import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { topK } from '$lib/server/rag-query';
import { buildRagPrompt } from '$lib/server/rag-prompt';
import { createAnthropicClient } from '$lib/shared/anthropic-api';
import { tryL1 } from '$lib/server/rag-l1';

/**
 * POST /api/rag/prompt → { prompt, k? } → { id, candidates, graph }
 *
 * Phase 2 of docs/plans/rag-prompt-builder.md. Pipeline:
 *   1. BM25 the prompt against the on-volume corpus (ai/rag/parts.jsonl)
 *      → top-k exemplar records (k defaults to 5).
 *   2. Build the system + user prompt (rag-prompt.ts — graph schema by
 *      example + the exemplars as one-liners).
 *   3. One Anthropic call → a single JSON object {id, candidates, graph}.
 *   4. Light shape validation; the editor's hydrateGraph is the real
 *      gatekeeper client-side.
 *
 * Local dev: this route is in VOLUME_PROXY_PATHS (the corpus lives on the
 * prod volume; prod also holds ANTHROPIC_API_KEY) — same single-live-store
 * stance as /api/rag/{rebuild,stats}. Force local with `X-Volume-Local: 1`.
 *
 * Returned `candidates` are the RETRIEVED exemplar ids (what the model
 * saw), so the UI can show which parts informed the proposal.
 */

const MODEL = () => env.RAG_MODEL || 'claude-sonnet-4-6';

/** The model is told "no fences, JSON only" — but strip fences anyway and
 *  fall back to the outermost {...} slice so a chatty response still
 *  parses. Returns undefined when nothing parses. */
function parseJsonLoose(text: string): any | undefined {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(t); } catch { /* fall through */ }
  const a = t.indexOf('{'); const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try { return JSON.parse(t.slice(a, b + 1)); } catch { /* no dice */ }
  }
  return undefined;
}

export const POST = async ({ request }: { request: Request }) => {
  let body: any;
  try { body = await request.json(); } catch { throw error(400, 'invalid JSON body'); }
  const prompt = String(body?.prompt ?? '').trim();
  if (!prompt) throw error(400, 'prompt (a part description) is required');
  const k = Math.min(10, Math.max(1, Number(body?.k) || 5));

  // L1 (K.77): a known, common part resolves to a ready-to-bake graph
  // instantly + offline — 0 Claude tokens, no volume read. Miss → L2.
  const l1 = tryL1(prompt);
  if (l1) return json({ id: l1.id, candidates: [l1.id], graph: l1.graph, tier: 'L1' });

  const exemplars = await topK(prompt, k);
  const { system, user } = buildRagPrompt(prompt, exemplars);

  let text = '';
  try {
    const client = createAnthropicClient();
    const msg = await client.messages.create({
      model: MODEL(),
      max_tokens: 8192,
      system,
      messages: [{ role: 'user', content: user }],
    });
    text = msg.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('');
  } catch (e: any) {
    throw error(502, `claude call failed: ${e?.message ?? e}`);
  }

  const parsed = parseJsonLoose(text);
  if (!parsed || typeof parsed !== 'object') {
    throw error(502, 'model response was not parseable JSON');
  }
  const graph = parsed.graph;
  if (!graph || typeof graph !== 'object' || !graph.nodes || !graph.root || !graph.nodes[graph.root]) {
    throw error(502, 'model returned no usable graph (missing nodes/root)');
  }
  const rawId = String(parsed.id ?? '').trim();
  const id = /^[a-z][a-z0-9_]*$/.test(rawId) ? rawId : 'g_generated';

  return json({
    id,
    candidates: exemplars.map((r) => r.id),
    graph,
  });
};
