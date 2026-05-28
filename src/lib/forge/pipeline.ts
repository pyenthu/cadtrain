/**
 * Forge pipeline — image → 3D. Wraps the image-blaster chain (image → 3D).
 *
 * The `mesh` stage is WIRED to FAL Hunyuan3D v2 over plain HTTP (no SDK dep, so
 * the worktree's shared node_modules is untouched). It is INERT until
 * `FORGE_FAL_KEY` is set in the server env — with no key the stage reports
 * `not-configured` and makes no network call. Other stages (splat/cleanplate/
 * sfx) are still stubs.
 *
 * ⚠ Implemented against FAL's documented REST contract but NOT yet run
 * end-to-end (needs a real FORGE_FAL_KEY). Provider is swappable: point
 * `falHunyuan3dMesh` at a self-hosted Hunyuan3D endpoint to go free (own GPU).
 */
import type { ForgeInput, ForgeResult, ForgeStage, ForgeStepResult } from './types';
import { FORGE_ENV } from './types';

const DEFAULT_STAGES: ForgeStage[] = ['mesh'];

// ~$0.16/gen white mesh. Swap the variant here: hunyuan3d/v2/mini (~$0.10),
// hunyuan-3d/v3.1/rapid (~$0.225), .../pro (~$0.375). Or repoint to self-host.
const FAL_MESH_MODEL = 'fal-ai/hunyuan3d/v2';
const FAL_QUEUE = 'https://queue.fal.run';
const POLL_MS = 2500;
const POLL_TIMEOUT_MS = 180_000;

/** Which requested stages are runnable given the configured env keys. `env` is
 *  injected by the caller (server endpoint) so this module needs no `$env`. */
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

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** FAL Hunyuan3D v2 image→mesh over the queue REST API. Returns the `.glb` URL.
 *  `imageUrl` may be a base64 data URI (FAL accepts it) or a public URL. */
async function falHunyuan3dMesh(imageUrl: string, key: string): Promise<string> {
  const auth = { Authorization: `Key ${key}` };
  const submit = await fetch(`${FAL_QUEUE}/${FAL_MESH_MODEL}`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ input_image_url: imageUrl }),
  });
  if (!submit.ok) throw new Error(`FAL submit ${submit.status}: ${(await submit.text().catch(() => '')).slice(0, 200)}`);
  const { status_url, response_url } = await submit.json();
  if (!status_url || !response_url) throw new Error('FAL submit missing status_url/response_url');

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  for (;;) {
    if (Date.now() > deadline) throw new Error('FAL job timed out');
    await sleep(POLL_MS);
    const st = await (await fetch(status_url, { headers: auth })).json();
    if (st?.status === 'COMPLETED') break;
    if (st?.status === 'FAILED' || st?.status === 'ERROR') throw new Error(`FAL job ${st.status}`);
  }
  const result = await (await fetch(response_url, { headers: auth })).json();
  const url = result?.model_mesh?.url;
  if (typeof url !== 'string') throw new Error('FAL result missing model_mesh.url');
  return url;
}

/** Persist a remote .glb onto the volume; returns the volume-relative path. */
async function saveGlbToVolume(glbUrl: string): Promise<{ rel: string; bytes: number }> {
  const { volumePath } = await import('$lib/server/volume');
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { dirname } = await import('node:path');
  const rel = `forge/${Date.now()}/model.glb`;
  const abs = volumePath(rel);
  await mkdir(dirname(abs), { recursive: true });
  const bytes = new Uint8Array(await (await fetch(glbUrl)).arrayBuffer());
  await writeFile(abs, bytes);
  return { rel, bytes: bytes.length };
}

/**
 * Forge an input image into 3D. Runs each runnable stage; unconfigured stages
 * stay `not-configured` (no network). Today only `mesh` is implemented (FAL
 * Hunyuan3D → volume .glb); the rest report `not-configured`.
 */
export async function imageToMesh(
  input: ForgeInput,
  env: Record<string, string | undefined>,
): Promise<ForgeResult> {
  const steps = planStages(input.want, env);
  let glb: string | undefined;

  for (const step of steps) {
    if (step.status !== 'ok') continue; // key absent → leave as not-configured
    if (step.stage === 'mesh') {
      try {
        const meshUrl = await falHunyuan3dMesh(input.image, env.FORGE_FAL_KEY!);
        const saved = await saveGlbToVolume(meshUrl);
        glb = saved.rel;
        step.output = saved.rel;
        step.message = `forged ${saved.bytes.toLocaleString()} bytes → ${saved.rel}`;
      } catch (e) {
        step.status = 'error';
        step.message = (e as Error)?.message ?? String(e);
      }
    } else {
      step.status = 'not-configured';
      step.message = `${step.stage} stage not implemented yet`;
    }
  }
  return { glb, steps };
}

/** True when at least one requested stage is configured (any key present). */
export function anyStageConfigured(
  want: ForgeStage[] | undefined,
  env: Record<string, string | undefined>,
): boolean {
  return planStages(want, env).some((s) => s.status === 'ok');
}
