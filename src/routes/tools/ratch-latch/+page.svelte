<script lang="ts">
  import { Canvas } from '@threlte/core';
  import Scene from '$tools/ratch-latch/Scene.svelte';
  import ParamPanel from '$tools/ratch-latch/ParamPanel.svelte';
  import { DEFAULT_PARAMS } from '$tools/ratch-latch/assembly';

  let showCutaway = $state(true);
  let showLabels = $state(true);
  let showEdges = $state(true);
  let showBody = $state(true);
  let showMandrel = $state(true);
  let showSeal = $state(true);
  let lights = $state([
    { x: 1, y: -4, z: -2, intensity: 200, on: true },
    { x: 12, y: 8, z: 0, intensity: 120, on: true },
    { x: 0, y: -6, z: 0, intensity: 80, on: true },
  ]);
  let ambient = $state(0.3);
  let params = $state(structuredClone(DEFAULT_PARAMS));
  let camText = $state("...");
  let buildTime = $state(0);
</script>

<div class="tool-layout">
  <div class="panel-left">
    <img src="/training_data/ratch_latch/images/original.png" alt="Original" />
    <div class="label">Original Drawing</div>
  </div>
  <div class="panel-center">
    <Canvas>
      <Scene
        {showCutaway} {showLabels} {showEdges}
        {lights} {ambient}
        {showBody} {showMandrel} {showSeal}
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
      bind:showBody bind:showMandrel bind:showSeal
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
