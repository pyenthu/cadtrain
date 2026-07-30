// /app/[id] — SERVER load: read the .app by id, resolve its server-mode panel data through
// the engine (in-process via SvelteKit's server `fetch`), and hand { app, preloaded } to the
// SSR render. The engine never ships; only the rendered HTML + hydration data do.
import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import { appFilePath } from '$lib/server/app-paths';
import { validateManifest } from '$lib/appkit/manifest/validate';
import { createClientEngine } from '$lib/shared/harness/client-engine';
import { resolvePreloaded } from '$lib/server/app-render';

export const load: PageServerLoad = async ({ params, fetch }) => {
  let path: string;
  try {
    path = appFilePath(params.id);
  } catch {
    throw error(400, `invalid app id "${params.id}"`);
  }
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    throw error(404, `no .app "${params.id}"`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw error(422, `.app "${params.id}" is not valid JSON`);
  }
  const res = validateManifest(parsed);
  if (!res.ok) throw error(422, res.errors.join('; '));

  // Engine runs in-process on the server via SvelteKit's `fetch` (resolves /api/primitives/*
  // without a network hop). Data resolution stays server-side; the engine never ships.
  const engine = createClientEngine(fetch);
  const preloaded = await resolvePreloaded(res.app as any, engine);

  return { app: res.app, preloaded };
};
