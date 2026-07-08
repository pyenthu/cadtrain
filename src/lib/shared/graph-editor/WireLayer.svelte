<script lang="ts">
  // WireLayer — dumb render component (modularize #940 CUT 1). Extracted
  // verbatim from GraphEditorPane's canvas <svg>. Renders ONLY the static
  // wire beziers (param→arg / count / coord / poly-ref / spline-ref +
  // method obj/arg + mv/rot/txfmn child + repeat/spline/container→output).
  // It READS state, never mutates the graph. Socket-position closures
  // (nodePos/outSock/inSock/slotIn) are passed in so wires follow a live
  // drag (they honour dragLive in the GEP shell). The in-flight drag wire
  // and the NodeCard loop stay in GraphEditorPane.
  import {
    bezier, paramSocketPos, nodeSize, exprOutputSockY, exprInputSockY,
    polySockR, polySockZ, polySockRef, sketchSockR, sketchSockZ, sketchSockVal,
    rootOutputSockY, extractParamRefs, WARP_PATH_CY, warpPathCY,
  } from './geom';
  import { exprBlockMember } from '$lib/cad/graph-exprs';

  let {
    allNodes, paramEntries, leftTab, graph,
    nodePos, outSock, inSock, slotIn,
    cardObstacles, pan, zoom, PARAM_W, CARD_Y0, consumedSet,
  }: {
    allNodes: any[];
    paramEntries: [string, any][];
    leftTab: string;
    graph: any;
    nodePos: (id: string) => { x: number; y: number };
    outSock: (id: string) => { x: number; y: number };
    inSock: (id: string, slot: 'obj' | 'arg' | 'child') => { x: number; y: number };
    slotIn: (id: string, i: number) => { x: number; y: number };
    cardObstacles: { id: string; x: number; y: number; w: number; h: number }[];
    pan: { x: number; y: number };
    zoom: number;
    PARAM_W: number;
    CARD_Y0: number;
    consumedSet: Set<string>;
  } = $props();
</script>

          <!-- PARAM WIRES — for every {Call.args[k] OR mv.offset[i] OR rot.rot[i]}
               with kind 'param', draw a bezier from the param chip's output
               socket to the consumer's input socket. -->
          {#each allNodes as n (n.id)}
            {#if n.type === 'call'}
              {#each Object.entries((n as any).args ?? {}) as [k, v], argIdx (k)}
                {#if (v as any).kind === 'param'}
                  {@const pIdx = paramEntries.findIndex(([nm]) => nm === (v as any).param)}
                  {#if pIdx >= 0 && leftTab === 'params'}
                    {@const ps = paramSocketPos(CARD_Y0, PARAM_W, pan, zoom,(v as any).param, pIdx)}
                    {@const pos = nodePos(n.id)}
                    {@const argY = pos.y + 36 + 14 + argIdx * 22}
                    <path class="ge-wire param" d={bezier(cardObstacles,ps.x, ps.y, pos.x, argY)}/>
                  {/if}
                {:else if (v as any).kind === 'expr'}
                  <!-- Expression arg — draw a wire from EACH referenced
                       p.<name> chip to this slot. Multi-source = visually
                       obvious; styled .expr to distinguish from direct
                       param wires (amber dashed vs orange dashed). -->
                  {#each extractParamRefs((v as any).expr) as refName (refName)}
                    {@const pIdx = paramEntries.findIndex(([nm]) => nm === refName)}
                    {#if pIdx >= 0 && leftTab === 'params'}
                      {@const ps = paramSocketPos(CARD_Y0, PARAM_W, pan, zoom,refName, pIdx)}
                      {@const pos = nodePos(n.id)}
                      {@const argY = pos.y + 36 + 14 + argIdx * 22}
                      <path class="ge-wire param expr" d={bezier(cardObstacles,ps.x, ps.y, pos.x, argY)}/>
                    {/if}
                  {/each}
                  <!-- NODE-REF expr — `__POLY__<sourceId>` sentinel set by
                       endWireOnCallArg when the user drags from a polygon
                       (or any producer) output socket onto this Call arg.
                       Render a green bezier from the source node's right
                       output socket to the input arg socket, matching the
                       polygon → revolve wire the user just made visible. -->
                  {@const polyMatch = String((v as any).expr ?? '').match(/^__POLY__(n_[a-z0-9_]+)$/i)}
                  {#if polyMatch && graph.nodes[polyMatch[1]]}
                    {@const sourceId = polyMatch[1]}
                    {@const srcSize = nodeSize(graph,graph.nodes[sourceId])}
                    {@const srcPos = nodePos(sourceId)}
                    {@const pos = nodePos(n.id)}
                    {@const argY = pos.y + 36 + 14 + argIdx * 22}
                    <path class="ge-wire noderef"
                      d={bezier(cardObstacles,srcPos.x + srcSize.w, srcPos.y + srcSize.h / 2, pos.x, argY)}/>
                  {/if}
                  <!-- EXPR-OUTPUT ref — the arg references an expr instance's
                       emitted output const (_x_<id>_<out>). Draw a wire from
                       that instance's right-edge output socket → this arg. -->
                  {#each allNodes as exn (exn.id)}
                    {#if exn.type === 'expr'}
                      {@const exDef = (graph.exprDefs ?? []).find((d) => d.id === (exn as any).defId)}
                      {#each ((exDef as any)?.outputs ?? []) as eo, eoIdx (eo.name)}
                        {#if String((v as any).expr ?? '').includes(exprBlockMember(exn.id, eo.name))}
                          {@const srcSize = nodeSize(graph, exn)}
                          {@const srcPos = nodePos(exn.id)}
                          {@const cpos = nodePos(n.id)}
                          {@const cargY = cpos.y + 36 + 14 + argIdx * 22}
                          <path class="ge-wire noderef" d={bezier(cardObstacles, srcPos.x + srcSize.w, srcPos.y + exprOutputSockY(eoIdx), cpos.x, cargY)}/>
                        {/if}
                      {/each}
                    {/if}
                  {/each}
                  <!-- SPLINE-OUTPUT ref — a `spline` node emits _x_<id>_path; its
                       output socket sits at the node's right edge, vertically
                       centred (NodeCard: cx=size.w, cy=size.h/2). The expr loop
                       above skips it (type!=='expr'), so draw its wire here. -->
                  {#each allNodes as sn (sn.id)}
                    {#if sn.type === 'spline' && String((v as any).expr ?? '').includes(exprBlockMember(sn.id, 'path'))}
                      {@const srcSize = nodeSize(graph, sn)}
                      {@const srcPos = nodePos(sn.id)}
                      {@const cpos = nodePos(n.id)}
                      {@const cargY = cpos.y + 36 + 14 + argIdx * 22}
                      <path class="ge-wire noderef" d={bezier(cardObstacles, srcPos.x + srcSize.w, srcPos.y + srcSize.h / 2, cpos.x, cargY)}/>
                    {/if}
                  {/each}
                {/if}
              {/each}
              <!-- (#25) mv/rot transforms are standalone icon nodes — their
                   axes are edited in the click-popover, not via per-axis strip
                   sockets, so no attached-transform axis wires render here. -->
            {:else if n.type === 'repeat'}
              <!-- Repeat count param-wire — chip → top-left count socket -->
              {#if (n as any).count?.kind === 'param'}
                {@const pIdx = paramEntries.findIndex(([nm]) => nm === (n as any).count.param)}
                {#if pIdx >= 0 && leftTab === 'params'}
                  {@const ps = paramSocketPos(CARD_Y0, PARAM_W, pan, zoom,(n as any).count.param, pIdx)}
                  {@const pos = nodePos(n.id)}
                  <path class="ge-wire param" d={bezier(cardObstacles,ps.x, ps.y, pos.x, pos.y + 17)}/>
                {/if}
              {:else if (n as any).count?.kind === 'expr'}
                {#each extractParamRefs((n as any).count.expr) as refName (refName)}
                  {@const pIdx = paramEntries.findIndex(([nm]) => nm === refName)}
                  {#if pIdx >= 0 && leftTab === 'params'}
                    {@const ps = paramSocketPos(CARD_Y0, PARAM_W, pan, zoom,refName, pIdx)}
                    {@const pos = nodePos(n.id)}
                    <path class="ge-wire param expr" d={bezier(cardObstacles,ps.x, ps.y, pos.x, pos.y + 17)}/>
                  {/if}
                {/each}
                <!-- EXPR-OUTPUT ref → repeat count socket. -->
                {@const rpos = nodePos(n.id)}
                {#each allNodes as exn (exn.id)}
                  {#if exn.type === 'expr'}
                    {@const exDef = (graph.exprDefs ?? []).find((d) => d.id === (exn as any).defId)}
                    {#each ((exDef as any)?.outputs ?? []) as eo, eoIdx (eo.name)}
                      {#if String((n as any).count.expr ?? '').includes(exprBlockMember(exn.id, eo.name))}
                        {@const srcSize = nodeSize(graph, exn)}
                        {@const srcPos = nodePos(exn.id)}
                        <path class="ge-wire noderef" d={bezier(cardObstacles, srcPos.x + srcSize.w, srcPos.y + exprOutputSockY(eoIdx), rpos.x, rpos.y + 17)}/>
                      {/if}
                    {/each}
                  {/if}
                {/each}
              {/if}
            {:else if n.type === 'polygon'}
              <!-- Polygon per-coord param wires. Each vertex has two
                   input sockets stacked on the LEFT edge of the card at
                   y = polySockR/Z(n, idx) — cumulative row walk that
                   mirrors the .ge-poly-vertex / .ge-poly-rref CSS.
                   Walk every point; for each coord with kind:'param'
                   (or 'expr' referencing p.<name>), draw a bezier from
                   the chip's output socket to that coord's input socket. -->
              {#each ((n as any).points ?? []) as pt, idx (idx)}
                {@const pos = nodePos(n.id)}
                {@const rTopY = pos.y + polySockR(n, idx)}
                {@const zTopY = pos.y + polySockZ(n, idx)}
                {#if pt.r?.kind === 'param'}
                  {@const pIdx = paramEntries.findIndex(([nm]) => nm === pt.r.param)}
                  {#if pIdx >= 0 && leftTab === 'params'}
                    {@const ps = paramSocketPos(CARD_Y0, PARAM_W, pan, zoom,pt.r.param, pIdx)}
                    <path class="ge-wire param" d={bezier(cardObstacles,ps.x, ps.y, pos.x, rTopY)}/>
                  {/if}
                {:else if pt.r?.kind === 'expr'}
                  {#each extractParamRefs(pt.r.expr) as refName (refName)}
                    {@const pIdx = paramEntries.findIndex(([nm]) => nm === refName)}
                    {#if pIdx >= 0 && leftTab === 'params'}
                      {@const ps = paramSocketPos(CARD_Y0, PARAM_W, pan, zoom,refName, pIdx)}
                      <path class="ge-wire param expr" d={bezier(cardObstacles,ps.x, ps.y, pos.x, rTopY)}/>
                    {/if}
                  {/each}
                  <!-- EXPR-OUTPUT ref → polygon r coord. -->
                  {#each allNodes as exn (exn.id)}
                    {#if exn.type === 'expr'}
                      {@const exDef = (graph.exprDefs ?? []).find((d) => d.id === (exn as any).defId)}
                      {#each ((exDef as any)?.outputs ?? []) as eo, eoIdx (eo.name)}
                        {#if String(pt.r.expr ?? '').includes(exprBlockMember(exn.id, eo.name))}
                          {@const srcSize = nodeSize(graph, exn)}
                          {@const srcPos = nodePos(exn.id)}
                          <path class="ge-wire noderef" d={bezier(cardObstacles, srcPos.x + srcSize.w, srcPos.y + exprOutputSockY(eoIdx), pos.x, rTopY)}/>
                        {/if}
                      {/each}
                    {/if}
                  {/each}
                {/if}
                {#if pt.z?.kind === 'param'}
                  {@const pIdx = paramEntries.findIndex(([nm]) => nm === pt.z.param)}
                  {#if pIdx >= 0 && leftTab === 'params'}
                    {@const ps = paramSocketPos(CARD_Y0, PARAM_W, pan, zoom,pt.z.param, pIdx)}
                    <path class="ge-wire param" d={bezier(cardObstacles,ps.x, ps.y, pos.x, zTopY)}/>
                  {/if}
                {:else if pt.z?.kind === 'expr'}
                  {#each extractParamRefs(pt.z.expr) as refName (refName)}
                    {@const pIdx = paramEntries.findIndex(([nm]) => nm === refName)}
                    {#if pIdx >= 0 && leftTab === 'params'}
                      {@const ps = paramSocketPos(CARD_Y0, PARAM_W, pan, zoom,refName, pIdx)}
                      <path class="ge-wire param expr" d={bezier(cardObstacles,ps.x, ps.y, pos.x, zTopY)}/>
                    {/if}
                  {/each}
                  <!-- EXPR-OUTPUT ref → polygon z coord. -->
                  {#each allNodes as exn (exn.id)}
                    {#if exn.type === 'expr'}
                      {@const exDef = (graph.exprDefs ?? []).find((d) => d.id === (exn as any).defId)}
                      {#each ((exDef as any)?.outputs ?? []) as eo, eoIdx (eo.name)}
                        {#if String(pt.z.expr ?? '').includes(exprBlockMember(exn.id, eo.name))}
                          {@const srcSize = nodeSize(graph, exn)}
                          {@const srcPos = nodePos(exn.id)}
                          <path class="ge-wire noderef" d={bezier(cardObstacles, srcPos.x + srcSize.w, srcPos.y + exprOutputSockY(eoIdx), pos.x, zTopY)}/>
                        {/if}
                      {/each}
                    {/if}
                  {/each}
                {/if}
                <!-- Repeat-ref wire (#157) — from the source poly_repeat's
                     output socket to this row's input socket on the
                     polygon's left edge. Distinctive violet skin so it
                     reads as "this loop feeds this row". -->
                {#if pt?.kind === 'repeat-ref'}
                  {@const src = graph.nodes[pt.sourceId]}
                  {#if src && src.type === 'poly_repeat'}
                    {@const srcXY = nodePos(src.id)}
                    {@const srcSize = nodeSize(graph,src as any)}
                    {@const srcX = srcXY.x + srcSize.w}
                    {@const srcY = srcXY.y + srcSize.h / 2}
                    {@const tgtX = pos.x}
                    {@const tgtY = pos.y + polySockRef(n, idx)}
                    <path class="ge-wire poly-rref" d={bezier(cardObstacles,srcX, srcY, tgtX, tgtY)} fill="none"/>
                  {/if}
                {/if}
              {/each}
            {:else if n.type === 'sketch'}
              <!-- Sketch per-coord param wires (main canvas) — mirror the
                   polygon pass. Each op's coord input sockets sit on the LEFT
                   edge at sketchSockR/Z/Val(n, idx); draw a bezier from the
                   param chip's output socket to any param/expr-wired coord so
                   the wiring is visible in the graph, not just the sketcher. -->
              {#each ((n as any).ops ?? []) as op, idx (idx)}
                {@const pos = nodePos(n.id)}
                {@const fields = (op.op === 'line' || op.op === 'spline')
                  ? [['r', sketchSockR(n, idx)], ['z', sketchSockZ(n, idx)]]
                  : op.op === 'fillet' ? [['radius', sketchSockVal(n, idx)]]
                  : op.op === 'chamfer' ? [['dist', sketchSockVal(n, idx)]] : []}
                {#each fields as [field, sy] (field)}
                  {@const av = (op as any)[field]}
                  {#if av?.kind === 'param'}
                    {@const pIdx = paramEntries.findIndex(([nm]) => nm === av.param)}
                    {#if pIdx >= 0 && leftTab === 'params'}
                      {@const ps = paramSocketPos(CARD_Y0, PARAM_W, pan, zoom,av.param, pIdx)}
                      <path class="ge-wire param" d={bezier(cardObstacles,ps.x, ps.y, pos.x, pos.y + (sy as number))}/>
                    {/if}
                  {:else if av?.kind === 'expr'}
                    {#each extractParamRefs(av.expr) as refName (refName)}
                      {@const pIdx = paramEntries.findIndex(([nm]) => nm === refName)}
                      {#if pIdx >= 0 && leftTab === 'params'}
                        {@const ps = paramSocketPos(CARD_Y0, PARAM_W, pan, zoom,refName, pIdx)}
                        <path class="ge-wire param expr" d={bezier(cardObstacles,ps.x, ps.y, pos.x, pos.y + (sy as number))}/>
                      {/if}
                    {/each}
                    <!-- EXPR-OUTPUT ref → sketch op coord/point socket. -->
                    {#each allNodes as exn (exn.id)}
                      {#if exn.type === 'expr'}
                        {@const exDef = (graph.exprDefs ?? []).find((d) => d.id === (exn as any).defId)}
                        {#each ((exDef as any)?.outputs ?? []) as eo, eoIdx (eo.name)}
                          {#if String(av.expr ?? '').includes(exprBlockMember(exn.id, eo.name))}
                            {@const srcSize = nodeSize(graph, exn)}
                            {@const srcPos = nodePos(exn.id)}
                            <path class="ge-wire noderef" d={bezier(cardObstacles, srcPos.x + srcSize.w, srcPos.y + exprOutputSockY(eoIdx), pos.x, pos.y + (sy as number))}/>
                          {/if}
                        {/each}
                      {/if}
                    {/each}
                  {/if}
                {/each}
              {/each}
            {:else if n.type === 'expr'}
              <!-- EXPR INSTANCE param wires (B.7 v3). For each PARAM binding
                   that references a p.<name> chip, draw a bezier from that chip
                   to the instance's input socket (left edge, line-aligned to the
                   param's row via exprInputSockY). Without this the binding sets
                   but no wire is visible. -->
              {@const exDef = (graph.exprDefs ?? []).find((d) => d.id === (n as any).defId)}
              {@const exBind = (n as any).bindings ?? {}}
              {#if exDef && leftTab === 'params'}
                {@const pos = nodePos(n.id)}
                {#each ((exDef as any).params ?? []) as ep, epIdx (ep.name)}
                  {@const bind = exBind[ep.name]}
                  {#if bind?.kind === 'param'}
                    {@const pIdx = paramEntries.findIndex(([nm]) => nm === bind.param)}
                    {#if pIdx >= 0}
                      {@const ps = paramSocketPos(CARD_Y0, PARAM_W, pan, zoom, bind.param, pIdx)}
                      <path class="ge-wire param" d={bezier(cardObstacles, ps.x, ps.y, pos.x, pos.y + exprInputSockY(epIdx))}/>
                    {/if}
                  {:else if bind?.kind === 'expr'}
                    {#each extractParamRefs(bind.expr) as refName (refName)}
                      {@const pIdx = paramEntries.findIndex(([nm]) => nm === refName)}
                      {#if pIdx >= 0}
                        {@const ps = paramSocketPos(CARD_Y0, PARAM_W, pan, zoom, refName, pIdx)}
                        <path class="ge-wire param expr" d={bezier(cardObstacles, ps.x, ps.y, pos.x, pos.y + exprInputSockY(epIdx))}/>
                      {/if}
                    {/each}
                  {/if}
                {/each}
              {/if}
            {:else if n.type === 'poly_repeat'}
              <!-- PolyRepeat NPts (count) param wire (2026-06-11). When
                   count is kind:'param', draw a bezier from the param
                   chip's output to the loop card's NPts input socket
                   on the left edge at y=57. Mirror branch for expr
                   coords that REFERENCE a p.<name>. -->
              {@const pos = nodePos(n.id)}
              {@const tgtX = pos.x}
              {@const tgtY = pos.y + 57}
              {#if (n as any).count?.kind === 'param'}
                {@const pIdx = paramEntries.findIndex(([nm]) => nm === (n as any).count.param)}
                {#if pIdx >= 0 && leftTab === 'params'}
                  {@const ps = paramSocketPos(CARD_Y0, PARAM_W, pan, zoom,(n as any).count.param, pIdx)}
                  <path class="ge-wire param" d={bezier(cardObstacles,ps.x, ps.y, tgtX, tgtY)}/>
                {/if}
              {:else if (n as any).count?.kind === 'expr'}
                {#each extractParamRefs((n as any).count.expr) as refName (refName)}
                  {@const pIdx = paramEntries.findIndex(([nm]) => nm === refName)}
                  {#if pIdx >= 0 && leftTab === 'params'}
                    {@const ps = paramSocketPos(CARD_Y0, PARAM_W, pan, zoom,refName, pIdx)}
                    <path class="ge-wire param expr" d={bezier(cardObstacles,ps.x, ps.y, tgtX, tgtY)}/>
                  {/if}
                {/each}
                <!-- EXPR-OUTPUT ref → poly_repeat NPts socket. -->
                {#each allNodes as exn (exn.id)}
                  {#if exn.type === 'expr'}
                    {@const exDef = (graph.exprDefs ?? []).find((d) => d.id === (exn as any).defId)}
                    {#each ((exDef as any)?.outputs ?? []) as eo, eoIdx (eo.name)}
                      {#if String((n as any).count.expr ?? '').includes(exprBlockMember(exn.id, eo.name))}
                        {@const srcSize = nodeSize(graph, exn)}
                        {@const srcPos = nodePos(exn.id)}
                        <path class="ge-wire noderef" d={bezier(cardObstacles, srcPos.x + srcSize.w, srcPos.y + exprOutputSockY(eoIdx), tgtX, tgtY)}/>
                      {/if}
                    {/each}
                  {/if}
                {/each}
              {/if}
            {:else if n.type === 'txfmn'}
              <!-- Standalone xform axis wires (B.7 v3). Six axis sockets on the
                   left edge at cy = 48 + i*24 (rot x/y/z then mv x/y/z; mirrors
                   NodeCard axisStartY=40 + i*axisRowH=24 + 12 − 4). For each axis
                   that is param/expr-wired, draw the param-chip wire; for each
                   that references an expr instance's OUTPUT const, draw the
                   expr-output wire. -->
              {@const tpos = nodePos(n.id)}
              {#each [0, 1, 2, 3, 4, 5] as i (i)}
                {@const sa = (i % 3) as 0 | 1 | 2}
                {@const av = (i < 3 ? (n as any).rot : (n as any).offset)?.[sa]}
                {@const tgtY = tpos.y + 48 + i * 24}
                {#if av?.kind === 'param'}
                  {@const pIdx = paramEntries.findIndex(([nm]) => nm === av.param)}
                  {#if pIdx >= 0 && leftTab === 'params'}
                    {@const ps = paramSocketPos(CARD_Y0, PARAM_W, pan, zoom, av.param, pIdx)}
                    <path class="ge-wire param" d={bezier(cardObstacles, ps.x, ps.y, tpos.x, tgtY)}/>
                  {/if}
                {:else if av?.kind === 'expr'}
                  {#each extractParamRefs(av.expr) as refName (refName)}
                    {@const pIdx = paramEntries.findIndex(([nm]) => nm === refName)}
                    {#if pIdx >= 0 && leftTab === 'params'}
                      {@const ps = paramSocketPos(CARD_Y0, PARAM_W, pan, zoom, refName, pIdx)}
                      <path class="ge-wire param expr" d={bezier(cardObstacles, ps.x, ps.y, tpos.x, tgtY)}/>
                    {/if}
                  {/each}
                  <!-- EXPR-OUTPUT ref → txfmn axis socket. -->
                  {#each allNodes as exn (exn.id)}
                    {#if exn.type === 'expr'}
                      {@const exDef = (graph.exprDefs ?? []).find((d) => d.id === (exn as any).defId)}
                      {#each ((exDef as any)?.outputs ?? []) as eo, eoIdx (eo.name)}
                        {#if String(av.expr ?? '').includes(exprBlockMember(exn.id, eo.name))}
                          {@const srcSize = nodeSize(graph, exn)}
                          {@const srcPos = nodePos(exn.id)}
                          <path class="ge-wire noderef" d={bezier(cardObstacles, srcPos.x + srcSize.w, srcPos.y + exprOutputSockY(eoIdx), tpos.x, tgtY)}/>
                        {/if}
                      {/each}
                    {/if}
                  {/each}
                {/if}
              {/each}
            {/if}
          {/each}

          <!-- MATERIAL binding wires (G-MAT-CARD) — from a material node's output
               socket to the bound part's ◑ input socket (header-left, cy=16).
               Emerald dashed so it reads as a "material" channel, not geometry. -->
          {#each Object.entries((graph as any).materialBindings ?? {}) as [partId, matId] (partId + ':' + matId)}
            {#if graph.nodes[partId] && graph.nodes[matId as string]}
              {@const src = outSock(matId as string)}
              {@const tp = nodePos(partId)}
              <path class="ge-wire material" d={bezier(cardObstacles, src.x, src.y, tp.x, tp.y + 16)} fill="none"/>
            {/if}
          {/each}

          <!-- WIRES: render method.obj/arg + transform.child as bezier paths. -->
          {#each allNodes as n (n.id)}
            {#if n.type === 'method'}
              {#if (n as any).obj && graph.nodes[(n as any).obj]}
                {@const src = outSock((n as any).obj)}
                {@const tgt = inSock(n.id, 'obj')}
                <path class="ge-wire obj" d={bezier(cardObstacles,src.x, src.y, tgt.x, tgt.y)} fill="none"/>
              {/if}
              {#if (n as any).arg && graph.nodes[(n as any).arg]}
                {@const src = outSock((n as any).arg)}
                {@const tgt = inSock(n.id, 'arg')}
                <path class="ge-wire arg" d={bezier(cardObstacles,src.x, src.y, tgt.x, tgt.y)} fill="none"/>
              {/if}
            {:else if n.type === 'mv' || n.type === 'rot'}
              {#if (n as any).child && graph.nodes[(n as any).child]}
                {@const src = outSock((n as any).child)}
                {@const tgt = inSock(n.id, 'child')}
                <path class="ge-wire child" d={bezier(cardObstacles,src.x, src.y, tgt.x, tgt.y)} fill="none"/>
              {/if}
            {:else if n.type === 'txfmn'}
              <!-- txfmn child wire — same left-edge child socket as mv/rot. -->
              {#if (n as any).child && graph.nodes[(n as any).child]}
                {@const src = outSock((n as any).child)}
                {@const tgt = inSock(n.id, 'child')}
                <path class="ge-wire child" d={bezier(cardObstacles,src.x, src.y, tgt.x, tgt.y)} fill="none"/>
              {/if}
            {:else if n.type === 'repeat'}
              <!-- Repeat node's PART wires — one per child, into its row socket
                   on the left edge (cy = 68 + ci*24 in the card markup). -->
              {@const pos = nodePos(n.id)}
              {#each ((n as any).children ?? []) as cid, ci (cid + ':' + ci)}
                {#if graph.nodes[cid]}
                  {@const src = outSock(cid)}
                  <path class="ge-wire child" d={bezier(cardObstacles,src.x, src.y, pos.x, pos.y + 68 + ci * 24)} fill="none"/>
                {/if}
              {/each}
            {:else if n.type === 'spline'}
              <!-- Spline control-POINTS input wire (#26) — when the spline's
                   pointsExpr references an expr instance's output const
                   (_x_<id>_<out>), draw a wire from that instance's right-edge
                   output socket → the spline's left-edge input socket (centered
                   at sh/2, matching NodeCard's cx=0, cy=sh/2). -->
              {@const px = (n as any).pointsExpr}
              {#if px?.kind === 'expr'}
                {@const spos = nodePos(n.id)}
                {@const ssize = nodeSize(graph, n)}
                {@const tgtY = spos.y + ssize.h / 2}
                {#each allNodes as exn (exn.id)}
                  {#if exn.type === 'expr'}
                    {@const exDef = (graph.exprDefs ?? []).find((d) => d.id === (exn as any).defId)}
                    {#each ((exDef as any)?.outputs ?? []) as eo, eoIdx (eo.name)}
                      {#if String(px.expr ?? '').includes(exprBlockMember(exn.id, eo.name))}
                        {@const srcSize = nodeSize(graph, exn)}
                        {@const srcPos = nodePos(exn.id)}
                        <path class="ge-wire noderef" d={bezier(cardObstacles, srcPos.x + srcSize.w, srcPos.y + exprOutputSockY(eoIdx), spos.x, tgtY)}/>
                      {/if}
                    {/each}
                  {/if}
                {/each}
              {/if}
            {:else if n.type === 'warp'}
              <!-- Warp modifier (#36): the `solid` child wire (child output →
                   left child socket, same as mv/rot) + the `path` wire (a wired
                   spline / expr output → the lower-left path socket at
                   WARP_PATH_CY). -->
              {@const warpKids = (Array.isArray((n as any).children) && (n as any).children.length) ? (n as any).children : ((n as any).child ? [(n as any).child] : [])}
              {#each warpKids as kid, ki (ki)}
                {#if kid && graph.nodes[kid]}
                  {@const src = outSock(kid)}
                  {@const tgt = inSock(n.id, warpKids.length > 1 ? `children[${ki}]` : 'child')}
                  <path class="ge-wire child" d={bezier(cardObstacles,src.x, src.y, tgt.x, tgt.y)} fill="none"/>
                {/if}
              {/each}
              {@const wpath = (n as any).path}
              {#if wpath?.kind === 'expr'}
                {@const wpos = nodePos(n.id)}
                {@const ptgtY = wpos.y + warpPathCY(n)}
                <!-- SPLINE path source → warp path socket. -->
                {#each allNodes as sn (sn.id)}
                  {#if sn.type === 'spline' && String(wpath.expr ?? '').includes(exprBlockMember(sn.id, 'path'))}
                    {@const srcSize = nodeSize(graph, sn)}
                    {@const srcPos = nodePos(sn.id)}
                    <path class="ge-wire noderef" d={bezier(cardObstacles, srcPos.x + srcSize.w, srcPos.y + srcSize.h / 2, wpos.x, ptgtY)}/>
                  {/if}
                {/each}
                <!-- EXPR-OUTPUT path source → warp path socket. -->
                {#each allNodes as exn (exn.id)}
                  {#if exn.type === 'expr'}
                    {@const exDef = (graph.exprDefs ?? []).find((d) => d.id === (exn as any).defId)}
                    {#each ((exDef as any)?.outputs ?? []) as eo, eoIdx (eo.name)}
                      {#if String(wpath.expr ?? '').includes(exprBlockMember(exn.id, eo.name))}
                        {@const srcSize = nodeSize(graph, exn)}
                        {@const srcPos = nodePos(exn.id)}
                        <path class="ge-wire noderef" d={bezier(cardObstacles, srcPos.x + srcSize.w, srcPos.y + exprOutputSockY(eoIdx), wpos.x, ptgtY)}/>
                      {/if}
                    {/each}
                  {/if}
                {/each}
              {/if}
            {:else if n.type === 'cutaway'}
              <!-- Cutaway modifier: the `solid` child wire (child output →
                   left child socket, same as mv/rot/warp). `az`/`offset` are
                   literals/params, not node refs, so there's no data wire. -->
              {#if (n as any).child && graph.nodes[(n as any).child]}
                {@const src = outSock((n as any).child)}
                {@const tgt = inSock(n.id, 'child')}
                <path class="ge-wire child" d={bezier(cardObstacles,src.x, src.y, tgt.x, tgt.y)} fill="none"/>
              {/if}
            {:else if n.type === 'list' || n.type === 'stack' || n.type === 'group'}
              <!-- Container wires: each visible child of a container shows as
                   a bezier from the child's output socket → the container's
                   slot input socket. For the ROOT (▶ Output), consumed
                   children are filtered out so we don't draw wires into
                   non-existent slots — matches the slot-render filter. -->
              {@const visKids = (n.id === graph.root
                ? (n as any).children.filter((cid: string) => !consumedSet.has(cid))
                : (n as any).children) as string[]}
              {#each visKids as childId, i (childId)}
                {#if graph.nodes[childId]}
                  {@const src = outSock(childId)}
                  <!-- ROOT Output card centers its sockets (rootOutputSockY) —
                       the wire MUST hit the same Y, else it lands on the wrong
                       socket. Non-root containers stay top-anchored. -->
                  {@const rootPos = nodePos(n.id)}
                  {@const tgt = n.id === graph.root
                    ? { x: rootPos.x, y: rootPos.y + rootOutputSockY(nodeSize(graph, n).h, i, visKids.length) }
                    : slotIn(n.id, i)}
                  <path class="ge-wire output" class:root={n.id === graph.root}
                    d={bezier(cardObstacles,src.x, src.y, tgt.x, tgt.y)} fill="none"/>
                {/if}
              {/each}
            {/if}
          {/each}

<style>
  /* Wire beziers (moved from GraphEditorPane with the markup above). The
     base .ge-wire + .in-flight stay in GEP for the in-flight drag path. */
  .ge-wire { stroke-width: 2; stroke-linecap: round; fill: none; }
  .ge-wire.obj { stroke: #b91c1c; }
  .ge-wire.arg { stroke: #d97706; }
  .ge-wire.child { stroke: #6d28d9; }
  .ge-wire.material { stroke: #10b981; stroke-width: 2.4; stroke-dasharray: 6 3; opacity: 0.9; }
  .ge-wire.param { stroke: #d97706; stroke-dasharray: 2 2; opacity: 0.85; }
  /* Expression wires — multi-source. Same color as direct-param wires
     but a longer dash so it reads as "composed via expression" not
     "wired directly". Helps when both wire types meet at the same slot. */
  .ge-wire.param.expr { stroke: #b45309; stroke-dasharray: 5 3; opacity: 0.75; }
  /* Node-ref wire (polygon → revolve.profile etc) — orange solid, slightly
     bolder than param wires so the producer→consumer connection reads as
     "value flow" rather than "param injection". */
  .ge-wire.noderef { stroke: #c2410c; stroke-width: 2.4; fill: none; opacity: 0.9; }
  /* output: piping a node into a container's slot. Green = "this is what the
     function returns / what gets stacked". root variant is slightly thicker
     to mark "this lands in the function's final return". */
  .ge-wire.output { stroke: #15803d; opacity: 0.7; }
  .ge-wire.output.root { stroke: #047857; stroke-width: 2.5; opacity: 0.85; }
  /* Repeat-ref wire (#157) — violet, slightly thicker than the param
     bezier so it reads as "data flow" not "param wiring". */
  .ge-wire.poly-rref {
    stroke: #6d28d9; stroke-width: 2.5; stroke-opacity: 0.75;
    fill: none;
  }
</style>
