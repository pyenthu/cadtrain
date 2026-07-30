// POST /api/app/session { app } → { token } — park a LOCAL .app for server-rendering
// (app-server-render.md Phase 2). The studio POSTs the app the user is holding (a picked
// local file, or a freshly-built one), then opens /app/local/[token] to view it SSR'd.
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { validateManifest } from '$lib/appkit/manifest/validate';
import { putApp } from '$lib/server/app-session';

export const POST: RequestHandler = async ({ request }) => {
  let body: { app?: unknown };
  try {
    body = await request.json();
  } catch {
    throw error(400, 'expected JSON { app }');
  }
  const res = validateManifest(body?.app);
  if (!res.ok) throw error(422, res.errors.join('; '));
  return json({ token: putApp(res.app) });
};
