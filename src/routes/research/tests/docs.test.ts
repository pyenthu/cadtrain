import { describe, it, expect } from 'vitest';
import {
  docs,
  categories,
  categoryAbstracts,
  bySlug,
  getDoc,
  sortByRecent,
  sortByPriority,
  sortByTitle,
  byRecent,
  byPriority,
  byTitle,
  CATEGORY_ORDER,
  type Doc,
} from '../docs';

/**
 * Guards the /research taxonomy: real doc corpus shape (category
 * classification, no stray markers, backfilled date/priority) plus the sort
 * helpers on synthetic data (so the ordering rules are pinned independent of
 * doc content drift).
 */
describe('docs corpus', () => {
  it('has at least one doc and no doc without a category', () => {
    expect(docs.length).toBeGreaterThan(0);
    for (const d of docs) {
      expect(d.category.length).toBeGreaterThan(0);
      expect(CATEGORY_ORDER as readonly string[]).toContain(d.category);
    }
  });

  it('skips archived-snapshot slugs', () => {
    expect(docs.some((d) => d.slug.includes('.archived-'))).toBe(false);
  });

  it('strips every leading research-* marker from the rendered body', () => {
    for (const d of docs) {
      expect(d.body).not.toMatch(/<!--\s*research-(group|date|priority):/i);
    }
  });

  it('every doc has a backfilled priority in [1,5] and a date or empty string', () => {
    for (const d of docs) {
      expect(d.priority).toBeGreaterThanOrEqual(1);
      expect(d.priority).toBeLessThanOrEqual(5);
      expect(typeof d.date).toBe('string');
      if (d.date) expect(d.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('categorizes known slugs into the requested taxonomy', () => {
    const cat = (slug: string) => bySlug.get(slug)?.category;
    expect(cat('trueform-webgpu')).toBe('Geometry kernels');
    expect(cat('sweep-self-intersection')).toBe('Geometry kernels');
    expect(cat('web-llm-functionary')).toBe('Local AI');
    expect(cat('local-fncall-synthetic-data')).toBe('Local AI');
    expect(cat('ne-flyde')).toBe('Graph interface');
    expect(cat('cement-annulus-detection')).toBe('Wells');
    expect(cat('svtc-wson-deep-dive')).toBe('Wells');
    expect(cat('graph-shared-overlap')).toBe('Architecture');
    expect(cat('findings')).toBe('Findings');
  });

  it('buckets docs marked `research-group: Archive` into Archive, regardless of slug', () => {
    const cat = (slug: string) => bySlug.get(slug)?.category;
    // The Archive marker is authoritative — checked before the slug regexes,
    // so these land in Archive even though their slugs would otherwise match
    // Local AI (`slm`), Graph interface (`svelteflow`), Wells (`wells`).
    expect(cat('webgpu-slm')).toBe('Archive');
    expect(cat('svelteflow-for-graph-editor')).toBe('Archive');
    expect(cat('wells-3d-empty-rootcause')).toBe('Archive');
    // Archive is present and last in the ordered category list.
    expect(categories).toContain('Archive');
    expect(categories[categories.length - 1]).toBe('Archive');
  });

  it('archived docs (brep-io, blender-wasm-webgpu) are no longer listed', () => {
    expect(bySlug.has('brep-io')).toBe(false);
    expect(bySlug.has('blender-wasm-webgpu')).toBe(false);
  });

  it('categories is the ordered, present-only subset of CATEGORY_ORDER', () => {
    for (const c of categories) expect(CATEGORY_ORDER as readonly string[]).toContain(c);
    const idx = categories.map((c) => CATEGORY_ORDER.indexOf(c as (typeof CATEGORY_ORDER)[number]));
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });

  it('every present category has a non-empty abstract', () => {
    for (const c of categories) {
      expect(categoryAbstracts[c]?.length ?? 0).toBeGreaterThan(20);
    }
  });

  it('getDoc looks up case-insensitively and returns undefined for a miss', () => {
    const first = docs[0];
    expect(getDoc(first.slug.toUpperCase())?.slug).toBe(first.slug);
    expect(getDoc('not-a-real-slug')).toBeUndefined();
    expect(getDoc(undefined)).toBeUndefined();
  });

  it('pre-sorted whole-corpus exports match their sort-fn outputs', () => {
    expect(byRecent.map((d) => d.slug)).toEqual(sortByRecent(docs).map((d) => d.slug));
    expect(byPriority.map((d) => d.slug)).toEqual(sortByPriority(docs).map((d) => d.slug));
    expect(byTitle.map((d) => d.slug)).toEqual(sortByTitle(docs).map((d) => d.slug));
  });
});

function fakeDoc(over: Partial<Doc>): Doc {
  return {
    slug: 'x', title: 'X', excerpt: '', body: '', group: 'Research', category: 'Architecture',
    date: '', priority: 3, ...over,
  };
}

describe('sort helpers (synthetic)', () => {
  const a = fakeDoc({ slug: 'a', title: 'Alpha', date: '2026-06-01', priority: 3 });
  const b = fakeDoc({ slug: 'b', title: 'Bravo', date: '2026-07-01', priority: 1 });
  const c = fakeDoc({ slug: 'c', title: 'Charlie', date: '', priority: 5 });

  it('sortByRecent — newest first, undated last', () => {
    expect(sortByRecent([a, b, c]).map((d) => d.slug)).toEqual(['b', 'a', 'c']);
  });

  it('sortByPriority — lowest N (highest priority) first', () => {
    expect(sortByPriority([a, b, c]).map((d) => d.slug)).toEqual(['b', 'a', 'c']);
  });

  it('sortByTitle — alphabetical', () => {
    expect(sortByTitle([c, a, b]).map((d) => d.slug)).toEqual(['a', 'b', 'c']);
  });

  it('sort helpers do not mutate the input array', () => {
    const list = [c, a, b];
    const snapshot = [...list];
    sortByRecent(list);
    sortByPriority(list);
    sortByTitle(list);
    expect(list).toEqual(snapshot);
  });

  it('sortByPriority ties break by recency then title', () => {
    const d1 = fakeDoc({ slug: 'd1', title: 'Zeta', date: '2026-01-01', priority: 2 });
    const d2 = fakeDoc({ slug: 'd2', title: 'Alpha', date: '2026-02-01', priority: 2 });
    expect(sortByPriority([d1, d2]).map((d) => d.slug)).toEqual(['d2', 'd1']);
  });
});
