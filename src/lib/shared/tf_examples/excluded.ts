/**
 * TF-tab dropdown FILTER — control which `tf_examples` the picker OFFERS.
 *
 * The registry (index.ts) auto-globs every `<name>.ts` builder. This file trims
 * what the DROPDOWN shows (files stay on disk; every builder is still resolvable
 * via `getTfExample(name)`, so a part whose saved `tfDemo` points at a hidden one
 * still bakes). Two knobs — the allow-list wins when it's non-empty:
 *
 *  1. ONLY_TF_EXAMPLES — if NON-EMPTY, the dropdown shows ONLY these (work with a
 *     focused few). Empty ⇒ show everything except EXCLUDED_TF_EXAMPLES.
 *  2. EXCLUDED_TF_EXAMPLES — names to HIDE (used only when ONLY is empty).
 *
 * Edit freely, one `name` per line.
 */

/** Work-with-a-few allow-list. Non-empty ⇒ ONLY these show (order still by the
 *  builder's `order`/label). Clear it (`[]`) to go back to "show all but excluded". */
export const ONLY_TF_EXAMPLES = new Set<string>([
  's_tube_demo',      // curved hollow tube — bore-extended, clean (χ=0)
  's_tub_st',         // hollow tube (annular subtract)
  's_tube_no_ext',    // curved hollow tube — NO bore-extend → defect-2 demo
  'weld_extrude',     // welded profile → solid (the #51 weld-mesh builder)
]);

/** Hidden when ONLY is empty. */
export const EXCLUDED_TF_EXAMPLES = new Set<string>([
  'box',
]);
