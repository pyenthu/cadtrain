#!/usr/bin/env bun
/**
 * Figure → primitive extraction — runs Claude Opus CLI against the
 * numbered figure gallery produced by scripts/extract_figures.ts.
 *
 * Picture-first workflow:
 *   1. `bun run scripts/extract_figures.ts` renders PDF pages to
 *      <volume>/figures/extract-N.png + gallery.json (run FIRST).
 *   2. The user curates in the /primitives Test tab and picks figures
 *      by number ("extract 7").
 *   3. This script takes those figure numbers, and for each one runs a
 *      generate + 5-iter critique loop against the figure IMAGE, saving
 *      artifacts to static/tests/extracted/<primitive-id>/ + manifest.
 *
 * The Test tab auto-loads the manifest on mount so each generated
 * candidate is a clickable row with its final .ts and iteration history;
 * the existing promote flow turns it into a real primitive.
 *
 * Subscription-billed via claude.ai OAuth (NOT API key). Each call is
 * a `claude --print --output-format json --model opus` subprocess.
 *
 * Run with:
 *   bun run scripts/overnight_extract.ts --figure 7        # one figure
 *   bun run scripts/overnight_extract.ts --figures 1,4,9   # explicit list
 *   bun run scripts/overnight_extract.ts --range 1-10      # inclusive range
 *   bun run scripts/overnight_extract.ts                   # ALL gallery figures
 *   bun run scripts/overnight_extract.ts --range 1-20 --batch 5   # 5 then exit
 *   bun run scripts/overnight_extract.ts --resume --batch 5       # next batch
 *   bun run scripts/overnight_extract.ts --range 1-5 --no-refine  # single-shot
 */

import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdir } from 'node:fs/promises';
import { volumePath } from './_volume';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const OUT_DIR = resolve(REPO, 'static/tests/extracted');
// The figure gallery lives on the volume (not static/, not git).
const FIGURES_DIR = volumePath('figures');
const GALLERY = join(FIGURES_DIR, 'gallery.json');
const COMPONENTS_DIR = resolve(REPO, 'src/lib/cad/components');
const LOG_FILE = resolve(OUT_DIR, '_run.log');
const MANIFEST = resolve(OUT_DIR, 'manifest.json');

const MODEL = 'opus';
const MAX_ITERS = 5;
const CALL_TIMEOUT_MS = 5 * 60_000;

// ─── Args ─────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (k: string) => argv.includes(k);
function arg(k: string, def?: string): string | undefined {
  const i = argv.indexOf(k);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def;
}
const NO_REFINE = flag('--no-refine');
const RESUME = flag('--resume');
/** Process at most this many figures this run, then exit cleanly.
 *  0 = no cap. Pairs with --resume for human-in-the-loop batching:
 *  run a batch, review it, re-run for the next. */
const BATCH = Number(arg('--batch', '0'));

/** Parse the figure selector flags into a sorted list of figure numbers.
 *  --figure N | --figures 1,4,9 | --range 1-10. Empty = ALL gallery
 *  figures (the resume path overrides this anyway). */
function parseFigureSelector(): number[] {
  const nums = new Set<number>();
  const single = arg('--figure');
  if (single) nums.add(Number(single));
  const list = arg('--figures');
  if (list) for (const t of list.split(',')) { const n = Number(t.trim()); if (Number.isFinite(n)) nums.add(n); }
  const range = arg('--range');
  if (range) {
    const m = /^(\d+)-(\d+)$/.exec(range.trim());
    if (m) { for (let n = Number(m[1]); n <= Number(m[2]); n++) nums.add(n); }
  }
  return [...nums].sort((a, b) => a - b);
}

// ─── Logging ──────────────────────────────────────────────────────────
async function log(msg: string) {
  const stamped = `[${new Date().toISOString()}] ${msg}`;
  console.log(stamped);
  try { await writeFile(LOG_FILE, stamped + '\n', { flag: 'a' }); } catch {}
}

// ─── Claude CLI wrapper ───────────────────────────────────────────────
interface CliResult { stdout: string; stderr: string; exitCode: number; durationMs: number; }

const RETRYABLE_BACKOFF_MS = [60_000, 120_000, 240_000, 480_000];

function spawnOnce(opts: {
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
    // Close stdin — the CLI otherwise waits 3s for stdin data and
    // emits a noisy warning.
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  proc.stdout.on('data', (d) => (stdout += String(d)));
  proc.stderr.on('data', (d) => (stderr += String(d)));
  return new Promise<CliResult>((res, rej) => {
    proc.on('exit', (c) => res({ stdout, stderr, exitCode: c ?? -1, durationMs: Date.now() - t0 }));
    proc.on('error', rej);
  });
}

/**
 * Inspect the --output-format json envelope for an API-level error that
 * exitCode alone misses (`is_error:true, api_error_status:400,
 * result:"Credit balance is too low"` INSIDE the JSON).
 */
function envelopeApiError(stdout: string): { status: number | string; message: string } | null {
  try {
    const env = JSON.parse(stdout);
    if (env?.is_error === true || env?.api_error_status) {
      return {
        status: env.api_error_status ?? 'unknown',
        message: String(env.result ?? env.subtype ?? 'API error'),
      };
    }
  } catch { /* non-JSON — handled by parseEnvelope downstream */ }
  return null;
}

/**
 * Call Claude with automatic retry+backoff on transient API errors
 * (429 rate limit, 400 "Credit balance is too low", 5xx). Credit
 * exhaustion is RETRYABLE — the session window refills.
 */
async function callClaude(opts: {
  systemPrompt: string;
  userPrompt: string;
  addDir: string;
}): Promise<CliResult> {
  for (let attempt = 0; attempt <= RETRYABLE_BACKOFF_MS.length; attempt++) {
    const r = await spawnOnce(opts);
    const apiErr = envelopeApiError(r.stdout);
    const retryable =
      apiErr != null &&
      (apiErr.status === 429 ||
        apiErr.status === 400 ||
        (typeof apiErr.status === 'number' && apiErr.status >= 500) ||
        /credit balance|rate limit|overloaded/i.test(apiErr.message));
    if (apiErr && retryable && attempt < RETRYABLE_BACKOFF_MS.length) {
      const wait = RETRYABLE_BACKOFF_MS[attempt];
      await log(`  API error (${apiErr.status}: ${apiErr.message.slice(0, 80)}) — backoff ${wait / 1000}s, attempt ${attempt + 1}`);
      await new Promise((res) => setTimeout(res, wait));
      continue;
    }
    if (apiErr) {
      return { ...r, exitCode: r.exitCode === 0 ? 1 : r.exitCode };
    }
    return r;
  }
  throw new Error('callClaude: exhausted retries');
}

function parseEnvelope(stdout: string): string {
  const env = JSON.parse(stdout);
  if (env?.is_error === true) {
    throw new Error(`API error envelope: ${String(env.result ?? env.subtype ?? '').slice(0, 200)}`);
  }
  const raw = String(env.result ?? '').trim();
  if (!raw) throw new Error(`empty result from CLI envelope: ${stdout.slice(0, 200)}`);
  return raw;
}

function stripTsFence(s: string): string {
  const m = /```(?:typescript|ts)?\s*\n([\s\S]*?)\n```/.exec(s);
  return m ? m[1].trim() : s.trim();
}

/** Pull meta.id / meta.name out of a generated .ts so the manifest +
 *  output dir use the primitive's real id rather than the figure number. */
function parseMeta(ts: string): { id: string | null; name: string | null } {
  const idM = /\bid:\s*['"]([a-z][a-z0-9_]*)['"]/.exec(ts);
  const nameM = /\bname:\s*['"]([^'"]+)['"]/.exec(ts);
  return { id: idM ? idM[1] : null, name: nameM ? nameM[1] : null };
}

// ─── Gallery ──────────────────────────────────────────────────────────
interface FigureItem {
  n: number;
  id: string;        // "extract-N"
  pdf: string;
  page: number;
  file: string;      // volume-relative: figures/extract-N.png
  thumb: string;     // volume-relative: figures/extract-N.thumb.png
}

async function loadGallery(): Promise<FigureItem[]> {
  if (!existsSync(GALLERY)) {
    throw new Error(`gallery.json not found at ${GALLERY} — run scripts/extract_figures.ts first`);
  }
  const payload = JSON.parse(await readFile(GALLERY, 'utf8'));
  if (!Array.isArray(payload?.items)) throw new Error('gallery.json has no items array');
  return payload.items as FigureItem[];
}

/** Absolute path to a figure's full-res page render on the volume. */
function figurePath(fig: FigureItem): string {
  return volumePath(fig.file);
}

/** Browser-facing URL for a figure (served through the volume CRUD). */
function figureUrl(fig: FigureItem): string {
  return `/api/volume?path=${encodeURIComponent(fig.file)}`;
}

// ─── Catalog context — the existing primitives as compact ref ─────────
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

// ─── Generate + critique ──────────────────────────────────────────────
const GENERATE_SYSTEM = `You write single-file ManifoldCAD primitives for cadtrain from a figure image.

# File format
Each primitive lives at src/lib/cad/components/<id>.ts and exports:

\`\`\`ts
import { tube, cyl, mv, rot, M } from '../manifold-helpers';
import { defineGeom } from '.';

export const meta = {
  id: '<snake_case_id>',
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
- Pick a clear snake_case \`id\` and human \`name\` that describe the part in the figure.
- **Z-down**: top = LOWER z, bottom = HIGHER z. mv(part, [0,0,+N]) moves DOWN.
- Helpers: tube(outerR, innerR, length), cyl(h, r1, r2?), mv(part, [x,y,z]), rot(part, [x,y,z]), M.cube([x,y,z], center?).
- Manifold ops: .add() / .subtract() / .intersect().
- Imports only from '../manifold-helpers' or another './<id>'.
- Keep param defaults realistic for the implied spec.

# Output contract
Respond with the COMPLETE .ts file as a single fenced \`\`\`typescript code block. No prose. No diff.`;

const CRITIQUE_SYSTEM = `You critique a ManifoldCAD primitive .ts against the source figure image it was meant to model.

Look at the figure image. Look at the .ts. Decide:
- If the GEOMETRY in the .ts faithfully captures the figure (correct proportions, correct features, correct Z-down orientation): respond with EXACTLY the single word \`MATCH\` and nothing else.
- Otherwise: respond with the CORRECTED complete \`<id>.ts\` as a single fenced \`\`\`typescript code block. No prose.`;

async function generateFromFigure(fig: FigureItem, catalog: string): Promise<string> {
  const imgPath = figurePath(fig);
  const userPrompt = `Look at the figure image at this absolute path: ${imgPath}
This is page ${fig.page} of ${fig.pdf} (figure "${fig.id}").

Catalog of existing primitives (for reference shapes and helpers usage):

${catalog}

Identify the part shown and write the complete <id>.ts file modeling it as a parametric primitive.`;
  const r = await callClaude({
    systemPrompt: GENERATE_SYSTEM,
    userPrompt,
    addDir: FIGURES_DIR,
  });
  if (r.exitCode !== 0) throw new Error(`generate exit ${r.exitCode}: ${r.stderr.slice(0, 200)}`);
  return stripTsFence(parseEnvelope(r.stdout));
}

async function critiqueAndRefine(
  fig: FigureItem, currentTs: string, iter: number,
): Promise<{ verdict: 'MATCH' | 'REFINE'; nextTs?: string; raw: string }> {
  const imgPath = figurePath(fig);
  const userPrompt = `Look at the figure image at this absolute path: ${imgPath}
This is page ${fig.page} of ${fig.pdf} (figure "${fig.id}").

Here is the current .ts (iteration ${iter}):

\`\`\`typescript
${currentTs}
\`\`\`

Does the geometry described in this .ts faithfully match the figure? Respond MATCH if yes, else respond with the corrected complete .ts.`;
  const r = await callClaude({
    systemPrompt: CRITIQUE_SYSTEM,
    userPrompt,
    addDir: FIGURES_DIR,
  });
  if (r.exitCode !== 0) throw new Error(`critique exit ${r.exitCode}: ${r.stderr.slice(0, 200)}`);
  const text = parseEnvelope(r.stdout);
  if (text.trim() === 'MATCH') return { verdict: 'MATCH', raw: text };
  return { verdict: 'REFINE', nextTs: stripTsFence(text), raw: text };
}

// ─── Manifest ─────────────────────────────────────────────────────────
interface ManifestEntry {
  id: string;            // primitive id — also the output dir name
  name: string;
  family?: string;
  source_pdf: string;
  source_page?: number | string;
  /** The gallery figure this was generated from ("extract-N"). */
  source_figure: string;
  brief_description: string;
  iters_done: number;
  final_verdict: 'MATCH' | 'INCOMPLETE' | 'ERROR';
  error?: string;
  url: string;           // points to the per-item dir
  /** The figure page render — shown in the Test tab + copied into the
   *  volume as <id>.source.png on promote. */
  source_image: string;
}

async function saveManifest(items: ManifestEntry[]) {
  const tmp = MANIFEST + '.tmp';
  await writeFile(tmp, JSON.stringify({ generated_at: new Date().toISOString(), items }, null, 2));
  await rename(tmp, MANIFEST);
}

/** An INCOMPLETE placeholder entry for a figure not yet processed. */
function incompleteEntry(fig: FigureItem): ManifestEntry {
  return {
    id: fig.id, // figure id stands in until generation produces a real one
    name: fig.id,
    source_pdf: fig.pdf,
    source_page: fig.page,
    source_figure: fig.id,
    brief_description: `Figure ${fig.id} — ${fig.pdf} p.${fig.page} (not yet generated)`,
    iters_done: 0,
    final_verdict: 'INCOMPLETE',
    url: `/tests/extracted/${fig.id}/`,
    source_image: figureUrl(fig),
  };
}

async function processFigure(fig: FigureItem, catalog: string): Promise<ManifestEntry> {
  const notes: any = { figure: fig, iterations: [] };
  let final_verdict: ManifestEntry['final_verdict'] = 'INCOMPLETE';
  let iters = 0;

  try {
    // Generate first — the .ts carries meta.id/name, which we parse to
    // name the output dir and the manifest entry.
    let ts = await generateFromFigure(fig, catalog);
    const meta = parseMeta(ts);
    let primId = meta.id ?? fig.id.replace(/-/g, '_');
    // Avoid clobbering an existing dir from a different figure.
    if (existsSync(join(OUT_DIR, primId)) && primId !== fig.id) {
      primId = `${primId}_${fig.n}`;
    }
    const itemDir = join(OUT_DIR, primId);
    await mkdir(itemDir, { recursive: true });

    await writeFile(join(itemDir, 'iter-0.ts'), ts);
    notes.iterations.push({ iter: 0, action: 'generate', length: ts.length });
    iters = 1;

    if (!NO_REFINE) {
      for (let i = 1; i <= MAX_ITERS - 1; i++) {
        const r = await critiqueAndRefine(fig, ts, i);
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
      final_verdict = 'MATCH'; // single-shot — treat as done
    }

    await writeFile(join(itemDir, 'final.ts'), ts);
    await writeFile(join(itemDir, 'notes.json'), JSON.stringify(notes, null, 2));

    const finalMeta = parseMeta(ts);
    return {
      id: primId,
      name: finalMeta.name ?? meta.name ?? primId,
      family: undefined,
      source_pdf: fig.pdf,
      source_page: fig.page,
      source_figure: fig.id,
      brief_description: finalMeta.name ? `${finalMeta.name} — from ${fig.id}` : `Generated from ${fig.id}`,
      iters_done: iters,
      final_verdict,
      url: `/tests/extracted/${primId}/`,
      source_image: figureUrl(fig),
    };
  } catch (e: any) {
    const err = e?.message ?? String(e);
    const errDir = join(OUT_DIR, fig.id);
    await mkdir(errDir, { recursive: true });
    notes.error = err;
    await writeFile(join(errDir, 'notes.json'), JSON.stringify(notes, null, 2));
    return { ...incompleteEntry(fig), iters_done: iters, final_verdict: 'ERROR', error: err };
  }
}

// ─── Main ─────────────────────────────────────────────────────────────
async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await log(`overnight_extract started. no_refine=${NO_REFINE}, resume=${RESUME}, batch=${BATCH}`);

  const gallery = await loadGallery();
  await log(`gallery: ${gallery.length} figures available`);
  const byNumber = new Map(gallery.map((f) => [f.n, f]));
  const byFigureId = new Map(gallery.map((f) => [f.id, f]));

  // Resume — load existing manifest if present.
  let prior: ManifestEntry[] = [];
  if (RESUME && existsSync(MANIFEST)) {
    try {
      const cur = JSON.parse(await readFile(MANIFEST, 'utf8'));
      if (Array.isArray(cur.items)) prior = cur.items;
      await log(`resume: ${prior.length} existing entries loaded`);
    } catch {}
  }

  // Figure work-set. On resume, reconstruct from the manifest's
  // source_figure field (retry ERROR/INCOMPLETE, skip MATCH). Otherwise
  // use the --figure/--figures/--range selector; empty selector = all.
  let figures: FigureItem[] = [];
  if (RESUME && prior.length > 0) {
    const matchFigIds = new Set(
      prior.filter((p) => p.final_verdict === 'MATCH').map((p) => p.source_figure),
    );
    const wantFigIds = [...new Set(prior.map((p) => p.source_figure))];
    figures = wantFigIds
      .filter((fid) => !matchFigIds.has(fid))
      .map((fid) => byFigureId.get(fid))
      .filter((f): f is FigureItem => !!f);
    await log(`resume: ${figures.length} figures to retry (${matchFigIds.size} already MATCH)`);
  } else {
    const sel = parseFigureSelector();
    if (sel.length === 0) {
      figures = gallery;
      await log(`no selector — processing ALL ${figures.length} gallery figures`);
    } else {
      figures = sel.map((n) => byNumber.get(n)).filter((f): f is FigureItem => !!f);
      const missing = sel.filter((n) => !byNumber.has(n));
      if (missing.length) await log(`WARN: figures not in gallery: ${missing.join(', ')}`);
      await log(`selector: ${figures.length} figures (${sel.join(', ')})`);
    }
  }

  if (figures.length === 0) {
    await log('nothing to do — no figures selected.');
    return;
  }

  // Batch cap — process only the next BATCH figures, rest stay
  // INCOMPLETE for a follow-up --resume run.
  let todo = figures;
  let pending: FigureItem[] = [];
  if (BATCH > 0 && figures.length > BATCH) {
    pending = figures.slice(BATCH);
    todo = figures.slice(0, BATCH);
    await log(`batch mode: processing ${todo.length} of ${figures.length} (${pending.length} stay INCOMPLETE)`);
  }

  const catalog = await loadCatalogContext();
  await log(`catalog context: ${catalog.length} chars`);

  // Prior MATCH entries are preserved. pendingEntries keep beyond-batch
  // figures visible in the Test tab between batches.
  const priorMatch = prior.filter((p) => p.final_verdict === 'MATCH');
  const matchFigIds = new Set(priorMatch.map((p) => p.source_figure));
  const pendingEntries = pending
    .filter((f) => !matchFigIds.has(f.id))
    .map(incompleteEntry);

  // Persist the full picture immediately: prior MATCH + this batch
  // (INCOMPLETE until processed) + pending.
  await saveManifest([
    ...priorMatch,
    ...todo.map(incompleteEntry),
    ...pendingEntries,
  ]);

  const completed: ManifestEntry[] = [...priorMatch];
  let idx = 0;
  for (const fig of todo) {
    idx++;
    await log(`[${idx}/${todo.length}] ${fig.id} (${fig.pdf} p.${fig.page})`);
    const t0 = Date.now();
    let entry: ManifestEntry;
    try {
      entry = await processFigure(fig, catalog);
      await log(`  done: id=${entry.id} verdict=${entry.final_verdict}, iters=${entry.iters_done}, ${Date.now() - t0}ms`);
    } catch (e: any) {
      await log(`  FAILED: ${e?.message ?? e}`);
      entry = { ...incompleteEntry(fig), final_verdict: 'ERROR', error: e?.message ?? String(e) };
    }
    completed.push(entry);
    const remainingBatch = todo.slice(idx).map(incompleteEntry);
    await saveManifest([...completed, ...remainingBatch, ...pendingEntries]);
  }

  const matched = completed.filter((c) => c.final_verdict === 'MATCH').length;
  await log(`run complete. processed ${todo.length} this batch (${matched} total MATCH). ${pending.length} still pending.`);
}

main().catch(async (e) => {
  await log(`FATAL: ${e?.message ?? e}\n${e?.stack ?? ''}`);
  process.exit(1);
});
