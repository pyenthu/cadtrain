/**
 * Forge — image → 3D mesh. Type surface for the generative pipeline.
 *
 * cadtrain today only does reverse-ID (PNG → component id + params via RAG).
 * Forge is the complementary goal: generate actual 3D geometry FROM a single
 * reference image, by wrapping the `image-blaster` skill-chain
 * (github.com/neilsonnn/image-blaster) — Hunyuan-3D (mesh, via FAL) · World
 * Labs Marble (Gaussian splat) · nano-banana (clean-plate) · ElevenLabs (SFX).
 *
 * This is the scaffold only: NO gen-model calls and NO API keys yet (those
 * arrive via env when the user provisions them — see docs/plans/forge.md).
 */

/** One input image (data URL or volume path) the pipeline forges into 3D. */
export interface ForgeInput {
  /** base64 data URL of the source image, or a volume-relative path. */
  image: string;
  /** original filename (for output naming / provenance). */
  name?: string;
  /** which chain stages to run; defaults to mesh-only for CAD use. */
  want?: ForgeStage[];
}

/** The image-blaster chain stages. cadtrain cares mainly about `mesh`; the
 *  splat / cleanplate / sfx stages are carried for parity but optional. */
export type ForgeStage = 'mesh' | 'splat' | 'cleanplate' | 'sfx';

/** What a forge run produces. All optional — depends on `want` + which keys
 *  are configured. Paths are volume-relative (served via /api/volume). */
export interface ForgeResult {
  /** textured mesh — the primary CAD-relevant output (Hunyuan-3D). */
  glb?: string;
  obj?: string;
  /** explorable Gaussian splat of the static scene (World Labs Marble). */
  splat?: string;
  /** clean-plate background + object reference images (nano-banana). */
  refs?: string[];
  /** ambient / object SFX (ElevenLabs). */
  sfx?: string;
  /** per-stage status so the UI can show partial progress. */
  steps: ForgeStepResult[];
}

export interface ForgeStepResult {
  stage: ForgeStage;
  status: 'ok' | 'skipped' | 'not-configured' | 'error';
  /** the model/provider that ran (or would run) this stage. */
  provider?: string;
  output?: string;
  message?: string;
}

/** Which env vars gate which stage. Read server-side via $env/dynamic/private
 *  (Rule 3) — keys are NEVER hard-coded or sent to the client. */
export const FORGE_ENV: Record<ForgeStage, { env: string; provider: string }> = {
  mesh: { env: 'FORGE_FAL_KEY', provider: 'Hunyuan-3D (FAL)' },
  splat: { env: 'FORGE_WORLDLABS_KEY', provider: 'World Labs Marble' },
  cleanplate: { env: 'FORGE_NANOBANANA_KEY', provider: 'nano-banana / gpt-image' },
  sfx: { env: 'FORGE_ELEVENLABS_KEY', provider: 'ElevenLabs' },
};
