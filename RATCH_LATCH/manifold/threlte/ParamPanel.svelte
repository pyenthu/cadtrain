<script>
  import { deriveBody } from '../assembly';

  let {
    params = $bindable(),
    showBody = $bindable(true),
    showMandrel = $bindable(true),
    showSeal = $bindable(true),
    showCutaway = $bindable(true),
    showLabels = $bindable(true),
    showEdges = $bindable(true),
    lights = $bindable([]),
    ambient = $bindable(0.3),
    buildTime = 0,
  } = $props();

  let expandedSections = $state({ display: false, body: true, mandrel: false, seal: false, lights: false });

  function toggle(section) {
    expandedSections[section] = !expandedSections[section];
  }
</script>

<div class="panel">
  <div class="panel-header">
    <span>Ratch-Latch</span>
    <span class="build-badge">{buildTime.toFixed(0)}ms</span>
  </div>

  <!-- Display -->
  <button class="folder-btn" onclick={() => toggle('display')}>
    <span class="arrow">{expandedSections.display ? '▼' : '▶'}</span>
    Display
  </button>
  {#if expandedSections.display}
    <div class="folder-body">
      <label class="row-check"><input type="checkbox" bind:checked={showCutaway} /> Cross-Section</label>
      <label class="row-check"><input type="checkbox" bind:checked={showLabels} /> Labels</label>
      <label class="row-check"><input type="checkbox" bind:checked={showEdges} /> Edges</label>
    </div>
  {/if}

  <!-- Body -->
  <div class="folder-header">
    <input type="checkbox" bind:checked={showBody} onclick={(e) => e.stopPropagation()} />
    <button class="folder-btn comp" onclick={() => toggle('body')}>
      <span class="arrow">{expandedSections.body ? '▼' : '▶'}</span>
      <span class="dot" style="background:#cc2222"></span>
      Body
    </button>
  </div>
  {#if expandedSections.body}
    <div class="folder-body">
      <div class="param-row"><span>Top Cap OD</span><input type="range" min="1" max="4" step="0.1" bind:value={params.body.topCapOD} /><input type="number" step="0.1" bind:value={params.body.topCapOD} /></div>
      <div class="param-row"><span>Top Cap Len</span><input type="range" min="0.1" max="1" step="0.05" bind:value={params.body.topCapLength} /><input type="number" step="0.05" bind:value={params.body.topCapLength} /></div>
      <div class="param-row"><span>Thread OD</span><input type="range" min="1" max="4" step="0.1" bind:value={params.body.threadOD} /><input type="number" step="0.1" bind:value={params.body.threadOD} /></div>
      <div class="param-row"><span>Thread Len</span><input type="range" min="0.5" max="4" step="0.1" bind:value={params.body.threadLength} /><input type="number" step="0.1" bind:value={params.body.threadLength} /></div>
      <div class="param-row"><span>Thread Count</span><input type="range" min="0" max="25" step="1" bind:value={params.body.numThreads} /><input type="number" step="1" bind:value={params.body.numThreads} /></div>
      <div class="param-row"><span>Upper OD</span><input type="range" min="1" max="4" step="0.1" bind:value={params.body.upperOD} /><input type="number" step="0.1" bind:value={params.body.upperOD} /></div>
      <div class="param-row"><span>Upper Wall</span><input type="range" min="0.1" max="1" step="0.05" bind:value={params.body.upperWall} /><input type="number" step="0.05" bind:value={params.body.upperWall} /></div>
      <div class="param-row computed"><span>Upper ID</span><span class="computed-val">{(params.body.upperOD - 2 * params.body.upperWall).toFixed(2)}</span></div>
      <div class="param-row"><span>Upper Length</span><input type="range" min="1" max="8" step="0.1" bind:value={params.body.upperLength} /><input type="number" step="0.1" bind:value={params.body.upperLength} /></div>
      <div class="param-row"><span>Shoulder OD</span><input type="range" min="1" max="4" step="0.1" bind:value={params.body.shoulderOD} /><input type="number" step="0.1" bind:value={params.body.shoulderOD} /></div>
      <div class="param-row"><span>Shoulder Taper</span><input type="range" min="0.1" max="1" step="0.05" bind:value={params.body.shoulderTaperH} /><input type="number" step="0.05" bind:value={params.body.shoulderTaperH} /></div>
      <div class="param-row"><span>Lower OD</span><input type="range" min="1" max="4" step="0.1" bind:value={params.body.lowerOD} /><input type="number" step="0.1" bind:value={params.body.lowerOD} /></div>
      <div class="param-row"><span>Lower Wall</span><input type="range" min="0.1" max="1" step="0.05" bind:value={params.body.lowerWall} /><input type="number" step="0.05" bind:value={params.body.lowerWall} /></div>
      <div class="param-row computed"><span>Lower ID</span><span class="computed-val">{(params.body.lowerOD - 2 * params.body.lowerWall).toFixed(2)}</span></div>
      <div class="param-row"><span>Lower Length</span><input type="range" min="1" max="10" step="0.1" bind:value={params.body.lowerLength} /><input type="number" step="0.1" bind:value={params.body.lowerLength} /></div>
      <div class="param-row"><span>Bottom Taper</span><input type="range" min="0.1" max="1" step="0.05" bind:value={params.body.bottomTaperH} /><input type="number" step="0.05" bind:value={params.body.bottomTaperH} /></div>
      <div class="param-row"><span>Bottom OD</span><input type="range" min="1" max="4" step="0.1" bind:value={params.body.bottomOD} /><input type="number" step="0.1" bind:value={params.body.bottomOD} /></div>
    </div>
  {/if}

  <!-- Mandrel -->
  <div class="folder-header">
    <input type="checkbox" bind:checked={showMandrel} onclick={(e) => e.stopPropagation()} />
    <button class="folder-btn comp" onclick={() => toggle('mandrel')}>
      <span class="arrow">{expandedSections.mandrel ? '▼' : '▶'}</span>
      <span class="dot" style="background:#999"></span>
      Mandrel
    </button>
  </div>
  {#if expandedSections.mandrel}
    <div class="folder-body">
      <div class="param-row"><span>Mandrel OD</span><input type="range" min="0.5" max="3" step="0.1" bind:value={params.mandrel.mandrelOD} /><input type="number" step="0.1" bind:value={params.mandrel.mandrelOD} /></div>
      <div class="param-row"><span>Mandrel ID</span><input type="range" min="0.3" max="2" step="0.1" bind:value={params.mandrel.mandrelID} /><input type="number" step="0.1" bind:value={params.mandrel.mandrelID} /></div>
      <div class="param-row"><span>Length</span><input type="range" min="1" max="15" step="0.1" bind:value={params.mandrel.mandrelLength} /><input type="number" step="0.1" bind:value={params.mandrel.mandrelLength} /></div>
      <div class="param-row"><span>Offset</span><input type="range" min="0" max="5" step="0.1" bind:value={params.mandrel.mandrelOffset} /><input type="number" step="0.1" bind:value={params.mandrel.mandrelOffset} /></div>
    </div>
  {/if}

  <!-- Seal -->
  <div class="folder-header">
    <input type="checkbox" bind:checked={showSeal} onclick={(e) => e.stopPropagation()} />
    <button class="folder-btn comp" onclick={() => toggle('seal')}>
      <span class="arrow">{expandedSections.seal ? '▼' : '▶'}</span>
      <span class="dot" style="background:#777"></span>
      Seal
    </button>
  </div>
  {#if expandedSections.seal}
    <div class="folder-body">
      <div class="param-row"><span>Seal OD</span><input type="range" min="0.5" max="3" step="0.1" bind:value={params.seal.sealOD} /><input type="number" step="0.1" bind:value={params.seal.sealOD} /></div>
      <div class="param-row"><span>Height</span><input type="range" min="0.5" max="4" step="0.1" bind:value={params.seal.sealHeight} /><input type="number" step="0.1" bind:value={params.seal.sealHeight} /></div>
      <div class="param-row"><span>Offset</span><input type="range" min="0" max="12" step="0.1" bind:value={params.seal.sealOffset} /><input type="number" step="0.1" bind:value={params.seal.sealOffset} /></div>
      <div class="param-row"><span>Seal Count</span><input type="range" min="1" max="8" step="1" bind:value={params.seal.numSeals} /><input type="number" step="1" bind:value={params.seal.numSeals} /></div>
      <div class="param-row"><span>Groove Depth</span><input type="range" min="0" max="0.2" step="0.01" bind:value={params.seal.grooveDepth} /><input type="number" step="0.01" bind:value={params.seal.grooveDepth} /></div>
    </div>
  {/if}

  <!-- Lights -->
  <button class="folder-btn" onclick={() => toggle('lights')}>
    <span class="arrow">{expandedSections.lights ? '▼' : '▶'}</span>
    Lights
  </button>
  {#if expandedSections.lights}
    <div class="folder-body">
      <div class="param-row"><span>Ambient</span><input type="range" min="0" max="1" step="0.05" bind:value={ambient} /><input type="number" step="0.05" bind:value={ambient} /></div>
      {#each lights as light, i}
        <div class="light-row">
          <input type="checkbox" bind:checked={light.on} />
          <span class="light-label">L{i+1}</span>
          <input type="number" step="1" bind:value={light.x} />
          <input type="number" step="1" bind:value={light.y} />
          <input type="number" step="1" bind:value={light.z} />
          <input type="number" step="10" bind:value={light.intensity} />
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .panel { font-family: Arial, sans-serif; font-size: 11px; color: #333; padding: 8px 0; }
  .panel-header { display:flex; justify-content:space-between; align-items:center; padding:0 10px 8px; font-weight:bold; font-size:13px; border-bottom:1px solid #ddd; margin-bottom:4px; }
  .build-badge { font-size:9px; color:#888; font-weight:normal; background:#f0f0f0; padding:2px 6px; border-radius:8px; }
  .folder-btn { display:flex; align-items:center; gap:6px; width:100%; padding:6px 10px; background:none; border:none; border-bottom:1px solid #f0f0f0; cursor:pointer; font-size:11px; font-weight:bold; color:#444; text-align:left; }
  .folder-btn:hover { background:#f5f5f5; }
  .folder-btn.comp { flex:1; }
  .folder-header { display:flex; align-items:center; gap:4px; padding-left:8px; border-bottom:1px solid #f0f0f0; }
  .folder-header input[type="checkbox"] { width:14px; height:14px; cursor:pointer; }
  .arrow { font-size:8px; width:12px; color:#999; }
  .dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; }
  .folder-body { padding:4px 10px 8px 20px; border-bottom:1px solid #eee; }
  .param-row { display:flex; align-items:center; gap:4px; margin:3px 0; }
  .param-row span { width:80px; font-size:10px; color:#555; flex-shrink:0; }
  .param-row input[type="range"] { flex:1; height:4px; cursor:pointer; accent-color:#cc2222; }
  .param-row input[type="number"] { width:45px; font-size:10px; font-family:monospace; border:1px solid #ddd; border-radius:3px; padding:2px 4px; text-align:right; }
  .param-row.computed { opacity:0.7; }
  .computed-val { font-family:monospace; font-size:11px; color:#888; text-align:right; flex:1; }
  .row-check { display:flex; align-items:center; gap:6px; margin:3px 0; cursor:pointer; font-size:11px; }
  .row-check input { width:14px; height:14px; }
  .light-row { display:flex; align-items:center; gap:3px; margin:3px 0; }
  .light-row input[type="checkbox"] { width:12px; height:12px; }
  .light-label { font-size:9px; width:16px; color:#888; }
  .light-row input[type="number"] { width:36px; font-size:9px; font-family:monospace; border:1px solid #ddd; border-radius:2px; padding:1px 3px; text-align:right; }
</style>
