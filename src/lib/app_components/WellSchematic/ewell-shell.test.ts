// Headless integration test for the ewell panel-shell wiring — inline (location-independent, so
// it survives the ewell.app.json being relocated to the samples dir). Proves: the shell manifest
// validates, its kinds are real PanelKinds, and seeded vars bridge to grid panels via readVar +
// the SSR preload walk (server-render path). The full shipped file is verified end-to-end by curl.
import { describe, it, expect } from 'vitest';
import { validateManifest } from '$lib/appkit/manifest/validate';
import { dispatch } from '$lib/appkit/verbs/dispatch';
import { PANEL_KINDS } from '$lib/appkit/verbs/gui';
import { resolvePreloaded } from '$lib/server/app-render';
import type { AppEngine } from '$lib/appkit/verbs/registry';

// A representative slice of the ewell shell: seed vars + a vtoolbar rail + a main schematic + a
// side grid sourced from a seeded var. Mirrors ewell.app.json's structure.
const shell = {
  app: 'ewell-test',
  title: 'ewell shell',
  docType: 'well',
  vars: {
    well: { name: 'Wildcat #1', field: 'New Field' },
    casings: [
      { od: 13.375, grade: 'L-80', top: 0, bot: 200 },
      { od: 7, grade: 'L-80', top: 0, bot: 2200 },
    ],
    perforations: [{ top: 2800, bot: 2810, color: '#e11d48' }],
  },
  panels: [
    {
      id: 'rail',
      kind: 'vtoolbar',
      children: [
        { id: 'tb-well', kind: 'iconbutton', props: { icon: 'add', label: 'Well' } },
        { id: 'tb-perf', kind: 'iconbutton', props: { icon: 'flag', label: 'Perf' } },
      ],
    },
    {
      id: 'main',
      kind: 'col',
      children: [
        { id: 'title', kind: 'heading', props: { text: '$vars.well.name' } },
        { id: 'schematic', kind: 'wellschematic', props: { casingsVar: 'casings', perfsVar: 'perforations' } },
      ],
    },
    {
      id: 'side',
      kind: 'sidebar',
      children: [
        { id: 'grid-casings', kind: 'grid', source: { verb: 'readVar', args: { name: 'casings' } } },
      ],
    },
  ],
};

// A no-op engine — readVar never touches it (reads the live .app), but resolvePreloaded's Ctx wants one.
const noEngine = { list: async () => [] } as unknown as AppEngine;

describe('ewell panel-shell', () => {
  it('validates as a manifest', () => {
    const r = validateManifest(structuredClone(shell));
    expect(r.ok).toBe(true);
  });

  it('every kind in the shell is a real PanelKind', () => {
    const kinds = new Set<string>();
    const walk = (ps: any[]) => ps?.forEach((p) => (kinds.add(p.kind), p.children && walk(p.children)));
    walk(shell.panels);
    for (const k of kinds) expect(PANEL_KINDS as readonly string[]).toContain(k);
    expect(kinds.has('wellschematic')).toBe(true);
    expect(kinds.has('vtoolbar')).toBe(true);
  });

  it('readVar bridges a seeded variable → rows', async () => {
    const rows = await dispatch('readVar', { name: 'casings' }, { appStore: shell as any });
    expect(Array.isArray(rows)).toBe(true);
    expect((rows as any[]).length).toBe(2);
    expect((rows as any[])[0].od).toBe(13.375);
  });

  it('SSR preload resolves server-mode grid data from the seeded var', async () => {
    const pre = await resolvePreloaded(structuredClone(shell) as any, noEngine);
    // grid is dataMode:'server' with a readVar source → its rows are baked into the first paint.
    expect(Array.isArray(pre['grid-casings'])).toBe(true);
    expect((pre['grid-casings'] as any[]).length).toBe(2);
  });
});
