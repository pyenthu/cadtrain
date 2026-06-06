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
  // K.69 — seed completions ingested from SVTC's comp_list.xlsx. Treated
  // separately from the curated v0.3 vocabulary; each seed gets a
  // status:'seed' chip in the browser + only the silhouette in Scene.
  const seedsRaw = safeRead(resolve(root, 'docs/parts/vocabulary.seeds.json'));
  // K.69 review-before-promote — hand-drafted rich entries the seeds will
  // become if approved. Keyed by term. Renders next to the inferred polygon
  // in /vocab Scene so the user can read every field before clicking Promote.
  const proposedRaw = safeRead(resolve(root, 'docs/parts/proposed-vocab-entries.json'));
  return {
    vocab: vocabRaw ? JSON.parse(vocabRaw) : null,
    lock:  lockRaw  ? JSON.parse(lockRaw)  : null,
    mmd:   mmd ?? null,
    seeds: seedsRaw ? JSON.parse(seedsRaw) : null,
    proposed: proposedRaw ? JSON.parse(proposedRaw) : null,
  };
};
