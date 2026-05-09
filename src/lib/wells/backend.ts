/**
 * Two backends for the wells extractor.
 *
 *   extractViaApi  — direct @anthropic-ai/sdk call. Per-token billing
 *                    against ANTHROPIC_API_KEY. Works in dev and prod.
 *
 *   extractViaCli  — spawns the local `claude` CLI via --print. Bills
 *                    against the user's Pro/Max subscription (OAuth).
 *                    Local-only: requires `claude` on PATH and active
 *                    auth (`claude auth status` → loggedIn=true).
 *
 * Both functions accept the same WellsExtractRequest and return the
 * same WellsExtractResponse, so the endpoint can pick the backend at
 * runtime via WELLS_BACKEND=cli|api.
 */

import { spawn } from 'node:child_process';
import { writeFile, unlink, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { env } from '$env/dynamic/private';
import { EXTRACTOR_SYSTEM_PROMPT, EXTRACTOR_USER_INSTRUCTION } from './prompt';

const DEFAULT_API_MODEL = env.WELLS_MODEL ?? 'claude-opus-4-7';
const DEFAULT_CLI_MODEL = env.WELLS_CLI_MODEL ?? 'opus';
const MAX_TOKENS = 8192;

export interface WellsExtractRequest {
  fileBuffer: Buffer;
  mime: string;
  filename: string;
  supplementaryText?: string;
  modelOverride?: string;
}

export interface WellsExtractResponse {
  rawText: string;
  modelUsed: string;
  durationMs: number;
}

// ---------- API backend ----------

export async function extractViaApi(req: WellsExtractRequest): Promise<WellsExtractResponse> {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not set (required for api backend)');
  }
  const model = (req.modelOverride ?? '').trim() || DEFAULT_API_MODEL;
  const base64 = req.fileBuffer.toString('base64');

  const userContent: Anthropic.Messages.ContentBlockParam[] = [];
  if (req.mime === 'application/pdf') {
    userContent.push({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: base64 },
    });
  } else if (req.mime.startsWith('image/')) {
    userContent.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: req.mime as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
        data: base64,
      },
    });
  } else {
    throw new Error(`unsupported file type: ${req.mime} (use PDF or image)`);
  }

  if (req.supplementaryText?.trim()) {
    userContent.push({
      type: 'text',
      text: `Supplementary text from the document (deviation tally, notes, etc.):\n\n${req.supplementaryText.trim()}`,
    });
  }
  userContent.push({ type: 'text', text: EXTRACTOR_USER_INSTRUCTION });

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const t0 = Date.now();
  const response = await client.messages.create({
    model,
    max_tokens: MAX_TOKENS,
    system: EXTRACTOR_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userContent }],
  });
  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('no text content in Claude response');
  }
  return {
    rawText: textBlock.text.trim(),
    modelUsed: model,
    durationMs: Date.now() - t0,
  };
}

// ---------- CLI backend ----------

export async function extractViaCli(req: WellsExtractRequest): Promise<WellsExtractResponse> {
  const dir = await mkdtemp(join(tmpdir(), 'cadtrain-wells-'));
  const ext = req.mime === 'application/pdf' ? '.pdf' : guessImageExt(req.mime);
  const filePath = join(dir, `upload${ext}`);
  await writeFile(filePath, req.fileBuffer);

  const model = (req.modelOverride ?? '').trim() || DEFAULT_CLI_MODEL;

  const userPrompt =
    `Read the file at this path: ${filePath}\n\n` +
    (req.supplementaryText?.trim()
      ? `Supplementary text from the document (deviation tally, notes, etc.):\n\n${req.supplementaryText.trim()}\n\n`
      : '') +
    EXTRACTOR_USER_INSTRUCTION;

  const args = [
    '--print',
    '--output-format', 'json',
    '--model', model,
    '--add-dir', dir,
    '--no-session-persistence',
    '--permission-mode', 'bypassPermissions',
    '--append-system-prompt', EXTRACTOR_SYSTEM_PROMPT,
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

  // --output-format json gives a wrapper { type: 'result', result: '<assistant text>', ... }
  let envelope: { result?: string; subtype?: string } = {};
  try {
    envelope = JSON.parse(stdout);
  } catch (e) {
    throw new Error(
      `claude CLI returned non-JSON envelope: ${(e as Error).message}. raw: ${stdout.slice(0, 300)}`,
    );
  }
  const rawText = (envelope.result ?? '').trim();
  if (!rawText) {
    throw new Error(`claude CLI returned empty result. envelope: ${JSON.stringify(envelope).slice(0, 300)}`);
  }

  return {
    rawText,
    modelUsed: `claude-cli (${model})`,
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
