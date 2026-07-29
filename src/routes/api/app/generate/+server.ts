// POST /api/app/generate  { app?, id?, prompt } — the AI BUILDS the .app's GUI (calls
// gui verbs). Pass `app` (the in-memory manifest — the studio's file-editor model) to
// build it and get the built manifest back with NO server disk I/O (the client owns the
// file). Or pass `id` to load/build/persist a SAMPLE-dir app (back-compat). Every build is
// captured to the learning corpus (rung 4a.2). Cloud (ANTHROPIC_API_KEY) or local Ollama
// (APP_BUILD_PROVIDER=local). (Route "generate", not "build" — a build/ dir is .gitignored.)
import { json, error, type RequestHandler } from '@sveltejs/kit';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { env } from '$env/dynamic/private';
import { appFilePath } from '$lib/server/app-paths';
import { validateManifest } from '$lib/appkit/manifest/validate';
import { buildApp } from '$lib/appkit/ai/pipeline';
import { captureBuild, buildGrounding } from '$lib/server/app-corpus';

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => null)) as { id?: string; app?: unknown; prompt?: string } | null;
  if (!body?.prompt) throw error(400, 'missing prompt');
  if (!body.app && !body.id) throw error(400, 'missing app or id');

  const provider = env.APP_BUILD_PROVIDER === 'local' ? 'local' : 'cloud';
  const apiKey = env.ANTHROPIC_API_KEY;
  if (provider === 'cloud' && !apiKey) {
    throw error(503, 'ANTHROPIC_API_KEY not set (cloud build). Set APP_BUILD_PROVIDER=local for a local Ollama model.');
  }

  // Resolve the manifest: prefer the in-memory `app` (studio file-editor); else load by id.
  let manifest;
  let path: string | null = null;
  if (body.app) {
    const res = validateManifest(body.app);
    if (!res.ok) throw error(422, res.errors.join('; '));
    manifest = res.app;
  } else {
    try {
      path = appFilePath(body.id!);
    } catch {
      throw error(400, `invalid app id "${body.id}"`);
    }
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch {
      throw error(404, `no .app "${body.id}"`);
    }
    const res = validateManifest(JSON.parse(raw));
    if (!res.ok) throw error(422, res.errors.join('; '));
    manifest = res.app;
  }

  const grounding = await buildGrounding(body.prompt);

  let out;
  try {
    out = await buildApp({
      prompt: body.prompt,
      app: manifest as any,
      grounding,
      provider,
      apiKey,
      model: env.APP_BUILD_MODEL,
      baseURL: env.OLLAMA_URL,
    });
  } catch (e) {
    throw error(502, `build failed: ${String((e as any)?.message ?? e)}`);
  }

  // Persist ONLY for id-based (SAMPLE-dir) builds; app-body builds are saved by the client.
  if (path) {
    const tmp = `${path}.tmp`;
    await writeFile(tmp, `${JSON.stringify(out.app, null, 2)}\n`, 'utf8');
    await rename(tmp, path);
  }

  await captureBuild({
    ts: Date.now(),
    prompt: body.prompt,
    steps: out.steps,
    app: {
      app: out.app.app,
      panels: ((out.app.panels ?? []) as any[]).map((p) => ({ id: p.id, kind: p.kind, source: p.source })),
    },
  });

  return json({ app: out.app, steps: out.steps, text: out.text });
};
