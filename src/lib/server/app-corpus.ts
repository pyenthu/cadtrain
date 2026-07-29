// src/lib/server/app-corpus.ts — the app-building corpus (the learning system, rung 4a.2).
// Every build is captured; future builds retrieve similar past builds as few-shot
// grounding → the builder learns and gets more deterministic over time (D15). Lexical
// retrieval, local, no embeddings (D11 v1). Server-side (fs); pure ranking is testable.
import { appendFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { appsDir } from './app-paths';

export interface BuildRecord {
  ts: number;
  prompt: string;
  steps: number;
  /** A compact summary of what was built — enough to few-shot future builds. */
  app: { app: string; panels: Array<{ id: string; kind: string; source?: unknown }> };
}

function corpusPath(): string {
  return join(appsDir(), '_builds.jsonl');
}

export async function captureBuild(rec: BuildRecord): Promise<void> {
  try {
    await appendFile(corpusPath(), `${JSON.stringify(rec)}\n`, 'utf8');
  } catch {
    /* best-effort — a corpus write must never fail the build */
  }
}

export async function loadCorpus(): Promise<BuildRecord[]> {
  let raw: string;
  try {
    raw = await readFile(corpusPath(), 'utf8');
  } catch {
    return [];
  }
  return raw
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l) as BuildRecord;
      } catch {
        return null;
      }
    })
    .filter(Boolean) as BuildRecord[];
}

const tokenize = (s: string): Set<string> => new Set(s.toLowerCase().match(/[a-z0-9]+/g) ?? []);
function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n / Math.max(1, a.size);
}

/** Rank past builds by prompt token-overlap (pure → testable). */
export function rankBuilds(prompt: string, corpus: BuildRecord[], k = 3): BuildRecord[] {
  const q = tokenize(prompt);
  return corpus
    .map((r) => ({ r, score: overlap(q, tokenize(r.prompt)) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((x) => x.r);
}

export async function retrieveGrounding(prompt: string, k = 3): Promise<BuildRecord[]> {
  return rankBuilds(prompt, await loadCorpus(), k);
}

/** Render retrieved builds as a few-shot grounding block for the system prompt (pure). */
export function renderGrounding(records: BuildRecord[]): string {
  if (!records.length) return '';
  const lines = records.map(
    (r) => `- "${r.prompt}" → ${JSON.stringify(r.app.panels.map((p) => ({ kind: p.kind, id: p.id })))}`,
  );
  return ['Similar past builds (reference these for consistency):', ...lines].join('\n');
}
