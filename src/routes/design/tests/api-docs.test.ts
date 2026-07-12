import { describe, it, expect } from 'vitest';
import { apiDocs } from '../api-docs';

/**
 * Guards the AUTO-GENERATED api-docs.ts snapshot (produced by
 * scripts/gen-api-docs.mjs from the graphify graph). Asserts the shape the
 * /design "Docs" tab will consume: at least one real endpoint under
 * src/routes/api/, and at least one public export from src/lib.
 */
describe('apiDocs snapshot', () => {
  it('exposes the three catalogs', () => {
    expect(Array.isArray(apiDocs.endpoints)).toBe(true);
    expect(Array.isArray(apiDocs.exports)).toBe(true);
    expect(Array.isArray(apiDocs.modules)).toBe(true);
  });

  it('has >= 1 endpoint whose file is under src/routes/api/', () => {
    const apiEndpoints = apiDocs.endpoints.filter((e) => e.file.startsWith('src/routes/api/'));
    expect(apiEndpoints.length).toBeGreaterThanOrEqual(1);
    // every endpoint is a +server.ts route with an /api/... route path
    for (const e of apiDocs.endpoints) {
      expect(e.file).toMatch(/^src\/routes\/api\/.*\/\+server\.ts$/);
      expect(e.route.startsWith('/api/')).toBe(true);
      expect(Array.isArray(e.methods)).toBe(true);
    }
  });

  it('has >= 1 public export across src/lib', () => {
    expect(apiDocs.exports.length).toBeGreaterThanOrEqual(1);
    for (const x of apiDocs.exports) {
      expect(x.file.startsWith('src/lib/')).toBe(true);
      expect(x.name.length).toBeGreaterThan(0);
    }
  });

  it('summarizes at least one lib module with counts', () => {
    expect(apiDocs.modules.length).toBeGreaterThanOrEqual(1);
    for (const m of apiDocs.modules) {
      expect(m.path.startsWith('src/lib')).toBe(true);
      expect(m.files).toBeGreaterThanOrEqual(0);
      expect(m.exports).toBeGreaterThanOrEqual(0);
      expect(m.summary.length).toBeGreaterThan(0);
    }
  });

  it('meta counts match the emitted arrays', () => {
    expect(apiDocs.meta.endpointCount).toBe(apiDocs.endpoints.length);
    expect(apiDocs.meta.exportCount).toBe(apiDocs.exports.length);
    expect(apiDocs.meta.moduleCount).toBe(apiDocs.modules.length);
  });
});
