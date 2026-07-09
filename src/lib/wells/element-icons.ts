/**
 * element-icons.ts — a shared TYPE → inline-SVG-glyph map for well elements.
 *
 * ONE place that owns the little schematic glyphs (open-hole · casing · cement ·
 * tubing · completion · perforation · packer · nipple · mandrel · valve · mule
 * shoe · hanger · casing shoe) so every /wells surface draws the SAME icon for a
 * given element type. Framework-free (pure data + string helpers, no Svelte /
 * Three) → reusable by the 3D scene's in-diagram label chips, the left element
 * rail, the 2D track view and the inspector, and unit-testable headless.
 *
 * Each glyph is a 16×16 `viewBox` STROKE path (or space-separated sub-paths),
 * meant to render with `fill="none" stroke="currentColor"` — matching the
 * existing `WellElementRail` convention so the two never drift.
 */

export type WellElementType =
  | 'openhole'
  | 'casing'
  | 'cement'
  | 'tubing'
  | 'completion'
  | 'perforation'
  | 'packer'
  | 'nipple'
  | 'mandrel'
  | 'valve'
  | 'mule'
  | 'hanger'
  | 'shoe';

export interface ElementIcon {
  type: WellElementType;
  /** Human label (title-case). */
  label: string;
  /** Accent colour (matches the 3D scene + rail palette). */
  color: string;
  /** 16×16 viewBox stroke path(s). Render with fill:none, stroke:currentColor. */
  path: string;
}

/**
 * The canonical glyph set. The first six mirror `WellElementRail`'s inline paths
 * verbatim so the rail can adopt this map without a visual change; the rest are
 * the completion-jewelry glyphs the rail lacked.
 */
export const ELEMENT_ICONS: Record<WellElementType, ElementIcon> = {
  openhole: { type: 'openhole', label: 'Open hole', color: '#c084fc', path: 'M5 2v12M11 2v12' },
  casing: { type: 'casing', label: 'Casing', color: '#94a3b8', path: 'M5 2v12M11 2v12M5 2h6M5 14h6' },
  cement: { type: 'cement', label: 'Cement', color: '#d6c7a1', path: 'M4 3h8v10H4zM4 6h8M4 9h8' },
  tubing: { type: 'tubing', label: 'Tubing', color: '#eab308', path: 'M6.5 2v12M9.5 2v12' },
  completion: {
    type: 'completion',
    label: 'Completion',
    color: '#f59e0b',
    path: 'M6 2v12M10 2v12M3 6.5h3M3 9.5h3M10 6.5h3M10 9.5h3',
  },
  perforation: {
    type: 'perforation',
    label: 'Perforations',
    color: '#ef4444',
    path: 'M6 2v12M10 2v12M3 5h3M3 8h3M3 11h3M10 5h3M10 8h3M10 11h3',
  },
  // ── Completion jewelry ─────────────────────────────────────────────────────
  packer: { type: 'packer', label: 'Packer', color: '#f59e0b', path: 'M5 2v12M11 2v12M3 6h10v4H3z' },
  nipple: {
    type: 'nipple',
    label: 'Nipple',
    color: '#ef4444',
    path: 'M5 2v12M11 2v12M5 6.5h2M9 6.5h2M5 9.5h2M9 9.5h2',
  },
  mandrel: { type: 'mandrel', label: 'Mandrel', color: '#0ea5e9', path: 'M5 2v12M11 2v12M11 6h3v4h-3z' },
  valve: { type: 'valve', label: 'Valve', color: '#dc2626', path: 'M5 2v12M11 2v12M5 6l6 4M11 6l-6 4' },
  mule: { type: 'mule', label: 'Mule shoe', color: '#a78bfa', path: 'M5 2v9l3 3 3-3V2' },
  hanger: { type: 'hanger', label: 'Hanger', color: '#64748b', path: 'M4 4h8M6 4v4h4V4M7 8v6M9 8v6' },
  shoe: { type: 'shoe', label: 'Casing shoe', color: '#94a3b8', path: 'M5 2v8l3 4 3-4V2M5 10h6' },
};

/** Ordered list handy for rails / legends. */
export const ELEMENT_ICON_LIST: ElementIcon[] = [
  ELEMENT_ICONS.openhole,
  ELEMENT_ICONS.casing,
  ELEMENT_ICONS.cement,
  ELEMENT_ICONS.tubing,
  ELEMENT_ICONS.completion,
  ELEMENT_ICONS.perforation,
];

/** Keyword → completion type, longest/most-specific first (mirrors the scene's
 *  `compColor` heuristic so icon + colour agree). */
const KEYWORD_TYPE: Array<[RegExp, WellElementType]> = [
  [/mule\s*shoe|mule/i, 'mule'],
  [/packer/i, 'packer'],
  [/nipple/i, 'nipple'],
  [/mandrel/i, 'mandrel'],
  [/hanger/i, 'hanger'],
  [/scssv|trsssv|trssv|sssv|valve/i, 'valve'],
  [/shoe|float\s*collar|guide/i, 'shoe'],
  [/perf/i, 'perforation'],
  [/cement/i, 'cement'],
  [/tubing/i, 'tubing'],
  [/casing/i, 'casing'],
  [/open\s*hole|openhole|\boh\b/i, 'openhole'],
];

/**
 * Resolve any free-text element key / description / `tool_comp` to an icon.
 * Falls back to the generic `completion` glyph so callers always get one.
 */
export function iconFor(key: string | null | undefined): ElementIcon {
  const k = (key ?? '').trim();
  if (!k) return ELEMENT_ICONS.completion;
  // Exact type hit first (e.g. 'casing', 'packer').
  const lower = k.toLowerCase() as WellElementType;
  if (lower in ELEMENT_ICONS) return ELEMENT_ICONS[lower];
  for (const [re, type] of KEYWORD_TYPE) if (re.test(k)) return ELEMENT_ICONS[type];
  return ELEMENT_ICONS.completion;
}

/**
 * Inline `<svg>` markup for a type (for `{@html}` / string contexts that can't
 * mount a component). `size` px, `stroke` overrides `currentColor`.
 */
export function iconSvg(
  key: string | WellElementType,
  opts: { size?: number; stroke?: string; strokeWidth?: number } = {},
): string {
  const ic = iconFor(key);
  const { size = 16, stroke = 'currentColor', strokeWidth = 1.4 } = opts;
  return (
    `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" ` +
    `stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" ` +
    `stroke-linejoin="round"><path d="${ic.path}"/></svg>`
  );
}
