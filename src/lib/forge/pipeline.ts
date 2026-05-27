/**
 * Forge pipeline — STUB. Wraps the image-blaster skill-chain (image → 3D).
 *
 * Status: scaffold only. `imageToMesh` does NOT call any gen-model API and
 * handles NO keys yet. Each requested stage reports `not-configured` until its
 * env var is set (FORGE_ENV in ./types). When the user provisions keys, fill in
 * the per-stage calls here (FAL Hunyuan-3D, World Labs Marble, …) — reading the
 * key from the SERVER env only, never the client/transcript.
 *
 * Why a single entry point: the route + the /api/forge/generate endpoint both
 * go through this so the gen-model wiring lives in ONE place.
 */
import type { ForgeInput, ForgeResult, ForgeStage, ForgeStepResult } from './types';
import { FORGE_ENV } from './types';

const DEFAULT_STAGES: ForgeStage[] = ['mesh'];

/** Resolve which requested stages are runnable given the configured env keys.
 *  `env` is injected by the caller (server endpoint) — this module stays
 *  free of `$env` imports so it's unit-testable. */
export function planStages(
  want: ForgeStage[] | undefined,
  env: Record<string, string | undefined>,
): ForgeStepResult[] {
  const stages = want?.length ? want : DEFAULT_STAGES;
  return stages.map((stage) => {
    const { env: key, provider } = FORGE_ENV[stage];
    const configured = !!env[key];
    return {
      stage,
      provider,
      status: configured ? 'ok' : 'not-configured',
      message: configured ? undefined : `set ${key} to enable ${provider}`,
    };
  });
}

/**
 * Forge an input image into 3D. STUB: returns the per-stage plan with every
 * unconfigured stage marked `not-configured`. No network, no keys. The real
 * implementation will, per runnable stage, call the provider and drop outputs
 * onto the volume (forge/<id>/…), then return their volume paths.
 */
export async function imageToMesh(
  input: ForgeInput,
  env: Record<string, string | undefined>,
): Promise<ForgeResult> {
  void input; // not used until the gen-model calls are wired
  const steps = planStages(input.want, env);
  // TODO(forge): for each step with status 'ok', call its provider:
  //   mesh       → FAL Hunyuan-3D  → .glb/.obj
  //   splat      → World Labs Marble → .spz
  //   cleanplate → nano-banana / gpt-image edit → ref pngs
  //   sfx        → ElevenLabs sfx → .mp3
  // Write each output under the volume (forge/<runId>/…) and set the path here.
  return { steps };
}

/** True when at least one requested stage is configured (any key present). */
export function anyStageConfigured(
  want: ForgeStage[] | undefined,
  env: Record<string, string | undefined>,
): boolean {
  return planStages(want, env).some((s) => s.status === 'ok');
}
