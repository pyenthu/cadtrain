/**
 * POST /api/components/refine
 *
 * Claude-driven source refinement for a component primitive. The user
 * types a goal ("make the upset taper 18° per API standard, add a torque
 * shoulder at z=cone_length"); we send the CURRENT source + that prompt
 * to Claude with a system prompt encoding the component format + project
 * conventions; Claude returns the edited source as a single ```typescript
 * code block; we extract it and return as JSON.
 *
 * The response is NOT auto-saved. The frontend stores it as a pending
 * proposal that the user can Accept (folds into sourceDraft) or Reject.
 *
 * Body: { id, source, prompt }
 * Returns: { ok: true, source } on success, { ok: false, error } otherwise.
 *
 * Rate-limited via the shared token bucket so this endpoint can't be hammered.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { createAnthropicClient } from '$lib/shared/anthropic-api';
import { checkRateLimit } from '$lib/rate_limit';
import { COMPONENT_REGISTRY } from '$lib/cad/components';

const MAX_SOURCE_BYTES = 256 * 1024;
const MAX_PROMPT_BYTES = 4 * 1024;
const DEFAULT_MODEL = 'claude-sonnet-4-6';

/** Build the system prompt — explains the component file format, the
 *  ManifoldCAD ops the geom can use, the Z-down rule, and the strict
 *  output contract (one fenced TS code block, nothing else). Includes
 *  the OTHER single-file components' meta as a compact catalog so the model
 *  can suggest composing them. */
function buildSystemPrompt(currentId: string): string {
  const otherPrims = COMPONENT_REGISTRY.filter((e) => e.meta.id !== currentId).map((e) => {
    const params = Object.keys(e.meta.params).join(', ');
    return `  - ${e.meta.id} (${e.meta.name}): geom({ ${params} })`;
  }).join('\n');

  return `You edit single-file ManifoldCAD primitives for a downhole CAD app.

# File format
Each primitive lives in src/lib/cad/components/<id>.ts and exports two things:

\`\`\`typescript
import { cyl, tube, mv, rot } from '../manifold-helpers';
// optional: import { geom as <otherId>Geom } from './<otherId>';

export const meta = {
  id: '<id>',
  name: '<display name>',
  description: '...',
  tags: ['...'],
  params: {
    paramName: { group?: 'GroupName', label: '...', min: N, max: N, step: N, unit: 'in', default: N },
    // ...
  },
  derived: {  // optional — computed from sliders, merged into geom's p
    derivedName: { label: '...', unit: '...', from: (p) => <expr> },
  },
  validate: (p) => string[],  // optional
} as const;

export const geom = (p: Record<string, number>) => {
  // returns a Manifold via cyl()/tube()/.add()/.subtract()/.intersect()/mv()/rot()
};
\`\`\`

# ManifoldCAD operations available
- \`cyl(h, r1, r2?)\` → Z-up cylinder/cone (r2 defaults to r1).
- \`tube(outerR, innerR, h)\` → hollow tube.
- \`mv(part, [x, y, z])\` → translate.
- \`rot(part, [x, y, z])\` → rotate (degrees).
- Manifold methods: \`.add(other)\` (union), \`.subtract(other)\`, \`.intersect(other)\`.
- Imports must come from '../manifold-helpers' or another component file './<id>'.

# Z-down convention (RULE)
- top = LOWER z. bottom = HIGHER z. As z increases, you go DOWN the hole.
- \`mv(part, [0, 0, +N])\` moves the part toward the bottom.
- An upset flange at the top sits at z=0; the body translates to z ≥ flange_length.

# Other primitives available to compose (import as \`geom as <id>Geom\`)
${otherPrims || '  (none other than the current one)'}

# Derived params
If a value is purely computed from sliders, declare it in \`meta.derived\` so
it shows read-only in the UI and is automatically present on \`p\` in geom().
Don't recompute the same value with literals — promote it to derived.

# Output contract
Respond with the COMPLETE updated file as a single fenced \`\`\`typescript code block.
- No prose before or after the block. No diff. No explanation.
- Preserve all existing imports and exports unless explicitly being asked to change them.
- Keep the existing \`meta.id\` unchanged.
- Add comments sparingly — only where the geometry intent isn't obvious from names.
- Use the param names that already exist; introduce new ones only when the request requires them.
- Always close braces and semicolons cleanly.
`;
}

/** Extract the first fenced code block (TS preferred) from Claude's
 *  response. Falls back to returning the raw text trimmed if no fence
 *  is found — better to return SOMETHING the user can inspect than a
 *  cryptic error. */
function extractCodeBlock(text: string): string {
  const m = /```(?:typescript|ts)?\n([\s\S]*?)\n```/.exec(text);
  if (m) return m[1];
  return text.trim();
}

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
  const ip = getClientAddress();
  // 6 refines per minute per IP. checkRateLimit returns true when below
  // the cap, false when over — invert for the throw.
  if (!checkRateLimit(`${ip}:components-refine`, 6, 60_000)) {
    throw error(429, 'Too many refine requests — try again in a minute.');
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') throw error(400, 'Invalid JSON body');
  const { id, source, prompt, instructions } = body as {
    id?: unknown; source?: unknown; prompt?: unknown; instructions?: unknown;
  };
  if (typeof id !== 'string' || typeof source !== 'string' || typeof prompt !== 'string') {
    throw error(400, 'Missing id (string), source (string), or prompt (string).');
  }
  const inst = typeof instructions === 'string' ? instructions : '';
  if (!/^[a-z][a-z0-9_]*$/.test(id)) throw error(400, `Invalid id format "${id}"`);
  if (Buffer.byteLength(source, 'utf8') > MAX_SOURCE_BYTES) {
    throw error(413, `Source too large (> ${MAX_SOURCE_BYTES} bytes)`);
  }
  if (Buffer.byteLength(prompt, 'utf8') > MAX_PROMPT_BYTES) {
    throw error(413, `Prompt too long (> ${MAX_PROMPT_BYTES} bytes)`);
  }
  if (Buffer.byteLength(inst, 'utf8') > MAX_SOURCE_BYTES) {
    throw error(413, `Instructions too long (> ${MAX_SOURCE_BYTES} bytes)`);
  }

  const client = createAnthropicClient();
  const model = env.RUNES_REFINE_MODEL ?? DEFAULT_MODEL;
  const system = buildSystemPrompt(id);

  let response: any;
  try {
    response = await client.messages.create({
      model,
      max_tokens: 4096,
      system,
      messages: [
        {
          role: 'user',
          content: [
            inst.trim() ? `Persistent design spec for this primitive (from ${id}.md):\n\n${inst}\n` : '',
            `Current source of ${id}.ts:\n\n\`\`\`typescript\n${source}\n\`\`\``,
            `Goal: ${prompt}`,
            `Return the complete updated file as a single fenced \`\`\`typescript code block.`,
          ].filter(Boolean).join('\n\n'),
        },
      ],
    });
  } catch (e: any) {
    throw error(502, `Claude API error: ${e?.message ?? e}`);
  }

  // Concatenate all text blocks from the response (Claude SDK returns
  // content as an array of blocks; for a text-only completion there's
  // usually just one, but tolerate multiple).
  const raw = (response?.content ?? [])
    .filter((b: any) => b?.type === 'text')
    .map((b: any) => b.text as string)
    .join('\n');

  const edited = extractCodeBlock(raw);
  if (!edited || edited.length < 20) {
    return json({ ok: false, error: 'Claude did not return a usable code block.', raw }, { status: 502 });
  }

  return json({
    ok: true,
    source: edited,
    model,
    usage: response?.usage ?? null,
  });
};
