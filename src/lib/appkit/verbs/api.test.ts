import { describe, it, expect, vi, afterEach } from 'vitest';
import { httpCall } from './api';

function jsonResponse(body: unknown) {
  return {
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

afterEach(() => vi.unstubAllGlobals());

describe('httpCall', () => {
  it('GET returns parsed JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: true, n: 3 })));
    const r = await httpCall({ url: '/api/x' });
    expect(r).toEqual({ ok: true, n: 3 });
  });

  it('pick selects a nested path (feed a list panel)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: { items: [1, 2, 3] } })));
    const r = await httpCall({ url: '/api/x', pick: 'data.items' });
    expect(r).toEqual([1, 2, 3]);
  });

  it('POST JSON-encodes the body + sets content-type', async () => {
    const spy = vi.fn(async () => jsonResponse({ saved: true }));
    vi.stubGlobal('fetch', spy);
    await httpCall({ url: '/api/save', method: 'post', body: { a: 1 } });
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe('/api/save');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"a":1}');
    expect(init.headers['content-type']).toBe('application/json');
  });

  it('throws without a url', async () => {
    await expect(httpCall({} as any)).rejects.toThrow(/needs a url/);
  });
});
