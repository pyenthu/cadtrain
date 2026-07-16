/**
 * well-samples.test.ts — headless coverage for the on-volume WSON sample store
 * (`well-samples.ts`).
 *
 * Isolation: every I/O test writes to a fresh `os.tmpdir()` dir via the `{ dir }`
 * override — the shared `.dev-volume` / prod volume is NEVER touched (subagent
 * constraint, mirrors training-log.test.ts). Name-safety tests are pure.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isValidSampleName,
  bundledSamples,
  listWellSamples,
  readWellSample,
  writeWellSample,
  deleteWellSample,
  seedIfEmpty,
  WELLS_SAMPLES_REL,
} from './well-samples';

const tmpDirs: string[] = [];
async function tmpDir(): Promise<string> {
  // A NESTED path so we also exercise the mkdir-recursive branch on write.
  const base = await mkdtemp(join(tmpdir(), 'cadtrain-wsamp-'));
  tmpDirs.push(base);
  return join(base, 'wells', 'samples');
}
afterEach(async () => {
  while (tmpDirs.length) {
    const d = tmpDirs.pop()!;
    await rm(d, { recursive: true, force: true }).catch(() => {});
  }
});

// ── name safety ───────────────────────────────────────────────────────────────

describe('isValidSampleName — rejects traversal / non-.wson', () => {
  it('accepts a bare <stem>.wson', () => {
    expect(isValidSampleName('01-vertical-land-producer.wson')).toBe(true);
    expect(isValidSampleName('a.wson')).toBe(true);
    expect(isValidSampleName('my_field.A.wson')).toBe(true);
  });
  it('rejects path separators, traversal, and wrong/no extension', () => {
    for (const bad of [
      '', '..', '.wson', 'x.txt', 'x', 'a/b.wson', 'a\\b.wson', '../x.wson',
      'a..b.wson', '/etc/passwd', 'x.wson.txt', '.hidden.wson',
    ]) {
      expect(isValidSampleName(bad)).toBe(false);
    }
  });
});

// ── seed contract ─────────────────────────────────────────────────────────────

describe('WELLS_SAMPLES_REL + bundledSamples', () => {
  it('targets wells/samples and exposes ≥1 bundled seed', () => {
    expect(WELLS_SAMPLES_REL).toBe('wells/samples');
    const seeds = bundledSamples();
    expect(seeds.length).toBeGreaterThan(0);
    expect(seeds.every((s) => /\.wson$/i.test(s.name) && typeof s.text === 'string')).toBe(true);
    // sorted by name
    const names = seeds.map((s) => s.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
});

// ── seedIfEmpty ───────────────────────────────────────────────────────────────

describe('seedIfEmpty', () => {
  it('populates an empty dir from the bundled set, then is idempotent', async () => {
    const dir = await tmpDir();
    const seedCount = bundledSamples().length;

    const first = await seedIfEmpty({ dir });
    expect(first.seeded).toBe(seedCount);
    expect(first.existing).toBe(0);

    const listed = await listWellSamples({ dir });
    expect(listed.length).toBe(seedCount);

    // Second call is a no-op (dir non-empty) — never clobbers user edits.
    const second = await seedIfEmpty({ dir });
    expect(second.seeded).toBe(0);
    expect(second.existing).toBe(seedCount);
  });

  it('does not re-seed when the dir already has at least one .wson', async () => {
    const dir = await tmpDir();
    await writeWellSample('mine.wson', '{"meta":{"wellName":"Mine"}}', { dir });
    const res = await seedIfEmpty({ dir });
    expect(res.seeded).toBe(0);
    const listed = await listWellSamples({ dir });
    expect(listed.map((f) => f.name)).toEqual(['mine.wson']);
  });
});

// ── list / read / write / delete roundtrip ────────────────────────────────────

describe('write / list / read / delete roundtrip', () => {
  it('missing dir lists as [] and a missing file reads as null', async () => {
    const dir = await tmpDir();
    expect(await listWellSamples({ dir })).toEqual([]);
    expect(await readWellSample('nope.wson', { dir })).toBeNull();
  });

  it('writes atomically (no .tmp left behind) and round-trips text + metadata', async () => {
    const dir = await tmpDir();
    const text = '{"meta":{"wellName":"Round Trip"},"ch":[]}';
    const saved = await writeWellSample('rt.wson', text, { dir });
    expect(saved).toMatchObject({ name: 'rt.wson', slug: 'rt', text });
    expect(saved.size).toBe(Buffer.byteLength(text));

    expect(await readWellSample('rt.wson', { dir })).toBe(text);

    // The atomic temp file must not survive a successful write.
    const onDisk = await readdir(dir);
    expect(onDisk).toContain('rt.wson');
    expect(onDisk.some((n) => n.endsWith('.tmp'))).toBe(false);

    // list returns slug + byte size, sorted by name.
    await writeWellSample('aa.wson', '{}', { dir });
    const listed = await listWellSamples({ dir });
    expect(listed.map((f) => f.name)).toEqual(['aa.wson', 'rt.wson']);
    expect(listed.find((f) => f.name === 'rt.wson')!.size).toBe(Buffer.byteLength(text));
    // on-disk contents match what was written
    expect(await readFile(join(dir, 'rt.wson'), 'utf8')).toBe(text);
  });

  it('overwrites in place (edit an existing sample)', async () => {
    const dir = await tmpDir();
    await writeWellSample('e.wson', '{"v":1}', { dir });
    await writeWellSample('e.wson', '{"v":2}', { dir });
    expect(await readWellSample('e.wson', { dir })).toBe('{"v":2}');
    expect((await listWellSamples({ dir })).length).toBe(1);
  });

  it('deletes a sample (true), reports false for an absent one', async () => {
    const dir = await tmpDir();
    await writeWellSample('d.wson', '{}', { dir });
    expect(await deleteWellSample('d.wson', { dir })).toBe(true);
    expect(await readWellSample('d.wson', { dir })).toBeNull();
    expect(await deleteWellSample('d.wson', { dir })).toBe(false);
  });

  it('rejects unsafe names on write / read / delete', async () => {
    const dir = await tmpDir();
    await expect(writeWellSample('../escape.wson', '{}', { dir })).rejects.toThrow();
    await expect(readWellSample('a/b.wson', { dir })).rejects.toThrow();
    await expect(deleteWellSample('x.txt', { dir })).rejects.toThrow();
  });
});
