// src/lib/appkit/ai/score-app.ts — a PURE structural similarity score between a BUILT .app and a
// golden .app. The foundation of the app-build eval harness (docs/plans/app-build-eval.md): it
// turns "did the model reproduce the golden?" into a single 0..1 number + a per-facet breakdown,
// so ANY provider (cloud Claude, the CLI, or an in-browser small model like Phi/WebLLM) can be
// measured on the SAME yardstick.
//
// It scores STRUCTURE, not prose or exact prop values — the shape the harness actually renders:
//   • panelKinds — the pre-order sequence of panel kinds (count + kinds + order), LCS-similarity.
//   • nesting    — the parent→child kind edges (the tree shape), multiset F1.
//   • vars       — the seeded DATA variable names, set F1.
//   • structures — the declared record-structure names, set F1.
//   • theme      — mode + accent.
//   • meta       — title + docType.
//
// Why "DATA vars/structures" and not all of them: adding a component auto-PROMOTES its props into
// `app.vars[panelId]` + `app.structures[panelId]` (manifest/promote-props.ts). Those keys are an
// artifact of the build pipeline, not a modelling choice, so a faithful rebuild would look
// "different" from a literal golden purely because of promotion. We therefore compare only the
// vars/structures whose key is NOT a panel id — the data the prompts actually seeded. This makes
// the score invariant under prop-promotion (a rebuilt-then-promoted app still scores 1.0 vs its
// literal golden). PURE — no IO, no Svelte → fully unit-testable.

export interface AppLike {
  app?: string;
  title?: string;
  docType?: string;
  panels?: PanelLike[];
  vars?: Record<string, unknown>;
  structures?: Record<string, unknown>;
  theme?: { mode?: string; accent?: string };
  [k: string]: unknown;
}
export interface PanelLike {
  id?: string;
  kind?: string;
  children?: PanelLike[];
  [k: string]: unknown;
}

export interface ScoreBreakdown {
  panelKinds: number;
  nesting: number;
  vars: number;
  structures: number;
  theme: number;
  meta: number;
}

export interface ScoreResult {
  score: number;
  breakdown: ScoreBreakdown;
  weights: ScoreBreakdown;
  /** Human-readable per-facet detail (counts) — handy for the eval report / debugging. */
  detail: {
    builtKinds: string[];
    goldenKinds: string[];
    builtVars: string[];
    goldenVars: string[];
    builtStructures: string[];
    goldenStructures: string[];
  };
}

const WEIGHTS: ScoreBreakdown = {
  panelKinds: 0.4,
  nesting: 0.2,
  vars: 0.15,
  structures: 0.07,
  theme: 0.1,
  meta: 0.08,
};

// ── tree walkers ─────────────────────────────────────────────────────────────────────────────
/** The pre-order sequence of panel kinds (top-level then children, depth-first). Encodes panel
 *  COUNT, KINDS and ORDER in one sequence — the primary "did it build the right components" signal. */
export function preorderKinds(app: AppLike): string[] {
  const out: string[] = [];
  const walk = (list: PanelLike[] = []) => {
    for (const p of list) {
      out.push(String(p?.kind ?? '?'));
      if (Array.isArray(p?.children)) walk(p.children);
    }
  };
  walk(app?.panels ?? []);
  return out;
}

/** The multiset of `parentKind>childKind` edges (top-level panels hang off a synthetic `ROOT`).
 *  Captures the NESTING shape — reparenting or flattening a subtree changes these edges. */
export function nestingEdges(app: AppLike): string[] {
  const out: string[] = [];
  const walk = (list: PanelLike[] = [], parentKind: string) => {
    for (const p of list) {
      const kind = String(p?.kind ?? '?');
      out.push(`${parentKind}>${kind}`);
      if (Array.isArray(p?.children)) walk(p.children, kind);
    }
  };
  walk(app?.panels ?? [], 'ROOT');
  return out;
}

/** Every panel id in the tree — used to strip auto-promoted (panel-keyed) vars/structures. */
export function allPanelIds(app: AppLike): Set<string> {
  const ids = new Set<string>();
  const walk = (list: PanelLike[] = []) => {
    for (const p of list) {
      if (p?.id) ids.add(String(p.id));
      if (Array.isArray(p?.children)) walk(p.children);
    }
  };
  walk(app?.panels ?? []);
  return ids;
}

/** The SEEDED data variable names — app.vars keys that are NOT a panel id (those are promotion
 *  artifacts). This is the modelled data the prompts actually seeded (tasks / nodes / well / …). */
export function dataVarNames(app: AppLike): string[] {
  const ids = allPanelIds(app);
  return Object.keys(app?.vars ?? {}).filter((k) => !ids.has(k));
}

/** The DECLARED record-structure names — app.structures keys that are not a panel id. */
export function dataStructureNames(app: AppLike): string[] {
  const ids = allPanelIds(app);
  return Object.keys(app?.structures ?? {}).filter((k) => !ids.has(k));
}

// ── similarity primitives ──────────────────────────────────────────────────────────────────────
/** Length of the Longest Common Subsequence (order-preserving) of two string sequences. */
function lcsLen(a: string[], b: string[]): number {
  const n = a.length;
  const m = b.length;
  if (!n || !m) return 0;
  const dp = new Array(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    let prev = 0; // dp[i-1][j-1]
    for (let j = 1; j <= m; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev + 1 : Math.max(dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[m];
}

/** Order-sensitive sequence similarity (Dice over the LCS): 2·LCS / (|a|+|b|). Both empty → 1. */
export function seqSimilarity(a: string[], b: string[]): number {
  if (!a.length && !b.length) return 1;
  const lcs = lcsLen(a, b);
  return (2 * lcs) / (a.length + b.length);
}

/** Multiset F1 of two token lists (order-insensitive). Both empty → 1. */
export function f1Multiset(a: string[], b: string[]): number {
  if (!a.length && !b.length) return 1;
  const count = (xs: string[]) => {
    const c = new Map<string, number>();
    for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1);
    return c;
  };
  const ca = count(a);
  const cb = count(b);
  let tp = 0;
  for (const [k, n] of ca) tp += Math.min(n, cb.get(k) ?? 0);
  const precision = tp / Math.max(1, a.length);
  const recall = tp / Math.max(1, b.length);
  return precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
}

const eqTrim = (a?: string, b?: string) => String(a ?? '').trim() === String(b ?? '').trim();
const normAccent = (s?: string) => String(s ?? '').trim().toLowerCase();

/** Theme facet: mode + accent, each half. Golden with no theme → 1 (nothing to match). */
function scoreTheme(built: AppLike, golden: AppLike): number {
  const g = golden.theme;
  if (!g || (g.mode === undefined && g.accent === undefined)) return 1;
  const b = built.theme ?? {};
  const mode = (g.mode === undefined ? 1 : b.mode === g.mode ? 1 : 0);
  const accent = (g.accent === undefined ? 1 : normAccent(b.accent) === normAccent(g.accent) ? 1 : 0);
  return 0.5 * mode + 0.5 * accent;
}

/** Meta facet: title + docType, each half. */
function scoreMeta(built: AppLike, golden: AppLike): number {
  const title = eqTrim(built.title, golden.title) ? 1 : 0;
  const docType = eqTrim(built.docType, golden.docType) ? 1 : 0;
  return 0.5 * title + 0.5 * docType;
}

// ── the score ──────────────────────────────────────────────────────────────────────────────────
/** Structural similarity of a BUILT .app against a GOLDEN .app → { score 0..1, breakdown }.
 *  scoreApp(golden, golden) === 1. Missing/extra/reordered panels, dropped vars, or a wrong theme
 *  each pull the score down through the relevant facet. */
export function scoreApp(built: AppLike, golden: AppLike): ScoreResult {
  const builtKinds = preorderKinds(built);
  const goldenKinds = preorderKinds(golden);
  const builtVars = dataVarNames(built);
  const goldenVars = dataVarNames(golden);
  const builtStructures = dataStructureNames(built);
  const goldenStructures = dataStructureNames(golden);

  const breakdown: ScoreBreakdown = {
    panelKinds: seqSimilarity(builtKinds, goldenKinds),
    nesting: f1Multiset(nestingEdges(built), nestingEdges(golden)),
    vars: f1Multiset(builtVars, goldenVars),
    structures: f1Multiset(builtStructures, goldenStructures),
    theme: scoreTheme(built, golden),
    meta: scoreMeta(built, golden),
  };

  let score = 0;
  for (const k of Object.keys(WEIGHTS) as (keyof ScoreBreakdown)[]) score += WEIGHTS[k] * breakdown[k];
  score = Math.max(0, Math.min(1, score));

  return {
    score,
    breakdown,
    weights: WEIGHTS,
    detail: { builtKinds, goldenKinds, builtVars, goldenVars, builtStructures, goldenStructures },
  };
}
