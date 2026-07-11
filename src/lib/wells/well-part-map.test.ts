/**
 * well-part-map.test.ts — pins the PURE baked-part-id → WSON reverse maps
 * (`well-part-map.ts`): the #42h layer toggles + the #42b 3D-pick → inspector
 * cross-link. Exercised against a real `samples/*.wson` so the var-name ↔ source-
 * index contract is checked end-to-end through `inspectorElementsFromWson`.
 *
 * A compile-time assertion also ties `WellLayerKey` to the route's
 * `WellLayerFlags` so the two cannot drift. Headless.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  layerForPartId,
  parsePartId,
  inspectorElementForPartId,
  type WellLayerKey,
} from './well-part-map';
import { inspectorElementsFromWson } from './well-inspector';
import { parseWson, type Wson } from './wson';
import type { WellLayerFlags } from '../../routes/wells/view-settings';

const sample = (slug: string): Wson =>
  parseWson(readFileSync(resolve('src/lib/wells/samples', `${slug}.wson`), 'utf8')).wson;

// ── compile-time drift guard: WellLayerKey === keyof WellLayerFlags ─────────────
// Two-way assignability forces the union to exactly match the interface keys.
type _AssertKeysSubset = WellLayerKey extends keyof WellLayerFlags ? true : never;
type _AssertKeysSuperset = keyof WellLayerFlags extends WellLayerKey ? true : never;
const _k1: _AssertKeysSubset = true;
const _k2: _AssertKeysSuperset = true;
void _k1; void _k2;

describe('parsePartId', () => {
  it('parses an emit var name into kind + 0-based index', () => {
    expect(parsePartId('OH_1')).toEqual({ kind: 'openhole', index: 0 });
    expect(parsePartId('CEM_2')).toEqual({ kind: 'cement', index: 1 });
    expect(parsePartId('CSG_3')).toEqual({ kind: 'casing', index: 2 });
    expect(parsePartId('COMP_10')).toEqual({ kind: 'completion', index: 9 });
  });

  it('is case-insensitive on the prefix', () => {
    expect(parsePartId('csg_2')).toEqual({ kind: 'casing', index: 1 });
  });

  it('returns null for a bw_* registry id, a fallback id, or junk', () => {
    expect(parsePartId('bw_casing')).toBeNull();     // no instance index
    expect(parsePartId('part_0')).toBeNull();        // bakeWell fallback
    expect(parsePartId('PERF_1')).toBeNull();        // perfs are not emitted
    expect(parsePartId('OH_0')).toBeNull();          // var names are 1-based
    expect(parsePartId('')).toBeNull();
    expect(parsePartId(undefined)).toBeNull();
  });
});

describe('layerForPartId', () => {
  it('maps each emit var-name prefix to its layer', () => {
    expect(layerForPartId('OH_1')).toBe('showOpenHole');
    expect(layerForPartId('CEM_2')).toBe('showCement');
    expect(layerForPartId('CSG_3')).toBe('showCasing');
    expect(layerForPartId('COMP_5')).toBe('showCompletions');
  });

  it('maps a bw_* structural id to its layer (incl. tubing, unreachable by var name)', () => {
    expect(layerForPartId('bw_open_hole')).toBe('showOpenHole');
    expect(layerForPartId('bw_cement')).toBe('showCement');
    expect(layerForPartId('bw_casing')).toBe('showCasing');
    expect(layerForPartId('bw_prod_tubing')).toBe('showTubing');
  });

  it('sends every other bw_* jewelry part to the completions layer', () => {
    expect(layerForPartId('bw_packer')).toBe('showCompletions');
    expect(layerForPartId('bw_nipple')).toBe('showCompletions');
    expect(layerForPartId('bw_mule_shoe')).toBe('showCompletions');
  });

  it('resolves a bare prefix with no index (defensive)', () => {
    expect(layerForPartId('CSG')).toBe('showCasing');
  });

  it('returns null for an unrecognised id (caller shows rather than hides)', () => {
    expect(layerForPartId('part_0')).toBeNull();
    expect(layerForPartId('xyz_1')).toBeNull();
    expect(layerForPartId('')).toBeNull();
  });
});

describe('inspectorElementForPartId — 3D pick → inspector, against a real sample', () => {
  const wson = sample('05-esp-producer'); // 3 oh · 3 ch · 10 completions · 3 cement · 1 perf
  const els = inspectorElementsFromWson(wson);

  it('maps a casing var name to its source casing element', () => {
    const el = inspectorElementForPartId('CSG_2', els);
    expect(el).not.toBeNull();
    expect(el!.kind).toBe('casing');
    expect(el!.index).toBe(1);
    // ch[1] in the ESP sample is the 13.375" surface string.
    expect(el!.od).toBe(wson.ch![1].od);
    expect(el!.type).toBe('surface');
  });

  it('maps an open-hole var name to its source open-hole element', () => {
    const el = inspectorElementForPartId('OH_3', els);
    expect(el!.kind).toBe('openhole');
    expect(el!.index).toBe(2);
    expect(el!.bitSize).toBe(wson.oh![2].bitSize); // 12.25"
  });

  it('maps a completion var name to the right completion (1-based → 0-based)', () => {
    const el = inspectorElementForPartId('COMP_10', els);
    expect(el!.kind).toBe('completion');
    expect(el!.index).toBe(9);
    expect(el!.label).toBe('Perforated Pup (tail pipe)');
  });

  it('maps a cement var name to its source cement element', () => {
    const el = inspectorElementForPartId('CEM_1', els);
    expect(el!.kind).toBe('cement');
    expect(el!.index).toBe(0);
  });

  it('returns null for a bw_* id (no instance index) and out-of-range indices', () => {
    expect(inspectorElementForPartId('bw_casing', els)).toBeNull();
    expect(inspectorElementForPartId('CSG_99', els)).toBeNull();
    expect(inspectorElementForPartId('part_0', els)).toBeNull();
  });

  it('every emitted structural + completion part id round-trips to an element', () => {
    // Reconstruct the ids wson-to-graph would emit (OH_/CEM_/CSG_/COMP_, 1-based)
    // and assert each finds its element — the full 3D-pick surface.
    const ids: string[] = [
      ...(wson.oh ?? []).map((_, i) => `OH_${i + 1}`),
      ...(wson.cementing ?? []).map((_, i) => `CEM_${i + 1}`),
      ...(wson.ch ?? []).map((_, i) => `CSG_${i + 1}`),
      ...(wson.completions ?? []).map((_, i) => `COMP_${i + 1}`),
    ];
    for (const id of ids) {
      expect(inspectorElementForPartId(id, els), id).not.toBeNull();
    }
  });
});
