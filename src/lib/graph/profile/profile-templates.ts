/**
 * profile-templates — curated inline-body snippets the predefined-profile
 * picker in ProfileFnEditor scaffolds from. Each template's `body` is the
 * SAME shape composeInlineSlotBody produces: zero or more calc lines + a
 * single `const profile_pts = …;` (no trailing `;` — the source's existing
 * `;` after the slot provides it).
 *
 * Selecting a template in the picker REPLACES the current slot body.
 * Editing freely from there is fine; the user can also "save as new" to
 * persist a custom variant under `primitives/profiles/custom/<id>.{prvl,prex}.ts`
 * (not yet wired — flagged TODO at picker time).
 *
 * Two sets, keyed by the editor's `set` axis:
 *   * cartesian — (x,y) cross-sections for r_weld_extrude / r_extrude
 *   * revolve   — (r,z) half-sections for r_revolve
 */

export interface ProfileParamSchema {
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  default: number;
}

export interface ProfileTemplate {
  id: string;
  label: string;
  /** Inline-slot body — calc lines + `const profile_pts = ARRAY` (no trailing `;`). */
  body: string;
  tags?: string[];
  /** Profile-specific params (NOT the engine params length/twist/divs/taper/
   *  segments — those are owned by the part and preserved across a profile
   *  swap). When the picker fires, the part's meta.params block is rewritten
   *  to (partParams from new template) + (engine params from old part). */
  partParams?: Record<string, ProfileParamSchema>;
}

/** Engine params owned by the part's extrude/revolve engine — preserved
 *  across a profile swap so the user keeps their length/twist/divs values. */
export const ENGINE_PARAM_NAMES = ['length', 'twist', 'divs', 'taper', 'segments'] as const;

// Template bodies use BARE NAMES (length, points, rx, …) — NOT p.X. This
// way the body resolves against the function arg locals (which the
// scaffolder's defaults-fallback block normalises) regardless of whether
// the sandbox-injected `p` carries the values. Without this, callers that
// pass no args (e.g. bake-preview with args:[]) hit p.X = undefined →
// Array.from({length: undefined}) → empty profile → 'profile needs ≥ 3 pts'.
export const CARTESIAN_TEMPLATES: ProfileTemplate[] = [
  {
    id: 'rect',
    label: 'Rect',
    tags: ['rectangle', 'box', 'square'],
    partParams: {
      w: { label: 'width',  min: 0.05, max: 20, step: 0.05, default: 1 },
      h: { label: 'height', min: 0.05, max: 20, step: 0.05, default: 0.6 },
    },
    body:
`  const profile_pts = [
    [-w / 2, -h / 2],
    [ w / 2, -h / 2],
    [ w / 2,  h / 2],
    [-w / 2,  h / 2],
  ]`,
  },
  {
    id: 'ngon',
    label: 'Polygon (n-gon)',
    tags: ['hex', 'pentagon', 'octagon', 'nut'],
    partParams: {
      n: { label: 'sides',  min: 3,    max: 24, step: 1,    default: 6 },
      r: { label: 'radius', min: 0.05, max: 5,  step: 0.05, default: 0.5 },
    },
    body:
`  const profile_pts = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * 2 * PI;
    return [cos(a) * r, sin(a) * r];
  })`,
  },
  {
    id: 'ellipse',
    label: 'Ellipse / Circle',
    tags: ['circle', 'round', 'disc', 'oval'],
    partParams: {
      rx: { label: 'rx', min: 0.05, max: 10, step: 0.05, default: 1 },
      ry: { label: 'ry', min: 0.05, max: 10, step: 0.05, default: 1 },
    },
    body:
`  const profile_pts = Array.from({ length: segments }, (_, i) => {
    const a = (i / segments) * 2 * PI;
    return [cos(a) * rx, sin(a) * ry];
  })`,
  },
  {
    id: 'star',
    label: 'Star',
    tags: ['star', 'spline', 'alternating'],
    partParams: {
      points: { label: 'points', min: 3,    max: 16, step: 1,    default: 5 },
      rOuter: { label: 'rOuter', min: 0.05, max: 5,  step: 0.05, default: 0.7 },
      rInner: { label: 'rInner', min: 0.02, max: 5,  step: 0.05, default: 0.3 },
    },
    body:
`  const n = points * 2;
  const profile_pts = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * 2 * PI;
    const r = i % 2 === 0 ? rOuter : rInner;
    return [cos(a) * r, sin(a) * r];
  })`,
  },
  {
    id: 'gear',
    label: 'Gear (sinusoidal)',
    tags: ['gear', 'teeth', 'cam'],
    partParams: {
      teeth: { label: 'teeth',       min: 1,    max: 48,  step: 1,    default: 12 },
      rBase: { label: 'rBase',       min: 0.05, max: 5,   step: 0.05, default: 0.5 },
      amp:   { label: 'tooth depth', min: 0,    max: 0.5, step: 0.01, default: 0.08 },
    },
    body:
`  const profile_pts = Array.from({ length: segments }, (_, i) => {
    const a = (i / segments) * 2 * PI;
    const r = rBase + amp * cos(teeth * a);
    return [cos(a) * r, sin(a) * r];
  })`,
  },
  {
    id: 'l',
    label: 'L-bracket',
    tags: ['angle iron', 'bracket'],
    partParams: {
      legX: { label: 'legX',      min: 0.05, max: 20, step: 0.05, default: 0.6 },
      legY: { label: 'legY',      min: 0.05, max: 20, step: 0.05, default: 0.6 },
      t:    { label: 'thickness', min: 0.02, max: 10, step: 0.02, default: 0.2 },
    },
    body:
`  const profile_pts = [
    [0, 0],
    [legX, 0],
    [legX, t],
    [t, t],
    [t, legY],
    [0, legY],
  ]`,
  },
  {
    id: 'plus',
    label: 'Plus / Cross',
    tags: ['cross', 'plus'],
    partParams: {
      arm: { label: 'arm',       min: 0.1, max: 20, step: 0.05, default: 0.5 },
      t:   { label: 'thickness', min: 0.05, max: 10, step: 0.02, default: 0.25 },
    },
    body:
`  const profile_pts = [
    [-t, -arm], [ t, -arm], [ t, -t], [ arm, -t],
    [ arm,  t], [ t,  t], [ t,  arm], [-t,  arm],
    [-t,  t], [-arm,  t], [-arm, -t], [-t, -t],
  ]`,
  },
];

// Revolve templates also use bare names — function arg locals win.
export const REVOLVE_TEMPLATES: ProfileTemplate[] = [
  {
    id: 'cylinder',
    label: 'Cylinder',
    tags: ['rod', 'shaft', 'solid'],
    partParams: {
      r:   { label: 'radius', min: 0.05, max: 10, step: 0.05, default: 1.0 },
      len: { label: 'length', min: 0.1,  max: 30, step: 0.1,  default: 3 },
    },
    body:
`  const profile_pts = [
    [0, 0],
    [r, 0],
    [r, len],
    [0, len],
  ]`,
  },
  {
    id: 'tube',
    label: 'Tube',
    tags: ['pipe', 'hollow', 'bore', 'annulus'],
    partParams: {
      od:  { label: 'OD',     min: 0.1, max: 20, step: 0.05, default: 2 },
      id_: { label: 'ID',     min: 0.05, max: 19, step: 0.05, default: 1.4 },
      len: { label: 'length', min: 0.1, max: 30, step: 0.1, default: 3 },
    },
    body:
`  const ri = id_ / 2;
  const ro = od / 2;
  const profile_pts = [
    [ri, 0],
    [ro, 0],
    [ro, len],
    [ri, len],
    [ri, 0],
  ]`,
  },
  {
    id: 'cone',
    label: 'Cone',
    tags: ['taper', 'point'],
    partParams: {
      r:   { label: 'base radius', min: 0.05, max: 10, step: 0.05, default: 1 },
      len: { label: 'length',      min: 0.1,  max: 30, step: 0.1,  default: 3 },
    },
    body:
`  const profile_pts = [
    [0, 0],
    [r, 0],
    [0, len],
  ]`,
  },
  {
    id: 'barrel',
    label: 'Barrel',
    tags: ['drum', 'bulge'],
    partParams: {
      rEnd: { label: 'end radius', min: 0.05, max: 10, step: 0.05, default: 1.0 },
      rMid: { label: 'mid radius', min: 0.05, max: 10, step: 0.05, default: 1.4 },
      len:  { label: 'length',     min: 0.1,  max: 30, step: 0.1,  default: 3 },
    },
    body:
`  const profile_pts = [
    [0, 0],
    [rEnd, 0],
    [rMid, len / 2],
    [rEnd, len],
    [0, len],
  ]`,
  },
  // Collar variants — cylindrical band with optional inner bore.
  // Three flavours pick the outer-corner treatment: square / chamfered /
  // filleted. Set bore=0 for a solid collar. Z-down: top at z=0.
  {
    id: 'collar_flat',
    label: 'Collar (flat)',
    tags: ['collar', 'band', 'flat'],
    partParams: {
      od:   { label: 'OD',         min: 0.2, max: 20, step: 0.05, default: 2.0 },
      bore: { label: 'bore (ID)',  min: 0,   max: 20, step: 0.05, default: 0.6 },
      len:  { label: 'length',     min: 0.1, max: 20, step: 0.05, default: 1.5 },
    },
    body:
`  const ro = Math.max(0.01, od / 2);
  const ri = Math.max(0,    Math.min(bore / 2, ro - 0.01));
  const L  = Math.max(0.01, len);
  const profile_pts = [
    [ri, 0],
    [ri, L],
    [ro, L],
    [ro, 0],
  ]`,
  },
  {
    id: 'collar_tapered',
    label: 'Collar (tapered shoulders)',
    tags: ['collar', 'band', 'chamfer', 'taper'],
    partParams: {
      od:    { label: 'OD',           min: 0.2, max: 20, step: 0.05, default: 2.0 },
      bore:  { label: 'bore (ID)',    min: 0,   max: 20, step: 0.05, default: 0.6 },
      len:   { label: 'length',       min: 0.1, max: 20, step: 0.05, default: 1.5 },
      taper: { label: 'taper depth',  min: 0,   max: 5,  step: 0.05, default: 0.3 },
    },
    body:
`  const ro = Math.max(0.01, od / 2);
  const ri = Math.max(0,    Math.min(bore / 2, ro - 0.01));
  const L  = Math.max(0.01, len);
  const t  = Math.max(0,    Math.min(taper, L / 2, ro - ri));
  const profile_pts = [
    [ri,     0    ],
    [ri,     L    ],
    [ro - t, L    ],
    [ro,     L - t],
    [ro,     t    ],
    [ro - t, 0    ],
  ]`,
  },
  {
    id: 'collar_rounded',
    label: 'Collar (rounded shoulders)',
    tags: ['collar', 'band', 'fillet', 'rounded'],
    partParams: {
      od:           { label: 'OD',             min: 0.2, max: 20, step: 0.05, default: 2.0 },
      bore:         { label: 'bore (ID)',      min: 0,   max: 20, step: 0.05, default: 0.6 },
      len:          { label: 'length',         min: 0.1, max: 20, step: 0.05, default: 1.5 },
      fillet:       { label: 'fillet radius',  min: 0,   max: 5,  step: 0.05, default: 0.3 },
      filletSteps:  { label: 'fillet steps',   min: 2,   max: 64, step: 1,    default: 8 },
    },
    // Two Array.from arcs + corner points → the profile editor's parseBody
    // now flags this as "too complex to decompose" and preserves the body
    // verbatim on Save (see ProfileFnEditor bodyTooComplexToDecompose +
    // memory: profile_editor_composeSource_bug).
    body:
`  const ro = Math.max(0.01, od / 2);
  const ri = Math.max(0,    Math.min(bore / 2, ro - 0.01));
  const L  = Math.max(0.01, len);
  const f  = Math.max(0,    Math.min(fillet, L / 2, ro - ri));
  const steps = Math.max(2, Math.round(filletSteps));
  const topArc = Array.from({ length: steps + 1 }, (_, i) => {
    const ang = -Math.PI / 2 + (i / steps) * (Math.PI / 2);
    return [ro - f + f * Math.cos(ang), f + f * Math.sin(ang)];
  });
  const botArc = Array.from({ length: steps + 1 }, (_, i) => {
    const ang = (i / steps) * (Math.PI / 2);
    return [ro - f + f * Math.cos(ang), L - f + f * Math.sin(ang)];
  });
  const profile_pts = [[ri, 0], ...topArc, ...botArc, [ri, L]]`,
  },
];

export function templatesFor(set: 'cartesian' | 'revolve'): ProfileTemplate[] {
  return set === 'cartesian' ? CARTESIAN_TEMPLATES : REVOLVE_TEMPLATES;
}

/** Engine params for an EXTRUDE part — MANDATORY first dials of every
 *  Extrude Part's meta.params. Order chosen so the user sees the engine
 *  controls before the profile-specific knobs. Profile templates' partParams
 *  append AFTER these. These five (length, twist, divs, taper, segments)
 *  are persistent across profile swaps; profile-specific params are
 *  swapped/added/removed by the picker. */
export const EXTRUDE_ENGINE_PARAMS: Record<string, ProfileParamSchema> = {
  length:   { label: 'length',    min: 0.1,  max: 20,  step: 0.1,  default: 2 },
  twist:    { label: 'twist (°)', min: -360, max: 360, step: 5,    default: 0 },
  divs:     { label: 'divs',      min: 1,    max: 96,  step: 1,    default: 12 },
  // taper is DIMENSIONLESS — a scale factor `1 - taper` is applied to the
  // bottom face. Positive narrows (shaft / drill-bit convention); negative
  // flares. Explicit `unit: ''` so the param card doesn't tag it with the
  // ambient `mm` default.
  taper:    { label: 'taper',     min: -1.0, max: 1.0, step: 0.05, default: 0, unit: '' },
  segments: { label: 'segments',  min: 4,    max: 256, step: 1,    default: 32 },
};

/** Engine params for a REVOLVE part — just the around-axis segment count. */
export const REVOLVE_ENGINE_PARAMS: Record<string, ProfileParamSchema> = {
  segments: { label: 'segments', min: 8, max: 256, step: 1, default: 64 },
};

/** Serialize a params record into the meta.params text shape parts use. */
function serializeParams(params: Record<string, ProfileParamSchema>): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    const fields: string[] = [];
    if (v.label != null) fields.push(`label: ${JSON.stringify(v.label)}`);
    if (v.min != null) fields.push(`min: ${v.min}`);
    if (v.max != null) fields.push(`max: ${v.max}`);
    if (v.step != null) fields.push(`step: ${v.step}`);
    fields.push(`default: ${v.default}`);
    lines.push(`    ${k}: { ${fields.join(', ')} },`);
  }
  return lines.join('\n');
}

/** Build the full source for a NEW Extrude Part from a chosen template +
 *  the desired id. Engine params (length/twist/divs/taper/segments) come
 *  FIRST in meta.params and the signature; profile-specific keys follow.
 *  Body uses `p.<key>` references; r_weld_extrude wired with `p.taper`.
 *  Function body starts with `??= default` fallbacks for every param so
 *  assembly call sites that drift out of sync (e.g. the part gained a
 *  param after the assembly was created) gracefully use defaults instead
 *  of producing undefined-related explosions. */
export function buildExtrudeSource(id: string, template: ProfileTemplate): string {
  const profileParams = template.partParams ?? {};
  // ENGINE FIRST so the mandatory dials sit at the top of the params list.
  const allParams = { ...EXTRUDE_ENGINE_PARAMS, ...profileParams };
  const argList = Object.keys(allParams).join(', ');
  const defaultsBlock = Object.entries(allParams)
    .map(([k, v]) => `  ${k} ??= ${v.default};`)
    .join('\n');
  return `/**
 * ${id} — Extrude Part scaffolded from the "${template.label}" template.
 *
 * Edit the params or the profile body to taste. Swap the profile via the
 * search bar in the scene canvas (top-right). The engine params (length /
 * twist / divs / taper / segments) are MANDATORY and preserved across
 * profile swaps; profile-specific params (below) are added/removed by
 * the picker.
 *
 * The \`??= default\` block at the top of the function body protects
 * assembly call sites: if a downstream caller doesn't pass a value
 * (typically because this part gained a new param), the default kicks
 * in. Renaming or removing a param still produces a visible failure,
 * which is the right signal.
 */
export const meta = {
  id: '${id}', name: '${id}',
  description: 'Extrude Part — ${template.label} cross-section.',
  tags: ['extrude', 'inline-profile', '${template.id}'],
  uses: ['r_weld_extrude'],
  params: {
${serializeParams(allParams)}
  },
};

export function ${id}(${argList}) {
  // Defaults — protects against drift when used inside an assembly.
${defaultsBlock}
${template.body};
  // Taper as a function of vertical position (Z-down: z=0 top, z=length
  // bottom). Linear default: bottom face scaled by (1 - taper). EDIT this
  // line to make taper non-linear (e.g. quadratic, two-stage, asymmetric
  // x vs y) — r_weld_extrude takes the resulting Vec2 directly.
  const scaleTop = [1 - taper, 1 - taper];
  return r_weld_extrude(profile_pts, length, divs, twist, taper, segments, scaleTop);
}
`;
}

/** Same shape for a NEW Profile (Revolve) Part. Engine params first,
 *  defaults-fallback block in the body (see buildExtrudeSource notes). */
export function buildRevolveSource(id: string, template: ProfileTemplate): string {
  const profileParams = template.partParams ?? {};
  const allParams = { ...REVOLVE_ENGINE_PARAMS, ...profileParams };
  const argList = Object.keys(allParams).join(', ');
  const defaultsBlock = Object.entries(allParams)
    .map(([k, v]) => `  ${k} ??= ${v.default};`)
    .join('\n');
  return `/**
 * ${id} — Profile (Revolve) Part scaffolded from the "${template.label}" template.
 *
 * Edit the params or the (r,z) profile body to taste. Swap the profile via
 * the search bar in the scene canvas (top-right). The \`??= default\` block
 * protects this part against drift when it's used inside an assembly that
 * was created before a param was added.
 */
export const meta = {
  id: '${id}', name: '${id}',
  description: 'Revolve Part — ${template.label} half-section.',
  tags: ['revolve', 'inline-profile', '${template.id}'],
  uses: ['r_revolve'],
  params: {
${serializeParams(allParams)}
  },
};

export function ${id}(${argList}) {
  // Defaults — protects against drift when used inside an assembly.
${defaultsBlock}
${template.body};
  return r_revolve(profile_pts, segments);
}
`;
}

/** Empty Assembly scaffold. Returns `empty()` (zero-volume Manifold) so
 *  the preview pipeline + drag-from-sidebar drop handler have something
 *  valid to graft new parts onto.
 *
 *  Workflow once the file is open:
 *    1. Drag any sidebar primitive (r_cylinder, r_ball, an Extrude Part,
 *       another assembly, …) onto the 3D canvas — drops insert a `const
 *       <name> = r_X(…)` line and `.add(<name>)` to the return chain.
 *    2. Edit each instance's args + add `mv([0,0,p.offset])` / `rot([…])`
 *       to position it.
 *    3. Switch `.add` → `.subtract` / `.intersect` in the Build tab.
 *    4. Use `+ param` to expose tunable values up to the assembly's meta. */
export function buildAssemblySource(id: string): string {
  return `/**
 * ${id} — Assembly (K.63 composition-tree model, object-arg style).
 *
 * The assembly takes a SINGLE object \`p\` whose keys are listed in
 * meta.params. Inserting a primitive grows meta.params to match the
 * child's params and emits a Call as \`B({k1: p.k1, k2: p.k2, ...})\`
 * — every slot visibly tied to its named child param.
 *
 * meta.imports declares aliases for primitives — pure declarations
 *   (\`B = tube_new\` → \`const B = tube_new;\` at the top of the body).
 * meta.composition is the single TreeNode root that produces the
 *   final geometry. The function body is auto-generated from imports
 *   + composition on every save.
 */
export const meta = {
  id: '${id}', name: '${id}',
  description: 'Assembly.',
  tags: ['assembly'],
  uses: [],
  imports: [],
  composition: null,
  params: {},
};

export function ${id}(p) {
  return empty();
}
`;
}
