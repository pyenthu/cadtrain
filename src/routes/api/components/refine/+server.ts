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
import { parseImports } from '$lib/server/component-loader';
import { transformSync } from 'esbuild';
import { readFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

const MAX_SOURCE_BYTES = 256 * 1024;
const MAX_PROMPT_BYTES = 4 * 1024;
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const ASSEMBLIES_DIR = join(process.cwd(), 'docs', 'assemblies');

/** Pull assembly recipes from docs/assemblies whose filename or first
 *  H1 mentions any whitespace-separated keyword in the user prompt.
 *  Returns up to N recipe bodies concatenated with their filenames so
 *  the AI can crib from existing recipes when the user asks for a
 *  named assembly. Empty when no recipes match — that's the common
 *  case for parameter tweaks on a single primitive. */
async function findMatchingRecipes(prompt: string, max = 2): Promise<string> {
  if (!existsSync(ASSEMBLIES_DIR)) return '';
  let files: string[];
  try {
    files = await readdir(ASSEMBLIES_DIR);
  } catch {
    return '';
  }
  // Lowercased keyword set from the prompt — drop the noise words
  // ("the", "and", …) so a long prompt doesn't accidentally match
  // every recipe.
  const NOISE = new Set([
    'the', 'and', 'with', 'add', 'make', 'into', 'this', 'that', 'for',
    'from', 'into', 'use', 'using', 'build', 'show', 'give', 'me',
    'is', 'are', 'an', 'a', 'i', 'we', 'be', 'to', 'of', 'in', 'on',
  ]);
  const keywords = new Set(
    prompt
      .toLowerCase()
      .split(/[^a-z0-9_]+/)
      .filter((w) => w.length >= 3 && !NOISE.has(w)),
  );
  if (keywords.size === 0) return '';
  const candidates: { file: string; score: number; body: string }[] = [];
  for (const f of files) {
    if (!f.endsWith('.md') || f.startsWith('_')) continue;
    const base = f.replace(/\.md$/, '');
    const baseTokens = base.split(/[^a-z0-9_]+/i).map((t) => t.toLowerCase());
    let score = 0;
    for (const t of baseTokens) if (keywords.has(t)) score += 3;
    if (score === 0) continue; // require filename hit at least
    let body = '';
    try { body = await readFile(join(ASSEMBLIES_DIR, f), 'utf8'); } catch { continue; }
    // Also count keyword hits in the first 200 chars (the title +
    // intro paragraph). Cheap proxy for relevance without parsing
    // the whole file.
    const intro = body.slice(0, 200).toLowerCase();
    for (const k of keywords) if (intro.includes(k)) score += 1;
    candidates.push({ file: f, score, body });
  }
  if (candidates.length === 0) return '';
  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, max)
    .map((c) => `### From docs/assemblies/${c.file}\n\n${c.body.trim()}`)
    .join('\n\n---\n\n');
}

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

// SPLIT INIT/COMPOSITION grammar (STRICT — the loader rejects violations).
// Body partitions into TWO regions, in order:
//
//   (1) INITIALIZATION — every \`let|const X = call(...)\` declaration
//       plus any chained \`X = mv(X, ...)\` / \`X = rot(X, ...)\` reassignments.
//   (2) COMPOSITION    — every \`geom.add(X)\` / \`geom.subtract(X)\` /
//       \`geom.intersect(X)\` call. The CSG op (union vs cut vs overlap)
//       lives HERE in the source — there is no \`meta.instanceOps\` field.
//
// The boundary is the FIRST \`geom.<op>(...)\` line. Any \`let|const X = …\`
// declaration AFTER that line is a grammar violation.
export const geom = defineGeom(meta, (p, geom) => {
  // INIT
  let A = cyl(p.length, p.od / 2, p.od / 2);
  let B = tube(p.od / 2, (p.od / 2) - p.wall, p.length);
  B = mv(B, [0, 0, A.top + A.length]);  // stack B below A (see top-model)

  // COMP — pick add / subtract / intersect per instance.
  geom.add(A);
  geom.subtract(B);
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
\`instanceColors\`, \`instanceTopMode\`, \`instanceTopOffset\`. These live
OUTSIDE the \`.ts\` file (in a sibling \`meta.json\`). Never emit them in the
\`.ts\` export. Never reference them from geom logic — they're applied by
the loader (e.g. instanceTopMode rewrites the \`top:\` arg before prop-ref
expansion).

NOTE: \`meta.instanceOps\` is GONE. The per-instance CSG op now lives in
the composition source itself — write \`geom.subtract(X)\` directly, do
not try to express subtraction via a meta field.

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
- If you remove an instance, remove EVERY reference to it (the \`let X =\`
  decl, every chain reassignment, AND the \`geom.<op>(X)\` call in the
  composition section). Most common bug: deleting \`let B = …\` but leaving
  \`B.length\` in a sibling — throws "B is not defined" at execute time.
- Maintain split init/composition layout. Every \`let|const X = …\` MUST
  appear ABOVE every \`geom.<op>(...)\` call. Mixing the two regions is a
  grammar violation the loader rejects on save with a clear line number.
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

/** Post-generation validation. Catches the four most common ways an AI
 *  edit goes wrong BEFORE the user accepts it, so the error message
 *  comes back here (where the retry path lives) instead of at execute
 *  time (where the user has to start over).
 *
 *  Layers (cheapest first):
 *    1. parseImports — allowlist check on imports + denylist scan for
 *       sandbox-escape tokens (`require(`, `process`, `eval(`, …).
 *    2. enforceSplitGrammar (re-implemented locally — keeping the loader
 *       check + the refine check in lockstep is easier than exporting a
 *       shared symbol because Stage A's enforce is private to the loader).
 *    3. esbuild transform — parse-check. Catches typos / unbalanced
 *       braces / TS that won't compile.
 *    4. Undefined-instance scan — walk every `<INST>.<prop>` reference
 *       and complain when the inst hasn't been declared with
 *       `let|const <INST> = …`. Catches the "deleted A but kept B.length
 *       = A.top" bug the prompt warns about.
 *
 *  Returns a Validation result. `ok: true` means we'll return the source;
 *  `ok: false` with `retryHint` means we should ask Claude to fix it.
 *  Heavy WASM bake validation is NOT run here — that's Level 3 (the
 *  Accept-button live-bake gate), invoked from the inspector. */
function validateRefinedSource(src: string): { ok: true } | { ok: false; retryHint: string } {
  // Layer 1: imports + denylist (via parseImports — throws on either).
  let stripped: string;
  try {
    const parsed = parseImports(src);
    stripped = parsed.stripped;
  } catch (e: any) {
    return { ok: false, retryHint: `Import / sandbox check failed: ${e?.message ?? e}` };
  }
  // Layer 2: split-grammar gate. Same shape as enforceSplitGrammar in
  // the loader — keeping them locally aligned avoids the cross-module
  // export dance.
  const opRe = /\bgeom\s*\.\s*(add|subtract|intersect)\s*\(/;
  const firstOp = opRe.exec(stripped);
  if (firstOp) {
    const declAfterRe = /\b(?:let|const)\s+[A-Z][A-Z0-9]*\s*=\s*[A-Za-z_][\w]*\s*\(/g;
    declAfterRe.lastIndex = firstOp.index;
    const stray = declAfterRe.exec(stripped);
    if (stray) {
      const lineNo = stripped.slice(0, stray.index).split('\n').length;
      return {
        ok: false,
        retryHint:
          `Grammar violation on line ${lineNo}: instance declaration "${stray[0]}" appears AFTER ` +
          `the first geom.${firstOp[1]}(...) call. Move every let|const X = …(…) line into the ` +
          `INITIALIZATION section (above ALL geom.add / geom.subtract / geom.intersect calls).`,
      };
    }
  }
  // Layer 3: esbuild parse-check.
  try {
    transformSync(stripped, { loader: 'ts', format: 'cjs', target: 'node22' });
  } catch (e: any) {
    return { ok: false, retryHint: `TypeScript parse failed: ${e?.message ?? e}` };
  }
  // Layer 4: undefined-instance scan.
  const declared = new Set<string>();
  const declRe = /\b(?:let|const)\s+([A-Z][A-Z0-9]*)\s*=/g;
  for (const m of stripped.matchAll(declRe)) declared.add(m[1]);
  const refRe = /\b([A-Z][A-Z0-9]*)\.([a-z][a-zA-Z0-9_]*)\b/g;
  const seen = new Set<string>();
  for (const m of stripped.matchAll(refRe)) {
    const inst = m[1];
    if (declared.has(inst) || seen.has(inst)) continue;
    seen.add(inst);
    return {
      ok: false,
      retryHint:
        `Undefined instance reference "${inst}.${m[2]}" — no \`let|const ${inst} = …\` ` +
        `declaration anywhere in the body. Either declare ${inst} in the initialization ` +
        `section, or drop the reference.`,
    };
  }
  return { ok: true };
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

  // Level 4 — assembly-aware prompting. When the user's prompt mentions
  // a recognised real-world assembly (matched by filename token + intro
  // keyword hits in docs/assemblies/*.md), inject the matching recipes
  // so the model starts from "here's how this was modelled before"
  // instead of from first principles. Empty when no recipe matches —
  // most refines are single-primitive param tweaks where the assembly
  // context is irrelevant.
  const assemblyContext = await findMatchingRecipes(prompt);

  // Build the base user message; the retry round appends an extra
  // turn carrying the validator's hint so Claude can fix the issue
  // without restarting the conversation from scratch.
  const userBase = [
    inst.trim() ? `Persistent design spec for this primitive (from ${id}.md):\n\n${inst}\n` : '',
    assemblyContext
      ? `Relevant assembly recipes from docs/assemblies/ (use these for vocabulary, ` +
        `stack order, and starter dimensions):\n\n${assemblyContext}\n`
      : '',
    `Current source of ${id}.ts:\n\n\`\`\`typescript\n${source}\n\`\`\``,
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

  // Level 2 — validate + retry once on failure. The retry adds an
  // assistant turn (the previous output) + a user turn with the hint,
  // so Claude sees its prior attempt + the specific error and can fix
  // narrowly. One retry only — repeated failures usually mean the goal
  // is ambiguous, not that another pass would help.
  let validation = validateRefinedSource(edited);
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
    validation = validateRefinedSource(edited);
    if (!validation.ok) {
      // Still bad. Return the source AS-IS so the user can inspect,
      // but mark `ok: false` + surface the hint so the inspector knows
      // not to auto-accept (Level 3 will gate that on a live bake too).
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
