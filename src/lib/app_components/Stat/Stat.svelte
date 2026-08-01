<script lang="ts">
  // Stat — a KPI stat TILE: a small uppercase label, a big formatted value (+ optional unit),
  // an optional delta line (▲/▼, green up / red down), an optional right-aligned icon, and an
  // optional min–max-normalised sparkline. Props live on panel.props (component model). A value
  // / delta of "$vars.x" / "$params.y" shows the live computed/param value; sparklineVar names a
  // vars array of numbers. SSR-safe: no onMount/window/document — Intl.NumberFormat only (fine
  // server-side), so the whole tile is in the first paint and curl'able.
  // BUNDLE component (app_components/Stat/) — render + meta.ts co-located. See src/lib/app_components/CLAUDE.md.
  import type { Panel } from '$lib/appkit/manifest/types';
  import { resolveRef } from '$lib/appkit/manifest/refs';

  let {
    panel,
    params,
    vars,
  }: { panel: Panel; params?: Record<string, unknown>; vars?: Record<string, unknown> } = $props();

  const p = $derived((panel.props ?? {}) as Record<string, unknown>);
  const scope = $derived({ params, vars });

  const label = $derived(String(resolveRef((p.label ?? panel.title) as string, scope) ?? ''));
  const icon = $derived(String(resolveRef(p.icon as string, scope) ?? ''));
  const unit = $derived(String(resolveRef(p.unit as string, scope) ?? ''));
  const accent = $derived(p.accent ? String(p.accent) : '');

  // Value — resolve a $vars/$params ref (or a literal), then format per props.format.
  const rawValue = $derived(resolveRef(p.value as unknown, scope));
  const format = $derived(String(p.format ?? 'plain'));
  const value = $derived(formatValue(rawValue, format));

  // Delta — a signed number or a var ref; direction from deltaDir ('auto' derives from the sign).
  const rawDelta = $derived(resolveRef(p.delta as unknown, scope));
  const hasDelta = $derived(rawDelta != null && String(rawDelta) !== '');
  const deltaNum = $derived(toNum(rawDelta));
  const deltaDir = $derived.by<'up' | 'down' | 'flat'>(() => {
    const d = String(p.deltaDir ?? 'auto');
    if (d === 'up' || d === 'down') return d;
    if (!Number.isFinite(deltaNum) || deltaNum === 0) return 'flat';
    return deltaNum > 0 ? 'up' : 'down';
  });
  const deltaArrow = $derived(deltaDir === 'up' ? '▲' : deltaDir === 'down' ? '▼' : '');
  const deltaText = $derived(String(rawDelta ?? ''));

  // Sparkline — sparklineVar names a vars array (or is itself a $vars ref) of numbers.
  const sparkNums = $derived.by<number[]>(() => {
    const key = p.sparklineVar;
    if (!key) return [];
    const arr =
      typeof key === 'string' && key[0] === '$'
        ? resolveRef(key, scope)
        : (vars?.[String(key)] as unknown);
    if (!Array.isArray(arr)) return [];
    return arr.map(toNum).filter((n) => Number.isFinite(n));
  });
  const SPARK_W = 96;
  const SPARK_H = 26;
  const sparkPoints = $derived.by(() => {
    const n = sparkNums;
    if (n.length < 2) return '';
    const pad = 2;
    const min = Math.min(...n);
    const max = Math.max(...n);
    const span = max - min || 1;
    return n
      .map((v, i) => {
        const x = (i / (n.length - 1)) * (SPARK_W - pad * 2) + pad;
        const y = SPARK_H - pad - ((v - min) / span) * (SPARK_H - pad * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  });

  function toNum(v: unknown): number {
    if (typeof v === 'number') return v;
    if (v == null) return NaN;
    return Number(String(v).replace(/[,%$\s]/g, ''));
  }

  function formatValue(v: unknown, fmt: string): string {
    if (v == null) return '';
    if (fmt === 'plain') return String(v);
    const n = toNum(v);
    if (!Number.isFinite(n)) return String(v); // not numeric → show as-is
    try {
      switch (fmt) {
        case 'currency':
          return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);
        case 'percent':
          return new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 }).format(n);
        case 'compact':
          return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
        case 'number':
          return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n);
        default:
          return String(v);
      }
    } catch {
      return String(v);
    }
  }
</script>

<div class="stat" style={accent ? `--accent:${accent}; border-top-color:${accent};` : ''} class:accented={!!accent}>
  <div class="stat-head">
    <span class="stat-label">{label}</span>
    {#if icon}<span class="stat-icon" aria-hidden="true">{icon}</span>{/if}
  </div>

  <div class="stat-value">
    <span class="stat-num">{value}</span>
    {#if unit}<span class="stat-unit">{unit}</span>{/if}
  </div>

  {#if hasDelta}
    <div class="stat-delta" data-dir={deltaDir}>
      {#if deltaArrow}<span class="stat-arrow">{deltaArrow}</span>{/if}<span class="stat-delta-val">{deltaText}</span>
    </div>
  {/if}

  {#if sparkPoints}
    <svg
      class="stat-spark"
      viewBox="0 0 {SPARK_W} {SPARK_H}"
      width={SPARK_W}
      height={SPARK_H}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${label} trend, ${sparkNums.length} points`}
    >
      <polyline points={sparkPoints} fill="none" stroke={accent || 'var(--h-accent, #0369a1)'} stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />
    </svg>
  {/if}
</div>

<style>
  .stat {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 12px 14px;
    border: 1px solid var(--h-border, #e5e7eb);
    border-top: 3px solid var(--h-border, #e5e7eb);
    border-radius: 8px;
    background: var(--h-surface, #fff);
    color: var(--h-text, #0f172a);
    font: 12px/1.4 system-ui, Arial, sans-serif;
    min-width: 0;
  }
  .stat-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
  .stat-label {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.4px;
    text-transform: uppercase;
    color: var(--h-muted, #64748b);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .stat-icon { flex: 0 0 auto; font-size: 16px; line-height: 1; opacity: 0.9; }
  .stat-value { display: flex; align-items: baseline; gap: 5px; }
  .stat-num {
    font-size: 28px;
    font-weight: 700;
    line-height: 1.1;
    letter-spacing: -0.5px;
  }
  .accented .stat-num { color: var(--accent); }
  .stat-unit { font-size: 12px; font-weight: 600; color: var(--h-muted, #64748b); }
  .stat-delta { display: inline-flex; align-items: center; gap: 3px; font-size: 12px; font-weight: 600; color: var(--h-muted, #64748b); }
  .stat-delta[data-dir='up'] { color: var(--h-pos, #16a34a); }
  .stat-delta[data-dir='down'] { color: var(--h-neg, #dc2626); }
  .stat-arrow { font-size: 10px; line-height: 1; }
  .stat-spark { display: block; margin-top: 2px; width: 96px; height: 26px; }
</style>
