/**
 * _lib.ts — shared helpers for the DEV-ONLY /api/design/* diagram + graphify
 * endpoints. Underscore prefix → SvelteKit never treats this as a route.
 *
 * These endpoints spawn FIXED local commands (no user-supplied args → no shell
 * injection) via node child_process and are gated on `dev` (403 in prod). They
 * run LOCALLY like /preview — they are NOT added to any prod proxy path list.
 *
 * NB Rule 1 ("never add Python to the runtime") is respected: the prod
 * container never has graphify/python and these endpoints 403 in prod. Here we
 * merely SHELL OUT to the developer's already-installed `graphify` env — the
 * same pattern as /api/__dev_restart spawning bash. The graphify pass we run is
 * the DETERMINISTIC tree-sitter AST pipeline (scripts/graphify-code.py), which
 * costs ZERO Anthropic/Claude tokens — the /graphify SKILL's semantic pass is
 * never invoked.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Hardcoded fallback per the verified wellvision env. */
const WELLVISION_PY = '/Users/neerajsethi/miniconda3/envs/wellvision/bin/python';

export interface ExecResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Promisified execFile with a fixed argv (never a shell string). */
export function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      {
        cwd: opts.cwd ?? process.cwd(),
        timeout: opts.timeoutMs ?? 120_000,
        maxBuffer: 32 * 1024 * 1024,
        // Ensure common bin dirs (bun, conda) are on PATH under the dev server.
        env: { ...process.env },
      },
      (err, stdout, stderr) => {
        resolve({
          ok: !err,
          code: (err as NodeJS.ErrnoException & { code?: number })?.code ?? 0,
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
        });
      },
    );
  });
}

/** Try `which X`; return the resolved absolute path or null. */
async function which(bin: string): Promise<string | null> {
  const r = await run('which', [bin], { timeoutMs: 5_000 });
  const p = r.stdout.trim().split('\n')[0]?.trim();
  return r.ok && p && existsSync(p) ? p : null;
}

/**
 * Resolve a Python interpreter that has `graphify` importable.
 *
 * Strategy: locate the `graphify` CLI via `which graphify`, then use the
 * sibling `python` in the same bin dir (a console-script always lives next to
 * its interpreter). Fall back to the verified wellvision python. Returns null
 * if nothing usable is found → caller returns a clean "not installed".
 */
export async function resolveGraphifyPython(): Promise<string | null> {
  const cli = await which('graphify');
  if (cli) {
    const py = join(dirname(cli), 'python');
    if (existsSync(py)) return py;
    const py3 = join(dirname(cli), 'python3');
    if (existsSync(py3)) return py3;
  }
  if (existsSync(WELLVISION_PY)) return WELLVISION_PY;
  return null;
}

/** Last N non-empty lines of a blob (for compact stdout reporting). */
export function tailLines(s: string, n = 10): string {
  return s
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .slice(-n)
    .join('\n');
}
