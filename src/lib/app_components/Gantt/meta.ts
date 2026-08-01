// app_components/Gantt/meta.ts — the catalog metadata for this bundle (headless).
// Co-located with Gantt.svelte (the render). `import type` keeps this pure (no runtime edge
// back into the catalog) so appkit can aggregate it. See src/lib/app_components/CLAUDE.md.
import type { ComponentMeta } from '$lib/appkit/catalog/components';

export const metas: ComponentMeta[] = [
  {
    kind: 'gantt',
    name: 'Gantt / Timeline',
    description:
      'A roadmap timeline: task BARS positioned by start/end across a shared axis, coloured by ' +
      'status, grouped into lane swimlanes. Reads rows from an app variable (props.rowsVar → ' +
      'vars[name], a list<record> of {id,label,lane,start,end,status,details}) or an inline ' +
      'props.rows array. Server-renders (no client fetch). Use props.durationField to read ' +
      '{start,weeks}-style records instead of an explicit end.',
    useWhen:
      'A horizontal timeline of bars over a date/number axis — use for a schedule, roadmap, Gantt, ' +
      'or project plan built from a list of {start,end} (or {start,weeks}) records; NOT for plain ' +
      'tabular data (use grid) or a categorical chart.',
    example: { id: 'timeline', kind: 'gantt', props: { title: 'Roadmap', rowsVar: 'tasks', unit: 'wk' } },
    // static: no `source` — reads the seeded variable directly, available in the SSR first paint.
    dataMode: 'static',
    group: 'display',
    tags: ['gantt', 'timeline', 'roadmap', 'schedule', 'plan', 'bars', 'swimlane', 'tasks', 'chart', 'milestones', 'phases', 'calendar', 'project'],
    props: [
      { name: 'title', type: 'string', label: 'Title' },
      { name: 'rowsVar', type: 'string', label: 'Rows variable', default: 'tasks' },
      { name: 'unit', type: 'string', label: 'Axis unit (e.g. wk)' },
      { name: 'rangeStart', type: 'number', label: 'Axis start (optional)' },
      { name: 'rangeEnd', type: 'number', label: 'Axis end (optional)' },
      { name: 'tickCount', type: 'number', label: 'Axis ticks', default: 6 },
      { name: 'labelWidth', type: 'number', label: 'Label column px', default: 240 },
      { name: 'durationField', type: 'string', label: 'Duration field (else end)' },
      { name: 'laneField', type: 'string', label: 'Lane field', default: 'lane' },
      { name: 'startField', type: 'string', label: 'Start field', default: 'start' },
      { name: 'endField', type: 'string', label: 'End field', default: 'end' },
      { name: 'statusField', type: 'string', label: 'Status field', default: 'status' },
      { name: 'labelField', type: 'string', label: 'Label field', default: 'label' },
    ],
  },
];
