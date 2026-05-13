#!/usr/bin/env bun
/**
 * Overnight primitive extraction — runs Claude Opus CLI against the
 * kb-sources/*.pdf catalogs to:
 *
 *   1. Enumerate ~100 candidate primitives across the catalogs
 *   2. For each candidate, run a 5-iter generate + critique loop
 *   3. Save artifacts to static/tests/extracted/<id>/ + update manifest
 *
 * The Test tab in /primitives auto-loads the manifest on mount so the
 * user wakes up to a clickable list of candidates with their final .ts
 * and the iteration history.
 *
 * Subscription-billed via claude.ai OAuth (NOT API key). Each call is
 * a `claude --print --output-format json --model opus` subprocess.
 *
 * Designed to be resilient: failure of any single Claude call records
 * the failure in the item's notes.json and moves to the next item.
 * Manifest is updated after each item completes — partial progress is
 * visible if the script is interrupted.
 *
 * Run with:
 *   bun run scripts/overnight_extract.ts            # default 100 target
 *   bun run scripts/overnight_extract.ts --max 10   # smoke-test budget
 *   bun run scripts/overnight_extract.ts --no-refine # skip iter 1-4
 */

import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, readdir, stat, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const OUT_DIR = resolve(REPO, 'static/tests/extracted');
const KB_SOURCES = resolve(REPO, 'kb-sources');
const COMPONENTS_DIR = resolve(REPO, 'src/lib/cad/components');
const LOG_FILE = resolve(OUT_DIR, '_run.log');
const MANIFEST = resolve(OUT_DIR, 'manifest.json');

const MODEL = 'opus';
const DEFAULT_TARGET = 100;
const DEFAULT_ITEMS_PER_PDF = 25;
const MAX_ITERS = 5;
const CALL_TIMEOUT_MS = 5 * 60_000;

// ─── Args ─────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (k: string) => argv.includes(k);
function arg(k: string, def?: string): string | undefined {
  const i = argv.indexOf(k);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def;
}
const TARGET = Number(arg('--max', String(DEFAULT_TARGET)));
const ITEMS_PER_PDF = Number(arg('--per-pdf', String(DEFAULT_ITEMS_PER_PDF)));
const NO_REFINE = flag('--no-refine');
const RESUME = flag('--resume');

// ─── Logging ──────────────────────────────────────────────────────────
async function log(msg: string) {
  const stamped = `[${new Date().toISOString()}] ${msg}`;
  console.log(stamped);
  try { await writeFile(LOG_FILE, stamped + '\n', { flag: 'a' }); } catch {}
}

// ─── Claude CLI wrapper ───────────────────────────────────────────────
interface CliResult { stdout: string; stderr: string; exitCode: number; durationMs: number; }

async function callClaude(opts: {
  systemPrompt: string;
  userPrompt: string;
  addDir: string;
}): Promise<CliResult> {
  const args = [
    '--print',
    '--output-format', 'json',
    '--model', MODEL,
    '--add-dir', opts.addDir,
    '--no-session-persistence',
    '--permission-mode', 'bypassPermissions',
    '--append-system-prompt', opts.systemPrompt,
    opts.userPrompt,
  ];
  const t0 = Date.now();
  const proc = spawn('claude', args, {
    timeout: CALL_TIMEOUT_MS,
    env: { ...process.env, NO_COLOR: '1' },
  });
  let stdout = '';
  let stderr = '';
  proc.stdout.on('data', (d) => (stdout += String(d)));
  proc.stderr.on('data', (d) => (stderr += String(d)));
  const exitCode = await new Promise<number>((res, rej) => {
    proc.on('exit', (c) => res(c ?? -1));
    proc.on('error', rej);
  });
  return { stdout, stderr, exitCode, durationMs: Date.now() - t0 };
}

function parseEnvelope(stdout: string): string {
  const env = JSON.parse(stdout);
  const raw = String(env.result ?? '').trim();
  if (!raw) throw new Error(`empty result from CLI envelope: ${stdout.slice(0, 200)}`);
  return raw;
}

function stripJsonFence(s: string): string {
  // Match the FIRST ```(json)? block — content between the opening fence
  // and the matching closing fence. Resilient to extra prose around.
  const m = /```(?:json)?\s*\n([\s\S]*?)\n```/.exec(s);
  return m ? m[1].trim() : s.trim();
}

function stripTsFence(s: string): string {
  const m = /```(?:typescript|ts)?\s*\n([\s\S]*?)\n```/.exec(s);
  return m ? m[1].trim() : s.trim();
}

// ─── Catalog context — the 26 existing primitives as compact ref ──────
async function loadCatalogContext(): Promise<string> {
  const files = (await readdir(COMPONENTS_DIR)).filter(
    (f) => f.endsWith('.ts') && f !== 'index.ts' && f !== 'families.ts',
  );
  const blocks: string[] = [];
  for (const f of files.sort()) {
    const src = await readFile(join(COMPONENTS_DIR, f), 'utf8');
    blocks.push(`=== ${f} ===\n${src}`);
  }
  return blocks.join('\n\n');
}

// ─── Phase 1 — enumerate candidates per PDF ───────────────────────────
interface Candidate {
  id: string;
  name: string;
  family?: string;
  source_pdf: string;
  source_page?: number | string;
  brief_description: string;
}

const ENUMERATE_SYSTEM = `You enumerate parametric-primitive candidates from a petroleum-engineering catalog PDF.

Output: a single fenced \`\`\`json code block, no prose before or after, containing an array of objects with this exact shape:

[
  {
    "id": "snake_case_id",
    "name": "Human Display Name",
    "family": "casing_tubing | drillstring | wellhead_xt | packers_plugs | fishing_intervention | artificial_lift | flow_control | basic",
    "source_page": 12,
    "brief_description": "One sentence covering geometry + role."
  }
]

Pick distinct, geometrically distinguishable items. Skip pure tables of dimensions for the same primitive — list it ONCE with a note that it's parametrized. Skip text-only sections. Aim for the COUNT requested by the user.`;

async function enumeratePdf(pdfPath: string, count: number): Promise<Candidate[]> {
  await log(`enumerate: ${basename(pdfPath)} (target ${count})`);
  const userPrompt = `Read the PDF at this path: ${pdfPath}

List up to ${count} distinct geometric primitives that could be modeled as parametric CAD parts. Return a JSON array as specified.`;
  const r = await callClaude({
    systemPrompt: ENUMERATE_SYSTEM,
    userPrompt,
    addDir: dirname(pdfPath),
  });
  if (r.exitCode !== 0) {
    await log(`  FAILED exitCode=${r.exitCode} stderr=${r.stderr.slice(0, 300)}`);
    return [];
  }
  let text: string;
  try { text = parseEnvelope(r.stdout); }
  catch (e) { await log(`  envelope parse failed: ${e}`); return []; }
  const jsonStr = stripJsonFence(text);
  let arr: any;
  try { arr = JSON.parse(jsonStr); }
  catch (e) { await log(`  json parse failed: ${e}. raw: ${jsonStr.slice(0, 200)}`); return []; }
  if (!Array.isArray(arr)) { await log(`  enumerate didn't return array`); return []; }
  const out: Candidate[] = [];
  for (const it of arr) {
    if (!it?.id || !it?.name || !it?.brief_description) continue;
    out.push({
      id: String(it.id),
      name: String(it.name),
      family: it.family ? String(it.family) : undefined,
      source_pdf: basename(pdfPath),
      source_page: it.source_page,
      brief_description: String(it.brief_description),
    });
  }
  await log(`  got ${out.length} candidates from ${basename(pdfPath)} (${r.durationMs}ms)`);
  return out;
}

// ─── Phase 2 — iterate per candidate ──────────────────────────────────
const GENERATE_SYSTEM = `You write single-file ManifoldCAD primitives for cadtrain.

# File format
Each primitive lives at src/lib/cad/components/<id>.ts and exports:

\`\`\`ts
import { tube, cyl, mv, rot, M } from '../manifold-helpers';
import { defineGeom } from '.';

export const meta = {
  id: '<id>',
  name: '<Display Name>',
  description: '<one line>',
  tags: ['...'],
  params: {
    paramName: { label: '...', min: N, max: N, step: N, unit: 'in', default: N },
  },
} as const;

export const geom = defineGeom(meta, (p) => {
  // returns a Manifold
});
\`\`\`

# Rules
- **Z-down**: top = LOWER z, bottom = HIGHER z. mv(part, [0,0,+N]) moves DOWN.
- Helpers: tube(outerR, innerR, length), cyl(h, r1, r2?), mv(part, [x,y,z]), rot(part, [x,y,z]), M.cube([x,y,z], center?).
- Manifold ops: .add() / .subtract() / .intersect().
- Imports only from '../manifold-helpers' or another './<id>'.
- Keep param defaults realistic for the implied API spec.

# Output contract
Respond with the COMPLETE .ts file as a single fenced \`\`\`typescript code block. No prose. No diff.`;

const CRITIQUE_SYSTEM = `You critique a ManifoldCAD primitive .ts against the source PDF figure it was meant to model.

Look at the PDF figure (the user will tell you which page and item). Look at the .ts they wrote. Decide:
- If the GEOMETRY in the .ts faithfully captures the figure (correct OD/wall/length-like proportions, correct features, correct Z-down orientation): respond with EXACTLY the single word \`MATCH\` and nothing else.
- Otherwise: respond with the CORRECTED complete \`<id>.ts\` as a single fenced \`\`\`typescript code block. No prose.`;

async function generateInitial(cand: Candidate, pdfPath: string, catalog: string): Promise<string> {
  const userPrompt = `Read the source PDF at: ${pdfPath}
Look at the item on page ${cand.source_page ?? '(see description)'}: "${cand.name}".
Description: ${cand.brief_description}

Catalog of 26 existing primitives (for reference shapes and helpers usage):

${catalog}

Write the complete <id>.ts file for id="${cand.id}".`;
  const r = await callClaude({
    systemPrompt: GENERATE_SYSTEM,
    userPrompt,
    addDir: dirname(pdfPath),
  });
  if (r.exitCode !== 0) throw new Error(`generate exit ${r.exitCode}: ${r.stderr.slice(0, 200)}`);
  const text = parseEnvelope(r.stdout);
  return stripTsFence(text);
}

async function critiqueAndRefine(
  cand: Candidate, pdfPath: string, currentTs: string, iter: number,
): Promise<{ verdict: 'MATCH' | 'REFINE'; nextTs?: string; raw: string }> {
  const userPrompt = `Read the source PDF at: ${pdfPath}
Re-examine the figure on page ${cand.source_page ?? '(see description)'}: "${cand.name}".

Here is the current ${cand.id}.ts (iteration ${iter}):

\`\`\`typescript
${currentTs}
\`\`\`

Does the geometry described in this .ts faithfully match the figure? Respond MATCH if yes, else respond with the corrected complete .ts.`;
  const r = await callClaude({
    systemPrompt: CRITIQUE_SYSTEM,
    userPrompt,
    addDir: dirname(pdfPath),
  });
  if (r.exitCode !== 0) throw new Error(`critique exit ${r.exitCode}: ${r.stderr.slice(0, 200)}`);
  const text = parseEnvelope(r.stdout);
  if (text.trim() === 'MATCH') return { verdict: 'MATCH', raw: text };
  return { verdict: 'REFINE', nextTs: stripTsFence(text), raw: text };
}

// ─── Manifest ─────────────────────────────────────────────────────────
interface ManifestEntry {
  id: string;
  name: string;
  family?: string;
  source_pdf: string;
  source_page?: number | string;
  brief_description: string;
  iters_done: number;
  final_verdict: 'MATCH' | 'INCOMPLETE' | 'ERROR';
  error?: string;
  url: string; // points to the per-item dir
}

async function saveManifest(items: ManifestEntry[]) {
  const tmp = MANIFEST + '.tmp';
  await writeFile(tmp, JSON.stringify({ generated_at: new Date().toISOString(), items }, null, 2));
  await rename(tmp, MANIFEST);
}

async function processCandidate(cand: Candidate, catalog: string): Promise<ManifestEntry> {
  const pdfPath = resolve(KB_SOURCES, cand.source_pdf);
  const itemDir = join(OUT_DIR, cand.id);
  await mkdir(itemDir, { recursive: true });
  const notes: any = { cand, iterations: [] };
  let final_verdict: ManifestEntry['final_verdict'] = 'INCOMPLETE';
  let iters = 0;
  try {
    let ts = await generateInitial(cand, pdfPath, catalog);
    await writeFile(join(itemDir, 'iter-0.ts'), ts);
    notes.iterations.push({ iter: 0, action: 'generate', length: ts.length });
    iters = 1;
    if (!NO_REFINE) {
      for (let i = 1; i <= MAX_ITERS - 1; i++) {
        const r = await critiqueAndRefine(cand, pdfPath, ts, i);
        notes.iterations.push({ iter: i, verdict: r.verdict, raw_head: r.raw.slice(0, 200) });
        if (r.verdict === 'MATCH') { final_verdict = 'MATCH'; break; }
        if (r.nextTs && r.nextTs !== ts) {
          ts = r.nextTs;
          await writeFile(join(itemDir, `iter-${i}.ts`), ts);
          iters = i + 1;
        }
      }
      if (final_verdict === 'INCOMPLETE' && iters >= MAX_ITERS) {
        notes.note = 'reached MAX_ITERS without MATCH';
      }
    } else {
      final_verdict = 'MATCH'; // skip refine — treat single-shot as done
    }
    await writeFile(join(itemDir, 'final.ts'), ts);
    await writeFile(join(itemDir, 'notes.json'), JSON.stringify(notes, null, 2));
  } catch (e: any) {
    final_verdict = 'ERROR';
    notes.error = e?.message ?? String(e);
    await writeFile(join(itemDir, 'notes.json'), JSON.stringify(notes, null, 2));
    return {
      id: cand.id, name: cand.name, family: cand.family,
      source_pdf: cand.source_pdf, source_page: cand.source_page,
      brief_description: cand.brief_description,
      iters_done: iters, final_verdict, error: notes.error,
      url: `/tests/extracted/${cand.id}/`,
    };
  }
  return {
    id: cand.id, name: cand.name, family: cand.family,
    source_pdf: cand.source_pdf, source_page: cand.source_page,
    brief_description: cand.brief_description,
    iters_done: iters, final_verdict,
    url: `/tests/extracted/${cand.id}/`,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────
async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await log(`overnight_extract started. target=${TARGET}, per_pdf=${ITEMS_PER_PDF}, no_refine=${NO_REFINE}, resume=${RESUME}`);

  // Resume support — load existing manifest if present.
  let prior: ManifestEntry[] = [];
  if (RESUME && existsSync(MANIFEST)) {
    try {
      const cur = JSON.parse(await readFile(MANIFEST, 'utf8'));
      if (Array.isArray(cur.items)) prior = cur.items;
      await log(`resume: ${prior.length} existing entries loaded`);
    } catch {}
  }

  // Phase 1 — enumerate
  const pdfs = (await readdir(KB_SOURCES))
    .filter((f) => f.toLowerCase().endsWith('.pdf'))
    .map((f) => join(KB_SOURCES, f));
  await log(`found ${pdfs.length} PDFs in kb-sources/`);

  let candidates: Candidate[] = [];
  for (const pdf of pdfs) {
    const remaining = TARGET - candidates.length;
    if (remaining <= 0) break;
    const want = Math.min(ITEMS_PER_PDF, remaining);
    const found = await enumeratePdf(pdf, want);
    candidates = candidates.concat(found);
  }
  await log(`total candidates: ${candidates.length}`);

  // De-dup by id
  const seen = new Set<string>();
  candidates = candidates.filter((c) => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
  await log(`after dedup: ${candidates.length}`);

  // Skip already-processed when resuming
  const priorIds = new Set(prior.map((p) => p.id));
  const todo = candidates.filter((c) => !priorIds.has(c.id));
  await log(`after resume-skip: ${todo.length} candidates to process`);

  // Catalog context for the generate step (shared across all items)
  const catalog = await loadCatalogContext();
  await log(`catalog context: ${catalog.length} chars (${Object.keys(catalog).length} bytes)`);

  // Persist enumeration so the user can already see progress
  const initialManifest: ManifestEntry[] = [
    ...prior,
    ...todo.map((c) => ({
      id: c.id, name: c.name, family: c.family,
      source_pdf: c.source_pdf, source_page: c.source_page,
      brief_description: c.brief_description,
      iters_done: 0, final_verdict: 'INCOMPLETE' as const,
      url: `/tests/extracted/${c.id}/`,
    })),
  ];
  await saveManifest(initialManifest);

  // Phase 2 — process each
  const completed: ManifestEntry[] = [...prior];
  let idx = 0;
  for (const cand of todo) {
    idx++;
    await log(`[${idx}/${todo.length}] ${cand.id} (${cand.name})`);
    const t0 = Date.now();
    try {
      const entry = await processCandidate(cand, catalog);
      completed.push(entry);
      await saveManifest(completed);
      await log(`  done: verdict=${entry.final_verdict}, iters=${entry.iters_done}, ${Date.now() - t0}ms`);
    } catch (e: any) {
      await log(`  FAILED: ${e?.message ?? e}`);
      completed.push({
        id: cand.id, name: cand.name, family: cand.family,
        source_pdf: cand.source_pdf, source_page: cand.source_page,
        brief_description: cand.brief_description,
        iters_done: 0, final_verdict: 'ERROR',
        error: e?.message ?? String(e),
        url: `/tests/extracted/${cand.id}/`,
      });
      await saveManifest(completed);
    }
  }

  await log(`overnight_extract complete. ${completed.length} entries in manifest.`);
}

main().catch(async (e) => {
  await log(`FATAL: ${e?.message ?? e}\n${e?.stack ?? ''}`);
  process.exit(1);
});
