/**
 * generate_authored_library.ts
 *
 * Hands the 18-primitive catalog to the local `claude` CLI subprocess
 * (Pro/Max OAuth-billed, NOT API tokens) and asks for a library of
 * realistic downhole-tool assemblies as AuthoredComponent JSON. Each
 * generated assembly is validated against the schema and appended to
 * training_data/authored_cache.jsonl.
 *
 * Once persisted, the records are visible in 3D at /archive/library —
 * clicking any record opens it in /archive/author for parametric editing.
 *
 * Why CLI not API: subscription billing only works through the CLI
 * subprocess — the SDK / Agent SDK do NOT bill against Pro/Max OAuth.
 * (See src/lib/shared/claude-cli.ts for the shared wrapper used by both
 * /api/identify and /api/wells/extract.)
 *
 * Usage:
 *   bun run scripts/generate_authored_library.ts                    # 10 assemblies
 *   bun run scripts/generate_authored_library.ts --count 20         # 20
 *   bun run scripts/generate_authored_library.ts --dry-run          # don't save
 *   bun run scripts/generate_authored_library.ts --model sonnet     # override (CLI alias)
 *
 * Default model: opus (CLI alias — bills against Pro/Max subscription).
 * Pre-req: `claude` on PATH and `claude auth status` shows
 *   { authMethod: 'claude.ai', loggedIn: true }.
 */

import { readFileSync, existsSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { randomBytes } from 'node:crypto';
import { COMPONENTS } from '../src/lib/components/library';
import type { AuthoredComponent, AuthoredPart, AuthoredOp } from '../src/lib/authoring/schema';
import { buildClaudeCliArgs, spawnClaudeCli, parseCliEnvelope } from '../src/lib/shared/claude-cli';

const CACHE_PATH = join(process.cwd(), 'training_data', 'authored_cache.jsonl');
const DEFAULT_MODEL = 'opus';
const DEFAULT_COUNT = 10;

// ---------- prompt construction ----------

function buildPrimitiveCatalog(): string {
  return COMPONENTS.map((c) => {
    const paramLines = Object.entries(c.params)
      .map(([k, p]) => {
        const def = c.defaults[k];
        return `      ${k}: ${p.label} [${p.min}–${p.max} ${p.unit ?? ''}] default ${def}`;
      })
      .join('\n');
    return [
      `  - id: "${c.id}"`,
      `    name: ${c.name}`,
      `    category: ${c.category}`,
      `    description: ${c.description}`,
      `    tags: [${c.tags.join(', ')}]`,
      `    params:`,
      paramLines,
    ].join('\n');
  }).join('\n\n');
}

// Prompt templates live as Markdown next to this script so you can iterate
// on the wording without editing TypeScript. Placeholders:
//   {{PRIMITIVE_COUNT}}     → number of primitives in the catalog
//   {{PRIMITIVE_CATALOG}}   → buildPrimitiveCatalog() output
//   {{COUNT}}               → --count value
//
// Edit scripts/prompts/generate_authored.{system,user}.md → re-run.
const SYSTEM_PROMPT_PATH = join(process.cwd(), 'scripts', 'prompts', 'generate_authored.system.md');
const USER_PROMPT_PATH = join(process.cwd(), 'scripts', 'prompts', 'generate_authored.user.md');

function loadTemplate(path: string, vars: Record<string, string>): string {
  let text = readFileSync(path, 'utf-8');
  for (const [k, v] of Object.entries(vars)) {
    text = text.replaceAll(`{{${k}}}`, v);
  }
  return text;
}

function buildSystemPrompt(): string {
  return loadTemplate(SYSTEM_PROMPT_PATH, {
    PRIMITIVE_COUNT: String(COMPONENTS.length),
  });
}

function buildUserPrompt(count: number, primitiveCatalog: string): string {
  return loadTemplate(USER_PROMPT_PATH, {
    PRIMITIVE_COUNT: String(COMPONENTS.length),
    PRIMITIVE_CATALOG: primitiveCatalog,
    COUNT: String(count),
  });
}

// ---------- validation ----------

const PRIMITIVE_IDS = new Set(COMPONENTS.map((c) => c.id));
const PARAM_BOUNDS = new Map<string, Record<string, { min: number; max: number }>>(
  COMPONENTS.map((c) => [
    c.id,
    Object.fromEntries(
      Object.entries(c.params).map(([k, p]) => [k, { min: p.min, max: p.max }]),
    ),
  ]),
);
const REQUIRED_PARAMS = new Map<string, string[]>(
  COMPONENTS.map((c) => [c.id, Object.keys(c.params)]),
);

interface ValidationProblem {
  idx: number;
  name: string;
  problems: string[];
}

interface ValidationResult {
  problem: ValidationProblem | null;
  clamps: string[];   // notes about values that were silently clamped to bounds
}

// Tolerance for silent clamping. Values outside [min, max] but within
// [min*0.5, max*1.5] get clamped to the nearest bound — common when an
// engineer wrote a round number (e.g. cone.odTop=4.6 vs max=4). Beyond that
// it's likely a misunderstanding of the primitive — reject so we know.
const CLAMP_LOW_FACTOR = 0.5;
const CLAMP_HIGH_FACTOR = 1.5;

function validateAssembly(record: any, idx: number): ValidationResult {
  const problems: string[] = [];
  const clamps: string[] = [];

  if (typeof record?.name !== 'string' || !record.name.trim()) problems.push('missing/empty name');
  if (!Array.isArray(record?.parts) || record.parts.length === 0) problems.push('missing/empty parts');
  if (!Array.isArray(record?.tags)) problems.push('missing tags');

  if (Array.isArray(record?.parts)) {
    for (let i = 0; i < record.parts.length; i++) {
      const part = record.parts[i];
      if (!part?.prim || !PRIMITIVE_IDS.has(part.prim)) {
        problems.push(`parts[${i}].prim '${part?.prim}' not in catalog`);
        continue;
      }
      const required = REQUIRED_PARAMS.get(part.prim) ?? [];
      const bounds = PARAM_BOUNDS.get(part.prim) ?? {};
      for (const req of required) {
        const v = part.params?.[req];
        if (typeof v !== 'number') {
          problems.push(`parts[${i}](${part.prim}) missing param '${req}'`);
          continue;
        }
        const { min, max } = bounds[req];
        if (v < min) {
          if (v >= min * CLAMP_LOW_FACTOR) {
            part.params[req] = min;
            clamps.push(`parts[${i}](${part.prim}).${req} ${v} → ${min}`);
          } else {
            problems.push(`parts[${i}](${part.prim}).${req}=${v} far below min ${min}`);
          }
        } else if (v > max) {
          if (v <= max * CLAMP_HIGH_FACTOR) {
            part.params[req] = max;
            clamps.push(`parts[${i}](${part.prim}).${req} ${v} → ${max}`);
          } else {
            problems.push(`parts[${i}](${part.prim}).${req}=${v} far above max ${max}`);
          }
        }
      }
      // Drop unknown params silently rather than rejecting — preserves the
      // assembly when the model invents an extra knob (e.g. material).
      for (const provided of Object.keys(part.params ?? {})) {
        if (!required.includes(provided)) {
          delete part.params[provided];
          clamps.push(`parts[${i}](${part.prim}) dropped unknown param '${provided}'`);
        }
      }
    }
  }

  return {
    problem: problems.length === 0 ? null : { idx, name: record?.name ?? '<no-name>', problems },
    clamps,
  };
}

// ---------- normalization ----------

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function normalize(record: any): AuthoredComponent {
  const id = record.id?.trim() ? slugify(record.id) : `${slugify(record.name)}_${randomBytes(3).toString('hex')}`;
  const parts: AuthoredPart[] = (record.parts as any[]).map((p, i) => ({
    id: p.id ?? `p${i}`,
    prim: p.prim,
    params: p.params,
    transform: p.transform ?? undefined,
  }));
  const ops: AuthoredOp[] = Array.isArray(record.ops) ? record.ops : [];
  return {
    id,
    name: record.name,
    description: record.description ?? '',
    tags: Array.isArray(record.tags) ? record.tags : [],
    version: 1,
    created: new Date().toISOString(),
    source: 'claude_suggested',
    parts,
    ops,
  };
}

// ---------- cache append (no server needed) ----------

function loadExisting(): AuthoredComponent[] {
  if (!existsSync(CACHE_PATH)) return [];
  return readFileSync(CACHE_PATH, 'utf-8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

function persist(records: AuthoredComponent[]): void {
  const text = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
  const tmp = `${CACHE_PATH}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, CACHE_PATH);
}

// ---------- response parsing ----------

function stripCodeFences(s: string): string {
  const fence = s.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  return fence ? fence[1] : s;
}

function extractJsonArray(text: string): any[] {
  const stripped = stripCodeFences(text).trim();
  // Find the first '[' and matching ']' (greedy)
  const start = stripped.indexOf('[');
  const end = stripped.lastIndexOf(']');
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`No JSON array found in response. First 200 chars: ${stripped.slice(0, 200)}`);
  }
  const json = stripped.slice(start, end + 1);
  const parsed = JSON.parse(json);
  if (!Array.isArray(parsed)) {
    throw new Error(`Expected array, got ${typeof parsed}`);
  }
  return parsed;
}

// ---------- main ----------

async function main() {
  const { values } = parseArgs({
    options: {
      count: { type: 'string' },
      'dry-run': { type: 'boolean' },
      model: { type: 'string' },
    },
  });

  const count = values.count ? parseInt(values.count, 10) : DEFAULT_COUNT;
  const model = values.model ?? DEFAULT_MODEL;
  const dryRun = !!values['dry-run'];

  console.log(
    `▶  Generating ${count} assemblies via claude CLI (model=${model}) — bills against Pro/Max OAuth, not API tokens${dryRun ? ' (dry-run)' : ''}\n`,
  );

  const catalog = buildPrimitiveCatalog();
  const system = buildSystemPrompt();
  const user = buildUserPrompt(count, catalog);

  const args = buildClaudeCliArgs({
    model,
    addDir: process.cwd(),
    systemPrompt: system,
    userPrompt: user,
  });

  const t0 = Date.now();
  // CLI startup + agent loop overhead → 5-7× slower than API per call. For 10
  // assemblies allow up to 10 minutes; the prompt itself is single-shot so a
  // very long timeout just covers the long-tail.
  const result = await spawnClaudeCli(args, 10 * 60_000);
  const ms = Date.now() - t0;

  if (result.exitCode !== 0) {
    console.error(
      `✗  claude CLI exited ${result.exitCode} after ${(ms / 1000).toFixed(1)}s\n` +
      `   stderr: ${result.stderr.slice(0, 500)}`,
    );
    process.exit(1);
  }

  let text: string;
  try {
    text = parseCliEnvelope(result.stdout, { stripCodeFences: true });
  } catch (e) {
    console.error('✗  Failed to parse CLI envelope:', (e as Error).message);
    console.error('\nstdout (first 500):\n', result.stdout.slice(0, 500));
    process.exit(1);
  }

  console.log(`▶  CLI returned in ${(ms / 1000).toFixed(1)}s, ${text.length} chars\n`);

  let parsed: any[];
  try {
    parsed = extractJsonArray(text);
  } catch (e) {
    console.error('✗  Failed to parse response as JSON array:', (e as Error).message);
    console.error('\nFull response:\n', text);
    process.exit(1);
  }

  console.log(`▶  Parsed ${parsed.length} assemblies. Validating...\n`);

  const problems: ValidationProblem[] = [];
  const validated: AuthoredComponent[] = [];
  let totalClamps = 0;
  for (let i = 0; i < parsed.length; i++) {
    const result = validateAssembly(parsed[i], i);
    totalClamps += result.clamps.length;
    if (result.problem) {
      problems.push(result.problem);
    } else {
      const normalized = normalize(parsed[i]);
      validated.push(normalized);
      const clampNote = result.clamps.length > 0 ? ` [${result.clamps.length} clamped]` : '';
      console.log(`  ✓  ${normalized.name}  (${normalized.parts.length} parts, ${normalized.ops.length} ops)${clampNote}`);
      for (const c of result.clamps) console.log(`       · ${c}`);
    }
  }
  for (const prob of problems) {
    console.log(`  ✗  [${prob.idx}] ${prob.name}`);
    for (const msg of prob.problems) console.log(`       - ${msg}`);
  }
  if (totalClamps > 0) console.log(`\n▶  ${totalClamps} param(s) silently clamped to bounds.`);

  console.log(
    `\n▶  Valid: ${validated.length} / ${parsed.length}  (${problems.length} rejected)`,
  );

  if (dryRun) {
    console.log('▶  Dry-run — no persistence.');
    return;
  }

  if (validated.length === 0) {
    console.error('✗  Nothing valid to persist; bailing.');
    process.exit(1);
  }

  const existing = loadExisting();
  const existingIds = new Set(existing.map((r) => r.id));
  const finalList = [...existing];

  let appended = 0;
  let replaced = 0;
  for (const r of validated) {
    if (existingIds.has(r.id)) {
      const idx = finalList.findIndex((e) => e.id === r.id);
      finalList[idx] = r;
      replaced++;
    } else {
      finalList.push(r);
      appended++;
    }
  }

  persist(finalList);
  console.log(
    `\n✓  Persisted to ${CACHE_PATH}: ${appended} new, ${replaced} replaced (${finalList.length} total).`,
  );
  console.log(`   View at: /archive/library`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
