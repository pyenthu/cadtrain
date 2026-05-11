/**
 * Backend smoke tests — verify the API endpoints accept the right
 * request shapes, reject malformed input correctly, and (when
 * CADTRAIN_E2E_LIVE=1) actually return well-formed responses from
 * Claude.
 *
 * Live tests are gated because they:
 *   - Burn ANTHROPIC_API_KEY tokens (~$0.05 per identify call,
 *     ~$0.20 per wells extract call)
 *   - Are non-deterministic (model output varies)
 *   - Take 5-30 seconds each
 *
 * Without CADTRAIN_E2E_LIVE=1, only structural tests run:
 *   - Right HTTP status on missing/malformed input
 *   - Right error messages
 *   - Right field names recognised by the form parser
 *
 * Fixtures used by live tests:
 *   - static/eval/wells/Ananas-13-Rig109-Workover_Report_*.png  (104 KB)
 *   - static/eval/components/prim_setting_cone.png              (small)
 *
 * Catches: API contract drift between identify/wells backends and
 * the SvelteKit endpoint handlers. Phase 0 (commit 43f04df) refactored
 * both backends — this is the regression test for that.
 */

import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const LIVE = process.env.CADTRAIN_E2E_LIVE === '1';
const liveTest = LIVE ? test : test.skip;

// ---------- /api/wells/extract ----------

test.describe('/api/wells/extract', () => {
  test('rejects request without multipart body (400)', async ({ request }) => {
    const res = await request.post('/api/wells/extract', {
      data: 'not-a-form',
      headers: { 'Content-Type': 'text/plain' },
    });
    expect(res.status()).toBe(400);
    const body = await res.text();
    expect(body).toMatch(/multipart\/form-data/i);
  });

  test('rejects multipart without `file` field (400)', async ({ request }) => {
    const res = await request.post('/api/wells/extract', {
      multipart: {
        text: 'no file attached, just text',
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.text();
    expect(body).toMatch(/no .file. field/i);
  });

  liveTest('extracts WSON from a real well doc image (LIVE)', async ({ request }) => {
    const fixturePath = join(
      process.cwd(),
      'static/eval/wells/Ananas-13-Rig109-Workover_Report_CEW_ESP_WSO-BP_-Dec_11_2021.png',
    );
    if (!existsSync(fixturePath)) {
      test.skip(true, `fixture missing: ${fixturePath}`);
      return;
    }
    const file = readFileSync(fixturePath);
    const res = await request.post('/api/wells/extract', {
      multipart: {
        file: {
          name: 'Ananas-13.png',
          mimeType: 'image/png',
          buffer: file,
        },
      },
      timeout: 60_000,
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('wson');
    expect(body).toHaveProperty('issues');
    expect(body).toHaveProperty('model');
    expect(body).toHaveProperty('backend');
    expect(Array.isArray(body.issues)).toBe(true);
  });
});

// ---------- /api/identify ----------

test.describe('/api/identify', () => {
  test('rejects request without `image` field (400)', async ({ request }) => {
    const res = await request.post('/api/identify', {
      multipart: {
        notimage: 'wrong field name',
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.text();
    expect(body).toMatch(/no image file/i);
  });

  liveTest('identifies a primitive render (LIVE)', async ({ request }) => {
    // Pick the smallest available primitive render
    const candidates = [
      'static/eval/components/prim_setting_cone.png',
      'static/eval/components/prim_shoulder_step.png',
      'training_data/prim_packer_element/images/var_1.png',
    ];
    const fixturePath = candidates
      .map((p) => join(process.cwd(), p))
      .find((p) => existsSync(p));
    if (!fixturePath) {
      test.skip(true, `no primitive render fixture found in candidates`);
      return;
    }
    const file = readFileSync(fixturePath);
    const res = await request.post('/api/identify', {
      multipart: {
        image: {
          name: 'primitive.png',
          mimeType: 'image/png',
          buffer: file,
        },
      },
      timeout: 60_000,
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    // Response is a flattened result + metadata fields:
    //   { component_id, confidence, ..., retrieved_examples, _backend, _model, _ms }
    expect(body).toHaveProperty('component_id');
    expect(body).toHaveProperty('confidence');
    expect(body).toHaveProperty('retrieved_examples');
    expect(body).toHaveProperty('_backend');
    expect(body).toHaveProperty('_model');
    expect(typeof body._ms).toBe('number');
    expect(Array.isArray(body.retrieved_examples)).toBe(true);
  });
});

// ---------- Mode banner ----------

test('mode banner', async () => {
  if (LIVE) {
    console.log('\n🟢  CADTRAIN_E2E_LIVE=1 — running live API tests (will burn ANTHROPIC_API_KEY tokens)');
  } else {
    console.log('\n⚪  Live tests skipped. Set CADTRAIN_E2E_LIVE=1 to enable (will hit Claude API).');
  }
});
