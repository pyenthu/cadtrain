# cadtrain Public API (`/api/v1`) — integrator guide (STUB)

> **Status: PROPOSED.** This documents the planned external API. The design,
> auth model, and roadmap live in **`docs/plans/external-api.md`** — read that
> first. Routes below are *planned*, not all shipped.

cadtrain exposes parametric downhole-tool CAD as a service: **the operations
are ours; you build your own drawing UI + AI prompting on top.** Today the
self-describing seed is the live `GET /api/manifest`.

## Quickstart (planned shape)

```bash
# 1. Get a scoped API key (minted by an admin; see external-api.md §3).
export CADTRAIN_TOKEN=ctk_v1_...

# 2. Discover the surface.
curl -H "Authorization: Bearer $CADTRAIN_TOKEN" \
  https://cadtrain.up.railway.app/api/v1/manifest

# 3. List parts.
curl -H "Authorization: Bearer $CADTRAIN_TOKEN" \
  https://cadtrain.up.railway.app/api/v1/parts

# 4. Fetch one part (typed source + meta + node-graph).
curl -H "Authorization: Bearer $CADTRAIN_TOKEN" \
  https://cadtrain.up.railway.app/api/v1/parts/g_collar

# 5. Bake to GLB.
curl -X POST -H "Authorization: Bearer $CADTRAIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"source":"...","name":"g_collar","params":[3,1,0.25]}' \
  https://cadtrain.up.railway.app/api/v1/bake.glb

# 6. Design from a description (Claude-backed).
curl -X POST -H "Authorization: Bearer $CADTRAIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"3 in OD collar, 1 in bore, chamfered top"}' \
  https://cadtrain.up.railway.app/api/v1/design
```

## Scopes
`read` (catalog/source/metadata) ⊂ `bake` (geometry compute) ⊂ `author`
(design/translate/save) ⊂ `admin` (issue/revoke keys).

## Conventions
- **Units**: oilfield — inches for geometry. **Z-down**: top = lower z; +z goes
  down-hole.
- **Geometry formats**: mesh-JSON (`/bake`), GLB (`/bake.glb`), SVG (`/bake.svg`).
- **Graph**: parts carry a composition-graph (`Call/Container/Method/Mv/Rot/
  Repeat/Polygon/PolyRepeat`); `/api/v1/design` returns one.
- **Errors**: `{ error: { code, message, hint?, depChain?, errorKind? } }`.

## LLM / agent integration (planned)
- `GET /sdk/llms.txt` · `GET /sdk/llms-full.txt` — paste-once context bundle.
- `GET /api/v1/tools` — Anthropic tool-use schemas for each operation.
- `GET /api/v1/rag/search?q=` — find exemplar parts before designing.
- MCP bridge: `sdk/mcp/cadtrain-mcp.mjs` (`cadtrain_search/get_part/design/bake`).

See **`docs/plans/external-api.md`** for the full design, auth, directory
layout, OpenAPI plan, and phased roadmap.
</content>
