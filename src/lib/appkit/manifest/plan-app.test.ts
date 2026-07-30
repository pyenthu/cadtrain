// Integration test for the plan.app sample (task #34): it must validate, carry the seeded
// roadmap in vars.tasks, expose the Gantt, and — crucially — SERVER-PRELOAD the task table
// through the exact path the SSR route uses (resolvePreloaded → the readVar data verb reading
// app.vars). Proves the seed-data → server-render pipeline headlessly (no browser).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateManifest } from './validate';
import { dispatch } from '../verbs/dispatch';
import { resolvePreloaded } from '$lib/server/app-render';
import { normalizeRows, groupByLane } from '$lib/app_components/Gantt/gantt-layout';
import type { AppEngine } from '../verbs/registry';

const raw = readFileSync(fileURLToPath(new URL('./examples/plan.app', import.meta.url)), 'utf8');
const parsed = JSON.parse(raw);

// A no-op engine — plan.app's server data comes from readVar (app.vars), not the engine.
const stubEngine: AppEngine = { list: async () => [] };

describe('plan.app sample', () => {
  it('is valid JSON and passes manifest validation', () => {
    const res = validateManifest(parsed);
    expect(res.ok).toBe(true);
  });

  it('seeds a task list<record> with the documented fields', () => {
    const tasks = parsed.vars?.tasks as Array<Record<string, unknown>>;
    expect(Array.isArray(tasks)).toBe(true);
    expect(tasks.length).toBeGreaterThanOrEqual(12);
    for (const t of tasks) {
      for (const k of ['id', 'label', 'lane', 'start', 'end', 'status']) expect(t[k]).toBeDefined();
    }
    // structures.task documents the shape.
    expect(parsed.structures?.task?.map((f: any) => f.name)).toEqual([
      'id', 'label', 'lane', 'start', 'end', 'status', 'details',
    ]);
  });

  it('composes a heading, a gantt (reading vars.tasks) and a task grid', () => {
    const byId = Object.fromEntries((parsed.panels as any[]).map((p) => [p.id, p]));
    expect(byId.title.kind).toBe('heading');
    expect(byId.roadmap.kind).toBe('gantt');
    expect(byId.roadmap.props.rowsVar).toBe('tasks');
    expect(byId.tasktable.kind).toBe('grid');
    expect(byId.tasktable.source).toEqual({ verb: 'readVar', args: { name: 'tasks' } });
  });

  it('readVar returns the seeded rows from the live .app', async () => {
    const rows = await dispatch('readVar', { name: 'tasks' }, { appStore: parsed });
    expect(rows).toBe(parsed.vars.tasks);
    // absent variable → empty array (never throws)
    expect(await dispatch('readVar', { name: 'nope' }, { appStore: parsed })).toEqual([]);
  });

  it('server-preloads the task grid exactly like the SSR route (resolvePreloaded)', async () => {
    const preloaded = await resolvePreloaded(parsed, stubEngine);
    // the grid (dataMode:server) is preloaded; the gantt (dataMode:static) reads vars directly.
    expect(preloaded.tasktable).toBe(parsed.vars.tasks);
    expect(preloaded.roadmap).toBeUndefined();
  });

  it('the seeded rows normalize + group across all five bundle lanes', () => {
    const rows = normalizeRows(parsed.vars.tasks);
    const lanes = groupByLane(rows);
    expect(lanes.map((l) => l.lane).sort()).toEqual([
      'A · /components',
      'B · /primitives',
      'C · Identity',
      'D · SDK',
      'E · /wells',
    ]);
    // a couple of real roadmap labels survive intact
    const labels = rows.map((r) => r.label);
    expect(labels).toContain('GraphEditorPane modularization — Phase 4');
    expect(labels.some((l) => l.startsWith('W-B1'))).toBe(true);
    // statuses include done + active + open + todo (colour variety)
    const statuses = new Set(rows.map((r) => r.status));
    for (const s of ['open', 'done', 'active', 'todo']) expect(statuses.has(s)).toBe(true);
  });
});
