/**
 * The /wells sample picker reads `wsonFiles`, built from an eager `?raw` glob.
 *
 * This exists because the glob silently resolves to `{}` when its path is wrong —
 * the picker just goes empty, with no error. It also pins the ONE-directory rule:
 * the route used to glob its own `./samples/` copy while the tests read
 * `src/lib/wells/samples/`, so a sample rung added for the tests never appeared in
 * the UI (TODO #42e). Both now name the same directory.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { wsonFiles, fileBySlug } from './wson-summary';

const SAMPLE_DIR = 'src/lib/wells/samples';

describe('wells sample picker — the glob resolves', () => {
  it('is not empty (a wrong glob path yields {} and an empty picker, silently)', () => {
    expect(wsonFiles.length).toBeGreaterThan(0);
  });

  it('surfaces EVERY .wson in src/lib/wells/samples — the single source of truth', () => {
    const onDisk = readdirSync(SAMPLE_DIR)
      .filter((f) => f.endsWith('.wson'))
      .map((f) => f.replace(/\.wson$/, ''))
      .sort();
    expect(wsonFiles.map((f) => f.slug).sort()).toEqual(onDisk);
  });

  it('includes the sample-ladder rungs, which the old two-glob split hid', () => {
    for (const slug of ['10-three-open-holes', '11-vertical-land-producer', '13-vertical-land-producer-deviated']) {
      expect(fileBySlug(slug), `${slug} missing from the /wells picker`).toBeTruthy();
    }
  });

  it('every listed sample parses', () => {
    for (const f of wsonFiles) expect(f.doc, `${f.slug} failed to parse`).toBeTruthy();
  });
});
