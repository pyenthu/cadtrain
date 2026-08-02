// scripts/eval-app-build.ts — the HEADLESS app-build eval harness (docs/plans/app-build-eval.md).
//
// Measures how well a provider reproduces our GOLDEN .app builds from the natural-language prompt
// scripts. For each app it: loads the golden .app + its ordered prompts, replays the prompts
// through `buildAppViaCli` (the same emit-verbs→parse→dispatch path the CLI + in-browser Phi use),
// and prints `scoreApp(built, golden)` — a 0..1 structural similarity + per-facet breakdown.
//
//   bun run scripts/eval-app-build.ts                    # FAKE oracle runner, all 3 apps (CI-safe)
//   bun run scripts/eval-app-build.ts --app plan         # one app
//   bun run scripts/eval-app-build.ts --json             # machine-readable output
//   bun run scripts/eval-app-build.ts --provider cli --app plan   # ONE real `claude --print` run
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
import { scoreApp, preorderKinds, type AppLike } from '../src/lib/appkit/ai/score-app';
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

/** ONE real `claude --print` turn: the whole script is concatenated into a single request so the
 *  eval costs at most one subscription-billed call (never a per-prompt loop). */
async function runCli(id: AppId, prompts: string[], model?: string): Promise<AppLike> {
  const app: AppLike = { app: id, panels: [] };
  const combined = prompts.map((p, i) => `${i + 1}. ${p}`).join('\n');
  const runner: CliRunner = (full, opts) => runClaudeCli(full, { model: opts.model });
  await buildAppViaCli({ prompt: combined, app: app as any, grounding: '', model }, runner);
  return app;
}

/** The TRUE incremental CLI reference: one `claude --print` call PER prompt, forwarding the app.
 *  Costs N subscription calls per app (never the metered key) — the faithful atomic-build test. */
async function runCliIncremental(
  id: AppId,
  prompts: string[],
  golden: AppLike,
  opts: { model?: string; ground?: (prompt: string, app: AppLike) => Promise<string>; outDir?: string },
): Promise<{ app: AppLike; steps: StepRec[] }> {
  const runner: CliRunner = (full, o) => runClaudeCli(full, { model: o.model });
  return replayIncremental(id, prompts, runner, golden, opts);
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
        // pass docType so the headless eval exercises the SAME docType-scoped retrieval (#49) as the real path
        body: JSON.stringify({ prompt, docType: (app as { docType?: string })?.docType }),
      });
      return r.ok ? (((await r.json()) as { grounding?: string }).grounding ?? '') : '';
    } catch {
      return '';
    }
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const provider = (flag('--provider') ?? 'fake') as 'fake' | 'cli';
  const model = flag('--model');
  const asJson = argv.includes('--json');
  const incremental = argv.includes('--incremental'); // one model call PER prompt + per-rung snapshots
  const doGround = argv.includes('--ground'); // fetch RAG grounding per prompt (needs a dev server)
  const only = flag('--app');
  const scoreFile = flag('--score-file'); // score an ALREADY-BUILT .app (e.g. a browser capture) vs the golden
  const ids = (only && only !== 'all' ? [only] : APPS).filter((a): a is AppId => (APPS as readonly string[]).includes(a));
  if (!ids.length) {
    console.error(`unknown app "${only}" — choose one of: ${APPS.join(', ')} (or "all")`);
    process.exit(1);
  }

  const results: Array<{ id: string; score: number; breakdown: Record<string, number>; steps?: StepRec[] }> = [];

  for (const id of ids) {
    const golden = await loadGolden(id);
    const prompts = EVAL_PROMPTS[id] ?? [];
    const outDir = incremental ? join(FIX, 'runs', `${id}-${provider}${doGround ? '-ground' : ''}`) : undefined;

    let built: AppLike;
    let stepRecs: StepRec[] | undefined;
    if (scoreFile) {
      built = JSON.parse(await readFile(scoreFile, 'utf8')) as AppLike; // score a captured build (browser/local) vs the golden
    } else if (provider === 'cli' && incremental) {
      const res = await runCliIncremental(id, prompts, golden, { model, outDir, ground: doGround ? makeGrounder() : undefined });
      built = res.app;
      stepRecs = res.steps;
    } else if (provider === 'cli') {
      built = await runCli(id, prompts, model);
    } else {
      const res = await runFake(id, prompts, golden, outDir);
      built = res.app;
      stepRecs = res.steps;
    }
    const r = scoreApp(built, golden);
    results.push({ id, score: r.score, breakdown: r.breakdown as unknown as Record<string, number>, steps: stepRecs });

    if (!asJson) {
      const tag = incremental ? `${provider}, incremental` : provider;
      console.log(`\n=== ${id}  (${tag}, ${prompts.length} prompt${prompts.length === 1 ? '' : 's'}) ===`);
      console.log(`  score: ${pct(r.score)}`);
      const b = r.breakdown;
      console.log(
        `  facets: panelKinds ${pct(b.panelKinds)} · nesting ${pct(b.nesting)} · vars ${pct(b.vars)} · structures ${pct(b.structures)} · theme ${pct(b.theme)} · meta ${pct(b.meta)}`,
      );
      console.log(`  built kinds:  [${r.detail.builtKinds.join(', ')}]`);
      console.log(`  golden kinds: [${r.detail.goldenKinds.join(', ')}]`);
      if (stepRecs) {
        console.log(`  per-rung score: ${stepRecs.map((s) => pct(s.score)).join(' → ')}`);
        if (outDir) console.log(`  snapshots → ${outDir}/`);
      }
    }
  }

  if (asJson) {
    console.log(JSON.stringify({ provider, results }, null, 2));
  } else {
    const avg = results.reduce((s, r) => s + r.score, 0) / Math.max(1, results.length);
    console.log('\n──────────────────────────────────────────────');
    console.log(`SUMMARY (${provider}):  ${results.map((r) => `${r.id} ${pct(r.score)}`).join('  ·  ')}`);
    console.log(`average: ${pct(avg)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
