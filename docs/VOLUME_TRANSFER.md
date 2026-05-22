# Volume transfer — local ⇄ prod operational reference

Operational detail for the persistent data volume. The *rules* (root
resolution, `volumePath`/`maybeProxy` contract, sub-paths in use) live in
the root `CLAUDE.md` Rule 13. This file holds the commands.

Production URL: **`https://cadtrain.up.railway.app`** (NOT `.com`).

## Local dev → prod volume

Set in `.env.local`:

```
CADTRAIN_VOLUME_REMOTE_URL=https://<service>.up.railway.app
CADTRAIN_VOLUME_TOKEN=<openssl rand -hex 32 — same value on Railway>
```

Every `bun dev` call to `/api/volume` or `/api/kb/source-pdf` then proxies to
prod with `X-Volume-Token`. Single source of truth.

**Auth model**: `CADTRAIN_VOLUME_TOKEN` on prod gates cross-origin requests.
Same-origin browser sessions are trusted without explicit token plumbing. When
the env var is unset locally, the endpoint is open.

## Transfer commands

Run from local against prod. The `Origin` header is required to satisfy
SvelteKit's CSRF guard on PUT/POST/PATCH/DELETE.

```sh
# Upload
curl -X PUT \
  -H "Origin: https://<svc>.up.railway.app" \
  -H "X-Volume-Token: $CADTRAIN_VOLUME_TOKEN" \
  --data-binary @local-bha.pdf \
  "https://<svc>.up.railway.app/api/volume?path=kb-sources/bha-reference.pdf"

# Download
curl -H "X-Volume-Token: $CADTRAIN_VOLUME_TOKEN" \
  "https://<svc>.up.railway.app/api/volume?path=kb-sources/bha-reference.pdf" \
  -o local-bha.pdf

# List a directory (JSON tree, depth 1)
curl -H "X-Volume-Token: $CADTRAIN_VOLUME_TOKEN" \
  "https://<svc>.up.railway.app/api/volume?path=kb-sources"

# Delete
curl -X DELETE \
  -H "Origin: https://<svc>.up.railway.app" \
  -H "X-Volume-Token: $CADTRAIN_VOLUME_TOKEN" \
  "https://<svc>.up.railway.app/api/volume?path=kb-sources/old.pdf"

# mkdir
curl -X POST \
  -H "Origin: https://<svc>.up.railway.app" \
  -H "X-Volume-Token: $CADTRAIN_VOLUME_TOKEN" \
  "https://<svc>.up.railway.app/api/volume?path=archive&action=mkdir"
```

## Upload ceilings (two limits)

1. **adapter-node `BODY_SIZE_LIMIT`** — Dockerfile sets `64M`; a Railway service
   variable of the same name overrides it.
2. **Railway's edge request timeout** — uploads exceeding it 502 ("Application
   failed to respond") regardless of body size.

Files ≳10–15 MB on slow uplinks need a manual transfer (Railway shell / volume
mount). Small/medium files (≤~10 MB) go through fine.

## Verification

Playwright volume spec `tests/e2e/volume.spec.ts` — see `tests/CLAUDE.md` for
the three modes (local / dev-via-proxy / direct-prod).
