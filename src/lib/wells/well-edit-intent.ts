/**
 * well-edit-intent.ts — PURE editor-intent glue between the UI surfaces (tool
 * rail, inspector) and the WSON edit core. No DOM / Svelte / Three, so it unit-
 * tests headless (`well-edit-intent.test.ts`) exactly like `well-inspector.ts`.
 *
 * Two jobs:
 *  1. `kindToArrayKey` — route an inspector element edit (a `WellElementKind`)
 *     to the WSON array it lives in, so `onEdit` can call
 *     `store.updateElement(kindToArrayKey(patch.kind), patch.index, patch)`.
 *  2. `addElementIntent` — resolve a tool-rail "add" button (`WellElementType`)
 *     into a concrete, well-formed default element + its target WSON array (the
 *     pure "intent"/patch). `applyAddElement` then routes that intent through a
 *     `WellEditCore`/`WellEditStore` so the add is a single, undoable, identity-
 *     preserving mutation. Keeping the intent pure means the store wiring is a
 *     one-liner and the mapping (which tool_comp a category resolves to, which
 *     array a kind lands in) is testable against the real registry.
 *
 * Completion `tool_comp` keys are chosen so each resolves in `registry.ts` to the
 * INTENDED category (a test pins that against `resolveComponent`). Where a `bw_*`
 * element part also exists (`wson-to-graph.ts`) the key is picked to bake, too:
 * packer / nipple / valve / mandrel / shoe / hanger have a `bw_*` today; ssd /
 * plug / crossover / drillpipe resolve for the inspector + 2D but currently have
 * NO `bw_*` part, so a 3D bake of one surfaces the NO-FALLBACK error — a known,
 * documented gap (extend `COMPLETION_PART_MAP` as parts land), not a stand-in.
 */
import type { Wson, CasingType } from './wson';
import type { WellArrayKey } from './well-edit-core';
import type { WellElementKind } from './well-inspector';
import type { WellElementType, CompletionType } from './well-tool-rail';

/**
 * Map an inspector element kind to the WSON array it lives in — the routing key
 * for a dock edit. Exhaustive over `WellElementKind` (TS errors if a kind is
 * added without a mapping). Pure.
 */
export function kindToArrayKey(kind: WellElementKind): WellArrayKey {
  switch (kind) {
    case 'openhole': return 'oh';
    case 'casing': return 'ch';
    case 'cement': return 'cementing';
    case 'completion': return 'completions';
    case 'perf': return 'perforations';
  }
}

/**
 * A resolved add-element intent — WHICH WSON array to append to, the inspector
 * KIND of the new element (so the caller can select it after adding), and the
 * default VALUE to append. This is the pure "patch" a tool-rail Add produces.
 */
export interface AddElementIntent {
  /** The tool-rail button this intent came from. */
  type: WellElementType;
  /** Target WSON array. */
  key: WellArrayKey;
  /** Inspector kind of the added element (for post-add selection). */
  kind: WellElementKind;
  /** The default element to append (deep-cloned by the edit core on add). */
  value: Record<string, unknown>;
}

/** Per completion category → a canonical registry `tool_comp` + display default.
 *  Each key resolves in `registry.ts` to its category (guarded by a test). */
const COMPLETION_TOOL_COMP: Record<CompletionType, { tool_comp: string; description: string; od: number }> = {
  packer:    { tool_comp: 'PACKERS.PACKER_BAKER_PERMANENT', description: 'Packer', od: 7 },
  nipple:    { tool_comp: 'FLOW_CONTROL.NIPPLE_R_LANDING', description: 'Landing nipple', od: 4.5 },
  valve:     { tool_comp: 'FLOW_CONTROL.TRSSSV_SP', description: 'Safety valve', od: 4.5 },
  ssd:       { tool_comp: 'FLOW_CONTROL.SSD', description: 'Sliding sleeve', od: 4.5 },
  mandrel:   { tool_comp: 'MISC.GAUGE_MANDREL', description: 'Gauge mandrel', od: 4.5 },
  shoe:      { tool_comp: 'MISC.MULE_SHOE', description: 'Mule shoe', od: 4.5 },
  hanger:    { tool_comp: 'TBGHANGER', description: 'Tubing hanger', od: 8.681 },
  plug:      { tool_comp: 'MISC.BELL_GUIDE', description: 'Bell guide / plug', od: 4.5 },
  crossover: { tool_comp: 'MISC.CROSSOVER', description: 'Crossover', od: 4.5 },
  drillpipe: { tool_comp: 'DRILL_PIPE.JOINT', description: 'Drill-pipe joint', od: 5 },
};

const STRUCTURAL_TYPES = new Set<WellElementType>(['openhole', 'casing', 'cement', 'tubing']);

/** A fresh 1 m-long completion appended top-to-bottom (AUTO-TOP: it follows the
 *  previous component's bot; the user then edits depth). */
function completionValue(cat: CompletionType): Record<string, unknown> {
  const d = COMPLETION_TOOL_COMP[cat];
  return { tool_comp: d.tool_comp, description: d.description, od: d.od, length: 1 };
}

/**
 * Resolve a tool-rail add button into a concrete intent. PURE — returns the
 * target array + a default element; no doc is touched (use `applyAddElement` to
 * commit it through the undoable edit core). Throws on an unknown `type` (an
 * intent for a button that does not exist is a bug, not a silent no-op).
 *
 *  - structural `openhole` / `cement` → `oh` / `cementing` rows;
 *  - structural `casing` / `tubing`   → `ch` rows (tubing = a `ch` string typed
 *    `'tubing'`, matching `CasingType`);
 *  - a completion category            → a `completions` row with the category's
 *    canonical `tool_comp`;
 *  - `perforation`                    → a `perforations` interval.
 */
export function addElementIntent(type: WellElementType): AddElementIntent {
  if (STRUCTURAL_TYPES.has(type)) {
    switch (type as Exclude<WellElementType, CompletionType | 'perforation'>) {
      case 'openhole':
        return { type, key: 'oh', kind: 'openhole', value: { bitSize: 8.5, top: 0, bot: 100 } };
      case 'cement':
        return { type, key: 'cementing', kind: 'cement', value: { od: 12, top: 0, bot: 100 } };
      case 'casing':
        return {
          type, key: 'ch', kind: 'casing',
          value: { od: 9.625, id: 8.681, top: 0, bot: 1000, grade: 'L80', type: 'casing' as CasingType },
        };
      case 'tubing':
        return {
          type, key: 'ch', kind: 'casing',
          value: { od: 4.5, id: 3.958, top: 0, bot: 1000, type: 'tubing' as CasingType },
        };
    }
  }

  if (type === 'perforation') {
    return { type, key: 'perforations', kind: 'perf', value: { top: 0, bot: 10, label: 'perforation' } };
  }

  // Otherwise it is a completion category (packer / nipple / …).
  if (type in COMPLETION_TOOL_COMP) {
    return { type, key: 'completions', kind: 'completion', value: completionValue(type as CompletionType) };
  }

  throw new Error(`addElementIntent: unknown element type "${type}"`);
}

/** The minimal edit surface `applyAddElement` needs — satisfied by both
 *  `WellEditCore` and the `.svelte.ts` `WellEditStore` (each exposes
 *  `addElement(key, value): number`). */
export interface WellAddController {
  addElement(key: WellArrayKey, value: object): number;
}

/**
 * Apply a tool-rail add to an edit core/store: resolve the intent, then append
 * through the controller's generic `addElement` (which snapshots → one undoable,
 * identity-preserving mutation). Returns the new element's index. The Svelte
 * `onAddElement(type)` handler is just `applyAddElement(activeStore, type)`.
 */
export function applyAddElement(controller: WellAddController, type: WellElementType): number {
  const intent = addElementIntent(type);
  return controller.addElement(intent.key, intent.value);
}

/** Optional convenience: apply an add + return the full intent alongside the new
 *  index (so a caller can immediately select the added element in the inspector
 *  via `{ kind: intent.kind, index }`). Pure over the controller. */
export function applyAddElementDetailed(
  controller: WellAddController,
  type: WellElementType,
): { intent: AddElementIntent; index: number } {
  const intent = addElementIntent(type);
  const index = controller.addElement(intent.key, intent.value);
  return { intent, index };
}

/** Also apply a completion doc's own reference so a Svelte `doc` caller can add
 *  without a controller (mutates in place, returns the new index). Kept for the
 *  `addElementIntent(doc, …)` doc-first call shape; the edit core is preferred
 *  because it snapshots for undo. */
export function addElementToDoc(doc: Wson, type: WellElementType): number {
  const intent = addElementIntent(type);
  const rec = doc as unknown as Record<string, unknown>;
  const arr = (Array.isArray(rec[intent.key]) ? rec[intent.key] : (rec[intent.key] = [])) as unknown[];
  arr.push(JSON.parse(JSON.stringify(intent.value)));
  return arr.length - 1;
}
