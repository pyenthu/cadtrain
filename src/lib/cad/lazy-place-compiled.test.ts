/**
 * The CLIENT bake path runs a COMPILED SCRIPT whose `autoPlace` is a hand-written
 * twin of the one in `primitive-loader.ts`. If the two drift, the browser fuses
 * overlapping parts while the server keeps them separate — a bug that would only
 * ever show up visually. Pin the twin here.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { compilePrimitiveScript } from '$lib/server/primitive-loader';
import { SANDBOX_ARG_NAMES, sandboxArgValues } from './primitive-sandbox';
import { initManifold } from './manifold-helpers';

beforeAll(async () => { await initManifold(); }, 120_000);

const noDeps: typeof fetch = (async () => { throw new Error('no deps expected'); }) as any;

// Two nested cylinders: compose would swallow the inner one.
const NESTED = `
export const meta = { id: 'lz_nested', name: 'lz_nested', kind: 'asm', uses: [], params: {} };
export function lz_nested() { return [cyl(10, 5), cyl(10, 2)]; }`;

async function runScriptRaw(source: string, name: string): Promise<any> {
  const { script } = await compilePrimitiveScript(source, name, noDeps);
  const geomFn = new Function(...SANDBOX_ARG_NAMES, script)(...sandboxArgValues());
  return geomFn({});
}

describe('compiled script: lazy compose twin', () => {
  it('the emitted script carries the lazy-place implementation', async () => {
    const { script } = await compilePrimitiveScript(NESTED, 'lz_nested', noDeps);
    expect(script).toContain('__lazyPlace');
    expect(script).toContain('__isLazyPlace');
    // `await` must not force the union — the guard has to be in the twin too.
    expect(script).toContain("prop === 'then'");
  });

  it('keeps both bodies as _parts and does not compose to expose them', async () => {
    const out = await runScriptRaw(NESTED, 'lz_nested');
    expect(out.__isLazyPlace).toBe(true);
    expect(out._parts).toHaveLength(2);
    const [outer, inner] = out._parts;
    expect(inner.volume()).toBeGreaterThan(0);          // survived
    expect(inner.volume()).toBeLessThan(outer.volume());
    expect(out.__composedOrNull).toBeNull();            // union never ran
  });

  it('still yields a usable single body on demand', async () => {
    const out = await runScriptRaw(NESTED, 'lz_nested');
    expect(typeof out.volume()).toBe('number');
    expect(out.__composedOrNull).not.toBeNull();
    // Composing nested bodies IS a union: the merged volume is the outer body's.
    expect(out.volume()).toBeCloseTo(out._parts[0].volume(), 3);
  });
});
