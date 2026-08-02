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
  type GoldenSlot,
  type NonConformance,
} from './app-corpus-store';
import {
  tokenize,
  overlap,
  goldenScore,
  slotNamesOf,
  matchTemplate,
  fillTemplate,
  applyTemplate,
} from './golden-templates';

export type { BuildRecord, GoldenPair, GoldenSlot, NonConformance };

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

/** Capture a ⚠ Report — the negative signal (a bad build the user flagged). */
export async function reportNonConformance(rec: NonConformance): Promise<void> {
  await getCorpusStore().appendNonConformance(rec);
}
export async function loadNonConformances(): Promise<NonConformance[]> {
  return getCorpusStore().loadNonConformances();
}

/** The promotion QUEUE: rank the raw builds as golden candidates against the current golden
 *  set (the human then one-click-promotes). Reads the shared corpus. */
export async function getPromotionCandidates(k = 12): Promise<PromotionCandidate[]> {
  const store = getCorpusStore();
  const [builds, golden] = await Promise.all([store.loadBuilds(), store.loadGolden()]);
  return rankPromotionCandidates(builds, golden, k);
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

/** The docType of a golden's target .app (top-level `docType`), or undefined if untyped. */
export function docTypeOf(app: unknown): string | undefined {
  const dt = (app as { docType?: unknown } | null)?.docType;
  return typeof dt === 'string' && dt ? dt : undefined;
}

/** Rank curated golden pairs against a prompt (pure → testable). SLOT-AWARE (#43): a TEMPLATED
 *  golden (md with `{{slots}}`) is scored on its non-slot skeleton, so one "…{{color}}" pair
 *  ranks for the whole family (teal/red/…); LITERAL goldens keep the exact original md-overlap
 *  ranking. See golden-templates.ts `goldenScore`.
 *
 *  DOCTYPE-SCOPED (#49): when `docType` is given, retrieve ONLY same-docType goldens — a strict
 *  family filter that kills cross-app contamination. Measured 2026-08-02: the local model was
 *  copying whatever golden ranked, so a `dashboard` build pulled the `roadmap` app's `gantt`
 *  (via the untyped `…gantt` atomic golden) and the `well` app's schematic into the dashboard.
 *  Untyped goldens are excluded under an active filter (that's where the gantt atomic lives).
 *  Inactive when no docType is given (the "create" prompt that SETS docType, edit flows) →
 *  unchanged behaviour. */
export function rankGolden(prompt: string, golden: GoldenPair[], k = 3, docType?: string): GoldenPair[] {
  const pool = docType ? golden.filter((g) => docTypeOf(g.app) === docType) : golden;
  return pool
    .map((g) => ({ g, score: goldenScore(prompt, g) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((x) => x.g);
}

/** A compact structural summary of an .app — the shape we few-shot, not the whole doc.
 *  It must TEACH the model how to build (not just what exists): per-panel `props` (the config
 *  — chart type/rowsVar/xField, stat label/value, datatable columns/search …) and `source.args`
 *  (the var a verb reads) flow through, plus app meta (`app`/`title`/`docType`), a COMPACT `vars`
 *  SCHEMA (field names + row count, never the bulk rows), and `structures` (name → field names).
 *  Token-bounded: long string values are truncated and var data is never dumped. Pure. */
export function compactApp(app: any): Record<string, unknown> {
  // Truncate a long string value so a verbose prop / arg can't blow the few-shot token budget.
  const clampStr = (v: unknown): unknown => (typeof v === 'string' && v.length > 80 ? v.slice(0, 80) + '…' : v);
  // Shallow-clamp a props/args bag (string values truncated; structure kept). Undefined when empty.
  const clampBag = (bag: any): Record<string, unknown> | undefined => {
    if (!bag || typeof bag !== 'object') return undefined;
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(bag)) o[k] = clampStr(v);
    return Object.keys(o).length ? o : undefined;
  };
  const node = (p: any): any => {
    const o: any = { kind: p.kind, id: p.id };
    const props = clampBag(p.props);
    if (props) o.props = props;
    if (p.source && typeof p.source === 'object' && p.source.verb) {
      const args = clampBag(p.source.args);
      o.source = args ? { verb: p.source.verb, args } : p.source.verb;
    }
    if (p.children?.length) o.children = p.children.map(node);
    return o;
  };
  // A var → a COMPACT schema, never the rows: array-of-objects → {fields, count}; array-of-scalars
  // → {count}; object → {fields}; scalar → its (clamped) value.
  const compactVar = (v: unknown): unknown => {
    if (Array.isArray(v)) {
      const first = v.find((x) => x != null);
      return first && typeof first === 'object' && !Array.isArray(first)
        ? { fields: Object.keys(first), count: v.length }
        : { count: v.length };
    }
    if (v && typeof v === 'object') return { fields: Object.keys(v) };
    return clampStr(v);
  };
  const out: Record<string, unknown> = {};
  if (app?.app) out.app = app.app;
  if (app?.title) out.title = clampStr(app.title);
  if (app?.docType) out.docType = app.docType;
  out.panels = (app?.panels ?? []).map(node);
  if (app?.files?.length) out.files = app.files;
  if (app?.vars && Object.keys(app.vars).length) {
    const vars: Record<string, unknown> = {};
    for (const [name, v] of Object.entries(app.vars)) vars[name] = compactVar(v);
    out.vars = vars;
  }
  if (app?.structures && Object.keys(app.structures).length) {
    const structures: Record<string, string[]> = {};
    for (const [name, fields] of Object.entries(app.structures)) {
      structures[name] = Array.isArray(fields) ? fields.map((f: any) => f?.name).filter(Boolean) : [];
    }
    out.structures = structures;
  }
  if (app?.computed) out.computed = Object.keys(app.computed);
  if (app?.theme) out.theme = app.theme;
  return out;
}

/** One promotable atomic golden candidate: a natural-language retrieval key (`md`) → a minimal
 *  docType-tagged `.app` slice (the target). */
export interface AtomicGolden {
  name: string;
  md: string;
  app: Record<string, unknown>;
}

const themeMd = (t: any): string =>
  `Use a ${t?.mode || 'light'} theme${t?.accent ? ` with a ${t.accent} accent` : ''}.`;

const fieldsOf = (v: unknown): string[] => {
  if (Array.isArray(v)) {
    const first = v.find((x) => x != null);
    return first && typeof first === 'object' && !Array.isArray(first) ? Object.keys(first) : [];
  }
  return v && typeof v === 'object' ? Object.keys(v as object) : [];
};
const varMd = (name: string, v: unknown): string => {
  const f = fieldsOf(v);
  return `Seed a ${name} variable${f.length ? ` with records (${f.join(', ')})` : ''}.`;
};

/** A natural-language retrieval key for one panel, keyed off its kind + props (so a promoted
 *  chart golden is retrieved by "add a bar chart …" not by an id). Falls back to the kind. */
function panelMd(p: any): string {
  const pr = p?.props ?? {};
  const srcVar = p?.source?.args?.name;
  switch (p?.kind) {
    case 'chart':
      return `Add a ${pr.type || ''} chart${pr.title ? ` titled "${pr.title}"` : ''}${srcVar || pr.rowsVar ? ` reading the ${srcVar || pr.rowsVar} variable` : ''}${pr.xField && pr.yField ? `, x = ${pr.xField}, y = ${pr.yField}` : ''}.`.replace(/\s+/g, ' ');
    case 'datatable':
      return `Add a data table${srcVar ? ` reading ${srcVar}` : ''}${pr.columns ? ` with columns ${pr.columns}` : ''}${pr.search ? ', with search' : ''}${pr.sortable ? ', sortable' : ''}${pr.showTotals ? ', with totals' : ''}.`;
    case 'statgrid':
      return 'Add a stat grid.';
    case 'stat':
      return `Add a KPI stat tile${pr.label ? ` "${pr.label}"` : ''}${pr.format ? ` as ${pr.format}` : ''}.`;
    case 'cad3d':
      return `Add a 3D CAD viewer${pr.partId ? ` of the ${pr.partId} part` : ''}.`;
    case 'heading':
      return `Add a ${pr.level === 1 ? 'level-1 ' : ''}heading${pr.text ? ` "${pr.text}"` : ''}.`;
    case 'text':
      return `Add a ${pr.muted ? 'muted ' : ''}subtitle or text paragraph.`;
    default:
      return `Add a ${p?.kind || 'component'} component.`;
  }
}

/** Decompose a built .app into ATOMIC per-component golden candidates — one small `docType`-tagged
 *  slice per app-meta / theme / structure / var / top-level panel, each keyed by a natural-language
 *  `md`. This is the RIGHT shape to PROMOTE (measured 2026-08): a small model retrieves JUST the
 *  relevant piece per prompt instead of over-copying a whole app (which dropped its data vars).
 *  Slices carry the FULL target (e.g. a var's rows) — grounding renders them compact via
 *  `compactApp`. Pure → testable; the promote endpoint saves each via `promoteGolden`. */
export function decomposeToAtomicGoldens(app: any, opts: { base?: string } = {}): AtomicGolden[] {
  const dt = docTypeOf(app);
  const base = (opts.base || app?.app || app?.title || 'app')
    .toString()
    .replace(/[^a-z0-9_-]+/gi, '_')
    .toLowerCase();
  const tag: Record<string, unknown> = dt ? { docType: dt } : {};
  const out: AtomicGolden[] = [];

  if (app?.title || dt) {
    out.push({
      name: `${base}-meta`,
      md: `Create ${dt ? `a ${dt} app` : 'an app'}${app?.title ? ` titled "${app.title}"` : ''}${dt ? `, docType ${dt}` : ''}.`,
      app: { ...(app?.app ? { app: app.app } : {}), ...(app?.title ? { title: app.title } : {}), ...tag, panels: [] },
    });
  }
  if (app?.theme) out.push({ name: `${base}-theme`, md: themeMd(app.theme), app: { ...tag, theme: app.theme, panels: [] } });
  for (const [n, fields] of Object.entries(app?.structures ?? {})) {
    const fnames = Array.isArray(fields) ? fields.map((f: any) => f?.name).filter(Boolean) : [];
    out.push({ name: `${base}-struct-${n}`, md: `Define a ${n} structure with fields ${fnames.join(', ')}.`, app: { ...tag, structures: { [n]: fields }, panels: [] } });
  }
  for (const [n, v] of Object.entries(app?.vars ?? {})) {
    out.push({ name: `${base}-var-${n}`, md: varMd(n, v), app: { ...tag, vars: { [n]: v }, panels: [] } });
  }
  for (const p of (app?.panels ?? []) as any[]) {
    out.push({ name: `${base}-${p.kind}-${p.id}`.replace(/[^a-z0-9_-]+/gi, '_'), md: panelMd(p), app: { ...tag, panels: [p] } });
  }
  return out;
}

const firstLine = (md: string): string => (md.split('\n').find((l) => l.trim()) ?? '').replace(/^#+\s*/, '').trim();

/** Render ONE golden as a few-shot line. TEMPLATED goldens (#43) render two ways:
 *   - deterministic: if `prompt` is given and matchTemplate captures the slots, show the
 *     CONCRETELY-FILLED example (the exact target for this prompt — the strongest signal).
 *   - otherwise: show the template verbatim ({{slots}} intact) + a note telling the model to
 *     fill the slot(s) from the user's prompt (mechanism (a) — few-shot generalization).
 *  Literal goldens render exactly as before. */
function renderGoldenLine(g: GoldenPair, prompt?: string): string {
  const names = slotNamesOf(g);
  if (!names.length) return `- "${firstLine(g.md)}" → ${JSON.stringify(compactApp(g.app))}`;

  if (prompt) {
    const m = matchTemplate(prompt, g);
    if (m) {
      const filledMd = fillTemplate(firstLine(g.md), m.values);
      const filledApp = applyTemplate(g.app, m.values);
      const note = Object.entries(m.values).map(([k, v]) => `${k}=${v}`).join(', ');
      return `- "${filledMd}" → ${JSON.stringify(compactApp(filledApp))} (filled ${note} from the prompt)`;
    }
  }
  const slotList = names.map((n) => `{{${n}}}`).join(', ');
  return `- "${firstLine(g.md)}" → ${JSON.stringify(compactApp(g.app))} (template — fill ${slotList} from the user's prompt)`;
}

/** Render curated pairs (full structure — they're the targets) + past builds (summary)
 *  as a few-shot grounding block for the system prompt (pure). When `prompt` is supplied,
 *  templated goldens are shown filled-in for that prompt where they match deterministically. */
export function renderGrounding(builds: BuildRecord[], golden: GoldenPair[] = [], prompt?: string): string {
  const blocks: string[] = [];
  if (golden.length) {
    blocks.push(
      'Curated examples — match the description, emit a similarly-STRUCTURED .app:',
      ...golden.map((g) => renderGoldenLine(g, prompt)),
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
export async function buildGrounding(prompt: string, k = 3, docType?: string, vector?: boolean): Promise<string> {
  const store = getCorpusStore();
  const [builds, golden] = await Promise.all([store.loadBuilds(), store.loadGolden()]);
  // docType-scoped (#49): ground on same-family CURATED goldens ONLY. Raw past builds carry no
  // docType, so a cross-app build (e.g. one that contains a gantt) would re-contaminate a
  // dashboard even after the golden filter — suppress them when scoping. The curated same-family
  // goldens are the stronger, cleaner signal anyway.
  const rankedBuilds = docType ? [] : rankBuilds(prompt, builds.filter(isCleanBuild), k);
  let golds = rankGolden(prompt, golden, k, docType);
  // OPT-IN semantic retrieval (D11 vector RAG): env-gated (APP_RAG_VECTOR) so we A/B it against the
  // lexical ranker via the N≥3 eval gate before flipping the default. The dynamic import keeps
  // transformers.js/onnxruntime out of the module graph unless it's actually switched on; a vector
  // miss (or any embed failure) falls back to the lexical `golds` — retrieval never regresses.
  const useVector = vector ?? vectorRetrievalOn(); // per-request override wins; else the env default
  if (useVector) {
    try {
      const { rankGoldenVector } = await import('./vector-retrieval');
      const v = await rankGoldenVector(prompt, golden, k, docType);
      if (v.length) golds = v;
    } catch {
      /* keep lexical */
    }
  }
  return renderGrounding(rankedBuilds, golds, prompt);
}

/** Is semantic (vector) retrieval switched on? Read from plain `process.env` (not `$env`) so this
 *  stays importable in vitest + bun scripts. Default OFF — lexical until the eval gate says vector wins. */
function vectorRetrievalOn(): boolean {
  const v = process.env.APP_RAG_VECTOR;
  return !!v && v !== '0' && v.toLowerCase() !== 'false';
}
