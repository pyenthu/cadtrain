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
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAppViaCli, type CliRunner } from '../src/lib/appkit/ai/build-cli';
import { scoreApp, type AppLike } from '../src/lib/appkit/ai/score-app';
import { runClaudeCli } from '../src/lib/server/claude-cli';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, 'eval-fixtures');
const APPS = ['plan', 'design', 'ewell'] as const;
type AppId = (typeof APPS)[number];

// ── fixtures ─────────────────────────────────────────────────────────────────────────────────
async function loadPrompts(): Promise<Record<string, string[]>> {
  return JSON.parse(await readFile(join(FIX, 'prompts.json'), 'utf8'));
}

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
async function runFake(id: AppId, prompts: string[], golden: AppLike): Promise<AppLike> {
  const app: AppLike = { app: id, panels: [] };
  const runner = makeOracleRunner(golden, prompts.length);
  for (const prompt of prompts) await buildAppViaCli({ prompt, app: app as any, grounding: '' }, runner);
  return app;
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

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
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
  const only = flag('--app');
  const ids = (only && only !== 'all' ? [only] : APPS).filter((a): a is AppId => (APPS as readonly string[]).includes(a));
  if (!ids.length) {
    console.error(`unknown app "${only}" — choose one of: ${APPS.join(', ')} (or "all")`);
    process.exit(1);
  }

  const prompts = await loadPrompts();
  const results: Array<{ id: string; score: number; breakdown: Record<string, number> }> = [];

  for (const id of ids) {
    const golden = await loadGolden(id);
    const steps = prompts[id] ?? [];
    const built = provider === 'cli' ? await runCli(id, steps, model) : await runFake(id, steps, golden);
    const r = scoreApp(built, golden);
    results.push({ id, score: r.score, breakdown: r.breakdown as unknown as Record<string, number> });

    if (!asJson) {
      console.log(`\n=== ${id}  (${provider}, ${steps.length} prompt${steps.length === 1 ? '' : 's'}) ===`);
      console.log(`  score: ${pct(r.score)}`);
      const b = r.breakdown;
      console.log(
        `  facets: panelKinds ${pct(b.panelKinds)} · nesting ${pct(b.nesting)} · vars ${pct(b.vars)} · structures ${pct(b.structures)} · theme ${pct(b.theme)} · meta ${pct(b.meta)}`,
      );
      console.log(`  built kinds:  [${r.detail.builtKinds.join(', ')}]`);
      console.log(`  golden kinds: [${r.detail.goldenKinds.join(', ')}]`);
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
