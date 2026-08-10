// scripts/eval-app-build.ts — the HEADLESS app-build eval harness (docs/plans/app-build-eval.md).
//
// Measures how well a provider reproduces our GOLDEN .app builds from the natural-language prompt
// scripts. For each app it: loads the golden .app + its ordered prompts, replays the prompts
// through `buildAppViaCli` (the same emit-verbs→parse→dispatch path the CLI + in-browser Phi use),
// and prints `scoreApp(built, golden)` — a 0..1 structural similarity + per-facet breakdown.
//
//   bun run scripts/eval-app-build.ts                    # FAKE oracle runner, all apps (CI-safe)
//   bun run scripts/eval-app-build.ts --app plan         # one app
//   bun run scripts/eval-app-build.ts --json             # machine-readable output
//   bun run scripts/eval-app-build.ts --provider cli --app plan   # ONE real `claude --print` run
//
// MEASUREMENT DISCIPLINE (2026-08) — a single small-model run is noise (the 1.5B model swings
// partsdash 26↔49, opsdash 38↔28 run-to-run; Claude is tight, σ≈0.02). So the runner can REPEAT a
// build and report the distribution, and CI can GATE a mean against a snapshotted baseline:
//   --runs N                     # build each app N times; report mean · σ (population) · min · max + per-facet means
//   --write-baseline <path.json> # dump the current per-app MEANS as a baseline: { "<appId>": <mean>, … }
//   --gate <path.json>           # FAIL (exit 1) if any app's mean < baseline − 0.03 tolerance; else exit 0
// `--runs 1` with no gate = the exact original behaviour. `--provider cli --runs N` costs N billed
// calls per app — verify plumbing with the free deterministic `fake` provider (σ≈0 confirms it).
//
// The DEFAULT provider is a deterministic FAKE runner (no LLM, no network) so this is CI-safe: it
// DECOMPILES the golden into a gui-verb list and replays it, distributed across the prompt steps —
// establishing the score CEILING (≈1.0) and proving the parse→dispatch→score plumbing is sound.
// A real model's deviation from that ceiling is then the meaningful signal. `--provider cli` runs
// the subscription-billed `claude --print` ONCE (one app) — keep it to a smoke check.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAppViaCli, type CliRunner } from '../src/lib/appkit/ai/build-cli';
import { scoreApp, preorderKinds, type AppLike, type ScoreBreakdown, type ScoreResult } from '../src/lib/appkit/ai/score-app';
import { APP_IDS, EVAL_PROMPTS, type EvalAppId } from '../src/lib/appkit/ai/eval-fixtures';
import { runClaudeCli } from '../src/lib/server/claude-cli';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, 'eval-fixtures');
// The prompt scripts + app ids live in the SHARED fixtures module (eval-fixtures.ts) so the
// headless runner and the in-browser eval route (/app_design/eval) can never drift.
const APPS = APP_IDS;
type AppId = EvalAppId;

// ── fixtures ─────────────────────────────────────────────────────────────────────────────────
/** Load a golden .app: the committed fixture snapshot first (offline/CI), else the running dev
 *  server's volume proxy (the canonical store, ai/app-rag/golden/<id>.app). */
async function loadGolden(id: string): Promise<AppLike> {
  try {
    return JSON.parse(await readFile(join(FIX, 'golden', `${id}.app`), 'utf8'));
  } catch {
    const base = process.env.CADTRAIN_DEV_URL ?? 'http://localhost:3333';
    const r = await fetch(`${base}/api/volume?path=ai/app-rag/golden/${id}.app&raw=1`);
    if (!r.ok) throw new Error(`golden ${id} not found (fixture missing + dev server ${base} returned ${r.status})`);
    return (await r.json()) as AppLike;
  }
}

// ── the FAKE oracle: decompile a golden into a gui-verb list, replayed across the prompts ───────
interface VerbCall {
  verb: string;
  args: unknown;
}

/** Turn a golden .app into the ordered gui-verb calls that rebuild it (setAppMeta / patchApp for
 *  meta+data+theme, then a pre-order definePanel/addChildPanel walk of the panel tree). Pre-order
 *  guarantees a parent is defined before its children, so any contiguous chunking stays valid. */
export function decompileApp(g: AppLike): VerbCall[] {
  const v: VerbCall[] = [];
  v.push({ verb: 'setAppMeta', args: { title: g.title, docType: g.docType } });
  if (g.app) v.push({ verb: 'patchApp', args: { op: 'set', path: 'app', value: g.app } });
  for (const [k, val] of Object.entries((g.structures as Record<string, unknown>) ?? {}))
    v.push({ verb: 'patchApp', args: { op: 'set', path: `structures.${k}`, value: val } });
  for (const [k, val] of Object.entries((g.vars as Record<string, unknown>) ?? {}))
    v.push({ verb: 'patchApp', args: { op: 'set', path: `vars.${k}`, value: val } });
  for (const [k, val] of Object.entries((g.computed as Record<string, unknown>) ?? {}))
    v.push({ verb: 'patchApp', args: { op: 'set', path: `computed.${k}`, value: val } });
  if (g.files) v.push({ verb: 'patchApp', args: { op: 'set', path: 'files', value: g.files } });

  const emit = (p: any, parentId: string | null) => {
    const { children, ...shallow } = p; // strip children; addChildPanel re-attaches them
    v.push(parentId === null ? { verb: 'definePanel', args: { panel: shallow } } : { verb: 'addChildPanel', args: { parentId, panel: shallow } });
    for (const c of children ?? []) emit(c, p.id);
  };
  for (const p of (g.panels as any[]) ?? []) emit(p, null);

  if (g.theme) v.push({ verb: 'patchApp', args: { op: 'set', path: 'theme', value: g.theme } });
  if (g.css) v.push({ verb: 'patchApp', args: { op: 'set', path: 'css', value: g.css } });
  if (g.events) v.push({ verb: 'patchApp', args: { op: 'set', path: 'events', value: g.events } });
  return v;
}

/** Split a list into `n` roughly-equal contiguous chunks (order preserved). */
function chunkEvenly<T>(xs: T[], n: number): T[][] {
  const out: T[][] = Array.from({ length: n }, () => []);
  if (n <= 0) return [xs];
  const per = Math.ceil(xs.length / n) || 1;
  for (let i = 0; i < xs.length; i++) out[Math.min(n - 1, Math.floor(i / per))].push(xs[i]);
  return out;
}

/** A deterministic oracle CliRunner: returns the decompiled golden's verbs, one chunk per prompt
 *  call. Stateful over the sequence (buildAppViaCli calls run() exactly once per prompt). */
function makeOracleRunner(golden: AppLike, nPrompts: number): CliRunner {
  const chunks = chunkEvenly(decompileApp(golden), nPrompts);
  let i = 0;
  return async () => JSON.stringify(chunks[Math.min(i++, chunks.length - 1)] ?? []);
}

// ── run one app ────────────────────────────────────────────────────────────────────────────────
/** One replayed rung: the app AFTER prompt N, scored vs the golden — the divergence diagnostic. */
interface StepRec {
  step: number;
  prompt: string;
  score: number;
  breakdown: Record<string, number>;
  builtKinds: string[];
}

/** The TRUE incremental path: replay the prompts ONE AT A TIME, feeding the mutated app forward,
 *  scoring after every rung (so we see exactly where a build diverges) and — when `outDir` is set —
 *  writing a `step-NN.app` snapshot per rung + a `summary.json`. Used by both the deterministic
 *  oracle (fake) and the real `claude --print` runner; only the transport + grounding differ. */
async function replayIncremental(
  id: AppId,
  prompts: string[],
  runner: CliRunner,
  golden: AppLike,
  opts: { model?: string; ground?: (prompt: string, app: AppLike) => Promise<string>; outDir?: string } = {},
): Promise<{ app: AppLike; steps: StepRec[] }> {
  const app: AppLike = { app: id, panels: [] };
  const steps: StepRec[] = [];
  if (opts.outDir) await mkdir(opts.outDir, { recursive: true });
  for (let i = 0; i < prompts.length; i++) {
    const prompt = prompts[i]!;
    const grounding = opts.ground ? await opts.ground(prompt, app) : '';
    await buildAppViaCli({ prompt, app: app as any, grounding, model: opts.model }, runner);
    const r = scoreApp(app, golden);
    steps.push({ step: i + 1, prompt, score: r.score, breakdown: r.breakdown as unknown as Record<string, number>, builtKinds: preorderKinds(app) });
    if (opts.outDir) await writeFile(join(opts.outDir, `step-${String(i + 1).padStart(2, '0')}.app`), JSON.stringify(app, null, 2));
  }
  if (opts.outDir) {
    await writeFile(join(opts.outDir, 'final.app'), JSON.stringify(app, null, 2));
    await writeFile(join(opts.outDir, 'summary.json'), JSON.stringify({ id, prompts: prompts.length, steps }, null, 2));
  }
  return { app, steps };
}

async function runFake(id: AppId, prompts: string[], golden: AppLike, outDir?: string): Promise<{ app: AppLike; steps: StepRec[] }> {
  return replayIncremental(id, prompts, makeOracleRunner(golden, prompts.length), golden, { outDir });
}

const claudeRunner: CliRunner = (full, o) => runClaudeCli(full, { model: o.model });

/** ONE Ollama (LOCAL, headless) turn — a real small model without a browser (the browser Qwen can't
 *  run unattended). Uses the native non-streaming /api/generate; the model emits the SAME verb-list
 *  text the cli/phi path parses. temperature 0 for the least-noisy measurement. `--provider local`.
 *  Needs a running Ollama server (`brew services start ollama`) + the model (`ollama pull …`). */
const runOllama: CliRunner = async (full, o) => {
  const base = process.env.OLLAMA_URL ?? 'http://localhost:11434';
  const model = o.model ?? process.env.OLLAMA_MODEL ?? 'qwen2.5:1.5b';
  const r = await fetch(`${base}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // num_ctx is NOT optional here. Ollama defaults to a 4096-token context (`llama-server -c 4096`),
    // while systemPrompt() alone is ~18.5K chars ≈ 5K tokens before any grounding is appended. The
    // overflow is truncated SILENTLY — and because grounding sits near the top of the system prompt,
    // it is the first thing discarded. Measured 2026-08-07: with the default context, `--ground` and
    // no-`--ground` produced byte-identical builds (same 13 per-rung scores, same final.app), i.e.
    // every headless RAG measurement to date compared a prompt the model never actually received.
    // The browser path took this same fix on 2026-08-02 (WEBLLM_CONTEXT_WINDOW 4096→8192).
    body: JSON.stringify({
      model,
      prompt: full,
      stream: false,
      options: { temperature: 0, num_ctx: Number(process.env.OLLAMA_NUM_CTX ?? 8192) },
    }),
  });
  if (!r.ok) throw new Error(`ollama ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return ((await r.json()) as { response?: string }).response ?? '';
};

/** ONE real turn (claude `--print` or local Ollama): the whole script is concatenated into a single
 *  request so the cli eval costs at most one subscription-billed call (never a per-prompt loop). */
async function runCli(id: AppId, prompts: string[], model?: string, runner: CliRunner = claudeRunner): Promise<AppLike> {
  const app: AppLike = { app: id, panels: [] };
  const combined = prompts.map((p, i) => `${i + 1}. ${p}`).join('\n');
  await buildAppViaCli({ prompt: combined, app: app as any, grounding: '', model }, runner);
  return app;
}

/** The TRUE incremental reference: one model call PER prompt, forwarding the app. cli = N
 *  subscription calls per app (never the metered key); local = N Ollama calls — the faithful
 *  atomic-build test on whichever model. */
async function runCliIncremental(
  id: AppId,
  prompts: string[],
  golden: AppLike,
  opts: { model?: string; ground?: (prompt: string, app: AppLike) => Promise<string>; outDir?: string; runner?: CliRunner },
): Promise<{ app: AppLike; steps: StepRec[] }> {
  return replayIncremental(id, prompts, opts.runner ?? claudeRunner, golden, opts);
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

/** Optional RAG grounding for the headless runner — fetches the dev server's /api/app/ground (the
 *  SAME retrieval the browser uses). Requires a running dev server; returns '' on any failure. */
function makeGrounder(): (prompt: string, app: AppLike) => Promise<string> {
  const base = process.env.CADTRAIN_DEV_URL ?? 'http://localhost:3333';
  return async (prompt, app) => {
    try {
      const r = await fetch(`${base}/api/app/ground`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // pass docType (#49) + a per-request vector toggle (APP_RAG_VECTOR env → the hill-climb A/Bs
        // lexical↔vector without restarting the server) so the eval exercises the real retrieval path.
        body: JSON.stringify({
          prompt,
          docType: (app as { docType?: string })?.docType,
          vector: process.env.APP_RAG_VECTOR ? process.env.APP_RAG_VECTOR !== '0' && process.env.APP_RAG_VECTOR.toLowerCase() !== 'false' : undefined,
          // APP_RAG_K sweeps how many goldens reach the prompt (endpoint default 3 = rankGolden's).
          // That cap is a code constant, not a context limit: at num_ctx 8192 the system prompt is
          // ~4.7K tokens with ~3.4K spare, and grounding measured +4.3pp (partsdash) / +14.5pp
          // (opsdash) — so how much of it we send is a free variable worth A/B-ing. Mirrors
          // APP_RAG_VECTOR so a sweep needs no server restart.
          k: process.env.APP_RAG_K ? Number(process.env.APP_RAG_K) : undefined,
        }),
      });
      return r.ok ? (((await r.json()) as { grounding?: string }).grounding ?? '') : '';
    } catch {
      return '';
    }
  };
}

// ── run-distribution stats (mirror the eval page's averaged/stdev; kept self-contained/headless) ─
const FACETS: (keyof ScoreBreakdown)[] = ['panelKinds', 'nesting', 'vars', 'structures', 'theme', 'meta'];

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}
/** Population stdev (÷N, matching the eval page). <2 samples → 0. */
function popStdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
}
/** Per-facet means across a set of run results. */
function facetMeans(runs: ScoreResult[]): ScoreBreakdown {
  const out = { panelKinds: 0, nesting: 0, vars: 0, structures: 0, theme: 0, meta: 0 } as ScoreBreakdown;
  for (const f of FACETS) out[f] = mean(runs.map((r) => r.breakdown[f]));
  return out;
}

/** One app's repeated-run distribution — the row of the runs table + the gate/baseline unit. */
interface AppAgg {
  id: string;
  runs: ScoreResult[]; // one per run (score + breakdown)
  scores: number[];
  mean: number;
  stdev: number;
  min: number;
  max: number;
  facets: ScoreBreakdown;
  last: ScoreResult; // the final run's full result (built/golden kinds for the detailed N===1 print)
  lastSteps?: StepRec[]; // the final run's per-rung records (incremental)
}

/** Render a fixed-width table: header row + body; col 0 left-aligned, the rest right-aligned. */
function renderTable(headers: string[], rows: string[][]): string {
  const w = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const line = (cells: string[]) => cells.map((c, i) => (i === 0 ? (c ?? '').padEnd(w[i]) : (c ?? '').padStart(w[i]))).join('  ');
  return [line(headers), ...rows.map(line)].join('\n');
}

const GATE_TOLERANCE = 0.03; // a mean may dip this far below baseline before it FAILs (small-model noise band)

/** Build one app ONCE (whichever provider path) and score it vs the golden. The `--runs` loop
 *  calls this N times; a deterministic path (fake / score-file) yields σ≈0, a real model yields
 *  the run-to-run variance we're measuring. */
async function buildOnce(
  id: AppId,
  prompts: string[],
  golden: AppLike,
  provider: 'fake' | 'cli' | 'local',
  opts: { model?: string; incremental: boolean; doGround: boolean; scoreFile?: string; outDir?: string },
): Promise<{ result: ScoreResult; steps?: StepRec[] }> {
  let built: AppLike;
  let steps: StepRec[] | undefined;
  const runner = provider === 'local' ? runOllama : undefined; // cli → default claude runner
  if (opts.scoreFile) {
    built = JSON.parse(await readFile(opts.scoreFile, 'utf8')) as AppLike; // score a captured build (browser/local) vs the golden
  } else if ((provider === 'cli' || provider === 'local') && opts.incremental) {
    const res = await runCliIncremental(id, prompts, golden, {
      model: opts.model,
      outDir: opts.outDir,
      ground: opts.doGround ? makeGrounder() : undefined,
      runner,
    });
    built = res.app;
    steps = res.steps;
  } else if (provider === 'cli' || provider === 'local') {
    built = await runCli(id, prompts, opts.model, runner);
  } else {
    const res = await runFake(id, prompts, golden, opts.outDir);
    built = res.app;
    steps = res.steps;
  }
  return { result: scoreApp(built, golden), steps };
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const provider = (flag('--provider') ?? 'fake') as 'fake' | 'cli' | 'local';
  const model = flag('--model');
  const asJson = argv.includes('--json');
  const incremental = argv.includes('--incremental'); // one model call PER prompt + per-rung snapshots
  const doGround = argv.includes('--ground'); // fetch RAG grounding per prompt (needs a dev server)
  const only = flag('--app');
  const scoreFile = flag('--score-file'); // score an ALREADY-BUILT .app (e.g. a browser capture) vs the golden
  const runs = Math.max(1, Math.floor(Number(flag('--runs') ?? '1')) || 1); // repeat each build N× → distribution
  const gateFile = flag('--gate'); // baseline JSON { "<appId>": <minMean> } → FAIL any app below (minus tolerance)
  const writeBaseline = flag('--write-baseline'); // dump the current per-app MEANS as a baseline snapshot
  const ids = (only && only !== 'all' ? [only] : APPS).filter((a): a is AppId => (APPS as readonly string[]).includes(a));
  if (!ids.length) {
    console.error(`unknown app "${only}" — choose one of: ${APPS.join(', ')} (or "all")`);
    process.exit(1);
  }

  const aggs: AppAgg[] = [];

  for (const id of ids) {
    const golden = await loadGolden(id);
    const prompts = EVAL_PROMPTS[id] ?? [];
    const outDir = incremental ? join(FIX, 'runs', `${id}-${provider}${doGround ? '-ground' : ''}`) : undefined;

    const runResults: ScoreResult[] = [];
    let lastSteps: StepRec[] | undefined;
    for (let k = 0; k < runs; k++) {
      const { result, steps } = await buildOnce(id, prompts, golden, provider, { model, incremental, doGround, scoreFile, outDir });
      runResults.push(result);
      lastSteps = steps;
    }
    const scores = runResults.map((r) => r.score);
    aggs.push({
      id,
      runs: runResults,
      scores,
      mean: mean(scores),
      stdev: popStdev(scores),
      min: Math.min(...scores),
      max: Math.max(...scores),
      facets: facetMeans(runResults),
      last: runResults[runResults.length - 1]!,
      lastSteps,
    });

    if (!asJson && runs === 1) {
      // ── N===1: the ORIGINAL per-app detailed block (unchanged behaviour) ──
      const r = runResults[0]!;
      const tag = incremental ? `${provider}, incremental` : provider;
      console.log(`\n=== ${id}  (${tag}, ${prompts.length} prompt${prompts.length === 1 ? '' : 's'}) ===`);
      console.log(`  score: ${pct(r.score)}`);
      const b = r.breakdown;
      console.log(
        `  facets: panelKinds ${pct(b.panelKinds)} · nesting ${pct(b.nesting)} · vars ${pct(b.vars)} · structures ${pct(b.structures)} · theme ${pct(b.theme)} · meta ${pct(b.meta)}`,
      );
      console.log(`  built kinds:  [${r.detail.builtKinds.join(', ')}]`);
      console.log(`  golden kinds: [${r.detail.goldenKinds.join(', ')}]`);
      if (lastSteps) {
        console.log(`  per-rung score: ${lastSteps.map((s) => pct(s.score)).join(' → ')}`);
        if (outDir) console.log(`  snapshots → ${outDir}/`);
      }
    } else if (!asJson) {
      // ── N>1: the run-distribution block ──
      const a = aggs[aggs.length - 1]!;
      const tag = incremental ? `${provider}, incremental` : provider;
      console.log(`\n=== ${id}  (${tag}, ${prompts.length} prompt${prompts.length === 1 ? '' : 's'}) — ${runs} runs ===`);
      console.log(`  overall: mean ${pct(a.mean)}  σ ${(a.stdev * 100).toFixed(2)}pp  min ${pct(a.min)}  max ${pct(a.max)}`);
      const b = a.facets;
      console.log(
        `  facet means: panelKinds ${pct(b.panelKinds)} · nesting ${pct(b.nesting)} · vars ${pct(b.vars)} · structures ${pct(b.structures)} · theme ${pct(b.theme)} · meta ${pct(b.meta)}`,
      );
      console.log(`  per-run: ${a.scores.map((s) => pct(s)).join(' · ')}`);
      console.log(`  golden kinds: [${a.last.detail.goldenKinds.join(', ')}]`);
    }
  }

  // ── output: JSON (machine) or the summary/runs table (human) ──
  if (asJson) {
    if (runs === 1) {
      // preserve the ORIGINAL json shape exactly for the default single-run path
      const results = aggs.map((a) => ({ id: a.id, score: a.last.score, breakdown: a.last.breakdown, steps: a.lastSteps }));
      console.log(JSON.stringify({ provider, results }, null, 2));
    } else {
      const results = aggs.map((a) => ({
        id: a.id,
        mean: a.mean,
        stdev: a.stdev,
        min: a.min,
        max: a.max,
        facetMeans: a.facets,
        scores: a.scores,
      }));
      console.log(JSON.stringify({ provider, runs, results }, null, 2));
    }
  } else if (runs === 1) {
    const avg = mean(aggs.map((a) => a.mean));
    console.log('\n──────────────────────────────────────────────');
    console.log(`SUMMARY (${provider}):  ${aggs.map((a) => `${a.id} ${pct(a.mean)}`).join('  ·  ')}`);
    console.log(`average: ${pct(avg)}`);
  } else {
    const rows = aggs.map((a) => [a.id, String(runs), pct(a.mean), (a.stdev * 100).toFixed(2), pct(a.min), pct(a.max)]);
    console.log('\n──────────────────────────────────────────────');
    console.log(`RUNS SUMMARY (${provider}, ${runs}× each):`);
    console.log(renderTable(['app', 'runs', 'mean', 'σ(pp)', 'min', 'max'], rows));
    console.log(`\naverage mean: ${pct(mean(aggs.map((a) => a.mean)))}`);
  }

  // ── snapshot the current means as a baseline (for future gating) ──
  if (writeBaseline) {
    const baseline: Record<string, number> = {};
    for (const a of aggs) baseline[a.id] = Number(a.mean.toFixed(4));
    await writeFile(writeBaseline, JSON.stringify(baseline, null, 2) + '\n');
    console.log(`\nbaseline written → ${writeBaseline}  (${aggs.length} app${aggs.length === 1 ? '' : 's'}, ${runs}× means)`);
  }

  // ── regression gate: FAIL if any app's mean falls below its baseline (minus tolerance) ──
  if (gateFile) {
    let baseline: Record<string, number>;
    try {
      baseline = JSON.parse(await readFile(gateFile, 'utf8')) as Record<string, number>;
    } catch (e) {
      console.error(`\nGATE ERROR: cannot read baseline "${gateFile}": ${String((e as { message?: string })?.message ?? e)}`);
      process.exit(1);
    }
    console.log(`\n── GATE (baseline ${gateFile}, tolerance ${GATE_TOLERANCE}) ──`);
    let failed = false;
    for (const a of aggs) {
      const floor = baseline[a.id];
      if (typeof floor !== 'number') {
        console.log(`  SKIP ${a.id}: no baseline entry`);
        continue;
      }
      if (a.mean < floor - GATE_TOLERANCE) {
        console.log(`  FAIL ${a.id}: mean ${pct(a.mean)} < baseline ${pct(floor)} − ${GATE_TOLERANCE} tol`);
        failed = true;
      } else {
        console.log(`  PASS ${a.id}: mean ${pct(a.mean)} ≥ baseline ${pct(floor)} − ${GATE_TOLERANCE} tol`);
      }
    }
    console.log(failed ? 'GATE: FAIL' : 'GATE: PASS');
    process.exit(failed ? 1 : 0);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
