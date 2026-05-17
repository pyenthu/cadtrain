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

describe('split-init-composition grammar (Stage A loader gate)', () => {
  it('accepts a single instance with no composition (vacuous)', () => {
    const src = `
import { cyl } from '../manifold-helpers';
import { defineGeom } from '.';
export const meta = { id: 'a', name: 'A', params: {} } as const;
export const geom = defineGeom(meta, (p, geom) => {
  let A = cyl(1, 0.5);
  geom.add(A);
});
`;
    expect(() => loadGeomFromSource(src, () => { throw new Error('no deps'); })).not.toThrow();
  });

  it('accepts the split layout (every decl above all geom.<op> calls)', () => {
    const src = `
import { cyl } from '../manifold-helpers';
import { defineGeom } from '.';
export const meta = { id: 'a', name: 'A', params: {} } as const;
export const geom = defineGeom(meta, (p, geom) => {
  let A = cyl(1, 0.5);
  let B = cyl(1, 0.4);
  geom.add(A);
  geom.subtract(B);
});
`;
    expect(() => loadGeomFromSource(src, () => { throw new Error('no deps'); })).not.toThrow();
  });

  it('rejects an interleaved layout with a line number', () => {
    const src = `
import { cyl } from '../manifold-helpers';
import { defineGeom } from '.';
export const meta = { id: 'a', name: 'A', params: {} } as const;
export const geom = defineGeom(meta, (p, geom) => {
  let A = cyl(1, 0.5);
  geom.add(A);
  let B = cyl(1, 0.4);
  geom.subtract(B);
});
`;
    expect(() => loadGeomFromSource(src, () => { throw new Error('no deps'); })).toThrow(/Grammar violation/);
  });
});

describe('loadGeomFromSource — injectedMeta (Stage B.2 JSON meta)', () => {
  it('uses injected JSON meta when source has no inline export', () => {
    // Source has no `export const meta` — only a geom export and the
    // defineGeom reference. The loader's prepend gives it both.
    const src = `
import { cyl } from '../manifold-helpers';
import { defineGeom } from '.';
export const geom = defineGeom(meta, (p, geom) => {
  let A = cyl(p.length, p.r);
  geom.add(A);
});
`;
    const loaded = loadGeomFromSource(
      src,
      () => { throw new Error('no deps'); },
      undefined,
      undefined,
      {
        id: 'json_part',
        name: 'JSON Part',
        description: 'meta from JSON',
        params: {
          length: { label: 'L', min: 0, max: 5, step: 0.1, default: 2 },
          r: { label: 'R', min: 0, max: 2, step: 0.1, default: 0.5 },
        },
      },
    );
    expect(loaded.meta.id).toBe('json_part');
    expect(loaded.meta.name).toBe('JSON Part');
    expect(loaded.meta.params.length.default).toBe(2);
  });

  it('inline export const meta wins over injectedMeta (back-compat path)', () => {
    // Pre-migration parts still have an inline export — that one MUST
    // overwrite the prepended JSON since the inline write happens later
    // in execution order. Preserves backward compat during the
    // migration window.
    const src = `
import { cyl } from '../manifold-helpers';
import { defineGeom } from '.';
export const meta = { id: 'inline_wins', name: 'Inline', params: {} } as const;
export const geom = defineGeom(meta, (p, geom) => {
  let A = cyl(1, 0.5);
  geom.add(A);
});
`;
    const loaded = loadGeomFromSource(
      src,
      () => { throw new Error('no deps'); },
      undefined,
      undefined,
      { id: 'should_be_overridden', name: 'Should Lose', params: {} },
    );
    expect(loaded.meta.id).toBe('inline_wins');
  });
});
