import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fsCorpusStore, type BuildRecord } from './app-corpus-store';

describe('fsCorpusStore round-trip', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'app-rag-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('appends + loads build records', async () => {
    const store = fsCorpusStore(dir, 'test');
    const rec: BuildRecord = { ts: 1, prompt: 'a well app', steps: 3, app: { app: 'w', panels: [{ id: 'l', kind: 'list' }] } };
    await store.appendBuild(rec);
    await store.appendBuild({ ...rec, ts: 2, prompt: 'a parts app' });
    const loaded = await store.loadBuilds();
    expect(loaded).toHaveLength(2);
    expect(loaded[0].prompt).toBe('a well app');
  });

  it('saves + loads golden pairs (MD key + .app target)', async () => {
    const store = fsCorpusStore(dir, 'test');
    await store.saveGolden('well designer', '# Well designer\nList of casings + a 3D bake.', {
      app: 'well',
      panels: [{ id: 'l', kind: 'list' }],
    });
    const golden = await store.loadGolden();
    expect(golden).toHaveLength(1);
    expect(golden[0].name).toBe('well_designer');
    expect(golden[0].md).toContain('casings');
    expect((golden[0].app as any).panels[0].kind).toBe('list');
  });

  it('empty store → empty arrays (never throws)', async () => {
    const store = fsCorpusStore(join(dir, 'nope'), 'test');
    expect(await store.loadBuilds()).toEqual([]);
    expect(await store.loadGolden()).toEqual([]);
  });
});
