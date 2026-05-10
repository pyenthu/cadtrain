/**
 * Two backends for /api/identify (component recognition).
 *
 *   identifyViaApi  — current code, RAG-augmented call to @anthropic-ai/sdk.
 *                     Per-token billed against ANTHROPIC_API_KEY. Works in
 *                     dev and production.
 *
 *   identifyViaCli  — spawns claude --print. Bills against Pro/Max OAuth.
 *                     Local-only (Railway has no claude binary). Step-1 cut:
 *                     skips RAG neighbor retrieval — sends target image +
 *                     catalog text only. RAG-via-file-paths is a deferred
 *                     follow-up.
 *
 * Both functions return the same IdentifyResponse shape. The endpoint
 * picks at runtime via IDENTIFY_BACKEND=cli|api.
 *
 * CLI subprocess + temp-file + envelope parsing are factored into
 * src/lib/shared/. This file owns the catalog text, RAG retrieval, and
 * content-block assembly — the domain-specific bits.
 */

import { COMPONENTS } from '$components/library';
import { env } from '$env/dynamic/private';
import { getCache } from '$lib/training/cache';
import { computePHash } from '$lib/training/phash';
import { computeEmbedding } from '$lib/training/embed';
import { createAnthropicClient } from '$lib/shared/anthropic-api';
import { guessImageExt } from '$lib/shared/mime';
import { withTempFile } from '$lib/shared/temp-file';
import {
  buildClaudeCliArgs,
  spawnClaudeCli,
  parseCliEnvelope,
} from '$lib/shared/claude-cli';
import { join } from 'node:path';

const CACHE_PATH = join(process.cwd(), 'training_data', 'cache.jsonl');
const TOP_K = 5;
const DEFAULT_API_MODEL = env.IDENTIFY_MODEL ?? 'claude-sonnet-4-20250514';
const DEFAULT_CLI_MODEL = env.IDENTIFY_CLI_MODEL ?? 'opus';

export interface IdentifyRequest {
  imageBuffer: Buffer;
  mime: string;
  filename: string;
}

export interface IdentifyResponse {
  result: any;
  modelUsed: string;
  durationMs: number;
  retrieved?: Array<{ id: string; component_id: string; source: string }>;
}

function buildCatalogText(): string {
  return COMPONENTS.map((c) => {
    const params = Object.entries(c.params)
      .map(([k, p]) => `${k} (${p.label}): ${p.min}-${p.max}`)
      .join(', ');
    return `- ${c.id} ("${c.name}") — ${c.description}\n  Tags: ${c.tags.join(', ')}\n  Params: ${params}`;
  }).join('\n\n');
}

const OUTPUT_SPEC = `Return ONLY a JSON object (no prose, no fences):
{
  "component_id": "...",
  "component_name": "...",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation",
  "estimated_params": { ... }
}

Use the EXACT parameter keys from the component's param list.`;

// ---------- API backend ----------

export async function identifyViaApi(req: IdentifyRequest): Promise<IdentifyResponse> {
  const client = createAnthropicClient();
  const base64 = req.imageBuffer.toString('base64');
  const mediaType = req.mime || 'image/png';

  // RAG retrieval
  const cache = await getCache(CACHE_PATH);
  const [hash, embedding] = await Promise.all([
    computePHash(req.imageBuffer),
    computeEmbedding(req.imageBuffer),
  ]);
  const similar = await cache.findSimilar(embedding, hash, TOP_K);
  cache.incrementUse(similar.map((r) => r.id));

  const catalogPrompt = `You are a downhole tool component identifier.

COMPONENT CATALOG (18 types):
${buildCatalogText()}`;

  const content: any[] = [];
  content.push({
    type: 'text',
    text: catalogPrompt,
    cache_control: { type: 'ephemeral' },
  });

  if (similar.length > 0) {
    content.push({
      type: 'text',
      text: `\n\nHere are ${similar.length} similar examples from training data. Study them — they show how to identify and parameterize components like the target:`,
    });
    similar.forEach((rec, i) => {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: rec.image_b64 },
      });
      content.push({
        type: 'text',
        text: `Example ${i + 1} → component_id: "${rec.component_id}", params: ${JSON.stringify(rec.params)}`,
      });
    });
  }

  content.push({
    type: 'text',
    text: `\n\nNow identify this NEW image using the same format as the examples above:`,
  });
  content.push({
    type: 'image',
    source: { type: 'base64', media_type: mediaType as any, data: base64 },
  });
  content.push({
    type: 'text',
    text: OUTPUT_SPEC + `\n\nReference the most similar training example in your reasoning.`,
  });

  const t0 = Date.now();
  const response = await client.messages.create({
    model: DEFAULT_API_MODEL,
    max_tokens: 1024,
    messages: [{ role: 'user', content }],
  });

  let text = (response.content[0] as any).text.trim();
  if (text.includes('```')) {
    text = text.split('```')[1];
    if (text.startsWith('json')) text = text.slice(4);
    text = text.trim();
  }

  const result = JSON.parse(text);
  return {
    result,
    modelUsed: DEFAULT_API_MODEL,
    durationMs: Date.now() - t0,
    retrieved: similar.map((r) => ({
      id: r.id,
      component_id: r.component_id,
      source: r.source,
    })),
  };
}

// ---------- CLI backend (step 1: no RAG) ----------

export async function identifyViaCli(req: IdentifyRequest): Promise<IdentifyResponse> {
  const ext = guessImageExt(req.mime);

  return withTempFile('cadtrain-identify-', ext, req.imageBuffer, async ({ filePath, dir }) => {
    const systemPrompt = `You are a downhole tool component identifier. The user will give you the path to an image of an industrial component. Identify which of the 18 catalog primitives below it is, and estimate its parameters.

COMPONENT CATALOG (18 types):
${buildCatalogText()}

${OUTPUT_SPEC}`;

    const userPrompt =
      `Read the image at this path: ${filePath}\n\n` +
      `Identify which catalog primitive it is and estimate its parameters. Return ONLY the JSON.`;

    const args = buildClaudeCliArgs({
      model: DEFAULT_CLI_MODEL,
      addDir: dir,
      systemPrompt,
      userPrompt,
    });

    const t0 = Date.now();
    const { stdout, stderr, exitCode } = await spawnClaudeCli(args);

    if (exitCode !== 0) {
      throw new Error(
        `claude CLI exited with code ${exitCode}. stderr: ${stderr.slice(0, 500)}`,
      );
    }

    const raw = parseCliEnvelope(stdout, { stripCodeFences: true });

    let result: any;
    try {
      result = JSON.parse(raw);
    } catch (e) {
      throw new Error(
        `identifyViaCli: model returned non-JSON: ${(e as Error).message}. raw: ${raw.slice(0, 300)}`,
      );
    }

    return {
      result,
      modelUsed: `claude-cli (${DEFAULT_CLI_MODEL})`,
      durationMs: Date.now() - t0,
    };
  });
}
