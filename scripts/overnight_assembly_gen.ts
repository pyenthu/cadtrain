#!/usr/bin/env bun
// Overnight assembly generator + autonomous self-correction loop.
//
// Goal: end the night with 40 NEW library parts (JSON recipes) in
// library/test/, covering:
//
//   - 10 simple (1–2 instances of bundle primitives)
//   - 10 medium (3–5 instances, with subtract / intersect ops)
//   - 10 assemblies of primitives (compose other primitives)
//   - 10 assemblies of assemblies (compose other generated parts —
//     proves the recursive dep-resolution path)
//
// For each candidate:
//   1. Emit the recipe JSON.
//   2. POST /api/components/save with create:true.
//   3. If save fails: try to self-correct (most common failures are
//      arg-name mismatches, expression typos, missing deps). Apply
//      heuristic fixes, retry up to N times. Log every attempt.
//   4. POST /api/components/geom to confirm the bake produces actual
//      vertex data (positions > 0).
//   5. Append a row to the report.
//
// Output: <volume>/test-recordings/overnight-2026-05-18/report.json
// Exit 0 when target=40 reached; exit 1 if more than 25% of attempts
// failed past the correction cap.
//
// Run as:  bun run scripts/overnight_assembly_gen.ts
// Set OVERNIGHT_BASE to override the dev URL (default http://localhost:3334).

import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';

const BASE = process.env.OVERNIGHT_BASE ?? 'http://localhost:3334';
const TARGET = Number(process.env.OVERNIGHT_TARGET ?? 40);
const MAX_RETRIES = 3;
const OUT_DIR = `./test-recordings/overnight-${new Date().toISOString().slice(0, 10)}`;

interface AttemptLog {
  candidate: string;
  attempt: number;
  step: 'save' | 'render';
  ok: boolean;
  error?: string;
  positions?: number;
  bakeBytes?: number;
}

interface FinalLog {
  id: string;
  name: string;
  category: 'simple' | 'medium' | 'primitives_assembly' | 'assemblies_assembly';
  attempts: AttemptLog[];
  outcome: 'success' | 'failed' | 'skipped';
  finalPositions?: number;
  finalBakeBytes?: number;
  recipe: any;
}

const results: FinalLog[] = [];
const savedParts: string[] = []; // ids that succeeded — assembly_of_assemblies pool

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

// ── Recipe building blocks ───────────────────────────────────────────────────

type Arg = { lit: number } | { expr: string };
const lit = (n: number): Arg => ({ lit: n });
const expr = (s: string): Arg => ({ expr: s });

interface RecipeInstance {
  name: string;
  call: string;
  args: Record<string, Arg>;
  transforms?: { op: string; args: Arg[] }[];
}

interface Recipe {
  meta: any;
  instances: RecipeInstance[];
  composition: { op: 'add' | 'subtract' | 'intersect'; of: string }[];
}

const baseHelperParams = (call: string): Record<string, Arg> => {
  // Default arg shape per bundle primitive. Used as a starting point
  // when composing them in; the candidate generators tweak from here.
  if (call === 'hollow_cylinder') return {
    od:     lit(4.5),
    wall:   lit(0.4),
    length: lit(3),
    top:    lit(0),
  };
  if (call === 'tapered_cone') return {
    od:     lit(4.5),
    odTop:  lit(3.0), // tapered_cone needs BOTH od (bottom) and odTop (top)
    wall:   lit(0.3),
    length: lit(2),
    top:    lit(0),
  };
  if (call === 'cyl') return { length: lit(2), r1: lit(1), r2: lit(1) };
  if (call === 'tube') return { outerR: lit(1.5), innerR: lit(1.2), length: lit(2) };
  return {};
};

const BUNDLE_PRIMS = ['hollow_cylinder', 'tapered_cone'];

/** Per-primitive arg shape for the recipe generator. tapered_cone
 *  needs an extra `odTop` arg that hollow_cylinder doesn't. */
function primArgs(call: string, len: string, od: string, wall: string): Record<string, Arg> {
  if (call === 'tapered_cone') {
    return {
      od:     expr(od),
      odTop:  expr(`${od} * 0.7`),
      wall:   expr(wall),
      length: expr(len),
      top:    lit(0),
    };
  }
  return {
    od:     expr(od),
    wall:   expr(wall),
    length: expr(len),
    top:    lit(0),
  };
}
const PARAMS_TEMPLATE = {
  len:  { label: 'Length', min: 1, max: 30, step: 0.5, default: 6, unit: 'in' },
  od:   { label: 'OD',     min: 0.5, max: 12, step: 0.125, default: 4.5, unit: 'in' },
  wall: { label: 'Wall',   min: 0.05, max: 2, step: 0.05, default: 0.4, unit: 'in' },
  scale:{ label: 'Scale',  min: 0.5, max: 3,  step: 0.05, default: 1.2 },
};

function paramSubset(keys: (keyof typeof PARAMS_TEMPLATE)[]) {
  const out: any = {};
  for (const k of keys) out[k] = PARAMS_TEMPLATE[k];
  return out;
}

// ── Candidate generators (one per category) ──────────────────────────────────

function makeSimple(i: number): Recipe {
  // 1-2 instance variations.
  const pick = BUNDLE_PRIMS[i % BUNDLE_PRIMS.length];
  const id = `overnight_simple_${String(i).padStart(2, '0')}`;
  const twoInstance = i % 2 === 1;
  const instances: RecipeInstance[] = [
    {
      name: 'A',
      call: pick,
      args: primArgs(pick, 'p.len', 'p.od', 'p.wall'),
    },
  ];
  if (twoInstance) {
    const second: RecipeInstance = {
      name: 'B',
      call: pick,
      args: primArgs(pick, 'p.len / 3', 'p.od * 1.4', 'p.wall'),
    };
    second.args.top = expr('A.top + A.length');
    instances.push(second);
  }
  return {
    meta: {
      id, name: `Overnight Simple ${i}`, family: 'basic',
      tags: ['generated', 'overnight'],
      params: paramSubset(['len', 'od', 'wall']),
    },
    instances,
    composition: instances.map((x) => ({ op: 'add' as const, of: x.name })),
  };
}

function makeMedium(i: number): Recipe {
  const id = `overnight_medium_${String(i).padStart(2, '0')}`;
  // 3-5 instances; mix of add / subtract / intersect.
  const n = 3 + (i % 3); // 3, 4, or 5
  const instances: RecipeInstance[] = [];
  for (let k = 0; k < n; k++) {
    const name = String.fromCharCode(65 + k); // A, B, C…
    const prev = k > 0 ? String.fromCharCode(64 + k) : null;
    const callPick = BUNDLE_PRIMS[k % BUNDLE_PRIMS.length];
    const args = primArgs(
      callPick,
      `p.len / ${n}`,
      `p.od * ${(1 - k * 0.1).toFixed(2)}`,
      'p.wall',
    );
    args.top = prev ? expr(`${prev}.top + ${prev}.length`) : lit(0);
    instances.push({ name, call: callPick, args });
  }
  // Composition: A added, then alternate add/subtract on the rest.
  const composition = instances.map((inst, idx): { op: 'add' | 'subtract' | 'intersect'; of: string } => ({
    op: idx === 0 ? 'add' : idx % 2 === 1 ? 'subtract' : 'add',
    of: inst.name,
  }));
  return {
    meta: {
      id, name: `Overnight Medium ${i}`, family: 'basic',
      tags: ['generated', 'overnight'],
      params: paramSubset(['len', 'od', 'wall']),
    },
    instances,
    composition,
  };
}

function makePrimitivesAssembly(i: number): Recipe {
  // Composes both bundle primitives (hollow_cylinder + tapered_cone).
  const id = `overnight_assembly_${String(i).padStart(2, '0')}`;
  const aArgs = primArgs('hollow_cylinder', 'p.len', 'p.od', 'p.wall');
  const bArgs = primArgs('tapered_cone', 'p.len / 4', 'p.od * 1.5', 'p.wall');
  bArgs.top = expr('A.top + A.length');
  const cArgs = primArgs('hollow_cylinder', 'p.len / 6', 'p.od * 1.6', 'p.wall * 1.5');
  cArgs.top = expr('B.top + B.length');
  const instances: RecipeInstance[] = [
    { name: 'A', call: 'hollow_cylinder', args: aArgs },
    { name: 'B', call: 'tapered_cone',    args: bArgs },
    { name: 'C', call: 'hollow_cylinder', args: cArgs },
  ];
  return {
    meta: {
      id, name: `Overnight Assembly ${i}`, family: 'drillstring',
      tags: ['generated', 'overnight', 'assembly'],
      params: paramSubset(['len', 'od', 'wall']),
    },
    instances,
    composition: instances.map((inst) => ({ op: 'add' as const, of: inst.name })),
  };
}

function makeAssemblyOfAssemblies(i: number, pool: string[]): Recipe | null {
  // Reuses 1-2 already-saved overnight parts as deps. Requires pool ≥ 1.
  // Both instances are added at the origin — they overlap. The point
  // of this category is to PROVE the recursive dep-resolution path
  // (load a saved JSON-recipe part as a dep inside another recipe),
  // not to produce visually-distinct geometry. The interpreter's
  // transform path with vec3 args is a Phase 2c follow-up.
  if (pool.length === 0) return null;
  const id = `overnight_meta_${String(i).padStart(2, '0')}`;
  const depA = pool[i % pool.length];
  const depB = pool[(i + 1) % pool.length];
  const sameDep = depA === depB;
  const instances: RecipeInstance[] = [
    {
      name: 'A',
      call: depA,
      args: {
        len: expr('p.len'),
        od: expr('p.od'),
        wall: expr('p.wall'),
      },
    },
  ];
  if (!sameDep) {
    instances.push({
      name: 'B',
      call: depB,
      args: {
        len: expr('p.len * p.scale'),
        od: expr('p.od * 1.2'),
        wall: expr('p.wall'),
      },
    });
  }
  return {
    meta: {
      id, name: `Overnight Meta ${i}`, family: 'assemblies',
      tags: ['generated', 'overnight', 'meta-assembly'],
      params: paramSubset(['len', 'od', 'wall', 'scale']),
    },
    instances,
    composition: instances.map((inst) => ({ op: 'add' as const, of: inst.name })),
  };
}

// ── Save + render + correct ──────────────────────────────────────────────────

async function save(recipe: Recipe): Promise<{ ok: boolean; error?: string; bytes?: number }> {
  try {
    const r = await fetch(`${BASE}/api/components/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: recipe.meta.id, create: true, recipe }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: body?.message ?? `HTTP ${r.status}` };
    return { ok: true, bytes: body?.glb?.bytes };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

async function render(id: string, defaults: Record<string, number>): Promise<{ ok: boolean; positions?: number; error?: string }> {
  try {
    const r = await fetch(`${BASE}/api/components/geom`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, params: defaults }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: body?.message ?? `HTTP ${r.status}` };
    const positions = body?.full?.positions?.length ?? 0;
    return { ok: true, positions };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

// Heuristic auto-corrector. Inspects an error string and tries the
// most likely fix.  Returns the corrected recipe or null if no fix
// applied. Future iteration: ask Claude for a fix instead of regex.
function selfCorrect(recipe: Recipe, error: string): Recipe | null {
  // 1. "Unknown call" — referenced dep doesn't exist. Drop the
  //    instance and its composition entry.
  const unknownCall = /Unknown call "([^"]+)"/.exec(error);
  if (unknownCall) {
    const bad = unknownCall[1];
    const insts = recipe.instances.filter((i) => i.call !== bad);
    const comp = recipe.composition.filter((c) => insts.find((i) => i.name === c.of));
    if (insts.length === 0) return null;
    return { ...recipe, instances: insts, composition: comp };
  }
  // 2. "Unknown param" — expression refs a param not in meta. Replace
  //    the offending instance arg with a literal default.
  const unknownParam = /Unknown param "p\.(\w+)"/.exec(error);
  if (unknownParam) {
    const param = unknownParam[1];
    const insts = recipe.instances.map((inst) => {
      const args = { ...inst.args };
      for (const [k, v] of Object.entries(args)) {
        if ('expr' in v && v.expr.includes(`p.${param}`)) args[k] = lit(1);
      }
      return { ...inst, args };
    });
    return { ...recipe, instances: insts };
  }
  // 3. "Unknown instance" — cross-instance ref to undeclared inst.
  //    Drop the offending arg or replace with literal.
  const unknownInst = /Unknown instance "([A-Z][A-Z0-9]*)"/.exec(error);
  if (unknownInst) {
    const bad = unknownInst[1];
    const insts = recipe.instances.map((inst) => {
      const args = { ...inst.args };
      for (const [k, v] of Object.entries(args)) {
        if ('expr' in v && v.expr.includes(`${bad}.`)) args[k] = lit(0);
      }
      return { ...inst, args };
    });
    return { ...recipe, instances: insts };
  }
  // 4. Expression syntax errors — most are bracket / paren issues.
  //    Replace every expr arg with a literal default. Last resort.
  if (/Unexpected token|Unexpected end of expression|Unexpected character/.test(error)) {
    const insts = recipe.instances.map((inst) => {
      const args: Record<string, Arg> = {};
      for (const [k, v] of Object.entries(inst.args)) args[k] = lit(1);
      return { ...inst, args };
    });
    return { ...recipe, instances: insts };
  }
  return null;
}

async function processCandidate(
  category: FinalLog['category'],
  recipe: Recipe,
): Promise<FinalLog> {
  const log: FinalLog = {
    id: recipe.meta.id,
    name: recipe.meta.name,
    category,
    attempts: [],
    outcome: 'failed',
    recipe,
  };
  let cur = recipe;
  // Build a default-params bag for the render check.
  const defaults: Record<string, number> = {};
  for (const [k, v] of Object.entries(cur.meta.params as Record<string, any>)) defaults[k] = v.default;

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    const saveRes = await save(cur);
    log.attempts.push({
      candidate: cur.meta.id, attempt, step: 'save',
      ok: saveRes.ok, error: saveRes.error, bakeBytes: saveRes.bytes,
    });
    if (!saveRes.ok) {
      if (attempt > MAX_RETRIES) break;
      const fix = selfCorrect(cur, saveRes.error ?? '');
      if (!fix) break;
      cur = fix;
      log.recipe = cur;
      continue;
    }
    // Render check.
    const r = await render(cur.meta.id, defaults);
    log.attempts.push({
      candidate: cur.meta.id, attempt, step: 'render',
      ok: r.ok, error: r.error, positions: r.positions,
    });
    if (!r.ok || (r.positions ?? 0) === 0) {
      if (attempt > MAX_RETRIES) break;
      const fix = selfCorrect(cur, r.error ?? 'zero positions');
      if (!fix) break;
      cur = fix;
      log.recipe = cur;
      continue;
    }
    log.outcome = 'success';
    log.finalPositions = r.positions;
    log.finalBakeBytes = saveRes.bytes;
    return log;
  }
  return log;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  log(`Starting overnight generator. Target: ${TARGET} parts. Base: ${BASE}`);

  // Phase 1: simple (10)
  log('--- Phase 1: simple (1-2 instance) ---');
  for (let i = 0; i < 10; i++) {
    const r = await processCandidate('simple', makeSimple(i));
    results.push(r);
    if (r.outcome === 'success') savedParts.push(r.id);
    log(`  ${r.id}: ${r.outcome}${r.finalPositions ? ` (${r.finalPositions} pos)` : ''}`);
  }

  // Phase 2: medium (10)
  log('--- Phase 2: medium (3-5 instance, mixed ops) ---');
  for (let i = 0; i < 10; i++) {
    const r = await processCandidate('medium', makeMedium(i));
    results.push(r);
    if (r.outcome === 'success') savedParts.push(r.id);
    log(`  ${r.id}: ${r.outcome}${r.finalPositions ? ` (${r.finalPositions} pos)` : ''}`);
  }

  // Phase 3: assemblies of primitives (10)
  log('--- Phase 3: assemblies of primitives ---');
  for (let i = 0; i < 10; i++) {
    const r = await processCandidate('primitives_assembly', makePrimitivesAssembly(i));
    results.push(r);
    if (r.outcome === 'success') savedParts.push(r.id);
    log(`  ${r.id}: ${r.outcome}${r.finalPositions ? ` (${r.finalPositions} pos)` : ''}`);
  }

  // Phase 4: assemblies of assemblies (10). Requires phase 1-3 to have
  // produced some pool; if pool is empty, skip with a note.
  log('--- Phase 4: assemblies of assemblies ---');
  if (savedParts.length === 0) {
    log('  pool empty — skipping (no saved parts to compose).');
  } else {
    for (let i = 0; i < 10; i++) {
      const rec = makeAssemblyOfAssemblies(i, savedParts);
      if (!rec) continue;
      const r = await processCandidate('assemblies_assembly', rec);
      results.push(r);
      if (r.outcome === 'success') savedParts.push(r.id);
      log(`  ${r.id}: ${r.outcome}${r.finalPositions ? ` (${r.finalPositions} pos)` : ''}`);
    }
  }

  // Summary.
  const ok = results.filter((r) => r.outcome === 'success').length;
  const failed = results.filter((r) => r.outcome === 'failed').length;
  const skipped = results.filter((r) => r.outcome === 'skipped').length;
  log(`--- DONE. ok=${ok} failed=${failed} skipped=${skipped} ---`);
  const report = {
    startedAt: new Date().toISOString(),
    base: BASE,
    target: TARGET,
    ok, failed, skipped,
    totalAttempts: results.reduce((a, r) => a + r.attempts.length, 0),
    successes: results.filter((r) => r.outcome === 'success').map((r) => ({
      id: r.id, category: r.category, positions: r.finalPositions, bakeBytes: r.finalBakeBytes,
    })),
    failures: results.filter((r) => r.outcome === 'failed').map((r) => ({
      id: r.id, category: r.category,
      lastError: r.attempts[r.attempts.length - 1]?.error,
      attempts: r.attempts.length,
    })),
  };
  await writeFile(join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  await writeFile(join(OUT_DIR, 'attempts.json'), JSON.stringify(results, null, 2), 'utf8');
  log(`Report written to ${OUT_DIR}/report.json`);
  if (ok >= TARGET * 0.75) process.exit(0);
  log(`WARNING: only ${ok} of ${TARGET} succeeded.`);
  process.exit(1);
}

main().catch((e) => {
  log('FATAL:', e?.message ?? e);
  process.exit(2);
});
