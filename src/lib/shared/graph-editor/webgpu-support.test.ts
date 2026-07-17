import { describe, it, expect } from 'vitest';
import { webgpuSupported, type GpuNavigatorLike } from './webgpu-support';

describe('webgpuSupported — pure WebGPU feature-detect guard', () => {
  it('returns false when navigator has no gpu entry point', () => {
    expect(webgpuSupported({})).toBe(false);
    expect(webgpuSupported({ gpu: undefined })).toBe(false);
    expect(webgpuSupported({ gpu: null })).toBe(false);
  });

  it('returns true when a gpu entry point is present', () => {
    // A truthy `gpu` object (the real one is a `GPU`; a stub is enough here —
    // the guard only checks presence, not usability).
    expect(webgpuSupported({ gpu: {} })).toBe(true);
    const fakeGpu: GpuNavigatorLike = { gpu: { requestAdapter: () => Promise.resolve(null) } };
    expect(webgpuSupported(fakeGpu)).toBe(true);
  });

  it('is false for null / a nullish navigator', () => {
    expect(webgpuSupported(null)).toBe(false);
  });

  it('runs headless: the Node global navigator (no .gpu) resolves to false', () => {
    // The vitest env is `node`. Whether or not a global `navigator` exists,
    // it has no WebGPU, so the default (no-arg) path must be false — proving
    // the guard never throws on a server/headless surface.
    expect(webgpuSupported()).toBe(false);
  });
});
