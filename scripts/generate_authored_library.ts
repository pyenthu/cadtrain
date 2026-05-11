/**
 * generate_authored_library.ts
 *
 * Hands the 18-primitive catalog to Claude Opus and asks for a library of
 * realistic downhole-tool assemblies as AuthoredComponent JSON. Each
 * generated assembly is validated against the schema and appended to
 * training_data/authored_cache.jsonl.
 *
 * Once persisted, the records are visible in 3D at /archive/library —
 * clicking any record opens it in /archive/author for parametric editing.
 *
 * Usage:
 *   bun run scripts/generate_authored_library.ts                    # 10 assemblies
 *   bun run scripts/generate_authored_library.ts --count 20         # 20
 *   bun run scripts/generate_authored_library.ts --dry-run          # don't save
 *   bun run scripts/generate_authored_library.ts --model claude-sonnet-4-6  # override
 *
 * Default model: claude-opus-4-7 (per user request — Opus only for this
 * domain-knowledge-heavy generation; smaller models compose less coherently).
 *
 * Cost: ~$0.10–0.40 per call depending on count + retries (Opus pricing).
 */

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, existsSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { randomBytes } from 'node:crypto';
import { COMPONENTS } from '../src/lib/components/library';
import type { AuthoredComponent, AuthoredPart, AuthoredOp } from '../src/lib/authoring/schema';

const CACHE_PATH = join(process.cwd(), 'training_data', 'authored_cache.jsonl');
const DEFAULT_MODEL = 'claude-opus-4-7';
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

function buildSystemPrompt(): string {
  return `You are an expert downhole completion engineer composing real production tool assemblies.

You have ${COMPONENTS.length} parametric primitives available. Your job is to combine them — with realistic dimensions and proper Z-axis stacking — into recognizable real-world tools used in oil & gas wells.

Hard rules:
1. Use ONLY the primitive ids listed in the catalog. No invented primitives.
2. Use ONLY parameters defined for each primitive. No invented params. Stay within the [min, max] ranges.
3. Use Z-DOWN convention (drilling standard). Position parts via transform.tz so they stack along Z. Top of the assembly = smallest tz, bottom = largest tz. Center the assembly vertically around tz=0.
4. Choose dimensions that are physically realistic for a real downhole tool — match casing/tubing sizes (typical: 2 7/8", 3 1/2", 4 1/2", 5 1/2", 7"). Don't put a 6" OD packer element on a 1" mandrel.
5. Components further down a string should generally be smaller OD or matched to their casing/tubing size. Connections (threads) should stack at the ends, body parts in the middle.
6. Default to UNION composition (which is implicit if you provide no ops). Use SUBTRACT only when one part should clearly cut into another (e.g., port holes through a sub).
7. Each assembly should be a recognizable named real tool — e.g. "5-1/2\\" Permanent Production Packer", "Wireline Setting Tool", "X-Style Landing Nipple", "EUE Pup Joint", "Bottom Sub with NC-50 Connections", "Otis 'XN' Lock Mandrel", "Snap-Latch Anchor", "Polished Bore Receptacle Extension", etc.

Output format:
Return ONLY a JSON array (no prose, no code fences, no markdown). Each element is an AuthoredComponent matching this TypeScript shape:

  {
    "id": "string (slug — lowercase, snake_case)",
    "name": "string (human readable)",
    "description": "string (1-2 sentences — what this tool does in the well)",
    "tags": ["string", ...],     // e.g. ["packer", "production", "permanent"]
    "version": 1,
    "created": "ISO timestamp",
    "source": "claude_suggested",
    "parts": [
      {
        "id": "p0", "p1", "p2", ...
        "prim": "primitive_id_from_catalog",
        "params": { "param_name": number, ... },  // all required params, valid ranges
        "transform": { "tx": 0, "ty": 0, "tz": <z position> }  // tz only usually needed
      },
      ...
    ],
    "ops": []  // typically empty (implicit union); only fill if you need explicit subtract/intersect
  }

Quality bar: I want assemblies that a completion engineer would look at and immediately say "yes that's a packer" or "yes that's a landing nipple". Realism > novelty.`;
}

function buildUserPrompt(count: number, primitiveCatalog: string): string {
  return `Here are the ${COMPONENTS.length} parametric primitives:

${primitiveCatalog}

Now generate exactly ${count} distinct realistic downhole tool assemblies as a JSON array. Cover a mix of:
  - Production packers (permanent and retrievable)
  - Bridge plugs / cement retainers
  - Landing nipples (selective profile types)
  - Lock mandrels and X-style locks
  - Pup joints and sub assemblies (EUE, NC, IF threads)
  - Polished bore receptacles / seal bore extensions
  - Setting tools / wireline running tools
  - Bottom subs / mule shoe / re-entry guides
  - Anchor catchers / hold-down assemblies
  - Otis flow couplings or sliding sleeves where the primitives allow

Match each tool to a typical casing/tubing size and choose realistic dimensions for that size. Return ONLY the JSON array — no commentary.`;
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

  if (!process.env.ANTHROPIC_API_KEY) {
    // .env is loaded by SvelteKit at runtime; for a script we read it manually.
    if (existsSync('.env')) {
      const env = readFileSync('.env', 'utf-8');
      const m = env.match(/^ANTHROPIC_API_KEY=(.+)$/m);
      if (m) process.env.ANTHROPIC_API_KEY = m[1].trim().replace(/^['"]|['"]$/g, '');
    }
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('error: ANTHROPIC_API_KEY not set (.env or environment)');
    process.exit(1);
  }

  console.log(`▶  Generating ${count} assemblies via ${model}${dryRun ? ' (dry-run)' : ''}\n`);

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const catalog = buildPrimitiveCatalog();
  const system = buildSystemPrompt();
  const user = buildUserPrompt(count, catalog);

  const t0 = Date.now();
  const response = await client.messages.create({
    model,
    max_tokens: 16000,
    system,
    messages: [{ role: 'user', content: user }],
  });
  const ms = Date.now() - t0;

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');

  console.log(
    `▶  Response: ${response.usage.input_tokens} in + ${response.usage.output_tokens} out tokens, ${(ms / 1000).toFixed(1)}s\n`,
  );

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
