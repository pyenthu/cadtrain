// src/lib/appkit/manifest/refs.ts — resolve $active / $item / $params refs in a
// binding's args against the harness runtime scope. Keeps the .app declarative:
// a control says {verb:'loadDoc', args:{id:'$item.id'}} and the harness fills it in.

export interface RefScope {
  /** The currently-selected document id. */
  active?: string;
  /** The row/item in scope (e.g. a list selection). */
  item?: unknown;
  /** The bound doc's live params. */
  params?: Record<string, unknown>;
  /** Computed variables (the declarative `computed` block). */
  vars?: Record<string, unknown>;
}

export function resolveArgs(
  args: Record<string, unknown> | undefined,
  scope: RefScope,
): Record<string, unknown> {
  if (!args) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) out[k] = resolveRef(v, scope);
  return out;
}

/** Walk a dotted path from a root; undefined-safe. Empty path → the root itself. */
function walk(root: unknown, path: string): unknown {
  if (!path) return root;
  return path.split('.').reduce<any>((o, key) => (o == null ? undefined : o[key]), root);
}

/** Resolve a single value: a `$active/$item/$params/$vars[.path]` ref, else itself.
 *  Exported so components can resolve `$vars.x` in their props/text. */
export function resolveRef(v: unknown, scope: RefScope): unknown {
  if (typeof v !== 'string' || v[0] !== '$') return v;
  if (v === '$active') return scope.active;
  if (v === '$params') return scope.params;
  if (v === '$item' || v.startsWith('$item.')) return walk(scope.item, v.slice('$item'.length).replace(/^\./, ''));
  if (v === '$vars' || v.startsWith('$vars.')) return walk(scope.vars, v.slice('$vars'.length).replace(/^\./, ''));
  return v; // unknown $ref — leave as-is
}
