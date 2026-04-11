/**
 * Main dev server — serves landing page + proxies to tool viewers
 *
 * Run: bun serve.ts
 *
 * Routes:
 *   /                    → Landing page (index.html)
 *   /components/         → Component library (Vite on 3334)
 *   /viewer/             → Training tabs (Vite on 3336)
 *   /training_data/      → Static training data files
 *   /BOTTOM_SUB/         → Static files
 *   /RATCH_LATCH/        → Static files
 */

const port = 3333;
const base = import.meta.dir; // directory of this file

Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    // Landing page
    if (path === '/' || path === '/index.html') {
      return new Response(Bun.file(`${base}/index.html`));
    }

    // Static files
    const staticFile = Bun.file(`${base}${path}`);
    if (await staticFile.exists()) {
      return new Response(staticFile);
    }

    return new Response('Not found', { status: 404 });
  },
});

console.log(`\n  CAD Train landing page: http://localhost:${port}/`);
console.log(`\n  Start viewers separately:`);
console.log(`    Components:  cd components && npx vite --config vite.config.ts`);
console.log(`    Training:    npx vite --config vite.config.ts`);
console.log(`    Bottom Sub:  cd BOTTOM_SUB/manifold && npx vite --config vite.config.ts`);
console.log(`    Ratch-Latch: cd RATCH_LATCH/manifold && npx vite --config vite.config.ts\n`);
