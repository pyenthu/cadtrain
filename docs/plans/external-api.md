# External API / SDK — cadtrain as an importable CAD service (2026-06-14)

> Status: **PLANNING ONLY** — design + roadmap, no endpoint code in this pass.
> Goal: let **another app embed cadtrain** (serve parts, the editor canvas,
> the bake/build mechanism, the authoring methodology) and let an **LLM agent
> drive it programmatically** through a versioned, documented, key-gated
> public API. Reconcile into `/plan` (Rule 19) once the phases are scoped.
>
> Sibling source studied read-only: `/Users/neerajsethi/code/SVTC` — which has
> already shipped almost exactly this (external-plugin SDK + token registry +
> `/sdk/llms.txt` + MCP). We adopt its proven primitives and differ where the
> domain differs (we serve *geometry operations*, SVTC serves *plugin hosting*).

---

## 0. What already exists (don't rebuild it)

cadtrain is further along than the customize-dir plan implies. The external
surface is partially scaffolded:

- **`src/hooks.server.ts`** already has:
  - CORS for external apps (`corsHeadersFor`, gated on `CORS_ORIGINS` env,
    `*`-or-allowlist, preflight `OPTIONS` answered before auth — `:104-139`).
  - A coarse `AUTH_TOKEN` Bearer gate over all `/api/*` (`:176-186`).
  - A flood guard (300/10s) on `/api/primitives/source` (`:86-88,195-203`).
  - An empty-but-wired rate-limit extension point (`RATE_LIMITED_PREFIXES`).
- **`GET /api/manifest`** (`src/routes/api/manifest/+server.ts`) — a
  hand-authored, machine-readable capability catalog: `{ name, version,
  base_url, conventions, workflow, operations[] }` listing `list_parts`,
  `get_part`, `prompt_to_cad`, `bake_part`, `authoring_vocab`. **This is the
  seed of the `/api/v1` manifest** — promote and version it.
- **`POST /api/primitives/describe`** — Claude-generated markdown "drawing
  descriptor" for a part. An LLM-facing doc generator already exists.
- The whole `/api/primitives/*` data layer, proxy-aware via
  `VOLUME_PROXY_PATHS` + `maybeProxy` (`src/lib/server/volume.ts:96`).

So the work is mostly **layering a stable, key-scoped, versioned facade** over
existing endpoints — not building geometry plumbing from scratch.

---

## 1. Goal + use cases

| # | Actor | Use case |
|---|---|---|
| U1 | Another web app | Browse + render cadtrain parts in its own UI (read catalog, fetch source/metadata, bake to mesh-JSON / GLB / SVG). |
| U2 | Another web app | Embed the editor canvas (iframe `?embed=1` today; later a mountable component) so its users author parts. |
| U3 | LLM agent (MCP or raw HTTP) | "Design a downhole collar 3 in OD, 1 in bore, chamfered" → `prompt_to_cad` → graph → bake → fetch GLB. End-to-end programmatic authoring. |
| U4 | Integrator backend | Persist app-scoped parts (per-integration namespace) without colliding with the shared library. |
| U5 | LLM / human | Discover capabilities (`/api/v1/manifest`, `/sdk/llms.txt`, tool-call JSON schemas) and self-orient. |

The product framing is the one already in `/api/manifest`: **"the operations
are ours; build your own drawing UI + AI prompting on top."**

---

## 2. API surface design — `/api/v1/*`

A **versioned facade** under `/api/v1/`. It does NOT duplicate logic — each v1
route is a thin, documented, scope-checked wrapper that calls the existing
internal handler (or re-exports it). Internal `/api/primitives/*` stays as-is
for the first-party app; `/api/v1/*` is the contract external integrators code
against (stable shapes, structured errors, semver).

Three verb classes, mapped to scopes (§3):

### READ — serve parts / canvas / geometry (scope `read`)
| v1 operation | Wraps | Shape |
|---|---|---|
| `GET /api/v1/manifest` | `/api/manifest` | capability catalog + version + workflow. |
| `GET /api/v1/parts` | `/api/primitives/list` | `{ parts: Part[] }`, `Part = { id, kind, category, name, description, params, editable }`. Optional `?category=&family=`. |
| `GET /api/v1/parts/{id}` | `/api/primitives/source` | `{ id, kind, source, meta, graph }` — typed source + parsed `meta` + `meta.graph` (the node-graph JSON). |
| `GET /api/v1/parts/{id}/describe` | `/api/primitives/describe` | `{ markdown }` drawing descriptor (cacheable). |
| `GET /api/v1/vocabulary` | `/api/primitives/instructions` | authoring vocab + rules an agent follows. |
| `GET /api/v1/rag/search?q=&k=` | `rag-corpus` BM25 (new thin read) | `{ records: RagRecord[] }` — discovery surface over `ai/rag/parts.jsonl`. |

### EXECUTE — bake / render geometry (scope `bake`; stateless compute)
| v1 operation | Wraps | Shape |
|---|---|---|
| `POST /api/v1/bake` | `/api/primitives/preview` | `{ source, name, params[] }` → `{ full:{positions,normals,colors,indices}, cutVC? }` mesh-JSON. |
| `POST /api/v1/bake.glb` | `/api/primitives/bake-preview` | → `{ full:<b64 GLB>, cut?:<b64 GLB> }`. |
| `POST /api/v1/bake.svg` | `/api/primitives/preview` (coarse `segments`) | 2D vector drawing (the SVG-tab coarse path). |

Bake stays **local/stateless** (not proxied — see `VOLUME_PROXY_PATHS`
exclusions) so it's a fast WASM compute call an external app can hammer
(subject to rate-limit).

### AUTHOR — design by prompting / save (scope `author`; writes)
| v1 operation | Wraps | Shape |
|---|---|---|
| `POST /api/v1/design` | `/api/rag/prompt` | `{ prompt, k? }` → `{ id, candidates[], graph }`. The "design by NL" core. |
| `POST /api/v1/translate` | `rule-translator` (new thin route) | `{ rule }` (vocabulary-schema JSON) → `{ id, source }`. Deterministic, no LLM — constrained generation target. |
| `POST /api/v1/parts` | `/api/primitives/save` | `{ id, source, category, appId }` → persists into the **app-scoped** dir (§4). |
| `PATCH /api/v1/parts/{id}` / `DELETE` | save/delete/rename | owner-scoped to the calling app. |

### Resource model
- **Part** = `{ id, kind: prim|exp|rev|asm, category, name, description,
  params: Record<name,{default,min?,max?,units?}>, meta, graph?, source? }`.
  Source is *optional in list*, included on `GET /parts/{id}` (§7 IP note).
- **Graph** = the composition-graph JSON (`Call/Container/Method/Mv/Rot/
  Repeat/Polygon/PolyRepeat`, `ArgValue = literal|expr|param`) —
  `src/lib/graph/composition-graph.ts`. The canonical authoring artifact.
- **Geometry** = mesh-JSON (`preview`) | GLB bytes (`bake-preview`) | SVG.

### Structured errors (all v1)
`{ error: { code, message, hint?, depChain?, errorKind? } }` with stable
`code` strings (`bad_request`, `unauthorized`, `forbidden_scope`,
`not_found`, `bake_failed`, `wasm_oob`, `empty_solid`, `rate_limited`). Note
`/preview` already emits `errorKind` + `depChain` (`wasm-oob`, `empty-solid`)
— v1 just normalizes the envelope.

---

## 3. Authorization mechanism

**Adopt SVTC's bearer-token registry verbatim in shape** (proven, hashed,
cached) and keep cadtrain's existing `AUTH_TOKEN` as the orthogonal demo
switch. OAuth (per the deferred `docs/plans/oauth-identity.md`) is a *separate*,
later, human-identity axis — API keys are the machine-identity axis and ship
first.

### API keys (machine identity — Phase 2)
Modeled on `/Users/neerajsethi/code/SVTC/src/lib/server/externalAuth.js`:

- **Token format**: `ctk_v1_<24-bytes-base64url>` (~190 bits). Returned to the
  integrator **once**, never retrievable again.
- **Storage (Rule 15 — never plaintext)**: hash the bearer, store only the
  hash + metadata on the volume:
  ```
  tokenId = sha256(bearer).hex().slice(0,16)
  <volume>/apps/_tokens/<tokenId>.json
    { tokenId, appId, scopes:["read","bake"], label, createdAt, revoked, revokedAt }
  ```
  Atomic temp-rename write (Rule 4). 60s in-memory cache per tokenId to spare
  the FS (SVTC's pattern). The raw token never touches disk.
- **Scopes**: `read` ⊂ `bake` ⊂ `author` ⊂ `admin`. A key carries an explicit
  scope array; v1 routes assert the required scope. `admin` can issue/revoke
  and act for any `appId`.
- **Per-app rate limit**: extend the existing token-bucket
  (`src/lib/rate_limit.ts`) — key buckets by `appId` not just IP. Wire via the
  already-present `RATE_LIMITED_PREFIXES` extension point. `author`/`design`
  (Claude-backed, costs money) get a tight bucket; `read` a generous one.
- **Issuance bootstrap**: a master `CADTRAIN_ADMIN_KEY` env var (Railway
  Variables / `.env`, never chat — Rule 15) mints the first app tokens via
  `POST /api/v1/admin/tokens { appId, scopes, label }`. Revoke via `DELETE`.

### `hooks.server.ts` gating for `/api/v1/*`
Compose a new `apiKeyHandle` via `sequence()` (the same composition pattern the
OAuth plan prescribes — `oauth-identity.md §2`), running **before** the
existing handle body:

```ts
export const handle = sequence(apiKeyHandle, existingHandle);
// apiKeyHandle: only for /api/v1/* — resolve bearer → token record →
//   event.locals.app = { appId, scopes } | null; 401 if required, never trust
//   any client-sent appId. Leaves the interactive app + AUTH_TOKEN untouched.
```

- `/api/v1/*` requires a valid app token (no anonymous), **distinct from** the
  interactive `/api/primitives/*` surface which the first-party app reaches
  same-origin / via `AUTH_TOKEN`.
- CORS already exists; `/api/v1/*` responses get the same `CORS_ORIGINS`
  treatment. A browser SDK sends `Authorization: Bearer ctk_...` (not a cookie
  credential, so `*` + Authorization stays valid — see the hook comment).
- **No secrets to disk / no echo** (Rule 15): issuance flags the one-time
  reveal in the response body only; storage is the hash. Env entry points are
  Railway Variables / `.env` / console.

### Relationship to OAuth (human identity — later)
`docs/plans/oauth-identity.md` gives a per-*user* `event.locals.userId`. API
keys give a per-*app* `event.locals.app.appId`. They coexist: an app key may
act on its own `apps/<appId>/` namespace; a future user session acts on
`components/<userId>/`. The R2/R3/R4 holes the OAuth plan calls out (raw
`/api/volume` CRUD bypass, proxy carries no identity, list-cache leakage) apply
identically to app-scoped writes — **close them in the same phase app-writes
ship**, with the path guard: refuse writes under `apps/<seg>/` unless
`<seg> === event.locals.app.appId`.

---

## 4. New directory structure

### On-volume data — app-scoped parts
Mirror SVTC's `external/<devId>/` namespace. Add an `apps/` axis alongside the
existing `primitives/` tree (Rule 13):

```
<volume>/
  primitives/<cat>/<id>.{prim,exp,rev,asm}.ts   ← shared library (unchanged)
  apps/
    _tokens/<tokenId>.json                       ← hashed API-key registry
    <appId>/
      primitives/<cat>/<id>.<kind>.ts            ← this app's private parts
      data/...                                    ← app-scoped KV/blob storage (opt)
```

- `apps/<appId>/primitives/` is resolved by **the same `primitive-paths.ts`
  resolver**, parameterized by a root override (today `findPrim` hardcodes
  `volumePath('primitives')` — add an optional `rootRel` arg). Keeps "location
  IS category" (Rule 16) and one resolver (the 2026-05-23 drift lesson).
- App-private parts stay **out of `VOLUME_PROXY_PATHS`** (R3 — the proxy
  carries no app identity). Shared-library reads can proxy.
- `appId` validated `^[a-z][a-z0-9_]*$` + `safeVolumePath` (R7 traversal).
- This is the same axis the deferred `customize-directory.md` reserves for
  `<userId>/` — `appId` and `userId` are sibling namespaces; build the
  generic "owner-scoped subtree" resolver once.

### Source code layout
```
src/routes/api/v1/
  manifest/+server.ts          parts/+server.ts           parts/[id]/+server.ts
  parts/[id]/describe/+server.ts
  bake/+server.ts   bake.glb/+server.ts   bake.svg/+server.ts
  design/+server.ts   translate/+server.ts
  rag/search/+server.ts
  admin/tokens/+server.ts
src/routes/sdk/                  ← public, CORS, docs (llms.txt, types, version)
src/lib/server/api-keys.ts       ← issue/verify/revoke (port externalAuth.js)
src/lib/server/api-v1.ts         ← scope assertion + error envelope helpers
docs/api/openapi.yaml            ← spec (propose; §5)
docs/api/README.md               ← human integrator guide (stub shipped here)
```

---

## 5. API documentation

Two artifacts, kept in lockstep with the real routes (SvelteKit has no OpenAPI
autogen — the `/api/manifest` comment already notes this):

1. **`docs/api/openapi.yaml`** — OpenAPI 3.1 spec. Hand-authored per operation
   (typed request/response schemas, `securitySchemes: bearerAuth`, per-op
   scope). Propose now; author incrementally as each v1 route lands. A CI lint
   (`bun x @redocly/cli lint`) keeps it valid. The `OPERATIONS[]` array already
   in `/api/manifest` is the skeleton to expand into full schemas.
2. **`docs/api/README.md`** — human quickstart: get a key → call `/api/v1/parts`
   → bake → render. Stub shipped alongside this plan.
3. **Self-describing runtime**: `GET /api/v1/manifest` (machine) +
   `GET /sdk/version` (feature matrix, SVTC-style) so a client discovers the
   surface at runtime without shipping the spec.

---

## 6. LLM-friendliness

The leverage already exists (`rag-corpus.ts`, `docs/parts/vocabulary.json`,
`/api/rag/prompt`, the deterministic `rule-translator.ts`). Expose it as a
first-class agent surface, SVTC-style:

- **`GET /sdk/llms.txt`** + **`/sdk/llms-full.txt`** (public, CORS `*`): a
  paste-once bundle = orientation + conventions (Z-down, oilfield units, the
  graph model) + the operation list + worked examples. SVTC ships exactly this
  at `/sdk/llms.txt`; copy the structure.
- **Tool-call JSON schemas**: emit each v1 operation as an Anthropic
  tool-use definition (`{ name, description, input_schema }`) at
  `GET /api/v1/tools`. An agent loads them and calls operations directly. These
  are the same schemas as the OpenAPI op bodies — generate one from the other.
- **MCP server** (`sdk/mcp/cadtrain-mcp.mjs`): thin Node bridge exposing
  `cadtrain_search` / `cadtrain_get_part` / `cadtrain_design` / `cadtrain_bake`
  for Claude Code / Desktop. SVTC ships `@svtc/mcp-server`; mirror it. Config
  carries `CADTRAIN_HOST` + `CADTRAIN_TOKEN` + `CADTRAIN_APP_ID`.
- **RAG corpus as discovery**: `GET /api/v1/rag/search` over
  `ai/rag/parts.jsonl` lets an agent find exemplars before designing — the
  Rule-24 "RAG-then-translate" loop, exposed.
- **Stable IDs + structured errors** (§2) so agents can retry deterministically.
- **Worked example** (ships in `llms-full.txt`):
  `POST /api/v1/design {prompt}` → graph → `POST /api/v1/bake.glb {source,name,
  params}` → fetch GLB → render. End-to-end "describe → drawing".

### IP protection
Some construction source is proprietary and should not leave the server.
Per-part `meta.visibility: 'source' | 'baked-only'`:
- `baked-only` parts serve **geometry** (mesh/GLB/SVG) and **metadata**
  (params, description) but **not `source`/`graph`** via `GET /parts/{id}` —
  the agent can render + parameterize but can't read the recipe.
- Ties to the deferred WASM-conceal idea (`todo_wasm_deferred`): the bake runs
  server-side (or as opaque WASM), the recipe never ships. Default `source`
  for the open library; `baked-only` opt-in per app/part.

---

## 7. Phased roadmap

Effort = rough; Risk noted. Reconcile into `/plan` (Rule 19) when scoped.

| Phase | Scope | Deliverable | Effort | Risk |
|---|---|---|---|---|
| **V1.0 Read-only** | `GET /api/v1/{manifest,parts,parts/{id},vocabulary}` + `POST /api/v1/bake{,.glb,.svg}`. Thin wrappers over existing handlers; structured-error envelope; `AUTH_TOKEN`-gated (no per-app keys yet). | Serve parts + geometry to an external app. | S–M | **Low** — reuses shipped endpoints; CORS already exists. |
| **V1.1 Keys + scopes** | `api-keys.ts` (port SVTC `externalAuth.js`), `apps/_tokens/`, `apiKeyHandle` via `sequence()`, `admin/tokens` issue/revoke, per-`appId` rate-limit. | External apps self-authenticate with scoped keys. | M | **Med** — security-critical; hashed storage, no plaintext (Rule 15); needs a negative test (revoked/bad scope → 403). |
| **V1.2 Author / execute** | `POST /api/v1/design` (rag/prompt), `/translate` (rule-translator), `POST/PATCH/DELETE /api/v1/parts` writing to `apps/<appId>/`. Close R2 (`/api/volume` path guard), R3 (no proxy), R4 (cache by appId). | Agents + apps author + persist app-scoped parts. | M–L | **High** — write surface + Claude cost + the owner-enforcement holes from `oauth-identity.md`/`customize-directory.md` apply. |
| **V1.3 LLM manifest** | `/sdk/{llms.txt,llms-full.txt,version}`, `GET /api/v1/tools` (tool-use schemas), `docs/api/openapi.yaml`, MCP bridge. | An agent self-orients + drives end-to-end. | M | **Low** — additive docs/manifest; no new write surface. |
| **V1.4 Embeddable canvas** | Harden the `?embed=1` iframe (postMessage API: load graph, on-change, on-bake), or a published web-component wrapper of `GraphEditorPane`. IP-conceal (`baked-only`) for proprietary parts. | Host apps embed the live editor. | L | **Med** — `ssr=false` + WASM + cross-origin asset loading; the heaviest surface. |

Ship order: **read-only first** (immediate value, lowest risk), then keys,
then author/execute (where the security work concentrates), then the LLM
manifest, then the embeddable canvas.

---

## 8. Key decisions made

1. **Facade, not fork** — `/api/v1/*` thin-wraps existing handlers; no
   geometry logic duplicated. The existing `/api/manifest` is the seed.
2. **Two identity axes** — per-app API keys (machine, ships first) are
   orthogonal to the deferred per-user OAuth (human). Both reuse one
   owner-scoped subtree resolver and the same R2–R4 hole closures.
3. **Adopt SVTC wholesale** for token registry (hashed, cached, scoped),
   `/sdk/llms.txt`, `/sdk/version`, and the MCP bridge — it's proven and the
   volume/proxy/session primitives already came from SVTC.
4. **`apps/<appId>/` on-volume namespace**, resolved by the *same*
   `primitive-paths.ts` (parameterized root) — one resolver, Rule 16 intact.
5. **IP via `meta.visibility: baked-only`** — serve geometry, withhold source;
   bridges to the WASM-conceal idea.

### What SVTC tells us to adopt
- `externalAuth.js`: `ctk_v1_` token, `sha256(bearer).slice(0,16)` id, hashed
  on-disk record, 60s cache, `dev`/`admin` scopes, issue-once reveal.
- Three-tier auth: bearer registry → session cookie fallback → env master key.
- `/sdk/*` public CORS docs + `llms.txt`/`llms-full.txt`/`version` feature
  matrix + an MCP server with `upload/list/get` tools.
- Scoped storage namespace `external/<devId>/` ⇒ our `apps/<appId>/`.
- Volume path-safety + resolution order are already identical (cadtrain's
  `volume.ts` is modeled on SVTC's `volumePaths.js`).

### What to differ
- We serve **geometry operations**, not plugin hosting — no Svelte-compile /
  import-rewrite / mount pipeline (SVTC's biggest subsystem). Skip it unless
  V1.4 wants hosted custom UI.
- Finer scopes than SVTC's `dev`/`admin`: `read`/`bake`/`author`/`admin`.
- Our "upload" is a **part graph/source**, not a compiled component bundle.

---

## 9. Open questions for the user

1. **Keys vs OAuth first?** Recommend API keys (machine) first; OAuth (human)
   stays deferred. Confirm machine-first.
2. **Who issues keys?** Self-serve console (needs OAuth for the issuing user)
   vs. you mint them manually via `CADTRAIN_ADMIN_KEY`. Recommend manual mint
   for V1.1, self-serve later.
3. **App-scoped writes in V1.2, or read-only API indefinitely?** The write
   surface is where the security cost lives. Is U4 (per-app persistence) in
   scope, or is "serve + bake the shared library" enough?
4. **IP posture** — is any current part proprietary enough to need
   `baked-only` now, or is the whole library open for V1.0?
5. **Embeddable canvas (V1.4)** — iframe-postMessage (cheap) vs published web
   component (expensive)? Defer until there's a concrete host app?
6. **MCP vs raw HTTP** for the primary agent path — both, or prioritize one?

---

## Critical files
- `src/hooks.server.ts` — add `apiKeyHandle` via `sequence()`; CORS + AUTH_TOKEN + flood-guard already here.
- `src/routes/api/manifest/+server.ts` — promote → `/api/v1/manifest`; the `OPERATIONS[]` skeleton → OpenAPI.
- `src/lib/server/volume.ts` + `primitive-paths.ts` — parameterize the resolver root for `apps/<appId>/`; close the `/api/volume` R2 path guard.
- `src/routes/api/primitives/{preview,bake-preview,source,list,save}/+server.ts` — the handlers v1 wraps.
- `src/lib/server/rag-corpus.ts` + `src/lib/authoring/rule-translator.ts` — the LLM-facing design/translate path.
- **Port from**: `/Users/neerajsethi/code/SVTC/src/lib/server/externalAuth.js`, `/Users/neerajsethi/code/SVTC/src/routes/sdk/*`, `/Users/neerajsethi/code/SVTC/sdk/mcp/*`.
- Cross-reference: `docs/plans/oauth-identity.md` (human identity), `docs/plans/customize-directory.md` (owner-scoped subtree, R2–R7).
</content>
</invoke>
