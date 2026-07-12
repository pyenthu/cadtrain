import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { createAnthropicClient } from '$lib/server/anthropic-api';

/**
 * POST /api/primitives/describe → { id, source, bake? } → { markdown }
 *
 * Generates a "drawing descriptor" markdown for a parametric CAD part by
 * inferring from its emitted source (and optional bake stats). One Claude
 * call, GitHub-flavored markdown out. Wires the ✨ "AI describe" button in
 * the MD tab of GraphEditorPane (#117).
 *
 * Runs locally with the `.env` ANTHROPIC_API_KEY (present in dev) or on
 * prod — it only needs the source (in the body) + the API key, so it is
 * NOT in VOLUME_PROXY_PATHS.
 *
 * Model: DESCRIBE_MODEL || RAG_MODEL || claude-sonnet-4-6.
 */

const MODEL = () => env.DESCRIBE_MODEL || env.RAG_MODEL || 'claude-sonnet-4-6';

const SYSTEM = `You write a concise 'drawing descriptor' markdown for a parametric CAD part in cadtrain (downhole-tooling domain). Output GitHub-flavored markdown ONLY — no code fences around the whole thing, no preamble. Sections: \`# <id>\`, **Purpose** (one sentence), **Function**, **Composition** (the primitives/operations it's built from — revolve/extrude/CSG — in plain words), **Parameters** (a markdown table: | param | meaning | default | units |), **Drawing notes** (Z-down convention: top = LOWER z; key dimensions/sections), **See also** (related part ids if evident). Keep it tight and factual. INFER from the source; do not invent specs you can't see.`;

export const POST = async ({ request }: { request: Request }) => {
  let body: any;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'invalid JSON body');
  }

  const source = body?.source;
  if (typeof source !== 'string' || !source.trim()) {
    throw error(400, 'source (a string) is required');
  }
  const id = String(body?.id ?? '').trim() || 'part';
  const bake = body?.bake ?? null;

  const parts: string[] = [`Part id: ${id}`];
  if (bake != null) {
    let bakeStr: string;
    try {
      bakeStr = JSON.stringify(bake);
    } catch {
      bakeStr = String(bake);
    }
    if (bakeStr && bakeStr.length > 4000) bakeStr = bakeStr.slice(0, 4000);
    parts.push(`Bake stats (JSON):\n${bakeStr}`);
  }
  parts.push('Source:\n```ts\n' + source.slice(0, 12000) + '\n```');
  const user = parts.join('\n\n');

  let text = '';
  try {
    const client = createAnthropicClient();
    const msg = await client.messages.create({
      model: MODEL(),
      max_tokens: 1500,
      system: SYSTEM,
      messages: [{ role: 'user', content: user }],
    });
    text = msg.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('');
  } catch (e: any) {
    throw error(502, `claude call failed: ${e?.message ?? e}`);
  }

  const markdown = text.trim();
  if (!markdown) throw error(502, 'model returned no markdown');

  return json({ markdown });
};
