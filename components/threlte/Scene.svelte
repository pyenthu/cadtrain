<script lang="ts">
  import { T } from '@threlte/core';
  import { OrbitControls, Edges } from '@threlte/extras';
  import * as THREE from 'three';

  let { geo = null, geoVersion = 0, showCutaway = true, showEdges = true } = $props();
</script>

<T.OrthographicCamera makeDefault position={[6, 0, 0]} zoom={80} up={[0, 0, -1]}>
  <OrbitControls enableDamping />
</T.OrthographicCamera>

<T.AmbientLight intensity={0.3} />
<T.PointLight position={[1, -4, -2]} intensity={200} distance={50} />
<T.PointLight position={[12, 8, 0]} intensity={120} distance={50} />

{#if geo}
  {#key geoVersion + showCutaway}
    {#if showCutaway}
      <T.Mesh geometry={geo.cutVC}>
        <T.MeshPhongMaterial vertexColors specular="#ffffff" shininess={300} side={THREE.DoubleSide} />
        {#if showEdges}<Edges thresholdAngle={20} color="black" />{/if}
      </T.Mesh>
    {:else}
      <T.Mesh geometry={geo.full}>
        <T.MeshPhongMaterial color="#cc2222" specular="#ffffff" shininess={300} side={THREE.DoubleSide} />
        {#if showEdges}<Edges thresholdAngle={20} color="black" />{/if}
      </T.Mesh>
    {/if}
  {/key}
{/if}

<!-- Axes hidden for training screenshots -->
<!-- <T.AxesHelper args={[1.5]} position={[-4, -3, 4]} /> -->
