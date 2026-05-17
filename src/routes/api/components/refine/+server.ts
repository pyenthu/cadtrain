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
import { discoverHelpers, discoverOperators } from '$lib/cad/manifold-helpers-meta';

const MAX_SOURCE_BYTES = 256 * 1024;
const MAX_PROMPT_BYTES = 4 * 1024;
const DEFAULT_MODEL = 'claude-sonnet-4-6';

/** Format a helper-meta entry as one prompt line, e.g.
 *  `- cyl(length, r1, r2?)  — Z-up cylinder/cone (r2 defaults to r1).` */
function helperLine(h: { name: string; sig: string; desc: string; props: { name: string; optional: boolean }[] }): string {
  const argList = h.props.map((p) => `${p.name}${p.optional ? '?' : ''}`).join(', ');
  return `- \`${h.name}(${argList})\`  — ${h.desc}`;
}

/** Build the system prompt — pulled DYNAMICALLY from the helpers source
 *  so a rename (e.g. cyl's `h` → `length`) flows through automatically
 *  and the model can never be told a stale signature. Documents the
 *  current accumulator-form authoring grammar (defineGeom + `geom.add(...)`),
 *  the cross-instance ref + top-model conventions the loader expects,
 *  and the runtime-managed meta fields the AI must NOT touch. */
function buildSystemPrompt(currentId: string): string {
  const helpers = discoverHelpers();
  const operators = discoverOperators();
  const helperLines = helpers.map(helperLine).join('\n');
  const operatorLines = operators.map(helperLine).join('\n');

  const otherPrims = COMPONENT_REGISTRY.filter((e) => e.meta.id !== currentId).map((e) => {
    const params = Object.keys(e.meta.params).join(', ');
    return `  - ${e.meta.id} (${e.meta.name}): ${e.meta.id}Geom({ ${params} })`;
  }).join('\n');

  return `You edit single-file ManifoldCAD primitives for a downhole CAD app.

# File format
Each primitive exports \`meta\` (schema + display) and \`geom\` (the build).
\`geom\` uses the ACCUMULATOR FORM via \`defineGeom\` — additive, no return:

\`\`\`typescript
import { cyl, tube, mv, rot } from '../manifold-helpers';
import { defineGeom } from '.';
// optional: import { geom as <OtherId>Geom } from './<other-id>';

export const meta = {
  id: '<id>',
  name: '<display name>',
  description: '...',
  tags: ['...'],
  params: {
    paramName: { label: '...', min: N, max: N, step: N, unit: 'in', default: N },
    // optional: group: 'GroupName' (clusters params in the inspector)
  },
  derived: {  // optional — computed from sliders, merged into geom's p
    derivedName: { label: '...', unit: '...', from: (p) => <expr> },
  },
  validate: (p) => string[],  // optional
} as const;

// Accumulator form. \`geom\` is supplied empty by the framework; add parts
// onto it. No \`let geom = ...\`, no \`return\`. Each part declared as a
// \`let|const X = call(args);\` line, then folded in with \`geom.add(X)\`.
export const geom = defineGeom(meta, (p, geom) => {
  let A = cyl(p.length, p.od / 2, p.od / 2);
  geom.add(A);
  let B = tube(p.od / 2, (p.od / 2) - p.wall, p.length);
  B = mv(B, [0, 0, A.top + A.length]);  // stack B below A (see top-model)
  geom.add(B);
});
\`\`\`

# Available helpers (parts — produce Manifolds)
${helperLines}

# Available operators (transformations on Manifolds)
${operatorLines}

Manifold methods: \`.add(other)\` (union), \`.subtract(other)\`, \`.intersect(other)\`.
Imports allowed ONLY from \`'../manifold-helpers'\`, \`'.'\` (for defineGeom),
and \`'./<sibling-id>'\` (to compose another bundle primitive).

# Z-down convention (PROJECT RULE)
- top = LOWER z. bottom = HIGHER z. As z increases, you go DOWN the hole.
- \`mv(part, [0, 0, +N])\` moves the part toward the bottom.
- A box-conn upset flange at the top sits at z=0; the body translates to z ≥ coneLen.

# Cross-instance refs + the top model (loader rewrites these at execute time)
Each \`let|const X = call(...)\` declaration becomes a named instance. You can
reference an instance's args by prop name in a later instance's args:

  let A = TubeGeom({ od: 2, wall: 0.3, length: 5, top: 0 });
  let B = TubeGeom({ od: 2, wall: 0.3, length: 3, top: A.top + A.length });
  B = mv(B, [0, 0, B.top]);

The loader walks declarations in source order; \`A.top\` / \`A.length\` resolve
to A's call-arg values, and \`B.top + B.length\` cascades through. Stays as
text on disk so editing A's length live-updates B automatically.

Helpers (cyl, tube) have NO \`top\` param — they're pure shapes. To stack
a helper, inline the arithmetic: \`mv(B, [0, 0, PREV.top + PREV.length])\`.
Components that DO declare \`top\` in meta.params get the auto-stack pattern.

# Other component primitives available (compose with \`import { geom as <Id>Geom } from './<id>'\`)
${otherPrims || '  (none in the registry yet)'}

# Meta fields the LOADER manages — do NOT touch
The volume part's \`meta.json\` carries: \`family\`, \`level\`, \`autoTranslate\`,
\`instanceColors\`, \`instanceOps\`, \`instanceTopMode\`, \`instanceTopOffset\`.
These live OUTSIDE the \`.ts\` file (in a sibling \`meta.json\`). Never emit
them in the \`.ts\` export. Never reference them from geom logic — they're
applied by the loader (e.g. instanceTopMode rewrites the \`top:\` arg before
prop-ref expansion).

# Derived params
If a value is purely computed from sliders, declare it in \`meta.derived\` so
it shows read-only in the UI and is automatically present on \`p\` in geom().
Don't recompute the same value with literals — promote it to derived.

# Output contract (strict)
Respond with the COMPLETE updated file as a single fenced \`\`\`typescript code block.
- No prose before or after the block. No diff. No explanation.
- Preserve all existing imports unless the edit removes a referenced symbol.
- Keep \`meta.id\` unchanged.
- Use param names that already exist; introduce new ones only when needed.
- If you remove an instance, remove EVERY reference to it elsewhere in geom
  (most common bug: deleting \`let B = …\` but leaving \`B.length\` in a sibling).
- Add comments sparingly — only where geometry intent isn't obvious from names.
- Always close braces and semicolons cleanly. Parse-clean TypeScript only.
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
