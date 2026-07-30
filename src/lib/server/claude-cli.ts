// src/lib/server/claude-cli.ts — spawn the `claude` CLI (`claude --print`) as a subprocess.
// This bills the Max/Pro SUBSCRIPTION (flat), NOT the metered ANTHROPIC_API_KEY — subscription
// billing works ONLY through the CLI subprocess, never the SDK (memory subscription_via_cli_subprocess).
// DEV-ONLY: Railway has no `claude` binary. The missing half of the dual-backend pattern
// (src/lib/shared/CLAUDE.md); consumed by /api/app/generate when APP_BUILD_PROVIDER=cli.
import { spawn } from 'node:child_process';

export interface ClaudeCliOpts {
  /** CLI model alias/name — 'opus' | 'sonnet' | 'haiku' | a full id. Omit → the CLI default. */
  model?: string;
  timeoutMs?: number;
}

/** Run one `claude --print` turn. The full prompt (system + request) is piped via stdin;
 *  returns the model's text output (the `result` field of the JSON envelope). Rejects on
 *  spawn failure (CLI missing / not logged in), non-zero exit, or timeout. */
export function runClaudeCli(prompt: string, opts: ClaudeCliOpts = {}): Promise<string> {
  const { model, timeoutMs = 180_000 } = opts;
  const args = ['--print', '--output-format', 'json'];
  if (model) args.push('--model', model);

  return new Promise((resolve, reject) => {
    let cp: ReturnType<typeof spawn>;
    try {
      cp = spawn('claude', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      return reject(new Error(`claude CLI spawn failed: ${String((e as { message?: string })?.message ?? e)} — is the CLI installed + logged in?`));
    }
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      cp.kill('SIGKILL');
      reject(new Error(`claude CLI timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    cp.stdout?.on('data', (d) => (out += d));
    cp.stderr?.on('data', (d) => (err += d));
    cp.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`claude CLI error: ${e.message} — is the CLI installed + logged in?`));
    });
    cp.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`claude CLI exited ${code}: ${err.slice(0, 500)}`));
      try {
        const envlp = JSON.parse(out) as { result?: string; text?: string };
        resolve(String(envlp.result ?? envlp.text ?? out));
      } catch {
        resolve(out); // not JSON (unexpected) — hand back the raw text
      }
    });

    cp.stdin?.write(prompt);
    cp.stdin?.end();
  });
}
