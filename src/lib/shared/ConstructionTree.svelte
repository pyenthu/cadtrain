<script lang="ts">
  /**
   * ConstructionTree — read-first visualization of a composite's CSG
   * composition (construction-tree.md, Slice 0 companion to warp-at-end).
   *
   * Renders the LEFT-ASSOCIATIVE operand chain (`L.subtract(h1).subtract(h2)`)
   * two ways:
   *   1. A BODMAS bracketed expression — `((L − h1) − h2)` — because CSG
   *      subtract/intersect are order-SENSITIVE, so the bracketing IS the
   *      evaluation order (BODMAS).
   *   2. A post-order tree (op nodes + leaf parts + transform badges), with the
   *      warp-at-end wrap as the ROOT transform node when present.
   *
   * Pure view over `recognizeComposite` output — no source mutation, no format
   * change. The drag/reparent EDITOR + JSON-tree refactor are construction-tree
   * P1–P4 (future).
   */
  interface Props {
    recognized: any;
    /** Part instances (recognized.instances ∩ meta.uses), each with .transforms. */
    parts: any[];
    /** Optional: highlight + scroll to a part when an op/leaf is clicked. */
    onPick?: (name: string) => void;
  }
  let { recognized, parts, onPick }: Props = $props();

  const GLYPH: Record<string, string> = { add: '∪', union: '∪', subtract: '−', intersect: '∩' };
  const OPLBL: Record<string, string> = { add: 'union', union: 'union', subtract: 'subtract', intersect: 'intersect' };
  function glyph(op: string | null) { return (op && GLYPH[op]) || op || '?'; }

  type TNode =
    | { kind: 'leaf'; name: string; call: string; txs: any[] }
    | { kind: 'csg'; op: string; left: TNode; right: TNode }
    | { kind: 'warp'; child: TNode };

  let partByName = $derived(new Map((parts ?? []).map((p: any) => [p.name, p])));
  function leafOf(name: string | null): TNode {
    const p = name ? partByName.get(name) : null;
    return { kind: 'leaf', name: name ?? '?', call: p?.call ?? '', txs: (p?.transforms ?? p?.txs ?? []) };
  }

  // Fold the operand chain into a left-deep binary tree; wrap in warp if warped.
  let tree = $derived.by<TNode | null>(() => {
    const ops = (recognized?.operands ?? []) as any[];
    if (ops.length === 0) return null;
    let node: TNode = leafOf(ops[0]?.name);
    for (let i = 1; i < ops.length; i++) {
      node = { kind: 'csg', op: ops[i].op ?? '?', left: node, right: leafOf(ops[i].name) };
    }
    if ((recognized?.warpInnerStart ?? -1) >= 0) node = { kind: 'warp', child: node };
    return node;
  });

  function expr(n: TNode): string {
    if (n.kind === 'leaf') return n.name;
    if (n.kind === 'warp') return `⟿(${expr(n.child)})`;
    return `(${expr(n.left)} ${glyph(n.op)} ${expr(n.right)})`;
  }
  let bodmas = $derived(tree ? expr(tree) : '');
  let opCount = $derived((recognized?.operands ?? []).length);
</script>

{#if tree && opCount >= 1}
  <div class="ct-wrap">
    <div class="ct-bodmas" title="CSG subtract/intersect are order-sensitive — brackets show the evaluation order (BODMAS).">
      <span class="ct-tag">BODMAS</span>
      <code>{bodmas}</code>
    </div>
    <div class="ct-tree">
      {@render treeNode(tree)}
    </div>
    <div class="ct-note"><span class="ct-k">∪</span> union · <span class="ct-k">−</span> subtract · <span class="ct-k">∩</span> intersect · <span class="ct-k">⟿</span> warp — evaluated bottom-up (post-order).</div>
  </div>
{/if}

{#snippet treeNode(n: TNode)}
  {#if n.kind === 'leaf'}
    <div class="ct-node ct-leaf" role="button" tabindex="0"
      onclick={() => onPick?.(n.name)}
      onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick?.(n.name); } }}>
      <span class="ct-glyph ct-leafglyph">●</span>
      <span class="ct-name">{n.name}</span>
      {#if n.call}<span class="ct-call">:{n.call}</span>{/if}
      {#each n.txs as t}<span class="ct-tx" title="{t.op}({t.argsText})">{t.op === 'mv' ? '↔' : t.op === 'rot' ? '⟳' : t.op}</span>{/each}
    </div>
  {:else if n.kind === 'warp'}
    <div class="ct-node ct-op ct-warp"><span class="ct-glyph">⟿</span><span class="ct-oplbl">warp at end</span></div>
    <div class="ct-children">{@render treeNode(n.child)}</div>
  {:else}
    <div class="ct-node ct-op"><span class="ct-glyph">{glyph(n.op)}</span><span class="ct-oplbl">{OPLBL[n.op] ?? n.op}</span></div>
    <div class="ct-children">
      {@render treeNode(n.left)}
      {@render treeNode(n.right)}
    </div>
  {/if}
{/snippet}

<style>
  .ct-wrap { margin-top: 6px; border: 1px solid #e2e2ea; border-radius: 6px; background: #fafafe; padding: 8px; }
  .ct-bodmas { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; margin-bottom: 6px; }
  .ct-bodmas code { font: 12px ui-monospace, monospace; color: #333; word-break: break-word; }
  .ct-tag { font: 700 9px Arial; letter-spacing: 0.06em; color: #fff; background: #6a5acd; padding: 1px 6px; border-radius: 8px; }
  .ct-tree { font: 11px Arial; }
  .ct-children { margin-left: 14px; border-left: 1px solid #d4d4e0; padding-left: 10px; }
  .ct-node { display: flex; align-items: center; gap: 6px; padding: 2px 0; }
  .ct-glyph { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 4px; font: 700 12px Arial; flex: 0 0 auto; }
  .ct-op .ct-glyph { background: #eceaf8; color: #5a48b8; }
  .ct-warp .ct-glyph { background: #fde8d4; color: #b5651d; }
  .ct-leafglyph { background: transparent; color: #cc2222; font-size: 9px; }
  .ct-oplbl { font: 600 10px Arial; color: #777; text-transform: uppercase; letter-spacing: 0.04em; }
  .ct-leaf { cursor: pointer; border-radius: 4px; }
  .ct-leaf:hover { background: #eef3fb; }
  .ct-name { font: 600 11px ui-monospace, monospace; color: #222; }
  .ct-call { font: 10px ui-monospace, monospace; color: #2266cc; }
  .ct-tx { font: 10px Arial; color: #888; background: #f0f0f5; border-radius: 3px; padding: 0 4px; margin-left: 2px; }
  .ct-note { margin-top: 6px; font: 10px Arial; color: #999; }
  .ct-k { font-weight: 700; color: #6a5acd; }
</style>
