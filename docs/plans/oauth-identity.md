# OAuth Identity Layer — porting SVTC's Google session into cadtrain (2026-05-24)

> Status: PLANNING. Goal: give cadtrain a **server-trusted per-user identity** (`event.locals.userId`) by porting SVTC's Google OAuth + signed-session layer, then unblock the private half of the user-scoped customize directory (`docs/plans/customize-directory.md` Phase 0). Source read-only from `/Users/neerajsethi/code/SVTC`.

## 0. What SVTC actually does (the source we're porting)

SVTC's identity layer is deliberately lightweight — no Auth.js, no arctic/oslo, no DB:

- **OAuth: raw `fetch`, no library.** `auth/google/+server.js` builds the consent URL by hand (`accounts.google.com/o/oauth2/v2/auth`, scope `openid email profile`, `access_type=online`, `prompt=select_account`, `response_type=code`). State is an HMAC-signed `<random>.<base64url(next)>` token, stashed in a short-lived `svtc_oauth_state` cookie scoped to `Path=/auth/google` for CSRF. No PKCE (confidential client — has a `client_secret`).
- **Callback** (`auth/google/callback/+server.js`): verifies the state cookie == query state + signature, POSTs the code to `oauth2.googleapis.com/token`, then GETs `oauth2/v3/userinfo` with the access token (no JWT verification — trusts the HTTPS channel to Google). Profile gives `{ sub, email, name, picture }`.
- **userId = `google:${profile.sub}`** — Google's stable subject, prefixed by provider. (cadtrain will **hash** this; see §4.)
- **Sessions: stateless signed cookies, no server table** (`lib/server/sessions.js`). Cookie `svtc_session = base64url(JSON{userId, exp}) . base64url(HMAC-SHA256(payload, SESSION_SECRET))`. Verified in constant time (`timingSafeEqual`), 30-day TTL, `HttpOnly; SameSite=Lax; Secure`. Logout = clear cookie; global logout = rotate `SESSION_SECRET`.
- **User record** (`lib/server/users.js`): a `users.worksheet.json` on the volume with an in-process write lock + atomic temp-rename. Carries `devGrants`/`roles` (SVTC-specific RBAC — **cadtrain does not need this**).
- **hooks.server.js**: reads the session cookie, looks up the user row, sets `event.locals.user`. Public pages stay public; only the dev surface gates.
- **`+layout.server.js`**: `return { user: locals.user ?? null }` — hands user state to the client tree.
- **CLI flow** (`auth/cli/*`): browser-approves a CLI token request. **Out of scope** for cadtrain — skip entirely.

Key takeaway: the whole thing is ~4 small files of plain Node crypto + fetch. Porting it is mostly transliteration JS→TS plus cadtrain's env-var naming and hook-composition conventions.

## 1. What to port verbatim vs adapt vs drop

| SVTC file | cadtrain target | Verdict |
|---|---|---|
| `lib/server/sessions.js` | `src/lib/server/sessions.ts` | **Port near-verbatim.** Add TS types. Rename cookie `svtc_session` → `cadtrain_session`. Keep the dev-secret fallback warning. Already uses `$env/dynamic/private` — matches Rule 3. |
| `auth/google/+server.js` | `src/routes/auth/google/+server.ts` | **Port + rename env vars** and add `./$types` typing. Keep the signed-state CSRF cookie. |
| `auth/google/callback/+server.js` | `src/routes/auth/google/callback/+server.ts` | **Port + adapt.** Same token-exchange + userinfo fetch. Replace `upsertUserFromOAuth` with cadtrain's `userId = hash(...)` derivation (§4) and a slimmer/absent user store (§3). |
| `lib/server/users.js` | `src/lib/server/users.ts` (slim) or skip | **Adapt — strip RBAC**, or skip entirely for the first slice (the session cookie already carries `userId`; the customize-dir feature needs only `userId`). |
| `hooks.server.js` (auth part) | new `authHandle` in `src/hooks.server.ts` | **Rebuild as a composed handle** via `sequence()` — must run in front of cadtrain's existing proxy + AUTH_TOKEN + rate-limit, not replace it (§2). |
| `+layout.server.js` | `src/routes/+layout.server.ts` | **New file.** cadtrain has no root `+layout.server.ts` today (only `+layout.ts` with `ssr=false`). Note the SSR interaction (§7). |
| `lib/server/driveAuth.js` | — | **Do not port.** Google *service-account* JWT flow for Drive — unrelated to user OAuth. |
| `auth/cli/*` | — | **Drop.** Out of scope. |

### New files cadtrain needs

1. **`src/app.d.ts`** (does not exist today):
   ```ts
   declare global {
     namespace App {
       interface Locals {
         userId: string | null;   // opaque hashed id from the session, or null
         user: { userId: string; email: string; displayName: string; picture?: string } | null;
       }
     }
   }
   export {};
   ```
2. **`src/lib/server/sessions.ts`** — signed-cookie sign/verify/read + `sessionCookie()`/`clearedSessionCookie()`. Cookie `cadtrain_session`. Reads `SESSION_SECRET` via `$env/dynamic/private`.
3. **`src/lib/server/oauth.ts`** — `buildGoogleAuthUrl`, `signState`/`verifyState`, `exchangeCodeForTokens`, `fetchGoogleUserinfo`, `deriveUserId` (§4). Pure fns + fetch, server-only.
4. **`src/routes/auth/google/+server.ts`** — `GET` initiates OAuth (validate `?next=` is relative, set state cookie, 302 to Google).
5. **`src/routes/auth/google/callback/+server.ts`** — `GET` verify state, exchange code, fetch profile, derive `userId`, mint session, 302 to `next`.
6. **`src/routes/auth/logout/+server.ts`** — clears session cookie, 302 to `/`.
7. **`src/routes/+layout.server.ts`** — `load({ locals }) => ({ userId: locals.userId, user: locals.user ?? null })`.
8. **Sign-in/out affordance in `src/routes/+layout.svelte`** — nav: `Sign in with Google` (`/auth/google?next=<path>`) when signed-out, else `{displayName} · Sign out` (`<form method=POST action=/auth/logout>`).

## 2. `hooks.server.ts` integration (composition order)

cadtrain's current single `handle` does, in order: (a) single-store proxy for `VOLUME_PROXY_PATHS`, (b) `AUTH_TOKEN` Bearer gate on `/api/*`, (c) rate-limit, (d) resolve + log. Do **not** rewrite — wrap it with `sequence()` from `@sveltejs/kit/hooks`:

```ts
import { sequence } from '@sveltejs/kit/hooks';

const authHandle: Handle = async ({ event, resolve }) => {
  const sess = readSessionFromRequest(event.request);   // sessions.ts
  event.locals.userId = sess?.userId ?? null;
  return resolve(event);
};
const existingHandle: Handle = async ({ event, resolve }) => { /* current code unchanged */ };
export const handle = sequence(authHandle, existingHandle);
```

**`authHandle` first** so `event.locals.userId` is set before any downstream handler/proxy decision. The proxy still forwards `VOLUME_PROXY_PATHS` to prod — **R3: it carries no user identity**, so the private subtree must NOT be in `VOLUME_PROXY_PATHS`. `AUTH_TOKEN` is orthogonal (coarse demo switch) and unchanged. `userId` comes from the validated cookie ONLY — never a client header/body. The `/auth/*` routes are non-`/api/`, so the AUTH_TOKEN gate doesn't block login.

## 3. Session storage decision

**Adopt SVTC's stateless signed-cookie model; for the first slice keep NO server-side user store.** The cookie carries `userId` — all `event.locals.userId` + the customize-dir need. No DB, no volume file, no proxy interaction, nothing to leak. Logout = clear cookie; revoke-all = rotate `SESSION_SECRET`. Defer a profile store; if wanted later, either embed `email/displayName/picture` in the signed payload (preferred) or write `<volume>/auth/users.json` (SVTC's pattern, RBAC stripped) — and do NOT add it to `VOLUME_PROXY_PATHS`. This sidesteps the "local dev hits prod volume" hazard for auth data entirely.

## 4. `userId` derivation (opaque, filesystem-safe)

```ts
import { createHash } from 'node:crypto';
export function deriveUserId(provider: string, sub: string): string {
  const hex = createHash('sha256').update(`${provider}:${sub}`).digest('hex');
  return `u_${hex.slice(0, 32)}`;     // matches ^[a-z0-9_]+$ and a leading-letter dir check
}
```
The `u_` prefix guarantees a leading non-digit (passes `library.ts` `ID_RE = /^[a-z][a-z0-9_]*$/`). Session stores the **hashed** id; the raw Google sub never leaves the callback. Add a secret salt to the hash input if stronger unlinkability is wanted. `deriveUserId` is the single source of truth — no path is ever built from a raw email/sub.

## 5. Then the customize-dir build (folding in `customize-directory.md`)

**Public category (no identity — can ship first):** add `'public'` to `LIBRARY_CATEGORIES` (`library.ts:41`); `resolvePart`/`listLibraryParts`/`categoryDir`/`partDirIn`/`ensureLibrary` iterate the tuple, so it drops in free. Layout `<volume>/components/public/<id>/`. Allow `visibility:'public'` on save.

**Private per-user tree (REQUIRES OAuth):** new `library.ts` helpers keyed on a server-passed `userId` (never client input): `userPartDir(userId, id)`, `resolveUserPart(userId, id)` (null unless owned), `listUserParts(userId)`. Validate `userId` `^[a-z0-9_]+$` + `safeVolumePath` (R7). Private axis `<volume>/components/<userId>/<id>/` is invisible to the public resolvers (they iterate only `LIBRARY_CATEGORIES`).

**Risk closures against real code:**
- **R2 — `/api/volume/+server.ts` raw CRUD bypass (biggest hole).** Whole-volume CRUD gated only by `checkVolumeAuth` (same-origin trusted). A logged-in browser is same-origin → can read/write any `components/<otherUserId>/...`. **Fix:** in all four handlers, after `safeVolumePath`, if the path is under `components/<seg>/` where `<seg>` is not a `LIBRARY_CATEGORIES` member (i.e. a private namespace) AND `<seg> !== event.locals.userId` → `403`. Close in the same phase private ships.
- **R3 — proxy carries no identity.** `maybeProxy` (`volume.ts:96`) forwards `X-Volume-Token` + spoofed `Origin`, no `userId`, and does NOT forward the session cookie. **Fix:** keep private-part endpoints out of `VOLUME_PROXY_PATHS` (local-only in dev). Public parts can proxy.
- **R4 — list-cache leakage.** `/api/components/list` cache must be **keyed by `userId`** (or exclude private). Contract: `list = bundle ∪ public ∪ caller's-private`, each tagged `visibility`.
- **R5 — id-namespace collision.** Two users may reuse an `id` privately. Scope id-collision checks to the user dir (`resolveUserPart`), not the global tree. Public ids stay globally unique.
- **R6 — untrusted volume execution.** Private parts are `part.json` recipes (no `.ts` sandbox per Rule 17); `STRICT_RECIPE_CALLS` already constrains them — add a negative test.

**Endpoints to touch:** `components/save` (visibility + owner = `locals.userId`, never body), `list` (merge + per-userId cache), `move`/`delete`/`rename`/`geom`/`picture` (owner-only for private ids), `api/volume` (R2 path guard).

## 6. Env vars the USER must provision (names only — never write values; Rule 15)

Set in **Google Cloud Console** (create OAuth 2.0 Web client), **Railway → Variables** (prod), and local **`.env`/`.env.local`** (dev).

| Variable | Where | Purpose |
|---|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | Console → Railway + local | Public OAuth client id. |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Console → Railway + local | Confidential secret. **Rotate if pasted into chat.** |
| `GOOGLE_OAUTH_REDIRECT_URI` | Railway + local | Exact registered callback. Prod `https://cadtrain.up.railway.app/auth/google/callback`; local `http://localhost:3333/auth/google/callback` — register BOTH. |
| `SESSION_SECRET` | Railway + local | HMAC key for session + state cookies. Strong random (`openssl rand -base64 48`). Rotating = global logout. |

All read via `$env/dynamic/private` (Rule 3). Confidential web client → **no PKCE** (matches SVTC). Console steps: project → consent screen (External, scopes `openid email profile`) → Credentials → OAuth client ID → Web application → add both redirect URIs → copy id+secret into env.

## 7. Risks / open questions

- **Redirect URIs** must match exactly; a custom domain later = a third registered URI + per-env `GOOGLE_OAUTH_REDIRECT_URI`. Decide one client w/ multiple URIs vs per-env clients.
- **`ssr=false` interaction.** `+layout.ts` sets `ssr=false` (WASM). A `+layout.server.ts` `load` STILL runs server-side and serializes `data` to the client, so the nav can show sign-in state. Verify in cadtrain's SvelteKit version; fallback = a tiny `/api/me` the layout fetches client-side. OAuth routes are `+server.ts`, unaffected by `ssr=false`.
- **Session cookie not proxied** (R3 restated): in dev, `VOLUME_PROXY_PATHS` requests go to prod without the session cookie → prod never sees the dev user. Exactly why private endpoints stay local-only.
- **Gate whole app vs just private?** Recommendation: **do NOT gate the whole app** — `/components`, `/primitives`, `/volume`, public parts stay open; only private create/read/write require `locals.userId`, enforced server-side, with a sign-in CTA. `AUTH_TOKEN` demo switch unchanged.
- **Migration.** `AUTH_TOKEN` + `CADTRAIN_VOLUME_TOKEN` keep working; the session is additive. New constraint: the R2 guard denies a token-only (no-session) caller into any `components/<userId>/` private path. Recommendation: private is session-only; admin maintenance uses direct host volume access.

## 8. Phasing — smallest shippable first

- **P1 — Public category (no identity).** `'public'` in `LIBRARY_CATEGORIES` + a "Public" sidebar group + `visibility:'public'` on save. Ships today.
- **P2 — OAuth identity slice (core of this plan):** `app.d.ts` → `sessions.ts` → `oauth.ts` → `auth/google/{,callback}` + `logout` → `authHandle`+`sequence()` in hooks (existing body untouched) → `+layout.server.ts` + nav affordance. No server-side user store. **Done =** Google sign-in works, `event.locals.userId` is a stable hashed id on every request, nav shows state, app stays usable signed-out. e2e: sign-in redirect resolves; signed-out app still loads.
- **P3 — Private parts (REQUIRES P2):** user-scoped `library.ts` resolvers; owner enforcement in `components/{save,list,move,delete,rename,geom,picture}`; close R2 (`/api/volume` guard), R4 (cache by userId), R3 (private out of proxy), R5 (id-collision scoped); "My Parts" UI + sign-in CTA. Negative e2e: user A can't read/list/write user B's private parts via `/api/components/*` OR `/api/volume`.

The first shippable slice is **P1** (no auth) then **P2** (the unblocker for P3).

## Critical files
- `src/hooks.server.ts` — compose `authHandle` via `sequence()`; existing proxy/AUTH_TOKEN/rate-limit body unchanged
- `src/lib/server/library.ts` — `public` category + `userPartDir`/`resolveUserPart`/`listUserParts`; R4/R5
- `src/lib/server/volume.ts` + `src/routes/api/volume/+server.ts` — R2 per-user path guard behind `safeVolumePath`; R3 proxy carries no identity
- `/Users/neerajsethi/code/SVTC/src/lib/server/sessions.js` + `.../auth/google/callback/+server.js` — the source to transliterate into `sessions.ts` + `callback/+server.ts`
