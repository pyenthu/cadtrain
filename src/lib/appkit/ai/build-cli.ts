// src/lib/appkit/ai/build-cli.ts — the CLI build path (provider 'cli').
// The `claude --print` subprocess CANNOT run our tool `execute` callbacks (no native
// tool-loop), so instead the model EMITS a JSON array of {verb,args} calls and we dispatch
// each ourselves. Reuses the SAME systemPrompt + verb registry + trace as the AI-SDK path
// (pipeline.ts) — only the model transport differs. HEADLESS: the subprocess runner is
// INJECTED (this module imports no node), so appkit stays pure + testable.
import { verbsByGroup, type Ctx } from '../verbs/registry';
import { dispatch } from '../verbs/dispatch';
import { systemPrompt, emitInstruction, parseVerbCalls } from './prompt';
import { sanitizeApp } from './sanitize';
import type { BuildOpts, BuildResult, VerbCall } from './pipeline';

// Re-export so existing importers (build-cli.test.ts) keep working after the extraction.
export { parseVerbCalls } from './prompt';

/** Injected transport: run one turn, return the model's raw text. Server supplies the
 *  `claude --print` spawn (src/lib/server/claude-cli.ts); tests supply a fake. */
export type CliRunner = (prompt: string, opts: { model?: string }) => Promise<string>;

/** Build the .app by asking the CLI model to emit a verb-list, then dispatching it. */
export async function buildAppViaCli(opts: BuildOpts, run: CliRunner): Promise<BuildResult> {
  const { prompt, app, grounding = '', model } = opts;
  const guiNames = verbsByGroup('gui').map((v) => v.name);
  const full = `${systemPrompt(app, grounding, prompt)}\n\n=== REQUEST ===\n${prompt}\n${emitInstruction()}`;

  const raw = await run(full, { model });
  const calls = parseVerbCalls(raw);

  const ctx: Ctx = { appStore: app };
  const trace: VerbCall[] = [];
  for (const c of calls) {
    // Snapshot BEFORE dispatch. The gui verbs mutate c.args IN PLACE (definePanel pushes
    // a.panel itself into app.panels, then promote() rewrites its props to $vars refs) and
    // sanitizeApp() below deletes through that same alias — so storing the reference would
    // record post-mutation state, not what the model emitted. Args are JSON ⇒ cloneable.
    const emitted = structuredClone(c.args);
    if (!guiNames.includes(c.verb)) {
      trace.push({ verb: c.verb, args: emitted, ok: false, error: 'not a callable gui verb' });
      continue;
    }
    try {
      await dispatch(c.verb, c.args, ctx);
      trace.push({ verb: c.verb, args: emitted, ok: true });
    } catch (e) {
      trace.push({ verb: c.verb, args: emitted, ok: false, error: String((e as { message?: string })?.message ?? e) });
    }
  }
  sanitizeApp(app); // parity with the AI-SDK path — drop any hallucinated-verb bindings
  return { app, steps: trace.length, text: '', trace, raw };
}
