/**
 * Per-instance viewer colours (Phase A — UI only).
 *
 * Each part instance in the `/components` inspector (`A`, `B`, ...) gets
 * a distinct hue so the user can map "this accordion row" to "this part"
 * at a glance. The chosen colour:
 *   1. Comes from `meta.instanceColors[<name>]` when the user has picked
 *      one via the inspector swatch (slice A3).
 *   2. Falls back to a hash-by-instance-name lookup in the 12-stop
 *      palette below, so unset instances still get a deterministic +
 *      distinct colour without any user action.
 *
 * Phase A renders the colour as the accordion's left-border stripe +
 * the swatch button only — the canvas still uses the existing
 * red-outer / grey-bore convention. Phase B will tint actual geometry
 * via a GeomAcc segment refactor (see task #86).
 */

/** Tailwind-500 hues — 12 evenly-spaced colours around the wheel that
 *  read distinctly on a white background and don't clash with the red
 *  highlight (#cc2222) used elsewhere in the inspector. */
export const INSTANCE_PALETTE: readonly string[] = [
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#84cc16', // lime
  '#22c55e', // green
  '#14b8a6', // teal
  '#06b6d4', // cyan
  '#3b82f6', // blue
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#d946ef', // fuchsia
  '#ec4899', // pink
];

/** Cheap deterministic 32-bit hash of a string — FNV-1a. Used to pick
 *  a palette index for an instance name. Same input → same colour
 *  every time, no matter how the instances were created. */
function hashName(name: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Default INNER (cut/interior) colour — the classic cutaway grey. */
export const DEFAULT_INNER_COLOR = '#888888';

/** A part's two-colour appearance: `outer` = external skin, `inner` = the
 *  surface revealed when the part is cut (bore wall / cross-section). */
export interface InstanceColors { outer: string; inner: string; }

const isHex = (s: unknown): s is string => typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s);

/** Resolve {outer, inner} for an instance. `override` may be a bare hex
 *  string (legacy — sets outer only) or a `{ outer?, inner? }` object.
 *  outer falls back to the per-name palette; inner falls back to grey. */
export function colorsForInstance(
  name: string,
  override?: string | { outer?: string; inner?: string } | undefined,
): InstanceColors {
  const o = typeof override === 'object' && override ? override : undefined;
  const outerOverride = typeof override === 'string' ? override : o?.outer;
  return {
    outer: isHex(outerOverride) ? outerOverride : INSTANCE_PALETTE[hashName(name) % INSTANCE_PALETTE.length],
    inner: isHex(o?.inner) ? (o!.inner as string) : DEFAULT_INNER_COLOR,
  };
}
