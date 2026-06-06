/**
 * proposal-translator — turn a docs/parts/proposed-vocab-entries.json entry
 * into a runnable `.prim.ts` / `.asm.ts` source string.
 *
 * Mirrors rule-translator.ts but adds the K.69 `boolean_modify` rule kind:
 * a revolved body + a list of CSG modifiers (subtract / add / intersect of
 * named shape primitives like tilted_slab). The modifier shape kinds are
 * the compositional grammar's new primitives — each one emits a sandbox-
 * legal expression that takes parametric inputs and returns a Manifold.
 *
 * Supported modifier shapes:
 *   - tilted_slab — rectangular extrude, rotated cutAngle° around an axis,
 *     positioned at anchor_z. Used for one-sided angled cuts (mule shoe).
 *
 * The translator is deterministic: same proposed entry → same source.
 * No LLM, no learning model.
 */

export type Expr = string;        // a JS expression in scope of the geom function
export interface BooleanModifyShape {
  kind: string;                    // 'tilted_slab' | …
  [key: string]: any;
}
export interface BooleanModifier {
  op: 'subtract' | 'add' | 'intersect';
  shape: BooleanModifyShape;
}
export interface BooleanModifyRule {
  kind: 'boolean_modify';
  engine: string[];                 // ['r_revolve', 'r_extrude', …]
  body: {
    kind: 'primitive';
    template: 'polygon_inline';
    preamble?: string[];           // const lines to inline above the polygon
    polygon: string[];             // each entry an Expr like '[br, 0]'
  };
  modifiers: BooleanModifier[];
}

export interface ProposedEntry {
  kind: 'rev' | 'asm';
  extends?: string;
  category?: string;
  sub_category?: string;
  definition?: string;
  params: Record<string, { default: any; min?: number; max?: number; step?: number; unit?: string }>;
  rule: BooleanModifyRule;
  exemplar: string;
}

// ─── modifier shape → expression emitter ─────────────────────────────────

function emitTiltedSlab(shape: BooleanModifyShape): string {
  // Tilted slab for a one-sided angled cut. The slab's TOP face (z=0 in
  // local frame) IS the cut plane. Body extends z ∈ [0, depth] BELOW the
  // cut plane in local frame. After rotation around the world origin, the
  // body falls into the +x, +z half-space (in Z-down: deeper and to one
  // radial side) — this is the wedge of material to subtract from the
  // tube's bottom.
  //
  // CRUCIAL — do NOT centre the slab around origin before rotating, or
  // the slab body occupies both halves of the cut plane and subtract
  // wipes the whole part.
  //
  // shape fields:
  //   size_factor   : top-face width as a multiple of pipeOD (default 4 — must
  //                    cover the body's bore footprint after rotation, so ≥ √2 * 2)
  //   depth_factor  : slab body depth as a multiple of pipeOD (default 2 —
  //                    enough to fully clip past the body bottom)
  //   tilt_axis     : 'x' | 'y' | 'z' (default 'y' — Y-axis tilt produces a
  //                    radial slant in the x-z plane)
  //   tilt_angle_deg: number or param-name string
  //   anchor_z      : number or param-name string (cut-plane Z in world coords —
  //                    typically 'totalLen' so the plane sits at the body's bottom)
  const sf  = shape.size_factor ?? 4;
  const df  = shape.depth_factor ?? 2;
  const axis: 'x' | 'y' | 'z' = (shape.tilt_axis ?? 'y') as any;
  const angleExpr = typeof shape.tilt_angle_deg === 'string' ? shape.tilt_angle_deg : String(shape.tilt_angle_deg ?? 45);
  const anchorExpr = typeof shape.anchor_z === 'string' ? shape.anchor_z : String(shape.anchor_z ?? 0);
  const rotArg = axis === 'x' ? `[${angleExpr}, 0, 0]`
              : axis === 'z' ? `[0, 0, ${angleExpr}]`
              :                `[0, ${angleExpr}, 0]`;
  return `
    (() => {
      const W = pipeOD * ${sf};   // top-face footprint width
      const H = pipeOD * ${df};   // slab body depth past the cut plane
      const slabProfile = [[-W/2, -W/2], [W/2, -W/2], [W/2, W/2], [-W/2, W/2]];
      const slabRaw = r_extrude(slabProfile, H);  // top at z=0 (cut plane), body z∈[0,H]
      const slabTilted = rot(slabRaw, ${rotArg});  // rotate around world origin
      return mv(slabTilted, [0, 0, ${anchorExpr}]);  // anchor top face at the cut depth
    })()`.trim();
}

function emitModifierShape(shape: BooleanModifyShape): string {
  switch (shape.kind) {
    case 'tilted_slab': return emitTiltedSlab(shape);
    default: throw new Error(`unknown boolean_modify shape kind: ${shape.kind}`);
  }
}

// ─── rule → full source ─────────────────────────────────────────────────

export function translateProposed(termId: string, entry: ProposedEntry): string {
  if (entry.rule.kind !== 'boolean_modify') {
    throw new Error(`only boolean_modify supported here; got ${entry.rule.kind}`);
  }
  const fnId = `dt_${termId}_proposed`;
  const paramKeys = Object.keys(entry.params);
  const paramSig  = paramKeys.join(', ');
  // ?? default block at the function head so partial-call sites are safe.
  const defaults = paramKeys.map((k) => {
    const d = entry.params[k]?.default;
    const lit = typeof d === 'string' ? JSON.stringify(d) : String(d);
    return `  ${k} ??= ${lit};`;
  }).join('\n');

  const preambleLines = (entry.rule.body.preamble ?? []).map((l) => `  ${l}`).join('\n');
  const polyLines = entry.rule.body.polygon.map((p) => `    ${p},`).join('\n');

  // Modifier chain — start from `body`, chain .subtract / .add / .intersect.
  const opMap: Record<BooleanModifier['op'], string> = {
    subtract:  'subtract',
    add:       'add',
    intersect: 'intersect',
  };
  const modifierChain = entry.rule.modifiers.map((m, i) => {
    const expr = emitModifierShape(m.shape);
    return `  const __mod${i} = ${expr};\n  result = result.${opMap[m.op]}(__mod${i});`;
  }).join('\n');

  // Materialise meta + function.
  const metaParams = JSON.stringify(entry.params, null, 4)
    .split('\n').map((l, i) => i === 0 ? l : '  ' + l).join('\n');

  return `// AUTO-GENERATED from docs/parts/proposed-vocab-entries.json on ${new Date().toISOString().slice(0,10)}.
// Source: proposal-translator.ts (K.69 boolean_modify path).
// Term: ${termId} — rule.kind: ${entry.rule.kind}, engine: ${(entry.rule.engine ?? []).join(', ')}.

export const meta = {
  id: '${fnId}',
  name: '${fnId}',
  description: ${JSON.stringify(entry.definition ?? '')},
  kind: '${entry.kind}',
  uses: ${JSON.stringify(entry.rule.engine ?? [])},
  generated_from: { source: 'proposed-vocab-entries.json', term: '${termId}', rule_kind: '${entry.rule.kind}' },
  params: ${metaParams},
};

export function ${fnId}(${paramSig}) {
${defaults}
${preambleLines}

  // ── 1. Revolve the half-section body ────────────────────────────────────
  const profile = [
${polyLines}
  ];
  const body = r_revolve(profile, segments);

  // ── 2. Apply ${entry.rule.modifiers.length} CSG modifier(s) ─────────────
  let result = body;
${modifierChain}

  return result;
}
`;
}
