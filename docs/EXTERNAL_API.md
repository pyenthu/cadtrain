# External API — cadtrain MCP bridge

**"The operation is ours, the design is theirs."** cadtrain exposes its CAD
operations so an external AI app — Claude Desktop, Cursor, or a custom agent —
can build its own drawing UI and AI prompting on top. There are two ways in:

1. **Direct HTTP.** Read [`GET /api/manifest`](../src/routes/api/manifest/+server.ts)
   for the self-describing operations catalog, then call the documented
   endpoints directly.
2. **MCP server (this doc).** `scripts/cadtrain-mcp.ts` is a thin
   [Model Context Protocol](https://modelcontextprotocol.io) server that wraps
   the same endpoints as MCP tools over the stdio transport. Each tool is a
   `fetch` wrapper over one cadtrain HTTP endpoint — no business logic of its
   own. The tool list mirrors `/api/manifest`.

## What it is

A stdio MCP server (`McpServer` + `StdioServerTransport` from
`@modelcontextprotocol/sdk`). It does **not** host cadtrain — it talks to a
**running** cadtrain server over HTTP. Start cadtrain (or point at prod), then
start this bridge.

## Run

```bash
bun scripts/cadtrain-mcp.ts
```

The server speaks JSON-RPC on stdout and logs a one-line status to stderr. It
runs until the client disconnects.

### Environment

| Var | Default | Purpose |
|---|---|---|
| `CADTRAIN_BASE_URL` | `http://localhost:3333` | Base URL of the running cadtrain server the tools call. Set it to `https://cadtrain.up.railway.app` to drive prod. |

```bash
CADTRAIN_BASE_URL=https://cadtrain.up.railway.app bun scripts/cadtrain-mcp.ts
```

## Connect an MCP client

Point any MCP client at the command. Example client config (Claude Desktop's
`claude_desktop_config.json`, Cursor's `mcp.json`, etc.):

```json
{
  "mcpServers": {
    "cadtrain": {
      "command": "bun",
      "args": ["scripts/cadtrain-mcp.ts"],
      "cwd": "/Users/neerajsethi/code/cadtrain",
      "env": {
        "CADTRAIN_BASE_URL": "http://localhost:3333"
      }
    }
  }
}
```

Use an absolute path for `cwd` (or absolute path to the script in `args`) so the
client can launch it from anywhere. Make sure a cadtrain server is reachable at
`CADTRAIN_BASE_URL` before the client starts a tool call.

## Tools

| Tool | Input | Wraps | Returns |
|---|---|---|---|
| `get_manifest` | — | `GET /api/manifest` | The operations catalog (name, version, conventions, workflow, operations). |
| `list_parts` | — | `GET /api/primitives/list` | Parts grouped by category: `{ basic, completions, stdlib, stdstale, archived }`, each `Part = { id, name, description, source, params, editable }`. |
| `get_part` | `{ id: string }` | `GET /api/primitives/source?id=<id>` | `{ id, source, kind }` — the typed source incl. `meta.graph`. |
| `prompt_to_cad` | `{ prompt: string, k?: number }` | `POST /api/rag/prompt` | `{ id, candidates, graph }` — a composition-graph JSON synthesized from the prompt (BM25 retrieval + one Claude call). |
| `bake_part` | `{ id: string, name: string, source: string, params?: number[] }` | `POST /api/primitives/preview` (`mode:"sandbox"`) | A geometry **summary** — buffer key names + vertex/element counts (e.g. `full.positions.length` / `.vertices`), not the raw mesh buffers. |

Every tool returns `{ content: [{ type: "text", text: "<JSON>" }] }`. On a
non-OK HTTP response the result is flagged `isError: true` and the text carries
the method, path, status, and a body snippet.

### Typical workflow

```
prompt_to_cad → graph          # design by prompting
get_part / list_parts          # browse + remix existing parts
bake_part → geometry summary   # verify the source bakes to a mesh
```

Conventions (also in the manifest): oilfield units (inches), **Z-down** (top =
lower z, +z goes down-hole). Parts carry a composition-graph; `prompt_to_cad`
returns one and `bake_part` consumes emitted source.

## Notes

- The bridge holds no secrets. AI operations (`prompt_to_cad`) need
  `ANTHROPIC_API_KEY` configured on the **cadtrain server**, not here.
- `bake_part` summarizes geometry on purpose — full mesh buffers can be large.
  Use the HTTP endpoint directly if you need the raw `positions/normals/colors/
  indices`.
- Dependency: `@modelcontextprotocol/sdk` (stdio transport) + `zod` for input
  schemas.
