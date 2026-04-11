<script lang="ts">
  let {
    params = $bindable(),
    showHousing = $bindable(true),
    showSlips = $bindable(true),
    showSleeve = $bindable(true),
    showCutaway = $bindable(true),
    showLabels = $bindable(true),
    showEdges = $bindable(true),
    lights = $bindable([]),
    ambient = $bindable(0.3),
    buildTime = 0,
  } = $props();

  let expandedSections = $state({ display: false, housing: true, slips: false, sleeve: false, lights: false });

  function toggle(section) {
    expandedSections[section] = !expandedSections[section];
  }
</script>

<div class="panel">
  <div class="panel-header">
    <span>Bottom Sub</span>
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

  <!-- Housing -->
  <div class="folder-header">
    <input type="checkbox" bind:checked={showHousing} onclick={(e) => e.stopPropagation()} />
    <button class="folder-btn comp" onclick={() => toggle('housing')}>
      <span class="arrow">{expandedSections.housing ? '▼' : '▶'}</span>
      <span class="dot" style="background:#cc2222"></span>
      Housing
    </button>
  </div>
  {#if expandedSections.housing}
    <div class="folder-body">
      <div class="param-row">
        <span>Body OD</span>
        <input type="range" min="1" max="4" step="0.1" bind:value={params.housing.bodyOD} />
        <input type="number" step="0.1" bind:value={params.housing.bodyOD} />
      </div>
      <div class="param-row">
        <span>Body Wall</span>
        <input type="range" min="0.1" max="0.8" step="0.05" bind:value={params.housing.bodyWall} />
        <input type="number" step="0.05" bind:value={params.housing.bodyWall} />
      </div>
      <div class="param-row computed">
        <span>Body ID</span>
        <span class="computed-val">{(params.housing.bodyOD - 2 * params.housing.bodyWall).toFixed(2)}</span>
      </div>
      <div class="param-row">
        <span>Body Length</span>
        <input type="range" min="1" max="6" step="0.1" bind:value={params.housing.bodyLength} />
        <input type="number" step="0.1" bind:value={params.housing.bodyLength} />
      </div>
      <div class="param-row">
        <span>Taper Top OD</span>
        <input type="range" min="1" max="4" step="0.1" bind:value={params.housing.taperTopOD} />
        <input type="number" step="0.1" bind:value={params.housing.taperTopOD} />
      </div>
      <div class="param-row">
        <span>Taper Length</span>
        <input type="range" min="0.1" max="1" step="0.05" bind:value={params.housing.taperLength} />
        <input type="number" step="0.05" bind:value={params.housing.taperLength} />
      </div>
      <div class="param-row">
        <span>Flat Top</span>
        <input type="range" min="0" max="1" step="0.05" bind:value={params.housing.flatTopLength} />
        <input type="number" step="0.05" bind:value={params.housing.flatTopLength} />
      </div>
      <div class="param-row">
        <span>Box End OD</span>
        <input type="range" min="1" max="5" step="0.1" bind:value={params.housing.lowerOD} />
        <input type="number" step="0.1" bind:value={params.housing.lowerOD} />
      </div>
      <div class="param-row">
        <span>Box End Wall</span>
        <input type="range" min="0.2" max="1.5" step="0.05" bind:value={params.housing.lowerWall} />
        <input type="number" step="0.05" bind:value={params.housing.lowerWall} />
      </div>
      <div class="param-row computed">
        <span>Box End ID</span>
        <span class="computed-val">{(params.housing.lowerOD - 2 * params.housing.lowerWall).toFixed(2)}</span>
      </div>
      <div class="param-row">
        <span>Box End Length</span>
        <input type="range" min="1" max="6" step="0.1" bind:value={params.housing.lowerLength} />
        <input type="number" step="0.1" bind:value={params.housing.lowerLength} />
      </div>
      <div class="param-row">
        <span>Bottom Taper</span>
        <input type="range" min="0.1" max="1" step="0.05" bind:value={params.housing.bottomTaperH} />
        <input type="number" step="0.05" bind:value={params.housing.bottomTaperH} />
      </div>
      <div class="param-row">
        <span>Threads</span>
        <input type="range" min="0" max="6" step="1" bind:value={params.housing.numThreads} />
        <input type="number" step="1" bind:value={params.housing.numThreads} />
      </div>
    </div>
  {/if}

  <!-- Slips -->
  <div class="folder-header">
    <input type="checkbox" bind:checked={showSlips} onclick={(e) => e.stopPropagation()} />
    <button class="folder-btn comp" onclick={() => toggle('slips')}>
      <span class="arrow">{expandedSections.slips ? '▼' : '▶'}</span>
      <span class="dot" style="background:#aa2222"></span>
      Slips
    </button>
  </div>
  {#if expandedSections.slips}
    <div class="folder-body">
      <div class="param-row">
        <span>Slip OD</span>
        <input type="range" min="1" max="5" step="0.1" bind:value={params.slips.slipOD} />
        <input type="number" step="0.1" bind:value={params.slips.slipOD} />
      </div>
      <div class="param-row">
        <span>Height</span>
        <input type="range" min="0.5" max="3" step="0.1" bind:value={params.slips.slipHeight} />
        <input type="number" step="0.1" bind:value={params.slips.slipHeight} />
      </div>
      <div class="param-row">
        <span>Z Offset</span>
        <input type="range" min="0" max="3" step="0.1" bind:value={params.slips.slipOffset} />
        <input type="number" step="0.1" bind:value={params.slips.slipOffset} />
      </div>
      <div class="param-row">
        <span>Sectors</span>
        <input type="range" min="2" max="8" step="1" bind:value={params.slips.numSectors} />
        <input type="number" step="1" bind:value={params.slips.numSectors} />
      </div>
      <div class="param-row">
        <span>Grooves</span>
        <input type="range" min="0" max="20" step="1" bind:value={params.slips.numGrooves} />
        <input type="number" step="1" bind:value={params.slips.numGrooves} />
      </div>
      <div class="param-row">
        <span>Groove Depth</span>
        <input type="range" min="0" max="0.2" step="0.01" bind:value={params.slips.grooveDepth} />
        <input type="number" step="0.01" bind:value={params.slips.grooveDepth} />
      </div>
      <div class="param-row">
        <span>Tooth Taper</span>
        <button
          class="toggle-btn"
          class:active={params.slips.taperDirection === -1}
          onclick={() => params.slips.taperDirection = params.slips.taperDirection === -1 ? 1 : -1}
        >
          {params.slips.taperDirection === -1 ? '▼ Down' : '▲ Up'}
        </button>
        <button
          class="toggle-btn"
          class:active={params.slips.taperDirection === 0}
          onclick={() => params.slips.taperDirection = params.slips.taperDirection === 0 ? -1 : 0}
        >
          {params.slips.taperDirection === 0 ? '— Flat' : '⟋ Tapered'}
        </button>
      </div>
    </div>
  {/if}

  <!-- Sleeve -->
  <div class="folder-header">
    <input type="checkbox" bind:checked={showSleeve} onclick={(e) => e.stopPropagation()} />
    <button class="folder-btn comp" onclick={() => toggle('sleeve')}>
      <span class="arrow">{expandedSections.sleeve ? '▼' : '▶'}</span>
      <span class="dot" style="background:#999"></span>
      Sleeve
    </button>
  </div>
  {#if expandedSections.sleeve}
    <div class="folder-body">
      <div class="param-row">
        <span>Sleeve OD</span>
        <input type="range" min="0.5" max="2" step="0.1" bind:value={params.sleeve.sleeveOD} />
        <input type="number" step="0.1" bind:value={params.sleeve.sleeveOD} />
      </div>
      <div class="param-row">
        <span>Sleeve ID</span>
        <input type="range" min="0.3" max="1.5" step="0.1" bind:value={params.sleeve.sleeveID} />
        <input type="number" step="0.1" bind:value={params.sleeve.sleeveID} />
      </div>
      <div class="param-row">
        <span>Length</span>
        <input type="range" min="0.5" max="5" step="0.1" bind:value={params.sleeve.sleeveLength} />
        <input type="number" step="0.1" bind:value={params.sleeve.sleeveLength} />
      </div>
      <div class="param-row">
        <span>Offset</span>
        <input type="range" min="-2" max="2" step="0.1" bind:value={params.sleeve.sleeveOffset} />
        <input type="number" step="0.1" bind:value={params.sleeve.sleeveOffset} />
      </div>
      <div class="param-row">
        <span>Pins</span>
        <input type="range" min="0" max="4" step="1" bind:value={params.sleeve.numPins} />
        <input type="number" step="1" bind:value={params.sleeve.numPins} />
      </div>
    </div>
  {/if}

  <!-- Lights -->
  <button class="folder-btn" onclick={() => toggle('lights')}>
    <span class="arrow">{expandedSections.lights ? '▼' : '▶'}</span>
    Lights
  </button>
  {#if expandedSections.lights}
    <div class="folder-body">
      <div class="param-row">
        <span>Ambient</span>
        <input type="range" min="0" max="1" step="0.05" bind:value={ambient} />
        <input type="number" step="0.05" bind:value={ambient} />
      </div>
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
  .param-row.computed { opacity:0.7; }
  .computed-val { font-family:monospace; font-size:11px; color:#888; text-align:right; flex:1; }
  .param-row input[type="range"] { flex:1; height:4px; cursor:pointer; accent-color:#cc2222; }
  .param-row input[type="number"] { width:45px; font-size:10px; font-family:monospace; border:1px solid #ddd; border-radius:3px; padding:2px 4px; text-align:right; }
  .row-check { display:flex; align-items:center; gap:6px; margin:3px 0; cursor:pointer; font-size:11px; }
  .row-check input { width:14px; height:14px; }
  .light-row { display:flex; align-items:center; gap:3px; margin:3px 0; }
  .light-row input[type="checkbox"] { width:12px; height:12px; }
  .light-label { font-size:9px; width:16px; color:#888; }
  .light-row input[type="number"] { width:36px; font-size:9px; font-family:monospace; border:1px solid #ddd; border-radius:2px; padding:1px 3px; text-align:right; }
  .toggle-btn { font-size:10px; padding:2px 8px; border:1px solid #ccc; border-radius:3px; background:#f5f5f5; cursor:pointer; color:#555; }
  .toggle-btn:hover { background:#eee; }
  .toggle-btn.active { background:#cc2222; color:white; border-color:#aa1111; }
</style>
