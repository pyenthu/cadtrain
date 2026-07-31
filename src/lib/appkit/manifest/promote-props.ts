// src/lib/appkit/manifest/promote-props.ts — auto-promote a panel's component props into the
// app's runes STORE (app.vars) + a typed STRUCTURE (app.structures), binding each prop back to
// the store as a `$vars.<panelId>.<key>` ref.
//
// The store becomes the SINGLE SOURCE OF TRUTH: the component reads its props through
// resolveRef($vars.<id>.<key>) (refs.ts), and the ⚙ panel / other components / inputs / the AI
// all mutate the store — which is a Svelte 5 rune (HarnessView wraps app.vars in $derived; the
// studio's app is $state), so every read re-renders reactively. Runs automatically on
// add-component (definePanel / addChildPanel / insertTree).
//
// Idempotent + non-destructive:
//   • a prop already bound to a `$vars` ref (this OR another component's var) is LEFT as-is — an
//     explicit cross-component binding is intentional and never clobbered;
//   • an existing store value survives re-promotion (user edits are preserved).
// Opt out per-app with `app.autoPromoteProps === false`.
import type { AppManifest, Panel } from './types';
import { getComponentMeta, type PropSpec } from '../catalog/components';

const VARS_PREFIX = '$vars.';
const selfRef = (id: string, key: string) => `${VARS_PREFIX}${id}.${key}`;

/** Structure field type from a component PropSpec type (structures are freeform strings; select/
 *  color collapse to string). */
function structFieldType(t: PropSpec['type']): string {
  return t === 'number' || t === 'boolean' ? t : 'string';
}

/** A typed seed value for the store from a PropSpec (coerce number/boolean; else verbatim). */
function seedFromDefault(spec: PropSpec): unknown {
  const d = spec.default;
  if (d === undefined) return spec.type === 'number' ? 0 : spec.type === 'boolean' ? false : '';
  if (spec.type === 'number') return typeof d === 'number' ? d : Number(d);
  if (spec.type === 'boolean') return d === true || d === 'true';
  return d;
}

/** Promote one panel's meta-declared props into `app.vars[panelId]` (the store record) +
 *  `app.structures[panelId]` (its schema), rewriting each literal prop to a `$vars.<id>.<key>`
 *  ref. Mutates `app` in place. No-op when the component declares no props or promotion is off. */
export function promoteComponentProps(app: AppManifest, panel: Panel): void {
  if ((app as { autoPromoteProps?: boolean }).autoPromoteProps === false) return;
  const meta = getComponentMeta(panel.kind);
  if (!meta?.props?.length) return;

  const id = panel.id;
  panel.props ??= {};
  const existing = ((app.vars ??= {})[id] as Record<string, unknown> | undefined) ?? {};
  const store: Record<string, unknown> = { ...existing };
  const fields: Array<{ name: string; type?: string }> = [];

  for (const spec of meta.props) {
    const key = spec.name;
    fields.push({ name: key, type: structFieldType(spec.type) });
    const cur = panel.props[key];

    // An explicit $vars ref is respected (never clobber an intentional binding). If it points at
    // THIS component's own store slot, make sure that slot has a seed value.
    if (typeof cur === 'string' && cur.startsWith(VARS_PREFIX)) {
      if (cur === selfRef(id, key) && store[key] === undefined) store[key] = seedFromDefault(spec);
      continue;
    }

    // Literal or unset → seed the store (existing store value wins, then the supplied literal,
    // then the meta default) and bind the prop to the store.
    if (store[key] === undefined) store[key] = cur !== undefined ? cur : seedFromDefault(spec);
    panel.props[key] = selfRef(id, key);
  }

  app.vars[id] = store;
  (app.structures ??= {})[id] = fields;
}

/** Promote a panel AND all its descendants (for insertTree / pasted subtrees). */
export function promoteTree(app: AppManifest, panel: Panel): void {
  promoteComponentProps(app, panel);
  for (const child of panel.children ?? []) promoteTree(app, child);
}

/** Is this prop value a promoted store binding (`$vars.…`)? */
export function isStoreRef(v: unknown): v is string {
  return typeof v === 'string' && v.startsWith(VARS_PREFIX);
}

/** The dotted var path a `$vars.a.b` ref points at ('a.b'), or null if not a ref. */
export function storeRefPath(v: unknown): string | null {
  return isStoreRef(v) ? (v as string).slice(VARS_PREFIX.length) : null;
}

/** Write a value into `app.vars` at a dotted path ('heading1.text'), creating objects as needed.
 *  The write-through target when the ⚙ editor edits a promoted (store-bound) prop. */
export function setVarByPath(app: AppManifest, path: string, value: unknown): void {
  const parts = path.split('.');
  const last = parts.pop();
  if (!last) return;
  let obj = (app.vars ??= {}) as Record<string, unknown>;
  for (const k of parts) {
    if (obj[k] == null || typeof obj[k] !== 'object') obj[k] = {};
    obj = obj[k] as Record<string, unknown>;
  }
  obj[last] = value;
}
