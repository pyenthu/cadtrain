/**
 * POST /api/primitives/refine
 *
 * Claude-driven source rewrite for a VOLUME PRIMITIVE (the /primitives
 * inspector's AI tab). The user types a goal ("add a torque shoulder",
 * "make the taper 18°"); we send the CURRENT source.ts + that prompt to
 * Claude with a system prompt encoding the volume-primitive file format
 * + project conventions; Claude returns the rewritten full source.ts as
 * a single ```typescript code block; we extract it and return as JSON.
 *
 * Unlike a library COMPONENT (part.json recipe), a volume primitive is a
 * single-file TypeScript artifact:
 *   export const meta = { id, name, description, tags, params: {...} };
 *   export function <id>(...positional params...) { ...returns Manifold }
 * The `meta.params` KEY ORDER must match the function-signature arg order
 * (the dispatch pipes positional args). We tell the model to preserve the
 * meta shape + keep the exported function name === the id.
 *
 * The response is NOT auto-saved. The frontend stores it as a pending
 * proposal the user can Accept (folds into the editor buffer) or Reject;
 * persisting it is a separate POST /api/primitives/save.
 *
 * Body: { id, source, prompt, instructions? }
 * Returns: { ok: true, source } on success, { ok: false, error } otherwise.
 *
 * VLM endpoint — uses ANTHROPIC_API_KEY. It must run LOCALLY (so the local
 * API key is used), so it is NOT in the hooks.server.ts proxy allowlist.
 * The `source` is taken from the request body, never read from disk.
 *
 * Rate-limited via the shared token bucket so this endpoint can't be hammered.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { createAnthropicClient } from '$lib/server/anthropic-api';
import { checkRateLimit } from '$lib/rate_limit';
import { discoverHelpers, discoverOperators } from '$lib/engines/manifold/manifold-helpers-meta';
import { extractMetaFromSource, extractFunctionName } from '$lib/server/primitives-meta';

const MAX_SOURCE_BYTES = 256 * 1024;
const MAX_PROMPT_BYTES = 4 * 1024;
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const ID_RE = /^[a-z][a-z0-9_]*$/i;

/** Format a helper-meta entry as one prompt line, e.g.
 *  `- cyl(length, r1, r2?)  — Z-up cylinder/cone (r2 defaults to r1).` */
function helperLine(h: { name: string; sig: string; desc: string; props: { name: string; optional: boolean }[] }): string {
  const argList = h.props.map((p) => `${p.name}${p.optional ? '?' : ''}`).join(', ');
  return `- \`${h.name}(${argList})\`  — ${h.desc}`;
}

/** Build the system prompt for the VOLUME-PRIMITIVE single-file format.
 *  Helpers + operators are pulled DYNAMICALLY from the helpers source so
 *  a rename flows through automatically and the model can never be told a
 *  stale signature. */
function buildSystemPrompt(currentId: string): string {
  const helpers = discoverHelpers();
  const operators = discoverOperators();
  const helperLines = helpers.map(helperLine).join('\n');
  const operatorLines = operators.map(helperLine).join('\n');

  return `You edit single-file ManifoldCAD VOLUME PRIMITIVES for a downhole CAD app.

# File format — source.ts (single source of truth)
A volume primitive lives at \`<volume>/primitives/<id>/source.ts\` and is
ONE TypeScript file. It exports a \`meta\` object (schema + appearance) and
a function that builds a \`Manifold\` from POSITIONAL params:

\`\`\`typescript
export const meta = {
  id: '<id>',
  name: '<display name>',
  description: '...',
  tags: ['...'],
  params: {
    // KEY ORDER MUST MATCH the function-signature arg order — args are positional.
    paramName: { label: '...', min: N, max: N, step: N, unit: 'in', default: N },
    flagName:  { label: '...', type: 'boolean', default: 0 },          // 0 | 1
    pickName:  { label: '...', type: 'enum', options: ['a','b'], default: 0 }, // index
    profile:   { label: '...', type: 'polygon', default: [[0,0],[1,0],[1,1]] }, // [[x,y],...]
  },
  material: {  // optional appearance baked into the GLB
    outer: { color: '#cc2222', metallic: 0.2, roughness: 0.7 },
    inner: { color: '#3a3a3a', metallic: 0.1, roughness: 0.9 },
  },
};

/** @part <one-line description of what the primitive models>. */
export function ${currentId}(
  paramName: number,
  flagName: number,   // boolean params arrive as 0 | 1
  pickName: number,   // enum params arrive as the selected option INDEX
  profile: string,    // polygon params arrive as a JSON-encoded string — JSON.parse it
): any {
  // ...build and return a Manifold (an object with .getMesh()).
  return m;
}
\`\`\`

# Param types (the \`type\` field on each param)
- (default / 'number')  → function receives a \`number\`.
- 'boolean'             → stored 0 | 1; function receives \`number\` 0 | 1.
- 'enum'  + options[]   → function receives the selected option INDEX (number).
- 'polygon'             → stored [[x,y],...]; function receives a JSON-encoded
                          STRING — \`JSON.parse(arg)\` inside the body (require ≥3 verts).

# Available bundle helpers (parts — produce Manifolds)
${helperLines}

# Available operators (transformations on Manifolds)
${operatorLines}

# Sandbox globals available inside the function body
- \`M\` — the live Manifold class (static methods: \`M.cube\`, \`M.cylinder\`, \`M.union(a, b)\`, …).
- \`G\` — globalThis. The Manifold wasm singleton is at \`G.__cadtrain_manifold__.wasm\`
  (access \`CrossSection\` etc. from there).
- \`Math\` — full standard library.
- \`empty()\` — degenerate zero-volume Manifold (use as an initial accumulator).
- \`initManifold\`, \`setCircularSegmentMode\`, \`getCutBox\`,
  \`CIRCULAR_SEGMENTS_DEFAULT\`, \`CIRCULAR_SEGMENTS_COMPOSE\`.
The function MUST return a Manifold. Throw \`new Error(...)\` on bad input.

# Z-down convention (PROJECT RULE)
- top = LOWER z. bottom = HIGHER z. As z increases, you go DOWN the hole.
- \`mv(part, [0, 0, +N])\` translates the part toward the bottom.

# Manifold gotchas (read before editing)
- \`CrossSection.extrude(L, seg, 0, scaleTop)\` followed by \`.warp(...)\`:
  scaleTop MUST be the Vec2 \`[1, 1]\`, NOT scalar \`1\` — scalar collapses the top profile.
- \`Manifold.warp\` callback receives a Vec3 TUPLE (\`p[0]\`, \`p[1]\`, \`p[2]\`), not \`{x,y,z}\`.
- Manifold ops are immutable — reassign (\`m = m.add(other)\`); they don't mutate in place.
- \`.refine(n)\` cost is roughly n² triangles — keep n modest.

# Output contract (strict)
Respond with the COMPLETE updated file as a single fenced \`\`\`typescript code block.
- No prose before or after the block. No diff. No explanation.
- Keep \`meta.id\` === '${currentId}' AND the exported function name === '${currentId}'.
- Keep the \`export const meta = { ... }\` shape (id, name, description, tags, params).
- Keep \`meta.params\` KEY ORDER aligned with the function-signature arg order.
- Use param names that already exist; introduce new ones only when needed
  (and add them in the SAME position in both the meta and the signature).
- Always close braces and semicolons cleanly. Parse-clean TypeScript only.
`;
}

/** Extract the first fenced code block (TS preferred) from Claude's
 *  response. Falls back to the raw trimmed text if no fence is found. */
function extractCodeBlock(text: string): string {
  const m = /```(?:typescript|ts)?\n([\s\S]*?)\n```/.exec(text);
  if (m) return m[1];
  return text.trim();
}

/** Lightweight post-generation validation. Confirms the rewritten source
 *  still has an extractable meta block, keeps the id, and exports a
 *  function named after the id. Cheap; the heavy WASM bake gate lives at
 *  the Accept / save step. Returns { ok: true } or { ok: false, retryHint }. */
function validateRefinedSource(src: string, id: string): { ok: true } | { ok: false; retryHint: string } {
  let meta: any;
  try {
    meta = extractMetaFromSource(src);
  } catch (e: any) {
    return { ok: false, retryHint: `meta block did not extract: ${e?.message ?? e}` };
  }
  if (meta.id && meta.id !== id) {
    return { ok: false, retryHint: `meta.id changed to "${meta.id}" — it MUST stay "${id}".` };
  }
  const fnName = extractFunctionName(src);
  if (!fnName) {
    return { ok: false, retryHint: 'No `export function <id>(...)` declaration found.' };
  }
  if (fnName !== id) {
    return { ok: false, retryHint: `Exported function is named "${fnName}" — it MUST be "${id}".` };
  }
  return { ok: true };
}

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
  const ip = getClientAddress();
  // 6 refines per minute per IP. checkRateLimit returns true when below
  // the cap, false when over — invert for the throw.
  if (!checkRateLimit(`${ip}:primitives-refine`, 6, 60_000)) {
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
  if (!ID_RE.test(id)) throw error(400, `Invalid id format "${id}"`);
  const inst = typeof instructions === 'string' ? instructions : '';
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

  // Build the base user message; the retry round appends an extra turn
  // carrying the validator's hint so Claude can fix the issue without
  // restarting the conversation from scratch.
  const userBase = [
    inst.trim() ? `Persistent design spec for this primitive (from instructions.md):\n\n${inst}\n` : '',
    `Current source of ${id}/source.ts:\n\n\`\`\`typescript\n${source}\n\`\`\``,
    `Goal: ${prompt}`,
    `Return the complete updated file as a single fenced \`\`\`typescript code block.`,
  ].filter(Boolean).join('\n\n');

  const messages: any[] = [{ role: 'user', content: userBase }];

  async function callClaude() {
    try {
      return await client.messages.create({
        model,
        max_tokens: 4096,
        system,
        messages,
      });
    } catch (e: any) {
      throw error(502, `Claude API error: ${e?.message ?? e}`);
    }
  }

  function extractEdited(response: any): { edited: string; raw: string } {
    const raw = (response?.content ?? [])
      .filter((b: any) => b?.type === 'text')
      .map((b: any) => b.text as string)
      .join('\n');
    return { edited: extractCodeBlock(raw), raw };
  }

  // First pass — generate.
  let response: any = await callClaude();
  let { edited, raw } = extractEdited(response);
  if (!edited || edited.length < 20) {
    return json({ ok: false, error: 'Claude did not return a usable code block.', raw }, { status: 502 });
  }

  // Validate + retry once on failure. The retry adds an assistant turn
  // (the previous output) + a user turn with the hint, so Claude sees its
  // prior attempt + the specific error and can fix narrowly. One retry
  // only — repeated failures usually mean the goal is ambiguous.
  let validation = validateRefinedSource(edited, id);
  if (!validation.ok) {
    messages.push({ role: 'assistant', content: raw });
    messages.push({
      role: 'user',
      content:
        `Validation failed on your previous output:\n\n${validation.retryHint}\n\n` +
        `Fix this one issue and re-emit the COMPLETE file as a single \`\`\`typescript code block.`,
    });
    response = await callClaude();
    const retry = extractEdited(response);
    edited = retry.edited;
    raw = retry.raw;
    if (!edited || edited.length < 20) {
      return json(
        { ok: false, error: 'Validator retry: Claude did not return a usable code block.', raw },
        { status: 502 },
      );
    }
    validation = validateRefinedSource(edited, id);
    if (!validation.ok) {
      // Still bad. Return the source AS-IS so the user can inspect, but
      // mark `ok: false` + surface the hint so the inspector knows not to
      // auto-accept (the live-bake gate will catch it on Accept too).
      return json(
        {
          ok: false,
          source: edited,
          model,
          error: `Validation failed after retry: ${validation.retryHint}`,
          usage: response?.usage ?? null,
        },
        { status: 422 },
      );
    }
  }

  return json({
    ok: true,
    source: edited,
    model,
    usage: response?.usage ?? null,
  });
};
