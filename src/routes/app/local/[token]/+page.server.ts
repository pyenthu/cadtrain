// /app/local/[token] — SERVER-render a LOCAL .app the studio parked via /api/app/session.
// Same pipeline as /app/[id] (resolve server-mode data through the engine in-process, then
// SSR) — the .app came from the user's disk, but it's compiled/rendered on the server.
import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getApp } from '$lib/server/app-session';
import { createClientEngine } from '$lib/shared/harness/client-engine';
import { resolvePreloaded } from '$lib/server/app-render';

export const load: PageServerLoad = async ({ params, fetch }) => {
  const app = getApp(params.token);
  if (!app) throw error(404, 'app session expired — relaunch from the studio');
  const engine = createClientEngine(fetch);
  const preloaded = await resolvePreloaded(app as any, engine);
  return { app, preloaded };
};
