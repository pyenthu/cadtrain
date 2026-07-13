/**
 * rag-chat.test.ts — headless coverage for the chat→wells retrieval adapter
 * (docs/plans/chat-to-wells-ai.md Phase 2). Pure: fixtures only, no volume read.
 * Verifies the BM25 reuse ranks the right heterogeneous record to the top and
 * that the WSON / vocab / part extractors produce searchable chunks.
 */
import { describe, it, expect } from 'vitest';
import {
  retrieveForChat,
  renderChatContext,
  wsonToChatRecords,
  vocabToChatRecords,
  ragRecordToChatRecord,
  type ChatCorpusRecord,
} from './rag-chat';

// A small heterogeneous corpus: two well-element parts, two vocab entries,
// one sample-well summary chunk.
const CORPUS: ChatCorpusRecord[] = [
  {
    id: 'part:bw_packer',
    kind: 'part',
    title: 'bw_packer',
    text: 'Production packer element. Seals the casing annulus to isolate the reservoir. params: od, id, length',
    source: 'primitives/completions/bw_packer.asm.ts',
    ref: 'bw_packer',
  },
  {
    id: 'part:bw_casing',
    kind: 'part',
    title: 'bw_casing',
    text: 'Cased-hole casing tubular string element. params: od, id, wall, length',
    source: 'primitives/completions/bw_casing.asm.ts',
    ref: 'bw_casing',
  },
  {
    id: 'vocab:packer',
    kind: 'vocab',
    title: 'packer',
    text: 'A completion packer that seals the annulus. synonyms: isolation packer, permanent packer, seal',
    source: 'vocabulary.json',
    ref: 'packer',
  },
  {
    id: 'vocab:perforation',
    kind: 'vocab',
    title: 'perforation',
    text: 'Perforation interval connecting the wellbore to the reservoir. synonyms: perf, shot',
    source: 'vocabulary.json',
    ref: 'perforation',
  },
  {
    id: 'well:01:summary',
    kind: 'well',
    title: 'SAMPLE-1 Vertical Land Producer',
    text: 'Sample well with 3 casing strings, a Baker permanent packer, and a main reservoir perforation.',
    source: '01-vertical-land-producer.wson',
    ref: '01-vertical-land-producer.wson',
  },
];

describe('retrieveForChat ranking', () => {
  it('surfaces packer records for a packer/annulus query', () => {
    const hits = retrieveForChat('permanent packer to seal the annulus', CORPUS, 6);
    expect(hits.length).toBeGreaterThan(0);
    // The top hit must be about packers (either the part or the vocab entry).
    expect(hits[0].id).toMatch(/packer/);
    // Both packer records outrank the casing-only part.
    const casingRank = hits.findIndex((h) => h.id === 'part:bw_casing');
    const packerPartRank = hits.findIndex((h) => h.id === 'part:bw_packer');
    expect(packerPartRank).toBeGreaterThanOrEqual(0);
    if (casingRank >= 0) expect(packerPartRank).toBeLessThan(casingRank);
  });

  it('ranks the casing part top for a casing query', () => {
    const hits = retrieveForChat('cased hole casing tubular string', CORPUS, 6);
    expect(hits[0].id).toBe('part:bw_casing');
  });

  it('drops zero-score records (nothing matched → empty)', () => {
    const hits = retrieveForChat('xylophone quantum banana', CORPUS, 6);
    expect(hits).toEqual([]);
  });

  it('honours k and returns descending scores', () => {
    const hits = retrieveForChat('packer casing perforation reservoir well', CORPUS, 2);
    expect(hits.length).toBeLessThanOrEqual(2);
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i].score).toBeLessThanOrEqual(hits[i - 1].score);
    }
  });

  it('empty query returns the first k in corpus order (score 0)', () => {
    const hits = retrieveForChat('', CORPUS, 3);
    expect(hits).toHaveLength(3);
    expect(hits.map((h) => h.id)).toEqual(CORPUS.slice(0, 3).map((r) => r.id));
    expect(hits.every((h) => h.score === 0)).toBe(true);
  });

  it('empty corpus returns []', () => {
    expect(retrieveForChat('anything', [], 5)).toEqual([]);
  });
});

describe('renderChatContext', () => {
  it('renders retrieved records into a prompt-ready block', () => {
    const hits = retrieveForChat('packer', CORPUS, 3);
    const ctx = renderChatContext(hits);
    expect(ctx).toContain('RELEVANT CONTEXT');
    expect(ctx).toContain('packer');
    expect(ctx).toContain('[part]');
  });

  it('empty for no hits', () => {
    expect(renderChatContext([])).toBe('');
  });
});

describe('wsonToChatRecords', () => {
  // Shape mirrors src/lib/wells/samples/01-vertical-land-producer.wson.
  const WSON = {
    meta: { wellName: 'SAMPLE-1', td: 1070, _wellType: 'producer' },
    oh: [{ bitSize: 12.25, top: 300, bot: 1070 }],
    ch: [
      { od: 13.375, id: 12.415, top: 0, bot: 300, grade: 'K55', type: 'surface' },
      { od: 9.625, id: 8.681, top: 0, bot: 1070, grade: 'L80', type: 'production' },
    ],
    completions: [
      { description: 'Baker Permanent Packer', tool_comp: 'PACKERS.PACKER_BAKER_PERMANENT', od: 8.681, top: 1028, bot: 1028.5 },
    ],
    perforations: [{ top: 1040, bot: 1060, label: 'Main reservoir' }],
  };

  it('produces summary, casing, completion, and perforation chunks', () => {
    const recs = wsonToChatRecords(WSON, '01-vertical-land-producer.wson');
    const kinds = recs.map((r) => r.id);
    expect(kinds).toContain('well:01-vertical-land-producer:summary');
    expect(kinds).toContain('well:01-vertical-land-producer:casing');
    expect(kinds).toContain('well:01-vertical-land-producer:completions');
    expect(kinds).toContain('well:01-vertical-land-producer:perfs');
    // The completion chunk carries the tool_comp key so a query on it retrieves.
    const comp = recs.find((r) => r.id.endsWith(':completions'))!;
    expect(comp.text).toContain('PACKERS.PACKER_BAKER_PERMANENT');
    // All records are searchable via retrieveForChat.
    const hits = retrieveForChat('baker permanent packer', recs, 4);
    expect(hits.length).toBeGreaterThan(0);
  });

  it('returns [] for a non-object input', () => {
    expect(wsonToChatRecords(null as any, 'x.wson')).toEqual([]);
  });
});

describe('vocabToChatRecords', () => {
  it('accepts a bare array of entries', () => {
    const recs = vocabToChatRecords([
      { id: 'packer', description: 'seals the annulus', synonyms: ['seal'] },
      { id: 'nipple', description: 'landing nipple' },
    ]);
    expect(recs).toHaveLength(2);
    expect(recs[0].id).toBe('vocab:packer');
    expect(recs[0].text).toContain('synonyms: seal');
  });

  it('accepts an { entries: [...] } wrapper and skips id-less rows', () => {
    const recs = vocabToChatRecords({ entries: [{ id: 'x', description: 'd' }, { description: 'no id' }] });
    expect(recs).toHaveLength(1);
    expect(recs[0].id).toBe('vocab:x');
  });

  it('returns [] for junk', () => {
    expect(vocabToChatRecords(42)).toEqual([]);
    expect(vocabToChatRecords(null)).toEqual([]);
  });
});

describe('ragRecordToChatRecord', () => {
  it('maps a parts-corpus RagRecord into a part chat record', () => {
    const rec = ragRecordToChatRecord({
      id: 'bw_packer',
      kind: 'asm',
      description: 'Well-barrier packer',
      tags: ['completion', 'barrier'],
      params: ['od', 'id', 'length'],
      structure_summary: 'graph: call×2',
      exemplar_path: 'primitives/completions/bw_packer.asm.ts',
      updated_at: '2026-07-01T00:00:00.000Z',
    });
    expect(rec.kind).toBe('part');
    expect(rec.id).toBe('part:bw_packer');
    expect(rec.ref).toBe('bw_packer');
    expect(rec.text).toContain('Well-barrier packer');
    expect(rec.text).toContain('params: od, id, length');
  });
});
