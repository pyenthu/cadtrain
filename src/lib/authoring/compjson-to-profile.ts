/**
 * compjson-to-profile — deterministic 2D → r_revolve inference.
 *
 * Maps a SVTC compjson half-section drawing (DrawingML-extracted polyline
 * JSON) to a parametric r_revolve profile. The convention:
 *
 *   LEFT half (x < width/2)   = SECTION cut — bore + internal seats + grooves
 *   RIGHT half (x > width/2)  = OUTER silhouette (often just a rectangle)
 *   Centerline at x = width/2
 *
 * For axisymmetric tubular parts (the common case in oilfield completions),
 * the section-cut element IS the half-section profile. We:
 *   1. Pick the dominant section-half element (largest polygon).
 *   2. Re-coord each vertex:  r = (centerline - x) / scale,  z = y / scale.
 *      Vertices on the centerline (x = width/2) → r = 0.
 *   3. Calibrate scale from the seed's `od_in` (spreadsheet authoritative).
 *   4. Detect additional section-half elements as internal features (yellow
 *      = seats, red = elastomer/threads) and emit them as sub-polygons.
 *
 * This is pure geometric inference — no learning model, no LLM. Works on
 * any rotationally symmetric part where the drawing follows the
 * left-section/right-outer convention.
 *
 * NOT covered yet (returned as warnings):
 *   - Non-axisymmetric features (side ports, gas-lift valve stems)
 *   - Drawings that use a different convention (top-bottom split, full views)
 *   - Multi-material grading beyond the simple fill-color heuristic
 */

export interface CompJsonPoint { x?: number; y?: number; directive: 'moveTo' | 'lineTo' | 'cubicBezTo' | 'close' }
export interface CompJsonElement {
  type: string;
  fill?: any;
  stroke?: string;
  strokeWidth?: number | number[];
  points: CompJsonPoint[];
}
export interface CompJsonDoc { width: number; height: number; elements: CompJsonElement[] }

export interface InferOptions {
  od_in: number;          // outer diameter in inches (from seed dims_from_catalogue.od_in)
  length_ft?: number;     // catalogue length (for Z-scale sanity check)
  id_in?: number;         // bore — if 0 or unset, treat as solid
}

export interface InternalFeature {
  kind: 'seat' | 'elastomer' | 'thread_band' | 'mark' | 'unknown';
  polygon: Array<[number, number]>;
  fill_color: string;
}

export interface InferredProfile {
  polygon: Array<[number, number]>;        // closed half-section in [r, z] inches
  scale_in_per_px: number;                  // calibration applied
  bbox: { r_max: number; z_max: number };
  axisymmetric: boolean;                    // best-guess: does it revolve cleanly?
  internal_features: InternalFeature[];     // optional sub-polygons (seats, elastomer)
  warnings: string[];
}

// ─── classification helpers (mirror CompJsonSilhouette logic) ─────────────

function classifyByHalf(doc: CompJsonDoc) {
  const half = doc.width / 2;
  const section: CompJsonElement[] = [];
  const outer:   CompJsonElement[] = [];
  const span:    CompJsonElement[] = [];
  for (const el of doc.elements) {
    if (el.type !== 'freeform' || !Array.isArray(el.points) || el.points.length === 0) continue;
    let xMin = Infinity, xMax = -Infinity;
    for (const p of el.points) {
      if (p.x == null) continue;
      if (p.x < xMin) xMin = p.x;
      if (p.x > xMax) xMax = p.x;
    }
    if (!Number.isFinite(xMin)) continue;
    const midX = (xMin + xMax) / 2;
    const fullSpan = (xMax - xMin) > doc.width * 0.7;
    if (fullSpan)              span.push(el);
    else if (midX < half)      section.push(el);
    else                       outer.push(el);
  }
  return { section, outer, span, half };
}

// signed area shoelace — to dedupe ordering + score "main" element by size.
function polygonArea(pts: Array<{ x: number; y: number }>): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!, q = pts[(i + 1) % pts.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

function vertices(el: CompJsonElement): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (const p of el.points) {
    if (p.directive === 'close') continue;
    if (p.x == null || p.y == null) continue;
    out.push({ x: p.x, y: p.y });
  }
  return out;
}

function pickMain(els: CompJsonElement[]): CompJsonElement | null {
  if (!els.length) return null;
  let best = els[0]!, bestArea = polygonArea(vertices(best));
  for (const e of els.slice(1)) {
    const a = polygonArea(vertices(e));
    if (a > bestArea) { best = e; bestArea = a; }
  }
  return best;
}

// Drop coincident consecutive vertices that come from a return-to-start
// (e.g. the closing vertex repeated as a literal lineTo before <close>).
function dedupeColinear(pts: Array<[number, number]>): Array<[number, number]> {
  if (pts.length < 2) return pts;
  const out: Array<[number, number]> = [];
  const eq = (a: [number, number], b: [number, number]) =>
    Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
  for (const p of pts) {
    if (out.length && eq(out[out.length - 1]!, p)) continue;
    out.push(p);
  }
  // Drop the explicit close-back if present.
  while (out.length > 1 && eq(out[0]!, out[out.length - 1]!)) out.pop();
  return out;
}

// Fill-color heuristic — wired to oilfield drafting conventions seen
// in the SVTC compjson corpus.
function classifyFeature(fill: any): InternalFeature['kind'] {
  let color = 'unknown';
  if (typeof fill === 'string') color = fill.toLowerCase();
  else if (fill?.type === 'solid' && fill.color) color = String(fill.color).toLowerCase();
  else if (fill?.type === 'gradient' && fill.gstops?.[0]?.['stop-color']) {
    color = String(fill.gstops[0]['stop-color']).toLowerCase();
  }
  // yellow / amber → packer or seat elastomer
  if (color === '#ffff00' || color === 'yellow') return 'seat';
  if (color === '#000000' || color === 'black')  return 'elastomer';
  if (color === '#ff00ff' || color === 'magenta') return 'thread_band';
  if (color === '#ff0000' || color === 'red')     return 'mark';
  return 'unknown';
}

// ─── main inference ───────────────────────────────────────────────────────

export function inferProfile(doc: CompJsonDoc, opts: InferOptions): InferredProfile {
  const warnings: string[] = [];
  const { section, outer, half } = classifyByHalf(doc);

  if (!section.length) {
    warnings.push('no section-half elements found — drawing may not use the left-section convention');
  }
  if (!outer.length) {
    warnings.push('no outer-half elements found — drawing may be section-only');
  }

  const mainSection = pickMain(section);
  if (!mainSection) {
    return {
      polygon: [],
      scale_in_per_px: 0,
      bbox: { r_max: 0, z_max: 0 },
      axisymmetric: false,
      internal_features: [],
      warnings: [...warnings, 'no inferrable section polyline — manual authoring required'],
    };
  }

  // OD-pixel = distance from centerline to the section's far OD edge
  // (leftmost vertex in the section half).
  const sv = vertices(mainSection);
  let xMinSection = Infinity;
  for (const v of sv) if (v.x < xMinSection) xMinSection = v.x;
  const odPx = half - xMinSection;
  if (odPx <= 0) {
    return {
      polygon: [],
      scale_in_per_px: 0,
      bbox: { r_max: 0, z_max: 0 },
      axisymmetric: false,
      internal_features: [],
      warnings: [...warnings, `degenerate odPx (${odPx}) — section element doesn't reach a recognisable OD edge`],
    };
  }
  // OD-inches is the catalogue OD (full diameter), so OD-radius = od_in / 2.
  const scale_in_per_px = (opts.od_in / 2) / odPx;

  // Transform: r = (half - x) * scale, z = y * scale. Vertices on the
  // centerline (x = half) → r = 0. Outer edge (x = xMinSection) → r = od/2.
  // Clamp tiny negatives at r ≈ 0 to true 0 — these come from drawings
  // where the section edge crosses the centerline by 1 px of float drift.
  const clampR = (r: number): number => (Math.abs(r) < 1e-3 ? 0 : r < 0 ? 0 : r);
  const polygon: Array<[number, number]> = sv.map(({ x, y }) => {
    const r = +clampR((half - x) * scale_in_per_px).toFixed(4);
    const z = +(y * scale_in_per_px).toFixed(4);
    return [r, z] as [number, number];
  });

  // Clean up: dedupe coincident vertices that come from the close-back.
  const cleaned = dedupeColinear(polygon);

  // Sanity bbox.
  let rMax = 0, zMax = 0;
  for (const [r, z] of cleaned) { if (r > rMax) rMax = r; if (z > zMax) zMax = z; }
  // Tighten od warning if OD-radius mismatch exceeds 0.5%.
  if (Math.abs(rMax - opts.od_in / 2) > 0.005 * opts.od_in) {
    warnings.push(`r_max ${rMax.toFixed(4)}" doesn't match calibrated OD-radius ${(opts.od_in / 2).toFixed(4)}" — clipping or scale drift`);
  }
  // Length sanity vs catalogue.
  if (opts.length_ft != null) {
    const lenIn = opts.length_ft * 12;
    const drift = Math.abs(zMax - lenIn) / lenIn;
    if (drift > 0.15) {
      warnings.push(`inferred length ${zMax.toFixed(2)}" diverges from catalogue ${lenIn}" by ${(drift * 100).toFixed(1)}% — drawing aspect ratio likely doesn't match catalogue length`);
    }
  }

  // Best-guess axisymmetry — if the outer rectangle's height matches the
  // section's height, the part probably revolves cleanly. Mismatched
  // heights = non-axisymmetric (probably a side feature).
  let axisymmetric = true;
  if (mainSection && outer.length) {
    const sectionH = (() => {
      let yMin = Infinity, yMax = -Infinity;
      for (const v of sv) { if (v.y < yMin) yMin = v.y; if (v.y > yMax) yMax = v.y; }
      return yMax - yMin;
    })();
    const outerH = (() => {
      let yMin = Infinity, yMax = -Infinity;
      for (const e of outer) for (const v of vertices(e)) {
        if (v.y < yMin) yMin = v.y; if (v.y > yMax) yMax = v.y;
      }
      return yMax - yMin;
    })();
    if (Math.abs(sectionH - outerH) > 0.02 * Math.max(sectionH, outerH)) {
      axisymmetric = false;
      warnings.push('section height ≠ outer height — likely a side feature breaks rotational symmetry');
    }
  }

  // Internal features = section elements OTHER than the main one.
  const features: InternalFeature[] = [];
  for (const el of section) {
    if (el === mainSection) continue;
    const fv = vertices(el);
    if (fv.length < 3) continue;
    const fpoly = dedupeColinear(fv.map(({ x, y }) => {
      const r = +clampR((half - x) * scale_in_per_px).toFixed(4);
      const z = +(y * scale_in_per_px).toFixed(4);
      return [r, z] as [number, number];
    }));
    let fillColor = 'unknown';
    if (typeof el.fill === 'string') fillColor = el.fill;
    else if (el.fill?.type === 'solid') fillColor = el.fill.color ?? 'unknown';
    else if (el.fill?.type === 'gradient') fillColor = el.fill.gstops?.[0]?.['stop-color'] ?? 'gradient';
    features.push({ kind: classifyFeature(el.fill), polygon: fpoly, fill_color: fillColor });
  }

  return {
    polygon: cleaned,
    scale_in_per_px,
    bbox: { r_max: +rMax.toFixed(4), z_max: +zMax.toFixed(4) },
    axisymmetric,
    internal_features: features,
    warnings,
  };
}

// ─── source emitter — turn an InferredProfile into a .rev.ts ───────────────

export function inferredToRevSource(termId: string, inferred: InferredProfile, opts: InferOptions): string {
  const polyLines = inferred.polygon.map(([r, z]) => `  [${r}, ${z}],`).join('\n');
  return `// AUTO-INFERRED from compjson half-section drawing.
// Generated by src/lib/authoring/compjson-to-profile.ts on ${new Date().toISOString().slice(0,10)}.
// Promote: review in /vocab, click Promote → vocabulary.

export const meta = {
  id: '${termId}',
  kind: 'rev',
  params: {},
  uses: ['r_revolve'],
  generated_from: {
    source: 'compjson',
    od_in: ${opts.od_in},
    scale_in_per_px: ${inferred.scale_in_per_px.toFixed(6)},
    axisymmetric: ${inferred.axisymmetric},
    bbox: { r_max: ${inferred.bbox.r_max}, z_max: ${inferred.bbox.z_max} },
    warnings: ${JSON.stringify(inferred.warnings)},
  },
};

export function ${termId}() {
  const profile = [
${polyLines}
  ];
  const body = r_revolve(profile, 64);
  return body;
}
`;
}
