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

function resolveRef(v: unknown, scope: RefScope): unknown {
  if (typeof v !== 'string' || v[0] !== '$') return v;
  if (v === '$active') return scope.active;
  if (v === '$params') return scope.params;
  if (v === '$item' || v.startsWith('$item.')) {
    const path = v.slice('$item'.length).replace(/^\./, '');
    if (!path) return scope.item;
    return path.split('.').reduce<any>((o, key) => (o == null ? undefined : o[key]), scope.item);
  }
  return v; // unknown $ref — leave as-is
}
