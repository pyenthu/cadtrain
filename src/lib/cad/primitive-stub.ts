/**
 * primitive-stub — PURE source generators for the "+ new primitive" flow on
 * /primitives. Given an id + base + the base's param schema, produce a valid
 * `source.ts` string for a new volume primitive.
 *
 * Why a module (not inline in +page.svelte): the generated source MUST transpile
 * (the save endpoint validates it via extractMetaFromSource → esbuild). A base
 * with a non-number default (r_revolve / r_extrude expose a `polygon` param whose
 * default is an `[[x,y],…]` array) used to be emitted as `default: 0,0,1,0` — the
 * array stringified WITHOUT brackets — yielding an invalid object literal and a
 * 400 ("Expected ':' but found ','"). Keeping generation here lets a unit test
 * assert every param shape round-trips through extractMetaFromSource.
 *
 * The fix: serialize EVERY value with JSON.stringify (arrays keep their
 * brackets, strings get quoted/escaped) and tag polygon params with
 * `type: 'polygon'` (+ yDown/hLabel/vLabel) instead of a number min/max/step.
 */

/** A param schema entry as returned by /api/primitives/source (loose on
 *  purpose — only the fields we serialize matter). */
export interface StubParam {
  label?: string;
  type?: 'number' | 'polygon' | 'enum' | 'boolean' | string;
  min?: number;
  max?: number;
  step?: number;
  default?: unknown;
  unit?: string;
  options?: string[];
  yDown?: boolean;
  hLabel?: string;
  vLabel?: string;
}

const j = (v: unknown): string => JSON.stringify(v);

/** Serialize ONE `meta.params` entry. Branches on param kind so a polygon's
 *  array default is bracketed JSON (not a bare comma list) and number ranges
 *  only appear where they apply. Every value goes through JSON.stringify, so
 *  labels/units with quotes or arrays never break the literal. */
export function metaParamEntry(key: string, s: StubParam): string {
  const parts: string[] = [`label: ${j(s.label ?? key)}`];
  const isPolygon = s.type === 'polygon' || Array.isArray(s.default);
  if (isPolygon) {
    parts.push(`type: 'polygon'`);
    if (s.yDown) parts.push(`yDown: true`);
    if (s.hLabel) parts.push(`hLabel: ${j(s.hLabel)}`);
    if (s.vLabel) parts.push(`vLabel: ${j(s.vLabel)}`);
    parts.push(`default: ${j(Array.isArray(s.default) ? s.default : [])}`);
  } else if (s.type === 'enum') {
    parts.push(`type: 'enum'`);
    if (Array.isArray(s.options)) parts.push(`options: ${j(s.options)}`);
    parts.push(`default: ${j(typeof s.default === 'number' ? s.default : 0)}`);
  } else if (s.type === 'boolean') {
    parts.push(`type: 'boolean'`, `default: ${j(s.default ? 1 : 0)}`);
  } else {
    parts.push(
      `min: ${j(s.min ?? 0)}`,
      `max: ${j(s.max ?? 100)}`,
      `step: ${j(s.step ?? 0.1)}`,
      `default: ${j(typeof s.default === 'number' ? s.default : 1)}`,
    );
    if (s.unit) parts.push(`unit: ${j(s.unit)}`);
  }
  return `    ${key}: { ${parts.join(', ')} },`;
}

/** The full `meta.params: { … }` block body (entries, newline-joined). */
export function metaParamsBlock(params: Record<string, StubParam>): string {
  return Object.keys(params).map((k) => metaParamEntry(k, params[k] ?? {})).join('\n');
}

/** Minimal valid stub for a brand-new primitive: a simple cylinder to edit. */
export function stubSource(id: string): string {
  return `/**
 * ${id} — new primitive (edit me). COMPOSE the r_* primitives, declared in
 * meta.uses: r_cylinder, r_tube, r_cube, r_cone, r_ball, r_extrude, r_revolve,
 * r_threads, … combine with .add / .subtract / .intersect (+ mv / rot to place).
 * Do NOT call the raw cyl / tube / profile_extrude / revolve helpers — those are
 * the unstable base toolkit used only inside the r_* leaf primitives.
 */
export const meta = {
  id: '${id}', name: '${id}',
  description: 'New primitive — edit the source.',
  tags: ['new'],
  uses: ['r_cylinder'],
  params: {
    od:     { label: 'OD',     min: 0.1, max: 40, step: 0.1, default: 2 },
    length: { label: 'length', min: 0.1, max: 40, step: 0.1, default: 4 },
  },
};
export function ${id}(od, length) {
  const body = r_cylinder(od, length, 64);
  return body;
}
`;
}

/** Composite stub that wraps the chosen base r_* primitive, mirroring its
 *  params (incl. a polygon `profile` param, now serialized correctly). Returns
 *  null when the base exposes no params (caller falls back to stubSource). */
export function buildPartStubFromBase(id: string, base: string, params: Record<string, StubParam>): string | null {
  const names = Object.keys(params);
  if (names.length === 0) return null;
  const block = metaParamsBlock(params);
  const sig = names.join(', ');
  return `/**
 * ${id} — composite that wraps the ${base} primitive. Edit to add more r_*
 * parts: declare them in meta.uses and combine with .add / .subtract / .intersect
 * (+ mv / rot to place). Do NOT call the raw cyl/tube/profile_extrude helpers.
 */
export const meta = {
  id: '${id}', name: '${id}',
  description: 'New primitive — composed from ${base}.',
  tags: ['new'],
  uses: ['${base}'],
  params: {
${block}
  },
};
export function ${id}(${sig}) {
  const body = ${base}(${sig});
  return body;
}
`;
}

/** Revolve part from a profile FUNCTION (K.22 E lift): the profile's params
 *  become the PART's params, and the body resolves the profile from them each
 *  bake → r_revolve. `profileParams` is the profile def's params schema.
 *  Returns null when the profile has no params. */
export function buildRevolveStubFromProfile(id: string, kind: string, profileParams: Record<string, StubParam>): string | null {
  const names = Object.keys(profileParams ?? {});
  if (names.length === 0) return null;
  const block = metaParamsBlock(profileParams);
  const sig = names.join(', ');
  return `/**
 * ${id} — revolved part from the '${kind}' profile FUNCTION. Its params ARE the
 * profile's params (lifted): edit them and the profile re-resolves → r_revolve.
 * Add r_* parts (.add/.subtract + mv/rot) to build a fuller connection.
 */
export const meta = {
  id: '${id}', name: '${id}',
  description: 'Revolved part from the ${kind} profile.',
  tags: ['new', 'revolve'],
  uses: ['r_revolve'],
  params: {
${block}
  },
};
export function ${id}(${sig}) {
  const profile = resolveProfile({ kind: '${kind}', params: { ${sig} } });
  const body = r_revolve(profile, 96);
  return body;
}
`;
}

/** Function-first revolve part driven by r_rotate (NOT r_revolve): the chosen
 *  profile FUNCTION's params lift onto the part, and the body resolves the
 *  profile + feeds the r_rotate engine (the standalone welded-lathe clone).
 *  The named `profile` local makes the part show the profile selector + the
 *  lifted params in its accordion. `profileParams` is the profile def's schema.
 *  Returns null when the profile has no params. */
export function buildRotateStubFromProfile(id: string, kind: string, profileParams: Record<string, StubParam>): string | null {
  const names = Object.keys(profileParams ?? {});
  if (names.length === 0) return null;
  const block = metaParamsBlock(profileParams)
    + `\n    segments: { label: 'segments', min: 8, max: 256, step: 1, default: 96 },`;
  const profSig = names.join(', ');
  const sig = `${profSig}, segments`;
  return `/**
 * ${id} — function-first revolved part from the '${kind}' profile FUNCTION via
 * r_rotate. Its params ARE the profile's params (lifted): edit them and the
 * profile re-resolves → r_rotate. Pick a different profile with the selector in
 * the part's accordion. Add r_* parts (.add/.subtract + mv/rot) for more.
 */
export const meta = {
  id: '${id}', name: '${id}',
  description: 'Function-first revolved part from the ${kind} profile.',
  tags: ['new', 'revolve', 'rotate'],
  uses: ['r_rotate'],
  params: {
${block}
  },
};
export function ${id}(${sig}) {
  const profile = resolveProfile({ kind: '${kind}', params: { ${profSig} } });
  const body = r_rotate(profile, segments);
  return body;
}
`;
}
