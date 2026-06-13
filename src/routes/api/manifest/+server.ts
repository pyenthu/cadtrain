/**
 * GET /api/manifest — machine-readable catalog of cadtrain's CAD operations.
 *
 * The "operation is ours, the design is theirs": an external app (its own UI +
 * AI prompting) reads this to discover what cadtrain can do, then calls the
 * documented endpoints. This is the self-describing surface an MCP bridge or a
 * direct-HTTP client both consume. Hand-authored (SvelteKit has no OpenAPI
 * autogen) and kept in lockstep with the real endpoints in src/routes/api/.
 */
import { json } from '@sveltejs/kit';

const VERSION = '2026-06-13';

const OPERATIONS = [
  {
    id: 'list_parts',
    method: 'GET',
    path: '/api/primitives/list',
    summary: 'List every CAD part (volume primitives + stdlib engines), grouped by category.',
    request: null,
    response: '{ basic: Part[], completions: {...}, stdlib: Part[], stdstale: Part[], archived: Part[] } where Part = { id, name, description, source, params, editable }',
  },
  {
    id: 'get_part',
    method: 'GET',
    path: '/api/primitives/source?id=<id>',
    summary: 'Fetch one part\'s typed source file (includes meta.graph — the node-graph JSON).',
    request: 'query: id (string)',
    response: '{ id, source: string, kind: "prim"|"asm" }',
  },
  {
    id: 'prompt_to_cad',
    method: 'POST',
    path: '/api/rag/prompt',
    summary: 'AI: turn a natural-language part description into a CAD node-graph (BM25 retrieval over the corpus + one Claude call). The core "design by prompting" operation.',
    request: '{ prompt: string, k?: number }',
    response: '{ id, candidates: Part[], graph: Graph }  // graph is the composition-graph JSON, ready to seed an editor or bake',
  },
  {
    id: 'bake_part',
    method: 'POST',
    path: '/api/primitives/preview',
    summary: 'Bake a part source (or a generated graph emitted to source) to 3D geometry — returns mesh buffers for rendering.',
    request: '{ id, name, source: string, params: number[], mode?: "sandbox" }',
    response: '{ full: { positions, normals, colors, indices }, cutVC?: {...} }  // verts/normals for the external viewer',
  },
  {
    id: 'authoring_vocab',
    method: 'GET',
    path: '/api/primitives/instructions',
    summary: 'The authoring vocabulary + rules an AI should follow when composing new parts (synonyms, extends, compose kinds).',
    request: null,
    response: '{ instructions: string, vocabulary: {...} }',
  },
];

export const GET = async ({ url }: { url: URL }) => {
  return json({
    name: 'cadtrain',
    description: 'Parametric downhole-tool CAD operations. The operations are ours; build your own drawing UI + AI prompting on top.',
    version: VERSION,
    base_url: url.origin,
    conventions: {
      units: 'oilfield: inches for geometry; Z-down (top = lower z, +z goes down-hole)',
      graph: 'parts carry a composition-graph (nodes: Call/Container/Method/Mv/Rot/Repeat/Polygon/Sketch). prompt_to_cad returns one; bake_part consumes emitted source.',
      profiles: 'a revolve/extrude Call takes a `profile` produced by a polygon or sketch node, wired via the __POLY__<id> expr.',
    },
    workflow: ['prompt_to_cad → graph', 'emit/seed an editor OR bake_part → geometry', 'list_parts / get_part to browse + remix existing parts'],
    operations: OPERATIONS,
  });
};
