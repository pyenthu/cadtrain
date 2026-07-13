/**
 * training-log.test.ts — headless coverage for the on-volume training/correction
 * register (docs/plans/chat-to-wells-ai.md Phase 1).
 *
 * Isolation: every I/O test writes to a fresh `os.tmpdir()` file via the
 * `filePath` override — the shared `.dev-volume` / prod volume is NEVER touched
 * (subagent constraint). The pure `diffWell` / `summarizeWellDiff` need no FS.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendRecord,
  listRecords,
  countRecords,
  diffWell,
  summarizeWellDiff,
  buildWellEditRecord,
  defaultPathForKind,
  defaultLogPath,
  defaultFailuresPath,
  FAILURES_REL,
  TRAINING_LOG_REL,
  type WellJson,
} from './training-log';

describe('failures register — wrongResponse routes to its own file (#SVTC unresolved split)', () => {
  it('defaultPathForKind sends failures to ai/failures.jsonl, everything else to the log', () => {
    expect(defaultPathForKind('wrongResponse')).toBe(defaultFailuresPath());
    expect(defaultFailuresPath().endsWith(FAILURES_REL)).toBe(true);
    expect(defaultPathForKind('wellEdit')).toBe(defaultLogPath());
    expect(defaultPathForKind('wellSnapshot')).toBe(defaultLogPath());
    expect(defaultLogPath().endsWith(TRAINING_LOG_REL)).toBe(true);
    // The two files are distinct so the fine-tune build can subtract one from the other.
    expect(defaultFailuresPath()).not.toBe(defaultLogPath());
  });
});

const tmpDirs: string[] = [];
async function tmpLog(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cadtrain-tlog-'));
  tmpDirs.push(dir);
  // A NESTED path so we also exercise the mkdir-recursive branch.
  return join(dir, 'ai', 'training-log.jsonl');
}
afterEach(async () => {
  while (tmpDirs.length) {
    const d = tmpDirs.pop()!;
    await rm(d, { recursive: true, force: true }).catch(() => {});
  }
});

// ── append / list roundtrip ──────────────────────────────────────────────────

describe('appendRecord / listRecords roundtrip', () => {
  it('creates the ai/ dir, appends JSONL, and reads records back in order', async () => {
    const filePath = await tmpLog();

    const a = await appendRecord(
      { kind: 'wrongResponse', instruction: 'make a packer', output: '{}', source: 'user' },
      { filePath },
    );
    const b = await appendRecord(
      { kind: 'wellSnapshot', wson: { meta: { wellName: 'W1' } }, origin: 'generate' },
      { filePath },
    );

    // ids + timestamps are stamped on write.
    expect(a.id).toBeTruthy();
    expect(a.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(b.id).not.toBe(a.id);

    const all = await listRecords({ filePath });
    expect(all).toHaveLength(2);
    expect(all[0].kind).toBe('wrongResponse');
    expect(all[1].kind).toBe('wellSnapshot');
    // round-trips the payload
    expect((all[0] as any).instruction).toBe('make a packer');
    expect((all[1] as any).wson.meta.wellName).toBe('W1');

    // On-disk shape is one JSON object per line (JSONL).
    const raw = await readFile(filePath, 'utf8');
    const lines = raw.split('\n').filter((l) => l.trim());
    expect(lines).toHaveLength(2);
    expect(() => JSON.parse(lines[0])).not.toThrow();
  });

  it('returns [] when the log file does not exist', async () => {
    const filePath = join(await mkdtemp(join(tmpdir(), 'cadtrain-tlog-')), 'nope.jsonl');
    expect(await listRecords({ filePath })).toEqual([]);
    expect(await countRecords({ filePath })).toBe(0);
  });

  it('filters by kind and skips a torn trailing line', async () => {
    const filePath = await tmpLog();
    await appendRecord({ kind: 'wrongResponse', instruction: 'q1', output: 'o1', source: 'user' }, { filePath });
    await appendRecord({ kind: 'wellSnapshot', wson: { meta: {} }, origin: 'load' }, { filePath });
    await appendRecord({ kind: 'wrongResponse', instruction: 'q2', output: 'o2', source: 'api-error' }, { filePath });

    // Simulate a crash mid-append: a partial, unparseable trailing line.
    const { appendFile } = await import('node:fs/promises');
    await appendFile(filePath, '{"kind":"wellSnapshot","wson":{ TORN', 'utf8');

    const wrong = await listRecords({ filePath, kind: 'wrongResponse' });
    expect(wrong).toHaveLength(2);
    expect(wrong.every((r) => r.kind === 'wrongResponse')).toBe(true);

    // The torn line is skipped, not thrown on — 3 valid records survive.
    const all = await listRecords({ filePath });
    expect(all).toHaveLength(3);
  });

  it('preserves prior records across many appends (never clobbers)', async () => {
    const filePath = await tmpLog();
    for (let i = 0; i < 25; i++) {
      await appendRecord({ kind: 'wrongResponse', instruction: `q${i}`, output: `o${i}`, source: 'user' }, { filePath });
    }
    const all = await listRecords({ filePath });
    expect(all).toHaveLength(25);
    expect((all[0] as any).instruction).toBe('q0');
    expect((all[24] as any).instruction).toBe('q24');
  });
});

// ── diffWell ─────────────────────────────────────────────────────────────────

describe('diffWell', () => {
  const before: WellJson = {
    meta: { wellName: 'W', td: 1070 },
    ch: [
      { od: 13.375, top: 0, bot: 300, grade: 'K55' },
      { od: 9.625, top: 0, bot: 1070, grade: 'L80' },
    ],
    perforations: [{ top: 1040, bot: 1060, label: 'Main' }],
  };

  it('detects a scalar field change with a field-level path', () => {
    const after: WellJson = JSON.parse(JSON.stringify(before));
    (after.ch as any[])[1].bot = 1200;
    const ops = diffWell(before, after);
    expect(ops).toEqual([{ op: 'replace', path: '/ch/1/bot', before: 1070, after: 1200 }]);
  });

  it('detects meta changes field-wise', () => {
    const after: WellJson = JSON.parse(JSON.stringify(before));
    (after.meta as any).td = 1200;
    const ops = diffWell(before, after);
    expect(ops).toEqual([{ op: 'replace', path: '/meta/td', before: 1070, after: 1200 }]);
  });

  it('detects an appended array element as an add (the "enhance" case)', () => {
    const after: WellJson = JSON.parse(JSON.stringify(before));
    (after as any).completions = [
      { tool_comp: 'PACKERS.PACKER_BAKER_PERMANENT', description: 'Packer', od: 7, top: 1028, bot: 1028.5 },
    ];
    const ops = diffWell(before, after);
    expect(ops).toHaveLength(1);
    expect(ops[0].op).toBe('add');
    expect(ops[0].path).toBe('/completions/0');
    expect((ops[0].after as any).tool_comp).toBe('PACKERS.PACKER_BAKER_PERMANENT');
  });

  it('detects a removed array element', () => {
    const after: WellJson = JSON.parse(JSON.stringify(before));
    (after.ch as any[]).pop();
    const ops = diffWell(before, after);
    expect(ops).toHaveLength(1);
    expect(ops[0].op).toBe('remove');
    expect(ops[0].path).toBe('/ch/1');
  });

  it('reports no ops for structurally-equal docs (order-independent keys)', () => {
    const after: WellJson = { ch: (before as any).ch, perforations: (before as any).perforations, meta: { td: 1070, wellName: 'W' } };
    expect(diffWell(before, after)).toEqual([]);
  });

  it('captures multiple simultaneous edits', () => {
    const after: WellJson = JSON.parse(JSON.stringify(before));
    (after.meta as any).td = 1200;
    (after.ch as any[])[1].bot = 1200;
    (after.perforations as any[])[0].label = 'Reservoir A';
    const ops = diffWell(before, after);
    expect(ops).toHaveLength(3);
    const paths = ops.map((o) => o.path).sort();
    expect(paths).toEqual(['/ch/1/bot', '/meta/td', '/perforations/0/label']);
  });
});

// ── summary + builder ─────────────────────────────────────────────────────────

describe('summarizeWellDiff + buildWellEditRecord', () => {
  it('summarises grouped counts + concrete field changes', () => {
    const ops = diffWell(
      { meta: { td: 1070 }, ch: [{ od: 9.625, bot: 1070 }] },
      { meta: { td: 1200 }, ch: [{ od: 9.625, bot: 1200 }], completions: [{ tool_comp: 'X' }] },
    );
    const s = summarizeWellDiff(ops);
    expect(s).toContain('change');
    expect(s).toContain('meta');
    expect(s).toContain('1070→1200');
  });

  it('"no change" for an empty diff', () => {
    expect(summarizeWellDiff([])).toBe('no change');
  });

  it('builds a wellEdit record carrying the tuple + diff + summary', () => {
    const beforeW: WellJson = { meta: { wellName: 'W', td: 1070 }, ch: [] };
    const afterW: WellJson = { meta: { wellName: 'W', td: 1070 }, ch: [{ od: 9.625, top: 0, bot: 1070 }] };
    const rec = buildWellEditRecord({
      instruction: 'add a 9-5/8 production casing to TD',
      before: beforeW,
      after: afterW,
      origin: 'chat',
      wellId: 'W',
    });
    expect(rec.kind).toBe('wellEdit');
    expect(rec.instruction).toContain('9-5/8');
    expect(rec.before).toBe(beforeW);
    expect(rec.after).toBe(afterW);
    expect(rec.diff.some((o) => o.op === 'add' && o.path === '/ch/0')).toBe(true);
    expect(rec.summary).toContain('ch');
    expect(rec.origin).toBe('chat');
  });

  it('a built wellEdit record round-trips through the log', async () => {
    const filePath = await mkdtemp(join(tmpdir(), 'cadtrain-tlog-')).then((d) => {
      tmpDirs.push(d);
      return join(d, 'ai', 'training-log.jsonl');
    });
    const rec = buildWellEditRecord({
      instruction: 'deepen the well',
      before: { meta: { td: 1000 } },
      after: { meta: { td: 1500 } },
      origin: 'manual',
    });
    await appendRecord(rec, { filePath });
    const [read] = await listRecords({ filePath, kind: 'wellEdit' });
    expect(read).toBeTruthy();
    expect((read as any).summary).toBe(rec.summary);
    expect((read as any).diff).toEqual(rec.diff);
  });
});
