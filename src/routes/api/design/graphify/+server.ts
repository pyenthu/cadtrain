/**
 * POST /api/design/graphify — DEV ONLY.
 *
 * Builds a DETERMINISTIC code knowledge-graph of src/ into
 * graphify-out/graph.json using graphify's tree-sitter AST pipeline ONLY —
 * ZERO Anthropic/Claude tokens, no network. It runs scripts/graphify-code.py
 * (detect → extract → build → cluster → to_json), NOT the token-costing
 * /graphify SKILL semantic pass.
 *
 * We use the thin python wrapper rather than the `graphify update` CLI because
 * the CLI writes to <path>/graphify-out/ (i.e. src/graphify-out/) — the wrapper
 * targets the repo-root graphify-out/ that our GET endpoint reads, while calling
 * the exact same public graphify functions.
 *
 * If graphify isn't installed locally → { ok:false, reason:'graphify not installed' }.
 * Returns { ok, nodes, edges, communities, files, ms }. 403 in prod.
 */
import { json, error } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { run, resolveGraphifyPython, tailLines } from '../_lib';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async () => {
  if (!dev) throw error(403, 'graphify is only available in dev mode');

  const python = await resolveGraphifyPython();
  if (!python) {
    return json({ ok: false, reason: 'graphify not installed' });
  }

  const t0 = Date.now();
  const r = await run(python, ['scripts/graphify-code.py', 'src', 'graphify-out'], {
    timeoutMs: 180_000,
  });
  const ms = Date.now() - t0;

  // The script prints a single JSON line to stdout; progress goes to stderr.
  let payload: Record<string, unknown> | null = null;
  const lastLine = r.stdout.trim().split('\n').filter(Boolean).pop();
  if (lastLine) {
    try {
      payload = JSON.parse(lastLine);
    } catch {
      payload = null;
    }
  }

  if (!r.ok || !payload || payload.ok !== true) {
    return json({
      ok: false,
      ms,
      reason:
        (payload && typeof payload.reason === 'string' && payload.reason) ||
        tailLines(r.stderr || r.stdout, 6) ||
        'graphify code-graph failed',
    });
  }

  return json({
    ok: true,
    ms,
    nodes: payload.nodes ?? 0,
    edges: payload.edges ?? 0,
    communities: payload.communities ?? 0,
    files: payload.files ?? 0,
  });
};
