/**
 * Shared PartColorLUT types — used by render-helpers (client + server bake) and
 * part-colors (server compile). No server-only imports here.
 */
import type { PartAppearance } from '$lib/shared/viewer/part-appearance';

export interface PartColorLUT {
  /** hashId → outer '#rrggbb' (each part's external skin). */
  outer: Record<number, string>;
  /** hashId → inner '#rrggbb' (cut/bore wall colour for this part). */
  inner: Record<number, string>;
  /** hashId → render opacity (0–1); absent → opaque. */
  opacity?: Record<number, number>;
  /** hashIds used as subtract/intersect tools. */
  subtractive: number[];
  bodyId: number | null;
  bodyInner: string;
  bodyColor: string;
  bodyName: string | null;
  bodyCall: string | null;
  active: boolean;
  /** hashId → instance name (A, body, …). */
  names?: Record<number, string>;
  /** hashId → full appearance for the per-part mesh path. */
  appearance?: Record<number, PartAppearance>;
}
