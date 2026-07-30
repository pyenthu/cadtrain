// src/lib/appkit/ai/build-cli.ts — the CLI build path (provider 'cli').
// The `claude --print` subprocess CANNOT run our tool `execute` callbacks (no native
// tool-loop), so instead the model EMITS a JSON array of {verb,args} calls and we dispatch
// each ourselves. Reuses the SAME systemPrompt + verb registry + trace as the AI-SDK path
// (pipeline.ts) — only the model transport differs. HEADLESS: the subprocess runner is
// INJECTED (this module imports no node), so appkit stays pure + testable.
import { verbsByGroup, type Ctx } from '../verbs/registry';
import { dispatch } from '../verbs/dispatch';
import { systemPrompt, type BuildOpts, type BuildResult, type VerbCall } from './pipeline';
import { sanitizeApp } from './sanitize';

/** Injected transport: run one turn, return the model's raw text. Server supplies the
 *  `claude --print` spawn (src/lib/server/claude-cli.ts); tests supply a fake. */
export type CliRunner = (prompt: string, opts: { model?: string }) => Promise<string>;

/** Build the .app by asking the CLI model to emit a verb-list, then dispatching it. */
export async function buildAppViaCli(opts: BuildOpts, run: CliRunner): Promise<BuildResult> {
  const { prompt, app, grounding = '', model } = opts;
  const guiNames = verbsByGroup('gui').map((v) => v.name);
  const emit = [
    '',
    'OUTPUT FORMAT: respond with ONLY a JSON array of gui-verb calls that build the app —',
    'no prose, no markdown fences, no explanation. Each element is',
    `{"verb": "<one of: ${guiNames.join(', ')}>", "args": { ... }}.`,
    'They run in order and mutate the app in place. Example:',
    '[{"verb":"definePanel","args":{"panel":{"id":"t","kind":"text","props":{"text":"Hi","color":"red"}}}}]',
  ].join('\n');
  const full = `${systemPrompt(app, grounding)}\n\n=== REQUEST ===\n${prompt}\n${emit}`;

  const raw = await run(full, { model });
  const calls = parseVerbCalls(raw);

  const ctx: Ctx = { appStore: app };
  const trace: VerbCall[] = [];
  for (const c of calls) {
    if (!guiNames.includes(c.verb)) {
      trace.push({ verb: c.verb, args: c.args, ok: false, error: 'not a callable gui verb' });
      continue;
    }
    try {
      await dispatch(c.verb, c.args, ctx);
      trace.push({ verb: c.verb, args: c.args, ok: true });
    } catch (e) {
      trace.push({ verb: c.verb, args: c.args, ok: false, error: String((e as { message?: string })?.message ?? e) });
    }
  }
  sanitizeApp(app); // parity with the AI-SDK path — drop any hallucinated-verb bindings
  return { app, steps: trace.length, text: '', trace, raw };
}

/** Pull the JSON verb array out of the model's text, tolerating ```fences``` + surrounding
 *  prose. Pure → unit-testable without spawning anything. */
export function parseVerbCalls(raw: string): Array<{ verb: string; args: unknown }> {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((x): x is { verb: string; args?: unknown } => !!x && typeof (x as { verb?: unknown }).verb === 'string')
    .map((x) => ({ verb: x.verb, args: x.args ?? {} }));
}
