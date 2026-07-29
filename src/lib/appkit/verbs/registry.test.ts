// Rung 1 — proves the SSOT → schema → dispatch loop headless (no browser, no deps).
import { describe, it, expect } from 'vitest';
import { VERBS, getVerb, verbsByGroup } from './registry';
import { dispatch } from './dispatch';
import { toAiSdkTools } from '../schema/to-aisdk';
import { toApiMd } from '../schema/to-apimd';

describe('appkit verb registry (rung 1 — SSOT → schema → dispatch)', () => {
  it('assembles unique verbs across the three groups', () => {
    expect(verbsByGroup('data').length).toBeGreaterThan(0);
    expect(verbsByGroup('mutate').length).toBeGreaterThan(0);
    expect(verbsByGroup('gui').length).toBeGreaterThan(0);
    const names = VERBS.map((v) => v.name);
    expect(new Set(names).size).toBe(names.length); // no duplicate verb names
  });

  it('projects EVERY verb to an AI SDK tool def (no drift)', () => {
    const tools = toAiSdkTools(VERBS);
    expect(Object.keys(tools)).toHaveLength(VERBS.length);
    for (const v of VERBS) {
      expect(tools[v.name]).toBeTruthy();
      expect(tools[v.name].description).toBe(v.desc);
      expect(tools[v.name].parameters).toBe(v.params);
    }
  });

  it('generates the API.md guide from the registry', () => {
    const md = toApiMd(VERBS);
    expect(md).toContain('## data');
    expect(md).toContain('## gui');
    expect(md).toContain('listPanelKinds(');
    expect(md).toContain('bake(id, params)');
  });

  it('round-trips schema → dispatch (gui verbs run headless on the live .app)', async () => {
    const kinds = (await dispatch('listPanelKinds', {})) as Array<{ kind: string }>;
    expect(kinds.some((k) => k.kind === 'table')).toBe(true);

    const app: any = { app: 'wells', panels: [] };
    await dispatch('definePanel', { panel: { id: 'list', kind: 'list' } }, { appStore: app });
    expect(app.panels).toHaveLength(1);
    await dispatch('addControl', { panelId: 'list', control: { kind: 'button' } }, { appStore: app });
    expect(app.panels[0].controls).toHaveLength(1);
    await dispatch('patchApp', { op: 'push', path: 'popovers', value: { id: 'x' } }, { appStore: app });
    expect(app.popovers[0].id).toBe('x');
  });

  it('data verbs read through an injected engine (rung 3)', async () => {
    const engine = {
      list: async () => [{ id: 'w1', name: 'Well 1', params: { casings: [{ od: 9.625 }] } }],
    };
    expect(await dispatch('listDocs', { docType: 'well' }, { engine })).toEqual([{ id: 'w1', title: 'Well 1' }]);
    expect(await dispatch('getParams', { id: 'w1' }, { engine })).toEqual({ casings: [{ od: 9.625 }] });
    expect(await dispatch('loadDoc', { id: 'w1' }, { engine })).toEqual({ id: 'w1', params: { casings: [{ od: 9.625 }] } });
    await expect(dispatch('getParams', { id: 'nope' }, { engine })).rejects.toThrow(/no doc/);
    await expect(dispatch('listDocs', {}, {})).rejects.toThrow(/needs an engine/);
  });

  it('errors clearly for unknown + unwired verbs', async () => {
    await expect(dispatch('nope', {})).rejects.toThrow(/unknown verb/);
    await expect(dispatch('bake', { id: 'g_x' })).rejects.toThrow(/not wired/);
    expect(getVerb('bake')?.group).toBe('data');
  });
});
