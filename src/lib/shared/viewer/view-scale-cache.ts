/**
 * view-scale-cache — per-part LOCAL persistence of the editor's view SCALE.
 *
 * The radial (xScale) / z-depth (zScale) exaggeration, the graded AUTOSCALE state
 * (Auto-depth on/off + its strength), and the committed warp bake-scale are VIEW-ONLY
 * dials that today RESET on every part load. Users want them to STICK per assembly/part:
 * reopen a part and its scale comes back. We keep that in `localStorage` keyed by the
 * part id — not in the part source (which is the shared, on-volume artifact) — so it's a
 * private, per-machine view preference. Saved on every scale change (so it's captured
 * BEFORE any rebake), restored on load (winning over the reset / auto-normalize).
 *
 * Pure + defensive: SSR / disabled-storage / a malformed entry all degrade to null
 * (→ the caller keeps today's default reset behaviour). `parseViewScale` is exported
 * so the shape-guard is unit-testable without a real localStorage.
 */
export interface ViewScale {
  /** Radial (X+Y) diameter exaggeration. */
  xScale: number;
  /** Z-depth (along-hole) exaggeration. */
  zScale: number;
  /** Graded auto-depth (DTX) toggle. */
  autoDepth: boolean;
  /** Auto-depth magnification strength (0..1, a fraction-of-total footprint). */
  warpAutoStrength: number;
  /** Committed spline-aware bake scale for a WARPED part. */
  warpBakeScale: { radial: number; depth: number };
}

const KEY = (id: string) => `ge-viewscale:${id}`;

/** Coerce a parsed blob into a well-formed ViewScale, or null if it's not usable.
 *  Every field is bounded to a sane default so a partial/old entry can't corrupt the
 *  scene. Pure — no storage access, so it's directly testable. */
export function parseViewScale(raw: unknown): ViewScale | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as any;
  const num = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
  // require at least the two core scales to be present + finite
  if (typeof v.xScale !== 'number' || typeof v.zScale !== 'number'
      || !Number.isFinite(v.xScale) || !Number.isFinite(v.zScale)) return null;
  return {
    xScale: v.xScale,
    zScale: v.zScale,
    autoDepth: !!v.autoDepth,
    warpAutoStrength: Math.min(1, Math.max(0, num(v.warpAutoStrength, 0.4))),
    warpBakeScale: {
      radial: num(v.warpBakeScale?.radial, 1),
      depth: num(v.warpBakeScale?.depth, 1),
    },
  };
}

/** The saved view scale for a part id, or null (SSR / none / malformed). */
export function loadViewScale(id: string): ViewScale | null {
  if (!id || typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(KEY(id));
    return raw ? parseViewScale(JSON.parse(raw)) : null;
  } catch { return null; }
}

/** Persist the view scale for a part id (best-effort — quota / SSR are swallowed). */
export function saveViewScale(id: string, v: ViewScale): void {
  if (!id || typeof localStorage === 'undefined') return;
  try { localStorage.setItem(KEY(id), JSON.stringify(v)); } catch { /* quota / disabled */ }
}
