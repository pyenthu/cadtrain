// app_components/WellSchematic/meta.ts — the catalog metadata for this bundle (headless).
// Co-located with WellSchematic.svelte (the render). `import type` keeps this pure (no runtime
// edge back into the catalog) so appkit can aggregate it. See src/lib/app_components/CLAUDE.md.
import type { ComponentMeta } from '$lib/appkit/catalog/components';

export const metas: ComponentMeta[] = [
  {
    kind: 'wellschematic',
    name: 'Well Schematic',
    description:
      'A well cross-section diagram: casing strings, open-hole sections, a centred tubing string, ' +
      'cement, and perforations, drawn to scale (diameter horizontal · depth vertical, deeper = ' +
      'downward). Reads seeded app VARIABLES (props.casingsVar/holesVar/tubingVar/perfsVar/cementVar → ' +
      'vars[name], each a list<record> of {od|bitSize, top, bot, grade?, label?, color?}) or inline ' +
      'props arrays, plus a props.wellVar record for the header (name/field/company). Server-renders ' +
      '(no client fetch) — SSR-safe SVG.',
    // static: no `source` — reads seeded variables directly, present in the SSR first paint.
    dataMode: 'static',
    group: 'display',
    tags: ['well', 'schematic', 'wellbore', 'casing', 'tubing', 'completion', 'perforation', 'diagram', 'svg', 'drilling'],
    props: [
      { name: 'title', type: 'string', label: 'Title (else well.name)' },
      { name: 'width', type: 'number', label: 'Width px', default: 380 },
      { name: 'height', type: 'number', label: 'Height px', default: 520 },
      { name: 'depthUnit', type: 'string', label: 'Depth unit', default: 'ft' },
      { name: 'wellVar', type: 'string', label: 'Well header variable', default: 'well' },
      { name: 'casingsVar', type: 'string', label: 'Casings variable', default: 'casings' },
      { name: 'holesVar', type: 'string', label: 'Open-hole variable', default: 'holes' },
      { name: 'tubingVar', type: 'string', label: 'Tubing variable', default: 'tubing' },
      { name: 'perfsVar', type: 'string', label: 'Perforations variable', default: 'perforations' },
      { name: 'cementVar', type: 'string', label: 'Cement variable', default: 'cement' },
    ],
  },
];
