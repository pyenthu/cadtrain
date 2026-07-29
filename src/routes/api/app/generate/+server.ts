// POST /api/app/generate  { id, prompt } — the AI BUILDS the .app's GUI (calls gui
// verbs), the .app is saved, and the build is captured to the app-building corpus (the
// learning-system seed). Cloud path (ANTHROPIC_API_KEY); local WebLLM is rung 5.
// (Route named "generate", not "build" — a `build/` dir is .gitignored.)
import { json, error, type RequestHandler } from '@sveltejs/kit';
import { readFile, writeFile, rename, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { env } from '$env/dynamic/private';
import { appFilePath, appsDir } from '$lib/server/app-paths';
import { validateManifest } from '$lib/appkit/manifest/validate';
import { buildApp } from '$lib/appkit/ai/pipeline';

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => null)) as { id?: string; prompt?: string } | null;
  if (!body?.id || !body.prompt) throw error(400, 'missing id or prompt');

  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) throw error(503, 'ANTHROPIC_API_KEY not set (cloud build). The local WebLLM path is rung 5.');

  let path: string;
  try {
    path = appFilePath(body.id);
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

  let out;
  try {
    out = await buildApp({ prompt: body.prompt, app: res.app as any, apiKey });
  } catch (e) {
    throw error(502, `build failed: ${String((e as any)?.message ?? e)}`);
  }

  // Persist the built .app (atomic temp+rename).
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(out.app, null, 2)}\n`, 'utf8');
  await rename(tmp, path);

  // Capture the build → the app-building corpus (the learning-system seed). The
  // progressive pipeline + RAG retrieval that grounds FUTURE builds on these is the
  // next rung; here we log every build as a candidate example.
  try {
    await appendFile(
      join(appsDir(), '_builds.jsonl'),
      `${JSON.stringify({ ts: Date.now(), id: body.id, prompt: body.prompt, steps: out.steps })}\n`,
      'utf8',
    );
  } catch {
    /* best-effort — a corpus write must never fail the build */
  }

  return json({ app: out.app, steps: out.steps, text: out.text });
};
