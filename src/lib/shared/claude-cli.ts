/**
 * Wraps the `claude --print` subprocess pattern. Both wells and identify
 * backends use this to call the local CLI for OAuth-billed inference.
 *
 * Three pieces:
 *   - buildClaudeCliArgs   — assemble the CLI argv
 *   - spawnClaudeCli       — run the subprocess, buffer stdout/stderr
 *   - parseCliEnvelope     — extract the assistant's text from
 *                             --output-format json envelope, with
 *                             optional code-fence stripping
 *
 * The `claude` binary must be on PATH and authenticated (claude auth
 * status → loggedIn=true). Subject to Pro/Max session-window rate limits.
 *
 * Memory: subscription billing only works through the CLI subprocess —
 * the Agent SDK does NOT bill against Pro/Max OAuth despite docs/intuition.
 */

import { spawn } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = 5 * 60_000;

export interface BuildClaudeCliArgsOpts {
  model: string;
  /** Directory to expose to the CLI for file reads (--add-dir). */
  addDir: string;
  systemPrompt: string;
  userPrompt: string;
}

/**
 * Assemble the standard --print argv used by both backends. Includes
 * --no-session-persistence and --permission-mode bypassPermissions so
 * the CLI runs non-interactively.
 */
export function buildClaudeCliArgs(opts: BuildClaudeCliArgsOpts): string[] {
  return [
    '--print',
    '--output-format', 'json',
    '--model', opts.model,
    '--add-dir', opts.addDir,
    '--no-session-persistence',
    '--permission-mode', 'bypassPermissions',
    '--append-system-prompt', opts.systemPrompt,
    opts.userPrompt,
  ];
}

export interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Spawn `claude` with the given args, buffer output, await exit. Throws
 * if the process emits an error event. Caller is responsible for
 * checking exitCode.
 */
export async function spawnClaudeCli(
  args: string[],
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<SpawnResult> {
  const proc = spawn('claude', args, {
    timeout: timeoutMs,
    env: { ...process.env, NO_COLOR: '1' },
  });

  let stdout = '';
  let stderr = '';
  proc.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
  proc.stderr.on('data', (d: Buffer) => (stderr += d.toString()));

  const exitCode = await new Promise<number>((resolve, reject) => {
    proc.on('exit', (code) => resolve(code ?? -1));
    proc.on('error', reject);
  });

  return { stdout, stderr, exitCode };
}

export interface ParseCliEnvelopeOpts {
  /** Strip ```json ... ``` fences if the model wrapped its output. */
  stripCodeFences?: boolean;
}

/**
 * Extract the assistant's text from the --output-format json envelope.
 *
 * Envelope shape: `{ type: 'result', result: '<assistant text>', ... }`
 *
 * Throws on malformed JSON or empty result. With stripCodeFences, also
 * unwraps a single ```json ... ``` block if the model emitted one
 * despite the system prompt.
 */
export function parseCliEnvelope(
  stdout: string,
  opts: ParseCliEnvelopeOpts = {},
): string {
  let envelope: { result?: string; subtype?: string } = {};
  try {
    envelope = JSON.parse(stdout);
  } catch (e) {
    throw new Error(
      `claude CLI returned non-JSON envelope: ${(e as Error).message}. raw: ${stdout.slice(0, 300)}`,
    );
  }
  let raw = (envelope.result ?? '').trim();
  if (!raw) {
    throw new Error(
      `claude CLI returned empty result. envelope: ${JSON.stringify(envelope).slice(0, 300)}`,
    );
  }

  if (opts.stripCodeFences && raw.includes('```')) {
    const start = raw.indexOf('```');
    const end = raw.lastIndexOf('```');
    if (end > start) {
      let body = raw.slice(start + 3, end).trim();
      if (body.startsWith('json')) body = body.slice(4).trim();
      raw = body;
    }
  }

  return raw;
}
