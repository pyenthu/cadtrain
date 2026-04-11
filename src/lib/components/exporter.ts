/**
 * Export component geometry as SVG via three-svg-renderer.
 * PNG is captured directly from the live Threlte canvas instead.
 *
 * Splits cutVC geometry into red (outer) and grey (bore/cut) meshes
 * so SVG renderer shows correct colors per region.
 */

import * as THREE from 'three';
import { SVGRenderer, SVGMesh, FillPass, VisibleChainPass } from 'three-svg-renderer';

/**
 * Split a vertex-colored BufferGeometry into two geometries by color.
 * Faces with vertex color r > 0.5 → "red" mesh, rest → "grey" mesh.
 */
function splitByColor(geometry: THREE.BufferGeometry): { red: THREE.BufferGeometry; grey: THREE.BufferGeometry } {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
  const col = geometry.getAttribute('color') as THREE.BufferAttribute;

  if (!col) {
    // No vertex colors — return everything as red
    return { red: geometry, grey: new THREE.BufferGeometry() };
  }

  const redVerts: number[] = [];
  const greyVerts: number[] = [];
  const triCount = pos.count / 3;

  for (let i = 0; i < triCount; i++) {
    const base = i * 3;
    // Check first vertex color of the triangle
    const r = col.getX(base);

    const verts = [];
    for (let j = 0; j < 3; j++) {
      verts.push(pos.getX(base + j), pos.getY(base + j), pos.getZ(base + j));
    }

    if (r > 0.5) {
      redVerts.push(...verts);
    } else {
      greyVerts.push(...verts);
    }
  }

  function makeGeo(verts: number[]): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    if (verts.length > 0) {
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      geo.computeVertexNormals();
    }
    return geo;
  }

  return { red: makeGeo(redVerts), grey: makeGeo(greyVerts) };
}

/**
 * Render a BufferGeometry to SVG from orthographic cross-section view.
 */
export async function exportSVG(
  geometry: THREE.BufferGeometry,
  options: { width?: number; height?: number } = {}
): Promise<string> {
  const W = options.width || 200;
  const H = options.height || 320;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#ffffff');

  // Split into red + grey meshes so SVG shows correct colors
  const { red, grey } = splitByColor(geometry);

  const redMat = new THREE.MeshPhongMaterial({ color: '#cc2222', side: THREE.DoubleSide });
  const greyMat = new THREE.MeshPhongMaterial({ color: '#888888', side: THREE.DoubleSide });

  const meshes: SVGMesh[] = [];

  if (red.getAttribute('position')?.count > 0) {
    const redMesh = new THREE.Mesh(red, redMat);
    scene.add(redMesh);
    meshes.push(new SVGMesh(redMesh));
  }

  if (grey.getAttribute('position')?.count > 0) {
    const greyMesh = new THREE.Mesh(grey, greyMat);
    scene.add(greyMesh);
    meshes.push(new SVGMesh(greyMesh));
  }

  scene.add(new THREE.AmbientLight(0xffffff, 0.4));

  // Camera matching ComponentScene (zoom=60, pos=[6,0,0], Z-down)
  const aspect = W / H;
  const zoom = 100;
  const halfH = H / (2 * zoom);
  const halfW = halfH * aspect;
  const camera = new THREE.OrthographicCamera(
    -halfW, halfW, halfH, -halfH, 0.1, 100
  );
  camera.position.set(6, 0, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  (camera as any).aspect = aspect;

  // SVG render
  const svgRenderer = new SVGRenderer();
  svgRenderer.addPass(new FillPass());
  svgRenderer.addPass(new VisibleChainPass());

  const svg = await svgRenderer.generateSVG(meshes, camera as any, { w: W, h: H });
  return svg.svg();
}
