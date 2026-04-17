/**
 * POST /api/author/chat
 *
 * Claude tool-calling chat for the authoring assistant. The client sends
 * messages + current app state; the server builds the system prompt,
 * attaches the tool schema, and calls the Anthropic API. Returns either
 * a tool_use block (for the client to execute locally) or a text response.
 *
 * Mirrors SVTC's /api/chat/+server.js pattern.
 */

import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { toClaudeTools } from '$lib/authoring/toolSchema';
import { buildSystemPrompt } from '$lib/authoring/systemPrompt';
import type { RequestHandler } from './$types';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const CONTEXT_PATH = join(process.cwd(), 'training_data', 'authored_context.md');

export const POST: RequestHandler = async ({ request }) => {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) throw error(500, 'ANTHROPIC_API_KEY is not configured');

  let body: { messages: any[]; appState?: string; model?: string };
  try {
    body = await request.json();
  } catch {
    throw error(400, 'Invalid JSON body');
  }

  const { messages, appState } = body;
  if (!Array.isArray(messages) || messages.length === 0) {
    throw error(400, 'messages array is required');
  }

  const model = body.model || env.AUTHOR_MODEL || 'claude-haiku-4-5-20251001';

  // Load growing context doc if available
  let contextDoc: string | undefined;
  if (existsSync(CONTEXT_PATH)) {
    try { contextDoc = readFileSync(CONTEXT_PATH, 'utf-8'); } catch { /* non-fatal */ }
  }

  const systemPrompt = buildSystemPrompt(appState, contextDoc);

  const apiBody: any = {
    model,
    max_tokens: 2048,
    system: systemPrompt,
    messages,
    tools: toClaudeTools(),
  };

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(apiBody),
  });

  if (!res.ok) {
    const text = await res.text();
    let msg: string | undefined;
    try { msg = JSON.parse(text)?.error?.message; } catch {}
    console.error(`[author/chat] API error ${res.status}:`, msg ?? text);
    throw error(res.status, msg || `Anthropic API error ${res.status}`);
  }

  const data = await res.json();

  const toolUseBlock = data.content?.find((b: any) => b.type === 'tool_use');
  if (toolUseBlock) {
    return json({
      type: 'tool_use',
      toolUseId: toolUseBlock.id,
      toolName: toolUseBlock.name,
      toolInput: toolUseBlock.input,
      stopReason: data.stop_reason,
    });
  }

  const textBlock = data.content?.find((b: any) => b.type === 'text');
  return json({
    type: 'text',
    content: textBlock?.text ?? '',
  });
};
