<script>
  import { T, useThrelte } from '@threlte/core';
  import { OrbitControls, HTML, Edges } from '@threlte/extras';
  import * as THREE from 'three';
  import { initManifold, buildGeometry } from '$tools/bottom-sub/builder';


  let {
    showCutaway = true, showLabels = true, exploded = false, showEdges = true,
    lights = [], ambient = 0.25,
    showHousing = true, showSlips = true, showSleeve = true,
    params = null,
    onCamUpdate = (s) => {},
    onBuildTime = (ms) => {},
  } = $props();

  let geo = $state(null);
  let geoVersion = $state(0);
  let ready = $state(false);
  let building = $state(false);

  const { camera } = useThrelte();

  // Init manifold on mount
  $effect(() => {
    initManifold().then(() => { ready = true; });
  });

  // Rebuild when params change — serialize to detect deep changes
  let paramsKey = $derived(params ? JSON.stringify(params) : "");

  $effect(() => {
    // Read paramsKey to subscribe to changes
    const _key = paramsKey;
    if (!ready || !params) return;
    building = true;
    const t0 = performance.now();
    const p = JSON.parse(_key); // use parsed copy to avoid stale refs
    setTimeout(() => {
      geo = buildGeometry(p);
      geoVersion++;
      const ms = performance.now() - t0;
      building = false;
      onBuildTime(ms);
      console.log(`Built in ${ms.toFixed(0)}ms, v${geoVersion}`);
    }, 10);
  });

  // Camera position update
  $effect(() => {
    function update() {
      const c = $camera;
      if (c) onCamUpdate(`x: ${c.position.x.toFixed(1)}  y: ${c.position.y.toFixed(1)}  z: ${c.position.z.toFixed(1)}  zoom: ${c.zoom.toFixed(1)}`);
      requestAnimationFrame(update);
    }
    update();
  });

  // OutlineEffect — just go back to Edges component, it works
  // OutlineEffect doesn't integrate well with Threlte's render loop

  const labels = [
    { name: "Flat Top",     anchor: [0, -1.3, -3.5], label: [0, -5, -4.0], color: "#cc2222" },
    { name: "Taper",        anchor: [0, -1.3, -3.1], label: [0, -5, -3.2], color: "#cc2222" },
    { name: "Shear Pin",    anchor: [0, -0.6, -2.0], label: [0, -5, -2.4], color: "#666666" },
    { name: "Body",         anchor: [0, -1.0, -1.5], label: [0, -5, -1.6], color: "#cc2222" },
    { name: "Slips",        anchor: [0, -1.4, -0.8], label: [0, -5, -0.8], color: "#aa3333" },
    { name: "Inner Sleeve", anchor: [0, -0.5, -1.0], label: [0, -5,  0.0], color: "#888888" },
    { name: "Shoulder",     anchor: [0, -1.5,  0.1], label: [0, -5,  0.8], color: "#cc2222" },
    { name: "Box End",      anchor: [0, -1.5,  1.5], label: [0, -5,  1.6], color: "#cc2222" },
    { name: "Bottom Taper", anchor: [0, -1.1,  3.3], label: [0, -5,  2.8], color: "#cc2222" },
  ];
</script>

<T.OrthographicCamera makeDefault position={[4, 0, 0]} zoom={40} up={[0, 0, -1]}>
  <OrbitControls enableDamping />
</T.OrthographicCamera>

<T.AmbientLight intensity={ambient} />
{#each lights as light}
  {#if light.on}
    <T.PointLight position={[light.x, light.y, light.z]} intensity={light.intensity} distance={50} />
    <T.Mesh position={[light.x, light.y, light.z]}><T.SphereGeometry args={[0.12]} /><T.MeshBasicMaterial color="orange" /></T.Mesh>
  {/if}
{/each}

{#if building}
  <HTML position={[0, 0, 0]} center pointerEvents="none">
    <div style="font:bold 14px Arial;color:#cc2222;background:rgba(255,255,255,0.9);padding:8px 16px;border-radius:6px">Building...</div>
  </HTML>
{/if}

{#if geo}
  {#if showHousing}
    {#key geoVersion + showCutaway}
      {#if showCutaway}
        <T.Mesh geometry={geo.housingCutVC}>
          <T.MeshPhongMaterial vertexColors specular="#ffffff" shininess={300} side={THREE.DoubleSide} />
          {#if showEdges}<Edges thresholdAngle={20} color="black" />{/if}
        </T.Mesh>
      {:else}
        <T.Mesh geometry={geo.housingFull}>
          <T.MeshPhongMaterial color="#cc2222" specular="#ffffff" shininess={300} side={THREE.DoubleSide} />
          {#if showEdges}<Edges thresholdAngle={20} color="black" />{/if}
        </T.Mesh>
      {/if}
    {/key}
  {/if}

  {#if showSlips}
    {#key geoVersion + showCutaway}
      <T.Mesh geometry={showCutaway ? geo.slipsCut : geo.slipsFull}>
        <T.MeshPhongMaterial color="#aa2222" specular="#ffffff" shininess={250} side={THREE.DoubleSide} />
        {#if showEdges}<Edges thresholdAngle={30} color="black" />{/if}
      </T.Mesh>
    {/key}
  {/if}

  {#if showSleeve}
    {#key geoVersion + showCutaway}
      <T.Mesh geometry={showCutaway ? geo.sleeveCut : geo.sleeveFull}>
        <T.MeshPhongMaterial color="#999999" specular="#ffffff" shininess={300} side={THREE.DoubleSide} />
        {#if showEdges}<Edges thresholdAngle={20} color="black" />{/if}
      </T.Mesh>
    {/key}
  {/if}
{/if}

{#if showLabels && showCutaway && geo}
  {#each labels as label}
    <T.Mesh position={label.anchor}><T.SphereGeometry args={[0.07, 8, 8]} /><T.MeshBasicMaterial color={label.color} /></T.Mesh>
    <T.LineSegments>
      {@const lineGeo = new THREE.BufferGeometry()}
      {@const pts = new Float32Array([...label.anchor, ...label.label])}
      {void lineGeo.setAttribute('position', new THREE.BufferAttribute(pts, 3))}
      <T is={lineGeo} />
      <T.LineBasicMaterial color={label.color} opacity={0.5} transparent />
    </T.LineSegments>
    <HTML position={label.label} pointerEvents="none">
      <div class="label-tag" style="border-color:{label.color};color:{label.color}">{label.name}</div>
    </HTML>
  {/each}
{/if}

<T.AxesHelper args={[2]} position={[-5, -4, 4]} />

<style>
  .label-tag {
    font: bold 10px Arial;
    white-space: nowrap;
    background: rgba(255,255,255,0.95);
    padding: 3px 8px;
    border-radius: 3px;
    border-left: 3px solid;
    box-shadow: 0 1px 3px rgba(0,0,0,0.12);
  }
</style>
