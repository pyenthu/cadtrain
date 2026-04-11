<script lang="ts">
  import { Canvas } from '@threlte/core';
  import Scene from '$tools/bottom-sub/Scene.svelte';
  import ParamPanel from '$tools/bottom-sub/ParamPanel.svelte';
  import { DEFAULT_PARAMS } from '$tools/bottom-sub/assembly';

  let showCutaway = $state(true);
  let showLabels = $state(true);
  let showEdges = $state(true);
  let showHousing = $state(true);
  let showSlips = $state(true);
  let showSleeve = $state(true);
  let lights = $state([
    { x: 1, y: -4, z: -2, intensity: 200, on: true },
    { x: 12, y: 8, z: 0, intensity: 120, on: true },
    { x: 0, y: -6, z: 0, intensity: 80, on: true },
    { x: 5, y: 0, z: 5, intensity: 60, on: false },
  ]);
  let ambient = $state(0.3);
  let params = $state(structuredClone(DEFAULT_PARAMS));
  let camText = $state("...");
  let buildTime = $state(0);
</script>

<div class="tool-layout">
  <div class="panel-left">
    <img src="/training_data/bottom_sub/images/original.png" alt="Original" />
    <div class="label">Original Drawing</div>
  </div>
  <div class="panel-center">
    <Canvas>
      <Scene
        {showCutaway} {showLabels} {showEdges}
        {lights} {ambient}
        {showHousing} {showSlips} {showSleeve}
        {params}
        onCamUpdate={(s) => camText = s}
        onBuildTime={(ms) => buildTime = ms}
      />
    </Canvas>
    <div class="cam">{camText}</div>
  </div>
  <div class="panel-right">
    <ParamPanel
      bind:params
      bind:showHousing bind:showSlips bind:showSleeve
      bind:showCutaway bind:showLabels bind:showEdges
      bind:lights bind:ambient
      {buildTime}
    />
  </div>
</div>

<style>
  .tool-layout { display: flex; height: 100%; }
  .panel-left { width: 18%; display: flex; flex-direction: column; align-items: center; justify-content: center; border-right: 2px solid #ccc; background: #fff; }
  .panel-left img { max-height: 70%; max-width: 90%; object-fit: contain; }
  .label { font: bold 11px Arial; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-top: 8px; }
  .panel-center { flex: 1; position: relative; }
  .panel-right { width: 25%; background: #fafafa; border-left: 1px solid #ddd; overflow-y: auto; }
  .cam { position: absolute; top: 8px; left: 8px; font: 11px monospace; color: #555; background: rgba(255,255,255,0.9); padding: 3px 8px; border-radius: 3px; }
</style>
