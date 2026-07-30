# App embedding & IP protection — custom elements vs server-compile vs offline package

**Status:** RESEARCH (2026-07-30). Question raised by the user: (a) would Svelte **custom
elements** (`svelte.dev/docs/svelte/custom-elements`) be a good upgrade for the harness? (b)
should `HarnessView` be **on the server** to protect the thin-client bake / our code + structure,
or "**compile and serve** an embeddable window of components"? (c) direction: users build apps but
depend on **our backend to compile**, with an **offline package for trusted users only** (which may
still make API calls).

## TL;DR

- **Custom elements are NOT the protection upgrade.** They are DOM/style *encapsulation*, not code
  *protection* — the compiled component JS + the `.app` still ship to and run in the client. They
  also add Tailwind-in-shadow-DOM friction and do nothing about the WASM COOP/COEP embedding wall.
  Keep them as a *possible later packaging convenience* for same-origin, style-isolated widgets — not
  as the answer to "protect our engine."
- **The real axis is what leaves our origin.** Protection comes from moving **compile + bake to the
  server (engine-as-API, mesh-out)** — the client then receives *geometry* (GLB/mesh), never engine
  source, the compiled script, or the parts structure. This endpoint already exists:
  `/api/primitives/bake-preview` bakes Manifold server-side and returns GLB bytes.
- **The two modes the user described map onto infra we already have** (the `💻`/`☁` client/server
  bake toggle — memory `client_side_execution`):
  - **Hosted (default, protected):** thin client = `HarnessView` + `.app` (declarative) → all
    compile/bake via our backend (`☁`). Client sees only meshes. This IS the SaaS-dependency model.
  - **Offline package (trusted only):** the engine is *bundled* client-side (WASM bake in a worker,
    `💻`) so geometry works with no compile-backend dependency; network optional for non-geometry
    (auth, RAG, AI, data APIs). Ship only to trusted users — it necessarily contains the engine.
- **`HarnessView` stays client-side.** It is a ~thin declarative *interpreter* (renders panels,
  wires verbs to `dispatch`) with no engine logic worth protecting, and it drives an interactive 3D
  canvas (Threlte/WebGL) that cannot run on the server. "On the server" is the wrong framing; what
  must be server-only is **what the harness calls** (compile/bake), not where it runs.

## 1. Svelte custom elements — assessment for us

Compiling a Svelte component to a web component (`<svelte:options customElement="cadtrain-app">`)
lets a **non-Svelte host** (React, plain HTML, wellnew) drop in `<cadtrain-app>` with shadow-DOM
style isolation. Real, but weigh against the documented limitations:

| Limitation (from the docs) | Impact on us |
|---|---|
| "Styles are **encapsulated**, rather than merely scoped … non-component styles will not apply" | Our **Tailwind/Flowbite** plan breaks inside shadow DOM (utility classes need the global sheet). CSS *variables* DO pierce shadow DOM, so our theme (CSS-var palette) survives — but utilities don't. Friction. |
| "not generally suitable for SSR … shadow DOM is invisible until JS loads" | We already run SSR off (WASM is client-only), so no regression — but no SSR win either. |
| **Context doesn't cross custom-element boundaries** | Fine if the WHOLE harness is ONE element (context stays inside). Per-*component* elements would break shared `$state`/context (params/vars/slots). So: one `<cadtrain-app>`, not N component elements. |
| Slots render **eagerly** (vs Svelte lazy) | We nest via **snippets** (`PanelNode` recursion), not native `<slot>`, so this mostly doesn't bite. |
| Polyfills for old browsers | Minor. |

**Two things custom elements do NOT solve:**
1. **Code protection** — the bundle (interpreter + registry + `.app`) is still delivered to the
   browser. Shadow DOM hides nothing from view-source/devtools.
2. **The WASM wall** — a cross-origin embed still needs the *host page* to set COOP/COEP for
   SharedArrayBuffer/pthreads (TrueForm). We can't control a third-party host's headers. (This is the
   exact issue the app-platform notes flag; the engine-as-API path sidesteps it.)

**Verdict:** not now, and not for protection. Revisit only if we specifically need a same-origin,
style-isolated drop-in widget where an iframe is too heavy.

## 2. The protection tiers (what actually leaves the origin)

| Tier | Client receives | Engine exposed? | COOP/COEP host burden | Use |
|---|---|---|---|---|
| **A · Engine-as-API (server bake)** | GLB / mesh only | **No** | None (bake is server) | **Hosted default** — max protection |
| **B · Iframe embed from our origin** | Rendered app in a window | No (our origin serves it) | None (our origin sets headers) | Embed in host pages; protects *structure* too |
| **C · Client bake (`💻`)** | compiled script + WASM engine | **Yes** | Host must set headers | **Offline/trusted package** only |
| **D · Custom element in host** | compiled component + `.app` | Yes (code) | Host must set headers | (not recommended) |

Tiers A + B are the protected, backend-dependent posture. Tier C is the trusted offline package.
D (custom elements) is strictly worse than B for embedding and offers no protection over C.

## 3. Recommended architecture

1. **Default = hosted, backend-dependent (Tier A).** `HarnessView` + `.app` are the thin client; ALL
   geometry goes through our compile/bake API returning **meshes/GLB** (`bake-preview` already does
   this). The client never holds engine source, the compiled script, or the parts library. Force
   `☁` (server bake) in hosted mode.
2. **Protect the STRUCTURE too:** serve apps **by id under auth** (client fetches the `.app` from our
   API, gated) rather than shipping `.app` files; and/or **iframe-embed from cadtrain's origin**
   (Tier B) so a host page gets a window, not our internals. This is the user's "compile and serve an
   embeddable window."
3. **Offline package (Tier C), trusted users only:** a bundled build with the WASM engine + client
   bake (`💻`), self-sufficient for geometry, network-optional for auth/RAG/AI/data. Gate distribution
   (license/trust) because it embeds the engine. A desktop wrapper (Tauri/Electron) or a plain bundled
   SPA is a cleaner package than a custom element.
4. **`HarnessView` remains a client-side declarative interpreter** with zero engine logic — it only
   orchestrates API calls + renders returned geometry. That, not its location, is what keeps the
   protected surface thin. (It already compiles nothing — D1/D5 "declarative, no codegen" — which is a
   protection *feature*: nothing bespoke ships, no `eval`.)
5. **AI stays local at runtime in BOTH modes** (memory `ai_data_residency_local_first`) — orthogonal
   to the geometry-engine split; only the *bake* location differs between hosted and offline.

## 4. What's already in place vs. what's needed

**Have:** server bake → GLB (`/api/primitives/bake-preview`), server compile
(`/api/primitives/compile`), the `💻`/`☁` client/server toggle, the bake cache
(`src/lib/server/bake-cache.ts`), the volume proxy + `X-Volume-Token` auth.

**Need (to realize the model):**
- Make the harness bake through the server GLB path (Tier A) — the `bake3d` panel calls
  `bake-preview` and renders the GLB, instead of any client-side engine execution in hosted mode.
- Serve apps by id under auth (structure protection) + optional iframe host route
  (`/app/[id]?embed=1` already preview-only — add framing/headers for cross-site embed).
- A packaging build for the offline/trusted tier (bundle + engine + license gate).
- Enforce mode: hosted forces `☁`; offline allows `💻`.

## 5. Open questions
- Hosted default: mesh (JSON) or **GLB** to the client? (GLB = smaller, standard, and `bake-preview`
  already emits it.) → recommend GLB.
- Structure protection strength: is serve-by-id-under-auth enough, or do we want iframe isolation from
  day one?
- Offline package target: browser bundle vs Tauri/Electron desktop? (Desktop gives the cleanest COOP/
  COEP + filesystem story for the data-file slots.)
- Licensing/trust gate for the offline tier — out of scope here, but it's the reason to keep C narrow.
