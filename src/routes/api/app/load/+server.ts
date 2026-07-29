// GET /api/app/load?id=<id> — read a .app from the local dir at RUNTIME, validate,
// return it. The AppStore `local` backend (server side). See app-paths.ts.
import { json, error, type RequestHandler } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import { appFilePath } from '$lib/server/app-paths';
import { validateManifest } from '$lib/appkit/manifest/validate';

export const GET: RequestHandler = async ({ url }) => {
  const id = url.searchParams.get('id');
  if (!id) throw error(400, 'missing id');
  let path: string;
  try {
    path = appFilePath(id);
  } catch {
    throw error(400, `invalid app id "${id}"`);
  }
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    throw error(404, `no .app "${id}"`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw error(422, `.app "${id}" is not valid JSON`);
  }
  const res = validateManifest(parsed);
  if (!res.ok) throw error(422, res.errors.join('; '));
  return json(res.app);
};
