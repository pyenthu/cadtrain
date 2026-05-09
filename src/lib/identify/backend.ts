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
 */

import { spawn } from 'node:child_process';
import { writeFile, unlink, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { COMPONENTS } from '$components/library';
import { env } from '$env/dynamic/private';
import { getCache } from '$lib/training/cache';
import { computePHash } from '$lib/training/phash';
import { computeEmbedding } from '$lib/training/embed';

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
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not set (required for api backend)');
  }
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

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
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
  const dir = await mkdtemp(join(tmpdir(), 'cadtrain-identify-'));
  const ext = guessImageExt(req.mime);
  const filePath = join(dir, `target${ext}`);
  await writeFile(filePath, req.imageBuffer);

  const systemPrompt = `You are a downhole tool component identifier. The user will give you the path to an image of an industrial component. Identify which of the 18 catalog primitives below it is, and estimate its parameters.

COMPONENT CATALOG (18 types):
${buildCatalogText()}

${OUTPUT_SPEC}`;

  const userPrompt =
    `Read the image at this path: ${filePath}\n\n` +
    `Identify which catalog primitive it is and estimate its parameters. Return ONLY the JSON.`;

  const args = [
    '--print',
    '--output-format', 'json',
    '--model', DEFAULT_CLI_MODEL,
    '--add-dir', dir,
    '--no-session-persistence',
    '--permission-mode', 'bypassPermissions',
    '--append-system-prompt', systemPrompt,
    userPrompt,
  ];

  const t0 = Date.now();
  const proc = spawn('claude', args, {
    timeout: 5 * 60_000,
    env: { ...process.env, NO_COLOR: '1' },
  });

  let stdout = '';
  let stderr = '';
  proc.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
  proc.stderr.on('data', (d: Buffer) => (stderr += d.toString()));

  let exitCode: number;
  try {
    exitCode = await new Promise<number>((resolve, reject) => {
      proc.on('exit', (code) => resolve(code ?? -1));
      proc.on('error', reject);
    });
  } finally {
    await unlink(filePath).catch(() => {});
  }

  if (exitCode !== 0) {
    throw new Error(
      `claude CLI exited with code ${exitCode}. stderr: ${stderr.slice(0, 500)}`,
    );
  }

  let envelope: { result?: string; subtype?: string } = {};
  try {
    envelope = JSON.parse(stdout);
  } catch (e) {
    throw new Error(
      `claude CLI returned non-JSON envelope: ${(e as Error).message}. raw: ${stdout.slice(0, 300)}`,
    );
  }
  let raw = (envelope.result ?? '').trim();
  if (!raw) {
    throw new Error(`claude CLI returned empty result. envelope: ${JSON.stringify(envelope).slice(0, 300)}`);
  }
  // Strip code fences if model still wrapped despite our ask.
  if (raw.includes('```')) {
    const start = raw.indexOf('```');
    const end = raw.lastIndexOf('```');
    if (end > start) {
      let body = raw.slice(start + 3, end).trim();
      if (body.startsWith('json')) body = body.slice(4).trim();
      raw = body;
    }
  }

  let result: any;
  try {
    result = JSON.parse(raw);
  } catch (e) {
    throw new Error(`identifyViaCli: model returned non-JSON: ${(e as Error).message}. raw: ${raw.slice(0, 300)}`);
  }

  return {
    result,
    modelUsed: `claude-cli (${DEFAULT_CLI_MODEL})`,
    durationMs: Date.now() - t0,
  };
}

function guessImageExt(mime: string): string {
  if (mime === 'image/png') return '.png';
  if (mime === 'image/jpeg') return '.jpg';
  if (mime === 'image/gif') return '.gif';
  if (mime === 'image/webp') return '.webp';
  return '.bin';
}
