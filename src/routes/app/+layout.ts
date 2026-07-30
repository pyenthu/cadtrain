// /app/* is SERVER-RENDERED (app-server-render.md): the server resolves engine data +
// paints first (SSR), then the client hydrates for full Svelte reactivity. This overrides
// the global ssr=false (which exists because ManifoldCAD WASM is client-only) — the harness
// render path touches no WASM, so it SSRs cleanly; any WASM/3D lives in client islands.
export const ssr = true;
export const csr = true;
export const prerender = false;
