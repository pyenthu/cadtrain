import { describe, it, expect } from 'vitest';
import { parseImports, loadGeomFromSource } from './component-loader';

describe('parseImports — allowlist', () => {
  it('accepts the three valid import shapes', () => {
    const src = `
import { tube, mv, rot, cyl } from '../manifold-helpers';
import { defineGeom } from '.';
import { geom as fooGeom } from './foo';
export const meta = { id: 'x', name: 'X', params: {} };
export const geom = defineGeom(meta, (p) => tube(1, 0, 1));
`;
    const { stripped, deps } = parseImports(src);
    expect(stripped).not.toContain('import');
    expect(deps).toEqual([{ depId: 'foo', specs: [{ imported: 'geom', local: 'fooGeom' }] }]);
  });

  it('rejects a node: import', () => {
    expect(() => parseImports(`import fs from 'node:fs';`)).toThrow();
    expect(() => parseImports(`import { readFile } from 'node:fs';`)).toThrow();
  });

  it('rejects a bare package import', () => {
    expect(() => parseImports(`import x from 'esbuild';`)).toThrow();
    expect(() => parseImports(`import { transformSync } from 'esbuild';`)).toThrow();
  });

  it('rejects parent traversal', () => {
    expect(() => parseImports(`import { x } from '..';`)).toThrow();
    expect(() => parseImports(`import { x } from '../../secrets';`)).toThrow();
  });

  it('rejects a denylisted token in the body', () => {
    expect(() =>
      parseImports(`export const geom = () => { return process.env.SECRET; };`),
    ).toThrow(/process/);
    expect(() =>
      parseImports(`export const geom = () => require('fs');`),
    ).toThrow(/require/);
  });

  it('rejects an aliased helper import', () => {
    expect(() =>
      parseImports(`import { tube as t } from '../manifold-helpers';`),
    ).toThrow();
  });
});

describe('loadGeomFromSource — execute', () => {
  it('runs a self-contained component and yields meta + geom', () => {
    const src = `
import { tube } from '../manifold-helpers';
import { defineGeom } from '.';
export const meta = {
  id: 'unit_tube', name: 'Unit Tube',
  params: { od: { label: 'OD', min: 1, max: 4, step: 0.1, default: 2 } },
} as const;
export const geom = defineGeom(meta, (p) => tube(p.od / 2, p.od / 2 - 0.2, 3));
`;
    const loaded = loadGeomFromSource(src, () => {
      throw new Error('no deps expected');
    });
    expect(loaded.meta.id).toBe('unit_tube');
    expect(typeof loaded.geom).toBe('function');
  });

  it('binds a composition dep through resolveDep', () => {
    const src = `
import { mv } from '../manifold-helpers';
import { geom as baseGeom } from './base';
export const meta = { id: 'comp', name: 'Comp', params: {} };
export const geom = (p) => baseGeom(p);
`;
    const sentinel = { tag: 'base-result' };
    const baseGeom = () => sentinel;
    const loaded = loadGeomFromSource(src, (depId) => {
      expect(depId).toBe('base');
      return { meta: { id: 'base', name: 'Base', params: {} }, geom: baseGeom };
    });
    expect(loaded.geom({})).toBe(sentinel);
  });

  it('throws when meta or geom is missing', () => {
    expect(() =>
      loadGeomFromSource(`export const meta = { id: 'x', name: 'X', params: {} };`, () => {
        throw new Error('no deps');
      }),
    ).toThrow(/must export/);
  });
});
