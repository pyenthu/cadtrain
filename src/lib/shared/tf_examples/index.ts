/**
 * tf_examples — the TrueForm demo REGISTRY.
 *
 * Each `tf_examples/<name>.ts` file is ONE demo part exporting a {@link TfExample}
 * builder (`{ name, label, build(opts?) }`). This index auto-collects them via
 * `import.meta.glob` and exposes:
 *   - `tfExamples` — the ordered `{name,label}` list the TF-tab dropdown renders.
 *   - `getTfExample(name)` — resolve a name → its builder (the dispatch).
 *
 * This decouples the demo CONTENT (these files) from the kernel DRIVER
 * (`trueform-client.ts`, which stays pure ensureTf/mesh/analyse/cap plumbing). To
 * add a demo: drop a `<name>.ts` here exporting a `TfExample` — it appears in the
 * dropdown AUTOMATICALLY (no central list to edit). Dropdown order is each part's
 * optional `order` field (lower first), then alphabetical by label.
 */
import type { TfDemoResult } from '../trueform-client';
import { ONLY_TF_EXAMPLES, EXCLUDED_TF_EXAMPLES } from './excluded';

/** A single TF-tab demo part. `build` returns mesh data + tf's topology verdict;
 *  `cutaway` (when supported) applies the half-quadrant section cut. */
export interface TfExample {
  /** Stable id — the dropdown value + dispatch key. */
  name: string;
  /** Human label shown in the dropdown. */
  label: string;
  /** True when the demo is a CLOSED solid the cutaway can section (all current
   *  examples are). Threaded to `tfResult` so the cutaway only runs when valid. */
  cuttable?: boolean;
  /** OPTIONAL dropdown sort weight (lower = earlier). Omit and the part sorts
   *  alphabetically by label — the registry is fully automatic, so a part
   *  self-declares its position here if it wants one; there is NO central list. */
  order?: number;
  /** Build the geometry (optionally cut) → `{ data, stats, cutPlanes? }`. */
  build(opts?: { cutaway?: boolean }): Promise<TfDemoResult>;
}

// Eager-glob every sibling module. Builder files export a `TfExample`; helper /
// registry / test modules (revolve.ts, this file) export other shapes — filtered
// out below by the `{name, label, build}` duck-type. No WASM loads here: a
// builder's `build()` (which calls `ensureTf()`) only runs when actually invoked.
const modules = import.meta.glob<Record<string, unknown>>(
  ['./*.ts', '!./index.ts', '!./excluded.ts', '!./*.test.ts'],
  { eager: true },
);

function isTfExample(v: unknown): v is TfExample {
  return (
    !!v && typeof v === 'object' &&
    typeof (v as any).name === 'string' &&
    typeof (v as any).label === 'string' &&
    typeof (v as any).build === 'function'
  );
}

const byName = new Map<string, TfExample>();
for (const mod of Object.values(modules)) {
  for (const exp of Object.values(mod)) {
    if (isTfExample(exp)) byName.set(exp.name, exp);
  }
}

/** The demo list for the dropdown — AUTO-DERIVED from the glob. Sorted by each
 *  part's optional `order` (lower first), then alphabetically by label. Adding a
 *  `tf_examples/<name>.ts` makes it appear automatically; nothing to register. */
export const tfExamples: { name: string; label: string }[] = [...byName.values()]
  // Dropdown filter (excluded.ts): the ONLY allow-list wins when non-empty; else
  // hide the EXCLUDED set. Hidden builders stay resolvable via getTfExample.
  .filter((e) =>
    ONLY_TF_EXAMPLES.size > 0 ? ONLY_TF_EXAMPLES.has(e.name) : !EXCLUDED_TF_EXAMPLES.has(e.name),
  )
  .sort((a, b) =>
    (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) ||
    a.label.localeCompare(b.label),
  )
  .map((e) => ({ name: e.name, label: e.label }));

/** Resolve a demo name → its builder (the TF-tab dispatch). Undefined if unknown. */
export function getTfExample(name: string): TfExample | undefined {
  return byName.get(name);
}

/** The union of registered demo names — the `tfDemo` prop / dropdown value type. */
export type TfExampleName = string;
