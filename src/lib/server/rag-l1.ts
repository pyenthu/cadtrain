/**
 * L1 deterministic dictionary tier for /api/rag/prompt (plan K.77).
 *
 * A "describe a part" prompt for a KNOWN, common part should resolve to a
 * working graph INSTANTLY and OFFLINE — 0 Claude tokens, no prod-volume
 * read — instead of asking Claude to invent it (which failed for "flat
 * collar" → blank). On a miss, the caller falls through to the L2
 * BM25 + Claude path unchanged.
 *
 * Each alias maps phrases → a SHAPE BUILDER that emits a self-contained
 * `meta.graph` (polygon + r_revolve), so the result always hydrates + bakes
 * without touching the volume. The phrase→part dictionary grows
 * incrementally (the RAG flywheel) — add an entry to ALIASES below or, for
 * a fully novel part, let L2 handle it.
 *
 * The alias table is mirrored to `docs/parts/aliases.json` for human
 * reference; the runtime uses THIS inlined copy so it's bundled into the
 * build (works on prod where docs/ isn't shipped).
 */

type Graph = {
  nodes: Record<string, any>;
  root: string;
  params: Record<string, { default: number; step?: number }>;
  imports: string[];
};

type ParamMap = Record<string, number>;

// ── shape builders — each returns a self-contained revolve graph ─────────
// Z-down: z runs 0 (top) → len (bottom). r is the half-section radius.

function revolveGraph(
  points: { r: string; z: string }[],
  params: Record<string, { default: number; step?: number }>,
): Graph {
  return {
    nodes: {
      n_root: { id: 'n_root', type: 'list', children: ['n_poly', 'n_call'] },
      n_poly: {
        id: 'n_poly',
        type: 'polygon',
        points: points.map((p) => ({
          kind: 'point',
          r: { kind: 'expr', expr: p.r },
          z: { kind: 'expr', expr: p.z },
        })),
      },
      n_call: {
        id: 'n_call',
        type: 'call',
        src: 'r_revolve',
        alias: 'A',
        args: {
          profile: { kind: 'expr', expr: '__POLY__n_poly' },
          segments: { kind: 'literal', value: 96 },
        },
      },
    },
    root: 'n_root',
    params,
    imports: ['r_revolve'],
  };
}

const SHAPES: Record<string, (p: ParamMap) => Graph> = {
  // Plain hollow collar — rectangular half-section, square ends.
  collar_flat: (p) =>
    revolveGraph(
      [
        { r: 'p.bore / 2', z: '0' },
        { r: 'p.bore / 2', z: 'p.len' },
        { r: 'p.od / 2', z: 'p.len' },
        { r: 'p.od / 2', z: '0' },
      ],
      { od: { default: p.od ?? 3 }, bore: { default: p.bore ?? 1 }, len: { default: p.len ?? 2 } },
    ),
  // Collar with the bottom OUTER corner chamfered off by `taper`.
  collar_tapered: (p) =>
    revolveGraph(
      [
        { r: 'p.bore / 2', z: '0' },
        { r: 'p.bore / 2', z: 'p.len' },
        { r: 'p.od / 2 - p.taper', z: 'p.len' },
        { r: 'p.od / 2', z: 'p.len - p.taper' },
        { r: 'p.od / 2', z: '0' },
      ],
      {
        od: { default: p.od ?? 3 }, bore: { default: p.bore ?? 1 },
        len: { default: p.len ?? 2 }, taper: { default: p.taper ?? 0.5 },
      },
    ),
  // Collar with a stepped/rounded outer top approximated by two chamfers.
  collar_rounded: (p) =>
    revolveGraph(
      [
        { r: 'p.bore / 2', z: '0' },
        { r: 'p.bore / 2', z: 'p.len' },
        { r: 'p.od / 2 - p.radius', z: 'p.len' },
        { r: 'p.od / 2', z: 'p.len - p.radius' },
        { r: 'p.od / 2', z: 'p.radius' },
        { r: 'p.od / 2 - p.radius', z: '0' },
      ],
      {
        od: { default: p.od ?? 3 }, bore: { default: p.bore ?? 1 },
        len: { default: p.len ?? 2 }, radius: { default: p.radius ?? 0.4 },
      },
    ),
  // Hollow tube / pup joint — same as flat collar but a thinner wall + long.
  tube: (p) =>
    revolveGraph(
      [
        { r: 'p.bore / 2', z: '0' },
        { r: 'p.bore / 2', z: 'p.len' },
        { r: 'p.od / 2', z: 'p.len' },
        { r: 'p.od / 2', z: '0' },
      ],
      { od: { default: p.od ?? 3 }, bore: { default: p.bore ?? 2.4 }, len: { default: p.len ?? 6 } },
    ),
  // Solid shaft / rod — bore goes to 0.
  shaft: (p) =>
    revolveGraph(
      [
        { r: '0', z: '0' },
        { r: '0', z: 'p.len' },
        { r: 'p.od / 2', z: 'p.len' },
        { r: 'p.od / 2', z: '0' },
      ],
      { od: { default: p.od ?? 2 }, len: { default: p.len ?? 6 } },
    ),
};

// ── alias table (mirror of docs/parts/aliases.json) ──────────────────────

interface Alias {
  id: string;
  shape: keyof typeof SHAPES;
  phrases: string[];
  params?: ParamMap;
}

const ALIASES: Alias[] = [
  { id: 'collar_flat', shape: 'collar_flat', phrases: ['flat collar', 'plain collar', 'square collar', 'collar'] },
  { id: 'collar_tapered', shape: 'collar_tapered', phrases: ['tapered collar', 'chamfered collar', 'bevelled collar', 'beveled collar'] },
  { id: 'collar_rounded', shape: 'collar_rounded', phrases: ['rounded collar', 'radiused collar'] },
  { id: 'tube', shape: 'tube', phrases: ['tube', 'tubing', 'pup joint', 'tubing pup', 'pup', 'hollow tube'] },
  { id: 'shaft', shape: 'shaft', phrases: ['shaft', 'rod', 'solid cylinder', 'solid shaft', 'cylinder'] },
];

// ── matching ─────────────────────────────────────────────────────────────

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Score an alias against the prompt: a phrase that appears as a whole-word
 *  substring scores by its length (longer = more specific wins). 0 = miss. */
function scoreAlias(promptNorm: string, a: Alias): number {
  let best = 0;
  for (const phrase of a.phrases) {
    const p = normalize(phrase);
    const re = new RegExp(`(^|\\s)${p.replace(/\s/g, '\\s+')}(\\s|$)`);
    if (re.test(promptNorm)) best = Math.max(best, p.length);
  }
  return best;
}

/** Resolve a known-part prompt to a ready-to-bake graph, or null on miss.
 *  Pure + offline — never throws, never reads the volume. */
export function tryL1(prompt: string): { id: string; graph: Graph } | null {
  const norm = normalize(prompt ?? '');
  if (!norm) return null;
  let winner: Alias | null = null;
  let winnerScore = 0;
  for (const a of ALIASES) {
    const s = scoreAlias(norm, a);
    if (s > winnerScore) { winnerScore = s; winner = a; }
  }
  if (!winner) return null;
  try {
    const graph = SHAPES[winner.shape](winner.params ?? {});
    return { id: `g_${winner.id}`, graph };
  } catch {
    return null;
  }
}
