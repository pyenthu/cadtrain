// POST /api/app/promote — promote a build into the CURATED golden RAG (§1 layer 2).
// { name, md?, app } → golden/<name>.{md,app} on the volume (shared, prod). The MD is the
// retrieval KEY (auto-summarized from structure if omitted), the .app the target. This is
// the "★ add to RAG" flow — only builds the user KEEPS become examples.
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { promoteGolden } from '$lib/server/app-corpus';
import { autoDoc } from '$lib/appkit/manifest/doc';

export const POST: RequestHandler = async ({ request }) => {
  let body: { name?: string; md?: string; app?: unknown };
  try {
    body = await request.json();
  } catch {
    throw error(400, 'expected JSON { name, md?, app }');
  }
  if (!body?.app || typeof body.app !== 'object') throw error(400, 'missing app');

  const app = body.app as any;
  const name = (body.name || app.title || app.app || 'app').toString();
  const md = (body.md && body.md.trim()) || autoDoc(app);

  try {
    await promoteGolden(name, md, app);
  } catch (e) {
    throw error(500, `promote failed: ${String((e as any)?.message ?? e)}`);
  }
  return json({ ok: true, name: name.replace(/[^a-z0-9_-]+/gi, '_') });
};
