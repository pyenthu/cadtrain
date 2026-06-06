/**
 * /api/vocab/promote-proposed — lift a docs/parts/proposed-vocab-entries.json
 * entry into the curated vocabulary.json AND save its baked exemplar source
 * to the volume.
 *
 *   POST /api/vocab/promote-proposed?term=mule_shoe
 *     → { ok, term, vocab_path, exemplar, exemplar_saved, seed_marked }
 *
 * What lands:
 *   1. vocabulary.json gains a `terms.<term>` entry — full proposal copied
 *      verbatim minus the kind:'asm' chrome (it's already there). Bumps
 *      vocabulary.version patch.
 *   2. The volume gets the proposal-translator output as
 *      `basic/dt_<term>.prim.ts` (via /api/primitives/save), so the curated
 *      term has a runnable exemplar matching `meta.exemplar`.
 *   3. The matching seed in vocabulary.seeds.json is flipped to
 *      `status: 'promoted'` so the /vocab browser still shows it but the
 *      term browser knows it has graduated. (Source of truth for the
 *      promoted term is now vocabulary.json.)
 *
 * Atomic writes: temp + rename per Rule 4.
 */
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { json, error } from '@sveltejs/kit';
import { translateProposed, type ProposedEntry } from '$lib/authoring/proposal-translator';
import type { RequestHandler } from './$types';

const VOCAB_PATH = resolve(process.cwd(), 'docs/parts/vocabulary.json');
const SEEDS_PATH = resolve(process.cwd(), 'docs/parts/vocabulary.seeds.json');
const PROPOSED_PATH = resolve(process.cwd(), 'docs/parts/proposed-vocab-entries.json');

function atomicWriteJSON(path: string, obj: any) {
  const tmp = path + '.tmp';
  writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  renameSync(tmp, path);
}

function bumpPatch(version: string): string {
  const parts = version.split('.').map((n) => Number(n));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return version;
  parts[2] = (parts[2] ?? 0) + 1;
  return parts.join('.');
}

export const POST: RequestHandler = async ({ url, fetch: localFetch }) => {
  const term = url.searchParams.get('term');
  if (!term) throw error(400, 'pass ?term=<slug>');

  // 1. Load the proposed entry.
  if (!existsSync(PROPOSED_PATH)) throw error(500, 'proposed-vocab-entries.json missing');
  const proposed = JSON.parse(readFileSync(PROPOSED_PATH, 'utf8')) as { entries: Record<string, ProposedEntry> };
  const entry = proposed.entries?.[term];
  if (!entry) throw error(404, `no proposed entry for term: ${term}`);

  // 2. Load + update vocabulary.json.
  if (!existsSync(VOCAB_PATH)) throw error(500, 'vocabulary.json missing');
  const vocab = JSON.parse(readFileSync(VOCAB_PATH, 'utf8')) as { version: string; terms: Record<string, any> };
  const newVersion = bumpPatch(vocab.version ?? '0.3.0');
  vocab.version = newVersion;
  // Direct copy — the proposal already carries the full rule + params + tags.
  // We add an exemplar field (the dt_<term> source the bake saved below).
  const exemplarId = entry.exemplar ?? `dt_${term}`;
  vocab.terms[term] = {
    ...entry,
    promoted_at: new Date().toISOString().slice(0, 19) + 'Z',
    source: 'proposed-vocab-entries.json',
  };
  atomicWriteJSON(VOCAB_PATH, vocab);

  // 3. Translate + save the exemplar to the volume.
  let exemplarSaved = false;
  let saveErr: string | undefined;
  try {
    const source = translateProposed(term, entry);
    // The translator names the function with `_proposed` suffix; promotion
    // saves it under the cleaner exemplar id matching vocabulary.json.
    const sourceForSave = source.replace(
      new RegExp(`dt_${term}_proposed`, 'g'),
      exemplarId,
    );
    const resp = await localFetch('/api/primitives/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: exemplarId,
        source: sourceForSave,
        kind: entry.kind ?? 'asm',
        dir: 'basic',
      }),
    });
    if (!resp.ok) {
      saveErr = `${resp.status}: ${(await resp.text()).slice(0, 200)}`;
    } else {
      exemplarSaved = true;
    }
  } catch (e: any) {
    saveErr = e?.message ?? String(e);
  }

  // 4. Flip the seed's status (if it exists).
  let seedMarked = false;
  if (existsSync(SEEDS_PATH)) {
    const seeds = JSON.parse(readFileSync(SEEDS_PATH, 'utf8')) as { terms: Record<string, any>; stats?: any };
    if (seeds.terms?.[term]) {
      seeds.terms[term].status = 'promoted';
      seeds.terms[term].promoted_to_vocabulary_at = new Date().toISOString().slice(0, 19) + 'Z';
      seeds.stats = seeds.stats ?? {};
      seeds.stats.promoted = Object.values(seeds.terms).filter((t: any) => t?.status === 'promoted').length;
      atomicWriteJSON(SEEDS_PATH, seeds);
      seedMarked = true;
    }
  }

  return json({
    ok: true,
    term,
    vocab_path: 'docs/parts/vocabulary.json',
    new_vocab_version: newVersion,
    exemplar: exemplarId,
    exemplar_saved: exemplarSaved,
    ...(saveErr ? { exemplar_save_error: saveErr } : {}),
    seed_marked: seedMarked,
  });
};
