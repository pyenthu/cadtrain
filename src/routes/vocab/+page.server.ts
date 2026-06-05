/**
 * Server-side loader for /vocab — reads the three vocabulary artefacts off
 * disk (they live in docs/parts/ not static/) and returns them to the page.
 * `prerender = false` because the disk content can change without a rebuild.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PageServerLoad } from './$types';

export const prerender = false;

function safeRead(path: string): string | null {
  try { return existsSync(path) ? readFileSync(path, 'utf8') : null; }
  catch { return null; }
}

export const load: PageServerLoad = async () => {
  const root = resolve(process.cwd());
  const vocabRaw = safeRead(resolve(root, 'docs/parts/vocabulary.json'));
  const lockRaw  = safeRead(resolve(root, 'docs/parts/vocabulary.lock.json'));
  const mmd      = safeRead(resolve(root, 'docs/parts/vocabulary-graph.mmd'));
  return {
    vocab: vocabRaw ? JSON.parse(vocabRaw) : null,
    lock:  lockRaw  ? JSON.parse(lockRaw)  : null,
    mmd:   mmd ?? null,
  };
};
