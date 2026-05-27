# `/forge` — image → 3D mesh

**Status:** scaffold (branch `forge`). Route + lib + api stubs stand up the feature;
the gen-model generators are NOT wired and NO API keys are handled yet.

## Why
cadtrain today only does **reverse-ID** (PNG → component id + params via the RAG pipeline at
`/archive/reverse` + `/api/identify`). `/forge` is the complementary, long-standing goal:
**generate actual 3D geometry FROM a single reference image.**

## Lead: image-blaster
`https://github.com/neilsonnn/image-blaster` — an open-source **Claude Code skill** that chains
several generation models behind one interface to turn one image into:
- textured **3D mesh** (`.glb`/`.obj`) — **Hunyuan-3D** (via **FAL**) ← the CAD-relevant output
- explorable Gaussian **splat** (`.spz`) — **World Labs Marble**
- clean-plate background + object reference images — **nano-banana** / gpt-image edit
- ambient/object **SFX** (`.mp3`) — **ElevenLabs**

Worth studying its **skill-chaining structure** (sequencing composable skills) even though the
splat/SFX pieces are CAD-irrelevant. The mesh stage is the priority for cadtrain.

## Layout (mirrors `/primitives`)
- `src/routes/forge/+page.svelte` — UI: upload an image → Generate → per-stage status.
- `src/lib/forge/types.ts` — `ForgeInput` / `ForgeResult` / `ForgeStage` + `FORGE_ENV` (stage→key map).
- `src/lib/forge/pipeline.ts` — `imageToMesh(input, env)` — the single place the gen-model calls live
  (currently a stub returning per-stage `not-configured`).
- `src/routes/api/forge/generate/+server.ts` — POST endpoint; reads keys via `$env/dynamic/private`.

## Configuration (server env only — Rule 3 + secrets handling)
Keys are read at runtime from the **server** env; never hard-coded, never sent to the client, never
pasted into a transcript. The user provisions their own:

| Stage | Env var | Provider |
|---|---|---|
| mesh | `FORGE_FAL_KEY` | Hunyuan-3D (FAL) |
| splat | `FORGE_WORLDLABS_KEY` | World Labs Marble |
| cleanplate | `FORGE_NANOBANANA_KEY` | nano-banana / gpt-image |
| sfx | `FORGE_ELEVENLABS_KEY` | ElevenLabs |

Set locally in `.env` / `.env.local` (user-edited), or in the Railway service Variables tab.

## Next steps (when the user gives go-ahead + keys)
1. Wire the **mesh** stage in `pipeline.ts`: call FAL Hunyuan-3D with the image, receive `.glb`,
   write it under the volume (`forge/<runId>/model.glb`), return its `/api/volume` path.
2. Render the result `.glb` in the page (reuse the existing Threlte GLB viewer, lazy-imported).
3. Optional: splat / cleanplate / sfx stages, gated on their keys.
4. Wire nav (`/forge`) + landing link + a `/plan` roadmap item (R bundle) — coordinate the merge so
   it doesn't race the concurrent `/primitives` work on `main`.

## Isolation note
Built on the `forge` worktree branch off `main` so it doesn't collide with the active `/primitives`
session. All files are greenfield except the eventual nav/landing/plan touches (done last, at merge).
