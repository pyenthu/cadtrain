// src/lib/server/app-corpus.ts — the app-building corpus (the learning system, rung 4a.2).
// Every build is captured; future builds retrieve similar past builds + CURATED golden
// pairs as few-shot grounding → the builder learns and gets more deterministic over time
// (D15). Lexical retrieval, local, no embeddings (D11 v1). Storage lives behind
// AppCorpusStore (VOLUME by default — shared, prod, evolving; app-corpus-store.ts). The
// ranking/rendering here is PURE → testable.
import {
  getCorpusStore,
  type BuildRecord,
  type GoldenPair,
} from './app-corpus-store';

export type { BuildRecord, GoldenPair };

export async function captureBuild(rec: BuildRecord): Promise<void> {
  await getCorpusStore().appendBuild(rec);
}

export async function loadCorpus(): Promise<BuildRecord[]> {
  return getCorpusStore().loadBuilds();
}

/** Promote a build (or a hand-authored pair) into the curated golden DB (the "★ add to
 *  RAG" flow). MD is the retrieval key; the .app is the target. */
export async function promoteGolden(name: string, md: string, app: unknown): Promise<void> {
  await getCorpusStore().saveGolden(name, md, app);
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

/** Rank curated golden pairs by MD (description) overlap (pure → testable). */
export function rankGolden(prompt: string, golden: GoldenPair[], k = 3): GoldenPair[] {
  const q = tokenize(prompt);
  return golden
    .map((g) => ({ g, score: overlap(q, tokenize(g.md)) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((x) => x.g);
}

/** A compact structural summary of an .app — the shape we few-shot (kinds/nesting/files/
 *  computed/theme), not the whole doc (keeps grounding small). Pure. */
export function compactApp(app: any): Record<string, unknown> {
  const node = (p: any): any => {
    const o: any = { kind: p.kind, id: p.id };
    if (p.children?.length) o.children = p.children.map(node);
    if (p.source?.verb) o.source = p.source.verb;
    return o;
  };
  const out: Record<string, unknown> = { panels: (app?.panels ?? []).map(node) };
  if (app?.files?.length) out.files = app.files;
  if (app?.computed) out.computed = Object.keys(app.computed);
  if (app?.theme) out.theme = app.theme;
  return out;
}

const firstLine = (md: string): string => (md.split('\n').find((l) => l.trim()) ?? '').replace(/^#+\s*/, '').trim();

/** Render curated pairs (full structure — they're the targets) + past builds (summary)
 *  as a few-shot grounding block for the system prompt (pure). */
export function renderGrounding(builds: BuildRecord[], golden: GoldenPair[] = []): string {
  const blocks: string[] = [];
  if (golden.length) {
    blocks.push(
      'Curated examples — match the description, emit a similarly-STRUCTURED .app:',
      ...golden.map((g) => `- "${firstLine(g.md)}" → ${JSON.stringify(compactApp(g.app))}`),
    );
  }
  if (builds.length) {
    if (blocks.length) blocks.push('');
    blocks.push(
      'Similar past builds (reference these for consistency):',
      ...builds.map((r) => `- "${r.prompt}" → ${JSON.stringify(r.app.panels.map((p) => ({ kind: p.kind, id: p.id })))}`),
    );
  }
  return blocks.join('\n');
}

/** Corpus HYGIENE gate: a raw build may TEACH future builds (ground the model) only if it did
 *  real, non-broken work. Filters out incomplete/failed builds so a wrong or half-finished
 *  prompt can sit in the audit log WITHOUT polluting what the model learns. Semantic quality
 *  (a wrong-but-valid build) is a separate, human gate — golden promotion (the ★ button).
 *   - steps < 1              → the build did nothing (empty/unparseable emit) → excluded.
 *   - a trace with 0 ok verbs → every verb failed → excluded.
 *  (Legacy records lacking a trace are allowed if steps > 0 — they predate trace capture.) */
export function isCleanBuild(rec: BuildRecord): boolean {
  if (!rec.steps || rec.steps < 1) return false;
  if (rec.trace && !rec.trace.some((t) => t.ok)) return false;
  return true;
}

/** A raw build surfaced as a candidate to PROMOTE into golden, with a score + human-readable
 *  reasons. The engine behind the signal-assisted promotion queue (#38): the human confirms;
 *  automation never promotes the model's own output unprompted (avoids the self-reinforcing
 *  feedback loop). Ranks by the signals we HAVE today; richer keep-signals (saved / launched /
 *  superseded) slot in as extra score terms once captured. */
export interface PromotionCandidate {
  rec: BuildRecord;
  score: number;
  reasons: string[];
}

export function rankPromotionCandidates(builds: BuildRecord[], golden: GoldenPair[] = [], k = 10): PromotionCandidate[] {
  const goldenToks = golden.map((g) => tokenize(g.md));
  const out: PromotionCandidate[] = [];
  for (const rec of builds) {
    if (!isCleanBuild(rec)) continue; // never a candidate — a broken build can't be a golden example
    const reasons: string[] = ['clean build'];
    let score = 1;
    if (rec.trace && rec.trace.length > 0 && rec.trace.every((t) => t.ok)) {
      score += 2;
      reasons.push('all verbs succeeded');
    }
    if (rec.steps >= 1 && rec.steps <= 8) {
      score += 1;
      reasons.push('focused (≤8 steps)');
    }
    const q = tokenize(rec.prompt);
    if (goldenToks.some((g) => overlap(q, g) > 0.6)) {
      score -= 3;
      reasons.push('already covered by a golden');
    }
    out.push({ rec, score, reasons });
  }
  return out.sort((a, b) => b.score - a.score || b.rec.ts - a.rec.ts).slice(0, k);
}

/** Load + rank golden pairs (the curated DB) AND the builds log, and render the combined
 *  few-shot grounding string. The one call the build pipeline uses. Golden is authoritative;
 *  raw builds are a fallback and are HYGIENE-FILTERED (isCleanBuild) so failures never teach. */
export async function buildGrounding(prompt: string, k = 3): Promise<string> {
  const store = getCorpusStore();
  const [builds, golden] = await Promise.all([store.loadBuilds(), store.loadGolden()]);
  return renderGrounding(rankBuilds(prompt, builds.filter(isCleanBuild), k), rankGolden(prompt, golden, k));
}
