import { defineConfig } from 'vitest/config';
import path from 'node:path';

const r = (p) => path.resolve(process.cwd(), p);

export default defineConfig({
  resolve: {
    alias: {
      // SvelteKit aliases vitest must mirror so server modules import in tests.
      $lib: r('src/lib'),
      // No SvelteKit runtime in tests → stub the runtime-env virtual module.
      '$env/dynamic/private': r('src/lib/test-stubs/env-dynamic-private.ts'),
    },
  },
  test: {
    include: ['src/**/*.{test,spec}.{js,ts}'],
    environment: 'node',
    globals: false,
  },
});
