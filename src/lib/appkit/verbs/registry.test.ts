// Rung 1 — proves the SSOT → schema → dispatch loop headless (no browser, no deps).
import { describe, it, expect } from 'vitest';
import { VERBS, getVerb, verbsByGroup, verbExample } from './registry';
import { dispatch } from './dispatch';
import { toAiSdkTools, verbDescription } from '../schema/to-aisdk';
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
      expect(tools[v.name].description).toBe(verbDescription(v)); // desc + appended example
      expect(tools[v.name].description).toContain(v.desc); // the prose is always present
      expect(tools[v.name].parameters).toBe(v.params);
    }
  });

  it('appends the canonical example to the description + API.md when a verb has one', () => {
    const withEx = VERBS.filter((v) => v.example);
    expect(withEx.length).toBeGreaterThan(0); // core verbs carry examples
    const tools = toAiSdkTools(VERBS);
    const md = toApiMd(VERBS);
    for (const v of withEx) {
      const ex = verbExample(v)!;
      expect(tools[v.name].description).toContain(`Example: ${ex}`); // rides in the tool desc
      expect(md).toContain(`e.g. \`${ex}\``); // and shows in the guide
    }
    // definePanel is a core build verb — its example must be present + concrete
    const dp = getVerb('definePanel')!;
    expect(dp.example?.args).toHaveProperty('panel');
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

  it('iterative-editing gui verbs (remove/move/setProp/setMeta) mutate the .app', async () => {
    const app: any = { app: 'x', title: 'X', panels: [{ id: 'a', kind: 'text' }, { id: 'b', kind: 'list' }, { id: 'c', kind: 'form' }] };
    await dispatch('setAppMeta', { title: 'Well Designer', docType: 'well' }, { appStore: app });
    expect(app.title).toBe('Well Designer');
    expect(app.docType).toBe('well');
    await dispatch('setPanelProp', { panelId: 'a', key: 'title', value: 'Intro' }, { appStore: app });
    expect(app.panels[0].title).toBe('Intro');
    await dispatch('movePanel', { panelId: 'c', to: 0 }, { appStore: app });
    expect(app.panels[0].id).toBe('c');
    await dispatch('removePanel', { panelId: 'b' }, { appStore: app });
    expect(app.panels.map((p: any) => p.id)).toEqual(['c', 'a']);
    await expect(dispatch('setPanelProp', { panelId: 'nope', key: 'x', value: 1 }, { appStore: app })).rejects.toThrow(/no panel/);
  });

  it('tree ops: addChildPanel + indent/outdent move panels through the hierarchy', async () => {
    const app: any = { app: 'x', panels: [{ id: 'card', kind: 'card', children: [] }, { id: 't', kind: 'text' }] };
    // demote 't' INTO its previous sibling 'card'
    await dispatch('indentPanel', { panelId: 't' }, { appStore: app });
    expect(app.panels.map((p: any) => p.id)).toEqual(['card']);
    expect(app.panels[0].children.map((c: any) => c.id)).toEqual(['t']);
    // promote 't' back OUT (just after 'card')
    await dispatch('outdentPanel', { panelId: 't' }, { appStore: app });
    expect(app.panels.map((p: any) => p.id)).toEqual(['card', 't']);
    // addChildPanel appends (with a unique id)
    await dispatch('addChildPanel', { parentId: 'card', panel: { id: 'h', kind: 'heading' } }, { appStore: app });
    expect(app.panels[0].children.map((c: any) => c.id)).toEqual(['h']);
    // removePanel finds nested
    await dispatch('removePanel', { panelId: 'h' }, { appStore: app });
    expect(app.panels[0].children).toHaveLength(0);
  });

  it('insertTree clones a saved component + re-ids collisions (dedupe on insert)', async () => {
    const app: any = { app: 'x', panels: [{ id: 'card', kind: 'card', children: [] }] };
    const template = [{ id: 'card', kind: 'card', children: [{ id: 't', kind: 'text' }] }]; // 'card' collides
    await dispatch('insertTree', { nodes: template }, { appStore: app });
    expect(app.panels.map((p: any) => p.id)).toEqual(['card', 'card-2']); // the clone's dup id was re-assigned
    expect(app.panels[1].children[0].id).toBe('t');
    // insert into a parent by id
    await dispatch('insertTree', { nodes: [{ id: 'x', kind: 'text' }], parentId: 'card' }, { appStore: app });
    expect(app.panels[0].children.map((c: any) => c.id)).toEqual(['x']);
  });

  it('setComponentProp writes panel.props (incl. nested children) + deletes on null', async () => {
    const app: any = {
      app: 'x',
      panels: [{ id: 'card', kind: 'card', children: [{ id: 'txt', kind: 'text' }] }],
    };
    await dispatch('setComponentProp', { panelId: 'txt', name: 'text', value: 'Hi' }, { appStore: app });
    expect(app.panels[0].children[0].props.text).toBe('Hi'); // found via recursion
    await dispatch('setComponentProp', { panelId: 'txt', name: 'weight', value: '600' }, { appStore: app });
    expect(app.panels[0].children[0].props.weight).toBe('600');
    await dispatch('setComponentProp', { panelId: 'txt', name: 'text', value: null }, { appStore: app });
    expect(app.panels[0].children[0].props.text).toBeUndefined(); // null deletes
    await expect(dispatch('setComponentProp', { panelId: 'nope', name: 'x', value: 1 }, { appStore: app })).rejects.toThrow(/no panel/);
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

  it('bake verb calls the engine (rung 3b)', async () => {
    const engine = { list: async () => [], bake: async (id: string) => ({ ok: true, verts: 11538, tris: 3846, id }) };
    expect(await dispatch('bake', { id: 'w2', params: {} }, { engine })).toMatchObject({ ok: true, verts: 11538, tris: 3846 });
    await expect(dispatch('bake', { id: 'w2' }, { engine: { list: async () => [] } })).rejects.toThrow(/no bake/);
  });

  it('engine ops: getSource + compile (ENG-engine)', async () => {
    const engine = {
      list: async () => [],
      getSource: async (id: string) => ({ source: `export function ${id}(){}` }),
      compile: async (_id: string) => ({ scriptHash: 'h' }),
    };
    const src = (await dispatch('getSource', { id: 'g_x' }, { engine })) as { source: string };
    expect(src.source).toContain('export function g_x');
    expect(await dispatch('compile', { id: 'g_x' }, { engine })).toMatchObject({ scriptHash: 'h' });
    await expect(dispatch('getSource', { id: 'g_x' }, { engine: { list: async () => [] } })).rejects.toThrow(/no getSource/);
  });

  it('errors clearly for unknown + unwired + engine-less verbs', async () => {
    await expect(dispatch('nope', {})).rejects.toThrow(/unknown verb/);
    await expect(dispatch('setParam', { id: 'x', name: 'a', value: 1 })).rejects.toThrow(/not wired/); // mutate: rung 3b+
    await expect(dispatch('bake', { id: 'g_x' })).rejects.toThrow(/needs an engine/); // wired, but no engine in ctx
    expect(getVerb('bake')?.group).toBe('data');
  });
});
