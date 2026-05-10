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
 *
 * CLI subprocess + temp-file + envelope parsing live in src/lib/shared/.
 * This file owns the WSON-specific prompts and content-block assembly.
 */

import type Anthropic from '@anthropic-ai/sdk';
import { env } from '$env/dynamic/private';
import { EXTRACTOR_SYSTEM_PROMPT, EXTRACTOR_USER_INSTRUCTION } from './prompt';
import { createAnthropicClient } from '$lib/shared/anthropic-api';
import { guessImageExt } from '$lib/shared/mime';
import { withTempFile } from '$lib/shared/temp-file';
import {
  buildClaudeCliArgs,
  spawnClaudeCli,
  parseCliEnvelope,
} from '$lib/shared/claude-cli';

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
  const client = createAnthropicClient();
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
  const ext = req.mime === 'application/pdf' ? '.pdf' : guessImageExt(req.mime);
  const model = (req.modelOverride ?? '').trim() || DEFAULT_CLI_MODEL;

  return withTempFile('cadtrain-wells-', ext, req.fileBuffer, async ({ filePath, dir }) => {
    const userPrompt =
      `Read the file at this path: ${filePath}\n\n` +
      (req.supplementaryText?.trim()
        ? `Supplementary text from the document (deviation tally, notes, etc.):\n\n${req.supplementaryText.trim()}\n\n`
        : '') +
      EXTRACTOR_USER_INSTRUCTION;

    const args = buildClaudeCliArgs({
      model,
      addDir: dir,
      systemPrompt: EXTRACTOR_SYSTEM_PROMPT,
      userPrompt,
    });

    const t0 = Date.now();
    const { stdout, stderr, exitCode } = await spawnClaudeCli(args);

    if (exitCode !== 0) {
      throw new Error(
        `claude CLI exited with code ${exitCode}. stderr: ${stderr.slice(0, 500)}`,
      );
    }

    const rawText = parseCliEnvelope(stdout);

    return {
      rawText,
      modelUsed: `claude-cli (${model})`,
      durationMs: Date.now() - t0,
    };
  });
}
