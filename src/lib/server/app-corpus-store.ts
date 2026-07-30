// src/lib/server/app-corpus-store.ts — the app-design RAG STORE (§1). Two layers:
//   builds.jsonl            — the raw LOG (every build; review + spot good ones)
//   golden/<name>.{md,app}  — the CURATED pairs = the retrieval DB (MD = key, .app = target)
//
// VOLUME-backed by DEFAULT: <volume>/ai/app-rag/ — prod-shared, exactly like the parts
// corpus at ai/rag/parts.jsonl (Rule 13). So the corpus lives in production, is SHARED
// across users, and evolves as people build ("constantly evolving with the learning").
// The src drive isn't reachable in prod, so this is the home.
//
// Pluggable: set CADTRAIN_APP_CORPUS to a LOCAL dir for an air-gapped / offline corpus.
import { appendFile, readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { env } from '$env/dynamic/private';
import { volumePath } from './volume';

export interface BuildRecord {
  ts: number;
  prompt: string;
  steps: number;
  /** A compact summary of what was built — enough to few-shot future builds. */
  app: { app: string; panels: Array<{ id: string; kind: string; source?: unknown }> };
  /** The ordered verb calls the model emitted (verb + args + outcome). Optional (older
   *  records lack it). Drives debugging + the refine loop — "which verb turned it red". */
  trace?: Array<{ verb: string; args: unknown; ok: boolean; error?: string }>;
  /** The RAW model output the verbs were parsed from (CLI path). Optional. The one thing that
   *  survives a parse failure — when trace is empty, this shows exactly what the model said. */
  raw?: string;
}

/** A curated (description, structure) example — the MD is the retrieval key. */
export interface GoldenPair {
  name: string;
  md: string;
  app: unknown;
}

export interface AppCorpusStore {
  /** Human label for where this store lives (logging / UI). */
  describe(): string;
  appendBuild(rec: BuildRecord): Promise<void>;
  loadBuilds(): Promise<BuildRecord[]>;
  saveGolden(name: string, md: string, app: unknown): Promise<void>;
  loadGolden(): Promise<GoldenPair[]>;
}

function parseJsonl<T>(raw: string): T[] {
  return raw
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l) as T;
      } catch {
        return null;
      }
    })
    .filter(Boolean) as T[];
}

/** One fs-backed store, parameterized by a base directory (volume path or local dir). */
export function fsCorpusStore(baseDir: string, label: string): AppCorpusStore {
  const buildsPath = join(baseDir, 'builds.jsonl');
  const goldenDir = join(baseDir, 'golden');
  return {
    describe: () => label,

    async appendBuild(rec) {
      // Best-effort — a corpus write must NEVER fail the build.
      try {
        await mkdir(baseDir, { recursive: true });
        await appendFile(buildsPath, `${JSON.stringify(rec)}\n`, 'utf8');
      } catch {
        /* ignore */
      }
    },

    async loadBuilds() {
      try {
        return parseJsonl<BuildRecord>(await readFile(buildsPath, 'utf8'));
      } catch {
        return [];
      }
    },

    async saveGolden(name, md, app) {
      const safe = String(name).replace(/[^a-z0-9_-]+/gi, '_') || 'unnamed';
      await mkdir(goldenDir, { recursive: true });
      // Atomic-ish: write .app first, then .md (the key), so a half-write never
      // surfaces a keyed pair with no target.
      await writeFile(join(goldenDir, `${safe}.app`), `${JSON.stringify(app, null, 2)}\n`, 'utf8');
      await writeFile(join(goldenDir, `${safe}.md`), md, 'utf8');
    },

    async loadGolden() {
      let names: string[];
      try {
        names = (await readdir(goldenDir)).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3));
      } catch {
        return [];
      }
      const out: GoldenPair[] = [];
      for (const n of names) {
        try {
          const md = await readFile(join(goldenDir, `${n}.md`), 'utf8');
          const app = JSON.parse(await readFile(join(goldenDir, `${n}.app`), 'utf8'));
          out.push({ name: n, md, app });
        } catch {
          /* skip a broken/half-written pair */
        }
      }
      return out;
    },
  };
}

/** DEFAULT: the shared volume at <volume>/ai/app-rag/ (prod + local mirror). */
export function createVolumeCorpusStore(): AppCorpusStore {
  return fsCorpusStore(volumePath('ai/app-rag'), 'volume:ai/app-rag');
}

/** OPTIONAL: an air-gapped local corpus dir. */
export function createLocalCorpusStore(dir: string): AppCorpusStore {
  return fsCorpusStore(resolve(dir), `local:${dir}`);
}

/** REMOTE: talk to the SHARED prod volume over HTTP (dev → prod), so `captureBuild` +
 *  grounding land in ONE corpus visible in /volume — instead of each dev's local .dev-volume.
 *  Mirrors the volume proxy: `${REMOTE}/api/volume?path=ai/app-rag/…` with x-volume-token.
 *  On prod itself CADTRAIN_VOLUME_REMOTE_URL is unset → the fs store (mounted volume) is used,
 *  so the atomic appendFile path runs there; the read-modify-write append here is dev-only
 *  (single user → no race). All reads/writes are best-effort — a corpus op must never throw. */
export function remoteCorpusStore(remoteBase: string, token: string): AppCorpusStore {
  const base = remoteBase.replace(/\/$/, '');
  const url = (p: string) => `${base}/api/volume?path=${encodeURIComponent(`ai/app-rag/${p}`)}`;
  // `origin: base` spoofs same-origin so prod's SvelteKit CSRF guard allows PUT/DELETE (exactly
  // what maybeProxy does); x-volume-token only if configured (prod auth is token-OPTIONAL).
  const hdr = (extra: Record<string, string> = {}) => ({
    origin: base,
    ...(token ? { 'x-volume-token': token } : {}),
    ...extra,
  });

  async function getText(p: string): Promise<string | null> {
    try {
      const r = await fetch(url(p), { headers: hdr() });
      return r.ok ? await r.text() : null; // 404 (missing file) → null
    } catch {
      return null;
    }
  }
  async function putText(p: string, body: string, ct: string): Promise<void> {
    try {
      await fetch(url(p), { method: 'PUT', headers: hdr({ 'content-type': ct }), body });
    } catch {
      /* ignore */
    }
  }

  return {
    describe: () => `remote:${base}/ai/app-rag`,

    async appendBuild(rec) {
      const cur = await getText('builds.jsonl'); // read-modify-write (dev, single-user)
      const prefix = cur ? (cur.endsWith('\n') ? cur : `${cur}\n`) : '';
      await putText('builds.jsonl', `${prefix}${JSON.stringify(rec)}\n`, 'text/plain');
    },

    async loadBuilds() {
      const t = await getText('builds.jsonl');
      return t ? parseJsonl<BuildRecord>(t) : [];
    },

    async saveGolden(name, md, app) {
      const safe = String(name).replace(/[^a-z0-9_-]+/gi, '_') || 'unnamed';
      await putText(`golden/${safe}.app`, `${JSON.stringify(app, null, 2)}\n`, 'application/json');
      await putText(`golden/${safe}.md`, md, 'text/markdown');
    },

    async loadGolden() {
      let node: { children?: Record<string, unknown> } | null = null;
      try {
        const r = await fetch(url('golden'), { headers: hdr() });
        node = r.ok ? await r.json() : null; // dir listing (DirNode) or 404 → null
      } catch {
        return [];
      }
      const names = Object.keys(node?.children ?? {})
        .filter((f) => f.endsWith('.md'))
        .map((f) => f.slice(0, -3));
      const out: GoldenPair[] = [];
      for (const n of names) {
        const md = await getText(`golden/${n}.md`);
        const appTxt = await getText(`golden/${n}.app`);
        if (md == null || appTxt == null) continue;
        try {
          out.push({ name: n, md, app: JSON.parse(appTxt) });
        } catch {
          /* skip a broken pair */
        }
      }
      return out;
    },
  };
}

/** The active store: an explicit LOCAL dir wins; else the shared prod volume over HTTP when a
 *  remote is configured (dev → prod, one shared corpus); else the local fs volume (prod). */
export function getCorpusStore(): AppCorpusStore {
  const local = env.CADTRAIN_APP_CORPUS;
  if (local) return createLocalCorpusStore(local);
  const remote = env.CADTRAIN_VOLUME_REMOTE_URL;
  if (remote) return remoteCorpusStore(remote, env.CADTRAIN_VOLUME_TOKEN ?? '');
  return createVolumeCorpusStore();
}
