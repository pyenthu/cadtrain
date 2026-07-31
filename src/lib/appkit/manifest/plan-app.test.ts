// Integration test for the readVar → server-preload → Gantt pipeline (task #34). Uses an
// INLINE plan-app-shaped fixture (the plan.app sample itself lives as a user local file in the
// samples dir, not the source tree) so this proves the seed-data → server-render path headlessly
// without depending on a shipped .app file.
import { describe, it, expect } from 'vitest';
import { validateManifest } from './validate';
import { dispatch } from '../verbs/dispatch';
import { resolvePreloaded } from '$lib/server/app-render';
import { normalizeRows, groupByLane } from '$lib/app_components/Gantt/gantt-layout';
import type { AppEngine } from '../verbs/registry';

// A compact plan.app-shaped fixture: heading + gantt (reads vars.tasks) + grid (readVar tasks),
// with rows spanning all five bundle lanes and all four statuses.
const planFixture = {
  app: 'plan',
  title: 'CAD Train — Roadmap',
  structures: { task: [{ name: 'id' }, { name: 'label' }, { name: 'lane' }, { name: 'start' }, { name: 'end' }, { name: 'status' }, { name: 'details' }] },
  vars: {
    tasks: [
      { id: '940', label: 'GraphEditorPane modularization — Phase 4', lane: 'B · /primitives', start: 0.95, end: 1.25, status: 'active' },
      { id: '512', label: 'AI refine L2 — post-generation validation', lane: 'A · /components', start: 0, end: 0.13, status: 'todo' },
      { id: '700', label: 'Google OAuth identity port from SVTC', lane: 'C · Identity', start: 0, end: 0.15, status: 'open' },
      { id: '901', label: 'V1.0 read-only /api/v1 facade', lane: 'D · SDK', start: 0.15, end: 0.3, status: 'open' },
      { id: 'W-B1', label: 'W-B1 · editing — mutation + undo layer', lane: 'E · /wells', start: 0.3, end: 0.42, status: 'done' },
    ],
  },
  panels: [
    { id: 'title', kind: 'heading', props: { text: 'Roadmap', level: 1 } },
    { id: 'roadmap', kind: 'gantt', props: { rowsVar: 'tasks' } },
    { id: 'tasktable', kind: 'grid', source: { verb: 'readVar', args: { name: 'tasks' } }, props: { columns: ['id', 'label', 'lane', 'start', 'end', 'status'] } },
  ],
};

// A no-op engine — the server data comes from readVar (app.vars), not the engine.
const stubEngine: AppEngine = { list: async () => [] };

describe('readVar → server-preload → Gantt pipeline (plan.app shape)', () => {
  it('validates + seeds a task list<record> with the documented fields', () => {
    expect(validateManifest(planFixture).ok).toBe(true);
    for (const t of planFixture.vars.tasks) {
      for (const k of ['id', 'label', 'lane', 'start', 'end', 'status']) expect((t as any)[k]).toBeDefined();
    }
    expect(planFixture.structures.task.map((f) => f.name)).toEqual(['id', 'label', 'lane', 'start', 'end', 'status', 'details']);
  });

  it('composes a heading, a gantt (reading vars.tasks) and a task grid', () => {
    const byId = Object.fromEntries(planFixture.panels.map((p) => [p.id, p]));
    expect(byId.title.kind).toBe('heading');
    expect(byId.roadmap.kind).toBe('gantt');
    expect(byId.roadmap.props!.rowsVar).toBe('tasks');
    expect(byId.tasktable.kind).toBe('grid');
    expect(byId.tasktable.source).toEqual({ verb: 'readVar', args: { name: 'tasks' } });
  });

  it('readVar returns the seeded rows from the live .app; missing var → []', async () => {
    const rows = await dispatch('readVar', { name: 'tasks' }, { appStore: planFixture });
    expect(rows).toBe(planFixture.vars.tasks);
    expect(await dispatch('readVar', { name: 'nope' }, { appStore: planFixture })).toEqual([]);
  });

  it('server-preloads the grid exactly like the SSR route (resolvePreloaded)', async () => {
    const preloaded = await resolvePreloaded(planFixture as any, stubEngine);
    expect(preloaded.tasktable).toBe(planFixture.vars.tasks); // grid (dataMode:server) preloaded
    expect(preloaded.roadmap).toBeUndefined(); // gantt (dataMode:static) reads vars directly
  });

  it('rows normalize + group across all five bundle lanes with status variety', () => {
    const rows = normalizeRows(planFixture.vars.tasks);
    const lanes = groupByLane(rows);
    expect(lanes.map((l) => l.lane).sort()).toEqual(['A · /components', 'B · /primitives', 'C · Identity', 'D · SDK', 'E · /wells']);
    const statuses = new Set(rows.map((r) => r.status));
    for (const s of ['open', 'done', 'active', 'todo']) expect(statuses.has(s)).toBe(true);
  });
});
