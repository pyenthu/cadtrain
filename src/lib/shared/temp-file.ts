/**
 * Temp-file lifecycle wrapper used by CLI backends — both wells and
 * identify need to write the upload buffer to disk so the `claude` CLI
 * can read it via --add-dir, then unlink afterwards.
 *
 * The directory is created via mkdtemp under tmpdir() so concurrent
 * requests don't collide. Cleanup is best-effort (errors swallowed) so
 * a failed unlink doesn't mask the actual operation result.
 */

import { writeFile, unlink, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface TempFileHandles {
  /** Path to the written file. */
  filePath: string;
  /** Containing temp directory (pass to claude --add-dir). */
  dir: string;
}

/**
 * Write `buffer` to a fresh temp file with the given extension, run `fn`
 * with the file handles, then unlink the file afterwards regardless of
 * whether `fn` threw.
 */
export async function withTempFile<T>(
  prefix: string,
  ext: string,
  buffer: Buffer,
  fn: (handles: TempFileHandles) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  const baseName = ext.startsWith('.') ? `upload${ext}` : `upload.${ext}`;
  const filePath = join(dir, baseName);
  await writeFile(filePath, buffer);

  try {
    return await fn({ filePath, dir });
  } finally {
    await unlink(filePath).catch(() => {});
  }
}
