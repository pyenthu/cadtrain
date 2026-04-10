<script>
  import { Canvas } from '@threlte/core';
  import Scene from './Scene.svelte';
  import ParamPanel from './ParamPanel.svelte';
  import { DEFAULT_PARAMS } from '../assembly';

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
    { x: 5, y: 0, z: 5, intensity: 60, on: false },
  ]);
  let ambient = $state(0.3);

  let params = $state(structuredClone(DEFAULT_PARAMS));
  let camText = $state("...");
  let buildTime = $state(0);
</script>

<div class="app">
  <div class="panel-left">
    <img src="/original.png" alt="Original Drawing" />
    <div class="header-label">Original Drawing</div>
  </div>
  <div class="panel-center">
    <div class="header-label">ManifoldCAD 3D Model</div>
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
    <div class="cam-display">Cam: {camText}</div>
  </div>
  <div class="panel-right">
    <div class="header-label">Parameters</div>
    <div class="panel-scroll">
      <ParamPanel
        bind:params
        bind:showBody bind:showMandrel bind:showSeal
        bind:showCutaway bind:showLabels bind:showEdges
        bind:lights bind:ambient
        {buildTime}
      />
    </div>
  </div>
</div>

<style>
  .app { display:flex; width:100vw; height:100vh; background:#f0f0f0; font-family:Arial,sans-serif; }
  .panel-left { width:20%; display:flex; flex-direction:column; align-items:center; justify-content:center; border-right:2px solid #ccc; position:relative; background:#fff; }
  .panel-left img { max-height:60%; max-width:90%; object-fit:contain; margin-top:36px; }
  .panel-center { width:55%; position:relative; }
  .panel-right { width:25%; position:relative; background:#fafafa; border-left:1px solid #ddd; overflow:hidden; display:flex; flex-direction:column; }
  .panel-scroll { flex:1; overflow-y:auto; margin-top:36px; }
  .header-label { position:absolute; top:0;left:0;right:0; height:36px; display:flex; align-items:center; justify-content:center; font-size:13px; font-weight:bold; color:#444; text-transform:uppercase; letter-spacing:1px; background:#f5f5f5; border-bottom:2px solid #ccc; z-index:10; }
  .cam-display { position:absolute; top:44px; left:8px; font:11px monospace; color:#555; background:rgba(255,255,255,0.9); padding:3px 8px; border-radius:3px; border:1px solid #ddd; z-index:20; }
</style>
