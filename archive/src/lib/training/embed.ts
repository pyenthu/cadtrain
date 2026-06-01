/**
 * CLIP-based image embeddings for retrieval.
 *
 * Replaces the pHash-only discriminator that collapses on similar
 * black-on-white silhouettes (CLAUDE.md TODO, 2026-04-13). pHash is
 * kept on each cache record for backward compat + as a tiebreaker;
 * findSimilar now ranks primarily by embedding cosine similarity.
 *
 * Model: Xenova/clip-vit-base-patch32 (~80 MB, downloaded once,
 *        cached at ~/.cache/transformers/).
 *
 * Runs server-side. The embedder is a singleton — first call loads
 * the model, subsequent calls reuse it. Lazy so dev server startup
 * isn't blocked.
 */

// Order matters: _bun_compat deletes globalThis.self before
// @xenova/transformers loads, so its BROWSER_ENV detection takes the
// Node path (which uses sharp) instead of crashing on missing
// createImageBitmap. Don't reorder these imports.
import './_bun_compat';
import { pipeline, env, RawImage, type Pipeline } from '@xenova/transformers';
import sharp from 'sharp';

env.allowRemoteModels = true;
env.allowLocalModels = true;

let _embedder: Pipeline | null = null;
let _loading: Promise<Pipeline> | null = null;

async function getEmbedder(): Promise<Pipeline> {
  if (_embedder) return _embedder;
  if (_loading) return _loading;

  console.log('[embed] loading CLIP model (first call only)...');
  // 'image-feature-extraction' is the right task for CLIP vision embeddings;
  // 'feature-extraction' (which the original session bundle used) routes to
  // the text encoder and rejects image inputs with "Missing pixel_values".
  _loading = pipeline(
    'image-feature-extraction',
    'Xenova/clip-vit-base-patch32',
  ) as Promise<Pipeline>;
  _embedder = await _loading;
  console.log('[embed] CLIP model ready');
  return _embedder;
}

/**
 * Compute a 512-dimensional embedding for an image.
 *
 * Accepts a Buffer (PNG/JPEG bytes), a base64 string, or a data URL.
 * We always go via RawImage.fromBlob (which uses sharp under the hood
 * in Node) — the pipeline's default URL handling does an http fetch
 * and returns 404 for data URLs.
 */
export async function computeEmbedding(input: Buffer | string): Promise<number[]> {
  const embedder = await getEmbedder();

  // Normalise to Buffer.
  let buf: Buffer;
  if (typeof input === 'string') {
    const b64 = input.startsWith('data:') ? input.replace(/^data:[^;]+;base64,/, '') : input;
    buf = Buffer.from(b64, 'base64');
  } else {
    buf = input;
  }

  // Decode to raw RGB pixels via sharp and build a RawImage directly.
  // We bypass RawImage.fromBlob() because Bun trips its BROWSER_ENV
  // detection (typeof self !== 'undefined') without exposing
  // self.createImageBitmap, so fromBlob crashes mid-call.
  const { data, info } = await sharp(buf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const img = new RawImage(new Uint8ClampedArray(data), info.width, info.height, 4);

  // image-feature-extraction handles its own pooling internally; we don't
  // pass {pooling, normalize}. cosineSim() below tolerates unnormalised
  // vectors so we don't need to L2-normalise here.
  const output = await embedder(img);
  return Array.from(output.data as Float32Array);
}

/**
 * Cosine similarity between two embeddings.
 * Range: [-1, 1]; identical vectors → 1.
 */
export function cosineSim(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`embedding length mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0,
    magA = 0,
    magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Convenience: compute embedding then cosine sim against a target.
 */
export async function similarityTo(input: Buffer | string, target: number[]): Promise<number> {
  const emb = await computeEmbedding(input);
  return cosineSim(emb, target);
}

/**
 * Hybrid score combining embedding similarity with auxiliary signals.
 *
 *   0.75 × cosine(embedding)        ← primary semantic match
 *   0.15 × category match           ← packer ≠ tubing
 *   0.10 × (1 - hamming(pHash)/64)  ← pixel-level tiebreaker
 */
export function hybridScore(args: {
  cosine: number;
  sameCategory: boolean;
  hammingPHash?: number;
}): number {
  const phashScore = args.hammingPHash !== undefined ? 1 - args.hammingPHash / 64 : 0;
  const catScore = args.sameCategory ? 1 : 0;
  return 0.75 * args.cosine + 0.15 * catScore + 0.10 * phashScore;
}

/**
 * Pre-warm the model. Call once at server startup if you want the
 * first /api/identify request to be fast instead of slow.
 */
export async function warmup(): Promise<void> {
  await getEmbedder();
}
