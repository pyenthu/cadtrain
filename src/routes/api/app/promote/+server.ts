// POST /api/app/promote — promote a build into the CURATED golden RAG (§1 layer 2).
// { name, md?, app, atomic? } → golden/<name>.{md,app} on the volume (shared, prod). The MD is
// the retrieval KEY (auto-summarized from structure if omitted), the .app the target. This is the
// "★ add to RAG" flow — only builds the user KEEPS become examples.
//
// `atomic: true` (the 2026-08 flywheel default direction) DECOMPOSES the build into per-component
// golden pieces (one per meta/theme/structure/var/panel) instead of one full-app golden — the shape
// a small model retrieves cleanly (a whole-app golden gets over-copied, dropping its data vars).
// Each piece grounds correctly through the now-semantic `compactApp`.
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { promoteGolden, decomposeToAtomicGoldens } from '$lib/server/app-corpus';
import { autoDoc } from '$lib/appkit/manifest/doc';

export const POST: RequestHandler = async ({ request }) => {
  let body: { name?: string; md?: string; app?: unknown; atomic?: boolean };
  try {
    body = await request.json();
  } catch {
    throw error(400, 'expected JSON { name, md?, app, atomic? }');
  }
  if (!body?.app || typeof body.app !== 'object') throw error(400, 'missing app');

  const app = body.app as any;
  const safe = (s: string) => s.replace(/[^a-z0-9_-]+/gi, '_');

  try {
    if (body.atomic) {
      const base = body.name || app.app || app.title;
      const pieces = decomposeToAtomicGoldens(app, base ? { base } : {});
      if (!pieces.length) throw error(422, 'nothing to decompose (empty app)');
      // Promote each piece; the md is its natural-language retrieval key.
      for (const p of pieces) await promoteGolden(p.name, p.md, p.app);
      return json({ ok: true, atomic: true, names: pieces.map((p) => safe(p.name)) });
    }
    const name = (body.name || app.title || app.app || 'app').toString();
    const md = (body.md && body.md.trim()) || autoDoc(app);
    await promoteGolden(name, md, app);
    return json({ ok: true, name: safe(name) });
  } catch (e) {
    if ((e as any)?.status) throw e; // re-throw SvelteKit http errors as-is
    throw error(500, `promote failed: ${String((e as any)?.message ?? e)}`);
  }
};
