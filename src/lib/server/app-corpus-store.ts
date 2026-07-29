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

/** The active store — volume by default; local when CADTRAIN_APP_CORPUS is set. */
export function getCorpusStore(): AppCorpusStore {
  const local = env.CADTRAIN_APP_CORPUS;
  return local ? createLocalCorpusStore(local) : createVolumeCorpusStore();
}
