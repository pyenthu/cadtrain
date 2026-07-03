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
 * add a demo: drop a `<name>.ts` here exporting a `TfExample`; it appears in the
 * dropdown automatically. `ORDER` gives the dropdown a deterministic, sensible
 * sequence (revolve/sweep families grouped); anything not listed sorts to the end.
 */
import type { TfDemoResult } from '../trueform-client';

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
  /** Build the geometry (optionally cut) → `{ data, stats, cutPlanes? }`. */
  build(opts?: { cutaway?: boolean }): Promise<TfDemoResult>;
}

/** Deterministic dropdown order — grouped: primitive · revolve family · sweep
 *  family · boolean · revolved parts. Names absent here sort alphabetically last. */
const ORDER = ['box', 'r_cyl', 's_cyl', 'helix', 'bored_pipe', 'dp_pin', 'dp_joint', 'cone'];

// Eager-glob every sibling module. Builder files export a `TfExample`; helper /
// registry / test modules (revolve.ts, this file) export other shapes — filtered
// out below by the `{name, label, build}` duck-type. No WASM loads here: a
// builder's `build()` (which calls `ensureTf()`) only runs when actually invoked.
const modules = import.meta.glob<Record<string, unknown>>(
  ['./*.ts', '!./index.ts', '!./*.test.ts'],
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

/** The ordered demo list for the dropdown (deterministic via {@link ORDER}). */
export const tfExamples: { name: string; label: string }[] = [...byName.values()]
  .sort((a, b) => {
    const ia = ORDER.indexOf(a.name), ib = ORDER.indexOf(b.name);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.name.localeCompare(b.name);
  })
  .map((e) => ({ name: e.name, label: e.label }));

/** Resolve a demo name → its builder (the TF-tab dispatch). Undefined if unknown. */
export function getTfExample(name: string): TfExample | undefined {
  return byName.get(name);
}

/** The union of registered demo names — the `tfDemo` prop / dropdown value type. */
export type TfExampleName = string;
