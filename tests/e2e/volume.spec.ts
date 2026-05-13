/**
 * Volume access tests — exercise the /api/volume CRUD endpoint and the
 * /api/kb/sources lister against the configured backend.
 *
 * Two run modes:
 *
 *   1. Dev (default) — runs against the Playwright-managed dev server
 *      on port 4445. When CADTRAIN_VOLUME_REMOTE_URL + _TOKEN are set
 *      in the env (via .env.local or the shell), the dev server's
 *      maybeProxy() forwards every call to production. Without them,
 *      it reads/writes the local ./.dev-volume/ folder.
 *
 *   2. Prod — runs identical assertions directly against the production
 *      URL. Enabled by setting PROD_VOLUME_URL=https://<svc>.up.railway.app
 *      + PROD_VOLUME_TOKEN=<same token as Railway>. When either is
 *      missing, the prod-side tests are skipped (not failed) so the
 *      spec can run in either setup without env plumbing.
 *
 * Run examples:
 *
 *   # Dev only, local .dev-volume folder:
 *   bun run test:e2e tests/e2e/volume.spec.ts
 *
 *   # Dev proxying to prod (proves the proxy path works):
 *   CADTRAIN_VOLUME_REMOTE_URL=https://<svc>.up.railway.app \
 *   CADTRAIN_VOLUME_TOKEN=<token> \
 *   bun run test:e2e tests/e2e/volume.spec.ts
 *
 *   # Direct prod (proves prod natively serves the API):
 *   PROD_VOLUME_URL=https://<svc>.up.railway.app \
 *   PROD_VOLUME_TOKEN=<token> \
 *   bun run test:e2e tests/e2e/volume.spec.ts
 *
 * Both env-var pairs can be set together — runs all assertions.
 */

import { test, expect, request as pwRequest } from '@playwright/test';

const PROD_URL = process.env.PROD_VOLUME_URL;
const PROD_TOKEN = process.env.PROD_VOLUME_TOKEN;

// A path nested under archive/ so a botched test doesn't pollute the
// real kb-sources/ tree. Unique per-run via timestamp so parallel
// runs don't collide.
function testPath(): string {
  return `archive/playwright-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`;
}

test.describe('Volume CRUD — dev server (with proxy when env configured)', () => {
  test('PUT then GET round-trip returns identical bytes', async ({ request, baseURL }) => {
    const path = testPath();
    const payload = `cadtrain volume roundtrip ${new Date().toISOString()}`;

    const put = await request.put(`${baseURL}/api/volume?path=${encodeURIComponent(path)}`, {
      data: payload,
      headers: { 'content-type': 'text/plain' },
    });
    expect(put.status(), 'PUT must succeed').toBe(200);

    const get = await request.get(`${baseURL}/api/volume?path=${encodeURIComponent(path)}`);
    expect(get.status(), 'GET must succeed').toBe(200);
    const body = await get.text();
    expect(body, 'round-tripped bytes must match payload').toBe(payload);

    const del = await request.delete(`${baseURL}/api/volume?path=${encodeURIComponent(path)}`);
    expect([200, 204].includes(del.status()), 'DELETE must succeed').toBe(true);
  });

  test('/api/kb/sources returns a list (possibly empty)', async ({ request, baseURL }) => {
    const r = await request.get(`${baseURL}/api/kb/sources`);
    expect(r.status(), 'kb/sources must return 200').toBe(200);
    const payload = await r.json();
    // Endpoint shape: { sources: [...], error?: string }
    expect(payload).toHaveProperty('sources');
    expect(Array.isArray(payload.sources), 'sources must be an array').toBe(true);
  });
});

// Skip the entire prod block when the env vars aren't configured. Better
// than per-test skips because it keeps the test report focused.
test.describe('Volume CRUD — direct production', () => {
  test.skip(!PROD_URL || !PROD_TOKEN, 'Set PROD_VOLUME_URL + PROD_VOLUME_TOKEN to enable prod tests');

  test('PUT then GET round-trip on prod returns identical bytes', async () => {
    const ctx = await pwRequest.newContext({
      baseURL: PROD_URL,
      extraHTTPHeaders: {
        'X-Volume-Token': PROD_TOKEN!,
        // SvelteKit CSRF guard rejects PUT/POST/PATCH/DELETE without a
        // matching Origin header. Set it explicitly here — the
        // Playwright `request` context doesn't add one automatically
        // for non-browser HTTP calls.
        Origin: PROD_URL!,
      },
    });
    try {
      const path = testPath();
      const payload = `cadtrain prod roundtrip ${new Date().toISOString()}`;

      const put = await ctx.put(`/api/volume?path=${encodeURIComponent(path)}`, {
        data: payload,
        headers: { 'content-type': 'text/plain' },
      });
      expect(put.status(), `PUT must succeed (got ${put.status()})`).toBe(200);

      const get = await ctx.get(`/api/volume?path=${encodeURIComponent(path)}`);
      expect(get.status(), 'GET must succeed').toBe(200);
      const body = await get.text();
      expect(body, 'round-tripped bytes must match payload').toBe(payload);

      const del = await ctx.delete(`/api/volume?path=${encodeURIComponent(path)}`);
      expect([200, 204].includes(del.status()), 'DELETE must succeed').toBe(true);
    } finally {
      await ctx.dispose();
    }
  });

  test('Prod /api/kb/sources returns a list', async () => {
    const ctx = await pwRequest.newContext({
      baseURL: PROD_URL,
      extraHTTPHeaders: {
        'X-Volume-Token': PROD_TOKEN!,
        // SvelteKit CSRF guard rejects PUT/POST/PATCH/DELETE without a
        // matching Origin header. Set it explicitly here — the
        // Playwright `request` context doesn't add one automatically
        // for non-browser HTTP calls.
        Origin: PROD_URL!,
      },
    });
    try {
      const r = await ctx.get('/api/kb/sources');
      expect(r.status(), 'prod kb/sources must return 200').toBe(200);
      const payload = await r.json();
      expect(payload).toHaveProperty('sources');
      expect(Array.isArray(payload.sources), 'sources must be an array').toBe(true);
    } finally {
      await ctx.dispose();
    }
  });

  test('Components overlay: list returns origin field and includes volume entries', async () => {
    const ctx = await pwRequest.newContext({
      baseURL: PROD_URL,
      extraHTTPHeaders: { 'X-Volume-Token': PROD_TOKEN!, Origin: PROD_URL! },
    });
    try {
      const r = await ctx.get('/api/components/list');
      expect(r.status(), 'list must return 200').toBe(200);
      const items = await r.json();
      expect(Array.isArray(items), 'list payload must be an array').toBe(true);
      expect(items.length, 'bundled baseline must be present (>= 11 basic)').toBeGreaterThan(10);
      for (const e of items) {
        expect(e).toHaveProperty('id');
        expect(e).toHaveProperty('origin');
        expect(['bundle', 'volume'].includes(e.origin), `origin must be bundle|volume (got ${e.origin})`).toBe(true);
        expect(typeof e.hasGeom).toBe('boolean');
      }
    } finally {
      await ctx.dispose();
    }
  });

  test('Components save: write new primitive to volume, list surfaces it as origin=volume', async () => {
    const ctx = await pwRequest.newContext({
      baseURL: PROD_URL,
      extraHTTPHeaders: { 'X-Volume-Token': PROD_TOKEN!, Origin: PROD_URL! },
    });
    try {
      const id = `pw_probe_${Date.now()}`;
      const source = `// Playwright-generated probe primitive — safe to delete.
import { tube } from '../manifold-helpers';
import { defineGeom } from '.';
export const meta = {
  id: '${id}',
  name: 'Playwright Probe',
  description: 'Volume-overlay round-trip probe.',
  tags: ['probe'],
  params: {
    od: { label: 'OD', min: 1, max: 5, step: 0.1, unit: 'in', default: 2 },
    length: { label: 'Length', min: 1, max: 8, step: 0.1, unit: 'in', default: 3 },
  },
} as const;
export const geom = defineGeom(meta, (p) => tube(p.od/2, p.od/2 - 0.2, p.length));
`;

      // Create — should write to <volume>/components/<id>.ts
      const save = await ctx.post('/api/components/save', {
        data: { id, source, create: true },
      });
      expect(save.status(), 'save must return 200').toBe(200);
      const saveBody = await save.json();
      expect(saveBody.ok, 'save body.ok must be true').toBe(true);

      try {
        // List should now include the new id with origin=volume and hasGeom=false
        // (no bundle entry for this brand-new id).
        const r = await ctx.get('/api/components/list');
        const items = await r.json();
        const found = items.find((e: any) => e.id === id);
        expect(found, `${id} must appear in list after save`).toBeTruthy();
        expect(found.origin).toBe('volume');
        expect(found.hasGeom, 'brand-new volume-only id has no bundled geom').toBe(false);
      } finally {
        // Cleanup: DELETE returns ok even when GLB doesn't exist.
        await ctx.delete('/api/components/delete', { data: { id } });
      }
    } finally {
      await ctx.dispose();
    }
  });

  test('Cross-instance visibility: dev write is visible to prod read', async ({ request, baseURL }) => {
    // Only meaningful if the dev server is itself proxying to the same prod.
    // Otherwise this test would write to local .dev-volume and try to read
    // it on prod (which would 404, correctly).
    test.skip(
      !process.env.CADTRAIN_VOLUME_REMOTE_URL,
      'Set CADTRAIN_VOLUME_REMOTE_URL so the dev server proxies to the same prod we read from',
    );
    const path = testPath();
    const payload = `cadtrain cross-instance ${new Date().toISOString()}`;

    // Write via the dev server's proxy
    const put = await request.put(`${baseURL}/api/volume?path=${encodeURIComponent(path)}`, {
      data: payload,
    });
    expect(put.status(), 'dev-side PUT must succeed').toBe(200);

    // Read directly from prod
    const prodCtx = await pwRequest.newContext({
      baseURL: PROD_URL,
      extraHTTPHeaders: { 'X-Volume-Token': PROD_TOKEN! },
    });
    try {
      const get = await prodCtx.get(`/api/volume?path=${encodeURIComponent(path)}`);
      expect(get.status(), 'prod-side GET must succeed').toBe(200);
      const body = await get.text();
      expect(body, 'prod must see what dev wrote').toBe(payload);

      // Cleanup via prod
      await prodCtx.delete(`/api/volume?path=${encodeURIComponent(path)}`);
    } finally {
      await prodCtx.dispose();
    }
  });
});
