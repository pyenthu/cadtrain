/** Tailwind CSS config for cadtrain.
 *
 * Added 2026-06-09 to support flowbite-svelte components. cadtrain's
 * existing UI is HAND-ROLLED CSS — to avoid Tailwind's preflight
 * resetting every <button>/<input>/<h1> style in the codebase we set
 * `preflight: false`. Tailwind utility classes still work where used,
 * but no global reset is injected.
 *
 * Content scan is INTENTIONALLY narrow — only files that actually use
 * Tailwind classes (the Flowbite components themselves + any
 * cadtrain file that opts in). Adding './src/**\/*.{svelte,ts}' would
 * make Tailwind scan + ship classes for every hand-rolled file too.
 */
const flowbitePlugin = require('flowbite/plugin');

module.exports = {
  corePlugins: { preflight: false },
  content: [
    './src/**/*.{html,js,svelte,ts}',
    './node_modules/flowbite-svelte/**/*.{html,js,svelte,ts}',
    './node_modules/flowbite/**/*.js',
  ],
  theme: { extend: {} },
  plugins: [flowbitePlugin],
  darkMode: 'class',
};
