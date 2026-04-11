<script>
  import { T, useThrelte } from '@threlte/core';
  import { OrbitControls, HTML, Edges } from '@threlte/extras';
  import * as THREE from 'three';
  import { initManifold, buildGeometry } from '$tools/ratch-latch/builder';

  let {
    showCutaway = true, showLabels = true, showEdges = true,
    lights = [], ambient = 0.25,
    showBody = true, showMandrel = true, showSeal = true,
    params = null,
    onCamUpdate = (s) => {},
    onBuildTime = (ms) => {},
  } = $props();

  let geo = $state(null);
  let geoVersion = $state(0);
  let ready = $state(false);
  let building = $state(false);

  const { camera } = useThrelte();

  $effect(() => {
    initManifold().then(() => { ready = true; });
  });

  let paramsKey = $derived(params ? JSON.stringify(params) : "");

  $effect(() => {
    const _key = paramsKey;
    if (!ready || !params) return;
    building = true;
    const t0 = performance.now();
    const p = JSON.parse(_key);
    setTimeout(() => {
      geo = buildGeometry(p);
      geoVersion++;
      const ms = performance.now() - t0;
      building = false;
      onBuildTime(ms);
      console.log(`Built in ${ms.toFixed(0)}ms, v${geoVersion}`);
    }, 10);
  });

  $effect(() => {
    function update() {
      const c = $camera;
      if (c) onCamUpdate(`x: ${c.position.x.toFixed(1)}  y: ${c.position.y.toFixed(1)}  z: ${c.position.z.toFixed(1)}  zoom: ${c.zoom.toFixed(1)}`);
      requestAnimationFrame(update);
    }
    update();
  });

  const labels = [
    { name: "Top Cap",    anchor: [0, -1.3, -0.2],  label: [0, -5, -0.5],  color: "#cc2222" },
    { name: "Threads",    anchor: [0, -1.2, -1.5],  label: [0, -5, -1.5],  color: "#888888" },
    { name: "Upper Body", anchor: [0, -1.3, -4.0],  label: [0, -5, -3.5],  color: "#cc2222" },
    { name: "Shoulder",   anchor: [0, -1.2, -6.5],  label: [0, -5, -5.5],  color: "#cc2222" },
    { name: "Mandrel",    anchor: [0, -0.6, -5.0],  label: [0, -5, -7.0],  color: "#888888" },
    { name: "Seal",       anchor: [0, -0.9, -5.5],  label: [0, -5, -8.5],  color: "#888888" },
    { name: "Lower Body", anchor: [0, -1.3, -9.0],  label: [0, -5, -10.0], color: "#cc2222" },
    { name: "Bottom",     anchor: [0, -1.0, -12.0], label: [0, -5, -11.5], color: "#cc2222" },
  ];
</script>

<T.OrthographicCamera makeDefault position={[4, 0, 0]} zoom={25} up={[0, 0, -1]}>
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
  {#if showBody}
    {#key geoVersion + showCutaway}
      {#if showCutaway}
        <T.Mesh geometry={geo.bodyCutVC}>
          <T.MeshPhongMaterial vertexColors specular="#ffffff" shininess={300} side={THREE.DoubleSide} />
          {#if showEdges}<Edges thresholdAngle={20} color="black" />{/if}
        </T.Mesh>
      {:else}
        <T.Mesh geometry={geo.bodyFull}>
          <T.MeshPhongMaterial color="#cc2222" specular="#ffffff" shininess={300} side={THREE.DoubleSide} />
          {#if showEdges}<Edges thresholdAngle={20} color="black" />{/if}
        </T.Mesh>
      {/if}
    {/key}
  {/if}

  {#if showMandrel}
    {#key geoVersion + showCutaway}
      <T.Mesh geometry={showCutaway ? geo.mandrelCut : geo.mandrelFull}>
        <T.MeshPhongMaterial color="#999999" specular="#ffffff" shininess={300} side={THREE.DoubleSide} />
        {#if showEdges}<Edges thresholdAngle={20} color="black" />{/if}
      </T.Mesh>
    {/key}
  {/if}

  {#if showSeal}
    {#key geoVersion + showCutaway}
      <T.Mesh geometry={showCutaway ? geo.sealCut : geo.sealFull}>
        <T.MeshPhongMaterial color="#777777" specular="#ffffff" shininess={250} side={THREE.DoubleSide} />
        {#if showEdges}<Edges thresholdAngle={30} color="black" />{/if}
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

<T.AxesHelper args={[2]} position={[-5, -4, 8]} />

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
