// POST /api/app/save  { id, app } — persist a .app to the local dir (atomic
// temp+rename, per Rule 4). Closes the dynamic loop: load → edit (verbs) → save →
// the file updates → reload shows it. This is how AI/user .app patches persist.
import { json, error, type RequestHandler } from '@sveltejs/kit';
import { writeFile, rename } from 'node:fs/promises';
import { appFilePath } from '$lib/server/app-paths';
import { validateManifest } from '$lib/appkit/manifest/validate';

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => null)) as { id?: string; app?: unknown } | null;
  if (!body?.id || !body.app) throw error(400, 'missing id or app');
  let path: string;
  try {
    path = appFilePath(body.id);
  } catch {
    throw error(400, `invalid app id "${body.id}"`);
  }
  const res = validateManifest(body.app);
  if (!res.ok) throw error(422, res.errors.join('; '));
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(res.app, null, 2)}\n`, 'utf8');
  await rename(tmp, path);
  return json({ ok: true });
};
