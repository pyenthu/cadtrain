/**
 * POST /api/design/rebuild-diagrams — DEV ONLY.
 *
 * Regenerates the three /design snapshot data files (folder-tree.ts,
 * gep-modules.ts, domain-classes.ts) from the live codebase by running
 * `bun scripts/gen-design-diagrams.mjs`. Fixed argv → no injection. Zero
 * Anthropic tokens (the script is pure filesystem/regex).
 *
 * Returns { ok, stdout (last ~10 lines), ms }. 403 in prod.
 */
import { json, error } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { run, tailLines } from '../_lib';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async () => {
  if (!dev) throw error(403, 'rebuild-diagrams is only available in dev mode');

  const t0 = Date.now();
  const r = await run('bun', ['scripts/gen-design-diagrams.mjs'], { timeoutMs: 120_000 });
  const ms = Date.now() - t0;

  if (!r.ok) {
    return json({
      ok: false,
      ms,
      reason: tailLines(r.stderr || r.stdout, 6) || 'gen-design-diagrams.mjs failed',
    });
  }
  return json({ ok: true, ms, stdout: tailLines(r.stdout, 10) });
};
