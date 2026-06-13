/**
 * cadtrain-mcp.ts — an MCP server that exposes cadtrain's CAD operations as
 * Model Context Protocol tools over stdio.
 *
 * "The operation is ours, the design is theirs." An external AI app (Claude
 * Desktop, Cursor, a custom agent) wires into cadtrain's HTTP API through this
 * thin bridge: each MCP tool is a `fetch` wrapper over one cadtrain endpoint.
 * The tool list mirrors src/routes/api/manifest/+server.ts.
 *
 * Run:
 *   bun scripts/cadtrain-mcp.ts
 *
 * Config:
 *   CADTRAIN_BASE_URL   base URL of a running cadtrain server
 *                       (default http://localhost:3333)
 *
 * Transport: stdio (McpServer + StdioServerTransport). Point any MCP client at
 * the command above; see docs/EXTERNAL_API.md for a client config example.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BASE_URL = (process.env.CADTRAIN_BASE_URL ?? 'http://localhost:3333').replace(/\/+$/, '');

type ToolResult = {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
};

/** Wrap a JSON-serializable payload as a successful MCP text result. */
function ok(payload: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

/** Wrap an error message as a failed MCP text result. */
function fail(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/**
 * Thin fetch helper. On a non-OK response, returns an isError result carrying
 * the HTTP status + a snippet of the body so the caller can see what broke.
 * Otherwise returns the parsed JSON to the supplied formatter.
 */
async function call<T = any>(
  path: string,
  init: RequestInit | undefined,
  format: (data: T) => ToolResult,
): Promise<ToolResult> {
  const urlStr = `${BASE_URL}${path}`;
  let res: Response;
  try {
    res = await fetch(urlStr, init);
  } catch (e: any) {
    return fail(`fetch to ${urlStr} failed: ${e?.message ?? e}`);
  }
  const text = await res.text();
  if (!res.ok) {
    const snippet = text.length > 600 ? `${text.slice(0, 600)}…` : text;
    return fail(`${init?.method ?? 'GET'} ${path} → HTTP ${res.status} ${res.statusText}: ${snippet}`);
  }
  let data: T;
  try {
    data = text ? (JSON.parse(text) as T) : (undefined as T);
  } catch {
    return fail(`${path} returned non-JSON body: ${text.slice(0, 300)}`);
  }
  try {
    return format(data);
  } catch (e: any) {
    return fail(`formatting ${path} response failed: ${e?.message ?? e}`);
  }
}

/** Summarize a serialized mesh-vert-color buffer set without dumping it. */
function summarizeVC(vc: any): Record<string, unknown> | null {
  if (!vc || typeof vc !== 'object') return null;
  const summary: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(vc)) {
    if (Array.isArray(val) || ArrayBuffer.isView(val)) {
      const len = (val as ArrayLike<unknown>).length;
      summary[key] = { length: len, ...(key === 'positions' ? { vertices: Math.floor(len / 3) } : {}) };
    } else if (typeof val === 'number' || typeof val === 'boolean') {
      summary[key] = val;
    } else if (val && typeof val === 'object') {
      summary[key] = '{…}';
    }
  }
  return summary;
}

const server = new McpServer({ name: 'cadtrain', version: '2026-06-13' });

// ── 1. get_manifest ────────────────────────────────────────────────────────
server.registerTool(
  'get_manifest',
  {
    description:
      "Fetch cadtrain's machine-readable operations catalog (GET /api/manifest): " +
      'name, version, conventions, workflow, and the full operation list with request/response shapes. ' +
      'Start here to discover what cadtrain can do.',
    inputSchema: {},
  },
  async () => call('/api/manifest', undefined, (data) => ok(data)),
);

// ── 2. list_parts ───────────────────────────────────────────────────────────
server.registerTool(
  'list_parts',
  {
    description:
      'List every CAD part grouped by category (GET /api/primitives/list): ' +
      '{ basic, completions, stdlib, stdstale, archived } where each Part = { id, name, description, source, params, editable }.',
    inputSchema: {},
  },
  async () => call('/api/primitives/list', undefined, (data) => ok(data)),
);

// ── 3. get_part ─────────────────────────────────────────────────────────────
server.registerTool(
  'get_part',
  {
    description:
      "Fetch one part's typed source file (GET /api/primitives/source?id=<id>). " +
      'Includes meta.graph — the node-graph JSON. Returns { id, source, kind }.',
    inputSchema: {
      id: z.string().describe('The part id, e.g. "g_collar" or "r_cuboid".'),
    },
  },
  async ({ id }) =>
    call(`/api/primitives/source?id=${encodeURIComponent(id)}`, undefined, (data) => ok(data)),
);

// ── 4. prompt_to_cad ─────────────────────────────────────────────────────────
server.registerTool(
  'prompt_to_cad',
  {
    description:
      'AI: turn a natural-language part description into a CAD node-graph ' +
      '(POST /api/rag/prompt — BM25 retrieval over the corpus + one Claude call). ' +
      'Returns { id, candidates, graph } where graph is the composition-graph JSON, ready to seed an editor or bake.',
    inputSchema: {
      prompt: z.string().describe('A natural-language description of the part to design.'),
      k: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe('How many exemplars to retrieve (1–10, default 5).'),
    },
  },
  async ({ prompt, k }) =>
    call(
      '/api/rag/prompt',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(k === undefined ? { prompt } : { prompt, k }),
      },
      (data) => ok(data),
    ),
);

// ── 5. bake_part ─────────────────────────────────────────────────────────────
server.registerTool(
  'bake_part',
  {
    description:
      'Bake a part source to 3D geometry (POST /api/primitives/preview, mode:"sandbox"). ' +
      'Returns a geometry SUMMARY (buffer key names + vertex/element counts) rather than the raw mesh buffers.',
    inputSchema: {
      id: z.string().describe('A part id (used for cache/labelling; any stable string).'),
      name: z.string().describe('The exported geom function name to invoke (the part id for volume parts).'),
      source: z.string().describe('The full typed source of the part (e.g. from prompt_to_cad emit or get_part).'),
      params: z
        .array(z.number())
        .optional()
        .describe('Positional numeric params in meta.params order (default []).'),
    },
  },
  async ({ id, name, source, params }) =>
    call(
      '/api/primitives/preview',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, name, source, params: params ?? [], mode: 'sandbox' }),
      },
      (data: any) =>
        ok({
          ok: data?.ok ?? true,
          cached: data?.cached,
          cutawaySkipped: data?.cutawaySkipped,
          full: summarizeVC(data?.full),
          cutVC: summarizeVC(data?.cutVC),
        }),
    ),
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr only — stdout is the MCP JSON-RPC channel and must stay clean.
  console.error(`cadtrain-mcp connected (base_url=${BASE_URL})`);
}

main().catch((e) => {
  console.error('cadtrain-mcp fatal:', e);
  process.exit(1);
});
