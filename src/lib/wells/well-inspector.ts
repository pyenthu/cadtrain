/**
 * well-inspector.ts — the PURE prop→form logic behind `WellInspectorDock.svelte`
 * (W-B, `docs/plans/wells-interface.md` §B / `wells-ewells-gaps.md` B4).
 *
 * The inspector edits ONE selected well element at a time. Rather than teach the
 * dock every WSON shape (open-hole / casing / cement / completion / perf — each
 * with different fields), the shell normalises the selected element into a flat
 * `WellInspectorElement` and the dock renders a field list derived HERE. That
 * keeps the Svelte component dumb (props in, patches out) and this file headless-
 * testable (`well-inspector.test.ts`) exactly like `wson-2d.ts` / `wson-mutate.ts`.
 *
 * UNITS mirror WSON: depths in METRES, diameters/walls in INCHES, angles °.
 * No DOM / Svelte / Three here — model layer only.
 */
import type { Wson, CasingType } from './wson';
import { completionExtents } from './wson';
import { resolveComponent, CATEGORY_COLOR } from './registry';

/** The editable well-element kinds (mirrors `assemble.ts`'s `WellPartKind`). */
export type WellElementKind = 'openhole' | 'casing' | 'cement' | 'completion' | 'perf';

/**
 * A normalised, inspector-facing view of one selected well element. The shell
 * builds these from its WSON doc (via `inspectorElementsFromWson`, or by hand)
 * and hands the SELECTED one + the full list to the dock; the dock never reads
 * WSON directly. `index` targets the source WSON collection for `kind`
 * (`oh`/`ch`/`cementing`/`completions`/`perforations`) so a patch is routable.
 */
export interface WellInspectorElement {
  kind: WellElementKind;
  /** Index into the source WSON array for this kind. */
  index: number;
  /** Stable identity for list keying + selection: `${kind}:${index}`. */
  elKey: string;
  /** Display label (assembler-style, e.g. `OH 8.5"` / `production 9.625"`). */
  label: string;
  /** Kind / category colour (hex) — the header swatch. */
  color: string;
  // ── Editable fields (presence depends on kind) ─────────────────────────────
  od?: number;          // outer diameter (in)
  id?: number;          // inner diameter (in) — hollow tubulars
  top?: number;         // top MD (m)
  bot?: number;         // bottom MD (m)
  length?: number;      // length (m) — completions
  bitSize?: number;     // bit size (in) — open hole
  grade?: string;       // steel grade — casing
  weight?: number;      // linear weight (lb/ft) — casing
  type?: string;        // casing/string classification
  tool_comp?: string;   // catalog key — completion
  description?: string; // free label — completion
}

/**
 * A partial edit emitted by the dock. Carries the target (`kind` + `index`) so
 * the shell can route it to the right WSON collection, plus exactly ONE changed
 * field. Only finite numbers / defined strings appear (blank inputs never emit).
 */
export interface WellElementPatch {
  kind: WellElementKind;
  index: number;
  od?: number;
  id?: number;
  top?: number;
  bot?: number;
  length?: number;
  bitSize?: number;
  grade?: string;
  weight?: number;
  type?: string;
  tool_comp?: string;
  description?: string;
  label?: string;
  color?: string;
}

/** One rendered form row. `key` names both the field and the patch it produces
 *  (`wall` is virtual — it maps to an `id` patch). */
export interface InspectorField {
  key: 'od' | 'id' | 'wall' | 'top' | 'bot' | 'length' | 'bitSize' | 'grade' | 'weight' | 'type' | 'tool_comp' | 'description' | 'label' | 'color';
  label: string;
  type: 'number' | 'text' | 'select' | 'color';
  value: number | string | undefined;
  unit?: string;
  group: 'Dimensions' | 'Depth' | 'Classification' | 'Appearance';
  readonly?: boolean;
  options?: readonly string[];
  step?: number;
}

/** Per-kind header metadata (icon glyph + friendly kind name). */
export const KIND_META: Record<WellElementKind, { name: string; glyph: string }> = {
  openhole: { name: 'Open hole', glyph: '◗' },
  casing: { name: 'Casing', glyph: '▤' },
  cement: { name: 'Cement', glyph: '▦' },
  completion: { name: 'Completion', glyph: '◆' },
  perf: { name: 'Perforation', glyph: '⇥' },
};

export const CASING_TYPES: readonly CasingType[] = [
  'conductor', 'surface', 'intermediate', 'production', 'liner', 'tubing',
];

/** Casing/string colour by classification (mirrors `assemble.ts`'s CASING_COLOR
 *  so an inspector element built here matches the 3D/2D swatch). */
const CASING_COLOR: Record<string, string> = {
  conductor: '#94a3b8', surface: '#64748b', intermediate: '#475569',
  production: '#334155', liner: '#1e293b', tubing: '#9ca3af',
};

/** Stable element identity — `kind:index`. */
export function elementId(kind: WellElementKind, index: number): string {
  return `${kind}:${index}`;
}

/** Derived wall thickness (in) for a hollow tubular: `(od − id) / 2`. */
export function wallOf(el: WellInspectorElement): number | undefined {
  if (el.od != null && el.id != null && el.od > el.id) return (el.od - el.id) / 2;
  return undefined;
}

/**
 * The ordered list of editable fields for a selected element — the pure form
 * spec the dock renders. Fields absent for a kind are simply omitted.
 */
export function inspectorFields(el: WellInspectorElement): InspectorField[] {
  const f: InspectorField[] = [];
  const num = (
    key: InspectorField['key'], label: string, value: number | undefined,
    group: InspectorField['group'], unit?: string, step = 0.001, readonly = false,
  ) => f.push({ key, label, type: 'number', value, unit, group, step, readonly });
  const txt = (key: InspectorField['key'], label: string, value: string | undefined, group: InspectorField['group']) =>
    f.push({ key, label, type: 'text', value, group });

  switch (el.kind) {
    case 'openhole':
      num('bitSize', 'Bit size', el.bitSize ?? el.od, 'Dimensions', 'in');
      num('top', 'Top', el.top, 'Depth', 'm', 0.1);
      num('bot', 'Bottom', el.bot, 'Depth', 'm', 0.1);
      break;
    case 'casing':
      f.push({ key: 'type', label: 'String', type: 'select', value: el.type ?? 'casing', group: 'Classification', options: CASING_TYPES });
      num('od', 'OD', el.od, 'Dimensions', 'in');
      num('id', 'ID', el.id, 'Dimensions', 'in');
      num('wall', 'Wall', wallOf(el), 'Dimensions', 'in');
      num('top', 'Top', el.top, 'Depth', 'm', 0.1);
      num('bot', 'Bottom', el.bot, 'Depth', 'm', 0.1);
      txt('grade', 'Grade', el.grade, 'Classification');
      num('weight', 'Weight', el.weight, 'Classification', 'lb/ft', 0.1);
      break;
    case 'cement':
      num('od', 'OD', el.od, 'Dimensions', 'in');
      num('top', 'Top', el.top, 'Depth', 'm', 0.1);
      num('bot', 'Bottom', el.bot, 'Depth', 'm', 0.1);
      break;
    case 'completion':
      txt('tool_comp', 'Tool', el.tool_comp, 'Classification');
      txt('description', 'Description', el.description, 'Classification');
      num('od', 'OD', el.od, 'Dimensions', 'in');
      num('top', 'Top', el.top, 'Depth', 'm', 0.1);
      num('bot', 'Bottom', el.bot, 'Depth', 'm', 0.1);
      num('length', 'Length', el.length, 'Depth', 'm', 0.1);
      break;
    case 'perf':
      txt('label', 'Label', el.label, 'Classification');
      num('top', 'Top', el.top, 'Depth', 'm', 0.1);
      num('bot', 'Bottom', el.bot, 'Depth', 'm', 0.1);
      f.push({ key: 'color', label: 'Colour', type: 'color', value: el.color, group: 'Appearance' });
      break;
  }
  return f;
}

/** The distinct field groups present in a field list, in canonical order. */
const GROUP_ORDER: InspectorField['group'][] = ['Dimensions', 'Depth', 'Classification', 'Appearance'];
export function fieldGroups(fields: InspectorField[]): { group: InspectorField['group']; fields: InspectorField[] }[] {
  return GROUP_ORDER
    .map((group) => ({ group, fields: fields.filter((x) => x.group === group) }))
    .filter((g) => g.fields.length > 0);
}

function coerceNumber(raw: unknown): number | undefined {
  if (raw === '' || raw == null) return undefined;
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Build a routable patch from one edited field. Returns `null` when the value is
 * blank / non-finite (so a cleared numeric input never clobbers a value with
 * NaN — matches `applyCompletionPatch`). The virtual `wall` field is translated
 * to an `id` patch (`id = od − 2·wall`, clamped ≥ 0) so WSON stays canonical.
 */
export function buildPatch(
  el: WellInspectorElement,
  key: InspectorField['key'],
  raw: string | number,
): WellElementPatch | null {
  const base = { kind: el.kind, index: el.index };
  switch (key) {
    case 'od': case 'id': case 'top': case 'bot': case 'length': case 'bitSize': case 'weight': {
      const v = coerceNumber(raw);
      if (v == null) return null;
      return { ...base, [key]: v };
    }
    case 'wall': {
      const wall = coerceNumber(raw);
      if (wall == null || el.od == null) return null;
      const id = Math.max(0, el.od - 2 * wall);
      return { ...base, id };
    }
    case 'grade': case 'type': case 'tool_comp': case 'description': case 'label': case 'color': {
      return { ...base, [key]: String(raw) };
    }
    default:
      return null;
  }
}

/**
 * Normalise a whole WSON doc into inspector elements (a convenience for the
 * shell — the dock itself only needs `selected` + `elements`). Order mirrors
 * `assembleWell`: open-hole → cement → casing → completions → perforations, each
 * carrying its SOURCE index so a patch routes back to the right array. Pure.
 */
export function inspectorElementsFromWson(wson: Wson | null | undefined): WellInspectorElement[] {
  if (!wson) return [];
  const out: WellInspectorElement[] = [];

  (wson.oh ?? []).forEach((o, i) => {
    out.push({
      kind: 'openhole', index: i, elKey: elementId('openhole', i),
      label: `OH ${o.bitSize}"`, color: '#6b4f3a',
      bitSize: o.bitSize, od: o.bitSize, top: o.top, bot: o.bot,
    });
  });
  (wson.cementing ?? []).forEach((c, i) => {
    out.push({
      kind: 'cement', index: i, elKey: elementId('cement', i),
      label: `cement ${c.od}"`, color: '#a8a29e', od: c.od, top: c.top, bot: c.bot,
    });
  });
  (wson.ch ?? []).forEach((c, i) => {
    const t = c.type ?? 'casing';
    out.push({
      kind: 'casing', index: i, elKey: elementId('casing', i),
      label: `${t} ${c.od}"`, color: CASING_COLOR[t] ?? '#475569',
      od: c.od, id: c.id, top: c.top, bot: c.bot, grade: c.grade, weight: c.weight, type: c.type,
    });
  });
  const comps = wson.completions ?? [];
  const ext = completionExtents(comps);
  comps.forEach((c, i) => {
    const { top, bot } = ext[i];
    const r = resolveComponent(c, bot - top);
    out.push({
      kind: 'completion', index: i, elKey: elementId('completion', i),
      label: c.description || c.tool_comp, color: CATEGORY_COLOR[r.category],
      od: c.od, top: c.top ?? top, bot: c.bot ?? bot, length: c.length,
      tool_comp: c.tool_comp, description: c.description,
    });
  });
  (wson.perforations ?? []).forEach((p, i) => {
    out.push({
      kind: 'perf', index: i, elKey: elementId('perf', i),
      label: p.label ?? 'perf', color: p.color ?? '#e53e3e', top: p.top, bot: p.bot,
    });
  });

  return out;
}
