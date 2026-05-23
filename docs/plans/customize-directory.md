# User-scoped customize directory — public + private parts (2026-05-23)

> Status: PLANNING. User-owned customized parts on the volume: **PUBLIC**
> (anyone posts/reads) + **PRIVATE** (per-user, owner-only). User decision:
> the user space is `volume/<userId>/` where **`userId` is an opaque hash**.

## ⚠️ Honest verdict — gated on real per-user auth
The app authenticates with a **single shared secret** only: `AUTH_TOKEN`
(`hooks.server.ts:77-87`) + `X-Volume-Token`/same-origin (`volume.ts:checkVolumeAuth`).
There is **no `app.d.ts`, no `event.locals`, no cookies/sessions, no OAuth, no
per-user identity** anywhere. Everyone reaching the app is cryptographically the
SAME principal. → **PUBLIC can ship now** (it's a new category). **PRIVATE cannot
be private** until a real identity layer exists — keying "private" off anything
the client sends (a header / a chosen username) is **cosmetic privacy** (any user
reads/writes any other's). Don't ship that.

## Identity prerequisite (Phase 0 — lead with this)
Add a server-trusted `userId` on `event.locals` via a real session:
- **OAuth (recommended)** — GitHub/Google via `@auth/sveltekit` (Auth.js) or
  `arctic`+`oslo`, composed into `hooks.server.ts` via `sequence()` (keeps the
  existing AUTH_TOKEN/proxy/rate-limit hook). Verified, stable `userId` (provider
  subject), no password storage.
- Contract: `src/app.d.ts` → `App.Locals.userId: string | null`, populated by the
  auth handle. **`userId` = an opaque, filesystem-safe HASH** (e.g.
  `sha256(provider + ':' + sub)` slugged to `^[a-z0-9_]+$`) — matches the user's
  "userid can be a hash". The client NEVER sends its own userId; the server reads
  it from the validated session cookie only.
- "private" is exactly as strong as (identity verification) × (server enforcement).

## Volume layout
Coexists with the existing `components/<category>/<id>/` (Rule 18, location=category):
```
<volume>/components/
  test/ basic/ parts/ assemblies/   ← unchanged
  public/<id>/                      ← NEW: 1 new category (add to LIBRARY_CATEGORIES)
  <userId>/<id>/                    ← NEW: per-user private (userId = hash)
```
- `public` is just a 5th category → `resolvePart`/`listLibraryParts` pick it up free.
- `<userId>/` is a NEW axis (owner encoded in the path — drift-free, Rule-18 spirit).
  Validate `userId` `^[a-z0-9_]+$` + route through `safeVolumePath` (no traversal).

## Server-side access control (the real enforcement)
All gated on `event.locals.userId` — never client input. New `library.ts` helpers:
`publicCategoryDir()`, `userPartDir(userId, id)`, `resolveUserPart(userId, id)`
(returns null unless owned by caller), `listUserParts(userId)`. Gate
save/geom/picture/move/delete/rename for private ids on owner match.
- **R2 — the biggest hole:** `/api/volume` is a raw whole-volume CRUD
  (`volume/+server.ts`), same-origin-trusted, bypassing the components endpoints.
  Until it path-guards `components/<userId>/` (refuse unless matches caller's
  userId) the private tree is world-readable. MUST close in Phase 2.
- **R3 — proxy carries no identity:** the single-store proxy forwards with the
  shared token + no user → don't proxy the private subtree (keep private local
  until a verified per-user remote session exists).
- **R4 — list cache leakage:** the global list cache must be keyed by userId or
  private parts excluded, else A's private parts serve to B.

## Endpoints
- `list` = bundle ∪ public ∪ caller's private; add `visibility` to entries.
- `save` = `visibility:'public'|'private'`; owner = `locals.userId` (never body);
  scope id-collision checks to the user dir (two users may reuse an id — R5).
- `move`/`delete`/`rename` = owner-only for private; publish = copy user→public.

## UI
Sidebar: "Public" group + "My Parts" (private; sign-in CTA when `userId` null);
public/private toggle on Save (default private for signed-in, force public signed-out).

## Phasing
- **P0** identity (prereq for privacy). **P1** public library (can ship before P0).
  **P2** private (REQUIRES P0): user-scoped resolvers + close /api/volume hole +
  key cache by userId + don't proxy private + "My Parts" UI. Negative e2e (A can't
  read B's private).

## Risks (R1–R7)
R1 cosmetic privacy w/o P0 (showstopper) · R2 /api/volume raw CRUD hole · R3 proxy
no identity · R4 list-cache leak · R5 global-id-namespace assumption · R6 untrusted
volume `.ts` exec applies to private too (sandbox keyed on file, verify) · R7
userId path-injection (validate + safeVolumePath).

### Critical files
`hooks.server.ts` (auth chain + locals.userId) · `library.ts` (public category +
user-scoped resolvers) · `volume.ts` (close /api/volume + proxy holes for
`components/<userId>/`) · `components/save` (visibility + owner) · `components/list`
(merge + user-scope the cache) · NEW `src/app.d.ts`.
