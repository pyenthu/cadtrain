/**
 * Corpus coverage for the WSON → composition-graph translator.
 *
 * `wsonToGraph` has NO FALLBACK by design (wells skill): an unmapped `tool_comp`
 * throws rather than quietly rendering a stand-in. That contract is only useful
 * if the map actually covers the corpus — before 2026-07-10, wells 05 and 09
 * threw, so their GRAPH tab showed "Cannot express this well as a graph" and the
 * 3D never rendered at all. Nothing caught it, because nothing translated every
 * sample.
 *
 * This pins the whole sample corpus. A new .wson with an unmapped code fails HERE
 * (with the code named) instead of blanking a tab in the browser.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { wsonToGraph, PLACEHOLDER_PART_IDS } from '../wson-to-graph';
import type { Wson } from '../wson';

const DIR = path.resolve('src/lib/wells/samples');
const SAMPLES = fs.readdirSync(DIR).filter((f) => f.endsWith('.wson')).sort();

const load = (f: string) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')) as Wson;

/** Every `src` on a Call node, anywhere in the graph. */
function callSrcs(graph: unknown): Set<string> {
  const out = new Set<string>();
  const walk = (n: any) => {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'call' && typeof n.src === 'string') out.add(n.src);
    for (const v of Object.values(n)) (Array.isArray(v) ? v.forEach(walk) : walk(v));
  };
  walk(graph);
  return out;
}

describe('every sample well translates to a graph', () => {
  it('finds samples at all (a silent empty glob would make this suite vacuous)', () => {
    expect(SAMPLES.length).toBeGreaterThanOrEqual(8);
  });

  it.each(SAMPLES)('%s → graph, no unmapped tool_comp', (f) => {
    expect(() => wsonToGraph(load(f))).not.toThrow();
  });

  it('every Call resolves to a bw_* well element', () => {
    for (const f of SAMPLES) {
      for (const src of callSrcs(wsonToGraph(load(f)))) {
        expect(src, `${f} emitted a non-bw_* Call "${src}"`).toMatch(/^bw_/);
      }
    }
  });
});

describe('the two wells that used to blank', () => {
  // Regression guards, named. 05 threw on MISC.PUP_PERF; 09 on
  // FLOW_CONTROL.TRSSSV_SP (and would then have hit GAUGE_MANDREL + PACKER_AHR_AHC).
  it('05-esp-producer emits bw_pup_perf', () => {
    expect(callSrcs(wsonToGraph(load('05-esp-producer.wson')))).toContain('bw_pup_perf');
  });

  it('09-hpht-completion emits all three of its imported placeholders', () => {
    const srcs = callSrcs(wsonToGraph(load('09-hpht-completion.wson')));
    expect(srcs).toContain('bw_trsssv_sp');
    expect(srcs).toContain('bw_gauge_mandrel');
    expect(srcs).toContain('bw_packer_ahr_ahc');
  });
});

describe('NO FALLBACK still holds', () => {
  it('an unknown tool_comp throws, naming the code', () => {
    const w = load('00-one-casing.wson');
    const bad = {
      ...w,
      completions: [{ tool_comp: 'MISC.NOT_A_REAL_THING', od: 4, top: 10, bot: 20 } as any],
    };
    expect(() => wsonToGraph(bad as Wson)).toThrow(/MISC\.NOT_A_REAL_THING/);
  });

  it('a missing/empty tool_comp throws, naming the index', () => {
    const w = load('00-one-casing.wson');
    const bad = { ...w, completions: [{ od: 4, top: 10, bot: 20 } as any] };
    expect(() => wsonToGraph(bad as Wson)).toThrow(/completion 0/);
  });
});

describe('placeholder parts are declared, not incidental', () => {
  // If someone finishes a part's real geometry they must also drop it from this
  // set — otherwise the UI keeps badging a finished part as a placeholder.
  it('the placeholder set is exactly the four imported stubs', () => {
    expect([...PLACEHOLDER_PART_IDS].sort()).toEqual([
      'bw_gauge_mandrel', 'bw_packer_ahr_ahc', 'bw_pup_perf', 'bw_trsssv_sp',
    ]);
  });

  it('every placeholder id is actually reachable from the corpus', () => {
    const all = new Set<string>();
    for (const f of SAMPLES) for (const s of callSrcs(wsonToGraph(load(f)))) all.add(s);
    for (const id of PLACEHOLDER_PART_IDS) {
      expect(all, `${id} is a placeholder no sample uses — delete it or add a sample`).toContain(id);
    }
  });
});
