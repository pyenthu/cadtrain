import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { imageToMesh } from '$lib/forge/pipeline';
import type { ForgeInput, ForgeStage } from '$lib/forge/types';

// POST /api/forge/generate  { image: dataURL|path, name?, want?: ForgeStage[] }
//
// STUB. Forges an input image → 3D via src/lib/forge/pipeline. No gen-model
// call + no key handling yet — each stage reports `not-configured` until its
// env var is set (see src/lib/forge/types FORGE_ENV + docs/plans/forge.md).
// Env read via $env/dynamic/private (Rule 3) so keys are runtime + server-only.
const VALID: ForgeStage[] = ['mesh', 'splat', 'cleanplate', 'sfx'];

export const POST = async ({ request }) => {
  let body: any;
  try { body = await request.json(); } catch { throw error(400, 'invalid JSON body'); }

  const image = body?.image;
  if (typeof image !== 'string' || !image.trim()) {
    throw error(400, 'image required (data URL or volume path)');
  }
  const want: ForgeStage[] | undefined = Array.isArray(body?.want)
    ? body.want.filter((s: any): s is ForgeStage => VALID.includes(s))
    : undefined;

  const input: ForgeInput = { image, name: typeof body?.name === 'string' ? body.name : undefined, want };

  // env is the runtime private-env bag; the pipeline reads FORGE_* keys from it.
  const result = await imageToMesh(input, env as Record<string, string | undefined>);
  const configured = result.steps.some((s) => s.status === 'ok');

  return json({ ok: true, configured, result });
};
