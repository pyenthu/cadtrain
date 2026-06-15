import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { createAnthropicClient } from '$lib/shared/anthropic-api';
import { toClaudeTools, toolListText } from '$lib/cad/editor-tools-schema';

/**
 * POST /api/rag/assist — ONE Claude call per turn for the context-aware ✨
 * "edit this part" assistant (Phase 1 of docs/plans/ai-function-mapping.md).
 *
 * This is the thin proxy half of the SVTC pattern (`/api/chat`): it does a
 * single tool-use round-trip and returns EITHER the tool calls Claude wants to
 * run OR a final text answer. It does NOT execute the tools — there's no Graph
 * on the server. The CLIENT (GraphEditorPane) holds the live `graph`, runs
 * `dispatchEditorTool(name, input, graph)` for each returned call, appends the
 * tool_result, and re-POSTs to continue the loop (≤ ~6 steps). See the bottom
 * of the plan + this file's "CLIENT LOOP" note for the exact wiring.
 *
 * Request body:
 *   { prompt?, graphState?, messages?, model? }
 *     • prompt     — the user's instruction (first turn only).
 *     • graphState — readEditorState(graph, ctx) output; injected into the
 *                    system prompt so the model sees params/nodes/selection.
 *     • messages   — the FULL Anthropic message array for continuation turns
 *                    (prior assistant `content` incl tool_use + thinking, then
 *                    a user turn carrying tool_result blocks). When present it
 *                    is used verbatim; `prompt` is then ignored for message
 *                    construction (graphState still re-injected into system).
 *     • model      — optional per-request model override.
 *
 * Response:
 *   { type:'tool_use', calls:[{id,name,input}], content, stopReason }
 *   { type:'text', text, content, stopReason }
 *   `content` is the raw assistant content-block array — the client MUST append
 *   it (unchanged — adaptive thinking blocks replay verbatim) before the next
 *   tool_result user turn.
 *
 * Model: RAG_ASSIST_MODEL || claude-opus-4-8 (opus for best tool selection;
 * stays decoupled from RAG_MODEL, which the cheaper /api/rag/prompt generate
 * path uses). Adaptive thinking on (Opus 4.8). Like /api/rag/prompt this route
 * is prod-proxied so ANTHROPIC_API_KEY lives prod-side.
 */

const MODEL = () => env.RAG_ASSIST_MODEL || 'claude-opus-4-8';
const MAX_TOKENS = 4096;

function buildAssistSystem(graphState: unknown): string {
  const stateJson = (() => {
    try {
      return JSON.stringify(graphState ?? {}, null, 2);
    } catch {
      return '{}';
    }
  })();

  return [
    'You are an assistant embedded in cadtrain\'s node-graph parametric CAD editor.',
    'You help the user EDIT the part currently open by calling editor tools — you',
    'do not write code or return a whole new graph. Make the smallest set of tool',
    'calls that satisfies the request, then stop with a one-line confirmation.',
    '',
    'KEY SHAPE — every Call arg and every polygon coordinate is an ArgValue union:',
    '  {"kind":"literal","value":N}   a fixed number/string/boolean',
    '  {"kind":"expr","expr":"p.od/2 - p.wall"}  a JS expression (params bound as p.<name>)',
    '  {"kind":"param","param":"OD"}  wired to the PARAMS row named OD',
    '',
    'RULES:',
    '- Node ids look like "n_ab12cd" and cannot be guessed. Use the CURRENT EDITOR',
    '  STATE below (or call getEditorState) to find the right id/alias before any',
    '  tool that targets a node. Call nodes can also be addressed by alias (A, B…).',
    '- To wire an arg to a slider that does not exist yet, addParam first, then',
    '  wireArgToParam.',
    '- When the task is done (or no tool fits), reply with a short plain-text summary',
    '  and DO NOT call a tool.',
    '',
    'AVAILABLE TOOLS:',
    toolListText(),
    '',
    'CURRENT EDITOR STATE (the part you are editing):',
    stateJson,
  ].join('\n');
}

type AnthMessage = { role: 'user' | 'assistant'; content: unknown };

export const POST = async ({ request }: { request: Request }) => {
  let body: any;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'invalid JSON body');
  }

  const messagesIn: AnthMessage[] | undefined = Array.isArray(body?.messages) ? body.messages : undefined;
  const prompt = String(body?.prompt ?? '').trim();
  if (!messagesIn && !prompt) {
    throw error(400, 'either `prompt` (first turn) or `messages` (continuation) is required');
  }

  const messages: AnthMessage[] = messagesIn ?? [{ role: 'user', content: prompt }];
  const system = buildAssistSystem(body?.graphState);
  const model = String(body?.model || MODEL());

  let msg: any;
  try {
    const client = createAnthropicClient();
    msg = await client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system,
      tools: toClaudeTools() as any,
      tool_choice: { type: 'auto' } as any,
      thinking: { type: 'adaptive' } as any,
      messages: messages as any,
    });
  } catch (e: any) {
    throw error(502, `claude call failed: ${e?.message ?? e}`);
  }

  const content = Array.isArray(msg?.content) ? msg.content : [];
  const calls = content
    .filter((b: any) => b?.type === 'tool_use')
    .map((b: any) => ({ id: b.id, name: b.name, input: b.input ?? {} }));

  if (calls.length > 0) {
    return json({ type: 'tool_use', calls, content, stopReason: msg.stop_reason });
  }

  const text = content
    .filter((b: any) => b?.type === 'text')
    .map((b: any) => b.text)
    .join('');
  return json({ type: 'text', text, content, stopReason: msg.stop_reason });
};
