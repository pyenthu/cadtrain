// Test stub for SvelteKit's `$env/dynamic/private` virtual module. Vitest has
// no SvelteKit runtime, so server modules that read runtime env (e.g.
// $lib/server/volume) get an empty env here — enough to import them in unit
// tests. Wired in via the `$env/dynamic/private` alias in vitest.config.js.
export const env: Record<string, string | undefined> = {};
