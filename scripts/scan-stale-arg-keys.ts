// scan-stale-arg-keys.ts — find Call nodes whose arg keys no longer match the
// called dep's meta.params (stale/renamed keys, e.g. the g_tube `len` vs
// `length` bug). Such keys are SILENTLY swallowed by the object-default-merge
// in primitive-loader.ts and fall the real param back to its default with no
// error, so they don't surface until geometry "stops responding" to a param.
//
// Reads via the running dev server (proxied to the prod volume). SEQUENTIAL +
// dep-param cached on purpose — a parallel sweep of /source floods the proxy
// and wedges the server (the source_404_flood failure mode).
//
//   bun scripts/scan-stale-arg-keys.ts            # against :3333
//   SCAN_BASE=http://localhost:4720 bun scripts/scan-stale-arg-keys.ts

const BASE = process.env.SCAN_BASE ?? 'http://localhost:3333';

async function getJson(path: string): Promise<any> {
  const r = await fetch(`${BASE}${path}`);
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json();
}

function collectIds(o: any, acc: Set<string>): void {
  if (Array.isArray(o)) { for (const x of o) collectIds(x, acc); return; }
  if (o && typeof o === 'object') {
    for (const [k, v] of Object.entries(o)) {
      if ((k === 'id' || k === 'name') && typeof v === 'string') acc.add(v);
      collectIds(v, acc);
    }
  }
}

// dep id → its meta.params keys (null = no params / unresolvable → can't judge)
const paramCache = new Map<string, string[] | null>();
async function depParams(id: string): Promise<string[] | null> {
  if (paramCache.has(id)) return paramCache.get(id)!;
  let keys: string[] | null = null;
  try {
    const d = await getJson(`/api/primitives/source?name=${encodeURIComponent(id)}`);
    const p = d?.params ?? d?.meta?.params ?? null;
    keys = p && typeof p === 'object' ? Object.keys(p) : null;
  } catch { keys = null; }
  paramCache.set(id, keys);
  return keys;
}

const list = await getJson('/api/primitives/list');
const idSet = new Set<string>();
collectIds(list, idSet);
const partIds = [...idSet].sort();
console.log(`scanning ${partIds.length} ids via ${BASE} (sequential)…`);

const findings: string[] = [];
let scanned = 0;
for (const pid of partIds) {
  let d: any;
  try { d = await getJson(`/api/primitives/source?name=${encodeURIComponent(pid)}`); }
  catch { continue; }
  scanned++;
  const graph = d?.graph;
  if (!graph?.nodes || typeof graph.nodes !== 'object') continue;
  for (const node of Object.values<any>(graph.nodes)) {
    if (node?.type !== 'call' || !node.src || !node.args || typeof node.args !== 'object') continue;
    const argKeys = Object.keys(node.args);
    const depKeys = await depParams(node.src);
    if (!depKeys) continue; // dep params unknown — can't judge
    const stale = argKeys.filter((k) => !depKeys.includes(k));
    if (stale.length) {
      findings.push(
        `${pid} · ${node.alias ?? node.id} → ${node.src}: stale [${stale.join(', ')}]   (${node.src} meta.params: [${depKeys.join(', ')}])`,
      );
    }
  }
}

console.log(`\nscanned ${scanned} parts · ${paramCache.size} deps resolved`);
console.log(`=== ${findings.length} stale-arg-key finding(s) ===`);
if (!findings.length) console.log('  (none — every Call arg key matches its dep meta.params)');
for (const f of findings) console.log('  • ' + f);
