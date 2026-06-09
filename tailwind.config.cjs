/** Tailwind CSS config for cadtrain.
 *
 * Added 2026-06-09 to support flowbite-svelte components. cadtrain's
 * existing UI is HAND-ROLLED CSS — to avoid Tailwind's preflight
 * resetting every <button>/<input>/<h1> style in the codebase we set
 * `preflight: false`. Tailwind utility classes still work where used,
 * but no global reset is injected.
 *
 * Content scan covers cadtrain source + the flowbite-svelte node_modules
 * (the components reference Tailwind classes from inside the package, so
 * Tailwind needs to see them to generate the utility CSS).
 *
 * `primary` colour palette extension is REQUIRED by flowbite-svelte —
 * its components reference `bg-primary-*`, `hover:text-primary-500`,
 * etc. Without it those classes silently no-op and the components look
 * unstyled. We use Flowbite's red-leaning default (matches the existing
 * cadtrain brand red `#cc2222`).
 */
const flowbitePlugin = require('flowbite/plugin');

module.exports = {
  corePlugins: { preflight: false },
  content: [
    './src/**/*.{html,js,svelte,ts}',
    './node_modules/flowbite-svelte/**/*.{html,js,svelte,ts}',
    './node_modules/flowbite/**/*.js',
  ],
  theme: {
    extend: {
      colors: {
        // Flowbite's standard `primary` palette aliased to a red ramp so
        // hover / active / focus states render in the cadtrain brand red.
        primary: {
          50:  '#fdf2f2',
          100: '#fde8e8',
          200: '#fbd5d5',
          300: '#f8b4b4',
          400: '#f98080',
          500: '#cc2222', // brand red
          600: '#a91d1d',
          700: '#8c1717',
          800: '#771d1d',
          900: '#641e1e',
        },
      },
    },
  },
  plugins: [flowbitePlugin],
  darkMode: 'class',
};
