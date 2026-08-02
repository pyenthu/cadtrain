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
import { buildAppViaCli } from '$lib/appkit/ai/build-cli';
import { captureBuild, buildGrounding } from '$lib/server/app-corpus';

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => null)) as { id?: string; app?: unknown; prompt?: string; provider?: string } | null;
  if (!body?.prompt) throw error(400, 'missing prompt');
  if (!body.app && !body.id) throw error(400, 'missing app or id');

  // Backend select: a per-request `provider` (the studio's model toggle) wins; else the
  // APP_BUILD_PROVIDER env. 'cli' → claude --print subprocess (dev, bills the Max subscription)
  // · 'local' → Ollama (dev, free) · 'cloud' → ANTHROPIC_API_KEY (prod default). (PHI/WebLLM
  // runs entirely in the browser and never hits this endpoint.)
  const req = body.provider;
  const mode =
    req === 'cli' || req === 'local' || req === 'cloud'
      ? req
      : env.APP_BUILD_PROVIDER === 'cli'
        ? 'cli'
        : env.APP_BUILD_PROVIDER === 'local'
          ? 'local'
          : 'cloud';
  const apiKey = env.ANTHROPIC_API_KEY;
  if (mode === 'cloud' && !apiKey) {
    throw error(503, 'ANTHROPIC_API_KEY not set (cloud build). Set APP_BUILD_PROVIDER=cli (claude CLI subscription) or =local (Ollama) for dev.');
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

  // docType-scoped retrieval (#49): scope grounding to the app's own family (kills cross-app
  // contamination — a dashboard build no longer retrieves roadmap/well goldens).
  const grounding = await buildGrounding(body.prompt, 3, (manifest as { docType?: string }).docType);

  let out;
  try {
    if (mode === 'cli') {
      const { runClaudeCli } = await import('$lib/server/claude-cli');
      out = await buildAppViaCli(
        { prompt: body.prompt, app: manifest as any, grounding, model: env.APP_BUILD_MODEL },
        (p, o) => runClaudeCli(p, { model: o.model }),
      );
    } else {
      out = await buildApp({
        prompt: body.prompt,
        app: manifest as any,
        grounding,
        provider: mode,
        apiKey,
        model: env.APP_BUILD_MODEL,
        baseURL: env.OLLAMA_URL,
      });
    }
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
    trace: out.trace,
    raw: out.raw,
  });

  return json({ app: out.app, steps: out.steps, text: out.text, trace: out.trace, raw: out.raw });
};
