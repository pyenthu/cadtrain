/**
 * Build the Claude prompt for /api/rag/prompt.
 *
 * Phase 2 of docs/plans/rag-prompt-builder.md. Pure builder: no Anthropic
 * SDK, no I/O. The endpoint composes this with the SDK client.
 *
 * Two outputs:
 *   * system — describes the graph schema, available primitives, the
 *     hard "return one JSON object" rule.
 *   * user   — top-k corpus exemplars (one-line each) + the user's prompt.
 *
 * The graph schema is shown by EXAMPLE (a literal g_spiral graph) rather
 * than via TypeScript types — Claude follows shape examples more reliably
 * than abstract types, and the example doubles as a "this is a graph
 * that BAKES" anchor.
 */

import type { RagRecord } from '$lib/server/rag-corpus';

// ── catalogue of available primitives ──────────────────────────────────
//
// What Claude can reference via Call.src. Kept short (id + one-line desc +
// params) so it fits in the system prompt budget. The runtime resolver
// (`/api/primitives/source?name=…`) is what the editor will actually
// consult when the user opens the proposed graph — so this list doesn't
// need to be exhaustive, only suggestive.

const AVAILABLE_PRIMITIVES: { id: string; desc: string; params: string }[] = [
  {
    id: 'r_revolve',
    desc: 'Revolve a 2D (r,z) half-section profile around the z axis. Welded lathe.',
    params: 'profile: polygon (an __POLY__<nodeId> ref), segments: number (default 96).',
  },
  {
    id: 'r_extrude',
    desc: 'Linear extrude a 2D (x,y) polygon down the z axis. Twist + taper supported.',
    params: 'profile: polygon, length: number, divs, twist (°), taper, segments.',
  },
  {
    id: 'r_weld_extrude',
    desc: 'Hand-wound extrude of a 2D polygon. Used for non-convex / twisted prisms — flat coils etc.',
    params: 'profile: polygon, length, divs, twist (°), taper, segments.',
  },
  {
    id: 'r_cuboid',
    desc: 'Axis-aligned box. w × h × d.',
    params: 'w: number, h: number, d: number.',
  },
];

// ── one-liner exemplar of the graph JSON shape Claude should emit ──────
//
// Excerpted from the on-volume `g_spiral` source (the canonical flat-coil
// exemplar). Trimmed: only ONE poly_repeat (not g_spiral's two), single
// param, single Call — just enough to ground the schema.

const GRAPH_EXAMPLE_JSON = `{
  "nodes": {
    "n_root":  { "id": "n_root",  "type": "list",  "children": ["n_poly", "n_call"] },
    "n_poly":  { "id": "n_poly",  "type": "polygon", "points": [
      { "kind": "repeat-ref", "sourceId": "n_loop" }
    ] },
    "n_loop":  { "id": "n_loop",  "type": "poly_repeat",
      "count":   { "kind": "param", "param": "NPts" },
      "loopVar": "i",
      "r":       { "kind": "expr", "expr": "R * cos(theta)" },
      "z":       { "kind": "expr", "expr": "R * sin(theta)" },
      "bindings": [
        { "name": "turns", "value": { "kind": "param", "param": "turns" } },
        { "name": "theta", "value": { "kind": "expr",  "expr": "i * turns * tau / NPts" } },
        { "name": "R",     "value": { "kind": "expr",  "expr": "0.4 + i / NPts" } }
      ]
    },
    "n_call":  { "id": "n_call", "type": "call", "src": "r_weld_extrude", "alias": "A",
      "args": {
        "profile": { "kind": "expr", "expr": "__POLY__n_poly" },
        "length":  { "kind": "param", "param": "length" },
        "divs":    { "kind": "literal", "value": 12 },
        "twist":   { "kind": "literal", "value": 0 },
        "taper":   { "kind": "literal", "value": 0 },
        "segments":{ "kind": "literal", "value": 100 }
      }
    }
  },
  "root": "n_root",
  "params": {
    "NPts":   { "default": 360, "step": 1 },
    "turns":  { "default": 2,   "step": 0.1 },
    "length": { "default": 2,   "step": 0.05 }
  },
  "imports": ["r_weld_extrude"]
}`;

// ── system prompt ──────────────────────────────────────────────────────

/** Build the system prompt. Constant — no per-request data. Cached when
 *  needed; for now we just rebuild on each call (cheap string ops). */
export function buildSystemPrompt(): string {
  const primList = AVAILABLE_PRIMITIVES
    .map((p) => `  - ${p.id} — ${p.desc} Params: ${p.params}`)
    .join('\n');

  return `You are cadtrain's part-graph generator. The user describes a parametric \
3D part in natural language; you respond with ONE JSON object representing the part as \
a composition graph the editor can hydrate.

# Output shape

Your entire response MUST be a single valid JSON object — no prose, no markdown, no \
code fences. Top level:

{
  "id": "g_my_part",                                      // REQUIRED — suggested snake_case id for the new part
  "candidates": [ { "id": "...", "score": 0.0 }, ... ],   // optional — exemplar ids you drew on
  "graph": { ...the graph object... }                     // REQUIRED
}

# Graph schema (by example)

A graph has \`nodes\` (id → node), a \`root\` node id, optional \`params\` (sliders the user \
can adjust), and an \`imports\` array of primitive ids the graph calls. Every node has a \
\`type\` discriminator:

  - "list"        — { type:"list", children: NodeId[] } — root container holding the polygon + call.
  - "polygon"     — { type:"polygon", points: PolygonEntry[] }
                    PolygonEntry = { kind:"point",       r: ArgValue, z: ArgValue }
                                 | { kind:"repeat-ref", sourceId: NodeId }   // spliced from a poly_repeat
  - "poly_repeat" — { type:"poly_repeat", count: ArgValue, loopVar: string,
                      r: ArgValue, z: ArgValue, bindings?: Binding[] }
                    Each iteration binds loopVar (and NPts = count) in scope before evaluating bindings,
                    then r and z. Bindings can reference earlier bindings.
  - "call"        — { type:"call", src: "<primitive id>", alias: "A", args: { <key>: ArgValue } }
                    For r_revolve / r_extrude / r_weld_extrude, args.profile MUST be
                    { kind:"expr", expr: "__POLY__<polygonNodeId>" } pointing at a polygon node.
  - "mv"          — { type:"mv", child: NodeId, offset: [ArgValue, ArgValue, ArgValue] }
  - "rot"         — { type:"rot", child: NodeId, rot:    [ArgValue, ArgValue, ArgValue] }
  - "method"      — { type:"method", op: "subtract"|"add"|"intersect", obj: NodeId, arg: NodeId }
  - "repeat"      — { type:"repeat", child: NodeId, count: ArgValue, op?: "stack"|"list"|"place" }

ArgValue = { kind:"literal", value: number|string|boolean }
        | { kind:"expr",    expr:  "<JS expression>" }   // can use Math.*, sin, cos, p.<param>, NPts, loopVar, bindings
        | { kind:"param",   param: "<paramName>" }      // wires the slot to params[<name>]

NodeIds — use short readable names ("n_poly", "n_loop", "n_call", "n_root"). Random suffixes are fine.

# Example graph (a flat coil disc — minimal version of g_spiral)

${GRAPH_EXAMPLE_JSON}

# Available primitives to call

${primList}

(The catalog above is suggestive; the editor resolves the actual primitive at bake time. \
Match parameter names exactly when calling — e.g. r_weld_extrude takes 'profile', 'length', \
'divs', 'twist', 'taper', 'segments'.)

# Hard rules

1. Return ONE JSON object. NO prose, NO code fences, NO markdown. Just the object.
2. The "graph" field is required and must hydrate (be a valid Graph per the schema above).
3. Prefer composing existing primitives over inventing new ones. The user's prompt + the
   exemplars below are your only context.
4. Use \`params\` for any value the user describes as adjustable (turns, length, count, etc.).
5. r_revolve / r_extrude / r_weld_extrude all consume a polygon — emit the polygon as a
   separate node and wire it via { kind:"expr", expr:"__POLY__<polygonId>" }.`;
}

// ── user prompt ────────────────────────────────────────────────────────

/** Render a single corpus record as a one-line exemplar — id + description
 *  + structure_summary. Tags omitted to keep each block compact; they're
 *  already folded into the BM25 score, no need to spend tokens on them
 *  here. */
function renderRecord(r: RagRecord): string {
  const desc = (r.description ?? '').trim();
  const struct = (r.structure_summary ?? '').trim();
  const params = (r.params ?? []).join(', ');
  // Two-line format: a header line, then a sub-line with structure +
  // params. Compact + scannable.
  return [
    `- ${r.id} — ${desc || '(no description)'}`,
    `    structure: ${struct || '(none)'}; params: ${params || '(none)'}`,
  ].join('\n');
}

/** Build the user message: the top-k exemplars rendered + the user's
 *  description + a clear "your output" closer so Claude knows where to
 *  start writing. */
export function buildUserPrompt(userPrompt: string, exemplars: RagRecord[]): string {
  const exemplarBlock = exemplars.length > 0
    ? `Closest existing parts from the corpus (BM25 top-${exemplars.length}):\n\n${exemplars.map(renderRecord).join('\n')}\n`
    : 'The corpus is empty — invent a graph from the example shape above.\n';

  return `${exemplarBlock}
User description:

${userPrompt.trim()}

Now respond with the JSON object {id, candidates, graph}.`;
}

// ── pair builder ───────────────────────────────────────────────────────

/** Convenience — system + user in one call. The endpoint just does
 *  buildRagPrompt(prompt, top-k) → SDK call. */
export function buildRagPrompt(
  userPrompt: string,
  exemplars: RagRecord[],
): { system: string; user: string } {
  return {
    system: buildSystemPrompt(),
    user: buildUserPrompt(userPrompt, exemplars),
  };
}
