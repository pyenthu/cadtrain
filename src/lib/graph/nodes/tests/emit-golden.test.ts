/**
 * emit-golden.test.ts — the Phase 1–2 SAFETY NET (docs/plans/hierarchical-class-
 * design.md §6a.5). Freeze the emitted `.body` of every volume graph-part while
 * emit is provably unchanged (Phase 0), then assert byte-for-byte identity after
 * each phase moves an emit arm into a descriptor. A single diff = a regression.
 *
 * FIXTURES (committed): tests/golden/graph/<id>.json (the hydrated Graph) +
 * tests/golden/emit/<id>.js (the frozen emitGraph(...).body). The test re-emits
 * each committed graph fixture and compares — PURE, no network, CI-safe.
 *
 * CAPTURE (one-shot, needs the dev server): if the fixture dir is empty OR
 * GOLDEN_CAPTURE=1, beforeAll enumerates parts via /api/primitives/list, fetches
 * each source (local dev proxies to prod — CLAUDE.md Rule 13), extracts +
 * hydrates its meta.graph, emits, and WRITES the fixtures. Commit them once.
 * Re-capture after intentional emit changes: `GOLDEN_CAPTURE=1 bun run test emit-golden`.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractGraphFromSource } from '$lib/shared/graph-editor/graph-editor-bake';
import { hydrateGraph } from '$lib/graph/composition/composition-graph-hydrate';
import { emitGraph } from '$lib/graph/composition/composition-emit';

const ROOT = process.cwd();
const GRAPH_DIR = join(ROOT, 'tests/golden/graph');
const EMIT_DIR = join(ROOT, 'tests/golden/emit');
const BASE = 'http://localhost:3333';

const emitBody = (graphJson: any, id: string): string => emitGraph(hydrateGraph(graphJson), { id }).body;

/** Collect every volume graph-part id from the /list response groups. */
function collectIds(list: any): string[] {
  const ids = new Set<string>();
  const push = (v: any) => {
    if (!Array.isArray(v)) return;
    for (const x of v) { if (x && typeof x === 'object' && x.id) ids.add(x.id); else if (typeof x === 'string') ids.add(x); }
  };
  for (const k of ['basic', 'completions', 'archived', 'merged']) push(list?.[k]);
  for (const k of ['basicSubfolders', 'completionSubfolders']) {
    const sub = list?.[k];
    if (sub && typeof sub === 'object') for (const items of Object.values(sub)) push(items);
  }
  return [...ids];
}

async function capture(): Promise<number> {
  mkdirSync(GRAPH_DIR, { recursive: true });
  mkdirSync(EMIT_DIR, { recursive: true });
  const list = await fetch(`${BASE}/api/primitives/list`).then((r) => r.json());
  const ids = collectIds(list);
  let n = 0;
  for (const id of ids) {
    try {
      const src = await fetch(`${BASE}/api/primitives/source?name=${encodeURIComponent(id)}`).then((r) => (r.ok ? r.text() : ''));
      // /source may return JSON {source} or raw text — handle both.
      let text = src;
      try { const j = JSON.parse(src); if (j && typeof j.source === 'string') text = j.source; } catch { /* raw */ }
      const graphJson = extractGraphFromSource(text);
      if (!graphJson || typeof graphJson !== 'object') continue; // hand-authored engine prim — no graph
      const hydrated = hydrateGraph(graphJson);
      const body = emitGraph(hydrated, { id }).body;
      writeFileSync(join(GRAPH_DIR, `${id}.json`), JSON.stringify(graphJson, null, 2));
      writeFileSync(join(EMIT_DIR, `${id}.js`), body);
      n++;
    } catch { /* skip a part that won't hydrate/emit — surfaced by its absence */ }
  }
  return n;
}

let fixtures: string[] = [];

beforeAll(async () => {
  const have = existsSync(GRAPH_DIR) ? readdirSync(GRAPH_DIR).filter((f) => f.endsWith('.json')) : [];
  if (have.length === 0 || process.env.GOLDEN_CAPTURE === '1') {
    try {
      const n = await capture();
      // eslint-disable-next-line no-console
      console.log(`[emit-golden] captured ${n} part baselines from ${BASE}`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[emit-golden] capture skipped (dev server unreachable?): ${(e as any)?.message ?? e}`);
    }
  }
  fixtures = existsSync(GRAPH_DIR) ? readdirSync(GRAPH_DIR).filter((f) => f.endsWith('.json')) : [];
}, 60_000);

describe('golden emit — every volume part re-emits byte-identical', () => {
  it('has a committed baseline set (capture ran or fixtures present)', () => {
    // A bare checkout with no server + no committed fixtures leaves this empty;
    // once fixtures are committed this guards against an accidental wipe.
    expect(fixtures.length).toBeGreaterThan(0);
  });

  it('re-emits each part identically to its frozen baseline', () => {
    const diffs: string[] = [];
    for (const f of fixtures) {
      const id = f.replace(/\.json$/, '');
      const graphJson = JSON.parse(readFileSync(join(GRAPH_DIR, f), 'utf8'));
      const golden = readFileSync(join(EMIT_DIR, `${id}.js`), 'utf8');
      const now = emitBody(graphJson, id);
      if (now !== golden) diffs.push(id);
    }
    expect(diffs, `emit changed for: ${diffs.join(', ')}`).toEqual([]);
  });
});
